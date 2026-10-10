# Feriados do Sudeste (calendário legal: RJ, MG, ES e municípios)

Frente `feriados_sudeste`. Estende o calendário legal da camada `core_legal` (tabela `holidays`) com os feriados
estaduais do RJ e do ES (MG só tem o 21/04, que já é nacional) e os municipais das capitais e dos polos pesquisados.
Não é camada nova: as regras com "exceto feriados" das outras camadas e o núcleo leem a mesma tabela por
`api/src/services/calendar.ts`.

| Peça | Arquivo |
|---|---|
| Regras curadas (fonte da carga) | `data/raw/feriados/regras.json` |
| Importador | `importers/sources/feriados_sudeste.py` (`LAYER_ID = core_legal`, `SOURCE = feriados-sudeste`) |
| Seed versionado | `db/seed/layers/core_legal__feriados-sudeste.sql` (274 linhas de 2026 a 2028, 122 KB) |
| Migration | `db/migrations/0202_feriados_sudeste.sql` |
| API | `api/src/services/calendar.ts`, aviso `holiday_local` em `api/src/services/routing.ts` |
| Testes | `api/test/layers/feriados_sudeste.test.ts`, `importers/tests/test_feriados_sudeste.py` |
| Pesquisa | `research.json` e `verify.json` da pesquisa feriados_sudeste (10/10/2026); correções do verify aplicadas |

## Como a rota usa

1. **Regra com "exceto feriados" de um município** (ex.: VER de Osasco e de Barueri na camada `restricoes_rmsp`): a camada
   chama `legalDayInfo(at, ibge_da_regra)`. A UF do feriado estadual agora vem dos 2 primeiros dígitos do IBGE
   (31 = MG, 32 = ES, 33 = RJ, 35 = SP). Antes era SP para qualquer município: numa regra do Rio valeria o 9/7 paulista
   e não valeria o São Jorge. Exemplo testado: a VER de Osasco fica suspensa no 19/02/2026 (Emancipação, Decreto Osasco
   14.952/2025, art. 2º) e vale no 20/02 (só "emenda", ponto facultativo).
2. **Zonas de São Paulo capital** (ZMRC, rodízio, perigosos): continuam com o calendário da capital (`legalDayInfo(at)`,
   sem mudança). O aviso `holiday` do `routing.ts` também continua o mesmo.
3. **Aviso `holiday_local`**: a rota localiza o município da origem e o do destino e avisa os feriados estaduais e
   municipais do dia nesses municípios, com a norma. Exemplo (rota no Rio em 23/04/2026):
   "Feriado em Rio de Janeiro/RJ (origem e destino) em 23/04/2026: Dia de São Jorge — feriado estadual (Lei estadual RJ
   5.198/2008, art. 1º). Regras locais que valem "exceto feriados" não se aplicam nesse dia; rodovias podem ter
   restrição de feriado." Não repete o que já saiu no aviso `holiday` (feriados de São Paulo capital, como o 9/7).
4. **Feriado prolongado da Anchieta** (`rodovias_horario`, Portaria SUP/DER-084/2023 art. 3º § 5º): a camada já
   consultava os municipais de Santos, Cubatão, São Bernardo, Praia Grande e São Vicente, que não tinham linha. Agora
   têm. A consulta passou a usar só linhas ativas.

### O mínimo que a rota precisou saber do município (decisão)

O feriado que **suspende** uma regra é sempre o do município da própria regra (cada camada sabe o IBGE da regra). Por
isso a rota não precisa do município da origem/destino para aplicar regra nenhuma: só para **avisar** o motorista. O
mínimo implementado foi `municipiosAt(pontos)` em `calendar.ts`, que acha o município pela malha municipal do IBGE já
carregada em `data_features` (camada `geocoding`, fonte `ibge-malhas`: os 1.668 municípios do Sudeste, seed
`geocoding__ibge-malhas.sql`; se faltar, os 39 limites da camada `restricoes_rmsp`), e `endpointHolidays(at, origem,
destino)`, chamado uma vez por rota no `routing.ts` (uma consulta espacial com índice GiST, cerca de 1 ms).
Limites: só origem e destino (municípios atravessados no meio da rota não geram aviso; as regras deles já usam o
feriado certo pelo item 1); a malha é a "intermediária" do IBGE, então a poucos metros da divisa o município pode sair
trocado; ponto fora da malha (mar, outro estado) não gera aviso.

### Política

- Só entra **feriado**. Ponto facultativo, "emenda", "dia sem expediente" e data cívica não suspendem regra de trânsito.
- Na dúvida, a restrição continua: confiança `baixa` ou `unverifiable` entra com `active = false` e o motivo em
  `inactive_reason`; norma declarada inconstitucional (ou revogada, suspensa) entra registrada com o `status` e nunca é
  aplicada. O banco garante (check `holidays_active_check` da migration 0202): linha ativa só com `status = 'vigente'`
  e confiança alta ou média; linha desativada sempre com motivo.
- Hierarquia de fontes por município: decreto anual ou lei municipal (Querido Diário) > ato de feriados locais de
  tribunal (TJ, TRT, TRF; Recomendação CNJ 44/2020) > nada. Dataset comunitário (joaopbini, feriados.dev) e API
  comercial nunca suspendem regra: no Sudeste divergem dos atos oficiais em 20–43% das sedes de comarca.
