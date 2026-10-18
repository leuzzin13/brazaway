"""Postos que vendem diesel, com preço — ANP (dados abertos, CC-BY; atribuição "Fonte: ANP").

Chave: CNPJ. Três conjuntos da ANP + OSM para posicionar:
  1. Cadastro de revendedores varejistas (diário): razão social, endereço, CEP, município, bandeira, autorização.
     NÃO tem coordenada nem lista de produtos.
  2. Levantamento de Preços de Combustíveis (LPC), arquivo "últimas 4 semanas" de diesel/GNV: preço de venda de
     DIESEL S10 e DIESEL (S500) por posto e data da coleta. Guardamos a coleta MAIS RECENTE de cada produto.
  3. PMQC (qualidade, mensal): latitude/longitude do posto onde a amostra foi colhida e o produto amostrado.
     Usamos os últimos PMQC_MESES (padrão 12) arquivos publicados; coordenada = mediana das coletas do CNPJ.
     O PMQC às vezes grava o centro da cidade ou um ponto padrão: descartamos a amostra cujo ponto exato aparece para
     2+ CNPJs ou tem ≤ 3 casas decimais, o CNPJ com coletas espalhadas (> 500 m) e o ponto a mais de 1 km do polígono
     do município do próprio posto (malha do IBGE da camada geocoding). Esses postos seguem para os passos abaixo.
Posição (props.coord_fonte):
  - 'pmqc'        : coordenada do PMQC (CC-BY). Se houver amenity=fuel do OSM a ≤ 100 m, o posto é ligado a ele
                    (props.osm: id, distância, nome, marca, hgv, fuel:HGV_diesel, horário — ODbL) — a posição continua
                    a do PMQC;
  - 'cnefe+osm'   : sem PMQC, o endereço (logradouro + número) é achado no CNEFE 2022 do IBGE (tabelas do
                    geocodificador próprio, se carregadas) e a posição vem do amenity=fuel do OSM a ≤ 100 m
                    desse ponto (ODbL — atribuído em meta.sources);
  - 'osm_endereco': sem PMQC nem CNEFE, amenity=fuel do OSM com o mesmo CEP + número (addr:postcode/housenumber)
                    ou mesma rua + número no mesmo município (ODbL).
  Sem posição confiável o posto fica de fora (não chutamos centroide de CEP).
Vende diesel? O cadastro não diz. Entra só posto com evidência: preço de diesel no LPC, amostra de diesel no PMQC ou
fuel:diesel/fuel:HGV_diesel=yes no OSM ligado. A evidência fica em props.diesel_evidencia.
Alcance: UFs em POSTOS_UFS (padrão: as 11 UFs do Sudeste, Sul e Centro-Oeste — as dos tiles do Valhalla). Ver docs/layers/postos_diesel.md.
"""
from __future__ import annotations
import csv
import io
import math
import os
import re
import statistics
import unicodedata
import zipfile
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
           'license_id cc-by). Partes do OpenStreetMap, ODbL 1.0 (© colaboradores do OpenStreetMap): posições '
           '"cnefe+osm"/"osm_endereco" e props.osm (id, nome, marca, hgv, fuel:diesel, horário) dos postos ligados ao OSM')
NOTES = ''

UFS = [u.strip().upper() for u in os.environ.get('POSTOS_UFS', 'SP,RJ,MG,ES,PR,SC,RS,GO,MT,MS,DF').split(',') if u.strip()]
PMQC_MESES = int(os.environ.get('PMQC_MESES', '12'))
OSM_MAX_M = 100.0
PMQC_MAX_DISP_M = 500.0      # dispersão máxima das coletas do mesmo CNPJ
PMQC_MAX_FORA_MUN_M = 1000.0  # ponto a mais disso do município do posto = posição errada

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


_NUM_RE = re.compile(r'^(?:N[º°O.]?\s*)?(KM|QUIL[OÔ]METRO)?\s*(\d{1,6})(?:\.(\d{3})\b)?(?:[.,]\d+)?\b', re.I)
_KM_NA_RUA_RE = re.compile(r'^(.*?)\s*[-,]?\s*\b(?:KM|QUIL[OÔ]METRO)\s*(\d{1,4})(?:[.,]\d+)?\b', re.I)


