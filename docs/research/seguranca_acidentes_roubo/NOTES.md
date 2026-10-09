# Segurança: acidentes com caminhões e roubo de carga (pesquisa de 09/10/2026)

Pasta: esta. Scripts: prf_an.py, infosiga_an.py, infosiga_hot.py, ssp_parse.py, ssp_an.py, antt_an.py, zip_peek*.py (leitura parcial de zip por HTTP Range).
Venv local: .venv (pandas, openpyxl, pypdf). RMSP = 39 municípios (rmsp.py / rmsp_ibge.json, códigos IBGE tirados do Infosiga).

Volume baixado: ~385 MB (acima do limite de ~300 MB, porque a base do Infosiga tem 147 MB e o arquivo da SSP tem 126 MB). Arquivos maiores
(RENAEST, de 522 MB; SSP VeiculosSubtraidos, de 40 MB; ObjetosSubtraidos, de 487 MB; SUSEP AUTOSEG, de 535 MB) foram medidos só por HEAD ou Range.

## 1. PRF – Boletins de Acidente de Trânsito (rodovias federais) – TESTADO OK
- Página: https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf (modificada em 28/07/2026, atualização "Mensal").
- Arquivos no Google Drive. Para baixar sem a página de confirmação, use `https://drive.usercontent.google.com/download?id=<ID>&export=download&confirm=t`.
  - 2025 por ocorrência: ID 1-G3MdmHBt6CprDwcW99xxC4BZ2DU5ryR (zip de 3,7 MB → datatran2025.csv, com 72.529 ocorrências)
  - 2025 por pessoa, com todas as causas e tipos: ID 1-PJGRbfSe7PVjU37A3wTCls_NRXyVGRD (13 MB → 584.010 linhas; tem tipo_veiculo, marca e ano)
  - 2026 (até 31/08/2026): ocorrências 1A3IirNm0AzRaSosA1IS94DOVmvKsn0Ol; todas as causas 1EsGox0UnBWSaM6mrkNSUlYUOecubLCsh
- Formato: CSV com `;`, latin1, decimal com vírgula. Campos: id, data_inversa, horario, uf, br, km, municipio, causa_acidente, tipo_acidente,
  classificacao, fase_dia, sentido_via, tracado_via, mortos, feridos_*, latitude, longitude, delegacia, uop. Todas as linhas de 2025 têm lat/lon.
- Caminhão = tipo_veiculo em {Caminhão, Caminhão-trator, Semireboque, Reboque}.
- Resultados em 2025: no Brasil, 19.026 de 72.529 ocorrências envolvem caminhão (26,2%), mas respondem por 2.836 de 6.043 mortos (46,9%).
  Em SP, 1.184 ocorrências e 103 de 221 mortos. Na RMSP, 358 ocorrências e 32 de 79 mortos. Na RMSP só aparecem a BR-116 (Dutra e Régis, 283 casos) e a BR-381 (Fernão Dias, 75).
  Trechos com mais casos: BR-116 km 219 (Guarulhos), com 14 casos e 3 mortos; km 282 (Embu), com 9 casos e 3 mortos.
  Causas nacionais com caminhão: "Condutor Dormindo" aparece em 829 casos (ligado ao recurso de descanso da Lei 13.103) e "Demais falhas mecânicas" em 1.264.
- Licença: a página define os dados abertos como "sem restrição de licenças" (uso, reuso e redistribuição livres). O rodapé do site diz que o
  conteúdo do site está em CC BY-ND 3.0. Interpretação adotada: os dados são livres para uso comercial, com atribuição por boa prática.
- Saídas: prf/analise_prf.txt, prf/amostra_prf_rmsp_2025.csv

## 2. Infosiga SP (Detran-SP) – TESTADO OK (é a melhor fonte para a RMSP)
- Site: https://infosiga.detran.sp.gov.br/ (SPA). O endpoint `GET /painel/dadosAbertos` devolve os links:
  - https://infosiga.detran.sp.gov.br/painel/download/file/dados_infosiga.zip (146,7 MB, baixado em 1,9 s; arquivos de 16/09/2026)
    contém pessoas_, sinistros_ e veiculos_ para 2015-2021, 2022-2024 e 2025-2026 (929 MB descompactado).
  - .../Infosiga_dicionario_dados.zip (dicionários v1.7), .../Infosiga_diagrama_ER.pdf, .../Infosiga_fluxograma_consolidacao.pdf
  - `GET /painel/minMaxDates` → {"min": 20150101, "max": 20260831}
- sinistros: id_sinistro, tipo_registro (SINISTRO FATAL / NAO FATAL / NOTIFICACAO), data e hora, logradouro, tipo_via, latitude/longitude (WGS84),
  cod_ibge, administracao (PREFEITURA, CONCESSIONÁRIA, DER, DNIT), qtd_caminhao, qtd_motocicleta e outras contagens, e gravidade.
