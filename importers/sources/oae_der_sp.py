"""Obras de Arte Especiais da malha do DER-SP (rodovias estaduais não concedidas). Pontos com rodovia/km/tipo/dimensões."""
import json
from common import http_get

LAYER_ID = 'oae'
SOURCE = 'der-sp'
SOURCE_URL = 'https://mapas.der.sp.gov.br/server/rest/services/Hosted/OAE_DBO/FeatureServer/0'
LICENSE = 'CC-BY-4.0 — DER-SP (dadosabertos.sp.gov.br)'
NOTES = 'Sem classe portante nem gabarito. Malha concedida (ARTESP) não publicada.'


def _kind(esp: str) -> str:
    e = (esp or '').upper()
    if 'VIADUTO' in e: return 'viaduto'
    if 'PASSARELA' in e: return 'passarela'
    if 'TUNEL' in e or 'TÚNEL' in e: return 'tunel'
    if 'MADEIRA' in e: return 'ponte_madeira'
    if 'PONTE' in e: return 'ponte'
    return 'outra'


def fetch():
    out, start = [], 0
    while True:
        # paginação por faixa de objectid (orderByFields/resultOffset dão HTTP 500 neste servidor)
        url = f'{SOURCE_URL}/query?where=objectid%3E{start}+AND+objectid%3C%3D{start + 1000}&outFields=*&f=geojson'
        d = json.loads(http_get(url, cache=f'der_oae_{start}.json', max_age_h=24 * 30))
        feats = d.get('features', [])
        for f in feats:
            p = f['properties']
            g = f['geometry'] or {}
            if g.get('type') != 'Point':
                continue
            out.append({
                'source_id': str(p['objectid']),
                'geometry': {'type': 'Point', 'coordinates': g['coordinates'][:2]},
                'name': f"{(p.get('especifica') or '').strip().title()} {p.get('rodovia') or ''} km {p.get('km')}".strip(),
                'kind': _kind(p.get('especifica')),
                'props': {'admin': 'estadual (DER-SP)', 'rodovia': p.get('rodovia'), 'km': p.get('km'), 'tipo_original': p.get('especifica'),
                          'comprimento_m': p.get('compriment'), 'largura_m': p.get('largura_de'), 'regional': p.get('regional'),
                          'altura_livre_m': None, 'peso_max_t': None},
            })
        if not feats and start > 0:
            break
        start += 1000
        if start > 50000:
            break
    return out
