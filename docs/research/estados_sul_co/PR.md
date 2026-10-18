# Paraná (PR): fontes oficiais para caminhão (pesquisa de 18/10/2026)

Somente leitura no repositório. Amostras e textos extraídos em `fontes/PR/` (menos de 1 MB no total). Detalhe completo em `PR.json`.

## Resumo em uma tela

| Tema | O que existe | Pronto para importar? |
|---|---|---|
| 1. Restrições em rodovias estaduais | 22 atos DER/PR de peso/comprimento/eixos, todos 24 h. Não há portaria de horário de feriado, serra ou travessia urbana. Exceções de horário: ferry boat de Guaratuba. Graciosa proíbe carga >= 16 t | Parcial: 6 portarias têm código de trecho SRE com km e geometria no WFS (16 de 21 códigos achados). As outras 15 exigem curadoria manual |
| 2. Pedágio | Nenhuma concessão estadual. Os 6 lotes novos são ANTT (rodovias estaduais delegadas + BRs): 43 praças nos lotes + 4 das Autopistas, todas no CSV da ANTT (CC-BY) | Sim (CSV testado, 47 linhas de PR). Tarifa só em HTML para a Via Araucária; os outros lotes estão em imagem |
| 3. Balanças | Sem base aberta. DER/PR opera balanças (Guaratuba km 8+000 e Matinhos confirmadas em 06/2026) | Não |
| 4. Feriados | Nenhum feriado estadual (Lei 18.384/2014). Municipais: Decreto Judiciário TJPR 621/2025 (municípios sede de comarca, ~165 cidades) | Estadual: regra vazia pronta. Municipal: parcial (PDF, falta parser) |
| 5. Perigosos | Sem ato estadual de PP por trecho. Regras só no ferry (travessia isolada) e Graciosa | Não há o que importar; PDF de sinistros com PP é opcional |
| 6. Acidentes | BATEU não é aberto. DER publica anuário agregado em PDF. RENAEST tem 117 mil acidentes de PR em 2025, 0% com coordenada | Não |
| 7. Roubo de carga | Sem coordenada e sem categoria "carga" nos relatórios SESP | Não |
| 8. Particularidades | Ponte de Guaratuba, Graciosa, ponte do Rio Ivaí, bitrem/rodotrem por AET, OAEs sem limite | n/a |

## 1. Rodovias estaduais (DER/PR, SEIL)

Fonte da lista: `https://www.der.pr.gov.br/Pagina/Restricao-de-Trafego`. O texto de cada ato foi lido no portal da Casa Civil (`legislacao.pr.gov.br`, "Este texto não substitui o publicado no DOE"). Três portarias antigas (481/2005, 421/2005, 318/2009) só existem como PDF de página do DOE. Licença: ato oficial, domínio público (Lei 9.610/1998, art. 8º, IV). Dados em `portarias_restricao_texto.txt`.

