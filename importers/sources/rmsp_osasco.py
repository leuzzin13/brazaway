"""Osasco — ZMRC (polígono) e VER (vias) do Dec. 10.676/2012 com a redação do Dec. 13.704/2023.

Geometria: mapa oficial vetorial do DEMUTRAN/SETRAN (IOMO 2434, 03/05/2023, p. 98) georreferenciado
(data/raw/rmsp/curadoria/osasco_georef.py) → osasco_zmrc.geojson e osasco_ver_mapa.geojson (eixos casados ao OSM).
Os 4 incisos alterados/incluídos em 2023 (art. 5º XI, XLVII–XLIX) também são montados pelo NOME e TRECHO do decreto
no OSM (osasco_ver_decreto.geojson). Regras (horários etc.): data/raw/rmsp/regras.json.
"""
from sources import rmsp_municipios as base

LAYER_ID = base.LAYER_ID
SOURCE = 'osasco'
SOURCE_URL = ('https://osasco.sp.gov.br/wp-content/uploads/2023/03/iomo-2408.pdf (Dec. 13.704/2023) ; '
              'https://data.queridodiario.ok.org.br/3534401/2023-05-03/39d9486475020047b3fc4292dac595f56e7f4815.pdf (mapa, p. 98) ; '
              'https://data.queridodiario.ok.org.br/3534401/2023-08-09/15a8c2132fb4e242a1b9e7988a0569f0b2354049.pdf (Portaria SETRAN, horários)')
LICENSE = ('Atos oficiais de Osasco: domínio público (Lei 9.610/1998 art. 8º IV). Linhas VER sobre geometria do '
           'OpenStreetMap (ODbL 1.0, © colaboradores do OSM) — base derivada separada do OSM.')
NOTES = ('ZMRC seg–sex 5h–21h e sáb 10h–14h; VER seg–sex 7h–9h e 17h–19h, exceto feriados. 45 dos 49 incisos de VER só '
         'existem no mapa (texto de 2012 não está online). Georreferenciamento com erro típico de 10–25 m.')
IBGE = '3534401'


def _curadoria():
    raise RuntimeError('geometria do mapa de Osasco ausente: rode data/raw/rmsp/curadoria/osasco_georef.py (fora do importador)')


def fetch():
    zmrc = base.build_or_load('osasco_zmrc.geojson', _curadoria)
    for f in zmrc['features']:
        f['properties']['regra_id'] = 'osasco_zmrc'
    ver = base.build_or_load('osasco_ver_mapa.geojson', _curadoria)
    for f in ver['features']:
        p = f['properties']
        p.update({'regra_id': 'osasco_ver', 'inciso': None, 'via': p.get('nome'), 'nome_osm': p.get('nome'),
                  'mao_unica': bool(p.get('oneway')), 'sentido': 'unico' if p.get('oneway') else 'ambos',
                  'fonte_trecho': 'mapa oficial (IOMO 2434, p. 98)'})
    dec = base.build_or_load('osasco_ver_decreto.geojson',
                             lambda: base.street_rules_fc(['osasco_ver'], IBGE, lambda: base.overpass_named_ways(IBGE)))
    # o trecho do decreto prevalece sobre o eixo do mapa no mesmo way do OSM
    dec_ways = {f['properties'].get('osm_way_id') for f in dec['features']}
    ver_feats = [f for f in ver['features'] if f['properties'].get('osm_way_id') not in dec_ways]
    for f in dec['features']:
        f['properties']['fonte_trecho'] = 'Dec. 13.704/2023, art. 2º'
    return (base.features_from_fc(zmrc, 'zona') + base.features_from_fc({'features': ver_feats}) +
            base.features_from_fc(dec))
