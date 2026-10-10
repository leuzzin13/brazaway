"""SAU das rodovias FEDERAIS concedidas — ANTT, "Informações sobre as Edificações Operacionais" (dados.antt.gov.br,
CC-BY). Só o tipo 'Base operacional' (a base do Serviço de Atendimento ao Usuário: banheiro, água, informação,
socorro mecânico e médico) e situação 'Ativo'. Postos de fiscalização e sedes administrativas ficam de fora.

SAU é APOIO (kind 'sau'): nunca vira local do descanso de 11 h no plano de direção; serve só para pausa curta.
A ANTT não publica lista de áreas de descanso nem de PPD (package_search 'descanso'/'PPD' = 0); os PPD vêm do painel
do Ministério dos Transportes (importador descanso_ppd).
"""
from __future__ import annotations
import csv
import io
import json
import re

from common import http_get, stable_id

LAYER_ID = 'descanso'
SOURCE = 'antt'
CKAN = 'https://dados.antt.gov.br/api/3/action/package_show?id=edificacao-operacional'
SOURCE_URL = ('https://dados.antt.gov.br/dataset/edificacao-operacional '
              '(informacoes-sobre-as-edificacoes-operacionais.csv)')
FALLBACK_CSV = ('https://dados.antt.gov.br/dataset/25ef7863-c809-4dae-9ad7-e7eec3cf4c93/resource/8951ed5d-69aa-434a-9403-d2fac95f9708/'
                'download/informacoes-sobre-as-edificacoes-operacionais.csv')
LICENSE = 'CC-BY — ANTT (dados.antt.gov.br)'
NOTES = ''


def _f(v) -> float | None:
    try:
        return float(str(v).strip().replace(',', '.'))
    except (TypeError, ValueError):
        return None


def csv_url() -> str:
    try:
        pkg = json.loads(http_get(CKAN, cache='antt_edificacao_pkg.json', max_age_h=24))['result']
        for r in pkg['resources']:
            if (r.get('format') or '').upper() == 'CSV':
                return r['url']
    except Exception as e:  # noqa: BLE001
        print(f'  ! CKAN da ANTT falhou ({e}); usando URL conhecida')
    return FALLBACK_CSV


def read_rows() -> list[dict]:
    raw = http_get(csv_url(), cache='antt_edificacao_operacional.csv', max_age_h=24 * 7)
    try:
        txt = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        txt = raw.decode('latin1')
    rows = list(csv.DictReader(io.StringIO(txt), delimiter=';'))
    # cabeçalho com acento quebrado em algumas versões ('tipo_de_edificação'): normaliza as chaves
    norm = lambda k: re.sub(r'[^a-z_]', '', (k or '').lower().encode('ascii', 'ignore').decode())
    return [{norm(k): (v or '').strip() for k, v in r.items()} for r in rows]


def fetch():
    global NOTES
    out = []
    for r in read_rows():
        tipo = next((v for k, v in r.items() if k.startswith('tipo_de_edifica')), '')
        if tipo.lower() != 'base operacional' or r.get('situacao', '').lower() != 'ativo':
            continue
        lat, lon = _f(r.get('latitude')), _f(r.get('longitude'))
        if lat is None or lon is None:
            continue
        rod = r.get('rodovia') or None
        km = _f(r.get('km_m'))
        conc = r.get('concessionaria') or None
        sent = (r.get('sentido') or '').lower() or None
        kmtxt = f' km {km:g}'.replace('.', ',') if km is not None else ''
        out.append({
            'source_id': stable_id('antt_sau', conc, rod, km, sent, round(lat, 5), round(lon, 5)),
            'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]},
            'name': re.sub(r'\s+', ' ', f'SAU {(conc or "").title()} {rod or ""}{kmtxt}').strip(),
            'kind': 'sau',
            'props': {
                'categoria': 'SAU (apoio)', 'tipo_original': tipo,
                'concessionaria': conc, 'rodovia': rod, 'km': km, 'sentido': sent,
                'uf': r.get('uf') or None, 'municipio': next((v for k, v in r.items() if k.startswith('munic')), None) or None,
                'tipo_pista': r.get('tipo_de_pista') or None,
                'apoio': True,
            },
        })
    NOTES = f'{len(out)} bases operacionais (SAU) ativas das concessões federais.'
    return out
