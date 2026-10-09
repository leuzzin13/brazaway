"""Praças de pedágio das rodovias ESTADUAIS concedidas de SP (ARTESP) + tarifa comercial por eixo.

Fontes:
  - Tarifas: PDF "Valor Atual das Tarifas" (página de pedágios da ARTESP; arquivo em admin.cms.sp.gov.br): por praça,
    rodovia, km, valor PASSEIO e COMERCIAL POR EIXO (no Estado, caminhão paga tarifa x nº de eixos); contratos novos
    (ViaPaulista) em categorias CAT-1..9 com valor manual e AVI (TAG) e vigência explícita.
  - Sentido de cobrança: PDF "Histórico de Tarifas (Contratos Vigentes)" (colunas COBRANÇA BI/UNIDIRECIONAL e
    TARIFA UNI/BIDIRECIONAL: praça unidirecional cobra num só sentido o valor de ida e volta).
  - Posição: KMZ de malha por lote (dadosabertos.artesp.sp.gov.br, CC-BY), pasta "Sistema de Arrecadação/Praças";
    quando a praça do PDF não casa com um ponto do KMZ, a posição é estimada pela rodovia+km (pontos de 1 km do DER-SP).
Também exporta artesp_kmz_points() para weigh_artesp (PGF/PPM do "Sistema de Pesagem").
"""
from __future__ import annotations
import io, json, math, os, re, subprocess, tempfile, unicodedata, zipfile
import xml.etree.ElementTree as ET
from common import http_get, stable_id, CACHE_DIR

LAYER_ID = 'pedagio'
SOURCE = 'artesp'
PDF_TARIFAS = os.environ.get('ARTESP_PDF_TARIFAS', 'https://admin.cms.sp.gov.br/dx/api/dam/v1/collections/aa4b6398-685b-4dba-8fab-8dc3a0fe9c27/items/0a8ff7b8-005b-4a04-a152-c69236f1f15d/renditions/53b3922a-a33b-40f6-9e4c-46a6771e681d?binary=true')
PDF_HIST = os.environ.get('ARTESP_PDF_HIST', 'https://admin.cms.sp.gov.br/dx/api/dam/v1/collections/aa4b6398-685b-4dba-8fab-8dc3a0fe9c27/items/ee05ac89-3ea9-49e9-8452-1fce8bdfb065/renditions/b6d7cfaf-2436-40f1-b7dc-c3f0d522d1ba?binary=true')
CKAN_MALHA = 'https://dadosabertos.artesp.sp.gov.br/api/3/action/package_show?id=malha-rodoviaria'
PAGE = 'https://www.artesp.sp.gov.br/artesp/setor-regulado/rodovia/pedagios'
SOURCE_URL = f'{PAGE} (PDFs "Valor Atual das Tarifas" e "Histórico de Tarifas") + https://dadosabertos.artesp.sp.gov.br/dataset/malha-rodoviaria (KMZ)'
LICENSE = 'KMZ de malha: CC-BY (ARTESP dados abertos); PDFs de tarifa: licença não especificada pela ARTESP (dado público oficial)'
NOTES = ''

LOTE_NOME = {1: 'AutoBAn', 6: 'Intervias', 7: 'Rota das Bandeiras', 11: 'Renovias', 13: 'Rodovias das Colinas', 16: 'CART',
             19: 'ViaRondon', 20: 'SPVias', 21: 'Rodovias do Tietê', 22: 'Ecovias dos Imigrantes', 23: 'Ecopistas (Ecovias Leste Paulista)',
             24: 'Rodoanel Oeste', 25: 'SPMar', 26: 'SP Serra (Rodoanel Norte)', 27: 'Tamoios', 28: 'Entrevias', 29: 'ViaPaulista',
             30: 'Eixo SP', 31: 'Ecovias Noroeste Paulista', 32: 'Novo Litoral', 33: 'Rota Sorocabana', 34: 'Ecovias Raposo Castello', 35: 'ViaRaposo'}
