"""Limite do município de São Paulo (IBGE), usado no aviso de LETPP da camada de produtos perigosos.

Decreto municipal 50.446/2009, art. 5º: o transporte de produtos perigosos nas vias públicas do Município de São Paulo só
pode ser feito por transportador inscrito no CTPP e com veículos detentores da LETPP (expedida pelo DSV). A FAQ da PMSP
(2019, item 32) confirma que vale também para carga em quantidade limitada.
"""
import json

from common import http_get

LAYER_ID = 'perigosos'
SOURCE = 'ibge'
SOURCE_URL = 'https://servicodados.ibge.gov.br/api/v3/malhas/municipios/3550308?formato=application/vnd.geo+json&qualidade=intermediaria'
LICENSE = 'IBGE — dados públicos (uso livre com citação da fonte)'
NOTES = 'Malha municipal IBGE, qualidade intermediária; só para o aviso de LETPP.'


def fetch():
    d = json.loads(http_get(SOURCE_URL, cache='ibge_municipio_3550308.json', max_age_h=24 * 180))
    feats = d['features'] if d.get('type') == 'FeatureCollection' else [d]
    g = feats[0]['geometry']
    return [{
        'source_id': '3550308', 'geometry': g, 'name': 'Município de São Paulo', 'kind': 'municipio_letpp',
        'props': {'ibge': '3550308', 'regra': 'LETPP obrigatória para veículo com produto perigoso (inclusive quantidade limitada)',
                  'norma': 'Decreto 50.446/2009', 'artigo': 'art. 5º'},
    }]
