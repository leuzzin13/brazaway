"""Acidentes com caminhão: Infosiga SP (Detran-SP). Sinistros com vítima e notificações em vias municipais e em
rodovias estaduais NÃO concedidas (DER) do estado de SP, agregados em pontos críticos numa grade de 250 m.
Nunca grava registro individual: só células com pelo menos MIN_CAMINHAO sinistros com caminhão na janela de 3 anos.

Divisão por jurisdição (para não contar o mesmo acidente duas vezes entre as fontes da camada 'acidentes'):
  - rodovias estaduais concedidas  -> ARTESP (acidentes_artesp), que inclui também acidentes sem vítima;
  - rodovias federais (BR)         -> PRF (acidentes_prf);
  - demais vias (municipais, DER)  -> Infosiga (este módulo).
O casamento por tempo/distância entre fontes foi testado e descartado (ver docs/layers/acidentes.md).

Este módulo também guarda os utilitários comuns das fontes de acidentes (grade métrica, faixa do dia, agregação,
classificação e download em streaming); acidentes_artesp e acidentes_prf importam daqui.
"""
from __future__ import annotations
import csv, datetime as dt, io, math, re, time, unicodedata, zipfile
from collections import Counter
from common import CACHE_DIR, UA

LAYER_ID = 'acidentes'
SOURCE = 'infosiga'
SOURCE_URL = 'https://infosiga.detran.sp.gov.br/painel/download/file/dados_infosiga.zip'
LICENSE = ('Dados abertos Detran-SP/Infosiga — sem licença nomeada; uso, reuso e redistribuição livres com atribuição '
           'e manutenção dos mesmos termos de abertura (Guia de Referência do Infosiga). Citar: DEPARTAMENTO ESTADUAL DE '
           'TRÂNSITO DE SÃO PAULO (Detran-SP). Infosiga: Dados abertos.')
NOTES = ('Grade 250 m (EPSG:5880), janela de 3 anos, mínimo de 3 sinistros com caminhão por célula. Só sinistros com '
         'vítima e notificações (sem colisão só com dano material). Exclui rodovias concedidas (ARTESP) e federais (PRF).')

# ----------------------------------------------------------------------------------------------------------------
# Utilitários comuns das fontes de acidentes
# ----------------------------------------------------------------------------------------------------------------
GRID_M = 250            # lado da célula (m), projeção SIRGAS 2000 / Brazil Polyconic
MIN_CAMINHAO = 3        # mínimo de acidentes com caminhão na célula para publicar (nunca dado individual)
JANELA_ANOS = 3
FAIXAS = ('madrugada', 'manha', 'tarde', 'noite')   # 00–05h59, 06–11h59, 12–17h59, 18–23h59 (mesmos turnos do Infosiga)
# nível do ponto crítico (3 anos): score = acidentes com caminhão COM VÍTIMA + 2 x com morte + 0,2 x sem vítima.
# Os sem vítima pesam pouco porque só ARTESP e PRF os publicam (o Infosiga não): assim o nível fica comparável entre
# vias urbanas e rodovias. Limiares calibrados na carga de 10/2026 (ver docs/layers/acidentes.md).
NIVEL_MUITO_ALTO = 15
NIVEL_ALTO = 8
PESO_SEM_VITIMA = 0.2   # acidente com caminhão sem vítima (só ARTESP/PRF publicam) conta 1/5

_tr = None


def _transformer():
    global _tr
    if _tr is None:
        from pyproj import Transformer
        _tr = Transformer.from_crs('EPSG:4326', 'EPSG:5880', always_xy=True)
    return _tr


def cell_of(lon: float, lat: float, size: int = GRID_M) -> tuple[int, int]:
    x, y = _transformer().transform(lon, lat)
    return int(math.floor(x / size)), int(math.floor(y / size))


