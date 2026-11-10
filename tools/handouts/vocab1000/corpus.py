# 從歷屆學測題本抽句子（不含翻譯、作文；翻譯的 answer 是官方參考答案，不可用）
import json,glob,re,os
R='/home/user/gsat-english-center/data/exams/parsed'
SEC={'vocabulary':'詞彙題','cloze':'綜合測驗','word_bank':'文意選填','reading':'閱讀測驗','structure':'篇章結構','mixed':'混合題'}
out=[]
def label(d):
    return f"{d['year']}"+('補考' if d.get('session')!='regular' else '')
def split(t):
    t=re.sub(r'\s*\n\s*',' \n ',t)
    parts=[]
    for para in t.split('\n'):
        para=para.strip()
        if not para: continue
        parts+=re.split(r'(?:(?<=[.!?])|(?<=[.!?]["”’)]))\s+(?=[A-Z“"‘(\[<])',para)
    return [p.strip() for p in parts if p.strip()]
for f in sorted(glob.glob(R+'/gsat-*.json')):
    d=json.load(open(f)); ex=label(d)
    for s in d['sections']:
        if s['type'] not in SEC: continue
        sec=SEC[s['type']]
        for g in s['groups']:
            bank=g.get('options_bank') or {}
            ans={}
            for q in g['questions']:
                a=q.get('answer'); no=str(q.get('no'))
                if q.get('mode')=='single_choice' and q.get('options') and a in (q['options'] or {}): ans[no]=q['options'][a]
                elif q.get('mode')=='bank_choice' and a in bank: ans[no]=bank[a]
                elif q.get('mode')=='fill_in_blank' and isinstance(a,str): pass
            texts=[]
            if g.get('passage'): texts.append(g['passage'])
            for p in (g.get('passage_parts') or []):
                if p.get('text'): texts.append(p['text'])
            for t in texts:
                t=re.sub(r'\[\[(\d+)\]\]',lambda m:'<<'+ans[m.group(1)]+'>>' if m.group(1) in ans else '____',t)
                for sent in split(t):
                    out.append({'exam':ex,'sec':sec,'s':sent})
            if s['type']=='vocabulary':
                for q in g['questions']:
                    st=q.get('stem') or ''; a=q.get('answer'); o=q.get('options') or {}
                    if a in o and re.search(r'_{2,}',st):
                        st=re.sub(r'_{2,}','<<'+o[a]+'>>',st,count=1)
                        out.append({'exam':ex,'sec':sec,'s':' '.join(st.split())})
            elif s['type'] in('reading','mixed'):
                for q in g['questions']:
                    st=q.get('stem') or ''
                    if q.get('mode')=='single_choice' and re.search(r'[A-Za-z]{3}',st) and not re.search(r'[一-鿿]',st):
                        out.append({'exam':ex,'sec':sec,'s':' '.join(st.split())})
                        for k,v in (q.get('options') or {}).items():
                            if isinstance(v,str) and len(v.split())>=5: out.append({'exam':ex,'sec':sec,'s':v.strip()})
out=[o for o in out if 4<=len(o['s'].split())<=70 and not re.search(r'[一-鿿]',o['s'])]
seen=set(); res=[]
for o in out:
    k=(o['exam'],o['s'])
    if k in seen: continue
    seen.add(k); o['i']=len(res); res.append(o)
json.dump(res,open('/tmp/claude-0/v1000/work/corpus.json','w'),ensure_ascii=False)
import collections
print(len(res), collections.Counter(o['sec'] for o in res))
print(res[100],res[2000],sep='\n')
