"""Restrição de trânsito da PRF nos feriados (rodovias federais) — Portaria DIOP/PRF vigente, lida do DOU.

O que a portaria diz (2026: Portaria DIOP/PRF nº 121, de 08/09/2026, DOU 09/09/2026, ed. 170-A, Seção 1 Extra A, p. 1):
  art. 1º  proíbe, nas janelas do Anexo I, veículos/combinações cujo peso ou dimensão exceda: largura 2,60 m,
           altura 4,40 m, comprimento 19,80 m ou PBTC 58,5 t (passíveis ou não de AET/AE);
  § 1º     inclui CVC, CTV e CTVP mesmo com AET/AE;   § 2º  só trechos de PISTA SIMPLES, exceto AC/AM/AP/PA/RR;
  § 3º/4º  MS e RO só na Operação Fim de Ano;        § 5º  SP (N. Sra. Aparecida): também pista dupla na
           BR-116 km 0–231, BR-459 km 0–32 e BR-488 km 0–5, só para quem tem AET/AE (tabela própria, por datas).
O importador NÃO tem valores fixos: busca no DOU a portaria DIOP/PRF mais recente de "restrição do trânsito ... excedentes"
de cada ano, baixa o HTML, extrai do texto os limites do art. 1º, as UFs excluídas (§ 2º) e as tabelas do Anexo I.
Se a redação mudar e algum trecho não for reconhecido, o importador FALHA (melhor sem regra do que regra errada).

Saída: uma feição por janela (kind = 'janela'), com início/fim em valid_from/valid_to (horário de Brasília, -03:00).
A geometria é só a área de abrangência (envelope do Brasil); os trechos afetados são resolvidos na API a partir do SNV
(importador snv_dnit), pelo tipo de pista e por BR/UF/km.
"""
from __future__ import annotations
import json, os, re, unicodedata, urllib.parse
from datetime import date, datetime, timedelta
from bs4 import BeautifulSoup
from common import http_get, stable_id

LAYER_ID = 'rodovias_horario'
SOURCE = 'prf-dou'
SOURCE_URL = 'https://www.in.gov.br (DOU, Seção 1 — Portarias DIOP/PRF de restrição de trânsito em feriados)'
LICENSE = 'Ato oficial (DOU) — domínio público, Lei 9.610/98 art. 8º, IV. Fonte: Polícia Rodoviária Federal/Imprensa Nacional.'
SEARCH_PHRASE = '"restrição do trânsito de Veículos e Combinações de Veículos excedentes"'
TZ = '-03:00'   # horário de Brasília (sem horário de verão desde 2019)
BRASIL = {'type': 'Polygon', 'coordinates': [[[-74.0, -34.0], [-34.0, -34.0], [-34.0, 5.5], [-74.0, 5.5], [-74.0, -34.0]]]}
NOTES = None

UF_NOMES = {
    'ACRE': 'AC', 'ALAGOAS': 'AL', 'AMAPA': 'AP', 'AMAZONAS': 'AM', 'BAHIA': 'BA', 'CEARA': 'CE', 'DISTRITO FEDERAL': 'DF',
    'ESPIRITO SANTO': 'ES', 'GOIAS': 'GO', 'MARANHAO': 'MA', 'MATO GROSSO DO SUL': 'MS', 'MATO GROSSO': 'MT',
    'MINAS GERAIS': 'MG', 'PARAIBA': 'PB', 'PARANA': 'PR', 'PARA': 'PA', 'PERNAMBUCO': 'PE', 'PIAUI': 'PI',
    'RIO DE JANEIRO': 'RJ', 'RIO GRANDE DO NORTE': 'RN', 'RIO GRANDE DO SUL': 'RS', 'RONDONIA': 'RO', 'RORAIMA': 'RR',
    'SANTA CATARINA': 'SC', 'SAO PAULO': 'SP', 'SERGIPE': 'SE', 'TOCANTINS': 'TO',
}


def _norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', s).strip().upper()


