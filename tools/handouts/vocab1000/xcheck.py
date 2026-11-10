# 全書交叉檢查：題幹與同單元字卡例句是否太像、跨單元重複、答案分布
import json,re,glob,collections,sys
D='/tmp/claude-0/v1000/data'
W=lambda s:[w.lower() for w in re.findall(r"[A-Za-z']+",s.replace('[[','').replace(']]',''))]
def grams(t,n=5): return {' '.join(t[i:i+n]) for i in range(len(t)-n+1)}
STOP=set('the a an of to in on at for and or but with by from that this is was were are be been it its his her their our your as than then so if when while which who whom into over after before about not no'.split())
allex=collections.defaultdict(list); n=0; ans=collections.Counter()
for f in sorted(glob.glob(D+'/unit-*.json')):
    U=json.load(open(f)); u=U['unit']
    ex={e['word']:[s['example'] for s in e['senses']] for e in U['entries']}
    for e in U['entries']:
        for s in e['senses']: allex[' '.join(W(s['example']))].append((u,e['word']))
    for i,q in enumerate(U['quiz'],1):
        ans[q['answer']]+=1
        qt=W(q['stem']); qc=set(qt)-STOP
        for x in ex.get(q['word'],[]):
            xt=W(x); xc=set(xt)-STOP
            g=grams(qt,4)&grams(xt,4); j=len(qc&xc)/max(1,len(qc|xc))
            if g or j>=0.34: n+=1; print(f'U{u:02d} Q{i} {q["word"]}: 4gram={len(g)} jacc={j:.2f}\n   Q: {q["stem"]}\n   E: {x}')
dup=[(k,v) for k,v in allex.items() if len(v)>1]
print('similar pairs:',n,'| duplicate examples:',len(dup),'| answers:',dict(ans))