- Datas fixas tiradas de ato de tribunal sem lei identificada valem só no ano do ato (2026); regras com lei citada
  (fixa ou relativa à Páscoa) são projetadas até 2028.
- Quando a norma aparece sem artigo, o texto dela não foi aberto: a citação vem do decreto anual ou do ato do tribunal,
  e a confiança reflete isso.

## Regras

Datas móveis pela Páscoa (algoritmo gregoriano, o mesmo de `scripts/gen-zones-seed.py`): Páscoa em 05/04/2026,
28/03/2027 e 16/04/2028. Tabelas geradas de `data/raw/feriados/regras.json`.

### Estaduais

| UF | Feriado | 2026 | Regra | Norma (ato e artigo) | Confiança | Situação |
|---|---|---|---|---|---|---|
| RJ | Terça-feira de Carnaval | 17/02 | Páscoa − 47 dias; desde 01/01/2009 | Lei estadual RJ 5.243/2008, art. 1º | alta | aplicado |
| RJ | Dia de São Jorge | 23/04 | fixa: 23 de abril | Lei estadual RJ 5.198/2008, art. 1º | alta | aplicado |
| RJ | Corpus Christi | 04/06 | Páscoa + 60 dias; desde 23/10/2025 | Lei estadual RJ 11.002/2025, art. 1º (DO 23/10/2025) | alta | aplicado |
| RJ | Dia de Zumbi e da Consciência Negra | 20/11 | fixa: 20 de novembro | Lei estadual RJ 4.007/2002, art. 1º | alta | sem linha própria (nacional: Lei federal 14.759/2023, art. 1º (já em db/seed/0004_holidays.sql)) |
| RJ | Dia das Mães (2º domingo de maio) | 10/05 | 2º domingo de maio | Lei estadual RJ 8.174/2018, art. 1º | alta | **não aplicado** (inconstitucional) |
| RJ | Quarta-feira de Cinzas (feriado bancário) | 18/02 | Páscoa − 46 dias | Lei estadual RJ 8.217/2018, art. 1º | alta | **não aplicado** (inconstitucional) |
| ES | Nossa Senhora da Penha (data magna do ES) | 13/04 | Páscoa + 8 dias; desde 01/01/2020 | Lei estadual ES 11.010/2019, art. 1º e parágrafo único | alta | aplicado |
| MG | Data magna de Minas Gerais (Tiradentes) | 21/04 | fixa: 21 de abril | Constituição do Estado de MG, art. 256, I | alta | sem linha própria (nacional: Tiradentes, Lei federal 662/1949 art. 1º (já em db/seed/0004_holidays.sql)) |

### Municipais aplicados

"—" em 2026: a regra não gera data nesse ano (o feriado do BRICS foi em 2025 e fica só como registro do padrão de feriado avulso do Rio).

