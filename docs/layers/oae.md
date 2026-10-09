# Camada `oae`: pontes, viadutos, passarelas e túneis

Módulo: `api/src/layers/oae.layer.ts` · Testes: `api/test/layers/placas_gabarito.test.ts` · Frente: `placas_gabarito`.

## O que a camada faz na rota

| Situação | Efeito | Aviso |
|---|---|---|
| Estrutura com `altura_livre_m` e **altura do veículo ≥ altura livre − 0,10 m** | exclusão pequena (círculo de `bloqueio.raio_m`) em cada `bloqueio.pontos` → bloqueio duro só ali | `danger` `oae_altura_desvio` (rota desviada) ou `oae_altura_insuficiente` (a rota ainda passa perto) |
| Estrutura com `peso_max_t` e peso do veículo maior | igual | `danger` `oae_peso_desvio` / `oae_peso_excedido` |
| Restrição curada **vigente** (`proibido_pesados`/`interditada`) cujo critério alcança o veículo, na data da viagem | igual | `danger` `oae_restricao_desvio` / `oae_restricao_vigente` |
| Estrutura com altura conhecida que o veículo passa com folga | nenhum | um `info` `oae_altura_ok` com a menor altura da rota |
| Restrição vigente que não alcança o veículo (ex.: VUC liberado, faixa interditada) | nenhum | `info` `oae_restricao_nao_aplica` |
| Restrição **histórica** | nenhum (nunca bloqueia) | `info` `oae_restricao_historica` se foi liberada; `warn` se não achamos ato de liberação e o critério alcançaria o veículo |
| OAE nomeada da SIURB na rota | nenhum | linha no resumo com nome e status da obra; `info` `oae_obra` se o status não for "CONCLUÍDA" |
| GeoSampa / DER-SP (sem limites) | nenhum | contagem no resumo, `info` `oae_limits_unknown` para veículo pesado/alto, `warn` `wooden_bridge` |

Sem `bloqueio.pontos` uma feição **nunca bloqueia** (só avisa). Exclusões só são calculadas num corredor (bbox origem–destino
com folga de max(0,3°, 25% do vão)); fora dele o aviso `danger` ainda aparece porque o `annotate` olha a rota real.

**Por que exclusão (polígono) e não `costLines`:** a passarela fica SOBRE a rodovia e o que se quer bloquear é a pista
debaixo dela, num único ponto. O círculo é pequeno (20–35 m) e fica onde não há travessia de carro (passarela é de pedestre;
nas pontes curadas o ponto fica sobre o rio). `costLines` exigiria o traçado exato da pista sob a passarela, que nenhuma fonte dá.

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
| `artesp` | `artesp_passarelas` | 441 passarelas ativas das rodovias concedidas, 405 com **ALTURA** | CC-BY (dadosabertos.artesp.sp.gov.br, "Cadastro de Ativos") | mensal (XLSX de 05/08/2026) |
| `siurb` | `siurb_oae` | 105 OAEs municipais **nomeadas** com status da obra (contratos de inspeção/recuperação 2019-2021) | ODC-By 1.0 (dados.prefeitura.sp.gov.br) | manual |
| `curadoria` | `oae_restricoes_curadas` | restrições oficiais em pontes/viadutos, curadas em `data/raw/oae_restricoes_curadas.csv` | fatos de atos/notícias oficiais com citação; geometria aproximada do OSM (ODbL, extração não substancial) | revisar a cada 3 meses |

Rodar: `docker compose --profile import run --rm importer artesp_passarelas siurb_oae oae_restricoes_curadas`
(ou o `docker run ... truck-router-importer <nome>` do README). Cada carga gera `db/seed/layers/oae__<source>.sql`.
Dados de terceiros **nunca** vão para o OSM.

### ARTESP — passarelas com altura
- URL: `https://dadosabertos.artesp.sp.gov.br/dataset/491d79c5-ee09-4fe8-a3ce-1b425fe60bbe/resource/d864ec43-a93b-4803-9b48-1fee98a98fe7/download/passarelas.xlsx`
- Campo `ALTURA` **sem dicionário de dados**. Tratado como altura livre sob a passarela (o mínimo, 5,38 m, é coerente com a
  IP.DIN/010). Valores < 3,0 m são marcados `altura_suspeita` e **não bloqueiam** (há um de 2,40 m na SP-330 km 62, Jundiaí,
  igual à LARGURA: erro de digitação evidente numa rodovia onde caminhões de 4,40 m passam todo dia). Ficam em
  `data.altura_suspeita` do resultado e no popup do mapa.
- Passarelas com `STATUS = DEMOLIDA` são descartadas.
- `bloqueio.raio_m`: 35 m em pista DUPLA, 20 m nas demais. O ponto da ARTESP fica a 5 m (mediana; p99 19 m) da pista mais
  próxima no grafo do Valhalla; em pista dupla a outra pista pode estar a 20–30 m.
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
  a Marginal sob a ponte. Conferidos com `/locate` do Valhalla (aresta da própria ponte a ≤ 13 m).
- `tipo = altura|peso` vigente vira `altura_livre_m`/`peso_max_t` (regra numérica geral); `fim` preenchido vira `valid_to`.
- O arquivo está em `data/raw/` (ignorado pelo `.gitignore`), por isso foi versionado com `git add -f`.

Conteúdo em 09/10/2026 (verificado nesta data):

| id | status | resumo | fonte principal |
|---|---|---|---|
| `ponte_tatui_ipero_2026` | **vigente** | Ponte da Estrada Vicinal Salvador Serrão (divisa Tatuí–Iperó): pesados proibidos desde 30/05/2026, interdição total desde 03/06/2026; em 08/10/2026 seguia interditada, sem prazo | Prefeitura de Tatuí, notícia de 08/06/2026; Jornal Cruzeiro 08/10/2026 citando a Câmara de Iperó |
| `ponte_limao_2021` | histórica | pesados proibidos após batida de caminhão alto (28/07/2021); obra concluída, liberação prevista para 18/09/2021 | PMSP 31/07/2021 e 14/09/2021 |
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
3. Commitar os seeds `db/seed/layers/oae__*.sql`.

## Limitações
- Nenhum órgão publica gabarito/peso de pontes e viadutos (PMSP, DER-SP, ARTESP); só passarelas da ARTESP têm altura.
- `ALTURA` da ARTESP sem dicionário: pode ser altura do tabuleiro em outro referencial. Por isso a folga e o aviso "confira".
- O círculo de bloqueio pode não cobrir as duas pistas em canteiros muito largos (> 35 m) ou cobrir alças vizinhas.
- Restrição por sentido (`sentido`) ainda não é aplicada: a vigente bloqueia nos dois sentidos.
- Proximidade ≠ uso: "passa" = a até `bloqueio.raio_m` do ponto (ARTESP/curadoria), 20 m (SIURB) ou ≥ 60% do eixo a ≤ 15 m.
