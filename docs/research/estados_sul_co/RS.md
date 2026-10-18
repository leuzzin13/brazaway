# Rio Grande do Sul (RS): fontes oficiais para caminhão (pesquisa de 18/10/2026)

Somente leitura no repositório. Textos extraídos e amostras pequenas em `fontes/RS/` (cerca de 1 MB; brutos apagados). Detalhe completo em `RS.json`.

## Resumo em uma tela

| Tema | O que existe | Pronto para importar? |
|---|---|---|
| 1. Restrições em rodovias estaduais | DAER: 9 Decisões Normativas (DN) de restrição e 4 de AET. Tem portaria de feriado (DN 158/2026), mas só para veículos acima de 2,60 x 4,40 x 19,80 m ou 58,5 t. Horário para caminhão comum só em Estrada do Mar (ERS-389) e Rota do Sol (RSC-453/ERS-486). DN 148/2022 proíbe CR6/CTS11 de 45-57 t em 165 trechos (2.455,6 km). 8 PDFs de trechos permitidos para CVC/CTV | Sim para Rota do Sol (DN 135/127), Estrada do Mar e DN 148 (código SRE e km no ato; SRE 08/2026 casa 163 de 165). Listas CVC: parseadas, sem junção com SRE |
| 2. Pedágio | 3 operadores estaduais: EGR (estatal, 10 praças), Rota de Santa Maria (RSC-287, 5 praças, Sacyr) e CSG (Bloco 3, free flow, 6 pórticos). Bloco 2 cancelado em 03/06/2026; Bloco 1 sem leilão | Coordenadas só das 10 da EGR (KML testado). RSM e CSG só têm km. Tarifas em HTML/PDF/imagem |
| 3. Balanças | Sem lista nem dado aberto de balanças estaduais | Não |
| 4. Feriados | 1 estadual (20/09). Municipais: TRT4 (Portaria 08/2025), 65 cidades e 166 datas em 2026 | Estadual: parcial (base legal a confirmar). Municipal: sim, com cobertura de 13% dos municípios |
| 5. Perigosos | Atos do DAER: Rota do Sol (DN 127/136), Estrada do Mar (DN 152) e ERS-030/040/118 (DN 29/2002, vigência incerta). FEPAM licencia | Rota do Sol e Estrada do Mar: sim. DN 29/2002: não |
| 6. Acidentes | RENAEST-RS tem ~1,2 mil acidentes/ano, 0% com coordenada. DETRAN-RS: CSV municipal de mortes (CC-BY-4.0), sem coordenada | Não |
| 7. Roubo/furto de carga | SSP/RS: microdados mensais (Lei 15.610/2021) com 2 categorias de carga, sem coordenada, por município e bairro | Parcial (agregado municipal) |
| 8. Particularidades | Rota do Sol, Estrada do Mar, balsas (3 reguladas pela AGERGS), colheitadeira, free flow, pontes pós-enchente | n/a |

## 1. Rodovias estaduais (DAER/RS, SELT)

Fonte da lista: `https://www.daer.rs.gov.br/restricao-para-veiculos-de-transporte-de-cargas` (e `/legislacao-sobre-aet`). Os textos são atos oficiais (Lei 9.610/1998, art. 8º, IV), sem licença declarada. Fiscalização: Comando Rodoviário da Brigada Militar (CRBM). A vigência vem da lista do DAER em 18/10/2026, não é certidão.

