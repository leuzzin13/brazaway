"""Trechos proibidos para produtos perigosos (PP) fora de SP: Ponte Rio–Niterói e Av. Portuária (Portaria SPRF-RJ/PRF
407/2024), Linha Vermelha (Res. SMTR 2.204/2012) e Terceira Ponte (IS DERTES 021-N/2004).

Regras: data/raw/hazmat/trechos_sudeste_pp.json (curado; cada regra conferida no texto do ato — ver docs/layers/perigosos.md,
seção 7). Cada regra traz as classes proibidas (null = todas), se a isenção da Parte 3 da Res. ANTT 5.998/2022 vale, a
situação (vigente, revogada, sem efeito...) e `ativa`. A API (perigosos.layer.ts) decide por veículo: classe ONU,
quantidade limitada, exceção de Mocanguê; regra inativa nunca é aplicada, só avisada.

Como as vias são encontradas (sem Overpass e sem PBF):
  1. rotas-semente no Valhalla (costing da regra: 'auto' para a Linha Vermelha, que tem hgv=no; 'truck' para a
     Av. Portuária, que é service com access=no + hgv=designated) desenham o eixo aproximado da via;
  2. grade de /locate (verbose) numa faixa de ±faixa_m em volta das sementes devolve as arestas com nome OSM e geometria
     exata; ficam as que têm um nome igual ao padrão da regra (regex inteira, sem acento: 'Avenida Portuária 8 de
     Janeiro' não é a 'Avenida Portuária'), com a classe viária e o uso (road/ramp...) da regra;
  3. com `excluir_municipios_ibge`, saem as arestas com mais da metade do comprimento dentro desses municípios (malha
     IBGE, qualidade máxima, recuada `folga_divisa_m`): a Res. 2.204/2012 vale só no trecho sob jurisdição do Rio, e a
     Linha Vermelha segue em Duque de Caxias. O corte é por exclusão do vizinho porque a malha do Rio segue a costa e a
     via corre sobre a baía; o recuo mantém as duas pistas onde a divisa passa entre elas;
  4. as arestas são encadeadas por sentido de tráfego (fim = início, mudança de rumo < 46°) e cortadas em pedaços de até
     ~2 km (sempre em fronteira de aresta); cada pedaço é validado no edge walk de linear_cost_factors.
Também grava as áreas da exceção de Mocanguê (ilha + município de Niterói), a área da Lei Rio 1.632/1990 (registrada,
só aviso) e os atos revogados/sem regulamentação como `regra_registrada` (ponto, nunca aplicados).
Licença: traçado derivado do OSM (ODbL); malhas IBGE (dados públicos, citar); regras são atos oficiais.
"""
from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import defaultdict

from common import DATA_DIR, http_get, stable_id
from sources.hazmat_trechos_der import decode6, dist_m, lcf_ok, length_m, valhalla_tileset, vpost

LAYER_ID = 'perigosos'
SOURCE = 'sudeste'
SOURCE_URL = ('Portaria SPRF-RJ/PRF 407/2024 (https://www.in.gov.br/web/dou/-/portaria-sprf-rj/prf-n-407-de-14-de-novembro-de-2024-597101479); '
              'Res. SMTR 2.204/2012 (https://doweb.rio.rj.gov.br/portal/edicoes/download/1681); IS DERTES 021-N/2004 (https://der.es.gov.br/legislacao-2); '
              'traçado: OpenStreetMap via tiles do Valhalla; limites: IBGE malhas municipais (https://servicodados.ibge.gov.br/api/v3/malhas)')
LICENSE = ('Regras: atos oficiais (Lei 9.610/98 art. 8º IV). Traçado: ODbL — © OpenStreetMap contributors (via tiles do Valhalla). '
           'Limites municipais: IBGE (dados públicos, uso livre com citação da fonte)')
NOTES = ''

RULES_PATH = DATA_DIR / 'raw' / 'hazmat' / 'trechos_sudeste_pp.json'
IBGE_URL = 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{}?formato=application/vnd.geo+json&qualidade=maxima'
CHUNK_M = 2000
GRID_M = 45
LOCATE_RADIUS_M = 40
# props da regra copiadas para cada pedaço de via
RULE_KEYS = ('uf', 'municipios', 'jurisdicao', 'orgao', 'via', 'trecho_norma', 'sentidos', 'regra', 'classes_proibidas', 'janela',
             'isencao_qtd_limitada', 'isencao_texto', 'excecoes', 'penalidade', 'norma', 'artigo', 'publicacao', 'vigencia', 'url',
             'confianca', 'situacao', 'ativa', 'motivo_inativa', 'aviso_inativa', 'nota', 'nota_vigencia', 'excecao_mocangue')


