# Lote IMP05 — restrições municipais de caminhão (Viçosa/MG e 10 municípios do RJ)

Implementação na camada genérica `restricoes_rmsp` (formato em [`../../restricoes_municipais.md`](../../restricoes_municipais.md))
das regras pesquisadas em `docs/research/cidades_sudeste/res/<ibge>.json` com as correções de `verif/<ibge>.json`
(verificação de 10 e 11/10/2026). Implementado em 11/10/2026.

| IBGE | Município | fonte_id | Ativas | Desativadas | Suspensas/revogadas | Casos de rota (evita / sem alternativa) | Teste |
|---|---|---|---|---|---|---|---|
| 3171303 | Viçosa/MG | `vicosa` | 0 | 1 | 0 | — (sem feição) | sem fixture |
| 3300407 | Barra Mansa | `barra-mansa` | 1 | 2 | 0 | 1 / 0 | passa |
| 3301009 | Campos dos Goytacazes | `campos-dos-goytacazes` | 3 | 4 | 4 revogadas | 3 / 0 | passa |
| 3302007 | Itaguaí | `itaguai` | 1 | 7 | 1 revogada | 1 / 0 | passa |
| 3302403 | Macaé | `macae` | 2 | 2 | 0 | 2 / 0 | passa |
| 3302502 | Magé | `mage` | 0 | 4 | 0 | — | passa (kinds) |
| 3302601 | Mangaratiba | `mangaratiba` | 1 | 2 | 0 | 1 / 0 | passa |
| 3302700 | Maricá | `marica` | 2 | 2 | 0 | 2 / 0 | passa |
| 3302908 | Miguel Pereira | `miguel-pereira` | 1 | 1 | 0 | 1 / 0 | passa |
| 3303302 | Niterói | `niteroi` | 2 | 5 | 0 | 2 / 0 | passa |
| 3304003 | Piraí | `pirai` | 1 | 0 | 0 | 0 / 0 (ver pendência) | passa (kinds) |

Arquivos: `data/raw/municipios/<ibge>.json`, `data/raw/municipios/geo/<ibge>_*.geojson`,
`db/seed/layers/restricoes_rmsp__<fonte_id>.sql`, `api/test/fixtures/mun_sudeste/<ibge>.json`.
Teste: `cd api && API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"` (os 10
fixtures do lote: 23 testes passando em 11/10/2026; "carga e registro" com todos os fixtures: 61 passando).

Regras gerais do lote:

- Regra "desativada" sem área delimitada no ato fica **sem feição** (`{"geojson": {"type": "FeatureCollection", "features": []}}`):
  continua no arquivo do município, mas não vai ao banco nem gera aviso. Exceção: quando a pesquisa já indicava o
  limite municipal (`{"municipios": [...]}`), ele foi mantido (Itaguaí e Niterói); essas regras geram o aviso
  `municipal_regra_nao_aplicada` (info) em qualquer rota de caminhão no município.
- Geometria do OSM: o cache `data/cache/municipios/osm_named_<ibge>.json` (PBF local) para vias com nome; para os
  corredores de rodovias (alças sem nome) uma extração do mesmo PBF (`data/valhalla/sudeste-latest.osm.pbf`, pyosmium)
  dos ways `highway` com `ref` BR-/RJ-, `IBGE:CD_ADMINIS` federal/estadual ou classe motorway/trunk e alças.
- IBGE: malhas do Censo 2022 do geoftp (`malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/`
  `{distritos,bairros,setores}/gpkg/UF/RJ/RJ_*_CD2022.gpkg`, SIRGAS 2000; diferença para o WGS 84 abaixo de 1 m), lidas com
  sqlite3 + shapely (o cabeçalho GeoPackage é retirado antes do WKB).
- Os imports foram feitos com `MUNICIPIOS_DIR` isolado (só o arquivo do município + schema), porque o import valida todos
  os arquivos e um arquivo incompleto de outro lote (3118304) travava a carga; a validação de todos (`--validar`, 113
  arquivos, sem `fonte_id` nem id de regra repetidos) passou no fim.
- Casos de rota: conferidos na API (`POST /api/route`, terça 13/10/2026 salvo indicação) com o mesmo critério do teste
  (km da rota a até 10 m das linhas, ou dentro do polígono recuado 20 m). Veículo de controle citado na `nota` de cada caso.

