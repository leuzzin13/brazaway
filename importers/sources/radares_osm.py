"""Radares fixos de velocidade (fiscalização eletrônica) mapeados no OpenStreetMap.

Lê o PBF local (o mesmo do Valhalla; $OSM_PBF ou o primeiro data/valhalla/*.osm.pbf) e grava:
  - nós `highway=speed_camera` (sem `fake=yes`/`speed_camera=fake`), com maxspeed, maxspeed:hgv, ref, name e direction;
  - relações `type=enforcement` + `enforcement=maxspeed` com membro `device`: o `from` dá a direção da fiscalização
    (rumo de `from` até o device, ou o sentido do trecho de via) e a relação dá o maxspeed quando o nó não tem.
    Se o device já é um `highway=speed_camera`, a relação só enriquece o nó; se não é, vira um radar próprio.

Direção (props.direction_deg = rumo, graus de 0 a 360, do tráfego fiscalizado; null = os dois sentidos/desconhecida):
  - número 0-360 -> o próprio número; N/NE/E/SE/S/SW/W/NW e north/... -> rumo correspondente;
  - forward / backward -> relativos à via em que o nó está: rumo do trecho da via no nó (backward = oposto);
    nó em cruzamento escolhe a via de maior hierarquia; sem via trafegável fica sem direção;
  - both / vazio / outro texto -> null (o nó vale para os dois sentidos).
  A API só descarta o radar quando direction_deg existe e o rumo da rota naquele ponto difere mais de 60 graus.

Licença: ODbL 1.0 (dado do OSM). Nada volta para o OSM. Precisa do pacote Python `osmium`.
"""
from __future__ import annotations
import glob, math, os, re, time
from common import DATA_DIR, osm_pbf

LAYER_ID = 'radares'
SOURCE = 'osm'
SOURCE_URL = 'https://download.geofabrik.de/south-america/brazil/sudeste.html (PBF local em data/valhalla)'
LICENSE = 'ODbL 1.0 — © colaboradores do OpenStreetMap'
NOTES = ('Nós highway=speed_camera e relações type=enforcement enforcement=maxspeed (device) do OSM. '
         'Informativo: radar não é restrição, a camada só avisa na rota (não altera o traçado).')

DRIVABLE_RANK = {'motorway': 9, 'motorway_link': 8, 'trunk': 9, 'trunk_link': 8, 'primary': 7, 'primary_link': 6,
                 'secondary': 5, 'secondary_link': 4, 'tertiary': 3, 'tertiary_link': 2, 'unclassified': 2,
                 'residential': 1, 'living_street': 1, 'service': 0, 'road': 1, 'track': 0}

CARDINAL = {'n': 0, 'north': 0, 'nne': 22.5, 'ne': 45, 'northeast': 45, 'ene': 67.5, 'e': 90, 'east': 90, 'ese': 112.5,
            'se': 135, 'southeast': 135, 'sse': 157.5, 's': 180, 'south': 180, 'ssw': 202.5, 'sw': 225, 'southwest': 225,
            'wsw': 247.5, 'w': 270, 'west': 270, 'wnw': 292.5, 'nw': 315, 'northwest': 315, 'nnw': 337.5}


def pbf_path() -> str:
    p = osm_pbf()
    if not p:
        raise FileNotFoundError('PBF não encontrado: defina OSM_PBF ou gere data/osm/sse_co.osm.pbf')
    return p


# ---------- parsing ----------
def parse_speed(v: str | None) -> int | None:
    """'60', '60 km/h' -> 60. 'BR:urban', 'signals', vazio -> None. Fora de 5-130 km/h é descartado."""
    if not v:
        return None
    m = re.fullmatch(r'\s*(\d{1,3})\s*(km/h|kmh)?\s*', v.lower())
    if not m:
        return None
    n = int(m.group(1))
    return n if 5 <= n <= 130 else None


def parse_direction(v: str | None) -> tuple[float | None, str]:
    """-> (rumo absoluto em graus ou None, tipo). tipo: 'deg' | 'forward' | 'backward' | 'both' | 'none'.
    forward/backward ficam sem rumo aqui (dependem da via)."""
    if not v:
        return None, 'none'
    s = v.strip().lower()
    if s in ('forward', 'backward', 'both'):
        return None, s
    if s in CARDINAL:
        return float(CARDINAL[s]), 'deg'
    try:
        d = float(s.replace(',', '.'))
    except ValueError:
        return None, 'none'
    if 0 <= d <= 360:
        return round(d % 360, 1), 'deg'
    return None, 'none'


