"""Áreas de descanso e SAU das rodovias estaduais concedidas de SP — ARTESP, Cadastro de Ativos ("Recursos
Operacionais", recursos.xlsx; dadosabertos.artesp.sp.gov.br, CC-BY).

  - 'Área de Descanso'           -> kind 'area_descanso' (estacionamento de caminhões mantido pela concessionária;
                                     fiscalizado pela ARTESP — ET-SUROD-GEFOR-S-OPE-EDF-01-ADE). Prioridade 2 no plano.
  - 'Posto de Atendimento - SAU' e 'Base Operacional - SAU' -> kind 'sau' (APOIO: banheiro, água, informação,
                                     socorro). NUNCA vira local do descanso de 11 h; serve só para pausa curta.
Só ativos ('Cod_Status' = Ativo) e não em implantação. A planilha não traz nº de vagas nem serviços.
A mesma área às vezes aparece duas vezes (troca de concessionária no mesmo km: ViaOeste/Sorocabana na SP-280 km 57):
mantém uma por coordenada, com as duas concessionárias.
"""
from __future__ import annotations
import io
import re

from common import http_get, stable_id

LAYER_ID = 'descanso'
SOURCE = 'artesp'
SOURCE_URL = ('https://dadosabertos.artesp.sp.gov.br/dataset/491d79c5-ee09-4fe8-a3ce-1b425fe60bbe/resource/'
              '8b3212ff-1647-42ad-8a45-39e9934c92e1/download/recursos.xlsx')
LICENSE = 'CC-BY — ARTESP (dadosabertos.artesp.sp.gov.br, Cadastro de Ativos: Recursos Operacionais)'
NOTES = ''

TIPOS = {'área de descanso': 'area_descanso', 'area de descanso': 'area_descanso',
         'posto de atendimento - sau': 'sau', 'base operacional - sau': 'sau'}


def _rod(s: str | None) -> str | None:
    m = re.search(r'(?i)\b(SP[AIM]?)\s*[-_ ]?\s*(\d{2,3})(?:\s*/\s*(\d{3}))?', s or '')
    if not m:
        return None
    return f'{m.group(1).upper()}-{int(m.group(2)):03d}' + (f'/{m.group(3)}' if m.group(3) else '')


def _km(s: str | None) -> float | None:
    """'km 056+500' -> 56.5"""
    m = re.search(r'(\d{1,3})\s*\+\s*(\d{1,3})', s or '')
    if m:
        return round(int(m.group(1)) + int(m.group(2)) / 1000, 3)
    m = re.search(r'(\d{1,3}(?:[.,]\d+)?)', s or '')
    return float(m.group(1).replace(',', '.')) if m else None


def _f(v) -> float | None:
    try:
        return float(str(v).strip().replace(',', '.'))
    except (TypeError, ValueError):
        return None


def rows() -> list[dict]:
    import openpyxl
    raw = http_get(SOURCE_URL, cache='artesp_recursos.xlsx', max_age_h=24 * 7)
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    head = [str(h).strip() if h is not None else '' for h in next(it)]
    return [dict(zip(head, r)) for r in it]


def fetch():
    global NOTES
    by_pos: dict[tuple, dict] = {}
    for r in rows():
        tipo = TIPOS.get(str(r.get('Desc_Componente') or '').strip().lower())
        if not tipo:
            continue
        if str(r.get('Cod_Status') or '').strip().lower() != 'ativo':
            continue
        if str(r.get('Em_Implantacao') or '').strip().upper().startswith('S'):
            continue
        lat, lon = _f(r.get('Latitude')), _f(r.get('Longitude'))
        if lat is None or lon is None or not (-26 < lat < -19 and -54 < lon < -44):
            continue
        conc = str(r.get('Nome_Concessionaria') or '').strip() or None
        rod = _rod(str(r.get('Rodovia') or ''))
        km = _km(str(r.get('Localizacao') or ''))
        sent = (str(r.get('Sentido') or '').strip().lower() or None)
        key = (tipo, round(lat, 5), round(lon, 5))
        if key in by_pos:
            p = by_pos[key]['props']
            if conc and conc not in p['concessionarias']:
                p['concessionarias'].append(conc)
            continue
        obs = re.sub(r'\s+', ' ', str(r.get('Observacao') or '')).strip() or None
        nome_fonte = re.sub(r'\s+', ' ', str(r.get('Nome') or '')).strip() or None
        kmtxt = f' km {km:g}'.replace('.', ',') if km is not None else ''
        if tipo == 'area_descanso':
            name = f'Área de descanso {conc or ""} {rod or ""}{kmtxt}'
        else:
            name = f'SAU {conc or ""} {rod or ""}{kmtxt}'
        by_pos[key] = {
            'source_id': stable_id('artesp', tipo, rod, km, sent, key[1], key[2]),
            'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]},
            'name': re.sub(r'\s+', ' ', name).strip(),
            'kind': tipo,
            'props': {
                'categoria': 'Área de descanso de concessionária' if tipo == 'area_descanso' else 'SAU (apoio)',
                'tipo_original': str(r.get('Desc_Componente') or '').strip(),
                'concessionaria': conc, 'concessionarias': [conc] if conc else [],
                'rodovia': rod, 'km': km, 'sentido': sent,
                'municipio': str(r.get('Municipio') or '').strip() or None, 'uf': 'SP',
                'nome_fonte': nome_fonte, 'observacao': obs,
                'em_operacao_desde': str(r.get('Data_Operacao') or '')[:10] or None,
                'apoio': tipo == 'sau',
            },
        }
    out = list(by_pos.values())
    n_area = sum(1 for f in out if f['kind'] == 'area_descanso')
    NOTES = f'{n_area} áreas de descanso e {len(out) - n_area} SAU (postos de atendimento e bases operacionais) ativos. Sem nº de vagas na fonte.'
    return out
