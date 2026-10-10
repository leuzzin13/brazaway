"""Santana de Parnaíba — Dec. 4.288/2019: caminhões com PBT acima de 15 t proibidos na Estrada Tenente Marques das 16h às
19h (diariamente) e, a qualquer hora, em 12 vias (Paiol Velho, Al. das Américas, Marcos Penteado, Yojiro Takaoka...),
exceto carga com ENTREGA no município pelas vias de acesso do art. 2º, I (todas menos Pérola Byington e D'Alessandro Carmine). Geometria: OSM por nome → data/raw/rmsp/santana_parnaiba_vias.geojson (curado)."""
from sources import rmsp_municipios as base

LAYER_ID = base.LAYER_ID
SOURCE = 'santana-parnaiba'
SOURCE_URL = ('https://prefeitura.santanadeparnaiba.sp.gov.br/PortalComunicacao/arquivo/download/'
              'AMMJ0Fm5w6LYtdaONCo92UC4DZQCQ3ugj-qy7wONa8-oMYIdWrgdyeVWYw_JrvDLZvcB6g2#page=7 '
              '(Imprensa Oficial ed. 298, 20–26/09/2019, p. 7)')
LICENSE = 'Ato oficial de Santana de Parnaíba: domínio público (Lei 9.610/1998 art. 8º IV). Geometria: OpenStreetMap (ODbL 1.0, © colaboradores do OSM).'
NOTES = ('Regra por PBT (> 15 t). Exceção de entrega local (art. 2º, I): a API deixa de restringir as vias 24h listadas no inciso '
         '(II.1, II.2, II.4–II.11) só quando o DESTINO está no município; Av. Pérola Byington (II.3) e R. D\'Alessandro Carmine (II.12) continuam.')
IBGE = '3547304'
RULES = ['santana_parnaiba_ten_marques', 'santana_parnaiba_24h']


def fetch():
    fc = base.build_or_load('santana_parnaiba_vias.geojson', lambda: base.street_rules_fc(RULES, IBGE, lambda: base.overpass_named_ways(IBGE)))
    return base.features_from_fc(fc)