## 3171303 — Viçosa/MG

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `vicosa_campus_ufv_3t` | desativada (confiança média) | Lei 3.063/2023, art. 1º e §§1º–4º | todos os dias, 24 h | caminhão com capacidade de carga ≥ 3 t (`payload_t` acima de 2,99) | sem feição | — |

Pendência: **sem geometria confiável**. O ato não descreve o perímetro do campus; no PBF não há contorno do campus da
UFV (só áreas internas: Horto Botânico, Parque da Lagoa, Espaço de Eventos) e o IBGE não tem malha de bairros de Viçosa.
Reativar com uma planta do campus ou o decreto do art. 3º. Sem fixture (a fonte tem 0 feições).

## Zonas leves: limite de vértices do Valhalla (12/10/2026)

O `exclude_polygons` do Valhalla aceita 20.000 vértices por rota, somando todas as zonas. Numa rota longa (Barueri → Barra da Tijuca) as
zonas municipais somavam ~21.700 vértices (só Campos dos Goytacazes tinha 9,6 mil depois do recuo de 20 m e Mangaratiba 3,1 mil) e o
teste `descanso.test.ts` falhava com "Exceeded maximum number of vertices for exclude_polygons: 20000". Cada zona com mais de ~800
vértices foi simplificada (vértices do arquivo, antes → depois):

| município | arquivo | antes | depois |
|---|---|---|---|
| 3301009 Campos dos Goytacazes | `3301009_vias_municipais.geojson` | 10.902 | 809 |
| 3302601 Mangaratiba | `3302601_area_urbana.geojson` | 3.137 | 774 |
| 3554003 Tatuí | `3554003_municipio.geojson` | 1.321 | 675 |
| 3538006 Pindamonhangaba | `3538006_zrtc.geojson` | 986 | 613 |
| 3300407 Barra Mansa | `3300407_distrito_amparo.geojson` | 827 | 615 |
| 3500402 Águas da Prata | `3500402_municipio.geojson` | 600 | 332 |

Sobraram acima de ~800 só o Jacareí (`3524402_fora_rcp` 2.042 e `3524402_vcpb_vcpt` 1.409, mas em 22 e 14 feições de até 446 vértices
cada) e Lafaiete (`3118304_area_urbana_aproximada`, 870, regra desativada que não vai ao Valhalla). Somados, os vértices das zonas
(`kind = zona`, 119 feições) passaram de 32.968 para 19.467 no banco e, na rota Barueri → Rio, de ~21.700 para ~11.500.

Como se simplifica: sempre PARA DENTRO (`curadoria/zona_rodovia_lib.simplificar_para_dentro`: encolhe `tol` e simplifica com a mesma
tolerância, o que garante que a zona nunca cresça e invada as vias do lado de fora do perímetro), ANTES do recorte das rodovias livres e
de novo depois dele, e a folga às rodovias livres fica garantida (as vias entram simplificadas no buffer; `verificar` confere a menor
distância do anel externo a cada via livre). A camada usa só o anel externo de cada polígono: um corredor cercado pela zona vira uma fenda
ligada ao exterior (`abrir_fendas`). Extrato de todas as vias do PBF: `curadoria/osm_pbf_vias.py` → `data/cache/municipios/osm_hw_<ibge>.json`.
Zonas sem rodovia recortada (distrito de Barra Mansa): `curadoria/simplificar_zona.py`.

Efeito colateral aceito: o contorno recua entre 0 e 2 × a tolerância (Campos perde ~19% da área, Mangaratiba ~15%), então a zona fica um pouco
menor que o perímetro aproximado de antes. O toco de Pindamonhangaba, p. ex., agora faz 29,5 km (antes 26,4 km): com menos exclusão a rota
mais rápida é um pouco mais longa.

