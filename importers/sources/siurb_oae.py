"""OAEs nomeadas da Prefeitura de São Paulo (SIURB, dataset "controle de obras", aba `servicos`).

São ~105 pontes, viadutos, passarelas e complexos viários com nome e coordenada, objeto de contratos de inspeção e
recuperação (2019-2021). Não traz limite de peso nem gabarito: serve para dar NOME às OAEs municipais na rota e
mostrar o status da obra/serviço (tabela `obras_status`). Obras da aba `obras` ligadas a OAE (nome com PONTE/VIADUTO/
PASSARELA/TÚNEL) a até 200 m entram como `obras_relacionadas`.
"""
import io
import math
import re

from common import http_get

LAYER_ID = 'oae'
SOURCE = 'siurb'
SOURCE_URL = ('https://dados.prefeitura.sp.gov.br/dataset/49a40a52-68c0-45c1-92d8-ccc35a525467/resource/'
              '5596c5a0-4c33-4859-b522-a228b4ccbdc8/download/completo-obras-controle-de-obras.xlsx')
LICENSE = 'ODC-By 1.0 (Open Data Commons Attribution) — Prefeitura de São Paulo / SIURB (dados.prefeitura.sp.gov.br)'
NOTES = ('Lista de serviços contratados (inspeção/recuperação 2019-2021), não o cadastro completo da SIURB (770 OAEs em 2024). '
         'Sem gabarito nem limite de peso. Status conforme tabela obras_status do próprio arquivo.')

CATEGORIA_OAE = 4                       # fk_categoria das OAEs na aba servicos
OAE_WORDS = ('PONTE', 'VIADUTO', 'PASSARELA', 'TÚNEL', 'TUNEL', 'PONTILHÃO', 'PONTILHAO', 'COMPLEXO VIÁRIO', 'ELEVADO')
SP_BBOX = (-47.0, -24.1, -46.3, -23.3)


def _geo(v):
    """'-23.5440830, -46.5935300' (às vezes com ',17z' no fim ou sem o sinal da latitude) -> (lat, lon)"""
    if not v:
        return None
    nums = re.findall(r'-?\d+\.\d+', str(v))
    if len(nums) < 2:
        return None
    lat, lon = float(nums[0]), float(nums[1])
    if lat > 0:              # alguns registros vêm sem o sinal negativo da latitude
        lat = -lat
    if not (SP_BBOX[0] <= lon <= SP_BBOX[2] and SP_BBOX[1] <= lat <= SP_BBOX[3]):
        return None
    return lat, lon


def _kind(name: str) -> str:
    n = name.upper()
    if 'PASSARELA' in n:
        return 'passarela'
    if 'TÚNEL' in n or 'TUNEL' in n:
        return 'tunel'
    if n.startswith('PONTE') or 'PONTILHÃO' in n or 'PONTILHAO' in n:
        return 'ponte'
    return 'viaduto'


def _clean_name(s: str) -> str:
    """'VIADUTO GUADALAJARA: VIADUTO' -> 'Viaduto Guadalajara' ; ' Ponte Freguesia do Ó' -> 'Ponte Freguesia do Ó'"""
    base = s.split(':')[0].split('|')[0].strip()
    if base.isupper():
        small = {'DE', 'DA', 'DO', 'DOS', 'DAS', 'E', 'NA', 'NO', 'SOBRE', 'A', 'O'}
        words = base.lower().split()
        base = ' '.join(w if (w.upper() in small and i > 0) else w.capitalize() for i, w in enumerate(words))
    return re.sub(r'\s+', ' ', base)


def _iso(d):
    return d.date().isoformat() if hasattr(d, 'date') else (str(d)[:10] if d else None)


def _dist_m(a, b):
    dx = (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0]))
    dy = (a[0] - b[0]) * 110540
    return math.hypot(dx, dy)


def _sheet(wb, name):
    rows = wb[name].iter_rows(values_only=True)
    header = [str(h).strip() if h is not None else '' for h in next(rows)]
    return [dict(zip(header, r)) for r in rows]


def fetch():
    import openpyxl
    raw = http_get(SOURCE_URL, cache='siurb_controle_obras.xlsx', max_age_h=24 * 30)
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    status = {r['id_status_obra']: r['ds_status_obra'] for r in _sheet(wb, 'obras_status')}
    obras = []
    for o in _sheet(wb, 'obras'):
        nome = f"{o.get('nome_obra') or ''} {o.get('nome_referencia') or ''}".upper()
        if not any(w in nome for w in OAE_WORDS):
            continue
        g = _geo(o.get('geolocalizacao'))
        if not g:
            continue
        obras.append({'g': g, 'nome': (o.get('nome_referencia') or o.get('nome_obra') or '').strip(),
                      'status': status.get(o.get('status_obra')), 'inicio': _iso(o.get('dt_inicio')),
                      'termino': _iso(o.get('dt_termino'))})
    out = []
    for s in _sheet(wb, 'servicos'):
        if s.get('fk_categoria') != CATEGORIA_OAE:
            continue
        g = _geo(s.get('cd_geo'))
        nm = (s.get('nm_servico') or '').strip()
        if not g or not nm or not any(w in nm.upper() for w in OAE_WORDS):
            continue      # categoria 4 inclui alguns serviços que não são OAE (ex.: troca de grelha)
        lat, lon = g
        rel = sorted((o for o in obras if _dist_m(g, o['g']) <= 200), key=lambda o: _dist_m(g, o['g']))[:5]
        name = _clean_name(nm)
        out.append({
            'source_id': str(s['pk_servico']),
            'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]},
            'name': name,
            'kind': _kind(name),
            'props': {
                'admin': 'municipal (PMSP/SIURB)', 'municipio': 'São Paulo',
                'servico': nm, 'contrato': s.get('fk_contrato'), 'processo': s.get('cd_processo'),
                'localizacao': (s.get('ds_localizacao') or '').strip(' :') or None,
                'status_obra': status.get(s.get('fk_status')),
                'dt_inicio': _iso(s.get('dt_inicio')), 'dt_termino': _iso(s.get('dt_termino')),
                'valor_rs': s.get('vl_servico'), 'atualizado_em': _iso(s.get('dt_atualizacao')),
                'obras_relacionadas': [{'nome': o['nome'], 'status': o['status'], 'inicio': o['inicio'], 'termino': o['termino']} for o in rel],
                'altura_livre_m': None, 'peso_max_t': None,
            },
        })
    return out
