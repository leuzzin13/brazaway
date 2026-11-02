-- Frota: trechos bloqueados pela empresa.
-- A equipe trava um trecho para a frota inteira (ou só para alguns tipos de caminhão): um item de camada que a rota
-- avisou (o `id` dos avisos, ex.: trecho restrito "sem alternativa razoável") ou uma linha desenhada no mapa. O
-- roteador passa a evitar esses trechos com o fator de "proibido salvo sem nenhum caminho" e o alerta ao vivo avisa o
-- motorista que for entrar neles. Achado da simulação de 90 dias: orientar motorista por motorista não resolvia (o
-- problema voltava com outro motorista); quando a equipe travou o desvio para todos, sumiu.
create table if not exists trechos_bloqueados (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references companies(id) on delete cascade,
  item_id      text,                                  -- id do item da camada (o mesmo do campo `id` dos avisos da rota)
  nome         text not null,
  coordinates  jsonb,                                 -- LineString desenhada pelo gestor: [[lon, lat], ...]
  presets      text[],                                -- tipos de caminhão (config/vehicle-presets.json); null = todos
  motivo       text,
  ativo        boolean not null default true,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint trechos_bloqueados_alvo_ck check (item_id is not null or coordinates is not null),
  constraint trechos_bloqueados_coords_ck check (coordinates is null or jsonb_typeof(coordinates) = 'array')
);
create unique index if not exists trechos_bloqueados_item_uk on trechos_bloqueados (company_id, item_id) where item_id is not null;
create index if not exists trechos_bloqueados_company_idx on trechos_bloqueados (company_id, ativo);

alter table trechos_bloqueados enable row level security;
alter table trechos_bloqueados no force row level security;
revoke all on trechos_bloqueados from anon;
grant select, insert, update, delete on trechos_bloqueados to authenticated;
grant all on trechos_bloqueados to service_role;

-- toda a empresa lê (o app do motorista mostra o que está travado); só a equipe cria, altera e apaga
drop policy if exists frota_bloq_select on trechos_bloqueados;
drop policy if exists frota_bloq_write on trechos_bloqueados;
create policy frota_bloq_select on trechos_bloqueados for select to authenticated
  using (company_id = app.company_id());
create policy frota_bloq_write on trechos_bloqueados for all to authenticated
  using (app.staff_of(company_id)) with check (app.staff_of(company_id));

-- Alertas ao vivo (0404): o 'fora_da_rota' que o alerta ao vivo grava para a equipe (frota/alertas_vivo.ts) não é do
-- motorista. Ele não lê nem marca como visto (marcando, tiraria da fila de "não vistos" do gestor o aviso da própria
-- saída da rota); os outros alertas da viagem dele seguem como na 0404. Troca as duas policies numa transação só.
begin;
drop policy if exists frota_alertas_select on alertas_viagem;
drop policy if exists frota_alertas_update on alertas_viagem;
create policy frota_alertas_select on alertas_viagem for select to authenticated
  using (app.staff_of(company_id) or (app.self_in(company_id, driver_id) and tipo <> 'fora_da_rota'));
create policy frota_alertas_update on alertas_viagem for update to authenticated
  using (app.staff_of(company_id) or (app.self_in(company_id, driver_id) and tipo <> 'fora_da_rota'))
  with check (app.staff_of(company_id) or (app.self_in(company_id, driver_id) and tipo <> 'fora_da_rota'));
commit;
