-- Geocodificador próprio (frente "geocoding"): endereços do CNEFE 2022 (IBGE), centroides de CEP (IPEA/CNEFE)
-- e faixas de numeração dos segmentos de logradouro do GeoSampa (capital).
-- Tabelas próprias (não usam data_features) porque são grandes; os importadores carregam direto via COPY
-- e NÃO geram seed versionado (ver docs/layers/geocoding.md). Idempotente.
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ---------------------------------------------------------------------------------------------
-- Normalização (fonte única: a API lê geo_abbrev para normalizar a busca do mesmo jeito)
-- ---------------------------------------------------------------------------------------------
-- abreviação → palavra canônica. full_word = '' remove a palavra (preposições).
create table if not exists geo_abbrev (
  abbr      text primary key,
  full_word text not null
);
insert into geo_abbrev (abbr, full_word) values
  -- tipos de logradouro
  ('AV','AVENIDA'),('AVN','AVENIDA'),('AVEN','AVENIDA'),('R','RUA'),('AL','ALAMEDA'),('ALAM','ALAMEDA'),
  ('EST','ESTRADA'),('ESTR','ESTRADA'),('ROD','RODOVIA'),('RDV','RODOVIA'),('TV','TRAVESSA'),('TRAV','TRAVESSA'),
  ('TR','TRAVESSA'),('PC','PRACA'),('PCA','PRACA'),('PRC','PRACA'),('LG','LARGO'),('LGO','LARGO'),('VD','VIADUTO'),
  ('VDT','VIADUTO'),('PQ','PARQUE'),('PRQ','PARQUE'),('JD','JARDIM'),('JDM','JARDIM'),('JARD','JARDIM'),
  ('VL','VILA'),('CJ','CONJUNTO'),('CONJ','CONJUNTO'),('RES','RESIDENCIAL'),('RESID','RESIDENCIAL'),
  ('COND','CONDOMINIO'),('LOT','LOTEAMENTO'),('CH','CHACARA'),('CHAC','CHACARA'),('ESC','ESCADARIA'),
  ('PSG','PASSAGEM'),('PASS','PASSAGEM'),('BC','BECO'),('LD','LADEIRA'),('LAD','LADEIRA'),('PTE','PONTE'),
  ('ACS','ACESSO'),('MARG','MARGINAL'),('ETR','ESTRADA'),('VLA','VIELA'),('VE','VIELA'),('PRAC','PRACA'),
  ('CPO','CAMPO'),('NUC','NUCLEO'),('BAL','BALNEARIO'),('CID','CIDADE'),('HAB','HABITACIONAL'),
  -- títulos
  ('DR','DOUTOR'),('DRA','DOUTORA'),('PROF','PROFESSOR'),('PROFA','PROFESSORA'),('PROFO','PROFESSOR'),
  ('ENG','ENGENHEIRO'),('ENGO','ENGENHEIRO'),('ENGA','ENGENHEIRA'),('CEL','CORONEL'),('GAL','GENERAL'),
  ('GEN','GENERAL'),('MAL','MARECHAL'),('BRIG','BRIGADEIRO'),('ALM','ALMIRANTE'),('CAP','CAPITAO'),
  ('TEN','TENENTE'),('SGT','SARGENTO'),('SARG','SARGENTO'),('MAJ','MAJOR'),('CMTE','COMANDANTE'),
  ('CMDT','COMANDANTE'),('COMEND','COMENDADOR'),('COMD','COMENDADOR'),('SEN','SENADOR'),('DEP','DEPUTADO'),
  ('VER','VEREADOR'),('VEREAD','VEREADOR'),('PRES','PRESIDENTE'),('PRESID','PRESIDENTE'),('GOV','GOVERNADOR'),
  ('PREF','PREFEITO'),('MIN','MINISTRO'),('DES','DESEMBARGADOR'),('DESEMB','DESEMBARGADOR'),('CONS','CONSELHEIRO'),
  ('CONSELH','CONSELHEIRO'),('MONS','MONSENHOR'),('PE','PADRE'),('PDE','PADRE'),('FR','FREI'),('STA','SANTA'),
  ('STO','SANTO'),('SRA','SENHORA'),('SR','SENHOR'),('NSRA','NOSSA SENHORA'),('NSA','NOSSA'),('VISC','VISCONDE'),
  ('ARQ','ARQUITETO'),('JORN','JORNALISTA'),('MAEST','MAESTRO'),('SD','SOLDADO'),('SOLD','SOLDADO'),('CB','CABO'),
  ('CON','CONEGO'),('CONEG','CONEGO'),('MQ','MARQUES'),('DQ','DUQUE'),('EMB','EMBAIXADOR'),('DEL','DELEGADO'),
  ('IMP','IMPERADOR'),('PRINC','PRINCESA'),('DNA','DONA'),('PROFESS','PROFESSOR'),
  -- preposições (removidas dos dois lados para casar "Estrada do M'Boi Mirim" com "Estrada M Boi Mirim")
  ('DE',''),('DA',''),('DO',''),('DAS',''),('DOS',''),('D','')
on conflict (abbr) do update set full_word = excluded.full_word;
-- 'S' (São) e 'N' (Nossa/nº) ficaram de fora de propósito: são ambíguos. A troca é aplicada dos dois lados
-- (base e busca), então uma expansão "errada" (ex.: DEL → DELEGADO em "Del Rey") não atrapalha o casamento.

