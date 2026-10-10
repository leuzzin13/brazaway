# Segurança fora de SP (RJ, MG, ES): acidentes e roubo de carga com coordenadas — pesquisa de 10/10/2026

Reaproveitado de docs/research/seguranca_acidentes_roubo (não retestado): PRF DATATRAN (já importada para o Brasil todo pela
camada `acidentes`), ANTT (só km), Sinesp VDE (só UF), ISP-RJ BaseDPEvolucaoMensalCisp (URL), Fogo Cruzado (só doc),
metadados do RENAEST. Aqui só testei o que era novo ou o que o tema anterior deixou em aberto (RENAEST fora de SP).
Volume final de dados nesta pasta: ~16 MB (os brutos grandes foram lidos em streaming ou apagados depois da análise).

## Resumo por UF: o que tem ponto e o que é agregado
| UF | Acidentes com ponto | Roubo de carga |
|----|---------------------|----------------|
| MG | SIM: REDS/SEJUSP, por ocorrência, com e sem vítima, lat/lon em 99%, tipo de veículo por tabela ligada, hora, logradouro | NÃO: microdados por REDS (hora, local, bairro, município), sem coordenada |
| RJ | NÃO (só PRF nas BRs). RENAEST-RJ não tem coordenada (0% até 2025) nem tipo de veículo | NÃO: só por CISP/mês (ISP), com polígonos de CISP públicos |
| ES | Fraco: RENAEST-ES com 50% de coordenada em 2025, mas só 37 de 1.544 acidentes com caminhão têm ponto. PRF cobre BR-101/262 | Irrelevante: 7 roubos de carga em 2025 (Sinesp) |

## 1. MG — SEJUSP "Painel de Sinistro de Trânsito" (REDS) — TESTADO OK (melhor achado)
- Página: https://www.seguranca.mg.gov.br/index.php/component/sppagebuilder/page/289 ("Acesse a Base de Dados do Painel").
- Pasta Google Drive pública 1W_4SsAW8u5bvsaBoHhwInpUr72vES8yw, listável sem login por
  https://drive.google.com/embeddedfolderview?id=<pasta>. Subpastas: Ocorrências, Veículo, Vítimas, Via, Condicoes;
  um CSV por ano, 2012 a "Jan a Ago 2026" (atualizado 15/09/2026). Download: drive.usercontent.google.com/download?id=<ID>&export=download&confirm=t
  - Registros 2025: ID 1KI90qtnejfpJXK2euTTFpFnJH8segtRb (103 MB, 312.700 ocorrências: 241.580 sem vítima, 71.120 com vítima)
  - Veículos 2025: ID 1s5DsZqHiZ9_gcqoKrJhnZj8zICmnD6lT (21 MB, 551.161 linhas)
  - Registros Jan-Ago 2026: 15TYzFOkD9PGvQc6G-mufUUUsntR7upAM (70,7 MB); Veículos 2026: 17DF23PMml1z6Uizjt2qXOqSjoIdHCz6U (14,3 MB)
- Colunas (registros): numero_ocorrencia_associado (hash), natureza_descricao, data_fato, horario_fato, Faixa_1/6_Horas_Fato,
  motivo_presumido_descricao, local_imediato, tipo_logradouro_descricao, logradouro_nome, nome_bairro, nome_municipio, codigo_municipio,
  risp, rmbh, unidade_responsavel_registro_nome, latitude_sirgas2000, longitude_sirgas2000 (decimal com vírgula).
- Veículos: numero_ocorrencia_associado + tipo_veiculo_descricao_longa (CAMINHAO 29.242, CAMINHAO/TRATOR 8.722, SEMI-REBOQUE 3.731, REBOQUE 1.369 em 2025).
- 2025: 36.074 ocorrências com caminhão (11,5%), 98,1% com coordenada; 3.825 com vítima; 436 com vítima fatal (495 óbitos, juntando com a base de vítimas).
  Tipo de logradouro: RUA 12.043, RODOVIA 11.253, AVENIDA 10.160. Logradouros: BR 381 (1.583), ANEL RODOVIARIO (1.308), BR 040 (935),
  Cristiano Machado (689), MG 050 (428), Via Expressa de Contagem (392). Faixa: 12-18h 43%, 6-12h 36%, 18-24h 16%, 0-6h 4,5%.
