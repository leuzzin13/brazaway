# mun_sudeste — lote IMP10 (11 municípios de SP)

Matão, Meridiano, Nova Aliança, Olímpia, Ourinhos, Parapuã, Pardinho, Paulicéia, Penápolis, Piedade e Pindamonhangaba, na
camada genérica `restricoes_rmsp` (`data/raw/municipios/<ibge>.json`; formato em
[`../../restricoes_municipais.md`](../../restricoes_municipais.md)). As regras vêm de
`docs/research/cidades_sudeste/res/<ibge>.json` com as correções de `verif/<ibge>.json` (verificação de 11/10/2026), que
prevalecem.

Resumo: **14 regras ativas** em 11 municípios (8 zonas, 6 vias), **11 desativadas** e **1 revogada**. Os casos de rota foram
conferidos na API real (`localhost:3000`) e gravados em `api/test/fixtures/mun_sudeste/<ibge>.json`: 14 casos, todos
"evita" (nenhuma via restrita é a única ligação). Todos passam em
`API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"` e no bloco "carga e registro"
(12/10/2026). Datas usadas: terça 13/10/2026 e quarta 14/10/2026 de madrugada.

## Como a geometria foi feita

- **Vias** (`construir: "trechos"`): os nomes são os do OSM, tirados do cache `data/cache/municipios/osm_named_<ibge>.json`
  e, para o que o cache não tem, de um extrato do PBF local (`data/valhalla/sudeste-latest.osm.pbf`). Os GeoJSON de vias
  foram gerados pelo import. As pendências que sobraram estão listadas em cada município.
- **PRP-138 de Parapuã** (`construir: "manual"`): os ways do OSM não têm nome, só `ref=PRP-138`, e por isso não casam
  pelo nome. Peguei os ways com essa ref no PBF e recortei no limite do IBGE.
- **Perímetro urbano / núcleo sem polígono no ato** (Meridiano, Nova Itapirema, Olímpia, Pindamonhangaba, Ninho Verde II):
  é a união dos setores censitários do IBGE 2022, sem furos e simplificada a ~5 m. As rodovias de outra jurisdição foram
  recortadas com folga de 40 m. A zona é marcada como aproximada e a confiança fica média. Scripts em
  `data/raw/municipios/geo/<ibge>_*_curadoria.py` (rodar com `<shapefile SP_setores_CD2022> data/cache/municipios/osm_named_<ibge>.json`).
- **Áreas centrais descritas por ruas** (Matão, Ourinhos, polígono da Lei 5.073 de Olímpia): polígono sobre os eixos do OSM
  entre os cruzamentos do ato. Na rota ele é recuado 20 m, o que deixa livres as ruas do contorno.
- **Desativada sem área definida**: `{"geojson": FeatureCollection vazia}`. Fica no arquivo, mas não vai para o banco nem
  para o `regras` da fixture.
- **Import**: rodei `municipios:<ibge>` com `MUNICIPIOS_DIR` apontando só para o arquivo do município. A malha do IBGE já
  estava no cache.
- **Medida dos casos**: "km na regra" é o trecho da rota a até 10 m das linhas da via ou dentro do polígono recuado 20 m,
  que é o que o teste mede.

---

## 3529302 Matão (`matao`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `matao_area_azul_carga_4t` | ativa (média) | Dec. 5.386/2022, art. 6º (área: art. 2º e § 1º); Dec. 5.785/2025 (só tarifa) | seg–sex 9h–18h, sáb 9h–13h; feriados aplica | PBT acima de 4 t | `geo/3529302_area_azul.geojson`: área do SERPMAT, aproximada | evita, toco, norte → sul do centro: terça 10h dá 2,42 km e 0 km na zona; às 20h (fora da janela) dá 2,38 km e 0,16 km nela |

Pendências:
- O perímetro-base vem da Lei 1.089/1980 e do Dec. 4.872/2015, que não foram lidos porque o Legislação Digital está atrás
  do Cloudflare. Ele foi tirado da página oficial "Área Azul" de 2015. Os limites (Av. São Lourenço, R. Cesário Mota) ficam
  livres.
- O art. 5º (horário de carga e descarga) é regra de estacionamento e não foi modelado.

