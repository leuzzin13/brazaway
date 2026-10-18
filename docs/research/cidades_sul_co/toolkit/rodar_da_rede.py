#!/usr/bin/env python3
"""rodar_da_rede.py — refaz, a partir da rede residencial do Arthur (Mac), as consultas que a nuvem não alcançou.

Lê ../falhas_de_fonte.json (cidades com falha_de_fonte=true), ../res/<ibge>.json (observações e URLs que bloquearam) e
../leads/portais.json (sistemas/URLs de cada município) e grava ../leads/rede_arthur/<ibge>.json + resumo.

Fontes (--so):
  qd           Querido Diário (api.queridodiario.org.br/gazettes) — 5 termos por cidade
  leis         leismunicipais.com.br / leis.org — só testa se a página abre e gera os links de busca (sem formato de busca
               conhecido; o site é Cloudflare: se abrir no navegador, pesquise lá)
  nucleogov    GO: API JSON do diário dom.<dominio> (toolkit/nucleogov.py) + links acessoainformacao.<m>.go.gov.br
  legislacao   reaplica os clientes do toolkit (legislacao.py) nas fontes do município que têm cliente (sapl, webline,
               elotech, instar, portal_proprio ...) — para sites que deram 403/timeout ao IP da nuvem
  manual       NÃO automatiza CESPRO, Atende.net e 1doc (captcha/login): só gera _manual.html e _manual.csv com os links
  insumos      (não é por cidade) baixa na sua rede os arquivos brutos do SNV/DNIT e do PMQC/ANP — ver R2_REDE_ARTHUR.md

Uso:
  python3 rodar_da_rede.py --teste                  # 3 cidades, saída em leads/rede_arthur/_teste/
  python3 rodar_da_rede.py                          # tudo (retomável: rode de novo se cair)
  python3 rodar_da_rede.py --uf GO,MS --so qd,nucleogov --limite 20
  python3 rodar_da_rede.py --contagem               # só a tabela UF x bloqueio (não faz nenhum pedido)
  python3 rodar_da_rede.py --refazer-erros          # repete o que ficou com erro no cache
  python3 rodar_da_rede.py --so insumos             # SNV + PMQC brutos em <repo>/data/cache/

Só biblioteca padrão (usa `requests` se estiver instalado). >= 1 s entre pedidos ao mesmo host. Cache em disco por
cidade/fonte (leads/rede_arthur/_cache/<fonte>/<ibge>.json): interrompa com Ctrl-C e rode de novo.
"""
import argparse, base64, csv, html, json, os, re, sys, time, unicodedata
import urllib.error, urllib.parse, urllib.request
from collections import Counter, defaultdict
from datetime import datetime

AQUI = os.path.dirname(os.path.abspath(__file__))
CID = os.path.dirname(AQUI)
REPO = os.path.abspath(os.path.join(CID, '..', '..', '..'))
sys.path.insert(0, AQUI)

try:
    import requests  # opcional
except Exception:  # noqa: BLE001
    requests = None

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
      'Chrome/126.0 Safari/537.36')
INTERVALO = 1.0  # s entre pedidos ao mesmo host
QD_API = 'https://api.queridodiario.org.br/gazettes'
QD_TERMOS = ['caminhões', 'veículos pesados', 'trânsito pesado', 'toneladas', 'carga e descarga']
TERMOS_LEG = ['caminh', 'carga e descarga', 'veículos pesados', 'veiculos pesados', 'trânsito pesado', 'tonelad']
FONTES = ['qd', 'leis', 'nucleogov', 'legislacao', 'manual']
SEM_CLIENTE = {'atende', 'cespro', '1doc', 'leismunicipais', 'nucleogov', 'cittatec', 'desconhecido', 'nao_encontrado',
               'manual', 'plenus', 'diario', 'betha', 'cidade360', 'digifred', 'sicam', None, ''}

SAIDA = os.path.join(CID, 'leads', 'rede_arthur')


# ----------------------------------------------------------------------------- utilidades
def agora():
    return datetime.now().astimezone().isoformat(timespec='seconds')


def sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s or '') if unicodedata.category(c) != 'Mn')


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', sem_acento(s).lower()).strip('-')


def host_de(u):
    return urllib.parse.urlparse(u if '//' in u else '//' + u).netloc.lower()


_ultimo = {}


