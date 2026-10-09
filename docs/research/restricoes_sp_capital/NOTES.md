# Restrições de circulação, carga e descarga de caminhões — cidade de São Paulo

Pesquisa feita em 09/10/2026. Tudo abaixo foi testado com curl/python/GDAL/osmium. Pasta: este diretório.
Nada no projeto truck-router foi modificado (só leitura de config/seed para comparar regras).

## 1. Quadro legal vigente (fonte primária)

| Norma | O que define | Onde |
|---|---|---|
| Decreto 56.920/2016 | Conceitos ZMRC, ZERC, VER, AETC, VUC (VUC sem medidas: delega à SMT). Cria Programa de Entrega Noturna. Revogou Dec. 48.338/07 e outros | https://www.saopaulo.sp.leg.br/iah/txt/decretos/D56920.html (legis/D56920.txt) |
| Portaria 137/18-SMT.GAB (vigente desde 03/10/2018) | Horários ZMRC/VER/ZERC, lista das VER (§1º 26 trechos, §2º 4, §3º 9, §4º 40 = 79 trechos), limites da ZMRC (Anexo II, 57 trechos de logradouro), exceções e AETC | https://www.cetsp.com.br/media/722444/p-137_18.pdf ; consolidado: https://legislacao.prefeitura.sp.gov.br/leis/portaria-secretaria-municipal-de-mobilidade-e-transportes-smt-137-de-3-de-agosto-de-2018 |
| Portaria 154/18-SMT.GAB | Transporte de valores liberado período integral na ZMRC e todas VER | https://www.cetsp.com.br/media/836073/port-154-18-valores.pdf |
| Portaria 57/2021-SMT.GAB | VUC: largura máx. passa de 2,20 m para **2,50 m** (comprimento segue 7,20 m; fabricação >= 2005; idade máx. 15 anos) | https://legislacao.prefeitura.sp.gov.br/leis/portaria-secretaria-municipal-de-mobilidade-e-transito-smt-57-de-10-de-dezembro-de-2021 |
| Portaria 49/2021-SMT.GAB (**ainda não em vigor**) | Cria VER §5º: Marginal Tietê (todas as pistas, ambos sentidos) proibida a caminhões, liberada só para carga com origem/destino no município (art. 38-A); revoga incisos I–IV do §4º. Entra em vigor "a partir da conclusão das obras do trecho norte do Rodoanel e sua liberação". Rodoanel Norte trecho 1 abriu em dez/2025; trecho final estava em 68% em 28/06/2026 | https://legislacao.prefeitura.sp.gov.br/leis/portaria-secretaria-municipal-de-mobilidade-e-transito-smt-49-de-8-de-outubro-de-2021 ; https://mobilidadesampa.com.br/2026/06/rodoanel-norte-avanco-trecho-final-2026/ |
| Portaria 024/12-SMT.GAB | Exceções em vias com placa R-9 "EXCETO veículos autorizados 2ª–6ª 5–9h e 17–22h, sáb 10–14h" (VUC liberado integral) | https://ssl.cetsp.com.br/media/119100/portaria02412.pdf |
| Portaria DSV.G 22/92 e 18/96 | Exceções R-9 "exceto veículos autorizados"; guincho | https://www.cetsp.com.br/media/836130/dsvg-22-92.pdf |
| Decreto 58.584/2018 (+58.604/2019) | Rodízio: inclui caminhões; 2ª–6ª 7–10h e 17–20h, por final de placa (1-2 seg ... 9-0 sex); vale dentro do Minianel "inclusive seus limites", mas §2º do art. 2º: **caminhões podem circular nas vias do Minianel**. Isentos: VUC, perecíveis, elétricos/híbridos/hidrogênio, Correios, valores etc. | https://www.cetsp.com.br/media/800356/decreto_58584_18.pdf |
| Lei 12.490/97, Lei 14.751/08 (programa de restrição a caminhões), Lei 16.813/18 (cadastro de isentos) | Base legal do rodízio | links em cet/c_rodizio-municipal__aspx.txt |
| Portaria SMT.GAB 051/2024 (DOC 13/12/2024, republicada 20/12/2024) | Produtos perigosos: proibido 2ª–6ª 7–10h e 17–20h no Minianel (Anexo IV, 13 vias) e na área interna; grupos "consumo local" (Anexo II) e "outros" (Anexo III) liberados período integral na área interna, mas não nas vias do Minianel. Revogou Portaria 100/2016-DSV | https://www.cetsp.com.br/media/1592296/portaria-051-24.pdf |
| Decreto 50.446/2009 | Transporte de produtos perigosos no município exige CTPP + LETPP (CET) e PAE aprovado na SVMA | https://www.cetsp.com.br/consultas/caminhoes/circulacao-de-produtos-perigosos.aspx |
| Portaria SMT.GAB 052/2024 | AET municipal para excesso de peso/dimensão (CONTRAN: altura 4,40 m; largura 2,60 m; compr. 14,00/19,30/19,80 m; PBT 45 t) | https://legislacao.prefeitura.sp.gov.br/leis/portaria-secretaria-municipal-de-mobilidade-e-transito-smt-52-de-17-de-dezembro-de-2024 |
| Portaria 72/16-SMT.GAB, Lei 16.311/15 | ZMRF (fretamento) 2ª–6ª 5–21h e "vias restritas" | KML CET (mymaps/) |
| CTB (Lei 9.503/97) Anexo I | CAMINHÃO = PBT > 3.500 kg (Lei 14.440/2022); CAMINHONETE = PBT ≤ 3.500 kg (não é caminhão → não sujeita a R-9/ZMRC/VER) | https://www.planalto.gov.br/ccivil_03/leis/l9503compilado.htm |
| CTB art. 187 I | Transitar em local/horário não permitido: média (CET: R$ 130,16, 4 pontos) | idem |
| CTB art. 184 III | Faixa/via exclusiva de ônibus: gravíssima + remoção (184 I: faixa da direita exclusiva tolera acesso a imóvel/conversão à direita) | idem |

