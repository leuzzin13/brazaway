# IMPSC05 — Santa Catarina: Irineópolis, Nova Veneza, Porto Belo, Seara, Turvo, Videira, Vitor Meireles e Balneário Rincão

Lote da pesquisa profunda do Sul (`docs/research/cidades_sul_co/res|verif/<ibge>.json`, verificação de 2026-10-18) na camada
genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)). Um arquivo por município em
`data/raw/municipios/<ibge>.json`, geometria em `data/raw/municipios/geo/<ibge>_*.geojson`, seed
`db/seed/layers/restricoes_rmsp__<fonte_id>.sql`, casos de rota em `api/test/fixtures/mun_sul_co/<ibge>.json` (teste:
`api/test/layers/mun_sul_co.test.ts`).

| IBGE | Município | fonte_id | Ativas | Desativadas | Revogadas | Casos de rota |
|---|---|---|---|---|---|---|
| 4207908 | Irineópolis/SC | `irineopolis` | 1 | 1 | 0 | 1 evita |
| 4211603 | Nova Veneza/SC | `nova-veneza` | 2 | 2 | 0 | 2 evita |
| 4213500 | Porto Belo/SC | `porto-belo` | 0 | 3 | 0 | — |
| 4217501 | Seara/SC | `seara` | 1 | 2 | 0 | 1 evita |
| 4218806 | Turvo/SC | `turvo` | 1 | 1 | 0 | 1 evita |
| 4219309 | Videira/SC | `videira` | 1 | 1 | 0 | 1 evita |
| 4219358 | Vitor Meireles/SC | `vitor-meireles` | 1 | 0 | 0 | 1 evita |
| 4220000 | Balneário Rincão/SC | `balneario-rincao` | 2 | 1 | 1 | 2 evita |

Nenhum município do lote define VUC (`vuc: null`): o VUC é tratado como caminhão, e o que decide é o PBT, o número de eixos ou a classe. Nos
casos de rota, o preset `vuc` (PBT baixo) só serve de contraprova: passa pela via, a carreta não.

## Geometria (como foi feita, sem Overpass)

- Cache de vias com nome (`data/cache/municipios/osm_named_<ibge>.json`) gerado do PBF com
  `data/raw/municipios/curadoria/osm_pbf_cache_regioes.py` (uma passada para os 8 municípios; a malha do IBGE foi baixada pelo próprio script).
- Vias por nome (`construir: "trechos"`): Nova Veneza, Seara, Videira e Rincão (Av. Waldemar Carlos Petrini). Pontas por `{"lonlat"}` ou
  `caminho: "valhalla"` entre cruzamentos onde a via é de mão única (Av. Dom Pedro II em Videira; ICR-353, ICR-358 e ICR-350 em Rincão).
- Geometria manual: Irineópolis (zona), Turvo (TVO-352) e Vitor Meireles (ponte). Os ways sem `name` com `ref=TVO-352` e a ponte
  foram extraídos do PBF com `osmium` (recorte por bbox e filtro de tags), sem Overpass.
- Todas as feições de vias são derivadas do OSM (ODbL, dito em `fonte.licenca`); a zona de Irineópolis é derivada do limite do IBGE e do eixo da BR-280 no OSM.
- Regras desativadas/revogadas sem área definida: geometria vazia (não entram no banco nem no `regras` da fixture). Porto Belo só tem o limite
  municipal do IBGE como registro da regra de alta temporada (desativada), para a fonte ter registro.

## 4207908 Irineópolis/SC (`irineopolis`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `irineopolis_dec3314_2017_esquerda_br280` | ativa (média) | Dec. 3.314/2017, art. 1º, I (área), arts. 2º e 3º | 24 h, todos os dias (feriado aplica) | PBT acima de 30 t | zona: município à esquerda da BR-280 (sul, sentido Canoinhas-Porto União), 466 km² + 13 km², sem a BR-280 e a SC-120 (faixa de 15 m), aproximado | carreta, terça 10h, da sede a Timbó Grande: 0 km dentro, 99,4 km; o VUC atravessa (35 km dentro, 75,4 km) |
| `irineopolis_lei1885_2015_estradas` | desativada (média) | Lei 1.885/2015, art. 1º, I a V; Dec. 3.177/2017 | — | PBT acima de 30 t | vazia (5 estradas rurais sem nome, só por localidades) | — |

