"""Alertas de serviços do DNIT (notícias) sobre interdição/restrição de pontes — fila de CURADORIA.

O SIAET atrasa em relação às interdições (ex.: ponte do Rio Piancó, BR-361/PB, interditada em 25/09/2026 e ainda com
12 t no SIAET de 05/10/2026; Igarapé Baruaninha, BR-432/RR, ausente do SIAET). Este importador raspa a lista
https://www.gov.br/dnit/pt-br/central-de-conteudos/noticias-alerta-de-servicos (não há RSS), filtra notícias de ponte
com interdição/restrição, extrai BR/UF/km/nome do rio/peso e localiza a ponte (nome da OAE no DNITGeo ou km no SNV).

NADA disso entra na rota automaticamente: as feições ficam como 'pendente_revisao' (camada pontes_federais, aviso
informativo). Uma pessoa confere a notícia e registra a decisão em `dnit_alertas_curadoria` (ver
docs/layers/pontes_federais.md); só alertas 'aprovado' viram restrição na camada federal_restricoes.
Variáveis: DNIT_ALERTAS_DIAS (janela, padrão 150), DNIT_ALERTAS_PAGINAS (máx. de páginas, padrão 15).
"""
from __future__ import annotations

import datetime
import os
import re
import unicodedata

from common import http_get, stable_id
from sources.siaet_restricoes import oae_sgo, snv_uf, snv_version

LAYER_ID = 'pontes_federais'
SOURCE = 'dnit-alertas'
SOURCE_URL = 'https://www.gov.br/dnit/pt-br/central-de-conteudos/noticias-alerta-de-servicos'
LICENSE = 'Notícias do DNIT (portal gov.br, CC BY-ND 3.0): guardamos só fatos (local, tipo, data) e o link; texto não redistribuído.'
NOTES = None

PONTE = re.compile(r'\bponte|viaduto|pontilh', re.I)
RESTRICAO = re.compile(r'interdi|restri|bloquei|limita[çc][ãa]o de (carga|peso)|cargas? pesadas?|tonelad', re.I)
BR_UF = re.compile(r'BR[\s-]?(\d{3})\s*/\s*([A-Z]{2})\b')
KM = re.compile(r'\bkm\s*(\d{1,4}(?:[.,]\d{1,3})?)', re.I)
RIO = re.compile(r'(?i:ponte)\s+(?:(?i:sobre)\s+(?i:o|a)\s+)?((?i:rio|c[óo]rrego|igarap[ée]|ribeir[ãa]o|arroio|riacho|canal))\s+'
                 r'((?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ú\']+(?:\s+(?:d[aeo]s?\s+)?[A-ZÁÉÍÓÚÂÊÔÃÕÇ][\wÀ-ú\']+){0,3})')
PESO = re.compile(r'(?:acima de|superior(?:es)? a|mais de|at[ée]|m[áa]ximo de|limite de)\s*(\d{1,3}(?:,\d{1,2})?)\s*(?:t\b|ton)', re.I)
TOTAL = re.compile(r'interdi[çc][ãa]o total|totalmente interditad|bloqueio total|fechamento total', re.I)


def _norm(s: str) -> str:
    return ''.join(c for c in unicodedata.normalize('NFD', s or '') if unicodedata.category(c) != 'Mn').lower()


def _text(soup_node) -> str:
    return re.sub(r'\s+', ' ', soup_node.get_text(' ', strip=True)) if soup_node else ''


