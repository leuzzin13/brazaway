# Distrito Federal (DF): fontes oficiais para caminhão (pesquisa de 18/10/2026)

Somente leitura no repositório. Textos e amostras em `fontes/DF/` (cerca de 1 MB); brutos grandes ficaram em área de rascunho e foram apagados. Detalhe completo em `DF.json`. O DF é unidade única: não há "estadual" separado nem municípios. Órgão rodoviário: DER-DF (Departamento de Estradas de Rodagem do DF); trânsito urbano e infrações: DETRAN-DF.

Limite desta pesquisa: os sites `der.df.gov.br`, `detran.df.gov.br`, `dados.df.gov.br`, `dadosabertos.df.gov.br`, `geoportal.seduh.df.gov.br` e `dodf.df.gov.br` não abriram deste ambiente (timeout no TLS ou 502 do proxy; não contornei). Li os atos no SINJ (sinj.df.gov.br) e a malha no ArcGIS REST do IDE/DF (www.geoservicos.ide.df.gov.br), que abriram. A busca do SINJ indexa a ementa, não o texto integral: portaria com ementa genérica pode ter escapado.

**Verificado em 2026-10-18 (segunda passada cética):** atos reabertos no SINJ, malha e OAE recontadas no IDE/DF, CSVs da ANTT, Sinesp VDE e RENAEST recontados nas fontes. Principais correções: trecho da Barragem do Paranoá (agora DF-001 km 17,0-17,9, não 17,9-19,8), Instrução DER 10/2011 localizada, IN DER 4/2025 acrescentada ao Eixão, candidata de localização para a ponte do Melchior (DF-180 km 19,5), limite de 45 t de AET rebaixado a informação e `km_via_acidente` do RENAEST (não é sempre 0000). Cada seção traz uma linha "verificado em 2026-10-18" e o detalhe está em `DF.json` (campo `verificacao_2026_10_18`).

## Resumo em uma tela

| Tema | O que existe | Pronto para importar? |
|---|---|---|
| 1. Restrições em rodovias | 8 atos achados. Valem: Eixão DF-002 (pesados proibidos todos os dias; fechado a todos nos domingos e feriados, 06h-18h), Barragem do Paranoá DF-001 (km 17,0-17,9 no IDE/DF) e Ponte do Rio Melchior DF-180 (caminhão com mais de 2 eixos simples; Melchior sem km no ato, candidata em km 19,5). Inativos por vigência incerta: BR-040/EPIA 06h-09h (2013), EPTG (2008), carga e descarga SCLS/SCLN (2008). DF-463 revogada em 2025. Sem portaria de feriado prolongado, limite de peso/altura por trecho, safra ou rodotrem. AET: tarifa R$ 97,25 (04/2025); o limite de 45 t de CVC é de uma instrução de 2005 e não vale como regra federal atual | Malha e OAE sim (IDE/DF testado); regras: DF-002 e Barragem sim (trecho corrigido), Melchior manual; licença do IDE/DF não declarada |
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
- **IN DER-DF 3/2024** (DODF 203/204, 22-23/10/2024; alterada pela IN 1/2025, DODF 21 de 30/01/2025, e pela IN 4/2025, DODF 63 de 02/04/2025; nenhuma mexe no horário): Eixão do Lazer, domingos e feriados, 06h-18h, trânsito de automotores interrompido; carga e descarga só nas áreas de estacionamento previstas. Base legal: Lei 4.757/2012 (art. 2º) e Decreto 46.226/2024 (art. 2º), que dizem "domingos e feriados" sem o "nacionais" do Decreto 32.563/2010: o DER não esclarece se Corpus Christi e 30/11 (feriados distritais) fecham o Eixão.
- **Instrução DER-DF 3/2019** (DODF 33, 15/02/2019): proíbe caminhões com configuração superior a dois eixos simples sobre a Barragem do Paranoá (DF-001, EPCT). O art. 2º diz vigor em 01/03/2018 (erro material provável). **Trecho corrigido em 2026-10-18:** a barragem está no segmento IDE/DF 001EDF0070 (DF-001 km 17,0-17,9), em cerca de km 17,35-17,86; o km 17,9-19,8 (segmento 001EDF0090) citado antes começa depois do entroncamento DF-025(A)/Barragem. A ponte da camada 0 do IDE/DF (objectid 714) e a via OSM "Barragem do Paranoá" (ref DF-001, bridge=yes, de lat -15.8021559 lon -47.7858248 a lat -15.797697 lon -47.7838566, cerca de 520 m, sem hgv) caem a menos de 7 m do eixo desse segmento.
- **Instrução DER-DF 14/2021** (DODF 245, 31/12/2021): idem sobre a Ponte do Rio Melchior, DF-180. O ato não traz km nem coordenada; candidata triangulada em 2026-10-18: DF-180 km 19,5 (matéria da Codevasf de 15/09/2025), lat -15.85753 lon -48.17701 (única PONTE do segmento IDE/DF 180EDF0290 e via OSM com bridge=yes a cerca de 30 m). A mesma matéria diz que a estrutura atual é provisória e que uma ponte nova de 50 m e 45 t de PBT estava prevista para 05/2026 (entrega não confirmada): a regra segue inativa até o DER dizer qual estrutura ela cobre.

