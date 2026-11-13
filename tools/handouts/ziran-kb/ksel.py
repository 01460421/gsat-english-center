#!/usr/bin/env python3
"""Select 科學班入學考題 from K units and insert a 精選 section into P/C/B/E units.

Usage: python3 -I ksel.py [--dry] [--n 6]
Idempotent: replaces the block between <!--KSEL-BEGIN--> and <!--KSEL-END-->.
"""
import re, sys, os, glob, json, collections

ROOT = '/tmp/claude-0/zhw/sci'
PARTS = os.environ.get('PARTS', ROOT + '/parts')
DRY = '--dry' in sys.argv
N = int(sys.argv[sys.argv.index('--n') + 1]) if '--n' in sys.argv else 6

# ---- K unit metadata from kmap.md
meta = {}
for line in open(ROOT + '/kbank/kmap.md', encoding='utf-8'):
    m = re.match(r'^(K\d\d) (\S+?) (\d+) 學年度', line)
    if m:
        meta[m.group(1)] = (m.group(2), int(m.group(3)))

def match_div(s, i):
    """s[i:] starts with <div ...>; return index after matching </div>."""
    depth = 0
    for m in re.finditer(r'<div\b|</div>', s[i:]):
        if m.group(0) == '</div>':
            depth -= 1
            if depth == 0:
                return i + m.end()
        else:
            depth += 1
    raise ValueError('unbalanced div')

GROUP_WORDS = re.compile(r'承上|上題|前題|呈上題|題組|閱讀|本文|文中|上文|短文|資料中|附文|根據上述|依據上述|由上述|上述')
HEAD = re.compile(r'<h[2-4]\b')

def strip_tags(s):
    return re.sub(r'<[^>]+>', '', s)

items = []
for f in sorted(glob.glob(PARTS + '/K??.body.html')):
    k = os.path.basename(f)[:3]
    if k not in meta:
        continue
    s = open(f, encoding='utf-8').read()
    pos = 0
    prev_end = None      # end of previous xsol
    in_group = False
    for m in re.finditer(r'<div class="ex" id="(K\d\d-\d\d)">', s):
        st = m.start()
        if st < pos:
            continue
        ex_end = match_div(s, st)
        rest = s[ex_end:]
        xm = re.match(r'\s*<div class="xsol">', rest)
        if not xm:
            continue
        xs = ex_end + xm.start() + len(xm.group(0)) - len('<div class="xsol">')
        xs = ex_end + (len(rest) - len(rest.lstrip()))
        x_end = match_div(s, xs)
        pos = x_end
        # context between previous question and this one
        gap = s[prev_end:st] if prev_end is not None else ''
        gap = re.sub(r'<p class="src">.*?</p>', '', gap, flags=re.S)
        gap = re.sub(r'<p>(（|\()?(本卷|作答|說明|以下|第[一二三四五六七八九十]+部分|[一二三四五六七八九十]+、)[^<]{0,80}</p>', '', gap)
        if HEAD.search(gap):
            in_group = False
            after = gap[[h.start() for h in HEAD.finditer(gap)][-1]:]
            # text after the last heading (beyond the heading line itself)
            after = re.sub(r'<h[2-4][^>]*>.*?</h[2-4]>', '', after, flags=re.S)
            if strip_tags(after).strip() or '<img' in after or '<table' in after:
                in_group = True
        elif strip_tags(gap).strip() or '<img' in gap or '<table' in gap or '<figure' in gap:
            in_group = True
        prev_end = x_end
        ex = s[st:ex_end]
        xsol = s[xs:x_end]
        qtext = strip_tags(ex)
        if in_group or GROUP_WORDS.search(qtext):
            continue
        if re.search(r'操作變因|自變量|因變量|維基|Wikipedia|萌典|本站', strip_tags(ex + xsol)):
            continue
        cm = re.search(r'<strong>對應</strong>[：:]\s*([^<]*)', xsol)
        if not cm:
            continue
        codes = re.findall(r'\b([PCBEX]\d{1,2})\b', cm.group(1))
        if not codes:
            continue
        adv = '進階' in cm.group(1)
        am = re.search(r'<p class="xa">(.*?)</p>', xsol, re.S)
        ans = strip_tags(am.group(1)) if am else ''
        kind = '非選' if ('參考答案' in ans and '(' not in ans) or 'class="lines"' in ex else ('多選' if re.search(r'\([A-E]\)\s*\([A-E]\)', ans) else '單選')
        items.append(dict(id=m.group(1), k=k, school=meta[k][0], year=meta[k][1], primary=codes[0],
                          codes=codes, adv=adv, ex=ex, xsol=xsol, kind=kind, qlen=len(qtext),
                          slen=len(strip_tags(xsol)), img=('<img' in ex)))

