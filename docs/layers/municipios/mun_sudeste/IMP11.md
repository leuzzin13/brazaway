# mun_sudeste — lote IMP11 (11 municípios de SP)

Pirangi, Praia Grande, Presidente Prudente, Rio Claro, Rosana, Santa Branca, Santo Expedito, São Bento do Sapucaí, São Luiz
do Paraitinga, São Manuel e São Pedro, na camada genérica `restricoes_rmsp` (`data/raw/municipios/<ibge>.json`; formato em
[`../../restricoes_municipais.md`](../../restricoes_municipais.md)). As regras vêm de
`docs/research/cidades_sudeste/res/<ibge>.json` com as correções de `verif/<ibge>.json` (verificação de 11/10/2026), que
prevalecem.

Resumo: **11 regras ativas** em 10 municípios (4 zonas, 7 vias), **14 desativadas** (1 delas por falta de geometria: Rosana) e
**3 revogadas**. Os casos de rota foram conferidos na API real (`localhost:3000`) e gravados em
`api/test/fixtures/mun_sudeste/<ibge>.json`: 11 casos, todos "evita". Todos passam em
`API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"` (12/10/2026; 22 testes do lote).
Datas usadas: terça 13/10/2026.

## Como a geometria foi feita

- **Vias** (`construir: "trechos"`): nomes exatamente como no OSM (cache `data/cache/municipios/osm_named_<ibge>.json`). O
  import gerou `geo/<ibge>_vias.geojson` com `pendencias` vazias em todos os municípios com via. Em Pirangi a R. Dr. Campos
  Salles é um way só, de mão única: `de`/`ate` em `lonlat` quebra no `linemerge` do importador (ver "Bug no importador"), por
  isso o trecho usa `caminho: "valhalla"` com `sentido: true` e corredor de 30 m.
- **Perímetro urbano / macrozona sem polígono no ato** (Santa Branca, São Bento do Sapucaí, Catuçaba em São Luiz do
  Paraitinga): união dos setores censitários urbanos do IBGE 2022 (`CD_SIT` 1 e 2) do distrito, sem furos, simplificada a ~5 m,
  com as rodovias estaduais/federais recortadas com 40 m de folga (ways com `ref` SP/SPA/BR/MG em
  trunk…unclassified e ramos sem ref, mais os trechos sem ref da travessia escolhidos pelo nome). Zona marcada como aproximada
  e confiança no máximo média. Scripts: `data/raw/municipios/geo/<ibge>_*_curadoria.py`; rodar com
  `python3 <script> <shapefile SP_setores_CD2022> <vias OSM do município em formato Overpass>` (usei um extrato de todas as
  ways `highway` do retângulo do município tirado do PBF `data/valhalla/sudeste-latest.osm.pbf`; o cache `osm_named` também
  serve, mas não tem os trechos de rodovia sem nome).
- **Presidente Prudente**: face da malha do OSM delimitada pelas quatro avenidas do ato (`geo/3541406_centro_curadoria.py`); o
  recuo de 20 m da rota libera as avenidas-limite ("vias internas ao quadrilátero").
- **Desativada sem área definida**: `{"geojson": FeatureCollection vazia}` (fica no arquivo, não vai para o banco nem para o
  `regras` da fixture). **Revogada**: limite municipal do IBGE só como registro.
- **Import**: `municipios:<ibge>` com `MUNICIPIOS_DIR` montando só o arquivo do município. Malha do IBGE já em cache.
- **Medida dos casos**: "km na regra" = trecho da rota a até 10 m das linhas da via ou dentro do polígono recuado 20 m, como mede
  o teste. Um cruzamento de via restrita conta ~20–35 m. "Veículo leve" nas notas = `{"weight_t":3,"length_m":5,…}`, fora de
  qualquer alvo, usado só para mostrar que a via/zona é o caminho natural.

---

## 3539004 Pirangi (`pirangi`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `pirangi_rua_campos_salles_r9` | ativa (média) | Dec. 2.619/2015, art. 1º, VII | 24 h, todos os dias | todo caminhão | `geo/3539004_vias.geojson`: R. Dr. Campos Salles entre a Av. Nove de Julho e a Av. Treze de Junho (807 m, mão única) | evita, toco, Av. Nove de Julho → além da Av. Treze de Junho: 0,03 km (cruzamento), 1,3 km |

Pendências: placa R-9 de 2015 não conferida no local (por isso confiança média).

