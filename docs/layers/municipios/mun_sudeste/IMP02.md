# mun_sudeste — lote IMP02 (11 municípios de MG)

Regras municipais de caminhão de Carbonita, Congonhas, Conselheiro Lafaiete, Cristália, Diamantina, Formiga, Frutal,
Grão Mogol, Ibiá, Itaúna e Iturama, implementadas na camada genérica `restricoes_rmsp`
(`data/raw/municipios/<ibge>.json`, formato em [`../../restricoes_municipais.md`](../../restricoes_municipais.md)) a partir da
pesquisa em `docs/research/cidades_sudeste/res/<ibge>.json`, com as correções de `verif/<ibge>.json` (verificação de 11/10/2026).

Resumo: **10 regras ativas** em 9 municípios (4 vias, 6 zonas), **13 registros desativados** e **1 revogado**. Conselheiro
Lafaiete e Grão Mogol ficaram sem regra ativa (ver as seções). Casos de rota conferidos na API real em
`api/test/fixtures/mun_sudeste/<ibge>.json`, rodados por `api/test/layers/mun_sudeste.test.ts` (todos passando em 11/10/2026).

## Como a geometria foi feita

O Overpass estava fora do ar. As vias com nome vêm do cache `data/cache/municipios/osm_named_<ibge>.json` (gerado do PBF
local do Valhalla); o que o cache não tem (vias sem nome, pontes, pedestres, nós `place=*`) foi lido do mesmo PBF
(`data/valhalla/sudeste-latest.osm.pbf`) com pyosmium, fora do importador. Tudo é OSM (ODbL 1.0), declarado em `fonte.licenca`.

- **Vias por nome** (`construir: "trechos"`): nomes exatamente como no OSM; o import montou os GeoJSON `geo/<ibge>_vias.geojson`
  com `pendencias` vazias em todos os municípios.
- **Área urbana aproximada** (Congonhas, Formiga, Iturama e o registro do bitrem de Lafaiete): ruas do OSM
  (residential, living_street, tertiary, secondary, primary, unclassified com nome, pedestrian), sem as rodovias, a até
  4,5–6 km do centro; cada rua com buffer de 45 m; fechamento morfológico de 90 m; só o componente contínuo da sede, sem
  buracos; recuo de 45 m (o contorno fica sobre as ruas mais externas: aproximação **conservadora**, menor que a área
  urbana real); recorte pelo limite do IBGE; menos uma faixa de 40 m das rodovias com `ref` BR/MG/MGC (o município não regula
  rodovia estadual/federal); simplificação de ~5 m. Na rota a zona ainda é recuada 20 m.
- **Congonhas**: a área acima recortada pelas células de Voronoi dos nós `place=suburb` do OSM, ficando só as dos bairros
  da Tabela I do Dec. 5.795/2013.
- **Diamantina**: envoltória convexa dos 15 pontos de placa do art. 17 da Lei 3.693/2011, localizados nos cruzamentos do OSM.
- **Cristália** e **Grão Mogol**: círculo em torno de um nó do OSM (ver as seções).
- Todas as zonas levam `aproximado: true` nas props.

---

## 3113503 Carbonita (`carbonita`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `carbonita_estrada_estiva_acima_2_eixos` | ativa (média) | Lei 901/2021, art. 1º, p. único e art. 2º | 24 h, todos os dias | caminhão com mais de 2 eixos | `geo/3113503_estrada_estiva.geojson` (manual): ways OSM 840489249, 840489248 (ponte) e 221882917, sem nome, do fim da Av. Diamantina à BR-367 (~14,7 km), aproximado | sem_alternativa: cidade → meio da estrada, carreta usa 6,2 km e o roteador avisa `uses_restricted_way` |
| `carbonita_cmg367_cvc_15t` | desativada (baixa) | Dec. 793/2021, art. 2º | 24 h | PBT ≥ 15 t ou CVC | `geo/3113503_cmg367.geojson`: BR-367/MGC-367 (way 334844773) recortada ao município | — |

Pendências:
- O OSM não tem os nomes "Estiva", "trevo do Cristo" nem "ponte da Soledade": a estrada foi identificada pelo percurso do
  art. 1º (saída da cidade → ponte → BR-367). Conferir em campo/imagem.
- Sem caso "evita": a estrada é de terra e o roteador não a escolhe nem para o toco (a rota livre também contorna pela
  BR-451/BR-367). O caso gravado é `sem_alternativa` (destino no meio da própria estrada).

