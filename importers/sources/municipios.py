"""Importador genérico das restrições municipais a caminhões (camada `restricoes_rmsp`).

Lê um arquivo por município em data/raw/municipios/<ibge>.json (formato em data/raw/municipios/schema.json; passo a
passo em docs/layers/restricoes_municipais.md), valida (schema + coerência), monta as feições e grava UMA FONTE POR
MUNICÍPIO (`fonte_id` do arquivo): seed db/seed/layers/restricoes_rmsp__<fonte_id>.sql e uma linha em data_layer_runs.
Uma frente regional só ADICIONA o arquivo do município (e, se for o caso, o GeoJSON curado da geometria).

  run.py municipios                          todos os municípios + os limites da RMSP (fonte 'ibge')
  run.py municipios:3106200                  só Belo Horizonte (código IBGE ou fonte_id; vários separados por vírgula)
  run.py municipios:ibge                     só os limites municipais curados da RMSP
  python -m sources.municipios --validar     valida todos os arquivos sem banco, sem Valhalla e sem rede

Regras (status x aplicação):
  * só `status: ativa` vira zona (kind=zona → exclusions) ou via/ponte (kind=via → costLines);
  * desativada / suspensa / revogada são gravadas com kind igual ao status e NUNCA aplicadas (a API só avisa as duas
    primeiras quando a rota passa nelas); confiança baixa/unverifiable só entra desativada (o validador recusa ativa);
  * vias e pontes passam pela validação no Valhalla (corte em pedaços de até 400 m, edge walk, encadeamento).
"""
from __future__ import annotations

import json
import os
import pathlib
import sys

from common import stable_id
from sources import _municipios_lib as lib
from sources import _municipios_schema as sch

LAYER_ID = lib.LAYER_ID
SOURCE = 'municipios'          # várias fontes: uma por arquivo de município (fonte_id) + 'ibge'
SOURCE_URL = 'data/raw/municipios/<ibge>.json (um arquivo por município; URL dos atos em cada arquivo)'
LICENSE = ('Atos oficiais municipais: domínio público (Lei 9.610/1998 art. 8º IV). Geometria: OpenStreetMap (ODbL 1.0) '
           'ou curada; limites: IBGE (dados públicos)')

MUNICIPIOS_DIR = pathlib.Path(os.environ.get('MUNICIPIOS_DIR', str(lib.RAW_DIR / 'municipios')))
SCHEMA = pathlib.Path(os.environ.get('MUNICIPIOS_SCHEMA', str(MUNICIPIOS_DIR / 'schema.json')))

LIMITES = {
    'source': 'ibge',
    'source_url': ('https://servicodados.ibge.gov.br/api/v3/malhas/estados/SP?formato=application/vnd.geo%2Bjson'
                   '&qualidade=maxima&intrarregiao=municipio (39 municípios da RMSP, simplificado a ~10 m)'),
    'license': 'IBGE — Malha Municipal (dados públicos, uso livre com citação da fonte: IBGE)',
    'notes': ('Limites municipais da RMSP para localizar origem/destino (exceção de destino local). Fora da RMSP a API usa a '
              'malha do IBGE da camada geocoding (ibge-malhas).'),
}

# campos da regra que não vão para as props da feição (configuração de geometria/identidade)
_FORA_DAS_PROPS = {'id', 'geometria', 'trechos', 'source_id', 'verificado_em'}


# ----------------------------------------------------------------------------- leitura e validação
def arquivos() -> list[pathlib.Path]:
    return sorted(p for p in MUNICIPIOS_DIR.glob('*.json') if p.stem.isdigit())


def _existe(rel: str) -> bool:
    try:
        return lib.raw_path(rel).exists()
    except ValueError:
        return False


def carregar(path: pathlib.Path, validador: sch.Validador | None = None) -> dict:
    doc = json.loads(path.read_text())
    erros = sch.validar(doc, validador or sch.carregar_schema(SCHEMA), path.name, _existe)
    if erros:
        raise ValueError(f'{path.name}: {len(erros)} erro(s) de formato:\n  - ' + '\n  - '.join(erros))
    return doc


