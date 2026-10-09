"""Roubo e furto de carga: microdados de BO da SSP-SP (SPDadosCriminais_AAAA.xlsx), ano corrente e anterior.

O XLSX tem centenas de MB e ~700 mil linhas por ano: é baixado em streaming para data/cache e lido com iterparse
(sem openpyxl/pandas, sem carregar as planilhas na memória). Só ficam as naturezas ROUBO DE CARGA e FURTO DE CARGA.

PRIVACIDADE: nunca grava BO, endereço, número, data ou hora individual. A saída são células de 1 km (polígonos) com
pelo menos MIN_EVENTOS ocorrências, contadas por faixa do dia, tipo de local e dia da semana. Nome de bairro ou via só
aparece quando sustentado por pelo menos MIN_EVENTOS ocorrências da célula.
"""
from __future__ import annotations
import datetime as dt, json, math, re, zipfile
import xml.etree.ElementTree as ET
from collections import Counter
from common import http_get
from sources.acidentes_infosiga import titulo

LAYER_ID = 'roubo_carga'
SOURCE = 'ssp-sp'
SOURCE_URL = 'https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados/SPDadosCriminais_AAAA.xlsx'
LICENSE = ('Dados abertos SSP-SP — sem licença explícita nos arquivos; publicados como dados abertos em formato reutilizável '
           '(Plano de Dados Abertos SSP 2025-2027; Decreto estadual 68.769/2024). Uso comercial a confirmar via SIC.')
NOTES = 'Células de 1 km (EPSG:5880), mínimo de 3 ocorrências; ROUBO DE CARGA + FURTO DE CARGA; ano corrente e anterior.'

BASE = 'https://www.ssp.sp.gov.br/'
INDEX = BASE + 'assets/estatistica/transparencia/spDados160_516.json'
MENSAL = BASE + 'v1/OcorrenciasMensais/RecuperaDadosMensaisAgrupados?ano={ano}&grupoDelito=6&tipoGrupo=ESTADO&idGrupo=0'
NATUREZAS = {'ROUBO DE CARGA': 'roubo', 'FURTO DE CARGA': 'furto'}
GRID_M = 1000
MIN_EVENTOS = 3
FAIXAS = ('madrugada', 'manha', 'tarde', 'noite')     # 00–05h59, 06–11h59, 12–17h59, 18–23h59
PERIODO_SSP = {'DE MADRUGADA': 'madrugada', 'PELA MANHA': 'manha', 'A TARDE': 'tarde', 'A NOITE': 'noite'}
NIVEL_ALTO = 10          # ocorrências na célula no período (ano anterior + corrente)
NIVEL_MUITO_ALTO = 25
SP_BBOX = (-53.2, -25.4, -44.1, -19.7)
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
NS_R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
COLS = ('NUM_BO', 'ANO_BO', 'NOME_DELEGACIA', 'NOME_MUNICIPIO', 'DATA_OCORRENCIA_BO', 'HORA_OCORRENCIA_BO', 'DESC_PERIODO',
        'DESCR_TIPOLOCAL', 'DESCR_SUBTIPOLOCAL', 'BAIRRO', 'LOGRADOURO', 'LATITUDE', 'LONGITUDE', 'NATUREZA_APURADA',
        'ANO_ESTATISTICA', 'MES_ESTATISTICA')


def _norm(s) -> str:
    import unicodedata
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().upper()
    return ' '.join(s.split())


def _download(url: str, cache: str, max_age_h: float):
    from sources.acidentes_infosiga import download   # download em streaming (comum às camadas de segurança)
    return download(url, cache, max_age_h=max_age_h, timeout=900)


# ----------------------------------------------------------------------------------------------------------------
# Leitura do XLSX em streaming
# ----------------------------------------------------------------------------------------------------------------
def _col(ref: str) -> int:
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
        else:
            break
    return n - 1


def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    out: list[str] = []
    if 'xl/sharedStrings.xml' not in z.namelist():
        return out
    for _, el in ET.iterparse(z.open('xl/sharedStrings.xml')):
        if el.tag == NS + 'si':
            out.append(''.join(t.text or '' for t in el.iter(NS + 't')))
            el.clear()
    return out


