# 檢查一個自然科單元：python3 -I /tmp/claude-0/zhw/sci/check_sci.py 單元代號
import re, sys, subprocess
from html.parser import HTMLParser
import os
P = os.environ.get('PARTS', '/tmp/claude-0/zhw/sci/parts')
u = sys.argv[1]
body = open(f'{P}/{u}.body.html', encoding='utf-8').read()
try: ans = open(f'{P}/{u}.ans.html', encoding='utf-8').read()
except FileNotFoundError: ans = ''
errs = []
TAGS = {'section', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'sub', 'sup', 'figure', 'figcaption', 'img'}
SVG = {'svg', 'g', 'line', 'polyline', 'polygon', 'path', 'circle', 'ellipse', 'rect', 'text', 'tspan', 'defs', 'marker', 'title'}
CLS = {'unit', 'en', 'zh', 'eg', 'key', 'tip', 'warn', 'bad', 'good', 'mark', 't', 'ex', 'exid', 'exset', 'opts', 'lines', 'check', 'ans-unit', 'ans', 'why', 'm', 'mb', 'fig', 'half', 'grp', 'hand', 'blue', 'up', 'no', 'circle', 'box', 'ul', 'note', 'formula', 'mnem', 'exam', 'steps', 'example', 'sol', 'scan', 'src', 'xsol', 'xa', 'sci'}
VOID = {'br', 'img'}
SVGVOID = set()
class Chk(HTMLParser):
    def __init__(s, name): super().__init__(convert_charrefs=False); s.st = []; s.name = name; s.insvg = 0; s.nfig = 0
    def handle_starttag(s, tag, attrs):
        ln = s.getpos()[0]
        if tag == 'svg': s.insvg += 1; s.nfig += 1
        if s.insvg:
            if tag not in SVG: errs.append(f'{s.name}: SVG 內不允許 <{tag}>（第 {ln} 行）')
            for k, v in attrs:
                if k.startswith('on') or k in ('href', 'xlink:href', 'style') : errs.append(f'{s.name}: SVG 不可用屬性 {k}（第 {ln} 行）')
            if tag == 'svg' and not any(k == 'viewbox' for k, v in attrs): errs.append(f'{s.name}: <svg> 缺 viewBox（第 {ln} 行）')
            for k, v in attrs:
                if k == 'id' and not (v or '').startswith(u + '-'): errs.append(f'{s.name}: SVG 內的 id 須以「{u}-」開頭：{v}（第 {ln} 行）')
        else:
            if tag not in TAGS: errs.append(f'{s.name}: 不允許的標籤 <{tag}>（第 {ln} 行）')
            for k, v in attrs:
                if tag == 'img' and k == 'src' and not re.fullmatch(r'img/[A-Za-z0-9_/.-]+\.(png|jpg)', v or ''): errs.append(f'{s.name}: img 的 src 須為 img/…png（第 {ln} 行）')
                if k == 'data-t' and tag != 'div': errs.append(f'{s.name}: data-t 只用在 div.formula（第 {ln} 行）')
                if k == 'style': errs.append(f'{s.name}: 不可用行內 style（第 {ln} 行）')
                if k == 'class':
                    for c in (v or '').split():
                        if c not in CLS: errs.append(f'{s.name}: 不允許的 class "{c}"（第 {ln} 行）')
        if tag not in VOID: s.st.append((tag, ln))
    def handle_startendtag(s, tag, attrs):
        s.handle_starttag(tag, attrs)
        if tag not in VOID and s.st and s.st[-1][0] == tag: s.st.pop()
        if tag == 'svg': s.insvg -= 1
    def handle_endtag(s, tag):
        if tag in VOID: return
        if not s.st or s.st[-1][0] != tag:
            errs.append(f'{s.name}: 標籤不成對 </{tag}>（第 {s.getpos()[0]} 行，前一個未關的是 {s.st[-1] if s.st else None}）')
            while s.st and s.st[-1][0] != tag: s.st.pop()
        if s.st: s.st.pop()
        if tag == 'svg': s.insvg -= 1
figs = 0
for name, html in (('本文', body), ('解答', ans)):
    c = Chk(name); c.feed(html)
    if c.st: errs.append(f'{name}: 有未關閉的標籤 {c.st[-3:]}')
    if name == '本文': figs = c.nfig
if not re.search(rf'<section class="unit" id="{u}">', body): errs.append(f'本文: 開頭要是 <section class="unit" id="{u}">')
if len(re.findall(r'<h2[ >]', body)) != 1: errs.append('本文: <h2> 必須恰好一個')
qs = re.findall(rf'<div class="ex" id="({u}-\d+)">', body)
aa = re.findall(rf'<span class="exid">({u}-\d+)</span>', ans)
if len(qs) != len(set(qs)): errs.append('本文: 題號重複')
miss = [q for q in qs if q not in aa]; extra = [a for a in aa if a not in qs]
if miss: errs.append(f'解答缺：{miss[:8]}')
if extra: errs.append(f'解答多出：{extra[:8]}')
for i, q in enumerate(qs, 1):
    if q != f'{u}-{i:02d}': errs.append(f'題號不連續：第 {i} 題是 {q}'); break
txt = re.sub(r'<svg[\s\S]*?</svg>', '', body + ans)
txt = re.sub(r'<[^>]+>', '', txt)
for w in (['大考中心', '本站'] if u.startswith('K') else ['操作變因', '自變量', '因變量', '大考中心', '本站']) + [ 'ChatGPT', '人工智慧生成', '語言模型']:
    if w in txt: errs.append(f'不該出現的用語：{w}')
for w in ([] if u.startswith('K') else ['维基', '萌典', '維基百科', 'Wikipedia', 'wikipedia']):
    if w in txt: errs.append(f'正文不寫網站名稱：{w}')
for a, b in [('台灣', '臺灣'), ('信息', '資訊'), ('質量數', None)]:
    pass
r = subprocess.run(['node', '/tmp/claude-0/zhw/pkg/ziran/tools/mathcheck.mjs', f'{P}/{u}.body.html', f'{P}/{u}.ans.html'] if ans else ['node', '/tmp/claude-0/zhw/pkg/ziran/tools/mathcheck.mjs', f'{P}/{u}.body.html'], capture_output=True, text=True)
nm = 0
for line in r.stdout.splitlines():
    if line.startswith('MATH'): nm = int(line.split()[1])
    else: errs.append(line)
if r.returncode: errs.append('公式檢查程式執行失敗：' + r.stderr[-200:])
zh = len(re.findall(r'[一-鿿]', txt))
if errs:
    print(f'{len(errs)} 個問題：'); [print(e) for e in errs[:60]]; sys.exit(1)
print(f'OK {u}: 練習 {len(qs)} 題，公式 {nm} 處，圖 {figs} 張，中文 {zh} 字')
