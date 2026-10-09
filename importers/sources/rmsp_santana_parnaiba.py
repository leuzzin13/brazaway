"""Santana de Parnaíba — Dec. 4.288/2019: caminhões com PBT acima de 15 t proibidos na Estrada Tenente Marques das 16h às
19h (diariamente) e, a qualquer hora, em 12 vias (Paiol Velho, Al. das Américas, Marcos Penteado, Yojiro Takaoka...),
exceto entrega no município (art. 2º). Geometria: OSM por nome → data/raw/rmsp/santana_parnaiba_vias.geojson (curado)."""
from sources import rmsp_municipios as base

LAYER_ID = base.LAYER_ID
SOURCE = 'santana-parnaiba'
SOURCE_URL = ('https://prefeitura.santanadeparnaiba.sp.gov.br/PortalComunicacao/imprensa-oficial/search?NUM_Ano=2019&DS_ArquivoConteudo=caminh%C3%B5es '
              '(Imprensa Oficial ed. 298, 20–26/09/2019)')
LICENSE = 'Ato oficial de Santana de Parnaíba: domínio público (Lei 9.610/1998 art. 8º IV). Geometria: OpenStreetMap (ODbL 1.0, © colaboradores do OSM).'
NOTES = 'Regra por PBT (> 15 t). Exceção de destino local (art. 2º): a API não aplica as vias 24h quando origem ou destino está no município.'
IBGE = '3547304'
RULES = ['santana_parnaiba_ten_marques', 'santana_parnaiba_24h']


def fetch():
    fc = base.build_or_load('santana_parnaiba_vias.geojson', lambda: base.street_rules_fc(RULES, IBGE, lambda: base.overpass_named_ways(IBGE)))
    return base.features_from_fc(fc)
