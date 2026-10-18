# Santa Catarina (SC): fontes oficiais para caminhão (pesquisa de 18/10/2026)

Detalhe completo em `SC.json`. Amostras em `fontes/SC/` (2 MB no total).

## Como ler este resultado

- O site do DEINFRA (`www.deinfra.sc.gov.br`) não abre pelo proxy deste ambiente (reset de conexão / DNS). Hoje o DEINFRA opera sob a **SIE** (Secretaria de Estado da Infraestrutura e Mobilidade, `www.sie.sc.gov.br`), um site Angular que li pelo bundle `main.js` (7.135 textos).
- O achado central é o **GeoSIE** (`https://geo.sie.sc.gov.br/api/*.php`): GeoJSON anônimo, sem chave, sem cookie. Ele tem as rotas de AET, a malha estadual com km, as travessias urbanas, os boletins de acidente da PMRv e as ocorrências vivas.
- Usei as 3 buscas web permitidas. Nenhuma achou portaria de restrição de caminhão do DEINFRA/SIE.
- Não testado por falha do proxy: OSM/Overpass (hgv sem ato), DNIT WFS (travessias), TRT12 e FECAM.

## Resumo por tema

| Tema | Resultado | Pronto p/ importar |
|---|---|---|
| 1. Restrições em rodovias estaduais | **Não achei** portaria de horário de caminhão (feriado, serra, travessia urbana) nem limite de peso/altura/comprimento por trecho. Existe o regime de AET com rotas liberadas por tipo de combinação, em km. | **Sim**: rotas de AET, malha com km, travessias |
| 2. Pedágio estadual | Nenhuma concessão estadual com cobrança localizada. As 11 praças ANTT em SC são todas BR-101 e BR-116. | Não (federais já importadas) |
| 3. Balanças estaduais | Nada localizado. | Não |
| 4. Feriados | 11/08 e 25/11 são feriados estaduais, mas por lei **sempre transferidos para domingo**. Municipais: sem base estadual. | Estaduais sim (efeito nulo em dia útil); municipais não |
| 5. Produtos perigosos | IMA licencia (LAC). Nenhum ato de trecho achado. | Não |
| 6. Acidentes | **GeoSIE**: 5.543 BOs da PMRv em 2026, todos com coordenada, em rodovia estadual. Sem tipo de veículo. | **Sim** (sem filtro de caminhão) |
| 7. Roubo de carga | Só agregado. SC teve 13 casos em 2025 (Sinesp VDE). | Não |
| 8. Particularidades | Balsa Itajaí-Navegantes, serras, 785 km de leito natural. | Notas |

## 1. Rodovias estaduais e AET

Fontes testadas (HTTP 200, anônimas):

- `https://geo.sie.sc.gov.br/api/geo_rotas_aet.php?CDROTA=4|6|8|9` (GeoJSON LineString; km com vírgula decimal).
- `https://geo.sie.sc.gov.br/api/geo_rodovia_estadual.php`: 624 trechos, 6.333,3 km, com `SGRODOVIA`, `CDTRECHO`, km inicial e final, situação.
- `https://geo.sie.sc.gov.br/api/geo_travessia_urbana.php`: 433 trechos, 1.143 km. Base legal: Resolução SIE 001/2021, de 14/01/2021 (só o título foi lido).
- `https://geo.sie.sc.gov.br/api/geo_sos.php`: ocorrências vivas.
- Página AET da SIE: `https://www.sie.sc.gov.br/autorizacao-especial-transito` (texto em `fontes/SC/sie_pagina_aet_texto.txt`).

Rotas de AET liberadas (lista de permissão por tipo; fora dela não há AET para a combinação):

