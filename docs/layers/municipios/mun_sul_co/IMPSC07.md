# IMPSC07 — MS, MT, GO e RS: Aparecida do Taboado, Eldorado, São Gabriel do Oeste, Sidrolândia, Lucas do Rio Verde, Santa Helena de Goiás e Sant'Ana do Livramento

Lote da pesquisa profunda do Sul/Centro-Oeste (`docs/research/cidades_sul_co/res|verif/<ibge>.json`, verificação de 2026-10-18) na camada
genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)). Um arquivo por município em
`data/raw/municipios/<ibge>.json`, geometria em `data/raw/municipios/geo/<ibge>_*.geojson`, seed
`db/seed/layers/restricoes_rmsp__<fonte_id>.sql`, casos de rota em `api/test/fixtures/mun_sul_co/<ibge>.json` (teste:
`api/test/layers/mun_sul_co.test.ts`, 14 testes do lote passando).

| IBGE | Município | fonte_id | Ativas | Desativadas | Casos de rota |
|---|---|---|---|---|---|
| 5001003 | Aparecida do Taboado/MS | `aparecida-do-taboado` | 1 (23 vias) | 1 | 2 evita |
| 5003751 | Eldorado/MS | `eldorado` | 1 | 0 | 1 evita |
| 5007695 | São Gabriel do Oeste/MS | `sao-gabriel-do-oeste` | 1 (3 vias) | 0 | 1 evita |
| 5007901 | Sidrolândia/MS | `sidrolandia` | 1 | 0 | 1 evita (com horário fora da janela) |
| 5105259 | Lucas do Rio Verde/MT | `lucas-do-rio-verde` | 1 | 0 | 1 evita |
| 5219308 | Santa Helena de Goiás/GO | `santa-helena-de-goias` | 0 | 1 | — |
| 4317103 | Sant'Ana do Livramento/RS | `santana-do-livramento` | 1 | 1 | 1 evita |

Nenhum município do lote define VUC (`vuc: null`): o VUC é tratado como caminhão. Em todos os casos o controle (veículo não atingido ou
fora da janela) passa pela via/zona e o veículo atingido a evita.

## Geometria (como foi feita, sem Overpass)

- Cache de vias com nome (`data/cache/municipios/osm_named_<ibge>.json`) gerado do PBF com `osm_pbf_cache_regioes.py` (uma passada para os 7 municípios).
- Vias por nome (`construir: "trechos"`), arquivo `<ibge>_vias.geojson`, derivadas do OSM (ODbL, dito em `fonte.licenca`). O `linemerge` do importador
  falha em trecho `de`/`ate` sobre via de um way só; o arquivo foi gerado chamando as próprias funções do importador (`street_rules_fc`) com um
  contorno desse caso, no mesmo formato, e o importador o leu normalmente. Pontas problemáticas (mão única desencontrada, rua de um way só) usam
  `caminho: "valhalla"` com `{"lonlat"}` nos cruzamentos.
- Sant'Ana do Livramento: polígono manual pelos cruzamentos das artérias do ato no OSM.
- Santa Helena de Goiás: sem geometria honesta; só o limite do município (IBGE) como registro da regra desativada.

## 5001003 Aparecida do Taboado/MS (`aparecida-do-taboado`)

LC 54/2014 (Código de Posturas), URL do diário ASSOMASUL `AB3ED261`. Vigência não confirmada em portal oficial (confiança média).

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `aparecida_taboado_centro_18t_440` | ativa (média) | LC 54/2014, art. 193 §2º e Anexo I, art. 195 IV, arts. 196 e 199 (exceções) | 24 h, todos os dias (feriado aplica) | carga útil acima de 18 t (`payload_t`) ou altura acima de 4,40 m | via: as 23 vias do Anexo I (49 feições, 1 pista descartada pelo Valhalla na R. José Bernardes da Silva, sentido contrário de mão única) | carreta 5 eixos com 27 t, terça 10h, do leste ao noroeste: 0,04 km nas vias (3,3 km) contra 1,3 km do toco com carga leve (2,6 km); toco de 4,60 m de altura também desvia |
| `aparecida_taboado_centro_acima5t_horarios` | desativada (baixa) | LC 54/2014, art. 195 I | janelas inferidas | `payload_t` acima de 5 t | vazia (seriam as mesmas 23 vias) | — |

Pendências: o Anexo I usa grafias que não batem com o OSM (tratadas com variantes: Eduardo Jesuíno Thiago = R. Eduardo Jesuino Tiago, Maximiano = Maximino, Sebastião Marinho Goulart = Sebastião M Goulard etc.). A R. Rosália D. Queiroz e a R. Pedro J. de Queiroz não constam no OSM: a Av. Cuiabá vai até a ponta norte (aproximado), a R. da Liberdade até o fim da cadeia contínua (~0,9 km, aproximado), a R. Manoel de Souza e a R. Abádio Rodrigues de Almeida até o extremo da rua (aproximado). A Duque de Caxias é de mão única (Estudantes para Laudelino), só nesse sentido.

