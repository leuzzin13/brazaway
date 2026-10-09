"""Pontos de cobrança de pedágio do OpenStreetMap: barrier=toll_booth (cabine/praça) e highway=toll_gantry (pórtico, free flow).

Lê o MESMO extrato .osm.pbf usado para montar os tiles do Valhalla (data/valhalla/*.osm.pbf), para que o nó do pedágio
coincida com o nó do grafo de roteamento; sem PBF local, cai para a Overpass API.
Para cada nó guarda:
  - a tarifa `charge` decomposta (R$/eixo de caminhão, R$/carro, dia útil x fim de semana) e o `check_date`;
  - as vias (ways) que passam pelo nó: `oneway`, `ref` (rodovia) e o rumo da via no nó;
  - o(s) rumo(s) cobrado(s) derivados de `direction` (graus = para onde a cabine "olha"; o tráfego cobrado segue no rumo
    oposto, convenção conferida nos nós sobre vias de mão única, ver docs/layers/pedagio.md) ou forward/backward.
Na API, um nó só conta se a rota passar EXATAMENTE por ele (a polilinha do Valhalla passa pelos nós do grafo); com isso a
pista do sentido contrário (outra way, 10–50 m ao lado) não é contada.
LICENÇA: ODbL (© OpenStreetMap contributors). Fica em data_features (source='osm'), separado das fontes oficiais.
"""
from __future__ import annotations
import glob, json, math, os, re
from common import http_get

LAYER_ID = 'pedagio'
SOURCE = 'osm'
SOURCE_URL = 'OpenStreetMap: barrier=toll_booth / highway=toll_gantry (extrato Geofabrik usado pelo Valhalla; fallback Overpass API)'
LICENSE = 'ODbL 1.0 — © OpenStreetMap contributors'
NOTES = 'Tarifa (charge) é dado colaborativo: usada como reserva quando a tabela oficial falta ou está defasada, sempre com a data (check_date).'

OVERPASS = os.environ.get('OVERPASS_URL', 'https://overpass-api.de/api/interpreter')
# Sem PBF: região do Valhalla (Sudeste) por padrão; ajuste OSM_TOLL_BBOX="minLat,minLon,maxLat,maxLon" para outra área
BBOX = os.environ.get('OSM_TOLL_BBOX', '-25.4,-53.2,-14.2,-39.6')


def _pbf_path() -> str | None:
    p = os.environ.get('OSM_PBF')
    if p and os.path.exists(p):
        return p
    for pat in ('/data/valhalla/*.osm.pbf', '/data/*.osm.pbf', '/data/raw/*.osm.pbf'):
        c = sorted(glob.glob(pat))
        if c:
            return c[0]
    return None


def bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Rumo (graus, 0 = norte, horário) de a=(lon,lat) para b."""
    lon1, lat1, lon2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


CARD = {'N': 0, 'NNE': 22.5, 'NE': 45, 'ENE': 67.5, 'E': 90, 'ESE': 112.5, 'SE': 135, 'SSE': 157.5, 'S': 180,
        'SSW': 202.5, 'SW': 225, 'WSW': 247.5, 'W': 270, 'WNW': 292.5, 'NW': 315, 'NNW': 337.5}

_PART = re.compile(r'^\s*(?:(?P<cond>[A-Za-z][A-Za-z,\- ]*?)\s+)?(?P<val>\d+(?:[.,]\d+)?)\s*(?P<cur>BRL|R\$)?\s*/?\s*(?P<unit>[A-Za-z_/:]+)?\s*$')


def parse_charge(raw: str | None) -> dict:
    """'14.50BRL/motorcar;0.00BRL/motorcycle;14.50BRL/hgv/axle' ou 'Mo-Fr 1.05BRL/hgv/axle;Sa-Su 1.76BRL/hgv/axle'.
    Devolve {'hgv_axle': {'all'|'weekday'|'weekend': v}, 'motorcar': {...}, 'hgv': {...}, 'motorcycle': {...}}."""
    out: dict[str, dict[str, float]] = {}
    if not raw:
        return out
    for part in raw.split(';'):
        m = _PART.match(part)
        if not m:
            continue
        unit = (m.group('unit') or '').lower().strip('/')
        unit = unit.replace('hgva/axle', 'hgv/axle')  # erro de digitação recorrente no OSM-BR
        if unit in ('hgv/axle', 'hgv/axles', 'truck/axle', 'goods/axle'):
            key = 'hgv_axle'
        elif unit in ('motorcar', 'car', 'motor_vehicle'):
            key = 'motorcar'
        elif unit in ('hgv', 'truck'):
            key = 'hgv'
        elif unit in ('motorcycle',):
            key = 'motorcycle'
        else:
            continue
        cond = (m.group('cond') or '').strip()
        when = 'all'
        if re.match(r'(?i)^mo\s*-\s*fr$', cond):
            when = 'weekday'
        elif re.match(r'(?i)^sa\s*-\s*su$', cond):
            when = 'weekend'
        elif cond:
            when = 'cond:' + cond
        out.setdefault(key, {})[when] = float(m.group('val').replace(',', '.'))
    return out


def charged_headings(direction: str | None, way_bearings: list[float]) -> tuple[list[float], str]:
    """Rumos de tráfego cobrados a partir de `direction`. Retorna (rumos, método)."""
    if not direction:
        return [], 'none'
    d = direction.strip()
    if d.lower() in ('forward', 'backward'):
        if not way_bearings:
            return [], 'none'
        b = way_bearings[0]
        return [b if d.lower() == 'forward' else (b + 180) % 360], 'forward_backward'
    hs = []
    for tok in re.split(r'[;,]', d):
        tok = tok.strip().upper()
        if not tok:
            continue
        try:
            deg = float(tok)
        except ValueError:
            if tok not in CARD:
                continue
            deg = CARD[tok]
        hs.append((deg + 180) % 360)  # a cabine "olha" para o tráfego que chega
    return hs, 'degrees' if hs else 'none'


def _feature(nid: int, lon: float, lat: float, tags: dict, ways: list[dict]) -> dict:
    is_gantry = tags.get('highway') == 'toll_gantry'
    charge_raw = ';'.join(x for x in (tags.get('charge'), tags.get('charge:hgv')) if x) or None
    charge = parse_charge(tags.get('charge'))
    if tags.get('charge:hgv'):
        for k, v in parse_charge(tags['charge:hgv']).items():
            charge.setdefault(k, {}).update(v)
    wb = [w['bearing'] for w in ways if w.get('bearing') is not None]
    heads, method = charged_headings(tags.get('direction'), wb)
    refs = sorted({r.strip() for w in ways for r in re.split(r'[;/]', w.get('ref') or '') if r.strip()})
    oneway = None
    if ways:
        oneway = all(w.get('oneway') for w in ways)
    name = tags.get('name') or tags.get('note') or tags.get('ref') or tags.get('description')
    check = tags.get('check_date:charge') or tags.get('check_date') or tags.get('survey:date')
    payment = sorted(k.split(':', 1)[1] for k, v in tags.items() if k.startswith('payment:') and v == 'yes')
    tarifa = None
    if charge:
        tarifa = {'modelo': 'osm_charge', 'charge': charge, 'fonte': 'OSM', 'data': check, 'url': f'https://www.openstreetmap.org/node/{nid}'}
    return {
        'source_id': f'n{nid}',
        'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]},
        'name': name,
        'kind': 'portico' if is_gantry else 'praca',
        'props': {
            'osm_id': nid, 'operador': tags.get('operator'), 'rodovia': refs[0] if refs else None, 'rodovias': refs,
            'via_nome': next((w.get('name') for w in ways if w.get('name')), None),
            'oneway': oneway, 'way_bearings': [round(b, 1) for b in wb], 'direction_raw': tags.get('direction'),
            'charged_headings': [round(h, 1) for h in heads], 'direction_method': method,
            'free_flow': is_gantry or 'free flow' in (name or '').lower(),
            'charge_raw': charge_raw, 'check_date': check, 'payment': payment,
            'payment_cash': tags.get('payment:cash'), 'tarifa': tarifa,
        },
    }


def _from_pbf(path: str) -> list[dict]:
    import osmium
    print(f'  lendo {path}')
    tolls: dict[int, tuple[float, float, dict]] = {}
    fp = osmium.FileProcessor(path, osmium.osm.NODE).with_filter(osmium.filter.TagFilter(('barrier', 'toll_booth'), ('highway', 'toll_gantry')))
    for n in fp:
        if not n.location.valid():
            continue
        tolls[n.id] = (n.location.lon, n.location.lat, {t.k: t.v for t in n.tags})
    print(f'  {len(tolls)} nós de pedágio')
    ids = set(tolls)
    ways: dict[int, list[dict]] = {i: [] for i in ids}
    need: set[int] = set()
    pending: list[tuple[int, int, int | None, int | None, dict]] = []
    fp = osmium.FileProcessor(path, osmium.osm.WAY).with_filter(osmium.filter.KeyFilter('highway'))
    for w in fp:
        refs = [nd.ref for nd in w.nodes]
        hit = [i for i, r in enumerate(refs) if r in ids]
        if not hit:
            continue
        tags = {t.k: t.v for t in w.tags}
        hw = tags.get('highway', '')
        ow = tags.get('oneway')
        oneway = ow in ('yes', '1', 'true', '-1') or (hw in ('motorway', 'motorway_link') and ow != 'no') or tags.get('junction') == 'roundabout'
        info = {'way_id': w.id, 'ref': tags.get('ref'), 'name': tags.get('name'), 'highway': hw, 'oneway': oneway, 'reverse': ow == '-1'}
        for i in hit:
            prv = refs[i - 1] if i > 0 else None
            nxt = refs[i + 1] if i < len(refs) - 1 else None
            for x in (prv, nxt):
                if x is not None:
                    need.add(x)
            pending.append((refs[i], w.id, prv, nxt, info))
    loc: dict[int, tuple[float, float]] = {i: (v[0], v[1]) for i, v in tolls.items()}
    if need - set(loc):
        fp = osmium.FileProcessor(path, osmium.osm.NODE).with_filter(osmium.filter.IdFilter(need - set(loc)))
        for n in fp:
            if n.location.valid():
                loc[n.id] = (n.location.lon, n.location.lat)
    for nid, wid, prv, nxt, info in pending:
        a = loc.get(prv) if prv is not None else loc[nid]
        b = loc.get(nxt) if nxt is not None else loc[nid]
        brg = bearing(a, b) if a and b and a != b else None
        if brg is not None and info['reverse']:
            brg = (brg + 180) % 360
        ways[nid].append({**info, 'bearing': brg})
    return [_feature(i, v[0], v[1], v[2], ways.get(i, [])) for i, v in tolls.items()]


def _from_overpass() -> list[dict]:
    q = f"""[out:json][timeout:300];
