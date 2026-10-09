#!/usr/bin/env python3
"""文章指標（SPEC §3.4）：選文 L1–4 token 覆蓋率、L1–6 覆蓋率、表外字比例、平均句長、字數。

用法：
    python3 tools/text_metrics.py data/bank/v1/word_bank/advanced/ai.wb.7f3a9c@1.json [...]   # 印出指標與是否落在帶內
    python3 tools/text_metrics.py --write FILE [...]      # 另外把結果寫回檔案的 metrics 欄位
    python3 tools/text_metrics.py --json FILE [...]       # 機器可讀輸出
    python3 tools/text_metrics.py --text "Some passage." --section word_bank --tier advanced

算法（與 tools/exam_stats.py 一致，數字才能和歷屆選文比）：
    - 先去掉 <b>／<u> 標記與 [[n]] 空格，再用同樣的英文單字規則斷詞；字數＝單字數（不含空格、數字）。
      篇章結構被挖掉的句子、文意選填與綜合測驗的正解都不算進選文（歷屆統計也是這樣算）。
    - 詞形還原用 data/vocab/forms-index.json（exam_stats.Lexicon 的讀法）；沒有 forms-index 時退回字尾規則，
      輸出會標 lexicon=suffix-rules。所有格 's、縮寫（n't、'll…）先拆掉再查；連字號複合字整個查不到時，
      每一段都在表內就算在表內，級別取最高的一段；規則衍生的 -ly 副詞（gradually）沿用形容詞的級別。
    - 分母去掉專有名詞與數字：句中大寫（不在句首）且不在詞表的字是專有名詞；句首大寫且不在詞表的字，
      只有在文中別處也以大寫出現在句中時才算專有名詞；全大寫縮寫（UN、NASA）不在詞表也算專有名詞。
      含數字的 token（1990s、COVID-19）與拼出來的基數、序數詞（four、tenth；官方表放在附錄、沒有級別）算數字。
    - 覆蓋率：L1–4＝級別 ≤4 的 token ÷ 分母；L1–6＝在詞表內的 token ÷ 分母；表外字比例＝1 − L1–6；
      beyond_l4_ratio＝級別 ≥5 的 token ÷ 分母（出題規格書的 beyond-L4）。
    - 平均句長＝字數 ÷ 句數；句子以 . ! ? 後接空白、換行或結尾切分（Mr.、e.g. 這類縮寫不切）。
    - 詞彙題沒有選文：用 10 個題幹合起來算（只供參考，不比對帶）。

帶：預設用 SPEC §3.4（data/specs/tiers.json，由 packages/shared/src/tiers.ts 產生）；檔案的 generation.lot 對得到
data/bank/lots/{lot}.json 時，改用批次規格的 passage_band（SPEC 的帶疊上出題規格書的 passage_overrides）。
結束碼：有檔案不在帶內時為 1（只是印出時也一樣），讀檔失敗為 2。只用標準函式庫。
"""
import argparse
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exam_stats import FORMS, Lexicon  # noqa: E402  — 共用詞彙表與詞形還原

ROOT = Path(__file__).resolve().parent.parent
TIERS_JSON = ROOT / 'data' / 'specs' / 'tiers.json'
LOTS = ROOT / 'data' / 'bank' / 'lots'

LETTER = 'A-Za-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff'
TOKEN_RE = re.compile(rf"[{LETTER}0-9]+(?:['’][{LETTER}]+|-[{LETTER}0-9]+)*")
MARKUP_RE = re.compile(r'</?[bu]>')
BLANK_RE = re.compile(r'\[\[\d+\]\]')
UNDERSCORE_RE = re.compile(r'_{2,}')
SENT_END_RE = re.compile(r'(?<=[.!?])["”’)\]]*(?=\s|$)')
ABBREVIATIONS = {'mr.', 'mrs.', 'ms.', 'dr.', 'st.', 'prof.', 'e.g.', 'i.e.', 'etc.', 'vs.', 'no.', 'jr.', 'sr.', 'u.s.',
                 'a.m.', 'p.m.', 'inc.', 'co.'}
