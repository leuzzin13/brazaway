"""Postos de pesagem das rodovias estaduais concedidas de SP (ARTESP): PGF (Posto Geral de Fiscalização, balança fixa)
e PPM (Ponto de Pesagem Móvel), da pasta "Sistema de Pesagem" dos KMZ de malha por lote (dadosabertos.artesp.sp.gov.br, CC-BY).
Rodovia, km e sentido saem do nome do ponto (ex.: "PGF SP-330 km 37 (N)") ou dos atributos do KMZ, que não são padronizados
entre lotes; o que não der para ler fica nulo.
"""
from __future__ import annotations
import re
from common import stable_id

LAYER_ID = 'balancas'
SOURCE = 'artesp'
SOURCE_URL = 'https://dadosabertos.artesp.sp.gov.br/dataset/malha-rodoviaria (KMZ por lote, pasta Sistema de Pesagem)'
LICENSE = 'CC-BY — ARTESP (dados abertos)'
NOTES = ''

SENT = {'N': 'norte', 'S': 'sul', 'L': 'leste', 'E': 'leste', 'O': 'oeste', 'W': 'oeste',
        'NORTE': 'norte', 'SUL': 'sul', 'LESTE': 'leste', 'OESTE': 'oeste'}


def parse_label(txt: str) -> tuple[str | None, float | None, str | None]:
    """'PGF SP-330 km 37 (N)', 'PPM SP332 km174+200 (Sentido Sul)', 'PGF SP_160 km 56(Sentido Norte)', 'SP127 23 Sul' ..."""
    from sources.weigh_dersp import norm_rod, parse_km
    t = re.sub(r'\s+', ' ', txt or '').strip()
    rod = None
    m = re.search(r'(?i)\b(SP[AIM]?)[\s_-]*(\d{2,3})(?:\s*/\s*(\d{3}))?', t)
    if m:
        rod = norm_rod(f'{m.group(1)} {m.group(2)}' + (f'/{m.group(3)}' if m.group(3) else ''))
    km = None
    m = re.search(r'(?i)\bkm\s*(\d{1,3}(?:[+,.]\d{1,3})?)', t) or re.search(r'(?i)\bSP[AIM]?[\s_-]*\d{3}\s+(\d{1,3})\b', t)
    if m:
        km = parse_km(m.group(1).replace('.', ','))
    sent = None
    m = (re.search(r'(?i)sentido\W*(norte|sul|leste|oeste|n|s|l|o)\b', t)
         or re.search(r'(?i)\((norte|sul|leste|oeste|n|s|l|o)\)', t)
         or re.search(r'(?i)\s(norte|sul|leste|oeste|n|s|l|o)$', t))
    if m:
        sent = SENT.get(m.group(1).upper())
    return rod, km, sent


def fetch():
    global NOTES
    from sources.toll_artesp import artesp_kmz_points
    from sources.weigh_dersp import pretty_rod, parse_km, norm_rod
    pts = [p for p in artesp_kmz_points() if p['tipo'] in ('pgf', 'ppm', 'balanca')]
    out, seen = [], set()
    for p in pts:
        a = p['attrs']
        label = p['nome'] or ''
        folder = p['pasta'].split(' / ')[-1]
        rod, km, sent = parse_label(label)
        r2, k2, s2 = parse_label(folder)
        rod = rod or r2 or norm_rod(a.get('RODOVIA') or a.get('Rodovia') or '')
        km = km if km is not None else k2 if k2 is not None else parse_km((a.get('LOCALIZACAO') or a.get('LOCALIZAÇÃO') or a.get('KM') or '').replace('.', ','))
        sent = sent or s2 or SENT.get((a.get('SENTIDO') or a.get('Sentido') or '').strip().upper())
        tipo = p['tipo']
        if re.match(r'(?i)^\s*PPM', label):
            tipo = 'ppm'
        elif re.match(r'(?i)^\s*PG[FM]', label):
            tipo = 'pgf'
        if tipo == 'balanca':
            tipo = 'ppm' if re.search(r'(?i)m[oó]vel', label + folder + (a.get('TIPO') or '')) else 'pgf'
        key = (round(p['lon'], 4), round(p['lat'], 4), tipo)
        if key in seen:
            continue
        seen.add(key)
        name = f'{"Posto de pesagem (PGF)" if tipo == "pgf" else "Ponto de pesagem móvel (PPM)"} {pretty_rod(rod) or ""} {f"km {km:g}" if km is not None else ""}'.strip()
        out.append({'source_id': stable_id('artesp', p['lote'], tipo, key[0], key[1]),
                    'geometry': {'type': 'Point', 'coordinates': [round(p['lon'], 6), round(p['lat'], 6)]},
                    'name': re.sub(r'\s+', ' ', name),
                    'kind': 'fixo' if tipo == 'pgf' else 'movel',
                    'props': {'rodovia': pretty_rod(rod), 'km': km, 'sentido': sent, 'administrador': p['lote_nome'], 'lote': p['lote'],
                              'tipo_original': tipo.upper(), 'codigo': a.get('PGF') or a.get('PPM'), 'rotulo_kmz': (label or folder)[:80],
                              'precisao': 'exata'}})
    n_fixo = sum(1 for f in out if f['kind'] == 'fixo')
    NOTES = f'{n_fixo} PGF (fixos) e {len(out) - n_fixo} PPM (móveis) dos KMZ por lote; {sum(1 for f in out if not f["props"]["sentido"])} sem sentido no rótulo.'
    return out
