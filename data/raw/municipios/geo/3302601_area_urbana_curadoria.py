"""Mangaratiba (3302601): área urbana para a Lei 999/2016, art. 3º (veículos de carga acima de 6,30 m só circulam na área urbana das 7h às 9h e das 18h às 20h), SEM a travessia da BR-101 (Rio-Santos) e das RJ.

Gera 3302601_area_urbana.geojson (zona aproximada) a partir de:
  * IBGE, Malha de Setores Censitários do Censo 2022 (RJ), shapefile de
    https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/RJ_setores_CD2022.zip
    (a situação "urbana" do setor segue o perímetro urbano legal do município): setores do município 3302601 com CD_SIT
    1, 2 ou 3;
  * TODAS as vias do OpenStreetMap do retângulo do município (data/cache/municipios/osm_hw_3302601.json, gerado do PBF
    do Valhalla por data/raw/municipios/curadoria/osm_pbf_vias.py: com e sem nome, com e sem ref). Ficam livres e
    saem da zona, com folga de 55 m de cada lado (a API ainda recua a zona 20 m): a BR-101 inteira (todas as pistas,
    alças e ligações, com ou sem ref no OSM), as RJ (ref RJ-) e toda via trunk/primary sem ref (os trechos da travessia: as
    alças que ligam a BR-101 à Estrada São João Marcos, ela própria, a Rua Arthur Pires e acessos), como em Arcos e Santa
    Branca. O ato municipal não alcança a rodovia federal.

  python3 data/raw/municipios/geo/3302601_area_urbana_curadoria.py <dir_ou_.shp dos setores RJ> data/cache/municipios/osm_hw_3302601.json

Vértices: a zona é simplificada PARA DENTRO (L.simplificar_para_dentro: encolhe e simplifica, nunca cresce) a 35 m ANTES do recorte,
recortada e simplificada para dentro de novo a 20 m; o contorno recua 0 a 40 m e a folga às vias livres não diminui (era 3.137 vértices; fica ~775).
O anel externo resultante é conferido (nenhuma via livre a menos de 50 m). Requer shapely, pyproj e pyshp.
"""
import json
import pathlib
import sys

import shapefile
from shapely.geometry import Polygon, shape
from shapely.ops import unary_union

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'curadoria'))
import zona_rodovia_lib as L  # noqa: E402

IBGE = '3302601'
SITUACOES = ['1', '2', '3']
REFS = None                       # qualquer ref de rodovia (BR-101, RJ-014, RJ-149...)
IDS = []                          # ways sem ref da travessia, por id do OSM (preenchido abaixo)
FOLGA_M = 55
SIMPLIFICAR_M = 35
DEPOIS_M = 20
MIN_M2 = 100000                   # partes com menos de 0,1 km² (fragmentos entre rodovias) são descartadas
OUT = pathlib.Path(__file__).with_name('3302601_area_urbana.geojson')


def main(shp, osm):
    p = pathlib.Path(shp)
    if p.is_dir():
        p = next(p.glob('*_setores_CD2022.shp'))
    r = shapefile.Reader(str(p.with_suffix('')), encoding='utf-8')
    nomes = [f[0] for f in r.fields[1:]]
    setores = []
    for sr in r.iterShapeRecords():
        rec = dict(zip(nomes, sr.record))
        if rec['CD_MUN'] == IBGE and rec['CD_SIT'] in SITUACOES:
            setores.append(shape(sr.shape.__geo_interface__).buffer(0))
    to_utm, to_ll = L.projecoes(31983)
    Z = to_utm(unary_union(setores)).buffer(1).buffer(-1)
    Z = L.simplificar_para_dentro(Z, SIMPLIFICAR_M)
    livres = L.vias_livres(osm, to_utm, refs=REFS, ids=IDS)
    livres = [x for x in livres if x[2].distance(Z) < 400]
    Z, _ = L.recortar(Z, livres, FOLGA_M, min_area_m2=MIN_M2, simplificar_depois_m=DEPOIS_M)
    dmin = L.verificar(Z, livres, FOLGA_M, L.LINHA_SIMPL_M + 1)
    Zll = to_ll(Z)
    geom = L.para_geojson_coords(Zll)
    fc = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {
        'nome': 'Área urbana de Mangaratiba (aproximada: setores censitários urbanos do IBGE 2022, sem a BR-101 inteira e as RJ)',
        'fonte': f'IBGE, setores censitários do Censo 2022 (situação urbana) menos a travessia da BR-101 e das RJ (folga de {FOLGA_M} m) do OSM (ODbL), PBF local',
        'aproximado': True}, 'geometry': geom}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT.name}: {len(Z.geoms) if hasattr(Z, "geoms") else 1} parte(s), {L.contar_vertices(Z)} vértices, '
          f'{len(setores)} setores, {len(livres)} vias livres, menor distância a elas {dmin:.0f} m, {Z.area / 1e6:.2f} km²')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