CONTRACTIONS = {"can't": 'can', "won't": 'will', "shan't": 'shall', "ain't": 'be'}
CLITICS = ("n't", "'s", "'re", "'ve", "'ll", "'d", "'m")
# 數字、月份等在官方詞彙表的附錄、沒有級別（03 文件 §4）：拼出來的基數、序數詞算「數字」，不進分母
NUMBER_WORDS = {'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
                'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'thirty',
                'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety', 'hundred', 'thousand', 'million', 'billion',
                'trillion', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
                'eleventh', 'twelfth', 'twentieth', 'hundredth', 'thousandth', 'millionth', 'ones', 'tens', 'hundreds',
                'thousands', 'millions', 'billions', 'dozen', 'dozens'}
PASSAGE_TYPES = ('cloze', 'word_bank', 'structure', 'reading', 'mixed')

_lex = None
_tiers = None


def lexicon():
    global _lex
    if _lex is None:
        _lex = Lexicon()
    return _lex


def tiers_spec():
    global _tiers
    if _tiers is None:
        _tiers = json.loads(TIERS_JSON.read_text(encoding='utf-8'))
    return _tiers


def clean_text(text):
    """去掉強調標記、[[n]] 空格與詞彙題的底線空格。"""
    t = MARKUP_RE.sub('', text or '')
    t = BLANK_RE.sub(' ', t)
    t = re.sub(r'\b(e\.g\.|i\.e\.)', ' ', t)
    return UNDERSCORE_RE.sub(' ', t)


def split_sentences(text):
    """回傳句子字串的陣列（空句略過）。"""
    out = []
    for para in text.split('\n'):
        start = 0
        for m in SENT_END_RE.finditer(para):
            end = m.end()
            chunk = para[start:end].strip()
            last = chunk.split()[-1].lower() if chunk.split() else ''
            if last.strip('"“”’)') in ABBREVIATIONS:
                continue
            if chunk:
                out.append(chunk)
            start = end
        tail = para[start:].strip()
        if tail:
            out.append(tail)
    return [s for s in out if TOKEN_RE.search(s)]


def fold(token):
    """小寫、彎引號轉 '、去重音（forms-index 的鍵也是這樣正規化）。"""
    t = unicodedata.normalize('NFKD', token.lower().replace('’', "'"))
    return ''.join(ch for ch in t if not unicodedata.combining(ch))


def strip_clitic(token):
    t = token.replace('’', "'")
    for c in CLITICS:
        if t.lower().endswith(c) and len(t) > len(c):
            return t[:-len(c)]
    return t


def is_number_word(token):
    t = fold(strip_clitic(token))
    if t in NUMBER_WORDS:
        return True
    # 序數：eighteenth、twentieth、ninetieth
    return t.endswith('th') and (t[:-2] in NUMBER_WORDS or (t.endswith('ieth') and t[:-4] + 'y' in NUMBER_WORDS))


def base_candidates(token):
    """查詞表用的候選形：原形、拆掉所有格與縮寫後的形。"""
    t = fold(token)
    cands = [t]
    if t in CONTRACTIONS:
        cands.append(CONTRACTIONS[t])
    for c in CLITICS:
        if t.endswith(c) and len(t) > len(c):
            cands.append(t[:-len(c)])
    return cands


def token_level(token):
    """token 的詞表級別（同形多筆取最低級）；查不到回傳 None。連字號複合字取各段最高級。"""
    lex = lexicon()
    for c in base_candidates(token):
        idxs = lex.lookup(c)
        if idxs:
            return min(lex.entries[i]['level'] for i in idxs)
    if '-' in token:
        levels = [token_level(p) for p in token.split('-') if p]
        if levels and all(lv is not None for lv in levels):
            return max(levels)
        return None
    # 規則衍生的 -ly 副詞（gradually、happily、gently、basically）沿用形容詞的級別（03 文件 §9.3 的衍生字原則）；
    # forms-index 只收原表列出的衍生形，不補這條會把常見副詞算成表外字
    t = fold(strip_clitic(token))
    if t.endswith('ly') and len(t) > 4:
        for base in (t[:-2], t[:-3] + 'y', t[:-1] + 'e', t[:-2] + 'e', t[:-4]):
            idxs = lex.lookup(base)
            if not idxs:
                continue
            # 形容詞條目，或分詞形容詞（surprising → surprisingly、marked → markedly）
            if base.endswith(('ing', 'ed')) or any(any(p.strip('()') == 'adj.' for p in lex.entries[i]['pos']) for i in idxs):
                return min(lex.entries[i]['level'] for i in idxs)
    return None


