"""Faixas exclusivas de ônibus da cidade de São Paulo (GeoSampa, camada geoportal:faixa_onibus, levantamento CET).

O que faz:
  1. baixa os ~7,4 mil segmentos (EPSG:4326) e interpreta o horário em texto livre
     ("2ª a 6ª das 06-09h(C) e das 17-20h(B); Sáb. das 06-14h", "INTEGRAL", ...) em janelas semanais;
  2. junta segmentos contíguos do mesmo logradouro com o mesmo tipo/lado/sentido/horário (linemerge);
  3. descobre o sentido de cada janela (C = sentido centro, B = bairro, N/S/L/O, ou "sentido único" da faixa)
     em relação à orientação da linha;
  4. se o Valhalla estiver acessível (VALHALLA_URL, padrão http://valhalla:8002), casa cada linha com a malha
     viária (trace_route map_snap) e guarda o traçado casado em props.osm — só esse traçado "anda" sobre as
     arestas (edge walk) e pode ir para linear_cost_factors. Cada traçado é validado numa chamada /route real.

LICENÇA: a geometria e os atributos são do GeoSampa (CC-BY-SA 4.0). O traçado em props.osm é derivado do
OpenStreetMap (ODbL) — serve só como endereço das arestas no Valhalla, não é exibido nem exportado.
"""
from __future__ import annotations

import json
import math
import os
import re
import time

import requests

from common import UA, http_get, stable_id

LAYER_ID = 'corredores_onibus'
SOURCE = 'geosampa-faixa'
SOURCE_URL = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs (typeNames=geoportal:faixa_onibus)'
LICENSE = 'CC-BY-SA 4.0 — GeoSampa/Prefeitura de São Paulo (levantamento CET); props.osm derivado do OpenStreetMap (ODbL)'
NOTES = ('Segmentos contíguos unidos por logradouro/tipo/lado/sentido/horário. Horário vem de texto livre da CET '
         '(tx_horario_funcionamento); sentido C/B inferido pela distância ao Marco Zero. props.osm = traçado casado '
         'com a malha do Valhalla (válido só para o tileset registrado em props.osm.tileset).')

WFS = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs'
VALHALLA_URL = os.environ.get('VALHALLA_URL', 'http://valhalla:8002').rstrip('/')
MARCO_ZERO = (-46.633956, -23.550385)  # Praça da Sé — referência de "sentido centro"/"sentido bairro"

# ---------------------------------------------------------------------------------------------------------------
# GeoSampa WFS
# ---------------------------------------------------------------------------------------------------------------

def wfs_geojson(type_name: str, cache: str, max_age_h: float = 24 * 7) -> dict:
    """GetFeature completo (GeoJSON, EPSG:4326). O servidor devolve até 30.000 feições por requisição."""
    url = (f'{WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=geoportal:{type_name}'
           f'&outputFormat=application/json&srsName=EPSG:4326&count=30000')
    d = json.loads(http_get(url, cache=cache, max_age_h=max_age_h))
    matched = d.get('numberMatched')
    if isinstance(matched, int) and matched > len(d.get('features', [])):
        raise RuntimeError(f'{type_name}: {matched} feições, só {len(d["features"])} vieram (paginar)')
    return d


# ---------------------------------------------------------------------------------------------------------------
# Horários em texto livre → janelas semanais {days: [1..7], from: "HH:MM", to: "HH:MM", tag?: "CENTRO"|...}
# ---------------------------------------------------------------------------------------------------------------

DAY_SETS = [
    (re.compile(r'^2ª\s*a\s*6ª'), [1, 2, 3, 4, 5]),
    (re.compile(r'^2ª\s*a\s*S[áa]b\.?', re.I), [1, 2, 3, 4, 5, 6]),
    (re.compile(r'^2ª\s*a\s*Dom\.?', re.I), [1, 2, 3, 4, 5, 6, 7]),
    (re.compile(r'^S[áa]b\.?', re.I), [6]),
    (re.compile(r'^Dom\.?', re.I), [7]),
]
TAGS = {'C': 'CENTRO', 'B': 'BAIRRO', 'N': 'NORTE', 'S': 'SUL', 'L': 'LESTE', 'O': 'OESTE'}
RANGE = re.compile(r'(\d{1,2})(?:[:h](\d{2}))?\s*-\s*(\d{1,2})(?:[:h](\d{2}))?\s*h?\s*(?:\(([A-Z])\))?')


