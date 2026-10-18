# Mato Grosso (MT): fontes oficiais para caminhão (pesquisa de 18/10/2026)

Detalhe completo em `MT.json`. Textos e amostras em `fontes/MT/` (menos de 1 MB).

## Como ler este resultado

- A maioria dos sites do estado (SINFRA, SESP, DETRAN, SEMA, AGER) **não abre pelo proxy** deste ambiente, e o TRT23 devolve "Acesso Negado".
- Funcionaram: **GeoDados MT** (ArcGIS, malha estadual com km), **IOMAT** (Diário Oficial, com API JSON de busca por frase entre aspas), os sites das concessionárias, RENAEST e Sinesp.
- O IOMAT virou a fonte primária no lugar do site da SINFRA. O texto de cada página do DOE vem no campo `conteudo` da busca. O PDF de download só traz a capa.
- Usei as 3 buscas web permitidas.

## Verificação de 18/10/2026 (segundo passe, independente)

Verificado em 2026-10-18: reabri as fontes oficiais (DOE pela API do IOMAT, GeoDados MT, sites das concessionárias, CKAN do estado e do Ministério dos Transportes, Sinesp VDE, RENAEST por streaming). Sem conexão: SINFRA, AGER, SEMA e DETRAN (HTTP 000), TRT23 (400), Overpass (500). Não usei WebSearch.

- **Confere**: texto, artigos, horários e datas das portarias 061/2021, 010/2023, de 25/01/2021 e 34/2022, do veto (Mensagem 164/2021) e da 041/2021 (revogada); os 10 códigos SRE e os 175,66 km da 010/2023; 2.346 linhas, 34.426 km e 145 trechos federais do GeoDados; as tarifas de Morro da Mesa (11,70), Rota dos Grãos (11,27), MT-246 (11,40), MT-100 (11,70) e MT-220 (11,40); as tabelas JPG da MT-246 e MT-320; o Decreto 1.787/2025; o Sinesp 2025 (50); o RENAEST (contagens por ano de MT reproduzidas, 0 com coordenada, 100% "não informado").
- **Corrigido**: Balança Fixa 02 do MT-130 fica no **km 107+600** (o 110+856 é a Praça 02); o "km 11" da Intervias é o **endereço da sede de uma associação**, não praça; a **MT-320 tem decisão da AGER** (contrato 001/2019, R$ 11,70, DOE 22/10/2025), e o 7º reajuste já está em tramitação; a **Rodovia da Mudança tem valor oficial** (R$ 11,50, DOE 24/02/2025, defasado); **omissão da Fase 1** do programa de concessões (contratos de 2025; Lote 5, R$ 13,67, cobrança não confirmada); balsas operam sob os contratos de autorização 002/2023 e 005/2023 (os termos de 2020-2021 são históricos) e os +4,66% valem só para o Porto Itaúba; o site da Rota dos Grãos não publica "praças convencionais" (tabela de 15/10/2025); o "7º reajuste" da MT-100 não está no texto; Água Boa 13/07 **não confirmado** (a Defensoria lista 09/07); OSM com 16 vias de 3,5 t (não ~21) e 4 nós weighbridge (1 privado); os lotes de balança da SEFAZ **não foram vendidos**; a cópia SHP é de 05/05/2025.
- **Acrescentado**: o SRE tem 2.346 linhas mas só **2.234 códigos `sre`** (112 repetidos, ~242 km): deduplicar; Sinesp 2026 (jan-ago: 23 roubos de carga em MT); Anexo II da Portaria 005/DPG (feriados por comarca) como fonte municipal.
- **Rebaixado**: nenhum item mudou de `true` para `false`; `rodovias_estaduais` e `particularidades` seguem `true` com ressalvas (dedup por `sre`, vigência "provável", critério "cumulativo" é interpretação); `pedagio` segue `parcial`; os demais seguem `false`.

## Resumo por tema

