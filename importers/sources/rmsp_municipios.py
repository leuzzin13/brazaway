"""Camada restricoes_rmsp — base comum + limites municipais (IBGE) + registro da restrição REVOGADA do ABC (2012).

Este módulo é ao mesmo tempo:
  * o importador `rmsp_municipios` (SOURCE='ibge'): grava os limites dos 39 municípios da RMSP (kind='municipio'),
    usados pela API para saber em que município está a origem/destino (exceção de destino local, feriado
    municipal) e um registro kind='revogada' para a restrição regional do ABC de 2012 (nunca aplicada);
  * a biblioteca dos demais importadores rmsp_* (regras em data/raw/rmsp/regras.json, geometria curada em
    data/raw/rmsp/*.geojson, construtor de trechos "rua X entre Y e Z" a partir do OSM).

Regras legais (horários, dimensões, VUC, exceções) ficam em data/raw/rmsp/regras.json, cada uma com o ato, o artigo
e a URL da fonte primária conferida. A geometria das vias vem do OSM (ODbL) casada pelo NOME e pelo TRECHO do
decreto; a de Osasco vem do mapa oficial georreferenciado (data/raw/rmsp/curadoria/osasco_georef.py).
Os GeoJSON curados são versionados: o import é determinístico e não depende do Overpass. Para refazer a geometria
de um município a partir do OSM, apague o GeoJSON curado (ou rode com RMSP_REBUILD=1): o importador consulta o
Overpass (cache em data/cache/rmsp/) e regrava o arquivo.
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
SOURCE = 'ibge'
SOURCE_URL = ('https://servicodados.ibge.gov.br/api/v3/malhas/estados/SP?formato=application/vnd.geo%2Bjson'
              '&qualidade=maxima&intrarregiao=municipio (39 municípios da RMSP, simplificado a ~10 m)')
LICENSE = 'IBGE — Malha Municipal (dados públicos, uso livre com citação da fonte: IBGE)'
NOTES = ('Limites municipais para localizar origem/destino (exceção de destino local e feriado municipal) e o registro '
         'da restrição regional do ABC de 2012, CANCELADA pelo Consórcio Intermunicipal antes de vigorar (kind=revogada, não aplicada).')

RAW = pathlib.Path(os.environ.get('RMSP_RAW_DIR', str(DATA_DIR / 'raw' / 'rmsp')))
CACHE = DATA_DIR / 'cache' / 'rmsp'
OVERPASS = os.environ.get('OVERPASS_URL', 'https://overpass-api.de/api/interpreter')
ABC_IBGE = {'3547809': 'Santo André', '3548708': 'São Bernardo do Campo', '3548807': 'São Caetano do Sul', '3513801': 'Diadema'}


# ----------------------------------------------------------------------------- utilidades
def norm(s: str | None) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"[’'`´.]", '', s)
    return re.sub(r'\s+', ' ', s).strip()


def load_rules() -> dict:
    return json.loads((RAW / 'regras.json').read_text())


def rule(rule_id: str) -> dict:
    r = load_rules()['regras'][rule_id]
    return {'regra_id': rule_id, **{k: v for k, v in r.items() if k != 'trechos'}}


def municipios() -> list[dict]:
    return json.loads((RAW / 'ibge_rmsp_municipios.geojson').read_text())['features']


def municipio_geom(ibge: str):
    from shapely.geometry import shape
    for f in municipios():
        if f['properties']['ibge'] == ibge:
            return shape(f['geometry'])
    raise KeyError(ibge)


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


def curated_path(name: str) -> pathlib.Path:
    return RAW / name


def build_or_load(name: str, builder) -> dict:
    """Lê o GeoJSON curado; se não existir (ou RMSP_REBUILD=1), constrói com `builder()` e grava."""
    p = curated_path(name)
    if p.exists() and os.environ.get('RMSP_REBUILD') != '1':
        return json.loads(p.read_text())
    fc = builder()
    p.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    return fc


def street_rules_fc(rule_ids: list[str], ibge: str, osm_loader) -> dict:
    """Constrói o GeoJSON curado (vias) de um município a partir dos trechos de regras.json."""
    regras = load_rules()['regras']
    clip = to_utm(municipio_geom(ibge)).buffer(40)
    osm = osm_loader()
    feats, issues = [], []
    for rid in rule_ids:
        for t in regras[rid].get('trechos', []):
            fs, iss = build_trecho(osm, t, clip)
            issues.extend(f'{rid} inc. {t.get("inciso")}: {i}' for i in iss)
            for f in fs:
                g = f.pop('geometry')
                feats.append({'type': 'Feature', 'geometry': g, 'properties': {
                    'regra_id': rid, 'inciso': t.get('inciso'), 'via': t['via'][0], 'trecho': t.get('descricao'),
                    'aproximado': bool(t.get('aproximado')), 'nota_trecho': t.get('nota'), **f}})
    return {'type': 'FeatureCollection', 'features': feats, 'pendencias': issues,
            'gerado_em': time.strftime('%Y-%m-%d'), 'fonte_geometria': 'OpenStreetMap (ODbL 1.0) via Overpass'}


def features_from_fc(fc: dict, kind_default: str = 'via') -> list[dict]:
    """Junta geometria curada + regra (regras.json) em feições do runner."""
    regras = load_rules()
    out = []
    for i, f in enumerate(fc['features']):
        p = dict(f['properties'])
        rid = p['regra_id']
        r = rule(rid)
        status = r.get('status', 'vigente')
        nome = p.get('via') or p.get('nome_osm') or 'via sem nome no OSM'
        out.append({
            'source_id': stable_id(rid, p.get('inciso'), p.get('osm_way_id'), i, json.dumps(f['geometry'])[:200]),
            'geometry': f['geometry'],
            'name': f"{r['municipio']}: {r['regime']} — {nome}" if r.get('tipo') == 'via' else r['nome'],
            'kind': r.get('tipo', kind_default) if status == 'vigente' else 'revogada',
            'props': {**r, **{k: v for k, v in p.items() if k != 'regra_id'}, 'verificado_em': regras.get('verificado_em')},
            'valid_from': r.get('vigencia_inicio'), 'valid_to': r.get('vigencia_fim'),
        })
    return valhalla_check(out)


def valhalla_check(feats: list[dict]) -> list[dict]:
    """linear_cost_factors do Valhalla exige que a linha 'ande' pelas arestas do grafo (senão o /route inteiro falha com
    'Failed to edge walk line feature'). Testa cada linha (e o sentido contrário, quando a via é de mão dupla); a que falha
    é reencaixada com trace_attributes (map_snap) e, se ainda falhar, descartada. Sem Valhalla, não valida (avisa)."""
    import requests
    from concurrent.futures import ThreadPoolExecutor
    url = os.environ.get('VALHALLA_URL', 'http://valhalla:8002')
    try:
        requests.get(f'{url}/status', timeout=5).raise_for_status()
    except Exception:
        print('  ! Valhalla indisponível: linhas NÃO validadas para linear_cost_factors')
        return feats

    def ok(c) -> bool:
        a = c[len(c) // 2]
        body = {'locations': [{'lat': a[1], 'lon': a[0]}, {'lat': a[1] + 0.001, 'lon': a[0] + 0.001}], 'costing': 'auto',
                'linear_cost_factors': [{'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': c}, 'properties': {'factor': 2}}]}
        try:
            r = requests.post(f'{url}/route', json=body, timeout=60)
            return not (r.status_code == 400 and 'edge walk' in r.text)
        except Exception:
            return True

    def snap(c):
        body = {'shape': [{'lat': y, 'lon': x} for x, y in c], 'costing': 'auto', 'shape_match': 'map_snap',
                'trace_options': {'search_radius': 15}, 'filters': {'attributes': ['shape'], 'action': 'include'}}
        try:
            r = requests.post(f'{url}/trace_attributes', json=body, timeout=60).json()
            return [[round(x, 6), round(y, 6)] for x, y in _decode6(r['shape'])] if 'shape' in r else None
        except Exception:
            return None

    def check(f):
        if f['kind'] != 'via':
            return [f], 0
        g = f['geometry']
        parts = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        two = f['props'].get('sentido') != 'unico' and not f['props'].get('mao_unica')
        good, rev_extra, dropped = [], [], 0
        for c in parts:
            if not ok(c):
                c2 = snap(c)
                if not c2 or len(c2) < 2 or not ok(c2):
                    dropped += 1
                    continue
                c = c2
            good.append(c)
            if two and not ok(c[::-1]):
                r2 = snap(c[::-1])
                rev_extra.append(r2 if r2 and len(r2) >= 2 and ok(r2) else None)
        if not good:
            return [], dropped
        f['geometry'] = {'type': 'LineString', 'coordinates': good[0]} if len(good) == 1 else {'type': 'MultiLineString', 'coordinates': good}
        f['props']['valhalla_validado'] = True
        out = [f]
        if rev_extra:
            # o sentido contrário não casou com a mesma linha: vira feição própria (reencaixada) e esta fica de sentido único
            f['props']['sentido'] = 'unico'
            for k, r2 in enumerate(x for x in rev_extra if x):
                out.append({**f, 'source_id': f['source_id'] + f'-r{k}', 'geometry': {'type': 'LineString', 'coordinates': r2},
                            'props': {**f['props'], 'sentido': 'unico'}})
            dropped += sum(1 for x in rev_extra if x is None)
        return out, dropped

    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(check, feats))
    dropped = sum(d for _, d in res)
    if dropped:
        print(f'  ! {dropped} trecho(s) descartado(s): não casam com o grafo do Valhalla')
    checked = [f for fs, _ in res for f in fs]
    merged = merge_chains(checked, ok)
    print(f'    vias: {sum(1 for f in checked if f["kind"] == "via")} trechos -> {sum(1 for f in merged if f["kind"] == "via")} após encadear')
    return merged


def merge_chains(feats: list[dict], ok) -> list[dict]:
    """Encadeia trechos contíguos (fim de um = início do outro, mesmo nó do OSM) da mesma regra/inciso/via num só
    LineString. Menos linhas no request ao Valhalla e menos avisos repetidos. Só aceita a cadeia se ela (e o sentido
    contrário, para mão dupla) passar no teste de 'edge walk'; senão mantém os trechos originais."""
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
            grown = True
            while grown:
                grown = False
                for j in range(len(segs)):
                    if used[j]: continue
                    c = segs[j][1]
                    if k(c[0]) == k(chain[-1]): chain += c[1:]
                    elif two and k(c[-1]) == k(chain[-1]): chain += c[::-1][1:]
                    elif k(c[-1]) == k(chain[0]): chain = c + chain[1:]
                    elif two and k(c[0]) == k(chain[0]): chain = c[::-1] + chain[1:]
                    else: continue
                    used[j] = True; members.append(segs[j][0]); grown = True
            jobs.append((members, chain, two))

    def build(job):
        members, chain, two = job
        if len(members) == 1 or not ok(chain) or (two and not ok(chain[::-1])):
            return members
        f0 = members[0]
        props = {**f0['props'], 'comprimento_m': sum(m['props'].get('comprimento_m') or 0 for m in members),
                 'osm_way_ids': sorted({m['props'].get('osm_way_id') for m in members if m['props'].get('osm_way_id')}),
                 'trechos_encadeados': len(members)}
        return [{**f0, 'source_id': stable_id(*[m['source_id'] for m in members]), 'geometry': {'type': 'LineString', 'coordinates': chain}, 'props': props}]

    with ThreadPoolExecutor(8) as ex:
        for fs in ex.map(build, jobs):
            out.extend(fs)
    return out


# ----------------------------------------------------------------------------- importador 'ibge'
def fetch():
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union
    out = []
    for f in municipios():
        p = f['properties']
        out.append({'source_id': f"mun-{p['ibge']}", 'geometry': f['geometry'], 'name': p['nome'], 'kind': 'municipio',
                    'props': {'ibge': p['ibge'], 'municipio': p['nome'], 'fonte': 'IBGE Malha Municipal'}})
    # restrição regional do ABC (2012): cancelada antes de vigorar — registro histórico, nunca aplicada
    abc = [shape(f['geometry']) for f in municipios() if f['properties']['ibge'] in ABC_IBGE]
    if abc:
        g = unary_union(abc).simplify(0.002)
        r = rule('abc_2012')
        out.append({'source_id': 'abc-2012-revogada', 'geometry': round_geojson(mapping(g), 5), 'name': r['nome'], 'kind': 'revogada',
                    'props': {**r, 'verificado_em': load_rules().get('verificado_em')},
                    'valid_from': r.get('vigencia_inicio'), 'valid_to': r.get('vigencia_fim')})
    return out
