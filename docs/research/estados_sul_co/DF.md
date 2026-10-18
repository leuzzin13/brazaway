# Distrito Federal (DF): fontes oficiais para caminhão (pesquisa de 18/10/2026)

Somente leitura no repositório. Textos e amostras em `fontes/DF/` (cerca de 1 MB); brutos grandes ficaram em área de rascunho e foram apagados. Detalhe completo em `DF.json`. O DF é unidade única: não há "estadual" separado nem municípios. Órgão rodoviário: DER-DF (Departamento de Estradas de Rodagem do DF); trânsito urbano e infrações: DETRAN-DF.

Limite desta pesquisa: os sites `der.df.gov.br`, `detran.df.gov.br`, `dados.df.gov.br`, `dadosabertos.df.gov.br`, `geoportal.seduh.df.gov.br` e `dodf.df.gov.br` não abriram deste ambiente (timeout no TLS ou 502 do proxy; não contornei). Li os atos no SINJ (sinj.df.gov.br) e a malha no ArcGIS REST do IDE/DF (www.geoservicos.ide.df.gov.br), que abriram. A busca do SINJ indexa a ementa, não o texto integral: portaria com ementa genérica pode ter escapado.

## Resumo em uma tela

| Tema | O que existe | Pronto para importar? |
|---|---|---|
| 1. Restrições em rodovias | 8 atos achados. Valem: Eixão DF-002 (pesados proibidos todos os dias; fechado a todos nos domingos e feriados, 06h-18h), Barragem do Paranoá DF-001 e Ponte do Rio Melchior DF-180 (caminhão com mais de 2 eixos simples). Inativos por vigência incerta: BR-040/EPIA 06h-09h (2013), EPTG (2008), carga e descarga SCLS/SCLN (2008). DF-463 revogada em 2025. Sem portaria de feriado prolongado, limite de peso/altura por trecho, safra ou rodotrem. AET: CVC acima de 45 t, tarifa R$ 97,25 | Malha e OAE sim (IDE/DF testado); regras: DF-002 e Barragem sim, Melchior manual |
| 2. Pedágio | Nenhum distrital. Nenhuma praça com uf=DF no CSV da ANTT | Nada a importar |
| 3. Balanças | Sem lista pública; nenhum PPV da ANTT no DF; nenhum weighbridge no OSM | Não |
| 4. Feriados | Distritais: 21/04, Sexta-feira da Paixão, Corpus Christi (Lei 72/1989) e 30/11 (Lei 963/1995). Sem municípios | Sim (4 regras); municipal não se aplica |
| 5. Perigosos | Restrições de horário do DER (2018) revogadas em 31/01/2019; sobra a IS DETRAN 576/1984 (W3, setores comerciais) e a licença do IBRAM (Instrução 82/2009) | Não |
| 6. Acidentes | RENAEST: 332.101 acidentes (2018-05/2026), coordenada só em 2018, 2019, 2025 e 2026; 3.587 com caminhão em 2025 (3.538 com coordenada) | Sim (com ressalvas) |
| 7. Roubo de carga | Sinesp: 5 ocorrências em 2025 e 1 em 2026, sem município; SSP-DF só crimes patrimoniais por RA | Não |
| 8. Particularidades | Sem balsa, serra, safra ou free flow; tesourinhas com gabarito de 3,55-4,05 m no OSM; lacunas de hgv no OSM | n/a |

## 1. Restrições em rodovias distritais

Todos os textos estão em `fontes/DF/sinj_*.txt` (consolidados do SINJ; "não substitui o publicado no DODF").

**Em vigor (sem revogação expressa no SINJ)**

- **Decreto 32.563/2010** (DODF 233, 09/12/2010; altera o Decreto 13.250/1991; par. único do art. 1º pelo Decreto 38.571/2017). Art. 1º: veda o tráfego de veículos automotores na DF-002 (Eixo Rodoviário Sul e Norte) das 06h às 18h aos domingos e feriados nacionais (07h-19h "na hora de verão", dispositivo morto desde que o país acabou com o horário de verão). **Art. 2º: veda o tráfego de "veículos pesados" na DF-002 em todos os dias**, salvo autorização do DER/DF. "Pesados" não é definido. Trechos no IDE/DF: DF-002 km 0,0-7,2 (Ponte do Braghetto até a Rodoviária) e km 7,2-13,8 (até o Trevo de Triagem Sul, DF-047).
- **IN DER-DF 3/2024** (DODF 203/204, 22-23/10/2024; alterada pela IN 1/2025): Eixão do Lazer, domingos e feriados, 06h-18h, trânsito de automotores interrompido; carga e descarga só nas áreas de estacionamento previstas.
- **Instrução DER-DF 3/2019** (DODF 33, 15/02/2019): proíbe caminhões com configuração superior a dois eixos simples sobre a Barragem do Paranoá (DF-001, EPCT). O art. 2º diz vigor em 01/03/2018 (erro material provável). Trecho IDE/DF DF-001 km 17,9-19,8; OSM: via "Barragem do Paranoá", ref DF-001, lat -15.79896, lon -47.78442.
- **Instrução DER-DF 14/2021** (DODF 245, 31/12/2021): idem sobre a Ponte do Rio Melchior, DF-180. Sem km nem coordenada; precisa de localização manual.

