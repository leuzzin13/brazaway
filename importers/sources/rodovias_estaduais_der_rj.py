"""Restrições de trecho do DER-RJ (camada `rodovias_estaduais`, source `der-rj`, kind `regra_trecho`).

O DER-RJ não publica portaria de feriado, cadastro de OAE, lista de balanças nem painel de interdições
(docs/layers/rodovias_estaduais.md). O que existe são notícias: a RJ-127 (Serra de Paracambi) teve pesados proibidos
durante a obra (09/2024 a pelo menos 07/2025). Sem ato normativo e sem confirmação em 10/2026, a regra entra
DESATIVADA (só informa). Curadoria em data/raw/ders_estaduais/regras.json (grupo `trechos`, uf RJ); a geometria é o
caminho de carro entre os pontos da curadoria no grafo do Valhalla (OSM).
"""
from __future__ import annotations

from sources._ders import carrega_regras, comprimento_km, feicao_trecho, rota_osm

LAYER_ID = 'rodovias_estaduais'
SOURCE = 'der-rj'
SOURCE_URL = 'data/raw/ders_estaduais/regras.json (notícias oficiais do DER-RJ: https://www.der.rj.gov.br); traçado: OpenStreetMap via Valhalla'
LICENSE = ('Fatos de notícias oficiais do DER-RJ, com citação (rodapé PRODERJ: todos os direitos reservados); traçado derivado do '
           'OpenStreetMap (ODbL 1.0, © colaboradores do OpenStreetMap), extração não substancial')
NOTES = None


def fetch():
    global NOTES
    regras = [r for r in carrega_regras()['trechos'] if r['uf'] == 'RJ']
    out, sem_geom = [], []
    for r in regras:
        spec = r.get('geometria') or {}
        g = rota_osm(spec['osm_rota']['de'], spec['osm_rota']['para']) if spec.get('osm_rota') else None
        if not g:
            sem_geom.append(r['regra_id'])
            continue
        out.append(feicao_trecho(r, g, {'metodo': 'rota de carro no Valhalla (OSM)', 'extensao_km': comprimento_km(g)}))
    NOTES = (f'{len(regras)} regra(s) do DER-RJ na curadoria, todas desativadas (sem ato normativo confirmado); '
             f'{len(out)} com traçado; sem traçado: {", ".join(sem_geom) or "nenhuma"}. Sem cadastro de OAE nem lista de balanças do DER-RJ.')
    return out
