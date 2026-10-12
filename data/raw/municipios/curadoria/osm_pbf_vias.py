"""Todas as vias (tag highway, com e sem nome, com e sem ref) do PBF local que tocam um retângulo, no formato Overpass
"out geom tags" ({"elements": [{"type": "way", "id", "tags", "geometry": [{"lat","lon"}]}]}).

O cache osm_named_<ibge>.json (osm_pbf_cache_sudeste.py) só tem vias COM NOME e perde trechos de rodovia sem nome
(travessias, ramos, ligações); este serve a curadoria que precisa das rodovias inteiras (zona_rodovia_lib.py).

  python3 data/raw/municipios/curadoria/osm_pbf_vias.py [--pbf data/valhalla/sudeste-latest.osm.pbf] -- <min_lon,min_lat,max_lon,max_lat> <saida.json>   (o "--" é preciso: o retângulo começa com "-")

Convenção: data/cache/municipios/osm_hw_<ibge>.json, retângulo do limite IBGE + 0,02°.
Requisitos: pip install osmium. Dados do OpenStreetMap (ODbL 1.0, © colaboradores do OSM).
"""
import argparse
import json

import osmium


class H(osmium.SimpleHandler):
    def __init__(self, bbox):
        super().__init__()
        self.b, self.e = bbox, []

    def way(self, w):
        if 'highway' not in w.tags:
            return
        try:
            g = [(n.lon, n.lat) for n in w.nodes]
        except Exception:
            return
        if len(g) < 2:
            return
        x0, y0, x1, y1 = self.b
        xs, ys = [a for a, _ in g], [b for _, b in g]
        if max(xs) < x0 or min(xs) > x1 or max(ys) < y0 or min(ys) > y1:
            return
        self.e.append({'type': 'way', 'id': w.id, 'tags': {t.k: t.v for t in w.tags},
                       'geometry': [{'lat': b, 'lon': a} for a, b in g]})


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('bbox')
    ap.add_argument('saida')
    ap.add_argument('--pbf', default='data/valhalla/sudeste-latest.osm.pbf')
    a = ap.parse_args()
    h = H(tuple(map(float, a.bbox.split(','))))
    h.apply_file(a.pbf, locations=True)
    json.dump({'elements': h.e}, open(a.saida, 'w'), ensure_ascii=False)
    print(f'{a.saida}: {len(h.e)} vias')
