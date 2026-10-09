"""Áreas de proteção e recuperação de mananciais (APRM) da Grande São Paulo: limites das bacias no DataGEO (SIMA/SP).

Uso na API: AVISO (não bloqueia). O Decreto federal 96.044/1988, art. 9º, manda o veículo com produto perigoso "evitar o uso
de vias em áreas ... de proteção de mananciais, reservatórios de água ou reservas florestais e ecológicas"; não há
proibição geral de PP nas APRM (as leis das APRM e as portarias DER/ARTESP encontradas não trazem). Bloqueios pontuais
com portaria (ex.: SP-008 em Mairiporã, dentro da APRM Alto Juquery) ficam no importador hazmat_trechos_der.
"""
import json

from common import http_get

LAYER_ID = 'perigosos'
SOURCE = 'datageo-aprm'
SOURCE_URL = 'https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs (limites de bacia das APRM)'
LICENSE = 'DataGEO/SIMA-SP — sem licença explícita por camada (AccessConstraints NONE); uso com atribuição, confirmar termos'
NOTES = 'Limites de bacia (não o zoneamento interno). Usado só para aviso; não bloqueia rota.'

WFS = 'https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs?service=WFS&version=1.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326&typeName='
LAYERS = [
    ('datageo:VWM_LIMITE_BACIA_BILLINGS_POL', 'billings', 'APRM Billings'),
    ('datageo:VWM_LIMITE_BACIA_GUARAPIRANGA_POL', 'guarapiranga', 'APRM Guarapiranga'),
    ('datageo:APRMAJ_LIMITE_BACIA_2015_POL', 'alto-juquery', 'APRM Alto Juquery'),
    ('datageo:APRMATC_LIMITE_BACIA_2015_POL', 'alto-tiete-cabeceiras', 'APRM Alto Tietê Cabeceiras'),
]


def fetch():
    from shapely.geometry import mapping, shape
    from shapely.ops import transform, unary_union
    from pyproj import Transformer
    to_m = Transformer.from_crs(4326, 31983, always_xy=True).transform
    out = []
    for type_name, sid, label in LAYERS:
        d = json.loads(http_get(WFS + type_name, cache=f'datageo_{sid}.json', max_age_h=24 * 90))
        geoms = [shape(f['geometry']).buffer(0) for f in d.get('features', []) if f.get('geometry')]
        if not geoms:
            print(f'    ! {type_name}: sem feições')
            continue
        g = unary_union(geoms).simplify(0.00005, preserve_topology=True)   # ~5 m
        x0, y0, x1, y1 = g.bounds
        assert -48.5 < x0 < -45 and -24.5 < y0 < -22.5, f'eixos trocados em {type_name}: {g.bounds}'
        out.append({
            'source_id': sid, 'geometry': mapping(g), 'name': label, 'kind': 'aprm',
            'props': {'camada_datageo': type_name.split(':')[1], 'area_km2': round(transform(to_m, g).area / 1e6, 1),
                      'regra': 'Evitar vias em área de proteção de mananciais (aviso, sem bloqueio)',
                      'norma': 'Decreto 96.044/1988', 'artigo': 'art. 9º'},
        })
        print(f'    {label}: {len(geoms)} polígono(s)')
    return out
