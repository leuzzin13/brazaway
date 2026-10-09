# Relevo e rampas — modelos de elevação e limites de rampa para caminhões

Pesquisa em 09/10/2026, em duas rodadas (a rodada 1 foi interrompida; a rodada 2 continuou sem refazer downloads).
Pasta: `scratchpad/research/elevacao_rampas/`. Nada no projeto truck-router foi modificado (só leitura do PBF,
do `valhalla.json`, do `docker-compose.yml` e uma chamada GET/POST ao `/height` do Valhalla local).
Backup das notas da rodada 1: `NOTES_rodada1_backup.md`.

## 0. Resumo
- O DEM padrão do Valhalla (Skadi = SRTM 2000) é o pior dos 7 DEMs testados para rampa urbana em SP.
- Melhor DEM nacional gratuito e com uso comercial: **ANADEM v1** (ANA/UFRGS, CC BY 4.0). O **GEDTM30 v1.2**
  (OpenLandMap, CC BY 4.0, global) fica logo atrás e é o melhor em algumas métricas; serve de plano B.
- Para o município de SP, o **LiDAR da Prefeitura** (AWS, 31,7 bi de pontos, 0,5 m) erra cerca de metade dos outros
  (MAE 0,5–1,2 pp contra 1,3–2,5 do ANADEM) e cabe no formato HGT do Valhalla depois de reamostrado para 1".