- Período 2025-01 a 2026-08: 303.196 sinistros no estado, dos quais 120.638 na RMSP. Coordenadas aparecem em 62% do total, em 89-91% dos casos
  fatais e não fatais e em 25% das notificações.
  Na RMSP há 3.248 casos com caminhão (384 fatais, 411 óbitos, 91,6% com coordenada). Eles somam 411 dos 3.480 óbitos da RMSP (11,8%).
  Entre os 411 óbitos: 224 motociclistas (54%), 60 em automóvel, 47 ocupantes de caminhão, 10 ciclistas e 65 pedestres (contados por tipo_de_vitima).
  1.461 dos 3.248 casos com caminhão também envolvem moto (45%).
  Vias com mais casos: BR 116 (329), SP 021 Rodoanel (188), SP 280 Castello (96), BR 381 (89), Marginal Tietê (71), SP 150 (68), Marginal Pinheiros (57).
- Hotspots de 2022 a 2026/08 (grade de ~500 m): 9.401 casos com caminhão com coordenada válida. Há 460 células com 5 casos ou mais e 124 com 10 ou mais.
  A célula com mais casos fica no Rodoanel, perto de -23.439/-46.769, com 55 casos. Arquivo: infosiga/hotspots_caminhao_rmsp_grid500m_2022_2026.csv
- Limitação: o Infosiga registra só ocorrências com vítima, mais notificações sem BO. Colisões só com dano material ficam de fora.
- Licença: o site não nomeia licença. O Guia de Referência define "dados abertos" como uso, reuso e redistribuição livres, sujeitos no máximo a
  atribuição e à "manutenção dos mesmos termos de abertura" (cláusula parecida com share-alike). As Perguntas Frequentes trazem um formato de
  citação: "DEPARTAMENTO ESTADUAL DE TRÂNSITO DE SÃO PAULO (Detran-SP). Infosiga: Dados abertos...".
- GitHub do órgão: https://github.com/Detran-SP (repositórios de análise com licença GPL-3.0).

## 3. SSP-SP – microdados de BO (roubo e furto de carga com coordenadas) – TESTADO OK
- O portal antigo http://www.ssp.sp.gov.br/transparenciassp/Consultas.aspx hoje só tem o registro de óbitos do IML.
- O portal novo (Angular) lista os arquivos em https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados160_516.json
  - https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/SPDadosCriminais_{2022..2026}.xlsx
    (2026: 126 MB, last-modified 08/10/2026. Os demais anos têm entre 195 e 218 MB.)
  - Abas: "Campos da Tabela_SPDADOS", "JAN-JUN_2026" e "JUL-DEZ_2026", com 732.808 linhas.
  - Colunas: NOME_DEPARTAMENTO, NOME_SECCIONAL, NOME_DELEGACIA, NOME_MUNICIPIO, NUM_BO, ANO_BO, DATA_REGISTRO, DATA_OCORRENCIA_BO,
    HORA_OCORRENCIA_BO (fração de dia do Excel), DESC_PERIODO, DESCR_TIPOLOCAL, DESCR_SUBTIPOLOCAL, BAIRRO, LOGRADOURO, NUMERO_LOGRADOURO,
    LATITUDE, LONGITUDE, ..., RUBRICA, DESCR_CONDUTA, NATUREZA_APURADA, MES_ESTATISTICA, ANO_ESTATISTICA, CMD, BTL, CIA, COD IBGE
  - O parser em streaming (ssp_parse.py, com iterparse e sharedStrings) leva cerca de 45 s.
- ROUBO DE CARGA de jan a ago/2026: 1.638 BOs. É exatamente o número oficial do estado na API mensal, o que confirma a integridade da base.
  FURTO DE CARGA: 289. Coordenadas preenchidas em 99%.
  RMSP (pelos códigos IBGE): 1.380 de 1.638 (84%). Capital: 831.
  Local: 1.460 em "Via Pública", 101 em "Rodovia/Estrada", 68 em acostamento e 28 em posto de gasolina.
  Horário (91% preenchido): 67% entre 6h e 13h, com pico às 9h (171 casos).
  Logradouros na RMSP: Marginal Pinheiros (21), Fernão Dias (17), Dutra (16), Anhanguera (10), Régis (9), Ayrton Senna (8), Rodoanel (7)...
  Grade de ~1 km: 668 células, 61 delas com 5 ou mais casos. Arquivo: ssp/hotspots_roubo_carga_rmsp_grid1km_2026.csv
  Alguns registros vêm com "VEDAÇÃO DA DIVULGAÇÃO DOS DADOS RELATIVOS" no lugar do endereço.