def espera(host):
    t = _ultimo.get(host, 0) + INTERVALO - time.time()
    if t > 0:
        time.sleep(t)
    _ultimo[host] = time.time()


def get(url, timeout=60, headers=None, metodo='GET', auth=None, corpo=None):
    """GET com >= 1 s entre pedidos ao host. Devolve (status, bytes, erro). Nunca levanta exceção."""
    espera(host_de(url))
    h = {'User-Agent': UA, 'Accept': 'application/json, text/html;q=0.9, */*;q=0.5', 'Accept-Language': 'pt-BR,pt;q=0.9'}
    h.update(headers or {})
    if auth:
        h['Authorization'] = 'Basic ' + base64.b64encode(('%s:%s' % auth).encode()).decode()
    try:
        if requests is not None:
            r = requests.request(metodo, url, headers=h, timeout=timeout, data=corpo, allow_redirects=True)
            return r.status_code, r.content, None
        rq = urllib.request.Request(url, headers=h, method=metodo, data=corpo)
        with urllib.request.urlopen(rq, timeout=timeout) as r:
            return r.status, r.read(), None
    except urllib.error.HTTPError as e:
        try:
            corpo = e.read()
        except Exception:  # noqa: BLE001
            corpo = b''
        return e.code, corpo, None
    except Exception as e:  # noqa: BLE001
        msg = '%s: %s' % (type(e).__name__, e)
        if 'CERTIFICATE_VERIFY_FAILED' in msg:
            msg += (' | Python do Mac sem certificados: rode "/Applications/Python 3.x/Install Certificates.command" '
                    'ou "pip3 install requests certifi"')
        return 0, b'', msg


def get_json(url, tentativas=3, timeout=60):
    """JSON com retentativa em 429/5xx/0 (a API do Querido Diário devolve 520/522 com frequência)."""
    ult = (0, None, 'sem tentativa')
    for t in range(tentativas):
        st, body, err = get(url, timeout=timeout)
        if st == 200:
            try:
                return 200, json.loads(body.decode('utf-8-sig')), None
            except Exception as e:  # noqa: BLE001
                return 200, None, 'JSON inválido: %s' % e
        ult = (st, None, err or 'HTTP %s' % st)
        if st in (400, 401, 403, 404):
            break
        time.sleep(5 * (t + 1) * (4 if st == 429 else 1))
    return ult


def ler_json(p, padrao=None):
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return padrao


def grava_json(p, d):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    os.replace(tmp, p)


# ----------------------------------------------------------------------------- carga dos dados da pesquisa
RE_URL = re.compile(r'https?://[^\s;,()<>"\']+')


def classifica_url(u):
    h = host_de(u)
    if 'queridodiario' in h:
        return 'qd'
    if h.endswith('leismunicipais.com.br') or h.endswith('leis.org'):
        return 'leis'
    if h.endswith('1doc.com.br'):
        return '1doc'
    if h.endswith('atende.net'):
        return 'atende'
    if h.endswith('cespro.com.br'):
        return 'cespro'
    if h.endswith('penaestrada.com.br'):
        return 'penaestrada'
    if re.search(r'(^|\.)acessoainformacao\.', h) and (h.endswith('.go.gov.br') or h.endswith('.go.leg.br')) \
            or '/cidadao/legislacao' in u:
        return 'nucleogov'
    if h in ('overpass-api.de', 'data.queridodiario.ok.org.br') or 'diariomunicipal.com.br' in h:
        return 'ignorar'
    return 'site'


