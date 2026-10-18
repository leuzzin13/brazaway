"""Geometria das regras de trecho dos DERs do Sul e do Centro-Oeste (PR, SC, RS, GO, MT, MS, DF). Não é uma fonte (o runner
ignora módulos com `_`).

Os atos desses órgãos citam o trecho por rodovia + entroncamento/cidade (e, em parte, código SRE + km), sem geometria. A
geometria vem do OpenStreetMap (os mesmos ways que o Valhalla usa, então a rota do app e o trecho coincidem): os ways com
`ref` = código da rodovia ("PR-534", "ERS-389", "GO-020"...), o caminho mais curto entre dois pontos de ancoragem
(coordenadas conferidas em nós `place=*` do OSM ou no cruzamento com outra rodovia) e, de bônus, as pistas paralelas.

Especificação de `geometria` em regras.json:
  {"osm_ref": ["PR-534"],                      # refs OSM dos ways do trecho (as pistas e variantes com o mesmo ref)
   "de":   {"lon": -51.99, "lat": -22.81, "nome": "Centenário do Sul"} | {"cruza": "BR-277", "perto": [lon, lat]},
   "para": {...},                              # sem de/para: todos os ways do ref (rodovia inteira)
   "extensao_km": 19.16,                       # opcional: extensão do ato, só para conferir (aviso se fugir mais de 25%)
   "via": [{...}],                             # opcional: pontos intermediários obrigatórios
   "inicio_km": 3.0,                           # opcional: o ato começa X km depois do 1º ponto
   "ultimos_km": 2.0,                          # opcional: só os últimos X km do caminho
   "lacuna_m": 200}                            # opcional: falha do ref no OSM que o caminho pode atravessar (padrão 200 m)

Âncoras: {"nome", "lon", "lat", "tol_m"?} (nó do ref mais próximo), {"cruza": "BR-277", "perto": [lon, lat]?} (cruzamento com
outra rodovia) ou {"extremo": "N"|"S"|"L"|"O"} (ponta do ref).

O índice de ways por ref sai do PBF do Valhalla (`osmium tags-filter w/ref`, ~5 min na 1ª vez) e fica em cache em
DATA_DIR/cache/ders_sulco_refidx.json.gz.
"""
from __future__ import annotations

import gzip
import heapq
import json
import math
import re
import subprocess
import tempfile

from common import CACHE_DIR, osm_pbf

PREFIXOS = ('PR', 'PRC', 'SC', 'SCT', 'RS', 'ERS', 'RSC', 'BRS', 'VRS', 'GO', 'MT', 'MS', 'DF', 'BR')
BBOX_SUL_CO = (-61.8, -34.0, -44.0, -7.0)    # lon_min, lat_min, lon_max, lat_max
CACHE_REFIDX = CACHE_DIR / 'ders_sulco_refidx.json.gz'
PARALELA_M = 60.0
_REF_RE = re.compile(r'^([A-Z]{2,3})-?(\d{1,4}[A-Z]?)$')

_idx: dict[str, list[dict]] | None = None


def norm_ref(r: str) -> str:
    m = _REF_RE.match(r.strip().upper().replace(' ', ''))
    return f'{m.group(1)}-{m.group(2)}' if m else r.strip().upper()


def _build_cache() -> dict[str, list[dict]]:
    pbf = osm_pbf()
    if not pbf:
        raise FileNotFoundError('PBF não encontrado: defina OSM_PBF ou gere data/osm/sse_co.osm.pbf')
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    idx: dict[str, list[dict]] = {}
    with tempfile.TemporaryDirectory() as tmp:
        filtrado = f'{tmp}/refways.osm.pbf'
        seq = f'{tmp}/refways.geojsonseq'
        print('  osmium tags-filter w/ref (1ª vez, alguns minutos)...')
        subprocess.run(['osmium', 'tags-filter', pbf, 'w/ref', '-o', filtrado, '--overwrite'], check=True)
        subprocess.run(['osmium', 'export', filtrado, '-f', 'geojsonseq', '-o', seq, '--overwrite'], check=True)
        with open(seq, encoding='utf-8') as f:
            for line in f:
                line = line.lstrip('\x1e').strip()
                if not line:
                    continue
                ft = json.loads(line)
                g, p = ft['geometry'], ft['properties']
                if g['type'] != 'LineString' or not p.get('highway'):
                    continue
                coords = [[round(x, 6), round(y, 6)] for x, y in g['coordinates']]
                if not (BBOX_SUL_CO[0] <= coords[0][0] <= BBOX_SUL_CO[2] and BBOX_SUL_CO[1] <= coords[0][1] <= BBOX_SUL_CO[3]):
                    continue
                for r in str(p.get('ref', '')).split(';'):
                    r = norm_ref(r)
                    m = _REF_RE.match(r)
                    if m and m.group(1) in PREFIXOS:
                        idx.setdefault(r, []).append({'hw': p['highway'], 'ow': p.get('oneway'), 'c': coords})
    with gzip.open(CACHE_REFIDX, 'wt', encoding='utf-8') as f:
        json.dump(idx, f, separators=(',', ':'))
    return idx


