# Camada `rodovias_estaduais`: DERs de MG, ES e RJ (e OAEs do DER-MG e do DER-ES na camada `oae`)

Módulo: `api/src/layers/rodovias_estaduais.layer.ts` · Testes: `api/test/layers/rodovias_estaduais.test.ts` e
`importers/tests/test_ders_estaduais.py` · Frente: `ders_estaduais` · Pesquisa: `docs/research/sudeste_ders_estaduais/`
(com a verificação) e, para os atos do DER-ES de 2024–2026, `docs/research/sudeste_vitoria_es/`.

A frente cobre os três DERs do Sudeste fora de SP:

| O quê | Onde entra | Importador | Efeito na rota |
|---|---|---|---|
| Pontos críticos vivos do DER-MG (459 ativos em 10/10/2026) | `rodovias_estaduais`, source `der-mg` | `rodovias_estaduais_der_mg` | bloqueio só no ponto ativo e para o veículo afetado; aviso nos demais |
| Restrições de trecho do DER-ES (IS no DIO-ES) | `rodovias_estaduais`, source `der-es` | `rodovias_estaduais_der_es` | trecho penalizado (fator 1000) se a regra está ativa e alcança o veículo |
| RJ-127, Serra de Paracambi (DER-RJ, só notícia) | `rodovias_estaduais`, source `der-rj` | `rodovias_estaduais_der_rj` | desativada: só informa |
| 4.370 OAEs do DER-MG (cadastro + inspeção) | `oae`, source `der-mg` | `oae_der_mg` | contagem, ponte de madeira, ponte estreita (só aviso) |
| 17 pontes estaduais do ES com PBT máximo (IS do DER-ES) | `oae`, source `der-es` | `oae_der_es` | bloqueio sobre a ponte para quem pesa mais que o limite |

Curadoria das regras do ES e do RJ: `data/raw/ders_estaduais/regras.json` (versionado com `git add -f`).

## O que a camada faz na rota

### Pontos críticos do DER-MG

| Situação na fonte (`trafeg_variante`) | `props.situacao` | Veículo afetado | Efeito | Aviso |
|---|---|---|---|---|
| Pista Interrompida | `interrompida` | todos | exclusão pequena no ponto | `pc_desvio` (`warn`, rota desviada) ou `pc_bloqueio_na_rota` (`danger`) |
| Pista interrompida para veículos pesados | `interrompida_pesados` | todo caminhão (PBT > 3,5 t, CTB Anexo I), **VUC inclusive** | exclusão no ponto | idem; só o veículo até 3,5 t passa, com `pc_pesados_liberado` (`warn`) |
| `limite_carga` = Sim **com** `qnt_carga_limite` (t) | (qualquer) | PBT acima do valor | exclusão no ponto | idem; abaixo do valor, `pc_limite_carga_ok` (`info`) |
| Pista Interrompida - Com Variante | `interrompida_com_variante` | — | nenhum (há desvio no local) | `pc_variante` (`warn`) |
| Meia-Pista | `meia_pista` | — | nenhum | `pc_meia_pista` (`warn`, pare e siga) |
| `limite_carga` = Sim **sem** valor (100% hoje) | (qualquer) | — | nenhum | `pc_limite_carga_sem_valor` (`warn`) |
| Pista Normal (livre) / A definir | `livre` / `a_definir` | — | nenhum | só a contagem no resumo |

- **Só ponto ativo bloqueia.** O importador grava só `status` 1 (A iniciar), 2 (Em andamento) ou 3 (Paralisada) sem
  `data_conclusao`. Cada carga vale 72 h a partir do **download de fato** (`valid_to` = hora da consulta + 72 h, com
  `consultado_em` = hora da consulta; o cache da consulta vale 30 min e, quando é usado, a hora é a do arquivo); a API
  ignora feições vencidas (compara com o **agora**, não com a saída: uma viagem marcada para daqui a 5 dias usa a situação
  conhecida hoje). **Fonte fora do ar = carga falha:** o `http_get` comum, depois de 3 falhas, devolve o cache antigo de
  qualquer idade; esta fonte recusa cache com mais de 30 min (`query_geojson(..., sem_cache_vencido=True)`), a carga
  aborta sem tocar no banco e os pontos já gravados vencem sozinhos em 72 h, em vez de bloquear uma via já liberada.
