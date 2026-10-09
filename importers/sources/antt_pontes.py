"""Pontes e similares das rodovias federais concedidas (ANTT, dados abertos, CC-BY).

~3,5 mil OAEs de 30 concessionárias com km e coordenadas de início/fim por pista (entrada/saída).
Não traz peso, classe nem condição: serve para localizar/contar as OAEs nas concessões (onde o PROARTE não tem nota).
"""
from __future__ import annotations

import csv
import io
import math

from common import http_get, stable_id

LAYER_ID = 'pontes_federais'
SOURCE = 'antt'
SOURCE_URL = ('https://dados.antt.gov.br/dataset/pontes-similares (CSV: https://dados.antt.gov.br/dataset/f9cdb7dc-549f-4bd3-97aa-a35bdff94c26/'
              'resource/80cd0864-b0ca-4ab5-bf5a-ffcbeec33235/download/pontes-e-similares-das-rodovias-concedidas.csv)')
LICENSE = 'Creative Commons Atribuição (cc-by) — ANTT, dados.antt.gov.br'
NOTES = 'OAEs das concessões federais; sem limite de peso, classe de projeto ou nota de conservação (não publicados pela ANTT).'
CSV_URL = ('https://dados.antt.gov.br/dataset/f9cdb7dc-549f-4bd3-97aa-a35bdff94c26/resource/80cd0864-b0ca-4ab5-bf5a-ffcbeec33235/'
           'download/pontes-e-similares-das-rodovias-concedidas.csv')

KIND = {'PONTE': 'ponte', 'VIADUTO': 'viaduto', 'PONTILHÃO': 'pontilhao', 'PONTILHAO': 'pontilhao', 'PASSARELA': 'passarela',
        'TÚNEL': 'tunel', 'TUNEL': 'tunel', 'PASSAGEM INFERIOR': 'passagem_inferior', 'PASSAGEM SUPERIOR': 'passagem_superior'}


def _f(x):
    try:
        return float(str(x).replace(',', '.'))
    except (TypeError, ValueError):
        return None


def _pt(lat, lon):
    la, lo = _f(lat), _f(lon)
    if la is None or lo is None or not (-35 < la < 6 and -75 < lo < -28):
        return None
    return [round(lo, 6), round(la, 6)]


def _dist_m(a, b):
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    return math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111_320


def fetch():
    raw = http_get(CSV_URL, cache='antt/pontes_similares.csv', max_age_h=24 * 7)
    txt = raw.decode('cp1252', errors='replace')
    rows = list(csv.reader(io.StringIO(txt), delimiter=';'))
    header, body = rows[0], rows[1:]
    # o cabeçalho publicado tem municipio_entrada/municipio_saida, mas as linhas não (24 x 26 colunas, set/2026)
    short = [h for h in header if not h.startswith('municipio_')]
    out = []
    for vals in body:
        if len(vals) == len(header):
            r = dict(zip(header, vals))
        elif len(vals) == len(short):
            r = dict(zip(short, vals))
        else:
            continue
        tipo = (r.get('tipo_de_ponte_e_similares') or '').strip().upper()
        for side in ('entrada', 'saida'):
            a = _pt(r.get(f'latitude_inicial_{side}'), r.get(f'longitude_inicial_{side}'))
            if a is None:
                continue
            b = _pt(r.get(f'latitude_final_{side}'), r.get(f'longitude_final_{side}'))
            rod = (r.get(f'rodovia_uf_{side}') or r.get('rodovia_uf_entrada') or '').strip()
            km = _f(r.get(f'km_m_inicial_{side}'))
            geom = ({'type': 'LineString', 'coordinates': [a, b]} if b and a != b and _dist_m(a, b) < 3000
                    else {'type': 'Point', 'coordinates': a})
            out.append({
                'source_id': stable_id(r.get('concessionaria'), rod, side, r.get(f'km_m_inicial_{side}'), r.get('nome_de_ponte_e_similares'), a),
                'geometry': geom,
                'name': f"{(r.get('nome_de_ponte_e_similares') or '').strip()} — {rod} km {km if km is not None else '?'}".strip(' —'),
                'kind': KIND.get(tipo, 'outra'),
                'props': {
                    'fonte': 'ANTT', 'concessionaria': (r.get('concessionaria') or '').strip(), 'tipo_obra': tipo.title(),
                    'rodovia': rod, 'br': rod[3:6] if rod.upper().startswith('BR-') else None, 'km': km, 'km_fim': _f(r.get(f'km_m_final_{side}')),
                    'pista': (r.get(f'tipo_de_pista_{side}') or '').strip(), 'sentido': (r.get(f'sentido_{side}') or '').strip(),
                    'municipio': (r.get(f'municipio_{side}') or '').strip(), 'extensao_m': _f(r.get('extensao')),
                    'ano_pnv_snv': (r.get('ano_do_pnv_snv') or '').strip(), 'nota': None,
                },
            })
    return out