def strip_accents(s: str) -> str:
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()


def heading(a, b) -> float:
    la = math.radians((a[1] + b[1]) / 2)
    return math.degrees(math.atan2(b[1] - a[1], (b[0] - a[0]) * math.cos(la))) % 360


def ibge_shape(code: str):
    from shapely.geometry import shape
    d = json.loads(http_get(IBGE_URL.format(code), cache=f'ibge_municipio_{code}_maxima.json', max_age_h=24 * 180))
    feats = d['features'] if d.get('type') == 'FeatureCollection' else [d]
    return shape(feats[0]['geometry']).buffer(0), feats[0]['geometry']


def seed_shapes(sel: dict) -> list[list[list[float]]]:
    """Rotas-semente (lat, lon) -> traçado [lon, lat] do Valhalla."""
    out = []
    for pts in sel['sementes']:
        st, j = vpost('/route', {'locations': [{'lat': a, 'lon': o} for a, o in pts], 'costing': sel.get('costing', 'auto'),
                                 'directions_type': 'none'})
        if st != 200 or 'trip' not in j:
            raise RuntimeError(f'rota-semente {pts} falhou: {str(j)[:200]}')
        cs = []
        for leg in j['trip']['legs']:
            cs += decode6(leg['shape'])
        out.append(cs)
    return out


def locate_edges(band_ll, costing: str) -> dict:
    """Arestas (por shape e sentido) devolvidas pelo /locate numa grade de pontos dentro da faixa (polígono em lon/lat)."""
    from pyproj import Transformer
    from shapely.geometry import Point
    from shapely.ops import transform
    fw = Transformer.from_crs(4326, 31983, always_xy=True).transform
    bw = Transformer.from_crs(31983, 4326, always_xy=True).transform
    band = transform(fw, band_ll)
    minx, miny, maxx, maxy = band.bounds
    pts = []
    x = minx
    while x <= maxx:
        y = miny
        while y <= maxy:
            if band.contains(Point(x, y)):
                pts.append(bw(x, y))
            y += GRID_M
        x += GRID_M
    edges = {}
    for i in range(0, len(pts), 100):
        locs = [{'lon': lon, 'lat': lat, 'radius': LOCATE_RADIUS_M} for lon, lat in pts[i:i + 100]]
        st, j = vpost('/locate', {'locations': locs, 'costing': costing, 'verbose': True}, timeout=180)
        if st != 200:
            raise RuntimeError(f'/locate {st}: {str(j)[:200]}')
        for loc in j:
            for e in loc.get('edges') or []:
                ei, ed = e.get('edge_info') or {}, e.get('edge') or {}
                cls = ed.get('classification') or {}
                key = (ei.get('shape'), bool(ed.get('forward')))
                if not ei.get('shape') or key in edges:
                    continue
                cs = decode6(ei['shape'])
                if not ed.get('forward'):
                    cs = cs[::-1]
                edges[key] = {'names': ei.get('names') or [], 'cls': cls.get('classification'), 'use': cls.get('use'),
                              'coords': [[round(a, 6), round(b, 6)] for a, b in cs], 'way_id': ei.get('way_id')}
    return {'n_pts': len(pts), 'edges': list(edges.values())}


def chain_edges(es: list[dict]) -> list[list[int]]:
    """Encadeia arestas contíguas no sentido do tráfego (fim de uma = início da outra, mudança de rumo < 46°)."""
    start_idx = defaultdict(list)
    for k, e in enumerate(es):
        start_idx[tuple(e['coords'][0])].append(k)
    has_pred = {k for e in es for k in start_idx.get(tuple(e['coords'][-1]), [])}
    used, chains = set(), []
    for k0 in [k for k in range(len(es)) if k not in has_pred] + list(range(len(es))):
        if k0 in used:
            continue
        chain, cur = [k0], k0
        used.add(k0)
        while True:
            c = es[cur]['coords']
            h0 = heading(c[-2], c[-1])
            best, bestd = None, 46.0
            for k in start_idx.get(tuple(c[-1]), []):
                if k in used:
                    continue
                n = es[k]['coords']
                dh = abs((heading(n[0], n[1]) - h0 + 180) % 360 - 180)
                # mesma natureza (pista x alça) primeiro: a alça que sai da pista vira cadeia própria
                if es[k]['use'] != es[cur]['use']:
                    dh += 30
                if dh < bestd:
                    best, bestd = k, dh
            if best is None:
                break
            chain.append(best)
            used.add(best)
            cur = best
        chains.append(chain)
    return chains


