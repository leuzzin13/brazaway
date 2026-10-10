# Camada `oae`: pontes, viadutos, passarelas e túneis

Módulo: `api/src/layers/oae.layer.ts` · Testes: `api/test/layers/placas_gabarito.test.ts` · Frente: `placas_gabarito`.

## O que a camada faz na rota

| Situação | Efeito | Aviso |
|---|---|---|
| Estrutura com `altura_livre_m` e **altura do veículo ≥ altura livre − 0,10 m** | exclusão pequena (círculo de `bloqueio.raio_m`) em cada `bloqueio.pontos` → bloqueio duro só ali | `danger` `oae_altura_desvio` (rota desviada) ou `oae_altura_insuficiente` (a rota ainda passa perto) |
| Estrutura com `peso_max_t` e peso do veículo maior | igual | `danger` `oae_peso_desvio` / `oae_peso_excedido` |
| Restrição curada **vigente** (`proibido_pesados`/`interditada`) cujo critério alcança o veículo, na data da viagem | igual | `danger` `oae_restricao_desvio` / `oae_restricao_vigente` |
| Estrutura com altura conhecida que o veículo passa com folga | nenhum | um `info` `oae_altura_ok` com a menor altura da rota (passarela cadastrada duas vezes pela ARTESP conta uma vez) |
| Passarela ARTESP com altura **suspeita** (< 5,00 m) e veículo que não passaria se o valor fosse verdadeiro | nenhum (nunca bloqueia) | `oae_altura_suspeita`: `info` se o valor é < 4,40 m (incompatível com a rodovia), `warn` entre 4,40 e 5,00 m |
| Restrição curada vigente com `inicio` depois da data da viagem | nenhum | `oae_restricao_futura` (`warn` se alcançaria o veículo, senão `info`) |
| Restrição vigente que não alcança o veículo (ex.: VUC liberado, faixa interditada) | nenhum | `info` `oae_restricao_nao_aplica` |
| Restrição **histórica** | nenhum (nunca bloqueia) | `oae_restricao_historica`: `info` "já liberada" se a fonte liberou explicitamente os veículos da restrição (`fim` preenchido); senão `warn` "confira a placa" quando o critério alcança o veículo (com a menção "obra concluída, sem liberação explícita para caminhões" se houver registro de obra/liberação de faixas), `info` quando não alcança |
| OAE nomeada da SIURB na rota | nenhum | linha no resumo com nome e status da obra; `info` `oae_obra` se o status não for "CONCLUÍDA" |
| GeoSampa / DER-SP / DER-MG (sem limites) | nenhum | contagem no resumo, `info` `oae_limits_unknown` para veículo pesado/alto, `warn` `wooden_bridge` |
| Ponte do DER-MG com largura cadastrada < 5,50 m ou 1 faixa | nenhum | `oae_ponte_estreita`: `warn` se a largura < largura do veículo + 0,60 m, senão `info` (ver `docs/layers/rodovias_estaduais.md`) |
| Ponte do ES com PBT máximo (IS do DER-ES) ou limite por eixo (`eixo_max_t`) e veículo acima | exclusão pequena sobre a ponte | `danger` `oae_peso_desvio` / `oae_peso_excedido` |

Limites numéricos (`altura_livre_m`/`peso_max_t`) de uma feição com restrição curada só valem dentro da vigência dela
(`inicio`/`fim` contra a data local da viagem). Sem restrição curada (ARTESP) valem sempre.

Sem `bloqueio.pontos` uma feição **nunca bloqueia** (só avisa). Exclusões só são calculadas num corredor (bbox origem–destino
com folga de max(0,3°, 25% do vão)); fora dele o aviso `danger` ainda aparece porque o `annotate` olha a rota real.

