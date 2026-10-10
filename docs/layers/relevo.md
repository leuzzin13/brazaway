# Camada `relevo` — rampa e perfil de altitude

Depois que a rota é calculada, a camada consulta um **Valhalla com elevação** (tiles gerados com o MDT **ANADEM v1**) —
desde 09/10/2026 é o **próprio Valhalla principal** (8002), que passou a rodar com esses tiles — e devolve:

- **rampa máxima de subida** no sentido do percurso e onde ela fica;
- **km acima do limite de atenção** do veículo e **trechos** com nível `atencao`/`evitar` (lat/lon do ponto mais íngreme,
  início/fim, way_ids do OSM, geometria);
- **perfil resumido** (altitude mín./máx., subida e descida acumuladas, até 120 pontos `[km, m]`, km de subida por faixa
  de rampa) e **descidas longas** para veículos pesados;
- **sugestão de `costLines`** (2ª rodada) para os trechos urbanos acima do limite "evitar".

Não muda a rota. Se o Valhalla não tiver elevação (ou estiver fora do ar), a camada **não anota** (nenhum aviso,
nenhum erro).

Arquivos: `api/src/layers/relevo.layer.ts`, `api/src/services/valhalla.ts` (funções `traceAttributesAt`,
`heightProfileAt`, `heightAt`, `encodePolyline6` — `route()` não mudou), `config/grade-limits.json`,
`scripts/build-elevation.sh`, `valhalla/elevation/anadem_to_hgt.py`, `docker-compose.elevation.yml` (opcional),
`api/test/layers/relevo.test.ts`, `docs/research/elevacao_rampas/validacao_lidar/` (validação com o LiDAR).

## Fontes e licenças

| Fonte | O que entra | Licença | Conferido |
|---|---|---|---|
| **ANADEM v1** — Modelo Digital de Terreno para a América do Sul (ANA + UFRGS/IPH), 30 m, tiles MGRS COG em `https://metadados.snirh.gov.br/files/anadem_v1_tiles/anadem_v1_<zona>.tif` | altitude (HGT 1" gerado por nós) | **CC BY 4.0** — "pode copiar, redistribuir, remixar, transformar e criar a partir do material para qualquer fim, inclusive comercial, desde que atribua o devido crédito aos autores" | metadado SNIRH/GeoNetwork [`93664c15-1ff8-4e87-bbed-2bb69d321309`](https://metadados.snirh.gov.br/geonetwork/srv/api/records/93664c15-1ff8-4e87-bbed-2bb69d321309) (dateStamp 2025-08-20), lido em 09/10/2026 |
| Copernicus DEM GLO-30 (base do ANADEM) | indireto | uso livre com atribuição (© DLR e.V. 2010-2014 e © Airbus Defence and Space GmbH 2014-2018, programa Copernicus) | atribuição de cortesia; a licença do derivado é a do ANADEM |
| OpenStreetMap (via Valhalla) | geometria/classe das vias, pontes/túneis, way_id | ODbL 1.0 | — |

A camada **compartilha material derivado** do ANADEM (`data.profile.points`, altitudes e rampas dos trechos), depois de
modificá-lo; a CC BY 4.0 (§3(a)(1)) pede crédito, link da licença e a indicação de que houve modificação. Atribuição a
exibir no app (tela de fontes):

> **Relevo: ANADEM v1 (ANA/UFRGS), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) — Laipelt et al. (2024),
> *ANADEM: A Digital Terrain Model for South America*, Remote Sensing 16(13):2321, doi:10.3390/rs16132321; derivado do
> Copernicus DEM GLO-30 (© DLR e.V., © Airbus). Modificado: reamostrado (bilinear) para HGT 1" e usado para estimar
> rampas.**

`meta.sources` traz o mesmo: licença `CC-BY-4.0`, link do registro de metadados e uma segunda entrada com o link da
licença. Nada desta camada vai para o OSM (é só leitura de altitude; nenhum dado é gravado em `data_features`, por isso
não há importador, seed nem migration — o número 0111 reservado ficou sem uso).

DEMs descartados pela pesquisa (`docs/research/elevacao_rampas/NOTES.md`): Skadi/SRTM (pior para rampa urbana),
FABDEM (CC BY-NC-SA), CGIAR SRTM (sem uso comercial), TanDEM-X 90 (só científico). O **LiDAR da PMSP** (0,5 m, erra
metade do ANADEM) é GPL-3.0 e exige gerar DTM a partir de ~190 GB de LAZ: fica como evolução (ver Limitações).

## Como funciona

```
POST /api/route ─► Valhalla principal (8002, tiles com elevação ANADEM) ─► rota
                └► relevo.annotate:
                     1. Valhalla de elevação = VALHALLA_ELEV_URL ("off" desliga a camada) ou, sem ela, o VALHALLA_URL;
                        sondado com /height na origem, no meio e no destino (altitude positiva fica 5 min em cache,
                        fora do ar 1 min, sonda que estoura os 3 s 15 s; "sem altitude aqui" não fica em cache)
                     2. trace_attributes (edge_walk sobre a geometria da rota; map_snap se o Valhalla recusar), em
                        pedaços de até 150 km / 12 mil pontos (limite trace do Valhalla: 200 km / 16 mil)
                        atributos: edge.max_upward_grade, edge.max_downward_grade, edge.weighted_grade,
                        edge.mean_elevation, edge.length, edge.way_id, edge.names, edge.bridge, edge.tunnel,
                        edge.road_class, edge.begin/end_shape_index, shape
                     3. /height com range=true na mesma linha, a cada 30 m (perfil; no máximo 100 mil amostras,
                        então o passo só cresce acima de 3.000 km)
                     4. compara com config/grade-limits.json
```

No `docker-compose.yml` a API recebe `VALHALLA_ELEV_URL=http://valhalla:8002` (o próprio principal). Fora do compose,
sem a variável, a camada usa o `VALHALLA_URL`. O Valhalla de elevação avulso na 8003 (`docker-compose.elevation.yml`)
só é usado se apontado em `VALHALLA_ELEV_URL` (ver "Build").

Nomes dos atributos conferidos no Valhalla 3.9.1 (`c803bdc2f`) que roda aqui. Detalhes que importam:

- `max_upward_grade`/`max_downward_grade` vêm em **% inteiro arredondado para cima** (postes de 60 m; precisão de 1 p.p.
  até 16% e passos de 4 de 16 a 76). Aresta sem elevação vem com **-500** (o que um Valhalla sem DEM devolve).
  Por causa do arredondamento para cima, a comparação é sempre `>` limite.
