# 檢查一個單元：python3 tools/check.py 單元代號
import re, sys, os
from html.parser import HTMLParser
P = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'content')
u = sys.argv[1]
body = open(f'{P}/{u}.body.html', encoding='utf-8').read()
try: ans = open(f'{P}/{u}.ans.html', encoding='utf-8').read()
except FileNotFoundError: ans = ''
errs = []
TAGS = {'section', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'strong', 'em', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'sub', 'sup'}
CLS = {'unit', 'en', 'zh', 'eg', 'key', 'tip', 'warn', 'bad', 'good', 'mark', 't', 'ex', 'exid', 'exset', 'opts', 'lines', 'check', 'ans-unit', 'ans', 'why'}
VOID = {'br'}
class Chk(HTMLParser):
    def __init__(s, name): super().__init__(); s.st = []; s.name = name
    def handle_starttag(s, tag, attrs):
        if tag not in TAGS: errs.append(f'{s.name}: 不允許的標籤 <{tag}>（第 {s.getpos()[0]} 行）')
        for k, v in attrs:
            if k == 'style': errs.append(f'{s.name}: 不可用行內 style（第 {s.getpos()[0]} 行）')
            if k == 'class':
                for c in (v or '').split():
                    if c not in CLS: errs.append(f'{s.name}: 不允許的 class "{c}"（第 {s.getpos()[0]} 行）')
        if tag not in VOID: s.st.append((tag, s.getpos()[0]))
    def handle_endtag(s, tag):
        if tag in VOID: return
        if not s.st or s.st[-1][0] != tag:
            errs.append(f'{s.name}: 標籤不成對 </{tag}>（第 {s.getpos()[0]} 行，前一個未關的是 {s.st[-1] if s.st else None}）')
            while s.st and s.st[-1][0] != tag: s.st.pop()
        if s.st: s.st.pop()
for name, html in (('本文', body), ('解答', ans)):
    c = Chk(name); c.feed(html)
    for t, ln in c.st: errs.append(f'{name}: <{t}> 沒有關（第 {ln} 行）')
if len(re.findall(r'<h2[ >]', body)) != 1: errs.append('本文要剛好一個 <h2>')
if not re.search(rf'<section class="unit" id="{re.escape(u)}">', body): errs.append(f'本文開頭要是 <section class="unit" id="{u}">')
ex = re.findall(r'<div class="ex" id="([^"]+)">', body)
if len(set(ex)) != len(ex): errs.append('練習編號重複：' + ', '.join(sorted({e for e in ex if ex.count(e) > 1})))
pref = u.rstrip('ab') if u in ('V7a', 'V7b') else u
for i, e in enumerate(ex, 1):
    if not re.fullmatch(rf'{re.escape(u)}-\d\d\d?', e): errs.append(f'練習編號格式要是 {u}-01：{e}'); break
aid = re.findall(r'<div class="ans"><span class="exid">([^<]+)</span>', ans)
miss = [e for e in ex if e not in aid]; extra = [a for a in aid if a not in ex]
if miss: errs.append('解答缺：' + ', '.join(miss))
if extra: errs.append('解答多出：' + ', '.join(extra))
for e in ex:
    if not re.search(rf'<span class="exid">{re.escape(e)}</span>', body): errs.append(f'{e} 少了 <span class="exid">'); break
txt = re.sub(r'<[^>]+>', '', body + ans)
BAN = ['大考中心', '人工智慧撰寫', '語言模型', '網絡', '信息', '視頻', '軟件', '質量', '屏幕', '打印', '默認', '激活', '水平', '概率', '計算機', '互聯網', '志願者', '博客', '短信', '數據庫', '優化', '視頻', '用戶', '登錄', '硬件']
for b in BAN:
    if b in txt: errs.append(f'出現不該用的詞「{b}」（「質量」只有物理意思可用；「水平」請改「水準／程度」；其餘請改成臺灣用語）')
if re.search(r'[✓✗✔✘➜★☆●◆■□▲▶]', txt): errs.append('不要用特殊符號（箭頭只能用「→」；勾叉請用 good/bad）')
if re.search(r'\*\*|^#+ ', txt, re.M): errs.append('不要用 Markdown')
han = len(re.findall(r'[一-鿿]', txt)); en = len(re.findall(r'[A-Za-z]+', txt))
if errs:
    print(f'{len(errs)} 個問題：'); print('\n'.join(errs[:60])); sys.exit(1)
print(f'OK {u}: 練習 {len(ex)} 題，中文 {han} 字，英文 {en} 詞')