**Vigência incerta (inativas)**

- **Instrução DER-DF 148/2013** (DODF 192, 16/09/2013): caminhões proibidos na BR-040 km 7-0 e na DF-003 (EPIA) km 36-24, 06h-09h, segunda a sexta, sentido Valparaíso-Brasília; exceção para serviço público e obras do BRT Sul. A Instrução 1/2014 suspendeu por 40 dias a partir de 23/12/2013; não achei ato que a restabeleça ou revogue.
- **Instrução Conjunta DETRAN/DER 1/2008** (DODF 107, 05/06/2008): caminhões proibidos na DF-085 (EPTG) 06h30-09h sentido Taguatinga-Plano Piloto e 17h30-20h sentido Plano Piloto-Taguatinga, segunda a sexta (a versão anterior deste texto trocava os sentidos). A IC 1/2011 a revogou e a Instrução 10, de 24/02/2011 (não localizada), tornou essa revogação sem efeito: situação indefinida; a Instrução DER 10, de 24/02/2011, foi **localizada em 2026-10-18** (SINJ ch_norma 67417; DODF 40, 25/02/2011): "torna sem efeito" a IC 1/2011 e a Instrução de 15/02/2011, por ato só do Diretor-Geral do DER (a IC 1/2011 era conjunta com o DETRAN), o que indica que a revogação foi anulada e a IC 1/2008 não deixou de valer, mas o SINJ ainda a marca como Revogada e não há prova de sinalização: segue inativa. A IS 329/1978 (proibição na EPTG) já tinha sido revogada pela IS 948/1980.
- **Instrução DETRAN 98/2008**: carga e descarga nas quadras comerciais da Asa Sul e Asa Norte (SCLS e SCLN) só em dias úteis nas janelas 08h-11h30, 14h-17h e 20h-07h; sábados, domingos e feriados livres. Redação ambígua.

**Revogada:** Decreto 46.287/2024 (caminhões proibidos na DF-463 sentido São Sebastião), revogado pelo Decreto 47.208 em 09/05/2025.

**AET e fiscalização:** Instrução DER de 13/04/2005 mantém a AET para CVC com PBT combinado acima de 45 t nas vias do DER-DF; ela se apoia na Resolução CONTRAN 164/2004 e numa decisão da 3ª Vara Federal (dispensa de AET entre 45 t e 57 t só após sinalização das vias). A regra federal hoje é outra (a Resolução CONTRAN 211/2006, que exigia AET acima de 57 t, foi revogada pela 882/2021; o texto atual da 882 não foi conferido): **não usar 45 t como regra de AET**, só como informação do DER-DF. Instrução 5/2025 (DODF 68, 09/04/2025): tarifa R$ 97,25 (INPC), validade até 1 ano, pedido pelo site do DER-DF. Regimento do DER (Decreto 48.239/2026, Anexo, art. 2º, X e XIX; revoga o Decreto 37.949/2017, base de competência citada nas Instruções 3/2019 e 14/2021) lista pedágio, AET/escolta e a fiscalização de excesso de peso e perigosos.