# ViaPaulista (contrato novo): CAT -> (eixos, rodagem) pelo multiplicador da tabela (1..6 = eixos de rodagem dupla; 7/8 = 3/4 eixos simples)
CAT_NOVO = {1: (2, 'simples'), 2: (2, 'dupla'), 3: (3, 'dupla'), 4: (4, 'dupla'), 5: (5, 'dupla'), 6: (6, 'dupla'), 7: (3, 'simples'), 8: (4, 'simples')}

ROD_RE = r'SP[AIM]?\s*-?\s*\d{2,3}(?:\s*/\s*\d{3})?'


def norm(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def brl(s: str) -> float:
    return float(s.replace('.', '').replace(',', '.'))


def pdftotext(data: bytes) -> str:
    with tempfile.NamedTemporaryFile(suffix='.pdf') as f:
        f.write(data)
        f.flush()
        return subprocess.run(['pdftotext', '-layout', f.name, '-'], check=True, capture_output=True).stdout.decode('utf-8', 'replace')


def parse_tarifas(txt: str) -> tuple[list[dict], str | None]:
    """Linhas praça/pórtico do PDF de tarifas vigentes. Devolve (linhas, data_da_tabela)."""
    from sources.weigh_dersp import norm_rod, parse_km
    m = re.search(r'(\d{2})/(\d{2})/(\d{4})', txt[:3000])
    data = f'{m.group(3)}-{m.group(2)}-{m.group(1)}' if m else None
    lines = txt.split('\n')
    out = []
    lote = None
    row_re = re.compile(rf'(?P<rod>{ROD_RE})(?P<praca>\s.*?)?\s+(?P<km>\d{{1,3}}\+\d{{3}})\s+R\$\s*(?P<p>[\d.,]+)\s+R\$\s*(?P<c>[\d.,]+)(?:\s+R\$\s*(?P<m>[\d.,]+))?')
    skip_re = re.compile(r'(?i)LOTE|PRA[CÇ]AS DE PED|LOCALIZA|PASSEIO|PED[AÁ]GIOS CONCEDIDOS|^\s*$')
    data_rows: dict[int, tuple[re.Match, int | None]] = {}
    for i, ln in enumerate(lines):
        lm = re.search(r'LOTE\s*-?\s*0?(\d{1,2})\b', ln)
        if lm:
            lote = int(lm.group(1))
            continue
        if re.match(r'\s*L29\b', ln):
            lote = 29
        rm = row_re.search(ln)
        if rm:
            data_rows[i] = (rm, lote)
    # nome da praça quebrado em várias linhas (acima e/ou abaixo da linha com os valores): cada linha sem valores vai para
    # a linha de dados mais próxima; se estiver colada em duas, vai para a de baixo (o nome quebra para baixo)
    parts: dict[int, tuple[list[str], list[str]]] = {i: ([], []) for i in data_rows}
    idx = sorted(data_rows)
    for i, ln in enumerate(lines):
        if i in data_rows or skip_re.search(ln):
            continue
        prev = max((k for k in idx if k < i), default=None)
        nxt = min((k for k in idx if k > i), default=None)
        dp = i - prev if prev is not None else 99
        dn = nxt - i if nxt is not None else 99
        if min(dp, dn) > 2:
            continue
        tgt = nxt if dn <= dp else prev
        rm = data_rows[tgt][0]
        seg = ln[rm.end('rod'):rm.start('km')].strip()
        if not seg or re.search(ROD_RE, seg) or len(seg) > 45:
            continue
        (parts[tgt][0] if i < tgt else parts[tgt][1]).append(seg)
    for i in idx:
        rm, lt = data_rows[i]
        name = ' '.join([*parts[i][0], (rm.group('praca') or '').strip(), *parts[i][1]])
        name = re.sub(r'\s+', ' ', name).strip(' *')
        out.append({'lote': lt, 'rodovia': norm_rod(rm.group('rod')), 'praca': name, 'km': parse_km(rm.group('km')), 'km_txt': rm.group('km'),
                    'passeio': brl(rm.group('p')), 'eixo': brl(rm.group('c')), 'moto': brl(rm.group('m')) if rm.group('m') else None})
    # contratos novos (ViaPaulista): blocos "SP 255 - Guatapará (km 045+500)" + linhas CAT-n
    vig = re.search(r'Vig[eê]ncia:\s*Entre\s*(\d{2})/(\d{2})/(\d{4})\s*e\s*(\d{2})/(\d{2})/(\d{4})', txt)
    cur = None
    for ln in lines:
        hm = re.search(rf'({ROD_RE})\s*-\s*(.+?)\s*\(km\s*(\d{{1,3}}\+\d{{3}})\)', ln)
        if hm:
            cur = {'lote': 29, 'rodovia': norm_rod(hm.group(1)), 'praca': hm.group(2).strip(), 'km': parse_km(hm.group(3)), 'km_txt': hm.group(3),
                   'categorias': [], 'vigencia': vig and (f'{vig.group(3)}-{vig.group(2)}-{vig.group(1)}', f'{vig.group(6)}-{vig.group(5)}-{vig.group(4)}')}
            out.append(cur)
            continue
        cm = re.match(r'^\s*([\d,]+)\s+CAT-(\d)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s*$', ln)
        if cm and cur is not None:
            cat = int(cm.group(2))
            if cat in CAT_NOVO:
                eixos, rod = CAT_NOVO[cat]
                cur['categorias'].append({'cat': cat, 'eixos': eixos, 'rodagem': rod, 'mult': brl(cm.group(1)), 'valor': brl(cm.group(4)), 'valor_tag': brl(cm.group(5))})
    return out, data


def parse_hist(txt: str) -> dict[tuple[str, int], tuple[str, str]]:
    """(rodovia, km arredondado em metros/100) -> (cobranca, tarifa) a partir do histórico consolidado."""
    from sources.weigh_dersp import norm_rod, parse_km
    out = {}
    for m in re.finditer(rf'({ROD_RE})\s+(.+?)\s+(\d{{1,3}}\+\d{{3}})\s+COBRAN[ÇC]A\s+(BI|UNI)DIRECIONAL\s+TARIFA\s+(UNI|BI)DIRECIONAL', txt):
        km = parse_km(m.group(3))
        key = (norm_rod(m.group(1)), round(km * 10))
        out[key] = ('bidirecional' if m.group(4) == 'BI' else 'unidirecional', 'bidirecional' if m.group(5) == 'BI' else 'unidirecional', norm(m.group(2)))
    return out


def _strip(t: str) -> str:
    return t.split('}', 1)[-1]


def artesp_kmz_points() -> list[dict]:
    """Pontos relevantes (praças, pórticos, PGF/PPM de pesagem) de todos os KMZ de malha da ARTESP."""
    pkg = json.loads(http_get(CKAN_MALHA, cache='artesp_malha_pkg.json', max_age_h=24 * 7))['result']
    out = []
    for r in pkg['resources']:
        url = r.get('url') or ''
        m = re.search(r'/l(\d{2})\.kmz$', url, re.I)
        if not m:
            continue
        lote = int(m.group(1))
        try:
            data = http_get(url, cache=f'artesp_l{lote:02d}.kmz', max_age_h=24 * 30, timeout=600)
        except Exception as e:
            print(f'  ! KMZ lote {lote}: {e}')
            continue
        z = zipfile.ZipFile(io.BytesIO(data))
        for kn in [n for n in z.namelist() if n.lower().endswith('.kml')]:
            raw = re.sub(rb'\s(py):[A-Za-z_]+="[^"]*"', b'', z.read(kn))  # l29: prefixo XML inválido
            raw = re.sub(rb'xmlns:(\w+)="\{[^"]*\}"', rb'xmlns:\1="urn:x-invalido:\1"', raw)  # l22/l23/l34: URI de namespace inválida (expat recente recusa)
            try:
                root = ET.fromstring(raw)
            except ET.ParseError as e:
                print(f'  ! KML inválido lote {lote}: {e}')
                continue

            def walk(el, path):
                t = _strip(el.tag)
                if t in ('Folder', 'Document'):
                    nm = next(((c.text or '').strip() for c in el if _strip(c.tag) == 'name'), '')
                    for c in el:
                        walk(c, path + [nm])
                elif t == 'Placemark':
                    nm, coords, ext, geom = '', None, {}, None
                    for c in el.iter():
                        st = _strip(c.tag)
                        if st == 'name' and not nm:
                            nm = (c.text or '').strip()
                        if st in ('Point', 'LineString', 'Polygon') and geom is None:
                            geom = st
                        if st == 'coordinates' and coords is None:
                            coords = (c.text or '').strip()
                        if st == 'SimpleData':
                            ext[c.get('name')] = (c.text or '').strip()
                        if st == 'Data':
                            v = [x for x in c if _strip(x.tag) == 'value']
                            ext[c.get('name')] = (v[0].text or '').strip() if v else ''
                    if geom != 'Point' or not coords:
                        return
                    fp = ' / '.join(p for p in path if p)
                    tipo = classify(fp, nm)
                    if not tipo:
                        return
                    try:
                        lon, lat = [float(x) for x in coords.split()[0].split(',')[:2]]
                    except ValueError:
                        return
                    out.append({'lote': lote, 'lote_nome': LOTE_NOME.get(lote) or r.get('name'), 'tipo': tipo, 'pasta': fp,
                                'nome': nm or (path[-1] if path else ''), 'lon': lon, 'lat': lat, 'attrs': ext, 'kmz_url': url})
                else:
                    for c in el:
                        walk(c, path)
            walk(root, [])
    return out


def classify(fp: str, nm: str) -> str | None:
    full = f'{fp} / {nm}'
    if re.search(r'(?i)pesagem', fp):
        if re.search(r'(?i)equipamentos', fp):
            return None
        if re.search(r'(?i)(^|/ )PGF', fp) or re.search(r'(?i)\bPGF\b', nm):
            return 'pgf'
        if re.search(r'(?i)(^|/ )PPM', fp) or re.search(r'(?i)\bPPM\b', nm):
            return 'ppm'
        if re.search(r'(?i)balan', full):
            return 'balanca'
        return None
    if re.search(r'(?i)arrecada', fp):
        if re.search(r'(?i)/ (TCP|CCA|PaP)\b', fp):
            return None
        if re.search(r'(?i)free.?flow|livre passagem|p[oó]rtico', full):
            return 'free_flow'
        if re.search(r'(?i)pra[cç]a', fp):
            return 'praca'
    if re.search(r'(?i)free.?flow', full):
        return 'free_flow'
    return None


def dist_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians(a[1]))
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