def _hhmm(h: str, m: str | None) -> str:
    hh, mm = int(h), int(m or 0)
    if not (0 <= hh <= 24 and 0 <= mm < 60) or (hh == 24 and mm):
        raise ValueError(f'hora inválida {h}:{m}')
    return f'{hh:02d}:{mm:02d}'


def parse_horario(txt: str | None) -> list[dict] | None:
    """None = horário não interpretável (ex.: 'BLOQUEIO NA AV PAULISTA')."""
    t = (txt or '').strip()
    if not t or t.upper().startswith('BLOQUEIO'):
        return None
    out: list[dict] = []
    for part in (p.strip() for p in t.split(';')):
        if not part:
            continue
        m = re.match(r'^INTEGRAL\s*(?:\((\w)\))?$', part, re.I)
        if m:
            w = {'days': [1, 2, 3, 4, 5, 6, 7], 'from': '00:00', 'to': '24:00'}
            if m.group(1):
                w['tag'] = TAGS.get(m.group(1).upper(), m.group(1).upper())
            out.append(w)
            continue
        days, rest = None, ''
        for rx, ds in DAY_SETS:
            md = rx.match(part)
            if md:
                days, rest = ds, part[md.end():]
                break
        if days is None:
            return None
        ranges = list(RANGE.finditer(rest))
        if not ranges:
            return None
        for r in ranges:
            w = {'days': days, 'from': _hhmm(r.group(1), r.group(2)), 'to': _hhmm(r.group(3), r.group(4))}
            if r.group(5):
                w['tag'] = TAGS.get(r.group(5), r.group(5))
            out.append(w)
    return out or None


# ---------------------------------------------------------------------------------------------------------------
# Geometria e sentido
# ---------------------------------------------------------------------------------------------------------------

def _xy(p, ref):
    return ((p[0] - ref[0]) * 111320 * math.cos(math.radians(ref[1])), (p[1] - ref[1]) * 110574)


def dist_m(a, b) -> float:
    x, y = _xy(b, a)
    return math.hypot(x, y)


def length_m(coords) -> float:
    return sum(dist_m(a, b) for a, b in zip(coords, coords[1:]))


