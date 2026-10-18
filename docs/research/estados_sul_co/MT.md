# Mato Grosso (MT): fontes oficiais para caminhão (pesquisa de 18/10/2026)

Detalhe completo em `MT.json`. Textos e amostras em `fontes/MT/` (menos de 1 MB).

## Como ler este resultado

- A maioria dos sites do estado (SINFRA, SESP, DETRAN, SEMA, AGER) **não abre pelo proxy** deste ambiente, e o TRT23 devolve "Acesso Negado".
- Funcionaram: **GeoDados MT** (ArcGIS, malha estadual com km), **IOMAT** (Diário Oficial, com API JSON de busca por frase entre aspas), os sites das concessionárias, RENAEST e Sinesp.
- O IOMAT virou a fonte primária no lugar do site da SINFRA. O texto de cada página do DOE vem no campo `conteudo` da busca. O PDF de download só traz a capa.
- Usei as 3 buscas web permitidas.

## Resumo por tema

| Tema | Resultado | Pronto p/ importar |
|---|---|---|
| 1. Restrições em rodovias estaduais | Sem portaria geral de feriado/serra (o **PL 774/2021 foi vetado**). Há restrição por **trecho** em duas portarias da SINFRA (061/2021 e 010/2023), com AET pelo SINFRALOG. Rodotrem/bitrenzão sem AET desde 25/01/2021. | **Sim**: malha SRE e regra MT-040/361. **Parcial**: Portaria 061/2021 |
| 2. Pedágio estadual | ~10 concessões, 6 com tarifa-teto oficial (AGER). Rota dos Grãos tem **free flow** (6 pórticos). Fase 2: 11 lotes, todos free flow. | **Parcial**: tarifas sim, praças sem coordenada |
| 3. Balanças | Sem base estadual. PER do contrato MT-130 prevê 2 balanças fixas (km). | Não |
| 4. Feriados | **Sem feriado estadual próprio** (Decreto 1.787/2025). Sem base de municipais. | Não |
| 5. Produtos perigosos | SEMA-MT licencia a transportadora. Nenhum ato de trecho, manancial ou ponte. | Não |
| 6. Acidentes | Sem base estadual aberta. RENAEST-MT: 0% com coordenada, tipo de via 100% "não informado". | Não |
| 7. Roubo de carga | Sinesp VDE: 50 casos em 2025, sem local. | Não |
| 8. Particularidades | 16 balsas na malha (operadores privados sob termo da SINFRA, tarifa AGER), Estradas-Parque, OSM com `maxweight` sem ato. | **Sim**: balsas |

## 1. Rodovias estaduais

Fontes testadas (HTTP 200, anônimas):

- `https://geodados.mt.gov.br/server/rest/services/Hosted/Rodovias_Estaduais/FeatureServer/0`: 2.346 trechos, ~34.426 km (inclui 145 trechos federais coincidentes), com `sre`, `rodovia`, `ext_inicia`/`ext_final`, lat/lon de início e fim, `tipo`, `material` (inclui BALSA), `pedagiadas`, `tipo_concessao`, `lote_concessao`. Atualizada em 05/05/2025, licença não declarada.
- IOMAT: `https://www.iomat.mt.gov.br/busca/busca/buscar/query/0/?1=1&q=<frase>` (filtro de data: `.../query/<página>/di:AAAA-MM-DD/df:AAAA-MM-DD/?1=1&q=`).

Atos (todos lidos no texto do DOE):

