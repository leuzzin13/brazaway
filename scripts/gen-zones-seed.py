#!/usr/bin/env python3
"""Gera db/seed/0002_zones.sql a partir dos GeoJSON em data/raw (GeoSampa WFS) + config/zmrc-rules.json.

Zonas geradas (ids estáveis):
  ...0001  ZMRC (Portaria SMT.GAB 137/2018)                                  geometria: zmrc
  ...0002  Rodízio — caminhões (Decreto 58.584/2018), SEM as vias do Minianel  geometria: mian menos o corredor das vias-limite
  ...0003  Produtos perigosos no Minianel (Portaria SMT.GAB 051/2024)        geometria: mian (+25 m para fora via rules.inset_m)
  ...0004  Rodízio — veículos que não são caminhão (inclusive vias-limite)  geometria: mian (+25 m para fora)

Corte das vias do Minianel (zona 0002; Decreto 58.584/2018 art. 2º §2º: caminhões podem usar as vias do Minianel):
o polígono do GeoSampa contém o corredor inteiro das marginais (as duas pistas e o rio), com largura variável
(medido: até ~450 m). O corte é feito pelo PostGIS ao aplicar o seed: ST_Difference(mian, união de buffers de
trechos da PRÓPRIA borda do GeoSampa, cada um com a largura medida naquele ponto). Só entram no seed a geometria do
GeoSampa e números (largura por ponto da borda); nenhuma geometria do OSM.

Uso:
  python3 scripts/gen-zones-seed.py                 # gera o seed (só stdlib)
  python3 scripts/gen-zones-seed.py --measure       # remede as larguras no Valhalla local (VALHALLA_URL, default
                                                    # http://localhost:8002) e grava config/zmrc-rules.json
"""
import json
import math
import os
import pathlib
import re
import sys
import unicodedata
import urllib.request

root = pathlib.Path(__file__).resolve().parent.parent
raw = root / 'data' / 'raw'
cfg_path = root / 'config' / 'zmrc-rules.json'
cfg = json.load(open(cfg_path, encoding='utf-8'))

ZMRC_ID = '22222222-2222-4222-8222-000000000001'


def load(name):
    p = raw / name
    if not p.exists():
        return None
    d = json.load(open(p, encoding='utf-8'))
    f = d['features'][0]
    geom = f['geometry']
    if geom['type'] == 'Polygon':
        geom = {'type': 'MultiPolygon', 'coordinates': [geom['coordinates']]}
    src = (f"GeoSampa WFS geoportal:{name.replace('geosampa_', '').replace('.geojson', '')} "
           f"(fonte original {f['properties'].get('sg_fonte_original')}, carga {f['properties'].get('dt_carga')}; CC-BY-SA 4.0)")
    return geom, src


def outer_ring(mp):
    r = mp['coordinates'][0][0]
    return r[:-1] if r[0] == r[-1] else r


def subpath(ring, a, via, b):
    """Vértices da borda de `a` até `b` (pontos mais próximos), no sentido que passa por `via`."""
    def nearest(p):
        return min(range(len(ring)), key=lambda i: (ring[i][0] - p[0]) ** 2 + (ring[i][1] - p[1]) ** 2)
    ia, iv, ib = nearest(a), nearest(via), nearest(b)
    n = len(ring)
    fwd = [(ia + k) % n for k in range((ib - ia) % n + 1)]
    idx = fwd if iv in fwd else [(ia - k) % n for k in range((ia - ib) % n + 1)]
    return [ring[i] for i in idx]


def gj(g):
    return f"ST_SetSRID(ST_GeomFromGeoJSON($g${json.dumps(g, separators=(',', ':'))}$g$), 4326)"


# --------------------------------------------------------------------------------------------- medição (--measure)
LAT0, LON0 = -23.55, -46.65
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540


def to_xy(p):
    return ((p[0] - LON0) * KX, (p[1] - LAT0) * KY)


def to_ll(x, y):
    return [round(x / KX + LON0, 6), round(y / KY + LAT0, 6)]


# Vias do Minianel (Decreto 58.584/2018 art. 2º; Portaria SMT.GAB 051/2024 Anexo IV) como aparecem nos nomes do OSM
VIAS_MINIANEL = re.compile(
    r'MARGINAL TIETE|MARGINAL PINHEIROS|\bSP-015\b|PRESIDENTE CASTELO BRANCO|MORVAN DIAS|OTAVIANO ALVES DE LIMA|'
    r'EMBAIXADOR MACEDO SOARES|NACOES UNIDAS|SIMAO FAIGUENBOIM|AVENIDA DOS BANDEIRANTES|ESCRAGNOL|MARIA MALUF|ALIOMAR BALEEIRO|'
    r'TANCREDO NEVES|MALVINA FERRARA|CIPRIANO SIQUEIRA|JUNTAS PROVISORIAS|VIADUTO GRANDE SAO PAULO|ANHAIA MEL|SALIM FARAH MALUF')