| CDROTA | Tipo | Trechos | km | Rodovias |
|---|---|---|---|---|
| 4 | Bitrem / Romeu e Julieta, PBTC até 57 t | 75 | 972,7 | 13 (SC-110, 114, 120, 135, 150, 155, 157, 160, 350, 416, 418, 480 e A470A) |
| 6 | Cegonheiros (CTV/CTVP) | 101 | 1.148,2 | 28 |
| 8 | Bitrenzão / Rodotrem / Tritrem, 57 a 74 t | 44 | 642,8 | 17 (SC-114, 120, 135, 150, 157, 340, 350, 355, 390, 407, 412, 415, 416, 417, 465, 480, 486) |
| 9 | Treminhões, 57 a 74 t | 9 | 153,5 | só SC-120, SC-350 e SC-480 |

Regras da AET (página da SIE):

- Sem trecho pré-estabelecido (validade por final de placa): até 4,40 m de altura, 3,20 m de largura, 23 m de comprimento e 45 t, sem excesso para fora da carroceria. Acima disso, AET de viagem única.
- Validade: CVC 1 ano, guindaste 6 meses, cegonheiro e carga indivisível sem excesso por final de placa.
- Taxas: R$ 82,48 (até 25 m, 3,20 m, 45 t), R$ 119,97 (CVC ou 45 a 80 t), R$ 194,93 (acima de 80 t), escolta R$ 12,50/km, TUV = Fator 1 × (PBT − 45 t), só acima de 45 t.
- Base legal citada: Lei estadual 13.662/2005; Resoluções CONTRAN 210/2006, 211/2006, 213/2006, 305/2009, 735/2018 e 12/98; IN SIE 007/2021 (validade da AET de CVC; PDF não localizado, só o título).
- Contato: GEROP, (48) 3664-9289, `aet@sie.sc.gov.br`.

Serras (derivado dos dados):

- **SC-418, Serra Dona Francisca (km 13,3 a 16,7)**: tem segmentos liberados só para bitrem/romeu e julieta. Não há rodotrem, treminhão nem cegonheiro (cegonheiro só no km 44,25 a 59,70).
- **SC-390, Serra do Rio do Rastro (km 403,939 a 410,595, marcada na malha)**: nenhuma das 4 listas cobre esse intervalo. O rodotrem na SC-390 só aparece nos km 204,4 a 239,19 e 256,04 a 282,80.

Avisos vivos em 18/10/2026 (`geo_sos`):

- **SC-418 km 16,6 (Joinville)**: queda de faixa, meia pista **somente para PBT até 7,5 t** (Não Solucionado).
- SC-155 km 90,3 (Xavantina): meia pista por desabamento.
- SC-161 km 73 (Romelândia): ponte interditada, já liberada.

## 2. Pedágio

Nenhuma concessão rodoviária estadual com cobrança foi localizada. Não encontrei camada de pedágio no GeoSIE nem base no portal de dados abertos. As 11 praças em SC (ANTT, CC-BY, atualizado em 28/07/2026) são da Autopista Litoral Sul (BR-101, P2 a P5), Via Costeira (BR-101, P1 a P4) e Autopista Planalto Sul (BR-116, 3 praças). A concessão do Oeste (BR-153/282/470/480, free flow) é federal. Não consegui confirmar por fonte oficial estadual que não há PPP estadual em estudo.

## 3. Balanças

Sem lista de balanças estaduais. O GeoSIE tem 25 postos da PMRv (`geo_postos_pmrv.php`), que são policiamento, não pesagem.

## 4. Feriados

