-- Frota (multi-tenant): compatibilidade local com o Supabase.
-- No Supabase o schema `auth`, a função auth.uid() e os papéis anon/authenticated/service_role já existem: este
-- arquivo não faz nada lá (tudo é "se não existir"). No Postgres local (docker compose) ele cria o mínimo para as
-- políticas de RLS funcionarem e serem testadas: auth.users, auth.uid() lendo request.jwt.claims (o mesmo GUC que o
-- PostgREST do Supabase preenche) e os três papéis.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  phone      text unique,
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid') then
    execute $f$
      create function auth.uid() returns uuid language sql stable as $b$
        select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                               (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
      $b$;
    $f$;
  end if;
end $$;

grant usage on schema auth to anon, authenticated, service_role;
