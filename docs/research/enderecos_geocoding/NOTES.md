# Endereços e geocodificação no Brasil (tema: enderecos_geocoding)

Data da pesquisa: 09/10/2026. Pasta: este diretório.
Observação sobre a "tentativa anterior": a pasta `enderecos_geocoding/` NÃO existia quando comecei,
e `research_done.json` não tinha entrada deste tema. Comecei do zero.
O orçamento de WebSearch da sessão acabou no fim (200/200). Por isso alguns itens ficaram sem busca extra (ver Lacunas).

Download total: cerca de 310 MB, a maior parte do CNEFE da capital (186 MB). Overture e OpenAddresses foram lidos remotamente, só em parte.

## Situação atual do app (só leitura)
- `api/src/services/geocoder.ts` usa o Photon público (`photon.komoot.io`), escolhido via `GEOCODER_PROVIDER=photon` e `PHOTON_URL`.
- Envia lat/lon como viés quando há posição. Não envia bbox e não valida o município do resultado.

---------------------------------------------------------------------------------------------------
## 1. IBGE CNEFE 2022 (Cadastro Nacional de Endereços para Fins Estatísticos), a fonte principal
FTP: https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/Censo_Demografico_2022/
Subpastas testadas (listagem HTTP 200):
- `Arquivos_CNEFE/CSV/UF/` traz o CSV por UF. SP = 1,0 GB zip (35_SP.zip). Só registrei o tamanho.
- `Arquivos_CNEFE/CSV/Municipio/35_SP/` tem 645 arquivos. São Paulo (3550308_SAO_PAULO.zip) = 177 MB zip, 945 MB csv. **Baixado.**
- `Arquivos_CNEFE/GeoJSON/UF_20240910/` e `Municipio_20240910/` trazem GeoJSON (SP UF = 1,1 GB).
- `Coordenadas_enderecos/UF|Municipio/` traz só COD_UF, COD_MUN, COD_ESPECIE, LAT, LON e NV_GEO_COORD. SP UF = 114 MB. Baixei os 39 municípios da RMSP (cerca de 44 MB).
- `Agregados_por_CEP/` (8,6 MB) tem totais por CEP (TOT_END, TOT_DP, tipos etc.). **NÃO tem coordenadas.**
- `Trajetos_dos_Recenseadores/` tem o trajeto dos recenseadores por UF (SP 51 MB). Não usei.
- Dicionários (.xls) baixados em `cnefe/`. Campos-chave: COD_UNICO_ENDERECO, COD_MUNICIPIO, COD_SETOR, NUM_QUADRA, NUM_FACE,
  CEP, DSC_LOCALIDADE (bairro), NOM_TIPO_SEGLOGR, NOM_TITULO_SEGLOGR, NOM_SEGLOGR, NUM_ENDERECO, DSC_MODIFICADOR (SN, KM, A...),
  complementos 1–5, LATITUDE, LONGITUDE, NV_GEO_COORD (1=coord. original, 2=modificada para aptos, 3=estimada, 4=face, 5=localidade, 6=setor),
  COD_ESPECIE (1 domicílio, 6 estab. outras finalidades...) e DSC_ESTABELECIMENTO (nome do estabelecimento).
- Formato: CSV separado por `;`, codificação latin-1. Cada linha é uma ESPÉCIE no endereço (um prédio de apartamentos gera várias linhas).

Contagens que medi (scripts `cnefe/stats_cnefe.py`, `cnefe/stats_rmsp_coord.txt`):
- Brasil (soma de TOT_END em Agregados_por_CEP): **106.814.877 endereços em 931.499 CEPs**. Estab. de outras finalidades: 11.706.713.
- Capital SP: **5.689.391 registros**. São **2.528.403 endereços únicos** (logradouro+número+modificador), 51.366 logradouros e 46.907 CEPs.
  - NV_GEO_COORD por registro: 1 = 4.619.360; 2 = 900.712; 3 = 119.852; 4 = 48.656; 5 = 17; 6 = 794.
  - Por endereço único: 97,9 % têm nv1 (coordenada original de campo).
  - Estab. de outras finalidades (espécie 6): 570.229. Registros sem número ou "SN": 129.721 (2,3 %).