## 3541000 Praia Grande (`praia-grande`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `praiagrande_av_kennedy_carga` | ativa (média) | Dec. 3.423/2002, art. 1º, II; Lei 1.157/2002, arts. 1º–2º (red. Lei 1.165/2002) | 24 h | todo caminhão ("carga e grande porte") | Av. Pres. Kennedy inteira no município (138 pedaços, ~44 km somando as duas pistas) | evita, toco, Guilhermina → Ocian (lado de terra): 0 km, 9,3 km; leve usa 2,7 km da avenida |
| `praiagrande_av_ayrton_senna_carga` | ativa (média) | Dec. 3.423/2002, art. 1º, I | 24 h | todo caminhão | Av. Ayrton Senna da Silva inteira (~3,4 km; sem a Via Expressa Sul) | evita, toco, São Vicente (ilha) → Boqueirão: 0 km, mas 27,9 km (leve: 7,5 km, 1,5 km na avenida) |
| `praiagrande_sp055_km291_saidas_carga` | desativada (média) | Dec. 3.423/2002, art. 1º, III | 24 h | caminhão | vazia | — |
| `praiagrande_carga_descarga_6_10` | desativada (alta) | Dec. 4.209/2007, arts. 1º–3º | — | caminhão | vazia (regra de operação) | — |
| `praiagrande_quiosques_orla_carga_descarga_6_9` | desativada (alta) | LC 769/2018, art. 18 | — | caminhão | vazia (regra de operação) | — |
| `praiagrande_cacambas_poliguindaste_7_19` | desativada (média) | Lei 970/1997, art. 6º | — | poliguindaste | vazia | — |
| `praiagrande_carga_descarga_decretos_revogados` | revogada | Decs. 2.412/1994, 2.626/1996, 3.997/2005, 3.966/2005 (rev. Dec. 4.209/2007, art. 3º) | — | — | limite municipal (registro) | — |

Pendências:
- A ligação São Vicente ↔ Praia Grande pelo Japuí fica fechada a caminhão 24 h (Ayrton Senna pela regra, Via Expressa Sul pelo
  `hgv=no` do OSM): a rota volta pela Imigrantes/SP-55 (aviso `large_detour`). É o efeito do ato, mas a competência municipal
  sobre a parte com ref SPA-291/055 e a sinalização atual não foram conferidas.
- Exceções de serviço "a realizar no município" (Lei 1.157, art. 2º) não modeladas (sem `excecao_destino_local`, leitura estrita).
- Seed com 0,7 MB (138 pedaços da Kennedy com as exceções repetidas nas props).

## 3541406 Presidente Prudente (`presidente-prudente`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `presidente_prudente_centro_1t` | ativa (média) | Dec. 8.418/1993, arts. 1º–3º | todos os dias 9h30–17h; feriados aplica | capacidade de carga acima de 1 t | `geo/3541406_centro.geojson`: quadrilátero das Avs. Cel. José Soares Marcondes, Washington Luiz, Brasil e Manoel Goulart | evita, toco, sul → norte: 10h, 0 km (2,2 km); 18h, 0,17 km dentro (2,1 km) |

Pendências: rotas curtas entre lados opostos já preferem as avenidas-limite (ruas internas de mão única e lentas), então a regra
muda pouco a rota; leis desde 03/2025 não consultadas (portal bloqueado).

## 3543907 Rio Claro (`rio-claro`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `rioclaro_centro_3t` | ativa (alta) | Dec. 12.448/2021, art. 1º, itens 1–9; art. 2º | seg–sex 9h–18h, sáb 9h–15h; feriados aplica | PBT acima de 3 t | Ruas 2–6 e Avs. 1–4 nos trechos do decreto (19 pedaços, ~4,9 km, mão única) | evita, toco, norte → sudoeste do centro: 10h, 0 km (2,5 km); 20h, 0,54 km nas vias (2,1 km) |
| `rioclaro_centro_3t_dec6172_2000` | revogada | Dec. 6.172/2000 (rev. Dec. 12.448/2021, art. 2º) | — | — | limite municipal (registro) | — |
| `rioclaro_lei2787_art4_perigosos_distrito` | desativada (baixa) | Lei 2.787/1995, art. 4º (só PlanMob) | — | caminhão | vazia | — |
| `rioclaro_lei2787_zonas_residenciais` | desativada (unverifiable) | Lei 2.787/1995 (artigo não identificado) | — | PBT > 3 t | vazia | — |
| `rioclaro_lei3480_mais_3_eixos` | desativada (unverifiable) | Lei 3.480/2004, art. 1º (só PlanMob) | — | mais de 3 eixos | vazia | — |
| `rioclaro_rcl350_controle_trafego` | desativada (baixa) | Lei 5.557/2021, arts. 1º–3º | — | caminhão | vazia | — |
| `rioclaro_itapua_portofino_16t` | desativada (baixa) | notícia de 14/04/2021 (sem ato) | — | PBT > 16 t | vazia | — |
| `rioclaro_ponte_madeira_terra_nova` | desativada (baixa) | notícia de 07/01/2016 (sem ato) | — | caminhão | vazia | — |
| `rioclaro_carga_descarga_dec11440` | desativada (alta) | Dec. 11.440/2019, arts. 1º–3º | — | PBT > 3 t | vazia (regra de operação) | — |

