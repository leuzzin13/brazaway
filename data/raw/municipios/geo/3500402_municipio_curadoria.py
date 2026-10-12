"""Águas da Prata (3500402): "todas as vias do Município" do Decreto 2.799/2019, art. 1º — sem as rodovias estaduais/federais.

Gera 3500402_municipio.geojson a partir de:
  * o limite municipal do IBGE (API de malhas v3, qualidade máxima; cache do importador em
    data/cache/municipios/ibge_malha_3500402.geojson);
  * um extrato do OSM (formato Overpass "out geom tags", ways de highway do município tiradas do PBF do Sudeste) com as
    rodovias a deixar livres, recortadas com folga de 40 m de cada lado: o decreto municipal não alcança rodovia de outra
    jurisdição; o art. 2º exclui expressamente a SP-342 (km 224+030 a 251+150) e a SP-215 (km 29+755 a 49+940), que no município coincidem em parte com a BR-267 (inclusive a travessia urbana da SP-342, Av. Washington Luís e Av. Cel. Ernesto de Oliveira). Ficam
    livres as ways com essas refs, toda motorway/trunk (e alças) e as alças (*_link) com ref estadual/federal. Estradas
    municipais com código (AGP-020, AGP-030, AGP-215) continuam na zona.

  python3 data/raw/municipios/geo/3500402_municipio_curadoria.py data/cache/municipios/ibge_malha_3500402.geojson <extrato_osm.json>

O recorte parte o município em pedaços (a camada usa só o anel externo de cada polígono, por isso não há furos; os que nascem do recorte viram fendas).
Vértices: o limite é simplificado PARA DENTRO (L.simplificar_para_dentro: encolhe e simplifica, nunca cresce) a 30 m ANTES do recorte,
recortado com folga e simplificado para dentro de novo (25 m); a folga às vias livres não diminui: nenhuma rodovia livre fica a menos de 40 m da zona.
Era 600 vértices com o recorte a 5 m; agora 332. O limite de vértices do exclude_polygons do Valhalla (20.000, somando todas as zonas da rota) pede zonas leves.
Requer shapely e pyproj.
"""
import json
import pathlib
import re
import sys

from shapely.geometry import shape

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'curadoria'))
import zona_rodovia_lib as L  # noqa: E402

REFS = ('SP-342', 'SP-215', 'BR-267')
FOLGA_MIN_M = 40      # distância mínima garantida entre a zona e cada via livre
ANTES_M = 30
DEPOIS_M = 25
LINHA_M = 8
OUT = pathlib.Path(__file__).with_name('3500402_municipio.geojson')


def livre(t):
    hw = t.get('highway', '')
    refs = [r.strip() for r in re.split('[;,]', t.get('ref') or '') if r.strip()]
    if any(r.split('/')[0] in REFS for r in refs):
        return True
    if hw.startswith(('motorway', 'trunk')):
        return True
    return hw.endswith('_link') and any(re.match(r'^(SP|BR|SPA|SPI)-', r) for r in refs)


def main(malha, osm):
    to_utm, to_ll = L.projecoes(31983)
    Z = L.simplificar_para_dentro(L.sem_furos(to_utm(shape(json.load(open(malha))['features'][0]['geometry'])).buffer(0)), ANTES_M)
    rod = L.vias_por_funcao(osm, to_utm, livre)
    Z, _ = L.recortar(Z, rod, FOLGA_MIN_M + LINHA_M, simplificar_depois_m=DEPOIS_M, linha_simpl_m=LINHA_M)
    dmin = L.verificar(Z, rod, FOLGA_MIN_M, 3)
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': f'IBGE, malha municipal (API v3, qualidade máxima); rodovias {", ".join(REFS)} (e motorway/trunk e alças) recortadas com folga mínima de {FOLGA_MIN_M} m sobre o OpenStreetMap (ODbL 1.0)',
          'features': [{'type': 'Feature', 'properties': {'descricao': 'Território do Município de Águas da Prata (Dec. 2.799/2019, art. 1º), sem a SP-342 e a SP-215 (art. 2º)', 'aproximado': False, 'rodovias_livres': list(REFS)},
                        'geometry': L.para_geojson_coords(to_ll(Z))}]}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT.name}: {len(getattr(Z, "geoms", [Z]))} parte(s), {L.contar_vertices(Z)} vértices, {len(rod)} ways de rodovia, menor distância a elas {dmin:.0f} m')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
