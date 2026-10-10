"""Restrições de trecho do DER-ES (camada `rodovias_estaduais`, source `der-es`, kind `regra_trecho`).

Curadoria em data/raw/ders_estaduais/regras.json (grupo `trechos`, uf ES): cada regra cita ato e artigo/item, tem
status (vigente | desativada | revogada), `ativa` e confiança. A geometria vem do SRE do DER-ES (WFS do GEOBASES,
geonode:der_rodovias_es_epsg_31984): segmentos inteiros (`sre`) ou recorte por km (`sigla`, `km_ini`, `km_fim`).
Regras sem geometria (revogadas ou sem trecho definido) ficam só na curadoria e na doc (contadas em NOTES).

A API (rodovias_estaduais.layer.ts) penaliza o trecho (fator 1000) só para regra ativa e vigente cujo critério alcança
o veículo; desativada só informa; revogada nunca entra. Pontes do ES com PBT máximo: importador oae_der_es (camada oae).
"""
from __future__ import annotations

from sources._ders import LICENCA_SRE_ES, carrega_regras, comprimento_km, feicao_trecho, geometria_sre_es

LAYER_ID = 'rodovias_estaduais'
SOURCE = 'der-es'
SOURCE_URL = 'data/raw/ders_estaduais/regras.json (atos do DER-ES no DIO-ES: https://ioes.dio.es.gov.br/busca); geometria: SRE do DER-ES (https://ide.geobases.es.gov.br/geoserver/ows)'
LICENSE = f'Atos oficiais — domínio público (Lei 9.610/98, art. 8º, IV). Geometria: {LICENCA_SRE_ES}'
NOTES = None


def fetch():
    global NOTES
    regras = [r for r in carrega_regras()['trechos'] if r['uf'] == 'ES']
    out, sem_geom = [], []
    for r in regras:
        spec = r.get('geometria')
        if not spec:
            sem_geom.append(r['regra_id'])
            continue
        g, info = geometria_sre_es(spec)
        if not g:
            raise RuntimeError(f'{r["regra_id"]}: SRE do DER-ES não devolveu geometria para {spec} ({info})')
        info['extensao_km'] = comprimento_km(g)
        out.append(feicao_trecho(r, g, info))
    ativas = [f['source_id'] for f in out if f['props']['ativa']]
    NOTES = (f'{len(regras)} regras do DER-ES na curadoria: {len(out)} com geometria ({len(ativas)} ativas: {", ".join(ativas)}); '
             f'sem geometria (só registro): {", ".join(sem_geom)}.')
    return out
