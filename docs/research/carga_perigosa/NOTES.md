# Produtos perigosos (PP): regras e restrições de rota (pesquisa de 09/10/2026)

Pasta: `research/carga_perigosa/`. Tudo abaixo foi testado com curl/python/osmium/GDAL, salvo onde está escrito "não confirmado".
A lista estruturada de regras e trechos está em `regras_trechos_carga_perigosa.json`.

## 1. Resumo para decisão
- **Não existe regra federal de rota para PP.** A Res. ANTT 5.998/2022 (vigente desde 01/06/2023, alterada pelas Res. 6.016/2023 e 6.056/2024) regula veículo, documentos, condutor e multas. Rota e horário ficam com a autoridade que tem circunscrição sobre a via (art. 38): prefeitura, DER/ARTESP, DNIT/PRF.
- **Regra principal na Grande SP:** Portaria SMT.GAB nº 051/2024 da capital. PP é proibido seg–sex, exceto feriados, das **07–10h e 17–20h**, nas vias do **minianel** (Anexo IV) e no **centro expandido**. Os grupos III (consumo local) e IV (outros) podem circular o dia todo **dentro** do centro expandido, mas **não nas vias do minianel**. Ela revogou a Portaria 100/2016-DSV.GAB, que proibia das 5–10h e 16–21h. A página da SMUT com a Portaria 21/2013 está desatualizada.
- **A LETPP é obrigatória para cada veículo, em todo o município de SP, 24h, mesmo com quantidade limitada.** A base é o Decreto 50.446/2009, alterado pelo Decreto 60.169/2021, que exige também a TAG Brasil-ID. Isso é um requisito de conformidade e não de rota: o app pode alertar e guardar no perfil do veículo.
- **Isenção por quantidade limitada:** Res. 5.998, Parte 3, itens 3.4.2.6 e 3.4.3.4. Abaixo da coluna 8 da Relação de Produtos Perigosos, a carga fica livre de "limitações quanto a itinerário, estacionamento e locais de carga e descarga". O FAQ da PMSP aplica essa isenção às restrições municipais, mas não à LETPP. → o perfil precisa do campo "qtd. limitada".
- **Trecho estadual confirmado:** SP-324, do km 86+620 ao km 90+700, ambos os sentidos, proibido para PP (Portaria SUP/DER-062/2024). Fica fora da RMSP, perto de Viracopos, mas mostra o padrão: o DER cria proibições por portaria e trecho, sem dataset.
- **OSM quase não tem dados de PP.** O Brasil tem 73 ways com `hazmat` e nenhuma com `hazmat:water` ou `hazmat:A–E`. O Sudeste tem 37. A RMSP tem 35: todas na serra da Imigrantes, que também tem `hgv=no`, mais uma "Parada para Cargas Especiais" `designated`. O teste no Valhalla local de Jabaquara→Santos com `hazmat:true` e `false` deu rota idêntica (71,6 km, 64,5 min). **Hoje o checkbox "Carga perigosa" não muda nenhuma rota.**
- **Mananciais:** nenhuma proibição de PP foi encontrada para Billings, Guarapiranga, Alto Juquery ou Alto Tietê Cabeceiras. O Rodoanel, a Imigrantes, a Anchieta, a Régis e a Fernão Dias cortam essas bacias. A CETESB registrou 110 emergências químicas de transporte rodoviário dentro dessas bacias entre 2014 e 2026, sendo 55 no Rodoanel. → tratar como aviso ou penalidade leve, não como bloqueio.
- **Túneis:** nenhuma proibição específica de PP foi encontrada, nem na capital nem no Rodoanel. A regulamentação ANTT não tem categorias de túnel no estilo ADR: busquei "túnel" nas Partes 1, 3 e 7 e não houve nenhuma ocorrência.

## 2. Fontes testadas