- **Por que `trafeg_variante`:** é o campo que o painel público mostra como "Trafegabilidade" (widget de lista e gráfico
  do painel "Pontos críticos – Público"). A verificação de 10/10/2026 alertou que 4 dos 5 pontos com `trafegabilidade` =
  3 (interrompida) têm variante no local e que bloqueá-los desviaria de vias passáveis: por isso "com variante" só avisa.
  O campo também pega o único ponto ativo "para veículos pesados" (MG-220, Santo Hipólito), que tem `trafegabilidade` = 1
  (livre) — divergência da fonte; vale o que o painel mostra. Sem `trafeg_variante`, usa `trafegabilidade` +
  `solucao_trafego`. `veiculos_leves` = Sim numa interrupção total vira "só pesados".
- **"Veículo pesado"**: o DER-MG não define. Decisão de produto: pesado = **todo caminhão** (PBT > 3,5 t, CTB Anexo I,
  red. Lei 14.440/2022), **VUC inclusive**. A definição de VUC do app (`isVucSP`, Portaria SMT 137/2018 de São Paulo) só
  limita largura, comprimento e idade, não o PBT, e é municipal; o único ponto ativo "para pesados" (MG-220, Santo
  Hipólito) é dano em OAE, e o importador transforma "interrompida" + `veiculos_leves` = Sim em "para pesados" — só os
  leves foram liberados. Só o veículo de até 3,5 t passa, com aviso `warn` para conferir a sinalização.
- **Origem ou destino no próprio ponto:** dentro do círculo de bloqueio (a até `raio_m` do ponto) **ou** numa aresta do
  grafo que o círculo corta — o `exclude_polygons` do Valhalla tira a aresta inteira, e o `/locate` do endereço (perfil
  truck, raio 0) mostra que **todas** as arestas onde ele se encaixa sairiam junto, isolando-o. Aí o app não bloqueia e
  avisa (`pc_origem_destino`, `danger`) — a mesma política da ZMRC. **Nos outros casos, bloqueia**, mesmo com o endereço a
  poucos metros: na MG-430 em Igaratinga, um destino na outra cabeceira da ponte de 40 m (a 37 m do ponto, num nó com a
  aresta seguinte livre) é alcançado pelo desvio de 10,3 km, e destinos a 310 m e 700 m depois da ponte também (o
  limite antigo de 1 km mandava a carreta pela OAE quebrada). O `/locate` só é chamado para origem/destino a até 5 km do
  ponto; sem resposta do Valhalla, o bloqueio fica. Mesmo resultado em `exclusions()` e `annotate()` (cache por rota).
- **"Na rota"** (avisos): ponto com bloqueio = a rota passa dentro do círculo (`raio_m`), como o `passaPor` da camada
  `oae` (candidatos buscados a até 100 m do ponto da fonte: o importador leva o bloqueio até 80 m dele); ponto sem
  bloqueio (variante, meia-pista, livre) = a até 30 m do ponto da fonte.
- **Bloqueio (exclusão e não `costLines`):** pista interrompida é interrupção física num ponto; `costLines` com fator
  1000 ainda deixaria passar quando não há alternativa, e o ponto do DER-MG não traz extensão. O círculo (`raio_m`, padrão
  20 m — decisão de produto) fica sobre a pista da rodovia: o importador consulta o `/locate` do Valhalla e leva o ponto
  para a aresta com o código da rodovia no nome a até 80 m (MGC-xxx também casa BR-xxx; `ajuste = rodovia`), senão para a
  via mais próxima a até 30 m (`via_mais_proxima`); um ponto por pista. O raio encolhe (mínimo 8 m) se outra via (outro
  way do OSM, sem o nome da rodovia, que não é alça) passar a menos de raio + 5 m **do ponto de bloqueio** — medido num 2º
  `/locate` centrado nele (a distância ao ponto da fonte enganaria: uma transversal pode cruzar a rodovia junto do
  bloqueio e ter o ponto mais próximo da fonte longe dali). Em 10/10/2026: MG-430 em Igaratinga (2 pontos em arestas da MG-430, a 11,5 e 20,9 m do ponto da fonte) e MG-220 em Santo
  Hipólito (11,3 m). Exclusões só no corredor origem–destino (bbox com folga de max(0,3°, 25%)); fora dele o `annotate`
  ainda avisa pela rota real.
