"""Funções comuns para recortar de uma zona municipal a travessia de uma rodovia (que o ato municipal não alcança) e
para simplificar a zona. Usada pelos scripts de curadoria de Mangaratiba, Pirapetinga, Piranga e Garça e por
simplificar_zona.py. Licença dos dados: vias do OpenStreetMap (ODbL 1.0, © colaboradores do OSM); setores do IBGE.

Critério (o mesmo de Arcos e Santa Branca): saem da zona, com folga de cada lado,
  * as vias com `ref` de rodovia (BR-, SP-, MG-, RJ-...) nas classes motorway/trunk/primary/secondary (e *_link);
  * as ruas por onde a rodovia passa, mesmo sem `ref` no OSM: toda via trunk/primary (e *_link) sem `ref`, os nomes
    exatos listados em `nomes` e os ids de way listados em `ids`;
  * as ligações (*_link e rotatórias) que compartilham nó com uma via livre.
A API só usa o anel EXTERNO de cada polígono (exclude_polygons do Valhalla) e recua 15 m para dentro: por isso o
resultado não tem furos (um corredor cercado pela zona vira uma fenda ligada ao exterior) e `verificar` confere que
nenhuma via livre fica a menos de `folga - tolerância` m do anel externo.

Requer shapely e pyproj.
"""
import json
import re

from pyproj import Transformer
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, shape
from shapely.ops import nearest_points, transform, unary_union

CLASSES_REF = {'motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'}
CLASSES_SEM_REF = {'motorway', 'trunk', 'primary', 'motorway_link', 'trunk_link', 'primary_link'}
LINHA_SIMPL_M = 4     # as vias livres são simplificadas a 4 m antes do buffer (menos vértices no contorno)
LIGACOES = {'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'}
REF_RODOVIA = re.compile(r'^(BR|SP|MG|RJ|ES|LMG|AMG|CMG|MGC|SPA|SPI|SPM)-?\s?\d')


def projecoes(epsg: int):
    t = Transformer.from_crs(4326, epsg, always_xy=True).transform
    ti = Transformer.from_crs(epsg, 4326, always_xy=True).transform
    return (lambda g: transform(t, g)), (lambda g: transform(ti, g))


def refs_de(tags: dict) -> list[str]:
    return [x.strip() for x in re.split(r'[;/]', tags.get('ref') or '') if x.strip()]


def vias_livres(osm: str, to_utm, refs: list[str] | None = None, nomes: list[str] = (), ids: list[int] = (),
                sem_ref=CLASSES_SEM_REF, ligacoes: bool = True, raio_m: float | None = None, centro=None,
                classes_ref=CLASSES_REF, admin=None):
    """Vias livres (LineString em UTM) do JSON no formato Overpass (`out geom tags`) com TODAS as vias highway
    (data/raw/municipios/curadoria/osm_pbf_vias.py). refs=None: qualquer ref de rodovia (REF_RODOVIA); lista = só essas.
    classes_ref = classes das vias com ref de rodovia (None = qualquer); admin = valores de IBGE:CD_ADMINIS que também ficam livres (ex.: {'federal', 'estadual'});
    sem_ref = classes das vias SEM ref que também ficam livres (padrão trunk/primary e *_link). Retorna [(id, tags, linha)]."""
    els = json.loads(open(osm).read())['elements']
    vias = []
    for e in els:
        g = e.get('geometry') or []
        if len(g) < 2 or 'highway' not in e.get('tags', {}):
            continue
        vias.append((e['id'], e['tags'], to_utm(LineString([(q['lon'], q['lat']) for q in g]))))
    livres = {}
    for i, t, ls in vias:
        hw = t['highway']
        rs = refs_de(t)
        if admin and t.get('IBGE:CD_ADMINIS') in admin:
            livres[i] = (t, ls)
        elif rs and (classes_ref is None or hw in classes_ref) and any((r in refs) if refs is not None else REF_RODOVIA.match(r) for r in rs):
            livres[i] = (t, ls)
        elif sem_ref and not rs and hw in sem_ref:
            livres[i] = (t, ls)
        elif t.get('name') in nomes and hw in CLASSES_REF or i in ids:
            livres[i] = (t, ls)
    if ligacoes:
        nos = lambda ls: {(round(x, 0), round(y, 0)) for x, y in ls.coords}
        mudou = True
        while mudou:
            mudou = False
            todos = set().union(*(nos(ls) for _, ls in livres.values())) if livres else set()
            for i, t, ls in vias:
                if i in livres:
                    continue
                if (t['highway'] in LIGACOES or t.get('junction') in ('roundabout', 'circular')) and nos(ls) & todos:
                    livres[i] = (t, ls)
                    mudou = True
    out = [(i, t, ls) for i, (t, ls) in livres.items()]
    if raio_m is not None and centro is not None:
        c = Point(centro)
        out = [x for x in out if x[2].distance(c) < raio_m]
    return out


