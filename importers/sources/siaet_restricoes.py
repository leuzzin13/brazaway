"""Restrições físicas do SIAET/DNIT (definitivas e temporárias) por segmento do PNV, Brasil inteiro.

Fonte: PDFs mensais por UF publicados pelo DNIT em
  https://www.gov.br/dnit/pt-br/assuntos/infraestrutura-rodoviaria/aet/restricoes/restricao-{definitiva|temporaria}/{MM-AAAA}/{uf}.pdf
Cada linha = BR, UF, código PNV, km inicial/final e, por pista (1 = sentido crescente, 2 = decrescente), altura,
largura, PBT (t), comprimento (e raio de giro na definitiva). Valor 0,0 vai para `aet_bloqueada` (nome histórico): na API,
PBT 0 numa temporária de via federal = trecho impedido (interdição); 0 nas outras grandezas = AET não autorizada nelas
(ver docs/layers/federal_restricoes.md, "O que o valor 0 quer dizer").

Geometria: segmento do SNV (DNITGeo WFS vgeo:vw_snv_rod), casado pelo código PNV. O SIAET usa uma numeração de km
própria (às vezes de versões antigas do SNV), então:
  - código existe na versão atual e a extensão bate (±5% ou ±0,3 km)  -> geometria do código ('snv_codigo');
  - código existe mas a extensão diverge -> a partir do início do código, percorre a cadeia do eixo principal atual
    pela extensão do SIAET ('snv_codigo_extensao_siaet', aproximada);
  - código não existe na versão atual -> versão histórica do SNV cuja faixa de km mais se aproxima ('snv_historico').
OAEs (DNITGeo vgeo:oae_sgo) a até 80 m do segmento e da mesma BR são contadas; com exatamente 1 ponte/viaduto,
a API aplica restrição de PESO só na ponte OSM correspondente.

Rodar: `python run.py siaet_restricoes` (ou via docker, ver docs/layers/federal_restricoes.md).
Variáveis: SIAET_MES=MM-AAAA força o mês de referência; SIAET_UFS=mg,rj limita as UFs (testes).
"""
from __future__ import annotations

import collections
import datetime
import html
import json
import math
import os
import re
import subprocess
from urllib.parse import urlencode

import requests

from common import CACHE_DIR, UA, http_get

LAYER_ID = 'federal_restricoes'
SOURCE = 'siaet'
SOURCE_URL = 'https://www.gov.br/dnit/pt-br/assuntos/infraestrutura-rodoviaria/aet/restricoes'
LICENSE = ('Informação pública do DNIT (cadastro de restrições físicas do SIAET, Res. DNIT 11/2022); portal gov.br sob '
           'CC BY-ND 3.0: usamos só os valores factuais, citando o DNIT, sem redistribuir os PDFs. Geometria: SNV/DNITGeo '
           '(WFS público do DNIT, sem licença explícita; AccessConstraints=NONE).')
NOTES = None  # preenchido em fetch()

UFS = 'ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to'.split()
PDF_URL = SOURCE_URL + '/restricao-{kind}/{mes}/{uf}.pdf'
WFS = 'https://servicos.dnit.gov.br/dnitgeo/geoserver/wfs'
KINDS = ('definitiva', 'temporaria')

# --------------------------------------------------------------------------------------------- utilidades


def num(s: str):
    try:
        return float(s.replace('.', '').replace(',', '.'))
    except (ValueError, AttributeError):
        return None


def fix_text(s):
    """O WFS do DNIT devolve UTF-8 lido como latin-1 (mojibake)."""
    if not isinstance(s, str):
        return s
    try:
        return s.encode('latin-1').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return s


