"""Cananéia (3509908): via "ao lado do Hotel Marazul" da Lei 1.680/2004, art. 1º — georreferência APROXIMADA.

O ato não nomeia a via. O Hotel Marazul está no OSM (way 1419724233, tourism=hotel, -47.92585 -25.00986), a ~5 m da Avenida
Luiz Wilson de Barbosa (orla; duas pistas de mão única com o mesmo nome no OSM). Gera 3509908_vias.geojson com os trechos
dessas ways a até 70 m do ponto do hotel (cerca de 140 m de avenida): a "via de passagem ao lado do hotel" por proximidade, não por
confirmação do ato. Pendência: confirmar a via com a Prefeitura/Câmara de Cananéia.

  python3 data/raw/municipios/geo/3509908_vias_curadoria.py data/cache/municipios/osm_named_3509908.json

Requer shapely e pyproj. Dados do OpenStreetMap (ODbL 1.0, © colaboradores do OSM).
"""
import json
import pathlib
import sys

from pyproj import Transformer
from shapely.geometry import LineString, Point
from shapely.ops import transform

T = Transformer.from_crs(4326, 31983, always_xy=True).transform
Ti = Transformer.from_crs(31983, 4326, always_xy=True).transform
OUT = pathlib.Path(__file__).with_name('3509908_vias.geojson')
REGRA = 'cananeia_via_hotel_marazul'
HOTEL = (-47.92585, -25.00986)
WAYS = [718608947, 220547179]
RAIO_M = 70


def main(osm):
    els = {e['id']: e for e in json.load(open(osm))['elements']}
    h = transform(T, Point(HOTEL))
    feats = []
    for i in WAYS:
        e = els[i]
        L = transform(T, LineString([(p['lon'], p['lat']) for p in e['geometry']]))
        g = L.intersection(h.buffer(RAIO_M))
        for part in [x for x in getattr(g, 'geoms', [g]) if x.geom_type == 'LineString' and x.length >= 10]:
            ow = e['tags'].get('oneway') in ('yes', '1')
            ll = transform(Ti, part)
            feats.append({'type': 'Feature', 'properties': {
                'regra_id': REGRA, 'inciso': 'art. 1º', 'via': 'via de passagem ao lado do Hotel Marazul', 'nome_osm': e['tags'].get('name'),
                'osm_way_id': i, 'fonte_trecho': 'Trecho da avenida a até 70 m do Hotel Marazul (way 1419724233 do OSM); o ato não nomeia a via',
                'aproximado': True, 'sentido': 'unico' if ow else 'ambos', 'mao_unica': ow, 'comprimento_m': round(part.length)},
                'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7), round(y, 7)] for x, y in ll.coords]}})
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': 'OpenStreetMap (ODbL 1.0, © colaboradores do OSM): ways da Av. Luiz Wilson de Barbosa a até 70 m do Hotel Marazul',
          'pendencias': ['Via não nomeada no ato (art. 1º da Lei 1.680/2004): identificada por proximidade ao hotel; confirmar com a Prefeitura.'],
          'features': feats}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, indent=1))
    print(f'{OUT.name}: {len(feats)} feições, {sum(f["properties"]["comprimento_m"] for f in feats)} m')


if __name__ == '__main__':
    main(sys.argv[1])