**Por que exclusão (polígono) e não `costLines`:** a passarela fica SOBRE a rodovia e o que se quer bloquear é a pista
debaixo dela, num único ponto. O círculo é pequeno (8 m, sobre cada pista da rodovia sob a passarela; 20–35 m quando o
ponto não pôde ser ajustado) e fica onde não há travessia de carro (passarela é de pedestre; nas pontes curadas o ponto
fica sobre o rio). `costLines` exigiria o traçado exato da pista sob a passarela, que nenhuma fonte dá.

**Mapa (`features`)**: primeiro vêm as feições com limite, restrição ou nome (ARTESP, SIURB, curadoria e o que tiver
`altura_livre_m`/`peso_max_t`, até 2.000); as bordas do GeoSampa/DER-SP (só contagem) completam até 4.000 e só a partir
do zoom 12. Antes, uma tela de desktop sobre a capital no zoom 12 enchia o limite com o GeoSampa e cortava as restrições.

**Folga de 0,10 m:** decisão de produto (margem para erro de cadastro, carga, pavimento recapeado), **não** é valor legal.
Constante `FOLGA_ALTURA_M` no módulo. Referências para contexto: altura máxima de veículo sem AET/AE = 4,40 m
(Resolução CONTRAN 882/2021, art. 4º, II); a ARTESP pede altura livre mínima de 5,5 m em OAE nova (IP.DIN/010, rev. 0 de
07/11/2022, fl. 6). Nas passarelas reais da ARTESP o menor valor publicado é 5,38 m, então hoje o bloqueio só alcança
cargas excepcionais (≥ 5,28 m); os testes usam uma passarela de teste de 4,30 m.

## Fontes (todas em `data_features`, `layer_id = 'oae'`)

| `source` | Importador | O que traz | Licença | Atualização |
|---|---|---|---|---|
| `geosampa` | `oae_geosampa` | ~6,5 mil linhas de borda de OAE da capital (sem nome/limites) | CC-BY-SA 4.0 (GeoSampa/PMSP; CMBD 2026 declara "CC-BY-AS 4.0") | mensal |
| `der-sp` | `oae_der_sp` | 1.873 OAEs da malha DER-SP (sem limites) | CC-BY-4.0 (dadosabertos.sp.gov.br) | mensal |
| `artesp` | `artesp_passarelas` | 443 passarelas das rodovias concedidas (441 ativas + 2 desativadas, mantidas por segurança), 438 com **ALTURA** (436 usadas para bloquear, 2 suspeitas) | CC-BY (dadosabertos.artesp.sp.gov.br, "Cadastro de Ativos") | mensal (XLSX de 05/08/2026) |
| `siurb` | `siurb_oae` | 105 OAEs municipais **nomeadas** com status da obra (contratos de inspeção/recuperação 2019-2021) | ODC-By 1.0 (dados.prefeitura.sp.gov.br) | manual |
| `curadoria` | `oae_restricoes_curadas` | restrições oficiais em pontes/viadutos, curadas em `data/raw/oae_restricoes_curadas.csv` | fatos de atos/notícias oficiais com citação; geometria aproximada do OSM (ODbL, extração não substancial) | revisar a cada 3 meses |
| `der-mg` | `oae_der_mg` | 4.370 OAEs do DER-MG (Observatório da Infraestrutura) com largura, estrutura e nota de inspeção crua (escala não documentada); só aviso | não declarada (risco de uso comercial; ver `docs/layers/rodovias_estaduais.md`) | mensal |
| `der-es` | `oae_der_es` | 17 pontes estaduais do ES com PBT máximo em Instrução de Serviço do DER-ES (DIO-ES, 2024–2026), curadas em `data/raw/ders_estaduais/regras.json`; bloqueio por peso | ato oficial (domínio público) | a cada nova IS no DIO-ES |

Rodar: `docker compose --profile import run --rm importer artesp_passarelas siurb_oae oae_restricoes_curadas`
(ou o `docker run ... truck-router-importer <nome>` do README). Cada carga gera `db/seed/layers/oae__<source>.sql`.
Dados de terceiros **nunca** vão para o OSM.

