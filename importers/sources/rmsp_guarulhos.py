"""Guarulhos — ZRCC-TB (Trevo de Bonsucesso), Dec. 37.887/2021 com a redação do Dec. 38.400/2021: caminhões proibidos
seg–sex 6h–9h e 17h–20h e sáb 10h–14h; VUC (≤ 2,20 x 7,20 m) livre. A zona do Anexo Único cobre só as alças e ramos do
trevo da Dutra, então é modelada como VIAS (custo linear) e não como polígono: a pista principal e as marginais da
Dutra continuam livres. Geometria: ramos (*_link) e vias transversais do OSM a até 450 m do cruzamento
→ data/raw/rmsp/guarulhos_vias.geojson (curado)."""
from sources import rmsp_municipios as base

LAYER_ID = base.LAYER_ID
SOURCE = 'guarulhos'
SOURCE_URL = ('https://www.guarulhos.sp.gov.br/06_prefeitura/leis/decretos_2021/37887decr.pdf ; '
              'https://www.guarulhos.sp.gov.br/06_prefeitura/leis/decretos_2021/38400decr.pdf')
LICENSE = 'Atos oficiais de Guarulhos: domínio público (Lei 9.610/1998 art. 8º IV). Geometria: OpenStreetMap (ODbL 1.0, © colaboradores do OSM).'
NOTES = 'Recorte aproximado do Anexo Único (imagem sem coordenadas): ramos do trevo e vias transversais a até 450 m do cruzamento.'
RULE = 'guarulhos_zrcc_tb'


def _build():
    from shapely.geometry import LineString, Point
    cfg = base.load_rules()['regras'][RULE]['trevo']
    c = base.to_utm(Point(*cfg['centro'])).buffer(cfg['raio_m'])
    lon, lat = cfg['centro']
    osm = base.overpass_bbox_ways((lat - 0.008, lon - 0.010, lat + 0.008, lon + 0.010), 'trevo_bonsucesso')
    vias = {base.norm(n) for n in cfg['vias']}
    excl = {base.norm(n) for n in cfg['excluir_nomes']}
    feats = []
    for e in osm:
        t = e.get('tags', {})
        nm = base.norm(t.get('name'))
        if nm in excl or t.get('highway') in ('motorway', 'trunk'):
            continue
        if not (t.get('highway') in cfg['classes_ramo'] or nm in vias):
            continue
        L = base.to_utm(LineString([(n['lon'], n['lat']) for n in e['geometry']]))
        if base.is_oneway(t) == -1:
            L = LineString(list(L.coords)[::-1])
        G = L.intersection(c)
        for g in [g for g in getattr(G, 'geoms', [G]) if g.geom_type == 'LineString' and g.length >= 10]:
            ow = base.is_oneway(t) != 0
            feats.append({'type': 'Feature', 'geometry': base.round_geojson(base.to_ll(g).__geo_interface__), 'properties': {
                'regra_id': RULE, 'inciso': 'Anexo Único', 'via': t.get('name') or ('alça do trevo' if 'link' in t.get('highway', '') else None),
                'nome_osm': t.get('name'), 'osm_way_id': e['id'], 'highway': t.get('highway'), 'mao_unica': ow,
                'sentido': 'unico' if ow else 'ambos', 'comprimento_m': round(g.length), 'aproximado': True}})
    return {'type': 'FeatureCollection', 'features': feats, 'fonte_geometria': 'OpenStreetMap (ODbL 1.0) via Overpass'}


def fetch():
    return base.features_from_fc(base.build_or_load('guarulhos_vias.geojson', _build))
