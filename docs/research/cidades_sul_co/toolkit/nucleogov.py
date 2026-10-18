#!/usr/bin/env python3
"""Cliente da API pública dos diários oficiais NucleoGov (GO): https://dom.<dominio>/api/...

Descoberto na R4 (2026-10-18): o portal acessoainformacao.<m>.go.gov.br dá 403, mas o diário
`dom.<dominio>` expõe JSON sem autenticação (Laravel, ratelimit 150/min):
  /api/diarios?per_page=N&page=P         -> edições (numero, data, ...); ordem decrescente por data
  /api/materias?search=<termo>&per_page=50&page=P -> matérias com 'texto' (HTML integral), 'titulo',
                                            'tipo.descricao', 'orgao.descricao', 'diario.data'
  /api/orgaos                            -> árvore de órgãos
  (/api/legislacao, /api/leis, /api/atos, /api/normas, /api/tipos devolvem o HTML da SPA: não são API.)
A busca é por texto (acento: use as duas grafias). `search` sem filtro de data; o acervo vai da
última página de /api/diarios (mais antiga) até a primeira (mais nova).

Uso:
  python3 nucleogov.py descobrir <ibge|nome> ...        # acha o domínio e a faixa do acervo
  python3 nucleogov.py buscar <ibge> [--termos a,b,c] [--saida arq.json]
  python3 nucleogov.py lote <fila.json> <diretorio_saida> [--workers 6]
Como módulo: descobrir(nome, sites) -> base|None; acervo(base); buscar(base, termo); relevante(m)
"""
import json, re, sys, time, unicodedata, threading, os, urllib.request, urllib.parse, ssl
HERE = os.path.dirname(os.path.abspath(__file__))
PORTAIS = os.path.join(HERE, '..', 'leads', 'portais.json')
TERMOS = ['caminhões', 'caminhoes', 'veículos pesados', 'veiculos pesados', 'trânsito pesado',
          'transito pesado', 'toneladas', 'eixos', 'carga e descarga', 'tráfego de caminhões']
_last = {}; _lock = threading.Lock()

def _get(url, tentativas=3):
    host = urllib.parse.urlparse(url).netloc
    for t in range(tentativas):
        with _lock:
            w = _last.get(host, 0) + 1.0 - time.time()
            _last[host] = time.time() + max(w, 0)
        if w > 0: time.sleep(w)
        try:
            rq = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0 pesquisa-municipal'})
            with urllib.request.urlopen(rq, timeout=30) as r:
                return r.status, r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(20); continue
            return e.code, ''
        except Exception as e:
            err = str(e)
            time.sleep(2)
    return 0, ''

def sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

def slug(nome):
    return re.sub(r'[^a-z0-9]', '', sem_acento(nome).lower())

def candidatos(nome, sites=None):
    s = slug(nome); c = []
    def add(h):
        if h and h not in c: c.append(h)
    for k, u in (sites or {}).items():
        if not u: continue
        h = urllib.parse.urlparse(u if '//' in u else '//' + u).netloc.lower()
        h = re.sub(r'^(www|acessoainformacao)\.', '', h)
        if h.startswith('camara'): h = h  # camara<x>.go.gov.br
        add('dom.' + h)
    add(f'dom.{s}.go.gov.br'); add(f'dom.{s}.go.leg.br')
    for pre in ('de', 'do', 'da'):
        pass
    add(f'dom.{s.replace("dogoias","").replace("degoias","")}.go.gov.br')
    add(f'dom.{s}.go.gov.br')
    return c

def ehapi(host):
    st, body = _get(f'https://{host}/api/diarios?per_page=1&page=1', 1)
    if st != 200: return None
    try:
        d = json.loads(body)
        return d if 'data' in d and 'total' in d else None
    except Exception:
        return None

def descobrir(nome, sites=None):
    """devolve lista de bases (hosts) cujo /api/diarios responde"""
    out = []
    for h in candidatos(nome, sites):
        d = ehapi(h)
        if d is not None: out.append(h)
    return out

def acervo(host):
    d = ehapi(host)
    if not d: return None
    tot = d['total']; ult = d['data'][0]['data'] if d['data'] else None
    pri = None
    if tot:
        st, b = _get(f'https://{host}/api/diarios?per_page=1&page={tot}')
        try: pri = json.loads(b)['data'][0]['data']
        except Exception: pass
    st, b = _get(f'https://{host}/api/materias?per_page=1&page=1')
    try: nm = json.loads(b)['total']
    except Exception: nm = None
    return {'host': host, 'diarios': tot, 'primeiro': pri, 'ultimo': ult, 'materias': nm}

def buscar(host, termo, maximo=300):
    """todas as matérias que casam com o termo (paginado, 50 por página)"""
    res = []; p = 1
    while len(res) < maximo:
        q = urllib.parse.urlencode({'search': termo, 'per_page': 50, 'page': p})
        st, b = _get(f'https://{host}/api/materias?{q}')
        if st != 200: break
        try: d = json.loads(b)
        except Exception: break
        res += d.get('data', [])
        if p >= d.get('last_page', 1): break
        p += 1
    return res