- O aviso traz causa, previsão (`data_prevista`; "vencida" se passou), a rota alternativa em texto (`obs_alternativa`) e a
  data da última edição do registro. O resumo dá a contagem por situação e a última edição da fonte.

### Regras de trecho (DER-ES, DER-RJ)

| Regra | Efeito | Aviso |
|---|---|---|
| `ativa` e `status = vigente`, critério alcança o veículo | trecho penalizado (`linear_cost_factors`, fator 1000) recortado da própria rota (até 3 rodadas, como em `rodovias_horario`) | `regra_estadual_desvio` (`warn`) ou `regra_estadual_na_rota` (`danger`, sem alternativa) |
| ativa, origem/destino a até 300 m do trecho | nenhum | `regra_estadual_origem_destino` (`danger`) |
| ativa, critério não alcança o veículo | nenhum | linha no resumo ("não alcança o seu veículo") |
| `desativada` (confiança baixa, sem verificação ou vigência não confirmada) | nenhum | `regra_estadual_nao_aplicada` (`info`, com o motivo) |
| `revogada` | nunca aplicada nem mostrada | — |

Critério: `peso_acima_t` (PBT **acima** de X t, estrito, como nos atos "superior a"), `eixos_acima`, `caminhoes`, `todos`;
peso e eixos combinam com OU (Lei ES 4.463/1990). Tolerância rota ↔ eixo do SRE: 40 m (o SRE do DER-ES desenha uma linha
só nas pistas duplas), trecho mínimo de 200 m.

## Fontes

### DER-MG — pontos críticos (`rodovias_estaduais_der_mg`)
- URL: `https://observatorio.infraestrutura.mg.gov.br/server/rest/services/00_PUBLICACOES/pontos_criticos_publico/FeatureServer/0`
  (ArcGIS 11.4, consulta anônima, `where status IN ('1','2','3') AND data_conclusao IS NULL`). Cadastro operacional do
  DER-MG/SEINFRA — **não é ato normativo**; por isso o efeito é de interdição física (bloqueio no ponto), não de regra.
- 10/10/2026: 833 registros, **459 ativos** — 1 interrompida (MG-430, Igaratinga, dano em OAE, sem variante), 1
  interrompida para pesados (MG-220, Santo Hipólito, dano em OAE), 4 interrompidas com variante (MG-457, MG-430 em São
  Gonçalo do Pará, LMG-828, LMG-850), 24 meia-pista, 429 livres. Última edição na fonte: 09/10/2026 18:42 UTC.
  `qnt_carga_limite` vazio em 100% (24 com `limite_carga` = Sim).
- Atualização: idempotente (apaga e regrava a source). **Rodar de hora em hora ou ao menos 1×/dia**:
  `docker compose --profile import run --rm importer rodovias_estaduais_der_mg` (cron no host). `DERMG_PC_VALIDADE_H`
  (padrão 72) muda a validade; `DERMG_PC_CACHE_H` (padrão 0,5) o cache da consulta, que é também a idade máxima aceita
  quando o Observatório não responde (cache mais velho = carga falha; o cron deve alertar a falha).
- **Seed sem feições** (`db/seed/layers/rodovias_estaduais__der-mg.sql`): o `migrate` reaplica os seeds a cada subida; um
  seed com os pontos do dia sobrescreveria dados frescos pelos antigos (e numa máquina limpa eles já estariam vencidos).
  O seed só apaga os vencidos e registra a fonte uma vez.
