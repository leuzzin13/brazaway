"""Portarias do DER-SP com janela de horário em rodovia estadual — hoje: Portaria SUP/DER-084-01/11/2023 (Via Anchieta, serra).

Portaria SUP/DER-084-01/11/2023 (DOE-SP 07/11/2023, Executivo, p. 147; em vigor 15 dias após a publicação):
  art. 3º  CVC com AET (PBTC até 74 t e comprimento até 30 m) na SP-150 km 40–55 (pistas sul e norte) só circula
           nas janelas do § 1º (seg 01h–05h; seg 23h → ter 05h; ter 23h → qua 05h; qua 23h → qui 05h; qui 23h → sex 05h);
           § 2º chegada ao sistema Anchieta-Imigrantes não antes das 22h; § 5º nada disso em feriado prolongado
           (municipal, estadual ou federal) que envolva de quinta a terça.
  art. 4º  nenhuma CVC usa a faixa da esquerda das 18h às 20h quando a pista opera sentido Baixada (informativo).
  art. 1º  conjunto de carga indivisível e ônibus com mais de 26 m: proibidos no trecho (PBT máx. 70 t) — o app não
           tem como saber se a carga é indivisível; fica só no texto.
Tudo é LIDO do texto publicado (API do DOE-SP); se a redação não for reconhecida, o importador falha.
Também procura no DOE-SP atos posteriores que citem a portaria com "revoga" e, se achar, marca a regra como revogada.

Geometria: marcos quilométricos da ARTESP (SP150 km 40 a 55, CC BY) casados na malha viária do Valhalla (OSM, ODbL)
nos dois sentidos (trace_attributes/map_snap). Sem Valhalla acessível, usa a poligonal dos marcos (aproximada).
"""
from __future__ import annotations
import html as htmllib, json, os, re, urllib.parse
from datetime import date
import requests
from common import http_get, stable_id, UA

LAYER_ID = 'rodovias_horario'
SOURCE = 'der-sp'
SOURCE_URL = 'https://do-api-web-search.doe.sp.gov.br/v2/publications (DOE-SP, atos do DER-SP)'
LICENSE = ('Ato oficial (DOE-SP) — domínio público, Lei 9.610/98 art. 8º, IV. Marcos km: ARTESP (CC BY). '
           'Geometria casada na malha OpenStreetMap via Valhalla (© OpenStreetMap contributors, ODbL).')
NOTES = None

DOE_API = 'https://do-api-web-search.doe.sp.gov.br/v2'
MARCOS_URL = 'https://drive.google.com/uc?export=download&id=13CzWezf7YNeCEz_8bi3C2WOPcC83yPwS'  # marcos_quilometricos.geojson (pasta pública da ARTESP)
ACTS = [{
    'id': 'sup-der-084-2023',
    'ato': 'Portaria SUP/DER-084-01/11/2023',
    'slug': 'executivo/secretaria-de-meio-ambiente-infraestrutura-e-logistica/portaria-sup-084-arp-katia-8344367',
    'revoga_regex': r'084[-/ ]?01/11/2023|SUP/DER-084/2023',
    'marcos_rodovia': 'SP150',
}]
DIAS = {'segunda': 1, 'terca': 2, 'quarta': 3, 'quinta': 4, 'sexta': 5, 'sabado': 6, 'domingo': 7}


def _plain(s: str) -> str:
    import unicodedata
    return unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()