## 3529609 Meridiano (`meridiano`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `meridiano_perimetro_urbano_5_eixos` | ativa (média) | Lei 1.567/2024, arts. 1º–3º | 24 h | 5 eixos ou mais; exceção de entrega local | `geo/3529609_meridiano_perimetro_urbano.geojson`: setores urbanos do IBGE 2022 | evita, carreta, sul → norte com destino fora do município: 26,5 km e 0 km na zona; o truck de 3 eixos atravessa a cidade (23,3 km, 0,8 km na zona) |
| `meridiano_vias_usinas_lei1055` | **revogada** | Lei 1.055/2014; revogada pela Lei 1.066/2014, art. 1º | — | — | `geo/3529609_meridiano_vias_lei1055.geojson` (registro) | — |
| `meridiano_povoado_ruas_a_d_lei1082` | desativada (média) | Lei 1.082/2015, art. 1º | 24 h | carretas e bitrens | vazia | — |

Pendências:
- Lei 1.082/2015: "Rua A" e "Rua D" do povoado não dá para localizar pelo nome. Precisa de croqui ou de conferência em
  campo.

## 3532801 Nova Aliança (`nova-alianca`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `nova_alianca_nova_itapirema_canavieiros` | ativa (média) | Lei 35/2020, art. 1º (red. Lei 21/2021) | 24 h | canavieiro, modelado como caminhão com reboque ou CVC | `geo/3532801_nova_alianca_nova_itapirema.geojson`: setores urbanos do distrito, sem a SP-355 | evita, bitrem, oeste → leste: 25,5 km e 0 km na zona; o truck cruza pela R. XV de Novembro (3,4 km, 0,8 km na zona). Pela SP-355, sul → norte, o bitrem anda 9,6 km sem desvio |
| `nova_alianca_vinhaca` | desativada (média) | Lei 41/2020, art. 1º | 24 h | carga de vinhaça | vazia | — |

Pendências:
- "Canavieiro" é tipo de carga. A modelagem por classe (reboque/CVC) é uma aproximação.
- A vinhaça é restrição por carga e não é representável no perfil do veículo.

## 3533908 Olímpia (`olimpia`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `olimpia_lei5073_vias` | ativa (média) | Lei 5.073/2025, arts. 1º e 3º, I–III | 24 h | mais de 2 eixos **e** PBT acima de 8 t (correção do verificador) | `geo/3533908_vias.geojson`: Av. Mário Vieira Marcondes (sentido único), Av. Aurora Forti Neves, Av. Benatti | evita, truck, quarta 3h: 8,9 km e 0 km nas vias; o utilitário anda 1,4 km na Av. Benatti |
| `olimpia_lei5073_poligono` | ativa (média) | Lei 5.073/2025, art. 3º, IV e parágrafo único | 24 h | idem | `geo/3533908_poligono_lei5073.geojson` | evita, truck, quarta 3h, oeste → leste: 3,0 km e 0 km; o utilitário passa 0,65 km dentro |
| `olimpia_dec9709_perimetro_urbano` | ativa (média) | Lei 5.168/2025, art. 1º; Dec. 9.709/2025, arts. 1º–3º | 5h–24h todos os dias | articulado ou PBT acima de 10 t | `geo/3533908_perimetro_urbano.geojson`: setores urbanos do IBGE 2022, sem as rodovias e estradas de acesso | evita, toco, norte → sul: terça 10h dá 25,7 km e 0 km na zona; quarta 3h (fora da janela) dá 16,1 km e 3,2 km nela. Passagem oeste → leste pelas rodovias: 24,1 km, sem tocar a zona |

Os casos das duas regras da Lei 5.073 são de madrugada (3h), para isolar essas regras da janela do perímetro urbano.

Pendências:
- Perímetro urbano sem delimitação no ato.
- As "vias de acesso secundário" liberadas a caminhões leves e médios (Dec. 9.709, art. 3º, § 1º) não estão definidas, e
  o caminhão de carga comum do art. 3º, II, não foi modelado.
- A altura máxima de 4 m (art. 3º, § 2º) não foi modelada.

## 3534708 Ourinhos (`ourinhos`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `ourinhos_area_central_pbt12` | ativa (média) | Dec. 6.078/2011, art. 3º e parágrafo único | 24 h | PBT acima de 12 t | `geo/3534708_area_central.geojson`: quadrilátero R. São Paulo / R. Paulo Sá / R. Rio de Janeiro / R. Euclides da Cunha | evita, toco, oeste → leste: 3,5 km e 0 km na zona; o utilitário corta o centro (2,1 km, 0,7 km) |
| `ourinhos_area_central_carga_descarga` | desativada (média) | Dec. 6.078/2011, arts. 4º e 5º | 9h–18h | caminhão | vazia | — |
| `ourinhos_perigosos_combustiveis` | desativada (média) | Dec. 6.078/2011, arts. 1º, 2º, 7º, 8º | 24 h | carga perigosa | vazia | — |