def carregar_todos(paths: list[pathlib.Path] | None = None) -> list[dict]:
    """Valida todos os arquivos (e as regras entre arquivos: fonte_id e id de regra únicos no projeto)."""
    v = sch.carregar_schema(SCHEMA)
    docs, erros = [], []
    for p in paths if paths is not None else arquivos():
        try:
            docs.append(carregar(p, v))
        except ValueError as e:
            erros.append(str(e))
    fontes, regras = {}, {}
    for d in docs:
        if d['fonte_id'] in fontes:
            erros.append(f'fonte_id "{d["fonte_id"]}" repetido em {fontes[d["fonte_id"]]} e {d["ibge"]}.json')
        fontes[d['fonte_id']] = f'{d["ibge"]}.json'
        for r in d['regras']:
            if r['id'] in regras and regras[r['id']] != d['ibge']:
                erros.append(f'id de regra "{r["id"]}" repetido em {regras[r["id"]]}.json e {d["ibge"]}.json')
            regras[r['id']] = d['ibge']
    if erros:
        raise ValueError('\n'.join(erros))
    return docs


# ----------------------------------------------------------------------------- montagem das feições
def regra_props(doc: dict, r: dict) -> dict:
    """Propriedades comuns da regra (o que a API lê em data_features.props)."""
    p = {'regra_id': r['id'], 'municipio': doc['municipio'], 'ibge': doc['ibge'], 'uf': doc['uf']}
    p.update({k: v for k, v in r.items() if k not in _FORA_DAS_PROPS})
    if 'vuc' not in r:
        p['vuc'] = doc['vuc']                       # definição local de VUC do município
    if 'vuc_nota' not in r and doc.get('vuc_nota'):
        p['vuc_nota'] = doc['vuc_nota']
    return p


def _features_de(obj: dict) -> list[dict]:
    t = obj.get('type')
    if t == 'FeatureCollection':
        return [dict(f, properties=dict(f.get('properties') or {})) for f in obj.get('features', [])]
    if t == 'Feature':
        return [dict(obj, properties=dict(obj.get('properties') or {}))]
    return [{'type': 'Feature', 'geometry': obj, 'properties': {}}]


def _construir(doc: dict, r: dict, g: dict) -> dict:
    modo = g.get('construir', 'manual')
    if modo == 'trechos':
        # arquivo compartilhado por várias regras do município: monta os trechos de todas elas juntas
        rs = [x for x in doc['regras'] if any(y.get('arquivo') == g['arquivo'] and y.get('construir') == 'trechos' for y in x['geometria'])]
        return lib.street_rules_fc(rs, doc['ibge'], lambda: lib.overpass_named_ways(doc['ibge']))
    if modo == 'entorno':
        return lib.entorno_fc(r['id'], g['entorno'])
    raise RuntimeError(f'data/raw/{g["arquivo"]} ausente (geometria curada à mão)' + (f': {g["como_gerar"]}' if g.get('como_gerar') else ''))


def _uniao_municipios(g: dict, construir: bool = True) -> dict:
    from shapely.geometry import mapping, shape
    from shapely.ops import unary_union
    lim = {f['properties']['ibge']: shape(f['geometry']) for f in lib.municipios()}
    geoms = [lim[c] if c in lim else lib.municipio_geom(c, rede=construir) for c in g['municipios']]
    u = unary_union(geoms)
    if g.get('simplificar'):
        u = u.simplify(g['simplificar'])
    return lib.round_geojson(mapping(u), g.get('casas', 7))


