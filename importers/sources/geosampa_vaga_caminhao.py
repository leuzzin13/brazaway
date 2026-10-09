"""Vagas especiais de caminhão (tipo CA) — GeoSampa, camada geoportal:vaga_especial (CET).

São pontos com endereço e número de vagas sinalizadas, todos rotativos (Zona Azul Caminhão). Cada ponto é
casado com a face de quadra de Zona Azul com vagas de caminhão mais próxima (até 35 m) para herdar o horário
de operação e a regra do CAD; o id da face (zona_azul_id) permite à API não repetir a mesma vaga duas vezes.
"""
import math
import re

from sources.geosampa_faixa_onibus import wfs_geojson
from sources.geosampa_zona_azul import cad_rule, trucks_rows, windows_of

LAYER_ID = 'carga_descarga'
SOURCE = 'geosampa-vaga-especial'
SOURCE_URL = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs (typeNames=geoportal:vaga_especial, cd_tipo_area=CA)'
LICENSE = 'CC-BY-SA 4.0 — GeoSampa/Prefeitura de São Paulo (cadastro CET)'
NOTES = 'Só cd_tipo_area = CA (caminhão). Horário herdado da face de Zona Azul mais próxima (≤ 35 m); sem casamento = horário não informado.'
MATCH_M = 35.0


def _seg_dist(p, a, b):
    k = 111320 * math.cos(math.radians(p[1]))
    ax, ay = (a[0] - p[0]) * k, (a[1] - p[1]) * 110574
    bx, by = (b[0] - p[0]) * k, (b[1] - p[1]) * 110574
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
    return math.hypot(ax + t * dx, ay + t * dy)


def _line_dist(p, g):
    parts = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
    return min((_seg_dist(p, a, b) for c in parts for a, b in zip(c, c[1:])), default=1e9)


def fetch():
    za = trucks_rows()
    # índice simples por grade (~0,005°) para o casamento ponto → face de quadra
    grid: dict[tuple, list] = {}
    for f in za:
        g = f['geometry']
        pts = g['coordinates'] if g['type'] == 'LineString' else [c for part in g['coordinates'] for c in part]
        for key in {(int(x // 0.005), int(y // 0.005)) for x, y in pts}:
            grid.setdefault(key, []).append(f)

    d = wfs_geojson('vaga_especial', 'geosampa_vaga_especial.json', max_age_h=24 * 7)
    out = []
    for f in d['features']:
        p = f['properties']
        g = f.get('geometry') or {}
        if (p.get('cd_tipo_area') or '').strip().upper() != 'CA' or g.get('type') != 'Point':
            continue
        pt = g['coordinates'][:2]
        cx, cy = int(pt[0] // 0.005), int(pt[1] // 0.005)
        cands = {id(z): z for dx in (-1, 0, 1) for dy in (-1, 0, 1) for z in grid.get((cx + dx, cy + dy), [])}.values()
        best, best_d = None, 1e9
        for z in cands:
            dd = _line_dist(pt, z['geometry'])
            if dd < best_d:
                best, best_d = z, dd
        zp = best['properties'] if best is not None and best_d <= MATCH_M else None
        endereco = re.sub(r'\s+', ' ', (p.get('nm_endereco_vaga_especial') or '').strip())
        compl = re.sub(r'\s+', ' ', (p.get('tx_complemento_endereco') or '').strip(' -'))
        w = windows_of(zp) if zp else []
        local = re.sub(r'\s+', ' ', (zp.get('nm_local') or '').strip()) if zp else endereco
        out.append({
            'source_id': str(p['cd_identificador_vaga_especial']),
            'geometry': {'type': 'Point', 'coordinates': pt},
            'name': endereco or None,
            'kind': 'vaga_caminhao',
            'props': {
                'endereco': endereco, 'complemento': compl or None, 'vagas_caminhao': p.get('qt_numero_vaga_sinalizada'),
                'area': (p.get('nm_area') or '').strip() or None, 'rotativo': (p.get('in_rotativo') or '').strip() == 'S',
                'zona_azul_id': zp.get('cd_identificador_zona_azul') if zp else None,
                'local': local, 'distancia_face_m': round(best_d, 1) if zp else None,
                'windows': w, 'horario_informado': bool(w),
                **cad_rule(local),
                'veiculos': 'caminhão, caminhonete e veículo misto (Portaria SMT 97/2007, art. 3º)',
                'dt_carga': (p.get('dt_carga') or '')[:10] or None,
            },
        })
    return out
