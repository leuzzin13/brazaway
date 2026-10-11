"""Lins (3527108): Área de Restrição do Dec. 14.435/2025 (vias públicas da cidade) — sem as rodovias SP-300, SP-381, LIN-030, LIN-124, BR-153 e a Perimetral LIN-251.

Gera 3527108_area_restricao.geojson (zona aproximada do perímetro urbano) a partir de:
  * IBGE, Malha de Setores Censitários do Censo 2022 (UF), shapefile de
    https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/SP_setores_CD2022.zip
    (a situação "urbana" do setor segue o perímetro urbano legal do município): setores do município 3527108, distrito
    "Lins", com CD_SIT 1 ou 2 (área urbana de cidade, urbanizada ou não);
  * um extrato do OSM (formato Overpass "out geom tags") com as rodovias a deixar livres, recortadas da zona com folga
    de 40 m de cada lado (as rodovias de outra jurisdição não são alcançadas pelo ato municipal).

  python3 data/raw/municipios/geo/3527108_area_restricao_curadoria.py <dir_ou_.shp dos setores> <extrato_osm.json>

Requer shapely, pyproj e pyshp. Furos são preenchidos (a camada só usa o anel externo) e o resultado é simplificado a ~5 m.
"""
import json
import pathlib
import sys

import shapefile
from pyproj import Transformer
from shapely.geometry import LineString, Polygon, MultiPolygon, mapping, shape
from shapely.ops import transform, unary_union

IBGE = '3527108'
DISTRITO = 'Lins'
RODOVIAS_REF = ['SP-300', 'BR-267', 'SP-381', 'LIN-020', 'LIN-030', 'LIN-124', 'LIN-251', 'BR-153']            # ref do OSM das rodovias que ficam livres
CLASSES_LIVRES = ('motorway', 'motorway_link', 'trunk', 'trunk_link')   # pistas de rodovia (com ou sem ref) também ficam livres
FOLGA_M = 40
OUT = pathlib.Path(__file__).with_name('3527108_area_restricao.geojson')
T = Transformer.from_crs(4326, 31983, always_xy=True).transform
Ti = Transformer.from_crs(31983, 4326, always_xy=True).transform


def main(shp, osm):
    p = pathlib.Path(shp)
    if p.is_dir():
        p = next(p.glob('*_setores_CD2022.shp'))
    r = shapefile.Reader(str(p.with_suffix('')), encoding='utf-8')
    nomes = [f[0] for f in r.fields[1:]]
    setores = []
    for sr in r.iterShapeRecords():
        rec = dict(zip(nomes, sr.record))
        if rec['CD_MUN'] == IBGE and rec['NM_DIST'] == DISTRITO and rec['CD_SIT'] in ('1', '2'):
            setores.append((rec['CD_SETOR'], shape(sr.shape.__geo_interface__).buffer(0)))
    Z = transform(T, unary_union([g for _, g in setores])).buffer(1).buffer(-1)
    els = json.load(open(osm))['elements']
    rod = [transform(T, LineString([(q['lon'], q['lat']) for q in e['geometry']])) for e in els
           if len(e.get('geometry') or []) >= 2 and (
               e.get('tags', {}).get('highway') in CLASSES_LIVRES
               or (any(x.strip() in RODOVIAS_REF for x in (e.get('tags', {}).get('ref') or '').split(';'))
                   and e['tags'].get('highway') in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified')))]
    if rod:
        Z = Z.difference(unary_union(rod).buffer(FOLGA_M))
    partes = [Polygon(g.exterior) for g in getattr(Z, 'geoms', [Z]) if g.geom_type == 'Polygon' and g.area > 20000]
    Z = unary_union(partes).simplify(5)
    Z = transform(Ti, Z)
    rnd = lambda c: [[round(x, 6), round(y, 6)] for x, y in c]
    polys = [Z] if Z.geom_type == 'Polygon' else list(Z.geoms)
    geom = {'type': 'MultiPolygon', 'coordinates': [[rnd(pp.exterior.coords)] for pp in polys]}
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': f'IBGE, Malha de Setores Censitários do Censo 2022 ({len(setores)} setores urbanos do distrito {DISTRITO}); '
                             f'rodovias {", ".join(RODOVIAS_REF)} e pistas motorway/trunk recortadas com folga de {FOLGA_M} m sobre o OpenStreetMap (ODbL 1.0)',
          'features': [{'type': 'Feature', 'properties': {'descricao': 'Área de Restrição de Lins (vias públicas da cidade), aproximada pelos setores censitários urbanos do distrito-sede (IBGE 2022), sem as rodovias SP-300/BR-267, SP-381, LIN-030, BR-153 e a Perimetral LIN-251', 'aproximado': True,
                                                          'setores_ibge': len(setores)}, 'geometry': geom}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT}: {len(polys)} parte(s), {len(setores)} setores')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
