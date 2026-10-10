"""Consulta paginada a uma camada ArcGIS REST (FeatureServer/MapServer) em GeoJSON. Não é uma fonte (o runner ignora
módulos com `_`). Usado pelos importadores do Observatório da Infraestrutura de MG (DER-MG/SEINFRA)."""
from __future__ import annotations

import json
import urllib.parse

from common import http_get


def query_geojson(layer_url: str, *, where: str = '1=1', order_by: str = 'objectid', cache: str | None = None,
                  max_age_h: float = 24, page: int = 2000, out_fields: str = '*') -> list[dict]:
    """Todas as feições da camada que atendem `where`, em EPSG:4326, paginando por resultOffset (ordem estável por
    `order_by`). `cache` é o prefixo do arquivo em data/cache (um por página)."""
    out: list[dict] = []
    offset = 0
    while True:
        q = urllib.parse.urlencode({
            'where': where, 'outFields': out_fields, 'outSR': 4326, 'f': 'geojson', 'returnGeometry': 'true',
            'orderByFields': order_by, 'resultOffset': offset, 'resultRecordCount': page,
        })
        raw = http_get(f'{layer_url.rstrip("/")}/query?{q}', cache=f'{cache}_{offset}.json' if cache else None, max_age_h=max_age_h)
        d = json.loads(raw)
        if 'error' in d:
            raise RuntimeError(f'ArcGIS devolveu erro em {layer_url}: {d["error"]}')
        feats = d.get('features') or []
        out.extend(feats)
        more = d.get('exceededTransferLimit') or (d.get('properties') or {}).get('exceededTransferLimit')
        if not feats or (not more and len(feats) < page):
            break
        offset += len(feats)
        if offset > 200_000:
            raise RuntimeError('paginação passou de 200 mil feições: confira o where')
    return out


def layer_info(layer_url: str, *, cache: str | None = None, max_age_h: float = 24) -> dict:
    """Metadados da camada (?f=json): campos, domínios, editingInfo.lastEditDate."""
    return json.loads(http_get(f'{layer_url.rstrip("/")}?f=json', cache=cache, max_age_h=max_age_h))
