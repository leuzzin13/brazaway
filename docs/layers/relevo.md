# Camada `relevo` — rampa e perfil de altitude

Depois que a rota é calculada (Valhalla principal, sem elevação), a camada consulta um **segundo Valhalla com
elevação** (tiles gerados com o MDT **ANADEM v1**) e devolve:

- **rampa máxima de subida** no sentido do percurso e onde ela fica;
- **km acima do limite de atenção** do veículo e **trechos** com nível `atencao`/`evitar` (lat/lon do ponto mais íngreme,
  início/fim, way_ids do OSM, geometria);
- **perfil resumido** (altitude mín./máx., subida e descida acumuladas, até 120 pontos `[km, m]`, km de subida por faixa
  de rampa) e **descidas longas** para veículos pesados;
- **sugestão de `costLines`** (2ª rodada) para os trechos urbanos acima do limite "evitar".

Não muda a rota. Se nenhum Valhalla com elevação estiver no ar, a camada **não anota** (nenhum aviso, nenhum erro).

Arquivos: `api/src/layers/relevo.layer.ts`, `api/src/services/valhalla.ts` (funções `traceAttributesAt`,
`heightProfileAt`, `heightAt`, `encodePolyline6` — `route()` não mudou), `config/grade-limits.json`,
`scripts/build-elevation.sh`, `valhalla/elevation/anadem_to_hgt.py`, `docker-compose.elevation.yml`,
`api/test/layers/relevo.test.ts`.

## Fontes e licenças

| Fonte | O que entra | Licença | Conferido |
|---|---|---|---|
| **ANADEM v1** — Modelo Digital de Terreno para a América do Sul (ANA + UFRGS/IPH), 30 m, tiles MGRS COG em `https://metadados.snirh.gov.br/files/anadem_v1_tiles/anadem_v1_<zona>.tif` | altitude (HGT 1" gerado por nós) | **CC BY 4.0** — "pode copiar, redistribuir, remixar, transformar e criar a partir do material para qualquer fim, inclusive comercial, desde que atribua o devido crédito aos autores" | metadado SNIRH/GeoNetwork `93664c15-1ff8-4e87-bbed-2bb69d321309` (dateStamp 2025-08-20), lido em 09/10/2026 |
| Copernicus DEM GLO-30 (base do ANADEM) | indireto | uso livre com atribuição (© DLR e.V. 2010-2014 e © Airbus Defence and Space GmbH 2014-2018, programa Copernicus) | atribuição de cortesia; a licença do derivado é a do ANADEM |
| OpenStreetMap (via Valhalla) | geometria/classe das vias, pontes/túneis, way_id | ODbL 1.0 | — |

Atribuição a exibir no app (tela de fontes): **"Relevo: ANADEM v1 (ANA/UFRGS), CC BY 4.0 — Laipelt et al. (2024),
*ANADEM: A Digital Terrain Model for South America*, Remote Sensing 16(13):2321, doi:10.3390/rs16132321; derivado do
Copernicus DEM GLO-30."** Nada desta camada vai para o OSM (é só leitura de altitude; nenhum dado é gravado em
`data_features`, por isso não há importador, seed nem migration — o número 0111 reservado ficou sem uso).

DEMs descartados pela pesquisa (`docs/research/elevacao_rampas/NOTES.md`): Skadi/SRTM (pior para rampa urbana),
FABDEM (CC BY-NC-SA), CGIAR SRTM (sem uso comercial), TanDEM-X 90 (só científico). O **LiDAR da PMSP** (0,5 m, erra
metade do ANADEM) é GPL-3.0 e exige gerar DTM a partir de ~190 GB de LAZ: fica como evolução (ver Limitações).

## Como funciona

```
POST /api/route ─► Valhalla principal (8002, sem elevação) ─► rota
                └► relevo.annotate:
                     1. escolhe o Valhalla com elevação: VALHALLA_ELEV_URL, ou localhost:8003, ou o VALHALLA_URL
                        (o primeiro cujo /height na origem devolve altitude; cache 5 min / 1 min)
                     2. trace_attributes (edge_walk sobre a geometria da rota; map_snap se falhar), em pedaços
                        de até 150 km / 12 mil pontos (limite trace do Valhalla: 200 km / 16 mil)
                        atributos: edge.max_upward_grade, edge.max_downward_grade, edge.weighted_grade,
                        edge.mean_elevation, edge.length, edge.way_id, edge.names, edge.bridge, edge.tunnel,
                        edge.road_class, edge.begin/end_shape_index, shape
                     3. /height com range=true na mesma linha, a cada 30 m (perfil)
                     4. compara com config/grade-limits.json
```