| Ato | Veículos | Trechos | Dias e horários |
|---|---|---|---|
| **Portaria SINFRA 061/2021** (DOE 20/10/2021 p. 28) | PBT ≥ 26 t, mais de 3 eixos e mais de 14 m (li como cumulativos, a confirmar) | MT-010 do PU de Rosário Oeste ao entroncamento MT-246 (Acorizal); MT-010 do entroncamento MT-246 ao km 4+600 (BR-163, Rodoanel); MT-246 do entroncamento BR-163/364 ao da MT-010; MT-251 Estrada-Parque km 16+650 a 69+430 | MT-010 e MT-246: dias úteis, proibido sábado após 13 h, domingo e feriado mesmo com AET. MT-251: só dias úteis, 20:00 a 05:00 (decisão judicial, Autos 1193-83.2009.811.0024) |
| **Portaria SINFRA 010/2023** (DOE 07/03/2023 p. 15-16) | PBT > 45 t, mais de 6 eixos e mais de 16 m | MT-040 e MT-361 (Santo Antônio de Leverger, Porto de Fora, Barão de Melgaço, divisa Cuiabá/Juscimeira), SRE 040EMT0040/0050/0053/0054/0055/0057/0060/0070/0073 e 361EMT0040/0043, 175,7 km | Amanhecer ao pôr do sol (cargas vivas: qualquer horário), dias úteis; proibido sáb, dom e feriado mesmo com AET |
| Portaria SINFRA de 25/01/2021 (DOE 27/01/2021 p. 17; número ilegível no texto) | CVC 9 eixos, 74 t (rodotrem, bitrenzão) | todas as estaduais | **Suspende a exigência de AET**, mantida nos trechos com restrição |
| Portaria 34/2022/CGAB/SINFRA (DOE 18/07/2022) | AET de carga e CVC | todas | AET só pelo SINFRALOG (`sinfralog.sinfra.mt.gov.br/portalaet/`) desde 18/07/2022 |
| Portaria 041/2021 | mesmo critério | mesmos trechos | **Revogada** pela 061/2021 |
| Mensagem 164/2021 (DOE 07/10/2021) | PL 774/2021 | | **Veto integral** (competência da União, CF art. 22 XI) |

Validação que fiz: os 11 códigos SRE da Portaria 010/2023 (grafia `EMT`) casam com o GeoDados (grafia `EEMT`). 10 existem (o `040EMT0057` não) e a soma das extensões dá **exatamente 175,7 km**, igual ao do ato.

Não casei com o SRE os trechos da Portaria 061/2021: o km do ato parte de Cuiabá e o da `MT-251` do GeoDados parte de Nova Xavantina. Importar essas regras com `ativa=false`.

Vigência: nenhuma revogação ou alteração das portarias 061/2021 e 010/2023 apareceu na busca do IOMAT até 18/10/2026. Não consegui ler o site da SINFRA.

Não achei: portaria de feriado prolongado, de serra ou de travessia urbana; limite de altura; ponte com restrição de peso; AET por rota.

## 2. Pedágio estadual

Regulador: AGER/MT, que fixa a tarifa-teto por decisão publicada no DOE. A tarifa por eixo é a básica vezes o número de eixos (categoria 2 = 2x, até 9 eixos = 9x).

| Concessão | Contrato | Rodovias | Tarifa-teto (fonte) |
|---|---|---|---|
| Morro da Mesa | 001/2011 | MT-130 Rondonópolis a Primavera do Leste | R$ 11,70 desde 01/04/2026 (AGER, DOE 17/03/2026) |
| Rota dos Grãos | 008/2021 | MT-130 BR-070 a MT-020 (Paranatinga), 140,6 km | **R$ 11,27** a partir de 14/10/2026 (AGER, DOE 13/10/2026); site ainda mostra R$ 10,90 |
| Via Brasil MT-246 | 007/2021 | MT-246 e, pelo SRE, MT-160/170/339/343/358 | R$ 11,40 (AGER, DOE 31/08/2026) |
| Via Brasil MT-100 | 001/2018, Lote 1 | MT-100 Alto Taquari a Alto Araguaia | R$ 11,70 (AGER, DOE 11/12/2025) |
| Via Norte Sul | 006/2021 | MT-220 Sinop a Tabaporã, 138,4 km | R$ 11,40 desde 27/01/2026 (AGER, DOE 22/01/2026) |
| Via Brasil MT-320 | não lido | MT-320 e MT-208 | R$ 11,70 (imagem do site, 04/2026) |
| Intervias, APASI, SPS, Rodovia da Mudança | não lidos | MT-242/140/493, MT-242/491, MT-235, MT-449/484/338 | **sem valor oficial achado** (só fonte secundária) |