- Não usados: `pontos_criticos_variantes` (9 traçados de variantes; podem entrar como desenho no mapa depois) e
  `prazos_adicionais`.

### DER-ES — restrições de trecho (`rodovias_estaduais_der_es`)
Atos no DIO-ES (busca full-text `https://ioes.dio.es.gov.br/busca`, texto conferido em 10/10/2026). Geometria pelo SRE
do DER-ES (WFS do GEOBASES, `geonode:der_rodovias_es_epsg_31984`, 894 segmentos): segmentos inteiros ou recorte por km
(interpolação ao longo da geometria; o km do SRE é proporcional à extensão desenhada).

| `regra_id` | Trecho | Regra | Ato e artigo | Status | Confiança / verificação |
|---|---|---|---|---|---|
| `es_060_km33_39_23t` | ES-060 (Rodovia do Sol), km 33 (Village do Sol) – km 39 (Setiba), Guarapari | caminhão com PBT > 23 t proibido, 24 h | IS DER-ES nº 003-N, de 23/01/2024, art. 1º (DIO-ES de 24/01/2024, p. 35) | **ativa** | alta: verify vitoria_es confirmed. A pesquisa ders_estaduais só tinha a notícia (verify: unverifiable); o ato foi achado depois e o texto, conferido |
| `es_060_acesso_9020_23t` | ES-060, Acesso 9020 (Village do Sol – ES-388/BR-101, Amarelos), km 0–8,5 | caminhão com PBT > 23 t proibido, 24 h | IS DER-ES nº 002-N, de 23/01/2024, art. 1º (DIO-ES de 24/01/2024, p. 34) | **ativa** | alta (verify vitoria_es). A imprensa chamou o trecho de "ES-477", código que não existe ali |
| `es_060_darly_jones_23t_2023` | ES-060, Darly Santos (Vila Velha) – Rod. Jones dos Santos Neves (Guarapari) | PBT > 23 t | IS DER-ES nº 009-N, de 21/12/2023, art. 1º (DIO-ES de 22/12/2023, p. 96–97), tornada insubsistente pela IS 001-N/2024 | **revogada** | só registro, sem geometria |
| `es_terceira_ponte_is021_2004` | 3ª Ponte, ES-060 (SRE 060EES0010) | 3+ eixos, especiais e perigosos 24 h; 2 eixos até 10 t das 6–10h e 16–22h, até 15 t das 6–22h | IS DERTES nº 021-N, de 21/09/2004, art. 1º (DIO-ES de 27/09/2004) | desativada | média; vigência não confirmada: a ponte é regida hoje pela Lei estadual 9.602/2010, art. 2º (frente vitoria_es) |
| `es_010_aracruz_23t_is009_2008` | ES-010, Portal de Aracruz – trevo de Santa Cruz (≈ km 26,171–40,136) | PBT > 23,0 t | IS DER-ES nº 009-N, de 30/10/2008, item 1 (DIO-ES de 04/11/2008) | desativada | verify: unverifiable (vigência não provada) |
| `es_rodovia_do_sol_lei_4463_1990` | Rodovia do Sol inteira | > 2 eixos ou PBT > 15 t | Lei ES nº 4.463, de 14/11/1990, art. 1º | desativada | verify: unverifiable; sem geometria (evita aviso em toda a Rodovia do Sol) |
| `es_res_ca_0778_2005_aet` | trechos da Res. CRE 4.779/98 (lista não achada) | AET de 45 a 57 t | Res. C.A. DERTES nº 0778/2005, arts. 1º e 2º | desativada | verify: unverifiable; sem geometria |
| `es_164_itapina_12t_2018` | ES-164, BR-259 – Itapina | > 12 t | IS DER-ES nº 002-N, de 09/02/2018, art. 1º | desativada | medida ligada à interdição da BR-259 em 2018 |
| `es_177_km14_interdicao_2018` | ES-177 km 14 (Serra da Aliança) | interdição total | IS DER-ES nº 007-N, de 15/06/2018, art. 1º | desativada | emergência de 2018 sem confirmação |

