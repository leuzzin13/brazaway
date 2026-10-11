# Convenções combinadas com a outra sessão (10/10/2026) para implementar o Sudeste
1. Restrições municipais: estender a camada existente restricoes_rmsp (api/src/layers/restricoes_rmsp.layer.ts, importers rmsp_*, data/raw/rmsp/regras.json) para camada genérica por município (código IBGE). Nada de camada por cidade.
2. Feriados estaduais/municipais: tabela holidays (scope state/municipal, uf, ibge_code) + importador feriados_sp como modelo; calendar.ts já filtra por uf/ibge.
3. Pedágio/balanças: novas fontes como importadores toll_*/weigh_* das camadas pedagio/balancas (source diferente), sem camada nova.
4. Segurança: novas fontes nas camadas acidentes/roubo_carga (mesmo esquema de agregação por célula).
5. Perigosos: trechos novos na camada perigosos (hazmat_trechos_*).
6. O PBF do Valhalla é só o Sudeste; tudo dentro dele roteia.
Ambiente: suíte completa ~30 min e pesa no Valhalla (8 threads); não rodar suítes inteiras em paralelo. Merge na main: só a outra sessão.

# Regras adicionais para a pesquisa cidade por cidade (combinadas em 10/10/2026)
- Valhalla 8002: no máximo ~4 pedidos de rota simultâneos (API principal também usa). NÃO usar /trace_route com map_snap em linha longa (já prendeu thread 15 min). Avisar a outra sessão antes de cada validação de lote e ao terminar.
- Regra ATIVA só com ato primário vigente com número, artigo e URL/página, conferido pelo verificador. Indício só do OSM ou de notícia → regra DESATIVADA com motivo.
- Registrar também as cidades varridas SEM regra encontrada em data/raw/municipios/_varredura.json (ibge, nível da busca, fontes consultadas, data), para não repesquisar.
- Tag do OSM que contradiz ato vigente: NÃO corrigir na camada; mandar o caso para a outra sessão registrar em data/osm-overrides/overrides.json como pendente (ativação só com prova e decisão do Arthur).
- Merges: mandar vários lotes por vez; seeds por lote pequenos (geometria só das vias da regra).