(node["barrier"="toll_booth"]({BBOX}); node["highway"="toll_gantry"]({BBOX}););
out body;
way(bn)["highway"];
out tags geom;"""
    print(f'  Overpass ({OVERPASS}) bbox {BBOX}')
    d = json.loads(http_get(OVERPASS + '?data=' + __import__('urllib.parse').parse.quote(q), cache='osm_toll_overpass.json', max_age_h=24 * 7, timeout=400))
    nodes = {e['id']: e for e in d['elements'] if e['type'] == 'node'}
    ways: dict[int, list[dict]] = {i: [] for i in nodes}
    for e in d['elements']:
        if e['type'] != 'way':
            continue
        tags = e.get('tags', {})
        hw = tags.get('highway', '')
        ow = tags.get('oneway')
        oneway = ow in ('yes', '1', 'true', '-1') or (hw in ('motorway', 'motorway_link') and ow != 'no') or tags.get('junction') == 'roundabout'
        geom = [(g['lon'], g['lat']) for g in e.get('geometry', [])]
        for i, nid in enumerate(e.get('nodes', [])):
            if nid in nodes and geom:
                a = geom[max(i - 1, 0)]
                b = geom[min(i + 1, len(geom) - 1)]
                brg = bearing(a, b) if a != b else None
                if brg is not None and ow == '-1':
                    brg = (brg + 180) % 360
                ways[nid].append({'way_id': e['id'], 'ref': tags.get('ref'), 'name': tags.get('name'), 'highway': hw, 'oneway': oneway, 'bearing': brg})
    return [_feature(i, n['lon'], n['lat'], n.get('tags', {}), ways.get(i, [])) for i, n in nodes.items()]


def fetch():
    p = _pbf_path()
    feats = _from_pbf(p) if p else _from_overpass()
    # convenção de `direction`: confere nos nós de vias de mão única (rumo da via x rumo cobrado)
    agree = disagree = 0
    for f in feats:
        pr = f['props']
        if pr['oneway'] and pr['direction_method'] == 'degrees' and pr['way_bearings'] and pr['charged_headings']:
            wb = pr['way_bearings'][0]
            d = min(min(abs(h - wb) % 360, 360 - abs(h - wb) % 360) for h in pr['charged_headings'])
            if d <= 60:
                agree += 1
            elif d >= 120:
                disagree += 1
    print(f'  convenção direction (mão única): {agree} concordam com "cabine olha para o tráfego", {disagree} ao contrário')
    global NOTES
    NOTES = (NOTES + f' Convenção direction conferida em vias de mão única: {agree} a favor, {disagree} contra.')
    return feats
