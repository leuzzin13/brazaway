# mun_sudeste — lote IMP01 (3 municípios do ES e 8 de MG)

Regras municipais de caminhão de Cachoeiro de Itapemirim, Itarana e Pedro Canário (ES) e de Araxá, Arcos, Astolfo Dutra,
Betim, Brasilândia de Minas, Campo Florido, Campos Gerais e Capinópolis (MG). Estão na camada genérica `restricoes_rmsp`
(`data/raw/municipios/<ibge>.json`, formato em [`../../restricoes_municipais.md`](../../restricoes_municipais.md)) e vêm da
pesquisa em `docs/research/cidades_sudeste/res/<ibge>.json`, com as correções de `verif/<ibge>.json` (verificação de 11/10/2026).

Resumo: **11 regras ativas** em 7 municípios (8 vias/ponte e 3 zonas), **9 registros desativados** e **1 revogado**.
Itarana, Pedro Canário, Brasilândia de Minas e Capinópolis ficaram **sem regra ativa** porque não há geometria confiável
(ver as seções). Os casos de rota foram conferidos na API real e estão em `api/test/fixtures/mun_sudeste/<ibge>.json`. Eles
rodam em `api/test/layers/mun_sudeste.test.ts`, e os 22 testes do lote passaram em 11/10/2026.

## Como a geometria foi feita

O Overpass estava fora do ar. As vias com nome vêm do cache `data/cache/municipios/osm_named_<ibge>.json`, gerado do PBF
local do Valhalla. O que o cache não tem (vias sem nome, pontes, nós `place=*`, prefeituras) foi lido do mesmo PBF
(`data/valhalla/sudeste-latest.osm.pbf`) com pyosmium, fora do importador. Tudo isso é OSM (ODbL 1.0) e está declarado em
`fonte.licenca`. O limite municipal (`ibge_malha_<ibge>.geojson`) foi baixado da API de malhas do IBGE para o cache, porque
o container do importador não resolve DNS externo.

- **Vias por nome** (`construir: "trechos"`): os nomes são exatamente os do OSM. O import montou `geo/<ibge>_vias.geojson`
  com `pendencias` vazias em todos os municípios. Quando várias regras dividem as mesmas vias (Cachoeiro), cada regra traz os
  seus `trechos`, porque o importador filtra as feições por `regra_id`.
- **Polígono por vias-limite** (Araxá): os eixos do OSM das vias do ato, em sequência, foram ligados nos cruzamentos (caminho
  mais curto sobre a própria via) e simplificados a 2 m.
- **Área urbana aproximada** (Arcos e Campo Florido): faixa de 45 m em torno das vias `residential`/`living_street` e das
  vias com nome e sem `ref` (tertiary, secondary, primary), a até 4,5 km (Arcos) ou 3 km (Campo Florido) do centro. Depois
  vêm o fechamento de 80 m e a abertura de 70 m (que tira os braços ao longo de estradas), só o componente da sede, sem
  buracos, e o recorte pelo limite do IBGE. Por fim sai uma faixa de 25 m em torno das rodovias que o ato exclui ou que não
  são municipais, e o resultado é simplificado a 5 m. Na rota a zona ainda é recuada 20 m. As props levam `aproximado: true`.
- **Sem geometria confiável**: a regra entra `desativada` e o registro usa o limite do município (`municipios: [<ibge>]`).
  Isso vale também para regra de via (Itarana, Brasilândia), registrada como zona só para o aviso `municipal_regra_nao_aplicada`,
  porque o formato exige linha para `tipo: via` e uma linha inventada daria avisos falsos.

---

## 3201209 Cachoeiro de Itapemirim (`cachoeiro-de-itapemirim`)