- API de estatísticas mensais (sem autenticação):
  `GET https://www.ssp.sp.gov.br/v1/OcorrenciasMensais/RecuperaDadosMensaisAgrupados?ano=2025&grupoDelito=6&tipoGrupo=ESTADO&idGrupo=0`
  Com tipoGrupo=REGIÃO (url-encoded) e idGrupo 1 = Capital ou 2 = Grande SP sem a Capital. Também tem MUNICÍPIO e DISTRITO.
  Regiões: `GET /v1/Regioes/RecuperaRegioes`. Municípios: `/v1/Municipios/RecuperaMunicipios`.
  ROUBO DE CARGA no estado: 6.063 (2023), 4.711 (2024), 3.470 (2025) e 1.638 (jan-ago/2026).
  Capital: 2.819, 2.257, 1.720 e 832. Grande SP sem a Capital: 1.757, 1.395, 1.161 e 548. Em 2025 a RMSP teve 2.881 de 3.470 (83%).
- Outros arquivos (lidos só por Range, sem download completo):
  - .../transparencia/baseDados/veiculosSub/VeiculosSubtraidos_2026.xlsx (39,6 MB) traz DESCR_TIPO_VEICULO (por exemplo "Caminhão trator"),
    DESCR_OCORRENCIA_VEICULO (Roubado, Furtado, Localizado), LATITUDE e LONGITUDE. Também traz PLACA_VEICULO, um dado sensível para a LGPD.
  - ObjetosSubtraidos_2025.xlsx tem 487 MB e não foi baixado.
