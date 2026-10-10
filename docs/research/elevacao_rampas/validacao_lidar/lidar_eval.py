# Validação da camada relevo contra o LiDAR da PMSP (DTM 1 m de Sumaré/Perdizes, Freguesia do Ó e Mooca).
# Entrada: JSON com rotas anotadas pela camada (reanotar.mts); saída: precisão dos trechos "evitar"/"atenção" e recall das
# rampas reais > limite "evitar" por >= 30 m (média móvel de 120 m no LiDAR). Ver docs/layers/relevo.md.
#
#   docker run --rm -v elevwork_data:/w:ro -v $PWD/data/cache/relevo_val:/v \
#     -v $PWD/docs/research/elevacao_rampas/validacao_lidar:/s:ro ghcr.io/osgeo/gdal:ubuntu-small-3.9.3 \
#     python3 /s/lidar_eval.py /v/carreta_atual.json [-v]
#
# Os rasters (/w/dem/lidar_*_4326.tif) são os da pesquisa (docs/research/elevacao_rampas/NOTES.md §4), no volume
# docker elevwork_data; as 178 rotas aleatórias de carreta ficam em data/cache/relevo_val/carreta.json (fora do git).
import json, math, sys
import numpy as np
from osgeo import gdal
gdal.UseExceptions()
RAS = {'sumare': '/w/dem/lidar_dtm_sumare_4326.tif', 'fo': '/w/dem/lidar_fo_4326.tif', 'mooca': '/w/dem/lidar_mooca_4326.tif'}
R = {}
for k, f in RAS.items():
    ds = gdal.Open(f); a = ds.GetRasterBand(1).ReadAsArray().astype('float64'); a[a <= -9000] = np.nan
    R[k] = (a, ds.GetGeoTransform())
def sample(area, lon, lat):
    a, gt = R[area]
    c = (lon - gt[0]) / gt[1] - 0.5; r = (lat - gt[3]) / gt[5] - 0.5
    c0 = int(math.floor(c)); r0 = int(math.floor(r))
    if c0 < 0 or r0 < 0 or c0 + 1 >= a.shape[1] or r0 + 1 >= a.shape[0]: return float('nan')
    fc = c - c0; fr = r - r0
    v = a[r0, c0] * (1 - fc) * (1 - fr) + a[r0, c0 + 1] * fc * (1 - fr) + a[r0 + 1, c0] * (1 - fc) * fr + a[r0 + 1, c0 + 1] * fc * fr
    return v
def hav(a, b):
    t = math.pi / 180; dl = (b[1] - a[1]) * t; dn = (b[0] - a[0]) * t
    s = math.sin(dl / 2) ** 2 + math.cos(a[1] * t) * math.cos(b[1] * t) * math.sin(dn / 2) ** 2
    return 2 * 6371008.8 * math.asin(min(1, math.sqrt(s)))
STEP = 5; HALF = 60
data = json.load(open(sys.argv[1]))
rows = []; recall = []
for rt in data:
    cs = rt['coords']; area = rt['area']
    cum = [0.0]
    for i in range(1, len(cs)): cum.append(cum[-1] + hav(cs[i - 1], cs[i]))
    tot = cum[-1]
    xs = np.arange(0, tot + 1e-6, STEP)
    pts = []; j = 0
    for x in xs:
        while j < len(cum) - 2 and cum[j + 1] < x: j += 1
        seg = cum[j + 1] - cum[j]; t = 0 if seg <= 0 else (x - cum[j]) / seg
        pts.append((cs[j][0] + (cs[j + 1][0] - cs[j][0]) * t, cs[j][1] + (cs[j + 1][1] - cs[j][1]) * t))
    z = np.array([sample(area, p[0], p[1]) for p in pts])
    n = len(xs); k = HALF // STEP
    g = np.full(n, np.nan)
    for i in range(k, n - k):
        g[i] = (z[i + k] - z[i - k]) / (2 * HALF) * 100
    lim = rt['limits']; W = lim['warn_pct']; A = lim['avoid_pct']
    def proj(p):
        d = [hav(p, q) for q in pts]; i = int(np.argmin(d)); return xs[i], d[i]
    preds = []
    for s in rt['segs']:
        s0, e0 = proj([s['start']['lon'], s['start']['lat']]); s1, e1 = proj([s['end']['lon'], s['end']['lat']])
        if s1 < s0: s0, s1 = s1, s0
        m = (xs >= s0) & (xs <= s1)
        gv = g[m]
        valid = np.isfinite(gv).mean() if len(gv) else 0
        pre_evitar = s['max_up_pct'] > A and s['over_avoid_m'] >= 30
        row = dict(area=area, name=s['name'], rc=s['road_class'], level=s['level'], bump=s['bump'], pre_evitar=pre_evitar,
                   up=s['max_up_pct'], rise=s.get('rise_m'), relief=s.get('relief_m'), undone=s.get('undone_m'), len=s['length_m'],
                   key=(round(s['start']['lat'], 4), round(s['start']['lon'], 4), round(s['end']['lat'], 4), round(s['end']['lon'], 4)),
                   lidar_max=float(np.nanmax(gv)) if valid >= 0.8 else None,
                   lidar_over_avoid=float(np.sum(gv > A) * STEP) if valid >= 0.8 else None, valid=valid)
        row['post_evitar'] = s['level'] == 'evitar'; row['hidden'] = s.get('hidden', False)
        rows.append(row); preds.append((s0, s1, pre_evitar, s['bump'], s['level'] == 'evitar', s.get('hidden', False)))
    # recall: corridas LiDAR > A por >= 30 m (folga 50 m)
    runs = []; cur = None
    for i in range(n):
        if np.isfinite(g[i]) and g[i] > A:
            if cur and xs[i] - cur[1] <= 50: cur[1] = xs[i]
            else:
                if cur: runs.append(cur)
                cur = [xs[i], xs[i]]
    if cur: runs.append(cur)
    for r0, r1 in runs:
        over = float(np.sum((xs >= r0) & (xs <= r1) & (g > A)) * STEP)
        if over < 30: continue
        mx = float(np.nanmax(g[(xs >= r0) & (xs <= r1)]))
        hit_pre = any(p[2] and p[0] <= r1 + 30 and p[1] >= r0 - 30 for p in preds)
        hit_post = any(p[4] and p[0] <= r1 + 30 and p[1] >= r0 - 30 for p in preds)
        hit_warn = any(not p[5] and p[0] <= r1 + 30 and p[1] >= r0 - 30 for p in preds)
        hit_warn_nobump = any(not p[3] and p[0] <= r1 + 30 and p[1] >= r0 - 30 for p in preds)
        hit_any = any(p[0] <= r1 + 30 and p[1] >= r0 - 30 for p in preds)
        p0 = pts[int(r0 / STEP)]
        recall.append(dict(area=area, key=(round(p0[1], 4), round(p0[0], 4)), mx=mx, over=over, hit_pre=hit_pre, hit_post=hit_post, hit_any=hit_any, hit_warn=hit_warn, hit_warn_nobump=hit_warn_nobump))
