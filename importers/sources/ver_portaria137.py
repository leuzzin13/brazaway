"""VER — Vias Estruturais Restritas da cidade de São Paulo.

Regra: Portaria 137/2018-SMT.GAB, art. 2º, §§ 1º a 4º (texto compilado no Catálogo de Legislação Municipal, conferido em
09/10/2026), mais o § 5º criado pela Portaria SMT.GAB 49/2021, que ainda NÃO está em vigor (art. 3º: só a partir da
conclusão e liberação do trecho norte do Rodoanel). As feições do § 5º vão com `ativo: false`; quando a portaria vigorar,
o § 5º substitui os incisos I a IV do § 4º (art. 2º da Portaria 49/2021) — a API troca com VER_PORTARIA_49_VIGENTE=1.

Geometria: não existe base oficial aberta das VER (o GeoSampa não publica; os My Maps da CET estão incompletos e sem
licença). Cada inciso foi casado com vias do OpenStreetMap (PBF local do Valhalla) pelo nome da via e pelos limites
descritos na portaria ("entre X e Y", "sentido A-B", "toda extensão"):
  1. extrai as vias `highway=*` do município com osmium (cache em data/cache/ver/sp_highways.opl);
  2. para cada inciso, pega as vias com o(s) nome(s) do OSM dentro de um retângulo de busca;
  3. modos de casamento:
     - "toda extensão": todas essas vias (opcionalmente recortadas pelo retângulo, `clip`);
     - `segs`: menor caminho (respeitando mão única) entre os nós em que a via cruza X e Y (ou um ponto fixo, quando
       X/Y é praça/ponte sem nó comum), nos dois sentidos ou só no sentido indicado;
     - `corredor`: pistas paralelas (todas as denominações) entre dois pontos, filtradas por sentido de circulação e
       por pista (local/central/expressa) — usado nas marginais;
     - `dir`: mantém só as cadeias cujo rumo bate com o sentido proibido (ex.: ponte "sentido Norte-Sul");
  4. monta cadeias DIRIGIDAS (no sentido de circulação proibido). É isso que vai para o Valhalla: linear_cost_factors
     faz "edge walk" orientado (linha no sentido contrário não penaliza nada; linha que não casa com o grafo derruba a
     requisição inteira com erro 233 — por isso cada cadeia é testada no Valhalla aqui e de novo na API);
  5. compara com os My Maps da CET (KML) só como conferência (% da extensão casada a até 40 m de uma linha da CET).
Precisa do binário `osmium` (osmium-tool) só quando o cache OPL não existe ou está mais velho que o PBF. Na imagem:
  docker compose --profile import run --rm -v $PWD/data/valhalla:/pbf --entrypoint sh importer -c \
     "apt-get update -qq && apt-get install -y -qq osmium-tool && OSM_PBF=/pbf/sudeste-latest.osm.pbf python run.py ver_portaria137"
Variáveis: OSM_PBF (default DATA_DIR/valhalla/sudeste-latest.osm.pbf), VALHALLA_URL (default http://valhalla:8002;
VALHALLA_URL=off pula a checagem), VER_DEBUG=1 imprime o casamento por inciso.

LICENÇA: o texto da portaria é ato oficial (Lei 9.610/98, art. 8º, IV). A geometria é derivada do OpenStreetMap
(© colaboradores do OpenStreetMap, ODbL 1.0) — base derivada: atribuir e manter sob ODbL se for redistribuída.
Os KML da CET não entram no seed (sem licença explícita): só a % de conferência.
"""
from __future__ import annotations

import heapq
import json
import math
import os
import pathlib
import re
import subprocess
import unicodedata
from collections import defaultdict

import requests

from common import CACHE_DIR, DATA_DIR, http_get

LAYER_ID = 'ver'
SOURCE = 'smt-137-2018'
SOURCE_URL = ('https://legislacao.prefeitura.sp.gov.br/leis/portaria-secretaria-municipal-de-mobilidade-e-transportes-smt-137-de-3-de-agosto-de-2018'
              ' (art. 2º compilado) + https://legislacao.prefeitura.sp.gov.br/leis/portaria-secretaria-municipal-de-mobilidade-e-transito-smt-49-de-8-de-outubro-de-2021'
              ' ; geometria: OpenStreetMap (Geofabrik sudeste-latest)')
LICENSE = ('Regras: ato oficial, sem proteção autoral (Lei 9.610/98, art. 8º, IV). '
           'Geometria: derivada do OpenStreetMap, © colaboradores do OpenStreetMap, ODbL 1.0.')
NOTES = ('Art. 2º: 79 incisos dos §§1º–4º (vigentes desde 03/10/2018) + 2 do §5º (Portaria 49/2021, inativo até a liberação do '
         'Rodoanel Norte); 77+2 com geometria (Passagem Tom Jobim e Vd. Gazeta do Ipiranga sem via no OSM). Uma feição por '
         'inciso, cadeias dirigidas no sentido proibido, casadas por nome/limites sobre o OSM e conferidas com os My Maps da CET.')

OSM_PBF = pathlib.Path(os.environ.get('OSM_PBF', str(DATA_DIR / 'valhalla' / 'sudeste-latest.osm.pbf')))
WORK = CACHE_DIR / 'ver'
SP_BBOX = (-46.83, -24.01, -46.36, -23.35)
DEBUG = os.environ.get('VER_DEBUG') == '1'
VALHALLA_URL = os.environ.get('VALHALLA_URL', 'http://valhalla:8002')

# Vias em que caminhão pode trafegar. busway/pedestrian ficam de fora; `service` só quando o inciso pede (hw=...).
MOTOR = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'motorway_link', 'trunk_link',
         'primary_link', 'secondary_link', 'tertiary_link', 'living_street', 'service', 'road'}
DEFAULT_HW = MOTOR - {'service', 'living_street'}

CET_KML = {  # Google My Maps da CET (sem licença explícita): só conferência, nunca entra no seed
    'cet1': 'https://www.google.com/maps/d/kml?mid=z9TqTcegPvdk.kotJ30qs8z8A&forcekml=1',  # VER §1
    'cet2': 'https://www.google.com/maps/d/kml?mid=z9TqTcegPvdk.kT3jAfulmRU0&forcekml=1',  # VER §4
    'cet3': 'https://www.google.com/maps/d/kml?mid=z9TqTcegPvdk.kj1m9B2XHemE&forcekml=1',  # VER §2/§3
}

# ----------------------------------------------------------------------------------------------------------------
# Regras por parágrafo (Portaria 137/2018 art. 2º) e exceções do Capítulo III que dá para modelar com o perfil do veículo.
# Conferido no texto compilado (legislacao.prefeitura.sp.gov.br) em 09/10/2026. dias ISO: 1=seg ... 7=dom.
# Exceções que dependem de serviço sem campo no perfil (guincho art. 20, reportagem art. 21, sinalização art. 23, zoonose
# art. 24, obras essenciais art. 25, vacinas art. 26, feiras art. 29, lixo art. 31, entulho art. 33, caçambas art. 34,
# valores art. 36 (Portaria 154/2018), material de construção art. 37, postal art. 38, estacionamento próprio art. 19)
# NÃO são modeladas: a API avisa que pode haver AETC específica.
SEMANA = [1, 2, 3, 4, 5]
J_05_21 = [{'days': SEMANA, 'from': '05:00', 'to': '21:00'}, {'days': [6], 'from': '10:00', 'to': '14:00'}]
J_S4 = [{'days': SEMANA, 'from': '05:00', 'to': '09:00'}, {'days': SEMANA, 'from': '17:00', 'to': '21:00'},
        {'days': [6], 'from': '10:00', 'to': '14:00'}]
EXC_S4 = [{'days': SEMANA, 'from': '05:00', 'to': '09:00'}, {'days': [6], 'from': '10:00', 'to': '14:00'}]
# art. 27 I / 28 I / 30 I: "no período das 05 às 16 horas" (sem dia: vale em todo dia em que a VER restringe)
J_05_16 = [{'days': [1, 2, 3, 4, 5, 6], 'from': '05:00', 'to': '16:00'}]
# art. 32 I: "no período das 05 às 12 horas e aos sábados das 10 às 14 horas"
J_PEREC_123 = [{'days': SEMANA, 'from': '05:00', 'to': '12:00'}, {'days': [6], 'from': '10:00', 'to': '14:00'}]

EXC_VUC = {'codigo': 'vuc_aetc', 'artigo': 'Portaria 137/2018, art. 18', 'janelas': 'integral',
           'texto': 'VUC com AETC: liberado em período integral'}
EXC_PEREC_123 = {'codigo': 'perecivel_aetc', 'artigo': 'Portaria 137/2018, art. 32, I', 'janelas': J_PEREC_123,
                 'texto': 'Perecíveis com AETC: seg–sex 05h–12h e sáb 10h–14h'}
EXC_CONCRETO_123 = {'codigo': 'concreto_aetc', 'artigo': 'Portaria 137/2018, arts. 27, I e 28, I', 'janelas': J_05_16,
                    'texto': 'Concretagem com AETC: 05h–16h'}
EXC_MUDANCA_23 = {'codigo': 'mudanca_aetc', 'artigo': 'Portaria 137/2018, art. 30, I', 'janelas': J_05_16,
                  'texto': 'Mudança com AETC: 05h–16h'}
TXT_EXC_S4 = 'seg–sex 05h–09h e sáb 10h–14h'