- `weighted_grade` vem em % (já convertido do índice 0–15). Ponte/túnel: o Valhalla limita a ±3%.
- `trace_attributes` e `/height` usam a mesma linha (o `shape` devolvido pelo trace), então as distâncias das arestas e
  do perfil batem (o `/height` mede a distância um pouco diferente; reescalamos pelo comprimento total).
- Rota e `trace_attributes` saem do mesmo Valhalla (mesma malha), então o `edge_walk` casa a geometria exatamente.
- **Falhas**: conexão recusada/DNS marca o Valhalla como fora do ar por 1 min; **tempo esgotado** (20 s no trace e no
  `/height`, `RELEVO_TRACE_TIMEOUT_MS`) só deixa aquela rota sem relevo — a próxima consulta de novo (antes, um único
  pedido lento desligava a camada por 1 min). Sem resposta do `/height`, a rampa sai só do `trace_attributes`.

### Rampa "sustentada" (filtro de ruído do DEM)

Com postes de 60 m, um DEM de 30 m inventa rampa: erro médio de 2,1–2,5 p.p. por intervalo de 60 m em morro
(validação contra o LiDAR, pesquisa §4) e muito mais em rodovia encaixada em encosta — na **Via Anchieta, na serra,
o Valhalla marca subidas de 24%** numa descida contínua. Por isso, para cada aresta:

1. Calculamos no perfil uma **média móvel centrada** da rampa com janela `window_m` por classe de via:
   **1.000 m** em `motorway`/`trunk`, **300 m** em `primary` (avenidas) e **120 m** nas demais (ladeira de rua curta
   continua aparecendo). Rodovias são projetadas com rampas longas e moderadas (IPR-706) e o que pesa para o caminhão é
   a rampa sustentada; com 300 m a Anchieta (subida, Santos → SP) ainda dava 22% no perfil bruto, com 500 m 14,5%, com
   1 km 8,9% e com 2 km 8,5%: a partir de 1 km o valor estabiliza (no sentido contrário a camada mede a descida da serra
   em 729 m / 13,3 km). Avenidas também têm rampa moderada de projeto (a LPUOS de SP, Lei 16.402/2016, Quadro 2B, pede
   no máximo 6–8% nas vias estruturais novas — referência, não regra de circulação) e são onde o ANADEM guarda mais
   resíduo de prédio (abaixo).
   Pontes/túneis são "aplainados" no perfil (reta entre as cabeceiras), porque o DEM mede o vale/morro e não o tabuleiro;
   ponte/túnel dividido em várias arestas consecutivas vira **um vão só** (antes, as junções ficavam com a altitude do
   vale e o "aplainado" virava serrote — Ponte das Bandeiras com 4 arestas, BR-040/Anel e BR-381 com 2).
2. A rampa da aresta é o **menor** entre o `max_upward_grade` do Valhalla e o máximo da média móvel nela.
3. Trecho = arestas consecutivas acima do limite de atenção (folga de 50 m). Só entra se a rampa sustentada passar do
   limite em pelo menos `min_over_m` (30 m); só vira `evitar` se passar do limite "evitar" em ≥ 30 m **e não for
   lombada do MDT** (abaixo). O que o Valhalla acusou e a média móvel não confirmou é contado em `data.discarded_spikes`.

### Lombada do MDT (resíduo de prédio em avenida plana)

O ANADEM é um MDT tirado do Copernicus (modelo de superfície) com remoção de prédios por aprendizado de máquina; em
avenida plana e densa sobra resíduo: na **Paulista** o MDT oscila 819–840 m a cada ~200 m, e na **Av. Rio Branco**
(Centro do Rio, ~5 m de altitude real) ele dá 24–42 m. Isso virava "evitar" para carreta (Paulista ~11–16%, Praça Mauá
~15%, Graça Aranha ~12%, Praça Floriano ~17%) com "avalie outra via" e `costLine` sugerida.

Teste de **lombada** (`bumpCheck`, fora de `motorway`/`trunk`): subida = máx. depois do pico − mín. antes do pico (no
trecho + meia janela); desfeito = o maior entre a queda até o mínimo nos `window_factor` × janela (240 m na rua, 600 m
na avenida) depois do topo e a subida até o máximo na mesma distância antes do pé ("buraco"). Lombada se desfeito ≥
`min_ratio` (0,5) × subida. (A revisão propôs `net = elev(d1+2L) − elev(d0−2L)`; com ele a lombada da Paulista no
km 1,4–1,6 passava — 7,7 m contra 6,7 m —, porque o terreno volta a subir depois da queda; por isso o mínimo/máximo
na janela.)

Antes de escolher o que fazer com a lombada, conferi contra o **LiDAR da PMSP** (DTM 1 m das 3 áreas da pesquisa §4:
Sumaré/Perdizes e Freguesia do Ó, de morro, e Mooca, plana): 178 rotas aleatórias de carreta dentro das áreas, cada
trecho comparado com a rampa sustentada de 120 m medida no LiDAR; 42 trechos únicos com cobertura do LiDAR e 62
rampas reais > 8% por ≥ 30 m. Scripts em `docs/research/elevacao_rampas/validacao_lidar/` (`reanotar.mts` reanota as
rotas com o código atual; `lidar_eval.py` compara; os números abaixo foram refeitos com o código desta versão em
09/10/2026).

| Política | trechos "evitar" | % com LiDAR > 8% (> 6%) | rampas reais > 8% com "evitar" | com algum aviso |
|---|---|---|---|---|
| sem teste de lombada (versão anterior) | 24 | 88% (96%) | 40 de 62 | 53 de 62 |
| lombada sem aviso em qualquer via (proposta da revisão) | 15 | 80% (93%) | 23 de 62 | **32 de 62** |
| **adotada**: lombada em `primary` sem aviso; nas demais, no máximo "atenção" | **15** | **80% (93%)** | **23 de 62** | **52 de 62** |

Leitura: no LiDAR, as **12 "lombadas"** com cobertura eram **todas rampa real > 8%** (a rua sobe um espigão e desce do
outro lado): 11 em rua residencial/terciária/secundária, rebaixadas a "atenção", e 1 em avenida, a R. Heitor Penteado
(`primary`, ~6,4% no MDT com 300 m, ~8,7% no LiDAR com 120 m), escondida. Esconder a lombada em toda via tiraria o aviso
de 20 das 62 rampas reais. Já na Paulista e no Centro do Rio (sem LiDAR, avenidas sabidamente planas) a lombada é
resíduo. O MDT de 30 m sozinho não separa as duas coisas (mesmo desenho, mesma amplitude de 10–40 m); por isso:

- lombada em `primary` (`bump.hide_road_classes`): sai de avisos, resumo, máximo da rota e `costLines`; fica em
  `data.bumps` (com `rise_m`, `undone_m`, `relief_m`) para o mapa e para calibrar;
- lombada nas demais vias: fica em `data.segments` com `bump: true`, **no máximo `atencao`** ("Reduza a marcha"), nunca
  "evitar", nunca `costLine`. Custa recall de "evitar" em bairro de morro (40 → 23 de 62), mas o aviso continua lá
  (52 de 62).

Os 3 "evitar" que o LiDAR não confirma > 8%: Av. Paulo VI (`primary`, 8,7% no MDT, 5,5% no LiDAR — não tem desenho de
lombada), Praça Horácio Sabino (6,7%) e R. Pedroso Xavier (7,8%).

Efeito medido (carreta = `carreta_5e`, 6/8%, terça 22h30; 09/10/2026, API desta branch com o Valhalla principal com
ANADEM; "antes" = a camada antes desta revisão, `044c2f1`, anotando a mesma geometria):

| Rota | Valhalla bruto (60 m) | Antes desta revisão | Agora |
|---|---|---|---|
| Pinheiros → Av. Dr. Arnaldo pela **R. Teodoro Sampaio** (2,8 km) | máx. 12% | 1 `evitar` (~11%) + 1 `atencao` (~8,1%), 1 `costLine` | igual: **1 `evitar`** (~11%, 215 m, 111 m acima de 8%, com `costLine`) + 1 `atencao` (~8,1%) |
| Metrô Consolação → metrô Paraíso pela **Av. Paulista** (4,6 km) | máx. 20% | 3 `evitar` na Paulista (~11%, ~16%, ~11%), 3 `costLines` | **nenhum trecho > 6%** (a janela de 300 m na avenida já absorve; 6 picos descartados) |
| Metrô Paraíso → metrô Consolação pela Paulista (3,2 km) | máx. 15% | 3 `evitar` (~11%, ~9,5%, ~14%) + 1 `atencao` (~8,7%) na Paulista, 3 `costLines` | **nenhum trecho**; 1 lombada de ~6,6% na Paulista em `data.bumps` |
| Consolação → Paraíso por Al. Santos / Al. Min. Rocha Azevedo / Paulista (4,6 km) | máx. 11% | 2 `evitar` (Al. Min. Rocha Azevedo ~11%, Paulista ~11%), 2 `costLines` | 1 `atencao` (Al. Min. Rocha Azevedo ~11%, lombada rebaixada); nenhum "evitar" |
| **Praça Mauá → Cinelândia** (Centro do Rio, 2,4 km) | máx. 32% | 4 `evitar` (Praça Mauá ~15%, Av. Rio Branco ~12%, Av. Graça Aranha ~12%, Praça Floriano ~17%) + 1 `atencao`, 4 `costLines` | **nenhum "evitar"**; 3 `atencao` (Praça Mauá ~6,6% com a janela de 300 m, R. Evaristo da Veiga ~8%, Praça Floriano ~17%, as duas últimas lombadas rebaixadas); Av. Graça Aranha (~9,4%) em `data.bumps` |
| Cinelândia → Praça Mauá (3,3 km) | máx. 15% | 2 `evitar` (R. Evaristo da Veiga ~10%, R. Acre ~10%) + 2 `atencao`, 2 `costLines` | nenhum "evitar"; 4 `atencao` (R. Santa Luzia, R. México, R. Evaristo da Veiga ~10%, R. Acre ~10%, todas lombadas rebaixadas) |
| Sé → Santos pela Anchieta (73 km, serra em descida) | máx. 24% | Pça. da Sé ~8,7% e Av. Martins Fontes ~9,1% de atenção | **nenhum trecho > 6%** (as duas são `primary`: janela de 300 m); 31 picos descartados; **descida longa de 13,3 km a 5,5% (desce 729 m)** |
| Santos → Sé pela Anchieta (72 km, serra em subida) | máx. 28% | 5 `evitar` (SP-150 ~8,5% e ~9%, Av. Dr. Waldemar Leão ~9,7%, Av. Rangel Pestana ~12%, R. Venceslau Brás ~10%) + 9 `atencao`, 3 `costLines` | 2 avisos de **subida forte na SP-150** (até ~9% no km 27–30 e ~8,5% no km 22–23) + 9 trechos de atenção (8 na serra, R. Venceslau Brás ~8,5% perto da Sé); sem `costLine` (rodovia) |
| Sé → Centro do Rio (Candelária) pela Dutra (431 km) | máx. 20% | 1 `evitar` (Praça Mauá ~15,5%) + 2 `atencao` (Pça. da Sé ~8,7%, Av. Venezuela ~7,2%), 1 `costLine` | **nenhum trecho > 6%** (máx. ~6,1%); 156 picos descartados; descida longa da **Serra das Araras: 5,8 km a 5,6% (323 m)** |
| Sé → BH (Praça Sete) pela Fernão Dias (583 km) | máx. 24% | 5 `evitar` (BR-381 ~8,2% e 4 na Av. Amazonas, BH, ~8–10%) + 9 `atencao`, 4 `costLines` | 1 aviso de **subida forte na BR-381** (~8,2%, km 524–526) + 7 trechos de atenção; 3 lombadas da Av. Amazonas em `data.bumps`; descidas longas de 5,1–5,8% |

### Limites por veículo (`config/grade-limits.json`) — valores de partida, a calibrar

Não existe limite legal de rampa para circular: estes números são **risco operacional** (perder tração no molhado,
não vencer a subida carregado). Vêm do cálculo de aderência da pesquisa (§5, `calc_rampa_veiculos.txt`) com a fórmula do
Anexo III da Resolução CONTRAN 882/2021 (`i = Ft/(10·G) − Rr/10`, `Ft = P_motriz·μ` quando a aderência limita, μ = 0,45,
Rr = 11 kgf/t) e foram propostos para serem calibrados com reportes `steep_grade` e motoristas. As chaves são os ids de
`config/vehicle-presets.json` (`carreta` é alias de `carreta_5e`; a camada também aceita o alias na config).