def refidx() -> dict[str, list[dict]]:
    global _idx
    if _idx is None:
        if CACHE_REFIDX.exists():
            with gzip.open(CACHE_REFIDX, 'rt', encoding='utf-8') as f:
                _idx = json.load(f)
        else:
            _idx = _build_cache()
    return _idx


# ------------------------------------------------------------------------------------------------ geometria

def _dist_m(a, b) -> float:
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * 111320 * k, (a[1] - b[1]) * 110540)


def _grafo(refs: list[str], lacuna_m: float | None = None):
    adj: dict[tuple, list[tuple]] = {}
    ways = []
    for r in refs:
        for w in refidx().get(norm_ref(r), []):
            c = [tuple(p) for p in w['c']]
            ways.append(c)
            for a, b in zip(c, c[1:]):
                d = _dist_m(a, b)
                adj.setdefault(a, []).append((b, d))
                adj.setdefault(b, []).append((a, d))
    _costura_lacunas(adj, lacuna_m or LACUNA_M)
    return adj, ways


LACUNA_M = 200.0


def _costura_lacunas(adj, lacuna_m: float) -> None:
    """Une cada ponta solta (grau 1) ao vértice mais próximo de OUTRO componente a até `lacuna_m` (padrão LACUNA_M): o ref do
    OSM tem falhas curtas (um way do meio sem `ref`, um trevo) e o caminho mais curto não atravessaria."""
    comp: dict[tuple, int] = {}
    for n in adj:
        if n in comp:
            continue
        k = len(set(comp.values()))
        pilha = [n]
        comp[n] = k
        while pilha:
            u = pilha.pop()
            for v, _ in adj[u]:
                if v not in comp:
                    comp[v] = k
                    pilha.append(v)
    grade: dict[tuple[int, int], list[tuple]] = {}
    for n in adj:
        grade.setdefault((int(n[0] * 500), int(n[1] * 500)), []).append(n)
    raio = int(lacuna_m / 200) + 1     # célula de 0,002° ~ 200 m
    novas = []
    for n, vs in adj.items():
        if len(vs) != 1:
            continue
        gx, gy = int(n[0] * 500), int(n[1] * 500)
        melhor = None
        for dx in range(-raio, raio + 1):
            for dy in range(-raio, raio + 1):
                for m in grade.get((gx + dx, gy + dy), []):
                    if comp[m] == comp[n]:
                        continue
                    d = _dist_m(n, m)
                    if d <= lacuna_m and (melhor is None or d < melhor[1]):
                        melhor = (m, d)
        if melhor:
            novas.append((n, melhor[0], melhor[1]))
    for a, b, d in novas:
        adj[a].append((b, d))
        adj[b].append((a, d))


def _no_proximo(adj, ponto) -> tuple[tuple, float]:
    return min(((n, _dist_m(n, ponto)) for n in adj), key=lambda x: x[1])


def _ancora(spec: dict, adj, refs: list[str]) -> tuple[tuple, dict]:
    if spec.get('cruza'):
        outro = {tuple(p) for w in refidx().get(norm_ref(spec['cruza']), []) for p in w['c']}
        comuns = [n for n in adj if n in outro]
        if not comuns:
            raise ValueError(f'{refs}: sem cruzamento com {spec["cruza"]}')
        perto = spec.get('perto')
        if perto:
            n = min(comuns, key=lambda x: _dist_m(x, perto))
        else:
            # várias pontas do mesmo trevo (pistas duplas, alças): vale qualquer uma; cruzamentos distantes pedem "perto"
            n = comuns[0] if all(_dist_m(comuns[0], c) < 300 for c in comuns) else None
            if n is None:
                raise ValueError(f'{refs}: {len(comuns)} cruzamentos com {spec["cruza"]}; informe "perto"')
        return n, {'cruza': spec['cruza'], 'lon': n[0], 'lat': n[1]}
    if spec.get('extremo'):
        # ponta do ref na direção dada (N/S/L/O): divisa de estado, fim de rodovia
        eixo, sinal = {'N': (1, 1), 'S': (1, -1), 'L': (0, 1), 'O': (0, -1)}[spec['extremo']]
        n = max(adj, key=lambda x: sinal * x[eixo])
        return n, {'extremo': spec['extremo'], 'lon': n[0], 'lat': n[1]}
    p = (spec['lon'], spec['lat'])
    n, d = _no_proximo(adj, p)
    if d > spec.get('tol_m', 2500):
        raise ValueError(f'{refs}: âncora {spec.get("nome")} a {d:.0f} m do ref (limite {spec.get("tol_m", 2500)})')
    return n, {'nome': spec.get('nome'), 'lon': n[0], 'lat': n[1], 'dist_ancora_m': round(d)}