-- caixa alta, sem acento, só letras/dígitos separados por 1 espaço
create or replace function geo_norm(t text) returns text
language sql immutable strict parallel safe as $$
  select nullif(btrim(regexp_replace(upper(public.unaccent('public.unaccent'::regdictionary, t)), '[^A-Z0-9]+', ' ', 'g')), '')
$$;

-- geo_norm + troca de abreviações por palavra canônica + remoção de preposições
create or replace function geo_canon(t text) returns text
language sql stable strict parallel safe as $$
  select nullif(btrim(string_agg(coalesce(a.full_word, w.tok), ' ' order by w.ord)), '')
    from regexp_split_to_table(geo_norm(t), ' ') with ordinality as w(tok, ord)
    left join geo_abbrev a on a.abbr = w.tok
   where coalesce(a.full_word, w.tok) <> ''
$$;

-- ---------------------------------------------------------------------------------------------
-- CNEFE 2022 (IBGE) — endereços com coordenada de campo
-- ---------------------------------------------------------------------------------------------
-- municípios com endereços carregados (cobertura do nível "número")
create table if not exists addr_municipio (
  cod_mun       integer primary key,           -- código IBGE (7 dígitos)
  nome          text not null,
  uf            text not null,
  n_registros   integer,                        -- linhas do CSV do CNEFE (espécies)
  n_enderecos   integer,                        -- pontos em addr_point
  n_logradouros integer,
  fonte         text,
  carregado_em  timestamptz not null default now()
);

create table if not exists addr_street (
  id         serial primary key,
  cod_mun    integer not null,
  tipo       text,                -- canônico: RUA, AVENIDA, ESTRADA...
  titulo     text,                -- como no CNEFE (DOUTOR, SAO...)
  nome       text not null,       -- como no CNEFE, sem título
  nome_norm  text not null,       -- geo_canon(titulo || nome)
  core_norm  text not null,       -- geo_canon(nome)
  n          integer not null default 0,  -- pontos (endereços) do logradouro
  lat        real,                -- ponto representativo (endereço real mais próximo do centroide)
  lon        real,
  desvio_m   real,                -- mediana da distância dos endereços ao ponto representativo
  unique (cod_mun, tipo, nome_norm)
);
create index if not exists addr_street_nome_trgm on addr_street using gin (nome_norm gin_trgm_ops);
create index if not exists addr_street_core_trgm on addr_street using gin (core_norm gin_trgm_ops);
create index if not exists addr_street_mun_core on addr_street (cod_mun, core_norm);

-- bairro = DSC_LOCALIDADE do CNEFE
create table if not exists addr_bairro (
  id         serial primary key,
  cod_mun    integer not null,
  nome       text not null,
  nome_norm  text not null,
  n          integer not null default 0,
  lat        real,
  lon        real,
  desvio_m   real,
  unique (cod_mun, nome_norm)
);
create index if not exists addr_bairro_trgm on addr_bairro using gin (nome_norm gin_trgm_ops);

-- um ponto por endereço único (logradouro + número + bairro); "sem número" agrupado por célula de ~11 m.
-- lat/lon em real (float4, ~0,4 m de resolução) para a tabela caber folgada (~5 M linhas na RMSP + Baixada).
create table if not exists addr_point (
  street_id  integer not null,
  numero     integer,             -- null = sem número (SN)
  km         boolean not null default false,  -- número é km de rodovia (DSC_MODIFICADOR = KM)
  bairro_id  integer,
  cep        integer,             -- 8 dígitos
  nv_geo     smallint,            -- melhor NV_GEO_COORD do grupo (1 = coordenada de campo)
  n          smallint,            -- registros do CNEFE agregados no ponto
  estab      text,                -- um nome de estabelecimento no endereço (se houver)
  lat        real not null,
  lon        real not null
);
create index if not exists addr_point_street_num on addr_point (street_id, numero);

-- ---------------------------------------------------------------------------------------------
-- CEP → centroide (ipea/padronizacao_cnefe municipio_cep, derivado do CNEFE)
-- ---------------------------------------------------------------------------------------------
create table if not exists cep_centroid (
  cep       integer not null,      -- 8 dígitos
  cod_mun   integer not null,      -- um CEP pode cobrir mais de um município (ex.: CEP geral de distrito)
  municipio text,
  uf        text,
  n         integer,               -- endereços do CNEFE no CEP
  desvio_m  real,                  -- desvio informado pela fonte (m)
  lat       real not null,
  lon       real not null,
  primary key (cep, cod_mun)
);

-- consultas ao ViaCEP (só para CEP ausente de cep_centroid, ex.: grandes usuários -9xx), com cache
create table if not exists cep_lookup_cache (
  cep        integer primary key,
  found      boolean not null,
  payload    jsonb,
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------
-- GeoSampa segmento_logradouro (capital): faixa de numeração par/ímpar por quadra → interpolação
-- ---------------------------------------------------------------------------------------------
create table if not exists addr_segment (
  id         integer primary key,  -- cd_identificador
  cod_mun    integer not null default 3550308,
  codlog     text,
  tipo       text,                 -- canônico (R → RUA)
  titulo     text,                 -- código do cadastro municipal (DR, CON...)
  nome       text,
  core_norm  text,                 -- geo_canon(nome)
  ordem      integer,
  par_ini    integer, par_fim integer, impar_ini integer, impar_fim integer,
  geom       geometry(LineString, 4326) not null
);
create index if not exists addr_segment_core on addr_segment (cod_mun, core_norm);
