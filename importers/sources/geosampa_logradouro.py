"""GeoSampa segmento_logradouro (Prefeitura de São Paulo) → addr_segment (interpolação de número na capital).

Cada segmento (uma quadra de um logradouro) tem a faixa de numeração par e ímpar e a linha do eixo da via.
O geocodificador usa quando o número pedido NÃO existe no CNEFE: acha o segmento cuja faixa (da mesma paridade)
contém o número e interpola ao longo da linha. A linha vem orientada no sentido da numeração crescente
(conferido no import: ver _orienta()).

Sem seed versionado (~220 mil segmentos). Rode com --no-seed. Licença CC-BY-SA 4.0: a tabela fica separada
do OSM e do CNEFE, e a resposta da API cita o GeoSampa quando o ponto vem daqui.
"""
import json, math, os
from common import _pg_conn, http_get

LAYER_ID = 'geocoding'
SOURCE = 'geosampa-segmentos'
WFS = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs'
SOURCE_URL = WFS + ' (typeNames=geoportal:segmento_logradouro)'
LICENSE = 'CC-BY-SA 4.0 — GeoSampa/Prefeitura de São Paulo'
NOTES = None
PAGE = int(os.environ.get('GEOSAMPA_PAGE', '10000'))
COD_SP = 3550308


def _url(start: int) -> str:
    # sem srsName: pedir EPSG:4326 faz o GeoServer falhar em alguma feição ("Transformation doesn't converge") e
    # devolver um JSON truncado; baixamos no CRS nativo (SIRGAS 2000 / UTM 23S, EPSG:31983) e reprojetamos aqui.
    return (f'{WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=geoportal:segmento_logradouro'
            f'&outputFormat=application/json&sortBy=cd_identificador&count={PAGE}&startIndex={start}')


def _page(start: int) -> dict:
    from common import CACHE_DIR
    cache = f'geocoding/geosampa_seg_utm_{start}.json'
    for attempt in range(3):
        raw = http_get(_url(start), cache=cache, max_age_h=24 * 30, timeout=300)
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            print(f'  ! página {start} veio truncada/corrompida (tentativa {attempt + 1}); baixando de novo', flush=True)
            (CACHE_DIR / cache).unlink(missing_ok=True)
    raise RuntimeError(f'GeoSampa: página {start} inválida')


def _lines(g: dict) -> list:
    """Coordenadas da linha como lista de [x, y] (MultiLineString vira uma linha só, partes na ordem)."""
    if not g or g.get('type') not in ('LineString', 'MultiLineString'):
        return []
    out: list = []

    def walk(c):
        if isinstance(c, (list, tuple)) and len(c) >= 2 and all(isinstance(v, (int, float)) for v in c[:2]):
            out.append([float(c[0]), float(c[1])])
        elif isinstance(c, (list, tuple)):
            for x in c:
                walk(x)
    walk(g.get('coordinates') or [])
    return out


def _d(a, b) -> float:
    return math.hypot((a[0] - b[0]) * math.cos(math.radians(a[1])), a[1] - b[1])


def _orienta(segs: list[dict]) -> int:
    """Garante que cada linha vá do número menor para o maior, usando os vizinhos (ordem do segmento) do mesmo codlog.
    Devolve quantos segmentos foram invertidos."""
    by_log: dict[str, list[dict]] = {}
    for s in segs:
        by_log.setdefault(s['codlog'], []).append(s)
    flipped = 0
    for lst in by_log.values():
        lst.sort(key=lambda s: (s['ordem'] if s['ordem'] is not None else 0, s['lo'] if s['lo'] is not None else 0))
        for i, s in enumerate(lst):
            c = s['coords']
            if len(c) < 2:
                continue
            a, b = c[0], c[-1]
            score = 0.0  # > 0: orientação atual está certa
            if i + 1 < len(lst) and len(lst[i + 1]['coords']) >= 2:
                n = lst[i + 1]['coords']
                nxt = min(_d(b, n[0]), _d(b, n[-1])) - min(_d(a, n[0]), _d(a, n[-1]))
                score -= nxt   # fim perto do próximo = bom
            if i > 0 and len(lst[i - 1]['coords']) >= 2:
                p = lst[i - 1]['coords']
                prv = min(_d(a, p[0]), _d(a, p[-1])) - min(_d(b, p[0]), _d(b, p[-1]))
                score -= prv   # início perto do anterior = bom
            if score < 0:
                s['coords'] = list(reversed(c))
                flipped += 1
    return flipped