| Preset | Atenção acima de | Evitar acima de | Vale até (PBT de referência) | Base (aderência no molhado) |
|---|---|---|---|---|
| Utilitário (3,5 t) | 15% | 20% | 16 t | motriz ~2 t: ~25%, não limita; limite prático (DEM, manobra) |
| VUC (9 t) / Toco (16 t) | 15% | 20% | 16 t | VUC motriz 6 t: ~29%; toco motriz 10 t: ~27% (seco ~43%) |
| Truck 6x2 (23 t) | 12% | 15% | 23 t | motriz 8,5 t: ~15,5% |
| Carreta 5 eixos, cavalo 4x2 (41,5 t) | 6% | 8% | 41,5 t | motriz 10 t: ~9,7% |
| Carreta 6 eixos, cavalo 6x2 (48,5 t) | **5%** | **6,7%** | (41,5 t, da carreta 5 eixos) | motriz 8,5 t: ~6,8% |
| Romeu e Julieta, caminhão 6x2 (50 t) | **4,9%** | **6,3%** | (23 t, do truck) | motriz 8,5 t: ~6,5% (com caminhão 6x4: ~14%) |
| Bitrem 7 eixos, cavalo 6x4 (57 t) | 10% | 12% | 57 t | motriz 17 t: ~12,3% (com cavalo 6x2: ~5,6%) |
| Rodotrem 9 eixos, cavalo 6x4 (74 t) | 6% | 9% | 74 t | motriz 17 t: ~9,2% |

**PBT acima do de referência**: os limites caem pela mesma relação de aderência. Com a carga no eixo motriz fixa,
`(i + 1,1)` cai na proporção `ref/PBT` (1,1 = 11 kgf/t de resistência ao rolamento ÷ 10). Então
`lim' = (lim + 1,1) × ref/PBT − 1,1`, arredondado a 0,1 p.p.: contínuo e nunca mais frouxo com mais peso. Os presets
carreta 6 eixos e romeu-e-julieta usam essa mesma regra a partir da carreta 5 eixos e do truck (mesma carga motriz ou
menor), por isso `data.limits.source = "preset+peso"` neles.

| Veículo | Atenção / evitar |
|---|---|
| truck 23 t → 25 t → 26 t → 30 t | 12/15 → 11/13,7 → 10,5/13,1 → 8,9/11,2 |
| carreta 41,5 t → 48,5 t | 6/8 → 5/6,7 |
| bitrem 57 t → 63 t | 10/12 → 8,9/10,8 |
| rodotrem 74 t → 82 t | 6/9 → 5,3/8 |
| VUC até 16 t → 17 t | 15/20 → 14,1/18,8 |

(Antes havia um degrau fixo "> 1,1 × PBT do preset → 6/8" calibrado para a carreta: truck com 26 t ficava mais
restrito que bitrem com 57 t; e, depois da integração dos presets do núcleo, a `carreta` virou `carreta_5e` e caía na
faixa por peso.) Mais peso pode também pôr mais carga no eixo motriz; a fórmula ignora isso e fica do lado
conservador. As faixas `by_weight` (≤16 t 15/20; ≤23 t 12/15; acima 6/8) só valem para preset sem entrada na config.

Normas conferidas por mim na fonte primária (09/10/2026):