| Ato | Rodovia e trecho | Limite | Obs. |
|---|---|---|---|
| Port. 481/2005 | PR-534 Centenário do Sul - Miraselva (19,16 km) | PBTC > 25 t proibido | só PDF do DOE |
| Port. 421/2005 | PR-489 Porto Camargo - Porto Figueira - Alto Paraíso; PR-485 Alto Paraíso - Casa Branca; PR-182 Casa Branca - Pérola/Xambrê; PR-489 Xambrê - Umuarama | PBTC > 45 t proibido | item 2: cargas de/para MS pela ponte de Porto Camargo seguem por Icaraíma, Ivaté, Serra dos Dourados |
| Port. 318/2009 (11/11/2009) | PR-518 Entr. BR-369 - Porto Quebra Canoa | PBTC 45 t | |
| Port. 010/2010 (08/02/2010) | PR-160 Distrito Paranagi - Entr. PR-323 (Mariporã) | PBT > 25 t, > 14 m | |
| Port. 095/2010 (05/04/2010) | PR-151 Ribeirão Claro - divisa SP | PBTC 45 t, 16 m | |
| Port. 158/2010 (24/05/2010) | PR-281 Entr. BR-476 - Rio Claro do Sul - Mallet; PR-433 Entr. PR-427 - Água Azul - Entr. BR-476 | PBTC 45 t, 16 m | |
| Port. 319/2010 (09/11/2010) | PR-092 Rio Branco do Sul - Cerro Azul | PBTC 45 t, 17,50 m | o site do DER diz 16 m; vale o ato |
| Port. 284/2011 | PR-680 Entr. PR-482 - Vila Formosa (20 km) | PBT > 45 t | |
| Port. 299/2012 | PR-364 BR-277 - Goioxim; PR-825 PR-364 - Campina do Simão | PBT > 45 t | |
| Port. 356/2012 | PR-683 Porto Figueira - Porto Camargo | PBT > 45 t | |
| Port. 518/2012 | PR-482 Cidade Gaúcha - Tapira (15,07 km) | PBT > 45 t | |
| Port. 519/2012 | PR-561 Nova Aliança do Ivaí - Paranavaí (14,3 km) | PBT > 45 t | |
| Port. 094/2013 | PR-586 Entr. BR-163 - Entr. BR-277 | PBT > 25 t | |
| Port. 095/2016 | PR-408 BR-277 (Passa Sete) - PR-804: PBTC > 26 t; PR-804 e PR-408 até Morretes/Antonina: limites da Res. CONTRAN | 26 t no trecho (a) | revoga 024/2005 |
| Port. 280/2020 e 286/2020 | PR-447 (447S0030EPR, km 3,73-49,34) Entr. BR-153 - Cruz Machado | PBTC 45 t | a 286 só corrige o cabeçalho |
| Port. 365/2022 | PR-691 (691S0010EPR) Porto Rico - Porto São José | PBTC > 16 t | |
| Port. 501/2022 | PRC-476 (476S0160PRC, km 363,7-363,93) ponte Manoel Ribas - União da Vitória | PBTC > 25 t | |
| Port. 075/2023 (24/03/2023), arts. 1º e 2º | PR-410 Estrada da Graciosa, km 3-19,2 (súmula diz 0-19,2) | carga >= 16 t proibida; só passeio, vans e ônibus até 9 m x 2,50 m (linha regular até 14 m x 4,40 m) | revoga 313/2021 |
| Port. 239/2026 (17/04/2026), arts. 1º e 2º | PR-412, PR-807, PR-508: 10 trechos em Guaratuba e Matinhos (Ponte de Guaratuba) | PBT/PBTC <= 26 t E <= 18,60 m E <= 4 eixos | 5 dos 10 códigos SRE não existem no SRE 2024 |
| Port. 451/2026 (09/07/2026), arts. 1º e 2º | PRC-466 km 80,790-97,050; PRC-272 km 239,62-254,64 (Cruzmaltina, Lidianópolis) | PBT/PBTC <= 36 t | 5 trechos SRE, todos achados |
| Port. 414/2012 (17/09/2012) | PR-412 de Prainha aos atracadouros do ferry e ramais | PBT > 26 t proibido | sobreposição com a 239/2026 não resolvida |
| Port. 702/2025 (02/12/2025), arts. 1º a 3º | ferry boat de Guaratuba | > 3 eixos só dias úteis 00h-06h de 19/12/2025 a 22/02/2026; carnaval 13-18/02/2026 proibido; PP isolado | vencida pelo prazo; ferry fora de operação em 10/10/2026 |

Liberação de CVC por AET (não restringe, libera): Port. 029/2022 (bitrem longo, 57-74 t, 19,80-30 m, AET até 30 unidades tracionadas) com emendas 371/2022, 332/2024, 363/2024, 106/2025, 172/2025, 478/2026; Port. 368/2022 (bitrem curto 19,80 m, tracionadoras licenciadas até 31/12/2011, AET até 10 unidades) com 148/2023, 328/2023, 333/2024, 107/2025; Port. 362/2021 (canavieiro, álcool, açúcar, vinhaça) com 019/2023, 421/2024, 326/2026, 529/2026. Os anexos (rodovia + trecho) estão extraídos em `fontes/PR/portaria_*_anexoI*.txt`.