def _ufs_in(text: str) -> list[str]:
    t = ' ' + _norm(text) + ' '
    out = []
    for nome in sorted(UF_NOMES, key=len, reverse=True):     # "MATO GROSSO DO SUL" antes de "MATO GROSSO", "PARAIBA" antes de "PARA"
        if re.search(rf'\b{nome}\b', t):
            out.append(UF_NOMES[nome])
            t = re.sub(rf'\b{nome}\b', ' ', t)
    return sorted(out)


# ------------------------------------------------------------------ DOU
def dou_search(q: str) -> list[dict]:
    url = 'https://www.in.gov.br/consulta/-/buscar/dou?' + urllib.parse.urlencode({'q': q, 's': 'todos', 'exactDate': 'all', 'sortType': '0'})
    html = http_get(url, cache='prf/dou_busca.html', max_age_h=12, headers={'User-Agent': 'Mozilla/5.0'}).decode('utf-8', 'ignore')
    m = re.search(r'<script id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        raise RuntimeError('busca do DOU mudou de formato (script de parâmetros não encontrado)')
    return json.loads(m.group(1)).get('jsonArray', [])


def candidates() -> list[dict]:
    """Portarias DIOP/PRF de restrição de feriados, da mais recente para a mais antiga."""
    forced = os.environ.get('PRF_PORTARIA_URL')
    if forced:
        return [{'url': forced, 'title': 'PRF_PORTARIA_URL', 'pub': None}]
    out = []
    for r in dou_search(SEARCH_PHRASE):
        title = re.sub('<[^>]+>', '', r.get('title', ''))
        if not _norm(title).startswith('PORTARIA DIOP/PRF'):
            continue      # portarias de superintendências (SPRF-xx) ficam fora: ver docs
        pub = datetime.strptime(r['pubDate'], '%d/%m/%Y').date()
        out.append({'url': 'https://www.in.gov.br/web/dou/-/' + r['urlTitle'], 'title': title, 'pub': pub, 'edition': r.get('pubName')})
    out.sort(key=lambda c: c['pub'], reverse=True)
    return out


def fetch_act(url: str) -> tuple[BeautifulSoup, dict]:
    slug = re.sub(r'[^a-z0-9]+', '_', url.lower())[-80:]
    html = http_get(url, cache=f'prf/{slug}.html', max_age_h=24 * 7, headers={'User-Agent': 'Mozilla/5.0'}).decode('utf-8', 'ignore')
    soup = BeautifulSoup(html, 'lxml')
    body = soup.select_one('div.texto-dou')
    if body is None:
        raise RuntimeError(f'texto da portaria não encontrado em {url}')
    def txt(sel):
        el = soup.select_one(sel)
        return el.get_text(' ', strip=True) if el else None
    sec = re.search(r'Seção:\s*([^|<]+?)\s*(?:\||Página|$)', soup.get_text(' ', strip=True))
    pag = txt('.secao-dou-data')
    meta = {'publicado_em': txt('.publicado-dou-data'), 'edicao': txt('.edicao-dou-data'),
            'secao': sec.group(1).strip() if sec else None, 'pagina': pag}
    return body, meta


# ------------------------------------------------------------------ parser do texto
def parse_act(body: BeautifulSoup, url: str, meta: dict) -> dict:
    paras = [p.get_text(' ', strip=True) for p in body.find_all('p', recursive=False)]
    text = '\n'.join(paras)
    titulo = next((p for p in paras if _norm(p).startswith('PORTARIA DIOP/PRF')), None)
    m = re.match(r'PORTARIA DIOP/PRF N[ºO°] ?(\d+),? DE (\d+)[º°]? DE (\w+) DE (\d{4})', _norm(titulo or ''))
    if not m:
        raise RuntimeError('título da portaria não reconhecido')
    numero, ano_ato = int(m.group(1)), int(m.group(4))
    ano = re.search(r'feriados do ano de (\d{4})', text)
    if not ano:
        raise RuntimeError('ementa sem "feriados do ano de AAAA"')
    ano = int(ano.group(1))

    # art. 1º: limites (lidos do texto, nada fixo)
    def lim(label, unit):
        mm = re.search(label + r'[^\d\n]{0,80}?([\d.,]*\d)\s*' + unit, text, re.I)
        if not mm:
            raise RuntimeError(f'limite "{label}" não encontrado no art. 1º')
        return _f(mm.group(1))
    limites = {
        'largura_m': lim(r'Largura máxima', 'metros'), 'altura_m': lim(r'Altura máxima', 'metros'),
        'comprimento_m': lim(r'Comprimento total', 'metros'), 'pbtc_t': lim(r'Peso Bruto Total Combinado', 'toneladas'),
    }
    if not re.search(r'abrange o trânsito de Combinações de Veículos de Carga \(CVC\).*ainda que autorizadas', text, re.S):
        raise RuntimeError('§ 1º (CVC/CTV/CTVP mesmo com AET/AE) não encontrado')
    mm = re.search(r'todos os trechos de pista simples nas rodovias federais, com exceção d(?:o|os) estados? (?:d[oae]s? )?(.+?), que não', text)
    if not mm:
        raise RuntimeError('§ 2º (pista simples / UFs excluídas) não encontrado')
    excluidas = _ufs_in(mm.group(1))
    so_fim_de_ano = []
    for uf_nome, uf in (('Mato Grosso do Sul', 'MS'), ('Rondônia', 'RO')):
        if re.search(rf'estado de {uf_nome}[^.]*?(circunscritas ao período da Operação Fim de Ano|somente no período da Operação Fim de Ano)', text, re.I):
            so_fim_de_ano.append(uf)
    revoga = re.search(r'Revoga-se a (PORTARIA [^,(]+(?:, DE [^(]+)?)', text, re.I)

    act = {
        'ato': f'Portaria DIOP/PRF nº {numero}/{ano_ato}', 'numero': numero, 'ano_ato': ano_ato, 'ano': ano, 'url': url,
        'dou': 'DOU ' + ', '.join(x for x in (meta.get('publicado_em'), meta.get('edicao') and f"ed. {meta['edicao']}",
                                                 meta.get('secao') and f"Seção {meta['secao']}", meta.get('pagina') and f"p. {meta['pagina']}") if x),
        'limites': limites, 'ufs_excluidas': excluidas,
        'ufs_so_fim_de_ano': so_fim_de_ano, 'revoga': revoga.group(1).strip() if revoga else None,
        'infracao': 'CTB art. 187, I (código 574-61)' if '574-61' in text else None,
    }

    # Anexo I: percorre <p> e <table> na ordem, guardando o contexto ("RESTRIÇÃO APLICÁVEL APENAS ...")
    windows, ctx_ufs, so_aet_note = [], None, False
    for el in body.find_all(['p', 'table'], recursive=False):
        if el.name == 'p':
            t = el.get_text(' ', strip=True)
            if _norm(t).startswith('RESTRICAO APLICAVEL APENAS'):
                ctx_ufs = _ufs_in(t.split('APENAS', 1)[-1] if 'APENAS' in t else t)
            elif re.search(r'se aplica apenas ao trânsito de veículos que possuam Autorização Especial', t, re.I):
                so_aet_note = True
                for w in windows:
                    if w['escopo'] == 'trechos' and w.get('uf') == 'SP':
                        w['so_aet'] = True
            continue
        rows = [[td.get_text(' ', strip=True) for td in tr.find_all('td')] for tr in el.find_all('tr')]
        rows = [r for r in rows if any(c for c in r)]
        if not rows:
            continue
        header = [_norm(c) for c in rows[0]]
        nacional = any(len(r) >= 4 and re.fullmatch(r'\d{2}/\d{2}/\d{4}', r[1].strip()) and re.match(r'\d{1,2}:\d{2}', r[3].strip()) for r in rows)
        if nacional:                       # tabela de janelas (nacional, ou só as UFs do contexto, ex.: Festejos Juninos)
            op = None
            for r in rows:
                if len(r) < 4 or _norm(r[1]) == 'DATA':
                    continue
                if r[0]:
                    op = r[0]
                d = re.fullmatch(r'(\d{2})/(\d{2})/(\d{4})', r[1].strip())
                h = re.fullmatch(r'(\d{1,2}):(\d{2})\s*(?:às|as|a)\s*(\d{1,2}):(\d{2})', r[3].strip(), re.I)
                if not d and not h:
                    continue
                if not (d and h):
                    raise RuntimeError(f'linha do Anexo I não reconhecida: {r}')
                day = date(int(d.group(3)), int(d.group(2)), int(d.group(1)))
                windows.append({
                    'operacao': op, 'escopo': 'pista_simples_federal', 'criterio': 'art1',
                    'inicio': _iso(day, h.group(1), h.group(2)), 'fim': _iso(day, h.group(3), h.group(4)),
                    'ufs': ctx_ufs, 'dia_semana': r[2],
                })
        elif header[:1] and 'DATA' in header and 'BR' in header and 'KM' in header:   # tabelas por trecho (SP, MS)
            op = rows[0][0] if rows[0][0] and _norm(rows[0][0]) != 'DATA' else None
            i_data, i_br, i_km, i_r = header.index('DATA'), header.index('BR'), header.index('KM'), header.index('RESTRICAO')
            uf = (ctx_ufs or [None])[0] if ctx_ufs and len(ctx_ufs) == 1 else None
            for r in rows[1:]:
                if len(r) <= max(i_data, i_br, i_km, i_r):
                    continue
                ds = re.findall(r'(\d{2})/(\d{2})/(\d{4})', r[i_data])
                km = re.fullmatch(r'([\d.,]+)\s*(?:a|ao|à|-)\s*([\d.,]+)', r[i_km].strip(), re.I)
                br = re.fullmatch(r'(?:BR-?)?(\d{2,3})', r[i_br].strip(), re.I)
                if not ds or not km or not br:
                    raise RuntimeError(f'linha de trecho não reconhecida: {r}')
                d0 = date(int(ds[0][2]), int(ds[0][1]), int(ds[0][0]))
                d1 = date(int(ds[-1][2]), int(ds[-1][1]), int(ds[-1][0]))
                rest = r[i_r]
                h = re.fullmatch(r'(\d{1,2}):(\d{2})\s*(?:às|as|a)\s*(\d{1,2}):(\d{2})', rest.strip(), re.I)
                larg = re.search(r'Acima de ([\d,]+)\s*m de largura', rest, re.I)
                if h:            # horário explícito (ex.: MS)
                    crit, ini, fim = 'art1', _iso(d0, h.group(1), h.group(2)), _iso(d1, h.group(3), h.group(4))
                elif larg:       # só largura acima de X m, o dia todo
                    crit, ini, fim = 'largura', _iso(d0, '00', '00'), _iso(d1 + timedelta(days=1), '00', '00')
                elif re.search(r'Todas as restrições do Art\. 1', rest, re.I):
                    crit, ini, fim = 'art1', _iso(d0, '00', '00'), _iso(d1 + timedelta(days=1), '00', '00')
                else:
                    raise RuntimeError(f'restrição de trecho não reconhecida: {rest!r}')
                windows.append({
                    'operacao': op or 'TRECHO ESPECÍFICO', 'escopo': 'trechos', 'criterio': crit, 'uf': uf,
                    'largura_min_m': float(larg.group(1).replace(',', '.')) if larg else None,
                    'inicio': ini, 'fim': fim, 'ufs': [uf] if uf else ctx_ufs,
                    'trechos': [{'br': f'{int(br.group(1)):03d}', 'uf': uf, 'km_ini': _f(km.group(1)), 'km_fim': _f(km.group(2))}],
                    'horario_na_tabela': bool(h), 'texto_restricao': rest,
                })
    if not windows:
        raise RuntimeError('nenhuma janela extraída do Anexo I')
    if not any(w['escopo'] == 'pista_simples_federal' for w in windows):
        raise RuntimeError('tabela nacional do Anexo I não reconhecida')
    act['so_aet_trechos_sp'] = so_aet_note
    return {'act': act, 'windows': windows}


def _titulo(s: str) -> str:
    pequenas = {'de', 'da', 'do', 'das', 'dos', 'e'}
    ws = re.sub(r'\s+', ' ', s.strip()).lower().split(' ')
    return ' '.join(w if (i and w in pequenas) else w[:1].upper() + w[1:] for i, w in enumerate(ws))


def _f(s: str) -> float:
    return float(s.replace('.', '').replace(',', '.')) if re.search(r'\d\.\d{3}', s) else float(s.replace(',', '.'))


def _iso(d: date, hh, mm) -> str:
    hh, mm = int(hh), int(mm)
    if hh == 24:
        d, hh = d + timedelta(days=1), 0
    return f'{d.isoformat()}T{hh:02d}:{mm:02d}:00{TZ}'


# ------------------------------------------------------------------ saída
def features_for(parsed: dict) -> list[dict]:
    act, out = parsed['act'], []
    for w in parsed['windows']:
        ufs_excl = list(act['ufs_excluidas'])
        if w['escopo'] == 'pista_simples_federal' and not w.get('ufs') and _norm(w['operacao'] or '') != 'FIM DE ANO':
            ufs_excl += [u for u in act['ufs_so_fim_de_ano'] if u not in ufs_excl]   # § 3º e § 4º
        props = {
            'ato': act['ato'], 'ato_url': act['url'], 'dou': act['dou'], 'ano': act['ano'], 'revoga': act['revoga'],
            'operacao': _titulo(w['operacao'] or ''), 'escopo': w['escopo'], 'criterio': w['criterio'],
            'inicio': w['inicio'], 'fim': w['fim'], 'limites': act['limites'], 'infracao': act['infracao'],
            'ufs_apenas': w.get('ufs') or None,
            'ufs_excluidas': ufs_excl if w['escopo'] == 'pista_simples_federal' else None,
            'trechos': w.get('trechos'), 'so_aet': bool(w.get('so_aet')), 'largura_min_m': w.get('largura_min_m'),
            'base_legal': ('art. 1º, §§ 1º a 4º e Anexo I' if w['escopo'] == 'pista_simples_federal' else 'art. 1º, § 5º e Anexo I (tabela por trecho)'),
            'horario_na_tabela': w.get('horario_na_tabela', True),
        }
        if w['escopo'] == 'trechos':
            t = w['trechos'][0]
            fim_d = datetime.fromisoformat(w['fim']) - timedelta(minutes=1)
            quando = (f"{w['inicio'][8:10]}/{w['inicio'][5:7]}–{fim_d:%d/%m}" if not w.get('horario_na_tabela')
                      else f"{w['inicio'][8:10]}/{w['inicio'][5:7]} {w['inicio'][11:16]}–{w['fim'][11:16]}")
            nome = f"PRF · {props['operacao']} · {quando} · BR-{t['br']}/{t['uf'] or ''} km {t['km_ini']:g}–{t['km_fim']:g}"
        else:
            nome = f"PRF · {props['operacao']} · {w['inicio'][8:10]}/{w['inicio'][5:7]} {w['inicio'][11:16]}–{w['fim'][11:16]}"
        out.append({
            'source_id': stable_id(act['ato'], w['escopo'], w['inicio'], w['fim'], json.dumps(w.get('trechos'), sort_keys=True), w['criterio']),
            'geometry': BRASIL, 'name': nome, 'kind': 'janela', 'props': props,
            'valid_from': w['inicio'], 'valid_to': w['fim'],
        })
    return out


def fetch():
    global NOTES
    cands = candidates()
    if not cands:
        raise RuntimeError('nenhuma portaria DIOP/PRF de restrição encontrada no DOU')
    this_year = date.today().year
    chosen: dict[int, dict] = {}
    for c in cands[:6]:
        body, meta = fetch_act(c['url'])
        p = parse_act(body, c['url'], meta)
        y = p['act']['ano']
        if y < this_year - 1 or y in chosen:
            continue           # a mais recente de cada ano revoga as anteriores daquele ano
        chosen[y] = p
        if this_year in chosen and (this_year + 1 in chosen or c['pub'] is None or c['pub'] < date(this_year, 11, 1)):
            break
    feats = [f for p in chosen.values() for f in features_for(p)]
    NOTES = '; '.join(f"{p['act']['ato']} ({p['act']['dou']}; feriados de {y}; revoga {p['act']['revoga']}): "
                      f"{sum(1 for w in p['windows'] if w['escopo'] == 'pista_simples_federal')} janelas nacionais, "
                      f"{sum(1 for w in p['windows'] if w['escopo'] == 'trechos')} por trecho" for y, p in sorted(chosen.items()))
    print('   ', NOTES)
    return feats
