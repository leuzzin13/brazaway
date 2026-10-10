# Porto de Santos, Baixada Santista e CEAGESP: agendamento, pátios reguladores, portões e regras municipais

Pesquisa feita em 09/10/2026. Tudo foi testado com curl ou python, salvo quando marcado "não testado".
O repo não foi alterado. Os artefatos estão nesta pasta (lista no fim).

## TL;DR

1. **A regra vigente é a NAP.SUPOP.OPR.020/2026**, "Norma para utilização por caminhões dos acessos terrestres ao Porto de Santos".
   Foi assinada em 22–23/07/2026 e revoga a NAP 016/2024. Pontos principais:
   - Todo caminhão que vai a terminal ou usa os acessos terrestres do porto precisa estar agendado (art. 3º). O terminal é proibido de receber caminhão sem agendamento (art. 7º).
   - **Granel sólido vegetal de exportação ou cabotagem tem que passar por um pátio regulador credenciado** (art. 12).
     O terminal pode ser dispensado se provar que monitora o caminhão (art. 21). Em 2024 a APS disse que nenhum terminal tinha pedido essa dispensa.
   - Tolerância de chegada: **±5 h** para granel (art. 22) e **−1 h/+2 h** para carga solta ou contêiner (art. 27).
   - Antecedência: contêiner e carga solta agendam de 1 h a 7 dias antes (art. 28). Vazios e DT, até 15 min antes (art. 31).
     Granel vegetal de exportação agenda de 6 h a 7 dias antes (art. 23), com sequenciamento até 6 h após a NF, ou 3 h se a origem estiver a ≤300 km (art. 26).
   - É proibido parar ou estacionar nas vias do Porto Organizado fora das zonas rotativas (art. 9º).
   - Em contingência declarada pela APS, os prazos ficam suspensos e não pode haver cobrança de no-show (art. 35).
   - É vedado cobrar do motorista pela espera (art. 40, par. único).
2. **O destino real muda conforme a carga.** Granel vegetal vai primeiro ao pátio regulador (Cubatão ou interior) e só depois ao terminal, quando é chamado.
   Contêiner vai direto ao portão, dentro da janela. Dentro do porto, a espera é nas **"faixas dinâmicas"** de cada terminal.
   Essas faixas foram criadas pela NAP.SUPOP.OPR.019/2026 e têm mapas por terminal no Anexo I, mas só em imagem.
3. **Não há lista pública e atual dos pátios reguladores credenciados.** A última lista oficial é de 03/2021: Ecopátio, Pinhal Rodopark e Ceparking (Cubatão), Logispot (Sumaré) e Cutrale (Cordeirópolis), com 2.405 vagas.
   OSM não tem nenhum dos três de Cubatão. O CNEFE tem o Ceparking ("CEPARKING PATIO REGULADOR").
   Na greve de 03/2026 houve relatos de 17 a 48 h de espera nos pátios.
4. **Portões de terminal:** o OSM é fraco. Há 43 polígonos de terminal com nome, mas só uns 5 têm barreira no perímetro.
   O CNEFE dá 112 candidatos (TGG, TEG/TEAG "Centro de Triagem", Santos Brasil Tecon, DP World etc.) e eles precisam de validação.
   **CEAGESP está resolvida no OSM:** Portões 1 a 15 têm nome e ref, e o Portão 3 fica a cerca de 8 m do ponto CNEFE.
5. **Novas fontes vivas da APS**, todas sem anti-bot:
   - API WordPress com o line-up de navios (programados por turno de 6 h, atracados, esperados) em HTML parseável;
   - API pública de **9 câmeras viárias** da Perimetral, com lat/lon e snapshot JPEG;
   - feed de notícias com obras e desvios na Perimetral.