def pieces_of(es: list[dict], chain: list[int]):
    """Corta a cadeia em pedaços de até ~CHUNK_M, em fronteira de aresta."""
    piece, plen, names, out = [], 0.0, [], []
    for k in chain:
        e = es[k]
        el = length_m(e['coords'])
        if piece and plen + el > CHUNK_M * 1.25:
            out.append((piece, plen, names))
            piece, plen, names = [], 0.0, []
        piece = piece + (e['coords'][1:] if piece else e['coords'])
        plen += el
        for n in e['names']:
            if n not in names:
                names.append(n)
    if piece:
        out.append((piece, plen, names))
    return out


def osm_props(tileset, sel: dict) -> dict:
    """props.osm de cada pedaço. A geometria é o próprio traçado casado (vértices das arestas do Valhalla, sentido do
    tráfego: `geom`). `costing` é o da seleção: a API recasa com ele quando o tileset muda (a Linha Vermelha, com
    hgv=no, não casa com 'truck' no trace_route)."""
    return {'tileset': tileset, 'geom': True, 'costing': sel.get('costing', 'auto')}


def rule_lines(rule: dict, notes: list[str]):
    """Pedaços (traçado exato da malha, sentido do tráfego) das vias de uma regra."""
    from pyproj import Transformer
    from shapely.geometry import LineString
    from shapely.ops import transform, unary_union
    sel = rule['selecao']
    fw = Transformer.from_crs(4326, 31983, always_xy=True).transform
    bw = Transformer.from_crs(31983, 4326, always_xy=True).transform
    seeds = seed_shapes(sel)
    band = transform(bw, unary_union([transform(fw, LineString(s)).buffer(sel.get('faixa_m', 150)) for s in seeds]))
    loc = locate_edges(band, sel.get('costing', 'auto'))
    rx = re.compile(sel['nome'])
    # limite de jurisdição: a malha do IBGE segue a linha de costa, e a Linha Vermelha corre sobre a baía (fora do
    # polígono do Rio); por isso o corte é por EXCLUSÃO dos municípios vizinhos: sai a aresta com mais da metade do
    # comprimento dentro do vizinho recuado `folga_divisa_m`. Entre o Caju e Vigário Geral a divisa com Duque de Caxias
    # passa entre as duas pistas da Linha Vermelha (a 2–9 m de cada uma, na malha do IBGE e no limite do OSM): o recuo
    # mantém as duas pistas nesse trecho; a oeste dele as duas pistas estão a 60–220 m dentro de Caxias e saem.
    folga = sel.get('folga_divisa_m', 0)
    vizinhos = [transform(fw, ibge_shape(c)[0]).buffer(-folga) for c in sel.get('excluir_municipios_ibge', [])]
    es, fora = [], 0.0
    for e in loc['edges']:
        if e['cls'] not in sel['classes_osm'] or e['use'] not in sel['usos'] or len(e['coords']) < 2:
            continue
        if not any(rx.fullmatch(re.sub(r'\s+', ' ', strip_accents(n)).strip()) for n in e['names']):
            continue
        if vizinhos:
            ls = transform(fw, LineString(e['coords']))
            if any(ls.intersection(v).length > 0.5 * ls.length for v in vizinhos):
                fora += ls.length
                continue
        es.append(e)
    chains = chain_edges(es)
    cands = []
    for ch in chains:
        for coords, plen, names in pieces_of(es, ch):
            if plen >= 15 and len(coords) >= 2:
                cands.append((coords, plen, names, {es[k]['use'] for k in ch}))
    ok = lcf_ok([c[0] for c in cands]) if cands else []
    bad = sum(1 for g in ok if not g)
    if bad:
        notes.append(f"{rule['id']}: {bad} pedaço(s) reprovado(s) no edge walk e descartado(s)")
    good = [c for c, g in zip(cands, ok) if g]
    tot = sum(c[1] for c in good)
    msg = (f"{rule['id']}: {loc['n_pts']} pontos de busca, {len(es)} arestas com o nome, {len(chains)} cadeias, "
           f"{len(good)} pedaços, {tot / 1000:.1f} km de pistas" + (f"; {fora / 1000:.1f} km fora do município descartados" if fora else ''))
    print('    ' + msg)
    if not good:
        notes.append(f"{rule['id']}: nenhuma via encontrada na malha do Valhalla")
    return good, msg