**Vigência incerta (inativas)**

- **Instrução DER-DF 148/2013** (DODF 192, 16/09/2013): caminhões proibidos na BR-040 km 7-0 e na DF-003 (EPIA) km 36-24, 06h-09h, segunda a sexta, sentido Valparaíso-Brasília; exceção para serviço público e obras do BRT Sul. A Instrução 1/2014 suspendeu por 40 dias a partir de 23/12/2013; não achei ato que a restabeleça ou revogue.
- **Instrução Conjunta DETRAN/DER 1/2008** (DODF 107, 05/06/2008): caminhões proibidos na DF-085 (EPTG) 06h30-09h (sentido Plano Piloto) e 17h30-20h (sentido Taguatinga), segunda a sexta. A IC 1/2011 a revogou e a Instrução 10, de 24/02/2011 (não localizada), tornou essa revogação sem efeito: situação indefinida. A IS 329/1978 (proibição na EPTG) já tinha sido revogada pela IS 948/1980.
- **Instrução DETRAN 98/2008**: carga e descarga nas quadras comerciais da Asa Sul e Asa Norte (SCLS e SCLN) só em dias úteis nas janelas 08h-11h30, 14h-17h e 20h-07h; sábados, domingos e feriados livres. Redação ambígua.

**Revogada:** Decreto 46.287/2024 (caminhões proibidos na DF-463 sentido São Sebastião), revogado pelo Decreto 47.208 em 09/05/2025.

**AET e fiscalização:** Instrução DER de 13/04/2005 mantém a AET para CVC com PBT combinado acima de 45 t nas vias do DER-DF (a base federal citada foi substituída; checar a regra federal atual). Instrução 5/2025 (DODF 68, 09/04/2025): tarifa R$ 97,25 (INPC), validade até 1 ano, pedido pelo site do DER-DF. Regimento do DER (Decreto 48.239/2026, Anexo, art. 2º) lista pedágio, AET/escolta e a fiscalização de excesso de peso e perigosos.

**Malha (IDE/DF, testada):** `https://www.geoservicos.ide.df.gov.br/arcgis/rest/services/Publico/SISTEMA_VIARIO/MapServer`. Camada 17 "Rodovia": 501 segmentos com rod_nome, entroncamentos inicial e final, km, situação física, jurisdição (DISTRITAL 340, VICINAL 77, FEDERAL 46, SUPERPOSTA 38), TMD e faixa de domínio; 1.417,5 km distritais e superpostos (547,9 pavimentados, 270,5 duplicados, 494,3 implantados sem pavimento). Camada 0: 764 OAE (364 pontes, 313 viadutos, 64 passarelas, 17 passarelas subterrâneas, 6 túneis); camada 5 (161 eixos de ponte) tem campos de carga máxima e vão, **todos zerados**. Licença não declarada (copyright "SEDUH").

**OSM (PBF local, recorte do DF):** nenhuma via com hgv=no ou maxweight (só ruas de pedestres e heliportos); maxheight de 5,5-6,0 m na DF-003 e 3,55-4,05 m nas passagens inferiores CLN/CLS. O Eixão, a Barragem e a ponte do Melchior ficam sem restrição no mapa (lacuna).

## 2. Pedágio

Nenhuma concessão nem pedágio distrital; o Regimento do DER só cita a competência de "imposição de pedágio". CSV de praças da ANTT (28/07/2026, CC-BY): 277 linhas, 0 com uf=DF. Mais próximas: CONCEBRA P1 Alexânia (BR-060 km 43,1, GO) e Via Cristais P1 Paracatu (BR-040 km 17,65, MG); amostra em `fontes/DF/antt_pracas_vizinhas_DF_GO_MG.csv`.

## 3. Balanças

Sem lista. O DER-DF tem a competência de fiscalizar excesso de peso, mas nenhum posto foi publicado onde consegui chegar. PPV da ANTT (45 postos): nenhum no DF (`fontes/DF/antt_ppv_vizinhos_GO_MG.csv`). Para a lista: LAI ao DER-DF.

## 4. Feriados

