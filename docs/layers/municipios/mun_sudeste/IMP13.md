# mun_sudeste — lote IMP13

Seis municípios da 2ª rodada da pesquisa (`docs/research/cidades_sudeste/res/` e `verif/`, 14/10/2026), na camada genérica
`restricoes_rmsp` (`data/raw/municipios/<ibge>.json`). O verificador prevalece sobre o rascunho. Quatro são novos
(Cordislândia, Machado, Ouro Branco, Tanguá) e dois já estavam no app (Serro, Piranga) e foram atualizados.

Geometria do OSM (ODbL) a partir do PBF local: os caches `osm_named_<ibge>.json` dos quatro novos não existiam e foram
gerados com `data/raw/municipios/curadoria/osm_pbf_cache_sudeste.py` (e `osm_hw_<ibge>.json` com `osm_pbf_vias.py`). A
malha do IBGE foi baixada no host. Importação isolada com `MUNICIPIOS_DIR` (só o arquivo do município). Casos de rota
conferidos na API (terça, 13/10/2026) e gravados em `api/test/fixtures/mun_sudeste/<ibge>.json`; passam em
`npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"`. "km na regra" = trecho da rota a até 10 m da via (zona:
dentro do polígono recuado 20 m).

## 3119005 Cordislândia — `cordislandia`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| cordislandia_ruas_12t_carga | ativa (média) | Lei 928/2012, arts. 1º, 3º, 6º | 24 h | carregamento (payload_t) > 12 t | zona aproximada: setores urbanos do IBGE 2022 do distrito-sede menos a BR-267/MGC-267 (Av. Cônego Francisco etc.) com folga de 40 m (`geo/3119005_perimetro_urbano.geojson`, script `..._curadoria.py`) | evita: BR-267 oeste → LMG-878 sul, carreta 8,97 km, 0 km na zona; com capacidade 10 t passa 1,62 km nela |
| cordislandia_ponte_sapucai_10t | desativada | Lei 928/2012, art. 2º | – | > 10 t | vazia | – |

Pendências: publicação oficial e vigência da Lei 928/2012 (PDF sem assinatura do Prefeito); identificar a ponte do art. 2º
(a única restrita no OSM é da BR-267/MGC-267, competência federal/estadual); perímetro urbano legal.

## 3139003 Machado — `machado`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| machado_vias_art2_capacidade_acima_4t | ativa (média) | Lei 2.294/2010 art. 2º e 5º, red. Leis 2.806/2018 e 2.814/2018 | 24 h | capacidade de carga (payload_t) > 4 t | 28 logradouros do art. 2º + Trav. Jacarandá, por nome no OSM (63 feições, sem pendências no GeoJSON); 5 com grafia diferente da lei (Rua em vez de Avenida, Marechal/da Fonseca, do Jacarandá); Sete de Setembro e Quinze de Novembro limitadas à sede por `lonlat` | evita: Rua Aristides Coelho → Rua Mozart da Silva Pinto, carreta 5,39 km e 0 km; com 3 t usa 1,66 km; com 4,0 t também passa |

Pendências: textos de 2018 sem carimbo de sanção; ambiguidade do art. 1º, II (janelas) resolvida como proibição o dia todo.

## 3145901 Ouro Branco — `ouro-branco`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| ouro_branco_centro_historico_3eixos | desativada (média) | Lei 1.973/2013 art. 1º; Lei 2.897/2025 arts. 2º-3º | 24 h | 3+ eixos | só o limite municipal como registro | – |

Pendências: o "Centro Histórico" e o "perímetro de tombamento histórico" não são delimitados em nenhum ato; sem
georreferência honesta (o OSM só tem um nó `place=suburb` "Centro"; os setores do IBGE não nomeiam bairros) a regra fica
desativada, "sem geometria confiável". Ativar com o perímetro (Prefeitura/IEPHA).

## 3305752 Tanguá — `tangua`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| tangua_centro_lotacao_5t_ou_6_5m | ativa (média) | Decreto 29/2021 art. 1º, I e II | seg-sex 7h-20h, sáb 7h-15h | lotação > 5 t ou comprimento > 6,50 m | ruas do perímetro por nome no OSM (Ant. Teixeira de Macedo, Ver. Manoel de Macedo só do extremo oeste ao viaduto, Manoel João Gonçalves, Dezenove de Novembro), `geo/3305752_vias.geojson` | evita: Rua Primeiro de Janeiro → Rua Vinte e Dois, toco, 13,98 km e 0 km às 10h; 2,07 km e 0,60 km às 21h |
| tangua_centro_carretas_cavalos_24h | ativa (média) | Decreto 29/2021 art. 1º, III | 24 h | semirreboque e CVC | idem | evita: mesmo trajeto, carreta às 22h, 13,98 km e 0 km |

Pendências (documentadas, sem solução no OSM): as ruas David Beloniel, Valdomiro Rosa e Augusto da Rocha não existem com
esse nome no OSM, e a "via interior do Viaduto (BR-101, km 274)" não é identificável; as alças sob o viaduto ficam a menos de
15 m da pista da BR-101 e prenderiam a travessia pela rodovia, então ficaram de fora. A Rua Ver. Manoel de Macedo a leste do
viaduto corre colada à BR-101 e também ficou de fora. A rota de passagem pela BR-101 (oeste → leste) sai com 0 km nas vias e
sem volta; no sentido leste → oeste a pista passa por cima de 39 m da Rua Manoel João Gonçalves no viaduto (aviso falso
possível, sem desvio). O PDF numera o último artigo como 10 (arts. 2º a 9º ausentes).

## 3167103 Serro — `serro` (atualizado)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| serro_vias_7t_art2_art4 | ativa (média) | Decreto 4.801/2014, arts. 2º e 4º | 24 h | PBT > 7 t | vias por nome no OSM (31 feições na carga) | evita (caso existente, passa) |
| serro_rodovia_municipal_ser152_7t | desativada | Decreto 4.801/2014, art. 3º | 24 h | PBT > 7 t | candidato não confirmado (way 504793528) | – |
| serro_vias_7t_autorizacao_temporaria | desativada (baixa) | Decreto 4.844/2014, art. 1º | – | PBT > 7 t | registro | – |

Divergência com a instrução do lote ("2 regras ativas"): o rascunho da R2 traz a SER-152 ativa, mas o único traçado possível
é um way sem ref que termina a ~3 km da BR-259 e a ~5 km da MG-010 no OSM, ou seja, não liga as duas rodovias como o art. 3º
descreve. Pela regra do lote (sem geometria honesta = desativada) permaneceu desativada. Para ativar: traçado oficial da SER-152.

## 3150802 Piranga — `piranga` (rebaixada)

As duas regras (`piranga_urbana_5eixos_11_17`, `piranga_urbana_3eixos_22_05`) passaram a `desativada` (confiança baixa), com o
`status_motivo` do verificador (vigência resolutiva "até o desvio" não confirmável e área urbana não delimitada). Polígono
aproximado mantido como registro; reimportado; fixture: kinds `desativada` e sem casos de rota.

## Para o código (não alterado)

- `osm_pbf_cache_sudeste.py` não gerou nada antes deste lote: os caches dos quatro municípios novos não existiam.
- Regra desativada com `FeatureCollection` vazia não entra no banco; a fixture não a lista em `regras`. Zona desativada
  sem polígono honesto precisa de um registro (aqui, o limite municipal) para passar no teste "record_count > 0".