- **Praças com km oficial**: Morro da Mesa, P-01 km 9+454 e P-02 km 110+856 (PER, DOE 01/09/2022 p. 88; o site diz 9+150 e 110+315). Intervias: km 11 da MT-242, Sorriso. As demais só têm km em fonte secundária (emsampa, datas de 2024-2025).
- **Free flow, Rota dos Grãos**: 6 pórticos nos km 133,6 / 145,6 / 171,1 / 195,9 / 225,8 / 247,7 da MT-130. Tarifa global de referência R$ 22,54 por eixo (R$ 2,64 no PFF-01 e R$ 3,98 nos demais). O site também publica duas praças convencionais; a decisão da AGER não diz se elas acabam.
- **Tabelas de caminhão** (leitura dos JPG): MT-246 com base 11,40: 2 eixos 22,80, 3 eixos 34,20, 4 eixos 45,60, 5 eixos 57,00, 6 eixos 68,40, 7 eixos 79,80, 8 eixos 91,20, 9 eixos 102,60. Morro da Mesa e MT-320 com base 11,70: 23,40 / 35,10 / 46,80 / 58,50 / 70,20 / 81,90 / 93,60 / 105,30.
- **Fase 2**: 11 lotes, ~2.300 km, free flow em todos. Lote A (MT-320/422/423/429, 287,33 km): 7 pórticos, tarifa máxima de referência R$ 12,71 (audiência de 27/05/2026).
- **Projetos na ALMT, sem desfecho confirmado**: PL 749/2026 (isenta motos), PL 130/2026 (isenta máquinas agrícolas), PL 258/2026 (altera a Lei 8.264/2004).
- **Coordenadas das praças**: nenhuma fonte oficial. A consulta Overpass por `toll_booth` falhou (HTTP 500).

## 3. Balanças

Sem lista estadual. O PER da MT-130 prevê Balança Fixa 01 (km 10+700) e 02 (km 110+856). O OSM tem 4 nós `weighbridge` em MT (3 "BR-163 KM 109", federal). A SEFAZ-MT leiloou em 2024 equipamento ocioso de pesagem em movimento, sem local.

## 4. Feriados

- **Estaduais**: o Decreto 1.787/2025 (DOE 18/12/2025) só lista nacionais e pontos facultativos em 2026 (Carnaval, Cinzas até 14 h, Corpus Christi 04/06 e 05/06, Dia do Servidor 28/10, 02/01, 24/12, 31/12). O 20/11 era "feriado estadual" no decreto de 2024 e hoje é nacional. Registrar só feriado, não ponto facultativo.
- **Municipais**: não há base estadual. Caminhos: anexo de feriados locais do TRT23 (portal bloqueado aqui), TJMT, Portaria 005/DPG da Defensoria (DOE 08/01/2026 p. 158, texto não lido), e varredura do IOMAT por decretos municipais. Exemplos achados: Cuiabá 08/12 (Lei 5.576/2012), Marcelândia 31/10, Araguaiana 08/09, Água Boa 13/07.

## 5. Produtos perigosos

SEMA-MT licencia "Transporte Rodoviário de Produtos Perigosos" por LAS (409 ocorrências no DOE). Nenhum ato de trecho, manancial, ponte ou túnel.

## 6. Acidentes

RENAEST (zip de 529 MB, lido por Range): MT teve 4.236 acidentes em 2025 e 4.570 em 2024. **0 com coordenada** em 2018-2026, tipo de via 100% "não informado", 8 registros com km. Caminhão: 332 veículos em 2025 (de 6.378). O CKAN do estado só tem violência contra a mulher.

## 7. Roubo de carga

Sinesp VDE 2025: 50 roubos de carga em MT (fev 5, mar 4, abr 3, mai 5, jun 6, jul 4, ago 5, set 3, out 6, nov 5, dez 4; jan 0), município "não informado".

## 8. Particularidades

- **16 trechos de balsa** no SRE (Teles Pires, Juruena, Arinos, das Mortes, Roosevelt, da Casca e outros). Operam sob Termo de Autorização Precária da SINFRA (Doerner & Cia e Centro Oeste Navegações, 2020-2021). A AGER regula a tarifa (+4,66% em 18/09/2025). Sem limite de peso em ato.
- **Estradas-Parque** com restrição: MT-251 (Cuiabá a Chapada dos Guimarães) e MT-040/361.
- **OSM sem ato**: MT-010 perto de Rosário Oeste com `hgv=no` e `maxweight=20` (o ato fala em 26 t com AET); ~21 vias da MT-020/MT-251 em Chapada com `maxweight=3,5`.
- Rodotrem/bitrenzão sem AET nas estaduais. Sem regra de safra encontrada. O serviço "cargas especiais" da Rota dos Grãos é gratuito e pede 2 semanas de antecedência.

## Pendências

1. Confirmar no site da SINFRA/IOMAT 2024-2026 se há portaria nova de restrição e se os critérios de peso, eixos e comprimento são cumulativos.
2. Casar km da Portaria 061/2021 com o SRE.
3. Coordenadas das praças e das balanças (OSM ou concessionárias).
4. Valores oficiais de Intervias, APASI, SPS e Rodovia da Mudança; decisão AGER da MT-320.
5. Feriados municipais em massa (TRT23, Defensoria, varredura do IOMAT).
