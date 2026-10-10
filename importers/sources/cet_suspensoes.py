"""Suspensões do rodízio, da ZMRC e da ZMRF publicadas pela CET (São Paulo capital).

Fonte: https://webforms.cetsp.com.br/suspensaorodizio/Relatorio?year=AAAA (tabela HTML, um ano por página, desde 1997;
colunas DATA | LOCAL AFETADO | EVENTO | PERÍODO | OBSERVAÇÕES). Base legal da suspensão: Decreto 58.584/2018 art. 8º
(portaria do Secretário da SMT; §2º permite suspender só um período do dia).

Suspensão não tem geometria: este importador grava na tabela `rule_suspensions` (lida por api/src/services/calendar.ts),
não em data_features, e fetch() devolve lista vazia. O runner (importers/run.py) usa dois atributos do módulo:
  - RECORD_COUNT: número de suspensões lidas (vai para data_layer_runs.record_count no lugar de 0 feições);
  - SEED_SQL: conteúdo de db/seed/layers/core_legal__cet-suspensoes.sql (upsert em rule_suspensions, só linhas da CET),
    no lugar do seed genérico de data_features.

  docker run ... truck-router-importer cet_suspensoes               # grava no banco e regenera o seed
  docker run ... truck-router-importer cet_suspensoes --seed-only   # só o seed, não toca no banco
  docker run ... truck-router-importer cet_suspensoes --no-seed     # só o banco (uso diário, cron)
  python3 importers/sources/cet_suspensoes.py --file pagina.html    # mostra o que seria gravado (sem banco, só stdlib)
Anos: CET_ANOS=2025-2026 (padrão: ano anterior e atual).

Regras de interpretação da coluna OBSERVAÇÕES (texto livre da CET):
  - o que vem ANTES de "MANTIDO" diz o que foi suspenso: Rodízio/"Horário de Pico" -> 'rodizio'; ZMRC -> 'zmrc'; ZMRF -> 'zmrf';
  - "MANTIDO para veículos pesados" -> applies_to_heavy = true (a restrição continua para caminhões);
  - LOCAL AFETADO preenchido -> scope 'local' (só um trecho; não suspende zona nenhuma, fica só como registro);
  - PERÍODO "Manhã" -> 00h-12h, "Tarde" -> 12h-24h, vazio -> dia inteiro; "dd/mm/aaaa a dd/mm/aaaa" -> um registro por dia
    quando há período (a manhã de cada dia, não um bloco contínuo) e um intervalo só quando é o dia inteiro.
Linhas que não casam com nenhuma regra são ignoradas e contadas em NOTES (nunca derrubam a carga).
O importador só mexe nas linhas com source = 'cet': linhas manuais ou de teste com a mesma chave ficam como estão.
Nada é apagado se o site estiver fora, se a página do ano vier sem nenhuma suspensão reconhecida ou se mais da metade
das linhas do ano não for reconhecida (sinal de que a CET mudou o texto): as suspensões já gravadas continuam valendo.
"""
from __future__ import annotations

import datetime as dt
import html as htmlmod
import os
import re
import sys
import unicodedata

LAYER_ID = 'core_legal'
SOURCE = 'cet-suspensoes'
SOURCE_URL = 'https://webforms.cetsp.com.br/suspensaorodizio/Relatorio?year=AAAA'
LICENSE = 'Ato oficial (Decreto 58.584/2018 art. 8º; Lei 9.610/1998 art. 8º IV). Página da CET sem licença explícita: citar a fonte.'
NOTES = None
RECORD_COUNT = None   # suspensões lidas; o runner grava este número em data_layer_runs (as feições aqui são zero)
SEED_SQL = None       # seed próprio (rule_suspensions); o runner grava este texto no lugar do seed genérico

URL = 'https://webforms.cetsp.com.br/suspensaorodizio/Relatorio?year={year}'
IBGE_SP = '3550308'
TAG = 'cet'  # valor da coluna rule_suspensions.source para as linhas deste importador
MAX_SKIPPED = 0.5  # acima desta fração de linhas não reconhecidas, o ano não apaga nada


