# mun_sudeste — lote IMP08 (11 municípios de SP)

Cunha, Dobrada, Garça, Getulina, Guareí, Guariba, Ibitinga, Ibiúna, Indaiatuba, Itapeva e Itapevi, na camada genérica
`restricoes_rmsp` (`data/raw/municipios/<ibge>.json`; formato em [`../../restricoes_municipais.md`](../../restricoes_municipais.md)).
As regras vêm de `docs/research/cidades_sudeste/res/<ibge>.json`, com as correções de `verif/<ibge>.json` (verificação de
11/10/2026), que prevalecem.

Resumo: **21 regras ativas** em 11 municípios (8 zonas, 13 vias), **8 desativadas** e **3 revogadas**. Os casos de rota foram
conferidos na API real (`localhost:3000`) e gravados em `api/test/fixtures/mun_sudeste/<ibge>.json`: 20 casos, 19 "evita" e 1
"sem_alternativa". Todos passam em `API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"`
(11/10/2026). Datas usadas: terça 13/10/2026 e sábado 17/10/2026.

## Como a geometria foi feita

- **Vias** (`construir: "trechos"`): os nomes são exatamente os do OSM. Vêm do cache `data/cache/municipios/osm_named_<ibge>.json`
  e, para os nomes que o cache não tem, de um extrato do PBF local (`data/valhalla/sudeste-latest.osm.pbf`). O import gerou
  `geo/<ibge>_vias.geojson` com `pendencias` vazias em todos os municípios. As pontas por numeração predial são aproximadas
  (`aproximado: true`). Quando `de`/`ate` não funcionavam por causa de mão única ou de via com um só way, usei `{"lonlat"}` ou
  `caminho: "valhalla"`.
- **Perímetro urbano sem polígono no ato** (Dobrada, Garça, Guariba, Itapeva e o Distrito de Macucos em Getulina): é a união
  dos setores censitários urbanos do IBGE 2022 (`CD_SIT` 1 e 2) do distrito, sem furos, sem partes com menos de 2 ha e
  simplificada a ~5 m. As rodovias livres foram recortadas com folga de 40 m: entram os ways com `ref` estadual/federal **e**
  nome de rodovia ou via de acesso, mais as rodovias sem ref escolhidas pelo nome. As ruas e avenidas urbanas por onde passa uma
  rodovia estadual (SP-349 em Garça, SPA-312/326 em Dobrada) continuam na zona, porque o ato abrange "todas as vias do perímetro
  urbano". A zona é marcada como aproximada e a confiança fica média. O script de cada município está em
  `data/raw/municipios/geo/<ibge>_*_curadoria.py`. Para rodar: `python3 <script> <shapefile SP_setores_CD2022> data/cache/municipios/osm_named_<ibge>.json`.
- **Áreas centrais descritas por ruas** (Indaiatuba, Itapeva): polígono que segue os eixos do OSM entre os cruzamentos do
  perímetro do ato. Na rota ele é recuado 20 m, o que deixa livres as ruas do contorno.
- **Desativada sem área definida**: `{"geojson": FeatureCollection vazia}`. Fica no arquivo, mas não vai para o banco nem para
  o `regras` da fixture.
- **Import**: rodei `municipios:<ibge>` com `MUNICIPIOS_DIR` apontando só para o arquivo do município. A malha do IBGE já estava
  no cache.
- **Medida dos casos**: "km na regra" é o trecho da rota a até 10 m das linhas da via ou dentro do polígono recuado 20 m, como
  mede o teste. Quando a rota só cruza uma via restrita, conta ~20 m por cruzamento.

---

## 3513603 Cunha (`cunha`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `cunha_ruas_centrais_fds_caminhoes_tratores` | ativa (média) | Lei 728/1995, art. 1º; Lei 730/1995, arts. 3º–5º | sáb e dom 18h–24h, dom e seg 0h–1h; feriados aplica | todo caminhão | `geo/3513603_vias.geojson`: R. Dom Lino inteira (~210 m), R. João Manoel Rodrigues (~140 m em 2 partes), R. Dr. José Maria Amato (~65 m) | evita, toco, sul → norte do centro: sábado 19h, 0 m nas ruas; terça 10h, 0,3 km nelas |
| `cunha_vicinais_bitrem` | **desativada** (média) | Lei 1.979/2025, arts. 1º, 2º, 4º | 24 h | CVC | vazia | — |
| `cunha_vicinais_tonelagem` | desativada (baixa) | Leis 589/1991 (art. 2º) e 611/1991 (art. 1º) | 24 h | caminhão | vazia | — |

