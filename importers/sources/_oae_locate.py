"""Consulta ao /locate do Valhalla para os importadores da camada `oae` (não é uma fonte: o runner ignora módulos com `_`).

Usado para (1) levar o ponto de bloqueio de uma passarela da ARTESP para as pistas da rodovia que passam sob ela e
(2) conferir que um ponto de bloqueio curado sobre uma ponte não encosta em outra via (ex.: a Marginal sob a ponte).

O Valhalla é o mesmo que a API usa (no compose: http://valhalla:8002). Se ele não responder, os importadores seguem
sem o ajuste/conferência e avisam no log; o seed gerado assim fica marcado (props.bloqueio.ajuste).
"""
from __future__ import annotations

import os
import re
import unicodedata

import requests

VALHALLA_URL = os.environ.get('VALHALLA_URL', 'http://valhalla:8002').rstrip('/')
_LOTE = 50
_indisponivel = False


def locate(points: list[tuple[float, float]], radius_m: float) -> list[list[dict]] | None:
    """[(lon, lat)] -> por ponto, as arestas do grafo (perfil truck) a até `radius_m`, ordenadas pela distância.

    Cada aresta: {dist, lon, lat (ponto mais próximo na aresta), pct (posição 0..1 na aresta), names, way_id,
    bridge, tunnel, link, cls, use}. Devolve None se o Valhalla não responder.
    """
    global _indisponivel
    if _indisponivel:
        return None
    out: list[list[dict]] = []
    for i in range(0, len(points), _LOTE):
        chunk = points[i:i + _LOTE]
        body = {'locations': [{'lon': lon, 'lat': lat, 'radius': int(radius_m)} for lon, lat in chunk],
                'costing': 'truck', 'verbose': True}
        try:
            r = requests.post(f'{VALHALLA_URL}/locate', json=body, timeout=60)
            r.raise_for_status()
            res = r.json()
        except (requests.RequestException, ValueError) as e:
            print(f'  ! Valhalla indisponível em {VALHALLA_URL} ({e.__class__.__name__}): seguindo sem /locate')
            _indisponivel = True
            return None
        for loc in res:
            edges = []
            for e in loc.get('edges') or []:
                d = e.get('distance')
                if d is None or d > radius_m:      # o /locate sempre devolve a mais próxima, mesmo fora do raio
                    continue
                ed, ei = e.get('edge') or {}, e.get('edge_info') or {}
                cl = ed.get('classification') or {}
                edges.append({
                    'dist': float(d), 'lon': e.get('correlated_lon'), 'lat': e.get('correlated_lat'),
                    'pct': e.get('percent_along'), 'names': ei.get('names') or [], 'way_id': ei.get('way_id'),
                    'bridge': bool(ed.get('bridge')), 'tunnel': bool(ed.get('tunnel')), 'link': bool(cl.get('link')),
                    'cls': cl.get('classification'), 'use': cl.get('use'),
                })
            edges.sort(key=lambda x: x['dist'])
            out.append(edges)
    return out


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode()
    return re.sub(r'[\s\-–]+', ' ', s).strip().lower()


def ref_key(s: str) -> str:
    """'SP-270' / 'SP 270' / 'sp270' -> 'SP270' ; 'SPA 325/322' -> 'SPA325/322'."""
    return re.sub(r'[\s\-]+', '', (s or '').upper())


def nome_tem_ref(name: str, ref: str) -> bool:
    """A aresta tem o código da rodovia no nome? ('SP-270' casa 'SP-270' e 'SP-270 (Marginal)', não 'SP-2700')."""
    k, r = ref_key(name), ref_key(ref)
    return bool(r) and k.startswith(r) and (len(k) == len(r) or not k[len(r)].isdigit())


def dist_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    import math
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)
