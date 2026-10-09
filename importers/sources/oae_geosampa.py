"""Pontes, viadutos, passarelas e túneis da cidade de São Paulo (GeoSampa, camada geoportal:obra_arte).
Geometria = linhas de borda das estruturas (base 1:1.000, referência 2004 na maioria). Sem nome, gabarito, peso ou estado.
"""
import json
from common import http_get

LAYER_ID = 'oae'
SOURCE = 'geosampa'
SOURCE_URL = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs (typeNames=geoportal:obra_arte)'
LICENSE = 'CC-BY-SA 4.0 — GeoSampa/Prefeitura de São Paulo'
NOTES = 'Linhas de borda; sem nome, gabarito, limite de peso ou estado de conservação (dado não publicado pela PMSP).'
URL = ('https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs?service=WFS&version=2.0.0&request=GetFeature'
       '&typeNames=geoportal:obra_arte&outputFormat=application/json&srsName=EPSG:4326')
KIND = {'PONTE': 'ponte', 'VIADUTO': 'viaduto', 'PASSARELA': 'passarela', 'TUNEL': 'tunel', 'CALCADAO': 'calcadao'}


def fetch():
    d = json.loads(http_get(URL, cache='geosampa_obra_arte.json', max_age_h=24 * 30))
    out = []
    for f in d['features']:
        p = f['properties']
        kind = KIND.get((p.get('tx_tipo_obra_arte') or '').strip().upper())
        if not kind or kind == 'calcadao':
            continue
        out.append({
            'source_id': str(p['cd_identificador_obra_arte']),
            'geometry': f['geometry'],
            'name': None,
            'kind': kind,
            'props': {'admin': 'municipal', 'municipio': 'São Paulo', 'ano_referencia': (p.get('tx_ano_referencia') or '').strip(),
                      'altura_livre_m': None, 'peso_max_t': None},
        })
    return out
