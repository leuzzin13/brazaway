# Pontes e viadutos estaduais (SP) e municipais (SP capital e RMSP) — notas de pesquisa (09/10/2026)

Pasta: amostras, scripts e textos extraídos. Tudo testado com curl/python3 nesta data.
`pip.py` = point-in-polygon com malha IBGE (39 municípios da RMSP, API IBGE `regioes-metropolitanas`, id 04901).
`osm_match.py` = casa inventários oficiais com pontes OSM (extraídas do sudeste-latest.osm.pbf local, osmium em docker).

## Conclusão curta
- **Localização** de OAE: há fonte oficial boa (GeoSampa `obra_arte`, DER-SP OAE, SIURB). OSM já cobre ~89% dos viadutos da capital.
- **Gabarito (altura livre) e limite de peso**: NENHUMA fonte oficial aberta traz isso para pontes/viadutos municipais ou do DER.
  Única exceção: ARTESP passarelas (campo ALTURA, 409 de 444 preenchidos; nenhum dicionário de dados confirma que é a altura livre).
- **Estado/condição**: inventário e notas de inspeção da SIURB NÃO são públicos (laudos ficaram sob sigilo em 2019). Interdições são
  comunicadas por notícia/portaria, não por dado estruturado.
- Para o app, o valor está em: (1) camada de "OAE conhecida" para pedir confirmação/reporte, (2) importar restrições pontuais curadas
  (portarias SMT, notícias), (3) pedir via LAI os inventários com classe/trem-tipo e gabarito.

## Fontes testadas

### 1. GeoSampa — camada `geoportal:obra_arte` (Prefeitura SP / PRODAM, MDC)
- WFS: https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs ; `typeNames=geoportal:obra_arte&outputFormat=application/json&srsName=EPSG:4326`
- HTTP 200, 3,8 MB, **6.548 LineStrings** (bordas da obra, restituição fotogramétrica). Tipos: PONTE 4.416, VIADUTO 1.129, PASSARELA 821, TUNEL 114, CALCADAO 68.
- Campos: cd_identificador_obra_arte, tx_tipo_obra_arte, tx_escala (1:1.000 em 96%), tx_ano_referencia (2004 em 91%; 2017/2010/2020/2021 no resto), sg_fonte_original=GEOINFO.
  **Sem nome, sem gabarito, sem peso, sem estado.**
- Agrupando linhas a ≤30 m: ~2.146 pontes, ~300 conjuntos de viaduto, ~289 passarelas, ~50 túneis (estimativa de estruturas).
- Mediana de comprimento da linha: PONTE 6,7 m (muitas travessias de córrego/pontilhões), VIADUTO 79,6 m.
- Cobertura OSM (linha → ponte OSM highway ≤50 m): VIADUTO 1.009/1.129 (89%), PASSARELA 667/821 (81%), PONTE 1.698/4.416 (38%), TUNEL 24/114 (21% — OSM marca como tunnel, não bridge, esperado).
- WMS funciona em `https://wms.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wms` (no host wfs.* o WMS está desabilitado). Amostra: geosampa_obra_arte_wms.png.
- Licença: capabilities "Fees NONE / AccessConstraints NONE". Prefeitura (SMDU, 2015, lista talk-br do OSM) disse que dados do portal são públicos e crédito é "desejável". Não há licença formal por camada no WFS → tratar como dado público com atribuição "Prefeitura de São Paulo / GeoSampa"; confirmar uso comercial por escrito se for redistribuir.

### 2. GeoSampa — `geoportal:sac_vistoria_reparo_ponte_viaduto` (SP156)
- 115 pontos, todos de 06/04/2020 a 29/09/2020, situação FINALIZADA, carga única em 25/03/2021. Campos: logradouro, datas, órgão (SMSO). Baixo valor (série parada).