| Município (IBGE) | Feriado | 2026 | Regra | Norma | Confiança |
|---|---|---|---|---|---|
| Rio de Janeiro/RJ (3304557) | São Sebastião (padroeiro) | 20/01 | fixa: 20 de janeiro | Lei Orgânica do Município do Rio de Janeiro, art. 26 (citada pelo TJRJ no calendário da Capital de 2026) | media |
| Rio de Janeiro/RJ (3304557) | Feriado da Cúpula do BRICS | — | avulsa: 07/07/2025 | Lei municipal Rio 8.881/2025, art. 1º (14/04/2025) | alta |
| Niterói/RJ (3303302) | Corpus Christi | 04/06 | Páscoa + 60 dias; desde 28/05/2026 | Lei municipal Niterói 4.125/2026, art. 1º (28/05/2026) | alta |
| Duque de Caxias/RJ (3301702) | Santo Antônio (padroeiro) | 13/06 | fixa: 13 de junho | Deliberação municipal Duque de Caxias 1.543/1970 (citada no calendário do TJRJ, 4º NUR) | media |
| Belo Horizonte/MG (3106200) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Lei municipal BH 11.397/2022, Anexo V (consolidação; citada nos considerandos da Portaria Conjunta TJMG 1798/2026) | media |
| Belo Horizonte/MG (3106200) | Corpus Christi | 04/06 | Páscoa + 60 dias | Lei municipal BH 11.397/2022, Anexo V; Portaria Conjunta TJMG 1798/2026, art. 2º, I (o TRT3 cita a Lei BH 1.327/1967) | media |
| Belo Horizonte/MG (3106200) | Assunção de Nossa Senhora | 15/08 | fixa: 15 de agosto | Lei municipal BH 11.397/2022, Anexo V; Portaria Conjunta TJMG 1798/2026, art. 2º, II (o TRT3 cita a Lei BH 1.327/1967) | media |
| Belo Horizonte/MG (3106200) | Imaculada Conceição | 08/12 | fixa: 8 de dezembro | Lei municipal BH 11.397/2022, Anexo V (citada na Portaria Conjunta TJMG 1798/2026; o TRT3 cita a Lei BH 1.327/1967) | media |
| Contagem/MG (3118601) | Jubileu de Nossa Senhora das Dores | 27/03 | avulsa: 27/03/2026 | Lei municipal Contagem 3.484/2001; Decreto Contagem 1.829/2026, Anexo Único | alta |
| Contagem/MG (3118601) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Lei municipal Contagem 3.484/2001; Decreto Contagem 1.829/2026, Anexo Único | alta |
| Contagem/MG (3118601) | Corpus Christi | 04/06 | Páscoa + 60 dias | Lei municipal Contagem 3.484/2001; Decreto Contagem 1.829/2026, Anexo Único | alta |
| Betim/MG (3106705) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Portaria Conjunta TJMG 1798/2026, Anexo Único (lei municipal não identificada) | media |
| Betim/MG (3106705) | Corpus Christi | 04/06 | Páscoa + 60 dias | Lei municipal Betim 4.731/2008 (citada pelo TRT3, Port. 991/2025); Portaria Conjunta TJMG 1798/2026, Anexo Único | media |
| Betim/MG (3106705) | Nossa Senhora do Carmo (padroeira) | 16/07 | fixa: 16 de julho | Lei municipal Betim 99/1952 (citada pelo TRT3, Port. 991/2025); Portaria Conjunta TJMG 1798/2026, Anexo Único | media |
| Juiz de Fora/MG (3136702) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Portaria Conjunta TJMG 1798/2026, Anexo Único (lei municipal não identificada) | media |
| Juiz de Fora/MG (3136702) | Corpus Christi | 04/06 | Páscoa + 60 dias | Lei municipal Juiz de Fora 8.733/1995 (citada pelo TRT3, Port. 991/2025); Portaria Conjunta TJMG 1798/2026, Anexo Único | media |
| Juiz de Fora/MG (3136702) | Santo Antônio (padroeiro) | 13/06 | fixa: 13 de junho | Lei municipal Juiz de Fora 8.733/1995 (citada pelo TRT3, Port. 991/2025); Portaria Conjunta TJMG 1798/2026, Anexo Único | media |
| Uberlândia/MG (3170206) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Portaria Conjunta TJMG 1798/2026, Anexo Único (lei municipal não identificada) | media |
| Uberlândia/MG (3170206) | Corpus Christi | 04/06 | Páscoa + 60 dias | Decreto municipal Uberlândia 2.035/2022 (citado pelo TRT3, Port. 991/2025); Portaria Conjunta TJMG 1798/2026, Anexo Único | media |
| Uberlândia/MG (3170206) | Nossa Senhora da Abadia | 15/08 | fixa: 15 de agosto | Lei municipal Uberlândia 6.892/1996 (citada pelo TRT3, Port. 991/2025); Portaria Conjunta TJMG 1798/2026, Anexo Único | media |
| Uberlândia/MG (3170206) | São Raimundo e aniversário da cidade | 31/08 | fixa: 31 de agosto | Lei municipal Uberlândia 6.892/1996 (citada pelo TRT3, Port. 991/2025); Portaria Conjunta TJMG 1798/2026, Anexo Único | media |
| Extrema/MG (3125101) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Portaria Conjunta TJMG 1798/2026, Anexo Único (lei municipal não identificada) | media |
| Extrema/MG (3125101) | Corpus Christi | 04/06 | Páscoa + 60 dias | Portaria Conjunta TJMG 1798/2026, Anexo Único (lei municipal não identificada) | media |
| Extrema/MG (3125101) | Santa Rita (padroeira) | 22/05 | fixa: 22 de maio (só 2026) | Portaria Conjunta TJMG 1798/2026, Anexo Único (lei municipal não identificada) | media |
| Extrema/MG (3125101) | Aniversário do município | 18/09 | fixa: 18 de setembro (só 2026) | Portaria Conjunta TJMG 1798/2026, Anexo Único (lei municipal não identificada) | media |
| Vitória/ES (3205309) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Lei municipal Vitória 1.732/1967; Decreto Vitória 25.991/2025 (DOM ed. 2788, 18/12/2025) | alta |
| Vitória/ES (3205309) | Corpus Christi | 04/06 | Páscoa + 60 dias | Lei municipal Vitória 1.732/1967; Decreto Vitória 25.991/2025 (DOM ed. 2788, 18/12/2025) | alta |
| Vitória/ES (3205309) | Nossa Senhora da Vitória (padroeira) | 08/09 | fixa: 8 de setembro | Lei municipal Vitória 1.732/1967; Decreto Vitória 25.991/2025; TJES Ato Normativo 176/2026, art. 3º; TRF2 Portaria PRES 845/2025, art. 2º | alta |
| Serra/ES (3205002) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Lei municipal Serra 4.950/2019; Decreto Serra 1.908/2025, Anexo Único | alta |
| Serra/ES (3205002) | São Pedro | 29/06 | fixa: 29 de junho | Lei municipal Serra 4.950/2019; Decreto Serra 1.908/2025, Anexo Único; TRF2 Portaria PRES 845/2025, art. 2º | alta |
| Serra/ES (3205002) | Nossa Senhora da Conceição | 08/12 | fixa: 8 de dezembro | Lei municipal Serra 4.950/2019; Decreto Serra 1.908/2025, Anexo Único | alta |
| Serra/ES (3205002) | Dia do Serrano | 26/12 | fixa: 26 de dezembro | Lei municipal Serra 4.950/2019; Decreto Serra 1.908/2025, Anexo Único | alta |
| Aracruz/ES (3200607) | Emancipação política de Aracruz | 03/04 | fixa: 3 de abril | Lei municipal Aracruz 3.658/2013 (citada pelo TRT17, Ato PRESI SECOR 44/2025) | media |
| Aracruz/ES (3200607) | São João Batista (padroeiro) | 24/06 | fixa: 24 de junho | Lei municipal Aracruz 3.658/2013 (citada pelo TRT17, Ato PRESI SECOR 44/2025) | media |
| Cachoeiro de Itapemirim/ES (3201209) | São Pedro (padroeiro) | 29/06 | fixa: 29 de junho | Lei municipal Cachoeiro de Itapemirim 1.125/1967 (citada pelo TRT17, Ato PRESI SECOR 44/2025); TRF2 Portaria PRES 845/2025, art. 2º | media |
| Colatina/ES (3201506) | Sagrado Coração de Jesus | 12/06 | Páscoa + 68 dias | Lei municipal Colatina 3.336/1988 (citada pelo TRT17, Ato PRESI SECOR 44/2025); TRF2 Portaria PRES 845/2025, art. 2º | media |
| Colatina/ES (3201506) | Fundação de Colatina | 22/08 | fixa: 22 de agosto | Lei municipal Colatina 3.336/1988 (citada pelo TRT17, Ato PRESI SECOR 44/2025) | media |
| Linhares/ES (3203205) | Fundação de Linhares | 22/08 | fixa: 22 de agosto | Lei municipal Linhares 1.602/1992 (citada pelo TRT17, Ato PRESI SECOR 44/2025) | media |
| Linhares/ES (3203205) | Nossa Senhora da Conceição (padroeira) | 08/12 | fixa: 8 de dezembro | Lei municipal Linhares 1.602/1992 (citada pelo TRT17, Ato PRESI SECOR 44/2025) | media |
| São Mateus/ES (3204906) | Fundação de São Mateus | 21/09 | fixa: 21 de setembro | Lei municipal São Mateus 01/1990 (citada pelo TRT17, Ato PRESI SECOR 44/2025); TRF2 Portaria PRES 845/2025, art. 2º | media |
| São Mateus/ES (3204906) | São Benedito (padroeiro) | 27/12 | fixa: 27 de dezembro | Lei municipal São Mateus 01/1990 (citada pelo TRT17, Ato PRESI SECOR 44/2025) | media |
| Osasco/SP (3534401) | Emancipação de Osasco | 19/02 | fixa: 19 de fevereiro | Decreto Osasco 14.952/2025, art. 2º (IOMO 2937, 10/12/2025); Lei municipal Osasco 3.830/2004 (citada pelo TRT2) | alta |
| Osasco/SP (3534401) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Decreto Osasco 14.952/2025, art. 2º (IOMO 2937, 10/12/2025) | alta |
| Osasco/SP (3534401) | Corpus Christi | 04/06 | Páscoa + 60 dias | Decreto Osasco 14.952/2025, art. 2º (IOMO 2937, 10/12/2025) | alta |
| Osasco/SP (3534401) | Santo Antônio (padroeiro) | 13/06 | fixa: 13 de junho | Decreto Osasco 14.952/2025, art. 2º (IOMO 2937, 10/12/2025) | alta |
| Barueri/SP (3505708) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Decreto Barueri 10.264/2025, art. 1º (Jornal Oficial ed. 1.918, 12/11/2025) | alta |
| Barueri/SP (3505708) | Corpus Christi | 04/06 | Páscoa + 60 dias | Decreto Barueri 10.264/2025, art. 1º (Jornal Oficial ed. 1.918, 12/11/2025) | alta |
| Barueri/SP (3505708) | São João Batista (padroeiro) | 24/06 | fixa: 24 de junho | Decreto Barueri 10.264/2025, art. 1º (Jornal Oficial ed. 1.918, 12/11/2025) | alta |
| Campinas/SP (3509502) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Lei municipal Campinas 173/1949; Decreto Campinas 24.240/2026, art. 1º | alta |
| Campinas/SP (3509502) | Corpus Christi | 04/06 | Páscoa + 60 dias | Lei municipal Campinas 173/1949; Decreto Campinas 24.240/2026, art. 1º | alta |
| Campinas/SP (3509502) | Dia do Evangélico | 12/08 | fixa: 12 de agosto; desde 01/09/2025 | Lei municipal Campinas 16.785/2025 (01/09/2025); Decreto Campinas 24.240/2026, art. 1º | alta |
| Campinas/SP (3509502) | Nossa Senhora da Conceição (padroeira) | 08/12 | fixa: 8 de dezembro | Lei municipal Campinas 173/1949; Decreto Campinas 24.240/2026, art. 1º | alta |
| Santos/SP (3548500) | Fundação de Santos | 26/01 | fixa: 26 de janeiro (só 2026) | Portaria da Mesa da Câmara de Santos 01/2026 (DO Santos 08/01/2026); consulta oficial do TJSP | media |
| Santos/SP (3548500) | Sexta-feira da Paixão | 03/04 | Páscoa − 2 dias | Portaria da Mesa da Câmara de Santos 01/2026 (DO Santos 08/01/2026); edital CSM/TJSP 2026 | media |
| Santos/SP (3548500) | Corpus Christi | 04/06 | Páscoa + 60 dias | Portaria da Mesa da Câmara de Santos 01/2026 (DO Santos 08/01/2026) | media |
| Santos/SP (3548500) | Nossa Senhora do Monte Serrat (padroeira) | 08/09 | fixa: 8 de setembro (só 2026) | Portaria da Mesa da Câmara de Santos 01/2026 (DO Santos 08/01/2026); consulta oficial do TJSP | media |
| Guarulhos/SP (3518800) | Sexta-feira Santa | 03/04 | Páscoa − 2 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Guarulhos/SP (3518800) | Corpus Christi | 04/06 | Páscoa + 60 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Guarulhos/SP (3518800) | Fundação da cidade | 08/12 | fixa: 8 de dezembro (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |
| Cajamar/SP (3509205) | São Sebastião | 20/01 | fixa: 20 de janeiro (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |
| Cajamar/SP (3509205) | Dia do Município | 18/02 | fixa: 18 de fevereiro (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |
| Cajamar/SP (3509205) | Sexta-feira Santa | 03/04 | Páscoa − 2 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Cajamar/SP (3509205) | Corpus Christi | 04/06 | Páscoa + 60 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Santana de Parnaíba/SP (3547304) | Sexta-feira Santa | 03/04 | Páscoa − 2 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Santana de Parnaíba/SP (3547304) | Corpus Christi | 04/06 | Páscoa + 60 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Santana de Parnaíba/SP (3547304) | Sant'Ana (padroeira) | 26/07 | fixa: 26 de julho (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |
| Santana de Parnaíba/SP (3547304) | São Josafá | 14/11 | fixa: 14 de novembro (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |
| Ribeirão Pires/SP (3543303) | São José (padroeiro) | 19/03 | fixa: 19 de março (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |
| Ribeirão Pires/SP (3543303) | Sexta-feira Santa | 03/04 | Páscoa − 2 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Ribeirão Pires/SP (3543303) | Corpus Christi | 04/06 | Páscoa + 60 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Cubatão/SP (3513504) | Sexta-feira Santa | 03/04 | Páscoa − 2 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Cubatão/SP (3513504) | Emancipação político-administrativa | 09/04 | fixa: 9 de abril (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |
| Cubatão/SP (3513504) | Dia do padroeiro | 15/08 | fixa: 15 de agosto (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |
| Guarujá/SP (3518701) | Dia de Santo Amaro | 15/01 | fixa: 15 de janeiro | Lei municipal Guarujá 968/1968 (citada pelo TRT2, Portaria 50/GP/2025); edital CSM/TJSP 2026 e consulta oficial do TJSP | media |
| Guarujá/SP (3518701) | Emancipação político-administrativa (antecipada) | 29/06 | avulsa: 29/06/2026 | Consulta oficial do TJSP: 'Emancipação político-administrativa (antecipada CSM 12/12/2025)' | media |
| Guarujá/SP (3518701) | Sexta-feira Santa | 03/04 | Páscoa − 2 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| São Bernardo do Campo/SP (3548708) | Sexta-feira Santa | 03/04 | Páscoa − 2 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| São Bernardo do Campo/SP (3548708) | Corpus Christi | 04/06 | Páscoa + 60 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| São Bernardo do Campo/SP (3548708) | Aniversário da cidade | 20/08 | fixa: 20 de agosto (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |
| São Vicente/SP (3551009) | Fundação da cidade | 22/01 | fixa: 22 de janeiro (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |
| São Vicente/SP (3551009) | Sexta-feira Santa | 03/04 | Páscoa − 2 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| São Vicente/SP (3551009) | Corpus Christi | 04/06 | Páscoa + 60 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Praia Grande/SP (3541000) | Sexta-feira Santa | 03/04 | Páscoa − 2 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Praia Grande/SP (3541000) | Corpus Christi | 04/06 | Páscoa + 60 dias | Edital CSM/TJSP 'Relação de feriados municipais para 2026' (DJE 25/11/2025, proc. 2018/206016) | media |
| Praia Grande/SP (3541000) | São Pedro (padroeiro) | 29/06 | fixa: 29 de junho (só 2026) | Edital CSM/TJSP 'Relação de feriados municipais para 2026'; consulta oficial do TJSP | media |

### Registrados e não aplicados (active = false)

| Onde | Feriado | Regra | Norma | Confiança / situação | Motivo |
|---|---|---|---|---|---|
| RJ | Dia das Mães (2º domingo de maio) | 2º domingo de maio | Lei estadual RJ 8.174/2018, art. 1º | alta / inconstitucional | Declarada inconstitucional pelo STF na ADI 6133 (Plenário virtual de 5 a 15/06/2020; trânsito em julgado em 25/08/2020). A ficha da ALERJ ainda diz 'Em Vigor'. Não é feriado. |
| RJ | Quarta-feira de Cinzas (feriado bancário) | Páscoa − 46 dias | Lei estadual RJ 8.217/2018, art. 1º | alta / inconstitucional | Declarada formalmente inconstitucional pelo STF na ADI 6083 (sessão virtual de 22 a 28/11/2019; trânsito em julgado em 28/02/2020). Não vale nem como feriado bancário; nunca valeu para o trânsito. |
| Rio de Janeiro/RJ | Sexta-feira da Paixão | Páscoa − 2 dias | Não confirmada (o TJRJ cita só a lei forense, Lei federal 5.010/1966) | unverifiable / a_confirmar | Não confirmado que a Sexta-feira da Paixão seja feriado municipal no Rio: o calendário do TJRJ cita só a lei forense e a prefeitura não publica decreto anual consolidado. Na dúvida, as restrições continuam. |
| Niterói/RJ | São João (padroeiro) | fixa: 24 de junho | Calendário do TJRJ, 2º NUR (nota: Lei municipal Niterói 3.511/2020 só antecipou a data em 2020) | baixa / a_confirmar | Vigência a conferir: o calendário do TJRJ (2º NUR) foi atualizado em 13/10/2022 e não cita a lei que institui o feriado (correção do verify.json). |
| São Gonçalo/RJ | São Gonçalo do Amarante (patrono) | fixa: 10 de janeiro | Lei municipal São Gonçalo 291/2010 (citada no calendário do TJRJ, 2º NUR) | baixa / a_confirmar | Vigência a conferir: o calendário do TJRJ (2º NUR, 'feriados e datas comemorativas') foi atualizado em 13/10/2022 e não separa feriado de data comemorativa. |
| São Gonçalo/RJ | Emancipação de São Gonçalo | fixa: 22 de setembro | Proc. Adm. TJRJ 2016-164570 (calendário do TJRJ, 2º NUR); lei municipal não identificada | baixa / a_confirmar | Sem lei municipal identificada; calendário do TJRJ (2º NUR) atualizado em 13/10/2022. |
| Volta Redonda/RJ | Santo Antônio (padroeiro) | fixa: 13 de junho | Deliberações municipais de 1955–1965 e Lei municipal Volta Redonda 5.484/2018 (citadas no calendário do TJRJ, 5º NUR) | baixa / a_confirmar | Calendário do TJRJ (5º NUR, 'feriados e datas comemorativas') atualizado em 17/09/2024, sem separar feriado de data comemorativa; texto das normas não conferido. |
| Volta Redonda/RJ | Aniversário de Volta Redonda | fixa: 17 de julho | Deliberações municipais de 1955–1965 e Lei municipal Volta Redonda 5.484/2018 (citadas no calendário do TJRJ, 5º NUR) | baixa / a_confirmar | Calendário do TJRJ (5º NUR, 'feriados e datas comemorativas') atualizado em 17/09/2024, sem separar feriado de data comemorativa; texto das normas não conferido. |
| Resende/RJ | Aniversário de Resende | fixa: 29 de setembro | Lei municipal Resende 3.367/2018 (citada no calendário do TJRJ, 5º NUR) | baixa / a_confirmar | Calendário do TJRJ (5º NUR, 'feriados e datas comemorativas') atualizado em 17/09/2024, sem separar feriado de data comemorativa; texto da lei não conferido. |
| Resende/RJ | Nossa Senhora da Conceição (padroeira) | fixa: 8 de dezembro | Lei municipal Resende 3.367/2018 (citada no calendário do TJRJ, 5º NUR) | baixa / a_confirmar | Calendário do TJRJ (5º NUR, 'feriados e datas comemorativas') atualizado em 17/09/2024, sem separar feriado de data comemorativa; texto da lei não conferido. |
| Macaé/RJ | São João (padroeiro) | fixa: 24 de junho | Calendário do TJRJ, 6º NUR; lei municipal não identificada | baixa / a_confirmar | Sem lei municipal identificada; calendário do TJRJ (6º NUR) atualizado em 05/10/2022. |
| Macaé/RJ | Aniversário de Macaé | fixa: 29 de julho | Calendário do TJRJ, 6º NUR; lei municipal não identificada | baixa / a_confirmar | Sem lei municipal identificada; calendário do TJRJ (6º NUR) atualizado em 05/10/2022. |
| Itaguaí/RJ | Aniversário de Itaguaí (emancipação) | fixa: 5 de julho | Lei municipal Itaguaí 1.174/1986 e Proc. Adm. TJRJ 2013-234400 (calendário do TJRJ, 8º NUR) | baixa / a_confirmar | Calendário do TJRJ (8º NUR, 'feriados e datas comemorativas') atualizado em 30/04/2024; texto da lei não conferido. |
| Itaguaí/RJ | São Francisco Xavier | fixa: 3 de dezembro | Lei municipal Itaguaí 1.174/1986 (calendário do TJRJ, 8º NUR) | baixa / a_confirmar | Calendário do TJRJ (8º NUR, 'feriados e datas comemorativas') atualizado em 30/04/2024; texto da lei não conferido. |
| Contagem/MG | Jubileu de Nossa Senhora das Dores | Páscoa − 9 dias (só 2027–2028) | Lei municipal Contagem 3.484/2001 (regra móvel inferida) | baixa / a_confirmar | Regra 'sexta-feira que antecede a Sexta-feira da Paixão' (Páscoa − 9) inferida da data de 2026; o anexo do TRT3 descreve o feriado assim, mas o texto da Lei 3.484/2001 não foi conferido (verify.json: continua inferência para 2027+). |

### O que NÃO é feriado (não entra na tabela)

| Onde | Data | Por quê | Fonte |
|---|---|---|---|
| SP, MG, ES | Carnaval (segunda e terça), Quarta de Cinzas | ponto facultativo, salvo lei municipal | decretos anuais; TJES AN 176/2026 |
| RJ | Segunda de Carnaval e Quarta de Cinzas | ponto facultativo (em 2026: Decreto RJ 50.133, 13, 16 e 18/02) | calendário do TJRJ |
| MG | 16/07 (Dia de Minas) e 08/12 (Dia dos Gerais) | datas de celebração cívica (CE-MG art. 256, II e III, e § 1º) | ALMG |
| ES | 28/04 ("Aniversário do Estado") | erro do dataset joaopbini; o único feriado estadual é a Penha | Lei ES 11.010/2019 |
| Belo Horizonte | Terça de Carnaval | PL vetado pelo prefeito em 07/2026 (Lei 9.093/1995); veto devolvido à Câmara, desfecho não verificado | Diário do Comércio, 14/07/2026 |
| Contagem | 30/08 (Dia do Município); 08/12 | 30/08 é ponto facultativo (Lei 1.981/1989); 08/12 não consta do Decreto 1.829/2026 | Decreto Contagem 1.829/2026 |
| Serra | Corpus Christi | ponto facultativo nacional | Decreto Serra 1.908/2025 |
| Vitória | Carnaval, Cinzas, 30/10, 24/12, 31/12 | ponto facultativo | Decreto Vitória 25.991/2025 |
| Osasco | Carnaval, Cinzas, Endoenças e "emendas" (02/01, 20/02, 20/04, 05/06, 10/07) | ponto facultativo do serviço público | Decreto Osasco 14.952/2025, art. 2º |
| Barueri | 26/03 (Emancipação) e 21/11 (N. Sra. da Escada); 27/03, 20/04, 05/06, 10/07 | ponto facultativo / "dia sem expediente" | Decreto Barueri 10.264/2025 |
| Campinas | 14/07 (aniversário) | PLO 85/2026 pendente | Câmara de Campinas |

## Correções do verify.json aplicadas

| Item | Pesquisa | Verificação | O que entrou |
|---|---|---|---|
| RJ, 2º domingo de maio (Lei 8.174/2018) | feriado, confiança alta | **refutado**: inconstitucional (STF, ADI 6133, trânsito em julgado em 25/08/2020) | registrado com `status = inconstitucional`, nunca aplicado; as 3 linhas "alta" do CSV curado saíram |
| RJ, Quarta de Cinzas (Lei 8.217/2018) | "só bancário" | inconstitucional (STF, ADI 6083, trânsito em julgado em 28/02/2020) | registrado com `status = inconstitucional`, nunca aplicado |
| Guarujá, Emancipação | 30/06/2026 | antecipado para 29/06/2026 pelo CSM em 12/12/2025 (consulta do TJSP) | 29/06/2026; sem projeção para 2027+ |
| Campinas, 12/08 | "o TJSP omite" | a consulta do TJSP já traz (16ª sessão virtual do CSM, 10/04/2026) | aplicado, confiança alta |
| Niterói, outros feriados | "só no joaopbini" | o TJRJ (2º NUR) traz 24/06, calendário de 2022 | 24/06 registrado e desativado (vigência a conferir) |
| ES, Penha | "desde 2019" | lei publicada em 04/07/2019: vale desde 2020 | `vigencia_de = 2020-01-01` |
| TJRJ e interior do RJ | "sem lista municipal" | há listas por Núcleo Regional (NUR) | Duque de Caxias (NUR de 09/2026) aplicado; Volta Redonda, Resende, Macaé, Itaguaí e São Gonçalo registrados e desativados (calendários de 2022–2024 que misturam feriado e data comemorativa) |
| TJSP | edital de 11/2025 | consulta oficial por município, em JSON, mais atual | datas do edital conferidas na consulta em 10/10/2026; conferência automática opcional no importador |
| ES, polos | TJES só lista Vitória | TRT17 (Ato 44/2025) traz feriados com número da lei | Aracruz, Cachoeiro, Colatina, Linhares e São Mateus (confiança média) |
| Contagem, Jubileu 2027+ | Páscoa − 9 inferida | "continua inferência" | 2027 e 2028 registrados e desativados; o anexo do TRT3 descreve o feriado como "sexta-feira que antecede a Sexta-feira da Paixão" (indício, sem o texto da Lei 3.484/2001) |
| "O STF validou o São Jorge" | lacuna | sem respaldo (a ficha diz "Ação de Inconstitucionalidade: Não Consta") | não citado; a Lei 5.198/2008 entra pela ficha "Em Vigor" |

## Banco

Migration `0202_feriados_sudeste.sql` (idempotente) acrescenta à `holidays`: `active` (padrão true), `status`
(`vigente` | `a_confirmar` | `inconstitucional` | `revogada` | `suspensa`), `confidence` (`alta` | `media` | `baixa` |
`unverifiable`), `inactive_reason`, `source_url`, `rule` (como a data é calculada), `rule_key` (id em `regras.json`),
`notes` e `updated_at`. As linhas antigas (seed `0004_holidays.sql`, testes) ficam ativas e vigentes pelos padrões.
Quem lê `holidays` filtra `active`: `calendar.ts` e `rodovias_horario.layer.ts` (com fallback para banco sem a 0202,
onde ainda não existe linha desativada).

O importador só mexe nas linhas `source = 'feriados-sudeste'` (apaga e regrava numa transação; linha de outra origem
com a mesma chave dia/escopo/UF/IBGE fica e é contada em `NOTES`). Regra inconsistente (data inválida, ativa com
confiança baixa, desativada sem motivo, UF que não bate com o IBGE, duas regras na mesma chave) falha a carga sem
gravar nada.

## Atualização

```bash
# na raiz do repositório (Postgres do compose); FERIADOS_CONFERIR_TJSP=1 compara os municípios de SP com a consulta do TJSP
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e FERIADOS_CONFERIR_TJSP=1 \
  -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer feriados_sudeste
python3 importers/sources/feriados_sudeste.py --listar --ano 2027     # sem banco, só stdlib
python3 importers/sources/feriados_sudeste.py --conferir-tjsp --ano 2026
cd importers && python3 -m unittest tests.test_feriados_sudeste -v
```

Rotina anual (dezembro a janeiro): a Recomendação CNJ 44/2020 (recomendação, não obrigação; o TJMG publicou o ato de
2026 só em 04/2026) pede que TJ, TRF e TRT publiquem até 19/12 os feriados locais do ano seguinte. Conferir: decretos
anuais no Querido Diário (`api.queridodiario.org.br`, consulta `"feriados" "pontos facultativos" <ano>`), consulta do
TJSP, Portaria Conjunta do TJMG, NUR do TJRJ, TRT3 e TRT17; sempre abrir a ADI citada na ficha da ALERJ (a ficha diz
"Em Vigor" mesmo depois de decisão do STF). Avançar `anos` em `regras.json` e as datas fixas "só 2026". Quando duas
fontes do Judiciário divergirem (ex.: TJMG x TRT3 em Aimorés e Almenara), registrar a data como desativada, sem
escolher uma em silêncio.

## Licenças

Leis, decretos, decisões e atos de tribunais são atos oficiais, sem proteção autoral (Lei 9.610/1998, art. 8º, IV).
Cópias dos diários pelo Querido Diário (Open Knowledge Brasil) e a republicação do edital do TJSP pelo CNB-SP: citar a
fonte. O calendário do TJRJ é informativo (não substitui a publicação oficial). Fonte e licença de cada linha em
`holidays.source_url` e em `regras.json` (`fontes`); registro da carga em `data_layer_runs` (`core_legal` /
`feriados-sudeste`, `GET /api/sources`).

## Lacunas

- Base municipal: não existe base oficial nacional estruturada. Os atos dos tribunais cobrem só sedes de comarca
  (TJMG 297 de 853 municípios, TJSP 318 de 645). Aqui entraram só as capitais e os polos pesquisados. Importar as listas
  inteiras do TJMG e do TJSP (parsers testados na pesquisa) fica para outra frente, com conferência contra TRT3/TRT2.
- Sem feriado municipal na tabela: Vila Velha, Cariacica, Viana, Duque de Caxias além do 13/06, interior do RJ em geral.
  Nesses municípios só valem os nacionais e os estaduais (lado seguro: a restrição continua).
- Rio de Janeiro: texto da Lei Orgânica, art. 26, não aberto; Sexta-feira da Paixão não confirmada (desativada);
  feriados avulsos por evento (ex.: Lei 8.881/2025, BRICS) só aparecem quando a lei sai, e não há feed.
- Belo Horizonte: texto primário da Lei 11.397/2022, Anexo V, não abriu; veto do Carnaval pendente na Câmara.
- Santos: decreto anual do Executivo não achado (usada a Portaria da Mesa da Câmara 01/2026).
- O aviso `holiday_local` cobre só origem e destino.
- Os feriados de São Paulo capital, os nacionais e o 9/7 continuam em `db/seed/0004_holidays.sql`
  (`scripts/gen-zones-seed.py`). O antigo `importers/sources/feriados_sp.py` (cálculo pela lei, gravando em `holidays`)
  saiu do repositório no commit 648bdf9 porque gravava fora do contrato do runner. Este importador segue o mesmo modelo
  de cálculo, mas dentro do contrato, como o `importers/sources/cet_suspensoes.py` (tabela própria com `SEED_SQL` e
  `RECORD_COUNT`).

## Testes

- `api/test/layers/feriados_sudeste.test.ts` (banco + API): São Jorge (23/04/2026) aparece para rota no Rio
  (`holiday_local` com a Lei RJ 5.198/2008, art. 1º) e não para rota em São Paulo; o 9/7 paulista não vale no Rio; Lei
  RJ 8.174/2018 registrada e nunca aplicada; o banco recusa feriado ativo inconstitucional ou de confiança baixa;
  Penha no ES; Corpus Christi em Vitória e não na Serra; Guarujá 29/06; Campinas 12/08; município da origem/destino;
  VER de Osasco suspensa no 19/02/2026 e não no 20/02.
- `importers/tests/test_feriados_sudeste.py` (sem rede e sem banco): datas pela Páscoa, regras de data, correções do
  verify.json, datas fixas de edital só em 2026, consistência ativo/motivo e falha em regra inconsistente.
