"""Pontos de descanso/apoio ao caminhoneiro do OpenStreetMap, do PBF do Valhalla (Sudeste inteiro).

Complementa a tabela rest_stops (scripts/fetch-rest-stops.py, Overpass, só a Grande SP) para as rodovias de saída:
o plano de direção da Lei 13.103 precisa de candidatos ao longo de toda a rota (ex.: Dutra até o Rio). Mesmos
critérios do script, com dois acréscimos:
  - highway=rest_area                                   -> rest_area
  - highway=services com nome de posto/parada/rede       -> service_area (no Brasil a tag é usada para qualquer comércio)
  - amenity=truck_stop                                   -> truck_stop
  - amenity=parking com hgv=designated|only ou parking=truck|hgv, ou nome com "caminh" -> truck_parking
  - amenity=fuel com hgv=yes|designated ou fuel:HGV_diesel=yes (bomba de alta vazão)    -> fuel_hgv
A API deduplica contra rest_stops (mesmo objeto OSM ou ponto a menos de 100 m).
Licença: ODbL 1.0 (© colaboradores do OpenStreetMap); fica em data_features separado das fontes CC-BY.
"""
from __future__ import annotations
import re

from sources._osm_pois import extract

LAYER_ID = 'descanso'
SOURCE = 'osm'
SOURCE_URL = 'OpenStreetMap — extrato Geofabrik do Sudeste (o mesmo PBF do Valhalla, data/valhalla/*.osm.pbf)'
LICENSE = 'ODbL 1.0 — © colaboradores do OpenStreetMap'
NOTES = ''

NAME_PAT = re.compile(r'posto|graal|rodo|parada|descanso|servi[cç]o|truck|caminh|frango assado|sau\b', re.I)
KEEP_TAGS = ('name', 'operator', 'brand', 'opening_hours', 'hgv', 'toilets', 'shower', 'restaurant', 'fuel:diesel',
             'fuel:HGV_diesel', 'capacity', 'capacity:hgv', 'fee', 'parking', 'access')


def classify(t: dict[str, str]) -> str | None:
    hw, am = t.get('highway'), t.get('amenity')
    name = t.get('name') or ''
    if hw == 'rest_area':
        return 'rest_area'
    if am == 'truck_stop':
        return 'truck_stop'
    if am == 'parking' and (t.get('hgv') in ('designated', 'only') or t.get('parking') in ('truck', 'hgv')
                            or re.search(r'caminh', name, re.I)):
        return 'truck_parking'
    if am == 'fuel' and (t.get('hgv') in ('yes', 'designated') or t.get('fuel:HGV_diesel') == 'yes'):
        return 'fuel_hgv'
    if hw == 'services':
        return 'service_area' if NAME_PAT.search(name) else None
    return None


def fetch():
    global NOTES
    objs = extract(('highway', 'amenity'), lambda t: classify(t) is not None)
    out = []
    for o in objs:
        kind = classify(o['tags'])
        t = o['tags']
        out.append({
            'source_id': o['osm_id'],
            'geometry': {'type': 'Point', 'coordinates': [round(o['lon'], 6), round(o['lat'], 6)]},
            'name': t.get('name') or None,
            'kind': kind,
            'props': {'osm_id': o['osm_id'], 'tags': {k: v for k, v in t.items() if k in KEEP_TAGS},
                      'categoria': 'OpenStreetMap'},
        })
    from collections import Counter
    NOTES = 'Por tipo: ' + ', '.join(f'{k} {v}' for k, v in Counter(f['kind'] for f in out).most_common()) + '.'
    return out