6. **Regras municipais da Baixada:** só achei regras de Santos.
   - Zona de Restrição do Gonzaga, 12h–20h todos os dias. A fonte é uma notícia de 2002 e a regra vigente está a confirmar.
   - Caminhão acima de 2 eixos proibido a qualquer hora na Av. Rangel Pestana × Ana Costa (DO Santos, 2013).
   - O PlanMob (LC 1.087/2019) manda revisar a Lei 221/1996 para criar zonas de exclusão de carga acima de 2 eixos ou portuária.
   - Em Cubatão, a restrição de horário dos pátios (Decreto 10.048/2013) foi derrubada pelo TJ-SP em 2014.
   - Para Guarujá, São Vicente e Praia Grande não achei nada. O OSM não tem nenhum `hgv:conditional` nos cinco municípios.
7. **Querido Diário mudou de domínio.** `api.queridodiario.ok.org.br` falha no handshake TLS; **`api.queridodiario.org.br` funciona**.
   Só Santos tem diários indexados (nível 3). Guarujá, Cubatão, São Vicente e Praia Grande estão no nível 1, sem texto.
8. **Brasil:**
   - Paranaguá confirmado: Pátio Público de Triagem com 330 mil m² e até 1.000 caminhões simultâneos, agendamento pelo Carga Online e 507.915 caminhões em 2025. O line-up retroativo é público em HTML.
   - **ANTAQ:** `dados.antaq.gov.br` e `web3.antaq.gov.br` dão **NXDOMAIN**, inclusive no DNS 8.8.8.8.
   - Rio Grande, Itajaí e Itaqui ficaram sem confirmação.

---

## 1. APS (portodesantos.com.br): o que existe e como acessar

O site é WordPress e o **REST API está aberto**: `/wp-json/wp/v2/pages` (364 páginas), `/wp-json/wp/v2/posts` e `/wp-json/wp/v2/search?search=`.
O robots.txt só bloqueia wp-admin e boletins. Não há anti-bot (HTTP 200 com curl simples).

