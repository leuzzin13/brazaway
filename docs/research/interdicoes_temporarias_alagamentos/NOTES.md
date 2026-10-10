# Interdições temporárias com prazo: alagamentos (CGE), ocorrências e obras em rodovia, eventos da CET

Pesquisa de 09/10/2026 (noite). Tudo foi testado com curl/python a partir desta máquina. O repositório não foi editado.
Os dados de amostra estão nesta pasta (lista no fim).

## Resumo

- **Há dados bons e de graça para a capital.** São quatro fontes que se completam:
  1. **CGE: pontos de alagamento em tempo real** (página HTML simples), com histórico diário desde pelo menos 2008.
  2. **CET: relatório semanal "Eventos Notáveis do Fim de Semana"** (PDF de ~170 páginas, publicado na sexta à tarde).
     Traz todas as interdições do fim de semana com data, horário e trecho ("R. X, entre a R. Y e a R. Z").
     Também traz a **lista de obras de longa duração** (Linha 6 do Metrô, BRT Radial Leste, Pirituba–Lapa etc.), com
     início e previsão de término. Essa lista substitui com folga o status de obras da SIURB, parado em 2020–21.
  3. **CET: RSS de notícias** com as interdições pontuais da semana: pontes, viadutos, túneis, Marginal e zeladoria.
  4. **ARTESP: dataset `ocorrencias`** (CC BY, atualizado todo dia com dados até D-1). São 11.505 ocorrências de
     alagamento, erosão e queda de talude desde 2020, 2.398 delas com interdição e com lat/lon. Serve para mapear
     recorrência nas rodovias estaduais. Não serve como tempo real.
- **O CGE tem limite de taxa.** Ele fica atrás do CloudFront com AWS WAF. Baixei 484 dias em cerca de 5 min
  (~1,4 req/s) e o IP ficou bloqueado com **HTTP 403 por 15 a 20 min**, inclusive na página do dia. Com 1 requisição a
  cada 3 s não houve bloqueio. O importador precisa respeitar esse ritmo (detalhes em §1).
- **Geocodificação do CGE: 64% dos cruzamentos e 5 de 6 "altura do nº" deram certo** na primeira tentativa, usando a base
  própria (`addr_segment` do GeoSampa e `/api/geocode` com CNEFE). As falhas são previsíveis: pontes, túneis e
  Marginais não estão em `addr_segment`, e há sufixos como "(BRAS)", "REPUBLICA" e "e arredores". Os 200 pontos mais
  frequentes cobrem cerca de metade das ocorrências, então uma **tabela curada** dos pontos recorrentes resolve o resto.
- **Mecanismo:** uma camada nova `interdicoes` com validade (`inicio`/`fim` e janela horária) que gera `costLines`
  (fator 1000 em trecho fechado, sensível ao sentido) e avisos. Ela segue o padrão dos reportes `road_closed`, mas com
  fonte oficial e expiração pela própria fonte, não pelas 24 h fixas.
- **`include_construction` no Valhalla não ajuda.** Hoje ele está `false`, e as vias `highway=construction` já ficam
  fora do grafo. Ligar só adicionaria arestas que o costing bloqueia, a menos que se use `ignore_construction=true`.
  Por outro lado, **confirmei que o Valhalla local respeita `motor_vehicle:conditional`.** A Av. Paulista no domingo às
  10h é evitada: 4,32 km pela Al. Santos e Brig. Luís Antônio, contra 3,44 km pela Paulista na terça. Logo, fechamentos
  semanais recorrentes (Ruas Abertas, feiras) podem ir pelo OSM ou por janela horária própria.

## Pistas conferidas

