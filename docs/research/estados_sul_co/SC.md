# Santa Catarina (SC): fontes oficiais para caminhão (pesquisa de 18/10/2026)

Detalhe completo em `SC.json`. Amostras em `fontes/SC/` (2 MB no total).

## Verificação cética (18/10/2026)

Segunda passada, reabrindo as fontes. Cada tema do `SC.json` tem o campo `verificado_em_2026-10-18`.

- **Confirmado**: as 4 rotas de AET (229 trechos, idênticos ao GeoSIE ao vivo), a malha estadual (624 trechos, 6.333,3 km), os 3 avisos SOS, os acidentes (5.544 hoje, 0 sem coordenada), as 11 praças da ANTT (CC-BY), 13 roubos de carga em SC no Sinesp 2025, o boletim SSP de jul/2026, as taxas e regras da página AET da SIE.
- **Corrigido**:
  - Feriados: a norma vigente é a **Lei 18.531/2022** (alterada até a Lei 20.053/2026). As Leis 10.306/1996, 11.213/1999, 12.906/2004 e 13.408/2005 constam na ALESC como consolidadas e revogadas (Leis 16.719/2015 e 17.335/2017).
  - PL 23/2026: lido no e-Legis, está parado na CCJ desde 05/02/2026 e não é lei.
  - Produtos perigosos: LAC é "Licença por **Adesão** e Compromisso". O ato é a **IN IMA 77** (licenciamento, não restrição de trecho). A cifra "~50 operações/ano" não está na página citada e foi removida.
  - Pedágio: a concessão federal do Oeste só tem audiência pública aprovada em 07/05/2026 (Lote 1: BR-153/282/470; Lote 3: BR-153/282/480). O leilão "nov/2026" não foi confirmado.
  - Travessias urbanas: 1 feição duplicada (SC-482 km 54,318-57,866), 432 únicas e 1.139,4 km.
  - Taxas da AET: faltavam as de CTV/CTVP (R$ 68,21 / 99,21 / 37,20 de 2ª via).
  - Resolução SIE 001/2021: o PDF foi lido (DOE-SC 21.440, 20/01/2021) e a tabela bate com a camada.
- **Não confirmado**: IN SIE 007/2021 (texto não achado), vigência dos atos CONTRAN no próprio CONTRAN, notícias NSC sobre a serra do Rio do Rastro, hgv/OSM (Overpass fora do ar pelo proxy), DEINFRA, TRT12, DNIT WFS e FECAM (inacessíveis).
- **pronto_para_importar**: mantido `true` só em rodovias estaduais, feriados estaduais (efeito nulo em dia útil) e acidentes. A licença dos dados do GeoSIE segue **não declarada** (dado público estadual, Lei 12.527/2011); registrar assim.

## Como ler este resultado

- O site do DEINFRA (`www.deinfra.sc.gov.br`) não abre pelo proxy deste ambiente (reset de conexão / DNS). Hoje o DEINFRA opera sob a **SIE** (Secretaria de Estado da Infraestrutura e Mobilidade, `www.sie.sc.gov.br`), um site Angular que li pelo bundle `main.js` (7.135 textos).
- O achado central é o **GeoSIE** (`https://geo.sie.sc.gov.br/api/*.php`): GeoJSON anônimo, sem chave, sem cookie. Ele tem as rotas de AET, a malha estadual com km, as travessias urbanas, os boletins de acidente da PMRv e as ocorrências vivas.
- Usei as 3 buscas web permitidas na pesquisa. Nenhuma achou portaria de restrição de caminhão do DEINFRA/SIE. Na verificação de 18/10 li também 34 PDFs de portarias, decretos e resoluções e cerca de 95 PDFs de INs do site da SIE: nenhum traz restrição de horário, peso, altura ou feriado para caminhão (resultado negativo; ausência não é prova).
- Não testado por falha do proxy: OSM/Overpass (hgv sem ato), DNIT WFS (travessias), TRT12 e FECAM.

## Resumo por tema

