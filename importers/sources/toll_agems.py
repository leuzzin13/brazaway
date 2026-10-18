"""Pedágio das rodovias ESTADUAIS concedidas de Mato Grosso do Sul (AGEMS): Way-306 (MS-306) e Way-112 (MS-112, BR-158, BR-436).

Fonte das tarifas: Portaria AGEMS nº 333, de 07/04/2026 (Way-306, DOE-MS 12.121, vigência 09/04/2026) e Portaria AGEMS nº 326,
de 09/02/2026 (Way-112, DOE-MS 12.071, vigência 11/02/2026; a P6 da BR-436 tem tabela própria, Anexo II). 14 categorias por
eixo e rodagem; acima de 9 eixos vale a categoria 9 + categoria 1 por eixo excedente (nota 2 das portarias). Não entra a
Rota da Celulose (cobrança só a partir de 02/2027, tarifas finais não publicadas).
Posição: nós de pedágio do OSM do mesmo operador (nenhuma fonte publica coordenada oficial das praças; método e distância à
âncora ficam em props.posicao_metodo). Praça sem nó do OSM perto da âncora fica na âncora com precisao='aprox'.
Dados curados em data/raw/pedagio/concessoes_estaduais_sul_co.json (ver docs/layers/pedagio_estaduais.md).
"""
from __future__ import annotations
from sources import _toll_estaduais as base

LAYER_ID = 'pedagio'
SOURCE = 'agems'
SOURCE_URL = ('https://www.diariooficial.ms.gov.br/ (Portarias AGEMS 333/2026 e 326/2026) + data/raw/pedagio/concessoes_estaduais_sul_co.json (praças)')
LICENSE = ('Valores de atos oficiais (Portarias AGEMS 333 e 326/2026): sem proteção autoral (Lei 9.610/1998, art. 8º, IV). Posição das praças: OpenStreetMap (ODbL 1.0)')
NOTES = ''


def fetch():
    global NOTES
    out, NOTES = base.run_simple('agems', lambda conc: 'AGEMS', 'AGEMS (MS)')
    return out
