#!/usr/bin/env python3
"""Querido Diario (api.queridodiario.org.br) - termos de restricao de caminhoes nos municipios Sul/CO cobertos.
Cobertura = municipios de municipios.csv que a API lista com level>0 ou availability_date (/cities).
Cache por (ibge,termo) em qd_raw/<ibge>__<n>.json (retomavel). Pos-processo: qd_pos.py"""
import csv, json, os, sys, time, threading, urllib.parse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
BASE=os.path.dirname(os.path.abspath(__file__)); CID=os.path.dirname(BASE)
RAW=os.path.join(BASE,'qd_raw'); os.makedirs(RAW,exist_ok=True)
API='https://api.queridodiario.org.br'
UA='truck-router-pesquisa/1.0 (restricoes de caminhoes; contato arthureggerleuzzi@gmail.com)'
TERMOS=['caminhões + circulação','"veículos pesados"','"carga e descarga"','VUC','"zona de restrição"',
        '"trânsito pesado"','toneladas + caminhões + trânsito','"veículos de carga"']
mun={r[0]:r for r in csv.reader(open(os.path.join(CID,'municipios.csv'),encoding='utf-8'),delimiter=';') if r[0].isdigit()}
lock=threading.Lock(); last=[0.0]
def get(path,params,tent=7):
    url=API+path+'?'+urllib.parse.urlencode(params)
    for t in range(tent):
        with lock:
            w=0.4-(time.time()-last[0]); last[0]=time.time()+max(w,0)
        if w>0: time.sleep(w)
        try:
            with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':UA}),timeout=150) as r:
                return json.loads(r.read())
        except Exception as e:
            time.sleep(min(8*(t+1),60))
    return None
def cidades():
    fn=os.path.join(RAW,'cities.json')
    if not os.path.exists(fn):
        d=get('/cities',{'city_name':''}); json.dump(d,open(fn,'w'),ensure_ascii=False)
    d=json.load(open(fn))['cities']
    return [c for c in d if c['territory_id'] in mun and (c.get('availability_date') or c.get('level') not in ('0',0,None))]
def job(a):
    ib,n=a; fn=os.path.join(RAW,f'{ib}__{n}.json')
    if os.path.exists(fn): return
    d=get('/gazettes',{'territory_ids':ib,'querystring':TERMOS[n],'size':10,'excerpt_size':450,'number_of_excerpts':3,'sort_by':'relevance'})
    if d is None: print('FALHA',ib,n,flush=True); return
    json.dump({'ibge':ib,'termo':TERMOS[n],'total':d.get('total_gazettes',0),'gazettes':d.get('gazettes',[])},open(fn+'.tmp','w'),ensure_ascii=False)
    os.replace(fn+'.tmp',fn)
if __name__=='__main__':
    cs=cidades(); print('cobertos',len(cs),flush=True)
    jobs=[(c['territory_id'],n) for n in range(len(TERMOS)) for c in cs]
    with ThreadPoolExecutor(14) as ex: list(ex.map(job,jobs))
    print('fim; arquivos',len(os.listdir(RAW)),flush=True)