| Recurso | Como acessar | Teste | Uso no app |
|---|---|---|---|
| Normas (NAP) | página 6942 (`/informacoes-operacionais/normas-e-regulamentos/`). Os PDFs ficam em `intranet.portodesantos.com.br/docs_codesp/doc_codesp_pdf_site.asp?id=<n>` | 200, PDFs baixados | regras de agendamento e pátio; monitorar mudança pelo hash da página |
| NAP.SUPOP.OPR.020/2026 (acesso de caminhões) | id=163667 | 200, 11 p. | **regra principal** |
| NAP.SUPOP.OPR.019/2026 (faixas dinâmicas) | id=162815 (30 MB; Anexo I com 9 folhas em imagem, ref. 1-VII-12275, base PDZ 2020 em SIRGAS 2000) | 200. Folhas renderizadas em `aps/nap/faixas-*.png` | onde o caminhão espera dentro do porto, por terminal (SSZ 16 Santos Brasil, SSZ 14 TGG, SSZ 29 CLI, SSZ 27 Copersucar…) |
| NAP.SUPOP.PPO.001/2021 (credenciamento de pátios reguladores) | id=131908 | 200 | requisitos do pátio (OCR, integração online, Portaria 1.343/2019). **Sem lista de pátios** |
| NAP.SUPGP.OPR.007/2023 (estacionamentos rotativos) | id=146265 | 200 | permanência máxima de 10 dias. Art. 3º diz que "A APS publicará em seu site os locais e vagas", **mas não achei essa publicação** |
| NAP.GEROP.OPR.001/2021 (AET dentro do porto) | id=133086 | 200 | carga superdimensionada nas vias portuárias |
| NAP.SUPGP.OPR.003 (controle de acesso) e SUPGP.OPR.005 (regulamento de tráfego nas áreas controladas) | ids 140131 e outro na lista | 200 (o primeiro) | contexto |
| Resoluções e Portarias | página 5576, ~300 links | 200 | histórico: DIPRE 302/2016 (pátios credenciados), DIPRE 86/2006 (revogada) |
| **Atracações programadas** | página 3415 (`content.rendered` traz tabelas por turno 07–13 / 13–19 / 19–01 / 01–07) | 200; 138 linhas parseadas | prever pico de caminhões por terminal e dia |
| **Atracados** | página 3413 | 200; 55 linhas | idem |
| **Navios esperados (carga)** | página 3417 | 200; 283 linhas: categoria, navio, chegada, EMB/DESC, mercadoria, toneladas, terminal | índice de pressão: em 09/10, 40 navios de granel vegetal com 2,54 Mt a embarcar (TGG 466 mil t) |
| Painel de Monitoramento das Operações | página `/painel-de-monitoramento-das-operacoes-portuarias` | 200 | só navios (prancha, % executado), **sem fila de caminhão** |
| Terminais no Porto de Santos | `wp-content/uploads/Arrendatarios_2026_v2.pdf` | 200; 53 terminais (39 do porto organizado, 8 retroportuários, 6 TUPs) | só nomes, sem endereço nem coordenada |
| Fatos e Dados 2026 | `Facts-Figures-2026.pdf` | 200 | "7.500 caminhões por dia" e "+120 km acessos internos". Notícias de 2025 da APS falam em cerca de 8 mil/dia |
| **Porto Mapeado: câmeras** | `https://integra.portodesantos.com.br/porto-mapeado/api/publico/cameras` (JSON público) | 200; **9 câmeras online** na Perimetral (Alemoa → Ponta da Praia), com lat/lon, `snapshot_url` (JPEG de 242 kB, testado) e HLS | camada "câmeras do porto". Só o link, sem rehospedar |
| Notícias (WP posts) | `/wp-json/wp/v2/posts?search=perimetral` | 200 | avisos de obras e desvios (ex.: Alemoa 01/2026 e 05/2026) |
| Dados abertos | página 1905 | 200, **sem nenhum arquivo** | diz que "a reutilização desses dados é livre, respeitadas as limitações legais" |
| Chamamentos de estacionamento (02/2021) | páginas 9141 e 8947 | 200 | histórico (Ponta da Praia). Hoje o plano são os condomínios logísticos |
| Sistemas de agendamento, SGUS e Supervia | `sgus.portodesantos.com.br/terminais/` | login | **fechados**. O agendamento é B2B (terminal ↔ APS ↔ pátio), por webservice ou XML |

Histórico do agendamento:
- Desde 2014 (SGTC). Em 2017 veio o "Portolog" (Cadeia Logística Portuária Inteligente) e em 09/2021 uma plataforma nova da APS.
- Desde 2024 há um acordo de cooperação com a PRF para rastrear os caminhões desde a origem.
- Contingência: sistrafego@portodesantos.gov.br, (13) 3202-6544.

Condomínios e pátios novos anunciados:
- Santos (Alemoa/Saboó, Av. Augusto Barata): ≥460 vagas.
- Guarujá (Área 41, Conceiçãozinha): pátio regulador de 417 vagas. Hoje não existe pátio regulador no Guarujá.
- O contrato foi firmado em 06/2026, com prazo de 3 anos.
- Ilha do Tatu (Cubatão): 500 vagas até 2028 (A Tribuna, via ACS).

## 2. Pátios reguladores

- Base legal: Resolução DIPRE 302/2016 e NAP SUPOP.PPO.001/2021 (certificado válido por 10 anos). O uso é obrigatório pelo art. 12 da NAP 020/2026.
- **Lista oficial mais recente**, de 29/03/2021 (APS): Ecopátio, Pinhal Rodopark e Ceparking, os três em Cubatão; Logispot (Sumaré); Cutrale (Cordeirópolis). Somam 2.405 vagas.
  Uma notícia da APS de 01/2021 fala em 7 pátios (3 em Cubatão, 1 em Santos, 1 na capital e 2 no interior). As duas fontes não batem, então **a lista atual precisa vir por LAI**.
