"""Sinistros em rodovias ESTADUAIS de Santa Catarina: boletins de ocorrência da PMRv (Polícia Militar Rodoviária) no GeoSIE da
Secretaria de Infraestrutura de SC (geo.sie.sc.gov.br/api/geo_acidente.php), com coordenada.

Limites da fonte (por isso este módulo NÃO publica "acidentes com caminhão"):
  - a fonte NÃO traz tipo de veículo nem flag de caminhão (só o nº de veículos envolvidos). As células saem com
    props.escopo = 'todos_veiculos' (todos os sinistros da célula, de qualquer veículo) e caminhao = 0; a API e o mapa dizem
    isso ao usuário (api/src/layers/acidentes.layer.ts);
  - o endpoint devolve só o ANO CORRENTE (NUANO=2026; o parâmetro de ano é ignorado). Cada carga soma o que veio a um acervo
    local (data/cache/geosie_sc/acervo.jsonl.gz, chave NUANO+NUBOLETIM+CDPOSTORODOV), então o histórico cresce a cada
    execução; a janela de 3 anos da camada só enche com o tempo (em 18/10/2026 só há 2026, ~9,5 meses);
  - gravidade (CDGRAVIDADE, mapa inferido pelos totais, NÃO documentado pela fonte): 1 = com morte, 2 = com feridos, 3 = sem vítima;
  - licença NÃO declarada pelo GeoSIE (dado público de órgão estadual, acessível sem cadastro). Publicamos só o agregado por
    célula de 250 m com no mínimo MIN_SINISTROS sinistros; nenhum registro individual sai do importador. Registrar o pedido de
    confirmação de uso (LAI à SIE/SC) como pendência: ver docs/layers/acidentes.md.

Divisão por jurisdição: BR (SGRODOVIA 'BR...') fica com a PRF; sinistro em rodovia numa célula (±1) onde a PRF tem acidentes
também fica com a PRF (acidentes_prf.covered_cells), como no Infosiga e no REDS-MG.
"""
from __future__ import annotations
import datetime as dt, gzip, json, re
from collections import Counter
from common import CACHE_DIR, UA, http_get
from sources.acidentes_infosiga import FAIXAS, GRID_M, NIVEL_ALTO, NIVEL_MUITO_ALTO, PESO_SEM_VITIMA, cell_of, in_bbox, intval, janela, num

LAYER_ID = 'acidentes'
SOURCE = 'geosie-sc'
SOURCE_URL = 'https://geo.sie.sc.gov.br/api/geo_acidente.php'
# mesma redação de meta.sources em api/src/layers/acidentes.layer.ts e de docs/layers/acidentes.md
LICENSE = ('GeoSIE/SIE-SC (boletins da PMRv em rodovias estaduais) — licença NÃO declarada pela fonte; dado público de órgão '
           'estadual de acesso aberto (Lei federal 12.527/2011 e Lei 14.129/2021), publicado só agregado em células de 250 m '
           '(mínimo de 5 sinistros), sem registro individual; atribuir SIE-SC/PMRv; confirmar uso comercial por pedido de acesso à informação')
NOTES = ('Grade 250 m (EPSG:5880), mínimo de 5 sinistros por célula, TODOS os veículos (a fonte não informa o tipo de veículo). '
         'Só o ano corrente é publicado pela fonte: o acervo local acumula. BRs ficam com a PRF.')
SC_BBOX = (-53.9, -29.5, -48.2, -25.8)
MIN_SINISTROS = 5
ACERVO = CACHE_DIR / 'geosie_sc' / 'acervo.jsonl.gz'
RE_SC = re.compile(r'^SC\s*0*(\d{1,3})$')


def _baixa() -> list[dict]:
    raw = json.loads(http_get(SOURCE_URL, cache='geosie_sc/geo_acidente.json', max_age_h=12, timeout=180))
    out = []
    for f in raw.get('features', []):
        p = f.get('properties') or {}
        lon, lat = (f.get('geometry') or {}).get('coordinates') or (None, None)
        lon, lat = num(lon), num(lat)
        try:
            d = dt.datetime.strptime(p.get('DTACIDENTE', ''), '%d/%m/%Y').date()
        except ValueError:
            continue
        if not in_bbox(lon, lat, SC_BBOX):
            continue
        out.append({'k': f"{p.get('NUANO')}-{p.get('NUBOLETIM')}-{p.get('CDPOSTORODOV')}", 'd': d.isoformat(), 'lon': lon, 'lat': lat,
                    'rod': (p.get('SGRODOVIA') or '').strip().upper(), 'mun': (p.get('NMMUNICIPIO') or '').strip() or None,
                    'ob': intval(p.get('QTVITIMAFATAL')), 'fe': intval(p.get('QTFERIDO')), 'g': intval(p.get('CDGRAVIDADE'))})
    return out