| Tema | Resultado | Pronto p/ importar |
|---|---|---|
| 1. Restrições em rodovias estaduais | Sem portaria geral de feriado/serra (o **PL 774/2021 foi vetado**). Há restrição por **trecho** em duas portarias da SINFRA (061/2021 e 010/2023), com AET pelo SINFRALOG. Rodotrem/bitrenzão sem AET desde 25/01/2021. | **Sim**: malha SRE e regra MT-040/361. **Parcial**: Portaria 061/2021 |
| 2. Pedágio estadual | ~10 concessões em operação, 7 com tarifa-teto oficial lida (AGER; Rodovia da Mudança de 02/2025, defasada). Rota dos Grãos tem **free flow** (6 pórticos). Fase 1 (contratos 2025) com Lote 5 a R$ 13,67 sem cobrança confirmada. Fase 2: 11 lotes, todos free flow. | **Parcial**: tarifas sim, praças sem coordenada |
| 3. Balanças | Sem base estadual. PER do contrato MT-130 prevê 2 balanças fixas (km 10+700 e **107+600**). | Não |
| 4. Feriados | **Sem feriado estadual próprio** (Decreto 1.787/2025). Sem base de municipais. | Não |
| 5. Produtos perigosos | SEMA-MT licencia a transportadora. Nenhum ato de trecho, manancial ou ponte. | Não |
| 6. Acidentes | Sem base estadual aberta. RENAEST-MT: 0% com coordenada, tipo de via 100% "não informado". | Não |
| 7. Roubo de carga | Sinesp VDE: 50 casos em 2025 e 23 em jan-ago/2026, sem local. | Não |
| 8. Particularidades | 16 balsas na malha (operadores privados sob termo da SINFRA, tarifa AGER), Estradas-Parque, OSM com `maxweight` sem ato. | **Sim**: balsas |

## 1. Rodovias estaduais

Fontes testadas (HTTP 200, anônimas):

- `https://geodados.mt.gov.br/server/rest/services/Hosted/Rodovias_Estaduais/FeatureServer/0`: 2.346 trechos, ~34.426 km (inclui 145 trechos federais coincidentes), com `sre`, `rodovia`, `ext_inicia`/`ext_final`, lat/lon de início e fim, `tipo`, `material` (inclui BALSA), `pedagiadas`, `tipo_concessao`, `lote_concessao`. Atualizada em 05/05/2025, licença não declarada.
- IOMAT: `https://www.iomat.mt.gov.br/busca/busca/buscar/query/0/?1=1&q=<frase>` (filtro de data: `.../query/<página>/di:AAAA-MM-DD/df:AAAA-MM-DD/?1=1&q=`).

Atos (todos lidos no texto do DOE):

| Ato | Veículos | Trechos | Dias e horários |
|---|---|---|---|
| **Portaria SINFRA 061/2021** (DOE 20/10/2021 p. 28) | PBT ≥ 26 t, mais de 3 eixos e mais de 14 m (li como cumulativos, a confirmar: o texto liga os critérios com vírgula e "e", sem esclarecimento oficial) | MT-010 do PU de Rosário Oeste ao entroncamento MT-246 (Acorizal); MT-010 do entroncamento MT-246 ao km 4+600 (BR-163, Rodoanel); MT-246 do entroncamento BR-163/364 ao da MT-010; MT-251 Estrada-Parque km 16+650 a 69+430 | MT-010 e MT-246: dias úteis, proibido sábado após 13 h, domingo e feriado mesmo com AET. MT-251: só dias úteis, 20:00 a 05:00 (decisão judicial, Autos 1193-83.2009.811.0024) |
| **Portaria SINFRA 010/2023** (DOE 07/03/2023 p. 15-16) | PBT > 45 t, mais de 6 eixos e mais de 16 m | MT-040 e MT-361 (Santo Antônio de Leverger, Porto de Fora, Barão de Melgaço, divisa Cuiabá/Juscimeira), SRE 040EMT0040/0050/0053/0054/0055/0057/0060/0070/0073 e 361EMT0040/0043, 175,7 km | Amanhecer ao pôr do sol (cargas vivas: qualquer horário), dias úteis; proibido sáb, dom e feriado mesmo com AET |
| Portaria SINFRA de 25/01/2021 (DOE 27/01/2021 p. 17; número ilegível no texto) | CVC 9 eixos, 74 t (rodotrem, bitrenzão) | todas as estaduais | **Suspende a exigência de AET**, mantida nos trechos com restrição |
| Portaria 34/2022/CGAB/SINFRA (DOE 18/07/2022) | AET de carga e CVC | todas | AET só pelo SINFRALOG (`sinfralog.sinfra.mt.gov.br/portalaet/`) desde 18/07/2022 |
| Portaria 041/2021 | mesmo critério | mesmos trechos | **Revogada** pela 061/2021 |
| Mensagem 164/2021 (DOE 07/10/2021) | PL 774/2021 | | **Veto integral** (competência da União, CF art. 22 XI) |

