"""Curadoria (manual, roda uma vez) da geometria da Grande Vitória: Vitória (3205309), Vila Velha (3205200) e Serra
(3205002). Gera os GeoJSON `construir: manual` de data/raw/municipios/geo/320*_*.geojson a partir do OpenStreetMap
(limites de bairro admin_level=10, vias e áreas portuárias) — geometria DERIVADA DO OSM (ODbL 1.0). Regras, atos e
decisões: docs/layers/municipios/mun_vitoria.md.

Fonte: o mesmo extrato do Sudeste que o Valhalla usa (data/valhalla/sudeste-latest.osm.pbf), recortado no bbox da
RMGV. O Overpass estava fora do ar na curadoria (10/10/2026); o PBF dá o mesmo dado e casa com o grafo do Valhalla.

Uso (na imagem do importador, que tem pyosmium, shapely e pyproj; WORK = pasta de trabalho fora do git):
  docker run --rm -v $(pwd)/data:/data -v $(pwd)/data/valhalla/sudeste-latest.osm.pbf:/pbf/sudeste.osm.pbf:ro \
    -e WORK=/data/cache/grande_vitoria --entrypoint python truck-router-importer \
    /data/raw/municipios/curadoria/grande_vitoria.py recorte /pbf/sudeste.osm.pbf   # ~6 min, extrato de ~20 MB
  (mesmo comando) ... grande_vitoria.py extrair          # vias e áreas do extrato em JSON
  (mesmo comando) ... grande_vitoria.py geometria        # grava os GeoJSON curados e imprime as pontas dos trechos
  (mesmo comando) ... grande_vitoria.py cache-overpass   # data/cache/municipios/osm_named_<ibge>.json (import sem Overpass)
  (mesmo comando) ... grande_vitoria.py municipio        # limite de Vitória (IBGE) sem Trindade e Martim Vaz

Ids do OSM usados (relações de bairro) ficam nas propriedades de cada feição (osm_ids) para conferência.
"""
from __future__ import annotations

import json
import os
import pathlib
import sys

DATA = pathlib.Path(os.environ.get('DATA_DIR', '/data'))
WORK = pathlib.Path(os.environ.get('WORK', str(DATA / 'cache' / 'grande_vitoria')))
GEO = DATA / 'raw' / 'municipios' / 'geo'
BBOX = (-40.56, -20.56, -40.12, -19.88)          # W, S, E, N: Vitória, Vila Velha, Serra e vizinhos
OSM_LIC = 'OpenStreetMap (ODbL 1.0, © colaboradores do OpenStreetMap)'

# relações de limite do OSM (admin_level 8 = município, 9 = região, 10 = bairro)
MUN = {'3205309': 1825817, '3205200': 1825815, '3205002': 1826737}
VIX = {'Centro': 1844864, 'Parque Moscoso': 1844865, 'Vila Rubim': 1844869, 'Piedade': 1844867, 'Fonte Grande': 1844868,
       'Santa Clara': 1844871, 'Bairro do Moscoso': 1844866, 'Forte São João': 1844893}
RA_I, ILHA_PRINCIPE = 1847651, 1844870          # Região Administrativa I - Centro (admin_level 9) e bairro Ilha do Príncipe
VV = {'Centro de Vila Velha': 1864820, 'Glória': 1864832, 'Praia da Costa': 1864985, 'Itapuã': 1864838,
      'Praia de Itaparica': 1865009}
SERRA_SEDE = 'Região de Serra Sede'               # admin_level 9 (Serra)
NOVO_HORIZONTE = 'Novo Horizonte'                 # bairro da Serra (admin_level 10)


# ----------------------------------------------------------------------------- 1. recorte do PBF
def recorte(pbf: str):
    """Nós no bbox, vias que tocam nesses nós e relações de limite/multipolígono com membros recortados, com as
    referências completas (BackReferenceWriter). Não precisa de índice de posições (cabe em pouca memória)."""
    import osmium
    W, S, E, N = BBOX
    WORK.mkdir(parents=True, exist_ok=True)
    nodes, ways = osmium.index.IdSet(), osmium.index.IdSet()
    with osmium.BackReferenceWriter(str(WORK / 'rmgv.osm.pbf'), ref_src=pbf, overwrite=True) as w:
        for o in osmium.FileProcessor(pbf):
            if o.is_node():
                if o.location.valid() and W <= o.location.lon <= E and S <= o.location.lat <= N:
                    nodes.set(o.id); w.add(o)
            elif o.is_way():
                if any(r.ref in nodes for r in o.nodes):
                    ways.set(o.id); w.add(o)
            elif o.is_relation():
                t = o.tags
                if (t.get('boundary') == 'administrative' or t.get('type') == 'multipolygon') and \
                        any(m.type == 'w' and m.ref in ways for m in o.members):
                    w.add(o)