def _norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '')
    return re.sub(r'\s+', ' ', ''.join(c for c in s if not unicodedata.combining(c))).strip().upper()


def _text(cell: str) -> str:
    return re.sub(r'\s+', ' ', htmlmod.unescape(re.sub(r'<[^>]+>', ' ', cell))).strip()


def parse_rows(page: str) -> list[list[str]]:
    """Linhas da tabela (5 células de texto cada). Regex em vez de parser: a página é simples e estável."""
    body = page.split('<tbody', 1)[1] if '<tbody' in page else page
    out = []
    for tr in re.findall(r'(?is)<tr[^>]*>(.*?)</tr>', body):
        cells = [_text(c) for c in re.findall(r'(?is)<td[^>]*>(.*?)</td>', tr)]
        if len(cells) >= 5:
            out.append(cells[:5])
    return out


_DATE = re.compile(r'(\d{2})/(\d{2})/(\d{4})')


def _dates(s: str) -> tuple[dt.date, dt.date] | None:
    ds = [dt.date(int(y), int(m), int(d)) for d, m, y in _DATE.findall(s)]
    if not ds:
        return None
    return ds[0], ds[-1]


def interpret(cells: list[str]) -> list[dict]:
    """Uma linha da CET -> zero ou mais suspensões (uma por escopo e, com período, uma por dia)."""
    data, local, evento, periodo, obs = cells
    span = _dates(data)
    if not span:
        return []
    d0, d1 = span
    if d1 < d0 or (d1 - d0).days > 366:
        return []
    p = _norm(periodo)
    if p.startswith('MANH'):
        period, h0, h1 = 'manha', 0, 12
    elif p.startswith('TARDE'):
        period, h0, h1 = 'tarde', 12, 24
    else:
        period, h0, h1 = None, 0, 24
    if period:   # "Manhã" de 10 a 12/02 = três manhãs, não um bloco de 10/02 00h a 12/02 24h
        days = [d0 + dt.timedelta(days=k) for k in range((d1 - d0).days + 1)]
        spans = [(dt.datetime.combine(d, dt.time()) + dt.timedelta(hours=h0), dt.datetime.combine(d, dt.time()) + dt.timedelta(hours=h1))
                 for d in days]
    else:
        spans = [(dt.datetime.combine(d0, dt.time()), dt.datetime.combine(d1, dt.time()) + dt.timedelta(hours=24))]

    t = _norm(obs)
    suspended, _, maintained = t.partition('MANTID')
    heavy_kept = bool(maintained) and ('PESAD' in maintained or 'CAMINH' in maintained)
    scopes = []
    if _norm(local):
        scopes = ['local']
    else:
        if 'RODIZIO' in suspended or 'HORARIO DE PICO' in suspended:
            scopes.append('rodizio')
        if 'ZMRC' in suspended or 'ZONA DE MAXIMA RESTRICAO' in suspended:
            scopes.append('zmrc')
        if 'ZMRF' in suspended or 'FRETAMENTO' in suspended:
            scopes.append('zmrf')
    if not scopes or 'SUSPENS' not in t:
        return []
    return [{
        'starts_at': s0, 'ends_at': s1, 'scope': sc, 'period': period,
        'applies_to_heavy': heavy_kept, 'description': evento or None, 'raw_text': obs or None,
    } for sc in scopes for (s0, s1) in spans]


def years_from_env() -> list[int]:
    spec = os.environ.get('CET_ANOS')
    if spec:
        a, _, b = spec.partition('-')
        return list(range(int(a), int(b or a) + 1))
    y = dt.date.today().year
    return [y - 1, y]