def sem_furos(Z):
    ps = [Polygon(g.exterior) for g in getattr(Z, 'geoms', [Z]) if g.geom_type == 'Polygon']
    return unary_union(ps)


def abrir_fendas(Z, corredor, largura_m: float = 3.0):
    """Cada furo de Z que toca o corredor recortado (ou seja, nasceu do recorte) é ligado ao anel externo por uma fenda
    de `largura_m`: a API ignora furos, e sem a fenda a rodovia continuaria dentro da zona. Furos que não tocam o
    corredor são preenchidos."""
    out = []
    for p in getattr(Z, 'geoms', [Z]):
        if p.geom_type != 'Polygon':
            continue
        q = Polygon(p.exterior)
        for h in p.interiors:
            hp = Polygon(h)
            if hp.intersects(corredor):
                a, b = nearest_points(hp.exterior, p.exterior)
                dx, dy = b.x - a.x, b.y - a.y
                n = (dx * dx + dy * dy) ** 0.5 or 1.0
                b2 = (b.x + 10 * dx / n, b.y + 10 * dy / n)      # a fenda passa 10 m além do anel externo (senão sobra uma parede fina)
                a2 = (a.x - 10 * dx / n, a.y - 10 * dy / n)      # e começa 10 m dentro do furo (senão só encosta nele)
                q = q.difference(LineString([a2, b2]).buffer(largura_m / 2, cap_style=2).union(hp))
        out.append(q)
    return unary_union(out)


def simplificar_para_dentro(G, tol_m: float):
    """Simplificação (Douglas-Peucker, preservando a topologia) que NUNCA faz a zona crescer: encolhe `tol_m` e simplifica
    com a mesma tolerância, então o resultado fica dentro de G (o contorno recua entre 0 e 2*tol_m). Simplificar sem encolher
    deixa o contorno andar para os dois lados e a zona invade as vias do lado de fora do perímetro."""
    return G.buffer(-tol_m, quad_segs=2).simplify(tol_m, preserve_topology=True)


def recortar(Z, livres, folga_m: float, min_area_m2: float = 20000, simplificar_depois_m: float = 0, linha_simpl_m: float = LINHA_SIMPL_M):
    """Z (UTM, sem furos) menos as vias livres com `folga_m` de cada lado; sem furos; sem partes < min_area_m2.
    `simplificar_depois_m` > 0 simplifica o resultado PARA DENTRO (simplificar_para_dentro): o resultado fica dentro do recorte,
    então a folga às vias livres não diminui (>= folga_m - linha_simpl_m, as vias entram simplificadas no buffer) e o contorno
    de fora do perímetro não cresce. O recuo é de até 2 * simplificar_depois_m."""
    corredor = unary_union([ls.simplify(linha_simpl_m) for _, _, ls in livres]).buffer(folga_m, quad_segs=4) if livres else Polygon()
    R = abrir_fendas(Z.difference(corredor), corredor)
    partes = [Polygon(g.exterior) for g in getattr(R, 'geoms', [R]) if g.geom_type == 'Polygon' and g.area > min_area_m2]
    R = unary_union(partes)
    if simplificar_depois_m:
        S = simplificar_para_dentro(R, simplificar_depois_m)
        S = abrir_fendas(S, corredor)
        R = unary_union([Polygon(g.exterior) for g in getattr(S, 'geoms', [S]) if g.geom_type == 'Polygon' and g.area > min_area_m2])
    return R, corredor