# ----------------------------------------------------------------------------- 2. extração (vias e áreas)
def extrair():
    import osmium
    W, S, E, N = BBOX
    gj = osmium.geom.GeoJSONFactory()
    ways, areas = [], []
    fp = osmium.FileProcessor(str(WORK / 'rmgv.osm.pbf')).with_locations().with_areas(
        osmium.filter.KeyFilter('boundary', 'landuse', 'industrial'))
    for o in fp:
        if o.is_way() and 'highway' in o.tags:
            pts = [(n.lon, n.lat) for n in o.nodes]
            if any(W <= x <= E and S <= y <= N for x, y in pts):
                ways.append({'type': 'way', 'id': o.id, 'tags': dict(o.tags),
                             'geometry': [{'lat': round(y, 7), 'lon': round(x, 7)} for x, y in pts]})
        elif o.is_area():
            t = dict(o.tags)
            if not ((t.get('boundary') == 'administrative' and t.get('admin_level') in ('8', '9', '10'))
                    or t.get('industrial') == 'port'):
                continue
            try:
                g = json.loads(gj.create_multipolygon(o))
            except Exception:
                continue
            areas.append({'type': 'Feature', 'geometry': g,
                          'properties': {**t, '_osm': ('w' if o.from_way() else 'r') + str(o.orig_id())}})
    (WORK / 'rmgv_ways.json').write_text(json.dumps({'elements': ways}))
    (WORK / 'rmgv_areas.geojson').write_text(json.dumps({'type': 'FeatureCollection', 'features': areas}))
    print(f'{len(ways)} vias, {len(areas)} áreas')


# ----------------------------------------------------------------------------- utilidades de geometria
def _carregar():
    from shapely.geometry import LineString, shape
    ws = json.loads((WORK / 'rmgv_ways.json').read_text())['elements']
    for e in ws:
        e['_L'] = LineString([(n['lon'], n['lat']) for n in e['geometry']])
    ar = json.loads((WORK / 'rmgv_areas.geojson').read_text())['features']
    for f in ar:
        f['_g'] = shape(f['geometry'])
    return ws, ar


def _proj():
    from pyproj import Transformer
    from shapely.ops import transform
    T = Transformer.from_crs(4326, 31984, always_xy=True)      # SIRGAS 2000 / UTM 24S (a RMGV fica no fuso 24)
    Ti = Transformer.from_crs(31984, 4326, always_xy=True)
    return (lambda g: transform(T.transform, g)), (lambda g: transform(Ti.transform, g))


UTM, LL = None, None


def buf_m(g, m):
    """buffer em metros (UTM 24S)"""
    return LL(UTM(g).buffer(m))


def rel(ar, rid: int):
    for f in ar:
        if f['properties']['_osm'] == f'r{rid}':
            return f['_g']
    raise KeyError(f'relação {rid} ausente no extrato')


def area_nome(ar, nome: str, nivel: str, municipio=None):
    """área de limite pelo nome e nível; com `municipio`, só a que fica (90%+) dentro dele"""
    fs = [f for f in ar if f['properties'].get('name') == nome and f['properties'].get('admin_level') == nivel
          and (municipio is None or f['_g'].intersection(municipio).area > 0.9 * f['_g'].area)]
    if len(fs) != 1:
        raise KeyError(f'{nome} (admin_level {nivel}): {len(fs)} áreas')
    return fs[0]['_g'], fs[0]['properties']['_osm']


def vias(ws, nomes, dentro=None, ids=None):
    """vias (LineString) com o nome (exato) dado, opcionalmente dentro de um polígono ou só os ids dados"""
    out = []
    for e in ws:
        if ids is not None and e['id'] not in ids:
            continue
        if ids is None and e['tags'].get('name') not in nomes:
            continue
        if dentro is not None and not e['_L'].intersects(dentro):
            continue
        out.append(e)
    return out


