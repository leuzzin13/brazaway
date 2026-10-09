-- Reportes colaborativos. LICENÇA ODbL: esta base é SEPARADA dos dados OSM e
-- nunca é escrita de volta no OSM nem misturada aos tiles do Valhalla.
do $$ begin
  create type report_type as enum
    ('low_clearance','weight_limit','length_limit','truck_ban','hazmat_ban','road_closed','steep_grade');
exception when duplicate_object then null; end $$;

do $$ begin
  create type report_status as enum ('active','disabled','expired');
exception when duplicate_object then null; end $$;

create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  type        report_type not null,
  geom        geometry(Geometry, 4326) not null,
  value_num   numeric(6,2),            -- metros (low_clearance, length_limit) ou toneladas (weight_limit, steep_grade = peso máx. que vence a subida)
  time_window jsonb,                   -- {"days":[1..7],"from":"HH:MM","to":"HH:MM"} opcional
  note        text,
  device_id   text not null,
  status      report_status not null default 'active',
  score       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint reports_geom_type check (GeometryType(geom) in ('POINT','LINESTRING')),
  constraint reports_value_required check (
    (type in ('low_clearance','weight_limit','length_limit','steep_grade') and value_num is not null)
    or type in ('truck_ban','hazmat_ban','road_closed')
  )
);
create index if not exists reports_geom_gix on reports using gist (geom);
create index if not exists reports_status_idx on reports (status);

create table if not exists report_votes (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references reports(id) on delete cascade,
  device_id  text not null,
  vote       smallint not null check (vote in (-1, 1)),
  created_at timestamptz not null default now(),
  unique (report_id, device_id)
);
create index if not exists report_votes_report_idx on report_votes (report_id);

-- Evolução: tipo steep_grade (subida que o caminhão não vence pelo peso)
alter type report_type add value if not exists 'steep_grade';