def doe_publication(slug: str) -> dict:
    raw = http_get(f'{DOE_API}/publications/{slug}', cache=f'der/{slug.split("/")[-1]}.json', max_age_h=24 * 7,
                   headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
    return json.loads(raw)


def doe_text(pub: dict) -> str:
    c = re.sub(r'<style.*?</style>', '', pub.get('content') or '', flags=re.S)
    t = re.sub(r'</p>|<br\s*/?>|</tr>', '\n', c)
    t = htmllib.unescape(re.sub(r'<[^>]+>', ' ', t))
    t = re.sub(r'[ \t\xa0]+', ' ', t)
    return re.sub(r'\n\s*\n+', '\n', t).strip()


def doe_search(term: str, since: str) -> list[dict]:
    q = [('periodStartingDate', 'personalized'), ('PageNumber', '1'), ('FromDate', since), ('ToDate', date.today().isoformat()),
         ('PageSize', '50'), ('SortField', 'Date'), ('Terms[0]', term)]
    raw = http_get(f'{DOE_API}/advanced-search/publications?' + urllib.parse.urlencode(q), cache=f'der/busca_{_plain(term)[:30]}.json',
                   max_age_h=12, headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
    return json.loads(raw).get('items', [])


# ---------------------------------------------------------------- parser da SUP/DER-084/2023
def parse_084(t: str) -> dict:
    p = _plain(t)
    trecho = re.search(r'sp ?150[^.]*?entre o km (\d+(?:,\d+)?) e o km (\d+(?:,\d+)?)', p)
    if not trecho:
        raise RuntimeError('084/2023: trecho (km) não reconhecido')
    km_ini, km_fim = (float(x.replace(',', '.')) for x in trecho.groups())
    art3 = re.search(r'artigo 3(.*?)artigo 4', p, re.S)
    if not art3:
        raise RuntimeError('084/2023: artigo 3º não encontrado')
    a3 = art3.group(1)
    lim = re.search(r'pbtc\)? de ate (\d+) toneladas e comprimento maximo de (\d+) ?m', a3)
    if not lim or 'autorizacao especial de transito' not in a3:
        raise RuntimeError('084/2023: limites/AET do art. 3º não reconhecidos')
    janelas = []
    for m in re.finditer(r'\b(?:da|das) (\d{1,2})h(?: de (\w+)-feira)? ate (?:as )?(\d{1,2})h de (\w+)-feira', a3):
        h0, d0, h1, d1 = int(m.group(1)), m.group(2), int(m.group(3)), m.group(4)
        d0 = d0 or d1
        if d0 not in DIAS or d1 not in DIAS:
            raise RuntimeError(f'084/2023: dia não reconhecido em {m.group(0)!r}')
        janelas.append({'dia_ini': DIAS[d0], 'hora_ini': f'{h0:02d}:00', 'dia_fim': DIAS[d1], 'hora_fim': f'{h1:02d}:00'})
    if len(janelas) < 3:
        raise RuntimeError(f'084/2023: janelas do § 1º não reconhecidas ({len(janelas)})')
    cheg = re.search(r'chegada ao sistema anchieta/imigrantes nao podera anteceder (?:as )?(\d{1,2})h', a3)
    feriado = re.search(r'(nao sera permitida a circulacao prevista no\s*1o?\s*nos feriados prolongados.*?quinta-feira ate a terca-feira.*?);', a3, re.S)
    if not feriado:
        raise RuntimeError('084/2023: § 5º (feriados prolongados) não reconhecido')
    a4 = re.search(r'artigo 4.*?faixa da esquerda.*?das (\d{1,2})h as (\d{1,2})h', p, re.S)
    a1 = re.search(r'artigo 1.*?comprimento superior a (\d+) ?m.*?pbt maximo\D+(\d+) toneladas', p, re.S)
    return {
        'rodovia': 'SP-150', 'nome_via': 'Via Anchieta (serra)', 'km_ini': km_ini, 'km_fim': km_fim,
        'aplica_a': 'cvc_aet', 'pbtc_max_t': float(lim.group(1)), 'comprimento_max_m': float(lim.group(2)),
        'janelas_permitidas': janelas, 'chegada_minima': f'{int(cheg.group(1)):02d}:00' if cheg else None,
        'bloqueio_feriado_prolongado': True,
        'feriado_prolongado_texto': 'Não será permitida a circulação prevista no § 1º nos feriados prolongados, municipal, estadual ou federal, '
                                    'que envolvam os dias de quinta-feira até a terça-feira da semana subsequente, em especial o Carnaval, '
                                    'Semana Santa, Natal e Ano Novo (art. 3º, § 5º).',
        'faixa_esquerda_cvc': {'ini': f'{int(a4.group(1)):02d}:00', 'fim': f'{int(a4.group(2)):02d}:00'} if a4 else None,
        'indivisivel_onibus': {'comprimento_max_m': float(a1.group(1)), 'pbt_max_t': float(a1.group(2))} if a1 else None,
        'base_legal': {'janelas': 'art. 3º, § 1º', 'chegada': 'art. 3º, § 2º', 'feriados': 'art. 3º, § 5º',
                       'faixa_esquerda': 'art. 4º', 'indivisivel': 'art. 1º'},
    }


def revocations(act: dict, pub_date: str) -> list[str]:
    found = []
    for term in ('SUP/DER-084', 'DER-084'):
        for it in doe_search(term, pub_date[:10]):
            if it.get('slug') == act['slug'] or 'Estradas de Rodagem' not in (it.get('hierarchy') or ''):
                continue
            txt = doe_text(doe_publication(it['slug']))
            for m in re.finditer(act['revoga_regex'], txt):
                ctx = txt[max(0, m.start() - 400): m.end() + 50]
                if re.search(r'revog', ctx, re.I):
                    found.append(f"{it.get('title')} ({it.get('date', '')[:10]})")
                    break
    return sorted(set(found))


# ---------------------------------------------------------------- geometria
def marcos(rodovia: str, km0: float, km1: float) -> list[list[float]]:
    d = json.loads(http_get(MARCOS_URL, cache='der/artesp_marcos_quilometricos.geojson', max_age_h=24 * 90))
    pts = {}
    for f in d['features']:
        p = f['properties']
        if p.get('RODOVIA') == rodovia and km0 <= float(p.get('KM') or -1) <= km1:
            pts[float(p['KM'])] = f['geometry']['coordinates'][:2]
    if len(pts) < 3:
        raise RuntimeError(f'marcos ARTESP insuficientes para {rodovia} km {km0}–{km1}')
    return [pts[k] for k in sorted(pts)]


def _valhalla_urls():
    env = os.environ.get('VALHALLA_URL')
    return [env] if env else ['http://valhalla:8002', 'http://truck-router-valhalla:8002', 'http://host.docker.internal:8002', 'http://localhost:8002']


def _poly6(s: str) -> list[list[float]]:
    idx = lat = lon = 0
    out = []
    while idx < len(s):
        vals = []
        for _ in range(2):
            sh = res = 0
            while True:
                b = ord(s[idx]) - 63
                idx += 1
                res |= (b & 0x1f) << sh
                sh += 5
                if b < 0x20:
                    break
            vals.append(~(res >> 1) if res & 1 else res >> 1)
        lat += vals[0]
        lon += vals[1]
        out.append([round(lon / 1e6, 6), round(lat / 1e6, 6)])
    return out


def match_on_osm(points: list[list[float]], must_contain: str) -> tuple[list[list[float]] | None, str | None]:
    body = {'shape': [{'lon': x, 'lat': y} for x, y in points], 'costing': 'truck', 'shape_match': 'map_snap',
            'filters': {'attributes': ['edge.names', 'edge.length', 'shape'], 'action': 'include'}}
    for base in _valhalla_urls():
        try:
            r = requests.post(f'{base}/trace_attributes', json=body, headers=UA, timeout=60)
            if r.status_code != 200:
                continue
            j = r.json()
            names = {n for e in j.get('edges', []) for n in (e.get('names') or [])}
            total = sum(e.get('length', 0) for e in j.get('edges', []))
            on = sum(e.get('length', 0) for e in j.get('edges', []) if any(must_contain in n for n in (e.get('names') or [])))
            if total <= 0 or on / total < 0.9:
                print(f'  ! casamento duvidoso em {base}: {on:.1f}/{total:.1f} km com "{must_contain}" ({sorted(names)[:5]})')
                return None, None
            st = requests.get(f'{base}/status', timeout=10).json()
            return _poly6(j['shape']), str(st.get('tileset_last_modified'))
        except requests.RequestException:
            continue
    return None, None


def fetch():
    global NOTES
    out, notes = [], []
    for act in ACTS:
        pub = doe_publication(act['slug'])
        text = doe_text(pub)
        if _plain(act['ato']).replace('portaria ', '') not in _plain(text):
            raise RuntimeError(f"{act['ato']}: o texto publicado no DOE não traz o número do ato")
        rule = parse_084(text)
        rev = revocations(act, pub.get('date') or '2023-01-01')
        pts = marcos(act['marcos_rodovia'], rule['km_ini'], rule['km_fim'])
        sul, tiles = match_on_osm(pts, 'SP-150')
        norte, _ = match_on_osm(pts[::-1], 'SP-150')
        if sul and norte:
            geom = {'type': 'MultiLineString', 'coordinates': [sul, norte]}
            geo_src = f'marcos ARTESP casados na malha OSM (Valhalla, tileset {tiles})'
        else:
            geom = {'type': 'LineString', 'coordinates': pts}
            geo_src = 'poligonal dos marcos quilométricos ARTESP (aproximada: Valhalla indisponível na importação)'
        pages = pub.get('editionPages') or []
        props = {
            **rule, 'ato': act['ato'], 'ato_url': f"https://doe.sp.gov.br/{act['slug']}", 'doe': 'DOE-SP ' + '/'.join(reversed((pub.get('date') or '')[:10].split('-'))) +
            (f", p. {pages[0]['page']}" if pages else ''), 'doe_pdf': pages[0]['url'] if pages else None,
            'vigencia': 'em vigor desde 15 dias após a publicação (art. 8º); revogou a Portaria SUP/DER-046-08/10/2013',
            'status': 'revogada' if rev else 'vigente', 'revogada_por': rev or None, 'geometria': geo_src,
            'sentidos': ['litoral (sul, km 40→55)', 'capital (norte, km 55→40)'] if sul and norte else None,
        }
        notes.append(f"{act['ato']}: {props['status']}{' por ' + ', '.join(rev) if rev else ''}; {len(rule['janelas_permitidas'])} janelas; geometria: {geo_src}")
        out.append({
            'source_id': act['id'], 'geometry': geom, 'kind': 'regra_semanal',
            'name': f"{rule['rodovia']} {rule['nome_via']} km {rule['km_ini']:g}–{rule['km_fim']:g} · CVC com AET só de madrugada (seg–sex)",
            'props': props, 'valid_from': None, 'valid_to': None,
        })
    NOTES = ' | '.join(notes)
    print('   ', NOTES)
    return out