def fetch():
    global NOTES
    from shapely.geometry import LineString, Polygon, mapping, shape
    from shapely.ops import transform, unary_union
    from pyproj import Transformer
    fw = Transformer.from_crs(4326, 31983, always_xy=True).transform
    bw = Transformer.from_crs(31983, 4326, always_xy=True).transform

    tileset = valhalla_tileset()
    if not tileset:
        raise RuntimeError('Valhalla indisponível (VALHALLA_URL): este importador depende do /route e do /locate')
    cfg = json.load(open(RULES_PATH, encoding='utf-8'))
    feats, notes, stats = [], [], []
    for rule in cfg['regras']:
        good, msg = rule_lines(rule, notes)
        stats.append(msg)
        allc = [p for c in good for p in c[0]]
        ref = allc[len(allc) // 2] if allc else None
        base = {k: rule[k] for k in RULE_KEYS if k in rule}
        for coords, plen, names, uses in good:
            sid = stable_id(rule['id'], coords[0][0], coords[0][1], coords[-1][0], coords[-1][1], len(coords))
            feats.append({
                'source_id': sid, 'geometry': {'type': 'LineString', 'coordinates': coords},
                'name': rule['via'], 'kind': 'trecho_proibido',
                'props': {
                    'regra_id': rule['id'], **base, 'nomes_osm': names[:4], 'alca': uses == {'ramp'},
                    'comprimento_m': round(plen), 'ponto_medio': coords[len(coords) // 2], 'ponto_ref': ref,
                    'geometria_fonte': f"OSM via tiles do Valhalla (vias com o nome da regra; {rule['selecao']['nome']})",
                    'osm': osm_props(tileset, rule['selecao']),
                },
                'valid_from': rule.get('valid_from'), 'valid_to': rule.get('valid_to'),
            })
        # exceção de Mocanguê (art. 2º da Portaria 407/2024): ilha (com folga) + município de Niterói
        mc = rule.get('excecao_mocangue')
        if mc:
            ilha = transform(bw, transform(fw, Polygon(mc['ilha'])).buffer(mc.get('folga_ilha_m', 150), 4))
            feats.append({
                'source_id': f"{rule['id']}:mocangue-ilha", 'geometry': mapping(ilha), 'name': 'Ilha de Mocanguê (instalações militares)',
                'kind': 'area_excecao',
                'props': {'regra_id': rule['id'], 'papel': 'destino_militar', 'artigo': mc['artigo'], 'norma': rule['norma'],
                          'trecho': mc['trecho'], 'janelas': mc['janelas'], 'aviso_previo_h': mc['aviso_previo_h'],
                          'fonte': mc['ilha_osm'], 'folga_m': mc.get('folga_ilha_m', 150)},
                'valid_from': rule.get('valid_from'), 'valid_to': None,
            })
            nit, nit_geom = ibge_shape(mc['municipio_ibge'])
            feats.append({
                'source_id': f"{rule['id']}:mocangue-niteroi", 'geometry': nit_geom, 'name': 'Município de Niterói',
                'kind': 'area_excecao',
                'props': {'regra_id': rule['id'], 'papel': 'municipio_origem', 'ibge': mc['municipio_ibge'], 'artigo': mc['artigo'],
                          'norma': rule['norma'], 'trecho': mc['trecho'], 'fonte': 'IBGE malha municipal (qualidade máxima)'},
                'valid_from': rule.get('valid_from'), 'valid_to': None,
            })

    # atos registrados e nunca aplicados (revogados, sem regulamentação)
    for r in cfg.get('registradas', []):
        props = {k: v for k, v in r.items() if k not in ('ponto',)}
        props.update({'regra_id': r['id'], 'ativa': False})
        if r.get('aviso') and r.get('municipio_ibge'):
            g = ibge_shape(r['municipio_ibge'])[1]
            feats.append({'source_id': r['id'], 'geometry': g, 'name': r['via'], 'kind': 'zona_registrada', 'props': props,
                          'valid_from': None, 'valid_to': r.get('valid_to')})
        else:
            feats.append({'source_id': r['id'], 'geometry': {'type': 'Point', 'coordinates': r['ponto']}, 'name': r['via'],
                          'kind': 'regra_registrada', 'props': props, 'valid_from': None, 'valid_to': r.get('valid_to')})
    NOTES = '; '.join(stats + notes)
    for n in notes:
        print('    !', n)
    return feats
