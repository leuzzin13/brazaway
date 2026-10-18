"""Restrições de trecho do DER-DF (camada `rodovias_estaduais`, source `der-df`, kind `regra_trecho`).

Atos do DER-DF e do GDF sobre rodovias distritais: veículos pesados vedados no Eixo Rodoviário DF-002 (Decreto 32.563/2010, art. 2º), Eixão do Lazer aos domingos e feriados (Decreto 46.226/2024), Barragem do Paranoá DF-001 (Instrução DER-DF 3/2019) e Ponte do Rio Melchior DF-180 (Instrução DER-DF 14/2021, desativada). Pesquisa: docs/research/estados_sul_co/DF.md e cidades_sul_co/res/5300108.json.

Curadoria em data/raw/ders_estaduais/regras.json (grupo `trechos`, uf DF): cada regra cita ato e artigo/item, tem status
(vigente | desativada | revogada), `ativa`, confiança e, quando o ato vale só em certas datas/horas, `janelas`. A geometria vem
do OpenStreetMap (ways com o ref da rodovia entre âncoras conferidas no SRE do órgão ou em nós `place=*`; ver _ders_sulco.py).

A API (rodovias_estaduais.layer.ts) penaliza o trecho (fator 1000) só para regra ativa e vigente cujo critério alcança o veículo
(e cuja janela vale no instante de saída); desativada só informa; revogada nunca entra.
"""
from __future__ import annotations

from sources._ders_sulco import feicoes_uf, notas_uf

LAYER_ID = 'rodovias_estaduais'
SOURCE = 'der-df'
SOURCE_URL = 'https://www.sinj.df.gov.br/sinj/ (atos); traçado: OpenStreetMap (IDE/DF só conferiu km e OAE)'
LICENSE = ('Atos oficiais — domínio público (Lei 9.610/98, art. 8º, IV). Geometria derivada do OpenStreetMap (ODbL 1.0, © colaboradores do '
           'OpenStreetMap), extração não substancial. Sem coordenadas do DER-DF no traçado: só OSM.')
NOTES = None


def fetch():
    global NOTES
    feats, sem_spec, falhou = feicoes_uf('DF')
    NOTES = notas_uf('DER-DF', feats, sem_spec, falhou)
    return feats
