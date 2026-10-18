"""Biblioteca dos importadores de pedágio das concessões ESTADUAIS (RJ, MG, RS, MS e MT) e MUNICIPAIS (Rio de Janeiro, Pirapetinga).

Lê o arquivo curado data/raw/pedagio/concessoes_estaduais.json (tarifas transcritas com fonte, ato e data; posição das
praças) e, somado a ele, data/raw/pedagio/concessoes_estaduais_sul_co.json (RS, MS, MT; mesmo esquema) e devolve as
feições da camada `pedagio`. Usado por toll_agetransp.py, toll_artemig.py, toll_municipais.py, toll_rs_estadual.py,
toll_agems.py e toll_agermt.py.

Posição de cada praça (props.posicao_metodo, sempre registrado):
  - 'oficial': coordenada publicada em ato ou contrato (UTM SIRGAS 2000 23S quando houver, senão graus/minutos/segundos);
  - 'osm': casamento com os nós barrier=toll_booth / highway=toll_gantry do OSM (fonte 'osm' da mesma camada, isto é,
    o mesmo extrato do Valhalla; se o PBF local for mais novo que essa carga, lidos do PBF) do MESMO operador (regex `operador_osm`) a até `raio_m` da âncora; os nós a até 700 m
    do mais próximo formam a praça e a posição é o centro deles. A âncora é a posição do grupo de nós identificado em
    10/10/2026 (praça por praça, pelo nome do município, pela rodovia e pela ordem ao longo da rodovia);
  - 'sre_km': rodovia + km na malha SRE-MG 2026_02 (só para registro inativo, ver _sre_mg.py).
Sem nó do OSM perto da âncora, a praça fica na âncora com precisao='aprox' e o log avisa.
"""
from __future__ import annotations
import json, math, os, pathlib, re, unicodedata
from common import DATA_DIR, stable_id

CURATED = pathlib.Path(os.environ.get('PEDAGIO_ESTADUAIS_JSON', str(DATA_DIR / 'raw' / 'pedagio' / 'concessoes_estaduais.json')))
CURATED_SUL_CO = pathlib.Path(os.environ.get('PEDAGIO_ESTADUAIS_SUL_CO_JSON', str(DATA_DIR / 'raw' / 'pedagio' / 'concessoes_estaduais_sul_co.json')))
CLUSTER_M = 700
# distância máxima para a API associar um nó de pedágio do OSM a estas praças (a posição já é a do nó ou a oficial)
CASAR_ATE_M = 400
CHAVES_PROPS = ('concessionaria', 'regulador', 'poder_concedente', 'contrato', 'ato', 'ato_url', 'pagina_tarifa', 'imagem_tabela',
                'cobranca', 'isencoes', 'vigencia_obs', 'obs_rodagem', 'reajuste_suspenso', 'fontes_extra', 'confianca')


def norm(s: str | None) -> str:
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', s).strip()


def load() -> dict:
    if not CURATED.exists():
        raise RuntimeError(f'{CURATED} ausente (arquivo curado versionado em data/raw/pedagio/)')
    d = json.loads(CURATED.read_text(encoding='utf-8'))
    if CURATED_SUL_CO.exists():
        extra = json.loads(CURATED_SUL_CO.read_text(encoding='utf-8'))
        d['concessoes'] = d['concessoes'] + extra['concessoes']
        d['janelas'] = {**d.get('janelas', {}), **extra.get('janelas', {})}
        d['transcrito_em_sul_co'] = extra.get('transcrito_em')
    return d


def concessoes(importador: str) -> tuple[dict, list[dict]]:
    d = load()
    return d, [c for c in d['concessoes'] if c.get('importador') == importador]


def dist_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    dx = (a[0] - b[0]) * 111320 * math.cos(math.radians((a[1] + b[1]) / 2))
    dy = (a[1] - b[1]) * 110540
    return math.hypot(dx, dy)


_DMS = re.compile(r"""(\d+)\s*°\s*(\d+)\s*'\s*([\d.,]+)\s*"?\s*([NS])\s+(\d+)\s*°\s*(\d+)\s*'\s*([\d.,]+)\s*"?\s*([EWO])""", re.I)


