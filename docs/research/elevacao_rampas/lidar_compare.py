#!/usr/bin/env python3
"""Compara rampa das vias OSM (área-teste) entre DEMs globais e o DTM LiDAR 1 m da PMSP (referência).
Uso: python3 lidar_compare.py roads.geojsonseq lidar_4326.tif out.json minlon minlat maxlon maxlat
"""
import json
import sys

import numpy as np

sys.path.insert(0, "/w")
from grade_analysis import Dem, DEMS, resample  # noqa: E402

src, lidar_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
bb = [float(x) for x in sys.argv[4:8]]
dems = {k: Dem(v) for k, v in DEMS.items()}
ref = Dem(lidar_path)
names = list(dems)
res = {}
for step in (60.0, 30.0):
    g_ref, g_dem = [], {n: [] for n in names}
    z_ref, z_dem = [], {n: [] for n in names}
    wmax_ref, wmax_dem = [], {n: [] for n in names}
    km = 0.0
    nw = 0
    with open(src) as f:
        for line in f:
            ft = json.loads(line.strip().lstrip("\x1e"))
            p = ft["properties"]
            co = np.array(ft["geometry"]["coordinates"], dtype=np.float64)
            lon, lat = co[:, 0], co[:, 1]
            if lon.min() < bb[0] or lon.max() > bb[2] or lat.min() < bb[1] or lat.max() > bb[3]:
                continue
            if p.get("bridge") not in (None, "no") or p.get("tunnel") not in (None, "no") or p.get("covered") == "yes":
                continue
            if p.get("highway") in ("service",) and p.get("service") in ("parking_aisle", "driveway"):
                continue
            rl, rt, s, L = resample(lon, lat, step)
            if L < 10:
                continue
            ds = np.diff(s)
            zr = ref.sample(rl, rt)
            if np.isnan(zr).any():
                continue
            nw += 1
            km += L / 1000
            gr = np.diff(zr) / ds * 100
            g_ref.append(gr)
            z_ref.append(zr)
            wmax_ref.append(np.abs(gr).max())
            for n in names:
                z = dems[n].sample(rl, rt)
                g = np.diff(z) / ds * 100
                g_dem[n].append(g)
                z_dem[n].append(z)
                wmax_dem[n].append(np.abs(g).max())
    G = np.abs(np.concatenate(g_ref))
    Zr = np.concatenate(z_ref)
    W = np.array(wmax_ref)
    r = {"ways": nw, "km": round(km, 2), "intervalos": int(G.size),
         "ref_lidar_pct_intervalos_acima": {t: round(float((G > t).mean() * 100), 1) for t in (5, 8, 12, 15)}}
    for n in names:
        Gd = np.abs(np.concatenate(g_dem[n]))
        Zd = np.concatenate(z_dem[n])
        Wd = np.array(wmax_dem[n])
        err = Gd - G
        st = {"rampa_mae_pp": round(float(np.mean(np.abs(err))), 2),
              "rampa_rmse_pp": round(float(np.sqrt(np.mean(err ** 2))), 2),
              "rampa_bias_pp": round(float(np.mean(err)), 2),
              "altura_bias_m": round(float(np.nanmean(Zd - Zr)), 2),
              "altura_rmse_m": round(float(np.sqrt(np.nanmean((Zd - Zr) ** 2))), 2),
              "pct_intervalos_acima": {t: round(float((Gd > t).mean() * 100), 1) for t in (5, 8, 12, 15)}}
        for t in (8, 12, 15):
            tp = int(((Gd > t) & (G > t)).sum())
            fp = int(((Gd > t) & (G <= t)).sum())
            fn = int(((Gd <= t) & (G > t)).sum())
            st[f"thr{t}"] = {"tp": tp, "fp": fp, "fn": fn,
                             "precisao": round(tp / (tp + fp), 2) if tp + fp else None,
                             "recall": round(tp / (tp + fn), 2) if tp + fn else None}
            tpw = int(((Wd > t) & (W > t)).sum())
            fpw = int(((Wd > t) & (W <= t)).sum())
            fnw = int(((Wd <= t) & (W > t)).sum())
            st[f"ways_thr{t}"] = {"tp": tpw, "fp": fpw, "fn": fnw}
        r[n] = st
    res[f"posting_{int(step)}m"] = r
json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
print(json.dumps(res, ensure_ascii=False, indent=1))
