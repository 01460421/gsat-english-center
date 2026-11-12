# 從本站題庫（data/bank/v1，只取 verified）挑題，排成各大題練習與兩回模擬試題
import json, glob, random, re, html, collections, os

BANK = '/home/user/gsat-english-center/data/bank/v1'
OUT = '/tmp/claude-0/book/parts'
random.seed(20261112)
TIER = {'basic': '基礎', 'advanced': '進階', 'top': '頂標'}
EXCLUDE_TEXT = ['Hokusai']  # 與官方文字重疊檢查有疑慮的題組，不收
esc = html.escape

def load(t):
    out = []
    for f in sorted(glob.glob(f'{BANK}/{t}/**/*.json', recursive=True)):
        d = json.load(open(f))
        if d.get('status') != 'verified': continue
        if d['group'].get('figures') and t in ('reading', 'mixed'): continue
        if any(x in json.dumps(d['group'], ensure_ascii=False) for x in EXCLUDE_TEXT): continue
        out.append(d)
    return out

POOL = {t: load(t) for t in ['vocabulary', 'cloze', 'word_bank', 'structure', 'reading', 'mixed', 'translation', 'composition']}
USED = set()

def pick(t, tier, n):
    """依 uid 排序後用固定亂數挑 n 題，主題不重複，不與已選的重複。"""
    c = [d for d in POOL[t] if d['tier'] == tier and d['uid'] not in USED]
    random.shuffle(c)
    out, topics = [], set()
    for d in c:
        tp = (d['group'].get('tags') or {}).get('topic')
        if tp in topics: continue
        out.append(d); topics.add(tp); USED.add(d['uid'])
        if len(out) == n: break
    assert len(out) == n, (t, tier, n, len(out))
    return out

def expl(d, no):
    it = d['annotations']['explanations']['items']
    return it.get(str(no)) or {}

def blanks(text, nomap):
    return re.sub(r'\[\[(\d+)\]\]', lambda m: f'<span class="bl">{nomap(int(m.group(1)))}</span>', esc(text))

def paras(text, nomap=None):
    f = (lambda t: blanks(t, nomap)) if nomap else esc
    return ''.join(f'<p>{f(p.strip())}</p>' for p in text.split('\n') if p.strip())

def opts(o, vertical=False):
    return f'<div class="opts{" v" if vertical else ""}">' + ''.join(f'<span>({k}) {esc(v)}</span>' for k, v in o.items()) + '</div>'

def stem_blank(s):
    return re.sub(r'_{3,}', '<span class="ub"></span>', esc(s))

# ── 各題型：回傳（題目 HTML、[(題號, 答案, 解析)]） ──
def r_vocab(d, base=0):
    h, a = [], []
    for q in d['group']['questions']:
        n = base + q['no']
        h.append(f'<div class="q"><span class="qn">{n}.</span><div class="qb">{stem_blank(q["stem"])}{opts(q["options"])}</div></div>')
        a.append((n, f'({q["answer"]}) {q["options"][q["answer"]]}', expl(d, q['no']).get('explanation_zh', '')))
    return ''.join(h), a

def r_cloze(d, base=0):
    g = d['group']; nm = lambda k: base + k
    h = [f'<div class="passage">{paras(g["passage"], nm)}</div>']; a = []
    for q in g['questions']:
        n = base + q['no']
        h.append(f'<div class="q"><span class="qn">{n}.</span><div class="qb">{opts(q["options"])}</div></div>')
        a.append((n, f'({q["answer"]}) {q["options"][q["answer"]]}', expl(d, q['no']).get('explanation_zh', '')))
    return ''.join(h), a

def r_wordbank(d, base=0):
    g = d['group']; nm = lambda k: base + k
    box = '<div class="bankbox">' + ''.join(f'<span>({k}) {esc(v)}</span>' for k, v in g['options_bank'].items()) + '</div>'
    h = [f'<div class="passage">{paras(g["passage"], nm)}</div>', box]; a = []
    for q in g['questions']:
        n = base + q['no']
        a.append((n, f'({q["answer"]}) {g["options_bank"][q["answer"]]}', expl(d, q['no']).get('explanation_zh', '')))
    return ''.join(h), a

