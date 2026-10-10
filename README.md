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
> **Apple Silicon:** o Postgres usa imagem própria (`db/Dockerfile`, Postgres 16 oficial + PostGIS), nativa em arm64 e
> amd64. A `postgis/postgis` só publica amd64 e, emulada, derrubava o banco. Antes de adotar qualquer imagem nova,
> confira a arquitetura (`docker image inspect <imagem> --format '{{.Architecture}}'`). O Valhalla está fixado pela
> digest em `valhalla/Dockerfile`.
>
> **macOS:** não deixe o projeto em Downloads, Documentos ou Mesa. Essas pastas são protegidas e o Docker e o
> Claude Code perdem o acesso a elas. Use uma pasta comum, como `~/Projetos/truck-router`.

### Dados que o `docker compose up` já carrega

Todas as camadas de dados públicos têm seed versionado em `db/seed/layers/` (o serviço `migrate` aplica):
pontes/viadutos, VER, ZMRC, rodízio, perigosos, pedágio, balanças, acidentes, roubo de carga, feriados, SIAET,
restrições dos municípios da Grande SP etc. Para **atualizar** a partir das fontes:

```bash
docker compose --profile import run --rm importer --list   # importadores disponíveis
docker compose --profile import run --rm importer all       # todos (minutos; alguns baixam centenas de MB)
```

### Dados pesados (opcionais, fora do git)

| O quê | Comando | Tempo / disco | Sem isso |
|---|---|---|---|
| **Geocodificação própria** (CNEFE 2022 do IBGE + CEPs + GeoSampa) | ver `docs/layers/geocoding.md` (`cnefe_municipios`, `cnefe_enderecos --no-seed`, `cep_ipea --no-seed`, `geosampa_logradouro --no-seed`) | ~25 min, ~750 MB no banco | `/api/geocode` cai no Photon público (impreciso para endereço com número) |
| **Relevo** (ANADEM, CC BY 4.0) nos tiles do Valhalla | `./scripts/build-elevation.sh` e depois a troca descrita em `docs/layers/relevo.md` | ~6 min + 6,3 GB de download, ~5,5 GB em disco | a camada de relevo não anota rampas |

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

Dados de terceiros entram como **camadas** (`api/src/layers/*.layer.ts`, carregadas automaticamente; contrato em
`docs/LAYERS.md`). Cada camada pode bloquear trechos (`exclude_polygons`), penalizar só a via (`linear_cost_factors`,
sem afetar as ruas que cruzam), anotar a rota (avisos, resumo, dados) e desenhar no mapa. Os dados ficam na
tabela `data_features`, separada do OSM e dos reportes, com fonte e licença registradas em `data_layer_runs`
(`GET /api/sources`).

### Camadas de dados

