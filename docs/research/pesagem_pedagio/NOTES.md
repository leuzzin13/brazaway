# Pesagem (balanças) e pedágios: pesquisa de fontes (09/10/2026)

Pasta: esta pasta. Tudo foi testado com curl/python3 e osmium (Docker). Valores e contagens abaixo saíram dos arquivos baixados aqui.
BBox usada como "Grande SP": lat -24.10..-23.15, lon -47.25..-45.65 (aproximação; inclui um pouco além da RMSP).

## 1. ANTT: dados abertos (CKAN) — rodovias FEDERAIS concedidas
Portal: https://dados.antt.gov.br (API CKAN `/api/3/action/package_show?id=...`). Licença: CC-BY em todos os conjuntos abaixo (uso comercial ok com atribuição).
- `praca-de-pedagio` (CSV/JSON/KMZ, atualizado 29/07/2026): 277 linhas, todas "Ativo"; 188 praças físicas + 89 linhas de free flow (pares entrada/saída). SP=73 linhas (RIOSP 60, Régis 5, Motiva Minas SP 4, Transbrasiliana 4). Na bbox GSP: 62 linhas (Dutra: Arujá, Arujá Rodoanel, Guararema, Jacareí + 51 linhas de free flow da Dutra em Guarulhos/SP; Fernão Dias: 3 em Mairiporã; Régis: São Lourenço da Serra).
  Campos: concessionaria, praca_de_pedagio, rodovia, uf, km_m, municipio, sentido, situacao, latitude, longitude. **Sem tarifa.** 32 linhas com coordenada de só 2 casas decimais (~1 km), 13 delas da RIOSP.
  Arquivo: antt/praca-de-pedagio.csv (latin1, ';').
- `cabine`: 2.438 cabines (Manual 997, Automática 945, Mista 496). antt/cabine.csv
- `ppv` (PPV nas concessões federais): 45 postos (37 fixos, 7 HS-WIM, 1 móvel); SP=4: Itapecerica da Serra (BR-116 km 296,3, Régis, sentido crescente), Miracatu (BR-116 km 387,7), Guararema (BR-116 km 179,4, Dutra), Queluz (BR-116 km 1). antt/ppv.csv. Inclui lat/lon e tipo.
- `posto-pesagem-veicular`: operação diária (horas funcionando/parado) e medidas administrativas (transbordo/remanejo). O último arquivo de operação com dados é OPERACAO_PPV-2025_12 (cobre out/2025); arquivos 2026_x vêm só com cabeçalho. Em out/2025: disponibilidade média 73%; Guararema 98%, Queluz 96%, Itapecerica 55%, Miracatu 37%.
- `sifama-autos-de-infracao-transito` 2026 (jan–set, agregado por UF/mês): 121.554 autos de "Evasão de Balança" (CTB art. 209) no Brasil, 4.638 em SP; excesso de peso aparece com poucos autos nesse arquivo.
- `vale-pedagio-obrigatorio`: 75 linhas mensais (04/2025–10/2026); 100% dos VPOs de 2026 são modelo "Tag".
- `volume-trafego-praca-pedagio`: mensal/diário por praça, sentido, categoria de eixo, tipo (comercial/passeio). Útil para estimar fluxo de caminhões por praça.
- `trecho-concedido`, `deteccao-de-altura` (detectores de altura com KMZ — útil para o tema altura), `sat`, `radar`, `prf` etc.
- NÃO existe dataset de tarifas no CKAN (busca "tarifa" = 0).

