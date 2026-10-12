# mun_sudeste — lote IMP09 (11 municípios de SP)

Itapira, Itararé, Itatiba, Itápolis, Jaú, Leme, Limeira, Lins, Lourdes, Maracaí e Marília entram na camada genérica
`restricoes_rmsp` (`data/raw/municipios/<ibge>.json`). O formato está em [`../../restricoes_municipais.md`](../../restricoes_municipais.md).
As regras vêm de `docs/research/cidades_sudeste/res/<ibge>.json`, com as correções de `verif/<ibge>.json` (verificação de
11/10/2026), que prevalecem.

Resumo: **13 regras ativas** em 10 municípios (6 zonas e 7 vias), **14 desativadas** e **3 revogadas**. Jaú ficou sem regra
ativa, porque o veredito da verificação foi "inverificável". Conferi 13 casos de rota na API real (`localhost:3000`), todos
"evita", e gravei em `api/test/fixtures/mun_sudeste/<ibge>.json`. Todos passam em
`API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"` (12/10/2026), assim como os testes
de carga e registro. Usei a terça 13/10/2026.

## Como a geometria foi feita

- **Vias** (`construir: "trechos"`): os nomes são exatamente os do OSM, tirados do cache `data/cache/municipios/osm_named_<ibge>.json`.
  Os que o cache não tem (praças, rios, parques) foram procurados num extrato do PBF local (`data/valhalla/sudeste-latest.osm.pbf`).
  O import gerou `geo/<ibge>_vias.geojson` com `pendencias` vazias em todos os municípios.
- **Via com um só way no OSM** e trecho com `de`/`ate` (o `linemerge` do importador quebra com uma linha só): as pontas viram
  `{"lonlat"}` nos cruzamentos do ato, 5 m para dentro, com `caminho: "valhalla"`, `corredor_m: 25` e `sentido: true` na mão
  única. Se o trecho é o way inteiro, tirei `de`/`ate`. Nos dois casos, a nota do trecho diz o que foi feito. Isso vale para Leme
  (8 trechos), Limeira (6), Marília (5) e Jaú (1). Conferi o comprimento de cada trecho contra a distância entre os cruzamentos.
- **Perímetro urbano sem polígono no ato** (Itapira, Itararé, Lins e Lourdes): a zona é a união dos setores censitários urbanos do
  IBGE 2022 (`CD_SIT` 1 e 2) do distrito-sede, sem furos. As rodovias livres foram recortadas com folga de 40 m. A zona é marcada
  como aproximada e a confiança fica média. O script de cada uma está em `data/raw/municipios/geo/<ibge>_*_curadoria.py`.
- **Quadrilátero de Itatiba**: o polígono foi desenhado 30 m por fora dos eixos das quatro ruas-limite do OSM. Assim, o recuo de
  20 m da camada não libera essas ruas, que o ato inclui.
- **Desativada ou revogada sem área definida**: `{"geojson": FeatureCollection vazia}`. Fica no arquivo, mas não vai para o banco
  nem para o `regras` da fixture.
- **Import**: rodei `municipios:<ibge>` com `MUNICIPIOS_DIR` apontando só para o arquivo do município. A malha do IBGE já estava no
  cache.
- **Medida dos casos**: "km na regra" é o trecho da rota a até 10 m das linhas da via ou dentro do polígono recuado 20 m, como mede
  o teste. Quando a rota só cruza uma via restrita, conta cerca de 20 m por cruzamento.
- **Contraste sem janela**: nas regras de 24 h não existe horário fora da janela. Nelas, comparei com um veículo não atingido
  (3 t ou um caminhão com menos eixos) e anotei o resultado na nota do caso.

---