<!-- camadas:inicio -->
| Camada | Grupo | Efeito na rota | Registros | Fontes (licença) | Doc |
|---|---|---|---|---|---|
| Faixas e corredores de ônibus | Restrições | desvia | 1.455 | GeoSampa faixa_onibus (levantamento CET/PMSP) (CC-BY-SA 4.0); GeoSampa corredor_onibus (SPTrans/EMTU) (CC-BY-SA 4.0); OpenStreetMap (props.osm: traçado das faixas casado com a malha do Valhalla, usado só na penalidade opcional) (ODbL 1.0) | [corredores_onibus](docs/layers/corredores_onibus.md) |
| Limitadores de altura (OSM) | Restrições | desvia | 216 | OpenStreetMap — nós com maxheight/maxwidth/maxweight e barrier=height_restrictor (ODbL 1.0 — © colaboradores do OpenStreetMap) | [altura_osm](docs/layers/altura_osm.md) |
| Placas de restrição (DER-SP) | Restrições | avisa | 584 | DER-SP Sinalização Vertical (CC-BY-4.0) | [placas_restricao](docs/layers/placas_restricao.md) |
| Produtos perigosos | Restrições | desvia | 2.604 | Portaria SMT.GAB 051/2024 (PMSP/CET) (Ato oficial (Lei 9.610/98 art. 8º IV)); Portarias PR/DER-164/2025 e SUP/DER-062/2024 (DOE-SP) (Ato oficial (Lei 9.610/98 art. 8º IV)); Relação de Produtos Perigosos (Res. ANTT 5.998/2022) (Ato oficial (Lei 9.610/98 art. 8º IV)); CETESB Malha Rodoviária Estadual (km) (Não declarada (atribuição)); CETESB Emergências Químicas (DataGEO) (Não declarada (atribuição)); APRM — limites de bacia (DataGEO/SIMA) (Não declarada (atribuição)); ARTESP — paradas de produtos perigosos (CC-BY); IBGE — malha municipal (LETPP) (Dados públicos (citar a fonte)); OpenStreetMap (traçado das vias, via Valhalla) (ODbL) | [perigosos](docs/layers/perigosos.md) |
| Restrições de horário em rodovias | Restrições | desvia | 855 | PRF — Portaria DIOP/PRF nº 121/2026 (DOU) (Ato oficial — domínio público (Lei 9.610/98, art. 8º, IV)); DNIT — SNV 202607A (bases geométricas), trechos federais simplificados (Dados abertos do Poder Executivo federal, livre utilização (Decreto 8.777/2016, art. 4º, red. Decreto 9.903/2019); sem licença nomeada no arquivo; ver docs/layers/rodovias_horario.md); DER-SP — Portaria SUP/DER-084-01/11/2023 (DOE-SP) (Ato oficial — domínio público (Lei 9.610/98, art. 8º, IV)); ARTESP — marcos quilométricos (Camadas Geoespaciais Auxiliares do dataset Programação de Obras) (CC BY (ARTESP)); OpenStreetMap (geometria da serra da Anchieta, casada pelo Valhalla) (© OpenStreetMap contributors (ODbL 1.0)) | [rodovias_horario](docs/layers/rodovias_horario.md) |
| Restrições federais (SIAET/DNIT) | Restrições | desvia | 4.891 | DNIT/SIAET — Restrições definitivas e temporárias por UF (Dado do Poder Executivo federal, livre utilização (Decreto 8.777/2016, art. 4º, red. Decreto 9.903/2019); cadastro oficial (Lei 9.610/98, art. 8º IV e V); portal gov.br CC BY-ND 3.0: só valores factuais, com citação); DNIT/DNITGeo — SNV (vgeo:vw_snv_rod) e OAEs (vgeo:oae_sgo) (Dado público DNIT, livre utilização (Decreto 8.777/2016, art. 4º); WFS sem licença explícita (AccessConstraints=NONE)) | [federal_restricoes](docs/layers/federal_restricoes.md) |
| Restrições municipais (Grande SP) | Restrições | desvia | 807 | Osasco: Dec. 10.676/2012 (red. Dec. 13.704/2023), mapa DEMUTRAN (IOMO 2434) e Portaria SETRAN (IOMO 2487) (Ato oficial (domínio público, Lei 9.610/98 art. 8º IV)); Barueri: Dec. 9.025/2019 (Jornal Oficial ed. 1.169) (Ato oficial (domínio público)); Guarulhos: Decs. 37.887/2021 e 38.400/2021 (ZRCC-TB) (Ato oficial (domínio público)); Cajamar: Dec. 7.397/2025 (DOM ed. 1358) (Ato oficial (domínio público)); Santana de Parnaíba: Dec. 4.288/2019 (Imprensa Oficial ed. 298, p. 7) (Ato oficial (domínio público)); Ribeirão Pires: Dec. 7.608/2025 (DO ed. 44/2026) (Ato oficial (domínio público)); Geometria das vias e do contorno de Ribeirão Pires: OpenStreetMap (ODbL 1.0 (© colaboradores do OpenStreetMap)); Polígono da ZMRC de Osasco: mapa oficial georreferenciado sobre os eixos do OpenStreetMap (ICP + thin-plate spline) (Derivado do OSM: ODbL 1.0 (© colaboradores do OpenStreetMap)); Limites municipais: IBGE Malha Municipal (Dados públicos IBGE (citar a fonte)) | [restricoes_rmsp](docs/layers/restricoes_rmsp.md) |
| VER — vias restritas a caminhão (SP) | Restrições | desvia | 79 | Portaria SMT.GAB 137/2018, art. 2º (texto compilado) e Portaria SMT.GAB 49/2021 (Ato oficial, sem proteção autoral (Lei 9.610/98, art. 8º, IV)); OpenStreetMap (geometria das vias) (ODbL 1.0 — © colaboradores do OpenStreetMap) | [ver](docs/layers/ver.md) |
| Altura desconhecida (OSM) | Infraestrutura | avisa | 12.536 | OpenStreetMap — vias sob estruturas, túneis e valores sem altura/peso (ODbL 1.0 — © colaboradores do OpenStreetMap); Mapillary — placas detectadas (opcional) (CC BY-SA 4.0 — Termos de Uso Mapillary (15/02/2024): uso comercial na seção 12; atribuição com logo e link para mapillary.com na seção 11) | [lacunas_osm](docs/layers/lacunas_osm.md) |
| Balanças | Infraestrutura | avisa | 330 | ANTT: PPV e operação dos postos (dados.antt.gov.br) (CC-BY); ARTESP: malha rodoviária por lote, Sistema de Pesagem (KMZ) (CC-BY); DER-SP: pontos para pesagem de veículos + camada Balancas_DER (Não declarada (portal cms.sp.gov.br: todos os direitos reservados)) | [balancas](docs/layers/balancas.md) |
| Pontes e viadutos | Infraestrutura | desvia | 8.909 | GeoSampa obra_arte (PMSP) (CC-BY-SA 4.0); DER-SP OAE (CC-BY-4.0); ARTESP passarelas (Cadastro de Ativos) (CC-BY); SIURB controle de obras (PMSP) (ODC-By 1.0); Curadoria de atos e notícias oficiais (PMSP, Prefeituras, Defesa Civil) (fatos de atos oficiais, com citação da fonte) | [oae](docs/layers/oae.md) |
| Pontes federais (DNIT/ANTT) | Infraestrutura | avisa | 12.950 | DNIT/DNITGeo — OAEs (vgeo:oae_sgo) (Dado público DNIT, livre utilização (Decreto 8.777/2016, art. 4º); WFS sem licença explícita (AccessConstraints=NONE)); DNIT/PROARTE — painel "Obras de Arte Especiais" (nota técnica SGO) (Sem licença declarada (painel público do DNIT, transparência ativa: Decreto 8.777/2016, art. 4º): uso informativo com citação); ANTT — Pontes e similares das rodovias concedidas (CC-BY (Creative Commons Atribuição)); DNIT — Alertas de serviços (notícias) (Portal gov.br CC BY-ND 3.0: só fatos e link) | [pontes_federais](docs/layers/pontes_federais.md) |
| Acidentes com caminhão | Segurança | avisa | 7.058 | Infosiga SP (Detran-SP) (Dados abertos Detran-SP (uso e redistribuição livres com atribuição e mesmos termos de abertura)); ARTESP — acidentes nas rodovias concedidas (CC-BY); PRF — acidentes nas rodovias federais (Dados abertos PRF — livre utilização (Decreto federal 8.777/2016, art. 4º, caput e § 1º, red. Decreto 9.903/2019); o rodapé do gov.br cita CC BY-ND 3.0 para o conteúdo do site, interpretado como não aplicável aos dados; confirmar via Fala.BR) | [acidentes](docs/layers/acidentes.md) |
| Roubo de carga | Segurança | avisa | 593 | SSP-SP — microdados de BO (SPDadosCriminais) (Dados abertos SSP-SP (sem licença explícita; Decreto SP 68.769/2024 — livre utilização)) | [roubo_carga](docs/layers/roubo_carga.md) |
| Carga e descarga (Zona Azul Caminhão) | Serviços | avisa | 1.591 | GeoSampa zona_azul (CET/PMSP) (CC-BY-SA 4.0); GeoSampa vaga_especial, tipo CA (CET/PMSP) (CC-BY-SA 4.0) | [carga_descarga](docs/layers/carga_descarga.md) |
| Descanso (PPD. áreas e apoio) | Serviços | avisa | 1.370 | Ministério dos Transportes — painel de PPDs (certificados e de concessão) (Dado público governamental, sem licença declarada (citar a fonte)); ARTESP — Cadastro de Ativos (áreas de descanso e SAU) (CC-BY); ANTT — Edificações operacionais (bases do SAU) (CC-BY); OpenStreetMap — rest_area, services, estacionamento e posto com acesso de caminhão (ODbL 1.0 (© colaboradores do OpenStreetMap)) | [descanso](docs/layers/descanso.md) |
| Pedágio | Custos | avisa | 1.151 | ANTT: praças de pedágio (dados.antt.gov.br) (CC-BY); ANTT: tarifas por concessão (gov.br/antt) (CC BY-ND 3.0 (rodapé gov.br)); ARTESP: tabelas de tarifas 2026 (PDF) (Não especificada (portal cms.sp.gov.br: todos os direitos reservados)); ARTESP: malha rodoviária por lote (KMZ) (CC-BY); OpenStreetMap: barrier=toll_booth / highway=toll_gantry (charge) (ODbL 1.0) | [pedagio](docs/layers/pedagio.md) |
| Postos com diesel (preço ANP) | Custos | avisa | 5.594 | Fonte: ANP — Levantamento de Preços de Combustíveis (LPC), últimas 4 semanas (diesel S10 e S500) (CC-BY (dados.gov.br)); Fonte: ANP — Cadastro de revendedores varejistas de combustíveis (CNPJ, endereço, bandeira) (CC-BY (dados.gov.br)); Fonte: ANP — PMQC (coordenadas dos postos amostrados) (CC-BY (dados.gov.br)); OpenStreetMap — amenity=fuel (posição de parte dos postos e acesso de caminhão) (ODbL 1.0 (© colaboradores do OpenStreetMap)); IBGE — CNEFE 2022 (endereço → ponto, só para casar o posto com o OSM) (Dados públicos IBGE (citar a fonte)) | [postos_diesel](docs/layers/postos_diesel.md) |
| Relevo e rampas | Relevo | avisa | 0 | ANADEM v1 (ANA/UFRGS), MDT 30 m; derivado do Copernicus DEM GLO-30 (© DLR e.V., © Airbus); modificado: reamostrado (bilinear) para HGT 1" e usado para estimar rampas (CC-BY-4.0); Licença Creative Commons Atribuição 4.0 (ANADEM) (CC-BY-4.0); OpenStreetMap (geometria das vias, via Valhalla) (ODbL-1.0) | [relevo](docs/layers/relevo.md) |
| Calendário legal de SP (feriados e suspensões da CET) | Calendário | avisa | 90 | CET — suspensões do rodízio e da ZMRC (Relatório anual) (Ato oficial (Decreto 58.584/2018 art. 8º; Lei 9.610/98 art. 8º IV). Página sem licença explícita: citar a fonte); Feriados: Leis 662/1949, 6.802/1980 e 14.759/2023; Lei estadual SP 9.497/1997; Lei municipal SP 14.485/2007 art. 10 (Ato oficial (Lei 9.610/98 art. 8º IV)); GeoSampa — restricao_circulacao_veiculo (ZMRC, Minianel) e segmento_logradouro (corredor do Minianel) (CC-BY-SA 4.0) | [core_legal](docs/layers/core_legal.md) |
<!-- camadas:fim -->

