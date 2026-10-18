"""Restrições de trecho do GOINFRA (camada `rodovias_estaduais`, source `goinfra`, kind `regra_trecho`).

Portaria GOINFRA 20/2026: restrição de CVC e combinações de carga com mais de 3 eixos nos feriados prolongados de 2026/2027 (07h–20h) em rodovias de acesso a cidades turísticas, com `janelas` por data (perecíveis isentos). Também registra, desativada, a interdição anunciada da Ponte Quinca Mariano (GO-139). Pesquisa: docs/research/estados_sul_co/GO.md.

Curadoria em data/raw/ders_estaduais/regras.json (grupo `trechos`, uf GO): cada regra cita ato e artigo/item, tem status
(vigente | desativada | revogada), `ativa`, confiança e, quando o ato vale só em certas datas/horas, `janelas`. A geometria vem
do OpenStreetMap (ways com o ref da rodovia entre âncoras conferidas no SRE do órgão ou em nós `place=*`; ver _ders_sulco.py).

A API (rodovias_estaduais.layer.ts) penaliza o trecho (fator 1000) só para regra ativa e vigente cujo critério alcança o veículo
(e cuja janela vale no instante de saída); desativada só informa; revogada nunca entra.
"""
from __future__ import annotations

from sources._ders_sulco import feicoes_uf, notas_uf

LAYER_ID = 'rodovias_estaduais'
SOURCE = 'goinfra'
SOURCE_URL = 'https://goias.gov.br/goinfra/ (Portaria 20/2026: DOE-GO 24.713 de 04/02/2026, https://diariooficial.abc.go.gov.br/portal/edicoes/download/7044); traçado: OpenStreetMap'
LICENSE = ('Atos oficiais — domínio público (Lei 9.610/98, art. 8º, IV). Geometria derivada do OpenStreetMap (ODbL 1.0, © colaboradores do '
           'OpenStreetMap), extração não substancial. Sem coordenadas da GOINFRA: o traçado é só do OSM.')
NOTES = None


def fetch():
    global NOTES
    feats, sem_spec, falhou = feicoes_uf('GO')
    NOTES = notas_uf('GOINFRA', feats, sem_spec, falhou)
    return feats