## 3522604 Itapira (`itapira`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `itapira_area_urbana_acima_12m` | ativa (média) | Lei 5.066/2013, art. 2º; Dec. 089/2013, art. 1º, §§ 1º e 2º | 24 h | comprimento acima de 12 m | `geo/3522604_area_urbana.geojson`: setores urbanos do IBGE 2022, sem a SP-147 e a SP-352 | evita, carreta, da SPI-177/342 (noroeste) para a SP-147 (leste): 0 km na zona, 17,7 km |
| `itapira_area_urbana_6_30_a_12m` | ativa (média) | Lei 5.066/2013, art. 3º | todos os dias 0h–7h, 9h–18h e 20h–24h | comprimento de 6,30 m a 12 m | mesma zona | evita, truck (12 m), mesmo par: às 10h, 0 km (17,7 km); às 8h, 1,8 km na zona (15,5 km) |
| `itapira_carga_descarga_vagas` | desativada (média) | Lei 5.066/2013, arts. 9 a 14 | — | — | vazia | — |

Pendências:
- As rotas permitidas do Dec. 089/2013 aparecem só como exceção no texto. A zona não abre corredores dentro da área urbana.
- A área urbana é aproximada pelos setores do IBGE.

## 3523206 Itararé (`itarare`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `itarare_lei4363_2023_caminhoes_6t` | ativa (média) | Lei 4.363/2023, arts. 1º a 5º; Lei 4.590/2025, art. 1º (vigência em 01/01/2026) | 24 h | PBT acima de 6 t; exceção de entrega no município | `geo/3523206_vias_urbanas.geojson`: setores urbanos do IBGE 2022, sem a SP-258, a SP-281, a SP-259 e a PR-239 | evita, toco, da Via Paulo Ferreira para Sengés (PR): 0 km (18,2 km). Um veículo de 3 t passa 0,26 km na zona (15,2 km) |
| `itarare_portaria001_2018_vicinais_rurais` | desativada (baixa) | Portaria 001/2018-DEMUTRAN, arts. 1º e 2º | — | — | vazia: o ato não nomeia as estradas | — |

Pendências:
- A zona é aproximada.
- Com a exceção de entrega local, a regra só pega quem passa pela cidade. Por isso o caso de rota tem destino fora do município.

## 3523404 Itatiba (`itatiba`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `itatiba_centro_quadrilatero` | ativa (média) | Lei 2.455/1993, art. 1º (redação da Lei 4.635/2014); Lei 5.789/2025, art. 1º; Lei 5.022/2017 (VUC) | seg–sáb 10h–18h; feriados aplica | todo caminhão; VUC de 2,20 m x 6,30 m isento com cadastro | `geo/3523404_quadrilatero.geojson`: eixos das 4 ruas-limite do OSM, 30 m por fora | evita, truck, da Av. Independência ao fim leste da R. Benjamin Constant: às 11h, 0 km (1,8 km); às 19h, 0,47 km (1,4 km) |
| `itatiba_av_nossa_senhora_das_gracas` | ativa (média) | Dec. 4.999/2004, art. 1º | 24 h | todo caminhão (o ato fala em tara acima de 3,5 t; ficou o lado seguro) | `geo/3523404_vias.geojson`: a avenida inteira, cerca de 8 km | evita, truck, de ponta a ponta: 0 km (12,2 km). Um veículo de 3 t usa 8,1 km da avenida (8,9 km) |
| `itatiba_rua_eloi_franco_penteado` | **desativada** (média) | Dec. 7.065/2018, arts. 1º a 3º | 24 h | caminhões e carretas | vazia | — |
| `itatiba_carga_descarga_centro_expandido` | desativada (média) | Lei 4.635/2014, art. 2º, parágrafo único | — | — | vazia | — |

Pendências:
- **Rua Eloi Franco Penteado**: o ato está vigente e foi confirmado, mas a rua não existe no OSM (nem com Eloy, `alt_name` ou
  `old_name`). A regra fica desativada até a via ser mapeada.
- A pesquisa contava 3 regras ativas em Itatiba. Ficaram 2.

