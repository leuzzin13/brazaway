"""CNEFE 2022 (IBGE) → addr_street / addr_bairro / addr_point (base do geocodificador próprio).

Fonte: CSV por município do Cadastro Nacional de Endereços para Fins Estatísticos (Censo 2022), com a coordenada
coletada em campo para cada endereço (NV_GEO_COORD 1 = coordenada original). Uma linha do CSV é uma "espécie"
(domicílio, estabelecimento...) num endereço; aqui agregamos em UM ponto por endereço único:
    (logradouro, número, km?, bairro) → mediana das coordenadas de nível 1–2 (ou 3–4 se só houver essas)
e os "sem número" por célula de ~11 m (para não fundir portarias diferentes da mesma avenida).

NÃO gera seed versionado: a RMSP + Baixada dá ~5 M pontos (centenas de MB). Rode com --no-seed:
    docker compose --profile import run --rm importer cnefe_enderecos --no-seed
Municípios em CNEFE_MUNICIPIOS (padrão 'rmsp,baixada' = 48 municípios):
    'nucleo'  → capital + Guarulhos, Osasco, Barueri, Cajamar, Santos, Guarujá (polos logísticos)
    'rmsp', 'baixada' ou lista de códigos IBGE ('3550308,3518800').
Os zips (~290 MB no total) ficam em data/cache/geocoding/cnefe (gitignored) e são reaproveitados.
Os dados carregados direto via COPY; a função devolve 1 feição de cobertura por município (data_features).
"""
from __future__ import annotations
import json, os, re, time, zipfile
import requests
from common import CACHE_DIR, UA, _pg_conn, http_get

LAYER_ID = 'geocoding'
SOURCE = 'ibge-cnefe'
BASE = 'https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/Censo_Demografico_2022/Arquivos_CNEFE/CSV/Municipio/'
SOURCE_URL = BASE + '35_SP/'
LICENSE = 'IBGE — CNEFE 2022: dados públicos, uso livre com citação obrigatória ("Fonte: IBGE, Censo Demográfico 2022 — CNEFE")'
NOTES = None  # preenchido em fetch() com as contagens
RECORD_COUNT = None  # total de pontos em addr_point (a base inteira, não só esta carga; as feições são só cobertura)

UF_DIR = {35: '35_SP', 33: '33_RJ', 31: '31_MG', 32: '32_ES', 41: '41_PR'}

RMSP = [3503901, 3505708, 3506607, 3509007, 3509205, 3510609, 3513009, 3513801, 3515004, 3515103, 3515707, 3516309,
        3516408, 3518305, 3518800, 3522208, 3522505, 3523107, 3525003, 3526209, 3528502, 3529401, 3530607, 3534401,
        3539103, 3539806, 3543303, 3544103, 3545001, 3546801, 3547304, 3547809, 3548708, 3548807, 3549953, 3550308,
        3552502, 3552809, 3556453]
BAIXADA = [3506359, 3513504, 3518701, 3522109, 3531100, 3537602, 3541000, 3548500, 3551009]
NUCLEO = [3550308, 3518800, 3534401, 3505708, 3509205, 3548500, 3518701]

UF_SIGLA = {35: 'SP', 33: 'RJ', 31: 'MG', 32: 'ES', 41: 'PR'}


def municipios() -> list[int]:
    raw = os.environ.get('CNEFE_MUNICIPIOS', 'rmsp,baixada')
    out: list[int] = []
    for t in raw.split(','):
        t = t.strip().lower()
        if t == 'rmsp':
            out += RMSP
        elif t == 'baixada':
            out += BAIXADA
        elif t == 'nucleo':
            out += NUCLEO
        elif t.isdigit() and len(t) == 7:
            out.append(int(t))
        elif t:
            raise ValueError(f'CNEFE_MUNICIPIOS: valor desconhecido {t!r}')
    seen, uniq = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    # capital por último: é o maior arquivo e os demais já ficam disponíveis antes
    return sorted(uniq, key=lambda c: c == 3550308)


def _listing(uf: int) -> dict[int, str]:
    html = http_get(BASE + UF_DIR[uf] + '/', cache=f'geocoding/cnefe_listing_{uf}.html', max_age_h=24 * 30).decode('latin-1')
    files = {}
    for href in re.findall(r'href="(\d{7}_[^"]+\.zip)"', html):
        files[int(href[:7])] = href
    return files


