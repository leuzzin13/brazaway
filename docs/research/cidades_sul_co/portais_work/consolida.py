"""classif.json (+ smoke.jsonl) -> ../leads/portais.json (formato novo + 'fontes' compatível com toolkit/legislacao.py)."""
import json, os, re, collections, sys
from urllib.parse import urlparse
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'toolkit'))
from common import *
import classifica
import legislacao as L

CL = json.load(open(os.path.join(AQUI, 'classif.json'))); S = json.load(open(os.path.join(AQUI, 'sites.json')))
M = {m['ibge']: m for m in municipios()}
SMOKE = {}
sp = os.path.join(AQUI, 'smoke.jsonl')
if os.path.exists(sp):
    for l in open(sp):
        try:
            r = json.loads(l); SMOKE[(r['ibge'], r['orgao'], r['sistema'], r['base'])] = r
        except Exception: pass
SEM_CLIENTE_REAL = {'atende', 'nucleogov', 'cespro', 'leismunicipais', '1doc', 'betha', 'equiplano', 'epublica', 'sicam', 'cidade360', 'digifred',
                    'cittatec', 'desconhecido'}
OBS = {
 'atende': 'IPM Atende.net: módulo "Consulta Legislação Municipal" é SPA com captcha/anti-robô; abrir manualmente em url_busca (client só confirma o módulo)',
 'nucleogov': 'NucleoGov: listagem de atos por JavaScript; sem cliente (host bloqueou o IP da pesquisa após o mapeamento)',
 'cespro': 'CESPRO: pesquisa com reCAPTCHA; sem automação',
 'leismunicipais': 'Leis Municipais: Cloudflare (403) para curl/WebFetch; sem automação',
 '1doc': '1Doc: portal/gestão documental; sem busca de legislação automática (conferir publicações no site)',
 'cittatec': 'Cittatec: portal Angular (API /api/conecta); sem cliente',
 'desconhecido': 'site achado mas sem página de legislação identificada (ou bloqueado por WAF)',
}
def tem_cliente(s):
    return s in L.CLIENTES and s not in SEM_CLIENTE_REAL

def fonte(ib, org, c):
    f = {'orgao': org, 'sistema': c['sistema'], 'base': c['base'], 'url_busca': c['url_busca'], 'evidencia': c['evidencia'],
         'cliente': tem_cliente(c['sistema']), 'testado': None}
    if c.get('plataforma'): f['plataforma'] = c['plataforma']
    if c.get('verificar'): f['verificar'] = True
    if c['sistema'] in OBS: f['obs'] = OBS[c['sistema']]
    sm = SMOKE.get((ib, org, c['sistema'], c['base']))
    if sm and f['cliente']:
        f['testado'] = bool(sm['ok']); f['teste'] = {k: sm[k] for k in ('termo', 'total', 'quando', 'erro') if k in sm}
        if sm.get('obs'):
            f['obs'] = sm['obs']
            ufs = set(re.findall(r'/([A-Z]{2})\b', sm['obs']))
            if ufs and M[ib]['uf'] not in ufs:   # homônimo de outro estado (ex.: palmeira.eloweb.net)
                f['descartar'] = True
    return f

def main():
    out = {}; cnt = collections.Counter()
    for ib, m in M.items():
        v = CL[ib]; fontes = []
        for org in ('camara', 'prefeitura'):
            c = v[org]
            if not c['sistema']: continue
            fontes.append(fonte(ib, org, c))
            for a in c['alternativas']:
                if a['sistema'] in classifica.ESPEC + classifica.SAAS:
                    fa = fonte(ib, org, {'sistema': a['sistema'], 'base': classifica.base_de(a['sistema'], a['url']), 'url_busca': a['url'], 'evidencia': [a['ev']],
                                         'plataforma': '', 'verificar': False})
                    if not any(x['sistema'] == fa['sistema'] and x['base'] == fa['base'] for x in fontes):
                        fontes.append(fa)
        def chave(f):  # melhor fonte primeiro: testada ok > com cliente > específico
            return (0 if f['testado'] else 1 if f['cliente'] else 2, classifica.ordem(f['sistema']), 0 if f['orgao'] == 'camara' else 1)
        fontes = [f for f in fontes if not f.get('descartar')]
        fontes.sort(key=chave)
        pri = fontes[0] if fontes else None
        reg = {'nome': m['nome'], 'uf': m['uf'],
               'sistema_prefeitura': v['prefeitura']['sistema'] or ('inacessivel' if v['prefeitura']['home'] else 'nao_encontrado'),
               'sistema_camara': v['camara']['sistema'] or ('inacessivel' if v['camara']['home'] else 'nao_encontrado'),
               'url_busca': pri['url_busca'] if pri else None,
               'testado': bool(pri and pri['testado']),
               'sistema': pri['sistema'] if pri else 'nao_encontrado', 'orgao': pri['orgao'] if pri else None,
               'cliente': bool(pri and pri['cliente']),
               'sites': {o: (S[ib][o][0]['url'] if S[ib][o] else None) for o in ('prefeitura', 'camara')},
               'url_busca_prefeitura': v['prefeitura']['url_busca'], 'url_busca_camara': v['camara']['url_busca'],
               'fontes': fontes}
        if ib == '5300108':   # Brasília: não há prefeitura/câmara municipal; correção manual
            reg['sistema_prefeitura'] = reg['sistema_camara'] = 'manual'
            reg['fontes'] = [{'orgao': 'prefeitura', 'sistema': 'manual', 'base': 'https://www.sinj.df.gov.br/sinj/', 'url_busca': 'https://www.sinj.df.gov.br/sinj/',
                              'evidencia': ['manual'], 'cliente': False, 'testado': None,
                              'obs': 'DF não tem prefeitura nem câmara municipal: normas distritais no SINJ-DF (403 para robôs neste ambiente); DODF www.dodf.df.gov.br; Câmara Legislativa www.cl.df.gov.br (não responderam a esta pesquisa)'}]
            reg.update({'url_busca': 'https://www.sinj.df.gov.br/sinj/', 'sistema': 'manual', 'orgao': 'prefeitura', 'cliente': False, 'testado': False})
        out[ib] = reg
        cnt['pri:' + reg['sistema']] += 1
    json.dump(out, open(os.path.join(CID, 'leads', 'portais.json'), 'w'), ensure_ascii=False, indent=0)
    n = len(out)
    print(n, 'municípios;', 'testado', sum(1 for r in out.values() if r['testado']), 'cliente', sum(1 for r in out.values() if r['cliente']),
          'nenhuma fonte', sum(1 for r in out.values() if not r['fontes']))
    for k, v in cnt.most_common(): print(k, v)
main()