Geometria testada: WFS `https://geoserver.pr.gov.br/geoserver/ows` camada `seil_der:sistema_rodoviario_lin_p31982` (2.268 trechos, campos trecho, km_inicial, km_final, jurisdicao, resp). Também `https://sider.der.pr.gov.br/geoserver/wfs` camada `derpr:VGEOTRECHO` (SRE por ano 2012-2024). Shapefile do SRE 2021 (4,4 MB) e SRE 2024 em PDF (Decreto 9.774/2025) também baixáveis.

## 2. Pedágio

Não existe concessão estadual vigente. O Anel de Integração (1997-2021) acabou; os lotes 1 a 6 são da ANTT (Convênios de Delegação, ACT 04/2023). Detalhe de lotes, free flow e armadilhas em `PR.json`.

- Praças: CSV da ANTT (`dados.antt.gov.br`, pacote `praca-de-pedagio`, CC-BY, atualizado em 28/07/2026): 47 linhas de PR. Lotes: Via Araucária 5, EPR Litoral Pioneiro 8, Motiva Paraná 7, EPR Paraná 10 (com duplicatas por sentido e validador), Via Campo 3, EPR Iguaçu 10. Mais 4 praças das Autopistas (federais).
- Free flow: EPR Iguaçu P1 (BR-163 Santa Lúcia, norte e sul), P8 (PR-182 Ampére), P9 (PR-280 Vitorino); EPR Paraná P5 a P8; Motiva P2 (Mauá da Serra) e P7 (PR-445, Londrina).
- Armadilha: no CSV, rodovias estaduais vêm sem o prefixo ("280", "182", "444", "445", "323", "317", "092", "151").
- Tarifa por eixo transcrita (ANTT, Via Araucária, atualizada em 28/08/2026), 5 eixos em R$: P1 49,00; P2 61,50; P3 57,50; P4 56,50; P5 64,50. Os demais lotes publicam imagem; a página ANTT da EPR Paraná está vazia.
- Camada `seil_der:pedagio_pto_p4674` do geoserver é de 2013 (modelo antigo): não importar.
- Ferry boat de Guaratuba: Decreto 4.456/2023 (cobrança a partir de 01/01/2024; reajuste anual por IPCA): caminhão 3 eixos R$ 26,70; semirreboque 5 eixos R$ 44,50; 9 eixos R$ 80,10.

## 3. Balanças

Sem dataset. Confirmado em 02/06/2026 (AEN): duas balanças na PR-412, Guaratuba (km 8+000, 3.477 veículos de carga fiscalizados em abril/2026 e 3.315 em maio/2026) e Matinhos. Em 2023: cinco estáticas na SR Oeste (PRC-467, PR-180, PRC-280, PR-317, PR-488, deslocáveis), duas na PR-151 em Piraí do Sul. A lista oficial atual precisa ser pedida por LAI. O geoserver tem 60 postos fiscais agropecuários da SEAB (não são balanças).

## 4. Feriados

- Estadual: **nenhum**. Lei 18.384, de 17/12/2014, art. 1º ("não se constituindo em feriado civil"), art. 2º (ponto facultativo por decreto), art. 3º (revoga a Lei 4.658/1962). Texto em `fontes/PR/lei_18384_2014_texto.txt`.
- Municipal: não há base estadual. Fonte primária testada: Decreto Judiciário TJPR 621/2025, art. 4º (PDF de 7 páginas): ~165 cidades sede de comarca, ~350 datas em 2026. Exclusões necessárias: "Instalação da Comarca" (só Judiciário), datas transferidas, Dia da Justiça (18/12), Dia do Funcionário Público (30/10). Corpus Christi 2026 = 04/06; Padroeira de Curitiba = 08/09.
- Método igual ao do Sudeste (TJMG/TJSP): repetir todo ano com o decreto novo (sai até 19/12, CNJ Rec. 44/2020). Querido Diário é complemento, não testado aqui.