PARAGRAFOS = {
    1: {
        'kind': 'ver_s1', 'janelas': J_05_21, 'horario': 'seg–sex 05h–21h; sáb 10h–14h; exceto feriados',
        'norma': 'Portaria SMT.GAB 137/2018, art. 2º, § 1º',
        'excecoes': [EXC_PEREC_123, {**EXC_CONCRETO_123, 'texto': 'Concretagem com AETC (itinerário na AETC): 05h–16h'}],
        'vuc': 'VUC proibido mesmo com AETC (art. 18 só libera ZMRC, ZERC e VER dos §§ 2º a 4º)',
    },
    2: {
        'kind': 'ver_s2', 'janelas': J_05_21, 'horario': 'seg–sex 05h–21h; sáb 10h–14h; exceto feriados',
        'norma': 'Portaria SMT.GAB 137/2018, art. 2º, § 2º',
        'excecoes': [EXC_VUC, EXC_PEREC_123, EXC_CONCRETO_123, EXC_MUDANCA_23],
        'vuc': 'VUC com AETC liberado em período integral (art. 18)',
    },
    3: {
        'kind': 'ver_s3', 'janelas': J_05_21, 'horario': 'seg–sex 05h–21h; sáb 10h–14h; exceto feriados',
        'norma': 'Portaria SMT.GAB 137/2018, art. 2º, § 3º',
        'excecoes': [EXC_VUC, EXC_PEREC_123, EXC_CONCRETO_123, EXC_MUDANCA_23],
        'vuc': 'VUC com AETC liberado em período integral (art. 18)',
    },
    4: {
        'kind': 'ver_s4', 'janelas': J_S4, 'horario': 'seg–sex 05h–09h e 17h–21h; sáb 10h–14h; exceto feriados',
        'norma': 'Portaria SMT.GAB 137/2018, art. 2º, § 4º',
        'excecoes': [
            EXC_VUC,
            {'codigo': 'perecivel_aetc', 'artigo': 'Portaria 137/2018, art. 32, II', 'janelas': EXC_S4, 'texto': f'Perecíveis com AETC: {TXT_EXC_S4}'},
            {'codigo': 'concreto_aetc', 'artigo': 'Portaria 137/2018, arts. 27, II e 28, II', 'janelas': EXC_S4, 'texto': f'Concretagem com AETC: {TXT_EXC_S4}'},
            {'codigo': 'mudanca_aetc', 'artigo': 'Portaria 137/2018, art. 30, II', 'janelas': EXC_S4, 'texto': f'Mudança com AETC: {TXT_EXC_S4}'},
        ],
        'vuc': 'VUC com AETC liberado em período integral (art. 18)',
    },
    5: {  # Portaria SMT.GAB 49/2021 — NÃO vigente (art. 3º)
        'kind': 'ver_s5', 'janelas': 'integral', 'horario': 'proibido em qualquer horário; exceto feriados',
        'norma': 'Portaria SMT.GAB 137/2018, art. 2º, § 5º (incluído pela Portaria SMT.GAB 49/2021)',
        'excecoes': [
            {'codigo': 'od_municipio', 'artigo': 'Portaria 137/2018, art. 38-A (incluído pela Portaria 49/2021)', 'janelas': 'integral',
             'proibido_com_aetc': J_05_21,
             'texto': 'Carga com origem/destino no município: liberada; quem tem AETC segue proibido seg–sex 05h–21h e sáb 10h–14h (art. 38-A, parágrafo único)'},
        ],
        'vuc': 'Sem exceção para VUC no § 5º',
        'ativo': False,
        'vigencia': 'Ainda não vigente: aguarda a conclusão e liberação do trecho norte do Rodoanel (Portaria 49/2021, art. 3º)',
    },
}
VIGENCIA_137 = 'Vigente desde 03/10/2018 (Portaria 137/2018, art. 44: 60 dias após a publicação)'


# ----------------------------------------------------------------------------------------------------------------
# Incisos. names = nomes exatos no OSM (sem acento/caixa); bbox = retângulo de busca (lon/lat);
#   segs = [(A, B, sentido[, snap_m])]: A/B = regex do nome da transversal | (lon, lat[, raio_m]); sentido 'both' | 'ab' (só A→B)
#   cor  = corredor: dict(a, b, sentido 'both'|'ab'|'ba', width_m, axis_re) — pistas paralelas entre a e b
#   clip = recorta as arestas pelo bbox; dir = rumo (graus) do sentido proibido, filtra cadeias; pista = 'expressa' |
#   'nao_expressa' | 'nao_local'; hw = tipos highway aceitos (default: DEFAULT_HW); names_re = regex extra de nome;
#   exclude_re = regex de nomes a descartar; sentido_txt = texto do sentido para o app; nota = decisão de casamento.
def T(par, inc, nome, texto, names, bbox, **kw):
    return dict(par=par, inc=inc, nome=nome, texto=texto, names=names, bbox=bbox, **kw)


def C(a, b, sentido='both', width=60, axis_re=None):
    return dict(a=a, b=b, sentido=sentido, width=width, axis_re=axis_re)


AMBOS = 'ambos os sentidos'
# Marginal Tietê "em todas as suas denominações" (pistas local, central e expressa, as duas margens)
MT_RE = (r'^(marginal tiete|avenida marginal tiete|avenida (presidente castel+o branco|otaviano alves de lima|'
         r'morvan dias de figueiredo|condessa elis[a-z]+ de robiano|embaixador macedo soares|assis chateaubriand))')
MT_HW = {'motorway', 'trunk', 'primary'}
MT_EXCL = r'rodovia|ponte'
# Marginal Pinheiros "em todas as suas denominações"
MP_NAMES = ['Marginal Pinheiros (Expressa)', 'Marginal Pinheiros (Local)', 'Avenida Doutora Ruth Cardoso', 'Avenida das Nações Unidas',
            'Rua Hungria']
MP_HW = {'motorway', 'trunk', 'primary', 'secondary'}
# pontos de referência (lon, lat, raio_m)
P_CEBOLAO = (-46.7480, -23.5267, 300)            # km 0 da Marginal Tietê (Cebolão)
P_ARICANDUVA = (-46.5585, -23.5230, 300)         # Ponte Aricanduva
P_RAIMUNDO = (-46.7098, -23.5075, 300)           # Av. Raimundo Pereira de Magalhães
P_BOTOCUDOS = (-46.7245, -23.5150, 300)          # R. dos Botocudos (Lapa)
P_AYRTON = (-46.5530, -23.5085, 300)             # início da Rod. Ayrton Senna
P_JAGUARE = (-46.7345, -23.5460, 300)            # Ponte do Jaguaré
P_MORUMBI = (-46.7005, -23.6188, 300)            # Ponte do Morumbi
P_JORGE_LIMA = (-46.7044, -23.5728, 80)          # Pça. Jorge Lima (largo Eusébio Matoso x Vital Brasil; praça sem via no OSM)
P_OSWALDO_CRUZ = (-46.6445, -23.5710, 80)        # Pça. Oswaldo Cruz (Paulista x Bernardino de Campos)

