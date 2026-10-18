# IMPSC06 — Mamborê, Campo do Tenente, Marilena, Goioxim, Pitangueiras (PR), Abelardo Luz, Morro da Fumaça, Timbé do Sul e Xaxim (SC)

Lote do Sul/Centro-Oeste implementado em 18/10/2026 na camada genérica `restricoes_rmsp` (um arquivo por município em
`data/raw/municipios/<ibge>.json`, ver [`../../restricoes_municipais.md`](../../restricoes_municipais.md)). A pesquisa
(`docs/research/cidades_sul_co/res/<ibge>.json`) e a verificação de 18/10/2026 (`verif/<ibge>.json`) são a fonte; onde
divergem, vale a verificação. Geometria: nomes das vias casados no OSM (cache do PBF local, ODbL), polígono do
Perímetro Central de Pitangueiras desenhado sobre os eixos do OSM e as rodovias TBS-010/TBS-379 de Timbé do Sul
curadas à mão a partir do PBF (são `ref` sem nome no OSM). Fixtures de rota: `api/test/fixtures/mun_sul_co/<ibge>.json`
(teste `api/test/layers/mun_sul_co.test.ts`, passando). Nenhum município do lote define VUC (`vuc: null`: o VUC é tratado
como caminhão). Em todos, `feriados: aplica` (nenhum ato excetua feriados).

| ibge | Município | fonte_id | Ativas | Desativadas | Revogadas | Rotas (evita / sem alternativa) |
|---|---|---|---|---|---|---|
| 4114005 | Mamborê | `mambore` | 1 | 0 | 0 | 1 / 0 |
| 4104105 | Campo do Tenente | `campo-do-tenente` | 1 | 2 | 0 | 1 / 0 |
| 4115002 | Marilena | `marilena` | 0 | 6 | 0 | 0 / 0 (sem fixture, ver abaixo) |
| 4108650 | Goioxim | `goioxim` | 1 | 0 | 0 | 1 / 0 |
| 4119657 | Pitangueiras | `pitangueiras` | 1 | 0 | 0 | 2 / 0 |
| 4200101 | Abelardo Luz | `abelardo-luz` | 1 | 0 | 0 | 1 / 0 |
| 4211207 | Morro da Fumaça | `morro-da-fumaca` | 5 | 3 | 2 | 5 / 0 |
| 4218103 | Timbé do Sul | `timbe-do-sul` | 1 | 1 | 0 | 1 / 0 |
| 4219705 | Xaxim | `xaxim` | 0 | 1 | 0 | 0 / 0 (desativada) |

Regra com confiança `baixa` nunca fica ativa na camada (validador e teste). O verificador manteve "ativa" em duas regras
com confiança baixa (Marilena JB-170 e Xaxim); aqui entram desativadas, com o motivo registrado. Regras sem geometria
(revogadas, desativadas sem área) não entram no banco nem no campo `regras` da fixture.

## Mamborê (4114005)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `mambore_vias_centrais_caminhoes` | ativa (média) | Decreto 79/2025, art. 1º, I a VII (8 trechos), §§ 1º e 2º (exceções), art. 2º (trechos liberados), art. 6º (vigência na publicação) | 24 h, todos os dias | caminhões e maquinário agrícola, sem limite de peso | 8 trechos pelo nome no OSM (45 feições, ~12 km contando as duas pistas): Av. São Josafat, Av. Paulino Ferreira Messias, Av. Antônio Chiminacio, Av. Manoel Francisco da Silva, Av. Augusto Mendes dos Santos (2 trechos), Av. Abel Desidério de Araújo e Rua Nelson Camargo Alves | evita: carreta, ter 10h, do oeste ao sul do centro (0 km nas vias; o utilitário usa 1,2 km) |

Notas: a exceção de carga e descarga em horário comercial (art. 1º, § 1º, horário não definido) não é modelável. O trecho
da Av. Augusto Mendes dos Santos entre a Av. Interventor Manoel Ribas e a Rua João Mendes de Oliveira tem `ref=PR-471` no
OSM (acostamento da rodovia estadual dentro da cidade); foi mantido porque o decreto nomeia a avenida e o art. 2º libera
a entrada pela PR-471 pela Av. Abel Desidério. A Av. Abel Desidério (um só way no OSM) foi montada com a Av. "Deside
Araujo" para contornar o `linemerge`.