| Tema | Resultado | Pronto p/ importar |
|---|---|---|
| 1. Restrições em rodovias estaduais | **Não achei** portaria de horário de caminhão (feriado, serra, travessia urbana) nem limite de peso/altura/comprimento por trecho. Existe o regime de AET com rotas liberadas por tipo de combinação, em km. | **Sim**: rotas de AET, malha com km, travessias |
| 2. Pedágio estadual | Nenhuma concessão estadual com cobrança localizada. As 11 praças ANTT em SC são todas BR-101 e BR-116. | Não (federais já importadas) |
| 3. Balanças estaduais | Nada localizado. | Não |
| 4. Feriados | 11/08 e 25/11 são feriados estaduais, mas por lei (Lei 18.531/2022) **sempre transferidos para domingo**. PL 23/2026 parado na CCJ. Municipais: sem base estadual. | Estaduais sim (efeito nulo em dia útil); municipais não |
| 5. Produtos perigosos | IMA licencia (LAC, IN IMA 77). Nenhum ato de trecho achado. | Não |
| 6. Acidentes | **GeoSIE**: 5.543 BOs da PMRv em 2026, todos com coordenada, em rodovia estadual. Sem tipo de veículo. | **Sim** (sem filtro de caminhão) |
| 7. Roubo de carga | Só agregado. SC teve 13 casos em 2025 (Sinesp VDE). | Não |
| 8. Particularidades | Balsa Itajaí-Navegantes, serras, 785 km de leito natural. | Notas |

## 1. Rodovias estaduais e AET

Fontes testadas (HTTP 200, anônimas):

- `https://geo.sie.sc.gov.br/api/geo_rotas_aet.php?CDROTA=4|6|8|9` (GeoJSON LineString; km com vírgula decimal).
- `https://geo.sie.sc.gov.br/api/geo_rodovia_estadual.php`: 624 trechos, 6.333,3 km, com `SGRODOVIA`, `CDTRECHO`, km inicial e final, situação.
- `https://geo.sie.sc.gov.br/api/geo_travessia_urbana.php`: 433 feições (1 duplicada: SC-482 km 54,318-57,866), 432 únicas, 1.139,4 km. Base legal: Resolução SIE 001/2021, de 14/01/2021 (DOE-SC 21.440, 20/01/2021; art. 1º define e delimita as travessias urbanas do PRE; tabela conferida com a camada).
- `https://geo.sie.sc.gov.br/api/geo_sos.php`: ocorrências vivas.
- Página AET da SIE: `https://www.sie.sc.gov.br/autorizacao-especial-transito` (texto em `fontes/SC/sie_pagina_aet_texto.txt`).

Rotas de AET liberadas (lista de liberação por tipo; que fora dela não haja AET para a combinação é inferência, a norma que veda não foi lida):

| CDROTA | Tipo | Trechos | km | Rodovias |
|---|---|---|---|---|
| 4 | Bitrem / Romeu e Julieta, PBTC até 57 t | 75 | 972,7 | 13 (SC-110, 114, 120, 135, 150, 155, 157, 160, 350, 416, 418, 480 e A470A) |
| 6 | Cegonheiros (CTV/CTVP) | 101 | 1.148,2 | 28 |
| 8 | Bitrenzão / Rodotrem / Tritrem, 57 a 74 t | 44 | 642,8 | 17 (SC-114, 120, 135, 150, 157, 340, 350, 355, 390, 407, 412, 415, 416, 417, 465, 480, 486) |
| 9 | Treminhões, 57 a 74 t | 9 | 153,5 | só SC-120, SC-350 e SC-480 |

Regras da AET (página da SIE):

- Sem trecho pré-estabelecido (validade por final de placa): até 4,40 m de altura, 3,20 m de largura, 23 m de comprimento e 45 t, sem excesso para fora da carroceria. Acima disso, AET de viagem única.
- Validade: CVC 1 ano, guindaste 6 meses, cegonheiro e carga indivisível sem excesso por final de placa.
- Taxas: R$ 82,48 (até 25 m, 3,20 m, 45 t), R$ 119,97 (CVC ou 45 a 80 t), R$ 194,93 (acima de 80 t), 2ª via R$ 44,98, escolta R$ 12,50/km, TUV = Fator 1 × (PBT − 45 t), só acima de 45 t. CTV/CTVP (cegonheiro, altura 4,70 a 4,95 m): R$ 68,21 (até 25 m, 3,20 m, 45 t), R$ 99,21 (acima de 25 m, 3,2 m, 45 a 80 t), 2ª via R$ 37,20.
- Base legal citada: Lei estadual 13.662/2005; Resoluções CONTRAN 210/2006, 211/2006, 213/2006, 305/2009, 735/2018 e 12/98; IN SIE 007/2021 (validade da AET de CVC; PDF não localizado, só o título; o arquivo `instrucaonormativa07.pdf` do site é a IN 007/2022, outro assunto). Os atos CONTRAN são citados como vigentes pela SIE; a vigência não foi reverificada no CONTRAN.
- Contato: GEROP, (48) 3664-9289, `aet@sie.sc.gov.br`.

