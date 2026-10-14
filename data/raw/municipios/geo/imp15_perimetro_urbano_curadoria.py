"""Lote IMP15 (SP): perímetro urbano aproximado pelos setores censitários urbanos do IBGE 2022, sem a travessia das
rodovias (o ato municipal não as alcança). Gera, conforme o município:

  3550902 São Simão               -> geo/3550902_perimetro_urbano.geojson  (Lei 2.825/2025)
  3540200 Pontal                  -> geo/3540200_perimetro_urbano.geojson  (Lei 2.031/1999; o Anel Viário Liliana Tenuto Rossi fica livre)
  3500550 Águas de Santa Bárbara  -> geo/3500550_perimetro_urbano.geojson  (Lei 1.842/2020)

  python3 data/raw/municipios/geo/imp15_perimetro_urbano_curadoria.py <ibge> <dir_ou_.shp dos setores de SP> <osm_hw.json>

Entradas:
  * IBGE, Malha de Setores Censitários do Censo 2022 (SP), shapefile de
    https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_de_setores_censitarios__divisoes_intramunicipais/censo_2022/setores/shp/UF/SP_setores_CD2022.zip
    (setores do distrito-sede com CD_SIT 1 ou 2 = área urbana de cidade ou vila; a situação segue o perímetro urbano legal);
  * data/cache/municipios/osm_hw_<ibge>.json, todas as vias highway do PBF local
    (python3 data/raw/municipios/curadoria/osm_pbf_vias.py -- <minlon,minlat,maxlon,maxlat> <saida>).

Critério da travessia (o mesmo de Arcos e Santa Branca, data/raw/municipios/curadoria/zona_rodovia_lib.py): saem da zona,
com folga de 40 m de cada lado, as vias com `ref` de rodovia (BR-, SP-, SPA...), as trunk/primary sem ref (inclui o Anel
Viário de Pontal) e as ligações. Zona sem furos (a camada usa só o anel externo). Dados: setores do IBGE (dados públicos)
e vias do OpenStreetMap (ODbL 1.0, © colaboradores do OSM).

Requer shapely, pyproj e pyshp.
"""
import json
import pathlib
import sys

import shapefile
from shapely.geometry import shape
from shapely.ops import transform, unary_union

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / 'curadoria'))
import zona_rodovia_lib as L  # noqa: E402

CFG = {
    '3550902': {'dist': 'São Simão', 'epsg': 31983, 'nome': 'perímetro urbano de São Simão',
                'ato': 'Lei 2.825/2025, art. 1º ("vias públicas urbanas")', 'simpl': 0},
    '3540200': {'dist': 'Pontal', 'epsg': 31982, 'nome': 'perímetro urbano de Pontal (ruas e logradouros da cidade, sem o Anel Viário)',
                'ato': 'Lei 2.031/1999, art. 1º ("ruas e logradouros da cidade")', 'simpl': 0},
    '3500550': {'dist': 'Águas de Santa Bárbara', 'epsg': 31982, 'nome': 'perímetro urbano de Águas de Santa Bárbara',
                'ato': 'Lei 1.842/2020, art. 1º ("vias urbanas do perímetro urbano")', 'simpl': 0},
}
FOLGA = 40


def main(ibge, shp, osm):
    c = CFG[ibge]
    p = pathlib.Path(shp)
    if p.is_dir():
        p = next(p.glob('*_setores_CD2022.shp'))
    r = shapefile.Reader(str(p.with_suffix('')), encoding='utf-8')
    nomes = [f[0] for f in r.fields[1:]]
    to_utm, to_ll = L.projecoes(c['epsg'])
    setores = []
    for i, rec in enumerate(r.iterRecords(fields=['CD_MUN'])):
        if rec['CD_MUN'] != ibge:
            continue
        sr = r.shapeRecord(i)
        d = dict(zip(nomes, sr.record))
        if d['NM_DIST'] == c['dist'] and d['CD_SIT'] in ('1', '2'):
            setores.append((d['CD_SETOR'], to_utm(shape(sr.shape.__geo_interface__).buffer(0))))
    Z = L.sem_furos(unary_union([g for _, g in setores]).buffer(1).buffer(-1))
    livres = [x for x in L.vias_livres(osm, to_utm) if x[2].distance(Z) < 400]
    R, _ = L.recortar(Z, livres, FOLGA, min_area_m2=20000, simplificar_depois_m=c['simpl'])
    dmin = L.verificar(R, livres, FOLGA)
    out = pathlib.Path(__file__).with_name(f'{ibge}_perimetro_urbano.geojson')
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': (f'IBGE, Malha de Setores Censitários do Censo 2022 (setores urbanos do distrito-sede: {len(setores)} setores). '
                              f'Travessia da rodovia livre: vias com ref de rodovia, trunk/primary sem ref e ligações recortadas com folga de {FOLGA} m (OSM, ODbL 1.0).'),
          'features': [{'type': 'Feature', 'properties': {
              'descricao': f'{c["nome"]}, aproximado pelos setores censitários urbanos do IBGE 2022 ({c["ato"]})',
              'aproximado': True, 'setores_ibge': [s for s, _ in setores]},
              'geometry': L.para_geojson_coords(to_ll(R))}]}
    out.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'{out.name}: {len(getattr(R, "geoms", [R]))} parte(s), {L.contar_vertices(R)} vértices, {len(livres)} vias livres, '
          f'menor distância a elas {dmin:.0f} m, {R.area / 1e6:.2f} km² (antes {Z.area / 1e6:.2f})')


if __name__ == '__main__':
    main(*sys.argv[1:4])