Pendências: nenhuma de geometria; alteração posterior do decreto não encontrada no Querido Diário.

## Campo do Tenente (4104105)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `campodotenente_vias_olivio_augustinho_30t` | ativa (média) | Decreto 108/2019, art. 1º, I e II; art. 3º (vigência em 03/10/2019) | 24 h | PBT acima de 30 t | só a Rua Olívio Belich (5 feições, ~1,5 km): a Rua Augustinho Tiburski não existe no OSM | evita: carreta (41,5 t), ter 10h, de uma ponta da rua à outra (4,5 km contra 1,8 km do utilitário; 0,025 km, só o cruzamento) |
| `campodotenente_serrinha_7t` | desativada (baixa) | Decreto 237/2013, art. 1º | 24 h | acima de 7 t (sem dizer PBT ou capacidade) | vazia | rebaixada pelo verificador: estrada sem nome nem extensão |
| `campodotenente_estradas_rurais_chuva` | desativada (média) | Lei 971/2019, art. 1º e parágrafo único | condicionada a chuva + 2 dias | caminhões/carretas | vazia | depende do clima e não lista as estradas |

Pendências: Rua Augustinho Tiburski (OSM não tem a via nomeada; o trecho fica no arquivo e é montado quando existir).

## Marilena (4115002)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `marilena_jb170_grupo1` | desativada (baixa) | Lei 2438/2026, art. 2º, I; art. 3º, I, §§ 1º e 2º; art. 6º; art. 15 | 24 h | articulados/combinações, 5+ eixos ou PBT acima de 31,5 t | vazia | sem teste: a JB-170 não tem nome no OSM e o trecho do ato (do prolongamento da Rua São Paulo à PR-577) não é identificável com honestidade (a Rua São Paulo do OSM fica no perímetro urbano, a ~3 km da "ESTR PLACA SÃO PAULO") |
| `marilena_jb120_grupo1` | desativada (média) | Lei 2438/2026, art. 3º, II | 24 h | idem | vazia | só trechos com blocos sextavados sinalizados, sem extensão (mapa 3 fora do texto) |
| `marilena_jb140_grupo1` | desativada (média) | Lei 2438/2026, art. 3º, III | 24 h | idem | vazia | idem (mapa 2) |
| `marilena_antonia_madalena_grupo2` | desativada (média) | Lei 2438/2026, art. 2º, II; art. 4º, I | 24 h | mais de 2 eixos ou capacidade acima de 7 t | vazia | idem (mapa 1) |
| `marilena_av_maringa_grupo2` | desativada (baixa) | Lei 2438/2026, art. 4º, II | 24 h | idem | vazia | 660 m a partir da JB-080 sem sentido nem ponto inicial; Lei 1.678/2018 não lida |
| `marilena_av_beira_rio_grupo2` | desativada (média) | Lei 2438/2026, art. 4º, III | 24 h | idem | vazia | só "calçamento da Prainha", sem extensão (mapa 5) |

Sem fixture de rota: o seed grava 0 feições (todas as regras sem geometria), e o teste `mun_sul_co.test.ts` exige
`record_count > 0` em `data_layer_runs` para toda fixture. Pendências: mapas do Anexo I da Lei 2438/2026 (não estão no
texto do diário), sinalização do art. 7º não confirmada (art. 15: sanção só depois dela).

## Goioxim (4108650)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `goioxim_vias_centrais_carga` | ativa (média) | Lei 712/2021, art. 1º e §§ 1º e 2º; art. 2º (36 ruas); art. 3º (desvio pela Rua Moacir Júlio Silvestre); art. 6º | 24 h | veículos de carga (toco, truck, bitruck, cavalo mecânico, bitrem, rodotrem...), carregados ou não | 23 das 36 ruas pelo nome no OSM (33 feições); a Rua Laurindo Cordeiro de Souza só do trevo da PR-364 à Rua Moacir Júlio Silvestre | evita: carreta, ter 10h, lado leste ao sul da cidade (evita a Rua Laurindo e a Rua Erminda Pereira Boava: 0,04 km, só o cruzamento no trevo; o utilitário usa 0,39 km) |

