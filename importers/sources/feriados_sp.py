"""Feriados que suspendem as restrições de São Paulo (ZMRC, rodízio e produtos perigosos: todas valem "exceto feriados").

Nacionais, estadual (SP) e municipais (São Paulo capital), CALCULADOS a partir das leis — não da BrasilAPI:
a BrasilAPI marca Carnaval, Sexta-feira Santa e Corpus Christi como "national", mas Carnaval não é feriado legal
(é ponto facultativo; a CET mantém a ZMRC no Carnaval) e Sexta-feira Santa/Corpus Christi são feriados MUNICIPAIS
em São Paulo (Lei municipal 14.485/2007 art. 10, com base na Lei federal 9.093/1995 art. 2º). A BrasilAPI é usada
só para conferência (divergências viram aviso em NOTES).

Este importador NÃO usa data_features (feriado não tem geometria): grava direto na tabela `holidays` e regenera
db/seed/0004_holidays.sql. Expõe LAYER_ID/SOURCE/... para o runner registrar a carga em data_layer_runs;
fetch() devolve lista vazia. Rode com --no-seed para o runner não gerar db/seed/layers/core_legal__feriados-sp.sql.

  docker run ... truck-router-importer feriados_sp --no-seed          # anos: FERIADOS_ANOS (default: ano atual até +2)
  python3 importers/sources/feriados_sp.py --seed-only 2026 2028      # só regenera o seed, sem banco (stdlib)
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import sys

LAYER_ID = 'core_legal'
SOURCE = 'feriados-sp'
SOURCE_URL = ('https://www.planalto.gov.br/ccivil_03/leis/l0662.htm ; https://www.planalto.gov.br/ccivil_03/leis/l6802.htm ; '
              'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm ; '
              'https://www.al.sp.gov.br/repositorio/legislacao/lei/1997/lei-9497-05.03.1997.html ; '
              'https://saopaulo.sp.leg.br/iah/fulltext/leis/L14485.pdf')
LICENSE = 'Atos oficiais: domínio público (Lei 9.610/1998 art. 8º IV). Conferência: BrasilAPI (MIT).'
NOTES = None

IBGE_SP = '3550308'
BRASILAPI = 'https://brasilapi.com.br/api/feriados/v1/{year}'

L662 = 'Lei 662/1949 art. 1º (red. Lei 10.607/2002)'
NATIONAL_FIXED = [
    ((1, 1), 'Confraternização Universal', L662),
    ((4, 21), 'Tiradentes', L662),
    ((5, 1), 'Dia do Trabalho', L662),
    ((9, 7), 'Independência do Brasil', L662),
    ((10, 12), 'Nossa Senhora Aparecida', 'Lei 6.802/1980 art. 1º'),
    ((11, 2), 'Finados', L662 + '; também Lei municipal SP 14.485/2007 art. 10'),
    ((11, 15), 'Proclamação da República', L662),
    ((11, 20), 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei 14.759/2023 art. 1º; também Lei municipal SP 14.485/2007 arts. 9º e 10'),
    ((12, 25), 'Natal', L662),
]
STATE_SP = [((7, 9), 'Revolução Constitucionalista de 1932 (data magna de SP)', 'Lei estadual SP 9.497/1997 art. 1º; Lei federal 9.093/1995 art. 1º II')]
MUNICIPAL_SP_FIXED = [((1, 25), 'Aniversário da cidade de São Paulo', 'Lei municipal SP 14.485/2007 art. 10')]
L14485_REL = 'Lei municipal SP 14.485/2007 art. 10; Lei federal 9.093/1995 art. 2º'


def easter(year: int) -> dt.date:
    """Domingo de Páscoa (algoritmo gregoriano anônimo / Meeus-Jones-Butcher)."""
    a = year % 19; b = year // 100; c = year % 100
    d = b // 4; e = b % 4; f = (b + 8) // 25; g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4; k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


def holidays_for(year: int) -> list[dict]:
    out = []
    for (mth, d), name, basis in NATIONAL_FIXED:
        out.append({'day': dt.date(year, mth, d), 'scope': 'national', 'uf': None, 'ibge_code': None, 'name': name, 'legal_basis': basis})
    for (mth, d), name, basis in STATE_SP:
        out.append({'day': dt.date(year, mth, d), 'scope': 'state', 'uf': 'SP', 'ibge_code': None, 'name': name, 'legal_basis': basis})
    for (mth, d), name, basis in MUNICIPAL_SP_FIXED:
        out.append({'day': dt.date(year, mth, d), 'scope': 'municipal', 'uf': 'SP', 'ibge_code': IBGE_SP, 'name': name, 'legal_basis': basis})
    e = easter(year)
    out.append({'day': e - dt.timedelta(days=2), 'scope': 'municipal', 'uf': 'SP', 'ibge_code': IBGE_SP,
                'name': 'Sexta-feira da Paixão', 'legal_basis': L14485_REL})
    out.append({'day': e + dt.timedelta(days=60), 'scope': 'municipal', 'uf': 'SP', 'ibge_code': IBGE_SP,
                'name': 'Corpus Christi', 'legal_basis': L14485_REL})
    return sorted(out, key=lambda h: (h['day'], h['scope']))


def check_brasilapi(years: list[int], rows: list[dict]) -> list[str]:
    """Confere com a BrasilAPI. Diferenças esperadas (Carnaval, Páscoa) não geram aviso."""
    from common import http_get  # import tardio: o modo --seed-only roda só com a stdlib
    ours = {h['day'].isoformat() for h in rows}
    notes = []
    for y in years:
        try:
            data = json.loads(http_get(BRASILAPI.format(year=y), cache=f'brasilapi_feriados_{y}.json', max_age_h=24 * 30, timeout=30))
        except Exception as e:  # noqa: BLE001 — fonte de conferência; nunca derruba a carga
            notes.append(f'BrasilAPI {y} indisponível ({type(e).__name__})')
            continue
        for h in data:
            if h.get('name', '').lower() in ('carnaval', 'páscoa'):
                continue
            if h['date'] not in ours:
                notes.append(f"BrasilAPI lista {h['date']} ({h['name']}) que não está na base legal")
    return notes


def seed_sql(rows: list[dict], years: list[int]) -> str:
    def s(v):
        return 'null' if v is None else "'" + str(v).replace("'", "''") + "'"
    lines = [
        '-- GERADO por importers/sources/feriados_sp.py. Não edite à mão.',
        f'-- Feriados {years[0]}–{years[-1]} que suspendem ZMRC, rodízio e restrição de produtos perigosos em São Paulo.',
        '-- Nacionais: Lei 662/1949 (red. Lei 10.607/2002), Lei 6.802/1980, Lei 14.759/2023. Estadual: Lei SP 9.497/1997.',
        '-- Municipais (São Paulo, IBGE 3550308): Lei municipal 14.485/2007 art. 10. Carnaval NÃO é feriado (ponto facultativo).',
        'insert into holidays (day, scope, uf, ibge_code, name, source, legal_basis) values',
    ]
    vals = [f"  ('{h['day'].isoformat()}', {s(h['scope'])}, {s(h['uf'])}, {s(h['ibge_code'])}, {s(h['name'])}, "
            f"'lei (calculado por importers/sources/feriados_sp.py)', {s(h['legal_basis'])})" for h in rows]
    lines.append(',\n'.join(vals))
    lines.append("on conflict (day, scope, coalesce(uf, ''), coalesce(ibge_code, '')) do update\n"
                 "  set name = excluded.name, source = excluded.source, legal_basis = excluded.legal_basis;")
    lines.append(
        "insert into data_layer_runs (layer_id, source, source_url, license, record_count, notes)\n"
        f"select 'core_legal', 'feriados-sp', {s(SOURCE_URL)}, {s(LICENSE)}, {len(rows)}, {s(f'seed {years[0]}-{years[-1]}')}\n"
        "where not exists (select 1 from data_layer_runs where layer_id = 'core_legal' and source = 'feriados-sp'"
        f" and notes = {s(f'seed {years[0]}-{years[-1]}')});")
    return '\n'.join(lines) + '\n'


def seed_path() -> pathlib.Path:
    env = os.environ.get('SEED_DIR')
    if env:
        return pathlib.Path(env).parent / '0004_holidays.sql'   # no container: /seed/layers -> /seed
    return pathlib.Path(__file__).resolve().parents[2] / 'db' / 'seed' / '0004_holidays.sql'


def years_from_env() -> list[int]:
    spec = os.environ.get('FERIADOS_ANOS')
    if spec:
        a, _, b = spec.partition('-')
        return list(range(int(a), int(b or a) + 1))
    y = dt.date.today().year
    return [y, y + 1, y + 2]


def write_db(rows: list[dict], years: list[int]) -> None:
    from common import _pg_conn
    with _pg_conn() as c, c.cursor() as cur:
        for h in rows:
            cur.execute(
                """insert into holidays (day, scope, uf, ibge_code, name, source, legal_basis)
                   values (%s, %s, %s, %s, %s, %s, %s)
                   on conflict (day, scope, coalesce(uf, ''), coalesce(ibge_code, '')) do update
                     set name = excluded.name, source = excluded.source, legal_basis = excluded.legal_basis""",
                (h['day'], h['scope'], h['uf'], h['ibge_code'], h['name'], 'lei (calculado por importers/sources/feriados_sp.py)', h['legal_basis']))


def fetch():
    """Chamado pelo runner: grava feriados + seed e devolve [] (nada vai para data_features)."""
    global NOTES
    years = years_from_env()
    rows = [h for y in years for h in holidays_for(y)]
    notes = check_brasilapi(years, rows)
    write_db(rows, years)
    p = seed_path()
    p.write_text(seed_sql(rows, years), encoding='utf-8')
    NOTES = f'{len(rows)} feriados {years[0]}-{years[-1]} gravados em holidays (seed {p.name}).' + (' ' + '; '.join(notes) if notes else '')
    print('   ', NOTES)
    return []


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    ys = list(range(int(args[0]), int(args[1]) + 1)) if len(args) == 2 else years_from_env()
    rows = [h for y in ys for h in holidays_for(y)]
    if '--seed-only' not in sys.argv:
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
        write_db(rows, ys)
    p = seed_path()
    p.write_text(seed_sql(rows, ys), encoding='utf-8')
    print(f'ok: {len(rows)} feriados {ys[0]}-{ys[-1]} -> {p}')