Nomes dos atributos conferidos no Valhalla 3.9.1 (`c803bdc2f`) que roda aqui. Detalhes que importam:

- `max_upward_grade`/`max_downward_grade` vêm em **% inteiro arredondado para cima** (postes de 60 m; precisão de 1 p.p.
  até 16% e passos de 4 de 16 a 76). Aresta sem elevação vem com **-500** (é o que o Valhalla principal devolve hoje).
  Por causa do arredondamento para cima, a comparação é sempre `>` limite.
- `weighted_grade` vem em % (já convertido do índice 0–15). Ponte/túnel: o Valhalla limita a ±3%.
- `trace_attributes` e `/height` usam a mesma linha (o `shape` devolvido pelo trace), então as distâncias das arestas e
  do perfil batem (o `/height` mede a distância um pouco diferente; reescalamos pelo comprimento total).
- Os tiles de 8002 e 8003 saem do mesmo PBF e da mesma configuração, então a malha é idêntica e o `edge_walk`
  casa a geometria exatamente (testado). Depois da troca (abaixo) é o mesmo Valhalla.

### Rampa "sustentada" (filtro de ruído do DEM)

Com postes de 60 m, um DEM de 30 m inventa rampa: erro médio de 2,1–2,5 p.p. por intervalo de 60 m em morro
(validação contra o LiDAR, pesquisa §4) e muito mais em rodovia encaixada em encosta — na **Via Anchieta, na serra,
o Valhalla marca subidas de 24%** numa descida contínua. Por isso, para cada aresta:

1. Calculamos no perfil uma **média móvel centrada** da rampa com janela `window_m` por classe de via:
   **1.000 m** em `motorway`/`trunk` e **120 m** nas demais (ladeira urbana curta continua aparecendo). Rodovias são
   projetadas com rampas longas e moderadas (IPR-706) e o que pesa para o caminhão é a rampa sustentada; com 300 m a
   Anchieta (subida, Santos → SP) ainda dava 22% no perfil bruto, com 500 m 14,5%, com 1 km 8,9% e com 2 km 8,5% — a
   partir de 1 km o valor estabiliza no que a serra realmente tem (~700 m de desnível em ~9 km). Pontes/túneis são "aplainados" no perfil (reta entre as cabeceiras),
   porque o DEM mede o vale/morro e não o tabuleiro.
2. A rampa da aresta é o **menor** entre o `max_upward_grade` do Valhalla e o máximo da média móvel nela.
3. Trecho = arestas consecutivas acima do limite de atenção (folga de 50 m). Só entra se a rampa sustentada passar do
   limite em pelo menos `min_over_m` (30 m); só vira `evitar` se passar do limite "evitar" em ≥ 30 m.
   O que o Valhalla acusou e a média móvel não confirmou é contado em `data.discarded_spikes`.

Efeito medido (carreta, 09/10/2026):

| Rota | Valhalla bruto (60 m) | Depois do filtro |
|---|---|---|
| Pinheiros → Av. Dr. Arnaldo pela **R. Teodoro Sampaio** (2,8 km) | máx. 12%, 4 arestas > 6% | máx. **~11%** (215 m de trecho, 110 m acima de 8%) → 1 trecho `evitar` + 1 `atencao` |
| Sé → Santos pela Anchieta (73 km, serra em descida) | máx. 24%, 26 trechos (13 "evitar", quase todos na serra, em descida) | máx. ~9,1%; 2 trechos de atenção (Pça. da Sé ~8,7% e Av. Martins Fontes ~9,1%, ambos acima de 8% em menos de 30 m, então não viram "evitar"); 29 picos descartados; **descida longa de 13,3 km a 5,5% (desce 729 m)** |
| Santos → Sé pela Anchieta (72 km, serra em subida) | máx. 28% | 2 avisos de **subida forte na SP-150** (até ~9% e ~8,5%) + 9 trechos de atenção na serra; no centro de SP, Av. Rangel Pestana ~12% e R. Venceslau Brás ~10% (subida do Parque Dom Pedro para a Sé) |
| Marginal Tietê → Rio pela Dutra (424 km) | máx. 20%, 33 trechos > 6% | 1 trecho de atenção (rua no Rio, ~7,5%); 151 picos descartados; descida longa da **Serra das Araras: 5,8 km a 5,5% (322 m)** |