**Malha (IDE/DF, testada):** `https://www.geoservicos.ide.df.gov.br/arcgis/rest/services/Publico/SISTEMA_VIARIO/MapServer`. Camada 17 "Rodovia": 501 segmentos com rod_nome, entroncamentos inicial e final, km, situação física, jurisdição (DISTRITAL 340, VICINAL 77, FEDERAL 46, SUPERPOSTA 38), TMD e faixa de domínio; 1.417,5 km distritais e superpostos (547,9 pavimentados, 270,5 duplicados, 494,3 implantados sem pavimento). Os km saem do campo `rod_extreal_km` (`rod_extensao_km` soma 1.405,6). Camada 0: 764 OAE (364 pontes, 313 viadutos, 64 passarelas, 17 passarelas subterrâneas, 6 túneis); camada 5 (161 eixos de ponte) tem campos de carga máxima e vão, **todos zerados**. Licença não declarada (copyright "SEDUH"; o portal www.ide.df.gov.br é um app JS sem página de termos acessível).

**OSM (PBF local, recorte do DF):** nenhuma via com hgv=no ou maxweight (só ruas de pedestres e heliportos); maxheight de 5,5-6,0 m na DF-003 e 3,55-4,05 m nas passagens inferiores CLN/CLS. O Eixão, a Barragem e a ponte do Melchior ficam sem restrição no mapa (lacuna).

**Verificado em 2026-10-18:** Decreto 32.563/2010 (e 38.571/2017 e 13.250/1991), IN DER 3/2024, Instruções DER 3/2019, 14/2021, 148/2013 e 1/2014, IC 1/2008 e 1/2011, Instrução 98/2008, Decretos 46.287/2024 e 47.208/2025, Instruções DER de 2005 e 5/2025 e Decreto 48.239/2026 relidos no SINJ: textos, artigos, horários e DODF batem com as cópias locais (idênticas). Nenhuma revogação nova; o campo de situação do SINJ para o Decreto 46.287 ainda diz "Sem Revogação Expressa" apesar de o 47.208 revogá-lo. Novas buscas no SINJ (caminhões, veículos pesados, Eixão, BR-040, EPTG, DF-003, DF-180, Barragem, AET, carga e descarga) não acharam outra restrição de caminhão. Malha e OAE: contagens e quilometragens conferem (ver `DF.json`). `pronto_para_importar` mantido (malha true com licença pendente; regras parcial).

## 2. Pedágio

Nenhuma concessão nem pedágio distrital; o Regimento do DER só cita a competência de "imposição de pedágio". CSV de praças da ANTT (28/07/2026, CC-BY): 277 linhas, 0 com uf=DF. Mais próximas: CONCEBRA P1 Alexânia (BR-060 km 43,1, GO, lat -16.115707 lon -48.58924) e Via Cristais P1 Paracatu (BR-040 km 17,65, MG); amostra em `fontes/DF/antt_pracas_vizinhas_DF_GO_MG.csv`.

**Verificado em 2026-10-18:** CSV baixado do CKAN da ANTT (277 linhas de dados, CC-BY, atualizado em 28/07/2026): 0 linhas com uf=DF; Alexânia e Paracatu conferem. Free flow da Rota Verde Goiás: 8 praças na BR-060 (Abadia de Goiás km 172,0 e 182,6, Indiara, Jandaia e Acreúna), todas em GO. Nada a importar do DF.

## 3. Balanças

Sem lista. O DER-DF tem a competência de fiscalizar excesso de peso, mas nenhum posto foi publicado onde consegui chegar. PPV da ANTT (45 postos): nenhum no DF (`fontes/DF/antt_ppv_vizinhos_GO_MG.csv`). Para a lista: LAI ao DER-DF.

**Verificado em 2026-10-18:** PPV da ANTT (45 linhas, CC-BY, atualizado em 28/08/2026) sem posto no DF; PPV 01 e 02 da Ecovias Minas Goiás (BR-050, Ipameri-GO) conferem; Regimento do DER-DF e Instrução 5/2025 (art. 13) conferidos; sem lista pública de balanças. `pronto_para_importar` segue false.

## 4. Feriados