def faixa(hour: int | None) -> str | None:
    if hour is None or not (0 <= hour <= 23):
        return None
    return FAIXAS[hour // 6]


def parse_hour(v) -> int | None:
    m = re.match(r'\s*(\d{1,2}):', str(v or ''))
    if not m:
        return None
    h = int(m.group(1))
    return h if 0 <= h <= 23 else None


def num(v) -> float | None:
    if v is None:
        return None
    s = str(v).strip().replace(',', '.')
    if not s or s.upper() in ('NA', 'NAN', 'NULL', 'NONE'):
        return None
    try:
        x = float(s)
    except ValueError:
        return None
    return x if math.isfinite(x) else None


def intval(v) -> int:
    x = num(v)
    return int(x) if x is not None else 0


def norm_txt(s: str | None) -> str:
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode().upper()
    return ' '.join(s.replace('-', ' ').split())


_MINUSC = {'De', 'Da', 'Do', 'Das', 'Dos', 'E', 'Del'}
# nomes de uso corrente das principais rodovias (só os inequívocos; as demais ficam só com o código)
NOMES_RODOVIA = {
    'SP-021': 'Rodoanel', 'SP-330': 'Anhanguera', 'SP-348': 'Bandeirantes', 'SP-280': 'Castello Branco',
    'SP-270': 'Raposo Tavares', 'SP-070': 'Ayrton Senna/Carvalho Pinto', 'SP-150': 'Anchieta', 'SP-160': 'Imigrantes',
    'SP-310': 'Washington Luís', 'SP-300': 'Marechal Rondon', 'SP-065': 'Dom Pedro I', 'SP-075': 'Santos Dumont',
    'SP-099': 'Tamoios',
}


def rotulo_rodovia(cod: str, uf: str | None = 'SP', km: float | None = None) -> str:
    """'SP-021' -> 'Rodoanel (SP-021)'; BR-116/SP até o km 235 = Dutra, a partir do 265 = Régis Bittencourt."""
    base = cod.split('/')[0].split(' ')[0]
    nome = NOMES_RODOVIA.get(base) if (uf or 'SP') == 'SP' else None
    if base == 'BR-381' and uf == 'SP':
        nome = 'Fernão Dias'
    if base == 'BR-116' and uf == 'SP' and km is not None:
        nome = 'Dutra' if km <= 235 else 'Régis Bittencourt' if km >= 265 else None
    return f'{nome} ({cod})' if nome else cod


def nome_via(s: str | None) -> str | None:
    """'SP 055' -> 'SP-055'; 'AVENIDA MARGINAL DO RIO TIETE' -> 'Avenida Marginal do Rio Tiete'."""
    s = ' '.join(str(s or '').split())
    if not s or s.upper().startswith('VEDA'):
        return None
    m = re.match(r'^(SP[AIM]?|BR)\s*-?\s*0*(\d{1,3})(.*)$', s, re.I)
    if m:
        cod, rest = f'{m.group(1).upper()}-{int(m.group(2)):03d}', m.group(3)
        if cod == 'SP-015':                       # Infosiga: "SP 015 - TIETE" / "SP 015 - PINHEIROS"
            r = norm_txt(rest)
            if 'TIETE' in r:
                return 'Marginal Tietê'
            if 'PINHEIROS' in r:
                return 'Marginal Pinheiros'
        if len(norm_txt(rest).strip(' -')) >= 4 and norm_txt(rest).strip(' -') in norm_txt(rotulo_rodovia(cod)):
            return rotulo_rodovia(cod)
        if not rest.strip() or len(rest) <= 4 or rest.startswith('/'):
            return rotulo_rodovia(f'{cod}{rest.upper().strip()}')
        return f'{rotulo_rodovia(cod)}{rest.title()}'.strip()
    return ' '.join(w if i == 0 or w not in _MINUSC else w.lower() for i, w in enumerate(s.title().split()))


IBGE_MUNICIPIOS = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado'
_mun: dict[tuple[str, str], str] | None = None


def _mun_key(s: str) -> str:
    return re.sub(r'[^A-Z0-9]', '', norm_txt(s))


def _municipios() -> dict[tuple[str, str], str]:
    """(UF, nome normalizado) -> nome oficial com acentos (API de localidades do IBGE, cache de 90 dias)."""
    global _mun
    if _mun is None:
        _mun = {}
        try:
            import json
            from common import http_get
            for m in json.loads(http_get(IBGE_MUNICIPIOS, cache='ibge/municipios.json', max_age_h=24 * 90, timeout=60)):
                _mun[(m['UF-sigla'], _mun_key(m['municipio-nome']))] = m['municipio-nome']
        except Exception as e:   # nomes ficam sem acento, mas a importação segue
            print(f'  ! lista de municípios do IBGE indisponível ({e})')
    return _mun


def titulo(s: str | None, uf: str | None = 'SP') -> str | None:
    """Nome do município como o IBGE grafa ('SAO PAULO', 'S.Paulo' -> 'São Paulo'); senão, só capitaliza."""
    if not s or not str(s).strip():
        return None
    s = ' '.join(str(s).split())
    mun = _municipios()
    uf = (uf or 'SP').strip().upper()
    cands = [s]
    m = re.match(r'^S\.\s*(.+)$', s, re.I)        # abreviações da SSP: S.Paulo, S.Andre, S.Isabel...
    if m:
        cands = [f'{p} {m.group(1)}' for p in ('Sao', 'Santo', 'Santa')]
    for c in cands:
        hit = mun.get((uf, _mun_key(c)))
        if hit:
            return hit
    return nome_via(s)


def download(url: str, cache: str, max_age_h: float = 24 * 7, timeout: int = 600, **kw) -> 'pathlib.Path':
    """GET em streaming direto para data/cache (arquivos de centenas de MB não passam pela memória)."""
    import pathlib, requests
    p: pathlib.Path = CACHE_DIR / cache
    if p.exists() and p.stat().st_size > 0 and (time.time() - p.stat().st_mtime) < max_age_h * 3600:
        return p
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + '.part')
    for attempt in range(3):
        try:
            with requests.get(url, headers={**UA, **kw.pop('headers', {})}, timeout=timeout, stream=True, **kw) as r:
                r.raise_for_status()
                with open(tmp, 'wb') as fh:
                    for chunk in r.iter_content(1 << 20):
                        fh.write(chunk)
            tmp.replace(p)
            return p
        except Exception:
            if attempt == 2:
                if p.exists():
                    print(f'  ! falhou, usando cache antigo: {cache}')
                    return p
                raise
            time.sleep(5 * (attempt + 1))
    return p


