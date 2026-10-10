"""Feriados estaduais de RJ, MG e ES e municipais das capitais e polos do Sudeste -> tabela holidays.

Regras declarativas em data/raw/feriados/regras.json (versionado): cada regra diz a data (fixa, relativa à Páscoa,
N-ésimo domingo do mês ou avulsa), o escopo (state/municipal), a UF, o código IBGE, a norma com artigo, a fonte, a
confiança e a situação jurídica. Este importador calcula as datas dos anos configurados e grava na tabela `holidays`
(lida por api/src/services/calendar.ts), não em data_features: fetch() devolve lista vazia e o runner usa
  - RECORD_COUNT: linhas geradas (vai para data_layer_runs.record_count);
  - SEED_SQL: conteúdo de db/seed/layers/core_legal__feriados-sudeste.sql (só linhas source = 'feriados-sudeste').
Modelo: o antigo importers/sources/feriados_sp.py (cálculo pela lei; saiu no commit 648bdf9 por gravar fora do contrato
do runner), dentro do contrato como o cet_suspensoes.py. Os feriados nacionais, o estadual de SP e os municipais da
capital paulista continuam em db/seed/0004_holidays.sql (scripts/gen-zones-seed.py).

Aplicação (migration 0202): só linhas active = true são usadas pela API.
  - confiança 'baixa' ou 'unverifiable' => active = false, com o motivo em inactive_reason;
  - status 'inconstitucional' / 'revogada' / 'suspensa' / 'a_confirmar' => active = false (registrada, nunca aplicada);
  - regra 'redundante' (a data já está na tabela por outra norma, ex.: 20/11 do RJ = nacional) não gera linha.
Só entra FERIADO. Ponto facultativo, 'emenda', 'dia sem expediente' e data cívica ficam fora (não suspendem regra de
trânsito): ver docs/layers/feriados_sudeste.md.

  docker run ... truck-router-importer feriados_sudeste               # grava no banco e regenera o seed
  docker run ... truck-router-importer feriados_sudeste --seed-only   # só o seed
  python3 importers/sources/feriados_sudeste.py --listar [--ano 2026]  # mostra as linhas (sem banco, só stdlib)
  python3 importers/sources/feriados_sudeste.py --conferir-tjsp         # compara os municípios de SP com a consulta do TJSP
Anos: FERIADOS_ANOS=2026-2028 (padrão: 'anos' do regras.json). FERIADOS_CONFERIR_TJSP=1 faz a conferência também na carga
(só anota divergências em NOTES; nunca muda as linhas: a curadoria em regras.json é a fonte).
O importador só mexe nas linhas com source = 'feriados-sudeste'; linha de outra origem com a mesma chave
(dia, escopo, UF, IBGE) fica como está e é contada em NOTES. Regra inconsistente (data inválida, ativa sem confiança,
desativada sem motivo, UF que não bate com o IBGE, duas linhas com a mesma chave) FALHA a carga sem gravar nada.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import sys
import unicodedata

LAYER_ID = 'core_legal'
SOURCE = 'feriados-sudeste'
SOURCE_URL = ('data/raw/feriados/regras.json: leis estaduais (ALERJ, ALES, ALMG), decisões do STF, leis e decretos '
              'municipais (Querido Diário) e atos de feriados locais do TJMG, TJSP, TJRJ, TJES, TRF2, TRT3 e TRT17 '
              '(URL de cada feriado em holidays.source_url)')
LICENSE = ('Atos oficiais (leis, decretos, decisões e atos de tribunais): domínio público (Lei 9.610/1998 art. 8º IV). '
           'Cópias do Querido Diário (Open Knowledge Brasil) e republicação do CNB-SP: citar a fonte.')
NOTES = None
RECORD_COUNT = None   # linhas geradas; o runner grava este número em data_layer_runs (as feições aqui são zero)
SEED_SQL = None       # seed próprio (holidays); o runner grava este texto no lugar do seed genérico

SCOPES = ('state', 'municipal')
CONFIDENCES = ('alta', 'media', 'baixa', 'unverifiable')
STATUSES = ('vigente', 'a_confirmar', 'inconstitucional', 'revogada', 'suspensa')
UF_BY_PREFIX = {'31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP'}
MESES = ['', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro',
         'novembro', 'dezembro']
TJSP_URL = 'https://www.tjsp.jus.br/CanaisComunicacao/Feriados/PesquisarFeriados'


def rules_path() -> pathlib.Path:
    if os.environ.get('FERIADOS_REGRAS'):
        return pathlib.Path(os.environ['FERIADOS_REGRAS'])
    p = pathlib.Path(os.environ.get('DATA_DIR', '/data')) / 'raw' / 'feriados' / 'regras.json'
    if p.exists():
        return p
    # fora do container: importers/sources/<este> -> raiz do repositório
    return pathlib.Path(__file__).resolve().parents[2] / 'data' / 'raw' / 'feriados' / 'regras.json'


def easter(year: int) -> dt.date:
    """Domingo de Páscoa (algoritmo gregoriano anônimo / Meeus-Jones-Butcher), o mesmo de scripts/gen-zones-seed.py."""
    a = year % 19; b = year // 100; c = year % 100
    d = b // 4; e = b % 4; f = (b + 8) // 25; g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4; k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


_FIXA = re.compile(r'^fixa:(\d{2})-(\d{2})$')
_PASCOA = re.compile(r'^pascoa:([+-]\d{1,3})$')
_DATA = re.compile(r'^data:(\d{4}-\d{2}-\d{2})$')
_DOMINGO = re.compile(r'^domingo:(\d{2}):([1-5])$')


def date_for(regra: str, year: int) -> dt.date | None:
    """Data da regra no ano (None se a regra avulsa é de outro ano). Regra desconhecida levanta ValueError."""
    if m := _FIXA.match(regra):
        return dt.date(year, int(m.group(1)), int(m.group(2)))
    if m := _PASCOA.match(regra):
        return easter(year) + dt.timedelta(days=int(m.group(1)))
    if m := _DATA.match(regra):
        d = dt.date.fromisoformat(m.group(1))
        return d if d.year == year else None
    if m := _DOMINGO.match(regra):
        first = dt.date(year, int(m.group(1)), 1)
        first_sunday = first + dt.timedelta(days=(6 - first.weekday()) % 7)
        return first_sunday + dt.timedelta(days=7 * (int(m.group(2)) - 1))
    raise ValueError(f'regra de data desconhecida: {regra!r}')


def rule_label(regra: str) -> str:
    """Como a data é calculada, em português (vai para holidays.rule)."""
    if m := _FIXA.match(regra):
        return f'fixa: {int(m.group(2))} de {MESES[int(m.group(1))]}'
    if m := _PASCOA.match(regra):
        n = int(m.group(1))
        return f"Páscoa {'+' if n >= 0 else '−'} {abs(n)} dias"
    if _DATA.match(regra):
        return 'data avulsa'
    if m := _DOMINGO.match(regra):
        return f'{m.group(2)}º domingo de {MESES[int(m.group(1))]}'
    return regra


def load_rules(path: pathlib.Path | None = None) -> dict:
    return json.loads((path or rules_path()).read_text(encoding='utf-8'))


def years_from(cfg: dict) -> list[int]:
    spec = os.environ.get('FERIADOS_ANOS')
    if spec:
        a, _, b = spec.partition('-')
        return list(range(int(a), int(b or a) + 1))
    y0, y1 = cfg['anos']
    return list(range(int(y0), int(y1) + 1))


def is_active(r: dict) -> bool:
    return r['status'] == 'vigente' and r['confianca'] in ('alta', 'media')


def check_rule(r: dict, fontes: dict) -> None:
    """Falha (ValueError) em regra inconsistente: melhor nenhuma carga do que feriado errado suspendendo restrição."""
    rid = r.get('id') or '?'
    for k in ('id', 'escopo', 'uf', 'nome', 'regra', 'base_legal', 'fonte', 'confianca', 'status'):
        if not r.get(k):
            raise ValueError(f'{rid}: campo obrigatório ausente: {k}')
    if r['escopo'] not in SCOPES:
        raise ValueError(f'{rid}: escopo inválido {r["escopo"]!r}')
    if r['confianca'] not in CONFIDENCES:
        raise ValueError(f'{rid}: confiança inválida {r["confianca"]!r}')
    if r['status'] not in STATUSES:
        raise ValueError(f'{rid}: status inválido {r["status"]!r}')
    if r['fonte'] not in fontes:
        raise ValueError(f'{rid}: fonte {r["fonte"]!r} não está em "fontes"')
    if r['escopo'] == 'municipal':
        ib = str(r.get('ibge') or '')
        if not re.fullmatch(r'\d{7}', ib):
            raise ValueError(f'{rid}: feriado municipal sem código IBGE de 7 dígitos')
        if UF_BY_PREFIX.get(ib[:2]) != r['uf']:
            raise ValueError(f'{rid}: UF {r["uf"]} não bate com o IBGE {ib}')
    elif r.get('ibge'):
        raise ValueError(f'{rid}: feriado estadual não leva código IBGE')
    if is_active(r) and r.get('motivo_inativo'):
        raise ValueError(f'{rid}: regra aplicável com motivo_inativo (confira status/confiança)')
    if not is_active(r) and not r.get('motivo_inativo'):
        raise ValueError(f'{rid}: regra desativada (status {r["status"]}, confiança {r["confianca"]}) sem motivo_inativo')
    date_for(r['regra'], 2026)  # valida o formato


def compute(cfg: dict, years: list[int]) -> tuple[list[dict], dict]:
    """Linhas da tabela holidays para os anos pedidos e estatísticas."""
    fontes = cfg['fontes']
    ids = set()
    rows, stats = [], {'regras': 0, 'redundantes': 0}
    for r in cfg['regras']:
        check_rule(r, fontes)
        if r['id'] in ids:
            raise ValueError(f'id de regra repetido: {r["id"]}')
        ids.add(r['id'])
        stats['regras'] += 1
        if r.get('redundante'):
            stats['redundantes'] += 1
            continue
        a, b = r.get('anos') or (years[0], years[-1])
        v0 = dt.date.fromisoformat(r['vigencia_de']) if r.get('vigencia_de') else None
        v1 = dt.date.fromisoformat(r['vigencia_ate']) if r.get('vigencia_ate') else None
        active = is_active(r)
        for y in years:
            if not (int(a) <= y <= int(b)):
                continue
            d = date_for(r['regra'], y)
            if d is None or (v0 and d < v0) or (v1 and d > v1):
                continue
            rows.append({
                'day': d, 'scope': r['escopo'], 'uf': r['uf'], 'ibge_code': r.get('ibge'), 'name': r['nome'],
                'legal_basis': r['base_legal'], 'active': active, 'status': r['status'], 'confidence': r['confianca'],
                'inactive_reason': None if active else r['motivo_inativo'], 'source_url': fontes[r['fonte']]['url'],
                'rule': rule_label(r['regra']), 'rule_key': r['id'], 'notes': r.get('obs'),
                'municipio': r.get('municipio'),
            })
    seen = {}
    for row in rows:
        k = (row['day'], row['scope'], row['uf'] or '', row['ibge_code'] or '')
        if k in seen:
            raise ValueError(f'duas regras geram a mesma linha {k}: {seen[k]} e {row["rule_key"]}')
        seen[k] = row['rule_key']
    rows.sort(key=lambda x: (x['day'], x['scope'], x['uf'] or '', x['ibge_code'] or ''))
    return rows, stats


def summary(rows: list[dict], stats: dict, years: list[int]) -> str:
    act = sum(1 for x in rows if x['active'])
    by_status: dict[str, int] = {}
    for x in rows:
        if not x['active']:
            by_status[x['status']] = by_status.get(x['status'], 0) + 1
    off = ', '.join(f'{v} {k}' for k, v in sorted(by_status.items()))
    return (f'{len(rows)} feriados {years[0]}-{years[-1]} de {stats["regras"]} regras ({stats["redundantes"]} redundantes, sem linha): '
            f'{act} aplicados, {len(rows) - act} registrados sem aplicar' + (f' ({off})' if off else ''))


COLS = ('day', 'scope', 'uf', 'ibge_code', 'name', 'source', 'legal_basis', 'active', 'status', 'confidence',
        'inactive_reason', 'source_url', 'rule', 'rule_key', 'notes')


def _values(row: dict) -> tuple:
    return tuple(SOURCE if c == 'source' else row[c] for c in COLS)


def write_db(rows: list[dict]) -> tuple[int, int]:
    """Troca as linhas desta fonte numa transação. Devolve (gravadas, mantidas de outra origem)."""
    from common import _pg_conn
    written = foreign = 0
    with _pg_conn() as c, c.cursor() as cur:
        cur.execute('delete from holidays where source = %s', (SOURCE,))
        sql = (f'insert into holidays ({", ".join(COLS)}) values ({", ".join(["%s"] * len(COLS))}) '
               "on conflict (day, scope, coalesce(uf, ''), coalesce(ibge_code, '')) do nothing returning id")
        for row in rows:
            cur.execute(sql, _values(row))
            if cur.fetchone() is None:
                foreign += 1
            else:
                written += 1
    return written, foreign


def _q(v) -> str:
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, dt.date):
        return f"'{v.isoformat()}'"
    return "'" + str(v).replace("'", "''") + "'"


def seed_sql(rows: list[dict], notes: str) -> str:
    lines = [f'-- GERADO por importers/sources/feriados_sudeste.py a partir de data/raw/feriados/regras.json. Licença: {LICENSE} Não edite à mão.',
             '-- Feriados estaduais (RJ, ES) e municipais das capitais e polos do Sudeste. Requer a migration 0202. Só mexe em linhas source = feriados-sudeste.',
             '-- active = false: registrada e nunca aplicada (confiança baixa/unverifiable ou norma inconstitucional); motivo em inactive_reason.',
             f'delete from holidays where source = {_q(SOURCE)};']
    if rows:
        lines += [f'insert into holidays ({", ".join(COLS)}) values',
                  ',\n'.join('  (' + ', '.join(_q(v) for v in _values(r)) + ')' for r in rows),
                  "on conflict (day, scope, coalesce(uf, ''), coalesce(ibge_code, '')) do nothing;"]
    lines.append('insert into data_layer_runs (layer_id, source, source_url, license, record_count, notes) '
                 f'select {_q(LAYER_ID)}, {_q(SOURCE)}, {_q(SOURCE_URL)}, {_q(LICENSE)}, {len(rows)}, {_q(notes)} '
                 f'where not exists (select 1 from data_layer_runs where layer_id = {_q(LAYER_ID)} and source = {_q(SOURCE)} '
                 f'and notes = {_q(notes)});')
    return '\n'.join(lines) + '\n'


# ------------------------------------------------------------------------------------- conferência com o TJSP
def _norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '')
    return re.sub(r'\s+', ' ', ''.join(c for c in s if not unicodedata.combining(c))).strip().upper()


def conferir_tjsp(rows: list[dict], year: int) -> list[str]:
    """Compara as datas FIXAS e AVULSAS dos municípios paulistas (fora a capital) com a consulta oficial do TJSP do ano.
    Linhas '(PROVIMENTO CSM ...)' são forenses e valem para todo o estado: ficam fora (por isso Paixão e Corpus Christi,
    que o TJSP só lista como forense, não entram na comparação). Só anota divergências; nunca muda as linhas."""
    import urllib.parse
    import urllib.request
    out = []
    muns = sorted({(r['ibge_code'], r['municipio']) for r in rows
                   if r['uf'] == 'SP' and r['ibge_code'] and r['ibge_code'] != '3550308' and r['municipio']})
    for ibge, nome in muns:
        ours = {r['day'].strftime('%d/%m') for r in rows if r['ibge_code'] == ibge and r['active'] and r['day'].year == year
                and not r['rule'].startswith('Páscoa')}
        q = urllib.parse.urlencode({'nomeMunicipio': nome, 'codigoMunicipio': 0, 'ano': year})
        req = urllib.request.Request(f'{TJSP_URL}?{q}', headers={'User-Agent': 'Mozilla/5.0 (truck-router-mvp)', 'X-Requested-With': 'XMLHttpRequest'})
        try:
            data = json.load(urllib.request.urlopen(req, timeout=40)).get('data') or []
        except Exception as e:  # noqa: BLE001 — conferência não derruba a carga
            out.append(f'TJSP indisponível para {nome} ({type(e).__name__})')
            continue
        theirs = {x['Data'][:5]: x['Descricao'] for x in data if 'PROVIMENTO CSM' not in _norm(x.get('Descricao', ''))}
        for d, desc in sorted(theirs.items()):
            if d not in ours:
                out.append(f'{nome}: TJSP lista {d}/{year} ({desc}) que não está nas regras')
        for d in sorted(ours - set(theirs)):
            out.append(f'{nome}: regra em {d}/{year} não aparece na consulta do TJSP')
    return out


def fetch():
    """Chamado pelo runner: calcula as linhas, grava holidays (exceto com --seed-only) e devolve [] (nada vai para
    data_features). A contagem e o seed ficam em RECORD_COUNT e SEED_SQL, que o runner usa."""
    global NOTES, RECORD_COUNT, SEED_SQL
    cfg = load_rules()
    years = years_from(cfg)
    rows, stats = compute(cfg, years)
    seed_only = '--seed-only' in sys.argv
    tag = summary(rows, stats, years)
    extra = []
    if not seed_only:
        written, foreign = write_db(rows)
        extra.append(f'{written} gravados em holidays')
        if foreign:
            extra.append(f'{foreign} já existiam com outra origem e foram mantidos')
    if os.environ.get('FERIADOS_CONFERIR_TJSP') == '1':
        div = conferir_tjsp(rows, years[0])
        extra.append(f'conferência TJSP {years[0]}: ' + ('; '.join(div) if div else 'sem divergências'))
    NOTES = tag + ('.' if not extra else '; ' + '; '.join(extra) + '.')
    RECORD_COUNT = len(rows)
    SEED_SQL = seed_sql(rows, f'seed: {tag} (regras verificadas em {cfg.get("verificado_em")})')
    print('   ', NOTES)
    return []


if __name__ == '__main__':
    cfg = load_rules()
    years = years_from(cfg)
    rows, stats = compute(cfg, years)
    if '--conferir-tjsp' in sys.argv:
        y = int(sys.argv[sys.argv.index('--ano') + 1]) if '--ano' in sys.argv else years[0]
        div = conferir_tjsp(rows, y)
        print('\n'.join(div) if div else f'sem divergências com o TJSP em {y}')
    elif '--listar' in sys.argv:
        only = int(sys.argv[sys.argv.index('--ano') + 1]) if '--ano' in sys.argv else None
        for r in rows:
            if only and r['day'].year != only:
                continue
            where = r['uf'] if r['scope'] == 'state' else f"{r['municipio']}/{r['uf']} {r['ibge_code']}"
            flag = 'APLICA ' if r['active'] else f"inativo({r['status']}) "
            print(f"{r['day']:%Y-%m-%d} {r['scope']:9s} {where:38s} {flag:28s} {r['confidence']:12s} {r['name']} | {r['legal_basis'][:70]}")
        print(summary(rows, stats, years))
    else:
        print(__doc__)