- RMSP (39 municípios, códigos da API de localidades do IBGE): **10.043.684 registros**. 84,0 % nv1 e 99,2 % no nível de endereço (nv 1–3).
  996.620 estab. de outras finalidades. Guarulhos 596.864, S. Bernardo 374.870, Santo André 369.250, Osasco 328.129, Barueri 141.804.
- Divulgação (apresentação oficial do IBGE, PDF `ibge_release_cnefe.pdf`, baixado de agenciadenoticias.ibge.gov.br):
  106 milhões de endereços e 111 milhões de espécies. 24,3 milhões sem número. Coordenadas divulgadas em 02/02/2024.
  Agregado por CEP com 931.499 CEPs. O próprio IBGE cita "roteamento" entre os usos do CNEFE pela sociedade.
- Exemplos úteis: "CEAGESP | Av Dr Gastão Vidigal 0 SN | CEP 05314001 | -23.534068,-46.734750".
  "SANTOS BRASIL TECON | Av Santos Dumont 0 SN, Guarujá". "GLP CAJAMAR 2 | Av Dr Antonio João Abdalla 3333".
  Em rodovias o km vem no número com modificador KM ("ANHANGUERA num=30 mod=KM | NATURA/SKF").
  Na Dutra (Guarulhos) a maioria dos registros é SN.
- Licença: o site do IBGE responde 403 a bots (curl e WebFetch). A declaração do IBGE citada na lista imports@OSM (2013) diz que o conteúdo é de domínio público, com citação obrigatória da fonte.
  Bases cartográficas (BC100/BC250) têm termo próprio que proíbe comercializar o produto. Para o CNEFE vale a regra geral (citar "IBGE, CNEFE 2022").
  OpenAddresses registra a licença como "attribution: IBGE". A página de atribuição do Overture diz CC0, "distribuído por AddressForAll".
  Uso comercial: não achei proibição. Recomendo citar a fonte sempre.
- Privacidade: DSC_ESTABELECIMENTO traz nomes de comércios. Não há nomes de pessoas. Mesmo assim, não exibir complemento de domicílio.

## 2. geocodebr (IPEA) + padronizacao_cnefe (CNEFE já padronizado)
- CRAN: geocodebr 0.7.0 (publicado em 23/09/2026), licença MIT. Funções: geocode(), geocode_reverso(), busca_por_cep().
- O pacote baixa os dados de https://github.com/ipea/padronizacao_cnefe/releases/download/v0.5.0/<arquivo>.parquet. Release v0.5.0 de 15/09/2026, 13 parquets, **2,09 GB no total**.
  Tamanhos: municipio_cep 11 MB; municipio_logradouro_cep 71 MB; municipio_logradouro_numero_cep_localidade 461 MB etc.
  O repositório não declara licença (a API do GitHub retorna license=None). Os dados derivam do CNEFE.
- **Baixado `municipio_cep.parquet`**: 928.905 CEPs com lat/lon média, n_casos e desvio_metros.
  Na faixa 01000–09999 (capital e RMSP): 95.044 CEPs, desvio mediano de 98,5 m e p90 de 394 m. No Brasil: mediana de 112 m e p90 de 556 m.
  CEPs "-9xx" de grandes usuários (05316-900 CEAGESP, 11015-900 APS) NÃO estão. CEP geral de cidade (07750-020 Cajamar) tem 4.725 casos e desvio de 5,9 km.
- Níveis de precisão do geocodebr (copiar a ideia): numero, numero_aproximado, logradouro, cep, localidade, municipio.
  Os códigos dn01..pm04 indicam match determinístico ou probabilístico e quais campos casaram.

## 3. GeoSampa (Prefeitura de SP) — logradouros com faixa de numeração e lotes do IPTU
WFS: https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs. Licença CC-BY-SA 4.0, confirmada na pesquisa anterior (restricoes_sp_capital).
- `geoportal:segmento_logradouro`: **218.768 segmentos** (totalFeatures do JSON).
  Atenção: `resultType=hits` devolve 10.200, valor errado, porque o GeoServer limita a contagem.
  Campos: codlog, cd_tipo_logradouro (R, AV...), nm_logradouro, cd_numero_inicial/final_par/impar, cd_numero_ordem_segmento, qt_leito_carrocavel. Geometria LineString.
  Serve para **interpolar número**. Exemplo: Costa Aguiar 1612–1752 interpolado para 1686 fica a cerca de 16 m do ponto CNEFE.
