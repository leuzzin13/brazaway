"""Pedágio das concessões rodoviárias MUNICIPAIS: Linha Amarela (LAMSA) e Transolímpica (ViaRio), no Rio de Janeiro, e
MGC-393 em Pirapetinga/MG (CRP Concessionária).

Tabelas publicadas pelas concessionárias (Lei 8.987/1995, art. 9º, §5º, incluído pela Lei 13.673/2018: a concessionária
divulga a tabela de tarifas praticadas). Não localizamos o ato da Prefeitura do Rio para as tabelas de 2026, por isso a
confiança é média. As duas tabelas do Rio NÃO são proporcionais ao nº de eixos (ex.: Linha Amarela, 5 eixos R$ 16,10 e
7 ou mais eixos R$ 24,10); transcritas em 10/10/2026 em data/raw/pedagio/concessoes_estaduais.json.

CRP/Pirapetinga: cobrança suspensa por decisão judicial em ação do MPMG (notícia de 13/10/2025), mas o site da CRP e o
OSM indicam cobrança: confiança baixa, registro INATIVO (fica no banco com o motivo e não entra na conta).
Posição: nós de pedágio do OSM do mesmo operador.
"""
from __future__ import annotations
from sources import _toll_estaduais as base

LAYER_ID = 'pedagio'
SOURCE = 'municipais'
SOURCE_URL = ('https://www.lamsa.com.br/www.lamsa.com.br/pages/pedagio.html + https://www.viario.com.br/tarifas-do-pedagio.php + '
              'https://www.crpconcessionaria.com.br/ (tabelas transcritas em data/raw/pedagio/concessoes_estaduais.json)')
LICENSE = ('Tabelas publicadas pelas concessionárias por obrigação legal (Lei 8.987/1995, art. 9º, §5º): só os valores, com citação; '
           'sites sem licença aberta (LAMSA: "todos os direitos reservados"). Posição: OpenStreetMap (ODbL 1.0)')
NOTES = ''


def fetch():
    global NOTES
    d, concs = base.concessoes('municipais')
    nodes = base.osm_toll_nodes()
    out, log, resumo = [], [], []
    for conc in concs:
        fonte = f'Concessionária ({conc["operador"]})'
        tarifa = base.build_tariff(conc, d, fonte, conc.get('ato_url'))
        feats = base.features(conc, d, tarifa, nodes, log=log)
        out += feats
        resumo.append(f'{conc["id"]}: {len(feats)} ponto(s), {"ativo" if conc.get("ativo", True) else "INATIVO (" + conc.get("motivo_inativo", "") + ")"}')
        print(f'  {resumo[-1]}')
    for line in log:
        print('  !', line)
    NOTES = f'Tabelas transcritas em {d.get("transcrito_em")}. ' + '; '.join(resumo) + (' Avisos: ' + ' '.join(log) if log else '')
    return out
