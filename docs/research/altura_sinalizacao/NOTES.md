# Altura livre (viadutos/túneis) e placas de restrição: fontes além do OSM

Pesquisa feita em 09/10/2026, em duas sessões. A primeira foi interrompida e deixou arquivos sem NOTES; esta sessão reaproveitou o que já tinha sido baixado (nada foi baixado de novo) e completou o resto.
Pasta: `research/altura_sinalizacao/`. PBF usado: `data/valhalla/sudeste-latest.osm.pbf` (replicação 2026-10-08T20:21Z).

## Conclusão curta

1. **Nenhuma fonte oficial aberta traz a altura livre de viadutos e túneis urbanos**: CET, GeoSampa, SIURB, DER-SP OAE e ANTT pontes não publicam isso.
   As exceções são poucas:
   - **ARTESP passarelas** (campo ALTURA; na RMSP o mínimo é 5,42 m, então nenhuma restringe um caminhão de 4,40 m);
   - **DNIT SIAET** (altura máxima de AET por segmento PNV nas BRs; já levantado no tema `pontes_federais`).
2. **Placas**:
   - O **DER-SP publica um inventário georreferenciado de 427.785 placas** (CC-BY-4.0), com 180 R-15 (altura máx.), 141 A-37 (altura limitada), 211 R-14, 116 R-9 e 58 R-18. Só traz o **código** da placa, não o valor.
   - Das 180 R-15, **só 30 (17%) têm um maxheight do OSM a ≤300 m**.
   - A CET (capital) e a ARTESP (concessões) **não publicam** inventário de placas.
3. **Mapillary exige token** (sem token: HTTP 500 "Invalid OAuth 2.0 Access Token" na Graph API e 403 nos tiles). A classe `regulatory--height-limit--g1` **não traz o número** da altura (só os limites de velocidade trazem o valor na classe), então a detecção serve para dizer onde há placa, mas o valor precisa de OCR ou de alguém olhando a imagem.
   - KartaView tem fotos antigas (2020–21) e não expõe detecções por API.
   - Panoramax tem 36 fotos na RMSP.
4. **OSM na Grande SP** (via principal motorway..secondary sob estrutura, 1 local = cruzamentos agrupados a 25 m):
   - RMSP: **1.502 locais, 1.145 sem maxheight (76%)**;
   - capital: 778 locais, 587 sem (75%);
   - sob viaduto rodoviário na RMSP: 888 locais, 665 sem (75%);
   - sob ponte ferroviária: 87,5% sem.
   - Pelo inventário oficial do GeoSampa, **dos 299 conjuntos de viaduto da capital, 175 têm via OSM por baixo sem maxheight**, 86 têm maxheight e 38 não casaram com nenhuma via.
5. **Os buracos do OSM são, em geral, estruturas altas.** Os pontos críticos conhecidos estão marcados:
   - Euclides Figueiredo 4,1; Túnel Jânio Quadros 3,5; Fanganiello Melhem 4,1; Av. do Estado × Linha 11 4,3; Casa Verde 4,5/5,3.
   - Dos 279 locais (via principal, RMSP) com maxheight numérico, só 27 (<4,40 m) bloqueiam um caminhão de altura legal.
   - O **piloto com o LiDAR da PMSP** confirma isso: dos 43 locais sem maxheight medidos, 31 têm topo do tabuleiro a ≥8 m da pista de baixo e **4 (≈9%) são suspeitos** (6,0–7,0 m, o que dá altura livre estimada de ~3,5–4,7 m).
6. **O Valhalla aplica maxheight como restrição rígida**. Teste no container local: Av. Guarulhos com maxheight 4,0 dá 1,07 km para um caminhão de 3,5 m e 6,74 km de desvio para um de 4,4 m.
   O Valhalla **ignora maxheight em nós e `barrier=height_restrictor`**: na Sudeste são 235 nós com maxheight e 46 height_restrictor (no Brasil, 325 nós com maxheight). Pelo `graph.lua`, só os ways são lidos.

## Números-chave medidos