Pendências e observações:

- O ato define a área por referência à BR-280 ("à esquerda, sentido Canoinhas-Porto União"): leitura adotada = lado sul do município. A sede e o lado norte ficam fora da zona.
- Rota de passagem pela BR-280 (leste-oeste, carreta) não dá volta: 23,6 km, igual ao toco.
- As 5 estradas da Lei 1.885/2015 ficam sem geometria; boa parte já cai dentro da zona do Dec. 3.314.

## 4211603 Nova Veneza/SC (`nova-veneza`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `novaveneza_dec187_2020_imigrantes_gava` | ativa (média) | Dec. 187/2020, art. 1º e parágrafo único; Lei 2.663/2018, arts. 3º, 4º, 5º a 12 | 24 h, todos os dias | PBT acima de 15 t | Rua dos Imigrantes (1,1 km) e Rua Ângelo Gava (1,3 km), inteiras, por nome | carreta, terça 10h, leste-oeste da Rua dos Imigrantes: 0,007 km, 19,6 km; o VUC usa (1,25 km, 9,1 km) |
| `novaveneza_dec457_2019_natal_coral` | ativa (média) | Dec. 457/2019, art. 1º e parágrafo único; Lei 2.663/2018 | 24 h | PBT acima de 15 t | Rua Natal Coral (0,7 km), inteira | carreta, terça 10h, do norte da rua ao Bairro Elisa: 0 km, 15,0 km; o VUC passa (0,72 km, 1,7 km) |
| `novaveneza_dec462_2017_perimetro_central_12t` | desativada (baixa) | Dec. 462/2017, art. 1º | — | PBT acima de 12 t | vazia (plantas anexas não lidas) | — |
| `novaveneza_dec486_2017_pedro_tomasi_constante_mattia_10t` | desativada (baixa) | Dec. 486/2017, art. 1º | — | PBT acima de 10 t | vazia ("parte" das ruas, plantas anexas) | — |

Pendências e observações:

- A extensão exata das ruas está no projeto anexo aos decretos (não lido): aplicada a rua inteira.
- Divergência com o OSM: a Rua dos Imigrantes tem `hgv=no` e `maxweight=12` (ways 319719139 e 1087538842) e `maxweight=15` em outros trechos; a Rua Ângelo Gava e a Rua Natal Coral têm `maxweight=15` em ways. O decreto fixa 15 t. O Valhalla já respeita esses limites; a camada cobre o resto das ruas. Os casos de rota concordam com o OSM em parte (a prova da camada é `avoided` conter a camada e o VUC passar). Não corrigi a tag.
- A Rua Ângelo Gava de carreta para o norte dá "sem rota" por peso (OSM com 15 t no único acesso): não virou caso.

## 4213500 Porto Belo/SC (`porto-belo`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `portobelo_dec4564_2026_ponte_santa_luzia` | desativada (média) | Dec. 4.564/2026, arts. 1º, 2º e 4º | 24 h | PBT acima de 12 t ou mais de 2 eixos | vazia (ponte não localizada) | — |
| `portobelo_lei3512_2024_estrada_parque` | desativada (média) | Lei 3.512/2024, arts. 1º, 6º e 9º | 24 h | mais de 2 eixos ou articulado | vazia | — |
| `portobelo_dec4309_4332_2025_alta_temporada` | desativada (média) | Dec. 4.309/2025, arts. 1º e 2º; Dec. 4.332/2025, art. 1º | 5h-24h, 23/12/2025 a 04/01/2026 (encerrada) | carreta (semirreboque/reboque/CVC) | limite do município (IBGE), só registro | — |

Pendências e observações:

- Ponte sobre o Rio Santa Luzia (Dec. 4.564/2026, vigente): o decreto não nomeia a via e o rio, na divisa com Tijucas, tem várias travessias no OSM sobre o limite municipal: BR-101 (2 pistas, motorway), Av. José Neoli Cruz (PBL-010, secundária, `hgv=no` no way vizinho; o way da ponte tem `description` "Ponte sobre o Rio dos Bobos"), Ponte Gercino Pereira (residencial) e uma terciária de concreto. Nenhuma tag identifica a do laudo; desativada por `status_motivo`. Para ativar: confirmar com a prefeitura qual é a ponte e desenhar o way.
- Estrada Parque: "caminhão de grande porte" sem critério e trajeto por marcos, sem nome da via. A alta temporada 2025/26 já encerrou; o decreto de 2026/27 deve sair em dezembro e vira regra nova.
- Sem caso de rota (nenhuma regra ativa).

