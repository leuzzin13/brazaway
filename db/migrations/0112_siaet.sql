-- Frente "siaet": restrições federais (SIAET/DNIT), pontes federais (DNIT/PROARTE/ANTT) e alertas do DNIT.
-- As feições ficam em data_features (layer_id = 'federal_restricoes' | 'pontes_federais'); aqui só tabelas auxiliares.

-- 1) Cache do casamento "segmento SNV/ponte DNIT -> arestas do grafo do Valhalla (OSM)".
--    linear_cost_factors exige uma linha que siga EXATAMENTE as arestas (edge walk); a geometria do SNV não serve
--    direto. A API casa a linha uma vez (trace_attributes), valida e guarda aqui por versão dos tiles.
--    Conteúdo derivado do OSM (ODbL): uso interno no roteamento; não é exportado nem misturado aos dados de terceiros.
create table if not exists siaet_osm_match (
  feature_key text not null,          -- '<layer>:<source>:<source_id>'
  mode        text not null,          -- 'segmento' | 'ponte'
  tileset     text not null,          -- tileset_last_modified do Valhalla (/status)
  geom_hash   text not null,          -- md5 da geometria de entrada (reimportação com outra geometria invalida o cache)
  ok          boolean not null,
  lines       jsonb,                  -- [[[lon,lat],...], ...] linhas DIRIGIDAS prontas para linear_cost_factors (info.dirs = sentido de cada uma)
  info        jsonb,                  -- way_ids, extensão casada, motivo da falha etc.
  created_at  timestamptz not null default now(),
  primary key (feature_key, mode, tileset)
);

-- 2) Curadoria dos "Alertas de serviços" do DNIT (interdições/restrições de ponte raspadas das notícias).
--    O importador dnit_alertas grava as feições em data_features (layer 'pontes_federais', source 'dnit-alertas');
--    sem linha aqui = 'pendente_revisao' (nunca aplicado na rota). Só 'aprovado' entra no roteamento.
create table if not exists dnit_alertas_curadoria (
  source_id    text primary key,      -- = data_features.source_id da feição (hash da URL da notícia)
  status       text not null default 'pendente_revisao' check (status in ('pendente_revisao', 'aprovado', 'rejeitado')),
  acao         text check (acao in ('interdicao', 'limite_peso', 'informativo')),
  peso_max_t   numeric,               -- obrigatório quando acao = 'limite_peso'
  valido_ate   timestamptz,           -- fim da vigência conferida (null = até nova revisão)
  revisado_por text,
  revisado_em  timestamptz not null default now(),
  nota         text,
  check (acao is distinct from 'limite_peso' or peso_max_t is not null)
);
