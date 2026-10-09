"""Praças de pedágio das rodovias FEDERAIS concedidas (ANTT) + tarifas por categoria/eixo.

- Praças: dataset CKAN `praca-de-pedagio` (dados.antt.gov.br, CC-BY): concessionária, praça, rodovia, km, sentido, lat/lon.
  Não traz tarifa. As 89 linhas de free flow (pares entrada/saída da Dutra) viram um ponto por pórtico de entrada.
- Tarifas: página "tarifas-de-pedagio" de cada concessão em gov.br/antt (tabela HTML: categoria, eixos, rodagem,
  multiplicador e valor por praça; algumas com coluna de fim de semana "FDS"). Guardamos a data "Atualizado em" da página.
  Regra das tabelas ANTT: veículo comercial de rodagem dupla paga multiplicador = nº de eixos; rodagem simples 2/3/4 eixos = 1/1,5/2.
"""
from __future__ import annotations
import csv, io, json, re, unicodedata
from bs4 import BeautifulSoup
from common import http_get, stable_id

LAYER_ID = 'pedagio'
SOURCE = 'antt'
CKAN = 'https://dados.antt.gov.br/api/3/action/package_show?id=praca-de-pedagio'
LIST_URL = 'https://www.gov.br/antt/pt-br/assuntos/rodovias/concessionarias/lista-de-concessoes'
SOURCE_URL = 'https://dados.antt.gov.br/dataset/praca-de-pedagio + https://www.gov.br/antt/pt-br/assuntos/rodovias/concessionarias/lista-de-concessoes/<concessao>/tarifas-de-pedagio'
LICENSE = 'CC-BY (dados.antt.gov.br) para as praças; tarifas: páginas gov.br/antt (conteúdo público, sem licença explícita)'
NOTES = ''

# nome da concessionária no CKAN -> slug da página de tarifas (conferido na lista de concessões da ANTT em 10/2026)
SLUG = {
    'RIOSP': 'ccr-rio-sp', 'AUTOPISTA REGIS BITTENCOURT': 'autopista-regis-bittencourt', 'MOTIVA MINAS SP': 'motiva-minas-sp',
    'TRANSBRASILIANA': 'Transbrasiliana', 'AUTOPISTA FLUMINENSE': 'autopista-fluminense', 'AUTOPISTA LITORAL SUL': 'autopista-litoral-sul',
    'AUTOPISTA PLANALTO SUL': 'autopista-planalto-sul', 'CONCEBRA': 'concebra', 'CONCER': 'concer', 'ECOSUL': 'ecosul-contrato-encerrado',
    'ECOVIAS PONTE': 'ecoponte', 'ECOVIAS DO ARAGUAIA': 'ecovias-araguaia', 'ECOVIAS CAPIXABA': 'ecovias-capixaba',
    'ECOVIAS DO CERRADO': 'ecovias-do-cerrado', 'ECOVIAS RIO MINAS': 'ecoriominas', 'ECOVIAS MINAS GOIÁS': 'eco050', 'ELOVIAS': 'elovias',
    'EPR IGUAÇU': 'epr-iguacu', 'LITORAL PIONEIRO': 'epr-litoral-pioneiro', 'EPR PARANÁ': 'epr-parana', 'EPR VIA MINEIRA': 'epr-via-mineira',
    'PANTANAL': 'motiva-pantanal', 'NOVA 364': 'nova-364', 'NOVA 381': 'nova-381', 'RODOVIA DO AÇO': 'rodovia-do-aco-caducidade-declarada',
    'NOVA ROTA DO OESTE': 'rota-do-oeste', 'ROTA VERDE GOIÁS': 'rota-verde-goias', 'VIA BRASIL': 'via-brasil', 'VIA ARAUCÁRIA': 'via-araucaria',
    'VIA SUL': 'viasul', 'VIA COSTEIRA': 'ccr-viacosteira', 'VIA CAMPO': 'via-campos', 'VIA CRISTAIS': 'via-cristais', 'WAY 262': 'way-262',
}
STOP = {'em', 'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'sp', 'rj', 'mg', 'es', 'pr', 'sc', 'rs', 'go', 'ms', 'mt', 'ba', 'df', 'to',
        'norte', 'sul', 'leste', 'oeste', 'praca', 'pedagio', 'pracas', 'km', 'br', 'na', 'no'}


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def tokens(s: str) -> set[str]:
    return {t for t in norm(s).split() if len(t) >= 3 and t not in STOP and not t.isdigit()}


def num(s: str) -> float | None:
    s = (s or '').strip().replace('R$', '').strip()
    if not re.match(r'^\d+(?:\.\d{3})*(?:,\d+)?$|^\d+(?:\.\d+)?$', s):
        return None
    return float(s.replace('.', '').replace(',', '.')) if ',' in s else float(s)


