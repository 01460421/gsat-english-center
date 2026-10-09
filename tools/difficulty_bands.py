#!/usr/bin/env python3
"""三種練習難度（穩定基礎／進階練習／超越頂標）的分級規則與歷屆逐題標籤。

用法（在專案根目錄）：
    python3 tools/difficulty_bands.py               # 寫入 data/exams/difficulty-bands.json
    python3 tools/difficulty_bands.py --check       # 只重算並比對現有 JSON，不同就以 1 結束（不寫檔）
    python3 tools/difficulty_bands.py --verify-raw  # 另外用 xlrd 重讀 data/raw/ceec 的成績標準表，核對本檔內嵌的五標常數

規則（說明與取捨見 docs/analysis/difficulty-bands.md）：
    一題屬於「目標組答對率 ≥ 50%」的最低一級；目標組用同一場考試的五等分能力組（各 20%）：
        穩定基礎 basic     Pc（第 40–60 百分位，均標所在組）≥ 0.50
        進階練習 advanced  Pc < 0.50 且 Pb（第 60–80 百分位，前標所在組）≥ 0.50
        超越頂標 top       Pb < 0.50（要到 Pa，即第 80–100 百分位、頂標所在組，才可能過半）
    旗標：top 且 Pa < 0.50 → "challenge"（頂標組也未過半）；top 且 D1 = Pa − Pb < 0.10 → "low_upper_discrimination"
    （前 20% 沒有明顯勝過次 20%，不當校準錨點）。官方表是整數百分比，比較時用 round(x×100) ≥ 50。

輸入（都在 git 內）：
    data/exams/item-stats.json          逐題 P、Ph、Pl、Pa–Pe、D、D1（45 個考試年度、2420 題，全部有五等分組）
    data/exams/gsat-spec.json           grading.english_by_year：111–115 各級分人數與原得總分級距
    data/exams/parsed/gsat-111..115.json 各題配分（只用來算各能力組的選擇題期望得分）
    本檔 GSAT_STANDARDS／AST_STANDARDS   大考中心「各科成績標準一覽表」英文科（manifest subkind = score_standard；
                                        原檔不進 git，--verify-raw 可重新核對）

輸出 data/exams/difficulty-bands.json（items 一題一行，其餘 json.dumps(sort_keys=True, indent=1)；重跑逐位元組相同）。
只用標準函式庫；--verify-raw 另需 xlrd（與 pdftotext，可省略）。
"""
import argparse
import json
import math
import re
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ITEM_STATS = ROOT / 'data/exams/item-stats.json'
GSAT_SPEC = ROOT / 'data/exams/gsat-spec.json'
PARSED = ROOT / 'data/exams/parsed'
MANIFEST = ROOT / 'data/exams/manifest.json'
OUT = ROOT / 'data/exams/difficulty-bands.json'

THETA = 50          # 目標組答對率門檻（百分比）
D1_MIN = 10         # 超越頂標當校準錨點的最低上層鑑別度 D1 = Pa − Pb（百分點）
TIERS = ['basic', 'advanced', 'top']
TIER_ZH = {'basic': '穩定基礎', 'advanced': '進階練習', 'top': '超越頂標'}
GROUPS = ['Pa', 'Pb', 'Pc', 'Pd', 'Pe']   # 依總分由高到低各 20%
STD_NAMES = ['頂標', '前標', '均標', '後標', '底標']
STD_PERCENTILE = {'頂標': 88, '前標': 75, '均標': 50, '後標': 25, '底標': 12}
# 官方〈試題特色〉與 08 §2.4 的「各年最難 3 題」，以及 08 §6 第 9 點舉的穩定基礎例子。
# 同分規則：第 3 低的 P 有同分時全部收入。115 年第 3 低 P .29 有三題同分（6、9、11）；08 §2.4 只列 6、9，
# 這裡補上 11，共 17 題。
OFFICIAL_HARDEST = [('gsat-111', '9'), ('gsat-111', '13'), ('gsat-111', '16'), ('gsat-112', '23'), ('gsat-112', '18'),
                    ('gsat-112', '7'), ('gsat-113', '8'), ('gsat-113', '20'), ('gsat-113', '3'), ('gsat-114', '23'),
                    ('gsat-114', '9'), ('gsat-114', '27'), ('gsat-115', '10'), ('gsat-115', '38'), ('gsat-115', '6'),
                    ('gsat-115', '9'), ('gsat-115', '11')]
OFFICIAL_HARDEST_RULE = ('各年 P 最低的 3 題；第 3 低有同分時全部收入（115 年 6、9、11 同為 P .29，08 §2.4 只列 6、9）')
OFFICIAL_EASY_EXAMPLE = ('gsat-113', '35')