## 3522703 Itápolis (`itapolis`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `itapolis_tarquino_bellentani` | ativa (média) | Dec. 3.065/2000, arts. 1º, I a III, 2º e 3º | 24 h | comprimento acima de 10 m, largura acima de 2,10 m ou PBT acima de 6 t; exceção de destino local | `geo/3522703_vias.geojson`: Av. Prefeito Tarquino Belentani inteira (grafia do OSM, cerca de 4,9 km de pista dupla) | evita, truck, do sul da sede para Santa Adélia: 0 km (52,8 km). Um veículo de 3 t usa 4,8 km da avenida (49,7 km) |
| `itapolis_ips020_theodolinda_benaglia` | desativada (média) | Dec. 3.069/2000, arts. 1º a 3º | 24 h | idem | vazia | — |

Pendências:
- A IPS-020 (Rod. Theodolinda Benaglia) não tem nome nem `ref` no OSM. Identificá-la seria inferência.

## 3525300 Jaú (`jau`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `jau_ruas_centrais_dec5064_2003` | **desativada** (unverifiable) | Dec. 5.064/2003, art. 1º e parágrafo único, art. 2º e art. 5º; transcrição no Plano de Mobilidade (Dec. 8.495/2023, JO ed. 1099-A) | seg–sex 10h–18h, sáb 9h–12h | capacidade de carga acima de 4,35 t | `geo/3525300_vias.geojson`: 11 dos 13 trechos, só para aviso | — (desativada) |

Pendências:
- **O veredito da verificação foi "inverificável"**: o PDF original do decreto não abriu (DNS/405 em http, conexão resetada em
  https, sem cópia no Wayback). Pela regra do lote, a regra entrou desativada, mesmo com o conteúdo batendo com a transcrição
  oficial de 2023. Para ativá-la, basta reabrir o decreto e trocar `status`/`confianca`, porque a geometria já está pronta.
- Três trechos ficaram fora da geometria ou incompletos:
  - A R. Prof. João Jacinto de Almeida não existe no OSM, nem no cache nem no PBF.
  - A R. Campos Salles, no OSM, só existe ao norte da R. Rangel Pestana. Entre a Mal. Bitencourt e a 7 de Setembro, a via na mesma
    linha se chama Alameda Coronel Joaquim Oliveira Matozinho.
  - O pedaço sul da R. General Galvão, entre a Mal. Bitencourt e a Major Prado, está como Alameda Doutor Julio Esperança no OSM.
    Ficou só o way da General Galvão.
- A ponta "Rio Jahu" da R. Major Prado é o extremo leste da rua, a cerca de 20 m do Rio Jaú. No OSM, a rua não cruza o rio.

## 3526704 Leme (`leme`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `leme_centro_pbt5t` | ativa (média) | Dec. 7.163/2019, arts. 1º, 2º, 4º e 6º; Dec. 6.424/2014, art. 6º (redação do Dec. 7.327/2019) | seg–sex 9h–18h, sáb 9h–13h; feriados aplica | PBT acima de 5 t | `geo/3526704_vias.geojson`: 15 trechos (14 do Dec. 7.163 e a R. Carlos Kock, do rotativo) | evita, toco, de noroeste para sudeste pelo centro: às 10h, 0 km (7,3 km); às 19h, 0,45 km (3,1 km) |
| `leme_centro_lc464_2006` | desativada (baixa) | LC 464/2006, art. 8º | seg–sex 10h–16h, sáb 9h–14h | caminhão | 3 trechos, só para aviso | — |
| `leme_estrada_ricardo_landgraf_osm` | desativada (unverifiable) | só no OSM (hgv=no) | — | — | vazia | — |

Pendências:
- No OSM, a "Praça Manoel Leme" do ato é a Rua Manoel Leme. A R. Joaquim de Góes tem uma falha de cerca de 100 m sem way com
  nome: usei `caminho: valhalla`.
- **Divergência OSM**: a Estrada Municipal Ricardo Landgraf (LME-260) tem hgv=no + access=destination no OSM, sem ato municipal.
  A Prefeitura a cita como ligação do anel de pesados. Vai para `data/osm-overrides/overrides.json` como pendente. Não criei caso
  de rota, porque o roteador já evita a estrada pelo próprio OSM.