### 3. Dados Abertos PMSP — "controle de obras SIURB" (CKAN dados.prefeitura.sp.gov.br)
- XLSX: https://dados.prefeitura.sp.gov.br/dataset/49a40a52-68c0-45c1-92d8-ccc35a525467/resource/5596c5a0-4c33-4859-b522-a228b4ccbdc8/download/completo-obras-controle-de-obras.xlsx
- Licença: "Licença de Atribuição do Open Data Commons" (ODC-By). Atualizado 2025-11 (metadados 2026-07).
- Aba `servicos`: 114 serviços, **105 OAEs nomeadas com lat/lon** (inspeções/recuperação 2020-2021, contratos 861-919). Extraído em siurb_servicos_oae.csv/.geojson.
  104 das 105 têm ponte OSM a ≤100 m; nenhuma dessas pontes OSM tem maxweight.
- Aba `obras` (355) e `liquidados` (37): obras de recuperação das pontes das marginais (Casa Verde, Freguesia do Ó, Bandeiras, Cruzeiro do Sul, Tatuapé, Vila Maria, Pres. Dutra, Cidade Jardim, Eusébio Matoso, Cid. Universitária, Jaguaré etc.).
- Observação: o portal reseta conexão com User-Agent "Mozilla/5.0"; funcionou com `-A "truck-router-mvp/0.1"`. Busca CKAN por "ponte" deu 502 algumas vezes (instável).
- Catálogo Municipal de Bases (CMBD) 2026: download do CSV/XLSX falhou (connection reset) — não deu para checar se existe base "cadastro de OAE".

### 4. DER-SP — "Obras de Arte Especiais (OAE)" (Dados Abertos SP + ArcGIS do DER)
- CKAN: https://dadosabertos.sp.gov.br/dataset/obras-de-arte-especiais-oae — licença **CC-BY-4.0** (uso comercial permitido com atribuição).
- XLSX: https://dersp.der.sp.gov.br/WebSite/Arquivos/DadosAbertos/AtivosRodoviarios/OAE/Obra%20de%20Arte%20Especial%20(OAE).xlsx (155 KB, aba "SIGOA", recurso de 2025-04-15).
- FeatureServer (mesmos dados, consulta espacial e GeoJSON): https://mapas.der.sp.gov.br/server/rest/services/Hosted/OAE_DBO/FeatureServer/0 (count=1873, maxRecordCount 2000).
  Ex.: `/query?where=1=1&geometry=-47.21,-24.07,-45.69,-23.18&geometryType=esriGeometryEnvelope&inSR=4326&outFields=*&outSR=4326&f=geojson` → 144 no bbox.
- **1.873 OAEs** (SP inteiro, só malha administrada pelo DER): PONTE 848, PASSAGEM DE GADO 336, VIADUTO 265, PASSARELA 80, VIADUTO-PASSAGEM INFERIOR 80, VIADUTO-PASSAGEM SUPERIOR 79, VIADUTO FERROVIÁRIO 48, PONTE DE MADEIRA 27, GALERIA 20 etc. (tipos com grafia livre — normalizar).
- Campos: Rodovia, Km, Divisão Regional, Especificação, Latitude, Longitude, Comprimento, Largura, Área. **Sem gabarito, sem classe/trem-tipo, sem estado.**
- 3 registros com coordenada inválida/DMS (SP-253 km 149, SP-351 km 28,150).
- **Na RMSP: só 59** (Ribeirão Pires 12, Mogi 7, ...; SP-031 9). As grandes rodovias da RMSP são concedidas (ARTESP) e não entram aqui.
  38/59 têm ponte OSM ≤100 m.
- Licença do item no portal ArcGIS: citar "DER-SP" como fonte; dados informativos, não substituem levantamento.