Pesquisa das fontes (o que existe, o que não existe, licenças, contagens): `docs/research/` e o resumo para
decisão em `docs/DECISOES.md`.

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
6. Busca os **pontos de descanso** a até 500 m da rota (OSM + camada `descanso`: PPD certificados e de concessão,
   áreas de descanso das concessionárias, SAU só como apoio) e monta o **plano de direção** da Lei 13.103
   (`driving_plan`): parada de 30 min a cada 5h30 de direção e descanso de 11 h, escolhendo na janela antes do limite
   o ponto de maior prioridade (PPD válido > área de descanso > posto/pátio > SAU; ver `docs/layers/descanso.md`).
   O ETA de cada ponto é proporcional à distância ao longo da rota (aproximação).
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
| `GET` | `/api/geocode?q=` | geocodificador próprio (CNEFE/IBGE, GeoSampa, CEPs; Photon só para POI) atrás da interface `Geocoder`; cada resultado traz `precisao` e `desvio_m` (`docs/layers/geocoding.md`) |

Tipos de reporte: `low_clearance` (m), `weight_limit` (t), `length_limit` (m), `truck_ban`,
`hazmat_ban`, `road_closed`, `steep_grade` (t = peso máx. que vence a subida).

Regras: reporte afeta a rota com `score >= 0`; `score < -2` desativa; `road_closed` expira em
24 h sem confirmação. Sem login: `device_id` anônimo gerado no navegador (localStorage).

