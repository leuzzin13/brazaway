"""Paradas de cargas para produtos perigosos nas rodovias estaduais concedidas de SP (ARTESP, KMZ de malha por lote).

Pasta "Sistema de Pesagem / Parada de Cargas (para) Produtos Perigosos" (o nome varia por lote) dos KMZ do conjunto
`malha-rodoviaria` (dadosabertos.artesp.sp.gov.br, CC-BY). A maioria dos pontos vem sem nome: a rodovia e o nome da via
saem do /locate do Valhalla (OSM), quando disponível.

Uso na API: POI no mapa e lista no resumo da rota ("parada recomendada para PP": Decreto 96.044/1988, art. 14, o veículo
com PP só pode estacionar para descanso ou pernoite em áreas determinadas pelas autoridades).
"""
from __future__ import annotations

import io
import json
import os
import re
import zipfile
import xml.etree.ElementTree as ET

import requests

from common import UA, http_get, stable_id

LAYER_ID = 'perigosos'
SOURCE = 'artesp'
SOURCE_URL = 'https://dadosabertos.artesp.sp.gov.br/dataset/malha-rodoviaria (KMZ por lote, pasta Parada de Cargas Produtos Perigosos)'
LICENSE = 'CC-BY — ARTESP (dados abertos); nome da via: OpenStreetMap (ODbL) via Valhalla'
NOTES = ''

CKAN_MALHA = 'https://dadosabertos.artesp.sp.gov.br/api/3/action/package_show?id=malha-rodoviaria'
VALHALLA_URL = os.environ.get('VALHALLA_URL', 'http://valhalla:8002').rstrip('/')
LOTE_NOME = {1: 'AutoBAn', 6: 'Intervias', 7: 'Rota das Bandeiras', 11: 'Renovias', 13: 'Rodovias das Colinas', 16: 'CART',
             19: 'ViaRondon', 20: 'SPVias', 21: 'Rodovias do Tietê', 22: 'Ecovias dos Imigrantes', 23: 'Ecopistas',
             24: 'Rodoanel Oeste', 25: 'SPMar', 26: 'SP Serra (Rodoanel Norte)', 27: 'Tamoios', 28: 'Entrevias', 29: 'ViaPaulista',
             30: 'Eixo SP', 31: 'Ecovias Noroeste Paulista', 32: 'Novo Litoral', 33: 'Rota Sorocabana', 34: 'Ecovias Raposo Castello',
             35: 'ViaRaposo'}
SENT = {'N': 'norte', 'S': 'sul', 'L': 'leste', 'O': 'oeste', 'NORTE': 'norte', 'SUL': 'sul', 'LESTE': 'leste', 'OESTE': 'oeste'}


def _strip(tag: str) -> str:
    return tag.split('}', 1)[-1]


def kmz_pp_points() -> list[dict]:
    pkg = json.loads(http_get(CKAN_MALHA, cache='artesp_malha_pkg.json', max_age_h=24 * 7))['result']
    out = []
    for r in pkg['resources']:
        url = r.get('url') or ''
        m = re.search(r'/l(\d{2})\.kmz$', url, re.I)
        if not m:
            continue
        lote = int(m.group(1))
        try:
            data = http_get(url, cache=f'artesp_l{lote:02d}.kmz', max_age_h=24 * 30, timeout=600)
        except Exception as e:
            print(f'    ! KMZ lote {lote}: {e}')
            continue
        z = zipfile.ZipFile(io.BytesIO(data))
        for kn in [n for n in z.namelist() if n.lower().endswith('.kml')]:
            raw = re.sub(rb'\s(py):[A-Za-z_]+="[^"]*"', b'', z.read(kn))                    # l29: prefixo XML inválido
            raw = re.sub(rb'xmlns:(\w+)="\{[^"]*\}"', rb'xmlns:\1="urn:x-invalido:\1"', raw)   # URI de namespace inválida
            try:
                root = ET.fromstring(raw)
            except ET.ParseError as e:
                print(f'    ! KML inválido lote {lote}: {e}')
                continue

            def walk(el, path):
                t = _strip(el.tag)
                if t in ('Folder', 'Document'):
                    nm = next(((c.text or '').strip() for c in el if _strip(c.tag) == 'name'), '')
                    for c in el:
                        walk(c, path + [nm])
                elif t == 'Placemark':
                    fp = ' / '.join(p for p in path if p)
                    if not re.search(r'(?i)produtos?\s+perigosos', fp):
                        return
                    nm, coords = '', None
                    for c in el.iter():
                        st = _strip(c.tag)
                        if st == 'name' and not nm:
                            nm = (c.text or '').strip()
                        if st == 'coordinates' and coords is None:
                            coords = (c.text or '').strip()
                    if not coords:
                        return
                    try:
                        lon, lat = [float(x) for x in coords.split()[0].split(',')[:2]]
                    except ValueError:
                        return
                    out.append({'lote': lote, 'pasta': fp, 'nome': nm, 'lon': lon, 'lat': lat})
                else:
                    for c in el:
                        walk(c, path)
            walk(root, [])
    return out