def carrega():
    falhas = ler_json(os.path.join(CID, 'falhas_de_fonte.json'), [])
    portais = ler_json(os.path.join(CID, 'leads', 'portais.json'), {})
    qd = ler_json(os.path.join(CID, 'qd_cities.json'), {}).get('cities', [])
    qd_ids = {c['territory_id'] for c in qd}
    cidades = []
    for f in falhas:
        ib = f['ibge']
        res = ler_json(os.path.join(CID, 'res', ib + '.json'), {})
        urls = []
        for s in f.get('fontes_que_falharam') or []:
            if isinstance(s, str):
                urls += RE_URL.findall(s)
        obs = res.get('observacoes') or ''
        for m in re.finditer(r'Rodar da rede do usuário:([^\n]*)', obs):
            urls += RE_URL.findall(m.group(1))
        for c in res.get('fontes_consultadas') or []:
            r = (c.get('resultado') or '')
            if re.search(r'403|Cloudflare|captcha|HTTP 000|bloquea|inacess|522|sem resposta|sem busca', r, re.I):
                urls += RE_URL.findall(c.get('url') or '')
        p = portais.get(ib, {})
        for fo in p.get('fontes') or []:
            if fo.get('sistema') in ('atende', 'cespro', '1doc', 'leismunicipais', 'nucleogov') and fo.get('url_busca'):
                urls.append(fo['url_busca'])
        vistos, lista = set(), []
        for u in urls:
            u = u.rstrip('.')
            if u not in vistos:
                vistos.add(u)
                lista.append(u)
        cat = defaultdict(list)
        for u in lista:
            cat[classifica_url(u)].append(u)
        if ib in qd_ids and 'qd' not in cat:
            cat['qd'] = [QD_API + '?territory_ids=' + ib]
        # sistemas de fonte do portais.json
        sist = {fo.get('sistema') for fo in p.get('fontes') or []}
        if 'nucleogov' in sist and 'nucleogov' not in cat:
            cat['nucleogov'] = [fo['url_busca'] for fo in p['fontes'] if fo.get('sistema') == 'nucleogov' and fo.get('url_busca')]
        if 'leismunicipais' in sist and 'leis' not in cat:
            cat['leis'] = [fo['url_busca'] for fo in p['fontes'] if fo.get('sistema') == 'leismunicipais' and fo.get('url_busca')]
        cidades.append({'ibge': ib, 'nome': f['nome'], 'uf': f['uf'], 'urls': dict(cat), 'portal': p,
                        'qd_cobre': ib in qd_ids, 'obs_rede': obs[obs.find('Rodar da rede do usuário:'):][:600] if 'Rodar da rede' in obs else ''})
    return cidades


def tabela_contagem(cidades):
    cols = ['qd', 'leis', 'nucleogov', 'cespro', 'atende', '1doc', 'site']
    por_uf = defaultdict(Counter)
    for c in cidades:
        por_uf[c['uf']]['cidades'] += 1
        for k in cols:
            if c['urls'].get(k):
                por_uf[c['uf']][k] += 1
        if any(fo.get('sistema') not in SEM_CLIENTE for fo in c['portal'].get('fontes') or []):
            por_uf[c['uf']]['legislacao'] += 1
        if not any(c['urls'].get(k) for k in cols):
            por_uf[c['uf']]['sem_url'] += 1
    cab = ['UF', 'cidades'] + cols + ['legislacao(cliente)', 'sem_url']
    linhas = [cab]
    tot = Counter()
    for uf in sorted(por_uf):
        c = por_uf[uf]
        tot.update(c)
        linhas.append([uf, c['cidades']] + [c[k] for k in cols] + [c['legislacao'], c['sem_url']])
    linhas.append(['TOTAL', tot['cidades']] + [tot[k] for k in cols] + [tot['legislacao'], tot['sem_url']])
    return linhas


def imprime_tabela(linhas):
    print('| ' + ' | '.join(map(str, linhas[0])) + ' |')
    print('|' + '---|' * len(linhas[0]))
    for l in linhas[1:]:
        print('| ' + ' | '.join(map(str, l)) + ' |')


# ----------------------------------------------------------------------------- cache por cidade/fonte
class Cache:
    def __init__(self, base, refazer_erros):
        self.base, self.refazer = base, refazer_erros

    def caminho(self, fonte, ibge):
        return os.path.join(self.base, '_cache', fonte, ibge + '.json')

    def le(self, fonte, ibge):
        d = ler_json(self.caminho(fonte, ibge))
        if d is None:
            return None
        if self.refazer and d.get('erro'):
            return None
        return d

    def grava(self, fonte, ibge, d):
        d['quando'] = agora()
        grava_json(self.caminho(fonte, ibge), d)


