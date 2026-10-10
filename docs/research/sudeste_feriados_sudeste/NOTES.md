# feriados_sudeste — notas de pesquisa (10/10/2026)

Escopo: feriados estaduais de RJ, MG e ES e feriados municipais das capitais e dos polos do Sudeste, mais as bases
estruturadas (APIs e datasets). O repositório não foi alterado. Os testes ficam todos nesta pasta.

## O que já existia (reaproveitado, sem novo teste)
- `db/seed/0004_holidays.sql` e `scripts/gen-zones-seed.py`: feriados nacionais, o estadual de SP (9/7, Lei 9.497/1997)
  e os municipais da capital, de 2026 a 2028, calculados pela lei. A BrasilAPI entra só como conferência.
- `docs/research/rodovias_restricoes`: BrasilAPI feriados v1 já testada (14 datas, marca Carnaval e Corpus Christi como
  nacionais, sem feriados estaduais nem municipais); portaria PRF 121/2026; DER-MG Portaria 4.162/2025.
- `docs/research/restricoes_rmsp_municipios`: Querido Diário (API) já usado; as VER de Osasco e de Barueri valem "exceto feriados".
- `docs/layers/restricoes_rmsp.md`: lacuna declarada ("feriados municipais desses municípios não estão em holidays").
- `docs/research/legislacao_limites` e `restricoes_sp_capital`: histórico de suspensões da CET.

## Arquivos
- `tj/tjmg_pc1798_2026.pdf/.txt`: Portaria Conjunta TJMG 1798/2026, com Anexo Único na redação da PC 1860/2026
  (121 páginas, 1,9 MB).
- `parse_tjmg.py` gera `tjmg_feriados_municipais_2026.csv`: 297 comarcas e 1.278 datas. Um item ficou sem parse
  (Vazante, "2 e 3 de maio").
- `tj/cnbsp_feriados_2026.html` e `parse_tjsp.py` geram `tjsp_feriados_municipais_2026.csv`: edital CSM/TJSP de 2026,
  na republicação do CNB-SP/INR. São 318 comarcas e 1.290 datas, com 3 itens sem parse.
- `tj/tjrj_suspensao_capital_2026.*` e `tj/tjrj_suspensao_1a2a_2026.*`: calendários do TJRJ. Trazem a capital e as
  suspensões avulsas por comarca, mas não a lista de feriados municipais.
- `tj/trf2_portaria845.*`: TRF2, Seção Judiciária do ES, 2026. Traz Vitória, Cachoeiro, Colatina, São Mateus e Serra.
- `tj/trt3_anexo_991_2025.*`: TRT3, feriados locais de MG em 2026. São 272 linhas, 196 com a lei ou o decreto
  municipal citado e 65 de "suspensão do expediente" (só do tribunal).
- `tj/tjes_an176_2026.html`: TJES, Ato Normativo 176/2026. Lista só nacionais e estaduais, mais Vitória (8/9).
- `leis/`: textos primários (ALERJ 4.007, 5.198, 5.243, 8.174, 8.217 e 11.002; ES 11.010/2019; Lei federal 9.093/1995;
  CE-MG art. 256; STF ADI 7898 e ADI 4131; CNJ Rec. 44/2020).
- `qd/`: decretos municipais de 2026 achados no Querido Diário: Osasco, Barueri, Santos, Vitória, Serra e Contagem.
- `apis/`: Nager.Date, IBGE municípios e FEBRABAN (com reCAPTCHA).
- `joaopbini/` e `feriadosdev/`: datasets comunitários, para comparação.
- `gen_curado.py` gera `feriados_sudeste_curado_2026_2028.csv`: 165 linhas no formato da tabela `holidays`, com
  base legal, URL e confiança.