### Limites por veículo (`config/grade-limits.json`) — valores de partida, a calibrar

Não existe limite legal de rampa para circular: estes números são **risco operacional** (perder tração no molhado,
não vencer a subida carregado). Vêm do cálculo de aderência da pesquisa (§5, `calc_rampa_veiculos.txt`) com os
parâmetros da Resolução CONTRAN 882/2021 e foram propostos para serem calibrados com reportes `steep_grade` e motoristas.

| Preset | Atenção acima de | Evitar acima de | Base |
|---|---|---|---|
| VUC / Toco | 15% | 20% | toco 4x2 16 t: aderência no molhado ~27% |
| Truck (6x2) | 12% | 15% | 23 t: ~15,5% no molhado |
| Carreta (cavalo 4x2/6x2) | 6% | 8% | 41,5–48,5 t: 6,8–9,7% no molhado |
| Bitrem (cavalo 6x4) | 10% | 12% | 57 t: ~12,3% |
| Rodotrem (cavalo 6x4) | 6% | 9% | 74 t: ~9,2% |

PBT acima do PBT de referência do preset × 1,1 (ou preset desconhecido): vale o mais restritivo entre o preset e a faixa
de peso (`by_weight`: ≤16 t 15/20; ≤23 t 12/15; acima 6/8).

Normas conferidas por mim na fonte primária (09/10/2026):

- **Resolução CONTRAN nº 882/2021** (DOU, `in.gov.br/.../resolucao-contran-n-882-de-13-de-dezembro-de-2021-370017699`):
  art. 18 — CVC com PBTC acima de 57 t ou comprimento acima de 19,80 m só circulam com AET; **art. 19 §1º** — a tratora
  dessas CVC deve ser 6x4 e, carregada, "ser capaz de vencer aclives de 6%, com coeficiente de atrito pneu/solo de 0,45,
  resistência ao rolamento de 11 kgf/t e rendimento de transmissão de 90%"; §3º — o órgão pode exigir faixa adicional
  em rampas com aclive acima de 5% e comprimento acima de 600 m. (É requisito de projeto do veículo com AET, não regra de
  circulação: por isso não gera `danger`.)
- **DNER/DNIT IPR-706, Manual de Projeto Geométrico de Rodovias Rurais (1999), Quadro 5.5.2.1, p. 124** (PDF do DNIT):
  rampas máximas plano/ondulado/montanhoso — Classe 0: 3/4/5%; I: 3/4,5/6%; II: 3/5/7%; III: 4/6/8%; IV-A: 4/6/8%;
  IV-B: 6/8/10%, com a nota "a extensão de rampas acima de 8% será desejavelmente limitada a 300 m contínuos". Usado
  como referência de que rodovia tem rampa longa e moderada (janela de 1 km nelas); rampa > 10% sustentada em rodovia é
  quase sempre artefato do DEM.

A heurística de **descida longa** não tem norma: é só um aviso `info` de condução (freio-motor), para PBT ≥ 16 t.
Janelas de 2 km (passo de 100 m) com queda média ≥ 5% são unidas em intervalos; vale se a queda total for ≥ 150 m
(`descent` na config). Janela fixa em vez de "do topo ao fundo" porque em serra o DEM repica dezenas de metros numa
descida contínua. Subida/descida acumuladas do perfil usam histerese de 10 m pelo mesmo motivo (ainda assim ficam
infladas em serra longa: ~2,5 km de subida acumulada na Dutra inteira).

### Severidade dos avisos

Rampa não é restrição legal certa, e o DEM erra ~2 p.p.: **nunca `danger`**.

| code | severidade | quando |
|---|---|---|
| `steep_grade_avoid` | `warn` | trecho acima do limite "evitar" em ≥ 30 m (até 5; rodovia: trechos da mesma via a ≤ 3 km viram um aviso de "subida forte") |
| `steep_grade_avoid_more` | `warn` | mais trechos "evitar" além dos 5 |
| `steep_grade_warn` | `warn` | um aviso agregado dos trechos de atenção (quantos, metros, o pior) |
| `long_descent` | `info` | descida longa para veículo pesado (até 3) |

