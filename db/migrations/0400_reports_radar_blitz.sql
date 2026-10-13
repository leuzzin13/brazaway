-- Reportes da comunidade "radar_movel" e "blitz". Idempotente. Ver docs/layers/radares.md.
--
-- Estes tipos são INFORMATIVOS: nunca bloqueiam a rota. active_reports_for_vehicle() (0004/0101) só devolve os tipos que
-- listou explicitamente (altura, peso, comprimento, proibições, subida, via interditada), então radar_movel e blitz
-- ficam de fora dela e não viram exclude_polygon. A API só avisa na rota (radar_movel_reportado / blitz_reportada).
-- Não use "r.type = 'radar_movel'" em funções SQL (language sql valida o enum na criação); compare como texto.
--
-- Expiração curta (a presença de radar móvel/blitz dura horas, não dias):
--   expiram 2 h depois do ÚLTIMO voto positivo ou, sem confirmação, da criação do reporte (status 'expired').
--   score < -2 desativa como os demais (trigger recompute_report_score, 0004).
--   Cada confirmação (+1) renova as 2 h; negação (-1) não renova.

alter type report_type add value if not exists 'radar_movel';
alter type report_type add value if not exists 'blitz';

-- value_num: obrigatório nos 4 tipos de medida, proibido nos tipos informativos novos.
-- Comparação por texto: o valor novo do enum não pode ser usado na mesma transação em que foi criado.
alter table reports drop constraint if exists reports_value_required;
alter table reports add constraint reports_value_required check (
  (type::text in ('low_clearance','weight_limit','length_limit','steep_grade') and value_num is not null)
  or (type::text in ('truck_ban','hazmat_ban','road_closed') )
  or (type::text in ('radar_movel','blitz') and value_num is null)
);

-- Janela de expiração (horas) por tipo: um só lugar para ajustar.
create or replace function report_ttl_hours(p_type text) returns numeric language sql immutable as $$
  select case p_type when 'radar_movel' then 2 when 'blitz' then 2 else null end::numeric
$$;

-- Expira os reportes de vida curta sem confirmação recente. Chamada na leitura (listagem e cálculo de rota),
-- junto de expire_stale_road_closed(); não depende de cron.
create or replace function expire_stale_short_reports() returns integer language plpgsql as $$
declare n integer;
begin
  update reports r
     set status = 'expired', updated_at = now()
   where r.type::text in ('radar_movel','blitz')
     and r.status = 'active'
     and greatest(
           r.created_at,
           coalesce((select max(v.created_at) from report_votes v where v.report_id = r.id and v.vote = 1), r.created_at)
         ) < now() - make_interval(secs => report_ttl_hours(r.type::text) * 3600);
  get diagnostics n = row_count;
  return n;
end $$;

-- Todas as expirações de uma vez (road_closed 24 h sem confirmação + radar_movel/blitz 2 h).
create or replace function expire_stale_reports() returns integer language plpgsql as $$
begin
  return expire_stale_road_closed() + expire_stale_short_reports();
end $$;
