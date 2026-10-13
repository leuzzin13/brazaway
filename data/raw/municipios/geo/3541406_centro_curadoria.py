"""Presidente Prudente (3541406): quadrilátero central do Decreto 8.418/1993, art. 1º.

Gera 3541406_centro.geojson: a face da malha do OSM delimitada pelos eixos das Avenidas Cel. José Soares Marcondes,
Washington Luiz, Brasil e Manoel Goulart ("vias internas ao quadrilátero"; as avenidas-limite ficam no contorno e o
recuo de 20 m da camada as deixa livres). Fonte: cache Overpass das vias com nome do município
(data/cache/municipios/osm_named_3541406.json, extraído do PBF local) — derivado do OpenStreetMap (ODbL 1.0).

  python3 data/raw/municipios/geo/3541406_centro_curadoria.py
"""
import json
import pathlib

from shapely.geometry import LineString, Point, mapping
from shapely.ops import polygonize, unary_union

R = pathlib.Path(__file__).resolve().parents[4]
CACHE = R / 'data/cache/municipios/osm_named_3541406.json'
OUT = pathlib.Path(__file__).with_name('3541406_centro.geojson')
VIAS = ['Avenida Coronel José Soares Marcondes', 'Avenida Washington Luiz', 'Avenida Brasil', 'Avenida Manoel Goulart']
# cantos (cruzamentos dos eixos): Soares Marcondes x Washington Luiz, W. Luiz x Brasil, Brasil x Goulart, Goulart x S. Marcondes
CENTRO = Point(-51.3863, -22.1240)

els = json.loads(CACHE.read_text())['elements']
linhas = [LineString([(q['lon'], q['lat']) for q in e['geometry']]) for e in els
          if e.get('tags', {}).get('name') in VIAS and len(e['geometry']) >= 2]
faces = [f for f in polygonize(unary_union(linhas)) if f.contains(CENTRO)]
assert len(faces) == 1, faces
P = faces[0]
P = type(P)(P.exterior).simplify(0.00002)
geom = mapping(P)
geom = {'type': 'Polygon', 'coordinates': [[[round(x, 6), round(y, 6)] for x, y in geom['coordinates'][0]]]}
fc = {'type': 'FeatureCollection',
      'fonte_geometria': 'Eixos do OpenStreetMap (ODbL 1.0) das Avs. Cel. José Soares Marcondes, Washington Luiz, Brasil e Manoel Goulart',
      'features': [{'type': 'Feature', 'properties': {
          'descricao': 'Quadrilátero central de Presidente Prudente (Dec. 8.418/1993, art. 1º): vias internas às Avs. Cel. José Soares Marcondes, Washington Luiz, Brasil e Manoel Goulart',
          'aproximado': False}, 'geometry': geom}]}
OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
print(OUT, len(geom['coordinates'][0]), 'vértices, área m2 ~', round(P.area * 111000 * 103000))