def rodovia(s: str) -> str | None:
    m = re.match(r'(?i)^\s*BR\s*-?\s*0*(\d+)', s or '')
    return f'BR-{int(m.group(1)):03d}' if m else (s or None)


def parse_tariff_page(html: str) -> dict:
    """Devolve {'data': 'YYYY-MM-DD'|None, 'tables': [{'desc': str, 'cols': [nomes], 'rows': [{cat,eixos,rodagem,mult,valores}]}]}"""
    soup = BeautifulSoup(html, 'lxml')
    out: dict = {'data': None, 'tables': []}
    mod = soup.select_one('.documentModified .value')
    if mod:
        m = re.search(r'(\d{2})/(\d{2})/(\d{4})', mod.get_text())
        if m:
            out['data'] = f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    core = soup.select_one('#content-core') or soup
    text_before = ''
    for el in core.descendants:
        if getattr(el, 'name', None) == 'table':
            rows = []
            for tr in el.find_all('tr'):
                rows.append([re.sub(r'\s+', ' ', td.get_text(' ')).strip() for td in tr.find_all(['td', 'th'])])
            if not any('ultiplicador' in ' '.join(r) or 'Categoria' in ' '.join(r) for r in rows):
                continue
            cols: list[str] = []
            data = []
            for r in rows:
                if any(re.match(r'(?i)^(pra[cç]a\s*\d+|p\s*\d+\s*fds|p\d+)$', c) for c in r):
                    cols = [c for c in r if c]
                    continue
                if r and re.match(r'^\d{1,2}$', r[0]) and len(r) >= 6:
                    vals = [num(c) for c in r[5:]]
                    eixos = int(r[2]) if r[2].isdigit() else None
                    rod = 'dupla' if 'dupla' in r[3].lower() else 'simples' if 'simples' in r[3].lower() else None
                    data.append({'cat': int(r[0]), 'tipo': r[1], 'eixos': eixos, 'rodagem': rod, 'mult': num(r[4]), 'valores': vals})
            if data:
                out['tables'].append({'desc': text_before[-600:], 'cols': cols or ['todas'], 'rows': data})
            text_before = ''
        elif isinstance(el, str) and el.find_parent('table') is None:
            text_before += ' ' + el
    if not out['data']:
        m = re.search(r'(?i)atualizad[oa] em (\d{2})/(\d{2})/(\d{4})', core.get_text(' '))
        if m:
            out['data'] = f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    return out


def plaza_index_map(desc: str) -> dict[int, set[str]]:
    """'P1, em Arujá/SP, P2, em cabines avançadas de Arujá (rodoanel); P3, ...' -> {1: {'aruja'}, 2: {...}}"""
    parts = re.split(r'\bP\s?(\d{1,2})\b', desc)
    out: dict[int, set[str]] = {}
    for i in range(1, len(parts) - 1, 2):
        out[int(parts[i])] = tokens(parts[i + 1])
    return out


def plaza_index(name: str, idx_map: dict[int, set[str]]) -> int | None:
    m = re.match(r'(?i)^\s*(?:p|pra[cç]a)?\s*0*(\d{1,2})\b', name or '')
    if m:
        return int(m.group(1))
    tk = tokens(name)
    best, best_n = None, 0
    for i in sorted(idx_map):
        n = len(tk & idx_map[i])
        if n > best_n:
            best, best_n = i, n
    return best


def tariff_for(page: dict, plaza_name: str) -> dict | None:
    if not page or not page['tables']:
        return None
    # tabela cujo cabeçalho/descrição melhor casa com a praça (há páginas com mais de uma tabela)
    tables = page['tables']
    tk = tokens(plaza_name)
    tab = max(tables, key=lambda t: len(tk & tokens(t['desc']))) if len(tables) > 1 else tables[0]
    cols = tab['cols']
    ncols = max(len(r['valores']) for r in tab['rows'])
    col, col_fds = 0, None
    if ncols > 1 and len(cols) >= ncols:
        idx = plaza_index(plaza_name, plaza_index_map(tab['desc']))
        if idx is None:
            return None
        names = [norm(c) for c in cols[:ncols]]
        try:
            col = names.index(f'praca {idx}')
        except ValueError:
            if idx - 1 < ncols:
                col = idx - 1
            else:
                return None
        if f'p{idx} fds' in names:
            col_fds = names.index(f'p{idx} fds')
    cats = []
    for r in tab['rows']:
        v = r['valores'][col] if col < len(r['valores']) else None
        if v is None or r['eixos'] is None or r['mult'] is None or r['mult'] < 1:
            continue  # motos/isentos/linhas sem valor
        c = {'cat': r['cat'], 'eixos': r['eixos'], 'rodagem': r['rodagem'], 'mult': r['mult'], 'valor': v}
        if col_fds is not None and col_fds < len(r['valores']) and r['valores'][col_fds] is not None:
            c['valor_fds'] = r['valores'][col_fds]
        cats.append(c)
    if not cats:
        return None
    base = next((c['valor'] / c['mult'] for c in cats if c['mult'] == 1), cats[0]['valor'] / cats[0]['mult'])
    return {'modelo': 'categorias', 'base': round(base, 4), 'categorias': cats, 'max_eixos_tabela': max(c['eixos'] for c in cats)}


