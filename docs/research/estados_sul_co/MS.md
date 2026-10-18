# Mato Grosso do Sul (MS): fontes oficiais para caminhão (pesquisa de 18/10/2026)

Somente leitura no repositório. Textos e amostras em `fontes/MS/` (cerca de 230 KB; os brutos de RENAEST, Sinesp e SRE ficaram fora do repositório e foram apagados). Detalhe completo em `MS.json`. Órgão rodoviário estadual: AGESUL (SEILOG). Regulador das concessões: AGEMS.

Aviso de acesso: os sites `*.ms.gov.br` com WAF F5 (agesul, sejusp, imasul, agems, sefaz, seilog) devolvem 403 a este ambiente. Li o DOE-MS (`diariooficial.ms.gov.br`, tem API de busca), o site do DETRAN, os sites das concessionárias e, para as páginas bloqueadas, um leitor de terceiros (r.jina.ai). Um importador automático precisa testar o acesso direto a partir do ambiente do projeto.

## Resumo em uma tela

| Tema | O que existe | Pronto para importar? |
|---|---|---|
| 1. Restrições em rodovias estaduais | Nenhum ato vigente de horário de feriado, peso, altura ou safra. Regime geral de AET/CVC (Resolução 'N' SEOP/AGESUL 001/2009, vigência não confirmada). Só 2 atos de feriado, de 2010. Restrições de obra em pontes: MS-345 (10 t), MS-040 km 205 e 223, MS-168 e MS-455 (pontes que caíram em 08/2026) | Não para horário. OAEs do SRE-MS 2026: parcial (964 de 1.005 pontes com coordenada) |
| 2. Pedágio estadual | 2 concessões cobrando (Way-306 com 3 praças, Way-112 com 6 praças), tarifas por eixo no DOE. Rota da Celulose ainda não cobra (12 pórticos free flow, no mínimo fev/2027) | Tarifas: sim. Coordenadas das praças: não (só km da concessão). Praças ANTT (9, todas BR-163): sim |
| 3. Balanças | Sem lista estadual. 3 postos ANTT na BR-163. Postos das concessões só previstos | Estadual: não. ANTT: sim |
| 4. Feriados | Estadual: 11/10 (Divisão do Estado). Dia do Servidor 28/10 é só ponto facultativo. Municipais: sem base estadual; 44 linhas de 2026 em 22 municípios no anexo do TRT-24 | Estadual: sim. Municipal: parcial |
| 5. Perigosos | Nenhum ato por trecho. Licenciamento IMASUL (Res. SEMADE 9/2015) e regra diurna da Res. 001/2009 | Não |
| 6. Acidentes | RENAEST de MS com coordenada só em ~50% e 34 acidentes de caminhão em rodovia estadual com coordenada válida em 2025 | Parcial, não recomendado como camada de pontos |
| 7. Roubo de carga | Sinesp: zero em 2025 e em jan-ago/2026, sem município. SEJUSP 'Estatísticas Online' não acessível | Não |
| 8. Particularidades | 3 concessões BR+MS, 690 pontes de madeira, corredor Campo Grande-SP com 4 gargalos em 09/2026, AET estadual | n/a |

## 1. Rodovias estaduais

### Atos localizados (DOE-MS)

