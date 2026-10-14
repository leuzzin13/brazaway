"""Bernardino de Campos (3506300): "malha viária do município" da Lei 1.694/2011, art. 1º — sem as rodovias estaduais/federais.

Gera 3506300_municipio.geojson a partir de:
  * o limite municipal do IBGE (API de malhas v3, qualidade máxima; cache do importador em
    data/cache/municipios/ibge_malha_3506300.geojson);
  * o extrato do OSM com TODAS as vias highway do município, tirado do PBF do Sudeste (data/cache/municipios/osm_hw_3506300.json,
    formato Overpass "out geom tags"; curadoria/osm_pbf_vias.py), de onde saem as rodovias (SP-270 Raposo Tavares, SP-303),
    as travessias trunk/primary sem ref e as alças ligadas a elas, recortadas com folga de 40 m de cada lado: a lei é municipal
    e não alcança rodovia de outra jurisdição. Estradas municipais continuam na zona.

  python3 data/raw/municipios/geo/3506300_municipio_curadoria.py data/cache/municipios/ibge_malha_3506300.geojson data/cache/municipios/osm_hw_3506300.json

O recorte parte o município em pedaços (a camada usa só o anel externo; o que seria furo vira fenda). O limite é
simplificado PARA DENTRO antes e depois do recorte (a folga mínima às rodovias fica em 40 m). Requer shapely e pyproj.
"""
import json
import pathlib
import sys

from shapely.geometry import shape

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'curadoria'))
import zona_rodovia_lib as L  # noqa: E402

FOLGA_MIN_M = 40
ANTES_M = 30
DEPOIS_M = 25
LINHA_M = 8
OUT = pathlib.Path(__file__).with_name('3506300_municipio.geojson')


def main(malha, osm):
    to_utm, to_ll = L.projecoes(31983)
    Z = L.simplificar_para_dentro(L.sem_furos(to_utm(shape(json.load(open(malha))['features'][0]['geometry'])).buffer(0)), ANTES_M)
    rod = L.vias_livres(osm, to_utm)
    Z, _ = L.recortar(Z, rod, FOLGA_MIN_M + LINHA_M, simplificar_depois_m=DEPOIS_M, linha_simpl_m=LINHA_M)
    dmin = L.verificar(Z, rod, FOLGA_MIN_M, 3)
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': f'IBGE, malha municipal (API v3, qualidade máxima); rodovias estaduais/federais (ref de rodovia, trunk/primary sem ref e alças) recortadas com folga mínima de {FOLGA_MIN_M} m sobre o OpenStreetMap (ODbL 1.0)',
          'features': [{'type': 'Feature', 'properties': {'descricao': 'Malha viária do Município de Bernardino de Campos (Lei 1.694/2011, art. 1º), sem as rodovias estaduais/federais', 'aproximado': False},
                        'geometry': L.para_geojson_coords(to_ll(Z))}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT.name}: {len(getattr(Z, "geoms", [Z]))} parte(s), {L.contar_vertices(Z)} vértices, {len(rod)} ways de rodovia, menor distância a elas {dmin:.0f} m')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
