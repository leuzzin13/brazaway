-- Frota (multi-tenant): empresas (transportadoras), membros, convites, veículos, viagens, posições, paradas, entregas,
-- mensagens, base de conhecimento (pgvector) e auditoria do agente. Compatível com o Supabase (auth.users, pgvector,
-- Realtime). Idempotente. Políticas de RLS em 0302; funções e triggers em 0303.
--
-- Convenções: toda tabela de dados de empresa tem company_id (isolamento por RLS); usuários são auth.users(id);
-- geometrias em EPSG:4326; horários em timestamptz.

create extension if not exists vector;

create schema if not exists app;   -- funções auxiliares (RLS, RPC); tabelas ficam em public

-- ------------------------------------------------------------------ tipos
do $$ begin create type app.member_role as enum ('owner', 'admin', 'gestor', 'motorista');
exception when duplicate_object then null; end $$;
do $$ begin create type app.member_status as enum ('active', 'disabled');
exception when duplicate_object then null; end $$;
do $$ begin create type app.invite_status as enum ('pendente', 'aceito', 'expirado', 'revogado');
exception when duplicate_object then null; end $$;
do $$ begin create type app.vehicle_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;
do $$ begin create type app.trip_status as enum ('planejada', 'atribuida', 'em_andamento', 'concluida', 'cancelada');
exception when duplicate_object then null; end $$;
do $$ begin create type app.stop_type as enum ('entrega', 'descanso', 'abastecimento', 'pernoite', 'imprevisto', 'nao_classificada');
exception when duplicate_object then null; end $$;
do $$ begin create type app.stop_source as enum ('auto', 'manual');
exception when duplicate_object then null; end $$;
do $$ begin create type app.delivery_status as enum ('pendente', 'entregue', 'falhou');
exception when duplicate_object then null; end $$;
do $$ begin create type app.agent_action_status as enum ('proposta', 'confirmada', 'rejeitada', 'executada', 'falhou');
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ empresa e membros
create table if not exists companies (
  id                        uuid primary key default gen_random_uuid(),
  name                      text not null,
  cnpj                      text unique,
  billing_email             text,
  price_per_vehicle_cents   integer not null default 0 check (price_per_vehicle_cents >= 0),
  -- rastreamento (o app lê daqui o intervalo de envio)
  ping_interval_moving_s    integer not null default 30  check (ping_interval_moving_s between 5 and 600),
  ping_interval_stopped_s   integer not null default 300 check (ping_interval_stopped_s between 30 and 3600),
  -- detecção automática de parada: parado > stop_min_minutes dentro de stop_radius_m
  stop_min_minutes          integer not null default 10 check (stop_min_minutes between 2 and 240),
  stop_radius_m             integer not null default 150 check (stop_radius_m between 20 and 2000),
  -- retenção dos pings crus depois de compactados na viagem (dias)
  raw_ping_retention_days   integer not null default 7 check (raw_ping_retention_days between 1 and 90),
  status                    text not null default 'active' check (status in ('active', 'suspended')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

-- Um usuário pertence a UMA empresa (não existe uso avulso). Motorista só nasce por convite (app.accept_invite).
create table if not exists company_members (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  user_id          uuid not null unique references auth.users(id) on delete cascade,
  role             app.member_role not null,
  status           app.member_status not null default 'active',
  display_name     text not null,
  phone            text,
  default_vehicle_id uuid,                         -- FK abaixo (vehicles é criada depois)
  invite_id        uuid,                           -- convite que originou (motoristas)
  disabled_at      timestamptz,
  disabled_by      uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists company_members_company_idx on company_members (company_id, role, status);

-- ------------------------------------------------------------------ veículos
create table if not exists vehicles (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  plate            text not null,
  label            text,
  preset           text,                           -- id de config/vehicle-presets.json (vuc, toco, truck, carreta...)
  height_m         numeric(4,2),
  width_m          numeric(4,2),
  length_m         numeric(5,2),
  weight_t         numeric(6,2),                   -- PBT
  payload_t        numeric(6,2),                   -- capacidade de carga (CRLV)
  axle_load_t      numeric(5,2),
  axle_count       smallint,
  hazmat           boolean not null default false,
  is_vuc           boolean not null default false,
  status           app.vehicle_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, plate)
);
create index if not exists vehicles_company_idx on vehicles (company_id, status);

do $$ begin
  alter table company_members add constraint company_members_default_vehicle_fk
    foreign key (default_vehicle_id) references vehicles(id) on delete set null;
exception when duplicate_object then null; end $$;

-- Histórico de status do veículo: base da cobrança por veículo ativo (um veículo conta no mês se ficou ativo em
-- algum momento do período). Alimentada por trigger em 0303.
create table if not exists vehicle_status_history (
  id          bigserial primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  vehicle_id  uuid not null references vehicles(id) on delete cascade,
  status      app.vehicle_status not null,
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  changed_by  uuid references auth.users(id)
);
create index if not exists vehicle_status_history_idx on vehicle_status_history (company_id, vehicle_id, valid_from);

-- ------------------------------------------------------------------ convites
-- O código em claro só é mostrado uma vez (retorno de app.create_invite); no banco fica o hash (sha256).
create table if not exists invites (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  created_by       uuid not null references auth.users(id),
  code_hash        text not null unique,
  code_hint        text not null,                  -- últimos 4 caracteres, para o painel
  role             app.member_role not null default 'motorista' check (role in ('gestor', 'motorista')),
  invitee_name     text,
  invitee_email    text,
  invitee_phone    text,
  vehicle_id       uuid references vehicles(id) on delete set null,
  expires_at       timestamptz not null,
  status           app.invite_status not null default 'pendente',
  accepted_at      timestamptz,
  accepted_by      uuid references auth.users(id),
  revoked_at       timestamptz,
  revoked_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  check (expires_at > created_at)
);
create index if not exists invites_company_idx on invites (company_id, status, expires_at);

do $$ begin
  alter table company_members add constraint company_members_invite_fk foreign key (invite_id) references invites(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ viagens
create table if not exists trips (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references companies(id) on delete cascade,
  driver_id            uuid references auth.users(id),          -- motorista (company_members.user_id)
  vehicle_id           uuid references vehicles(id),
  status               app.trip_status not null default 'planejada',
  title                text,
  origin               geometry(Point, 4326),
  origin_label         text,
  destination          geometry(Point, 4326),
  destination_label    text,
  departure_planned_at timestamptz,
  -- rota planejada (POST /api/route): geometria, números e o que foi evitado/avisado
  planned_route        geometry(LineString, 4326),
  planned_distance_m   integer,
  planned_duration_s   integer,
  route_response       jsonb,                                    -- avoided, warnings, legs (sem a geometria)
  -- rota feita (compactada dos pings no fim da viagem): M = epoch (s) de cada ponto
  actual_route         geometry(LineStringM, 4326),
  started_at           timestamptz,
  ended_at             timestamptz,
  distance_m           integer,
  duration_s           integer,
  deviation_max_m      integer,                                  -- maior distância da rota feita à planejada
  summary              text,                                     -- resumo gerado (Second Brain)
  summary_generated_at timestamptz,
  created_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);
create index if not exists trips_company_status_idx on trips (company_id, status, created_at desc);
create index if not exists trips_driver_idx on trips (driver_id, status);
create index if not exists trips_vehicle_idx on trips (vehicle_id, started_at desc);
create index if not exists trips_planned_gix on trips using gist (planned_route);
create index if not exists trips_actual_gix on trips using gist (actual_route);
-- no máximo uma viagem em andamento por motorista
create unique index if not exists trips_one_active_per_driver on trips (driver_id) where status = 'em_andamento';

-- ------------------------------------------------------------------ posições
-- Pings crus: alto volume, apagados raw_ping_retention_days depois de compactados (a viagem guarda a LineStringM).
create table if not exists location_pings (
  id           bigserial primary key,
  company_id   uuid not null references companies(id) on delete cascade,
  driver_id    uuid not null references auth.users(id),
  vehicle_id   uuid references vehicles(id),
  trip_id      uuid references trips(id) on delete set null,
  geom         geometry(Point, 4326) not null,
  speed_kmh    real check (speed_kmh is null or speed_kmh between 0 and 250),
  heading_deg  real check (heading_deg is null or heading_deg >= 0 and heading_deg < 360),
  accuracy_m   real check (accuracy_m is null or accuracy_m >= 0),
  recorded_at  timestamptz not null,                             -- relógio do aparelho
  received_at  timestamptz not null default now(),
  compacted    boolean not null default false
);
create index if not exists location_pings_trip_idx on location_pings (trip_id, recorded_at);
create index if not exists location_pings_driver_idx on location_pings (driver_id, recorded_at desc);
create index if not exists location_pings_company_idx on location_pings (company_id, recorded_at desc);
create index if not exists location_pings_gix on location_pings using gist (geom);
create index if not exists location_pings_compact_idx on location_pings (compacted, received_at) where not compacted;
-- idempotência do envio em lote (o app reenvia o que não recebeu confirmação)
create unique index if not exists location_pings_dedup on location_pings (driver_id, recorded_at);

-- Última posição por motorista: é a tabela que o painel assina no Realtime (1 linha por motorista, atualizada a cada ping).
create table if not exists live_positions (
  driver_id    uuid primary key references auth.users(id) on delete cascade,
  company_id   uuid not null references companies(id) on delete cascade,
  vehicle_id   uuid references vehicles(id),
  trip_id      uuid references trips(id) on delete set null,
  geom         geometry(Point, 4326) not null,
  speed_kmh    real,
  heading_deg  real,
  accuracy_m   real,
  moving       boolean not null default false,
  recorded_at  timestamptz not null,
  updated_at   timestamptz not null default now()
);
create index if not exists live_positions_company_idx on live_positions (company_id);

-- Rastro fora de viagem, compactado por motorista e dia (o histórico não se perde quando não há viagem aberta).
create table if not exists driver_daily_tracks (
  id          bigserial primary key,
  company_id  uuid not null references companies(id) on delete cascade,
  driver_id   uuid not null references auth.users(id),
  day         date not null,
  track       geometry(MultiLineStringM, 4326),
  distance_m  integer,
  ping_count  integer not null default 0,
  unique (driver_id, day)
);
create index if not exists driver_daily_tracks_company_idx on driver_daily_tracks (company_id, day desc);

-- ------------------------------------------------------------------ paradas e entregas
create table if not exists stops (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  trip_id      uuid references trips(id) on delete cascade,
  driver_id    uuid not null references auth.users(id),
  type         app.stop_type not null default 'nao_classificada',
  source       app.stop_source not null,
  geom         geometry(Point, 4326) not null,
  address      text,
  arrived_at   timestamptz not null,
  departed_at  timestamptz,
  duration_s   integer generated always as (case when departed_at is null then null
                                              else extract(epoch from departed_at - arrived_at)::integer end) stored,
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (departed_at is null or departed_at >= arrived_at)
);
create index if not exists stops_trip_idx on stops (trip_id, arrived_at);
create index if not exists stops_company_idx on stops (company_id, type, arrived_at desc);
create index if not exists stops_gix on stops using gist (geom);

create table if not exists deliveries (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  trip_id         uuid not null references trips(id) on delete cascade,
  stop_id         uuid references stops(id) on delete set null,
  sequence        smallint,                                   -- ordem planejada na viagem
  customer_name   text not null,
  address         text not null,
  geom            geometry(Point, 4326),
  window_start    timestamptz,
  window_end      timestamptz,
  status          app.delivery_status not null default 'pendente',
  status_at       timestamptz,
  failure_reason  text,
  proof_photo_path text,                                      -- caminho no Storage (bucket privado da empresa)
  signature_path  text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (window_end is null or window_start is null or window_end >= window_start),
  check (status <> 'falhou' or failure_reason is not null)
);
create index if not exists deliveries_trip_idx on deliveries (trip_id, sequence);
create index if not exists deliveries_company_idx on deliveries (company_id, status, window_start);
create index if not exists deliveries_gix on deliveries using gist (geom);

-- ------------------------------------------------------------------ mensagens (gestor/agente → motorista e resposta)
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references companies(id) on delete cascade,
  trip_id         uuid references trips(id) on delete set null,
  sender_id       uuid references auth.users(id),             -- null = sistema
  recipient_id    uuid not null references auth.users(id),
  body            text not null check (length(body) between 1 and 4000),
  agent_action_id uuid,                                       -- FK abaixo: mensagem enviada pelo agente
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists messages_recipient_idx on messages (recipient_id, created_at desc);
create index if not exists messages_company_idx on messages (company_id, created_at desc);

-- ------------------------------------------------------------------ Second Brain (RAG)
-- Documentos de conhecimento por empresa (resumos de viagem, paradas, entregas, conversas) com embedding.
-- Dimensão 1024 (ex.: Voyage voyage-3.5); trocar o modelo de embedding exige reprocessar (embedding_model registra).
create table if not exists knowledge_docs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id) on delete cascade,
  source_type      text not null check (source_type in ('trip', 'stop', 'delivery', 'conversation', 'note')),
  source_id        uuid,
  title            text,
  content          text not null,
  metadata         jsonb not null default '{}',
  embedding        vector(1024),
  embedding_model  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, source_type, source_id)
);
create index if not exists knowledge_docs_company_idx on knowledge_docs (company_id, source_type, created_at desc);
create index if not exists knowledge_docs_embedding_hnsw on knowledge_docs using hnsw (embedding vector_cosine_ops);