Pendências:
- A R. Dr. Casemiro da Rocha (nº 04 ao 51) não está no OSM, nem no cache nem no PBF, e ficou fora da geometria.
- A numeração predial não está no OSM: os trechos são aproximados.
- **Bitrem nas vicinais**: o ato é vigente e foi confirmado, mas ficou desativado sem geometria. Ele não lista as vicinais e,
  no OSM, não dá para separar as municipais das estaduais (DER). Reativar quando houver o cadastro municipal de estradas.
- Em feriado de dia útil a janela não é aplicada, porque o formato só usa as janelas do dia da semana.

## 3514007 Dobrada (`dobrada`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `dobrada_lei1815_2021_perimetro_urbano` | ativa (média) | Lei 1.815/2021, art. 1º, caput e III; art. 2º | 24 h | mais de 2 eixos; exceção de carga e descarga no município (art. 2º, I) | `geo/3514007_perimetro_urbano.geojson`: setores urbanos do IBGE 2022, sem a SP-326 e a Rod. Eugênio Comar | evita: Santa Ernestina → Matão, o truck dá 27,2 km com 0 km na zona; o toco (não atingido) passa 2,5 km nela |
| `dobrada_lei1815_2021_vicinais` | **desativada** (média) | Lei 1.815/2021, art. 1º, I e II | 24 h | mais de 2 eixos | vazia | — |

Pendências:
- **Vicinais**: as rotatórias de referência ("César Franco Júnior" e "acesso ao Bairro Juninho Bernardo") não têm nome no OSM.
  Os candidatos estão na nota da regra. Falta confirmar de onde parte o trecho "sentido Dobrada" e se as estradas são municipais.
  Se as rotatórias forem as das entradas da cidade, o trecho já está dentro da zona.
- Os bairros novos a leste, que os setores de 2022 ainda não cobrem, ficaram fora da zona.
- O decreto regulamentador e as placas não foram confirmados.

## 3516705 Garça (`garca`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `garca_zrc_perimetro_urbano` | ativa (média) | Lei 5.558/2023, art. 39 e §§ 1º–4º | todos os dias 5h–23h | mais de 3 eixos; exceção de destino em Garça (§2º, II) | `geo/3516705_perimetro_urbano.geojson`: setores urbanos do IBGE 2022, sem os ways de rodovia da SP-294 e da SP-349 | evita: SP-349 norte → Gália; às 10h a carreta dá 113 km com 0 km na zona; às 23h30 atravessa (3,0 km na zona) |

Pendências:
- A SP-349 atravessa a cidade por ruas urbanas (Av. Labieno da Costa Machado, R. Cel. Joaquim Piza, Av. Presidente Vargas), que
  ficaram na zona. Com isso o desvio da carreta de passagem fica longo, de 113 km contra 28. Se a travessia urbana for
  estadual, recortar.
- As placas do §4º não foram conferidas. O perímetro é aproximado.

## 3517000 Getulina (`getulina`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `getulina_macucos_canavieiros` | ativa (média) | Lei 2.784/2023, arts. 1º, 2º, 4º | 24 h | caminhão + reboque e CVC (canavieiros) | `geo/3517000_getulina_macucos.geojson`: 2 setores urbanos do distrito de Macucos, 0,4 km² | evita: sul → norte de Macucos, o bitrem dá 35,7 km com 0 km na zona; o truck passa 0,7 km nela |
| `getulina_macucos_lei2064_2008` | revogada | Lei 2.064/2008 (revogada pela Lei 2.784/2023, art. 4º) | — | — | mesmo polígono | — |

Pendências:
- O perfil não tem tipo de carga: "canavieiro" foi aproximado por caminhão + reboque e CVC. O cavalo + semirreboque fica de
  fora e qualquer CVC é atingida.