def dms(s: str) -> tuple[float, float]:
    """'21°58'56.40"S 46°19'48.40"W' -> (lon, lat)."""
    m = _DMS.search(s or '')
    if not m:
        raise ValueError(f'coordenada não reconhecida: {s!r}')
    def dd(g, mi, se, h):
        v = int(g) + int(mi) / 60 + float(se.replace(',', '.')) / 3600
        return -v if h.upper() in 'SWO' else v
    lat = dd(m.group(1), m.group(2), m.group(3), m.group(4))
    lon = dd(m.group(5), m.group(6), m.group(7), m.group(8))
    return lon, lat


def utm23s(e: float, n: float) -> tuple[float, float]:
    """SIRGAS 2000 / UTM 23S (EPSG:31983) -> (lon, lat)."""
    from pyproj import Transformer
    lon, lat = Transformer.from_crs(31983, 4326, always_xy=True).transform(e, n)
    return lon, lat


_NODES: list[dict] | None = None


def banco_atualizado(n_rows: int, carga_ts: float | None, pbf_mtime: float | None) -> bool:
    """Os nós do OSM no banco servem se existem e se a última carga do toll_osm é posterior ao extrato local (sem PBF
    local, o banco é a única referência do extrato do Valhalla)."""
    if not n_rows:
        return False
    if pbf_mtime is None:
        return True
    return carga_ts is not None and carga_ts >= pbf_mtime


def osm_toll_nodes() -> list[dict]:
    """Nós de pedágio do OSM do MESMO extrato do Valhalla, lidos uma vez por processo.
    Do banco (fonte 'osm' da camada pedagio) quando a última carga do toll_osm é posterior ao PBF local; senão, direto do
    PBF (ou da Overpass) pelo toll_osm.fetch(). Isso cobre o `run.py all`, que roda em ordem alfabética e chama
    toll_agetransp, toll_artemig e toll_municipais ANTES do toll_osm: com um extrato novo, a posição das praças e os
    `osm_nodes` já saem do extrato novo, sem esperar a carga seguinte."""
    global _NODES
    if _NODES is not None:
        return _NODES
    rows: list[dict] = []
    carga = None
    try:
        from common import _pg_conn
        with _pg_conn() as c, c.cursor() as cur:
            cur.execute("select extract(epoch from max(imported_at)) from data_layer_runs where layer_id = 'pedagio' and source = 'osm'")
            carga = cur.fetchone()[0]
            cur.execute("""select source_id, ST_X(geom), ST_Y(geom), props->>'operador', name, props->'rodovias', kind
                             from data_features where layer_id = 'pedagio' and source = 'osm'""")
            for sid, lon, lat, op, name, rods, kind in cur.fetchall():
                rows.append({'id': sid, 'lon': lon, 'lat': lat, 'operador': op, 'name': name, 'rodovias': rods or [], 'kind': kind})
    except Exception as e:  # noqa: BLE001
        print(f'  ! banco indisponível para ler os nós do OSM ({e}); lendo pelo toll_osm')
    from sources import toll_osm
    pbf = toll_osm._pbf_path()
    pbf_mtime = os.path.getmtime(pbf) if pbf else None
    if not banco_atualizado(len(rows), float(carga) if carga is not None else None, pbf_mtime):
        if rows:
            print(f'  ! o extrato {pbf} é mais novo que a última carga do toll_osm no banco: lendo os nós de pedágio do PBF '
                  '(rode o toll_osm para atualizar a camada)')
        rows = []
        for f in toll_osm.fetch():
            lon, lat = f['geometry']['coordinates']
            rows.append({'id': f['source_id'], 'lon': lon, 'lat': lat, 'operador': f['props'].get('operador'), 'name': f.get('name'),
                         'rodovias': f['props'].get('rodovias') or [], 'kind': f.get('kind')})
    _NODES = rows
    return rows