TRECHOS: list[dict] = [
    # ---------------------------------------------------------------- § 1º (seg–sex 05–21h, sáb 10–14h; VUC proibido)
    T(1, 'I', 'Av. Paulista', 'Av. Paulista, entre R. da Consolação e Pça. Oswaldo Cruz',
      ['Avenida Paulista'], (-46.666, -23.574, -46.641, -23.553),
      cor=C('rua da consolacao', P_OSWALDO_CRUZ, width=60), sentido_txt=AMBOS),
    T(1, 'II', 'Av. Rebouças', 'Av. Rebouças, entre Av. Paulista e Av. Brig. Faria Lima',
      ['Avenida Rebouças', 'Túnel Jornalista Fernando Vieira de Melo', 'Túnel Noite Ilustrada'], (-46.693, -23.576, -46.660, -23.553),
      cor=C('avenida paulista|doutor arnaldo|rua da consolacao', 'brigadeiro faria lima', width=60), sentido_txt=AMBOS),
    T(1, 'III', 'Av. Eusébio Matoso', 'Av. Eusébio Matoso, toda extensão',
      ['Avenida Eusébio Matoso', 'Avenida Euzébio Matoso'], (-46.706, -23.575, -46.686, -23.566),
      hw=DEFAULT_HW | {'service'}, clip=True, sentido_txt=AMBOS,
      nota='Inclui as pistas laterais com o mesmo nome; a Ponte Eusébio Matoso (nome próprio) fica de fora.'),
    T(1, 'IV', 'Av. Prof. Francisco Morato', 'Av. Prof. Francisco Morato, entre Av. Prof. Manfredo Leite e Pça. Jorge Lima',
      ['Avenida Professor Francisco Morato'], (-46.752, -23.610, -46.700, -23.568),
      cor=C('manfredo leite', P_JORGE_LIMA, width=60), sentido_txt=AMBOS,
      nota='A Pça. Jorge Lima não existe como via no OSM: limite no largo da Av. Eusébio Matoso x Av. Vital Brasil.'),
    T(1, 'V', 'Av. Nove de Julho', 'Av. Nove de Julho, toda extensão',
      ['Avenida Nove de Julho', 'Passagem Subterrânea Daher Elias Cutait'], (-46.690, -23.585, -46.635, -23.544),
      clip=True, sentido_txt=AMBOS, nota='Inclui a passagem subterrânea sob a Av. Paulista (continuidade da via).'),
    T(1, 'VI', 'Av. Cidade Jardim', 'Av. Cidade Jardim, entre Av. Brig. Haroldo Veloso e Av. Nove de Julho',
      ['Avenida Cidade Jardim', 'Túnel Max Feffer'], (-46.695, -23.591, -46.678, -23.575),
      cor=C('haroldo veloso', 'avenida nove de julho', width=60), sentido_txt=AMBOS,
      nota='No OSM a via é "Rua Brigadeiro Haroldo Veloso".'),
    T(1, 'VII', 'Av. São Gabriel', 'Av. São Gabriel, toda extensão',
      ['Avenida São Gabriel'], (-46.682, -23.590, -46.665, -23.573), clip=True, sentido_txt=AMBOS),
    T(1, 'VIII', 'Av. Santo Amaro', 'Av. Santo Amaro, entre Av. São Gabriel e R. São Sebastião',
      ['Avenida Santo Amaro', 'Túnel Takeharu Akagawa', 'Viaduto Santo Amaro', 'Viaduto Engenheiro Antonio Moliterno'],
      (-46.700, -23.640, -46.664, -23.574),
      cor=C('avenida sao gabriel', 'rua sao sebastiao', width=60), sentido_txt=AMBOS,
      nota='Inclui túnel e viadutos na continuidade da avenida (definição de VER, CET).'),
    T(1, 'IX', 'Av. Santos Dumont (Luz)', 'Av. Santos Dumont, entre R. dos Bandeirantes e Pte. das Bandeiras',
      ['Avenida Santos Dumont'], (-46.640, -23.5300, -46.626, -23.5195), clip=True, sentido_txt=AMBOS,
      nota='A R. dos Bandeirantes não está no OSM com esse nome: limite sul no encontro com a Av. Tiradentes (Armênia); '
           'limite norte na cabeceira sul da Ponte das Bandeiras. Inclui pista central e pistas externas.'),
    T(1, 'X', 'Av. Tiradentes', 'Av. Tiradentes, entre R. dos Bandeirantes e Av. Prestes Maia',
      ['Avenida Tiradentes'], (-46.640, -23.5356, -46.626, -23.5195), clip=True, sentido_txt=AMBOS,
      nota='Toda a Av. Tiradentes ao norte da Av. Prestes Maia, inclusive a pista externa até a Ponte das Bandeiras '
           '(como no mapa da CET).'),
    T(1, 'XI', 'Av. Prestes Maia', 'Av. Prestes Maia, toda extensão',
      ['Avenida Prestes Maia', 'Túnel São João Paulo II'], (-46.642, -23.552, -46.628, -23.533), clip=True, sentido_txt=AMBOS,
      nota='Inclui o Túnel São João Paulo II (Anhangabaú), continuidade da Prestes Maia/23 de Maio.'),
    T(1, 'XII', 'Passagem Tom Jobim', 'Passagem Tom Jobim',
      ['Passagem Tom Jobim', 'Passagem Subterrânea Tom Jobim'], (-46.645, -23.555, -46.625, -23.515), sentido_txt=AMBOS,
      nota='Sem via com esse nome no OSM; a CET a agrupa com Prestes Maia/Tiradentes, que já estão na camada.'),
    T(1, 'XIII', 'Av. Rio Branco', 'Av. Rio Branco, toda extensão',
      ['Avenida Rio Branco'], (-46.650, -23.543, -46.636, -23.525), clip=True, sentido_txt=AMBOS),
    T(1, 'XIV', 'Av. Sen. Queirós', 'Av. Sen. Queirós, entre a R. da Cantareira e Pça. Alfredo Issa',
      ['Avenida Senador Queirós'], (-46.638, -23.542, -46.627, -23.536),
      cor=C('rua da cantareira', 'alfredo issa|avenida ipiranga|avenida rio branco', width=40), sentido_txt=AMBOS),
    T(1, 'XV', 'Av. Ipiranga', 'Av. Ipiranga, entre a Pça. Alfredo Issa e Av. São Luiz',
      ['Avenida Ipiranga', 'Praça da República'], (-46.648, -23.549, -46.634, -23.537),
      cor=C((-46.6362, -23.5394, 60), 'avenida sao luis', width=40), sentido_txt=AMBOS,
      nota='No OSM o trecho da Ipiranga junto à praça se chama "Praça da República": entra só o que é paralelo ao eixo.'),
    T(1, 'XVI', 'Av. São Luís', 'Av. São Luiz, toda extensão',
      ['Avenida São Luís'], (-46.647, -23.550, -46.640, -23.543), clip=True, sentido_txt=AMBOS),
    T(1, 'XVII', 'Vd. Nove de Julho', 'Vd. 9 de Julho',
      ['Viaduto Nove de Julho'], (-46.645, -23.553, -46.640, -23.546), sentido_txt=AMBOS),
    T(1, 'XVIII', 'Vd. Jacareí', 'Vd. Jacareí',
      ['Viaduto Jacareí'], (-46.644, -23.553, -46.638, -23.548), sentido_txt=AMBOS),
    T(1, 'XIX', 'R. Maria Paula', 'R. Maria Paula, toda extensão',
      ['Rua Maria Paula'], (-46.642, -23.555, -46.636, -23.549), sentido_txt=AMBOS),
    T(1, 'XX', 'Vd. Dona Paulina', 'Vd. Dona Paulina',
      ['Viaduto Dona Paulina'], (-46.640, -23.555, -46.633, -23.550), sentido_txt=AMBOS),
    T(1, 'XXI', 'Av. Vinte e Três de Maio', 'Av. Vinte e Três de Maio, toda extensão',
      ['Avenida Vinte e Três de Maio', 'Avenida 23 de Maio', 'Parque Anhangabau'], (-46.660, -23.595, -46.634, -23.543),
      hw={'trunk', 'trunk_link', 'primary', 'motorway'}, clip=True, sentido_txt=AMBOS,
      nota='Inclui o trecho sob o Anhangabaú que o OSM chama de "Parque Anhangabau".'),
    T(1, 'XXII', 'Av. Rubem Berta', 'Av. Rubem Berta, toda extensão',
      ['Avenida Rubem Berta'], (-46.660, -23.615, -46.645, -23.588), clip=True, sentido_txt=AMBOS),
    T(1, 'XXIII', 'Av. Moreira Guimarães', 'Av. Moreira Guimarães, entre Vd. República Árabe Síria e Av. Moaci',
      ['Avenida Moreira Guimarães'], (-46.665, -23.620, -46.648, -23.598),
      cor=C('republica arabe', 'avenida moaci', width=60), sentido_txt=AMBOS),
    T(1, 'XXIV', 'Av. Alcântara Machado (Radial Leste)', 'Av. Alcântara Machado, toda extensão',
      ['Avenida Alcântara Machado', 'Viaduto Alcântara Machado', 'Viaduto Alcântara Machado - Rampa Ascendente'],
      (-46.630, -23.556, -46.578, -23.538), clip=True, sentido_txt=AMBOS,
      nota='Todas as pistas com o nome (central e laterais) e o viaduto na continuidade.'),
    T(1, 'XXV', 'R. Melo Freire', 'R. Melo Freire, toda extensão',
      ['Rua Melo Freire'], (-46.585, -23.545, -46.555, -23.533), clip=True, sentido_txt=AMBOS),
    T(1, 'XXVI', 'Av. Conde de Frontin', 'Av. Conde de Frontin, entre R. Melo Freire e Vd. Eng. Alberto Badra',
      ['Avenida Conde de Frontin'], (-46.562, -23.540, -46.518, -23.528),
      cor=C('rua melo freire', 'alberto badra', width=60), sentido_txt=AMBOS),
    # ---------------------------------------------------------------- § 2º (seg–sex 05–21h, sáb 10–14h)
    T(2, 'I', 'Marginal Pinheiros (Pte. Jaguaré–Pte. Morumbi)',
      'Marginal Pinheiros, em todas as suas denominações, pista local e expressa, no trecho compreendido entre a Ponte do '
      'Jaguaré e Ponte do Morumbi (excluídas as referidas pontes)',
      MP_NAMES, (-46.745, -23.625, -46.690, -23.540), hw=MP_HW,
      cor=C(P_JAGUARE, P_MORUMBI, width=260, axis_re=r'^marginal pinheiros \(expressa\)$'), sentido_txt=AMBOS,
      nota='Pistas local e expressa das duas margens entre as pontes; pontes e alças sem nome ficam de fora.'),
    T(2, 'II', 'Av. dos Bandeirantes', 'Av. dos Bandeirantes, toda extensão',
      ['Avenida dos Bandeirantes'], (-46.695, -23.633, -46.645, -23.594), hw=DEFAULT_HW - {'residential'}, clip=True,
      sentido_txt=AMBOS),
    T(2, 'III', 'Av. Affonso D´Escragnolle Taunay', 'Av. Affonso D´Escragnolle Taunay, toda extensão',
      ["Avenida Afonso D'Escragnolle Taunay", "Avenida Afonso D'Escragnole Taunay"], (-46.650, -23.633, -46.620, -23.625),
      clip=True, sentido_txt=AMBOS),
    T(2, 'IV', 'Av. Jornalista Roberto Marinho', 'Av. Jornalista Roberto Marinho, toda extensão',
      ['Avenida Jornalista Roberto Marinho'], (-46.700, -23.642, -46.657, -23.608), clip=True, sentido_txt=AMBOS),
    # ---------------------------------------------------------------- § 3º (seg–sex 05–21h, sáb 10–14h)
    T(3, 'I', 'Av. Giovanni Gronchi', 'Av. Giovanni Gronchi, entre Av. Carlos Caldeira Filho e Av. Morumbi',
      ['Avenida Giovanni Gronchi', 'Praça Roberto Gomes Pedrosa'], (-46.740, -23.645, -46.705, -23.592),
      cor=C('carlos caldeira', (-46.7085, -23.5991, 80), width=60), sentido_txt=AMBOS,
      nota='A Gronchi passa pelo estádio (no OSM esse trecho se chama "Praça Roberto Gomes Pedrosa") e só encontra a Av. '
           'Morumbi no extremo leste; limite ali.'),
    T(3, 'II', 'Av. Morumbi', 'Av. Morumbi, entre Ponte do Morumbi e Av. Professor Francisco Morato',
      ['Avenida Morumbi'], (-46.716, -23.622, -46.684, -23.570),
      cor=C('ponte do morumbi', 'francisco morato', width=60), sentido_txt=AMBOS),
    T(3, 'III', 'R. Dr. Luiz Migliano', 'R. Dr. Luiz Migliano, toda extensão',
      ['Rua Doutor Luiz Migliano'], (-46.750, -23.626, -46.735, -23.603), clip=True, sentido_txt=AMBOS),
    T(3, 'IV', 'Av. Dr. Guilherme Dumont Vilares', 'Av. Dr. Guilherme Dumont Vilares, entre Av. Giovanni Gronchi e R. José Brás',
      ['Avenida Doutor Guilherme Dumont Vilares'], (-46.750, -23.630, -46.733, -23.602),
      cor=C('giovanni gronchi', 'jose bra[sz]', width=60), sentido_txt=AMBOS, nota='No OSM: "Rua José Braz".'),
    T(3, 'V', 'Av. Dep. Jacob Salvador Zveibil', 'Av. Dep. Jacob Salvador Zveibil, toda extensão',
      ['Avenida Deputado Jacob Salvador Zveibil'], (-46.728, -23.590, -46.720, -23.580), clip=True, sentido_txt=AMBOS),
    T(3, 'VI', 'Av. Jorge João Saad', 'Av. João Jorge Saad, toda extensão',
      ['Avenida Jorge João Saad'], (-46.726, -23.600, -46.718, -23.585), clip=True, sentido_txt=AMBOS,
      nota='A portaria escreve "João Jorge Saad"; o logradouro (e o OSM) é Av. Jorge João Saad.'),
    T(3, 'VII', 'Av. Eng. Oscar Americano', 'R. Engenheiro Oscar Americano, toda extensão',
      ['Avenida Engenheiro Oscar Americano'], (-46.709, -23.597, -46.696, -23.584), clip=True, sentido_txt=AMBOS,
      nota='A portaria diz "R."; no OSM é "Avenida Engenheiro Oscar Americano".'),
    T(3, 'VIII', 'Av. Padre Lebret', 'Av. Padre Lebret, toda extensão',
      ['Avenida Padre Lebret'], (-46.721, -23.606, -46.710, -23.599), sentido_txt=AMBOS),
    T(3, 'IX', 'Av. Jules Rimet', 'Av. Jules Rimet, entre Pça. Roberto Gomes Pedrosa e Av. Padre Lebret',
      ['Avenida Jules Rimet'], (-46.722, -23.606, -46.716, -23.596),
      cor=C('roberto gomes pedrosa', 'padre lebret', width=40), sentido_txt=AMBOS),
    # ---------------------------------------------------------------- § 4º (seg–sex 05–09h e 17–21h, sáb 10–14h)
    T(4, 'I', 'Marginal Tietê sentido Castelo (Pte. Aricanduva–Av. Raimundo P. Magalhães)',
      'Marginal Tietê, em todas as suas denominações, sentido Rod. Ayrton Senna - Rod. Castelo Branco, pista local, central '
      'e expressa, no trecho compreendido entre a Ponte Aricanduva (excluída a referida ponte) e a Av. Raimundo Pereira de Magalhães',
      [], (-46.725, -23.535, -46.545, -23.495), names_re=MT_RE, exclude_re=MT_EXCL, hw=MT_HW,
      cor=C(P_ARICANDUVA, P_RAIMUNDO, sentido='ab', width=260), sentido_txt='Ayrton Senna → Castelo Branco (todas as pistas)',
      revogado_p49=True),
    T(4, 'II', 'Marginal Tietê sentido Ayrton Senna, local e central (R. Botocudos–Pte. Aricanduva)',
      'Marginal Tietê, em todas as suas denominações, sentido Rod. Castelo Branco - Rod. Ayrton Senna, pista local e central '
      'no trecho compreendido entre a R. dos Botocudos e Ponte Aricanduva (excluída a referida ponte)',
      [], (-46.735, -23.535, -46.545, -23.495), names_re=MT_RE, exclude_re=MT_EXCL, hw=MT_HW, pista='nao_expressa',
      cor=C(P_BOTOCUDOS, P_ARICANDUVA, sentido='ab', width=260), sentido_txt='Castelo Branco → Ayrton Senna (local e central)',
      revogado_p49=True),
    T(4, 'III', 'Marginal Tietê sentido Ayrton Senna sob a Ponte do Tatuapé',
      'Marginal Tietê, em todas as suas denominações, sentido Rod. Castelo Branco - Rod. Ayrton Senna, exceto pista local, '
      'sob Ponte Tatuapé no trecho compreendido entre as alças ascendente e descendente para a Av. Salim Farah Maluf',
      [], (-46.600, -23.535, -46.570, -23.515), names_re=MT_RE, exclude_re=MT_EXCL, hw=MT_HW, pista='nao_local',
      cor=C((-46.5905, -23.5300, 150), (-46.5800, -23.5272, 150), sentido='ab', width=120),
      sentido_txt='Castelo Branco → Ayrton Senna (central e expressa)', revogado_p49=True,
      nota='Limites das alças aproximados (~500 m para cada lado da ponte).'),
    T(4, 'IV', 'Marginal Tietê sentido Ayrton Senna, expressa (Cebolão–Pte. Aricanduva)',
      'Marginal Tietê, em todas as suas denominações, sentido Rod. Castelo Branco-Rod. Ayrton Senna, pista expressa no trecho '
      'compreendido entre o Km zero (Cebolão) e a Ponte Aricanduva (excluída a referida ponte)',
      [], (-46.760, -23.540, -46.545, -23.495), names_re=MT_RE, exclude_re=MT_EXCL, hw=MT_HW, pista='expressa',
      cor=C(P_CEBOLAO, P_ARICANDUVA, sentido='ab', width=260), sentido_txt='Castelo Branco → Ayrton Senna (expressa)',
      revogado_p49=True),
    T(4, 'V', 'Av. General Edgar Facó', 'Av. General Edgar Facó, no trecho compreendido entre R. da Balsa e Ponte do Piqueri',
      ['Avenida General Edgard Facó'], (-46.713, -23.512, -46.703, -23.495),
      segs=[((-46.7059, -23.5069, 45), 'ponte do piqueri', 'both', 5)], sentido_txt=AMBOS,
      nota='No OSM: "Edgard Facó". A R. da Balsa não cruza a avenida no OSM: limite no ponto mais próximo (~100 m).'),
    T(4, 'VI', 'Av. Ermano Marchetti sentido Centro', 'Av. Ermano Marchetti, sentido Lapa-Centro, no trecho compreendido entre '
      'Ponte do Piqueri e Pça. Dr. Pedro Corazza (excluída a referida praça)',
      ['Avenida Ermano Marchetti'], (-46.708, -23.518, -46.689, -23.507),
      segs=[('ponte do piqueri', 'pedro corazza', 'ab')], sentido_txt='Lapa → Centro'),
    T(4, 'VII', 'Av. Ermano Marchetti sentido Lapa', 'Av. Ermano Marchetti, sentido Centro-Lapa, no trecho compreendido entre a '
      'Pça. Dr. Pedro Corazza e a Pça Jácomo Zanella (excluídas as referidas praças) e no trecho compreendido entre a Pça. Jácomo '
      'Zanella (excluída a referida praça) e Ponte do Piqueri (incluída a referida ponte)',
      ['Avenida Ermano Marchetti'], (-46.708, -23.518, -46.689, -23.507),
      segs=[('pedro corazza', 'jacomo zanella', 'ab'), ('jacomo zanella', 'ponte do piqueri', 'ab')], sentido_txt='Centro → Lapa',
      nota='A ponte do Piqueri (incluída) está no inciso XXXI.'),
    T(4, 'VIII', 'Av. Marquês de São Vicente', 'Av. Marquês de São Vicente, toda extensão, excluídas as praças Dr. Pedro Corazza, '
      'José Vieira de Carvalho Mesquita e Luís Carlos Mesquita',
      ['Avenida Marquês de São Vicente'], (-46.693, -23.526, -46.656, -23.511), clip=True, sentido_txt=AMBOS,
      nota='As praças têm nome próprio no OSM e ficam de fora.'),
    T(4, 'IX', 'R. Norma Pieruccini Giannotti', 'R. Norma Pieruccini Giannotti, toda extensão',
      ['Rua Norma Pieruccini Giannotti'], (-46.661, -23.526, -46.648, -23.520), sentido_txt=AMBOS),
    T(4, 'X', 'R. Sérgio Tomás', 'R. Sérgio Tomás, toda extensão',
      ['Rua Sérgio Tomás'], (-46.652, -23.524, -46.642, -23.518), sentido_txt=AMBOS),
    T(4, 'XI', 'Av. Pres. Castello Branco (Sérgio Tomás–Av. do Estado)', 'Av. Pres. Castello Branco, entre R. Sérgio Tomás e Av. do Estado',
      [], (-46.650, -23.525, -46.632, -23.515), names_re=r'^avenida presidente castel+o branco', hw=MT_HW,
      cor=C((-46.6445, -23.5200, 200), (-46.6375, -23.5205, 200), width=120), sentido_txt='pistas da Av. Pres. Castello Branco',
      nota='Trecho da Marginal Tietê (margem sul) entre a R. Sérgio Tomás e a Av. do Estado; limites aproximados pelos cruzamentos.'),
    T(4, 'XII', 'Av. do Estado (Marginal–Anhaia Mello)', 'Av. do Estado, entre Av. Pres. Castello Branco (Marginal Tietê) até Av. Prof. '
      'Luiz Inácio de Anhaia Mello',
      ['Avenida do Estado', 'Acesso Avenida do Estado'], (-46.643, -23.595, -46.590, -23.516),
      cor=C('castel+o branco|marginal tiete', 'anhaia mell?o|grande sao paulo', width=80), sentido_txt=AMBOS),
    T(4, 'XIII', 'Av. Anhaia Mello sentido Vila Formosa', 'Av. Prof. Luiz Inácio de Anhaia Mello, sentido Ipiranga-V. Formosa, entre '
      'Vd. Grande São Paulo e Av. Salim Farah Maluf',
      ['Avenida Professor Luiz Ignácio Anhaia Mello'], (-46.600, -23.592, -46.568, -23.578),
      cor=C('grande sao paulo', 'salim farah', sentido='ab', width=60), sentido_txt='Ipiranga → Vila Formosa'),
    T(4, 'XIV', 'Av. Anhaia Mello sentido Ipiranga', 'Av. Prof. Luiz Inácio de Anhaia Mello, sentido V. Formosa-Ipiranga, entre R. '
      'Domingos Afonso e Vd. Grande São Paulo',
      ['Avenida Professor Luiz Ignácio Anhaia Mello'], (-46.600, -23.592, -46.558, -23.575),
      cor=C('domingos afonso', 'grande sao paulo', sentido='ab', width=60), sentido_txt='Vila Formosa → Ipiranga'),
    T(4, 'XV', 'Av. Pres. Tancredo Neves', 'Av. Pres. Tancredo Neves, toda extensão',
      ['Avenida Presidente Tancredo Neves'], (-46.616, -23.626, -46.600, -23.602), sentido_txt=AMBOS),
    T(4, 'XVI', 'R. Malvina Ferrara Samarone', 'R. Malvina Ferrara Samarone, toda extensão',
      ['Rua Malvina Ferrara Samarone'], (-46.607, -23.607, -46.598, -23.601), sentido_txt=AMBOS),
    T(4, 'XVII', 'R. das Juntas Provisórias sentido Cambuci', 'R. das Juntas Provisórias, sentido Sacomã-Cambuci, entre R. do Grito e Av. do Estado',
      ['Rua das Juntas Provisórias'], (-46.604, -23.606, -46.594, -23.584),
      cor=C('rua do grito', 'avenida do estado', sentido='ab', width=40), sentido_txt='Sacomã → Cambuci'),
    T(4, 'XVIII', 'R. das Juntas Provisórias sentido Sacomã', 'R. das Juntas Provisórias, sentido Cambuci-Sacomã, entre Av. do Estado e R. Dois de Julho',
      ['Rua das Juntas Provisórias'], (-46.604, -23.606, -46.594, -23.584),
      cor=C('avenida do estado', 'dois de julho|2 de julho', sentido='ab', width=40), sentido_txt='Cambuci → Sacomã'),
    T(4, 'XIX', 'Vd. Bresser sentido Vila Prudente', 'Vd. Bresser, sentido Brás-V. Prudente, entre R. Cel. Antônio Marcelo e R. Bresser',
      ['Rua Bresser'], (-46.608, -23.553, -46.599, -23.542),
      segs=[((-46.6061, -23.5436, 30), (-46.6011, -23.5503, 25), 'ab')], sentido_txt='Brás → Vila Prudente',
      nota='No OSM o tabuleiro do viaduto se chama "Rua Bresser" (o way "Viaduto Bresser" é um trecho curto no sentido Brás).'),
    T(4, 'XX', 'R. Bresser', 'R. Bresser, sentido Brás-V. Prudente, entre Vd. Bresser e R. dos Trilhos e no sentido V. Prudente-Brás, '
      'entre R. dos Trilhos e R. João Caetano',
      ['Rua Bresser'], (-46.612, -23.557, -46.596, -23.540),
      segs=[((-46.6011, -23.5503, 25), 'rua dos trilhos', 'ab', 15), ((-46.5993, -23.5527, 80), 'joao caetano', 'ab', 15)],
      sentido_txt='Brás → V. Prudente (Vd. Bresser–R. dos Trilhos); V. Prudente → Brás (R. dos Trilhos–R. João Caetano)'),
    T(4, 'XXI', 'R. Taquari', 'R. Taquari, entre R. dos Trilhos e R. da Mooca',
      ['Rua Taquari'], (-46.602, -23.558, -46.590, -23.544),
      cor=C('rua dos trilhos', 'rua da mooca', width=40), sentido_txt=AMBOS),
    T(4, 'XXII', 'Av. Paes de Barros', 'Av. Paes de Barros, toda extensão',
      ['Avenida Paes de Barros'], (-46.602, -23.588, -46.584, -23.553), sentido_txt=AMBOS),
    T(4, 'XXIII', 'Av. Salim Farah Maluf', 'Av. Salim Farah Maluf, toda extensão',
      ['Avenida Salim Farah Maluf', 'Avenida Salim Farah Maluf (pista Central)', 'Avenida Salim Farah Maluf (Expressa)',
       'Avenida Salim Farah Maluf (Local)'], (-46.588, -23.586, -46.569, -23.526), clip=True, sentido_txt=AMBOS,
      nota='Pistas central, expressa e local; alças com o nome da avenida incluídas.'),
    T(4, 'XXIV', 'R. Ulisses Cruz', 'R. Ulisses Cruz, entre R. Ivaí e Av. Salim Farah Maluf',
      ['Rua Ulisses Cruz'], (-46.587, -23.537, -46.575, -23.526),
      cor=C('rua ivai', 'salim farah', width=40), sentido_txt=AMBOS),
    T(4, 'XXV', 'Vd. Grande São Paulo', 'Vd. Grande São Paulo, toda extensão',
      ['Viaduto Grande São Paulo Vereador Manoel de Oliveira Sala'], (-46.600, -23.590, -46.588, -23.585), sentido_txt=AMBOS),
    T(4, 'XXVI', 'Vd. José Colassuono', 'Vd. José Colassuono, toda extensão',
      ['Viaduto José Colasuonno', 'Viaduto José Colassuono'], (-46.600, -23.593, -46.594, -23.586), sentido_txt=AMBOS),
    T(4, 'XXVII', 'Complexo Viário Sen. Antônio Emygdio de Barros Filho', 'Complexo Viário Senador Antônio Emygdio de Barros Filho, '
      'exceto alça direcional da Av. Salim Farah Maluf, sentido Tatuapé-V. Prudente, para a Av. Prof. Luiz Inácio de Anhaia Mello, '
      'sentido V. Prudente-Sapopemba',
      ['Complexo Viário Senador Antônio Emygdio de Barros Filho'], (-46.576, -23.586, -46.568, -23.577), sentido_txt=AMBOS,
      exclude_way_ids=[782418953, 39239337],
      nota='As vias com esse nome no OSM são alças do complexo. A alça direcional excetuada (Av. Vila Ema/Salim sentido '
           'V. Prudente → Anhaia Mello sentido Sapopemba) são os ways 782418953 e 39239337, conferidos pela conectividade; '
           'as demais alças do complexo não têm nome no OSM e ficam de fora.'),
    T(4, 'XXVIII', 'Vd. Pacheco e Chaves', 'Vd. Pacheco e Chaves, toda extensão',
      ['Viaduto Capitão Pacheco e Chaves'], (-46.601, -23.585, -46.592, -23.579), sentido_txt=AMBOS),
    T(4, 'XXIX', 'Vd. Gazeta do Ipiranga', 'Vd. Gazeta do Ipiranga, toda extensão',
      ['Viaduto Gazeta do Ipiranga', 'Viaduto Gazeta do Ypiranga'], (-46.625, -23.610, -46.580, -23.570), sentido_txt=AMBOS,
      nota='Sem via com esse nome no OSM nem no mapa da CET: não casado.'),
    T(4, 'XXX', 'Complexo Viário Maria Maluf', 'Complexo Viário Maria Maluf, toda extensão',
      ['Complexo Viário Maria Maluf'], (-46.632, -23.632, -46.610, -23.620), hw=DEFAULT_HW, sentido_txt=AMBOS),
    T(4, 'XXXI', 'Ponte do Piqueri', 'Ponte do Piqueri, toda extensão',
      ['Ponte do Piqueri - Joelmir Bething'], (-46.708, -23.512, -46.704, -23.506), sentido_txt=AMBOS),
    T(4, 'XXXII', 'Av. Santos Dumont sentido Centro (Santana)', 'Av. Santos Dumont sentido Norte-Sul, entre Pça. Campo de Bagatelle e Pte. das Bandeiras',
      ['Avenida Santos Dumont'], (-46.633, -23.5205, -46.626, -23.512),
      segs=[('campo de bagatelle', 'ponte das bandeiras', 'ab')], sentido_txt='Norte → Sul'),
    T(4, 'XXXIII', 'Ponte das Bandeiras sentido Centro', 'Ponte das Bandeiras, sentido Norte-Sul, toda extensão',
      ['Ponte das Bandeiras'], (-46.632, -23.521, -46.628, -23.517), dir=180, sentido_txt='Norte → Sul'),
    T(4, 'XXXIV', 'Ponte do Tatuapé sentido Tatuapé', 'Ponte do Tatuapé, sentido Norte-Sul, toda extensão',
      ['Ponte do Tatuapé - Deputado Ricardo Izar'], (-46.589, -23.531, -46.583, -23.520), dir=180, sentido_txt='Norte → Sul'),
    T(4, 'XXXV', 'Av. São Miguel sentido bairro', 'Av. São Miguel, sentido centro/bairro, entre R. Ten. Laudelino Ferreira do Amaral e Pça. Pe. Aleixo M. Mafra',
      ['Avenida São Miguel'], (-46.462, -23.509, -46.443, -23.488),
      segs=[((-46.4561, -23.4985, 60), 'aleixo monteiro mafra', 'ab')], sentido_txt='centro → bairro',
      nota='A R. Ten. Laudelino Ferreira do Amaral não encosta na avenida no OSM: limite no ponto mais próximo (~30 m).'),
    T(4, 'XXXVI', 'Av. São Miguel sentido centro', 'Av. São Miguel, sentido bairro/centro, entre Pça. Pe. Aleixo M. Mafra e R. Cel. Manuel Feliciano de Souza',
      ['Avenida São Miguel'], (-46.462, -23.509, -46.443, -23.488),
      segs=[('aleixo monteiro mafra', 'manuel feliciano', 'ab')], sentido_txt='bairro → centro'),
    T(4, 'XXXVII', 'Av. Marechal Tito sentido bairro', 'Av. Marechal Tito, sentido centro/bairro, entre Pça. Pe. Aleixo M. Mafra e Av. Dep. Dr. José Aristodemo Pinotti',
      ['Avenida Marechal Tito'], (-46.449, -23.501, -46.425, -23.487),
      segs=[('aleixo monteiro mafra', 'aristodemo pinotti', 'ab')], sentido_txt='centro → bairro'),
    T(4, 'XXXVIII', 'Av. Marechal Tito sentido centro', 'Av. Marechal Tito, sentido bairro/centro, entre Av. Dep. Dr. José Aristodemo Pinotti e R. Miguel Ângelo Lapena',
      ['Avenida Marechal Tito'], (-46.449, -23.501, -46.425, -23.487),
      segs=[('aristodemo pinotti', 'miguel angelo lapena', 'ab')], sentido_txt='bairro → centro'),
    T(4, 'XXXIX', 'R. Beraldo Marcondes sentido centro', 'R. Beraldo Marcondes, sentido bairro/centro, entre R. Miguel Ângelo Lapena e Pça. Pe. Aleixo Monteiro Mafra',
      ['Rua Beraldo Marcondes'], (-46.448, -23.495, -46.439, -23.489),
      segs=[('miguel angelo lapena', (-46.4445, -23.4917, 50), 'ab')], sentido_txt='bairro → centro'),
    T(4, 'XL', 'Pça. Pe. Aleixo Monteiro Mafra', 'Pça. Pe. Aleixo Monteiro Mafra, toda extensão',
      ['Praça Padre Aleixo Monteiro Mafra'], (-46.448, -23.494, -46.443, -23.490), sentido_txt=AMBOS),
    # ---------------------------------------------------------------- § 5º (Portaria 49/2021 — NÃO vigente)
    T(5, 'I', 'Marginal Tietê sentido Castelo Branco (Portaria 49/2021)',
      'Marginal Tietê, em todas as suas denominações, sentido Rod. Ayrton Senna - Rod. Castelo Branco, pista local, central e expressa',
      [], (-46.760, -23.540, -46.540, -23.495), names_re=MT_RE, exclude_re=MT_EXCL, hw=MT_HW,
      cor=C(P_AYRTON, P_CEBOLAO, sentido='ab', width=260), sentido_txt='Ayrton Senna → Castelo Branco (todas as pistas)'),
    T(5, 'II', 'Marginal Tietê sentido Ayrton Senna (Portaria 49/2021)',
      'Marginal Tietê, em todas as suas denominações, sentido Rod. Castelo Branco - Rod. Ayrton Senna, pista local, central e expressa',
      [], (-46.760, -23.540, -46.540, -23.495), names_re=MT_RE, exclude_re=MT_EXCL, hw=MT_HW,
      cor=C(P_CEBOLAO, P_AYRTON, sentido='ab', width=260), sentido_txt='Castelo Branco → Ayrton Senna (todas as pistas)'),
]