Modelada como 36 vias nomeadas (o rascunho a chamava de zona): a lista é "em especial" (vias centrais) e o ato não dá
perímetro. A exceção do § 2º (abastecimento do comércio local, entregas eventuais, Prefeitura) é ampla e não
modelável; a Portaria 63/2009 (Anexo I) não foi lida. O desvio obrigatório (Rua Moacir Júlio Silvestre) não é
restrito.

Pendências (13 ruas do art. 2º sem correspondência no OSM, ficam sem geometria): Rua São Roque, Rua Maria de Lurdes de
Souza (o OSM tem só "Rua Maria de Lourdes Gomes", associada à Rua Maria de Lurdes Rocha Gomes), Rua Tereza Kinceler
Ferreira, Rua Sete de Setembro, Rua João de Lacerda Loures, Rua Hilda Marcondes Nunes, Rua João Maronho, Rua João Maria
Alves de Jesus, Rua Lucionel de Jesus Pereira, Rua Paulo Tauscher, Rua Rosina Shadek Gomes, Rua Francisco Pedroso dos
Santos e Avenida Narciso Antônio Cecchin. Grafias do ato diferentes do OSM e adotadas: Neves/Naves, Ferreira/Pereira
(Erminda Boava), Iargas/Vargas (Leonor), Vitor/Vítor.

## Pitangueiras (4119657)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `pitangueiras_perimetro_central_caminhoes` | ativa (média) | Decreto 437/2018, art. 1º e § 1º (perímetro); art. 2º (carga e descarga); art. 3º; art. 4º; art. 7º (vigência 60 dias após a publicação, 04/01/2019) | 24 h | caminhões, articulados, tratores, reboques e implementos, carregados ou não | polígono aproximado (0,17 km²) sobre os eixos do OSM: Rua Olímpia a oeste, Rua São Salvador a leste, Av. Central no meio e Rua 7 de Setembro; limite norte na Rua São Martinho (PR-547, fora) | evita: carreta, ter 10h, oeste-leste (0 km dentro; 2,8 km contra 2,1 km do utilitário); de passagem pela PR-547 sul para nordeste (0 km dentro, 3,2 km, sem volta absurda) |

O ato nomeia as 4 vias mas não fecha o polígono (norte e sul): aproximado, confiança média, avisado na nota. A Av.
Central (OSM: secondary, sem ref) fica dentro porque o § 1º a inclui; a PR-547 (Rua São Martinho) e o trecho da
Rod. Pitangueiras-Sabaúdia ficam fora. A exceção textual de carga e descarga (até 10 t, 17h-10h, art. 2º) não é
modelada. Pendências: nenhuma de geometria.

## Abelardo Luz (4200101)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `abelardoluz_av_getulio_vargas_10t` | ativa (média) | Decreto 044/2026, art. 1º (proibição); art. 2º (rotas SC-155/SC-350); art. 5º (vigência em 16/01/2026) | 24 h | PBT acima de 10 t | "Avenida Presidente Getúlio Vargas" inteira (17 feições, 3,3 km nas duas pistas) | evita: carreta, ter 10h (0,03 km, só cruzamento; o utilitário usa 0,96 km; 2,1 km contra 1,4 km) |

Verificado no OSM: a avenida é via municipal (`secondary`/`residential`, sem `ref`), paralela à SC-155 (que passa em
`Rodovia Rovilho Bortoluzzi`, ref SC-155, e a SC-350 em `Rodovia dos Cavalheiros`); não é travessia de rodovia estadual,
então a regra fica ativa. Pendências: nenhuma.

