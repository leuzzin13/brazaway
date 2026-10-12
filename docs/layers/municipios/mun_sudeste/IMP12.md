# mun_sudeste — lote IMP12

Onze municípios de SP da pesquisa cidade por cidade (`docs/research/cidades_sudeste/res/` e `verif/`), na camada
genérica `restricoes_rmsp` (`data/raw/municipios/<ibge>.json`). As regras e as correções vêm do rascunho e do
verificador, e o verificador prevalece. A geometria das vias é do OSM (ODbL), tirada do cache
`data/cache/municipios/osm_named_<ibge>.json`. Ruas sem nome, calçadões e rodovias vêm de um extrato do PBF local
(`data/valhalla/sudeste-latest.osm.pbf`). As zonas usam a malha municipal do IBGE (API v3) e os setores censitários do
IBGE 2022.

Os casos de rota estão em `api/test/fixtures/mun_sudeste/<ibge>.json`. Todos foram conferidos na API (`localhost:3000`)
e passam em `API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"`: são 25 testes
(14 de rota e 11 de kinds), e os testes de "carga e registro" também passam. As datas são terça, 13/10/2026, e
sábado, 17/10/2026 (Águas da Prata). "km na regra" é o trecho da rota a até 10 m da via; nas zonas, é o trecho dentro do
polígono recuado 20 m, como mede o teste.

## Decisões comuns

- **Prefixo dos ids.** Os ids seguem o nome da cidade (`sao_roque_`, `aguas_da_prata_`, `aguas_de_sao_pedro_`). O
  rascunho usava `saoroque_`, `aguasdaprata_` e `aguasdesaopedro_`.
- **"Todas as vias do município"** (Tatuí e Águas da Prata). Usei o limite municipal do IBGE sem as rodovias estaduais e
  federais, recortadas com folga de 40 m: SP/BR por ref, mais toda motorway/trunk e alças. O polígono fica partido em
  pedaços, sem furos. Os scripts estão em `geo/<ibge>_municipio_curadoria.py`. A passagem pelas rodovias foi conferida
  com 0 km na zona e o mesmo trajeto de um veículo fora do alvo.
- **Bairro sem perímetro no ato** (Tanabi, Ibiporanga). Usei o setor censitário urbano do IBGE 2022 do distrito
  (`CD_SIT` 1/2). A zona fica marcada como aproximada e a confiança continua média.
- **Ruas que são uma linha só no OSM** (Votuporanga, Vista Alegre do Alto). Aqui o `de`/`ate` por transversal (e até
  por `lonlat`) quebra no `linemerge`. Em Votuporanga usei `caminho: "valhalla"` entre pontas recuadas 10 m do
  cruzamento, porque no cruzamento exato o Valhalla encaixa na transversal. A Rua Pernambuco foi embutida como recorte
  da way, porque o Valhalla não percorre a rua inteira entre as pontas. Em Vista Alegre do Alto, os recortes são feitos
  pelo script `geo/3556909_vias_curadoria.py` (`construir: manual`).
- **Exceção de carga e descarga do próprio ato.** Entrou como `excecao_destino_local` (entrega no município) em São
  Roque, Taubaté, Tanabi (correção do verificador), Vinhedo (art. 2º, I) e Vista Alegre do Alto (art. 2º), além de
  Águas da Prata, que já vinha no rascunho. Por isso os casos de rota usam destino fora do município.
- **Desativadas.** As sem área ou via determinável ficam com `FeatureCollection` vazia: "ruas centrais", ZRC sem
  portaria, vias "sinalizadas" sem lista, pontos "próximo ao nº", leis só com ementa, carga e descarga e
  estacionamento. As que valem em toda a malha municipal (VCPB fora das VTCP e VCPT em Valinhos) ficam com o limite do
  município só como registro.
- **Import** isolado: `municipios:<ibge>` com `MUNICIPIOS_DIR` montado só com o arquivo do município. Antes, baixei a
  malha do IBGE dos 11 municípios para `data/cache/municipios/ibge_malha_<ibge>.geojson`.

