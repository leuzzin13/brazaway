"""Feiras livres da cidade de São Paulo — GeoSampa, camada geoportal:equipamento_feira_livre (SMDU/Deinfo).

Um ponto por feira (endereço de referência) com o dia da semana. O GeoSampa avisa que o dado NÃO traz número de
barracas, extensão nem localização exata. Horário: Decreto 48.172/2007, art. 5º, I (redação do Decreto
61.775/2022) para as feiras comuns: 7h–8h montagem, 8h–14h comercialização, 14h–14h45 desmontagem; art. 4º:
terça a domingo, exceto 25/12 e 1º/01.

Base legal do bloqueio: Decreto 48.172/2007, art. 5º, § 2º, III — nos dias e horários da feira o tráfego e o
estacionamento de veículos ficam proibidos nos locais de montagem das bancas (conferido no Catálogo de Legislação
Municipal em 09/10/2026). O § 1º do mesmo artigo admite horários diferenciados por feira: a janela é a padrão.

Se o Valhalla estiver acessível, o ponto é casado (locate) com a aresta da malha de MESMO NOME de rua a até 70 m
(≈ a quadra da feira). props.osm guarda o traçado exato da aresta nos dois sentidos (validado no edge walk de
linear_cost_factors, só vale para o tileset registrado) e o meio da aresta (mid), usado como reserva quando o
tileset muda (a API bloqueia a quadra com um polígono minúsculo no meio dela). Sem casamento seguro, só aviso.
"""
from __future__ import annotations

import difflib
import re
import time
import unicodedata

from sources.geosampa_faixa_onibus import _post, decode6, dist_m, lcf_ok, length_m, valhalla_tileset, wfs_geojson

LAYER_ID = 'feiras_livres'
SOURCE = 'geosampa'
SOURCE_URL = 'https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs (typeNames=geoportal:equipamento_feira_livre)'
LICENSE = 'CC-BY-SA 4.0 — GeoSampa/Prefeitura de São Paulo (SMDU/Deinfo); props.osm derivado do OpenStreetMap (ODbL)'
NOTES = ('Ponto de referência, sem extensão da feira. Horário pelo Decreto 48.172/2007 art. 5º I (red. Dec. 61.775/2022) '
         'só para categoria T (tradicional/comum); props.osm = aresta da malha com o mesmo nome de rua (≤ 70 m): '
         'traçado nos dois sentidos validado no edge walk (lines) e meio da aresta (mid).')

