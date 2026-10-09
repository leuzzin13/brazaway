"""Emergências químicas atendidas pela CETESB no transporte rodoviário (2014 até o ano corrente), do DataGEO.

Camadas WFS `datageo:VWM_ACIDENTES_AMBIENTAIS_CETESB_{ano}_PTO` (pontos; a do ano corrente é atualizada em poucos dias).
Filtra Atividade = "Transporte Rodoviário". O campo "Descricao" (texto livre do atendimento, pode ter nomes de pessoas)
NÃO é importado. Atenção: "óleo diesel" inclui vazamento do tanque do próprio veículo, não só carga perigosa.

Uso na API: mapa (pontos com `weight` para heatmap) e resumo da rota (registros a até 250 m; trechos com mais registros).
"""
import datetime
import json
import re

from common import http_get, stable_id

LAYER_ID = 'perigosos'
SOURCE = 'cetesb'
SOURCE_URL = 'https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs (VWM_ACIDENTES_AMBIENTAIS_CETESB_{ano}_PTO)'
LICENSE = 'CETESB/DataGEO — sem licença explícita por camada (AccessConstraints NONE); uso com atribuição, confirmar termos'
NOTES = ''

WFS = ('https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs?service=WFS&version=1.0.0&request=GetFeature'
       '&outputFormat=application/json&srsName=EPSG:4326&typeName=datageo:VWM_ACIDENTES_AMBIENTAIS_CETESB_{ano}_PTO')
FIRST_YEAR = 2014


def _s(v):
    return re.sub(r'\s+', ' ', str(v or '')).strip() or None


def fetch():
    global NOTES
    out, per_year = [], {}
    this_year = datetime.date.today().year
    for ano in range(FIRST_YEAR, this_year + 1):
        # anos fechados mudam pouco: cache de 90 dias; o ano corrente, 1 dia
        try:
            d = json.loads(http_get(WFS.format(ano=ano), cache=f'cetesb_emerg_{ano}.json', max_age_h=24 if ano == this_year else 24 * 90))
        except Exception as e:
            print(f'    ! {ano}: {e}')
            continue
        n = 0
        for f in d.get('features', []):
            p, g = f.get('properties') or {}, f.get('geometry') or {}
            if _s(p.get('Atividade')) != 'Transporte Rodoviário' or g.get('type') != 'Point':
                continue
            lon, lat = g['coordinates'][:2]
            if not (-53.5 < lon < -44 and -25.5 < lat < -19.5):
                continue
            data = _s(p.get('Data'))
            iso = None
            if data and re.fullmatch(r'\d{2}/\d{2}/\d{4}', data):
                iso = f'{data[6:]}-{data[3:5]}-{data[:2]}'
            produtos = _s(p.get('Prod_quimicos'))
            out.append({
                'source_id': stable_id(ano, _s(p.get('Codigo')) or f.get('id'), round(lon, 5), round(lat, 5)),
                'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]},
                'name': f"Emergência química: {(produtos or 'produto não identificado').title()[:60]}",
                'kind': 'emergencia',
                'props': {'ano': ano, 'data': iso, 'codigo_cetesb': _s(p.get('Codigo')), 'municipio': _s(p.get('Municipio')),
                          'rodovia': _s(p.get('Rodovia')), 'local': (_s(p.get('Local')) or '')[:160] or None,
                          'causa': _s(p.get('Causa')), 'produtos': produtos, 'meio_afetado': _s(p.get('Meio_afetado')),
                          'vitimas': p.get('Num_vitimas'), 'weight': 1},
                'valid_from': None, 'valid_to': None,
            })
            n += 1
        per_year[ano] = n
    NOTES = 'Registros de transporte rodoviário por ano: ' + ', '.join(f'{k}: {v}' for k, v in per_year.items())
    print('    ' + NOTES)
    return out