Exemplos (carreta): "Rampa de ~11% na Rua Teodoro Sampaio (trecho de 215 m): acima do recomendado para Carreta (8%).
Risco de patinar com piso molhado; avalie outra via." · "Subida forte na SP-150 (km 27–30 da rota): até ~9%, com
150 m acima de 8% (recomendado p/ Carreta). Engate marcha reduzida antes; com piso molhado há risco de perder tração."
· "Descida longa: 13,3 km com média de 5,5% (desce 729 m) a partir da SP-150. Use freio-motor e marcha reduzida."

### Saída em `layers.relevo`

`summary` (linhas curtas): rampa máx. e limites do veículo; metros acima do limite e nº de trechos; subida/descida e
faixa de altitude; aviso de que é estimativa. `data`:

`limits {warn_pct, avoid_pct, source: preset|peso|preset+peso, basis}`, `max_up_pct`, `max_up_at {lat, lon, name}`,
`max_down_pct`, `max_up_pct_valhalla` (bruto), `discarded_spikes`, `km_over_warn`, `km_over_avoid`, `segments_count`,
`segments[]` (até 50: `id, level, name, road_class, way_ids, max_up_pct, max_up_pct_valhalla, window_m, length_m,
over_warn_m, over_avoid_m, km_from_start, lat, lon, start, end, coordinates`), `profile {step_m, min_m, max_m,
ascent_m, descent_m, points[[km, m]]}`, `histogram_up_km` (faixas 0-3 … 20+, `descida_6+`), `long_descents[]`,
`cost_lines_suggested[]` (formato `LayerCostLine`), `coverage_pct`, `elapsed_ms`, `window_m`, `note`.

Custo medido na API: 8–26 ms numa rota urbana de 3 km, 12–100 ms em 73 km, 25–480 ms em 424 km (a primeira chamada
aquece o cache do Valhalla).

## Build dos tiles com elevação (medido em 09/10/2026)

```bash
./scripts/build-elevation.sh          # = dem + tiles + serve + check
./scripts/build-elevation.sh dem      # ANADEM -> HGT (retomável: tile pronto é pulado)
./scripts/build-elevation.sh tiles    # valhalla_build_tiles + extract (FORCE=1 refaz)
./scripts/build-elevation.sh serve    # sobe truck-router-valhalla-elev na 8003 (compose + override)
./scripts/build-elevation.sh check    # /height na Sé e trace_attributes de teste
```

Variáveis: `VALHALLA_MAIN_DIR` (default `data/valhalla`, só leitura), `VALHALLA_ELEV_DIR` (default `data/valhalla_elev`),
`ELEV_BUILD_THREADS` (6), `DEM_JOBS` (6), `VALHALLA_ELEV_PORT` (8003), `ELEV_BBOX` (quando não há grafo principal).
A pasta de saída se ignora no git sozinha (`data/valhalla_elev/.gitignore` com `*`).

1. **DEM** (`valhalla/elevation/anadem_to_hgt.py`, contêiner `ghcr.io/osgeo/gdal:ubuntu-small-3.9.3`): lista as células de
   1° que contêm tiles de nível 2 do grafo principal (mesma regra do `valhalla_build_elevation --from-tiles`) — **112
   tiles no Sudeste**; para cada um, `gdal.Warp` dos COGs do ANADEM por HTTP range (`/vsicurl/`, só os blocos
   necessários), grade pixel-is-point de 3601×3601 (extensão com meia célula de folga, `-te x-1/7200 … -ts 3601 3601`),
   bilinear, Int16, NoData −9999 → −32768, e `gdal_translate -of SRTMHGT` para `elevation_data/S24/S24W047.hgt`.
   Zonas MGRS usadas: 21J 21K 22H 22J 22K 22L 23J 23K 23L 24K 24L (extensões conferidas com `gdalinfo`).
   **S21W030 (Ilha da Trindade) não tem ANADEM** e ficou sem elevação. 22 tiles costeiros têm NoData no mar (normal).
   Conferência: o S24W047 gerado bate com o HGT testado na pesquisa (diferença máx. 1 m em 20 pixels; Sé 757 m,
   Sumaré 796 m, Ibirapuera 755 m).