- **Resolução 'N' SEOP/AGESUL/MS n. 001, de 11/11/2009** (DOE n. 7.590 de 25/11/2009, pp. 3-4; anexo republicado no n. 7.593). AET para CVC nas rodovias da AGESUL. Art. 2: CVC só com AET. Art. 4: validade de 1 ano, carga indivisível por viagem, sem limite de reboques se mesmo padrão construtivo; protocolo no Núcleo de Transporte e Trânsito (1ª Residência Regional, BR-262 km 5, Campo Grande). Art. 12: circulação do nascer ao pôr do sol; § 3º: produtos perigosos só de dia e sem neblina ou chuva intensa. Art. 13: 70 km/h. Art. 14: 250 m entre combinações de 25 m ou mais. Art. 16: suspensão da AET (2 e 6 meses). Não achei revogação nem aplicação recente. Cópia em `fontes/MS/agesul_resolucao_N_001_2009_aet_cvc_doe7590.txt`.
- **Carnaval 2010** (Resolução 'N' SEOP/AGESUL 001/2010, DOE 7.643 de 12/02/2010, p. 7): 12 a 16/02/2010, 16h-22h, MS-060, MS-156, MS-157 e MS-162; exceto conjunto de até 2 veículos com 18,60 m ou menos. **Semana Santa 2010** (DOE 7.674 de 30/03/2010, p. 26): 02 a 04/04/2010, 16h-22h, 15 rodovias (MS-060, 134, 156, 157, 162, 164, 240, 276, 306, 377, 384, 386, 395, 480, 497). Históricos; não encontrei repetição em 2011-2026.
- **Decreto 15.886/2022** (SET/MS), art. 9: a AGESUL fiscaliza excesso de peso, dimensões e lotação, vistoria veículos com AET e arrecada escolta de carga superdimensionada ou perigosa.
- Não achei: portaria de feriado vigente, limite de peso/altura/comprimento por trecho, proibição permanente em ponte, regra de serra, travessia urbana ou safra, lista de trechos liberados para CVC/rodotrem.

### Restrições de obra vigentes (notícia e site da concessionária)

- **MS-345**, ponte sobre o Rio Miranda (Águas do Miranda, divisa Anastácio/Bonito): desde 02/03/2026, leves e caminhões de até 10 t, um veículo por vez (texto da AGESUL de 26/02/2026); o Correio do Estado de 07/09/2026 fala em restrição total para caminhões. Previsão: janeiro/2027. Alternativa de carga: MS-382 (Guia Lopes da Laguna) até a MS-178.
- **MS-040 km 205 e km 223**: caminhão proibido desde 05/09/2026 (Caminhos da Celulose); desvio único pela BR-267.
- **MS-168** (ponte no Rio Taquari): caiu em 13/08/2026 com um caminhão. **MS-455** (ponte de madeira): caiu em 10/08/2026, interditada. Fonte única (Correio do Estado).
- Federais com impacto: BR-262 ponte do Rio Paraguai (pare-siga 24 h; bloqueio total de 21/10 17h a 22/10 12h); BR-163 ponte Ayrton Senna (fechada das 20h às 4h, janela 22h30-23h30).
- PRF (federal): só a Operação Fim de Ano restringe CVC/excedentes em MS (24, 25, 27 e 31/12/2026, 01 e 03/01/2027), Portaria DIOP/PRF 12/2026.

### Rede e pontes (SRE-MS 2026)

`https://www.agesul.ms.gov.br/wp-content/uploads/2026/07/SRE_MS_2026_PE.pdf` (202 páginas, revisão 00 de 19/01/2026, dados de nov/2025). Rede estadual: 5.541,7 km pavimentados, 5.653,9 km implantados sem pavimento, 1.568,6 km em leito natural. Cadastro de **1.005 OAEs** com coordenada (697 pontes de madeira, 301 de concreto, 7 viadutos): rodovia, local, km, tipo, extensão, largura, vãos, município, lat/lon. Sem capacidade de carga. Teste de parse por regex: 964 linhas, nenhuma fora do bbox de MS. Amostra em `fontes/MS/sre_ms_2026_oae_amostra60.csv`. O PDF direto da AGESUL responde 403 aqui; baixei por leitor de terceiros.

## 2. Pedágio

