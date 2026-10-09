# Descanso (Lei 13.103), PPD, SAU, postos e preço de diesel — notas de pesquisa (09/10/2026)

Pasta: research/descanso_postos_combustivel/  (≈61 MB). Tudo testado com curl/python nesta data.
RMSP = 39 municípios da IBGE (API localidades, RM 04901) -> rmsp_municipios.json; normalizador em rmsp.py.

## 1. PPD — Pontos de Parada e Descanso certificados (Ministério dos Transportes)
- Página/lista: https://www.gov.br/transportes/pt-br/assuntos/transporte-terrestre_/portal-trc/ppd/lista-de-ppds-certificados
  - XLSX https://www.gov.br/transportes/pt-br/assuntos/transporte-terrestre_/portal-trc/ppd/ListaPPDs15.05.2025.xlsx -> HTTP 200, 21 KB,
    184 linhas (176 "Certificado (Estabel. Comercial)" + 8 "PPD de Concessionária"); colunas: nome, município, UF, "BR | km", tipo. SEM coordenadas.
    SP: 3 (Paradouro Batistella/Guararema BR-116 km 177; Graal Califórnia/Ourinhos BR-153 km 346; CCR RioSP/Pindamonhangaba BR-116 km 95).
    Desatualizada (maio/2025) -> ppd/ppd_lista_15-05-2025.csv
  - Mapa PDF (9 MB) 4-mapa-de-ppd-aprovados.pdf -> 200.
- Painel Power BI público do MT (link na página da ANTT e em ".../ppd/informacoes-e-dados-sobre-ppds-existentes"):
  https://app.powerbi.com/view?r=eyJrIjoiZjVmYWUyNmQtYmY4OC00YTYyLWE4MjctZTYzOTY3ZmVmNjI0IiwidCI6IjdiZjAxYzZhLWU2ZmItNDIxYS1iYmIyLWI5MGMzZWE4NjhmNyJ9
  - Modelo "BI - PPDs - Versão 11", LastRefreshTime 2026-09-30. Consultado via endpoints públicos do Power BI
    (wabi-brazil-south-api.analysis.windows.net /public/reports/{k}/modelsAndExploration, /conceptualschema, /querydata) -> ppd/pbi_query.py
  - Tabela TB_Dados_PPD: 183 PPDs, TODOS com Latitude/Longitude, vagas aprovadas/declaradas, chuveiros, serviços, funcionamento, portaria, validade.
    90 com certificação válida em 09/10/2026, 90 vencidas, 3 sem data. Vagas aprovadas: 14.056 (6.206 nos válidos). 173 postos de combustível.
    121 DNIT, 62 ANTT. 137 funcionam 24h. Saída: ppd/ppd_powerbi.json (sem nome de proprietário/telefone/e-mail — não baixei dados pessoais).
  - SP: só 2 (Batistella Guararema 200 vagas; Graal Califórnia Ourinhos 120 vagas) — ambos com validade 31/05/2025 (vencida no painel).
  - TB_Concessionarias: 32 PPDs de concessões (12 entregues, 7 em andamento, 13 a iniciar). SP: Dutra km 95 Pindamonhangaba (entregue, 120 vagas);
    Dutra km 182 (em andamento, coord. de edital ≈ -23.344,-46.161, região de Guararema/Jacareí). -> ppd/ppd_concessionarias_powerbi.json
  - Risco: endpoint não documentado; pode mudar sem aviso. Licença não declarada (dado público governamental).
- Certificações saem no DOU (Secretaria Nacional de Transporte Rodoviário), validade 4 anos; ex.: Portaria nº 802/2025 (DOU 15/10/2025),
  Portaria nº 857 de 06/10/2026 (DOU 07/10/2026). Busca DOU funciona sem login:
  https://www.in.gov.br/consulta/-/buscar/dou?q=%22Ponto+de+Parada+e+Descanso%22&s=do1&exactDate=ano  (JSON embutido no HTML; 20 resultados no último ano,
  incl. Decisões SUROD/ANTT autorizando obras de PPD em concessões).