Pendências:
- A carga e descarga é regra de operação, não de circulação.
- A regra de produtos perigosos deve ir para a camada `perigosos`, com a outra frente.

## 3536000 Parapuã (`parapua`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `parapua_prp138_carretas_7_eixos` | ativa (média) | Lei 3.247/2025, art. 1º e parágrafo único; art. 9º | 24 h | 7 eixos ou mais | `geo/3536000_vias.geojson` (manual): ways `ref=PRP-138` do OSM, ~12 km, do limite com Bastos até a SP-425/SP-294, recortados no limite do IBGE | evita, bitrem, ponta sul (lado de Bastos) → entrada de Parapuã: 34,0 km e 0 km na PRP-138; a carreta de 5 eixos segue por ela (14,7 km, 12,6 km nela) |
| `parapua_av_sao_paulo_estacionamento` | desativada (média) | Dec. 3.202/2002, art. 1º | — | caminhão (estacionamento) | vazia | — |

Pendências:
- **Nome no OSM**: a PRP-138 não tem `name` no OSM, e o nome do ato (Carlos Adalberto Massaroti) não aparece.
- **Continuação até Rinópolis**: a lei fala em "toda a extensão (Bastos, Parapuã e Rinópolis)". Ao norte da cidade, o
  OSM só tem a "Estrada Vicinal RNP-040" (ref de Rinópolis, de terra, ~4 km em Parapuã), que ficou fora por não haver
  prova de que é a mesma estrada. Os trechos em Bastos e Rinópolis estão fora da jurisdição municipal.
- O desvio do bitrem no caso de teste passa por uma via restrita de Bastos (BAS-050, de outro lote), por isso o aviso
  `rmsp_via_restrita_na_rota` aparece.

## 3536109 Pardinho (`pardinho`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `pardinho_ninho_verde_ii` | ativa (média) | Lei 1.488/2022, art. 1º e parágrafo único; art. 3º | 24 h | mais de 3 eixos | `geo/3536109_ninho_verde_ii.geojson`: 4 setores do IBGE 2022 do núcleo urbano "Ninho Verde" (CD_SIT 3), sem a SP-280; aproximado | evita, carreta, norte → sul: 42,7 km e 0 km na zona; o utilitário corta o loteamento (11,1 km, 2,8 km). A passagem oeste → leste pela Castelo Branco (8,1 km) não toca a zona |

Pendências:
- O IBGE não separa as glebas. Os setores "Ninho Verde" de Pardinho foram tomados como a Gleba II, sem mapa do ato.
- O texto é ambíguo e pode alcançar qualquer caminhão. Ficou o recorte seguro de eixos > 3, como decidiu o verificador.
- A exceção de carga e descarga no loteamento é coberta pela política da zona: origem ou destino dentro dela não é
  excluído e gera aviso.
- O loteamento tem portaria (art. 4º). Na prática, a passagem por dentro talvez já não exista para quem é de fora.

## 3536406 Paulicéia (`pauliceia`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `pauliceia_av_paulista_grande_porte` | ativa (média) | Lei 270/2021, art. 1º, § 2º, II e III; art. 2º e § 1º | 24 h | PBT acima de 10 t ou conjugado | `geo/3536406_vias.geojson`: Av. Paulista inteira (~4,4 km) | evita, toco, oeste → leste ao norte da avenida: 9,9 km e 0 km nela; o utilitário anda 3,9 km nela (5,6 km) |

Pendências:
- O decreto de sinalização (art. 1º, § 1º) não foi localizado.
- "Conjugado" foi modelado como semirreboque, reboque ou CVC.

## 3537305 Penápolis (`penapolis`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `penapolis_zona_azul_caminhoes` | ativa (alta) | Dec. 7.789/2024, art. 5º; Lei 2.872/2023, art. 16 | 24 h | caminhão (VUC local: 2,20 x 7,20 m e PBT 3 t, abaixo do limite de caminhão) | `geo/3537305_vias.geojson`: 11 dos 12 trechos do art. 16 | evita, toco, nordeste → sudoeste do centro: 2,3 km e 0 km nas vias; o utilitário vai pela Av. Manoel Bento da Cruz (2,0 km, 0,76 km) |
| `penapolis_zona_azul_carga_descarga` | desativada (alta) | Dec. 7.789/2024, art. 4º | — | vagas de carga e descarga | vazia | — |
| `penapolis_canavieiros_safra_2007` | desativada (alta) | Dec. 2.711/2007, art. 1º | — | safra 2007/2008, caducado | vazia | — |

