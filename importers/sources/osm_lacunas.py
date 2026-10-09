"""Lacunas do OSM que importam para caminhão (fila de coleta + aviso na rota). Camada informativa: nada aqui bloqueia.

Tipos (kind):
  - passagem_sem_altura : via principal (motorway..tertiary, inclusive alças) que passa SOB ponte/viaduto/passarela/
                          ferrovia (cruzamento geométrico, layer maior por cima, sem nó em comum) e não tem maxheight.
                          Um ponto por estrutura (cruzamentos a até 25 m na mesma via viram um só). Geometria = trecho
                          de ~60 m da via de baixo centrado no cruzamento (a API usa para saber se a rota passa POR BAIXO).
  - tunel_sem_altura    : túnel/via coberta em via principal sem maxheight.
  - altura_abaixo_padrao: via trafegável com maxheight=below_default (há limite abaixo do legal, valor desconhecido;
                          o Valhalla ignora).
  - restritor_sem_valor : barrier=height_restrictor em via trafegável sem maxheight numérico.
  - maxheight_suspeito  : maxheight numérico > 7 m (provável gabarito medido/estimado, não placa).
  - maxweight_suspeito  : maxweight < 1 t, sem unidade e alto (provável kg) ou com vírgula (o Valhalla lê '3,5' como 3 t).
"Sem maxheight" = sem valor numérico em maxheight nem maxheight:physical e sem maxheight=default/none/no_indications
(ou maxheight:signed=no), que significam "conferido, sem placa".

Licença: ODbL 1.0 (derivado do OSM). PBF: o mesmo do Valhalla (ver osm_altura_nos.pbf_path).
"""
from __future__ import annotations
import re, time
from array import array
from sources.osm_altura_nos import (DRIVABLE, MAJOR, NO_SIGN, parse_length, parse_weight, valhalla_weight, pbf_path, fmt)

LAYER_ID = 'lacunas_osm'
SOURCE = 'osm'
SOURCE_URL = 'https://download.geofabrik.de/south-america/brazil/sudeste.html (PBF local em data/valhalla)'
LICENSE = 'ODbL 1.0 — © colaboradores do OpenStreetMap'
NOTES = ('Informativa (não bloqueia). Passagens inferiores e túneis em via principal sem maxheight, maxheight=below_default, '
         'height_restrictor sem valor, maxheight > 7 m e maxweight suspeito. Calculado do PBF do Valhalla.')

RAIL = {'rail', 'light_rail', 'subway', 'tram', 'narrow_gauge', 'monorail', 'preserved', 'disused', 'abandoned',
        'construction', 'funicular', 'miniature'}
PEDESTRIAN = {'footway', 'cycleway', 'path', 'steps', 'pedestrian', 'bridleway', 'corridor', 'platform'}
CLUSTER_M = 25.0
HALF_PIECE_M = 30.0
OVER_LABEL = {'viaduto': 'viaduto', 'passarela': 'passarela', 'ferrovia': 'ponte ferroviária', 'ponte': 'ponte'}


def _layer(tags, default: int) -> int:
    try:
        return int(float(tags.get('layer', default)))
    except (TypeError, ValueError):
        return default


def _is_bridge(tags) -> bool:
    return tags.get('bridge') not in (None, 'no')


def _is_tunnel(tags) -> bool:
    return tags.get('tunnel') not in (None, 'no') or tags.get('covered') not in (None, 'no')


def height_status(tags) -> str:
    """'numerico' | 'sem_placa' (conferido) | 'below_default' | 'sem_tag'"""
    if parse_length(tags.get('maxheight')) is not None or parse_length(tags.get('maxheight:physical')) is not None:
        return 'numerico'
    v = (tags.get('maxheight') or '').strip().lower()
    if v == 'below_default':
        return 'below_default'
    if v in NO_SIGN or tags.get('maxheight:signed') == 'no':
        return 'sem_placa'
    return 'sem_tag'


KEEP = ('highway', 'railway', 'bridge', 'tunnel', 'covered', 'layer', 'maxheight', 'maxheight:physical', 'maxheight:signed',
        'maxweight', 'name', 'ref', 'oneway', 'junction', 'bridge:name', 'tunnel:name')


