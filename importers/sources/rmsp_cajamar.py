"""Cajamar — Dec. 7.397/2025 (consolida as restrições), Anexos I a IV. Classes do art. 2º: VUC (≤ 2,20 x 7,20 m, até 3 t)
livre; CAMINHÃO (até 3 eixos); CARRETA (acima de 3 eixos / acima de 14 m). Anexo I vale todos os dias (carreta 6h–20h);
II a IV seg–sex 7h–9h e 16h–20h. Geometria: OSM por nome/trecho → data/raw/rmsp/cajamar_vias.geojson (curado)."""
from sources import rmsp_municipios as base

LAYER_ID = base.LAYER_ID
SOURCE = 'cajamar'
SOURCE_URL = 'https://cajamar.sp.gov.br/diariooficial/wp-content/uploads/sites/3/edicao-no1358.pdf (DOM ed. 1358, 10/01/2025)'
LICENSE = 'Ato oficial de Cajamar: domínio público (Lei 9.610/1998 art. 8º IV). Geometria: OpenStreetMap (ODbL 1.0, © colaboradores do OSM).'
NOTES = 'Trechos I.1, II e III.2 aproximados (rotatórias/números/rua não identificados no OSM): aplicados num trecho maior que o do decreto.'
IBGE = '3509205'
RULES = ['cajamar_anexo_1', 'cajamar_anexo_2', 'cajamar_anexo_3', 'cajamar_anexo_4']


def fetch():
    fc = base.build_or_load('cajamar_vias.geojson', lambda: base.street_rules_fc(RULES, IBGE, lambda: base.overpass_named_ways(IBGE)))
    return base.features_from_fc(fc)
