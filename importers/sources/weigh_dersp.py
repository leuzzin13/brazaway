"""Pontos de pesagem (balanças) nas rodovias estaduais de SP — DER-SP.

Duas fontes do DER-SP, combinadas:
  1. "Pontos para pesagem de veículos" (tabela HTML em der.sp.gov.br): 136 pontos com rodovia, km, sentido,
     trecho (origem / destino), administrador (DR n ou concessionária) e tipo de posto (FIXO/MÓVEL). Sem coordenadas.
  2. Camada ArcGIS "Balancas_DER_DBO" (mapas.der.sp.gov.br): ~87 balanças da malha DER com lat/lon, rodovia, km e trecho.
Quando o ponto da tabela não tem par na camada (ex.: postos operados por concessionárias), a posição é estimada pela
rodovia+km sobre os "pontos de 1 km" da malha do DER-SP (camada pontos_1km_rodovias), com precisão de algumas centenas
de metros (props.precisao = 'aprox_km').

Também expõe KmLocator (georreferenciamento rodovia+km em SP), usado por toll_artesp/weigh_artesp.
"""
from __future__ import annotations
import json, re, unicodedata
from bs4 import BeautifulSoup
from common import http_get, stable_id

LAYER_ID = 'balancas'
SOURCE = 'der-sp'
TABLE_URL = 'https://www.der.sp.gov.br/der/rodovias/balanca/pontos_de_pesagem'
FS_URL = 'https://mapas.der.sp.gov.br/server/rest/services/Hosted/Balancas_DER_DBO/FeatureServer/0'
KM_URL = 'https://mapas.der.sp.gov.br/server/rest/services/Hosted/pontos_1km_rodovias/FeatureServer/9'
SOURCE_URL = f'{TABLE_URL} + {FS_URL} (+ {KM_URL} para rodovia/km)'
LICENSE = 'DER-SP — dados públicos sem licença declarada nas páginas (ver docs/layers/balancas.md)'
NOTES = ''


def norm_rod(s: str | None) -> str | None:
    """'SP-330' / 'SP 330' / 'SP- 065' / '01 SPA 032/099' / 'BR-116' -> 'SP330', 'SP065', 'SPA032/099', 'BR116'."""
    if not s:
        return None
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().upper()
    s = re.sub(r'^\s*\d+\s+(?=SP|BR)', '', s)
    m = re.match(r'^\s*(SPA|SPI|SPM|SP|BR)\s*-?\s*(\d{1,3})(?:\s*/\s*(\d{1,3}))?', s)
    if not m:
        return None
    out = f'{m.group(1)}{int(m.group(2)):03d}'
    if m.group(3):
        out += f'/{int(m.group(3)):03d}'
    return out


def pretty_rod(n: str | None) -> str | None:
    if not n:
        return None
    m = re.match(r'^(SPA|SPI|SPM|SP|BR)(\d{3})(/\d{3})?$', n)
    return f'{m.group(1)}-{m.group(2)}{m.group(3) or ""}' if m else n


def parse_km(s: str | None) -> float | None:
    """'039+047' -> 39.047; '087,45' -> 87.45; '184' -> 184.0"""
    s = (s or '').strip()
    m = re.match(r'^(\d{1,3})\s*\+\s*(\d{1,3})$', s)
    if m:
        return int(m.group(1)) + int(m.group(2).ljust(3, '0')) / 1000
    try:
        return float(s.replace(',', '.'))
    except ValueError:
        return None


class KmLocator:
    """Posição aproximada de rodovia+km em SP a partir dos pontos de 1 km do DER-SP (centro de cada km)."""

    def __init__(self):
        self.idx: dict[str, list[tuple[float, float, float, str]]] = {}
        start = 0
        while True:
            q = (f'{KM_URL}/query?where=fid%3E{start}+AND+fid%3C%3D{start + 2000}'
                 '&outFields=rodovia,km_ctr_1km,subtrecho,lon_1km,lat_1km&returnGeometry=false&f=json')
            d = json.loads(http_get(q, cache=f'dersp_km1_{start}.json', max_age_h=24 * 30))
            feats = d.get('features', [])
            if not feats and start > 0:
                break
            for f in feats:
                a = f['attributes']
                r = norm_rod(a.get('rodovia'))
                if r and a.get('km_ctr_1km') is not None and a.get('lon_1km') and a.get('lat_1km'):
                    self.idx.setdefault(r, []).append((float(a['km_ctr_1km']), float(a['lon_1km']), float(a['lat_1km']), a.get('subtrecho') or ''))
            start += 2000
            if start > 200000:
                break
        for v in self.idx.values():
            v.sort()

    def locate(self, rod: str | None, km: float | None) -> tuple[float, float, float] | None:
        """(lon, lat, erro_km) ou None. Interpola entre centros de km consecutivos do mesmo subtrecho."""
        r = norm_rod(rod)
        pts = self.idx.get(r or '')
        if not pts or km is None:
            return None
        best = None
        by_sub: dict[str, list] = {}
        for p in pts:
            by_sub.setdefault(p[3], []).append(p)
        for sub in by_sub.values():
            for a, b in zip(sub, sub[1:]):
                if a[0] <= km <= b[0] and 0 < b[0] - a[0] <= 2.5:
                    t = (km - a[0]) / (b[0] - a[0])
                    cand = (a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2]), (b[0] - a[0]) / 2)
                    if best is None or cand[2] < best[2]:
                        best = cand
        if best:
            return best
        near = min(pts, key=lambda p: abs(p[0] - km))
        if abs(near[0] - km) <= 1.0:
            return (near[1], near[2], abs(near[0] - km))
        return None


