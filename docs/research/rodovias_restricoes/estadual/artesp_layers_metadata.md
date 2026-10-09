# Exported Layers

## marcos_quilometricos (`marcos_quilometricos.gpkg`)
- Original layer: `marcos_quilometricos`
- Features: 8300
- Geometry: Point
- CRS: EPSG:4674
- Fields: CONCESSIONÁRIA, RODOVIA, KM, SENTIDO, LAT, LONG, DESCRIÇÃO, TIPO
- Abstract: Inventário bruto de marcos_quilometricos fornecido pelas concessionárias, mantido em sirgas2000 para rastreabilidade com o cadastro original.

## rodovias_sirgas2000 (`rodovias_sirgas2000.gpkg`)
- Original layer: `rodovias_sirgas2000`
- Features: 572921
- Geometry: LineString
- CRS: EPSG:4674
- Fields: name, alt_name, official_name, highway, ref, lanes, lanes:forward, lanes:backward, maxspeed, maxspeed:hgv, maxspeed:conditional, surface, shoulder, width, smoothness, oneway, oneway:bicycle, bicycle, cycleway, cycleway:right, cycleway:left, cycleway:both, sidewalk, bridge, tunnel, cutting, embankment, layer, level, operator, owner, toll, access, motor_vehicle, hgv, bus, taxi, goods, construction, tracktype, service, source, source:date, opening_date, lit, wikipedia, wikidata
- Abstract: Malha rodoviária estadual em sirgas2000 utilizada como base para ajuste dos marcos_quilometricos e geração das demais projeções.

## rodovias_utm_22s_23s (`rodovias_utm_22s_23s.gpkg`)
- Original layer: `rodovias_utm_22s_23s`
- Features: 572921
- Geometry: LineString
- CRS: EPSG:5880
- Fields: name, alt_name, official_name, highway, ref, lanes, lanes:forward, lanes:backward, maxspeed, maxspeed:hgv, maxspeed:conditional, surface, shoulder, width, smoothness, oneway, oneway:bicycle, bicycle, cycleway, cycleway:right, cycleway:left, cycleway:both, sidewalk, bridge, tunnel, cutting, embankment, layer, level, operator, owner, toll, access, motor_vehicle, hgv, bus, taxi, goods, construction, tracktype, service, source, source:date, opening_date, lit, wikipedia, wikidata, utm_zone
- Abstract: Mesma malha reprojetada para o CRS métrico combinado (EPSG:5880), permitindo medições homogêneas em todo o estado.

## rodovias_utm_22s (`rodovias_utm_22s.gpkg`)
- Original layer: `rodovias_utm_22s`
- Features: 182816
- Geometry: LineString
- CRS: EPSG:31982
- Fields: name, alt_name, official_name, highway, ref, lanes, lanes:forward, lanes:backward, maxspeed, maxspeed:hgv, maxspeed:conditional, surface, shoulder, width, smoothness, oneway, oneway:bicycle, bicycle, cycleway, cycleway:right, cycleway:left, cycleway:both, sidewalk, bridge, tunnel, cutting, embankment, layer, level, operator, owner, toll, access, motor_vehicle, hgv, bus, taxi, goods, construction, tracktype, service, source, source:date, opening_date, lit, wikipedia, wikidata, utm_zone
- Abstract: Recorte da malha cujo centróide fica na zona UTM 22S (EPSG:31982), apropriado para análises locais sem distorção.

## rodovias_utm_23s (`rodovias_utm_23s.gpkg`)
- Original layer: `rodovias_utm_23s`
- Features: 390105
- Geometry: LineString
- CRS: EPSG:31983
- Fields: name, alt_name, official_name, highway, ref, lanes, lanes:forward, lanes:backward, maxspeed, maxspeed:hgv, maxspeed:conditional, surface, shoulder, width, smoothness, oneway, oneway:bicycle, bicycle, cycleway, cycleway:right, cycleway:left, cycleway:both, sidewalk, bridge, tunnel, cutting, embankment, layer, level, operator, owner, toll, access, motor_vehicle, hgv, bus, taxi, goods, construction, tracktype, service, source, source:date, opening_date, lit, wikipedia, wikidata, utm_zone
- Abstract: Recorte da malha cujo centróide fica na zona UTM 23S (EPSG:31983).