Decreto 34.592/2024 (DOM nº 7153, 07/10/2024), em vigor desde 05/04/2025 (art. 15). Ele cria três faixas sobrepostas nas
10 vias do Anexo Único e excetua domingos e feriados. O município não define VUC.

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `cachoeiro_vias_16t_articulados_picos` | ativa (alta) | Dec. 34.592/2024, art. 1º, I, a; art. 3º; Anexo Único | dias úteis 6h–8h30, 11h–13h30, 16h30–19h; sáb 8h–14h | PBT > 16 t ou articulado | `geo/3201209_vias.geojson` (trechos): 10 vias inteiras no OSM, aproximado | evita: truck, R. Coronel Borges/R. Moreira, ter 7h (0 km) × 10h (0,9 km) |
| `cachoeiro_vias_25t_articulados_diurno` | ativa (alta) | art. 1º, I, b | dias úteis 6h30–19h; sáb 8h–14h | PBT > 25 t ou articulado | mesmas vias | evita: carreta, Av. Mauro Miranda Madureira, ter 10h (0,04 km, 11,6 km) × dom 10h (2,9 km) |
| `cachoeiro_vias_23t_semirreboque_diurno` | ativa (alta) | art. 1º, I, c | dias úteis 6h30–20h; sáb 6h–14h | PBT > 23 t ou semirreboque | mesmas vias | evita: carreta, Mauro Miranda Madureira, ter 19h30 (só a faixa c) × 20h30 |
| `cachoeiro_carga_descarga_25t` | desativada | art. 2º, I, a e b; art. 11, §5º | (operação proibida) dias úteis 6h–20h; sáb até 14h | PBT > 25 t | mesmas vias (as vagas do Anexo não estão georreferenciadas) | — |

Vias: Av. Jones dos Santos Neves, Av. José Felix Cheim, Av. Aristides Campos, Av. Francisco Lacerda de Aguiar, Av. Beira Rio,
Av. Mauro Miranda Madureira, R. Jerônimo Ribeiro, R. Coronel Borges, R. Moreira e Av. José Rosa Machado.

Pendências:

- As pontas do mapa do Anexo Único não foram recortadas: as vias entram inteiras, e a Jones dos Santos Neves vai até o oeste
  residencial.
- O import descartou 3 pedaços da Av. Jones dos Santos Neves no sentido contrário, porque não casaram com o grafo.
- Seed de 1,2 MB, porque as 4 regras repetem as mesmas linhas.

## 3202900 Itarana (`itarana`)

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `itarana_santa_rita_pbt23` | desativada (média) | Dec. 2.351/2026, art. 1º e §§ 1º–2º, art. 2º, art. 6º | 24 h | PBT > 23 t | município (só registro) | — |

