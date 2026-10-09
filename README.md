# Rota Caminhão — "Waze para caminhões" (MVP)

Roteamento para caminhões no Brasil que respeita **altura, largura, comprimento, peso e
restrições de circulação** do veículo, com uma camada colaborativa onde motoristas reportam
restrições (viaduto baixo, ponte com limite de peso, rua proibida…) e confirmam/negam reportes
de outros. Região-piloto: **Grande São Paulo**, pronto para o Brasil inteiro trocando uma
variável de ambiente.

## Subir tudo

Pré-requisito: Docker com Compose v2 (Docker Desktop, OrbStack ou Colima).

```bash
cp .env.example .env
docker compose up -d --build
```

| Serviço | URL | O que é |
|---|---|---|
| Front | http://localhost:8080 | React + Vite + MapLibre (tiles OpenFreeMap) |
| API | http://localhost:3000/api/health | TypeScript + Fastify |
| Valhalla | http://localhost:8002/status | Roteamento, costing `truck` |
| Postgres/PostGIS | localhost:5432 (`truck`/`truck`) | Reportes e zonas (schema compatível com Supabase) |

### Primeiro build dos tiles do Valhalla (importante)

Na primeira subida o container `valhalla` baixa o extrato `sudeste-latest.osm.pbf` da
Geofabrik (~700 MB) e constrói os tiles. **Enquanto isso a API responde `/api/health`
com `valhalla:false` e `/api/route` falha**; o front sobe normalmente.

| Região | PBF | RAM mínima p/ build | Tempo típico (8 vCPU) | Disco |
|---|---|---|---|---|
| Sudeste (default) | ~860 MB | **8 GB** livres para o Docker | ~15 min de build + download (medido: 14 min em M4 Pro, 8 vCPU, 14 GB na VM) | ~3 GB (tiles 1,2 GB + tar 1,2 GB + PBF) |
| Brasil inteiro | ~1,8 GB | **16 GB** | 1,5–3 h | ~15 GB |

Acompanhe com `docker compose logs -f valhalla`. Os tiles ficam em `data/valhalla/` e são
reaproveitados nas próximas subidas (segundos). Para forçar rebuild: apague `data/valhalla/*`.

> Colima/Docker Desktop: dê memória suficiente à VM (ex.: `colima start --memory 12`).

### Trocar a região (Brasil inteiro)

No `.env`:

```
OSM_PBF_URL=https://download.geofabrik.de/south-america/brazil-latest.osm.pbf
```

Apague `data/valhalla/*` e suba de novo. Nada mais muda: reportes e zonas são por coordenada.
Para outras cidades, basta importar as zonas de restrição delas em `restriction_zones`.

## Arquitetura

```
 celular/browser ──► web (nginx, React+MapLibre) ──/api──► api (Fastify)
                                                             ├──► valhalla  (OSM, costing truck, exclude_polygons)
                                                             └──► postgis   (reports, report_votes, restriction_zones)
```

Fluxo de `POST /api/route`:

1. Resolve o perfil do veículo (preset de `config/vehicle-presets.json` + campos editados).
2. Busca no PostGIS as **zonas de restrição** ativas e aplica a regra ao **horário de saída**
   (dias/horários/exceção VUC/rodízio por final de placa). Zona que vale para o veículo vira
   `exclude_polygon`; se origem ou destino estiver dentro dela, não exclui e devolve aviso.
3. Busca os **reportes ativos que bloqueiam ESTE veículo** (`active_reports_for_vehicle`,
   em `db/migrations/0004_functions.sql`): viaduto 3,80 m bloqueia caminhão de 4,10 m mas não
   VUC de 3,20 m; ponte 20 t bloqueia carreta de 41,5 t etc. Cada um vira um buffer de
   `REPORT_BUFFER_M` (25 m) em `exclude_polygons`.
4. Chama o Valhalla (`costing: truck`, `costing_options.truck.{height,width,length,weight,
   axle_load,axle_count,hazmat}`, `date_time.type=1`).
5. Calcula também a rota **sem** exclusões para listar o que foi efetivamente **evitado**,
   e varre reportes perto da rota para os **avisos** ("rota passa a 50 m de reporte não confirmado").
6. Busca os **pontos de descanso** a até 500 m da rota (`rest_stops`, derivados do OSM) e monta o
   **plano de direção** da Lei 13.103 (`driving_plan`): parada de 30 min a cada 5h30 de direção,
   sugerindo o ponto de descanso mais próximo antes do limite, e alerta ao passar de 8h (ou 10h com
   prorrogação). O ETA de cada ponto é proporcional à distância ao longo da rota (aproximação).
7. Sem rota viável: `409 NO_ROUTE` com `blocked_by` dizendo quais restrições bloquearam.

### Licença ODbL (OpenStreetMap)

Os reportes colaborativos ficam **sempre** numa base separada (PostGIS) e são aplicados só na
hora do cálculo, como `exclude_polygons`. **Nunca** são escritos de volta nos dados OSM nem
misturados aos tiles do Valhalla. Atribuição "© OpenStreetMap contributors" visível no mapa.

### Pastas

```
config/           presets de veículo e regra da ZMRC (editáveis, "confirmar")
valhalla/         Dockerfile sobre ghcr.io/valhalla/valhalla-scripted + wrapper de entrypoint
db/migrations/    schema + funções (idempotentes)      db/seed/   5 reportes em SP + zonas
data/raw/         ZMRC e Mini-Anel (GeoSampa WFS)       data/import/  reimportação via ogr2ogr
api/              Fastify (src/routes, src/services)     api/test/   vitest contra o ambiente local
web/              React + Vite + MapLibre
```

