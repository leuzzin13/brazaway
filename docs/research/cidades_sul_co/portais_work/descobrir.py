"""Fase A/B da descoberta: hosts candidatos de prefeitura e câmara por município; GET da home. Retomável (cache fetch.jsonl)."""
import json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse
from common import *
import common

WD = {}
def cands(m):
    uf = m['uf'].lower(); s = slug(m['nome']); sp = slug_sem_part(m['nome'])
    ss = {s, sp}
    pref, cam = [], []
    wd = WD.get(m['ibge']) or []
    for w in wd:
        if w:
            pref.append(('wikidata', w))
    for x in ss:
        for h in (f'www.{x}.{uf}.gov.br', f'{x}.{uf}.gov.br', f'pm{x}.{uf}.gov.br', f'prefeitura{x}.{uf}.gov.br',
                  f'{x}.atende.net', f'{x}.1doc.com.br', f'www.pm{x}.{uf}.gov.br'):
            pref.append(('padrao', 'https://' + h + '/'))
        for h in (f'{x}.{uf}.leg.br', f'www.{x}.{uf}.leg.br', f'camara{x}.{uf}.gov.br', f'www.camara{x}.{uf}.gov.br',
                  f'cm{x}.{uf}.gov.br', f'www.cm{x}.{uf}.gov.br', f'cm{x}.{uf}.leg.br', f'camaramunicipal{x}.{uf}.gov.br',
                  f'camara.{x}.{uf}.gov.br', f'camaramunicipal{x}.{uf}.leg.br', f'camaradevereadores{x}.{uf}.gov.br',
                  f'sapl.{x}.{uf}.leg.br', f'sapl.camara{x}.{uf}.gov.br', f'sapl.cm{x}.{uf}.gov.br',
                  f'cm{x}.1doc.com.br', f'camara{x}.1doc.com.br', f'{x}.siscam.com.br'):
            cam.append(('padrao', 'https://' + h + '/'))
    # remove duplicatas preservando ordem
    def uniq(l):
        v = set(); o = []
        for k, u in l:
            u = u.strip()
            if not u.startswith('http'):
                u = 'https://' + u
            u = re.sub(r'^http://', 'https://', u)
            if u not in v:
                v.add(u); o.append((k, u))
        return o
    return uniq(pref), uniq(cam)

def tarefa(arg):
    u = arg
    try:
        return get(u)
    except Exception as e:
        return {'url': u, 'err': str(e)}

if __name__ == '__main__':
    carrega_cache()
    WD = json.load(open(os.path.join(AQUI, 'wikidata_sites.json')))
    ms = municipios()
    urls = []
    for m in ms:
        p, c = cands(m)
        urls += [u for _, u in p] + [u for _, u in c]
    urls = list(dict.fromkeys(urls))
    todo = [u for u in urls if u not in common._cache]
    print(len(urls), 'urls;', len(todo), 'a fazer', flush=True)
    n = 0
    with ThreadPoolExecutor(int(os.environ.get('T', '40'))) as ex:
        for r in ex.map(tarefa, todo):
            n += 1
            if n % 2000 == 0:
                print(n, flush=True)
    print('fim')
