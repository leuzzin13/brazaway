#!/usr/bin/env python3
"""Cliente de busca em TEXTO INTEGRAL dos diários DIOENET/Plenus e 1dom (somente GET, sem captcha).

DIOENET/Plenus : https://plenussistemas.dioenet.com.br/list/<slug>?pesquisa=<termo>[&pagina=N]
                 slug inexistente -> 307 para a home; slug válido -> 200 (título "<Município> - Rio Grande do Sul").
                 Cada acerto traz data, edição, link /diario/publicacoes/<id> (texto das publicações da edição),
                 e trechos destacados. Paginação ?pagina=N (a ÚLTIMA página da lista sem termo = edição mais antiga).
1dom           : https://<slug>.1dom.com.br/search/?search=<termo>&type=0&location=0&order=2&date=all
                 slug inexistente -> 404 (wildcard DNS). Acerto = "Ato oficial N/AAAA - tipo - título" + link
                 /edicao/<id>?act=<id> (a data fica na página da edição).

Uso (cd toolkit):
  python3 plenus_1dom.py descobrir 4300059 4300208 ...      # detecta plataforma/slug de cada IBGE (home + slug provável)
  python3 plenus_1dom.py buscar plenus barra-do-ribeiro "caminhões" [--paginas 2]
  python3 plenus_1dom.py buscar 1dom imigrante "caminhões"
  python3 plenus_1dom.py acervo plenus barra-do-ribeiro      # data da edição mais antiga/mais recente
  python3 plenus_1dom.py lote ../fila_r3/R4-PLENUS-RS.json SAIDA.json   # descobre + busca + acervo de todo o lote (retomável)
Como módulo: descobrir(ibge, nome, uf, sites), plenus_buscar(slug, termo), dom1_buscar(slug, termo), plenus_acervo(slug), dom1_acervo(slug).
Respeita >= 1 s entre pedidos ao mesmo host (plenussistemas.dioenet.com.br é um host só: lock global).
"""
import sys, re, json, time, html, threading, unicodedata, subprocess, os
from urllib.parse import quote
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.dirname(os.path.abspath(__file__))
PLENUS = "https://plenussistemas.dioenet.com.br"
TERMOS = ["caminhões", "veículos pesados", "trânsito pesado", "toneladas", "carga e descarga", "eixos"]
_locks = {}; _last = {}; _glock = threading.Lock()


def _espera(host):
    with _glock:
        lk = _locks.setdefault(host, threading.Lock())
    with lk:
        d = time.time() - _last.get(host, 0)
        if d < 1.05:
            time.sleep(1.05 - d)
        _last[host] = time.time()


def get(url, timeout=30, tries=2):
    """-> (status, body, location). Status 0 = erro de rede/proxy."""
    host = url.split("/")[2]
    for i in range(tries):
        _espera(host)
        try:
            r = subprocess.run(["curl", "-s", "-m", str(timeout), "-A", "Mozilla/5.0", "-o", "-", "-w", "\n__S__%{http_code} %{redirect_url}", url],
                               capture_output=True, timeout=timeout + 10)
            out = r.stdout.decode("utf-8", "replace")
            body, _, tail = out.rpartition("\n__S__")
            st, _, loc = tail.partition(" ")
            st = int(st or 0)
            if st in (0, 502, 503, 429) and i + 1 < tries:
                time.sleep(2); continue
            return st, body, loc.strip()
        except Exception:
            time.sleep(1)
    return 0, "", ""