## Achados principais
1. RJ tem 4 feriados estaduais gerais além dos nacionais (fichas da ALERJ, "Em vigor"):
   - Carnaval (terça): Lei 5.243/2008. A ADI 4131 não foi conhecida (trânsito em julgado em 25/10/2018).
   - São Jorge (23/4): Lei 5.198/2008.
   - Corpus Christi: Lei 11.002/2025. A ADI 7898 foi julgada improcedente em 19/06/2026.
   - 20/11: Lei 4.007/2002, hoje também nacional.

   Há ainda o 2º domingo de maio (Lei 8.174/2018). A Quarta-feira de Cinzas é feriado só bancário (Lei 8.217/2018)
   e não vale para trânsito.
2. ES: Nossa Senhora da Penha (Lei 11.010/2019) cai na segunda-feira 8 dias após a Páscoa (13/04/2026).
3. MG: só 21/4 é data magna (CE-MG art. 256, I) e coincide com o feriado nacional. 16/7 e 8/12 são datas cívicas,
   não feriados.
4. Base nacional estruturada e confiável de feriados municipais: não existe.
   - A CNJ Rec. 44/2020 manda todo TJ, TRF e TRT publicar até 19/12 um ato com os "feriados locais" do ano seguinte.
     São atos oficiais, mas por comarca-sede, em PDF ou HTML, e com lacunas: o TJRJ não traz lista municipal e o TJES
     só traz Vitória.
   - O dataset joaopbini (MIT) tem 2.284 linhas genéricas ("Feriado Municipal") no Sudeste e erros: ES em
     28/04/2026; falta o Corpus Christi do RJ; Barueri traz 26/03, que é ponto facultativo. Contra o TJMG, o conjunto
     de datas locais coincide em 169 de 296 comarcas; contra o TJSP, em 250 de 316.
   - O feriados.dev (MIT) usa aniversários da Wikipedia como feriado.
   - Nager.Date só traz nacionais e SP.
   - FEBRABAN exige reCAPTCHA, não é automatizável e trata de feriado bancário.
   - Invertexto, feriadosapi.com e Calendarific exigem cadastro ou chave e não foram testados.
5. A melhor fonte primária municipal é o decreto anual de "feriados e pontos facultativos", que distingue feriado de
   ponto facultativo e de "emenda". O Querido Diário acha esse decreto.
   - Confirmados para 2026: Osasco (Dec. 14.952/2025), Barueri (Dec. 10.264/2025), Vitória (Dec. 25.991/2025),
     Serra (Dec. 1.908/2025), Contagem (Dec. 1.829/2026), Campinas (Dec. 24.240/2026) e Santos (Portaria da Câmara 01/2026).
   - Sem cobertura no QD: Guarulhos (até 06/2026), Cajamar, Santana de Parnaíba, Ribeirão Pires, Cubatão, Guarujá,
     Cariacica, Duque de Caxias (até 08/2025), BH (até 03/2026) e Vila Velha (até 05/2025).
6. Os atos dos tribunais divergem dos decretos:
   - O TJSP omite o Dia do Evangélico de Campinas (12/8, Lei 16.785/2025) e o Corpus Christi de Santos.
   - O TJSP lista 20/11 como municipal, embora já seja nacional.
   - Contagem: o joaopbini põe 08/12, mas o decreto e o TJMG não.
7. Feriados avulsos:
   - Rio de Janeiro: Lei 8.881/2025 decretou feriado em 07/07/2025 (cúpula do BRICS).
   - Niterói: Lei 4.125/2026 criou o feriado de Corpus Christi.
   - BH: PL do Carnaval vetado em 07/2026, com veto pendente na Câmara.
   - Campinas: PLO 85/2026 propõe 14/7 como feriado.
8. Integração (só leitura do código):
   - `calendar.ts` usa `uf='SP'` por padrão. `restricoes_rmsp.layer.ts` chama `legalDayInfo(at, ibge)` sem a UF, e
     `routing.ts` chama `legalDayInfo(at)` só com SP. Num município do RJ, MG ou ES, isso aplicaria o 9/7 de SP e
     ignoraria o feriado estadual local. A UF tem de vir dos 2 primeiros dígitos do IBGE (31=MG, 32=ES, 33=RJ, 35=SP).
   - `rodovias_horario.layer.ts` já consulta `holidays` para 6 municípios da Baixada, do ABC e da capital, mas hoje só
     a capital tem linha.