# ----------------------------------------------------------------------------------------------------------------
# Leitura do OSM (osmium → OPL com coordenadas nos ways)
_esc = re.compile(r'%([0-9a-fA-F]+)%')
_node = re.compile(r'n(\d+)x([-\d.]+)y([-\d.]+)')


def _unesc(s: str) -> str:
    return _esc.sub(lambda m: chr(int(m.group(1), 16)), s)


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '')
    return re.sub(r'\s+', ' ', ''.join(c for c in s if not unicodedata.combining(c)).lower()).strip()


def _osmium(*args):
    try:
        subprocess.run(['osmium', *args], check=True)
    except FileNotFoundError as e:
        raise RuntimeError('osmium-tool não encontrado. No container: apt-get install -y osmium-tool (ver docstring).') from e


def ensure_opl() -> pathlib.Path:
    WORK.mkdir(parents=True, exist_ok=True)
    opl = WORK / 'sp_highways.opl'
    if opl.exists() and (not OSM_PBF.exists() or opl.stat().st_mtime >= OSM_PBF.stat().st_mtime):
        return opl
    if not OSM_PBF.exists():
        raise RuntimeError(f'PBF não encontrado: {OSM_PBF} (defina OSM_PBF) e sem cache em {opl}')
    print(f'    extraindo vias do município de {OSM_PBF.name} com osmium...')
    b = ','.join(str(x) for x in SP_BBOX)
    _osmium('extract', '-b', b, '-s', 'complete_ways', str(OSM_PBF), '-o', str(WORK / 'sp.osm.pbf'), '--overwrite')
    _osmium('tags-filter', str(WORK / 'sp.osm.pbf'), 'w/highway', '-o', str(WORK / 'sp_hw.osm.pbf'), '--overwrite')
    _osmium('add-locations-to-ways', str(WORK / 'sp_hw.osm.pbf'), '-f', 'opl', '-o', str(opl), '--overwrite')
    return opl


