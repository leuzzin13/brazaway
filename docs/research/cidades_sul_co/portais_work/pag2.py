"""Fase C: segue links de legislação das homes. Retomável."""
import json, os
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
from common import *
import common
from fp import *
common.carrega_cache()
S = json.load(open(os.path.join(AQUI, 'sites.json')))
urls = []
for ib, v in S.items():
    for org in ('prefeitura', 'camara'):
        for e in v[org][:2]:
            r = common._cache.get(e['req'])
            if not r or not r['h']: continue
            for u, t, sc in links_leg(common.html_de(r), r['final'])[:4]:
                urls.append(u)
urls = list(dict.fromkeys(urls)); todo = [u for u in urls if u not in common._cache]
print(len(urls), len(todo), flush=True)
def f(u):
    try: return get(u)
    except Exception as e: return None
with ThreadPoolExecutor(32) as ex:
    list(ex.map(f, todo))
print('fim')
