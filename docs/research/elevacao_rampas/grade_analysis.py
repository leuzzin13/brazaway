#!/usr/bin/env python3
"""Rampa das vias OSM (bbox S24W047) segundo 4 DEMs, imitando o elevationbuilder do Valhalla.

Valhalla (src/mjolnir/elevationbuilder.cc): reamostra a geometria da aresta a cada 60 m
(POSTING_INTERVAL), amostra altura bilinear, calcula rampa por intervalo; arestas < 10 m ficam com rampa 0.
Aqui fazemos o mesmo por *way* OSM (aproximação: o Valhalla quebra ways em arestas nos cruzamentos).

Uso: python3 grade_analysis.py roads.geojsonseq out.json
"""
import json
import math
import re
import sys

import numpy as np
from osgeo import gdal

BBOX = (-47.0, -24.0, -46.0, -23.0)
POSTING = 60.0
MIN_LEN = 10.0
BINS = [0, 3, 5, 8, 10, 12, 15, 20, 1000]

DEMS = {
    "copernicus_glo30": "/w/dem/cop.tif",
    "srtm_skadi_valhalla": "/w/dem/S24W047.hgt",
    "topodata_inpe": "/w/dem/topo_23S48_ZN.tif",
    "anadem_v1": "/w/dem/anadem_S24W047.tif",
}
if __name__ == "__main__" and len(sys.argv) > 3:
    for extra in sys.argv[3:]:
        if "=" in extra:
            k, v = extra.split("=", 1)
            DEMS[k] = v


class Dem:
    def __init__(self, path):
        ds = gdal.Open(path)
        self.gt = ds.GetGeoTransform()
        b = ds.GetRasterBand(1)
        self.nodata = b.GetNoDataValue()
        self.a = b.ReadAsArray().astype(np.float64)
        if self.nodata is not None:
            self.a[self.a == self.nodata] = np.nan
        self.a[self.a < -1000] = np.nan
        self.h, self.w = self.a.shape

    def sample(self, lon, lat):
        gt = self.gt
        # coordenada fracionária relativa ao CENTRO dos pixels
        px = (lon - gt[0]) / gt[1] - 0.5
        py = (lat - gt[3]) / gt[5] - 0.5
        x0 = np.floor(px).astype(int)
        y0 = np.floor(py).astype(int)
        fx = px - x0
        fy = py - y0
        x0 = np.clip(x0, 0, self.w - 2)
        y0 = np.clip(y0, 0, self.h - 2)
        a = self.a
        v00 = a[y0, x0]
        v10 = a[y0, x0 + 1]
        v01 = a[y0 + 1, x0]
        v11 = a[y0 + 1, x0 + 1]
        return (v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy)


def seglen(lon, lat):
    R = 6371008.8
    la = np.radians(lat)
    dlat = np.diff(la)
    dlon = np.radians(np.diff(lon))
    h = np.sin(dlat / 2) ** 2 + np.cos(la[:-1]) * np.cos(la[1:]) * np.sin(dlon / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(h))


def resample(lon, lat, step):
    d = seglen(lon, lat)
    cum = np.concatenate([[0], np.cumsum(d)])
    L = cum[-1]
    n = max(int(math.floor(L / step)), 1)
    s = np.arange(0, n + 1) * step
    s = s[s < L]
    s = np.concatenate([s, [L]])
    return np.interp(s, cum, lon), np.interp(s, cum, lat), s, L


MAJOR = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link",
         "secondary", "secondary_link", "tertiary", "tertiary_link"}


