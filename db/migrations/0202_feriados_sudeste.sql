-- feriados_sudeste: proveniência, situação jurídica e confiança de cada feriado da tabela holidays (frente feriados_sudeste,
-- importador importers/sources/feriados_sudeste.py, regras em data/raw/feriados/regras.json). Idempotente.
-- Ver docs/layers/feriados_sudeste.md.
--
-- Regra de aplicação: a API só usa linhas com active = true (api/src/services/calendar.ts e rodovias_horario.layer.ts).
--  - confiança 'baixa' ou 'unverifiable' entra com active = false e o motivo em inactive_reason;
--  - norma declarada inconstitucional, revogada ou suspensa entra registrada (status) e nunca é aplicada.
-- As linhas antigas (seed 0004 de SP, testes) ficam active = true / status 'vigente' pelos valores padrão.

alter table holidays add column if not exists active boolean not null default true;
alter table holidays add column if not exists status text not null default 'vigente';
alter table holidays add column if not exists confidence text;            -- 'alta' | 'media' | 'baixa' | 'unverifiable'
alter table holidays add column if not exists inactive_reason text;       -- obrigatório quando active = false
alter table holidays add column if not exists source_url text;            -- ato ou página consultada
alter table holidays add column if not exists rule text;                  -- como a data é calculada (ex.: 'Páscoa − 47 dias')
alter table holidays add column if not exists rule_key text;              -- id da regra em data/raw/feriados/regras.json
alter table holidays add column if not exists notes text;                 -- exceções e ressalvas da pesquisa
alter table holidays add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'holidays_status_check') then
    alter table holidays add constraint holidays_status_check
      check (status in ('vigente', 'a_confirmar', 'inconstitucional', 'revogada', 'suspensa'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'holidays_confidence_check') then
    alter table holidays add constraint holidays_confidence_check
      check (confidence is null or confidence in ('alta', 'media', 'baixa', 'unverifiable'));
  end if;
  -- só feriado vigente e com confiança alta/média pode ser aplicado; desativado sempre diz por quê
  if not exists (select 1 from pg_constraint where conname = 'holidays_active_check') then
    alter table holidays add constraint holidays_active_check
      check ((not active and inactive_reason is not null)
             or (active and status = 'vigente' and coalesce(confidence, 'alta') not in ('baixa', 'unverifiable')));
  end if;
end $$;

create index if not exists holidays_source_idx on holidays (source);

comment on column holidays.active is
  'false = registrada mas NUNCA aplicada (confiança baixa/unverifiable, norma inconstitucional, revogada ou suspensa). Ver inactive_reason.';
comment on column holidays.status is
  '''vigente'' | ''a_confirmar'' | ''inconstitucional'' | ''revogada'' | ''suspensa''';
comment on column holidays.uf is
  'UF do feriado estadual ou do município. A API deriva a UF dos 2 primeiros dígitos do IBGE quando não recebe (31=MG, 32=ES, 33=RJ, 35=SP).';
