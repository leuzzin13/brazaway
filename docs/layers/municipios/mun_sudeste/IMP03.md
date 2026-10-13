# mun_sudeste — lote IMP03 (11 municípios de MG)

Regras municipais de caminhão de João Pinheiro, Juiz de Fora, Lambari, Leopoldina, Luz, Manhuaçu, Matutina, Minas Novas,
Nova Lima, Ouro Preto e Perdões, implementadas na camada genérica `restricoes_rmsp` (`data/raw/municipios/<ibge>.json`,
formato em [`../../restricoes_municipais.md`](../../restricoes_municipais.md)) a partir da pesquisa em
`docs/research/cidades_sudeste/res/<ibge>.json`, com as correções de `verif/<ibge>.json` (verificação de 11/10/2026).

Resumo: **17 regras ativas** em 10 municípios (12 vias, 5 zonas), **8 registros desativados** e **2 revogados**.
Leopoldina ficou sem regra ativa: a ponte do Dec. 3.707/2014 não foi localizada (ver a seção). Casos de rota conferidos
na API real em `api/test/fixtures/mun_sudeste/<ibge>.json` e rodados por `api/test/layers/mun_sudeste.test.ts`
(`-t "<ibge>"`), todos passando em 12/10/2026.

## Como a geometria foi feita

O Overpass estava fora do ar. As vias com nome vêm do cache `data/cache/municipios/osm_named_<ibge>.json` (gerado do PBF
local do Valhalla); o que o cache não tem (marcos quilométricos `highway=milestone`, parques, nós `place=*`) foi lido do
mesmo PBF (`data/valhalla/sudeste-latest.osm.pbf`) com pyosmium, fora do importador. Tudo é OSM (ODbL 1.0), declarado em
`fonte.licenca`.

- **Vias por nome** (`construir: "trechos"`): nomes exatamente como no OSM; pontas por transversal ou por `{"lonlat"}`.
  Os GeoJSON `geo/<ibge>_vias.geojson` (e `3144805_mg030.geojson`) foram gerados pelo import com `pendencias` vazias,
  exceto a R. Paulo de Frontin (pedestres, Juiz de Fora, registro desativado). Logradouros que não existem no OSM com o
  nome do ato ficaram fora dos `trechos` e estão listados nas pendências.
- **Área urbana aproximada** (Luz, Matutina, Perdões): vias com nome do OSM da sede com buffer de 50 m, união, borda
  recuada a ~30 m do eixo da última rua, abertura de 60 m (tira braços ao longo de estradas), corredor de 30 m das
  rodovias BR excluído; `aproximado: true`. Aproximação conservadora; na rota a zona ainda é recuada 20 m.
- **ZRC de Juiz de Fora**: faces do OSM fechadas pelas vias-limite do art. 1º, II, do Dec. 15.748/2023.
- **Lambari**: as partes das ruas que contornam o Parque das Águas foram limitadas às faces do quarteirão do parque
  (`leisure=park` "Parque das Águas", OSM way 481244535).
- **MG-030 (Nova Lima)**: marcos do km 14 e do km 24 do OSM; km 10, 18,9 e 24,78 interpolados ao longo da rodovia no
  grafo do Valhalla (o trecho 14→24 mede 10,06 km, o que confirma a escala); um trecho por pista (pista dupla), com
  `sentido: true`.
- Registros desativados sem polígono e os revogados de município inteiro usam o limite municipal do IBGE só como registro.


## 3136306 João Pinheiro/MG (`joao-pinheiro`)

Única restrição de circulação achada: Lei 494/1993 (Av. Juca Cordeiro, entre a R. Geraldo Rios e a BR-040, e Pça. Major Mendonça), sem horário. A Pça. Major Mendonça não existe com esse nome no OSM: só a Av. Juca Cordeiro entrou na geometria (pendência). O Plano de Mobilidade (Lei 2.469/2020) só anuncia uma restrição futura, registrada desativada.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `joao_pinheiro_juca_cordeiro` | ativa (media) | Lei municipal 494, de 22/04/1993 (João Pinheiro), aprovada pela Câmara e sancionada pelo Prefeito, art. 1º (proibição na Av. Juca Cordeiro, entre a R. Geraldo Rios e a BR-040, e na Pça. Major Mendonça), art. 2º (veículos de carga e tração = art. 77, II, b, 5, e e, 1 a 4, do Dec. federal 62.127/1968), art. 3º (exceção de carga e descarga), art. 6º (vigência na publicação) | todos os dias 24 h | caminhão | vias do OSM por nome (`3136306_vias.geojson`) | evita: toco, (-17.7425, -46.174) → (-17.7496, -46.17), 2026-10-13T10:00. Da Pça. Cel. Hermógenes à BR-040 (leste). Utilitário usa 0,38 km da Av. Juca Cordeiro; o toco desvia (0 km). Regra 24 h: sem horário fora da janela. |
| `joao_pinheiro_perimetro_central_planmob` | desativada (baixa): Só diretriz do Plano de Mobilidade (Lei 2.469/2020, art. 8º, III), 'a ser regulamentado' pelo Departamento Municipal de Trânsito; nenhum ato regulamentador com … | Lei municipal 2.469/2020 (Plano de Mobilidade Urbana Sustentável de João Pinheiro), Diário Oficial dos Municípios Mineiros ed. 2.785, 26/06/2020, art. 8º, II e III (regulamento de carga e descarga e restrição de veículos de carga de grande porte em perímetro próximo ao centro, a regulamentar) |  | caminhão | limite municipal IBGE (registro) | — |