### ARTESP — passarelas com altura
- URL: `https://dadosabertos.artesp.sp.gov.br/dataset/491d79c5-ee09-4fe8-a3ce-1b425fe60bbe/resource/d864ec43-a93b-4803-9b48-1fee98a98fe7/download/passarelas.xlsx`
- Planilha de 05/08/2026: 444 linhas (441 ATIVA, 2 DESATIVADA, 1 DEMOLIDA). `DEMOLIDA` é descartada; `DESATIVADA` fica
  (a estrutura pode continuar sobre a pista).
- Campo `ALTURA` **sem dicionário de dados**. Tratado como altura livre sob a passarela (o mínimo, 5,38 m na SP-270 km
  64,15, é coerente com a IP.DIN/010). Três formatos:
  - número (408 linhas com altura): usado direto;
  - **texto por pista** nas 32 linhas sem RA e com `TIPO_PISTA = Transversal` (SP-075, SP-250, SP-264, SP-270, SP-280),
    ex.: `Pista Norte: 5,48m; Pista Sul: 5,43m.`. As 30 com valor viram `altura_por_pista` (lista `{pista, altura_m}`,
    mostrada no popup) e a camada usa a **menor** altura das vias rodoviárias (trechos "Linha Férrea" ficam de fora).
    Antes elas perdiam a altura: a SP-264 km 112,8 (5,43 m) deixava passar sem aviso um veículo de 5,33–5,42 m;
  - `-` ou vazio (5 linhas): sem altura.
- **Altura suspeita**: valor < 5,00 m (`ALTURA_SUSPEITA_M`) vira `altura_suspeita` e **não bloqueia**; a rota recebe
  `oae_altura_suspeita` se o veículo não passaria caso o valor fosse verdadeiro. O limiar fica acima de 4,40 m (altura máxima
  sem AET, Res. CONTRAN 882/2021, art. 4º, II) + folga: um erro de digitação numa carga futura (ex.: 4,20 no lugar de 6,20)
  viraria bloqueio duro para toda carreta numa rodovia concedida. A IP.DIN/010 pede 5,5 m e o menor valor real hoje é
  5,38 m. Custo da escolha: se um dia aparecer uma passarela real entre 4,50 e 5,00 m, um veículo com AET de 4,40–4,90 m
  recebe `warn` em vez de bloqueio. Hoje o limiar pega só os 2 registros de 2,40 m da SP-330 km 62 (Jundiaí), iguais à
  LARGURA.
- **RA repetido**: o RA 010113000276 aparece em 3 linhas no mesmo ponto (SP-330 km 62; o OBS cita "PASSARELA 1 - EIXO 1400
  NORTE E PASSARELA 3 - EIXO 1700 SUL"): 2,40 m, 6,35 m e 2,40 m. Cada linha vira uma feição (`source_id` = RA, RA-2, RA-3,
  na ordem da planilha); antes só a primeira (2,40 m) entrava e a de 6,35 m se perdia.
- **Cadastro duplo**: 20 das linhas "Transversal" estão a ≤ 100 m de uma passarela com RA da mesma rodovia (mesma estrutura
  em outro cadastro, com alturas um pouco diferentes). As duas ficam (o bloqueio usa a menor); a linha "Transversal" leva
  `provavel_mesma_que = <RA>` e a contagem `oae_altura_ok` conta a estrutura uma vez.