# ----------------------------------------------------------------------------- fontes
def fonte_qd(c, cache_unused=None):
    """Querido Diário: 5 termos, size=10, 3 trechos de 500 caracteres."""
    out = {'termos': {}, 'url_base': QD_API, 'cobre_cidade': c['qd_cobre']}
    erros = 0
    for termo in QD_TERMOS:
        q = '"%s"' % termo if ' ' in termo else termo
        url = QD_API + '?' + urllib.parse.urlencode({'territory_ids': c['ibge'], 'querystring': q, 'excerpt_size': 500,
                                                      'number_of_excerpts': 3, 'size': 10})
        st, d, err = get_json(url)
        if d is None:
            erros += 1
            out['termos'][termo] = {'url': url, 'erro': err, 'status': st}
            continue
        gz = [{'data': g.get('date'), 'edicao': g.get('edition'), 'extra': g.get('is_extra_edition'), 'url': g.get('url'),
               'txt': g.get('txt_url'), 'trechos': [re.sub(r'\s+', ' ', e) for e in g.get('excerpts') or []]}
              for g in d.get('gazettes') or []]
        out['termos'][termo] = {'url': url, 'status': st, 'total': d.get('total_gazettes', len(gz)), 'diarios': gz}
    out['total_diarios'] = sum(t.get('total', 0) for t in out['termos'].values())
    if erros:
        out['erro'] = '%d de %d termos sem resposta (HTTP/rede); ver termos.*.erro' % (erros, len(QD_TERMOS))
    return out


def links_leis(c):
    base = list(dict.fromkeys(c['urls'].get('leis') or []))
    q = urllib.parse.quote_plus
    g = 'https://www.google.com/search?q=' + q('site:leismunicipais.com.br %s %s caminhões OR "veículos pesados" OR "carga e descarga"' % (c['nome'], c['uf']))
    return base + [g]


def fonte_leis(c, cache_unused=None):
    """Sem formato de busca documentado no repositório: só testa se a página do município abre e lista links para o navegador."""
    out = {'links_navegador': links_leis(c), 'paginas': []}
    for u in (c['urls'].get('leis') or [])[:2]:
        st, body, err = get(u, timeout=30)
        txt = body[:4000].decode('utf-8', 'ignore')
        cf = 'Just a moment' in txt or 'cf-chl' in txt
        out['paginas'].append({'url': u, 'status': st, 'cloudflare': cf, 'erro': err})
    if out['paginas'] and all(p['status'] != 200 or p['cloudflare'] for p in out['paginas']):
        out['obs'] = 'página bloqueada/Cloudflare também daqui: abrir no navegador (links_navegador)'
    return out


def fonte_nucleogov(c, cache_unused=None):
    import nucleogov
    out = {'links_navegador': [], 'dom': []}
    for u in c['urls'].get('nucleogov') or []:
        if '/cidadao/legislacao' in u and u not in out['links_navegador']:
            out['links_navegador'].append(u)
    sites = (c['portal'].get('sites') or {})
    for h in nucleogov.descobrir(c['nome'], sites):
        ac = nucleogov.acervo(h)
        cont, itens = nucleogov.varrer(h, nucleogov.TERMOS, False)
        out['dom'].append({'host': h, 'acervo': ac, 'contagem': cont, 'itens': itens[:40]})
    if not out['dom']:
        out['obs'] = 'sem dom.<dominio> com API (diário NucleoGov); usar links_navegador'
    for h in set(re.sub(r'^.*?//', '', u).split('/')[0] for u in out['links_navegador']):
        st, body, err = get('https://%s/cidadao/legislacao/leis' % h, timeout=30)
        out.setdefault('portal', []).append({'host': h, 'status': st, 'erro': err})
    return out


def fonte_legislacao(c, cache_unused=None):
    """Reaplica legislacao.py nas fontes do município que têm cliente. Throttle de 1 s/host via monkeypatch de http()."""
    import legislacao
    if not getattr(legislacao, '_throttle', False):
        orig = legislacao.http

        def http_lento(url, *a, **k):
            espera(host_de(url))
            return orig(url, *a, **k)
        legislacao.http = http_lento
        legislacao._throttle = True
    fontes = [fo for fo in c['portal'].get('fontes') or [] if fo.get('sistema') not in SEM_CLIENTE and fo.get('base')]
    out = {'fontes': [], 'termos': TERMOS_LEG}
    for fo in fontes[:4]:
        r = legislacao.buscar_em(fo['sistema'], fo['base'], TERMOS_LEG, 100, False)
        r['orgao'] = fo.get('orgao')
        r['atos'] = r.get('atos', [])[:60]
        out['fontes'].append(r)
    if not fontes:
        out['obs'] = 'nenhuma fonte com cliente automático no portais.json'
    erros = [f for f in out['fontes'] if f.get('erro')]
    if erros and len(erros) == len(out['fontes']):
        out['erro'] = '; '.join('%s: %s' % (f['base'], str(f['erro'])[:120]) for f in erros)
    return out


