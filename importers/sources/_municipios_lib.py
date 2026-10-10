"""Biblioteca da camada de restrições municipais (layer_id `restricoes_rmsp`): geometria das regras.

Usada pelo importador genérico `municipios` (importers/sources/municipios.py), que lê um arquivo por município em
data/raw/municipios/<ibge>.json. Aqui ficam só as ferramentas de geometria, sem regra legal:
  * limites municipais (arquivo curado da RMSP ou malha do IBGE, com cache) para recortar as vias;
  * construtor de trechos "rua X entre Y e Z" a partir do OSM (Overpass, com cache) e pela malha do Valhalla;
  * corte das linhas em pedaços de até 400 m, validação contra o grafo do Valhalla (linear_cost_factors) e encadeamento.

Os GeoJSON curados são versionados: o import é determinístico e não depende do Overpass. Para refazer a geometria
a partir do OSM, apague o GeoJSON curado (ou rode com MUNICIPIOS_REBUILD=1): o importador consulta o Overpass
(cache em data/cache/municipios/) e regrava o arquivo.
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import time
import unicodedata

from common import DATA_DIR, http_get, stable_id

LAYER_ID = 'restricoes_rmsp'
# caminhos de geometria nos arquivos de município são relativos a data/raw/
RAW_DIR = pathlib.Path(os.environ.get('MUNICIPIOS_RAW_DIR', str(DATA_DIR / 'raw')))
CACHE = DATA_DIR / 'cache' / 'municipios'
OVERPASS = os.environ.get('OVERPASS_URL', 'https://overpass-api.de/api/interpreter')
# limites curados (mais precisos que a malha "intermediária" do geocoding): fonte 'ibge' da camada
LIMITES_RMSP = 'rmsp/ibge_rmsp_municipios.geojson'
IBGE_MALHA_URL = ('https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{ibge}'
                  '?formato=application/vnd.geo%2Bjson&qualidade=maxima')


# ----------------------------------------------------------------------------- utilidades
def norm(s: str | None) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"[’'`´.]", '', s)
    return re.sub(r'\s+', ' ', s).strip()


def raw_path(rel: str) -> pathlib.Path:
    """Caminho de um arquivo de geometria referenciado num arquivo de município (relativo a data/raw/)."""
    p = (RAW_DIR / rel).resolve()
    if RAW_DIR.resolve() not in p.parents:
        raise ValueError(f'caminho fora de data/raw: {rel}')
    return p


def municipios() -> list[dict]:
    """Limites curados da RMSP (39 municípios, IBGE qualidade máxima simplificada a ~10 m)."""
    p = raw_path(LIMITES_RMSP)
    return json.loads(p.read_text())['features'] if p.exists() else []


def municipio_geom(ibge: str):
    """Limite do município: o curado da RMSP ou, fora dela, a malha do IBGE (API v3, qualidade máxima, com cache)."""
    from shapely.geometry import shape
    for f in municipios():
        if f['properties']['ibge'] == ibge:
            return shape(f['geometry'])
    d = json.loads(http_get(IBGE_MALHA_URL.format(ibge=ibge), cache=f'municipios/ibge_malha_{ibge}.geojson', max_age_h=24 * 365))
    feats = d.get('features') or ([d] if d.get('type') == 'Feature' else [])
    if not feats:
        raise KeyError(f'limite do município {ibge} não encontrado no IBGE')
    return shape(feats[0]['geometry'])


def _utm():
    from pyproj import Transformer
    return (Transformer.from_crs(4326, 31983, always_xy=True), Transformer.from_crs(31983, 4326, always_xy=True))


def to_utm(g):
    from shapely.ops import transform
    T, _ = _utm()
    return transform(lambda x, y, z=None: T.transform(x, y), g)


def to_ll(g):
    from shapely.ops import transform
    _, Ti = _utm()
    return transform(lambda x, y, z=None: Ti.transform(x, y), g)


def round_geojson(g: dict, nd: int = 7) -> dict:
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], nd), round(c[1], nd)]
    return {'type': g['type'], 'coordinates': r(g['coordinates'])}


# ----------------------------------------------------------------------------- OSM (Overpass, com cache)
def overpass_named_ways(ibge: str) -> list[dict]:
    """Vias com nome do município (área OSM com IBGE:GEOCODIGO), com geometria e tags."""
    q = (f'[out:json][timeout:180];area["boundary"="administrative"]["admin_level"="8"]["IBGE:GEOCODIGO"="{ibge}"]->.a;'
         'way(area.a)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|'
         'primary_link|secondary_link|tertiary_link|living_street|service|road)$"]["name"];out geom tags;')
    return _overpass(q, f'osm_named_{ibge}.json')


def overpass_bbox_ways(bbox: tuple[float, float, float, float], name: str) -> list[dict]:
    s, w, n, e = bbox
    q = f'[out:json][timeout:90];way({s},{w},{n},{e})["highway"];out geom tags;'
    return _overpass(q, f'osm_bbox_{name}.json')


def _overpass(q: str, cache: str) -> list[dict]:
    import requests
    p = CACHE / cache
    if p.exists() and time.time() - p.stat().st_mtime < 30 * 86400:
        return json.loads(p.read_text())['elements']
    for attempt in range(5):
        try:
            r = requests.post(OVERPASS, data={'data': q}, timeout=300, headers={'User-Agent': 'truck-router-mvp/0.1'})
            r.raise_for_status()
            d = r.json()
            break
        except Exception:
            if attempt == 4:
                raise
            time.sleep(15 * (attempt + 1))
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d))
    return d['elements']


def is_oneway(tags: dict) -> int:
    """1 = mão única no sentido do desenho, -1 = mão única contrária, 0 = mão dupla."""
    o = tags.get('oneway')
    if o in ('yes', '1', 'true'):
        return 1
    if o == '-1':
        return -1
    if o == 'no':
        return 0
    if tags.get('junction') in ('roundabout', 'circular') or tags.get('highway') in ('motorway', 'motorway_link'):
        return 1
    return 0


# ----------------------------------------------------------------------------- trechos "rua X entre Y e Z"
def _ways_by_names(osm: list[dict], names: list[str]) -> list[tuple[dict, object]]:
    from shapely.geometry import LineString
    want = {norm(n) for n in names}
    out = []
    for e in osm:
        if norm(e.get('tags', {}).get('name')) in want and len(e.get('geometry') or []) >= 2:
            L = to_utm(LineString([(n['lon'], n['lat']) for n in e['geometry']]))
            if is_oneway(e['tags']) == -1:
                L = LineString(list(L.coords)[::-1])
            out.append((e, L))
    return out


def _anchor_points(osm, target_lines, spec, tol=60.0):
    """Pontos (UTM) que marcam uma ponta do trecho: cruzamento com vias de nome dado, ou coordenada fixa."""
    from shapely.geometry import MultiPoint, Point
    from shapely.ops import unary_union
    if spec is None:
        return []
    if isinstance(spec, dict) and 'lonlat' in spec:
        return [to_utm(Point(*spec['lonlat']))]
    names = spec if isinstance(spec, list) else [spec]
    cross = _ways_by_names(osm, names)
    if not cross:
        return []
    cu = unary_union([L for _, L in cross])
    pts = []
    for T in target_lines:
        inter = T.intersection(cu)
        if not inter.is_empty:
            pts.extend([g for g in getattr(inter, 'geoms', [inter]) if g.geom_type == 'Point'])
        else:
            d = T.distance(cu)
            if d < tol:
                from shapely.ops import nearest_points
                pts.append(nearest_points(T, cu)[0])
    if not pts:
        return []
    # pista dupla gera 2+ cruzamentos próximos: devolve o centróide e também os pontos (o caminho escolhe o melhor par)
    return [MultiPoint(pts).centroid] + pts[:6]


def build_trecho(osm: list[dict], spec: dict, clip_utm) -> tuple[list[dict], list[str]]:
    """Feições (lon/lat) de um trecho do decreto. spec: {via: [nomes], de?, ate?, sentido?: bool, extremo?}.
    `de`/`ate` = lista de nomes da via transversal ou {"lonlat": [lon, lat]}; `sentido: true` = só de→ate."""
    from shapely.geometry import LineString, Point
    from shapely.ops import linemerge, substring, unary_union
    issues = []
    if spec.get('caminho') == 'valhalla':
        return _trecho_valhalla(spec, clip_utm)
    ways = [(e, L.intersection(clip_utm)) for e, L in _ways_by_names(osm, spec['via'])]
    ways = [(e, L) for e, L in ways if not L.is_empty and L.length > 5]
    if not ways:
        return [], [f"via não encontrada no OSM: {spec['via'][0]}"]
    sel = None
    p_de = p_ate = None
    if spec.get('de') is not None or spec.get('ate') is not None:
        lines = []
        for _, L in ways:
            lines.extend([g for g in getattr(L, 'geoms', [L]) if g.geom_type == 'LineString'])
        merged = linemerge(unary_union(lines))
        comps = [g for g in getattr(merged, 'geoms', [merged]) if g.geom_type == 'LineString']
        tol = float(spec.get('tolerancia_m', 60))
        A = _anchor_points(osm, comps, spec.get('de'), tol)
        B = _anchor_points(osm, comps, spec.get('ate'), tol)
        if spec.get('ate_extremo') and not B:
            B = [_extreme_point(comps, spec['ate_extremo'])]
        if not A or not B:
            return [], [f"pontas do trecho não localizadas no OSM: {spec['via'][0]} (de={spec.get('de')}, ate={spec.get('ate')})"]
        directed = []
        for e, L in ways:
            ow = is_oneway(e['tags']) != 0
            directed.extend((g, ow) for g in getattr(L, 'geoms', [L]) if g.geom_type == 'LineString')

        def best_path(P, Q):
            best = None
            for a in P[:7]:
                for b in Q[:7]:
                    pth = _shortest_path(directed, a, b)
                    if pth is not None and pth.length >= 10 and (best is None or pth.length < best[0].length):
                        best = (pth, a, b)
            return best
        fw = best_path(A, B)
        bw = None if spec.get('sentido') else best_path(B, A)   # pista do sentido contrário (pista dupla)
        if fw is None and bw is None:
            return [], [f"trecho vazio: {spec['via'][0]} entre {spec.get('de')} e {spec.get('ate')}"]
        if fw is not None:
            path, p_de, p_ate = fw
        else:
            path, p_ate, p_de = bw
        paths = [x[0] for x in (fw, bw) if x is not None]
        sel = unary_union(paths).buffer(float(spec.get('largura_m', 6)), cap_style=2)
    feats = []
    vec = None
    if spec.get('sentido') and p_de is not None:
        vec = (p_ate.x - p_de.x, p_ate.y - p_de.y)
    for e, L in ways:
        G = L.intersection(sel) if sel is not None else L
        for g in [g for g in getattr(G, 'geoms', [G]) if g.geom_type == 'LineString' and g.length >= 10]:
            ow = is_oneway(e['tags']) != 0
            coords = list(g.coords)
            if vec is not None:
                dx, dy = coords[-1][0] - coords[0][0], coords[-1][1] - coords[0][1]
                same = dx * vec[0] + dy * vec[1] >= 0
                if ow and not same:
                    continue            # pista do outro sentido: livre
                if not ow and not same:
                    coords = coords[::-1]
            feats.append({
                'geometry': round_geojson(to_ll(LineString(coords)).__geo_interface__),
                'osm_way_id': e['id'], 'nome_osm': e['tags'].get('name'), 'mao_unica': ow,
                'sentido': 'unico' if (vec is not None or ow) else 'ambos', 'comprimento_m': round(g.length),
            })
    if not feats:
        issues.append(f"nenhum trecho resultante: {spec['via'][0]}")
    return feats, issues


def _trecho_valhalla(spec, clip_utm):
    """Trecho definido por dois pontos (lon/lat) e percorrido pela malha do Valhalla (auto) nos dois sentidos —
    para trechos em que a via não tem nome no OSM ou as pontas não existem como cruzamento."""
    import requests
    from shapely.geometry import LineString
    url = os.environ.get('VALHALLA_URL', 'http://valhalla:8002')
    a, b = spec['de']['lonlat'], spec['ate']['lonlat']
    feats = []
    for o, d in ([(a, b)] if spec.get('sentido') else [(a, b), (b, a)]):
        body = {'locations': [{'lon': o[0], 'lat': o[1]}, {'lon': d[0], 'lat': d[1]}], 'costing': 'auto', 'units': 'kilometers'}
        r = requests.post(f'{url}/route', json=body, timeout=60).json()
        if 'trip' not in r:
            return [], [f"Valhalla sem rota para o trecho {spec['via'][0]}"]
        coords = [c for leg in r['trip']['legs'] for c in _decode6(leg['shape'])]
        from shapely.geometry import Point
        corr = to_utm(LineString([a, b])).buffer(float(spec.get('corredor_m', 150)))   # descarta desvios da rota
        g = to_utm(LineString(coords)).intersection(clip_utm).intersection(corr)
        for part in [x for x in getattr(g, 'geoms', [g]) if x.geom_type == 'LineString' and x.length >= 10]:
            feats.append({'geometry': round_geojson(to_ll(part).__geo_interface__), 'osm_way_id': None, 'nome_osm': spec['via'][0],
                          'mao_unica': True, 'sentido': 'unico', 'comprimento_m': round(part.length)})
    return feats, []


def _decode6(s):
    idx = lat = lng = 0; out = []
    while idx < len(s):
        vals = []
        for _ in (0, 1):
            shift = res = 0
            while True:
                c = ord(s[idx]) - 63; idx += 1; res |= (c & 0x1f) << shift; shift += 5
                if c < 0x20:
                    break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]; lng += vals[1]; out.append((lng / 1e6, lat / 1e6))
    return out


def _shortest_path(lines, a, b):
    """Caminho mais curto (Dijkstra) entre os vértices mais próximos de a e b na malha da própria via.
    `lines`: LineStrings (sem sentido) ou pares (LineString, mão_única) — mão única só é percorrida no sentido do desenho."""
    import heapq
    from shapely.geometry import LineString
    key = lambda c: (round(c[0], 1), round(c[1], 1))
    adj: dict = {}
    for item in lines:
        L, ow = item if isinstance(item, tuple) else (item, False)
        cs = [key(c) for c in L.coords]
        for u, v in zip(cs[:-1], cs[1:]):
            w = ((u[0] - v[0]) ** 2 + (u[1] - v[1]) ** 2) ** 0.5
            adj.setdefault(u, []).append((v, w)); adj.setdefault(v, [])
            if not ow:
                adj[v].append((u, w))
    if not adj:
        return None
    # costura vértices a até 4 m (pontas soltas no recorte municipal); não liga pistas opostas de via dupla
    nodes = list(adj)
    for i, u in enumerate(nodes):
        for v in nodes[i + 1:]:
            if abs(u[0] - v[0]) < 4 and abs(u[1] - v[1]) < 4:
                d = ((u[0] - v[0]) ** 2 + (u[1] - v[1]) ** 2) ** 0.5
                if 0 < d < 4:
                    adj[u].append((v, d)); adj[v].append((u, d))
    near = lambda p: min(nodes, key=lambda n: (n[0] - p.x) ** 2 + (n[1] - p.y) ** 2)
    s, t = near(a), near(b)
    dist, prev, pq = {s: 0.0}, {}, [(0.0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == t:
            break
        if d > dist.get(u, 1e18):
            continue
        for v, w in adj[u]:
            if d + w < dist.get(v, 1e18):
                dist[v] = d + w; prev[v] = u; heapq.heappush(pq, (d + w, v))
    if t not in dist:
        return None
    seq = [t]
    while seq[-1] != s:
        seq.append(prev[seq[-1]])
    seq.reverse()
    return LineString(seq) if len(seq) >= 2 else None


def _extreme_point(comps, which: str):
    from shapely.geometry import Point
    ends = [Point(c.coords[0]) for c in comps] + [Point(c.coords[-1]) for c in comps]
    key = {'leste': lambda p: p.x, 'oeste': lambda p: -p.x, 'norte': lambda p: p.y, 'sul': lambda p: -p.y}[which]
    return max(ends, key=key)


def rebuild_requested() -> bool:
    return os.environ.get('MUNICIPIOS_REBUILD') == '1' or os.environ.get('RMSP_REBUILD') == '1'


def build_or_load(rel: str, builder) -> dict:
    """Lê o GeoJSON curado; se não existir (ou MUNICIPIOS_REBUILD=1), constrói com `builder()` e grava."""
    p = raw_path(rel)
    if p.exists() and not rebuild_requested():
        return json.loads(p.read_text())
    fc = builder()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    return fc


def street_rules_fc(rules: list[dict], ibge: str, osm_loader) -> dict:
    """Constrói o GeoJSON curado (vias) a partir dos `trechos` das regras ({id, trechos}) de um município.
    O OSM só é consultado quando algum trecho não é `caminho: valhalla`."""
    clip = to_utm(municipio_geom(ibge)).buffer(40)
    precisa_osm = any(t.get('caminho') != 'valhalla' for r in rules for t in r.get('trechos', []))
    osm = osm_loader() if precisa_osm else []
    feats, issues = [], []
    for r in rules:
        rid = r['id']
        for t in r.get('trechos', []):
            fs, iss = build_trecho(osm, t, clip)
            issues.extend(f'{rid} inc. {t.get("inciso")}: {i}' for i in iss)
            for f in fs:
                g = f.pop('geometry')
                feats.append({'type': 'Feature', 'geometry': g, 'properties': {
                    'regra_id': rid, 'inciso': t.get('inciso'), 'via': t['via'][0], 'trecho': t.get('descricao'),
                    'aproximado': bool(t.get('aproximado')), 'nota_trecho': t.get('nota'), **f}})
    return {'type': 'FeatureCollection', 'features': feats, 'pendencias': issues,
            'gerado_em': time.strftime('%Y-%m-%d'), 'fonte_geometria': 'OpenStreetMap (ODbL 1.0) via Overpass'}


# Tamanho máximo de cada linha de custo. O routing.ts (usesCostLine) e o annotate da camada consideram que a rota "usa"
# o trecho quando >= 50% da linha fica a até 15 m dela: com linhas longas (cadeias de vários km), uma rota que roda
# 2 km de uma via de 5 km não passava do critério e o trecho proibido ficava sem aviso. Por isso as vias são cortadas
# em pedaços de até ~400 m e o encadeamento de trechos contíguos para nesse limite.
MAX_PIECE_M = 400.0
MAX_PIECE_PTS = 40
# linhas que não puderam ser testadas no Valhalla (timeout/erro de conexão) acima deste número abortam o import
MAX_UNTESTED = 5


def _dist_m(a, b) -> float:
    import math
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((b[0] - a[0]) * 111320.0 * math.cos(lat), (b[1] - a[1]) * 110540.0)


def line_length_m(c) -> float:
    return sum(_dist_m(a, b) for a, b in zip(c[:-1], c[1:]))


def split_long(c: list, max_m: float = MAX_PIECE_M) -> list[list]:
    """Corta a linha em pedaços de comprimento parecido e <= max_m (pontos interpolados no próprio eixo; o edge walk
    do Valhalla aceita início/fim no meio da aresta — testado)."""
    total = line_length_m(c)
    if total <= max_m * 1.1 or len(c) < 2:
        return [c]
    import math
    n = math.ceil(total / max_m)
    step = total / n
    pieces, cur, acc, k = [], [list(c[0])], 0.0, 1
    for a, b in zip(c[:-1], c[1:]):
        d = _dist_m(a, b)
        while k < n and d > 0 and acc + d >= k * step - 1e-6:
            t = (k * step - acc) / d
            p = [round(a[0] + (b[0] - a[0]) * t, 7), round(a[1] + (b[1] - a[1]) * t, 7)]
            if _dist_m(cur[-1], p) > 0.5:
                cur.append(p)
            else:
                p = cur[-1]            # corte cai num vértice existente
            if len(cur) >= 2:
                pieces.append(cur)
            cur, k = [p], k + 1
        if list(cur[-1]) != list(b):
            cur.append(list(b))
        acc += d
    if len(cur) >= 2 and line_length_m(cur) > 1:
        pieces.append(cur)
    elif pieces:
        pieces[-1].extend(cur[1:])
    return pieces or [c]


def valhalla_check(feats: list[dict]) -> list[dict]:
    """linear_cost_factors do Valhalla exige que a linha 'ande' pelas arestas do grafo (senão o /route inteiro falha com
    'Failed to edge walk line feature', error_code 233). Antes do teste, cada parte de MultiLineString vira feição própria
    e as linhas longas são cortadas (MAX_PIECE_M). Testa cada linha (e o sentido contrário, quando a via é de mão dupla);
    a que falha é reencaixada com trace_attributes (map_snap) e, se ainda falhar, descartada. Erro de rede/timeout:
    tenta de novo; se não der para testar, a linha é tratada como falha (nunca entra sem teste) e, acima de MAX_UNTESTED,
    o import aborta. Sem Valhalla, não valida (avisa e marca valhalla_validado=false)."""
    import requests
    import threading
    from concurrent.futures import ThreadPoolExecutor
    url = os.environ.get('VALHALLA_URL', 'http://valhalla:8002')
    feats = explode_and_split(feats)
    try:
        requests.get(f'{url}/status', timeout=5).raise_for_status()
    except Exception:
        print('  ! Valhalla indisponível: linhas NÃO validadas para linear_cost_factors')
        for f in feats:
            if f['kind'] == 'via':
                f['props']['valhalla_validado'] = False
        return feats
    lock = threading.Lock()
    untested: list[str] = []

    def ok(c) -> bool | None:
        """True = linha aceita; False = edge walk falhou; None = não deu para testar (rede/timeout/5xx)."""
        a, b = c[0], c[-1]
        body = {'locations': [{'lat': a[1], 'lon': a[0]}, {'lat': b[1], 'lon': b[0]}], 'costing': 'auto',
                'linear_cost_factors': [{'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': c}, 'properties': {'factor': 2}}]}
        for attempt in range(3):
            try:
                r = requests.post(f'{url}/route', json=body, timeout=60)
            except Exception:
                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code >= 500:
                time.sleep(2 * (attempt + 1))
                continue
            # o edge walk das linhas é feito antes de localizar os pontos: qualquer outra resposta = linha aceita
            return not ('"error_code":233' in r.text.replace(' ', '') or 'edge walk' in r.text)
        return None

    def tested(c, sid) -> bool:
        r = ok(c)
        if r is None:
            with lock:
                untested.append(sid)
            return False
        return r

    def snap(c):
        body = {'shape': [{'lat': y, 'lon': x} for x, y in c], 'costing': 'auto', 'shape_match': 'map_snap',
                'trace_options': {'search_radius': 15}, 'filters': {'attributes': ['shape'], 'action': 'include'}}
        for attempt in range(2):
            try:
                r = requests.post(f'{url}/trace_attributes', json=body, timeout=60).json()
                return [[round(x, 6), round(y, 6)] for x, y in _decode6(r['shape'])] if 'shape' in r else None
            except Exception:
                time.sleep(2)
        return None

    def check(f):
        if f['kind'] != 'via':
            return [f], []
        c = f['geometry']['coordinates']
        two = f['props'].get('sentido') != 'unico' and not f['props'].get('mao_unica')
        if not tested(c, f['source_id']):
            c2 = snap(c)
            if not c2 or len(c2) < 2 or not tested(c2, f['source_id']):
                return [], [f"{f['props'].get('via') or f['props'].get('nome_osm')} (inc. {f['props'].get('inciso')})"]
            c = c2
        f['geometry'] = {'type': 'LineString', 'coordinates': c}
        f['props']['valhalla_validado'] = True
        if not two or tested(c[::-1], f['source_id']):
            return [f], []
        # o sentido contrário não casou com a mesma linha: vira feição própria (reencaixada) e esta fica de sentido único
        r2 = snap(c[::-1])
        f['props']['sentido'] = 'unico'
        if r2 and len(r2) >= 2 and tested(r2, f['source_id']):
            return [f, {**f, 'source_id': f['source_id'] + '-r', 'geometry': {'type': 'LineString', 'coordinates': r2},
                        'props': {**f['props'], 'sentido': 'unico'}}], []
        return [f], [f"{f['props'].get('via') or f['props'].get('nome_osm')} (inc. {f['props'].get('inciso')}, sentido contrário)"]

    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(check, feats))
    if len(set(untested)) > MAX_UNTESTED:
        raise RuntimeError(f'{len(set(untested))} linhas não puderam ser testadas no Valhalla ({url}): import abortado')
    if untested:
        print(f'  ! {len(set(untested))} linha(s) sem teste no Valhalla (rede/timeout): tratadas como falha')
    dropped = [x for _, d in res for x in d]
    if dropped:
        print(f'  ! {len(dropped)} trecho(s)/sentido(s) descartado(s), não casam com o grafo do Valhalla: {"; ".join(dropped)}')
    checked = [f for fs, _ in res for f in fs]
    merged = merge_chains(checked, lambda c: ok(c) is True)
    print(f'    vias: {sum(1 for f in checked if f["kind"] == "via")} linhas -> {sum(1 for f in merged if f["kind"] == "via")} após encadear '
          f'(máx. {MAX_PIECE_M:.0f} m por linha)')
    return merged


def explode_and_split(feats: list[dict]) -> list[dict]:
    """Uma feição por LineString (as partes de um MultiLineString não compartilham mais o 'sentido') e linhas longas
    cortadas em pedaços de até MAX_PIECE_M."""
    out = []
    for f in feats:
        g = f['geometry']
        if f['kind'] != 'via' or g['type'] not in ('LineString', 'MultiLineString'):
            out.append(f)
            continue
        parts = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for i, part in enumerate(parts):
            pieces = split_long(part)
            for j, c in enumerate(pieces):
                sid = f['source_id'] + (f'-p{i}' if len(parts) > 1 else '') + (f'-s{j}' if len(pieces) > 1 else '')
                props = {**f['props'], 'comprimento_m': round(line_length_m(c))}
                if len(pieces) > 1:
                    props['pedaco'] = f'{j + 1}/{len(pieces)}'
                out.append({**f, 'source_id': sid, 'geometry': {'type': 'LineString', 'coordinates': c}, 'props': props})
    return out


def merge_chains(feats: list[dict], ok) -> list[dict]:
    """Encadeia trechos contíguos (fim de um = início do outro) da mesma regra/inciso/via num só LineString, sem passar
    de MAX_PIECE_M nem de MAX_PIECE_PTS vértices (ver MAX_PIECE_M). Menos linhas no request ao Valhalla e menos avisos
    repetidos. Só aceita a cadeia se ela (e o sentido contrário, para mão dupla) passar no teste de 'edge walk'; senão
    mantém os trechos originais."""
    from collections import defaultdict
    from concurrent.futures import ThreadPoolExecutor
    k = lambda p: (round(p[0], 6), round(p[1], 6))
    groups, out = defaultdict(list), []
    for f in feats:
        p = f['props']
        if f['kind'] != 'via' or f['geometry']['type'] != 'LineString':
            out.append(f); continue
        two = p.get('sentido') != 'unico' and not p.get('mao_unica')
        groups[(p.get('regra_id'), p.get('inciso'), p.get('via') or p.get('nome_osm'), two)].append(f)
    jobs = []
    for (_, _, _, two), fs in groups.items():
        segs = [(f, list(f['geometry']['coordinates'])) for f in fs]
        used = [False] * len(segs)
        for i in range(len(segs)):
            if used[i]: continue
            used[i] = True
            chain, members = list(segs[i][1]), [segs[i][0]]
            length = line_length_m(chain)
            grown = True
            while grown:
                grown = False
                for j in range(len(segs)):
                    if used[j]: continue
                    c = segs[j][1]
                    lc = line_length_m(c)
                    if length + lc > MAX_PIECE_M or len(chain) + len(c) - 1 > MAX_PIECE_PTS: continue
                    if k(c[0]) == k(chain[-1]): chain += c[1:]
                    elif two and k(c[-1]) == k(chain[-1]): chain += c[::-1][1:]
                    elif k(c[-1]) == k(chain[0]): chain = c + chain[1:]
                    elif two and k(c[0]) == k(chain[0]): chain = c[::-1] + chain[1:]
                    else: continue
                    used[j] = True; members.append(segs[j][0]); grown = True; length += lc
            jobs.append((members, chain, two))

    def build(job):
        members, chain, two = job
        if len(members) == 1 or not ok(chain) or (two and not ok(chain[::-1])):
            return members
        f0 = members[0]
        props = {**f0['props'], 'comprimento_m': round(line_length_m(chain)),
                 'osm_way_ids': sorted({m['props'].get('osm_way_id') for m in members if m['props'].get('osm_way_id')}),
                 'trechos_encadeados': len(members)}
        props.pop('pedaco', None)
        return [{**f0, 'source_id': stable_id(*[m['source_id'] for m in members]), 'geometry': {'type': 'LineString', 'coordinates': chain}, 'props': props}]

    with ThreadPoolExecutor(8) as ex:
        for fs in ex.map(build, jobs):
            out.extend(fs)
    return out


# ----------------------------------------------------------------------------- vias no entorno de um ponto (trevo)
def entorno_fc(rule_id: str, cfg: dict) -> dict:
    """Vias a até `raio_m` de `centro` ([lon, lat]): ramos (classes em `classes_ramo`, ex.: *_link) e vias com os nomes de
    `vias`, sem rodovias (motorway/trunk) nem os nomes de `excluir_nomes`. Para zonas desenhadas só como imagem em torno
    de um cruzamento (ex.: ZRCC-TB de Guarulhos, trevo de Bonsucesso): as pistas principais continuam livres."""
    from shapely.geometry import LineString, Point
    lon, lat = cfg['centro']
    raio = float(cfg['raio_m'])
    c = to_utm(Point(lon, lat)).buffer(raio)
    pad_lat, pad_lon = (raio + 450) / 111000.0, (raio + 450) / 96000.0
    osm = overpass_bbox_ways((lat - pad_lat, lon - pad_lon, lat + pad_lat, lon + pad_lon), f'entorno_{rule_id}')
    vias = {norm(n) for n in cfg.get('vias', [])}
    excl = {norm(n) for n in cfg.get('excluir_nomes', [])}
    classes = set(cfg.get('classes_ramo', []))
    feats = []
    for e in osm:
        t = e.get('tags', {})
        nm = norm(t.get('name'))
        if nm in excl or t.get('highway') in ('motorway', 'trunk'):
            continue
        if not (t.get('highway') in classes or nm in vias):
            continue
        L = to_utm(LineString([(n['lon'], n['lat']) for n in e['geometry']]))
        if is_oneway(t) == -1:
            L = LineString(list(L.coords)[::-1])
        G = L.intersection(c)
        for g in [g for g in getattr(G, 'geoms', [G]) if g.geom_type == 'LineString' and g.length >= 10]:
            ow = is_oneway(t) != 0
            feats.append({'type': 'Feature', 'geometry': round_geojson(to_ll(g).__geo_interface__), 'properties': {
                'regra_id': rule_id, 'inciso': cfg.get('inciso'), 'via': t.get('name') or (cfg.get('nome_ramo', 'alça') if 'link' in t.get('highway', '') else None),
                'nome_osm': t.get('name'), 'osm_way_id': e['id'], 'highway': t.get('highway'), 'mao_unica': ow,
                'sentido': 'unico' if ow else 'ambos', 'comprimento_m': round(g.length), 'aproximado': bool(cfg.get('aproximado', True))}})
    return {'type': 'FeatureCollection', 'features': feats, 'fonte_geometria': 'OpenStreetMap (ODbL 1.0) via Overpass'}