# 各科成績標準一覽表・英文科：{學年度: {標準: (級分, 達到該級分以上的百分比)}}。
# 每年取當年 xls（data/raw/ceec/gsat/{year}/stats-*.xls，manifest subkind = score_standard）；
# 91 年當年檔是 PDF，取 92 年 xls 內的 91 年列（與 PDF 文字層相同）。後續年度檔重列的舊年數值逐格相同。
GSAT_STANDARDS = {
    91: {'頂標': (13, 18.44), '前標': (11, 36.59), '均標': (8, 62.69), '後標': (6, 78.22), '底標': (4, 90.84)},
    92: {'頂標': (12, 18.01), '前標': (10, 32.95), '均標': (7, 58.63), '後標': (4, 87.11), '底標': (3, 95.86)},
    93: {'頂標': (12, 17.59), '前標': (11, 25.06), '均標': (8, 52.16), '後標': (5, 81.92), '底標': (4, 91.0)},
    94: {'頂標': (13, 13.28), '前標': (11, 26.98), '均標': (8, 51.41), '後標': (5, 79.45), '底標': (4, 90.61)},
    95: {'頂標': (13, 15.8), '前標': (11, 30.77), '均標': (8, 55.45), '後標': (5, 82.13), '底標': (4, 91.48)},
    96: {'頂標': (13, 16.03), '前標': (11, 31.2), '均標': (8, 55.84), '後標': (5, 82.05), '底標': (4, 91.74)},
    97: {'頂標': (14, 15.54), '前標': (13, 25.57), '均標': (10, 50.3), '後標': (6, 77.28), '底標': (4, 91.61)},
    98: {'頂標': (13, 16.0), '前標': (11, 30.19), '均標': (8, 54.1), '後標': (5, 78.81), '底標': (4, 89.31)},
    99: {'頂標': (13, 16.76), '前標': (11, 32.68), '均標': (8, 58.0), '後標': (5, 81.58), '底標': (4, 90.86)},
    100: {'頂標': (14, 16.41), '前標': (13, 27.4), '均標': (10, 54.29), '後標': (6, 80.22), '底標': (4, 92.09)},
    101: {'頂標': (14, 14.81), '前標': (12, 34.04), '均標': (10, 52.68), '後標': (6, 78.79), '底標': (4, 91.06)},
    102: {'頂標': (14, 14.43), '前標': (13, 25.79), '均標': (10, 52.06), '後標': (6, 77.11), '底標': (4, 91.74)},
    103: {'頂標': (14, 13.9), '前標': (12, 34.65), '均標': (10, 51.89), '後標': (6, 78.48), '底標': (4, 92.65)},
    104: {'頂標': (14, 12.18), '前標': (12, 30.14), '均標': (9, 55.73), '後標': (6, 75.49), '底標': (4, 91.94)},
    105: {'頂標': (14, 12.79), '前標': (12, 30.63), '均標': (9, 56.24), '後標': (6, 78.38), '底標': (4, 92.55)},
    106: {'頂標': (13, 16.55), '前標': (11, 31.03), '均標': (8, 54.09), '後標': (5, 80.94), '底標': (4, 91.57)},
    107: {'頂標': (14, 15.36), '前標': (13, 25.04), '均標': (10, 51.16), '後標': (6, 76.85), '底標': (4, 90.78)},
    108: {'頂標': (14, 15.51), '前標': (13, 25.45), '均標': (10, 50.09), '後標': (5, 81.84), '底標': (4, 90.69)},
    109: {'頂標': (14, 12.56), '前標': (12, 31.67), '均標': (9, 55.72), '後標': (6, 76.23), '底標': (4, 91.78)},
    110: {'頂標': (13, 17.81), '前標': (12, 25.9), '均標': (8, 56.57), '後標': (5, 80.28), '底標': (4, 90.2)},
    111: {'頂標': (13, 17.2), '前標': (12, 25.65), '均標': (8, 56.9), '後標': (5, 80.52), '底標': (4, 89.26)},
    112: {'頂標': (13, 13.42), '前標': (11, 27.7), '均標': (8, 51.77), '後標': (5, 77.99), '底標': (4, 88.09)},
    113: {'頂標': (13, 14.13), '前標': (11, 28.0), '均標': (8, 50.84), '後標': (5, 77.4), '底標': (3, 96.78)},
    114: {'頂標': (13, 15.71), '前標': (11, 30.46), '均標': (8, 51.39), '後標': (4, 84.78), '底標': (3, 95.6)},
    115: {'頂標': (13, 15.71), '前標': (11, 31.8), '均標': (8, 54.21), '後標': (5, 76.65), '底標': (3, 96.11)},
}
# 指考英文（原始分數，滿分 100）。91–92 是舊定義（高標＝前 50% 平均、均標＝全體平均、低標＝後 50% 平均）；
# 93 起為第 88／75／50／25／12 百分位數。91 取自 PDF 文字層（ast/91/stats-3.pdf），其餘取當年 xls。
AST_STANDARDS = {
    91: {'高標': 55, '均標': 36, '低標': 18},
    92: {'高標': 60, '均標': 39, '低標': 18},
    93: {'頂標': 58, '前標': 44, '均標': 27, '後標': 15, '底標': 9},
    94: {'頂標': 69, '前標': 55, '均標': 34, '後標': 16, '底標': 8},
    95: {'頂標': 67, '前標': 51, '均標': 28, '後標': 13, '底標': 7},
    96: {'頂標': 60, '前標': 46, '均標': 26, '後標': 13, '底標': 7},
    97: {'頂標': 76, '前標': 64, '均標': 41, '後標': 20, '底標': 9},
    98: {'頂標': 74, '前標': 63, '均標': 44, '後標': 24, '底標': 12},
    99: {'頂標': 79, '前標': 69, '均標': 48, '後標': 26, '底標': 13},
    100: {'頂標': 79, '前標': 69, '均標': 51, '後標': 33, '底標': 23},
    101: {'頂標': 82, '前標': 72, '均標': 54, '後標': 35, '底標': 25},
    102: {'頂標': 82, '前標': 73, '均標': 56, '後標': 38, '底標': 26},
    103: {'頂標': 84, '前標': 76, '均標': 58, '後標': 36, '底標': 24},
    104: {'頂標': 76, '前標': 66, '均標': 46, '後標': 28, '底標': 20},
    105: {'頂標': 79, '前標': 69, '均標': 50, '後標': 31, '底標': 22},
    106: {'頂標': 79, '前標': 70, '均標': 52, '後標': 33, '底標': 24},
    107: {'頂標': 78, '前標': 68, '均標': 48, '後標': 28, '底標': 20},
    108: {'頂標': 80, '前標': 72, '均標': 53, '後標': 31, '底標': 22},
    109: {'頂標': 82, '前標': 75, '均標': 56, '後標': 33, '底標': 22},
    110: {'頂標': 84, '前標': 76, '均標': 54, '後標': 31, '底標': 21},
}