RUNNERS = {'qd': fonte_qd, 'leis': fonte_leis, 'nucleogov': fonte_nucleogov, 'legislacao': fonte_legislacao}


def precisa(c, fonte):
    if fonte == 'qd':
        return bool(c['urls'].get('qd')) or c['qd_cobre']
    if fonte == 'leis':
        return bool(c['urls'].get('leis'))
    if fonte == 'nucleogov':
        return bool(c['urls'].get('nucleogov'))
    if fonte == 'legislacao':
        return any(fo.get('sistema') not in SEM_CLIENTE and fo.get('base') for fo in c['portal'].get('fontes') or [])
    return False


# ----------------------------------------------------------------------------- lista manual (captcha/login)
def links_manual(cidades):
    q = urllib.parse.quote_plus
    linhas = []
    for c in cidades:
        vistos = set()
        fontes = list(c['portal'].get('fontes') or [])
        cand = []
        for fo in fontes:
            if fo.get('sistema') in ('atende', 'cespro', '1doc'):
                cand.append((fo['sistema'], fo.get('orgao') or '', fo.get('url_busca') or fo.get('base')))
        for k in ('atende', 'cespro', '1doc'):
            for u in c['urls'].get(k) or []:
                cand.append((k, '', u))
        for sis, org, u in cand:
            if not u or u in vistos:
                continue
            vistos.add(u)
            h = host_de(u)
            g = 'https://www.google.com/search?q=' + q('site:%s caminhões OR "veículos pesados" OR "carga e descarga"' % h)
            linhas.append({'ibge': c['ibge'], 'cidade': c['nome'], 'uf': c['uf'], 'sistema': sis, 'orgao': org, 'url': u,
                           'busca_google_site': g, 'instrucao': {
                               'atende': 'Legislação municipal > pesquisar (caminh, carga e descarga, veículos pesados); captcha',
                               'cespro': 'Pesquisa de legislação (reCAPTCHA); alternativa: lista por ano',
                               '1doc': 'b.php?pg=o/login — buscar em Legislação/Atos oficiais (pode pedir login)'}[sis]})
    return linhas


def grava_manual(base, linhas):
    os.makedirs(base, exist_ok=True)
    cols = ['uf', 'ibge', 'cidade', 'sistema', 'orgao', 'url', 'busca_google_site', 'instrucao']
    with open(os.path.join(base, '_manual.csv'), 'w', newline='', encoding='utf-8-sig') as f:
        w = csv.DictWriter(f, cols, delimiter=';')
        w.writeheader()
        for l in sorted(linhas, key=lambda x: (x['uf'], x['cidade'], x['sistema'])):
            w.writerow({k: l[k] for k in cols})
    por_uf = defaultdict(lambda: defaultdict(list))
    for l in linhas:
        por_uf[l['uf']][(l['cidade'], l['ibge'])].append(l)
    h = ['<!doctype html><meta charset="utf-8"><title>Pesquisa manual (captcha/login)</title>',
         '<style>body{font:15px system-ui;margin:20px auto;max-width:980px;padding:0 16px}h2{margin-top:2em}li{margin:.2em 0}'
         '.s{font-size:12px;background:#eee;border-radius:4px;padding:1px 6px;margin-right:6px}input{width:100%;padding:8px;margin:8px 0}</style>',
         '<h1>Pesquisa manual: CESPRO, Atende.net, 1doc</h1><p>Busque por <b>caminh</b>, <b>carga e descarga</b>, <b>veículos pesados</b>, '
         '<b>tonelada</b>. Anote número/data do ato e o artigo. %d links, %d cidades.</p>' % (len(linhas), len({(l["ibge"]) for l in linhas})),
         '<input id=f placeholder="filtrar cidade ou sistema" oninput="for(const e of document.querySelectorAll(\'.c\'))e.style.display=e.textContent.toLowerCase().includes(this.value.toLowerCase())?\'\':\'none\'">']
    for uf in sorted(por_uf):
        h.append('<h2>%s (%d cidades)</h2>' % (uf, len(por_uf[uf])))
        for (nome, ib), ls in sorted(por_uf[uf].items()):
            h.append('<div class=c><b>%s</b> <small>%s</small><ul>' % (html.escape(nome), ib))
            for l in ls:
                h.append('<li><span class=s>%s %s</span><a href="%s" target=_blank rel=noopener>abrir</a> · '
                         '<a href="%s" target=_blank rel=noopener>google site:</a> <small>%s</small></li>'
                         % (l['sistema'], html.escape(l['orgao']), html.escape(l['url']), html.escape(l['busca_google_site']),
                            html.escape(l['instrucao'])))
            h.append('</ul></div>')
    with open(os.path.join(base, '_manual.html'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(h))


# ----------------------------------------------------------------------------- insumos estaduais (SNV/DNIT e PMQC/ANP)
def baixar(url, destino, auth=None, minimo=1000):
    if os.path.exists(destino) and os.path.getsize(destino) >= minimo:
        print('  ja existe:', destino)
        return True
    st, body, err = get(url, timeout=900, auth=auth)
    if st != 200 or len(body) < minimo:
        print('  ERRO %s %s -> HTTP %s %s' % (url, '', st, err or ''))
        return False
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, 'wb') as f:
        f.write(body)
    print('  ok %.1f MB: %s' % (len(body) / 1e6, destino))
    return True


