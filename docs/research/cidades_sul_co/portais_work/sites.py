"""Seleciona sites vivos e válidos de prefeitura e câmara por município -> sites.json"""
import json, os, re
from urllib.parse import urlparse
from common import *
import common, descobrir, descobrir2
from fp import *

carrega = common.carrega_cache()
descobrir.WD = json.load(open(os.path.join(AQUI, 'wikidata_sites.json')))
UFN = {'PR','SC','RS','GO','MT','MS','DF'}
BLOQ = re.compile(r'Bot Verification|Attention Required|Just a moment|Access Denied|Anubis|Cloudflare', re.I)

UFS = ('PR','SC','RS','GO','MT','MS','DF','SP','MG','RJ','ES','BA','SE','AL','PE','PB','RN','CE','PI','MA','PA','AP','AM','RR','RO','AC','TO')
def uf_evid(m, h):
    """UFs que aparecem junto ao nome do município (Nome/UF, Nome - UF, Nome, UF) no HTML."""
    nome = re.escape(sem_acento(m['nome']).lower()).replace('\\ ', r'\s+')
    t = sem_acento(h).lower()
    return {u.upper() for u in re.findall(nome + r'\s*(?:/|-|,|&ndash;|&#8211;|–)\s*(' + '|'.join(x.lower() for x in UFS) + r')\b', t)}

def txt_ok(m, r):
    """valida que a página é do município (nome no título/corpo) e do estado quando o domínio não traz a UF."""
    h = common.html_de(r)
    t = sem_acento((r['title'] + ' ' + h[:60000])).lower()
    nome = sem_acento(m['nome']).lower()
    host = urlparse(r['final']).hostname or ''
    if r['title'] and re.search(r'1doc - erro|404|n[ãa]o encontrad|domain|dominio|parked|hospedagem', sem_acento(r['title']).lower()) and nome not in t:
        return False, False
    if not (nome in t or nome.replace('-', ' ') in t):
        return False, False
    uf_no_dominio = re.search(r'\.(%s)\.(gov|leg)\.br$' % m['uf'].lower(), host) is not None
    if uf_no_dominio:
        return True, False
    ev = uf_evid(m, h[:400000] + ' ' + r['title'])
    if ev:
        return (m['uf'] in ev), False
    saas = re.search(r'atende\.net|1doc\.com\.br|siscam\.com\.br|cittatec|megasoft|camarasempapel|nopapercloud|cespro|betha|eloweb|elotech', host)
    return (True, True) if saas else (False, False)

def eh_camara(r, url):
    t = sem_acento(r['title']).lower(); h = urlparse(url).hostname or ''
    return bool(re.search(r'camara|\bcm[a-z]|\.leg\.br|sapl\.', t + ' ' + h)) and not re.search(r'prefeitura', t)

def main():
    ms = municipios(); out = {}
    for m in ms:
        p, c = descobrir.cands(m)
        for u in descobrir2.extra(m, True, True):
            if re.search(r'//(www\.)?(camara|cm[a-z]|legislativo\.|sapl\.|acessoainformacao\.camara)|camaramunicipal|camarade|\.leg\.br', u):
                c.append(('extra', u))
            else:
                p.append(('extra', u))
        sel = {'prefeitura': [], 'camara': []}
        for org, lst in (('prefeitura', p), ('camara', c)):
            for k, u in lst:
                r = common._cache.get(u)
                if not r or r['nx'] or not r['status']:
                    continue
                if r['status'] >= 500 or r['status'] == 404 or r['status'] == 400:
                    continue
                bloq = r['status'] == 403 or bool(BLOQ.search(r['title']))
                ok, verif = (True, False) if bloq else txt_ok(m, r)
                if not ok:
                    continue
                real = 'camara' if (org == 'camara' or eh_camara(r, r['final'])) else 'prefeitura'
                if org == 'prefeitura' and 'padrao' == k and real == 'camara' and not re.search(r'camara|cm', urlparse(u).hostname or ''):
                    pass
                e = {'url': r['final'], 'req': u, 'origem': k, 'status': r['status'], 'bloqueado': bloq, 'title': r['title'][:80], 'verificar': verif}
                if not any(x['url'].rstrip('/') == e['url'].rstrip('/') for x in sel[real]):
                    sel[real].append(e)
        out[m['ibge']] = sel
    json.dump(out, open(os.path.join(AQUI, 'sites.json'), 'w'), ensure_ascii=False)
    import collections
    print('com prefeitura', sum(1 for v in out.values() if v['prefeitura']), 'com camara', sum(1 for v in out.values() if v['camara']),
          'sem nada', sum(1 for v in out.values() if not v['prefeitura'] and not v['camara']))
    by = collections.Counter(m['uf'] for m in ms if not out[m['ibge']]['prefeitura'])
    print('sem prefeitura por UF', by)
    by = collections.Counter(m['uf'] for m in ms if not out[m['ibge']]['camara'])
    print('sem camara por UF', by)
main()