- Localização:
  - Ecopátio: Rod. Cônego Domênico Rangoni, km 263, Cubatão. Cerca de 450 mil m² e 1.680 vagas, segundo fonte secundária (Logweb).
  - Rodopark Pinhal: Av. Eng. Plínio de Queiróz, s/n, Zona Industrial, CEP 11570-902 (guiafacil).
  - Ceparking (Terloc/Cesari): 350 vagas e 55 mil m² (APS 2021). Ponto no CNEFE: **-23.851049, -46.378843**.
  - **Nenhum dos três está no OSM** (testado por nome e por `amenity=parking` + hgv).
- Tempo de espera e custo: na greve do Sindgran (03/2026), relatos de **48 h e R$ 1.470, 23 h e R$ 900, 17 h e R$ 850** (Transporte Moderno, 24/03/2026). Fala-se em 2 a 4 mil caminhões de grão por dia.
  A NAP de 07/2026 respondeu vedando a cobrança ao motorista (art. 40). Não existe dado público de fila nem de tempo de permanência.
- Histórico: em 2013, Cubatão restringiu o funcionamento dos pátios a 8h–18h (Decreto 10.048/2013 e Lei 1.894/90). Houve filas de mais de 50 km e o TJ-SP derrubou a regra em 01/2014 (Conjur).
- Safra: soja de fevereiro a abril (pico em março e abril), milho em agosto (APS 2021). Isso define a sazonalidade do ETA.

## 3. Portões (semente de `site_access`)

- **OSM:** a busca por nome achou 43 polígonos de terminal (`landuse=harbour|industrial` com nome) no estuário, como BTP, DP World, Tecon Santos, TGG, TEG, Cutrale, Marimex, Ageo, Stolthaven e CLIA.
  Há 408 nós `barrier=gate|lift_gate|…` no bbox, mas **só uns 5 ficam no perímetro de um terminal**: Tecon Santos 1, CLIA Guarujá 2, Termag 1, Nova área portuária 1. A maioria é portão residencial.
  Conclusão: **OSM não serve como fonte de portão de terminal**.
- **CNEFE 2022 (DSC_ESTABELECIMENTO):** baixei Santos, Guarujá e Cubatão e filtrei **112 candidatos** (`cnefe/cnefe_semente_site_access.csv`). Exemplos:
  - TGG, Cargill, TEG e TEAG "Centro de Triagem" e "Terminal Múltiplo do Guarujá", todos na Av. Santos Dumont s/n do Guarujá;
  - Santos Brasil Tecon; DP World (Estrada Ilha Barnabé, km 2); Marimex; Deicmar; Libra T38; Covre Terminal de Caminhões; Transtec;
  - "Portaria Pátio de Caminhões" (R. Idalino Pinez, 555, Guarujá); dezenas de "Estacionamento de caminhão" na Alemoa e no Saboó.
  Os pontos são de face de quadra e precisam de validação. A pesquisa de geocoding mediu erro de 0,7 a 4 km nos s/n do Guarujá.
- **Faixas dinâmicas** (NAP 019/2026, Anexo I): mostram em mapa as vias internas onde cada terminal enfileira seus caminhões. Na prática é o "último trecho" real.
  Vêm em imagem, na escala 1:1.500 ou 1:2.500 e sobre a base do PDZ 2020. Pedir o vetor por LAI ou digitalizar.
- **CEAGESP (OSM):** os Portões 1 a 8, 10 e 12 a 15 têm `entrance=yes` + `ref`; os Portões 3 e 4 têm um segundo nó, só com nome.
  O **Portão 3** fica em **-23.534016, -46.734796**, a uns 8 m do ponto CNEFE "CEAGESP | Av Dr Gastão Vidigal". O **Portão 13** (Marginal Pinheiros) fica em -23.539640, -46.738903.
- Arquivo `site_access_semente.geojson`: **134 feições**, sendo 13 portões da CEAGESP com regra de horário, 9 câmeras da APS e 112 candidatos do CNEFE.

## 4. CEAGESP (2º polo)