def limpo(g, tol=0.00003):
    """simplifica (~3 m), corrige e arredonda; nunca devolve furos (a camada usa só o anel externo de cada polígono)"""
    from shapely.geometry import MultiPolygon, Polygon, mapping
    g = g.buffer(0).simplify(tol, preserve_topology=True)
    polys = [p for p in getattr(g, 'geoms', [g]) if p.geom_type == 'Polygon' and UTM(p).area > 400]
    for p in polys:
        if list(p.interiors):
            raise ValueError('polígono com furo: a camada descartaria o furo (ver ringsOf no .layer.ts)')
    g = polys[0] if len(polys) == 1 else MultiPolygon(polys)

    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 6), round(c[1], 6)]
    m = mapping(g)
    return {'type': m['type'], 'coordinates': r(m['coordinates'])}


def salvar(nome: str, feats: list[dict], notas: str):
    fc = {'type': 'FeatureCollection', 'fonte_geometria': OSM_LIC, 'como_gerar': notas,
          'gerado_por': 'data/raw/municipios/curadoria/grande_vitoria.py', 'features': feats}
    GEO.mkdir(parents=True, exist_ok=True)
    (GEO / nome).write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'  {nome}: {len(feats)} feição(ões)')


def mao_unica(tags) -> bool:
    return tags.get('oneway') in ('yes', '1', 'true', '-1') or tags.get('junction') in ('roundabout', 'circular')


def coords_ll(e, geom_ll):
    """coordenadas arredondadas no sentido de circulação (oneway=-1 invertido)"""
    c = [[round(x, 7), round(y, 7)] for x, y in geom_ll.coords]
    return c[::-1] if e['tags'].get('oneway') == '-1' else c


def corte_lado(linha_pts, fechar):
    """polígono do lado de uma linha: a linha + os pontos de `fechar` (sentido horário ou anti-horário, sem cruzar)"""
    from shapely.geometry import Polygon
    return Polygon(list(linha_pts) + list(fechar)).buffer(0)


def cadeia(ws, ids_ordem):
    """pontos de uma sequência de vias (cada id com '-' = percorrida ao contrário), sem repetir o nó de ligação"""
    by = {e['id']: e for e in ws}
    pts = []
    for k in ids_ordem:
        e = by[abs(k)]
        c = list(e['_L'].coords)
        c = c[::-1] if k < 0 else c
        if pts and pts[-1] == c[0]:
            c = c[1:]
        pts += c
    return pts