# ---------- geometria ----------
def bearing(a, b) -> float:
    """Rumo inicial (graus, 0=norte, horário) de a para b; pontos (lon, lat)."""
    lat1, lat2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    y = math.sin(dl) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dl)
    return round((math.degrees(math.atan2(y, x)) + 360) % 360, 1)


def dist_m(a, b) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    return math.hypot((b[0] - a[0]) * 111320.0 * math.cos(lat), (b[1] - a[1]) * 110574.0)


def way_bearing_at(coords, i) -> float | None:
    """Rumo da via (sentido dos nós) no índice i, olhando um vizinho de cada lado."""
    a = coords[i - 1] if i > 0 else coords[i]
    b = coords[i + 1] if i + 1 < len(coords) else coords[i]
    if a == b:
        return None
    return bearing(a, b)


def way_bearing_towards(coords, target) -> float | None:
    """Sentido de uma via 'from' de uma relação: o tráfego vem da ponta mais distante do device e segue até ele.
    Devolve o rumo do segmento da via mais próximo do device, nesse sentido."""
    n = len(coords)
    if n < 2:
        return None
    k = min(range(n), key=lambda j: dist_m(coords[j], target))
    if dist_m(coords[0], target) >= dist_m(coords[-1], target):   # ponta inicial é a mais longe: sentido dos nós
        a, b = (coords[k - 1], coords[k]) if k > 0 else (coords[0], coords[1])
    else:                                                            # ponta final é a mais longe: sentido inverso
        a, b = (coords[k + 1], coords[k]) if k < n - 1 else (coords[n - 1], coords[n - 2])
    return bearing(a, b) if a != b else None


def _tags(o) -> dict:
    return {t.k: t.v for t in o.tags}


