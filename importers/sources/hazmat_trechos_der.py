"""Trechos de rodovias estaduais de SP proibidos para veículos com produtos perigosos (portarias do DER-SP).

Fonte das regras: data/raw/hazmat/trechos_rodovias_pp.csv (curado; cada linha conferida no texto publicado no DOE-SP).
Georreferenciamento: Malha Rodoviária Estadual da CETESB (ArcGIS, eixo com km inicial/final por segmento); o km da
portaria é interpolado linearmente ao longo da geometria do segmento. Depois o trecho é CASADO com a malha viária do
Valhalla (OSM) nos dois sentidos (trace_route map_snap) e cada traçado é validado no edge walk de linear_cost_factors
(props.osm = {tileset, lines: [{dir, coords}]}); a API usa esses traçados como costLines (só a via, não as travessias).

Também consulta a busca do DOE-SP ("produtos perigosos" + DER) e lista em NOTES portarias do DER que não estão no CSV,
para revisão manual (não entram automaticamente: o texto precisa ser lido antes).

Funções de casamento com o Valhalla (match_line, lcf_ok...) são reaproveitadas por hazmat_minianel_vias.py.
"""
from __future__ import annotations

import csv
import json
import math
import os
import re
import time
import urllib.parse

import requests

from common import DATA_DIR, UA, http_get

LAYER_ID = 'perigosos'
SOURCE = 'der-sp'
SOURCE_URL = ('https://doe.sp.gov.br (Portarias PR/DER-164/2025 e SUP/DER-062/2024) + '
              'https://arcgis.cetesb.sp.gov.br/server/rest/services/Hosted/Malha_Rodovi%C3%A1ria_Estadual_SP/FeatureServer/0')
LICENSE = ('Regras: atos oficiais (Lei 9.610/98 art. 8º IV). Geometria: CETESB Malha Rodoviária Estadual (licença não declarada, '
           'AccessConstraints NONE — atribuir) + traçado casado com o OSM (ODbL, © OpenStreetMap contributors)')
NOTES = ''

VALHALLA_URL = os.environ.get('VALHALLA_URL', 'http://valhalla:8002').rstrip('/')
CETESB_MALHA = 'https://arcgis.cetesb.sp.gov.br/server/rest/services/Hosted/Malha_Rodovi%C3%A1ria_Estadual_SP/FeatureServer/0/query'
CSV_PATH = DATA_DIR / 'raw' / 'hazmat' / 'trechos_rodovias_pp.csv'

# -----------------------------------------------------------------------------------------------------------------
# geometria
# -----------------------------------------------------------------------------------------------------------------


def dist_m(a, b) -> float:
    la = math.radians((a[1] + b[1]) / 2)
    return math.hypot((b[0] - a[0]) * math.cos(la), b[1] - a[1]) * math.pi / 180 * 6371000


def length_m(cs) -> float:
    return sum(dist_m(cs[i], cs[i + 1]) for i in range(len(cs) - 1))


