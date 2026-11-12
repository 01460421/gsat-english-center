# 把各單元的 sources.json 整理成「資料來源」一節
import json, glob, html, re, collections, os
from urllib.parse import urlparse
R = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'); W = R + '/sources'; P = R + '/content'
NAME = {'N2': '仿寫（上）', 'N3': '仿寫（下）', 'N4': '替代詞', 'N5': '成語（主題分類）', 'N6': '成語（易誤用、易寫錯）', 'N7': '名言（古典經典）', 'N8': '名言（現代與外國）', 'N9': '典故與人物事例（古代）', 'N10': '人物事例（近現代）', 'N11': '詩詞名句', 'N12': '易錯字、標點、語病'}
h = ['<section class="unit" id="SRC"><h2>SRC　資料來源</h2>', '<p>各單元查證所用的主要網站如下。成語的寫法與釋義依教育部《成語典》與《重編國語辭典修訂本》；古典名句與詩詞的字句依通行版本。</p>']
tot = 0
for u in NAME:
    f = f'{W}/{u}.sources.json'
    if not os.path.exists(f): continue
    try: src = json.load(open(f))
    except Exception: continue
    c = collections.Counter()
    for x in src:
        d = urlparse(x.get('url', '')).netloc.replace('www.', '')
        if d: c[d] += 1
    tot += len(src)
    h.append(f'<h4>{u}　{NAME[u]}（查證 {len(src)} 筆）</h4><p class="src">' + '、'.join(f'{html.escape(d)}' for d, _ in c.most_common(14)) + '</p>')
h.append('</section>')
open(f'{P}/SRC.body.html', 'w').write('\n'.join(h)); open(f'{P}/SRC.ans.html', 'w').write('<section class="ans-unit" id="ans-SRC"></section>')
print('sources', tot)
