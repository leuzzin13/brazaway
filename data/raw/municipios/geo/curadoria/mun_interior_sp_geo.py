"""Curadoria da geometria da frente mun_interior_sp (interior e litoral de SP) da camada restricoes_rmsp.

Gera os GeoJSON curados de data/raw/municipios/geo/ que os arquivos de município referenciam com construir "manual"
(zonas) e "trechos" (vias). Os atos não trazem coordenadas: os contornos são montados sobre o OpenStreetMap (ODbL 1.0)
e os limites municipais do IBGE. Não faz parte do import: roda uma vez, à mão, e o resultado é versionado (o import é
determinístico e não consulta o Overpass quando o arquivo existe).

  docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data:/data -e DATA_DIR=/data -e VALHALLA_URL=http://valhalla:8002 \
    --network truck-router_default --entrypoint python truck-router-importer \
    /data/raw/municipios/geo/curadoria/mun_interior_sp_geo.py [campinas|sao-vicente|santos|jacarei|vias] [--refazer]

Zonas (polígonos):
  * campinas: Anel Rodoviário (área interna às pistas e marginais da SP-065, SP-330 e SP-083, com as alças), Distrito
    de Nova Aparecida (R. Batista Raffi, SP-330, Rod. Adalberto Panzan, SP-101 e as divisas com Hortolândia e Sumaré) e
    Anel de Integração Eng. Rebouças (as 20 vias do art. 5º, parágrafo único, da Res. 079/2017, cada uma entre a anterior
    e a seguinte);
  * sao-vicente: ARC do centro (perímetro descrito no art. 1º da Lei 2163-A/2009);
  * santos: Zona de Restrição do Gonzaga (quadrilátero das 5 avenidas citadas no DO de 16/02/2002);
  * jacarei: município (IBGE) menos as 7 Rotas de Cargas Pesadas do Dec. 247/2017 e as rodovias estaduais e federais com
    as alças, em pedaços (um por feição).
Vias (construir "trechos"): monta pelo importador genérico (municipios.compilar), mas com o Overpass restrito aos nomes
citados nos trechos (a consulta de todas as vias com nome de cidades grandes, como Sorocaba e Piracicaba, é pesada).
"""
from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys
import time

sys.path.insert(0, '/app')

from shapely.geometry import LineString, Point, Polygon, MultiPolygon, box, mapping  # noqa: E402
from shapely.ops import unary_union  # noqa: E402

from sources import _municipios_lib as lib  # noqa: E402
from sources import municipios as M  # noqa: E402

GEO = lib.RAW_DIR / 'municipios' / 'geo'
REFAZER = '--refazer' in sys.argv
HOJE = time.strftime('%Y-%m-%d')
OSM_LIC = 'OpenStreetMap (ODbL 1.0, © colaboradores do OpenStreetMap) via Overpass'


# ----------------------------------------------------------------------------- utilidades
def overpass(q: str, nome: str) -> list[dict]:
    h = hashlib.md5(q.encode()).hexdigest()[:10]
    return lib._overpass(q, f'misp_{nome}_{h}.json')


def linha(e: dict) -> LineString:
    return lib.to_utm(LineString([(n['lon'], n['lat']) for n in e['geometry']]))


def pt(lon: float, lat: float):
    return lib.to_utm(Point(lon, lat))


def ll(g, nd: int = 6) -> dict:
    return lib.round_geojson(lib.to_ll(g).__geo_interface__, nd)


def vias_com_nome(bbox: tuple[float, float, float, float], nomes: list[str], nome_cache: str) -> list[dict]:
    s, w, n, e = bbox
    rx = '|'.join(re.escape(x).replace('"', '\\"') for x in sorted(set(nomes)))
    q = f'[out:json][timeout:120];way({s},{w},{n},{e})["highway"]["name"~"^({rx})$"];out geom tags;'
    return overpass(q, nome_cache)


def buraco_com(linhas: list, buf: float, dentro) -> Polygon | None:
    """Maior região fechada pelas linhas (buffer de `buf` m) que contém o ponto `dentro` (UTM)."""
    u = unary_union([g.buffer(buf, quad_segs=2) for g in linhas])
    for p in getattr(u, 'geoms', [u]):
        for r in p.interiors:
            P = Polygon(r)
            if P.contains(dentro):
                return P
    return None