## 4217501 Seara/SC (`seara`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `seara_lei2218_2023_contorno_etelvino_tumelero` | ativa (média) | Lei 2.218/2023, arts. 2º, II, 3º, 5º e 8º; Dec. 3.717/2026 | 24 h | PBT acima de 10 t | Rua Prefeito Etelvino Pedro Tumelero, da ponta oeste (descida do Contorno) até a Rua Rico Garghetti (0,8 km) | carreta, terça 10h, ao longo da rua: 0 km, 9,4 km; o VUC passa (0,77 km, 1,3 km) |
| `seara_lei2218_2023_descida_sc283_sc155` | desativada (baixa) | Lei 2.218/2023, art. 2º, I | 24 h | PBT acima de 10 t | vazia (rodovia estadual) | — |
| `seara_dec3717_2026_evento_marco` | desativada (média) | Dec. 3.717/2026, arts. 2º e 8º | 13 a 15/03/2026 (encerrada) | PBT acima de 8 t | vazia | — |

Pendências e observações:

- No OSM a Rua Rico Garghetti é "Rua Rico Carghetti". O ponto inicial do trecho (ponta oeste da Rua Tumelero) é aproximado: o ato fala em "descida do Contorno Viário" sem marco.
- O ato diz "caminhões acima de 10 t" sem dizer PBT ou capacidade; o Dec. 3.717/2026 trata como PBT. Empresas sediadas na zona circulam livremente (não modelado).

## 4218806 Turvo/SC (`turvo`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `turvo_dec68_2023_tvo352` | ativa (média) | Dec. 68/2023, art. 1º, II; art. 2º (exceções, inclusive escoamento da produção dos imóveis na rodovia) | 24 h | PBT acima de 15 t | 6 ways do OSM com `ref=TVO-352`, da divisa com Timbé do Sul à Rua São João Batista, Morro Chato (4,7 km nos dois sentidos) | carreta, terça 10h, de Morro Chato à divisa: 0,02 km, 23,2 km; o VUC usa (4,3 km, 4,6 km) |
| `turvo_dec68_2023_tvo150` | desativada (baixa) | Dec. 68/2023, art. 1º, I | 24 h | PBT acima de 15 t | vazia | — |

Pendências e observações:

- A TVO-150 ("Vila Progresso até a SC-285") não é identificável: não existe SC-285 (a Lei 2.549/2023 cita a BR-285) e as Leis 2.547/2023, 2.549/2023 (TVO-374/375) e 2.700/2026 renumeraram trechos.
- A exceção do art. 2º, IV (escoamento agropecuário de imóveis nas rodovias) fica só em `excecoes`: o perfil do veículo não carrega a origem da carga.

## 4219309 Videira/SC (`videira`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `videira_lei2685_2011_area_central` | ativa (média) | Lei 2.685/2011, art. 1º e quadro de 19 vias, arts. 3º, 4º, 6º, 7º | 24 h | caminhão-trator articulado (semirreboque e CVC) | 19 vias do quadro por nome (~13 km; Av. Dom Pedro II pelo Valhalla, mão única) | carreta, terça 10h, oeste-leste do centro: 0 km, 13,1 km; o toco atravessa (1,77 km, 3,5 km) |
| `videira_lei2685_2011_art2_tres_eixos` | desativada (baixa) | Lei 2.685/2011, art. 2º | 9h-19h15 (leitura ambígua) | mais de 3 eixos | vazia (área central sem perímetro) | — |

Pendências e observações:

- Graneleiro e transporte de carga viva (por carroceria/carga) não são representáveis no perfil do veículo: ficam de fora do alvo.
- Rua Saul Brandalise e Rua XV de Novembro também são trechos da SC-355; entram porque o ato as nomeia. Consequência: rota de passagem de carreta por Videira pela SC-355 dá volta (16,9 km contra 4,2 km do toco, em teste). A competência municipal sobre o trecho estadual não está documentada; revisar se a volta for inaceitável.
- Rua Coronel Alberto Schmidt = "Rua Coronel Schmidt" no OSM; Rua Bulcão Vianna = "Rua Bulcão Viana"; Rua Alberto Zoller foi limitada ao trecho Rua Lauro Müller - Av. Manoel Roque (o ato só diz "até a Rua Manoel Roque"; a ponta inicial é aproximada).
- Sinalização exigida em 120 dias (art. 6º) não comprovada.