def _sheets(z: zipfile.ZipFile) -> list[tuple[str, str]]:
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    target = {r.get('Id'): r.get('Target') for r in rels}
    out = []
    for sh in wb.iter(NS + 'sheet'):
        t = target[sh.get(NS_R + 'id')].lstrip('/')
        out.append((sh.get('name'), t if t.startswith('xl/') else 'xl/' + t))
    return out


def iter_rows(path):
    """Gera dicts {coluna: valor} só das linhas de roubo/furto de carga, aba por aba, sem carregar a planilha."""
    with zipfile.ZipFile(path) as z:
        ss = _shared_strings(z)
        for name, target in _sheets(z):
            if 'CAMPOS' in _norm(name):          # aba de dicionário
                continue
            header: dict[int, str] | None = None
            nat_col = -1
            sheet_data = None
            for ev, el in ET.iterparse(z.open(target), events=('start', 'end')):
                if ev == 'start':
                    if el.tag == NS + 'sheetData':
                        sheet_data = el
                    continue
                if el.tag != NS + 'row':
                    continue
                vals: dict[int, str] = {}
                for c in el.iter(NS + 'c'):
                    ci = _col(c.get('r') or '')
                    if header is not None and ci not in header:
                        continue
                    t = c.get('t')
                    if t == 'inlineStr':
                        v = ''.join(x.text or '' for x in c.iter(NS + 't'))
                    else:
                        ve = c.find(NS + 'v')
                        if ve is None or ve.text is None:
                            continue
                        v = ss[int(ve.text)] if t == 's' else ve.text
                    vals[ci] = v
                if sheet_data is not None:
                    sheet_data.clear()            # libera as linhas já lidas
                if header is None:
                    header = {i: str(v).strip() for i, v in vals.items() if str(v).strip() in COLS}
                    nat_col = next((i for i, h in header.items() if h == 'NATUREZA_APURADA'), -1)
                    if nat_col < 0:
                        raise RuntimeError(f'aba {name}: coluna NATUREZA_APURADA não encontrada')
                    continue
                if (vals.get(nat_col) or '').strip().upper() not in NATUREZAS:
                    continue
                yield {header[i]: v for i, v in vals.items()}


# ----------------------------------------------------------------------------------------------------------------
# Normalização de cada ocorrência (só em memória)
# ----------------------------------------------------------------------------------------------------------------
def _num(v) -> float | None:
    try:
        x = float(str(v).replace(',', '.'))
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _date(v) -> dt.date | None:
    x = _num(v)
    if x is not None and 20000 < x < 80000:                 # número de série do Excel
        return dt.date(1899, 12, 30) + dt.timedelta(days=int(x))
    s = str(v or '').strip()
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%Y-%m-%d %H:%M:%S'):
        try:
            return dt.datetime.strptime(s[:19] if 'H' in fmt else s[:10], fmt).date()
        except ValueError:
            pass
    return None


def _hour(v) -> int | None:
    x = _num(v)
    if x is not None and 0 <= x < 1:                         # fração do dia do Excel
        return int(x * 24 + 1e-6) % 24
    m = re.match(r'\s*(\d{1,2}):\d{2}', str(v or ''))
    if m and int(m.group(1)) < 24:
        return int(m.group(1))
    return None