Validação que fiz: os 11 códigos SRE da Portaria 010/2023 (grafia `EMT`) casam com o GeoDados (grafia `EEMT`). 10 existem (o `040EMT0057` não) e a soma das extensões dá **exatamente 175,7 km**, igual ao do ato.

Não casei com o SRE os trechos da Portaria 061/2021: o km do ato parte de Cuiabá e o da `MT-251` do GeoDados parte de Nova Xavantina. Importar essas regras com `ativa=false`.

Vigência: nenhuma revogação ou alteração das portarias 061/2021 e 010/2023 apareceu na busca do IOMAT até 18/10/2026 (refeita em 18/10/2026 com várias frases, 2023-2026; também não achei derrubada do veto ao PL 774/2021). Não consegui ler o site da SINFRA, então a vigência é "provável".

Qualidade do SRE (verificado em 2026-10-18): as 2.346 linhas têm só 2.234 códigos `sre` distintos (112 repetidos, cerca de 242 km a mais); importar deduplicando por `sre`. Os 10 códigos da Portaria 010/2023 aparecem uma vez cada e somam 175,664 km. A licença do GeoDados segue não declarada (`licenseInfo` vazio); a cópia SHP é de 05/05/2025 (18:18 UTC).

Não achei: portaria de feriado prolongado, de serra ou de travessia urbana; limite de altura; ponte com restrição de peso; AET por rota.

## 2. Pedágio estadual

Regulador: AGER/MT, que fixa a tarifa-teto por decisão publicada no DOE. A tarifa por eixo é a básica vezes o número de eixos (categoria 2 = 2x, até 9 eixos = 9x).

| Concessão | Contrato | Rodovias | Tarifa-teto (fonte) |
|---|---|---|---|
| Morro da Mesa | 001/2011 | MT-130 Rondonópolis a Primavera do Leste | R$ 11,70 desde 01/04/2026 (AGER, DOE 17/03/2026) |
| Rota dos Grãos | 008/2021 | MT-130 BR-070 a MT-020 (Paranatinga), 140,6 km | **R$ 11,27** a partir de 14/10/2026 (AGER, DOE 13/10/2026); site ainda mostra R$ 10,90 |
| Via Brasil MT-246 | 007/2021 | MT-246 e, pelo SRE, MT-160/170/339/343/358 | R$ 11,40 (AGER, DOE 31/08/2026 p. 92; 5º reajuste; antes R$ 10,90 desde 27/08/2025) |
| Via Brasil MT-100 | 001/2018, Lote 1 | MT-100 Alto Taquari a Alto Araguaia | R$ 11,70 (AGER, DOE 11/12/2025 p. 55, interstício 2024/2025) |
| Via Norte Sul | 006/2021 | MT-220 Sinop a Tabaporã, 138,4 km | R$ 11,40 desde 27/01/2026 (AGER, DOE 22/01/2026) |
| Via Brasil MT-320 | 001/2019 | MT-320 e MT-208 | R$ 11,70 (AGER, 6º reajuste, DOE 22/10/2025 p. 75, efeitos em 29/10/2025; **7º reajuste em tramitação**, o valor muda a partir de ~29/10/2026) |
| Rodovia da Mudança | 001/2010 (ASJU) | MT-449/484/338 e trecho da MT-010 | R$ 11,50 (AGER, DOE 24/02/2025 p. 108, interstício 2023/2024; **defasado**, reajuste 2024/2025 não achado) |
| Intervias, APASI, SPS | 002/2011, 003/2010, 004/2010 ou 001/2011 | MT-242/140/493, MT-242/491, MT-235 | **sem valor oficial achado** (só fonte secundária) |