def insumos(data_dir, meses=12):
    """Baixa os arquivos brutos que importers/sources/{snv_dnit,postos_anp}.py baixariam (URLs copiadas do código)."""
    cache = os.path.join(data_dir, 'cache')
    ok = True
    # --- SNV/DNIT (importers/sources/snv_dnit.py): WebDAV público do Nextcloud, usuário = SHARE, senha vazia
    SHARE = 'oTpPRmYs5AAdiNr'
    WEBDAV = 'https://servicos.dnit.gov.br/dnitcloud/public.php/webdav/'
    FOLDER = 'SNV Bases Geométricas (2013-Atual) (SHP)/'
    print('SNV/DNIT')
    nome = os.environ.get('SNV_VERSION')
    if not nome:
        st, body, err = get(WEBDAV + urllib.parse.quote(FOLDER), metodo='PROPFIND', auth=(SHARE, ''),
                            headers={'Depth': '1'}, timeout=60)
        if st in (200, 207):
            hrefs = re.findall(r'<(?:\w+:)?href>([^<]+)</', body.decode('utf-8', 'ignore'))
            zips = sorted(n for n in (urllib.parse.unquote(h).rstrip('/').split('/')[-1] for h in hrefs)
                          if re.fullmatch(r'\d{6}[A-Z]?\.zip', n))
            nome = zips[-1] if zips else None
        else:
            print('  PROPFIND falhou: HTTP %s %s' % (st, err or ''))
    if nome:
        nome = nome if nome.endswith('.zip') else nome + '.zip'
        ok &= baixar(WEBDAV + urllib.parse.quote(FOLDER + nome), os.path.join(cache, 'snv', nome), auth=(SHARE, ''), minimo=10_000_000)
    else:
        ok = False
        print('  sem versão do SNV; defina SNV_VERSION=202607A (ou a mais nova da pasta) e rode de novo')
    # --- ANP (importers/sources/postos_anp.py): cadastro + LPC (csv) e PMQC mensal
    print('ANP')
    BASE = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos'
    CADASTRO = (BASE + '/arquivos/arquivos-dados-cadastrais-dos-revendedores-varejistas-de-combustiveis-automotivos/'
                'dados-cadastrais-revendedores-varejistas-combustiveis-automoveis.csv')
    LPC = BASE + '/arquivos/shpc/qus/ultimas-4-semanas-diesel-gnv.csv'
    PMQC_PAGE = BASE + '/pmqc-programa-de-monitoramento-da-qualidade-dos-combustiveis'
    for u, d in ((CADASTRO, 'anp_revendedores.csv'), (LPC, 'anp_lpc_4sem_diesel.csv')):
        dest = os.path.join(cache, d)
        if os.path.exists(dest) and time.time() - os.path.getmtime(dest) < 24 * 3600:
            print('  ja existe (<24 h):', dest)
        else:
            ok &= baixar(u, dest + '.novo') and (os.replace(dest + '.novo', dest) or True)
    pagina = os.path.join(cache, 'anp_pmqc_page.html')
    st, body, err = get(PMQC_PAGE, timeout=120)
    if st != 200:
        print('  ERRO pagina PMQC: HTTP %s %s' % (st, err or ''))
        return False
    os.makedirs(cache, exist_ok=True)
    with open(pagina, 'wb') as f:
        f.write(body)
    txt = body.decode('utf-8', 'replace')
    # o código só procura .../arquivos/pmqc/AAAA/....csv; a página hoje publica .../arquivos/pmqc/pmqc_AAAA_MM.zip
    csvs = sorted(set(re.findall(r'https://www\.gov\.br/anp/[^"\s]*/arquivos/pmqc/\d{4}/[^"\s]+\.csv', txt)))
    zips = sorted(set(re.findall(r'https://www\.gov\.br/anp/[^"\s]*/arquivos/pmqc/pmqc_\d{4}_\d{2}\.zip', txt)), reverse=True)[:meses]
    print('  PMQC na pagina: %d csv (padrao que o importador procura) e %d zip mensais (usando os %d mais novos)'
          % (len(csvs), len(zips), meses))
    import zipfile
    for u in csvs[:meses]:
        n = u.rsplit('/', 2)[-2] + '_' + u.rsplit('/', 1)[-1]
        ok &= baixar(u, os.path.join(cache, 'anp_pmqc', n))
    for u in zips:
        n = u.rsplit('/', 1)[-1]
        z = os.path.join(cache, 'anp_pmqc_zip', n)
        if baixar(u, z):
            try:
                with zipfile.ZipFile(z) as zf:
                    for m in zf.namelist():
                        if m.lower().endswith('.csv'):
                            dest = os.path.join(cache, 'anp_pmqc', n[:-4] + '__' + os.path.basename(m))
                            if not os.path.exists(dest):
                                with open(dest, 'wb') as f:
                                    f.write(zf.read(m))
                            print('    extraido:', dest)
            except Exception as e:  # noqa: BLE001
                print('    zip ilegivel:', z, e)
                ok = False
        else:
            ok = False
    print('Pronto. Arquivos em', cache)
    return ok


