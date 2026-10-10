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
  ('DE',''),('DA',''),('DO',''),('DAS',''),('DOS','')
on conflict (abbr) do update set full_word = excluded.full_word;
-- 'S' (São) e 'N' (Nossa/nº) ficaram de fora de propósito: são ambíguos. A troca é aplicada dos dois lados
-- (base e busca), então uma expansão "errada" (ex.: DEL → DELEGADO em "Del Rey") não atrapalha o casamento.
-- 'D' NÃO fica na tabela: depende do contexto (ver geo_canon). Apagar sempre fundia ruas com letra
-- ("RUA D", "RUA PROJETADA D", "VIELA 6 D" viravam "RUA", "RUA PROJETADA", "VIELA 6").
delete from geo_abbrev where abbr = 'D';

-- caixa alta, sem acento, só letras/dígitos separados por 1 espaço.
-- search_path fixo: no Supabase as extensões ficam no schema "extensions", no docker em "public".
create or replace function geo_norm(t text) returns text
language sql immutable strict parallel safe set search_path = public, extensions as $$
  select nullif(btrim(regexp_replace(upper(unaccent('unaccent'::regdictionary, t)), '[^A-Z0-9]+', ' ', 'g')), '')
$$;

-- geo_norm + troca de abreviações por palavra canônica + remoção de preposições.
-- 'D' isolado depende do contexto (espelhado em dWord(), api/src/services/geocoder/normalize.ts):
--   último token ou antes de algarismo → fica 'D'   (ruas com letra: RUA D, RUA PROJETADA D, VIELA 6 D, RUA D 5)
--   antes de palavra que começa por vogal → sai     (elisão: D'AVILA, OLHO D'AGUA, ESTRELA D'OESTE)
--   antes de consoante → 'DOM'                      (AV. D. PEDRO I = AVENIDA DOM PEDRO I). "D. Maria" (Dona) também
--   vira DOM: o título fica fora do núcleo (core_norm), então "DOM MARIA PAULA" ainda casa com "DONA MARIA PAULA".
create or replace function geo_canon(t text) returns text
language sql stable strict parallel safe as $$
  with w as (
    select tok, ord, lead(tok) over (order by ord) as nxt
      from regexp_split_to_table(geo_norm(t), ' ') with ordinality as w(tok, ord)
  )
  select nullif(btrim(string_agg(x.word, ' ' order by w.ord)), '')
    from w
    left join geo_abbrev a on a.abbr = w.tok
    cross join lateral (select case
        when w.tok <> 'D'       then coalesce(a.full_word, w.tok)
        when w.nxt is null      then 'D'
        when w.nxt ~ '^[AEIOU]' then ''
        when w.nxt ~ '^[0-9]'   then 'D'
        else 'DOM' end as word) x
   where x.word <> ''
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
-- km de rodovia em METROS (só quando km = true). O CNEFE mistura duas unidades no número com modificador KM:
-- km inteiro (26, 27, 34) e km×1000 + metros (25345 = km 25,345). Regra: número < 1000 → km inteiro (×1000);
-- senão já está em metros. A busca "km N" usa km_m (faixa N*1000..N*1000+999, depois o mais próximo).
alter table addr_point add column if not exists km_m integer;
update addr_point set km_m = case when numero < 1000 then numero * 1000 else numero end
 where km and numero is not null and km_m is null;

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
-- confiavel = false: centroide sem sentido como localização de CEP. O CNEFE usa alguns CEPs como "coringa"
-- (ex.: 01001-000, Praça da Sé: 6.973 endereços em 103 bairros, centroide a 4,8 km da praça, desvio de 21,6 km).
-- Regra (cep_centroid_flag): desvio > 1.500 m e o CEP não é o CEP geral do município (sufixo 000 com pelo menos
-- metade dos endereços do município, ou seja, município de CEP único). A API então consulta o ViaCEP e resolve o
-- logradouro na base própria; sem isso devolve precisao 'municipio' com o desvio real (não 'cep').
alter table cep_centroid add column if not exists confiavel boolean not null default true;

create or replace function cep_centroid_flag() returns integer
language plpgsql as $fn$
declare n_nao integer;
begin
  update cep_centroid c
     set confiavel = not (coalesce(c.desvio_m, 0) > 1500 and not (c.cep % 1000 = 0 and c.n >= 0.5 * m.ntot))
    from (select x.cod_mun, sum(x.n) as ntot from cep_centroid x group by x.cod_mun) m
   where m.cod_mun = c.cod_mun
     and c.confiavel is distinct from not (coalesce(c.desvio_m, 0) > 1500 and not (c.cep % 1000 = 0 and c.n >= 0.5 * m.ntot));
  select count(*) into n_nao from cep_centroid where not confiavel;
  return n_nao;
end $fn$;

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

-- orientação de cada segmento: a linha precisa começar na ponta do número inicial para interpolar.
-- 'vizinhos' = deduzida pela sequência de segmentos (importador) ou correlação fraca com o CNEFE (|r| < 0,3);
-- 'cnefe' = conferida/corrigida pelos endereços do CNEFE com correlação forte (r >= 0,3 depois da eventual inversão).
-- orient_r / orient_n: correlação (número × posição ao longo da linha) e nº de endereços usados; a API calcula o
-- desvio da interpolação a partir deles (sem endereço para conferir: null).
alter table addr_segment add column if not exists orientacao text;
alter table addr_segment add column if not exists orient_r real;
alter table addr_segment add column if not exists orient_n integer;

-- nome normalizado dos segmentos com 'D' isolado (a regra de geo_canon mudou; os demais não mudam)
update addr_segment set core_norm = geo_canon(nome)
 where nome ~* '(^|[^[:alpha:]])D([^[:alpha:]]|$)' and core_norm is distinct from geo_canon(nome);

-- Confere a orientação dos segmentos contra os endereços do CNEFE (número x posição ao longo da linha) e inverte
-- as linhas com correlação negativa forte. Idempotente (numa segunda rodada a correlação já é positiva) e reentrante
-- (pode ser chamada duas vezes na mesma transação).
-- Chamada pelos importadores geosampa_logradouro e cnefe_enderecos (depois de carregar a capital).
create or replace function addr_segment_orient(p_cod integer default 3550308)
returns table (conferidos integer, invertidos integer, sem_dado integer)
language plpgsql as $$
begin
  drop table if exists _seg_orient;
  create temp table _seg_orient on commit drop as
  with seg as (
    select g.id, g.geom, g.core_norm, x.lo, x.hi, x.par
      from addr_segment g
      cross join lateral (values (g.par_ini, g.par_fim, true), (g.impar_ini, g.impar_fim, false)) as x(lo, hi, par)
     where g.cod_mun = p_cod and x.lo is not null and x.hi is not null and abs(x.hi - x.lo) >= 6
  ), pts as (
    select s.id,
           (a.numero - s.lo)::float8 / (s.hi - s.lo) as t,
           ST_LineLocatePoint(s.geom, ST_SetSRID(ST_MakePoint(a.lon, a.lat), 4326)) as f
      from seg s
      join addr_street st on st.cod_mun = p_cod and st.core_norm = s.core_norm
      join addr_point a on a.street_id = st.id and a.km = false
                       and a.numero between least(s.lo, s.hi) and greatest(s.lo, s.hi) and (a.numero % 2 = 0) = s.par
     where ST_DWithin(s.geom::geography, ST_SetSRID(ST_MakePoint(a.lon, a.lat), 4326)::geography, 40)
  )
  select id, coalesce(corr(t, f), 0) as r, count(*)::int as n
    from pts where f > 0.02 and f < 0.98 group by id having count(*) >= 3;

  -- sem endereço para conferir nesta rodada: mantém a geometria, volta a 'vizinhos' e zera r/n
  update addr_segment s set orientacao = 'vizinhos', orient_r = null, orient_n = null
   where s.cod_mun = p_cod and not exists (select 1 from _seg_orient o where o.id = s.id)
     and (s.orientacao is distinct from 'vizinhos' or s.orient_r is not null);
  update addr_segment s set geom = ST_Reverse(s.geom), orientacao = 'cnefe', orient_r = -o.r, orient_n = o.n
    from _seg_orient o where o.id = s.id and o.r <= -0.3;
  update addr_segment s set orientacao = 'cnefe', orient_r = o.r, orient_n = o.n
    from _seg_orient o where o.id = s.id and o.r >= 0.3;
  update addr_segment s set orientacao = 'vizinhos', orient_r = o.r, orient_n = o.n
    from _seg_orient o where o.id = s.id and o.r > -0.3 and o.r < 0.3;
  return query
    select (select count(*)::int from _seg_orient where abs(r) >= 0.3),
           (select count(*)::int from _seg_orient where r <= -0.3),
           (select count(*)::int from addr_segment where cod_mun = p_cod and orientacao is distinct from 'cnefe');
end $$;