- Os decretos de 2021 a 2025 não estão publicados on-line.

## 3526902 Limeira (`limeira`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `limeira_anel_viario_caminhoes` | ativa (alta) | Dec. 294/2007, arts. 1º, I, a a d, 2º e 3º | todos os dias 6h–22h; feriados aplica | mais de 2 eixos ou carreta, reboque ou CVC; exceção de destino local | `geo/3526902_vias.geojson`: Via Antônio Cruanes Filho, Via Francisco D'Andrea, Via Luís Varga e Av. Gumercindo Araújo inteiras (grafias do OSM) | evita, truck, de Piracicaba para Engenheiro Coelho: às 10h, 0 km (80,3 km); às 23h, 7,0 km no anel (61,4 km) |
| `limeira_perimetro_central_10t` | desativada (média) | Dec. 56/2004, arts. 1º a 4º | seg–sex 9h–19h, sáb 9h–13h | PBT acima de 10 t | 14 trechos (a R. Conselheiro Saraiva em 3 pedaços), só para aviso | — |

Pendências:
- A exceção do art. 2º também vale para Cordeirópolis e Iracemápolis. Isso não é representável, porque a camada só dispensa entrega
  no próprio município. Por isso o caso de rota usa origem e destino fora dos três municípios.
- No import, um pedaço da Via Francisco D'Andrea não casou com o grafo do Valhalla e foi descartado. São 34 ways, e só esse
  pedaço caiu.
- Os decretos falam em "Praça João Pessoa" e "Largo São Sebastião". O Largo não está no OSM: as pontas foram aproximadas em lonlat.
- O verificador rebaixou o Dec. 56/2004 a desativado: ele trata de carga e descarga e não proíbe o trânsito de passagem.

## 3527108 Lins (`lins`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `lins_area_urbana_5_eixos` | ativa (média) | Dec. 14.435/2025, arts. 1º (e parágrafo único: 8 acessos), 2º, 3º, 6º e 7º; LC 1.784/2025, art. 1º | 24 h | mais de 4 eixos | `geo/3527108_area_restricao.geojson`: setores urbanos do IBGE 2022, sem a SP-300/BR-267, a SP-381, a LIN-030, a LIN-124, a BR-153 e a Perimetral LIN-251 | evita, carreta (5 eixos), do sul para o norte de Lins: 0 km (34,9 km). O truck (3 eixos) passa 1,0 km na zona (35,8 km) |
| `lins_area_urbana_dec14412_revogado` | revogada (alta) | Dec. 14.412/2025 (revogado pelo Dec. 14.435/2025, art. 7º) | 24 h | comprimento acima de 6,30 m ou largura acima de 2,20 m | mesmo polígono | — |
| `lins_quadrilatero_central_lc1115` | revogada (alta) | LC 1.115/2009, art. 1º (revogada pela LC 1.784/2025) | — | — | `geo/3527108_vias.geojson`: 4 ruas-limite | — |

Pendências:
- O ato só lista os 8 acessos, sem mapa. A Área de Restrição é aproximada pelos setores urbanos.

## 3527256 Lourdes (`lourdes`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `lourdes_lei1893_2023_5_eixos_vias_urbanas` | ativa (média) | Lei 1.893/2023, arts. 1º (§§ 1º a 3º), 2º e 4º; vigência em 05/02/2024 (correção do verificador) | 24 h | mais de 4 eixos | `geo/3527256_vias_urbanas.geojson`: 6 setores urbanos do IBGE 2022 (nenhuma rodovia estadual corta a cidade) | evita, carreta, da vicinal a sudeste para o norte: 0 km (22,6 km). O truck passa 0,7 km na zona (17,1 km) |
| `lourdes_dec6009_2023_caminhoes_onibus_todas_ruas` | desativada (baixa) | Dec. 6.009/2023, arts. 2º e 3º | 24 h | caminhão | mesmo polígono, só para aviso | — |

