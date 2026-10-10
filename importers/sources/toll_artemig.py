"""Pedágio das rodovias ESTADUAIS concedidas de Minas Gerais (regulação ARTEMIG, Lei Estadual 25.235/2025).

Concessões com cobrança: Lote 1 Triângulo Mineiro (EPR Triângulo, Contrato 003/2022), Lote 2 Sul de Minas (EPR Sul de
Minas, Contrato 004/2022, com o pórtico free flow da MG-459 em Monte Sião), Lote 3 Varginha-Furnas (EPR Vias do Café,
Contrato 005/2023), MG-050 (Via Nascentes, Contrato SETOP 007/2007) e BR-135/LMG-754 (Ecovias Norte Minas, Contrato
SETOP 004/2018). Lote 7 Ouro Preto–Mariana (Rota da Liberdade): pórticos previstos, cobrança NÃO iniciada (registro
inativo).

A ARTEMIG publica as tabelas e a lista de praças em IMAGEM (sem texto nem API): os valores foram transcritos em
10/10/2026, com a fonte de cada tabela, em data/raw/pedagio/concessoes_estaduais.json. Reajuste do Lote 2 (Deliberação
ARTEMIG 41/2026, R$ 10,60) SUSPENSO pelo TCE-MG em 07/10/2026: fica registrado em props.reajuste_suspenso e não é usado.

Posição: Lote 2 pelas coordenadas oficiais do 1º Termo Aditivo (cláusula 3.1) e o pórtico P8 pelo PER (Apêndice D),
retomado pelo 2º Termo Aditivo; as demais praças pelos nós de pedágio do OSM do mesmo operador (o km da concessão
difere do km do SRE em até 8 km em algumas rodovias, então rodovia+km não serve para a posição). Pórticos do Lote 7:
rodovia+km na malha SRE-MG (aproximado; só para o mapa).
"""
from __future__ import annotations
from sources import _toll_estaduais as base
from sources._sre_mg import SreLocator

LAYER_ID = 'pedagio'
SOURCE = 'artemig'
SOURCE_URL = ('https://artemig.mg.gov.br/artemig/ (páginas das concessões: Lote 1, Lote 2, Lote 3, MG-050, BR-135, Lote 7; tabelas e praças '
              'em imagem transcritas em data/raw/pedagio/concessoes_estaduais.json) + 1º e 2º Termos Aditivos e PER do Lote 2 (posições)')
LICENSE = ('Valores de tabelas e atos oficiais (Lei 9.610/1998, art. 8º, IV), sem reproduzir as imagens; portal ARTEMIG: "todos os direitos '
           'reservados". Posição: coordenadas oficiais dos aditivos/PER e nós de pedágio do OpenStreetMap (ODbL 1.0)')
NOTES = ''
FONTE = 'ARTEMIG'


def fetch():
    global NOTES
    d, concs = base.concessoes('artemig')
    nodes = base.osm_toll_nodes()
    sre = SreLocator()
    out, log, resumo = [], [], []
    for conc in concs:
        url = conc.get('ato_url')
        tarifa = base.build_tariff(conc, d, FONTE, url, extra={'imagem_tabela': conc.get('imagem_tabela')}) if conc.get('tarifa') else None
        feats = base.features(conc, d, tarifa, nodes, sre=sre, log=log)
        out += feats
        ativos = sum(1 for f in feats if f['props']['ativo'])
        metodos = {}
        for f in feats:
            metodos[f['props']['precisao']] = metodos.get(f['props']['precisao'], 0) + 1
        resumo.append(f'{conc["id"]}: {len(feats)} pontos ({ativos} ativos; posição {metodos})')
        print(f'  {resumo[-1]}')
    for line in log:
        print('  !', line)
    NOTES = (f'Tabelas transcritas em {d.get("transcrito_em")}. ' + '; '.join(resumo)
             + (' Avisos: ' + ' '.join(log) if log else '')
             + ' Reajuste do Lote 2 (Deliberação ARTEMIG 41/2026) suspenso pelo TCE-MG: não aplicado.')
    return out
