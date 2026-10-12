"""São Bento do Sapucaí (3548609): macrozona urbana do Plano Diretor para a Lei 2.108/2019, art. 1º (red. LC 2.128/2020): PBT acima de 29 t ou comprimento acima de 17 m proibidos em qualquer dia ou hora. O ato não traz mapa: aproximada pela área urbana do Censo 2022.

Gera 3548609_macrozona_urbana.geojson (zona aproximada) a partir de:
  * IBGE, Malha de Setores Censitários do Censo 2022 (SP), shapefile de
    https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/SP_setores_CD2022.zip
    (a situação "urbana" do setor segue o perímetro urbano legal do município): setores do município 3548609 com
    NM_DIST em ["São Bento do Sapucaí"] e CD_SIT em ["1", "2"] (área urbana);
  * as vias do OpenStreetMap no retângulo do município (formato Overpass "out geom tags": {"elements": [{"type": "way",
    "tags": ..., "geometry": [{"lon", "lat"}, ...]}]}), extraídas do PBF do Sudeste usado pelo Valhalla
    (data/valhalla/sudeste-latest.osm.pbf; ways com a tag highway que tocam o retângulo do limite IBGE + 0,01°);
    o cache data/cache/municipios/osm_named_3548609.json (só vias com nome) também serve, mas perde trechos de
    rodovia sem nome. As rodovias de outra jurisdição (ref ["SP-042", "SP-050", "SP-123", "SPA-162", "MG-173", "BR-383"] em trunk/primary/secondary/tertiary/unclassified e seus
    ramos, os trechos da travessia sem ref listados em NOMES_LIVRES e os ramos trunk/primary sem ref) são recortadas da zona com folga de 40 m de cada lado: o ato
    municipal não alcança a travessia da rodovia.

  python3 data/raw/municipios/geo/3548609_macrozona_urbana_curadoria.py <dir_ou_.shp dos setores> <vias OSM do município, formato Overpass>

Requer shapely, pyproj e pyshp. Furos são preenchidos (a camada só usa o anel externo), partes com menos de
2 ha são descartadas e o resultado é simplificado a ~5 m.
"""
import json
import pathlib
import re
import sys

import shapefile
from pyproj import Transformer
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import transform, unary_union

IBGE = '3548609'
FILTRO = ['NM_DIST', ["São Bento do Sapucaí"]]
SITUACOES = ["1", "2"]
RODOVIAS_REF = ["SP-042", "SP-050", "SP-123", "SPA-162", "MG-173", "BR-383"]
CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'unclassified']
NOMES_LIVRES = []                   # nomes exatos do OSM de trechos da travessia sem ref
RAMOS_SEM_REF = ['motorway_link', 'trunk_link', 'primary_link']
FOLGA_M = 40
MIN_M2 = 20000
REGRA = 'saobento_sapucai_macrozona_29t'
DESCRICAO = 'Macrozona urbana de São Bento do Sapucaí, aproximada pelos setores censitários urbanos do distrito-sede (IBGE 2022), sem as rodovias SP-042 e SP-050'
OUT = pathlib.Path(__file__).with_name('3548609_macrozona_urbana.geojson')
T = Transformer.from_crs(4326, 31983, always_xy=True).transform
Ti = Transformer.from_crs(31983, 4326, always_xy=True).transform


def livre(t):
    hw = t.get('highway')
    refs = [x.strip() for x in re.split('[;/]', t.get('ref') or '') if x.strip()]
    if hw in CLASSES and any(r in RODOVIAS_REF for r in refs):
        return True
    if t.get('name') in NOMES_LIVRES and hw in CLASSES:
        return True
    return hw in RAMOS_SEM_REF and not refs and not t.get('name')


def main(shp, osm):
    p = pathlib.Path(shp)
    if p.is_dir():
        p = next(p.glob('*_setores_CD2022.shp'))
    r = shapefile.Reader(str(p.with_suffix('')), encoding='utf-8')
    nomes = [f[0] for f in r.fields[1:]]
    setores = []
    for sr in r.iterShapeRecords():
        rec = dict(zip(nomes, sr.record))
        if rec['CD_MUN'] == IBGE and rec[FILTRO[0]] in FILTRO[1] and rec['CD_SIT'] in SITUACOES:
            setores.append((rec['CD_SETOR'], shape(sr.shape.__geo_interface__).buffer(0)))
    Z = transform(T, unary_union([g for _, g in setores])).buffer(1).buffer(-1)
    els = json.load(open(osm))['elements']
    rod = [transform(T, LineString([(q['lon'], q['lat']) for q in e['geometry']])) for e in els
           if livre(e.get('tags', {})) and len(e.get('geometry') or []) >= 2]
    rod = [L for L in rod if L.distance(Z) < 200]
    if rod:
        Z = Z.difference(unary_union(rod).buffer(FOLGA_M))
    partes = [Polygon(g.exterior) for g in getattr(Z, 'geoms', [Z]) if g.geom_type == 'Polygon' and g.area > MIN_M2]
    Z = unary_union(partes).simplify(5)
    Z = transform(Ti, Z)
    rnd = lambda c: [[round(x, 6), round(y, 6)] for x, y in c]
    polys = [Z] if Z.geom_type == 'Polygon' else list(Z.geoms)
    geom = {'type': 'MultiPolygon', 'coordinates': [[rnd(pp.exterior.coords)] for pp in polys]}
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': f'IBGE, Malha de Setores Censitários do Censo 2022 ({len(setores)} setores, {FILTRO[0]} em {FILTRO[1]}, CD_SIT em {SITUACOES}); '
                             f'rodovias livres (ref {", ".join(RODOVIAS_REF)}; {", ".join(NOMES_LIVRES) or "nenhum nome"}; ramos sem ref) recortadas com folga de {FOLGA_M} m sobre o OpenStreetMap (ODbL 1.0)',
          'features': [{'type': 'Feature', 'properties': {'regra_id': REGRA, 'descricao': DESCRICAO, 'aproximado': True,
                                                          'setores_ibge': len(setores)}, 'geometry': geom}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT}: {len(polys)} parte(s), {len(setores)} setores, {len(rod)} ways livres recortados, '
          f'{sum(transform(T, pp).area for pp in polys) / 1e6:.2f} km²')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
