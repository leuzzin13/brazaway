# mun_sudeste — lote IMP15

Sete municípios de SP da 2ª rodada da pesquisa cidade por cidade (`docs/research/cidades_sudeste/res/` e `verif/`, de
14/10/2026), na camada genérica `restricoes_rmsp` (`data/raw/municipios/<ibge>.json`). As regras e as correções vêm do
rascunho e do verificador, e o verificador prevalece (todos os vereditos foram "confirmado"). Os atos estão em
`docs/research/cidades_sudeste/atos/<ibge>/`.

Casos de rota em `api/test/fixtures/mun_sudeste/<ibge>.json`, todos conferidos na API (`localhost:3000`). Passam com
`API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"` (15 testes de rota e de kinds
dos 7 municípios; os 148 testes de "carga e registro" também passam). Datas: terça, 13/10/2026, e sábado, 17/10/2026.
"km na regra" é o trecho da rota a até 10 m da via, ou dentro do polígono recuado 20 m (zona), como mede o teste.

## Decisões comuns

- **Cache do OSM.** O cache `osm_named_<ibge>.json` não existia para estes municípios e foi gerado do PBF local com
  `data/raw/municipios/curadoria/osm_pbf_cache_sudeste.py`. A malha do IBGE foi baixada para
  `data/cache/municipios/ibge_malha_<ibge>.geojson`. O Overpass não foi usado.
- **Perímetro urbano sem polígono no ato** (Pontal, São Simão, Águas de Santa Bárbara). Setores censitários urbanos do
  IBGE 2022 (`CD_SIT` 1 e 2) do distrito-sede, menos a travessia das rodovias (vias com `ref` de rodovia, trunk e primary
  sem ref, ligações, folga de 40 m), no mesmo critério de Arcos e Santa Branca. O script único é
  `data/raw/municipios/geo/imp15_perimetro_urbano_curadoria.py <ibge> <setores de SP> <osm_hw.json>`. Zonas aproximadas,
  confiança média, licença IBGE + ODbL. Cada zona tem 2 a 4 partes e menos de 1.000 vértices.
- **Ids.** O rascunho usava `saosimao_` e `aguas_santa_barbara_`; os ids ficaram `sao_simao_` e
  `aguas_de_santa_barbara_`, como o nome da cidade.
- **Desativadas.** As sem via, bairro ou área determinável entram com `FeatureCollection` vazia (não vão ao banco nem às
  `regras` da fixture) e `status_motivo` "sem geometria confiável" quando é o caso.
- **Import** isolado: `municipios:<ibge>` (sem `MUNICIPIOS_DIR`: o validador de todos os arquivos passou).
- **Feriado em dia útil.** O Dec. 9.178 de Ilhabela proíbe também os feriados em dia útil; a camada só tem
  `feriados: aplica` (a janela vale também em feriado), não "feriado vira dia proibido". Ver Ilhabela.

## 3520400 Ilhabela — `ilhabela`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| ilhabela_circulacao_fim_de_semana_dec9178 | ativa (alta) | Dec. 9.178/2022, art. 3º (red. Dec. 9.208/2022), arts. 4º, 5º, 9º | sáb e dom, 24 h (feriados: aplica) | tipo semirreboque, caminhão + reboque, CVC ou mais de 2 eixos; toco e VUC fora (art. 4º) | zona: limite municipal do IBGE simplificado a ~50 m | nenhum de desvio (ver abaixo); aviso `rmsp_destino_na_zona` conferido |
| ilhabela_entrada_dec9178 | desativada | Dec. 9.178/2022, art. 1º | sex 16h–24h, sáb 8h–16h, dom 8h–14h | todo caminhão | vazia | — |
| ilhabela_saida_dec9178 | desativada | Dec. 9.178/2022, art. 2º | sáb 16h–24h, dom 10h–24h | todo caminhão | vazia | — |
| ilhabela_estacionamento_dec10188 | desativada | Dec. 10.188/2023, art. 1º e parágrafo único | 24 h | todo caminhão | vazia | — |

