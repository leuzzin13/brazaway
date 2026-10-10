"""Funções comuns aos importadores da frente ders_estaduais (DER-MG, DER-ES, DER-RJ). Não é uma fonte (o runner
ignora módulos com `_`).

- `rodovia_mg` / `rodovia_de_sre_mg`: código da rodovia de MG no formato do OSM ('MG-010', 'LMG-828', 'MGC-262').
- `snap_bloqueio`: leva um ponto da fonte para a pista da rodovia no grafo do Valhalla (/locate) e escolhe o raio do
  círculo de bloqueio sem encostar em outra via.
- `sre_es`: segmentos do SRE do DER-ES (WFS do GEOBASES) e recorte por km.
"""
from __future__ import annotations

import json
import math
import re
import urllib.parse

from common import http_get
from sources._oae_locate import dist_m, locate, nome_tem_ref

# ------------------------------------------------------------------------------------------------ licenças e URLs

OBSERVATORIO_MG = 'https://observatorio.infraestrutura.mg.gov.br/server/rest/services'
LICENCA_OBSERVATORIO_MG = (
    'Não declarada: o item do Observatório da Infraestrutura (SEINFRA-MG/DER-MG) tem licenseInfo vazio. O site do DER-MG '
    '("Aspectos legais") permite reutilizar conteúdo "desde que identificada a fonte e atribuído o crédito". RISCO: uso '
    'comercial sem autorização expressa (pedir termo ao DER-MG/SEINFRA ou via LAI; ver docs/layers/rodovias_estaduais.md)'
)
GEOBASES_WFS = 'https://ide.geobases.es.gov.br/geoserver/ows'
LICENCA_SRE_ES = ('Não declarada (GeoNode do GEOBASES: "Not Specified"); malha do SRE do DER-ES usada só para '
                  'localizar os trechos dos atos. Atribuição: DER-ES/GEOBASES')

# ------------------------------------------------------------------------------------------------ rodovias de MG

_PREFIXO_SRE_MG = {'EMG': 'MG', 'AMG': 'AMG', 'LMG': 'LMG', 'CMG': 'MGC', 'BMG': 'BR'}


def rodovia_de_sre_mg(sre: str | None) -> str | None:
    """'010EMG0040D' -> 'MG-010'; '262CMG0010' -> 'MGC-262'; '828LMG0010' -> 'LMG-828'."""
    m = re.match(r'^(\d{3})([A-Z]{3})', (sre or '').strip().upper())
    if not m:
        return None
    num, pre = m.groups()
    p = _PREFIXO_SRE_MG.get(pre)
    return f'{p}-{num}' if p else None


def rodovia_mg(cod: str | None) -> str | None:
    """'MG457 ' -> 'MG-457'; 'CMG262' -> 'MGC-262'; 'AMG-900' -> 'AMG-900'; 'BR459' -> 'BR-459'."""
    c = re.sub(r'[\s\-]+', '', (cod or '').upper())
    m = re.match(r'^([A-Z]+)(\d+)$', c)
    if not m:
        return (cod or '').strip() or None
    pre, num = m.groups()
    pre = 'MGC' if pre == 'CMG' else pre
    return f'{pre}-{num}'


def refs_osm(rodovia: str | None) -> list[str]:
    """Nomes de ref que a rodovia pode ter no OSM: a MGC-xxx (estadual coincidente) costuma estar como BR-xxx."""
    if not rodovia:
        return []
    out = [rodovia]
    m = re.match(r'^MGC-(\d+)$', rodovia)
    if m:
        out.append(f'BR-{m.group(1)}')
    return out


# ------------------------------------------------------------------------------------------------ ponto de bloqueio

RAIO_PADRAO_M = 20       # círculo de exclusão sobre a pista no ponto (decisão de produto; ver docs)
RAIO_MIN_M = 8
FOLGA_OUTRA_VIA_M = 5    # o círculo fica a pelo menos isto de uma via que não é a rodovia do ponto
BUSCA_RODOVIA_M = 80     # procura a pista da rodovia (pelo nome/ref) até esta distância do ponto da fonte
BUSCA_QUALQUER_M = 30    # sem a rodovia pelo nome, aceita a via mais próxima até esta distância


def _tem_ref(e: dict, refs: list[str]) -> bool:
    return any(nome_tem_ref(n, r) for n in e['names'] for r in refs)