- Fonte oficial: `ceagesp.gov.br/atendimento/horario-ceagesp/` (200, salva em `ceagesp/`). Para o ETSP (capital):
  - Pavilhões de frutas e legumes (MFE, HF, BP, AP…), de 2ª a sábado: entrada e descarga das **0h às 17h**; vazios das **3h às 17h**; carga das 3h às 18h.
  - MLP-Verduras: caminhões carregados das 7h às 18h (2ª, 4ª e 5ª), das 11h às 18h (3ª e 6ª) e das 14h às 21h (sábado).
  - Feira de Flores: 2ª e 5ª, das 22h30 às 9h30, Portões 3 e 4. Pescado: 3ª, 5ª e sábado, da 1h30 às 6h, Portão 15. Varejão: Portões 3, 4, 7 e 13.
  - Entrada no ETSP pelas Portarias 03 e 13 a partir das 21h, nos dias de flores.
- Snippets de notícias da CEAGESP (busca web, sem abrir as páginas): Portão 3 (Gastão Vidigal, 1946) e Portão 13 (Marginal) funcionam 24 h para caminhões; Portão 10 das 7h às 18h, de 2ª a 6ª; só entram veículos cadastrados.
  **As páginas de notícia estão fora do ar** por causa do defeso eleitoral (04/07/2026 até o fim de outubro), e o REST WP devolve lista vazia. Revalidar em novembro.

## 5. Regras municipais da Baixada (fora de `restricoes_rmsp_municipios`)

| Município | Achado | Fonte | Status |
|---|---|---|---|
| Santos | Zona de Restrição do Gonzaga (quadrilátero Bernardino de Campos, Pres. Wilson, Vicente de Carvalho, Cons. Nébias e Francisco Glicério), **12h–20h todos os dias**, exceto autorizados pela CET | santos.sp.gov.br, notícia de 2002 (atualizada em 2019) | confirmar se ainda vale e qual o ato |
| Santos | Av. Rangel Pestana × Ana Costa: **caminhão acima de 2 eixos proibido a qualquer hora**; radar | DO Santos 06/09/2013 (Querido Diário) | confirmar |
| Santos | Lei 221/1996 (circulação de carga). O PlanMob (LC 1.087/2019, art. 7º, IV) manda criar "zonas de exclusão de circulação de veículos de carga acima de 2 eixos ou vinculados a atividades portuárias" e horários de abastecimento. VUC = 2,20 × 6,30 m | Legis Santos (LC 1.087 baixada) | Lei 221 não localizada |
| Santos | Decreto 3.600/2000: produtos perigosos com eixos de circulação (Anchieta, viaduto da Alemoa, Augusto Barata, Eduardo Guinle…) | santos.sp.gov.br | cruzar com a camada `perigosos` |
| Santos | Decreto 10.522/2024: cargas superdimensionadas nas vias municipais | título visto na busca do Legis | não li o texto. O `documents/<id>/view` devolveu outro documento (ver falhas) |
| Santos | Centro (06/2025): veículo com mais de 9 m proibido na R. Visconde do Rio Branco (Outeiro de Santa Catarina) | santos.sp.gov.br | pontual |
| Cubatão | Restrição de horário dos pátios (Dec. 10.048/2013) derrubada pelo TJ-SP (01/2014) | Conjur | sem regra vigente achada |
| Guarujá, São Vicente, Praia Grande | nada achado em busca web nem nos diários | n/a | **lacuna**: pedir por LAI |
| OSM (5 municípios) | Santos: 7 vias com tag hgv. Guarujá: 12 (inclui as "gavetas" de balsa). Cubatão: 25 (16 `hgv=designated`). São Vicente: Imigrantes `hgv=no` e Ponte Pênsil `hgv=no` + `maxweight=12`. Praia Grande: Via Expressa Sul `hgv=no` (96 ways, verificar). **Nenhum `hgv:conditional`** | Overpass | a zona do Gonzaga não está no OSM |

## 6. Cruzamento com o que já existe no app