- DNIT: https://www.gov.br/dnit/pt-br/rodovias/pontos-de-parada-e-descanso -> XLSX antigo (copy_of_PPDsCertificados_DNIT_24.02.xlsx, 57 linhas, 2023).
- ANTT 2020 "Relação dos Trechos com PPD" (PDF 78 KB, 200): inclui NovaDutra (Rio–SP), Fernão Dias (BH–SP), Régis Bittencourt (SP–Curitiba),
  Transbrasiliana BR-153/SP. -> ppd/relacao_trechos_ppd_antt_2020.pdf
- Normas confirmadas: Lei 13.103/2015 arts. 9–12; Portaria MInfra nº 45/2021 (reconhecimento); Portaria MTP nº 672/2021 (condições sanitárias/conforto);
  Resolução ANTT nº 6.054/2024 (regulamento PPD em concessões; via ANTTlegis); Portaria MT nº 387/2024 (política nacional, segundo imprensa — não abri o DOU);
  Lei 15.485/2026 (Procargas pode financiar PPD em rodovias não concedidas).

## 2. ARTESP (rodovias estaduais concedidas SP) — CKAN https://dadosabertos.artesp.sp.gov.br (licença CC-BY)
- cadastro-de-ativos / "Recursos Operacionais" recursos.xlsx (3,4 MB, 34.396 ativos com lat/lon):
  Área de Descanso = 10 (todas ativas; RMSP: 1 — Ecovias Imigrantes SP-150 km 40 S. B. do Campo);
  Posto de Atendimento SAU = 166; Base Operacional SAU = 83 (80 ativas); SAU na RMSP = 25; Posto de Pesagem 106 (61 ativos); Balança móvel 43;
  Carregador de veículos 14. -> artesp/artesp_descanso_sau_pesagem.json
- servico-de-atendimento-ao-usuario: só contagem de atendimentos (APH, guincho, socorro mecânico) por rodovia/mês (156.917 linhas em 2026) — sem local.
- malha-rodoviaria: KMZ por concessionária + acessos.
- Falhou: PDF ARTESP 2016 "Relatório Completo áreas e postos" (395 pontos, 12.837 vagas) — URL devolve HTML (link morto).

## 3. ANTT dados abertos (CKAN https://dados.antt.gov.br, CC-BY)
- edificacao-operacional CSV (45 KB, 400 linhas, lat/lon): 375 "Base operacional" (SAU) em rodovias federais concedidas, 20 postos de fiscalização ANTT.
  SP 36; RMSP 5 (Régis Itapecerica km 287 e 298,8; Fernão Dias km 71,8 SP; Dutra km 230,2 SP e km 202 Arujá).
- atendimento-usuario / atendimento-medico-mecanico: estatística, sem localização.
- package_search "descanso", "PPD", "caminhoneiro" = 0 datasets.
- quilometro-principal: CSV vazio (só cabeçalho, 74 bytes) — FALHA; SHP (8,9 MB zip, 299.759 pontos a cada ~20 m, data 05/02/2025) funciona,
  mas BR-116/SP km 177 não aparece (Dutra SP ausente nessa versão?).

## 4. ANP — postos e preços (https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos)
- Cadastro de revendedores varejistas (CSV 7,9 MB): https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos/arquivos/arquivos-dados-cadastrais-dos-revendedores-varejistas-de-combustiveis-automotivos/dados-cadastrais-revendedores-varejistas-combustiveis-automoveis.csv
  45.738 postos (BR) / 8.370 (SP) / 2.700 (RMSP, 39 municípios; capital 1.521). Campos: CNPJ, razão social, endereço, CEP, município, UF, bandeira,
  autorização. SEM coordenadas, SEM lista de produtos (não diz se vende diesel/ARLA). RMSP: 847 bandeira branca, 701 Ipiranga, 560 Vibra, 533 Raízen.
