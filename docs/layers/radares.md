# Camada `radares` — radares de velocidade (OSM) e reportes de radar móvel e blitz

**Radar não é restrição.** Nada aqui bloqueia, desvia ou encarece trecho: a camada só **avisa** (`annotate`). A rota
sai com a mesma geometria com ou sem radares.

| Peça | Arquivo |
|---|---|
| Importador | `importers/sources/radares_osm.py` → seed `db/seed/layers/radares__osm.sql` (3,2 MB) |
| API (camada) | `api/src/layers/radares.layer.ts` (`annotate`, `features`; sem `exclusions`/`costLines`) |
| API (reportes) | `api/src/services/restrictions.ts` (`crowdAlertsInBbox`), `api/src/services/routing.ts` (passo 5b), `api/src/routes/reports.ts` |
| Migration | `db/migrations/0400_reports_radar_blitz.sql` |
| Testes | `api/test/layers/radares.test.ts` e `api/test/layers/reports_radar_blitz.test.ts` |

## 1. Radares fixos (OpenStreetMap)

### Fonte e licença
- **OpenStreetMap**, extrato Geofabrik Sudeste (`data/valhalla/sudeste-latest.osm.pbf`, o mesmo do Valhalla; replicação
  2026-10-08). Licença **ODbL 1.0 — © colaboradores do OpenStreetMap**. Fica em `data_features`
  (`layer_id='radares'`, `source='osm'`), registrado em `data_layer_runs`. Nada volta para o OSM.
- Contagem (PBF de 2026-10-08): **5.176 radares**. 5.155 nós `highway=speed_camera` (13 com `fake=yes` ficam de fora) +
  21 dispositivos de relações `type=enforcement` + `enforcement=maxspeed` que não eram nós `speed_camera`. As outras 65
  relações enriquecem nós já existentes. 4.484 têm limite (`maxspeed`); 814 têm direção resolvida.

### O que o importador grava
`props`: `maxspeed_kmh`, `maxspeed_hgv_kmh` (`maxspeed:hgv`, quando existe), `direction_deg`, `direction_raw`,
`direction_kind`, `ref`, `label` (tag `name`), `via` e `highway` da via em que o nó está, `osm_node`, `osm_url`,
`osm_relation`, `camera_type`. Nome: `Radar 60 km/h — <name/ref ou via>`.

Direção (`direction_deg` = rumo, 0–360, do tráfego fiscalizado; `null` = vale para os dois sentidos ou não informada):

| No OSM | Vira |
|---|---|
| número 0–360 (`direction=325`) ou ponto cardeal (`N`, `SE`, `north`...) | o próprio rumo |
| `forward` / `backward` | rumo do trecho da via no nó (e o oposto); no cruzamento vale a via de maior hierarquia |
| `both`, vazio, texto desconhecido | `null` |
| relação `enforcement` com `from` nó | rumo de `from` até o `device` |
| relação `enforcement` com `from` via | sentido da via que chega ao `device` |

A relação só preenche a direção quando o nó não tem uma. `maxspeed` que não é número (`BR:urban`, `signals`) ou fora de
5–130 km/h é descartado.

### Como entra na rota (`layers.radares`)
`annotate` pega os radares a até **30 m** da geometria da rota (PostGIS, `featuresNearRoute`). Se o radar tem
`direction_deg`, compara com o rumo local da rota (janela de 20 m para cada lado do ponto mais próximo): só vale se a
diferença for de **até 60 graus**; o radar da pista contrária é descartado (contado em `descartados_por_direcao`). Sem
direção, avisa nos dois sentidos.

- `warnings`: **um** aviso `radar_na_rota` (`info`) com os primeiros 8 radares (km e limite) e "e mais N";
  `lat/lon` do primeiro. Sem radar, nenhum aviso.
- `summary`: "N radares fixos na rota; o primeiro no km X".
- `data`: `{ total, descartados_por_direcao, raio_m, tolerancia_direcao_graus, radares: [...] }`, cada radar com `id`,
  `nome`, `km_desde_origem`, `distancia_rota_m`, `limite_kmh`, `limite_caminhao_kmh`, `limite_aplicavel_kmh` (usa o
  `maxspeed:hgv` quando o veículo é caminhão e ele existe), `direcao_graus`, `rumo_rota_graus`, `direcao`
  (`confere`/`sem_direcao`), `via`, `ref`, `lat`, `lon`, `osm`.
- `GET /api/layers/radares/features?bbox=&zoom=` (zoom ≥ 9): pontos com `limite_kmh`, `limite_caminhao_kmh`,
  `direcao_graus`, `sentido`, `via`, `ref`.

Limites: radar móvel ou recém-instalado não está no OSM; o mapa pode estar desatualizado (a mensagem diz isso). O
`maxspeed` do OSM é o limite da via naquele ponto, não uma garantia legal.

### Como atualizar
```bash
docker compose --profile import run --rm importer radares_osm      # usa data/valhalla/*.osm.pbf (ou OSM_PBF=)
```
~2 min para o Sudeste. Grava `data_features` + `data_layer_runs` e regenera o seed.

## 2. Reportes da comunidade: `radar_movel` e `blitz`

Entram na mesma tabela `reports` dos demais tipos (base separada do OSM), com `POST /api/reports`
`{type: "radar_movel"|"blitz", geometry, note?, device_id}`. **Sem `value_num`** (o valor enviado é ignorado; o banco
recusa se vier). Votos iguais aos dos outros tipos (`POST /api/reports/:id/votes`).

| Regra | Valor |
|---|---|
| Efeito na rota | **nenhum** no traçado. Nunca viram `exclude_polygon` nem `avoided`; `active_reports_for_vehicle()` não os devolve |
| Aviso | `radar_movel_reportado` / `blitz_reportada` (`info`), um por reporte a até `WARN_RADIUS_M` (100 m) da rota. Texto: idade ("há 25 min"), confirmações, negações, distância e km. Traz `report_id`, `lat`, `lon`. Não repete no aviso genérico `near_report` |
| Expiração | **2 h** depois do último voto positivo ou, sem confirmação, da criação. Cada +1 renova as 2 h; -1 não renova. Vira `status='expired'` (some de `GET /api/reports`). Valor em `report_ttl_hours()` na migration 0400 |
| Desativação | `score < -2` (4 negações líquidas) → `disabled`, como os demais; volta a `active` se o score subir a -2 ou mais |
| `expires_at` | calculado em `GET /api/reports` e `/:id` (null nos outros tipos) |

A expiração roda na leitura (`expire_stale_reports()` = `road_closed` 24 h + radar/blitz 2 h), sem cron, na listagem,
no detalhe e no cálculo da rota. Tipos que não são radar/blitz seguem as regras anteriores (`road_closed` expira em 24 h
sem confirmação; os de medida não expiram).

### Mapa (web)
`web/src/lib/api.ts` (`REPORT_TYPES`) tem os dois tipos novos (📷 radar móvel, 🚓 blitz), com o rótulo "expira em 2 h".
