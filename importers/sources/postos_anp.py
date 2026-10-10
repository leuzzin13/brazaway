"""Postos que vendem diesel, com preço — ANP (dados abertos, CC-BY; atribuição "Fonte: ANP").

Chave: CNPJ. Três conjuntos da ANP + OSM para posicionar:
  1. Cadastro de revendedores varejistas (diário): razão social, endereço, CEP, município, bandeira, autorização.
     NÃO tem coordenada nem lista de produtos.
  2. Levantamento de Preços de Combustíveis (LPC), arquivo "últimas 4 semanas" de diesel/GNV: preço de venda de
     DIESEL S10 e DIESEL (S500) por posto e data da coleta. Guardamos a coleta MAIS RECENTE de cada produto.
  3. PMQC (qualidade, mensal): latitude/longitude do posto onde a amostra foi colhida e o produto amostrado.
     Usamos os últimos PMQC_MESES (padrão 12) arquivos publicados; coordenada = mediana das coletas do CNPJ.
Posição (props.coord_fonte):
  - 'pmqc'        : coordenada do PMQC (CC-BY). Se houver amenity=fuel do OSM a ≤ 100 m, o posto é ligado a ele
                    (props.osm: id, distância, hgv, fuel:HGV_diesel) — a posição continua a do PMQC;
  - 'cnefe+osm'   : sem PMQC, o endereço (logradouro + número) é achado no CNEFE 2022 do IBGE (tabelas do
                    geocodificador próprio, se carregadas) e a posição vem do amenity=fuel do OSM a ≤ 100 m
                    desse ponto (ODbL — atribuído em meta.sources);
  - 'osm_endereco': sem PMQC nem CNEFE, amenity=fuel do OSM com o mesmo CEP + número (addr:postcode/housenumber)
                    ou mesma rua + número no mesmo município (ODbL).
  Sem posição confiável o posto fica de fora (não chutamos centroide de CEP).
Vende diesel? O cadastro não diz. Entra só posto com evidência: preço de diesel no LPC, amostra de diesel no PMQC ou
fuel:diesel/fuel:HGV_diesel=yes no OSM ligado. A evidência fica em props.diesel_evidencia.
Alcance: UFs em POSTOS_UFS (padrão SP, RJ, MG, ES — o mesmo extrato do Valhalla). Ver docs/layers/postos_diesel.md.
"""
from __future__ import annotations
import csv
import io
import math
import os
import re
import statistics
import unicodedata
from collections import defaultdict

from common import http_get

LAYER_ID = 'postos_diesel'
SOURCE = 'anp'
BASE = 'https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos'
CADASTRO_URL = (BASE + '/arquivos/arquivos-dados-cadastrais-dos-revendedores-varejistas-de-combustiveis-automotivos/'
                'dados-cadastrais-revendedores-varejistas-combustiveis-automoveis.csv')
LPC_URL = BASE + '/arquivos/shpc/qus/ultimas-4-semanas-diesel-gnv.csv'
PMQC_PAGE = BASE + '/pmqc-programa-de-monitoramento-da-qualidade-dos-combustiveis'
SOURCE_URL = f'{CADASTRO_URL} + {LPC_URL} + PMQC mensal ({PMQC_PAGE})'
LICENSE = ('CC-BY — Fonte: ANP (cadastro de revendedores, Levantamento de Preços de Combustíveis e PMQC; dados.gov.br '
           'license_id cc-by). Posições "cnefe+osm"/"osm_endereco": ODbL 1.0, © colaboradores do OpenStreetMap')
NOTES = ''

UFS = [u.strip().upper() for u in os.environ.get('POSTOS_UFS', 'SP,RJ,MG,ES').split(',') if u.strip()]
PMQC_MESES = int(os.environ.get('PMQC_MESES', '12'))
OSM_MAX_M = 100.0

