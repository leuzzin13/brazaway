"""OPCIONAL — placas de altura/peso/largura/comprimento detectadas pelo Mapillary (visão computacional) na Grande SP.

Só roda com MAPILLARY_TOKEN no ambiente (token de cliente gratuito: https://www.mapillary.com/dashboard/developers ->
"Register application" -> copie o "Client Token", que começa com MLY|). Sem token o importador para com erro explicativo
e NÃO mexe no que já está no banco.

As classes de placa de altura/peso do Mapillary NÃO trazem o número (só as de velocidade trazem), então cada detecção vira
um ponto "placa detectada, valor desconhecido" na camada lacunas_osm (fonte 'mapillary'): serve para a fila de coleta e
para avisar caminhões altos/pesados. Nunca bloqueia rota.

API: GET https://graph.mapillary.com/map_features (bbox < 0,01 grau², até 2.000 resultados; subdividimos o bbox).
Licença: conteúdo dos usuários em CC BY-SA 4.0; uso comercial só nos termos da seção 12 dos Termos de Uso (15/02/2024);
atribuição obrigatória (logo + link para mapillary.com) ao exibir dados extraídos. Ver docs/layers/lacunas_osm.md.
"""
from __future__ import annotations
import json, os, time
import requests
from common import CACHE_DIR, UA

LAYER_ID = 'lacunas_osm'
SOURCE = 'mapillary'
SOURCE_URL = 'https://graph.mapillary.com/map_features'
LICENSE = 'CC BY-SA 4.0 — contribuidores do Mapillary (uso comercial: Termos de Uso Mapillary, seção 12; atribuição com logo e link)'
NOTES = 'Detecções automáticas de placas (sem o valor). Bbox padrão da Grande SP; MAPILLARY_BBOX=minLon,minLat,maxLon,maxLat muda.'

# bbox da Grande SP usado na pesquisa (contém os 39 municípios da RMSP)
BBOX_RMSP = (-47.21, -24.07, -45.69, -23.18)
CLASSES = {
    'regulatory--height-limit--g1': 'placa_altura_detectada',
    'warning--height-restriction--g2': 'placa_altura_detectada',
    'warning--height-restriction--g3': 'placa_altura_detectada',
    'warning--height-restriction--g4': 'placa_altura_detectada',
    'warning--height-restriction--g5': 'placa_altura_detectada',
    'information--height-limit--g1': 'placa_altura_detectada',
    'information--height-limit--g2': 'placa_altura_detectada',
    'complementary--height-limit--g1': 'placa_altura_detectada',
    'complementary--height-limit--g2': 'placa_altura_detectada',
    'information--weight-and-height-limit--g1': 'placa_altura_detectada',
    'regulatory--weight-limit--g1': 'placa_peso_detectada',
    'regulatory--weight-limit--g2': 'placa_peso_detectada',
    'regulatory--weight-limit--g3': 'placa_peso_detectada',
    'regulatory--weight-limit--g4': 'placa_peso_detectada',
    'regulatory--weight-limit--g5': 'placa_peso_detectada',
    'regulatory--weight-limit--g6': 'placa_peso_detectada',
    'regulatory--weight-limit--g7': 'placa_peso_detectada',
    'regulatory--weight-limit-per-axle--g1': 'placa_peso_detectada',
    'regulatory--weight-limit-per-tandem-axle--g1': 'placa_peso_detectada',
    'regulatory--weight-limit-with-trucks--g1': 'placa_peso_detectada',
    'information--weight-limit--g1': 'placa_peso_detectada',
    'complementary--weight-limit--g1': 'placa_peso_detectada',
    'regulatory--width-limit--g1': 'placa_largura_detectada',
    'complementary--width-limit--g1': 'placa_largura_detectada',
    'regulatory--length-limit--g1': 'placa_comprimento_detectada',
    'regulatory--length-limit--g2': 'placa_comprimento_detectada',
}
LABEL = {'placa_altura_detectada': 'Placa de altura máxima', 'placa_peso_detectada': 'Placa de peso máximo',
         'placa_largura_detectada': 'Placa de largura máxima', 'placa_comprimento_detectada': 'Placa de comprimento máximo'}
