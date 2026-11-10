import json,re
lex={x['word']:x for x in json.load(open('/tmp/claude-0/v1000/work/lex.json'))}
V='aeiou'
def forms(w):
    f={w}|set(lex.get(w,{}).get('forms',[]))
    f|={w+'s',w+'ed',w+'ing',w+'d',w+'es',w+'er',w+'est',w+'ly'}
    if w.endswith('e'): f|={w[:-1]+'ing',w+'r',w+'st'}
    if w.endswith('y') and len(w)>2 and w[-2] not in V: f|={w[:-1]+'ies',w[:-1]+'ied',w[:-1]+'ier',w[:-1]+'iest',w[:-1]+'ily'}
    if len(w)>2 and w[-1] not in V+'wxy' and w[-2] in V and w[-3] not in V: f|={w+w[-1]+'ed',w+w[-1]+'ing',w+w[-1]+'er',w+w[-1]+'est'}
    return {x.lower() for x in f if ' ' not in x}
def rx(w):
    return re.compile(r"(?<![A-Za-z'\-])("+'|'.join(sorted(map(re.escape,forms(w)),key=len,reverse=True))+r")(?![A-Za-z])",re.I)