def load_ways(opl: pathlib.Path) -> dict:
    ways = {}
    with open(opl, encoding='utf-8') as f:
        for line in f:
            if not line.startswith('w'):
                continue
            parts = line.rstrip('\n').split(' ')
            tags, nodes = {}, []
            for p in parts[1:]:
                if p.startswith('T') and len(p) > 1:
                    for kv in p[1:].split(','):
                        if '=' in kv:
                            k, v = kv.split('=', 1)
                            tags[_unesc(k)] = _unesc(v)
                elif p.startswith('N') and len(p) > 1:
                    for n in p[1:].split(','):
                        m = _node.match(n)
                        if m:
                            nodes.append((int(m.group(1)), float(m.group(2)), float(m.group(3))))
            if tags.get('highway') in MOTOR and len(nodes) >= 2:
                ways[int(parts[0][1:])] = (tags, nodes)
    return ways


def hav(a, b) -> float:
    (lon1, lat1), (lon2, lat2) = a, b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(h))


def bearing(a, b) -> float:
    (lon1, lat1), (lon2, lat2) = a, b
    y = math.sin(math.radians(lon2 - lon1)) * math.cos(math.radians(lat2))
    x = math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) - math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(math.radians(lon2 - lon1))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def turn(b1, b2) -> float:
    d = abs(b1 - b2) % 360
    return 360 - d if d > 180 else d