def _download(url: str, dest) -> None:
    """Download em streaming (o zip da capital tem 177 MB) com retomada simples por tamanho."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    head = requests.head(url, headers=UA, timeout=60, allow_redirects=True)
    size = int(head.headers.get('content-length') or 0)
    if dest.exists() and size and dest.stat().st_size == size:
        return
    tmp = dest.with_suffix('.part')
    for attempt in range(4):
        try:
            with requests.get(url, headers=UA, stream=True, timeout=(30, 120)) as r:
                r.raise_for_status()
                with open(tmp, 'wb') as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
            if size and tmp.stat().st_size != size:
                raise IOError(f'tamanho {tmp.stat().st_size} != {size}')
            tmp.replace(dest)
            return
        except Exception as e:  # noqa: BLE001
            print(f'  ! download falhou ({e}); tentativa {attempt + 1}')
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f'não consegui baixar {url}')


# Agregação (roda dentro da transação do município, sobre a tabela temporária cnefe_raw)
SQL_AGG = r"""
create temp table m_street on commit drop as
  select tipo_raw, titulo_raw, nome_raw,
         coalesce(geo_canon(tipo_raw), '') as tipo,
         geo_canon(concat_ws(' ', nullif(titulo_raw, ''), nome_raw)) as nome_norm,
         coalesce(geo_canon(nome_raw), geo_canon(concat_ws(' ', nullif(titulo_raw, ''), nome_raw))) as core_norm
    from (select distinct coalesce(nom_tipo_seglogr, '') tipo_raw, coalesce(nom_titulo_seglogr, '') titulo_raw, nom_seglogr nome_raw
            from cnefe_raw where nom_seglogr is not null) s;

insert into addr_street (cod_mun, tipo, titulo, nome, nome_norm, core_norm)
select %(m)s, tipo, nullif(max(titulo_raw), ''), max(nome_raw), nome_norm, max(core_norm)
  from m_street where nome_norm is not null
 group by tipo, nome_norm;

create temp table m_street_id on commit drop as
  select m.tipo_raw, m.titulo_raw, m.nome_raw, s.id as street_id
    from m_street m join addr_street s on s.cod_mun = %(m)s and s.tipo = m.tipo and s.nome_norm = m.nome_norm;
-- tabelas temporárias não têm estatística: sem analyze o planner faz nested loop (minutos na capital)
analyze m_street_id;

create temp table m_bairro on commit drop as
  select loc_raw, geo_canon(loc_raw) as nome_norm
    from (select distinct coalesce(dsc_localidade, '') loc_raw from cnefe_raw) s;

insert into addr_bairro (cod_mun, nome, nome_norm)
select %(m)s, max(loc_raw), nome_norm from m_bairro where nome_norm is not null group by nome_norm;

create temp table m_bairro_id on commit drop as
  select b.loc_raw, a.id as bairro_id from m_bairro b join addr_bairro a on a.cod_mun = %(m)s and a.nome_norm = b.nome_norm;
analyze m_bairro_id;

create temp table cnefe_rec on commit drop as
select si.street_id, bi.bairro_id,
       case when upper(coalesce(r.dsc_modificador, '')) = 'SN' then null
            when r.num_endereco ~ '^[0-9]{1,7}$' and r.num_endereco::int > 0 then r.num_endereco::int
            else null end as numero,
       upper(coalesce(r.dsc_modificador, '')) = 'KM' as km,
       nullif(regexp_replace(coalesce(r.cep, ''), '\D', '', 'g'), '')::int as cep,
       replace(r.latitude, ',', '.')::float8 as lat,
       replace(r.longitude, ',', '.')::float8 as lon,
       r.nv_geo_coord::smallint as nv,
       nullif(r.cod_especie, '')::smallint as especie,
       nullif(btrim(r.dsc_estabelecimento), '') as estab
  from cnefe_raw r
  join m_street_id si on si.tipo_raw = coalesce(r.nom_tipo_seglogr, '') and si.titulo_raw = coalesce(r.nom_titulo_seglogr, '')
                     and si.nome_raw = r.nom_seglogr
  left join m_bairro_id bi on bi.loc_raw = coalesce(r.dsc_localidade, '')
 where r.latitude ~ '^-?[0-9]+[.,][0-9]+$' and r.longitude ~ '^-?[0-9]+[.,][0-9]+$'
   and r.nv_geo_coord in ('1', '2', '3', '4');
