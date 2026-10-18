# IMPSC03 — Paraná: Maringá, Pato Branco, Mandaguari, Matinhos, Palmeira, Morretes, Balsa Nova e Irati

Lote da pesquisa profunda do Sul (`docs/research/cidades_sul_co/res|verif/<ibge>.json`, verificação de 2026-10-18) na camada
genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)). Um arquivo por município em
`data/raw/municipios/<ibge>.json`, geometria em `data/raw/municipios/geo/<ibge>_*.geojson`, seed
`db/seed/layers/restricoes_rmsp__<fonte_id>.sql`, casos de rota em `api/test/fixtures/mun_sul_co/<ibge>.json` (teste:
`api/test/layers/mun_sul_co.test.ts`).

| IBGE | Município | fonte_id | Ativas | Desativadas | Revogadas | Casos de rota |
|---|---|---|---|---|---|---|
| 4115200 | Maringá/PR | `maringa` | 2 | 1 | 1 | 2 evita |
| 4118501 | Pato Branco/PR | `pato-branco` | 1 | 1 | 0 | 1 evita |
| 4114203 | Mandaguari/PR | `mandaguari` | 1 | 0 | 0 | 1 evita |
| 4115705 | Matinhos/PR | `matinhos` | 1 | 1 | 0 | 1 evita |
| 4117701 | Palmeira/PR | `palmeira` | 1 | 0 | 0 | 1 evita |
| 4116208 | Morretes/PR | `morretes` | 1 | 0 | 0 | 1 sem_alternativa |
| 4102307 | Balsa Nova/PR | `balsa-nova` | 1 | 0 | 0 | 1 evita |
| 4110706 | Irati/PR | `irati` | 1 | 0 | 0 | 1 evita |

## Geometria (como foi feita, sem Overpass)

- Cache de vias com nome (`data/cache/municipios/osm_named_<ibge>.json`) gerado do PBF com
  `data/raw/municipios/curadoria/osm_pbf_cache_regioes.py` (uma passada para os 8 municípios). A malha do IBGE foi pré-baixada com
  `curl --compressed` (o `urllib` do script grava a resposta gzip sem descompactar e quebra no `json.loads`; ver "Achados").
- Vias: `construir: "trechos"` pelo nome do OSM (Maringá, Pato Branco, Matinhos, Morretes) e, onde a via não tem nome no OSM ou é
  um único way, `caminho: "valhalla"` entre coordenadas (Balsa Nova e Irati, 4 trechos de Pato Branco) ou eixos do OSM
  recortados à mão (Palmeira, `manual`). Todas as feições de vias são derivadas do OSM (ODbL, dito em `fonte.licenca`).
- Zonas (Maringá e Mandaguari): polígono montado sobre as vias-limite do OSM, marcado `aproximado`. Nenhuma rodovia com `ref`
  (BR/PR) fica dentro delas.
- Regras revogadas/desativadas sem área definida: geometria vazia (não entram no banco nem no `regras` da fixture).

## 4115200 Maringá/PR (`maringa`)

VUC: sem definição local (Maringá não define VUC nos atos lidos).

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `maringa_area_central_8t` | ativa (média) | LC 660/2007, arts. 1º, 3º e 5º (Anexo I) | todos os dias 10h–19h (feriado aplica) | PBT acima de 8 t | zona de 1,14 km²: quadrilátero das Av. Prudente de Moraes (N), São Paulo (L), Tiradentes (S) e Paraná (O), aproximado | carreta, terça 10h, oeste→leste: 0 km dentro, 5,08 km; às 20h atravessa (1,0 km dentro, 3,85 km) |
| `maringa_av_morangueira_23t` | ativa (média) | Decreto 1.674/2014, arts. 1º a 3º | todos os dias 6h–21h | PBT acima de 23 t | Av. Morangueira da Av. Colombo até antes do Contorno Norte (~4,2 km de linhas, duas pistas em parte) | carreta, terça 10h, da Av. Colombo ao norte do Contorno Norte: 0 km na via, 8,33 km; às 22h usa a avenida (4,1 km, 7,22 km) |
| `maringa_lc10_1993_area_central_carga_descarga` | revogada | LC 10/1993, arts. 2º e 3º; revogada pelo art. 5º da LC 660/2007 | — | — | vazia (registro histórico) | — |
| `maringa_plano_2022_ampliacao_area_restrita` | desativada | Lei 11.518/2022, Anexo VII (ação programática, sem ato de implantação) | — | — | vazia | — |