def _itens(doc: dict, r: dict, carregados: dict, construir: bool = True) -> list[tuple[dict, list[tuple[int, dict]]]]:
    """[(item de geometria, [(índice, feição GeoJSON)])]. Índice = posição no arquivo (antes do filtro por regra_id, para
    o source_id não mudar quando o arquivo é compartilhado), recontado depois de `omitir_ways_de`.
    `construir=False` (validação offline): só lê o que existe; geometria a gerar levanta lib.GeometriaAusente."""
    brutos: dict[str, list[tuple[int, dict]]] = {}
    for k, g in enumerate(r['geometria']):
        if 'arquivo' in g:
            if g['arquivo'] not in carregados:
                if not construir and not lib.raw_path(g['arquivo']).exists():
                    raise lib.GeometriaAusente(f'data/raw/{g["arquivo"]} (construir: {g.get("construir", "manual")})')
                carregados[g['arquivo']] = lib.build_or_load(g['arquivo'], lambda g=g: _construir(doc, r, g)) if construir \
                    else json.loads(lib.raw_path(g['arquivo']).read_text())
            fs = _features_de(carregados[g['arquivo']])
        elif 'geojson' in g:
            fs = _features_de(g['geojson'])
        else:
            fs = [{'type': 'Feature', 'geometry': _uniao_municipios(g, construir), 'properties': {}}]
        for f in fs:
            p = f['properties']
            if g.get('formato') == 'eixos':      # eixos casados de um mapa: {nome, oneway}
                p.update({'via': p.get('nome'), 'nome_osm': p.get('nome'), 'mao_unica': bool(p.get('oneway')),
                          'sentido': 'unico' if p.get('oneway') else 'ambos'})
            p.update(g.get('props') or {})
        brutos[g.get('id') or f'#{k}'] = list(enumerate(fs))
    out = []
    for k, g in enumerate(r['geometria']):
        fs = brutos[g.get('id') or f'#{k}']
        if g.get('omitir_ways_de'):
            ways = {f['properties'].get('osm_way_id') for o in g['omitir_ways_de'] for _, f in brutos[o]}
            fs = list(enumerate(f for _, f in fs if f['properties'].get('osm_way_id') not in ways))
        fs = [(i, f) for i, f in fs if f['properties'].get('regra_id', r['id']) == r['id']]
        out.append((g, fs))
    return out


_GEOM_OK = {'zona': ('Polygon', 'MultiPolygon'), 'via': ('LineString', 'MultiLineString'), 'ponte': ('LineString', 'MultiLineString')}


def compilar(doc: dict, construir: bool = True) -> list[dict]:
    """Feições do município ANTES da validação no Valhalla (determinístico, sem rede quando a geometria está curada).
    `construir=False`: nunca gera geometria nem acessa a rede (GeoJSON a gerar → lib.GeometriaAusente)."""
    out, carregados = [], {}
    for r in doc['regras']:
        base = regra_props(doc, r)
        ativa = r['status'] == 'ativa'
        kind = ('zona' if r['tipo'] == 'zona' else 'via') if ativa else r['status']
        feats = [x for _, fs in _itens(doc, r, carregados, construir) for x in fs]
        if r.get('source_id') and len(feats) != 1:
            raise ValueError(f'{doc["ibge"]}.json, {r["id"]}: source_id fixo exige uma única feição ({len(feats)} montadas)')
        if ativa and not feats:
            raise ValueError(f'{doc["ibge"]}.json, {r["id"]}: regra ativa sem geometria')
        for i, f in feats:
            gt = (f.get('geometry') or {}).get('type')
            if gt not in _GEOM_OK[r['tipo']]:
                raise ValueError(f'{doc["ibge"]}.json, {r["id"]}: geometria {gt} não serve para o tipo {r["tipo"]} ({"/".join(_GEOM_OK[r["tipo"]])})')
            p = dict(f['properties'])
            p.pop('regra_id', None)
            props = {**base, **p, 'verificado_em': r.get('verificado_em') or doc['verificado_em']}
            nome = p.get('via') or p.get('nome_osm') or 'via sem nome no OSM'
            out.append({
                'source_id': r.get('source_id') or stable_id(r['id'], p.get('inciso'), p.get('osm_way_id'), i, json.dumps(f['geometry'])[:200]),
                'geometry': f['geometry'],
                'name': f"{props['municipio']}: {r['regime']} — {nome}" if r['tipo'] != 'zona' else r['nome'],
                'kind': kind,
                'props': props,
                'valid_from': r.get('vigencia_inicio'), 'valid_to': r.get('vigencia_fim'),
            })
    return out