def janela(max_date: dt.date) -> tuple[dt.date, dt.date]:
    """Janela de JANELA_ANOS anos terminando no último dia do mês da data mais recente da fonte."""
    end = (max_date.replace(day=28) + dt.timedelta(days=4))
    end = end - dt.timedelta(days=end.day)
    try:
        start = end.replace(year=end.year - JANELA_ANOS) + dt.timedelta(days=1)
    except ValueError:   # 29/02
        start = end.replace(year=end.year - JANELA_ANOS, day=28) + dt.timedelta(days=1)
    return start, end


class Hotspots:
    """Acumula eventos (já filtrados pela janela) por célula de GRID_M metros. Nada individual sai daqui."""

    def __init__(self):
        self.cells: dict[tuple[int, int], dict] = {}
        self.n_events = 0
        self.n_truck = 0

    def add(self, lon: float, lat: float, *, truck: bool, fatal: bool, vitima: bool, obitos: int = 0, moto: bool = False,
            pedestre: bool = False, hour: int | None = None, via: str | None = None, municipio: str | None = None) -> None:
        key = cell_of(lon, lat)
        c = self.cells.get(key)
        if c is None:
            c = self.cells[key] = {'total': 0, 'fatais': 0, 'caminhao': 0, 'caminhao_vitima': 0, 'caminhao_fatais': 0, 'obitos': 0, 'moto': 0,
                                   'pedestre': 0, 'per': Counter(), 'sx': 0.0, 'sy': 0.0, 'vias': Counter(), 'mun': Counter()}
        self.n_events += 1
        c['total'] += 1
        if fatal:
            c['fatais'] += 1
        if not truck:
            return
        self.n_truck += 1
        c['caminhao'] += 1
        c['sx'] += lon
        c['sy'] += lat
        if fatal:
            c['caminhao_fatais'] += 1
        if vitima or fatal:
            c['caminhao_vitima'] += 1
        c['obitos'] += max(0, int(obitos or 0))
        if moto:
            c['moto'] += 1
        if pedestre:
            c['pedestre'] += 1
        f = faixa(hour)
        c['per'][f or 'sem_hora'] += 1
        if via:
            c['vias'][via] += 1
        if municipio:
            c['mun'][municipio] += 1

    def features(self, source: str, start: dt.date, end: dt.date, fonte_label: str) -> list[dict]:
        out = []
        for (ix, iy), c in self.cells.items():
            n = c['caminhao']
            if n < MIN_CAMINHAO:
                continue
            via, vn = (c['vias'].most_common(1) or [(None, 0)])[0]
            if vn < 2:          # nome de via só quando sustentado por pelo menos 2 eventos
                via = None
            mun = (c['mun'].most_common(1) or [(None, 0)])[0][0]
            per = {k: c['per'].get(k, 0) for k in FAIXAS}
            pico = max(FAIXAS, key=lambda k: per[k]) if any(per.values()) else None
            score = round(c['caminhao_vitima'] + 2 * c['caminhao_fatais'] + PESO_SEM_VITIMA * (n - c['caminhao_vitima']), 1)
            nivel = 'muito_alto' if score >= NIVEL_MUITO_ALTO else 'alto' if score >= NIVEL_ALTO else 'moderado'
            cell = f'{GRID_M}m:{ix}:{iy}'
            name = via or (f'Ponto crítico em {mun}' if mun else 'Ponto crítico de acidentes')
            out.append({
                'source_id': f'{source}:{cell}',
                'geometry': {'type': 'Point', 'coordinates': [round(c['sx'] / n, 5), round(c['sy'] / n, 5)]},
                'name': name,
                'kind': nivel,
                'props': {
                    'cell': cell, 'fonte': fonte_label, 'via': via, 'municipio': mun,
                    'total': c['total'], 'fatais': c['fatais'],
                    'caminhao': n, 'caminhao_vitima': c['caminhao_vitima'], 'caminhao_fatais': c['caminhao_fatais'], 'obitos': c['obitos'],
                    'caminhao_moto': c['moto'], 'caminhao_pedestre': c['pedestre'],
                    'periodo': per, 'sem_hora': c['per'].get('sem_hora', 0), 'pico': pico,
                    'score': score, 'nivel': nivel,
                    'janela': {'de': start.isoformat(), 'ate': end.isoformat()},
                },
                'valid_from': None, 'valid_to': None,
            })
        return out

    def summary(self, feats: list[dict]) -> str:
        k = Counter(f['kind'] for f in feats)
        return (f'{self.n_events} acidentes na janela ({self.n_truck} com caminhão); {len(feats)} células publicadas '
                f'(muito_alto={k.get("muito_alto", 0)}, alto={k.get("alto", 0)}, moderado={k.get("moderado", 0)})')