- **Resolução CONTRAN nº 882/2021** (DOU de 24/12/2021, Seção 1, p. 153,
  `in.gov.br/en/web/dou/-/resolucao-contran-n-882-de-13-de-dezembro-de-2021-370017699`). Alterações encontradas: a
  Res. CONTRAN 899/2022 mudou o art. 19 §4º e incluiu o §5º (dispensa de AET em trechos publicados pelo órgão), e a
  Res. 1.005/2024 só o art. 4º (19,30 m do cavalo + semirreboque); o art. 18 e o art. 19 §§1º–2º seguem na redação
  original.
  - **art. 18, caput**: "As CVC, com mais de duas unidades, incluída a unidade tratora, com PBTC acima de 57 t ou com
    comprimento total acima de 19,80 m, só poderão circular portando AET." Entre os presets, só o **rodotrem** (74 t,
    30 m) está aqui. O **bitrem** do preset (7 eixos, 57 t, 19,80 m) circula **sem AET** pelo **art. 6º I j** ("para a
    CVC com mais de duas unidades … o PBTC poderá ser de até 57 t", com no máximo 7 eixos, 17,5–19,8 m e "unidade
    tratora do tipo caminhão-trator" — sem exigência de tração dupla). **Carreta** (cavalo + 1 semirreboque) e
    **romeu-e-julieta** (caminhão + reboque) têm duas unidades.
  - **art. 19 §1º**: a unidade tratora das composições do art. 18 "deverá ser dotada de tração dupla (6x4) e, quando
    carregada, ser capaz de vencer aclives de 6%, com coeficiente de atrito pneu/solo de 0,45, resistência ao rolamento
    de 11 kgf/t e rendimento de transmissão de 90%".
  - **art. 19 §2º**: "Nas CVC com PBTC até 58,5 t, o caminhão-trator poderá ser de tração simples (4x2 ou 6x2)."
  - **§3º**: o órgão pode exigir faixa adicional em rampas com aclive acima de 5% e comprimento acima de 600 m.
  - **Anexo III**: fórmula da capacidade de rampa (acima). É requisito de projeto do veículo com AET e método de cálculo,
    não regra de circulação: por isso nada aqui gera `danger`, e os parâmetros do §1º (μ = 0,45, 11 kgf/t) são usados só
    como referência física para todos os presets.
- **DNER/DNIT IPR-706, Manual de Projeto Geométrico de Rodovias Rurais (1999), Quadro 5.5.2.1, p. 124** (PDF do DNIT):
  rampas máximas plano/ondulado/montanhoso — Classe 0: 3/4/5%; I: 3/4,5/6%; II: 3/5/7%; III: 4/6/8%; IV-A: 4/6/8%;
  IV-B: 6/8/10%, com a nota "a extensão de rampas acima de 8% será desejavelmente limitada a 300 m contínuos". Usado
  como referência de que rodovia tem rampa longa e moderada (janela de 1 km nelas); rampa > 10% sustentada em rodovia é
  quase sempre artefato do DEM.

A heurística de **descida longa** não tem norma: é só um aviso `info` de condução (freio-motor), para PBT ≥ 16 t.
Janelas de 2 km (passo de 100 m) com queda média ≥ 5% são unidas em intervalos; o intervalo unido é **conferido de
novo** (a união de janelas pode ter média menor: na SP → BH saía "3,6 km com média de 4,9%") e aparado de 100 em 100 m
pela ponta que mais melhora a média — se não chega a 5%, fica a melhor janela dele; vale se a queda total for ≥ 150 m
(`descent` na config). Janela fixa em vez de "do topo ao fundo" porque em serra o DEM repica dezenas de metros numa
descida contínua. Subida/descida acumuladas do perfil usam histerese de 10 m pelo mesmo motivo (ainda assim ficam
infladas em serra longa: ~6 km de subida acumulada na Sé → BH).

### Severidade dos avisos

Rampa não é restrição legal certa, e o DEM erra ~2 p.p.: **nunca `danger`**.

| code | severidade | quando |
|---|---|---|
| `steep_grade_avoid` | `warn` | trecho acima do limite "evitar" em ≥ 30 m, que não seja lombada do MDT (até 5; rodovia: trechos da mesma via a ≤ 3 km viram um aviso de "subida forte") |
| `steep_grade_avoid_more` | `warn` | mais trechos "evitar" além dos 5 |
| `steep_grade_warn` | `warn` | um aviso agregado dos trechos de atenção (quantos, metros, o pior), incluindo lombadas rebaixadas fora de avenida |
| `long_descent` | `info` | descida longa para veículo pesado (até 3) |

Exemplos (carreta): "Rampa de ~11% na Rua Teodoro Sampaio (trecho de 215 m): acima do recomendado para Carreta 5 eixos
(cavalo 4x2) (8%). Risco de patinar com piso molhado; avalie outra via." · "Subida forte na SP-150 (km 27–30 da rota):
até ~9%, com 150 m acima de 8% (recomendado p/ Carreta 5 eixos (cavalo 4x2)). Engate marcha reduzida antes; com piso
molhado há risco de perder tração." · "Descida longa: 13,3 km com média de 5,5% (desce 729 m) a partir da SP-150. Use
freio-motor e marcha reduzida." Limite com casa decimal sai com vírgula ("atenção > 8,9%, evitar > 11,2%").

### Saída em `layers.relevo`

`summary` (linhas curtas): rampa máx. e limites do veículo; metros acima do limite e nº de trechos; subida/descida e
faixa de altitude; aviso de que é estimativa. `data`:

`limits {warn_pct, avoid_pct, source: preset|peso|preset+peso, ref_weight_t, basis}`, `max_up_pct`,
`max_up_at {lat, lon, name}`, `max_down_pct`, `max_up_pct_valhalla` (bruto), `discarded_spikes`, `bumps_count`,
`bumps[]` (lombadas do MDT em avenida, mesmo formato dos trechos), `km_over_warn`, `km_over_avoid`, `segments_count`,
`segments[]` (até 50: `id, level, name, road_class, way_ids, max_up_pct, max_up_pct_valhalla, window_m, length_m,
over_warn_m, over_avoid_m, km_from_start, bump, rise_m, undone_m, relief_m, lat, lon, start, end, coordinates`),
`profile {step_m, min_m, max_m, ascent_m, descent_m, points[[km, m]]}`, `histogram_up_km` (faixas 0-3 … 20+,
`descida_6+`), `long_descents[]`, `cost_lines_suggested[]` (formato `LayerCostLine`), `coverage_pct`, `elapsed_ms`,
`window_m`, `note`.

Custo medido (09/10/2026, `data.elapsed_ms`, do `trace_attributes` ao fim): 7 ms numa rota urbana de 3 km com o
Valhalla aquecido (328 ms na 1ª), 32–76 ms em 73 km, 42–787 ms em 431 km e ~90 ms em 583 km. A rota inteira na API
integrada leva bem mais (4 s em 3 km, ~18 s em 73 km, ~52 s em 431 km, 85–95 s em 583 km), mas o tempo está nas outras
etapas, não nesta camada.

## Build dos tiles com elevação (medido em 09/10/2026)

**Estado atual**: o Valhalla principal (8002, `data/valhalla/`) já roda com estes tiles (troca feita em 09/10/2026,
backup dos tiles sem elevação em `data/cache/valhalla_sem_elevacao/`); o serviço avulso da 8003 foi desligado e
`data/valhalla_elev/` ficou vazia. O script continua servindo para uma instalação nova, para montar e testar um conjunto
novo antes de trocar, e para regenerar os HGT.

```bash
./scripts/build-elevation.sh          # = dem + tiles + serve + check (conjunto separado em data/valhalla_elev, 8003)
./scripts/build-elevation.sh dem      # ANADEM -> HGT (retomável: tile pronto é pulado)
./scripts/build-elevation.sh tiles    # valhalla_build_tiles + extract (FORCE=1 refaz)
./scripts/build-elevation.sh serve    # sobe truck-router-valhalla-elev na 8003 (compose + override)
./scripts/build-elevation.sh check    # /height na Sé e trace_attributes de teste (no 8003 se estiver no ar; senão no 8002)
VALHALLA_ELEV_DIR="$PWD/data/valhalla" ./scripts/build-elevation.sh dem   # HGT direto na pasta do principal
```

Variáveis: `VALHALLA_MAIN_DIR` (default `data/valhalla`, só leitura), `VALHALLA_ELEV_DIR` (default `data/valhalla_elev`),
`ELEV_BUILD_THREADS` (6), `DEM_JOBS` (6), `VALHALLA_ELEV_PORT` (8003), `ELEV_BBOX` (quando não há grafo principal).
A pasta de saída separada se ignora no git sozinha (`data/valhalla_elev/.gitignore` com `*`).

1. **DEM** (`valhalla/elevation/anadem_to_hgt.py`, contêiner `ghcr.io/osgeo/gdal:ubuntu-small-3.9.3`): lista as células de
   1° que contêm tiles de nível 2 do grafo principal (mesma regra do `valhalla_build_elevation --from-tiles`) — **112
   tiles no Sudeste**; para cada um, `gdal.Warp` dos COGs do ANADEM por HTTP range (`/vsicurl/`, só os blocos
   necessários), grade pixel-is-point de 3601×3601 (extensão com meia célula de folga, `-te x-1/7200 … -ts 3601 3601`),
   bilinear, Int16, NoData −9999 → −32768, e `gdal_translate -of SRTMHGT` para `elevation_data/S24/S24W047.hgt`.
   Zonas MGRS usadas: 21J 21K 22H 22J 22K 22L 23J 23K 23L 24K 24L (extensões conferidas com `gdalinfo`).
   **S21W030 (Ilha da Trindade) não tem ANADEM** e ficou sem elevação. 22 tiles costeiros têm NoData no mar (normal).
   Conferência: o S24W047 gerado bate com o HGT testado na pesquisa (diferença máx. 1 m em 20 pixels; Sé 757 m,
   Sumaré 796 m, Ibirapuera 755 m).
2. **Tiles**: um contêiner avulso da imagem `truck-router-valhalla` roda `valhalla_build_config` (mesmos defaults do
   principal + `additional_data.elevation=/custom_files/elevation_data`), `valhalla_build_tiles` (todas as etapas; a
   etapa `elevation` usa os HGT da pasta) e `valhalla_build_extract`. PBF: **hardlink** de `data/valhalla/sudeste-latest.osm.pbf`
   (mesmo arquivo, 0 byte a mais); `admins.sqlite`, `timezones.sqlite` e `default_speeds.json` copiados do principal.
   O build **não** usa `build_elevation=True` (isso baixaria o Skadi/SRTM).
3. **Serviço avulso** (opcional): `docker-compose.elevation.yml` (serviço `valhalla-elev`, contêiner
   `truck-router-valhalla-elev`, porta 8003 → 8002, `use_tiles_ignore_pbf=True`, sem rebuild). A API só o usa com
   `VALHALLA_ELEV_URL=http://localhost:8003`.

| Etapa | Tempo (M4 Pro, VM Colima 8 vCPU / 14 GB) | Observação |
|---|---|---|
| DEM → 111 HGT | **2 min 26 s** (6 em paralelo, 4–11 s por tile) | ~57 MB baixados por tile ≈ **6,3 GB** de download no total |
| `valhalla_build_tiles` | **2 min 49 s** (6 threads) | etapa `elevation` = **11 s**; ParseNodes 43 s, ParseWays 19 s, hierarquia 23 s, restrições 19 s |
| `valhalla_build_extract` | 11 s | |
| subir o serviço | ~5 s | |
| **Total** | **~5,5 min** | pico de RAM do build: **6,7 GiB** |

| Disco | Tamanho |
|---|---|
| `elevation_data/` (111 HGT × 25,9 MB) | **2,8 GB** |
| `valhalla_tiles/` | 1,35 GB (sem elevação: 1,29 GB) |
| `valhalla_tiles.tar` | 1,21 GB (sem elevação: 1,17 GB; +3,5%) |
| admins/timezones/default_speeds | 0,13 GB |
| PBF | 0 (hardlink; 0,86 GB se copiado) |
| **Total do conjunto com elevação** | **~5,5 GB** (6,0 GB com logs e a pasta de tiles) |

Os HGT só são necessários no build e no `/height` (perfil). Se faltar disco: `gzip` nos `.hgt` (o Valhalla lê `.hgt.gz`;
fica ~1,1 GB, com custo de descompressão no `/height`), ou apagar `valhalla_tiles/` e manter só o `.tar`. O backup
`data/cache/valhalla_sem_elevacao/` (3,4 GB) pode ser apagado quando não for mais preciso reverter.

**Brasil inteiro** (estimativa): 811 tiles HGT ≈ 21 GB, ~46 GB de download (~17 min no mesmo ritmo), acrescentar as zonas
MGRS em `--zones`/`ANADEM_ZONES` e o build de tiles do Brasil (1,5–3 h, 16 GB de RAM, ver README). As 52 zonas do ANADEM
(América do Sul, 64 GB no total, nunca baixados inteiros): `17L, 17M, 17N, 18F, 18G, 18H, 18K, 18L, 18M, 18N, 18P, 19F, 19G, 19H, 19J, 19K, 19L, 19M, 19N, 19P, 20F, 20G, 20H, 20J, 20K, 20L, 20M, 20N, 20P, 21F, 21H, 21J, 21K, 21L, 21M, 21N, 21P, 22H, 22J, 22K, 22L, 22M, 22N, 23J, 23K, 23L, 23M, 24K, 24L, 24M, 25L, 25M`.
Rotas muito longas não quebram a camada: mínimo/máximo do perfil são calculados em laço (espalhar 150 mil altitudes
em `Math.max(...)` estoura a pilha no Node 26) e o `/height` usa no máximo 100 mil amostras.

### Como atualizar

- **PBF novo**: o rebuild normal do principal mantém a elevação **desde que** `data/valhalla/elevation_data/` tenha os
  HGT: o entrypoint oficial (`configure_valhalla.sh`, conferido na imagem) sempre aponta `additional_data.elevation`
  para essa pasta e roda o `valhalla_build_tiles` em duas partes (`-e build` e `-s enhance` até o fim, etapa
  `elevation` inclusa). Manter `build_elevation: "False"`
  no compose (com `True` ele baixaria do Skadi os tiles que faltam, ex.: S21W030, misturando fontes). Não refiz esse
  rebuild aqui (derrubaria o 8002 compartilhado); conferir depois com `./scripts/build-elevation.sh check`. Sem
  indisponibilidade: montar o conjunto novo em `data/valhalla_elev` (`FORCE=1 ./scripts/build-elevation.sh tiles serve`,
  apagando antes o hardlink `data/valhalla_elev/*.pbf`), testar no 8003 e fazer a troca abaixo.
- **ANADEM novo** (v2): apagar os HGT (`data/valhalla/elevation_data/`, ou só os tiles alterados), rodar
  `VALHALLA_ELEV_DIR="$PWD/data/valhalla" ./scripts/build-elevation.sh dem` e rebuildar o principal (ou o caminho do
  conjunto separado + troca); ajustar `ANADEM_BASE_URL` se a pasta mudar e conferir de novo a licença no metadado.
- **Instalação nova**: `./scripts/build-elevation.sh` (conjunto separado no 8003) e a troca abaixo; ou gerar os HGT com
  `VALHALLA_ELEV_DIR="$PWD/data/valhalla" ELEV_BBOX=… ./scripts/build-elevation.sh dem` antes do 1º
  `docker compose up` (o build inicial já sai com elevação; caminho não testado aqui).
- **Limites**: editar `config/grade-limits.json` (lido na subida da API). Preset novo em `config/vehicle-presets.json`
  precisa de entrada lá (o teste "todo preset … tem limites próprios" falha sem ela).

## Trocar o Valhalla principal pelos tiles com elevação (feito em 09/10/2026)

Os tiles de `data/valhalla_elev/` são os mesmos do principal + elevação (mesmo PBF, mesma configuração). Procedimento
(com pouca indisponibilidade, só o restart do contêiner), para refazer numa instalação nova ou depois de montar um
conjunto novo:

```bash
# 0) conferir que o 8003 está bom
./scripts/build-elevation.sh check
# 1) parar o serviço de elevação avulso e o principal
docker rm -f truck-router-valhalla-elev
docker compose stop valhalla
# 2) trocar o CONTEÚDO das pastas (renomeações instantâneas no mesmo disco; o glob * não pega os dotfiles, então
#    data/valhalla/.gitkeep (versionado) fica onde está; o backup vai para data/cache/, que o git ignora;
#    o PBF é hardlink e continua válido)
mkdir -p data/cache/valhalla_sem_elevacao
mv data/valhalla/* data/cache/valhalla_sem_elevacao/
mv data/valhalla_elev/* data/valhalla/
# 3) subir o principal (carrega o .tar; não rebuilda: use_tiles_ignore_pbf=True e os bancos já existem)
docker compose up -d valhalla
curl -s localhost:8002/height -d '{"shape":[{"lat":-23.5505,"lon":-46.6339}]}'   # deve dar ~757, não null
```

Depois:

- A camada acha a elevação sozinha: no compose, a API já recebe `VALHALLA_ELEV_URL=http://valhalla:8002`; fora dele,
  sem a variável, usa o `VALHALLA_URL`.
- O teste "Valhalla real sem elevação" se desliga sozinho (ele sonda o `/height` do principal antes); o caso
  "arestas com -500" continua coberto por um Valhalla simulado no próprio teste.
- Reverter: `docker compose stop valhalla && mv data/valhalla/* data/valhalla_elev/ && mv data/cache/valhalla_sem_elevacao/* data/valhalla/ && docker compose up -d valhalla`
  e `VALHALLA_ELEV_URL=off` (ou apontar para um Valhalla com elevação) na API.

Alternativa sem trocar pastas: hardlink dos HGT em `data/valhalla/elevation_data/` e `force_rebuild=True` uma vez
(~3 min de build com o Valhalla fora).

## 2ª rodada com `costLines` (sugestão, não aplicada)

`costLines(ctx)` roda **antes** da rota e não sabe por onde ela vai; as rampas só são conhecidas depois. Por isso a
camada devolve `data.cost_lines_suggested`: um `LayerCostLine` por trecho `evitar` fora de rodovia (`motorway`/`trunk`
ficam de fora: em geral não há alternativa e o aviso é de condução), com a geometria das arestas **no sentido da subida**
e `factor` 10. O `linear_cost_factors` do Valhalla faz `edge_walk` da linha, então só a aresta dirigida de subida fica
mais cara — a descida pela mesma rua e as ruas que cruzam não são afetadas. Lombada do MDT nunca gera `costLine`.
Sem exigir reporte `steep_grade` que confirme (proposta da revisão, não adotada): o reporte já bloqueia a via sozinho no
núcleo (`0004_functions.sql`, `value_num < peso`), e os "evitar" que sobram (fora de lombada) acertaram 80% no LiDAR
(93% acima de 6%); a sugestão é penalidade (fator 10), não bloqueio, e nem é aplicada hoje.

Como ficaria no `routing.ts` (não implementado aqui; arquivo do núcleo):

1. calcular a rota como hoje e rodar as anotações;
2. se `layers.relevo.data.cost_lines_suggested` não estiver vazio, recalcular com `costLines + sugestões`;
3. anotar a nova rota de novo e ficar com ela só se (a) não usar mais os trechos sugeridos, (b) não criar trecho `evitar`
   novo pior que o evitado e (c) o desvio for razoável (ex.: ≤ +30% de distância ou ≤ +3 km em área urbana); senão,
   manter a original com os avisos;
4. no máximo uma 2ª rodada (custo: +1 rota + 1 anotação); devolver o que foi evitado em `avoided` com
   `kind: 'layer', layer: 'relevo'`.

Testado no `relevo.test.ts`: na ladeira da Teodoro Sampaio, mandar as sugestões ao Valhalla principal tira a rota do
trecho de ~11% (o ponto mais íngreme fica a > 100 m da rota nova; 2,8 km → 4,2 km por Henrique Schaumann / Paulo VI /
Cardoso de Almeida / Dr. Arnaldo / Cardeal Arcoverde).

Evolução natural: pré-calcular uma tabela de trechos íngremes (PostGIS, por way_id e sentido, a partir do perfil do
ANADEM — e do LiDAR na capital) para `costLines(ctx)` já penalizar na 1ª rodada as rampas acima do limite do veículo no
corredor origem–destino, e mostrá-los no mapa; reportes `steep_grade` confirmam/derrubam.

## Limitações e pendências

- **Erro do DEM**: ANADEM erra 2,1–2,5 p.p. (MAE) por intervalo de 60 m em bairros de morro e **subestima rampas muito
  fortes** (recall de 0,33–0,40 para > 15%); em área plana e densa ainda pode inventar rampa (precisão de 0,47 para
  > 8% na Mooca). A média móvel reduz o ruído mas também achata ladeiras com menos de ~120 m. Tudo é "~". No LiDAR, 9
  das 62 rampas reais > 8% (curtas, de 30–80 m acima do limite, algumas de 21–25%) não recebem nenhum trecho.
- **Resíduo de prédio fora de avenida**: o teste de lombada só esconde em `primary`; em rua terciária/residencial de
  centro denso (Centro do Rio: R. Evaristo da Veiga, R. Acre, Praça Floriano; em SP: Al. Min. Rocha Azevedo) ainda sai
  `atencao` falso. E o MDT de 30 m não separa lombada real de resíduo: em bairro de morro, lombada real de 11–19% fica
  em "atenção" e não em "evitar" (recall de "evitar" 40 → 23 de 62 no LiDAR), e numa avenida de morro a lombada real
  some dos avisos (R. Heitor Penteado, ~8,7% no LiDAR). Separar de verdade pede outra fonte: densidade de prédios do
  OSM em volta do trecho, ou o LiDAR na capital.
- **Falso "evitar" sem desenho de lombada**: Av. Paulo VI (`primary`, 8,7% no MDT, 5,5% no LiDAR) — 3 dos 15 "evitar"
  da validação não passam de 8% no LiDAR.
- **Degrau do MDT** (ex.: Praça Mauá → Av. Rio Branco, de 8 m para 27 m num platô de resíduo): não é lombada; a janela
  de 300 m em avenida o reduz a ~6,6% (atenção), mas não some.
- **Rodovia encaixada em encosta / viaduto sem `bridge=yes`**: o DEM mede o terreno ao lado; a janela de 1 km nas
  rodovias resolve a maior parte (Anchieta), mas esconde um "degrau" curto e forte numa rodovia. Rodovias estaduais
  classificadas como `primary` usam a janela de 300 m.
- `max_upward_grade` é o máximo da aresta, não o comprimento: o comprimento acima do limite sai do perfil (passo de 30 m,
  amostras de 15 m na aresta). Arestas < 10 m não têm rampa no Valhalla.
- O Valhalla 3.9.1 **não usa rampa no costing `truck`** (issue #1191): a rota não evita subidas sozinha; esta camada só
  avisa (e sugere a 2ª rodada, que depende do `routing.ts`).
- **Tração**: o veículo não informa a tração. Os limites do bitrem supõem cavalo 6x4 (o art. 6º I j não exige tração
  dupla; com 6x2 a aderência cai a ~5,6%), os do romeu-e-julieta supõem caminhão 6x2 (com 6x4 seriam bem mais folgados)
  e os da carreta 6 eixos, cavalo 6x2. Um campo de tração no veículo (núcleo) resolveria.
- Cobertura: só os 111 tiles do grafo do Sudeste (S21W030 sem ANADEM). Fora disso `coverage_pct` cai e a camada anota
  só o que tem dado.
- O front mostra `summary`/`warnings` sem código específico; um gráfico do perfil (`data.profile.points`) e os trechos no
  mapa (`data.segments[].coordinates`, `data.bumps[]`) ficam para quem mexer no front.
- Subida/descida acumuladas do perfil ficam infladas em serra longa (~6 km de subida na Sé → BH), apesar da histerese.
- **LiDAR da PMSP** (0,5 m, MAE ~1 p.p.): melhoraria muito a capital, mas exige processar ~190 GB de LAZ (dentro da AWS
  sa-east-1) e é **GPL-3.0** — uso interno no servidor parece ok; distribuir HGT/derivados pode exigir GPL. Pedir leitura
  jurídica antes.
- Os limites são de partida; calibrar com reportes `steep_grade` (peso que vence a subida) e com motoristas.

## Testes

`api/test/layers/relevo.test.ts` (28 testes; 1 só roda se o Valhalla principal **não** tiver elevação; os de rota
precisam da API desta branch e do Valhalla com elevação):

```bash
cd api && API_URL=http://localhost:3125 npx vitest run test/layers/relevo.test.ts
```

- carreta subindo a **Rua Teodoro Sampaio** (Largo da Batata → Av. Dr. Arnaldo, terça 22h30): limites do preset
  (6/8%, `carreta` → `carreta_5e`), `max_up_pct` > 8%, trecho `evitar` (não lombada) na Teodoro Sampaio com lat/lon
  sobre a rota, aviso `steep_grade_avoid` `warn` (nenhum `danger`), perfil sobe > 50 m (740 → 820 m);
- VUC na mesma rota: limites 15/20%, nenhum aviso de rampa; truck com 30 t: limites 8,9/11,2% (com vírgula no resumo);
- 2ª rodada: as `cost_lines_suggested` mandadas ao Valhalla principal tiram a rota do trecho íngreme;
- **regressão do resíduo de prédio** (carreta): Consolação ↔ Paraíso pela Paulista (os dois sentidos), Praça Mauá →
  Cinelândia e Cinelândia → Praça Mauá: nenhum `evitar`, nenhum `steep_grade_avoid`, nenhuma `costLine`; nada da
  Paulista em trechos nem avisos, e o que sobra dela fica em `data.bumps`;
- **política da lombada** com Valhalla simulado (perfil sintético de 1,2 km): lombada em `primary` só em `data.bumps`;
  a mesma lombada em rua residencial fica `atencao` sem `costLine`; ladeira contínua vira `evitar` com `costLine` no
  sentido da subida;
- limites: todo preset de `config/vehicle-presets.json` tem entrada própria; preset no PBT de referência; truck 30 t =
  8,9/11,2, bitrem 63 t = 8,9/10,8, carreta 6 eixos = 5/6,7, romeu-e-julieta = 4,9/6,3; **monotonia** (para cada preset,
  de 1 a 100 t de 1 em 1 t, mais peso nunca afrouxa e nenhum degrau passa de 2 p.p.);
- funções internas: descida longa unida conferida de novo (nunca média < 5%), ponte em várias arestas aplainada como um
  vão só, `bumpCheck` (lombada × ladeira contínua), tempo esgotado × fora do ar, mín./máx. de 400 mil altitudes;
- Valhalla fora do ar (porta fechada), **Valhalla simulado** com arestas -500 e com `trace_attributes` lento (a rota sai
  sem relevo e a seguinte volta a consultar), e Valhalla real sem elevação (só se o principal não tiver os tiles com
  ANADEM): a camada devolve `{}`;
- linha no mar (sem DEM): `{}`, e a rota seguinte (em terra) é anotada normalmente (a sonda não "envenena" o cache).

Sem elevação no Valhalla, os testes que dependem dela são pulados com aviso no console. Resultado em 09/10/2026 contra a
API desta branch (porta 3125): `relevo.test.ts` 27 passaram, 1 pulado. Suíte inteira (16 arquivos, 205 testes), com o
ambiente compartilhado sob carga (load ~15, o Postgres reiniciando várias vezes com `malloc(): invalid size` num backend
PostGIS, e a API caindo junto): 178 passaram, 16 falharam, 11 pulados. Refeitos: `placas_gabarito` 19/19 (as falhas
eram "database system is in recovery mode"); os 3 testes da BR-459 em `rodovias_horario` falham igual contra a API da
`main` (3000), sem relação com esta camada; `core_legal` e `altura_osm` estouraram o tempo (120 s) em rotas/hooks sob a
mesma carga. Esta camada não muda rota (só anota) e leva < 1 s por rota.

## Decisões

- **Conjunto separado e troca de pasta** em vez de rebuildar o principal no lugar: outras frentes testavam no 8002; o
  conjunto com elevação foi montado e testado no 8003 e trocado por `mv` (09/10/2026). Hoje a camada usa o principal.
- **ANADEM e não Skadi/SRTM**: melhor DEM nacional com uso comercial (pesquisa §3–4); conversão própria para HGT porque o
  `valhalla_build_elevation` só baixa do Skadi.
- **Sudeste inteiro, não só a RMSP**: o volume coube (2,8 GB de HGT, 2,5 min de conversão).
- **`edge_walk`** sobre a geometria da rota (mesma malha), com `map_snap` de reserva (não em tempo esgotado).
- **Rampa sustentada** (menor entre Valhalla e média móvel de 120 m / 300 m em avenida / 1 km em rodovia) para não
  acusar rampa inexistente em serra e em avenida com prédios.
- **Lombada do MDT**: escondida só em avenida (`primary`) e rebaixada a "atenção" nas demais vias, em vez de escondida
  em toda via — conferido contra o LiDAR (tabela acima): esconder em toda via tiraria o aviso de 20 das 62 rampas reais.
- **Limites acima do PBT de referência pela relação de aderência** (contínuos), não por faixa fixa de peso; presets
  derivados (carreta 6 eixos, romeu-e-julieta) pela mesma regra.
- **Sem `danger`**: rampa não é restrição legal; erro do DEM ~2 p.p.
- **Sem dados em `data_features`** (cálculo por rota, nada a importar).