def snap_bloqueio(pontos: list[tuple[float, float]], rodovias: list[str | None], raio_padrao: float = RAIO_PADRAO_M) -> list[dict | None]:
    """Para cada ponto (lon, lat), o bloqueio {pontos, raio_m, ajuste, distancia_m, way_ids} na pista da rodovia.

    ajuste: 'rodovia' (aresta com o código da rodovia no nome a até BUSCA_RODOVIA_M), 'via_mais_proxima' (sem o nome,
    via mais próxima a até BUSCA_QUALQUER_M), 'ponto_original' (nada perto: fica o ponto da fonte) ou 'sem_valhalla'.
    Os pontos de bloqueio são um por pista (arestas distintas a mais de 15 m uma da outra). O raio encolhe se outra via
    (sem o nome da rodovia, que não é alça) passar a menos de raio + FOLGA_OUTRA_VIA_M; nunca fica abaixo de RAIO_MIN_M.
    """
    res = locate(pontos, BUSCA_RODOVIA_M)
    out: list[dict | None] = []
    for i, p in enumerate(pontos):
        refs = refs_osm(rodovias[i])
        if res is None:
            out.append({'pontos': [[round(p[0], 6), round(p[1], 6)]], 'raio_m': raio_padrao, 'ajuste': 'sem_valhalla', 'distancia_m': None})
            continue
        edges = res[i]
        da_rodovia = [e for e in edges if refs and _tem_ref(e, refs) and not e['link']]
        ajuste = 'rodovia'
        escolhidas = da_rodovia
        if not escolhidas:
            perto = [e for e in edges if e['dist'] <= BUSCA_QUALQUER_M and not e['link']]
            escolhidas = perto[:1]
            ajuste = 'via_mais_proxima'
        if not escolhidas:
            out.append({'pontos': [[round(p[0], 6), round(p[1], 6)]], 'raio_m': raio_padrao, 'ajuste': 'ponto_original', 'distancia_m': None})
            continue
        # um ponto por pista: arestas a mais de 15 m umas das outras (as duas direções da mesma via coincidem)
        pts: list[tuple[float, float]] = []
        dists: list[float] = []
        ways: list[int] = []
        nomes: set[str] = set()
        for e in escolhidas:
            q = (e['lon'], e['lat'])
            if any(dist_m(q, x) < 15 for x in pts):
                continue
            if pts and e['dist'] > escolhidas[0]['dist'] + 40:   # pista paralela longe do ponto: não é a mesma OAE/obra
                continue
            pts.append(q)
            dists.append(round(e['dist'], 1))
            if e.get('way_id'):
                ways.append(e['way_id'])
            nomes.update(e['names'])
        # raio: não encostar em outra via (que não tem o nome da rodovia nem é alça dela)
        raio = raio_padrao
        outras = [e for e in edges if not e['link'] and not (set(e['names']) & nomes) and not (refs and _tem_ref(e, refs))]
        for q in pts:
            for e in outras:
                d = dist_m(q, (e['lon'], e['lat']))
                if d < raio + FOLGA_OUTRA_VIA_M:
                    raio = max(RAIO_MIN_M, round(d - FOLGA_OUTRA_VIA_M, 1))
        out.append({'pontos': [[round(x, 6), round(y, 6)] for x, y in pts], 'raio_m': raio, 'ajuste': ajuste,
                    'distancia_m': dists, 'way_ids': ways[:6]})
    return out


# ------------------------------------------------------------------------------------------------ SRE do DER-ES

def sre_es(cql: str, cache: str) -> list[dict]:
    """Segmentos do SRE do DER-ES (GEOBASES WFS geonode:der_rodovias_es_epsg_31984) que atendem o filtro CQL."""
    q = urllib.parse.urlencode({
        'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature', 'typeNames': 'geonode:der_rodovias_es_epsg_31984',
        'outputFormat': 'application/json', 'srsName': 'EPSG:4326', 'CQL_FILTER': cql,
    })
    d = json.loads(http_get(f'{GEOBASES_WFS}?{q}', cache=cache, max_age_h=24 * 30))
    return d.get('features') or []


def _linhas(g: dict) -> list[list[list[float]]]:
    if g['type'] == 'LineString':
        return [g['coordinates']]
    if g['type'] == 'MultiLineString':
        return g['coordinates']
    return []


def _len_m(c: list[list[float]]) -> float:
    return sum(dist_m(tuple(c[i - 1][:2]), tuple(c[i][:2])) for i in range(1, len(c)))


def _costura(partes: list[list[list[float]]]) -> list[list[float]]:
    """Junta as partes de uma MultiLineString na ordem da digitalização (o SRE do DER-ES vem com uma parte por linha)."""
    if len(partes) == 1:
        return [p[:2] for p in partes[0]]
    restantes = [[q[:2] for q in p] for p in partes if len(p) >= 2]
    linha = restantes.pop(0)
    while restantes:
        fim, ini = tuple(linha[-1]), tuple(linha[0])
        melhor = min(range(len(restantes)), key=lambda k: min(dist_m(fim, tuple(restantes[k][0])), dist_m(fim, tuple(restantes[k][-1])),
                                                              dist_m(ini, tuple(restantes[k][-1])), dist_m(ini, tuple(restantes[k][0]))))
        p = restantes.pop(melhor)
        opcoes = [(dist_m(fim, tuple(p[0])), 'fim', p), (dist_m(fim, tuple(p[-1])), 'fim', p[::-1]),
                  (dist_m(ini, tuple(p[-1])), 'ini', p), (dist_m(ini, tuple(p[0])), 'ini', p[::-1])]
        _, onde, q = min(opcoes, key=lambda o: o[0])
        linha = linha + q if onde == 'fim' else q + linha
    return linha


