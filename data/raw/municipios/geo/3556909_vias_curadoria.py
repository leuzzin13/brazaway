"""Vista Alegre do Alto (3556909): trechos do art. 2º da Lei 1.577/2009 recortados das ways do OSM entre as transversais.

Gera 3556909_vias.geojson a partir do cache de vias com nome do OSM (data/cache/municipios/osm_named_3556909.json,
formato Overpass "out geom tags", tirado do PBF do Sudeste). Cada rua do art. 2º é uma way só no OSM, e o encadeamento
por transversal do importador (construir: trechos com de/ate) falha nesse caso; por isso o recorte é feito aqui, entre
os pontos de cruzamento com as transversais citadas no ato.

  python3 data/raw/municipios/geo/3556909_vias_curadoria.py data/cache/municipios/osm_named_3556909.json

Requer shapely.
"""
import json
import pathlib
import sys

from shapely.geometry import LineString, Point
from shapely.ops import substring

OUT = pathlib.Path(__file__).with_name('3556909_vias.geojson')
REGRA = 'vista_alegre_do_alto_vias_centrais_pesados'
# (inciso, nome no OSM, nome no ato, ponto "de", ponto "até" (lon, lat: cruzamentos no OSM), descrição, aproximado, nota)
TRECHOS = [
    ('art. 2º, 1º (bis)', 'Rua João Ricardo de Mello', 'R. João Ricardo de Mello', (-48.630658, -21.175353), (-48.63228, -21.17182),
     'R. João Ricardo de Mello, da Av. Milton Hitosi Yekashi até a ponta norte', True,
     "O ato diz 'entre a Av. Milton Hitosi Yekashi e a R. Inocêncio de Paula Eduardo', mas no OSM as duas ruas são paralelas e não se "
     'cruzam: aplicada da Av. Milton até a ponta norte da rua (a ~30 m da R. Dr. Luiz Zacharias de Lima).'),
    ('art. 2º, 2º', 'Avenida Dezoito de Fevereiro', 'Av. 18 de Fevereiro', (-48.630135, -21.175135), (-48.6319, -21.171345),
     'Av. 18 de Fevereiro, da Av. Milton Hitosi Yekashi à Av. Dr. Luiz Zacharias de Lima', False, None),
    ('art. 2º, 3º', 'Rua Manoel Marques', 'R. Manoel Marques', (-48.629603, -21.174919), (-48.63133, -21.171125),
     'R. Manoel Marques, da Av. Milton Hitosi Yekashi à Av. Dr. Luiz Zacharias de Lima', False, None),
    ('art. 2º, 4º', 'Rua Herculino do Livramento', 'R. Herculano do Livramento', (-48.628662, -21.17455), (-48.630409, -21.170758),
     'R. Herculano do Livramento (no OSM, Herculino), da Av. Milton Hitosi Yekashi à Av. Dr. Luiz Zacharias de Lima', False, None),
    ('art. 2º, 5º', 'Rua Jeremias de Paula Eduardo', 'R. Jeremias de Paulo Eduardo', (-48.628286, -21.172972), (-48.629531, -21.170395),
     'R. Jeremias de Paulo Eduardo (no OSM, de Paula), da Av. Santos Dumont à Av. Dr. Luiz Zacharias de Lima', False, None),
]


def main(osm):
    els = json.load(open(osm))['elements']
    feats = []
    for inciso, nome, nome_ato, de, ate, desc, aprox, nota in TRECHOS:
        ws = [e for e in els if e.get('tags', {}).get('name') == nome and len(e.get('geometry') or []) >= 2]
        assert len(ws) >= 1, nome
        # a way que passa mais perto dos dois pontos
        w = min(ws, key=lambda e: LineString([(p['lon'], p['lat']) for p in e['geometry']]).distance(Point(de))
                + LineString([(p['lon'], p['lat']) for p in e['geometry']]).distance(Point(ate)))
        L = LineString([(p['lon'], p['lat']) for p in w['geometry']])
        a, b = sorted((L.project(Point(de)), L.project(Point(ate))))
        s = substring(L, a, b)
        props = {'regra_id': REGRA, 'inciso': inciso, 'via': nome_ato, 'nome_osm': nome, 'osm_way_id': w['id'],
                 'fonte_trecho': desc, 'aproximado': aprox, 'sentido': 'ambos', 'mao_unica': w['tags'].get('oneway') == 'yes'}
        if nota:
            props['nota'] = nota
        feats.append({'type': 'Feature', 'properties': props,
                      'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7), round(y, 7)] for x, y in s.coords]}})
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': 'OpenStreetMap (ODbL 1.0, © colaboradores do OSM): ways recortadas entre os cruzamentos com as transversais do art. 2º da Lei 1.577/2009',
          'features': feats}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, indent=1))
    print(f'{OUT}: {len(feats)} trechos')


if __name__ == '__main__':
    main(sys.argv[1])
