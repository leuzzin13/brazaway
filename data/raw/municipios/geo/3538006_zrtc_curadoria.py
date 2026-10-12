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

Requer shapely, pyproj e pyshp. Furos são preenchidos (a camada só usa o anel externo; os que nascem do recorte viram fendas), partes com menos de 2 ha são
descartadas. Vértices: a zona é simplificada PARA DENTRO (encolhe e simplifica, nunca cresce) a 15 m ANTES do recorte, recortada e simplificada para dentro de novo (15 m);
a folga às vias livres não diminui (nenhuma a menos de 40 m da zona). Eram 986 vértices e agora são ~613: o limite de vértices do
exclude_polygons do Valhalla (20.000, somando todas as zonas da rota) pede zonas leves."""
import json
import pathlib
import re
import sys

import shapefile
from shapely.geometry import shape
from shapely.ops import unary_union

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'curadoria'))
import zona_rodovia_lib as L  # noqa: E402

IBGE = '3538006'
FILTRO = ['NM_DIST', ['Pindamonhangaba', 'Moreira César']]                       # (campo do setor, valores aceitos)
SITUACOES = ['1', '2']                       # CD_SIT aceitos
RODOVIAS_REF = ['BR-116', 'SP-060', 'SP-062', 'SP-132', 'BR-383']                    # ref do OSM (parcial) das rodovias que ficam livres
NOMES_LIVRES = ['Rodovia Presidente Dutra', 'Avenida Nossa Senhora do Bom Sucesso', 'Estrada Carlos Lopes Guedes Filho', 'Rua Carlos Lopes Guedes Filho', 'Rodovia Amador Bueno da Veiga', 'Estrada Sebastião Vieira Machado', 'Rua Japão', 'Avenida José Maria Guimarães Alves', 'Avenida Geraldo José Rodrigues Alckmin', 'Rodovia Doutor Caio Gomes Figueiredo', 'Rua Theodorico Cavalcante de Souza', 'Rodovia Vereador Abel Fabrício Dias', 'Rodovia Vereador Abel Fabricio Dias', 'Avenida Engenheiro Luiz Dumont Villares', 'Avenida Professor Manoel César Ribeiro', 'Avenida Independência', 'Avenida Buriti', 'Estrada Municipal do Atanázio', 'Estrada do Atanázio', 'Estrada do Atanazio', 'Avenida João Francisco da Silva', 'Estrada João Francisco da Silva', 'Avenida Gastão Vidigal Neto', 'Avenida Júlio de Paula Claro', 'Rua Jambeiro']                   # nomes exatos do OSM das vias que ficam livres
FOLGA_M = 40      # distância mínima garantida entre a zona e cada via livre
ANTES_M = 15
DEPOIS_M = 15
LINHA_M = 4
OUT = pathlib.Path(__file__).with_name('3538006_zrtc.geojson')


def livre(t):
    refs = [x.strip() for x in re.split('[;/]', t.get('ref') or '')]
    return bool(t.get('highway')) and (any(r in RODOVIAS_REF for r in refs) or t.get('name') in NOMES_LIVRES)


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
    to_utm, to_ll = L.projecoes(31983)
    Z = to_utm(unary_union([g for _, g in setores])).buffer(1).buffer(-1)
    Z = L.simplificar_para_dentro(Z, ANTES_M)      # com os furos dos setores: o recorte preenche os que não encostam nas rodovias, como antes
    rod = L.vias_por_funcao(osm, to_utm, livre)
    rod = [x for x in rod if x[2].distance(Z) < 400]
    Z, _ = L.recortar(Z, rod, FOLGA_M + LINHA_M, simplificar_depois_m=DEPOIS_M, linha_simpl_m=LINHA_M)
    dmin = L.verificar(Z, rod, FOLGA_M, 3)
    Z = to_ll(Z)
    rnd = lambda c: [[round(x, 6), round(y, 6)] for x, y in c]
    polys = [Z] if Z.geom_type == 'Polygon' else list(Z.geoms)
    geom = {'type': 'MultiPolygon', 'coordinates': [[rnd(pp.exterior.coords)] for pp in polys]}
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': f'IBGE, Malha de Setores Censitários do Censo 2022 ({len(setores)} setores, {FILTRO[0]} em {FILTRO[1]}, CD_SIT em {SITUACOES}); '
                             f'vias livres ({", ".join(RODOVIAS_REF + NOMES_LIVRES) or "nenhuma"}) recortadas com folga de {FOLGA_M} m sobre o OpenStreetMap (ODbL 1.0)',
          'features': [{'type': 'Feature', 'properties': {'regra_id': 'pinda_zrtc_vcp', 'descricao': 'ZRTC de Pindamonhangaba (perímetro urbano da sede e de Moreira César), aproximada pelos setores censitários urbanos dos dois distritos (IBGE 2022), sem a Via Dutra e sem os corredores das RLCP (vias com nome do Anexo I do Dec. 5.635/2019, inteiras) e das rodovias SP-062, SP-132 e BR-383', 'aproximado': True,
                                                          'setores_ibge': len(setores)}, 'geometry': geom}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT.name}: {len(polys)} parte(s), {sum(len(pp.exterior.coords) for pp in polys)} vértices, {len(setores)} setores, {len(rod)} ways livres recortados, menor distância a elas {dmin:.0f} m')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
