# Goiás (GO): fontes oficiais para caminhão (pesquisa de 18/10/2026)

Somente leitura no repositório. Textos e amostras em `fontes/GO/` (cerca de 270 KB); os brutos grandes foram baixados fora do repositório e apagados. Detalhe completo em `GO.json`. Órgão rodoviário estadual: GOINFRA (Agência Goiana de Infraestrutura e Transportes).

## Resumo em uma tela

| Tema | O que existe | Pronto para importar? |
|---|---|---|
| 1. Restrições em rodovias estaduais | Uma portaria anual de feriados prolongados (Portaria GOINFRA 20/2026): 23 linhas de rodovia, 25 datas de 14/02/2026 a 03/01/2027, 07h-20h. Sem portaria de peso/altura/comprimento por trecho, AET por trecho, ponte, serra ou safra. Ponte Quinca Mariano (GO-139) fechada desde 03/08/2026 por ~12 meses | Parcial: datas, horários, veículos e exceções sim; os trechos são descritivos (sem km), geometria por rodovia via SRE (XLSX e KMZ testados) |
| 2. Pedágio estadual | Nenhum. Lei 19.999/2018 (6 trechos) revogada pela Lei 21.549/2022. As 26 praças de GO no CSV da ANTT são todas em BRs | Estadual: nada a importar. Praças ANTT: sim (CSV testado) |
| 3. Balanças | Sem lista nem dataset. A GOINFRA só descreve atribuições de pesagem | Não |
| 4. Feriados | Estaduais: 26/07, 24/10 e 28/10 (Lei 20.756/2020, art. 269), com transferência anual por decreto. Municipais: sem base estadual | Estadual: parcial. Municipal: não |
| 5. Perigosos | Nenhum ato estadual por trecho. Só a Lei 19.423/2016, art. 13 (agrotóxicos seguem a regra de cargas perigosas) | Não |
| 6. Acidentes | RENAEST de GO tem coordenada de 2021 a 2026 (98%) e tipo de veículo: 5.236 acidentes com caminhão em 2025, 1.288 em rodovia estadual com ponto | Sim (testado com stream do ZIP) |
| 7. Roubo de carga | Sinesp: 10 ocorrências em 2025, sem município. PROCARGA-GOIÁS (Decreto 8.251/2014) sem divulgação | Não |
| 8. Particularidades | 10 balsas sem limite publicado, 405 trechos de leito natural, 711 radares/lombadas com coordenada, Romaria de Trindade | n/a |

## 1. Rodovias estaduais

### Portaria GOINFRA 20/2026 (03/02/2026)

PDF: `https://goias.gov.br/goinfra/wp-content/uploads/sites/77/2026/08/Portaria_020_2026_PR.pdf` (5 páginas, texto extraível; cópia em `fontes/GO/goinfra_portaria_020_2026_restricao_feriados.txt`). Listada em `https://goias.gov.br/goinfra/portarias/` como EM VIGOR. Base: Lei 21.792/2023 art. 76 e Decreto 10.213/2023 art. 4º, XII. O DOE de publicação não foi conferido.

- **Art. 1º**: restringe CVC e CTV nas rodovias estaduais, nos trechos de pista simples com duplo sentido: CVC acima de 3 e até 9 eixos, Romeu e Julieta, guindastes, cegonheiros, linha de eixos, qualquer combinação de carga com mais de 3 eixos e veículos que exigem escolta ou batedores.
- **Art. 2º**: 07:00-20:00 em todas as datas, menos 18/02 (07:00-12:00). Datas: Carnaval 14, 17 e 18/02; Paixão 03 e 05/04; Tiradentes 18 e 21/04; Trabalho 01 e 03/05; Corpus Christi 04 e 07/06; Independência 05 e 07/09; N. Sra. Aparecida 10 e 12/10; Finados 31/10 e 02/11; Consciência Negra 20 e 22/11; Natal 24, 25 e 27/12; Ano Novo 31/12, 01 e 03/01/2027.
- **Art. 3º**: 23 linhas de rodovia, sem km nem código SRE: GO-020, GO-139, GO-213, GO-217, GO-330, GO-431, GO-338, GO-225, GO-010/GO-139, GO-507, GO-530, GO-241, GO-210, GO-118, GO-080, GO-116, GO-164 (BR-164 a São Simão), GO-206 (a Lagoa Santa), GO-206 (a Parque Nacional das Emas), GO-441, GO-108, GO-239 e GO-164 (Cidade de Goiás a São Miguel do Araguaia). Texto de cada trecho no JSON.
- **Art. 4º**: excluídos perecíveis, leite e derivados, frutas e verduras, cargas vivas ou frigoríficas.
- **Art. 5º**: infração do "artigo 187-I" do CTB (grafia do ato).

Atos anteriores (vencidos): Portaria 20/2025 (23/01/2025, mesmas 23 linhas) e Portaria 21/2024 (17/01/2024), esta com 140 códigos SRE de 23 rodovias. A notícia da GOINFRA de 09/10/2026 resume a regra como "três ou mais eixos que necessitem de escolta"; o texto do ato é mais largo, vale o ato.

