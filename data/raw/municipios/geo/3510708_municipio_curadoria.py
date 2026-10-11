"""Cardoso (3510708): território do município para o Decreto 3.491/2020, art. 2º — sem as rodovias estaduais/federais.

Gera 3510708_municipio.geojson a partir de:
  * o limite municipal do IBGE (API de malhas v3, qualidade máxima; cache do importador em
    data/cache/municipios/ibge_malha_3510708.geojson);
  * um extrato do OSM (formato Overpass "out geom tags", ways de highway do município tiradas do PBF do Sudeste) com as
    rodovias a deixar livres (SP-461/BR-154, SP-322/SP-154 e acessos estaduais), recortadas com folga de 40 m de cada lado:
    o decreto municipal não alcança rodovia de outra jurisdição (mesma convenção das zonas de perímetro urbano).

  python3 data/raw/municipios/geo/3510708_municipio_curadoria.py <ibge_malha_3510708.geojson> <extrato_osm.json>

O recorte parte o município em pedaços (a camada usa só o anel externo de cada polígono, por isso não há furos).
Requer shapely e pyproj.
"""
import json
import pathlib
import sys

from pyproj import Transformer
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import transform, unary_union

REFS = ('SP-461', 'BR-154', 'SP-322', 'SP-154')
FOLGA_M = 40
OUT = pathlib.Path(__file__).with_name('3510708_municipio.geojson')
T = Transformer.from_crs(4326, 31982, always_xy=True).transform
Ti = Transformer.from_crs(31982, 4326, always_xy=True).transform


def main(malha, osm):
    Z = transform(T, shape(json.load(open(malha))['features'][0]['geometry']))
    rod = [transform(T, LineString([(q['lon'], q['lat']) for q in e['geometry']])) for e in json.load(open(osm))['elements']
           if 'highway' in e.get('tags', {}) and len(e['geometry']) >= 2
           and any(r.strip().split('/')[0] in REFS for r in (e['tags'].get('ref') or '').split(';'))]
    Z = Z.difference(unary_union(rod).buffer(FOLGA_M))
    partes = [Polygon(g.exterior) for g in getattr(Z, 'geoms', [Z]) if g.geom_type == 'Polygon' and g.area > 20000]
    Z = transform(Ti, unary_union(partes).simplify(5))
    polys = [Z] if Z.geom_type == 'Polygon' else list(Z.geoms)
    rnd = lambda c: [[round(x, 6), round(y, 6)] for x, y in c]
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': f'IBGE, malha municipal (API v3, qualidade máxima); rodovias {", ".join(REFS)} recortadas com folga de {FOLGA_M} m sobre o OpenStreetMap (ODbL 1.0)',
          'features': [{'type': 'Feature', 'properties': {'descricao': 'Território do Município de Cardoso (Dec. 3.491/2020, art. 1º), sem as rodovias estaduais e federais', 'aproximado': False, 'rodovias_livres': list(REFS)},
                        'geometry': {'type': 'MultiPolygon', 'coordinates': [[rnd(p.exterior.coords)] for p in polys]}}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT}: {len(polys)} parte(s), {len(rod)} ways de rodovia')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