| Concessão | Rodovias | Praças (km da concessão) | Cat. 1 | Cat. 4 (3 eixos) | Cat. 6 (4 eixos) | Cat. 7 (5 eixos) | Cat. 8 (6 eixos) |
|---|---|---|---|---|---|---|---|
| Way-306 (Contrato 002/2020, AGEMS) | MS-306 + BR-359 | P1 Costa Rica 40+400; P2 Chapadão do Sul 100+600; P3 Cassilândia 184+500 | 14,40 | 43,20 | 57,60 | 72,00 | 86,40 |
| Way-112, P4/P5/P7/P8/P9 (Contrato 02/2023) | MS-112 + BR-158 + BR-436 | P4 Paranaíba BR-158 78+100; P5 Ap. Taboado BR-158 118+100; P7 Ap. Taboado III BR-158 174+000; P8 Selvíria MS-112 64+200; P9 Cassilândia II MS-112 193+300 | 14,00 | 42,00 | 56,00 | 70,00 | 84,00 |
| Way-112, P6 | BR-436 | P6 Ap. Taboado II BR-436 13+300 | 4,60 | 13,80 | 18,40 | 23,00 | 27,60 |

- Way-306: Portaria AGEMS 333, de 07/04/2026 (DOE 12.121 de 08/04/2026, pp. 37-38), vigente desde 09/04/2026. Way-112: Portaria AGEMS 326, de 09/02/2026 (DOE 12.071 de 10/02/2026, pp. 60-62), vigente desde 11/02/2026. As 14 categorias completas (eixos, multiplicador, valor) estão no JSON; categoria 13 (acima de 9 eixos) = cat. 9 + cat. 1 por eixo excedente. Rodagem `single` ou `supersingle` vale como dupla. Praças físicas, sem free flow.
- **Rota da Celulose** (MS-040, MS-338, MS-395, BR-262, BR-267; 870 km; Concorrência 01/2024, desconto de 8%, homologada em 25/09/2025; contrato em jan/2026): ainda sem cobrança. 12 pórticos free flow, cobrança após o 12º mês (no mínimo fev/2027). Praças e tarifas de estudo (categoria passeio, data-base out/2023) no JSON; multiplicadores por eixo ficam no Anexo 11 do contrato, não baixado. Não importar tarifa antes do início da cobrança.
- ANTT (`dados.antt.gov.br`, CC-BY, CSV de 28/07/2026): 9 praças em MS, todas BR-163 (operador 'PANTANAL'), com lat/lon. As concessões estaduais não estão nesse CSV. Amostra: `fontes/MS/antt_pracas_pedagio_MS.csv`.
- Falta lat/lon das 9 praças estaduais (só km da concessão, que não é o km do SRE). Armadilha: os sites way306.com.br e way112.com.br têm links de spam injetados.

## 3. Balanças

Não há lista estadual. ANTT/PPV (CSV, CC-BY): 3 postos em MS, todos BR-163 (Coxim móvel km 734,26; balança fixa de Coxim km 734,91; posto fixo de Rio Brilhante km 323,7), amostra em `fontes/MS/antt_ppv_MS.csv`. Previstos e inexistentes: 4 postos móveis da Way-306 (adiados do ano 5 para o 10 pela Portaria AGEMS 268/2024) e 8 postos HSWIN da Rota da Celulose. Fiscalização estadual de excesso de peso: AGESUL (Decreto 15.886/2022, art. 9, VIII), com a PMMS por convênio.

## 4. Feriados