## Morro da Fumaça (4211207)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `morrodafumaca_dec035_2018_vias_centrais` | ativa (média) | Decreto 035/2018, art. 1º; art. 2º (exceções); art. 4º (vigência 13/03/2018) | 24 h | PBT acima de 7,7 t | Rua 20 de Maio (do cruzamento com a Rua Euclides Manoel Mendes à rotatória da Rod. Tranquilo Sartor, seguindo pela Rua Urussanga no OSM; aproximado), Rua José Cechinel (Vanteiro Margotti a José Guglielmi) e Rua Prefeito Vergínio Maccari | evita: truck, ter 10h, leste-oeste do centro (0 km; o utilitário usa 0,82 km; 4,3 km contra 2,0 km) |
| `morrodafumaca_dec058_2020_euclides_genoveva` | ativa (média) | Decreto 058/2020, art. 1º, I e II; art. 2º | 24 h | PBT acima de 7,7 t | Rua Euclides José Piva e Rua Genoveva Guglielmi Bortolatto (inteiras, 106 e 168 m) | evita: truck, ter 10h (0,04 km, só cruzamento; o utilitário usa 0,16 km; 1,2 km contra 0,5 km) |
| `morrodafumaca_dec115_2018_joao_rocchi` | desativada (média) | Decreto 115/2018, art. 1º (red. Dec. 120/2019); art. 2º; art. 4º | 24 h | PBT acima de 25 t, comprimento acima de 14 m ou articulado | vazia | a "Rua João de Rocchi" (Distrito de Estação Cocal) não existe no OSM; a via do mesmo nome é a "Rodovia João de Rochi" (SC-442, rodovia estadual). A camada não aplica decreto municipal a travessia de rodovia estadual sem prova de que o ato a alcança; reativar se a Prefeitura confirmar que a rua é municipal |
| `morrodafumaca_dec195_2018_santo_antonio_zaccaron` | ativa (média) | Decreto 195/2018, art. 1º; art. 2º, VI (carga e descarga nas empresas); art. 4º (vigência 15/01/2019) | 24 h | PBT acima de 25 t ou comprimento acima de 14 m | Rua Santo Antônio (MOF-405) e Rua Professor Paschoal Zaccaron (OSM: "Pasqual", MOF-410), inteiras | evita: carreta, ter 10h, Distrito de Estação Cocal (0,02 km; o utilitário usa 1,79 km; 2,8 km contra 1,8 km) |
| `morrodafumaca_dec046_2024_libero_fortunato` | ativa (média) | Decreto 046/2024, art. 1º; art. 2º; art. 4º (vigência 12/03/2024) | 24 h | PBT acima de 35 t, bitrem e rodotrem (`cvc`) | Rodovia Líbero Fortunato Bortolatto inteira (6 feições, 1,6 km) | evita: carreta, ter 10h (0,04 km; o utilitário usa 1,36 km), mas com volta longa: 10,0 km contra 1,4 km |
| `morrodafumaca_dec036_2026_bitrem` | ativa (média) | Decreto 036/2026, art. 1º; art. 2º; art. 4º (vigência 11/03/2026; revoga os Decs. 155, 182 e 195/2020) | 24 h | bitrem (modelado como `cvc`: cobre também rodotrem, mais amplo que o ato) | Ruas José Cechinel, Vanteiro Margotti e Urussanga inteiras | evita: bitrem, ter 10h, norte-sul do centro (0 km; o utilitário usa 0,71 km; 5,2 km contra 2,7 km) |
| `morrodafumaca_dec155_2020_urussanga` | revogada | Decreto 155/2020 (+182, 195/2020); revogado pelo Decreto 036/2026, art. 4º (10/03/2026) | - | PBT acima de 35 t e bitrem | vazia (registro histórico) | - |
| `morrodafumaca_dec180_2017` | revogada | Decreto 180/2017; revogado pelo Decreto 035/2018, art. 4º (13/03/2018) | - | PBT acima de 7,7 t | vazia (registro histórico) | - |
| `morrodafumaca_dec053_2012_cechinel` | desativada (baixa) | Decreto 053/2012, art. 1º | 24 h | PBT acima de 8 t | vazia | superado pelos Decs. 180/2017 e 035/2018 na mesma via |
| `morrodafumaca_dec097_2026_vias_centrais` | desativada (baixa) | Decreto 097/2026, art. 1º, I a VIII; arts. 2º, 4º, 5º, 6º | 24 h | combinações, carretas, bitrem, articulados, altura acima de 3 m e/ou PBT acima de 15 t | vazia | omissão da pesquisa acrescentada pelo verificador; vias delimitadas por bairro, "mão única", "Parque Linear" e "supermercado Giassi", sem perímetro nem pontas por transversais |