def place_osm(pos: dict, conc: dict, nodes: list[dict]) -> tuple[tuple[float, float], dict] | None:
    """Casa a praça com os nós do OSM do mesmo operador perto da âncora. Devolve ((lon, lat), meta) ou None."""
    anc = tuple(pos['ancora'])
    raio = float(pos.get('raio_m', 600))
    rx = re.compile(conc.get('operador_osm') or '^$', re.I)
    cands = [n for n in nodes if dist_m((n['lon'], n['lat']), anc) <= raio and (rx.search(norm(n['operador'])) or rx.search(norm(n['name'])))]
    if not cands:
        return None
    first = min(cands, key=lambda n: dist_m((n['lon'], n['lat']), anc))
    grp = [n for n in cands if dist_m((n['lon'], n['lat']), (first['lon'], first['lat'])) <= CLUSTER_M]
    lon = sum(n['lon'] for n in grp) / len(grp)
    lat = sum(n['lat'] for n in grp) / len(grp)
    return (lon, lat), {'osm_nodes': sorted(n['id'] for n in grp), 'osm_nomes': sorted({n['name'] for n in grp if n['name']}),
                        'distancia_ancora_m': round(dist_m((lon, lat), anc))}


def position(praca: dict, conc: dict, nodes: list[dict], sre=None) -> tuple[tuple[float, float] | None, dict]:
    pos = praca.get('posicao') or {}
    met = pos.get('metodo')
    if met == 'oficial':
        if pos.get('utm_23s'):
            pt = utm23s(*pos['utm_23s'])
            how = f"coordenada oficial (UTM SIRGAS 2000 23S {pos['utm_23s'][0]} {pos['utm_23s'][1]}): {pos.get('fonte')}"
        else:
            pt = dms(pos['coord_oficial'])
            how = f"coordenada oficial ({pos['coord_oficial']}): {pos.get('fonte')}"
        return pt, {'precisao': 'oficial', 'posicao_metodo': how}
    if met == 'osm':
        r = place_osm(pos, conc, nodes)
        if r:
            pt, meta = r
            return pt, {'precisao': 'osm', 'posicao_metodo': f"casamento com {len(meta['osm_nodes'])} nó(s) de pedágio do OSM do operador "
                        f"'{conc.get('operador')}' a {meta['distancia_ancora_m']} m da âncora (centro dos nós)"
                        + (f"; {pos['obs']}" if pos.get('obs') else ''), **meta}
        return tuple(pos['ancora']), {'precisao': 'aprox', 'posicao_metodo': 'âncora curada (nenhum nó de pedágio do OSM do operador por perto na carga)'}
    if met == 'sre_km':
        if sre is None or praca.get('km') is None:
            return None, {}
        g = sre.locate(pos.get('rod_sre') or praca.get('rodovia'), float(praca['km']))
        if not g:
            return None, {}
        return (g[0], g[1]), {'precisao': 'aprox_km', 'posicao_metodo': f"rodovia + km na malha SRE-MG 2026_02 (DER-MG), trecho {g[2]}; o km da concessão pode diferir do km do SRE"}
    raise ValueError(f'posição sem método: {conc["id"]}/{praca.get("id")}')


def build_tariff(conc: dict, d: dict, fonte: str, url: str | None = None, categorias: list[dict] | None = None,
                 base: float | None = None, eixo_adicional: float | None = None, extra: dict | None = None) -> dict | None:
    """Objeto `tarifa` (modelo 'categorias' do api/src/services/tollCost.ts) a partir da transcrição."""
    t = conc.get('tarifa')
    if not t:
        return None
    cats = []
    for c in categorias or t['categorias']:
        cc = {k: c[k] for k in ('cat', 'eixos', 'eixos_ate', 'rodagem', 'mult', 'valor', 'valor_fds', 'valor_tag', 'desc') if c.get(k) is not None}
        cc.setdefault('rodagem', c.get('rodagem'))
        cats.append(cc)
    out = {
        'modelo': 'categorias', 'fonte': fonte,
        'data': conc.get('data') or conc.get('vigencia_inicio'),
        'data_desc': None if (conc.get('data') or conc.get('vigencia_inicio')) else conc.get('data_desc'),
        'url': url or conc.get('pagina_tarifa') or conc.get('ato_url'),
        'base': base if base is not None else t.get('base'),
        'categorias': cats,
        'max_eixos_tabela': t.get('max_eixos_tabela'),
        'vigencia_inicio': conc.get('vigencia_inicio'), 'vigencia_fim': conc.get('vigencia_fim'),
        'eixo_adicional': eixo_adicional if eixo_adicional is not None else t.get('eixo_adicional'),
        'nao_linear': bool(t.get('nao_linear')),
        'janela_fds': d.get('janelas', {}).get(t['janela']) if t.get('janela') else None,
        'ato': conc.get('ato'), 'transcrito_em': d.get('transcrito_em'),
    }
    if extra:
        out.update(extra)
    return {k: v for k, v in out.items() if v is not None and v != []}