Pendências:
- **Item 9, "Rua São Francisco" (entre a Av. Rui Barbosa e a Av. Luiz Osório)**: não existe no OSM, nem no cache nem no PBF.
  As transversais dessas avenidas no OSM não incluem nenhuma "São Francisco". O trecho ficou fora e está registrado em
  `pendencias` no GeoJSON.
- Grafias do OSM: "Rua Quinza de Novembro" (o ato diz Quinze), "Avenida Manoel Bento da Cruz" e "Avenida Luiz Osório".

## 3537800 Piedade (`piedade`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `piedade_centro_vias_caminhoes` | ativa (alta) | Dec. 7.341/2018, art. 1º, I–VIII; arts. 2º e 4º | 24 h | caminhão (VUC até 5,50 m e VLC até 6,30 m, largura 2,20 m, isentos) | `geo/3537800_piedade_centro_vias.geojson`: 7 das 8 vias | evita, toco, noroeste → sudeste do centro: 1,14 km e 0 km nas vias; o utilitário passa 0,77 km nelas |
| `piedade_carga_descarga_combinacoes` | desativada (alta) | Dec. 7.341/2018, art. 3º | 8h–20h | combinações (carga e descarga) | vazia | — |

Pendências:
- **Inciso VII, "Rua Capitão Loureiro"**: não existe no OSM, nem no cache nem no PBF. Só há "Rua Antônio Loureiro" (2 nós,
  junto ao Calçadão), e não dá para afirmar que é a mesma via. Ficou fora e está registrado em `pendencias`.
- A R. Capitão Moraes (SP-250) não está no ato e continua livre.

## 3538006 Pindamonhangaba (`pindamonhangaba`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `pinda_zrtc_vcp` | ativa (média) | Dec. 5.635/2019, arts. 2º, 5º, 8º; Anexo I | 24 h | VCP: PBT acima de 7,99 t, mais de 7,2 m ou mais de 2 eixos | `geo/3538006_zrtc.geojson`: setores urbanos do IBGE 2022, sem a Via Dutra, os corredores das RLCP e as rodovias SP-062, SP-132 e BR-383 (folga mínima de 40 m), 613 vértices em 19 partes (eram 986; simplificada para dentro, a 15 m antes e depois do recorte, em 12/10/2026) | evita, toco, norte → sul: 29,5 km e 0 km na zona (era 26,4 km antes da simplificação: a zona ficou um pouco menor e o contorno mais rápido é 3 km mais longo); o utilitário atravessa (23,7 km, 2,3 km). A passagem pela Dutra (Taubaté → Roseira, 43,0 km) não toca a zona |
| `pinda_rccp_anel_viario_rua_suica` | ativa (média) | Dec. 5.635/2019, arts. 2º, III e 4º; Anexo I, Rotas 03.1 e 04 | 24 h | todo caminhão (VCL incluído pela letra do art. 4º) | `geo/3538006_rccp.geojson`: 6 vias | evita, caminhão leve (7 t, 7 m, 2 eixos, fora da ZRTC), sul → norte pelo Anel Viário: 15,5 km e 0 km nas vias; o utilitário usa 1,5 km (2,3 km) |
| `pinda_vcpb_rotas_aetc` | desativada (baixa) | Dec. 5.635/2019, art. 6º | 24 h | VCPB | vazia | — |
| `pinda_perigosos_aetc` | desativada (média) | Dec. 5.635/2019, art. 7º | 24 h | carga perigosa | vazia | — |
| `pinda_estradas_rurais_sapucaia` | desativada (unverifiable) | só notícia (19/09/2019) | — | — | vazia | — |

Pendências:
- O perímetro urbano da LC 3/2006 não foi lido. A zona é aproximada pelos setores do IBGE.
- O limite de 7,99 t foi tratado como PBT.
- A Prefeitura (notícia de 2019) diz que o VCL circula livre nas RCCP, mas a letra do art. 4º exige AETC. Ficou o lado
  seguro, com aviso.
- O desvio de 15,5 km do caso das RCCP é real: a camada mantém o Anel Viário proibido para todo caminhão sem AETC.

---

## Observações gerais

- Não há caso "sem_alternativa" neste lote: toda via ou zona testada tem rota alternativa.
- Este lote não alterou o importador, a API nem os testes. O lote anterior começou Matão, Meridiano, Nova Aliança, Olímpia,
  Ourinhos, Paulicéia e Pindamonhangaba: foram conferidos, ganharam fixture, e Meridiano foi reimportado depois de um
  ajuste de texto (a "Rua G" saiu do motivo da regra desativada, como mandou o verificador). Parapuã, Pardinho, Penápolis e
  Piedade foram terminados e importados agora.
