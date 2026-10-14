# mun_sudeste — lote IMP14

Sete municípios de SP da 2ª rodada da pesquisa cidade por cidade (`docs/research/cidades_sudeste/res/` e `verif/`, de
14/10/2026), na camada genérica `restricoes_rmsp` (`data/raw/municipios/<ibge>.json`). As regras e as correções vêm do
rascunho e do verificador, e o verificador prevalece. Todos os atos são de 14/10/2026 (`verificado_em`).

Os casos de rota estão em `api/test/fixtures/mun_sudeste/<ibge>.json`, todos conferidos na API (`localhost:3000`), e
passam em `API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"` (19 testes de
rota e kinds dos 7 municípios). Datas: terça 13/10/2026 e sábado 17/10/2026. "km na regra" é o trecho da rota a até 10 m da
via ou, nas zonas, dentro do polígono recuado 20 m, como mede o teste.

## Decisões comuns

- **Cache de vias.** O cache `osm_named_<ibge>.json` destes municípios não existia: foi gerado do PBF local (ways `highway`
  com nome que tocam o limite do IBGE, formato Overpass) e, para a curadoria das rodovias, `osm_hw_<ibge>.json` (todas as
  ways `highway`). Ambos em `data/cache/municipios/` (fora do git).
- **Ids.** Prefixados pelo nome da cidade com sublinhado (`casa_branca_`, `capao_bonito_`, `bernardino_de_campos_`); o rascunho
  usava `casabranca_`, `capaobonito_` e `bernardino_`.
- **Perímetro urbano sem polígono no ato** (Arandu, Cajuru, Capão Bonito): setores censitários urbanos do IBGE 2022 do
  distrito-sede (`CD_SIT` 1/2), sem as rodovias (folga de 40 m), marcado aproximado, confiança média. Scripts em
  `geo/<ibge>_*_curadoria.py`.
- **Município inteiro** (Bernardino de Campos): limite do IBGE sem as rodovias estaduais/federais, recortadas com folga de 40 m
  (o ato municipal não as alcança).
- **Exceção de entrega local.** `excecao_destino_local` em Cajuru (art. 2º, II) e Capão Bonito (parágrafo único, I); por isso os
  casos de rota têm destino fora do município.
- **Ruas de uma way só.** `construir: trechos` com de/ate quebra no `linemerge` (Caraguatatuba); o recorte entre cruzamentos é feito
  no script de curadoria (`construir: manual`). Casa Branca usa `trechos` sem de/ate.
- **Desativadas sem área.** Geometria vazia (não entram no banco nem no `regras` da fixture).

## Arandu (3503109) — fonte `arandu`

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| arandu_cvc_57t_19_80m | ativa (média) | Lei 2.395/2017, art. 1º e art. 5º | 24 h | CVC E (PBT > 57 t OU comprimento > 19,80 m) | zona: setores urbanos do distrito-sede (IBGE 2022) sem SP-245/SPA-003, aproximada, 1,83 km² | evita: rodotrem NO→SE da sede, 29,75 km e 0 km na zona (a carreta, fora do alvo, faz 4,26 km e 0,47 km na zona); SO→NE, 36,61 km e 0 km (carreta: 5,25 km e 2,20 km) |
| arandu_canavieiros | desativada | Lei 2.395/2017, art. 1º | 24 h | caminhão canavieiro | vazia | tipo de carga que o perfil do veículo não expressa |

Pendência: as "estradas municipais pavimentadas" do art. 1º não são nomeadas e não entram na zona. Só o rodotrem (74 t, 30 m) é
alvo dos presets; o bitrem (57 t, 19,80 m) não passa dos limiares.

## Bernardino de Campos (3506300) — fonte `bernardino-de-campos`

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| bernardino_de_campos_veiculos_pesados_57t | ativa (média) | Lei 1.694/2011, arts. 1º, 2º e 7º | 24 h | PBTC > 57 t, > 7 eixos ou > 22 m; exceto coletivos | zona: município inteiro sem SP-270/SP-303 (3 partes, 271 vértices) | evita: oeste→leste fora do município, rodotrem 67,20 km e 0 km na zona (carreta: 25,61 km e 11,6 km). Passagem pelas rodovias livres: rodotrem e carreta fazem o mesmo trajeto de 30,94 km |

Pendência: decreto regulamentador (multas) não localizado. Os limiares estão acima do limite do CTB sem AET: só afeta CVC com AET.

## Cajuru (3509403) — fonte `cajuru`

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| cajuru_pesados_perimetro_urbano | ativa (média) | Lei 1.610/2007, arts. 1º, 2º (I-III e §2º) e 4º | 24 h | capacidade > 4 t, reboques e semirreboques; entrega no município isenta | zona: setores urbanos do distrito-sede sem rodovias/travessias, aproximada, 6,42 km² | evita: carreta NO→sul fora do município, 38,88 km e 0 km (utilitário 33,63 km e 1,81 km); truck N→S 36,68 km e 0 km (utilitário 35,14 km e 1,42 km) |
| cajuru_ruas_centrais_praca | desativada | Lei 1.610/2007, art. 2º, §1º | 24 h | idem, inclusive os excetuados | vazia | sem geometria confiável |