def acervo() -> list[dict]:
    """Acervo local (todas as cargas anteriores) + o que a fonte devolve hoje, sem duplicar a chave do boletim."""
    store: dict[str, dict] = {}
    if ACERVO.exists():
        with gzip.open(ACERVO, 'rt', encoding='utf-8') as fh:
            for l in fh:
                r = json.loads(l)
                store[r['k']] = r
    novos = _baixa()
    for r in novos:
        store[r['k']] = r
    print(f'    GeoSIE: {len(novos)} boletins hoje; acervo com {len(store)}')
    ACERVO.parent.mkdir(parents=True, exist_ok=True)
    tmp = ACERVO.with_suffix('.tmp')
    with gzip.open(tmp, 'wt', encoding='utf-8') as fh:
        for r in store.values():
            fh.write(json.dumps(r, ensure_ascii=False) + '\n')
    tmp.replace(ACERVO)
    return list(store.values())


def build(evs: list[dict], covered: set[tuple[int, int]], today: dt.date | None = None) -> tuple[list[dict], dt.date, dt.date, Counter]:
    """Células de 250 m com >= MIN_SINISTROS sinistros (todos os veículos), na janela de 3 anos."""
    if not evs:
        return [], dt.date.today(), dt.date.today(), Counter()
    today = today or dt.date.today()
    start, end = janela(min(max(dt.date.fromisoformat(e['d']) for e in evs), today))
    skipped: Counter = Counter()
    cells: dict[tuple[int, int], dict] = {}
    # a fonte só publica o ano corrente: o período real dos dados (e não a janela nominal de 3 anos) vai na célula
    datas = [dt.date.fromisoformat(e['d']) for e in evs if start <= dt.date.fromisoformat(e['d']) <= end]
    real_de, real_ate = (min(datas), max(datas)) if datas else (start, end)
    real_de = real_de.replace(day=1)                                   # só mês e ano: nenhuma data de boletim sai daqui
    real_ate = (real_ate.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(days=1)
    for e in evs:
        d = dt.date.fromisoformat(e['d'])
        if not (start <= d <= end):
            continue
        if e['rod'].startswith('BR'):
            skipped['federal_prf'] += 1
            continue
        key = cell_of(e['lon'], e['lat'])
        if key in covered:
            skipped['coberta_prf'] += 1
            continue
        c = cells.setdefault(key, {'n': 0, 'fatal': 0, 'obitos': 0, 'vitima': 0, 'sx': 0.0, 'sy': 0.0, 'rod': Counter(), 'mun': Counter()})
        c['n'] += 1
        c['sx'] += e['lon']
        c['sy'] += e['lat']
        c['obitos'] += e['ob']
        fatal = e['ob'] > 0 or e['g'] == 1
        c['fatal'] += fatal
        c['vitima'] += fatal or e['fe'] > 0 or e['g'] == 2
        m = RE_SC.match(e['rod'])
        if m:
            c['rod'][f'SC-{int(m.group(1)):03d}'] += 1
        if e['mun']:
            c['mun'][e['mun']] += 1
    out = []
    for (ix, iy), c in cells.items():
        n = c['n']
        if n < MIN_SINISTROS:
            continue
        via, vn = (c['rod'].most_common(1) or [(None, 0)])[0]
        via = via if vn >= 2 else None
        mun = (c['mun'].most_common(1) or [(None, 0)])[0][0]
        score = round(c['vitima'] + 2 * c['fatal'] + PESO_SEM_VITIMA * (n - c['vitima']), 1)
        nivel = 'muito_alto' if score >= NIVEL_MUITO_ALTO else 'alto' if score >= NIVEL_ALTO else 'moderado'
        cell = f'{GRID_M}m:{ix}:{iy}'
        out.append({
            'source_id': f'{SOURCE}:{cell}',
            'geometry': {'type': 'Point', 'coordinates': [round(c['sx'] / n, 5), round(c['sy'] / n, 5)]},
            'name': via or (f'Ponto crítico em {mun}' if mun else 'Ponto crítico de sinistros'),
            'kind': nivel,
            'props': {
                'cell': cell, 'fonte': 'SIE-SC/PMRv (GeoSIE)', 'via': via, 'municipio': mun, 'escopo': 'todos_veiculos',
                'total': n, 'fatais': c['fatal'], 'vitima': c['vitima'],
                'caminhao': 0, 'caminhao_vitima': 0, 'caminhao_fatais': 0, 'obitos': c['obitos'],
                'periodo': {k: 0 for k in FAIXAS}, 'sem_hora': n, 'pico': None,
                'score': score, 'nivel': nivel,
                'janela': {'de': real_de.isoformat(), 'ate': real_ate.isoformat()},
            },
            'valid_from': None, 'valid_to': None,
        })
    return out, start, end, skipped


def fetch():
    from sources import acidentes_prf
    evs = acervo()
    covered = acidentes_prf.covered_cells(SC_BBOX)
    print(f'    {len(covered)} células cobertas pela PRF em SC')
    feats, start, end, skipped = build(evs, covered)
    global NOTES
    k = Counter(f['kind'] for f in feats)
    NOTES = (f'{NOTES} Janela {start}..{end}; {len(evs)} boletins no acervo; {len(feats)} células publicadas '
             f'(muito_alto={k.get("muito_alto", 0)}, alto={k.get("alto", 0)}, moderado={k.get("moderado", 0)}). Descartados: {dict(skipped)}.')
    print('   ', NOTES)
    return feats