def collect(years: list[int]) -> tuple[dict[int, list[dict]], dict[int, tuple[int, int]], list[str]]:
    """{ano: suspensões}, {ano: (linhas da tabela, linhas não reconhecidas)} e notas."""
    from common import http_get  # import tardio: o modo --file roda só com a stdlib
    by_year: dict[int, list[dict]] = {}
    counts: dict[int, tuple[int, int]] = {}
    notes: list[str] = []
    for y in years:
        url = URL.format(year=y)
        try:
            page = http_get(url, cache=f'cet_suspensoes_{y}.html', max_age_h=6, timeout=60).decode('utf-8', 'replace')
        except Exception as e:  # noqa: BLE001 — site fora não derruba a carga
            notes.append(f'{y}: CET indisponível ({type(e).__name__})')
            continue
        rows = parse_rows(page)
        if not rows:
            notes.append(f'{y}: tabela vazia ou formato mudou')
            continue
        items, skipped = [], 0
        for cells in rows:
            got = interpret(cells)
            skipped += 0 if got else 1
            for it in got:
                it['source_url'] = url
            items.extend(got)
        by_year[y] = items
        counts[y] = (len(rows), skipped)
        if skipped:
            notes.append(f'{y}: {skipped} de {len(rows)} linha(s) sem regra reconhecida')
    return by_year, counts, notes


def write_db(by_year: dict[int, list[dict]], counts: dict[int, tuple[int, int]], notes: list[str]) -> int:
    """Upsert por (ibge_code, starts_at, scope), só sobre linhas da CET. Depois apaga as linhas da CET que sumiram da fonte,
    ano a ano, e só nos anos em que a leitura foi confiável (uma suspensão de 22/12 a 10/01 aparece na página do ano seguinte:
    a lista de linhas mantidas é a de todos os anos lidos)."""
    from common import _pg_conn
    keep, seen = [], set()
    with _pg_conn() as c, c.cursor() as cur:
        for y, items in by_year.items():
            foreign = 0
            for it in items:
                cur.execute(
                    """insert into rule_suspensions (ibge_code, starts_at, ends_at, scope, applies_to_heavy, description, source_url,
                                                     source, period, raw_text, updated_at)
                       values (%s, %s::timestamp at time zone 'America/Sao_Paulo', %s::timestamp at time zone 'America/Sao_Paulo',
                               %s, %s, %s, %s, %s, %s, %s, now())
                       on conflict (ibge_code, starts_at, scope) do update
                         set ends_at = excluded.ends_at, applies_to_heavy = excluded.applies_to_heavy, description = excluded.description,
                             source_url = excluded.source_url, period = excluded.period, raw_text = excluded.raw_text, updated_at = now()
                         where rule_suspensions.source = %s
                       returning id""",
                    (IBGE_SP, it['starts_at'], it['ends_at'], it['scope'], it['applies_to_heavy'], it['description'],
                     it['source_url'], TAG, it['period'], it['raw_text'], TAG))
                row = cur.fetchone()
                if row is None:          # já existe uma linha manual/de teste com a mesma chave: fica como está
                    foreign += 1
                    continue
                keep.append(row[0])
                seen.add((it['starts_at'], it['scope']))
            if foreign:
                notes.append(f'{y}: {foreign} suspensão(ões) já existiam com outra origem e foram mantidas')
        for y, items in by_year.items():
            rows, skipped = counts.get(y, (0, 0))
            if not items or (rows and skipped / rows > MAX_SKIPPED):
                notes.append(f'{y}: leitura incerta ({skipped}/{rows} linhas não reconhecidas); nada foi apagado')
                continue
            cur.execute(
                """delete from rule_suspensions
                    where source = %s and ibge_code = %s and not (id = any(%s))
                      and starts_at >= make_timestamptz(%s, 1, 1, 0, 0, 0, 'America/Sao_Paulo')
                      and starts_at <  make_timestamptz(%s, 1, 1, 0, 0, 0, 'America/Sao_Paulo')""",
                (TAG, IBGE_SP, keep, y, y + 1))
    return len(seen)


def _q(v) -> str:
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    return "'" + str(v).replace("'", "''") + "'"


