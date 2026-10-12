-- Teste de isolamento da Frota (RLS + RPC). Roda numa transação e desfaz tudo no fim.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/tests/frota_rls_test.sql
-- Simula o Supabase: `set local role authenticated` + request.jwt.claims com o sub do usuário.
-- Cada bloco falha com exceção se a regra for violada; no fim imprime "frota RLS: OK".
begin;

-- ---------------------------------------------------------------- dados (como postgres/service_role)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a001', 'owner.a@teste'), ('00000000-0000-0000-0000-00000000a002', 'gestor.a@teste'),
  ('00000000-0000-0000-0000-00000000a003', 'mot1.a@teste'),  ('00000000-0000-0000-0000-00000000a004', 'mot2.a@teste'),
  ('00000000-0000-0000-0000-00000000b001', 'owner.b@teste'), ('00000000-0000-0000-0000-00000000b003', 'mot1.b@teste'),
  ('00000000-0000-0000-0000-00000000c001', 'sem.convite@teste'), ('00000000-0000-0000-0000-00000000c002', 'novo.mot@teste');
insert into companies (id, name, price_per_vehicle_cents) values
  ('00000000-0000-0000-0000-0000000000aa', 'Transportes A', 9900), ('00000000-0000-0000-0000-0000000000bb', 'Transportes B', 9900);
insert into company_members (company_id, user_id, role, display_name) values
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a001', 'owner', 'Owner A'),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a002', 'gestor', 'Gestor A'),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a003', 'motorista', 'Motorista A1'),
  ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a004', 'motorista', 'Motorista A2'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-00000000b001', 'owner', 'Owner B'),
  ('00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-00000000b003', 'motorista', 'Motorista B1');
insert into vehicles (id, company_id, plate, preset) values
  ('00000000-0000-0000-0000-0000000a0001', '00000000-0000-0000-0000-0000000000aa', 'AAA1A11', 'toco'),
  ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-0000000000bb', 'BBB1B11', 'carreta');
