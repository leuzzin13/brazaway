"""Ribeirão Pires — ZRC do Centro, Dec. 7.608/2025: proibido caminhão com mais de 2 eixos OU PBT acima de 16 t, em período
integral, salvo com AETE (Lei 5.972/2015). Geometria: Anexo I (imagem) digitalizado sobre a malha do OSM →
data/raw/rmsp/ribeirao_pires_zrc.geojson (curado à mão; ver docs/layers/restricoes_rmsp.md)."""
from sources import rmsp_municipios as base

LAYER_ID = base.LAYER_ID
SOURCE = 'ribeirao-pires'
SOURCE_URL = 'https://www.ribeiraopires.sp.gov.br/uploads/diario_oficial_26_01_2026_26033144.pdf (Diário Oficial ed. 44, 26/01/2026)'
LICENSE = 'Ato oficial de Ribeirão Pires: domínio público (Lei 9.610/1998 art. 8º IV). Contorno digitalizado sobre o OpenStreetMap (ODbL 1.0).'
NOTES = ('Polígono aproximado (o mapa do Anexo I não é georreferenciado). O recuo de 20 m só libera as avenidas do contorno '
         'digitalizado. O Anexo II lista pontos de entrada/sinalização da ZRC, não o perímetro: as ruas do Anexo II (Afonso Zampol, '
         'Fortuna, Miguel Prisco, Boa Vista, Giacomo Sortino, Pres. Kennedy) ficam em boa parte DENTRO do polígono (até ~200 m do contorno).')


def _ausente():
    raise RuntimeError('data/raw/rmsp/ribeirao_pires_zrc.geojson ausente (contorno digitalizado à mão)')


def fetch():
    fc = base.build_or_load('ribeirao_pires_zrc.geojson', _ausente)
    for f in fc['features']:
        f['properties']['regra_id'] = 'ribeirao_pires_zrc'
    return base.features_from_fc(fc, 'zona')
