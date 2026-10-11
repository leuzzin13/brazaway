"""Pindamonhangaba (3538006): Zona de Restrição ao Tráfego de Caminhões (ZRTC = perímetro urbano da LC 3/2006) do Decreto 5.635/2019, art. 2º, I, e art. 5º, sem a Via Dutra e sem os corredores das Rotas Livres para Cargas Pesadas (RLCP, Anexo I) e das rodovias SP-062, SP-132 e BR-383.

Gera 3538006_zrtc.geojson (zona aproximada) a partir de:
  * IBGE, Malha de Setores Censitários do Censo 2022 (SP), shapefile de
    https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/SP_setores_CD2022.zip
    (a situação "urbana" do setor segue o perímetro urbano legal do município): setores do município 3538006 com
    NM_DIST "Pindamonhangaba" (sede) ou "Moreira César" e CD_SIT 1 ou 2 (área urbana de cidade ou vila);
  * o cache de vias com nome do OSM (data/cache/municipios/osm_named_3538006.json, formato Overpass "out geom tags") com
    as rodovias a deixar livres (Rod. Presidente Dutra (BR-116/SP-060), SP-062, SP-132, BR-383 e as vias com nome das RLCP do Anexo I, inteiras), recortadas da zona com folga de 40 m de cada lado (rodovia de outra
    jurisdição não é alcançada pelo ato municipal).

  python3 data/raw/municipios/geo/3538006_zrtc_curadoria.py <dir_ou_.shp dos setores> data/cache/municipios/osm_named_3538006.json

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

IBGE = '3538006'
FILTRO = ['NM_DIST', ['Pindamonhangaba', 'Moreira César']]                       # (campo do setor, valores aceitos)
SITUACOES = ['1', '2']                       # CD_SIT aceitos
RODOVIAS_REF = ['BR-116', 'SP-060', 'SP-062', 'SP-132', 'BR-383']                    # ref do OSM (parcial) das rodovias que ficam livres
NOMES_LIVRES = ['Rodovia Presidente Dutra', 'Avenida Nossa Senhora do Bom Sucesso', 'Estrada Carlos Lopes Guedes Filho', 'Rua Carlos Lopes Guedes Filho', 'Rodovia Amador Bueno da Veiga', 'Estrada Sebastião Vieira Machado', 'Rua Japão', 'Avenida José Maria Guimarães Alves', 'Avenida Geraldo José Rodrigues Alckmin', 'Rodovia Doutor Caio Gomes Figueiredo', 'Rua Theodorico Cavalcante de Souza', 'Rodovia Vereador Abel Fabrício Dias', 'Rodovia Vereador Abel Fabricio Dias', 'Avenida Engenheiro Luiz Dumont Villares', 'Avenida Professor Manoel César Ribeiro', 'Avenida Independência', 'Avenida Buriti', 'Estrada Municipal do Atanázio', 'Estrada do Atanázio', 'Estrada do Atanazio', 'Avenida João Francisco da Silva', 'Estrada João Francisco da Silva', 'Avenida Gastão Vidigal Neto', 'Avenida Júlio de Paula Claro', 'Rua Jambeiro']                   # nomes exatos do OSM das vias que ficam livres
FOLGA_M = 40
OUT = pathlib.Path(__file__).with_name('3538006_zrtc.geojson')
T = Transformer.from_crs(4326, 31983, always_xy=True).transform
Ti = Transformer.from_crs(31983, 4326, always_xy=True).transform


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
          'features': [{'type': 'Feature', 'properties': {'regra_id': 'pinda_zrtc_vcp', 'descricao': 'ZRTC de Pindamonhangaba (perímetro urbano da sede e de Moreira César), aproximada pelos setores censitários urbanos dos dois distritos (IBGE 2022), sem a Via Dutra e sem os corredores das RLCP (vias com nome do Anexo I do Dec. 5.635/2019, inteiras) e das rodovias SP-062, SP-132 e BR-383', 'aproximado': True,
                                                          'setores_ibge': len(setores)}, 'geometry': geom}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT}: {len(polys)} parte(s), {len(setores)} setores, {len(rod)} ways livres recortados')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