def _norm(s):
    s = unicodedata.normalize('NFKD', s)
    return ''.join(c for c in s if not unicodedata.combining(c)).upper()


def decode6(s):
    """Polyline com precisão 6 (formato do Valhalla) -> [[lon, lat], ...]."""
    out, i, lat, lon = [], 0, 0, 0
    while i < len(s):
        vals = []
        for _ in range(2):
            shift = res = 0
            while True:
                b = ord(s[i]) - 63
                i += 1
                res |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]
        lon += vals[1]
        out.append([lon / 1e6, lat / 1e6])
    return out


def point_in_ring(x, y, R):
    inside = False
    for i in range(len(R)):
        (x1, y1), (x2, y2) = R[i], R[(i + 1) % len(R)]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def measure(mian_geom, spacing=40.0, depth=520.0, step=40.0):
    """Para cada trecho de config.minianel_corridors, mede a cada `spacing` m da borda a distância até a pista
    mais afastada das vias do Minianel (Valhalla /locate). Devolve {trecho: [[lon, lat, largura_m], ...]}."""
    url = os.environ.get('VALHALLA_URL', 'http://localhost:8002').rstrip('/') + '/locate'
    ring = outer_ring(mian_geom)
    R = [to_xy(p) for p in ring]
    c = cfg['minianel_corridors']
    out = {}
    for key in ('marginais', 'avenidas'):
        s = c[key]
        cap = float(s.get('max_width_m', 500))
        path = [to_xy(p) for p in subpath(ring, s['from'], s['via'], s['to'])]
        # amostras ao longo da borda (posição, ponto, normal para dentro)
        samples, arc = [], 0.0
        for i in range(len(path) - 1):
            (x1, y1), (x2, y2) = path[i], path[i + 1]
            L = math.hypot(x2 - x1, y2 - y1)
            if L == 0:
                continue
            nx, ny = -(y2 - y1) / L, (x2 - x1) / L          # normal à esquerda...
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            if point_in_ring(mx - nx * 5, my - ny * 5, R) and not point_in_ring(mx + nx * 5, my + ny * 5, R):
                nx, ny = -nx, -ny                          # ...ou à direita, conforme o lado de dentro do polígono
            t = (math.ceil(arc / spacing) * spacing - arc) if arc else 0.0
            while t <= L:
                samples.append((arc + t, x1 + (x2 - x1) * t / L, y1 + (y2 - y1) * t / L, nx, ny))
                t += spacing
            arc += L
        # sondagens para dentro -> arestas com nome de via do Minianel
        probes = [{'lon': to_ll(sx + nx * d, sy + ny * d)[0], 'lat': to_ll(sx + nx * d, sy + ny * d)[1]}
                  for (_, sx, sy, nx, ny) in samples for d in [k * step for k in range(int(depth // step) + 1)]]
        shapes = {}
        for k in range(0, len(probes), 500):
            body = json.dumps({'locations': probes[k:k + 500], 'costing': 'auto', 'verbose': True}).encode()
            res = json.load(urllib.request.urlopen(urllib.request.Request(url, data=body), timeout=120))
            for r in res:
                for e in r.get('edges') or []:
                    ei = e.get('edge_info') or {}
                    if e.get('distance', 1e9) > 30 or not VIAS_MINIANEL.search(_norm(' / '.join(ei.get('names') or []))):
                        continue
                    shapes[ei.get('shape')] = True
        # pontos das vias (a cada ~10 m), só os que ficam dentro do polígono
        pts = []
        for sh in shapes:
            ll = [to_xy(p) for p in decode6(sh)]
            for (x1, y1), (x2, y2) in zip(ll, ll[1:]):
                n = max(1, int(math.hypot(x2 - x1, y2 - y1) // 10))
                for j in range(n + 1):
                    x, y = x1 + (x2 - x1) * j / n, y1 + (y2 - y1) * j / n
                    if point_in_ring(x, y, R):
                        pts.append((x, y))
        # distância de cada ponto à borda do trecho e posição (arco) do ponto mais próximo
        segs, arc = [], 0.0
        for (x1, y1), (x2, y2) in zip(path, path[1:]):
            L = math.hypot(x2 - x1, y2 - y1)
            segs.append((x1, y1, x2, y2, L, arc))
            arc += L
        cell = 250.0
        grid = {}
        for si, (x1, y1, x2, y2, L, a0) in enumerate(segs):
            for gx in range(int(min(x1, x2) // cell) - 1, int(max(x1, x2) // cell) + 2):
                for gy in range(int(min(y1, y2) // cell) - 1, int(max(y1, y2) // cell) + 2):
                    grid.setdefault((gx, gy), []).append(si)
        nbins = int(arc // spacing) + 1
        width = [0.0] * nbins
        reach = int(math.ceil(cap / cell))
        for (x, y) in pts:
            best = (1e18, 0.0)
            cx, cy = int(x // cell), int(y // cell)
            cand = {si for gx in range(cx - reach, cx + reach + 1) for gy in range(cy - reach, cy + reach + 1) for si in grid.get((gx, gy), ())}
            for si in cand:
                x1, y1, x2, y2, L, a0 = segs[si]
                if L == 0:
                    continue
                t = max(0.0, min(1.0, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (L * L)))
                d = math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)))
                if d < best[0]:
                    best = (d, a0 + t * L)
            d, a = best
            if d <= cap:
                b = min(nbins - 1, int(a // spacing))
                width[b] = max(width[b], d)
        prof = []
        for (a, sx, sy, nx, ny) in samples:
            b = min(nbins - 1, int(a // spacing))
            w = max(width[max(0, b - 1):b + 2])
            prof.append(to_ll(sx, sy) + [int(min(cap, max(float(s.get('min_width_m', 30)), w + 20)))])
        out[key] = prof
        ws = sorted(p[2] for p in prof)
        print(f'{key}: {len(samples)} amostras, {len(shapes)} arestas, {len(pts)} pontos; largura mediana {ws[len(ws) // 2]} m, máx {ws[-1]} m')
    return out


def corridor_cut_sql(mian_geom):
    c = cfg['minianel_corridors']
    ring = outer_ring(mian_geom)
    parts = []
    for key in ('marginais', 'avenidas'):
        s = c[key]
        prof = s.get('width_profile')
        if prof:
            for (a, b) in zip(prof, prof[1:]):
                line = {'type': 'LineString', 'coordinates': [a[:2], b[:2]]}
                parts.append(f"ST_Buffer({gj(line)}::geography, {float(max(a[2], b[2]))})::geometry")
        else:  # sem medição: largura única
            line = {'type': 'LineString', 'coordinates': subpath(ring, s['from'], s['via'], s['to'])}
            parts.append(f"ST_Buffer({gj(line)}::geography, {float(s['width_m'])})::geometry")
    for it in c.get('interchanges', []):
        x, y = it['at']
        parts.append(f"ST_Buffer(ST_SetSRID(ST_MakePoint({x}, {y}), 4326)::geography, {float(it['radius_m'])})::geometry")
    cut = 'ST_Union(ARRAY[\n      ' + ',\n      '.join(parts) + '])'
    return f"ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Difference({gj(mian_geom)},\n    {cut})), 3))"


m = load('geosampa_restricao_circulacao_veiculo_mian.geojson')

if '--measure' in sys.argv:
    if not m:
        raise SystemExit('falta data/raw/geosampa_restricao_circulacao_veiculo_mian.geojson')
    prof = measure(m[0])
    for key, p in prof.items():
        cfg['minianel_corridors'][key]['width_profile'] = p
    txt = json.dumps(cfg, ensure_ascii=False, indent=2)
    # perfis de largura em uma linha por ponto (arquivo legível)
    txt = re.sub(r'\[\s+(-?\d+\.\d+),\s+(-?\d+\.\d+),\s+(\d+)\s+\]', r'[\1, \2, \3]', txt)
    cfg_path.write_text(txt + '\n', encoding='utf-8')
    print(f'ok: perfis de largura gravados em {cfg_path.relative_to(root)}')

zones = []  # (id, name, geom_sql, rules, source)
z = load('geosampa_restricao_circulacao_veiculo_zmrc.geojson')
if z:
    zones.append((ZMRC_ID, cfg['name'], f"ST_Multi({gj(z[0])})", cfg['rules'], z[1]))
if m:
    for oz in cfg.get('other_zones', []):
        if oz['geometry'] == 'mian':
            geom_sql = f"ST_Multi({gj(m[0])})"
            src = m[1]
        elif oz['geometry'] == 'mian_minus_corridors':
            geom_sql = corridor_cut_sql(m[0])
            src = m[1] + ' menos o corredor das vias do Minianel (config/zmrc-rules.json: minianel_corridors)'
        else:
            raise SystemExit(f"geometria desconhecida: {oz['geometry']}")
        zones.append((oz['id'], oz['name'], geom_sql, oz['rules'], src))

out = ['-- GERADO por scripts/gen-zones-seed.py a partir de data/raw (GeoSampa WFS) e config/zmrc-rules.json. Não edite à mão.',
       '-- Regras conferidas nas normas em 09/10/2026 (ver docs/layers/core_legal.md).']
for id_, name, geom_sql, rules, src in zones:
    out.append(
        "insert into restriction_zones (id, name, geom, rules, source) values\n"
        f"  ('{id_}', $n${name}$n$, {geom_sql},\n"
        f"   $r${json.dumps(rules, ensure_ascii=False)}$r$::jsonb, $s${src}$s$)\n"
        "on conflict (id) do update set name = excluded.name, geom = excluded.geom, rules = excluded.rules, source = excluded.source, active = true;"
    )
(root / 'db' / 'seed' / '0002_zones.sql').write_text('\n'.join(out) + '\n', encoding='utf-8')
print(f'ok: {len(zones)} zonas -> db/seed/0002_zones.sql')