- `rodovias_horario` já modela a regra semanal da Anchieta: CVC com AET (até 74 t / 30 m) só no km 40–55, das 23h às 5h de 2ª a 6ª, segundo a Portaria SUP/DER-084/2023.
  Um rodotrem graneleiro que precisa chegar ao pátio em Cubatão tem que **descer a serra até as 5h**. A hora de saída viável é o mínimo entre essa janela e a janela do terminal (±5 h para granel).
  Exemplo: saída de Campinas às 21h → serra entre 23h e 0h → pátio regulador ~0h30 → chamada pelo terminal dentro do agendamento.
- Contêiner (−1 h/+2 h): a janela é curta. O app deve mirar a **hora agendada −30 min**, somando a margem de travessia urbana (Alemoa → portão) e a operação comboio da Ecovias.
- A pesquisa de geocoding pediu a tabela `site_access`. Este tema entrega a semente (seção 3) e mostra que, no porto, o destino também depende do **tipo de carga** (pátio ou portão).

## 7. Brasil (segunda fase)

- **Paranaguá (Portos do Paraná/APPA):**
  - A página "Pátio de Triagem" (200) diz: 330 mil m², até 1.000 caminhões ao mesmo tempo, 20 banheiros, classificação de grãos pela Codapar no próprio pátio.
  - AEN (19/01/2026): **507.915 caminhões em 2025** (+29,5%). O Carga Online informa o dia e a janela de acesso à triagem. 61% dos caminhões levam soja e 24,5% farelo.
  - Line-up retroativo público em HTML: `appaweb.appa.pr.gov.br/appaweb/pesquisa.aspx?WCI=relLineUpRetroativo` (200).
  - `cargaonline.appa.pr.gov.br`: curl 000, não respondeu (deve ser login).
  - A localização do pátio (BR-277) **não foi confirmada**.
- **Rio Grande, Itajaí e Itaqui:** os sites respondem (portosrs.com.br, portoitajai.com.br, portodoitaqui.com.br, todos 200), mas não achei regra de agendamento nem pátio de triagem. Fica pendente.
- **ANTAQ Estatístico Aquaviário:** `web3.antaq.gov.br/ea/...` (URL que a própria ANTAQ cita) e `dados.antaq.gov.br` dão **NXDOMAIN** no resolvedor local e no 8.8.8.8. `gov.br/antaq` responde 200.
  O `dados.gov.br/api/publico` devolve 401 (precisa de token).

## 8. Fontes que falharam ou têm ressalvas

| Fonte | Problema |
|---|---|
| `api.queridodiario.ok.org.br` | falha no handshake TLS (LibreSSL "sslv3 alert handshake failure"). **Usar `api.queridodiario.org.br`**: 200, com redirect 302 a partir de `queridodiario.ok.org.br/api`. Os PDFs em `data.queridodiario.ok.org.br` ainda respondem 200 |
| Querido Diário para Guarujá, Cubatão, São Vicente e Praia Grande | nível 1, sem diários indexados. Santos é nível 3 |
| `dados.antaq.gov.br`, `web3.antaq.gov.br` | NXDOMAIN |
| `cargaonline.appa.pr.gov.br` | sem resposta (000) |
| CEAGESP, notícias e REST | fora do ar pelo defeso eleitoral de 2026 |
| Legis Santos (`egov.santos.sp.gov.br/legis/search?query=`) | a busca funciona (58 itens para "circulação de caminhões"), mas o link da listagem não bate com o documento. O id 7938, listado como Dec. 10.522/2024, abriu a LC 1.087/2019 (.doc) |
| Diário de Cubatão (`busca.php?q=`) | funciona, mas devolveu 15 MB de texto sem regra de caminhão aproveitável |
| APS "Dados abertos" | página sem nenhum arquivo |
| APS: lista de pátios, portões, vagas rotativas e capacidade por janela (art. 6º) | não publicadas |
| `leismunicipais.com.br` (Guarujá) | 403 |
| Sistemas SGUS, Supervia e agendamento | login |