- Delegacia Virtual registra 15.780 dos 36.074 (44%), quase todos sem vítima; 21% deles caem em coordenadas repetidas 5+ vezes
  (ponto "padrão" do logradouro). O manual do painel avisa que as coordenadas do REDS vêm de SAD-69 e são aproximadas.
- Divisão por jurisdição (igual à do Infosiga): 6.569 casos com caminhão com logradouro BR/Anel e mais 1.948 em células (±1) onde a PRF
  tem acidente com caminhão. Sobram 26.868 (3.156 com vítima, 374 óbitos) em 2.013 células de 250 m com ≥3 casos (1 ano só).
  Arquivos: mg/sinistro/simulacao_celulas_caminhao_mg_2025.csv, hotspots_caminhao_mg_2025_grid250_semBR.csv, amostra_reds_acidente_caminhao_2025.csv
- Comparação: PRF 2025 em MG tem 3.142 acidentes com caminhão nas BRs; o REDS tem 6.569 com logradouro de BR (inclui sem vítima registrados pela PM/Delegacia Virtual).
- RENAEST-MG (streaming do zip 05-2026) = o mesmo REDS: 312.061 em 2025, 98,8% com coordenada, 35.915 com caminhão. Redundante.
- Base resumida de vítimas também está no CKAN: https://dados.mg.gov.br/dataset/sejusp_vitimas_acidentes_transito (por vítima,
  lat/lon 98,9%, sem tipo de veículo nem hora). Licença no CKAN: vazia.
- Licença: nenhuma no CKAN nem nos arquivos. Decreto MG 48.383/2022, art. 22: dados de transparência ativa "são de livre utilização
  pela sociedade" (texto conferido em https://www.almg.gov.br/legislacao-mineira/texto/DEC/48383/2022/). Atribuir SEJUSP/REDS.

## 2. MG — SEJUSP roubo de carga e roubo de caminhão — TESTADO OK, SEM COORDENADA
- Dados agrupados (município x mês x alvo): https://www.seguranca.mg.gov.br/images/0_planilhas-e-pdfs/transparencia/dados_abertos/Setembro%202026/Banco%20Alvos%20de%20Roubo%202021%20a%202026%20-%20Atualizado%20Agosto%202026.csv (37 MB)
- Base completa por REDS no Drive (pasta 1CjziaHx_ehpY6XozeV5FIR-zoCfCjh8k): "Alvo - Roubo Consumado - Jan 2015 a Ago 2026.csv" (ID 1zDmcqFeiQJ80Na4l7TrULDV7xl-y2H2u, 197 MB,
  635.714 linhas): data, hora, faixa, alvo (Cargas), meio, local imediato, tipo de logradouro, bairro, município. SEM lat/lon e SEM nome do logradouro.
- Roubo de carga (alvo "Cargas"): 662 (2015) → 217 (2024) → 132 (2025) → 59 (jan-ago 2026). 132 bate com o Sinesp VDE 2025 (MG 132).
  2025-26 (191): RODOVIA 104 (54%), madrugada 0-6h 44%, arma de fogo 65%, posto de combustível 9. Municípios: Contagem 25, BH 24, Betim 16,
  Extrema 6, Cachoeira de Pajeú 6 (BR-116), Santa Cruz de Salinas 5, Salinas 5, Caeté 5 (BR-381).
- Veículos roubados (ID 1M2mDDct3VQbwLjixls4TL9I0p3SewMbN, 40 MB): 2025 com CAMINHAO 154, CAMINHAO/TRATOR 54, SEMI-REBOQUE 65, REBOQUE 24. Sem coordenada.
  Extrato: mg/roubo_veic_caminhao_mg_2023_2026.csv; mg/roubo_cargas_mg_2015_2026.csv

