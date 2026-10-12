"""Garça (3516705): perímetro urbano da sede para a Lei 5.558/2023, art. 39 (Zona de Restrição à Circulação de Caminhões) — sem a travessia das rodovias SP-294 e SP-349.

Gera 3516705_perimetro_urbano.geojson (zona aproximada) a partir de:
  * IBGE, Malha de Setores Censitários do Censo 2022 (SP), shapefile de
    https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/SP_setores_CD2022.zip
    (a situação "urbana" do setor segue o perímetro urbano legal do município): setores do município 3516705, distrito
    "Garça", com CD_SIT 1 ou 2 (área urbana de cidade, urbanizada ou não);
  * TODAS as vias do OpenStreetMap do retângulo do município (data/cache/municipios/osm_hw_3516705.json, gerado do PBF do
    Valhalla por data/raw/municipios/curadoria/osm_pbf_vias.py: com e sem nome, com e sem ref). Ficam livres e saem da
    zona, com folga de 40 m de cada lado (a API ainda recua a zona 20 m): a SP-349 e a SP-294 INTEIRAS, inclusive as ruas e
    avenidas urbanas por onde passam (Av. Presidente Vargas, R. Cel. Joaquim Piza, Av. Dr. Labieno da Costa Machado,
    R. Rio Grande do Sul), as vias trunk/primary sem ref e as ligações e rotatórias que tocam essas vias. Decisão de
    12/10/2026 (mesmo critério de Arcos e Santa Branca): não há contorno da cidade, a lei municipal não alcança a rodovia
    estadual e, com a travessia na zona, a passagem dava 113 km em vez de 28.

  python3 data/raw/municipios/geo/3516705_perimetro_urbano_curadoria.py <dir_ou_.shp dos setores> data/cache/municipios/osm_hw_3516705.json

Requer shapely, pyproj e pyshp. Furos são preenchidos (a camada só usa o anel externo; os que nascem do recorte viram fendas),
partes com menos de 2 ha são descartadas e a zona é simplificada para dentro (nunca cresce) a 5 m ANTES do recorte.
"""
import json
import pathlib
import sys

import shapefile
from shapely.geometry import shape
from shapely.ops import unary_union

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'curadoria'))
import zona_rodovia_lib as L  # noqa: E402

IBGE = '3516705'
DISTRITO = 'Garça'
RODOVIAS_REF = ['SP-294', 'SP-349']      # ref do OSM das rodovias que ficam livres, em qualquer nome (ruas urbanas incluídas)
NOMES_LIVRES = []    # vias sem ref no OSM que também são da travessia, pelo nome exato (trunk/primary sem ref já entram)
FOLGA_M = 40
SIMPLIFICAR_M = 5
OUT = pathlib.Path(__file__).with_name('3516705_perimetro_urbano.geojson')


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
            setores.append(shape(sr.shape.__geo_interface__).buffer(0))
    to_utm, to_ll = L.projecoes(31982)
    Z = to_utm(unary_union(setores)).buffer(1).buffer(-1)
    Z = L.simplificar_para_dentro(L.sem_furos(Z), SIMPLIFICAR_M)      # simplifica ANTES de recortar a travessia
    livres = [x for x in L.vias_livres(osm, to_utm, refs=RODOVIAS_REF, nomes=NOMES_LIVRES) if x[2].distance(Z) < 400]
    Z, _ = L.recortar(Z, livres, FOLGA_M)
    dmin = L.verificar(Z, livres, FOLGA_M)
    geom = L.para_geojson_coords(to_ll(Z))
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': f'IBGE, Malha de Setores Censitários do Censo 2022 ({len(setores)} setores urbanos do distrito {DISTRITO}); '
                             f'travessia das rodovias {", ".join(RODOVIAS_REF)} (inclusive as ruas urbanas por onde passam, vias trunk/primary sem ref e ligações) '
                             f'recortada com folga de {FOLGA_M} m sobre o OpenStreetMap (ODbL 1.0)',
          'features': [{'type': 'Feature', 'properties': {'descricao': 'Perímetro urbano de Garça (sede), aproximado pelos setores censitários urbanos do distrito-sede (IBGE 2022), sem a travessia da SP-294 e da SP-349 (rodovias e as ruas urbanas por onde passam, livres)', 'aproximado': True,
                                                          'setores_ibge': len(setores)}, 'geometry': geom}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT.name}: {len(getattr(Z, "geoms", [Z]))} parte(s), {L.contar_vertices(Z)} vértices, {len(setores)} setores, '
          f'{len(livres)} vias livres recortadas, menor distância a elas {dmin:.0f} m, {Z.area / 1e6:.2f} km²')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