def uniq(rs, kf):
    seen = {}
    for r in rs: seen.setdefault(kf(r), r)
    return list(seen.values())
U = uniq([r for r in rows if r['lidar_max'] is not None], lambda r: r['key'])
print('segmentos com LiDAR (únicos):', len(U), 'de', len(rows), 'linhas')
def tab(label, sel):
    xs = [r for r in U if sel(r)]
    if not xs: print(label, 0); return
    t8 = sum(1 for r in xs if r['lidar_max'] > 8); t6 = sum(1 for r in xs if r['lidar_max'] > 6)
    print(f"{label:46s} n={len(xs):3d}  LiDAR>8%: {t8:3d} ({t8/len(xs):.0%})  LiDAR>6%: {t6:3d} ({t6/len(xs):.0%})")
tab('EVITAR (saída nova)', lambda r: r['post_evitar'])
tab('ATENÇÃO (saída nova, com aviso)', lambda r: not r['post_evitar'] and not r['hidden'])
tab('  das quais lombada rebaixada', lambda r: not r['post_evitar'] and not r['hidden'] and r['bump'])
tab('OCULTAS (lombada em avenida)', lambda r: r['hidden'])
tab('todas as lombadas', lambda r: r['bump'])
tab('pré-filtro evitar', lambda r: r['pre_evitar'])
tab('pré-filtro evitar, sem lombada (= evitar novo)', lambda r: r['pre_evitar'] and not r['bump'])
tab('pré-filtro evitar, lombada', lambda r: r['pre_evitar'] and r['bump'])
tab('atenção (não evitar), sem lombada', lambda r: not r['pre_evitar'] and not r['bump'])
tab('atenção (não evitar), lombada', lambda r: not r['pre_evitar'] and r['bump'])
for area in ['sumare', 'fo', 'mooca']:
    tab(f'  [{area}] evitar novo', lambda r, a=area: r['area'] == a and r['pre_evitar'] and not r['bump'])
    tab(f'  [{area}] lombada (qualquer nível)', lambda r, a=area: r['area'] == a and r['bump'])
RU = uniq(recall, lambda r: r['key'])
print('rampas reais LiDAR > avoid por >= 30 m (únicas):', len(RU))
print('  com evitar (sem filtro de lombada):', sum(r['hit_pre'] for r in RU), ' com evitar (saída nova):', sum(r['hit_post'] for r in RU), ' com algum aviso (saída nova):', sum(r['hit_warn'] for r in RU), ' com algum aviso se toda lombada sumisse:', sum(r['hit_warn_nobump'] for r in RU), ' com qualquer trecho:', sum(r['hit_any'] for r in RU))
if '-v' in sys.argv:
    for r in sorted(U, key=lambda r: (r['area'], -r['up'])):
        if r['bump'] or r['pre_evitar'] or r['post_evitar']:
            print(f"   {r['area']:6s} {'H' if r['hidden'] else ('B' if r['bump'] else ' ')} {'E' if r['post_evitar'] else 'a'} {r['name'][:30]:30s} {r['rc'] or '':12s} up={r['up']:5.1f} rise={r['rise']} undone={r['undone']} relief={r.get('relief')} len={r['len']:4d}  lidar={r['lidar_max']:5.1f}")
    for r in RU:
        if not r['hit_warn']: print('   sem aviso:', r)
