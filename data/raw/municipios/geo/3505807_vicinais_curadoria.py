"""Bastos (3505807): estradas vicinais do Decreto 1.758/2024, art. 1º (BAS 010, BAS 020 e BAS 050/168), em toda a extensão.

Gera 3505807_vicinais.geojson a partir de:
  * um extrato do OSM (formato Overpass "out geom tags", com as ways de highway do município tiradas do PBF do Sudeste):
    as vicinais não têm nome no OSM, só `ref` (BAS-010, BAS-020, BAS-050 e BAS-168), por isso o arquivo é curado e não
    montado por nome (`construir: trechos` só casa `name`);
  * o limite municipal do IBGE (cache do importador, data/cache/municipios/ibge_malha_3505807.geojson): cada linha é
    cortada no limite de Bastos.

  python3 data/raw/municipios/geo/3505807_vicinais_curadoria.py <extrato_osm.json> <ibge_malha_3505807.geojson>

A "BAS 152" do decreto não existe no OSM (há uma BAS-252, a oeste, que não foi incluída): fica como pendência.
Requer shapely e pyproj.
"""
import json
import pathlib
import sys

from pyproj import Transformer
from shapely.geometry import LineString, shape
from shapely.ops import transform

REFS = {'BAS-010': 'BAS 010 (Bastos–Iacri)', 'BAS-020': 'BAS 020 (Bastos–Tupã)',
        'BAS-050': 'BAS 050 (Bastos–Parapuã)', 'BAS-168': 'BAS 168 (Bastos–Parapuã)'}
OUT = pathlib.Path(__file__).with_name('3505807_vicinais.geojson')
T = Transformer.from_crs(4326, 31982, always_xy=True).transform
Ti = Transformer.from_crs(31982, 4326, always_xy=True).transform


def main(osm, malha):
    lim = transform(T, shape(json.load(open(malha))['features'][0]['geometry']))
    feats = []
    for e in json.load(open(osm))['elements']:
        t = e.get('tags', {})
        refs = [r.strip() for r in (t.get('ref') or '').split(';')]
        hit = [r for r in refs if r in REFS]
        if not hit or 'highway' not in t or len(e['geometry']) < 2:
            continue
        L = transform(T, LineString([(p['lon'], p['lat']) for p in e['geometry']])).intersection(lim)
        for g in [g for g in getattr(L, 'geoms', [L]) if g.geom_type == 'LineString' and g.length >= 10]:
            c = transform(Ti, g)
            feats.append({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7), round(y, 7)] for x, y in c.coords]},
                          'properties': {'inciso': 'art. 1º', 'via': REFS[hit[0]], 'trecho': f'Estrada vicinal {REFS[hit[0]]}, em toda a extensão no município',
                                         'aproximado': True, 'osm_way_id': e['id'], 'nome_osm': t.get('name') or t.get('ref'),
                                         'mao_unica': False, 'sentido': 'ambos', 'comprimento_m': round(g.length)}})
    feats.sort(key=lambda f: (f['properties']['via'], f['properties']['osm_way_id']))
    fc = {'type': 'FeatureCollection', 'pendencias': ['BAS 152 (Bastos–Parapuã) não encontrada no OSM'],
          'fonte_geometria': 'OpenStreetMap (ODbL 1.0), ways com ref BAS-010, BAS-020, BAS-050 e BAS-168, cortadas no limite municipal do IBGE',
          'features': feats}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    km = {}
    for f in feats:
        km[f['properties']['via']] = km.get(f['properties']['via'], 0) + f['properties']['comprimento_m'] / 1000
    print(OUT, len(feats), {k: round(v, 1) for k, v in km.items()})


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