DIAS = {'SEGUNDA-FEIRA': 1, 'TERCA-FEIRA': 2, 'QUARTA-FEIRA': 3, 'QUINTA-FEIRA': 4, 'SEXTA-FEIRA': 5, 'SABADO': 6, 'DOMINGO': 7}
DIA_PT = {1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado', 7: 'domingo'}
# Decreto 48.172/2007, art. 5º, I, a–c (redação dada pelo Decreto 61.775/2022)
JANELA_COMUM = {'from': '07:00', 'to': '14:45'}
CATEGORIA = {'T': 'tradicional', 'O': 'orgânica (categoria O, sigla não documentada)', 'N': 'categoria N (sigla não documentada)'}

ABREV = {'AV': 'AVENIDA', 'R': 'RUA', 'PC': 'PRACA', 'PCA': 'PRACA', 'AL': 'ALAMEDA', 'TV': 'TRAVESSA', 'EST': 'ESTRADA',
         'ESTR': 'ESTRADA', 'ES': 'ESTRADA', 'LGO': 'LARGO', 'LG': 'LARGO', 'PQ': 'PARQUE', 'VD': 'VIADUTO', 'DR': 'DOUTOR',
         'PROF': 'PROFESSOR', 'ENG': 'ENGENHEIRO', 'STA': 'SANTA', 'STO': 'SANTO', 'GAL': 'GENERAL', 'GEN': 'GENERAL',
         'CEL': 'CORONEL', 'PE': 'PADRE', 'PDE': 'PADRE', 'SEN': 'SENADOR', 'DEP': 'DEPUTADO', 'MAL': 'MARECHAL',
         'BRIG': 'BRIGADEIRO', 'CAP': 'CAPITAO', 'TEN': 'TENENTE', 'COM': 'COMENDADOR', 'DES': 'DESEMBARGADOR',
         'MIN': 'MINISTRO', 'PRES': 'PRESIDENTE', 'VER': 'VEREADOR', 'N': 'NOSSA', 'SRA': 'SENHORA', 'S': 'SAO', 'D': 'DONA'}
TIPOS = {'AVENIDA', 'RUA', 'PRACA', 'ALAMEDA', 'TRAVESSA', 'ESTRADA', 'LARGO', 'PARQUE', 'VIADUTO', 'VIELA', 'PASSAGEM'}
STOP = {'DE', 'DA', 'DO', 'DOS', 'DAS', 'E'}


def norm_street(s: str) -> tuple[str, str]:
    """('RUA', 'INTERATIVA') a partir de 'RUA INTERATIVA' / 'Rua Interativa' / 'R INTERATIVA'."""
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().upper()
    toks = [ABREV.get(t, t) for t in re.findall(r'[A-Z0-9]+', s)]
    tipo = toks[0] if toks and toks[0] in TIPOS else ''
    body = [t for t in (toks[1:] if tipo else toks) if t not in STOP]
    return tipo, ' '.join(body)


def same_street(a: str, b: str) -> bool:
    ta, na = norm_street(a)
    tb, nb = norm_street(b)
    if not na or not nb:
        return False
    r = 1.0 if na == nb else difflib.SequenceMatcher(None, na, nb).ratio()
    if ta and tb and ta != tb:
        return r >= 0.95          # cadastro e OSM divergem no tipo (Rua x Avenida): só com o nome idêntico
    return r >= 0.85


def street_names(rua: str) -> list[str]:
    """'RUA AIMBERE C CAIUBI' / 'RUA X C/ Y' / 'RUA DOS ANIQUIS E DOS CARATAIS' → ruas citadas (esquinas)."""
    parts = re.split(r'\s+(?:C/|C|E|ESQ\.?|ESQUINA COM)\s+', rua.strip())
    out = [parts[0]]
    tipo = norm_street(parts[0])[0]
    for p in parts[1:]:
        out.append(p if norm_street(p)[0] else f'{tipo} {p}'.strip())
    return out


def split_address(addr: str) -> tuple[str, str | None]:
    a = re.sub(r'\s+', ' ', (addr or '').strip())
    m = re.match(r'^(.*?)(?:,\s*(\d+)\s*)?$', a)
    return (m.group(1).strip(), m.group(2)) if m else (a, None)


def fetch():
    d = wfs_geojson('equipamento_feira_livre', 'geosampa_feira_livre.json', max_age_h=24 * 7)
    feats = []
    for f in d['features']:
        p = f['properties']
        g = f.get('geometry') or {}
        if g.get('type') != 'Point':
            continue
        dia = DIAS.get((p.get('tx_dia_funcionamento') or '').strip().upper())
        if not dia:
            continue
        rua, numero = split_address(p.get('tx_endereco_equipamento'))
        cat = (p.get('cd_tipo_categoria') or '').strip().upper() or None
        comum = cat == 'T'
        feats.append({
            'source_id': str(p.get('cd_registro') or p['cd_identificador']),
            'geometry': {'type': 'Point', 'coordinates': g['coordinates'][:2]},
            'name': (p.get('nm_equipamento') or '').strip() or None,
            'kind': 'feira_livre',
            'props': {
                'registro': p.get('cd_registro'), 'endereco': re.sub(r'\s+', ' ', (p.get('tx_endereco_equipamento') or '').strip()) or None,
                'rua': rua or None, 'numero': numero, 'dia': dia, 'dia_semana': DIA_PT[dia],
                'categoria': cat, 'categoria_desc': CATEGORIA.get(cat or '', cat), 'qt_equipamentos': p.get('qt_equipamento'),
                # janela legal só para a feira comum (categoria T); demais: horário não publicado
                'windows': [{'days': [dia], **JANELA_COMUM}] if comum else [],
                'horario': 'montagem 7h–8h, venda 8h–14h, desmontagem até 14h45' if comum else None,
                'base_legal': 'Decreto 48.172/2007, art. 4º e art. 5º, I (redação do Decreto 61.775/2022)' if comum else None,
                'atualizado_em': (p.get('dt_atualizacao') or '')[:10] or None,
            },
        })
    tileset = valhalla_tileset()
    if tileset is not None:
        _attach_osm(feats, tileset)
    else:
        print('    Valhalla indisponível: feiras sem props.osm (só avisos, sem bloqueio)')
    return feats


def _midpoint(shape):
    """Ponto no meio (em distância) da aresta e o comprimento dela."""
    L = length_m(shape)
    acc = 0.0
    for a, b in zip(shape, shape[1:]):
        d = dist_m(a, b)
        if d > 0 and acc + d >= L / 2:
            t = (L / 2 - acc) / d
            return [round(a[0] + (b[0] - a[0]) * t, 7), round(a[1] + (b[1] - a[1]) * t, 7)], L
        acc += d
    return shape[len(shape) // 2], L


def _attach_osm(feats: list[dict], tileset: int) -> None:
    """props.osm = {mid, aresta_m, way_id, nome_osm, distancia_m}: meio da aresta (≈ quadra) da rua de mesmo nome.
    A API bloqueia a quadra com um polígono minúsculo (raio de poucos metros) nesse ponto: o Valhalla evita só a
    aresta que passa por ele, e as ruas que cruzam (nas esquinas, longe do meio) continuam livres."""
    t0 = time.time()
    cands = [f for f in feats if f['props']['windows'] and f['props']['rua']]
    n = 0
    for s in range(0, len(cands), 50):
        batch = cands[s:s + 50]
        locs = [{'lon': f['geometry']['coordinates'][0], 'lat': f['geometry']['coordinates'][1], 'radius': 70} for f in batch]
        st, j = _post('/locate', {'locations': locs, 'costing': 'auto', 'verbose': True})
        if st != 200 or not isinstance(j, list):
            continue
        for f, loc in zip(batch, j):
            best = None
            for e in loc.get('edges') or []:
                ei = e.get('edge_info') or {}
                names = ei.get('names') or []
                if not any(same_street(r, nm) for r in street_names(f['props']['rua']) for nm in names):
                    continue
                cls = (e.get('edge') or {}).get('classification') or {}
                if cls.get('use') not in (None, 'road', 'living_street') or cls.get('link'):
                    continue
                pa = e.get('percent_along') or 0
                score = e.get('distance', 99) + (15 if pa in (0, 1) else 0)   # ponto na esquina = aresta vizinha
                if best is None or score < best[0]:
                    best = (score, e)
            if not best:
                continue
            e = best[1]
            shape = decode6(e['edge_info']['shape'])
            if len(shape) < 2:
                continue
            mid, L = _midpoint(shape)
            if L < 24:            # quadra curta demais: o polígono encostaria nas esquinas
                continue
            n += 1
            sh = [[round(x, 6), round(y, 6)] for x, y in shape]
            f['props']['osm'] = {'tileset': tileset, 'mid': mid, 'aresta_m': round(L), 'way_id': e['edge_info'].get('way_id'),
                                 'nome_osm': (e['edge_info'].get('names') or [None])[0], 'distancia_m': round(e.get('distance', 0), 1),
                                 'lines': [{'dir': 'fwd', 'coords': sh}, {'dir': 'rev', 'coords': sh[::-1]}]}
    # valida o edge walk de cada traçado (um traçado inválido derrubaria a rota inteira no Valhalla)
    todo = [(f, l) for f in cands if f['props'].get('osm') for l in f['props']['osm']['lines']]
    ok = lcf_ok([l['coords'] for _, l in todo]) if todo else []
    bad = {id(l) for (_, l), good in zip(todo, ok) if not good}
    n_lines = 0
    for f in cands:
        o = f['props'].get('osm')
        if not o:
            continue
        o['lines'] = [l for l in o['lines'] if id(l) not in bad]
        n_lines += len(o['lines'])
    print(f'    feiras: {len(cands)} com janela legal, {n} casadas com a quadra da rua de mesmo nome, '
          f'{n_lines} traçados válidos no edge walk ({time.time() - t0:.0f}s)')