## 3550605 São Roque — `sao-roque`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| sao_roque_est_carmo_articulados | ativa (média) | Dec. 9.363/2020, art. 1º e parágrafo único, art. 3º | 24 h | semirreboque, caminhão + reboque, CVC | Estrada Municipal do Carmo inteira pelo nome (SQE-485/490, ~9 km), aproximado | evita: ponta leste (fora do município) → oeste (fora), carreta: 21,0 km e 0 km na via; o truck usa 7,4 km |

Pendências:
- "Caminhões de grande porte" não tem definição no ato. Só os articulados foram modelados.
- O ato não delimita o trecho, por isso a estrada foi aplicada inteira. O hgv=no e o maxweight do OSM em São Roque não
  foram cruzados com a estrada.

## 3553401 Tanabi — `tanabi`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| tanabi_bairro_ibiporanga_pesados | ativa (média) | Lei 3.542/2024, art. 1º, caput e §§ 1º–3º, arts. 5º e 7º | 24 h | todo caminhão; entrega no município isenta | zona: setor censitário urbano do distrito de Ibiporanga (IBGE 2022, `geo/3553401_ibiporanga.geojson`), aproximado | evita: Rod. Isidoro Saran (sul) → nordeste, fora de Tanabi, toco: 10,7 km e 0 km na zona; um veículo de 3 t corta 0,74 km do bairro com o mesmo comprimento |

Pendências:
- Ler o perímetro urbano de Ibiporanga na LC 7/2009 (Siscam, Documento/19886) e trocar o polígono aproximado.
- O Anel Viário Antonio Quile Rubio não tem nome no OSM. A rota de desvio usa as vias sem nome a leste do bairro.

## 3554003 Tatuí — `tatui`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| tatui_municipio_16t_cadastro | ativa (média) | Dec. 21.381/2021, arts. 1º, 2º, 3º–6º e 9º | 24 h | PBT > 16 t (sem ACC) | zona: município (IBGE) sem SP-127/BR-373, SP-129, SP-141 e SP-280/BR-374 (folga de 40 m), 9 partes (`geo/3554003_municipio.geojson`) | evita: norte → sul, ambos fora de Tatuí, truck de 23 t: 60,2 km e 0 km na zona; o toco de 16 t corta 2,2 km (51,6 km). Passagem por rodovia (4 rotas) com 0 km |
| tatui_zrc_area_central | desativada (baixa) | Dec. 9.449/2009, arts. 1º–3º, 5º e 7º | — | — | sem geometria (portaria da CEMTRAN/DMU não localizada) | — |
| tatui_vias_placas_proibido_caminhoes | desativada (baixa) | Ofícios 171/DMU/2024, 518/DMU/2025 e 041/DMU/2024 | 24 h | todo caminhão | sem geometria (trecho sinalizado não informado) | — |
| tatui_estacionamento_onibus_caminhoes_1978 | desativada (média) | Lei 1.441/1978, arts. 1º–3º | — | — | sem geometria (regra de estacionamento) | — |

Pendências:
- A ACC (cadastro) não está no perfil do veículo. O caminhão acima de 16 t com origem ou destino em Tatuí recebe o aviso
  de origem ou destino na zona, sem desvio.
- Pedir ao DMU a portaria das ZRC (perímetro e horários) e o ato das vias sinalizadas. A Marginal do Ribeirão Manduca
  não tem nome no OSM.

