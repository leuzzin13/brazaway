# Frota — multi-tenant (transportadora → motoristas)

Camada de operação da transportadora sobre o roteador: empresas, motoristas por convite, veículos (cobrança por
veículo ativo), posição em tempo real, viagens, paradas, entregas, mensagens, Second Brain (RAG) e Mentor de
Logística (agente). Banco compatível com o Supabase (auth.users, RLS, pgvector, Realtime).

| Peça | Arquivo |
|---|---|
| Compatibilidade local com o Supabase (auth.uid, papéis) | `db/migrations/0300_frota_auth_shim.sql` (não faz nada no Supabase) |
| Tabelas, índices, view de cobrança | `db/migrations/0301_frota_schema.sql` |
| Row Level Security + funções auxiliares | `db/migrations/0302_frota_rls.sql` |
| RPC (convite, ping, viagem, parada, entrega, mensagem, agente) e triggers | `db/migrations/0303_frota_functions.sql` |
| Teste de isolamento (2 empresas, todos os papéis) | `db/tests/frota_rls_test.sql` |

```bash
psql postgres://truck:truck@localhost:5432/truck_router -v ON_ERROR_STOP=1 -f db/tests/frota_rls_test.sql   # → frota RLS: OK
```

## Diagrama

```mermaid
erDiagram
  AUTH_USERS ||--o| COMPANY_MEMBERS : "1 usuário = 1 empresa"
  COMPANIES ||--o{ COMPANY_MEMBERS : tem
  COMPANIES ||--o{ INVITES : gera
  COMPANIES ||--o{ VEHICLES : possui
  VEHICLES ||--o{ VEHICLE_STATUS_HISTORY : "cobrança"
  INVITES |o--o| COMPANY_MEMBERS : "origina (motorista/gestor)"
  VEHICLES |o--o{ INVITES : "vínculo opcional"
  COMPANIES ||--o{ TRIPS : tem
  COMPANY_MEMBERS ||--o{ TRIPS : "motorista"
  VEHICLES ||--o{ TRIPS : usa
  TRIPS ||--o{ LOCATION_PINGS : "pings crus (retenção)"
  COMPANY_MEMBERS ||--|| LIVE_POSITIONS : "última posição (Realtime)"
  COMPANY_MEMBERS ||--o{ DRIVER_DAILY_TRACKS : "rastro fora de viagem"
  TRIPS ||--o{ STOPS : "paradas (auto/manual)"
  TRIPS ||--o{ DELIVERIES : entregas
  STOPS |o--o{ DELIVERIES : "onde foi feita"
  COMPANIES ||--o{ MESSAGES : tem
  TRIPS |o--o{ MESSAGES : "sobre a viagem"
  COMPANIES ||--o{ KNOWLEDGE_DOCS : "Second Brain (pgvector)"
  COMPANIES ||--o{ AGENT_CONVERSATIONS : tem
  AGENT_CONVERSATIONS ||--o{ AGENT_MESSAGES : tem
  AGENT_CONVERSATIONS ||--o{ AGENT_ACTIONS : "auditoria"
  AGENT_ACTIONS |o--o{ MESSAGES : "mensagem enviada pelo agente"

  COMPANIES { uuid id PK text name text cnpj int price_per_vehicle_cents int ping_interval_moving_s int ping_interval_stopped_s int stop_min_minutes int stop_radius_m int raw_ping_retention_days }
  COMPANY_MEMBERS { uuid user_id UK enum role "owner|admin|gestor|motorista" enum status "active|disabled" uuid default_vehicle_id uuid invite_id }
  INVITES { text code_hash UK text code_hint enum role uuid vehicle_id timestamptz expires_at enum status "pendente|aceito|expirado|revogado" timestamptz accepted_at }
  VEHICLES { text plate text preset numeric height_m numeric weight_t numeric payload_t smallint axle_count bool hazmat enum status }
  TRIPS { enum status "planejada|atribuida|em_andamento|concluida|cancelada" geometry planned_route geometry actual_route "LineStringM (M = epoch)" int distance_m int deviation_max_m text summary }
  LOCATION_PINGS { bigint id PK geometry geom real speed_kmh real heading_deg real accuracy_m timestamptz recorded_at bool compacted }
  STOPS { enum type "entrega|descanso|abastecimento|pernoite|imprevisto|nao_classificada" enum source "auto|manual" timestamptz arrived_at timestamptz departed_at int duration_s }
  DELIVERIES { text customer_name text address timestamptz window_start timestamptz window_end enum status "pendente|entregue|falhou" text proof_photo_path text signature_path }
  KNOWLEDGE_DOCS { text source_type uuid source_id text content vector embedding "1024" text embedding_model }
  AGENT_ACTIONS { text tool jsonb input bool requires_confirmation enum status "proposta|confirmada|rejeitada|executada|falhou" uuid confirmed_by }
```