| Medida | Valor | Como |
|---|---|---|
| Ways highway com maxheight (Sudeste) | 3.242 (+99 maxheight:physical) | osmium no PBF (`osm/sudeste_counts.txt`) |
| Ways highway bridge / tunnel (Sudeste) | 63.959 / 2.812 | idem |
| Nós maxheight / height_restrictor / traffic_sign (Sudeste) | 235 / 46 / 3.591 | idem |
| Nós maxheight no Brasil | 325 | Overpass overpass-api.de (HTTP 200) |
| Ways highway com maxheight:physical no Brasil | 127 | Overpass (HTTP 200) |
| Nós traffic_sign~maxheight\|R-15 no Brasil | 11 | Overpass kumi.systems (HTTP 200) |
| Ways highway com maxheight no Brasil | **não medido** | Overpass 504/500 em 3 instâncias; o PBF do Brasil tem 2,09 GB (HEAD), acima do limite |
| traffic_sign no bbox da Grande SP | 563 (457 maxspeed; **4 maxheight**) | `osm/ts.geojsonseq` |
| Valores maxheight (bbox Grande SP, 1.243 numéricos) | <3,0: 111; 3,0–3,49: 41; 3,5–3,99: 33; 4,0–4,39: 147; 4,40–4,99: 273; ≥5,0: 638. Não numéricos: default 62, no_indications 37, none 28, below_default 9 | `osm/analyze_output.txt` |
| Túneis drivable na RMSP sem maxheight | 400 de 485 ways (principais + tertiary: 87 de 158) | idem |
| Vias principais sem maxheight por nome (RMSP) | Rodoanel 34, Raposo 33, Ayrton Senna 26, Av. do Estado 24, Dutra 22… | idem |

Arquivos: `osm/rmsp_vias_principais_sob_estrutura_sem_maxheight.geojson` (1.145 pontos), `osm/rmsp_vias_principais_sob_estrutura_todos.geojson` (1.502), `geosampa/obra_arte_clusters_vs_osm_maxheight.geojson`, `candidatos_altura_sem_valor.geojson` (523 pontos: 275 placas R-15/A-37 do DER sem OSM, 65 detectores ANTT, 183 viadutos/túneis GeoSampa sem maxheight).

## Fontes testadas

### 1. Mapillary (Meta): API Graph + vector tiles
- Testes sem token (`mapillary/`):
  - `GET https://graph.mapillary.com/map_features?fields=id,object_value,geometry&bbox=-46.66,-23.56,-46.64,-23.54&object_values=regulatory--height-limit--g1` → **HTTP 500** `{"error":{"message":"Invalid OAuth 2.0 Access Token","code":190}}`;
  - `/images` dá o mesmo erro;
  - tiles `https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2/14/6067/9293` e `mly1_public` → **HTTP 403**.
