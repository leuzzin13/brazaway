"""Pedágio das rodovias ESTADUAIS concedidas de Mato Grosso (regulação AGER/MT): Morro da Mesa (MT-130), Via Brasil MT-246, MT-320/MT-208 e MT-100.

Fonte das tarifas: decisões da Diretoria Executiva da AGER/MT publicadas no Diário Oficial de MT (reajuste anual da tarifa básica;
as demais categorias seguem o multiplicador de eixos do contrato) e as tabelas por categoria das concessionárias (site; tabela
em imagem transcrita em 18/10/2026). Não entram: Rota dos Grãos (MT-130; tarifa de 14/10/2026 condicionada a ato e
pórticos free flow sem coordenada), Via Norte Sul (MT-220), Intervias, APASI, SPS e Rodovia da Mudança (sem tabela por categoria
oficial atual) e as concessões da Fase 1 e 2 do programa estadual (cobrança não confirmada).
Posição: nós de pedágio do OSM do mesmo operador (nenhuma fonte publica coordenada oficial das praças; método e distância à
âncora ficam em props.posicao_metodo). Praça sem nó do OSM perto da âncora fica na âncora com precisao='aprox'.
Dados curados em data/raw/pedagio/concessoes_estaduais_sul_co.json (ver docs/layers/pedagio_estaduais.md).
"""
from __future__ import annotations
from sources import _toll_estaduais as base

LAYER_ID = 'pedagio'
SOURCE = 'agermt'
SOURCE_URL = ('https://iomat.mt.gov.br/ (decisões da AGER/MT) + sites das concessionárias (morrodamesa.com.br, mt246.com.br, mt320.com.br, mt100.com.br) + data/raw/pedagio/concessoes_estaduais_sul_co.json')
LICENSE = ('Valores de decisões oficiais da AGER/MT (Lei 9.610/1998, art. 8º, IV) e de tabelas publicadas pelas concessionárias por obrigação legal (Lei 8.987/1995, art. 9º, §5º): só os valores, sem as imagens. Posição das praças: OpenStreetMap (ODbL 1.0)')
NOTES = ''


def fetch():
    global NOTES
    out, NOTES = base.run_simple('agermt', lambda conc: 'AGER/MT', 'AGER/MT')
    return out
