# data/（舊分法）→ data2/：依級別由低到高分 25 單元，前段單元各穿插 3 個較難的字；每單元 40 字 A–Z、10 題
import json,glob,random,os,re,collections
random.seed(20261110)
SRC='/tmp/claude-0/v1000/data'; DST='/tmp/claude-0/v1000/data2'; os.makedirs(DST,exist_ok=True)
E=[];Q={}
for f in sorted(glob.glob(SRC+'/unit-*.json')):
    U=json.load(open(f))
    for e in U['entries']: E.append(e)
    for q in U['quiz']: Q[q['word']]=q
assert len(E)==1000 and len(Q)==250
KK={}
for f in sorted(glob.glob('/tmp/claude-0/v1000/work/kk-*.out.json')): KK.update(json.load(open(f)))
for e in E:
    assert len(KK[e['word']])==len(e['senses']),e['word']
    e['kk']=KK[e['word']]
isq=lambda e:e['word'] in Q
_r={e['word']:random.random() for e in E}
key=lambda e:(e['level'],_r[e['word']])
# 較難的字（L3、L4）抽一部分往前插：前 17 個單元各 1 題字＋2 個非題字
hardQ=[e for e in E if e['level'] in (3,4) and isq(e)]; hardN=[e for e in E if e['level'] in (3,4) and not isq(e)]
random.shuffle(hardQ); random.shuffle(hardN)
FRONT=17
pullQ=hardQ[:FRONT]; pullN=hardN[:FRONT*2]
pulled={e['word'] for e in pullQ+pullN}
mainQ=sorted([e for e in E if isq(e) and e['word'] not in pulled],key=key)
mainN=sorted([e for e in E if not isq(e) and e['word'] not in pulled],key=key)
units=[]
for u in range(25):
    if u<FRONT: qs=[mainQ.pop(0) for _ in range(9)]+[pullQ.pop()]; ns=[mainN.pop(0) for _ in range(28)]+[pullN.pop(),pullN.pop()]
    else: qs=[mainQ.pop(0) for _ in range(10)]; ns=[mainN.pop(0) for _ in range(30)]
    units.append(sorted(qs+ns,key=lambda e:e['word'].lower()))
assert not mainQ and not mainN
PAT=['ABCDABCDAB','ABCDABCDCD','ABCDABCDAC','ABCDABCDBD','ABCDABCDAD','ABCDABCDBC']
for u,ents in enumerate(units,1):
    qs=[dict(Q[e['word']]) for e in ents if isq(e)]; random.shuffle(qs)
    while True:
        letters=list(random.choice(PAT)); random.shuffle(letters)
        if not re.search(r'(.)\1\1',''.join(letters)): break
    for q,L in zip(qs,letters):
        right=q['options'][q['answer']]; wrong=[v for k,v in q['options'].items() if k!=q['answer']]; random.shuffle(wrong)
        o={}; it=iter(wrong)
        for k in 'ABCD': o[k]=right if k==L else next(it)
        q['options']=o; q['answer']=L
    lv=collections.Counter(e['level'] for e in ents)
    json.dump({'unit':u,'levels':dict(sorted(lv.items())),'entries':ents,'quiz':qs},open(f'{DST}/unit-{u:02d}.json','w'),ensure_ascii=False,indent=1)
    print(u,dict(sorted(lv.items())),''.join(letters),ents[0]['word'],'→',ents[-1]['word'])