def densify(coords, step=40.0):
    out = [coords[0]]
    for a, b in zip(coords, coords[1:]):
        d = dist_m(a, b)
        n = int(d // step)
        for i in range(1, n + 1):
            t = i * step / d
            if t >= 1:
                break
            out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
        out.append(b)
    return out


CARDINAL = {'NORTE': (0, 1), 'SUL': (0, -1), 'LESTE': (1, 0), 'OESTE': (-1, 0),
            'NORDESTE': (1, 1), 'NOROESTE': (-1, 1), 'SUDESTE': (1, -1), 'SUDOESTE': (-1, -1)}
# destinos nomeados que aparecem em tx_sentido_faixa_corredor (ponto aproximado do destino)
NAMED_TARGETS = {'CASTELO': (-46.79, -23.51), 'AIRTON SENNA': (-46.47, -23.49), 'INTERLAGOS': (-46.70, -23.70)}


def orientation(target: str | None, coords) -> str | None:
    """'fwd' se o sentido `target` é o da ordem dos vértices, 'rev' se o contrário, None se não dá para saber."""
    if not target:
        return None
    a, b = coords[0], coords[-1]
    L = max(length_m(coords), 1.0)
    if target in ('CENTRO', 'BAIRRO') or target in NAMED_TARGETS:
        ref = MARCO_ZERO if target in ('CENTRO', 'BAIRRO') else NAMED_TARGETS[target]
        diff = dist_m(a, ref) - dist_m(b, ref)        # > 0: a linha anda em direção à referência
        if abs(diff) < max(0.3 * L, 25):
            return None
        toward = diff > 0
        if target == 'BAIRRO':
            toward = not toward
        return 'fwd' if toward else 'rev'
    if target in CARDINAL:
        vx, vy = _xy(b, a)
        tx, ty = CARDINAL[target]
        n = math.hypot(vx, vy) * math.hypot(tx, ty)
        if n == 0:
            return None
        cos = (vx * tx + vy * ty) / n
        if abs(cos) < 0.35:
            return None
        return 'fwd' if cos > 0 else 'rev'
    return None


def windows_by_direction(windows: list[dict], sentido_via: str, sentido_faixa: str, coords) -> dict:
    """Distribui as janelas entre a orientação da geometria ('fwd'), a oposta ('rev') ou ambas ('both').
    Devolve {'fwd': [...], 'rev': [...], 'unknown': bool}."""
    res = {'fwd': [], 'rev': [], 'unknown': False}
    unico = (sentido_via or '').upper().startswith('ÚNICO') or (sentido_via or '').upper().startswith('UNICO')
    base = orientation((sentido_faixa or '').strip().upper() or None, coords) if unico else None
    for w in windows:
        tag = w.get('tag')
        o = orientation(tag, coords) if tag else None
        if unico:
            o = base or o
        if o is None:
            if unico or tag:
                res['unknown'] = True
            res['fwd'].append(w)
            res['rev'].append(w)
        else:
            res[o].append(w)
    return res


# ---------------------------------------------------------------------------------------------------------------
# Valhalla: casamento com a malha (props.osm) e validação do edge walk
# ---------------------------------------------------------------------------------------------------------------

def _post(path: str, body: dict, timeout=60):
    r = requests.post(f'{VALHALLA_URL}{path}', json=body, headers=UA, timeout=timeout)
    try:
        j = r.json()
    except ValueError:
        j = {'error': r.text[:200]}
    return r.status_code, j


def valhalla_tileset() -> int | None:
    try:
        r = requests.get(f'{VALHALLA_URL}/status', headers=UA, timeout=10)
        return r.json().get('tileset_last_modified')
    except Exception:
        return None


def decode6(s: str):
    idx = lat = lon = 0
    out = []
    while idx < len(s):
        vals = []
        for _ in range(2):
            shift = res = 0
            while True:
                b = ord(s[idx]) - 63
                idx += 1
                res |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]
        lon += vals[1]
        out.append([lon / 1e6, lat / 1e6])
    return out


def match_line(coords, costing='auto') -> list[list[list[float]]] | None:
    """Casa a linha com a malha (map_snap). Devolve os traçados casados (um por perna) ou None se não casou bem."""
    shape = [{'lon': x, 'lat': y} for x, y in densify(coords)]
    st, j = _post('/trace_route', {'shape': shape, 'costing': costing, 'shape_match': 'map_snap',
                                   'trace_options': {'search_radius': 25, 'gps_accuracy': 8}})
    if st != 200 or 'trip' not in j:
        return None
    legs = [decode6(leg['shape']) for leg in j['trip']['legs']]
    legs = [l for l in legs if len(l) >= 2 and length_m(l) >= 5]
    if not legs:
        return None
    L = length_m(coords)
    M = sum(length_m(l) for l in legs)
    # traçado casado muito diferente do original = sentido proibido (contramão) ou casamento ruim
    if M > L * 1.35 + 40 or M < L * 0.6 - 20:
        return None
    # exatamente os vértices devolvidos pelo Valhalla: o edge walk falha com qualquer ponto intermediário extra
    return [[[round(x, 6), round(y, 6)] for x, y in l] for l in legs]