## Quem vê o quê (RLS)

| Tabela | owner/admin | gestor | motorista | outra empresa / sem convite / desativado |
|---|---|---|---|---|
| companies | lê; edita | lê | lê | nada |
| company_members | todos; edita papel/status | todos; desativa motorista (RPC) | só o próprio (nome/telefone) | nada |
| invites | todos; gera/revoga (RPC); convida gestor | gera/revoga convite de motorista | nada | nada |
| vehicles | todos; CRUD | todos; cria/edita | o padrão e os das suas viagens | nada |
| trips | todas; CRUD | todas; cria/edita/atribui | as suas; inicia/encerra (RPC) | nada |
| location_pings, live_positions, driver_daily_tracks | todos | todos | os próprios; envia ping | nada |
| stops | todas | todas | as suas; registra manual | nada |
| deliveries | todas | todas | das suas viagens; registra status (RPC) | nada |
| messages | todas da empresa | todas da empresa | recebidas/enviadas; só escreve para a equipe | nada |
| knowledge_docs, agent_* | tudo | tudo (conversas próprias) | nada | nada |

- Toda decisão de acesso passa por `app.my_membership()`: só membro **ativo** de empresa **ativa** enxerga algo. Desativar o motorista corta o acesso na hora.
- Um usuário pertence a **uma** empresa (`company_members.user_id` único). Não há uso avulso: sem convite aceito, o usuário autenticado não vê nada e não grava nada.
- Convite: código de uso único `XXXXX-XXXXX` (sem 0/O/1/I), mostrado só uma vez (no banco fica o sha256), validade de 1 h a 30 dias, vínculo opcional a veículo. Gestor convida só motorista; owner/admin convidam gestor.
- No Supabase, bloquear o cadastro sem convite também na autenticação: hook "Before User Created" (Auth Hooks) que exige um código válido nos metadados do cadastro. O banco já garante que, sem convite, a conta não tem acesso.

## Decisões

- **Pings**: `location_pings` recebe os pontos crus (idempotente por motorista + horário do aparelho). Cada ping atualiza `live_positions` (1 linha por motorista), que é a tabela publicada no Supabase Realtime — o painel assina só ela, filtrada pela RLS. No fim da viagem, `app.compact_trip` grava a rota feita como **LineStringM** (M = horário de cada ponto, nada se perde), distância, duração e desvio máximo da rota planejada, detecta as paradas e marca os pings como compactados; o job `app.run_compaction` compacta também o rastro fora de viagem por motorista e dia e apaga os pings crus depois de `raw_ping_retention_days` (padrão 7).
- **Paradas automáticas**: parado mais de `stop_min_minutes` (padrão 10) dentro de `stop_radius_m` (padrão 150 m); não sobrescreve parada manual no mesmo intervalo.
- **Cobrança**: `vehicle_status_history` (trigger) registra cada intervalo ativo; `billing_active_vehicles_monthly` conta os veículos ativos em algum momento do mês × `price_per_vehicle_cents`.
- **Embeddings**: `vector(1024)` (ex.: Voyage `voyage-3.5`); `embedding_model` registra o modelo. O Second Brain é RAG (busca + SQL), não treino de modelo.
- **Agente**: `agent_actions` é o log de auditoria; ações que mexem em rota ou falam com motorista nascem `proposta` e só são executadas depois de `app.confirm_agent_action` pelo gestor.
- **Comprovantes** (foto/assinatura): Supabase Storage, bucket privado, prefixo `<company_id>/`; o banco guarda o caminho e a RPC recusa caminho de outra empresa.

## API

Endpoints REST em `api/src/frota/routes.ts`, todos sob `/api/frota`. A regra de negócio fica nas RPC do schema `app` (0303); a API só valida a entrada (zod), roda cada requisição numa transação com RLS e traduz os erros.