def fetch():
    import osmium
    from osmium.filter import KeyFilter, IdFilter
    pbf = pbf_path()
    t0 = time.time()
    print(f'  PBF: {pbf}')

    # 1) nós highway=speed_camera
    cams: dict[int, dict] = {}
    fake = 0
    for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(KeyFilter('highway')):
        tags = _tags(n)
        if tags.get('highway') != 'speed_camera' or not n.location.valid():
            continue
        if tags.get('fake') == 'yes' or tags.get('speed_camera') == 'fake':
            fake += 1
            continue
        cams[n.id] = {'lon': n.location.lon, 'lat': n.location.lat, 'tags': tags}
    print(f'  nós speed_camera: {len(cams)} (descartados fake: {fake}) ({time.time()-t0:.0f}s)')

    # 2) relações enforcement=maxspeed com device
    rels: list[dict] = []
    for r in osmium.FileProcessor(pbf, osmium.osm.RELATION).with_filter(KeyFilter('type')):
        tags = _tags(r)
        if tags.get('type') != 'enforcement' or tags.get('enforcement') != 'maxspeed':
            continue
        mem = [(m.type, m.ref, m.role) for m in r.members]
        devices = [m for m in mem if m[2] == 'device' and m[0] == 'n']
        if not devices:
            continue
        rels.append({'id': r.id, 'tags': tags, 'devices': [d[1] for d in devices],
                     'from': [m for m in mem if m[2] == 'from'], 'to': [m for m in mem if m[2] == 'to']})
    print(f'  relações enforcement=maxspeed com device: {len(rels)} ({time.time()-t0:.0f}s)')

    rel_nodes = {d for r in rels for d in r['devices']}
    rel_nodes |= {m[1] for r in rels for m in r['from'] if m[0] == 'n'}
    rel_ways = {m[1] for r in rels for m in r['from'] if m[0] == 'w'}

    # 3) vias que passam pelos radares (para forward/backward, nome da via) e vias 'from' das relações
    targets = set(cams) | rel_nodes
    ways: dict[int, dict] = {}
    for w in osmium.FileProcessor(pbf, osmium.osm.WAY).with_filter(KeyFilter('highway')):
        refs = [n.ref for n in w.nodes]
        hw = w.tags.get('highway')
        if (hw in DRIVABLE_RANK and any(r in targets for r in refs)) or w.id in rel_ways:
            ways[w.id] = {'refs': refs, 'tags': _tags(w)}
    need = {r for w in ways.values() for r in w['refs']} | rel_nodes
    print(f'  vias: {len(ways)} ({time.time()-t0:.0f}s)')

    # 4) coordenadas
    loc: dict[int, tuple[float, float]] = {}
    for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(IdFilter(need)):
        if n.location.valid():
            loc[n.id] = (n.location.lon, n.location.lat)
    print(f'  coordenadas: {len(loc)} ({time.time()-t0:.0f}s)')

    by_node: dict[int, list[int]] = {}
    for wid, w in ways.items():
        if w['tags'].get('highway') not in DRIVABLE_RANK:
            continue
        for r in set(w['refs']):
            if r in targets:
                by_node.setdefault(r, []).append(wid)

    def best_way(nid):
        ws = by_node.get(nid, [])
        return max(ws, key=lambda wid: DRIVABLE_RANK.get(ways[wid]['tags'].get('highway'), -1)) if ws else None

    def way_dir(nid, kind):
        wid = best_way(nid)
        if wid is None:
            return None, None
        w = ways[wid]
        if any(r not in loc for r in w['refs']):
            return None, w
        coords = [loc[r] for r in w['refs']]
        i = w['refs'].index(nid)
        b = way_bearing_at(coords, i)
        if b is None:
            return None, w
        return (b if kind == 'forward' else (b + 180) % 360), w

    out: dict[int, dict] = {}
    for nid, c in cams.items():
        t = c['tags']
        deg, kind = parse_direction(t.get('direction'))
        way = None
        if kind in ('forward', 'backward'):
            deg, way = way_dir(nid, kind)
            if deg is not None:
                deg = round(deg, 1)
        out[nid] = {
            'lon': c['lon'], 'lat': c['lat'], 'tags': t, 'dir_deg': deg, 'dir_kind': kind,
            'maxspeed': parse_speed(t.get('maxspeed')), 'maxspeed_hgv': parse_speed(t.get('maxspeed:hgv')),
            'way': way or (ways.get(best_way(nid)) if best_way(nid) else None), 'relation': None,
        }

    # relações: enriquecem nós existentes ou criam radares
    enriched = created = 0
    for r in rels:
        rt = r['tags']
        for did in r['devices']:
            if did not in loc and did not in cams:
                continue
            dpos = (cams[did]['lon'], cams[did]['lat']) if did in cams else loc[did]
            deg = None
            for m in r['from']:
                if m[0] == 'n' and m[1] in loc and dist_m(loc[m[1]], dpos) > 5:
                    deg = bearing(loc[m[1]], dpos)
                elif m[0] == 'w' and m[1] in ways and all(x in loc for x in ways[m[1]]['refs']):
                    deg = way_bearing_towards([loc[x] for x in ways[m[1]]['refs']], dpos)
                if deg is not None:
                    break
            ms = parse_speed(rt.get('maxspeed'))
            if did in out:
                o = out[did]
                if o['maxspeed'] is None:
                    o['maxspeed'] = ms
                if o['dir_deg'] is None and o['dir_kind'] not in ('both',) and deg is not None:
                    o['dir_deg'], o['dir_kind'] = deg, 'relation'
                o['relation'] = r['id']
                enriched += 1
            else:
                tags = {k: v for k, v in rt.items() if k not in ('type',)}
                out[did] = {'lon': dpos[0], 'lat': dpos[1], 'tags': tags, 'dir_deg': deg, 'dir_kind': 'relation' if deg is not None else 'none',
                            'maxspeed': ms, 'maxspeed_hgv': None, 'way': ways.get(best_way(did)) if best_way(did) else None, 'relation': r['id']}
                created += 1
    print(f'  relações: {enriched} enriqueceram nós, {created} criaram radares ({time.time()-t0:.0f}s)')

    feats = []
    for nid, o in out.items():
        t, way = o['tags'], o['way']
        road = (way['tags'].get('name') or way['tags'].get('ref')) if way else None
        speed = o['maxspeed']
        title = f"Radar {speed} km/h" if speed else 'Radar de velocidade'
        label = t.get('name') or t.get('ref')
        name = title + (f' — {label}' if label else f' — {road}' if road else '')
        feats.append({
            'source_id': f'n{nid}',
            'geometry': {'type': 'Point', 'coordinates': [round(o['lon'], 7), round(o['lat'], 7)]},
            'name': name,
            'kind': 'radar',
            'props': {
                'osm_node': nid, 'osm_url': f'https://www.openstreetmap.org/node/{nid}',
                'maxspeed_kmh': speed, 'maxspeed_hgv_kmh': o['maxspeed_hgv'],
                'direction_deg': o['dir_deg'], 'direction_raw': t.get('direction'),
                'direction_kind': o['dir_kind'],
                'ref': t.get('ref'), 'label': t.get('name'), 'via': road,
                'highway': way['tags'].get('highway') if way else None,
                'osm_relation': o['relation'],
                'camera_type': t.get('camera:type') or t.get('speed_camera'),
                'fonte': 'OpenStreetMap (nó highway=speed_camera' + (' + relação enforcement)' if o['relation'] else ')'),
            },
        })
    com_dir = sum(1 for f in feats if f['props']['direction_deg'] is not None)
    print(f'  radares: {len(feats)}; com direção resolvida: {com_dir} ({time.time()-t0:.0f}s)')
    return feats
