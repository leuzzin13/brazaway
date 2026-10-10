# interior_sp: restrições urbanas de caminhão no interior e no litoral de SP (fora da Grande SP)

Pesquisa feita em 10/10/2026. O repositório foi só lido. As regras estruturadas, no formato de
`data/raw/rmsp/regras.json`, estão em `regras_interior_sp.json`.

Houve uma limitação na sessão: o orçamento de WebSearch acabou logo no começo (limite de 200 buscas da sessão).
Por isso o trabalho seguiu por fontes primárias consultadas direto:
- API do Querido Diário;
- APIs WordPress das prefeituras e da EMDEC;
- API do SAPL das câmaras;
- portais de legislação;
- Overpass.

## Resultado por município

| Município | Regra | Ato | Confiança |
|---|---|---|---|
| Campinas | Anel Rodoviário: veículo > 14 m proibido seg–sex 6–9h e 16–20h, sáb 9–14h | Res. SETRANSP 079/2017, art. 3º (DOM 20/02/2017) | alta (texto); vigência confirmada pela Res. 349/2019 |
| Campinas | Distrito de Nova Aparecida: veículo > 14 m proibido de passagem a qualquer hora | Res. 079/2017, art. 4º | alta |
| Campinas | Anel de Integração Eng. Rebouças: veículo > 6,30 m proibido seg–sex 6–20h, sáb 6–14h. Há radar desde 18/08/2025 | Res. 079/2017, art. 5º + EMDEC 2025 | alta |
| Sorocaba | Caminhão proibido 24 h na Av. Dom Aguirre, na Av. Carlos Reinaldo Mendes e nas demais vias com placa. Isentos: VUC ≤ 5,50 × 2,20 m e VLC ≤ 6,30 × 2,20 m | Res. SEMOB 02/25, vigência 12/08/2025 (revoga a 014/2003) | alta |
| Piracicaba | 17 trechos centrais restritos a caminhão; 15 pontos de radar para caminhão > 3 eixos; rotas alternativas | página de serviço da SEMUTTRAN (06/03/2026); ato não localizado | média |
| Jacareí | Rota de Cargas Pesadas: VCP só nas 7 RCP ou com AETC; restrição 7–9h e 17–19h na ZRMC e na ZREC; VCL ≤ 7,99 t, 7,20 m e 2 eixos é livre; bitrem só na RCP com AETC; treminhão proibido | Dec. 247/2017 (+ 1.085/2020 e 359/2022, não lidos) | alta (texto 2017) |
| São Vicente | ARC no centro: caminhão (CTB) proibido seg–sáb 10–19h, exceto feriados | Lei 2163-A/2009 (não revogada pela Lei 4.633/2025) | média |
| São Vicente | A Lei 4.633/2025 revogou 215 leis de rua sobre caminhão. Continuam de pé: Ponte Pênsil (Lei 2.320/1990, PDF escaneado), Jd. Pombeba (> 3 eixos), R. Ver. Oswaldo Toschi, R. Campos, Ruas Argentina/Venezuela/Bolívia/Equador (> 2 eixos) | SAPL | média/baixa |
| Santos | Zona do Gonzaga 12–20h todos os dias. Radares de "restrição a caminhões" listados em 2014 | DO Santos 16/02/2002 e 03/12/2014; ato não localizado | média/baixa |
| Guarujá | R. Valdomiro Macário (Conceiçãozinha): caminhão proibido, exceto destino Assaí; barreira física desde mai/2025 | notícias da Prefeitura | média |
| Jundiaí | Sem zona geral. O PL 14.649/2025 (zonas e horários para caminhão) foi vetado e o veto mantido; só existem placas R-9 pontuais | IOM 25/09/2025 e 10/10/2025 | alta (fato negativo) |
| São José do Rio Preto | A Lei 14.748/2024 (restrição a pesados) foi declarada inconstitucional: TJSP ADI 2155355-95.2025.8.26.0000, j. 03/09/2025 | citada no veto de Jundiaí | alta (não aplicar) |
| SJC, Taubaté, Ribeirão Preto | Nada encontrado (detalhes abaixo) | — | lacuna |

Não há dado estruturado (WFS, GeoJSON ou CSV) em nenhum dos municípios. Tudo está em PDF, notícia ou página de
serviço, como na Grande SP.

## Fontes testadas (status e tamanho)

