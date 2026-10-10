-- core_legal: proveniência e consulta do calendário legal (feriados e suspensões da CET), polígono de origem/destino das
-- zonas e filtro de reportes "proibido caminhão" pelo PBT. Idempotente. Ver docs/layers/core_legal.md.

-- Feriados: norma que institui cada data (Lei 662/1949, Lei 6.802/1980, Lei 14.759/2023, Lei SP 9.497/1997,
-- Lei municipal 14.485/2007 art. 10...). `source` continua dizendo de onde o dado veio.
alter table holidays add column if not exists legal_basis text;

-- Suspensões (CET): quem gravou a linha (o importador só mexe nas próprias: source = 'cet'), período do dia e texto original.
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

-- Zonas: polígono usado para dizer se a ORIGEM ou o DESTINO estão dentro da zona, quando ele difere do polígono da rota.
-- Rodízio de caminhões (...0002): `geom` é o Minianel sem o corredor das vias-limite (caminhão pode usar as marginais,
-- Decreto 58.584/2018 art. 2º §2º); `geom_endpoint` é o Minianel inteiro (um endereço no corredor continua no rodízio).
alter table restriction_zones add column if not exists geom_endpoint geometry(MultiPolygon, 4326);
comment on column restriction_zones.geom_endpoint is
  'Polígono para testar origem/destino (null = usa geom). Ver scripts/gen-zones-seed.py.';

-- Reporte "proibido caminhão": vale só para caminhão (PBT > 3,5 t, CTB Anexo I) e não para VUC.
-- Antes: (truck_ban and not p_is_vuc), que bloqueava também o utilitário de 3,5 t.
create or replace function active_reports_for_vehicle(
  p_height_m numeric, p_weight_t numeric, p_length_m numeric,
  p_hazmat boolean, p_is_vuc boolean, p_at timestamptz
) returns setof reports language sql stable as $$
  select r.*
    from reports r
   where r.status = 'active'
     and r.score >= 0
     and (
       r.time_window is null
       or (
         (r.time_window->'days') @> to_jsonb(extract(isodow from p_at at time zone 'America/Sao_Paulo')::int)
         and to_char(p_at at time zone 'America/Sao_Paulo', 'HH24:MI') >= (r.time_window->>'from')
         and to_char(p_at at time zone 'America/Sao_Paulo', 'HH24:MI') <  (r.time_window->>'to')
       )
     )
     and (
          (r.type = 'low_clearance' and r.value_num < p_height_m)
       or (r.type = 'weight_limit'  and r.value_num < p_weight_t)
       or (r.type = 'length_limit'  and r.value_num < p_length_m)
       or (r.type = 'truck_ban'     and p_weight_t > 3.5 and not p_is_vuc)
       or (r.type = 'hazmat_ban'    and p_hazmat)
       or (r.type = 'steep_grade'   and r.value_num < p_weight_t)
       or (r.type = 'road_closed')
     )
$$;