## 3518503 Guareí (`guarei`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `guarei_lei898_combinacoes` | ativa (média) | Lei 898/2022, art. 1º, caput e §1º | 24 h | caminhão + reboque e CVC | `geo/3518503_vias.geojson`: 9 das 12 vias | sem caso (ver abaixo) |
| `guarei_dec1582_caminhoes` | ativa (média) | Dec. 1.582/2022, art. 1º | 24 h | todo caminhão (salvo carga e descarga) | 9 das 12 vias (com a R. Tiradentes) | sem caso (ver abaixo) |
| `guarei_dec1582_gumercindo_cavalo` | ativa (média) | Dec. 1.582/2022, art. 2º | 24 h | semirreboque, caminhão + reboque e CVC | R. Gumercindo Manoel Pereira Neto | evita: pontas da rua, a carreta dá 13,0 km com 0 m na rua; o truck usa 0,2 km |
| `guarei_dec1679_lazaro_dias` | **desativada** (alta) | Dec. 1.679/2023, art. 1º | 24 h | caminhão + reboque e CVC | vazia | — |

Pendências:
- Praça Antônio Pinto da Silveira, R. Luiz Quirino Vieira, R. Maria Nogueira de Barros, a R. Lázaro Dias da Costa (Floresta II)
  e a Av. Adalberto Rocha não estão no OSM. O Dec. 1.679/2023 ficou desativado só por falta de geometria (ato confirmado).
- Nomes usados do OSM: "Rua Gumercindo Manoel Pereira Neto," (com vírgula), "Rua Lucidoro de Campos Pinheiro" e "Rua Luiz
  Almeida Fonseca". Só a Rua Aristides da Costa Barros entra; a Rodovia (SP-157) fica fora. A Rua São João entra da esquina
  com a R. Aristides para leste.
- **Sem caso para a Lei 898 e o Dec. 1.582**: as ruas restritas formam a malha do centro e a SP-157 atravessa a cidade cruzando
  todas elas. Toda rota conferida cruza de 4 a 7 dessas ruas (~20 m cada, 0,11–0,17 km), acima da tolerância de 50 m do teste,
  embora a rota já evite andar por elas (`avoided` presente).
- Sobreposição entre a lei (que isenta os emplacados em Guareí) e o decreto. A "Vanderléia" não é modelável.

## 3518602 Guariba (`guariba`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `guariba_perimetro_urbano_pesados` | ativa (média) | Lei 3.052/2017, art. 1º e §§ 1º–2º; art. 2º | 24 h | todo caminhão; exceção de entrega no comércio local | `geo/3518602_guariba_perimetro_urbano.geojson`: setores urbanos do IBGE 2022, sem a SPI-328/326, a SP-253 e a SP-326 (2 partes) | evita: sul de Guariba → nordeste, fora do município; o toco dá 26,0 km com 0 km na zona |

Pendências:
- O perímetro é aproximado. A exceção para os emplacados em Guariba só aparece no aviso.

## 3519600 Ibitinga (`ibitinga`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `ibitinga_vias_restricao_carga_8_18` | ativa (média) | LC 298/2025, art. 14, par. único; Anexo VIII | seg–sex 8h–18h | todo caminhão (VUC não definido) | 7 vias do quadrilátero central, 3.122 m no OSM contra 3.131,99 m no anexo | evita: R. Cel. Gereto; às 10h o toco faz 1,7 km com 0 m nas vias; às 19h usa 0,43 km |

Pendências:
- O anexo só dá a extensão de cada via. As pontas foram deduzidas da malha do OSM, porque as extensões batem: as 4 ruas
  leste–oeste vão da Av. Sete de Setembro à Av. Dom Pedro II e as 3 norte–sul da R. Treze de Maio à R. Pereira Landim.
  Conferir no mapa do Anexo VIII.