### 5. DER-SP — Sinalização Vertical (placas de restrição)
- FeatureServer: https://mapas.der.sp.gov.br/server/rest/services/Hosted/Sinalizacao_Vertical_DBO/FeatureServer/0 (427.785 placas). XLSX no CKAN `sinalizacao-vertical` (CC-BY-4.0).
- Placas relevantes: R-14 (peso bruto máx.) 211, R-15 (altura máx.) 180, R-18 (comprimento) 58, R-17 (peso por eixo) 9, R-16 (largura) 7. Baixadas em der_placas_R14_R18.geojson (467).
- **Não há campo com o valor do limite** (só código da placa, km, data do levantamento, "atendimento à norma").
- 78 R-14 e 119 R-15 estão a ≤500 m de uma OAE do DER. Na RMSP: 52 placas (R-15 20, R-14 17, R-18 14, R-17 1).

### 6. ARTESP — Dados Abertos (CKAN próprio dadosabertos.artesp.sp.gov.br)
- **Passarelas** (cadastro-de-ativos): https://dadosabertos.artesp.sp.gov.br/dataset/491d79c5-ee09-4fe8-a3ce-1b425fe60bbe/resource/d864ec43-a93b-4803-9b48-1fee98a98fe7/download/passarelas.xlsx (64 KB, 2026-08-05, cc-by).
  444 passarelas em rodovias concedidas; campos RODOVIA, KM, LAT, LONG, STATUS, ESTRUTURA, **ALTURA**, LARGURA, COMPRIMENTO. ALTURA preenchida em 409; min 2,40 (2 registros em Jundiaí, quase certamente erro), demais ≥5,38 m.
  RMSP: 81 passarelas, 71 com ALTURA, **mínimo 5,42 m** (SP-150 km 16,23 S. Bernardo). Sem dicionário de dados confirmando "altura livre".
- **Pontes/viadutos da malha concedida NÃO estão publicados** (nem no CKAN, nem nos KMZ por lote — KMZ Autoban 33 MB de KML só tem eixos, faixa de domínio, equipamentos; 0 placemarks de OAE).
- Malha rodoviária (malha_rodoviaria_sp.xlsx, 14.373 trechos) traz ADMINISTRACAO/CONCESSIONARIA por trecho → serve para saber de quem é cada OAE/rodovia.
- IP.DIN/010 (Instrução de Projeto de OAE, 07/11/2022): "altura livre mínima de 5,5 m" para rodovia estadual (projetos novos/ampliações).
- Programação de obras: só template/schema 2026 (exemplo GeoJSON), sem dados reais ainda.

### 7. Prefeitura de SP — notícias, TCM e SIURB (fatos, sem dado estruturado)
- TCM (workshop "Desafios da manutenção das OAEs", Cons. Domingos Dissei): TAC PMSP×MP-SP de 25/07/2007 (recuperar 50 pontes/viadutos em 10 anos); 571 inspeções rotineiras em 2012 (Fares); concorrências 05 e 07/SMSO/2017 revogadas em 20/10/2018; queda do T5 (Marginal Pinheiros) em 15/11/2018; em 2019 laudos emergenciais de 18 de 33 OAEs, obras emergenciais em Casa Verde, Freguesia do Ó, Jânio Quadros, Pres. Dutra; "107 inspeções especiais em licitação"; NBR 9452/2016 (inspeção especial a cada 5 anos). PDF em tcm_workshop_oae.pdf.
- 13/11/2019: inventário SIURB = 126 locais / 222 unidades estruturais; GMOA criado em dez/2018.
- 30/01/2019: "185 pontes e viadutos sob responsabilidade municipal" (meta 73 laudos).
- SIURB ago/2024 (apresentação SEESP): 770 OAEs monitoradas = 945 estruturas; 430 câmeras em 295 OAEs; MT-InSAR; reforço para TB45; 2.575 inspeções rotineiras; 303 especiais.
- 04/02/2025 (atual. jun/2025): 374 unidades recuperadas; 309 UE com inspeção especial concluída, 62 em andamento; 843 rotineiras feitas, 924 em andamento; ~R$ 2,6 bi desde 2021.
- 07/04/2025: "Central de Gestão e Visão Situacional de OAEs" monitora 945 estruturas 24h — sem painel público/API.
- Sigilo: em 31/01/2019 a gestão Covas impôs termo de confidencialidade nos laudos (IstoÉ Dinheiro, 09/02/2019).
- Restrições pontuais a caminhões já ocorridas (exemplos): Ponte do Jaguaré e Viaduto Miguel Mofarrej (jun/2019, portarias 090 e 091/2019-SMT.GAB); Viaduto Gal. Olímpio da Silveira sentido centro (18/04/2019); Ponte do Limão proibida para pesados após batida de caminhão alto (28/07/2021); Ponte da Freguesia do Ó faixa interditada por peso acima do projeto e Casa Verde por 2 batidas de caminhão em 48 h (22/02/2019); Viaduto Grande SP parcial (09/04/2024).