Pendências:
- O anel viário ("Contorno de Lourdes", Cilos Rodrigues – Nego Taviano) não está com esse nome no OSM. A rota desvia pelas vicinais.

## 3528809 Maracaí (`maracai`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `maracai_av_sao_paulo_caminhoes` | ativa (média) | Lei 1.409/2003, arts. 1º, 2º e 4º | 24 h | todo caminhão | `geo/3528809_vias.geojson`: Av. São Paulo inteira (2 ways, cerca de 1,35 km) | evita, toco, de ponta a ponta: só cruza a avenida, 0,02 km (1,9 km). Um veículo de 3 t usa 0,75 km dela |
| `maracai_rua_jose_goncalves_mendonca_cana` | desativada (baixa) | Lei 1.425/2004, arts. 1º, 2º e 5º | 24 h | caminhão canavieiro (não modelável) | a rua inteira, só para aviso | — |
| `maracai_cana_perimetro_urbano_1842` | revogada (alta) | Lei 1.842/2012 (revogada pela Lei 2.930/2026) | — | — | vazia | — |

Pendências:
- A exceção de carga e descarga, por até 1 h, ficou sem a exceção de entrega local, que liberaria qualquer destino no município.
  Quem vai a um endereço na própria avenida chega pelo custo da camada (fator 1000).
- A sinalização do art. 3º não foi confirmada.

## 3529005 Marília (`marilia`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `marilia_centro_dec7124_art5_caminhoes` | ativa (média) | Dec. 7.124/1995, art. 5º, I a III, e art. 7º | todos os dias 10h–18h; feriados aplica | todo caminhão | `geo/3529005_vias.geojson`: 8 trechos (Av. Sampaio Vidal, R. São Luiz, R. Quatro de Abril, R. Dom Pedro II, R. Nove de Julho, R. Prudente de Moraes, R. Paes Leme, R. Campos Sales) | evita, toco, do sul para o norte da Av. Sampaio Vidal: às 10h, 0,02 km (só cruzamentos; 2,3 km); às 19h, 0,56 km (0,9 km) |
| `marilia_centro_dec7124_art6_capacidade_4t` | ativa (média) | Dec. 7.124/1995, art. 6º, I a IV | todos os dias 10h–18h | capacidade de carga acima de 4 t | 7 trechos (R. Cel. Galdino de Almeida, R. Quinze de Novembro, R. Vinte e Quatro de Dezembro, Av. Carlos Gomes, Av. Mauá e Av. Tancredo Neves) | evita, toco (capacidade típica de 10 t), da Av. Mauá para o norte da Sampaio Vidal: às 10h, 0 km (1,0 km); às 19h, 0,54 km (0,8 km) |
| `marilia_r15_novembro_dec4201_1980` | desativada (baixa) | Dec. 4.201/1980, arts. 1º e 2º | — | caminhão | R. Quinze de Novembro (cerca de 1,3 km), só para aviso | — |
| `marilia_programa_restricao_lei7917_2015` | desativada (baixa) | Lei 7.917/2015, arts. 1º, 2º, 7º e 9º | — | — | vazia (sem regulamento) | — |
| `marilia_carga_descarga_area_central` | desativada (média) | Dec. 7.124/1995, arts. 1º a 4º; LC 877/2019; Dec. 5.959/1990 | — | — | vazia (não é regra de circulação) | — |

Pendências:
- A Av. Tancredo Neves termina a cerca de 37 m da R. Paraná. A ponta "R. Paraná" ficou no fim da avenida, na Av. Sampaio Vidal.
- Na R. Vinte e Quatro de Dezembro, a ponta da Av. Rio Branco ficou cerca de 25 m para dentro, para o Valhalla não sair pela avenida.
- O roteador de caminhão já tende a evitar a R. Quinze de Novembro e a R. Vinte e Quatro de Dezembro, que são residenciais. Por
  isso, o caso do art. 6º usa a Av. Mauá e a Av. Tancredo Neves.
- O ato é de 1995, anterior ao CTB, e a sinalização atual não foi confirmada com a EMDURB.