| # | Pista | Resultado |
|---|---|---|
| 1 | CGE `alagamentos.jsp` | **Confirmada.** HTTP 200, UTF-8, sem JS. Em 09/10/2026 foram 6 pontos (4 ativos e 2 inativos), entre eles a **Av. do Estado** (sentido AMBOS, ref. R. Pres. Batista Pereira, ativo e transitável desde 18:12). Em 15/01/2026 foram 5 pontos. O histórico por `?dataBusca=DD/MM/AAAA&enviaBusca=Buscar` funciona: 2008-01-15 teve 23 pontos, 2010-01-21 teve 109 e 2020-02-10 teve 129. 2004 voltou vazio. O `robots.txt` permite `/v3/`. **Mas há WAF com limite de taxa** (403 do CloudFront). O "Estado de atenção" não está na página de alagamentos: ele aparece nas manchetes da home e no **RSS `feed_rss.jsp`** ("Estado de atenção para alagamentos em toda a cidade, às 17h33" e "Término… às 18h15"). O texto da notícia lista as zonas, inclusive "Marginal Tietê" e "Marginal Pinheiros". O mapa de alertas por subprefeitura é um **PNG** (`/cgesp/mapa_sp_geoserver.png`) com `<map>` de 32 áreas. Licença: **não declarada** em nenhuma página. |
| 2 | GeoSampa `risco_ocorrencia_alagamento` | **Confirmada: 292 pontos**, todos de 2026 (04/01 a 28/09), fonte SIGRC (Defesa Civil via 156/199), `dt_carga` 2026-10-06. Pelos metadados, a atualização é mensal e o histórico desde 2013 está no portal. Não tem logradouro nem hora. 106 dos 292 pontos são de São Miguel Paulista, o que indica alagamento residencial. Serve como **contexto e calibração**, não como interdição. A mesma família tem `risco_ocorrencia_inundacao` (294), `risco_ocorrencia_queda_arvore` (1.836) e a **`mancha_inundacao_5/25/100`** (324 mil polígonos no TR5, com `qt_profundidade_maxima`, atualizada em 10/08/2026), que é a melhor base estática para marcar trechos que alagam. CC-BY-SA 4.0. |
| 3 | CKAN ARTESP | **`ocorrencias` confirmado** (CC BY, `metadata_modified` 09/10/2026). O recurso "Alagamento Erosão e Queda de Talude" é **Parquet** (663 KB), apesar de rotulado CSV: 11.505 linhas de 01/01/2020 a 08/10/2026, com `INTERDICAO`, `LOCAIS_INTERDITADOS` (acostamento ou faixas), início e encerramento, km, sentido e lat/lon (248 sem coordenada). Na RMSP: 1.658 ocorrências, 312 com interdição e 167 com **faixa** interditada. Alagamento com interdição tem duração mediana de 1,8 h (p90 de 10,6 h). Ponto campeão: **SPM-280E km 14 (marginal da Castello, Osasco), com 46 alagamentos**, 26 deles com faixa fechada. Os CSVs de "Panes Veiculares" (60–86 MB por ano) não importam para interdição. **`programacao-de-obras` continua sem dados**: só circulares, templates XLSX, schema R0 e GeoJSON de exemplo. O schema traz `km_inicial/final`, `data_inicial/final`, `local` e `detalhamento_servico`, ou seja, é programação anual de obras, não fechamento de faixa. |
| 4 | Capital: obras e eventos | O `controle_uso_via_publica_geoinfra` foi reconferido: 1.902 pontos, só EMERGENCIA, `ENCERRADA` ou `INFORMADA`, sem datas, `dt_carga` 2026-01-31. É fraco mesmo. O dataset CKAN "controle de obras SIURB" tem `dt_atualizacao` máxima em 2022-01-03, igualmente parado. **Achado: o PDF semanal da CET** (`/consultas/eventos-notaveis-do-fim-de-semana.aspx` → `/media/<id>/rfdsDDeDDmesAA.pdf`) cobre Interlagos, Nubank Parque (ex-Allianz), Morumbis, Anhembi, corridas, procissões, patolamento de guindaste, manutenção de túnel, zeladoria da Marginal, a seção **1.3 OBRAS** (92 obras em vigor com início e previsão) e o **Programa Ruas Abertas**. Também há o **RSS `/noticias/rss.aspx`** (10 itens com corpo completo). **Portarias no DOC-SP: falhou** (ver Falhas). |
| 5 | Brasil | **INMET** `apiprevmet3.inmet.gov.br/avisos/ativos` (JSON) e `/avisos/rss`: 200, com polígono, códigos IBGE, severidade e início/fim. Hoje havia "Tempestade – Perigo Potencial" com SP capital incluída. A granularidade é grosseira (mais de 1.900 municípios por aviso). **CEMADEN**: `resources.cemaden.gov.br/graficos/interativo/getJson2.php?uf=SP` traz 724 estações em SP (79 na capital, 46 com dado nas últimas horas) com acumulados de 1 a 96 h, sem coordenada. As coordenadas vêm de `mapservices.cemaden.gov.br/MapaInterativoWS/resources/horario/{idestacao}/24`. A API oficial (PED) exige cadastro e token, com limite de 12 req/min. **DNIT "Alertas de serviços"**: 30 alertas em 3 semanas. Só 8 são de ponte; os outros são interdição, Pare e Siga, meia pista e desvio, que o filtro atual de `dnit_alertas.py` descarta. **DER-SP** `/der/rodovias/interdicoes`: tabela HTML server-side (SP, km inicial e final, município, condição). Hoje há 1 linha: SP-148 Caminho do Mar, km 58,8, interdição total por risco de queda da ponte do Rio Casqueiro. O link "Condições das rodovias" leva a uma página de câmeras (`200.144.30.103:8084`) e não serve. |
| 6 | Mecanismo / `include_construction` | Ver "Como integrar" e "Valhalla". |