## 3. RJ — ISP — TESTADO OK, SÓ AGREGADO POR CISP
- Microdados georreferenciados NÃO são públicos. Portaria ISP nº 127/2022 (DOERJ, cópia em http://arquivo.proderj.rj.gov.br/isp_imagens/Uploads/PortariaISP127_Fornecimento_Microdados.pdf):
  art. 2º §2º — a "base_pública" sob pedido desagrega no máximo até CISP, AISP, RISP, bairro e município; art. 3º §1º — o que for
  fornecido sob pedido "não poderá ser comercializado em nenhuma hipótese" e não pode ser repassado a terceiros. ISPGeo é de uso policial (não confirmado em fonte primária).
- Público e testado: polígonos das 137 CISPs (https://www.ispdados.rj.gov.br/Arquivos/CISPshp.rar, 2,3 MB, WGS84, campos cisp, aisp, areakm2; last-modified 14/08/2026)
  e série mensal por CISP (BaseDPEvolucaoMensalCisp.csv, já testada no tema anterior; até 08/2026).
- roubo_carga 2025 = 3.113 (Sinesp: 3.777). 87 CISPs com ≥1; 37 com ≥12/ano; 17 com ≥50. Top 2025: CISP 59 Duque de Caxias Centro 402 (40,8 km²),
  60 Campos Elyseos 287 (100 km²), 64 São João de Meriti 212, 21 Bonsucesso/Maré 194 (14,8 km²), 39 Pavuna 165, 38 Cordovil/Vigário Geral 157.
  Top 10 CISPs = 61% de 2025-26. Por município 2025: Rio 1.496, Duque de Caxias 786, São Gonçalo 223, S. J. de Meriti 212.
  Sem horário, sem tipo de local. Extrato: isp/extrato_cisp_mensal_2024_2026.csv
- Acidentes RJ: ISP só tem hom_culposo/lesão culposa por CISP (2.375 homicídios culposos em 2025 = número do boletim do Detran-RJ, que
  usa ISP e Bombeiros; https://www.detran.rj.gov.br/images/transparencia/outros/boletim_estatistico_transito_transito_em_numeros_2025.pdf).
  RENAEST-RJ: 16-22 mil acidentes/ano, coordenada 0% até 2025 (2.055 de 9.502 em 2026), nenhum com tipo caminhão.
- data.rio: só tabelas agregadas (ISP). COR "ocorrências" (datario.adm_cor_comando.ocorrencias) só via BigQuery, licença CC BY-ND 3.0;
  api.dados.rio respondeu 503 em 10/10/2026. Não confirmei colunas.

## 4. ES — TESTADO
- dados.es.gov.br (CKAN): SESP com 42 conjuntos (CC-BY), nenhum de roubo de carga. "roubo-veiculo" (2023-2025, 6.239 BOs, por BO com
  data, hora, município, bairro, logradouro, tipo de local, tipo de veículo; SEM coordenada): 77 caminhões/carretas em 3 anos.
- DETRAN-ES (CC0 no CKAN): só agregados de 2024 (53.446 sinistros: 39.609 sem vítima, 12.924 com vítimas, 919 fatais). Observatório de
  Trânsito em SAS Visual Analytics (https://analytics-detran.sides.es.gov.br/observatorio-transito), sem download.
- RENAEST-ES: 43.110 acidentes em 2025, 50% com coordenada, mas com caminhão só 37/1.544 com ponto (2023: 930/1.720). Extrato: renaest/renaest_caminhao_es_2023_2026.csv
- Sinesp VDE 2025: roubo de carga ES = 7.

## 5. BH e Rio (municipais)
- BHTrans (dados.pbh.gov.br): "ocorrencia-sinistro-transito-com-vitima" (CC-BY, mensal, pontos EPSG:31983, 132.935 de 2016 a 22/08/2026, sem tipo de veículo)
  e si-bol/si-veic anuais até 2024 (ODbL; 484 boletins com caminhão em 2024, 95% com coordenada). Redundante com o REDS (BH = 7.176 ocorrências
  com caminhão no REDS 2025, inclusive sem vítima). Atenção: ODbL é share-alike.
- Juiz de Fora (sisurb.pjf.mg.gov.br MapServer/69, achado em busca): serviço respondeu "not found" (404) em 10/10/2026.

## 6. PRF 2025 (reprocessado só para contar RJ/MG/ES; fonte já integrada)
- Acidentes com caminhão: RJ 1.115 de 6.428 (40 mortos), MG 3.142 de 9.570 (110 mortos), ES 631 de 2.642 (27 mortos).
  BRs: RJ 116/101/040/393/493; MG 381/040/116/262/365; ES 101/262/259.

## Scripts
- renaest/renaest_stream.py: lê o zip do RENAEST (529 MB) por HTTP Range e descompacta em streaming, com reconexão (o servidor corta a conexão 2x).