## 3300407 — Barra Mansa

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `barramansa_distrito_amparo_14_5t` | ativa (média) | Lei 4.580/2016, art. 1º; Lei 4.836/2019 (parágrafo único) | 24 h | PBT acima de 14,5 t | distrito 330040720 (IBGE 2022), simplificado para dentro a 15 m (827 → 615 vértices), `geo/3300407_distrito_amparo.geojson` | evita: Centro de Barra Mansa → leste do distrito, carreta 106,1 km fora do distrito (o VUC de 9 t cruza 13,6 km) |
| `barramansa_lixo_outros_municipios` | desativada | Lei 4.704/2018, art. 1º | — | caminhão de lixo de outro município | sem feição | — |
| `barramansa_viaduto_elias_rodrigues_costa_osm` | desativada (baixa) | só OSM (maxweight 20 t) | — | PBT > 20 t | OSM por nome, `geo/3300407_vias.geojson` | — |

Exceção de entrega local do distrito: `origem_destino_dentro: avisa`. A zona alcança também as estradas que cruzam o
distrito (a lei não as excetua). Pendência: decretos do Executivo (Boletim Oficial atrás de Cloudflare) não pesquisados.

## 3301009 — Campos dos Goytacazes

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `campos_goytacazes_vias_municipais_4_eixos` | ativa (alta) | Portaria IMTT 21/2025, art. 1º, §§1º–2º, arts. 2º–4º | 24 h | mais de 4 eixos; destino no município fora da regra | limite IBGE menos faixas de 30 m das rodovias BR/RJ (OSM), `geo/3301009_vias_municipais.geojson` | evita: São Fidélis → São João da Barra, carreta 5 eixos fica nas rodovias (94,2 km); o truck passa 3,5 km por vias municipais |
| `campos_goytacazes_ponte_saturnino_brito_2_eixos` | ativa (alta) | Portaria Conjunta IMTT/SMPUMMA 01/2024, arts. 1º–3º | 24 h | mais de 2 eixos | OSM 'Ponte Saturnino Brito' | evita: Lapa → Guarus, truck usa outra ponte (5,4 km; o toco atravessa) |
| `campos_goytacazes_goitacazes_sebastiao_silvano_dario_canela` | ativa (média) | Portaria IMTT 019/2017, art. 1º | 24 h | mais de 2 eixos | OSM: Rua Sebastião Silvano e Av. Dário Canela Tavares inteira | evita: Goitacazes, truck 0,02 km na via (o toco usa 4,1 km) |
| `campos_goytacazes_area_central_3_eixos` | desativada | Lei 9.137/2022, art. 87, §2º | 24 h | mais de 3 eixos | sem feição (área Central não delimitada) | — |
| `campos_goytacazes_corredor_arthur_bernardes_lamego` | desativada | Portaria IMTT 87/2024 | — | > 4 eixos (corredor) | OSM por nome | — |
| `campos_goytacazes_bairros_residenciais_pesados` | desativada (baixa) | Lei 9.137/2022, art. 64, VII | — | pesados | sem feição | — |
| `campos_goytacazes_cana_ponte_lapa_emut_2011` | desativada (baixa) | Portaria EMUT 175/2011 | — | carga de cana | OSM por nome | — |
| `campos_goytacazes_portaria_55_2024`, `_93_2022`, `_47_2022`, `_38_2022` | revogadas | Portarias IMTT 55/2024, 93/2022, 47/2022, 38/2022 | — | > 4 eixos | mesma zona (`source_id` fixo) | — |