## Fontes

Valor: alto, médio ou baixo, sempre para a decisão de rota de caminhão. Uso comercial: "sim" quando a licença permite; "a confirmar" quando não há licença declarada.

| Fonte | Acesso testado | Formato | Atualização | Licença | Uso comercial | Valor |
|---|---|---|---|---|---|---|
| CGE-SP alagamentos (`cgesp.org/v3/alagamentos.jsp`) | 200; histórico por data; WAF (403 se ≳1 req/s) | HTML (classes `ativo-intransitavel` etc.) | tempo real | não declarada (órgão municipal, SMSU) | a confirmar (dado factual; pedir por e-SIC/contato) | **alto** |
| CGE-SP RSS (`/v3/feed_rss.jsp`) | 200 | RSS (15 itens) | a cada boletim | não declarada | a confirmar | médio (estado de atenção) |
| CET Eventos Notáveis do Fim de Semana (PDF) | 200, 1,7 MB, 174 p. | PDF com tabelas (pdfplumber extrai 237 linhas nas p. 7–31) | semanal (sexta ~15h) | não declarada (relatório oficial) | a confirmar (fatos; mesmo raciocínio de `cet_suspensoes`) | **alto** |
| CET RSS notícias (`/noticias/rss.aspx`) | 200 | RSS com HTML completo | várias por dia | não declarada | a confirmar | alto |
| GeoSampa `mancha_inundacao_5/25/100` | 200 (WFS paginado) | GeoJSON polígonos + profundidade | 2026-08-10 | CC-BY-SA 4.0 | sim (atribuição + SA na tabela derivada) | médio-alto (estático) |
| GeoSampa `risco_ocorrencia_alagamento` (+ inundação, queda de árvore) | 200 | GeoJSON pontos | mensal | CC-BY-SA 4.0 | sim | baixo-médio |
| GeoSampa `controle_uso_via_publica_geoinfra` | 200 | pontos sem data | parado (jan/2026) | CC-BY-SA 4.0 | sim | baixo |
| GeoSampa `equipamento_feira_livre` | 200, 975 pontos | ponto + dia da semana (sem horário/extensão) | 2026-06-24 | CC-BY-SA 4.0 | sim | médio (fechamento semanal) |
| ARTESP `ocorrencias` | 200 | Parquet / CSV | diária (D-1) | CC BY | sim | médio (recorrência em rodovia) |
| ARTESP `programacao-de-obras` | 200 | só schema e exemplos | — | CC BY | sim | nulo hoje |
| DER-SP Interdições (`der.sp.gov.br/der/rodovias/interdicoes`) | 200 | HTML tabela | quando muda | não declarada (aceite de cookies/termos do portal) | a confirmar | médio |
| DNIT Alertas de serviços | 200 (já raspado) | HTML lista + notícia | diária | CC BY-ND 3.0 (gov.br): só fatos | sim (só fatos) | médio (Brasil) |
| INMET avisos (`apiprevmet3.inmet.gov.br/avisos/ativos`, `/avisos/rss`) | 200 | JSON / RSS (CAP) | contínua | "reproduzido desde que citada a fonte"; RSS diz `public domain` | sim | baixo-médio (contexto) |
| CEMADEN pluviômetros (`getJson2.php`, `MapaInterativoWS`) | 200 | JSON | 10 min | não declarada; endpoints não documentados; PED exige cadastro | a confirmar | médio (gatilho de chuva) |
| OSM (`highway=construction`, `*:conditional`, `flood_prone`) | PBF local | — | contínua | ODbL | sim | médio |

