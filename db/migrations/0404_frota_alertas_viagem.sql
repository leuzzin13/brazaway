-- Frota: alertas ao vivo da viagem.
-- Quando o motorista sai da rota do app e vai entrar numa via ou zona proibida para o caminhão naquela hora, a API
-- (POST /pings) avisa na hora: o app apita e a equipe vê no painel. Achado da simulação de 60 dias: um terço das
-- viagens ignorava a rota e daí vinham dois terços das multas que sobraram.
create table if not exists alertas_viagem (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  trip_id      uuid references trips(id) on delete cascade,
  driver_id    uuid references auth.users(id) on delete set null,
  vehicle_id   uuid references vehicles(id) on delete set null,
  tipo         text not null default 'restricao_a_frente',
  item_id      text,
  item_nome    text,
  mensagem     text not null,
  geom         geometry(Point, 4326),
  fora_rota_m  integer,
  criado_em    timestamptz not null default now(),
  visto_em     timestamptz
);
create index if not exists alertas_viagem_company_idx on alertas_viagem (company_id, criado_em desc);
create index if not exists alertas_viagem_trip_idx on alertas_viagem (trip_id, item_id, criado_em desc);

alter table alertas_viagem enable row level security;
alter table alertas_viagem no force row level security;
revoke all on alertas_viagem from anon;
grant select, update on alertas_viagem to authenticated;   -- quem cria é a API (dona da tabela)
grant all on alertas_viagem to service_role;

drop policy if exists frota_alertas_select on alertas_viagem;
drop policy if exists frota_alertas_update on alertas_viagem;
create policy frota_alertas_select on alertas_viagem for select to authenticated
  using (app.staff_of(company_id) or app.self_in(company_id, driver_id));
create policy frota_alertas_update on alertas_viagem for update to authenticated
  using (app.staff_of(company_id) or app.self_in(company_id, driver_id))
  with check (app.staff_of(company_id) or app.self_in(company_id, driver_id));