### DER-ES — pontes com PBT máximo (`oae_der_es`, camada `oae`)
17 Instruções de Serviço de 2024–2026, todas "por tempo indeterminado" e em vigor na publicação (art. 2º). Achadas no
DIO-ES pela pesquisa vitoria_es (`der_es_is_restricoes.csv`) e conferidas de novo em 10/10/2026: texto, número da IS,
página e **nenhum ato posterior que cite a mesma OAE** (a busca pelo código da OAE em 2015–2026 só acha o ato).
Jacarandá, Calçado e Fundão também estão na verify vitoria_es (confiança alta); as demais, média.

| Ponte | PBT máx. | Ato (art. 1º) | Ponto de bloqueio |
|---|---|---|---|
| Córrego Boa Vista — ES-080 km 94 (Santa Teresa) | 8 t | IS 008-N, de 28/08/2026 (DIO-ES 31/08/2026, p. 31) | pista da rodovia (sem ponte no OSM) |
| Rio Mutum Preto — ES-164 km 122,54 (Baixo Guandu) | 12 t | IS 006-N, de 16/04/2025 (DIO-ES 17/04/2025) | ponte do OSM |
| Rio Sobreiro — ES-164 km 161 (Itaguaçu) | 10 t | IS 009-N, de 28/08/2026 (DIO-ES 31/08/2026, p. 31–32) | ponte do OSM |
| Córrego (Baixo Guandu) — ES-165 km 3,75 | 12 t | IS 020-N, de 25/10/2024 (DIO-ES 29/10/2024, p. 34) | km no SRE + ponte do OSM (o ato não dá coordenada) |
| Córrego Santo Amaro — ES-165 km 192,22 (Castelo) | 5 t | IS 021-N, de 25/10/2024 (DIO-ES 29/10/2024, p. 34–35) | km no SRE (165EES0150) + pista da rodovia (estrada de terra sem ponte no OSM; `ES-165/ES-379` a 9 m do km; `km_sre+rodovia_sem_ponte_osm`) |
| Córrego São Pedro — ES-177 km 55,78 | 5 t | IS 022-N, de 25/10/2024 (DIO-ES 29/10/2024, p. 35) | ponte do OSM |
| Rio Fundão — ES-261 km 104 (Fundão) | 16 t | IS 007-N, de 28/08/2026 (DIO-ES 31/08/2026, p. 31; processo E-Docs 2026-XJVWX) | ponte do OSM |
| Córrego Paraju — ES-357 km 8,11 (Itaguaçu) | 10 t | IS 028-N, de 03/12/2024 (DIO-ES 04/12/2024, p. 64) | pista da rodovia |
| Córrego Vargem Grande — ES-379 km 51,7 (Muniz Freire) | 5 t | IS 027-N, de 03/12/2024 (DIO-ES 04/12/2024, p. 64) | ponte do OSM |
| Córrego do Vinagre — ES-387 km 43,5 | 5 t | IS 024-N, de 25/10/2024 (DIO-ES 30/10/2024, p. 28–29) | ponte do OSM |
| Rio Calçado — ES-388 km 2,44 (Guarapari) | 10 t | IS 010-N, de 06/11/2025 (DIO-ES 07/11/2025, p. 37–38) | ponte do OSM |
| Córrego Oriente — ES-391 km 7,13 | 5 t | IS 023-N, de 25/10/2024 (DIO-ES 30/10/2024, p. 28) | ponte do OSM |
| Rio Braço Norte Esquerdo — ES-472 km 35,28 | 5 t | IS 025-N, de 25/10/2024 (DIO-ES 30/10/2024, p. 29) | ponte do OSM |
| Rio Jacarandá — ES-476 km 6,11 (Viana) | 12 t | IS 029-N, de 03/12/2024 (DIO-ES 04/12/2024, p. 64–65) | ponte do OSM |
| Ponte João Fardim Perim — ES-483 (Cachoeiro de Itapemirim) | 15 t ou 10 t por eixo | IS 011-N, de 31/08/2026 (DIO-ES 01/09/2026) | ponte do OSM |
| Córrego Água Fria — ES-484 km 85,37 (Afonso Cláudio) | 10 t | IS 009-N, de 02/09/2025 (DIO-ES 03/09/2025, p. 36) | ponte do OSM |
| Córrego Bom Sucesso — ES-484 km 87 (Afonso Cláudio) | 10 t | IS 008-N, de 02/09/2025 (DIO-ES 03/09/2025, p. 35) | ponte do OSM |