insert into trips (id, company_id, driver_id, vehicle_id, status, title) values
  ('00000000-0000-0000-0000-00000a0000a1', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-0000000a0001', 'atribuida', 'A1'),
  ('00000000-0000-0000-0000-00000a0000a2', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a004', null, 'atribuida', 'A2'),
  ('00000000-0000-0000-0000-00000b0000b1', '00000000-0000-0000-0000-0000000000bb', '00000000-0000-0000-0000-00000000b003', '00000000-0000-0000-0000-0000000b0001', 'atribuida', 'B1');
insert into deliveries (id, company_id, trip_id, customer_name, address) values
  ('00000000-0000-0000-0000-0000000d00a1', '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000a0000a1', 'Cliente A', 'Rua X, 1');

create temporary table _t (k text primary key, v text) on commit drop;
grant all on _t to authenticated;

create or replace function pg_temp.as_user(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; end $$;

-- ---------------------------------------------------------------- owner A
select pg_temp.as_user('00000000-0000-0000-0000-00000000a001');
select pg_temp.check((select count(*) from companies) = 1, 'owner A vê só a própria empresa');
select pg_temp.check((select count(*) from company_members) = 4, 'owner A vê os 4 membros da A');
select pg_temp.check((select count(*) from trips) = 2, 'owner A vê as 2 viagens da A');
select pg_temp.check((select count(*) from vehicles where plate = 'BBB1B11') = 0, 'owner A não vê veículo da B');
-- convite: gera, código em claro só no retorno
insert into _t select 'code', code from app.create_invite('motorista', '00000000-0000-0000-0000-0000000a0001', 'Novo', null, null, 48);
select pg_temp.check((select count(*) from invites where status = 'pendente') = 1, 'convite pendente criado');
select pg_temp.check((select code_hash from invites limit 1) <> (select v from _t where k = 'code'), 'banco guarda hash, não o código');
-- escrita cruzada bloqueada
do $$ begin
  insert into trips (company_id, title) values ('00000000-0000-0000-0000-0000000000bb', 'invasão');
  raise exception 'FALHOU: owner A inseriu viagem na B';
exception when insufficient_privilege then null; end $$;
with u as (update trips set title = 'x' where company_id = '00000000-0000-0000-0000-0000000000bb' returning 1)
select pg_temp.check((select count(*) from u) = 0, 'owner A não altera viagem da B');
reset role;

-- ---------------------------------------------------------------- usuário sem convite
select pg_temp.as_user('00000000-0000-0000-0000-00000000c001');
select pg_temp.check((select count(*) from companies) = 0, 'sem convite: não vê empresa');
select pg_temp.check((select count(*) from trips) = 0, 'sem convite: não vê viagem');
do $$ begin
  perform app.accept_invite('ZZZZZ-ZZZZZ', 'Fulano');
  raise exception 'FALHOU: aceitou código inválido';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform app.send_pings('[{"lat":-23.5,"lon":-46.6,"recorded_at":"2026-10-12T10:00:00Z"}]');
  raise exception 'FALHOU: sem empresa enviou ping';
exception when insufficient_privilege then null; end $$;
reset role;

-- ---------------------------------------------------------------- novo motorista aceita o convite
select pg_temp.as_user('00000000-0000-0000-0000-00000000c002');
select app.accept_invite((select v from _t where k = 'code'), 'Motorista Novo');
select pg_temp.check(app.my_role() = 'motorista', 'convite aceito vira motorista');
select pg_temp.check((select default_vehicle_id from company_members where user_id = auth.uid()) = '00000000-0000-0000-0000-0000000a0001',
                     'convite vincula o veículo');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000c001');
do $$ begin
  perform app.accept_invite((select v from _t where k = 'code'), 'Reuso');
  raise exception 'FALHOU: convite reutilizado';
exception when insufficient_privilege then null; end $$;
reset role;

-- ---------------------------------------------------------------- motorista A1
select pg_temp.as_user('00000000-0000-0000-0000-00000000a003');
select pg_temp.check((select count(*) from trips) = 1, 'motorista A1 vê só a própria viagem');
select pg_temp.check((select count(*) from company_members) = 1, 'motorista vê só o próprio cadastro');
select pg_temp.check((select count(*) from invites) = 0, 'motorista não vê convites');
select pg_temp.check((select count(*) from deliveries) = 1, 'motorista A1 vê a entrega da sua viagem');
select pg_temp.check((select count(*) from vehicles) = 1, 'motorista vê o veículo da sua viagem');
do $$ begin
  update company_members set role = 'admin' where user_id = auth.uid();
  raise exception 'FALHOU: motorista se promoveu';
exception when insufficient_privilege then null; end $$;
with u as (update trips set title = 'x' returning 1)
select pg_temp.check((select count(*) from u) = 0, 'motorista não altera viagem direto');
select app.start_trip('00000000-0000-0000-0000-00000a0000a1');
select app.send_pings('[{"lat":-23.5500,"lon":-46.6300,"speed_kmh":40,"recorded_at":"2026-10-12T10:00:00Z"},
                        {"lat":-23.5501,"lon":-46.6301,"speed_kmh":0,"recorded_at":"2026-10-12T10:01:00Z"},
                        {"lat":-23.5501,"lon":-46.6301,"speed_kmh":0,"recorded_at":"2026-10-12T10:20:00Z"},
                        {"lat":-23.5600,"lon":-46.6400,"speed_kmh":50,"recorded_at":"2026-10-12T10:30:00Z"}]');
select pg_temp.check((select count(*) from location_pings where trip_id = '00000000-0000-0000-0000-00000a0000a1') = 4, 'pings ligados à viagem');
select pg_temp.check((select count(*) from live_positions) = 1, 'última posição gravada');
select app.send_pings('[{"lat":-23.5600,"lon":-46.6400,"recorded_at":"2026-10-12T10:30:00Z"}]');   -- reenvio
select pg_temp.check((select count(*) from location_pings) = 4, 'reenvio é idempotente');
do $$ begin
  insert into location_pings (company_id, driver_id, geom, recorded_at)
  values ('00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-00000000a004', ST_SetSRID(ST_MakePoint(-46.6, -23.5), 4326), now());
  raise exception 'FALHOU: motorista gravou ping em nome de outro';
exception when insufficient_privilege then null; end $$;
select app.register_delivery('00000000-0000-0000-0000-0000000d00a1', 'entregue', null,
                             '00000000-0000-0000-0000-0000000000aa/comprovantes/1.jpg');
select app.end_trip('00000000-0000-0000-0000-00000a0000a1');
select pg_temp.check((select distance_m > 1000 and actual_route is not null from trips where id = '00000000-0000-0000-0000-00000a0000a1'),
                     'viagem compactada (LineStringM e distância)');
select pg_temp.check((select count(*) from stops where source = 'auto') = 1, 'parada automática detectada (19 min parado)');
insert into messages (company_id, sender_id, recipient_id, body)
values ('00000000-0000-0000-0000-0000000000aa', auth.uid(), '00000000-0000-0000-0000-00000000a002', 'Entregue, voltando');
do $$ begin
  insert into messages (company_id, sender_id, recipient_id, body)
  values ('00000000-0000-0000-0000-0000000000aa', auth.uid(), '00000000-0000-0000-0000-00000000a004', 'oi colega');
  raise exception 'FALHOU: motorista mandou mensagem para outro motorista';
exception when insufficient_privilege then null; end $$;
reset role;

-- ---------------------------------------------------------------- motorista A2 não vê nada do A1
select pg_temp.as_user('00000000-0000-0000-0000-00000000a004');
select pg_temp.check((select count(*) from location_pings) = 0, 'A2 não vê pings do A1');
select pg_temp.check((select count(*) from live_positions) = 0, 'A2 não vê posição do A1');
select pg_temp.check((select count(*) from deliveries) = 0, 'A2 não vê entrega do A1');
select pg_temp.check((select count(*) from messages) = 0, 'A2 não vê mensagem do A1');
reset role;

-- ---------------------------------------------------------------- gestor A
select pg_temp.as_user('00000000-0000-0000-0000-00000000a002');
select pg_temp.check((select count(*) from live_positions) = 1, 'gestor vê posição ao vivo da empresa');
select pg_temp.check((select count(*) from messages) = 1, 'gestor vê mensagens da empresa');
do $$ begin
  perform app.set_member_status('00000000-0000-0000-0000-00000000a001', 'disabled');
  raise exception 'FALHOU: gestor desativou owner';
exception when insufficient_privilege then null; end $$;
select app.set_member_status('00000000-0000-0000-0000-00000000a004', 'disabled');
do $$ begin
  perform app.create_invite('gestor');
  raise exception 'FALHOU: gestor convidou gestor';
exception when insufficient_privilege then null; end $$;
reset role;

-- ---------------------------------------------------------------- motorista desativado perde acesso
select pg_temp.as_user('00000000-0000-0000-0000-00000000a004');
select pg_temp.check((select count(*) from trips) = 0, 'desativado não vê a própria viagem');
select pg_temp.check((select count(*) from companies) = 0, 'desativado não vê a empresa');
reset role;

-- ---------------------------------------------------------------- empresa B não vê nada da A
select pg_temp.as_user('00000000-0000-0000-0000-00000000b001');
select pg_temp.check((select count(*) from trips) = 1, 'owner B vê só a viagem da B');
select pg_temp.check((select count(*) from location_pings) + (select count(*) from live_positions) + (select count(*) from stops)
                     + (select count(*) from deliveries) + (select count(*) from messages) + (select count(*) from invites) = 0,
                     'owner B não vê pings, posições, paradas, entregas, mensagens nem convites da A');
do $$ begin
  perform app.revoke_invite((select id from invites limit 1));
  raise exception 'FALHOU: B revogou convite da A';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform app.register_delivery('00000000-0000-0000-0000-0000000d00a1', 'falhou', 'teste');
  raise exception 'FALHOU: B mexeu em entrega da A';
exception when insufficient_privilege then null; end $$;
reset role;

-- ---------------------------------------------------------------- anon não vê nada
set local role anon;
do $$ begin
  perform count(*) from trips;
  raise exception 'FALHOU: anon leu trips';
exception when insufficient_privilege then null; end $$;
reset role;

-- ---------------------------------------------------------------- cobrança
select pg_temp.check((select active_vehicles from billing_active_vehicles_monthly
                       where company_id = '00000000-0000-0000-0000-0000000000aa' and month = date_trunc('month', now())::date) = 1,
                     'cobrança: 1 veículo ativo na A no mês');

select 'frota RLS: OK' as resultado;
rollback;