def fetch():
    global NOTES
    from pyproj import Transformer
    segs, start, total, tr, bad = [], 0, None, {}, 0
    while True:
        d = _page(start)
        feats = d.get('features', [])
        total = d.get('totalFeatures') or d.get('numberMatched') or total
        crs = ((d.get('crs') or {}).get('properties') or {}).get('name') or 'urn:ogc:def:crs:EPSG::31983'
        epsg = int(crs.rsplit(':', 1)[-1])
        if epsg not in tr:
            tr[epsg] = Transformer.from_crs(epsg, 4326, always_xy=True)
        for f in feats:
            p = f['properties']
            c = _lines(f.get('geometry'))
            if len(c) < 2:
                continue
            if epsg != 4326:
                xs, ys = tr[epsg].transform([pt[0] for pt in c], [pt[1] for pt in c])
                c = [[x, y] for x, y in zip(xs, ys)]
                if not all(-47.5 < x < -46.0 and -24.2 < y < -23.2 for x, y in c):
                    bad += 1
                    continue
            nums = [p.get(k) for k in ('cd_numero_inicial_par', 'cd_numero_final_par', 'cd_numero_inicial_impar', 'cd_numero_final_impar')]
            valid = [x for x in nums if x is not None]
            segs.append({
                'id': p['cd_identificador'], 'codlog': p.get('codlog') or str(p.get('cd_identificador_logradouro')),
                'tipo': (p.get('cd_tipo_logradouro') or '').strip(), 'titulo': (p.get('cd_titulo_logradouro') or '').strip() or None,
                'nome': (p.get('nm_logradouro') or '').strip(), 'ordem': p.get('cd_numero_ordem_segmento'),
                'par_ini': nums[0], 'par_fim': nums[1], 'impar_ini': nums[2], 'impar_fim': nums[3],
                'lo': min(valid) if valid else None, 'coords': [pt[:2] for pt in c],
            })
        print(f'    página {start}: {len(feats)} (total {total})', flush=True)
        if len(feats) < PAGE:
            break
        start += PAGE
    flipped = _orienta(segs)
    with _pg_conn() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute('delete from addr_segment where cod_mun = %s', (COD_SP,))
        with cur.copy('copy addr_segment (id, cod_mun, codlog, tipo, titulo, nome, ordem, par_ini, par_fim, impar_ini, impar_fim, geom) from stdin') as cp:
            seen = set()
            for s in segs:
                if s['id'] in seen or not s['nome']:
                    continue
                seen.add(s['id'])
                wkt = 'SRID=4326;LINESTRING(' + ','.join(f'{x:.7f} {y:.7f}' for x, y in s['coords']) + ')'
                cp.write_row((s['id'], COD_SP, s['codlog'], s['tipo'], s['titulo'], s['nome'], s['ordem'],
                              s['par_ini'], s['par_fim'], s['impar_ini'], s['impar_fim'], wkt))
        # tipo canônico (R → RUA, AV → AVENIDA) e nome normalizado com a MESMA função do CNEFE
        cur.execute("""update addr_segment s set tipo = coalesce(m.t, s.tipo), core_norm = m.c
                         from (select tipo, nome, geo_canon(tipo) t, geo_canon(nome) c
                                 from (select distinct tipo, nome from addr_segment where cod_mun = %(m)s) x) m
                        where s.cod_mun = %(m)s and s.tipo = m.tipo and s.nome = m.nome""", {'m': COD_SP})
        cur.execute('select count(*), ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_ConvexHull(ST_Collect(ST_StartPoint(geom))), 0.001), 6) '
                    'from addr_segment where cod_mun = %s', (COD_SP,))
        n, hull = cur.fetchone()
    NOTES = (f'{n:,} segmentos com faixa de numeração em addr_segment (tabela própria; {flipped:,} linhas invertidas para '
             f'seguir a numeração crescente; {bad} descartados por coordenada inválida). A feição aqui é só a cobertura.')
    print('    ' + NOTES)
    return [{'source_id': str(COD_SP), 'geometry': json.loads(hull), 'name': 'São Paulo (GeoSampa)', 'kind': 'cobertura_geosampa',
             'props': {'cod_ibge': COD_SP, 'segmentos': n}}]
