"""Cache do Overpass a partir do PBF local (frente mun_rmsp_restante).

O importador genérico (importers/sources/_municipios_lib.overpass_named_ways) monta os trechos "rua X entre Y e Z" a
partir das vias com nome do município, consultando o Overpass com cache em data/cache/municipios/osm_named_<ibge>.json
(válido por 30 dias). Quando o Overpass público está ocupado (timeouts em 10/10/2026), este script grava esse mesmo
cache a partir do PBF que gerou o grafo do Valhalla (mesma malha que o import valida depois), sem mudar o importador.

Passo 1 (osmium-tool, imagem truck-router-osmtools; PBF do Sudeste montado só para leitura):
  docker run --rm -v <repo>/data/valhalla:/pbf:ro -v $(pwd)/data/cache/rmsp_restante:/w --entrypoint sh truck-router-osmtools -c \
    "osmium extract -b -47.25,-24.10,-45.70,-23.15 /pbf/sudeste-latest.osm.pbf -o /w/rmsp.osm.pbf --overwrite && \
     osmium tags-filter /w/rmsp.osm.pbf w/highway -o /w/hw.osm.pbf --overwrite && \
     osmium export /w/hw.osm.pbf --geometry-types=linestring -f geojsonseq -a id -o /w/hw.geojsonseq --overwrite"
Passo 2 (imagem do importador):
  docker run --rm -v $(pwd)/data:/data -v $(pwd)/data/raw/municipios/curadoria:/c --entrypoint python truck-router-importer \
    /c/osm_pbf_cache.py 3503901 3522208 ...
Licença: dados do OpenStreetMap (ODbL 1.0, © colaboradores do OSM).
"""
import json
import pathlib
import re
import sys

from shapely.geometry import LineString, shape
from shapely.prepared import prep

DATA = pathlib.Path('/data')
SEQ = DATA / 'cache' / 'rmsp_restante' / 'hw.geojsonseq'
LIMITES = DATA / 'raw' / 'rmsp' / 'ibge_rmsp_municipios.geojson'
OUT = DATA / 'cache' / 'municipios'
# mesmas classes da consulta do importador (overpass_named_ways)
HW = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|'
                r'primary_link|secondary_link|tertiary_link|living_street|service|road)$')


def main(ibges: list[str]) -> None:
    lim = {f['properties']['ibge']: shape(f['geometry']) for f in json.loads(LIMITES.read_text())['features']}
    areas = {i: prep(lim[i].buffer(0.0003)) for i in ibges}      # ~30 m: vias no limite, como o filtro de área do Overpass
    bbox = {i: lim[i].buffer(0.0003).bounds for i in ibges}
    out = {i: [] for i in ibges}
    with SEQ.open() as fh:
        for line in fh:
            f = json.loads(line.lstrip('\x1e'))
            p = f['properties']
            if not p.get('name') or not HW.match(p.get('highway', '')):
                continue
            c = f['geometry']['coordinates']
            xs, ys = [x for x, _ in c], [y for _, y in c]
            L = None
            for i in ibges:
                b = bbox[i]
                if max(xs) < b[0] or min(xs) > b[2] or max(ys) < b[1] or min(ys) > b[3]:
                    continue
                L = L or LineString(c)
                if areas[i].intersects(L):
                    tags = {k: v for k, v in p.items() if not k.startswith('@')}
                    out[i].append({'type': 'way', 'id': int(p['@id']), 'tags': tags,
                                   'geometry': [{'lat': y, 'lon': x} for x, y in c]})
    OUT.mkdir(parents=True, exist_ok=True)
    for i, els in out.items():
        (OUT / f'osm_named_{i}.json').write_text(json.dumps({'elements': els, 'fonte': 'PBF local (sudeste-latest.osm.pbf), OSM ODbL'}))
        print(i, len(els), 'vias com nome')


if __name__ == '__main__':
    main(sys.argv[1:])