- `geoportal:lote_cidadao`: **1.687.982 lotes** com nm_logradouro_completo ("AV DR GASTAO VIDIGAL"), cd_numero_porta, uso, área do terreno e situação. Geometria Polygon.
  Exemplo: lote CEAGESP nº 1946 = 503.425 m². O centroide fica a 363 m da portaria registrada no CNEFE.
  Em lote grande, o centroide não serve como destino.
- `geoportal:edificacao`: 2.817.745 edificações com altura (qt_altura_edificacao), escala 1:5000.
- Teste com 20 endereços aleatórios do CNEFE na capital (`teste_geocoders/geosampa_geo.py`), com match ingênuo por LIKE no nome:
  - Lote exato: 10/20 encontrados, com mediana de 24,5 m. Dois casos casaram rua homônima a 9,9 km e 26 km. Falta desambiguar por bairro/CEP.
  - Interpolação por segmento: 17/20, mediana de 32 m. Um homônimo deu 6 km.
  - A diferença de cerca de 20 m entre lote e CNEFE confirma, de forma independente, que as coordenadas do CNEFE batem com o cadastro municipal.
- Os demais municípios da RMSP NÃO estão no GeoSampa. Não achei WFS equivalente (WebSearch esgotado).

## 4. OpenStreetMap (PBF local sudeste-latest, replicação de 2026-10-08), recorte RMSP (polígono IBGE dos 39 municípios)
Comandos em `osm/` (osmium via debian:bookworm-slim). O volume do docker não monta /private/tmp, então passei o polígono por stdin.
- addr:housenumber: 121.745 nodes + 35.992 ways + 1.049 rels, cerca de **158.786 objetos**. O CNEFE tem cerca de 2,5 milhões de endereços únicos só na capital, então o OSM cobre poucos por cento.
- addr:postcode 137.424 objetos. addr:interpolation 4.153 ways. highway 358.674 ways, 200.434 com nome. postal_code em highway: 11.751.
- building 2.209.862 ways. barrier=gate 15.311 nós. entrance 5.397. amenity=loading_dock 0. building=warehouse/industrial cerca de 3.011.
  landuse=depot/logistics 62. industrial=warehouse/logistics 67.
- Licença ODbL. A diretriz de geocodificação da OSMF diz que resultados individuais são "insubstantial extracts".
  Podem ser guardados junto com dados próprios sem share-alike, desde que não se recrie parte substancial do OSM. O geocoder precisa atribuir o OSM.