| Ato | Trecho | Regra | Veículos |
|---|---|---|---|
| DN 158/2026 (DOE 13/02/2026, art. 1º, 2º, 3º, Anexo I) | rodovias estaduais de pista simples (sem lista de trechos) | janelas de 6 h: véspera 16h-22h, feriado 06h-12h, último dia 16h-22h. 2026: Carnaval 13, 14, 17 e 18/02; Semana Santa 02, 03 e 05/04; 30/04, 01 e 03/05; Corpus Christi 03, 04 e 07/06; 04, 05 e 07/09; 09, 10 e 12/10; 19, 20 e 22/11; fim de ano 24, 25, 27, 31/12, 01 e 03/01/2027. 20/09 (domingo) não consta | só quem excede largura 2,60 m, altura 4,40 m, comprimento 19,80 m ou PBTC 58,5 t (AET/AE, CVC, CTV, CTVP). Caminhão legal não é atingido |
| DN 152/2023 (ERS-389, arts. 1º a 8º, 14) | Osório a Torres, km 0-90,3 (SRE 389ERS0010 a 0040) | baixa temporada (01/04-30/11): AEC e segunda 10h a sexta 16h, sábado 10h-16h. Alta (01/12-31/03): segunda 12h a sexta 12h. Vedado em Semana Santa, Carnaval e feriados | PBT <= 12 t livre; 12-23 t (3 eixos, 16 m) com AEC; > 23 t, > 3 eixos ou > 16 m proibido; PP proibido |
| DN 135/2021 (Rota do Sol, arts. 1º a 4º, Anexo I) | RSC-453 km 141,53-255,77 e ERS-486 km 0-38,66 (códigos SRE 453RSC0230 a 0370, 486ERS0010 e 0030) | alta e baixa temporada por trecho (sex e dom 14h-22h; alta também seg 7h-10h, sáb 7h-12h e, no trecho III, seg a qui 18h-07h e sex 0h-7h); Carnaval, Semana Santa e feriados | 14-19,80 m, > 3 eixos, 23-57 t; CVC > 19,80 m, > 7 eixos e > 57 t proibida de São Marcos a Terra de Areia; livre até 15 m, 3 eixos, 23 t |
| DN 127/2019 + DN 136/2021 | RSC-453 km 242,17-255,77 e ERS-486 km 0-38,66 | PP proibido (exceção lindeiros seg a qui 10h-15h) | produtos perigosos; CVC > 19,80 m/7 eixos/57 t |
| DN 148/2022 (Anexo I, 165 trechos) | ex.: ERS-020 km 162,32-213,08; ERS-165 km 0-63,77; ERS-330 km 109,54-190,94 | permanente | CVC até 7 eixos com 45-57 t (até 19,80 m) ou 48,5-58,5 t (até 18,60 m): CR6 e CTS11 |
| DN 90/2014 (art. 3º) | toda a malha DAER | permanente | CVC de 9 eixos, 19,80 m e 74 t proibida |
| DN 59/2007 (art. 1º) | ERS-030, Santo Antônio da Patrulha a Osório (km não informado) | permanente | mais de 3 eixos; exceções: licenciados nos dois municípios, NF de origem/destino no trecho, motorista residente |

Revogadas (não usar): DN 72/2009, 94/2015 e 107/2017 (art. 10 da DN 127/2019), DN 126/2019 (substituída pela 135/2021), DN 109/2018 (ponte do Rio Tramandaí, ERS-786), DN 146/2022 (revogada pelo art. 6º da DN 156/2025). A página do DAER ainda lista a DN 107/2017 sem selo de revogada, mas o art. 10 da DN 127/2019 a revoga.

AET: DN 143/2022 (CVC > 57 t ou > 19,80 m precisa de AET; 74 t até 25 m por AET; 25-30 m só em segmentos autorizados), DN 157/2026 (boiadeiros: AET de 12 meses), DN 156/2025 (colheitadeira; art. 6º revoga a DN 146/2022), DN 159/2026 (laudos), OS 001/2026 (prorrogou AET só até 30/09/2026). Listas de trechos permitidos (PDF, parseadas): CVC 19,80-26 m 31 trechos/1.822,98 km; 26-30 m 13/878,79 km; carga viva até 36 t 32/1.965,05 km e > 36 t 31/1.921,97 km; 4 listas CTV/CTVP de 34 a 37 trechos.

Camadas para ancorar geometria: SRE XLS (08/2026, 1.686 trechos com código SRE novo e antigo, SNV, lat/lon de início e fim, concessão, VDM) e cadastro de OAEs (1.540, classe 12/24/36/45). WFS i3geo do DAER não foi testado (certificado TLS sem cadeia completa; não desativei a verificação).

## 2. Pedágio estadual

- **EGR** (estatal): 10 praças. KML do Google My Maps (`https://www.google.com/maps/d/kml?mid=1kSLkknMSx56tiBf3G4fzyxoitUUOwZA&forcekml=1`) testado: Campo Bom (-51.0786, -29.6565), Cruzeiro do Sul, Coxilha, Gramado, Santo Antônio da Patrulha, Viamão, Encantado, Boa Vista do Sul, Três Coroas e São Francisco de Paula. Tarifas em 5 imagens de 05/2022 (conferidas; a página rotula as praças de cada imagem) (eixo de R$ 3,25 a R$ 7,10; 2 eixos = 2x o valor do eixo); possivelmente vencidas.
- **Rota de Santa Maria** (Sacyr), RSC-287 km 28,03-232,54 (204,51 km), contrato 20/2021, desde 31/08/2021: praças em Taquari km 47, Venâncio Aires 86, Candelária 131, Paraíso do Sul 168 e Santa Maria 220. Tarifa 2026 no site: 2 eixos R$ 10,80, 3 eixos R$ 16,20, 4 eixos R$ 21,60, 5 eixos R$ 27,00, 6 eixos R$ 32,40.
- **CSG** (Caminhos da Serra Gaúcha), Bloco 3, contrato 50/2022, desde 01/02/2023, 271,5 km, free flow com 6 pórticos: ERS-122 km 4, 45, 108 e 151, ERS-446 km 6, ERS-240 km 30. Tarifa por pórtico do JSON (RED 724/2024) está VENCIDA (era a de 01/02/2024 a 31/01/2025); a planilha da AGERGS (2026-05) traz só a categoria I vigente desde 29/04/2026: R$ 13,30 (São Sebastião do Caí), 9,20 (Antônio Prado), 9,30 (Ipê), 9,70 (Capela de Santana), 11,50 (Farroupilha) e 10,60 (Carlos Barbosa); demais categorias não publicadas. Multa por não pagar: art. 209-A CTB; Contran suspendeu até 16/11/2026.
- **Blocos 1 e 2**: Bloco 2 (409 km) teve leilão cancelado em 03/06/2026 sem propostas; Bloco 1 (454 km, ERS-010, 020, 040, 115, 118, 235, 239, 466, 474, em boa parte hoje da EGR) sem leilão encontrado.
- Onde baixar: AGERGS `https://agergs.rs.gov.br/rodovias-concedidas` (XLSX de trechos, contratos, tabelas tarifárias em PDF). Concessões federais no RS (CCR ViaSul, Ecosul) vêm da ANTT.