Geometria da zona: limite municipal (IBGE) menos as rodovias do PBF com `ref`
BR-/RJ- (BR-101, BR-356, RJ-158, RJ-180, RJ-190, RJ-194, RJ-196, RJ-204, RJ-208, RJ-216, RJ-224, RJ-228, RJ-238 etc.),
`IBGE:CD_ADMINIS` federal/estadual (ex.: Av. Alberto Lamego), motorway/trunk e alças ligadas a eles. Uma feição MultiPolygon.
**Simplificada em 12/10/2026** de 10.902 vértices em 47 partes para 809 em 45 (`geo/3301009_vias_municipais_curadoria.py`): em rotas
longas (Rio → SP) a soma dos vértices das zonas passava do limite de 20.000 do `exclude_polygons` do Valhalla ("Exceeded maximum number of
vertices"). O recorte tem duas resoluções e sempre simplifica para dentro (a zona não cresce): na cidade (raio de 4,5 km do centro) a
simplificação é de 15 m antes do recorte e 25 m depois; no resto do município, de 150 m e 400 m, sem as partes com menos de 5 km²
(a zona perde ~19% da área, quase toda rural, junto às rodovias). Nenhuma via livre fica a menos de 35 m da zona; com o recuo de 20 m da
camada, cada rodovia fica com 55 m livres, no mínimo, de cada lado. Pendências: rodovia estadual sem `ref` nem `IBGE:CD_ADMINIS` no OSM fica dentro da
zona; a extensão da Av. Dário Canela Tavares atingida não é fixada no ato (tomada inteira).

## 3302007 — Itaguaí

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `itaguai_estr_cacador_teixeira_29t` | ativa (média) | Res. SMSPDCT 07/2023, arts. 1º, 2º, 5º–8º | 24 h | PBT acima de 29 t | OSM: Estrada dos Teixeiras, Estrada Dona Elizabeth, Estrada do Caçador (inteiras) | evita: BR-101 → norte da Estrada do Caçador, carreta 17,5 km fora delas (o toco usa 6,5 km) |
| `itaguai_res06_2023_chapero_29t` | revogada | Res. 06/2023; Res. 07/2023, art. 7º | — | PBT > 29 t | OSM 'Estrada de Chaperó' | — |
| `itaguai_lei2440_mais_3_eixos` | desativada (média) | Lei 2.440/2004 red. Lei 2.611/2007, art. 1º | 24 h | > 3 eixos | limite municipal (registro) | — |
| `itaguai_lixo_outros_municipios_lei3530` | desativada | Lei 3.530/2017, art. 1º | 24 h | lixo de outro município | OSM por nome | — |
| `itaguai_calcadao_paulo_frontin_cd` | desativada | Res. SMTTDC 027/2018, art. 1º | — | — | OSM (só um pedaço curto com nome) | — |
| `itaguai_carga_descarga_smttdc004` | desativada | Lei 3.393/2016; Res. SMTTDC 004/2017 | — | — | limite municipal (registro) | — |
| `itaguai_cais_ilha_madeira_leves` | desativada | Res. SMAP 002/2024 | — | — | sem feição (Rua Miguel Correa sem nome no OSM) | — |
| `itaguai_ponte_mazomba_2019` | desativada | Res. 002/2019, art. 1º, III | — | — | Estrada do Mazomba inteira (aproximado) | — |
| `itaguai_conteineres_estacionamento` | desativada | Lei 2.455/2004 | — | — | limite municipal (registro) | — |

No OSM a Estrada dos Teixeiras vai da BR-101 ao início da Estrada do Caçador, de onde sai a Estrada Dona Elizabeth: as três
vias foram tomadas inteiras. Há um trecho de ~2,6 km sem nome no meio da Estrada do Caçador (não entra). Pendência: Rua
Miguel Correa (cais) sem nome no OSM.

## 3302403 — Macaé

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `macae_eixos_servicos_6t` | ativa (média) | Lei 3.434/2010, arts. 10, 3º, II, 2º, §4º, I–XVIII | todos os dias 6h–20h | capacidade de carga acima de 6 t | vias dos 18 grupos por nome, recortadas no bairro do inciso (IBGE), `geo/3302403_evs.geojson` | evita: Lagomar → Glória, toco às 10h a 0,04 km dos EVS; às 21h passa 8,2 km por eles |
| `macae_centro_amaral_peixoto_6t_pico` | ativa (média) | Lei 3.238/2009, art. 1º; Dec. 267/2009, arts. 1º–2º | 6h–8h e 17h–20h | capacidade ≥ 6 t (acima de 5,99) | percurso do Valhalla pela RJ-106 do trevo da Praia Campista ao Centro de Convenções, `geo/3302403_vias.geojson` | evita: Cavaleiros → São José do Barreto, toco às 7h 0 km na RJ-106 do Centro; às 21h 7,4 km |
| `macae_cargas_especiais_licenca` | desativada | Lei 3.434/2010, arts. 8º–9º | — | — | sem feição | — |
| `macae_evs_carga_descarga_ate_6t` | desativada | Lei 3.434/2010, art. 3º, I | — | — | sem feição | — |

EVS: para cada inciso, os nomes do ato (e as grafias do OSM abaixo) casados nos ways do cache que tocam o buffer de
~300 m do(s) bairro(s) do IBGE 2022 (Centro; Imbetiba; Cajueiros + Alto dos Cajueiros; Miramar; Visconde de Araújo;
Aroeira; Botafogo; Virgem Santa; Riviera Fluminense; Praia Campista; Cavaleiros; Glória; Granja dos Cavaleiros; Barra de
Macaé; Parque Aeroporto; São José do Barreto; Lagomar; Ajuda de Baixo + Ajuda de Cima), recortados nesse buffer; nomes
genéricos (Rua E, Rua 11, Rua 13, Avenida A, Rua Principal) com buffer de ~50 m; a RJ-106 do inciso XIV é a Rodovia
Amaral Peixoto dentro do bairro Barra de Macaé. 95 vias casadas, 263 linhas (340 no banco após o corte de 400 m); o
import descartou 3 trechos que não casam com o grafo (Rua do Proletário, um sentido da Av. Atlântica, Alameda Tenente Célio).

Grafias do OSM adotadas (ato → OSM): Av. Presidente Feliciano Sodré → Avenida Presidente Sodré; Rua Tarcísio de Almeida
Miranda → Rua Senador Tarcísio de Almeida Miranda; Rua Pref. Antônio Curvelo Benjamim → ...Benjamin; Rua do Proletariado →
Rua do Proletário; Rua Pref. Milne Ribeiro → Rua Prefeito Milme Ribeiro; Av. Dr. Humberto de Queiroz Matoso → ...Mattoso;
Rua Gastão Henrique Schueller → ...Schueler; Rua Eurozina Nolasco de Abreu → Rua Erozina...; Rua Antônio Bichara Filho →
Rua Antônio Bechara Filho; Rua Maria José Mahon Santos → Rua Maria José Mahon dos Santos; Estrada da Virgem Santa →
Estrada Virgem Santa; Rua Amaro do Espírito Santo Bernardo → Rua Amaro e S. Bernardo; Estrada Cancela Preta → Estrada (da)
Cancela Preta; Av. Guadalajara → 'Rua Rua Guadalajara'; Rua Lindolfo Collor → Rua Lindolfo Color; Rua Prof. Ana Benedicta →
Rua Professora Ana Benedita; Rua César José de Souza Mello → Rua Cezar...; Estrada Rodolfo David Gomes → Rua Rodolfo David
Gomes; Av. Tenente Célio → Alameda Tenente Célio; Av. Acadêmico Paulo Sérgio de Carvalho Vasconcelos → ...Vasconcellos;
Alameda do Açude → Rua do Açude; Rua Caetano Corrêa dos Reis → Rua Caetano Correa dos Reis; Rua Aurélio Cristiano da Silva
→ Rua Aurelio Cristiniano da Silva; Rua Ivanilde Natalino → Rua Professora Vanilde Natalino de Matos; Rua Geraldo
Menecucci → Rua Doutor Geraldo Mannecucci de Oliveira; Rua Ângela Puererari → Rua Irmã Angela Puerari; Rua Nelson Corrêa
Brum → Rua Nelson Correia Brum; Rua Antônio Álvares Parada → Rua Professor Antônio Avarez Parada; Rua Antônio Guimarães
Mosqueira → Estrada Antônio Guimarães Mosqueira; Rua Antônio Cezário → Rua Antônio Cesario; Av. W-12 → Avenida W 12; Av.
W-5 → Avenida Pastor Sérgio Vieira de Mello W 5; Av. José Alvarez de Azevedo → Avenida José Alvares de Azevedo.

Pendências de geometria (EVS sem via no OSM dentro do bairro, também em `pendencias` do GeoJSON): I Rua Manoel Joaquim
Reis; IV Rua Jaci Azevedo, Av. Amaral Peixoto (Miramar); V Rua Coronel Sizenando de Souza; VI Rua Leopoldina Neves
Pinheiro; VIII Estrada MC 85; IX Estrada dos Cavaleiros, Rua Irene Meirelles e Rua Marfim (existem fora do bairro), X Rua
Godin da Fonseca; XI Av. Nossa Senhora da Glória (existe em outro bairro), Rua E; XII Rua João Alves Jobim Saldanha; XIII
Alameda Jequitibá; XIV Rua 13, Rua Principal da Nova Holanda; XV Rua Tancredo Neves (no OSM só 'Avenida Presidente
Tancredo Neves', não adotada), Estrada MC 03; XVI Avenida A; XVII Av. W-1, Av. Santa Catarina; XVIII Av. do Manguezal
(proposta), Estrada Antônio Carlos de Moraes, Av. Três, Av. Dois, Rua do Caminho.

RJ-106 do Centro: no OSM a travessia é um binário de várias ruas (Av. Rui Barbosa, Rua Tiradentes, Rua Teixeira de
Gouveia, Rua Dr. João Cupertino, Av. Presidente Sodré, Ponte Eng. Ivan Gorretta Mundin), por isso `caminho: valhalla` entre
as pontas (corredor de 800 m), nos dois sentidos. A ponta sul (trevo da Praia Campista) é dedução da pesquisa.

## 3302502 — Magé

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `mage_piabeta_vias_pavimentacao` | desativada (inverificável) | Dec. 2.047/2004, arts. 1º–4º | 24 h | caminhão | OSM por nome recortado no distrito de Inhomirim (IBGE), `geo/3302502_piabeta_vias.geojson` | — |
| `mage_piabeta_centro` | desativada (baixa) | Dec. 2.047/2004, art. 1º | 24 h | caminhão | sem feição | — |
| `mage_arc_dec2886` | desativada (inverificável) | Dec. 2.886/2013, arts. 2º e 5º | picos | caminhão | sem feição | — |
| `mage_zrcd_carga_descarga` | desativada (inverificável) | Dec. 2.886/2013, art. 3º | — | — | sem feição | — |

O verificador não conseguiu reabrir o Dec. 2.047/2004 (veredito "inverificável"): a regra das vias de Piabetá entra
desativada. Pendência: reabrir o decreto e, se confirmado, ativar (a geometria já está pronta). As homônimas da Av.
Governador Roberto Silveira em Guia de Pacobaíba ficaram de fora pelo recorte do distrito.

## 3302601 — Mangaratiba

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `mangaratiba_lei999_janelas_6_30m` | ativa (média) | Lei 999/2016, arts. 3º–7º | proibido 0h–7h, 9h–18h e 20h–24h | comprimento acima de 6,30 m | setores urbanos do IBGE 2022 menos a travessia da BR-101 e das RJ (folga de 55 m; 774 vértices em 28 partes, eram 3.137), `geo/3302601_area_urbana.geojson` | evita: toco entre Muriqui e Itacuruçá, ao lado da BR-101: às 10h fica fora da área urbana (12,6 km); às 8h passa 0,2 km nela pela Rua Dalila Dias Borges (11,6 km). A BR-101 inteira passa livre |
| `mangaratiba_lei999_acima_12m` | desativada (baixa) | Lei 999/2016, art. 2º | 24 h | > 12 m | mesma zona | — |
| `mangaratiba_lei877_mais_3_eixos` | desativada (baixa) | Lei 609/2007 red. Lei 877/2013, art. 1º | 24 h | > 3 eixos | sem feição | — |

Ids sem o prefixo numérico do rascunho (`3302601_mangaratiba_...` → `mangaratiba_...`). Área urbana: setores de situação
urbana (CD_SIT 1, 2 e 3) do Censo 2022, que seguem o perímetro urbano legal, menos a travessia da BR-101 (Rio-Santos, também
`RJ-014`) e das RJ; aproximada.

**Corrigido em 12/10/2026.** A primeira versão cortava só faixas de 30 m dos ways com `ref` BR-/RJ-. Os trechos da travessia sem `ref` no OSM
(alças `primary` sem nome que ligam a BR-101 à Estrada São João Marcos, a própria Estrada São João Marcos e a Rua Arthur Pires, que
levam ao centro) ficavam dentro da zona e a carreta de Itaguaí a Mangaratiba tinha NO_ROUTE (`pedagio.test.ts`, pórtico free flow de
Itaguaí). Agora saem da zona, com folga de 55 m de cada lado (a camada ainda recua 20 m): toda a BR-101 (todas as pistas, alças e ligações,
com ou sem `ref`), as RJ e toda via trunk/primary sem `ref`, o mesmo critério de Arcos e Santa Branca. Conferido com as vias do PBF: a
menor distância da zona recuada a qualquer via livre é de 73 m e a rota Itaguaí–Mangaratiba pela Rio-Santos fica a 77 m, sem tocar a zona.
O script é `geo/3302601_area_urbana_curadoria.py` (setores do RJ + `data/cache/municipios/osm_hw_3302601.json`, de `curadoria/osm_pbf_vias.py`).
O caso de rota anterior (BR-101 a oeste do centro) deixou de valer, porque a rota passa livre nos dois horários, e foi trocado. Efeito: fora das janelas, um destino que só se alcança pela área urbana fica sem
rota para caminhão acima de 6,30 m (NO_ROUTE com a regra em `blocked_by`), como diz a lei. Pendências: decreto do art. 2º
(vias de acesso a atividades comerciais e industriais) não localizado; data de publicação da Lei 999 desconhecida.

## 3302700 — Maricá

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `marica_veiculos_carga_pico` | ativa (alta) | Dec. 1.314/2024, arts. 1º, I, 2º, I, 5º, 6º | dias úteis 7h–9h e 16h–18h (feriado suspende) | caminhão | 21 vias do art. 5º no OSM, `geo/3302700_vias.geojson` | evita: Centro, toco às 8h 0 km nos eixos (7,2 km); às 11h 1,4 km |
| `marica_comprimento_14m` | ativa (média) | Dec. 1.314/2024, arts. 3º, 5º, 6º | 24 h | comprimento acima de 14 m | mesmas vias | evita: carreta 19,3 m 0 km nos eixos; o truck de 12 m passa 1,4 km |
| `marica_ponte_ponta_negra` | desativada (baixa) | sem ato (notícia) | — | PBT > 3,5 t | sem feição | — |
| `marica_carga_descarga_pesados_2013` | desativada (baixa) | Dec. 173/2013, arts. 1º e 3º | — | — | sem feição (as 22 vias não foram transcritas) | — |

Grafias do OSM: Av. Vereador Francisco Sabino da Costa → 'Avenida Vereador Francisco Sabino da Silva Costa'; Rua Dr. Milton
de Souza Pacheco → 'Rua Doutor Milton...'; Rua Pref. Hilário da Costa e Silva → 'Rua Prefeito Hilário Costa e Silva'; Av.
Antônio Vieira Sobrinho → 'Rua Antônio Vieira Sobrinho'; Rua Hilário Luiz Queiroz da Silva → 'Rua Hilário Luiz da Silva
Queiroz'; Rua Ary Spindola → 'Rua Ari Spindola'. Av. Roberto Silveira e Rua Álvares de Castro terminam a ~65 m e ~95 m da
transversal final no OSM (`tolerancia_m` 80 e 110). O import descartou dois pedaços (Av. Vereador Francisco Sabino da
Silva Costa e Rua Abreu Sodré) que não casam com o grafo. Pendências: 'Rua M' (19 vias homônimas espalhadas pelo
município, nenhuma no Centro) e Rua Eugênia Modesto da Silva (sem nome no OSM).

## 3302908 — Miguel Pereira

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `miguelpereira_rua_osorio_almeida_pesados` | ativa (média) | Dec. 6.773-A/2023, art. 1º e parágrafo único | sex, sáb e dom 24 h (feriado aplica) | caminhão | OSM 'Rua Doutor Osório de Almeida' (toda em Governador Portela, IBGE) | evita: sexta, toco 0,02 km na rua (2,8 km); quarta passa 0,31 km |
| `miguelpereira_travessa_pedro_cardoso` | desativada (baixa) | Lei 2.101/2005, art. 1º (só autoriza) | — | — | sem feição (sem nome no OSM) | — |

`excecao_destino_local: false` (o rascunho trazia `true`): a exceção do ato é só para destino no próprio trecho, não em
qualquer ponto do município (a própria nota da pesquisa diz isso); o custo da via ainda permite chegar a um destino nela.
Feriado em dia de semana não é coberto pela janela (sex–dom).

## 3303302 — Niterói

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `niteroi_miguelote_viana_port531_2026` | ativa (alta) | Portaria NitTrans 531/2026, arts. 1º–2º | 24 h | caminhão | OSM 'Rua Comandante Miguelote Viana' (way inteiro) | evita: Icaraí, toco 0,02 km na rua (o utilitário passa 0,58 km) |
| `niteroi_ponta_dareia_heavy_lift_port34_2013` | ativa (média) | Portaria SMU/SSTT 34/2013 red. Portaria SMU/SST 7/2017, art. 2º | seg–sex 6h–8h e 17h–19h; sáb 8h–10h | > 3 eixos e (largura > 2,60 m ou altura > 4,40 m) | bairros Ponta D'Areia e Ilha da Conceição (IBGE 2022) + faixa de 40 m da Av. Feliciano Sodré (OSM) | evita: carreta de 3,20 m às 7h 0 km na zona; às 11h 0,20 km |
| `niteroi_nestor_perlingeiro_port540_2026` | desativada (baixa) | Portaria NitTrans 540/2026 | 24 h | caminhão | linha aproximada (way 265033518 junto à Praça João Saldanha) | — |
| `niteroi_ponta_dareia_cvc_port34_2013` | desativada | idem | picos | CVC > 3 unidades | mesma zona | — |
| `niteroi_ponta_dareia_3eixos_leitura_alternativa` | desativada (baixa) | idem | picos | > 3 eixos | mesma zona | — |
| `niteroi_carga_descarga_dec17_2025` | desativada | Dec. 17/2025, art. 1º | picos | carga e descarga | limite municipal (registro) | — |
| `niteroi_itaguai_port197_2016` | desativada | Portaria SMU/SST 197/2016, art. 2º | 24 h | caminhões do mercado | OSM 'Rua Itaguaí' | — |

A faixa da Av. Feliciano Sodré vai de Ponta D'Areia ao acesso à Ponte Rio–Niterói (pistas primary/secondary, sem as
alças motorway_link): em pico, uma carreta heavy lift do Centro de Niterói para o Rio deixa de usar esse acesso (na
conferência, 106 km pela volta da baía). É o que o ato diz ("seus acessos, incluindo a Av. Feliciano Sodré"), mas a
extensão da faixa é aproximação. O trecho da Portaria 531 ficou sem `de`/`ate` (o way inteiro já é o trecho; com uma só
linha o construtor de trechos quebra, ver abaixo). O limite municipal da regra de carga e descarga (Dec. 17/2025) gera
aviso info em toda rota de caminhão em Niterói.

## 3304003 — Piraí

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `pirai_trucados_carretas_3vias` | ativa (média) | Lei 704/2003, arts. 1º, 2º e 4º | 24 h | mais de 2 eixos ou combinação articulada | OSM 'Rua Barão de Piraí', 'Rua Manoel Teixeira Campos Júnior', 'Avenida Beira Rio' (inteiras) | nenhum (ver pendência) |

Pendência: sem caso de rota "evita". As três vias são mão única no centro e só servem ao acesso local: nenhuma rota de
passagem as usa (nem a do utilitário), e toda rota pela RJ-145 no centro encosta nas pontas delas (~0,11 km a até 10 m,
nos cruzamentos), acima do limite de 0,05 km do teste. A regra está carregada e é aplicada (a rota do truck a evita e
lista em `avoided` quando ela está no caminho).

## Problemas encontrados fora do lote (não alterados)

- `importers/sources/_municipios_lib.py`, `build_trecho`: com `de`/`ate` e uma via de **um só way** no OSM,
  `linemerge(unary_union(lines))` recebe um LineString e o shapely 2.0 levanta `ValueError: Cannot linemerge`, derrubando
  o import do município (caso de Niterói, contornado tirando `de`/`ate`). Sugestão: `linemerge(MultiLineString([...]))`
  ou tratar o LineString único.
- O import (`municipios:<ibge>`) valida **todos** os arquivos de município antes de carregar um: um GeoJSON manual
  faltando em outro lote (3118304) bloqueia a carga de qualquer município. Contornado com `MUNICIPIOS_DIR` isolado.
- `MUNICIPIOS_REBUILD=1` tenta reconstruir também as geometrias `manual` e falha ("ausente") quando o arquivo existe; para
  refazer só os trechos é preciso apagar o GeoJSON gerado.