def r_structure(d, base=0):
    g = d['group']; nm = lambda k: base + k
    box = '<div class="bankbox v">' + ''.join(f'<span>({k}) {esc(v)}</span>' for k, v in g['options_bank'].items()) + '</div>'
    h = [f'<div class="passage">{paras(g["passage"], nm)}</div>', box]; a = []
    for q in g['questions']:
        n = base + q['no']
        a.append((n, f'({q["answer"]})', expl(d, q['no']).get('explanation_zh', '')))
    return ''.join(h), a

def r_reading(d, base=0):
    g = d['group']; h = []; a = []
    if g.get('passage'): h.append(f'<div class="passage">{paras(g["passage"])}</div>')
    for p in g.get('passage_parts') or []:
        ttl = f'<div class="pt"><b>{esc(p["label"])}</b>{esc(p.get("title") or "")}</div>'
        h.append(f'<div class="passage">{ttl}{paras(p["text"])}</div>')
    for q in g['questions']:
        n = base + q['no']
        h.append(f'<div class="q"><span class="qn">{n}.</span><div class="qb">{esc(q["stem"])}{opts(q["options"], True)}</div></div>')
        a.append((n, f'({q["answer"]})', expl(d, q['no']).get('explanation_zh', '')))
    return ''.join(h), a

def r_mixed(d, base=0):
    g = d['group']; h = []; a = []
    if g.get('passage'): h.append(f'<div class="passage lead">{paras(g["passage"])}</div>')
    for p in g.get('passage_parts') or []:
        ttl = f'<div class="pt"><b>{esc(p["label"])}</b>{esc(p.get("title") or "")}</div>'
        h.append(f'<div class="passage">{ttl}{paras(p["text"])}</div>')
    seen = set()
    for q in g['questions']:
        n = base + q['no']; e = expl(d, q['no']).get('explanation_zh', '')
        if q['mode'] == 'fill_in_blank':
            if q['stem'] not in seen:
                seen.add(q['stem'])
                same = [x['no'] for x in g['questions'] if x['mode'] == 'fill_in_blank' and x['stem'] == q['stem']]
                lines = q['stem'].split('\n'); zh = lines[0]; en = ' '.join(lines[1:])
                en = re.sub(r'\[\[(\d+)\]\]', lambda m: f'<span class="bl w">{base + same[int(m.group(1)) - 1]}</span>', esc(en))
                rng = f'{base + same[0]}–{base + same[-1]}' if len(same) > 1 else f'{base + same[0]}'
                h.append(f'<div class="q"><span class="qn">{rng}.</span><div class="qb"><span class="ins">{esc(zh)}</span><br>{en}</div></div>')
            a.append((n, q['answer'], e))
        elif q['mode'] == 'multi_select':
            st = '<br>'.join(esc(x) for x in q['stem'].split('\n'))
            h.append(f'<div class="q"><span class="qn">{n}.</span><div class="qb">{st}{opts(q["options"], True)}</div></div>')
            a.append((n, ''.join(f'({x})' for x in q['answer']), e))
        else:
            st = '<br>'.join(esc(x) for x in q['stem'].split('\n'))
            opt = opts(q['options'], True) if q.get('options') else '<div class="wl"></div>'
            h.append(f'<div class="q"><span class="qn">{n}.</span><div class="qb">{st}{opt}</div></div>')
            ans = q['answer'] if isinstance(q['answer'], str) else ''.join(f'({x})' for x in q['answer'])
            a.append((n, ans, e))
    return ''.join(h), a

def r_translation(d, base=0, lines=True):
    h, a = [], []
    for q in d['group']['questions']:
        n = base + q['no']
        h.append(f'<div class="q"><span class="qn">{n}.</span><div class="qb"><span class="zhq">{esc(q["stem"])}</span>{"<div class=wl2></div>" if lines else ""}</div></div>')
        rb = d['annotations']['rubric']['items']; rb = rb.get(str(q['no'])) if isinstance(rb, dict) else rb[q['no'] - 1]
        refs = rb.get('references') or [q['answer']]
        alt = f'<br><span class="alt">也可以寫：{esc(refs[1])}</span>' if len(refs) > 1 else ''
        why = expl(d, q['no']).get('explanation_zh', '')
        rs = rb.get('restructuring_zh'); why = why + (f' {rs}' if rs and rs not in why else '')
        a.append((n, f'<span class="ref">{esc(refs[0])}</span>{alt}', why))
    return ''.join(h), a