**Autenticação.** `Authorization: Bearer <access token do Supabase>` (JWT HS256 assinado com `SUPABASE_JWT_SECRET`; em dev, `FROTA_DEV_JWT_SECRET`, padrão `dev-secret-troque`). Cada requisição faz `set local role authenticated` + `request.jwt.claims`, então as políticas de RLS valem como no PostgREST. Tokens `service_role` só servem para o job. Erros: `401` token ausente/inválido/expirado; `403` sem permissão, regra de negócio recusada pela RPC ou RLS; `404` não existe (ou é de outra empresa); `409` duplicidade (ex.: placa); `422` entrada inválida; `409 NO_ROUTE` quando o roteador não acha rota.

**Gerar token de dev** (rode em `api/`; troque o `sub` por um `auth.users.id` com vínculo em `company_members`; o usuário do seed é `de300000-0000-4000-8000-000000000010`, o owner):

```bash
npx tsx -e "import {signJwt} from './src/frota/auth.ts'; console.log(signJwt({sub:'de300000-0000-4000-8000-000000000010', role:'authenticated'}, undefined, 86400))"
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/frota/me
# token do job (service_role): signJwt({ role: 'service_role' })
```

Legenda de quem pode: **E** = equipe (owner/admin/gestor), **M** = motorista (nas suas viagens), **T** = todo membro ativo (a RLS filtra o que ele vê), **S** = service_role.