- **Ponto de bloqueio nas pistas** (`bloqueio.ajuste`): o ponto da ARTESP nem sempre está sobre a rodovia (nas linhas
  "Transversal" fica na ponta de passarelas de 90–300 m, a até 54 m da pista, às vezes sobre uma rua local). O importador
  consulta o `/locate` do Valhalla (`VALHALLA_URL`, padrão `http://valhalla:8002`) e põe um círculo de 8 m no ponto mais
  próximo de cada pista da rodovia a até 60 m (100 m nas "Transversal"): arestas com o código da rodovia no nome (ou com o
  mesmo nome das que têm o código; no OSM às vezes só uma pista leva o `ref`), sem alças nem túneis, descartando pontos que
  caem na ponta de uma aresta (a pista continua em outra). Resultado em 09/10/2026: 428 passarelas ajustadas
  (`pistas_rodovia`, 893 pontos: 23 com 1 ponto, 368 com 2, 37 com 3–4) e 15 com o ponto original (`ponto_original`, raio
  35 m em pista DUPLA/Transversal e 20 m em SIMPLES: rodovias com outro nome no OSM, como SPA-307/330 e SPA-228/225, ou
  trecho urbano/contorno, como SP-225 e SP-294). Sem Valhalla o importador avisa e grava `sem_valhalla` (ponto original).
  `bloqueio.distancias_m` guarda a distância de cada pista ao ponto da ARTESP.
- Pontes e viadutos da malha concedida **não** são publicados pela ARTESP (nem no CKAN nem nos KMZ por lote).

### SIURB — controle de obras
- URL: `https://dados.prefeitura.sp.gov.br/dataset/49a40a52-68c0-45c1-92d8-ccc35a525467/resource/5596c5a0-4c33-4859-b522-a228b4ccbdc8/download/completo-obras-controle-de-obras.xlsx`
- Aba `servicos`, `fk_categoria = 4`, nome com PONTE/VIADUTO/PASSARELA/TÚNEL… → 105 OAEs com lat/lon (mediana a 1,5 m de uma
  via do grafo). Status via aba `obras_status`; obras da aba `obras` a até 200 m entram em `obras_relacionadas`.
- **Não é o cadastro completo** (a SIURB monitora 770 OAEs/945 estruturas, inventário não público) e não traz gabarito nem
  limite de peso. Hoje todos os 105 estão "CONCLUÍDA" (2019–2021).
- O portal recusa User-Agent de navegador; o `http_get` comum usa `truck-router-mvp/0.1`.

### Curadoria — `data/raw/oae_restricoes_curadas.csv`
Colunas: `id, nome, municipio, orgao, tipo (proibido_pesados|interditada|peso|altura|faixa_interditada), valor, unidade,
aplica_a, criterio (todos|caminhoes|nenhum|pbt>X|eixos>N|altura>=X), exceto_vuc, sentido, status (vigente|historica),
inicio, fim, ato, fonte_url, fonte_data, liberacao, liberacao_url, liberacao_data, liberacao_fonte, verificado_em,
eixo ("lon lat;..."), bloqueio_pontos ("lon lat;..."), bloqueio_raio_m, obs`.

Regras da curadoria:
- `vigente` **só** com fonte oficial recente confirmando a restrição; senão `historica` (só informa).
- `bloqueio_pontos` ficam **sobre o tabuleiro onde nenhuma outra via passa por baixo** (ex.: sobre o rio), para não bloquear
  a Marginal sob a ponte. O importador confere cada ponto no `/locate` do Valhalla e **falha** se houver uma aresta que não
  é a própria estrutura (nem ponte, nem com o nome dela) a menos de `bloqueio_raio_m` + 10 m; avisa (sem falhar) se nenhuma
  aresta da estrutura estiver a até `bloqueio_raio_m` (caso de Tatuí–Iperó, fora do grafo por estar em obra no OSM). Sem
  Valhalla a conferência é pulada com aviso no log. Em 09/10/2026 o ponto da Jânio Quadros (−46,59683 −23,52740) estava a
  10,4 m da Marginal Tietê Expressa e foi movido para o meio do rio no eixo (−46,59703 −23,52765: ponte a 3,7 m, via mais
  próxima fora dela a 44,9 m); o do Mofarrej (−46,74078 −23,52651) estava a 17 m da Av. Gastão Vidigal, paralela ao
  viaduto, e foi movido para −46,74082 −23,52633 (viaduto a 2,7 m, Gastão Vidigal a 27,6 m).