Pendências e observações:

- O Anexo I da LC 660 é um mapa de baixa resolução; o ato não diz se as próprias avenidas-limite estão dentro. O recuo de 20 m da camada as deixa livres.
- Art. 2º da LC 660 (locais de carga e descarga, texto incompleto no OCR) e o decreto regulamentador não foram localizados; Decreto 863/2003 (cargas perigosas) idem.
- O art. 3º do Decreto 1.674 (fora de 6h–21h só circula carga/descarga) não é modelado: a janela de 21h às 6h fica livre.
- Portal da Prefeitura inacessível na pesquisa: decretos recentes da SEMOB podem existir fora do SAPL/Querido Diário (confiança média nas duas ativas).
- Travessia da cidade: a Av. Colombo (BR-376) e o Contorno Norte ficam fora da zona; rota norte–sul de passagem (carreta, 10h e 20h) tem a mesma distância (21,9 km), sem volta.

## 4118501 Pato Branco/PR (`pato-branco`)

VUC: sem definição local.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `patobranco_estar_centro_16t` | ativa (média) | Decreto 10.412/2025, art. 17 §§4º e 5º, Anexo I (revoga o 10.374/2025; Dec. 10.730/2025 não altera o §4º) | 24 h, todos os dias (o §4º não fixa horário) | PBT acima de 16 t | 17 trechos de ruas do Anexo I, casados por nome (59 linhas; 4 trechos pelo Valhalla) | carreta, terça 10h, oeste→leste do centro: 0,02 km (só o cruzamento), 6,58 km; o toco (16 t) passa (0,3 km, 6,33 km) |
| `patobranco_estradas_interior_7t_eixo` | desativada (baixa) | Decreto 8.260/2018, arts. 1º e 2º | — | — | vazia (estradas rurais sem lista) | — |

Pendências e observações:

- A área do ESTAR é dada por 17 trechos de ruas (não por polígono): a regra é de vias. As `pendencias` do GeoJSON estão zeradas.
- Rua Tamoio (Xavantes–Ibiporã), Rua Guarani (Av. Tupi–Osvaldo Aranha), Rua Iguaçu (Tamoio–Goianases) e Rua Pedro Ramires de Mello (Guarani–Paraná) não fecham pelo encadeamento por nome (ways de mão única com sentidos desencontrados no OSM): usado `caminho: valhalla` entre os cruzamentos (corredor de 60 m).
- No OSM a Rua Doutor Silvio Vidal chama-se Rua Silvio Vidal.
- Rota norte–sul de passagem (carreta): cruza a Av. Tupi (0,086 km), travessia inevitável; o aviso é só do cruzamento.
- Decreto 8.260/2018 ("PBT acima de 7 t por eixo") fica desativado por redação ambígua e falta de lista de estradas.

## 4114203 Mandaguari/PR (`mandaguari`)

VUC: sem definição local.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `mandaguari_area_central_trafego_7t` | ativa (média) | Lei 3.877/2023, art. 2º (perímetro) e artigo de circulação (sem numeração no texto extraído) | seg–sex 9h–18h30; sáb 8h30–13h (domingo e feriado livres) | capacidade de carga (`payload_t`) acima de 7 t OU comprimento acima de 7 m | zona de 1,29 km² (perímetro do ato sobre o OSM, aproximado) | carreta, terça 10h, norte→sul passando pela cidade: 0 km dentro, 19,4 km (aviso large_detour); às 20h atravessa (0,62 km dentro, 11,7 km) |

Pendências e observações:

- Anexo (mapa, link externo) não lido. A Av. dos Pioneiros não consta no OSM com nome: ligada em linha reta entre as pontas da R. Senador Salgado Filho e da R. Dr. Alcir Castelo Branco; o trecho final da Salgado Filho até a Gomercindo Bortolanza também em linha reta.
- O ato diz "veículos acima de 7,0 toneladas" sem dizer PBT ou capacidade: mantido `payload_t` (verificador); se for PBT, a regra é mais ampla.
- A travessia urbana (R. Renê Táccola / Padre Antonio Lock, via `secondary` sem `ref` no OSM) fica dentro da área, que o ato define pelo perímetro e proíbe "no interior"; as rodovias com `ref` (BR-376, PR-444) contornam a cidade e ficam fora. Por isso a rota de passagem norte–sul de carreta, na janela, faz volta de 7,7 km (efeito esperado da regra).

## 4115705 Matinhos/PR (`matinhos`)

VUC: sem definição local.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `matinhos_av_atlantica_pesados` | ativa (média) | Decreto 4.604/2025, arts. 2º I e 5º | restrito seg–sex 0h–7h e 19h–24h; sáb e dom 0h–8h e 15h–24h (complemento das janelas em que a circulação é permitida) | PBT acima de 7 t OU comprimento acima de 7 m | Av. Atlântica da Rua Ipiranga à Rua Itacolomi (3 ways, ~2,8 km, mão única no OSM) | carreta, terça 21h, Caiobá→Matinhos: 0 km na avenida, 2,25 km; às 10h usa a avenida (1,66 km, 2,31 km) |
| `matinhos_av_atlantica_datas_eventos` | desativada | Decreto 4.604/2025, art. 6º | — | — | mesma avenida (registro; gera `municipal_regra_nao_aplicada`) | — |

Pendências e observações:

- O art. 5º diz quando a circulação é permitida; as janelas são o complemento (inferência confirmada pelo art. 6º). Feriado em dia útil: o decreto o trata como fim de semana (8h–15h), mais restritivo que a janela usada (limitação do formato).
- No OSM a Av. Atlântica é um eixo único de mão única (sentido Caiobá → Matinhos) que começa a ~90 m da Rua Ipiranga (tolerância de 120 m nessa ponta); o outro sentido não tem eixo de mesmo nome.
- Art. 7º permite portarias do Departamento de Trânsito (não localizadas). Proibição por datas (art. 6º) não é representável em janelas semanais.

## 4117701 Palmeira/PR (`palmeira`)

VUC: sem definição local.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `palmeira_bairro_elias_farajala_bacila_10t` | ativa (média) | Lei 3.773/2014, art. 1º e parágrafo único; exceções do art. 2º | 24 h, todos os dias | PBT acima de 10 t | Ruas Eugênio Nogueira dos Santos e Gustavo Marcondes Zanardini, da ponta junto à rodovia até a Rua José Caetano de Oliveira (2 eixos, ~0,8 km) | carreta, terça 10h: 0,03 km (ponta de origem), 0,69 km; o VUC segue pela rua (0,38 km, 0,58 km) |

Pendências e observações:

- Cada rua é um único way no OSM (o encadeamento por nome não fecha e o `caminho: valhalla` perdia o sentido leste): geometria `manual` com os eixos recortados do OSM, nos dois sentidos.
- No OSM, as ruas partem da Rodovia Prefeito João Batista Distefano (way 825073608), a ~190 m da PR-151 (Rodovia João Chede) no cache.
- A ponta de origem do caso de rota tem de ficar na ponta da rua (0,03 km): saindo de dentro da rua a parte inicial é inevitável.
- Art. 4º permite ao Departamento de Segurança e Trânsito alterar as delimitações (ato não localizado). As exceções (destino nas ruas, utilidade pública) só aparecem nos avisos.

## 4116208 Morretes/PR (`morretes`)

VUC: sem definição local.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `morretes_estrada_de_barreiros_pesados` | ativa (média) | Decreto 426/2019, art. 1º e parágrafo único; exceções do art. 2º | 24 h, todos os dias | mais de 3 eixos OU semirreboque/reboque/CVC (todos os caminhões menos as classes 2C e 3C) | Estrada de Barreiros inteira (1 way, 2,36 km) | carreta, de uma ponta à outra: sem alternativa (2,2 km na estrada), aviso `uses_restricted_way`; o toco passa livre |