## rodovias_sirgas_filtro_ARTESP (`rodovias_sirgas_filtro_ARTESP.gpkg`)
- Original layer: `rodovias_sirgas_filtro_ARTESP`
- Features: 116019
- Geometry: LineString
- CRS: EPSG:4674
- Fields: name, alt_name, official_name, highway, ref, lanes, lanes:forward, lanes:backward, maxspeed, maxspeed:hgv, maxspeed:conditional, surface, shoulder, width, smoothness, oneway, oneway:bicycle, bicycle, cycleway, cycleway:right, cycleway:left, cycleway:both, sidewalk, bridge, tunnel, cutting, embankment, layer, level, operator, owner, toll, access, motor_vehicle, hgv, bus, taxi, goods, construction, tracktype, service, source, source:date, opening_date, lit, wikipedia, wikidata, marcos_quilometricos_count, retencao, utm_zone
- Abstract: Trechos em sirgas2000 que passaram pelo filtro ARTESP, retendo somente segmentos com marcos_quilometricos recalculados ou enquadrados nos critérios normativos (buffers de <=500.0 m e flags de retenção). O resultado é uma malha de menor cardinalidade, mais leve para distribuição e pronta para consumo em fluxos regulamentares.

## rodovias_utm_filtro_ARTESP (`rodovias_utm_filtro_ARTESP.gpkg`)
- Original layer: `rodovias_utm_filtro_ARTESP`
- Features: 116019
- Geometry: LineString
- CRS: EPSG:5880
- Fields: name, alt_name, official_name, highway, ref, lanes, lanes:forward, lanes:backward, maxspeed, maxspeed:hgv, maxspeed:conditional, surface, shoulder, width, smoothness, oneway, oneway:bicycle, bicycle, cycleway, cycleway:right, cycleway:left, cycleway:both, sidewalk, bridge, tunnel, cutting, embankment, layer, level, operator, owner, toll, access, motor_vehicle, hgv, bus, taxi, goods, construction, tracktype, service, source, source:date, opening_date, lit, wikipedia, wikidata, marcos_quilometricos_count, retencao, utm_zone
- Abstract: Versão filtro ARTESP reprojetada para EPSG:5880, preservando o subconjunto depurado com métricas em metros para análises espaciais detalhadas sem penalizar desempenho.

## marcos_quilometricos_ajustados (`marcos_quilometricos_ajustados.gpkg`)
- Original layer: `marcos_quilometricos_ajustados`
- Features: 8299
- Geometry: Point
- CRS: EPSG:4674
- Fields: marker_id, CONCESSIONÁRIA, RODOVIA, KM, SENTIDO, LAT, LONG, DESCRIÇÃO, TIPO, linha_index, deslocamento_m, dist_along_m
- Abstract: marcos_quilometricos reposicionados no segmento mais próximo via STRtree com registro do deslocamento e do índice da linha receptora.

## limites_estado_sp (`limites_estado_sp.gpkg`)
- Original layer: `limites_estado_sp`
- Features: 1
- Geometry: MultiPolygon
- CRS: EPSG:4674
- Fields: NM_ESTADO, NM_REGIAO, CD_GEOCUF
- Abstract: Limite oficial do Estado de São Paulo em sirgas2000, incluído para referência cartográfica e fácil sobreposição com as demais camadas.

## sp_municipios_2024 (`sp_municipios_2024.gpkg`)
- Original layer: `sp_municipios_2024`
- Features: 645
- Geometry: MultiPolygon
- CRS: EPSG:4674
- Fields: CD_MUN, NM_MUN, CD_RGI, NM_RGI, CD_RGINT, NM_RGINT, CD_UF, NM_UF, SIGLA_UF, CD_REGIA, NM_REGIA, SIGLA_RG, CD_CONCU, NM_CONCU, AREA_KM2
- Abstract: Limites municipais de São Paulo (base 2024 em sirgas2000) providos em polígonos, utilizados como camada auxiliar para contextualizar análises e facilitar composições cartográficas.

## der_base_rodovias_sirgas2000 (`der_base_rodovias_sirgas2000.gpkg`)
- Original layer: `der_base_rodovias_sirgas2000`
- Features: 4563
- Geometry: MultiLineString
- CRS: EPSG:4674
- Fields: RODOVIA0, TIPORODO1, ORIENTAC2, ORIGEM3, MUNICIPI4, CODREGIO5, SEDEREGI6, RESIDENC7, SEDERESI8, KMINICIA9, KMFINAL10, EXTENSAO11, DESCRICA12, DESCRICA13, JURISDIC14, ADMINIST15, CONSERVA16, TIPOPIST17, SOBREPOS18, SUBPOSIC19, PERIMETR20, DATAINIC21, DATAFIMC22, ESTADUAL23, DENOMINA24, LEGISLAC25, GID26
- Abstract: Rede oficial do DER em sirgas2000 (GeoPackage der-base-rodovias-sirgas2000.gpkg) incluída como camada de referência, mantendo atributos originais para conferência com as camadas filtradas/ajustadas.