## 2. ANTT: tarifas (HTML por concessão)
URL padrão: https://www.gov.br/antt/pt-br/assuntos/rodovias/concessionarias/lista-de-concessoes/<slug>/tarifas-de-pedagio
Raspagem (scrape_antt_tarifas.py → antt/antt_tarifas_raspadas.json): 41 slugs (inclui contratos encerrados nova-dutra, ecosul, rodovia-do-aco); 25 com tabela HTML; 8 dão 404 (autopista-litoral-sul, autopista-planalto-sul, ecoriominas, ecovias-das-gerais, epr-via-mineira, rota-verde-goias, via-campos, via-cristais); 8 sem tabela (elovias, epr-iguacu, epr-parana, nova-381, pr-vias, rota-agro, rota-sertaneja, way-262). Datas de atualização variam de 2022 a 02/10/2026.
Exemplos (valores praticados, R$):
- RIOSP (Dutra/Rio-Santos), página atualizada 29/08/2025: P1 Arujá 4,50 (cat.1); cat.7 (5 eixos) 22,50; P4/P5 Jacareí 8,10; P6 Moreira César 16,90. P8–P10 têm tarifa de fim de semana diferente.
- Régis Bittencourt (05/01/2026): P1–P6 4,30 cat.1; 5 eixos 21,50; 6 eixos 25,80 (tabela vai só até 6 eixos).
- Motiva Minas SP (Fernão Dias, 12/05/2026): 3,70 cat.1; 5 eixos 18,50; até 8 eixos (29,60).
Regra ANTT: multiplicador = nº de eixos para veículo comercial de rodagem dupla (cat.2 = 2 eixos dupla = 2,0; cat.4 = 3 eixos = 3,0; ... cat.10 = 8 eixos = 8,0). 2 eixos rodagem SIMPLES = cat.1 (1,0).
Licença: conteúdo gov.br (sem licença explícita na página; dado público).
Free flow federal: https://www.gov.br/antt/pt-br/free-flow — 9 trechos/52 pórticos (Dutra/SP: 10 pórticos km 205–231). FAQ: 30 dias para pagar sem TAG; Deliberação ANTT 277/2026 suspendeu multas por 200 dias (pedágio continua devido). Tarifas por par entrada/saída da Dutra NÃO localizadas em tabela aberta (lacuna).

## 3. ARTESP (rodovias ESTADUAIS concedidas de SP)
- Site www.artesp.sp.gov.br: curl recebe página anti-robô Imperva ("Pardon Our Interruption"). Não contornado. WebFetch funcionou para ler a página de pedágios.
- Portal CKAN https://dadosabertos.artesp.sp.gov.br (CKAN 2.11.6, API aberta, 47 datasets):
  - `malha-rodoviaria` (CC-BY): KMZ por lote (23 arquivos, 170 MB total) com pastas "Sistema de Arrecadação/Praça(s) de Pedágio", "TCP" (trecho de cobertura da praça, LineString), "PaP", "Sistema de Pesagem/PGF" (posto geral de fiscalização) com "Equipamentos" (balança de precisão, seletiva, detecção de fuga), "PPM", "Parada de Cargas Excepcionais", "Parada de Produtos Perigosos", "Equipamentos/FreeFlow".
    Parse (parse_artesp_kmz.py → artesp/artesp_pedagio_pesagem_pontos.csv, 493 pontos): praças 187 pontos (49 na bbox GSP) em 20 lotes; PGF 48 (16 GSP) em 16 lotes; PPM 75 (6 GSP); free flow 29 (9 GSP, Rota Sorocabana); paradas cargas excepcionais 71 (19 GSP); paradas produtos perigosos 47 (16 GSP).
    Problemas: atributos não padronizados entre lotes (muitos pontos sem nome); KMZ "SP Serra" (l26) contém "LOTE RODOANEL NORTE"; KML do l29 tem prefixo XML inválido (py:pytype) — corrigido no parser removendo o atributo.
  - `pedagio`: só aponta para a página do site (licença "não especificada"). A página lista PDFs em admin.cms.sp.gov.br (acessíveis por curl):
    - tarifas vigentes: artesp/tarifas_vigentes.pdf (8 p., "PEDÁGIOS ... 2025 — 01/07/2025", modificado 02/12/2025): 136 linhas praça/pórtico; colunas PASSEIO e COMERCIAL POR EIXO (iguais em 100% das linhas) e MOTOS em alguns lotes; ViaPaulista (L29) em formato novo CAT-1..9 com multiplicador, valor Manual e AVI (TAG ~5% menor), vigência 23/11/2025–22/11/2026.
    - histórico consolidado (ativos): artesp/tarifas_hist_ativos.pdf (23 p.) com colunas COBRANÇA BIDIRECIONAL/UNIDIRECIONAL e TARIFA UNIDIRECIONAL/BIDIRECIONAL — essencial para saber em que sentido se paga.
    - ATENÇÃO: o PDF "vigente" é de 2025. No OSM, nós com check_date 2026-07-01 mostram valores maiores (ex.: Perus 14,50 no OSM vs 13,70 no PDF 2025). Não achei a tabela 2026 em fonte primária.
  - `volume-de-trafego` (CC-BY): tráfego por praça (dia/hora, .rar) e SAT.
  - `normativos-artesp`: IP.SUROD.001 — instrução de projeto de sinalização do Sistema de Livre Passagem (free flow).