def compute(text):
    """回傳指標 dict（不含帶的判定）。"""
    text = clean_text(text)
    sentences = split_sentences(text)
    tokens = []           # (token, sentence_initial)
    for s in sentences:
        for i, m in enumerate(TOKEN_RE.finditer(s)):
            tokens.append((m.group(0), i == 0))
    cap_mid = {strip_clitic(tok) for tok, initial in tokens if not initial and tok[:1].isupper()}
    numbers = 0
    proper = []
    counted = []          # (token, level or None)
    for tok, initial in tokens:
        if any(ch.isdigit() for ch in tok):
            numbers += 1
            continue
        lv = token_level(tok)
        if lv is None and is_number_word(tok):
            numbers += 1
            continue
        if lv is None and tok[:1].isupper():
            acronym = len(tok) >= 2 and tok.isupper()
            if (not initial) or strip_clitic(tok) in cap_mid or acronym:
                proper.append(tok)
                continue
        counted.append((tok, lv))
    words = [tok for tok, _ in tokens if not any(ch.isdigit() for ch in tok)]
    denom = len(counted)
    levels = Counter('off' if lv is None else str(lv) for _, lv in counted)
    l14 = sum(1 for _, lv in counted if lv is not None and lv <= 4)
    l16 = sum(1 for _, lv in counted if lv is not None)
    l56 = sum(1 for _, lv in counted if lv is not None and lv >= 5)

    def ratio(n):
        return round(n / denom, 4) if denom else 0.0

    offlist = sorted({tok.lower() for tok, lv in counted if lv is None})
    return {
        'tool': 'tools/text_metrics.py',
        'lexicon': lexicon().mode,
        'word_count': len(words),
        'sentences': len(sentences),
        'avg_sentence_length': round(len(words) / len(sentences), 2) if sentences else 0.0,
        'denominator': denom,
        'proper_nouns': sorted(set(proper)),
        'numbers': numbers,
        'coverage_l1_4': ratio(l14),
        'coverage_l1_6': ratio(l16),
        'offlist_ratio': round(1 - ratio(l16), 4) if denom else 0.0,
        'beyond_l4_ratio': ratio(l56),
        'level_counts': {k: levels[k] for k in sorted(levels, key=lambda x: (x == 'off', x))},
        'offlist_words': offlist,
    }


# ---------------------------------------------------------------------------
# 帶
# ---------------------------------------------------------------------------

def spec_band(section, tier):
    """SPEC §3.4 的帶（tiers.json），轉成 {指標: {min, max}}；沒有選文的題型回傳 None。"""
    if section not in PASSAGE_TYPES:
        return None
    t = tiers_spec()
    pb = t['passage_bands'][tier]
    return {
        'word_count': dict(t['passage_words'][section][tier]),
        'coverage_l1_4': dict(pb['coverage_l1_4']),
        'coverage_l1_6': dict(pb['coverage_l1_6']),
        'offlist_ratio': dict(pb['offlist_ratio']),
        'avg_sentence_length': dict(pb['avg_sentence_length']),
    }


def load_lot(lot_id):
    if not isinstance(lot_id, str) or not re.fullmatch(r'[a-z_]+-(basic|advanced|top)-\d{2}', lot_id):
        return None
    p = LOTS / f'{lot_id}.json'
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:  # noqa: BLE001 — lot 檔壞掉時由 validate_bank 回報，這裡退回 SPEC 的帶
        return None


def band_for(bank):
    """回傳 (band, basis)。批次規格有 passage_band 就用它，否則用 SPEC §3.4。"""
    section, tier = bank.get('section_type'), bank.get('tier')
    lot = load_lot((bank.get('generation') or {}).get('lot'))
    if lot and lot.get('section_type') == section and lot.get('tier') == tier and isinstance(lot.get('passage_band'), dict):
        band = {k: v for k, v in lot['passage_band'].items() if isinstance(v, dict) and 'min' in v}
        return band, f"lot {lot.get('lot')}（{lot['passage_band'].get('basis', 'SPEC §3.4＋passage_overrides')}）"
    if tier not in ('basic', 'advanced', 'top'):
        return None, 'tier 不明'
    return spec_band(section, tier), 'SPEC §3.4'