## 3554102 Taubaté — `taubate`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| taubate_praca_dom_epaminondas | ativa (média) | Lei 768/1964, art. 1º e parágrafo único | 24 h | todo caminhão; carga e descarga isenta | só a way 214344458 ("Praça Dom Epaminondas", ~63 m, correção do verificador) | sem_alternativa: origem na Rua Sacramento, que só sai pela praça (a continuação é calçadão), destino em Tremembé, toco: 0,08 km na praça, e a rota avisa |
| taubate_ruas_centrais_1964 | desativada (baixa) | Lei 768/1964, art. 1º | 24 h | todo caminhão | sem geometria ("ruas centrais" não definidas) | — |
| taubate_entrega_varejo_22h_7h | desativada (baixa) | LC 7/1991, arts. 733 e 738 | 7h–22h | todo caminhão | sem geometria (regra de destino sem área) | — |

Pendência: a praça tem ~63 m e o roteador só a usa quando ela é a única saída. Não há caso "evita" possível.

## 3556206 Valinhos — `valinhos`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| valinhos_artc | ativa (média) | Dec. 12.123/2024, arts. 5º, 6º, 7º, 9º e 10, Anexo I (red. Dec. 12.264/2024) | VCL: seg–sex 10h–18h, sáb e dom a partir das 9h; acima do VCL: 24 h | todo caminhão | 14 dos 19 logradouros do Anexo I pelo nome; R. Treze de Maio só até a Av. dos Esportes | evita: Av. Paulista → R. Campos Salles, VCL (7 t, 7 m, 2 eixos), 11h: 4,5 km e 0,03 km; 20h: 2,1 km nas vias |
| valinhos_anexo4_vcp_vcpb | ativa (média) | Dec. 12.123/2024, arts. 6º, III e 7º, II, Anexo IV, a)–c) | 7h–9h e 16h–19h, todos os dias | PBT > 7,99 t, comprimento > 7,20 m ou mais de 2 eixos | Av. Joaquim Alves Corrêa, Av. Dr. Antônio Bento Ferraz e Estrada do Jequitibá (R. Ezequiel → Clube de Campo) | evita ×2, toco: Joaquim Alves Corrêa às 8h (0,04 km; 5,0 km às 11h); Jequitibá às 17h (23,4 km de volta; 6,9 km às 11h) |
| valinhos_anexo4_pontos_dec12264 | desativada (média) | Dec. 12.264/2024, art. 2º | picos | acima do VCL | sem geometria ("próximo ao nº") | — |
| valinhos_vcpb_fora_vtcp | desativada (média) | Dec. 12.123/2024, arts. 5º, III, 9º e 10, II | 24 h | caminhão + reboque, CVC | limite do município (registro) | — |
| valinhos_vcpt | desativada (alta) | Dec. 12.123/2024, arts. 5º, IV e 10, §1º | 24 h | CVC | limite do município (registro) | — |
| valinhos_perigosos_aetc | desativada (alta) | Dec. 12.123/2024, art. 10, III | 24 h | — | sem geometria (assunto da camada de perigosos) | — |

Pendências:
- Cinco logradouros do Anexo I não estão no OSM com esse nome: Largo São Sebastião, Praça Angelina Aparecida Pazinato
  Matiazzo, Praça José Ferraro, Praça São Sebastião e Rua Dona Rosina Zagatti Celani. A "Av. Dr. Heitor Penteado" é a
  "Rua Doutor Heitor Penteado" no OSM. A "Rua Heitor Penteado" homônima, que é a SP-332, ficou de fora.
- A Rua Campos Salles e a Rua Antônio Carlos entraram em toda a extensão (a Campos Salles segue ~2,5 km a noroeste do
  Centro).
- Na Av. Dr. Antônio Bento Ferraz, um sentido de um pedaço não casou com o grafo do Valhalla e foi descartado.
- Para a SMU: o art. 9º, II contradiz o Anexo IV (o VCP só nas VTCP). Falta também a hora de reabertura no fim de semana
  da ARTC.

## 3556701 Vinhedo — `vinhedo`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| vinhedo_dec83_2008_acima_2_eixos | ativa (média) | Dec. 083/2008, arts. 1º (I–X e parágrafo único), 2º, 4º e 7º | 24 h | mais de 2 eixos; carga e descarga no município isenta | 9 logradouros pelo nome, cada um inteiro dentro de Vinhedo, aproximado | evita: Centro → Valinhos, carreta: 5,4 km e 0 km (Av. Independência, R. Afonso Garbuio); o toco usa 2,9 km |

