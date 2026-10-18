"""Pedágio das rodovias ESTADUAIS do Rio Grande do Sul: EGR (estatal, 10 praças) e Rota de Santa Maria (RSC-287, AGERGS).

EGR: tabela de tarifas publicada na página "Tarifas" da EGR (5 imagens, uma por grupo de praças; carregadas em 05/2022, sem vigência
informada: confiança média e data_desc na tarifa). Rota de Santa Maria: tarifa 2026 da concessionária, categoria I de R$ 5,40 desde
29/01/2026 (planilha de evolução tarifária da AGERGS). Não entra o Bloco 3 (Caminhos da Serra Gaúcha, free flow): a tabela por
pórtico de 2024 está vencida e só a categoria I de 29/04/2026 foi publicada. Blocos 1 e 2: sem concessionária.
Posição: nós de pedágio do OSM do mesmo operador (nenhuma fonte publica coordenada oficial das praças; método e distância à
âncora ficam em props.posicao_metodo). Praça sem nó do OSM perto da âncora fica na âncora com precisao='aprox'.
Dados curados em data/raw/pedagio/concessoes_estaduais_sul_co.json (ver docs/layers/pedagio_estaduais.md).
"""
from __future__ import annotations
from sources import _toll_estaduais as base

LAYER_ID = 'pedagio'
SOURCE = 'rs-estadual'
SOURCE_URL = ('https://www.egr.rs.gov.br/tarifas-63da9a4171350 + https://rotadesantamaria.com.br/pracas-de-pedagio + https://agergs.rs.gov.br/rodovias-concedidas + data/raw/pedagio/concessoes_estaduais_sul_co.json')
LICENSE = ('Valores de tabelas publicadas pela EGR e pela concessionária (Lei 8.987/1995, art. 9º, §5º; sites sem licença declarada): só os valores, sem as imagens. Posição das praças: OpenStreetMap (ODbL 1.0)')
NOTES = ''


def fetch():
    global NOTES
    out, NOTES = base.run_simple('rs_estadual', lambda conc: ('EGR' if conc['id'].startswith('rs_egr') else 'Concessionária (Rota de Santa Maria)'), 'RS (EGR e Rota de Santa Maria)')
    return out
