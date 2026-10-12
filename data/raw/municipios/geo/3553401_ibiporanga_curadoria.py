"""Tanabi (3553401): Bairro de Ibiporanga para a Lei 3.542/2024, art. 1º (zona aproximada).

O ato não traz mapa nem lista de vias; o perímetro urbano de Ibiporanga é o da LC 7/2009 (não lida). Aproximação:
IBGE, Malha de Setores Censitários do Censo 2022 (SP), shapefile de
https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/SP_setores_CD2022.zip
(a situação "urbana" do setor segue o perímetro urbano legal): setores do município 3553401, distrito "Ibiporanga",
com CD_SIT 1 ou 2 (área urbana de cidade ou vila). Hoje é um setor só (355340110000005), o núcleo urbano do bairro.
Não há rodovia estadual/federal dentro dele; o Anel Viário Antonio Quile Rubio (§1º), sem nome no OSM, passa por
fora (a leste), e a camada ainda recua o polígono 20 m.

  python3 data/raw/municipios/geo/3553401_ibiporanga_curadoria.py <dir_ou_.shp dos setores>

Requer shapely, pyproj e pyshp. Furos preenchidos (a camada só usa o anel externo); simplificado a ~5 m.
"""
import json
import pathlib
import sys

import shapefile
from pyproj import Transformer
from shapely.geometry import Polygon, shape
from shapely.ops import transform, unary_union

IBGE = '3553401'
DISTRITO = 'Ibiporanga'
OUT = pathlib.Path(__file__).with_name('3553401_ibiporanga.geojson')
T = Transformer.from_crs(4326, 31982, always_xy=True).transform
Ti = Transformer.from_crs(31982, 4326, always_xy=True).transform


def main(shp):
    p = pathlib.Path(shp)
    if p.is_dir():
        p = next(p.glob('*_setores_CD2022.shp'))
    r = shapefile.Reader(str(p.with_suffix('')), encoding='utf-8')
    nomes = [f[0] for f in r.fields[1:]]
    setores = []
    for i, rec in enumerate(r.iterRecords(fields=['CD_MUN'])):
        if rec['CD_MUN'] != IBGE:
            continue
        sr = r.shapeRecord(i)
        d = dict(zip(nomes, sr.record))
        if d['NM_DIST'] == DISTRITO and d['CD_SIT'] in ('1', '2'):
            setores.append((d['CD_SETOR'], shape(sr.shape.__geo_interface__).buffer(0)))
    Z = transform(T, unary_union([g for _, g in setores])).buffer(1).buffer(-1)
    partes = [Polygon(g.exterior) for g in getattr(Z, 'geoms', [Z]) if g.geom_type == 'Polygon' and g.area > 20000]
    Z = transform(Ti, unary_union(partes).simplify(5))
    polys = [Z] if Z.geom_type == 'Polygon' else list(Z.geoms)
    rnd = lambda c: [[round(x, 6), round(y, 6)] for x, y in c]
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': f'IBGE, Malha de Setores Censitários do Censo 2022 (setores urbanos do distrito {DISTRITO}: {", ".join(s for s, _ in setores)})',
          'features': [{'type': 'Feature', 'properties': {
              'descricao': 'Bairro de Ibiporanga (Tanabi), aproximado pelo setor censitário urbano do distrito de Ibiporanga (IBGE 2022)',
              'aproximado': True, 'setores_ibge': [s for s, _ in setores]},
              'geometry': {'type': 'MultiPolygon', 'coordinates': [[rnd(pp.exterior.coords)] for pp in polys]}}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT}: {len(polys)} parte(s), {len(setores)} setor(es)')


if __name__ == '__main__':
    main(sys.argv[1])
