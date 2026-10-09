# Relevo e rampas — modelos de elevação e limites de rampa para caminhões

Pesquisa feita em 09/10/2026. Pasta: `scratchpad/research/elevacao_rampas/`. Nada no projeto truck-router foi modificado
(só leitura do PBF, do valhalla.json e da lista de tiles do grafo).

## 0. Resumo de uma linha
O DEM padrão do Valhalla (Skadi/SRTM) é o pior dos testados para rampa urbana em SP. O LiDAR da Prefeitura (AWS, 31,7 bi de pontos)
é ~2-3x mais preciso e cabe no formato HGT do Valhalla. ANADEM (CC BY 4.0) é o melhor DEM nacional gratuito.
O costing `truck` do Valhalla ignora rampa (issue #1191 aberta desde 2018), então precisamos de pós-checagem na API ou de um fork.

## 1. Como o Valhalla trata elevação (verificado no código-fonte, master, e na imagem 3.9.1 em uso)
- `valhalla_build_elevation` (dentro de `ghcr.io/valhalla/valhalla-scripted:latest`, versão 3.9.1) baixa **apenas**
  `https://elevation-tiles-prod.s3.us-east-1.amazonaws.com/skadi/{S24}/{S24W047}.hgt.gz` (Tilezen/Mapzen; no Brasil = SRTM).
  O script `configure_valhalla.sh` usa `valhalla_build_elevation --from-tiles --decompress` quando `build_elevation=True`.
- `src/skadi/sample.cc`: `HGT_DIM = 3601` fixo, ou seja, só lê HGT de **1 arco-segundo** (3601×3601 Int16), nomes `S24W047.hgt[.gz|.lz4]`.
  Qualquer DEM serve se for convertido para esse formato (`gdalwarp` + `gdal_translate -of SRTMHGT`). **Testado**: converti ANADEM
  para `S24W047.hgt`, subi um `valhalla_service` temporário apontando `additional_data.elevation` para ele e o `/height` respondeu
  (Sé 756 m, Sumaré 795 m, Ibirapuera 754 m).
- `src/mjolnir/elevationbuilder.cc`: reamostra cada aresta a cada **60 m** (`POSTING_INTERVAL`), ignora rampa em aresta < 10 m,
  guarda `weighted_grade` (0-15 → -10%..+15%), `max_up_slope`, `max_down_slope`, `mean_elevation`. Ponte/túnel: interpola
  linearmente entre as pontas e **limita a ±3%**.
- `src/sif/truckcost.cc`: **nenhuma** referência a grade/slope/hill. Bicicleta usa `kGradeBasedSpeedFactor[weighted_grade]` e
  `use_hills`. Issue https://github.com/valhalla/valhalla/issues/1191 "Add elevation logic to truck costing" aberta em 08/04/2018, 0 comentários.
- `trace_attributes` expõe `edge.max_upward_grade`, `edge.max_downward_grade`, `edge.weighted_grade`, `edge.mean_elevation`
  (`src/tyr/trace_serializer.cc`). Rota aceita `elevation_interval`; existe o endpoint `/height`.
- Para o grafo atual (Sudeste): 1.426 tiles nível 2 → **112 tiles HGT 1°×1°** necessários (≈112 × 25,9 MB descomprimido ≈ 2,9 GB).

## 2. Fontes testadas

| Fonte | URL testada | Resultado | Licença |
|---|---|---|---|
| Skadi/Tilezen (SRTM) — padrão Valhalla | `https://elevation-tiles-prod.s3.us-east-1.amazonaws.com/skadi/S24/S24W047.hgt.gz` | 200, 11,9 MB gz / 25,9 MB, 3601×3601 Int16, Last-Modified 2016 | atribuição (USGS SRTM), uso comercial ok |
| Copernicus DEM GLO-30 | `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S24_00_W047_00_DEM/...tif` | 200, 42,3 MB, 3600×3600 Float32 COG, **DSM** | "GLO-30 Full Free & Open": reprodução, distribuição e modificação gratuitas + aviso "produced using Copernicus WorldDEM-30 © DLR... Airbus..." |
| TOPODATA (INPE) | antigo `www.dsr.inpe.br` → **NXDOMAIN**; novo STAC `https://data.inpe.br/bdc/stac/v1/collections/topodata-1`, COG `https://data.inpe.br/bdc/data/topodata/v001/23S/48_/23S48_ZN.tif` | 200, 70,8 MB (ZN altitude), 90,6 MB (SN declividade %), 556 folhas no Brasil | CC-BY-4.0 (STAC) |
| ANADEM v1 (ANA/UFRGS) | `https://metadados.snirh.gov.br/files/anadem_v1_tiles/anadem_v1_23K.tif` | 200, 2,05 GB COG Float32 (zona MGRS 6°×8°); leitura parcial por HTTP range funcionou (recorte 1°×1° em 4,8 s) | CC BY 4.0 (metadado SNIRH 93664c15...), comercial ok; derivado do Copernicus |
| LiDAR PMSP (M3DC) EPT | `https://ept-m3dc-pmsp.s3.sa-east-1.amazonaws.com/ept.json` | 200; 31.730.305.220 pontos, EPSG:31983, classes 2 (solo), 5, 6, 19, 20 | GPL-3.0 (registro AWS Open Data `pmsp-lidar`) |
| LiDAR PMSP LAZ | `https://laz-m3dc-pmsp.s3.sa-east-1.amazonaws.com/` | 5.544 arquivos `MDS_color_XXXX-XXX.laz`, 193,7 GB | GPL-3.0 |
| GeoSampa WFS relevo | `wfs.geosampa...` camadas `curva_mestra` (267.002), `curva_intermediaria` (704.641), `ponto_cotado` (437.499), `declividade` (24.637), `quadricula_folha_mds` (5.544, 2017), `quadricula_folha_mdt_mds_2020` (5.401, "Mapeamento LIDAR 2020 1:1000", FOTOTERRA) | 200 | GeoSampa (ver termos) |
| GeoSampa download MDT/MDS 2020 | `https://geosampa.prefeitura.sp.gov.br/PaginasPublicas/_SBC.aspx` | página protegida por desafio anti-bot (F5 TSPD); **não automatizei** (download manual por folha) | — |
| GeoSampa WCS | `.../geoserver/ows?service=WCS` | "Service WCS is disabled" | — |
| ALOS AW3D30 v4.1 | `https://www.eorc.jaxa.jp/ALOS/en/dataset/aw3d30/aw3d30_e.htm` | página 200; área de download 401 (exige cadastro) | uso comercial e não comercial gratuito conforme termos JAXA |
| OpenTopography API | `https://portal.opentopography.org/API/globaldem?demtype=AW3D30...` | 401 "API Key required" | — |
| NASA SRTMGL1 / NASADEM (LP DAAC) | `https://data.lpdaac.earthdatacloud.nasa.gov/lp-prod-protected/...` | 302 → login Earthdata; URLs antigas `e4ftl01` → 404 | domínio público (USGS/NASA) |
| FABDEM | `https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn` | timeout (curl e WebFetch) | **não confirmado**; conhecimento prévio: não comercial — confirmar |
| Emplasa / DataGEO | `https://datageo.ambiente.sp.gov.br/geoserver/datageo/wms` (1.851 camadas) | só articulações Emplasa 1:10.000 e IBGE; nenhum MDT/MDE Emplasa publicado | — |
| IBGE MDE | `https://geoftp.ibge.gov.br/modelos_digitais_de_superficie/modelo_digital_de_elevacao_mde/` | rj25 (314 arquivos), sc25 (86), spmggo50 (73, extensão lat -20,3..-17,5: **não cobre RMSP**) | dados públicos IBGE (confirmar termos) |

## 3. Teste de rampa nas vias OSM (bbox lon -47..-46, lat -24..-23 = município de SP sem o extremo sul + maior parte da RMSP)
Script `grade_analysis.py` (imita o elevationbuilder: postes a 60 m, bilinear). 346.186 ways; 13.562 km de vias principais
(motorway..tertiary + links) e 50.154 km de vias locais; 6.137 ways de ponte/túnel (493 km) excluídos.

Km de vias principais com trecho de 60 m acima do limite:

| DEM | >5% | >8% | >10% | >12% | >15% | >20% |
|---|---|---|---|---|---|---|
| SRTM/Skadi (padrão Valhalla) | 5.006 | 2.505 | 1.549 | 944 | 441 | 127 |
| TOPODATA | 4.485 | 2.376 | 1.568 | 1.067 | 632 | 319 |
| Copernicus GLO-30 | 4.013 | 1.897 | 1.118 | 646 | 275 | 65 |
| ANADEM v1 | 3.369 | 1.527 | 863 | 483 | 197 | 43 |

OSM: só 13 ways com `incline=N%` numérico na área; a maioria são rampas de garagem/serviço curtas que um DEM de 30 m não enxerga.

## 4. Validação contra LiDAR 1 m (verdade de campo)
DTM 1 m gerado com PDAL (`readers.ept` + `Classification[2:2]` + `writers.gdal` idw) em 3 áreas de ~1,6×1,7 km.
Erro da rampa por intervalo de 60 m (pp = pontos percentuais). P/R = precisão/recall para "rampa > limiar".

| Área (km de via) | DEM | MAE pp | P/R >8% | P/R >12% | P/R >15% |
|---|---|---|---|---|---|
| Sumaré/Perdizes (41,8 km, morro) | SRTM/Skadi | 4,11 | 0,34/0,56 | 0,16/0,43 | 0,09/0,35 |
| | TOPODATA | 3,30 | 0,43/0,54 | 0,27/0,41 | 0,15/0,24 |
| | Copernicus | 2,92 | 0,49/0,69 | 0,30/0,57 | 0,26/0,53 |
| | ANADEM | 2,48 | 0,56/0,63 | 0,38/0,39 | 0,26/0,35 |
| | **LiDAR reamostrado p/ 1"** | **1,19** | **0,79/0,81** | **0,68/0,65** | **0,65/0,76** |
| Freguesia do Ó (33,1 km, morro) | SRTM/Skadi | 3,20 | 0,64/0,66 | 0,57/0,57 | 0,45/0,48 |
| | Copernicus | 2,38 | 0,73/0,84 | 0,64/0,77 | 0,62/0,62 |
| | ANADEM | 2,11 | 0,81/0,69 | 0,72/0,61 | 0,68/0,40 |
| | **LiDAR 1"** | **1,02** | **0,87/0,90** | **0,84/0,84** | **0,74/0,74** |
| Mooca (26,8 km, plano) | SRTM/Skadi | 2,94 | 0,05/0,40 | — | — |
| | Copernicus | 2,34 | 0,11/0,60 | — | — |
| | ANADEM | 1,34 | 0,47/0,90 | — | — |
| | **LiDAR 1"** | **0,49** | 0,64/0,70 | — | — |

Na Mooca o LiDAR diz que 1,8% dos trechos passam de 8%; SRTM diz 14,4% e Copernicus 9,6% (rampas falsas por prédios).
Quantização Int16 do HGT custa só +0,1 a +0,2 pp de MAE (teste `compare_quant.py`): o formato do Valhalla não é o gargalo.

Custo do LiDAR: uma área de 2,8 km² baixou **331 MB** do EPT em 13 s. Cidade inteira ≈ volume do bucket LAZ (≈190 GB)
→ processar dentro da AWS sa-east-1. (Nesta pesquisa o total baixado passou do limite de ~300 MB por causa das 4 leituras do EPT, ~1,3 GB.)

## 5. Normas e física de rampa (para calibrar limite por veículo)
- **DNER/DNIT IPR-706, Manual de Projeto Geométrico de Rodovias Rurais (1999)**, PDF escaneado
  `https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/ipr/coletanea-de-manuais/vigentes/706_manual_de_projeto_geometrico.pdf`
  (43 MB, 228 p., OCR feito). Quadro 5.5.2.1 "Rampas máximas" (plano/ondulado/montanhoso): Classe 0: 3/4/5%; I: 3/4,5/6%;
  II: 3/5/7%; III: 4/6/8%; IV-A: 4/6/8%; IV-B: 6/8/10%, com rampas acima de 8% "desejavelmente limitadas a 300 m contínuos".
  Terceira faixa quando ≥200 veic/h na subida, ≥10% caminhões e redução ≥15 km/h dos pesados. O manual diz que as curvas da
  AASHTO não representam a frota brasileira.
- **Resolução CONTRAN 882/2021** (pesos e dimensões; revogou a 211/2006): art. 18 CVC >57 t ou >19,80 m só com AET; art. 19 §1º a
  unidade tratora deve ser 6x4 e, carregada, "vencer aclives de 6%" com atrito pneu/solo 0,45, resistência ao rolamento 11 kgf/t
  e rendimento 90%; §2º até 58,5 t pode ser 4x2/6x2; §3º pode exigir faixa adicional em rampas >5% e >600 m.
  Anexo III: `i = Ft/(10·G) − Rr/10`, `Ft = min(Fr, Fad)`, `Fr = Tm·ic·id·0,9/Rd`, `Fad = P·u` (imagens em `normas/`).
  Limites por eixo: isolado 4 pneus 10 t; tandem duplo 17 t; tandem triplo 25,5 t; PBT não articulado 29 t.
- **Resolução CONTRAN 872/2021** (CVC de cana 74-91 t): CMT ≥ PBTC, memória de cálculo para rampas até 6%, freio de
  estacionamento segurando em 12% (teste com atrito 0,70-0,85).
- Tese USP São Carlos (orientador Setti), `https://www.teses.usp.br/teses/disponiveis/18/18137/tde-18122015-141507/en.php`:
  caminhões brasileiros com 100-380 kg/kW contra 120 kg/kW nos EUA (**só pelo resumo no buscador**; a página deu HTTP 400).

Cálculo próprio (`calc_rampa_veiculos.txt`), limite por aderência com a fórmula do CONTRAN e eixos no limite legal:

| Configuração | u=0,45 | u=0,70 |
|---|---|---|
| Toco 4x2 (16 t) | 27,0% | 42,6% |
| Truck 6x2 (23 t) | 15,5% | 24,8% |
| Truck 6x4 (23 t) | 32,2% | 50,6% |
| Carreta 2S3 cavalo 4x2 (41,5 t) | 9,7% | 15,8% |
| Carreta 3S3 cavalo 6x2 (48,5 t) | 6,8% | 11,2% |
| Carreta 3S3 cavalo 6x4 (48,5 t) | 14,7% | 23,4% |
| Bitrem 6x4 (57 t) | 12,3% | 19,8% |
| Rodotrem 6x4 (74 t) | 9,2% | 15,0% |

Velocidade sustentada teórica (v = 0,9·P/m / g(i+0,011)): a 250 kg/kW cai de 120 km/h no plano para 22 km/h em 5%,
15 km/h em 8% e 8 km/h em 15%.

## 6. Comandos usados (reprodução)
```
# Skadi (padrão Valhalla)
curl -O https://elevation-tiles-prod.s3.us-east-1.amazonaws.com/skadi/S24/S24W047.hgt.gz
# Copernicus
curl -O https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S24_00_W047_00_DEM/Copernicus_DSM_COG_10_S24_00_W047_00_DEM.tif
# TOPODATA via STAC
curl "https://data.inpe.br/bdc/stac/v1/collections/topodata-1/items?bbox=-46.9,-23.8,-46.3,-23.3"
# ANADEM: recorte por HTTP range (sem baixar 2 GB)
gdal_translate -projwin -47 -23 -46 -24 /vsicurl/https://metadados.snirh.gov.br/files/anadem_v1_tiles/anadem_v1_23K.tif out.tif
# ANADEM -> HGT do Valhalla
gdalwarp -te -47.000138889 -24.000138889 -45.999861111 -22.999861111 -ts 3601 3601 -r bilinear -ot Int16 \
  -dstnodata -32768 /vsicurl/.../anadem_v1_23K.tif grid.tif && gdal_translate -of SRTMHGT grid.tif S24/S24W047.hgt
# LiDAR PMSP -> DTM 1 m (ver pmsp_lidar/pipeline_pdal_ept_dtm.json)
docker run --rm pdal/pdal pdal pipeline ept_dtm.json
```
Imagens Docker: `ghcr.io/osgeo/gdal:ubuntu-small-3.9.3`, `debian:bookworm-slim` (osmium-tool, poppler, tesseract-por), `pdal/pdal:latest` (2.10.2).

## 7. Integração proposta
1. **Curto prazo**: ligar elevação no Valhalla com tiles próprios (ANADEM → HGT para o Brasil; LiDAR → HGT para o município de SP),
   em vez do Skadi. Diretório `data/valhalla/elevation_data/S24/S24W047.hgt`; rebuild de tiles com elevação.
2. API: depois de `/route`, chamar `trace_attributes` (ou ler `elevation`) e checar `edge.max_upward_grade` por preset; avisar
   ou recalcular. Tabela `grade_limits(preset, max_up_pct, max_len_m)` em config.
3. Tabela PostGIS `steep_segments` (way_id, geom, max_up_pct, fonte, confiança) gerada do LiDAR a 1 m; mostrar no mapa e
   usar como `exclude_polygons`/penalidade só para presets pesados; reporte `steep_grade` serve para confirmar.
4. Médio prazo: fork do `truckcost.cc` com fator de velocidade por `weighted_grade` (como `bicyclecost.cc`) e corte por `max_up_slope`.
