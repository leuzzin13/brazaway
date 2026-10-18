"""Restrições físicas gravadas em NÓS do OpenStreetMap, que o Valhalla 3.9 ignora (issue valhalla#3487).

O Valhalla só lê maxheight/maxweight/maxwidth em vias (ways). Quando o mapeador grava o limite num nó
(barrier=height_restrictor, portal, cancela, ponto da via sob o viaduto) a rota passa por cima dele.
Este importador lê o PBF local (o mesmo usado para gerar os tiles do Valhalla) e, para cada nó de via
trafegável por caminhão com maxheight / maxheight:physical / maxweight / maxwidth, grava:
  - geometria: o ponto do nó;
  - props.lines: o trecho da via que passa pelo nó (até LIMITE_M para cada lado, parando no próximo
    cruzamento ou no fim da via), já no sentido de circulação. A API transforma esses trechos em
    linear_cost_factors só para veículos acima do limite (bloqueio só da via, não das travessias).

Licença: ODbL 1.0 (dado derivado do próprio OSM, usado junto do roteamento OSM). Nada volta para o OSM.
PBF: $OSM_PBF ou o primeiro data/valhalla/*.osm.pbf (o mesmo que o container do Valhalla baixou).
Precisa do pacote Python `osmium` (pyosmium, em importers/requirements.txt).
"""
from __future__ import annotations
import glob, math, os, re, time
from common import DATA_DIR, osm_pbf

LAYER_ID = 'altura_osm'
SOURCE = 'osm'
SOURCE_URL = 'https://download.geofabrik.de/south-america/brazil/sudeste.html (PBF local em data/valhalla)'
LICENSE = 'ODbL 1.0 — © colaboradores do OpenStreetMap'
NOTES = ('Nós de via com maxheight/maxheight:physical/maxweight/maxwidth (inclui barrier=height_restrictor com valor). '
         'O Valhalla ignora restrições em nós; a API aplica linear_cost_factors no trecho da via para veículos acima do limite.')

# classes de via com acesso de caminhão no graph.lua do Valhalla 3.9.1 (truck_forward = true)
DRIVABLE = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
            'tertiary', 'tertiary_link', 'unclassified', 'residential', 'residential_link', 'living_street', 'service', 'road', 'track'}
MAJOR = {'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
         'tertiary', 'tertiary_link'}
LIMITE_M = 60.0      # extensão do trecho penalizado para cada lado do nó
PASSO_M = 20.0       # densificação: o routing.ts mede sobreposição pelos vértices (até 40 por linha); 20 m basta e deixa a comparação leve
NO_SIGN = {'default', 'none', 'no_indications', 'no', 'unsigned'}
# nós cujo maxweight NÃO é restrição de trânsito (capacidade de balança, heliponto, elevador, balsa...)
NOT_TRAFFIC = ('amenity', 'aeroway', 'ferry', 'public_transport', 'man_made')


def pbf_path() -> str:
    p = osm_pbf()
    if not p:
        raise FileNotFoundError('PBF não encontrado: defina OSM_PBF ou gere data/osm/sse_co.osm.pbf')
    return p