Pendência: identificar a Praça Municipal (nenhuma praça com esse nome no OSM; há Praça São Bento, dos Três Reis, do Hospital). A
exceção I (placa de Cajuru) não é modelável.

## Cananéia (3509908) — fonte `cananeia`

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| cananeia_via_hotel_marazul | ativa (média) | Lei 1.680/2004, arts. 1º e 3º | 24 h | todo caminhão | via aproximada: Av. Luiz Wilson de Barbosa (duas pistas) a até 70 m do Hotel Marazul (way 1419724233 do OSM), 277 m | evita: toco 0,87 km e 0 km (utilitário 0,72 km e 0,15 km); truck sentido inverso 1,19 km e 0,03 km |

Pendência: o ato não nomeia a via; a avenida da orla foi escolhida por proximidade ao hotel no OSM. Confirmar com a Prefeitura. Ato
promulgado pela Câmara após veto (possível questão de iniciativa, sem registro de revogação).

## Capão Bonito (3510203) — fonte `capao-bonito`

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| capao_bonito_zona_urbana_lei3661 | ativa (média) | Lei 3.661/2012, art. 1º e parágrafo único I-IV, arts. 2º, 4º e 5º | 24 h | payload_t > 7 t; entrega no município isenta | zona: setores urbanos do distrito-sede (IBGE 2022), sem rodovias (SP-250/BR-373, SP-258, SP-127) e sem as 12 vias de acesso do parágrafo único (carve-out de 10 m), aproximada, 6 partes, 14,9 km² | evita: truck do oeste a destino fora do município, 77,50 km e 0 km (utilitário 69,84 km e 1,01 km); toco 73,62 km e 0 km (utilitário 69,03 km e 1,01 km) |
| capao_bonito_carga_descarga_central_lei3792 | desativada | Lei 3.792/2013 (só notícia) | seg–sex 10h–19h, sáb até 15h (notícia) | payload_t > 5 t | vazia | texto e gráfico do perímetro não achados |

A Av. Elias Jorge Daniel se chama "Avenida Jorge daniel" no OSM; a Av. Lucas Nogueira Garcês do ato, "Garcez". Passagem pela
SP-250/BR-373 conferida: truck e utilitário fazem o mesmo trajeto (79,21 km). Pendência: confirmar a vigência na base da Câmara.

## Caraguatatuba (3510500) — fonte `caraguatatuba`

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| caraguatatuba_centro_caminhoes_1000kg | ativa (média) | Lei 1.643/2009, art. 1º a-e, §§1º e 2º | seg–sex 8h–18h; sáb–dom 8h–24h | payload_t > 1 t | via: 5 ruas centrais recortadas entre os cruzamentos (OSM, 2.185 m); `geo/3510500_vias_curadoria.py` | evita: carreta, ter 10h 1,88 km e 0,02 km; ter 22h usa a Av. Frei Pacífico Wagner (1,70 km e 0,36 km) |
| caraguatatuba_rio_do_ouro_tamoios | desativada | Lei 1.659/2009, art. 1º | sem horário | eixos > 2 | vazia | via de saída não indicada no ato |

Pendências: temporada de verão (15/dez à terça de carnaval, até 24h) não modelada; exceção de carga e descarga (8h–10h e 18h–20h)
só em texto; horário "8:00 e 18:00" lido como 8h–18h. No OSM a Av. Frei Pacífico Wagner e a R. Eng. João Fonseca (trecho primário)
são a travessia da SP-055/BR-101; a regra segue o ato municipal. Via de saída do Rio do Ouro a localizar.

## Casa Branca (3510807) — fonte `casa-branca`

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| casa_branca_rua_cel_jose_julio | ativa (média) | Lei 3.511/2018, art. 1º e parágrafo único, arts. 2º e 3º | seg–sex 7h–18h | todo caminhão | via: Rua Coronel José Julio (OSM, way 403082221, mão única, 961 m), aproximada | evita: carreta ter 10h 2,15 km e 0,02 km, ter 20h usa a rua (1,69 km e 0,98 km); toco ter 10h 1,55 km e 0,02 km, sáb 10h usa a rua (1,40 km e 0,98 km) |
| casa_branca_distritos_venda_lagoa_branca | desativada | Leis 3.124/2012, 3.136/2012 e 3.606/2019, art. 1º | — | "caminhões pesados" | vazia | alvo indefinido e perímetro dos distritos sem delimitação (rebaixada pelo verificador) |

No OSM a rua se chama "Rua Coronel José Julio" (sem acento). A regra vale no sentido de desenho (mão única); decreto
regulamentador não localizado.