**Pendências:** Pça. Major Mendonça (Lei 494/1993) não existe com esse nome no OSM: fora da geometria. Perímetro central do Plano de Mobilidade (Lei 2.469/2020) aguarda regulamentação (desativado).

## 3136702 Juiz de Fora/MG (`juiz-de-fora`)

Dec. 15.748/2023 (regulamenta a Lei 7.062/1987): ZRC do Centro proibida a veículos com CAPACIDADE DE CARGA acima de 6 t, dias úteis 9h–20h e sábado 9h–15h (domingos e feriados livre, Anexo III). Polígono aproximado (Anexos I e II não georreferenciados), contornado pelas vias-limite do art. 1º, II; as vias-limite e os prolongamentos (alíneas a–f) são regra de via. Vias de Tratamento Especial e de Pedestres são regimes de carga e descarga (desativadas). Dec. 15.679/2023 revogado (registro histórico).

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `juiz_de_fora_zrc_centro` | ativa (alta) | Decreto municipal 15.748/2023 (DOE Juiz de Fora 17/02/2023), regulamenta a Lei 7.062/1987, art. 1º, II (ZRC: proibida a circulação de veículos com capacidade de carga acima de 6 t, de 2ª a 6ª das 9h às 20h e aos sábados das 9h às 15h; polígono e alíneas a–f); art. 3º, §1º (capacidade = nominal, norma ANTT); Anexo III (ZRC: domingos e feriados livre); art. 12 (vigência na publicação) | seg–sex 09:00–20:00; sáb 09:00–15:00 | caminhão com capacidade > 6 t | polígono/linhas curados (`3136702_zrc.geojson`) aproximado | evita: toco, (-21.756, -43.36) → (-21.764, -43.338), 2026-10-13T10:00, fora 2026-10-13T21:00. Oeste do Centro (Olegário Maciel) à Av. Brasil (leste): às 10h de terça o toco (capacidade típica 10 t > 6 t) contorna a ZRC (0 km); às 21h atravessa 1,41 km. |
| `juiz_de_fora_zrc_vias` | ativa (alta) | Decreto municipal 15.748/2023 (DOE Juiz de Fora 17/02/2023), art. 1º, II, alíneas a (Av. Barão do Rio Branco, entre a Av. Pres. Itamar Franco e a R. Agassis), b (R. da Bahia, entre a R. Antônio Dias Tostes e a R. Ângelo Falci), c (R. Ângelo Falci, restrição total), d (Av. Francisco Bernardino, restrição total), e (R. Benjamin Constant, entre a R. Prof. Osvaldo Veloso e a R. Tiradentes) e f (R. Mariano Procópio, entre a R. Antônio Lagrota e a Av. Barão do Rio Branco) | seg–sex 09:00–20:00; sáb 09:00–15:00 | caminhão com capacidade > 6 t | vias do OSM por nome (`3136702_vias.geojson`) | evita: toco, (-21.756, -43.36) → (-21.764, -43.338), 2026-10-13T10:00, fora 2026-10-13T21:00. Mesmo par: às 10h nenhuma das vias-limite/prolongamentos (0 km); às 21h a rota usa 2,28 km delas (Av. Francisco Bernardino, Av. Barão do Rio Branco). |
| `juiz_de_fora_vias_tratamento_especial` | desativada (alta): O art. 1º, III, do Dec. 15.748/2023 e o Anexo III regulam só as OPERAÇÕES de carga e descarga nessas vias (dias úteis 21h–7h, sábado 15h–24h, domingos e feriado… | Decreto municipal 15.748/2023 (DOE Juiz de Fora 17/02/2023), art. 1º, III (a: Av. Barão do Rio Branco, entre a R. Américo Lobo e a R. Salgado Filho; b: Av. Pres. Itamar Franco; c: Av. Olegário Maciel; d: Av. Brasil; e: Av. Juscelino Kubitschek; f: R. Santo Antônio; g: R. N. Sra. de Lourdes, entre a R. Padre Guilherme e a R. Mariano Alonso A. de Castilho; h: R. Francisco Cerqueira Cruzeiro, entre a R. Mariano Alonso A. de Castilho e a R. Luiz Fellet; i: R. Dom Silvério) e Anexo III, item III | seg–sex 07:00–21:00; sáb 00:00–15:00 | caminhão | vias do OSM por nome (`3136702_tratamento_especial.geojson`) | — |
| `juiz_de_fora_vias_pedestres` | desativada (alta): Calçadões fechados a qualquer veículo (já excluídos pela malha do OSM como via de pedestre); a carga e descarga neles só com autorização da SMU, até 7 t de capa… | Decreto municipal 15.748/2023 (DOE Juiz de Fora 17/02/2023), art. 1º, I (a: Av. Gov. Valadares; b: R. Halfeld, trechos; c: R. Barão de São João Nepomuceno; d: R. Mister Moore; e: R. Batista de Oliveira; f: R. Marechal Deodoro; g: R. Paulo de Frontin) e parágrafo único; Anexo III, item I | todos os dias 24 h | caminhão | polígono/linhas curados (`3136702_pedestres.geojson`) | — |
| `juiz_de_fora_centro_15679_revogado` | revogada (alta): Dec. 15.679/2023 revogado pelo Dec. 15.748/2023, art. 11 (DOE 17/02/2023). Registro histórico: vigeu de 06/02/2023 (30 dias após a publicação) a 17/02/2023. | Decreto municipal 15.679/2023 (DOE Juiz de Fora 07/01/2023), art. 1º, II (Centro Comercial / Zona de Restrição Máxima, capacidade > 6 t ou comprimento > 12 m, segunda a domingo), III e IV; Anexo I (cavalos mecânicos e carretas proibidos 24 h); art. 12 (vigência 30 dias após a publicação)<br>Decreto municipal 15.748/2023 (DOE Juiz de Fora 17/02/2023), art. 11 (revoga o Dec. 15.679/2023) | todos os dias 24 h | caminhão com capacidade > 6 t ou comprimento > 12 m | polígono/linhas curados (`3136702_zrc.geojson`) | — |

**Pendências:** Polígono da ZRC aproximado (Anexos I e II do Dec. 15.748/2023 não georreferenciados). R. Paulo de Frontin sem trecho de pedestre no OSM (regra de pedestres desativada, só registro).

## 3137809 Lambari/MG (`lambari`)

Lei 1.945/2014: vias que contornam o Parque das Águas (art. 3º) e R. Joaquim Manoel de Melo (art. 4º; também Lei 1.943/2014) proibidas a caminhões em qualquer horário. Trânsito de passagem (art. 1º) e limite de 10 t de carga nas demais vias (art. 7º, p. único) registrados desativados. Carga e descarga (art. 6º) não é restrição de circulação.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `lambari_vias_parque_aguas` | ativa (media) | Lei Municipal 1.945, de 09/12/2014 (DOM-AMM ed. 1396, 18/12/2014), art. 3º e incisos I a V (vias); art. 5º (exceções); art. 7º (VUC/3 t) | todos os dias 24 h | caminhão | vias do OSM por nome (`3137809_vias.geojson`) | evita: toco, (-21.9733, -45.352) → (-21.973, -45.3488), 2026-10-13T10:00. Oeste da R. Dr. Américo Werneck até a Pç. Vivaldi Leite Ribeiro: veículo de 3 t passa 0,24 km pelas vias do Parque (0,33 km); o toco contorna (0,95 km) e avisa a via evitada. Regra 24 h. |
| `lambari_rua_joaquim_manoel_melo` | ativa (media) | Lei Municipal 1.945, de 09/12/2014 (DOM-AMM ed. 1396, 18/12/2014), art. 4º<br>Lei Municipal 1.943, de 11/11/2014 (DOM-AMM ed. 1387, 05/12/2014), art. 1º (nova redação do art. 91, §1º, da Lei 439/1970) | todos os dias 24 h | caminhão | vias do OSM por nome (`3137809_vias.geojson`) | evita: toco, (-21.9703, -45.3416) → (-21.9745, -45.346), 2026-10-13T10:00. Av. Antônio Basílio de Carvalho (leste) até o sul do centro: veículo de 3 t usa 0,75 km da R. Joaquim Manoel de Melo (1,15 km); o toco desvia (1,15 km, 0 km na rua). Regra 24 h. |
| `lambari_transito_passagem` | desativada (media): Ato lido (Lei 1.945/2014, art. 1º), mas a restrição depende da origem/destino da carga (exceções do art. 2º: entrega, saída de produtos, sem rota alternativa) e… | Lei Municipal 1.945, de 09/12/2014 (DOM-AMM ed. 1396, 18/12/2014), art. 1º e art. 2º | todos os dias 24 h | caminhão | limite municipal IBGE (registro) | — |
| `lambari_limite_10t_demais_vias` | desativada (baixa): O art. 7º, p. único fala em 'limite máximo de carga de 10 toneladas' (capacidade de carga, não PBT) nas demais vias do município, com autorização da Prefeitura … | Lei Municipal 1.945, de 09/12/2014 (DOM-AMM ed. 1396, 18/12/2014), art. 7º, parágrafo único | todos os dias 24 h | caminhão com capacidade > 10 t | limite municipal IBGE (registro) | — |

**Pendências:** Praça Conselheiro João Lisboa (art. 3º, II) não tem nome no OSM: fora da geometria. Os trechos 'parte de' da R. Dr. Wadih Bacha, R. Tiradentes e R. Fabiano Pereira Krauss foram limitados às faces do quarteirão do Parque das Águas (polígono do parque no OSM), leitura do p. único do art. 3º; conferir sinalização. Trânsito de passagem (art. 1º) e 10 t de carga (art. 7º, p. único) desativados (sem perímetro urbano; dependem de origem/destino; 10 t com confiança baixa). Bug do importador contornado: `build_trecho` falha (`ValueError: Cannot linemerge`) quando a via é um único way e o trecho tem de/ate; Wadih Bacha e Krauss usam `caminho: valhalla` com pontas em coordenadas.

## 3138401 Leopoldina/MG (`leopoldina`)

Dec. 3.707/2014: ponte de concreto da estrada velha de Cataguases proibida a veículos pesados acima de 12 t. A ponte é descrita só em texto (perto da propriedade do Sr. Alcir Queiros e de uma antiga escola municipal) e não foi localizada no OSM: regra desativada por falta de geometria confiável (pendência). Carnaval (Av. Jehu/Jenu Pinto de Faria): restrição de evento, desativada.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `leopoldina_ponte_estrada_velha_cataguases_12t` | desativada (media): Sem geometria confiável: o Dec. 3.707/2014 descreve a ponte só em texto ('nas proximidades da propriedade do Sr. Alcir Queiros, próximo a uma antiga Escola Muni… | Decreto municipal 3.707, de 20/10/2014 (DOMM ed. 1357, 24/10/2014), art. 1º (veda veículos pesados, em especial carretas e caminhões trucados com peso total superior a 12 t, na ponte); art. 2º (sinalização); art. 3º (CTB art. 231, IV); art. 4º (vigência na publicação) | todos os dias 24 h | caminhão com PBT > 12 t | limite municipal IBGE (registro) | — |
| `leopoldina_carnaval_jehu_pinto_caminhoes` | desativada (alta): Restrição de evento (Carnaval 2025, 26/02 a 07/03/2025), reeditada a cada ano por decreto próprio; não é regra permanente. | Decreto municipal 5.474, de 03/02/2025 (DOMM ed. 3955, 07/02/2025), art. 2º, §1º |  | caminhão | vias do OSM por nome (`3138401_vias.geojson`) | — |

**Pendências:** A ponte da estrada velha de Cataguases (Dec. 3.707/2014, 12 t) não foi localizada no OSM (descrição só em texto): regra vigente registrada desativada com 'sem geometria confiável'; ativar como ponte quando houver coordenada. Nenhuma regra ativa, então não há caso de rota.

## 3138807 Luz/MG (`luz`)

Dec. 2.018/2015: na área urbana, proibida a passagem de caminhão, carreta, romeu e julieta, bitrem, rodotrem, tritrem e treminhão carregado acima de 25 t (art. 1º; lido como PBT pela ementa) e acima de 6 m de altura (art. 2º). A área urbana não tem limite oficial georreferenciado: polígono aproximado (tecido urbano contínuo da sede no OSM, BR-262 fora).

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `luz_area_urbana_25t` | ativa (media) | Decreto municipal 2.018/2015 (Luz, 16/10/2015; DOM-AMM ed. 1605, 20/10/2015), art. 1º, I a III, e parágrafo único (passagem na área urbana carregado acima de 25 t; exceções; comprovação por nota fiscal ou pesagem); art. 3º (efeitos desde 16/10/2015) | todos os dias 24 h | caminhão com PBT > 25 t | polígono/linhas curados (`3138807_area_urbana.geojson`) aproximado | evita: carreta, (-19.6316, -45.6414) → (-20.0004, -45.8816), 2026-10-13T10:00. MG-176 de fora de Luz (norte) até a MG-176 a sudoeste, já fora do município: o utilitário atravessa 3,37 km da área urbana (56,5 km); a carreta (PBT 41,5 t) contorna (86 km). Regra 24 h. |
| `luz_area_urbana_altura_6m` | ativa (media) | Decreto municipal 2.018/2015 (Luz, 16/10/2015; DOM-AMM ed. 1605, 20/10/2015), art. 2º e parágrafo único (acima de 6 m de altura, comprovada por documento ou medição) | todos os dias 24 h | caminhão com altura > 6 m | polígono/linhas curados (`3138807_area_urbana.geojson`) aproximado | evita: truck {"height_m": 6.2}, (-19.6316, -45.6414) → (-20.0004, -45.8816), 2026-10-13T10:00. Mesmo par: truck de 23 t (fora da regra de 25 t) com 6,2 m de altura contorna a área urbana (98 km); com a altura padrão passa 3,37 km por ela. |

**Pendências:** Área urbana sem limite oficial: polígono aproximado do tecido urbano da sede (BR-262 fora). Leitura de 'carregado acima de 25 t' como PBT (ementa).

## 3139409 Manhuaçu/MG (`manhuacu`)

Lei 3.252/2012: 18 logradouros do centro proibidos a veículos com capacidade de carga igual ou superior a 6 t, 2ª–6ª 8h–19h e sábado 8h–12h. A Pça. Antônio Brum (inc. XVI) não existe com esse nome no OSM: fora da geometria (pendência). Resolução CMT 01/2018 (vagas de carga e descarga) registrada desativada.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `manhuacu_centro_pesados_6t` | ativa (alta) | Lei municipal 3.252, de 05/12/2012 (Manhuaçu), alterada pelas Leis 3.971/2019 e 4.322/2023, art. 1º, I a XVIII (vias e horários); art. 2º (veículo pesado = capacidade de carga ≥ 6 t); art. 3º e parágrafo único (carga e descarga); art. 4º (exceções); art. 8º (vigência 180 dias após a publicação)<br>Lei municipal 4.322, de 22/02/2023 (Manhuaçu), art. 1º (nova redação do parágrafo único do art. 3º da Lei 3.252/2012)<br>Decreto municipal 306, de 05/07/2019 (Manhuaçu), arts. 2º, 3º e 5º (repetem vias, horários e exceções); arts. 4º, 6º a 8º (licença especial para perecíveis) | seg–sex 08:00–19:00; sáb 08:00–12:00 | caminhão com capacidade > 5,99 t | vias do OSM por nome (`3139409_vias.geojson`) | evita: toco, (-20.2495, -42.032) → (-20.254, -42.038), 2026-10-13T10:00, fora 2026-10-13T20:00. R. Antônio Puppim ao oeste do centro: terça 10h o toco evita as vias centrais (0 km); às 20h usa 0,78 km (Av. Getúlio Vargas, R. Prof. Juventino Nunes).<br>evita: toco, (-20.254, -42.038) → (-20.256, -42.0285), 2026-10-17T10:00, fora 2026-10-17T13:00. Sábado: às 10h (janela 8h–12h) o toco evita o centro (0 km); às 13h atravessa 0,58 km (Pça. Cordovil Pinto Coelho, R. Leandro Gonçalves). |
| `manhuacu_cmt_carga_descarga_vagas` | desativada (media): Regra de estacionamento para carga e descarga (Resolução do Conselho Municipal de Trânsito 01/2018), não de circulação; a camada não modela vagas. | Resolução CMT (Conselho Municipal de Trânsito de Manhuaçu) nº 01, de 03/07/2018, arts. 1º a 6º (Centro Comercial, vias de tratamento especial, critérios das vagas, sinalização R-6b) |  | caminhão | limite municipal IBGE (registro) | — |

**Pendências:** Pça. Antônio Brum (inc. XVI da Lei 3.252/2012) não existe com esse nome no OSM: fora da geometria. Vagas de carga e descarga (Resolução CMT 01/2018) desativadas (não é circulação).

## 3141207 Matutina/MG (`matutina`)

Dec. 080/2021: no perímetro urbano, proibida a circulação de veículos com carga superior a 15 t (lido como capacidade de carga), salvo entrega/carga e descarga no perímetro. Dec. 057/2021: o mesmo na R. Omar Carneiro (entre a R. João Mulato e a R. Moacir Franco). Perímetro urbano sem delimitação no ato: polígono aproximado do tecido urbano da sede.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `matutina_perimetro_urbano_carga_15t` | ativa (media) | Decreto municipal 080, de 24/08/2021 (DOMM ed. 3080, 25/08/2021), art. 1º e parágrafo único (proibição e exceção); art. 2º (multa de 700 UFMs); art. 5º (vigência na publicação) | todos os dias 24 h | caminhão com capacidade > 15 t | polígono/linhas curados (`3141207_matutina_perimetro.geojson`) aproximado | evita: carreta, (-19.32, -45.975) → (-19.2, -45.8), 2026-10-13T10:00. Origem e destino fora de Matutina (a exceção de entrega local não vale): o utilitário passa 1,1 km pela sede; a carreta (capacidade típica 27 t > 15 t) contorna. Regra 24 h. |
| `matutina_rua_omar_carneiro_carga_15t` | ativa (media) | Decreto municipal 057, de 18/06/2021 (DOMM ed. 3033, 21/06/2021), art. 2º e parágrafo único (trecho definido no art. 1º) | todos os dias 24 h | caminhão com capacidade > 15 t | vias do OSM por nome (`3141207_vias.geojson`) | sem_alternativa: carreta, (-19.2205, -45.9705) → (-19.32, -45.975), 2026-10-13T10:00. Origem na própria R. Omar Carneiro (trecho de 144 m dentro do perímetro): a carreta tem de usar 75 m dela e a rota avisa rmsp_via_restrita_na_rota. Com origem/destino fora do trecho, a zona do perímetro já tira a rota da rua. |

**Pendências:** Perímetro urbano sem delimitação no Dec. 080/2021: polígono aproximado. A R. Omar Carneiro é a única ligação no trecho testado (caso sem_alternativa).

## 3141801 Minas Novas/MG (`minas-novas`)

Lei 1.331/2003: proibido o tráfego de carga pesada (caminhão, carreta, ônibus) na Rua da Barra, sem horário, peso ou trecho. Ônibus fora do alvo (só caminhão).

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `minas_novas_rua_da_barra_carga_pesada` | ativa (media) | Lei municipal 1.331, de 27/03/2003 (Câmara Municipal de Minas Novas, promulgada pelo Vice-Presidente da Câmara), art. 1º (proíbe 'a partir de 15/02/2003' o tráfego de carga pesada: caminhão, carreta, ônibus, na Rua da Barra); art. 2º (vigência); art. 3º (revoga disposições em contrário) | todos os dias 24 h | caminhão | vias do OSM por nome (`3141801_vias.geojson`) | evita: toco, (-17.223, -42.596) → (-17.208, -42.603), 2026-10-13T10:00. Sul ao norte da sede: o utilitário usa 0,51 km da Rua da Barra (travessia da BR-367/MGC-367 no OSM, 3,6 km); o toco desvia (8,4 km). Regra 24 h. |

**Pendências:** Rua da Barra inteira (a lei não delimita trecho).

## 3144805 Nova Lima/MG (`nova-lima`)

Dec. 10.185/2020: área central da sede (35 logradouros) proibida a lotação acima de 5 t ou comprimento acima de 6,50 m (2ª–6ª 7h–19h, sáb 7h–15h) e, a qualquer hora, a lotação acima de 20 t e carretas/bitrens/cavalos mecânicos. Dec. 10.163/2020 + Lei 2.815/2020 + Portaria 005/2020: MG-030 municipalizada (km 10–14 e 18,9–24,78) proibida a carretas, bitrens e lotação ≥ 20 t sem AETVC. Dec. 9.651/2019 revogado (registro).

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `nova_lima_area_central_5t` | ativa (alta) | Decreto municipal 10.185, de 30/06/2020 (Nova Lima), art. 2º (logradouros da área central), art. 3º (livre até 5 t de lotação e 6,50 m), art. 4º e tabela anexa (acima de 5 t ou 6,50 m: proibido seg–sex 7h–19h e sáb 7h–15h; domingos e feriados livre), arts. 7º–9º | seg–sex 07:00–19:00; sáb 07:00–15:00 | caminhão com capacidade > 5 t ou comprimento > 6,5 m | vias do OSM por nome (`3144805_vias.geojson`) | evita: toco, (-19.988, -43.856) → (-19.982, -43.84), 2026-10-13T10:00, fora 2026-10-13T21:00. Oeste da sede ao leste do centro: às 10h (terça) o toco contorna a área central (6,26 km; só cruzamentos, 0,02 km); às 21h passa 1,98 km pelas vias da área central (3,14 km). |
| `nova_lima_area_central_carretas_20t` | ativa (alta) | Decreto municipal 10.185, de 30/06/2020 (Nova Lima), art. 5º (lotação superior a 20 t: proibida circulação e C/D em qualquer dia e horário) e art. 6º (proibida a circulação de carretas, bitrens e cavalos mecânicos nas vias da área central devidamente sinalizadas); tabela anexa | todos os dias 24 h | caminhão com capacidade > 20 t ou tipo ∈ semitrailer, cvc | vias do OSM por nome (`3144805_vias.geojson`) | evita: carreta, (-19.988, -43.856) → (-19.982, -43.84), 2026-10-13T21:00. Mesmo par às 21h (fora da janela de 5 t): a carreta contorna a área central (regra 24 h); um truck com capacidade informada de 14 t passa 1,98 km pelo centro. |
| `nova_lima_mg030_carretas` | ativa (media) | Decreto municipal 10.163, de 25/06/2020 (Nova Lima), art. 1º (trechos municipalizados da MG-030 entre os km 10 e 14 e 18,9 e 24,78) e art. 2º (proibida a circulação de carretas, bitrens e veículos com lotação igual ou superior a 20 t, salvo autorizados por portaria da SEMST); art. 3º (revoga o Decreto 9.673/2019)<br>Lei municipal 2.815, de 29/12/2020 (Nova Lima), art. 1º (cadastro prévio de carretas, bitrens e veículos com lotação ≥ 25 t nos mesmos trechos), art. 2º (cadastrados só 0h–5h, 8h–11h, 14h–17h e 19h–23h59), art. 3º (exceções), art. 12 (não autorizados são autuados), art. 14 (vigência na publicação)<br>Portaria 005-SEMST, de 07/07/2020 (Nova Lima), art. 1º e parágrafo único, art. 2º (autorizados ≥ 20 t só 8h–11h, 14h–17h e 19h–22h), art. 3º (exceções) | todos os dias 24 h | caminhão com capacidade > 19,99 t ou tipo ∈ semitrailer, cvc | vias do OSM por nome (`3144805_mg030.geojson`) | evita: carreta, (-19.998, -43.915) → (-19.977, -43.95), 2026-10-13T10:00. MG-030 sentido BH, km 14–10: a carreta evita o trecho municipalizado (30,3 km por fora); um truck com 14 t de capacidade usa 3,76 km da MG-030 (9,9 km).<br>evita: carreta, (-19.994, -43.885) → (-20.011, -43.848), 2026-10-13T10:00. MG-030 km 18,9–24,78: a carreta desvia (13,4 km, 0 km no trecho); um truck com 14 t de capacidade usa 5,37 km da MG-030 (9,4 km). |
| `nova_lima_dec9651_carretas_municipio` | revogada (alta): Decreto 9.651/2019 revogado expressamente pelo art. 9º do Decreto 10.185, de 30/06/2020, que restringiu a proibição de carretas à área central. | Decreto municipal 9.651, de 09/12/2019 (Nova Lima), art. 6º (proibida a circulação, em todas as vias do Município, devidamente sinalizadas, de carretas, bitrens e cavalos mecânicos); alterado pelo Decreto 9.673/2019 (parágrafo único: minério na MG-030), revogado pelos Decretos 10.163/2020 e 10.185/2020 | todos os dias 24 h | caminhão com tipo ∈ semitrailer, cvc | limite municipal IBGE (registro) | — |

**Pendências:** Fora da geometria por não existirem no OSM com esses nomes: Praça Coronel Aristides, Praça do Mineiro, Praça Bernardino de Lima, Praça do SENAI, Av. Amélia de Magalhães Pessoa e a Estrada de acesso aos Bairros Mingu e Mina D'Água. MG-030: pontas por marco quilométrico (km 14 e km 24 no OSM; km 10, 18,9 e 24,78 interpolados, ±200 m; a pista sentido Rio Acima começa ~250 m ao sul do km 10 porque a alça da Via Stael Mary não liga por nome). A carreta no sentido BH→Nova Lima do trecho km 10–14 ainda usa 1,3 km da MG-030 porque o próprio OSM já restringe vias da alternativa (uses_restricted_way); o caso testado é o sentido contrário. Carretas/bitrens com AETVC (janelas da Portaria 005/2020 e da Lei 2.815/2020) não são modeláveis: registrado 24 h.

## 3146107 Ouro Preto/MG (`ouro-preto`)

Dec. 8.047/2023, art. 1º, IV (red. Dec. 8.348/2024): proibido na Estrada da Purificação (Antônio Pereira – sede, pelo Morro São João) o tráfego de veículos de carga com PBT acima de 7 t, sem horário; autorização excepcional da OUROTRAN (art. 3º). Nenhuma restrição geral no centro histórico achada.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `ouro_preto_estrada_purificacao_carga_7t` | ativa (media) | Decreto municipal 8.047, de 24/10/2023 (Diário Oficial de Ouro Preto, ed. 3294, 16/11/2023), art. 1º, IV (proíbe veículos de carga na Estrada da Purificação; redação original: capacidade > 7 t e comprimento > 8 m); art. 3º (autorização OUROTRAN); art. 4º (vigência na publicação)<br>Decreto municipal 8.348, de 20/05/2024 (Diário Oficial de Ouro Preto, ed. 3423, 24/05/2024), art. 1º (nova redação do art. 1º, IV, do Dec. 8.047: 'veículos de carga com peso bruto total superior a 07 (sete) toneladas'); art. 2º (vigência na publicação) | todos os dias 24 h | caminhão com PBT > 7 t | vias do OSM por nome (`3146107_vias.geojson`) | evita: toco, (-20.315, -43.481) → (-20.385, -43.5), 2026-10-13T10:00. Antônio Pereira à sede: o utilitário usa 5,0 km da Estrada da Purificação (15,5 km); o toco (16 t > 7 t) vai por outro caminho (24,1 km, só 25 m no cruzamento). Regra 24 h. |

**Pendências:** Incisos I a III do art. 1º (veículos de mineradoras, ônibus de trabalhadores, jardineiras) não modeláveis por PBT.

## 3149903 Perdões/MG (`perdoes`)

Lei 3.513/2024: proibidos trânsito e estacionamento de veículos pesados, carretas e similares com mais de 3 eixos em todo o perímetro urbano (art. 1º, com exceções de carga e descarga, coletivo, mudanças/obras e garagem) e no Centro Histórico e Cultural (art. 2º, sem a exceção de carga e descarga). Perímetro urbano sem limite oficial: polígono aproximado (BR-381 fora). Centro Histórico: só as vias nomeadas no art. 2º.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota (API) |
|---|---|---|---|---|---|---|
| `perdoes_perimetro_urbano_3_eixos` | ativa (media) | Lei municipal 3.513/2024 (Perdões, 05/12/2024; DOM-AMM ed. 3913, 09/12/2024), art. 1º e parágrafo único (proibição e exceções); art. 6º (multa); art. 8º (vigência na publicação e revogação da Lei 2.658/2010) | todos os dias 24 h | caminhão com eixos > 3 | polígono/linhas curados (`3149903_perimetro_urbano.geojson`) aproximado | evita: carreta, (-21.05, -45.2) → (-21.2, -45.05), 2026-10-13T10:00. Origem e destino fora de Perdões: o utilitário passa 0,31 km pela área urbana; a carreta (5 eixos) contorna. Regra 24 h. |
| `perdoes_centro_historico_3_eixos` | ativa (media) | Lei municipal 3.513/2024 (Perdões, 05/12/2024; DOM-AMM ed. 3913, 09/12/2024), art. 2º e parágrafo único (vias do Centro Histórico e Cultural e exceção); art. 6º (multa) | todos os dias 24 h | caminhão com eixos > 3 | vias do OSM por nome (`3149903_vias.geojson`) | evita: carreta, (-21.091, -45.087) → (-21.0965, -45.092), 2026-10-13T10:00. Leste ao sul do centro (origem e destino no perímetro: a zona não exclui e avisa; as vias do Centro Histórico não têm exceção de entrega): o utilitário usa 0,60 km das vias do art. 2º; a carreta, 0 km. |

**Pendências:** Perímetro urbano sem limite oficial: polígono aproximado (BR-381 fora). 'Demais ruas do perímetro de tombamento' (art. 2º) não listadas nem delimitadas: fora da geometria.

## Bug do importador (não corrigido aqui)

`importers/sources/_municipios_lib.py`, `build_trecho`: quando a via tem **um único way** no OSM e o trecho tem
`de`/`ate` por nome, `linemerge(unary_union(lines))` recebe um `LineString` e o shapely levanta
`ValueError: Cannot linemerge LINESTRING (...)`, derrubando o import do município inteiro. Contorno usado em Lambari:
`caminho: "valhalla"` com pontas em `{"lonlat"}`. Correção sugerida: só chamar `linemerge` quando a união for
`MultiLineString`.