### 8. Municípios da RMSP
- Santo André (SIGA): WFS https://siga.santoandre.sp.gov.br/geoserver/ows — 177 camadas, **nenhuma de pontes/viadutos** (há radares, semáforos, travessias elevadas). caps salvo.
- Guarulhos (GuaruGeo, i3Geo/MapServer): https://guarugeo.guarulhos.sp.gov.br/ → ms_criamapa.php; `ogc.php` responde HTTP 500; `/geoserver/ows` 404. Não foi possível listar camadas.
- São Bernardo (geo.saobernardo.sp.gov.br): página antiga em frames; /geoserver, /server/rest, /arcgis/rest → 404.
- DataGeo/IDEA-SP (WFS https://datageo.ambiente.sp.gov.br/geoserver/datageo/ows): 913 camadas, nenhuma de OAE/malha viária.

### 9. Falhas/limitações
- DER IP-DE-C00-009_B (norma de inspeção de OAE) http://www.der.sp.gov.br/WebSite/Arquivos/normas/IP-DE-C00-009_B.pdf → redireciona para home do DER (arquivo não existe mais nesse caminho).
- Página DER "Restrições ao Trânsito de Veículos de Carga" (RestricaoCarga.aspx) é formulário ASP.NET (postback) — não submetido; ver tema rodovias_restricoes.
- CMBD 2026 (catálogo de bases da PMSP): connection reset no download.
- Programa de Metas 2025-28: PDFs testados não trazem meta de OAE em texto (PDF da SGM é parcial; o da Rede Nossa SP não citou pontes).

## OSM na RMSP (extração local, bbox -47.21,-24.07,-45.69,-23.18)
- 5.455 ways highway com bridge≠no dentro da RMSP (2.561 na capital); 1.661 são footway.
- Tags em pontes RMSP: maxheight 32, hgv 30, bridge:structure 16, **maxweight 6** (Ponte da Vila Guilherme 60, R. Curuçá 30, R. das Promessas 8, Caminho do Mar 25), maxaxleload 1.

## Integração proposta (resumo)
- Tabela `oae` (PostGIS): id, fonte (geosampa|der|artesp|siurb|osm), fonte_id, tipo normalizado, nome, rodovia/km, geom (ponto e/ou linha),
  comprimento, largura, altura_livre_m, altura_fonte, peso_max_t, peso_fonte, administrador (PMSP/DER/concessionária/ANTT), licenca, atualizado_em.
- Importadores: (a) WFS GeoSampa obra_arte (mensal), (b) FeatureServer DER OAE_DBO (mensal), (c) XLSX ARTESP passarelas (mensal), (d) XLSX SIURB (manual).
- Casar com arestas do Valhalla/OSM por proximidade (≤50 m e mesmo eixo) → flag `oae_sem_limite_conhecido` na rota.
- Restrições confirmadas (portaria/notícia) entram como linhas na base de reportes (mesmo modelo de truck_ban/weight_limit), com fonte e validade.
