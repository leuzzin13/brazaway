#!/usr/bin/env python3
"""
Converte o ANADEM v1 (ANA/UFRGS, CC BY 4.0) para tiles HGT 1" (3601x3601, Int16) no layout que o
Valhalla (skadi) lê: <saida>/S24/S24W047.hgt.

Roda dentro do contêiner GDAL (ghcr.io/osgeo/gdal:ubuntu-small-3.9.3), lendo os COGs do ANADEM por HTTP range
(/vsicurl/), sem baixar os 64 GB. Só baixa os blocos que cobrem cada tile de 1°x1°.

Quais tiles: os mesmos que o `valhalla_build_elevation --from-tiles` baixaria do Skadi, isto é, as células de 1°
que contêm algum tile de nível 2 (0,25°) do grafo (--from-graph), ou uma bbox (--bbox).

Grade HGT: pixel-is-point; a linha/coluna 0 fica exatamente sobre o grau inteiro, então a extensão
pixel-is-area tem meia célula (1/7200°) de folga em cada lado. Reamostragem bilinear (o ANADEM tem ~0,97").
NoData do ANADEM (-9999, mar) vira -32768 (NoData do HGT/skadi).

Uso:
  python3 anadem_to_hgt.py --from-graph /graph/valhalla_tiles --out /out/elevation_data [-j 6]
  python3 anadem_to_hgt.py --bbox -47.3,-24.1,-45.6,-23.1 --out /out/elevation_data
  python3 anadem_to_hgt.py --tiles S24W047,S24W046 --out /out/elevation_data
Retomável: tile já convertido (25.934.402 bytes) é pulado.
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from math import floor, ceil
from pathlib import Path

BASE_URL = os.environ.get('ANADEM_BASE_URL', 'https://metadados.snirh.gov.br/files/anadem_v1_tiles')
# Zonas MGRS do ANADEM que cobrem o Sudeste e bordas (extensões conferidas com gdalinfo em 09/10/2026).
# Para outras regiões, acrescente as zonas (lista completa: docs/layers/relevo.md).
DEFAULT_ZONES = '21J,21K,22H,22J,22K,22L,23J,23K,23L,24K,24L'
HGT_SIZE = 3601 * 3601 * 2
HALF = 1.0 / 7200.0  # meia célula de 1"

GDAL_CONFIG = {
    'GDAL_DISABLE_READDIR_ON_OPEN': 'EMPTY_DIR',
    'CPL_VSIL_CURL_ALLOWED_EXTENSIONS': '.tif',
    'GDAL_HTTP_MULTIRANGE': 'YES',
    'GDAL_HTTP_MERGE_CONSECUTIVE_RANGES': 'YES',
    'GDAL_HTTP_MAX_RETRY': '8',
    'GDAL_HTTP_RETRY_DELAY': '3',
    'GDAL_HTTP_TIMEOUT': '120',
    'VSI_CACHE': 'TRUE',
    'VSI_CACHE_SIZE': '200000000',
    'CPL_VSIL_CURL_CHUNK_SIZE': '1048576',
    'GDAL_CACHEMAX': '512',
}


def tile_name(x: int, y: int) -> tuple[str, str]:
    hemi = 'S' if y < 0 else 'N'
    d = '%s%02d' % (hemi, abs(y))
    return d, '%s%s%03d' % (d, 'W' if x < 0 else 'E', abs(x))


def parse_name(name: str) -> tuple[int, int]:
    name = name.strip().upper().replace('.HGT', '')
    lat = int(name[1:3]) * (-1 if name[0] == 'S' else 1)
    lon = int(name[4:7]) * (-1 if name[3] == 'W' else 1)
    return lon, lat


def tiles_from_graph(graph_dir: Path) -> set[tuple[int, int]]:
    """Mesma regra do valhalla_build_elevation --from-tiles (tiles de nível 2, 0,25°)."""
    local = graph_dir / '2'
    if not local.is_dir():
        sys.exit(f'grafo sem nível 2 em {local}')
    out = set()
    for fp in local.rglob('*.gph'):
        tid = int(str(fp.parent.relative_to(local).joinpath(fp.stem)).replace(os.sep, ''))
        out.add((floor((tid % 1440) * 0.25 - 180), floor((tid // 1440) * 0.25 - 90)))
    return out


def tiles_from_bbox(s: str) -> set[tuple[int, int]]:
    x0, y0, x1, y1 = [float(v) for v in s.split(',')]
    return {(x, y) for x in range(floor(x0), ceil(x1)) for y in range(floor(y0), ceil(y1))}


def source_extents(zones: list[str]) -> list[tuple[str, tuple[float, float, float, float]]]:
    from osgeo import gdal
    gdal.UseExceptions()
    for k, v in GDAL_CONFIG.items():
        gdal.SetConfigOption(k, v)
    out = []
    for z in zones:
        url = f'/vsicurl/{BASE_URL}/anadem_v1_{z}.tif'
        try:
            ds = gdal.Open(url)
        except RuntimeError as e:
            print(f'AVISO: não abriu {url}: {e}', flush=True)
            continue
        gt = ds.GetGeoTransform()
        w, h = ds.RasterXSize, ds.RasterYSize
        out.append((url, (gt[0], gt[3] + h * gt[5], gt[0] + w * gt[1], gt[3])))
        ds = None
    return out


def convert(x: int, y: int, sources: list[str], out_dir: str) -> tuple[str, str, float]:
    from osgeo import gdal
    gdal.UseExceptions()
    for k, v in GDAL_CONFIG.items():
        gdal.SetConfigOption(k, v)
    d, name = tile_name(x, y)
    dest = Path(out_dir) / d / f'{name}.hgt'
    if dest.exists() and dest.stat().st_size == HGT_SIZE:
        return name, 'pulado (já existe)', 0.0
    t0 = time.time()
    dest.parent.mkdir(parents=True, exist_ok=True)
    mem = f'/vsimem/{name}.tif'
    gdal.Warp(
        mem, sources,
        format='GTiff',
        outputBounds=(x - HALF, y - HALF, x + 1 + HALF, y + 1 + HALF),
        width=3601, height=3601,
        dstSRS='EPSG:4326',
        resampleAlg='bilinear',
        outputType=gdal.GDT_Int16,
        srcNodata=-9999, dstNodata=-32768,
        multithread=True,
        warpMemoryLimit=512,
    )
    ds = gdal.Open(mem)
    band = ds.GetRasterBand(1)
    try:
        mn, mx = band.ComputeRasterMinMax(False)
    except RuntimeError:  # tile todo NoData (só mar): não grava
        ds = None
        gdal.Unlink(mem)
        return name, 'sem dados (mar)', time.time() - t0
    # o driver SRTMHGT exige o nome do arquivo no padrão do tile: grava num subdiretório temporário e move
    tmpdir = dest.parent / f'.tmp_{name}'
    tmpdir.mkdir(exist_ok=True)
    tmpfile = tmpdir / f'{name}.hgt'
    gdal.Translate(str(tmpfile), ds, format='SRTMHGT')
    ds = None
    gdal.Unlink(mem)
    os.replace(tmpfile, dest)
    for f in tmpdir.iterdir():
        f.unlink()
    tmpdir.rmdir()
    return name, f'ok (min {mn:.0f} m, máx {mx:.0f} m)', time.time() - t0


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--from-graph', type=Path)
    g.add_argument('--bbox')
    g.add_argument('--tiles')
    ap.add_argument('--out', required=True)
    ap.add_argument('--zones', default=os.environ.get('ANADEM_ZONES', DEFAULT_ZONES))
    ap.add_argument('-j', '--jobs', type=int, default=int(os.environ.get('JOBS', '6')))
    ap.add_argument('--list-only', action='store_true')
    a = ap.parse_args()

    if a.from_graph:
        tiles = tiles_from_graph(a.from_graph)
    elif a.bbox:
        tiles = tiles_from_bbox(a.bbox)
    else:
        tiles = {parse_name(t) for t in a.tiles.split(',') if t.strip()}
    names = sorted(tile_name(x, y)[1] for x, y in tiles)
    print(f'{len(tiles)} tiles HGT: {" ".join(names)}', flush=True)
    if a.list_only:
        return

    srcs = source_extents([z.strip() for z in a.zones.split(',') if z.strip()])
    print(f'{len(srcs)} COGs do ANADEM abertos', flush=True)
    jobs = []
    skipped_nocov = []
    for x, y in sorted(tiles):
        bb = (x - HALF, y - HALF, x + 1 + HALF, y + 1 + HALF)
        use = [u for u, e in srcs if e[0] < bb[2] and e[2] > bb[0] and e[1] < bb[3] and e[3] > bb[1]]
        if not use:
            skipped_nocov.append(tile_name(x, y)[1])
            continue
        jobs.append((x, y, use))
    if skipped_nocov:
        print(f'sem cobertura do ANADEM (pulados): {" ".join(skipped_nocov)}', flush=True)

    t0 = time.time()
    done = 0
    report = {}
    with ProcessPoolExecutor(max_workers=a.jobs) as ex:
        futs = {ex.submit(convert, x, y, use, a.out): (x, y) for x, y, use in jobs}
        for f in as_completed(futs):
            done += 1
            try:
                name, status, dt = f.result()
            except Exception as e:  # noqa: BLE001
                name, status, dt = tile_name(*futs[f])[1], f'ERRO {e}', 0.0
            report[name] = status
            print(f'[{done}/{len(jobs)}] {name}: {status} ({dt:.0f} s; total {time.time() - t0:.0f} s)', flush=True)
    errors = {k: v for k, v in report.items() if v.startswith('ERRO')}
    Path(a.out, 'anadem_hgt_report.json').write_text(json.dumps(
        {'tiles': report, 'sem_cobertura': skipped_nocov, 'segundos': round(time.time() - t0), 'fonte': BASE_URL,
         'licenca': 'ANADEM v1 (ANA/UFRGS) CC BY 4.0'}, indent=1))
    print(f'fim: {len(jobs) - len(errors)} ok, {len(errors)} erros, {time.time() - t0:.0f} s', flush=True)
    if errors:
        sys.exit(1)


if __name__ == '__main__':
    main()