## Falhas e limitações

- **CGE, 403 do CloudFront/WAF** após ~484 requisições seguidas (cerca de 1,4 req/s). O bloqueio valeu para todo o IP,
  inclusive a página do dia, e caiu sozinho em 15 a 20 min. A 1 req a cada 3 s, 255 dias seguidos passaram sem bloqueio.
  Não tentei contornar.
- **DOC-SP (ePubli/SEI)**: `md_epubli_controlador.php?acao=materias_pesquisar` responde 200, mas o POST do formulário
  (campos `hdnTermoPesquisa`, `hdnModoPesquisa=AVANCADA` etc., copiados de `js/materias.js`) devolve
  "Erro realizando pesquisa." Há resquício de captcha em `request.js`. Não dá para automatizar sem navegador.
  Para interdições, a CET (PDF e RSS) é mais completa e estruturada que as portarias.
- **CET `/consultas/eventos/eventos.aspx` e `obras-e-servicos…(tpov).aspx`**: são páginas de procedimento
  (como pedir autorização), sem dados. A caixa "Agenda do Dia" da home está vazia.
- **PDFs antigos da CET**: só o atual fica linkado. O link antigo `/media/1715801/rfds_8-9ago26.pdf` dá 404.
  Para ter histórico é preciso arquivar toda semana.
- **CEMADEN**: a camada `Cemaden/MapServer` do SGB só tem 242 estações no Brasil e nenhuma em SP. O PED oficial exige
  cadastro (`sws.cemaden.gov.br/PED/` dá 403). O endpoint `getJson2.php` não traz lat/lon.
- **DER-SP "Condições das rodovias"** (`dersp.der.sp.gov.br/…/CondicaoRodovias.aspx`): redireciona para uma página de
  câmeras.
- **DNIT `servicos.dnit.gov.br/condicoes/`**: 404. Não existe painel de condições público. **PRF**: não achei feed
  público de interdições. A parceria é com Waze e Google, e o Waze for Cities exige parceria.
- **Concessionárias** (Ecovias, Motiva/CCR etc.): as condições ficam em redes sociais, sem feed. A ARTESP tem um centro
  de controle, mas não publica tempo real (só o D-1 do CKAN).
- **Overpass**: 406 sem User-Agent e 504 por timeout. Usei o PBF local `data/cache/ver/sp.osm.pbf` com pyosmium no
  container do importador (só leitura).
- **Mapa de alertas do CGE**: é PNG. Ler o estado por subprefeitura exigiria amostrar cor de pixel, o que é frágil.
  O RSS basta.

## CGE: o que o histórico mostra

(Histórico baixado nesta pesquisa: `cge_2024-10_2026-10.jsonl` + `cge_2026-01-28_2026-10-09.jsonl`; estatística em `cge_stats.py`.)

- **739 dias baixados** (11/10/2024 a 09/10/2026), com **1.358 pontos-ocorrência** em **146 dias com algum ponto**.
  Desses, **799 (59%) eram intransitáveis**.
- Há sazonalidade forte: dez–fev concentra a maior parte, por exemplo 194 pontos em jan/2025 e 188 em jan/2026.
  O pior dia foi 25/12/2024, com 46 pontos. Set/2026 teve 95.
- **Duração**, do início ao término, quando há término: mediana de **71 min**, p75 de 137 min e p90 de **273 min**.
  Esse é o horizonte em que um ponto "ativo" deve pesar na rota.