Distritais (Lei 72/1989, art. 1º: 21/04 e Sexta-feira da Paixão e Corpus Christi; 12/10 já nacional; Lei 963/1995: 30/11 Dia do Evangélico; Lei 1.701/1997: 02/11, já nacional). O Decreto 48.117/2025 divulga os de 2026 e marca como ponto facultativo (não feriado) 02/01, 16-17/02, 18/02 até 14h, 20/04, 05/06, 28/10 e 24 e 31/12 após 14h. Sem feriados municipais: Brasília é o único município (IBGE 5300108). O importador precisa de `'53':'DF'` em `UF_BY_PREFIX`.

## 5. Produtos perigosos

Sequência do DER-DF em 2018: Instrução 17 (12/11) revogada pela 19 (14/11), revogada pela 21 (18/12), revogada pela **Instrução 1, de 31/01/2019**. Eram 06h-09h e 17h30-19h15 na DF-095, DF-075, DF-085, DF-001 (pistão, da DF-075 à DF-095) e DF-003, e proibição total perto da Barragem do Paranoá. Hoje nada disso vale. Resta a IS DETRAN 576/1984 (proíbe carga perigosa a granel ou de elevada periculosidade, exceto GLP, na W/3 Norte e Sul, nos setores comerciais e bancários, nas avenidas comerciais de Taguatinga e nas quadras residenciais; baseada em decreto federal já substituído, vigência prática duvidosa). Órgão ambiental: IBRAM (Brasília Ambiental), Instrução 82/2009: licença ambiental específica para transportar produto perigoso no DF; é licença do transportador, sem trecho.

## 6. Acidentes

RENAEST (Senatran, domínio público; ZIP de 529 MB lido em fluxo): 332.101 acidentes do DF de 01/2018 a 31/05/2026.

| Ano | Acidentes | Coordenada válida | Com caminhão, cavalo, semirreboque ou reboque | Destes com coordenada | Óbitos |
|---|---|---|---|---|---|
| 2018 | 8.105 | 7.817 | 253 | 241 | 28 |
| 2019 | 8.609 | 8.266 | 292 | 286 | 33 |
| 2020-2024 | 43.115 a 57.400 por ano | 0 | 2.727 a 3.751 por ano | 0 | 4 a 23 |
| 2025 | 53.084 | 52.762 | 3.587 | 3.538 | 38 |
| 2026 (jan-mai) | 10.433 | 10.334 | 755 | 747 | 14 |

De 2020 a 2024 a coordenada vem "-0000000000". O campo tp_rodovia é "NAO INFORMADO" em 92% a 98% dos registros de 2020-2026 e o km vem sempre "0000", então a separação distrital/urbana exige cruzamento espacial: das 3.538 coordenadas de caminhão de 2025, 563 caem a até 40 m de rodovia da camada 17 do IDE/DF (DF-003 129, DF-075 86, DF-001 superposta 67, BR-010 27, DF-095 25, BR-070 20, BR-060 16, DF-085 15, BR-251 15). Amostra: `fontes/DF/renaest_df_caminhao_2025_amostra300.csv`. Base própria do DETRAN-DF/CPRv/SSP-DF não encontrada (dados.df.gov.br não abriu; WebSearch sem resultado).

## 7. Roubo e furto de carga

Sinesp VDE (xlsx nacional, licença não declarada): DF tem "Roubo de carga" estadual com município "NÃO INFORMADO": 5 em 2025 (abril 1, junho 3, dezembro 1) e 1 em 2026 (julho), provável subnotificação. A série histórica da SSP-DF (atualizada em 10/09/2026) traz crimes patrimoniais por RA e ano, sem roubo de carga. Para agregado útil: LAI. Amostras: `fontes/DF/sinesp_vde_roubo_carga_DF_2025_2026.csv` e `fontes/DF/ssp_df_serie_roubo_de_veiculo_por_RA_amostra.csv`.

## 8. Particularidades para caminhão

Eixão fechado e vedado a pesados; Barragem do Paranoá e ponte do Melchior só até 2 eixos simples; passagens subterrâneas das tesourinhas com 3,55-4,05 m no OSM, sem ato do DER; sem balsa, serra, regra de safra ou free flow; AET do DER-DF para cargas especiais; Lei 6.404/2019 sobre pontos de apoio a caminhoneiros (só ementa lida). BRs que cruzam o DF: 010, 020, 030, 040, 050, 060, 070, 251 (46 segmentos FEDERAL e 38 SUPERPOSTA no IDE/DF). Atenção ao teste de `ufAt` (bbox do DF dentro do de GO).

## Pendências

Ver lista no fim de `DF.json`. Principais: portarias do DER/DETRAN fora do SINJ (sites fora do ar), Instrução 10/2011 da EPTG, vigência da Instrução 148/2013, localização da ponte do Melchior, definição de "pesados", lista de balanças (LAI), sinistros do DETRAN-DF para 2020-2024, termos de uso do IDE/DF.