Pendência: a regra está **sem geometria confiável**. O ato não nomeia a via nem dá a extensão ("via rural pavimentada da
comunidade de Santa Rita, entre a ES-164 e o interior da comunidade"). O OSM de Itarana não tem a comunidade de Santa Rita
(nem nó `place`) nem uma "Estrada de Santa Rita". Para ativar como via, é preciso localizar o trecho com a Prefeitura.

## 3204054 Pedro Canário (`pedro-canario`)

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `pedro_canario_sjb_saturnino_cargas_25t` | desativada (média) | Lei 767/2006, arts. 1º–3º e 5º | 24 h | capacidade > 25 t ou PBT > 40 t (CMT) | município (só registro) | — |

O id da pesquisa era `3204054_sjb_saturnino_cargas_25t` e foi prefixado com a cidade.

Pendência: a regra está **sem geometria confiável**. A lei não nomeia as ruas, o mapa anexo é ilegível e os bairros São João
Batista e Saturnino Mauro não aparecem no OSM (o PBF tem 13 bairros de Pedro Canário como nó, e nenhum é esse).

## 3104007 Araxá (`araxa`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `araxa_zona_restricao_centro` | ativa (média) | Lei 7.334/2019, art. 2º, I; art. 3º, I e II; art. 4º | seg–sex 8h–18h; sáb 8h–14h, exceto feriados | capacidade de carga > 8 t | `geo/3104007_zona_restricao.geojson` (manual, eixos do OSM; 0,61 km²) | evita: carreta de oeste para leste do centro, ter 10h (0 km, 4,1 km) × 19h (0,31 km dentro) |
| `araxa_zona_restricao_vias` | ativa (média) | art. 2º, I (vias-limite incluídas) e II (Av. Senador Montandon, Av. Imbiara, R. Belo Horizonte) | idem | idem | `geo/3104007_vias.geojson` (trechos; vinculada à zona) | evita: carreta, sul da Getúlio Vargas → leste, ter 10h (0 km) × 19h (0,76 km) |
| `araxa_lei_6078_2011_revogada` | revogada | Lei 6.078/2011 (revogada pelo art. 7º da Lei 7.334/2019) | — | caminhão | polígono da 7.334 só como referência (o Anexo I não existe online) | — |

O polígono passa por Av. Getúlio Vargas (Matriz de São Domingos), R. Calimério Guimarães, Av. Senador Montandon,
R. Cônego Cassiano, R. Alexandre Gondim, R. Zeca Montandon, R. Padre Anchieta, Av. Vereador João Sena, R. Carvalho Lopes e
R. Costa Sena. Diferenças em relação ao texto:

- **(a)** A volta Av. Cap. Belarmino → Av. Wilson Borges → R. Calimério não fecha área, porque as vias são quase paralelas e
  a Wilson Borges só encontra o prolongamento da Calimério na rotatória ao sul. Esse trecho entra só nas vias-limite.
- **(b)** O trecho "Av. Amazonas até a R. Carvalho Lopes" é, no OSM, a própria Av. Vereador João Sena (a Amazonas começa na
  rotatória a noroeste).
- **(c)** A R. Calimério Guimarães foi montada em duas partes por causa do binário na Belarmino.

Pendências:

- Lei de iniciativa parlamentar, sem decreto de regulamentação nem prova de sinalização.
- O TJMG não foi consultado.

## 3104205 Arcos (`arcos`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `arcos_perimetro_urbano_passagem` | ativa (média) | Lei 2.253/2009 (Código de Posturas), art. 33, p. único | 24 h | todo caminhão; exceção de destino no município | `geo/3104205_perimetro_urbano.geojson` (manual, área urbana aproximada; 12,7 km²) | evita: toco da borda leste para Pains, ter 10h (0 km, 35,4 km); utilitário corta a cidade (4,8 km dentro, 24,9 km) |
| `arcos_perimetro_urbano_perigosos` | desativada (média) | art. 94, § 3º | 24 h | (explosivos/inflamáveis: sem predicado) | mesma área | — |

A área urbana é aproximada, porque o perímetro da Lei 2.260/2009 não está georreferenciado. Dela saem as rodovias com `ref`
BR-/MG-/LMG-/AMG- e as vias primary/trunk sem `ref`. A travessia urbana da MG-170 pela Av. Laura Andrade não tem `ref` no OSM;
na primeira versão ela ficou dentro da zona e jogou Japaraíba–Pains de 49 km para 137 km, o que foi corrigido.

Também foram conferidos dois casos:

- Japaraíba–Pains pelas rodovias passa livre.
- Pains → Centro (destino na zona) entra e recebe o aviso `rmsp_destino_na_zona`.

Pendências:

- O ato alcança só caminhão **carregado**, mas o perfil do veículo não distingue carregado de vazio: todo caminhão entra,
  pelo lado seguro.
- Polígono oficial do perímetro.
- Lei de 2009 sem sinalização confirmada.

## 3104601 Astolfo Dutra (`astolfo-dutra`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `astolfo_dutra_ponte_joao_henrique_oliveira_3t` | ativa (alta) | Dec. 772/2026, art. 1º e p. único, art. 5º | 24 h | PBT > 3 t | `geo/3104601_vias.geojson` (trechos, `tipo: ponte`): R. João Henriques de Oliveira inteira (1,5 km), aproximado | evita: toco desvia pelo sul (0,05 km nas esquinas, 2,7 km); um utilitário usa 0,95 km da rua |
| `astolfo_dutra_desvio_mg285_passagem` | desativada (alta) | Dec. 774/2026, art. 1º §§1º–2º, art. 2º | — | caminhão em passagem | município (só registro) | — |

Pendências:

- A ponte não está no OSM: a R. Laurindo José Fernandes não tem nome e a rua não tem trecho com `bridge=yes`. Por isso a
  interdição foi aplicada à rua inteira, pelo lado seguro.
- A camada só alcança caminhão (PBT > 3,5 t), então veículos de 3 t a 3,5 t não são cobertos.

## 3106705 Betim (`betim`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `betim_av_amazonas_8t` | ativa (média) | Lei 5.797/2014, art. 1º, I e §1º | seg–sex 7h–19h30 (feriados não excetuados) | capacidade > 8 t | `geo/3106705_vias.geojson`: Av. Amazonas da ponta leste (Centro) até a altura da Prefeitura (R. Pará de Minas, 640), 1,9 km, aproximado | evita: carreta Centro → Brasiléia, ter 10h (0,03 km, 4,6 km) × 20h (1,9 km na via) |
| `betim_rua_dr_gravata_8t` | ativa (média) | art. 1º, II | idem | idem | R. Doutor Gravatá inteira | evita (caso fraco): carreta, ter 10h (0,004 km) × 20h (0,04 km) |
| `betim_centro_carga_descarga` | desativada (média) | art. 2º, I a III | operação de carga e descarga | capacidade > 4/8 t, carretas | município (só registro; o ato não delimita o centro) | — |
| `betim_av_do_brasil_bandeirinhas` | desativada (baixa) | notícia do Órgão Oficial de 29/03/2012 (sem artigo) | — | caminhão, sentido BR-381 | Av. do Brasil, pista norte | — |

Pendências:

- O "início" da Av. Amazonas foi lido como a ponta leste, no Centro.
- Lei de iniciativa parlamentar que o Executivo vetou por inconstitucionalidade; o TJMG não foi consultado.
- Sinalização não confirmada.

## 3108552 Brasilândia de Minas (`brasilandia-de-minas`)

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `brasilandiademinas_serra_bouqueirao_pbt_3_5t` | desativada (média) | Lei 564/2018, arts. 1º e 2º | 24 h | PBT > 3,5 t | município (só registro) | — |

Pendência: a regra está **sem geometria confiável**. A lei fala da "serra do Bouqueirão, também conhecida como Serra
Extrema". No OSM, a cumeada "Serra do Boqueirão" (cerca de −46,08/−16,77) e o pico "Serra Extrema" (cerca de −46,00/−16,98)
ficam a uns 25 km um do outro, e nenhuma via tem esses nomes.

## 3111408 Campo Florido (`campo-florido`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `campo_florido_area_urbana_pbt_30t` | ativa (média) | Lei 1.615/2022, art. 1º e p. único; arts. 3º §2º, 8º, 10, 11 | 24 h | PBT > 30 t | `geo/3111408_area_urbana.geojson` (manual, área urbana aproximada; 2,5 km²), sem BR-262 e MGC-455 | evita: carreta da MGC-455 para a saída nordeste (0 km, 24,1 km); toco de 16 t passa 0,13 km dentro (7,7 km) |

No OSM, um trecho da MGC-455 aparece só como BR-455 (Rodovia Virgílio Galassi) e também foi recortado.

Pendência: a área urbana não tem limite oficial.

## 3111606 Campos Gerais (`campos-gerais`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `camposgerais_pio_xii_veiculos_pesados` | ativa (média) | Lei 3.541/2019, art. 1º (red. Lei 3.553/2019) | 24 h | todo caminhão ("veículos pesados" não definidos) | `geo/3111606_vias.geojson`: R. Pio XII inteira | evita: toco contorna pelas transversais (0,02 km); utilitário usa 0,49 km |

Pendências:

- O verificador tirou da regra ativa o trecho da R. Júlio Braz Pereira, que só aparece nas ementas. A interpretação continua
  em aberto.
- A exceção da COOXUPÉ (destino na própria rua) não é representável.

## 3112604 Capinópolis (`capinopolis`)

| id | status | ato e artigo | janela | alvo | geometria | casos |
|---|---|---|---|---|---|---|
| `capinopolis_ideal1_parte_primitiva` | desativada (média) | Dec. 3.471/2012, arts. 1º–6º | 24 h | caminhão (exceto destino no perímetro urbano) | município (só registro) | — |

Pendência: a regra está **sem geometria confiável**. O decreto não descreve os limites do Bairro Ideal I nem da "Parte
Primitiva", e o OSM não tem esses bairros. O `origem_destino_dentro: "permite"` da pesquisa está fora do formato e foi
trocado por `excecao_destino_local`.

---

## Observações para as outras frentes

- O import (`municipios:<ibge>`) valida **todos** os arquivos antes de filtrar. Um município de outro lote com geometria
  manual ainda ausente derruba a carga de todos. Para importar no meio do trabalho dos outros lotes, a carga foi feita com
  `MUNICIPIOS_DIR` apontando para uma pasta com o `schema.json` e só o arquivo do município. A validação completa
  (`--validar`) foi rodada no fim: 100 arquivos válidos.
- `MUNICIPIOS_REBUILD=1` também tenta "reconstruir" os GeoJSON `construir: manual` e falha. Para refazer só as vias, o
  caminho foi apagar o `geo/<ibge>_vias.geojson` e importar sem a variável.
