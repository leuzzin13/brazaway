"""Olímpia (3533908): perímetro urbano da sede para o Decreto 9.709/2025, art. 1º (Lei 5.168/2025): articulados e grande porte só das 0h às 5h, sem as rodovias e estradas de acesso (SP-425, SP-322, SPA-137/425, SPA-442/322, OLP-020, OLP-040, OLP-050, Rod. Vicinal Álvaro Marreta Cassiano Ayusso, Estrada Municipal Diógenes Breda Filho e Rod. César Galib Tannuri).

Gera 3533908_perimetro_urbano.geojson (zona aproximada) a partir de:
  * IBGE, Malha de Setores Censitários do Censo 2022 (SP), shapefile de
    https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/SP_setores_CD2022.zip
    (a situação "urbana" do setor segue o perímetro urbano legal do município): setores do município 3533908 com
    NM_DIST "Olímpia" (sede) e CD_SIT 1 ou 2 (área urbana de cidade);
  * o cache de vias com nome do OSM (data/cache/municipios/osm_named_3533908.json, formato Overpass "out geom tags") com
    as rodovias a deixar livres (SP-425, SP-322, SPA-137/425, SPA-442/322, OLP-020, OLP-040, OLP-050, Rod. Vicinal Álvaro Marreta Cassiano Ayusso, Estrada Municipal Diógenes Breda Filho e Rod. César Galib Tannuri; várias são as rotas alternativas do Anexo I do Decreto 9.709/2025), recortadas da zona com folga de 40 m de cada lado (rodovia de outra
    jurisdição não é alcançada pelo ato municipal).

  python3 data/raw/municipios/geo/3533908_perimetro_urbano_curadoria.py <dir_ou_.shp dos setores> data/cache/municipios/osm_named_3533908.json

Requer shapely, pyproj e pyshp. Furos são preenchidos (a camada só usa o anel externo), partes com menos de 2 ha são
descartadas e o resultado é simplificado a ~5 m.
"""
import json
import pathlib
import re
import sys

import shapefile
from pyproj import Transformer
from shapely.geometry import LineString, Polygon, shape
from shapely.ops import transform, unary_union

IBGE = '3533908'
FILTRO = ['NM_DIST', ['Olímpia']]                       # (campo do setor, valores aceitos)
SITUACOES = ['1', '2']                       # CD_SIT aceitos
RODOVIAS_REF = ['SP-425', 'SP-322', 'SPA-137', 'SPA-442', 'OLP-020', 'OLP-040', 'OLP-050']                    # ref do OSM (parcial) das rodovias que ficam livres
NOMES_LIVRES = ['Rodovia Vicinal Álvaro Marreta Cassiano Ayusso', 'Estrada Mununicipal Diógenes Breda Filho', 'Rodovia César Galib Tannuri']                   # nomes exatos do OSM das vias que ficam livres
FOLGA_M = 40
OUT = pathlib.Path(__file__).with_name('3533908_perimetro_urbano.geojson')
T = Transformer.from_crs(4326, 31982, always_xy=True).transform
Ti = Transformer.from_crs(31982, 4326, always_xy=True).transform


def livre(t):
    refs = [x.strip() for x in re.split('[;/]', t.get('ref') or '')]
    return any(r in RODOVIAS_REF for r in refs) or t.get('name') in NOMES_LIVRES


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
           if livre(e.get('tags', {})) and e['tags'].get('highway') and len(e.get('geometry') or []) >= 2]
    if rod:
        Z = Z.difference(unary_union(rod).buffer(FOLGA_M))
    partes = [Polygon(g.exterior) for g in getattr(Z, 'geoms', [Z]) if g.geom_type == 'Polygon' and g.area > 20000]
    Z = unary_union(partes).simplify(5)
    Z = transform(Ti, Z)
    rnd = lambda c: [[round(x, 6), round(y, 6)] for x, y in c]
    polys = [Z] if Z.geom_type == 'Polygon' else list(Z.geoms)
    geom = {'type': 'MultiPolygon', 'coordinates': [[rnd(pp.exterior.coords)] for pp in polys]}
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': f'IBGE, Malha de Setores Censitários do Censo 2022 ({len(setores)} setores, {FILTRO[0]} em {FILTRO[1]}, CD_SIT em {SITUACOES}); '
                             f'vias livres ({", ".join(RODOVIAS_REF + NOMES_LIVRES) or "nenhuma"}) recortadas com folga de {FOLGA_M} m sobre o OpenStreetMap (ODbL 1.0)',
          'features': [{'type': 'Feature', 'properties': {'regra_id': 'olimpia_dec9709_perimetro_urbano', 'descricao': 'Perímetro urbano da sede de Olímpia, aproximado pelos setores censitários urbanos do distrito-sede (IBGE 2022), sem as rodovias e estradas de acesso', 'aproximado': True,
                                                          'setores_ibge': len(setores)}, 'geometry': geom}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT}: {len(polys)} parte(s), {len(setores)} setores, {len(rod)} ways livres recortados')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
