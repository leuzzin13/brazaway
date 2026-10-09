# Verificação cética — pontes_sp_estado_municipio (09/10/2026)

Re-testei com curl/python todas as fontes high/medium e as low baratas. Scripts: osm_stats.py, match.py, der_pip.py, der_dms.py.
OSM: extração própria do sudeste-latest.osm.pbf local (timestamp 2026-10-08T20:21Z) com osmium em container (osm/rmsp_bt.geojsonseq).

## Confere
- GeoSampa obra_arte: 200; numberMatched 6548; PONTE 4416 / VIADUTO 1129 / PASSARELA 821 / TUNEL 114 / CALCADAO 68; 2004 = 5973 (91,2%); mediana PONTE 6,7 m.
- Casamento OSM (≤50 m, pontes highway no bbox): VIADUTO 1027/1129 (91,0%), PONTE 1712/4416 (38,8%). Original: 89% / 38%.
- Pontes OSM na RMSP: 5458 (intersects) / 5456 (centroide); capital 2535–2590 conforme método. maxweight 6, maxheight 32, hgv=no 30, maxaxleload 1. Também há 4 com maxweightrating (o original não contou).
- DER OAE XLSX: 200, 155 KB, 1873, CC-BY-4.0 (CKAN), RMSP 59 (malha IBGE), 38/59 com ponte OSM ≤100 m.
- DER OAE_DBO: count 1873, maxRecordCount 2000, lastEditDate 2026-07-30; envelope RMSP 144.
- DER Sinalização Vertical: 427.785; R-14 211, R-15 180, R-18 58, R-17 9, R-16 7, R-18-R-14 2 (+ R-11-R-14 1). 52 na RMSP. Sem campo de valor. Levantamentos 2024 (192), 2025 (219), 2026 (57).
- ARTESP passarelas: 444 (441 ativas), ALTURA>0 em 409 (3 zeros), mínimo 2,40 (2x SP330 km 62 Jundiaí, ALTURA=LARGURA), RMSP 81/71, mín 5,42 SP150 km 16+230. Licença cc-by.
- IP.DIN/010: 'altura livre mínima de 5,5 m na situação mais desfavorável' (fl. 6), rev. 0 de 07/11/22.
- Malha ARTESP: soma EIXO estado DER 9987 / ARTESP 7364 / ANTT 1965; RMSP DER 464 / ARTESP 454 / ANTT 470 (exato).
- Notícias PMSP (Jaguaré/Mofarrej, Limão, Freguesia/Casa Verde, Olímpio) e balanço 2019: conferem.
- TCM: TAC 25/07/2007 (50 OAEs), T5 15/11/2018, NBR 9452/2016 5 anos.
- SEESP (117 MB, baixado e apagado; seesp.txt): 770 OAEs/945 estruturas; 430 câmeras/295 OAEs; MTInSAR; TB45.

## Correções
- DER OAE XLSX: 254 linhas com coordenada em texto, ~144 em DMS/grau-minuto ("21° 27.983'S"); após parse sobra 1 inválida e 5 fora de SP. O FeatureServer tem float em todas -> usar o FeatureServer.
- SIURB: 1 das 105 OAEs (Ponte da Vila Guilherme) tem ways OSM 15963881/15963961 com maxweight=60 a 4–15 m. Datas de início 2019 (17) e 2020 (88), término 2019–2021. Aba obras = 354 linhas. UA Mozilla deu 502 (não reset).
- KMZ L01: 2.954 placemarks (não 838). Nenhuma pasta de OAE; 57 passarelas; tem PGF 49 / PPM 5 (pesagem) e 1 'Área de Descanso'.
- PMSP 2025: '374 UE' = 199 UE concluídas (152 obras) + 175 UE em andamento (126 obras).
- SEESP: 2.575/303/341 são TOTAIS incluindo em andamento (concluídos: 1.651 / 227 / 113).
- CMBD 2026: baixou (200, 466 KB). Declara a base SMUL/GEOINFO 'Obras de Arte' com licença 'CC-BY-AS 4.0' (provável CC BY-SA 4.0), API = WFS GeoSampa, fonte 'Restituição aerofotogramétrica - ortofotos 2005'. SIURB não declara cadastro de OAE (só Controle de Obras, Arquivo de Projeto etc.).

## Achados extras
- PMSP 29/07/2022 'Cidade conta com 36 sinalizadores de altura...' lista nominal dos acessos a OAEs com limitador de altura (CET). pmsp_36sinal.html
- CONTRAN 882/2021 (gov.br) altura máx 4,40 m; art. 64 revoga a Res. 210/2006; vigor 03/01/2022. contran882.pdf
- CET E.T. SDAAE/2019 (cet_sdaae.pdf) ainda cita a Res. 210/2006.
- Notícia Jaguaré cita Decreto 56.920/2016 e Portaria 137/18-SMT.GAB (ZMRC/VER: seg–sex 05–21h, sáb 10–14h).
- ANTT CKAN: nenhuma base de OAE (buscas 'obras de arte', 'ponte OR viaduto OR OAE', 'passarela' = 0). ANTT soma ~470 km na RMSP -> lacuna federal.
