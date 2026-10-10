"""Geometria curada da frente mun_rmsp_restante (Grande SP restante), fora do importador.

Gera em data/raw/municipios/geo/ os GeoJSON `construir: manual` que o importador genérico (importers/sources/municipios.py)
só lê. As vias "por nome" (construir: trechos) NÃO passam por aqui: o importador as monta do OSM.

  suzano    3552502_centro_vias.geojson    eixos do OSM sob os polígonos oficiais do GeoSuzano ("MOB-Restrição trânsito de
                                           caminhões", que desenha a SUPERFÍCIE das ruas, não uma zona: um polígono com
                                           furos nos quarteirões). Como zona, o recuo de 20 m da camada apagaria ruas de
                                           ~10 m de largura; por isso vira via (costLines) com os eixos do OSM.
  caieiras  3509007_vias_municipais.geojson limite do IBGE menos as rodovias estaduais (SP-332, SP-348, SP-023 e alças):
                                           Lei 3.560/2004 vale nas "avenidas e ruas do município", não nas rodovias.
  taboao    3552809_vias_municipais.geojson limite do IBGE menos a BR-116 (Régis Bittencourt) e alças.
  mogi      3530607_area_central.geojson   perímetro APROXIMADO dos 16 logradouros do Dec. 899/1985, art. 2º (red. Dec.
                                           1.782/2000), pelos eixos do OSM; trechos sem nome no OSM (Pça Galdino Pinheiro
                                           Franco, R. Rafael Fernandes, R. das Primaveras) fechados em linha reta.

Entradas (geradas por osm_pbf_cache.py e baixadas uma vez, não versionadas):
  data/cache/rmsp_restante/hw.geojsonseq                         vias do PBF local (osmium export)
  data/cache/rmsp_restante/geosuzano_restricao_caminhoes.geojson  FeatureService do GeoSuzano (f=geojson, outSR=4326):
    https://services8.arcgis.com/q05L6PnVEyBJZq9L/arcgis/rest/services/Restricao_transito_de_caminhoes/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=geojson

Uso (imagem do importador):
  docker run --rm -v $(pwd)/data:/data -v $(pwd)/data/raw/municipios/curadoria:/c --entrypoint python truck-router-importer \
    /c/rmsp_restante_geo.py suzano caieiras taboao mogi
Licenças: eixos e rodovias do OpenStreetMap (ODbL 1.0); limites do IBGE (dados públicos); polígonos do GeoSuzano usados
só para selecionar os eixos (sem licença declarada; a prefeitura pede atribuição ao Depto de Geotecnologias).
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
import time
import unicodedata

from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, mapping, shape
from shapely.ops import linemerge, nearest_points, substring, transform, unary_union

DATA = pathlib.Path('/data')
CACHE = DATA / 'cache' / 'rmsp_restante'
GEO = DATA / 'raw' / 'municipios' / 'geo'
LIMITES = DATA / 'raw' / 'rmsp' / 'ibge_rmsp_municipios.geojson'
T = Transformer.from_crs(4326, 31983, always_xy=True)
Ti = Transformer.from_crs(31983, 4326, always_xy=True)
utm = lambda g: transform(lambda x, y, z=None: T.transform(x, y), g)
ll = lambda g: transform(lambda x, y, z=None: Ti.transform(x, y), g)
# classes de via que caminhão usa (sem service/footway etc.)
VEIC = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|road)(_link)?$')


def norm(s: str | None) -> str:
    return unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()


def rnd(g: dict, nd: int = 6) -> dict:
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], nd), round(c[1], nd)]
    return {'type': g['type'], 'coordinates': r(g['coordinates'])}


def vias(bounds) -> list[dict]:
    x0, y0, x1, y1 = bounds
    out = []
    with (CACHE / 'hw.geojsonseq').open() as fh:
        for line in fh:
            f = json.loads(line.lstrip('\x1e'))
            c = f['geometry']['coordinates']
            xs, ys = [x for x, _ in c], [y for _, y in c]
            if max(xs) < x0 or min(xs) > x1 or max(ys) < y0 or min(ys) > y1:
                continue
            out.append(f)
    return out


def limite(ibge: str):
    for f in json.loads(LIMITES.read_text())['features']:
        if f['properties']['ibge'] == ibge:
            return shape(f['geometry'])
    raise KeyError(ibge)


def escrever(nome: str, fc: dict) -> None:
    GEO.mkdir(parents=True, exist_ok=True)
    fc = {'type': 'FeatureCollection', 'gerado_em': time.strftime('%Y-%m-%d'),
          'gerado_por': 'data/raw/municipios/curadoria/rmsp_restante_geo.py', **fc}
    (GEO / nome).write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'  -> data/raw/municipios/geo/{nome}: {len(fc["features"])} feição(ões)')


# ----------------------------------------------------------------------------- Suzano
def suzano() -> None:
    src = json.loads((CACHE / 'geosuzano_restricao_caminhoes.geojson').read_text())
    poly = unary_union([shape(f['geometry']) for f in src['features']])
    P = utm(poly)
    Pb = P.buffer(4)                       # eixo do OSM a até 4 m da superfície desenhada
    feats = []
    for f in vias(poly.buffer(0.002).bounds):
        p = f['properties']
        if not VEIC.match(p.get('highway', '')) or not p.get('name'):
            continue
        L = utm(LineString(f['geometry']['coordinates']))
        oneway = p.get('oneway') in ('yes', '1', 'true') or p.get('junction') == 'roundabout'
        if p.get('oneway') == '-1':
            L, oneway = LineString(list(L.coords)[::-1]), True
        I = L.intersection(Pb)
        for g in [g for g in getattr(I, 'geoms', [I]) if g.geom_type == 'LineString']:
            # cruzamento de rua livre com a rua restrita deixa só ~10–20 m dentro do polígono: descarta
            if g.length < 30:
                continue
            feats.append({'type': 'Feature', 'geometry': rnd(mapping(ll(g))), 'properties': {
                'via': p['name'], 'nome_osm': p['name'], 'osm_way_id': int(p['@id']), 'highway': p.get('highway'),
                'mao_unica': oneway, 'sentido': 'unico' if oneway else 'ambos', 'comprimento_m': round(g.length)}})
    feats.sort(key=lambda x: (x['properties']['via'], x['properties']['osm_way_id']))
    escrever('3552502_centro_vias.geojson', {
        'features': feats,
        'fonte_geometria': ('Eixos do OpenStreetMap (ODbL 1.0) sob os polígonos oficiais "MOB-Restrição trânsito de caminhões" '
                            '(GeoSuzano, Depto de Geotecnologias da Prefeitura de Suzano; dados de 30/06/2021, sem licença '
                            'declarada): só os trechos de eixo com 30 m ou mais dentro da superfície desenhada'),
        'vias': sorted({x['properties']['via'] for x in feats}),
    })


# ----------------------------------------------------------------------------- município menos as rodovias
RODOVIA_REF = re.compile(r'(^|;)\s*(SP|BR|SPA|SPI)[- ]?\d')


def municipio_sem_rodovias(ibge: str, nome: str, folga_m: float = 30.0) -> tuple[dict, list[str]]:
    M = limite(ibge)
    Mu = utm(M)
    rod, links = [], []
    for f in vias(M.buffer(0.01).bounds):
        p = f['properties']
        hw = p.get('highway', '')
        L = utm(LineString(f['geometry']['coordinates']))
        if not L.intersects(Mu.buffer(100)):
            continue
        if hw in ('motorway', 'trunk', 'motorway_link', 'trunk_link') or RODOVIA_REF.search(p.get('ref') or ''):
            rod.append((p, L))
        elif hw.endswith('_link'):
            links.append((p, L))
    R = unary_union([L for _, L in rod])
    # alças sem ref que ligam duas pistas de rodovia (trevos): mesma jurisdição
    for p, L in links:
        a, b = Point(L.coords[0]), Point(L.coords[-1])
        if a.distance(R) < 20 and b.distance(R) < 20:
            rod.append((p, L))
    R = unary_union([L for _, L in rod])
    corte = R.buffer(folga_m, cap_style=2)
    Z = Mu.difference(corte)
    Z = Z.simplify(5, preserve_topology=True)
    partes = [g for g in getattr(Z, 'geoms', [Z]) if g.area > 20000]          # descarta lascas < 2 ha
    furos = sum(len(g.interiors) for g in partes)
    if furos:
        # furo = trecho de rodovia que não encosta no limite: a camada só usa o anel externo (os furos somem) e a
        # rodovia ficaria bloqueada. Abre cada furo com um corte até o anel externo.
        novas = []
        for g in partes:
            for hole in g.interiors:
                h = Polygon(hole)
                p, q = nearest_points(h.exterior, g.exterior)
                g = g.difference(LineString([p, q]).buffer(folga_m, cap_style=2).union(h))
            novas.extend(getattr(g, 'geoms', [g]))
        partes = [g for g in novas if g.area > 20000]
    nomes = sorted({f"{p.get('ref') or ''} {p.get('name') or p.get('highway')}".strip() for p, _ in rod})
    Zll = ll(unary_union(partes))
    print(f'{nome}: {len(partes)} parte(s), {sum(len(g.exterior.coords) for g in partes)} vértices, furos restantes: '
          f'{sum(len(g.interiors) for g in partes)}, rodovias cortadas: {len(rod)} ways')
    return rnd(mapping(Zll), 6), nomes


def caieiras() -> None:
    g, nomes = municipio_sem_rodovias('3509007', 'Caieiras')
    escrever('3509007_vias_municipais.geojson', {
        'features': [{'type': 'Feature', 'geometry': g, 'properties': {}}],
        'fonte_geometria': ('Limite municipal do IBGE (Malha Municipal, dados públicos) menos uma faixa de 30 m em torno das '
                            'rodovias estaduais e alças do OpenStreetMap (ODbL 1.0)'),
        'rodovias_fora': nomes,
    })


def taboao() -> None:
    g, nomes = municipio_sem_rodovias('3552809', 'Taboão da Serra')
    escrever('3552809_vias_municipais.geojson', {
        'features': [{'type': 'Feature', 'geometry': g, 'properties': {}}],
        'fonte_geometria': ('Limite municipal do IBGE (Malha Municipal, dados públicos) menos uma faixa de 30 m em torno da '
                            'BR-116 e alças do OpenStreetMap (ODbL 1.0)'),
        'rodovias_fora': nomes,
    })


# ----------------------------------------------------------------------------- Mogi das Cruzes
MOGI_PERIMETRO = [   # Dec. 899/1985, art. 2º (red. Dec. 1.782/2000), na ordem do decreto; None = sem nome no OSM
    'Rua Olegário Paiva',                          # R. Prof. Olegário Paiva
    'Avenida Vereador Narciso Yague Guimarães',
    'Rua Duarte de Freitas',
    'Rua Antônio Nascimento Costa',                # Av. Antonio Nascimento Costa
    'Rua Coronel Cardoso de Siqueira',
    'Rua São João',
    'Rua Marechal Floriano Peixoto',
    None,                                          # Pça Galdino Pinheiro Franco e R. Rafael Fernandes
    'Avenida Brasil',
    'Avenida Pedro Machado',
    None,                                          # R. das Primaveras
    'Rua Jardelina de Almeida Lopes',
    'Rua Doutor Fernando Tancredi',
    'Rua Presidente Campos Salles',
    'Avenida Francisco Rodrigues Filho',
]


def mogi() -> None:
    caixa = (-46.215, -23.560, -46.165, -23.500)
    fs = vias(caixa)
    S = {}
    for n in [x for x in MOGI_PERIMETRO if x]:
        ls = [LineString(f['geometry']['coordinates']) for f in fs if norm(f['properties'].get('name')) == norm(n)]
        ls = [l for l in ls if caixa[0] < l.centroid.x < caixa[2] and caixa[1] < l.centroid.y < caixa[3]]
        S[n] = unary_union(ls)
    seq = [x for x in MOGI_PERIMETRO if x]
    lacunas = []
    J = {}
    for a, b in zip(seq, seq[1:] + seq[:1]):
        p, q = nearest_points(S[a], S[b])
        J[(a, b)] = (p, q)
        d = utm(p).distance(utm(q))
        if d > 25:
            lacunas.append(f'{a} → {b}: {d:.0f} m em linha reta')

    def trecho(g, a, b):
        m = linemerge(g) if g.geom_type == 'MultiLineString' else g
        comps = list(getattr(m, 'geoms', [m]))
        c = min(comps, key=lambda c: c.distance(a) + c.distance(b))
        if c.distance(a) > 0.0004 or c.distance(b) > 0.0004:
            return [(a.x, a.y), (b.x, b.y)]
        pa, pb = c.project(a), c.project(b)
        s = substring(c, min(pa, pb), max(pa, pb))
        cs = list(s.coords) if s.geom_type == 'LineString' else [(s.x, s.y)]
        return cs if pa <= pb else cs[::-1]

    anel = []
    for i, cur in enumerate(seq):
        prv, nxt = seq[i - 1], seq[(i + 1) % len(seq)]
        anel.extend(trecho(S[cur], J[(prv, cur)][1], J[(cur, nxt)][0]))
    P = Polygon(anel).buffer(0)
    P = ll(utm(P).simplify(3, preserve_topology=True))
    print(f'Mogi: área {utm(P).area / 1e6:.2f} km², {len(P.exterior.coords)} vértices; lacunas: {lacunas}')
    escrever('3530607_area_central.geojson', {
        'features': [{'type': 'Feature', 'geometry': rnd(mapping(P), 6), 'properties': {'aproximado': True}}],
        'fonte_geometria': ('Perímetro do Dec. 899/1985, art. 2º (red. Dec. 1.782/2000) montado pelos eixos do OpenStreetMap '
                            '(ODbL 1.0); APROXIMADO: logradouros sem nome no OSM fechados em linha reta'),
        'lacunas': lacunas,
    })


if __name__ == '__main__':
    for alvo in sys.argv[1:] or ['suzano', 'caieiras', 'taboao', 'mogi']:
        globals()[alvo]()
