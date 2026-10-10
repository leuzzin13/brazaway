"""Curadoria (manual, roda uma vez) da geometria de Osasco a partir do MAPA OFICIAL vetorial.

Fonte: Imprensa Oficial do Município de Osasco (IOMO) nº 2434, 03/05/2023, p. 98 — "Mapa de Restrição de
circulação de Veículos Pesados do Município de Osasco" (DEMUTRAN/SETRAN), anexo ao Decreto 10.676/2012 com a
redação do Decreto 13.704/2023. Cópia pública: Querido Diário (OKBR)
https://data.queridodiario.ok.org.br/3534401/2023-05-03/39d9486475020047b3fc4292dac595f56e7f4815.pdf

O mapa é VETORIAL no PDF mas não tem coordenadas. Passos (reproduzíveis):
  1. pdftocairo -svg -f 98 -l 98 <pdf> p98.svg; ler todos os <path> (aplicando a matriz de cada um).
     Cores: preto = quadras; azul rgb(0,0,100%) = VER; verde-claro/verde-escuro = ZMRC. Ignorar o detalhe
     ampliado no canto superior direito (x>388 e y<302 em pt) e a legenda (y<165).
  2. Georreferenciamento página(pt) → UTM 23S (EPSG:31983):
     a) afim inicial por 7 cruzamentos lidos no mapa e casados com nós do OSM (osasco_gcp_manuais.json);
        resíduo 2–21 m. Escala ≈ 25,4 m/pt, rotação ≈ 0,8°.
     b) ICP local (similaridade) em janelas de 70x70 pt entre as linhas de quadra do mapa e o eixo das vias do
        OSM (Overpass, highway != service); aceitas só janelas com escala 24,6–26,0 m/pt, ganho de aderência
        >= 3 p.p. e deslocamento <= 60 m.
     c) thin-plate spline (scipy RBFInterpolator, smoothing=5) sobre o resíduo da afim → osasco_tps_cp.json.
     Conferência visual: o arruamento do mapa cai entre os eixos do OSM no centro, na Rodovia/Rodoanel (oeste)
     e na Praça Iacanga (sul). Erro típico estimado: 10–25 m.
  3. ZMRC: união dos preenchimentos verdes (fechamento de 0,6 pt), contorno externo, transformado e
     simplificado (3 m) → osasco_zmrc.geojson. Das 12 vias do art. 3º (red. Dec. 13.704/2023), todas ficam
     dentro ou na borda do polígono (Narciso/Alfredo Sturlini e Caetano Poli por dentro).
  4. VER: rasterizar as bordas azuis (0,1 pt), fechamento (1,1 pt), esqueleto (scikit-image) → eixos;
     transformar e casar com o grafo do Valhalla (trace_attributes, costing auto, map_snap, raio 40 m) nos DOIS
     sentidos (pista dupla); descartar motorway/trunk (rodovias não são VER municipal), arestas transversais
     (projeção no eixo < 55% do comprimento), afastadas (p90 > 42 m) e nomes com < 150 m e < 25% do trecho.
     Recorte no limite municipal (IBGE + 30 m) → osasco_ver_mapa.geojson (uma feição por way do OSM).

Requisitos (fora da imagem do importador): python3 com numpy scipy shapely pyproj scikit-image networkx
requests; poppler (pdftocairo); Valhalla em VALHALLA_URL; Overpass. Este script NÃO roda no import: o
importador (importers/sources/municipios.py, arquivo data/raw/municipios/3534401.json) só lê os GeoJSON curados.
LICENÇA: ato oficial (Lei 9.610/1998 art. 8º IV). As linhas VER usam a geometria do OSM (ODbL 1.0, ©
colaboradores do OpenStreetMap) — base derivada mantida separada do OSM.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
PDF_URL = 'https://data.queridodiario.ok.org.br/3534401/2023-05-03/39d9486475020047b3fc4292dac595f56e7f4815.pdf'
VALHALLA = os.environ.get('VALHALLA_URL', 'http://localhost:8002')
OVERPASS = 'https://overpass-api.de/api/interpreter'
BLUE, LG, DG, BLACK = 'rgb(0%, 0%, 100%)', 'rgb(74.902344%, 100%, 49.803162%)', 'rgb(0%, 72.157288%, 0%)', 'rgb(0%, 0%, 0%)'


def in_inset(s):
    return ((s[:, 0] > 388) & (s[:, 1] < 302)).any() or (s[:, 1] < 165).any()


# ---------- 1. SVG ----------
def svg_paths(svgfile):
    PATH_RE = re.compile(r'<path ([^>]*)/>')
    ATTR_RE = re.compile(r'([a-zA-Z\-]+)="([^"]*)"')
    TOK = re.compile(r'[MLCZ]|-?[\d.]+(?:e-?\d+)?')

    def bez(p0, p1, p2, p3, n=6):
        t = np.linspace(0, 1, n + 1)[1:, None]
        return ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3

    def parse_d(d):
        toks = TOK.findall(d); i = 0; subs = []; cur = []; cmd = None; start = None
        while i < len(toks):
            t = toks[i]
            if t.isalpha():
                cmd = t; i += 1
            if cmd == 'M':
                if cur: subs.append(cur)
                p = np.array([float(toks[i]), float(toks[i + 1])]); i += 2; cur = [p]; start = p; cmd = 'L'
            elif cmd == 'L':
                cur.append(np.array([float(toks[i]), float(toks[i + 1])])); i += 2
            elif cmd == 'C':
                v = [float(x) for x in toks[i:i + 6]]; i += 6
                cur.extend(list(bez(cur[-1], np.array(v[0:2]), np.array(v[2:4]), np.array(v[4:6]))))
            elif cmd == 'Z':
                if cur and start is not None: cur.append(start)
                subs.append(cur); cur = []
        if cur: subs.append(cur)
        return [np.array(s) for s in subs if len(s) >= 1]

    out = []
    for m in PATH_RE.finditer(open(svgfile).read()):
        a = dict(ATTR_RE.findall(m.group(1)))
        fill = a.get('fill', 'none')
        color = a.get('stroke') if fill == 'none' else fill
        subs = parse_d(a['d'])
        if a.get('transform'):
            v = [float(x) for x in re.findall(r'-?[\d.]+(?:e-?\d+)?', a['transform'])]
            A = np.array([[v[0], v[2]], [v[1], v[3]]]); b = np.array([v[4], v[5]])
            subs = [s @ A.T + b for s in subs]
        out.append({'color': color, 'kind': 'stroke' if fill == 'none' else 'fill', 'width': float(a.get('stroke-width', 0) or 0), 'subs': subs})
    return out


# ---------- 2. georreferenciamento ----------
def load_warp():
    from scipy.interpolate import RBFInterpolator
    d = json.load(open(os.path.join(HERE, 'osasco_tps_cp.json')))
    M0 = np.array(d['M0']); src = np.array(d['src_page_pt']); dst = np.array(d['dst_utm'])
    base = src @ M0[:, :2].T + M0[:, 2]
    rbf = RBFInterpolator(src, dst - base, kernel='thin_plate_spline', smoothing=5.0)
    return lambda p: np.asarray(p, float) @ M0[:, :2].T + M0[:, 2] + rbf(np.asarray(p, float))


def fit_tiles(paths, osm_pts, M0):
    """ICP local (similaridade) por janela; devolve pontos de controle virtuais (centro da janela)."""
    from scipy.spatial import cKDTree
    P = np.vstack([s for p in paths if p['color'] == BLACK and p['width'] == 0.124 for s in p['subs']])
    P = P[~((P[:, 0] > 388) & (P[:, 1] < 302))]
    tree = cKDTree(osm_pts)
    ap = lambda M, p: p @ M[:, :2].T + M[:, 2]

    def sim_fit(A, B):
        ma, mb = A.mean(0), B.mean(0); a2 = (A - ma) * np.array([1, -1]); b = B - mb
        za = a2[:, 0] + 1j * a2[:, 1]; zb = b[:, 0] + 1j * b[:, 1]; k = (np.conj(za) @ zb) / (np.conj(za) @ za)
        L = np.array([[k.real, -k.imag], [k.imag, k.real]]) @ np.diag([1, -1])
        return np.hstack([L, (mb - L @ ma)[:, None]])

    src, dst = [], []
    for cx in np.arange(170, 481, 30):
        for cy in np.arange(320, 721, 30):
            sel = (np.abs(P[:, 0] - cx) < 35) & (np.abs(P[:, 1] - cy) < 35)
            if sel.sum() < 3000: continue
            Ps = P[sel][:15000]
            score = lambda M: np.isfinite(tree.query(ap(M, Ps), distance_upper_bound=8)[0]).mean()
            M = M0.copy(); s0 = score(M)
            for thr in [120, 90, 70, 50, 40, 30, 22, 16, 12, 10]:
                for _ in range(3):
                    d, idx = tree.query(ap(M, Ps), distance_upper_bound=thr); ok = np.isfinite(d)
                    if ok.sum() < 300: break
                    M = sim_fit(Ps[ok], osm_pts[idx[ok]])
            c = np.array([[cx, cy]]); shift = np.hypot(*(ap(M, c) - ap(M0, c))[0]); sc = np.hypot(M[0, 0], M[1, 0])
            if 24.6 <= sc <= 26.0 and score(M) - s0 >= 0.03 and shift <= 60:
                src.append([cx, cy]); dst.append(ap(M, c)[0])
    return np.array(src), np.array(dst)


# ---------- 4. VER ----------
def ver_centerlines(paths, res=0.1):
    import networkx as nx
    from shapely.geometry import LineString
    from skimage.draw import line as dline
    from skimage.morphology import closing, dilation, disk, remove_small_holes, remove_small_objects, skeletonize
    segs = [s for p in paths if p['color'] == BLUE for s in p['subs'] if not in_inset(s)]
    allp = np.vstack(segs); x0, y0 = allp.min(0) - 3; x1, y1 = allp.max(0) + 3
    img = np.zeros((int((y1 - y0) / res) + 1, int((x1 - x0) / res) + 1), bool)
    for s in segs:
        q = np.round((s - [x0, y0]) / res).astype(int)
        for a, b in zip(q[:-1], q[1:]):
            rr, cc = dline(a[1], a[0], b[1], b[0]); img[rr, cc] = True
    img = remove_small_objects(remove_small_holes(closing(dilation(img, disk(1)), disk(11)), 400), 300)
    S = set(zip(*[a.tolist() for a in np.nonzero(skeletonize(img))]))
    G = nx.Graph()
    for (y, x) in S:
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if (dy or dx) and (y + dy, x + dx) in S: G.add_edge((y, x), (y + dy, x + dx))
    lines, seen = [], set()
    for n in [n for n in G if G.degree(n) != 2]:
        for nb in G[n]:
            if frozenset((n, nb)) in seen: continue
            path = [n, nb]; seen.add(frozenset((n, nb))); prev, cur = n, nb
            while G.degree(cur) == 2:
                nxt = [m for m in G[cur] if m != prev][0]
                if frozenset((cur, nxt)) in seen: break
                seen.add(frozenset((cur, nxt))); path.append(nxt); prev, cur = cur, nxt
            lines.append(LineString([[x0 + p[1] * res, y0 + p[0] * res] for p in path]).simplify(0.15))
    return [l for l in lines if l.length > 0.8]


def main():
    import requests
    from pyproj import Transformer
    from shapely.geometry import LineString, Polygon, mapping, shape
    from shapely.ops import linemerge, unary_union
    from shapely.validation import make_valid
    T = Transformer.from_crs(4326, 31983, always_xy=True); Ti = Transformer.from_crs(31983, 4326, always_xy=True)
    work = os.environ.get('WORK', '/tmp/osasco_georef'); os.makedirs(work, exist_ok=True)
    pdf = os.path.join(work, 'iomo2434.pdf'); svg = os.path.join(work, 'p98.svg')
    if not os.path.exists(pdf): subprocess.run(['curl', '-sL', '-o', pdf, PDF_URL], check=True)
    if not os.path.exists(svg): subprocess.run(['pdftocairo', '-svg', '-f', '98', '-l', '98', pdf, svg], check=True)
    paths = svg_paths(svg)
    if '--refit' in sys.argv:  # refaz os pontos de controle virtuais (ICP por janela); exige Overpass
        q = ('[out:json][timeout:180];area["boundary"="administrative"]["admin_level"="8"]["IBGE:GEOCODIGO"="3534401"]->.a;'
             'way(area.a)["highway"]["highway"!~"service|footway|path|steps|cycleway|track|pedestrian|construction|proposed"];out geom;')
        osm = requests.post(OVERPASS, data={'data': q}, timeout=300).json()['elements']
        pts = []
        for e in osm:
            c = np.array([T.transform(n['lon'], n['lat']) for n in e['geometry']])
            for a, b in zip(c[:-1], c[1:]):
                n = max(1, int(np.hypot(*(b - a)) / 4)); pts.append(a + np.outer(np.arange(n) / n, b - a))
        g = json.load(open(os.path.join(HERE, 'osasco_gcp_manuais.json')))
        gp = np.array([x['page'] for x in g]); gw = np.array([T.transform(*x['lonlat']) for x in g])
        sol = np.linalg.lstsq(np.hstack([gp, np.ones((len(gp), 1))]), gw, rcond=None)[0]; M0 = sol.T
        src, dst = fit_tiles(paths, np.vstack(pts), M0)
        src = np.vstack([src, gp]); dst = np.vstack([dst, gw])
        json.dump({'nota': 'ver osasco_georef.py', 'M0': M0.tolist(), 'src_page_pt': src.round(3).tolist(), 'dst_utm': dst.round(2).tolist()},
                  open(os.path.join(HERE, 'osasco_tps_cp.json'), 'w'))
    warp = load_warp()
    # ZMRC
    green = unary_union([make_valid(Polygon(s)) for p in paths if p['kind'] == 'fill' and p['color'] in (LG, DG)
                         for s in p['subs'] if len(s) >= 3 and not in_inset(s)])
    main_poly = max(getattr(green.buffer(0.6).buffer(-0.6), 'geoms', [green]), key=lambda g: g.area)
    Z = Polygon(warp(np.array(Polygon(main_poly.exterior).simplify(0.05).exterior.coords))).simplify(3)
    json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {'regra': 'osasco_zmrc', 'area_km2': round(Z.area / 1e6, 2)},
               'geometry': {'type': 'Polygon', 'coordinates': [[[round(a, 7) for a in Ti.transform(x, y)] for x, y in Z.exterior.coords]]}}]},
              open(os.path.join(OUT, 'osasco_zmrc.geojson'), 'w'), ensure_ascii=False)
    # VER
    sk_page = ver_centerlines(paths); sk = [LineString(warp(np.array(l.coords))) for l in sk_page]
    kept = []
    for i, L in enumerate(sk):
        for direction in (1, -1):
            n = max(2, int(L.length / 15) + 1)
            ll = [Ti.transform(*L.interpolate(t, normalized=True).coords[0]) for t in np.linspace(0, 1, n)][::direction]
            body = {'shape': [{'lat': y, 'lon': x} for x, y in ll], 'costing': 'auto', 'shape_match': 'map_snap',
                    'trace_options': {'search_radius': 40, 'gps_accuracy': 15, 'turn_penalty_factor': 200},
                    'filters': {'attributes': ['edge.way_id', 'edge.names', 'edge.begin_shape_index', 'edge.end_shape_index', 'edge.road_class', 'shape'], 'action': 'include'}}
            r = requests.post(f'{VALHALLA}/trace_attributes', json=body, timeout=120).json()
            if 'edges' not in r: continue
            shp = _decode(r['shape'])
            for e in r['edges']:
                c = [T.transform(*p) for p in shp[e['begin_shape_index']:e['end_shape_index'] + 1]]
                if len(c) < 2 or e.get('road_class') in ('motorway', 'trunk'): continue
                E = LineString(c)
                if E.length < 1: continue
                pts = [E.interpolate(t, normalized=True) for t in np.linspace(0, 1, max(3, int(E.length / 8) + 1))]
                if np.quantile([p.distance(L) for p in pts], 0.9) > 42: continue
                span = abs(L.project(pts[-1]) - L.project(pts[0]))
                if span < (0.55 if E.length > 25 else 0.4) * E.length: continue
                kept.append((i, e, E))
    from collections import defaultdict
    linelen, namelen, byway, names = defaultdict(float), defaultdict(float), defaultdict(list), {}
    for i, e, E in kept:
        nm = (e.get('names') or [''])[0]; namelen[(i, nm)] += E.length; linelen[i] += E.length
    for i, e, E in kept:
        nm = (e.get('names') or [''])[0]
        if namelen[(i, nm)] < 150 and namelen[(i, nm)] < 0.25 * linelen[i]: continue
        byway[e['way_id']].append(E); names[e['way_id']] = nm
    mun = [f for f in json.load(open(os.path.join(OUT, 'ibge_rmsp_municipios.geojson')))['features'] if f['properties']['ibge'] == '3534401'][0]
    osa = Polygon([T.transform(*c) for c in shape(mun['geometry']).exterior.coords]).buffer(30)
    feats = []
    for w, ls in byway.items():
        u = unary_union(ls); g = (u if u.geom_type == 'LineString' else linemerge(u)).intersection(osa)
        if g.is_empty or g.length < 12 or g.geom_type not in ('LineString', 'MultiLineString'): continue
        gl = [g] if g.geom_type == 'LineString' else list(g.geoms)
        coords = [[[round(a, 7) for a in Ti.transform(x, y)] for x, y in l.coords] for l in gl]
        geom = {'type': 'LineString', 'coordinates': coords[0]} if len(coords) == 1 else {'type': 'MultiLineString', 'coordinates': coords}
        feats.append({'type': 'Feature', 'geometry': geom, 'properties': {'osm_way_id': w, 'nome': names[w] or None, 'comprimento_m': round(g.length)}})
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(OUT, 'osasco_ver_mapa.geojson'), 'w'), ensure_ascii=False, separators=(',', ':'))
    print(f'ZMRC {Z.area / 1e6:.2f} km²; VER {len(feats)} ways, {sum(f["properties"]["comprimento_m"] for f in feats) / 1000:.1f} km')


def _decode(s, prec=6):
    idx = lat = lng = 0; out = []
    while idx < len(s):
        vals = []
        for _ in (0, 1):
            shift = res = 0
            while True:
                b = ord(s[idx]) - 63; idx += 1; res |= (b & 0x1f) << shift; shift += 5
                if b < 0x20: break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]; lng += vals[1]; out.append((lng / 10 ** prec, lat / 10 ** prec))
    return out


if __name__ == '__main__':
    main()
