# Pedágio e balanças das concessões estaduais e municipais (RJ, MG, ES) e pedágio estadual do Sul e Centro-Oeste (RS, MS, MT)

Frente `concessoes_estaduais` do Sudeste. Não cria camada: são **fontes novas** das camadas
[`pedagio`](pedagio.md) e [`balancas`](balancas.md).

| Fonte (`source`) | Camada | Importador | O que traz | Registros (10/10/2026) |
|---|---|---|---|---|
| `agetransp` | pedagio | `importers/sources/toll_agetransp.py` | RJ-124 Via Lagos e RJ-116 Rota 116 (AGETRANSP) | 5 praças |
| `artemig` | pedagio | `importers/sources/toll_artemig.py` | concessões estaduais de MG (ARTEMIG) | 38 pontos (32 ativos, 6 inativos) |
| `municipais` | pedagio | `importers/sources/toll_municipais.py` | Linha Amarela e Transolímpica (Rio); MGC-393 Pirapetinga (inativa) | 4 pontos (3 ativos) |
| `der-mg` | balancas | `importers/sources/weigh_dermg.py` | postos de pesagem do DER-MG em operação | 42 postos |

Os três importadores de pedágio leem o arquivo curado `data/raw/pedagio/concessoes_estaduais.json` (versionado):
tarifas transcritas com fonte, ato e data; janela tarifária; praças com o método de posição; status e motivo dos
registros inativos. Biblioteca comum: `importers/sources/_toll_estaduais.py`; rodovia+km em MG:
`importers/sources/_sre_mg.py`.

Pesquisa de origem: `concessoes_estaduais` e `ders_estaduais` (research.json + verify.json; as correções do verify
estão aplicadas, ver "Decisões").

Sul e Centro-Oeste (18/10/2026): três fontes novas, no arquivo `data/raw/pedagio/concessoes_estaduais_sul_co.json` (mesmo
esquema; `_toll_estaduais.load()` soma os dois arquivos) — ver "Sul e Centro-Oeste" abaixo.

## Regras por concessão

Valores para carreta de **5 eixos, rodagem dupla, dia útil**. "Ato" é o que fixa o valor ou a regra. Tabela em imagem
foi transcrita em 10/10/2026 (só os valores, sem republicar a imagem).

### RJ — estaduais (AGETRANSP)

| Concessão | Ato | Tarifa | 5 eixos | Vigência | Praças |
|---|---|---|---|---|---|
| **CCR Via Lagos (RJ-124)**, Contrato 43/1996 | Deliberação AGETRANSP/CD nº 1630, de 29/07/2025, **arts. 1º e 2º** (TBP R$ 18,3712 praticada a R$ 18,40; TBA R$ 30,6187 praticada a R$ 30,60) | multiplicador padrão (moto 0,5; 2 eixos simples 1; 2 dupla 2; 3 simples 1,5; 3 dupla 3; 4 simples 2; 4 dupla 4; 5 dupla 5; 6 dupla 6) | **R$ 92,00** (TBP) / **R$ 153,00** (TBA) | a partir de 01/08/2025, "período 2025/2026" (art. 1º) | 1 praça, cobrança nos dois sentidos |
| **Rota 116 (RJ-116)**, Contrato 08/2001 (6º Termo Aditivo, Cláusula Quarta, citada na Deliberação 1790/2026) | Deliberação AGETRANSP/CD nº 1631, de 29/07/2025, **arts. 1º e 2º** (TBP R$ 9,60) | **não linear**: rodas simples 2 a 4 eixos = 1 TBP; 2 eixos dupla = 2; **3, 4, 5 e 6 eixos dupla = 4** (R$ 38,40); 7 eixos = 7 (R$ 67,20); 8 eixos = 8 (R$ 76,80, PDF "evolução das tarifas"); 7 ou mais eixos = R$ 9,60 por eixo (site) | **R$ 38,40** | a partir de 01/08/2025; site: "válidas até 31/07/2026" | Itaboraí, Cachoeiras de Macacu, Nova Friburgo, Cordeiro; cobrança bidirecional |

**Janela da TBA da Via Lagos** (`janela_fds` na tarifa): R$ 30,60 por multiplicador **das 12h de sexta às 12h de
segunda** e **das 12h da véspera às 12h do dia seguinte aos feriados nacionais**; R$ 18,40 no restante. Valores:
Deliberação 1630/2025, arts. 1º e 2º. Janela: comunicado da concessionária (Motiva, 07/2025,
`rodovias.motiva.com.br/vialagos/noticias/2025/julho/...`); a página da AGETRANSP rotula a coluna como "Sáb. Dom. e
feriados". Feriado estadual ou municipal não aciona a TBA (o comunicado fala só em feriados nacionais; dedução
registrada como tal no verify). Feriados nacionais vêm da tabela `holidays` (`scope = 'national'` e `active`: feriado
desativado, com status `a_confirmar`/`suspensa`/`revogada`, não aciona a TBA; banco sem a coluna `active` usa todos).