def trechos_utm(osm: list[dict], pernas: list[dict], clip, emenda_max: float = 150.0) -> tuple[list, list[str]]:
    """Perímetro descrito como sequência de pernas 'via X entre Y e Z' (lib.build_trecho), em UTM. O caminho de cada
    perna para no vértice mais próximo do cruzamento: as pontas de pernas seguidas são emendadas por um segmento reto
    (até `emenda_max` m) para o perímetro fechar. Devolve as linhas e as pendências."""
    pernas_g, pend = [], []
    for p in pernas:
        fs, iss = lib.build_trecho(osm, p, clip)
        pend += iss
        if fs:
            pernas_g.append([lib.to_utm(LineString(f['geometry']['coordinates'])) for f in fs])
            continue
        # o caminho entre as duas transversais não fechou (pista dupla com mão única, cruzamento em desnível): usa a via
        # inteira, que só serve quando ela não avança para dentro da área (conferido no mapa)
        inteira = [g for g in (L.intersection(clip) for _, L in lib._ways_by_names(osm, p['via'])) if not g.is_empty]
        pernas_g.append(inteira)
        pend.append(f'perna aproximada (via inteira): {p["via"][0]}' if inteira else f'perna sem geometria: {p["via"][0]}')
    from shapely.ops import nearest_points
    out = [g for gs in pernas_g for g in gs]
    for i, gs in enumerate(pernas_g):
        prox = pernas_g[(i + 1) % len(pernas_g)]
        if not gs or not prox:
            continue
        a, b = unary_union(gs), unary_union(prox)
        d = a.distance(b)
        if 0 < d <= emenda_max:
            out.append(LineString(nearest_points(a, b)))
        elif d > emenda_max:
            pend.append(f'pernas {pernas[i]["via"][0]} e {pernas[(i + 1) % len(pernas)]["via"][0]} a {d:.0f} m')
    return out, pend


def gravar(rel: str, feats: list[dict], meta: dict) -> None:
    p = lib.raw_path(rel)
    fc = {'type': 'FeatureCollection', 'gerado_em': HOJE, 'fonte_geometria': meta.pop('fonte_geometria'),
          'como_gerar': 'data/raw/municipios/geo/curadoria/mun_interior_sp_geo.py', **meta, 'features': feats}
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    nv = sum(len(c) for f in feats for c in _aneis(f['geometry']))
    print(f'  gravado data/raw/{rel}: {len(feats)} feição(ões), {nv} vértices')


