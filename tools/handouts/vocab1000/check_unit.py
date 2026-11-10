# 檢查一個單元的輸出：python3 -I check_unit.py unit-XX.out.json
import json, re, sys, collections

W = '/tmp/claude-0/v1000/work'
POS = {'vt.', 'vi.', 'v.', 'n.', 'adj.', 'adv.', 'prep.', 'conj.'}
path = sys.argv[1]
m = re.search(r'unit-(\d\d)', path)
uu = m.group(1)
inp = json.load(open(f'{W}/unit-{uu}.in.json'))
corpus = json.load(open(f'{W}/corpus.json'))
out = json.load(open(path))
errs = []
han = lambda s: len(re.findall(r'[一-鿿]', s or ''))
words = lambda s: re.findall(r"[A-Za-z][A-Za-z'’\-]*", s or '')
norm = lambda s: [w.lower() for w in words(s.replace('<<', '').replace('>>', ''))]

# 學測原句 8 連字（自編句不可與題本重疊）
grams = set()
for c in corpus:
    t = norm(c['s'])
    for k in range(len(t) - 7):
        grams.add(' '.join(t[k:k + 8]))
def overlap(s):
    t = norm(s.replace('[[', '').replace(']]', ''))
    return any(' '.join(t[k:k + 8]) in grams for k in range(len(t) - 7))

E = out.get('entries', [])
if len(E) != len(inp): errs.append(f'entries: {len(E)} != {len(inp)}')
for k, (e, src) in enumerate(zip(E, inp)):
    w = src['word']; tag = f'[{k + 1} {w}]'
    if e.get('word') != w: errs.append(f'{tag} word is {e.get("word")!r}, expected {w!r} (keep input order)'); continue
    if e.get('level') != src['level']: errs.append(f'{tag} level must be {src["level"]}')
    if not isinstance(e.get('conversion'), bool): errs.append(f'{tag} conversion must be true/false')
    cz = e.get('common_zh', '')
    if not cz or han(cz) > 12 or not re.search(r'（[a-z./]+）$', cz): errs.append(f'{tag} common_zh needs ≤10 字 + （pos）: {cz!r}')
    S = e.get('senses') or []
    if not 1 <= len(S) <= 3: errs.append(f'{tag} senses count {len(S)}')
    for j, s in enumerate(S):
        t = f'{tag} sense {j}'
        if s.get('pos') not in POS: errs.append(f'{t} pos {s.get("pos")!r}')
        if not s.get('zh') or han(s['zh']) > 14: errs.append(f'{t} zh too long/empty: {s.get("zh")!r}')
        if re.search(r'[()]', s.get('zh', '')): errs.append(f'{t} zh: use full-width parentheses')
        if not 2 <= len(words(s.get('en', ''))) <= 12: errs.append(f'{t} en must be 2–12 words')
        pats = [p.strip() for p in (s.get('pattern') or '').split(' / ') if p.strip()]
        if not 2 <= len(pats) <= 4: errs.append(f'{t} pattern needs 2–4 collocations separated by " / "')
        ex = s.get('example', '')
        if len(re.findall(r'\[\[.+?\]\]', ex)) != 1: errs.append(f'{t} example must mark the headword with [[ ]] exactly once')
        else:
            hw = re.search(r'\[\[(.+?)\]\]', ex).group(1).lower()
            stem = w[:max(3, len(w) - 2)].lower()
            if not hw.startswith(stem[:3]) and hw not in src.get('forms', []): errs.append(f'{t} [[{hw}]] does not look like a form of {w}')
        n = len(words(ex.replace('[[', '').replace(']]', '')))
        if not 10 <= n <= 22: errs.append(f'{t} example has {n} words (10–22)')
        if overlap(ex): errs.append(f'{t} example overlaps a 學測 sentence (8 words in a row); rewrite')
        ez = s.get('example_zh', '')
        if han(ez) < 6: errs.append(f'{t} example_zh missing')
        if re.search(r'[,;:!?]|\.$', ez) and not re.search(r'[A-Za-z]', ez): errs.append(f'{t} example_zh: use full-width punctuation')
        if han(s.get('note', '')) > 22: errs.append(f'{t} note too long')
    cand = {c['i'] for c in src.get('cands', [])}
    G = e.get('gsat') or []
    if len(G) > 2: errs.append(f'{tag} gsat max 2')
    for g in G:
        if g.get('i') not in cand: errs.append(f'{tag} gsat i={g.get("i")} is not one of this word\'s cands')
        if not isinstance(g.get('sense'), int) or not 0 <= g['sense'] < len(S): errs.append(f'{tag} gsat sense index invalid')

Q = out.get('quiz', [])
if len(Q) != 10: errs.append(f'quiz: {len(Q)} questions (need 10)')
byw = {e.get('word'): e for e in E}
seen = set(); pos = collections.Counter()
for k, q in enumerate(Q):
    t = f'[Q{k + 1}]'
    st = q.get('stem', '')
    if len(re.findall(r'_{3,}', st)) != 1 or '______' not in st: errs.append(f'{t} stem needs exactly one blank of six underscores')
    n = len(words(st))
    if not 13 <= n <= 32: errs.append(f'{t} stem has {n} words (15–30)')
    if overlap(st): errs.append(f'{t} stem overlaps a 學測 sentence; rewrite')
    o = q.get('options') or {}
    if sorted(o) != ['A', 'B', 'C', 'D']: errs.append(f'{t} options must be A–D'); continue
    vals = [o[x] for x in 'ABCD']
    if len(set(vals)) != 4: errs.append(f'{t} duplicate options')
    for v in vals:
        if not re.fullmatch(r"[a-z][a-z\-']*", v): errs.append(f'{t} option {v!r} must be one lowercase word')
    if q.get('answer') not in o: errs.append(f'{t} answer'); continue
    pos[q['answer']] += 1
    w = q.get('word')
    if w not in byw: errs.append(f'{t} word {w!r} is not a headword of this unit'); continue
    if w in seen: errs.append(f'{t} headword {w} used twice')
    seen.add(w)
    if not isinstance(q.get('sense'), int) or not 0 <= q['sense'] < len(byw[w].get('senses') or []): errs.append(f'{t} sense index invalid')
    if not o[q['answer']].startswith(w[:3]): errs.append(f'{t} answer option {o[q["answer"]]!r} is not a form of {w}')
    ex = q.get('explain_zh', '')
    if not ex.startswith(w) or han(ex) > 45 or han(ex) < 8: errs.append(f'{t} explain_zh must start with the headword and be ≤45 字')
for x in 'ABCD':
    if not 2 <= pos[x] <= 3: errs.append(f'quiz answers: {x} used {pos[x]} times (need 2–3 each)')
if not isinstance(out.get('doubts', []), list): errs.append('doubts must be a list')

if errs:
    print(f'{len(errs)} problem(s):'); print('\n'.join(errs)); sys.exit(1)
print(f'OK unit {uu}: {len(E)} entries, {sum(1 for e in E if e.get("gsat"))} with gsat, quiz answers', ''.join(q['answer'] for q in Q))
