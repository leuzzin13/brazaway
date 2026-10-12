"""Campos dos Goytacazes (3301009): vias sob circunscrição do Município para a Portaria IMTT 21/2025 (mais de 4 eixos), ou seja, o limite municipal SEM as rodovias federais e estaduais.

Gera 3301009_vias_municipais.geojson (uma feição MultiPolygon, sem furos) a partir de:
  * o limite municipal do IBGE (API de malhas v3, qualidade máxima; cache do importador em
    data/cache/municipios/ibge_malha_3301009.geojson);
  * TODAS as vias do OpenStreetMap do retângulo do município (data/cache/municipios/osm_hw_3301009.json, do PBF do
    Valhalla por data/raw/municipios/curadoria/osm_pbf_vias.py). Ficam livres: ways com ref BR-/RJ-, com
    IBGE:CD_ADMINIS federal ou estadual (ex.: Av. Alberto Lamego), toda motorway/trunk e as alças e rotatórias ligadas a elas.

  python3 data/raw/municipios/geo/3301009_vias_municipais_curadoria.py data/cache/municipios/ibge_malha_3301009.geojson data/cache/municipios/osm_hw_3301009.json

Vértices: a versão anterior (limite simplificado a ~50 m, recortado com 30 m de cada lado e simplificado a 5 m) tinha 10.902
vértices em 47 partes e, somada às demais zonas, estourava o limite de 20.000 vértices do exclude_polygons do Valhalla em
rotas longas. Agora o recorte tem duas resoluções (zona_rodovia_lib.recortar_dois_niveis), sempre simplificando PARA DENTRO
(a zona nunca cresce para fora do limite municipal nem para cima das vias): na cidade (raio de 4,5 km do centro) 15 m antes do
recorte e 25 m depois; no resto do município 150 m antes e 400 m depois, sem as partes com menos de 5 km². Nenhuma via
livre fica a menos de 35 m da zona (a camada ainda recua a zona 20 m: a rodovia fica com 55 m livres, no mínimo, de cada lado).
Resultado: ~810 vértices em 45 partes e ~19% menos área que a versão de 10.902 vértices (a perda é quase toda rural).
Requer shapely e pyproj.
"""
import json
import pathlib
import sys

from shapely.geometry import Point, shape
from shapely.ops import unary_union

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'curadoria'))
import zona_rodovia_lib as L  # noqa: E402

CLASSES = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
           'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'}
CENTRO = (-41.3244, -21.7545)      # lon, lat: centro de Campos dos Goytacazes
RAIO_NUCLEO_M = 4500               # cidade: recorte fino
# folga = 35 m garantidos + simplificar_depois + linha_simpl (a camada ainda recua a zona 20 m)
FINO = dict(antes_m=15, folga_m=35 + 8, min_area_m2=20000, simplificar_depois_m=25, linha_simpl_m=8)
GROSSO = dict(antes_m=150, folga_m=35 + 30, min_area_m2=5_000_000, simplificar_depois_m=400, linha_simpl_m=30)
OUT = pathlib.Path(__file__).with_name('3301009_vias_municipais.geojson')


def main(malha, osm):
    d = json.load(open(malha))
    f = d['features'][0] if 'features' in d else d
    to_utm, to_ll = L.projecoes(31984)
    Z = L.sem_furos(to_utm(shape(f['geometry'])).buffer(0))
    n0 = L.contar_vertices(Z)
    livres = L.vias_livres(osm, to_utm, refs=None, sem_ref=set(), classes_ref=CLASSES, admin={'federal', 'estadual'})
    livres = [x for x in livres if x[1]['highway'] not in ('construction', 'proposed')]
    nucleo = to_utm(Point(*CENTRO)).buffer(RAIO_NUCLEO_M, quad_segs=8)
    Z = L.recortar_dois_niveis(Z, livres, nucleo, FINO, GROSSO)
    dmin = L.verificar(Z, livres, 35, 3)
    fc = {'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'properties': {
        'nome': 'Vias sob circunscrição do Município de Campos dos Goytacazes (limite municipal sem as faixas das rodovias federais e estaduais)',
        'fonte': 'IBGE (limite municipal) menos as rodovias BR/RJ, federais/estaduais e motorway/trunk do OSM (ODbL), PBF local, com folga mínima de 35 m (cidade, raio de 4,5 km) e de 35 m em recorte grosso fora dela; simplificado',
        'aproximado': True}, 'geometry': L.para_geojson_coords(to_ll(Z))}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT.name}: {len(getattr(Z, "geoms", [Z]))} parte(s), {L.contar_vertices(Z)} vértices (limite IBGE: {n0}), '
          f'{len(livres)} vias livres, menor distância a elas {dmin:.0f} m, {Z.area / 1e6:.0f} km²')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
