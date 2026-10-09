#!/usr/bin/env python3
"""Baixa pontos de descanso/apoio ao caminhoneiro do OSM (Overpass) para a região-piloto e gera
data/raw/rest_stops.geojson + db/seed/0003_rest_stops.sql.
Uso: python3 scripts/fetch-rest-stops.py [--bbox S,W,N,E] [--from-cache arquivo.json]
Fonte: OpenStreetMap (ODbL) — dados DERIVADOS do OSM, não misturados com os reportes.
"""
import json, re, sys, pathlib, urllib.request, urllib.parse
root = pathlib.Path(__file__).resolve().parent.parent
bbox = '-24.2,-47.6,-23.0,-45.8'  # Grande SP com margem (S,W,N,E)
cache = None
args = sys.argv[1:]
while args:
    a = args.pop(0)
    if a == '--bbox': bbox = args.pop(0)
    elif a == '--from-cache': cache = args.pop(0)

QL = f"""[out:json][timeout:180];
(
  nwr["highway"="rest_area"]({bbox});
  nwr["highway"="services"]({bbox});
  nwr["amenity"="truck_stop"]({bbox});
  nwr["amenity"="parking"]["hgv"="designated"]({bbox});
  nwr["amenity"="parking"]["parking"="truck"]({bbox});
  nwr["amenity"="fuel"]["hgv"="yes"]({bbox});
);
out center tags;"""
MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

def fetch():
    data = urllib.parse.urlencode({'data': QL}).encode()
    for m in MIRRORS:
        try:
            req = urllib.request.Request(m, data=data, headers={'User-Agent': 'truck-router-mvp/0.1', 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.load(r)['elements']
        except Exception as e:
            print(f'falhou {m}: {e}', file=sys.stderr)
    raise SystemExit('Overpass indisponível; tente mais tarde ou use --from-cache')

NAME_PAT = re.compile(r'posto|graal|rodo|parada|descanso|servi[cç]o|truck|caminh|frango assado|sau\b', re.I)

def classify(t):
    if t.get('highway') == 'rest_area': return 'rest_area'
    if t.get('amenity') == 'truck_stop': return 'truck_stop'
    if t.get('amenity') == 'parking': return 'truck_parking'
    if t.get('amenity') == 'fuel': return 'fuel_hgv'
    if t.get('highway') == 'services':
        # highway=services no Brasil é muito usado para comércio qualquer; só aceita com nome relevante
        return 'service_area' if NAME_PAT.search(t.get('name') or '') else None
    return None

els = json.load(open(cache))['elements'] if cache else fetch()
feats = []
for e in els:
    t = e.get('tags', {})
    kind = classify(t)
    if not kind: continue
    lat = e.get('lat') or e.get('center', {}).get('lat'); lon = e.get('lon') or e.get('center', {}).get('lon')
    if lat is None: continue
    feats.append({'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]},
                  'properties': {'osm_id': f"{e['type'][0]}{e['id']}", 'name': t.get('name'), 'kind': kind,
                                 'tags': {k: v for k, v in t.items() if k in ('name', 'operator', 'brand', 'opening_hours', 'hgv', 'toilets', 'shower', 'restaurant', 'fuel:diesel')}}})
out = root / 'data' / 'raw' / 'rest_stops.geojson'
out.write_text(json.dumps({'type': 'FeatureCollection', 'features': feats}, ensure_ascii=False))
sql = ['-- GERADO por scripts/fetch-rest-stops.py (OpenStreetMap via Overpass, ODbL). Não edite à mão.']
for f in feats:
    p = f['properties']; lon, lat = f['geometry']['coordinates']
    sql.append("insert into rest_stops (osm_id, name, kind, geom, tags, source) values "
               f"($i${p['osm_id']}$i$, {('$n$' + p['name'] + '$n$') if p['name'] else 'null'}, '{p['kind']}', "
               f"ST_SetSRID(ST_MakePoint({lon}, {lat}), 4326), $t${json.dumps(p['tags'], ensure_ascii=False)}$t$::jsonb, 'OSM/Overpass') "
               "on conflict (osm_id) do update set name = excluded.name, kind = excluded.kind, geom = excluded.geom, tags = excluded.tags;")
(root / 'db' / 'seed' / '0003_rest_stops.sql').write_text('\n'.join(sql) + '\n')
from collections import Counter
print(f'ok: {len(feats)} pontos -> {out.relative_to(root)} e db/seed/0003_rest_stops.sql', dict(Counter(f["properties"]["kind"] for f in feats)))