2. **Tiles**: um contêiner avulso da imagem `truck-router-valhalla` roda `valhalla_build_config` (mesmos defaults do
   principal + `additional_data.elevation=/custom_files/elevation_data`), `valhalla_build_tiles` (todas as etapas; a
   etapa `elevation` usa os HGT da pasta) e `valhalla_build_extract`. PBF: **hardlink** de `data/valhalla/sudeste-latest.osm.pbf`
   (mesmo arquivo, 0 byte a mais); `admins.sqlite`, `timezones.sqlite` e `default_speeds.json` copiados do principal.
   O build **não** usa `build_elevation=True` (isso baixaria o Skadi/SRTM).
3. **Serviço**: `docker-compose.elevation.yml` (serviço `valhalla-elev`, contêiner `truck-router-valhalla-elev`, porta
   8003 → 8002, `use_tiles_ignore_pbf=True`, sem rebuild).

| Etapa | Tempo (M4 Pro, VM Colima 8 vCPU / 14 GB) | Observação |
|---|---|---|
| DEM → 111 HGT | **2 min 26 s** (6 em paralelo, 4–11 s por tile) | ~57 MB baixados por tile ≈ **6,3 GB** de download no total |
| `valhalla_build_tiles` | **2 min 49 s** (6 threads) | etapa `elevation` = **11 s**; ParseNodes 43 s, ParseWays 19 s, hierarquia 23 s, restrições 19 s |
| `valhalla_build_extract` | 11 s | |
| subir o serviço | ~5 s | |
| **Total** | **~5,5 min** | pico de RAM do build: **6,7 GiB** |

| Disco | Tamanho |
|---|---|
| `elevation_data/` (111 HGT × 25,9 MB) | **2,8 GB** |
| `valhalla_tiles/` | 1,35 GB (principal sem elevação: 1,29 GB) |
| `valhalla_tiles.tar` | 1,21 GB (principal: 1,17 GB; +3,5%) |
| admins/timezones/default_speeds | 0,13 GB |
| PBF | 0 (hardlink; 0,86 GB se copiado) |
| **Total `data/valhalla_elev/`** | **~5,5 GB** (6,0 GB com logs e a pasta de tiles) |

Os HGT só são necessários no build e no `/height` (perfil). Se faltar disco: `gzip` nos `.hgt` (o Valhalla lê `.hgt.gz`;
fica ~1,1 GB, com custo de descompressão no `/height`), ou apagar `valhalla_tiles/` e manter só o `.tar`.

**Brasil inteiro** (estimativa): 811 tiles HGT ≈ 21 GB, ~46 GB de download (~17 min no mesmo ritmo), acrescentar as zonas
MGRS em `--zones`/`ANADEM_ZONES` e o build de tiles do Brasil (1,5–3 h, 16 GB de RAM, ver README). As 52 zonas do ANADEM
(América do Sul, 64 GB no total, nunca baixados inteiros): `17L, 17M, 17N, 18F, 18G, 18H, 18K, 18L, 18M, 18N, 18P, 19F, 19G, 19H, 19J, 19K, 19L, 19M, 19N, 19P, 20F, 20G, 20H, 20J, 20K, 20L, 20M, 20N, 20P, 21F, 21H, 21J, 21K, 21L, 21M, 21N, 21P, 22H, 22J, 22K, 22L, 22M, 22N, 23J, 23K, 23L, 23M, 24K, 24L, 24M, 25L, 25M`.

### Como atualizar

- **PBF novo**: atualizar `data/valhalla/` como hoje e rodar `FORCE=1 ./scripts/build-elevation.sh tiles serve`
  (apagar antes o hardlink `data/valhalla_elev/*.pbf` para ele pegar o PBF novo). Os HGT são reaproveitados.
- **ANADEM novo** (v2): apagar `data/valhalla_elev/elevation_data/` (ou só os tiles alterados) e rodar `dem` + `FORCE=1 tiles`;
  ajustar `ANADEM_BASE_URL` se a pasta mudar e conferir de novo a licença no metadado.
- **Limites**: editar `config/grade-limits.json` (lido na subida da API).

## Trocar o Valhalla principal pelos tiles com elevação

Os tiles de `data/valhalla_elev/` são os mesmos do principal + elevação (mesmo PBF, mesma configuração). Procedimento
(com pouca indisponibilidade, só o restart do contêiner):

