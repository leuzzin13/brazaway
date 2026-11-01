-- Frota: abastecimento.
-- - vehicles: tanque e consumo de referência (km/L) do cadastro;
-- - trips: nível de combustível e hodômetro que o motorista informa ao iniciar a viagem, e o plano de abastecimento
--   calculado na hora (onde parar e quantos litros);
-- - abastecimentos: cada abastecimento registrado pelo motorista (litros, valor, posto, hodômetro, forma de pagamento),
--   base do consumo médio por motorista e por veículo e do preço pago contra a média da ANP;
-- - postos_conveniados: postos com preço fechado ou desconto (PIX, cartão frota) da transportadora, usados pelo plano.

alter table vehicles add column if not exists tanque_l numeric(6,1) check (tanque_l is null or tanque_l > 0);
alter table vehicles add column if not exists consumo_km_l numeric(5,2) check (consumo_km_l is null or consumo_km_l > 0);

alter table trips add column if not exists combustivel_saida_l numeric(6,1);
alter table trips add column if not exists combustivel_saida_pct numeric(5,1);
alter table trips add column if not exists odometro_saida_km numeric(9,1);
alter table trips add column if not exists plano_abastecimento jsonb;

create table if not exists abastecimentos (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references companies(id) on delete cascade,
  driver_id     uuid references auth.users(id) on delete set null,
  vehicle_id    uuid references vehicles(id) on delete set null,
  trip_id       uuid references trips(id) on delete set null,
  ocorrido_em   timestamptz not null default now(),
  litros        numeric(7,2) not null check (litros > 0 and litros <= 3000),
  valor_cents   integer check (valor_cents is null or valor_cents >= 0),
  combustivel   text not null default 's10' check (combustivel in ('s10', 's500', 'arla32')),
  posto_nome    text,
  posto_cnpj    text check (posto_cnpj is null or posto_cnpj ~ '^\d{14}$'),
  geom          geometry(Point, 4326),
  odometro_km   numeric(9,1),
  tanque_cheio  boolean not null default false,
  pagamento     text check (pagamento is null or pagamento in ('pix', 'cartao_frota', 'cartao', 'dinheiro', 'outro')),
  foto_path     text,
  origem        text not null default 'motorista' check (origem in ('motorista', 'gestor', 'importacao')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists abastecimentos_company_idx on abastecimentos (company_id, ocorrido_em desc);
create index if not exists abastecimentos_vehicle_idx on abastecimentos (company_id, vehicle_id, ocorrido_em desc);

create table if not exists postos_conveniados (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references companies(id) on delete cascade,
  cnpj           text not null check (cnpj ~ '^\d{14}$'),
  nome           text,
  preco_rs_l     numeric(6,3) check (preco_rs_l is null or preco_rs_l > 0),
  desconto_rs_l  numeric(6,3) check (desconto_rs_l is null or desconto_rs_l >= 0),
  pagamento      text,
  ativo          boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, cnpj)
);

-- liga o abastecimento à viagem em andamento do motorista (ou do veículo) naquele horário
create or replace function app.abastecimentos_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.trip_id is null then
    select t.id into new.trip_id from trips t
     where t.company_id = new.company_id
       and ((new.driver_id is not null and t.driver_id = new.driver_id) or (new.driver_id is null and t.vehicle_id = new.vehicle_id))
       and t.started_at is not null and t.started_at <= new.ocorrido_em and coalesce(t.ended_at, now()) >= new.ocorrido_em
     order by t.started_at desc limit 1;
  end if;
  if new.vehicle_id is null and new.trip_id is not null then
    select t.vehicle_id into new.vehicle_id from trips t where t.id = new.trip_id;
  end if;
  return new;
end $$;
drop trigger if exists abastecimentos_before_insert on abastecimentos;
create trigger abastecimentos_before_insert before insert on abastecimentos for each row execute function app.abastecimentos_before_insert();

do $$
declare t text;
begin
  foreach t in array array['abastecimentos', 'postos_conveniados'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I no force row level security', t);
    execute format('revoke all on %I from anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
    execute format('grant all on %I to service_role', t);
  end loop;
end $$;

drop policy if exists frota_abast_select on abastecimentos;
drop policy if exists frota_abast_insert on abastecimentos;
drop policy if exists frota_abast_update on abastecimentos;
drop policy if exists frota_abast_delete on abastecimentos;
create policy frota_abast_select on abastecimentos for select to authenticated
  using (app.staff_of(company_id) or app.self_in(company_id, driver_id));
create policy frota_abast_insert on abastecimentos for insert to authenticated
  with check (app.trip_in(company_id, trip_id) and app.member_in(company_id, driver_id)
              and (app.staff_of(company_id)
                   or (app.self_in(company_id, driver_id) and origem = 'motorista'
                       and (trip_id is null or exists (select 1 from trips t where t.id = trip_id and t.driver_id = auth.uid())))));
create policy frota_abast_update on abastecimentos for update to authenticated
  using (app.staff_of(company_id)) with check (app.staff_of(company_id));
create policy frota_abast_delete on abastecimentos for delete to authenticated
  using (app.staff_of(company_id));

-- postos conveniados: toda a empresa lê (o app do motorista mostra o desconto); só a equipe cadastra
drop policy if exists frota_conv_select on postos_conveniados;
drop policy if exists frota_conv_write on postos_conveniados;
create policy frota_conv_select on postos_conveniados for select to authenticated
  using (company_id = app.company_id());
create policy frota_conv_write on postos_conveniados for all to authenticated
  using (app.staff_of(company_id)) with check (app.staff_of(company_id));