## 9. Licenças e uso comercial

- **NAPs, resoluções, decretos e leis** são atos oficiais e não têm proteção autoral (Lei 9.610/98, art. 8º, IV). Uso comercial ok, citando a fonte.
- **Dados do site da APS** (line-up, lista de terminais, câmeras): a página "Dados abertos" diz "reutilização livre, respeitadas as limitações legais". Não há termos de uso específicos e o robots.txt permite.
  Para câmeras, **apontar para o snapshot ou o stream, sem rehospedar**. Confirmar o uso comercial no pedido de LAI.
- **OSM:** ODbL, com atribuição e share-alike na base derivada. Manter em `data_features` separado, como já se faz.
- **CNEFE/IBGE:** uso livre com citação ("Fonte: IBGE, Censo 2022 — CNEFE").
- **CEAGESP:** horários publicados por empresa pública federal (fatos). Citar a fonte.
- **Querido Diário:** o conteúdo é ato oficial. Os termos da API da OKBR não foram verificados nesta rodada.
- **Imprensa** (Transporte Moderno, A Tribuna, Logweb, Conjur): só como evidência de fatos, sem reproduzir texto.

## 10. Como integrar no app (ver docs/LAYERS.md)

**Importadores (`importers/sources/`):**

1. `aps_acesso_terrestre.py` (layer `porto_agendamento`)
   - Grava as regras da NAP 020/2026 como feições "regra", sem geometria: tipo de carga → tolerância antes/depois, antecedência mínima/máxima, pátio obrigatório, número e data da NAP.
   - É curado à mão, mas o importador guarda o hash da página 6942 (REST) e avisa quando surgir NAP nova ou uma for revogada.
2. `aps_site_access.py` (layer `site_access`, ou a tabela própria sugerida no geocoding)
   - Carrega `site_access_semente.geojson`: portões da CEAGESP (OSM), candidatos do CNEFE e pátios reguladores com coordenadas curadas.
   - Campos: `site_id`, `nome`, `tipo` (portao | patio_regulador | faixa_dinamica | estacionamento_rotativo), `cargas` (conteiner | granel_vegetal | liquido…), `horario`, `fonte`, `validado`.
3. `aps_lineup.py` (layer `porto_lineup`)
   - Lê as páginas 3415, 3413 e 3417 pelo REST a cada 6 h e grava navio, terminal, turno, mercadoria e toneladas.
   - Deriva um índice de pressão por terminal e dia: toneladas de granel a embarcar ÷ ~37 t por caminhão. É um sinal relativo, não a contagem real.
4. `aps_cameras.py` (layer `porto_cameras`): lê `/porto-mapeado/api/publico/cameras` (9 pontos) e guarda só os links.
5. `aps_avisos.py`: busca posts com "perimetral|desvio|interdição|obra" no REST e gera avisos temporários, como `dnit_alertas`.
6. `baixada_municipios.py`: regras curadas de Santos (polígono do Gonzaga 12–20h, ponto da Rangel Pestana >2 eixos) e Ponte Pênsil.
   Pode virar `restricoes_baixada` ou estender `restricoes_rmsp` para municípios fora da RMSP.

**Módulos da API (`api/src/layers/`):**

- `porto.layer.ts`
  - `features()`: terminais, portões, pátios, câmeras e (depois) faixas dinâmicas.
  - `annotate()`: se o destino cai num polígono de terminal do porto (ou num `site_access`), emite:
    - aviso "Porto de Santos exige agendamento (NAP.SUPOP.OPR.020/2026)";
    - para granel vegetal, aviso "pátio regulador obrigatório", com sugestão de rota em 2 pernas (origem → pátio → terminal);
    - linha de resumo com a janela de tolerância.
  - Se o pedido trouxer `agendamento` (hora e tipo de carga), compara a ETA com a janela e devolve `data.saida_sugerida`.
    O cálculo usa a regra semanal da Anchieta de `rodovias_horario`, que já tem o "próximo horário permitido".
