"""Consulta paginada a uma camada ArcGIS REST (FeatureServer/MapServer) em GeoJSON. Não é uma fonte (o runner ignora
módulos com `_`). Usado pelos importadores do Observatório da Infraestrutura de MG (DER-MG/SEINFRA)."""
from __future__ import annotations

import json
import time
import urllib.parse
from datetime import datetime, timezone

import common
from common import http_get

# folga entre a checagem de idade do http_get e a nossa (o arquivo pode "envelhecer" alguns segundos entre as duas)
_FOLGA_IDADE_H = 1 / 60


def query_geojson(layer_url: str, *, where: str = '1=1', order_by: str = 'objectid', cache: str | None = None,
                  max_age_h: float = 24, page: int = 2000, out_fields: str = '*', sem_cache_vencido: bool = False,
                  info: dict | None = None) -> list[dict]:
    """Todas as feições da camada que atendem `where`, em EPSG:4326, paginando por resultOffset (ordem estável por
    `order_by`). `cache` é o prefixo do arquivo em data/cache (um por página).

    `sem_cache_vencido=True` (fonte viva): o `http_get` comum, depois de 3 falhas, devolve o cache antigo de qualquer
    idade; aqui isso vira erro (RuntimeError) se a página veio de um cache mais velho que `max_age_h`, para a carga
    falhar em vez de carimbar dado velho como fresco. `info`, se dado, recebe `lido_em` (datetime UTC): quando a página
    mais antiga foi de fato baixada da fonte (mtime do cache; agora, sem cache)."""
    out: list[dict] = []
    offset = 0
    lido_em: float | None = None
    while True:
        q = urllib.parse.urlencode({
            'where': where, 'outFields': out_fields, 'outSR': 4326, 'f': 'geojson', 'returnGeometry': 'true',
            'orderByFields': order_by, 'resultOffset': offset, 'resultRecordCount': page,
        })
        arq = f'{cache}_{offset}.json' if cache else None
        raw = http_get(f'{layer_url.rstrip("/")}/query?{q}', cache=arq, max_age_h=max_age_h)
        mt = (common.CACHE_DIR / arq).stat().st_mtime if arq and (common.CACHE_DIR / arq).exists() else time.time()
        idade_h = (time.time() - mt) / 3600
        if sem_cache_vencido and idade_h > max_age_h + _FOLGA_IDADE_H:
            raise RuntimeError(f'{layer_url}: a consulta falhou e só há cache de {idade_h:.1f} h ({arq}); esta fonte não '
                               f'aceita cache com mais de {max_age_h:g} h (os dados já gravados vencem sozinhos)')
        lido_em = mt if lido_em is None else min(lido_em, mt)
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
    if info is not None:
        info['lido_em'] = datetime.fromtimestamp(lido_em if lido_em is not None else time.time(), tz=timezone.utc)
    return out


def layer_info(layer_url: str, *, cache: str | None = None, max_age_h: float = 24) -> dict:
    """Metadados da camada (?f=json): campos, domínios, editingInfo.lastEditDate."""
    return json.loads(http_get(f'{layer_url.rstrip("/")}?f=json', cache=cache, max_age_h=max_age_h))