def _names(t: dict) -> list[str]:
    return [t[k] for k in ('name', 'alt_name', 'official_name', 'old_name', 'short_name', 'name:pt') if t.get(k)]


def _oneway(t: dict) -> int:
    o = t.get('oneway', '')
    if o in ('yes', 'true', '1'):
        return 1
    if o == '-1':
        return -1
    if o in ('no', 'false', '0', 'reversible', 'alternating'):
        return 0
    if t.get('junction') in ('roundabout', 'circular') or t.get('highway') in ('motorway',):
        return 1
    return 0


def _pista(t: dict) -> str:
    """local | central | expressa (marginais)."""
    n = norm(t.get('name', ''))
    if 'central' in n:
        return 'central'
    if 'expressa' in n:
        return 'expressa'
    if 'local' in n:
        return 'local'
    return 'expressa' if t.get('highway') == 'motorway' else 'local'


class Net:
    def __init__(self, ways: dict):
        self.ways = ways
        self.coord: dict[int, tuple] = {}
        self.node_ways: dict[int, list] = defaultdict(list)
        for wid, (t, nodes) in ways.items():
            for nid, x, y in nodes:
                self.coord[nid] = (x, y)
                self.node_ways[nid].append(wid)

    def candidates(self, names: list[str], bbox, hw, names_re=None) -> set[int]:
        want = {norm(n) for n in names}
        rx = re.compile(names_re) if names_re else None
        out = set()
        for wid, (t, nodes) in self.ways.items():
            if t.get('highway') not in hw:
                continue
            nm = [norm(n) for n in _names(t)]
            if not (any(n in want for n in nm) or (rx and any(rx.search(n) for n in nm))):
                continue
            if any(bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3] for _, x, y in nodes):
                out.add(wid)
        return out

    def edges(self, wids) -> dict:
        """arestas dirigidas permitidas: (u, v) -> wid"""
        E = {}
        for wid in wids:
            t, nodes = self.ways[wid]
            ow = _oneway(t)
            for (a, *_), (b, *_) in zip(nodes, nodes[1:]):
                if a == b:
                    continue
                if ow >= 0:
                    E[(a, b)] = wid
                if ow <= 0:
                    E[(b, a)] = wid
        return E

    def anchor(self, spec, wids, snap: float = 60) -> set[int]:
        """Nós das vias do inciso que marcam um limite. spec: regex do nome da transversal | (lon, lat[, raio]).
        Para transversal, inclui os nós do inciso a até `snap` m do cruzamento (pega as duas pistas de avenida dupla)."""
        cand_nodes = {nid for w in wids for nid, *_ in self.ways[w][1]}
        if not cand_nodes:
            return set()
        if isinstance(spec, (tuple, list)):
            lon, lat = spec[0], spec[1]
            r = spec[2] if len(spec) > 2 else 60
            hits = {n for n in cand_nodes if hav(self.coord[n], (lon, lat)) <= r}
            if not hits:  # nó mais próximo
                best = min(cand_nodes, key=lambda n: hav(self.coord[n], (lon, lat)))
                if hav(self.coord[best], (lon, lat)) <= 3 * r:
                    hits = {best}
            return hits
        rx = re.compile(norm(spec))
        core = set()
        for n in cand_nodes:
            for w in self.node_ways[n]:
                if w in wids:
                    continue
                if any(rx.search(norm(x)) for x in _names(self.ways[w][0])):
                    core.add(n)
                    break
        if not core:
            return set()
        return {n for n in cand_nodes if any(hav(self.coord[n], self.coord[c]) <= snap for c in core)}

    def path(self, src: set, dst: set, E) -> list:
        adj = defaultdict(list)
        for (u, v) in E:
            adj[u].append(v)
        dist = {s: 0.0 for s in src}
        prev = {}
        pq = [(0.0, s) for s in src]
        heapq.heapify(pq)
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, 1e18):
                continue
            if u in dst and u not in src:
                path = [u]
                while path[-1] in prev:
                    path.append(prev[path[-1]])
                return list(reversed(path))
            for v in adj[u]:
                nd = d + hav(self.coord[u], self.coord[v])
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    prev[v] = u
                    heapq.heappush(pq, (nd, v))
        return []