- **Início**: 14h–19h concentra 52%, o que coincide com a saída da tarde. Há um pico secundário de madrugada (02h).
- **Recorrência**: 875 pontos distintos (logradouro + referência), 207 com 2 ou mais ocorrências. Os 100 mais
  frequentes cobrem 35% das ocorrências, e os 200 mais frequentes cobrem 50%. Os mais frequentes:
  Av. Itaquera x R. Campinas do Piauí (15), Av. Mal. Tito alt. 7557 e 5394 (14 cada), Av. Santo Amaro x Roque Petroni
  (12), **Av. do Estado x R. Pres. Batista Pereira (12, o ponto de hoje)**, Av. Alcântara Machado x Vd. Guadalajara (9),
  **Marginal Tietê (Av. Pres. Castelo Branco) x Pte. das Bandeiras (9)**, Av. Santos Dumont x R. Guaporé (9) e
  **Av. Jacu-Pêssego x Av. Ragueb Chohfi (8)**. Vários estão em corredores de caminhão.
- 39 ocorrências têm ponte, túnel ou viaduto no nome do logradouro (TN João Paulo II, TN Max Feffer, Pte. do Piqueri…).
- Saída completa em `cge_stats.txt`.

Formato de cada ponto (parser `cge_parse.py`):
```json
{"data":"2026-10-09","zona":"Zona Sudeste","subprefeitura":"Ipiranga","inicio":"18:12","fim":null,
 "logradouro":"AV DO ESTADO","sentido":"AMBOS","referencia":"R PRES BATISTA PEREIRA","ativo":true,"transitavel":true}
```
- `ativo` e `transitavel` vêm da classe CSS do `<li>` (`ativo-intransitavel`, `inativo-transitavel`…).
  `fim` fica vazio enquanto o ponto está ativo. Pela página de classificação, intransitável significa que o alagamento
  toma todas as pistas.
- `sentido` vem como "AMBOS", "UNICO", "BAIRRO/CENTRO", "CENTRO/BAIRRO" ou nomes de bairro ("B FUNDA/LAPA").
  Isso dá para casar com o sentido da via, que é o que o `linear_cost_factors` sensível ao sentido (commit b32fa0c) já
  consome.
- Geocodificação (`geocode_test.py`, 80 pares sorteados): 47 de 74 cruzamentos com distância de 0 m em `addr_segment`
  e 5 de 6 "ALTURA DO N. x" com `precisao=numero/numero_aproximado` no `/api/geocode`. Falhas típicas:
  `PTE …`, `TN …` e `MARGINAL TIETE ASCB EXPRESSA` (não estão em `addr_segment`; usar o nome OSM das pontes e
  túneis); `NSRA`, `CARD` (Cardeal) e `S.C.` (abreviações a expandir); sufixos de bairro "(BRAS)", ", REPUBLICA" e
  "e arredores"; ruas fora da capital. Com essas regras, mais o fallback OSM e uma tabela curada dos ~200 pontos mais
  frequentes, a cobertura deve passar de 90%.

## Como integrar ao app (camada `interdicoes`)

Molde: igual às outras camadas (`docs/LAYERS.md`), com uma diferença. Parte dos dados é **viva**, então os importadores
rodam com `--no-seed` (como `cet_suspensoes`) e por agendamento (cron no compose ou loop no próprio importador).
As feições ficam em `data_features` com `layer_id='interdicoes'` e `props` padronizadas:

```
props = { fonte, tipo: 'alagamento'|'evento'|'obra'|'manutencao'|'ocorrencia_rodovia',
          severidade: 'total'|'parcial'|'transitavel',
          inicio: ISO, fim: ISO|null,              -- validade absoluta
          janela: {dias:[1..7], de:'22:00', ate:'04:30'}|null,   -- recorrência dentro da validade (obras noturnas)
          sentido: 'ambos'|'ab'|'ba'|texto,
          via, referencia, texto_fonte, url_fonte, confianca: 0..1, geocod: 'cruzamento'|'numero'|'curado'|… }
```
Geometria: LineString do trecho afetado, ou Point quando não houver extensão.