| Método e caminho | Quem | O que faz |
|---|---|---|
| `GET /me` | T | Perfil, papel, empresa e intervalos de envio de ping. Autenticado sem convite volta `role: null`. |
| `POST /pings` | M | Lote `{pings:[{lat,lon,speed_kmh?,heading_deg?,accuracy_m?,recorded_at,trip_id?}], vehicle_id?}` (1 a 500) → `app.send_pings`. Devolve `accepted`, `received`, `trip_id`, `interval_moving_s`, `interval_stopped_s`. Reenvio é idempotente. |
| `GET /trips` | T | Lista. Filtros: `status` (lista separada por vírgula), `driver_id`, `from`, `to` (ISO), `limit`, `offset`. Motorista só vê as suas. |
| `GET /trips/:id` | T | Detalhe com `planned_route` e `actual_route` em GeoJSON (`actual_route_times` = horário, em epoch s, de cada vértice), `route_response`, `stops` e `deliveries`. |
| `POST /trips` | E | Cria viagem `planejada`. Com `plan_route: true` (exige `origin` e `destination`) chama o roteador interno (`computeRoute`, o mesmo de `POST /api/route`) com o veículo de `vehicle_id` convertido para o formato da API (+ `vehicle` opcional para atributos extras) e grava `planned_route`, `planned_distance_m`, `planned_duration_s`, `route_response`. `driver_id` já atribui (`app.assign_trip`); `deliveries[]` cria as entregas. |
| `POST /trips/:id/assign` | E | `{driver_id, vehicle_id?}` → `app.assign_trip`. |
| `POST /trips/:id/start` | M | Inicia a viagem atribuída → `app.start_trip`. |
| `POST /trips/start` | M | Viagem avulsa `{title?, vehicle_id?}` → `app.start_trip(null, ...)`. |
| `POST /trips/:id/end` | M/E | Encerra → `app.end_trip`: compacta pings na rota feita, distância, desvio e paradas automáticas. |
| `POST /trips/:id/cancel` | M/E | Cancela → `app.end_trip(.., true)`. |
| `POST /stops` | M/E | Parada manual `{type, lat, lon, arrived_at?, departed_at?, note?, trip_id?}` → `app.register_stop` (sem `trip_id`, usa a viagem em andamento). |
| `PATCH /stops/:id` | M/E | Classifica/anota: `type`, `note`, `address`, `departed_at`. |
| `POST /trips/:id/deliveries` | E | Uma entrega ou uma lista `[{customer_name, address, lat?, lon?, window_start?, window_end?, sequence?, notes?}]`. |
| `PATCH /deliveries/:id` | M/E | `{status: pendente\|entregue\|falhou, failure_reason?, proof_photo_path?, signature_path?, notes?, stop_id?}` → `app.register_delivery` (falha exige motivo; caminhos de comprovante só sob `<company_id>/`). |
| `GET /messages` | T | Filtros: `box` (`inbox`, `sent`, `all`), `peer`, `trip_id`, `unread`, `before`, `limit`. |
| `POST /messages` | T | `{recipient_id, body, trip_id?}`. Motorista só escreve para a equipe da empresa (política `can_message`). |
| `POST /messages/read` | T | `{ids:[...]}` → `app.mark_messages_read` (só as recebidas). Devolve `{marked}`. |
| `POST /invites` | E | `{role?: motorista\|gestor, vehicle_id?, invitee_name?, invitee_email?, invitee_phone?, valid_hours?}` → `app.create_invite`. O `code` só vem nesta resposta. Gestor só convida motorista. |
| `GET /invites` | E | Lista (`status` opcional); nunca devolve código nem hash, só `code_hint`. `effective_status` já considera a validade. |
| `POST /invites/:id/revoke` | E | → `app.revoke_invite` (só pendente). |
| `POST /invites/accept` | usuário sem empresa | `{code, display_name, phone?}` → `app.accept_invite`. Devolve o perfil. |
| `GET /members` | E | Filtros `role`, `status`. |
| `POST /members/:userId/status` | E | `{status: active\|disabled}` → `app.set_member_status`. Desativar corta o acesso na hora. |
| `GET /vehicles` | T | Lista (`status` opcional); motorista vê o padrão e os das suas viagens. |
| `POST /vehicles` | E | `{plate, label?, preset?, status?, ...}`; medidas omitidas vêm do preset de `config/vehicle-presets.json`. Placa repetida na empresa → 409. |
| `PATCH /vehicles/:id` | E | Altera qualquer campo, inclusive `status` (alimenta a cobrança). |
| `GET /live` | T | Última posição de cada motorista em GeoJSON (`FeatureCollection` de `Point`, com `age_s`). Motorista só vê a própria. |
| `GET /billing` | E | Veículos ativos por mês × preço (`billing_active_vehicles_monthly`); filtros `from`/`to` (`YYYY-MM`). |
| `POST /trips/:id/start` (corpo opcional) | M | Ao iniciar, o app pergunta o combustível: `combustivel_l` ou `combustivel_pct` e `odometro_km`. Com o nível, a API monta o **plano de abastecimento** da viagem (tanque e consumo: médio medido do veículo, senão o cadastro, senão o tipo de caminhão; postos conveniados da empresa) e guarda em `trips.plano_abastecimento`. |
| `POST /abastecimentos` | T | Motorista registra o abastecimento (litros, valor, posto, CNPJ, hodômetro, tanque cheio, `pagamento` pix/cartao_frota/...); ligado à viagem pelo horário. |
| `GET /abastecimentos` | T | Lista com `resumo`: litros, valor, preço médio pago. Motorista vê os dele. |
| `GET /consumo` | T | Consumo médio medido (km das viagens concluídas ÷ litros abastecidos, `dias` padrão 60) por veículo e por motorista; `null` abaixo de 300 km e 100 L. |
| `GET/POST/PATCH/DELETE /postos-conveniados` | T lê, E escreve | Postos com `preco_rs_l` fechado ou `desconto_rs_l` (ex.: PIX); entram no plano de abastecimento. |
| `POST /pings` → `alertas` | M | Fora da rota planejada (> 250 m) e com via ou zona proibida para o caminhão no 1,5 km à frente, a resposta traz `alertas` (o app apita) e grava em `alertas_viagem` (uma vez a cada 30 min por restrição; conferência no máximo a cada 90 s por viagem). |
| `GET /alertas`, `POST /alertas/:id/visto` | T | Alertas ao vivo (filtros `trip_id`, `desde`, `nao_vistos`); equipe vê todos, motorista os dele. |
| `POST /multas` | T | Registra uma multa. **Motorista**: só a própria, pelo app, na hora em que foi autuado ou parado (`ocorrida_em`, `lat`/`lon`, `local`, `descricao`, `foto_path`, `ait`, `orgao`, `valor_cents`); entra como `registrada`, `origem: motorista`, e os campos da equipe são ignorados. **Equipe**: qualquer campo. A viagem é ligada sozinha pelo motorista (ou veículo) e pelo horário. AIT repetido na empresa → 409. |
| `GET /multas` | T | Lista (filtros `status` separado por vírgula, `driver_id`, `feedback=true\|false`, `from`, `to`) com `resumo`: `total`, `sem_feedback`, `indicacao_vencendo` (prazo de indicar o condutor em até 7 dias), `valor_cents`, `pontos`. Cada item traz `dias_para_indicar`. Motorista vê só as dele. |
| `PATCH /multas/:id` | E | Completa o auto (AIT, órgão, enquadramento, gravidade, valor, pontos, prazos, quem paga, `restricao` ligada) e marca **`feedback_enviado`** (com `feedback_nota`); a API grava quem e quando (`feedback_por`, `feedback_em`), e desmarcar limpa os dois. |
| `POST /jobs/compaction` | S | `select app.run_compaction()`: compacta viagens e rastros, expira convites, apaga pings crus vencidos. |

