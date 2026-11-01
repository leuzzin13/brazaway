-- Frota: multas (autos de infração) da transportadora.
-- O motorista registra pelo app na hora em que é autuado ou parado ("tomei uma multa"), a equipe completa quando a
-- notificação chega (AIT, órgão, enquadramento, valor, pontos, prazos) e marca se o retorno ao motorista foi dado
-- ("feedback enviado?"). A viagem é ligada sozinha pelo motorista/veículo e pelo horário.
-- Achados da simulação de 60 dias: a notificação chega ~3 semanas depois, o prazo de indicação do condutor se perde
-- e a mesma infração se repete quando ninguém conversa com o motorista.

do $$ begin create type app.multa_status as enum ('registrada', 'notificada', 'condutor_indicado', 'em_recurso', 'paga', 'cancelada');
exception when duplicate_object then null; end $$;
do $$ begin create type app.multa_gravidade as enum ('leve', 'media', 'grave', 'gravissima');
exception when duplicate_object then null; end $$;

create table if not exists multas (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies(id) on delete cascade,
  driver_id         uuid references auth.users(id) on delete set null,
  vehicle_id        uuid references vehicles(id) on delete set null,
  trip_id           uuid references trips(id) on delete set null,
  ocorrida_em       timestamptz not null,
  local             text,
  geom              geometry(Point, 4326),
  descricao         text,                                   -- o que o motorista contou / o que diz o auto
  ait               text,                                   -- número do auto de infração
  orgao             text,                                   -- CET, PRF, DER-SP, prefeitura...
  enquadramento     text,                                   -- código/artigo do CTB
  gravidade         app.multa_gravidade,
  valor_cents       integer check (valor_cents is null or valor_cents >= 0),
  pontos            smallint check (pontos is null or pontos between 0 and 7),
  status            app.multa_status not null default 'registrada',
  prazo_indicacao   date,                                   -- prazo para indicar o condutor
  prazo_pagamento   date,
  paga_pela         text check (paga_pela is null or paga_pela in ('empresa', 'motorista')),
  foto_path         text,                                   -- foto do auto/notificação (Storage, prefixo <company_id>/)
  restricao         text,                                   -- regra ou trecho do BrasaWay ligado à multa (ex.: id da camada)
  feedback_enviado  boolean not null default false,         -- a equipe já conversou/orientou o motorista?
  feedback_em       timestamptz,
  feedback_por      uuid references auth.users(id) on delete set null,
  feedback_nota     text,
  origem            text not null default 'gestor' check (origem in ('motorista', 'gestor', 'importacao')),
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists multas_company_idx on multas (company_id, status, ocorrida_em desc);
create index if not exists multas_driver_idx on multas (company_id, driver_id, ocorrida_em desc);
create unique index if not exists multas_ait_uk on multas (company_id, ait) where ait is not null;

-- liga a viagem pelo horário (motorista ou veículo em viagem naquele instante) e registra quem deu o feedback
create or replace function app.multas_before_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_trip uuid; v_vehicle uuid; v_driver uuid;
begin
  if new.trip_id is null and (new.driver_id is not null or new.vehicle_id is not null) then
    -- SELECT INTO sem linha zera os alvos: lê em variáveis e só copia se achou a viagem
    select t.id, t.vehicle_id, t.driver_id into v_trip, v_vehicle, v_driver
      from trips t
     where t.company_id = new.company_id
       and ((new.driver_id is not null and t.driver_id = new.driver_id) or (new.driver_id is null and t.vehicle_id = new.vehicle_id))
       and t.started_at is not null and t.started_at <= new.ocorrida_em
       and coalesce(t.ended_at, now()) >= new.ocorrida_em
     order by t.started_at desc limit 1;
    if v_trip is not null then
      new.trip_id := v_trip;
      new.vehicle_id := coalesce(new.vehicle_id, v_vehicle);
      new.driver_id := coalesce(new.driver_id, v_driver);
    end if;
  end if;
  if new.feedback_enviado and (tg_op = 'INSERT' or not old.feedback_enviado) then
    new.feedback_em := coalesce(new.feedback_em, now());
    new.feedback_por := coalesce(new.feedback_por, auth.uid());
  elsif not new.feedback_enviado then
    new.feedback_em := null; new.feedback_por := null;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists multas_before_write on multas;
create trigger multas_before_write before insert or update on multas for each row execute function app.multas_before_write();

alter table multas enable row level security;
alter table multas no force row level security;
revoke all on multas from anon;
grant select, insert, update, delete on multas to authenticated;
grant all on multas to service_role;

drop policy if exists frota_multas_select on multas;
drop policy if exists frota_multas_insert on multas;
drop policy if exists frota_multas_update on multas;
drop policy if exists frota_multas_delete on multas;
-- equipe: todas da empresa; motorista: só as dele
create policy frota_multas_select on multas for select to authenticated
  using (app.staff_of(company_id) or app.self_in(company_id, driver_id));
-- motorista só registra a própria, como 'registrada' e sem marcar feedback; equipe registra qualquer uma da empresa
create policy frota_multas_insert on multas for insert to authenticated
  with check (app.trip_in(company_id, trip_id) and app.member_in(company_id, driver_id)
              and (app.staff_of(company_id)
                   or (app.self_in(company_id, driver_id) and status = 'registrada' and not feedback_enviado and origem = 'motorista'
                       and (trip_id is null or exists (select 1 from trips t where t.id = trip_id and t.driver_id = auth.uid())))));
-- só a equipe altera (status, valores, prazos, feedback)
create policy frota_multas_update on multas for update to authenticated
  using (app.staff_of(company_id)) with check (app.staff_of(company_id) and app.trip_in(company_id, trip_id));
create policy frota_multas_delete on multas for delete to authenticated
  using (app.staff_of(company_id));