Distritais (Lei 72/1989, art. 1º: 21/04 e Sexta-feira da Paixão e Corpus Christi; 12/10 já nacional; Lei 963/1995: 30/11 Dia do Evangélico; Lei 1.701/1997: 02/11, já nacional). O Decreto 48.117/2025 divulga os de 2026 e marca como ponto facultativo (não feriado) 02/01, 16-17/02, 18/02 até 14h, 20/04, 05/06, 28/10 e 24 e 31/12 após 14h. Sem feriados municipais: Brasília é o único município (IBGE 5300108). O `UF_BY_PREFIX` do importador já tem `'53':'DF'` (linha 54 de `importers/sources/feriados_sudeste.py`, conferido em 2026-10-18). Além dos pontos facultativos do Decreto 48.117, há mais dois em 2026: 02/04 (Decreto 48.448) e 29/06 (Decreto 48.831); também não são feriado.

**Verificado em 2026-10-18:** Leis 72/1989, 963/1995 e 1.701/1997 e Decreto 48.117/2025 relidos no SINJ (todas Sem Revogação Expressa; o Decreto marca 21/04 e Corpus Christi como feriados locais, Paixão e 12/10 como nacionais); buscas por "feriado" não acharam outra lei distrital. `pronto_para_importar`: distritais true, municipal não se aplica.

## 5. Produtos perigosos

Sequência do DER-DF em 2018: Instrução 17 (12/11) revogada pela 19 (14/11), revogada pela 21 (18/12), revogada pela **Instrução 1, de 31/01/2019**. Eram 06h-09h e 17h30-19h15 na DF-095, DF-075, DF-085, DF-001 (pistão, da DF-075 à DF-095) e DF-003, e proibição total perto da Barragem do Paranoá. Hoje nada disso vale. Resta a IS DETRAN 576/1984 (proíbe carga perigosa a granel ou de elevada periculosidade, exceto GLP, na W/3 Norte e Sul, nos setores comerciais e bancários, nas avenidas comerciais de Taguatinga e nas quadras residenciais; baseada em decreto federal já substituído, vigência prática duvidosa). Órgão ambiental: IBRAM (Brasília Ambiental), Instrução 82/2009: licença ambiental específica para transportar produto perigoso no DF; é licença do transportador, sem trecho.

**Verificado em 2026-10-18:** a sequência 17, 19, 21/2018 e 1/2019 foi relida nos textos e nos vides do SINJ (a Instrução 1/2019 chama a revogada de "Instrução de Serviço 021, de 18 de novembro de 2018", mas a identifica pelo DODF 240, p. 32: é a de 18/12/2018). IBRAM 82/2009: só o art. 10 (tabela de preços) foi revogado (Decreto 36.992/2015); os demais artigos seguem. IS DETRAN 576/1984 relida (DODF 111 Suplemento, 11/06/1984; base: Decreto federal 88.821/1983, substituído pelo Regulamento do Decreto 96.044/1988). Nenhuma restrição viária vigente de perigosos. `pronto_para_importar` segue false.

## 6. Acidentes

RENAEST (Senatran, domínio público; ZIP de 529 MB lido em fluxo): 332.101 acidentes do DF de 01/2018 a 31/05/2026.

| Ano | Acidentes | Coordenada válida | Com caminhão, cavalo, semirreboque ou reboque | Destes com coordenada | Óbitos |
|---|---|---|---|---|---|
| 2018 | 8.105 | 7.817 | 253 | 241 | 28 |
| 2019 | 8.609 | 8.266 | 292 | 286 | 33 |
| 2020-2024 | 43.115 a 57.400 por ano | 0 | 2.727 a 3.751 por ano | 0 | 4 a 23 |
| 2025 | 53.084 | 52.762 | 3.587 | 3.538 | 38 |
| 2026 (jan-mai) | 10.433 | 10.334 | 755 | 747 | 14 |

De 2020 a 2024 a coordenada vem "-0000000000". O campo tp_rodovia é "NAO INFORMADO" em 92% a 98% dos registros de 2020-2026 e o km vem "0000" em todos os registros de 2020-2025 (só 2018, 2019 e 2026 têm km: 2.762, 2.874 e 36 registros), então a separação distrital/urbana exige cruzamento espacial: das 3.538 coordenadas de caminhão de 2025, 563 caem a até 40 m de rodovia da camada 17 do IDE/DF (DF-003 129, DF-075 86, DF-001 superposta 67, BR-010 27, DF-095 25, BR-070 20, BR-060 16, DF-085 15, BR-251 15). Amostra: `fontes/DF/renaest_df_caminhao_2025_amostra300.csv`. Base própria do DETRAN-DF/CPRv/SSP-DF não encontrada (dados.df.gov.br não abriu; WebSearch sem resultado).

