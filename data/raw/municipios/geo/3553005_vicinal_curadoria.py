"""Taguaí (3553005): Estrada Vicinal Clóvis Rodrigues da Fonseca (TGI-010, de Taguaí à divisa com Tejupá), Lei 1.282/2025.

A via NÃO tem nome nem ref no OSM (no PBF do Sudeste não há way com name "Clóvis Rodrigues da Fonseca" nem ref "TGI-010";
a única ref TGI da região é a TGI-030, Estrada Municipal Antônio Soldeira). A cadeia foi identificada pela rota do
Valhalla entre as sedes de Taguaí e de Tejupá, a única ligação secondary pavimentada entre as duas (sem alternativa na
consulta com `alternates`): ways 207732644, 1319026217, 992445880, 207658317, 207730737, 1319026238, 207658318 e
207657698. Dentro do limite de Taguaí fica só a way 207732644 (~7 km, de ~(-23,4475; -49,4089) até o limite com Tejupá em
~(-23,4023; -49,3873)); o resto da cadeia já é Tejupá. Geometria APROXIMADA, a confirmar.

Gera 3553005_taguai.geojson a partir de:
  * a polilinha da rota do Valhalla (costing auto) de Taguaí (-23.4686, -49.4094) a Tejupá (-23.3425, -49.3753), salva em
    data/cache/municipios/taguai_tejupa_rota_valhalla.json ({"pontos": [[lon, lat], ...]}), cortada a partir do início
    da way 207732644 (saída da área urbana de Taguaí, onde começa a estrada secondary); o trecho urbano anterior
    (Estrada Municipal Antônio Soldeira, TGI-030, e ruas) não é a vicinal;
  * o limite municipal do IBGE (cache do importador, data/cache/municipios/ibge_malha_3553005.geojson): a linha é cortada
    no limite de Taguaí (a lei só vale na jurisdição do município; a Lei 753/2002 fixa o fim na divisa com Tejupá).

  python3 data/raw/municipios/geo/3553005_vicinal_curadoria.py <rota_valhalla.json> <ibge_malha_3553005.geojson>

Requer shapely e pyproj.
"""
import json
import pathlib
import sys

from pyproj import Transformer
from shapely.geometry import LineString, Point, shape
from shapely.ops import transform

INICIO = (-49.4088529, -23.4474556)   # início da way 207732644 (lon, lat), no lado de Taguaí
OUT = pathlib.Path(__file__).with_name('3553005_taguai.geojson')
T = Transformer.from_crs(4326, 31982, always_xy=True).transform
Ti = Transformer.from_crs(31982, 4326, always_xy=True).transform
VIA = 'Estrada Vicinal Clóvis Rodrigues da Fonseca (TGI-010, Taguaí–divisa com Tejupá)'


def main(rota, malha):
    lim = transform(T, shape(json.load(open(malha))['features'][0]['geometry']))
    pts = json.load(open(rota))['pontos']
    i0 = min(range(len(pts)), key=lambda i: (pts[i][0] - INICIO[0]) ** 2 + (pts[i][1] - INICIO[1]) ** 2)
    L = transform(T, LineString(pts[i0:])).intersection(lim)
    feats = []
    for g in [g for g in getattr(L, 'geoms', [L]) if g.geom_type == 'LineString' and g.length >= 10]:
        c = transform(Ti, g)
        feats.append({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7), round(y, 7)] for x, y in c.coords]},
                      'properties': {'regra_id': 'taguai_vicinal_clovis_fonseca_30t', 'inciso': 'art. 1º', 'via': VIA,
                                     'trecho': 'Estrada Vicinal TGI-010 em toda a extensão no município, de Taguaí à divisa com Tejupá (Lei 753/2002, art. 1º)',
                                     'aproximado': True, 'osm_way_id': 207732644, 'nome_osm': None,
                                     'mao_unica': False, 'sentido': 'ambos', 'comprimento_m': round(g.length)}})
    fc = {'type': 'FeatureCollection', 'pendencias': ['A via não tem nome nem ref no OSM: a way 207732644 é inferida pela rota Taguaí–Tejupá e deve ser confirmada no local'],
          'fonte_geometria': 'OpenStreetMap (ODbL 1.0) via rota do Valhalla entre Taguaí e Tejupá (way 207732644, secondary sem nome nem ref), cortada no limite municipal do IBGE',
          'features': feats}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(OUT, len(feats), [f['properties']['comprimento_m'] for f in feats], round(sum(f['properties']['comprimento_m'] for f in feats) / 1000, 1), 'km')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