### 2.1 Normas (fonte primária)
| Fonte | URL | Teste |
|---|---|---|
| Portaria SMT.GAB 051/2024 (PMSP) | https://cetsp.com.br/media/1592296/portaria-051-24.pdf | HTTP 200, 232 KB, PDF com 5 p. Texto em `portaria_051_24_cet.txt`. Anexos I (19 nº ONU), II (20) e III (9) em `sp_portaria_smt_051_2024_grupos_onu.csv` |
| Página CET "Circulação de produtos perigosos" | https://www.cetsp.com.br/consultas/transporte-de-produtos-perigosos.aspx | lida por WebFetch. Confirma a 051/2024, cita o Decreto 60.972/2021 (preço público da LETPP) e a Portaria 54/SVMA/2009 (PAE) |
| Lei municipal 11.368/1993 | https://legislacao.prefeitura.sp.gov.br/leis/lei-11368-de-17-de-maio-de-1993 | HTTP 200. Cria os grupos I–IV, o cadastro e o relatório anual do expedidor |
| Decreto 50.446/2009 (consolidado) | https://legislacao.prefeitura.sp.gov.br/leis/decreto-50446-de-20-de-fevereiro-de-2009 | HTTP 200. CTPP, LETPP por veículo, PAE, multa |
| Decreto 60.169/2021 | https://legislacao.prefeitura.sp.gov.br/leis/decreto-60169-de-9-de-abril-de-2021 | HTTP 200. PAE federal/estadual aceito, TAG Brasil-ID |
| FAQ PMSP produtos perigosos (2019) | https://www.prefeitura.sp.gov.br/cidade/secretarias/upload/chamadas/perguntasfrequentesprodutosperigosos_1566334708.pdf | HTTP 200, 161 KB. Ainda cita a Portaria 100/2016, já revogada, mas as regras sobre bobtail, quantidade limitada e regra mais restritiva continuam úteis |
| Página SMUT "Transporte de Produtos Perigosos" | https://prefeitura.sp.gov.br/web/mobilidade/autorizacoes_especiais/transporte_de_produtos_perigosos | **DESATUALIZADA**: cita a Portaria 21/2013 com 5–10h e 16–22h. Não usar |
| Res. ANTT 5.998/2022 (compilada, com notas de 6.016/2023 e 6.056/2024) | https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=detalharAto&tipo=RES&numeroAto=00005998&seqAto=000&valorAno=2022&orgao=DG/ANTT/MI&codTipo=&desItem=&desItemFim=&cod_menu=5408&cod_modulo=161&pesquisa=true | HTTP 200, 132 KB. Arts. 20, 38, 42 e 46 lidos |
| Res. 5.998, anexo "Relação de Produtos Perigosos" | https://anexosportal.datalegis.net/arquivos/1774888.pdf | HTTP 200, 1,1 MB, 125 p. O parse heurístico gerou 2.310 nº ONU com classe (`antt_relacao_produtos_perigosos_onu_classe.csv`). Faltam as colunas 8 (qtd. limitada por veículo) e 5 (nº de risco): é preciso um parse melhor, e o anexo é a versão de 09/2022 |
| Res. 5.998, Partes 1, 3 e 7 | .../1774868.pdf, .../1774878.pdf, .../1774884.pdf | HTTP 200. Os 10 anexos somam cerca de 12 MB, todos acessíveis |
| Página ANTT Produtos Perigosos | https://www.gov.br/antt/pt-br/assuntos/cargas/produtos-perigosos | HTTP 200. Confirma a Res. 6.056/24 de 29/11/2024 (AP 005/2024). Atualizada em 09/07/2026 |
| Decreto federal 96.044/1988 | https://www.planalto.gov.br/ccivil_03/decreto/antigos/d96044.htm | HTTP 200. Arts. 9, 11, 13 e 14 (itinerário, estacionamento). Sem nota de revogação na página; **vigência a confirmar** |
| Portaria SUP/DER-062/2024 (SP-324) | https://setcesp.org.br/wp-content/uploads/2024/08/Portaria-SUP_DER-062.2024.pdf | HTTP 200, PDF do DOE de 01/08/2024 com código de autenticidade |
| Portaria SUP/DER-058/2011 (autorização de lindeiros) | http://200.144.30.104/der/portarias/webportarias/HTML/PRT058-11.ASP | HTTP 200. O índice `/webportarias/` dá 403 (listagem negada), então não há como baixar todas as portarias DER |
| DER "Autorização de Circulação (Rodovias com Restrições)" | https://www.der.sp.gov.br/der/servicos/autorizacoes/autorizacao_circulacao | HTTP 200. Não traz a lista de trechos restritos |
| DNIT STRPP (página e guia v3) | https://www.gov.br/dnit/pt-br/assuntos/infraestrutura-rodoviaria/produtos-perigosos/produtos-perigosos ; guia: .../strpp__guia_do_usuario-v3.pdf | HTTP 200. Os dados das rotas declaradas **não são públicos** (o sistema `servicos.dnit.gov.br/cargasperigosas` exige login, 307). Seria preciso pedir via LAI |
| Portaria Conjunta ARTESP/DER 01/2025 | link artesp.sp.gov.br (dam) | HTTP 200. Trata de free flow, **irrelevante para PP** |