def dilate(cells: set[tuple[int, int]], k: int = 1) -> set[tuple[int, int]]:
    return {(x + dx, y + dy) for (x, y) in cells for dx in range(-k, k + 1) for dy in range(-k, k + 1)}


SP_BBOX = (-53.2, -25.4, -44.1, -19.7)   # estado de SP (com folga)


def in_bbox(lon, lat, bbox=SP_BBOX) -> bool:
    return lon is not None and lat is not None and bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]


# ----------------------------------------------------------------------------------------------------------------
# Infosiga
# ----------------------------------------------------------------------------------------------------------------
# rodovias concedidas (ARTESP) e federais (PRF) vêm de outras fontes da mesma camada
EXCLUI_ADMIN = {'CONCESSIONARIA', 'ARTESP', 'DNIT'}
EXCLUI_CIRC = {'FEDERAL'}
RE_RODOVIA = re.compile(r'^(SP[AIM]?|BR)\s*-?\s*\d', re.I)
# Marginais Tietê e Pinheiros ("SP 015 - TIETE"/"SP 015 - PINHEIROS"): código estadual, mas operadas pela Prefeitura/CET;
# nem ARTESP nem PRF registram acidentes nelas, então ficam sempre com o Infosiga
RE_MARGINAIS = re.compile(r'^SP\s*-?\s*0*15\b', re.I)


def _rodovia(row: dict) -> bool:
    """Sinistro em rodovia de ARTESP/PRF (ou com indício disso). O campo administracao do Infosiga marca muitas rodovias
    concedidas como 'DER' (ex.: Anhanguera, Imigrantes, Rodoanel em 2022-2024), então ele sozinho não separa as malhas.
    Exceções (nunca rodovia): as Marginais (SP-015) e vias da Prefeitura de circunscrição municipal sem código de rodovia
    no logradouro (ex.: 'AVENIDA MARGINAL ...' com tipo de via 'ESTRADAS E RODOVIAS')."""
    logr = (row.get('logradouro') or '').strip()
    if RE_MARGINAIS.match(logr):
        return False
    adm, circ = norm_txt(row.get('administracao')), norm_txt(row.get('circunscricao'))
    codigo = bool(RE_RODOVIA.match(logr))
    if adm == 'PREFEITURA' and circ == 'MUNICIPAL' and not codigo:
        return False
    return adm != 'PREFEITURA' or circ in ('ESTADUAL', 'FEDERAL') or norm_txt(row.get('tipo_via')) == 'ESTRADAS E RODOVIAS' or codigo