def seed_sql(by_year: dict[int, list[dict]], n: int, notes: str) -> str:
    rows = sorted({(it['starts_at'], it['scope']): it for items in by_year.values() for it in items}.values(),
                  key=lambda it: (it['starts_at'], it['scope']))
    lines = [f'-- GERADO por importers/sources/cet_suspensoes.py. Fonte: {SOURCE_URL}. Licença: {LICENSE} Não edite à mão.',
             '-- Suspensões publicadas pela CET (Decreto 58.584/2018 art. 8º). Requer a migration 0101. Só mexe em linhas source = cet.']
    if rows:
        tz = "::timestamp at time zone 'America/Sao_Paulo'"
        vals = ['  (' + ', '.join([_q(IBGE_SP), _q(it['starts_at'].strftime('%Y-%m-%d %H:%M')) + tz,
                                   _q(it['ends_at'].strftime('%Y-%m-%d %H:%M')) + tz, _q(it['scope']), _q(it['applies_to_heavy']),
                                   _q(it['description']), _q(it['source_url']), _q(TAG), _q(it['period']), _q(it['raw_text'])]) + ')'
                for it in rows]
        lines += ['insert into rule_suspensions (ibge_code, starts_at, ends_at, scope, applies_to_heavy, description, source_url, '
                  'source, period, raw_text) values', ',\n'.join(vals),
                  'on conflict (ibge_code, starts_at, scope) do update',
                  '  set ends_at = excluded.ends_at, applies_to_heavy = excluded.applies_to_heavy, description = excluded.description,',
                  '      source_url = excluded.source_url, period = excluded.period, raw_text = excluded.raw_text, updated_at = now()',
                  f'  where rule_suspensions.source = {_q(TAG)};']
    lines.append('insert into data_layer_runs (layer_id, source, source_url, license, record_count, notes) '
                 f'select {_q(LAYER_ID)}, {_q(SOURCE)}, {_q(SOURCE_URL)}, {_q(LICENSE)}, {n}, {_q(notes)} '
                 f'where not exists (select 1 from data_layer_runs where layer_id = {_q(LAYER_ID)} and source = {_q(SOURCE)} '
                 f'and notes = {_q(notes)});')
    return '\n'.join(lines) + '\n'


def fetch():
    """Chamado pelo runner: lê a CET, grava rule_suspensions (exceto com --seed-only) e devolve [] (nada vai para
    data_features). A contagem e o seed ficam em RECORD_COUNT e SEED_SQL, que o runner usa."""
    global NOTES, RECORD_COUNT, SEED_SQL
    years = years_from_env()
    seed_only = '--seed-only' in sys.argv
    by_year, counts, notes = collect(years)
    items = {(it['starts_at'], it['scope']): it for v in by_year.values() for it in v}
    n = len(items)
    written = write_db(by_year, counts, notes) if by_year and not seed_only else 0
    heavy = sum(1 for it in items.values() if it['applies_to_heavy'])
    summary = f'{n} suspensões {years[0]}-{years[-1]} ({heavy} mantêm a restrição para pesados)'
    NOTES = summary + ('.' if seed_only else f'; {written} gravadas em rule_suspensions.') + (' ' + '; '.join(notes) if notes else '')
    RECORD_COUNT = n
    SEED_SQL = seed_sql(by_year, n, f'seed: {summary}')
    print('   ', NOTES)
    return []


if __name__ == '__main__':
    if '--file' in sys.argv:
        page = open(sys.argv[sys.argv.index('--file') + 1], encoding='utf-8', errors='replace').read()
        for cells in parse_rows(page):
            got = interpret(cells)
            if not got:
                print('IGNORADA:', cells[0], '|', cells[4][:80])
            for it in got:
                print(f"{it['starts_at']:%Y-%m-%d %H:%M} -> {it['ends_at']:%Y-%m-%d %H:%M} {it['scope']:8s} "
                      f"pesados_mantidos={it['applies_to_heavy']!s:5s} {it['period'] or 'dia'} | {(it['description'] or '')[:60]}")
    else:
        print(__doc__)