- **Querido Diário** (`api.queridodiario.org.br`)
  - `/cities`: 200, 955 municípios.
  - Com texto (nível 3): Campinas, Jundiaí, SJC (desde 2015-08-07), Santos, Taubaté (desde 2022-12-08), Itu, Marília, Paulínia, Sumaré, Valinhos e Vinhedo.
  - Só nível 1 (sem texto): Sorocaba, Ribeirão Preto, Piracicaba, Guarujá, Jacareí, Bauru, Limeira, Americana, Indaiatuba, São Carlos, Araraquara, Franca e Rio Preto.
  - Na busca, `+"frase"` com `sort_by=relevance` funciona. Sem `+`, os termos viram OU. Dá 500, 503 e 520 intermitentes: tentar de novo com pausa.
- **Campinas, DOM 20/02/2017** (Res. 079/2017): 200, 559.508 B.
- **Campinas, DOM 12/11/2019** (Res. 349/2019, que cita a 079 como vigente): 200, 2.171.260 B.
- **EMDEC WP API** (`/wp-json/wp/v2/search` e `posts?slug=`): 200. Posts de 2010, 2011, 2012, 2013 e 2025 em `campinas/emdec_posts.json`.
- **URBES Res. 02/25** (`urbes.com.br/uploads/resolucao-0002-2025.pdf`): 200, 166.846 B.
- **Sorocaba notícias WP** (`noticias.sorocaba.sp.gov.br`): 200. São 4 notícias de limitadores de altura:
  - Av. General Osório × Afonso Vergueiro (03/2022);
  - Av. Dom Aguirre, perto da Pça. D. Tadeu Strunck, sentido centro, 4,3 m (04/2022);
  - Av. Dom Aguirre × R. Porphyrio Loureiro, 4,3 m (07/2022);
  - Pça. da Bandeira / R. Luiz Gama, 3,3 m (05/2023).
- **Piracicaba**
  - Páginas de serviço da SEMUTTRAN: 200.
  - Busca do DOM (`diariooficial.piracicaba.sp.gov.br/?s=`): só funciona com cookie (`curl -c/-b`); a busca é por frase exata. O PDF é baixado de `files.pmp.sp.gov.br/semad/diariooficial/AAAA/MM/AAAAMMDD.pdf`.
- **Jacareí**
  - Dec. 247/2017 em PDF: 200, 258.952 B, 5 páginas, sem os anexos.
  - WP API de notícias: 200.
  - Link do PDF no `ccpjacarei.com.br`: 404.
  - Boletim (`boletinsoficiais.geosiap.net/pmjacarei`): SPA Angular, não raspado.
- **SAPL API** (`sapl.<cidade>.sp.leg.br/api/norma/normajuridica/?ementa__icontains=`)
  - Responde (200): Campinas (88 normas com "caminh"), São Vicente (269), Praia Grande (3, sem regra), Franca (0) e Cubatão (0).
  - Não há SAPL nesse padrão: Piracicaba, Ribeirão Preto, Sorocaba, SJC, Taubaté, Guarujá, Santos, Limeira, Americana, Jacareí, São Carlos, Araraquara, Rio Preto, Itu, Sumaré, Paulínia, Valinhos, Vinhedo e Atibaia.
  - Jundiaí, Indaiatuba, Marília e Hortolândia usam outro sistema (404).
- **São Vicente**: Lei 4.633/2025 (189.723 B), 2163-A/2009 (93.113 B) e 2315-A/2010, com texto. As leis 2320/1990 e 250-A/1994 estão escaneadas, sem texto.
- **Santos**
  - DO de 2002-02-16 (2.179.392 B) e de 2014-12-03 (5.273.684 B), via Querido Diário.
  - Legis Santos (`egov.santos.sp.gov.br/legis/search?query=`): 200, mas nenhum ato da zona do Gonzaga. A Lei 221/1996 não foi localizada (a consulta deu timeout).
- **Guarujá**: busca do site (`?s=`), 200. As 2 notícias foram lidas via WebFetch.
- **Jundiaí**: IOM 25/09/2025 (5.033.345 B), com as razões do veto do PL 14.649/2025.
- **SJC**: portal `servicos.sjc.sp.gov.br/Legislacao/?Tipo=&Palavra=`, 200. Só traz leis, LCs e decretos (nada de portaria da SEMOB) e não tem regra de caminhão. No Querido Diário, nada desde 2015.
- **Taubaté**: Querido Diário (desde 12/2022) sem nada. O portal não é WordPress.
- **Ribeirão Preto**: o DOM redireciona para `cespro.com.br/visualizarDiarioOficial.php?cdMunicipio=9314`, que é JS e não foi raspado. Sem SAPL.
- **Overpass**: contagem por município (`osm/counts.json`, `osm/hgv_ways.json`).

