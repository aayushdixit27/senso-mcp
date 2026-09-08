import json, re, urllib.request, concurrent.futures as cf, random, collections
UA={'User-Agent':'senso-cta-audit/0.2'}
def get(u, t=30):
    try:
        r=urllib.request.Request(u, headers=UA)
        with urllib.request.urlopen(r, timeout=t) as f: return f.read().decode('utf-8','replace')
    except Exception: return ''
urls=[]
per={}
for dom in ['codeables.dev','cited.md']:
    root=get(f'https://{dom}/sitemap.xml')
    locs=re.findall(r'<loc>\s*([^<]+?)\s*</loc>', root)
    subm=[u for u in locs if u.endswith('.xml')]
    arts=[u for u in locs if '/article/' in u]
    print(f'{dom}: {len(subm)} child sitemaps')
    with cf.ThreadPoolExecutor(16) as ex:
        for txt in ex.map(get, subm):          # NO CAP
            arts += [u for u in re.findall(r'<loc>\s*([^<]+?)\s*</loc>', txt) if '/article/' in u]
    arts=list(dict.fromkeys(arts))
    per[dom]=len(arts)
    print(f'{dom}: {len(arts)} unique /article/ URLs')
    urls += arts
print('TOTAL article URLs:', len(urls))
random.seed(101)
sample=random.sample(urls, 400)
def actions(u):
    h=get(u); found=[]
    for b in re.findall(r'<script[^>]*application/ld\+json[^>]*>([\s\S]*?)</script>', h, re.I):
        try: o=json.loads(b)
        except Exception: continue
        st=[o]
        while st:
            c=st.pop()
            if isinstance(c,dict):
                pa=c.get('potentialAction')
                if pa:
                    for a in (pa if isinstance(pa,list) else [pa]):
                        if isinstance(a,dict): found.append((a.get('name',''),a.get('target','')))
                st+=list(c.values())
            elif isinstance(c,list): st+=c
    return u,found,bool(h)
cnt=collections.Counter(); noact=0; unread=0
with cf.ThreadPoolExecutor(14) as ex:
    for u,f,okk in ex.map(actions, sample):
        if not okk: unread+=1; continue
        if not f: noact+=1
        for n,tg in f: cnt[(n,tg)]+=1
print(f'\nsampled {len(sample)}; {unread} unreadable; {noact} declared no action\n')
for (n,tg),c in cnt.most_common(): print(f'  {c:4d}  "{n}" -> {tg}')
json.dump({'per':per,'total':len(urls),'counts':{f'{n}|{t}':c for (n,t),c in cnt.items()},'noact':noact,'unread':unread,'n':len(sample)}, open('scan2.json','w'))
