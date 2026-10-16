-- Supabase: fecha para a chave anônima/autenticada tudo o que não é da Frota.
-- No Supabase o schema public é exposto pela API REST (PostgREST). As tabelas da Frota já têm RLS e políticas (0302);
-- as do roteador (reports, data_features, zonas, endereços...) só são lidas pela API do BrasaWay, que conecta como
-- `postgres` e não passa pela RLS. Sem isto, qualquer um com a anon key leria/escreveria nelas por /rest/v1.
-- Idempotente. Rodar DEPOIS de todas as migrations e seeds (tabelas novas também precisam passar por aqui).
do $$
declare
  t text;
  frota text[] := array['companies','company_members','invites','vehicles','vehicle_status_history','trips',
                        'location_pings','live_positions','driver_daily_tracks','stops','deliveries','messages',
                        'knowledge_docs','agent_conversations','agent_messages','agent_actions'];
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tableowner = current_user and tablename <> all (frota) loop
    execute format('alter table public.%I enable row level security', t);   -- sem política = ninguém além do dono
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
  for t in select viewname from pg_views where schemaname = 'public' and viewowner = current_user
                                            and viewname not in ('billing_active_vehicles_monthly') loop
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- funções do roteador (não as das extensões, como PostGIS): só a API (postgres) e o service_role chamam
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and pg_get_userbyid(p.proowner) = current_user
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- o schema app (RPC da Frota) não fica exposto ao anon
revoke all on schema app from anon;