## OSM (Overpass, 10/10/2026)

`hgv:conditional` é 0 em todos os 12 municípios consultados. Números de ways com tag `hgv`:

| Município | Ways com `hgv` | Observação |
|---|---|---|
| Sorocaba | 106 | Av. Itavuvu 51 `hgv=no`, Av. Ipanema 45, Av. Afonso Vergueiro 7. Nenhuma na Av. Dom Aguirre nem na Av. Carlos Reinaldo Mendes, que são as vias da Res. 02/25 |
| Taubaté | 12 | Rod. Oswaldo Cruz tem `maxweight=25` em 48 ways |
| São Vicente | 12 | Ponte Pênsil `hgv=no` + `maxweight=12` |
| Guarujá | 11 | — |
| Santos | 7 | — |
| Jundiaí | 16 | quase tudo `designated` em balança |
| Ribeirão Preto | 4 | — |
| Campinas | 2 | — |
| SJC | 2 | — |
| Piracicaba | 1 | — |
| Jacareí | 0 | — |
| Rio Preto | 0 | — |

Conclusão: o OSM não traz nenhuma das zonas, e em Sorocaba está desalinhado com o ato vigente.

## Fato transversal: "Sistema Observa"

O mesmo sistema de autorização de caminhões é usado em Jacareí (que o criou), Campinas (EMDEC) e Piracicaba.
Segundo Jacareí, ele foi "replicado em mais 7 cidades". `sistema.observa.app.br` é fechado (login), mas aponta
cidades com cadastro e radar de caminhão, que valem pedido via LAI.

## Licenças

- **Atos oficiais** (resoluções, decretos, leis, DOMs): domínio público (Lei 9.610/98, art. 8º, IV). Uso comercial livre, com citação.
- **Notícias de prefeituras e da EMDEC**: usar só os fatos e o link.
- **OSM**: ODbL.
- **Querido Diário**: PDF oficial. Os termos da API não foram verificados (igual à pesquisa `porto_santos_terminais`).

## Como entra no app

Seguindo `CONVENCOES_IMPLEMENTACAO.md`: estender a camada `restricoes_rmsp` para a camada genérica por município
(código IBGE), sem camada nova. Passos:

1. Criar `data/raw/sp_interior/regras.json`, a partir de `regras_interior_sp.json`.
2. Escrever importadores `importers/sources/municipal_<cidade>.py`, reaproveitando `rmsp_municipios.py`:
   casamento por nome no OSM, corte ≤ 400 m e validação no Valhalla.
3. Campinas:
   - zonas com polígono montado no OSM pelas vias do ato (o Anel Rebouças tem 20 vias; o Anel Rodoviário é formado por SP-065, SP-330 e SP-083);
   - regra por comprimento (`length_m > 14` e `> 6,30`).
4. Sorocaba, Guarujá e Piracicaba: vias via `costLines`.
5. Jacareí: é o caso mais trabalhoso.
   - VCP fora da RCP é proibido sempre sem AETC. Modelar como zona = município menos o buffer das RCP, com aviso de AETC.
   - Os anexos ZRMC/ZREC (horário 7–9h e 17–19h) não estão no PDF.
6. São Vicente: zona ARC por perímetro descrito, com feriado suspendendo.
7. Santos: Gonzaga como zona `a_confirmar`, com aviso.
8. Rio Preto: `kind=revogada`, como o ABC 2012.

O esforço é médio, de 3 a 5 dias, com a geometria curada à mão em Jacareí e no centro de Piracicaba.

## Lacunas e próximos passos

- **LAI**:
  - SEMUTTRAN Piracicaba: ato e horários;
  - Jacareí: Anexos I e II do Dec. 247/2017 e os decretos 1.085/2020 e 359/2022;
  - CET-Santos: ato do Gonzaga;
  - SJC (SEMOB), Taubaté, Ribeirão Preto (Transerp/Sec. Mobilidade) e Guarujá: portarias de restrição de caminhão.
- **Ribeirão Preto**: fazer engenharia reversa do CESPRO (cdMunicipio 9314) ou pedir via LAI.
- **Monitoramento**: jobs no Querido Diário com `+"veículos de carga" +restrição` nos municípios de nível 3, e no SAPL São Vicente/Campinas (`ementa__icontains=caminh`).