## Tempo de viagem e velocidade

- **Velocidade máxima do caminhão: 90 km/h** (`top_speed` do costing truck; CTB art. 61). O padrão do Valhalla é
  120 km/h. Ajustável por `TRUCK_TOP_SPEED_KMH`.
- **Tempo de viagem por horário** (`eta_horario` na resposta da rota): o Valhalla deste projeto não tem tráfego
  histórico, então o tempo dele é igual às 3h e às 18h30. A API aplica, só no trecho urbano da Grande SP, um fator por
  meia hora com a forma da curva de lentidão da CET (2023) e amplitude calibrada pelas velocidades medidas nos picos
  (CET MSVP 2019 e TomTom Traffic Index 2025): cerca de 1,6× no pico de dia útil. Devolve tempo, faixa otimista e
  pessimista e hora de chegada. É estimativa, não trânsito em tempo real; o `duration_s` que as camadas usam não muda.
  Configuração em `config/eta-horario.json`.

## Regras legais (núcleo)

Detalhes, normas e artigos em `docs/layers/core_legal.md`. Em resumo:

- **Presets** conforme a Res. CONTRAN 882/2021 e alterações (899/2022, 994/2023, 1.005/2024, 1.015/2024), com a base
  legal em cada preset (`config/vehicle-presets.json`). Ids antigos continuam aceitos como apelidos.