TIPOS = ['RUA', 'AVENIDA', 'ESTRADA', 'RODOVIA', 'ALAMEDA', 'TRAVESSA', 'PRACA', 'LARGO', 'VIADUTO', 'PARQUE', 'VIA',
         'MARGINAL', 'ACESSO', 'VIELA', 'LADEIRA', 'PASSAGEM', 'CAMINHO', 'VILA']
ABBR = {'AV': 'AVENIDA', 'AVEN': 'AVENIDA', 'R': 'RUA', 'ROD': 'RODOVIA', 'RDV': 'RODOVIA', 'EST': 'ESTRADA', 'ESTR': 'ESTRADA',
        'AL': 'ALAMEDA', 'TV': 'TRAVESSA', 'TRAV': 'TRAVESSA', 'PC': 'PRACA', 'PCA': 'PRACA', 'LG': 'LARGO', 'VD': 'VIADUTO',
        'MARG': 'MARGINAL', 'PRES': 'PRESIDENTE', 'DR': 'DOUTOR', 'ENG': 'ENGENHEIRO', 'PROF': 'PROFESSOR', 'GOV': 'GOVERNADOR',
        'CEL': 'CORONEL', 'STA': 'SANTA', 'STO': 'SANTO', 'SEN': 'SENADOR', 'DEP': 'DEPUTADO', 'CAP': 'CAPITAO', 'GAL': 'GENERAL',
        'MAL': 'MARECHAL', 'BRIG': 'BRIGADEIRO', 'COMEND': 'COMENDADOR', 'VER': 'VEREADOR', 'PE': 'PADRE'}
PREP = {'DE', 'DA', 'DO', 'DAS', 'DOS', 'D', 'E'}


def norm(s: str | None) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().upper()
    return re.sub(r'[^A-Z0-9]+', ' ', s).strip()


def canon(s: str | None) -> str:
    return ' '.join(ABBR.get(w, w) for w in norm(s).split() if w not in PREP)


def split_tipo(street: str) -> tuple[str | None, str]:
    words = canon(street).split()
    if words and words[0] in TIPOS:
        return words[0], ' '.join(words[1:])
    return None, ' '.join(words)


def parse_endereco(endereco: str) -> tuple[str, int | None, bool]:
    """'AVENIDA JOSE RUI LINO,  500' -> ('AVENIDA JOSE RUI LINO', 500, False); 'ROD PRES DUTRA, KM 210' -> (.., 210, True)."""
    e = (endereco or '').strip()
    m = re.match(r'^(.*?)[,\s]+(?:N[º°O.]?\s*)?(KM\s*)?(\d{1,6})(?:[.,]\d+)?\b.*$', e, re.I)
    if m and m.group(1).strip():
        return m.group(1).strip(' ,'), int(m.group(3)), bool(m.group(2))
    return e.strip(' ,'), None, False


def cnpj(s) -> str:
    return re.sub(r'\D', '', str(s or '')).zfill(14)


def read_csv(raw: bytes) -> list[dict]:
    try:
        txt = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        txt = raw.decode('latin1')
    return list(csv.DictReader(io.StringIO(txt), delimiter=';'))


def fnum(v) -> float | None:
    try:
        return float(str(v).strip().replace(',', '.'))
    except (TypeError, ValueError):
        return None


def iso(d: str) -> str | None:
    m = re.match(r'(\d{2})/(\d{2})/(\d{4})', d or '')
    if m:
        return f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    m = re.match(r'(\d{4})-(\d{2})-(\d{2})', d or '')
    return m.group(0) if m else None


def dist_m(a_lat, a_lon, b_lat, b_lon) -> float:
    k = math.pi / 180
    x = (b_lon - a_lon) * k * math.cos((a_lat + b_lat) / 2 * k)
    y = (b_lat - a_lat) * k
    return math.hypot(x, y) * 6371000


# ------------------------------------------------------------------ fontes
def cadastro() -> dict[str, dict]:
    out = {}
    for r in read_csv(http_get(CADASTRO_URL, cache='anp_revendedores.csv', max_age_h=24)):
        if (r.get('UF') or '').strip().upper() not in UFS:
            continue
        c = cnpj(r.get('CNPJ'))
        out[c] = {k: (v or '').strip() for k, v in r.items()}
    return out