## 3118007 Congonhas (`congonhas`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `congonhas_bairros_3_eixos` | ativa (alta) | Dec. 5.795/2013, art. 1º e Anexo I, Tabela I; art. 4º | 24 h, todos os dias | mais de 2 eixos ou carreta (semirreboque, reboque, CVC) | `geo/3118007_bairros_anexo_i.geojson` (manual, aproximado, 9,6 km²) | evita: BR-040 sul → Rodovia Casa de Pedra, truck (3 eixos) 34,9 km, 0 km na zona; toco atravessa (3,7 km na zona) |
| `congonhas_mineradoras_sujeira_minerio` | desativada (alta) | Dec. 5.354/2011, art. 1º | 24 h | caminhão | mesmo polígono | — |

Pendências:
- Sem polígono oficial: 30 dos 40 bairros da Tabela I têm nó no OSM (o nó "Residencial" foi tratado como um dos
  residenciais da Tabela I, provavelmente o Guálter Monteiro); os outros 10 (Complemento Boa Vista, Cruz das Almas,
  Cruzeiro, Fonte das Águas, Novo Belvedere, Novo Rosário, Romaria, Vila Andreza, Vila Nereu, Vila Glicéria) caem nas células
  vizinhas. Excluídas as células de Jardim Profeta, Campinho, Nova Cidade, Primavera, Consolação,
  Pascoal Vartulli, Recanto das Andorinhas, Vila Ventura e de bairros afastados.
- Exceção da Rua Santo Antônio (bairro Praia, acesso a Casa de Pedra) e janelas de carga e descarga do art. 4º só nos
  avisos; com origem ou destino dentro da zona a rota não exclui e avisa.
- O "novo decreto" anunciado em 06/2025 não foi achado; se sair, rever.

## 3118304 Conselheiro Lafaiete (`conselheiro-lafaiete`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `lafaiete_ver_caminhoes` | **desativada** (unverifiable) | Portaria 356/2017-DMTT, art. 2º, §1º; Dec. 92/2017, arts. 2º–4º | seg–sex 6–9, 11–13, 16–19; sáb 7–14 | caminhão (VUC 2,20 × 8 m × 16 t com AETC) | `geo/3118304_vias.geojson` (trechos, 11 das 12 VER) | — |
| `lafaiete_amrc` | desativada (unverifiable) | Portaria 356/2017-DMTT, art. 1º; Dec. 92/2017, art. 2º, I | idem | caminhão | `geo/3118304_amrc_aproximada.geojson`: envoltória das vias da Lei 5.258/2010 a até 600 m da Praça Tiradentes (0,52 km², NÃO é o perímetro) | — |
| `lafaiete_bitrem_carregado` | desativada (unverifiable) | Portaria 356/2017-DMTT, art. 2º, §2º e Anexos I–V | 24 h | CVC | `geo/3118304_area_urbana_aproximada.geojson` (área urbana aproximada) | — |
| `lafaiete_centro_carga_descarga` | desativada (alta) | Lei 5.258/2010, arts. 1º, 3º, 4º (red. Lei 5.407/2012) | fora de seg–sex 7–11 | caminhão | `geo/3118304_vias.geojson` (trechos, 27 das 28 vias) | — |

Pendências:
- **VER desativada**: a pesquisa a trazia ativa (média), mas o veredito do verificador é `inverificavel` (PDFs oficiais em
  403/Cloudflare, sem cópia alternativa); pela regra do lote, inverificável entra desativado. A geometria das 11 VER está
  pronta: para ativar, conferir de outra rede o art. 2º, §1º, as janelas e o art. 15 (VUC) e trocar `status`/`confianca`.
- Rua Fernando Bedran Peixoto (VER) e Praça Getúlio Vargas (C/D) sem correspondente no OSM. Nomes do OSM usados: Rua
  Alfredo Elias Mafuz, Rua Joemir Farias/Joemir de Farias, Rua Aimorés, Rua José Nicolau de Queiroz, Avenida Professor
  Telesforo Cândido de Rezende, Rua Benjamim Constant, Rua Artur Bernardes.
- AMRC sem perímetro publicado (ato específico do DMTT não achado).

## 3120300 Cristália (`cristalia`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `cristalia_croslandia_5_eixos` | ativa (média) | Dec. 52/2022, art. 1º, I a VI | 24 h, todos os dias | mais de 4 eixos | `geo/3120300_croslandia.geojson`: círculo de 300 m em torno do nó `place=hamlet` Croslândia do OSM (aproximado) | evita: estrada Cristália → sul, carreta 19,6 km, 0 km na zona; truck (3 eixos) atravessa (0,66 km) |