- SP CARGA (Resolução SSP nº 30, de 11/05/2023) só existe como painel Power BI, sem download:
  https://app.powerbi.com/view?r=eyJrIjoiZTg2YzY5YzktN2RiZC00OTY3LWE5OGMtNWZiY2Y3ZDEzNmE0IiwidCI6IjNhNzhiMGNkLTdjOGUtNDkyOS04M2Q1LTE5MGE2Y2MwMTM2NSJ9
  (o endereço vem de https://www.ssp.sp.gov.br/assets/config/enderecos.json)
- Licença: nenhuma licença explícita nos arquivos. O Plano de Dados Abertos da SSP (2025-2027, https://www.ssp.sp.gov.br/assets/download/Dados_Abertos.pdf)
  cita o Decreto 68.769/2024 e a Resolução CGE 14/2024 e fala em "formatos abertos e reutilizáveis". Para uso comercial convém confirmar via SIC.

## 4. ARTESP – acidentes nas rodovias estaduais concedidas – TESTADO OK
- CKAN: https://dadosabertos.artesp.sp.gov.br/api/3/action/package_show?id=acidentes (licença "Creative Commons Attribution")
- Há um CSV por ano, de 2001 a 2026. 2025: .../resource/c9db7f71-2a17-4aac-a3d0-49883e61f776/download/acidentes_2025.csv (10 MB, 44.134 linhas)
- Colunas: DATA, HORA, CONCESSIONARIA, RODOVIA, KM, SENTIDO, LATITUDE, LONGITUDE (100% preenchidas), CLASSE, SUBCLASSE, CAUSA_PROVAVEL, VITIMA_*,
  VEICULOS_ENVOLVIDOS (por exemplo "AUTOMÓVEL=1"), MUNICIPIO, ... Inclui acidentes sem vítima.
- 2025: 11.068 acidentes com CAMINHÃO, CARRETA, REBOQUE ou SEMI (25,1%), com 442 de 1.270 mortes (34,8%).
  Na RMSP, 2.446 com caminhão. Por rodovia: Rodoanel SP021 (870), SP280 (380), SP070 (202), SP270 (185), SP150 (175).
- Outros conjuntos úteis: "ocorrencias" (panes veiculares, de 82 MB/ano; alagamento, erosão e queda de talude), "malha-rodoviaria"
  (KMZ por concessionária, útil para georreferenciar km) e "registro-de-mensagens-em-paineis" (mensagens dos PMVs, de 49 a 118 MB/ano).

## 5. ANTT – acidentes nas rodovias federais concedidas – TESTADO OK (km sem coordenada)
- CKAN: https://dados.antt.gov.br/api/3/action/package_search?q=acidente. Conjuntos "acidentes-rodovias" (46 recursos) e
  "acidentes-quilometro-rodovias", ambos com licença "Creative Commons Atribuição".
- Concessões na RMSP:
  - RIOSP (BR-116 Dutra), de 2022-03 a 2026-08: demostrativo_acidentes_riosp.csv (5,1 MB)
  - AUTOPISTA REGIS BITTENCOURT, de 2010 a 2026-08: demostrativo_acidentes_arb.csv (12,3 MB)
  - AUTOPISTA FERNÃO DIAS só vai até 2023-12. A partir de 2024 a BR-381/SP está no arquivo "MOTIVA MINAS SP" (motiva_minassp.csv, de 2024-01 a 2026-08).
- Colunas: data, horario, tipo_de_ocorrencia, km, trecho, sentido, tipo_de_acidente, contagens (automovel, caminhao, moto, ...), vítimas e mortos.
  Não há lat/lon, então é preciso fazer referenciamento linear pelo km.
- 2025: RIOSP teve 8.199 ocorrências (1.539 com caminhão, 40 mortos com caminhão). ARB teve 5.757 (1.028 com caminhão). Os dois arquivos incluem casos "Sem vítima".
- Bônus: "area-escape" (áreas de escape) tem só 4 registros com lat/lon, um deles na BR-116/SP km 353 (Miracatu).

## 6. GeoSampa – camada geoportal:acidente_cet – TESTADO, DESATUALIZADA
- WFS: typeNames=geoportal:acidente_cet. São 5.716 pontos, de 2021-02-28 a 2022-02-28 (dt_carga 2026-01-15). Campos: qt_caminhao, qt_fatal etc.
  Há 270 casos com caminhão. Por ter só 1 ano e estar velha, não vale como fonte principal.
- Também existem as camadas delegacia_policia_civil, batalhao_policia_militar, companhia_policia_militar, equipamento_policia_* e iluminacao_publica.

## 7. RENAEST (SENATRAN) – nacional – TESTADO PARCIAL (só por Range)
- CKAN: https://dados.transportes.gov.br/api/3/action/package_show?id=42e2320b-ea67-4fdc-896f-71363e043fc6 (licença "Other (Public Domain)")
- O zip mensal mais recente é "04-2026": .../ff1cfdec-.../download/renaest_dabertos_20260813.zip (522 MB). Contém Acidentes (2,7 GB descompactado),
  Localidade, TipoVeiculo e Vitimas.
  Acidentes tem latitude_acidente e longitude_acidente, mas as primeiras linhas (AC, 2018) vêm vazias. A taxa de preenchimento para SP não foi medida.

## 8. Sinesp VDE (MJSP) – nacional por UF – TESTADO OK
- https://www.gov.br/mj/pt-br/assuntos/sua-seguranca/seguranca-publica/estatistica/download/dnsp-base-de-dados/bancovde-2025.xlsx/@@download/file (26,6 MB)
- O evento "Roubo de carga" vem por UF e mês. O campo município é "NÃO INFORMADO".
  Em 2025 o Brasil teve 8.565 casos: RJ 3.777, SP 3.470, PE 296, BA 209, PR 141. RJ e SP juntos somam 84,6%.

## 9. ISP-RJ – TESTADO OK
- https://www.ispdados.rj.gov.br/Arquivos/BaseDPEvolucaoMensalCisp.csv (7,2 MB). Traz roubo_carga por CISP e mês, sem coordenada.
  Somas: 2025 = 3.113 e 2026 (parcial) = 2.035. O valor de 2025 é diferente do Sinesp (3.777) por diferença de metodologia.

## 10. Outras fontes
- DATASUS SIM (FTP): ftp://ftp.datasus.gov.br/dissemin/publicos/SIM/CID10/DORES/DOSP2024.dbc (29 MB, formato .dbc). A listagem foi testada.
  Seriam úteis os óbitos de ocupantes de caminhão (CID V60–V69), mas sem coordenada. Não foi baixado.
- SUSEP AUTOSEG: o arquivo bulk mais recente é Autoseg2021A.zip (535 MB). 2024B e 2025A dão 404. Fonte velha e grande.
- OSM local (RMSP): hazard=* em 47 nós e 85 vias; amenity=police em 365, 422 e 27; highway=speed_camera em 1.594; enforcement em 94; parking com hgv em 7. Cobertura irrisória.
- Fogo Cruzado API (https://api.fogocruzado.org.br/) cobre RJ, PE, BA e PA, não SP, e exige autorização.
- Pesquisa CNT de Rodovias (https://pesquisarodovias.cnt.org.br/): SPA, sem download bulk confirmado.
- NTC&Logística (https://www.portalntc.org.br/): nenhuma página de estatística de roubo de carga foi encontrada na home.
- Waze for Cities (https://www.waze.com/wazeforcities): exige parceria, não é dado aberto.
- dados.prefeitura.sp.gov.br (CKAN): nenhum conjunto de sinistros encontrado. Há "fiscalizacao-eletronica-do-transito" e "cadastro-de-lombadas".
- dados.gov.br API: HTTP 401 (exige token).