def wfs_get(params: dict, cache: str, max_age_h: float, timeout: int = 600) -> dict:
    base = {'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'outputFormat': 'application/json'}
    url = WFS + '?' + urlencode({**base, **params})
    return json.loads(http_get(url, cache=cache, max_age_h=max_age_h, timeout=timeout))


def chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# --------------------------------------------------------------------------------------------- PDFs do SIAET


def candidate_months(today: datetime.date | None = None) -> list[str]:
    forced = os.environ.get('SIAET_MES')
    if forced:
        return [forced]
    d = today or datetime.date.today()
    y, m, out = d.year, d.month, []
    for _ in range(4):
        out.append(f'{m:02d}-{y}')
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return out


def pick_month() -> str:
    """Mês mais recente publicado (o DNIT publica no começo do mês; 404 enquanto não sai)."""
    for mes in candidate_months():
        url = PDF_URL.format(kind='definitiva', mes=mes, uf='sp')
        try:
            r = requests.get(url, headers=UA, timeout=60)
            if r.status_code == 200 and r.content[:4] == b'%PDF':
                return mes
        except requests.RequestException:
            continue
    raise RuntimeError('Nenhum mês do SIAET disponível nos últimos 4 meses')


def pdf_path(kind: str, mes: str, uf: str):
    rel = f'siaet/{mes}/{kind}_{uf}.pdf'
    try:
        b = http_get(PDF_URL.format(kind=kind, mes=mes, uf=uf), cache=rel, max_age_h=24 * 5, timeout=120)
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code == 404:
            return None
        raise
    if b[:4] != b'%PDF':
        return None
    return CACHE_DIR / rel


WORD = re.compile(r'<page width="([\d.]+)" height="([\d.]+)">|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>')
PNV = re.compile(r'^\d{3}[A-Z]{2,3}\d{4}$')
COLS = {
    'definitiva': {'Altura': 'altura', 'Faixa': 'larg_faixa', 'Total': 'larg_total', 'Peso': 'peso', 'Giro': 'raio_giro', 'Comp.': 'comp'},
    'temporaria': {'Altura': 'altura', 'Largura': 'largura', 'Peso': 'peso', 'Comp.': 'comp'},
}


def _pages(path) -> list[list[dict]]:
    out = subprocess.run(['pdftotext', '-bbox', str(path), '-'], capture_output=True, check=True).stdout.decode('utf-8', 'replace')
    pages: list[list[dict]] = []
    for m in WORD.finditer(out):
        if m.group(1):
            pages.append([])
        elif pages:
            pages[-1].append({'x0': float(m.group(3)), 'y0': float(m.group(4)), 'x1': float(m.group(5)), 't': html.unescape(m.group(7))})
    return pages


def updated_at(path) -> str | None:
    txt = subprocess.run(['pdftotext', '-l', '1', str(path), '-'], capture_output=True, check=True).stdout.decode('utf-8', 'replace')
    m = re.search(r'Atualizado em:?\s*(\d{2})/(\d{2})/(\d{4})', txt)
    return f'{m.group(3)}-{m.group(2)}-{m.group(1)}' if m else None


def parse_pdf(path, kind: str) -> list[dict]:
    """Colunas pela posição x do cabeçalho (validado contra pdfplumber na pesquisa: 0 divergências na definitiva)."""
    names = COLS[kind]
    out, cols = [], None
    for ws in _pages(path):
        pista = sorted([w for w in ws if w['t'] == 'Pista'], key=lambda w: w['x0'])
        if len(pista) >= 2:
            xs = (pista[0]['x0'] + pista[1]['x0']) / 2
            ytop = pista[0]['y0']
            hdr = [w for w in ws if w['t'] in names and ytop < w['y0'] < ytop + 60]
            cols = sorted(((w['x0'] + w['x1']) / 2, ('p1_' if w['x0'] < xs else 'p2_') + names[w['t']]) for w in hdr)
        if not cols:
            continue
        rows = collections.defaultdict(list)
        for w in ws:
            rows[round(w['y0'])].append(w)
        for _, rw in sorted(rows.items()):
            rw.sort(key=lambda w: w['x0'])
            t = [w['t'] for w in rw]
            idx = [i for i, s in enumerate(t) if PNV.match(s)]
            if not idx:
                continue
            i = idx[0]
            if len(t) < i + 3 or i < 2:
                continue
            rec = {'br': t[i - 2], 'uf': t[i - 1], 'pnv': t[i], 'km_ini': num(t[i + 1]), 'km_fim': num(t[i + 2])}
            if rec['km_ini'] is None or rec['km_fim'] is None:
                continue
            for w in rw[i + 3:]:
                cx = (w['x0'] + w['x1']) / 2
                c = min(cols, key=lambda c: abs(c[0] - cx))
                if abs(c[0] - cx) > 25:  # fora de qualquer coluna (rodapé etc.)
                    continue
                v = num(w['t'])
                if v is not None:
                    rec[c[1]] = v
            out.append(rec)
    return out


# --------------------------------------------------------------------------------------------- SNV (DNITGeo)


def snv_version() -> str:
    d = wfs_get({'typeNames': 'vgeo:vw_snv_rod', 'propertyName': 'Versao_SNV', 'count': 1, 'sortBy': 'Versao_SNV D'},
                cache='snv/versao.json', max_age_h=24)
    return d['features'][0]['properties']['Versao_SNV']


def snv_uf(versao: str, uf: str) -> list[dict]:
    """Todos os segmentos da UF na versão `versao` (geometria completa; ~1 m entre vértices). Cache por versão."""
    d = wfs_get({'typeNames': 'vgeo:vw_snv_rod', 'srsName': 'EPSG:4326',
                 'CQL_FILTER': f"Versao_SNV='{versao}' AND Unidade_Federacao='{uf.upper()}'"},
                cache=f'snv/{versao}/{uf}.json', max_age_h=24 * 180, timeout=900)
    return [f for f in d['features'] if f.get('geometry')]


def snv_history_attrs(codes: list[str]) -> dict[str, list[dict]]:
    """Todas as versões (sem geometria) de cada código."""
    out = collections.defaultdict(list)
    for ch in chunks(sorted(codes), 40):
        cql = 'Codigo_SNV IN (' + ','.join(f"'{c}'" for c in ch) + ')'
        key = hashlib_short(cql)
        d = wfs_get({'typeNames': 'vgeo:vw_snv_rod', 'CQL_FILTER': cql,
                     'propertyName': 'Codigo_SNV,Versao_SNV,Quilometragem_Inicio,Quilometragem_Fim'},
                    cache=f'snv/hist/attrs_{key}.json', max_age_h=24 * 90)
        for f in d['features']:
            out[f['properties']['Codigo_SNV']].append(f['properties'])
    return out


def snv_history_geoms(pairs: list[tuple[str, str]]) -> dict[str, dict]:
    out = {}
    for ch in chunks(sorted(pairs), 25):
        cql = ' OR '.join(f"(Codigo_SNV='{c}' AND Versao_SNV='{v}')" for c, v in ch)
        key = hashlib_short(cql)
        d = wfs_get({'typeNames': 'vgeo:vw_snv_rod', 'srsName': 'EPSG:4326', 'CQL_FILTER': cql},
                    cache=f'snv/hist/geom_{key}.json', max_age_h=24 * 90)
        for f in d['features']:
            if f.get('geometry'):
                out[f['properties']['Codigo_SNV']] = f
    return out


def hashlib_short(s: str) -> str:
    import hashlib
    return hashlib.sha1(s.encode()).hexdigest()[:12]


# --------------------------------------------------------------------------------------------- OAEs (DNITGeo)

OAE_URL = WFS + '?service=WFS&version=2.0.0&request=GetFeature&typeNames=vgeo:oae_sgo&outputFormat=application/json&srsName=EPSG:4326'
# tipos que podem carregar a via (contam para "o segmento tem 1 OAE"); passarelas, bueiros e túneis não limitam peso.
OAE_PORTANTES = {'Ponte', 'Ponte de Madeira', 'Pontilhão', 'Viaduto', 'Passagem Superior', 'Passagem Inferior', 'OAE Inservível', ''}
OAE_PONTE = {'Ponte', 'Ponte de Madeira', 'Pontilhão', 'Viaduto'}


def oae_sgo() -> list[dict]:
    d = json.loads(http_get(OAE_URL, cache='dnitgeo/oae_sgo.json', max_age_h=24 * 30, timeout=600))
    out = []
    for f in d['features']:
        g = f.get('geometry') or {}
        if g.get('type') != 'Point':
            continue
        p = {k: fix_text(v) for k, v in f['properties'].items()}
        p['lon'], p['lat'] = g['coordinates'][:2]
        out.append(p)
    return out


# --------------------------------------------------------------------------------------------- geometria


def _merge(geoms):
    from shapely.geometry import MultiLineString, LineString
    from shapely.ops import linemerge, unary_union
    lines = []
    for g in geoms:
        if g is None or g.is_empty:
            continue
        for p in (g.geoms if hasattr(g, 'geoms') else [g]):
            if isinstance(p, LineString) and len(p.coords) > 1:
                lines.append(p)
    if not lines:
        return None
    if len(lines) == 1:
        return lines[0]
    u = unary_union(MultiLineString([list(p.coords) for p in lines]))
    if u.geom_type != 'MultiLineString':
        return u
    try:
        return linemerge(u)
    except ValueError:
        return u


def _cut_chain(chain: list[dict], k0: float, k1: float):
    """Recorta [k0,k1] (km) de uma cadeia de segmentos do eixo principal (geometria no sentido crescente do km)."""
    from shapely.geometry import shape
    from shapely.ops import linemerge, substring
    pieces = []
    for f in chain:
        p = f['properties']
        a, b = p['Quilometragem_Inicio'], p['Quilometragem_Fim']
        if b <= k0 or a >= k1 or b <= a:
            continue
        g = shape(f['geometry'])
        g = linemerge(g) if g.geom_type == 'MultiLineString' else g
        if g.geom_type != 'LineString':
            g = max(g.geoms, key=lambda x: x.length)
        f0 = max(0.0, (k0 - a) / (b - a))
        f1 = min(1.0, (k1 - a) / (b - a))
        if f1 - f0 < 1e-6:
            continue
        pieces.append(substring(g, f0, f1, normalized=True))
    return _merge(pieces)


def _round_geom(g, tol=0.0001, nd=5) -> dict | None:
    from shapely.geometry import mapping
    if g is None or g.is_empty:
        return None
    s = g.simplify(tol, preserve_topology=False)
    if s.is_empty:
        s = g
    m = mapping(s)

    def rnd(c):
        return [[round(x, nd), round(y, nd)] for x, y, *_ in c]

    if m['type'] == 'LineString':
        return {'type': 'LineString', 'coordinates': rnd(m['coordinates'])}
    if m['type'] == 'MultiLineString':
        return {'type': 'MultiLineString', 'coordinates': [rnd(c) for c in m['coordinates'] if len(c) > 1]}
    return None


# --------------------------------------------------------------------------------------------- fetch


def read_siaet(mes: str, ufs: list[str]) -> tuple[list[dict], dict]:
    rows, meta = [], {'atualizado_em': set(), 'pdfs': 0, 'ausentes': []}
    for kind in KINDS:
        for uf in ufs:
            p = pdf_path(kind, mes, uf)
            if p is None:
                meta['ausentes'].append(f'{kind}/{uf}')
                continue
            meta['pdfs'] += 1
            up = updated_at(p)
            if up:
                meta['atualizado_em'].add(up)
            for r in parse_pdf(p, kind):
                r['tipo'] = kind
                r['atualizado_em'] = up
                r['pdf_url'] = PDF_URL.format(kind=kind, mes=mes, uf=uf)
                rows.append(r)
    return rows, meta


def _pista(r: dict, p: str, kind: str) -> dict | None:
    if kind == 'definitiva':
        larg = [r.get(f'{p}_larg_faixa'), r.get(f'{p}_larg_total')]
    else:
        larg = [r.get(f'{p}_largura')]
    d = {'altura_m': r.get(f'{p}_altura'), 'peso_t': r.get(f'{p}_peso'), 'comprimento_m': r.get(f'{p}_comp')}
    if kind == 'definitiva':
        d['largura_faixa_m'] = r.get(f'{p}_larg_faixa')
        d['largura_total_m'] = r.get(f'{p}_larg_total')
        d['raio_giro_m'] = r.get(f'{p}_raio_giro')
    # largura útil: a maior das larguras publicadas (a definitiva traz faixa de rolamento e total; valores < 2,6 m
    # aparecem só em erros evidentes de digitação, ex. 262BMG0750 faixa 2,4 / total 8,4). 0 = AET bloqueada.
    ls = [x for x in larg if x is not None]
    d['largura_m'] = 0.0 if ls and all(x == 0 for x in ls) else (max(ls) if ls else None)
    if all(v is None for v in d.values()):
        return None
    return d


def _limits(pistas: list[dict]) -> dict:
    """Menor limite positivo entre as pistas (resumo conservador; a API usa pista1/pista2 por sentido) e grandezas com 0."""
    out, zeros = {}, set()
    for k in ('altura_m', 'largura_m', 'peso_t', 'comprimento_m'):
        vals = [p[k] for p in pistas if p and p.get(k) is not None]
        pos = [v for v in vals if v > 0]
        out[k] = min(pos) if pos else None
        if any(v == 0 for v in vals):
            zeros.add(k.split('_')[0])
    out['aet_bloqueada'] = sorted(zeros)
    return out


def fetch():
    global NOTES
    from shapely.geometry import shape, Point
    from shapely.strtree import STRtree

    ufs = [u.strip().lower() for u in os.environ.get('SIAET_UFS', '').split(',') if u.strip()] or UFS
    mes = pick_month()
    print(f'    SIAET mês de referência {mes}, {len(ufs)} UFs')
    rows, meta = read_siaet(mes, ufs)
    print(f'    {len(rows)} linhas em {meta["pdfs"]} PDFs (ausentes: {meta["ausentes"] or "nenhum"})')

    # ---- SNV
    versao = snv_version()
    snv = {}            # código -> feature (versão atual)
    chains = collections.defaultdict(list)  # (br, uf) -> segmentos do eixo principal ordenados por km
    for uf in sorted({r['uf'].lower() for r in rows}):
        feats = snv_uf(versao, uf)
        print(f'    SNV {versao} {uf.upper()}: {len(feats)} segmentos')
        for f in feats:
            p = f['properties']
            snv[p['Codigo_SNV']] = f
            if p.get('Sigla_Tipo_Trecho') == 'B':
                chains[(p['Codigo_BR'], p['Unidade_Federacao'])].append(f)
    for k in chains:
        chains[k].sort(key=lambda f: f['properties']['Quilometragem_Inicio'])

    def consistent(r, p):
        ls = r['km_fim'] - r['km_ini']
        lc = p['Quilometragem_Fim'] - p['Quilometragem_Inicio']
        return abs(ls - lc) <= max(0.3, 0.05 * ls)

    missing = sorted({r['pnv'] for r in rows if r['pnv'] not in snv})
    hist_best: dict[str, dict] = {}
    if missing:
        attrs = snv_history_attrs(missing)
        want = []
        for code, vers in attrs.items():
            rr = [r for r in rows if r['pnv'] == code]
            if not rr:
                continue
            r = rr[0]
            best = min(vers, key=lambda v: (abs(v['Quilometragem_Inicio'] - r['km_ini']) + abs(v['Quilometragem_Fim'] - r['km_fim']), -int(v['Versao_SNV'][:6])))
            want.append((code, best['Versao_SNV']))
        hist_best = snv_history_geoms(want)
        print(f'    códigos fora da versão atual: {len(missing)}; recuperados do histórico: {len(hist_best)}')

    # ---- OAEs
    oaes = oae_sgo()
    pts = [Point(o['lon'], o['lat']) for o in oaes]
    tree = STRtree(pts)
    print(f'    OAEs DNITGeo: {len(oaes)}')

    feats, stats = [], collections.Counter()
    geom_cache: dict[tuple, tuple] = {}
    for r in rows:
        key = (r['pnv'], r['km_ini'], r['km_fim'])
        if key not in geom_cache:
            g, metodo, sp = None, None, None
            cur = snv.get(r['pnv'])
            if cur is not None:
                sp = cur['properties']
                if consistent(r, sp):
                    g, metodo = shape(cur['geometry']), 'snv_codigo'
                else:
                    chain = chains.get((sp['Codigo_BR'], sp['Unidade_Federacao']), [])
                    if sp.get('Sigla_Tipo_Trecho') == 'B' and chain:
                        k0 = sp['Quilometragem_Inicio']
                        g = _cut_chain(chain, k0, k0 + (r['km_fim'] - r['km_ini']))
                        metodo = 'snv_codigo_extensao_siaet'
                    if g is None:
                        g, metodo = shape(cur['geometry']), 'snv_codigo_divergente'
            elif r['pnv'] in hist_best:
                h = hist_best[r['pnv']]
                g, metodo, sp = shape(h['geometry']), 'snv_historico', h['properties']
            geom_cache[key] = (g, metodo, sp)
        g, metodo, sp = geom_cache[key]
        stats[metodo or 'sem_geometria'] += 1
        if g is None:
            continue
        geom = _round_geom(g)
        if geom is None:
            stats['geometria_vazia'] += 1
            continue

        # OAEs da mesma BR (ou BR coincidente) a até ~80 m do segmento
        brs = {r['br'].zfill(3)}
        for c in ((sp or {}).get('Coincidencia_Federal') or '').split(';'):
            if len(c) >= 3 and c[:3].isdigit():
                brs.add(c[:3])
        near = []
        buf = g.buffer(0.00075)  # ~80 m
        for i in tree.query(buf):
            o = oaes[int(i)]
            if (o.get('br') or '').zfill(3) in brs and buf.contains(pts[int(i)]) and (o.get('tipo_obra') or '') in OAE_PORTANTES:
                near.append(o)
        near.sort(key=lambda o: (o.get('km_inicial') is None, o.get('km_inicial') or 0))
        unica = None
        if len(near) == 1 and (near[0].get('tipo_obra') or '') in OAE_PONTE:
            o = near[0]
            unica = {'cod_obra': o.get('cod_obra'), 'cod_sgo': o.get('cod_sgo'), 'nome': o.get('descr_obra'), 'tipo': o.get('tipo_obra'),
                     'km': o.get('km_inicial'), 'extensao_m': o.get('extens_m'), 'lon': round(o['lon'], 6), 'lat': round(o['lat'], 6)}

        kind = r['tipo']
        pistas = [_pista(r, 'p1', kind), _pista(r, 'p2', kind)]
        lim = _limits(pistas)
        uf = r['uf']
        name = f"BR-{r['br'].zfill(3)}/{uf} km {fmt_km(r['km_ini'])}–{fmt_km(r['km_fim'])}"
        feats.append({
            'source_id': f"{kind}:{r['pnv']}:{r['km_ini']:.1f}",
            'geometry': geom,
            'name': name,
            'kind': kind,
            'props': {
                'tipo': kind, 'br': r['br'].zfill(3), 'uf': uf, 'pnv': r['pnv'], 'km_ini': r['km_ini'], 'km_fim': r['km_fim'],
                'ref_mes': mes.replace('-', '/'), 'atualizado_em': r.get('atualizado_em'),
                **{k: lim[k] for k in ('altura_m', 'largura_m', 'peso_t', 'comprimento_m')},
                'aet_bloqueada': lim['aet_bloqueada'],
                'pista1': pistas[0], 'pista2': pistas[1],
                'n_oae': len(near), 'oae_unica': unica,
                'oaes': [{'nome': o.get('descr_obra'), 'tipo': o.get('tipo_obra'), 'km': o.get('km_inicial')} for o in near[:12]],
                'geom_metodo': metodo, 'geom_aprox': metodo != 'snv_codigo', 'snv_versao': (sp or {}).get('Versao_SNV'),
                'local_inicio': fix_text((sp or {}).get('Local_Inicio')), 'local_fim': fix_text((sp or {}).get('Local_Fim')),
                'superficie': (sp or {}).get('Superficie_Federal'), 'administracao': fix_text((sp or {}).get('Administracao')),
                'fonte_url': r.get('pdf_url'),
            },
            'valid_from': None, 'valid_to': None,
        })
    ups = sorted(meta['atualizado_em'])
    NOTES = (f'SIAET ref. {mes} (atualizado em {", ".join(ups) or "?"}); {len(feats)} linhas com geometria; SNV {versao}; '
             f'métodos de geometria: {dict(stats)}. Valores por segmento PNV inteiro (não por ponto).')
    print('    ' + NOTES)
    return feats


def fmt_km(v: float) -> str:
    return f'{v:.1f}'.replace('.', ',')
