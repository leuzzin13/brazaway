"""Suspensões do rodízio, da ZMRC e da ZMRF publicadas pela CET (São Paulo capital).

Fonte: https://webforms.cetsp.com.br/suspensaorodizio/Relatorio?year=AAAA (tabela HTML, um ano por página, desde 1997;
colunas DATA | LOCAL AFETADO | EVENTO | PERÍODO | OBSERVAÇÕES). Base legal da suspensão: Decreto 58.584/2018 art. 8º
(portaria do Secretário da SMT; §2º permite suspender só um período do dia).

Este importador NÃO usa data_features (suspensão não tem geometria): grava direto na tabela `rule_suspensions`
(lida por api/src/services/calendar.ts). Expõe LAYER_ID/SOURCE/... para o runner registrar a carga em
data_layer_runs; fetch() devolve lista vazia. Rode com --no-seed (suspensão é dado vivo; não vira seed):

  docker run ... truck-router-importer cet_suspensoes --no-seed     # anos: CET_ANOS=2025-2026 (default: ano anterior e atual)
  python3 importers/sources/cet_suspensoes.py --file pagina.html     # só mostra o que seria gravado (sem banco)

Regras de interpretação da coluna OBSERVAÇÕES (texto livre da CET):
  - o que vem ANTES de "MANTIDO" diz o que foi suspenso: Rodízio/"Horário de Pico" -> 'rodizio'; ZMRC -> 'zmrc'; ZMRF -> 'zmrf';
  - "MANTIDO para veículos pesados" -> applies_to_heavy = true (a restrição continua para caminhões);
  - LOCAL AFETADO preenchido -> scope 'local' (só um trecho; não suspende zona nenhuma, fica só como registro);
  - PERÍODO "Manhã" -> 00h-12h, "Tarde" -> 12h-24h, vazio -> dia inteiro. "dd/mm/aaaa a dd/mm/aaaa" -> intervalo.
Linhas que não casam com nenhuma regra são ignoradas e contadas em NOTES (nunca derrubam a carga).
Se o site estiver fora, nada é apagado: as suspensões já gravadas continuam valendo.
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

URL = 'https://webforms.cetsp.com.br/suspensaorodizio/Relatorio?year={year}'
IBGE_SP = '3550308'
TAG = 'cet'  # valor da coluna rule_suspensions.source para as linhas deste importador


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
    """Uma linha da CET -> zero ou mais suspensões (uma por escopo)."""
    data, local, evento, periodo, obs = cells
    span = _dates(data)
    if not span:
        return []
    d0, d1 = span
    p = _norm(periodo)
    if p.startswith('MANH'):
        period, h0, h1 = 'manha', 0, 12
    elif p.startswith('TARDE'):
        period, h0, h1 = 'tarde', 12, 24
    else:
        period, h0, h1 = None, 0, 24
    starts = dt.datetime.combine(d0, dt.time()) + dt.timedelta(hours=h0)
    ends = dt.datetime.combine(d1, dt.time()) + dt.timedelta(hours=h1)

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
        'starts_at': starts, 'ends_at': ends, 'scope': sc, 'period': period,
        'applies_to_heavy': heavy_kept, 'description': evento or None, 'raw_text': obs or None,
    } for sc in scopes]


def years_from_env() -> list[int]:
    spec = os.environ.get('CET_ANOS')
    if spec:
        a, _, b = spec.partition('-')
        return list(range(int(a), int(b or a) + 1))
    y = dt.date.today().year
    return [y - 1, y]


def collect(years: list[int]) -> tuple[dict[int, list[dict]], list[str]]:
    from common import http_get  # import tardio: o modo --file roda só com a stdlib
    by_year: dict[int, list[dict]] = {}
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
        if skipped:
            notes.append(f'{y}: {skipped} linha(s) sem regra reconhecida')
    return by_year, notes


def write_db(by_year: dict[int, list[dict]]) -> int:
    """Upsert por (ibge_code, starts_at, scope). Só apaga linhas da CET dos anos lidos com sucesso que sumiram da fonte."""
    from common import _pg_conn
    seen = set()
    with _pg_conn() as c, c.cursor() as cur:
        for y, items in by_year.items():
            keep = []
            for it in items:
                cur.execute(
                    """insert into rule_suspensions (ibge_code, starts_at, ends_at, scope, applies_to_heavy, description, source_url,
                                                     source, period, raw_text, updated_at)
                       values (%s, %s::timestamp at time zone 'America/Sao_Paulo', %s::timestamp at time zone 'America/Sao_Paulo',
                               %s, %s, %s, %s, %s, %s, %s, now())
                       on conflict (ibge_code, starts_at, scope) do update
                         set ends_at = excluded.ends_at, applies_to_heavy = excluded.applies_to_heavy, description = excluded.description,
                             source_url = excluded.source_url, source = excluded.source, period = excluded.period,
                             raw_text = excluded.raw_text, updated_at = now()
                       returning id""",
                    (IBGE_SP, it['starts_at'], it['ends_at'], it['scope'], it['applies_to_heavy'], it['description'],
                     it['source_url'], TAG, it['period'], it['raw_text']))
                keep.append(cur.fetchone()[0])
                seen.add((it['starts_at'], it['scope']))
            cur.execute(
                """delete from rule_suspensions
                    where source = %s and ibge_code = %s and not (id = any(%s))
                      and starts_at >= make_timestamptz(%s, 1, 1, 0, 0, 0, 'America/Sao_Paulo')
                      and starts_at <  make_timestamptz(%s, 1, 1, 0, 0, 0, 'America/Sao_Paulo')""",
                (TAG, IBGE_SP, keep, y, y + 1))
    return len(seen)


def fetch():
    """Chamado pelo runner: grava rule_suspensions e devolve [] (nada vai para data_features)."""
    global NOTES
    years = years_from_env()
    by_year, notes = collect(years)
    n = write_db(by_year) if by_year else 0
    heavy = len({(it['starts_at'], it['scope']) for items in by_year.values() for it in items if it['applies_to_heavy']})
    NOTES = (f'{n} suspensões {years[0]}-{years[-1]} gravadas em rule_suspensions ({heavy} mantêm a restrição para pesados).'
             + (' ' + '; '.join(notes) if notes else ''))
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
        sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
        fetch()
