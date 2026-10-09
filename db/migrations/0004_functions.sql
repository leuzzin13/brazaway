-- Score = soma dos votos. Abaixo de -2 o reporte é desativado.
create or replace function recompute_report_score() returns trigger language plpgsql as $$
declare
  rid uuid := coalesce(new.report_id, old.report_id);
  s integer;
begin
  select coalesce(sum(vote), 0) into s from report_votes where report_id = rid;
  update reports
     set score = s,
         status = case
                    when s < -2 then 'disabled'::report_status
                    when status = 'disabled' and s >= -2 then 'active'::report_status
                    else status
                  end,
         updated_at = now()
   where id = rid;
  return null;
end $$;

drop trigger if exists report_votes_recompute on report_votes;
create trigger report_votes_recompute
  after insert or update or delete on report_votes
  for each row execute function recompute_report_score();

-- Expira road_closed com mais de 24h sem nenhuma confirmação (voto +1).
-- Chamada na leitura (listagem e cálculo de rota); não depende de cron.
create or replace function expire_stale_road_closed() returns integer language plpgsql as $$
declare n integer;
begin
  update reports r
     set status = 'expired', updated_at = now()
   where r.type = 'road_closed'
     and r.status = 'active'
     and r.created_at < now() - interval '24 hours'
     and not exists (select 1 from report_votes v where v.report_id = r.id and v.vote = 1);
  get diagnostics n = row_count;
  return n;
end $$;

-- Reportes ativos (status active, score >= 0, dentro da janela de horário se houver)
-- que bloqueiam o veículo informado.
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
       or (r.type = 'truck_ban'     and not p_is_vuc)
       or (r.type = 'hazmat_ban'    and p_hazmat)
       or (r.type = 'road_closed')
     )
$$;