- **Praças com km oficial**: Morro da Mesa, P-01 km 9+454 e P-02 km 110+856 (PER, DOE 01/09/2022 p. 88; o site diz 9+150 e 110+315). Intervias **não tem** km de praça em fonte oficial (o "km 11 da MT-242, Sorriso" que constava aqui é o endereço da sede da Associação dos Beneficiários da Rodovia da Integração Leste-Oeste, DOE 17/04/2026 p. 123). As demais só têm km em fonte secundária (emsampa, datas de 2024-2025).
- **Free flow, Rota dos Grãos**: 6 pórticos nos km 133,6 / 145,6 / 171,1 / 195,9 / 225,8 / 247,7 da MT-130. Tarifa global de referência R$ 22,54 por eixo (R$ 2,64 no PFF-01 e R$ 3,98 nos demais). O site (18/10/2026) publica só a tabela 2025/2026 por eixo (R$ 10,90, desde 15/10/2025) e a tabela dos pórticos (a partir de 14/10/2026); **não** lista praças convencionais (km 167 e 243 só no emsampa, 2024) e ainda não mostra o R$ 11,27. A decisão da AGER condiciona a cobrança ao ato autorizativo.
- **Tabelas de caminhão** (leitura dos JPG): MT-246 com base 11,40: 2 eixos 22,80, 3 eixos 34,20, 4 eixos 45,60, 5 eixos 57,00, 6 eixos 68,40, 7 eixos 79,80, 8 eixos 91,20, 9 eixos 102,60. Morro da Mesa e MT-320 com base 11,70: 23,40 / 35,10 / 46,80 / 58,50 / 70,20 / 81,90 / 93,60 / 105,30.
- **Fase 1 (omitida na primeira versão)**: o SRE marca 165 trechos "Fase 01" e 21 "Expansão Fase 01" (lotes 1, 2, 3, 5, 6, 8). Contratos de 2025: 004 (Rota da Produção, Lote 2, 418,56 km, MT-010/160/235/249/480), 005 (Rota da Integração, Lote 5, 308,379 km, MT-020/MT-326) e 006 (Vale do Arinos). A AGER fixou para o Lote 5 a tarifa CAT1 de **R$ 13,67** (DOE 17/07/2026 p. 74), a viger a partir do ato autorizativo de início da cobrança; início de cobrança **não confirmado**.
- **Fase 2**: 11 lotes, ~2.300 km, free flow em todos. Lote A (MT-320/422/423/429, 287,33 km): 7 pórticos, tarifa máxima de referência R$ 12,71 (audiência de 27/05/2026).
- **Projetos na ALMT, sem desfecho confirmado e não reverificados**: PL 749/2026 (isenta motos), PL 130/2026 (isenta máquinas agrícolas), PL 258/2026 (o JSON dizia "publicidade da arrecadação", esta lista dizia "altera a Lei 8.264/2004": descrição divergente). As Leis estaduais 8.264/2004 e 8.620/2006 disciplinam concessões e cobrança de pedágio (AGER, DOE 12/06/2026 p. 66-67).
- **Coordenadas das praças**: nenhuma fonte oficial. A consulta Overpass por `toll_booth` falhou (HTTP 500, de novo em 18/10/2026 até para consulta trivial).

## 3. Balanças

Sem lista estadual. O PER da MT-130 (DOE 01/09/2022 p. 88) prevê Balança Fixa 01 (km 10+700, depois da Praça 01 em 9+454) e Balança Fixa 02 (**km 107+600**; o km 110+856 é a Praça 02). O OSM tem 4 nós `weighbridge` em MT (2 "BR-163 KM 109" e 1 sem nome no mesmo local, federal; 1 balança privada da Sipal, `access=private`). A SEFAZ-MT listou em leilão, em 2024 (DOE 08/05/2024 p. 294), peças de "Balança de Pesagem em Movimento" (lotes 001 e 002, "ocioso" e "antieconômico"), mas com venda de R$ 0,00 (não vendidos) e sem local.

## 4. Feriados

