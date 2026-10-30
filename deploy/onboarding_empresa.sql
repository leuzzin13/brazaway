-- Cria uma transportadora e o owner dela (onboarding comercial), no Postgres onde mora a Frota.
-- Variante "login no Lovable Cloud, banco com a API": o owner é um usuário do Supabase do Lovable (id = o `sub` do
-- token, o mesmo `id` de auth.users lá). Idempotente: rodar de novo não duplica empresa nem membro.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -v empresa='Transportadora X' -v preco_centavos=3000 \
--     -v user_id='<uuid do usuário no Supabase do Lovable>' -v email='dono@x.com.br' -v nome='Nome do dono' \
--     -f deploy/onboarding_empresa.sql

insert into auth.users (id, email) values (:'user_id', lower(:'email')) on conflict (id) do nothing;

with nova as (
  insert into companies (name, price_per_vehicle_cents)
  select :'empresa', :'preco_centavos'::int
  where not exists (select 1 from company_members where user_id = :'user_id')
  returning id
)
insert into company_members (company_id, user_id, role, display_name)
select id, :'user_id', 'owner', :'nome' from nova;

select c.name as empresa, m.role, m.display_name, u.email
  from company_members m join companies c on c.id = m.company_id join auth.users u on u.id = m.user_id
 where m.user_id = :'user_id';