Serras (derivado dos dados):

- **SC-418, Serra Dona Francisca (km 13,3 a 16,7)**: tem segmentos liberados só para bitrem/romeu e julieta. Não há rodotrem, treminhão nem cegonheiro (cegonheiro só no km 44,25 a 59,70).
- **SC-390, Serra do Rio do Rastro (km 403,939 a 410,595, marcada na malha)**: nenhuma das 4 listas cobre esse intervalo. O rodotrem na SC-390 só aparece nos km 204,4 a 239,19 e 256,04 a 282,80.

Avisos vivos em 18/10/2026 (`geo_sos`):

- **SC-418 km 16,6 (Joinville)**: queda de faixa, meia pista **somente para PBT até 7,5 t** (Não Solucionado).
- SC-155 km 90,3 (Xavantina): meia pista por desabamento.
- SC-161 km 73 (Romelândia): ponte interditada, já liberada.

## 2. Pedágio

Nenhuma concessão rodoviária estadual com cobrança foi localizada. Não encontrei camada de pedágio no GeoSIE nem base no portal de dados abertos. As 11 praças em SC (ANTT, CC-BY, atualizado em 28/07/2026) são da Autopista Litoral Sul (BR-101, P2 a P5), Via Costeira (BR-101, P1 a P4) e Autopista Planalto Sul (BR-116, 3 praças). As concessões do Oeste (Lote 1: BR-153/282/470; Lote 3: BR-153/282/480; free flow) são federais e, até onde confirmei, só chegaram à audiência pública (ANTT, 07/05/2026); edital e data de leilão não confirmados. Não consegui confirmar por fonte oficial estadual que não há PPP estadual em estudo.

## 3. Balanças

Sem lista de balanças estaduais. O GeoSIE tem 25 postos da PMRv (`geo_postos_pmrv.php`), que são policiamento, não pesagem.

## 4. Feriados

- **Estaduais**: norma vigente = Lei 18.531/2022 (consolidadora; Anexo/Calendário Oficial; alterada até a Lei 20.053/2026). As Leis 10.306/1996, 11.213/1999, 12.906/2004 e 13.408/2005 que originaram a regra constam na ALESC como consolidadas e revogadas (Leis 16.719/2015 e 17.335/2017). 11/08 (Dia do Estado) e 25/11 (Santa Catarina de Alexandria): quando caem em dia útil, **o feriado é transferido para o domingo seguinte**. Datas efetivas: 2026 = 16/08 e 29/11; 2027 = 15/08 e 28/11; 2028 = 13/08 (25/11/2028 é sábado e a lei só fala em dia útil, sem transferência por texto). Efeito para restrição de caminhão: nenhum.
- **PL 23/2026** (governador, entrada em 02/02/2026): quer instituir 25/11 como feriado de fato. COFEM/FIESC/CDL se opuseram (Lei federal 9.093/1995 admite um feriado estadual). **Confirmado no e-Legis em 18/10/2026**: última tramitação em 05/02/2026, "Aguardando apreciação pela Comissão de Constituição e Justiça"; não é lei, e a Lei 18.531 (alterada até a Lei 20.053/2026) ainda mostra a transferência para domingo. Reconferir antes de fechar o calendário.
- **Municipais**: não existe base estadual estruturada. Caminho viável: dumps mensais em JSON do **DOM/SC** (Diário Oficial dos Municípios, CIGA) em `https://dados.ciga.sc.gov.br/dataset/?tags=DOMSC` (campos `titulo`, `data`, `municipio`, `entidade`, `categoria`, `link`, `texto`). No teste (3 dias de dez/2025, 7.951 atos; em 18/10/2026, 0 de 402 títulos do recorte de 01/10/2026 16h-24h; o CKAN não declara licença), só 5 títulos tinham feriado, ponto facultativo ou calendário, então o filtro por título rende pouco e exige ler o texto. Complemento: atos de tribunais (CNJ Rec. 44/2020); TJSC é SPA não lida e TRT12 não abre pelo proxy.

