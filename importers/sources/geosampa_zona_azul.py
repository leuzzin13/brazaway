"""Zona Azul Caminhão (vagas de carga e descarga rotativas) — GeoSampa, camada geoportal:zona_azul (CET).

Cada feição é uma face de quadra com Zona Azul; ficam só as que têm vagas de caminhão (qt_vaga_caminhao > 0).
Horário de operação por dia (seg–sex, sábado, domingo, feriado) vira janelas semanais; dia 8 = feriado.
Regra do CAD conforme a CET ("Regras para estacionar em áreas de Zona Azul", conferida em 09/10/2026 em
https://www.cetsp.com.br/consultas/zona-azul/tudo-sobre-zona-azul-digital.aspx):
  Bolsão Caminhão: 1 CAD = 30 min, 2 CADs = 1 h (máx. 2 CADs na mesma vaga), para caminhão, caminhonete e veículo misto;
  exceção publicada pela CET: Bolsão Caminhão da R. Santa Rosa e da R. Eurípedes Simões de Paula seguem a
  regra geral (1 CAD = 1 h, 2 CADs = 2 h). A CET não cita o número da norma nessa página; a placa do local prevalece.
"""
import re
import unicodedata

from sources.geosampa_faixa_onibus import length_m, wfs_geojson

LAYER_ID = 'carga_descarga'
SOURCE = 'geosampa-zona-azul'
SOURCE_URL = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs (typeNames=geoportal:zona_azul)'
LICENSE = 'CC-BY-SA 4.0 — GeoSampa/Prefeitura de São Paulo (cadastro CET)'
NOTES = ('Só faces de quadra com qt_vaga_caminhao > 0. Horários por dia (seg–sex/sáb/dom/feriado; vazio = não opera). '
         'Regra do CAD: CET, "Regras para estacionar em áreas de Zona Azul" (Bolsão Caminhão: 1 CAD = 30 min, máx. 2 = 1 h).')
CET_REGRAS = ('CET — Regras para estacionar em áreas de Zona Azul '
              '(https://www.cetsp.com.br/consultas/zona-azul/tudo-sobre-zona-azul-digital.aspx, conferido em 09/10/2026)')
VEICULOS = 'caminhão, caminhonete e veículo misto (CET)'

DAYSETS = [('segunda_sexta', [1, 2, 3, 4, 5]), ('sabado', [6]), ('domingo', [7]), ('feriado', [8])]
# CET: "quando este tipo de veículo [...] estacionar no Bolsão Caminhão da Rua Santa Rosa e da Rua Eurípedes
# Simões de Paula, o tempo de validade do CAD é o mesmo da Regra Geral"
REGRA_GERAL_LOCAIS = ('R STA ROSA', 'R SANTA ROSA', 'EURIPEDES S DE PAULA', 'EURIPEDES SIMOES DE PAULA')


def _norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', s.upper()).strip()


def _hm(v):
    v = (v or '').strip()
    return v if re.match(r'^\d{2}:\d{2}$', v) else None


def windows_of(p: dict) -> list[dict]:
    out = []
    for key, days in DAYSETS:
        a, b = _hm(p.get(f'hr_inicio_{key}')), _hm(p.get(f'hr_termino_{key}'))
        if a and b:
            out.append({'days': days, 'from': a, 'to': '24:00' if b == '23:59' else b})
    return out


def cad_rule(local: str) -> dict:
    n = _norm(local)
    if any(k in n.split('(')[0] for k in REGRA_GERAL_LOCAIS):
        return {'cad_min': 60, 'max_cads': 2, 'regra': 'Bolsão Caminhão com regra geral: 1 CAD = 1 h, máx. 2 CADs (2 h)',
                'base_legal': CET_REGRAS + ' — exceção R. Santa Rosa/R. Eurípedes Simões de Paula'}
    return {'cad_min': 30, 'max_cads': 2, 'regra': 'Bolsão Caminhão: 1 CAD = 30 min, máx. 2 CADs (1 h) na mesma vaga',
            'base_legal': CET_REGRAS}


def trucks_rows():
    d = wfs_geojson('zona_azul', 'geosampa_zona_azul.json', max_age_h=24 * 3)
    rows = []
    for f in d['features']:
        p = f['properties']
        g = f.get('geometry') or {}
        if (p.get('qt_vaga_caminhao') or 0) <= 0 or g.get('type') not in ('LineString', 'MultiLineString'):
            continue
        rows.append(f)
    return rows


def fetch():
    out = []
    for f in trucks_rows():
        p = f['properties']
        g = f['geometry']
        coords = g['coordinates'] if g['type'] == 'LineString' else [c for part in g['coordinates'] for c in part]
        local = re.sub(r'\s+', ' ', (p.get('nm_local') or '').strip())
        lado = (p.get('tx_lado') or '').strip().upper()
        w = windows_of(p)
        out.append({
            'source_id': str(p['cd_identificador_zona_azul']),
            'geometry': g,
            'name': local or None,
            'kind': 'zona_azul_caminhao',
            'props': {
                'zona_azul_id': p['cd_identificador_zona_azul'], 'local': local,
                'lado': {'PAR': 'par', 'IMPAR': 'ímpar'}.get(lado, lado.lower() or None),
                'vagas_caminhao': p.get('qt_vaga_caminhao'), 'vagas_auto': p.get('qt_vaga_auto'),
                'windows': w, 'horario_informado': bool(w),
                **cad_rule(local),
                'veiculos': VEICULOS,
                'comprimento_m': round(length_m(coords)), 'dt_carga': (p.get('dt_carga') or '')[:10] or None,
            },
        })
    return out