### Horários (Portaria 137/18 + 154/18 + 57/21), excetuados feriados
- ZMRC (≈100 km²): 2ª–6ª 05–21h; sáb 10–14h. VUC com AETC liberado integral.
- VER §1º (centro: Paulista, Rebouças, 9 de Julho, 23 de Maio, Rubem Berta, Radial Leste/Alcântara Machado, Melo Freire...): 2ª–6ª 05–21h; sáb 10–14h. **VUC PROIBIDO.**
- VER §2º (Marginal Pinheiros entre Pte. Jaguaré e Pte. Morumbi, Bandeirantes, Taunay, Roberto Marinho): 2ª–6ª 05–21h; sáb 10–14h. VUC liberado c/ AETC.
- VER §3º (vias do Morumbi: Giovanni Gronchi, Morumbi, Jules Rimet...): 2ª–6ª 05–21h; sáb 10–14h. VUC liberado c/ AETC.
- VER §4º (Marginal Tietê por pista/sentido, Av. do Estado, Salim Farah Maluf, Tancredo Neves, Anhaia Mello, Paes de Barros, Bresser, São Miguel/Mal. Tito...): 2ª–6ª 05–09h e 17–21h; sáb 10–14h.
- ZERC: áreas/vias em Zonas Exclusivamente Residenciais **sinalizadas** com R-9 "ZONA ESPECIAL DE RESTRIÇÃO", período integral. Não há lista/geometria publicada.
- Vias com R-9 sem complemento (período integral) ou com "exceto autorizados" seguem regras próprias (art. 4º) — sem base de dados.
- AETC: cadastro no SUAE (https://dsvae.prefeitura.sp.gov.br/PaginasPublicas/Home.aspx), validade máx. 2 anos; VUC e guincho exigem vistoria (CVC).
- Fiscalização: agentes + radares com Leitura Automática de Placas (LAP).

### Rodízio para caminhão (Decreto 58.584/18 + CET)
- Área interna do Minianel: caminhões sujeitos ao rodízio por placa 7–10h/17–20h.
- Vias limítrofes (Minianel): carros proibidos pelo rodízio; caminhões liberados do rodízio (mas sujeitos a VER, perigosos etc.).
- VUC cadastrado: isento do rodízio.
- Suspensões: feriados (rodízio, ZMRC, ZMRF suspensos). Em suspensões extraordinárias (greve de trem, véspera de feriado, jogos), a CET costuma suspender só para veículos de passeio e **manter para pesados e ZMRC** (9 de 15 eventos de 2026). Tabela: https://webforms.cetsp.com.br/suspensaorodizio/Relatorio?year=AAAA (40 eventos 2024–2026 em cet/rodizio_suspensoes.csv).

### Carga e descarga / estacionamento
- Zona Azul Caminhão ("Bolsão Caminhão"): 1 CAD = 30 min, 2 CADs = 1 h; vale para caminhão, caminhonete e misto. Nas demais vagas Zona Azul vale a regra geral (1 CAD = 1 h). Carga e descarga em Zona Azul é permitida com CAD ativo. (https://www.cetsp.com.br/consultas/zona-azul/tudo-sobre-zona-azul-digital.aspx ; FAQ https://www.cetsp.com.br/perguntas-frequentes.aspx)
- Estacionar fretamento em via é proibido salvo regulamentação (Zona Azul Fretamento, Portaria 177/16-DSV.G: 74 vagas em 9 pontos turísticos + 24 de embarque).

## 2. Fontes de dados testadas

### 2.1 GeoSampa WFS (https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs)
- 485 FeatureTypes no GetCapabilities (all_layers.tsv). CountDefault = 30.000 por requisição; paginação com startIndex + sortBy funciona. CQL_FILTER funciona (resultType=hits).
- Licença: **CC-BY-SA 4.0** ("Licença para uso de dados do GeoSampa", https://prefeitura.sp.gov.br/web/licenciamento/w/licen%C3%A7a-para-uso-de-dados-do-geosampa) — permite uso comercial, exige atribuição e compartilhamento pela mesma licença em republicação de dados derivados.

Camadas testadas (feições / nº de atributos / geometria):

| camada | feições | atributos | geom | observação |
|---|---|---|---|---|
| restricao_circulacao_veiculo_zmrc | 1 | 6 | Polygon | 100,2 km²; dt_carga 2018-02-14 |
| restricao_circulacao_veiculo_mian | 1 | 6 | Polygon | 150,6 km² |
| restricao_circulacao_veiculo_zmrf | 1 | 6 | Polygon | 74,7 km² (fretamento) |
| classificacao_viaria_cet | 210.754 | 17 | LineString | Local 133.098; Coletora 50.641; Arterial 21.707; Vias de pedestre 4.232; Rodovia 648; VTR 428 |
| classificacao_viaria_quadro_9 | 189.703 | 7 | LineString | classificação do PDE (urbanística) |
| pde_viario_estrutural | 266 | 6 | MultiLine | 175 "a melhorar", 91 "a abrir" (planejamento) |
| corredor_onibus | 45 | 12 | Line | 40 em operação (494,9 km), 2 implantação, 3 futuros; inclui RMSP |
| faixa_onibus | 7.378 | 17 | Line | 778,5 km; EXCLUSIVA 7.003, PREFERENCIAL 231, REVERSÍVEL 103, TEMPORARIA 41; horário em texto livre (ex. "2ª a 6ª das 06-09h") |
| zona_azul | 4.595 | 19 | Line | 775 trechos com vaga de caminhão = 2.806 vagas; 23 trechos fretamento = 149 vagas; horários seg–sex/sáb/dom/feriado; dt_carga 2026-10-03 (atualizada) |
| vaga_especial | 6.734 | 11 | Point | CA (caminhão) 816 pontos/2.521 vagas, todos rotativos; FR 12/70; MO 2.451; ID; DF; BK; MF; PK (sigla não documentada); dt_carga 2025-06-07 |
| obra_arte | 6.548 | 7 | Line | PONTE 4.416; VIADUTO 1.129; PASSARELA 821; TÚNEL 114; CALÇADÃO 68 — **sem altura/peso**; base 2004 (5.973) |
| semaforo | 6.432 | 8 | Point | dt_carga 2018 |
| acidente_cet | 5.716 | 17 | Point | só 28/02/2021–28/02/2022; 270 com caminhão; 711 com fatal (82 c/ caminhão e fatal) |
| controle_uso_via_publica_geoinfra | 1.902 | 7 | Point | só obras de EMERGÊNCIA; snapshot 2026-01-31 |
| equipamento_feira_livre | 975 | 34 | Point | dia da semana (DOM 205, SÁB 195...), sem horário; dt_atualizacao 2026-06-24 |
| perimetro_zona_lei_18081_24 | 61.692 | 10 | MultiPolygon | ZER-1 2.522, ZERa 368, ZER-2 89 polígonos (≈39 km²) → proxy de ZERC |
| perimetro_zona_lei_18177_24 | 61.784 | 10 | Polygon | idem (lei 18.177/24) |
| segmento_logradouro | 10.200 | 15 | Line | tem qt_leito_carrocavel |
| linha_onibus 2.316, ponto_onibus 22.569, terminal_onibus 50, ferrovia_mdc 2.400, via_bicicleta 2.135, risco_ocorrencia_alagamento 292, departamento_cet 59, gerencia_cet 36, transpetro_duto 754, estacao_transbordo 3, zona_origem_destino 527 | | | | contexto |
| sac_vistoria_reparo_ponte_viaduto 115, sac_veiculo_local_proibido 2.005, sac_placa_transito 941 | | 14 | Point | pedidos SP156 (2020–21) |

Falsos positivos do grep: `restricao_mirante_santana` (é estação meteorológica), `restricao_geotecnica`. **Não existem** no GeoSampa camadas de VER, ZERC, vias R-9, vagas de carga/descarga fora da Zona Azul, radares, alturas de viadutos.

Comandos: `python3 wfs_probe.py <camada...>` (hits + DescribeFeatureType + 5 feições em wfs_samples/). Downloads completos em full/.

### 2.2 CET-SP (https://www.cetsp.com.br)
- Páginas de regras (texto salvo em cet/*.txt): resumo das restrições, ZMRC, VER §1–§4, ZERC, rodízio, perigosos, Zona Azul, fretamento, FAQ.
- **Google My Maps da CET** (KML exportável, testado HTTP 200):
  - https://www.google.com/maps/d/kml?mid=z9TqTcegPvdk.kotJ30qs8z8A&forcekml=1 ("CET - Caminhão 1", VER §1: 25 linhas, 104,7 km, por sentido)
  - https://www.google.com/maps/d/kml?mid=z9TqTcegPvdk.kj1m9B2XHemE&forcekml=1 ("Caminhão 3", VER §2/§3: 13 linhas, 69,2 km)
  - https://www.google.com/maps/d/kml?mid=z9TqTcegPvdk.kT3jAfulmRU0&forcekml=1 ("Caminhão 2", VER §4: 30 linhas, 154,4 km)
  - https://www.google.com/maps/d/kml?mid=1yu7xtaE67exPcbYBXxzMsUi1L28&forcekml=1 (ZMRF: polígono + 25 vias restritas + 30 vias permitidas)
  - Convertido: mymaps/cet_mymaps_ver_zmrf.geojson (166 feições). **Incompleto/desatualizado** vs Portaria 137/18: faltam p.ex. Vd. 9 de Julho, Vd. Jacareí, R. Maria Paula, Melo Freire, Conde de Frontin (§1); Gen. Edgar Facó, Juntas Provisórias, Bresser, Taquari, Gazeta do Ipiranga, Vd. Grande SP, Pte. Tatuapé, Av. São Miguel/Mal. Tito (§4). Sem licença explícita.
- Shapefile Mini-Anel: https://webforms.cetsp.com.br/mapabasico/export/shapesMiniAnel.zip (HTTP 200, 13 KB, 2019). Tentativas shapesZMRC/shapesVER/shapesZMRF/shapesCaminhao.zip → 404.
- Classificação viária CET: https://www.cetsp.com.br/media/1673515/classvias.zip (HTTP 200, 29,9 MB → classvias.gpkg 61 MB, nov/2025, EPSG:4326, 210.740 feições: LOCAL 133.264 / 12.900,6 km; COLETORA 50.471 / 4.179,4 km; ARTERIAL 21.767 / 2.183,1 km; VIA DE PEDESTRES 4.151 / 277,8 km; RODOVIA 653 / 340 km; VTR 429 / 174,8 km). Listagens XLSX vigentes a partir de 15/12/2025. Portaria DSV.G 18/19.
- Suspensões do rodízio/ZMRC: https://webforms.cetsp.com.br/suspensaorodizio/Relatorio?year=2026 (HTML tabela, desde 1997).
- Pesquisa OD de Cargas (2015–16): https://www.cetsp.com.br/media/565389/base-od-cargas-08022017-1-.csv (6,1 MB, 12.424 movimentos, 3.001 empresas; dicionário e zoneamento 49 zonas). Tipo de veículo: Utilitário 34,6%, VUC 23,6%, Truck 10,2%, Moto 10,0%, Toco 8,9%, Carreta 5,1%, Bitrem 0,2%.
- Radares/fiscalização eletrônica: só painel Power BI público (https://app.powerbi.com/view?r=eyJrIjoiZDhiOTU2NmMtMjVlMS00ZjY2LWE1NGItYWUzYjAyYmRhNmU3IiwidCI6ImIwODI2Nzg2LTZmNjktNGVjZC1iZmEyLTYyMmRhYTJiMTlhZCJ9) — não é dado aberto; não extraído.

### 2.3 OSM (PBF local sudeste-latest, bbox do município -46.83,-24.01,-46.36,-23.35)
285.230 vias highway. hgv=no 346 (Imigrantes, Via Expressa Sul, Minhocão, Av. da Liberdade...); **hgv:conditional 6** (só 3 trechos da Marginal Tietê expressa com horário VER §4 e 3 com 05–21h); hgv=destination 13; hgv=delivery 5; motor_vehicle:conditional 160 (Paulista aberta dom., Minhocão, algumas feiras); access:conditional 16; maxweight 23; maxheight 978; maxlength 11; hazmat 35; highway=busway 1.035; lanes:bus 408; psv:lanes 1.198; parking:both 1.142. ⇒ OSM praticamente não tem ZMRC/VER/ZERC.
Valhalla (master, valhalla-scripted:latest) lê `hgv:conditional` como restrição temporal (kTimedDenied/kTimedAllowed) e aplica com `date_time` (src/mjolnir/pbfgraphparser.cc, linhas ~2609–2675).

### 2.4 Falhas
- Overpass (overpass-api.de) contagem no município: HTTP 504 (timeout do servidor) → substituído por osmium local.
- dados.prefeitura.sp.gov.br API CKAN: bloqueio anti-bot (desafio F5/TSPD) — não contornado. Via navegador (WebFetch) a busca "caminhão" retorna só 1 dataset irrelevante (auditorias CGM).
- Querido Diário API (api.queridodiario.org.br): 1ª chamada 200 com 0 resultados para SP; depois 503 "no available server".
- Gazeta SP (notícia Rodoanel): 403.

## 3. Licenças
- GeoSampa: CC-BY-SA 4.0 (comercial OK; atribuição; share-alike na redistribuição de dados derivados). Não misturar dentro da base OSM (ODbL) — manter em tabelas próprias.
- Atos oficiais (decretos, portarias, listas de vias/horários): não protegidos por direito autoral (Lei 9.610/98, art. 8º, IV — https://www.planalto.gov.br/ccivil_03/leis/l9610.htm). Podemos digitalizar VER a partir do texto legal sobre geometria OSM.
- Páginas/KML/My Maps da CET: sem licença explícita ("Copyright" no rodapé). Usar como referência visual; preferir geometria própria derivada do texto legal.
- OD Cargas: CET diz que o resultado "será de domínio público", sem licença formal.

## 4. Como integrar ao app (proposta)
1. **Tabela `legal_rules` + `rule_segments`** (Postgres): cada regra com base legal (norma, artigo, parágrafo), janelas (dias/horas), feriados excluídos, classes de veículo afetadas (caminhão PBT>3,5 t; VUC; perigosos por grupo ONU; fretamento) e exceções (VUC com AETC, perecíveis 5–12h, etc.).
2. **VER (79 trechos)**: digitalizar a partir do texto da Portaria 137/18 casando nomes/trechos com ways do OSM (osmium + nomes), usando o KML da CET só como conferência. Gerar overlay `hgv:conditional=no @ (Mo-Fr 05:00-21:00; Sa 10:00-14:00)` (ou 05-09,17-21 no §4) num PBF derivado privado e recompilar tiles → Valhalla aplica com `date_time` sem bloquear travessias (exclude_polygons bloquearia cruzamentos). Para VUC no §1: regra separada (VUC também proibido).
3. **ZMRC**: manter exclude_polygons (já feito) com janelas 2ª–6ª 05–21h / sáb 10–14h; exceção VUC exige flag "tem AETC".
4. **Rodízio**: polígono do Mini-Anel com recuo (vias-limite liberadas para caminhão — confirmado pelo Dec. 58.584 art. 2º §2º); adicionar exceção VUC cadastrado, perecíveis, elétricos/híbridos; calendário de feriados + scraper diário de https://webforms.cetsp.com.br/suspensaorodizio/Relatorio?year=AAAA (atenção: suspensões extraordinárias costumam MANTER regra para pesados).
5. **Perigosos (Portaria 051/2024)**: perfil "hazmat" com grupo ONU; Minianel (13 vias do Anexo IV) e área interna 7–10/17–20h; ZMRC/ZERC só 10–16h com AETC e ≤2 eixos traseiros; VER proibido. Exige LETPP (aviso no app).
6. **ZERC**: sem dado oficial. Usar polígonos ZER (GeoSampa zoneamento, ≈39 km²) como penalidade/alerta ("pode haver placa R-9 integral") + reportes colaborativos `truck_ban`.
7. **Carga e descarga**: importar `zona_azul` (trechos com qt_vaga_caminhao>0, horários) e `vaga_especial` CA → POIs "onde parar" perto do destino, com regra 1 CAD = 30 min. Faixas de ônibus (`faixa_onibus` com horários) → alerta "não pare/não circule na faixa exclusiva neste horário".
8. **Presets**: VUC = largura ≤ 2,50 m, comprimento ≤ 7,20 m, fabricação ≥ 2005 e ≤ 15 anos; adicionar preset "Utilitário/caminhonete ≤3,5 t" (34,6% dos movimentos na OD Cargas) que NÃO sofre ZMRC/VER mas sofre rodízio.
9. **Monitorar Portaria 49/2021**: quando o trecho final do Rodoanel Norte for liberado, Marginal Tietê vira proibida para caminhões sem origem/destino em SP — feature flag pronta.
10. Atualização: GeoSampa WFS semanal (zona_azul tem dt_carga recente); legislação: checar mensalmente a página "Alterações" da Portaria 137/18 no catálogo legislacao.prefeitura.sp.gov.br.