Interpretações herdadas da verificação: "comprimento máximo de 14 m" lido como proibição acima de 14 m (decretos
115/2018 e 195/2018). Pendências: o Decreto 142/2019 não foi achado; pode haver decreto não captado pela busca por
termos; o Decreto 097/2026 precisa de mapa para virar regra ativa; a Rua João de Rocchi (ver acima); o ato diz que o
Decreto 035/2018 admite "outras vias identificadas por sinalização" (ignorado).

## Timbé do Sul (4218103)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `timbedosul_tbs010_tbs379_15t` | ativa (média) | Decreto 23/2022, art. 1º, I e II; art. 2º (exceções, inclusive IV escoamento da produção agrícola de imóveis nas rodovias); art. 4º (vigência 28/02/2022) | 24 h | PBT acima de 15 t | ways do OSM com `ref=TBS-010` (da junção com a TBS-126 em Amola Faca à divisa com Turvo, ~7,0 km) e `ref=TBS-379` (~2,4 km), sem `name`; curadas à mão a partir do PBF (7 feições) | evita: carreta, ter 10h, noroeste ao leste do município (0 km; o utilitário usa 7,0 km das duas rodovias; 15,9 km contra 14,1 km) |
| `timbedosul_vias_urbanas_20t` | desativada (baixa) | Lei 2.013/2021, art. 1º; art. 2º (rotas rurais e BR-285) | 24 h | veículo de carga com PBT acima de 20 t | vazia | "vias urbanas" sem lista nem perímetro |

O início da TBS-010 em Amola Faca é aproximado (junção com a TBS-126, "Estrada Nova Vicença - Amola-faca"); o ponto
"Rio do Salto" da TBS-379 não foi localizado: vale a via inteira dentro do município. Na validação no Valhalla o
sentido contrário de um pedaço da TBS-010 foi descartado (não casa com o grafo); o sentido principal fica.

Divergência de OSM registrada pela pesquisa (não alterada): "Rua Pedro Zilli" com `hgv=no` sem ato municipal específico.

## Xaxim (4219705)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `xaxim_area_restrita_veiculos_carga` | desativada (baixa) | Decreto 352/2020, art. 1º e art. 2º, a-k (11 trechos); art. 3º (exceções); art. 6º (carga e descarga em locais sinalizados); art. 7º (livre abaixo de 10 t); art. 11 (vigência 04/08/2020) | 24 h | PBT acima de 10 t | 11 vias pelo nome no OSM (26 feições, em `kind=desativada`): 4 pelas transversais do ato e 7 pelas pontas em lonlat com caminho no Valhalla (mão única ou um só way); Rua Avelino Piana aproximada (a Rua Rui Barbosa não a toca no OSM) | sem teste (desativada) |

Motivo: o verificador rebaixou a confiança para baixa (nenhum artigo do decreto contém verbo proibitivo; o art. 3º remete
a uma "proibição constante do artigo 3º", remissão errada; o mapa do Anexo 1 está fora do texto). Como a camada não
deixa regra de confiança baixa ativa, as 11 vias ficam montadas para reativar se a Prefeitura confirmar o ato. Modelada
como vias (o rascunho a chamava de zona) por falta de perímetro. Divergência de OSM registrada pela pesquisa: 3 ways
`service` com `hgv=no` sem ato municipal.

## Observações gerais

- Rotas conferidas na API real (Valhalla com Sudeste+Sul+CO, caminhão com `departure_at` em 2026-10-13, terça, 10h; todas
  as regras são 24 h, então não há horário "fora da janela"). Em cada caso o utilitário (veículo leve, fora das regras)
  serve de base: usa a via; a carreta/truck/bitrem evita (km na regra abaixo de 0,05 km, o que sobra é o cruzamento
  com a via).
- Nenhum caso "sem alternativa": nos 9 municípios foi possível achar um par origem-destino com desvio real.
- Pendências de dados que dependem dos municípios: mapas do Anexo I de Marilena, mapa do Anexo 1 de Xaxim, mapa do
  Decreto 097/2026 de Morro da Fumaça, nome/numeração oficial das 13 ruas de Goioxim e da Rua Augustinho Tiburski
  (Campo do Tenente), confirmação de que a Rua João de Rocchi de Estação Cocal é municipal.