def lpc() -> tuple[dict[str, dict], tuple[str | None, str | None]]:
    """CNPJ -> {'s10': {valor, data}, 's500': {...}, 'nome', endereço...} (coleta mais recente de cada produto)."""
    out: dict[str, dict] = {}
    datas = []
    for r in read_csv(http_get(LPC_URL, cache='anp_lpc_4sem_diesel.csv', max_age_h=24)):
        uf = (r.get('Estado - Sigla') or '').strip().upper()
        if uf not in UFS:
            continue
        prod = (r.get('Produto') or '').strip().upper()
        key = 's10' if prod == 'DIESEL S10' else 's500' if prod == 'DIESEL' else None
        if not key:
            continue
        valor, data = fnum(r.get('Valor de Venda')), iso(r.get('Data da Coleta') or '')
        if not valor or not data or not (3 < valor < 20):
            continue
        datas.append(data)
        c = cnpj(r.get('CNPJ da Revenda'))
        o = out.setdefault(c, {'uf': uf, 'municipio': (r.get('Municipio') or '').strip(), 'revenda': (r.get('Revenda') or '').strip(),
                               'rua': (r.get('Nome da Rua') or '').strip(), 'numero': (r.get('Numero Rua') or '').strip(),
                               'bairro': (r.get('Bairro') or '').strip(), 'cep': re.sub(r'\D', '', r.get('Cep') or ''),
                               'bandeira': (r.get('Bandeira') or '').strip()})
        if key not in o or data > o[key]['data']:
            o[key] = {'valor': round(valor, 3), 'data': data}
    return out, (min(datas) if datas else None, max(datas) if datas else None)


def pmqc_urls() -> list[str]:
    html = http_get(PMQC_PAGE, cache='anp_pmqc_page.html', max_age_h=24).decode('utf-8', 'replace')
    urls = set(re.findall(r'https://www\.gov\.br/anp/[^"\s]*/arquivos/pmqc/\d{4}/[^"\s]+\.csv', html))
    def ym(u):
        m = re.search(r'/pmqc/(\d{4})/[^/]*?(\d{1,2})\.csv$', u)
        return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
    return sorted(urls, key=ym, reverse=True)[:PMQC_MESES]


def pmqc() -> tuple[dict[str, dict], list[str]]:
    """CNPJ -> {lat, lon, n, ultima, diesel_s10, diesel_s500, dispersao_m}."""
    pts: dict[str, list[tuple[float, float]]] = defaultdict(list)
    info: dict[str, dict] = {}
    usados = []
    for u in pmqc_urls():
        name = u.rsplit('/', 2)[-2] + '_' + u.rsplit('/', 1)[-1]
        try:
            raw = http_get(u, cache=f'anp_pmqc/{name}', max_age_h=24 * 60, timeout=300)
        except Exception as e:  # noqa: BLE001
            print(f'  ! PMQC {u} falhou: {e}')
            continue
        usados.append(name)
        txt = raw.decode('utf-8-sig', 'replace')
        seen_sample = set()
        for r in csv.DictReader(io.StringIO(txt), delimiter=';'):
            if (r.get('Uf') or '').strip().upper() not in UFS:
                continue
            c = cnpj(r.get('CnpjPosto'))
            lat, lon = fnum(r.get('Latitude')), fnum(r.get('Longitude'))
            prod = (r.get('Produto') or '').upper()
            d = iso(r.get('DataColeta') or '')
            i = info.setdefault(c, {'diesel_s10': False, 'diesel_s500': False, 'ultima': None})
            if 'DIESEL' in prod:
                if 'S10' in prod:
                    i['diesel_s10'] = True
                elif 'S500' in prod or 'S-500' in prod:
                    i['diesel_s500'] = True
            if d and (not i['ultima'] or d > i['ultima']):
                i['ultima'] = d
            sample = (r.get('IdNumeric'), c)
            if sample in seen_sample or lat is None or lon is None:
                continue
            seen_sample.add(sample)
            if -35 < lat < 6 and -75 < lon < -28:
                pts[c].append((lat, lon))
    out = {}
    for c, ps in pts.items():
        lat = statistics.median(p[0] for p in ps)
        lon = statistics.median(p[1] for p in ps)
        disp = statistics.median(dist_m(lat, lon, p[0], p[1]) for p in ps)
        out[c] = {**info.get(c, {}), 'lat': lat, 'lon': lon, 'n': len(ps), 'dispersao_m': round(disp)}
    return out, usados