def fetch():
    import numpy as np
    import osmium
    from osmium.filter import KeyFilter, IdFilter, TagFilter
    from shapely import STRtree
    from shapely.geometry import LineString, Point, MultiPoint
    from shapely.ops import substring
    pbf = pbf_path()
    t0 = time.time()
    print(f'  PBF: {pbf}')

    # 0) barrier=height_restrictor sem valor numérico
    restrictors: dict[int, dict] = {}
    for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(TagFilter(('barrier', 'height_restrictor'))):
        tags = {t.k: t.v for t in n.tags}
        if parse_length(tags.get('maxheight')) is None and parse_length(tags.get('maxheight:physical')) is None:
            restrictors[n.id] = {'lon': n.location.lon, 'lat': n.location.lat, 'tags': tags, 'way': None}
    print(f'  height_restrictor sem valor: {len(restrictors)} ({time.time()-t0:.0f}s)')

    # 1) vias: estruturas por cima, vias principais candidatas por baixo, túneis e valores suspeitos
    over, under, single = [], [], []   # (way_id, tags, refs array)
    for w in osmium.FileProcessor(pbf, osmium.osm.WAY).with_filter(KeyFilter('highway', 'railway')):
        hw = w.tags.get('highway')
        rw = w.tags.get('railway')
        tags = {k: w.tags.get(k) for k in KEEP if k in w.tags}
        refs = None
        if _is_bridge(tags) and ((hw and hw not in ('proposed', 'construction', 'platform', 'elevator')) or rw in RAIL):
            refs = array('q', (n.ref for n in w.nodes))
            kind = 'ferrovia' if (rw in RAIL and not hw) else 'passarela' if hw in PEDESTRIAN else 'viaduto' if hw in DRIVABLE else 'ponte'
            over.append((w.id, tags, refs, kind))
        if hw not in DRIVABLE:
            continue
        hs = height_status(tags)
        if restrictors:
            for n in w.nodes:
                r = restrictors.get(n.ref)
                if r and r['way'] is None:
                    r['way'] = (w.id, tags.get('name') or tags.get('ref'), hw)
        major = hw in MAJOR
        reasons = []
        if major and not _is_bridge(tags) and hs in ('sem_tag',):
            refs = refs or array('q', (n.ref for n in w.nodes))
            under.append((w.id, tags, refs))
            if _is_tunnel(tags):
                reasons.append('tunel_sem_altura')
        if hs == 'below_default':
            reasons.append('altura_abaixo_padrao')
        mh = parse_length(tags.get('maxheight')) or parse_length(tags.get('maxheight:physical'))
        if mh is not None and mh > 7:
            reasons.append('maxheight_suspeito')
        if 'maxweight' in tags:
            mine, prob = parse_weight(tags['maxweight'])
            vh = valhalla_weight(tags['maxweight'])
            if prob or (mine is not None and vh is not None and abs(mine - vh) > 0.2):
                reasons.append('maxweight_suspeito')
        if reasons:
            refs = refs or array('q', (n.ref for n in w.nodes))
            single.append((w.id, tags, refs, reasons))
    print(f'  estruturas por cima: {len(over)}; vias principais sem altura: {len(under)}; outras lacunas: {len(single)} ({time.time()-t0:.0f}s)')

    # 2) coordenadas (só dos nós necessários), em arrays numpy ordenados
    need = set()
    for coll in (over, under, single):
        for item in coll:
            need.update(item[2])
    ids, lons, lats = array('q'), array('d'), array('d')
    for n in osmium.FileProcessor(pbf, osmium.osm.NODE).with_filter(IdFilter(need)):
        ids.append(n.id); lons.append(n.location.lon); lats.append(n.location.lat)
    del need
    ids_np = np.frombuffer(ids, dtype=np.int64)
    order = np.argsort(ids_np)
    ids_np = ids_np[order]
    xy = np.column_stack([np.frombuffer(lons, dtype=np.float64)[order], np.frombuffer(lats, dtype=np.float64)[order]])
    print(f'  coordenadas: {len(ids_np)} nós ({time.time()-t0:.0f}s)')

    def coords_of(refs):
        r = np.frombuffer(refs, dtype=np.int64)
        idx = np.searchsorted(ids_np, r)
        idx[idx >= len(ids_np)] = 0
        ok = ids_np[idx] == r
        if not ok.all():
            return None
        return xy[idx]

    def line(refs):
        c = coords_of(refs)
        if c is None or len(c) < 2:
            return None
        g = LineString(c)
        return g if g.length > 0 else None

    # projeção local simples (graus -> metros) para distâncias e recortes
    M_LAT = 110574.0
    def m_per_deg_lon(lat): return 111320.0 * np.cos(np.radians(lat))

    out = []

    # 3) passagens inferiores: via principal sem altura cruzando por baixo de estrutura
    over_geoms, over_meta = [], []
    for wid, tags, refs, kind in over:
        g = line(refs)
        if g is not None:
            over_geoms.append(g)
            over_meta.append((wid, tags, set(refs), kind))
    tree = STRtree(over_geoms)
    under_geoms, under_meta = [], []
    for wid, tags, refs in under:
        g = line(refs)
        if g is not None:
            under_geoms.append(g)
            under_meta.append((wid, tags, refs))
    pairs = tree.query(under_geoms, predicate='crosses')
    print(f'  pares via×estrutura que se cruzam: {pairs.shape[1]} ({time.time()-t0:.0f}s)')
    by_under: dict[int, list] = {}
    for ui, oi in zip(pairs[0], pairs[1]):
        uwid, utags, urefs = under_meta[ui]
        owid, otags, orefs, okind = over_meta[oi]
        lu = _layer(utags, -1 if _is_tunnel(utags) else 0)
        lo = _layer(otags, 1)
        if lo <= lu:
            continue
        if orefs.intersection(urefs):
            continue
        inter = under_geoms[ui].intersection(over_geoms[oi])
        pts = [inter] if isinstance(inter, Point) else list(getattr(inter, 'geoms', []))
        for p in pts:
            if isinstance(p, Point):
                by_under.setdefault(ui, []).append((p, oi))
    n_pass = 0
    for ui, hits in by_under.items():
        uwid, utags, _ = under_meta[ui]
        g = under_geoms[ui]
        lat0 = g.centroid.y
        kx, ky = m_per_deg_lon(lat0), M_LAT
        # comprimento em metros ao longo da via (para recortar ±30 m)
        cm = np.asarray(g.coords)
        seg = np.hypot(np.diff(cm[:, 0]) * kx, np.diff(cm[:, 1]) * ky)
        cum = np.concatenate([[0], np.cumsum(seg)])
        total_m = cum[-1]
        def deg_to_m(d):  # posição (em graus ao longo da linha) -> metros
            # usa a fração ao longo da linha em graus e converte por interpolação
            return float(np.interp(d, np.concatenate([[0], np.cumsum(np.hypot(np.diff(cm[:, 0]), np.diff(cm[:, 1])))]), cum))
        def m_to_deg(m):
            return float(np.interp(m, cum, np.concatenate([[0], np.cumsum(np.hypot(np.diff(cm[:, 0]), np.diff(cm[:, 1])))])))
        hits.sort(key=lambda h: g.project(h[0]))
        clusters: list[list] = []
        for p, oi in hits:
            pos = deg_to_m(g.project(p))
            if clusters and pos - clusters[-1][-1][0] <= CLUSTER_M:
                clusters[-1].append((pos, p, oi))
            else:
                clusters.append([(pos, p, oi)])
        for cl in clusters:
            pos = sum(c[0] for c in cl) / len(cl)
            a, b = max(0.0, pos - HALF_PIECE_M), min(total_m, pos + HALF_PIECE_M)
            piece = substring(g, m_to_deg(a), m_to_deg(b))
            if piece.is_empty or piece.geom_type != 'LineString':
                continue
            p0 = cl[0][1]
            overs, seen_o = [], set()
            for _, _, oi in cl:
                owid, otags, _, okind = over_meta[oi]
                if owid in seen_o:
                    continue
                seen_o.add(owid)
                o = {'way_id': owid, 'tipo': okind}
                nm_o = otags.get('bridge:name') or otags.get('name') or otags.get('ref')
                if nm_o:
                    o['nome'] = nm_o
                overs.append(o)
            kinds = {o['tipo'] for o in overs}
            okind = 'ferrovia' if 'ferrovia' in kinds else 'viaduto' if 'viaduto' in kinds else 'ponte' if 'ponte' in kinds else 'passarela'
            oname = next((o['nome'] for o in overs if o.get('nome')), None)
            uname = utags.get('name') or utags.get('ref')
            hw = utags.get('highway')
            prio = 1 if okind == 'ferrovia' else 2 if okind in ('viaduto', 'ponte') else 3
            name = f"{uname or 'Via sem nome'} sob {OVER_LABEL[okind]}" + (f' ({oname})' if oname else '')
            out.append({
                'source_id': f'p{uwid}_{int(round(pos))}',
                'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7), round(y, 7)] for x, y in piece.coords]},
                'name': name[:160],
                'kind': 'passagem_sem_altura',
                'props': {'lat': round(p0.y, 7), 'lon': round(p0.x, 7), 'via_id': uwid, 'via': uname, 'highway': hw,
                          'estrutura': okind, 'estrutura_nome': oname, 'estruturas': overs[:3], 'prioridade': prio},
            })
            n_pass += 1
    print(f'  passagens inferiores sem altura: {n_pass} ({time.time()-t0:.0f}s)')

    # 4) túneis, below_default, valores suspeitos (a via inteira)
    for wid, tags, refs, reasons in single:
        g = line(refs)
        if g is None:
            continue
        gs = g.simplify(0.00002, preserve_topology=False)
        if gs.length == 0:
            gs = g
        nm = tags.get('name') or tags.get('ref') or tags.get('tunnel:name')
        mid = g.interpolate(0.5, normalized=True)
        for reason in reasons:
            props = {'lat': round(mid.y, 7), 'lon': round(mid.x, 7), 'via_id': wid, 'via': nm, 'highway': tags.get('highway')}
            if reason in ('maxheight_suspeito', 'altura_abaixo_padrao'):
                props['maxheight'] = tags.get('maxheight')
            if reason == 'maxweight_suspeito':
                props['maxweight'] = tags.get('maxweight')
            if reason == 'tunel_sem_altura':
                name = f"Túnel sem altura: {nm or 'via sem nome'}"
                props.update(prioridade=1)
            elif reason == 'altura_abaixo_padrao':
                name = f"Altura abaixo do padrão, valor desconhecido: {nm or 'via sem nome'}"
                props.update(prioridade=1)
            elif reason == 'maxheight_suspeito':
                v = parse_length(tags.get('maxheight')) or parse_length(tags.get('maxheight:physical'))
                name = f"Altura suspeita ({fmt(v, 'm')}): {nm or 'via sem nome'}"
                props.update(prioridade=3, valor_m=v, motivo='acima de 7 m (provável gabarito medido, não placa)')
            else:
                mine, prob = parse_weight(tags.get('maxweight'))
                vh = valhalla_weight(tags.get('maxweight'))
                motivo = prob or f'o Valhalla lê {fmt(vh, "t")} (vírgula decimal)'
                # valor provável da placa: kg sem unidade -> t; vírgula -> o número com decimal; < 1 t -> desconhecido
                provavel = None
                if prob and 'provável kg' in prob:
                    provavel = round(float(re.sub(r'[^0-9.]', '', tags['maxweight'].replace(',', '.'))) / 1000, 2)
                elif not prob:
                    provavel = mine
                name = f"Peso suspeito ({tags.get('maxweight')}): {nm or 'via sem nome'}"
                props.update(prioridade=2, valor_t=mine, valhalla_le_t=vh, provavel_t=provavel, motivo=motivo)
            out.append({'source_id': f'{reason[:3]}{wid}', 'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7), round(y, 7)] for x, y in gs.coords]},
                        'name': name[:160], 'kind': reason, 'props': props})

    # 5) limitadores de altura sem valor (em via trafegável)
    for nid, r in restrictors.items():
        if not r['way']:
            continue
        wid, wname, hw = r['way']
        out.append({'source_id': f'r{nid}', 'geometry': {'type': 'Point', 'coordinates': [round(r['lon'], 7), round(r['lat'], 7)]},
                    'name': f"Limitador de altura sem valor: {wname or 'via sem nome'}", 'kind': 'restritor_sem_valor',
                    'props': {'lat': round(r['lat'], 7), 'lon': round(r['lon'], 7), 'osm_node': nid, 'via_id': wid, 'via': wname,
                              'highway': hw, 'prioridade': 1}})
    import collections
    print('  por tipo:', dict(collections.Counter(f['kind'] for f in out)), f'({time.time()-t0:.0f}s)')
    return out