def road_at(lon: float, lat: float) -> tuple[str | None, str | None]:
    """(rodovia, nome) da via mais próxima pelo /locate do Valhalla."""
    try:
        r = requests.post(f'{VALHALLA_URL}/locate', json={'locations': [{'lon': lon, 'lat': lat, 'radius': 120}], 'costing': 'truck', 'verbose': True},
                          headers=UA, timeout=30)
        edges = (r.json()[0].get('edges') or [])
    except Exception:
        return None, None
    ref = name = None
    for e in sorted(edges, key=lambda e: e.get('distance') or 0):
        for n in (e.get('edge_info') or {}).get('names') or []:
            if not ref and re.match(r'^(SP|BR)-\d', n):
                ref = n
            elif not name and not re.match(r'^(SP|BR)-\d', n):
                name = n
        if ref and name:
            break
    return ref, name


def fetch():
    global NOTES
    pts = kmz_pp_points()
    out, seen = [], set()
    for p in pts:
        key = (round(p['lon'], 4), round(p['lat'], 4))
        if key in seen:
            continue
        seen.add(key)
        rod = km = sent = None
        m = re.match(r'(?i)^\s*(SP[AI]?)\s*-?\s*(\d{3})\s+(\d{1,3}(?:[.,]\d+)?)\s*(norte|sul|leste|oeste)?', p['nome'] or '')
        if m:
            rod, km = f'{m.group(1).upper()}-{m.group(2)}', float(m.group(3).replace(',', '.'))
            sent = SENT.get((m.group(4) or '').upper())
        ref, via = road_at(p['lon'], p['lat'])
        rod = rod or ref
        conc = LOTE_NOME.get(p['lote'], f"lote {p['lote']}")
        label = 'Parada para produtos perigosos' + (f' — {rod}' if rod else '') + (f' km {km:g}' if km is not None else '') + (f' ({sent})' if sent else '')
        out.append({
            'source_id': stable_id('artesp-pp', p['lote'], *key),
            'geometry': {'type': 'Point', 'coordinates': [round(p['lon'], 6), round(p['lat'], 6)]},
            'name': label, 'kind': 'parada_pp',
            'props': {'concessionaria': conc, 'lote': p['lote'], 'rodovia': rod, 'via_osm': via, 'km': km, 'sentido': sent,
                      'rotulo_kmz': p['nome'] or None, 'pasta_kmz': p['pasta'].split(' / ')[-1],
                      'uso': 'Parada recomendada para descanso/pernoite de veículo com PP', 'norma': 'Decreto 96.044/1988', 'artigo': 'art. 14'},
        })
    NOTES = f'{len(out)} paradas de PP em {len({p["lote"] for p in pts})} lotes (de {len(pts)} pontos no KMZ)'
    print('    ' + NOTES)
    return out