### Job de compactação

- Manual: `curl -X POST -H "Authorization: Bearer $SERVICE_TOKEN" http://localhost:3000/api/frota/jobs/compaction`.
- Agendado pela própria API: defina `FROTA_JOBS_INTERVAL_MIN=15` (minutos) no ambiente do processo. O job roda com o papel `service_role`; uma falha só é registrada no log e a API segue de pé. Sem a variável, nada é agendado (no Supabase também dá para usar pg_cron ou uma edge function agendada chamando `app.run_compaction()`).

### Testes

`api/test/frota/frota.test.ts` cobre o fluxo completo (convite → aceite → viagem com rota planejada → pings → parada → entrega → encerramento com rota compactada e parada automática → mensagem), o isolamento entre empresas, papéis, tokens inválidos e usuário sem convite. Cria as empresas/usuários no `beforeAll` (ids `fa0e...`) e apaga no `afterAll`. Precisa do Postgres, do Valhalla e de uma instância da API:

```bash
cd api && npm run build && PORT=3100 node dist/server.js &     # com DATABASE_URL, VALHALLA_URL, CONFIG_DIR como de costume
API_URL=http://localhost:3100 npx vitest run test/frota/frota.test.ts
```

O bloco "bugs conhecidos das migrations" usa `it.fails`: passa enquanto o defeito existe e avisa quando for corrigido.

## Seeds

Dados de demonstração em `db/seed/demo/` (fora de `db/seed/`, que roda em todo ambiente e **não** deve receber isto):

| Arquivo | Para quê |
|---|---|
| `frota_demo.sql` | O seed. Idempotente (ids `de300000-...` + `on conflict do nothing`; reaplicar só renova a validade do convite pendente). |
| `frota_demo.sql.tpl` + `gerar_frota_demo.mjs` | Fonte do seed. O gerador pede 3 rotas reais ao roteador (Valhalla) e cria os pings ao longo das ruas, com ruído de GPS. Para mudar: edite o `.tpl` e rode `API_URL=http://localhost:3000 node db/seed/demo/gerar_frota_demo.mjs`. Não edite o `.sql` à mão. |

```bash
psql postgres://truck:truck@localhost:5432/truck_router -v ON_ERROR_STOP=1 -f db/seed/demo/frota_demo.sql   # → "frota demo: OK"
# remover: delete from companies where id = 'de300000-0000-4000-8000-000000000001'; delete from auth.users where email like '%@transportadora-demo.example';
```

Conteúdo: **Transportadora Demo** (R$ 149,00 por veículo ativo); owner (`...0010`), gestor (`...0011`) e motoristas João (`...0021`), Marcos (`...0022`) e Paulo (`...0023`); veículos toco `DEM1A01`, truck `DEM2B02` e carreta `DEM3C03` (medidas dos presets); convites pendente (código `KX7NP-4QWZ2`, válido 7 dias), aceito e expirado; viagens na Grande SP: **concluída** (CEAGESP → Guarulhos, 120 pings reais, 2 entregas feitas com paradas manuais, 1 falha, almoço detectado como parada automática, já compactada com `app.compact_trip`), **em andamento** (Barueri → Mooca, 64 pings, último de 1 min atrás: aparece em `/live`) e **planejada atribuída** (São Bernardo → Cajamar, amanhã 05:30, com rota planejada); 4 mensagens (duas por ler). Os horários são relativos à data da primeira aplicação.

