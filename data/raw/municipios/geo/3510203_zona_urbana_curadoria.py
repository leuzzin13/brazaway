"""Capão Bonito (3510203): "vias da zona urbana" da Lei 3.661/2012, art. 1º (caminhões acima de 7 t de capacidade) — sem as rodovias e sem as 12 vias de acesso do parágrafo único, III-IV.

Gera 3510203_zona_urbana.geojson (zona APROXIMADA) a partir de:
  * IBGE, Malha de Setores Censitários do Censo 2022 (SP), shapefile de
    https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/SP_setores_CD2022.zip
    (a situação "urbana" do setor segue o perímetro urbano legal): setores do município 3510203, distrito "Capão Bonito"
    (sede), com CD_SIT 1 ou 2 (área urbana de cidade);
  * o extrato do OSM com TODAS as vias highway do município, tirado do PBF do Sudeste (data/cache/municipios/osm_hw_3510203.json,
    formato Overpass "out geom tags"; curadoria/osm_pbf_vias.py), de onde saem
      - as rodovias (SP-250/BR-373, SP-258, SP-127, trevos, trunk/primary sem ref e alças), com folga de 40 m de cada lado:
        o ato municipal não alcança rodovia de outra jurisdição; e
      - as 12 vias de acesso a rodovias do art. 1º, parágrafo único, III-IV (Av. Plácido Batista da Silveira, Av. Capitão
        Calixto de Almeida, Av. Lucas Nogueira Garcez, R. Altino Arantes, R. Dr. Josino de Araújo, Av. Santos Dumont, Av. Amazonas,
        Av. Massaichi Kakihara, Av. Dona Nenê, Av. João Antunes Rodrigues, Av. Elias Jorge Daniel (no OSM, 'Avenida Jorge daniel'), R. Domingos Lírio), com folga de 10 m
        (a rota ainda recua a zona 20 m para dentro).

  python3 data/raw/municipios/geo/3510203_zona_urbana_curadoria.py <dir_ou_.shp dos setores> data/cache/municipios/osm_hw_3510203.json

Requer shapely, pyproj e pyshp. Furos são preenchidos (a camada só usa o anel externo; o que seria furo vira fenda), partes com
menos de 2 ha são descartadas e o resultado é simplificado a ~5 m.
"""
import json
import pathlib
import sys

import shapefile
from shapely.geometry import shape
from shapely.ops import unary_union

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'curadoria'))
import zona_rodovia_lib as L  # noqa: E402

IBGE = '3510203'
DISTRITO = 'Capão Bonito'
SITUACOES = ('1', '2')
ACESSOS = ['Avenida Placido Batista da Silveira', 'Avenida Plácido Batista da Silveira', 'Avenida Capitão Calixto', 'Avenida Capitão Calixto de Almeida',
           'Avenida Lucas Nogueira Garcez', 'Avenida Lucas Nogueira Garcês', 'Rua Altino Arantes', 'Rua Doutor Josino', 'Rua Doutor Josino de Araújo',
           'Avenida Santos Dumont', 'Avenida Amazonas', 'Avenida Massaichi Kakihara', 'Avenida Dona Nenê', 'Avenida João Antunes Rodrigues',
           'Avenida Elias Jorge Daniel', 'Avenida Jorge daniel', 'Rua Domingos Lirio', 'Rua Domingos Lírio']
FOLGA_ACESSO_M = 10
FOLGA_MIN_M = 40
LINHA_M = 4
OUT = pathlib.Path(__file__).with_name('3510203_zona_urbana.geojson')


def main(shp, osm):
    p = pathlib.Path(shp)
    if p.is_dir():
        p = next(p.glob('*_setores_CD2022.shp'))
    r = shapefile.Reader(str(p.with_suffix('')), encoding='utf-8')
    nomes = [f[0] for f in r.fields[1:]]
    setores = []
    for sr in r.iterShapeRecords():
        rec = dict(zip(nomes, sr.record))
        if rec['CD_MUN'] == IBGE and rec['NM_DIST'] == DISTRITO and rec['CD_SIT'] in SITUACOES:
            setores.append((rec['CD_SETOR'], shape(sr.shape.__geo_interface__).buffer(0)))
    to_utm, to_ll = L.projecoes(31983)
    Z = to_utm(unary_union([g for _, g in setores])).buffer(1).buffer(-1)
    Z = L.sem_furos(Z)
    rod = L.vias_livres(osm, to_utm)
    Z, _ = L.recortar(Z, rod, FOLGA_MIN_M + LINHA_M, simplificar_depois_m=0, linha_simpl_m=LINHA_M)
    ac = L.vias_por_funcao(osm, to_utm, lambda t: t.get('name') in ACESSOS and t.get('highway') not in ('track', 'path', 'footway'))
    Z, _ = L.recortar(Z, ac, FOLGA_ACESSO_M, simplificar_depois_m=0, linha_simpl_m=LINHA_M)
    Z = Z.simplify(5)
    dmin = L.verificar(Z, rod, FOLGA_MIN_M, 6)
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': (f'IBGE, Malha de Setores Censitários do Censo 2022 ({len(setores)} setores urbanos do distrito {DISTRITO}); '
                              f'rodovias recortadas com folga mínima de {FOLGA_MIN_M} m e as 12 vias de acesso do ato com {FOLGA_ACESSO_M} m, sobre o OpenStreetMap (ODbL 1.0)'),
          'features': [{'type': 'Feature', 'properties': {
              'descricao': 'Zona urbana de Capão Bonito (sede), aproximada pelos setores censitários urbanos do distrito-sede (IBGE 2022), sem as rodovias e sem as 12 vias de acesso do art. 1º, parágrafo único, III-IV',
              'aproximado': True, 'setores_ibge': len(setores)}, 'geometry': L.para_geojson_coords(to_ll(Z))}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT.name}: {len(getattr(Z, "geoms", [Z]))} parte(s), {L.contar_vertices(Z)} vértices, {len(setores)} setores, {len(rod)} ways de rodovia, {len(ac)} de acesso, menor distância {dmin:.0f} m, área {Z.area / 1e6:.2f} km2')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