## 5. Produtos perigosos

IMA (Instituto do Meio Ambiente): licenciamento do transporte rodoviário na modalidade LAC, **Licença por Adesão e Compromisso** (mais de 7.200 licenças, página de 20/03/2025), regulado pela **IN IMA 77** (13/02/2020; atividade 47.10.10 da Res. CONSEMA 98/2017, atualizada pela 144/2020), que trata da documentação de licenciamento, não de trecho. Fiscalização em operações conjuntas todos os anos (251 veículos abordados, 7 autuados até 20/03/2025) e plantão PARE 0800.644.1520. Uma LAC de 2026 cita a Res. CONSEMA 250/2024: pode haver norma mais nova, não confirmei. Não achei ato de restrição de manancial, túnel ou ponte. O Túnel Antonieta de Barros (Florianópolis) foi cenário de simulado em jun/2026, sem ato de proibição nas páginas lidas.

## 6. Acidentes

`https://geo.sie.sc.gov.br/api/geo_acidente.php`: 5.543 boletins da PMRv em rodovias estaduais, de 01/01 a 17/10/2026 (na verificação de 18/10: 5.544, até 18/10), **0 sem coordenada** (dentro de SC). Campos: posto, ano, nº do boletim, município, rodovia, km, data, classificação, nº de veículos, feridos, ilesos, mortos, condição do tempo, gravidade, lat/lon. **Não traz tipo de veículo.** Devolve só o ano corrente, sem parâmetro de ano. 202 mortos, todos na gravidade 1 (mapa de gravidade inferido e consistente com os dados: 1 fatal, 2 feridos, 3 sem vítima; a fonte não documenta). Top: SC-108 (694), SC-401 (428), SC-445 (259), SC-406 (216), SC-370 (189). Alternativa nacional com tipo de veículo: RENAEST (~520 MB por zip, não baixado). Licença não declarada.

## 7. Roubo de carga

A SSP-SC publica um boletim mensal em PDF (`https://ssp.sc.gov.br/segurancaemnumeros/`) só com roubo e furto totais (jan-jul/2026: 2.860 roubos). Sem categoria carga e sem coordenada. O Sinesp VDE 2025 (xlsx, baixado e lido) dá **13 roubos de carga em SC** no ano (Brasil: 8.565; RJ 3.777, SP 3.470).

## 8. Particularidades

- Ferry-boat Itajaí-Navegantes no Rio Itajaí-Açu: serviço intermunicipal com subsídio da SIE (Passe Livre; Lei estadual 12.119, de 07/01/2002; Decreto 1.780, de 03/03/2022; Resoluções SIE 001/2024 de 22/10/2024, 001/2025 de 20/03/2025 e 030/2025 de 17/11/2025). A Res. 030/2025 diz que o programa está em transição da SIE para a SPAF (Secretaria de Estado de Portos, Aeroportos e Ferrovias). Não achei limite de peso, altura ou horário para caminhão nem o operador.
- Malha estadual: 5.089 km pavimentados, **785 km em leito natural**, 312 km em obras de pavimentação, 117 km duplicados.
- Sem regra de safra encontrada.
- hgv no OSM sem ato: **não testado** (sem PBF do Sul no repo; Overpass falhou).

## Pendências

1. Acessar `deinfra.sc.gov.br` e `sie.sc.gov.br` fora do proxy para procurar portarias de horário de caminhão que o bundle do site não mostra.
2. Ler o texto da IN SIE 007/2021 (a Resolução SIE 001/2021 já foi lida em 18/10/2026).
3. Reconferir o PL 23/2026 na ALESC (em 18/10/2026 estava parado na CCJ).
4. Baixar o PBF do Sul e checar hgv, maxweight e ferry em rodovias SC-xxx.
5. Montar o pipeline de feriados municipais sobre o DOM/SC e os atos de tribunal.
6. Medir a cobertura de coordenada de SC no RENAEST.
