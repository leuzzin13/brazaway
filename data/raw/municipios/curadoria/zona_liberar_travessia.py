"""Recorta de uma zona municipal já gerada (a "mancha" original, sem recorte, em data/raw/municipios/curadoria/base/) a
travessia da rodovia, que o ato municipal não alcança, e grava o resultado em data/raw/municipios/geo/. Sempre parta
da mancha (--base): recortar de novo um resultado já recortado muda os vértices.

Critério de Arcos e Santa Branca: saem da zona, com folga de cada lado, a rodovia (vias com ref de rodovia, p. ex. BR-393,
RJ-186) e as ruas por onde ela passa (trunk/primary sem ref e *_link incluídos, mais os nomes/ids dados). Ver
data/raw/municipios/curadoria/zona_rodovia_lib.py. As vias vêm de TODAS as ways highway do PBF local
(osm_pbf_vias.py → data/cache/municipios/osm_hw_<ibge>.json). A zona NÃO é simplificada aqui (Pirapetinga e Piranga já
têm menos de 300 vértices).

  python3 data/raw/municipios/curadoria/zona_liberar_travessia.py --epsg 31983 --osm data/cache/municipios/osm_hw_3151107.json \\
      --refs BR-393 RJ-186 --folga 40 --base data/raw/municipios/curadoria/base/3151107_perimetro_urbano_mancha.geojson \\
      data/raw/municipios/geo/3151107_perimetro_urbano.geojson

Requer shapely e pyproj. Vias do OpenStreetMap (ODbL 1.0, © colaboradores do OSM).
"""
import argparse
import json
import pathlib
import sys

from shapely.geometry import shape
from shapely.ops import unary_union

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import zona_rodovia_lib as L  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('geojson')
    ap.add_argument('--osm', required=True)
    ap.add_argument('--base', help='mancha original (sem recorte); omitido = o próprio arquivo de saída')
    ap.add_argument('--epsg', type=int, required=True, help='UTM SIRGAS 2000 do município (31982 = 22S, 31983 = 23S)')
    ap.add_argument('--refs', nargs='*', default=None, help='refs das rodovias livres (omitido = qualquer ref de rodovia)')
    ap.add_argument('--nomes', nargs='*', default=[], help='nomes exatos de vias sem ref que fazem parte da travessia')
    ap.add_argument('--ids', nargs='*', type=int, default=[], help='ids de way do OSM a liberar')
    ap.add_argument('--folga', type=float, default=40)
    ap.add_argument('--min-area', type=float, default=20000, help='m² mínimos de cada parte que sobra')
    ap.add_argument('--nota', default='', help='texto para fonte_geometria')
    a = ap.parse_args()
    p = pathlib.Path(a.geojson)
    fc = json.loads(pathlib.Path(a.base or a.geojson).read_text())
    to_utm, to_ll = L.projecoes(a.epsg)
    Z = L.sem_furos(unary_union([to_utm(shape(f['geometry'])) for f in fc['features']]))
    livres = [x for x in L.vias_livres(a.osm, to_utm, refs=a.refs, nomes=a.nomes, ids=a.ids) if x[2].distance(Z) < 400]
    R, _ = L.recortar(Z, livres, a.folga, min_area_m2=a.min_area)
    dmin = L.verificar(R, livres, a.folga)
    fc['features'] = [{'type': 'Feature', 'properties': fc['features'][0]['properties'], 'geometry': L.para_geojson_coords(to_ll(R))}]
    marca = f'Travessia da rodovia livre: vias com ref de rodovia, trunk/primary sem ref e ligações recortadas com folga de {a.folga:g} m (OSM, ODbL 1.0).'
    base = fc.get('fonte_geometria', '')
    fc['fonte_geometria'] = (base[:base.index(' Travessia da rodovia livre')] if ' Travessia da rodovia livre' in base else base) + ' ' + marca
    if 'area_km2' in fc:
        fc['area_km2'] = round(R.area / 1e6, 3)
    p.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{p.name}: {len(getattr(R, "geoms", [R]))} parte(s), {L.contar_vertices(R)} vértices, {len(livres)} vias livres '
          f'({", ".join(sorted({t.get("ref") or t.get("name") or t["highway"] for _, t, _ in livres}))[:200]}), '
          f'menor distância a elas {dmin:.0f} m, {R.area / 1e6:.2f} km² (antes {Z.area / 1e6:.2f})')


if __name__ == '__main__':
    main()