def chains(E, coord: dict) -> list[list[int]]:
    """Cadeias dirigidas máximas a partir de um conjunto de arestas (u, v). Em via de mão dupla não confunde
    o sentido de ida com o de volta; quebra em bifurcação, junção e retorno (> 100°)."""
    out_e = defaultdict(set)
    in_e = defaultdict(set)
    for u, v in E:
        out_e[u].add(v)
        in_e[v].add(u)

    def nxt(u, v):
        cands = [w for w in out_e[v] if w != u]
        if len(cands) != 1:
            return None
        w = cands[0]
        ins = [x for x in in_e[v] if x != w]
        if len(ins) != 1:
            return None
        if turn(bearing(coord[u], coord[v]), bearing(coord[v], coord[w])) > 100:
            return None
        return w

    has_prev = set()
    for (u, v) in E:
        w = nxt(u, v)
        if w is not None:
            has_prev.add((v, w))
    seen = set()
    res = []
    starts = sorted(e for e in E if e not in has_prev) + sorted(e for e in E if e in has_prev)  # ciclos por último
    for e in starts:
        if e in seen:
            continue
        u, v = e
        seq = [u, v]
        seen.add(e)
        while True:
            w = nxt(seq[-2], seq[-1])
            if w is None or (seq[-1], w) in seen:
                break
            seen.add((seq[-1], w))
            seq.append(w)
        res.append(seq)
    return res


def chain_len(seq, coord) -> float:
    return sum(hav(coord[a], coord[b]) for a, b in zip(seq, seq[1:]))


def _project(axis: list, p) -> tuple[float, float, float]:
    """(t ao longo do eixo em m, distância ao eixo em m, rumo do eixo no ponto)"""
    best = (1e18, 0.0, 0.0)
    acc = 0.0
    k = math.cos(math.radians(p[1]))
    for a, b in zip(axis, axis[1:]):
        ax, ay = (a[0] - p[0]) * k, a[1] - p[1]
        bx, by = (b[0] - p[0]) * k, b[1] - p[1]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        u = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
        d = math.hypot(ax + u * dx, ay + u * dy) * 111195.0
        seg = hav(a, b)
        if d < best[0]:
            best = (d, acc + u * seg, bearing(a, b))
        acc += seg
    return best[1], best[0], best[2]


def _in_bbox(p, bb) -> bool:
    return bb[0] <= p[0] <= bb[2] and bb[1] <= p[1] <= bb[3]


def match(net: Net, tr: dict) -> tuple[set, list[str]]:
    """Arestas dirigidas do inciso (no sentido de circulação proibido) + avisos do casamento."""
    problems = []
    hw = tr.get('hw') or DEFAULT_HW
    wids = net.candidates(tr['names'], tr['bbox'], hw, tr.get('names_re'))
    if tr.get('exclude_re'):
        rx = re.compile(tr['exclude_re'])
        wids = {w for w in wids if not any(rx.search(norm(n)) for n in _names(net.ways[w][0]))}
    if tr.get('exclude_way_ids'):
        wids -= set(tr['exclude_way_ids'])
    pista = tr.get('pista')
    if pista == 'expressa':
        wids = {w for w in wids if _pista(net.ways[w][0]) == 'expressa'}
    elif pista == 'nao_expressa':
        wids = {w for w in wids if _pista(net.ways[w][0]) != 'expressa'}
    elif pista == 'nao_local':
        wids = {w for w in wids if _pista(net.ways[w][0]) != 'local'}
    if not wids:
        return set(), ['nenhuma via OSM com os nomes ' + ', '.join(tr['names'] or [tr.get('names_re', '')])]
    E = net.edges(wids)
    if tr.get('clip'):
        bb = tr['bbox']
        E = {(u, v): w for (u, v), w in E.items()
             if _in_bbox(((net.coord[u][0] + net.coord[v][0]) / 2, (net.coord[u][1] + net.coord[v][1]) / 2), bb)}
    cor = tr.get('cor')
    if cor:
        axis_w = wids
        if cor.get('axis_re'):
            rx = re.compile(cor['axis_re'])
            axis_w = {w for w in wids if any(rx.search(norm(n)) for n in _names(net.ways[w][0]))}
        und = {}
        for (u, v), w in net.edges(axis_w).items():
            und[(u, v)] = w
            und[(v, u)] = w
        A, B = net.anchor(cor['a'], axis_w), net.anchor(cor['b'], axis_w)
        p = net.path(A, B, und) if A and B else []
        if not p:
            return set(), [f'eixo do corredor não encontrado ({cor["a"]} -> {cor["b"]}; A={len(A)} B={len(B)} nós)']
        axis = [net.coord[n] for n in p]
        L = sum(hav(a, b) for a, b in zip(axis, axis[1:]))
        sentido, width = cor.get('sentido', 'both'), cor.get('width', 60)
        sel = set()
        for (u, v) in E:
            pu, pv = net.coord[u], net.coord[v]
            if hav(pu, pv) < 0.5:
                continue
            t, d, ab = _project(axis, ((pu[0] + pv[0]) / 2, (pu[1] + pv[1]) / 2))
            if d > width or t <= 1 or t >= L - 1:
                continue
            c = math.cos(math.radians(turn(bearing(pu, pv), ab)))
            if (sentido == 'ab' and c > 0.5) or (sentido == 'ba' and c < -0.5) or (sentido == 'both' and abs(c) > 0.5):
                sel.add((u, v))
        return sel, problems
    if not tr.get('segs'):
        return set(E), problems
    sel = set()
    for seg in tr['segs']:
        a, b, sentido = seg[0], seg[1], seg[2]
        snap = seg[3] if len(seg) > 3 else 60
        A, B = net.anchor(a, wids, snap), net.anchor(b, wids, snap)
        if not A or not B:
            problems.append(f'âncora não encontrada: {a if not A else b}')
            continue
        tries = [(A, B, f'{a}->{b}'), (B, A, f'{b}->{a}')] if sentido == 'both' else [(A, B, f'{a}->{b}')]
        found = 0
        for src, dst, lbl in tries:
            p = net.path(src, dst, E)
            if p:
                found += 1
                sel.update(zip(p, p[1:]))
        if not found:
            problems.append('sem caminho ' + ' / '.join(t[2] for t in tries))
    return sel, problems