def _aneis(g: dict) -> list:
    if g['type'] == 'Polygon':
        return g['coordinates']
    if g['type'] == 'MultiPolygon':
        return [r for p in g['coordinates'] for r in p]
    return [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']


def feat(g, props: dict) -> dict:
    return {'type': 'Feature', 'geometry': ll(g), 'properties': props}


def sem_buracos(P: Polygon) -> Polygon:
    return Polygon(P.exterior)


# ----------------------------------------------------------------------------- Campinas (Res. SETRANSP 079/2017)
CAMPINAS_BBOX = (-23.05, -47.25, -22.75, -46.90)


def _rodovias_campinas() -> list[dict]:
    s, w, n, e = CAMPINAS_BBOX
    q = (f'[out:json][timeout:180];way({s},{w},{n},{e})["highway"~"^(motorway|motorway_link|trunk|trunk_link)$"];'
         'out geom tags;')
    return overpass(q, 'campinas_rodovias')


def campinas_anel_rodoviario() -> None:
    """Art. 3º, parágrafo único: polígono das Rodovias Dom Pedro I, Anhanguera e José Roberto Magalhães Teixeira."""
    els = _rodovias_campinas()
    refs = ('SP-330', 'SP-065', 'SP-083', 'SPM 330')
    nomes = ('Rodovia Anhanguera', 'Rodovia Dom Pedro I', 'Rodovia José Roberto Magalhães Teixeira')

    def do_anel(e):
        t = e['tags']
        if any((t.get('ref') or '').startswith(r) for r in refs):
            return True
        return (t.get('name') or '').startswith(nomes) and t['highway'] in ('motorway', 'trunk')
    anel = [linha(e) for e in els if do_anel(e)]
    ru = unary_union(anel).buffer(30)
    # alças que tocam as três rodovias (inclusive as de ligação entre elas): ficam livres; as que levam ao interior
    # terminam em vias internas, que continuam dentro da zona
    alcas = [g for g in (linha(e) for e in els if e['tags']['highway'].endswith('_link')) if g.intersects(ru)]
    P = buraco_com(anel + alcas, 25, pt(-47.0611, -22.9030))       # Catedral Metropolitana
    if P is None:
        raise SystemExit('anel rodoviário: polígono interno não fechou')
    P = P.simplify(8)
    for nome, lon, lat, esperado in [('Centro', -47.0611, -22.9030, True), ('Taquaral', -47.0500, -22.8740, True),
                                     ('Barão Geraldo', -47.0750, -22.8200, False), ('Sousas', -46.9700, -22.8800, False),
                                     ('Viracopos', -47.1340, -23.0070, False), ('Nova Aparecida', -47.1538, -22.8574, False)]:
        assert P.contains(pt(lon, lat)) == esperado, nome
    print(f'  anel rodoviário: {P.area / 1e6:.1f} km²')
    gravar('municipios/geo/3509502_anel_rodoviario.geojson', [feat(P, {'nome': 'Área interna do Anel Rodoviário'})], {
        'fonte_geometria': (f'{OSM_LIC}: região fechada pelas pistas e marginais da Rod. Dom Pedro I (SP-065), Rod. Anhanguera '
                            '(SP-330) e Rod. José Roberto Magalhães Teixeira (SP-083) e pelas alças que as tocam, a 25 m do eixo '
                            'mais interno (a API recua mais 20 m); simplificada a 8 m'),
        'ato': 'Res. SETRANSP 079/2017 de Campinas, art. 3º, parágrafo único'})


def campinas_nova_aparecida() -> None:
    """Art. 4º, parágrafo único: R. Batista Raffi, Rod. Anhanguera, Rod. Adalberto Panzan, Rod. Jornalista Francisco
    Aguirre Proença e o viário limítrofe com Hortolândia e Sumaré."""
    els = _rodovias_campinas()

    def borda(e):
        t = e['tags']
        nm, ref = t.get('name') or '', t.get('ref') or ''
        return (ref.startswith(('SP-330', 'SPM 330', 'SPA-102/330', 'SP-101')) or
                nm.startswith(('Rodovia Anhanguera', 'Rodovia Adalberto Panzan', 'Rodovia Jornalista Francisco Aguirre Proença')))
    rod = [linha(e) for e in els if borda(e) and not e['tags']['highway'].endswith('_link')]
    raffi = [linha(e) for e in vias_com_nome((-22.88, -47.20, -22.82, -47.12), ['Rua Batista Raffi'], 'campinas_raffi')]
    if not raffi:
        raise SystemExit('Nova Aparecida: R. Batista Raffi não encontrada no OSM')
    camp = lib.to_utm(lib.municipio_geom('3509502'))
    corte = unary_union([g.buffer(20, quad_segs=2) for g in rod + raffi])
    pedacos = camp.difference(corte)
    alvo = pt(-47.1538, -22.8574)                   # nó 'Nova Aparecida' (place=village) do OSM
    P = next((p for p in getattr(pedacos, 'geoms', [pedacos]) if p.contains(alvo)), None)
    if P is None or P.area > 40e6:
        raise SystemExit(f'Nova Aparecida: polígono não fechou ({None if P is None else round(P.area / 1e6, 1)} km²)')
    P = sem_buracos(P).simplify(8)
    # comparação com o contorno administrativo do OSM (relação 3028335, "Nova Aparecida")
    rel = overpass('[out:json][timeout:60];rel(3028335);out geom;', 'campinas_na_rel')
    if rel:
        from shapely.ops import polygonize
        outer = [lib.to_utm(LineString([(n['lon'], n['lat']) for n in m['geometry']]))
                 for m in rel[0].get('members', []) if m.get('type') == 'way' and m.get('role') == 'outer']
        R = unary_union(list(polygonize(unary_union(outer))))
        if not R.is_empty:
            print(f'  Nova Aparecida: ato {P.area / 1e6:.2f} km², relação OSM {R.area / 1e6:.2f} km², '
                  f'interseção {P.intersection(R).area / 1e6:.2f} km²')
    gravar('municipios/geo/3509502_nova_aparecida.geojson', [feat(P, {'nome': 'Distrito de Nova Aparecida'})], {
        'fonte_geometria': (f'{OSM_LIC} (R. Batista Raffi, Rod. Anhanguera e marginais, Rod. Adalberto Panzan, Rod. Jornalista '
                            'Francisco Aguirre Proença; corte de 20 m do eixo) e limite municipal de Campinas (IBGE, Malha '
                            'Municipal, qualidade máxima) nas divisas com Hortolândia e Sumaré; simplificada a 8 m'),
        'ato': 'Res. SETRANSP 079/2017 de Campinas, art. 4º, parágrafo único'})


# art. 5º, parágrafo único, I–XX, na ordem do anel; nomes como estão no OSM
REBOUCAS = [
    ('I', ['Avenida Doutor Abelardo Pompeo do Amaral']),
    ('II', ['Avenida Doutor Pedro Salomão José Kassab']),
    ('III', ['Avenida Prefeito Magalhães Teixeira']),
    ('IV', ['Rua Plínio Pereira Neves']),
    ('V', ['Avenida Doutor Ângelo Simões']),
    ('VI', ['Avenida Monte Castelo']),
    ('VII', ['Avenida Ayrton Senna']),
    ('VIII', ["Avenida Princesa d'Oeste"]),
    ('IX', ['Avenida José de Souza Campos']),
    ('X', ['Avenida Júlio Prestes']),
    ('XI', ['Rua Dona Luísa de Gusmão', 'Rua Dona Luisa de Gusmão']),
    ('XII–XIII', ['Avenida Doutor Heitor Penteado', 'Avenida Heitor Penteado']),
    ('XIV', ['Avenida Padre Almeida Garret', 'Avenida Almeida Garret']),
    ('XV', ['Avenida Doutor Theodureto de Almeida Camargo']),
    ('XVI', ['Avenida Luis Smânio']),
    ('XVII', ['Avenida Andrade Neves']),
    ('XVIII', ['Avenida Doutor Alberto Sarmento']),
    ('XIX', ['Rua Joaquim Vilac']),
    ('XX', ['Avenida Barão de Monte Alegre']),
]


def campinas_anel_reboucas() -> None:
    nomes = [n for _, ns in REBOUCAS for n in ns]
    osm = vias_com_nome((-22.95, -47.11, -22.85, -47.02), nomes, 'campinas_reboucas')
    pernas = []
    for i, (inc, ns) in enumerate(REBOUCAS):
        pernas.append({'inciso': inc, 'via': ns, 'de': REBOUCAS[i - 1][1], 'ate': REBOUCAS[(i + 1) % len(REBOUCAS)][1],
                       'tolerancia_m': 80})
    clip = lib.to_utm(box(-47.11, -22.95, -47.02, -22.85))
    linhas, pend = trechos_utm(osm, pernas, clip)
    for p in pend:
        print('  ! Rebouças:', p)
    centro = pt(-47.0611, -22.9030)
    P = buraco_com(linhas, 30, centro)              # 30 m: fecha os cruzamentos em que a perna para antes da transversal
    if P is None:
        raise SystemExit('Anel Rebouças: polígono não fechou (veja as pendências)')
    P = P.simplify(5)
    print(f'  anel Rebouças: {P.area / 1e6:.2f} km²')
    gravar('municipios/geo/3509502_anel_reboucas.geojson', [feat(P, {'nome': 'Área interna do Anel de Integração Eng. Rebouças'})], {
        'fonte_geometria': (f'{OSM_LIC}: região fechada pelas 20 vias do art. 5º, parágrafo único (cada uma entre a anterior e a '
                            'seguinte), a 30 m do eixo (a API recua mais 20 m); simplificada a 5 m'),
        'ato': 'Res. SETRANSP 079/2017 de Campinas, art. 5º, parágrafo único', 'pendencias': pend})


# ----------------------------------------------------------------------------- São Vicente (Lei 2163-A/2009)
ARC = [  # perímetro do art. 1º, na ordem; "Av. Antônio Rodrigues" não existe no OSM: a orla segue como Pedro de Toledo
    (['Avenida Presidente Wilson'], ['Rua Mem de Sá'], ['Rua Benjamin Constant']),
    (['Rua Benjamin Constant'], ['Avenida Presidente Wilson'], ['Rua Campos Sales']),
    (['Rua Campos Sales'], ['Rua Benjamin Constant'], ['Rua Frei Gaspar']),
    (['Rua Frei Gaspar'], ['Rua Campos Sales'], ['Avenida Capitão Mor Aguiar']),
    (['Avenida Capitão Mor Aguiar'], ['Rua Frei Gaspar'], ['Rua do Colégio']),
    (['Rua do Colégio'], ['Avenida Capitão Mor Aguiar'], ['Praça Vinte e Dois de Janeiro']),
    (['Praça Vinte e Dois de Janeiro'], ['Rua do Colégio'], ['Avenida Embaixador Pedro de Toledo']),
    (['Avenida Embaixador Pedro de Toledo'], ['Praça Vinte e Dois de Janeiro'], ['Rua Mem de Sá']),
    (['Rua Mem de Sá'], ['Avenida Embaixador Pedro de Toledo'], ['Avenida Presidente Wilson']),
]


def sao_vicente_arc() -> None:
    nomes = sorted({n for v, a, b in ARC for n in v + a + b})
    osm = vias_com_nome((-23.980, -46.400, -23.955, -46.365), nomes, 'sv_arc')
    pernas = [{'via': v, 'de': a, 'ate': b, 'tolerancia_m': 60} for v, a, b in ARC]
    clip = lib.to_utm(box(-46.400, -23.980, -46.365, -23.955))
    linhas, pend = trechos_utm(osm, pernas, clip)
    for p in pend:
        print('  ! ARC:', p)
    corners = []
    for v, a, b in ARC:
        ws = lib._ways_by_names(osm, v)
        if ws:
            A = lib._anchor_points(osm, [L for _, L in ws], a, 60)
            if A:
                corners.append(A[0])
    dentro = unary_union(corners).convex_hull.centroid
    P = buraco_com(linhas, 10, dentro)
    if P is None:
        raise SystemExit('ARC: polígono não fechou')
    P = P.simplify(3)
    print(f'  ARC: {P.area / 1e6:.3f} km²')
    gravar('municipios/geo/3551009_arc.geojson', [feat(P, {'nome': 'ARC — Área de Restrição de Caminhões'})], {
        'fonte_geometria': (f'{OSM_LIC}: perímetro do art. 1º da Lei 2163-A/2009 percorrido pelas vias do OSM (cada uma entre a '
                            'anterior e a seguinte), a 10 m do eixo (a API recua mais 20 m). A "Av. Antônio Rodrigues" do texto '
                            'não existe no OSM: o trecho da orla até a R. Mem de Sá está como Av. Embaixador Pedro de Toledo'),
        'ato': 'Lei 2163-A/2009 de São Vicente, art. 1º', 'pendencias': pend})


# ----------------------------------------------------------------------------- Santos (Gonzaga)
def santos_gonzaga() -> None:
    nomes = ['Avenida Doutor Bernardino de Campos', 'Avenida Bernardino de Campos', 'Avenida Presidente Wilson',
             'Avenida Vicente de Carvalho', 'Avenida Conselheiro Nébias', 'Avenida General Francisco Glicério']
    osm = vias_com_nome((-23.9750, -46.3500, -23.9500, -46.3150), nomes, 'santos_gonzaga')
    P = buraco_com([linha(e) for e in osm], 12, pt(-46.3335, -23.9665))
    if P is None:
        raise SystemExit('Gonzaga: polígono não fechou')
    P = P.simplify(4)
    for nome, lon, lat, esperado in [('Pça. Independência', -46.3335, -23.9665, True), ('Embaré', -46.3150, -23.9740, False),
                                     ('José Menino', -46.3480, -23.9700, False)]:
        assert P.contains(pt(lon, lat)) == esperado, nome
    print(f'  Gonzaga: {P.area / 1e6:.2f} km²')
    gravar('municipios/geo/3548500_gonzaga.geojson', [feat(P, {'nome': 'Zona de Restrição do Gonzaga'})], {
        'fonte_geometria': (f'{OSM_LIC}: quadrilátero das Avenidas Bernardino de Campos, Presidente Wilson, Vicente de Carvalho, '
                            'Conselheiro Nébias e Francisco Glicério (DO Santos 16/02/2002), a 12 m do eixo'),
        'ato': 'DO Santos 16/02/2002 (notícia; ato não localizado)'})


# ----------------------------------------------------------------------------- Jacareí (Dec. 247/2017)
RCP = [  # art. 2º, IV, nomes como estão no OSM
    'Avenida Lucas Nogueira Garcez', 'Avenida Maria Augusta Fagundes Gomes', 'Rua Santa Helena', 'Avenida São João',
    'Avenida Santa Cruz dos Lázaros',                                                           # rota 1
    'Rodovia General Euryale de Jesus Zerbine',                                                  # rota 2
    'Avenida Presidente Getúlio Vargas', 'Avenida Getúlio Vargas',                               # rota 3
    'Avenida Malek Assad', 'Avenida Doutor Adhemar Pereira de Barros', 'Avenida Engenheiro Davi Monteiro Lino',  # rota 4
    'Avenida Presidente Humberto de Alencar Castelo Branco', 'Avenida Presidente Humberto de Alencar Castelo Bran',
    'Avenida Industrial',                                                                        # rota 5
    'Rodovia Nilo Máximo', 'Rodovia Nilo Maximo',                                                # rota 6
    'Rodovia Geraldo Scavone', 'Avenida do Cristal', 'Avenida José Ribeiro Moreira', 'Avenida São Jorge',  # rota 7
]


def _ligar_rotas(els: list[dict], livres: list[dict], rcp: list[dict], ancora: str, max_m: float) -> list[dict]:
    """Garante que cada via das rotas seja alcançável a partir da rede principal (as vias com nome `ancora`) e que dela
    se volte à rede principal, andando só por vias livres e respeitando a mão única do OSM. Quando não dá, acrescenta
    as vias do caminho mais curto (pela malha do OSM, nós em comum) que tenha até `max_m` fora das vias livres — são as
    ligações que o decreto não lista: rotatórias e alças sem nome, ou trechos curtos de outra rua entre duas rotas (ex.:
    a "rotatória da Gates", onde a rota 3 encontra a SP-066, ou a passagem da Av. do Cristal para a Rod. Geraldo
    Scavone na rota 7). Devolve as vias acrescentadas."""
    import heapq
    from collections import defaultdict
    k = lambda n: (round(n['lon'], 7), round(n['lat'], 7))
    por_id = {e['id']: e for e in els}
    fwd, rev = defaultdict(list), defaultdict(list)
    for e in els:
        cs = [k(n) for n in e['geometry']]
        ow = lib.is_oneway(e['tags'])
        for a, b in zip(cs[:-1], cs[1:]):
            w = lib._dist_m(a, b)
            if ow >= 0:
                fwd[a].append((b, w, e['id'])); rev[b].append((a, w, e['id']))
            if ow <= 0:
                fwd[b].append((a, w, e['id'])); rev[a].append((b, w, e['id']))
    livre = {e['id'] for e in livres}
    origem = {k(n) for e in els if e['tags'].get('name') == ancora for n in e['geometry']}
    novas: list[dict] = []

    def alcance(adj):
        vistos, pilha = set(origem), list(origem)
        while pilha:
            u = pilha.pop()
            for v, _, wid in adj[u]:
                if wid in livre and v not in vistos:
                    vistos.add(v); pilha.append(v)
        return vistos

    def ponte(adj, de: set, ate: set):
        dist = {n: 0.0 for n in de}
        prev, pq = {}, [(0.0, n) for n in de]
        heapq.heapify(pq)
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist.get(u, 1e18) or d > max_m:
                continue
            if u in ate:
                caminho = []
                while u in prev:
                    u, wid = prev[u]
                    if wid not in livre:
                        caminho.append(wid)
                return caminho
            for v, w, wid in adj[u]:
                nd = d + (0.0 if wid in livre else w)
                if nd < dist.get(v, 1e18):
                    dist[v] = nd; prev[v] = (u, wid); heapq.heappush(pq, (nd, v))
        return None

    for _ in range(30):
        mudou = False
        for adj in (fwd, rev):                  # ida (rede -> rota) e volta (rota -> rede)
            R = alcance(adj)
            for e in rcp:
                nos = {k(n) for n in e['geometry']}
                if nos & R:
                    continue
                c = ponte(adj, R, nos)
                if c:
                    for wid in c:
                        livre.add(wid)
                        if por_id[wid] not in novas:
                            novas.append(por_id[wid])
                    mudou = True
                    break                         # recalcula o alcance
            if mudou:
                break
        if not mudou:
            break
    for adj, nome in ((fwd, 'chegar a'), (rev, 'sair de')):
        R = alcance(adj)
        sem = sorted({e['tags'].get('name') for e in rcp if not ({k(n) for n in e['geometry']} & R)})
        if sem:
            print(f'  ! não dá para {nome} (sem passar por via fora das rotas, até {max_m:.0f} m):', sem)
    return novas


def jacarei_fora_rcp() -> None:
    q = ('[out:json][timeout:180];area["boundary"="administrative"]["admin_level"="8"]["IBGE:GEOCODIGO"="3524402"]->.a;'
         'way(area.a)["highway"~"^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|'
         'secondary_link|tertiary_link|unclassified|residential)$"];out geom tags;')
    els = overpass(q, 'jacarei_vias')
    rcp_n = {lib.norm(n) for n in RCP}
    rod, rcp, resto = [], [], []
    for e in els:
        t = e['tags']
        nm = t.get('name') or ''
        if t['highway'] in ('motorway', 'trunk', 'motorway_link', 'trunk_link') or nm.startswith('Rodovia '):
            rod.append(e)
        elif lib.norm(nm) in rcp_n:
            rcp.append(e)
        else:
            resto.append(e)
    base = [linha(e) for e in rod + rcp]
    bu = unary_union(base).buffer(60)
    rcp_u = unary_union([linha(x) for x in rcp]).buffer(30)
    extra_e = []
    for e in resto:
        t = e['tags']
        g = linha(e)
        rot = t.get('junction') in ('roundabout', 'circular')
        alca = t['highway'].endswith('_link')
        conector = not t.get('name') and t['highway'] in ('primary', 'secondary', 'tertiary') and g.length < 400
        if (rot or alca or conector) and bu.contains(Point(g.coords[0])) and bu.contains(Point(g.coords[-1])):
            extra_e.append(e)          # rotatórias, alças e conectores sem nome entre trechos das rotas/rodovias
        elif rot and g.intersects(rcp_u):
            extra_e.append(e)          # rotatórias citadas nas rotas (Gates, Av. Pensilvânia, Cidade Salvador)
    pontes = _ligar_rotas(els, rod + rcp + extra_e, rcp, ancora='Rodovia Presidente Dutra', max_m=500)
    for p in pontes:
        print('  ligação entre rotas:', p['tags'].get('name') or p['tags']['highway'], f'(way {p["id"]}, {linha(p).length:.0f} m)')
    extra = [linha(e) for e in extra_e + pontes]
    corte = unary_union([g.buffer(20, quad_segs=2) for g in base + extra])
    mun = lib.to_utm(lib.municipio_geom('3524402'))
    pedacos = [p for p in getattr(mun.difference(corte), 'geoms', [mun.difference(corte)])]
    feats, buracos, nv = [], 0, 0
    for p in sorted(pedacos, key=lambda x: -x.area):
        if p.buffer(-20).area < 5000:       # some no recuo de 20 m da API (canteiros, miolo de trevo e rotatória)
            continue
        if p.interiors:
            buracos += len(p.interiors)
            print(f'  ! pedaço de {p.area / 1e6:.2f} km² com {len(p.interiors)} buraco(s) (trecho de rota isolado?): '
                  f'{[tuple(round(c, 5) for c in lib.to_ll(Polygon(r)).centroid.coords[0]) for r in p.interiors][:5]}')
        s = sem_buracos(p).simplify(6)
        if s.is_empty or not s.is_valid:
            s = sem_buracos(p).simplify(3)
        nv += len(s.exterior.coords)
        feats.append(feat(s, {'parte': len(feats) + 1, 'aproximado': True}))
    print(f'  Jacareí: {len(rod)} vias de rodovia, {len(rcp)} das RCP, {len(extra)} rotatórias/alças/conectores; '
          f'{len(feats)} pedaços, {nv} vértices, {buracos} buraco(s)')
    area = sum(lib.to_utm(Polygon(f['geometry']['coordinates'][0])).area for f in feats)
    print(f'  área dos pedaços: {area / 1e6:.1f} km² de {mun.area / 1e6:.1f} km² do município')
    assert 0.8 < area / mun.area < 0.99
    gravar('municipios/geo/3524402_fora_rcp.geojson', feats, {
        'fonte_geometria': (f'Limite municipal de Jacareí (IBGE, Malha Municipal, qualidade máxima) menos um corredor de 20 m '
                            f'para cada lado do eixo das 7 Rotas de Cargas Pesadas (art. 2º, IV, do Dec. 247/2017), das rodovias '
                            f'estaduais e federais (Dutra, Carvalho Pinto, D. Pedro I, Henrique Eroles, Nicola Capucci) e das '
                            f'alças, rotatórias e conectores entre elas ({OSM_LIC}); a API recua mais 20 m. Um polígono por '
                            'pedaço; pedaços que somem no recuo foram descartados; simplificado a 6 m'),
        'ato': 'Dec. 247/2017 de Jacareí, art. 2º, IV, e art. 5º',
        'ligacoes_entre_rotas': [f"{p['tags'].get('name') or p['tags']['highway']} (way {p['id']}, {linha(p).length:.0f} m)" for p in pontes]})


# ----------------------------------------------------------------------------- vias (construir: trechos)
VIAS = {'3552205': (-23.60, -47.55, -23.40, -47.35), '3551009': (-23.995, -46.45, -23.93, -46.36),
        '3538709': (-22.80, -47.75, -22.65, -47.55), '3518701': (-24.00, -46.32, -23.90, -46.20)}


def _seis_casas(f: dict) -> list[dict]:
    """Linha de regra ativa já cortada em pedaços de até 400 m e com 6 casas decimais. A API manda as linhas ao Valhalla
    com 6 casas (ST_AsGeoJSON(geom, 6) em restricoes_rmsp.layer.ts) e o importador valida com a precisão do arquivo (7
    casas): uma linha da Av. Dom Aguirre passava na validação e, arredondada, derrubava a rota inteira ('Failed to edge
    walk line feature'). Com o arquivo já em 6 casas e sem pedaço acima de 440 m (o importador não corta de novo), o
    que o importador testa é exatamente o que a API manda."""
    out = []
    for c in lib.split_long(f['geometry']['coordinates']):
        cs = []
        for x, y in c:
            q = [round(x, 6), round(y, 6)]
            if not cs or cs[-1] != q:
                cs.append(q)
        if len(cs) >= 2:
            out.append({'type': 'Feature', 'properties': {**f['properties'], 'comprimento_m': round(lib.line_length_m(cs))},
                        'geometry': {'type': 'LineString', 'coordinates': cs}})
    return out


def vias(ibge: str) -> None:
    doc = M.carregar(M.MUNICIPIOS_DIR / f'{ibge}.json')
    nomes = sorted({n for r in doc['regras'] for t in r.get('trechos', [])
                    for k in ('via', 'de', 'ate') if isinstance(t.get(k), list) for n in t[k]})
    s, w, n, e = VIAS[ibge]
    lib.overpass_named_ways = lambda _ibge: vias_com_nome((s, w, n, e), nomes, f'vias_{ibge}')
    arquivos = {g['arquivo'] for r in doc['regras'] for g in r['geometria'] if g.get('construir') == 'trechos'}
    for a in arquivos:
        if REFAZER and lib.raw_path(a).exists():
            lib.raw_path(a).unlink()
    feats = M.compilar(doc)
    # regras não aplicadas (desativada etc.) não passam pelo corte de 400 m nem pela validação no Valhalla: uma feição
    # por via do ato (MultiLineString) em vez de uma por way do OSM deixa o seed pequeno (o aviso usa cada parte).
    # Regras ativas: pedaços de até 400 m com 6 casas decimais (ver _seis_casas)
    nao_ativas = {r['id'] for r in doc['regras'] if r['status'] != 'ativa'}
    for a in arquivos:
        p = lib.raw_path(a)
        fc = json.loads(p.read_text())
        grupos, outras = {}, []
        for f in fc['features']:
            pr = f['properties']
            if pr.get('regra_id') in nao_ativas and f['geometry']['type'] == 'LineString':
                grupos.setdefault((pr['regra_id'], pr.get('inciso'), pr.get('via'), pr.get('trecho')), []).append(f)
            elif f['geometry']['type'] == 'LineString':
                outras.extend(_seis_casas(f))
            else:
                outras.append(f)
        for (rid, inc, via, trecho), fs in grupos.items():
            pr = {k: v for k, v in fs[0]['properties'].items() if k not in ('osm_way_id', 'comprimento_m', 'mao_unica', 'sentido')}
            pr.update({'osm_way_ids': sorted(f['properties'].get('osm_way_id') for f in fs if f['properties'].get('osm_way_id')),
                       'comprimento_m': sum(f['properties'].get('comprimento_m') or 0 for f in fs), 'sentido': 'ambos',
                       'aproximado': any(f['properties'].get('aproximado') for f in fs)})
            outras.append({'type': 'Feature', 'properties': pr,
                           'geometry': {'type': 'MultiLineString', 'coordinates': [f['geometry']['coordinates'] for f in fs]}})
        fc['features'] = outras
        p.write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    feats = M.compilar(doc)
    for a in arquivos:
        fc = json.loads(lib.raw_path(a).read_text())
        print(f'  {a}: {len(fc["features"])} feições; pendências: {fc.get("pendencias")}')
    from collections import Counter
    print('  ', Counter((f['props']['regra_id'], f['kind']) for f in feats))


ALVOS = {
    'campinas': [campinas_anel_rodoviario, campinas_nova_aparecida, campinas_anel_reboucas],
    'sao-vicente': [sao_vicente_arc],
    'santos': [santos_gonzaga],
    'jacarei': [jacarei_fora_rcp],
    'vias': [lambda: vias('3552205'), lambda: vias('3551009'), lambda: vias('3538709'), lambda: vias('3518701')],
}

if __name__ == '__main__':
    pedidos = [a for a in sys.argv[1:] if not a.startswith('--')] or list(ALVOS)
    for a in pedidos:
        print(f'== {a}')
        for f in ALVOS[a]:
            f()
