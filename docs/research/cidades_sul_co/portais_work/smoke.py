"""Teste de fumaça dos clientes (legislacao.py) em cada fonte com cliente. Retomável -> smoke.jsonl. Env: REFAZ=1, SO=<sistema>, T=threads"""
import json, os, sys, time, threading
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'toolkit'))
import legislacao as L
AQUI = os.path.dirname(os.path.abspath(__file__)); CID = os.path.dirname(AQUI)
P = json.load(open(os.path.join(CID, 'leads', 'portais.json')))
SP = os.path.join(AQUI, 'smoke.jsonl')
feitos = set()
if os.path.exists(SP) and not os.environ.get('REFAZ'):
    for l in open(SP):
        try:
            r = json.loads(l); feitos.add((r['ibge'], r['orgao'], r['sistema'], r['base']))
        except Exception: pass
SEM = {'atende', 'nucleogov', 'cespro', 'leismunicipais', '1doc', 'betha', 'equiplano', 'epublica', 'sicam', 'cidade360', 'digifred', 'cittatec', 'desconhecido'}
tarefas = []
for ib, p in P.items():
    for f in p['fontes']:
        if f['sistema'] in L.CLIENTES and f['sistema'] not in SEM and (ib, f['orgao'], f['sistema'], f['base']) not in feitos:
            if os.environ.get('SO') and f['sistema'] != os.environ['SO']: continue
            tarefas.append((ib, f))
print(len(tarefas), 'a testar', flush=True)
lk = threading.Lock(); hl = {}
def host_lock(h):
    with lk: return hl.setdefault(h, threading.Lock())
def run(t):
    ib, f = t
    h = urlparse(f['base']).netloc
    with host_lock(h):
        t0 = time.time()
        try:
            r = L.buscar_em(f['sistema'], f['base'], ['trânsito'], 5)
        except Exception as e:
            r = {'erro': 'EXC ' + repr(e)[:150], 'total': 0, 'termos': {}}
        time.sleep(1.0)
    ok = not r.get('erro')
    if f['sistema'] in ('portal_proprio',) and ok and not r.get('atos'):
        ok = False; r['erro'] = 'heurístico: nenhum ato extraído'
    rec = {'ibge': ib, 'orgao': f['orgao'], 'sistema': f['sistema'], 'base': f['base'], 'ok': ok, 'termo': 'trânsito',
           'total': r.get('termos', {}).get('trânsito', r.get('total', 0)), 'quando': time.strftime('%Y-%m-%d'), 'seg': round(time.time() - t0, 1)}
    if r.get('erro'): rec['erro'] = str(r['erro'])[:200]
    if r.get('obs'): rec['obs'] = str(r['obs'])[:200]
    with lk:
        with open(SP, 'a') as fh: fh.write(json.dumps(rec, ensure_ascii=False) + '\n')
    return rec
with ThreadPoolExecutor(int(os.environ.get('T', '14'))) as ex:
    res = list(ex.map(run, tarefas))
import collections
c = collections.Counter((r['sistema'], r['ok']) for r in res)
print(sorted(c.items()))
print('fim')