Pendências e decisões:
- O decreto não delimita a comunidade e o OSM não tem as ruas dela: núcleo aproximado de 300 m. Conferir com imagem.
- O rascunho trazia `excecao_destino_local: true`; não foi usado porque, no formato, isso isenta qualquer destino no
  **município**, e o ato (art. 1º, VI) só excetua origem/destino **na comunidade**, que a regra de zona já trata (origem ou
  destino dentro: não exclui e avisa).

## 3121605 Diamantina (`diamantina`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `diamantina_centro_historico_pesados_circulacao` | ativa (média) | Lei 3.693/2011, art. 9º, arts. 15–17; Dec. 259/2025 (PMUS), art. 62, VII | 24 h, todos os dias | PBT > 7 t, comprimento > 6,5 m, ou carreta/reboque/CVC | `geo/3121605_centro_historico.geojson`: envoltória dos 15 pontos de placa do art. 17 (0,98 km², aproximado) | evita: norte → sul do centro, toco 5,7 km, 0 km na zona; utilitário atravessa (1,47 km) |
| `diamantina_centro_historico_carga_descarga_7t` | desativada (média) | Lei 3.693/2011, art. 7º, art. 3º, art. 8º | — | PBT > 7 t ou comprimento > 6,5 m | mesmo polígono | — |

Pendência: a poligonal de tombamento (IPHAN/IEPHA) não foi obtida; o polígono segue o entorno sinalizado do art. 17.

## 3126109 Formiga (`formiga`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `formiga_area_urbana_14t` | ativa (média) | Dec. 6.911/2016, art. 1º, I a IV e p. único | 24 h, todos os dias | PBT > 14 t, semirreboque ou CVC | `geo/3126109_area_urbana.geojson` (área urbana aproximada, 18,4 km², sem MG-050/BR-354) | evita: sul → norte da sede, truck 24,4 km pelo contorno, 0 km na zona; VUC atravessa (6,3 km) |
| `formiga_lei3528_20t_licenca` | desativada (alta) | Lei 3.528/2003, arts. 1º, 2º, 5º, 8º | 24 h | PBT > 20 t | mesmo polígono | — |
| `formiga_ponte_rio_formiga_5t_2014` | revogada (alta) | Dec. 6.283/2014, arts. 2º e 5º (180 dias) | — | PBT > 5 t | `geo/3126109_ponte_rio_formiga.geojson`: way 852345071 (ponte em obra no fim da Av. Rio Branco), aproximado | — |
| `formiga_porticos_praca_matriz` | desativada (baixa) | notícias da Prefeitura | 24 h | altura > 2,75 m | `geo/3126109_vias.geojson` (Praça São Vicente Férrer, Praça Olegário Maciel) | — |
| `formiga_ponte_baioes` | desativada (baixa) | comunicado da Prefeitura | 24 h | caminhão | `geo/3126109_ponte_baioes.geojson`: way 495695013 (aproximado) | — |

Pendências: perímetro urbano da Lei 4.686/2012 não obtido (área aproximada); bairros Industrial e Ouro Negro (exceção de
carga e descarga) não identificados no OSM e não recortados (destino neles já não exclui, por estar dentro da zona); a
travessia de rodovia com `ref` que corta a cidade ficou fora do polígono (faixa de 40 m).

## 3127107 Frutal (`frutal`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `frutal_av_benjamin_constant` | ativa (média) | Dec. 9.114/2013, art. 1º; arts. 2º, 3º, 5º, 6º | 24 h, todos os dias | caminhão; exceção de entrega local (art. 2º, I, II, IV) | `geo/3127107_vias.geojson`: Avenida Benjamin Constant da Av. Brasília ao extremo oeste (Praça da Matriz), 1,3 km, mão única (MG-255) | evita: centro → leste fora de Frutal, toco 46,8 km, 0 km na via; utilitário usa 1,34 km |
| `frutal_calcadao` | desativada (alta) | Lei 5.808/2011, art. 1º; Lei 5.809/2011, art. 5º | seg–sex fora de 7–9 e 18–24 | caminhão | `geo/3127107_calcadao.geojson`: ways pedestrian 226476569 e 226476562 | — |
| `frutal_euvaldo_lodi_placa` | desativada (baixa) | Ofício 165/2010 da Câmara (não normativo) | 24 h | caminhão | `geo/3127107_vias.geojson`: Avenida Euvaldo Lodi inteira (aproximado) | — |

Pendências: a "Rua Cônego Osório" (ponta oeste do decreto) não existe com esse nome no OSM (trecho até o extremo oeste,
aproximado); a avenida é a travessia urbana da MG-255 (jurisdição a confirmar). Com destino em Frutal a regra não se aplica
(exceção de entrega local), por isso o caso de rota tem destino fora do município.