### Geometria (SRE)

`https://goias.gov.br/goinfra/mapa-rodoviario-setembro-2026/`: `SRE_09_2026.xlsx` (539 KB, 2.689 trechos: sre, go, inicio, fim, km_inicial, km_final, situacao, jurisdicao, revest, VMD) e `KMZ_09_2026.kmz` (19,8 MB, 2.689 LineStrings com o código SRE). Para o ato de 2026, juntar por número da rodovia e filtrar `situacao=PAV`; `DUP` (duplicada) fica fora do ato. O extrato `fontes/GO/sre_set2026_trechos_das_portarias_goinfra.csv` tem 751 linhas. Cinco códigos da Portaria 21/2024 não existem mais no SRE de 09/2026 (139EGO0090, 184EGO0110, 225EGO0035, 239EGO0185, 239EGO0190).

### Interdições e obras vigentes

- **Ponte Quinca Mariano, GO-139, Rio Paranaíba (divisa GO/MG)**: interdição total desde as 06h de 03/08/2026, previsão de 12 meses. Desvios citados: via Catalão/Araguari ou via Itumbiara/Tupaciguara.
- GO-020 (RMG, desvio no sentido Bela Vista desde 22/09/2026) e GO-330 (desvio de ~1 km perto de Goiandira, 18/09/2026): li só o resumo.
- Portarias de emergência de pontes (15/2025 GO-465 km 36,14; 18/2025 Guarinos; 134/2024 GO-341 km 191; 99/2024, 003/2024, 002/2024) são contratação emergencial, não restrição. A ponte da GO-341 foi substituída por ponte de concreto de 60 m, entregue em 24/07/2025. O ato 18/2025 diz GO-439 no corpo e a listagem diz GO-349.

### O que não existe (nas fontes lidas)

Portaria de peso, altura ou comprimento por trecho; lista de trechos liberados para CVC; horário de serra, travessia urbana ou safra; proibição em ponte. A listagem de portarias tem 157 linhas (2019-2026) e a busca por ementa no `legisla.casacivil.go.gov.br` ("caminh", "veículos de carga", "excesso de peso", "balança", "pesagem") deu 0. A AET é pedida em `portalaet.goinfra.go.gov.br`, que não resolve neste ambiente.

## 2. Pedágio

Não há concessão estadual. A Lei 19.999/2018 autorizava concessão de GO-010, GO-020/330, GO-060, GO-070, GO-080 e GO-213; a Lei 21.549, de 10/08/2022, art. 1º, a revogou (`fontes/GO/lei_GO_21549_2022_revoga_concessao_pedagio.txt`).

CSV da ANTT (`dados.antt.gov.br`, pacote `praca-de-pedagio`, CC-BY, atualizado em 28/07/2026): 26 linhas de GO, todas ativas e todas em BR. CONCEBRA 2 (BR-060), Ecovias do Araguaia 7 (BR-153 x5, BR-080, BR-414), Ecovias do Cerrado 2 (BR-364), Ecovias Minas Goiás 2 (BR-050), Rota Verde Goiás 11 (BR-060 x8 e BR-452 x3, todas free flow, em pares por sentido) e Way 153 2 (BR-153). Armadilhas: ISO-8859-1; rodovia sem zero à esquerda ("BR-60", "BR-50", "BR-80"); coordenadas de Ecovias do Cerrado e Minas Goiás com 2 casas. Tarifas não coletadas (federais). Amostra: `fontes/GO/antt_pracas_pedagio_GO.csv`.

## 3. Balanças

Sem lista pública. A página `https://goias.gov.br/goinfra/operacao-rodoviaria/controle-de-pesagem-de-cargas-postos-de-pesagens/` descreve postos "com balanças fixas e móveis", CCOF, estudos de locais de PPV e emissão de AET, mas não nomeia nenhum posto. O relatório de equipamentos de 11/09/2025 (PDF, 711 equipamentos, 698 lombadas eletrônicas e 226 radares fixos em 924 faixas) é só de velocidade, com km, sentido, SRE e lat/lon. A lista de PPVs precisa de LAI à GOINFRA.

## 4. Feriados

**Estaduais** (Lei 20.756/2020, art. 269, II; texto em `fontes/GO/lei_GO_20756_2020_arts_268_270.txt`): 26/07 fundação da Cidade de Goiás; 24/10 pedra fundamental de Goiânia; 28/10 Dia do Servidor. O § 1º autoriza o Governador a transferir o de 26/07 e o de 28/10; decretos: 2023 24/07 (10.288); 2024 22/07 (10.481) e 01/11 (10.566); 2025 28/07 (10.709) e 27/10 (10.790); **2026 20/07 (10.935) e 30/10 (10.987, de 10/09/2026)**. O caput dá "sem expediente" à terça de Carnaval e à Sexta-feira Santa. A alínea d (02/11) foi revogada pela Lei 21.682/2022. Ressalva: o texto é "não haverá expediente em repartição ou serviço do Estado"; não confirmei que valha como feriado civil geral. As portarias de caminhão da GOINFRA só usam feriados nacionais.

