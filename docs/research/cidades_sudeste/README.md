# Pesquisa cidade por cidade — Sudeste (concluída em 11/10/2026)

Rascunhos de regras municipais de circulação de caminhões, um arquivo por município em `res/<ibge>.json`, no formato de `data/raw/municipios/schema.json` (sem geometria). **Ainda não estão no app**: falta gerar geometria e validar no Valhalla (ver "Como continuar").

## Situação

- Todos os municípios do Sudeste fora do app têm resultado: **1.633** em `res/` (o CSV de insumo lista 1.667; o 1.668º, 3200102, também foi pesquisado). Já no app antes desta pesquisa: 34 + capital paulista.
- Todas as cidades com regra "ativa" passaram pelo verificador independente (`verif/`): **132 cidades, 187 regras ativas** (SP 75, MG 42, RJ 12, ES 3). Vereditos: 98 confirmadas, 31 corrigidas, 3 inverificáveis daqui (Conselheiro Lafaiete, Magé, Jaú — ato não abriu; regra mantida, conferir de outra rede).
- Por status: não achou 1.317; regra com ato 161; pontual 65; sem restrição declarada 35; pista 35; regra sem ato 19; confirmou que não tem 1.
- Por nível de busca: varredura consolidada 850 (só pistas em massa, cidades pequenas sem nenhum indício), dirigida 385, média 252, profunda 146.
- **280 cidades com `falha_de_fonte`** (SP 126, MG 103, ES 28, RJ 23): o portal principal estava fora do ar ou bloqueado (Cloudflare no leismunicipais, reCAPTCHA no CESPRO, sites de prefeitura sem resposta pelo proxy da nuvem). O "não achou" delas não é conclusivo — lista em `falhas_de_fonte.json`.
- **2ª rodada (14/10/2026)** nas 280 com `falha_de_fonte`, com Sonnet (pesquisa + verificação no mesmo agente) e um coordenador Opus para a triagem: 61 seguiam bloqueadas e ficaram só anotadas (`r2_triagem.json`); 219 foram pesquisadas em 18 lotes. Resultado: **`falha_de_fonte` caiu de 280 para 175**; **19 cidades com regra ativa nova ou reconfirmada, todas verificadas** (Águas de Santa Bárbara, Arandu, Bernardino de Campos, Cajuru, Cananéia, Capão Bonito, Caraguatatuba, Casa Branca, Ilhabela, Jacupiranga, Nazaré Paulista, Pedreira, Pontal e São Simão em SP; Cordislândia, Machado, Ouro Branco e Serro em MG; Tanguá no RJ). Piranga (MG) foi **rebaixada**: o decreto vale "até haver desvio" e a área urbana não é delimitada. Pistas para consulta manual: São Sebastião (Dec. 9.635/2025), Santo Antônio de Posse (Lei 2.095/2005), Capivari (Lei 4.738/2015), Paraopeba, Santa Rita de Caldas, Vespasiano, Oratórios, Tremembé, Aguaí, Muzambinho (PDFs escaneados) e Oliveira.
- Agora: regra com ato 181; pontual 70; pista 40; não achou 1.287; 159 verificações.
- Totais por UF, tabela completa das cidades com regra e vereditos: **`RESUMO.md`**.

## Arquivos

- `res/<ibge>.json`: resultado por município (status, nível de busca, fontes consultadas, regras em rascunho, divergências do OSM).
- `verif/<ibge>.json`: verificação independente (só as que já rodaram).
- `leads/`: pistas em massa (Querido Diário, diários consolidados MG/ES, penaestrada, mapa de portais de legislação por município) e scripts de coleta. Os HTML/PDF brutos e os atos baixados (≈10 GB) ficaram fora do git; as URLs estão nos JSON.
- `toolkit/`: clientes de busca reutilizáveis (`legislacao.py`, `diarios_consolidados.py`; ver `toolkit/README.md`).
- `fila/`, `triagem_r1.json`, `fila_r1_resumo.json`: triagem e lotes da 1ª onda (rodada em 11/10/2026).
- `GUIA.md`: guia de fontes por UF/sistema montado pelo orquestrador.
- `lotes.json`, `tiers.json`, `prioridade.json`, `municipios_sudeste.csv`, `osm_hints_por_municipio.json`, `qd_cities.json`: insumos.
- `CONVENCOES_IMPLEMENTACAO.md`: regras combinadas (regra ativa só com ato vigente conferido; cidades sem regra vão para `data/raw/municipios/_varredura.json`; divergência do OSM vira pendência em `data/osm-overrides/overrides.json`; Valhalla com no máximo ~4 rotas simultâneas).
- `RESUMO.md`, `varredura_final.json`, `falhas_de_fonte.json`: consolidação gerada por `workflow/consolidar.py` (totais, tabela das cidades com regra, cidades sem regra no formato da varredura, e as 280 cidades com fonte fora do ar).
- `workflow/sudeste-cidades-fechamento.js`: workflow da 1ª onda + verificação (11/10/2026); pula cidades com `res/`.
- `workflow/sudeste-cidades-orquestrado.js`: o workflow (preparação → orquestrador → ondas → verificação → fechamento). Para rodar de outro lugar, troque `args.ns` para uma pasta onde exista `cidades/` com estes arquivos (ex.: copie `docs/research/cidades_sudeste/*` para `<ns>/cidades/`).

## Como continuar

1. Implementar: para cada cidade com regra ativa verificada (ver `RESUMO.md`), gerar `data/raw/municipios/<ibge>.json` (+ geometria em `data/raw/municipios/geo/`), seguindo `docs/layers/restricoes_municipais.md`; validar no Valhalla local em lotes pequenos; gerar `data/raw/municipios/_varredura.json` a partir de `varredura_final.json`.
2. Rodar a suíte inteira (`./scripts/run-tests.sh`) — requer o ambiente Docker local (Postgres + Valhalla com os tiles do Sudeste).
3. 2ª rodada (opcional) só nas 280 de `falhas_de_fonte.json`, de outra rede (Mac): lotes prontos em `fila_r2.json` (25 lotes de até 12 cidades, agrupados por UF e sistema de legislação) e workflow em `workflow/sudeste-cidades-r2.js` (Sonnet). No Claude Code do Mac: "use um workflow: rode docs/research/cidades_sudeste/workflow/sudeste-cidades-r2.js com args {repo: '<caminho absoluto do repo>'}; depois rode workflow/consolidar.py, commite e dê push". Também conferir as 3 inverificáveis.
4. Pendências de OSM: o Overpass falhou durante a onda; as divergências ficaram registradas em `osm_divergencias` de cada `res/` sem conferência.