analyze cnefe_rec;

-- com número: 1 ponto por (logradouro, número, km, bairro); média das coordenadas de campo (nv 1–2).
-- (média e não mediana: agregados ordenados por grupo custam minutos em 2,5 M grupos; a maioria tem 1–3 registros)
-- km_m: km em metros. O CNEFE mistura "km inteiro" (26) e "km×1000 + metros" (25345 = km 25,345) no número.
insert into addr_point (street_id, numero, km, km_m, bairro_id, cep, nv_geo, n, estab, lat, lon)
select street_id, numero, km, case when km then (case when numero < 1000 then numero * 1000 else numero end) end, bairro_id,
       max(cep),
       min(nv), least(count(*), 32000),
       coalesce(max(estab) filter (where especie = 6), max(estab) filter (where especie <> 1)),
       coalesce(avg(lat) filter (where nv <= 2), avg(lat)),
       coalesce(avg(lon) filter (where nv <= 2), avg(lon))
  from cnefe_rec where numero is not null
 group by street_id, numero, km, bairro_id;

-- sem número: por célula de ~11 m (portarias, terminais, lotes grandes)
insert into addr_point (street_id, numero, km, bairro_id, cep, nv_geo, n, estab, lat, lon)
select street_id, null, false, bairro_id,
       max(cep),
       min(nv), least(count(*), 32000),
       coalesce(max(estab) filter (where especie = 6), max(estab) filter (where especie <> 1)),
       avg(lat), avg(lon)
  from cnefe_rec where numero is null
 group by street_id, bairro_id, round(lat::numeric, 4), round(lon::numeric, 4);

-- ponto representativo do logradouro = endereço real mais perto do centroide; desvio = mediana da distância a ele
create temp table st_c on commit drop as
  select p.street_id, avg(p.lat) clat, avg(p.lon) clon, count(*) n
    from addr_point p join addr_street s on s.id = p.street_id where s.cod_mun = %(m)s group by p.street_id;
create temp table st_med on commit drop as
  select distinct on (p.street_id) p.street_id, p.lat, p.lon
    from addr_point p join st_c c using (street_id)
   order by p.street_id, (p.lat - c.clat) ^ 2 + ((p.lon - c.clon) * cos(radians(c.clat))) ^ 2;
update addr_street s set n = c.n, lat = m.lat, lon = m.lon
  from st_c c join st_med m using (street_id) where s.id = c.street_id;
-- logradouro sem nenhum ponto (todos os registros sem coordenada válida): não serve para geocodificar
delete from addr_street s
 where s.cod_mun = %(m)s and s.n = 0 and not exists (select 1 from addr_point a where a.street_id = s.id);
update addr_street s set desvio_m = d.dm
  from (select p.street_id,
               percentile_cont(0.5) within group (order by sqrt(((p.lat - s2.lat) * 111320) ^ 2 + ((p.lon - s2.lon) * 111320 * cos(radians(s2.lat))) ^ 2)) dm
          from addr_point p join addr_street s2 on s2.id = p.street_id where s2.cod_mun = %(m)s group by p.street_id) d
 where s.id = d.street_id;

-- mesmo para bairros
create temp table br_c on commit drop as
  select p.bairro_id, avg(p.lat) clat, avg(p.lon) clon, count(*) n
    from addr_point p join addr_bairro b on b.id = p.bairro_id where b.cod_mun = %(m)s group by p.bairro_id;
create temp table br_med on commit drop as
  select distinct on (p.bairro_id) p.bairro_id, p.lat, p.lon
    from addr_point p join br_c c using (bairro_id)
   order by p.bairro_id, (p.lat - c.clat) ^ 2 + ((p.lon - c.clon) * cos(radians(c.clat))) ^ 2;
update addr_bairro b set n = c.n, lat = m.lat, lon = m.lon
  from br_c c join br_med m using (bairro_id) where b.id = c.bairro_id;