```bash
# 0) conferir que o 8003 está bom
./scripts/build-elevation.sh check
# 1) parar o serviço de elevação avulso e o principal
docker rm -f truck-router-valhalla-elev
docker compose stop valhalla
# 2) trocar o CONTEÚDO das pastas (renomeações instantâneas no mesmo disco; o glob * não pega os dotfiles, então
#    data/valhalla/.gitkeep (versionado) fica onde está; o backup vai para data/cache/, que o git ignora;
#    o PBF é hardlink e continua válido)
mkdir -p data/cache/valhalla_sem_elevacao
mv data/valhalla/* data/cache/valhalla_sem_elevacao/
mv data/valhalla_elev/* data/valhalla/
# 3) subir o principal (carrega o .tar; não rebuilda: use_tiles_ignore_pbf=True e os bancos já existem)
docker compose up -d valhalla
curl -s localhost:8002/height -d '{"shape":[{"lat":-23.5505,"lon":-46.6339}]}'   # deve dar ~757, não null
```

Depois:

- A camada acha a elevação sozinha (sem `VALHALLA_ELEV_URL` ela tenta `localhost:8003` e depois o `VALHALLA_URL`). No
  compose, o contêiner da API não enxerga `localhost:8003`; acrescentar no serviço `api` do `docker-compose.yml`
  `VALHALLA_ELEV_URL: ${VALHALLA_ELEV_URL:-http://valhalla:8002}` (ou deixar vazio — ele cai no `VALHALLA_URL`).
- Rebuilds futuros do principal mantêm a elevação **desde que** `data/valhalla/elevation_data/` tenha os HGT: o entrypoint
  oficial sempre aponta `additional_data.elevation` para essa pasta e a etapa `elevation` do `valhalla_build_tiles` usa o
  que estiver lá. Manter `build_elevation: "False"` no compose (com `True` ele baixaria do Skadi os tiles que faltam,
  ex.: S21W030, misturando fontes).
- O `README.md` ("Detecção automática de subidas por elevação: TODO") e a tabela de disco devem ser atualizados.
- Reverter: `docker compose stop valhalla && mv data/valhalla/* data/valhalla_elev/ && mv data/cache/valhalla_sem_elevacao/* data/valhalla/ && docker compose up -d valhalla`.

Alternativa sem trocar pastas: hardlink dos HGT em `data/valhalla/elevation_data/` e `force_rebuild=True` uma vez
(~3 min de build com o Valhalla fora).

## 2ª rodada com `costLines` (sugestão, não aplicada)

`costLines(ctx)` roda **antes** da rota e não sabe por onde ela vai; as rampas só são conhecidas depois. Por isso a
camada devolve `data.cost_lines_suggested`: um `LayerCostLine` por trecho `evitar` fora de rodovia (`motorway`/`trunk`
ficam de fora: em geral não há alternativa e o aviso é de condução), com a geometria das arestas **no sentido da subida**
e `factor` 10. O `linear_cost_factors` do Valhalla faz `edge_walk` da linha, então só a aresta dirigida de subida fica
mais cara — a descida pela mesma rua e as ruas que cruzam não são afetadas.

Como ficaria no `routing.ts` (não implementado aqui; arquivo fora desta frente):

1. calcular a rota como hoje e rodar as anotações;
2. se `layers.relevo.data.cost_lines_suggested` não estiver vazio, recalcular com `costLines + sugestões`;
3. anotar a nova rota de novo e ficar com ela só se (a) não usar mais os trechos sugeridos, (b) não criar trecho `evitar`
   novo pior que o evitado e (c) o desvio for razoável (ex.: ≤ +30% de distância ou ≤ +3 km em área urbana); senão,
   manter a original com os avisos;
4. no máximo uma 2ª rodada (custo: +1 rota + 1 anotação, ~0,1–0,5 s); devolver o que foi evitado em `avoided` com
   `kind: 'layer', layer: 'relevo'`.

Testado no `relevo.test.ts`: na ladeira da Teodoro Sampaio, mandar as sugestões ao Valhalla principal tira a rota do
trecho de ~11% (o ponto mais íngreme fica a > 100 m da rota nova; 2,8 km → 4,2 km por Henrique Schaumann / Paulo VI /
Cardoso de Almeida / Dr. Arnaldo / Cardeal Arcoverde).

Evolução natural: pré-calcular uma tabela de trechos íngremes (PostGIS, por way_id e sentido, a partir do perfil do
ANADEM — e do LiDAR na capital) para `costLines(ctx)` já penalizar na 1ª rodada as rampas acima do limite do veículo no
corredor origem–destino, e mostrá-los no mapa; reportes `steep_grade` confirmam/derrubam.

