"""Simplifica PARA DENTRO (encolhe `tol` e simplifica com Douglas-Peucker, preservando a topologia: a zona nunca cresce) as zonas de um GeoJSON de data/raw/municipios/geo/, para
baixar o nº de vértices que vai ao `exclude_polygons` do Valhalla (limite de 20.000 vértices por rota, somando todas as
zonas). Só para zonas SEM rodovia recortada (p. ex. um distrito do IBGE): as que têm a travessia de uma rodovia livre
recortada são regeradas pelo próprio script de curadoria (simplifica antes do recorte e refaz o recorte depois).

  python3 data/raw/municipios/curadoria/simplificar_zona.py --epsg 31983 --tol 12 data/raw/municipios/geo/3300407_distrito_amparo.geojson

Grava no mesmo arquivo (o contorno recua entre 0 e 2*`tol` metros). Requer shapely e pyproj.
"""
import argparse
import json
import pathlib
import sys

from shapely.geometry import mapping, shape

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import zona_rodovia_lib as L  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('geojson')
ap.add_argument('--epsg', type=int, required=True)
ap.add_argument('--tol', type=float, required=True, help='tolerância em metros')
a = ap.parse_args()
p = pathlib.Path(a.geojson)
fc = json.loads(p.read_text())
to_utm, to_ll = L.projecoes(a.epsg)
antes = depois = 0
for f in fc['features']:
    g = shape(f['geometry'])
    antes += L.contar_vertices(g)
    s = to_ll(L.simplificar_para_dentro(to_utm(g), a.tol))
    depois += L.contar_vertices(s)
    m = mapping(s)
    rnd = lambda c: [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 6), round(c[1], 6)]
    f['geometry'] = {'type': m['type'], 'coordinates': rnd(m['coordinates'])}
p.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
print(f'{p.name}: {antes} -> {depois} vértices (tolerância {a.tol:g} m)')