def _sinistros_files(z: zipfile.ZipFile, start: dt.date, end: dt.date) -> list[str]:
    out = []
    for n in z.namelist():
        m = re.search(r'sinistros_(\d{4})-(\d{4})\.csv$', n)
        if m and int(m.group(2)) >= start.year and int(m.group(1)) <= end.year:
            out.append(n)
    return sorted(out)


def _max_date(z: zipfile.ZipFile) -> dt.date:
    """Data mais recente: lê o arquivo de sinistros mais novo (só a coluna de data)."""
    names = sorted((n for n in z.namelist() if re.search(r'sinistros_\d{4}-\d{4}\.csv$', n)),
                   key=lambda n: re.search(r'(\d{4})\.csv$', n).group(1))
    best = dt.date(2000, 1, 1)
    with z.open(names[-1]) as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding='latin1'), delimiter=';'):
            try:
                d = dt.datetime.strptime(row['data_sinistro'], '%d/%m/%Y').date()
            except (ValueError, TypeError):
                continue
            if d > best:
                best = d
    return best


def fetch():
    path = download(SOURCE_URL, 'infosiga/dados_infosiga.zip', max_age_h=24 * 7)
    z = zipfile.ZipFile(path)
    start, end = janela(min(_max_date(z), dt.date.today()))
    print(f'    janela {start}..{end}')
    # malha coberta por ARTESP (concessões estaduais) e PRF (BRs): sinistros de rodovia ali vêm dessas fontes
    from sources import acidentes_artesp, acidentes_prf
    covered = acidentes_artesp.covered_cells() | acidentes_prf.covered_cells()
    print(f'    {len(covered)} células cobertas por ARTESP/PRF')
    hs = Hotspots()
    skipped = Counter()
    for name in _sinistros_files(z, start, end):
        with z.open(name) as fh:
            for row in csv.DictReader(io.TextIOWrapper(fh, encoding='latin1'), delimiter=';'):
                try:
                    d = dt.datetime.strptime(row['data_sinistro'], '%d/%m/%Y').date()
                except (ValueError, TypeError):
                    skipped['data'] += 1
                    continue
                if not (start <= d <= end):
                    continue
                if norm_txt(row.get('administracao')) in EXCLUI_ADMIN or norm_txt(row.get('circunscricao')) in EXCLUI_CIRC:
                    skipped['outra_fonte'] += 1
                    continue
                lat, lon = num(row.get('latitude')), num(row.get('longitude'))
                if not in_bbox(lon, lat):
                    skipped['sem_coord'] += 1
                    continue
                if _rodovia(row) and cell_of(lon, lat) in covered:
                    skipped['rodovia_coberta'] += 1
                    continue
                hour = parse_hour(row.get('hora_sinistro'))
                if hour is None:   # usa o turno do próprio Infosiga (mesmas faixas)
                    t = norm_txt(row.get('turno'))
                    hour = {'MADRUGADA': 0, 'MANHA': 6, 'TARDE': 12, 'NOITE': 18}.get(t)
                obitos = intval(row.get('qtd_gravidade_fatal'))
                tipo = norm_txt(row.get('tipo_registro'))
                fatal = tipo == 'SINISTRO FATAL' or obitos > 0
                feridos = intval(row.get('qtd_gravidade_grave')) + intval(row.get('qtd_gravidade_leve'))
                vitima = tipo in ('SINISTRO FATAL', 'SINISTRO NAO FATAL') or obitos + feridos > 0
                via = nome_via(row.get('logradouro'))
                hs.add(lon, lat, truck=intval(row.get('qtd_caminhao')) > 0, fatal=fatal, vitima=vitima, obitos=obitos,
                       moto=intval(row.get('qtd_motocicleta')) > 0,
                       pedestre=intval(row.get('qtd_pedestre')) > 0 or norm_txt(row.get('tp_sinistro_atrop_pedestre')) == 'S',
                       hour=hour, via=via, municipio=titulo(row.get('municipio')))
    feats = hs.features(SOURCE, start, end, 'Infosiga SP (Detran-SP)')
    global NOTES
    NOTES = f'{NOTES} Janela {start}..{end}. {hs.summary(feats)}. Descartados: {dict(skipped)}.'
    print('   ', hs.summary(feats), dict(skipped))
    return feats