- **Estaduais**: Lei 10.306/1996 (alterada pelas Leis 11.213/1999, 12.906/2004 e 13.408/2005), hoje consolidada na Lei 18.531/2022 (Anexo único). 11/08 (Dia do Estado) e 25/11 (Santa Catarina de Alexandria): quando caem em dia útil, **o feriado é transferido para o domingo seguinte**. Datas efetivas: 2026 = 16/08 e 29/11; 2027 = 15/08 e 28/11; 2028 = 13/08 (25/11/2028 é sábado e a lei só fala em dia útil). Efeito para restrição de caminhão: nenhum.
- **PL 23/2026** (governador, fev/2026): quer instituir 25/11 como feriado de fato. COFEM/FIESC/CDL se opuseram (Lei federal 9.093/1995 admite um feriado estadual). Não confirmei se virou lei; a Lei 18.531 consolidada até a Lei 20.053/2026 ainda mostra a transferência para domingo. Conferir na ALESC.
- **Municipais**: não existe base estadual estruturada. Caminho viável: dumps mensais em JSON do **DOM/SC** (Diário Oficial dos Municípios, CIGA) em `https://dados.ciga.sc.gov.br/dataset/?tags=DOMSC` (campos `titulo`, `data`, `municipio`, `entidade`, `categoria`, `link`, `texto`). No teste (3 dias de dez/2025, 7.951 atos), só 5 títulos tinham feriado, ponto facultativo ou calendário, então o filtro por título rende pouco e exige ler o texto. Complemento: atos de tribunais (CNJ Rec. 44/2020); TJSC é SPA não lida e TRT12 não abre pelo proxy.

## 5. Produtos perigosos

IMA (Instituto do Meio Ambiente): licenciamento do transporte rodoviário na modalidade LAC (mais de 7.200 licenças em 2025), cerca de 50 operações de fiscalização por ano, plantão PARE 0800 644 1520. Não achei ato de restrição de manancial, túnel ou ponte. O Túnel Antonieta de Barros (Florianópolis) foi cenário de simulado em jun/2026, sem ato de proibição nas páginas lidas.

## 6. Acidentes

`https://geo.sie.sc.gov.br/api/geo_acidente.php`: 5.543 boletins da PMRv em rodovias estaduais, de 01/01 a 17/10/2026, **0 sem coordenada** (dentro de SC). Campos: posto, ano, nº do boletim, município, rodovia, km, data, classificação, nº de veículos, feridos, ilesos, mortos, condição do tempo, gravidade, lat/lon. **Não traz tipo de veículo.** Devolve só o ano corrente, sem parâmetro de ano. 202 mortos, todos na gravidade 1 (mapa de gravidade inferido: 1 fatal, 2 feridos, 3 sem vítima). Top: SC-108 (694), SC-401 (428), SC-445 (259), SC-406 (216), SC-370 (189). Alternativa nacional com tipo de veículo: RENAEST (~520 MB por zip, não baixado). Licença não declarada.

## 7. Roubo de carga

A SSP-SC publica um boletim mensal em PDF (`https://ssp.sc.gov.br/segurancaemnumeros/`) só com roubo e furto totais (jan-jul/2026: 2.860 roubos). Sem categoria carga e sem coordenada. O Sinesp VDE 2025 (xlsx, baixado e lido) dá **13 roubos de carga em SC** no ano (Brasil: 8.565; RJ 3.777, SP 3.470).

## 8. Particularidades

- Ferry-boat Itajaí-Navegantes no Rio Itajaí-Açu: serviço intermunicipal com subsídio da SIE (Passe Livre; Lei estadual 12.119; Decreto 1.780/2022; Resoluções SIE 001/2024, 001/2025 e 030/2025). Não achei limite de peso, altura ou horário para caminhão nem o operador.
- Malha estadual: 5.089 km pavimentados, **785 km em leito natural**, 312 km em obras de pavimentação, 117 km duplicados.
- Sem regra de safra encontrada.
- hgv no OSM sem ato: **não testado** (sem PBF do Sul no repo; Overpass falhou).

## Pendências

1. Acessar `deinfra.sc.gov.br` e `sie.sc.gov.br` fora do proxy para procurar portarias de horário de caminhão que o bundle do site não mostra.
2. Ler o texto da Resolução SIE 001/2021 e da IN SIE 007/2021.
3. Confirmar o destino do PL 23/2026 na ALESC.
4. Baixar o PBF do Sul e checar hgv, maxweight e ferry em rodovias SC-xxx.
5. Montar o pipeline de feriados municipais sobre o DOM/SC e os atos de tribunal.
6. Medir a cobertura de coordenada de SC no RENAEST.