def _faixa(row) -> str | None:
    h = _hour(row.get('HORA_OCORRENCIA_BO'))
    if h is not None:
        return FAIXAS[h // 6]
    return PERIODO_SSP.get(_norm(row.get('DESC_PERIODO')))


def _local(row) -> str:
    sub, tipo = _norm(row.get('DESCR_SUBTIPOLOCAL')), _norm(row.get('DESCR_TIPOLOCAL'))
    if 'POSTO DE GASOLINA' in sub:
        return 'posto'
    if 'ACOSTAMENTO' in sub:
        return 'acostamento'
    if 'RODOVIA' in tipo:
        return 'rodovia'
    if 'VIA PUBLICA' in tipo:
        return 'via_publica'
    return 'outro'


def _nome(v) -> str | None:
    s = ' '.join(str(v or '').split())
    if not s or _norm(s).startswith('VEDACAO'):
        return None
    if s.isupper():
        s = ' '.join(w if i == 0 or w not in ('De', 'Da', 'Do', 'Das', 'Dos', 'E') else w.lower()
                     for i, w in enumerate(s.title().split()))
    return s


# ----------------------------------------------------------------------------------------------------------------
_tr = None


def _transformers():
    global _tr
    if _tr is None:
        from pyproj import Transformer
        _tr = (Transformer.from_crs('EPSG:4326', 'EPSG:5880', always_xy=True), Transformer.from_crs('EPSG:5880', 'EPSG:4326', always_xy=True))
    return _tr


def _cell(lon, lat) -> tuple[int, int]:
    x, y = _transformers()[0].transform(lon, lat)
    return int(math.floor(x / GRID_M)), int(math.floor(y / GRID_M))


def _cell_polygon(ix: int, iy: int) -> dict:
    inv = _transformers()[1]
    corners = [(ix, iy), (ix + 1, iy), (ix + 1, iy + 1), (ix, iy + 1), (ix, iy)]
    ring = []
    for cx, cy in corners:
        lon, lat = inv.transform(cx * GRID_M, cy * GRID_M)
        ring.append([round(lon, 6), round(lat, 6)])
    return {'type': 'Polygon', 'coordinates': [ring]}


def _files() -> dict[int, str]:
    d = json.loads(http_get(INDEX, cache='ssp/spDados_index.json', max_age_h=24))
    out = {}
    for grupo in d.get('data', []):
        if 'CRIMINAIS' not in _norm(grupo.get('nome')):
            continue
        for it in grupo.get('lista', []):
            m = re.search(r'(\d{4})', str(it.get('periodo')))
            if m and it.get('arquivo'):
                out[int(m.group(1))] = BASE + it['arquivo'].lstrip('/')
    return out


def _oficial(ano: int) -> int | None:
    """Total oficial de ROUBO DE CARGA no estado (API mensal da SSP), para conferir a integridade dos microdados."""
    try:
        d = json.loads(http_get(MENSAL.format(ano=ano), cache=f'ssp/mensal_{ano}.json', max_age_h=24, timeout=60))
        for blk in d.get('data', []):
            for it in blk.get('listaDados', []):
                if _norm((it.get('delito') or {}).get('delito')).startswith('ROUBO DE CARGA'):
                    return int(it.get('total') or 0)
    except Exception as e:   # conferência é opcional
        print(f'  ! API mensal indisponível: {e}')
    return None


def fetch():
    files = _files()
    if not files:
        raise RuntimeError('índice de arquivos da SSP sem "Dados criminais"')
    anos = sorted(files)[-2:]                     # ano corrente e anterior (os dois mais recentes publicados)
    cells: dict[tuple[int, int], dict] = {}
    seen: set[tuple] = set()
    stats = Counter()
    faixa_estado = Counter()
    roubo_ano = Counter()
    dmin, dmax = None, None
    for ano in anos:
        path = _download(files[ano], f'ssp/SPDadosCriminais_{ano}.xlsx', max_age_h=24 * (7 if ano == anos[-1] else 60))
        print(f'    lendo {path.name} ...', flush=True)
        for row in iter_rows(path):
            nat = NATUREZAS[row['NATUREZA_APURADA'].strip().upper()]
            key = (str(row.get('NUM_BO', '')).strip(), str(row.get('ANO_BO', '')).strip(), _norm(row.get('NOME_DELEGACIA')), nat)
            if key in seen:
                stats['duplicado'] += 1
                continue
            seen.add(key)
            stats[nat] += 1
            if nat == 'roubo':
                roubo_ano[ano] += 1
            f = _faixa(row)
            faixa_estado[f or 'sem_hora'] += 1
            lat, lon = _num(row.get('LATITUDE')), _num(row.get('LONGITUDE'))
            if lat is None or lon is None or not (SP_BBOX[0] <= lon <= SP_BBOX[2] and SP_BBOX[1] <= lat <= SP_BBOX[3]):
                stats['sem_coord'] += 1
                continue
            d = _date(row.get('DATA_OCORRENCIA_BO'))
            if d:
                dmin = d if dmin is None or d < dmin else dmin
                dmax = d if dmax is None or d > dmax else dmax
            k = _cell(lon, lat)
            c = cells.get(k)
            if c is None:
                c = cells[k] = {'total': 0, 'roubo': 0, 'furto': 0, 'per': Counter(), 'local': Counter(), 'fds': 0,
                                'mun': Counter(), 'bairro': Counter(), 'via': Counter()}
            c['total'] += 1
            c[nat] += 1
            c['per'][f or 'sem_hora'] += 1
            c['local'][_local(row)] += 1
            if d and d.weekday() >= 5:
                c['fds'] += 1
            for fld, col in (('mun', 'NOME_MUNICIPIO'), ('bairro', 'BAIRRO'), ('via', 'LOGRADOURO')):
                n = titulo(row.get(col)) if fld == 'mun' else _nome(row.get(col))
                if n:
                    c[fld][n] += 1
    periodo = {'de': (dmin or dt.date(min(anos), 1, 1)).isoformat(), 'ate': (dmax or dt.date.today()).isoformat()}
    out = []
    for (ix, iy), c in cells.items():
        if c['total'] < MIN_EVENTOS:
            continue
        per = {k: c['per'].get(k, 0) for k in FAIXAS}
        pico = max(FAIXAS, key=lambda k: per[k]) if any(per.values()) else None
        top = lambda cnt: next(((n, v) for n, v in cnt.most_common(1)), (None, 0))
        mun = top(c['mun'])[0]
        bairro, nb = top(c['bairro'])
        via, nv = top(c['via'])
        nivel = 'muito_alto' if c['total'] >= NIVEL_MUITO_ALTO else 'alto' if c['total'] >= NIVEL_ALTO else 'moderado'
        regiao = (bairro if nb >= MIN_EVENTOS else None)
        out.append({
            'source_id': f'{GRID_M}m:{ix}:{iy}',
            'geometry': _cell_polygon(ix, iy),
            'name': ', '.join(x for x in (via if nv >= MIN_EVENTOS else regiao, mun) if x) or 'Área com roubo de carga',
            'kind': nivel,
            'props': {
                'cell': f'{GRID_M}m:{ix}:{iy}', 'municipio': mun, 'regiao': regiao, 'via': via if nv >= MIN_EVENTOS else None,
                'total': c['total'], 'roubo': c['roubo'], 'furto': c['furto'],
                'periodo': per, 'sem_hora': c['per'].get('sem_hora', 0), 'pico': pico,
                'local': {k: c['local'].get(k, 0) for k in ('via_publica', 'rodovia', 'acostamento', 'posto', 'outro')},
                'fim_de_semana': c['fds'], 'nivel': nivel, 'anos': anos, 'periodo_dados': periodo,
            },
            'valid_from': None, 'valid_to': None,
        })
    # conferência com o total oficial do ano corrente
    of = _oficial(anos[-1])
    conf = f'ROUBO DE CARGA {anos[-1]}: microdados {roubo_ano[anos[-1]]} x oficial {of}' if of is not None else 'sem conferência oficial'
    tot = sum(faixa_estado.values()) or 1
    dist = ', '.join(f'{k} {faixa_estado.get(k, 0) * 100 / tot:.0f}%' for k in (*FAIXAS, 'sem_hora'))
    k = Counter(f['kind'] for f in out)
    global NOTES
    NOTES = (f'{NOTES} Anos {anos} (ocorrências de {periodo["de"]} a {periodo["ate"]}). {dict(stats)}. {conf}. '
             f'Faixas no estado: {dist}. {len(out)} células publicadas (muito_alto={k.get("muito_alto", 0)}, '
             f'alto={k.get("alto", 0)}, moderado={k.get("moderado", 0)}).')
    print('   ', NOTES)
    return out