def fetch():
    global NOTES
    from sources.weigh_dersp import km_locator, pretty_rod
    tar_txt = pdftotext(http_get(PDF_TARIFAS, cache='artesp_tarifas_vigentes.pdf', max_age_h=24 * 7, timeout=300))
    hist_txt = pdftotext(http_get(PDF_HIST, cache='artesp_tarifas_hist.pdf', max_age_h=24 * 7, timeout=300))
    rows, data_tab = parse_tarifas(tar_txt)
    hist = parse_hist(hist_txt)
    kmz = [p for p in artesp_kmz_points() if p['tipo'] in ('praca', 'free_flow')]
    loc = km_locator()
    out, snapped, approx, lost = [], 0, 0, 0
    used_kmz: set[int] = set()
    for r in rows:
        g = loc.locate(r['rodovia'], r['km'])
        same_lote = [(i, p) for i, p in enumerate(kmz) if p['lote'] == r['lote'] and p['tipo'] == 'praca']
        pos, prec = None, None
        if g:
            near = sorted(((dist_m((p['lon'], p['lat']), (g[0], g[1])), i, p) for i, p in same_lote), key=lambda x: x[0])
            if near and near[0][0] <= 2500:
                d, i, p = near[0]
                pos, prec = (p['lon'], p['lat']), 'kmz'
                used_kmz.add(i)
                snapped += 1
            else:
                pos, prec = (g[0], g[1]), 'aprox_km'
                approx += 1
        if not pos:
            lost += 1
            print(f'  ! sem posição: lote {r["lote"]} {r["rodovia"]} {r["praca"]} km {r["km_txt"]}')
            continue
        nm = norm(r['praca'])
        is_pap = '(pap)' in r['praca'].lower() or ' pap' in nm
        is_portico = 'portico' in nm
        bloqueio = 'bloqueio' in nm
        h = hist.get((r['rodovia'], round(r['km'] * 10)))
        if not h:  # mesmo km, nome parecido em linha vizinha do histórico
            h = next((v for (rod, k), v in hist.items() if rod == r['rodovia'] and abs(k - r['km'] * 10) <= 2 and (v[2][:6] == nm[:6])), None)
        cobranca, tarifa_sent = (h[0], h[1]) if h else (None, None)
        if 'categorias' in r:
            cats = [c for c in r['categorias'] if c['mult'] >= 1]
            base = next((c['valor'] for c in cats if c['mult'] == 1), None)
            t = {'modelo': 'categorias', 'base': base, 'categorias': cats, 'max_eixos_tabela': max((c['eixos'] for c in cats), default=None),
                 'vigencia_inicio': r['vigencia'][0] if r.get('vigencia') else None, 'vigencia_fim': r['vigencia'][1] if r.get('vigencia') else None,
                 'data': r['vigencia'][0] if r.get('vigencia') else data_tab}
        else:
            t = {'modelo': 'por_eixo', 'eixo': r['eixo'], 'passeio': r['passeio'], 'moto': r['moto'], 'data': data_tab, 'vigencia_inicio': data_tab, 'vigencia_fim': None}
        t.update({'fonte': 'ARTESP', 'url': PAGE})
        out.append({
            'source_id': stable_id('artesp', r['lote'], r['rodovia'], r['km_txt'], nm),
            'geometry': {'type': 'Point', 'coordinates': [round(pos[0], 6), round(pos[1], 6)]},
            'name': r['praca'].title() if r['praca'].isupper() else r['praca'],
            'kind': 'portico' if is_portico else 'praca',
            'props': {'operador': LOTE_NOME.get(r['lote']), 'lote': r['lote'], 'rodovia': pretty_rod(r['rodovia']), 'km': r['km'],
                      'cobranca': cobranca, 'tarifa_sentido': tarifa_sent, 'bloqueio': bloqueio, 'ponto_a_ponto': is_pap,
                      'free_flow': is_portico and not is_pap, 'precisao': prec, 'tarifa': t},
        })
    # pontos do KMZ sem linha no PDF (lotes novos, pórticos free flow): só posição, sem tarifa oficial
    extra = 0
    for i, p in enumerate(kmz):
        if i in used_kmz:
            continue
        if any(dist_m((p['lon'], p['lat']), tuple(f['geometry']['coordinates'])) < 1500 for f in out):
            continue
        extra += 1
        nome = p['attrs'].get('Nome') or p['attrs'].get('NOME') or p['nome'] or ''
        out.append({'source_id': stable_id('artesp-kmz', p['lote'], round(p['lon'], 5), round(p['lat'], 5)),
                    'geometry': {'type': 'Point', 'coordinates': [round(p['lon'], 6), round(p['lat'], 6)]},
                    'name': nome or ('Pórtico free flow' if p['tipo'] == 'free_flow' else 'Praça de pedágio') + f' (lote {p["lote"]})',
                    'kind': 'portico' if p['tipo'] == 'free_flow' else 'praca',
                    'props': {'operador': p['lote_nome'], 'lote': p['lote'], 'rodovia': None, 'km': None, 'cobranca': None,
                              'free_flow': p['tipo'] == 'free_flow', 'precisao': 'kmz', 'tarifa': None, 'kmz_pasta': p['pasta'][-120:]}})
    NOTES = (f'Tabela ARTESP de {data_tab}: {len(rows)} linhas ({snapped} posicionadas pelo KMZ, {approx} por rodovia+km, {lost} sem posição); '
             f'{extra} pontos só no KMZ (sem tarifa). Sentido de cobrança do histórico: {len(hist)} praças.')
    return out