def r_composition(d, base=0):
    q = d['group']['questions'][0]; fig = (d['group'].get('figures') or [None])[0]
    h = [f'<div class="q"><div class="qb"><span class="zhq">{esc(q["stem"])}</span></div></div>']
    if fig and fig.get('svg'):
        svg = re.sub(r'\s(role|aria-label)="[^"]*"', '', fig['svg'])
        h.append(f'<div class="fig">{svg}<div class="cap">{esc(fig.get("caption") or "")}</div></div>')
    an = d['annotations']; sc = (an.get('rubric') or {}).get('scaffold') or {}
    ol = ''
    for o in sc.get('outline') or []:
        ol += f'<li><b>第 {o["paragraph"]} 段</b>　{esc(o.get("topic_sentence_zh") or "")}　細節：{esc("；".join(o.get("details_zh") or []))}　收尾：{esc(o.get("closing_zh") or "")}</li>'
    mt = {m['label']: m for m in an.get('model_texts') or []}
    m = mt.get('top') or next(iter(mt.values()))
    txt = ''.join(f'<p class="model">{esc(p.strip())}</p>' for p in m['text'].split('\n') if p.strip())
    wc = len(re.findall(r"[A-Za-z’']+", m['text']))
    ans = f'<div class="ol"><b>大綱</b><ul>{ol}</ul></div><div class="mt"><b>參考範文</b>（{wc} 字）{txt}</div>'
    return ''.join(h), [(None, ans, expl(d, 1).get('strategy_zh', ''))]

R = {'vocabulary': r_vocab, 'cloze': r_cloze, 'word_bank': r_wordbank, 'structure': r_structure, 'reading': r_reading, 'mixed': r_mixed, 'translation': r_translation, 'composition': r_composition}

def ans_html(code, label, a):
    key = '　'.join(f'<i>{n}</i>{re.sub(r"^(\([A-J]\)).*", r"\1", x) if x.startswith("(") else ""}' for n, x, _ in a if n and x.startswith('('))
    rows = ''
    for n, x, why in a:
        num = f'<b class="an">{n}.</b> ' if n else ''
        rows += f'<div class="ar">{num}<span class="ax">{x if "<" in x else esc(x)}</span>' + (f'<span class="why">{esc(why)}</span>' if why else '') + '</div>'
    return f'<div class="aset"><div class="at">{esc(label)}</div>' + (f'<div class="akey">{key}</div>' if key else '') + rows + '</div>'

def practice(code, title, intro, plan, types_label=None):
    """plan: [(type, tier, n)]。每一組是一回。"""
    body = [f'<section class="unit bank" id="{code}"><h2>{code}　{title}</h2><p class="intro">{intro}</p>']
    ans = [f'<section class="ans-unit bankans" id="ans-{code}"><h3>{code}　{title}</h3>']
    k = 0
    for t, tier, n in plan:
        for d in pick(t, tier, n):
            k += 1
            topic = (d['group'].get('tags') or {}).get('topic') or ''
            lab = f'{code}-{k:02d}'
            name = (types_label or {}).get(t, '')
            body.append(f'<div class="set"><div class="sh"><span class="sid">{lab}</span><span class="tier t-{tier}">{TIER[tier]}</span><span class="sn">{name}</span><span class="sc">得分 <i></i></span></div>')
            h, a = R[t](d)
            body.append(h + '</div>')
            ans.append(ans_html(code, lab, a))
    body.append('</section>'); ans.append('</section>')
    open(f'{OUT}/{code}.body.html', 'w').write('\n'.join(body)); open(f'{OUT}/{code}.ans.html', 'w').write('\n'.join(ans))
    return k