def display_name(name: str, municipio: str) -> str:
    """'P 01' -> 'P 01 (Onda Verde)'; '1 Norte (Mairiporã)' fica como está."""
    if not re.match(r'(?i)^p?\s*\d', name) or norm(municipio) in norm(name):
        return name
    return f'{name} ({municipio})'


def fetch():
    global NOTES
    pkg = json.loads(http_get(CKAN, cache='antt_praca_pkg.json', max_age_h=24))['result']
    res = next(r for r in pkg['resources'] if (r.get('format') or '').upper() == 'CSV')
    raw = http_get(res['url'], cache='antt_praca.csv', max_age_h=24)
    try:
        txt = raw.decode('utf-8')
    except UnicodeDecodeError:
        txt = raw.decode('latin1')
    rows = list(csv.DictReader(io.StringIO(txt), delimiter=';'))
    pages: dict[str, dict | None] = {}
    for conc in sorted({r['concessionaria'].strip() for r in rows}):
        slug = SLUG.get(conc)
        if not slug:
            pages[conc] = None
            continue
        url = f'{LIST_URL}/{slug}/tarifas-de-pedagio'
        try:
            p = parse_tariff_page(http_get(url, cache=f'antt_tarifa_{slug}.html', max_age_h=24 * 3, timeout=60).decode('utf-8', 'replace'))
            p['url'] = url
            pages[conc] = p
        except Exception as e:  # 404 e afins: fica sem tarifa oficial (OSM cobre)
            print(f'  ! sem página de tarifa para {conc}: {e}')
            pages[conc] = None
    out, seen_ff = [], set()
    with_tariff = 0
    for r in rows:
        if (r.get('situacao') or '').strip().lower() != 'ativo':
            continue
        try:
            lat, lon = float(r['latitude'].replace(',', '.')), float(r['longitude'].replace(',', '.'))
        except (ValueError, KeyError):
            continue
        conc, name = r['concessionaria'].strip(), r['praca_de_pedagio'].strip()
        decimals = min(len((r['latitude'].split('.') + [''])[1]), len((r['longitude'].split('.') + [''])[1]))
        sentido = (r.get('sentido') or '').strip().lower()
        is_ff = 'free flow' in name.lower()
        props = {
            'operador': conc, 'rodovia': rodovia(r.get('rodovia')), 'km': num(r.get('km_m') or ''), 'uf': r.get('uf'),
            'municipio': r.get('municipal') or r.get('municipio'), 'sentido': sentido.replace('/', '+') or None,
            'cobranca': 'bidirecional' if '/' in sentido else 'unidirecional' if sentido else None,
            'coord_precisao_m': 1000 if decimals <= 2 else 100 if decimals == 3 else 10,
            'free_flow': is_ff, 'tarifa': None,
        }
        if is_ff:
            # 'Free Flow PFE004 - PFS003 Sul' -> um ponto por pórtico de entrada; tarifa por par entrada/saída não é publicada
            m = re.search(r'(P[FP][EF]\d+)\s*(?:Sul|Norte)?\s*-\s*(\S+)', name)
            ent = m.group(1) if m else name
            key = (conc, ent, round(lat, 5), round(lon, 5))
            if key in seen_ff:
                continue
            seen_ff.add(key)
            props['saidas'] = sorted({re.search(r'-\s*(\S+)', x['praca_de_pedagio']).group(1) for x in rows
                                      if x['concessionaria'].strip() == conc and ent in x['praca_de_pedagio'] and '-' in x['praca_de_pedagio']})
            out.append({'source_id': stable_id(conc, ent, lat, lon), 'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                        'name': f'Free flow {ent} ({conc})', 'kind': 'portico', 'props': props})
            continue
        page = pages.get(conc)
        t = tariff_for(page, name) if page else None
        if t:
            t.update({'fonte': 'ANTT', 'data': page.get('data'), 'url': page.get('url')})
            props['tarifa'] = t
            with_tariff += 1
        out.append({'source_id': stable_id(conc, name, r.get('rodovia'), r.get('km_m'), sentido),
                    'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                    'name': display_name(name, r.get('municipal') or r.get('municipio') or conc),
                    'kind': 'praca', 'props': props})
    NOTES = f'{len(out)} pontos ({with_tariff} com tarifa oficial ANTT); CKAN atualizado em {pkg.get("metadata_modified", "")[:10]}.'
    return out