## 3. Balanças

Sem lista. O DAER não publica balanças; o mapa interativo anuncia camada de postos, mas o WFS não foi testado. O item "Pesagem" do site da Rota de Santa Maria devolve 404. Só há as balanças federais da ANTT já na base.

## 4. Feriados

- Estadual: **20/09** (Revolução Farroupilha). TRT4 cita Lei Federal 9.093/1995 art. 1º II e Decreto Estadual 36.180/1995; não consegui ler a lei estadual (site da Assembleia recusou a conexão). Uma busca na web falou em "Lei 4.453/78", mas o TRT4 usa "Lei Municipal 4.453/78" para Porto Alegre, então não confirmei. 2026: domingo; 2027: segunda-feira.
- Municipal: não há base estadual aberta. Fonte testada: TRT4, Portaria da Corregedoria 08/2025 (compilada), 65 cidades e 166 datas em 2026 (Corpus Christi 04/06 em 64 cidades). Cobertura limitada a cidades com unidade da Justiça do Trabalho. Método análogo ao TRT3/TJMG do Sudeste. TJRS e Querido Diário não responderam pelo proxy.

## 5. Produtos perigosos

Atos do DAER: Rota do Sol (DN 127/136: proibido, exceção lindeiros seg a qui 10h-15h), Estrada do Mar (DN 152, art. 8º §2º: proibido, exceções) e DN 29/2002 (ERS-030 km 0-82,47, ERS-040 km 11,2-83,53, ERS-118 km 21,69-38,17: 22h-06h, 15h-06h em dias excepcionais; antigo, vigência incerta). Base das multas: Lei 11.090/1998, Decreto 47.199/2010, Decreto 54.135/2018 e Resolução ANTT 5.947/2021 (OS DG 004/2022). Órgão ambiental: FEPAM (licença por veículo; consulta por placa só em HTTP, não testada). Nada por manancial, túnel ou ponte.

## 6. Acidentes

RENAEST-RS (streaming do zip de 529 MB): 1.246 acidentes em 2025 (1.490 em 2018), 54% com km, 1 em ~8,7 mil com coordenada; 2025: 423 em via estadual, 331 federal, 481 municipal; 183 caminhões, 141 caminhões-trator, 134 semirreboques. DETRAN-RS (CKAN, CC-BY-4.0): tabelas por município com coluna "Condutor de Caminhão", sem coordenada, últimas lidas em ago/2023. Painéis do DETRAN sem download.

## 7. Roubo e furto de carga

SSP/RS, dados abertos da Lei 15.610/2021 (`https://ssp.rs.gov.br/dados-abertos`): CSV de 567.659 ocorrências em jan-set/2026 com município, bairro e tipo de local, sem coordenada. Categorias de carga: "FURTO DE CARGA EM CAMINHAO" (45) e "ROUBO A MOTORISTA DE CARGA DE CAMINHAO" (20); Porto Alegre 11, Rio Grande 11, Canoas 6. Indicadores mensais por município (CKAN, CC0/CC-BY-NC) não têm carga. Amostra em `fontes/RS/`.

## 8. Particularidades