## 4. DER-SP
- https://www.der.sp.gov.br/der/rodovias/balanca/pontos_de_pesagem — tabela HTML "Pontos para pesagem de veículos": 136 pontos (34 FIXO, 102 MÓVEL), campos Rodovia, Km+Metros, Sentido, Trecho, Administrador (DR n ou concessionária), Posto. SEM coordenadas (precisa georreferenciar por rodovia+km; os KMZ da ARTESP têm "Marco km"). Cerca de 10 pontos ficam na RMSP (SP-023 km 52,5; SP-150 km 29,7; SP-160 km 28,2; SP-280 km 39,2 e 41; SP-330 km 37; SP-332 km 44,5 x2; SP-098 km 77). dersp/dersp_pontos_pesagem.csv
- "Peso oficial de veículos de carga": PDF 127 p. com PBT/CMT por marca/modelo (dersp/peso_oficial.pdf) — útil para presets de veículo.
- Mapas de restrições (CVC) por DR em PDF (https://dersp.der.sp.gov.br/WebSite/Arquivos/mapas/Restricoes_SP.pdf etc.) — tema de outra frente.
- Licença: não declarada.

## 5. DNIT (rodovias federais NÃO concedidas)
- Páginas do PNP: https://www.gov.br/dnit/pt-br/rodovias/operacoes-rodoviarias/pesagem (+ /piaf, /posto-de-pesagem-misto-ppm-2): só texto/normas (PIAF, PPM com HS-WIM, UMO). Nenhuma lista de localização.
- GeoServer DNITGeo: https://servicos.dnit.gov.br/dnitgeo/geoserver/ows (WFS 2.0 GetCapabilities ok, 128 camadas). Nenhuma camada de pesagem/PIAF/pedágio (há vw_postos_prf, vw_pnct_contadores, vw_snv_rod, vw_oae).
- dados.gov.br API: 401 (exige chave). Não testado mais.
- Conclusão: localização dos postos DNIT fora das concessões não foi encontrada em fonte aberta.

## 6. OSM (PBF Geofabrik sudeste local, osmium 1.15 em Docker)
Comando: `osmium tags-filter sudeste-latest.osm.pbf n/barrier=toll_booth n/highway=toll_gantry nwr/amenity=weighbridge nwr/highway=weigh_station w/toll w/toll:hgv ...` → osm/toll_sudeste.osm.pbf; export → osm/toll_sudeste.geojsonseq; análise: analise_osm_toll.py.
- Sudeste: 592 barrier=toll_booth (83 na bbox GSP), 118 highway=toll_gantry (42 GSP), 3.670 ways toll=yes (1.529 GSP; ~545 km de motorway pedagiada na GSP), 59 nós amenity=weighbridge (12 GSP) + 26 ways.
- 687 de 710 pontos de cobrança têm `charge` em BRL, 671 com `/hgv/axle` (ex.: "14.50BRL/motorcar;0.00BRL/motorcycle;14.50BRL/hgv/axle"); 12+ com preço por dia útil/fim de semana ("Mo-Fr .../Sa-Su ..."). check_date: 509 em 2026, 110 em 2025. Também `direction`, `operator`, `payment:*` (sem_parar, veloe, conectcar, move_mais, taggy).
- Erros encontrados: "hgva/axle" (typo), valores diferentes em cabines da mesma praça (Jundiaí 6.10 vs 6.40), pórticos free flow da Dutra sem `charge`, `direction` com convenções mistas.
- weighbridge no OSM: quase sem atributos (16 de 59 com nome); inclui balanças privadas. Baixa utilidade.
- Licença ODbL (uso comercial ok; atribuição; base derivada pública fica share-alike).

## 7. Valhalla (local 3.9.1, porta 8002)
Doc: https://raw.githubusercontent.com/valhalla/valhalla/master/docs/docs/api/route/api-reference.md
- Opções: `use_tolls` (0–1), `exclude_tolls`, `toll_booth_cost` (padrão 15 s), `toll_booth_penalty`, `exclude_cash_only_tolls`; resposta: `summary.has_toll`, `maneuver.toll`. trace_attributes: `edge.toll`, `node.type` = toll_booth/toll_gantry. Lua lê `toll`, `barrier=toll_booth`, `highway=toll_gantry`, `payment:cash`.
- **Valhalla não calcula preço de pedágio.**
- Teste (valhalla/teste_toll.py), Lapa→Jundiaí, truck 5 eixos: padrão 48,8 km/48 min com pedágio; use_tolls=0 ainda passa no pedágio (53 min); exclude_tolls → 59,8 km/96 min sem pedágio.
- Protótipo de custo (valhalla/prototipo_custo_pedagio.py): casa nós OSM com `charge` a ≤25 m da polilinha. Lapa→Jundiaí 5 eixos R$ 72,50 (Campo Limpo 14,50/eixo). Mostrou contagem dupla (cabines da mesma praça, Rodoanel/Imigrantes paralelos) → precisa de camada própria de "praça" com agrupamento e regra de sentido.

## 8. Normas (planalto.gov.br, conferidas)
- Lei 13.103/2015 art. 17 (redação MP 833/2018): caminhão vazio não paga eixo suspenso em todo o território nacional.
- Lei 7.408/1985 art. 1º (redação Lei 14.229/2021): tolerância de 5% no PBT/PBTC e 12,5% por eixo.
- CTB art. 209: deixar de entrar na área de pesagem = grave. Art. 209-A (Lei 14.157/2021): evadir pedágio/não pagar free flow = grave. Art. 231 V: excesso de peso = média + valor por 200 kg.
- Lei 10.209/2001: Vale-Pedágio obrigatório (pagamento do pedágio é do embarcador; destacado no documento).
- Lei 14.157/2021: base legal do free flow.

## 9. APIs comerciais (não testadas com chave)
- Google Routes API: TollPass tem BR_SEM_PARAR, BR_CONECTCAR, BR_VELOE, BR_MOVE_MAIS, BR_TAGGY etc.; toll pass só para DRIVE/TWO_WHEELER → não serve para caminhão por eixo.
- TollGuru: docs dizem que cobrem Brasil (lista de países América do Sul); pago.
- QualP (qualp.com.br): calculadora BR de rotas com pedágio; /api deu 404; produto pago.
- HERE Routing v8 tolls: cobertura do Brasil não confirmada nas páginas baixadas.

## 10. Testado e falhou / limites
- ARTESP www (Imperva) — bloqueio anti-robô, não contornado.
- PRF infrações 2025: Google Drive, zip de 318 MB (> limite 300 MB) — não baixado.
- ANTT SIFAMA com Range header → "Request Rejected" (WAF); sem Range funciona.
- dados.gov.br API → 401.
- DNIT: sem lista de PIAF/PPM com coordenadas.