Na camada `oae` cada ponte tem `peso_max_t` (e `eixo_max_t` na ES-483), `restricao` (tipo `peso`, vigente desde a
publicação) e `bloqueio` (círculo de 15 m, ou menos se outra via passar perto do ponto de bloqueio, sobre a aresta
marcada como ponte no OSM mais perto da coordenada do ato — ou do km do SRE, quando o ato não dá coordenada; sem ponte no
OSM, sobre a pista da rodovia: Boa Vista, Paraju e Santo Amaro; `oae_peso_desvio`/`oae_peso_excedido` como as demais
fontes). Todas as 17 têm ponto de bloqueio no grafo (Santo Amaro só avisava antes da revisão de 10/10/2026: o km
192,22 no SRE fica a 9 m da `ES-165/ES-379` do OSM). O limite por eixo (`eixo_max_t`) entrou na regra geral da camada
`oae` (`motivosBloqueio`). O link do ato (`restricao.fonte_url`, também na nota dos avisos) é a busca full-text do DIO-ES
no dia da publicação pelo código da OAE **como está no texto**: no Rio Calçado ele vem colado (`OAE388EES0010-004`; a
busca por `388EES0010-004` não acha nada).

### DER-RJ (`rodovias_estaduais_der_rj`)
**O DER-RJ não publica cadastro de OAE, lista de balanças, portaria de restrição em feriados, malha com km nem painel de
interdições** (pesquisa de 10/10/2026: site do DER-RJ, CKAN `dadosabertos.rj.gov.br` org `der` com 13 datasets
agregados e sem geometria, BC25 do INEA com pontes sem carga nem gabarito). As balanças citadas em postos fiscais da
SEFAZ-RJ (Nhangapi, Levy Gasparian, Morro do Coco) não foram confirmadas (o PDF da SEFAZ bloqueia acesso).
O único caso levantado:

| `regra_id` | Trecho | Regra | Fonte | Status |
|---|---|---|---|---|
| `rj_127_serra_paracambi` | RJ-127, Serra de Paracambi (Paracambi – Mendes) | pesados proibidos na obra; pare e siga só para leves das 5h às 10h e das 17h às 24h | notícias DER-RJ ident. 1019 e 1021 (09/2024) e 1035 (21/07/2025); **sem ato normativo** | desativada (confiança baixa; status em 10/2026 não confirmado) |

Traçado: caminho de carro Paracambi → Mendes no grafo do Valhalla (OSM; aproximação do trecho da serra).

### DER-MG — OAEs (`oae_der_mg`, camada `oae`)
- Cadastro `Hosted/pontes_20_05_2025/FeatureServer/0`: 4.370 OAEs (data de referência 01/03/2024). Inspeção
  `Hosted/Pontes/FeatureServer/0`: 1.456 registros, ligados à OAE do cadastro a até 30 m (1.155 casaram; 299 sem par ficaram
  de fora para não duplicar a ponte).