- **Estadual**: 11/10, Divisão do Estado de MS, data fixa. Base citada pelo TRT-24: LC federal 31/1977 c/c Leis estaduais 3.945/2010 e 10/1979 (não li as leis). O Dia do Servidor (28/10) é ponto facultativo (Lei 1.102/1990 art. 300), transferido em 2026 para 30/10 pelo Decreto 'E' 69/2026 (DOE 12.297 de 06/10/2026); não é feriado.
- **Municipais**: não há base estadual em massa (o DOE é só do Estado; Querido Diário, TJMS e `diogrande.ms.gov.br` não responderam). Melhor fonte limpa: anexo 1 da Portaria TRT/GP/SGJ 051/2025 do TRT-24 (26/09/2025), com **44 linhas de 2026 em 22 municípios**, cada uma com a lei ou decreto (Corumbá, Cassilândia, Coxim, Ponta Porã, Nova Andradina, São Gabriel do Oeste, Mundo Novo, Fátima do Sul, Naviraí, Jardim, Amambai, Maracaju, Campo Grande, Três Lagoas, Bataguassu, Chapadão do Sul, Paranaíba, Aquidauana, Sidrolândia, Rio Brilhante, Ribas do Rio Pardo, Dourados). O PDF tem fonte quebrada; transcrevi da imagem (`fontes/MS/trt24_portaria_051_2025_feriados_2026_transcricao.txt`) e já casei os códigos IBGE (API do IBGE, prefixo 50). Caminho no Sudeste: regra `fixa:MM-DD` por município com a lei. Para MS: baixar as leis municipais listadas em `trt24.jus.br/web/guest/agendas-e-calendarios` e completar os polos sem linha. O importador atual só aceita prefixos 31/32/33/35.

## 5. Perigosos

Nenhum ato estadual por trecho, manancial, túnel ou ponte. Órgão ambiental: IMASUL (SEMADESC). Resolução SEMADE 9/2015 (licenciamento; Anexo VII traz 'transporte de carga perigosa'; isenta cargas não perigosas), alterada pela Resolução SEMADESC 118/2025 (DOE 11.925 de 28/08/2025). Única regra de circulação: Res. AGESUL 001/2009, art. 12, § 3º (só de dia e sem neblina ou chuva intensa, vigência não confirmada).

## 6. Acidentes

RENAEST (`dados.transportes.gov.br/dataset/renaest`, domínio público): ZIP de 529 MB baixado em 10 partes e verificado; MS tem 179.527 acidentes de 2018 a mai/2026. Em MS a coluna de coordenada traz o placeholder `-0000000000` em 70.285 registros; coordenada válida em 12.131 de 24.365 acidentes de 2025. Acidentes com caminhão, cavalo ou reboque em 2025: 610 no Estado, 86 em rodovia estadual, 34 com coordenada válida (68 com km). Em rodovia estadual o endereço traz `MS-xxx` e o km, então o casamento deve ser por rodovia+km no SRE. 2024 tem só 119 acidentes de caminhão (preenchimento). Para BR use a PRF. Way-306 publica PDF mensal de acidentes por km (sem lat/lon). DETRAN em Números e SEJUSP Estatísticas Online não responderam. Amostra e resumo: `fontes/MS/renaest_ms_*`.

## 7. Roubo/furto de carga

Sinesp VDE (xlsx do MJSP): `Roubo de carga` em MS = 0 em todos os meses de 2025 e de jan a ago/2026 (abrangência Estadual), município 'NÃO INFORMADO'. Sem coordenada. Para agregado útil: LAI à SEJUSP/PMMS (BOs por município e rodovia). Amostra: `fontes/MS/sinesp_vde_2025_roubo_carga_MS.csv`.

## 8. Particularidades

Três concessões que misturam BR e MS (a tarifa e a regulação são estaduais). Corredor Campo Grande-SP em 09/2026 com MS-040 fechada a caminhão, ponte Ayrton Senna fechada à noite e ponte do Rio Paraguai em pare-siga. 690 pontes de madeira em rodovias não pavimentadas, sem limite de carga. Balsa: só registro de 2010 (Rio Miranda, 1 caminhão por travessia); status atual não verificado. Rodovias com hgv no OSM sem ato: não testado (sem PBF de MS).

## Pendências

Ver `pendencias` em `MS.json`: confirmar vigência da Res. 001/2009 por LAI, coordenadas das 9 praças, Anexo 11 da Rota da Celulose, acesso direto ao SRE-MS, validar as 44 linhas do TRT-24 e ler as leis, base de BO do DETRAN/SEJUSP, status atual das pontes.