- Rota do Sol (Reserva da Biosfera; LO IBAMA 1280/2014): janelas por temporada, PP proibido.
- Estrada do Mar: teto 23 t, 3 eixos, 16 m.
- 165 trechos com CR6/CTS11 proibidos, quase todos em estaduais secundárias.
- Balsas reguladas pela AGERGS: Rio Grande-São José do Norte (13 saídas por lado seg-sex, 30 min), Triunfo-São Jerônimo, Taquari-General Câmara. Balsa emergencial São Valentim do Sul-Santa Tereza (desde 09/02/2024). SRE marca ainda ERS-211, BR-470 (Taquari) e BR-473 como travessia de balsa.
- Safra: sem regra de horário. Colheitadeira em caminhão+reboque: 25 m, 57 t, só de dia, 60 km/h (DN 156/2025).
- Pontes pós-enchente: Piraju (ERS-168) liberada em 14/10/2026; Sinimbu (RSC-471) nova ponte; Ponte dos Vales em obras.
- Não feito: cruzar SRE com `hgv` do OSM (sem PBF do RS no repositório; Overpass indisponível).

## Pendências

- Lei estadual do 20/09 (texto da Assembleia, inacessível) e vigência do Decreto 36.180/1995.
- Junção das 8 listas CVC/CTV e da DN 158/2026 com o SRE (por rodovia+km); decidir "pista simples" na DN 158.
- Vigência de DN 59/2007 e DN 29/2002; texto da DN 109/2018; leitura das DN 113/2018 e 146/2022.
- Tarifas vigentes da EGR (imagens de 2022), tarifas de caminhão da CSG após 29/04/2026 (só a categoria I está publicada) e coordenadas das praças RSM e CSG.
- WFS do DAER (certificado) e lista de balanças (LAI ao DAER/EGR/CRBM).
- Feriados municipais fora do TRT4 (TJRS, Querido Diário, FAMURS) e lista 2027 (sai até 19/12/2026).
- Status do Bloco 1 de concessões e nova prorrogação das AET (OS 001/2026 vencida em 30/09/2026).

## Verificação independente (2026-10-18)

Releitura das fontes oficiais por verificador cético (ver campo `verificacao` em cada tema do `RS.json`).

- **Rodovias estaduais**: verificado em 2026-10-18. Página do DAER lista exatamente as DN citadas. DN 158, 152, 143, 157, 156 e OS 001/2026 idênticas aos textos em `fontes/RS`; DN 135, 136, 127, 148, 90, 59 e 29 conferidas artigo a artigo; Anexo I da DN 148 reparseado (165 linhas, 2.455,62 km, item 144 com extensão impressa divergente); 8 listas CVC/CTV com trechos e km idênticos; SRE e OAE 08/2026 recontados. Correções: URL da DN 152 (a anterior era PDF só imagem; texto em `202305/16091724`); SRE traz também 389MRS0050 (km 88,26-90,30, Torres); DN 156/2025 (Conselho de 09/10/2025) revoga a DN 146/2022; DN 157/2026 vem datada de 27/02/2026 mas publicada no DOE de 23/02/2026; AET/AEC só pelo SIDER desde 20/01/2025; nenhuma prorrogação depois de 30/09/2026 na página. `pronto_para_importar` de Rota do Sol, DN 148 e Estrada do Mar mantido.
- **Pedágio**: verificado em 2026-10-18. KML da EGR idêntico (10 praças); 5 imagens de tarifa EGR conferidas (2022; vigência atual desconhecida); RSM 2026 conferida no site e na planilha AGERGS; tarifas da CSG do JSON estão vencidas (corrigido, ver seção 2); Deliberação Contran 277/2026 confirmada no DOU de 29/04/2026 (prazo de 200 dias); leilão do Bloco 2 cancelado em 03/06/2026 confirmado. **Rebaixado**: `tarifas` agora tem sub-flags (RSM sim; EGR e CSG não).
- **Balanças**: verificado em 2026-10-18. Busca do DAER (6 resultados gerais), página de OCR (25 trechos, não são balanças) e `/pesagem` da RSM (404) conferem; WFS segue com falha de TLS. Sem dataset.
- **Feriados**: verificado em 2026-10-18. Portaria TRT4 08/2025 idêntica; contagem corrigida para **166** datas (registro de Estrela estava fundido; arquivos de `fontes/RS` corrigidos). Base legal estadual do 20/09 segue sem confirmação primária.
- **Perigosos**: verificado em 2026-10-18. DN 127/136, 152, 29 e 135 §4º conferidas; DN 29/2002 com vigência não confirmada. OS DG 004/2022 trata só de defesas e recursos.
- **Acidentes**: verificado em 2026-10-18. Licenças e metadados do CKAN do DETRAN (CC-BY-4.0, 88 CSV) e do RENAEST (domínio público, ZIP de 529 MB) conferem; contagens do RENAEST: ver `RS.json` (tema acidentes).
- **Roubo de carga**: verificado em 2026-10-18. ZIP 2026 baixado de novo: 567.659 linhas, 45 + 20 registros de carga, municípios e tipos de local idênticos; licenças do CKAN da SSP conferem.
- **Particularidades**: verificado em 2026-10-18. Ver ressalvas no `RS.json` (balsa emergencial e ponte de Sinimbu não reverificadas).
