-- Frota: Row Level Security.
--
-- Regras:
--   * empresa só vê os próprios dados (company_id = app.company_id());
--   * owner/admin/gestor ("equipe") veem tudo da empresa; motorista só vê o que é dele;
--   * membro desativado perde todo acesso na hora (as funções auxiliares só enxergam membro 'active');
--   * escritas sensíveis (aceitar/revogar convite, desativar membro, abrir/fechar viagem, entrega, ler mensagem)
--     passam por funções SECURITY DEFINER em 0303, que validam papel e posse; as políticas abaixo deixam o
--     mínimo de escrita direta;
--   * anon não acessa nada; service_role (edge functions, jobs) ignora RLS.

-- ------------------------------------------------------------------ funções auxiliares (usadas nas políticas)
-- SECURITY DEFINER para ler company_members sem recursão de RLS; search_path fixo.
create or replace function app.my_membership() returns company_members
language sql stable security definer set search_path = public, pg_temp as $$
  select m.* from company_members m
    join companies c on c.id = m.company_id
   where m.user_id = auth.uid() and m.status = 'active' and c.status = 'active'
$$;

create or replace function app.company_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select (app.my_membership()).company_id
$$;

create or replace function app.my_role() returns app.member_role
language sql stable security definer set search_path = public, pg_temp as $$
  select (app.my_membership()).role
$$;

create or replace function app.is_staff() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.my_role() in ('owner', 'admin', 'gestor'), false)
$$;

create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(app.my_role() in ('owner', 'admin'), false)
$$;