def cut_line(cs, f0: float, f1: float):
    """Pedaço da linha entre as frações f0 e f1 do comprimento (0..1)."""
    total = length_m(cs)
    s0, s1 = f0 * total, f1 * total
    out, acc = [], 0.0
    for i in range(len(cs) - 1):
        a, b = cs[i], cs[i + 1]
        d = dist_m(a, b)
        if d == 0:
            continue
        if not out and acc + d >= s0:
            t = (s0 - acc) / d
            out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
        if out:
            if acc + d >= s1:
                t = (s1 - acc) / d
                out.append([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
                return out
            out.append(list(b))
        acc += d
    return out


def densify(cs, step=40.0):
    out = [list(cs[0])]
    for i in range(len(cs) - 1):
        a, b = cs[i], cs[i + 1]
        n = max(1, int(dist_m(a, b) // step))
        for k in range(1, n + 1):
            out.append([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n])
    return out


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

# -----------------------------------------------------------------------------------------------------------------
# Valhalla
# -----------------------------------------------------------------------------------------------------------------


def vpost(path: str, body: dict, timeout=120):
    r = requests.post(f'{VALHALLA_URL}{path}', json=body, headers=UA, timeout=timeout)
    try:
        j = r.json()
    except ValueError:
        j = {'error': r.text[:200]}
    return r.status_code, j


def valhalla_tileset() -> int | None:
    try:
        return requests.get(f'{VALHALLA_URL}/status', headers=UA, timeout=10).json().get('tileset_last_modified')
    except Exception:
        return None


def match_line(coords, costing='truck', radius=50, accuracy=15):
    """Casa a linha com a malha (trace_route map_snap). Devolve os traçados casados (um por perna) ou None."""
    shape = [{'lon': x, 'lat': y} for x, y in densify(coords)]
    st, j = vpost('/trace_route', {'shape': shape, 'costing': costing, 'shape_match': 'map_snap',
                                   'trace_options': {'search_radius': radius, 'gps_accuracy': accuracy}})
    if st != 200 or 'trip' not in j:
        return None
    legs = [decode6(leg['shape']) for leg in j['trip']['legs']]
    legs = [lg for lg in legs if len(lg) >= 2 and length_m(lg) >= 5]
    if not legs:
        return None
    L, M = length_m(coords), sum(length_m(lg) for lg in legs)
    if M > L * 1.3 + 50 or M < L * 0.7 - 30:   # casou com outra via (contramão, alça) ou casamento ruim
        return None
    # exatamente os vértices devolvidos: o edge walk falha com qualquer ponto intermediário extra
    return [[[round(x, 6), round(y, 6)] for x, y in lg] for lg in legs]


PROBE = ({'lon': -46.6560, 'lat': -23.5614}, {'lon': -46.6450, 'lat': -23.5700})


def lcf_ok(lines) -> list[bool]:
    """Valida numa chamada /route real se cada traçado passa no edge walk de linear_cost_factors (bisseção em lote)."""
    def route_ok(batch):
        st, j = vpost('/route', {'locations': list(PROBE), 'costing': 'truck', 'directions_type': 'none',
                                 'linear_cost_factors': [{'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': c},
                                                          'properties': {'factor': 1.01}} for c in batch]})
        if st == 200:
            return True
        if j.get('error_code') == 233 or 'edge walk' in str(j.get('error', '')):
            return False
        raise RuntimeError(f'Valhalla /route {st}: {j}')

    res = [False] * len(lines)

    def rec(idx):
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

# -----------------------------------------------------------------------------------------------------------------
# km -> geometria (malha CETESB)
# -----------------------------------------------------------------------------------------------------------------


def cetesb_segments(rodovia: str) -> list[dict]:
    q = urllib.parse.urlencode({'where': f"rodovia = '{rodovia}'", 'outFields': 'rodovia,tiporodovi,kminicial,kmfinal,extensao,municipio,administra,descricaoi,descricaof,denominaca',
                                'f': 'geojson', 'outSR': '4326'})
    d = json.loads(http_get(f'{CETESB_MALHA}?{q}', cache=f'cetesb_malha_{rodovia.replace(" ", "")}.json', max_age_h=24 * 30))
    segs = []
    for f in d.get('features', []):
        p, g = f['properties'], f.get('geometry') or {}
        if (p.get('tiporodovi') or '').strip() != 'Eixo' or p.get('kminicial') is None or p.get('kmfinal') is None:
            continue
        cs = g.get('coordinates') or []
        if g.get('type') == 'MultiLineString':
            cs = [c for part in cs for c in part]
        if len(cs) >= 2:
            segs.append({'p': p, 'cs': [c[:2] for c in cs]})
    segs.sort(key=lambda s: s['p']['kminicial'])
    return segs


def line_by_km(segs: list[dict], km0: float, km1: float):
    """Linha entre km0 e km1: segmentos encadeados e orientados no sentido crescente do km; interpolação linear dentro do segmento."""
    chosen = [s for s in segs if s['p']['kmfinal'] > km0 and s['p']['kminicial'] < km1]
    if not chosen:
        return None, []
    # orientação: o fim de cada segmento é a ponta mais próxima do próximo segmento (ou a mais distante do anterior)
    oriented = []
    allsegs = segs
    for s in chosen:
        cs = s['cs']
        i = allsegs.index(s)
        nxt = allsegs[i + 1]['cs'] if i + 1 < len(allsegs) else None
        prv = allsegs[i - 1]['cs'] if i > 0 else None
        if nxt:
            dn_end = min(dist_m(cs[-1], nxt[0]), dist_m(cs[-1], nxt[-1]))
            dn_start = min(dist_m(cs[0], nxt[0]), dist_m(cs[0], nxt[-1]))
            if dn_start < dn_end:
                cs = cs[::-1]
        elif prv:
            dp_start = min(dist_m(cs[0], prv[0]), dist_m(cs[0], prv[-1]))
            dp_end = min(dist_m(cs[-1], prv[0]), dist_m(cs[-1], prv[-1]))
            if dp_end < dp_start:
                cs = cs[::-1]
        oriented.append((s['p'], cs))
    line, info = [], []
    for p, cs in oriented:
        a, b = p['kminicial'], p['kmfinal']
        f0 = max(0.0, (km0 - a) / (b - a))
        f1 = min(1.0, (km1 - a) / (b - a))
        part = cut_line(cs, f0, f1)
        if line and part and dist_m(line[-1], part[0]) < 1:
            part = part[1:]
        line += part
        info.append({'km': [a, b], 'extensao_km': p.get('extensao'), 'geom_m': round(length_m(cs)), 'administra': p.get('administra'),
                     'de': (p.get('descricaoi') or '').strip(), 'ate': (p.get('descricaof') or '').strip()})
    return [[round(x, 6), round(y, 6)] for x, y in line], info

# -----------------------------------------------------------------------------------------------------------------
# monitor do DOE-SP (só informa; não cria regra)
# -----------------------------------------------------------------------------------------------------------------


def doe_candidates(known_titles: set[str]) -> tuple[list[str], int]:
    """Publicações do DER-SP no DOE-SP (desde 2023) que citam "produtos perigosos" e falam em proibição.
    A busca do DOE é por qualquer termo; o filtro (órgão = DER, título = portaria, trecho com "proib") é feito aqui."""
    out, seen_known = [], 0
    try:
        for page in range(1, 41):
            q = [('periodStartingDate', 'personalized'), ('PageNumber', str(page)), ('FromDate', '2023-01-01'),
                 ('ToDate', time.strftime('%Y-%m-%d')), ('PageSize', '100'), ('SortField', 'Date'), ('Terms[0]', 'produtos perigosos')]
            url = 'https://do-api-web-search.doe.sp.gov.br/v2/advanced-search/publications?' + urllib.parse.urlencode(q)
            d = requests.get(url, headers={**UA, 'Accept': 'application/json'}, timeout=60).json()
            for it in d.get('items', []):
                t, h, ex = it.get('title', ''), it.get('hierarchy', ''), it.get('excerpt', '') or ''
                if 'Estradas de Rodagem' not in h or not re.search(r'(?i)portaria', t):
                    continue
                if any(k in t for k in known_titles):
                    seen_known += 1
                    continue
                if re.search(r'(?i)proib', ex):
                    out.append(f"{it.get('date', '')[:10]} {t.strip()} ({it.get('slug')})")
            if not d.get('hasNextPage'):
                break
    except Exception as e:  # monitor é opcional
        out.append(f'(busca no DOE-SP falhou: {e})')
    return out, seen_known

# -----------------------------------------------------------------------------------------------------------------


def fetch():
    global NOTES
    rows = list(csv.DictReader(open(CSV_PATH, encoding='utf-8')))
    tileset = valhalla_tileset()
    feats, notes = [], []
    for r in rows:
        km0, km1 = float(r['km_ini']), float(r['km_fim'])
        segs = cetesb_segments(r['cetesb_rodovia'])
        line, info = line_by_km(segs, km0, km1)
        if not line or len(line) < 2:
            notes.append(f"{r['id']}: km {km0}-{km1} não encontrado na malha CETESB")
            continue
        km_txt = f"km {str(km0).replace('.', ',')}–{str(km1).replace('.', ',')}"
        props = {
            'rodovia': r['rodovia'], 'denominacao': r['denominacao'], 'km_ini': km0, 'km_fim': km1, 'municipio': r['municipio'],
            'sentidos': r['sentidos'], 'regra': 'Proibida a circulação de veículos transportando produtos perigosos',
            'janela': '24h, todos os dias', 'norma': r['norma'], 'artigo': r['artigo'], 'publicacao': r['publicacao'], 'url': r['url'],
            'excecoes': r['excecoes'], 'motivo': r['motivo'],
            'geometria_fonte': 'CETESB Malha Rodoviária Estadual; km interpolado linearmente no segmento', 'segmentos_cetesb': info,
            'comprimento_m': round(length_m(line)),
        }
        if tileset:
            lines = []
            for d, cs in (('fwd', line), ('rev', line[::-1])):
                legs = match_line(cs)
                if legs:
                    lines += [{'dir': d, 'coords': lg} for lg in legs]
                else:
                    notes.append(f"{r['id']} {d}: não casou com a malha do Valhalla")
            ok = lcf_ok([lg['coords'] for lg in lines]) if lines else []
            props['osm'] = {'tileset': tileset, 'lines': [lg for lg, good in zip(lines, ok) if good]}
            bad = len(lines) - len(props['osm']['lines'])
            if bad:
                notes.append(f"{r['id']}: {bad} traçado(s) reprovado(s) no edge walk")
            props['comprimento_osm_m'] = {lg['dir']: round(length_m(lg['coords'])) for lg in props['osm']['lines']}
        else:
            notes.append('Valhalla indisponível: sem props.osm (a API casa os traçados em tempo de execução)')
        mid = line[len(line) // 2]
        feats.append({
            'source_id': r['id'], 'geometry': {'type': 'LineString', 'coordinates': line},
            'name': f"{r['rodovia']} {km_txt} ({r['municipio']})", 'kind': 'trecho_proibido', 'props': {**props, 'ponto_medio': mid},
            'valid_from': None, 'valid_to': None,
        })
        print(f"    {r['id']}: {props['comprimento_m']} m (CETESB), osm={props.get('comprimento_osm_m')}")
    cand, seen_known = doe_candidates({r['norma'].replace('Portaria ', '') for r in rows})
    print(f'    DOE-SP: {seen_known} publicação(ões) das portarias já cadastradas; {len(cand)} candidata(s) nova(s)')
    if cand:
        notes.append('DOE-SP: portarias do DER com "produtos perigosos" e "proibida" fora do CSV (ler e, se for o caso, '
                      'acrescentar em data/raw/hazmat/trechos_rodovias_pp.csv): ' + ' | '.join(cand[:15]))
    NOTES = '; '.join(notes) or None
    for n in notes:
        print('    !', n[:400])
    return feats