TILE_DEG = 0.09          # 0,09 x 0,09 = 0,0081 grau² (< 0,01 exigido pela API)
LIMIT = 2000


def _bbox():
    v = os.environ.get('MAPILLARY_BBOX')
    if not v:
        return BBOX_RMSP
    a = [float(x) for x in v.split(',')]
    assert len(a) == 4 and a[0] < a[2] and a[1] < a[3], 'MAPILLARY_BBOX=minLon,minLat,maxLon,maxLat'
    return tuple(a)


def _query(token: str, b, depth=0) -> list[dict]:
    """Uma consulta map_features; se vier cheia (LIMIT), divide o bbox em 4."""
    key = f'mapillary/mf_{b[0]:.4f}_{b[1]:.4f}_{b[2]:.4f}_{b[3]:.4f}.json'
    p = CACHE_DIR / key
    if p.exists() and time.time() - p.stat().st_mtime < 7 * 86400:
        data = json.loads(p.read_bytes())
    else:
        params = {'fields': 'id,object_value,object_type,geometry,first_seen_at,last_seen_at,aligned_direction',
                  'bbox': ','.join(f'{x:.6f}' for x in b), 'object_values': ','.join(CLASSES), 'limit': LIMIT}
        headers = {**UA, 'Authorization': f'OAuth {token}'}
        for attempt in range(4):
            r = requests.get(SOURCE_URL, params=params, headers=headers, timeout=90)
            body = r.text[:300]
            if r.ok:
                break
            if 'OAuth' in body or r.status_code in (401, 403):
                raise RuntimeError(f'Mapillary recusou o token (HTTP {r.status_code}): {body}')
            if r.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            # a mensagem não inclui o token (vai no cabeçalho, não na URL)
            raise RuntimeError(f'Mapillary HTTP {r.status_code} no bbox {params["bbox"]}: {body}')
        data = r.json().get('data', [])
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(data))
    if len(data) >= LIMIT and depth < 6:
        mx, my = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        out = []
        for q in ((b[0], b[1], mx, my), (mx, b[1], b[2], my), (b[0], my, mx, b[3]), (mx, my, b[2], b[3])):
            out += _query(token, q, depth + 1)
        return out
    return data


def fetch():
    token = os.environ.get('MAPILLARY_TOKEN', '').strip()
    if not token:
        raise RuntimeError('MAPILLARY_TOKEN não definido: importador opcional não executado (nada foi alterado). '
                           'Crie um token em https://www.mapillary.com/dashboard/developers e rode com -e MAPILLARY_TOKEN=MLY|...')
    x0, y0, x1, y1 = _bbox()
    tiles = []
    x = x0
    while x < x1:
        y = y0
        while y < y1:
            tiles.append((x, y, min(x + TILE_DEG, x1), min(y + TILE_DEG, y1)))
            y += TILE_DEG
        x += TILE_DEG
    print(f'  {len(tiles)} consultas (bbox {x0},{y0},{x1},{y1})')
    seen, out = set(), []
    for i, t in enumerate(tiles):
        for d in _query(token, t):
            fid = str(d.get('id'))
            ov = d.get('object_value')
            g = d.get('geometry') or {}
            if fid in seen or ov not in CLASSES or g.get('type') != 'Point':
                continue
            seen.add(fid)
            lon, lat = g['coordinates'][:2]
            kind = CLASSES[ov]
            out.append({
                'source_id': fid,
                'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]},
                'name': f'{LABEL[kind]} detectada (valor desconhecido)',
                'kind': kind,
                'props': {'lat': round(lat, 7), 'lon': round(lon, 7), 'classe_mapillary': ov,
                          'primeira_vez': d.get('first_seen_at'), 'ultima_vez': d.get('last_seen_at'),
                          'direcao': d.get('aligned_direction'), 'prioridade': 1 if kind == 'placa_altura_detectada' else 2,
                          'url': f'https://www.mapillary.com/app/?lat={lat:.6f}&lng={lon:.6f}&z=18',
                          'atribuicao': 'Mapillary (CC BY-SA)'},
            })
        if (i + 1) % 25 == 0:
            print(f'  {i+1}/{len(tiles)} consultas, {len(out)} placas')
    return out