- Kind: 3.652 pontes (308 inferidas: tipo em branco com curso d'água ou descrição "Ponte..." na inspeção), 8 de madeira,
  252 viadutos (inclui "Viaduto Ferroviário"), 66 passarelas, 7 túneis, 385 outras (esteiras, vertedouros, sem tipo).
- `props`: rodovia (do código SRE: `010EMG...` → MG-010, `CMG` → MGC, `LMG`, `AMG`), `sremg`, `id_cadastro`, `urg`,
  `tipo_original`, `estrutura`, `comprimento_m`, `largura_m`, `curso_dagua` e, quando casou, `condicao` com
  `nota_estrutural` (`condestrut`) e `nota_durabilidade` (`conddurabi`) **crus** (valores 0, 2, 3, 4; **escala não
  documentada pela fonte**, nunca usada para bloquear nem para ordenar), `faixas`, `largura_total_m`,
  `altura_estrutura_m` (altura da estrutura, **não** gabarito) e a descrição.
- Na rota (camada `oae`): entra na contagem de estruturas, no aviso `wooden_bridge` e no novo `oae_ponte_estreita`:
  ponte com largura cadastrada < 5,50 m ou 1 faixa → `info` "não cabem dois caminhões"; se a largura for menor que a
  largura do veículo + 0,60 m → `warn` "confira" (843 pontes com largura < 5,5 m; 235 de uma faixa). 5,50 m é decisão de
  produto (dois caminhões de 2,60 m, Res. CONTRAN 882/2021, art. 4º, I, lado a lado com folga); o DER-MG não diz se a
  largura é a total ou a da pista. **Sem limite de peso nem gabarito publicado: nunca bloqueia.**

## Licenças e riscos

| Fonte | Licença registrada | Risco |
|---|---|---|
| Observatório da Infraestrutura (pontos críticos, OAEs, inspeção) | **não declarada** (`licenseInfo` vazio nos itens). O site do DER-MG ("Aspectos legais") permite reutilizar conteúdo "desde que identificada a fonte e atribuído o crédito" | **uso comercial sem autorização expressa.** Antes de produção, pedir ao DER-MG/SEINFRA termo de uso (ideal CC-BY) ou via LAI. O app cita a fonte em cada aviso e em `GET /api/sources` |
| Observatório — itens com "uso restrito DER-MG" (`Hosted/Balancas_V2`, `Hosted/Ocorrências_significativas`, `Hosted/Cadastro` e outros 20+) | restrita | **não importados** |
| DIO-ES (IS do DER-ES), Lei ES 4.463/1990 | ato oficial, domínio público (Lei 9.610/98, art. 8º, IV) | — |
| SRE do DER-ES (GEOBASES) | "Not Specified" | só localiza os trechos dos atos; atribuição DER-ES/GEOBASES |
| Notícias do DER-RJ | fatos com citação (rodapé PRODERJ "todos os direitos reservados") | só fatos e link |
| OSM (ponto de bloqueio, traçado da RJ-127) | ODbL 1.0 | extração não substancial; nada volta para o OSM |

## Fora desta frente (sobreposição e lacunas)
- **Frente da Grande Vitória (vitoria_es / mun_vitoria)**: o rascunho `regras_rmgv.json` da pesquisa vitoria_es também
  traz a ES-060 km 33–39, o Acesso 9020, a IS 009-N/2023 revogada, a Terceira Ponte (Lei 9.602/2010) e as pontes do
  Jacarandá, Calçado e Fundão. Aqui ficam os atos do **DER-ES** (IS); a Lei 9.602/2010 da 3ª Ponte não foi implementada
  aqui (a IS 021-N/2004 entra desativada). No merge, manter uma implementação só de cada regra para não duplicar
  penalidade e aviso.
- **Portaria DER-MG 4.242/2026** (feriados, com a errata do DOE-MG de 31/03/2026: Semana Santa 05/04, não 06/04) e
  **Portaria DER-MG 4.262/2026** (AET): não implementadas aqui (feriados → `rodovias_horario`/frente de feriados; AET →
  `core_legal`). O SRE-MG 2026_02 do Observatório serve para o escopo "pista simples".
- **Balanças do DER-MG**: não importadas nesta frente. A tabela do site (43 postos) é a lista vigente; para coordenada só
  serve `00_PUBLICACOES/pracas_pesagem/FeatureServer/2` (sem licença; status de 2024) — `Balancas_V2` é de uso restrito.
- **DER-ES**: sem lista de balanças, de interdições atuais nem portaria de feriado (PDA de 07/2024 só com bases
  administrativas). O SRE marca uma "BALANÇA" na ES-060 km 147,786 (Campo Novo), não confirmada.

## Como atualizar
```bash
# pontos críticos: de hora em hora (cron no host)
docker compose --profile import run --rm importer rodovias_estaduais_der_mg
# OAEs do DER-MG (mensal), regras e pontes do ES/RJ (depois de editar data/raw/ders_estaduais/regras.json)
docker compose --profile import run --rm importer oae_der_mg oae_der_es rodovias_estaduais_der_es rodovias_estaduais_der_rj
```
- Curadoria: cada regra precisa citar ato e artigo/item; `ativa: true` só com `status: vigente` e confiança alta ou média;
  `ativa: false` exige `motivo_inativa`; revogada fica `status: revogada`. O importador recusa a carga se algo falhar.
- Para ativar uma regra desativada (ex.: IS 009-N/2008 da ES-010), confirmar a vigência no portal de Instruções de
  Serviço do DER-ES (`portalservicos.der.es.gov.br/IS/Index`, campo Situação) ou no DIO-ES e registrar em `verificacao`.
- Pontes do ES: buscar novas IS no DIO-ES por `"PROIBIR, por tempo indeterminado"` e `"LIBERAR o tráfego"`; incluir/
  remover em `regras.json` e rodar `oae_der_es`. `oae__der-es.sql` depende do grafo do Valhalla (ponto de bloqueio).

## Testes
- `api/test/layers/rodovias_estaduais.test.ts` (API em `API_URL`): regras sem rota (pesados × VUC — inclusive "VUC" de
  14 t — e utilitário, interrompida, variante, meia-pista, limite com e sem valor, ponto inativo, critério de trecho
  estrito e com OU); **ponto crítico de teste "pista interrompida para pesados" no meio de uma rota Lagoa Santa → Pedro
  Leopoldo (LMG-800): carreta e VUC desviam; utilitário (3,5 t) passa com `pc_pesados_liberado`; destino no próprio ponto
  passa com `pc_origem_destino`; destino ~300 m adiante, na aresta seguinte, continua desviando**; nas exclusões, destino
  ~100 m adiante na mesma aresta de 535 m (fora do círculo) é isento pelo `/locate` e o de ~300 m não; ponto vencido não
  gera exclusão; ES-060 km 33–39 (carreta desviada, toco passa); ponte do Rio Jacarandá (toco desvia, VUC passa); RJ-127
  só informa.
- `importers/tests/test_ders_estaduais.py`: situação (`trafeg_variante` × `trafegabilidade`), códigos de rodovia, tipo de
  OAE, recorte por km, validação da curadoria (confiança baixa/revogada nunca ativa; ato sem artigo é recusado), cache
  vencido da fonte viva faz a carga falhar (e o válido data `valid_to` pelo download), raio medido a partir do ponto de
  bloqueio e ponte por km do SRE sem ponte no OSM caindo no snap da rodovia.

## Limitações
- Ponto crítico sem extensão: o bloqueio é um círculo de até 20 m no ponto; se a interrupção real for mais longa, o
  círculo ainda corta a via (a aresta inteira sai do grafo). Ponto que não casou com via (ajuste `ponto_original`) bloqueia
  no ponto da fonte.
- Endereço numa aresta cortada pelo círculo, mas fora dele, fica isento (só aviso) mesmo que a outra ponta da aresta seja
  alcançável pelo desvio: o `exclude_polygons` tira a aresta inteira e o Valhalla não chegaria ao endereço. Na MG-430 em
  Igaratinga, isso vale para os 141 m da aresta da rodovia que encosta na cabeceira leste da ponte.
- Variante: o traçado (camada `pontos_criticos_variantes`) não é usado; "com variante" só avisa.
- Regras de trecho por sentido não existem no ES (os atos valem nos dois sentidos).
- O km do SRE é interpolado na geometria (erro típico < 1%); o Portal de Aracruz (ES-010) é aproximado.