def _dijkstra(adj, a, b):
    dist = {a: 0.0}
    prev: dict = {}
    pq = [(0.0, a)]
    while pq:
        d, u = heapq.heappop(pq)
        if u == b:
            break
        if d > dist.get(u, 1e18):
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                prev[v] = u
                heapq.heappush(pq, (nd, v))
    if b not in dist:
        return None
    path = [b]
    while path[-1] != a:
        path.append(prev[path[-1]])
    return path[::-1], dist[b]


def _len_m(c) -> float:
    return sum(_dist_m(a, b) for a, b in zip(c, c[1:]))


def geometria_osm_ref(spec: dict) -> tuple[dict, dict]:
    """(MultiLineString, info) do trecho descrito por `spec` (ver o docstring do módulo). Levanta ValueError se não acha."""
    from shapely.geometry import LineString, Point
    refs = [norm_ref(r) for r in spec['osm_ref']]
    adj, ways = _grafo(refs, spec.get('lacuna_m'))
    if not adj:
        raise ValueError(f'nenhum way do OSM com ref {refs}')
    info: dict = {'metodo': 'ways do OSM com ref ' + '/'.join(refs), 'ways_ref': len(ways)}
    if not spec.get('de') and not spec.get('para'):
        linhas = [[list(p) for p in w] for w in ways]
        info['extensao_km'] = round(sum(_len_m(w) for w in ways) / 1000, 3)
        return {'type': 'MultiLineString', 'coordinates': linhas}, info
    pts = [spec['de']] + list(spec.get('via') or []) + [spec['para']]
    nos, ancoras = [], []
    for s in pts:
        n, a = _ancora(s, adj, refs)
        nos.append(n)
        ancoras.append(a)
    caminho: list[tuple] = []
    total = 0.0
    for a, b in zip(nos, nos[1:]):
        r = _dijkstra(adj, a, b)
        if not r:
            raise ValueError(f'sem caminho pelo ref {refs} entre {a} e {b}')
        caminho += r[0] if not caminho else r[0][1:]
        total += r[1]
    info['ancoras'] = ancoras
    ini_km = float(spec.get('inicio_km') or 0)
    if ini_km:
        # o ato começa X km depois do 1º ponto (ex.: Graciosa, restrição a partir do km 3 do trecho que nasce no km 0)
        acc, k = 0.0, 0
        while k < len(caminho) - 1 and acc + _dist_m(caminho[k], caminho[k + 1]) < ini_km * 1000:
            acc += _dist_m(caminho[k], caminho[k + 1])
            k += 1
        caminho = caminho[k:]
        total -= acc
        info['inicio_km'] = ini_km
    ult_km = float(spec.get('ultimos_km') or 0)
    if ult_km and total / 1000 > ult_km:
        # só o fim do caminho (ex.: a ponte na ponta de um trecho)
        acc, k = 0.0, len(caminho) - 1
        while k > 0 and acc + _dist_m(caminho[k - 1], caminho[k]) < ult_km * 1000:
            acc += _dist_m(caminho[k - 1], caminho[k])
            k -= 1
        caminho = caminho[k:]
        total = acc
        info['ultimos_km'] = ult_km
    info['extensao_km'] = round(total / 1000, 3)
    ext = spec.get('extensao_km')
    if ext:
        info['extensao_ato_km'] = ext
        if abs(total / 1000 - ext) / ext > 0.25:
            info['aviso'] = f'extensão pelo OSM ({total / 1000:.1f} km) difere mais de 25% da do ato ({ext} km)'
    # pistas paralelas: ways do mesmo ref com todos os vértices a até PARALELA_M do caminho
    k = math.cos(math.radians(caminho[0][1]))
    proj = lambda p: ((p[0]) * 111320 * k, (p[1]) * 110540)   # noqa: E731
    linha = LineString([proj(p) for p in caminho])
    usados = set(zip(caminho, caminho[1:])) | set(zip(caminho[1:], caminho))
    extras = []
    for w in ways:
        if len(w) < 2 or _len_m(w) < 20:
            continue
        if all(tuple(p) in set(caminho) for p in w):
            continue
        if any((a, b) in usados for a, b in zip(w, w[1:])):
            continue
        if all(Point(proj(p)).distance(linha) <= PARALELA_M for p in w):
            extras.append([list(p) for p in w])
    info['pistas_paralelas'] = len(extras)
    return {'type': 'MultiLineString', 'coordinates': [[list(p) for p in caminho]] + extras}, info