Rota real: São Sebastião (-23.817, -45.415) para Ilhabela (-23.779, -45.357), preset `truck` (3 eixos): sábado 10h avisa
`rmsp_destino_na_zona` (destino dentro da zona, não exclui); terça 10h não avisa. A carreta e o bitrem não têm rota
(NO_ROUTE com `blocked_by` vazio, antes de qualquer regra) para Ilhabela: a travessia de balsa aparece no grafo só para
os veículos menores; não é efeito da camada. Como a zona é o município inteiro e a ilha só tem origem e destino dentro
dela, não existe rota de passagem que a regra possa desviar: nenhum caso `evita` ou `sem_alternativa`.

Pendências:
- Feriado em dia útil (art. 3º) não é modelado: a janela é sáb/dom e `feriados: aplica` não cria dia proibido.
- Entrada e saída (arts. 1º e 2º) são direcionais e a camada não modela o sentido da travessia; a Prefeitura deveria
  confirmar se o art. 1º atinge também toco e VUC (o art. 4º excetua só o art. 3º).
- O regime de embarque da balsa (Semil/DH) é estadual e não entra. Overpass fora do ar: o OSM de Ilhabela (12 ways com
  maxweight) não foi cruzado com os decretos.

## 3524600 Jacupiranga — `jacupiranga`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| jacupiranga_centro_antigo_dec650 | ativa (média) | Dec. 650/1998, arts. 1º, 4º, 5º | 24 h, todos os dias | todo caminhão; exceção de carga e descarga para imóveis das ruas (art. 4º) | 7 linhas, 789 m, 6 das 8 ruas, aproximado | evita: truck, (-24,689, -48,001) para (-24,6919, -47,9975), 0,60 km e 0,02 km na regra; um veículo leve de 3 t faz 0,52 km e usa 0,17 km |
| jacupiranga_av_tancredo_neves_dec641 | desativada (média) | Dec. 641/1998, arts. 1º e 3º | 24 h | mais de 2 eixos ou articulado | vazia | — |
| jacupiranga_jd_botujuru_dec673 | desativada (média) | Dec. 673/1999, art. 1º e § único | 24 h | articulado, mais de 2 eixos ou PBT acima de 10 t | vazia | — |
| jacupiranga_lei1035_perimetro_urbano | desativada (baixa) | Lei 1.035/2011, arts. 1º e 4º | sem janela | todo caminhão | vazia | — |

Pendências:
- Dec. 650: a Rua Francisco Freitas Coutinho (item 2) e a Praça Tenente Coronel Mesquita (item 3) não existem no OSM; a
  "Rua Gago Coutinho" não foi tomada pela primeira. A Rua da Conceição foi casada com a "Rua Nossa Senhora da Conceição"
  (mesma quadra), a Rua Coronel Jeremias Junior com "Rua Jeremias Junior", a Ladeira Corifeu com "LD Corifeu de Azevedo
  Marques" e a Ladeira Capitão Jorge José de Lima com "Rua Capitão Jorge José de Lima"; as ruas foram aplicadas
  inteiras (a Rua Sete de Setembro e as pontas na José Bonifácio não coincidem com nós do OSM). Todos os trechos são
  aproximados. Com ruas tão curtas (45 a 250 m), o cruzamento já soma 20 a 90 m na medição de "km na regra": só um caso
  com 0,02 km é "evita" confiável.
- Av. Tancredo Neves e Jardim Botujuru não existem no OSM de Jacupiranga (só há a Avenida Tancredo Carravieri, nome
  diferente). Reativar com a localização pelo mapa da Prefeitura.
- Sem nenhuma etiqueta de caminhão no OSM (ausência, não contradição). A base da Câmara não foi acessível: ato de 1998
  sem alteração cadastrada no portal.

## 3532405 Nazaré Paulista — `nazare-paulista`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| nazare_paulista_rua_joao_de_passos_caminhoes | ativa (média) | Lei 1.611/2021, art. 2º e parágrafo único, art. 4º (exceções), art. 9º | 24 h, todos os dias | PBT acima de 7,99 t ou comprimento acima de 7,2 m ou semirreboque/reboque/CVC | 3 linhas, 633 m (ways 212059156 e 1008869145), os dois sentidos, aproximado | evita: carreta, (-23,184, -46,397) para (-23,173, -46,3965), 5,96 km e 0 km na via; o veículo leve de 3 t faz 2,68 km e usa 0,58 km. sem_alternativa: carreta, (-23,176, -46,395) para (-23,1785, -46,3985), 0,71 km, aviso `rmsp_via_restrita_na_rota` |
| nazare_paulista_lei_407_97_pbt_9t | desativada (baixa) | Lei 407/1997, art. 1º e parágrafo único, art. 2º | 24 h | PBT acima de 9 t | vazia | — |
| nazare_paulista_lei_744_08_estrada_tunel_aguas_claras | desativada (média) | Lei 744/2008, arts. 1º e 2º | 24 h | mais de 3 eixos | vazia | — |

