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
