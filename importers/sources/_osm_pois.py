"""Extração de POIs (nós e áreas fechadas) do PBF do OSM — usada pelos importadores descanso_osm e postos_anp.

Duas passadas com pyosmium (sem índice de localização em memória): 1) nós e vias com as chaves pedidas;
2) coordenadas só dos nós das vias selecionadas. A posição de uma via (área) é a média dos seus nós (sem repetir o
último nó do anel). Relações (multipolígonos) são raras para esses objetos e ficam de fora.
PBF: $OSM_PBF ou o primeiro data/valhalla/*.osm.pbf (o mesmo extrato do Valhalla). Licença: ODbL 1.0.
"""
from __future__ import annotations
import time
from typing import Callable


def _tags(o) -> dict[str, str]:
    return {t.k: t.v for t in o.tags}


def extract(keys: tuple[str, ...], keep: Callable[[dict[str, str]], bool], pbf: str | None = None) -> list[dict]:
    """[{osm_id: 'n123'|'w456', lon, lat, tags}] dos objetos com alguma das `keys` e `keep(tags)` verdadeiro."""
    import osmium
    from osmium.filter import IdFilter, KeyFilter
    from sources.osm_altura_nos import pbf_path
    pbf = pbf or pbf_path()
    t0 = time.time()
    out: list[dict] = []
    for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(KeyFilter(*keys)):
        tags = _tags(n)
        if keep(tags) and n.location.valid():
            out.append({'osm_id': f'n{n.id}', 'lon': n.location.lon, 'lat': n.location.lat, 'tags': tags})
    ways: dict[int, dict] = {}
    for w in osmium.FileProcessor(pbf, osmium.osm.WAY).with_filter(KeyFilter(*keys)):
        tags = _tags(w)
        if keep(tags):
            refs = [x.ref for x in w.nodes]
            if len(refs) > 1 and refs[0] == refs[-1]:
                refs = refs[:-1]
            ways[w.id] = {'refs': refs, 'tags': tags}
    need = {r for w in ways.values() for r in w['refs']}
    loc: dict[int, tuple[float, float]] = {}
    if need:
        for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(IdFilter(need)):
            if n.location.valid():
                loc[n.id] = (n.location.lon, n.location.lat)
    for wid, w in ways.items():
        pts = [loc[r] for r in w['refs'] if r in loc]
        if not pts:
            continue
        out.append({'osm_id': f'w{wid}', 'lon': sum(p[0] for p in pts) / len(pts), 'lat': sum(p[1] for p in pts) / len(pts),
                    'tags': w['tags']})
    print(f'  OSM: {len(out)} objetos ({sum(1 for o in out if o["osm_id"][0] == "w")} áreas) em {time.time() - t0:.0f}s ({pbf})')
    return out