- **Estaduais**: o Decreto 1.787/2025 (DOE 18/12/2025) só lista nacionais e pontos facultativos em 2026 (Carnaval, Cinzas até 14 h, Corpus Christi 04/06 e 05/06, Dia do Servidor 28/10, 02/01, 24/12, 31/12). O 20/11 era "feriado estadual" no decreto de 2024 e hoje é nacional. Registrar só feriado, não ponto facultativo.
- **Municipais**: não há base estadual. Caminhos: anexo de feriados locais do TRT23 (portal bloqueado aqui), TJMT, Portaria 005/DPG da Defensoria (DOE 08/01/2026 p. 158, texto não lido), e varredura do IOMAT por decretos municipais. Exemplos: Marcelândia 31/10 (confirmado, DOE 28/09 e 02/10/2026) e Araguaiana 08/09 (confirmado, DOE 03/09/2026). **Não confirmados**: Cuiabá 08/12 (Lei 5.576/2012 não achada no IOMAT) e Água Boa 13/07 (o Anexo II da Portaria 005/DPG lista Água Boa em 09/07, aniversário, e 12/10). Melhor fonte oficial achada para a base municipal: Anexo II da Portaria 005/DPG da Defensoria (DOE 08/01/2026 p. 159+, feriados por comarca, colunas misturadas no texto extraído; amostra em `fontes/MT/iomat_dpe_portaria_005_dpg_2026_anexo_ii_pag159.txt`).

## 5. Produtos perigosos

SEMA-MT licencia "Transporte Rodoviário de Produtos Perigosos" por LAS (a frase exata devolve 1.986 páginas do DOE em 18/10/2026; o número varia e não é indicador). Nenhum ato de trecho, manancial, ponte ou túnel.

## 6. Acidentes

RENAEST (zip de 529 MB, lido por Range): MT teve 4.236 acidentes em 2025 e 4.570 em 2024. **0 com coordenada** em 2018-2026, tipo de via 100% "não informado", 8 registros com km. Caminhão: 332 veículos em 2025 (de 6.378). O CKAN do estado só tem violência contra a mulher.

## 7. Roubo de carga

Sinesp VDE 2025: 50 roubos de carga em MT (fev 5, mar 4, abr 3, mai 5, jun 6, jul 4, ago 5, set 3, out 6, nov 5, dez 4; jan 0), município "não informado". Em 2026 (arquivo `bancovde-2026.xlsx`, último mês 2026-08, possivelmente incompleto): jan 2, fev 2, mar 6, abr 5, mai 2, jun 4, jul 2, ago 0 = 23.

## 8. Particularidades

- **16 trechos de balsa** no SRE (Teles Pires, Juruena, Arinos, das Mortes, Roosevelt, da Casca e outros). Em 09/2025 operam sob os Contratos de Autorização SINFRA 002/2023 (Doerner & Cia) e 005/2023 (Centro Oeste Navegações); os Termos de Autorização Precária de 2020-2021 são históricos. A AGER regula a tarifa por porto (+4,66% só para o Porto Itaúba, DOE 18/09/2025 p. 60; novos pedidos em 2026). MT-208 (Juruena) e MT-338 aparecem no SRE com 4,59 km e 1,20 km de "balsa", extensões a tratar com cautela. Sem limite de peso em ato.
- **Estradas-Parque** com restrição: MT-251 (Cuiabá a Chapada dos Guimarães) e MT-040/361.
- **OSM sem ato**: MT-010 perto de Rosário Oeste com `hgv=no` e `maxweight=20` (o ato fala em 26 t com AET); 16 vias da MT-020/MT-251 em Chapada com `maxweight=3,5` (7 + 9).
- Rodotrem/bitrenzão sem AET nas estaduais. Sem regra de safra encontrada. O serviço "cargas especiais" da Rota dos Grãos é gratuito e o site recomenda agendar com 2 semanas de antecedência.

## Pendências

1. Confirmar no site da SINFRA/IOMAT 2024-2026 se há portaria nova de restrição e se os critérios de peso, eixos e comprimento são cumulativos.
2. Casar km da Portaria 061/2021 com o SRE.
3. Coordenadas das praças e das balanças (OSM ou concessionárias).
4. Valores oficiais de Intervias, APASI e SPS; reajuste 2024/2025 da Rodovia da Mudança; decisão AGER do 7º reajuste da MT-320 (~29/10/2026) e do reajuste 2025/2026 da MT-100; início de cobrança das concessões da Fase 1.
5. Feriados municipais em massa (TRT23, extrair o Anexo II da Portaria 005/DPG da Defensoria, varredura do IOMAT).
6. Deduplicar a malha SRE por `sre` antes de importar.
