"""Postos de pesagem (balanças) do DER-MG nas rodovias estaduais de Minas Gerais.

Fontes (pesquisa ders_estaduais e concessoes_estaduais, 10/10/2026):
  1. Lista vigente: tabela "LOCALIZAÇÃO DOS 43 POSTOS DE PESAGEM EM OPERAÇÃO NA MALHA RODOVIÁRIA SOB RESPONSABILIDADE DO
     DER-MG" em https://www.der.mg.gov.br/transportes/pracas-de-pesagem (URG, rodovia, km, município, tipo de operação
     "24 horas" ou "Estratégica"; a cor da linha marca as balanças em trecho de concessão: Nascentes das Gerais, EPR Sul
     de Minas, EPR Vias do Café, Rota da Liberdade). Sem coordenadas.
  2. Coordenadas: camada pública 00_PUBLICACOES/pracas_pesagem (FeatureServer/2, 52 pontos, sem licença declarada) do
     Observatório da Infraestrutura (SEINFRA/DER-MG). Casamento pelo nº da rodovia (MG/MGC/BR/LMG coincidentes) e km a
     até 1 km, com o ramo (A/B) quando houver. O status dessa camada é de 2024 ("previstas até o final de 2024", "em
     obras"): quem diz se o posto opera é a tabela do site.
     NÃO usamos a camada Hosted/Balancas_V2 (57 pontos): o item declara "Informação de uso restrito DER-MG".
  3. Sem par na camada: rodovia + km na malha SRE-MG 2026_02 (_sre_mg.py), precisão aproximada.
Precisão: as coordenadas do DER-MG caem sobre a via ou sobre o acesso do posto e não dizem o lado da pista; ficam como
`precisao='aprox'` (a camada não deduz o sentido pelo lado da via). Nenhum posto traz sentido de fiscalização (só
"Ramo A/B" em dois locais), então a rota mostra "sentido não confirmado".
"""
from __future__ import annotations
import json, re, unicodedata
from bs4 import BeautifulSoup
from common import http_get, stable_id
from sources._sre_mg import SreLocator

LAYER_ID = 'balancas'
SOURCE = 'der-mg'
SITE_URL = 'https://www.der.mg.gov.br/transportes/pracas-de-pesagem'
FS_URL = 'https://observatorio.infraestrutura.mg.gov.br/server/rest/services/00_PUBLICACOES/pracas_pesagem/FeatureServer/2'
SOURCE_URL = f'{SITE_URL} (lista dos postos em operação) + {FS_URL} (coordenadas) + SRE-MG 2026_02 (rodovia+km)'
LICENSE = ('Site do DER-MG: reutilização permitida com identificação da fonte e crédito (página "Aspectos legais"); camada ArcGIS '
           '00_PUBLICACOES/pracas_pesagem e SRE-MG 2026_02 sem licença declarada (a camada Balancas_V2, "uso restrito DER-MG", não é usada)')
NOTES = ''

def _fam(cls: str | None) -> str | None:
    """Família de cor da linha da tabela; a legenda da própria tabela liga a cor à concessão (a linha usa 'alert-error' e
    'btn-default focus', a legenda 'bg-danger' e 'btn-default active')."""
    c = (cls or '').lower()
    if 'info' in c:
        return 'info'
    if 'danger' in c or 'error' in c:
        return 'danger'
    if 'warning' in c:
        return 'warning'
    if 'btn-default' in c:
        return 'default'
    return None


def norm(s: str | None) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', s).strip()


def norm_rod(s: str | None) -> str | None:
    """'MG050' / 'MGC 452' / 'MG-050' -> 'MG050', 'MGC452'."""
    m = re.match(r'^\s*(AMG|LMG|CMG|MGC|MG|BR)\s*-?\s*0*(\d{1,4})', (s or '').upper().replace('\xa0', ' '))
    return f'{m.group(1)}{int(m.group(2)):03d}' if m else None


def pretty_rod(r: str | None) -> str | None:
    m = re.match(r'^([A-Z]+)(\d+)$', r or '')
    return f'{m.group(1)}-{m.group(2)}' if m else r


def num_rod(r: str | None) -> str | None:
    m = re.search(r'(\d+)$', r or '')
    return str(int(m.group(1))) if m else None


def _km(s) -> float | None:
    try:
        return float(str(s).replace(',', '.').strip())
    except (TypeError, ValueError):
        return None


def parse_site(html: str) -> list[dict]:
    soup = BeautifulSoup(html, 'lxml')
    table = next((t for t in soup.find_all('table') if 'POSTOS DE PESAGEM' in t.get_text(' ').upper()), None)
    if table is None:
        raise ValueError('tabela de postos de pesagem não encontrada na página do DER-MG')
    legenda: dict[str, str] = {}
    rows = []
    for tr in table.find_all('tr'):
        tds = tr.find_all('td')
        if len(tds) < 2:
            continue
        txt = [re.sub(r'\s+', ' ', td.get_text(' ')).replace('\xa0', ' ').strip() for td in tds]
        cls = ' '.join(tds[0].get('class') or [])
        if txt[1].lower().startswith('balanças') and _fam(cls):
            m = re.search(r'concession[áa]ria (.+)$', txt[1], re.I)
            legenda[_fam(cls)] = m.group(1).strip() if m else txt[1]
            continue
        if len(txt) >= 5 and re.match(r'^\d+ª$', txt[0]):
            ramo = re.search(r'Ramo\s+([AB])\b', txt[3])
            rows.append({'urg': txt[0], 'rodovia': norm_rod(txt[1]), 'rodovia_txt': txt[1], 'km': _km(txt[2]), 'municipio': txt[3].strip(),
                         'operacao': '24 horas' if '24' in txt[4] else 'estratégica' if 'estrat' in norm(txt[4]) else txt[4],
                         'ramo': ramo.group(1) if ramo else None, '_fam': _fam(cls)})
    for r in rows:
        r['concessao'] = legenda.get(r.pop('_fam')) if r.get('_fam') else None
        r.pop('_fam', None)
    return rows