- Descartados por licença: FABDEM (CC BY-NC-SA), CGIAR SRTM (comercial só com permissão escrita), TanDEM-X 90 (uso científico).
- O costing `truck` do Valhalla 3.9.1 **ignora rampa** (issue #1191 aberta desde 2018, 0 comentários). Os dados
  (`max_up_slope`, `weighted_grade`) entram nos tiles se a elevação for ligada, mas só são usados por bicicleta/pedestre.
  Precisamos de pós-checagem na API ou de um fork do `truckcost.cc`.
- Hoje o Valhalla do projeto está **sem elevação**: `docker-compose.yml` tem `build_elevation: "False"`, `valhalla.json`
  aponta `additional_data.elevation` para `/custom_files/elevation_data` (vazio) e `POST /height` devolve `[null,null]`.

## 1. Como o Valhalla trata elevação (código-fonte master + imagem 3.9.1 em uso; release 3.9.1 de 06/10/2026)
- `valhalla_build_elevation` baixa **apenas** `https://elevation-tiles-prod.s3.us-east-1.amazonaws.com/skadi/{S24}/{S24W047}.hgt.gz`
  (Tilezen/Mapzen). Pela doc do joerd (`tilezen/joerd/docs/data-sources.md`), fora de EUA/Europa/etc. a fonte em terra
  é **SRTM**; atribuição exigida: "SRTM terrain data courtesy of the U.S. Geological Survey".
- `src/skadi/sample.cc`: `HGT_DIM = 3601` fixo, só HGT de 1" (3601×3601 Int16), nome `S24W047.hgt` (aceita `.gz`/`.lz4`).
  **Qualquer DEM serve se convertido** (`gdalwarp` p/ grade 3601 + `gdal_translate -of SRTMHGT`). Testado com ANADEM:
  `valhalla_service` temporário com o HGT convertido respondeu `/height` (Sé 756 m, Sumaré 795 m, Ibirapuera 754 m).
  DEMs "pixel-is-area" de 3600 px (Copernicus, AW3D30) precisam de reamostragem para a grade de 3601 (pixel-is-point).
- `src/mjolnir/elevationbuilder.cc`: amostra cada aresta a cada **60 m** (`POSTING_INTERVAL`), ignora rampa em aresta < 10 m;
  ponte/túnel: rampa limitada a ±3%. Um DEM mais fino que ~30 m só ajuda se mudarmos essa constante.
- `src/skadi/util.cc` + `src/baldr/directededge.cc` (verificado na rodada 2): `max_up_grade` é calculado **em %**
  (Δh·100/60 m) e gravado em 5 bits com `ceil`: precisão de 1 unidade até 16 e passos de 4 de 16 a 76 (o comentário do
  header fala em "graus", mas o valor gravado é a rampa em %). `weighted_grade` = `grade·0,6 + 6,5` (0–15, rampa
  ponderada por energia e limitada a −10%..+15%). Ou seja: limiares por preset com granularidade de 1% até 16% funcionam.
- `src/sif/truckcost.cc`: nenhuma referência a grade/slope/hill. `bicyclecost.cc` usa `kGradeBasedSpeedFactor[weighted_grade]`.
  Issue https://github.com/valhalla/valhalla/issues/1191 (consultada via API do GitHub na rodada 2: `open`, 0 comentários).
- `trace_attributes` expõe `edge.max_upward_grade`, `edge.max_downward_grade`, `edge.weighted_grade`, `edge.mean_elevation`.
- Comparação: GraphHopper tem `average_slope` e `max_slope` em custom models (docs `core/custom-models.md` e
  `core/elevation.md`; provedores srtm, cgiar, gmted, sonny, pmtiles), ou seja, rampa no custo sem fork. Não é proposta
  de troca, só referência.

### Contagem de tiles HGT 1°×1° (script `contagem/conta_tiles.py`, contornos IBGE API v3 malhas, qualidade mínima)
- **RMSP (39 municípios, IBGE RM 04901)**: 5 tiles: S24W047, S24W048, S24W046, S25W047, S25W048
  (envelope lon −47,21..−45,70, lat −24,06..−23,19).
- **Grafo atual (Sudeste)**: 112 tiles (rodada 1, a partir dos tiles nível 2 do grafo) ≈ 2,9 GB HGT descomprimido.
- **Brasil**: **811 tiles** (contorno simplificado; só S11W036 não tem arquivo Copernicus, é mar). ≈ 811 × 25,9 MB ≈ 21 GB
  em `.hgt`; em `.hgt.gz` estimo 8–10 GB (o tile de SP tem 11,9 MB gz).
- ANADEM v1 inteiro: 52 COGs MGRS, **64,0 GB** (lista `anadem/tiles_sizes.txt`); dá para recortar por HTTP range sem baixar tudo.

## 2. Fontes testadas

| Fonte | URL testada | Resultado | Licença / uso comercial | Valhalla usa? |
|---|---|---|---|---|
| Skadi/Tilezen (SRTM) — padrão | `https://elevation-tiles-prod.s3.us-east-1.amazonaws.com/skadi/S24/S24W047.hgt.gz` | 200, 11,9 MB gz / 25,9 MB, 3601² Int16, Last-Modified 2016 | atribuição USGS; comercial ok | Sim, nativo |
| NASADEM (SRTM reprocessado) via OpenTopography S3 | `https://opentopography.s3.sdsc.edu/raster/NASADEM/NASADEM_be/NASADEM_HGT_s24w047.tif` | **200 sem chave**, 15,1 MB, 3601² Int16; VRT global com 14.520 tiles | NASA, domínio público (via LP DAAC exige login Earthdata) | Sim, após `-of SRTMHGT` |
| Copernicus DEM GLO-30 (DSM) | `https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S24_00_W047_00_DEM/...tif` | 200, 42,3 MB, 3600² Float32 COG | "full, free and open"; comercial ok com aviso © DLR/Airbus | Sim, após reamostrar p/ 3601 |
| ALOS AW3D30 (JAXA) | site JAXA (v4.1, abr/2024) → download 401 (cadastro). **OpenTopography S3**: `.../raster/AW3D30/AW3D30_global/ALPSMLC30_S024W047_DSM.tif` | **200 sem chave**, 25,9 MB, 3600² Int16, mas é a **v3.2 (jan/2021)**, não a 4.1 | JAXA: uso comercial e não comercial gratuito "under the conditions of the Terms for Use" (termos em earth.jaxa.jp/policy não abriram no WebFetch) | Sim, após reamostrar |
| GEDTM30 v1.2 (OpenLandMap, DTM, mar/2026) | `https://s3.opengeohub.org/global/dtm/v1.2/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif` | 200, COG global Float32 1" (1.296.009×540.009); recorte 1°×1° em 22 s por HTTP range. Atenção: o arquivo tem tag `Scale=0.1`, mas os valores já estão em metros (Sé = 755,6 m) | **CC BY 4.0** (README Codeberg + Zenodo 18887460) | Sim, após conversão |
| ANADEM v1 (ANA/UFRGS, DTM) | `https://metadados.snirh.gov.br/files/anadem_v1_tiles/anadem_v1_23K.tif` | 200, 2,05 GB COG Float32 (zona MGRS); recorte por range ok | **CC BY 4.0** (metadado SNIRH); derivado do Copernicus | Sim (testado ponta a ponta) |
| TOPODATA (INPE) | antigo `www.dsr.inpe.br` → NXDOMAIN; STAC `https://data.inpe.br/bdc/stac/v1/collections/topodata-1` | 200; 556 folhas; ZN 70,8 MB, SN (declividade) 90,6 MB | CC-BY-4.0 (STAC) | Sim, após conversão (é SRTM reamostrado por krigagem) |
| LiDAR PMSP (M3DC) EPT | `https://ept-m3dc-pmsp.s3.sa-east-1.amazonaws.com/ept.json` | 200; 31.730.305.220 pontos, EPSG:31983, classes 2,5,6,19,20 | **GPL-3.0** (registro `awslabs/open-data-registry/datasets/pmsp-lidar.yaml`, conferido) | Sim, depois de gerar DTM e reamostrar p/ 1" |
| LiDAR PMSP LAZ | `https://laz-m3dc-pmsp.s3.sa-east-1.amazonaws.com/` | 5.544 arquivos, 193,7 GB | GPL-3.0 | idem |
| GeoSampa metadados MDT/MDS 2017 | `metadados.geosampa.../records/6f659d23-...` (MDT) e `b0ee59d3-...` (MDS) | MDT e MDS **0,50 m**, 5–30 pts/m², PEC-PCD classe A, voo mai–jul/2017, LAZ, EPSG:31983; acesso "semRestricoes", uso "license" sem texto | ver GPL acima | — |
| GeoSampa MDS 2020 | metadado `f2ddd371-...` (`geosampa/meta_nuvem_mds2020.xml`) | 0,50 m, **10 pts/m²**, 1.544 km² (município inteiro), PEC-PCD A; camada `quadricula_folha_mdt_mds_2020` (5.401 folhas) | idem | — |
| GeoSampa download MDT/MDS | `https://geosampa.prefeitura.sp.gov.br/PaginasPublicas/_SBC.aspx` | desafio anti-bot (F5); não automatizado | — | — |
| GeoSampa WFS relevo | `curva_mestra` 267.002, `curva_intermediaria` 704.641, `ponto_cotado` 437.499, `declividade` 24.637 | 200 | GeoSampa | Não diretamente |
| GeoSampa WCS | `.../geoserver/ows?service=WCS` | "Service WCS is disabled" | — | — |
| OpenTopography API | `https://portal.opentopography.org/API/globaldem?...` | 401 "API Key required" (o **bucket S3 público funciona sem chave**) | — | — |
| NASA LP DAAC | `data.lpdaac.earthdatacloud.nasa.gov/...` | 302 → login Earthdata | domínio público | — |
| FABDEM | `https://data.bris.ac.uk/data/dataset/s5hqmjcdj8yo2ibzi9b4ew3sn` | timeout de 60 s (2 tentativas, 2 rodadas) | **CC BY-NC-SA 4.0, proíbe uso comercial** (gee-community-catalog; o GEDTM30 removeu o FABDEM por isso) | descartado |
| CGIAR-CSI SRTM v4.1 (90 m) | `https://srtm.csi.cgiar.org/wp-content/uploads/files/srtm_5x5/TIFF/srtm_27_17.zip` | HEAD 200 (Last-Modified 2008) | disclaimer: proibido uso comercial/revenda/redistribuição sem permissão escrita do CIAT | descartado |
| TanDEM-X 90 m (DLR) | `https://geoservice.dlr.de/web/dataguide/tdm90/` (só busca) | não testado | grátis só para uso científico; comercial via Airbus | descartado |
| Mapterhorn (terrain tiles PMTiles) | `https://download.mapterhorn.com/attribution.json` | 200; 151 fontes, **nenhuma brasileira**: no Brasil é Copernicus GLO-30 | por fonte | Não (precisa converter) |
| Emplasa / DataGEO | `https://datageo.ambiente.sp.gov.br/geoserver/datageo/wms` (1.851 camadas) | só articulações Emplasa 1:10.000 e IBGE; nenhum MDT/MDE Emplasa publicado. Busca: Emplasa tem ortofotos 2010/11 de 1 m, MDT não encontrado | — | — |
| Mapeamento estadual SP com perfilamento a laser | buscador cita apresentações da CDHU (ortofotos 0,25 m; laser 4 pts/m²; resultados "1º sem. 2024") | **não confirmado**: os PDFs da CDHU retornam HTML (bloqueio) | — | — |
| IBGE MDE | `https://geoftp.ibge.gov.br/modelos_digitais_de_superficie/modelo_digital_de_elevacao_mde/` | rj25 (314), sc25 (86), spmggo50 (73, lat −20,3..−17,5: **não cobre a RMSP**) | IBGE (confirmar termos) | — |

## 3. Rampa nas vias OSM, bbox S24W047 (lon −47..−46, lat −24..−23)
Script `grade_analysis.py` (imita o elevationbuilder: postes a 60 m, bilinear). 346.186 ways; 13.562 km de vias principais
(motorway..tertiary + links), 50.154 km de vias locais; 6.137 ways de ponte/túnel (493 km) excluídos.
Km de vias principais em intervalos de 60 m acima do limite (rodada 2 acrescentou NASADEM, AW3D30 e GEDTM30):

| DEM | >5% | >8% | >10% | >12% | >15% | >20% | p95 do máx. por way |
|---|---|---|---|---|---|---|---|
| SRTM/Skadi (padrão Valhalla) | 5.006 | 2.505 | 1.548 | 944 | 440 | 128 | 17,6% |
| NASADEM | 4.893 | 2.368 | 1.412 | 831 | 371 | 103 | 16,6% |
| TOPODATA | 4.485 | 2.376 | 1.568 | 1.068 | 632 | 319 | 18,0% |
| AW3D30 v3.2 | 4.316 | 2.134 | 1.320 | 815 | 408 | 149 | 18,0% |
| Copernicus GLO-30 | 4.013 | 1.897 | 1.118 | 645 | 275 | 65 | 15,7% |
| GEDTM30 v1.2 | 3.768 | 1.726 | 981 | 549 | 221 | 51 | 14,5% |
| ANADEM v1 | 3.366 | 1.525 | 862 | 483 | 197 | 43 | 13,8% |

Arquivos: `grade_result_s24w047.json` (rodada 1), `grade_round2_nasadem_aw3d30.json`, `grade_round2_gedtm.json`.
OSM: só 13 ways com `incline=N%` numérico na área (rampas de garagem/serviço curtas).

## 4. Validação contra LiDAR 1 m (verdade de campo) — tabela completa da rodada 2
DTM 1 m com PDAL (`readers.ept` + `Classification[2:2]` + `writers.gdal` idw) em 3 áreas de ~1,6×1,7 km.
Erro de rampa por intervalo de 60 m (pp = pontos percentuais). P/R = precisão/recall para "rampa > limiar".
Script `compare_round2.py`, resultado `round2_lidar.json`. (A área Sumaré tem 36,0 km aqui contra 41,8 km na rodada 1
porque o recorte agora usa a mesma regra de margem das outras áreas; os números são da mesma ordem.)

| Área | DEM | MAE pp | RMSE pp | % trechos >8% | P/R >8% | P/R >12% | P/R >15% |
|---|---|---|---|---|---|---|---|
| Sumaré/Perdizes (36,0 km, morro; LiDAR 18,6% >8%) | SRTM/Skadi | 4,06 | 5,64 | 32,9 | 0,32/0,57 | 0,18/0,49 | 0,11/0,40 |
| | NASADEM | 3,75 | 5,08 | 31,3 | 0,34/0,57 | 0,20/0,47 | 0,11/0,27 |
| | AW3D30 v3.2 | 3,07 | 5,01 | 30,2 | 0,44/0,71 | 0,32/0,58 | 0,22/0,67 |
| | Copernicus | 2,87 | 3,98 | 27,2 | 0,46/0,68 | 0,30/0,56 | 0,25/0,47 |
| | GEDTM30 v1.2 | 2,53 | 3,58 | 25,3 | 0,52/0,70 | 0,37/0,51 | 0,32/0,47 |
| | ANADEM v1 | 2,45 | 3,48 | 22,2 | 0,53/0,63 | 0,39/0,40 | 0,24/0,33 |
| | **LiDAR reamostrado p/ 1"** | **1,17** | 2,11 | 19,6 | 0,77/0,81 | 0,70/0,65 | 0,67/0,80 |
| Freguesia do Ó (33,1 km, morro; LiDAR 26,1% >8%) | SRTM/Skadi | 3,20 | 4,39 | 27,0 | 0,64/0,66 | 0,57/0,57 | 0,45/0,48 |
| | NASADEM | 3,01 | 4,24 | 26,3 | 0,67/0,68 | 0,64/0,55 | 0,52/0,38 |
| | AW3D30 v3.2 | 2,43 | 3,76 | 28,3 | 0,74/0,80 | 0,65/0,78 | 0,57/0,69 |
| | Copernicus | 2,38 | 3,56 | 29,9 | 0,73/0,84 | 0,64/0,77 | 0,62/0,62 |
| | GEDTM30 v1.2 | 2,20 | 3,06 | 26,3 | 0,78/0,79 | 0,66/0,68 | 0,77/0,57 |
| | ANADEM v1 | 2,11 | 3,12 | 22,3 | 0,81/0,69 | 0,72/0,61 | 0,68/0,40 |
| | **LiDAR 1"** | **1,02** | 1,71 | 26,8 | 0,87/0,90 | 0,84/0,84 | 0,74/0,74 |
| Mooca (26,8 km, plano; LiDAR 1,8% >8%) | SRTM/Skadi | 2,94 | 4,26 | 14,4 | 0,05/0,40 | — | — |
| | NASADEM | 2,77 | 3,96 | 13,0 | 0,05/0,40 | — | — |
| | AW3D30 v3.2 | 2,75 | 5,35 | 12,1 | 0,09/0,60 | — | — |
| | Copernicus | 2,34 | 3,65 | 9,6 | 0,11/0,60 | — | — |
| | GEDTM30 v1.2 | 1,87 | 2,80 | 6,5 | 0,16/0,60 | — | — |
| | ANADEM v1 | 1,34 | 2,09 | 3,3 | 0,47/0,90 | — | — |
| | **LiDAR 1"** | **0,49** | 0,84 | 1,9 | 0,64/0,70 | — | — |

Leitura: os DEMs de superfície (SRTM, NASADEM, AW3D30, Copernicus) inventam rampas em área plana e densa (prédios);
ANADEM e GEDTM30 (DTMs) reduzem isso, mas tendem a **subestimar** rampas fortes (recall >15% de 0,33–0,57).
Viés de altura (DEM − LiDAR) de +2,6 a +7,8 m reflete datum vertical (EGM96/EGM2008 vs. altitude do levantamento) +
superfície; não afeta rampa. Quantização Int16 do HGT custa só +0,1 a +0,2 pp de MAE (`compare_quant.py`).

Custo do LiDAR: área de 2,8 km² = 331 MB do EPT em 13 s. Cidade inteira ≈ 190 GB (LAZ) → processar dentro da AWS sa-east-1.
Downloads: rodada 1 ≈ 1,3 GB (EPT) + ~300 MB de DEMs; rodada 2 ≈ 80 MB (AW3D30, NASADEM e GEDTM30, guardados no volume
Docker `elevwork_data:/w/dem`, fora do scratchpad) + ~0,5 MB de docs.

## 5. Normas e física de rampa (para calibrar o limite por veículo)
- **DNER/DNIT IPR-706, Manual de Projeto Geométrico de Rodovias Rurais (1999)**:
  `https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/ipr/coletanea-de-manuais/vigentes/706_manual_de_projeto_geometrico.pdf`
  (43 MB, OCR). Quadro 5.5.2.1 "Rampas máximas" (plano/ondulado/montanhoso): Classe 0: 3/4/5%; I: 3/4,5/6%; II: 3/5/7%;
  III: 4/6/8%; IV-A: 4/6/8%; IV-B: 6/8/10%; acima de 8% "desejavelmente" até 300 m contínuos. Terceira faixa com
  ≥200 veic/h na subida, ≥10% de caminhões e queda ≥15 km/h dos pesados.
- **DNIT IPR-740, Manual de Projeto Geométrico de Travessias Urbanas (2010)**: aparece como vigente na página da coletânea
  do DNIT, mas **sem link de PDF** (testado na rodada 2). Valores de rampa urbana não confirmados.
- **Município de SP, Lei 16.402/2016 (LPUOS), Quadro 2B** (arquivo oficial `normas/lei16402_quadro2B.docx`, baixado de
  `https://gestaourbana.prefeitura.sp.gov.br/wp-content/uploads/2016/03/004-QUADRO_2B_FINAL.docx`): declividade
  longitudinal máxima em vias novas de parcelamento: estrutural N1 6%, N2 6%, N3 8%, **coletora 10%, local 15%**,
  ciclovia 10%, pedestre 8,33%; mínima 0,5%. (Não conferi se a revisão de 2024 da LPUOS mudou o quadro.)
  A Lei 9.413/1981 tinha um Quadro 1 com 6/6/8/8% (expressa/arterial/principal/local), **revogado** pela Lei 13.885/2004
  (página da SEHAB `prefeitura.sp.gov.br/web/habitacao/.../legislacao/6756`). Ruas antigas passam muito disso
  (LiDAR: 18,6% e 26,1% dos trechos de 60 m acima de 8% em Sumaré e Freguesia do Ó).
- **Resolução CONTRAN 882/2021** (pesos e dimensões; DOU: https://www.in.gov.br/en/web/dou/-/resolucao-contran-n-882-de-13-de-dezembro-de-2021-370017699, HTTP 200): art. 18 CVC >57 t ou >19,80 m só com AET; art. 19 §1º tratora 6x4
  que, carregada, deve "vencer aclives de 6%" com atrito 0,45, resistência ao rolamento 11 kgf/t e rendimento 90%;
  §2º até 58,5 t pode ser 4x2/6x2; §3º pode exigir faixa adicional em rampas >5% e >600 m.
  Anexo III: `i = Ft/(10·G) − Rr/10`, `Ft = min(Fr, Fad)`, `Fr = Tm·ic·id·0,9/Rd`, `Fad = P·u` (imagens em `normas/`).
- **Resolução CONTRAN 872/2021** (CVC de cana; DOU: https://www.in.gov.br/en/web/dou/-/resolucao-contran-n-872-de-13-de-setembro-de-2021-345770900): memória de cálculo para rampas até 6%; freio de estacionamento em 12%.
- Fichas de fabricante (capacidade mecânica, não aderência; fonte secundária, catálogo AECweb): Ford Cargo 1729
  (PBT 16 t, 213 kW): subida 50% (PBT) e partida em rampa 37% (PBT); Agrale 14000 6x2 (PBT 22 t, 190 cv): subida
  23,3–34,2%, partida 16,9–23,9%. Conclusão: o motor/câmbio quase nunca é o limite; o limite real é aderência no piso
  molhado (eixos motrizes vs. peso total) e velocidade/temperatura em rampa longa.
- Tese USP São Carlos (Setti): caminhões brasileiros com 100–380 kg/kW (só pelo resumo; página deu HTTP 400).

Cálculo próprio (`calc_rampa_veiculos.txt`), limite por aderência com a fórmula do CONTRAN e eixos no limite legal:

| Configuração | u=0,45 (molhado, CONTRAN 882) | u=0,70 (seco) |
|---|---|---|
| Toco 4x2 (16 t) | 27,0% | 42,6% |
| Truck 6x2 (23 t) | 15,5% | 24,8% |
| Truck 6x4 (23 t) | 32,2% | 50,6% |
| Carreta 2S3 cavalo 4x2 (41,5 t) | 9,7% | 15,8% |
| Carreta 3S3 cavalo 6x2 (48,5 t) | 6,8% | 11,2% |
| Carreta 3S3 cavalo 6x4 (48,5 t) | 14,7% | 23,4% |
| Bitrem 6x4 (57 t) | 12,3% | 19,8% |
| Rodotrem 6x4 (74 t) | 9,2% | 15,0% |

Velocidade sustentada teórica a 250 kg/kW: 120 km/h no plano, 22 km/h em 5%, 15 km/h em 8%, 8 km/h em 15%.

### Proposta de limites por preset (a validar com reportes `steep_grade` e motoristas)
Usar `max_upward_grade` no sentido do percurso (aderência só importa subindo). Margem para erro do DEM: ANADEM erra
~2–2,5 pp em morro; LiDAR ~1 pp.
| Preset | Aviso a partir de | Penalizar/evitar acima de |
|---|---|---|
| VUC / Toco | 15% | 20% |
| Truck (6x2) | 12% | 15% |
| Carreta (cavalo 4x2/6x2) | 6% | 8% (aderência 6,8–9,7% no molhado) |
| Carreta 6x4 / Bitrem | 10% | 12% |
| Rodotrem | 6% | 9% |

## 6. Comandos (reprodução)
```
# Skadi (padrão Valhalla)
curl -O https://elevation-tiles-prod.s3.us-east-1.amazonaws.com/skadi/S24/S24W047.hgt.gz
# NASADEM e AW3D30 v3.2 pelo bucket público do OpenTopography (sem chave)
gdal_translate /vsicurl/https://opentopography.s3.sdsc.edu/raster/NASADEM/NASADEM_be/NASADEM_HGT_s24w047.tif nasadem.tif
gdal_translate /vsicurl/https://opentopography.s3.sdsc.edu/raster/AW3D30/AW3D30_global/ALPSMLC30_S024W047_DSM.tif aw3d30.tif
# GEDTM30 v1.2 (recorte por range; valores já em metros, ignorar a tag Scale=0.1)
gdal_translate -projwin -47.0002 -22.9998 -45.9998 -24.0002 /vsicurl/https://s3.opengeohub.org/global/dtm/v1.2/gedtm_rf_m_30m_s_20060101_20151231_go_epsg.4326.3855_v1.2.tif raw.tif
gdal_translate -a_scale 1 -a_offset 0 raw.tif gedtm30.tif
# Copernicus
curl -O https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_S24_00_W047_00_DEM/Copernicus_DSM_COG_10_S24_00_W047_00_DEM.tif
# TOPODATA via STAC
curl "https://data.inpe.br/bdc/stac/v1/collections/topodata-1/items?bbox=-46.9,-23.8,-46.3,-23.3"
# ANADEM: recorte por HTTP range e conversão para HGT do Valhalla
gdalwarp -te -47.000138889 -24.000138889 -45.999861111 -22.999861111 -ts 3601 3601 -r bilinear -ot Int16 \
  -dstnodata -32768 /vsicurl/https://metadados.snirh.gov.br/files/anadem_v1_tiles/anadem_v1_23K.tif grid.tif
gdal_translate -of SRTMHGT grid.tif S24/S24W047.hgt
# LiDAR PMSP -> DTM 1 m (pmsp_lidar/pipeline_pdal_ept_dtm.json, run_area.sh, compare_area.sh)
docker run --rm pdal/pdal pdal pipeline ept_dtm.json
# Contagem de tiles (IBGE)
curl "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima"
curl "https://servicodados.ibge.gov.br/api/v1/localidades/regioes-metropolitanas"   # RM 04901 = 39 municípios
# Estado atual do Valhalla do projeto
curl -s localhost:8002/height -d '{"shape":[{"lat":-23.5505,"lon":-46.6339}]}'   # -> height [null]
```
Imagens Docker: `ghcr.io/osgeo/gdal:ubuntu-small-3.9.3` (contêiner `elevwork`, volume `elevwork_data`),
`debian:bookworm-slim`, `pdal/pdal:latest` (2.10.2).

## 7. Integração proposta
1. **Elevação no Valhalla com DEM próprio, não Skadi**: gerar HGT 1" Int16 em `data/valhalla/elevation_data/S24/S24W047.hgt`
   (o `valhalla.json` já aponta para `/custom_files/elevation_data`) a partir do ANADEM para os 112 tiles do Sudeste
   (Brasil: 811). Para S24W047 (e S24W048/S25W047 nas bordas do município), fazer mosaico: ANADEM de base e DTM LiDAR
   reamostrado por cima dentro do limite do município (gdalwarp com as duas fontes, LiDAR por último). Rebuild dos tiles.
   Atribuição no app: "ANADEM (ANA/UFRGS) CC BY 4.0; contém dados Copernicus DEM © DLR/Airbus; LiDAR © PMSP/GeoSampa (GPL-3.0)".
2. **API (curto prazo, sem fork)**: depois do `/route`, chamar `trace_attributes` com `filters` em
   `edge.max_upward_grade, edge.length, edge.way_id` e comparar com `grade_limits(preset, aviso_pct, evitar_pct)` (tabela acima,
   em config). Se passar do limite "evitar", gerar polígono de exclusão no trecho e recalcular (mesma mecânica de
   `exclude_polygons` das zonas); se só passar do "aviso", devolver alerta com km e local.
3. **PostGIS `steep_segments`** (way_id, geom, max_up_pct, sentido, fonte, confiança): gerado do LiDAR (município) e do
   ANADEM (resto), mostrado no mapa; reportes `steep_grade` confirmam/derrubam.
4. **Médio prazo**: fork do `truckcost.cc` com fator de velocidade por `weighted_grade` (como `bicyclecost.cc`) e corte por
   `max_up_slope` > limite do preset (precisão de 1% até 16%). Opcional: PR upstream na issue #1191.
5. Licença: GPL-3.0 do LiDAR é incomum para dado. Uso interno no servidor (rotear e avisar) parece tranquilo; distribuir
   os HGT/derivados para terceiros pode exigir GPL. Pedir leitura jurídica antes de publicar derivados.