## 3127800 Grão Mogol (`grao-mogol`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `grao_mogol_centro_historico_12t` | **desativada** (média) | Dec. 012/2014, arts. 1º e 3º; Lei 841/2014, art. 1º | 24 h | capacidade de carga > 12 t | `geo/3127800_centro_aproximado.geojson`: círculo de 250 m na praça central, só registro | — |

Pendências: regra confirmada, mas **sem geometria confiável** — o centro histórico é o dos Anexos I e II da Lei 841/2014,
não publicados. Ativar quando o perímetro for obtido. O id da pesquisa (`3127800_centro_historico_12t`) foi renomeado com o
prefixo da cidade, e o `alvo` do rascunho (`"caminho": true`) foi corrigido para `"caminhao": true`.

## 3129509 Ibiá (`ibia`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `ibia_rua20_transito_pesado` | ativa (média) | Lei 1.119/1984, arts. 1º e 2º | 24 h, todos os dias | caminhão ("trânsito pesado" sem definição) | `geo/3129509_vias.geojson`: Rua Vinte entre a Praça São Pedro e a Praça Santa Cruz (~745 m) | evita: Praça São Pedro → sul, toco 2,13 km, 0 km na via; utilitário usa 0,76 km |

Pendência: o trecho no OSM é a travessia urbana da MG-235 (ref MG-235).

## 3133808 Itaúna (`itauna`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `itauna_zrcvc_centro` | ativa (média) | Dec. 6.779/2018, art. 1º, I e II, § 2º; art. 2º, I a LVII; arts. 4º, 6º–9º | seg–sex 6–20; sáb 6–13 | capacidade de carga > 5 t | `geo/3133808_vias.geojson`: 45 dos 57 logradouros (~26 km; Av. Jove Soares só no trecho central, cada pista no seu sentido) | evita: norte → sul do centro, toco às 10h 14,5 km, 0 km nas vias; às 22h passa (2,4 km) |

Pendências: 12 logradouros sem correspondente seguro no OSM (fora da geometria): Praça Luiz Ribeiro, Praça Helvécio F. de
Carvalho, Praça Dois de Junho, Rua Santa Cruz, Rua Vinte e Seis de Junho, Rua Jairo Gomes "Nô", Rua 05 (a do OSM fica fora
do centro), Rua Geraldo Cilico, Rua Geniplo Dornas, Travessa Gonçalves da Guia, Praça Francisco Marques e Rua Genuína Moreira.
"Rua Florentino P. Vasconcelos" casada com a "Rua Florentino Pereira" do centro. "Carga acima de 5 t" lida como capacidade
de carga (ressalva do verificador).

## 3134400 Iturama (`iturama`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `iturama_dim_altura_largura` | ativa (média) | Dec. 6.841/2017, art. 1º, I e II | 24 h, todos os dias | altura > 4,00 m ou largura > 2,60 m | `geo/3134400_perimetro_urbano.geojson` (área urbana aproximada, 12,6 km², sem BR-497/MG-497 e MG-255) | evita: sul → norte da sede, carreta (4,40 m) 32,6 km, 0 km na zona; toco (4,00 m) atravessa (3,9 km) |
| `iturama_dim_comprimento` | ativa (média) | Dec. 6.841/2017, art. 1º, III | 24 h, todos os dias | comprimento > 19,80 m | mesmo polígono | evita: mesmo par, rodotrem de 30 m com 3,90 m de altura, 32,6 km, 0 km na zona |

Pendência: o decreto não delimita o perímetro urbano (área aproximada).

---

## Observações para quem mantém o importador e o teste

- `python -m sources.municipios --validar` e `run.py municipios:<ibge>` validam **todos** os arquivos: um arquivo de outro
  lote em edição (ex.: `3167202.json` com `construir: "trechos"` sem trechos) derruba o import de qualquer município. Este
  lote foi importado com uma cópia isolada do arquivo (`-e MUNICIPIOS_DIR=` apontando para uma pasta com o `<ibge>.json` e o
  `schema.json`), o que não muda a geometria nem o seed. A unicidade de `fonte_id` e de ids de regra foi conferida à parte.
- O import precisa da malha do IBGE (`municipio_geom`) e o contêiner não usa o proxy: os limites dos 11 municípios foram
  baixados no host para `data/cache/municipios/ibge_malha_<ibge>.geojson`.
- `mun_sudeste.test.ts`, caso `sem_alternativa`: o `annotate` não emite `rmsp_via_restrita_na_rota` quando o `routing.ts`
  já avisou `uses_restricted_way` (via dentro do corredor); o teste já aceita os dois avisos (commit 7b2f434).