## API

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/health` | status de db e valhalla |
| `GET` | `/api/vehicles/presets` | presets (valores aproximados, confirmar) |
| `POST` | `/api/route` | `{origin:{lat,lon}, destination:{lat,lon}, departure_at:"YYYY-MM-DDTHH:mm", vehicle:{preset, height_m, width_m, length_m, weight_t, axle_load_t, axle_count, hazmat, is_vuc, plate_last_digit}}` → `{geometry, distance_km, duration_s, avoided[], warnings[]}` ou `409 {error:"NO_ROUTE", blocked_by[]}` |
| `GET` | `/api/reports?bbox=minLon,minLat,maxLon,maxLat` | reportes ativos |
| `POST` | `/api/reports` | `{type, geometry(Point|LineString), value_num?, time_window?, note?, device_id}` |
| `POST` | `/api/reports/:id/votes` | `{device_id, vote: 1|-1}` |
| `DELETE` | `/api/reports/:id?device_id=` | remove reporte próprio |
| `GET` | `/api/zones` | FeatureCollection das zonas de restrição |
| `GET` | `/api/rest-stops?bbox=` | pontos de descanso/apoio (OSM) |
| `GET` | `/api/geocode?q=` | Photon (público) atrás da interface `Geocoder` |

Tipos de reporte: `low_clearance` (m), `weight_limit` (t), `length_limit` (m), `truck_ban`,
`hazmat_ban`, `road_closed`, `steep_grade` (t = peso máx. que vence a subida).

Regras: reporte afeta a rota com `score >= 0`; `score < -2` desativa; `road_closed` expira em
24 h sem confirmação. Sem login: `device_id` anônimo gerado no navegador (localStorage).

## Pontos de descanso (Lei 13.103)

`rest_stops` recebe no seed 101 pontos da Grande SP (áreas de descanso, áreas de serviço/postos
nomeados, estacionamentos de caminhão) extraídos do OpenStreetMap via Overpass por
`scripts/fetch-rest-stops.py` (gera `data/raw/rest_stops.geojson` e `db/seed/0003_rest_stops.sql`).
Regras de referência em `api/src/services/restStops.ts` (**confirmar**): 5h30 de direção contínua →
30 min de descanso; 8h/dia, +2h de prorrogação.

## Zonas de restrição por horário

- `restriction_zones` recebe no seed a **ZMRC** (Zona Máxima de Restrição a Caminhões) e o
  **Mini-Anel do rodízio**, baixados automaticamente do WFS público do GeoSampa
  (`data/raw/README.md` tem o passo a passo manual e `docker compose --profile import run --rm gdal`
  reimporta com `ogr2ogr`).
- Regra inicial da ZMRC em `config/zmrc-rules.json` — **confirmar com a CET**: caminhões
  proibidos seg–sex 05:00–21:00 e sáb 10:00–14:00; VUC liberado.
- Rodízio (Mini-Anel) — **confirmar com a CET**: seg–sex 07–10h e 17–20h por final de placa
  (seg 1-2, ter 3-4, qua 5-6, qui 7-8, sex 9-0). Só se aplica se `plate_last_digit` for informado.
- **Limitação do MVP:** a regra usa só o **horário de saída**; não calculamos a hora em que a
  rota entra na zona. Uma viagem que sai 20h30 e chega à ZMRC 21h10 ainda é tratada como proibida.

## Testes automatizados

Contra o ambiente local, depois do `docker compose up` (espera o Valhalla ficar pronto):

```bash
./scripts/run-tests.sh
```

Cobrem: viaduto 3,80 m (caminhão 4,10 m desvia, VUC 3,20 m passa); ZMRC (carreta 10h de
terça desvia, 22h passa, VUC passa sempre, origem dentro da zona gera aviso); score -3 não afeta
a rota. Os testes criam seus próprios reportes (`device_id` de teste) e os apagam ao final.

## Migrar o banco para o Supabase

O schema usa só Postgres + PostGIS + `pgcrypto` (`gen_random_uuid`), todos disponíveis no Supabase.

1. No projeto Supabase: *Database > Extensions* → habilite `postgis`.
2. Rode, em ordem, `db/migrations/*.sql` e `db/seed/*.sql` no SQL Editor (ou
   `psql "$SUPABASE_DB_URL" -f ...`). São idempotentes.
3. No `.env`, aponte `DATABASE_URL` para a connection string do Supabase (use a porta 6543 do
   pooler em modo *session* ou a 5432 direta) e `docker compose up -d api`.
4. Como a API acessa via `pg` direto, RLS não interfere; se for expor as tabelas pelo PostgREST,
   crie políticas (ex.: leitura pública de `reports` ativos, escrita só via API).

## TODO / fora do escopo

- Importação de dados do **DNIT** (SNV, pontes e limites de peso em rodovias federais): TODO.
- Navegação curva a curva, trânsito em tempo real, login/contas, app nativo, pagamentos.
- ETA de entrada na zona (hoje só horário de saída).
- Detecção automática de subidas por elevação (`build_elevation=True` no Valhalla; aumenta muito o build).
- Pontos de descanso: hoje só Grande SP via `scripts/fetch-rest-stops.py` (Overpass). Para o Brasil
  inteiro, rodar o script com `--bbox` por região ou extrair do PBF com osmium.
- Subida que o caminhão não vence: hoje só por reporte (`steep_grade`); detecção automática é TODO.

## Referências

- Valhalla: https://valhalla.github.io/valhalla/api/route/api-reference/ (costing `truck`, `exclude_polygons`, `date_time`)
- Imagem Docker oficial: `ghcr.io/valhalla/valhalla-scripted` (https://github.com/valhalla/valhalla/tree/master/docker)
- Geofabrik: https://download.geofabrik.de/south-america/brazil.html
- GeoSampa WFS: https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs
- OpenFreeMap: https://openfreemap.org · Photon: https://photon.komoot.io