# ----------------------------------------------------------------------------- 3. geometria curada
def geometria():
    global UTM, LL
    UTM, LL = _proj()
    from shapely.geometry import LineString, MultiLineString, Point, Polygon, box, mapping
    from shapely.ops import unary_union
    ws, ar = _carregar()
    vix = rel(ar, MUN['3205309']); vv = rel(ar, MUN['3205200']); serra = rel(ar, MUN['3205002'])

    # ---------------- Vitória: Centro (Dec. 16.243/2015, art. 1º, III e §3º)
    # §3º: "espaço urbano compreendido entre as Ruas Sebastião Tourinho e Raimundo Nonato, no Forte São João até a
    # Ponte Moacyr Avidos (Ponte Seca), na Vila Rubim". Bairros da Região Administrativa I (OSM), a Vila Rubim só a leste
    # da Ponte Seca e o Forte São João só a oeste da linha R. Raimundo Nonato / R. Sebastião Tourinho.
    ponte_seca_x = -40.34800                       # way 51846906 (Ponte Seca, alt_name Av. Nair Azevedo Silva)
    oeste_ok = box(ponte_seca_x, -20.40, -40.20, -20.25)
    # linha leste: Beira-Mar (início da R. Raimundo Nonato) → R. Raimundo Nonato → R. Sebastião Tourinho → morro
    leste = [(-40.3231, -20.3350), (-40.32311, -20.31875), (-40.32454, -20.31783), (-40.32506, -20.31838),
             (-40.32605, -20.31850), (-40.3262, -20.3050)]
    lado_oeste = corte_lado(leste, [(-40.40, -20.3050), (-40.40, -20.3350)])
    partes = [rel(ar, VIX[b]) for b in ('Centro', 'Parque Moscoso', 'Piedade', 'Fonte Grande', 'Santa Clara', 'Bairro do Moscoso')]
    partes.append(rel(ar, VIX['Vila Rubim']).intersection(oeste_ok))
    partes.append(rel(ar, VIX['Forte São João']).intersection(lado_oeste))
    centro = unary_union(partes)
    salvar('3205309_centro.geojson', [{'type': 'Feature', 'geometry': limpo(centro), 'properties': {
        'area': 'Centro de Vitória (Dec. 16.243/2015, art. 1º, §3º)',
        'osm_ids': [f'r{VIX[b]}' for b in VIX], 'aproximado_por': 'bairros da Região Administrativa I do OSM'}}],
        'união dos bairros Centro, Parque Moscoso, Piedade, Fonte Grande, Santa Clara e Bairro do Moscoso; Vila Rubim a '
        'leste da Ponte Seca; Forte São João a oeste da R. Raimundo Nonato/R. Sebastião Tourinho')

    # ---------------- Vitória: perímetro da Lei 6.490/2005 (carga e descarga), "delimitado pelo Bairro Forte São João e
    # do Bairro Ilha do Príncipe": Região Administrativa I (Centro, inclui o Forte São João) + Ilha do Príncipe
    cd = unary_union([rel(ar, RA_I), rel(ar, ILHA_PRINCIPE)])
    salvar('3205309_centro_lei_6490.geojson', [{'type': 'Feature', 'geometry': limpo(cd), 'properties': {
        'area': 'Centro de Vitória, do Forte São João à Ilha do Príncipe (Lei 6.490/2005, art. 1º)',
        'osm_ids': [f'r{RA_I}', f'r{ILHA_PRINCIPE}']}}],
        'Região Administrativa I - Centro (OSM) + bairro Ilha do Príncipe (OSM)')

    # ---------------- Vitória: setor do art. 1º, I ("sistema viário à direita do sentido de circulação" de 5 vias)
    # As 5 vias formam uma cadeia de mão única: R. Henrique Novaes (para oeste) → Av. Jerônimo Monteiro (para oeste) →
    # [Av. Florentino Avidos, 1 quadra] → R. General Osório (para norte) → R. Thiers Velloso (para norte/noroeste) →
    # R. José de Anchieta (OSM; "Padre José de Anchieta" no ato, para oeste). À direita = norte/leste: a Cidade Alta.
    ch = cadeia(ws, [-490249829, -48495257, -60419831, -60419847, -558086283, -48495775, -490373613,
                     -485447650, -487090323, -490249831, -541664908, -541797461, -327163156, -541795809,
                     -490249832, -541795807, -302261327, -487090324, -60319922, -487090325, -60319917])
    linha = [(-40.3450, -20.3180)] + ch + [(-40.3265, -20.3196)]
    direita = corte_lado(linha, [(-40.3265, -20.3000), (-40.3450, -20.3000)])
    setor = rel(ar, VIX['Centro']).intersection(direita)
    salvar('3205309_setor_i.geojson', [{'type': 'Feature', 'geometry': limpo(setor), 'properties': {
        'area': 'Setor do art. 1º, I do Dec. 16.243/2015 (Cidade Alta)', 'osm_ids': [f'r{VIX["Centro"]}'],
        'aproximado_por': 'bairro Centro (OSM) ao norte/leste da cadeia Henrique Novaes – Jerônimo Monteiro – General '
                          'Osório – Thiers Velloso – José de Anchieta (sentido de circulação do OSM)'}}],
        'bairro Centro (OSM) cortado pela cadeia das 5 vias do art. 1º, I, lado direito do sentido de circulação')

    # ---------------- Vitória: Mercado da Vila Rubim (art. 2º, III e §2º)
    # "espaço compreendido entre as vias Elias Miguel e Pedro Nolasco e a Av. Marcos de Azevedo, entre a Av. Duarte
    # Lemos e a R. Pedro Nolasco": triângulo entre a Av. Elias Miguel (sul) e a R. Pedro Nolasco (noroeste), fechado na
    # Ponte Seca, mais o trecho da Av. Marcos de Azevedo entre a Av. Duarte Lemos e a R. Pedro Nolasco.
    em = cadeia(ws, [52227711, 439501573, 487090317])                 # Elias Miguel, oeste → leste
    pn = cadeia(ws, [60457866, 550677963, 996964543, 167255155])      # Pedro Nolasco, leste → noroeste
    tri = Polygon(em + pn).buffer(0)
    ma = LineString(cadeia(ws, [184098004]))                          # Marcos de Azevedo: Duarte Lemos → Pedro Nolasco
    # a Av. Alexandre Buaiz (acesso ao porto pela Ponte Seca) fica fora: o ato não fecha o lado oeste do triângulo
    ab = unary_union([e['_L'] for e in vias(ws, {'Avenida Alexandre Buaiz'}, dentro=buf_m(tri, 60))])
    mercado = unary_union([tri, buf_m(ma, 30)]).difference(buf_m(ab, 25))
    salvar('3205309_mercado_vila_rubim.geojson', [{'type': 'Feature', 'geometry': limpo(mercado), 'properties': {
        'area': 'Mercado da Vila Rubim (Dec. 16.243/2015, art. 2º, §2º)',
        'osm_ids': ['w52227711', 'w439501573', 'w487090317', 'w60457866', 'w550677963', 'w996964543', 'w167255155', 'w184098004']}}],
        'triângulo Av. Elias Miguel × R. Pedro Nolasco fechado na Ponte Seca + 30 m em torno da Av. Marcos de Azevedo '
        '(Av. Duarte Lemos → R. Pedro Nolasco), menos 25 m em torno da Av. Alexandre Buaiz')

    # ---------------- Vitória: instalações portuárias do Centro (art. 2º, §1º, red. Dec. 18.103/2020)
    # Faixa entre a orla (Av. Elias Miguel, Av. Getúlio Vargas, Av. Mal. Mascarenhas de Moraes) e o canal, da Ponte Seca
    # ao fim dos armazéns do cais (x = -40.3335); as avenidas ficam fora (12 m) e o recuo de 20 m da camada completa.
    orla = cadeia(ws, [52227711, 439501573, 487090317, 167257283, 541956985, 483970211, 997034645, 60419858,
                       543895064, 487090316, 299944902, 545447593, 541960244, 484447790, 492868923, 490393373, 541960243])
    sul = corte_lado(orla, [(-40.3330, -20.3330), (-40.3500, -20.3330)])
    porto = sul.difference(buf_m(LineString(orla), 12)).intersection(box(ponte_seca_x, -20.34, -40.3335, -20.31))
    porto = porto.intersection(unary_union([rel(ar, VIX['Centro']), rel(ar, VIX['Vila Rubim'])]))
    salvar('3205309_porto_centro.geojson', [{'type': 'Feature', 'geometry': limpo(porto), 'properties': {
        'area': 'Instalações portuárias do Centro de Vitória (Cais Comercial)', 'aproximado_por':
        'faixa ao sul das avenidas da orla, da Ponte Seca ao fim dos armazéns; inclui o espelho d\'água até o limite do bairro'}}],
        'faixa entre a orla do Centro e o canal, da Ponte Seca (x=-40.3480) a x=-40.3335, recortada nos bairros Centro e Vila Rubim')

    # ---------------- Terceira Ponte (Lei estadual 9.602/2010, art. 2º): as pistas da ponte nos dois municípios
    tp = vias(ws, {'Ponte Deputado Darcy Castello de Mendonça'})
    feats = []
    for e in tp:
        ow = mao_unica(e['tags'])
        c = coords_ll(e, e['_L'])
        feats.append({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': c}, 'properties': {
            'via': 'Terceira Ponte', 'nome_osm': e['tags'].get('name'), 'osm_way_id': e['id'], 'mao_unica': ow,
            'sentido': 'unico' if ow else 'ambos', 'inciso': 'art. 2º'}})
    salvar('3205309_terceira_ponte.geojson', feats, 'ways do OSM com name="Ponte Deputado Darcy Castello de Mendonça" (ES-060)')
    ponte = unary_union([e['_L'] for e in tp])

    # ---------------- Vila Velha (Dec. 161/2001, art. 1º): Centro, Glória e bairros de praia
    # A Terceira Ponte (ES-060, km 0–3,3, Sistema Rodovia do Sol, jurisdição estadual) fica fora das zonas municipais.
    sem_ponte = buf_m(ponte, 25)
    centro_vv = rel(ar, VV['Centro de Vila Velha']).difference(sem_ponte)
    salvar('3205200_centro.geojson', [{'type': 'Feature', 'geometry': limpo(centro_vv), 'properties': {
        'area': 'Centro de Vila Velha (Dec. 161/2001, art. 1º, I)', 'osm_ids': [f'r{VV["Centro de Vila Velha"]}'],
        'nota_geometria': 'sem a Terceira Ponte (estadual)'}}], 'bairro Centro de Vila Velha (OSM) menos 25 m em torno da Terceira Ponte')
    # Glória: exceto R. Santa Teresinha (OSM "Rua Santa Terezinha"), Estrada Jerônimo Monteiro (OSM "Avenida Jerônimo
    # Monteiro") e Rod. Carlos Lindenberg (OSM "Avenida Carlos Lindenberg"): 25 m em torno delas ficam fora da zona.
    gl = rel(ar, VV['Glória'])
    livres = vias(ws, {'Rua Santa Terezinha', 'Avenida Jerônimo Monteiro', 'Avenida Carlos Lindenberg'}, dentro=buf_m(gl, 50))
    livres = [e for e in livres if e['tags'].get('highway') not in ('cycleway', 'footway')]
    gloria = gl.difference(buf_m(unary_union([e['_L'] for e in livres]), 25))
    salvar('3205200_gloria.geojson', [{'type': 'Feature', 'geometry': limpo(gloria), 'properties': {
        'area': 'Glória (Dec. 161/2001, art. 1º, II)', 'osm_ids': [f'r{VV["Glória"]}'] + [f'w{e["id"]}' for e in livres],
        'nota_geometria': 'sem 25 m em torno da R. Santa Terezinha, Av. Jerônimo Monteiro e Av. Carlos Lindenberg (exceções do ato)'}}],
        'bairro Glória (OSM) menos 25 m em torno das 3 vias exceptuadas pelo art. 1º, II')
    praias = unary_union([rel(ar, VV[b]) for b in ('Praia da Costa', 'Itapuã', 'Praia de Itaparica')]).difference(sem_ponte)
    salvar('3205200_praias.geojson', [{'type': 'Feature', 'geometry': limpo(praias), 'properties': {
        'area': 'Praia da Costa, Itapuã e Praia de Itaparica (Dec. 161/2001, art. 1º, III)',
        'osm_ids': [f'r{VV[b]}' for b in ('Praia da Costa', 'Itapuã', 'Praia de Itaparica')],
        'nota_geometria': 'bairros atuais com esses nomes; Nova, Jockey e Coqueiral de Itaparica fora; sem a Terceira Ponte'}}],
        'união dos bairros Praia da Costa, Itapuã e Praia de Itaparica (OSM) menos 25 m em torno da Terceira Ponte')

    # orla (art. 1º, III, a): avenidas da orla nesses bairros (o ato não lista as vias)
    orla_nomes = {'Avenida Antônio Gil Veloso', 'Avenida Estudante José Júlio de Souza'}
    zona_orla = buf_m(unary_union([rel(ar, VV[b]) for b in ('Praia da Costa', 'Itapuã', 'Praia de Itaparica')]), 10)
    feats = []
    for e in vias(ws, orla_nomes, dentro=zona_orla):
        if e['tags'].get('highway') not in ('secondary', 'tertiary', 'primary', 'residential'):
            continue
        g = UTM(e['_L']).intersection(UTM(zona_orla))
        for part in [p for p in getattr(g, 'geoms', [g]) if p.geom_type == 'LineString' and p.length >= 10]:
            ow = mao_unica(e['tags'])
            c = coords_ll(e, LL(part))
            feats.append({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': c}, 'properties': {
                'via': e['tags']['name'], 'nome_osm': e['tags']['name'], 'osm_way_id': e['id'], 'mao_unica': ow,
                'sentido': 'unico' if ow else 'ambos', 'inciso': 'III, a', 'aproximado': True,
                'trecho': 'orla de Praia da Costa, Itapuã e Praia de Itaparica'}})
    salvar('3205200_orla.geojson', feats, 'Av. Antônio Gil Veloso e Av. Estudante José Júlio de Souza (OSM) dentro dos 3 bairros de praia')

    # porto (art. 2º, parágrafo único): áreas industrial=port do OSM em Vila Velha, na margem do canal
    portos = [f for f in ar if f['properties'].get('industrial') == 'port' and f['_g'].intersects(box(-40.36, -20.34, -40.31, -20.31))
              and f['_g'].intersection(vv).area > 0.9 * f['_g'].area]
    pu = unary_union([f['_g'] for f in portos])
    salvar('3205200_porto.geojson', [{'type': 'Feature', 'geometry': limpo(pu), 'properties': {
        'area': 'Instalações portuárias de Vila Velha (Capuaba, Paul e terminais vizinhos)',
        'osm_ids': sorted(f['properties']['_osm'] for f in portos),
        'nomes_osm': sorted({f['properties'].get('name') for f in portos if f['properties'].get('name')})}}],
        'união das áreas industrial=port do OSM em Vila Velha na margem do canal (bbox -40.36,-20.34,-40.31,-20.31)')

    # ---------------- Serra (Dec. 5.881/2020): vias inteiras dentro de uma região/bairro
    sede, sede_id = area_nome(ar, SERRA_SEDE, '9', serra)
    nh, nh_id = area_nome(ar, NOVO_HORIZONTE, '10', serra)
    art2 = {   # nome no ato → nome no OSM
        'Rua Elesbão Alexandre Miranda': 'Rua Elesbão Alexandre Miranda', 'Rua Floriano Peixoto': 'Rua Floriano Peixoto',
        'Rua Presciliano Biluia': 'Rua Presciliano Bilua', 'Rua Santos Pintos': 'Rua Santos Pinto',
        'Rua das Acácias': 'Rua das Acácias', 'Rua Major Pissarra': 'Rua Major Pissarra', 'Rua Dom Pedro II': 'Rua Dom Pedro II',
        'Rua Cassiano Castelo': 'Avenida Cassiano Castello', 'Avenida Jones dos Santos Neves': 'Avenida Jones dos Santos Neves',
        'Rua Maestro Antonio Cícero': 'Rua Maestro Antônio Cícero'}
    alineas = dict(zip(art2, 'bcdefghijk'))
    feats = []

    def recortar(e, poli, regra, props):
        g = UTM(e['_L']).intersection(UTM(poli))
        for part in [p for p in getattr(g, 'geoms', [g]) if p.geom_type == 'LineString' and p.length >= 10]:
            ow = mao_unica(e['tags'])
            c = coords_ll(e, LL(part))
            feats.append({'type': 'Feature', 'geometry': {'type': 'LineString', 'coordinates': c}, 'properties': {
                'regra_id': regra, 'nome_osm': e['tags']['name'], 'osm_way_id': e['id'], 'mao_unica': ow,
                'sentido': 'unico' if ow else 'ambos', **props}})
    # art. 1º, I, a: Av. Norte-Sul da Av. João Palácio (divisa com Vitória, lat -20.2405) à Av. Região Sudeste (Barcelona,
    # lat -20.1723); só as vias com o nome do ato (o trecho que o OSM chama de Av. Desembargador Mário da Silva Nunes /
    # Av. Lourival Nunes, entre a Av. Carapebus e a ES-010, fica de fora)
    faixa = box(-40.30, -20.2412, -40.20, -20.1723).intersection(serra)
    for e in vias(ws, {'Avenida Norte-Sul', 'Rodovia Norte-Sul'}, dentro=faixa):
        if e['tags'].get('highway') in ('service',):
            continue
        recortar(e, faixa, 'serra_pico_23t', {'via': 'Avenida Norte-Sul', 'inciso': 'art. 1º, I, a',
                                              'trecho': 'da Av. João Palácio à Av. Região Sudeste (Barcelona)'})
    # art. 1º, I, c: R. Carioca, da BR-101 à Av. Norte-Sul, no bairro N. Sra. do Rosário de Fátima
    rf, rf_id = area_nome(ar, 'Rosário de Fátima', '10', serra)
    for e in vias(ws, {'Rua Carioca'}, dentro=rf):
        recortar(e, buf_m(rf, 30), 'serra_pico_23t', {'via': 'Rua Carioca', 'inciso': 'art. 1º, I, c',
                                                      'trecho': 'da BR-101 à Av. Norte-Sul (Rosário de Fátima)'})
    for nome_ato, nome_osm in art2.items():
        es = vias(ws, {nome_osm}, dentro=sede)
        if not es:
            raise KeyError(f'{nome_osm} não está na {SERRA_SEDE}')
        for e in es:
            recortar(e, sede, 'serra_vias_24h', {'via': nome_ato, 'inciso': f'art. 2º, {alineas[nome_ato]}',
                                                 'trecho': f'{nome_ato}, na Serra Sede'})
    for nome in ('Avenida Brasil', 'Rua Papagaio', 'Rua Gaivota'):
        for e in vias(ws, {nome}, dentro=nh):
            recortar(e, buf_m(nh, 10), 'serra_novo_horizonte_24h', {'via': nome, 'inciso': 'art. 4º-A',
                                                                     'trecho': f'{nome}, no bairro Novo Horizonte'})
    salvar('3205002_vias_curadas.geojson', feats,
           f'Av. Norte-Sul (faixa de latitude entre a Av. João Palácio e a Av. Região Sudeste) e R. Carioca (bairro '
           f'Rosário de Fátima, {rf_id}); vias do art. 2º recortadas na {SERRA_SEDE} ({sede_id}) e do art. 4º-A no bairro '
           f'{NOVO_HORIZONTE} ({nh_id}); OSM')
    print('  ausentes do OSM: Rua Um (art. 2º, a) na Serra Sede; Rua M (art. 1º, I, d) entre a BR-101 e a Av. Norte-Sul')