## 4219358 Vitor Meireles/SC (`vitor-meireles`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `vitormeireles_dec009_2025_ponte_denecke` | ativa (média) | Dec. 009/2025, arts. 1º, 2º e 6º | 24 h | PBT acima de 10 t e comprimento acima de 7 m (tara acima de 2 t não modelada) | way `bridge=yes` de 86 m sobre o Rio Itajaí do Norte, no limite com Itaiópolis | carreta, terça 10h, de Vitor Meireles a Itaiópolis: não usa a ponte (0 km, 70,4 km); o VUC usa (0,10 km, 68,1 km) |

Pendências e observações:

- O OSM não nomeia a ponte. Foi a única ponte rodoviária (`bridge=yes`, 86 m, `highway=unclassified`) sobre o Rio Itajaí do Norte no limite com Itaiópolis, ao lado da "Estrada para Itaiópolis" e do Rio Deneke próximo. Localização por exclusão: confirmar com a prefeitura. A ponte tem `hazard=flooding` no OSM.
- Divergência de datas no próprio ato (cabeçalho 05/02/2025, assinatura 16/12/2024). A ponte está na divisa: Itaiópolis tem decreto próprio (fora do lote).

## 4220000 Balneário Rincão/SC (`balneario-rincao`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `balneariorincao_dec057_2020_icr_33t` | ativa (média) | Dec. 057/2020, art. 1º, I e II, §§ 1º e 2º, arts. 2º e 3º | 24 h | mais de 4 eixos e PBT acima de 33 t | 3 trechos entre os pontos UTM (SIRGAS 2000, 22S, convertidos): ICR-353 2,7 km, ICR-358 2,7 km, ICR-350 2,0 km (nos dois sentidos, pelo Valhalla) | carreta, terça 10h, trecho B (ICR-350): 0,03 km, 11,2 km; o toco usa (1,93 km, 1,93 km) |
| `balneariorincao_dec160_2024_waldemar_petrini` | ativa (média) | Dec. 160/2024, art. 1º e §§ 1º e 2º | 24 h | qualquer caminhão | Av. Waldemar Carlos Petrini, da SC-445 à Rua Adelino Rossoni (3,8 km) | toco, terça 10h: 0,02 km, 4,9 km (evita a avenida) |
| `balneariorincao_dec136_2020_pedreiras` | desativada (média) | Dec. 136/2020, art. 1º, § 1º, art. 2º | 24 h | PBT acima de 7,7 t | vazia (ruas do Bairro Pedreiras sem nome) | — |
| `balneariorincao_dec164_2020_waldemar_petrini` | revogada (média) | Dec. 164/2020, art. 1º; sucedido pelo Dec. 160/2024 | até 21/10/2024 | qualquer caminhão | vazia (registro histórico) | — |

Pendências e observações:

- Conversão UTM -> WGS84: EPSG:31982 (SIRGAS 2000 / UTM 22S) para 4326 com pyproj; pontos 1-3 do trecho A e 1-2 do trecho B conferidos contra a malha (a ICR-353 do ato é a SC-100 "Rodovia Jorge Fortulino" no OSM; a ICR-358, "Rodovia Ibanez Zanette"; a ICR-350, "Rodovia Antônio Pedro Cândido", renomeada Av. Gilmar Celoy Custódio pela Lei 728/2025 sem mudar o trecho). Extensões do OSM batem com as do ato (2,66, 2,68 e 1,97 km contra 2,65, 2,64 e 1,92 km).
- Trecho A (ICR-353/358): a rota de carreta desvia, mas o destino na rótula de Barra Velha faz a rota encostar 0,09 km na via (acima da tolerância do teste, 0,05 km); por isso o caso fixado é o trecho B.
- As ICR são tratadas como rodovias municipais pelos atos municipais; não foi conferido no cadastro do DEINFRA se alguma é estadual.
- Dec. 160/2024 e o 164/2020 (revogado de fato): o 160 não traz cláusula revogatória expressa.
