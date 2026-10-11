"""Atibaia (3504107): vias do Quadrilátero de Restrição de Trânsito de Veículos Pesados (Dec. 6.667/2012, art. 2º, I e II).

Gera data/raw/municipios/geo/3504107_quadrilatero.geojson (linhas, uma por way do OSM recortada) a partir de um extrato do
OSM (formato Overpass "out geom tags": {"elements": [{id, tags, geometry: [{lat, lon}]}]}, com TODAS as vias do
município, inclusive as sem nome) passado como argumento:

  python3 data/raw/municipios/geo/3504107_quadrilatero_curadoria.py <extrato_osm.json>

Como: (1) o perímetro do inciso I (Major Juvenal Alvim, Pça. Bento Paes, Dr. Álvaro Correia Lima, 13 de Maio, Lourenço
Franco, Largo do Rosário, Av. 9 de Julho, Monsenhor Kohly, Castro Fafe) mais a Rua João Pires (limite norte, livre) vira
um polígono: as vias são engordadas e o "buraco" que contém o centro é devolvido ao eixo (dois blocos, oeste e leste da
Rua Lourenço Franco, unidos); (2) as ways das vias dos incisos I e II são recortadas por esse polígono com folga de 12 m.
O inciso II diz "Ruas intermediárias abrangidas na limitação de que trata o inciso anterior ... todas iniciando no
cruzamento com a Rua João Pires": só o pedaço dentro do perímetro conta. Calçadões (highway=pedestrian) ficam de fora.
Geometria derivada do OpenStreetMap (ODbL 1.0). Requer shapely e pyproj.
"""
import json
import pathlib
import sys
import unicodedata
import re

from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, mapping
from shapely.ops import transform, unary_union

T = Transformer.from_crs(4326, 31983, always_xy=True).transform
Ti = Transformer.from_crs(31983, 4326, always_xy=True).transform
OUT = pathlib.Path(__file__).with_name('3504107_quadrilatero.geojson')

PERIMETRO = ['Rua Major Juvenal Alvim', 'Praça Bento Paes', 'Rua Doutor Álvaro Correia Lima', 'Rua Treze de Maio',
             'Rua Lourenço Franco', 'Largo do Rosário', 'Avenida 9 de Julho - Revolução Constitucionalista de 1932',
             'Rua Monsenhor Kohly', 'Rua Castro Fafe', 'Rua João Pires']
INCISO_I = PERIMETRO[:-1]
INCISO_II = ['Avenida São João', 'Rua Visconde do Rio Branco', 'Praça Claudino Alves', 'Rua José Lucas',
             'Rua Doutor Olimpio da Paixão', 'Rua Dona Benedita Leite', 'Rua José Alvim', 'Avenida da Saudade',
             'Rua Thomé Franco', 'Rua Doutor Zeferino Alves do Amaral', 'Rua Benedito de Almeida Bueno', 'Rua José Pires',
             'Rua José Bim', 'Rua José Inácio', 'Rua Lourenço Franco', 'Rua Bartolomeu Peranovich', 'Rua São Vicente de Paulo']
CENTROS = [(-46.5535, -23.1160), (-46.5490, -23.1153)]   # um ponto em cada bloco do quadrilátero
FOLGA_M = 12
FORA = {'pedestrian', 'footway', 'steps', 'path', 'cycleway', 'construction', 'proposed'}


def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', re.sub(r"[’'`´.]", '', s)).strip()


def main(src):
    els = [e for e in json.load(open(src))['elements'] if 'highway' in e.get('tags', {}) and len(e.get('geometry') or []) >= 2]
    line = lambda e: transform(T, LineString([(p['lon'], p['lat']) for p in e['geometry']]))
    per = {norm(n) for n in PERIMETRO}
    U = unary_union([line(e) for e in els if norm(e['tags'].get('name')) in per])
    blocos = []
    for lon, lat in CENTROS:
        c = transform(T, Point(lon, lat))
        for b in (10, 20, 30, 45):
            B = U.buffer(b)
            H = [Polygon(r) for g in getattr(B, 'geoms', [B]) for r in g.interiors if Polygon(r).contains(c)]
            if H:
                blocos.append(H[0].buffer(b))
                break
        else:
            raise SystemExit(f'perímetro não fecha em torno de {lon},{lat}')
    Q = unary_union([x.buffer(5) for x in blocos]).buffer(-5)
    clip = Q.buffer(FOLGA_M)
    feats = []
    for inc, nomes in (('art. 2º, I', INCISO_I), ('art. 2º, II', INCISO_II)):
        for nome in nomes:
            for e in els:
                t = e['tags']
                if norm(t.get('name')) != norm(nome) or t['highway'] in FORA:
                    continue
                L = line(e)
                ow = t.get('oneway') in ('yes', '1', 'true', '-1') or t.get('junction') == 'roundabout'
                if t.get('oneway') == '-1':
                    L = LineString(list(L.coords)[::-1])
                G = L.intersection(clip)
                for g in [g for g in getattr(G, 'geoms', [G]) if g.geom_type == 'LineString' and g.length >= 10]:
                    if inc == 'art. 2º, II' and any(f['properties']['osm_way_id'] == e['id'] and f['properties']['inciso'] == 'art. 2º, I' for f in feats):
                        continue      # Lourenço Franco: o pedaço do perímetro já está no inciso I
                    gl = transform(Ti, g)
                    feats.append({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7), round(y, 7)] for x, y in gl.coords]},
                                  'properties': {'regra_id': 'atibaia_quadrilatero_central', 'inciso': inc, 'via': nome, 'nome_osm': t.get('name'),
                                                 'osm_way_id': e['id'], 'mao_unica': ow, 'sentido': 'unico' if ow else 'ambos',
                                                 'comprimento_m': round(g.length)}})
    fc = {'type': 'FeatureCollection', 'features': feats,
          'fonte_geometria': 'OpenStreetMap (ODbL 1.0): ways das vias do Dec. 6.667/2012, art. 2º, I e II, recortadas pelo perímetro do inciso I',
          'quadrilatero': mapping(transform(Ti, Q.simplify(1)))}
    OUT.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{OUT}: {len(feats)} linhas, {sum(f["properties"]["comprimento_m"] for f in feats)} m')


if __name__ == '__main__':
    main(sys.argv[1])