def recorte_km(coords: list[list[float]], km_ini_seg: float, km_fim_seg: float, km_ini: float, km_fim: float) -> list[list[float]]:
    """Recorta a linha de um segmento do SRE entre km_ini e km_fim, interpolando o km ao longo da geometria (o km do SRE
    é proporcional à extensão desenhada; diferença típica < 1%)."""
    total = _len_m(coords)
    ext = km_fim_seg - km_ini_seg
    if total <= 0 or ext <= 0:
        return coords
    a = max(0.0, (km_ini - km_ini_seg) / ext) * total
    b = min(1.0, (km_fim - km_ini_seg) / ext) * total
    out: list[list[float]] = []
    acc = 0.0
    for i in range(1, len(coords)):
        p, q = coords[i - 1], coords[i]
        d = dist_m(tuple(p), tuple(q))
        if d <= 0:
            continue
        s0, s1 = acc, acc + d
        if s1 >= a and s0 <= b:
            t0 = max(0.0, (a - s0) / d)
            t1 = min(1.0, (b - s0) / d)
            pa = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0]
            pb = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1]
            if not out:
                out.append(pa)
            out.append(pb)
        acc = s1
    return [[round(x, 6), round(y, 6)] for x, y in out]


def geometria_sre_es(spec: dict) -> tuple[dict | None, dict]:
    """Geometria de uma regra do DER-ES a partir do SRE. spec:
       {'sre': ['060EES9020-A', ...]}                      -> segmentos inteiros;
       {'sigla': 'ES-060', 'km_ini': 33, 'km_fim': 39}       -> segmentos da pista principal (código EES0xxx) recortados.
    Devolve (MultiLineString | None, info)."""
    if spec.get('sre'):
        codes = spec['sre']
        cql = 'sre IN (' + ','.join(f"'{c}'" for c in codes) + ')'
        feats = sre_es(cql, cache=f'sre_es_{"_".join(codes)}.json')
        linhas, usados = [], []
        vistos = set()
        for f in feats:
            p = f['properties']
            if p['sre'] in vistos:      # o WFS repete segmentos (mesmo sre com a mesma geometria)
                continue
            vistos.add(p['sre'])
            linhas.append([[round(x, 6), round(y, 6)] for x, y in _costura(_linhas(f['geometry']))])
            usados.append(p['sre'])
        info = {'sre': usados, 'faltando': [c for c in codes if c not in vistos]}
        return ({'type': 'MultiLineString', 'coordinates': linhas} if linhas else None), info
    sigla, k0, k1 = spec['sigla'], float(spec['km_ini']), float(spec['km_fim'])
    feats = sre_es(f"sigla = '{sigla}'", cache=f'sre_es_{sigla}.json')
    linhas, usados = [], []
    vistos = set()
    for f in feats:
        p = f['properties']
        code = p.get('sre') or ''
        if not re.match(r'^\d{3}EES0\d{3}', code) or code in vistos:   # só a pista principal (acessos 9xxx ficam de fora)
            continue
        a, b = p.get('km_inicial'), p.get('km_final')
        if a is None or b is None or b <= k0 or a >= k1:
            continue
        vistos.add(code)
        c = _costura(_linhas(f['geometry']))
        r = recorte_km(c, float(a), float(b), k0, k1)
        if len(r) >= 2:
            linhas.append(r)
            usados.append({'sre': code, 'km_inicial': a, 'km_final': b, 'sit': p.get('sit'), 'descricao': p.get('descricao')})
    info = {'sre': usados}
    return ({'type': 'MultiLineString', 'coordinates': linhas} if linhas else None), info


def ponto_km_sre_es(code: str, km: float) -> tuple[float, float] | None:
    """Ponto (lon, lat) do km `km` no segmento `code` do SRE do DER-ES (interpolado ao longo da geometria)."""
    feats = sre_es(f"sre = '{code}'", cache=f'sre_es_{code}.json')
    for f in feats:
        p = f['properties']
        a, b = p.get('km_inicial'), p.get('km_final')
        if a is None or b is None:
            continue
        c = _costura(_linhas(f['geometry']))
        r = recorte_km(c, float(a), float(b), km, km + 0.001)
        if r:
            return (r[0][0], r[0][1])
    return None


def comprimento_km(g: dict | None) -> float:
    if not g:
        return 0.0
    return round(sum(_len_m(c) for c in _linhas(g)) / 1000, 3)


def cos_lat(lat: float) -> float:
    return math.cos(math.radians(lat))