def verificar(Z, livres, folga_m: float, tolerancia_m: float = LINHA_SIMPL_M + 1):
    """Menor distância (m) do anel externo de cada parte às vias livres; levanta erro se < folga - tolerância."""
    exts = unary_union([Polygon(g.exterior) for g in getattr(Z, 'geoms', [Z])])
    dmin = min((ls.distance(exts) for _, _, ls in livres if ls.distance(exts) < 1e9), default=1e9)
    inter = [i for i, _, ls in livres if ls.intersects(exts)]
    if dmin < folga_m - tolerancia_m:
        raise SystemExit(f'ERRO: via livre a {dmin:.1f} m da zona (folga {folga_m} m); ids que cortam a zona: {inter[:10]}')
    return dmin


def contar_vertices(Z) -> int:
    return sum(len(g.exterior.coords) + sum(len(i.coords) for i in g.interiors) for g in getattr(Z, 'geoms', [Z]))


def para_geojson_coords(Z_ll, nd: int = 6):
    rnd = lambda c: [[round(x, nd), round(y, nd)] for x, y in c]
    polys = [Z_ll] if Z_ll.geom_type == 'Polygon' else list(Z_ll.geoms)
    return {'type': 'MultiPolygon', 'coordinates': [[rnd(pp.exterior.coords)] for pp in polys]}


def recortar_dois_niveis(Z, livres, nucleo, fino: dict, grosso: dict):
    """Zona com muitas rodovias (município inteiro, p. ex. Campos dos Goytacazes) em duas resoluções: DENTRO de `nucleo`
    (polígono UTM, p. ex. a cidade) o recorte é fino e fora dele é grosso (simplificação e folga maiores). Cada nível é um
    dict com os argumentos de `recortar` (folga_m, min_area_m2, simplificar_depois_m, linha_simpl_m) e `antes_m` (simplificação
    para dentro da zona ANTES do recorte). Folga mínima garantida a cada via: folga - linha_simpl."""
    out = []
    for nivel, parte in ((fino, Z.intersection(nucleo)), (grosso, Z)):
        antes = nivel['antes_m']
        P = simplificar_para_dentro(parte, antes) if antes else parte
        vs = [x for x in livres if x[2].distance(P) < 400]
        R, _ = recortar(P, vs, nivel['folga_m'], min_area_m2=nivel['min_area_m2'],
                        simplificar_depois_m=nivel['simplificar_depois_m'], linha_simpl_m=nivel['linha_simpl_m'])
        out.append(R)
    R_fino, R_grosso = out
    R = unary_union([R_grosso.difference(nucleo), R_fino])
    # sobras do encaixe (furos, lascas): só anel externo, com fenda nos furos que encostam nas rodovias
    larga = unary_union([ls.simplify(30) for _, _, ls in livres if ls.distance(Z) < 400]).buffer(1500, quad_segs=2)
    R = abrir_fendas(R, larga)
    return unary_union([Polygon(g.exterior) for g in getattr(R, 'geoms', [R]) if g.geom_type == 'Polygon' and g.area > 20000])


def vias_por_funcao(osm: str, to_utm, livre):
    """[(id, tags, linha UTM)] das vias highway do JSON (formato Overpass) para as quais `livre(tags)` é verdadeiro."""
    out = []
    for e in json.loads(open(osm).read())['elements']:
        g = e.get('geometry') or []
        if len(g) >= 2 and 'highway' in e.get('tags', {}) and livre(e['tags']):
            out.append((e['id'], e['tags'], to_utm(LineString([(q['lon'], q['lat']) for q in g]))))
    return out