def norm(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def slugs(nome):
    n = re.sub(r"[^a-z0-9 ]", " ", norm(nome)).split()
    kebab = "-".join(n); junto = "".join(n)
    sem = "-".join(w for w in n if w not in ("do", "da", "de", "dos", "das"))
    out = []
    for s in (kebab, junto, sem, kebab + "-rs", junto + "rs"):
        if s and s not in out:
            out.append(s)
    return out


def txt(h):
    h = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h, flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", h))).strip()


# ---------------- Plenus ----------------
def plenus_ok(slug, nome=None):
    st, b, loc = get(f"{PLENUS}/list/{slug}")
    if st != 200:
        return False
    t = txt(b)
    m = re.search(r"DIÁRIO OFICIAL ELETRÔNICO\s+(.+?)\s+-\s+(.+?)\s+O Diário", t)
    return bool(m and "grande do sul" in norm(m.group(2)) and (not nome or norm(nome) == norm(m.group(1)).strip()))


def plenus_buscar(slug, termo, paginas=1):
    """-> lista de dict(data, edicao, pub_id, url_pub, ementa, trechos)."""
    res = []
    for p in range(1, paginas + 1):
        u = f"{PLENUS}/list/{slug}?pesquisa={quote(termo)}" + (f"&pagina={p}" if p > 1 else "")
        st, b, _ = get(u)
        if st != 200:
            res.append({"erro": f"HTTP {st}", "url": u}); break
        itens = b.split('<li>\n') if False else re.split(r"<li>\s*<div class=\"col-one\">", b)[1:]
        for it in itens:
            d = re.search(r"Diário Oficial de ([\d/]+)", it); e = re.search(r"Edição nº ([^<]+)<", it)
            pid = re.search(r"/diario/publicacoes/(\d+)", it)
            em = re.search(r"<h4>Ementa</h4><br>(.*?)</div>", it, flags=re.S)
            tr = [txt(x) for x in re.findall(r"<div style='display:block;margin:10px 0;'>(.*?)</div>", it, flags=re.S)]
            res.append({"data": d and d.group(1), "edicao": e and e.group(1).strip(), "pub_id": pid and pid.group(1),
                        "url_pub": pid and f"{PLENUS}/diario/publicacoes/{pid.group(1)}",
                        "ementa": txt(em.group(1))[:400] if em else "", "trechos": tr[:4]})
        if len(itens) < 5:
            break
    return res


def plenus_acervo(slug):
    """-> (mais_antiga, mais_recente) datas dd/mm/aaaa."""
    st, b, _ = get(f"{PLENUS}/list/{slug}")
    if st != 200:
        return None, None
    datas = re.findall(r"Diário Oficial de ([\d/]+)", b)
    pags = [int(x) for x in re.findall(r"[?&]pagina=(\d+)", b)]
    rec = datas[0] if datas else None
    ant = datas[-1] if datas else None
    if pags:
        st2, b2, _ = get(f"{PLENUS}/list/{slug}?pagina={max(pags)}")
        d2 = re.findall(r"Diário Oficial de ([\d/]+)", b2)
        if d2:
            ant = d2[-1]
            # a paginação mostrada pode não chegar à última: segue "próxima" até acabar (máx. 6 saltos)
            for _ in range(6):
                p2 = [int(x) for x in re.findall(r"[?&]pagina=(\d+)", b2)]
                if not p2 or max(p2) <= max(pags):
                    break
                pags = p2
                st2, b2, _ = get(f"{PLENUS}/list/{slug}?pagina={max(p2)}")
                d2 = re.findall(r"Diário Oficial de ([\d/]+)", b2)
                if d2:
                    ant = d2[-1]
    return ant, rec


def plenus_publicacao(pub_id):
    """Texto das publicações de uma edição (para ler o ato)."""
    st, b, _ = get(f"{PLENUS}/diario/publicacoes/{pub_id}")
    return txt(b) if st == 200 else f"HTTP {st}"


# ---------------- 1dom ----------------
def dom1_ok(slug, nome=None):
    st, b, _ = get(f"https://{slug}.1dom.com.br/")
    if st != 200:
        return False
    t = txt(b)
    return "Diário Oficial Municipal" in t and (not nome or norm(nome) in norm(t[:600]))


def dom1_buscar(slug, termo, ordem=2):
    u = f"https://{slug}.1dom.com.br/search/?search={quote(termo)}&type=0&location=0&order={ordem}&date=all"
    st, b, _ = get(u)
    if st != 200:
        return [{"erro": f"HTTP {st}", "url": u}]
    res = []
    for m in re.finditer(r'font-weight: 700[^>]*>(.*?)</span>\s*<a href="(/edicao/[^"]+)"', b, flags=re.S):
        res.append({"titulo": txt(m.group(1)), "url": f"https://{slug}.1dom.com.br{html.unescape(m.group(2))}"})
    seen = set(); out = []
    for r in res:
        if r["url"] not in seen:
            seen.add(r["url"]); out.append(r)
    return out


def dom1_data_edicao(url):
    st, b, _ = get(url)
    m = re.search(r"(\d{2}/\d{2}/\d{4})", txt(b)) if st == 200 else None
    return m.group(1) if m else None


def dom1_acervo(slug):
    """Aproximação: data da edição do 1º resultado ordenado por data crescente/decrescente para termo 'de'."""
    out = []
    for ordem in (0, 1):
        r = dom1_buscar(slug, "de", ordem)
        out.append(dom1_data_edicao(r[0]["url"]) if r and "url" in r[0] else None)
    return out[0], out[1]  # (ord 0, ord 1): conferir qual é crescente na saída (documentado em README)


# ---------------- descoberta ----------------
_PAD = re.compile(r"https?://[^\s\"'<>]*(?:plenussistemas\.dioenet\.com\.br|dioenet\.com\.br|\.1dom\.com\.br)[^\s\"'<>]*", re.I)


def links_home(sites):
    achados = set()
    for u in sites:
        if not u:
            continue
        st, b, _ = get(u, timeout=20, tries=1)
        if st == 200:
            for m in _PAD.findall(b):
                achados.add(m.rstrip(".,;)"))
    return sorted(achados)


def descobrir(ibge, nome, uf="RS", sites=()):
    """-> dict(plataforma: 'plenus'|'1dom'|None, slug, links_home, tentados)."""
    r = {"ibge": ibge, "nome": nome, "plataforma": None, "slug": None, "links_home": links_home(sites), "tentados": []}
    # 1) links achados na home
    for l in r["links_home"]:
        m = re.search(r"dioenet\.com\.br/(?:list|diario)/([a-z0-9\-]+)", l)
        if m and m.group(1) not in ("publicacoes",) and plenus_ok(m.group(1)):
            r.update(plataforma="plenus", slug=m.group(1)); return r
        m = re.search(r"https?://([a-z0-9\-]+)\.1dom\.com\.br", l)
        if m and dom1_ok(m.group(1)):
            r.update(plataforma="1dom", slug=m.group(1)); return r
    # 2) slug provável
    for s in slugs(nome):
        r["tentados"].append("plenus:" + s)
        if plenus_ok(s, nome):
            r.update(plataforma="plenus", slug=s); return r
    for s in slugs(nome)[:3]:
        r["tentados"].append("1dom:" + s)
        if dom1_ok(s, nome):
            r.update(plataforma="1dom", slug=s); return r
    return r


# ---------------- lote ----------------
def _lote(fila, saida, termos=TERMOS, threads=6):
    portais = json.load(open(os.path.join(BASE, "..", "leads", "portais.json")))
    cid = json.load(open(fila))["cidades"]
    feito = json.load(open(saida)) if os.path.exists(saida) else {}

    def um(c):
        i = c["ibge"]
        if i in feito:
            return
        p = portais.get(i, {}); s = p.get("sites") or {}
        r = descobrir(i, c["nome"], c.get("uf", "RS"), [s.get("prefeitura"), s.get("camara")])
        if r["plataforma"] == "plenus":
            r["acervo"] = plenus_acervo(r["slug"]); r["buscas"] = {}
            for t in termos:
                r["buscas"][t] = plenus_buscar(r["slug"], t)
        elif r["plataforma"] == "1dom":
            r["buscas"] = {t: dom1_buscar(r["slug"], t) for t in termos}
            r["acervo"] = dom1_acervo(r["slug"])
        feito[i] = r
        json.dump(feito, open(saida, "w"), ensure_ascii=False, indent=1)
        print(i, c["nome"], r["plataforma"], r["slug"], flush=True)
    with ThreadPoolExecutor(threads) as ex:
        list(ex.map(um, cid))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        print(__doc__); sys.exit()
    if a[0] == "descobrir":
        portais = json.load(open(os.path.join(BASE, "..", "leads", "portais.json")))
        for i in a[1:]:
            p = portais.get(i, {}); s = p.get("sites") or {}
            print(json.dumps(descobrir(i, p.get("nome", i), p.get("uf"), [s.get("prefeitura"), s.get("camara")]), ensure_ascii=False))
    elif a[0] == "buscar":
        pl, slug, termo = a[1:4]
        pg = int(a[a.index("--paginas") + 1]) if "--paginas" in a else 1
        r = plenus_buscar(slug, termo, pg) if pl == "plenus" else dom1_buscar(slug, termo)
        print(json.dumps(r, ensure_ascii=False, indent=1))
    elif a[0] == "acervo":
        print(plenus_acervo(a[2]) if a[1] == "plenus" else dom1_acervo(a[2]))
    elif a[0] == "lote":
        _lote(a[1], a[2])