**Reajuste de agosto/2026 não localizado** (páginas da AGETRANSP ainda com "cobrança praticada a partir de
01/08/2025"; deliberações online até a nº 1816, de 25/06/2026). Por isso a tabela tem `vigencia_fim = 2026-07-31` e,
em viagem posterior, o valor sai **estimado** ("tabela vencida em 31/07/2026; pode ter havido reajuste"). O
importador relê a página a cada carga: se a data mudar, usa os valores novos, registra a deliberação da página e
recalcula a vigência (um ano). Antes disso, confere a **estrutura** da tabela: cada linha da página (multiplicador +
eixos e rodagem do texto "eixos") tem de ser uma categoria da transcrição, e vice-versa (a categoria VIII da Rota 116,
só no PDF da concessionária, é marcada `fora_da_pagina`). Se aparecer linha nova ou sumir categoria (ex.: a Rota 116
passar a cobrar por eixo), os valores da página **não** são casados pelo multiplicador (a categoria "III a VI" receberia
o valor da nova linha de 4 eixos): fica a transcrição, com a vigência encerrada na véspera da nova data da página (o
valor sai estimado), a tarifa leva `estrutura_mudou` e o NOTES da carga diz "estrutura tarifária mudou na página;
retranscrever". Ressalvas do verify: o art. 4º da Deliberação 1630 recomenda à concessionária avaliar
não aplicar reajustes (modernização do contrato); a Deliberação 1698/2026 recomendou ao DER-RJ novo índice, DUF e
regras de eixo suspenso para a Rota 116, então a estrutura pode mudar.

Isenções da Rota 116 (motos, bicicletas, veículos oficiais e do corpo diplomático) ficam registradas em
`props.isencoes`; o app não modela isenções.

### MG — estaduais (ARTEMIG, Lei Estadual 25.235/2025; poder concedente SEINFRA)

| Concessão | Ato | TBP | 5 eixos | Vigência | Praças e posição |
|---|---|---|---|---|---|
| **Lote 1 Triângulo** (EPR Triângulo) | Contrato nº 003/2022 e tabela da ARTEMIG | R$ 14,00 | **R$ 70,00** | válida até 21/10/2026 | P1 Uberaba (MGC-452 km 186,4), P2 Perdizes (BR-452 km 260,3), P3 Monte Carmelo (BR-365 km 515,25), P4 Indianópolis (BR-365 km 589,1), P5 Patrocínio (MGC-462 km 34,15), P7 Nova Ponte (MG-190 km 75,5): nós do OSM. **P6 e P8 inativas** (ver abaixo) |
| **Lote 2 Sul de Minas** (EPR Sul de Minas) | Contrato nº 004/2022 e tabela da ARTEMIG | R$ 10,10 | **R$ 50,50** | vigente enquanto o reajuste estiver suspenso | P1 a P7 pela **coordenada oficial** do 1º Termo Aditivo (cláusula 3.1); P8 = **pórtico free flow** da MG-459 (Monte Sião) |
| **Lote 3 Varginha-Furnas** (EPR Vias do Café) | Contrato nº 005/2023 e tabela da ARTEMIG ("cobrança autorizada pela Seinfra a partir de 26 de julho de 2026") | R$ 15,80 | **R$ 79,00** | 26/07/2026 a 25/07/2027 | P1 Nepomuceno e P2 Boa Esperança (BR-265), P3 Muzambinho (BR-146), P4 Monte Santo de Minas, P5 Alfenas e P6 Três Corações (CMG-491): nós do OSM |
| **MG-050** (Via Nascentes) | Contrato SETOP nº 007/2007 e tabela da ARTEMIG/concessionária | R$ 9,10 | **R$ 45,50** | 13/06/2026 a 12/06/2027 (reajuste anual em 13/06 pelo IPCA) | Pratápolis km 389,2, Passos km 333, Piumhi km 270,7, Formiga km 219,9, São Sebastião do Oeste km 140,5, Itaúna km 81: nós do OSM |
| **BR-135/LMG-754** (Ecovias Norte Minas) | Contrato SETOP nº 004/2018 (3º Termo Aditivo de 03/12/2025) e tabela da ARTEMIG de 24/04/2026 | R$ 10,60 | **R$ 53,00** | até 31/03/2027 | BR-135 km 399, 466, 523, 583 e 634 e LMG-754 km 25: nós do OSM |
| **Lote 7 Ouro Preto–Mariana** (Rota da Liberdade) | Contrato SEINFRA nº 9493121/2026 | não publicada | — | **cobrança não iniciada** | 4 pórticos previstos (BR-356 km 43 e 62,5; MG-262 km 30,3; MG-329 km 125,4): **inativos**, posição por rodovia+km no SRE-MG |

Tabelas de MG: multiplicador = nº de eixos com rodagem dupla (rodagem simples 3/4 eixos = 1,5/2), **eixo adicional
= TBP** acima da maior categoria publicada (Lotes 1, 2 e 3 até 10 eixos; MG-050 "mais de 6 eixos: R$ 54,60 + R$ 9,10
por eixo"). Na MG-050, rodagem single/supersingle conta como dupla (Via Appia). BR-135: tabela até 10 eixos, sem eixo
adicional publicado (acima disso, estimativa pelo multiplicador).

- **Reajuste do Lote 2 SUSPENSO**: Deliberação ARTEMIG nº 41/2026 (R$ 10,60 a partir de 09/10/2026) teve os efeitos
  suspensos pelo TCE-MG (notificação de 07/10/2026; a ARTEMIG suspendeu a aplicação, notícia de 09/10/2026). Fica em
  `props.reajuste_suspenso` (`aplicado: false`) e nunca é usado; vale R$ 10,10.
- **Free flow da MG-459 (Lote 2, P8)**: a PP08 física (1º Termo Aditivo: MG-459 km 6,4) foi trocada por pórtico de
  livre passagem "na localização originalmente prevista" (2º Termo Aditivo de 03/06/2024, subcláusula 2.1.1; Anexo,
  item 1.1: km 12+722); subcláusula 3.5: a troca "não implica alteração da TARIFA DE PEDÁGIO"; o 6º Termo Aditivo
  (03/06/2026) prorrogou a solução por 365 dias. Posição: PER do Lote 2, Apêndice D (km 1012+700, UTM 23S
  349444,12 E / 7527152,32 N, 22 m do km 12+722). Pagamento sem TAG em até 30 dias; débitos regularizados até
  16/11/2026 sem multa (transição da Deliberação CONTRAN 277, notícia ARTEMIG de 15/06/2026). Evasão: CTB art. 209-A.
- **P6 e P8 do Lote 1 inativas** (operação não verificável): sem nó no OSM (o mais próximo a 39 km e 26 km), a P6
  aparece com três códigos de rodovia (ARTEMIG "LMG-190" km 6,80; EPR "MG-190" km 6,80; PER LMG-798 km 13) e a única
  coordenada é a do PER (localização original; P1, P3 e P4 foram realocadas 1,5 a 3,7 km).

### Municipais

| Concessão | Ato / fonte | 5 eixos | Vigência | Status |
|---|---|---|---|---|
| **Linha Amarela** (LAMSA), Rio de Janeiro | tabela da concessionária (Lei 8.987/1995, art. 9º, §5º, incluído pela Lei 13.673/2018); ato da Prefeitura não localizado | **R$ 16,10** (não linear: 2 eixos dupla 6,00; 3 eixos 13,30; 4 eixos 14,50; 6 eixos 20,10; 7 ou mais 24,10) | desde 00h de 18/04/2026 | ativa, confiança média |
| **Transolímpica** (ViaRio), Rio de Janeiro | idem; "tarifa vigente a partir de 00h do dia 03/05/2026" | **R$ 39,80** (não linear: 3 eixos caminhão 32,85; 4 eixos 35,80; 6 eixos 49,75; 7 eixos 59,70) | desde 03/05/2026 | ativa, confiança média; o OSM tem 2 grupos de cabines e a fonte não diz quantas praças há |
| **MGC-393 Pirapetinga** (CRP Concessionária) | concessão municipal de 2024; ação civil pública do MPMG com suspensão judicial da cobrança (notícia de 13/10/2025) | — | — | **inativa** (confiança baixa): site e OSM (check_date 2026-05-13) ainda indicam cobrança |

### ES — sem pedágio estadual

A concessão Rodosol (Terceira Ponte e Rodovia do Sol, ES-060) acabou em 22/12/2023: a ARSP lista como última a "Tabela
de Tarifa em vigor a partir de 1º/01/2023 até 21/12/2023" (`arsp.es.gov.br/tarifas-infraestrutura`; a data do fim foi
deduzida da tabela, sem ato conferido). O OSM não tem nó de pedágio da Rodosol (coerente). No ES só há pedágio
federal (Ecovias Capixaba, BR-101), já na fonte `antt`. Nada a importar.

## Sul e Centro-Oeste (RS, MS, MT; carga de 18/10/2026)

Pesquisa de origem: `docs/research/estados_sul_co/{PR,SC,RS,GO,MT,MS,DF}.json` (verificação cética de 18/10/2026), com a
releitura das páginas das concessionárias na carga. Mesma política dos importadores de MG/RJ: só entra tarifa com ato ou
tabela oficial conferida; a posição vem dos nós de pedágio do OSM do mesmo operador (nenhum destes estados publica
coordenada das praças; o KML da EGR confere com os nós do OSM a menos de 130 m); o que não tem fonte conferida fica
pendente (abaixo), nunca com valor "estimado" inventado.

| Fonte (`source`) | Importador | Concessões | Praças |
|---|---|---|---|
| `agems` | `toll_agems.py` | Way-306 (MS-306/BR-359) e Way-112 (MS-112/BR-158/BR-436), AGEMS | 9 |
| `agermt` | `toll_agermt.py` | Morro da Mesa (MT-130), Via Brasil MT-246, MT-320/MT-208 e MT-100, AGER/MT | 11 |
| `rs-estadual` | `toll_rs_estadual.py` | EGR (estatal, 10 praças em 5 grupos de tarifa) e Rota de Santa Maria (RSC-287) | 15 |

Valores para carreta de **5 eixos, rodagem dupla, dia útil** (R$ por passagem, por praça):

| UF | Concessão | Ato / fonte da tarifa | 5 eixos | Vigência | Praças |
|---|---|---|---|---|---|
| MS | **Way-306** (Contrato 002/2020) | Portaria AGEMS nº 333, de 07/04/2026 (DOE-MS 12.121, pp. 37-38): categoria 1 R$ 14,40; 14 categorias por eixo | **72,00** | a partir de 09/04/2026 | P1 Costa Rica, P2 Chapadão do Sul, P3 Cassilândia (MS-306) |
| MS | **Way-112** (Contrato 02/2023) | Portaria AGEMS nº 326, de 09/02/2026 (DOE-MS 12.071, pp. 60-62): categoria 1 R$ 14,00 (P4, P5, P7, P8, P9) | **70,00** | a partir de 11/02/2026 | P4 Paranaíba, P5 e P7 Aparecida do Taboado (BR-158), P8 Selvíria e P9 Cassilândia II (MS-112) |
| MS | **Way-112, praça P6** (BR-436) | idem, Anexo II: categoria 1 R$ 4,60 | **23,00** | a partir de 11/02/2026 | P6 Aparecida do Taboado II |
| MT | **Morro da Mesa** (Contrato 001/2011) | AGER/MT, reajuste anual (IPCA fev/2026), DOE 17/03/2026, p. 177: TBP R$ 11,70; tabela do site | **58,50** | 01/04/2026 (só o site declara a data) | P-01 Rondonópolis e P-02 Primavera do Leste |
| MT | **Via Brasil MT-246** (Contrato 007/2021) | AGER/MT, 5º reajuste, DOE 31/08/2026, p. 92: TBP R$ 11,40; tabela do site | **57,00** | o ato não declara a data | Rosário Oeste, Barra do Bugres (MT-344) e 2 em Tangará da Serra (MT-358) |
| MT | **Via Brasil MT-320/MT-208** (Contrato 001/2019) | AGER/MT, 6º reajuste, DOE 22/10/2025, p. 75: TBP R$ 11,70; tabela do site | **58,50** | 29/10/2025 a 28/10/2026 (7º reajuste em tramitação) | P1 Colíder, P2 Nova Canaã do Norte, P3 Alta Floresta |
| MT | **Via Brasil MT-100** (Contrato 001/2018) | AGER/MT, reajuste 2024/2025, DOE 11/12/2025, p. 55: TBP R$ 11,70; tabela do site (04/2026) | **58,50** | reajuste 2025/2026 ainda não publicado | P1 Alto Taquari e P2 Alto Araguaia |
| RS | **Rota de Santa Maria** (Contrato 20/2021, RSC-287) | tarifa 2026 da concessionária; categoria I R$ 5,40 desde 29/01/2026 (planilha de evolução tarifária da AGERGS, 05/2026) | **27,00** | desde 29/01/2026 | P01 Taquari (km 47), P02 Venâncio Aires, P03 Candelária, P04 Paraíso do Sul, P05 Santa Maria (km 220, "Pedágio da Palma" no OSM) |
| RS | **EGR** (estatal) grupos A a E | tabelas da página "Tarifas" da EGR (imagens de 05/2022): por eixo A 6,30; B 7,10; C 3,25; D 4,90; E 6,30 | A **31,50** · B **35,50** · C **16,25** · D **24,50** · E **31,50** | a página não informa; `data_desc` diz "imagens de 05/2022" | A: Boa Vista do Sul, Cruzeiro do Sul (RSC-453), Santo Antônio da Patrulha (ERS-474), Viamão (ERS-040); B: Gramado, São Francisco de Paula (ERS-235), Três Coroas (ERS-115); C: Campo Bom; D: Coxilha; E: Encantado |

Estruturas: as tabelas da AGEMS têm 14 categorias (rodagem simples 3 e 4 eixos = 1,5 e 2; dupla = nº de eixos até 9);
acima de 9 eixos vale a categoria 9 mais a tarifa da categoria 1 por eixo excedente (nota 2 das portarias; `eixo_adicional`
= categoria 1). Morro da Mesa: "acima de 9 eixos, tarifa básica x nº de eixos" (site). A AGER/MT fixa a **tarifa básica** e
"reproduz seus efeitos nas demais categorias": os valores por categoria vêm da imagem da concessionária (conferida com a
TBP do DOE). A categoria VI da Rota de Santa Maria é a de **4 eixos** (descrição da AGERGS, RED 701/2023); o site a rotula
"5 eixos" por engano. Na EGR só foram transcritos os comerciais de 2 a 6 eixos (rodagem dupla) e o eixo adicional; o OSM
tem o mesmo valor por eixo em Campo Bom (R$ 3,25, conferido em 2023).

**Ressalvas**
- **EGR**: as imagens são de 05/2022 e a EGR não publica data de vigência nem ato; confiança média (`confianca: media`,
  `data_desc` na tarifa e `vigencia_obs`). A pesquisa recomendava não tratar como vigente; mantivemos porque é a única
  tabela publicada pela própria estatal e confere com o `charge` do OSM, mas qualquer reajuste posterior não está aqui.
- **Via Brasil MT-320**: a tabela vale até 28/10/2026 (aniversário do reajuste; processo AGER-PRO-2026/03089 em tramitação).
  A partir daí a API devolve o valor como **estimado** ("tabela vencida em 28/10/2026; pode ter havido reajuste").
- **Via Brasil MT-246**: a lista e o km das praças vêm de fonte secundária (emsampa) e do OSM; a tarifa é oficial
  (`confianca: media`). O km da concessão não é o km do SRE.
- Posição pelo OSM: âncora = centro do grupo de nós do operador (`raio_m` 500); método em `props.posicao_metodo`.
- Reajustes anuais esperados (inferência pelo histórico, não por ato): Way-112 em 02/2027, Way-306 em 04/2027, MT-100 em
  ~12/2026, Morro da Mesa em ~03-04/2027, MT-246 em ~08/2027, Rota de Santa Maria em ~01/2027.

**Pendentes (não entram) e por quê**
- **PR, SC, GO, DF**: sem concessão rodoviária estadual com cobrança (PR: lotes novos são ANTT/delegação, já na fonte `antt`;
  GO: Lei 19.999/2018 revogada pela Lei 21.549/2022; SC e DF: nenhuma). O ferry de Guaratuba (PR, Decreto 4.456/2023) é travessia,
  não pedágio de rodovia, e ficou fora.
- **RS, Caminhos da Serra Gaúcha (Bloco 3, free flow, 6 pórticos)**: a tabela por pórtico da pesquisa (RED 724/2024) está
  **vencida**; só a categoria I (automóvel) de 29/04/2026 está publicada na planilha da AGERGS. Derivar caminhão por multiplicador
  seria inferência. Os nós dos pórticos já existem no OSM (sem tarifa). Blocos 1 e 2: sem concessionária (leilão do Bloco 2
  cancelado em 03/06/2026).
- **MT, Rota dos Grãos (MT-130)**: tarifa de R$ 11,27 (DOE 13/10/2026) condicionada a ato autorizativo e o site ainda mostra
  R$ 10,90; 6 pórticos free flow com km mas sem coordenada; as "praças convencionais" km 167 e 243 só em fonte secundária.
- **MT, Via Norte Sul (MT-220)**: TBP R$ 11,40 oficial (DOE 22/01/2026, vigência 27/01/2026), mas sem tabela por categoria
  publicada que eu tenha conseguido ler; **Intervias, APASI, SPS, Rodovia da Mudança**: sem valor oficial atual (Rodovia da
  Mudança: R$ 11,50 de 02/2025, possivelmente defasado). **Fase 1 e Fase 2 do programa estadual de MT**: sem cobrança confirmada.
- **MS, Rota da Celulose**: cobrança só a partir de ~02/2027, tarifas finais não publicadas.

Exemplos (API local, carreta 5 eixos, 20-21/10/2026): Costa Rica → Cassilândia (MS-306) **R$ 144,00** (P2 + P3, 72 + 72);
Rondonópolis → Primavera do Leste (Morro da Mesa) **R$ 117,00**; Rosário Oeste → Barra do Bugres (MT-246) **R$ 114,00**;
Paraíso do Sul → Venâncio Aires (RSC-287, P04 + P03) **R$ 54,00**; Gramado → São Francisco de Paula (EGR, grupo B)
**R$ 71,00**.

Como atualizar: transcrever a nova tabela em `concessoes_estaduais_sul_co.json` (valores, `vigencia_*`, `ato`) e rodar
`python3 run.py toll_agems toll_agermt toll_rs_estadual` (ver o comando nativo no README dos importadores); depois
`importers/tests/test_pedagio_sul_co.py` e `api/test/layers/pedagio_sul_co.test.ts`.

## Como entra no cálculo

`api/src/services/tollCost.ts` e `api/src/layers/pedagio.layer.ts` (ver também [pedagio.md](pedagio.md)):

1. **Associação**: o nó de pedágio do OSM cruzado pela rota é associado à praça oficial mais próxima, como nas
   fontes ANTT/ARTESP. Estas fontes limitam a associação a 400 m (`casar_ate_m`), porque a posição já é a do nó ou a
   oficial (evita, por exemplo, uma praça da BR-101 pegar a tarifa da Rota 116).
2. **Tabela por categoria**: `eixos_ate` (faixa: "3 a 6 eixos", "7 ou mais"), `eixo_adicional` (valor oficial por
   eixo excedente, não é estimativa) e `nao_linear` (Rota 116, Linha Amarela, Transolímpica: sem extrapolação pelo
   multiplicador acima da tabela e sem aviso de divergência com o `charge` por eixo do OSM, que não representa tabela
   não linear).
3. **Janela tarifária** (`janela_fds`): conferida no **horário estimado de passagem** pela praça = saída + fração da
   distância x duração da rota (`passagem_estimada` na praça). Sem janela, a coluna de fim de semana continua valendo
   sábado e domingo pela data de saída (ANTT).
4. **Registro inativo** (`ativo: false`): fora da associação, da soma e das "praças possíveis"; regra de confiança
   baixa nunca é aplicada, nem pelo valor do OSM. Se a rota cruza uma cabine do OSM a até 400 m dele (CRP
   Pirapetinga), o ponto é listado como **situação incerta, fora do total** (`valor: null`, `registro_inativo` com
   motivo e ato), com o valor do OSM só como referência (`valor_osm`, `data_osm`, na linha do resumo e no aviso
   `toll_status_uncertain`). Como na cobrança suspensa, o ponto também fica fora das "praças sem tarifa", do aviso de
   free flow e dos anéis da alternativa sem pedágio. No mapa, o registro inativo aparece com "fora do total do app:
   <motivo>" (o nó do OSM a até 800 m fica escondido).
5. **Pórtico oficial sem nó no OSM** (`cobra_sem_no_osm`, P8 do Lote 2): conta quando a rota passa a até 30 m do ponto
   oficial e no rumo da via (9,8°/189,8° na MG-459, medido no grafo do Valhalla com `/locate` em 10/10/2026), com
   `deteccao: 'oficial_sem_osm'`; o aviso `toll_free_flow` traz o prazo de pagamento da fonte. O texto de pagamento
   vale só para o operador que o publicou: rota com pórticos de operadores diferentes recebe a instrução por operador
   (ex.: "MG-459 (EPR Sul de Minas): pague em até 30 dias…; demais: pague pelo site ou app da concessionária no prazo
   informado por ela"; pórtico federal: 30 dias, ANTT).
6. **Correção no OSM como reserva**: valor condicionado ao dia (`Mo-Fr`/`Sa-Su`) só vale no próprio período; o de fim
   de semana não serve mais de reserva num dia útil (a Via Lagos saía R$ 153,00 numa quarta).
7. **Alternativa sem pedágio**: além de `exclude_tolls`, a consulta leva um anel de 25 m em volta de cada ponto de
   cobrança da rota principal (`exclude_polygons`), porque muitas praças estaduais ficam em via sem `toll=yes` no
   grafo (EPR em MG, Via Lagos, Linha Amarela: só 33 de 81 nós estaduais/municipais em via `toll=yes`). Ponto a menos
   de 300 m da origem ou do destino fica de fora. A comparação "mesma praça" usa a praça oficial (outra cabine da
   mesma praça não conta como desvio).

Exemplos (API local, carreta 5 eixos, 10/10/2026):

| Rota | Antes | Agora |
|---|---|---|
| Rio Bonito → Cabo Frio, quarta 14/10 10h | R$ 153,00 (TBA do OSM numa quarta) | **R$ 92,00** (AGETRANSP, estimado: tabela vencida em 31/07/2026); sem pedágio: +15,3 km |
| idem, sexta 16/10 15h / terça 13/10 10h (dia seguinte ao feriado de 12/10) | R$ 153,00 / R$ 153,00 | **R$ 153,00** (TBA, passagem às 15h22 / 10h22) |
| Itaboraí → Nova Friburgo (Rota 116) | R$ 128,00 (12,80 x 5 x 2) | **R$ 76,80** (38,40 x 2) |
| Uberlândia → Araxá (Lote 1, P1 e P2) | R$ 140,00 (OSM, estimado) | **R$ 140,00** (ARTEMIG) |
| Poços de Caldas → BR-459 (Lote 2, P1 e P2) | R$ 101,00 (OSM) | **R$ 101,00** (ARTEMIG); sem pedágio: +56,1 km |
| Ouro Fino → Monte Sião (MG-459) | R$ 0,00 (pórtico ausente no OSM) | **R$ 50,50** (pórtico free flow) |
| Lavras → Boa Esperança (Lote 3) | R$ 158,00 (OSM; "mesmos pontos") | **R$ 158,00** (ARTEMIG); sem pedágio: +29,3 km |
| Transolímpica (sul → norte) | R$ 49,75 | **R$ 39,80** |
| MGC-393 Pirapetinga (-21,7,-42,3 → -21,6,-42,45) | R$ 55,00 (OSM, somado) | **R$ 0,00**: "situação incerta (não somado; OSM: R$ 55,00…)" e aviso `toll_status_uncertain` |

## Balanças do DER-MG (`der-mg`)

- **Lista vigente**: tabela "LOCALIZAÇÃO DOS 43 POSTOS DE PESAGEM EM OPERAÇÃO NA MALHA RODOVIÁRIA SOB RESPONSABILIDADE
  DO DER-MG" (`der.mg.gov.br/transportes/pracas-de-pesagem`): URG, rodovia, km, município, operação "24 horas" ou
  "Estratégica" e, pela cor da linha, a concessão do trecho (legenda da própria tabela: Nascentes das Gerais, EPR Sul
  de Minas, EPR Vias do Café, Rota da Liberdade).
- **Coordenadas**: camada pública `00_PUBLICACOES/pracas_pesagem/FeatureServer/2` do Observatório da Infraestrutura
  (52 pontos; status de 2024). Casamento pelo nº da rodovia (MG/MGC/BR/LMG coincidentes), km a até 1 km e ramo A/B:
  40 de 43. Sem par: rodovia+km no SRE-MG 2026_02 (2 postos, `precisao: 'aprox_km'`). **MGC-354 km 94,5 (Lagamar)**
  fica sem posição (o km cai em trecho coincidente, cadastrado no SRE sob outra sigla).
- **Precisão `aprox`**: as coordenadas caem sobre a via ou o acesso do posto e não indicam o lado da pista; a camada
  não deduz o sentido e lista o posto como "sentido não confirmado". A fonte não traz sentido de fiscalização (só
  "Ramo A/B" em Poços de Caldas e Arceburgo). Postos "Estratégica" levam ", operação estratégica" no nome (rótulo da
  tabela). Não são eventuais: o site diz que "o funcionamento das balanças ocorre de forma permanente e estratégica
  todos os dias da semana" (`props.operacao_obs`), sem horário por posto; posto sinalizado aberto obriga a entrar.
- 12 pontos da camada que não estão na lista do site (previstos ou em obras em 2024) não são importados.
- Base legal do aviso: CTB art. 209 (deixar de adentrar as áreas de pesagem, redação da Lei 14.157/2021).
- RJ e ES: nenhuma lista aberta de balanças estaduais (DER-RJ sem dados; DER-ES só publica radares). A balança da
  Rota da Liberdade (BR-356 km 62,3) não está na lista do DER-MG e não tem coordenada: não importada.

## Licenças

| Fonte | Licença / uso |
|---|---|
| Deliberações AGETRANSP e valores das tabelas oficiais (AGETRANSP, ARTEMIG) | atos oficiais, sem proteção autoral (Lei 9.610/1998, art. 8º, IV); página da AGETRANSP sem licença declarada; portal da ARTEMIG "todos os direitos reservados": usamos só os valores, com citação, sem republicar as imagens |
| Tabelas das concessionárias (LAMSA, ViaRio, CRP, Rota 116, Via Appia) | publicação obrigatória (Lei 8.987/1995, art. 9º, §5º); sites sem licença aberta (LAMSA: "todos os direitos reservados"): só os valores, com citação |
| Posição pelos nós de pedágio | OpenStreetMap, ODbL 1.0 (dados em `data_features`, separados do OSM do roteamento) |
| Site do DER-MG (lista de balanças) | reutilização com identificação da fonte e crédito ("Aspectos legais") |
| Observatório da Infraestrutura: `pracas_pesagem` e `sremg_2026_02` | sem licença declarada (itens sem `licenseInfo`); **`Balancas_V2` declara "Informação de uso restrito DER-MG" e não é usada** |

## Como atualizar

```sh
# rede do compose; os importadores de pedágio leem os nós do OSM já importados (fonte 'osm' da camada pedagio)
docker compose --profile import run --rm importer toll_agetransp toll_artemig toll_municipais weigh_dermg
```

- **Reajustes** (conferir perto das datas): Lote 1 em 21/10/2026; Lote 2 aguarda o TCE-MG; Via Lagos e Rota 116 em
  agosto (o importador relê a AGETRANSP; sondar deliberações `.../deliberacoes/numero/N/visualizar` acima da 1816);
  BR-135 em 31/03/2027; MG-050 em 12/06/2027; Lote 3 em 25/07/2027; Linha Amarela e Transolímpica sem data fixa.
  Tabela em imagem (ARTEMIG, LAMSA): transcrever no JSON (valores, `vigencia_*`, `data_desc`, ato) e rodar o
  importador; o teste `test_tabelas_lineares_conferem_com_o_multiplicador` confere a transcrição das tabelas lineares.
- **Lote 7**: quando a cobrança começar e as tarifas forem publicadas, preencher `tarifa`, `ativo: true` e as
  posições (de preferência pelos pórticos do OSM ou coordenada oficial).
- **CRP Pirapetinga / Lote 1 P6 e P8**: ativar só com confirmação (decisão judicial; nó no OSM ou coordenada atual).
- **Posição pelo OSM**: a âncora de cada praça é o grupo de nós identificado em 10/10/2026; se o OSM mudar o nó, o
  importador acha o novo nó do mesmo operador a até `raio_m`; sem nó, a praça fica na âncora com `precisao: 'aprox'`
  e o log avisa. Os nós vêm do banco (fonte `osm`) só se a última carga do `toll_osm` for posterior ao PBF local
  (`data/valhalla/*.osm.pbf`); se o PBF for mais novo, os três importadores leem os nós direto do PBF (uma vez por
  processo) e o log avisa. Isso cobre o `run.py all`, que roda em ordem alfabética e chama `toll_agetransp`,
  `toll_artemig` e `toll_municipais` **antes** do `toll_osm`. Mesmo assim, rode o `toll_osm` junto quando o extrato
  mudar (a API casa a rota com os nós da fonte `osm` do banco).
- **Testes**: `api/test/layers/pedagio_sul_co.test.ts`, `importers/tests/test_pedagio_sul_co.py` (RS, MS, MT),
  `api/test/layers/pedagio_estaduais.test.ts`, `api/test/layers/balancas_dermg.test.ts` e
  `importers/tests/test_pedagio_estaduais.py` (sem rede: `docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data:/data
  --entrypoint python truck-router-importer -m unittest tests.test_pedagio_estaduais -v`).

## Limitações

- Reajuste de 2026 da Via Lagos e da Rota 116 não publicado até 10/10/2026: valor sai estimado.
- Horário de passagem estimado pela fração da distância (sem trânsito): perto das 12h de sexta/segunda ou de véspera
  de feriado, a TBA pode errar para um lado ou outro.
- Isenções, DUF (desconto de usuário frequente, só categoria 1 com TAG em MG) e descontos de TAG não são modelados.
- Linha Amarela: as rotas de teste do Valhalla não usaram a via (o Valhalla prefere outro caminho); a tarifa foi
  conferida só no unitário.
- Transolímpica: a fonte não diz quantas praças há; cada grupo de cabines do OSM recebe a tabela.
- Balanças do DER-MG sem sentido de fiscalização; MGC-354 km 94,5 sem posição.

## Decisões

- **Correções do verify aplicadas**: (1) a Balancas_V2 é de uso restrito: só a camada `pracas_pesagem` + lista do
  site (40/43 casados); (2) a P8 do Lote 2 É o pórtico free flow (7 praças físicas + 1 pórtico, não 8 + 1), com
  posição oficial e tarifa igual; (3) o Lote 2 tem coordenadas oficiais (1º Termo Aditivo) e o PER do Lote 1 tem as
  das praças originais; (4) contrato do Lote 3 citado como "nº 005/2023" (o prefixo SULOG não foi conferido); (5) a
  P6 do Lote 1 aparece com três códigos de rodovia.
- Tabela de MG transcrita por categoria (e não só "TBP x eixos"): é o que a fonte publica, e o teste confere a
  coerência com o multiplicador.
- Rodovia+km não posiciona praça de MG (o km da concessão difere do km do SRE em até 8 km na MG-050); só os pórticos
  inativos do Lote 7 e as balanças sem par usam o SRE.
- Registro inativo fica no banco, com `motivo_inativo` e `tarifa_registrada`, mas sem `tarifa`: nada o aplica.
- A alternativa sem pedágio com anel em volta das praças vale para todas as fontes (antes, praça em via sem
  `toll=yes` gerava "mesmos pontos" e nenhum desvio).
- **Revisão de 10/10/2026**: (1) a CRP Pirapetinga (inativa) era cobrada pelo valor do OSM e o mapa dizia "não
  cobrada": agora o ponto fica fora do total, como a cobrança suspensa (a regra de confiança baixa nunca é aplicada);
  (2) a AGETRANSP só tem os valores casados pelo multiplicador quando a estrutura da tabela é a mesma; (3) só feriado
  nacional ativo aciona a TBA; (4) instrução de pagamento do free flow por operador; (5) "eventual" saiu do nome das
  balanças "Estratégica" do DER-MG (não está na fonte); (6) nós do OSM do extrato mais novo (ordem do `run.py all`).
