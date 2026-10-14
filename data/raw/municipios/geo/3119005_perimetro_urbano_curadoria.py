"""Cordislândia (3119005): perímetro urbano da sede para a Lei 928/2012, art. 1º (carga acima de 12 t nas ruas e avenidas da
cidade), sem a Av. Cônego Francisco e sem o resto da BR-267/MGC-267 (art. 3º: a Av. Cônego Francisco é a única via de
transposição da cidade para esses veículos).

Gera 3119005_perimetro_urbano.geojson (zona aproximada) a partir de:
  * IBGE, Malha de Setores Censitários do Censo 2022 (MG), shapefile de
    https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/MG_setores_CD2022.zip
    (a situação "urbana" do setor segue o perímetro urbano legal): setores do município 3119005, distrito "Cordislândia",
    com CD_SIT 1 ou 2 (área urbana de cidade, urbanizada ou não);
  * as vias com ref BR-267 / MGC-267 do PBF local (data/cache/municipios/osm_hw_3119005.json, formato Overpass
    "out geom tags", por data/raw/municipios/curadoria/osm_pbf_vias.py), recortadas da zona com folga de 40 m de cada lado.

  python3 data/raw/municipios/geo/3119005_perimetro_urbano_curadoria.py <dir_ou_.shp dos setores> data/cache/municipios/osm_hw_3119005.json

Requer shapely, pyproj e pyshp. Furos são preenchidos (a camada só usa o anel externo), partes com menos de 2 ha são
descartadas e o resultado é simplificado a ~5 m. Dados do OpenStreetMap (ODbL 1.0) e do IBGE.
"""
import json
import pathlib
import sys

import shapefile
from pyproj import Transformer
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import transform, unary_union

IBGE = '3119005'
DISTRITO = 'Cordislândia'
REFS_LIVRES = ['BR-267', 'MGC-267']      # ref do OSM das vias que ficam livres (a Av. Cônego Francisco é a BR-267/MGC-267 na cidade)
FOLGA_M = 40
OUT = pathlib.Path(__file__).with_name('3119005_perimetro_urbano.geojson')
T = Transformer.from_crs(4326, 31983, always_xy=True).transform
Ti = Transformer.from_crs(31983, 4326, always_xy=True).transform


def livre(t):
    return any(r.strip() in REFS_LIVRES for r in (t.get('ref') or '').split(';'))


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
           if livre(e.get('tags', {})) and len(e.get('geometry') or []) >= 2]
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
                             f'vias {", ".join(REFS_LIVRES)} recortadas com folga de {FOLGA_M} m sobre o OpenStreetMap (ODbL 1.0)',
          'features': [{'type': 'Feature', 'properties': {'descricao': 'Perímetro urbano de Cordislândia (sede), aproximado pelos setores censitários urbanos do distrito-sede (IBGE 2022), sem a BR-267/MGC-267 (Av. Cônego Francisco)', 'aproximado': True,
                                                          'setores_ibge': len(setores)}, 'geometry': geom}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT}: {len(polys)} parte(s), {len(setores)} setores, {len(rod)} ways de rodovia recortados')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
