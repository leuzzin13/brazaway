"""Rodovia + km -> ponto na malha SRE-MG (DER-MG), versão 2026_02 do Observatório da Infraestrutura (ArcGIS público).

Camada Hosted/sremg_2026_02 (item 'Sremg_Total', licença não declarada; a camada Balancas_V2 e outras do mesmo portal
declaram 'uso restrito DER-MG' e NÃO são usadas). Cada trecho tem rod, kmini, kmfim e a linha. O ponto do km é
interpolado pela fração (km − kmini)/(kmfim − kmini) ao longo da linha, com a linha orientada pelo trecho vizinho.
Trecho coincidente com outra rodovia aparece só sob a outra sigla: aí o km não é encontrado (None).
Usado por weigh_dermg.py (balanças sem coordenada) e toll_artemig.py (pórticos previstos, registro inativo).
"""
from __future__ import annotations
import json, math, urllib.parse
from common import http_get

SRE_URL = 'https://observatorio.infraestrutura.mg.gov.br/server/rest/services/Hosted/sremg_2026_02/FeatureServer/0'
ANO = '202602'


def _dist(a, b) -> float:
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def _coords(geom: dict) -> list[list[float]]:
    if not geom:
        return []
    if geom['type'] == 'LineString':
        return geom['coordinates']
    if geom['type'] == 'MultiLineString':
        out: list[list[float]] = []
        for part in geom['coordinates']:
            if out and part and _dist(out[-1], part[-1]) < _dist(out[-1], part[0]):
                part = part[::-1]
            out.extend(part)
        return out
    return []


def _along(coords: list[list[float]], frac: float) -> tuple[float, float]:
    segs = [_dist(a, b) for a, b in zip(coords, coords[1:])]
    total = sum(segs)
    if total <= 0:
        return coords[0][0], coords[0][1]
    target = max(0.0, min(1.0, frac)) * total
    acc = 0.0
    for (a, b), s in zip(zip(coords, coords[1:]), segs):
        if acc + s >= target and s > 0:
            t = (target - acc) / s
            return a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])
        acc += s
    return coords[-1][0], coords[-1][1]


class SreLocator:
    def __init__(self):
        self.cache: dict[str, list[dict]] = {}

    def segments(self, rod: str) -> list[dict]:
        rod = (rod or '').replace('-', '').replace(' ', '').upper()
        if rod not in self.cache:
            where = f"ano='{ANO}' and rod='{rod}'"
            url = (f'{SRE_URL}/query?where={urllib.parse.quote(where)}&outFields=rod,sremg,kmini,kmfim,sitfis,resp'
                   '&returnGeometry=true&outSR=4326&f=geojson')
            try:
                d = json.loads(http_get(url, cache=f'sremg_2026_02_{rod}.geojson', max_age_h=24 * 30))
            except Exception as e:  # noqa: BLE001
                print(f'  ! SRE-MG {rod}: {e}')
                d = {'features': []}
            segs = []
            for f in d.get('features', []):
                p = f.get('properties') or {}
                c = _coords(f.get('geometry'))
                if c and p.get('kmini') is not None and p.get('kmfim') is not None:
                    segs.append({'sremg': p.get('sremg'), 'kmini': float(p['kmini']), 'kmfim': float(p['kmfim']), 'coords': c, 'resp': p.get('resp')})
            self.cache[rod] = segs
        return self.cache[rod]

    def locate(self, rod: str, km: float) -> tuple[float, float, str] | None:
        """(lon, lat, código do trecho SRE) ou None se o km não está em trecho próprio da rodovia."""
        segs = self.segments(rod)
        hit = [s for s in segs if s['kmini'] <= km <= s['kmfim'] and s['kmfim'] > s['kmini']]
        if not hit:
            return None
        s = sorted(hit, key=lambda x: ('D-' in (x['sremg'] or '') or 'E-' in (x['sremg'] or ''), x['kmfim'] - x['kmini']))[0]
        c = s['coords']
        # orientação: a ponta do trecho mais próxima do trecho anterior (kmfim == kmini) é o início
        prev = [x for x in segs if abs(x['kmfim'] - s['kmini']) < 0.05 and x is not s]
        nxt = [x for x in segs if abs(x['kmini'] - s['kmfim']) < 0.05 and x is not s]
        if prev:
            ends = (prev[0]['coords'][0], prev[0]['coords'][-1])
            if min(_dist(c[-1], e) for e in ends) < min(_dist(c[0], e) for e in ends):
                c = c[::-1]
        elif nxt:
            ends = (nxt[0]['coords'][0], nxt[0]['coords'][-1])
            if min(_dist(c[0], e) for e in ends) < min(_dist(c[-1], e) for e in ends):
                c = c[::-1]
        lon, lat = _along(c, (km - s['kmini']) / (s['kmfim'] - s['kmini']))
        return lon, lat, s['sremg']