**Verificado em 2026-10-18 (recontagem integral do ZIP de 529 MB, lido em fluxo):** 332.101 acidentes do DF, totais por ano, coordenadas válidas (bbox lat -16,10..-15,40 e lon -48,40..-47,15), 420.043 linhas e 564.033 veículos, acidentes e óbitos com caminhão/reboque/semirreboque e o cruzamento espacial de 2025 (563 de 3.538 a até 40 m de rodovia da camada 17) conferem com a tabela acima; DF-001 sobreposta a BR-251 dá 77+16 nesta recontagem contra 67+15 (desempate entre feições sobrepostas). Correções: `km_via_acidente` não é sempre 0000 e a lista de colunas era parcial (35 colunas). Licença CKAN: Outra (Domínio Público). Resumo em `fontes/DF/renaest_df_verificacao_20261018.json`. `pronto_para_importar` segue true com ressalvas.

## 7. Roubo e furto de carga

Sinesp VDE (xlsx nacional; licença não declarada no arquivo, mas o portal gov.br/mj declara CC BY-ND 3.0 no rodapé do site, o que restringe obras derivadas): DF tem "Roubo de carga" estadual com município "NÃO INFORMADO": 5 em 2025 (abril 1, junho 3, dezembro 1) e 1 em 2026 (julho), provável subnotificação. A série histórica da SSP-DF (atualizada em 10/09/2026) traz crimes patrimoniais por RA e ano, sem roubo de carga. Para agregado útil: LAI. Amostras: `fontes/DF/sinesp_vde_roubo_carga_DF_2025_2026.csv` e `fontes/DF/ssp_df_serie_roubo_de_veiculo_por_RA_amostra.csv`.

**Verificado em 2026-10-18:** xlsx de 2025 (até 12/2025) e de 2026 (até 08/2026) baixados e lidos: "Roubo de carga" Estadual, município "NÃO INFORMADO": 5 em 2025 (abril 1, junho 3, dezembro 1) e 1 em 2026 (julho). SSP-DF (página atualizada em 10/09/2026): crimes patrimoniais por RA em dois arquivos (2000-2010 e 2011-2022), sem roubo de carga e sem sinistros. `pronto_para_importar` segue false.

## 8. Particularidades para caminhão

Eixão fechado e vedado a pesados; Barragem do Paranoá (DF-001 km 17,0-17,9) e ponte do Melchior (DF-180, candidata em km 19,5) só até 2 eixos simples; passagens subterrâneas das tesourinhas com 3,55-4,05 m no OSM, sem ato do DER; sem balsa, serra, regra de safra ou free flow; AET do DER-DF para cargas especiais; Lei 6.404, de 30/10/2019, sobre pontos de apoio a caminhoneiros (só ementa lida). BRs na camada Rodovia do IDE/DF: 010, 020, 040, 060, 070 e 251 em `rod_nome` (030, 050, 080 e 479 só nos códigos federais), em 46 segmentos FEDERAL e 38 SUPERPOSTA. Atenção ao teste de `ufAt` (bbox do DF dentro do de GO).

**Verificado em 2026-10-18:** itens conferidos contra as seções acima; OSM relido (27 vias hgv=no, todas de pedestres; 3,55 a 4,05 m nas tesourinhas; os "3 m" e "4 m" são cancelas); `ufAt` confirmado em `api/src/services/geocoder/municipios.ts` (escolhe a UF de menor bbox); o PBF central-west-latest não existe mais, usei sse_co.osm.pbf (somente leitura).

## Pendências

Ver lista no fim de `DF.json`. Principais: portarias do DER/DETRAN fora do SINJ (sites fora do ar), sinalização e fiscalização da EPTG de 2008 (a Instrução 10/2011 foi achada em 2026-10-18), vigência da Instrução 148/2013, confirmação da ponte do Melchior (candidata em DF-180 km 19,5; ponte nova prevista para 05/2026), definição de "pesados" e se o Eixão fecha em feriados só distritais, regra federal atual de AET para CVC, lista de balanças (LAI), sinistros do DETRAN-DF para 2020-2024, termos de uso do IDE/DF e licença do Sinesp.
