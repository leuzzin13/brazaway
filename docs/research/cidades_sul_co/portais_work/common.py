"""Utilidades compartilhadas da descoberta de portais (Sul/Centro-Oeste). Somente leitura; só GET."""
import csv, gzip, hashlib, json, os, re, threading, time, unicodedata
from urllib.parse import urlparse
import requests

AQUI = os.path.dirname(os.path.abspath(__file__))
CID = os.path.dirname(AQUI)
HTML = os.path.join(AQUI, 'html'); os.makedirs(HTML, exist_ok=True)
CACHE = os.path.join(AQUI, 'fetch.jsonl')
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
HDR = {'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
       'Accept-Language': 'pt-BR,pt;q=0.9'}
MAXB = 500_000

def sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

def slug(nome):
    return re.sub(r'[^a-z0-9]', '', sem_acento(nome).lower())

def slug_sem_part(nome):
    p = [w for w in re.split(r'[\s\-\']+', sem_acento(nome).lower()) if w not in ('de', 'da', 'do', 'das', 'dos', 'd')]
    return re.sub(r'[^a-z0-9]', '', ''.join(p))

def municipios():
    out = []
    with open(os.path.join(CID, 'municipios.csv'), encoding='utf-8') as f:
        for r in csv.reader(f, delimiter=';'):
            if r and r[0].isdigit():
                out.append({'ibge': r[0], 'nome': r[1], 'uf': r[2]})
    return out

# ---- limitador por grupo (domínios SaaS compartilhados) e por host
_lk = threading.Lock(); _prox = {}
GRUPOS = ('atende.net', '1doc.com.br', 'siscam.com.br', 'camarasempapel.com.br', 'splonline.com.br', 'nopapercloud.com.br',
          'legislacaocompilada.com.br', 'cespro.com.br', 'leismunicipais.com.br', 'betha.cloud', 'betha.com.br',
          'elotech.com.br', 'wls.com.br', 'instar.com.br', 'leg.br', 'gov.br')
INTERVALO = {'atende.net': 0.35, '1doc.com.br': 0.4, 'siscam.com.br': 0.4, 'camarasempapel.com.br': 0.4, 'splonline.com.br': 0.4,
             'nopapercloud.com.br': 0.4, 'legislacaocompilada.com.br': 0.5, 'cespro.com.br': 1.0, 'leismunicipais.com.br': 1.0,
             'betha.cloud': 0.4, 'betha.com.br': 0.5, 'elotech.com.br': 0.4, 'wls.com.br': 0.4}

def _chave(host):
    for g in INTERVALO:
        if host == g or host.endswith('.' + g):
            return g
    return host

def espera(host):
    k = _chave(host); iv = INTERVALO.get(k, 1.0)
    with _lk:
        t = time.time(); prox = _prox.get(k, 0); w = max(0, prox - t)
        _prox[k] = max(t, prox) + iv
    if w:
        time.sleep(w)

# ---- cache de GET
_clk = threading.Lock(); _cache = {}
def carrega_cache():
    if os.path.exists(CACHE):
        for l in open(CACHE, encoding='utf-8'):
            try:
                r = json.loads(l); _cache[r['url']] = r
            except Exception:
                pass
    return _cache

def html_de(r):
    p = os.path.join(HTML, r.get('h', '') + '.gz') if r.get('h') else None
    if p and os.path.exists(p):
        return gzip.open(p, 'rt', encoding='utf-8', errors='ignore').read()
    return ''

def titulo(t):
    m = re.search(r'<title[^>]*>(.*?)</title>', t, re.S | re.I)
    return ' '.join(re.sub(r'<[^>]+>', ' ', m.group(1)).split())[:200] if m else ''

def get(url, timeout=(8, 18), refaz=False):
    """GET com cache. Retorna dict {url,status,final,nx,err,title,h,n}. nx=True: CONNECT recusado (domínio inexistente/negado)."""
    if not refaz and url in _cache:
        return _cache[url]
    host = urlparse(url).hostname or ''
    espera(host)
    rec = {'url': url, 'status': 0, 'final': url, 'nx': False, 'err': '', 'title': '', 'h': '', 'n': 0, 't': time.strftime('%Y-%m-%d')}
    try:
        r = requests.get(url, headers=HDR, timeout=timeout, allow_redirects=True, stream=True)
        b = b''
        for ch in r.iter_content(65536):
            b += ch
            if len(b) > MAXB:
                break
        r.close()
        rec['status'] = r.status_code; rec['final'] = r.url; rec['n'] = len(b)
        ct = r.headers.get('content-type', '')
        rec['ct'] = ct[:40]
        if 'html' in ct.lower() or b.lstrip()[:1] == b'<' or 'text' in ct.lower() or 'json' in ct.lower():
            try:
                t = b.decode('utf-8')
            except UnicodeDecodeError:
                t = b.decode('cp1252', 'ignore')
            rec['title'] = titulo(t)
            hh = hashlib.sha1(url.encode()).hexdigest()[:16]
            with gzip.open(os.path.join(HTML, hh + '.gz'), 'wt', encoding='utf-8') as f:
                f.write(t)
            rec['h'] = hh
    except requests.exceptions.ProxyError as e:
        rec['nx'] = True; rec['err'] = 'proxy:' + str(e)[:80]
    except requests.exceptions.SSLError as e:
        rec['err'] = 'ssl:' + str(e)[:80]
    except requests.exceptions.Timeout:
        rec['err'] = 'timeout'
    except Exception as e:
        rec['err'] = type(e).__name__ + ':' + str(e)[:80]
    with _clk:
        _cache[url] = rec
        with open(CACHE, 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    return rec

def vivo(r):
    return r['status'] and r['status'] < 600 and not r['nx']