class Grid:
    """Índice simples em grade (~1 km) para vizinho mais próximo."""
    def __init__(self, objs: list[dict], cell: float = 0.01):
        self.cell = cell
        self.g: dict[tuple[int, int], list[dict]] = defaultdict(list)
        for o in objs:
            self.g[(int(o['lon'] // cell), int(o['lat'] // cell))].append(o)

    def near(self, lat: float, lon: float, max_m: float) -> list[tuple[float, dict]]:
        cx, cy = int(lon // self.cell), int(lat // self.cell)
        out = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for o in self.g.get((cx + dx, cy + dy), []):
                    d = dist_m(lat, lon, o['lat'], o['lon'])
                    if d <= max_m:
                        out.append((d, o))
        return sorted(out, key=lambda x: x[0])


def osm_fuel() -> list[dict]:
    from sources._osm_pois import extract
    objs = extract(('amenity',), lambda t: t.get('amenity') == 'fuel')
    for o in objs:
        t = o['tags']
        o['pc'] = re.sub(r'\D', '', t.get('addr:postcode') or '')
        o['hn'] = (re.match(r'\d+', (t.get('addr:housenumber') or '').strip()) or [None])[0]
        o['street'] = canon(t.get('addr:street'))
        o['city'] = norm(t.get('addr:city'))
    return objs


def cnefe_points(postos: dict[str, dict]) -> dict[str, tuple[float, float, int | None]]:
    """CNPJ -> (lat, lon, nv_geo) pelo CNEFE (tabelas do geocodificador). Vazio se as tabelas não existirem."""
    try:
        from common import _pg_conn
        with _pg_conn() as c, c.cursor() as cur:
            cur.execute("select to_regclass('addr_point') is not null and exists (select 1 from addr_municipio)")
            if not cur.fetchone()[0]:
                return {}
            cur.execute('select cod_mun, nome, uf from addr_municipio')
            mun = {(norm(n), uf): cod for cod, n, uf in cur.fetchall()}
            cur.execute('create temp table q (cnpj text, cod_mun int, tipo text, nome text, numero int, km boolean, cep int)')
            rows = []
            for k, p in postos.items():
                cod = mun.get((norm(p['municipio']), p['uf']))
                if not cod or p['numero'] is None:
                    continue
                tipo, nome = split_tipo(p['rua'])
                if not nome:
                    continue
                rows.append((k, cod, tipo, nome, p['numero'], bool(p.get('km')), int(p['cep']) if p['cep'].isdigit() else None))
            with cur.copy('copy q from stdin') as cp:
                for r in rows:
                    cp.write_row(r)
            # nome_norm do CNEFE = geo_canon(titulo + nome), sem o tipo: normaliza do mesmo jeito, uma vez por linha.
            # Em dois passos: rua por hash join (sem nested loop o planejador usaria o índice trigram, minutos) e
            # depois o número pelo índice (street_id, numero) — o hash join direto em addr_point varre 5 M linhas.
            cur.execute('alter table q add column nome_c text')
            cur.execute('update q set nome_c = geo_canon(nome)')
            cur.execute('analyze q')
            cur.execute('set enable_nestloop = off')
            cur.execute('''create temp table qs as
                             select q.*, s.id as street_id, s.tipo as s_tipo
                               from q join addr_street s on s.cod_mun = q.cod_mun and s.nome_norm = q.nome_c''')
            cur.execute('analyze qs')
            cur.execute('set enable_nestloop = on')
            cur.execute('''
              select distinct on (qs.cnpj) qs.cnpj, p.lat, p.lon, p.nv_geo
                from qs join addr_point p on p.street_id = qs.street_id and p.numero = qs.numero and p.km = qs.km
               order by qs.cnpj, (qs.s_tipo is not distinct from qs.tipo) desc, (p.cep = qs.cep) desc, p.nv_geo nulls last''')
            return {r[0]: (float(r[1]), float(r[2]), r[3]) for r in cur.fetchall()}
    except Exception as e:  # noqa: BLE001
        print(f'  ! CNEFE indisponível ({e}); seguindo sem')
        return {}


# ------------------------------------------------------------------ montagem
def fetch():
    global NOTES
    cad = cadastro()
    precos, (coleta_ini, coleta_fim) = lpc()
    pm, meses = pmqc()
    print(f'  cadastro {len(cad)} · LPC {len(precos)} postos com diesel · PMQC {len(pm)} CNPJs com coordenada ({len(meses)} arquivos)')
    osm = osm_fuel()
    grid = Grid(osm)
    by_pc_hn: dict[tuple[str, str], list[dict]] = defaultdict(list)
    by_st_hn: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for o in osm:
        if o['hn'] and o['pc']:
            by_pc_hn[(o['pc'], o['hn'])].append(o)
        if o['hn'] and o['street']:
            by_st_hn[(o['street'], o['hn'])].append(o)

    # universo: postos do cadastro (+ os do LPC que não estão no cadastro)
    postos: dict[str, dict] = {}
    for c, r in cad.items():
        rua, num, km = parse_endereco(r.get('ENDERECO') or '')
        postos[c] = {'razao': r.get('RAZAOSOCIAL') or '', 'rua': rua, 'numero': num, 'km': km, 'endereco': r.get('ENDERECO') or '',
                     'complemento': r.get('COMPLEMENTO') or '', 'bairro': r.get('BAIRRO') or '', 'cep': re.sub(r'\D', '', r.get('CEP') or ''),
                     'municipio': r.get('MUNICIPIO') or '', 'uf': (r.get('UF') or '').upper(), 'bandeira': r.get('BANDEIRA') or '',
                     'autorizacao': r.get('AUTORIZACAO') or '', 'no_cadastro': True}
    for c, p in precos.items():
        if c in postos:
            continue
        num = int(p['numero']) if p['numero'].isdigit() else None
        postos[c] = {'razao': p['revenda'], 'rua': p['rua'], 'numero': num, 'km': False,
                     'endereco': f"{p['rua']}, {p['numero']}".strip(', '), 'complemento': '', 'bairro': p['bairro'], 'cep': p['cep'],
                     'municipio': p['municipio'], 'uf': p['uf'], 'bandeira': p['bandeira'], 'autorizacao': '', 'no_cadastro': False}

    # só quem tem evidência de diesel no LPC/PMQC precisa de posição; o OSM fuel:diesel entra depois da ligação
    sem_pmqc = {c: p for c, p in postos.items() if c not in pm}
    cn = cnefe_points(sem_pmqc)
    print(f'  CNEFE: {len(cn)} endereços achados (de {len(sem_pmqc)} postos sem PMQC)')

    used_osm: set[str] = set()
    out = []
    stats = defaultdict(int)
    for c, p in postos.items():
        pos = None
        osm_link = None
        if c in pm:
            q = pm[c]
            pos = (q['lat'], q['lon'], 'pmqc')
            near = grid.near(q['lat'], q['lon'], OSM_MAX_M)
            if near:
                osm_link = (near[0][0], near[0][1])
        elif c in cn:
            lat, lon, _nv = cn[c]
            near = [x for x in grid.near(lat, lon, OSM_MAX_M) if x[1]['osm_id'] not in used_osm]
            if near:
                d, o = near[0]
                pos = (o['lat'], o['lon'], 'cnefe+osm')
                osm_link = (d, o)
        if pos is None and p['numero'] is not None:
            hn = str(p['numero'])
            cands = [o for o in by_pc_hn.get((p['cep'], hn), []) if o['osm_id'] not in used_osm]
            if not cands:
                tipo, nome = split_tipo(p['rua'])
                cands = [o for o in by_st_hn.get((canon(p['rua']), hn), []) + (by_st_hn.get((nome, hn), []) if nome else [])
                         if o['osm_id'] not in used_osm and (not o['city'] or o['city'] == norm(p['municipio']))]
            if len({o['osm_id'] for o in cands}) == 1:
                o = cands[0]
                pos = (o['lat'], o['lon'], 'osm_endereco')
                osm_link = (0.0, o)
        if osm_link:
            used_osm.add(osm_link[1]['osm_id'])
        t = osm_link[1]['tags'] if osm_link else {}
        pr = precos.get(c, {})
        q = pm.get(c, {})
        evid = []
        if pr.get('s10') or pr.get('s500'):
            evid.append('preço no LPC')
        if q.get('diesel_s10') or q.get('diesel_s500'):
            evid.append('amostra de diesel no PMQC')
        if t.get('fuel:diesel') == 'yes' or t.get('fuel:HGV_diesel') == 'yes':
            evid.append('OSM fuel:diesel')
        if not evid:
            stats['sem_evidencia_diesel'] += 1
            continue
        if pos is None:
            stats['sem_posicao'] += 1
            continue
        stats[pos[2]] += 1
        lat, lon, fonte = pos
        bandeira = p['bandeira'] or None
        out.append({
            'source_id': c,
            'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]},
            'name': re.sub(r'\s+', ' ', p['razao']).strip().title() or 'Posto',
            'kind': 'com_preco' if (pr.get('s10') or pr.get('s500')) else 'sem_preco',
            'props': {
                'cnpj': c, 'razao_social': re.sub(r'\s+', ' ', p['razao']).strip(), 'bandeira': bandeira,
                'endereco': re.sub(r'\s+', ' ', ', '.join(x for x in [p['endereco'], p['complemento']] if x)).strip(),
                'bairro': p['bairro'] or None, 'municipio': p['municipio'], 'uf': p['uf'], 'cep': p['cep'] or None,
                'autorizacao_anp': p['autorizacao'] or None, 'no_cadastro_anp': p['no_cadastro'],
                'diesel_s10': pr.get('s10'), 'diesel_s500': pr.get('s500'),
                'coleta_lpc': {'de': coleta_ini, 'ate': coleta_fim},
                'diesel_evidencia': evid,
                'pmqc_s10': bool(q.get('diesel_s10')), 'pmqc_s500': bool(q.get('diesel_s500')),
                'coord_fonte': fonte,
                'pmqc_coletas': q.get('n'), 'pmqc_dispersao_m': q.get('dispersao_m'), 'pmqc_ultima': q.get('ultima'),
                'osm': ({'id': osm_link[1]['osm_id'], 'dist_m': round(osm_link[0]), 'nome': t.get('name'), 'marca': t.get('brand'),
                         'hgv': t.get('hgv'), 'hgv_diesel': t.get('fuel:HGV_diesel'), 'diesel': t.get('fuel:diesel'),
                         'horario': t.get('opening_hours')} if osm_link else None),
            },
        })
    com_preco = sum(1 for f in out if f['kind'] == 'com_preco')
    NOTES = (f'UFs {",".join(UFS)}. {len(out)} postos com diesel e posição ({com_preco} com preço do LPC, coletas de '
             f'{coleta_ini} a {coleta_fim}). Posição: PMQC {stats["pmqc"]}, CNEFE+OSM {stats["cnefe+osm"]}, '
             f'OSM por endereço {stats["osm_endereco"]}. Fora: {stats["sem_posicao"]} sem posição confiável, '
             f'{stats["sem_evidencia_diesel"]} sem evidência de diesel. PMQC: {", ".join(meses)}.')
    print('  ' + NOTES)
    return out
