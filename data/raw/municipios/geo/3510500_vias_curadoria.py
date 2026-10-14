"""Caraguatatuba (3510500): as cinco vias da região central da Lei 1.643/2009, art. 1º, recortadas das ways do OSM.

Gera 3510500_vias.geojson a partir do cache de vias do OSM (data/cache/municipios/osm_named_3510500.json, formato Overpass
"out geom tags", tirado do PBF do Sudeste). As ruas são ways de uma linha só no OSM (o encadeamento por transversal do
importador falha nesse caso), então o recorte entre os cruzamentos citados no ato é feito aqui. Os ids das ways foram
escolhidos olhando o mapa; os cruzamentos são calculados.

  python3 data/raw/municipios/geo/3510500_vias_curadoria.py data/cache/municipios/osm_named_3510500.json

Requer shapely e pyproj.
"""
import json
import pathlib
import sys

from pyproj import Transformer
from shapely.geometry import LineString
from shapely.ops import nearest_points, substring, transform, unary_union

OUT = pathlib.Path(__file__).with_name('3510500_vias.geojson')
REGRA = 'caraguatatuba_centro_caminhoes_1000kg'
T = Transformer.from_crs(4326, 31983, always_xy=True).transform
Ti = Transformer.from_crs(31983, 4326, always_xy=True).transform

# ids das ways no OSM (lidos no mapa)
GUARULHOS = [199535996, 199536126]
OSWALDO = [199535956]
FREI = [274205490, 199535934]          # SW -> NE na ordem em que o ato percorre (R. Oswaldo Cruz -> R. Eng. João Fonseca)
ENG_JOAO = [199536131]                  # da Av. Frei Pacífico Wagner até a Av. Anchieta
ANCHIETA = [199535955]
# (inciso, via, [(way, de, ate)], descrição, aproximado); de/ate = 'ini', 'fim' ou lista de ways cuja interseção marca o ponto
TRECHOS = [
    ('a', 'R. Guarulhos', [(GUARULHOS[0], 'ini', 'fim'), (GUARULHOS[1], 'ini', 'fim')], 'Rua Guarulhos, em toda a sua extensão', False),
    ('b', 'R. Oswaldo Cruz', [(OSWALDO[0], 'ini', FREI)], 'Rua Oswaldo Cruz, do início (rotatória do trevo) até o cruzamento com a Av. Frei Pacífico Wagner', False),
    ('c', 'Av. Frei Pacífico Wagner', [(FREI[0], 'ini', OSWALDO), (FREI[1], 'ini', 'fim')], 'Av. Frei Pacífico Wagner, da R. Oswaldo Cruz até a R. Engenheiro João Fonseca (ponta nordeste, no cruzamento)', False),
    ('d', 'R. Engenheiro João Fonseca', [(ENG_JOAO[0], 'ini', 'fim')], 'R. Engenheiro João Fonseca, da Av. Frei Pacífico Wagner até a Av. Anchieta', False),
    ('e', 'Av. Anchieta', [(ANCHIETA[0], GUARULHOS, 'fim')], 'Av. Anchieta, da R. Guarulhos até a R. Engenheiro João Fonseca', True),
]


def main(osm):
    els = {e['id']: e for e in json.load(open(osm))['elements']}
    L = lambda ids: [transform(T, LineString([(p['lon'], p['lat']) for p in els[i]['geometry']])) for i in ids]
    feats = []

    def ponto(wl, ref):
        if ref == 'ini':
            return 0.0
        if ref == 'fim':
            return wl.length
        r = unary_union(L(ref))
        assert wl.distance(r) < 30, ref
        return wl.project(nearest_points(wl, r)[0])

    for inciso, via, pecas, desc, aprox in TRECHOS:
        for i, de, ate in pecas:
            e = els[i]
            ow = e['tags'].get('oneway') in ('yes', '1')
            wl = L([i])[0]
            a, b = sorted((ponto(wl, de), ponto(wl, ate)))
            if b - a < 10:
                continue
            seg = substring(wl, a, b)
            ll = transform(Ti, seg)
            feats.append({'type': 'Feature', 'properties': {
                'regra_id': REGRA, 'inciso': inciso, 'via': via, 'nome_osm': e['tags'].get('name'), 'osm_way_id': i,
                'fonte_trecho': desc, 'aproximado': aprox, 'sentido': 'unico' if ow else 'ambos', 'mao_unica': ow,
                'comprimento_m': round(seg.length)},
                'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7), round(y, 7)] for x, y in ll.coords]}})
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': 'OpenStreetMap (ODbL 1.0, © colaboradores do OSM): ways recortadas entre os cruzamentos citados no art. 1º da Lei 1.643/2009',
          'pendencias': [], 'features': feats}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, indent=1))
    print(f'{OUT.name}: {len(feats)} feições, {sum(f["properties"]["comprimento_m"] for f in feats)} m')


if __name__ == '__main__':
    main(sys.argv[1])