### Importadores (`importers/sources/`)
1. **`cge_alagamentos.py`** (vivo, a cada 5 min, 1 requisição por ciclo). Lê a página do dia e faz upsert por
   `(data, inicio, logradouro, referencia, sentido)`. Ponto ativo recebe `fim=null`; quando aparece a hora de término,
   fecha a validade. Geocodifica por cruzamento em `addr_segment`, pelo número via `/api/geocode` ou pela tabela curada
   `cge_pontos_curados` (logradouro+referência → way OSM e sentido). O trecho afetado é a aresta OSM mais próxima do
   ponto no logradouro (±50 m para cada lado).
   Modo **`--historico AAAA-MM-DD:AAAA-MM-DD`** a ≤ 1 req/3 s, gravando em `cge_alagamento_hist`. Dele sai a
   **recorrência por ponto**: n de ocorrências, % intransitável, duração mediana e hora típica.
2. **`cge_estado.py`** (vivo, a cada 10 min). Lê o RSS `feed_rss.jsp` e mantém "estado de atenção/alerta" com zonas e
   hora. Cuidado: o `pubDate` vem marcado como GMT, mas é a hora local (17:37 "GMT" para "às 17h33").
3. **`cet_eventos_fds.py`** (semanal, sexta 16h, e a cada 6 h no fim de semana). Acha o link do PDF na página,
   arquiva o PDF (o histórico some) e extrai as tabelas das seções 1.1, 1.2 e 1.3 com pdfplumber. Gera o tipo pela
   coluna NOME (evento, obra, patolamento, manutenção de túnel, zeladoria), as datas ("10/10/26 a 18/10/26",
   "Previsão 120 dias", "Sem previsão de término") e o horário ("22h00 às 04h30" vira janela noturna). Geocodifica
   "R. X, entre a R. Y e a R. Z" como o trecho de X entre os cruzamentos com Y e Z (`addr_segment`).
   Para eventos grandes, as **seções 3.x** trazem horários das interdições por via ("a partir das 02h00… bloqueio
   parcial / bloqueios totais") e devem ter prioridade sobre a linha da agenda.
4. **`cet_noticias.py`** (a cada hora). Lê o RSS e filtra pelo título ("será interditad", "bloque", "monitora o
   trânsito"). O texto é livre, então entra como **pendente de curadoria** (mesmo fluxo do `dnit_alertas_curadoria`)
   ou com `confianca` baixa (só aviso) até ser aprovado. Uma extração com LLM pode montar a proposta de
   `inicio/fim/janela/trechos` para a pessoa só aprovar.
5. **`artesp_ocorrencias.py`** (diário). Lê o Parquet e grava a **recorrência** por rodovia/km/sentido (alagamento e
   talude com interdição) como aviso estático. Ocorrência com `DATA_ENCERRAMENTO` nula vira interdição em aberto.
   O km vira geometria pelos marcos quilométricos que `rodovias_horario` já usa.
6. **`der_interdicoes.py`** (a cada 6 h). Lê a tabela HTML. Cada linha vira `severidade` (pelo texto "INTERDIÇÃO
   TOTAL" ou parcial) e um trecho km_ini–km_fim pela SP/marcos/SNV. A linha vale enquanto estiver na página.
7. **`dnit_alertas.py`** (já existe): ampliar o filtro para interdição, Pare e Siga, meia pista e desvio, não só
   pontes, mantendo a fila de curadoria.
8. **`inmet_avisos.py` e `cemaden_chuva.py`** (contexto, a cada 15–30 min). Gatilhos sem geometria de via:
   aviso INMET que cobre o município (geocode IBGE) e acumulado de 1 h numa estação CEMADEN a até 3 km do ponto
   recorrente.
9. **`geosampa_mancha_inundacao.py`** (estático, mensal). Cruza as arestas OSM com `mancha_inundacao_5/25` e guarda
   `prof_max` por aresta. Só é usado quando houver gatilho (CGE em atenção ou alerta, ou chuva forte no CEMADEN).

### Módulo `api/src/layers/interdicoes.layer.ts`
- **`costLines(ctx)`**: feições válidas em `ctx.at`, ou seja, `inicio ≤ at ≤ fim` e dentro de `janela`, com `fim`
  nulo valendo enquanto a fonte disser ativo.
  - `severidade='total'` → fator **1000** (proibido salvo sem alternativa), só no sentido afetado.
  - `parcial` → fator 3 a 5. Para caminhão, faixa a menos em ponte ou viaduto pesa mais que para carro.
  - `transitavel` (alagamento) → fator 5 a 10. Caminhão passa, mas com risco.
  - Use `costLines` em vez de `exclusions`: polígono de exclusão bloquearia também a rua que cruza por cima ou por
    baixo (viaduto sobre passagem inferior alagada). `exclusions` fica só para ponto sem trecho resolvido
    (buffer pequeno, ~20 m).
- **Horizonte do CGE.** Ponto ativo agora vale para saída até `agora + duração típica do ponto` (mediana global de
  72 min; p90 de ~4,5 h). Depois disso, só como aviso. Para saída futura com CGE em estado de atenção ou chuva forte
  no CEMADEN, os **pontos recorrentes** (≥ 3 ocorrências e ≥ 50% intransitável) entram com fator moderado (×3) e aviso.
- **`annotate`**: avisos com código e severidade, por exemplo:
  - `alagamento_ativo` (danger): "Av. do Estado x R. Pres. Batista Pereira: alagamento ATIVO, intransitável desde 18:12 (CGE)".
  - `alagamento_recorrente` (warn): "A rota passa por 3 pontos que alagam com frequência; CGE em estado de atenção desde 17:33".
  - `evento_interdicao` (warn): "Palmeiras x Corinthians (dom 11/10): R. Palestra Itália interditada a partir das 13h30 (CET)".
  - `obra_longa` (info/warn): "Obra da Linha 6: R. João Ramalho, bloqueio total desde 17/10/21 (CET)".
  - `rodovia_ocorrencia` (info): "SPM-280E km 14 (Osasco): 46 alagamentos desde 2020, 26 com faixa interditada (ARTESP)".
  Nas linhas de resumo, o desvio aparece como diferencial: "Rota desviada de 2 interdições ativas; o desvio respeita
  altura, peso e VER". Isso vale de graça, porque o desvio é o próprio Valhalla com o costing do caminhão e as outras
  camadas.
- **`features(bbox)`**: interdições ativas e das próximas 72 h (linhas coloridas por severidade) e um heatmap de
  pontos recorrentes.
- **Relação com `road_closed`**: os reportes continuam como estão. A camada oficial não depende de votos, e um
  `road_closed` que coincide com interdição oficial ativa pode ser confirmado automaticamente.
- **Testes** `api/test/layers/interdicoes.test.ts`: fixture de um ponto ativo intransitável num trecho com alternativa
  (a rota não usa o trecho no sentido afetado, mas usa no oposto); obra com janela 22h–04h30 (vale às 23h, não às
  10h); evento com data passada (ignorado).

### Valhalla
- **`include_construction`**: hoje `false` em `/custom_files/valhalla.json` (o `valhalla_build_config` aceita
  `--mjolnir-include-construction`). Com `false`, `highway=construction` nem entra no grafo, e o caminhão já não passa.
  Com `true`, as vias entram marcadas como construção e o costing as recusa, salvo com `ignore_construction=true`
  (útil só para planejar rotas futuras). **Não recomendo ligar**: mais tiles, nenhuma mudança na rota.
  No extrato `sp.osm.pbf` há 167 vias `highway=construction`, a maioria motorway_link, primary e secondary
  (Av. Cecília Lottenberg, Rua Vergueiro…).
- **Condicionais funcionam**: no mesmo extrato há 160 `motor_vehicle:conditional` (Paulista `no @ (Su 09:00-17:00)`,
  Minhocão, Radial), 16 `access:conditional`, 6 `hgv:conditional` e 50 `oneway:conditional` (Túnel Jânio Quadros).
  Teste no Valhalla local, de Haddock Lobo/Paulista até Treze de Maio: domingo 10h deu 4,32 km sem a Paulista;
  terça 10h deu 3,44 km pela Paulista. Origem e destino na própria Paulista no domingo: "No path could be found". O app
  precisa tratar esse erro (ex.: tentar de novo sem `date_time` e avisar).
  **Conclusão:** fechamento recorrente semanal (Ruas Abertas, feira livre) pode ser resolvido no OSM ou na janela da
  própria camada. Interdição com prazo (obra, evento, alagamento) fica em `linear_cost_factors`, sem rebuild de tiles.
- Também há 18 `flood_prone=yes` no extrato (Rod. Anchieta, Av. Sen. Teotônio Vilela…). É pouco, mas serve para
  cruzar com o CGE.

## Lacunas

- **Licença do CGE e da CET**: nenhuma das duas declara licença. São dados factuais de órgãos municipais, o mesmo
  caso de `cet_suspensoes` (Lei 9.610 art. 8º). Antes de uso comercial em escala, vale um pedido formal (e-SIC
  municipal ou contato do CGE/CET) com autorização e, idealmente, um limite de taxa liberado.
- **RMSP fora da capital**: Guarulhos, Osasco, ABC e Barueri têm órgãos de trânsito próprios. Não pesquisei
  interdições e alagamentos desses municípios. As defesas civis municipais publicam em redes sociais.
- **Tempo real em rodovia**: nem ARTESP, nem concessionárias, nem DER-SP, nem PRF publicam feed. Só o D-1 da ARTESP,
  a tabela do DER e as notícias do DNIT.
- **Feira livre**: o GeoSampa dá ponto e dia, mas não horário nem extensão. Seria preciso supor o trecho (quadra do
  endereço) e o horário (~6h–14h).
- **Alerta de chuva no nível da via**: o INMET é grosseiro, e o CEMADEN depende de endpoint não documentado. Sem
  radar público em formato de dados, o gatilho fica com o estado do CGE mais o pluviômetro.
- **Histórico da CET**: só o PDF da semana fica no ar. É preciso arquivar desde já para construir modelos
  ("esquema padrão de jogo no Morumbis").

## Arquivos nesta pasta

- `cge_parse.py`: parser e crawler do CGE (modo `range`, ritmo por `CGE_SLEEP`, padrão 3 s).
- `cge_hoje.html`, `cge_20260115.html`, `cge_index.html`, `cge_mapas_alertas.html`, `cge_feed_rss.xml`: amostras.
- `cge/`: HTML diário bruto (out/2024 a out/2026). `cge_*.jsonl`: pontos extraídos. `cge_stats.py` e `cge_stats.txt`: estatística.
  `cge_range.log` e `cge_range2.log`: log do crawl (os 403 do primeiro estão registrados).
- `geocode_test.py`: teste de geocodificação contra o banco e a API locais (só leitura).
- `cet/`: home, páginas de consulta, `rfds10e12out26.pdf` com o texto (`.txt`) e as tabelas extraídas
  (`rfds10e12out26_tabelas.json`), `rss.xml` e `rss_parsed.json` (`cet_rss_parse.py`).
- `artesp/`: `alagamento_erosao_talude.parquet`, primeiros 200 KB de `panes_2026`, schema e exemplo de obras.
  `artesp_*.json`: `package_show`.
- `geosampa_alag.json` e `gs_*.json`: camadas GeoSampa (alagamento, inundação, queda de árvore, manchas TR5/TR25
  com as primeiras 3.000 feições, risco hidrológico, controle de uso de via, feiras). `geosampa_caps.xml`.
- `pmsp/`: `package_show` do CKAN municipal e `siurb_controle_obras.xlsx`.
- `der/interdicoes.html`, `dnit/alertas_p1.html`, `inmet/avisos_ativos.json` e `avisos_rss.xml`,
  `cemaden/getJson2_SP.json` (acumulados por estação) e `cemaden/horario_4184.json` (estação Senai Pirituba com lat/lon e 24 h).
- `docsp/`: tentativa no DOC-SP (`res2.u8.html` = "Erro realizando pesquisa").
- `osm/count_tags.py` e `osm_tags_sp.txt`: contagem de tags de construção e condicionais no PBF local.

Os scripts usam python3 da máquina. `cge_stats.py` e a extração de tabelas do PDF pedem `pandas`, `pyarrow` e `pdfplumber`.
O venv temporário foi apagado.