def limites() -> list[dict]:
    fs = lib.municipios()
    if not fs:
        # carga vazia apagaria os 39 limites do banco (o load_db troca a fonte inteira) e derrubaria a exceção de destino local
        raise FileNotFoundError(f'limites municipais curados ausentes: data/raw/{lib.LIMITES_RMSP} (DATA_DIR/MUNICIPIOS_RAW_DIR '
                                'apontam para o lugar certo?)')
    return [{'source_id': f"mun-{f['properties']['ibge']}", 'geometry': f['geometry'], 'name': f['properties']['nome'], 'kind': 'municipio',
             'props': {'ibge': f['properties']['ibge'], 'municipio': f['properties']['nome'], 'fonte': 'IBGE Malha Municipal'}}
            for f in fs]


# ----------------------------------------------------------------------------- protocolo do run.py (várias fontes)
def runs(arg: str | None = None) -> list[dict]:
    """Uma carga por município (fonte = fonte_id) e a dos limites ('ibge'). `arg`: códigos IBGE, fonte_ids ou 'ibge'."""
    docs = carregar_todos()
    jobs = [{**LIMITES, 'fetch': limites}]
    for d in docs:
        jobs.append({'source': d['fonte_id'], 'source_url': d['fonte']['url'], 'license': d['fonte']['licenca'],
                     'notes': d['fonte'].get('notas'), 'ibge': d['ibge'], 'fetch': lambda d=d: lib.valhalla_check(compilar(d))})
    if not arg:
        return jobs
    want = {t.strip() for t in arg.split(',') if t.strip()}
    sel = [j for j in jobs if j['source'] in want or j.get('ibge') in want or (j['source'] == 'ibge' and 'limites' in want)]
    achados = {j['source'] for j in sel} | {j.get('ibge') for j in sel} | ({'limites'} if any(j['source'] == 'ibge' for j in sel) else set())
    if want - achados:
        raise SystemExit(f'municipios: não encontrado(s): {", ".join(sorted(want - achados))} (use código IBGE, fonte_id ou "ibge")')
    return sel


def fetch():
    raise RuntimeError('municipios tem várias fontes: rode pelo run.py (run.py municipios ou municipios:<ibge>)')


# ----------------------------------------------------------------------------- validação offline
def _resumo(doc: dict) -> tuple[str, bool]:
    """Resumo do município e se a geometria existente é coerente. Não usa rede nem grava em data/raw: a geometria que só
    o import gera (Overpass, malha do IBGE) aparece como "a gerar no import"."""
    linhas = [f'{doc["ibge"]} {doc["municipio"]}/{doc["uf"]} (fonte {doc["fonte_id"]}, verificado em {doc["verificado_em"]})']
    ok = True
    try:
        feats = compilar(doc, construir=False)
    except lib.GeometriaAusente as e:
        feats = None
        linhas.append(f'  - geometria a gerar no import: {e}')
    except ValueError as e:                         # geometria existente mas incoerente com a regra
        feats, ok = None, False
        linhas.append(f'  ! geometria inválida: {e}')
    for r in doc['regras']:
        n = '' if feats is None else f', {sum(1 for f in feats if f["props"]["regra_id"] == r["id"])} feição(ões)'
        linhas.append(f'  - {r["id"]}: {r["tipo"]} {r["status"]} (confiança {r["confianca"]}){n}')
    return '\n'.join(linhas), ok


if __name__ == '__main__':
    if '--validar' not in sys.argv:
        print('uso: python -m sources.municipios --validar [arquivo.json ...]')
        sys.exit(2)
    paths = [pathlib.Path(a) for a in sys.argv[1:] if a.endswith('.json')] or None
    try:
        ds = carregar_todos(paths)
    except ValueError as e:
        print(f'ERRO:\n{e}')
        sys.exit(1)
    invalidos = 0
    for d in ds:
        texto, ok = _resumo(d)
        print(texto)
        invalidos += not ok
    if invalidos:
        print(f'ERRO: geometria inválida em {invalidos} arquivo(s)')
        sys.exit(1)
    print(f'ok: {len(ds)} arquivo(s) válido(s)')