def features(conc: dict, d: dict, tarifa: dict | None, nodes: list[dict], sre=None, log: list[str] | None = None) -> list[dict]:
    """Uma feição por praça da concessão (com a tarifa da concessão, ou sem tarifa se a concessão não cobra)."""
    out = []
    log = log if log is not None else []
    conc_ativa = conc.get('ativo', True)
    for p in conc.get('pracas', []):
        pt, meta = position(p, conc, nodes, sre)
        if pt is None:
            log.append(f'{conc["id"]}/{p["id"]}: sem posição ({(p.get("posicao") or {}).get("metodo")}); não importada')
            continue
        if meta.get('precisao') == 'aprox':
            log.append(f'{conc["id"]}/{p["id"]}: nenhum nó do OSM do operador perto da âncora; posição aproximada')
        ativo = conc_ativa and p.get('ativo', True)
        motivo = p.get('motivo_inativo') or conc.get('motivo_inativo')
        props = {
            'operador': conc.get('operador'), 'concessao': conc['id'], 'uf': conc.get('uf'), 'esfera': conc.get('esfera'),
            'rodovia': p.get('rodovia') or conc.get('rodovia'), 'km': p.get('km'), 'municipio': p.get('municipio'), 'praca_id': p.get('id'),
            'free_flow': bool(p.get('free_flow')), 'ponto_a_ponto': False,
            'ativo': bool(ativo), 'tarifa': tarifa if ativo else None,
            'casar_ate_m': CASAR_ATE_M, **meta,
        }
        if not ativo:
            props['motivo_inativo'] = motivo
            props['tarifa_registrada'] = tarifa  # registrada, nunca aplicada
        for k in CHAVES_PROPS:
            if conc.get(k) is not None:
                props[k] = conc[k]
        if p.get('confianca'):
            props['confianca'] = p['confianca']
        for k in ('pagamento', 'obs'):
            if p.get(k):
                props[k] = p[k]
        cso = (p.get('posicao') or {}).get('cobra_sem_no_osm')
        if cso and ativo:
            props['cobra_sem_no_osm'] = cso
        out.append({
            'source_id': stable_id(conc['id'], p['id']),
            'geometry': {'type': 'Point', 'coordinates': [round(pt[0], 7), round(pt[1], 7)]},
            'name': p['nome'],
            'kind': 'portico' if p.get('tipo') == 'portico' else 'praca',
            'props': props,
        })
    return out


def run_simple(importador: str, fonte_de, source_label: str) -> tuple[list[dict], str]:
    """Carga padrão dos importadores sem leitura de página (tabela transcrita no JSON): uma feição por praça das
    concessões do `importador`. `fonte_de(conc)` = rótulo da fonte da tarifa. Devolve (feições, NOTES)."""
    d, concs = concessoes(importador)
    nodes = osm_toll_nodes()
    out, log, resumo = [], [], []
    for conc in concs:
        tarifa = build_tariff(conc, d, fonte_de(conc), conc.get('ato_url')) if conc.get('tarifa') else None
        feats = features(conc, d, tarifa, nodes, log=log)
        out += feats
        metodos: dict[str, int] = {}
        for f in feats:
            metodos[f['props']['precisao']] = metodos.get(f['props']['precisao'], 0) + 1
        resumo.append(f'{conc["id"]}: {len(feats)} praça(s) ({sum(1 for f in feats if f["props"]["ativo"])} ativas; posição {metodos})')
        print(f'  {resumo[-1]}')
    for line in log:
        print('  !', line)
    notes = (f'{source_label}: tabelas transcritas em {d.get("transcrito_em_sul_co") or d.get("transcrito_em")}. ' + '; '.join(resumo)
             + (' Avisos: ' + ' '.join(log) if log else ''))
    return out, notes