Pendências e observações:

- Risco residual: a base do decreto (art. 126 da LC 11/2011) foi revogada pela LC 64/2024, que não revogou o Decreto 426/2019 e mantém o poder de interditar ruas a caminhões (art. 102 §2º). Confiança média.
- O alvo (eixos acima de 3 ou combinações) aproxima as classes 2C/3C.
- OSM: maxweight 8,5 t na Estrada da Graciosa (PR-410, rodovia estadual): fora da competência municipal, sem correção.

## 4102307 Balsa Nova/PR (`balsa-nova`)

VUC: sem definição local.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `balsanova_estrada_atilio_ramos_4eixos` | ativa (alta) | Lei 1.411/2024, art. 1º e parágrafo único (exceções agroavícolas, patrulha, emergência) | 24 h, todos os dias | 4 eixos ou mais (cavalo + carreta em conjunto) | Estrada Atílio Ramos entre as coordenadas UTM do ato (caminho pela malha, ~1 km, aproximado) | carreta, da BR-277 à Estrada do Tamanduá: 0 km na estrada, 2,13 km (large_detour); o toco vai por ela (1,02 km, 1,05 km) |

Pendências e observações:

- A estrada não tem nome no OSM. As coordenadas UTM do ato (BR-277 km 138+800: 628857,92 E / 7181697,43 N; Estrada do Tamanduá: 629688,53 E / 7181392,18 N) foram convertidas de SIRGAS 2000 / UTM 22S (EPSG:31982; o datum do ato não é dito). A ponta leste cai na Estrada do Tamanduá, e o caminho entre as duas pontas percorre ~660 m dela depois de ~330 m de via sem nome ligada à BR-277.
- Sinalização (art. 4º) não confirmada. OSM: Av. Fritz Erwin Schmidt com maxweight=50 (way 383957149), sem ato municipal; registrado, sem correção.

## 4110706 Irati/PR (`irati`)

VUC: sem definição local.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `irati_estrada_caratuva_4eixos` | ativa (alta) | Lei 5.171/2024, art. 1º e §2º; art. 10 (catástrofe) | 24 h, todos os dias | 4 eixos ou mais (cavalo + carreta em conjunto) | estrada vicinal entre as coordenadas do ato (caminho pela malha, ~2,3 km, aproximado) | carreta, da BR-277 a Caratuva II: 0,03 km na estrada, 4,15 km (large_detour); o toco vai por ela (2,3 km, 2,31 km) |

Pendências e observações:

- A vicinal não tem nome no OSM: caminho pela malha (Valhalla) entre 25°26'2,76"S 50°43'12,71"O e 25°25'12,86"S 50°42'19,08"O; 2,3 km, coerente com os 2,28 km do ato. Em rotas cujo destino só se alcança pela vicinal a camada usa a estrada e avisa `uses_restricted_way`.
- Multa de 10 URM (art. 9º) não é modelada.

## Achados (fora do escopo, sem alteração)

- `data/raw/municipios/curadoria/osm_pbf_cache_regioes.py`: a função `malha()` baixa a malha do IBGE com `urllib` e grava os bytes; a API respondeu gzip e o arquivo ficou comprimido (`UnicodeDecodeError` ao ler). Contornado baixando com `curl --compressed` antes. Correção possível: pedir `Accept-Encoding: identity` ou descomprimir.
- `_municipios_lib.build_trecho`: `linemerge(unary_union(lines))` falha ("Cannot linemerge LINESTRING") quando a via do trecho é um único way e há `de`/`ate` (Palmeira). Já documentado nas dicas dos lotes; contornado com `caminho: valhalla`/`manual`.
- `build_trecho` com ways de mão única de sentidos desencontrados (Pato Branco) devolve "trecho vazio" nos dois sentidos, mesmo com as ruas conectadas no OSM.
