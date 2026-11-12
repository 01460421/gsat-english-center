# 產生 V3（歷屆詞彙題字彙總表）與 V4（熟字僻義 300）
import json, glob, html, re, collections
esc = html.escape
P = '/tmp/claude-0/book/parts'
# ── V3 ──
rows = []
for i in range(1, 5):
    inp = json.load(open(f'/tmp/claude-0/book/work/v3-{i}.in.json')); out = json.load(open(f'/tmp/claude-0/book/work/v3-{i}.out.json'))
    assert [r['word'] for r in inp] == [r['word'] for r in out]
    for a, b in zip(inp, out): rows.append({**a, **b})
seen = {}
for r in rows:
    k = r['head'].lower()
    if k in seen:
        seen[k]['answer_years'] = sorted(set(seen[k]['answer_years']) | set(r['answer_years'])); seen[k]['times'] += r['times']; continue
    seen[k] = r
rows = sorted(seen.values(), key=lambda r: r['head'].lower())
def yr(y): return y.replace('補', '補')
h = ['<section class="unit" id="V3"><h2>V3　歷屆詞彙題字彙總表</h2>',
     f'<p>這張表收錄 83 到 115 學年度學測詞彙題出現過的字，共 {len(rows)} 個：當過正確答案的字全部收錄（標有學年度），只當過選項的字收錄參考詞彙表第 3 級以上的。詞彙題的選項每年都從同一個範圍出，考過的字很常換個身分再出現，所以這是全書最值得背熟的一張表。</p>',
     '<div class="key"><p><strong>怎麼用</strong></p><ul><li>標有學年度的字是當年的正確答案，先背這些。</li><li>每個字都附一個搭配，請連搭配一起背；詞彙題常常就是在考搭配。</li><li>L 後面的數字是參考詞彙表的級別。答案最常落在第 3、4 級。</li><li>背完一頁，遮住中文自己說一遍，說不出來的在字前面做記號。</li></ul></div>']
cur = ''
h.append('<div class="vl">')
for r in rows:
    L = r['head'][0].upper()
    if L != cur: cur = L; h.append(f'<div class="vL">{L}</div>')
    ys = ''.join(f'<i class="y">{esc(y)}</i>' for y in r['answer_years'])
    lv = f'<i class="lv">L{r["level"]}</i>' if r.get('level') else ''
    h.append(f'<div class="ve{" a" if r["answer_years"] else ""}"><div class="v1"><b>{esc(r["head"])}</b><em>{esc(r["pos"])}</em><span class="z">{esc(r["zh"])}</span>{lv}{ys}</div><div class="v2">{esc(r["colloc"])}<span>{esc(r["colloc_zh"])}</span></div></div>')
h.append('</div></section>')
open(f'{P}/V3.body.html', 'w').write('\n'.join(h))
print('V3', len(rows), sum(1 for r in rows if r['answer_years']))

# ── V4 ──
E = []
for f in sorted(glob.glob('/tmp/claude-0/v1000/data2/unit-*.json')): E += json.load(open(f))['entries']
def score(e):
    ys = [int(re.match(r'\d+', g['exam']).group()) for g in e['gsat']]
    return (-(len(ys) > 0), -max(ys, default=0), e['level'], e['word'])
E = [e for e in E if e['gsat']]
E.sort(key=score)
sel = sorted(E[:300], key=lambda e: e['word'].lower())
mark = lambda s: re.sub(r'\[\[(.+?)\]\]', r'<b>\1</b>', esc(s))
h = ['<section class="unit" id="V4"><h2>V4　熟字僻義 300</h2>',
     '<p>熟字僻義是你早就認得的字，在文章裡用了另一個意思。下面 300 個字都在歷屆學測題本裡用過這個「僻義」，依字母排列。每個字列出你原本知道的意思、要學的意思和一個例句，最後標出學測用過這個意思的學年度。</p>',
     '<div class="tip"><p>讀法：遮住「僻義」那一行，先看例句猜意思。猜不出來的字做記號，隔天再看一次。</p></div>', '<div class="vl r">']
for e in sel:
    si = e['gsat'][0].get('sense', 0); si = si if si < len(e['senses']) else 0
    s = e['senses'][si]; kk = (e.get('kk') or [''] * 9)[si]
    ys = ''.join(f'<i class="y">{esc(y)}</i>' for y in sorted({g['exam'] for g in e['gsat'] if g.get('sense', 0) == si} or {e['gsat'][0]['exam']}))
    pat = (s.get('pattern') or '').split(' / ')[0]
    h.append(f'<div class="ve r"><div class="v1"><b>{esc(e["word"])}</b><span class="kk">{esc(kk)}</span><span class="fam">熟義　{esc(e["common_zh"])}</span></div>'
             f'<div class="v1 s"><em>{esc(s["pos"])}</em><span class="z">{esc(s["zh"])}</span>{ys}</div>'
             f'<div class="v3">{mark(s["example"])}</div></div>')
h.append('</div></section>')
open(f'{P}/V4.body.html', 'w').write('\n'.join(h))
print('V4', len(sel))
