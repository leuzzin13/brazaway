#!/usr/bin/env python3
"""Gera os seeds das regras municipais de São Paulo a partir de data/raw (GeoSampa WFS) + config/zmrc-rules.json:

  db/seed/0002_zones.sql     zonas de restrição (geometria do GeoSampa + regras com base legal)
  db/seed/0004_holidays.sql  feriados que suspendem essas regras (todas valem "exceto feriados"), calculados pela lei

Zonas geradas (ids estáveis):
  ...0001  ZMRC (Portaria SMT.GAB 137/2018)                                  geometria: zmrc
  ...0002  Rodízio — caminhões (Decreto 58.584/2018), SEM as vias do Minianel  geometria: mian menos o corredor das vias
  ...0003  Produtos perigosos no Minianel (Portaria SMT.GAB 051/2024)        geometria: mian (+25 m para fora via rules.inset_m)
  ...0004  Rodízio — veículos que não são caminhão (inclusive vias-limite)  geometria: mian (+25 m para fora)

Corredor do Minianel (zona 0002; Decreto 58.584/2018 art. 2º §2º: caminhões podem circular pelas vias do Minianel).
O polígono do GeoSampa contém o corredor inteiro das marginais (as duas margens e o rio), com até ~430 m de largura.
`--measure` mede, ao longo da borda, a distância até a pista do Minianel mais afastada, sobre o eixo de logradouros do
PRÓPRIO GeoSampa (geoportal:segmento_logradouro, CC-BY-SA 4.0 — mesma fonte e licença do polígono; nada do OSM):
  1. amostra a borda a cada `spacing_m`;
  2. pega os segmentos com nome de via do Minianel (denominações oficiais em config) e os acessos a elas e às pontes
     sobre os rios (tipo em `access_types` com o nome da via ou casando com `access_patterns`, ex.: "AC DOIS A AV PRES
     CASTELO BRANCO", "AC A PONTE DO PIQUERI") e os pontos deles (a cada 10 m) dentro do polígono; cada ponto cai no
     trecho da borda mais próximo;
  3. um ponto só alarga o corredor se o raio borda→ponto não cruzar, depois da primeira pista, uma rua local paralela à
     borda (não engole quadras entre pistas, como em Bom Retiro, onde a Av. Pres. Castelo Branco entra no bairro);
  4. largura do trecho = maior distância + `margin_m` (mínimo `min_width_m`); vales mais curtos que 2 x `gap_fill_m`
     entre trechos mais largos são preenchidos (fechamento 1D: o eixo do GeoSampa tem falhas, ex.: sob a Ponte do Jaguaré);
  5. pistas que não couberem na faixa (as do passo 3 e as que a verificação final não achar dentro dela) entram como
     linhas com buffer de `margin_m`.
O seed recorta ST_Difference(mian, faixas da borda ∪ linhas) e grava o Minianel inteiro em `geom_endpoint`: origem e
destino são testados contra ele (um endereço no corredor continua "dentro do rodízio").

Uso:
  python3 scripts/gen-zones-seed.py                    # gera os dois seeds (só stdlib, sem rede)
  python3 scripts/gen-zones-seed.py --measure          # remede o corredor no WFS do GeoSampa e grava config/zmrc-rules.json
  python3 scripts/gen-zones-seed.py --check-brasilapi  # confere os feriados com a BrasilAPI (rede; só avisa)
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import json
import math
import pathlib
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

root = pathlib.Path(__file__).resolve().parent.parent
raw = root / 'data' / 'raw'
cache = root / 'data' / 'cache'
cfg_path = root / 'config' / 'zmrc-rules.json'
cfg = json.load(open(cfg_path, encoding='utf-8'))

ZMRC_ID = '22222222-2222-4222-8222-000000000001'
GEOSAMPA_LICENSE = 'CC-BY-SA 4.0'
WFS = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs'


def load(name):
    p = raw / name
    if not p.exists():
        return None
    d = json.load(open(p, encoding='utf-8'))
    if len(d['features']) != 1:   # ex.: arquivo convertido de SHP por data/import/import-zmrc.sh com várias partes
        raise SystemExit(f"data/raw/{name} tem {len(d['features'])} feições; o gerador espera uma só (o polígono da zona)")
    f = d['features'][0]
    geom = f['geometry']
    if geom['type'] == 'Polygon':
        geom = {'type': 'MultiPolygon', 'coordinates': [geom['coordinates']]}
    src = (f"GeoSampa WFS geoportal:{name.replace('geosampa_', '').replace('.geojson', '')} "
           f"(fonte original {f['properties'].get('sg_fonte_original')}, carga {f['properties'].get('dt_carga')}; {GEOSAMPA_LICENSE})")
    return geom, src


def outer_ring(mp):
    r = mp['coordinates'][0][0]
    return r[:-1] if r[0] == r[-1] else r


def gj(g):
    return f"ST_SetSRID(ST_GeomFromGeoJSON($g${json.dumps(g, separators=(',', ':'))}$g$), 4326)"


# ------------------------------------------------------------------------------------------------- geometria plana
LAT0, LON0 = -23.55, -46.65
KX, KY = 111320 * math.cos(math.radians(LAT0)), 110540


def to_xy(p):
    return ((p[0] - LON0) * KX, (p[1] - LAT0) * KY)


def to_ll(x, y):
    return [round(x / KX + LON0, 6), round(y / KY + LAT0, 6)]


def point_in_ring(x, y, R):
    inside = False
    for i in range(len(R)):
        (x1, y1), (x2, y2) = R[i], R[(i + 1) % len(R)]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def winding(x, y, P):
    """Número de voltas (regra não-zero): serve para polígonos que se cruzam (faixa larga em curva fechada)."""
    w = 0
    for i in range(len(P)):
        (x1, y1), (x2, y2) = P[i], P[(i + 1) % len(P)]
        c = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1)
        if y1 <= y < y2 and c > 0:
            w += 1
        elif y2 <= y < y1 and c < 0:
            w -= 1
    return w


def seg_cross(a, b, c, d):
    """Os segmentos ab e cd se cruzam? Devolve o parâmetro t em ab (0..1) ou None."""
    rx, ry, sx, sy = b[0] - a[0], b[1] - a[1], d[0] - c[0], d[1] - c[1]
    den = rx * sy - ry * sx
    if abs(den) < 1e-12:
        return None
    qx, qy = c[0] - a[0], c[1] - a[1]
    t, u = (qx * sy - qy * sx) / den, (qx * ry - qy * rx) / den
    return t if 0 <= t <= 1 and 0 <= u <= 1 else None


class Border:
    """Anel externo do polígono em metros, com posição (arco) ao longo da borda e normal para dentro."""

    def __init__(self, ring_ll):
        self.P = [to_xy(p) for p in ring_ll]
        n = len(self.P)
        area = sum(self.P[i][0] * self.P[(i + 1) % n][1] - self.P[(i + 1) % n][0] * self.P[i][1] for i in range(n)) / 2
        self.left_inside = area > 0                      # anel anti-horário: o lado de dentro fica à esquerda
        self.segs, arc = [], 0.0
        for i in range(n):
            p, q = self.P[i], self.P[(i + 1) % n]
            L = math.hypot(q[0] - p[0], q[1] - p[1])
            if L > 0:
                nx, ny = self.normal(p, q)
                self.segs.append((p[0], p[1], q[0], q[1], L, arc, nx, ny))
            arc += L
        self.length = arc
        self.cell = 200.0
        self.grid = {}
        for si, (x1, y1, x2, y2, *_r) in enumerate(self.segs):
            for gx in range(int(min(x1, x2) // self.cell) - 1, int(max(x1, x2) // self.cell) + 2):
                for gy in range(int(min(y1, y2) // self.cell) - 1, int(max(y1, y2) // self.cell) + 2):
                    self.grid.setdefault((gx, gy), []).append(si)

    def normal(self, p, q):
        L = math.hypot(q[0] - p[0], q[1] - p[1])
        if L == 0:
            return None
        dx, dy = (q[0] - p[0]) / L, (q[1] - p[1]) / L
        return (-dy, dx) if self.left_inside else (dy, -dx)

    def nearest(self, x, y, reach_m=600.0):
        """(distância, arco, ponto mais próximo) na borda."""
        best = (1e18, 0.0, (x, y))
        cx, cy, r = int(x // self.cell), int(y // self.cell), int(math.ceil(reach_m / self.cell))
        cand = {si for gx in range(cx - r, cx + r + 1) for gy in range(cy - r, cy + r + 1) for si in self.grid.get((gx, gy), ())}
        for si in cand:
            x1, y1, x2, y2, L, a0, *_r = self.segs[si]
            t = max(0.0, min(1.0, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / (L * L)))
            px, py = x1 + t * (x2 - x1), y1 + t * (y2 - y1)
            d = math.hypot(x - px, y - py)
            if d < best[0]:
                best = (d, a0 + t * L, (px, py))
        return best

    def at(self, a):
        """Ponto e normal (do segmento) na posição de arco a (com volta)."""
        a %= self.length
        lo, hi = 0, len(self.segs) - 1
        while lo < hi:                                   # último segmento com a0 <= a
            mid = (lo + hi + 1) // 2
            if self.segs[mid][5] <= a:
                lo = mid
            else:
                hi = mid - 1
        x1, y1, x2, y2, L, a0, nx, ny = self.segs[lo]
        t = min(1.0, max(0.0, (a - a0) / L))
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1)), (nx, ny)

    def subpath(self, a0, a1):
        """Pontos da borda do arco a0 ao a1 (a1 > a0; dá a volta no anel) e a normal para dentro de cada trecho entre eles."""
        L = self.length
        a0 %= L
        a1 = a0 + min(a1 - a0, L)
        verts = []
        for (x1, y1, _x2, _y2, _l, s0, *_r) in self.segs:
            for wrap in (0.0, L):
                if a0 < s0 + wrap < a1:
                    verts.append((s0 + wrap, (x1, y1)))
        pts = [self.at(a0)[0]] + [v for _, v in sorted(verts)] + [self.at(a1)[0]]
        norms = [self.normal(p, q) for p, q in zip(pts, pts[1:])]
        first = next((n for n in norms if n), self.at(a0)[1])
        out, last = [], first
        for n in norms:
            last = n or last
            out.append(last)
        return pts, out


def offset_polygon(pts, norms, W):
    """Faixa de largura W para dentro de uma polilinha da borda (buffer de um lado só, junta em esquadro limitada).
    norms[i] é a normal do trecho pts[i] -> pts[i+1]."""
    off = []
    for i, p in enumerate(pts):
        if i == 0 or i == len(pts) - 1:
            n = norms[0] if i == 0 else norms[-1]
            off.append((p[0] + n[0] * W, p[1] + n[1] * W))
            continue
        na, nb = norms[i - 1], norms[i]
        bx, by = na[0] + nb[0], na[1] + nb[1]
        bl = math.hypot(bx, by)
        if bl / 2 < 0.5:                                 # curva fechada (> 120°): chanfro com dois pontos
            off.append((p[0] + na[0] * W, p[1] + na[1] * W))
            off.append((p[0] + nb[0] * W, p[1] + nb[1] * W))
        else:
            s = W / (bl / 2)
            off.append((p[0] + bx / bl * s, p[1] + by / bl * s))
    return pts + off[::-1]


# ---------------------------------------------------------------------------------------- medição (--measure, rede)
def _norm(s):
    s = unicodedata.normalize('NFKD', s or '')
    return re.sub(r'\s+', ' ', ''.join(c for c in s if not unicodedata.combining(c))).strip().upper()


def seg_name(p):
    return _norm(' '.join(x for x in [(p.get('cd_tipo_logradouro') or '').strip(), (p.get('cd_titulo_logradouro') or '').strip(),
                                       p.get('nm_logradouro') or ''] if x))


def fetch_segments(ring_ll, max_age_days=30):
    """Segmentos de logradouro do GeoSampa a até ~700 m da borda (tiles de 0,01°), com cache em data/cache."""
    path = cache / 'geosampa_segmento_logradouro_minianel.json'
    if path.exists() and time.time() - path.stat().st_mtime < max_age_days * 86400:
        return json.load(open(path, encoding='utf-8'))['features']
    R = [to_xy(p) for p in ring_ll]
    xs, ys = [p[0] for p in ring_ll], [p[1] for p in ring_ll]
    step, tiles = 0.01, []
    x = math.floor(min(xs) / step) * step - step
    while x < max(xs) + step:
        y = math.floor(min(ys) / step) * step - step
        while y < max(ys) + step:
            bx0, by0 = to_xy((x, y))
            bx1, by1 = to_xy((x + step, y + step))
            if any(math.hypot(max(bx0 - px, 0, px - bx1), max(by0 - py, 0, py - by1)) <= 700 for px, py in R):
                tiles.append((x, y, x + step, y + step))
            y += step
        x += step

    def get(t):
        q = urllib.parse.urlencode({
            'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': 'geoportal:segmento_logradouro',
            'outputFormat': 'application/json', 'srsName': 'EPSG:4326', 'count': '20000',
            'bbox': f'{t[1]:.4f},{t[0]:.4f},{t[3]:.4f},{t[2]:.4f},urn:ogc:def:crs:EPSG::4326'})
        req = urllib.request.Request(f'{WFS}?{q}', headers={'User-Agent': 'truck-router-mvp/0.1'})
        for attempt in range(3):
            try:
                return json.load(urllib.request.urlopen(req, timeout=180))['features']
            except Exception:                              # noqa: BLE001
                if attempt == 2:
                    raise
                time.sleep(3 * (attempt + 1))

    feats = {}
    with cf.ThreadPoolExecutor(4) as ex:
        for fs in ex.map(get, tiles):
            for f in fs:
                feats[f['properties']['cd_identificador']] = f
    out = list(feats.values())
    cache.mkdir(parents=True, exist_ok=True)
    json.dump({'type': 'FeatureCollection', 'features': out}, open(path, 'w', encoding='utf-8'))
    print(f'GeoSampa: {len(out)} segmentos de logradouro em {len(tiles)} tiles (cache {path.relative_to(root)})')
    return out


def _lines(geom):
    if not geom:
        return []
    if geom['type'] == 'LineString':
        return [geom['coordinates']]
    if geom['type'] == 'MultiLineString':
        return geom['coordinates']
    return []


def _densify(line, step=10.0):
    pts = []
    for (x1, y1), (x2, y2) in zip(line, line[1:]):
        n = max(1, int(math.hypot(x2 - x1, y2 - y1) // step))
        pts.extend((x1 + (x2 - x1) * j / n, y1 + (y2 - y1) * j / n) for j in range(n))
    pts.append(line[-1])
    return pts


def _closing(width, k):
    """Fechamento 1D (dilata e erode com janela de k trechos): preenche vales curtos sem alargar as pontas."""
    n = len(width)
    dil = [max(width[(i + j) % n] for j in range(-k, k + 1)) for i in range(n)]
    return [max(width[i], min(dil[(i + j) % n] for j in range(-k, k + 1))) for i in range(n)]


class _Index:
    """Grade de 100 m sobre linhas (para cruzar raios com ruas e pistas)."""
    cell = 100.0

    def __init__(self, lines):
        self.lines, self.g = lines, {}
        for li, ln in enumerate(lines):
            for k, ((x1, y1), (x2, y2)) in enumerate(zip(ln, ln[1:])):
                for gx in range(int(min(x1, x2) // self.cell), int(max(x1, x2) // self.cell) + 1):
                    for gy in range(int(min(y1, y2) // self.cell), int(max(y1, y2) // self.cell) + 1):
                        self.g.setdefault((gx, gy), set()).add((li, k))

    def hits(self, a, b, parallel_only=False):
        """[(t, linha)] em que o raio ab cruza as linhas (t de 0 a 1). parallel_only: ignora o que atravessa o corredor."""
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) // self.cell) + 1)
        cand = set()
        for j in range(n + 1):
            x, y = a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n
            for gx in (int(x // self.cell) - 1, int(x // self.cell), int(x // self.cell) + 1):
                for gy in (int(y // self.cell) - 1, int(y // self.cell), int(y // self.cell) + 1):
                    cand |= self.g.get((gx, gy), set())
        rx, ry = b[0] - a[0], b[1] - a[1]
        rl = math.hypot(rx, ry) or 1
        out = []
        for li, k in cand:
            c0, c1 = self.lines[li][k], self.lines[li][k + 1]
            if parallel_only:
                sx, sy = c1[0] - c0[0], c1[1] - c0[1]
                if abs(rx * sx + ry * sy) / (rl * (math.hypot(sx, sy) or 1)) > 0.7:   # ponte/acesso que atravessa o corredor
                    continue
            t = seg_cross(a, b, c0, c1)
            if t is not None:
                out.append((t, li))
        return out


def measure(mian_geom):
    c = cfg['minianel_corridors']
    spacing, margin, wmin = float(c['spacing_m']), float(c['margin_m']), float(c['min_width_m'])
    ring = outer_ring(mian_geom)
    B = Border(ring)
    R = B.P
    classes = {_norm(n): float(lc['max_dist_m']) for lc in c['lanes'] for n in lc['names']}
    acc_types = set(c.get('access_types', []))
    acc_res = [re.compile(r) for r in c.get('access_patterns', [])]
    acc_cap = max(classes.values()) if classes else 0.0

    def lane_cap(name, tipo):
        """Distância máxima da borda se o segmento é pista do Minianel. Acessos (tipo AC) cujo nome oficial cita uma via do
        Minianel ou uma ponte sobre os rios ("AC DOIS A AV PRES CASTELO BRANCO", "AC A PONTE DO PIQUERI") contam como pista:
        são a entrada e a saída das vias (art. 2º §2º)."""
        if name in classes:
            return classes[name]
        if tipo in acc_types:
            cap = next((cap for ln, cap in classes.items() if name.endswith(' ' + ln)), None)
            if cap is None and any(r.search(name) for r in acc_res):
                cap = acc_cap
            return cap
        return None
    no_block = set(c.get('non_blocking_types', []))
    feats = fetch_segments(ring)

    lanes, blockers, bnames, dropped = [], [], [], {}
    for f in feats:
        name = seg_name(f['properties'])
        cap = lane_cap(name, (f['properties'].get('cd_tipo_logradouro') or '').strip())
        for ln in _lines(f['geometry']):
            xy = [to_xy(p) for p in ln]
            if len(xy) < 2:
                continue
            if cap is not None:
                pts = [p for p in _densify(xy) if point_in_ring(p[0], p[1], R)]
                if not pts:
                    continue
                near = [B.nearest(x, y) for x, y in pts]
                if max(n[0] for n in near) > cap:   # homônimo longe da borda (ex.: Anhaia Mello fora do trecho)
                    dropped[name] = dropped.get(name, 0) + 1
                    continue
                lanes.append((name, pts, near))
            elif (f['properties'].get('cd_tipo_logradouro') or '').strip() not in no_block:
                blockers.append(xy)
                bnames.append(name)
    gl, gb = _Index([pts for _, pts, _ in lanes]), _Index(blockers)

    nb = int(math.ceil(B.length / spacing))
    width = [0.0] * nb
    counted, flags_by_lane, blocked_by = [], [], {}
    for name, pts, near in lanes:
        flags = []
        for (x, y), (d, a, q) in zip(pts, near):
            ok = True
            if d > 30:
                lt = [t for t, _ in gl.hits(q, (x, y)) if t < 0.98]
                first_lane = min(lt) if lt else None
                bt = [bi for t, bi in gb.hits(q, (x, y), True) if first_lane is not None and first_lane < t < 0.97]
                ok = not bt
                if bt:
                    blocked_by[(name, bnames[bt[0]])] = blocked_by.get((name, bnames[bt[0]]), 0) + 1
            b = min(nb - 1, int(a // spacing))
            if ok:
                width[b] = max(width[b], d)
                counted.append((b, x, y))
            flags.append(ok)
        flags_by_lane.append(flags)

    W0 = [0.0 if w == 0 else max(wmin, w + margin) for w in width]
    k = int(round(float(c.get('gap_fill_m', 0)) / spacing))
    W1 = _closing(W0, k) if k else W0
    W = [0 if w == 0 else int(math.ceil(w / 5) * 5) for w in W1]

    # verificação: cada ponto contado precisa cair na faixa do seu trecho (ou de um vizinho); o resto vai como linha
    polys = {}

    def poly(b):
        b %= nb
        if b not in polys:
            pts, norms = B.subpath(b * spacing - 1.0, min((b + 1) * spacing, B.length) + 1.0)
            polys[b] = offset_polygon(pts, norms, W[b]) if W[b] > 0 else None
        return polys[b]

    uncovered = set()
    for (b, x, y) in counted:
        if not any(poly(j) and winding(x, y, poly(j)) != 0 for j in (b, b - 1, b + 1)):
            uncovered.add((round(x, 3), round(y, 3)))
    extra = []
    for (name, pts, near), flags in zip(lanes, flags_by_lane):
        run = []
        for (x, y), ok in zip(pts, flags):
            if not ok or (round(x, 3), round(y, 3)) in uncovered:
                run.append(to_ll(x, y))
            elif run:
                extra.append(run)
                run = []
        if run:
            extra.append(run)

    # trechos consecutivos com a mesma largura viram uma faixa só
    runs, b = [], 0
    while b < nb:
        if W[b] == 0:
            b += 1
            continue
        e = b
        while e + 1 < nb and W[e + 1] == W[b]:
            e += 1
        a0, a1 = b * spacing, min((e + 1) * spacing, B.length)
        runs.append([*to_ll(*B.at(a0)[0]), round(a0, 1), round(a1 - a0, 1), int(W[b])])
        b = e + 1

    ws = sorted(w for w in W if w > 0)
    stats = {
        'trechos_com_pista': len(ws), 'faixas': len(runs), 'largura_mediana_m': ws[len(ws) // 2] if ws else 0,
        'largura_max_m': ws[-1] if ws else 0, 'trechos_preenchidos': sum(1 for a, b2 in zip(W0, W1) if b2 > a),
        'segmentos_de_pista': len(lanes), 'pontos_de_pista': sum(len(p) for _, p, _ in lanes),
        'pontos_fora_da_faixa': sum(len(r) for r in extra), 'linhas_com_buffer': len(extra),
        'segmentos_descartados_longe_da_borda': dropped,
    }
    print(json.dumps(stats, ensure_ascii=False))
    for (ln, bn), n in sorted(blocked_by.items(), key=lambda kv: -kv[1])[:20]:
        print(f'  raio bloqueado: {n:4d} pontos de {ln} por {bn}')
    return runs, extra, stats


def corridor_cut_sql(mian_geom):
    """SQL do polígono do rodízio de caminhões: mian menos as faixas da borda e as linhas das pistas (buffer)."""
    c = cfg['minianel_corridors']
    B = Border(outer_ring(mian_geom))
    parts = []
    for lon, lat, a0, length, w in c.get('width_profile', []):
        p, _ = B.at(a0)
        q = to_xy((lon, lat))
        if math.hypot(p[0] - q[0], p[1] - q[1]) > 2:
            raise SystemExit(f'a borda do Minianel mudou desde a medição (arco {a0} m): rode --measure de novo')
        pts, norms = B.subpath(a0 - 1.0, a0 + length + 1.0)
        P = offset_polygon(pts, norms, float(w))
        parts.append(f"ST_MakeValid({gj({'type': 'Polygon', 'coordinates': [[to_ll(*v) for v in P + [P[0]]]]})})")
    lines = [l if len(l) > 1 else [l[0], l[0]] for l in c.get('lane_buffers', []) if l]
    if lines:
        parts.append(f"ST_Buffer({gj({'type': 'MultiLineString', 'coordinates': lines})}::geography, {float(c['margin_m'])})::geometry")
    if not parts:
        return f'ST_Multi({gj(mian_geom)})'
    cut = 'ST_UnaryUnion(ST_Collect(ARRAY[\n      ' + ',\n      '.join(parts) + ']))'
    return f"ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_Difference({gj(mian_geom)},\n    {cut})), 3))"


# ------------------------------------------------------------------------------------------------------- feriados
IBGE_SP = '3550308'
L662 = 'Lei 662/1949 art. 1º (red. Lei 10.607/2002)'
NATIONAL_FIXED = [
    ((1, 1), 'Confraternização Universal', L662),
    ((4, 21), 'Tiradentes', L662),
    ((5, 1), 'Dia do Trabalho', L662),
    ((9, 7), 'Independência do Brasil', L662),
    ((10, 12), 'Nossa Senhora Aparecida', 'Lei 6.802/1980 art. 1º'),
    ((11, 2), 'Finados', L662 + '; também Lei municipal SP 14.485/2007 art. 10'),
    ((11, 15), 'Proclamação da República', L662),
    ((11, 20), 'Dia Nacional de Zumbi e da Consciência Negra', 'Lei 14.759/2023 art. 1º; também Lei municipal SP 14.485/2007 arts. 9º e 10'),
    ((12, 25), 'Natal', L662),
]
STATE_SP = [((7, 9), 'Revolução Constitucionalista de 1932 (data magna de SP)', 'Lei estadual SP 9.497/1997 art. 1º; Lei federal 9.093/1995 art. 1º II')]
L14485_REL = 'Lei municipal SP 14.485/2007 art. 10; Lei federal 9.093/1995 art. 2º'
MUNICIPAL_SP_FIXED = [((1, 25), 'Aniversário da cidade de São Paulo', L14485_REL)]
HOLIDAY_SOURCE = 'lei (calculado por scripts/gen-zones-seed.py)'
HOLIDAY_URLS = ('https://www.planalto.gov.br/ccivil_03/leis/l0662.htm ; https://www.planalto.gov.br/ccivil_03/leis/l6802.htm ; '
                'https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm ; '
                'https://www.al.sp.gov.br/repositorio/legislacao/lei/1997/lei-9497-05.03.1997.html ; '
                'https://saopaulo.sp.leg.br/iah/fulltext/leis/L14485.pdf')
HOLIDAY_LICENSE = 'Atos oficiais: domínio público (Lei 9.610/1998 art. 8º IV).'


def easter(year):
    """Domingo de Páscoa (algoritmo gregoriano anônimo / Meeus-Jones-Butcher)."""
    a = year % 19; b = year // 100; c = year % 100
    d = b // 4; e = b % 4; f = (b + 8) // 25; g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4; k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


def holidays_for(year):
    """Nacionais, estadual de SP e municipais da capital. Carnaval NÃO é feriado (ponto facultativo; a CET mantém a ZMRC)."""
    out = []
    for (mth, d), name, basis in NATIONAL_FIXED:
        out.append({'day': dt.date(year, mth, d), 'scope': 'national', 'uf': None, 'ibge_code': None, 'name': name, 'legal_basis': basis})
    for (mth, d), name, basis in STATE_SP:
        out.append({'day': dt.date(year, mth, d), 'scope': 'state', 'uf': 'SP', 'ibge_code': None, 'name': name, 'legal_basis': basis})
    for (mth, d), name, basis in MUNICIPAL_SP_FIXED:
        out.append({'day': dt.date(year, mth, d), 'scope': 'municipal', 'uf': 'SP', 'ibge_code': IBGE_SP, 'name': name, 'legal_basis': basis})
    e = easter(year)
    out.append({'day': e - dt.timedelta(days=2), 'scope': 'municipal', 'uf': 'SP', 'ibge_code': IBGE_SP,
                'name': 'Sexta-feira da Paixão', 'legal_basis': L14485_REL})
    out.append({'day': e + dt.timedelta(days=60), 'scope': 'municipal', 'uf': 'SP', 'ibge_code': IBGE_SP,
                'name': 'Corpus Christi', 'legal_basis': L14485_REL})
    return sorted(out, key=lambda h: (h['day'], h['scope']))


def holidays_seed(years):
    def s(v):
        return 'null' if v is None else "'" + str(v).replace("'", "''") + "'"
    rows = [h for y in range(years[0], years[1] + 1) for h in holidays_for(y)]
    tag = f'seed {years[0]}-{years[1]}'
    vals = [f"  ('{h['day'].isoformat()}', {s(h['scope'])}, {s(h['uf'])}, {s(h['ibge_code'])}, {s(h['name'])}, "
            f"{s(HOLIDAY_SOURCE)}, {s(h['legal_basis'])})" for h in rows]
    return '\n'.join([
        '-- GERADO por scripts/gen-zones-seed.py (config/zmrc-rules.json: holiday_years). Não edite à mão. Requer a migration 0101.',
        f'-- Feriados {years[0]}–{years[1]} que suspendem ZMRC, rodízio e restrição de produtos perigosos em São Paulo.',
        '-- Nacionais: Lei 662/1949 (red. Lei 10.607/2002), Lei 6.802/1980, Lei 14.759/2023. Estadual: Lei SP 9.497/1997.',
        '-- Municipais (São Paulo, IBGE 3550308): Lei municipal 14.485/2007 art. 10. Carnaval NÃO é feriado (ponto facultativo).',
        'insert into holidays (day, scope, uf, ibge_code, name, source, legal_basis) values',
        ',\n'.join(vals),
        "on conflict (day, scope, coalesce(uf, ''), coalesce(ibge_code, '')) do update",
        '  set name = excluded.name, source = excluded.source, legal_basis = excluded.legal_basis;',
        'insert into data_layer_runs (layer_id, source, source_url, license, record_count, notes)',
        f"select 'core_legal', 'feriados-sp', {s(HOLIDAY_URLS)}, {s(HOLIDAY_LICENSE)}, {len(rows)}, {s(tag)}",
        f"where not exists (select 1 from data_layer_runs where layer_id = 'core_legal' and source = 'feriados-sp' and notes = {s(tag)});",
    ]) + '\n', rows


def check_brasilapi(years, rows):
    """A BrasilAPI marca Carnaval como feriado nacional e não traz os municipais: serve só para conferir (avisa diferenças)."""
    ours = {h['day'].isoformat() for h in rows}
    for y in range(years[0], years[1] + 1):
        try:
            req = urllib.request.Request(f'https://brasilapi.com.br/api/feriados/v1/{y}', headers={'User-Agent': 'truck-router-mvp/0.1'})
            data = json.load(urllib.request.urlopen(req, timeout=30))
        except Exception as e:                             # noqa: BLE001
            print(f'  ! BrasilAPI {y} indisponível ({type(e).__name__})')
            continue
        for h in data:
            if h.get('name', '').lower() not in ('carnaval', 'páscoa') and h['date'] not in ours:
                print(f"  ! BrasilAPI lista {h['date']} ({h['name']}) que não está na base legal")


# ----------------------------------------------------------------------------------------------------------- main
def write_config():
    txt = json.dumps(cfg, ensure_ascii=False, indent=2)
    # perfis em uma linha por item (arquivo legível)
    txt = re.sub(r'\[\s+(-?\d+\.\d+),\s+(-?\d+\.\d+),\s+(-?\d+(?:\.\d+)?),\s+(-?\d+(?:\.\d+)?),\s+(\d+)\s+\]', r'[\1, \2, \3, \4, \5]', txt)
    txt = re.sub(r'\[\s+(-?\d+\.\d+),\s+(-?\d+\.\d+)\s+\]', r'[\1, \2]', txt)
    cfg_path.write_text(txt + '\n', encoding='utf-8')


m = load('geosampa_restricao_circulacao_veiculo_mian.geojson')

if '--measure' in sys.argv:
    if not m:
        raise SystemExit('falta data/raw/geosampa_restricao_circulacao_veiculo_mian.geojson')
    runs, extra, stats = measure(m[0])
    c = cfg['minianel_corridors']
    c['measured'] = {'date': dt.date.today().isoformat(), **stats}
    c['width_profile'] = runs
    c['lane_buffers'] = extra
    write_config()
    print(f'ok: {len(runs)} faixas e {len(extra)} linhas gravadas em {cfg_path.relative_to(root)}')

zones = []  # (id, name, geom_sql, endpoint_sql, rules, source)
z = load('geosampa_restricao_circulacao_veiculo_zmrc.geojson')
if z:
    zones.append((ZMRC_ID, cfg['name'], f"ST_Multi({gj(z[0])})", None, cfg['rules'], z[1]))
if m:
    for oz in cfg.get('other_zones', []):
        if oz['geometry'] == 'mian':
            zones.append((oz['id'], oz['name'], f"ST_Multi({gj(m[0])})", None, oz['rules'], m[1]))
        elif oz['geometry'] == 'mian_minus_corridors':
            meas = cfg['minianel_corridors'].get('measured', {})
            src = (m[1] + ' menos o corredor das vias do Minianel medido sobre GeoSampa WFS geoportal:segmento_logradouro '
                   f"({GEOSAMPA_LICENSE}; medição de {meas.get('date', '?')}; config/zmrc-rules.json: minianel_corridors)")
            zones.append((oz['id'], oz['name'], corridor_cut_sql(m[0]), f"ST_Multi({gj(m[0])})", oz['rules'], src))
        else:
            raise SystemExit(f"geometria desconhecida: {oz['geometry']}")

out = ['-- GERADO por scripts/gen-zones-seed.py a partir de data/raw (GeoSampa WFS) e config/zmrc-rules.json. Não edite à mão.',
       '-- Regras conferidas nas normas em 09/10/2026 (ver docs/layers/core_legal.md). Requer a migration 0101 (geom_endpoint).',
       '-- Dados geográficos: GeoSampa/Prefeitura de São Paulo, CC-BY-SA 4.0. Nenhum dado do OpenStreetMap.']
for id_, name, geom_sql, endpoint_sql, rules, src in zones:
    out.append(
        "insert into restriction_zones (id, name, geom, geom_endpoint, rules, source) values\n"
        f"  ('{id_}', $n${name}$n$, {geom_sql},\n   {endpoint_sql or 'null'},\n"
        f"   $r${json.dumps(rules, ensure_ascii=False)}$r$::jsonb, $s${src}$s$)\n"
        "on conflict (id) do update set name = excluded.name, geom = excluded.geom, geom_endpoint = excluded.geom_endpoint,\n"
        "  rules = excluded.rules, source = excluded.source, active = true;"
    )
(root / 'db' / 'seed' / '0002_zones.sql').write_text('\n'.join(out) + '\n', encoding='utf-8')
print(f'ok: {len(zones)} zonas -> db/seed/0002_zones.sql')

hy = cfg.get('holiday_years')
if hy:
    sql, rows = holidays_seed(hy)
    (root / 'db' / 'seed' / '0004_holidays.sql').write_text(sql, encoding='utf-8')
    print(f'ok: {len(rows)} feriados {hy[0]}-{hy[1]} -> db/seed/0004_holidays.sql')
    if '--check-brasilapi' in sys.argv:
        check_brasilapi(hy, rows)