def parse_endereco(endereco: str) -> tuple[str, int | None, bool]:
    """Endereço do cadastro da ANP ('LOGRADOURO,  NÚMERO[, ...]') -> (logradouro, número, número é km?).

    Separa na VÍRGULA, não no primeiro número: o nome do logradouro pode ter número ('RUA 24 DE MAIO,  1281',
    'RODOVIA BR 101,  KM 578'). Ponto de milhar ('1.310') é juntado; fração de km ('KM 36,8') é descartada.
    'RODOVIA BR 262 KM 169, S/N' -> km no próprio logradouro. Sem número ('S/N') -> (logradouro, None, False).
    """
    e = re.sub(r'\s+', ' ', endereco or '').strip()
    segs = [x.strip() for x in e.split(',')]
    rua = segs[0].strip(' -')
    i = 1
    if rua.upper().rstrip('.') in TIPOS or len(rua) < 3:   # 'AVENIDA , ARAGUAIA, 164'
        while i < len(segs) and not segs[i]:
            i += 1
        if i < len(segs) and not _NUM_RE.match(segs[i]):
            rua, i = f'{rua} {segs[i]}'.strip(), i + 1
    for seg in segs[i:]:
        m = _NUM_RE.match(seg)
        if m:
            km = bool(m.group(1))
            return rua, int(m.group(2) + m.group(3)) if m.group(3) and not km else int(m.group(2)), km
    m = _KM_NA_RUA_RE.match(rua)
    if m and m.group(1).strip(' -,'):
        return m.group(1).strip(' -,'), int(m.group(2)), True
    return rua, None, False


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


def _pmqc_periodo(u: str) -> tuple[int, int, int] | None:
    """(ano, mês, meses cobertos) do arquivo: pmqc/AAAA/...MM.csv (formato antigo), pmqc_AAAA_MM.zip (mês do ano
    corrente) ou pmqc_AAAA.zip (ano fechado, 12 meses)."""
    if m := re.search(r'/pmqc/(\d{4})/[^/]*?(\d{1,2})\.csv$', u):
        return int(m.group(1)), int(m.group(2)), 1
    if m := re.search(r'/pmqc/pmqc_(\d{4})_(\d{1,2})\.zip$', u):
        return int(m.group(1)), int(m.group(2)), 1
    if m := re.search(r'/pmqc/pmqc_(\d{4})\.zip$', u):
        return int(m.group(1)), 12, 12
    return None


def pmqc_urls() -> list[str]:
    """Arquivos mais recentes até cobrir PMQC_MESES meses (a página hoje publica um zip por ano fechado e um por mês do
    ano corrente; antes, um CSV por mês em pmqc/AAAA/)."""
    html = http_get(PMQC_PAGE, cache='anp_pmqc_page.html', max_age_h=24).decode('utf-8', 'replace')
    urls = set(re.findall(r'https://www\.gov\.br/anp/[^"\s]*/arquivos/pmqc/[^"\s]+\.(?:csv|zip)', html))
    per = sorted(((p, u) for u in urls if (p := _pmqc_periodo(u))), key=lambda x: (x[0][0], x[0][1]), reverse=True)
    out, meses = [], 0
    for (_a, _m, n), u in per:
        if meses >= PMQC_MESES:
            break
        out.append(u)
        meses += n
    return out


def _pmqc_textos(raw: bytes, u: str) -> list[str]:
    """Texto dos CSV do arquivo (o zip pode trazer um ou mais CSV)."""
    if not u.endswith('.zip'):
        return [raw.decode('utf-8-sig', 'replace')]
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        return [z.read(n).decode('utf-8-sig', 'replace') for n in z.namelist() if n.lower().endswith('.csv')]


def _decimais(v: str | None) -> int:
    t = (v or '').strip().replace(',', '.')
    return len(t.split('.', 1)[1].rstrip('0')) if '.' in t else 0