- `criterio`: `pbt>X` e `eixos>N` usam `>` estrito e `altura>=X` usa `>=`, exatamente como a API compara; outro operador
  (ex.: `pbt>=10`) é recusado na carga para não mudar a semântica do ato em silêncio.
- `fim` só é preenchido quando a fonte libera **explicitamente** os veículos alcançados pela restrição (ex.: "liberada para
  todos os tipos de veículos"). Obra concluída ou faixas liberadas sem citar caminhões/pesados ficam em
  `liberacao`/`liberacao_data`, sem `fim`, e a rota recebe `warn` "confira a placa". Esse critério vale igual para Limão,
  Jaguaré e Olímpio da Silveira.
- `tipo = altura|peso` vigente vira `altura_livre_m`/`peso_max_t` (regra numérica geral); `fim` preenchido vira `valid_to`.
- O arquivo está em `data/raw/` (ignorado pelo `.gitignore`), por isso foi versionado com `git add -f`.

Conteúdo em 09/10/2026 (verificado nesta data):

| id | status | resumo | fonte principal |
|---|---|---|---|
| `ponte_tatui_ipero_2026` | **vigente** | Ponte da Estrada Vicinal Salvador Serrão (divisa Tatuí–Iperó): pesados proibidos desde 30/05/2026, interdição total desde 03/06/2026 após vistorias das Defesas Civis de Tatuí e Iperó (relatórios encaminhados à Defesa Civil do Estado); em 08/10/2026 seguia interditada, sem prazo | Prefeitura de Tatuí, notícia de 08/06/2026; Jornal Cruzeiro 08/10/2026 citando a Câmara de Iperó |
| `ponte_limao_2021` | histórica | pesados proibidos após batida de caminhão alto (28/07/2021); obra concluída e faixas da ponte liberadas "para os veículos" em 18/09/2021, sem citar caminhões → `warn` "confira" (sem `fim`, mesmo critério do Jaguaré) | PMSP 31/07/2021 e 14/09/2021 (texto conferido em 09/10/2026) |
| `ponte_freguesia_do_o_2019` | histórica | faixa interditada (laudo), liberada 12/06/2019 | PMSP 22/02/2019 e 12/06/2019 |
| `ponte_casa_verde_2019` | histórica | faixa interditada (viga danificada por caminhões), liberada 22/05/2019 | PMSP 22/02/2019; imprensa 22/05/2019 |
| `ponte_jaguare_2019` | histórica | pesados proibidos após incêndio (21/06/2019); SIURB lista a obra como finalizada em 23/12/2019, sem ato explícito de liberação de pesados → `warn` "confira" | PMSP 05/09/2019 e 13/09/2019; SIURB 23/12/2019 |
| `viaduto_mofarrej_2019` | histórica | pesados proibidos 29/06/2019; liberado a todos em 23/12/2019 | PMSP 02/07/2019 e 23/12/2019 |
| `viaduto_olimpio_da_silveira_2019` | histórica | caminhões proibidos sentido centro (18/04/2019); recuperação concluída em 2022, sem ato de liberação localizado → `warn`; **sem ponto de bloqueio** (dois níveis no local) | SMT/CET 18/04/2019; PMSP 04/02/2025 |
| `ponte_janio_quadros_2019` | histórica | caminhões proibidos sentido centro-bairro (29/05/2019); liberada a todos em 04/11/2019 | SIURB 29/05/2019 e 04/11/2019 |

Observação: a ponte de Tatuí–Iperó já está como `highway=construction` no OSM (o Valhalla não roteia por ela); o bloqueio
da curadoria protege caso o OSM seja reaberto antes da liberação oficial. Buscas por restrições **vigentes** em OAEs da
capital (2024–2026) não acharam ato oficial além de interdições temporárias de faixa para obra (ex.: Viaduto Grande São
Paulo, 09/04/2024), que não entram.

## Como atualizar
1. ARTESP/SIURB: rodar os importadores (cache de 30 dias em `data/cache/`; apague o arquivo para forçar).
2. Curadoria: editar o CSV, preencher `verificado_em` com a data em que a fonte oficial foi conferida, rodar
   `oae_restricoes_curadas` (valida tipo/status/datas/coordenadas e falha com a linha do erro). Revisar a cada 3 meses e
   rebaixar para `historica` o que não tiver fonte oficial recente.
3. Commitar os seeds `db/seed/layers/oae__*.sql` (o `migrate` aplica `db/seed/layers/*.sql` numa máquina limpa). Os seeds
   desta frente são `oae__artesp.sql`, `oae__siurb.sql`, `oae__curadoria.sql` e `placas_restricao__der-sp.sql`.
   `oae__artesp.sql` depende do grafo do Valhalla no momento da carga (ponto de bloqueio nas pistas): rodar o importador
   com o Valhalla no ar; com tiles novos os pontos podem mudar alguns metros.

## Limitações
- Nenhum órgão publica gabarito/peso de pontes e viadutos (PMSP, DER-SP, ARTESP); só passarelas da ARTESP têm altura.
- `ALTURA` da ARTESP sem dicionário: pode ser altura do tabuleiro em outro referencial. Por isso a folga e o aviso "confira".
- Bloqueio ARTESP nas pistas: cobre as pistas da rodovia achadas no `/locate`. Fica de fora (a) a pista oposta quando está a
  mais de 60 m (100 m nas "Transversal") do ponto ou sem nome em comum (12 passarelas DUPLA ficaram com uma pista só, ex.:
  SP-150 e SP-070 com canteiro largo) e (b) marginais/pistas locais sem o nome da rodovia, mesmo quando a ARTESP dá a
  altura delas (SP-270 km 41,5–44,4, 96,8–106,05). Do outro lado, 109 dos 893 círculos de 8 m (12%) também tocam outra
  aresta a até 8 m da pista (60 alças, 27 vias de serviço, 22 outras vias), quase sempre junto à pista sob a passarela.
  Com as alturas de hoje (≥ 5,38 m) isso só afeta veículos de 5,28 m ou mais.
- Nos 15 pontos não ajustados o círculo de 20–35 m pode não cobrir as duas pistas em canteiros largos ou cobrir alças vizinhas.
- Restrição por sentido (`sentido`) ainda não é aplicada: a vigente bloqueia nos dois sentidos.
- Proximidade ≠ uso: "passa" = a até `bloqueio.raio_m` do ponto (ARTESP/curadoria), 20 m (SIURB) ou ≥ 60% do eixo a ≤ 15 m.

## Testes (`api/test/layers/placas_gabarito.test.ts`)
- Rota pela Anhanguera com passarela de teste de 4,30 m: carreta 4,40 m e caminhão 4,20 m desviam (folga), 4,19 m e VUC passam.
- SP-264 km 112,8 (linha "Transversal", menor altura 5,43 m): veículo de 5,40 m desvia, 5,32 m passa.
- Regras sem rota: Tatuí–Iperó bloqueia carreta e VUC em 13/10/2026 e não em 29/05/2026 (antes do início); `pbt>23`,
  `eixos>2`, `altura>=`, `exceto_vuc`; `restricaoVigente` nos limites de início/fim; limite numérico de restrição curada
  com início futuro não bloqueia; `exclusions()` no corredor Tatuí→Iperó traz a ponte; Jânio Quadros (liberada) só informa;
  RA repetido da SP-330 km 62 vira 3 feições e as duas de 2,40 m só informam.
- Restrição vigente de teste na Ponte do Limão (carreta desvia, VUC liberado passa), histórica real do Limão vira `warn`
  "confira" sem bloquear; SIURB (Viaduto Guadalajara) e placas R-14/R-18 do DER-SP.