## 5. Produtos perigosos

Nenhum ato estadual (DER/PR ou IAT) por trecho, manancial, túnel ou ponte foi localizado; a página do DER remete à ANTT. Regras estaduais achadas: travessia isolada no ferry (Port. 702/2025, art. 2º; janelas IMO da operadora às 09:00/13:00 de Guaratuba e 08:00/12:00 de Caiobá, segunda a sexta) e a proibição de carga >= 16 t na Graciosa. Há PDF do DER de sinistros com PP (2019 a jun/2023, ~65 linhas com rodovia, km, trecho SRE e município) e um polígono de "áreas de interesse de manancial" no geoserver, sem ato associado.

## 6. Acidentes

- DER/PR: Anuário Estatístico de Segurança Rodoviária 2025 (60 páginas, base BATEU georreferenciada ao SRE); gráficos em imagem, sem coordenada, sem licença aberta declarada.
- BATEU: sistema de registro; sem download.
- DETRAN: painel Qlik sem download.
- RENAEST (Senatran, domínio público, zip acumulado de 529 MB lido por HTTP Range): PR tem 117.108 acidentes em 2025 (107.642 em 2024), 88% em via municipal, 5.728 em estadual e 8.211 sem informação. **Nenhum acidente do PR tem coordenada em nenhum ano (2018-2026)**, portanto não vira camada. Veículos em 2025: 14.576 caminhões, 1.358 caminhões-trator, 1.518 semirreboques. Resumo em `fontes/PR/renaest_pr_2025_resumo.json`.
- Conclusão: para acidentes com coordenada no PR só a PRF (BRs). Rodovias estaduais ficam sem camada até haver acordo para obter o BATEU.

## 7. Roubo e furto de carga

O relatório estatístico criminal da SESP/CAPE 2025 (fonte BOU, 19/03/2026) tem tabelas de furtos e roubos por município e por ambiente/veículo, mas nenhuma categoria "carga" e nenhuma coordenada. Painel Qlik sem download. O que existe de útil é o agregado do Sinesp (federal).

## 8. Particularidades para caminhão

- Ponte de Guaratuba: 26 t, 18,60 m, 4 eixos (Port. 239/2026). Ferry fora de operação em 10/10/2026 segundo a operadora; regra sazonal de horário e carnaval (Port. 702/2025) já vencida.
- Estrada da Graciosa: carga >= 16 t proibida.
- Ponte do Rio Ivaí: 36 t em PRC-466/PRC-272 (Port. 451/2026) e liberação temporária de bitrem longo em PR-082, PR-170, PR-453, PR-457, PRC-369 e PRC-466 até concluir as obras (Port. 478/2026). A camada de ocorrências do DER ainda mostra PRC-466 km 429,9-432,83 "apenas veículos leves" com liberação de 2020 (dado possivelmente defasado).
- OAEs: 1.591 pontes e viadutos estaduais com estado de conservação (3 críticas, 20 graves, 570 a classificar), sem vão, largura ou carga.
- Balsas/portos fluviais: 62 pontos com coordenada, sem limite de carga.
- Rodotrem/bitrem: lista permitida por trecho (Anexo I), sempre com AET. Não achei regra de horário de safra.
- Não feito: cruzar o SRE com `hgv` do OSM (precisa do extrato do Valhalla).

## Pendências

- Datas exatas das Portarias 481/2005 e 421/2005 (PDF do DOE).
- Revogações e sobreposições (414/2012 x 239/2026; portarias antigas) não verificadas uma a uma.
- Km de 15 portarias; geometria dos 5 trechos de Matinhos da Port. 239/2026.
- Transcrever os tarifários em imagem dos lotes 2, 4, 5 e 6.
- Lista de balanças do DER/PR (LAI).
- Parser do Decreto TJPR 621/2025.