def lcf_ok(lines: list[list[list[float]]], probe=((-46.6560, -23.5614), (-46.6450, -23.5700))) -> list[bool]:
    """Valida, numa chamada /route real (costing truck), se cada traçado passa no edge walk de linear_cost_factors.
    Em lote; se o lote falha, divide ao meio até achar os culpados."""
    def route_ok(batch):
        body = {'locations': [{'lon': probe[0][0], 'lat': probe[0][1]}, {'lon': probe[1][0], 'lat': probe[1][1]}],
                'costing': 'truck', 'directions_type': 'none',
                'linear_cost_factors': [{'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': c},
                                         'properties': {'factor': 1.01}} for c in batch]}
        st, j = _post('/route', body, timeout=120)
        if st == 200:
            return True
        if j.get('error_code') == 233 or 'edge walk' in str(j.get('error', '')):
            return False
        raise RuntimeError(f'Valhalla /route {st}: {j}')

    res = [False] * len(lines)

    def rec(idx: list[int]):
        if not idx:
            return
        if route_ok([lines[i] for i in idx]):
            for i in idx:
                res[i] = True
            return
        if len(idx) == 1:
            return
        mid = len(idx) // 2
        rec(idx[:mid])
        rec(idx[mid:])

    for s in range(0, len(lines), 200):
        rec(list(range(s, min(s + 200, len(lines)))))
    return res


# ---------------------------------------------------------------------------------------------------------------

KIND = {'EXCLUSIVA': 'faixa_exclusiva', 'REVERSÍVEL': 'faixa_reversivel', 'REVERSIVEL': 'faixa_reversivel',
        'PREFERENCIAL': 'faixa_preferencial', 'TEMPORARIA': 'faixa_temporaria', 'TEMPORÁRIA': 'faixa_temporaria'}


def _clean(s):
    return re.sub(r'\s+', ' ', (s or '').strip())


def fetch():
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import linemerge

    d = wfs_geojson('faixa_onibus', 'geosampa_faixa_onibus.json')
    groups: dict[tuple, list] = {}
    for f in d['features']:
        g = f.get('geometry') or {}
        if g.get('type') != 'LineString' or len(g.get('coordinates') or []) < 2:
            continue
        p = f['properties']
        key = (str(p.get('cd_logradouro') or ''), _clean(p.get('nm_logradouro_faixa_corredor')),
               _clean(p.get('nm_tipo_faixa_corredor')).upper(), _clean(p.get('tx_localizacao')).upper(),
               _clean(p.get('tx_sentido_via_cet')).upper(), _clean(p.get('tx_sentido_faixa_corredor')).upper(),
               _clean(p.get('tx_horario_funcionamento')))
        groups.setdefault(key, []).append(f)

    tileset = valhalla_tileset()
    use_valhalla = tileset is not None and os.environ.get('SKIP_VALHALLA') != '1'
    print(f'    {len(d["features"])} segmentos em {len(groups)} grupos; Valhalla: {"tileset " + str(tileset) if use_valhalla else "indisponível (sem props.osm)"}')

    feats = []
    for key, fs in groups.items():
        cd_log, logradouro, tipo, lado, sentido_via, sentido_faixa, horario = key
        lines = [[(round(x, 7), round(y, 7)) for x, y in f['geometry']['coordinates']] for f in fs]
        merged = linemerge(MultiLineString([LineString(l) for l in lines]))
        parts = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
        windows = parse_horario(horario)
        p0 = fs[0]['properties']
        ids = sorted(int(f['properties']['cd_identificador']) for f in fs)
        for part in parts:
            coords = [[round(x, 7), round(y, 7)] for x, y in part.coords]
            if len(coords) < 2:
                continue
            members = [f for f, l in zip(fs, lines) if part.distance(LineString(l).interpolate(0.5, normalized=True)) < 1e-6]
            mids = sorted(int(f['properties']['cd_identificador']) for f in members) or ids
            dirs = windows_by_direction(windows or [], sentido_via, sentido_faixa, coords)
            impl = sorted({(f['properties'].get('dt_implantacao_faixa') or '')[:10] for f in members if f['properties'].get('dt_implantacao_faixa')})
            feats.append({
                'source_id': stable_id('faixa', cd_log, tipo, lado, sentido_via, sentido_faixa, horario, mids[0], coords[0], coords[-1]),
                'geometry': {'type': 'LineString', 'coordinates': coords},
                'name': _clean(p0.get('nm_logradouro_faixa_corredor')) or None,
                'kind': KIND.get(tipo, 'faixa_exclusiva'),
                'props': {
                    'logradouro': logradouro, 'cd_logradouro': cd_log or None,
                    'denominacao': _clean(p0.get('nm_denominacao_faixa_corredor')) or None,
                    'tipo': tipo, 'lado': lado or None, 'sentido_via': sentido_via or None,
                    'sentido_faixa': sentido_faixa or None, 'horario': horario or None,
                    'windows': windows, 'horario_interpretado': windows is not None,
                    'dirs': {'fwd': dirs['fwd'], 'rev': dirs['rev']}, 'sentido_incerto': dirs['unknown'],
                    'inicio': _clean(p0.get('tx_inicio_logradouro')) or None, 'fim': _clean(p0.get('tx_fim_logradouro')) or None,
                    'distrito': _clean(p0.get('tx_distrito_faixa')) or None, 'programa': _clean(p0.get('tx_programa')) or None,
                    'implantacao': impl[0] if impl else None, 'segmentos': mids, 'comprimento_m': round(length_m(coords)),
                },
            })

    if use_valhalla:
        _attach_osm(feats, tileset)
    return feats