- Levantamento de preços (LPC):
  - Últimas 4 semanas (atualizado 02/10/2026): .../arquivos/shpc/qus/ultimas-4-semanas-diesel-gnv.csv (3,6 MB, 21.264 linhas; coletas 07/09–02/10/2026)
    4.651 postos e 415 municípios no BR; SP 1.282 postos/99 municípios; RMSP 446 postos em 19 dos 39 municípios.
    Diesel S10 RMSP: n=1.170, mín 6,19, mediana 6,99, máx 9,19 R$/l; Diesel comum RMSP mediana 6,59. "Valor de Compra" vazio.
  - Mensais 2026 (dsan/2026/MM-dados-abertos-precos-diesel-gnv.csv), semestrais zip (dsas/ca/ca-2026-01.zip) — nomes de arquivo inconsistentes.
  - Semanal por posto (com nome fantasia): .../precos/arquivos-lpc/2026/revendas_lpc_2026-09-27_2026-10-03.xlsx (1,9 MB): 7.675 revendas,
    3.140 obs. diesel S10 no BR; RMSP 629 revendas, 298 obs. diesel S10.  Resumo por município/estado: resumo_semanal_lpc_2026-09-27_2026-10-03.xlsx
    (abas CAPITAIS, MUNICIPIOS, ESTADOS, REGIOES, BRASIL; preço médio/mín/máx/desvio, nº de postos).
  - 98,5% dos CNPJs do LPC estão no cadastro (4.580/4.651).
- PMQC (qualidade) mensal CSV ~16–24 MB/mês: TEM Latitude/Longitude do posto coletado.
  12 meses (2025-07..2026-09 menos 3 sem link) -> 16.529 CNPJs com coordenada; cobre 35,2% do cadastro BR, 2.952/8.370 SP, 1.208/2.700 RMSP.
  Dispersão entre coletas do mesmo posto: mediana 20 m, p90 52 m. Cobre 1.939 dos 4.651 postos do LPC. -> anp/pmqc_postos_coords.json; script anp/pmqc_coords.py
- Licença: rodapé gov.br diz "CC BY-ND 3.0" para o conteúdo do site; dados abertos federais seguem Decreto 8.777/2016. dados.gov.br API -> 401 (exige chave).
  CONFIRMAR licença dos conjuntos no catálogo antes de redistribuir.
- Falhou: postos.anp.gov.br e precos.anp.gov.br -> sem resposta (curl 000).

## 5. Petrobras — composição do preço do diesel
- https://precos.petrobras.com.br/precos-diesel (200): diesel S-10 média BR R$ 7,35 (coleta 27/09–03/10/2026): Petrobras R$ 2,83 (38,5%),
  distribuição+revenda R$ 2,22 (30,2%), biodiesel R$ 0,81 (11,0%; mistura 15%), imposto estadual R$ 1,17 (15,9%), federais R$ 0,32 (4,4%).
  Página HTML, sem CSV; uso comercial não declarado (site corporativo).

## 6. OSM (PBF local sudeste 08/10/2026, osmium 1.15; Overpass deu 504/500 em 3 instâncias)
- RMSP (relação 2661855): amenity=fuel 2.389 (2.140 como área) vs ANP 2.700 (88%). Com fuel:diesel 317 (13%); fuel:HGV_diesel=yes 6; fuel:adblue 0;
  hgv em posto 1; brand 1.761; opening_hours 151; ref:vatin (CNPJ) 0. highway=rest_area 38, services 721; amenity=truck_stop 0;
  estacionamento p/ caminhão (hgv=designated|yes, parking=truck ou nome) 8 (1 com capacity).