### 2.2 Dados geográficos e estatísticos
| Fonte | Acesso | Teste / contagem |
|---|---|---|
| **CETESB – Emergências Químicas 2014–2026** (DataGEO) | WFS `https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs`, camadas `datageo:VWM_ACIDENTES_AMBIENTAIS_CETESB_{2014..2026}_PTO` | HTTP 200, cerca de 300 KB/ano. **4.103 registros**, dos quais **2.349 (57%) são transporte rodoviário**: 502 na RMSP e 151 em 2026 até agora. Na RMSP, o Rodoanel é a rodovia líder (102), seguido de Régis (29), Fernão Dias (28), Bandeirantes e Ayrton Senna (23 cada), Anchieta (22) e Imigrantes (18). Ruas e avenidas urbanas somam 164. Campos: Data, Hora, Local, Rodovia, Atividade, Causa, Prod_quimicos, Meio_afetado, Num_vitimas, Municipio, ponto. Arquivos em `cetesb_emerg/*.geojson` e `cetesb_emergencias_transporte_rodoviario_2014_2026.csv` |
| CETESB SIEQ (`sistemasinter.cetesb.sp.gov.br/emergencia/*.php`) | HTML | HTTP 200, mas todas as páginas (relatório, rodovia, município) devolvem a mesma casca de 2.472 bytes, sem dados. **Falhou**: usar o DataGEO |
| CETESB relatórios anuais (repositório) | PDF | HTTP 200 nos relatórios de 2006 a 2010. Antigos, só para contexto: o relatório de 2010 estima cerca de 11.000 caminhões/dia com produtos químicos no minianel |
| Limites das bacias/APRM (DataGEO) | WFS: `VWM_LIMITE_BACIA_BILLINGS_POL`, `VWM_LIMITE_BACIA_GUARAPIRANGA_POL`, `APRMAJ_LIMITE_BACIA_2015_POL`, `APRMATC_LIMITE_BACIA_2015_POL` (1 feição cada); zoneamento `APRMB_SMA2010` (907) e `APRMG_SMA2007` (90); `FX50M_APRMB` | HTTP 200. Áreas: Billings 581 km², Guarapiranga 638, Alto Juquery 367, Alto Tietê Cabeceiras 1.259. Arquivos em `mananciais/` |
| GeoSampa: mananciais (só no município de SP) | WFS `geoportal:manancial_billings` (905), `manancial_guarapiranga` (143), `manancial_juquery` (268) | HTTP 200. Arquivos `geosampa_manancial_*.geojson` |
| GeoSampa: MIAN (minianel), já integrado | `geoportal:restricao_circulacao_veiculo_mian` | reaproveitar para PP, com buffer **para fora** (ver §4) |
| OSM (PBF local `sudeste-latest`) | osmium | 37 ways com hazmat no Sudeste, 35 na RMSP (todas na SP-160 serra: hazmat=no, hgv=no; mais 6 `designated` em "Parada para Cargas Especiais", em -23.70,-46.43). Túneis rodoviários na bbox da RMSP: 218 ways / 53 km; 134 ways / 46 km em vias principais; 4 com hazmat. O Rodoanel tem 12 ways de túnel (Oeste, Sul, Leste e Norte) e nenhuma com hazmat |
| OSM Brasil (Overpass `maps.mail.ru`) | Overpass | 73 ways `highway` com `hazmat`; 0 `hazmat:water`; 0 `hazmat:A–E`. overpass-api.de, kumi e private.coffee deram 504/500 no dia. A lista detalhada do Brasil falhou por timeout |
| Valhalla 3.9.1 (lua embutida) | inspeção do binário | `hazmat` vira booleano (designated/yes=true; no/destination/delivery=false). Lê também hazmat:water e hazmat:A–E. **Não lê `hazmat:conditional`**, então regras com horário não entram nos tiles |
| IBAMA SIEMA (acidentes ambientais) | CKAN `dadosabertos.ibama.gov.br`, dataset `siema-comunicado-de-acidente-ambiental` (ODbL) | **Falhou**: o WFS `siscom.ibama.gov.br/geoserver/publica/ows` dá 301 e depois 404 |
| IBAMA AATIPP (autorizações de transporte interestadual de PP) | CSV `https://dadosabertos.ibama.gov.br/dados/AATIPP/autorizacao_empresa/{UF}/{ANO}.csv` | HTTP 200. SP 2024 = 321 MB; SP 2025 = 341 MB (baixados por engano e apagados). Amostra de 300 KB em `ibama_aatipp_SP_2025_amostra.csv`. Campos: empresa, CNPJ, modal, validade, classes de risco, UFs, empresa de resposta. Serve para dimensionar o mercado (transportadoras de PP), não para rota |
| ARTESP acidentes (CKAN, CC-BY) | CSV anual 2001–2026 | HTTP 200; 2025 = 10 MB, 44.134 acidentes. **Não tem campo de PP**. Amostra em `artesp_acidentes_2025_amostra.csv` |
| ANTT acidentes em rodovias federais concedidas (CC-BY) | CSV por concessionária | HTTP 200 (Régis, 12 MB, 2010–2026). Tem só `transporte_de_cargas_especiais`, **sem campo de PP** |
| dadosabertos.sp.gov.br / dados.antt.gov.br | CKAN | busca por "produtos perigosos": 0 datasets |
| ANTT ParticipANTT (audiências) | SPA React | não dá para ler via curl. A notícia secundária de "audiência pública em maio/2026 para revisar o regulamento" **não foi confirmada** |
| Portal LETPP (`letpp.moovii.com.br`) | — | DNS não resolve (curl: Could not resolve host) |
| legislacao.presidencia.gov.br | — | conexão resetada; não deu para confirmar a vigência do Decreto 96.044 |

