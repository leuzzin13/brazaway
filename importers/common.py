"""Biblioteca comum dos importadores de camadas.

Cada fonte (importers/sources/<nome>.py) expõe:
    LAYER_ID = 'oae'            # id da camada (igual ao meta.id do *.layer.ts na API)
    SOURCE = 'geosampa'         # nome curto da fonte
    SOURCE_URL = 'https://...'  # URL de origem
    LICENSE = 'CC-BY-SA 4.0 (GeoSampa/PMSP)'
    def fetch() -> list[dict]   # devolve feições normalizadas (ver Feature abaixo)

Feature = {
    'source_id': str,                 # id estável na fonte (obrigatório)
    'geometry': dict,                 # GeoJSON em EPSG:4326
    'name': str | None, 'kind': str | None,
    'props': dict,                    # atributos (JSON)
    'valid_from': str | None, 'valid_to': str | None,  # ISO 8601
}

O runner grava no Postgres (data_features + data_layer_runs) e escreve um seed SQL em
db/seed/layers/<layer>__<source>.sql para que `docker compose up` numa máquina limpa já suba com os dados.
LICENÇA: estes dados ficam fora do OSM (ODbL); nunca exporte para o OSM.
"""
from __future__ import annotations
import hashlib, json, os, pathlib, time
from typing import Iterable
import requests

UA = {'User-Agent': 'truck-router-mvp/0.1', 'Accept': '*/*'}  # só ASCII: alguns servidores ArcGIS dão 500 com UA não-ASCII
DATA_DIR = pathlib.Path(os.environ.get('DATA_DIR', '/data'))
SEED_DIR = pathlib.Path(os.environ.get('SEED_DIR', '/seed/layers'))
CACHE_DIR = DATA_DIR / 'cache'


def http_get(url: str, *, cache: str | None = None, max_age_h: float = 24, timeout: int = 180, **kw) -> bytes:
    """GET com cache em data/cache (evita martelar os portais públicos)."""
    if cache:
        p = CACHE_DIR / cache
        if p.exists() and (time.time() - p.stat().st_mtime) < max_age_h * 3600:
            return p.read_bytes()
    headers = {**UA, **kw.pop('headers', {})}
    for attempt in range(3):
        try:
            r = requests.get(url, headers=headers, timeout=timeout, **kw)
            r.raise_for_status()
            break
        except requests.RequestException:
            if attempt == 2:
                if cache and (CACHE_DIR / cache).exists():
                    print(f'  ! falhou, usando cache antigo: {cache}')
                    return (CACHE_DIR / cache).read_bytes()
                raise
            time.sleep(3 * (attempt + 1))
    if cache:
        p = CACHE_DIR / cache
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(r.content)
    return r.content


def stable_id(*parts) -> str:
    return hashlib.sha1('|'.join(str(p) for p in parts).encode()).hexdigest()[:16]


def _pg_conn():
    import psycopg
    return psycopg.connect(
        host=os.environ.get('PGHOST', 'localhost'), port=os.environ.get('PGPORT', '5432'),
        user=os.environ.get('PGUSER', 'truck'), password=os.environ.get('PGPASSWORD', 'truck'),
        dbname=os.environ.get('PGDATABASE', 'truck_router'))


def _sql_str(v) -> str:
    if v is None:
        return 'null'
    s = str(v)
    tag = '$q$'
    while tag in s:
        tag = tag[:-1] + 'q$'
    return f'{tag}{s}{tag}'


def write_seed(layer_id: str, source: str, feats: list[dict], source_url: str, license: str, notes: str | None = None) -> pathlib.Path:
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    path = SEED_DIR / f'{layer_id}__{source}.sql'
    lines = [f'-- GERADO por importers/run.py ({layer_id}/{source}). Fonte: {source_url}. Licença: {license}. Não edite à mão.',
             f"delete from data_features where layer_id = {_sql_str(layer_id)} and source = {_sql_str(source)};"]
    chunk = []
    def flush():
        if chunk:
            lines.append('insert into data_features (layer_id, source, source_id, name, kind, geom, props, valid_from, valid_to) values\n' + ',\n'.join(chunk) + '\non conflict (layer_id, source, source_id) do nothing;')
            chunk.clear()
    for f in feats:
        chunk.append('(' + ', '.join([
            _sql_str(layer_id), _sql_str(source), _sql_str(f['source_id']), _sql_str(f.get('name')), _sql_str(f.get('kind')),
            f"ST_SetSRID(ST_GeomFromGeoJSON({_sql_str(json.dumps(f['geometry'], separators=(',', ':')))}), 4326)",
            _sql_str(json.dumps(f.get('props') or {}, ensure_ascii=False, separators=(',', ':'))) + '::jsonb',
            _sql_str(f.get('valid_from')) + '::timestamptz', _sql_str(f.get('valid_to')) + '::timestamptz',
        ]) + ')')
        if len(chunk) >= 500:
            flush()
    flush()
    lines.append(f"insert into data_layer_runs (layer_id, source, source_url, license, record_count, notes) values ({_sql_str(layer_id)}, {_sql_str(source)}, {_sql_str(source_url)}, {_sql_str(license)}, {len(feats)}, {_sql_str(notes)});")
    path.write_text('\n'.join(lines) + '\n')
    return path


def load_db(layer_id: str, source: str, feats: list[dict], source_url: str, license: str, notes: str | None = None) -> None:
    with _pg_conn() as c, c.cursor() as cur:
        cur.execute('delete from data_features where layer_id = %s and source = %s', (layer_id, source))
        with cur.copy('copy data_features (layer_id, source, source_id, name, kind, geom, props, valid_from, valid_to) from stdin') as cp:
            for f in feats:
                cp.write_row((layer_id, source, f['source_id'], f.get('name'), f.get('kind'),
                              _ewkt(f['geometry']), json.dumps(f.get('props') or {}, ensure_ascii=False), f.get('valid_from'), f.get('valid_to')))
        cur.execute('insert into data_layer_runs (layer_id, source, source_url, license, record_count, notes) values (%s,%s,%s,%s,%s,%s)',
                    (layer_id, source, source_url, license, len(feats), notes))


def _ewkt(geom: dict) -> str:
    from shapely.geometry import shape
    return 'SRID=4326;' + shape(geom).wkt


def validate(feats: Iterable[dict]) -> list[dict]:
    from shapely.geometry import shape
    out, seen = [], set()
    for f in feats:
        sid = f.get('source_id')
        if not sid or sid in seen:
            continue
        g = f.get('geometry')
        try:
            sh = shape(g)
            if sh.is_empty:
                continue
            x0, y0, x1, y1 = sh.bounds
            if not (-75 <= x0 <= -28 and -35 <= y0 <= 6):   # dentro do Brasil (com folga)
                continue
        except Exception:
            continue
        seen.add(sid)
        out.append(f)
    return out