# ----------------------------------------------------------------------------- 4. cache do Overpass a partir do extrato
def cache_overpass():
    """data/cache/municipios/osm_named_<ibge>.json no formato do Overpass ('out geom tags') com a mesma seleção da
    consulta de _municipios_lib.overpass_named_ways (vias com nome e highway da lista, que tocam o município)."""
    global UTM, LL
    UTM, LL = _proj()
    import re
    ws, ar = _carregar()
    hw = re.compile(r'^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|motorway_link|trunk_link|'
                    r'primary_link|secondary_link|tertiary_link|living_street|service|road)$')
    out = DATA / 'cache' / 'municipios'
    out.mkdir(parents=True, exist_ok=True)
    for ibge, rid in MUN.items():
        m = rel(ar, rid)
        els = [{'type': 'way', 'id': e['id'], 'tags': e['tags'], 'geometry': e['geometry']} for e in ws
               if e['tags'].get('name') and hw.match(e['tags'].get('highway', '')) and e['_L'].intersects(m)]
        (out / f'osm_named_{ibge}.json').write_text(json.dumps({'elements': els}))
        print(f'  osm_named_{ibge}.json: {len(els)} vias')


# ----------------------------------------------------------------------------- 5. limite de Vitória (zonas do município)
VIX_RECORTE = (-40.6, -20.6, -40.1, -20.1)        # W, S, E, N: ilha de Vitória, parte continental e ilhas da baía
IBGE_MALHA = ('https://servicodados.ibge.gov.br/api/v3/malhas/municipios/{ibge}'
              '?formato=application/vnd.geo%2Bjson&qualidade=maxima')   # a mesma do importador (_municipios_lib)