## Second Brain

RAG da empresa (busca + SQL; **não** treina modelo). Código: `api/src/frota/brain.ts` (embeddings, fatos, resumos, job) e `api/src/frota/llm.ts` (cliente Anthropic). Tabela: `knowledge_docs` (`vector(1024)`, `embedding_model`, índice HNSW de cosseno); busca por `app.search_knowledge`, que respeita a RLS (só equipe).

**O que vira documento** (`source_type`):

| Tipo | Quando | Conteúdo |
|---|---|---|
| `trip` | viagem `concluida` sem `summary` | O resumo (também gravado em `trips.summary` e `summary_generated_at`) + os fatos do SQL: motorista, veículo, origem/destino, planejado × feito (distância, duração, diferença), desvio máximo, paradas por tipo e duração, entregas com janela e atraso/falha (com motivo) e as mensagens da viagem. |
| `delivery` | entrega `falhou`, ou `entregue` depois do fim da janela | Cliente, endereço, motivo/atraso, janela, viagem, motorista e veículo. Refeito se a entrega mudar depois. |
| `conversation` | conversa do Mentor parada há `FROTA_CONVERSATION_IDLE_MIN` min (padrão 30) | Resumo das perguntas, respostas e ações propostas. Guarda `metadata.user_id`: o Mentor só mostra conversa ao gestor que conversou (ou a owner/admin). Limite conhecido: a RLS de `knowledge_docs` deixa toda a equipe ler a linha direto no banco (veja "Pendências" abaixo). |

**Resumo.** O texto factual é montado só com SQL (nada inventado). Com `ANTHROPIC_API_KEY`, o modelo de `FROTA_SUMMARY_MODEL` (padrão `claude-haiku-5-5`: pequeno e barato, a tarefa é reescrever fatos) devolve até 6 frases em português, com a ordem de usar **somente** os fatos. Sem a chave, ou se a chamada falhar, o próprio texto factual é o resumo (`metadata.summary_source` = `fatos` ou `llm`).

**Embeddings.** Interface `Embedder`, escolhida sozinha por `pickEmbedder()`:

- `VOYAGE_API_KEY` presente: Voyage `voyage-3.5` (`VOYAGE_MODEL` troca), 1024 dimensões, via `fetch` (`input_type` `document` ao gravar e `query` ao buscar).
- Sem a chave: `LocalHashEmbedder` (`local-hash-1024-v1`), determinístico e sem rede: hash de palavras, pares de palavras e trigramas de caracteres num vetor de 1024 posições com sinal, norma 1. Serve para dev e teste; **não tem semântica de verdade** (sinônimos não se aproximam). `FROTA_EMBEDDER=local` força o local mesmo com a chave.
- `knowledge_docs.embedding_model` registra o modelo. Vetores de modelos diferentes não se comparam: o job refaz os documentos cujo modelo difere do atual, e a tool de busca avisa quando há documentos nessa situação.

**Job** `POST /api/frota/jobs/brain` (só `service_role`; corpo opcional `{company_ids?, limit?, idle_minutes?}`): resume viagens concluídas sem resumo, cria documentos de viagem faltantes, de entrega e de conversa e (re)gera os embeddings que faltam. Idempotente (a segunda rodada devolve zeros); falha de um item não derruba o resto (`errors[]` no retorno); uma rodada por vez (`409 BUSY`). Agende de hora em hora ou ao fim do dia:

```bash
curl -X POST -H "Authorization: Bearer $SERVICE_TOKEN" -H 'content-type: application/json' -d '{}' http://localhost:3000/api/frota/jobs/brain
```

| Variável | Padrão | Para quê |
|---|---|---|
| `ANTHROPIC_API_KEY` | (vazia) | Resumos com Claude e Mentor. Sem ela: resumo factual e o chat do Mentor responde `503`. |
| `FROTA_SUMMARY_MODEL` | `claude-haiku-5-5` | Modelo dos resumos de viagem e de conversa. |
| `VOYAGE_API_KEY` / `VOYAGE_MODEL` | (vazia) / `voyage-3.5` | Embeddings reais. |
| `FROTA_EMBEDDER` | (auto) | `local` força o embedder local. |
| `FROTA_CONVERSATION_IDLE_MIN` | `30` | Minutos de silêncio para a conversa virar documento. |

