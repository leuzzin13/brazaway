"""Praças de pedágio das rodovias FEDERAIS concedidas (ANTT) + tarifas por categoria/eixo.

- Praças: dataset CKAN `praca-de-pedagio` (dados.antt.gov.br, CC-BY): concessionária, praça, rodovia, km, sentido, lat/lon.
  Não traz tarifa. As 89 linhas de free flow (pares entrada/saída da Dutra) viram um ponto por pórtico de entrada.
- Tarifas: página "tarifas-de-pedagio" de cada concessão em gov.br/antt (tabela HTML: categoria, eixos, rodagem,
  multiplicador e valor por praça; algumas com coluna de fim de semana "FDS"). Guardamos a data "Atualizado em" da página.
  Regra das tabelas ANTT: veículo comercial de rodagem dupla paga multiplicador = nº de eixos; rodagem simples 2/3/4 eixos = 1/1,5/2.
- Pórtico de free flow de ponto único (ex.: RIOSP "Free Flow Paraty" = coluna P8; Motiva Paraná "FREE FLOW P2 MAUÁ DA
  SERRA" = coluna P2) recebe a tarifa da sua coluna. Os pares entrada/saída da Dutra (PFE…/PFS…) não têm tarifa publicada.
- Concessões em que a cobrança parou mas cujas praças o CKAN ainda lista como "Ativo" (COBRANCA_SUSPENSA) ficam com
  `cobranca_suspensa` e sem tarifa: a API não cobra nem usa o valor do OSM nelas.
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
LICENSE = 'Praças: CC-BY (dados.antt.gov.br). Tarifas: páginas gov.br/antt, CC BY-ND 3.0 (rodapé gov.br)'
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
    # slugs que não seguem o nome (títulos conferidos em 09/10/2026): "Motiva Paraná" = pr-vias; "Way-153" = rota-sertaneja
    'MOTIVA PARANÁ': 'pr-vias', 'WAY 153': 'rota-sertaneja',
}
# Cobrança encerrada/suspensa (as praças seguem "Ativo" no CKAN). Conferido em 09/10/2026.
COBRANCA_SUSPENSA = {
    'ECOSUL': {
        'desde': '2026-03-04',
        'motivo': 'fim do contrato de concessão do Polo de Pelotas (03/03/2026); o DNIT administra a BR-116/BR-392 sem '
                  'pedágio até a nova concessão',
        'fonte': f'{LIST_URL}/ecosul-contrato-encerrado',
    },
    'RODOVIA DO AÇO': {
        'desde': '2025-06-10',
        'motivo': 'caducidade da concessão da K-Infra Rodovia do Aço (Decreto 12.479/2025, art. 1º; Lei 8.987/1995, art. 38); '
                  'o DNIT administra a BR-393/RJ sem pedágio (há disputa judicial: confira se a cobrança voltou)',
        'fonte': 'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2025/decreto/D12479.htm',
    },
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


HDR_RE = re.compile(r'^(?:p|praca)\s*0*(\d{1,2})(\s*fds)?$')


def col_key(header: str) -> tuple[int, bool] | None:
    """Cabeçalho de coluna de valor -> (nº da praça, é fim de semana). Aceita 'P1', 'P01', 'P 1', 'Praça 1', 'P8 FDS'."""
    m = HDR_RE.match(norm(header))
    return (int(m.group(1)), bool(m.group(2))) if m else None


def _core(soup):
    return soup.select_one('#content-core') or soup


def subpage_links(html: str, url: str, want: str) -> list[str]:
    """Abas ('Carregando conteúdo da aba', atributo data-url) e itens de pasta da página `url` cujo endereço contém
    `want` (ex.: 'tarifas-de-pedag', 'localizacao-das-pracas'). Ignora links de compartilhamento."""
    soup = BeautifulSoup(html, 'lxml')
    out: list[str] = []
    for el in soup.find_all(attrs={'data-url': True}):
        out.append(el['data-url'])
    for a in _core(soup).find_all('a', href=True):
        out.append(a['href'])
    seen, res = set(), []
    for u in out:
        u = u.split('?')[0].split('#')[0].rstrip('/')
        if not u.startswith('https://www.gov.br/antt/') or want not in u or u == url.rstrip('/') or u in seen:
            continue
        if re.search(r'/view$|\.(pdf|xlsx?|jpg|png)$', u, re.I):
            continue
        seen.add(u)
        res.append(u)
    return res


def parse_tariff_page(html: str) -> dict:
    """Devolve {'data': 'YYYY-MM-DD'|None, 'tables': [{'desc': str, 'cols': [cabeçalhos das colunas de valor], 'rows': [...]}]}"""
    soup = BeautifulSoup(html, 'lxml')
    out: dict = {'data': None, 'tables': []}
    # "Atualizado em" (documentModified); sem ele, "Publicado em" (documentPublished)
    for sel in ('.documentModified .value', '.documentPublished .value'):
        mod = soup.select_one(sel)
        m = re.search(r'(\d{2})/(\d{2})/(\d{4})', mod.get_text()) if mod else None
        if m:
            out['data'] = f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
            break
    core = _core(soup)
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
                hdr = [c for c in r if col_key(c)]
                if hdr:
                    cols = hdr  # só os cabeçalhos das colunas de valor (alinhados com r[5:] das linhas de dados)
                    continue
                if r and re.match(r'^\d{1,2}$', r[0]) and len(r) >= 6:
                    vals = [num(c) for c in r[5:]]
                    eixos = int(r[2]) if r[2].isdigit() else None
                    rod = 'dupla' if 'dupla' in r[3].lower() else 'simples' if 'simples' in r[3].lower() else None
                    data.append({'cat': int(r[0]), 'tipo': r[1], 'eixos': eixos, 'rodagem': rod, 'mult': num(r[4]), 'valores': vals})
            if data:
                desc = text_before[-600:]
                vm = re.search(r'(?i)a partir de (\d{2})/(\d{2})/(\d{4})', desc)
                out['tables'].append({'desc': desc, 'cols': cols, 'rows': data,
                                      'vigencia_inicio': f'{vm.group(3)}-{vm.group(2)}-{vm.group(1)}' if vm else None})
            text_before = ''
        elif isinstance(el, str) and el.find_parent('table') is None:
            text_before += ' ' + el
    if not out['data']:
        m = re.search(r'(?i)atualizad[oa] em (\d{2})/(\d{2})/(\d{4})', core.get_text(' '))
        if m:
            out['data'] = f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    return out


def parse_km(s: str) -> float | None:
    """'204+200' -> 204.2; '60,25' -> 60.25; '180+700 (crescente) 182+800 (decrescente)' -> 180.7."""
    m = re.search(r'(\d{1,4})\s*\+\s*(\d{1,3})', s or '')
    if m:
        return int(m.group(1)) + int(m.group(2).ljust(3, '0')) / 1000
    m = re.search(r'\d{1,4}(?:[.,]\d+)?', s or '')
    return float(m.group(0).replace(',', '.')) if m else None


def parse_location_page(html: str) -> list[dict]:
    """Tabela 'Localização das praças de pedágio' -> [{'idx', 'nome', 'rodovia', 'km'}] (nº da praça = coluna P# do
    quadro de tarifas). Ex.: 'P05 - UBERABA | BR-50 | MG | 104,98 | Uberaba ...' ou 'P01 | 204+200 | Arujá | BR116 | SP'."""
    soup = BeautifulSoup(html, 'lxml')
    out: list[dict] = []
    for tb in _core(soup).find_all('table'):
        hdr: dict[str, int] = {}
        for tr in tb.find_all('tr'):
            cells = [re.sub(r'\s+', ' ', td.get_text(' ')).strip() for td in tr.find_all(['td', 'th'])]
            nc = [norm(c) for c in cells]
            if not hdr and any('praca' in c for c in nc) and any(c.startswith('km') for c in nc):
                for i, c in enumerate(nc):
                    for key in ('praca', 'rodovia', 'municipio'):
                        if key in c and key not in hdr:
                            hdr[key] = i
                    if c.startswith('km') and 'km' not in hdr:
                        hdr['km'] = i
                continue
            if not hdr or len(cells) <= hdr.get('praca', 0):
                continue
            m = re.match(r'(?i)^p(?:ra[cç]a)?\s*0*(\d{1,2})\b\s*[-–]?\s*(.*)$', cells[hdr['praca']])
            if not m:
                continue
            get = lambda k: cells[hdr[k]] if k in hdr and hdr[k] < len(cells) else ''
            nome = m.group(2).strip(' *') or get('municipio')
            out.append({'idx': int(m.group(1)), 'nome': nome, 'municipio': get('municipio'),
                        'rodovia': get('rodovia') or None, 'km': parse_km(get('km'))})
    return out


def _rod_num(s: str | None) -> str | None:
    m = re.search(r'(\d{2,3})', s or '')
    return str(int(m.group(1))) if m else None


def plaza_index_map(desc: str) -> dict[int, set[str]]:
    """'P1, em Arujá/SP, P2, em cabines avançadas de Arujá (rodoanel); P3, ...' -> {1: {'aruja'}, 2: {...}}"""
    parts = re.split(r'\bP\s?(\d{1,2})\b', desc)
    out: dict[int, set[str]] = {}
    for i in range(1, len(parts) - 1, 2):
        out[int(parts[i])] = tokens(parts[i + 1])
    return out


def plaza_index(name: str, idx_map: dict[int, set[str]], loc: list[dict] | None = None,
                rod: str | None = None, km: float | None = None) -> int | None:
    """Nº da praça (coluna P# do quadro de tarifas): 1) número no próprio nome do CKAN ('P05 CARAMBEÍ', 'Praça 04 - Luz');
    2) página de localização das praças (mesma rodovia e km a até 1,5 km, ou nome igual); 3) texto acima do quadro."""
    m = re.match(r'(?i)^\s*(?:p|pra[cç]a)?\s*0*(\d{1,2})\b', name or '') or re.search(r'(?i)\bp\s?0*(\d{1,2})\b', name or '')
    if m:
        return int(m.group(1))
    tk = tokens(name)
    # candidatos: localização (nome e/ou rodovia+km) e texto acima do quadro (nome); vence a maior pontuação
    best, best_s = None, 0.0
    for e in loc or []:
        if rod and e['rodovia'] and _rod_num(rod) != _rod_num(e['rodovia']):
            continue
        ov = len(tk & tokens(f"{e['nome']} {e['municipio']}"))
        dkm = abs(km - e['km']) if km is not None and e['km'] is not None else None
        if ov == 0 and (dkm is None or dkm > 1.5):
            continue
        sc = ov * 10 + (5 - min(dkm, 5) if dkm is not None else 0)
        if sc > best_s:
            best, best_s = e['idx'], sc
    for i in sorted(idx_map):
        sc = len(tk & idx_map[i]) * 10
        if sc > best_s:
            best, best_s = i, sc
    return best


def numbering_ok(page: dict, idxs: list[int | None]) -> bool:
    """A numeração das praças no CKAN bate com a do quadro? (Via Campo: CKAN P01–P03, quadro P3–P5.) Se algum nº do CKAN
    não existe no cabeçalho de um quadro com várias colunas, a numeração não é confiável para essa concessão."""
    if not page or not page['tables']:
        return False
    tab = page['tables'][0]
    keys = [col_key(c) for c in tab['cols']]
    reg = {k[0] for k in keys if k and not k[1]}
    if len(reg) <= 1:
        return True
    return all(i is None or i in reg for i in idxs)


def tariff_for(page: dict, plaza_name: str, idx: int | None = None) -> dict | None:
    """Tarifa de uma praça. A coluna é achada pelo NOME do cabeçalho ('P5', 'P05', 'Praça 5'), nunca pela posição:
    há quadros que pulam números (EPR Litoral Pioneiro: P1, P2, P3, P5, …). Sem nº da praça, só serve um quadro de
    coluna única ou com todas as colunas iguais em todas as linhas."""
    if not page or not page['tables']:
        return None
    tables = page['tables']
    tk = tokens(plaza_name)
    tab = max(tables, key=lambda t: len(tk & tokens(t['desc']))) if len(tables) > 1 else tables[0]
    rows = tab['rows']
    ncols = max(len(r['valores']) for r in rows)
    keys = [col_key(c) for c in tab['cols']] if len(tab['cols']) == ncols else None
    regular = [i for i, k in enumerate(keys) if k and not k[1]] if keys else list(range(ncols))
    has_fds = bool(keys) and any(k and k[1] for k in keys)

    def all_equal(cols: list[int]) -> bool:
        for r in rows:
            vs = {r['valores'][i] for i in cols if i < len(r['valores']) and r['valores'][i] is not None}
            if len(vs) > 1:
                return False
        return True

    col, col_fds, header = 0, None, (tab['cols'][0] if tab['cols'] else 'única')
    if ncols > 1:
        if keys and idx is not None and (idx, False) in keys:
            col = keys.index((idx, False))
            col_fds = keys.index((idx, True)) if (idx, True) in keys else None
            header = tab['cols'][col]
        elif not has_fds and all_equal(regular):
            col, header = regular[0] if regular else 0, 'todas as praças (mesmo valor)'
        else:
            return None
    cats = []
    for r in rows:
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
    return {'modelo': 'categorias', 'base': round(base, 4), 'categorias': cats, 'coluna': header,
            'min_eixos_tabela': min(c['eixos'] for c in cats), 'max_eixos_tabela': max(c['eixos'] for c in cats),
            'vigencia_inicio': tab.get('vigencia_inicio'), 'vigencia_fim': None}


def _try_get(url: str, cache: str) -> bytes | None:
    try:
        return http_get(url, cache=cache, max_age_h=24 * 3, timeout=60)
    except Exception:
        return None


def _cache_name(url: str) -> str:
    tail = url.split('/lista-de-concessoes/', 1)[-1].strip('/').replace('/', '__')
    return f'antt_{tail}.html'


def load_concession(slug: str) -> tuple[dict | None, list[dict], list[str]]:
    """Quadro de tarifas e localização das praças de uma concessão. Caminhos que variam entre concessões:
    '<slug>/tarifas-de-pedagio' (padrão), '<slug>/tarifas-de-pedagios', '<slug>/revisoes-e-reajustes/tarifas-de-pedagio',
    abas com data-url ('<slug>/tarifas-de-pedagio/tarifas-de-pedagio', às vezes aninhadas) e pastas com um item.
    Devolve (página com quadros | None, linhas de localização, URLs tentadas)."""
    base = f'{LIST_URL}/{slug}'
    tried: list[str] = []
    loc_urls: list[str] = []

    def load(url: str, depth: int = 0) -> dict | None:
        if url in tried or depth > 3:
            return None
        tried.append(url)
        raw = _try_get(url, 'antt_tarifa_' + slug + '.html' if url == f'{base}/tarifas-de-pedagio' else _cache_name(url))
        if raw is None:
            return None
        html = raw.decode('utf-8', 'replace')
        loc_urls.extend(subpage_links(html, url, 'localizacao-das-pracas'))
        p = parse_tariff_page(html)
        if p['tables']:
            p['url'] = url
            return p
        for sub in subpage_links(html, url, 'tarifas-de-pedag'):
            if sub.startswith(url.rstrip('/') + '/'):  # aba/item DENTRO desta página
                q = load(sub, depth + 1)
                if q:
                    return q
        return None

    page = load(f'{base}/tarifas-de-pedagio')
    base_html = None
    if not page or not loc_urls:
        raw = _try_get(base, _cache_name(base))
        base_html = raw.decode('utf-8', 'replace') if raw else None
    if not page and base_html:
        for u in subpage_links(base_html, base, 'tarifas-de-pedag'):
            if u.startswith(base + '/') and 'revisao-e-reajuste' not in u and (page := load(u)):
                break
    if base_html:
        loc_urls.extend(subpage_links(base_html, base, 'localizacao-das-pracas'))
    loc: list[dict] = []
    for u in dict.fromkeys(loc_urls):
        if not u.startswith(base + '/'):
            continue
        raw = _try_get(u, _cache_name(u))
        if raw and (loc := parse_location_page(raw.decode('utf-8', 'replace'))):
            break
    return page, loc, tried


FF_PAIR_RE = re.compile(r'(P[FP][EF]\d+)\s*(?:Sul|Norte)?\s*-\s*(\S+)')


def free_flow_entry(name: str) -> str | None:
    """Pórtico de entrada de um par entrada/saída ('Free Flow PFE004 - PFS003 Sul' -> 'PFE004'). None = pórtico de
    ponto único ('Free Flow Paraty', 'FREE FLOW P2 MAUÁ DA SERRA'), que tem coluna própria no quadro de tarifas."""
    m = FF_PAIR_RE.search(name or '') or re.match(r'.*\b(P[FP][EF]\d+)\b', name or '')
    return m.group(1) if m else None


def single_gantry_tariff(page: dict, name: str, loc: list[dict] | None, rod: str | None, km: float | None,
                         trusted: bool) -> dict | None:
    """Tarifa de um pórtico de free flow de ponto único: a coluna dele no quadro, achada como a de uma praça
    (nº no nome, página de localização ou texto acima do quadro), sem as palavras "free flow"."""
    idx = plaza_index(re.sub(r'(?i)\bfree\s*flow\b', ' ', name), plaza_index_map(page['tables'][0]['desc']), loc, rod, km)
    return tariff_for(page, name, idx if trusted else None)


def same_place(pa: dict, ga: list[float], pb: dict, gb: list[float]) -> bool:
    """Duas linhas do CKAN são a mesma praça (troca de concessionária)? Mesma rodovia e: km a até 3 (com coordenadas a
    até ~3 km) ou, com coordenadas precisas, a até ~150 m mesmo com referência de km diferente (RIOSP "Viúva Graça
    Norte" km 207,1 = ECOVIAS RIO MINAS "P04 Viúva Graça" km 211,7, a 20 m)."""
    if _rod_num(pa['rodovia']) != _rod_num(pb['rodovia']):
        return False
    dx, dy = abs(ga[0] - gb[0]), abs(ga[1] - gb[1])
    near_km = pa['km'] is not None and pb['km'] is not None and abs(pa['km'] - pb['km']) <= 3 and dx <= 0.03 and dy <= 0.03
    precise = max(pa.get('coord_precisao_m') or 1000, pb.get('coord_precisao_m') or 1000) <= 100
    return near_km or (precise and dx <= 0.0015 and dy <= 0.0015)


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
    locs: dict[str, list[dict]] = {}
    sem_pagina: list[str] = []
    for conc in sorted({r['concessionaria'].strip() for r in rows}):
        slug = SLUG.get(conc)
        if conc in COBRANCA_SUSPENSA:
            pages[conc] = None
            continue
        if not slug:
            pages[conc] = None
            sem_pagina.append(f'{conc} (sem slug)')
            continue
        page, loc, tried = load_concession(slug)
        pages[conc], locs[conc] = page, loc
        if not page:
            sem_pagina.append(conc)
            print(f'  ! sem quadro de tarifas para {conc} (tentado: {", ".join(u.rsplit(slug, 1)[-1] or "/" for u in tried)})')
    # numeração do CKAN x cabeçalho do quadro, por concessão
    trust: dict[str, bool] = {}
    for conc, page in pages.items():
        if page:
            idxs = [plaza_index(x['praca_de_pedagio'].strip(), plaza_index_map(page['tables'][0]['desc']), locs.get(conc), x.get('rodovia'),
                                num(x.get('km_m') or '')) for x in rows if x['concessionaria'].strip() == conc and 'free flow' not in x['praca_de_pedagio'].lower()]
            trust[conc] = numbering_ok(page, idxs)
            if not trust[conc]:
                print(f'  ! {conc}: numeração das praças no CKAN não bate com o quadro de tarifas; só vale valor igual em todas as colunas')
    out, seen_ff = [], set()
    with_tariff = 0
    no_col: list[str] = []
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
        if conc in COBRANCA_SUSPENSA:
            props['cobranca_suspensa'] = COBRANCA_SUSPENSA[conc]
        if is_ff:
            # 'Free Flow PFE004 - PFS003 Sul' -> um ponto por pórtico de entrada; tarifa por par entrada/saída não é publicada
            ent_pair = free_flow_entry(name)
            ent = ent_pair or name
            key = (conc, ent, round(lat, 5), round(lon, 5))
            if key in seen_ff:
                continue
            seen_ff.add(key)
            page = pages.get(conc)
            if ent_pair:
                props['tipo_free_flow'] = 'entrada_saida'
                props['saidas'] = sorted({re.search(r'-\s*(\S+)', x['praca_de_pedagio']).group(1) for x in rows
                                          if x['concessionaria'].strip() == conc and ent in x['praca_de_pedagio'] and '-' in x['praca_de_pedagio']})
            else:
                props['tipo_free_flow'] = 'ponto_unico'
                if page:
                    # pórtico de ponto único: tarifa da coluna dele no quadro (RIOSP Paraty = P8; Motiva Paraná P2 Mauá da Serra)
                    t = single_gantry_tariff(page, name, locs.get(conc), r.get('rodovia'), props['km'], trust.get(conc, False))
                    if t:
                        t.update({'fonte': 'ANTT', 'data': page.get('data'), 'url': page.get('url')})
                        props['tarifa'] = t
                        with_tariff += 1
                    else:
                        no_col.append(f'{conc}: {name}')
            nome_ff = f'Free flow {ent} ({conc})' if ent_pair else (name if re.search(r'(?i)free\s*flow', name) else f'Free flow {name}')
            out.append({'source_id': stable_id(conc, ent, lat, lon), 'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                        'name': nome_ff, 'kind': 'portico', 'props': props})
            continue
        page = pages.get(conc)
        t = None
        if page:
            idx = plaza_index(name, plaza_index_map(page['tables'][0]['desc']), locs.get(conc), r.get('rodovia'), props['km'])
            t = tariff_for(page, name, idx if trust.get(conc) else None)
            if not t:
                no_col.append(f'{conc}: {name}')
        if t:
            t.update({'fonte': 'ANTT', 'data': page.get('data'), 'url': page.get('url')})
            props['tarifa'] = t
            with_tariff += 1
        out.append({'source_id': stable_id(conc, name, r.get('rodovia'), r.get('km_m'), sentido),
                    'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
                    'name': display_name(name, r.get('municipal') or r.get('municipio') or conc),
                    'kind': 'praca', 'props': props, '_ckan': f'{conc}: {name}'})
    # mesma praça listada por duas concessionárias (troca de contrato; ex.: CONCER -> ELOVIAS na BR-040, ambas "Ativo" no
    # CKAN): fica a de tabela mais recente
    dropped: list[str] = []
    pracas = [f for f in out if f['kind'] == 'praca']

    def tdate(f):
        t = f['props']['tarifa']
        return (1 if t else 0, (t or {}).get('data') or '')
    for a in pracas:
        for b in pracas:
            if a is b or a['props']['operador'] == b['props']['operador'] or a.get('_drop') or b.get('_drop'):
                continue
            if not same_place(a['props'], a['geometry']['coordinates'], b['props'], b['geometry']['coordinates']):
                continue
            (lo, hi) = (a, b) if tdate(a) < tdate(b) else (b, a)
            if tdate(lo) == tdate(hi):
                continue
            lo['_drop'] = True
            dropped.append(f"{lo['props']['operador']} {lo['name']} (substituída por {hi['props']['operador']} {hi['name']})")
    if dropped:
        print(f'  praças repetidas por troca de concessionária, mantida a de tabela mais recente: {"; ".join(dropped)}')
        with_tariff -= sum(1 for f in out if f.get('_drop') and f['props']['tarifa'])
        gone = {f.get('_ckan') for f in out if f.get('_drop')}
        no_col = [x for x in no_col if x not in gone]
        out = [f for f in out if not f.get('_drop')]
    for f in out:
        f.pop('_ckan', None)
        f.pop('_drop', None)
    if no_col:
        print(f'  ! {len(no_col)} praça(s) com quadro de tarifas mas sem coluna identificada: {"; ".join(no_col[:12])}')
    NOTES = (f'{len(out)} pontos ({with_tariff} com tarifa oficial ANTT); CKAN atualizado em {pkg.get("metadata_modified", "")[:10]}. '
             f'Sem quadro de tarifas: {", ".join(sem_pagina) or "nenhuma"}. Praças sem coluna identificada no quadro: {len(no_col)}. '
             f'Repetidas por troca de concessionária (descartadas): {len(dropped)}. '
             f'Cobrança suspensa (sem tarifa): {", ".join(sorted(COBRANCA_SUSPENSA))}.')
    return out