def pmqc_positions(amostras: dict[str, list[tuple[float, float, int]]]) -> tuple[dict[str, dict], dict[str, tuple[str, str]]]:
    """Posição de cada CNPJ a partir das amostras do PMQC [(lat, lon, casas decimais)], sem os pontos-padrão.

    O PMQC às vezes grava o centro da cidade (ou um ponto fixo) em vez do posto: o mesmo ponto aparece para vários
    CNPJs (12 postos de S. J. do Rio Preto num ponto só; 20 postos de 4 UFs num ponto em S. João de Meriti). Por isso:
      1. descarta a AMOSTRA cujo ponto exato (6 casas) aparece para 2+ CNPJs diferentes, ou que tem ≤ 3 casas decimais
         (precisão de 100 m ou pior: não é a posição do posto);
      2. posição = mediana das amostras que sobram; descarta o CNPJ se a dispersão (mediana da distância das amostras
         à mediana) passar de PMQC_MAX_DISP_M.
    Devolve (CNPJ -> {lat, lon, n, dispersao_m}, CNPJ -> (código, motivo) da rejeição). A conferência com o município
    do posto é feita depois (fora_do_municipio), porque precisa do banco.
    """
    por_ponto: dict[tuple[float, float], set[str]] = defaultdict(set)
    for c, ps in amostras.items():
        for lat, lon, _d in ps:
            por_ponto[(round(lat, 6), round(lon, 6))].add(c)
    out: dict[str, dict] = {}
    rejeitados: dict[str, tuple[str, str]] = {}
    for c, ps in amostras.items():
        boas = [(lat, lon) for lat, lon, d in ps if d >= 4 and len(por_ponto[(round(lat, 6), round(lon, 6))]) < 2]
        if not boas:
            rejeitados[c] = (('ponto_repetido', 'ponto do PMQC repetido em outros CNPJs (centro da cidade/ponto padrão)')
                             if any(len(por_ponto[(round(la, 6), round(lo, 6))]) >= 2 for la, lo, _ in ps)
                             else ('baixa_precisao', 'coordenada do PMQC com 3 casas decimais ou menos'))
            continue
        lat = statistics.median(p[0] for p in boas)
        lon = statistics.median(p[1] for p in boas)
        disp = statistics.median(dist_m(lat, lon, p[0], p[1]) for p in boas)
        if disp > PMQC_MAX_DISP_M:
            rejeitados[c] = ('espalhado', f'coletas do PMQC espalhadas ({round(disp)} m da mediana)')
            continue
        out[c] = {'lat': lat, 'lon': lon, 'n': len(boas), 'dispersao_m': round(disp)}
    return out, rejeitados


def pmqc() -> tuple[dict[str, dict], dict[str, dict], dict[str, tuple[str, str]], list[str]]:
    """(CNPJ -> posição aceita {lat, lon, n, dispersao_m}, CNPJ -> info de TODAS as amostras {diesel_s10, diesel_s500,
    ultima, municipio, uf}, CNPJ -> motivo da rejeição da posição, arquivos usados)."""
    amostras: dict[str, list[tuple[float, float, int]]] = defaultdict(list)
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
        seen_sample = set()
        for r in (r for txt in _pmqc_textos(raw, u) for r in csv.DictReader(io.StringIO(txt), delimiter=';')):
            uf = (r.get('Uf') or '').strip().upper()
            if uf not in UFS:
                continue
            c = cnpj(r.get('CnpjPosto'))
            lat, lon = fnum(r.get('Latitude')), fnum(r.get('Longitude'))
            prod = (r.get('Produto') or '').upper()
            d = iso(r.get('DataColeta') or '')
            i = info.setdefault(c, {'diesel_s10': False, 'diesel_s500': False, 'ultima': None, 'uf': uf, 'municipio': ''})
            if (r.get('Município') or '').strip():
                i['municipio'] = r['Município'].strip()
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
                amostras[c].append((lat, lon, min(_decimais(r.get('Latitude')), _decimais(r.get('Longitude')))))
    pos, rejeitados = pmqc_positions(amostras)
    return pos, info, rejeitados, usados


# nome do município no cadastro da ANP -> nome do IBGE (só os que não casam pela normalização)
MUN_ALIAS = {('SAO THOME DAS LETRAS', 'MG'): 'SAO TOME DAS LETRAS', ('BARAO DE MONTE ALTO', 'MG'): 'BARAO DO MONTE ALTO',
             ('FLORINIA', 'SP'): 'FLORINEA'}


