#!/usr/bin/env python3
"""Cliente das Câmaras Municipais em plataforma Softcam (rota /proposicoes/pesquisa).

Observação das rodadas anteriores: com UA de navegador o site mostra 'Bot Verification'; curl puro
(User-Agent padrão do curl) passa. Por isso este cliente usa o binário `curl` (respeita HTTPS_PROXY/CA).

Uso:
  python3 softcam.py descobrir <cidade> <uf> [url_camara_conhecida]   # acha o host Softcam
  python3 softcam.py buscar <host> "<termo>"                          # busca em texto integral (expressão exata)
  python3 softcam.py acervo <host>                                    # testa acervo com 'orçamento'
Como biblioteca: slug(), candidatos(), probe(host, termo), buscar(host, termo).
Regras: >=1 s entre pedidos ao mesmo host (throttle interno por host).
"""
import re, subprocess, sys, time, threading, unicodedata, urllib.parse, html, json

_last = {}
_lock = threading.Lock()

def _throttle(host, gap=1.0):
    with _lock:
        now = time.time()
        t = max(_last.get(host, 0) + gap, now)
        _last[host] = t
    if t > now:
        time.sleep(t - now)

def slug(nome):
    s = unicodedata.normalize('NFKD', nome).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]', '', s)

def candidatos(nome, uf, conhecida=None):
    s, u = slug(nome), uf.lower()
    hosts = []
    if conhecida:
        h = urllib.parse.urlparse(conhecida).netloc
        if h: hosts.append(h)
    for tld in (f'{u}.gov.br', f'{u}.leg.br'):
        for base in (f'camara{s}', f'cm{s}', f'camaramunicipal{s}', f'camarade{s}', f'camaramunicipalde{s}', f'camaramunicipaldo{s}', f'{s}'):
            if tld.endswith('leg.br') and base == s:
                hosts.append(f'{s}.{tld}')
                hosts.append(f'camara.{s}.{tld}') if False else None
                continue
            if base == s: continue
            hosts.append(f'www.{base}.{tld}')
            hosts.append(f'{base}.{tld}')
        hosts.append(f'www.{s}.{tld}') if tld.endswith('leg.br') else None
    out = []
    for h in hosts:
        if h and h not in out: out.append(h)
    return out

def curl(url, timeout=25, connect=6):
    r = subprocess.run(['curl', '-sS', '-L', '--max-redirs', '3', '-m', str(timeout), '--connect-timeout', str(connect),
                        '-w', '\n__HTTP__%{http_code} __URL__%{url_effective}', url],
                       capture_output=True, timeout=timeout + 10)
    out = r.stdout.decode('utf-8', 'replace')
    m = re.search(r'\n__HTTP__(\d+) __URL__(.*)$', out)
    code = int(m.group(1)) if m else 0
    return code, (m.group(2) if m else url), (out[:m.start()] if m else out), r.stderr.decode('utf-8', 'replace')[:200]

def url_busca(host, termo, exata=True):
    q = {'definicao': 'legislacao', 'palavras_chave': termo,
         'palavras_chave_opcao': 'expressao_exata' if exata else 'todas', 'criterios': 'Pesquisar'}
    return f'https://{host}/proposicoes/pesquisa?' + urllib.parse.urlencode(q)

def parse(t):
    total = None
    m = re.search(r'de\s*<strong>(\d+)</strong>', t)
    if m: total = int(m.group(1))
    elif 'pbw_' in t and 'Resultados da Pesquisa' in t: total = 0
    itens = []
    for blk in re.split(r'<div class="pbw_linhatitulo-3">', t)[1:]:
        d = re.search(r'<span>([^<]*)</span>', blk)
        a = re.search(r'<a href="([^"]+)">([^<]*)</a>', blk)
        e = re.search(r'<em>(.*?)</em>', blk, re.S)
        if a:
            itens.append({'data': d.group(1).strip() if d else '', 'url': a.group(1), 'titulo': html.unescape(a.group(2)).strip(),
                          'ementa': html.unescape(re.sub(r'\s+', ' ', e.group(1))).strip() if e else ''})
    return total, itens

def buscar(host, termo, exata=True):
    """-> dict(ok, code, softcam, total, itens, url)"""
    _throttle(host)
    u = url_busca(host, termo, exata)
    code, eff, body, err = curl(u)
    soft = 'pbw_' in body and ('softcam' in body.lower() or 'Resultados da Pesquisa' in body)
    total, itens = parse(body) if soft else (None, [])
    return {'ok': soft and total is not None, 'code': code, 'softcam': soft, 'total': total, 'itens': itens, 'url': u,
            'eff': eff, 'bot': 'Bot Verification' in body, 'err': err}

def pagina(host, termo, pg, exata=True):
    """página pg (1..) da busca; 25 itens por página"""
    _throttle(host)
    q = url_busca(host, termo, exata).split('?', 1)[1]
    u = f'https://{host}/proposicoes/pesquisa/0/{pg}/0?{q}'
    code, eff, body, err = curl(u)
    total, itens = parse(body)
    return total, itens

def acervo(host):
    """testa o acervo com 'orçamento': devolve (total, data_mais_antiga, data_mais_recente)"""
    r = buscar(host, 'orçamento')
    if not r['ok'] or not r['total']:
        return r['total'], None, None
    novo = r['itens'][0]['data'][:10] if r['itens'] else None
    ult = (r['total'] + 24) // 25
    antigo = novo
    if ult > 1:
        _, it = pagina(host, 'orçamento', ult)
        if it: antigo = it[-1]['data'][:10]
    elif r['itens']:
        antigo = r['itens'][-1]['data'][:10]
    return r['total'], antigo, novo

def descobrir(nome, uf, conhecida=None):
    for h in candidatos(nome, uf, conhecida):
        r = buscar(h, 'orçamento')
        if r['softcam']:
            return h, r
    return None, None

if __name__ == '__main__':
    c = sys.argv[1]
    if c == 'descobrir':
        h, r = descobrir(sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else None)
        print(h, r and r['total'])
    elif c == 'buscar':
        r = buscar(sys.argv[2], sys.argv[3]); print(json.dumps(r, ensure_ascii=False, indent=1))
    elif c == 'acervo':
        r = buscar(sys.argv[2], 'orçamento'); print(r['softcam'], r['total'], [i['data'] for i in r['itens'][-3:]])