- Como obter o token: criar um app em https://mapillary.com/dashboard/developers. O client token vai em `?access_token=` ou no header `Authorization: OAuth <token>`. É gratuito.
- `map_features`:
  - campos: `object_value`, `object_type` (traffic_sign|point), `geometry`, `first_seen_at`, `last_seen_at`, `images`, `aligned_direction`;
  - filtros: `bbox` (área **< 0,01 grau²**) e `object_values` (aceita curinga); limite de 2.000 resultados.
  - Os tiles `mly_map_feature_traffic_sign` só existem em z14.
  - Rate limit: entity 60.000/min, search 10.000/min, **tiles 50.000/dia** (https://www.mapillary.com/developer/api-documentation).
- Classes relevantes (`mapillary_sign_classes.txt`, repositório `mapillary/mapillary_sprite_source`, 1.941 sprites):
  - `regulatory--height-limit--g1`, `warning--height-restriction--g2..g5`, `information--height-limit--g1/g2`, `complementary--height-limit--g1/g2`;
  - `regulatory--weight-limit--g1..g7`, `regulatory--weight-limit-per-axle--g1`, `regulatory--length-limit--g1/g2`, `regulatory--width-limit--g1`;
  - `regulatory--no-heavy-goods-vehicles--g1..g5`, `regulatory--no-through-trucks--g1`, `warning--trucks-rollover--*`.
  - **Nenhuma classe de altura ou peso carrega o valor**; só as de velocidade carregam (`...-speed-limit-40--g1`).
- Licença (`mapillary_terms.txt`, Termos de 15/02/2024):
  - o conteúdo dos usuários é **CC BY-SA**;
  - o uso comercial é permitido pela seção 12, mas só para "improvement, training, and development of products … maps … datasets" ou para prestar serviço a clientes, com proibição de reidentificar/desborrar e aviso a vendor-incident@meta.com;
  - a seção 13 permite usar tudo para editar o OSM/Overture.
- Cobertura em SP: **não medida** (precisa de token).
- Integração:
  - importador z14 do bbox da RMSP (~2.800 tiles, cabe no limite diário) → tabela `sign_detection`;
  - casar com estruturas e vias sem maxheight e gerar uma fila de "placa de altura vista, valor desconhecido";
  - o valor viria de reporte no app ou de OCR no recorte da imagem (CC BY-SA → guardar em base separada com atribuição).

### 2. KartaView (Grab)
- `POST https://api.openstreetcam.org/1.0/list/nearby-photos/` com `lat=-23.55&lng=-46.65&radius=500` → HTTP 200, `totalFilteredItems` = **8.995 fotos** num raio de 500 m da Paulista, de **2020 (846) e 2021 (154)** na amostra de 1.000. Ficou em `kartaview/nearby_v1.json`.
- `GET /2.0/photo/?lat..&radius=500` → HTTP 400 (apiCode 408, "Query timeout. Narrow your filter").
- `GET /2.0/detection/` → HTTP 404.
- A detecção de placas não é exposta por API. A wiki do OSM (KartaView/Detected_Signs, editada em 30/03/2022) lista só placas dos EUA, sem altura nem peso.
- Licença das imagens: CC BY-SA. Valor baixo: fotos velhas e nenhuma detecção.

### 3. Panoramax (api.panoramax.xyz, STAC)
- `GET /api/search?bbox=-47.21,-24.07,-45.69,-23.18&limit=1000` → **36 fotos** na RMSP (30 de 2026), em 8 coleções. Licença: CC-BY-SA-4.0 na instância OSM-FR.
- Há filtro semântico (`/api/queryables`: `semantics IS NOT NULL`, `semantics.<chave>`).
- Na RMSP, 6 fotos têm anotação automática (`SGBlur-yolo11s` + `classify_fr_road_signs`), todas classificadas como placa **francesa** FR:B14[30] (classificador francês aplicado a placa brasileira).
- Busca global por `BR:R-15` → HTTP 502.
- Valor: nulo hoje; pode virar canal de coleta próprio (app Panoramax, licença aberta).

### 4. DER-SP: Sinalização Vertical (dadosabertos.sp.gov.br, CC-BY-4.0)
- XLSX: https://dersp.der.sp.gov.br/WebSite/Arquivos/DadosAbertos/AtivosRodoviarios/SinalizacaoVertical/Sinaliza%C3%A7%C3%A3o%20Vertical.xlsx (24 MB, em `dersp/`, convertido para `dersp/sv_rows.json`).
- FeatureServer: https://mapas.der.sp.gov.br/server/rest/services/Hosted/Sinalizacao_Vertical_DBO/FeatureServer/0 (via tema `pontes_sp_estado_municipio`).
- **427.785 placas** (levantamento 2024–2026), só na malha administrada pelo DER, sem as concessões.
  - Campos: Regional, Rodovia, Levantamento, KM, Lat, Lon, Código placa, Tipo, Atendimento à norma.
  - **Não há campo com o valor.**
- Placas de restrição:

  | Código | Significado | SP inteiro | RMSP |
  |---|---|---|---|
  | R-15 | altura máx. | 180 | 20 |
  | A-37 | altura limitada | 141 | 13 |
  | R-14 | PBT | 211 | 17 |
  | R-18 | comprimento | 58 | 14 |
  | R-9 | proibido caminhão | 116 | 6 |
  | R-17 | — | 9 | — |
  | R-16 | — | 7 | — |

  Filtradas em `dersp/der_placas_R9_R14_R15_R17_R18.csv` (574 linhas).
- **Cruzamento com o OSM (Sudeste inteiro): R-15 com maxheight a ≤300 m: 30/180; A-37: 16/141; R-14: 5/211; R-9: 2/116.**
- Integração:
  - importador mensal → `sign_inventory` (fonte=DER);
  - placa R-15 sem maxheight próximo vira um ponto "restrição de altura existe, valor desconhecido", com aviso e pedido de reporte;
  - para R-9, ver o tema de restrições.

### 5. GeoSampa (WFS da PMSP)
- O GetCapabilities (485 camadas) **não tem inventário de placas nem gabarito**. Camadas úteis:
  - `obra_arte` (6.548 linhas: PONTE 4.416, VIADUTO 1.129, PASSARELA 821, TÚNEL 114, CALÇADÃO 68; base 2004 em 91%, sem altura nem nome; em `obra_arte.geojson`);
  - `sac_placa_transito` (941 pedidos de manutenção de placas ao SAC, 2020–21; não é inventário; `sac_placa_transito.geojson`);
  - `sac_vistoria_reparo_ponte_viaduto` (pedidos).
- Cruzamento `obra_arte` × OSM (`geosampa/viadutos_vs_osm.py`, clusters de 15 m, raio 35 m):
  - VIADUTO 299 clusters: 86 com maxheight, **175 com via por baixo sem maxheight** (129 em via principal), 38 sem via OSM;
  - TÚNEL 50: 20 com maxheight, 8 sem, 22 sem túnel OSM casado;
  - PASSARELA 288: 35 com, 122 sem, 131 sem via.
- Licença: nenhuma licença formal por camada (capabilities "Fees NONE / AccessConstraints NONE").
  - **Atenção:** `api/src/layers/oae.layer.ts` declara "CC-BY-SA 4.0" para o GeoSampa, e eu não encontrei essa confirmação.

### 6. CET-SP
- O CKAN da PMSP (`dados.prefeitura.sp.gov.br`, org `cet`) tem **6 datasets**: folha, fluxo de caixa, lentidão 2001–2023, ciclovias, **cadastro de lombadas**, fiscalização eletrônica. **Não há inventário de sinalização vertical.** A SMT tem 5 datasets, nenhum de sinalização.
  - A busca `package_search` do CKAN está quebrada (sempre devolve o mesmo pacote da CGM), e o WAF às vezes responde HTML. Usei `organization_show`.
- O GeoSampa também não tem camada de placas da CET.
- Documentos técnicos (fatos, não dados):
  - **E.T. SDAAE** (https://ssl.cetsp.com.br/media/1091607/SDAAE.pdf, em `cet/SDAAE.pdf`): especificação do sistema de detecção de altura excedente. Cita 4,40 m (Res. CONTRAN 210/2006) ou a altura da R-15 local, e a autuação pelo art. 231, IV do CTB.
  - **MSU Vol. 03 – Advertência**, Rev. 01 com apêndice de maio/2025 (https://www.cetsp.com.br/media/1630529/MSU-Vol-03-Advertencia-Rev-01-Inserido-apendice-I-maio-2025.pdf, 3,4 MB, 244 p., em `cet/`): critérios de uso e locação da A-37 "Altura limitada", com complementos "A … metros" e "SAÍDA". Cita a Res. CONTRAN 973/22.
- Notícia de 09/12/2021 (abcdoabc.com.br): a CET instalou "placas de alumínio suspensas na altura exata" em 9 pontos de colisão (23 de Maio × Viaduto Gen. Euclides Figueiredo; Túnel Jânio Quadros; Av. do Estado × viaduto CPTM; Pacaembu × Gen. Olímpio da Silveira; Otaviano Alves de Lima × Ponte Comunidade Húngara e × Ponte Casa Verde; Raimundo Pereira de Magalhães; Gabriela Mistral × Viaduto Fepasa; R. da Cantareira × CPTM). A notícia não traz valores. Vários desses pontos já têm maxheight no OSM.

### 7. ANTT: Detecção de Altura (dados.antt.gov.br, CC-BY)
- CSV: https://dados.antt.gov.br/dataset/daf08c28-7a47-43f8-ae38-a0f927dae20a/resource/c06463b7-4edc-457d-b52c-91e4ffe05700/download/informacoes-sobre-os-equipamentos-de-deteccao-de-altura-estacao-meteorologica.csv (HTTP 200, 14 KB, latin-1, `;`). Ficou em `antt/deteccao_altura.csv`.
- 124 equipamentos, dos quais **65 são detectores de altura**, todos ativos, em 15 concessionárias. No SP são 7, todos na Régis Bittencourt; **1 na RMSP** (BR-116 km 296,2, Itapecerica da Serra).
- Sem altura medida nem gabarito, mas indica pontos com risco de altura conhecido nas BRs concedidas.
- **ANTT Pontes e similares** (`antt/pontes-e-similares.csv`, 3.513 linhas): sem campo de altura.
- **ANTT Sinalização** traz só "proibido ultrapassar" e "velocidade máxima". Busca no CKAN por "gabarito" e "viaduto": 0 resultados.

### 8. ARTESP: Passarelas (CC-BY)
- `artesp/passarelas.xlsx` (444 passarelas, ALTURA preenchida em 409).
- RMSP: 81 passarelas, 71 com altura, **mínimo 5,42 m**. **76 de 81 não têm maxheight no OSM** (`artesp/passarelas_rmsp_vs_osm.csv`).
- Valor baixo para roteamento (nenhuma abaixo de 4,40) e útil para preencher o OSM/base própria.
- O CKAN da ARTESP não tem inventário de placas (busca "sinalização" só devolve normas, normativos e programação de obras).

### 9. DNIT SIAET: restrições de AET por segmento (levantado no tema `pontes_federais`)
- PDFs de restrição definitiva e temporária por UF (https://siaet.dnit.gov.br), convertidos em `../pontes_federais/aet_restricoes_definitiva_2026-10.csv` (3.374 segmentos, **2.652 com altura**) e `..._temporaria_2026-10.csv` (1.532; 1.211 com altura).
  - Valores mais comuns: 5,5 / 5,6 / 5,8 / 6,0 m.
  - SP: BR-116 com 5,4–7,1 m por trecho; BR-050 km 0–5,7 com 4,4 m.
- É a **única fonte oficial com altura livre por trecho**, só nas BRs e pensada para AET.
- Integração: atributo de segmento casado por BR+km (malha SNV) e comparado ao maxheight do OSM.
- Licença: o rodapé do SIAET aponta CC BY-ND 3.0.

### 10. Overture Maps (transportation/segment, release 2026-09-23.1)
- DuckDB direto no S3 (`overture/q.py`, `q2.py`). No bbox da RMSP:
  - 644.362 segmentos de via, 192.199 com `access_restrictions`;
  - **1.231 com restrição de altura**, 31 de peso, 10 de comprimento, 555 hgv.
- **Todas as alturas vêm do OpenStreetMap** (fontes: OpenStreetMap 3.021, licença ODbL-1.0). O TomTom aparece só como fonte de geometria (13.633). **Não acrescenta nada ao OSM.**

### 11. LiDAR aéreo da PMSP (M3DC): piloto de triagem de altura
- EPT: `https://ept-m3dc-pmsp.s3.sa-east-1.amazonaws.com/ept.json` (voo de 2017).
- Licença: **GPL-3.0**, segundo `awslabs/open-data-registry/datasets/pmsp-lidar.yaml` (conferido). É uma licença atípica para dados: usar internamente e não redistribuir os pontos.
- Método (`lidar/clearance_sample.py`, PDAL `pdal/pdal:latest`, janela de 60×60 m):
  - **topo** = mediana da classe 9 (empiricamente o tabuleiro; o significado da classe não está documentado) a ≤3 m do cruzamento;
  - **pista** = mediana das classes 2/20 a ≤1,5 m do eixo OSM da via de baixo, entre 10 e 28 m.
- Calibração (25 locais com maxheight no OSM):
  - topo−pista − maxheight: mediana **2,53 m** (p10 1,47; p90 3,07), que inclui a espessura do tabuleiro e a margem da placa;
  - **Pearson r = 0,72**.
- Locais sem maxheight (43 válidos de 50 sorteados entre 299):
  - <6,0 m: 0; **6,0–6,99: 4**; 7,0–7,99: 8; ≥8,0: 31.
  - Suspeitos: Av. Condessa Elisabeth de Robiano × Saída Aricanduva (6,15); Av. Gabriela Mistral × Viaduto Domingos Franciulli Netto (6,21; a Gabriela Mistral está na lista de colisões da CET); Av. do Estado × Viaduto 25 de Março (6,90); Av. Anhaia Mello × Viaduto Grande São Paulo (6,96).
- Piloto inicial (`lidar/clearance_pilot.py`, 6 locais):
  - Euclides Figueiredo (placa 4,1) = 6,08;
  - Linha 11 × Av. do Estado (4,3) = 6,42;
  - Glicério e Diário Popular (sem maxheight) = 9,7 e 9,25;
  - Olavo Setúbal deu 15,65 (estrutura de dois níveis): **o método falha em complexos multinível**.
- Custo: ~1,5–2 MB de CSV por local; a amostra inteira (80 locais) levou cerca de 1 min com 6 processos em paralelo. Os 587 locais da capital caberiam em ~1 GB de texto (ou rodando na AWS sa-east-1).
- Cobre só o município de SP.
- Integração: job offline que gera `clearance_estimate` (flag "suspeito <~4,7 m") para priorizar a coleta e avisar na rota. **Nunca** gera restrição rígida no Valhalla.

### 12. Normas (fatos que mudam regra de produto)
- **Res. CONTRAN 882/2021** (`normas/contran_882_*`), art. 4º, II (redação da Res. 994/2023): "altura máxima: 4,40 m" para veículos sem AET.
  - No artigo dos veículos do acordo MERCOSUL (Res. GMC 65/2008) o limite é menor: "caminhão: 4,3 m" e "ônibus de longa distância: 4,1 m".
  - A Portaria SMT 052/2024 (tema `restricoes_sp_capital`) repete o limite de 4,40 m.
- **MBST Vol. I**, Regulamentação (`mbst_vol1.pdf`/`.txt`), sinal R-15:
  - usado "devido à existência de obstáculos físicos à frente, em geral obras, pontes, viadutos, túneis, passarelas";
  - "Deve-se adotar uma margem de segurança"; a medida tem uma casa decimal;
  - deve vir antecedido da **A-37**;
  - infração pelo **art. 231, IV do CTB**.
- **Res. CONTRAN 973/2022** (18/07/2022, https://www.legisweb.com.br/legislacao/?id=434344): institui o Regulamento de Sinalização Viária com os 9 volumes do MBST. O PDF no gov.br (`.../Resolucao9732022.pdf`) deu **HTTP 404**.
- **ARTESP IP.DIN/010** (tema `pontes_sp_estado_municipio`): altura livre mínima de 5,5 m em projeto de OAE estadual.

### 13. Comerciais (não testados com conta)
- **HERE**: a página de cobertura de truck routing (https://docs.here.com/routing/docs/routing-v8-truck-routing-coverage) lista o Brasil como "**motorway coverage**", que eles definem como "truck restrictions available along motorways and main roads". Pago.
- **TomTom Logistics**: não confirmei a cobertura no Brasil. A busca misturou com a documentação da HERE.
- **Google Street View**: os termos proíbem extrair dados. Não serve.

### 14. StreetComplete / Valhalla (código)
- `streetcomplete/AddMaxHeight.kt`: a quest pergunta maxheight em ways sob ponte (layer maior, sem nó em comum), túneis, `barrier=height_restrictor` e entradas de estacionamento. **Não há restrição por país**, então os buracos medidos aqui aparecem como quests no Brasil.
  - Aceita `maxheight=default` / `below_default` / `no_indications` como resposta "sem placa".
- `valhalla/graph.lua`:
  - `kv["maxheight"] = normalize_measurement(maxheight) or normalize_measurement(maxheight:physical)`, mais `maxheight:forward/backward`;
  - `nodes_proc` não lê maxheight nem height_restrictor;
  - versão no container: 3.9.1-c803bdc2f.

## Testes que falharam e o motivo
- Mapillary Graph API e tiles sem token: 500 / 403. Exige token.
- KartaView `/2.0/photo` deu 400 (timeout de consulta); `/2.0/detection` deu 404.
- Panoramax `semantics.osm|traffic_sign='BR:R-15'` global deu 502.
- Overpass, contagem de `way[highway][maxheight]` no Brasil: 504 (overpass-api.de), 500 (kumi.systems, private.coffee).
- `dados.gov.br` CKAN: respostas vazias (0 bytes) na sessão anterior (`ckan/dados.gov.br_*.json`). Hoje a API exige chave.
- CKAN da PMSP: `package_search` não funciona (sempre o mesmo pacote) e o WAF devolve HTML de forma intermitente.
- PDF da Res. 973/2022 no gov.br: 404. MBST no gov.br/dnit: 403 no HEAD (o arquivo local veio da sessão anterior; a URL de origem não foi confirmada).

## Recomendações de integração (resumo)
1. Tabela `height_point` (PostGIS):
   - colunas: id, geom, fonte (osm|der_placa|antt_detector|artesp_passarela|dnit_aet|lidar|mapillary|reporte), tipo, valor_m (nullable), valor_tipo (placa|físico|estimado), confiança, licença, atualizado_em;
   - **base separada do OSM** quando a fonte não for ODbL.
2. Na rota:
   - (a) maxheight do OSM já bloqueia no Valhalla;
   - (b) **nós** com maxheight e height_restrictor → converter em `exclude_locations` ou exclude polygons pequenos por perfil;
   - (c) placa R-15/A-37 do DER sem valor, detector ANTT, suspeito LiDAR ou viaduto sem maxheight → aviso "restrição de altura possível, confirme a placa" quando o veículo tiver ≥4,0 m, sem bloquear.
3. Coleta:
   - reporte `low_clearance` com foto e valor da placa;
   - fila priorizada = suspeitos LiDAR + R-15 do DER + viadutos sem maxheight em via principal.
   - Opcional: corrigir o OSM via StreetComplete/MapRoulette, já que a seção 13 do Mapillary permite usar as imagens para editar o OSM.
4. DNIT SIAET por segmento nas BRs: importar como atributo, para checagem e para AET.

## Comandos principais
```
# OSM Sudeste (contagens)
docker run --rm -v .../data/valhalla:/pbf:ro debian:bookworm-slim bash -c "$(cat osm/sudeste_counts.sh)"
# OSM maxheight Sudeste -> geojsonseq
osmium tags-filter sudeste.pbf w/maxheight w/maxheight:physical n/maxheight n/barrier=height_restrictor | osmium export -f geojsonseq
# Mapillary (precisa de token)
curl "https://graph.mapillary.com/map_features?access_token=MLY|...&fields=id,object_value,geometry,first_seen_at,last_seen_at&bbox=<0,01 grau²>&object_values=regulatory--height-limit--g1,warning--height-restriction--*"
# Panoramax
curl -G https://api.panoramax.xyz/api/search --data-urlencode bbox=-47.21,-24.07,-45.69,-23.18 --data-urlencode limit=1000
# LiDAR PMSP (PDAL)
{"type":"readers.ept","filename":"https://ept-m3dc-pmsp.s3.sa-east-1.amazonaws.com/ept.json","bounds":"([x-30,x+30],[y-30,y+30])"} -> writers.text
# Valhalla: teste de maxheight
POST localhost:8002/route com costing truck height 3.5 vs 4.4 (valhalla/req_guarulhos_*.json)
```

## Inventário de arquivos desta pasta
- `osm/`: extração da Grande SP (`gsp_ways.geojsonseq`, 268 MB), `analyze.py` e saída, sinais (`ts.geojsonseq`), contagens da Sudeste, `sudeste_maxheight.geojsonseq`, `br_count.json` (Overpass que falhou).
- `geosampa/`: script e resultado do cruzamento `obra_arte` × OSM.
- `lidar/`: pilotos, amostra (`sample/`, 176 MB de CSV de pontos) e `clearance_sample_result.csv`.
- `mapillary/`: respostas sem token. `mapillary_terms.*`, `mapillary_sign_classes.txt`, `sprite_tree.json` estão na raiz.
- `kartaview/`, `panoramax/`: respostas das APIs.
- `dersp/`: XLSX de sinalização e OAE, `sv_rows.json`, CSV das placas de restrição.
- `antt/`: pontes, dicionário, detectores de altura.
- `artesp/`: passarelas e comparação com o OSM; metadados CKAN.
- `cet/`: SDAAE.pdf e MSU vol. 03.
- `normas/`: CONTRAN 882 (legisweb/udop/estradafacil).
- `ckan/`: buscas CKAN da sessão anterior.
- `overture/`: consultas DuckDB.
- `streetcomplete/`, `valhalla/`: código-fonte de referência e testes de rota.
- Raiz: polígonos RMSP/capital (`rmsp_capital.json`, `rms.json`, `sp_mun.geojson`), `candidatos_altura_sem_valor.geojson`.