def fora_do_municipio(pts: dict[str, tuple[float, float, str, str]]) -> dict[str, float] | None:
    """CNPJ -> distância (m) do ponto ao polígono do município do próprio posto (camada geocoding, malha do IBGE;
    0 = dentro). pts: CNPJ -> (lat, lon, município, UF). Só entram os CNPJs cujo município casou pelo nome.
    None se a malha de municípios não estiver carregada (a conferência é pulada)."""
    try:
        from common import _pg_conn
        with _pg_conn() as conn, conn.cursor() as cur:
            cur.execute("select source_id, name, props->>'uf' from data_features where layer_id = 'geocoding' and kind = 'municipio'")
            mun = {(norm(n), uf): sid for sid, n, uf in cur.fetchall()}
            if not mun:
                return None
            cur.execute('create temp table pq (cnpj text, cod text, lon float8, lat float8)')
            with cur.copy('copy pq from stdin') as cp:
                for k, (lat, lon, m, uf) in pts.items():
                    key = (norm(m), uf)
                    cod = mun.get(key) or mun.get((MUN_ALIAS.get(key, ''), uf))
                    if cod:
                        cp.write_row((k, cod, lon, lat))
            cur.execute("""
              select pq.cnpj, ST_Distance(f.geom::geography, ST_SetSRID(ST_MakePoint(pq.lon, pq.lat), 4326)::geography)
                from pq join data_features f on f.layer_id = 'geocoding' and f.kind = 'municipio' and f.source_id = pq.cod""")
            return {r[0]: float(r[1]) for r in cur.fetchall()}
    except Exception as e:  # noqa: BLE001
        print(f'  ! malha de municípios indisponível ({e}); conferência do município pulada')
        return None


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
    pm, pm_info, pm_rejeitado, meses = pmqc()
    print(f'  cadastro {len(cad)} · LPC {len(precos)} postos com diesel · PMQC {len(pm_info)} CNPJs, {len(pm)} com posição '
          f'aceita e {len(pm_rejeitado)} com ponto padrão/espalhado ({len(meses)} arquivos)')
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

    # PMQC fora do município do próprio posto (> 1 km do polígono do IBGE) = ponto errado: descarta a posição
    fora = fora_do_municipio({c: (q['lat'], q['lon'], postos[c]['municipio'] or pm_info[c]['municipio'], postos[c]['uf'])
                              for c, q in pm.items() if c in postos})
    if fora is None:
        print('  ! conferência do município pulada (camada geocoding/municipio não carregada)')
    for c, d in (fora or {}).items():
        if d > PMQC_MAX_FORA_MUN_M:
            pm_rejeitado[c] = ('fora_municipio', f'coordenada do PMQC a {d / 1000:.1f} km do município do posto')
            del pm[c]
    motivos: dict[str, int] = defaultdict(int)
    for c, (cod, _txt) in pm_rejeitado.items():
        if c in postos:
            motivos[cod] += 1
    print('  posição do PMQC descartada: ' + ', '.join(f'{k} {v}' for k, v in sorted(motivos.items())))

    # quem não tem posição aceita do PMQC (inclusive os descartados acima) tenta CNEFE+OSM e OSM por endereço
    sem_pmqc = {c: p for c, p in postos.items() if c not in pm}
    cn = cnefe_points(sem_pmqc)
    print(f'  CNEFE: {len(cn)} endereços achados (de {len(sem_pmqc)} postos sem PMQC)')

    used_osm: set[str] = set()
    out = []
    stats = defaultdict(int)
    # PMQC primeiro: o posto do OSM ao lado de um posto do PMQC é dele, não de um CNPJ achado pelo endereço
    for c in sorted(postos, key=lambda k: k not in pm):
        p = postos[c]
        pos = None
        osm_link = None
        if c in pm:
            q = pm[c]
            pos = (q['lat'], q['lon'], 'pmqc')
            near = [x for x in grid.near(q['lat'], q['lon'], OSM_MAX_M) if x[1]['osm_id'] not in used_osm]
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
        q = {**pm_info.get(c, {}), **pm.get(c, {})}
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
                'pmqc_posicao_descartada': pm_rejeitado[c][1] if c in pm_rejeitado else None,
                'osm': ({'id': osm_link[1]['osm_id'], 'dist_m': round(osm_link[0]), 'nome': t.get('name'), 'marca': t.get('brand'),
                         'hgv': t.get('hgv'), 'hgv_diesel': t.get('fuel:HGV_diesel'), 'diesel': t.get('fuel:diesel'),
                         'horario': t.get('opening_hours')} if osm_link else None),
            },
        })
    com_preco = sum(1 for f in out if f['kind'] == 'com_preco')
    NOTES = (f'UFs {",".join(UFS)}. {len(out)} postos com diesel e posição ({com_preco} com preço do LPC, coletas de '
             f'{coleta_ini} a {coleta_fim}). Posição: PMQC {stats["pmqc"]}, CNEFE+OSM {stats["cnefe+osm"]}, '
             f'OSM por endereço {stats["osm_endereco"]}. Fora: {stats["sem_posicao"]} sem posição confiável, '
             f'{stats["sem_evidencia_diesel"]} sem evidência de diesel. Posição do PMQC descartada em '
             f'{sum(motivos.values())} postos (ponto repetido em outros CNPJs {motivos["ponto_repetido"]}, baixa precisão '
             f'{motivos["baixa_precisao"]}, coletas espalhadas {motivos["espalhado"]}, fora do município {motivos["fora_municipio"]})'
             f'{"" if fora is not None else " (sem conferência do município: malha do IBGE não carregada)"}. '
             f'PMQC: {", ".join(meses)}.')
    print('  ' + NOTES)
    return out
