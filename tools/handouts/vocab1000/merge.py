# work/unit-XX.out.json（或 .rev.json）→ data/unit-XX.json：補上學測原句文字
import json,re,sys,os
sys.path.insert(0,'/tmp/claude-0/v1000')
from forms import rx
W='/tmp/claude-0/v1000/work'; D='/tmp/claude-0/v1000/data'; os.makedirs(D,exist_ok=True)
C={c['i']:c for c in json.load(open(f'{W}/corpus.json'))}
REPL=json.load(open(f'{W}/repl.map.json')) if os.path.exists(f'{W}/repl.map.json') else []
NEW={e['word']:e for e in json.load(open(f'{W}/unit-99.out.json'))['entries']} if os.path.exists(f'{W}/unit-99.out.json') else {}
stats={'units':0,'entries':0,'gsat_entries':0,'gsat':0,'dropped':0}
for u in range(1,26):
    f=f'{W}/unit-{u:02d}.rev.json'
    if not os.path.exists(f): f=f'{W}/unit-{u:02d}.out.json'
    if not os.path.exists(f): continue
    o=json.load(open(f)); stats['units']+=1
    for uu,old,new in REPL:
        if uu==u and new in NEW:
            k=[i for i,e in enumerate(o['entries']) if e['word']==old]
            if k: o['entries'][k[0]]=NEW[new]; stats['replaced']=stats.get('replaced',0)+1
    o['entries'].sort(key=lambda e:e['word'].lower())
    for e in o['entries']:
        r=rx(e['word']); G=[]; seen=set()
        for g in e.get('gsat') or []:
            c=C.get(g['i'])
            if not c or g['i'] in seen: stats['dropped']+=1; continue
            seen.add(g['i'])
            raw=re.sub(r'\s+',' ',c['s']).strip()
            s=raw.replace('<<','').replace('>>','')
            if '____' in s or len(s.split())>42 or not r.search(s): stats['dropped']+=1; continue
            # 優先標出空格答案裡的那個字；for 當連接詞時標逗號後的那個
            mk=re.search(r'<<([^<>]*)>>',raw); done=False
            if mk and r.search(mk.group(1)):
                pre=raw[:mk.start()].replace('<<','').replace('>>','')
                inner=r.sub(lambda m:'[['+m.group(1)+']]',mk.group(1),count=1)
                s=pre+inner+raw[mk.end():].replace('<<','').replace('>>',''); done=True
            elif e['word']=='for' and re.search(r', for ',s):
                s=s.replace(', for ',', [[for]] ',1); done=True
            if not done: s=r.sub(lambda m:'[['+m.group(1)+']]',s,count=1)
            G.append({'exam':c['exam'],'sec':c['sec'],'sentence':s,'sense':g.get('sense',0)})
        e['gsat']=G
        stats['entries']+=1
        if G: stats['gsat_entries']+=1; stats['gsat']+=len(G)
    json.dump({'unit':u,'entries':o['entries'],'quiz':o['quiz']},open(f'{D}/unit-{u:02d}.json','w'),ensure_ascii=False,indent=1)
print(stats)
