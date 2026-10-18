"""Restrições de trecho do DAER-RS (camada `rodovias_estaduais`, source `daer-rs`, kind `regra_trecho`).

Decisões Normativas do DAER/RS: Estrada do Mar (DN 152/2023, ERS-389), Rota do Sol (DN 135/2021, RSC-453/ERS-486), CR6/CTS11 em 165 trechos com obras de arte (DN 148/2022, Anexo I; 122 com geometria, arquivo rs_dn148_trechos.json) e as regras gerais registradas como desativadas. Pesquisa: docs/research/estados_sul_co/RS.md.

Curadoria em data/raw/ders_estaduais/regras.json (grupo `trechos`, uf RS): cada regra cita ato e artigo/item, tem status
(vigente | desativada | revogada), `ativa`, confiança e, quando o ato vale só em certas datas/horas, `janelas`. A geometria vem
do OpenStreetMap (ways com o ref da rodovia entre âncoras conferidas no SRE do órgão ou em nós `place=*`; ver _ders_sulco.py).

A API (rodovias_estaduais.layer.ts) penaliza o trecho (fator 1000) só para regra ativa e vigente cujo critério alcança o veículo
(e cuja janela vale no instante de saída); desativada só informa; revogada nunca entra.
"""
from __future__ import annotations

from sources._ders_sulco import feicoes_uf, notas_uf

LAYER_ID = 'rodovias_estaduais'
SOURCE = 'daer-rs'
SOURCE_URL = 'https://www.daer.rs.gov.br/restricao-para-veiculos-de-transporte-de-cargas (SRE 08/2026: https://www.daer.rs.gov.br/sistema-rodoviario-estadual); traçado: OpenStreetMap'
LICENSE = ('Atos oficiais — domínio público (Lei 9.610/98, art. 8º, IV). Geometria derivada do OpenStreetMap (ODbL 1.0, © colaboradores do '
           'OpenStreetMap), extração não substancial. Âncoras de trecho: SRE do DAER (planilha rel-sre-082026.xls, licença não declarada; só localiza os trechos dos atos).')
NOTES = None


def fetch():
    global NOTES
    feats, sem_spec, falhou = feicoes_uf('RS')
    NOTES = notas_uf('DAER-RS', feats, sem_spec, falhou)
    return feats
