"""Pontes estaduais do ES com PBT máximo em Instrução de Serviço do DER-ES (camada `oae`, source `der-es`).

Curadoria em data/raw/ders_estaduais/regras.json (grupo `pontes`): 17 IS de 2024–2026 achadas no DIO-ES (busca
full-text) pela pesquisa vitoria_es (der_es_is_restricoes.csv) e conferidas de novo em 10/10/2026: texto, número da IS,
página e ausência de ato posterior que cite a mesma OAE. Todas "por tempo indeterminado" e em vigor na publicação
(art. 2º de cada IS). Três (Jacarandá, Calçado, Fundão) também constam da verify vitoria_es (confiança alta); as demais,
média.

Cada ponte vira feição com `peso_max_t` (e `eixo_max_t` quando o ato tem limite por eixo), `restricao` (tipo 'peso',
vigente desde a publicação) e `bloqueio` sobre o tabuleiro: a aresta marcada como ponte no OSM mais perto da coordenada
do ato (SIRGAS 2000), conferida no /locate do Valhalla. Ato sem coordenada: ponto pelo km no SRE do DER-ES e ponte do
OSM mais próxima. A camada oae bloqueia (exclusão pequena) quem pesa mais que o limite.
"""
from __future__ import annotations

from sources._ders import carrega_regras, ponte_por_km_sre, snap_ponte

LAYER_ID = 'oae'
SOURCE = 'der-es'
SOURCE_URL = 'data/raw/ders_estaduais/regras.json (Instruções de Serviço do DER-ES no DIO-ES: https://ioes.dio.es.gov.br/busca)'
LICENSE = ('Atos oficiais — domínio público (Lei 9.610/98, art. 8º, IV); ponto de bloqueio ajustado no grafo do OSM '
           '(ODbL 1.0, extração não substancial). Mantida fora do OSM.')
NOTES = None


def fetch():
    global NOTES
    d = carrega_regras()
    verificado = d.get('verificado_em')
    out, sem_bloqueio = [], []
    for r in d['pontes']:
        if r.get('lat') is not None and r.get('lon') is not None:
            ponto = (float(r['lon']), float(r['lat']))
            b = snap_ponte(ponto, r['rodovia'])
            local = 'coordenada do ato (SIRGAS 2000)'
        elif r.get('localizar'):
            ponto, b = ponte_por_km_sre(r['localizar']['sre'], float(r['localizar']['km']), r['rodovia'])
            local = f'km {str(r["localizar"]["km"]).replace(".", ",")} no SRE do DER-ES ({r["localizar"]["sre"]})'
            if ponto is None:
                raise RuntimeError(f'{r["regra_id"]}: não achei o km no SRE do DER-ES')
        else:
            raise ValueError(f'{r["regra_id"]}: ponte sem coordenada nem km para localizar')
        if not b or b.get('ajuste') in ('ponto_original', 'sem_valhalla'):
            sem_bloqueio.append(r['regra_id'])
        pbt = float(r['peso_max_t'])
        eixo = float(r['eixo_max_t']) if r.get('eixo_max_t') else None
        km = r.get('km')
        restricao = {
            'tipo': 'peso', 'valor': pbt, 'unidade': 't', 'aplica_a': r['resumo'],
            'criterio': {'peso_acima_t': pbt}, 'sentido': None,
            'status': 'vigente' if r['ativa'] else 'historica', 'inicio': r['publicacao'], 'fim': None,
            'ato': r['ato'], 'fonte_url': r['ato_url'], 'fonte_data': r['publicacao'],
            'liberacao': None, 'liberacao_url': None, 'liberacao_data': None, 'liberacao_fonte': None,
            'verificado_em': verificado, 'orgao': 'DER-ES', 'obs': r.get('obs'),
        }
        nome = f'{r["nome"]} — {r["rodovia"]}' + (f' km {str(km).replace(".", ",")}' if km is not None else '')
        props = {
            'admin': 'estadual (DER-ES)', 'rodovia': r['rodovia'], 'km': km, 'municipio': r.get('municipio'),
            'oae_codigo': r['oae_codigo'], 'peso_max_t': pbt, 'eixo_max_t': eixo, 'altura_livre_m': None,
            'restricao': restricao, 'localizacao': local, 'confianca': r['confianca'], 'verificacao': r.get('verificacao'),
        }
        if b and b.get('ajuste') not in ('ponto_original', 'sem_valhalla'):
            props['bloqueio'] = {'modo': 'sobre', **b}
        out.append({
            'source_id': r['regra_id'],
            'geometry': {'type': 'Point', 'coordinates': [round(ponto[0], 6), round(ponto[1], 6)]},
            'name': nome, 'kind': 'ponte',
            'props': {k: v for k, v in props.items() if v is not None},
        })
    NOTES = (f'{len(out)} pontes estaduais do ES com PBT máximo em IS do DER-ES (2024–2026); verificado em {verificado}. '
             f'Sem ponto de bloqueio confirmado no grafo (só avisam): {", ".join(sem_bloqueio) or "nenhuma"}.')
    return out
