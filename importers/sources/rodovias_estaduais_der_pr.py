"""Restrições de trecho do DER-PR (camada `rodovias_estaduais`, source `der-pr`, kind `regra_trecho`).

Portarias do DER/PR (SEIL) de limite de peso/comprimento/eixos em trechos de rodovias estaduais (todas permanentes, 24 h), incluindo a Ponte de Guaratuba (Portaria 239/2026), a Estrada da Graciosa (075/2023) e os trechos PRC-466/PRC-272 (451/2026). Pesquisa: docs/research/estados_sul_co/PR.md. Fora da camada: portarias de liberação de CVC por AET (permissão, não restrição) e o ferry boat de Guaratuba (Portaria 702/2025, vencida).

Curadoria em data/raw/ders_estaduais/regras.json (grupo `trechos`, uf PR): cada regra cita ato e artigo/item, tem status
(vigente | desativada | revogada), `ativa`, confiança e, quando o ato vale só em certas datas/horas, `janelas`. A geometria vem
do OpenStreetMap (ways com o ref da rodovia entre âncoras conferidas no SRE do órgão ou em nós `place=*`; ver _ders_sulco.py).

A API (rodovias_estaduais.layer.ts) penaliza o trecho (fator 1000) só para regra ativa e vigente cujo critério alcança o veículo
(e cuja janela vale no instante de saída); desativada só informa; revogada nunca entra.
"""
from __future__ import annotations

from sources._ders_sulco import feicoes_uf, notas_uf

LAYER_ID = 'rodovias_estaduais'
SOURCE = 'der-pr'
SOURCE_URL = 'https://www.der.pr.gov.br/Pagina/Restricao-de-Trafego (atos no portal da Casa Civil: https://www.legislacao.pr.gov.br); âncoras: SRE do DER-PR (https://geoserver.pr.gov.br/geoserver/ows); traçado: OpenStreetMap'
LICENSE = ('Atos oficiais — domínio público (Lei 9.610/98, art. 8º, IV). Geometria derivada do OpenStreetMap (ODbL 1.0, © colaboradores do '
           'OpenStreetMap), extração não substancial. Âncoras de trecho: SRE do DER/PR (licença não declarada; só localiza os trechos dos atos).')
NOTES = None


def fetch():
    global NOTES
    feats, sem_spec, falhou = feicoes_uf('PR')
    NOTES = notas_uf('DER-PR', feats, sem_spec, falhou)
    return feats
