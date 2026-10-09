"""Vias do minianel viário de São Paulo (Anexo IV da Portaria SMT.GAB 051/2024) como traçados da malha do Valhalla (OSM).

A Portaria SMT.GAB 051/2024 (art. 3º I) proíbe veículos com produtos perigosos nas vias do minianel de 2ª a 6ª, exceto
feriados, das 07h às 10h e das 17h às 20h, para TODOS os grupos; o parágrafo único só libera os grupos III e IV na área
interna (centro expandido), "não incluindo as vias do minianel relacionadas no Anexo IV". A zona (polígono) do
centro expandido para PP é da frente core_legal (restriction_zones); aqui ficam só as VIAS, como linhas, para virar
linear_cost_factors (penaliza a via sem bloquear quem só a cruza por ponte/viaduto).

Como as vias são encontradas (sem depender de Overpass):
  1. faixa ao longo do contorno do Mini-Anel do GeoSampa/CET (data/raw/geosampa_restricao_circulacao_veiculo_mian.geojson):
     de 40 m para fora até 450 m para dentro (o polígono inclui o corredor inteiro das marginais, as duas margens e o rio);
  2. /locate do Valhalla (verbose) numa grade de pontos da faixa devolve as arestas com nome OSM e geometria exata;
  3. cada aresta é atribuída a um item do Anexo IV pelo nome (todas as denominações das marginais: Expressa, Central,
     Local e os nomes oficiais de cada margem) e pela distância ao contorno; alças (ramp) ficam de fora;
  4. as arestas de cada item são encadeadas por sentido de tráfego e cortadas em pedaços de até ~2 km; cada pedaço é
     validado no edge walk de linear_cost_factors (props.osm.tileset registra o tileset usado).
Licença: traçado derivado do OSM (ODbL); a regra é ato oficial.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import defaultdict

from common import DATA_DIR, stable_id
from sources.hazmat_trechos_der import decode6, dist_m, lcf_ok, length_m, valhalla_tileset, vpost

LAYER_ID = 'perigosos'
SOURCE = 'osm-minianel'
SOURCE_URL = ('Portaria SMT.GAB 051/2024 (https://cetsp.com.br/media/1592296/portaria-051-24.pdf), Anexo IV; contorno do '
              'Mini-Anel: GeoSampa restricao_circulacao_veiculo_mian (CET); traçado: OpenStreetMap via tiles do Valhalla')
LICENSE = 'ODbL — © OpenStreetMap contributors (traçado das vias); regra: ato oficial (Lei 9.610/98 art. 8º IV); contorno: GeoSampa/CET'
NOTES = ''

MIAN_PATH = DATA_DIR / 'raw' / 'geosampa_restricao_circulacao_veiculo_mian.geojson'
WINDOWS = [{'days': [1, 2, 3, 4, 5], 'from': '07:00', 'to': '10:00'}, {'days': [1, 2, 3, 4, 5], 'from': '17:00', 'to': '20:00'}]
CHUNK_M = 2000

# Itens do Anexo IV: (nº, nome na portaria, trecho, regex do nome OSM sem acento, tipo)
# tipo 'marginal' = corredor largo (as duas margens ficam dentro do polígono); 'avenida' = via sobre o contorno.
ITEMS = [
    (1, 'Marginal do Rio Tietê', 'entre a Av. Salim Farah Maluf e a Marginal do Rio Pinheiros',
     r'marginal\s*(do\s+)?(rio\s+)?tiete|marginal\s+direita\s+do\s+tiete|avenida\s+presidente\s+castelo\s+branco|embaixador\s+macedo\s+soares'
     r'|otaviano\s+alves\s+de\s+lima|morvan\s+dias\s+de\s+figueiredo|assis\s+chateaubriand|condessa\s+elisabeth\s+de\s+robiano', 'marginal'),
    (2, 'Marginal do Rio Pinheiros', 'da Marginal do Rio Tietê até a Av. dos Bandeirantes',
     r'marginal\s*(do\s+)?(rio\s+)?pinheiros|simao\s+faiguenboim|doutora\s+ruth\s+cardoso|avenida\s+das\s+nacoes\s+unidas|magalhaes\s+de\s+castro', 'marginal'),
    (3, 'Avenida dos Bandeirantes', 'em toda a sua extensão', r'avenida\s+dos\s+bandeirantes', 'avenida'),
    (4, "Avenida Afonso D'Escragnolle Taunay", 'em toda a sua extensão', r'escragnoll?e\s+taunay', 'avenida'),
    (5, 'Viaduto Ministro Aliomar Baleeiro', 'em toda a sua extensão', r'aliomar\s+baleeiro', 'avenida'),
    (6, 'Complexo Viário Maria Maluf', 'em toda a sua extensão', r'maria\s+maluf', 'avenida'),
    (7, 'Avenida Presidente Tancredo Neves', 'em toda a sua extensão', r'tancredo\s+neves', 'avenida'),
    (8, 'Rua Malvina Ferrara Samarone', 'em toda a sua extensão', r'malvina\s+ferrara\s+samarone', 'avenida'),
    (9, 'Rua Cipriano Siqueira', 'em toda a sua extensão', r'cipriano\s+siqueira', 'avenida'),
    (10, 'Rua das Juntas Provisórias', 'em toda a sua extensão', r'juntas\s+provisorias', 'avenida'),
    (11, 'Viaduto Grande São Paulo', 'em toda a sua extensão', r'viaduto\s+grande\s+sao\s+paulo', 'avenida'),
    (12, 'Avenida Professor Luís Ignácio de Anhaia Melo', 'entre o Viaduto Grande São Paulo e a Avenida Salim Farah Maluf',
     r'anhaia\s+mell?o', 'avenida'),
    (13, 'Avenida Salim Farah Maluf', 'em toda a sua extensão', r'salim\s+farah\s+maluf', 'avenida'),
]
ROAD_CLASSES = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary'}


def strip_accents(s: str) -> str:
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()


def item_for(names: list[str]):
    txt = ' | '.join(strip_accents(n) for n in names)
    if re.search(r'\b(ponte|rodovia|acesso)\b', txt) and not re.search(r'marginal|avenida|viaduto|complexo|rua', txt.split('|')[0]):
        return None
    for it in ITEMS:
        if re.search(it[3], txt):
            return it
    return None


def heading(a, b) -> float:
    la = math.radians((a[1] + b[1]) / 2)
    return math.degrees(math.atan2(b[1] - a[1], (b[0] - a[0]) * math.cos(la))) % 360


def fetch():
    global NOTES
    from shapely.geometry import LineString, Point, shape
    from shapely.ops import transform
    from pyproj import Transformer

    tileset = valhalla_tileset()
    if not tileset:
        raise RuntimeError('Valhalla indisponível (VALHALLA_URL): este importador depende do /locate para achar as arestas')
    fw = Transformer.from_crs(4326, 31983, always_xy=True).transform
    bw = Transformer.from_crs(31983, 4326, always_xy=True).transform
    mian = transform(fw, shape(json.load(open(MIAN_PATH))['features'][0]['geometry'])).buffer(0)
    ring = mian.exterior
    out40 = mian.buffer(40)
    band = mian.buffer(40).difference(mian.buffer(-450))

    # 1-2) grade de pontos na faixa -> /locate
    minx, miny, maxx, maxy = band.bounds
    pts = []
    x = minx
    while x <= maxx:
        y = miny
        while y <= maxy:
            if band.contains(Point(x, y)):
                pts.append(bw(x, y))
            y += 90
        x += 90
    edges = {}
    for i in range(0, len(pts), 100):
        locs = [{'lon': lon, 'lat': lat, 'radius': 70} for lon, lat in pts[i:i + 100]]
        st, j = vpost('/locate', {'locations': locs, 'costing': 'truck', 'verbose': True}, timeout=180)
        if st != 200:
            raise RuntimeError(f'/locate {st}: {str(j)[:200]}')
        for loc in j:
            for e in loc.get('edges') or []:
                ei, ed = e.get('edge_info') or {}, e.get('edge') or {}
                cls = (ed.get('classification') or {})
                key = (ei.get('shape'), bool(ed.get('forward')))
                if not ei.get('shape') or key in edges:
                    continue
                edges[key] = {'names': ei.get('names') or [], 'cls': cls.get('classification'), 'use': cls.get('use'),
                              'forward': bool(ed.get('forward')), 'shape': ei['shape'], 'way_id': ei.get('way_id')}
    print(f'    {len(pts)} pontos de busca, {len(edges)} arestas na faixa do contorno')

    # 3) arestas de cada item do Anexo IV
    by_item: dict[int, list[dict]] = defaultdict(list)
    dropped = defaultdict(float)
    for e in edges.values():
        if e['cls'] not in ROAD_CLASSES or e['use'] in ('ramp', 'turn_channel'):
            continue
        it = item_for(e['names'])
        if not it:
            continue
        cs = decode6(e['shape'])
        if not e['forward']:
            cs = cs[::-1]
        if len(cs) < 2:
            continue
        g = transform(fw, LineString(cs))
        if g.length < 1:
            continue
        fin = g.intersection(out40).length / g.length
        dists = [ring.distance(Point(c)) for c in g.coords]
        dmax, dmean = max(dists), sum(dists) / len(dists)
        if it[4] == 'marginal':
            ok = fin >= 0.6 and dmax <= 500
        else:
            ok = (fin >= 0.8 and dmax <= 250) or dmean <= 40
        if not ok:
            dropped[it[1]] += g.length
            continue
        by_item[it[0]].append({'coords': [[round(x, 6), round(y, 6)] for x, y in cs], 'names': e['names'], 'len': g.length, 'cls': e['cls']})

    # 4) encadeia por sentido e corta em pedaços
    feats, stats, notes = [], [], []
    candidates = []
    for it in ITEMS:
        es = by_item.get(it[0], [])
        if not es:
            notes.append(f'item {it[0]} ({it[1]}): nenhuma via com esse nome sobre o contorno do Mini-Anel no OSM')
            continue
        start_idx = defaultdict(list)
        for k, e in enumerate(es):
            start_idx[tuple(e['coords'][0])].append(k)
        has_pred = set()
        for e in es:
            for k in start_idx.get(tuple(e['coords'][-1]), []):
                has_pred.add(k)
        used = set()
        chains = []
        order = [k for k in range(len(es)) if k not in has_pred] + list(range(len(es)))
        for k0 in order:
            if k0 in used:
                continue
            chain = [k0]
            used.add(k0)
            cur = k0
            while True:
                c = es[cur]['coords']
                h0 = heading(c[-2], c[-1])
                best, bestd = None, 46.0
                for k in start_idx.get(tuple(c[-1]), []):
                    if k in used:
                        continue
                    n = es[k]['coords']
                    dh = abs((heading(n[0], n[1]) - h0 + 180) % 360 - 180)
                    if dh < bestd:
                        best, bestd = k, dh
                if best is None:
                    break
                chain.append(best)
                used.add(best)
                cur = best
            chains.append(chain)
        total = 0.0
        for chain in chains:
            # corta em pedaços de até CHUNK_M (sempre em fronteira de aresta)
            piece, plen, pnames = [], 0.0, []
            pieces = []
            for k in chain:
                e = es[k]
                if piece and plen + e['len'] > CHUNK_M * 1.25:
                    pieces.append((piece, plen, pnames))
                    piece, plen, pnames = [], 0.0, []
                piece = piece + (e['coords'][1:] if piece else e['coords'])
                plen += e['len']
                for n in e['names']:
                    if n not in pnames:
                        pnames.append(n)
            if piece:
                pieces.append((piece, plen, pnames))
            for coords, plen, pnames in pieces:
                if plen < 15 or len(coords) < 2:
                    continue
                total += plen
                candidates.append((it, coords, plen, pnames))
        stats.append(f'{it[0]} {it[1]}: {total / 1000:.1f} km de pistas ({len(es)} arestas)')

    ok = lcf_ok([c[1] for c in candidates])
    bad = 0
    for (it, coords, plen, pnames), good in zip(candidates, ok):
        if not good:
            bad += 1
            continue
        sid = stable_id('minianel', it[0], coords[0][0], coords[0][1], coords[-1][0], coords[-1][1], len(coords))
        osm_name = next((n for n in pnames if not re.match(r'^(SP|BR)-\d', n)), pnames[0] if pnames else it[1])
        feats.append({
            'source_id': sid,
            'geometry': {'type': 'LineString', 'coordinates': coords},
            'name': it[1] if strip_accents(osm_name) == strip_accents(it[1]) else f'{it[1]} — {osm_name}',
            'kind': 'via_minianel',
            'props': {
                'anexo_iv_item': it[0], 'via': it[1], 'trecho_norma': it[2], 'nomes_osm': pnames[:4], 'comprimento_m': round(plen),
                'regra': 'Proibido para veículos com produtos perigosos (todos os grupos)', 'janelas': WINDOWS, 'exceto_feriados': True,
                'norma': 'Portaria SMT.GAB 051/2024', 'artigo': f'art. 3º I e Anexo IV, item {it[0]}',
                'url': 'https://cetsp.com.br/media/1592296/portaria-051-24.pdf',
                # o traçado da geometria é o próprio traçado casado (vértices das arestas do Valhalla, sentido do tráfego)
                'osm': {'tileset': tileset, 'geom': True},
            },
            'valid_from': None, 'valid_to': None,
        })
    for s in stats:
        print('    ' + s)
    if dropped:
        print('    descartadas (longe do contorno): ' + ', '.join(f'{k} {v / 1000:.1f} km' for k, v in sorted(dropped.items(), key=lambda kv: -kv[1])))
    if bad:
        notes.append(f'{bad} pedaço(s) reprovado(s) no edge walk e descartado(s)')
    NOTES = '; '.join(stats + notes)
    for n in notes:
        print('    !', n)
    return feats