Pendências: Leis 2.787/1995 e 3.480/2004 sem texto (SISCAM com erro); a lei de 1995 pode ter exceções ao decreto de 2021.

## 3544251 Rosana (`rosana`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `rosana_jacutinga_mais2eixos` | **desativada** (alta) — sem geometria confiável | Dec. 3.503/2022, arts. 1º–5º | 24 h | mais de 2 eixos | vazia | — |
| `rosana_jacutinga_dec3462` | revogada | Dec. 3.462/2022 (rev. Dec. 3.503/2022, art. 5º) | — | — | limite municipal (registro) | — |

Pendências:
- **Estrada da Jacutinga não localizada**: nenhum way com esse nome (nem `alt_name`/`old_name`) no cache nem no PBF do Sudeste, e
  o decreto não dá pontas nem ligação. A regra (ato vigente, confirmado) fica desativada até alguém localizar a estrada no
  Distrito de Primavera (provável ligação rural que contorna a balança da SP-613). Rosana fica sem caso de rota.

## 3546009 Santa Branca (`santa-branca`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `santabranca_noturno_carga_perimetro_urbano` | ativa (média) | Lei 1.115/2005, arts. 1º, 2º, 3º, 5º, 6º | todos os dias 22h–24h e 0h–6h; feriados aplica | todo caminhão ("carga e obras") | `geo/3546009_perimetro_urbano.geojson`: 21 setores urbanos da sede (IBGE 2022), sem a travessia da SP-077 (2,6 km², 4 partes) | evita, toco, leste → noroeste da sede: 23h, 0 km (19,5 km, `large_detour`); 10h, 0,86 km dentro (3,4 km) |
| `santabranca_lei970_pesados_perimetro` | desativada (baixa) | Lei 970/2002 (só ementa) | — | caminhão | vazia | — |

Rota de passagem: SP-077 de Jacareí para Salesópolis às 23h = 22,1 km, igual ao dia, sem entrar na zona. Na primeira versão do
polígono a travessia passava 0,2 km pela zona (R. Trancredo Galvão Trigueirinho, sem ref no OSM) e a rota noturna dava 68 km;
recortei também, pelo nome, a R. Trancredo Galvão Trigueirinho, a R. Benedito Alves Pereira e a R. Independência (pista sem ref).

Pendências: o perímetro urbano legal não foi achado (aproximação pelo IBGE); exceções de perecíveis e autorização não estão no
perfil (só avisos); 2 ways com `hgv=no` citados na pesquisa não localizados; Lei 970/2002 sem texto.

## 3548302 Santo Expedito (`santo-expedito`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `santoexpedito_vias_15t` | ativa (média) | Lei 1.718/2020, arts. 1º–5º | 24 h | PBT acima de 15 t | Av. Barão do Rio Branco, R. Rui Barbosa e R. Carlos Gomes inteiras (~4,9 km) | evita, carreta, leste → oeste da cidade: 0,035 km (cruzamentos), 9,5 km; leve usa 0,65 km delas (2,2 km) |

Pendências: "mais de 15 toneladas" lido como PBT; carga e descarga (art. 3º) não modelada.

## 3548609 São Bento do Sapucaí (`sao-bento-do-sapucai`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `saobento_sapucai_macrozona_29t` | ativa (média; ato alta) | Lei 2.108/2019, arts. 1º (red. LC 2.128/2020), 2º–5º; LC 2.128/2020, arts. 1º–2º | 24 h | PBT acima de 29 t ou comprimento acima de 17 m | `geo/3548609_macrozona_urbana.geojson`: 12 setores urbanos da sede (IBGE 2022), sem a SP-042 e a SP-050 (2,5 km², 3 partes) | evita, carreta, noroeste → sudeste da sede: 0 km (4,9 km pela SP-042); toco passa 0,30 km dentro (3,8 km) |