# ----------------------------------------------------------------------------------------------------------------
# Conferência com os My Maps da CET (só %; nada do KML vai para o seed)
def _kml_lines():
    from lxml import etree
    out = []
    for key, url in CET_KML.items():
        try:
            raw = http_get(url, cache=f'ver/{key}.kml', max_age_h=24 * 30, timeout=60)
        except Exception as e:  # conferência é opcional
            print(f'    ! KML da CET indisponível ({key}): {e}')
            continue
        root = etree.fromstring(raw)
        ns = {'k': 'http://www.opengis.net/kml/2.2'}
        for pm in root.iter('{http://www.opengis.net/kml/2.2}Placemark'):
            nm = (pm.findtext('k:name', namespaces=ns) or '').strip()
            for ls in pm.iter('{http://www.opengis.net/kml/2.2}LineString'):
                txt = ls.findtext('k:coordinates', namespaces=ns) or ''
                pts = [tuple(map(float, c.split(',')[:2])) for c in txt.split()]
                if len(pts) >= 2:
                    out.append((key, nm, pts))
    return out


def _densify(pts, step=25.0):
    out = []
    for a, b in zip(pts, pts[1:]):
        d = hav(a, b)
        n = max(1, int(d // step))
        for i in range(n):
            out.append((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n))
    out.append(pts[-1])
    return out


class _Grid:
    def __init__(self, pts, cell=0.0005):
        self.cell = cell
        self.g = defaultdict(list)
        for p in pts:
            self.g[(int(p[0] / cell), int(p[1] / cell))].append(p)

    def near(self, p, r):
        cx, cy = int(p[0] / self.cell), int(p[1] / self.cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for q in self.g.get((cx + dx, cy + dy), ()):
                    if hav(p, q) <= r:
                        return True
        return False


def conferencia(lines_coords: list, kml_grid) -> float | None:
    """% da extensão casada que fica a até 40 m de alguma linha VER dos My Maps da CET."""
    if kml_grid is None:
        return None
    pts = [p for c in lines_coords for p in _densify(c)]
    if not pts:
        return None
    return round(100 * sum(1 for p in pts if kml_grid.near(p, 40)) / len(pts), 1)


# ----------------------------------------------------------------------------------------------------------------
# Checagem no Valhalla: cada cadeia precisa "casar" com o grafo (linear_cost_factors faz edge walk; erro 233 derruba a rota)
def _walk_ok(lines: list[list]) -> bool | None:
    body = {
        'locations': [{'lat': -23.5505, 'lon': -46.6340}, {'lat': -23.5614, 'lon': -46.6559}],  # Sé → Paulista (qualquer par serve)
        'costing': 'auto', 'directions_type': 'none',
        'linear_cost_factors': [{'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': c}, 'properties': {'factor': 1.0}}
                                for c in lines],
    }
    try:
        r = requests.post(f'{VALHALLA_URL}/route', json=body, timeout=120)
    except requests.RequestException:
        return None
    if r.status_code == 200:
        return True
    try:
        code = r.json().get('error_code')
    except ValueError:
        code = None
    return False if code == 233 else True  # outros erros não são de edge walk


def valhalla_bad(lines: list[list]) -> list[int] | None:
    """Índices das linhas que o Valhalla não consegue percorrer (busca binária). None = Valhalla fora do ar."""
    if not lines or VALHALLA_URL in ('', 'off', '0'):
        return None
    ok = _walk_ok(lines)
    if ok is None:
        return None
    if ok:
        return []
    bad: list[int] = []

    def rec(idx: list[int]):
        if len(idx) == 1:
            bad.append(idx[0])
            return
        mid = len(idx) // 2
        for part in (idx[:mid], idx[mid:]):
            if _walk_ok([lines[i] for i in part]) is False:
                rec(part)
    rec(list(range(len(lines))))
    return sorted(bad)


def split_valid(c: list) -> list[list]:
    """Quebra uma cadeia que falha no edge walk em pedaços que passam (o Valhalla às vezes não aceita a transição em
    certos nós). Mantém a sobreposição de 1 nó entre pedaços; descarta só o segmento que falha sozinho."""
    out, start = [], 0
    while start < len(c) - 1:
        seg = c[start:]
        if _walk_ok([seg]):
            out.append(seg)
            break
        lo, hi = 2, len(seg)
        while lo < hi:  # menor prefixo que falha
            mid = (lo + hi) // 2
            if _walk_ok([seg[:mid]]):
                lo = mid + 1
            else:
                hi = mid
        if lo - 1 >= 2:
            out.append(seg[:lo - 1])
            start += lo - 2
        else:
            start += 1
    return out


# ----------------------------------------------------------------------------------------------------------------
RAW_DIR = DATA_DIR / 'raw' / 'ver'   # cópias do texto oficial (portaria137_2018_trechos.txt, portaria49_2021.txt)


def _letras(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', norm(s))


def conferir_textos(trechos: list[dict]) -> list[str]:
    """Cada `texto` de inciso precisa estar, letra por letra, no texto oficial guardado em data/raw/ver."""
    fontes = {1: 'portaria137_2018_trechos.txt', 2: 'portaria137_2018_trechos.txt', 3: 'portaria137_2018_trechos.txt',
              4: 'portaria137_2018_trechos.txt', 5: 'portaria49_2021.txt'}
    cache, erros = {}, []
    for tr in trechos:
        f = RAW_DIR / fontes[tr['par']]
        if not f.exists():
            return [f'texto oficial ausente em {f} (conferência pulada)']
        if f not in cache:
            cache[f] = _letras(f.read_text(encoding='utf-8'))
        if _letras(tr['texto']) not in cache[f]:
            erros.append(f"§{tr['par']} {tr['inc']}: texto não confere com {f.name}")
    return erros


def build_features(trechos: list[dict]) -> list[dict]:
    for e in conferir_textos(trechos):
        print(f'    ! {e}')
    opl = ensure_opl()
    net = Net(load_ways(opl))
    kml = _kml_lines()
    kml_grid = _Grid([p for _, _, pts in kml for p in _densify(pts)]) if kml else None
    feats, report = [], []
    for tr in trechos:
        par = PARAGRAFOS[tr['par']]
        sel, problems = match(net, tr)
        cs = [c for c in chains(sel, net.coord) if len(c) >= 2 and chain_len(c, net.coord) >= 5]
        if tr.get('dir') is not None:
            cs = [c for c in cs if turn(bearing(net.coord[c[0]], net.coord[c[-1]]), tr['dir']) <= 60]
        cs.sort(key=lambda c: -chain_len(c, net.coord))
        coords = [[[round(x, 7), round(y, 7)] for x, y in (net.coord[n] for n in c)] for c in cs]
        km_total = sum(chain_len(c, net.coord) for c in cs) / 1000
        conf = conferencia(coords, kml_grid)
        sid = f"p137-a2-s{tr['par']}-{tr['inc'].lower()}"
        report.append((sid, tr['nome'], round(km_total, 2), len(cs), conf, problems))
        if DEBUG:
            print(f"    {sid:20s} {tr['nome'][:50]:50s} {km_total:6.2f} km {len(cs):3d} cadeias  CET {conf}%  {'; '.join(problems)}")
        if not cs:
            print(f'    ! {sid} sem geometria: {problems}')
            continue
        way_ids = sorted({w for c in cs for u, v in zip(c, c[1:]) for w in set(net.node_ways[u]) & set(net.node_ways[v])})
        ativo = par.get('ativo', True)
        props = {
            'paragrafo': tr['par'],
            'inciso': tr['inc'],
            'texto_legal': tr['texto'],
            'norma': f"{par['norma']}, {tr['inc']}",
            'janelas': par['janelas'],
            'horario': par['horario'],
            'exceto_feriados': True,
            'excecoes': par['excecoes'],
            'vuc': par['vuc'],
            'ativo': ativo,
            'vigencia': par.get('vigencia', VIGENCIA_137),
            'revogado_quando_s5_vigorar': bool(tr.get('revogado_p49')),
            'sentido': tr.get('sentido_txt'),
            'extensao_km': round(km_total, 2),
            'cadeias': len(cs),
            'osm_ways': way_ids[:400],
            'conferencia_cet_pct': conf,
            'casamento': 'corredor' if tr.get('cor') else 'entre limites' if tr.get('segs') else 'toda extensão',
            'nota': tr.get('nota'),
            'avisos_casamento': problems or None,
        }
        feats.append({
            'source_id': sid,
            'name': tr['nome'],
            'kind': par['kind'],
            'geometry': {'type': 'MultiLineString', 'coordinates': coords},
            'props': props,
            'valid_from': '2018-10-03T00:00:00-03:00' if ativo else None,
            'valid_to': None,
        })
    # checagem no Valhalla (todas as cadeias numa requisição; busca binária se alguma falhar; reparo por quebra)
    flat = [(i, j) for i, f in enumerate(feats) for j in range(len(f['geometry']['coordinates']))]
    bad = valhalla_bad([feats[i]['geometry']['coordinates'][j] for i, j in flat])
    if bad is None:
        print('    ! Valhalla indisponível: cadeias não checadas (a API checa de novo antes de usar)')
    else:
        badset = {flat[k] for k in bad}
        for i, f in enumerate(feats):
            new = []
            for j, c in enumerate(f['geometry']['coordinates']):
                new.extend(split_valid(c) if (i, j) in badset else [c])
            f['geometry']['coordinates'] = new
            f['props']['cadeias'] = len(new)
        print(f'    {len(bad)} cadeia(s) não casavam com o grafo do Valhalla e foram quebradas/aparadas')
    for f in feats:
        f['props']['valhalla_checado'] = bad is not None
    tot = sum(r[2] for r in report)
    print(f'    {len(feats)} incisos com geometria de {len(trechos)}, {tot:.1f} km de cadeias dirigidas; '
          f"{sum(1 for r in report if r[5])} com avisos de casamento")
    return feats


def fetch():
    return build_features(TRECHOS)