-- ------------------------------------------------------------------ agente (Mentor de Logística)
create table if not exists agent_conversations (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id),          -- gestor que conversa
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists agent_conversations_company_idx on agent_conversations (company_id, updated_at desc);

create table if not exists agent_messages (
  id               bigserial primary key,
  conversation_id  uuid not null references agent_conversations(id) on delete cascade,
  company_id       uuid not null references companies(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant', 'tool')),
  content          jsonb not null,                              -- blocos (texto, tool_use, tool_result)
  model            text,
  input_tokens     integer,
  output_tokens    integer,
  created_at       timestamptz not null default now()
);
create index if not exists agent_messages_conv_idx on agent_messages (conversation_id, id);

-- Log de auditoria das ações do agente. Ações que mexem em rota ou falam com motorista nascem 'proposta' e só
-- executam depois de confirmadas por um gestor (app.confirm_agent_action).
create table if not exists agent_actions (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references companies(id) on delete cascade,
  conversation_id        uuid references agent_conversations(id) on delete set null,
  tool                   text not null,
  input                  jsonb not null,
  requires_confirmation  boolean not null,
  status                 app.agent_action_status not null,
  requested_by           uuid not null references auth.users(id),
  confirmed_by           uuid references auth.users(id),
  confirmed_at           timestamptz,
  executed_at            timestamptz,
  result                 jsonb,
  error                  text,
  created_at             timestamptz not null default now()
);
create index if not exists agent_actions_company_idx on agent_actions (company_id, created_at desc);
create index if not exists agent_actions_pending_idx on agent_actions (company_id) where status = 'proposta';

do $$ begin
  alter table messages add constraint messages_agent_action_fk foreign key (agent_action_id) references agent_actions(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ------------------------------------------------------------------ cobrança
-- Veículos ativos por mês (cobrança por veículo ativo, faturada para a empresa). Um veículo conta no mês se teve
-- algum intervalo 'active' que encosta no mês.
create or replace view billing_active_vehicles_monthly with (security_invoker = true) as
select h.company_id,
       date_trunc('month', m.month_start)::date as month,
       count(distinct h.vehicle_id)              as active_vehicles,
       count(distinct h.vehicle_id) * c.price_per_vehicle_cents as amount_cents
  from vehicle_status_history h
  join companies c on c.id = h.company_id
  cross join lateral generate_series(date_trunc('month', h.valid_from),
                                     date_trunc('month', coalesce(h.valid_to, now())), interval '1 month') as m(month_start)
 where h.status = 'active'
 group by h.company_id, date_trunc('month', m.month_start), c.price_per_vehicle_cents;
