import json,re,collections
from urllib.parse import urlparse
import common
from common import *
from fp import *
common.carrega_cache()
S=json.load(open('sites.json')); M={m['ibge']:m for m in municipios()}
def tmpl(u,m):
    p=urlparse(u); h=p.hostname or ''
    for s in sorted({slug(m['nome']),slug_sem_part(m['nome'])},key=len,reverse=True):
        h=h.replace(s,'{m}')
    h=re.sub(r'\.(pr|sc|rs|go|mt|ms|df)\.','.{uf}.',h)
    path='/'.join(p.path.split('/')[:3])
    return h+path
C=collections.Counter(); ex={}
for ib,v in S.items():
    m=M[ib]
    for org in ('prefeitura','camara'):
        for e in v[org][:1]:
            r=common._cache[e['req']]
            for u,t,sc in links_leg(common.html_de(r),r['final'])[:3]:
                rr=common._cache.get(u)
                if not rr or rr['status']!=200: continue
                k=(org,tmpl(rr['final'],m)); C[k]+=1; ex.setdefault(k,rr['final'])
for k,n in C.most_common(120): print(n,k,ex[k][:90])