## 3519709 Ibiúna (`ibiuna`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `ibiuna_verava_lotacao_2eixos` | ativa (média) | Dec. 2.736/2020, arts. 1º–4º, 6º, 7º | 24 h | rígido com até 2 eixos e carga acima de 12 t | Estrada do Verava (IBN-125) inteira, 8 ways (~40 km) | evita: toco com 13 t |
| `ibiuna_verava_lotacao_3eixos` | ativa (média) | idem | 24 h | rígido de 3 eixos com carga acima de 16 t | idem | evita: truck com 17 t |
| `ibiuna_verava_lotacao_4eixos_rigido` | ativa (média) | idem | 24 h | rígido com 4 ou mais eixos e carga acima de 19 t | idem | evita: rígido de 4 eixos com 20 t |
| `ibiuna_verava_lotacao_cavalo_4eixos` | ativa (média) | idem | 24 h | semirreboque com até 4 eixos e carga acima de 23 t | idem | evita: 4 eixos com 24 t |
| `ibiuna_verava_lotacao_cavalo_5eixos` | ativa (média) | idem | 24 h | semirreboque de 5 eixos e carga acima de 25 t | idem | evita: carreta com 26 t |
| `ibiuna_verava_lotacao_cavalo_6eixos` | ativa (média) | idem | 24 h | semirreboque com 6 ou mais eixos e carga acima de 27 t | idem | evita: carreta de 6 eixos com 28 t |
| `ibiuna_verava_pbt16_2017` | revogada | Dec. 2.388/2017 (revogado pelo Dec. 2.736/2020, art. 6º) | — | PBT acima de 16 t | idem | — |
| `ibiuna_centro_expandido_pl113_2025` | desativada (baixa) | PL 113/2025 (não é lei) | — | — | vazia | — |

Todos os casos usam o mesmo par: SP-250 junto ao km 57 → bairros a leste da estrada. O veículo atingido dá 14,8 km com 0,02 km
no cruzamento. Abaixo do limite (toco com 10 t, carreta de 6 eixos com 26 t) a rota usa a estrada: 13,1 km, 5,0 km nela.

Pendências:
- Não dá para modelar o limite de 6 t do caminhão de rodagem simples, nem o Romeu e Julieta, o bitrem e o rodotrem (o ato não
  os lista).
- O way "Estrada Carmo Messias" (também com ref IBN-125) é um ramal e ficou fora.
- O seed tem 2,1 MB: são 6 regras sobre os mesmos ~40 km, e cada regra leva as suas linhas.

## 3520509 Indaiatuba (`indaiatuba`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `indaiatuba_area_central` | ativa (média) | Lei 5.478/2008, art. 1º e par. único; art. 2º | seg–sáb 9h–16h; feriados suspende | todo caminhão | `geo/3520509_area_central.geojson` (0,42 km², pelos eixos do OSM) | evita: sudoeste → nordeste do centro; às 10h, 0 km na zona; às 17h, 0,7 km |
| `indaiatuba_estanislau_boldrini_picos` | ativa (alta) | Dec. 11.969/2014, arts. 1º, 2º, 4º | seg–sex 6h30–8h30 e 17h30–19h30; sáb 6h30–8h30 | comprimento acima de 7,20 m ou largura acima de 2,30 m | Av. Cel. Antônio Estanislau do Amaral e Alameda José Boldrini inteiras (até a Estrada da Grama), 12,6 km | evita: SP-75 → Estrada da Grama; às 7h a carreta dá 26,6 km com 0 km no eixo; às 10h, 8,5 km nele |
| `indaiatuba_condominio_rio_negro_picos` | desativada (baixa) | Dec. 11.969/2014, art. 1º (parte final) | picos | idem | vazia | — |

Pendências:
- O trecho da R. Humaitá no perímetro (da R. Pedro Gonçalves à R. Ademar de Barros) é presumido, por causa do erro de redação
  do ato.
- O import descartou ~60 m da Alameda José Boldrini que não casaram com o grafo do Valhalla.
- O Condomínio Rio Negro não foi localizado.