def check_band(metrics, band, tier, basis):
    if not band:
        return None
    checks = {}
    for key, rng in band.items():
        v = metrics.get(key)
        if not isinstance(v, (int, float)):
            continue
        lo, hi = rng.get('min'), rng.get('max')
        ok = (lo is None or v >= lo - 1e-9) and (hi is None or v <= hi + 1e-9)
        checks[key] = {'value': v, 'min': lo, 'max': hi, 'ok': ok}
    return {'tier': tier, 'basis': basis, 'ok': all(c['ok'] for c in checks.values()), 'checks': checks}


def bank_text(bank):
    """bank 檔案要量的文字：選文＋多文本；詞彙題用各題題幹。"""
    g = bank.get('group') or {}
    parts = [g.get('passage') or ''] + [p.get('text') or '' for p in g.get('passage_parts') or [] if isinstance(p, dict)]
    text = '\n'.join(t for t in parts if t)
    if not text.strip():
        text = '\n'.join(q.get('stem') or '' for q in g.get('questions') or [] if isinstance(q, dict))
    return text


def metrics_for_bank(bank):
    m = compute(bank_text(bank))
    band, basis = band_for(bank)
    m['band'] = check_band(m, band, bank.get('tier'), basis)
    return m


def describe(m):
    lines = [f"  字數 {m['word_count']}、{m['sentences']} 句、平均句長 {m['avg_sentence_length']}；"
             f"L1–4 {m['coverage_l1_4']:.1%}、L1–6 {m['coverage_l1_6']:.1%}、表外 {m['offlist_ratio']:.1%}、"
             f"L5–6 {m['beyond_l4_ratio']:.1%}（分母 {m['denominator']}，專有名詞 {len(m['proper_nouns'])}、數字 {m['numbers']}）"]
    if m['offlist_words']:
        lines.append(f"  表外字：{', '.join(m['offlist_words'])}")
    b = m.get('band')
    if b is None:
        lines.append('  帶：不適用（沒有選文）')
    else:
        bad = [f"{k}={c['value']}（應在 {c['min']}–{c['max']}）" for k, c in b['checks'].items() if not c['ok']]
        lines.append(f"  帶（{b['basis']}）：{'在帶內' if b['ok'] else '不在帶內：' + '；'.join(bad)}")
    return '\n'.join(lines)


def main(argv):
    ap = argparse.ArgumentParser(description='文章指標（SPEC §3.4）')
    ap.add_argument('files', nargs='*', type=Path)
    ap.add_argument('--write', action='store_true', help='把結果寫回檔案的 metrics 欄位')
    ap.add_argument('--json', action='store_true', help='輸出 JSON')
    ap.add_argument('--text', help='直接量一段文字')
    ap.add_argument('--section', choices=PASSAGE_TYPES, help='搭配 --text：題型')
    ap.add_argument('--tier', choices=('basic', 'advanced', 'top'), help='搭配 --text：難度')
    a = ap.parse_args(argv)
    if not FORMS.exists():
        print('warning: 找不到 data/vocab/forms-index.json，改用字尾規則（結果略有誤差）', file=sys.stderr)
    results = {}
    if a.text is not None:
        m = compute(a.text)
        if a.section and a.tier:
            m['band'] = check_band(m, spec_band(a.section, a.tier), a.tier, 'SPEC §3.4')
        results['--text'] = m
    for p in a.files:
        try:
            bank = json.loads(p.read_text(encoding='utf-8'))
        except Exception as e:  # noqa: BLE001
            print(f'{p}: 讀檔失敗：{e}', file=sys.stderr)
            return 2
        m = metrics_for_bank(bank)
        m['computed_on'] = date.today().isoformat()
        results[str(p)] = m
        if a.write:
            bank['metrics'] = m
            p.write_text(json.dumps(bank, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if not results:
        ap.print_help()
        return 2
    if a.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        for name, m in results.items():
            print(name + ('（已寫回 metrics）' if a.write and name != '--text' else ''))
            if 'band' not in m:
                m['band'] = None
            print(describe(m))
    return 1 if any((m.get('band') or {}).get('ok') is False for m in results.values()) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