**Custo esperado** (estimativa; confirme os preços vigentes): resumo de uma viagem em `claude-haiku-5-5` (US$ 0,10 / US$ 0,50 por milhão de tokens): ~1,5 mil tokens de entrada e ~0,4 mil de saída, cerca de **US$ 0,0004** (R$ 0,002). Embedding de um documento (~500 tokens) na Voyage: fração de milésimo de centavo. Mil viagens por mês: menos de US$ 1.

## Mentor de Logística

Agente (Claude, tool use) que responde ao gestor com base nos dados da própria empresa. Código: `api/src/frota/mentor.ts` (rotas e laço do agente), `api/src/frota/mentor_tools.ts` (tools e execução das ações), plugin `frotaBrainMentorRoutes` (registra também o job do Second Brain). Em `server.ts`: `await app.register(frotaBrainMentorRoutes)`.

**Quem usa.** Só equipe (owner/admin/gestor); motorista e `service_role` recebem `403` no chat. Modelo: `FROTA_MENTOR_MODEL` (padrão `claude-opus-5-5`, o mais capaz da linha corrente; pensamento sempre ligado, `effort: medium`). O system prompt (especialista em logística de caminhões no Brasil; responde só com dados da empresa e diz quando não há dado) e a lista de tools são fixos, com `cache_control` no system, para o cache de prompt valer. A data e a hora vão num bloco no início de cada mensagem do usuário.

### Endpoints

| Método e caminho | O que faz |
|---|---|
| `POST /api/frota/mentor/chat` | `{conversation_id?, message}` → `{conversation_id, reply, actions_proposed[], pending_confirmation, tool_calls[], usage}`. Sem `conversation_id` abre conversa. Roda até 10 chamadas ao modelo por pergunta. Conversa privada do gestor que a abriu (outro gestor, mesmo da mesma empresa: `404`). Conversa com 120 mensagens gravadas: `409` (abra outra; o histórico é reenviado inteiro, sem corte, porque os blocos de pensamento do Opus 5.5 ficam presos à conversa). |
| `GET /api/frota/mentor/conversations`, `GET .../conversations/:id` | Lista e texto trocado (sem blocos de ferramenta). |
| `GET /api/frota/mentor/actions?status=proposta` | Ações do Mentor da empresa (`status`: proposta, confirmada, rejeitada, executada, falhou; `conversation_id`, `limit`). Traz `resumo` legível. |
| `POST /api/frota/mentor/actions/:id/confirm` | Confirma (`app.confirm_agent_action`, com a RLS do gestor) e **executa**; grava `executada` (+`result`, `executed_at`) ou `falhou` (+`error`). Responde `{ok, action}`; `ok:false` quando a execução falhou. Já decidida: `409`. De outra empresa: `404`. |
| `POST /api/frota/mentor/actions/:id/reject` | Rejeita (`app.reject_agent_action`); nada é executado. |

### Tools

SQL fixo e parametrizado, validado por zod: o modelo **nunca** manda SQL. Todas as leituras rodam com `withRls` e as claims do gestor (RLS) e ainda filtram por `app.company_id()`; resultados são cortados em ~14 mil caracteres.

| Tool | Tipo | O que devolve / faz |
|---|---|---|
| `listar_cadastros` | leitura | Motoristas ativos, veículos ou viagens (com ids para as ações). |
| `kpi_atrasos_por_motorista` | leitura | Por motorista: entregas fora da janela, atraso médio e máximo, falhas e pendentes vencidas. |
| `kpi_tempo_parado` | leitura | Tempo parado por tipo, local (endereço ou ~100 m) ou motorista. |
| `kpi_km_rodados` | leitura | Km rodados × planejados, viagens e horas, por motorista ou veículo. |
| `kpi_viagens_por_status` | leitura | Contagem por status no período. |
| `kpi_desvios_rota` | leitura | Viagens com maior desvio da rota planejada. |
| `posicao_atual` | leitura | `live_positions`: posição, velocidade, movimento e minutos desde o último ping. |
| `historico_viagem`, `status_entregas` | leitura | Viagem completa (paradas, entregas, mensagens, resumo) e lista de entregas com filtros. |
| `buscar_conhecimento` | leitura | Busca semântica no Second Brain (`app.search_knowledge` com o embedding da pergunta). |
| `propor_criar_viagem` | ação | Viagem com rota do roteador interno (`computeRoute`, o mesmo de `POST /api/route`) com o veículo cadastrado (preset + dimensões, dígito final da placa); opcionalmente motorista e entregas. |
| `propor_atribuir_viagem` | ação | `app.assign_trip` (motorista e veículo). |
| `propor_enviar_mensagem` | ação | Mensagem ao motorista, com `messages.agent_action_id`. |
| `propor_reordenar_entregas` | ação | Nova sequência de **todas** as entregas de uma viagem não concluída. |