def _attach_osm(feats: list[dict], tileset: int) -> None:
    """props.osm = {tileset, lines: [{dir: 'fwd'|'rev', coords}]} para as faixas que podem virar linear_cost_factors."""
    t0 = time.time()
    todo = []   # (feat, dir, coords)
    for f in feats:
        p = f['props']
        if f['kind'] not in ('faixa_exclusiva', 'faixa_reversivel') or not p.get('windows'):
            continue
        coords = f['geometry']['coordinates']
        for d in ('fwd', 'rev'):
            if not p['dirs'][d]:
                continue
            cc = coords if d == 'fwd' else list(reversed(coords))
            todo.append((f, d, cc))
    matched = []
    swapped = 0
    for i, (f, d, cc) in enumerate(todo):
        legs = match_line(cc)
        p = f['props']
        unico = (p.get('sentido_via') or '').startswith(('ÚNICO', 'UNICO'))
        if not legs and unico and not (p['dirs']['fwd'] and p['dirs']['rev']):
            # faixa de sentido único cujo sentido inferido não casou: se o oposto casa, a via é mão única
            # no outro sentido e a faixa acompanha o tráfego → corrige o sentido pela malha
            other = 'rev' if d == 'fwd' else 'fwd'
            legs = match_line(list(reversed(cc)))
            if legs:
                p['dirs'][other], p['dirs'][d] = p['dirs'][d], []
                p['sentido_pela_malha'] = True
                d = other
                swapped += 1
        if legs:
            for leg in legs:
                matched.append((f, d, leg))
        if i and i % 500 == 0:
            print(f'      casamento: {i}/{len(todo)} ({time.time() - t0:.0f}s)')
    if swapped:
        print(f'      {swapped} faixa(s) de sentido único com o sentido corrigido pela malha')
    ok = lcf_ok([m[2] for m in matched]) if matched else []
    n_ok = 0
    for (f, d, leg), good in zip(matched, ok):
        if not good:
            continue
        n_ok += 1
        osm = f['props'].setdefault('osm', {'tileset': tileset, 'lines': []})
        osm['lines'].append({'dir': d, 'coords': leg})
    # sentido incerto numa via de mão única: só o sentido que casou fica com janelas
    for f in feats:
        p = f['props']
        if p.get('sentido_incerto') and p.get('osm'):
            dirs_ok = {l['dir'] for l in p['osm']['lines']}
            if len(dirs_ok) == 1:
                only = dirs_ok.pop()
                other = 'rev' if only == 'fwd' else 'fwd'
                p['dirs'][other] = []
                p['sentido_incerto'] = False
                p['sentido_pela_malha'] = True
    print(f'    casamento com a malha: {len(todo)} sentidos → {len(matched)} traçados, {n_ok} válidos no edge walk ({time.time() - t0:.0f}s)')
