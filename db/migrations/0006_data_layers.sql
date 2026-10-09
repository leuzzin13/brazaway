-- Camadas de dados de terceiros (órgãos públicos, OSM derivado, agregados).
-- Base SEPARADA do OSM e dos reportes colaborativos. Cada linha guarda fonte e licença via data_layer_runs.
create table if not exists data_features (
  id          bigserial primary key,
  layer_id    text not null,            -- ex.: 'oae', 'toll_plaza', 'crime_hotspot'
  source      text not null,            -- ex.: 'geosampa', 'der-sp', 'antt'
  source_id   text not null,            -- id estável na fonte (ou hash)
  name        text,
  kind        text,                     -- subtipo livre (ex.: 'PONTE', 'VIADUTO', 'free_flow')
  geom        geometry(Geometry, 4326) not null,
  props       jsonb not null default '{}'::jsonb,
  valid_from  timestamptz,
  valid_to    timestamptz,
  updated_at  timestamptz not null default now(),
  unique (layer_id, source, source_id)
);
create index if not exists data_features_layer_idx on data_features (layer_id);
create index if not exists data_features_geom_gix on data_features using gist (geom);
create index if not exists data_features_layer_kind_idx on data_features (layer_id, kind);

-- Proveniência de cada carga (para auditoria e para a tela de fontes)
create table if not exists data_layer_runs (
  id           bigserial primary key,
  layer_id     text not null,
  source       text not null,
  source_url   text,
  license      text,
  record_count integer not null default 0,
  notes        text,
  imported_at  timestamptz not null default now()
);
create index if not exists data_layer_runs_layer_idx on data_layer_runs (layer_id, imported_at desc);

-- Calendário legal: feriados (suspendem ZMRC/rodízio/perigosos em SP) e suspensões publicadas pela CET
create table if not exists holidays (
  id         bigserial primary key,
  day        date not null,
  scope      text not null check (scope in ('national','state','municipal')),
  uf         text,
  ibge_code  text,              -- município (ex.: 3550308 = São Paulo)
  name       text not null,
  source     text not null
);
create unique index if not exists holidays_uniq on holidays (day, scope, coalesce(uf, ''), coalesce(ibge_code, ''));

create table if not exists rule_suspensions (
  id               bigserial primary key,
  ibge_code        text not null default '3550308',
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  scope            text not null,            -- 'rodizio' | 'zmrc' | 'zmrf' | 'all'
  applies_to_heavy boolean not null default false,  -- true = suspensão NÃO vale para pesados (restrição mantida)
  description      text,
  source_url       text,
  unique (ibge_code, starts_at, scope)
);