**Municipais**: não há base estadual (Dados Abertos GO, 446 conjuntos, sem feriados). O PDF do TJGO 2026 (2 páginas) só traz uma data local, 24/05 (N. Sra. Auxiliadora) para Goiânia, Iporá, Leopoldo de Bulhões e Senador Canedo. Melhor lista limpa: TRT18, "feriados locais 2024" (25 municípios, cerca de 10% dos 246); o de 2026 só existe na grade do calendário. TRE-GO (403) e Querido Diário (TLS) não foram alcançados. Plano: TRT18 + TJGO para as comarcas maiores e decreto municipal anual para os polos de carga.

## 5. Produtos perigosos

Nenhum ato estadual por trecho, manancial, túnel ou ponte. Lei 19.423/2016, art. 13: o transporte interno de agrotóxicos segue a legislação de cargas perigosas (regulamento Decreto 9.286/2018; alterada pela Lei 24.389 de 29/06/2026). O órgão ambiental estadual não foi alcançado (site não resolve); não afirmo nome nem ato.

## 6. Acidentes

Sem base própria do DETRAN-GO ou da SSP-GO em dados abertos. RENAEST (Senatran, domínio público, ZIP de 529 MB lido por HTTP Range, dados até 31/05/2026):

| Ano | Acidentes GO | Com coordenada | Com caminhão, cavalo, semirreboque ou reboque | Com coordenada | Destes, rodovia estadual com coordenada |
|---|---|---|---|---|---|
| 2021 | 84.986 | 80.315 | 3.851 | 3.546 | 809 |
| 2022 | 84.271 | 82.210 | 4.539 | 4.421 | 1.040 |
| 2023 | 100.382 | 99.235 | 5.019 | 4.929 | 1.226 |
| 2024 | 108.395 | 106.812 | 5.434 | 5.344 | 1.301 |
| 2025 | 105.373 | 103.252 | 5.236 | 5.127 | 1.288 |
| 2026 (jan-mai) | 43.916 | 42.816 | 2.204 | 2.156 | 546 |

2018-2020: zero coordenadas. Cuidados: o campo km vem "0000" (o km está no texto do endereço, ex. "GO-070 KM 133"); `tp_rodovia=ESTADUAL` tem avenidas urbanas e "BR-xxx"; "NAO INFORMADO" é o tipo de veículo de 35% dos registros de 2025, então a contagem de caminhão é piso; usar `tp_rodovia` diferente de FEDERAL para não duplicar a PRF. Amostra: `fontes/GO/renaest_go_caminhao_estadual_2025_amostra300.csv`.

## 7. Roubo e furto de carga

Sinesp VDE 2025 (xlsx nacional, licença não declarada): GO tem 10 ocorrências de "Roubo de carga" no ano, município "NÃO INFORMADO", provável subnotificação (`fontes/GO/sinesp_vde_2025_roubo_carga_GO.csv`). O PROCARGA-GOIÁS (Decreto 8.251/2014) manda comunicar tudo à DECAR e a Superintendência de Inteligência da SSP monitorar locais de incidência, sem divulgação prevista. Painel de estatística da SSP-GO não encontrado. Para agregado útil: LAI à SSP-GO/DECAR.

## 8. Particularidades para caminhão

- **Balsas** (GOINFRA mantém 10, gratuitas, em rodovias não pavimentadas): GO-239 Rio Crixás-Açu, GO-464 Rio São Félix (Cana Brava, 324 m², 12 carros de passeio e 47 passageiros), GO-080 Rio Maranhão em Barro Alto (Balsa Darlene), GO-112 Rio Paranã, GO-338 Rio das Almas (Balsa Júlia), GO-324 Lago dos Tigres, GO-188 Rio Caiapó, GO-118 Rio Paranaíba, GO-330 Rio São Marcos e GO-210 Rio Paranaíba. Nenhum limite de peso publicado. Pontes em obra: GO-080 Barro Alto (178 m, entrega até 07/2027) e GO-338 (previsão 2026).
- **Malha**: SRE 09/2026 tem 405 trechos de leito natural (LEN), 50 em obras de pavimentação, 49 planejados. Mais LEN: GO-239 (15 de 44), GO-241 (13 de 53), GO-108, GO-116.
- **Romaria de Trindade** (27/06 a 06/07 em 2025; GO-050, GO-060, GO-469): só apoio operacional; nenhuma restrição de caminhão achada. Edição 2026 não pesquisada.
- **AET**: exemplo de 79,4 t, 4,50 m x 5,06 m (sino Vox Patris) por rodovias estaduais em 06/2025; sem tabela de trechos.
- **Radares e lombadas** estaduais com coordenada: camada nova possível (PDF).
- Cruzar `hgv` do OSM com o SRE: não feito (exige o extrato do Valhalla).

## Pendências

Ver lista no fim de `GO.json`. Principais: lista de balanças (LAI), curadoria dos 23 trechos de feriado, feriados municipais em massa, status atual das pontes das portarias de emergência, portal AET e órgão ambiental não alcançados.
