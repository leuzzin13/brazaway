"""Postos de Pesagem Veicular (PPV) das rodovias FEDERAIS concedidas — ANTT (dados.antt.gov.br, CC-BY).

- `ppv`: localização (lat/lon), rodovia, km, sentido (crescente/decrescente) e tipo (Fixo, Móvel, HS-WIM).
- `posto-pesagem-veicular`: operação diária (tempo funcionando x parado) — usamos o último mês publicado com dados para
  dizer "costuma operar X% do tempo". Os arquivos mais novos às vezes vêm só com cabeçalho (registrado em NOTES).
Não cobre os postos do DNIT em rodovias federais NÃO concedidas (não há lista aberta com coordenadas).
"""
from __future__ import annotations
import csv, io, json, re, unicodedata
from common import http_get, stable_id

LAYER_ID = 'balancas'
SOURCE = 'antt'
CKAN = 'https://dados.antt.gov.br/api/3/action/package_show?id='
SOURCE_URL = 'https://dados.antt.gov.br/dataset/ppv + https://dados.antt.gov.br/dataset/posto-pesagem-veicular'
LICENSE = 'CC-BY — ANTT (dados.antt.gov.br)'
NOTES = ''


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def read_csv(raw: bytes) -> list[dict]:
    try:
        txt = raw.decode('utf-8-sig')
    except UnicodeDecodeError:
        txt = raw.decode('latin1')
    return list(csv.DictReader(io.StringIO(txt), delimiter=';'))


def minutes(s: str) -> int:
    """'DD:HH:MM' (dicionário da ANTT) -> minutos."""
    p = [int(x) for x in re.findall(r'\d+', s or '')]
    if len(p) == 3:
        return p[0] * 1440 + p[1] * 60 + p[2]
    if len(p) == 2:
        return p[0] * 60 + p[1]
    return 0


def uptime() -> tuple[dict[tuple[str, str], float], str | None]:
    pkg = json.loads(http_get(CKAN + 'posto-pesagem-veicular', cache='antt_ppv_oper_pkg.json', max_age_h=24))['result']
    res = [r for r in pkg['resources'] if (r.get('format') or '').upper() == 'CSV' and 'OPERACAO' in (r.get('name') or '').upper()]

    def ym(r):
        m = re.search(r'(\d{4})_(\d{1,2})', r.get('name') or '')
        return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
    for r in sorted(res, key=ym, reverse=True):
        rows = read_csv(http_get(r['url'], cache=f'antt_{norm(r["name"]).replace(" ", "_")}.csv', max_age_h=24 * 7))
        if not rows:
            continue
        agg: dict[tuple[str, str], list[int]] = {}
        months = set()
        for x in rows:
            key = ((x.get('UF') or '').strip(), norm(re.sub(r'(?i)^ppv\s*', '', x.get('Posto_de_Pesagem') or '')))
            a = agg.setdefault(key, [0, 0])
            a[0] += minutes(x.get('Tempo_de_Funcionamento'))
            a[1] += minutes(x.get('Tempo_de_Paralisacao'))
            months.add((x.get('Data') or '')[:7])
        ref = f'{min(months)}..{max(months)}' if len(months) > 1 else next(iter(months), None)
        return {k: round(100 * v[0] / (v[0] + v[1]), 1) for k, v in agg.items() if v[0] + v[1] > 0}, ref
    return {}, None


def fetch():
    global NOTES
    pkg = json.loads(http_get(CKAN + 'ppv', cache='antt_ppv_pkg.json', max_age_h=24))['result']
    res = next(r for r in pkg['resources'] if (r.get('format') or '').upper() == 'CSV')
    rows = read_csv(http_get(res['url'], cache='antt_ppv.csv', max_age_h=24))
    up, ref = uptime()
    out, with_up = [], 0
    for r in rows:
        if (r.get('situacao') or '').strip().lower() != 'ativo':
            continue
        try:
            lat, lon = float(r['latitude'].replace(',', '.')), float(r['longitude'].replace(',', '.'))
        except (KeyError, ValueError):
            continue
        uf = (r.get('uf') or '').strip()
        mun, nome = norm(r.get('municipio')), norm(r.get('nome_do_ppv'))
        pct = None
        for (u, posto), v in up.items():
            if u == uf and posto and (posto == mun or posto in nome or mun in posto):
                pct = v
                break
        if pct is not None:
            with_up += 1
        tipo = (r.get('tipo_ppv') or '').strip()
        kind = 'hs_wim' if 'WIM' in tipo.upper() else 'movel' if 'VEL' in tipo.upper() else 'fixo'
        sentido = (r.get('sentido') or '').strip().lower().replace('/', '+') or None
        m = re.match(r'(?i)^\s*BR\s*-?\s*0*(\d+)', r.get('rodovia') or '')
        rod = f'BR-{int(m.group(1)):03d}' if m else r.get('rodovia')
        km = float(r['km_m'].replace(',', '.')) if re.match(r'^[\d.,]+$', r.get('km_m') or '') else None
        out.append({'source_id': stable_id('antt-ppv', r.get('concessionaria'), r.get('nome_do_ppv'), r.get('km_m'), sentido),
                    'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                    'name': f'PPV {rod} km {km:g} ({r.get("municipio")})' if km is not None else (r.get('nome_do_ppv') or 'PPV').strip(),
                    'kind': kind,
                    'props': {'rodovia': rod, 'km': km, 'sentido': sentido, 'administrador': (r.get('concessionaria') or '').strip(),
                              'nome_original': (r.get('nome_do_ppv') or '').strip(), 'municipio': r.get('municipio'), 'uf': uf,
                              'tipo_original': tipo, 'pista': r.get('tipo_de_pista'), 'disponibilidade_pct': pct,
                              'disponibilidade_ref': ref if pct is not None else None, 'precisao': 'exata'}})
    NOTES = f'{len(out)} PPV ativos; disponibilidade (ANTT, {ref or "sem dados"}) casada para {with_up}.'
    return out