def texto(m):
    t = re.sub(r'<[^>]+>', ' ', m.get('texto') or '')
    t = re.sub(r'&nbsp;', ' ', t); t = re.sub(r'&[a-z]+;', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()

RE_VEIC = re.compile(r'caminh|ve[ií]culos? (de )?(carga|pesad)|pesados|tonelad|eixos?\b|carreta|bitrem|rodotrem|\bVUC\b', re.I)
RE_REST = re.compile(r'proib|vedad|vedac|restri|interdi|limit|rotas?\b|zona|perímetro|perimetro|circula|tr[aâ]nsito|estacion|carga e descarga', re.I)
RE_RUIDO = re.compile(r'preg[aã]o|registro de pre[cç]os|licita|contrata[cç][aã]o|dispensa|inexigibilidade|ata de|aditivo|extrato de contrato|homologa|locação|locacao|aquisi[cç]|ordem de servi', re.I)

def relevante(m):
    """pontuação: matéria normativa (lei/decreto/portaria) com veículo pesado + restrição; ruído de licitação rebaixa"""
    t = texto(m); ti = (m.get('titulo') or '') + ' ' + ((m.get('tipo') or {}).get('descricao') or '')
    s = 0
    if RE_VEIC.search(t): s += 1
    if RE_VEIC.search(t) and RE_REST.search(t): s += 1
    if re.search(r'\b(lei|decreto|portaria|resolu[cç][aã]o)\b', ti, re.I): s += 2
    if RE_RUIDO.search(ti): s -= 3
    return s

def resumo(m, termo=None, janela=160):
    t = texto(m); mm = RE_VEIC.search(t); i = mm.start() if mm else 0
    return {'id': m['id'], 'titulo': (m.get('titulo') or '')[:160], 'tipo': (m.get('tipo') or {}).get('descricao'),
            'orgao': (m.get('orgao') or {}).get('descricao'), 'data': (m.get('diario') or {}).get('data') or m.get('data_legacy'),
            'diario': (m.get('diario') or {}).get('numero'), 'score': relevante(m),
            'trecho': t[max(0, i - janela): i + janela], 'n': len(t)}

def varrer(host, termos=TERMOS, guardar_texto=False):
    vistos = {}
    contagem = {}
    for tm in termos:
        r = buscar(host, tm); contagem[tm] = len(r)
        for m in r:
            if m['id'] not in vistos:
                vistos[m['id']] = m
    itens = sorted((resumo(m) for m in vistos.values()), key=lambda x: -x['score'])
    if guardar_texto:
        for it in itens: it['texto'] = texto(vistos[it['id']])
    return contagem, itens

def main():
    a = sys.argv[1:]
    if not a: print(__doc__); return
    P = json.load(open(PORTAIS))
    if a[0] == 'descobrir':
        for x in a[1:]:
            p = P.get(x, {}); nome = p.get('nome', x)
            for h in descobrir(nome, p.get('sites')):
                print(x, nome, json.dumps(acervo(h), ensure_ascii=False))
    elif a[0] == 'buscar':
        ib = a[1]; p = P[ib]; hs = descobrir(p['nome'], p.get('sites'))
        termos = TERMOS
        if '--termos' in a: termos = a[a.index('--termos') + 1].split(',')
        for h in hs:
            c, it = varrer(h, termos, guardar_texto='--saida' in a)
            print(h, c)
            for i in it[:15]: print(i['score'], i['data'], i['tipo'], i['titulo'][:90], i['id'])
            if '--saida' in a: json.dump({'host': h, 'contagem': c, 'itens': it}, open(a[a.index('--saida') + 1], 'w'), ensure_ascii=False)
    elif a[0] == 'lote':
        from concurrent.futures import ThreadPoolExecutor
        fila = json.load(open(a[1]))['cidades']; out = a[2]; os.makedirs(out, exist_ok=True)
        w = int(a[a.index('--workers') + 1]) if '--workers' in a else 6
        def um(c):
            p = P.get(c['ibge'], {}); hs = descobrir(c['nome'], p.get('sites'))
            r = {'ibge': c['ibge'], 'nome': c['nome'], 'hosts': []}
            for h in hs:
                cont, it = varrer(h, TERMOS, True)
                r['hosts'].append({'host': h, 'acervo': acervo(h), 'contagem': cont, 'itens': it})
            json.dump(r, open(os.path.join(out, c['ibge'] + '.json'), 'w'), ensure_ascii=False)
            print(c['ibge'], c['nome'], [(h['host'], h['acervo'] and (h['acervo']['primeiro'], h['acervo']['ultimo']), sum(h['contagem'].values())) for h in r['hosts']], flush=True)
        with ThreadPoolExecutor(w) as ex: list(ex.map(um, fila))

if __name__ == '__main__': main()