update addr_bairro b set desvio_m = d.dm
  from (select p.bairro_id,
               percentile_cont(0.5) within group (order by sqrt(((p.lat - b2.lat) * 111320) ^ 2 + ((p.lon - b2.lon) * 111320 * cos(radians(b2.lat))) ^ 2)) dm
          from addr_point p join addr_bairro b2 on b2.id = p.bairro_id where b2.cod_mun = %(m)s group by p.bairro_id) d
 where b.id = d.bairro_id;
delete from addr_bairro where cod_mun = %(m)s and n = 0;
"""


def _load_municipio(conn, cod: int, path, nome_arquivo: str) -> dict:
    t0 = time.time()
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("set local work_mem = '256MB'")
        # banco compartilhado: não fica horas esperando lock de outra sessão (falha e tenta de novo)
        cur.execute("set local lock_timeout = '5min'")
        cur.execute("set local synchronous_commit = off")
        # as junções por 3 colunas de texto têm estimativa ruim (rows=6) e viram nested loop de minutos
        cur.execute("set local enable_nestloop = off")
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.lower().endswith('.csv'))
            with z.open(name) as fh:
                header = fh.readline().decode('latin-1').strip().lstrip('﻿')
                cols = [re.sub(r'[^a-z0-9_]', '_', c.strip().lower()) for c in header.split(';')]
                need = {'nom_tipo_seglogr', 'nom_titulo_seglogr', 'nom_seglogr', 'num_endereco', 'dsc_modificador', 'cep',
                        'dsc_localidade', 'latitude', 'longitude', 'nv_geo_coord', 'cod_especie', 'dsc_estabelecimento'}
                missing = need - set(cols)
                if missing:
                    raise RuntimeError(f'{name}: colunas ausentes no CNEFE: {sorted(missing)}')
                cur.execute('create temp table cnefe_raw (' + ', '.join(f'"{c}" text' for c in cols) + ') on commit drop')
                with cur.copy("copy cnefe_raw from stdin with (format csv, delimiter ';', quote e'\\x01', encoding 'LATIN1')") as cp:
                    while True:
                        chunk = fh.read(1 << 20)
                        if not chunk:
                            break
                        cp.write(chunk)
        cur.execute('analyze cnefe_raw')
        cur.execute('select count(*) from cnefe_raw')
        n_raw = cur.fetchone()[0]
        t1 = time.time()
        cur.execute('delete from addr_point p using addr_street s where s.cod_mun = %(m)s and p.street_id = s.id', {'m': cod})
        cur.execute('delete from addr_street where cod_mun = %(m)s', {'m': cod})
        cur.execute('delete from addr_bairro where cod_mun = %(m)s', {'m': cod})
        for stmt in [x.strip() for x in re.split(r';\s*\n', SQL_AGG) if x.strip()]:
            if all(l.strip().startswith('--') or not l.strip() for l in stmt.splitlines()):
                continue
            ts = time.time()
            cur.execute(stmt, {'m': cod} if '%(m)s' in stmt else None)
            if os.environ.get('CNEFE_DEBUG'):
                print(f'      {time.time() - ts:6.1f}s  {" ".join(l for l in stmt.splitlines() if not l.strip().startswith("--"))[:90]}', flush=True)
        cur.execute("""select count(*), count(distinct p.street_id) from addr_point p join addr_street s on s.id = p.street_id
                        where s.cod_mun = %(m)s""", {'m': cod})
        n_pts, n_st = cur.fetchone()
        cur.execute("""select name, props->>'uf' from data_features where layer_id = 'geocoding' and kind = 'municipio'
                        and source_id = %(c)s limit 1""", {'c': str(cod)})
        row = cur.fetchone()
        nome = row[0] if row else nome_arquivo.split('_', 1)[1].rsplit('.', 1)[0].replace('_', ' ').title()
        uf = row[1] if row else UF_SIGLA.get(cod // 100000, '')
        cur.execute("""insert into addr_municipio (cod_mun, nome, uf, n_registros, n_enderecos, n_logradouros, fonte, carregado_em)
                       values (%s,%s,%s,%s,%s,%s,%s, now())
                       on conflict (cod_mun) do update set nome = excluded.nome, uf = excluded.uf, n_registros = excluded.n_registros,
                         n_enderecos = excluded.n_enderecos, n_logradouros = excluded.n_logradouros, fonte = excluded.fonte,
                         carregado_em = excluded.carregado_em""",
                    (cod, nome, uf, n_raw, n_pts, n_st, f'IBGE CNEFE 2022 ({nome_arquivo})'))
    print(f'    {cod} {nome}: {n_raw:,} registros → {n_pts:,} pontos, {n_st:,} logradouros '
          f'(copy {t1 - t0:.0f}s, agregação {time.time() - t1:.0f}s)', flush=True)
    return {'cod': cod, 'nome': nome, 'uf': uf, 'registros': n_raw, 'enderecos': n_pts, 'logradouros': n_st}


def fetch():
    global NOTES, RECORD_COUNT
    cods = municipios()
    listings: dict[int, dict[int, str]] = {}
    done, failed = [], []
    conn = _pg_conn()
    try:
        for cod in cods:
            uf = cod // 100000
            if uf not in UF_DIR:
                raise ValueError(f'UF {uf} sem pasta configurada (UF_DIR)')
            if uf not in listings:
                listings[uf] = _listing(uf)
            fname = listings[uf].get(cod)
            if not fname:
                print(f'  ! {cod}: arquivo não encontrado na listagem do IBGE')
                continue
            path = CACHE_DIR / 'geocoding' / 'cnefe' / fname
            _download(BASE + UF_DIR[uf] + '/' + fname, path)
            for attempt in range(3):
                try:
                    done.append(_load_municipio(conn, cod, path, fname))
                    break
                except Exception as e:  # noqa: BLE001 — lock_timeout, queda de conexão...
                    print(f'  ! {cod}: falhou ({type(e).__name__}: {str(e)[:160]}); tentativa {attempt + 1}/3', flush=True)
                    if conn.closed:
                        conn = _pg_conn()
                    time.sleep(10 * (attempt + 1))
            else:
                failed.append(cod)
        if 3550308 in [d['cod'] for d in done]:
            # capital recarregada: confere a orientação dos segmentos do GeoSampa pelos endereços (se já importados)
            with conn.transaction(), conn.cursor() as cur:
                cur.execute('select exists (select 1 from addr_segment where cod_mun = 3550308)')
                if cur.fetchone()[0]:
                    cur.execute('select * from addr_segment_orient(3550308)')
                    print('    GeoSampa: segmentos conferidos (r >= 0,3)/invertidos/fracos ou sem dado = %s' % (cur.fetchone(),), flush=True)
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute('vacuum analyze addr_point')
            cur.execute('analyze addr_street')
            cur.execute('analyze addr_bairro')
    finally:
        conn.close()
    # cobertura de TODOS os municípios já carregados (o runner substitui as feições desta fonte a cada carga)
    with _pg_conn() as c2, c2.cursor() as cur:
        cur.execute('select count(*), coalesce(sum(n_enderecos), 0), coalesce(sum(n_registros), 0) from addr_municipio')
        n_mun, n_pts, n_reg = cur.fetchone()
        cur.execute("""select m.cod_mun, m.nome, m.uf, m.n_enderecos, m.n_registros, m.n_logradouros,
                              ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_ConvexHull(ST_Collect(ST_MakePoint(s.lon, s.lat))), 0.0005), 6)
                         from addr_municipio m join addr_street s on s.cod_mun = m.cod_mun and s.lat is not null
                        group by m.cod_mun, m.nome, m.uf, m.n_enderecos, m.n_registros, m.n_logradouros""")
        cov = cur.fetchall()
    RECORD_COUNT = int(n_pts)
    NOTES = (f'Base: {n_pts:,} pontos de endereço em addr_point ({n_reg:,} registros do CNEFE) em {n_mun} municípios. '
             f'Esta carga: {sum(d["enderecos"] for d in done):,} pontos de {len(done)} município(s)'
             f'{f" (FALHARAM: {failed})" if failed else ""}. Tabelas próprias (addr_*); as feições aqui são só a '
             f'cobertura. Sem seed: rodar o importador.')
    if failed and not done:
        raise RuntimeError(f'CNEFE: nenhum município carregado (falharam {failed})')
    print('    ' + NOTES)
    return [{
        'source_id': str(cod),
        'geometry': json.loads(hull),
        'name': nome,
        'kind': 'cobertura_cnefe',
        'props': {'cod_ibge': cod, 'uf': uf, 'enderecos': n_e, 'registros': n_r, 'logradouros': n_l},
    } for cod, nome, uf, n_e, n_r, n_l, hull in cov if hull]
