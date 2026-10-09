-- Zonas de restrição por horário (ex.: ZMRC de São Paulo)
create table if not exists restriction_zones (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  geom       geometry(MultiPolygon, 4326) not null,
  -- {"windows":[{"days":[1,2,3,4,5],"from":"05:00","to":"21:00"}], "exceptions":["is_vuc"]}
  rules      jsonb not null,
  source     text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists restriction_zones_geom_gix on restriction_zones using gist (geom);
