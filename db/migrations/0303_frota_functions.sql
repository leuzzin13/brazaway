-- Frota: funções (RPC chamadas pelo app/painel/edge functions) e triggers.
-- Todas as RPC são SECURITY DEFINER com search_path fixo e validam papel/posse explicitamente.
-- No Supabase, chamadas pelo cliente via supabase.rpc('<nome>', {...}) (schema app exposto na API) ou pelas edge
-- functions.

-- ------------------------------------------------------------------ utilitários
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['companies','company_members','vehicles','trips','stops','deliveries','knowledge_docs',
                           'agent_conversations'] loop
    execute format('drop trigger if exists frota_touch on %I', t);
    execute format('create trigger frota_touch before update on %I for each row execute function app.touch_updated_at()', t);
  end loop;
end $$;

create or replace function app.require(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception '%', msg using errcode = '42501'; end if; end $$;

-- ------------------------------------------------------------------ company_members: colunas protegidas
-- O próprio membro só muda display_name/phone; papel, status, empresa, veículo padrão etc. só owner/admin ou RPC.
create or replace function app.guard_member_update() returns trigger language plpgsql as $$
begin
  -- Dentro de RPC (SECURITY DEFINER) o current_user é o dono da função; service_role e conexões administrativas
  -- também não passam pela trava. Só o cliente (authenticated) é travado.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.company_id <> old.company_id or new.user_id <> old.user_id or new.invite_id is distinct from old.invite_id then
    raise exception 'empresa, usuário e convite do membro não podem ser alterados' using errcode = '42501';
  end if;
  if not app.is_admin() and (new.role <> old.role or new.status <> old.status
                             or new.default_vehicle_id is distinct from old.default_vehicle_id) then
    raise exception 'só owner/admin alteram papel, status ou veículo do membro' using errcode = '42501';
  end if;
  if (old.role = 'owner' or new.role = 'owner') and new.role <> old.role and app.my_role() <> 'owner' then
    raise exception 'só o owner transfere ou altera o papel owner' using errcode = '42501';
  end if;
  if new.status = 'disabled' and old.status = 'active' then
    new.disabled_at := now(); new.disabled_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists frota_guard_member on company_members;
create trigger frota_guard_member before update on company_members for each row execute function app.guard_member_update();

-- ------------------------------------------------------------------ veículos: histórico de status (cobrança)
create or replace function app.track_vehicle_status() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.status <> old.status then
    update vehicle_status_history set valid_to = now()
     where vehicle_id = new.id and valid_to is null;
    insert into vehicle_status_history (company_id, vehicle_id, status, changed_by)
    values (new.company_id, new.id, new.status, auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists frota_vehicle_status on vehicles;
create trigger frota_vehicle_status after insert or update of status on vehicles
  for each row execute function app.track_vehicle_status();

-- ------------------------------------------------------------------ convites
create or replace function app.hash_code(code text) returns text language sql immutable as $$
  select encode(digest(upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
$$;

-- Gera convite de uso único. Retorna o código em claro UMA vez (o banco guarda só o hash).
-- Código: 10 caracteres sem ambiguidades (sem 0/O/1/I), formato XXXXX-XXXXX.
create or replace function app.create_invite(p_role app.member_role default 'motorista', p_vehicle_id uuid default null,
                                             p_invitee_name text default null, p_invitee_email text default null,
                                             p_invitee_phone text default null, p_valid_hours integer default 72)
returns table (invite_id uuid, code text, expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  cid uuid := app.company_id();
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw bytea := gen_random_bytes(10);
  c text := '';
  i int;
  inv invites;
begin
  perform app.require(app.is_staff(), 'só a equipe da empresa gera convites');
  perform app.require(p_role in ('motorista', 'gestor'), 'convite só para motorista ou gestor');
  perform app.require(p_role = 'motorista' or app.is_admin(), 'só owner/admin convidam gestor');
  perform app.require(p_valid_hours between 1 and 720, 'validade entre 1 h e 30 dias');
  perform app.require(p_vehicle_id is null or exists (select 1 from vehicles v where v.id = p_vehicle_id and v.company_id = cid),
                      'veículo não é da empresa');
  for i in 0..9 loop c := c || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1); end loop;
  c := substr(c, 1, 5) || '-' || substr(c, 6, 5);
  insert into invites (company_id, created_by, code_hash, code_hint, role, invitee_name, invitee_email, invitee_phone,
                       vehicle_id, expires_at)
  values (cid, auth.uid(), app.hash_code(c), right(c, 4), p_role, p_invitee_name, p_invitee_email, p_invitee_phone,
          p_vehicle_id, now() + make_interval(hours => p_valid_hours))
  returning * into inv;
  return query select inv.id, c, inv.expires_at;
end $$;

-- Usuário autenticado SEM empresa aceita o convite: vira membro da empresa do convite. Sem convite válido, não há
-- cadastro (o usuário de auth.users fica sem acesso a nada; ver docs/frota/README.md sobre o hook de cadastro).
create or replace function app.accept_invite(p_code text, p_display_name text, p_phone text default null)
returns company_members
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  inv invites;
  m company_members;
begin
  perform app.require(auth.uid() is not null, 'precisa estar autenticado');
  perform app.require(not exists (select 1 from company_members where user_id = auth.uid()), 'usuário já pertence a uma empresa');
  perform app.require(length(trim(coalesce(p_display_name, ''))) >= 2, 'informe o nome');
  select * into inv from invites where code_hash = app.hash_code(p_code) for update;
  perform app.require(found, 'convite inválido');
  if inv.status = 'pendente' and inv.expires_at <= now() then
    update invites set status = 'expirado' where id = inv.id;
    inv.status := 'expirado';
  end if;
  perform app.require(inv.status = 'pendente', 'convite ' || inv.status::text);
  perform app.require((select status from companies where id = inv.company_id) = 'active', 'empresa inativa');
  insert into company_members (company_id, user_id, role, display_name, phone, default_vehicle_id, invite_id)
  values (inv.company_id, auth.uid(), inv.role, trim(p_display_name), coalesce(p_phone, inv.invitee_phone),
          inv.vehicle_id, inv.id)
  returning * into m;
  update invites set status = 'aceito', accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  return m;
end $$;

create or replace function app.revoke_invite(p_invite_id uuid) returns invites
language plpgsql security definer set search_path = public, pg_temp as $$
declare inv invites;
begin
  select * into inv from invites where id = p_invite_id for update;
  perform app.require(found and app.staff_of(inv.company_id), 'convite não encontrado');
  perform app.require(inv.status = 'pendente', 'só convite pendente pode ser revogado (está ' || inv.status::text || ')');
  update invites set status = 'revogado', revoked_at = now(), revoked_by = auth.uid() where id = inv.id returning * into inv;
  return inv;
end $$;

-- job: marca convites vencidos
create or replace function app.expire_invites() returns integer
language sql security definer set search_path = public, pg_temp as $$
  with u as (update invites set status = 'expirado' where status = 'pendente' and expires_at <= now() returning 1)
  select count(*)::int from u
$$;

-- ------------------------------------------------------------------ membros: ativar/desativar
-- Gestor desativa/reativa motoristas; owner/admin desativam também gestores/admins. Ninguém desativa o owner nem a si.
create or replace function app.set_member_status(p_user_id uuid, p_status app.member_status) returns company_members
language plpgsql security definer set search_path = public, pg_temp as $$
declare m company_members;
begin
  select * into m from company_members where user_id = p_user_id for update;
  perform app.require(found and app.staff_of(m.company_id), 'membro não encontrado');
  perform app.require(p_user_id <> auth.uid(), 'não é possível alterar o próprio status');
  perform app.require(m.role <> 'owner', 'o owner não pode ser desativado');
  perform app.require(m.role = 'motorista' or app.is_admin(), 'gestor só altera motoristas');
  update company_members
     set status = p_status,
         disabled_at = case when p_status = 'disabled' then now() end,
         disabled_by = case when p_status = 'disabled' then auth.uid() end
   where id = m.id returning * into m;
  if p_status = 'disabled' then
    delete from live_positions where driver_id = p_user_id;
  end if;
  return m;
end $$;

-- ------------------------------------------------------------------ posições
-- Envio em lote: [{lat, lon, speed_kmh, heading_deg, accuracy_m, recorded_at, trip_id?}]. Idempotente
-- (driver_id, recorded_at). trip_id omitido = viagem em andamento do motorista. Retorna o intervalo de envio vigente.
create or replace function app.send_pings(p_pings jsonb, p_vehicle_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me company_members := app.my_membership();
  co companies;
  active_trip trips;
  n int;
begin
  perform app.require(me.user_id is not null, 'sem acesso');
  perform app.require(jsonb_typeof(p_pings) = 'array' and jsonb_array_length(p_pings) between 1 and 500, 'envie de 1 a 500 pings');
  select * into co from companies where id = me.company_id;
  select * into active_trip from trips where driver_id = me.user_id and status = 'em_andamento';
  perform app.require(p_vehicle_id is null or exists (select 1 from vehicles v where v.id = p_vehicle_id and v.company_id = me.company_id),
                      'veículo não é da empresa');
  insert into location_pings (company_id, driver_id, vehicle_id, trip_id, geom, speed_kmh, heading_deg, accuracy_m, recorded_at)
  select me.company_id, me.user_id,
         coalesce(p_vehicle_id, active_trip.vehicle_id, me.default_vehicle_id),
         case when (p->>'trip_id') is not null and (p->>'trip_id')::uuid = active_trip.id then active_trip.id
              when (p->>'trip_id') is null then active_trip.id end,
         ST_SetSRID(ST_MakePoint((p->>'lon')::float8, (p->>'lat')::float8), 4326),
         (p->>'speed_kmh')::real, (p->>'heading_deg')::real, (p->>'accuracy_m')::real,
         (p->>'recorded_at')::timestamptz
    from jsonb_array_elements(p_pings) p
   where (p->>'lat')::float8 between -90 and 90 and (p->>'lon')::float8 between -180 and 180
     and (p->>'recorded_at')::timestamptz between now() - interval '7 days' and now() + interval '5 minutes'
  on conflict (driver_id, recorded_at) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('accepted', n, 'trip_id', active_trip.id,
                            'interval_moving_s', co.ping_interval_moving_s, 'interval_stopped_s', co.ping_interval_stopped_s);
end $$;

-- cada ping atualiza a última posição (é ela que vai para o painel pelo Realtime)
create or replace function app.ping_to_live() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into live_positions as l (driver_id, company_id, vehicle_id, trip_id, geom, speed_kmh, heading_deg, accuracy_m,
                                   moving, recorded_at, updated_at)
  values (new.driver_id, new.company_id, new.vehicle_id, new.trip_id, new.geom, new.speed_kmh, new.heading_deg,
          new.accuracy_m, coalesce(new.speed_kmh, 0) >= 5, new.recorded_at, now())
  on conflict (driver_id) do update
    set company_id = excluded.company_id, vehicle_id = excluded.vehicle_id, trip_id = excluded.trip_id,
        geom = excluded.geom, speed_kmh = excluded.speed_kmh, heading_deg = excluded.heading_deg,
        accuracy_m = excluded.accuracy_m, moving = excluded.moving, recorded_at = excluded.recorded_at, updated_at = now()
    where l.recorded_at <= excluded.recorded_at;
  return null;
end $$;
drop trigger if exists frota_ping_live on location_pings;
create trigger frota_ping_live after insert on location_pings for each row execute function app.ping_to_live();

-- ------------------------------------------------------------------ viagens
-- Motorista inicia a viagem atribuída a ele (ou cria uma avulsa se p_trip_id for null).
create or replace function app.start_trip(p_trip_id uuid default null, p_title text default null,
                                          p_vehicle_id uuid default null) returns trips
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me company_members := app.my_membership();
  t trips;
begin
  perform app.require(me.user_id is not null, 'sem acesso');
  perform app.require(p_vehicle_id is null or exists (select 1 from vehicles v where v.id = p_vehicle_id and v.company_id = me.company_id),
                      'veículo não é da empresa');
  if p_trip_id is null then
    -- viagem avulsa: quem inicia é o motorista dela
    perform app.require(me.role = 'motorista', 'viagem avulsa só pelo motorista; a equipe cria e atribui a viagem');
    perform app.require(not exists (select 1 from trips where driver_id = me.user_id and status = 'em_andamento'),
                        'já existe viagem em andamento');
    insert into trips (company_id, driver_id, vehicle_id, status, title, started_at, created_by)
    values (me.company_id, me.user_id, coalesce(p_vehicle_id, me.default_vehicle_id), 'em_andamento',
            coalesce(p_title, 'Viagem avulsa'), now(), me.user_id)
    returning * into t;
  else
    select * into t from trips where id = p_trip_id for update;
    perform app.require(found and t.company_id = me.company_id and (t.driver_id = me.user_id or app.is_staff()),
                        'viagem não encontrada');
    perform app.require(t.status in ('planejada', 'atribuida'), 'viagem ' || t.status::text);
    -- o motorista da viagem é o atribuído; sem atribuição, só um motorista pode assumi-la (a equipe atribui antes)
    perform app.require(t.driver_id is not null or me.role = 'motorista', 'atribua um motorista antes de iniciar a viagem');
    perform app.require(not exists (select 1 from trips x where x.driver_id = coalesce(t.driver_id, me.user_id)
                                                          and x.status = 'em_andamento'),
                        'o motorista já tem viagem em andamento');
    update trips set status = 'em_andamento', started_at = now(),
                     driver_id = coalesce(driver_id, me.user_id),
                     vehicle_id = coalesce(vehicle_id, p_vehicle_id,
                                           (select m.default_vehicle_id from company_members m where m.user_id = coalesce(t.driver_id, me.user_id)))
     where id = t.id returning * into t;
  end if;
  return t;
end $$;

create or replace function app.end_trip(p_trip_id uuid, p_cancel boolean default false) returns trips
language plpgsql security definer set search_path = public, pg_temp as $$
declare t trips;
begin
  select * into t from trips where id = p_trip_id for update;
  perform app.require(found and t.company_id = app.company_id() and (t.driver_id = auth.uid() or app.is_staff()),
                      'viagem não encontrada');
  perform app.require(t.status in ('em_andamento', 'planejada', 'atribuida'), 'viagem ' || t.status::text);
  update trips set status = case when p_cancel then 'cancelada'::app.trip_status else 'concluida' end,
                   ended_at = case when t.started_at is not null then now() end
   where id = t.id returning * into t;
  if t.started_at is not null then
    perform app.compact_trip(t.id);
    select * into t from trips where id = t.id;
  end if;
  return t;
end $$;

-- Gestor atribui viagem a um motorista (e opcionalmente a um veículo). Também usada pela tool do agente.
create or replace function app.assign_trip(p_trip_id uuid, p_driver_id uuid, p_vehicle_id uuid default null) returns trips
language plpgsql security definer set search_path = public, pg_temp as $$
declare t trips;
begin
  select * into t from trips where id = p_trip_id for update;
  perform app.require(found and app.staff_of(t.company_id), 'viagem não encontrada');
  perform app.require(t.status in ('planejada', 'atribuida'), 'viagem ' || t.status::text);
  perform app.require(exists (select 1 from company_members m where m.user_id = p_driver_id and m.company_id = t.company_id
                                                                and m.role = 'motorista' and m.status = 'active'),
                      'motorista não é da empresa ou está desativado');
  perform app.require(p_vehicle_id is null or exists (select 1 from vehicles v where v.id = p_vehicle_id and v.company_id = t.company_id
                                                                                 and v.status = 'active'),
                      'veículo não é da empresa ou está inativo');
  update trips set driver_id = p_driver_id, vehicle_id = coalesce(p_vehicle_id, vehicle_id), status = 'atribuida'
   where id = t.id returning * into t;
  return t;
end $$;

-- ------------------------------------------------------------------ compactação e paradas automáticas
-- Detecta paradas: sequência de pings dentro de stop_radius_m do primeiro ponto do grupo por >= stop_min_minutes.
-- Refaz as automáticas da viagem; não cria automática que se sobreponha a uma manual.
create or replace function app.detect_stops(p_trip_id uuid) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t trips; co companies;
  p record;
  anchor geometry; t0 timestamptz; t1 timestamptz; sx float8; sy float8; n int := 0; k int := 0;
  procedure_close boolean;
begin
  select * into t from trips where id = p_trip_id;
  if not found then return 0; end if;
  select * into co from companies where id = t.company_id;
  delete from stops where trip_id = t.id and source = 'auto';
  for p in select geom, recorded_at from location_pings
            where trip_id = t.id and (accuracy_m is null or accuracy_m <= 100) order by recorded_at loop
    if anchor is not null and ST_DWithin(p.geom::geography, anchor::geography, co.stop_radius_m) then
      t1 := p.recorded_at; sx := sx + ST_X(p.geom); sy := sy + ST_Y(p.geom); n := n + 1;
      continue;
    end if;
    if anchor is not null and t1 - t0 >= make_interval(mins => co.stop_min_minutes)
       and not exists (select 1 from stops s where s.trip_id = t.id and s.source = 'manual'
                                              and tstzrange(s.arrived_at, coalesce(s.departed_at, s.arrived_at), '[]') && tstzrange(t0, t1, '[]')) then
      insert into stops (company_id, trip_id, driver_id, type, source, geom, arrived_at, departed_at)
      values (t.company_id, t.id, t.driver_id, 'nao_classificada', 'auto', ST_SetSRID(ST_MakePoint(sx / n, sy / n), 4326), t0, t1);
      k := k + 1;
    end if;
    anchor := p.geom; t0 := p.recorded_at; t1 := p.recorded_at; sx := ST_X(p.geom); sy := ST_Y(p.geom); n := 1;
  end loop;
  if anchor is not null and t1 - t0 >= make_interval(mins => co.stop_min_minutes)
     and not exists (select 1 from stops s where s.trip_id = t.id and s.source = 'manual'
                                            and tstzrange(s.arrived_at, coalesce(s.departed_at, s.arrived_at), '[]') && tstzrange(t0, t1, '[]')) then
    insert into stops (company_id, trip_id, driver_id, type, source, geom, arrived_at, departed_at)
    values (t.company_id, t.id, t.driver_id, 'nao_classificada', 'auto', ST_SetSRID(ST_MakePoint(sx / n, sy / n), 4326), t0, t1);
    k := k + 1;
  end if;
  return k;
end $$;

-- Compacta os pings da viagem numa LineStringM (M = epoch em s), calcula distância, duração e desvio máximo da rota
-- planejada, detecta paradas e marca os pings como compactados (apagados depois de raw_ping_retention_days).
create or replace function app.compact_trip(p_trip_id uuid) returns trips
language plpgsql security definer set search_path = public, pg_temp as $$
declare t trips;
begin
  select * into t from trips where id = p_trip_id for update;
  if not found then return null; end if;
  update trips tr set
    actual_route = x.line,
    distance_m = case when x.line is not null then round(ST_Length(ST_Force2D(x.line)::geography))::int end,
    duration_s = case when tr.started_at is not null then extract(epoch from coalesce(tr.ended_at, now()) - tr.started_at)::int end,
    deviation_max_m = case when tr.planned_route is not null then x.dev end
  from (
    select case when count(*) >= 2 then
             ST_SetSRID(ST_MakeLine(ST_MakePointM(ST_X(geom), ST_Y(geom), extract(epoch from recorded_at)) order by recorded_at), 4326)
           end as line,
           round(max(ST_Distance(geom::geography, t.planned_route::geography)))::int as dev
      from location_pings
     where trip_id = t.id and (accuracy_m is null or accuracy_m <= 100)
  ) x
  where tr.id = t.id
  returning tr.* into t;
  perform app.detect_stops(t.id);
  update location_pings set compacted = true where trip_id = t.id and not compacted;
  return t;
end $$;

-- Job periódico (edge function agendada ou pg_cron): compacta viagens concluídas pendentes, rastros fora de viagem
-- (por motorista e dia, fuso de São Paulo, só dias encerrados), expira convites e apaga pings crus já compactados.
create or replace function app.run_compaction(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record; trips_done int := 0; days_done int := 0; deleted int := 0; expired int;
begin
  for r in select distinct p.trip_id from location_pings p join trips t on t.id = p.trip_id
            where not p.compacted and t.status in ('concluida', 'cancelada') loop
    perform app.compact_trip(r.trip_id); trips_done := trips_done + 1;
  end loop;

  for r in select driver_id, company_id, (recorded_at at time zone 'America/Sao_Paulo')::date as day
             from location_pings
            where trip_id is null and not compacted
              and (recorded_at at time zone 'America/Sao_Paulo')::date < (p_now at time zone 'America/Sao_Paulo')::date
            group by 1, 2, 3 loop
    insert into driver_daily_tracks as d (company_id, driver_id, day, track, distance_m, ping_count)
    select r.company_id, r.driver_id, r.day, ST_Multi(x.line), round(ST_Length(ST_Force2D(x.line)::geography))::int, x.n
      from (select ST_SetSRID(ST_MakeLine(ST_MakePointM(ST_X(geom), ST_Y(geom), extract(epoch from recorded_at)) order by recorded_at), 4326) as line,
                   count(*)::int as n
              from location_pings
             where driver_id = r.driver_id and trip_id is null and not compacted
               and (recorded_at at time zone 'America/Sao_Paulo')::date = r.day
               and (accuracy_m is null or accuracy_m <= 100)
            having count(*) >= 2) x
    on conflict (driver_id, day) do update
      set track = (select ST_Multi(ST_Collect(g)) from (select (ST_Dump(d.track)).geom as g union all select (ST_Dump(excluded.track)).geom) z),
          distance_m = coalesce(d.distance_m, 0) + coalesce(excluded.distance_m, 0),
          ping_count = d.ping_count + excluded.ping_count;
    update location_pings set compacted = true
     where driver_id = r.driver_id and trip_id is null and not compacted
       and (recorded_at at time zone 'America/Sao_Paulo')::date = r.day;
    days_done := days_done + 1;
  end loop;

  delete from location_pings p using companies c
   where c.id = p.company_id and p.compacted and p.received_at < p_now - make_interval(days => c.raw_ping_retention_days);
  get diagnostics deleted = row_count;
  expired := app.expire_invites();
  return jsonb_build_object('trips_compacted', trips_done, 'driver_days_compacted', days_done,
                            'raw_pings_deleted', deleted, 'invites_expired', expired);
end $$;

-- ------------------------------------------------------------------ paradas e entregas (motorista)
create or replace function app.register_stop(p_type app.stop_type, p_lat float8, p_lon float8,
                                             p_arrived_at timestamptz default now(), p_departed_at timestamptz default null,
                                             p_note text default null, p_trip_id uuid default null) returns stops
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  me company_members := app.my_membership();
  tid uuid := p_trip_id;
  s stops;
begin
  perform app.require(me.user_id is not null, 'sem acesso');
  if tid is null then select id into tid from trips where driver_id = me.user_id and status = 'em_andamento'; end if;
  perform app.require(tid is null or exists (select 1 from trips t where t.id = tid and t.company_id = me.company_id
                                                                  and (t.driver_id = me.user_id or app.is_staff())),
                      'viagem não encontrada');
  insert into stops (company_id, trip_id, driver_id, type, source, geom, arrived_at, departed_at, note, created_by)
  values (me.company_id, tid, me.user_id, p_type, 'manual', ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326),
          p_arrived_at, p_departed_at, p_note, me.user_id)
  returning * into s;
  return s;
end $$;

create or replace function app.register_delivery(p_delivery_id uuid, p_status app.delivery_status,
                                                 p_failure_reason text default null, p_proof_photo_path text default null,
                                                 p_signature_path text default null, p_notes text default null,
                                                 p_stop_id uuid default null) returns deliveries
language plpgsql security definer set search_path = public, pg_temp as $$
declare d deliveries; t trips;
begin
  select * into d from deliveries where id = p_delivery_id for update;
  perform app.require(found, 'entrega não encontrada');
  select * into t from trips where id = d.trip_id;
  perform app.require(t.company_id = app.company_id() and (t.driver_id = auth.uid() or app.is_staff()), 'entrega não encontrada');
  perform app.require(p_status <> 'falhou' or p_failure_reason is not null, 'informe o motivo da falha');
  perform app.require(p_stop_id is null or exists (select 1 from stops s where s.id = p_stop_id and s.trip_id = t.id),
                      'parada não é desta viagem');
  -- comprovante fica no Storage, no prefixo da empresa (<company_id>/...)
  perform app.require(p_proof_photo_path is null or p_proof_photo_path like t.company_id::text || '/%', 'caminho de comprovante inválido');
  perform app.require(p_signature_path is null or p_signature_path like t.company_id::text || '/%', 'caminho de assinatura inválido');
  update deliveries set status = p_status, status_at = now(), failure_reason = p_failure_reason,
                        proof_photo_path = coalesce(p_proof_photo_path, proof_photo_path),
                        signature_path = coalesce(p_signature_path, signature_path),
                        notes = coalesce(p_notes, notes), stop_id = coalesce(p_stop_id, stop_id)
   where id = d.id returning * into d;
  return d;
end $$;

-- ------------------------------------------------------------------ mensagens
create or replace function app.mark_messages_read(p_ids uuid[]) returns integer
language sql security definer set search_path = public, pg_temp as $$
  with u as (update messages set read_at = now()
              where id = any(p_ids) and recipient_id = auth.uid() and read_at is null returning 1)
  select count(*)::int from u
$$;

-- ------------------------------------------------------------------ agente: confirmação de ações
create or replace function app.confirm_agent_action(p_action_id uuid) returns agent_actions
language plpgsql security definer set search_path = public, pg_temp as $$
declare a agent_actions;
begin
  select * into a from agent_actions where id = p_action_id for update;
  perform app.require(found and app.staff_of(a.company_id), 'ação não encontrada');
  perform app.require(a.status = 'proposta', 'ação ' || a.status::text);
  update agent_actions set status = 'confirmada', confirmed_by = auth.uid(), confirmed_at = now()
   where id = a.id returning * into a;
  return a;
end $$;

create or replace function app.reject_agent_action(p_action_id uuid) returns agent_actions
language plpgsql security definer set search_path = public, pg_temp as $$
declare a agent_actions;
begin
  select * into a from agent_actions where id = p_action_id for update;
  perform app.require(found and app.staff_of(a.company_id), 'ação não encontrada');
  perform app.require(a.status = 'proposta', 'ação ' || a.status::text);
  update agent_actions set status = 'rejeitada', confirmed_by = auth.uid(), confirmed_at = now()
   where id = a.id returning * into a;
  return a;
end $$;

-- ------------------------------------------------------------------ Second Brain: busca semântica
-- SECURITY INVOKER: para o usuário, a RLS de knowledge_docs limita à própria empresa (só equipe); a edge function do
-- agente (service_role) passa a empresa do gestor autenticado.
create or replace function app.search_knowledge(p_company_id uuid, p_query_embedding vector(1024), p_match_count int default 8,
                                                p_source_types text[] default null)
returns table (id uuid, source_type text, source_id uuid, title text, content text, metadata jsonb, similarity float8)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  return query
    select k.id, k.source_type, k.source_id, k.title, k.content, k.metadata, 1 - (k.embedding <=> p_query_embedding)
      from knowledge_docs k
     where k.company_id = p_company_id and k.embedding is not null
       and (p_source_types is null or k.source_type = any(p_source_types))
     order by k.embedding <=> p_query_embedding
     limit least(greatest(p_match_count, 1), 50);
end $$;

-- ------------------------------------------------------------------ permissões das funções
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
-- jobs: só service_role
revoke execute on function app.run_compaction(timestamptz) from authenticated;
revoke execute on function app.expire_invites() from authenticated;
revoke execute on function app.compact_trip(uuid) from authenticated;
revoke execute on function app.detect_stops(uuid) from authenticated;
