"""Cache do Overpass a partir do PBF local para QUALQUER município do Sudeste (generaliza osm_pbf_cache.py).

O importador genérico (importers/sources/_municipios_lib.overpass_named_ways) monta os trechos "rua X entre Y e Z" a
partir das vias com nome do município, com cache em data/cache/municipios/osm_named_<ibge>.json (válido por 30 dias).
Quando o Overpass público não responde, este script grava esse mesmo cache a partir do PBF que gerou o grafo do
Valhalla (mesma malha que o import valida depois), sem mudar o importador.

Limites municipais: malha do IBGE (API v3, qualidade intermediária), com cache em data/cache/municipios/ibge_malha_<uf>.json.
Requisitos (fora do Docker): pip install osmium shapely requests

  python3 data/raw/municipios/curadoria/osm_pbf_cache_sudeste.py [--pbf data/valhalla/sudeste-latest.osm.pbf] <ibge> [<ibge> ...]

Licença: dados do OpenStreetMap (ODbL 1.0, © colaboradores do OSM); limites: IBGE.
"""
import argparse
import json
import pathlib
import re

import osmium
import requests
from shapely.geometry import LineString, shape
from shapely.prepared import prep

ROOT = pathlib.Path(__file__).resolve().parents[4]
OUT = ROOT / 'data' / 'cache' / 'municipios'
MALHA = 'https://servicodados.ibge.gov.br/api/v3/malhas/estados/{uf}?intrarregiao=municipio&qualidade=intermediaria&formato=application/vnd.geo%2Bjson'
UF = {'31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP'}
# mesmas classes da consulta do importador (overpass_named_ways)
HW = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|'
                r'primary_link|secondary_link|tertiary_link|living_street|service|road)$')


def limites(ibges: list[str]) -> dict:
    out = {}
    for pref in sorted({i[:2] for i in ibges}):
        p = OUT / f'ibge_malha_{UF[pref]}.json'
        if not p.exists():
            r = requests.get(MALHA.format(uf=pref), timeout=300)
            r.raise_for_status()
            OUT.mkdir(parents=True, exist_ok=True)
            p.write_text(r.text)
        for f in json.loads(p.read_text())['features']:
            cod = str(f['properties'].get('codarea'))
            if cod in ibges:
                out[cod] = shape(f['geometry'])
    falta = set(ibges) - set(out)
    if falta:
        raise SystemExit(f'sem limite no IBGE: {sorted(falta)}')
    return out


class Vias(osmium.SimpleHandler):
    def __init__(self, areas, bbox):
        super().__init__()
        self.areas, self.bbox = areas, bbox
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
        xs, ys = [x for x, _ in c], [y for _, y in c]
        L = None
        for i, b in self.bbox.items():
            if max(xs) < b[0] or min(xs) > b[2] or max(ys) < b[1] or min(ys) > b[3]:
                continue
            L = L or LineString(c)
            if self.areas[i].intersects(L):
                self.out[i].append({'type': 'way', 'id': w.id, 'tags': {t.k: t.v for t in w.tags},
                                    'geometry': [{'lat': y, 'lon': x} for x, y in c]})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--pbf', default=str(ROOT / 'data' / 'valhalla' / 'sudeste-latest.osm.pbf'))
    ap.add_argument('ibges', nargs='+')
    a = ap.parse_args()
    lim = limites(a.ibges)
    areas = {i: prep(g.buffer(0.0003)) for i, g in lim.items()}  # ~30 m: vias no limite, como o filtro de área do Overpass
    bbox = {i: g.buffer(0.0003).bounds for i, g in lim.items()}
    h = Vias(areas, bbox)
    h.apply_file(a.pbf, locations=True, idx='flex_mem')
    OUT.mkdir(parents=True, exist_ok=True)
    for i, els in h.out.items():
        (OUT / f'osm_named_{i}.json').write_text(json.dumps({'elements': els, 'fonte': f'PBF local ({pathlib.Path(a.pbf).name}), OSM ODbL'}))
        print(i, len(els), 'vias com nome')


if __name__ == '__main__':
    main()