## 3522406 Itapeva (`itapeva`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `itapeva_area_central_cap4t_horario` | ativa (alta) | Lei 1.590/2000, arts. 1º e 2º (red. Lei 3.052/2010) | seg–sex 10h–19h; sáb 10h–15h | carga acima de 4 t | `geo/3522406_area_central.geojson` (0,42 km², pelos eixos do OSM) | evita: centro sudoeste → nordeste; às 10h, 0 km na zona; às 20h, com destino em Itapeva, 0,6 km |
| `itapeva_area_central_cap4t_passagem` | ativa (alta) | idem | as horas complementares e o domingo inteiro | carga acima de 4 t; exceção de destino local (carga e descarga) | idem | evita: sudoeste da cidade → Taquarivaí às 20h, 0 km na zona; com 3 t de carga, 0,6 km |
| `itapeva_vias_urbanas_caminhoes` | ativa (média) | Lei 2.498/2006, arts. 1º e 4º (red. Lei 3.051/2010) | 24 h | todo caminhão; exceção de destino local | `geo/3522406_perimetro_urbano.geojson`: setores urbanos do IBGE 2022 da sede, sem a SP-258, a SP-249, o Anel Mário Covas e a Rod. Luiz José Sguário (4 partes) | evita: Rod. Sguário → Taquarivaí; o toco dá 41,9 km com 0 km na zona; o utilitário passa 6,4 km nela |
| `itapeva_area_central_1997_revogada` | revogada | Lei 1.027/1997, art. 7º, §2º (revogado pela Lei 1.590/2000) | — | — | polígono da área central | — |
| `itapeva_escolas_veiculos_pesados` | desativada (baixa) | Lei 2.940/2009, art. 1º | — | — | vazia | — |

Pendências:
- Nomes usados do OSM: "Rua Doutor Eurico Pimentel Dias" (o ato diz Érico), "Rua José Bazílio de Araújo Ferraz" e "Rua Doutor
  Ricardo Whaterly". A R. João Augusto Lico não está no OSM. A R. Sinhô de Camargo, que o ato inclui, é o limite norte e fica
  livre por causa do recuo.
- **Perímetro urbano**: falta confirmar qual lei de perímetro vale depois da ADI contra a Lei 5.109/2024. Os núcleos dos outros
  distritos ficaram fora.
- **Domingo**: a passagem fica proibida o dia todo, pela leitura literal do verificador.

## 3522505 Itapevi (`itapevi`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `itapevi_centro_veiculos_carga` | ativa (alta) | Dec. 4.956/2013, arts. 1º–4º e 10; Lei 1.987/2009; Lei 2.716/2019, art. 23 | seg–sex 7h–9h e 16h–20h; sáb e dom 7h–14h | todo caminhão, menos o VUC (2,20 × 6,30 m, sem cadastro) | `geo/3522505_vias.geojson`: 24 dos 29 incisos | evita: R. Prof. Irineu Chaluppe; às 7h30, só os cruzamentos (0,04 km); às 10h, 0,32 km. sem_alternativa: destino na R. Escolástica Chaluppe às 7h30 (avisa `rmsp_via_restrita_na_rota`) |
| `itapevi_penaestrada_viaduto_novaes` | desativada (baixa) | penaestrada (compilação de terceiros) | — | — | vazia | — |

Pendências:
- Ficaram fora da geometria:
  - inciso X, R. Adalberto Montanher, que não está no OSM;
  - XVII, XVIII e XIX (R. Carmem Silva de Almeida, R. Samuel da Rocha Galvão e R. Prof. Dimarães Antônio Sandei): trechos de
    poucos números em vias longas, sem como localizar as pontas.
- Pontas aproximadas pela numeração:
  - I: Av. Pres. Getúlio Vargas, do centro até a R. Agostinho Ferreira de Campos (~775 m);
  - VI: R. Bonifácio de Abreu, o primeiro way;
  - XIII: Av. Brasil, ~290 m;
  - XIV: Estrada do Itaqui, o primeiro way.
- Algumas vias entram inteiras e passam do trecho do ato (VIII e outras).
- O parágrafo único do art. 2º (trechos livres) não foi recortado. O import descartou um sentido de pequenos pedaços da
  R. Joaquim Nunes e da Av. Cesário de Abreu que não casaram com o grafo.
- Em feriado de dia útil o ato manda 7h–14h, mas o formato aplica as janelas do dia da semana.