by = collections.defaultdict(list)
for it in items:
    by[it['primary']].append(it)

def pick(cands, n):
    # prefer: not 進階, moderate length, diversity of school/year/kind, newer years
    cands = [c for c in cands if c['qlen'] < 900]
    cands.sort(key=lambda c: (c['adv'], -c['year'], -min(c['slen'], 900)))
    chosen = []
    used_school = collections.Counter(); used_k = set(); kinds = collections.Counter()
    for rnd in range(3):
        for c in cands:
            if len(chosen) >= n:
                break
            if c in chosen:
                continue
            if rnd == 0 and (used_school[c['school']] >= 1 or c['k'] in used_k):
                continue
            if rnd == 1 and (used_school[c['school']] >= 2 or c['k'] in used_k):
                continue
            chosen.append(c); used_school[c['school']] += 1; used_k.add(c['k']); kinds[c['kind']] += 1
    chosen.sort(key=lambda c: (c['school'], -c['year'], c['id']))
    return chosen

SUBJ = {'P': '物理', 'C': '化學', 'B': '生物', 'E': '地球科學'}

def render(unit, chosen):
    out = ['<!--KSEL-BEGIN-->', '<h3>科學班入學考題精選</h3>',
           f'<p>以下選自各校科學班甄選入學「科學能力檢定」公告試題中與本單元相關的題目，題目照原卷謄錄，解析為本書撰寫。各校完整試卷與詳解見第六至八冊（括號內為該冊題號）。</p>']
    for i, c in enumerate(chosen, 1):
        ex = c['ex']
        inner = ex[ex.index('>') + 1: ex.rindex('</div>')]
        inner = re.sub(r'<span class="exid">[^<]*</span>', '', inner, count=1)
        sol = c['xsol']
        sol_inner = sol[sol.index('>') + 1: sol.rindex('</div>')]
        head = f'<p class="src">精選 {i}　{c["school"]} {c["year"]} 學年度（{c["id"]}）</p>'
        blk = f'<div class="ex">{head}{inner}</div>\n<div class="xsol">{sol_inner}</div>'
        blk = re.sub(r'(id="|#)(K\d\d-)', lambda m: m.group(1) + unit + '-' + m.group(2), blk)
        out.append(blk)
    out.append('<!--KSEL-END-->')
    return '\n'.join(out)

report = {}
for f in sorted(glob.glob(PARTS + '/[PCBE]*.body.html')):
    unit = os.path.basename(f).split('.')[0]
    if not re.fullmatch(r'[PCBE]\d{1,2}', unit):
        continue
    cands = by.get(unit, [])
    if len(cands) < N:
        sec = [it for it in items if unit in it['codes'][1:] and it not in cands]
        cands = cands + pick(sec, N - len(cands))
    chosen = pick(cands, N)
    report[unit] = [(c['id'], c['kind']) for c in chosen] + [('候選', len(by.get(unit, [])))]
    if DRY or not chosen:
        continue
    s = open(f, encoding='utf-8').read()
    block = render(unit, chosen)
    if '<!--KSEL-BEGIN-->' in s:
        s = re.sub(r'<!--KSEL-BEGIN-->.*?<!--KSEL-END-->', lambda m: block, s, flags=re.S)
    else:
        anchor = '<h3>自我檢核</h3>'
        if anchor not in s:
            print('no anchor', unit); continue
        s = s.replace(anchor, block + '\n\n' + anchor, 1)
    open(f, 'w', encoding='utf-8').write(s)

for u, r in report.items():
    print(u, r)
print('items', len(items))