def mock(code, title, tier):
    body = [f'<section class="unit bank mock" id="{code}"><h2>{code}　{title}</h2><div class="mockhead"><b>測驗時間 100 分鐘　滿分 100 分</b>　作答前先準備作答用的紙與稿紙。選擇題答錯不倒扣；非選擇題請用英文書寫。</div>']
    ans = [f'<section class="ans-unit bankans" id="ans-{code}"><h3>{code}　{title}</h3>']
    def sec(h3, note): body.append(f'<h3 class="sec">{h3}</h3><p class="secnote">{note}</p>')
    A = []
    sec('第壹部分、選擇題（占 62 分）　一、詞彙題（占 10 分）', '說明：第 1 題至第 10 題，每題 1 分。')
    d = pick('vocabulary', tier, 1)[0]; h, a = r_vocab(d, 0); body.append(h); ans.append(ans_html(code, '一、詞彙題', a)); A += a
    sec('二、綜合測驗（占 10 分）', '說明：第 11 題至第 20 題，每題 1 分。')
    aa = []
    for i, d in enumerate(pick('cloze', tier, 2)):
        body.append(f'<p class="rng">第 {11 + 5 * i} 至 {15 + 5 * i} 題為題組</p>'); h, a = r_cloze(d, 10 + 5 * i); body.append(h); aa += a
    ans.append(ans_html(code, '二、綜合測驗', aa)); A += aa
    sec('三、文意選填（占 10 分）', '說明：第 21 題至第 30 題，每題 1 分。請依文意在文章後所提供的 (A) 到 (J) 選項中分別選出最適當者。')
    d = pick('word_bank', tier, 1)[0]; h, a = r_wordbank(d, 20); body.append(h); ans.append(ans_html(code, '三、文意選填', a)); A += a
    sec('四、篇章結構（占 8 分）', '說明：第 31 題至第 34 題，每題 2 分。請依文意在文章後所提供的選項中分別選出最適當者。')
    d = pick('structure', tier, 1)[0]; h, a = r_structure(d, 30); body.append(h); ans.append(ans_html(code, '四、篇章結構', a)); A += a
    sec('五、閱讀測驗（占 24 分）', '說明：第 35 題至第 46 題，每題 2 分。')
    aa = []
    for i, d in enumerate(pick('reading', tier, 3)):
        body.append(f'<p class="rng">第 {35 + 4 * i} 至 {38 + 4 * i} 題為題組</p>'); h, a = r_reading(d, 34 + 4 * i); body.append(h); aa += a
    ans.append(ans_html(code, '五、閱讀測驗', aa)); A += aa
    sec('第貳部分、混合題（占 10 分）', '說明：第 47 題至第 50 題。選擇的小題畫記在答題卷，非選擇的小題寫在答題卷指定的位置。')
    d = pick('mixed', tier, 1)[0]; h, a = r_mixed(d, 46); body.append(h); ans.append(ans_html(code, '混合題', a))
    sec('第參部分、非選擇題（占 28 分）　一、中譯英（占 8 分）', '說明：請將以下中文句子譯成正確、通順、達意的英文。每題 4 分。')
    d = pick('translation', tier, 1)[0]; h, a = r_translation(d, 0, lines=False); body.append(h); ans.append(ans_html(code, '中譯英', a))
    sec('二、英文作文（占 20 分）', '說明：依提示寫一篇英文作文，文長至少 120 個單詞（words）。')
    d = pick('composition', tier, 1)[0]; h, a = r_composition(d); body.append(h); ans.append(ans_html(code, '英文作文', a))
    body.append('</section>'); ans.append('</section>')
    open(f'{OUT}/{code}.body.html', 'w').write('\n'.join(body)); open(f'{OUT}/{code}.ans.html', 'w').write('\n'.join(ans))

if __name__ == '__main__':
    cfg = json.load(open('/tmp/claude-0/book/bank-plan.json'))
    # 先保留模擬卷的題目，再挑各大題練習
    for m in cfg['mocks']: mock(m['code'], m['title'], m['tier'])
    for p in cfg['practice']:
        k = practice(p['code'], p['title'], p['intro'], [tuple(x) for x in p['plan']], p.get('labels'))
        print(p['code'], k)
    print('used', len(USED), {t: len(v) for t, v in POOL.items()})