## 3. Comandos de teste usados
```bash
curl -sS -L -A "Mozilla/5.0" -o portaria_051_24_cet.pdf https://cetsp.com.br/media/1592296/portaria-051-24.pdf && pdftotext -layout portaria_051_24_cet.pdf -
W=https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs
curl "$W?service=WFS&version=1.1.0&request=GetFeature&typeName=datageo:VWM_ACIDENTES_AMBIENTAIS_CETESB_2025_PTO&resultType=hits"   # 302
curl "$W?service=WFS&version=1.0.0&request=GetFeature&typeName=datageo:VWM_ACIDENTES_AMBIENTAIS_CETESB_2025_PTO&outputFormat=application/json&srsName=EPSG:4326"
# OSM: osmium tags-filter sudeste-latest.osm.pbf w/hazmat w/hazmat:water ... (container debian + osmium-tool; ver osm/run.sh)
# Overpass Brasil: q_br_count.ql em https://maps.mail.ru/osm/tools/overpass/api/interpreter
# Valhalla: POST localhost:8002/route com costing_options.truck.hazmat true/false (vreq_*.json / vres_*.json)
# Bacias x rodovias x emergências: mananciais/analise.py (GDAL/OGR, EPSG:31983)
```

## 4. Como integrar no app
1. **Perfil do veículo**: trocar o booleano `hazmat` por um objeto `{ativo, onu[], classes[], qtd_limitada_por_veiculo, granel, letpp_sp, entrega_consumo_local}`. O autocomplete de nº ONU vem do CSV da Relação ANTT. Com o nº ONU e o campo "entrega consumo local", o grupo SP (I–IV) sai de `sp_portaria_smt_051_2024_grupos_onu.csv`.
2. **Tabela `hazmat_rules`** (Postgres/PostGIS), separada do OSM: `id, jurisdicao, geom, escopo (zona_interior | vias_limite | trecho), janelas jsonb, feriados_liberado, grupos_sp[], isencao_qtd_limitada, fonte_norma, url, status_verificacao, verificado_em`. Seed inicial a partir de `regras_trechos_carga_perigosa.json`.
   - Grupos I/II na capital: polígono MIAN **com buffer para fora (~30–50 m)**, para incluir Marginais e demais vias-limite. É o oposto do recuo de 15 m usado no rodízio/ZMRC.
   - Grupos III/IV: só as vias do minianel. São linhas do OSM pelo nome (`Marginal Tietê (Expressa|Central|Local)`, `Marginal Pinheiros (Expressa|Local)`, `Avenida dos Bandeirantes`, `Avenida Salim Farah Maluf`, `Avenida Professor Luiz Ignácio Anhaia Mello`, `Avenida Presidente Tancredo Neves`, `Avenida Afonso D'Escragnolle Taunay`, `Complexo Viário Maria Maluf`, `Rua das Juntas Provisórias`, `Viaduto Grande São Paulo Vereador Manoel de Oliveira Sala`...), recortadas pelos limites do Anexo IV e convertidas em buffers de 15–25 m para `exclude_polygons`.
   - SP-324 km 86,6–90,7: digitalizar o trecho manualmente ou usar a referência de km do DER/SRE.