def listing(max_pages: int, min_date: datetime.date) -> list[dict]:
    from bs4 import BeautifulSoup
    items = []
    for page in range(max_pages):
        url = SOURCE_URL + (f'?b_start:int={page * 30}' if page else '')
        soup = BeautifulSoup(http_get(url, cache=f'dnit_alertas/lista_{page}.html', max_age_h=6), 'lxml')
        arts = soup.select('article.tileItem')
        if not arts:
            break
        oldest = None
        for a in arts:
            link = a.select_one('h2.tileHeadline a')
            if not link:
                continue
            day = None
            for sp in a.select('span.summary-view-icon'):
                m = re.search(r'(\d{2})/(\d{2})/(\d{4})', sp.get_text())
                if m:
                    day = datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
                    break
            items.append({'url': link['href'], 'titulo': link.get_text(strip=True), 'data': day})
            if day:
                oldest = day if oldest is None else min(oldest, day)
        if oldest and oldest < min_date:
            break
    return [i for i in items if i['data'] is None or i['data'] >= min_date]


def article(url: str) -> dict:
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(http_get(url, cache=f'dnit_alertas/art_{stable_id(url)}.html', max_age_h=24 * 30), 'lxml')
    desc = _text(soup.select_one('.documentDescription'))
    body = _text(soup.select_one('#parent-fieldname-text'))
    body = re.split(r'\bCategoria\b|\bCompartilhe\b', body)[0]
    return {'descricao': desc, 'corpo': body}


def _locate(br: str, uf: str, km: float | None, rio: str | None, oaes, chains):
    """Ponto da ponte: 1) OAE do DNITGeo na mesma BR/UF cujo nome contém o rio; 2) km no eixo principal do SNV."""
    from shapely.geometry import Point, shape
    from shapely.ops import linemerge
    if rio:
        alvo = _norm(rio)
        cands = [o for o in oaes if (o.get('br') or '').zfill(3) == br and (o.get('uf') or '').upper() == uf and alvo in _norm(o.get('descr_obra'))]
        if km is not None:
            # notícia com km: a OAE homônima precisa estar a até 5 km (rios cruzam a mesma BR mais de uma vez)
            cands = sorted((o for o in cands if abs((o.get('km_inicial') if o.get('km_inicial') is not None else 1e9) - km) <= 5),
                           key=lambda o: abs(o['km_inicial'] - km))
        if cands:
            o = cands[0]
            return (o['lon'], o['lat']), 'oae_nome', o.get('descr_obra'), o.get('km_inicial')
    if km is not None:
        for f in chains.get((br, uf), []):
            p = f['properties']
            a, b = p['Quilometragem_Inicio'], p['Quilometragem_Fim']
            if a <= km <= b and b > a:
                g = shape(f['geometry'])
                g = linemerge(g) if g.geom_type == 'MultiLineString' else g
                if g.geom_type != 'LineString':
                    g = max(g.geoms, key=lambda x: x.length)
                pt = g.interpolate((km - a) / (b - a), normalized=True)
                return (pt.x, pt.y), 'km_snv', None, km
    return None, None, None, km


def _snippet_line(pt, br, uf, chains, half_km=0.5):
    """Trecho de ~1 km do eixo do SNV em torno do ponto (usado pela API para achar a ponte no grafo OSM)."""
    from shapely.geometry import Point, shape
    from shapely.ops import linemerge, substring
    P = Point(pt)
    best = None
    for f in chains.get((br, uf), []):
        g = shape(f['geometry'])
        d = g.distance(P)
        if d < 0.02 and (best is None or d < best[0]):
            best = (d, f, g)
    if not best:
        return None
    _, f, g = best
    g = linemerge(g) if g.geom_type == 'MultiLineString' else g
    if g.geom_type != 'LineString':
        g = min(g.geoms, key=lambda x: x.distance(P))
    p = f['properties']
    L = max(0.05, p['Quilometragem_Fim'] - p['Quilometragem_Inicio'])
    t = g.project(P, normalized=True)
    dt = half_km / L
    s = substring(g, max(0.0, t - dt), min(1.0, t + dt), normalized=True)
    if s.geom_type != 'LineString' or len(s.coords) < 2:
        return None
    return {'type': 'LineString', 'coordinates': [[round(x, 6), round(y, 6)] for x, y, *_ in s.coords]}