## 5003751 Eldorado/MS (`eldorado`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `eldorado_rua_iguatemi_pesados` | ativa (média) | Lei 1.062/2015, art. 1º §1º (ASSOMASUL `E1E1CA0B`) | 24 h | caminhão (PBT acima de 3,5 t; "pesados" não é definido) | via: Rua Iguatemi entre a R. Venceslau da Silva (Wenceslau Honório da Silva no ato) e a Av. Brasil, ~135 m (caminho pela malha) | truck 23 t pela Rua Iguatemi: evita o quarteirão (0,82 km), o utilitário passa (0,43 km, 0,16 km nele) |

Pendências: o OSM não marca a Rua Iguatemi como mão única (a lei fala em mão única). A Lei 1.188/2018 (estacionamento) fica fora do escopo.

## 5007695 São Gabriel do Oeste/MS (`sao-gabriel-do-oeste`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `sgo_centro_grande_porte` | ativa (média) | LC 185/2017, art. 42 (ASSOMASUL `8CDC772B`) | 24 h | caminhão ("grande porte" não definido), exceto carga e descarga com destino local | via: Av. Getúlio Vargas (extremo leste até a Av. São Francisco, as duas pistas), Av. Mato Grosso do Sul inteira (aproximado), R. Paraná entre as R. Raimundo do Prado e Martimiano Alves Dias | truck 23 t do centro a Rio Verde de MT (destino fora do município): 0 km nas vias; o utilitário usa 0,52 km |

Pendências: "início da via" da Av. Getúlio Vargas não diz qual extremo (adotado o leste, entrada pela rodovia; aproximado); a Av. Mato Grosso do Sul não tem trecho no ato; o entroncamento da R. Paraná (mãos únicas) deixa um vão de ~65 m sem linha. Como a exceção de carga e descarga depende do destino no município, o caso de rota usa destino fora dele.

## 5007901 Sidrolândia/MS (`sidrolandia`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `sidrolandia_antero_lemes_18_22` | ativa (média) | Lei 1.881/2017, art. 1º e art. 3º parágrafo único (ASSOMASUL `E666A2DD`) | todos os dias, 18h às 22h | caminhão | via: Av. Antero Lemes da Silva inteira no OSM (o ato não delimita trecho; aproximado) | carreta terça 19h: 0,04 km na avenida (2,45 km); às 10h usa a avenida (0,64 km nela, 2,14 km) |

Pendências: regulamento e sinalização (art. 5º) não localizados.

## 5105259 Lucas do Rio Verde/MT (`lucas-do-rio-verde`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `lucasdorioverde_av_acacias_mais_3_eixos` | ativa (média) | Decreto 2.656/2014, art. 1º (AMM-MT `482D8AD7`) | 24 h | mais de 3 eixos | via: Av. das Acácias inteira no OSM, da rotatória da MT-449 ao extremo sudoeste (aproximado) | carreta 5 eixos: 0 km na avenida (3,0 km); truck 3 eixos usa 2,2 km dela (2,7 km) |

Pendências: o mapa anexo não foi lido e a Linha 5 não toca a Av. das Acácias no OSM (fica a ~1,7 km do extremo sudoeste), por isso o trecho é aproximado; vigência atual não reconfirmada.

## 5219308 Santa Helena de Goiás/GO (`santa-helena-de-goias`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `santahelena_alameda_hildebrando_12t` | desativada (alta) | Lei 3.504/2026, arts. 1º a 5º (FGM `F050206F`) | 24 h | PBT acima de 12 t, exceto carga e descarga no trecho | só o limite do município como registro | — |

Pendência: a Alameda Hildebrando Domingues da Silva, o trevo do Anel Viário/Plataforma Multimodal e a GO-162 não existem no OSM (nem por nome, `ref` ou ponto, na malha do município). As rodovias estaduais GO-164, GO-210 e GO-407 são competência do DER e não foram assumidas como a alameda; a regra fica desativada ("sem geometria confiável") até a via e os dois trevos serem localizados.

## 4317103 Sant'Ana do Livramento/RS (`santana-do-livramento`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `santanalivramento_lei965_1972_perimetro_central` | ativa (média) | Lei 965/1972, art. 1º (red. Lei 2.757/1990), §§ 1º-2º e art. 3º | 24 h | PBT acima de 8 t ("tara e carga" aproximado como PBT) | zona manual de ~1,1 km², cruzamentos das artérias do art. 1º no OSM (aproximado) | truck 23 t de leste a oeste, origem e destino fora do perímetro: 0 km dentro (3,5 km); o utilitário atravessa (0,75 km dentro, 2,3 km). Rotas de passagem leste-oeste e norte-sul não usam o perímetro (sem volta) |
| `santanalivramento_lei1365_1978_estacionamento` | desativada (média) | Lei 1.365/1978, arts. 1º e 3º | — | caminhão | vazia | — |

Pendências: leis antigas (vigência presumida por ausência de revogação na SAPL); decreto de horário/trajeto (art. 1º §2º, art. 3º) não localizado; exceções de transporte coletivo e combustível apenas em texto.
