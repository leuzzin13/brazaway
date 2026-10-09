#!/usr/bin/env python3
"""Gera db/seed/0002_zones.sql a partir dos GeoJSON em data/raw (GeoSampa WFS) + config/zmrc-rules.json.
Uso: python3 scripts/gen-zones-seed.py
"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
raw = root / 'data' / 'raw'
zmrc_rules = json.load(open(root / 'config' / 'zmrc-rules.json'))

def load(name):
    p = raw / name
    if not p.exists():
        return None
    d = json.load(open(p))
    f = d['features'][0]
    geom = f['geometry']
    if geom['type'] == 'Polygon':
        geom = {'type': 'MultiPolygon', 'coordinates': [geom['coordinates']]}
    src = f"GeoSampa WFS geoportal:{name.replace('geosampa_','').replace('.geojson','')} (fonte original {f['properties'].get('sg_fonte_original')}, carga {f['properties'].get('dt_carga')})"
    return geom, src

zones = []
z = load('geosampa_restricao_circulacao_veiculo_zmrc.geojson')
if z:
    zones.append(('22222222-2222-4222-8222-000000000001', zmrc_rules['name'], z[0], zmrc_rules['rules'], z[1]))
m = load('geosampa_restricao_circulacao_veiculo_mian.geojson')
if m:
    rodizio = {
        "_note": "CONFIRMAR COM A CET: rodízio municipal no Mini-Anel (centro expandido), seg–sex 07:00–10:00 e 17:00–20:00, por final de placa. Caminhões também estão sujeitos.",
        "windows": [{"days": [1, 2, 3, 4, 5], "from": "07:00", "to": "10:00"}, {"days": [1, 2, 3, 4, 5], "from": "17:00", "to": "20:00"}],
        "exceptions": [],
        "plate_rule": {"digits_by_day": {"1": [1, 2], "2": [3, 4], "3": [5, 6], "4": [7, 8], "5": [9, 0]}},
    }
    zones.append(('22222222-2222-4222-8222-000000000002', 'Rodízio municipal (Mini-Anel) São Paulo', m[0], rodizio, m[1]))

out = ['-- GERADO por scripts/gen-zones-seed.py a partir de data/raw (GeoSampa WFS). Não edite à mão.',
       '-- Regras: CONFIRMAR COM A CET (config/zmrc-rules.json).']
for id_, name, geom, rules, src in zones:
    out.append(
        "insert into restriction_zones (id, name, geom, rules, source) values\n"
        f"  ('{id_}', $n${name}$n$, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($g${json.dumps(geom)}$g$), 4326)),\n"
        f"   $r${json.dumps(rules, ensure_ascii=False)}$r$::jsonb, $s${src}$s$)\n"
        "on conflict (id) do update set name = excluded.name, geom = excluded.geom, rules = excluded.rules, source = excluded.source;"
    )
(root / 'db' / 'seed' / '0002_zones.sql').write_text('\n'.join(out) + '\n')
print(f'ok: {len(zones)} zonas -> db/seed/0002_zones.sql')
