"""Passarelas das rodovias estaduais concedidas de SP (ARTESP, Cadastro de Ativos) — com ALTURA.

Única base aberta de OAE em SP com um campo de altura. A ARTESP não publica dicionário de dados; tratamos ALTURA como
a altura livre sob a passarela (o valor mínimo observado em operação, 5,38 m, é coerente com a instrução de projeto
IP.DIN/010 da ARTESP, que pede 5,5 m em obras novas). Registros com altura < ALTURA_SUSPEITA_M são marcados como
suspeitos (provável erro de digitação: há 2 com 2,40 m em Jundiaí numa rodovia onde caminhões de 4,40 m passam todo
dia) e NÃO bloqueiam a rota — viram aviso para confirmar.

A API (oae.layer.ts) bloqueia a passarela para veículos com altura >= altura_livre_m - 0,10 m (folga) com uma
exclusão pequena no ponto (raio bloqueio.raio_m), que cobre as pistas sob a passarela.
"""
import io
import re

from common import http_get

LAYER_ID = 'oae'
SOURCE = 'artesp'
SOURCE_URL = ('https://dadosabertos.artesp.sp.gov.br/dataset/491d79c5-ee09-4fe8-a3ce-1b425fe60bbe/resource/'
              'd864ec43-a93b-4803-9b48-1fee98a98fe7/download/passarelas.xlsx')
LICENSE = 'CC-BY — ARTESP (dadosabertos.artesp.sp.gov.br, Cadastro de Ativos: passarelas)'
NOTES = ('Campo ALTURA sem dicionário oficial: tratado como altura livre. Altura < 3,0 m marcada como suspeita (não bloqueia). '
         'Passarelas DEMOLIDA descartadas. Pontes e viadutos da malha concedida não são publicados pela ARTESP.')

ALTURA_SUSPEITA_M = 3.0      # abaixo disso o valor é incompatível com rodovia aberta a caminhões
RAIO_BLOQUEIO_M = 30         # cobre as duas pistas sob a passarela (ponto ARTESP fica perto do eixo da rodovia)
SP_BBOX = (-53.2, -25.4, -44.1, -19.7)


def _num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(',', '.')
    if not s or s.upper() in ('NÃO INFORMADO', 'NAO INFORMADO', '-', 'NULL'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _km(v):
    """'063+000' -> 63.0 ; '012+164' -> 12.164"""
    if v is None:
        return None
    s = str(v).strip()
    m = re.match(r'^(\d+)\+(\d+)$', s)
    if m:
        return int(m.group(1)) + int(m.group(2)) / 1000
    return _num(s)


def _rodovia(v):
    s = (v or '').strip().upper().replace(' ', '')
    m = re.match(r'^(SPI|SPA|SPM|SP)(\d+)(.*)$', s)
    return f'{m.group(1)}-{m.group(2)}{m.group(3)}' if m else (v or '').strip()


def _txt(v):
    s = ('' if v is None else str(v)).strip()
    return s or None


def fetch():
    import openpyxl
    raw = http_get(SOURCE_URL, cache='artesp_passarelas.xlsx', max_age_h=24 * 30)
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    header = [str(h).strip().upper() if h is not None else '' for h in next(rows)]
    out = []
    for r in rows:
        p = dict(zip(header, r))
        status = (_txt(p.get('STATUS')) or '').upper()
        if status == 'DEMOLIDA':
            continue
        lat, lon = _num(p.get('LAT')), _num(p.get('LONG'))
        if lat is None or lon is None:
            continue
        if not (SP_BBOX[0] <= lon <= SP_BBOX[2] and SP_BBOX[1] <= lat <= SP_BBOX[3]):
            continue
        altura = _num(p.get('ALTURA'))
        if altura is not None and altura <= 0:
            altura = None
        suspeita = altura is not None and altura < ALTURA_SUSPEITA_M
        rod, km = _rodovia(p.get('RODOVIA')), _km(p.get('KM'))
        nome = _txt(p.get('NOME_PASSARELA'))
        if nome and nome.upper() in ('SEM DENOMINAÇÃO', 'SEM DENOMINACAO', 'NÃO INFORMADO'):
            nome = None
        km_txt = f'{km:.3f}'.rstrip('0').rstrip('.').replace('.', ',') if km is not None else '?'
        label = f'Passarela {rod} km {km_txt}' + (f' ({nome.title()})' if nome else '')
        ra = _txt(p.get('RA'))
        out.append({
            'source_id': ra or f'{rod}-{km}',
            'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]},
            'name': label,
            'kind': 'passarela',
            'props': {
                'admin': 'estadual concedida (ARTESP)',
                'concessionaria': _txt(p.get('CONCESSIONARIA')),
                'rodovia': rod, 'km': km, 'tipo_pista': _txt(p.get('TIPO_PISTA')),
                'municipio': _txt(p.get('MUNICIPIO')), 'status': status or None,
                'estrutura': _txt(p.get('ESTRUTURA')),
                'largura_m': _num(p.get('LARGURA')), 'comprimento_m': _num(p.get('COMPRIMENTO')),
                # altura livre sob a passarela (m): a API usa para bloquear veículos altos
                'altura_livre_m': None if suspeita else altura,
                'altura_informada_m': altura,
                'altura_suspeita': suspeita,
                'altura_fonte': 'ARTESP (campo ALTURA, sem dicionário oficial)',
                'peso_max_t': None,
                # como bloquear: exclusão circular no ponto (a passarela está SOBRE a rodovia)
                'bloqueio': {'modo': 'sob', 'pontos': [[round(lon, 6), round(lat, 6)]], 'raio_m': RAIO_BLOQUEIO_M},
            },
        })
    return out