- **VUC em SP**: até 2,50 m × 7,20 m, fabricação a partir de 2005 e até 15 anos (Portaria SMT 137/2018, red. 57/2021).
  Isenção na ZMRC e no rodízio só com **AETC** (`has_aetc`).
- **ZMRC, rodízio e perigosos** não valem em feriados (`holidays`) e respeitam as suspensões publicadas pela CET
  (`rule_suspensions`, importador `cet_suspensoes`; a rota avisa a suspensão do dia, `cet_suspension`). Exceções do
  rodízio pelo Decreto 58.584/2018. Caminhão com a placa do dia pode usar as vias do Minianel (art. 2º §2º): a zona do
  rodízio de caminhões é o Minianel menos o corredor das vias-limite, medido no GeoSampa (`scripts/gen-zones-seed.py`).
- **Perigosos dos grupos III e IV** (consumo local e outros) circulam na área interna do centro expandido; as vias do
  Minianel ficam proibidas para eles pela camada `perigosos` (Portaria SMT.GAB 051/2024 art. 3º parágrafo único).
- **Jornada** (Lei 13.103/2015 com a decisão do STF na ADI 5322) no plano de direção.
- **Limitação:** as zonas usam o horário de saída; algumas camadas (perigosos, roubo de carga, acidentes) já estimam
  o horário de passagem ao longo da rota.

## Testes automatizados

Contra o ambiente local, depois do `docker compose up` (espera o Valhalla ficar pronto):

```bash
./scripts/run-tests.sh
```

Cobrem os critérios do MVP (viaduto 3,80 m, ZMRC, score -3) e cada camada (`api/test/layers/*.test.ts`):
VER, perigosos, pedágio, balanças, acidentes/roubo, feriados em rodovia, SIAET, altura OSM, municípios da RMSP,
placas/gabaritos, carga e descarga, relevo e geocodificação. Os testes criam seus próprios reportes
(`device_id` de teste) e os apagam ao final. A suíte completa leva alguns minutos (muitas rotas reais).

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

- Navegação curva a curva, trânsito em tempo real, login/contas, app nativo, pagamentos.
- ETA dependente do horário (hoje o Valhalla não tem tráfego histórico na RMSP; ver `docs/research/trafego_tempo`).
- Rampa no custo do Valhalla (o costing truck 3.9.1 ignora; hoje a camada de relevo só avisa).
- Pedidos via LAI para gabarito e limite de peso de pontes/viadutos (ver `docs/DECISOES.md`).

## Referências

- Valhalla: https://valhalla.github.io/valhalla/api/route/api-reference/ (costing `truck`, `exclude_polygons`, `date_time`)
- Imagem Docker oficial: `ghcr.io/valhalla/valhalla-scripted` (https://github.com/valhalla/valhalla/tree/master/docker)
- Geofabrik: https://download.geofabrik.de/south-america/brazil.html
- GeoSampa WFS: https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs
- OpenFreeMap: https://openfreemap.org · Photon: https://photon.komoot.io
- Endereços: IBGE, Censo Demográfico 2022 — CNEFE (https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/) · CEPs: ipea/padronizacao_cnefe · ViaCEP: https://viacep.com.br