## 5. Overture Maps — tema addresses
- STAC: https://stac.overturemaps.org/catalog.json. Release mais nova: 2026-09-23.1. Tema addresses: 474.186.531 linhas e 64 arquivos.
- Doc (https://docs.overturemaps.org/guides/addresses/): **BR = 89.887.635 endereços**. Atribuição: "IBGE ... CC0. Distributed by AddressForAll. Accessed 2024-10-13".
- Teste com DuckDB 1.4.5 + httpfs (`overture/q_overture.py`). Dois parquets cobrem a RMSP (395 MB e 369 MB). Só li o necessário.
  - bbox RMSP (-47.21,-24.07,-45.69,-23.18): **7.848.066 endereços**.
  - Amostra em volta da CEAGESP: 5.864 endereços, 5.612 com número e 100 % com CEP.
  - **Inconsistência:** o campo `sources` dos registros traz dataset "br/sp/statewide" e provider open_addresses, com **license = "LicenseRef-Proprietary"**.
    A página de atribuição diz CC0. Antes de usar o Overture, preferir o CNEFE direto do IBGE.
- Places (POI) do Overture podem complementar com nomes de CDs (licenças CDLA/Apache/CC0). Não testei.

## 6. OpenAddresses — br/sp/statewide
- Fonte: https://raw.githubusercontent.com/openaddresses/openaddresses/master/sources/br/sp/statewide.json. É o CNEFE processado pela AddressForAll.
  Licença "attribution: IBGE". Atualizado em 28/07/2026 ("Update Brazil regional data").
- Batch: https://batch.openaddresses.io/api/job/927883 (2026-10-02). **17.434.203 registros** (15.737.603 válidos; 1.696.600 falharam em "number"). Saída de 894,9 MB.
  - A API `batch.openaddresses.io/api/job/<id>/output/...` exige login (HTTP 403).
  - `https://v2.openaddresses.io/batch-prod/job/927883/source.geojson.gz` redireciona (302) para R2 assinado. Fiz range de 2 MB (HTTP 206) e salvei amostra em `openaddresses/`.
- Para nós é redundante com o CNEFE. Vale só se quisermos um GeoJSON já normalizado.

## 7. Photon público (photon.komoot.io), usado hoje no app
Termos (README do GitHub): "Extensive usage will be throttled or completely banned", sem garantia de disponibilidade. Software Apache-2.0, dados OSM (ODbL).
O Photon NÃO interpola número: devolve o centroide da rua quando não existe nó com addr:housenumber.
O endpoint `/structured` existe, mas sem bbox devolveu "Rua Santos Dumont" em São Leopoldo-RS para city=Santos.
Teste A, 10 endereços logísticos com verdade CNEFE (`teste_geocoders/casos.json`):
- Photon sem viés: mediana de 647 m, 0 dentro de 100 m, 4 acima de 1 km. Só 3 vieram com número.
- Photon com viés lat/lon de SP: mediana de 565 m. "Rua Joaquim Távora, 500, Santos" foi parar na **Vila Mariana (SP), a 50 km**, porque o viés venceu a cidade escrita.
- Nominatim: mediana de 780 m, 2 dentro de 100 m, 4 acima de 1 km.
- Endereços s/n de porto (Av. Santos Dumont, Guarujá; Rod. Cônego Domênico Rangoni) ficaram a 0,7–4 km do terminal.
- CEP puro: o Photon acha `place=postcode` do OSM (04204-001 em vez de 04204-002) a 0,6–1,7 km. O Nominatim não achou 2 de 3.
Teste B, 30 endereços aleatórios de estabelecimentos do CNEFE (RMSP + Baixada) (`casos_aleatorios.json`):
- Photon: mediana de 124 m, 13/30 dentro de 100 m, 22/30 dentro de 250 m, 6 acima de 1 km e **3 acima de 10 km**.
  "Rua Santos Dumont, 81, Santos" caiu em Mallet-PR, a 503 km. Um caso veio sem resultado.
- Nominatim: mediana de 85 m, 15/30 dentro de 100 m, 5 acima de 1 km e 2 acima de 10 km
  (Rua Indiana caiu em Presidente Prudente, 510 km; Rua Águia Real em São Roque, 66 km). Dois casos vieram sem resultado.
- Conclusão: OSM/Photon serve para POI e autocomplete, mas **não serve como fonte única de endereço com número no Brasil**.
  Também é obrigatório filtrar ou validar pelo município pedido (bbox e checagem de city).

## 8. Nominatim público
Política (https://operations.osmfoundation.org/policies/nominatim/): no máximo 1 req/s, User-Agent identificado e cache obrigatório.
**Autocomplete proibido**. Bulk desencorajado (4 req/min em jobs longos). Revenda de resultados proibida.
Usar no máximo para teste. Em produção, só auto-hospedado.

## 9. APIs de CEP
Testadas com 05316-900 (CEAGESP), 04204-002, 06460-120, 11015-900 (APS) e 01310-100. Respostas salvas em `teste_geocoders/cep_apis/`.
- **ViaCEP** (https://viacep.com.br/ws/{cep}/json/): HTTP 200 em todos. Devolve logradouro, complemento (faixa de números), unidade (nome do grande usuário), bairro, IBGE, DDD e SIAFI.
  **Não devolve coordenadas.** O site avisa que uso massivo pode bloquear o acesso. É gratuito e sem SLA.
  Tem busca reversa /ws/UF/cidade/logradouro/json/ (até 50 resultados).
- **BrasilAPI** v1/v2 (https://brasilapi.com.br/api/cep/v2/{cep}): HTTP 200, service=open-cep.
  Pelo código-fonte (MIT), a coordenada da v2 vem do **Photon**, com fallback para a geocodificação do Open-Meteo, que devolve o centro da cidade.
  Nos testes deu o centro de SP ou de Barueri: erros de 5,5 km, 7,0 km e 10,2 km. **Não usar as coordenadas da BrasilAPI.**
- **AwesomeAPI CEP** (https://cep.awesomeapi.com.br/json/{cep}): devolve lat/lng. CEAGESP a 48 m, Costa Aguiar a 302 m, Av. Ceci a 1,3 km.
  A doc não informa a fonte da coordenada, limites nem licença. Não usar comercialmente sem contrato.
- **OpenCEP** (https://opencep.com/v1/{cep}): HTTP 200, sem coordenadas. O site diz ter 1.192.347 CEPs "dos Correios e IBGE" e oferece download.
  Proveniência jurídica duvidosa, porque o DNE é proprietário.
- **apicep** (cdn.apicep.com): o 1º pedido deu 200; os seguintes deram **429 "Blocked by flood cdn"**.
- **Postmon** (api.postmon.com.br): falha de conexão (código 000).
- **Correios e-DNE** (https://www.correios.com.br/comprar/loja-online/dne): Básico R$ 2.950,00 e Master R$ 6.950,00.
  Renovação anual de R$ 2.270,00 a R$ 5.970,00. Atualização quinzenal. Inclui CEPs de grandes usuários e faixas.
  **Sem coordenadas.** Uso protegido (Leis 9.610/98, 9.279/96 etc.). É a fonte oficial de CEP com licença comercial.

## 10. IBGE Faces de logradouros 2022
https://geoftp.ibge.gov.br/recortes_para_fins_estatisticos/malha_de_setores_censitarios/censo_2022/base_de_faces_de_logradouros_versao_2022_censo_demografico/
- shp/SP = 377 MB e json/SP = 311 MB. Só registrei o tamanho; li o diretório do zip remoto por range (`faces/remote_zip.py`, 56 KB lidos).
  RMSP: 39 arquivos JSON somam 426 MB descompactados. Capital: 172,9 MB (17,2 MB comprimido).
- Campos: CD_SETOR, CD_QUADRA, CD_FACE, NM_TIP_LOG, NM_TIT_LOG, NM_LOG, TOT_RES, TOT_GERAL. Geometria LineString.
  **Sem faixa de numeração e sem CEP.** Liga-se ao CNEFE por setor+quadra+face.
- Amostra baixada: Cajamar (4.882 faces, 1.339 sem nome de logradouro) e AC.
- Uso: fallback de logradouro e face quando o número não existe no CNEFE.

## 11. Receita Federal — CNPJ dados abertos (endereços de empresas, sem coordenadas)
- `https://dadosabertos.rfb.gov.br/CNPJ/dados_abertos_cnpj/`: falha de conexão (o DNS resolve, mas o HTTP dá código 000).
- `https://arquivos.receitafederal.gov.br/index.php/s/YggdBLfdninEJX9` (share Nextcloud do domínio da Receita): HTTP 200.
  O WebDAV público (`/public.php/webdav/`, PROPFIND) lista pastas de 2023-05 a 2026-09.
  Atenção: tirei esse token da memória e não achei a página oficial que o publica.
  A página gov.br de "dados públicos CNPJ" pediu autenticação e o dados.gov.br é app JS (API dá 401).
- 2026-09: Estabelecimentos0–9.zip somam cerca de 5,38 GB; Empresas cerca de 1,4 GB. Só registrei os tamanhos.
- Uso: buscar empresa/CD por nome fantasia ou CNPJ → endereço + CEP + CNAE (ex.: armazenagem, transporte de carga) → geocodificar no CNEFE.
  LGPD: MEI expõe nome de pessoa física. Filtrar.

## 12. Auto-hospedagem
- Photon BR (GraphHopper): https://download1.graphhopper.com/public/south-america/brazil/photon-dump-brazil-1.0-latest.jsonl.zst = 706.081.277 bytes (2026-10-05).
  Também há photon-db-br-250720.tar.bz2 (2 GB, jul/2025) em /public/extracts/by-country-code/br/.
- Geofabrik: brazil-latest.osm.pbf = 2.092.268.525 bytes (08/10/2026). sudeste-latest = 860.862.119 bytes.
- Nominatim e Pelias: não testei instalação.

## 13. Comerciais (não testados: exigem conta ou chave, e criar conta é proibido para mim)
- Google Geocoding (Service Specific Terms, lidos via curl): 6.2 "must not use ... Geocoding API in conjunction with a non-Google map".
  6.3.1 permite cache de lat/lng por no máximo 30 dias. **Incompatível com o front MapLibre/OpenFreeMap.**
- Mapbox Geocoding v6: resultados "temporary" não podem ser cacheados. "permanent=true" exige cartão ou contrato.
- HERE, TomTom, LocationIQ, Geoapify, OpenCage, CEP Aberto: não verifiquei preço nem termos nesta rodada.

## 14. Outras fontes úteis encontradas
- Receita Federal, lista de recintos alfandegados marítimos (PDF, `teste_geocoders/recintos_cod13_maritima.pdf`): endereços de terminais do Porto de Santos e outros.
  A maioria é "s/n", e é por isso que o portão de terminal precisa de cadastro próprio.
- IBGE API de localidades: https://servicodados.ibge.gov.br/api/v1/localidades/estados/35/regioes-metropolitanas (RMSP id 04901, 39 municípios).
  Malha: https://servicodados.ibge.gov.br/api/v3/malhas/estados/35?intrarregiao=municipio&qualidade=intermediaria&formato=application/vnd.geo%2Bjson (1 MB).

## Como integrar no app (proposta)
1. Tabela `addr_point` no Postgres/PostGIS, carregada do CNEFE.
   Pode vir do CSV do IBGE ou dos parquets do padronizacao_cnefe, que já vêm normalizados (sem acento, tipo e título separados).
   Colunas: cod_mun, logradouro_norm, tipo, titulo, numero, modificador, cep, bairro, especie, estab_nome, nv_geo, geom.
   Índices: pg_trgm + unaccent no logradouro e (cod_mun, logradouro_norm, numero).
   Começar pela RMSP + Baixada Santista (cerca de 10 milhões de registros) e depois expandir por UF.
2. Tabela `cep_centroid`: importar `municipio_cep.parquet` (928.905 CEPs, com desvio_metros) ou calcular a mediana do CNEFE.
   Para CEP "-9xx" ou ausente, consultar ViaCEP (com cache) só para obter logradouro + nº e geocodificar no `addr_point`.
3. Cascata de precisão no endpoint `/api/geocode`:
   número exato → número aproximado (interpolar entre vizinhos do CNEFE, ou pelo GeoSampa na capital) → logradouro+bairro → CEP → bairro → município.
   Devolver `precisao` e `desvio_m` ao front, para avisar quando a precisão for baixa.
4. Photon fica só para POI e autocomplete, de preferência auto-hospedado (dump BR de 706 MB).
   Sempre com `bbox` da UF/RMSP e com validação de que city/município bate com o pedido. Nunca viés lat/lon sozinho.
5. Nova tabela `site_access` (portarias e acessos de caminhão) para grandes áreas: CEAGESP, terminais do porto, CDs.
   Semear com estabelecimentos do CNEFE (DSC_ESTABELECIMENTO), OSM barrier=gate (15.311 na RMSP) e um novo tipo de reporte colaborativo "acesso de caminhão".
   A rota deve terminar na portaria, não no centroide do lote.
6. Endereços "Rodovia X, km N": o CNEFE grava num=N com mod=KM. Precisa da base de marcos quilométricos (DER/DNIT), que é outro tema.
7. Licenças:
   - CNEFE: domínio público com citação "IBGE – CNEFE 2022".
   - GeoSampa: CC-BY-SA 4.0, em tabela separada.
   - OSM/Photon: ODbL, com atribuição.
   - Correios DNE: proprietário, só com licença.
   - Google: proibido usar com mapa não-Google.
   - AwesomeAPI e OpenCEP: proveniência incerta.