-- equipe da empresa da linha
create or replace function app.staff_of(cid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select cid is not null and cid = app.company_id() and app.is_staff()
$$;

-- motorista dono da linha (na própria empresa)
create or replace function app.self_in(cid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select cid is not null and cid = app.company_id() and uid = auth.uid()
$$;

-- destinatário válido de mensagem: membro ativo da empresa; motorista só escreve para a equipe
create or replace function app.can_message(recipient uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from company_members m
                  where m.user_id = recipient and m.company_id = app.company_id() and m.status = 'active'
                    and (app.is_staff() or m.role in ('owner', 'admin', 'gestor')))
$$;

grant usage on schema app to authenticated, service_role;
grant execute on all functions in schema app to authenticated, service_role;

-- ------------------------------------------------------------------ privilégios de tabela (RLS restringe as linhas)
do $$
declare t text;
begin
  foreach t in array array['companies','company_members','vehicles','vehicle_status_history','invites','trips',
                           'location_pings','live_positions','driver_daily_tracks','stops','deliveries','messages',
                           'knowledge_docs','agent_conversations','agent_messages','agent_actions'] loop
    execute format('alter table %I enable row level security', t);
    -- sem FORCE: o dono das tabelas (que também é o dono das funções SECURITY DEFINER) não passa pela RLS
    execute format('alter table %I no force row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant select on billing_active_vehicles_monthly to authenticated, service_role;
revoke all on billing_active_vehicles_monthly from anon;

-- recria as políticas (idempotente)
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and policyname like 'frota_%' loop
    execute format('drop policy %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

-- ------------------------------------------------------------------ companies
create policy frota_companies_select on companies for select to authenticated using (id = app.company_id());
create policy frota_companies_update on companies for update to authenticated
  using (id = app.company_id() and app.is_admin()) with check (id = app.company_id());
-- criação/exclusão de empresa: só service_role (onboarding comercial)

-- ------------------------------------------------------------------ company_members
create policy frota_members_select on company_members for select to authenticated
  using (app.staff_of(company_id) or user_id = auth.uid());
-- owner/admin editam membros da empresa (papel, nome, veículo padrão); ninguém vira owner por aqui
create policy frota_members_update on company_members for update to authenticated
  using (app.is_admin() and company_id = app.company_id())
  with check (company_id = app.company_id() and (role <> 'owner' or app.my_role() = 'owner'));
-- o próprio usuário atualiza nome e telefone (as colunas sensíveis ficam protegidas pelo trigger em 0303)
create policy frota_members_update_self on company_members for update to authenticated
  using (user_id = auth.uid() and company_id = app.company_id())
  with check (user_id = auth.uid() and company_id = app.company_id());
-- inserção: só app.accept_invite (motorista/gestor) e service_role (owner no onboarding)

-- ------------------------------------------------------------------ vehicles
create policy frota_vehicles_select on vehicles for select to authenticated
  using (app.staff_of(company_id)
         or (company_id = app.company_id() and (
               id = (app.my_membership()).default_vehicle_id
               or exists (select 1 from trips t where t.vehicle_id = vehicles.id and t.driver_id = auth.uid()))));
create policy frota_vehicles_insert on vehicles for insert to authenticated with check (app.staff_of(company_id));
create policy frota_vehicles_update on vehicles for update to authenticated
  using (app.staff_of(company_id)) with check (app.staff_of(company_id));
create policy frota_vehicles_delete on vehicles for delete to authenticated using (app.is_admin() and company_id = app.company_id());

create policy frota_vsh_select on vehicle_status_history for select to authenticated using (app.staff_of(company_id));

-- ------------------------------------------------------------------ invites (escrita só pelas funções em 0303)
create policy frota_invites_select on invites for select to authenticated using (app.staff_of(company_id));

-- ------------------------------------------------------------------ trips
create policy frota_trips_select on trips for select to authenticated
  using (app.staff_of(company_id) or app.self_in(company_id, driver_id));
create policy frota_trips_insert on trips for insert to authenticated with check (app.staff_of(company_id));
create policy frota_trips_update on trips for update to authenticated
  using (app.staff_of(company_id)) with check (app.staff_of(company_id));
create policy frota_trips_delete on trips for delete to authenticated
  using (app.is_admin() and company_id = app.company_id() and status in ('planejada', 'cancelada'));
-- motorista abre/fecha a viagem por app.start_trip / app.end_trip

-- ------------------------------------------------------------------ location_pings
create policy frota_pings_select on location_pings for select to authenticated
  using (app.staff_of(company_id) or app.self_in(company_id, driver_id));
-- o motorista grava os próprios pings (também há app.send_pings, que é o caminho do app)
create policy frota_pings_insert on location_pings for insert to authenticated
  with check (app.self_in(company_id, driver_id)
              and (trip_id is null or exists (select 1 from trips t where t.id = trip_id and t.driver_id = auth.uid()
                                                                        and t.status = 'em_andamento')));

create policy frota_live_select on live_positions for select to authenticated
  using (app.staff_of(company_id) or app.self_in(company_id, driver_id));

create policy frota_tracks_select on driver_daily_tracks for select to authenticated
  using (app.staff_of(company_id) or app.self_in(company_id, driver_id));

-- ------------------------------------------------------------------ stops
create policy frota_stops_select on stops for select to authenticated
  using (app.staff_of(company_id) or app.self_in(company_id, driver_id));
create policy frota_stops_insert on stops for insert to authenticated
  with check (app.staff_of(company_id)
              or (app.self_in(company_id, driver_id) and source = 'manual'
                  and (trip_id is null or exists (select 1 from trips t where t.id = trip_id and t.driver_id = auth.uid()))));
create policy frota_stops_update on stops for update to authenticated
  using (app.staff_of(company_id) or app.self_in(company_id, driver_id))
  with check (app.staff_of(company_id) or app.self_in(company_id, driver_id));

-- ------------------------------------------------------------------ deliveries
create policy frota_deliveries_select on deliveries for select to authenticated
  using (app.staff_of(company_id)
         or (company_id = app.company_id()
             and exists (select 1 from trips t where t.id = deliveries.trip_id and t.driver_id = auth.uid())));
create policy frota_deliveries_insert on deliveries for insert to authenticated with check (app.staff_of(company_id));
create policy frota_deliveries_update on deliveries for update to authenticated
  using (app.staff_of(company_id)) with check (app.staff_of(company_id));
create policy frota_deliveries_delete on deliveries for delete to authenticated using (app.staff_of(company_id));
-- motorista registra entrega por app.register_delivery

-- ------------------------------------------------------------------ messages
create policy frota_messages_select on messages for select to authenticated
  using (app.staff_of(company_id)
         or (company_id = app.company_id() and (recipient_id = auth.uid() or sender_id = auth.uid())));
-- equipe escreve para membros da empresa; motorista responde à equipe da própria empresa
create policy frota_messages_insert on messages for insert to authenticated
  with check (company_id = app.company_id() and sender_id = auth.uid() and agent_action_id is null
              and app.can_message(recipient_id));
-- leitura (read_at) por app.mark_messages_read

-- ------------------------------------------------------------------ Second Brain e agente (só equipe)
create policy frota_knowledge_select on knowledge_docs for select to authenticated using (app.staff_of(company_id));

create policy frota_agent_conv_select on agent_conversations for select to authenticated
  using (app.staff_of(company_id) and (user_id = auth.uid() or app.is_admin()));
create policy frota_agent_conv_insert on agent_conversations for insert to authenticated
  with check (app.staff_of(company_id) and user_id = auth.uid());

create policy frota_agent_msg_select on agent_messages for select to authenticated
  using (app.staff_of(company_id)
         and exists (select 1 from agent_conversations c where c.id = conversation_id and (c.user_id = auth.uid() or app.is_admin())));

create policy frota_agent_actions_select on agent_actions for select to authenticated using (app.staff_of(company_id));
-- agent_messages/agent_actions são gravadas pela edge function do agente (service_role) e confirmadas por
-- app.confirm_agent_action / app.reject_agent_action

-- ------------------------------------------------------------------ Realtime (Supabase): o painel assina live_positions
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table live_positions;
    exception when duplicate_object then null; end;
    begin
      alter publication supabase_realtime add table messages;
    exception when duplicate_object then null; end;
  end if;
end $$;