def main():
    src, out = sys.argv[1], sys.argv[2]
    dems = {k: Dem(v) for k, v in DEMS.items()}
    names = list(dems)
    nb = len(BINS) - 1
    # km por bin de rampa máxima (por intervalo de 60 m), separados por grupo
    acc = {g: {n: np.zeros(nb) for n in names} for g in ("major", "minor")}
    acc_struct = {"bridge_or_tunnel_km": 0.0, "bridge_or_tunnel_ways": 0}
    total_km = {"major": 0.0, "minor": 0.0}
    ways_maxgrade = {n: [] for n in names}
    incline_cmp = []
    steep_examples = []
    n_ways = 0
    inc_re = re.compile(r"^\s*(-?\d+(?:[.,]\d+)?)\s*%\s*$")
    with open(src) as f:
        for line in f:
            line = line.strip().lstrip("\x1e")
            if not line:
                continue
            ft = json.loads(line)
            p = ft["properties"]
            co = np.array(ft["geometry"]["coordinates"], dtype=np.float64)
            lon, lat = co[:, 0], co[:, 1]
            if lon.min() < BBOX[0] + 0.002 or lon.max() > BBOX[2] - 0.002 or lat.min() < BBOX[1] + 0.002 or lat.max() > BBOX[3] - 0.002:
                continue
            hw = p.get("highway")
            grp = "major" if hw in MAJOR else "minor"
            rl, rt, s, L = resample(lon, lat, POSTING)
            if p.get("bridge") not in (None, "no") or p.get("tunnel") not in (None, "no") or p.get("covered") == "yes":
                acc_struct["bridge_or_tunnel_km"] += L / 1000
                acc_struct["bridge_or_tunnel_ways"] += 1
                continue
            n_ways += 1
            total_km[grp] += L / 1000
            if L < MIN_LEN:
                for n in names:
                    acc[grp][n][0] += L / 1000
                continue
            ds = np.diff(s)
            per_dem = {}
            for n in names:
                z = dems[n].sample(rl, rt)
                if np.isnan(z).any():
                    continue
                g = np.abs(np.diff(z)) / ds * 100.0
                idx = np.clip(np.digitize(g, BINS) - 1, 0, nb - 1)
                np.add.at(acc[grp][n], idx, ds / 1000)
                gmax = float(g.max())
                per_dem[n] = gmax
                if grp == "major":
                    ways_maxgrade[n].append(gmax)
            inc = p.get("incline")
            if inc and per_dem:
                m = inc_re.match(inc)
                if m:
                    v = abs(float(m.group(1).replace(",", ".")))
                    # rampa média do way inteiro (ponta a ponta) também
                    mean_g = {}
                    for n in names:
                        z = dems[n].sample(np.array([lon[0], lon[-1]]), np.array([lat[0], lat[-1]]))
                        mean_g[n] = round(float(abs(z[1] - z[0]) / L * 100), 1)
                    incline_cmp.append({"id": p.get("@id"), "highway": hw, "len_m": round(L), "incline_tag": v,
                                        "dem_max60": {k: round(x, 1) for k, x in per_dem.items()},
                                        "dem_mean": mean_g})
            if grp == "major" and per_dem.get("copernicus_glo30", 0) >= 15 and L >= 120 and len(steep_examples) < 400:
                steep_examples.append({"id": p.get("@id"), "highway": hw, "name": p.get("name"), "len_m": round(L),
                                       "max60": {k: round(x, 1) for k, x in per_dem.items()},
                                       "lon": round(float(lon[len(lon)//2]), 5), "lat": round(float(lat[len(lat)//2]), 5)})
    res = {"bbox": BBOX, "posting_m": POSTING, "bins_pct": BINS, "ways_analisados": n_ways,
           "total_km": total_km, "estruturas_excluidas": acc_struct,
           "km_por_bin": {g: {n: [round(x, 1) for x in acc[g][n]] for n in names} for g in acc},
           "pct_km_acima": {}, "incline_cmp": incline_cmp, "steep_examples_major": steep_examples}
    for g in acc:
        res["pct_km_acima"][g] = {}
        for n in names:
            a = acc[g][n]
            tot = a.sum()
            res["pct_km_acima"][g][n] = {f">{BINS[i]}%": round(float(a[i:].sum() / tot * 100), 2) for i in range(2, nb)}
            res["pct_km_acima"][g][n]["km_total_com_dado"] = round(float(tot), 1)
    for n in names:
        arr = np.array(ways_maxgrade[n])
        res.setdefault("major_ways_maxgrade_pctl", {})[n] = {q: round(float(np.percentile(arr, q)), 1) for q in (50, 90, 95, 99)}
    json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in res.items() if k not in ("incline_cmp", "steep_examples_major")}, ensure_ascii=False, indent=1))
    print("incline_cmp n=", len(incline_cmp))


if __name__ == "__main__":
    main()
