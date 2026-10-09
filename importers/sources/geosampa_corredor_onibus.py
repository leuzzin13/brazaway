"""Corredores de ônibus (SPTrans/EMTU) — GeoSampa, camada geoportal:corredor_onibus.

Corredor = faixas à esquerda (canteiro central), segregadas e exclusivas de ônibus em tempo integral.
A camada não traz horário (não há janela: o corredor é sempre exclusivo). Entram só os "Em Operação";
"Em Implantação"/"Futuro" ficam de fora (não têm efeito no trânsito hoje).
"""
from sources.geosampa_faixa_onibus import length_m, wfs_geojson

LAYER_ID = 'corredores_onibus'
SOURCE = 'geosampa-corredor'
SOURCE_URL = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs (typeNames=geoportal:corredor_onibus)'
LICENSE = 'CC-BY-SA 4.0 — GeoSampa/Prefeitura de São Paulo (levantamento SPTrans/EMTU)'
NOTES = 'Só corredores "Em Operação". Linha de eixo do corredor (canteiro central); sem horário (exclusivo em tempo integral).'


def fetch():
    d = wfs_geojson('corredor_onibus', 'geosampa_corredor_onibus.json')
    out = []
    for f in d['features']:
        p = f['properties']
        g = f.get('geometry') or {}
        if g.get('type') not in ('LineString', 'MultiLineString'):
            continue
        status = (p.get('dc_tipo_status_corredor_onibus') or '').strip()
        if status != 'Em Operação':
            continue
        coords = g['coordinates'] if g['type'] == 'LineString' else [c for part in g['coordinates'] for c in part]
        out.append({
            'source_id': str(p['cd_identificador']),
            'geometry': g,
            'name': (p.get('nm_corredor') or '').strip() or None,
            'kind': 'corredor',
            'props': {
                'corredor': (p.get('nm_corredor') or '').strip(), 'id_corredor': p.get('cd_identificador_original'),
                'observacao': (p.get('tx_observacao') or '').strip() or None, 'ano': p.get('an_corredor'),
                'operador': (p.get('nm_origem') or '').strip() or None, 'municipio': (p.get('tx_municipio') or '').strip() or None,
                'extensao_km_corredor': p.get('qt_quilometro'), 'comprimento_m': round(length_m(coords)),
                'status': status, 'atualizado_em': (p.get('dt_atualizacao') or '')[:10] or None,
                'windows': [{'days': [1, 2, 3, 4, 5, 6, 7], 'from': '00:00', 'to': '24:00'}],
                'lado': 'ESQUERDA (canteiro central)',
            },
        })
    return out
