"""Águas da Prata (3500402): "todas as vias do Município" do Decreto 2.799/2019, art. 1º — sem as rodovias estaduais/federais.

Gera 3500402_municipio.geojson a partir de:
  * o limite municipal do IBGE (API de malhas v3, qualidade máxima; cache do importador em
    data/cache/municipios/ibge_malha_3500402.geojson);
  * um extrato do OSM (formato Overpass "out geom tags", ways de highway do município tiradas do PBF do Sudeste) com as
    rodovias a deixar livres, recortadas com folga de 40 m de cada lado: o decreto municipal não alcança rodovia de outra
    jurisdição; o art. 2º exclui expressamente a SP-342 (km 224+030 a 251+150) e a SP-215 (km 29+755 a 49+940), que no município coincidem em parte com a BR-267 (inclusive a travessia urbana da SP-342, Av. Washington Luís e Av. Cel. Ernesto de Oliveira). Ficam
    livres as ways com essas refs, toda motorway/trunk (e alças) e as alças (*_link) com ref estadual/federal. Estradas
    municipais com código (AGP-020, AGP-030, AGP-215) continuam na zona.

  python3 data/raw/municipios/geo/3500402_municipio_curadoria.py data/cache/municipios/ibge_malha_3500402.geojson <extrato_osm.json>

O recorte parte o município em pedaços (a camada usa só o anel externo de cada polígono, por isso não há furos).
Requer shapely e pyproj.
"""
import json
import pathlib
import re
import sys

from pyproj import Transformer
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import transform, unary_union

REFS = ('SP-342', 'SP-215', 'BR-267')
FOLGA_M = 40
OUT = pathlib.Path(__file__).with_name('3500402_municipio.geojson')
T = Transformer.from_crs(4326, 31983, always_xy=True).transform
Ti = Transformer.from_crs(31983, 4326, always_xy=True).transform


def livre(t):
    hw = t.get('highway', '')
    refs = [r.strip() for r in re.split('[;,]', t.get('ref') or '') if r.strip()]
    if any(r.split('/')[0] in REFS for r in refs):
        return True
    if hw.startswith(('motorway', 'trunk')):
        return True
    return hw.endswith('_link') and any(re.match(r'^(SP|BR|SPA|SPI)-', r) for r in refs)


def main(malha, osm):
    Z = transform(T, shape(json.load(open(malha))['features'][0]['geometry']))
    rod = [transform(T, LineString([(q['lon'], q['lat']) for q in e['geometry']])) for e in json.load(open(osm))['elements']
           if 'highway' in e.get('tags', {}) and len(e.get('geometry') or []) >= 2 and livre(e['tags'])]
    Z = Z.difference(unary_union(rod).buffer(FOLGA_M))
    partes = [Polygon(g.exterior) for g in getattr(Z, 'geoms', [Z]) if g.geom_type == 'Polygon' and g.area > 20000]
    Z = transform(Ti, unary_union(partes).simplify(5))
    polys = [Z] if Z.geom_type == 'Polygon' else list(Z.geoms)
    rnd = lambda c: [[round(x, 6), round(y, 6)] for x, y in c]
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': f'IBGE, malha municipal (API v3, qualidade máxima); rodovias {", ".join(REFS)} (e motorway/trunk e alças) recortadas com folga de {FOLGA_M} m sobre o OpenStreetMap (ODbL 1.0)',
          'features': [{'type': 'Feature', 'properties': {'descricao': 'Território do Município de Águas da Prata (Dec. 2.799/2019, art. 1º), sem a SP-342 e a SP-215 (art. 2º)', 'aproximado': False, 'rodovias_livres': list(REFS)},
                        'geometry': {'type': 'MultiPolygon', 'coordinates': [[rnd(p.exterior.coords)] for p in polys]}}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT}: {len(polys)} parte(s), {len(rod)} ways de rodovia')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
