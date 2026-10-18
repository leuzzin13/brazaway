"""Restrições de trecho do SINFRA-MT (camada `rodovias_estaduais`, source `sinfra-mt`, kind `regra_trecho`).

Portarias da SINFRA-MT de restrição de CVC/carga em trechos que exigem AET: Estrada-Parque MT-040/MT-361 (Portaria 010/2023) e MT-010/MT-246 (Portaria 061/2021, incisos I e III; o inciso IV, MT-251, fica desativado). Pesquisa: docs/research/estados_sul_co/MT.md.

Curadoria em data/raw/ders_estaduais/regras.json (grupo `trechos`, uf MT): cada regra cita ato e artigo/item, tem status
(vigente | desativada | revogada), `ativa`, confiança e, quando o ato vale só em certas datas/horas, `janelas`. A geometria vem
do OpenStreetMap (ways com o ref da rodovia entre âncoras conferidas no SRE do órgão ou em nós `place=*`; ver _ders_sulco.py).

A API (rodovias_estaduais.layer.ts) penaliza o trecho (fator 1000) só para regra ativa e vigente cujo critério alcança o veículo
(e cuja janela vale no instante de saída); desativada só informa; revogada nunca entra.
"""
from __future__ import annotations

from sources._ders_sulco import feicoes_uf, notas_uf

LAYER_ID = 'rodovias_estaduais'
SOURCE = 'sinfra-mt'
SOURCE_URL = 'https://www.iomat.mt.gov.br/ (atos); âncoras: SRE do GeoDados-MT (https://geodados.mt.gov.br/server/rest/services/Hosted/Rodovias_Estaduais/FeatureServer/0); traçado: OpenStreetMap'
LICENSE = ('Atos oficiais — domínio público (Lei 9.610/98, art. 8º, IV). Geometria derivada do OpenStreetMap (ODbL 1.0, © colaboradores do '
           'OpenStreetMap), extração não substancial. Âncoras de trecho: SRE do GeoDados-MT (licença não declarada; só localiza os trechos dos atos).')
NOTES = None


def fetch():
    global NOTES
    feats, sem_spec, falhou = feicoes_uf('MT')
    NOTES = notas_uf('SINFRA-MT', feats, sem_spec, falhou)
    return feats