ND = statistics.NormalDist()


def r4(x):
    return None if x is None else round(x + 0.0, 4)


def pct(x):
    """官方值（0–1、兩位小數）轉整數百分比。"""
    return int(round(x * 100))


def quant(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * p
    f = math.floor(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def qsummary(xs):
    return {'n': len(xs), 'p10': r4(quant(xs, .1)), 'p25': r4(quant(xs, .25)), 'p50': r4(quant(xs, .5)),
            'p75': r4(quant(xs, .75)), 'p90': r4(quant(xs, .9)), 'mean': r4(statistics.mean(xs)) if xs else None}


def logit(p):
    p = min(max(p, 0.005), 0.995)
    return math.log(p / (1 - p))


def ilogit(x):
    return 1 / (1 + math.exp(-x))


def interval_mean_theta(lo_pct, hi_pct):
    """標準常態在第 lo–hi 百分位之間的平均 θ。"""
    zlo = -math.inf if lo_pct <= 0 else ND.inv_cdf(lo_pct / 100)
    zhi = math.inf if hi_pct >= 100 else ND.inv_cdf(hi_pct / 100)
    phi = lambda z: 0.0 if math.isinf(z) else ND.pdf(z)  # noqa: E731
    return (phi(zlo) - phi(zhi)) / ((hi_pct - lo_pct) / 100)


# 五等分組的組內平均 θ（Pa 1.40、Pb 0.53、Pc 0、Pd −0.53、Pe −1.40）
GROUP_THETA = {g: interval_mean_theta(80 - 20 * i, 100 - 20 * i) for i, g in enumerate(GROUPS)}
GROUP_RANGE = {g: (80 - 20 * i, 100 - 20 * i) for i, g in enumerate(GROUPS)}


def success_at(it, theta, extrapolate=False):
    """在能力 θ 的預期答對率：五組點（組內平均 θ, logit 答對率）之間線性內插。
    超出兩端時預設取端點值（clamp）：頂標以上帶的 θ 1.548 高於 Pa 點（1.40），所以該帶的值就是 Pa（保守估計）。
    extrapolate=True 時改為延伸最外側線段（Pb→Pa、Pd→Pe），只拿來和 clamp 值並列對照。"""
    pts = sorted((GROUP_THETA[g], logit(it[g])) for g in GROUPS)
    if theta <= pts[0][0]:
        if extrapolate:
            (t0, y0), (t1, y1) = pts[0], pts[1]
            return ilogit(y0 + (y1 - y0) * (theta - t0) / (t1 - t0))
        return ilogit(pts[0][1])
    if theta >= pts[-1][0]:
        if extrapolate:
            (t0, y0), (t1, y1) = pts[-2], pts[-1]
            return ilogit(y1 + (y1 - y0) * (theta - t1) / (t1 - t0))
        return ilogit(pts[-1][1])
    for (t0, y0), (t1, y1) in zip(pts, pts[1:]):
        if t0 <= theta <= t1:
            return ilogit(y0 + (y1 - y0) * (theta - t0) / (t1 - t0))


def group_of_percentile(p):
    for g in GROUPS:
        lo, hi = GROUP_RANGE[g]
        if lo <= p < hi or (g == 'Pa' and p >= 100):
            return g


# ---------------------------------------------------------------- 規則
def tier_group(pc, pb, theta=THETA):
    """pc、pb 為整數百分比（官方）或 0–100 的實數（推估值）。"""
    if pc >= theta:
        return 'basic'
    if pb >= theta:
        return 'advanced'
    return 'top'


def flags_for(tier, pa, d1):
    f = []
    if tier == 'top' and pa < THETA:
        f.append('challenge')
    if tier == 'top' and d1 < D1_MIN:
        f.append('low_upper_discrimination')
    return f


# ---------------------------------------------------------------- 只有 P／Ph／Pl 時的推估（最小平方法）
def solve(a, b):
    n = len(a)
    m = [row[:] + [bb] for row, bb in zip(a, b)]
    for i in range(n):
        p = max(range(i, n), key=lambda k: abs(m[k][i]))
        m[i], m[p] = m[p], m[i]
        for k in range(n):
            if k != i:
                f = m[k][i] / m[i][i]
                for j in range(i, n + 1):
                    m[k][j] -= f * m[i][j]
    return [m[i][n] / m[i][i] for i in range(n)]


def ols(xs, ys):
    k = len(xs[0])
    xtx = [[sum(x[i] * x[j] for x in xs) for j in range(k)] for i in range(k)]
    xty = [sum(x[i] * y for x, y in zip(xs, ys)) for i in range(k)]
    return solve(xtx, xty)


IMP_FEATURES = ['const', 'P', 'Ph', 'Pl']


def imp_x(it, p_only=False):
    return [1.0, it['P']] if p_only else [1.0, it['P'], it['Ph'], it['Pl']]


def fit_imputer(items, p_only=False):
    xs = [imp_x(it, p_only) for it in items]
    return {g: ols(xs, [it[g] for it in items]) for g in ('Pc', 'Pb', 'Pa')}


def impute(model, it, p_only=False):
    x = imp_x(it, p_only)
    return {g: sum(c * v for c, v in zip(coef, x)) for g, coef in model.items()}


def imputed_tier(model, it, p_only=False):
    e = impute(model, it, p_only)
    return tier_group(e['Pc'] * 100, e['Pb'] * 100)


# ---------------------------------------------------------------- 載入
def load_items():
    src = json.loads(ITEM_STATS.read_text(encoding='utf-8'))
    items = []
    for eid, ex in src['exams'].items():
        for it in ex['items']:
            row = {'exam': eid, 'test': ex['exam'], 'year': ex['exam_year'], 'era': ex['era'], 'label': it['label'],
                   'no': it['no'], 'section': it['section'], 'mode': it['mode']}
            for k in ['P', 'Ph', 'Pl', 'D', 'D1', 'D2', 'D3', 'D4'] + GROUPS:
                row[k] = it[k]
            if any(row[k] is None for k in ['P', 'Ph', 'Pl'] + GROUPS):
                raise SystemExit(f'{eid} {it["label"]}: 缺 P/Ph/Pl/Pa–Pe，規則需要補 imputed 分支')
            items.append(row)
    items.sort(key=lambda r: (r['test'] != 'gsat', r['year'], r['no'], r['label']))
    return src, items


def item_tier(it, theta=THETA):
    return tier_group(pct(it['Pc']), pct(it['Pb']), theta)


# ---------------------------------------------------------------- 五標與能力組的對應
def ability_mapping(items, spec):
    out = {'group_percentiles': {g: list(GROUP_RANGE[g]) for g in GROUPS},
           'group_mean_theta': {g: r4(GROUP_THETA[g]) for g in GROUPS},
           'standard_percentile_definition': STD_PERCENTILE}
    rows, hits = {}, {s: {} for s in STD_NAMES}
    for y, stds in sorted(GSAT_STANDARDS.items()):
        row = {}
        for s in STD_NAMES:
            level, share = stds[s]
            lower = round(100 - share, 2)        # 剛達到該標級分的考生所在百分位（下緣）
            g = group_of_percentile(lower)
            row[s] = {'level': level, 'pct_at_or_above': share, 'lower_edge_percentile': lower, 'group': g}
            hits[s][g] = hits[s].get(g, 0) + 1
        rows[str(y)] = row
    out['gsat_by_year'] = rows
    out['gsat_summary'] = {s: {'group_counts': dict(sorted(hits[s].items())),
                               'lower_edge_min': min(rows[y][s]['lower_edge_percentile'] for y in rows),
                               'lower_edge_max': max(rows[y][s]['lower_edge_percentile'] for y in rows)}
                           for s in STD_NAMES}

    # 111–115：用各級分人數算三個練習帶（均標→前標、前標→頂標、頂標以上）落在哪些能力組
    eb = spec['grading']['english_by_year']
    bands, band_theta = {}, {'basic': [], 'advanced': [], 'top': []}
    mc = {}
    for y in range(111, 116):
        d = eb[str(y)]
        cum = {int(k): v['cum_high_to_low_pct'] for k, v in d['level_distribution'].items()}
        lv = {s: d['five_standards'][s]['level'] for s in STD_NAMES}
        edges = {'basic': (100 - cum[lv['均標']], 100 - cum[lv['前標']]),
                 'advanced': (100 - cum[lv['前標']], 100 - cum[lv['頂標']]),
                 'top': (100 - cum[lv['頂標']], 100.0)}
        yb = {}
        for t, (lo, hi) in edges.items():
            comp = {}
            for g in GROUPS:
                glo, ghi = GROUP_RANGE[g]
                ov = max(0.0, min(hi, ghi) - max(lo, glo))
                if ov > 0:
                    comp[g] = r4(ov / (hi - lo))
            th = interval_mean_theta(lo, hi)
            band_theta[t].append(th)
            yb[t] = {'levels': [lv['均標'], lv['前標'] - 1] if t == 'basic' else
                     ([lv['前標'], lv['頂標'] - 1] if t == 'advanced' else [lv['頂標'], 15]),
                     'percentile_range': [round(lo, 2), round(hi, 2)], 'group_share': comp, 'mean_theta': r4(th)}
        bands[str(y)] = yb
        # 各能力組的選擇題期望得分率 → 換成原得總分落在哪個級分（假設非選擇題得分率與選擇題相同）
        paper = json.loads((PARSED / f'gsat-{y}.json').read_text(encoding='utf-8'))
        pts = {q['label']: q.get('points') for s in paper['sections'] for g in s['groups'] for q in g['questions']}
        its = [it for it in items if it['exam'] == f'gsat-{y}']
        mx = sum(pts[it['label']] for it in its)
        ranges = {}
        for k, v in d['raw_score_range_by_level'].items():
            m = re.match(r'([\d.]+)<X<=([\d.]+)', v)
            if m:
                ranges[int(k)] = (float(m.group(1)), float(m.group(2)))
        row = {'mc_points': mx}
        for g in GROUPS + ['P']:
            rate = sum(pts[it['label']] * it[g] for it in its) / mx
            eq = next((lvl for lvl, (lo, hi) in ranges.items() if lo < rate * 100 <= hi), None)
            row[g] = {'mc_rate': r4(rate), 'level_equivalent': eq}
        mc[str(y)] = row
    out['gsat_current_bands'] = bands
    out['band_mean_theta'] = {t: r4(statistics.mean(v)) for t, v in band_theta.items()}
    out['gsat_current_mc_expected'] = mc
    out['ast'] = {'standards': {str(y): v for y, v in sorted(AST_STANDARDS.items())},
                  'note': '指考五等分組與五標都以指考到考考生為母體（93 起五標為百分位數），與學測母體不同；'
                          '分級沿用同一條規則，但只代表「相對於指考考生」的難度。'}
    return out


# ---------------------------------------------------------------- 比較方案
def alternatives(items, band_theta, std_theta):
    gsat = [it for it in items if it['test'] == 'gsat']
    cut_all = (quant([it['P'] for it in gsat], 1 / 3), quant([it['P'] for it in gsat], 2 / 3))

    def terc(cuts):
        return lambda it: 'basic' if it['P'] >= cuts[1] else ('advanced' if it['P'] >= cuts[0] else 'top')

    def spec_np(it):  # SPEC §3.1 的無模型版：前標考生 ≥ 70% → basic；頂標考生 ≥ 70% → advanced
        if success_at(it, std_theta['前標']) >= 0.70:
            return 'basic'
        if success_at(it, std_theta['頂標']) >= 0.70:
            return 'advanced'
        return 'top'

    rules = {
        'G50': lambda it: item_tier(it, 50),
        'G60': lambda it: item_tier(it, 60),
        'G70': lambda it: item_tier(it, 70),
        'P_terciles': terc(cut_all),
        'SPEC_exit70': spec_np,
    }
    desc = {
        'G50': '本文件採用：Pc ≥ .50 → 穩定基礎；Pb ≥ .50 → 進階練習；其餘 → 超越頂標',
        'G60': '同上，門檻 .60',
        'G70': '同上，門檻 .70',
        'P_terciles': f'全體答對率 P 依學測 {len(gsat)} 題三等分（P ≥ {cut_all[1]:.3f} 穩定基礎、≥ {cut_all[0]:.3f} 進階）',
        'SPEC_exit70': 'SPEC §3.1 字面：前標考生（θ={:.2f}）預期答對 ≥ .70 → 穩定基礎；頂標考生（θ={:.2f}）≥ .70 → 進階；'
                       '預期答對率由五組點 logit 內插'.format(std_theta['前標'], std_theta['頂標']),
    }
    years = sorted({it['year'] for it in gsat})
    idx = {(it['exam'], it['label']): it for it in items}
    chosen = rules['G50']
    res = {}
    for name, f in rules.items():
        r = {'description': desc[name]}
        for lab, sub in [('gsat', gsat), ('gsat-current', [i for i in gsat if i['era'] == 'gsat-current']),
                         ('gsat-legacy', [i for i in gsat if i['era'] == 'gsat-legacy']),
                         ('ast', [i for i in items if i['test'] == 'ast'])]:
            c = {t: 0 for t in TIERS}
            for it in sub:
                c[f(it)] += 1
            r[lab] = {t: [c[t], r4(c[t] / len(sub))] for t in TIERS}
        shares = {t: [] for t in TIERS}
        for y in years:
            sub = [i for i in gsat if i['year'] == y]
            for t in TIERS:
                shares[t].append(sum(1 for i in sub if f(i) == t) / len(sub))
        r['year_share'] = {t: {'sd': r4(statistics.pstdev(v)), 'min': r4(min(v)), 'max': r4(max(v))} for t, v in shares.items()}
        r['official_hardest_in_top'] = sum(1 for k in OFFICIAL_HARDEST if f(idx[k]) == 'top')
        r['official_easy_example_tier'] = f(idx[OFFICIAL_EASY_EXAMPLE])
        r['agreement_with_G50'] = r4(sum(1 for i in gsat if f(i) == chosen(i)) / len(gsat))
        # 各練習帶的考生（帶內平均 θ）在「自己那一級」題目上的預期答對率
        bs = {}
        for lab, sub in [('gsat', gsat), ('gsat-current', [i for i in gsat if i['era'] == 'gsat-current'])]:
            bs[lab] = {}
            for k, t in enumerate(TIERS):
                own = [success_at(i, band_theta[t]) for i in sub if f(i) == t]
                nxt = [success_at(i, band_theta[t]) for i in sub if k < 2 and f(i) == TIERS[k + 1]]
                bs[lab][t] = {'own_tier': r4(statistics.mean(own)) if own else None,
                              'next_tier': r4(statistics.mean(nxt)) if nxt else None}
                if t == 'top':  # 頂標以上帶 θ 超出 Pa 點：own_tier 是 clamp（= Pa），另列延伸值對照
                    ext = [success_at(i, band_theta[t], extrapolate=True) for i in sub if f(i) == t]
                    bs[lab][t]['own_tier_extrapolated'] = r4(statistics.mean(ext)) if ext else None
        r['band_success'] = bs
        res[name] = r
    # P 三等分的切點會隨「拿哪幾年來分」而變；五等分組規則不會
    cut_cur = (quant([i['P'] for i in gsat if i['era'] == 'gsat-current'], 1 / 3),
               quant([i['P'] for i in gsat if i['era'] == 'gsat-current'], 2 / 3))
    cut_leg = (quant([i['P'] for i in gsat if i['era'] == 'gsat-legacy'], 1 / 3),
               quant([i['P'] for i in gsat if i['era'] == 'gsat-legacy'], 2 / 3))
    fa, fc, fl = terc(cut_all), terc(cut_cur), terc(cut_leg)
    res['P_terciles']['cut_sensitivity'] = {
        'cuts_all_gsat': [r4(c) for c in cut_all], 'cuts_current_only': [r4(c) for c in cut_cur],
        'cuts_legacy_only': [r4(c) for c in cut_leg],
        'relabelled_share_current_vs_all': r4(sum(1 for i in gsat if fa(i) != fc(i)) / len(gsat)),
        'relabelled_share_legacy_vs_all': r4(sum(1 for i in gsat if fa(i) != fl(i)) / len(gsat))}
    return res


# ---------------------------------------------------------------- 校準表
def calibration(items, band_theta):
    slices = [('gsat', lambda i: i['test'] == 'gsat'), ('gsat-current', lambda i: i['era'] == 'gsat-current'),
              ('gsat-legacy', lambda i: i['era'] == 'gsat-legacy'), ('ast', lambda i: i['test'] == 'ast')]
    target = {'basic': 'Pc', 'advanced': 'Pb', 'top': 'Pa'}
    out = {}
    for lab, sel in slices:
        sub = [i for i in items if sel(i)]
        out[lab] = {'group_rate_distribution': {k: qsummary([i[k] for i in sub]) for k in ['P'] + GROUPS}}
        for t in TIERS:
            ts = [i for i in sub if i['tier'] == t]
            row = {'n': len(ts), 'share': r4(len(ts) / len(sub)),
                   'P': qsummary([i['P'] for i in ts]),
                   'target_group': target[t], 'target_success': qsummary([i[target[t]] for i in ts]),
                   'Pc_p50': r4(quant([i['Pc'] for i in ts], .5)), 'Pb_p50': r4(quant([i['Pb'] for i in ts], .5)),
                   'Pa_p50': r4(quant([i['Pa'] for i in ts], .5)), 'D_p50': r4(quant([i['D'] for i in ts], .5)),
                   'D1_p50': r4(quant([i['D1'] for i in ts], .5))}
            if lab != 'ast':
                row['band_success_mean'] = {b: r4(statistics.mean(success_at(i, band_theta[b]) for i in ts))
                                            for b in TIERS}
                row['band_success_mean_top_extrapolated'] = r4(statistics.mean(
                    success_at(i, band_theta['top'], extrapolate=True) for i in ts))
            out[lab][t] = row
        # 分大題的 P 範圍（出題時依題型校準）
        secs = sorted({i['section'] for i in sub})
        out[lab]['by_section'] = {s: {t: qsummary([i['P'] for i in sub if i['section'] == s and i['tier'] == t])
                                      for t in TIERS} for s in secs}
    return out


def counts(items):
    by_sec, by_exam = {}, {}
    for lab, sel in [('gsat', lambda i: i['test'] == 'gsat'), ('gsat-current', lambda i: i['era'] == 'gsat-current'),
                     ('gsat-legacy', lambda i: i['era'] == 'gsat-legacy'), ('ast', lambda i: i['test'] == 'ast')]:
        sub = [i for i in items if sel(i)]
        d = {}
        for s in sorted({i['section'] for i in sub}) + ['all']:
            ss = [i for i in sub if s == 'all' or i['section'] == s]
            d[s] = {t: sum(1 for i in ss if i['tier'] == t) for t in TIERS}
            d[s]['challenge'] = sum(1 for i in ss if 'challenge' in i['flags'])
            d[s]['low_upper_discrimination'] = sum(1 for i in ss if 'low_upper_discrimination' in i['flags'])
            d[s]['top_with_D_lt_0.20'] = sum(1 for i in ss if i['tier'] == 'top' and pct(i['D']) < 20)
        by_sec[lab] = d
    for it in items:
        e = by_exam.setdefault(it['exam'], {t: 0 for t in TIERS} | {'challenge': 0, 'n': 0})
        e[it['tier']] += 1
        e['n'] += 1
        e['challenge'] += 'challenge' in it['flags']
    return by_sec, by_exam


# ---------------------------------------------------------------- 主程式
def build():
    src, items = load_items()
    spec = json.loads(GSAT_SPEC.read_text(encoding='utf-8'))
    amap = ability_mapping(items, spec)
    band_theta = amap['band_mean_theta']
    # 五標在 111–115 的平均 θ（達到該標級分以上比例的常態分位數）
    eb = spec['grading']['english_by_year']
    std_theta = {s: statistics.mean(ND.inv_cdf(1 - eb[str(y)]['five_standards'][s]['pct_at_or_above'] / 100)
                                    for y in range(111, 116)) for s in STD_NAMES}
    amap['standard_theta_111_115'] = {s: r4(v) for s, v in std_theta.items()}

    gsat = [it for it in items if it['test'] == 'gsat']
    # 推估模型：用全部學測題擬合，係數取四位小數後再套用（使用者可用 JSON 的係數重現）
    model_full = fit_imputer(gsat)
    model = {g: [round(c, 4) for c in v] for g, v in model_full.items()}
    for it in items:
        it['tier'] = item_tier(it)
        it['method'] = 'five_group'
        d1 = it['D1'] if it['D1'] is not None else it['Pa'] - it['Pb']
        it['flags'] = flags_for(it['tier'], pct(it['Pa']), pct(d1))
        it['tier_imputed'] = imputed_tier(model, it)

    # 驗證：逐年留一（學測 25 年）、舊制→現制、學測→指考、只用 P 的基準
    years = sorted({it['year'] for it in gsat})
    conf = {t: {u: 0 for u in TIERS} for t in TIERS}
    conf_p = {t: {u: 0 for u in TIERS} for t in TIERS}
    near = [0, 0]
    far = [0, 0]
    mae = {g: 0.0 for g in ('Pc', 'Pb', 'Pa')}
    for y in years:
        train = [i for i in gsat if i['year'] != y]
        m, mp = fit_imputer(train), fit_imputer(train, p_only=True)
        for it in (i for i in gsat if i['year'] == y):
            p = imputed_tier(m, it)
            conf[it['tier']][p] += 1
            conf_p[it['tier']][imputed_tier(mp, it, True)] += 1
            e = impute(m, it)
            for g in mae:
                mae[g] += abs(e[g] - it[g])
            bucket = near if (abs(pct(it['Pc']) - THETA) < 5 or abs(pct(it['Pb']) - THETA) < 5) else far
            bucket[0] += p == it['tier']
            bucket[1] += 1
    acc = lambda c: sum(c[t][t] for t in TIERS) / sum(sum(v.values()) for v in c.values())  # noqa: E731
    m_leg = fit_imputer([i for i in gsat if i['era'] == 'gsat-legacy'])
    cur = [i for i in gsat if i['era'] == 'gsat-current']
    ast = [i for i in items if i['test'] == 'ast']
    pm_err = [(i['P'] - 0.33 * i['Ph'] - 0.33 * i['Pl']) / 0.34 - i['Pc'] for i in gsat]
    imputation = {
        'when': '只有全體 P 與高／低分組（前／後 33%）答對率、沒有 Pa–Pe 的題目（例如題本 JSON 的 stats 沒有 five_groups、'
                '出版社模擬考、站內作答統計）。item-stats.json 的 2420 題全部有 Pa–Pe，所以 method 全部是 five_group。',
        'model': '最小平方線性迴歸 Pg = c0 + c1·P + c2·Ph + c3·Pl（g = c, b, a），以推估的 Pc、Pb 套用同一條規則（門檻 0.50，連續值比較）',
        'features': IMP_FEATURES, 'train': f'學測 91–115 共 {len(gsat)} 題',
        'coefficients': {g: dict(zip(IMP_FEATURES, v)) for g, v in model.items()},
        'note_Pc': '中間 34% 考生的答對率可由 (P − 0.33·Ph − 0.33·Pl)／0.34 直接算出，它與 Pc 的平均絕對誤差 '
                   f'{statistics.mean(abs(e) for e in pm_err):.3f}；迴歸的 Pc 係數（≈ 3.16·P − 1.08·Ph − 1.09·Pl）就是這個式子',
        'validation': {
            'leave_one_year_out_accuracy': r4(acc(conf)), 'leave_one_year_out_confusion_true_by_pred': conf,
            'leave_one_year_out_mae': {g: r4(v / len(gsat)) for g, v in mae.items()},
            'accuracy_near_threshold': {'acc': r4(near[0] / near[1]), 'n': near[1],
                                        'definition': '真實 Pc 或 Pb 距 0.50 不到 5 個百分點'},
            'accuracy_far_from_threshold': {'acc': r4(far[0] / far[1]), 'n': far[1]},
            'legacy_to_current_accuracy': r4(sum(1 for i in cur if imputed_tier(m_leg, i) == i['tier']) / len(cur)),
            'gsat_to_ast_accuracy': r4(sum(1 for i in ast if i['tier_imputed'] == i['tier']) / len(ast)),
            'in_sample_accuracy_all_items': r4(sum(1 for i in items if i['tier_imputed'] == i['tier']) / len(items)),
            'baseline_P_only_leave_one_year_out_accuracy': r4(acc(conf_p)),
            'baseline_P_only_confusion_true_by_pred': conf_p,
        },
    }

    alts = alternatives(items, band_theta, std_theta)
    calib = calibration(items, band_theta)
    by_sec, by_exam = counts(items)
    idx = {(i['exam'], i['label']): i for i in items}
    hardest = [{'exam': e, 'label': l, 'section': idx[(e, l)]['section'], 'P': idx[(e, l)]['P'],
                'Pa': idx[(e, l)]['Pa'], 'Pb': idx[(e, l)]['Pb'], 'Pc': idx[(e, l)]['Pc'], 'D': idx[(e, l)]['D'],
                'D1': idx[(e, l)]['D1'], 'tier': idx[(e, l)]['tier'], 'flags': idx[(e, l)]['flags'],
                'passes_D_ge_0.20': idx[(e, l)]['D'] >= 0.20, 'passes_D1_ge_0.10': pct(idx[(e, l)]['D1']) >= D1_MIN}
               for e, l in OFFICIAL_HARDEST]

    out = {
        'meta': {
            'schema': 'difficulty-bands/v1', 'generated_by': 'tools/difficulty_bands.py',
            'inputs': ['data/exams/item-stats.json', 'data/exams/gsat-spec.json (grading.english_by_year)',
                       'data/exams/parsed/gsat-111..115.json (points)',
                       'tools/difficulty_bands.py GSAT_STANDARDS／AST_STANDARDS（各科成績標準一覽表，manifest subkind = score_standard）'],
            'doc': 'docs/analysis/difficulty-bands.md',
            'value_scale': '答對率皆為 0–1；多選題（學測 111–115 第 49 題）的 P、Pa–Pe 是得分率',
            'success_at': '預期答對率＝五組點（組內平均 θ, logit 答對率）線性內插；θ 超出 Pa 點（1.40）時取 Pa（clamp，保守）。'
                          '頂標以上帶 θ 1.548 落在 Pa 點之外，所以 band_success 的頂標以上欄就是 Pa 的平均；'
                          '*_extrapolated 欄位改為延伸 Pb→Pa 的 logit 線段，只供對照',
            'counts': {'items': len(items), 'gsat': len(gsat), 'ast': len(ast),
                       'five_group': sum(1 for i in items if i['method'] == 'five_group'),
                       'imputed': sum(1 for i in items if i['method'] == 'imputed')},
        },
        'rule': {
            'id': 'G50', 'theta': THETA / 100,
            'statement': '一題屬於「目標組答對率 ≥ 0.50」的最低一級；目標組是同一場考試依英文總分分成各 20% 的五等分能力組',
            'tiers': [
                {'id': 'basic', 'zh': TIER_ZH['basic'], 'target_group': 'Pc', 'target_standard': '均標',
                 'group_percentiles': [40, 60], 'condition': 'Pc >= 0.50', 'audience': '均標 → 前標'},
                {'id': 'advanced', 'zh': TIER_ZH['advanced'], 'target_group': 'Pb', 'target_standard': '前標',
                 'group_percentiles': [60, 80], 'condition': 'Pc < 0.50 and Pb >= 0.50', 'audience': '前標 → 頂標'},
                {'id': 'top', 'zh': TIER_ZH['top'], 'target_group': 'Pa', 'target_standard': '頂標',
                 'group_percentiles': [80, 100], 'condition': 'Pb < 0.50', 'audience': '頂標 → 15 級分'},
            ],
            'comparison': '官方值為整數百分比，以 round(x×100) >= 50 比較；推估值（連續）直接比 >= 0.50',
            'flags': {
                'challenge': {'condition': "tier == 'top' and Pa < 0.50", 'meaning': '頂標組也未過半；超越頂標裡最後才出'},
                'low_upper_discrimination': {'condition': "tier == 'top' and D1 < 0.10（D1 = Pa − Pb）",
                                             'meaning': '前 20% 沒有明顯勝過次 20%（多為全體近猜測的題），仍標 top，但不當出題校準錨點'},
            },
            'anchor_condition': "flags 不含 'low_upper_discrimination'",
            'population': '學測題與指考題各自以自己的到考考生分組；指考題的 tier 只代表相對於指考考生的難度，'
                          '校準表與出題錨點以學測（尤其 gsat-current）為準',
            'imputation': imputation,
        },
        'ability_mapping': amap,
        'alternatives': alts,
        'calibration': calib,
        'counts': {'by_section': by_sec, 'by_exam': dict(sorted(by_exam.items(), key=lambda kv: (
            not kv[0].startswith('gsat'), int(kv[0].split('-')[1]))))},
        'official_hardest': hardest,
        'official_hardest_rule': OFFICIAL_HARDEST_RULE,
        'official_easy_example': {'exam': OFFICIAL_EASY_EXAMPLE[0], 'label': OFFICIAL_EASY_EXAMPLE[1],
                                  'tier': idx[OFFICIAL_EASY_EXAMPLE]['tier'], 'P': idx[OFFICIAL_EASY_EXAMPLE]['P'],
                                  'Pc': idx[OFFICIAL_EASY_EXAMPLE]['Pc']},
        'items': '__ITEMS__',
    }
    keep = ['exam', 'label', 'section', 'tier', 'method', 'flags', 'tier_imputed', 'P', 'Pa', 'Pb', 'Pc', 'D1']
    rows = []
    for it in items:
        row = {k: it[k] for k in keep}
        row['population'] = it['test']
        rows.append(json.dumps(row, ensure_ascii=False, sort_keys=True))
    text = json.dumps(out, ensure_ascii=False, sort_keys=True, indent=1)
    text = text.replace('"__ITEMS__"', '[\n  ' + ',\n  '.join(rows) + '\n ]')
    return text + '\n', out


# ---------------------------------------------------------------- 原始檔核對
def verify_raw():
    import xlrd  # noqa: PLC0415
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    problems, checked = [], 0

    def num(x):
        try:
            return float(str(x).replace('%', '').strip())
        except ValueError:
            return None
    for it in manifest['items']:
        if it.get('subkind') != 'score_standard' or it.get('session') != 'regular':
            continue
        path = ROOT / it['local_path']
        if not path.exists():
            continue
        if it['format'] == 'pdf':
            try:
                txt = subprocess.run(['pdftotext', '-layout', str(path), '-'], capture_output=True, text=True).stdout
            except FileNotFoundError:
                continue
            if it['exam'] == 'ast' and it['year'] == 91:
                m = re.search(r'英文\s+(\d+)\s+(\d+)\s+(\d+)', txt)
                got = {'高標': int(m.group(1)), '均標': int(m.group(2)), '低標': int(m.group(3))} if m else None
                checked += 1
                if got != AST_STANDARDS[91]:
                    problems.append(f'ast-91: {got} != {AST_STANDARDS[91]}')
            continue
        book = xlrd.open_workbook(str(path))
        if it['exam'] == 'gsat':
            sh = book.sheets()[0]
            col = cur = None
            for r in range(sh.nrows):
                row = sh.row_values(r)
                cells = [str(c).strip() for c in row]
                if col is None:
                    if '英文' in cells:
                        col = cells.index('英文')
                    continue
                m = re.match(r'^(\d+)(\.0)?(學年度)?$', cells[0])
                if m:
                    cur = int(m.group(1))
                lab = next((c for c in cells[:2] if c in STD_NAMES), None)
                if lab and cur in GSAT_STANDARDS:
                    checked += 1
                    got = (int(num(row[col])), num(row[col + 1]))
                    if got != GSAT_STANDARDS[cur][lab]:
                        problems.append(f'gsat-{cur} {lab}（{it["local_path"]}）: {got} != {GSAT_STANDARDS[cur][lab]}')
        else:
            for sh in book.sheets():
                heads = None
                for r in range(sh.nrows):
                    cells = [str(c).strip() for c in sh.row_values(r)]
                    if heads is None:
                        if '均標' in cells:
                            heads = cells
                        continue
                    if '英文' in cells[:2]:
                        got = {h: int(num(sh.cell_value(r, j))) for j, h in enumerate(heads)
                               if h in STD_NAMES + ['高標', '低標']}
                        checked += 1
                        if got != AST_STANDARDS[it['year']]:
                            problems.append(f'ast-{it["year"]}: {got} != {AST_STANDARDS[it["year"]]}')
    print(f'verify-raw: 核對 {checked} 格／列，不一致 {len(problems)}')
    for p in problems:
        print('  ', p)
    return not problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--check', action='store_true', help='只比對，不寫檔')
    ap.add_argument('--verify-raw', action='store_true', help='用原始 xls／pdf 核對內嵌五標常數')
    a = ap.parse_args()
    ok = True
    if a.verify_raw:
        ok = verify_raw()
    text, out = build()
    c = out['alternatives']['G50']
    summary = {'items': out['meta']['counts'], 'gsat': c['gsat'], 'gsat-current': c['gsat-current'], 'ast': c['ast'],
               'imputation_loyo_accuracy': out['rule']['imputation']['validation']['leave_one_year_out_accuracy']}
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    if a.check:
        same = OUT.exists() and OUT.read_text(encoding='utf-8') == text
        print('check:', 'up to date' if same else f'{OUT.relative_to(ROOT)} 與重算結果不同')
        ok = ok and same
    else:
        OUT.write_text(text, encoding='utf-8')
        print('wrote', OUT.relative_to(ROOT))
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