Pendências:
- A proibição do ato é só no sentido Rotatória Principal -> Centro; a camada de vias não modela sentido e a regra vale
  nos dois sentidos (conservador).
- Estrada Vicinal Túnel das Águas Claras (Lei 744/08) não foi localizada no OSM; "Estrada do Mascate Grande" e "Estrada
  Mascate" não foram tomadas por ela.
- Lei 407/97 (PBT acima de 9 t em todas as vias pavimentadas) desativada: sem lista de vias, nunca regulamentada, em
  tensão com a Lei 1.611/2021; decisão do Arthur.
- OSM: a SP-036 (Rodovia Juvenal Ponciano de Camargo) tem `hgv=no` em 4 ways (31589546, 78182526, 185299329, 212059150),
  ao contrário do art. 3º da Lei 1.611/2021, que manda os caminhões pesados entrarem por ela. Não corrigi a tag; é
  caso para `data/osm-overrides/overrides.json` (pendente, só com prova e decisão do Arthur). Isso pode contribuir para o
  `large_detour` das rotas de carreta que cruzam a cidade.
  Decisão (14/10/2026): **sem override**. As 4 ways são o trecho sul da SP-036 (Nazaré → Mairiporã/Guarulhos, ~21 km,
  `smoothness=very_bad`), rodovia estadual fora da competência municipal. O trecho norte, que liga a cidade à Dom Pedro I
  (SP-065), não tem `hgv=no`, e por ele o caminhão chega à rotatória da Rodoviária que o art. 3º manda usar: o OSM não
  contradiz a lei. Liberar a serra só com ato do DER-SP.

## 3537107 Pedreira — `pedreira`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| pedreira_area_central_caminhoes | ativa (média) | Lei 2.286/2002, art. 1º, §§ 1º e 2º, art. 3º | seg–sex, 24 h (feriados: aplica); sáb e dom livres | todo caminhão; carga e descarga 6h–10h e 16h–20h permitida (§ 2º), não modelada | 15 linhas, 2.197 m, 9 das 10 localidades, no OSM | evita: truck, (-22,738, -46,906) para (-22,748, -46,900), terça 10h: 5,1 km e 0 km nas vias; sábado 10h (fora): 0,52 km nelas |

Pendências:
- A Rua Professor João Alvarenga (item 5) não existe no OSM e fica sem a proibição na rota.
- Rua XV de Novembro, "do nº 361 até o final": o nº 361 não é ponto do OSM; foi posicionado por interpolação entre os
  nºs 347 e 303 (lon -46,9060, lat -22,7408) e o trecho vai até a ponta leste da rua (aproximado).
- A Rua Luiz Leite entra inteira (uma way só, que já liga a Rua Cezira de Queiroz à Rua Antônio Pedro).
- Algumas rotas curtas ainda tocam 0,06 km da XV de Novembro (pontas a oeste do centro), por falta de alternativa.
- A exceção de carga e descarga (§ 2º) não é modelada; leis de 2022 em diante não puderam ser consultadas (confiança média).

## 3540200 Pontal — `pontal`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| pontal_lei2031_1999_caminhoes_ruas_anel_viario | ativa (média) | Lei 2.031/1999, art. 1º e parágrafo único, arts. 2º e 3º | 24 h, todos os dias | todo caminhão; carga, descarga, conserto ou abastecimento no perímetro urbano: entrega local isenta | zona: setores urbanos do IBGE 2022 (63 + 4 setores), sem o Anel Viário Liliana Tenuto Rossi e as rodovias, aproximada, 6,3 km² | evita: carreta, (-21,03, -47,90) para (-20,90, -48,04), fora do município, 38,0 km e 0 km na zona; o veículo leve de 3 t faz 37,9 km e atravessa 1,13 km da zona |

Pendências:
- O ato não delimita o perímetro urbano: zona aproximada (confiança média). Texto "caminhões transportando cargas ou
  ligados a carretas, mesmo vazios": o perfil não distingue carga, o alvo é caminhão em geral.