Pendências:
- A "Rua Roma" (inc. V) ficou de fora. O nome aparece só como alt_name da Rua Carolina Von Zuben, que já entra pelo
  inc. VI, e há uma "Avenida Roma" em outro bairro.
- A "Rua Antonio Bucci" (inc. IV) não está no OSM. Usei a way 146935871 ("Rua Duílio Beltramini", alt_name "Avenida
  Antônio Bucci"), o que é uma inferência.
- A Estrada da Boiada (inc. III) inclui o trecho com ref SP-332, e a Av. Aparecida Tellau Seraphin (inc. X, a Variante)
  tem ref SP-330/SP-332. As duas entram porque o decreto as nomeia. Um sentido de um pedaço da Variante não casou com o
  grafo e foi descartado.
- A exceção dos veículos licenciados em Vinhedo (art. 2º, VI) não é modelável e só aparece no aviso.

## 3556909 Vista Alegre do Alto — `vista-alegre-do-alto`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| vista_alegre_do_alto_vias_centrais_pesados | ativa (média) | Lei 1.577/2009, arts. 1º–4º | 24 h | semirreboque/CVC **e** mais de 3 eixos (correção do verificador); carga e descarga isenta | 5 trechos do art. 2º recortados das ways entre as transversais (`geo/3556909_vias.geojson`, script de curadoria) | evita: norte da cidade → Monte Alto, carreta: 20,9 km e 0 km; o toco usa 0,54 km (R. Herculino do Livramento) |

Pendências:
- A R. João Ricardo de Mello não cruza a R. Inocêncio de Paula Eduardo no OSM (são paralelas). Foi aplicada da Av.
  Milton até a ponta norte, como aproximação.
- Nomes que diferem no OSM: Herculino (Herculano), Jeremias de Paula (de Paulo), Av. Dezoito de Fevereiro, Av. Milton H
  Yekashi. O cavalo desacoplado com 2 ou mais eixos (art. 4º) não é representável.

## 3557006 Votorantim — `votorantim`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| votorantim_res004_2022_eixos | ativa (alta) | Res. 004/2022-SEMOB, arts. 1º–5º e 9º | 6h–22h, todos os dias | mais de 2 eixos | Av. 31 de Março (Praça Rotary → Acesso 103, as duas pistas), Av. Gisele Constantino e Av. Rogério Cassola | evita ×2, carreta, 10h: 31 de Março com 0,03 km (0,5 km às 23h); Gisele/Rogério com 10,9 km de volta e 0,03 km (3,3 km às 23h) |
| votorantim_res004_2022_outras_vias_sinalizadas | desativada (baixa) | Res. 004/2022-SEMOB, art. 1º (parte final) | 6h–22h | mais de 2 eixos | sem geometria (vias não nomeadas) | — |
| votorantim_rotativo_carga_descarga_dec5798_2019 | desativada (baixa) | Dec. 5.798/2019, art. 8º | — | — | sem geometria (carga e descarga do rotativo) | — |

Pendências:
- A Av. 31 de Março tem ref SPA-103/079;BR-478 no OSM e entra porque a resolução a nomeia. As pontas são estimadas. A
  pista sentido sul foi refeita pela malha do Valhalla, e mesmo assim pedaços do meio das duas pistas (~200 a 400 m)
  não casaram com o grafo e foram descartados. A rota desvia porque as entradas e saídas das duas pistas estão
  cobertas.

## 3557105 Votuporanga — `votuporanga`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| votuporanga_amazonas_santa_catarina | ativa (alta) | Lei 4.758/2010, art. 14 (red. Lei 6.205/2018, art. 1º, IV) | seg–sex 8h–18h, sáb 8h–13h | todo caminhão | R. Amazonas (Itacolomi → Paraíba) e R. Santa Catarina (Amazonas → Pernambuco), pela malha do Valhalla | evita: R. Amazonas, toco, 9h: 1,7 km e 0 km; às 19h usa 0,9 km |
| votuporanga_centro_lei1568 | ativa (média) | Lei 1.568/1976, arts. 1º e 2º | seg–sex 10h–18h, sáb 7h–12h | capacidade de carga > 1,75 t | R. Amazonas, R. São Paulo e R. Pernambuco, da Tibagi à Acre (Pernambuco = recorte da way 722021045) | evita: R. São Paulo, toco, 11h: 2,5 km e 0,02 km; às 19h usa 1,5 km |

Pendência: conferir a sinalização R-9 nas três ruas. O diagnóstico do Plano de Mobilidade de 2017 descreve outra
extensão (Tibagi–Alagoas) e outro horário (8h–18h).

## 3500402 Águas da Prata — `aguas-da-prata`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| aguas_da_prata_fds_feriados_tara_5t | ativa (média) | Dec. 2.799/2019, arts. 1º–5º (red. Dec. 2.800/2019); Lei 2.321/2019, art. 1º | sáb e dom 6h–20h; feriados aplica | PBT > 5 t (o ato fala em tara: lado seguro); VUC 2,20 × 6,30 m isento; entrega no perímetro urbano isenta | zona: município (IBGE) sem a SP-342 e a SP-215/BR-267 (folga de 40 m), 3 partes (`geo/3500402_municipio.geojson`) | evita: SP-342 no centro → norte, fora do município, toco: sábado às 10h com 38,8 km e 0 km; terça usa 1,1 km de estrada municipal. Passagem pela SP-342/SP-215 com 0 km |
| aguas_da_prata_cascata_rurais_cvc_30t | desativada (baixa) | Dec. 2.310/2012, arts. 1º, 2º, 5º e 6º | 24 h | CVC ou PBT ≥ 30 t | sem geometria (vias não conferidas no OSM) | — |

Pendências:
- A travessia urbana da SP-342 (Av. Washington Luís, Av. Cel. Ernesto de Oliveira) ficou livre pelo art. 2º. O guia Pé
  na Estrada cita a Av. Washington Luís como restrita, então é preciso conferir a sinalização.
- A janela cobre sábado e domingo. Um feriado em dia útil não fica coberto (limitação do formato).
- Tara não é campo do veículo, por isso usei PBT > 5 t, que pega também caminhões leves.

## 3500600 Águas de São Pedro — `aguas-de-sao-pedro`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| aguas_de_sao_pedro_boulevard_fechado | ativa (média) | Dec. 6.452/2025, arts. 2º, 4º, §2º e 10 | 24 h | todo caminhão | calçadão do Boulevard (ways 168980283 e 168980280, ~200 m, embutido) | sem caso (ver pendência) |
| aguas_de_sao_pedro_lei1606_veiculos_pesados_zona_urbana | desativada (baixa) | Lei 1.606/2011 (red. Lei 1.666/2013): só a ementa | — | — | sem geometria | — |
| aguas_de_sao_pedro_lei1172_carlos_moura_joao_batista | desativada (baixa) | Lei 1.172/1999: só a ementa | — | — | sem geometria ("Av. Carlos Moura" não identificada no OSM) | — |
| aguas_de_sao_pedro_lei1922_viela_adutora | desativada (baixa) | Lei 1.922/2020: só a ementa | — | — | sem geometria (provável "Rua das Adutoras", não confirmada) | — |

Pendências:
- O Boulevard já é `highway=pedestrian` no OSM e o roteador nunca o usa, com ou sem a regra. Por isso não há caso
  "evita" que prove algo. As ways residenciais com o mesmo nome a oeste não são o calçadão e não entram.
- Ler o texto das Leis 1.172/1999, 1.606/2011, 1.666/2013 e 1.922/2020 (o Legislação Digital dá 403).
