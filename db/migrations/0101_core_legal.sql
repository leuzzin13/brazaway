-- core_legal: proveniência e consulta do calendário legal (feriados e suspensões da CET).
-- Idempotente. Ver docs/layers/core_legal.md.

-- Feriados: norma que institui cada data (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023, Lei SP 9.497/1997,
-- Lei municipal 14.485/2007 art. 10...). `source` continua dizendo de onde o dado veio.
alter table holidays add column if not exists legal_basis text;

-- Suspensões (CET): quem gravou a linha (o importador só substitui as próprias), período do dia e texto original.
alter table rule_suspensions add column if not exists source text not null default 'manual';
alter table rule_suspensions add column if not exists period text;            -- 'manha' | 'tarde' | null (dia inteiro)
alter table rule_suspensions add column if not exists raw_text text;          -- observação publicada pela CET
alter table rule_suspensions add column if not exists updated_at timestamptz not null default now();
create index if not exists rule_suspensions_when_idx on rule_suspensions (ibge_code, starts_at, ends_at);
create index if not exists holidays_day_idx on holidays (day);

comment on column rule_suspensions.applies_to_heavy is
  'true = a suspensão NÃO vale para caminhões (CET: "MANTIDO para veículos pesados"); a restrição continua para eles.';
comment on column rule_suspensions.scope is
  '''rodizio'' | ''zmrc'' | ''zmrf'' | ''hazmat'' | ''local'' (só um trecho; não suspende zona) | ''all''';