def arcgis_points() -> list[dict]:
    d = json.loads(http_get(f'{FS_URL}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson', cache='dermg_pracas_pesagem.geojson', max_age_h=24 * 7))
    out = []
    for f in d.get('features', []):
        p = f.get('properties') or {}
        g = f.get('geometry') or {}
        lon, lat = (g.get('coordinates') or [p.get('longitute'), p.get('latitude')])[:2]
        if lon is None or lat is None:
            continue
        out.append({'rodovia': norm_rod(p.get('rodovia')), 'km': _km(p.get('km')), 'municipio': (p.get('posto_de_p') or '').strip(),
                    'status': p.get('status'), 'operacao_camada': p.get('operacao'), 'lon': float(lon), 'lat': float(lat), 'objectid': p.get('objectid')})
    return out


def match_point(row: dict, pts: list[dict], used: set[int]) -> dict | None:
    """Ponto da camada para a linha da tabela: mesmo nº de rodovia (MG/MGC/BR/LMG coincidentes) e km a até 1 km; prefixo
    igual ou município igual; ramo A/B igual quando a linha tem ramo."""
    best = None
    for i, p in enumerate(pts):
        if i in used or p['km'] is None or row['km'] is None or num_rod(p['rodovia']) != num_rod(row['rodovia']):
            continue
        dk = abs(p['km'] - row['km'])
        if dk > 1.0:
            continue
        mun = norm(row['municipio']).split(' - ')[0].split(' (')[0]
        same = p['rodovia'] == row['rodovia'] or (mun and mun in norm(p['municipio']))
        if not same:
            continue
        pr = re.search(r'Ramo\s+([AB])\b', p['municipio'])
        if row.get('ramo') and pr and pr.group(1) != row['ramo']:
            continue
        score = dk + (0 if p['rodovia'] == row['rodovia'] else 0.5)
        if best is None or score < best[0]:
            best = (score, i, p)
    if not best:
        return None
    used.add(best[1])
    return best[2]


def _sentido_txt(r: dict) -> str | None:
    if not r.get('ramo'):
        return None
    m = re.search(r'\((Sentido [^)]+|[^)]+/[^)]+)\)', r['municipio'])
    return f"Ramo {r['ramo']}" + (f' ({m.group(1)})' if m else '')


def fetch():
    global NOTES
    rows = parse_site(http_get(SITE_URL, cache='dermg_pracas_pesagem.html', max_age_h=24 * 7).decode('utf-8', 'replace'))
    pts = arcgis_points()
    sre = SreLocator()
    used: set[int] = set()
    out, por_camada, por_sre, sem_pos = [], 0, 0, []
    for r in rows:
        p = match_point(r, pts, used)
        if p:
            lon, lat = p['lon'], p['lat']
            prec, metodo, erro = 'aprox', f"coordenada da camada pracas_pesagem do DER-MG ({p['rodovia']} km {p['km']}, {p['municipio']}; status na camada: {p['status']})", None
            por_camada += 1
        else:
            g = sre.locate(r['rodovia'], r['km']) if r['km'] is not None else None
            if not g:
                sem_pos.append(f"{pretty_rod(r['rodovia'])} km {str(r['km']).replace('.', ',')} ({r['municipio']})")
                continue
            lon, lat = g[0], g[1]
            prec, metodo, erro = 'aprox_km', f'rodovia + km na malha SRE-MG 2026_02, trecho {g[2]}', 0.5
            por_sre += 1
        km_txt = f"{r['km']:g}".replace('.', ',')
        nome = f"Posto de pesagem DER-MG {pretty_rod(r['rodovia'])} km {km_txt} ({r['municipio']})"
        if r['operacao'] == 'estratégica':
            nome += ', operação estratégica (eventual)'
        out.append({
            'source_id': stable_id('der-mg', r['rodovia'], r['km'], r.get('ramo')),
            'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]},
            'name': nome,
            'kind': 'fixo',
            'props': {'rodovia': pretty_rod(r['rodovia']), 'km': r['km'], 'sentido': None,
                      'sentido_txt': _sentido_txt(r),
                      'administrador': 'DER-MG' + (f" (trecho da concessão {r['concessao']})" if r.get('concessao') else ''),
                      'operacao': r['operacao'], 'urg': r['urg'], 'municipio': r['municipio'], 'uf': 'MG',
                      'precisao': prec, 'posicao_metodo': metodo, 'erro_km_estimado': erro,
                      'fonte_lista': SITE_URL, 'base_legal': 'CTB art. 209 (deixar de adentrar as áreas destinadas à pesagem, redação da Lei 14.157/2021)'},
        })
    nao_listados = [f"{q['rodovia']} km {q['km']} ({q['municipio']}, {q['status']})" for i, q in enumerate(pts) if i not in used]
    NOTES = (f'{len(rows)} postos na tabela do DER-MG; {len(out)} importados ({por_camada} com coordenada da camada pracas_pesagem, {por_sre} por '
             f'rodovia+km no SRE-MG); sem posição: {", ".join(sem_pos) or "nenhum"}. {len(nao_listados)} pontos da camada fora da lista vigente '
             f'(previstos/em obras em 2024) não importados.')
    print('  ' + NOTES)
    return out