# ---------- leitura de valores (corrige os casos que o Valhalla lê errado) ----------
# Alternativas da MAIS LONGA para a mais curta: o regex tenta na ordem e 'm' casaria antes de 'metros' (sobraria 'etros'
# e o valor viraria None); idem 'in' antes de 'inches' e "'" antes de "''".
_LEN_RE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(metros?|meters?|metres?|mts?|cm|m|feet|foot|ft|inches|inch|in|''|'|\")?", re.I)


def parse_length(v: str | None) -> float | None:
    """'4.5', '4,5', '4.5 m', '4,5 metros', '450 cm', 14'6\", 12 inches -> metros. 'default', 'none', texto -> None.
    Casos conferidos em importers/tests/test_osm_altura.py."""
    if not v:
        return None
    s = v.strip().lower()
    if s in NO_SIGN or s == 'below_default':
        return None
    try:
        return round(float(s.replace(',', '.')), 2)
    except ValueError:
        pass
    total, n, pos = 0.0, 0, 0
    for m in _LEN_RE.finditer(s):
        if s[pos:m.start()].strip():
            return None
        pos = m.end()
        num = float(m.group(1).replace(',', '.'))
        unit = (m.group(2) or 'm').lower()
        if unit in ('m', 'mt', 'mts', 'meter', 'meters', 'metre', 'metres', 'metro', 'metros'):
            total += num
        elif unit == 'cm':
            total += num / 100
        elif unit in ('ft', 'feet', 'foot', "'"):
            total += num * 0.3048
        elif unit in ('in', 'inch', 'inches', '"', "''"):
            total += num * 0.0254
        n += 1
    if n == 0 or s[pos:].strip():
        return None
    return round(total, 2)


def parse_weight(v: str | None) -> tuple[float | None, str | None]:
    """maxweight -> (toneladas, problema). Número sem unidade = t (padrão OSM); vírgula decimal aceita.
    Devolve problema != None quando o valor é suspeito (não usamos para bloquear)."""
    if not v:
        return None, None
    s = re.sub(r'\s+', '', v.strip().lower())
    if s in NO_SIGN:
        return None, None
    m = re.fullmatch(r'(\d+(?:[.,]\d+)?)(t|ton|tons|tonne|tonnes|kg|lb|lbs|st)?', s)
    if not m:
        return None, 'formato não reconhecido'
    num = float(m.group(1).replace(',', '.'))
    unit = m.group(2) or 't'
    t = num / 1000 if unit == 'kg' else num / 2000 if unit in ('lb', 'lbs') else num * 0.907 if unit == 'st' else num
    if unit == 't' and m.group(2) is None and num >= 200:
        return None, 'número sem unidade muito alto (provável kg)'
    if t < 1:
        return round(t, 3), 'menor que 1 t'
    return round(t, 2), None


def valhalla_weight(v: str | None) -> float | None:
    """Reproduz normalize_weight do graph.lua (Valhalla 3.9.1): vírgula NÃO é tratada ('3,5' vira 3)."""
    if not v:
        return None
    w = re.sub(r'\s+', '', v)
    m = re.match(r'\d+(\.\d+)?', w)
    if not m:
        return None
    num = m.group(0)
    f = float(num)
    for suf, div in (('t', 1), ('tonne', 1), ('tonnes', 1), ('ton', 1), ('tons', 1), ('lb', 2000), ('lbs', 2000), ('kg', 1000)):
        if w == num + suf:
            return round(f / div, 2)
    return round(f, 2)


def fmt(x: float, unit: str) -> str:
    s = f'{x:.2f}'.rstrip('0').rstrip('.')
    return s.replace('.', ',') + f' {unit}'


# ---------- geometria ----------
def dist_m(a, b) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    dx = (b[0] - a[0]) * 111320.0 * math.cos(lat)
    dy = (b[1] - a[1]) * 110574.0
    return math.hypot(dx, dy)


def interp(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)


def walk(coords, stops, i, step, limit):
    """Anda pela via a partir do índice i (sentido step=+1/-1) até `limit` metros ou até um nó de parada
    (cruzamento/fim de via). Devolve a lista de coordenadas percorridas a partir de coords[i] (inclusive)."""
    out = [coords[i]]
    acc = 0.0
    j = i
    while 0 <= j + step < len(coords):
        a, b = coords[j], coords[j + step]
        d = dist_m(a, b)
        if acc + d >= limit:
            out.append(interp(a, b, (limit - acc) / d if d else 0))
            return out
        out.append(b)
        acc += d
        j += step
        if stops[j]:
            return out
    return out


def densify(coords, step=PASSO_M):
    out = [coords[0]]
    for a, b in zip(coords, coords[1:]):
        d = dist_m(a, b)
        n = int(d // step)
        for k in range(1, n + 1):
            if k * step < d:
                out.append(interp(a, b, k * step / d))
        out.append(b)
    return [[round(x, 7), round(y, 7)] for x, y in out]


def length_m(coords) -> float:
    return sum(dist_m(a, b) for a, b in zip(coords, coords[1:]))


def oneway_dir(tags) -> int:
    """1 = só no sentido da via, -1 = só contra, 0 = mão dupla (regra do graph.lua do Valhalla)."""
    ow = (tags.get('oneway') or '').lower()
    if ow == '-1':
        return -1
    if ow in ('yes', 'true', '1') or tags.get('junction') in ('roundabout', 'circular'):
        return 1
    return 0


# ---------- leitura do PBF ----------
def _tags(o) -> dict:
    return {t.k: t.v for t in o.tags}


def node_restrictions(tags: dict) -> dict | None:
    """Limites do nó (só os que valem como restrição de trânsito)."""
    hs = [x for x in (parse_length(tags.get('maxheight')), parse_length(tags.get('maxheight:physical'))) if x is not None]
    ws = [x for x in (parse_length(tags.get('maxwidth')), parse_length(tags.get('maxwidth:physical'))) if x is not None]
    weight, wprob = (None, None)
    if not any(k in tags for k in NOT_TRAFFIC) and tags.get('highway') != 'elevator':
        weight, wprob = parse_weight(tags.get('maxweight'))
    out = {
        'max_height_m': min(hs) if hs else None,
        'max_width_m': min(ws) if ws else None,
        'max_weight_t': weight if weight is not None and not wprob else None,
        'weight_problem': wprob,
    }
    # valores físicos impossíveis viram "suspeito" e não bloqueiam
    if out['max_height_m'] is not None and not (0.5 <= out['max_height_m'] <= 15):
        out['height_problem'] = 'valor fora da faixa 0,5–15 m'
        out['max_height_m'] = None
    if out['max_width_m'] is not None and not (0.3 <= out['max_width_m'] <= 15):
        out['max_width_m'] = None
    if out['max_height_m'] is None and out['max_width_m'] is None and out['max_weight_t'] is None:
        return None
    return out


def fetch():
    import osmium
    from osmium.filter import KeyFilter, IdFilter
    pbf = pbf_path()
    t0 = time.time()
    print(f'  PBF: {pbf}')

    # 1) nós com limite
    targets: dict[int, dict] = {}
    fp = osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(
        KeyFilter('maxheight', 'maxheight:physical', 'maxweight', 'maxwidth', 'maxwidth:physical', 'barrier'))
    for n in fp:
        tags = _tags(n)
        if not any(k in tags for k in ('maxheight', 'maxheight:physical', 'maxweight', 'maxwidth', 'maxwidth:physical')):
            continue
        r = node_restrictions(tags)
        if r:
            targets[n.id] = {'lon': n.location.lon, 'lat': n.location.lat, 'tags': tags, 'r': r}
    print(f'  nós com limite numérico: {len(targets)} ({time.time()-t0:.0f}s)')

    # 2) vias trafegáveis que passam pelos nós
    cand: dict[int, dict] = {}
    for w in osmium.FileProcessor(pbf, osmium.osm.WAY).with_filter(KeyFilter('highway')):
        hw = w.tags.get('highway')
        if hw not in DRIVABLE:
            continue
        refs = [n.ref for n in w.nodes]
        if any(r in targets for r in refs):
            cand[w.id] = {'refs': refs, 'tags': _tags(w)}
    need = {r for c in cand.values() for r in c['refs']}
    print(f'  vias candidatas: {len(cand)} ({time.time()-t0:.0f}s)')

    # 3) quais desses nós são cruzamentos (compartilhados por 2+ vias trafegáveis) ou fim de via
    uses: dict[int, int] = {}
    ends: set[int] = set()
    for w in osmium.FileProcessor(pbf, osmium.osm.WAY).with_filter(KeyFilter('highway')):
        if w.tags.get('highway') not in DRIVABLE:
            continue
        nodes = w.nodes
        for n in nodes:
            if n.ref in need:
                uses[n.ref] = uses.get(n.ref, 0) + 1
        if len(nodes):
            for r in (nodes[0].ref, nodes[len(nodes) - 1].ref):
                if r in need:
                    ends.add(r)
    print(f'  cruzamentos mapeados ({time.time()-t0:.0f}s)')

    # 4) coordenadas dos nós das vias candidatas
    loc: dict[int, tuple[float, float]] = {}
    for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(IdFilter(need)):
        loc[n.id] = (n.location.lon, n.location.lat)
    print(f'  coordenadas: {len(loc)} ({time.time()-t0:.0f}s)')

    out = []
    off_road = 0
    for nid, t in targets.items():
        lines = []
        ways_meta = []
        for wid, c in cand.items():
            refs = c['refs']
            if nid not in refs or any(r not in loc for r in refs):
                continue
            coords = [loc[r] for r in refs]
            stops = [uses.get(r, 0) >= 2 or r in ends for r in refs]
            for i, r in enumerate(refs):
                if r != nid:
                    continue
                back = walk(coords, stops, i, -1, LIMITE_M)
                fwd = walk(coords, stops, i, +1, LIMITE_M)
                piece = list(reversed(back)) + fwd[1:]
                if len(piece) < 2 or length_m(piece) < 2:
                    continue
                d = oneway_dir(c['tags'])
                if d == -1:
                    piece = list(reversed(piece))
                lines.append({'way_id': wid, 'oneway': d != 0, 'coords': densify(piece)})
            tg = c['tags']
            ways_meta.append({'way_id': wid, 'highway': tg.get('highway'), 'name': tg.get('name') or tg.get('ref'),
                              'way_maxheight': tg.get('maxheight'), 'way_maxweight': tg.get('maxweight')})
        if not lines:
            off_road += 1
            continue
        tags, r = t['tags'], t['r']
        barrier = tags.get('barrier')
        road = next((w['name'] for w in ways_meta if w['name']), None)
        if r['max_height_m'] is not None:
            kind = 'limitador_altura' if barrier == 'height_restrictor' else 'altura'
        elif r['max_weight_t'] is not None:
            kind = 'peso'
        else:
            kind = 'largura'
        label = {'limitador_altura': 'Limitador de altura', 'altura': 'Altura máxima', 'peso': 'Peso máximo', 'largura': 'Largura máxima'}[kind]
        val = r['max_height_m'] if kind in ('limitador_altura', 'altura') else r['max_weight_t'] if kind == 'peso' else r['max_width_m']
        name = f"{label} {fmt(val, 't' if kind == 'peso' else 'm')}" + (f' — {road}' if road else '')
        out.append({
            'source_id': f'n{nid}',
            'geometry': {'type': 'Point', 'coordinates': [round(t['lon'], 7), round(t['lat'], 7)]},
            'name': name,
            'kind': kind,
            'props': {
                'osm_node': nid, 'osm_url': f'https://www.openstreetmap.org/node/{nid}',
                'max_height_m': r['max_height_m'], 'max_weight_t': r['max_weight_t'], 'max_width_m': r['max_width_m'],
                'barrier': barrier, 'access': tags.get('access'),
                'tags': {k: v for k, v in tags.items() if k in ('maxheight', 'maxheight:physical', 'maxweight', 'maxwidth',
                                                                'maxwidth:physical', 'barrier', 'access', 'name', 'ref', 'level', 'layer', 'note', 'source')},
                'ways': ways_meta,
                'lines': lines,
                'fonte': 'OpenStreetMap (nó)',
            },
        })
    print(f'  feições: {len(out)}; nós fora de via trafegável: {off_road} ({time.time()-t0:.0f}s)')
    return out