3. **Roteamento**: no backend, avaliar as regras ativas no horário de chegada estimado à zona e mandar `exclude_polygons`, como já se faz com ZMRC/MIAN. Manter `hazmat:true` no Valhalla, mas não contar com ele: o OSM tem cobertura quase zero.
4. **Mananciais**: não bloquear. Calcular a interseção da rota com os 4 limites de bacia e avisar ("X km em área de mananciais; não pare; N emergências químicas registradas"). Se possível, oferecer uma rota alternativa sem bacia (2ª chamada com exclude) e mostrar a diferença de km/tempo.
5. **Pontos de descanso**: marcar os `rest_stops` dentro de bacias ou áreas densas como "não recomendado para PP" (Decreto 96.044, art. 14).
6. **Camada de risco**: importar o WFS CETESB (2014–2026) numa tabela `hazmat_incidents` com atualização anual/mensal e mostrar como heatmap; o app pode alertar em trechos com muitos registros, como Rodoanel Sul/Oeste, Régis Serra e Anchieta.
7. **Compliance**: ao entrar no município de SP, avisar se `letpp_sp=false` (multa de 50 UFM e retenção do veículo). Mostrar as multas ANTT do art. 42 (R$ 5.000 / 1.400 / 1.000 / 600).
8. **Reportes colaborativos `hazmat_ban`**: já existem. Manter em base separada do OSM e usá-los para descobrir proibições municipais da RMSP (Guarulhos, ABC etc.) que não têm dataset.

## 5. Licenças
- Textos de leis, decretos, portarias e resoluções: o art. 8º, IV, da Lei 9.610/98 os exclui da proteção autoral. Uso comercial livre, citando a fonte.
- OSM: ODbL. Os reportes ficam em base separada (já é assim).
- GeoSampa e DataGEO: GetCapabilities com `AccessConstraints NONE` e `Fees NONE`, mas sem licença explícita por camada. Recomendo registrar a atribuição e confirmar os termos (risco baixo).
- IBAMA SIEMA: ODbL. IBAMA AATIPP: "Other (Open)". ARTESP e ANTT (CKAN): CC-BY.
- CETESB (via DataGEO): dado público do Governo de SP, sem licença explícita. Atribuir à "CETESB/DataGEO".

## 6. Lacunas
- A vigência do Decreto 96.044/1988 (arts. 9–14) não foi confirmada: o Planalto não traz nota de revogação, mas o regulamento passou para resoluções ANTT.
- Não existe lista consolidada de portarias DER/ARTESP com proibições de PP por trecho. O índice do DER é negado (403) e só a SP-324 foi achada. Pedir ao DER e à ARTESP via SIC/LAI.
- Para a Imigrantes, a proibição de PP só aparece no OSM; não achei portaria ARTESP específica.
- Os demais municípios da RMSP (Guarulhos, Santo André, São Bernardo, Osasco, Barueri...) não foram pesquisados a fundo por limite de busca. Ficam para o tema `restricoes_rmsp_municipios` ou para pedido via LAI.
- Falta um parse completo da Relação ANTT (colunas 5 e 8) e a conferência de alterações nos anexos pela Res. 6.056/2024.
- Não confirmei o número da resolução CONTRAN do curso especializado (MOPP).
- A data e o conteúdo da nova audiência pública ANTT de 2026 não foram confirmados.