- **Snap do destino para o portão:** isso não cabe nos hooks atuais.
  Proposta: um hook opcional `resolveDestination(ctx) → LatLon | null` em `RouteLayer`, ou um serviço `site_access` chamado antes do Valhalla. A rota termina na portaria e não no centroide (CEAGESP: 363 m de diferença).
- **ETA com fila:**
  - não há dado público de fila;
  - mostrar uma faixa em vez de somar ao ETA: contêiner 0–2 h no gate; granel em pátio de horas a 48 h, segundo os relatos de 03/2026;
  - deixar o motorista reportar a espera (novo tipo de reporte "tempo de fila no portão/pátio").
- **Produto "chegar dentro da janela":** o usuário informa terminal, hora agendada e tipo de carga. O app devolve a saída sugerida, a chance de cair fora da tolerância e alertas de serra, comboio e feriado. Nenhum app de consumo faz isso.

## 11. Pedidos de LAI sugeridos

**APS** (Fala.BR / central de serviços "Solicitar acesso a documentos", página 11767):
1. lista vigente de pátios reguladores credenciados, com endereço, vagas, coordenadas e validade do certificado;
2. capacidade homologada de recepção por janela e por terminal (art. 6º da NAP 020) e localização dos gates de cada terminal;
3. arquivos vetoriais (SHP/KML/DWG) das faixas dinâmicas (Anexo I da NAP 019/2026, ref. 1-VII-12275) e da poligonal/PDZ 2020;
4. locais e vagas dos estacionamentos rotativos (art. 3º da NAP 007/2023);
5. séries agregadas do sistema de agendamento: caminhões por hora e terminal, % fora da janela, tempo de permanência nos pátios;
6. termos de uso do line-up e das câmeras para uso comercial.

**Municípios:**
- **CET-Santos:** mapa e atos das zonas de restrição de caminhões, se a do Gonzaga continua valendo e se existem outras.
- **Guarujá, Cubatão (CMT), São Vicente e Praia Grande:** atos de restrição de circulação e estacionamento de caminhões.

## 12. Arquivos nesta pasta

- `aps/`
  - `page_*.json|txt`: páginas da APS via REST. `pages_all.json` é o índice das 364 páginas.
  - `posts/*.json`: notícias usadas.
  - `atracacoes_programadas_2026-10-09.csv`, `atracados_2026-10-09.csv`, `navios_esperados_carga_2026-10-09.csv`.
  - `Arrendatarios_2026_v2.pdf|txt`, `Facts-Figures-2026.txt`.
  - `nap/`: PDFs e textos das NAPs 020/2026, 019/2026 (só o texto e as folhas do anexo em PNG; o PDF de 30 MB foi apagado), PPO.001/2021, 007/2023, 016/2024 (revogada), GEROP.001/2021 e SUPGP.003.
  - `mapeado/publico_cameras.json`, `mapeado/snap_test.jpg`.
- `osm/`
  - queries Overpass (`*.ql`) e respostas: terminais com nome, barreiras (`barreiras_baixada.geojson`), tags hgv dos 5 municípios, buscas de pátios.
- `cnefe/`: `cnefe_estab_porto.json` (1.089 estabelecimentos filtrados) e `cnefe_semente_site_access.csv` (112 candidatos).
- `ceagesp/`
  - `ceagesp_horario_atendimento_2026-10-09.html`, `osm_ceagesp.json`;
  - `ceagesp_noticia_bloqueada_defeso_eleitoral.html`, prova do bloqueio.
- `municipios/`
  - `santos_LC1087_2019_planmob.doc|txt`, `legis_hits.json`, `santos_busca.html`;
  - páginas da busca do diário de Cubatão.
- `querido_diario/`: respostas de exemplo da API nova.
- `brasil/`: Paranaguá (pátio de triagem, line-up retroativo, páginas).
- `site_access_semente.geojson`: semente consolidada (134 feições).