def fetch():
    global NOTES
    dias = int(os.environ.get('DNIT_ALERTAS_DIAS', '150'))
    pages = int(os.environ.get('DNIT_ALERTAS_PAGINAS', '15'))
    min_date = datetime.date.today() - datetime.timedelta(days=dias)
    items = listing(pages, min_date)
    print(f'    {len(items)} notícias desde {min_date.isoformat()}')
    cand, falhas = [], []
    for it in items:
        if not PONTE.search(it['titulo']) and not RESTRICAO.search(it['titulo']):
            continue
        try:
            art = article(it['url'])
        except Exception as e:  # noqa: BLE001 — página isolada fora do ar não derruba a carga
            falhas.append(it['url'])
            print(f'    ! notícia indisponível ({e.__class__.__name__}): {it["url"]}')
            if PONTE.search(it['titulo']):
                art = {'descricao': '', 'corpo': ''}
            else:
                continue
        txt = f"{it['titulo']}. {art['descricao']} {art['corpo']}"
        if not (PONTE.search(txt) and RESTRICAO.search(txt)):
            continue
        cand.append({**it, **art, 'texto': txt})
    print(f'    {len(cand)} notícias de ponte com interdição/restrição')

    oaes = oae_sgo()
    versao = snv_version()
    chains: dict = {}
    for uf in sorted({m.group(2).lower() for c in cand for m in BR_UF.finditer(c['texto'])}):
        for f in snv_uf(versao, uf):
            p = f['properties']
            if p.get('Sigla_Tipo_Trecho') == 'B':
                chains.setdefault((p['Codigo_BR'], p['Unidade_Federacao']), []).append(f)

    feats, sem_local = [], []
    for c in cand:
        m = BR_UF.search(c['titulo']) or BR_UF.search(c['texto'])
        if not m:
            sem_local.append(c['url'])
            continue
        br, uf = m.group(1), m.group(2)
        kmm = KM.search(c['texto'])
        km = float(kmm.group(1).replace(',', '.')) if kmm else None
        rm = RIO.search(c['titulo']) or RIO.search(c['texto'])
        rio = rm.group(2) if rm else None
        pt, metodo, oae_nome, km_loc = _locate(br, uf, km, rio, oaes, chains)
        if pt is None:
            sem_local.append(c['url'])
            continue
        line = _snippet_line(pt, br, uf, chains)
        pm = PESO.search(c['texto'])
        tipo = 'interdicao' if TOTAL.search(c['texto']) else ('restricao_peso' if re.search(r'carga|peso|tonelad', c['texto'], re.I) else 'outro')
        feats.append({
            'source_id': stable_id(c['url']),
            'geometry': line or {'type': 'Point', 'coordinates': [round(pt[0], 6), round(pt[1], 6)]},
            'name': c['titulo'],
            'kind': 'alerta_dnit',
            'props': {
                'fonte': 'DNIT — Alertas de serviços', 'url': c['url'], 'publicado_em': c['data'].isoformat() if c['data'] else None,
                'br': br, 'uf': uf, 'km': km_loc if km_loc is not None else km, 'rio': rio, 'oae_nome': oae_nome,
                'tipo_alerta': tipo, 'peso_mencionado_t': float(pm.group(1).replace(',', '.')) if pm else None,
                'localizacao': metodo, 'ponto': [round(pt[0], 6), round(pt[1], 6)], 'status': 'pendente_revisao',
                'resumo': (c['descricao'] or c['corpo'])[:300],
            },
            'valid_from': c['data'].isoformat() if c['data'] else None,
            'valid_to': None,
        })
    NOTES = (f'{len(items)} notícias lidas (últimos {dias} dias); {len(cand)} sobre ponte com interdição/restrição; '
             f'{len(feats)} localizadas; {len(sem_local)} sem localização: {sem_local[:10]}; {len(falhas)} páginas com erro (só título usado). '
             'Todas pendentes de revisão humana.')
    print('    ' + NOTES)
    return feats
