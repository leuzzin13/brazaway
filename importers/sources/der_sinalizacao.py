"""Placas de regulamentação de restrição a caminhões na malha do DER-SP (inventário de Sinalização Vertical).

Placas (significado conforme Manual Brasileiro de Sinalização de Trânsito, Vol. I — Sinalização Vertical de
Regulamentação, CONTRAN 2022):
  R-9  Proibido trânsito de caminhões   (desrespeito: art. 187, I, CTB)
  R-14 Peso bruto total máximo permitido (art. 231, V)
  R-15 Altura máxima permitida           (art. 231, IV)
  R-16 Largura máxima permitida          (art. 231, IV)
  R-17 Peso máximo permitido por eixo    (art. 231, V)
  R-18 Comprimento máximo permitido      (art. 231, IV)

O inventário NÃO traz o valor do limite (só código, rodovia, km, data do levantamento e se atende à norma).
Por isso a camada `placas_restricao` só avisa "placa de limite X a N m da rota — confira" e não bloqueia nada.
"""
import json
import urllib.parse

from common import http_get

LAYER_ID = 'placas_restricao'
SOURCE = 'der-sp'
SERVICE = 'https://mapas.der.sp.gov.br/server/rest/services/Hosted/Sinalizacao_Vertical_DBO/FeatureServer/0'
SOURCE_URL = SERVICE + ' (código_pl R-9, R-14 a R-18)'
LICENSE = 'CC-BY-4.0 — DER-SP (dadosabertos.sp.gov.br, Sinalização Vertical)'
NOTES = 'Sem o valor do limite na placa. Sem sentido de tráfego: a placa pode valer para a pista oposta ou para uma via transversal.'

CODES = ['R-9', 'R-14', 'R-15', 'R-16', 'R-17', 'R-18']
DESC = {
    'R-9': 'Proibido trânsito de caminhões',
    'R-14': 'Peso bruto total máximo permitido',
    'R-15': 'Altura máxima permitida',
    'R-16': 'Largura máxima permitida',
    'R-17': 'Peso máximo permitido por eixo',
    'R-18': 'Comprimento máximo permitido',
}
CTB = {'R-9': 'art. 187, I', 'R-14': 'art. 231, V', 'R-15': 'art. 231, IV', 'R-16': 'art. 231, IV', 'R-17': 'art. 231, V', 'R-18': 'art. 231, IV'}
# limite que a placa regula (para o texto do aviso)
LIMITE = {'R-9': 'proibição de caminhões', 'R-14': 'peso bruto', 'R-15': 'altura', 'R-16': 'largura', 'R-17': 'peso por eixo', 'R-18': 'comprimento'}


def _codes(raw: str) -> list[str]:
    """'R-18-R-14' -> ['R-18', 'R-14'] ; 'R-11-R-14' -> ['R-14'] (só os códigos de interesse)"""
    parts = ['R-' + p for p in (raw or '').upper().replace(' ', '').split('R-') if p]
    parts = [p.rstrip('-') for p in parts]
    return [p for p in parts if p in CODES]


def _iso_br(s):
    """'24/10/2024' -> '2024-10-24'"""
    try:
        d, m, y = (s or '').split('/')
        return f'{int(y):04d}-{int(m):02d}-{int(d):02d}'
    except ValueError:
        return None


def fetch():
    where = ' OR '.join(f"código_pl LIKE '%{c}%'" for c in CODES)
    out, offset = [], 0
    while True:
        q = urllib.parse.urlencode({'where': where, 'outFields': '*', 'outSR': 4326, 'f': 'geojson',
                                    'orderByFields': 'objectid', 'resultOffset': offset, 'resultRecordCount': 1000})
        try:
            d = json.loads(http_get(f'{SERVICE}/query?{q}', cache=f'der_placas_restricao_{offset}.json', max_age_h=24 * 30))
        except Exception:
            if offset:
                raise
            # alguns servidores ArcGIS recusam orderBy/offset: tenta sem paginação (cabe em 2000)
            q = urllib.parse.urlencode({'where': where, 'outFields': '*', 'outSR': 4326, 'f': 'geojson'})
            d = json.loads(http_get(f'{SERVICE}/query?{q}', cache='der_placas_restricao_all.json', max_age_h=24 * 30))
        feats = d.get('features', [])
        for f in feats:
            p = f.get('properties') or {}
            g = f.get('geometry') or {}
            if g.get('type') != 'Point':
                continue
            raw = p.get('código_pl') or p.get('codigo_pl') or ''
            codes = _codes(raw)
            if not codes:
                continue
            main = codes[0]
            km = p.get('km')
            rod = (p.get('rodovia') or '').strip()
            out.append({
                'source_id': str(p.get('objectid') or f.get('id')),
                'geometry': {'type': 'Point', 'coordinates': [round(g['coordinates'][0], 7), round(g['coordinates'][1], 7)]},
                'name': f"{main} {DESC[main]}" + (f' ({rod} km {km:g})' if rod and km is not None else ''),
                'kind': main,
                'props': {
                    'codigos': codes, 'codigo_original': raw,
                    'descricao': ' + '.join(DESC[c] for c in codes),
                    'limite': ' + '.join(LIMITE[c] for c in codes),
                    'ctb': ', '.join(sorted({CTB[c] for c in codes})),
                    'valor': None,   # o inventário do DER não publica o número da placa
                    'rodovia': rod or None, 'km': km, 'regional': p.get('regional'),
                    'levantamento': _iso_br(p.get('levantamen')), 'atende_norma': p.get('atendiment'),
                    'tipo': p.get('tipo_de_si'),
                },
            })
        if len(feats) < 1000:
            break
        offset += 1000
        if offset > 20000:
            break
    return out
