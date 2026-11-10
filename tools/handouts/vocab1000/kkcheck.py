# 交叉核對：助手標的 KK × CMUdict 推出的 KK（正規化後比對音段與主重音位置）
import sys,json,re,glob
sys.path.insert(0,'/tmp/claude-0/v1000/pylib')
import cmudict
CMU=cmudict.dict()
V={'IY':'i','IH':'ɪ','EY':'e','EH':'ɛ','AE':'æ','AA':'ɑ','AO':'ɔ','OW':'o','UH':'ʊ','UW':'u','AY':'aɪ','AW':'aʊ','OY':'ɔɪ'}
C={'B':'b','CH':'tʃ','D':'d','DH':'ð','F':'f','G':'g','HH':'h','JH':'dʒ','K':'k','L':'l','M':'m','N':'n','NG':'ŋ','P':'p','R':'r','S':'s','SH':'ʃ','T':'t','TH':'θ','V':'v','W':'w','Y':'j','Z':'z','ZH':'ʒ'}
def cmu2(ph):
    out=[];stress=None;nv=0
    for p in ph:
        m=re.match(r'([A-Z]+)(\d)?',p); b,s=m.group(1),m.group(2)
        if s is None: out.append(C[b]); continue
        if b=='AH': v='ʌ' if s!='0' else 'ə'
        elif b=='ER': v='ɝ' if s!='0' else 'ɚ'
        elif b=='IY' and s=='0': v='ɪ'
        else: v=V[b]
        if s=='1' and stress is None: stress=nv
        nv+=1; out.append(v)
    return ''.join(out),stress,nv
def norm(k):
    k=k.replace('ˋ','').replace('ˏ','').replace('ḷ','əl').replace('ṇ','ən').replace('hw','w')
    k=k.replace('ɚ','ər').replace('ɝ','ər').replace('ʌ','ə')
    k=re.sub(r'j(?=[uʊ])','',k)
    k=k.replace('ɔr','or').replace('ir','ɪr').replace('ɪ','ə').replace('ɔ','ɑ').replace('ʊr','ur').replace('ʊ','u').replace('ɛr','er').replace('ær','er')
    k=re.sub(r'ə(?=[ln]$)','',k)  # 音節性子音
    k=k.replace('əl','l').replace('ən','n').replace('i','ə').replace('e','ɛ')
    return k
VOW='iɪeɛæɑɔoʊuʌəɝɚ'
def stress_idx(k):
    if 'ˋ' not in k: return None
    pre=k.split('ˋ')[0]; pre=pre.replace('aɪ','A').replace('aʊ','A').replace('ɔɪ','A')
    return sum(1 for ch in pre if ch in VOW+'A')+sum(1 for ch in pre if ch in 'ḷṇ')
KK={}
for f in sorted(glob.glob('/tmp/claude-0/v1000/work/kk-*.out.json')): KK.update(json.load(open(f)))
ALLOWED=set('iɪeɛæɑɔoʊuʌəɝɚabdfghjklmnprstvwzθðʃʒŋˋˏḷṇ')
bad=[];nocmu=[];mism=[]
for w,arr in sorted(KK.items()):
    for k in arr:
        if set(k)-ALLOWED: bad.append((w,k,''.join(sorted(set(k)-ALLOWED))))
        vs=CMU.get(w.lower())
        if not vs: nocmu.append((w,k)); continue
        cands=[cmu2(p) for p in vs]
        ok=False
        for c,st,nv in cands:
            if norm(c)==norm(k):
                si=stress_idx(k)
                if nv<=1 or si is None or si==st: ok=True
        if not ok: mism.append((w,k,' | '.join(c for c,_,_ in cands)))
print('words',len(KK),'bad symbols',bad)
print('no cmu',nocmu)
print('mismatch',len(mism))
for m in mism: print('  ',m)