- Residentes (pernoite defronte à residência) não são modelados; sinalização atual não verificada.
- Não cruzei hgv/maxweight do OSM de Pontal (Overpass fora); só o Anel Viário foi confirmado como primary.

## 3550902 São Simão — `sao-simao`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| sao_simao_lei2825_2025_5eixos | ativa (média) | Lei 2.825/2025, art. 1º, §§ 1º a 3º, arts. 2º a 4º | 24 h, todos os dias | mais de 4 eixos (5 eixos ou mais); destino no município e residentes isentos (art. 2º) | zona: setores urbanos do IBGE 2022 (24 setores), sem a SP-253 e as ligações, aproximada, 5,4 km² | evita: carreta, (-21,62, -47,60) para (-21,30, -47,56), 58,4 km e 0 km na zona; o toco faz 44,6 km e usa 1,03 km. Passagem leste-oeste: carreta, (-21,447, -47,883) para (-21,4905, -47,393), 66,0 km e 0 km na zona, o toco faz 60,2 km (2,26 km na zona), mesma duração (75 min) |

Pendências:
- O ato não lista ruas: zona aproximada pelos setores urbanos. A SP-253, que é a alternativa do § 1º, fica fora.
- Decreto regulamentador (art. 3º), sinalização (§ 2º) e conclusão do dispositivo "Padre Gilberto Maria Defina" na
  Anhanguera não confirmados. Como a exceção de destino local é ampla, a regra só desvia o tráfego de passagem.

## 3500550 Águas de Santa Bárbara — `aguas-de-santa-barbara`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| aguas_de_santa_barbara_extrapesados_perimetro_urbano | ativa (média) | Lei 1.842/2020, art. 1º, art. 3º (definição), art. 5º (vigor) | 24 h, todos os dias | CVC ou PBT de 18 t ou mais | zona: setores urbanos do IBGE 2022 (18 setores), sem a SP-261 (Av. Ataliba Leonel etc.), aproximada, 6,9 km², 4 partes | evita: carreta, (-22,95, -49,30) para (-22,85, -49,12), 37,1 km (62 min) e 0 km na zona; o toco (abaixo de 18 t) faz 30,8 km (47 min) e usa 0,56 km da zona |
| aguas_de_santa_barbara_estacionamento_extrapesados | desativada (média) | Lei 1.842/2020, art. 2º e §§ 1º e 2º | — | extrapesados | vazia | — |

Pendências:
- Perímetro urbano sem delimitação no ato (as LCs 186/2023 e 192/2023 e as Leis 1.624/2013 e 1.684/2015 o ampliaram):
  zona aproximada. Art. 3º ambíguo (capacidade de carga x PBT): adotado PBT de 18 t ou mais.
- Rotas norte-sul pela cidade (acesso a Iaras por vicinal secundária sem ref) não têm rodovia alternativa: ex. (-22,95,
  -49,30) para (-22,78, -49,15), a carreta faz 59,2 km com `large_detour` e o toco 33,6 km pela cidade. É consequência
  do ato (vias urbanas), não de erro de geometria; as rotas leste-oeste pela SP-261 não têm desvio (carreta de
  (-22,86, -49,40) para (-22,85, -49,12): 44,4 km, 0 km na zona).
- OSM: a way 200663583 (Rua Marechal Deodoro da Fonseca) tem `hgv=no`, compatível com a lei; ela não gera caso "evita"
  (o roteador já a evitaria sozinho). O decreto regulamentador (art. 4º) não foi localizado.

## Bugs ou limitações de código observados (não corrigidos)

- A camada não tem como marcar "feriado vira dia proibido" (Ilhabela, art. 3º).
- `linemerge` quebra no `de`/`ate` sobre uma via de uma way só (Rua Luiz Leite, Pedreira); contornado aplicando a rua
  inteira.
- Carreta e bitrem não têm rota até Ilhabela (NO_ROUTE sem `blocked_by`), enquanto truck e toco têm. Causa (14/10/2026):
  as rampas da balsa nas duas pontas (Av. Antônio Januário do Nascimento em São Sebastião e Av. Princesa Isabel em
  Ilhabela) têm `maxweight=40t` no OSM; com 38 t a carreta passa. Mantido (limite plausível da travessia). A API agora
  responde `limited_by: ["peso"]` e explica na mensagem (teste `api/test/04-no-route-limit.test.ts`).