## Limitações

- **Erro do DEM**: ANADEM erra 2,1–2,5 p.p. (MAE) por intervalo de 60 m em bairros de morro e **subestima rampas muito
  fortes** (recall de 0,33–0,40 para > 15%); em área plana e densa ainda pode inventar rampa (precisão de 0,47 para
  > 8% na Mooca). A média móvel reduz o ruído mas também achata ladeiras com menos de ~120 m. Tudo é "~".
- **Rodovia encaixada em encosta / viaduto sem `bridge=yes`**: o DEM mede o terreno ao lado; a janela de 1 km nas
  rodovias resolve a maior parte (Anchieta), mas esconde um "degrau" curto e forte numa rodovia, e em via urbana
  (janela de 120 m) pode sobrar falso positivo (ex.: ~9% na Av. Martins Fontes, em Santos, provavelmente rampa de
  viaduto). Rodovias estaduais classificadas como `primary` usam a janela urbana.
- `max_upward_grade` é o máximo da aresta, não o comprimento: o comprimento acima do limite sai do perfil (passo de 30 m,
  amostras de 15 m na aresta). Arestas < 10 m não têm rampa no Valhalla.
- O Valhalla 3.9.1 **não usa rampa no costing `truck`** (issue #1191): a rota não evita subidas sozinha; esta camada só
  avisa (e sugere a 2ª rodada).
- Cobertura: só os 111 tiles do grafo do Sudeste (S21W030 sem ANADEM). Fora disso `coverage_pct` cai e a camada anota só o que tem dado.
- O front mostra `summary`/`warnings` sem código específico; um gráfico do perfil (`data.profile.points`) e os trechos no
  mapa (`data.segments[].coordinates`) ficam para quem mexer no front.
- **LiDAR da PMSP** (0,5 m, MAE ~1 p.p.): melhoraria muito a capital, mas exige processar ~190 GB de LAZ (dentro da AWS
  sa-east-1) e é **GPL-3.0** — uso interno no servidor parece ok; distribuir HGT/derivados pode exigir GPL. Pedir leitura
  jurídica antes.
- Os limites são de partida; calibrar com reportes `steep_grade` (peso que vence a subida) e com motoristas.

## Testes

`api/test/layers/relevo.test.ts` (8 testes; precisa da API desta branch e do Valhalla com elevação no ar):

```bash
cd api && API_URL=http://localhost:3111 npx vitest run test/layers/relevo.test.ts
```

- carreta subindo a **Rua Teodoro Sampaio** (Largo da Batata → Av. Dr. Arnaldo, terça 22h30): `max_up_pct` > 8%, trecho
  `evitar` na Teodoro Sampaio com lat/lon sobre a rota, aviso `steep_grade_avoid` `warn` (nenhum `danger`), perfil sobe
  > 50 m (740 → 820 m);
- VUC na mesma rota: limites 15/20%, nenhum aviso de rampa;
- 2ª rodada: as `cost_lines_suggested` mandadas ao Valhalla principal tiram a rota do trecho íngreme;
- limites por preset e por PBT (truck com 30 t usa 6/8%);
- Valhalla de elevação fora do ar (porta fechada) e Valhalla sem elevação (o principal, hoje): a camada devolve `{}`.

Sem o Valhalla de elevação, os 5 testes que dependem dele são pulados com aviso no console.

## Decisões

- **Segundo Valhalla em vez de mexer no principal**: outras frentes testam no 8002; a troca é um `mv` de pasta (acima).
- **ANADEM e não Skadi/SRTM**: melhor DEM nacional com uso comercial (pesquisa §3–4); conversão própria para HGT porque o
  `valhalla_build_elevation` só baixa do Skadi.
- **Sudeste inteiro, não só a RMSP**: o volume coube (2,8 GB de HGT, 2,5 min de conversão).
- **`edge_walk`** sobre a geometria da rota (malhas idênticas), com `map_snap` de reserva.
- **Rampa sustentada** (menor entre Valhalla e média móvel de 120 m / 1 km em rodovia) para não acusar rampa inexistente em serra.
- **Sem `danger`**: rampa não é restrição legal; erro do DEM ~2 p.p.
- **Sem dados em `data_features`** (cálculo por rota, nada a importar).