def municipio():
    """geo/3205309_municipio.geojson: limite de Vitória da Malha Municipal do IBGE recortado no bbox da Grande Vitória.
    A malha do IBGE inclui as ilhas oceânicas de Trindade e Martim Vaz (lon -29,3 a -28,8; 4 das 5 partes): sem o
    recorte, toda rota da Grande Vitória com a zona ativa mandava esses anéis ao Valhalla e o mapa desenhava a zona
    sobre Trindade. Usa o cache do importador (data/cache/municipios/ibge_malha_3205309.geojson) ou baixa da API v3;
    simplificação e casas iguais às da união de municípios usada antes (0,0002 grau, 5 casas)."""
    import urllib.request
    from shapely.geometry import box, mapping, shape
    cache = DATA / 'cache' / 'municipios' / 'ibge_malha_3205309.geojson'
    if cache.exists():
        d = json.loads(cache.read_text())
    else:
        with urllib.request.urlopen(IBGE_MALHA.format(ibge='3205309'), timeout=60) as r:
            d = json.loads(r.read())
    g = shape(d['features'][0]['geometry'])
    partes = list(getattr(g, 'geoms', [g]))
    dentro = [p for p in partes if p.intersects(box(*VIX_RECORTE))]
    fora = [p for p in partes if not p.intersects(box(*VIX_RECORTE))]
    if not dentro or any(not box(*VIX_RECORTE).contains(p) for p in dentro):
        raise ValueError('o bbox de recorte cortaria a parte continental de Vitória: revise VIX_RECORTE')
    u = g.intersection(box(*VIX_RECORTE)).simplify(0.0002)

    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
    m = mapping(u)
    fc = {'type': 'FeatureCollection',
          'fonte_geometria': 'IBGE, Malha Municipal (API v3, qualidade máxima): dados públicos, citar a fonte',
          'como_gerar': f'limite do IBGE (3205309) recortado no bbox {VIX_RECORTE}: ficam a ilha de Vitória, a parte '
                        f'continental e as ilhas da baía; saem Trindade e Martim Vaz ({len(fora)} partes). '
                        'Simplificado 0,0002 grau, 5 casas.',
          'gerado_por': 'data/raw/municipios/curadoria/grande_vitoria.py municipio',
          'features': [{'type': 'Feature', 'geometry': {'type': m['type'], 'coordinates': r(m['coordinates'])}, 'properties': {
              'area': 'Município de Vitória (limite do IBGE, sem as ilhas oceânicas)', 'ibge': '3205309',
              'partes_removidas': [[round(v, 4) for v in p.bounds] for p in fora]}}]}
    GEO.mkdir(parents=True, exist_ok=True)
    (GEO / '3205309_municipio.geojson').write_text(json.dumps(fc, ensure_ascii=False, separators=(',', ':')))
    print(f'  3205309_municipio.geojson: {len(dentro)} parte(s); {len(fora)} parte(s) fora do recorte')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'recorte':
        recorte(sys.argv[2])
    elif cmd == 'extrair':
        extrair()
    elif cmd == 'geometria':
        geometria()
    elif cmd == 'cache-overpass':
        cache_overpass()
    elif cmd == 'municipio':
        municipio()
    else:
        print(__doc__)
        sys.exit(2)