def _rota_carro(pontos: list[list[float]]) -> list[list[float]] | None:
    """Traçado de carro (costing auto) por todos os pontos [lon, lat] no grafo do Valhalla (OSM); None se o Valhalla não responder."""
    import os
    import requests
    from sources._ders import _decode6
    url = os.environ.get('VALHALLA_URL', 'http://valhalla:8002').rstrip('/')
    body = {'locations': [{'lon': p[0], 'lat': p[1]} for p in pontos], 'costing': 'auto', 'units': 'kilometers', 'directions_type': 'none'}
    try:
        r = requests.post(f'{url}/route', json=body, timeout=90)
        r.raise_for_status()
        out: list[list[float]] = []
        for leg in r.json()['trip']['legs']:
            c = _decode6(leg['shape'])
            out += c if not out else c[1:]
        return out
    except (requests.RequestException, ValueError, KeyError) as e:
        print(f'  ! Valhalla indisponível para traçar a rota ({e.__class__.__name__})')
        return None


def geometria_regra(spec) -> tuple[dict | None, dict]:
    """Geometria de uma regra: spec de `geometria_osm_ref`, {"rota": {"de": [lon, lat], "via": [[lon, lat]]?, "para": [lon, lat]}} (rota de carro no
    Valhalla, para rodovia sem ref no OSM) ou uma LISTA de specs (trechos descontínuos da mesma regra). Devolve
    (MultiLineString | None, info)."""
    if isinstance(spec, dict) and spec.get('specs_arquivo'):
        # lista de trechos num arquivo ao lado de regras.json (ex.: anexo da DN 148/2022 do DAER-RS, 122 trechos)
        import os
        from common import DATA_DIR
        base = os.path.dirname(os.environ.get('DERS_REGRAS_JSON') or str(DATA_DIR / 'raw' / 'ders_estaduais' / 'regras.json'))
        with open(os.path.join(base, spec['specs_arquivo']), encoding='utf-8') as f:
            itens = json.load(f)
        g, i = geometria_regra([it['spec'] for it in itens if it.get('spec')])
        i['arquivo'] = spec['specs_arquivo']
        i['trechos_com_geometria'] = len([it for it in itens if it.get('spec')])
        i['trechos_no_arquivo'] = len(itens)
        return g, i
    if isinstance(spec, list):
        linhas, infos = [], []
        for sp in spec:
            g, i = geometria_regra(sp)
            if g:
                linhas += g['coordinates']
            infos.append(i)
        info = {'extensao_km': round(sum(i.get('extensao_km', 0) for i in infos), 3)}
        avisos = [i['aviso'] for i in infos if i.get('aviso')]
        if len(infos) <= 12:
            info['trechos'] = infos
        else:
            info['trechos'] = len(infos)
        if avisos:
            info['avisos'] = avisos[:10]
        return ({'type': 'MultiLineString', 'coordinates': linhas} if linhas else None), info
    if spec.get('rota'):
        g = _rota_carro([spec['rota']['de'], *spec['rota'].get('via', []), spec['rota']['para']])
        if not g:
            return None, {'metodo': 'rota de carro no Valhalla (OSM)', 'aviso': 'Valhalla indisponível'}
        from sources._ders import comprimento_km
        return ({'type': 'MultiLineString', 'coordinates': [g]},
                {'metodo': 'rota de carro no Valhalla (OSM) entre os pontos da curadoria', 'extensao_km': comprimento_km({'type': 'LineString', 'coordinates': g})})
    return geometria_osm_ref(spec)


def feicoes_uf(uf: str) -> tuple[list[dict], list[str], list[str]]:
    """Feições `regra_trecho` das regras de `uf` na curadoria (regras.json, grupo `trechos`). Devolve (feições,
    regras sem geometria na curadoria, regras com geometria que não resolveu)."""
    from sources._ders import carrega_regras, feicao_trecho
    out, sem_spec, falhou = [], [], []
    for r in carrega_regras()['trechos']:
        if r['uf'] != uf:
            continue
        spec = r.get('geometria')
        if not spec:
            sem_spec.append(r['regra_id'])
            continue
        try:
            g, info = geometria_regra(spec)
        except ValueError as e:
            raise RuntimeError(f'{r["regra_id"]}: {e}') from e
        if not g:
            falhou.append(r['regra_id'])
            continue
        out.append(feicao_trecho(r, g, info))
    return out, sem_spec, falhou


def notas_uf(orgao: str, feats: list[dict], sem_spec: list[str], falhou: list[str]) -> str:
    ativas = [f['source_id'] for f in feats if f['props'].get('ativa')]
    return (f'{len(feats) + len(sem_spec) + len(falhou)} regras do {orgao} na curadoria: {len(feats)} com geometria '
            f'({len(ativas)} ativas); sem geometria (só registro): {", ".join(sem_spec + falhou) or "nenhuma"}.')
