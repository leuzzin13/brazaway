# Camadas de dados — como adicionar uma fonte

Cada fonte de dados de terceiros entra no app como uma **camada**, em três peças independentes:

1. **Importador** `importers/sources/<nome>.py` — baixa a fonte pública e devolve feições normalizadas
   (`LAYER_ID`, `SOURCE`, `SOURCE_URL`, `LICENSE`, `fetch()`). Ver `importers/common.py`.
   Rodar: `docker compose --profile import run --rm importer <nome>` (ou `all`).
   Importador opcional que depende de credencial declara `REQUIRES_ENV = ('VAR',)`: em `all`, sem a variável, ele é
   pulado (não conta como falha nem mexe no banco); pelo nome, roda e falha com a mensagem dele (ex.: `mapillary_placas`).
   O runner grava em `data_features` + `data_layer_runs` e gera o seed `db/seed/layers/<layer>__<source>.sql`,
   aplicado automaticamente pelo `migrate` numa máquina limpa.
2. **Módulo da API** `api/src/layers/<id>.layer.ts` — exporta `default` um `RouteLayer` (ver `types.ts`).
   É carregado automaticamente (sem registro manual). Pode:
   - `exclusions(ctx)` → polígonos em `exclude_polygons` (bloqueio duro; afeta também ruas que cruzam);
   - `costLines(ctx)` → trechos em `linear_cost_factors` (penaliza só a via, não as travessias);
   - `annotate(ctx, route)` → avisos, linhas de resumo e dados próprios no resultado da rota;
   - `features(bbox, {zoom})` → GeoJSON para o mapa.
3. **Testes** `api/test/layers/<id>.test.ts` contra o ambiente local.

O front lista as camadas em `GET /api/layers`, desenha cada uma pelo `meta.style` e mostra
`summary`/`warnings` no resultado da rota, sem código específico por camada.

**Licenças:** dados de terceiros ficam em `data_features`, separados do OSM (ODbL) e dos reportes.
Toda carga registra fonte, URL e licença em `data_layer_runs` (`GET /api/sources`).
