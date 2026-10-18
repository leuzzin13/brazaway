"""Cache das vias com nome de um ou mais municípios (qualquer UF coberta pelo PBF), no formato do Overpass, para a
curadoria da geometria das regras municipais sem depender do Overpass.

Uso: python3 osm_pbf_cache_regioes.py <ibge> [<ibge> ...]
Lê data/osm/sse_co.osm.pbf (Sudeste + Sul + Centro-Oeste, ver scripts/build-tiles-regioes.sh) e a malha do IBGE de cada
município (baixa para data/cache/municipios/ibge_malha_<ibge>.geojson se faltar). Grava
data/cache/municipios/osm_named_<ibge>.json. Leva ~15 min por chamada (uma passada no PBF, para todos os municípios
pedidos de uma vez). Generaliza osm_pbf_cache_sudeste.py (que só conhecia as UFs do Sudeste)."""
import json
import pathlib
import re
import sys
import urllib.request

import osmium
from shapely.geometry import LineString, shape
from shapely.prepared import prep

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = ROOT / 'data/cache/municipios'
PBF = ROOT / 'data/osm/sse_co.osm.pbf'
MALHA = 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{}?formato=application/vnd.geo%2Bjson&qualidade=maxima'
HW = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|primary_link|'
                r'secondary_link|tertiary_link|living_street|service|road)$')


def malha(ibge: str):
    p = OUT / f'ibge_malha_{ibge}.geojson'
    if not p.exists():
        OUT.mkdir(parents=True, exist_ok=True)
        p.write_bytes(urllib.request.urlopen(MALHA.format(ibge), timeout=120).read())
    return shape(json.loads(p.read_text())['features'][0]['geometry'])


def main(ibges: list[str]) -> None:
    lim = {i: malha(i) for i in ibges}
    areas = {i: prep(g.buffer(0.0003)) for i, g in lim.items()}
    bbox = {i: g.buffer(0.0003).bounds for i, g in lim.items()}

    class Vias(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.out = {i: [] for i in areas}

        def way(self, w):
            name, hw = w.tags.get('name'), w.tags.get('highway', '')
            if not name or not HW.match(hw):
                return
            try:
                c = [(n.lon, n.lat) for n in w.nodes]
            except osmium.InvalidLocationError:
                return
            if len(c) < 2:
                return
            xs = [x for x, _ in c]
            ys = [y for _, y in c]
            linha = None
            for i, b in bbox.items():
                if max(xs) < b[0] or min(xs) > b[2] or max(ys) < b[1] or min(ys) > b[3]:
                    continue
                linha = linha or LineString(c)
                if areas[i].intersects(linha):
                    self.out[i].append({'type': 'way', 'id': w.id, 'tags': {t.k: t.v for t in w.tags},
                                        'geometry': [{'lat': y, 'lon': x} for x, y in c]})

    h = Vias()
    h.apply_file(str(PBF), locations=True, idx='flex_mem')
    for i, els in h.out.items():
        (OUT / f'osm_named_{i}.json').write_text(json.dumps({'elements': els, 'fonte': f'PBF local ({PBF.name}), OSM ODbL'}))
        print(i, len(els))


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