Os períodos usam datas `YYYY-MM-DD` no fuso de Brasília (padrão: últimos 30 dias).

### Fluxo de confirmação

1. O modelo chama `propor_*`. Nada é executado: grava-se `agent_actions` com `status = 'proposta'`, `requires_confirmation = true`, `company_id` e `requested_by` do gestor autenticado (a gravação usa `service_role`, mas sempre com a empresa e o usuário dele). A proposta é validada na hora (motorista ativo, veículo ativo da empresa, viagem aberta); inválida volta como erro ao modelo e não grava nada.
2. O resultado da tool manda o modelo avisar o gestor de que a ação está **pendente** e informar o id.
3. O gestor vê em `GET .../actions?status=proposta` e chama `confirm` ou `reject`.
4. `confirm`: `app.confirm_agent_action` (trava a linha, exige equipe e status `proposta`) → executa com a RLS do gestor → `executada` / `falhou`. A mensagem ao motorista é gravada como `service_role` (a RLS de `messages` recusa `agent_action_id` vindo do usuário), com `sender_id` = gestor que confirmou, só para membro ativo da mesma empresa e com `agent_action_id` preenchido (o app pode mostrar "enviada pelo Mentor"). A criação de viagem calcula a rota **na confirmação** e grava viagem, entregas e atribuição numa transação.

### Custos esperados por pergunta

Estimativa para `claude-opus-5-5` (US$ 4 / US$ 20 por milhão de tokens de entrada/saída; leitura de cache US$ 0,20). Uma pergunta típica faz 2 a 3 chamadas ao modelo: ~5 mil tokens fixos (system + 13 tools), mais histórico e resultados de tools (1 a 6 mil), e ~1 a 2 mil tokens de saída por chamada (incluindo o pensamento). Resultado: **~US$ 0,05 a 0,25 por pergunta (R$ 0,25 a 1,25), tipicamente ~US$ 0,10**. O cache de prompt reduz a parte fixa quando o prefixo atinge o mínimo cacheável do modelo e há perguntas dentro de 5 minutos; confira `usage.cache_read_input_tokens` (vem somado em `usage` da resposta e gravado em `agent_messages.input_tokens/output_tokens`). Para baixar o custo: `FROTA_MENTOR_MODEL=claude-sonnet-5-5` (US$ 2 / US$ 10, perde profundidade nas análises).

### Testes

`api/test/frota/mentor.test.ts` sobe uma instância própria (`api/src/frota/dev_server_brain.ts`, porta 3200, só com este plugin) com cliente Anthropic **falso** (`FROTA_FAKE_LLM=1`: roteiro de `tool_use` por `POST /__test/llm_script`), cria empresas e usuários no `beforeAll` e apaga no `afterAll`. Sem chaves reais e sem rede (usa o Postgres e o Valhalla locais para a criação de viagem):

```bash
cd api && npx vitest run test/frota/mentor.test.ts
```

### Pendências e limites

- Só validado com chaves reais: chamadas à Anthropic (parâmetros `output_config.effort`, `cache_control`, formato dos blocos) e à Voyage. O teste cobre o Mentor com cliente falso e o corpo da requisição da Voyage com `fetch` falso.
- Fallback de recusa do lado do servidor (`fallbacks`, beta) **não** está ligado: uma recusa (`stop_reason: refusal`) vira a resposta "Não posso ajudar com esse pedido". Para ligar, é preciso ecoar os blocos `fallback` no histórico.
- `knowledge_docs` (RLS `staff_of`) deixa qualquer gestor ler documentos de conversa de outro gestor direto no banco; o Mentor filtra por `metadata.user_id`, mas o banco não. Corrigir exigiria uma política em 0302.