- SP estado (rel 298204): fuel 6.270 vs ANP 8.370 (75%); fuel:diesel 714; HGV_diesel 15; adblue 15; truck parking 15; rest_area 136; services 1.424.
- Conflação ANP×OSM: dos 1.208 postos RMSP com coord PMQC, 964 (80%) têm amenity=fuel OSM a ≤100 m (68% a ≤30 m).
- Nomes de redes no OSM-SP: Graal 20 fuel + 22 services; Frango Assado 9 + 9; Castelo 8; "caminhoneiro" 4.
- Brasil: brazil-latest.osm.pbf = 2.092.268.525 bytes (HEAD, 08/10/2026) — não baixado. Overpass BR falhou (504).

## 7. Geocodificação
- CNEFE 2022 IBGE por município (zip CSV com LATITUDE/LONGITUDE por endereço): https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio/35_SP/
  São Paulo capital = 185.731.999 bytes (HEAD). Teste Guararema (18.385 endereços): CEP+número é ENGANOSO (CEP único 08900-000 casa endereço errado);
  logradouro+número acertou 3/8 postos; postos em rodovia "S/N" não geocodificam. PMQC+CNEFE juntos: 7/8.

## 8. Redes privadas (Graal, Frango Assado, Rodoposto, Rede SIM, Siga Bem, Ipiranga, Shell)
- graal.com.br: falha TLS no www (Shopify) / 301 no domínio raiz; frangoassado.com.br, rodoposto.com.br, sigabem.com.br: DNS não resolve;
  redesim.com.br é outra entidade (igreja); shell.com.br localizador 404; postoipiranga.com.br redireciona p/ google.com; br.com.br -> vibraenergia.com.br.
  Nenhuma lista aberta/licenciada; uso exige parceria. Alternativa: tags name/brand no OSM e CNPJ no cadastro ANP.

## 9. Preços em tempo quase-real por NFC-e (outros estados)
- Economiza Alagoas API: http://api.sefaz.al.gov.br/sfz-economiza-alagoas-api/api/public/combustivel/pesquisa -> 500 "Acesso negado" (exige token/cadastro).
- Menor Preço (Nota Paraná) https://menorpreco.notaparana.pr.gov.br/ -> 200 (SPA, não testei API). Preço da Hora BA https://precodahora.ba.gov.br/ -> 200.
- SP: não encontrei fonte equivalente (busca na web esgotou a cota).

## 10. Legislação (textos salvos em legis/)
- CTB art. 67-C (planalto l9503compilado): máx. 5h30 ininterruptas; carga: 30 min dentro de cada 6h, fracionável (sem passar 5h30 contínuas);
  §3 11h de descanso em 24h; §6 só inicia viagem após descanso integral; §8 (Lei 14.599/2023) Contran define exceção por falta de PPD/vagas;
  §9 (Lei 14.440/2022) poder público publica lista de PPD com nº de vagas; 67-E §1º-A sem penalidade na exceção do §8; §2 controle por tacógrafo,
  diário de bordo, papeleta ou meio eletrônico. Art. 230 XXIII: infração média + retenção do veículo para cumprir o descanso.
- CLT 235-C: jornada 8h + até 2h extras (até 4h por convenção/acordo coletivo); 1h refeição (pode coincidir com parada do CTB).
- STF ADI 5322 (julg. 03/07/2023; ata 12/07/2023; embargos 14/10/2024 com efeito ex nunc desde 12/07/2023; trânsito em julgado 08/11/2024):
  inconstitucional o fracionamento das 11h (CLT 235-C §3 parte final e CTB 67-C §3 "que podem ser fracionadas, usufruídas no veículo e coincidir...").
  Fonte: documento TRT3 legis/trt3_adi5322.pdf.
- Lei 13.103 art. 12: os limites de jornada/direção passam a valer por trecho conforme a relação publicada (art. 11); 180 dias educativos.

## 11. Arquivo combinado
- descanso_candidatos_brasil.geojson: 826 pontos (621 SAU, 183 PPD certificados, 12 PPD concessão c/ coord., 10 áreas de descanso ARTESP);
  RMSP: 32 (30 SAU, 1 PPD Batistella, 1 área de descanso Ecovias).
