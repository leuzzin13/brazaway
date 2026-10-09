#!/usr/bin/env python3
"""Gera db/seed/0002_zones.sql a partir dos GeoJSON em data/raw (GeoSampa WFS) + config/zmrc-rules.json.

Zonas geradas (ids estáveis):
  ...0001  ZMRC (Portaria SMT.GAB 137/2018)                                 geometria: zmrc
  ...0002  Rodízio — caminhões (Decreto 58.584/2018), SEM as vias do Minianel geometria: mian menos o corredor das vias-limite
  ...0003  Produtos perigosos no Minianel (Portaria SMT.GAB 051/2024)       geometria: mian (+25 m para fora via rules.inset_m)
  ...0004  Rodízio — veículos que não são caminhão (inclusive vias-limite) geometria: mian (+25 m para fora)

O corte das vias do Minianel (zona 0002) é feito pelo PostGIS na hora de aplicar o seed:
ST_Difference(mian, buffer(trecho da borda, largura)). O trecho é um pedaço da própria borda do polígono do
GeoSampa (sem geometria do OSM). Larguras em config/zmrc-rules.json (minianel_corridors).

Uso: python3 scripts/gen-zones-seed.py
"""
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
raw = root / 'data' / 'raw'
cfg = json.load(open(root / 'config' / 'zmrc-rules.json', encoding='utf-8'))

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


def corridor_cut_sql(mian_geom):
    c = cfg['minianel_corridors']
    ring = outer_ring(mian_geom)
    parts = []
    for key in ('marginais', 'avenidas'):
        s = c[key]
        line = {'type': 'LineString', 'coordinates': subpath(ring, s['from'], s['via'], s['to'])}
        parts.append(f"ST_Buffer({gj(line)}::geography, {float(s['width_m'])})::geometry")
    for it in c.get('interchanges', []):
        x, y = it['at']
        parts.append(f"ST_Buffer(ST_SetSRID(ST_MakePoint({x}, {y}), 4326)::geography, {float(it['radius_m'])})::geometry")
    cut = 'ST_Union(ARRAY[\n      ' + ',\n      '.join(parts) + '])'
    return f"ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Difference({gj(mian_geom)},\n    {cut})), 3))"


zones = []  # (id, name, geom_sql, rules, source)
z = load('geosampa_restricao_circulacao_veiculo_zmrc.geojson')
if z:
    zones.append((ZMRC_ID, cfg['name'], f"ST_Multi({gj(z[0])})", cfg['rules'], z[1]))
m = load('geosampa_restricao_circulacao_veiculo_mian.geojson')
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