# ----------------------------------------------------------------------------- principal
def escolhe_teste(cidades):
    """3 cidades variadas: uma de GO (NucleoGov), uma com cliente de legislação e uma qualquer com QD."""
    esc = []
    def pega(pred):
        for c in cidades:
            if c not in esc and pred(c):
                esc.append(c)
                return
    pega(lambda c: c['uf'] == 'GO' and c['urls'].get('nucleogov'))
    pega(lambda c: precisa(c, 'legislacao') and c['urls'].get('qd'))
    pega(lambda c: c['urls'].get('leis') and c['urls'].get('qd'))
    for c in cidades:
        if len(esc) >= 3:
            break
        if c not in esc:
            esc.append(c)
    return esc[:3]


def resumo(base, cidades, fontes, cache):
    r = {'gerado_em': agora(), 'cidades': len(cidades), 'por_fonte': {}, 'achados': []}
    for f in fontes:
        if f == 'manual':
            continue
        n = ok = err = achou = 0
        for c in cidades:
            d = cache.le(f, c['ibge']) if os.path.exists(cache.caminho(f, c['ibge'])) else None
            if d is None:
                continue
            n += 1
            if d.get('erro'):
                err += 1
            else:
                ok += 1
            tem = False
            if f == 'qd':
                tem = d.get('total_diarios', 0) > 0
            elif f == 'nucleogov':
                tem = any(h['itens'] and h['itens'][0]['score'] >= 2 for h in d.get('dom', []))
            elif f == 'legislacao':
                tem = any(x.get('total') for x in d.get('fontes', []))
            if tem:
                achou += 1
                r['achados'].append({'ibge': c['ibge'], 'cidade': c['nome'], 'uf': c['uf'], 'fonte': f})
        r['por_fonte'][f] = {'feitas': n, 'sem_erro': ok, 'com_erro': err, 'com_resultado': achou}
    grava_json(os.path.join(base, '_resumo.json'), r)
    return r


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--uf', help='UFs separadas por vírgula (PR,SC,RS,GO,MS,MT)')
    ap.add_argument('--limite', type=int, help='máximo de cidades')
    ap.add_argument('--so', help='fontes: ' + ','.join(FONTES) + ',insumos (separadas por vírgula)')
    ap.add_argument('--teste', action='store_true', help='3 cidades; saída em leads/rede_arthur/_teste/')
    ap.add_argument('--refazer-erros', action='store_true', help='repete o que está no cache com erro')
    ap.add_argument('--contagem', action='store_true', help='só imprime a tabela UF x bloqueio')
    ap.add_argument('--ibge', help='códigos IBGE separados por vírgula')
    ap.add_argument('--data-dir', default=os.environ.get('DATA_DIR') or os.path.join(REPO, 'data'),
                    help='para --so insumos (padrão: <repo>/data ou $DATA_DIR)')
    a = ap.parse_args()

    so = [s.strip() for s in a.so.split(',')] if a.so else list(FONTES)
    if 'insumos' in so:
        r = insumos(a.data_dir)
        so = [s for s in so if s != 'insumos']
        if not so or a.so == 'insumos':
            return 0 if r else 1
    ruim = [s for s in so if s not in FONTES]
    if ruim:
        ap.error('fonte desconhecida: %s' % ruim)

    cidades = carrega()
    if a.uf:
        ufs = {u.strip().upper() for u in a.uf.split(',')}
        cidades = [c for c in cidades if c['uf'] in ufs]
    if a.ibge:
        ids = {x.strip() for x in a.ibge.split(',')}
        cidades = [c for c in cidades if c['ibge'] in ids]
    if a.contagem:
        imprime_tabela(tabela_contagem(cidades))
        return 0
    if a.teste:
        cidades = escolhe_teste(cidades)
    if a.limite:
        cidades = cidades[:a.limite]
    base = os.path.join(SAIDA, '_teste') if a.teste else SAIDA
    cache = Cache(base, a.refazer_erros)
    print('%d cidades; fontes: %s; saída: %s' % (len(cidades), ','.join(so), base))

    seguidos = Counter()
    desligadas = set()
    t0 = time.time()
    try:
        for i, c in enumerate(cidades, 1):
            ib = c['ibge']
            saida = {'ibge': ib, 'nome': c['nome'], 'uf': c['uf'], 'gerado_em': agora(), 'urls_que_bloquearam': c['urls'],
                     'obs_pesquisa_nuvem': c['obs_rede'], 'fontes': {}}
            linha = []
            for f in so:
                if f == 'manual' or not precisa(c, f):
                    continue
                d = cache.le(f, ib)
                tag = 'cache'
                if d is None and f not in desligadas:
                    try:
                        d = RUNNERS[f](c)
                    except KeyboardInterrupt:
                        raise
                    except Exception as e:  # noqa: BLE001
                        d = {'erro': 'exceção %s: %s' % (type(e).__name__, e)}
                    cache.grava(f, ib, d)
                    tag = 'ERRO' if d.get('erro') else 'ok'
                    seguidos[f] = seguidos[f] + 1 if d.get('erro') else 0
                    if seguidos[f] >= 15:
                        print('  !! %s falhou em %d cidades seguidas: desligado nesta execução (rede/bloqueio?). '
                              'Rode de novo depois com --refazer-erros.' % (f, seguidos[f]))
                        desligadas.add(f)
                if d is not None:
                    saida['fontes'][f] = d
                    linha.append('%s=%s' % (f, tag))
            saida['manual'] = [l for l in links_manual([c])]
            grava_json(os.path.join(base, ib + '.json'), saida)
            print('[%d/%d] %s %s/%s  %s' % (i, len(cidades), ib, c['nome'], c['uf'], ' '.join(linha) or '(só manual)'), flush=True)
    except KeyboardInterrupt:
        print('\nInterrompido; o cache foi mantido. Rode de novo para retomar.')

    if 'manual' in so or a.so is None:
        # a lista manual cobre todas as cidades do filtro, não só as processadas acima
        grava_manual(base, links_manual(cidades))
        print('lista manual: %s/_manual.html e _manual.csv' % base)
    r = resumo(base, cidades, so, cache)
    r['duracao_s'] = round(time.time() - t0)
    grava_json(os.path.join(base, '_resumo.json'), r)
    print(json.dumps(r['por_fonte'], ensure_ascii=False))
    print('achados (cidade/fonte com algum resultado):', len(r['achados']), '-> %s/_resumo.json' % base)
    return 0


if __name__ == '__main__':
    sys.exit(main())
