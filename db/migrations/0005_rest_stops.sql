-- Pontos de descanso/apoio (derivados do OSM; usados para o plano de direção da Lei 13.103)
create table if not exists rest_stops (
  id         uuid primary key default gen_random_uuid(),
  osm_id     text unique,
  name       text,
  kind       text not null,   -- rest_area | service_area | truck_stop | truck_parking | fuel_hgv
  geom       geometry(Point, 4326) not null,
  tags       jsonb not null default '{}'::jsonb,
  source     text not null default 'OSM/Overpass',
  created_at timestamptz not null default now()
);
create index if not exists rest_stops_geom_gix on rest_stops using gist (geom);
