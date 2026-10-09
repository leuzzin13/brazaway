"""Barueri — Vias Estruturais Restritas (VER) de Alphaville/Tamboré, Dec. 9.025/2019, art. 4º (16 trechos, 4 com sentido).
Seg–sex 17h–20h, exceto feriados. VUC (≤ 2,20 x 6,30 m) só isento se cadastrado (art. 6º).
Geometria: OSM casado por nome/trecho → data/raw/rmsp/barueri_vias.geojson (curado; RMSP_REBUILD=1 refaz via Overpass)."""
from sources import rmsp_municipios as base

LAYER_ID = base.LAYER_ID
SOURCE = 'barueri'
SOURCE_URL = 'http://portal.barueri.sp.gov.br/Upload/Diario/pdf/JOB-1169-14Set2019-web_637039980038937304.pdf (Jornal Oficial ed. 1.169, p. 5–6)'
LICENSE = 'Ato oficial de Barueri: domínio público (Lei 9.610/1998 art. 8º IV). Geometria: OpenStreetMap (ODbL 1.0, © colaboradores do OSM).'
NOTES = 'Inc. I (Al. Alphaville a partir do nº 1.555) aproximado: número não existe no OSM. Trechos com sentido: só a pista/sentido restrito.'
IBGE = '3505708'
RULES = ['barueri_ver']


def fetch():
    fc = base.build_or_load('barueri_vias.geojson', lambda: base.street_rules_fc(RULES, IBGE, lambda: base.overpass_named_ways(IBGE)))
    return base.features_from_fc(fc)