_LOC: KmLocator | None = None


def km_locator() -> KmLocator:
    global _LOC
    if _LOC is None:
        _LOC = KmLocator()
    return _LOC


def _kind(posto: str) -> str:
    p = unicodedata.normalize('NFKD', posto or '').encode('ascii', 'ignore').decode().upper()
    return 'fixo' if 'FIXO' in p else 'movel' if 'MOVEL' in p else 'outro'


def _sentido(s: str) -> str | None:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().strip().lower()
    return s if s in ('norte', 'sul', 'leste', 'oeste') else (s or None)


def fetch():
    global NOTES
    html = http_get(TABLE_URL, cache='dersp_pontos_pesagem.html', max_age_h=24 * 7).decode('utf-8', 'replace')
    soup = BeautifulSoup(html, 'lxml')
    table = next(t for t in soup.find_all('table') if 'Rodovia' in t.get_text() and 'Posto' in t.get_text())
    rows = []
    for tr in table.find_all('tr'):
        c = [re.sub(r'\s+', ' ', td.get_text(' ')).strip() for td in tr.find_all('td')]
        if len(c) >= 6:
            rows.append({'rodovia': c[0], 'km': parse_km(c[1]), 'km_txt': c[1], 'sentido': _sentido(c[2]), 'trecho': c[3], 'admin': c[4], 'posto': c[5]})
    fs = json.loads(http_get(f'{FS_URL}/query?where=1%3D1&outFields=*&outSR=4326&f=geojson', cache='dersp_balancas_fs.geojson', max_age_h=24 * 7))
    pts = []
    for f in fs.get('features', []):
        p = f['properties']
        g = f.get('geometry') or {}
        if g.get('type') != 'Point':
            continue
        pts.append({'rod': norm_rod(p.get('rodovia_1')), 'km': parse_km(p.get('km')), 'lon': g['coordinates'][0], 'lat': g['coordinates'][1],
                    'trecho': (p.get('trecho') or '').strip(), 'denominacao': p.get('denominaca'), 'municipio': (p.get('municipi_1') or '').strip(),
                    'regional': p.get('codregiona'), 'used': False})
    loc = km_locator()
    out, matched, approx, lost = [], 0, 0, 0

    def trecho_key(t: str) -> str:
        return re.sub(r'[^a-z]', '', unicodedata.normalize('NFKD', t or '').encode('ascii', 'ignore').decode().lower())

    for r in rows:
        rod = norm_rod(r['rodovia'])
        same = lambda p: trecho_key(p['trecho'])[:12] == trecho_key(r['trecho'])[:12]
        cand = [p for p in pts if p['rod'] == rod and p['km'] is not None and r['km'] is not None and not p['used']
                and (abs(p['km'] - r['km']) <= 0.6 or (same(p) and abs(p['km'] - r['km']) <= 1.0))]
        # mesmo km nos dois sentidos: desempata pelo trecho (origem / destino)
        cand.sort(key=lambda p: (not same(p), abs(p['km'] - r['km'])))
        props = {'rodovia': pretty_rod(rod), 'km': r['km'], 'sentido': r['sentido'], 'trecho': r['trecho'], 'administrador': r['admin'],
                 'tipo_original': r['posto'], 'fonte_tabela': TABLE_URL}
        if cand:
            p = cand[0]
            p['used'] = True
            lon, lat, prec = p['lon'], p['lat'], 'exata'
            props.update({'denominacao': p['denominacao'], 'municipio': p['municipio'], 'regional': p['regional']})
            matched += 1
        else:
            g = loc.locate(rod, r['km'])
            if not g:
                lost += 1
                print(f'  ! sem posição: {r["rodovia"]} km {r["km_txt"]} ({r["admin"]})')
                continue
            lon, lat, err = g
            prec = 'aprox_km'
            props['erro_km_estimado'] = round(err, 2)
            approx += 1
        props['precisao'] = prec
        out.append({'source_id': stable_id('dersp', rod, r['km_txt'], r['sentido'], r['admin']),
                    'geometry': {'type': 'Point', 'coordinates': [round(lon, 6), round(lat, 6)]},
                    'name': f'Balança {pretty_rod(rod)} km {r["km_txt"]} ({r["sentido"] or "?"})',
                    'kind': _kind(r['posto']), 'props': props})
    # balanças da camada ArcGIS que não aparecem na tabela
    extra = 0
    for p in pts:
        if p['used']:
            continue
        extra += 1
        out.append({'source_id': stable_id('dersp-fs', p['rod'], p['km'], p['trecho']),
                    'geometry': {'type': 'Point', 'coordinates': [round(p['lon'], 6), round(p['lat'], 6)]},
                    'name': f'Balança {pretty_rod(p["rod"])} km {p["km"]}', 'kind': 'outro',
                    'props': {'rodovia': pretty_rod(p['rod']), 'km': p['km'], 'sentido': None, 'trecho': p['trecho'], 'administrador': p['regional'],
                              'denominacao': p['denominacao'], 'municipio': p['municipio'], 'precisao': 'exata', 'tipo_original': None}})
    NOTES = f'{len(rows)} pontos na tabela: {matched} com coordenada da camada DER, {approx} estimados por rodovia+km, {lost} sem posição; {extra} só na camada.'
    return out