Rota de passagem: SP-042 (sul) → MG-173 (norte) = 25,3 km para carreta e para leve, sem entrar na zona.

Pendências:
- Macrozona urbana do Plano Diretor sem polígono: aproximada pelo IBGE; confiança rebaixada para média por isso.
- As avenidas centrais que ligam a SP-042 à Rod. Pref. Benedicto Gomes de Souza (secondary sem ref) ficam dentro da zona: são
  ruas municipais. Carreta que vai da cidade para o leste (Benedicto Gomes de Souza / Caminho da Fé) dá voltas de 60–80 km. É o
  efeito do ato (as indicações da Câmara falam justamente de pesados fugindo da balança da SP-42 pela cidade), mas confira se a
  Rod. Benedicto Gomes de Souza é estadual.

## 3550001 São Luiz do Paraitinga (`sao-luiz-do-paraitinga`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `slparaitinga_catucaba_acima_3_eixos` | ativa (média) | Lei 1.135/2004, arts. 1º, 2º, 5º | 24 h | mais de 3 eixos | `geo/3550001_catucaba.geojson`: 2 setores urbanos do distrito Catuçaba (IBGE 2022), sem o acesso SPA-046/125 (1,35 km², 2 partes) | evita, carreta, rural nordeste → acesso SPA-046/125: 0 km, mas 83 km (`large_detour`); toco atravessa 1,1 km (4,4 km) |
| `slparaitinga_catucaba_toras_eucalipto` | desativada (média) | Lei 1.733/2015, arts. 1º e 3º | 24 h | mais de 2 eixos e capacidade > 6 t (toras de eucalipto) | vazia | — |

Pendências: os setores urbanos de Catuçaba (baixa densidade) incluem chácaras em volta do povoado; o acesso estadual SPA-046/125
(Estrada Municipal Vitorino Teixeira Leite no OSM) ficou livre até o centro do povoado; a rua-estrada do Prolar (Lei 1.733) não
está delimitada; `hgv=no`/`maxweight=40`/`maxlength=25` citados na pesquisa não localizados.

## 3550100 São Manuel (`sao-manuel`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `saomanuel_dec4333_2025_vicinal_nilo_chavasco` | ativa (média) | Dec. 4.333/2025, arts. 1º e 2º | 24 h | mais de 3 eixos | Vicinal Doutor Nilo Lisboa Chavasco inteira (~2,7 km) | evita, carreta, SP-191 km 196 → cidade: 0 km (5,1 km); toco usa 2,7 km dela (4,1 km) |
| `saomanuel_lei2728_2002_carga_descarga_centro` | desativada (alta) | Lei 2.728/2002, arts. 1º–3º | — | caminhão | vazia (regra de operação) | — |

Pendências: placa do DER-SP no km 196 da SP-191 não confirmada.

## 3550407 São Pedro (`sao-pedro`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `saopedro_serra_elisio_teixeira_3eixos` | ativa (alta) | Lei 3.195/2014, arts. 1º, 2º, 5º, 8º | 24 h | mais de 3 eixos | Rod. Municipal Elisio de Paula Teixeira inteira (~4,5 km; trecho da Serra aproximado) | evita, carreta, alto → pé da Serra: 0,02 km (ponta), 28,1 km (`large_detour`); toco desce pela via (4,3 km nela; 5,6 km) |

Pendências: o trecho "da Serra" não é delimitado no ato (via inteira, `aproximado`); portaria de regulamentação e eventual
suspensão (art. 5º) não localizadas.

---

## Bug no importador (não corrigido aqui)

`importers/sources/_municipios_lib.py`, `build_trecho` (linha ~214): com `de`/`ate` informados e a via com **um só way** no
OSM, `linemerge(unary_union(lines))` recebe uma `LineString` e o shapely 2 levanta `ValueError: Cannot linemerge LINESTRING
(...)` — inclusive com pontas em `{"lonlat"}`. Contornado em Pirangi com `caminho: "valhalla"`. Correção sugerida: só chamar
`linemerge` quando houver mais de uma linha (ou passar `MultiLineString(lines)`).
