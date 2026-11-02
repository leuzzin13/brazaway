#!/usr/bin/env python3
"""Simulação comparativa BrasaWay × sem BrasaWay (60 dias, 50 motoristas gêmeos em cada transportadora).

Cada motorista (persona em sim/out/personas.json) existe nas duas empresas: mesmo caminhão, mesmas linhas, mesmos
horários e hábitos. A diferença é a ferramenta:
- COM BrasaWay: a rota é a do roteador (POST /api/route, a legal para aquele caminhão naquela hora). Com probabilidade
  1 - adesao_app o motorista ignora o app e vai pelo próprio caminho (o do GPS de carro), mas sabendo dos avisos.
- SEM BrasaWay: a rota é a de um GPS de carro (Valhalla costing=auto), conferida contra as mesmas restrições
  (POST /api/sim/avaliar). Cada restrição cruzada pode ser evitada pelo conhecimento do motorista; senão vira infração.

Tudo o que é rota (km, tempo, o que cruza) vem do stack real. Probabilidades de fiscalização, valores de multa (CTB),
custos e efeitos das decisões estão em PARAMS e são premissas, não medições.

Simulação 3.0 (SIM_V3=1, implica a 2.0; GRUPOS=com,mais,sem; SIM_OUT=sim/out3): três empresas com as mesmas personas e o
mesmo sorteio por viagem. 'sem' não usa app, 'com' usa o BrasaWay como na 2.0 e 'mais' usa o BrasaWay com três
funcionalidades novas: trechos bloqueados pela empresa (a rota de todos desvia), conferência do diesel por placa e
motorista (GET /api/frota/conciliacao-diesel) e prazos das multas (indicação do condutor automática, SNE). Modelo novo
para as três (premissas em PARAMS3): adesão ao posto do plano, desvio de diesel por 4 motoristas, notificação pelo
correio (atrasa ou se perde), NIC quando o condutor não é indicado no prazo e pagamento com desconto. O que a empresa
não enxerga (o diesel desviado de verdade, a conferência do painel contra a verdade) vai para sim/out3/verdade/, fora
do relatório da equipe. Sem SIM_V3, a 2.0 roda exatamente como antes.

Uso:
  python3 sim/motor.py preparar            # cria as empresas e motoristas no banco (Frota) e o estado inicial
  python3 sim/motor.py semana N            # roda a semana N (1..9) com as decisões da semana N-1 e grava o relatório
  python3 sim/motor.py final               # consolida tudo em sim/out/resultado.json
"""
import base64, datetime as dt, hashlib, hmac, itertools, json, math, os, random, re, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = Path(os.environ.get('SIM_OUT', ROOT / 'out'))
API = os.environ.get('SIM_API', 'http://localhost:3000')
# cálculo de rotas e avaliações (pesado) em rodízio entre as instâncias da API; a frota fica na 1ª (alerta ao vivo guarda estado em memória)
API_ROTAS = [u.strip() for u in os.environ.get('SIM_API_ROTAS', API).split(',') if u.strip()]
_rodizio = itertools.count()
def api_rota(): return API_ROTAS[next(_rodizio) % len(API_ROTAS)]
_t0 = time.time()
FROTA_THREADS = int(os.environ.get('SIM_FROTA_THREADS', '4'))
def marca(fase): print(f'[{time.strftime("%H:%M:%S")} +{(time.time() - _t0) / 60:.1f} min] {fase}', file=sys.stderr, flush=True)
VALHALLA = os.environ.get('SIM_VALHALLA', 'http://localhost:8002')
JWT_SECRET = os.environ.get('FROTA_DEV_JWT_SECRET', 'dev-secret-troque')
INICIO = dt.date(2026, 9, 1)          # terça-feira
DIAS = int(os.environ.get('SIM_DIAS', '60'))
FERIADOS = {dt.date(2026, 9, 7), dt.date(2026, 10, 12), dt.date(2026, 11, 2), dt.date(2026, 11, 15), dt.date(2026, 11, 20)}
V3 = os.environ.get('SIM_V3') == '1'   # simulação 3.0: três empresas (sem, com, mais), multas com prazo/NIC, desvio de diesel
V2 = os.environ.get('SIM_V2') == '1' or V3   # simulação 2.0: diesel, multas no app, alerta ao vivo, janelas
# empresas simuladas: 'com' e 'mais' usam o app ('mais' com as novidades da 3.0), 'sem' não; padrão = a 2.0
GRUPOS = tuple(x.strip() for x in os.environ.get('GRUPOS', 'com,sem').split(',') if x.strip())
if 'mais' in GRUPOS and not V3: sys.exit("o grupo 'mais' só existe na simulação 3.0 (SIM_V3=1)")
FROTA_PLANO = os.environ.get('SIM_FROTA_PLANO', '1' if V3 else '0') == '1'   # 3.0: viagem na frota com rota e plano da API


def usa_app(g):
    """A empresa usa o BrasaWay ('com' como na 2.0, 'mais' com as novidades da 3.0)."""
    return g in ('com', 'mais')

PARAMS = {
    'diesel_rs_l': 6.20,
    'km_por_litro': {'utilitario': 8.0, 'vuc': 6.0, 'toco': 4.5, 'truck': 3.5, 'carreta_5e': 2.4, 'carreta_6e': 2.2,
                     'romeu_julieta': 2.0, 'bitrem': 1.9, 'rodotrem': 1.7},
    'carga_t': {'utilitario': 1.5, 'vuc': 3.5, 'toco': 6, 'truck': 12, 'carreta_5e': 27, 'carreta_6e': 32,
                'romeu_julieta': 36, 'bitrem': 37, 'rodotrem': 48},
    'custo_hora_motorista': 40.0,
    'multa': {'media': (130.16, 4), 'grave': (195.23, 5), 'gravissima': (293.47, 7)},
    # probabilidade de autuação por passagem irregular (câmera/agente); premissa
    'p_autuacao': {'zone': 0.40, 'ver': 0.35, 'restricoes_rmsp': 0.12, 'rodovias_horario': 0.20,
                   'rodovias_estaduais': 0.15, 'perigosos': 0.25, 'report': 0.05, 'outro': 0.08},
    'p_colisao_altura': 0.04,           # ao chegar num gabarito menor que o caminhão: 96% vê e volta, 4% bate
    'retorno_km': 10, 'retorno_min': 45,
    'colisao_rs': 30000, 'colisao_dias_parado': 3,
    'atraso_tolerancia_min': 30, 'atraso_rs': 150,
    'planejamento_min_viagem': {'com': 3, 'sem': 12},   # tempo do roteirista por viagem
    'custo_hora_roteirista': 35.0,
    'mensalidade_veiculo': 30.0,
    'treinamento_rs': 250, 'recurso_rs': 60, 'p_recurso_ok': 0.15,
    'aviso_multa_dias': 21,             # a notificação de autuação chega ~3 semanas depois
    'frete_rs_km': 5.0,                 # receita perdida quando uma linha é suspensa
    # 2.0
    'tanque_l': {'utilitario': 70, 'vuc': 150, 'toco': 275, 'truck': 300, 'carreta_5e': 600, 'carreta_6e': 600, 'romeu_julieta': 700, 'bitrem': 900, 'rodotrem': 1000},
    'preco_diesel_padrao': 7.20,        # quando a rota não tem posto com preço da ANP
    'habito_preco': {'posto_de_costume': 0.0, 'mais_barato_que_conhece': -0.015, 'cartao_da_empresa': -0.01, 'onde_tiver_vaga': 0.015},
    'abastece_abaixo_pct': 0.25, 'enche_ate_pct': 0.9,
    'p_alerta_ao_vivo_evita': 0.5,      # motorista fora da rota que recebe o alerta ao vivo e volta (premissa)
    'p_multa_presencial': 0.3,          # parte das autuações feita por agente na hora (o motorista sabe na hora)
    'p_cliente_aceita_janela': 0.6,     # cliente aceita mudar a janela quando a empresa pede
}

# 3.0: modelo novo, igual para as três empresas (só entra em PARAMS com SIM_V3, para a 2.0 ficar idêntica)
PARAMS3 = {
    # P1 adesão ao posto do plano (premissa): seguindo a rota do app, compra no posto do plano com esta probabilidade;
    # senão compra no posto de costume (preço médio da rota × (1 + ajuste do hábito), como quem ignora o app)
    'adesao_posto': {'mais_barato_que_conhece': 0.90, 'cartao_da_empresa': 0.90, 'outros': 0.75},
    # P2 desvio de diesel (premissa): N personas sorteadas pelo id (sorteio fixo, sem olhar o perfil: as equipes leem as
    # personas, e escolher pela tolerância a risco deixava A e B acharem quem desvia sem a conferência do diesel) cobram
    # X% a mais de litros do que põem no tanque, em todo abastecimento, até serem paradas (os mesmos gêmeos nas três).
    # O painel só aponta consumo acima da tolerância (conciliacao_tolerancia_pct, a padrão da API): com X igual a ela, só
    # o desviador que já gasta mais que o consumo de referência passa dela, e o motorista honesto que gasta mais também
    # é apontado (o relatório final mostra quantos de cada)
    'desviadores_n': 4,
    'desvio_pct': 0.08,
    # P3 notificação pelo correio, sem SNE (premissa): chega aviso_multa_dias depois da infração; uma parte atrasa e uma
    # parte se perde (sem notificação não há indicação: vira NIC). Com SNE chega em aviso_multa_dias, sem atraso nem perda.
    'p_notificacao_atrasa': 0.10, 'notificacao_atraso_dias': 15,
    'p_notificacao_perdida': 0.03,
    # P4 NIC (premissa): prazo de indicação = chegada da notificação + 30 dias; sem indicação até o prazo a empresa paga
    # a NIC = valor × n (n = multas da empresa com a mesma restrição nos 365 dias anteriores, contando ela)
    'prazo_indicacao_dias': 30,
    'nic_janela_dias': 365,
    # P5 pagamento (premissa): tudo pago no prazo com 20% de desconto; empresa com SNE paga 60% das que não recorreu
    'pagamento_no_prazo': 0.80,
    'pagamento_sne': 0.60,
    'vencimento_dias': 30,              # vencimento registrado na frota = notificação + 30 dias
    # F3 (premissa): na 'mais' o sistema indica o condutor sozinho até N dias depois da notificação
    'indicacao_automatica_dias': 2,
    # ação cobrar_abastecimento (premissa): a cobrança pelo nome é uma conversa do gerente com o motorista, no máximo
    # max_semana por semana em cada empresa (sem limite, listar os 100 dava a todos o efeito da cobrança nominal)
    'cobrar_nomeado': {'adesao_posto_mais': 0.15, 'adesao_posto_max': 0.98, 'p_para_desvio': 0.70, 'max_semana': 5},
    'cobrar_todos': {'adesao_posto_mais': 0.03, 'p_para_desvio': 0.20},
    # F1 (premissa): trecho bloqueado pela empresa = a frota inteira foi orientada sobre ele (vale para quem ignora a rota)
    'conhece_bloqueado': 0.75,
    # (premissa) motorista orientado sobre um trecho "sem alternativa" da rota do app desvia por conta própria com
    # probabilidade orientação × (1 − 0,3 × risco), pagando o desvio de cabeça da 2.0 (5% a mais de km e 10 min)
    'desvio_de_cabeca': {'km_pct': 0.05, 'min': 10},
    # conferência do diesel: janela pedida ao painel (dias) e tolerância (% acima do esperado que vira alerta; a da API)
    'conciliacao_dias': 7,
    'conciliacao_tolerancia_pct': 8,
}
if V3: PARAMS.update(PARAMS3)

rnd_lock = threading.Lock()


# ------------------------------------------------------------------ util HTTP
def post(url, body, token=None, timeout=180):
    h = {'content-type': 'application/json'}
    if token: h['authorization'] = 'Bearer ' + token
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'null')
        except Exception: return e.code, None


def call(method, path, token, body=None, timeout=60, base=None):
    h = {'authorization': 'Bearer ' + token}
    data = None
    if body is not None:
        h['content-type'] = 'application/json'; data = json.dumps(body).encode()
    req = urllib.request.Request((base or API) + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b'null')
        except Exception: return e.code, None


def jwt(sub, role='authenticated', ttl=7 * 86400):
    b = lambda x: base64.urlsafe_b64encode(json.dumps(x, separators=(',', ':')).encode()).rstrip(b'=')
    now = int(time.time())
    h, p = b({'alg': 'HS256', 'typ': 'JWT'}), b({'sub': sub, 'role': role, 'iat': now, 'exp': now + ttl})
    s = base64.urlsafe_b64encode(hmac.new(JWT_SECRET.encode(), h + b'.' + p, hashlib.sha256).digest()).rstrip(b'=')
    return (h + b'.' + p + b'.' + s).decode()


def decode6(s):
    i = lat = lon = 0; out = []
    while i < len(s):
        for k in (0, 1):
            sh = res = 0
            while True:
                b = ord(s[i]) - 63; i += 1; res |= (b & 0x1f) << sh; sh += 5
                if b < 0x20: break
            d = ~(res >> 1) if res & 1 else res >> 1
            if k == 0: lat += d
            else: lon += d
        out.append([lon / 1e6, lat / 1e6])
    return out


def load(p, default=None):
    p = Path(p)
    return json.loads(p.read_text()) if p.exists() else default


def save(p, obj):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix('.tmp'); tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1)); tmp.replace(p)


# ------------------------------------------------------------------ rotas (com cache em disco)
LOCAIS = {l['id']: l for l in json.loads((ROOT / 'locais.json').read_text())['locais']}
CACHE_P = OUT / 'cache_rotas.json'
CACHE = load(CACHE_P, {})
cache_lock = threading.Lock()


def chave(o, d, preset, hazmat, data, hora, aetc=False):
    dia = 'F' if data in FERIADOS else str(data.isoweekday())
    return f'{o}|{d}|{preset}|{int(bool(hazmat))}|{dia}|{hora:02d}' + ('|aetc' if aetc else '')


CODIGOS_RESTRITO = ('uses_restricted_way', 'uses_company_blocked_way')


def rota_legal(o, d, preset, hazmat, data, hora, aetc=False, bloq=None):
    """Rota legal do BrasaWay. 3.0: `bloq` = trechos bloqueados pela empresa ({'item_ids': [...]}, só na 'mais'); a rota
    só é refeita com eles se a rota sem bloqueio passa por algum (aumentar o custo de um trecho que a rota não usa não
    muda a rota), e aí a chave do cache leva o hash dos bloqueios."""
    if bloq:
        base = rota_legal(o, d, preset, hazmat, data, hora, aetc)
        if not base.get('ok') or not (ids_trecho(x['id'] for x in base.get('restrito') or []) & ids_trecho(bloq['item_ids'])):
            return base
    k = ('L3|' if V3 else 'L|') + chave(o, d, preset, hazmat, data, hora, aetc) + (f'|b{hash_bloq(bloq)}' if bloq else '')
    with cache_lock:
        if k in CACHE: return CACHE[k]
    a, b = LOCAIS[o], LOCAIS[d]
    body = {'origin': {'lat': a['lat'], 'lon': a['lon']}, 'destination': {'lat': b['lat'], 'lon': b['lon']},
            'vehicle': {'preset': preset, **({'hazmat': True} if hazmat else {}), **({'has_aetc': True} if aetc else {})},
            'departure_at': f'{data.isoformat()}T{hora:02d}:00', **({'bloqueios': bloq} if bloq else {})}
    st, r = post(api_rota() + '/api/route', body)
    if st == 200:
        warns = r.get('warnings') or []
        res = {'ok': True, 'km': r['distance_km'], 'seg': r['duration_s'],
               'evitou': [item_min(x) for x in r.get('avoided') or []],
               'zona_destino': [w.get('message', '') for w in warns if w.get('code') in ('destination_in_zone', 'origin_in_zone', 'origin_and_destination_in_zone')],
               'restrito_sem_alternativa': [w.get('message', '') for w in warns if w.get('code') == 'uses_restricted_way'],
               'avisos': len(warns),
               'avisos_risco': sum(1 for w in warns if w.get('layer') in ('acidentes', 'roubo_carga')),
               'pedagio': ((r.get('layers') or {}).get('pedagio') or {}).get('data'),
               'descanso': len(r.get('rest_stops') or []),
               'geom': simplificar(r['geometry']['coordinates'], 25)}
        if V3:
            # trecho restrito sem alternativa (ou bloqueado pela empresa sem desvio possível) com o id real do item: a
            # mesma chave dos itens cruzados pelo GPS (a 2.0 cortava a mensagem e ruas diferentes caíam na mesma chave)
            res['restrito'] = [aviso_restrito(w) for w in warns if w.get('code') in CODIGOS_RESTRITO]
            # geometria que preserva o comprimento: os pings da frota dão o km que a API usa (25 pontos davam ~89%)
            res['geom'] = simplificar_rdp(r['geometry']['coordinates'], 200)
            if bloq:
                agora = ids_trecho(x['id'] for x in res['restrito'])
                res['km_sem_bloqueio'] = base['km']; res['seg_sem_bloqueio'] = base['seg']
                res['bloqueios_evitados'] = sorted((ids_trecho(x['id'] for x in base.get('restrito') or []) & ids_trecho(bloq['item_ids'])) - agora)
    elif st == 409:
        res = {'ok': False, 'motivo': (r or {}).get('message', 'sem rota')}
    else:
        raise RuntimeError(f'/api/route {st}: {str(r)[:200]}')
    with cache_lock: CACHE[k] = res
    return res


def rota_gps_carro(o, d, preset, hazmat, data, hora, aetc=False, bloq=None):
    """Rota de GPS de carro conferida contra as restrições. 3.0: com `bloq` (só na 'mais') a conferência marca os itens
    bloqueados pela empresa; só é refeita se a rota cruza algum deles."""
    if bloq:
        base = rota_gps_carro(o, d, preset, hazmat, data, hora, aetc)
        if not (ids_trecho(id_do_item(x['k']) for x in base['cruza']) & ids_trecho(bloq['item_ids'])):
            return base
    k = ('G3|' if V3 else 'G|') + chave(o, d, preset, hazmat, data, hora, aetc) + (f'|b{hash_bloq(bloq)}' if bloq else '')
    with cache_lock:
        if k in CACHE: return CACHE[k]
    a, b = LOCAIS[o], LOCAIS[d]
    st, v = post(VALHALLA + '/route', {'locations': [{'lat': a['lat'], 'lon': a['lon']}, {'lat': b['lat'], 'lon': b['lon']}],
                                       'costing': 'auto', 'units': 'km'})
    if st != 200: raise RuntimeError(f'valhalla auto {st}: {str(v)[:200]}')
    shape = decode6(v['trip']['legs'][0]['shape'])
    body = {'origin': {'lat': a['lat'], 'lon': a['lon']}, 'destination': {'lat': b['lat'], 'lon': b['lon']},
            'vehicle': {'preset': preset, **({'hazmat': True} if hazmat else {}), **({'has_aetc': True} if aetc else {})},
            'departure_at': f'{data.isoformat()}T{hora:02d}:00', 'coordinates': shape, **({'bloqueios': bloq} if bloq else {})}
    st, e = post(api_rota() + '/api/sim/avaliar', body)
    if st != 200: raise RuntimeError(f'/api/sim/avaliar {st}: {str(e)[:200]}')
    res = {'km': v['trip']['summary']['length'], 'seg_carro': v['trip']['summary']['time'],
           'cruza': [item_min(x) for x in e['crossed']],
           'zona_destino': [w.get('message', '') for w in e.get('endpoint_warnings') or []]}
    if V3:
        for it, x in zip(res['cruza'], e['crossed']):
            if x.get('bloqueado_empresa'): it['bloqueado_empresa'] = True
        res['geom'] = simplificar_rdp(shape, 200)        # pings de quem ignora a rota do app (km da frota)
    with cache_lock: CACHE[k] = res
    return res


CONVENIOS = {'com': []}       # postos com desconto no PIX fechados pela empresa com o app (preenchido pelo estado)
BLOQ = {}                     # 3.0: trechos bloqueados ativos de cada empresa ({'item_ids': [...]}; só a 'mais' bloqueia)


def hash_bloq(bloq):
    return hashlib.md5(json.dumps(sorted(bloq['item_ids'])).encode()).hexdigest()[:8]


def bloqueios_de(G):
    """{'item_ids': [...]} dos trechos bloqueados ativos da empresa (None sem nenhum), no formato do pedido de rota."""
    ids = sorted({id_trecho(b['item_id']) or b['item_id'] for b in G.get('bloqueios') or []})
    return {'item_ids': ids} if ids else None


def id_do_item(k):
    """id do item na API a partir da chave 'kind:layer:id' (o id pode ter ':')."""
    p = k.split(':', 2)
    return p[2] if len(p) == 3 else k


def id_trecho(i):
    """id do trecho sem os sufixos que o id ganha numa rota (`~n`, `#k`): a mesma conta de idDoTrecho na API, que compara
    os bloqueios assim (outro pedaço de um trecho bloqueado também é bloqueado)."""
    return re.sub(r'(?:[~#]\d+)+$', '', str(i or ''))


def ids_trecho(ids):
    return {id_trecho(i) for i in ids if i} - {''}


def aviso_restrito(w):
    """Aviso uses_restricted_way / uses_company_blocked_way no formato dos itens cruzados (chave 'layer:<camada>:<id>')."""
    msg = w.get('message', '')
    # "A rota passa por trecho ...: <item>. Confira a regra antes de seguir. <quando libera>" → <item>
    nome = w.get('name') or (re.split(r'\. (?:Confira|Fale com)', msg.split(': ', 1)[1])[0] if ': ' in msg else msg)
    k = f"layer:{w.get('layer') or ''}:{w['id']}" if w.get('id') else 'sem_alt:' + nome[:120]
    return {'k': k, 'id': w.get('id'), 'kind': 'layer', 'layer': w.get('layer'), 'name': nome[:200],
            'bloqueado_empresa': w.get('code') == 'uses_company_blocked_way'}


def _conv(g):
    # 2.0: o plano é sempre o da empresa com o app; 3.0: cada empresa com os seus convênios (a 'sem' não tem nenhum)
    return CONVENIOS.get(g if V3 else 'com') or []


def _cv(conv):
    return hashlib.md5(json.dumps(sorted((c['cnpj'], c['desconto_rs_l']) for c in conv)).encode()).hexdigest()[:8] if conv else '0'


def _restritos_plano(o, d, preset, hazmat, aetc, r):
    """3.0: guarda os trechos restritos que a rota do plano (terça 10h, sem bloqueio) usa; decide se o bloqueio a muda.
    Sem rota (r None), nenhum: o bloqueio não muda o que não existe (e a falha não é refeita a cada viagem)."""
    if not V3: return
    ids = [w.get('id') for w in r.get('warnings') or [] if w.get('code') in CODIGOS_RESTRITO] if isinstance(r, dict) else []
    with cache_lock: CACHE[f'PR|{o}|{d}|{preset}|{int(bool(hazmat))}|{int(bool(aetc))}'] = ids


def _bloq_plano(o, d, preset, hazmat, aetc, g):
    """3.0 (mais): os bloqueios só entram no plano se a rota dele (sem bloqueio) passa por algum trecho bloqueado."""
    b = BLOQ.get(g) if V3 else None
    if not b: return None
    kpr = f'PR|{o}|{d}|{preset}|{int(bool(hazmat))}|{int(bool(aetc))}'
    with cache_lock: usados = CACHE.get(kpr)
    if usados is None:
        planos_linha(o, d, preset, hazmat, aetc, g, _sem_bloqueio=True)
        with cache_lock: usados = CACHE.get(kpr)
    return b if ids_trecho(usados or []) & ids_trecho(b['item_ids']) else None


def plano_abast(o, d, preset, hazmat, data, hora, aetc, nivel_pct, g='com'):
    """Plano de abastecimento do BrasaWay para a linha, saindo com nivel_pct (em faixas de 10%). Também traz o preço médio
    dos postos com preço a até 2 km da rota, que é o que paga quem abastece em qualquer posto do caminho."""
    faixa = min(FAIXAS, key=lambda f: abs(f - nivel_pct))
    # preço de posto não muda com a hora: o plano vale por linha, caminhão e faixa de nível (bem menos cálculo)
    data, hora = dt.date(2026, 11, 3), 10
    conv = _conv(g)
    cv = _cv(conv)
    bl = _bloq_plano(o, d, preset, hazmat, aetc, g)
    k = f'P2|{o}|{d}|{preset}|{int(bool(hazmat))}|{int(bool(aetc))}|{faixa}|{cv}' + (f'|b{hash_bloq(bl)}' if bl else '')
    with cache_lock:
        if k in CACHE: return CACHE[k]
    a, b = LOCAIS[o], LOCAIS[d]
    body = {'origin': {'lat': a['lat'], 'lon': a['lon']}, 'destination': {'lat': b['lat'], 'lon': b['lon']},
            'vehicle': {'preset': preset, **({'hazmat': True} if hazmat else {}), **({'has_aetc': True} if aetc else {})},
            'departure_at': f'{data.isoformat()}T{hora:02d}:00',
            'abastecimento': {'nivel_pct': faixa, 'tanque_l': PARAMS['tanque_l'][preset], 'consumo_km_l': PARAMS['km_por_litro'][preset],
                              'conveniados': [{'cnpj': c['cnpj'], 'desconto_rs_l': c['desconto_rs_l'], 'pagamento': 'PIX'} for c in conv]},
            **({'bloqueios': bl} if bl else {})}
    st, r = post(api_rota() + '/api/route', body)
    if not bl: _restritos_plano(o, d, preset, hazmat, aetc, r if st == 200 else None)
    pl = (r or {}).get('plano_abastecimento') if st == 200 else None
    res = {'litros': pl['litros'], 'custo': pl['custo_rs'], 'media': pl['preco_medio_rota_rs_l'], 'paradas': len(pl['paradas']),
           'chega_com_l': pl['chega_com_l'],
           'postos': [[x['cnpj'], x['posto'][:60], x['litros'], x['preco_rs_l'], x['origem_preco']] for x in pl['paradas']]} if pl else \
          {'litros': 0, 'custo': 0, 'media': None, 'paradas': 0, 'chega_com_l': None, 'postos': []}
    with cache_lock: CACHE[k] = res
    return res


FAIXAS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95]


def planos_linha(o, d, preset, hazmat, aetc, g='com', _sem_bloqueio=False):
    """Planos de todas as faixas de nível de uma linha numa só rota (abastecimento.niveis_pct): 11× menos cálculo de rota."""
    conv = _conv(g)
    cv = _cv(conv)
    bl = None if _sem_bloqueio else _bloq_plano(o, d, preset, hazmat, aetc, g)
    sfx = f'|b{hash_bloq(bl)}' if bl else ''
    chaves = {f: f'P2|{o}|{d}|{preset}|{int(bool(hazmat))}|{int(bool(aetc))}|{f}|{cv}{sfx}' for f in FAIXAS}
    kpr = f'PR|{o}|{d}|{preset}|{int(bool(hazmat))}|{int(bool(aetc))}'
    with cache_lock:
        # 3.0: sem bloqueio, também precisa dos trechos restritos da rota do plano (PR) para decidir os bloqueios
        if all(k in CACHE for k in chaves.values()) and (not V3 or bl or kpr in CACHE): return
    a, b = LOCAIS[o], LOCAIS[d]
    body = {'origin': {'lat': a['lat'], 'lon': a['lon']}, 'destination': {'lat': b['lat'], 'lon': b['lon']},
            'vehicle': {'preset': preset, **({'hazmat': True} if hazmat else {}), **({'has_aetc': True} if aetc else {})},
            'departure_at': '2026-11-03T10:00',
            'abastecimento': {'niveis_pct': FAIXAS, 'tanque_l': PARAMS['tanque_l'][preset], 'consumo_km_l': PARAMS['km_por_litro'][preset],
                              'conveniados': [{'cnpj': c['cnpj'], 'desconto_rs_l': c['desconto_rs_l'], 'pagamento': 'PIX'} for c in conv]},
            **({'bloqueios': bl} if bl else {})}
    st, r = post(api_rota() + '/api/route', body)
    if not bl: _restritos_plano(o, d, preset, hazmat, aetc, r if st == 200 else None)
    planos = (r or {}).get('planos_abastecimento') if st == 200 else None
    if not planos: return
    with cache_lock:
        for pl in planos:
            CACHE[chaves[int(pl['nivel_pct'])]] = {'litros': pl['litros'], 'custo': pl['custo_rs'], 'media': pl['preco_medio_rota_rs_l'],
                'paradas': len(pl['paradas']), 'chega_com_l': pl['chega_com_l'],
                'postos': [[x['cnpj'], x['posto'][:60], x['litros'], x['preco_rs_l'], x['origem_preco']] for x in pl['paradas']]}


def abastecer(g, m, ev, km, segue_app, o, d, preset, hz, data, hora, rng):
    """Combustível da viagem (2.0). Com o app e seguindo a rota: compra o que o plano manda, ao preço do plano. Senão
    (empresa sem app, ou motorista que ignorou o app): ao cair abaixo de 25% do tanque, enche até 90% no posto de
    costume, ao preço médio dos postos da rota ajustado pelo hábito dele.
    3.0: quem segue a rota do app só compra no posto do plano com probabilidade adesao_posto (P1); senão compra a mesma
    quantidade no posto de costume. O desviador (P2) cobra desvio_pct a mais de litros do que põe no tanque."""
    tanque = PARAMS['tanque_l'][preset]
    cons = PARAMS['km_por_litro'][preset] / float(m.get('fator_consumo', 1.0))
    usa = km / cons
    nivel = m.setdefault('nivel_l', tanque * 0.6)
    if V3: ev['nivel_saida_l'] = round(nivel, 1)
    pl = plano_abast(o, d, preset, hz, data, hora, bool(m.get('aetc')), 100 * nivel / tanque, g)
    media = pl['media'] or PARAMS['preco_diesel_padrao']
    preco_costume = media * (1 + PARAMS['habito_preco'].get(m.get('habito', 'posto_de_costume'), 0.0))
    comprado = 0.0; gasto = 0.0
    compras = []          # 3.0: [litros no tanque, preço, cnpj, posto, tipo] de cada compra (frota e desvio)
    pelo_plano = usa_app(g) and segue_app and pl['litros']
    if pelo_plano and V3:
        # P1: sorteio próprio da viagem (o mesmo para os gêmeos), fora da sequência da viagem
        r_posto = random.Random(f"{ev['motorista']}|{data}|{hora}|{o}|{d}|posto")
        pelo_plano = r_posto.random() < m.get('adesao_posto', 1.0)
        if not pelo_plano:
            comprado = min(pl['litros'], max(0.0, tanque - nivel + usa)); gasto = comprado * preco_costume
            nivel = min(tanque, nivel + comprado - usa)
            compras.append([comprado, preco_costume, None, None, 'fora_do_plano'])
            ev['fora_do_plano'] = True
    if pelo_plano:
        # o plano é da faixa de nível mais próxima: compra só o que cabe no tanque ao longo da viagem (o consumo libera espaço)
        comprado = min(pl['litros'], max(0.0, tanque - nivel + usa)); gasto = pl['custo'] * comprado / pl['litros']
        nivel = min(tanque, nivel + comprado - usa)
        uso = m.setdefault('_uso_postos', {})
        for cnpj, nome, litros, preco, origem in pl.get('postos') or []:
            f_ = comprado / pl['litros'] if pl['litros'] else 0
            u = uso.setdefault(cnpj, [nome, 0.0, 0.0]); u[1] += litros * f_; u[2] += litros * f_ * preco
            if V3 and litros * f_ > 0: compras.append([litros * f_, preco, cnpj, nome, 'plano'])
        if V3 and not compras and comprado > 0: compras.append([comprado, gasto / comprado, None, None, 'plano'])
    elif not (V3 and compras):
        nivel -= usa
    # quem segue o app abastece pelo plano da próxima viagem; só cai no posto de costume numa emergência (abaixo de 10%)
    limite = 0.10 if (usa_app(g) and segue_app and pl['media'] is not None) else PARAMS['abastece_abaixo_pct']
    if nivel < tanque * limite:
        litros = tanque * PARAMS['enche_ate_pct'] - max(nivel, 0)
        preco = preco_costume
        comprado += litros; gasto += litros * preco
        nivel = tanque * PARAMS['enche_ate_pct']
        if V3: compras.append([litros, preco, None, None, 'emergencia' if limite < PARAMS['abastece_abaixo_pct'] else 'costume'])
    m['nivel_l'] = max(0.0, nivel)
    ev['diesel_consumido_l'] = round(usa, 1); ev['diesel_comprado_l'] = round(comprado, 1); ev['diesel_gasto_rs'] = round(gasto, 2)
    ev['preco_medio_rota'] = media
    if V3:
        if pl['litros']: ev['preco_plano'] = round(pl['custo'] / pl['litros'], 3)     # sobrepreço de quem comprou fora do plano
        # P2: o desviador cobra a mais do que pôs no tanque; a empresa paga (e vê) os litros cobrados
        fator = 1 + PARAMS['desvio_pct'] if m.get('desvia') else 1.0
        cobr = [[round(c[0] * fator, 1), round(c[1], 3), c[2], (c[3] or '')[:60] or None, c[4]] for c in compras]
        ev['compras'] = cobr
        ev['diesel_no_tanque_l'] = round(sum(c[0] for c in compras), 1)
        ev['diesel_comprado_l'] = round(sum(c[0] for c in cobr), 1)
        ev['diesel_gasto_rs'] = round(sum(c[0] * c[1] for c in cobr), 2)
        ev['diesel_desviado_l'] = round(ev['diesel_comprado_l'] - ev['diesel_no_tanque_l'], 1)
        ev['diesel_desviado_rs'] = round(sum((c[0] * (fator - 1)) * c[1] for c in compras), 2)


def item_min(x):
    return {'k': f"{x.get('kind')}:{x.get('layer') or ''}:{x.get('id')}", 'kind': x.get('kind'), 'layer': x.get('layer'),
            'type': x.get('type'), 'name': x.get('name'), 'rule': x.get('rule'), 'value_num': x.get('value_num')}


def simplificar(coords, n):
    if len(coords) <= n: return coords
    passo = (len(coords) - 1) / (n - 1)
    return [coords[round(i * passo)] for i in range(n)]


def _rdp(p, tol):
    """Douglas-Peucker iterativo em metros (p já projetado); devolve os índices mantidos."""
    manter = [False] * len(p); manter[0] = manter[-1] = True
    pilha = [(0, len(p) - 1)]
    while pilha:
        a, b = pilha.pop()
        ax, ay = p[a]; dx, dy = p[b][0] - ax, p[b][1] - ay; l2 = dx * dx + dy * dy
        dmax, imax = -1.0, -1
        for i in range(a + 1, b):
            px, py = p[i][0] - ax, p[i][1] - ay
            t = 0.0 if l2 == 0 else max(0.0, min(1.0, (px * dx + py * dy) / l2))
            dist = math.hypot(px - t * dx, py - t * dy)
            if dist > dmax: dmax, imax = dist, i
        if dmax > tol:
            manter[imax] = True; pilha += [(a, imax), (imax, b)]
    return [i for i, x in enumerate(manter) if x]


def simplificar_rdp(coords, n, tol_m=10.0):
    """Até n pontos preservando o comprimento da linha (Douglas-Peucker com tolerância crescente). A amostra uniforme de
    25 pontos encurtava a rota ~11% e o km das viagens na frota (pings) ficava abaixo do rodado."""
    if len(coords) <= n: return [[round(x, 5), round(y, 5)] for x, y in coords]
    if len(coords) > 8000: coords = simplificar(coords, 8000)        # rotas longas: 8 mil pontos já cobrem as curvas
    kx = 111320 * math.cos(math.radians(coords[0][1])); ky = 110540
    p = [(x * kx, y * ky) for x, y in coords]
    while True:
        idx = _rdp(p, tol_m)
        if len(idx) <= n: return [[round(coords[i][0], 5), round(coords[i][1], 5)] for i in idx]
        tol_m *= 1.7


def categoria(item):
    """Como a infração se manifesta: 'fisica_altura' / 'fisica_peso' (o caminhão não cabe) ou 'circulacao'."""
    t = ' '.join(str(item.get(x) or '') for x in ('type', 'name', 'rule', 'layer')).lower()
    if item.get('layer') in ('altura_osm', 'oae', 'placas_restricao') or 'altura' in t or 'gabarito' in t or 'height' in t:
        return 'fisica_altura'
    if item.get('layer') == 'federal_restricoes' or 'peso' in t or 'pbt' in t or 'weight' in t:
        return 'fisica_peso' if 'peso' in t or 'pbt' in t else 'fisica_altura'
    return 'circulacao'


def p_autuacao(item):
    pa = PARAMS['p_autuacao']
    if item.get('kind') == 'zone': return pa['zone']
    if item.get('kind') == 'report': return pa['report']
    return pa.get(item.get('layer') or '', pa['outro'])


# ------------------------------------------------------------------ estado
def estado_inicial(personas):
    st = {'dia_atual': 0, 'grupos': {}}
    desv = set(desviadores(personas)) if V3 else set()
    for g in GRUPOS:
        mot = {}
        for p in personas:
            mot[p['id']] = {
                'veiculo': p['veiculo'], 'hazmat': bool(p.get('carga_perigosa')),
                'linhas': [dict(l, ativa=True) for l in p['linhas']],
                'conhece': {},                                   # item -> 0..1 aprendido
                'regional': p.get('conhecimento_regional') or {},
                'risco': float(p.get('tolerancia_risco', 0.3)),
                'adesao': float(p.get('adesao_app', 0.8)) if usa_app(g) else 0.0,
                'pontos': [], 'parado_ate': None, 'treinado': 0.0,
                # 2.0: combustível (gêmeos começam iguais)
                'fator_consumo': float(p.get('fator_consumo') or (1.0 + (int(hashlib.md5(p['id'].encode()).hexdigest(), 16) % 17 - 8) / 100)),
                'habito': p.get('habito_abastecimento') or ('cartao_da_empresa' if p.get('vinculo') == 'clt' else 'posto_de_costume'),
                'nivel_l': PARAMS['tanque_l'][p['veiculo']] * (0.4 + (int(hashlib.md5(('n' + p['id']).encode()).hexdigest(), 16) % 41) / 100),
            }
            if V3:
                mm = mot[p['id']]
                mm['adesao_posto'] = adesao_posto_inicial(mm['habito'])             # P1
                mm['desvia'] = p['id'] in desv                                      # P2 (o mesmo gêmeo nas três)
                mm['orientado'] = {}                                                # item -> orientação da equipe
                mm['odometro_km'] = 80000 + int(hashlib.md5(('o' + p['id']).encode()).hexdigest(), 16) % 400000
        st['grupos'][g] = {'motoristas': mot, 'eventos': [], 'custos_extra': [], 'mensagens': [], 'decisoes_aplicadas': []}
        if V3: st['grupos'][g].update({'sne_desde': None, 'bloqueios': [], 'conveniados': [], 'desviadores': sorted(desv)})
    return st


# ------------------------------------------------------------------ 3.0: modelo de multas e diesel (funções puras)
def desviadores(personas, n=None):
    """P2: n personas sorteadas pelo id (sorteio fixo, o mesmo em toda execução). Não usa nenhum campo da persona: as
    equipes leem personas.json, e a escolha pela tolerância a risco (ou pelo texto de como reage) entregava os desviadores."""
    n = PARAMS3['desviadores_n'] if n is None else n
    return sorted(p['id'] for p in sorted(personas, key=lambda p: hashlib.md5(('desvio|' + p['id']).encode()).hexdigest())[:n])


def adesao_posto_inicial(habito):
    """P1: chance de comprar no posto do plano seguindo a rota do app."""
    a = PARAMS3['adesao_posto']
    return a.get(habito, a['outros'])


def notificacao(data, presencial, sne, rng):
    """P3: quando chega a notificação da autuação (data = dia da infração). Presencial: o condutor é identificado na hora.
    Pelo correio (sem SNE): aviso_multa_dias depois; uma parte atrasa e uma parte se perde. Com SNE: no prazo, sempre.
    prazo = último dia para indicar o condutor (P4: chegada + 30); perdida → o prazo corre sem a empresa saber (NIC)."""
    p = PARAMS3; base = data + dt.timedelta(days=PARAMS['aviso_multa_dias'])
    u = rng.random()                     # sorteio sempre feito: o mesmo resultado para os gêmeos sem SNE
    if presencial:
        return {'via': 'presencial', 'chegada': data.isoformat(), 'aviso_em': data.isoformat(), 'prazo': None, 'atrasada': False, 'perdida': False}
    if sne:
        chegada, via, atrasada, perdida = base, 'sne', False, False
    elif u < p['p_notificacao_perdida']:
        chegada, via, atrasada, perdida = None, 'correio', False, True
    elif u < p['p_notificacao_perdida'] + p['p_notificacao_atrasa']:
        chegada, via, atrasada, perdida = base + dt.timedelta(days=p['notificacao_atraso_dias']), 'correio', True, False
    else:
        chegada, via, atrasada, perdida = base, 'correio', False, False
    prazo = (chegada or base) + dt.timedelta(days=p['prazo_indicacao_dias'])
    return {'via': via, 'chegada': chegada.isoformat() if chegada else None,
            'aviso_em': chegada.isoformat() if chegada else '9999-12-31',      # perdida: nunca aparece para a equipe
            'prazo': prazo.isoformat(), 'atrasada': atrasada, 'perdida': perdida}


def nic_n(multas, k, data_iso):
    """P4: multas da empresa com a mesma restrição nos 365 dias anteriores, contando ela. multas = [(data_iso, k)]."""
    ini = (dt.date.fromisoformat(data_iso) - dt.timedelta(days=PARAMS3['nic_janela_dias'])).isoformat()
    return sum(1 for d_, k_ in multas if k_ == k and ini < d_ <= data_iso)


def fator_pagamento(sne, recorrida):
    """P5: fração do valor que a empresa paga (no prazo, com desconto; SNE e sem recurso: 40% de desconto)."""
    return PARAMS3['pagamento_sne'] if sne and not recorrida else PARAMS3['pagamento_no_prazo']


def cnpj_costume(pid):
    """CNPJ fictício (prefixo 99) do posto de costume do motorista: fora do plano e da rede conveniada."""
    return '99' + f"{int(hashlib.md5(('posto' + pid).encode()).hexdigest(), 16) % 10**12:012d}"


def notificar_multas(G, ev, m):
    """3.0: aplica P3 às multas da viagem (com o SNE da empresa no dia da infração); presencial já identifica o condutor."""
    data = dt.date.fromisoformat(ev['data'])
    sne = bool(G.get('sne_desde')) and G['sne_desde'] <= ev['data']
    for mu in ev['multas']:
        r = random.Random(f"{ev['motorista']}|{ev['data']}|{ev['hora']}|{mu['k']}|notificacao")
        mu.update(notificacao(data, mu.get('presencial'), sne, r)); mu['sne'] = sne
        if mu.get('presencial'):
            mu['indicada_em'] = ev['data']; mu['indicada_por'] = 'presencial'
            m['pontos'].append({'data': ev['data'], 'pontos': mu['pontos']})


def indicar(G, e, mu, dia_iso, por):
    """Condutor indicado: os pontos vão para o motorista (como na 2.0) e não há NIC."""
    mu['indicada_em'] = dia_iso; mu['indicada_por'] = por
    G['motoristas'][e['motorista']]['pontos'].append({'data': e['data'], 'pontos': mu['pontos']})


def pendente_indicacao(mu):
    return not (mu.get('presencial') or mu.get('indicada_em') or mu.get('nic') or mu.get('situacao') == 'cancelada')


def indicar_automatico(G, ate_iso):
    """F3 (mais): o sistema indica o condutor de toda multa notificada até indicacao_automatica_dias depois da chegada."""
    feitas = []
    for e in G['eventos']:
        for mu in e['multas']:
            if not pendente_indicacao(mu) or not mu.get('chegada'): continue
            dia = (dt.date.fromisoformat(mu['chegada']) + dt.timedelta(days=PARAMS3['indicacao_automatica_dias'])).isoformat()
            if dia <= ate_iso:
                indicar(G, e, mu, dia, 'sistema'); feitas.append(mu)
    return feitas


def processar_prazos(G, hoje_iso, semana):
    """P4: multa sem indicação com o prazo vencido (antes de hoje) vira NIC = valor × n."""
    todas = [(e['data'], mu['k']) for e in G['eventos'] for mu in e['multas'] if mu.get('situacao') != 'cancelada']
    novas = []
    for e in G['eventos']:
        for mu in e['multas']:
            if pendente_indicacao(mu) and mu.get('prazo') and mu['prazo'] < hoje_iso:
                n = nic_n(todas, mu['k'], e['data'])
                mu['nic'] = {'em': mu['prazo'], 'n': n, 'valor': round(mu['valor'] * n, 2), 'semana': semana}
                novas.append((e, mu))
    return novas


def conhecimento(m, item, uf):
    base = float(m['regional'].get(uf, 0.3))
    famoso = 0.25 if item.get('kind') == 'zone' or item.get('layer') == 'ver' else 0.0
    return min(0.97, max(m['conhece'].get(item['k'], 0.0), base * 0.6 + famoso + m['treinado']))


# ------------------------------------------------------------------ uma viagem
def congestionamento(hora, km):
    pico = hora in (6, 7, 8, 9, 16, 17, 18, 19)
    return (1.30 if km < 80 else 1.06) if pico else 1.0


def simular_viagem(g, pid, m, linha, data, hora, rng):
    o, d = linha['origem'], linha['destino']
    uf = LOCAIS[d]['uf']
    preset, hz = m['veiculo'], m['hazmat']
    aetc = bool(m.get('aetc'))
    bq = BLOQ.get(g) if V3 else None          # 3.0: trechos bloqueados pela empresa (só a 'mais' bloqueia)
    legal = rota_legal(o, d, preset, hz, data, hora, aetc, bloq=bq)
    gps = rota_gps_carro(o, d, preset, hz, data, hora, aetc, bloq=bq)
    ev = {'grupo': g, 'motorista': pid, 'data': data.isoformat(), 'hora': hora, 'origem': o, 'destino': d, 'veiculo': preset,
          'multas': [], 'retornos': 0, 'colisoes': 0, 'evitadas_app': 0, 'evitadas_conhecimento': 0, 'violacoes': []}
    segue_app = usa_app(g) and legal.get('ok') and rng.random() < m['adesao']
    if segue_app:
        km, seg = legal['km'], legal['seg']
        ev['rota'] = 'app'; ev['evitadas_app'] = len(legal['evitou'])
        ev['avisos_risco'] = legal['avisos_risco']
        # trechos restritos sem alternativa e entrega dentro de zona: o app avisa, mas a passagem existe
        expostos = [{'k': 'zona_destino:' + d, 'kind': 'zone', 'name': msg[:400], 'layer': None} for msg in legal['zona_destino']]
        if V3:
            # o trecho sem alternativa com o id real (chave igual à do GPS): orientar e bloquear apontam para ele. Quem
            # foi orientado sobre ele pode desviar por conta própria (desvio de cabeça); senão passa
            for it in expostos: it['fonte'] = 'zona_destino'
            ev['evitadas_orientacao'] = 0
            for it in legal.get('restrito') or []:
                p_o = m.get('orientado', {}).get(it['k'], 0.0) * (1 - m['risco'] * 0.3)
                if p_o and random.Random(f"{pid}|{data}|{hora}|{it['k']}|orientado").random() < p_o:
                    ev['evitadas_orientacao'] += 1
                else:
                    expostos.append(dict(it, fonte='restrito_app'))
            if ev['evitadas_orientacao']:
                dc = PARAMS['desvio_de_cabeca']; km += legal['km'] * dc['km_pct']; seg += dc['min'] * 60
            if legal.get('km_sem_bloqueio') is not None:      # a rota desviou de trecho bloqueado pela empresa
                ev['km_desvio_bloqueio'] = round(max(0.0, legal['km'] - legal['km_sem_bloqueio']), 1)
                ev['bloqueios_evitados'] = legal.get('bloqueios_evitados') or []
        else:
            expostos += [{'k': 'sem_alt:' + msg[:60], 'kind': 'layer', 'layer': 'restricoes_rmsp', 'name': msg[:120]} for msg in legal['restrito_sem_alternativa']]
        avisado = True
    else:
        ev['rota'] = 'gps_carro' if not usa_app(g) else 'ignorou_app'
        cruza = gps['cruza']
        expostos = list(cruza) + [{'k': 'zona_destino:' + d, 'kind': 'zone', 'name': msg[:120], 'layer': None} for msg in gps['zona_destino']]
        avisado = usa_app(g)
        nao_evitadas = []
        ev['evitadas_alerta'] = 0
        for it in cruza:
            k = conhecimento(m, it, uf) + (0.2 if avisado else 0.0)
            if V3 and it.get('bloqueado_empresa'): k = max(k, PARAMS['conhece_bloqueado'])   # a frota toda sabe do bloqueio
            if rng.random() < k and rng.random() > m['risco'] * 0.3:
                ev['evitadas_conhecimento'] += 1
            elif V2 and usa_app(g) and rng.random() < PARAMS['p_alerta_ao_vivo_evita']:
                ev['evitadas_alerta'] += 1          # alerta ao vivo: fora da rota, o app apitou antes da restrição e ele voltou
            else:
                nao_evitadas.append(it)
        extremos = expostos[len(cruza):]
        if cruza and not nao_evitadas and legal.get('ok'):
            km, seg = legal['km'] * 1.05, legal['seg'] + 600        # desvio de cabeça: 5% a mais e 10 min
        else:
            km = gps['km']
            vel = (legal['km'] / (legal['seg'] / 3600)) if legal.get('ok') and legal['seg'] else 45.0
            seg = km / max(vel, 15) * 3600
        expostos = nao_evitadas + extremos
    seg *= congestionamento(hora, km)
    # consequências de cada exposição
    for it in expostos:
        cat = categoria(it)
        ev['violacoes'].append({'k': it['k'], 'nome': (it.get('name') or '')[:100], 'cat': cat, 'layer': it.get('layer') or it.get('kind')})
        if V3:     # de onde veio a exposição: trecho sem alternativa da rota do app, zona no destino ou rota fora do app
            ev['violacoes'][-1]['fonte'] = it.get('fonte') or ('zona_destino' if it['k'].startswith('zona_destino') else 'cruzou')
        if cat == 'fisica_altura':
            if rng.random() < PARAMS['p_colisao_altura']:
                ev['colisoes'] += 1
            else:
                ev['retornos'] += 1; km += PARAMS['retorno_km']; seg += PARAMS['retorno_min'] * 60
        else:
            p = p_autuacao(it) * (0.6 if avisado and it['k'].startswith('zona_destino') else 1.0)
            if rng.random() < p:
                grav = 'grave' if cat == 'fisica_peso' or it.get('layer') == 'perigosos' else 'media'
                presencial = V2 and rng.random() < PARAMS['p_multa_presencial']
                ev['multas'].append({'k': it['k'], 'nome': (it.get('name') or '')[:100], 'gravidade': grav,
                                     'valor': PARAMS['multa'][grav][0], 'pontos': PARAMS['multa'][grav][1], 'presencial': presencial,
                                     'mid': hashlib.md5(f"{g}|{pid}|{data}|{hora}|{it['k']}".encode()).hexdigest()[:10],
                                     'aviso_em': (data if presencial else data + dt.timedelta(days=PARAMS['aviso_multa_dias'])).isoformat()})
                if V3: ev['multas'][-1]['fonte'] = ev['violacoes'][-1]['fonte']
        m['conhece'][it['k']] = max(m['conhece'].get(it['k'], 0.0), 0.5 if not ev['multas'] else 0.85)
    ev['km'] = round(km, 1); ev['horas'] = round(seg / 3600, 2)
    chegada = hora + seg / 3600
    jan = linha.get('janela_entrega_ate')
    if jan is not None and jan <= hora: jan += 24          # entrega na madrugada do dia seguinte
    ev['atraso'] = bool(jan is not None and chegada > jan + PARAMS['atraso_tolerancia_min'] / 60)
    ev['custo_diesel'] = round(km / PARAMS['km_por_litro'][preset] * PARAMS['diesel_rs_l'], 2)
    if V2: abastecer(g, m, ev, km, segue_app, o, d, preset, hz, data, hora, rng)
    ev['custo_motorista'] = round(seg / 3600 * PARAMS['custo_hora_motorista'], 2)
    ev['legal_ok'] = bool(legal.get('ok'))
    if V3 and usa_app(g) and not segue_app:
        return ev, gps.get('geom')        # 3.0: quem ignorou a rota também roda com o app aberto (km e diesel na frota)
    return ev, (legal.get('geom') if segue_app else None)


# ------------------------------------------------------------------ Frota (uso real do app pela empresa COM)
class Frota:
    def __init__(self, info):
        self.info = info
        self.gestor = jwt(info['gestor_id'])
        self.tok = {pid: jwt(uid) for pid, uid in info['motoristas'].items()}
        self.slot = {pid: 0 for pid in info['motoristas']}
        self.lock = threading.Lock()
        self.erros = 0
        self.minuto = {pid: 0 for pid in info['motoristas']}     # 3.0: minutos de ping já usados por motorista na semana

    def viagem(self, pid, ev, geom, linha):
        if geom is None: return
        try:
            o, d = LOCAIS[ev['origem']], LOCAIS[ev['destino']]
            st, t = call('POST', '/api/frota/trips', self.gestor, {
                'title': f"{o['nome']} → {d['nome']}", 'vehicle_id': self.info['veiculos'][pid],
                'driver_id': self.info['motoristas'][pid],
                'origin': {'lat': o['lat'], 'lon': o['lon'], 'label': o['nome']},
                'destination': {'lat': d['lat'], 'lon': d['lon'], 'label': d['nome']},
                'deliveries': [{'customer_name': f"Cliente {d['nome']}", 'address': d['nome'], 'lat': d['lat'], 'lon': d['lon']}]})
            if st != 201: self.erros += 1; return
            tid = t['id']; tk = self.tok[pid]
            if call('POST', f'/api/frota/trips/{tid}/start', tk)[0] != 200: self.erros += 1; return
            with self.lock:
                k = self.slot[pid]; self.slot[pid] += 1
            base = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=6) + dt.timedelta(minutes=k * 40)
            pings = [{'lat': c[1], 'lon': c[0], 'speed_kmh': 0 if i in (0, len(geom) - 1) else 55, 'accuracy_m': 8,
                      'recorded_at': (base + dt.timedelta(minutes=i)).isoformat()} for i, c in enumerate(geom)]
            if call('POST', '/api/frota/pings', tk, {'pings': pings, 'trip_id': tid})[0] != 200: self.erros += 1
            st, det = call('GET', f'/api/frota/trips/{tid}', tk)
            for dl in (det or {}).get('deliveries') or []:
                body = {'status': 'entregue'} if not ev['atraso'] else {'status': 'entregue', 'notes': 'chegou fora da janela'}
                call('PATCH', f"/api/frota/deliveries/{dl['id']}", tk, body)
            if call('POST', f'/api/frota/trips/{tid}/end', tk)[0] != 200: self.erros += 1
        except Exception:
            self.erros += 1

    def viagem3(self, pid, ev, geom, linha):
        """3.0: a viagem inteira no app, para o km e o diesel da frota baterem com a simulação: viagem planejada (rota e
        plano de abastecimento da API, saindo com o nível do tanque e o hodômetro), abastecimentos com os litros cobrados
        (inclusive os desviados), posto, viagem e hodômetro, multa presencial, pings que preservam o km, entrega e fim."""
        tid, plano_cnpjs, plano_api, tk = None, [], False, self.tok[pid]
        o, d = LOCAIS[ev['origem']], LOCAIS[ev['destino']]
        try:
            corpo = {'title': f"{o['nome']} → {d['nome']}", 'vehicle_id': self.info['veiculos'][pid], 'driver_id': self.info['motoristas'][pid],
                     'origin': {'lat': o['lat'], 'lon': o['lon'], 'label': o['nome']},
                     'destination': {'lat': d['lat'], 'lon': d['lon'], 'label': d['nome']},
                     'departure_planned_at': f"{ev['data']}T{ev['hora']:02d}:00:00-03:00",
                     'deliveries': [{'customer_name': f"Cliente {d['nome']}", 'address': d['nome'], 'lat': d['lat'], 'lon': d['lon']}]}
            st = 0
            if FROTA_PLANO:     # a rota da viagem é calculada pela API: vai para as instâncias de rota (rodízio)
                st, t = call('POST', '/api/frota/trips', self.gestor, dict(corpo, plan_route=True), timeout=180, base=api_rota())
            if st != 201: st, t = call('POST', '/api/frota/trips', self.gestor, corpo)
            if st == 201:
                tid = t['id']
                ini = {k: v for k, v in (('combustivel_l', ev.get('nivel_saida_l')), ('odometro_km', ev.get('odometro_saida_km'))) if v is not None}
                s2, r2 = call('POST', f'/api/frota/trips/{tid}/start', tk, ini, timeout=120, base=api_rota() if FROTA_PLANO else None)
                if s2 != 200: self.erros += 1
                plano_api = isinstance((r2 or {}).get('plano_abastecimento'), dict) if s2 == 200 else False
                plano_cnpjs = [p.get('cnpj') for p in ((r2 or {}).get('plano_abastecimento') or {}).get('paradas') or [] if p.get('cnpj')]
            else:
                self.erros += 1
        except Exception:
            self.erros += 1
        ev['_enviado_em'] = time.time()
        try:
            self.abastecimentos3(pid, ev, tid, plano_cnpjs, plano_api)
            for mu in ev['multas']:
                if mu.get('presencial') and not mu.get('api_id'): self.multa_motorista(pid, mu, ev, tid)
        except Exception:
            self.erros += 1
        if not tid: return
        try:
            if geom:
                with self.lock:
                    k = self.minuto[pid]; self.minuto[pid] += len(geom) + 10
                base = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=6) + dt.timedelta(minutes=k)
                pings = [{'lat': c[1], 'lon': c[0], 'speed_kmh': 0 if i in (0, len(geom) - 1) else 55, 'accuracy_m': 8,
                          'recorded_at': (base + dt.timedelta(minutes=i)).isoformat()} for i, c in enumerate(geom)]
                if call('POST', '/api/frota/pings', tk, {'pings': pings, 'trip_id': tid})[0] != 200: self.erros += 1
            for dl in t.get('deliveries') or []:
                body = {'status': 'entregue'} if not ev['atraso'] else {'status': 'entregue', 'notes': 'chegou fora da janela'}
                call('PATCH', f"/api/frota/deliveries/{dl['id']}", tk, body)
            if call('POST', f'/api/frota/trips/{tid}/end', tk)[0] != 200: self.erros += 1
        except Exception:
            self.erros += 1

    def abastecimentos3(self, pid, ev, tid, plano_cnpjs, plano_api=False):
        """Cada compra da viagem: litros cobrados (o desviador cobra a mais), valor, posto (a parada do plano da viagem na
        API, ou o posto de costume), viagem e hodômetro (no meio da viagem pelo plano; no fim, enchendo o tanque).
        Plano da API sem parada (o motor planeja pela faixa de nível, na terça às 10h; a API pelo nível e hora exatos) e o
        do motor com parada: a compra vai sem CNPJ, senão o painel a contaria fora do plano sem o motorista ter saído dele."""
        km, odo = ev.get('km', 0), ev.get('odometro_saida_km')
        n_plano = 0
        for litros, preco, cnpj, nome, tipo in ev.get('compras') or []:
            if litros <= 0: continue
            if tipo == 'plano':
                if plano_cnpjs: cnpj = plano_cnpjs[min(n_plano, len(plano_cnpjs) - 1)]
                elif plano_api:
                    cnpj = None; ev['plano_api_sem_parada_l'] = round(ev.get('plano_api_sem_parada_l', 0) + litros, 1)
                n_plano += 1
            else:
                cnpj, nome = cnpj_costume(pid), f'Posto de costume ({pid})'
            corpo = {'litros': min(2999, litros), 'valor_cents': int(round(litros * preco * 100)), 'pagamento': 'cartao_frota',
                     'posto_nome': nome or f"Posto na rota {ev['origem']}→{ev['destino']}"}
            if cnpj: corpo['posto_cnpj'] = cnpj
            if tid: corpo['trip_id'] = tid
            if odo is not None: corpo['odometro_km'] = round(odo + (km / 2 if tipo in ('plano', 'fora_do_plano') else km), 1)
            st, _ = call('POST', '/api/frota/abastecimentos', self.tok[pid], corpo)
            if st != 201: self.erros += 1

    def multa_motorista(self, pid, mu, ev, tid=None):
        """Multa presencial: o motorista registra pelo app na hora."""
        st, r = call('POST', '/api/frota/multas', self.tok[pid], {'ocorrida_em': f"{ev['data']}T{ev['hora']:02d}:30:00-03:00",
            'descricao': f"Fui parado: {mu['nome']}", 'local': LOCAIS[ev['destino']]['nome'], **({'trip_id': tid} if tid else {})})
        if st == 201: mu['api_id'] = r['id']
        else: self.erros += 1

    def multa_equipe(self, mu, ev):
        """Notificação chegou: a equipe completa (ou registra) a multa no painel."""
        corpo = {'status': 'notificada', 'gravidade': 'media' if mu['gravidade'] == 'media' else 'grave', 'valor_cents': int(round(mu['valor'] * 100)),
                 'pontos': mu['pontos'], 'enquadramento': mu['nome'][:200], 'prazo_indicacao': (dt.date.fromisoformat(mu['aviso_em']) + dt.timedelta(days=15)).isoformat()}
        if V3:
            # 3.0: data da notificação, vencimento e prazo de indicação (chegada + 30); presencial: condutor identificado
            corpo.update({'notificada_em': mu['aviso_em'], 'restricao': mu['k'][:300], 'sne': bool(mu.get('sne')),
                          'vencimento': (dt.date.fromisoformat(mu['aviso_em']) + dt.timedelta(days=PARAMS['vencimento_dias'])).isoformat()})
            if mu.get('presencial'): corpo['status'] = 'condutor_indicado'; corpo.pop('prazo_indicacao')
            else:
                corpo['prazo_indicacao'] = mu['prazo']
                # a equipe já indicou (a notificação chegou no dia do relatório, antes do registro no painel): entra indicada
                if mu.get('indicada_em'): corpo['status'] = 'condutor_indicado'
        if mu.get('api_id'):
            st, _ = call('PATCH', f"/api/frota/multas/{mu['api_id']}", self.gestor, corpo)
        else:
            st, r = call('POST', '/api/frota/multas', self.gestor, {**corpo, 'driver_id': self.info['motoristas'][ev['motorista']],
                         'ocorrida_em': f"{ev['data']}T{ev['hora']:02d}:30:00-03:00"})
            if st == 201: mu['api_id'] = r['id']
        if st not in (200, 201): self.erros += 1

    def feedback(self, mu, nota):
        if mu.get('api_id'):
            st, _ = call('PATCH', f"/api/frota/multas/{mu['api_id']}", self.gestor, {'feedback_enviado': True, 'feedback_nota': nota[:500]})
            if st != 200: self.erros += 1

    def abastecimento(self, pid, ev):
        if ev.get('diesel_comprado_l', 0) <= 0: return
        st, _ = call('POST', '/api/frota/abastecimentos', self.tok[pid], {'litros': min(2999, ev['diesel_comprado_l']),
            'valor_cents': int(round(ev['diesel_gasto_rs'] * 100)), 'pagamento': 'cartao_frota', 'posto_nome': f"Posto na rota {ev['origem']}→{ev['destino']}"})
        if st != 201: self.erros += 1

    def mensagem(self, para_pid, texto):
        call('POST', '/api/frota/messages', self.gestor, {'recipient_id': self.info['motoristas'][para_pid], 'body': texto[:3900]})

    # ---- 3.0
    def indicar(self, multas, automatica):
        """Indica o condutor: na 'mais' pelo endpoint novo (o sistema faz sozinho); na 'com', mudando o status da multa."""
        ids = [mu['api_id'] for mu in multas if mu.get('api_id')]
        if not ids: return
        if automatica:
            for i in range(0, len(ids), 100):
                if call('POST', '/api/frota/multas/indicar-condutor', self.gestor, {'ids': ids[i:i + 100]})[0] not in (200, 201): self.erros += 1
        else:
            for x in ids:
                if call('PATCH', f'/api/frota/multas/{x}', self.gestor, {'status': 'condutor_indicado'})[0] != 200: self.erros += 1

    def sne(self, aderida=True):
        if call('PATCH', '/api/frota/empresa/sne', self.gestor, {'aderida': aderida})[0] != 200: self.erros += 1

    def bloquear(self, item_id, nome, motivo):
        st, r = call('POST', '/api/frota/trechos-bloqueados', self.gestor, {'item_id': item_id, 'nome': (nome or item_id)[:200], 'motivo': (motivo or '')[:1000] or None})
        if st == 201: return r.get('id')
        if st != 409: self.erros += 1        # 409: já estava bloqueado na empresa
        return None

    def desbloquear(self, api_id):
        if api_id and call('DELETE', f'/api/frota/trechos-bloqueados/{api_id}', self.gestor)[0] != 200: self.erros += 1

    def veiculo(self, pid, m):
        """trocar_veiculo / cadastrar_aetc: o cadastro do veículo acompanha (rota da viagem e consumo de referência)."""
        p = m['veiculo']
        corpo = {'preset': p, 'is_vuc': p == 'vuc', 'has_aetc': bool(m.get('aetc')), 'hazmat': bool(m.get('hazmat')),
                 'tanque_l': PARAMS['tanque_l'][p], 'consumo_km_l': PARAMS['km_por_litro'][p]}
        if call('PATCH', f"/api/frota/vehicles/{self.info['veiculos'][pid]}", self.gestor, corpo)[0] != 200: self.erros += 1

    def ler(self, path):
        """Leitura do painel (GET com o token da equipe): (status, corpo)."""
        try: return call('GET', path, self.gestor, timeout=120)
        except Exception as e: return 0, {'erro': str(e)[:200]}


# ------------------------------------------------------------------ preparar
# (antes se chamava preparar(), o mesmo nome do aquecimento da semana mais abaixo, que o sobrescrevia: o comando
# `motor.py preparar` quebrava)
def preparar_frota():
    if V3 and not (OUT / 'personas.json').exists() and (ROOT / 'out2' / 'personas.json').exists():
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / 'personas.json').write_text((ROOT / 'out2' / 'personas.json').read_text())     # as mesmas 100 personas da 2.0
    personas = load(OUT / 'personas.json')
    if not personas: sys.exit('falta sim/out/personas.json')
    if V3: return preparar_frota3(personas)
    import subprocess
    sql = ["delete from companies where name like 'SIM %';", "delete from auth.users where email like '%@sim.brasaway.example';"]
    info = {}
    gid = '51700000-0000-4000-a000-000000000001'
    cid = '51700000-0000-4000-b000-000000000001'
    sql += [f"insert into auth.users (id, email) values ('{gid}', 'gestor@sim.brasaway.example');",
            f"insert into companies (id, name, price_per_vehicle_cents) values ('{cid}', 'SIM Transportadora com BrasaWay', 3000);",
            f"insert into company_members (company_id, user_id, role, display_name) values ('{cid}', '{gid}', 'gestor', 'Gestor SIM');"]
    mot, vei = {}, {}
    for i, p in enumerate(personas, 1):
        uid = f'51700000-0000-4000-8000-{i:012d}'
        vid = f'51700000-0000-4000-9000-{i:012d}'
        mot[p['id']] = uid; vei[p['id']] = vid
        nome = p['nome'].replace("'", "''")
        sql += [f"insert into auth.users (id, email) values ('{uid}', 'm{i}@sim.brasaway.example');",
                f"insert into vehicles (id, company_id, plate, label, preset, status) values ('{vid}', '{cid}', 'SIM{i:04d}', '{p['veiculo']}', '{p['veiculo']}', 'active');",
                f"insert into company_members (company_id, user_id, role, display_name, default_vehicle_id) values ('{cid}', '{uid}', 'motorista', '{nome}', '{vid}');"]
    r = subprocess.run(['docker', 'compose', 'exec', '-T', 'db', 'psql', '-U', 'truck', '-d', 'truck_router', '-v', 'ON_ERROR_STOP=1', '-q'],
                       input='\n'.join(sql).encode(), cwd=ROOT.parent, capture_output=True)
    if r.returncode: sys.exit(r.stderr.decode()[:2000])
    info = {'company_id': cid, 'gestor_id': gid, 'motoristas': mot, 'veiculos': vei}
    save(OUT / 'frota_info.json', info)
    save(OUT / 'estado.json', estado_inicial(personas))
    print('preparado:', len(personas), 'motoristas em cada grupo')


NOME_EMPRESA = {'com': 'A (com BrasaWay)', 'mais': 'A+ (BrasaWay com as novidades)', 'sem': 'B (sem BrasaWay)'}


def preparar_frota3(personas):
    """3.0: uma empresa na frota para cada grupo (ids próprios 5173..., e-mails @sim3...). Só apaga o que é da 3.0 (as
    empresas destes ids e os usuários @sim3), nunca as empresas da 2.0. Veículos com o tipo, perigosos, tanque e
    consumo de referência (a conferência do diesel parte do consumo do cadastro)."""
    import subprocess
    gi = {g: i for i, g in enumerate(('com', 'mais', 'sem'), 1)}
    cids = [f'51730000-0000-4000-b000-{gi[g]:012d}' for g in GRUPOS]
    sql = [f"delete from companies where id in ({', '.join(repr(c) for c in cids)});",
           "delete from auth.users where email like '%@sim3.brasaway.example';"]
    info = {'v': 3, 'grupos': {}}
    for g in GRUPOS:
        n = gi[g]
        cid, gid = f'51730000-0000-4000-b000-{n:012d}', f'51730000-0000-4000-a000-{n:012d}'
        sql += [f"insert into auth.users (id, email) values ('{gid}', 'gestor.{g}@sim3.brasaway.example');",
                f"insert into companies (id, name, price_per_vehicle_cents) values ('{cid}', 'SIM3 Transportadora {NOME_EMPRESA[g]}', {3000 if usa_app(g) else 0});",
                f"insert into company_members (company_id, user_id, role, display_name) values ('{cid}', '{gid}', 'gestor', 'Gestor SIM3 {g}');"]
        mot, vei = {}, {}
        for i, p in enumerate(personas, 1):
            uid, vid = f'51730000-000{n}-4000-8000-{i:012d}', f'51730000-000{n}-4000-9000-{i:012d}'
            mot[p['id']] = uid; vei[p['id']] = vid
            nome = p['nome'].replace("'", "''"); pr = p['veiculo']
            sql += [f"insert into auth.users (id, email) values ('{uid}', 'm{i}.{g}@sim3.brasaway.example');",
                    f"insert into vehicles (id, company_id, plate, label, preset, status, hazmat, is_vuc, tanque_l, consumo_km_l) values "
                    f"('{vid}', '{cid}', 'SIM{i:04d}', '{pr}', '{pr}', 'active', {str(bool(p.get('carga_perigosa'))).lower()}, {str(pr == 'vuc').lower()}, "
                    f"{PARAMS['tanque_l'][pr]}, {PARAMS['km_por_litro'][pr]});",
                    f"insert into company_members (company_id, user_id, role, display_name, default_vehicle_id) values ('{cid}', '{uid}', 'motorista', '{nome}', '{vid}');"]
        info['grupos'][g] = {'company_id': cid, 'gestor_id': gid, 'motoristas': mot, 'veiculos': vei}
    r = subprocess.run(['docker', 'compose', 'exec', '-T', 'db', 'psql', '-U', 'truck', '-d', 'truck_router', '-v', 'ON_ERROR_STOP=1', '-q'],
                       input='\n'.join(sql).encode(), cwd=ROOT.parent, capture_output=True)
    if r.returncode: sys.exit(r.stderr.decode()[:2000])
    save(OUT / 'frota_info.json', info)
    save(OUT / 'estado.json', estado_inicial(personas))
    print('preparado (3.0):', len(personas), 'motoristas em cada empresa:', ', '.join(GRUPOS))


def carregar_frotas(info):
    """Frota de cada empresa que usa o app: a 2.0 tem uma só (frota_info da 'com'); a 3.0, uma por grupo."""
    if not info: return {}
    if 'grupos' in info: return {g: Frota(i) for g, i in info['grupos'].items() if g in GRUPOS and usa_app(g)}
    return {'com': Frota(info)}


def carregar_globais(st):
    """Convênios e trechos bloqueados de cada empresa (o roteiro e o plano dependem deles)."""
    CONVENIOS['com'] = st['grupos']['com'].get('conveniados', [])
    if V3:
        for g in GRUPOS:
            CONVENIOS[g] = st['grupos'][g].get('conveniados', []) if usa_app(g) else []
            BLOQ[g] = bloqueios_de(st['grupos'][g])


# ------------------------------------------------------------------ decisões
def aplicar_decisoes(st, semana, frotas):
    for g in GRUPOS:
        dec = load(OUT / 'decisoes' / f'semana_{semana}_{g}.json')
        if not dec: continue
        frota = frotas.get(g)
        G = st['grupos'][g]; M = G['motoristas']
        alvo = lambda lst: list(M) if (not lst or 'todos' in lst) else [x for x in lst if x in M]
        for a in dec.get('acoes', []):
            t = a.get('acao'); aplicada = True
            if t == 'orientar':
                for pid in alvo(a.get('motoristas')):
                    for k in a.get('itens', []):
                        M[pid]['conhece'][k] = max(M[pid]['conhece'].get(k, 0.0), 0.75)
                        if V3: M[pid]['orientado'][k] = max(M[pid]['orientado'].get(k, 0.0), 0.75)
                    M[pid]['risco'] *= 0.9
            elif t == 'mudar_horario' and a.get('motorista') in M:
                ls = M[a['motorista']]['linhas']; i = int(a.get('linha', 0))
                if 0 <= i < len(ls): ls[i]['hora_saida'] = int(a['hora']) % 24
                else: aplicada = False
            elif t == 'trocar_veiculo' and a.get('motorista') in M and a.get('preset') in PARAMS['km_por_litro']:
                m = M[a['motorista']]
                m['fator_viagens'] = PARAMS['carga_t'][m['veiculo']] / PARAMS['carga_t'][a['preset']] * m.get('fator_viagens', 1.0)
                m['veiculo'] = a['preset']
                if V3 and frota: frota.veiculo(a['motorista'], m)
            elif t == 'cadastrar_aetc' and a.get('motorista') in M:
                M[a['motorista']]['aetc'] = True          # autorização de VUC em SP (vale para VUC; nos outros não muda nada)
                G['custos_extra'].append({'semana': semana, 'tipo': 'aetc', 'valor': 0})
                if V3 and frota: frota.veiculo(a['motorista'], M[a['motorista']])
            elif t == 'advertir' and a.get('motorista') in M:
                M[a['motorista']]['risco'] *= 0.6
            elif t == 'exigir_app' and usa_app(g) and a.get('motorista') in M:
                M[a['motorista']]['adesao'] = min(0.98, M[a['motorista']]['adesao'] + 0.25)
            elif t == 'treinamento':
                ps = alvo(a.get('motoristas'))
                for pid in ps: M[pid]['treinado'] = min(0.3, M[pid]['treinado'] + 0.12)
                G['custos_extra'].append({'semana': semana, 'tipo': 'treinamento', 'valor': PARAMS['treinamento_rs'] * len(ps)})
            elif t == 'recorrer_multas':
                n = 0; rng = random.Random(f'recurso{g}{semana}')
                for e in G['eventos']:
                    for mu in e['multas']:
                        if mu.get('situacao') is None and mu['aviso_em'] <= (INICIO + dt.timedelta(days=st['dia_atual'])).isoformat():
                            # 3.0: sorteio por multa (o mesmo para a multa gêmea nas outras empresas)
                            r_ = random.Random(f"recurso|{e['motorista']}|{e['data']}|{e['hora']}|{mu['k']}") if V3 else rng
                            n += 1; mu['situacao'] = 'cancelada' if r_.random() < PARAMS['p_recurso_ok'] else 'mantida'
                G['custos_extra'].append({'semana': semana, 'tipo': 'recursos', 'valor': PARAMS['recurso_rs'] * n})
            elif t == 'suspender_linha' and a.get('motorista') in M:
                ls = M[a['motorista']]['linhas']; i = int(a.get('linha', 0))
                if 0 <= i < len(ls): ls[i]['ativa'] = False
                else: aplicada = False
            elif t == 'reativar_linha' and a.get('motorista') in M:
                ls = M[a['motorista']]['linhas']; i = int(a.get('linha', 0))
                if 0 <= i < len(ls): ls[i]['ativa'] = True
            elif t == 'feedback':
                # conversa com o motorista sobre multas: ele passa a conhecer o trecho e arrisca menos
                alvo_m = set(a.get('multas') or [])
                for e in G['eventos']:
                    for mu in e['multas']:
                        if mu.get('feedback') or not (mu.get('mid') in alvo_m or (a.get('motorista') and e['motorista'] == a.get('motorista'))): continue
                        if mu['aviso_em'] > (INICIO + dt.timedelta(days=st['dia_atual'])).isoformat(): continue
                        mu['feedback'] = semana
                        mm = M[e['motorista']]
                        mm['conhece'][mu['k']] = max(mm['conhece'].get(mu['k'], 0.0), 0.85); mm['risco'] *= 0.85
                        if V3: mm['orientado'][mu['k']] = max(mm['orientado'].get(mu['k'], 0.0), 0.85)
                        if usa_app(g) and frota: frota.feedback(mu, a.get('nota') or 'Conversa sobre a multa')
            elif t == 'renegociar_janela' and a.get('motorista') in M:
                ls = M[a['motorista']]['linhas']; i = int(a.get('linha', 0))
                aceita = random.Random(f"jan|{g}|{a['motorista']}|{i}|{semana}").random() < PARAMS['p_cliente_aceita_janela']
                if 0 <= i < len(ls) and aceita and a.get('ate') is not None:
                    ls[i]['janela_entrega_ate'] = float(a['ate'])
                else:
                    aplicada = False                 # cliente não aceitou (ou linha errada)
            elif t == 'convenio_pix' and usa_app(g):
                # negocia desconto no PIX com os postos onde a frota mais abastece (pelo plano do app)
                desc = float(a.get('desconto_rs_l', 0.2)); n = int(a.get('quantos', 15))
                uso = {}
                for mm in M.values():
                    for cnpj, (nome, litros, _) in (mm.get('_uso_postos') or {}).items():
                        u = uso.setdefault(cnpj, [nome, 0.0]); u[1] += litros
                ja = {c['cnpj'] for c in G.setdefault('conveniados', [])}
                # (nome próprio: `alvo` é a função de escolher motoristas, usada pelas ações seguintes da mesma lista)
                alvo_cnpj = [c for c, _ in sorted(uso.items(), key=lambda x: -x[1][1]) if c not in ja][:n]
                p_aceita = 0.7 if desc <= 0.2 else 0.5 if desc <= 0.3 else 0.25
                rng_c = random.Random(f'conv|{semana}|{desc}')
                fechados = []
                for cnpj in alvo_cnpj:
                    if rng_c.random() < p_aceita:
                        G['conveniados'].append({'cnpj': cnpj, 'nome': uso[cnpj][0], 'desconto_rs_l': desc, 'semana': semana}); fechados.append(cnpj)
                        if frota: call('POST', '/api/frota/postos-conveniados', frota.gestor, {'cnpj': cnpj, 'nome': uso[cnpj][0], 'desconto_rs_l': desc, 'pagamento': 'PIX'})
                CONVENIOS[g] = G['conveniados']
                a['_resultado'] = f'{len(fechados)} de {len(alvo_cnpj)} postos aceitaram R$ {desc:.2f}/L no PIX'
            elif t == 'nenhuma':
                pass
            elif V3 and t in ACOES3:
                aplicada = ACOES3[t](st, g, G, a, semana, frota)
            else:
                aplicada = False
            G['decisoes_aplicadas'].append({'semana': semana, 'acao': a, 'aplicada': aplicada})
            if V3: a['_aplicada'] = aplicada
        msg = (dec.get('mensagem_aos_motoristas') or '').strip()
        if msg:
            G['mensagens'].append({'semana': semana, 'texto': msg, 'canal': 'BrasaWay (mensagens)' if usa_app(g) else 'WhatsApp'})
            if usa_app(g) and frota:
                for pid in list(M)[:50]: frota.mensagem(pid, msg)
        if V3: save(OUT / 'decisoes' / f'semana_{semana}_{g}.json', dec)     # com o resultado de cada ação (_aplicada, _resultado)


# ------------------------------------------------------------------ 3.0: ações novas
def hoje_de(st): return (INICIO + dt.timedelta(days=st['dia_atual'])).isoformat()


def nome_do_item(G, k):
    for e in reversed(G['eventos']):
        for v in e['violacoes']:
            if v['k'] == k: return v['nome'] or k
    return k


def acao_indicar_condutor(st, g, G, a, semana, frota):
    """Indica o condutor das multas listadas (mid), se a notificação já chegou e o prazo não venceu."""
    hoje = hoje_de(st); alvo_m = set(a.get('multas') or [])
    feitas, fora, ja = [], 0, 0
    for e in G['eventos']:
        for mu in e['multas']:
            if mu.get('mid') not in alvo_m: continue
            if mu.get('presencial') or mu.get('indicada_em'): ja += 1; continue
            if not pendente_indicacao(mu) or not mu.get('chegada') or mu['chegada'] > hoje or mu['prazo'] < hoje:
                fora += 1; continue
            indicar(G, e, mu, hoje, 'equipe'); feitas.append(mu)
    if frota and feitas: frota.indicar(feitas, automatica=(g == 'mais'))
    a['_resultado'] = (f'{len(feitas)} condutores indicados' + (f'; {fora} fora do prazo, sem notificação ou já com NIC' if fora else '')
                       + (f'; {ja} já estavam indicadas' if ja else ''))
    return bool(feitas)


def acao_cobrar_abastecimento(st, g, G, a, semana, frota):
    """Cobra o motorista (ou todos) sobre onde e quanto abastece: mais adesão ao posto do plano; o desviador pode parar.
    Pelo nome, no máximo cobrar_nomeado.max_semana motoristas por semana (somando as ações da semana)."""
    M = G['motoristas']; ps = a.get('motoristas') or ['todos']
    cn, ct = PARAMS['cobrar_nomeado'], PARAMS['cobrar_todos']
    if 'todos' in ps:
        for pid, mm in M.items():
            mm['adesao_posto'] = min(cn['adesao_posto_max'], mm.get('adesao_posto', 0.75) + ct['adesao_posto_mais'])
            if mm.get('desvia') and random.Random(f'cobrar|todos|{pid}|{semana}').random() < ct['p_para_desvio']:
                mm['desvia'] = False; mm['desvio_parou'] = {'semana': semana, 'como': 'cobrança geral'}
        G.setdefault('cobrancas', []).append({'semana': semana, 'motoristas': 'todos'})
        a['_resultado'] = 'cobrança feita a todos os motoristas'
        return True
    ja = {pid for c in G.get('cobrancas') or [] if c['semana'] == semana and isinstance(c['motoristas'], list) for pid in c['motoristas']}
    validos = [pid for pid in dict.fromkeys(ps) if pid in M and pid not in ja]
    vagas = max(0, cn['max_semana'] - len(ja))
    ok, sobra = validos[:vagas], validos[vagas:]
    for pid in ok:
        mm = M[pid]; mm['adesao_posto'] = min(cn['adesao_posto_max'], mm.get('adesao_posto', 0.75) + cn['adesao_posto_mais'])
        if mm.get('desvia') and random.Random(f'cobrar|{pid}|{semana}').random() < cn['p_para_desvio']:
            mm['desvia'] = False; mm['desvio_parou'] = {'semana': semana, 'como': 'cobrança nominal'}
        if frota and a.get('nota'): frota.mensagem(pid, a['nota'])
    G.setdefault('cobrancas', []).append({'semana': semana, 'motoristas': ok})
    # se o desvio parou, a empresa não sabe (só a verdade sabe)
    a['_resultado'] = (f'{len(ok)} motoristas cobrados pelo nome'
                       + (f"; {len(sobra)} ficaram sem conversa (no máximo {cn['max_semana']} por semana): {', '.join(sobra[:10])}"
                          + ('...' if len(sobra) > 10 else '') if sobra else ''))
    return bool(ok)


def acao_aderir_sne(st, g, G, a, semana, frota):
    if G.get('sne_desde'):
        a['_resultado'] = f"já aderida ao SNE desde {G['sne_desde']}"; return True
    G['sne_desde'] = hoje_de(st)
    if frota and g == 'mais': frota.sne(True)
    a['_resultado'] = f"aderida ao SNE em {G['sne_desde']}: notificação eletrônica e 40% de desconto nas multas sem recurso"
    return True


def acao_bloquear_trecho(st, g, G, a, semana, frota):
    """F1 (só a 'mais'): trava o trecho para a frota inteira; a rota de todos desvia se existir caminho."""
    if g != 'mais':
        a['_resultado'] = 'trecho bloqueado só existe na Transportadora A+'; return False
    ok, recusados, ja = [], [], {id_trecho(b['item_id']) or b['item_id'] for b in G['bloqueios']}
    for k in a.get('itens') or []:
        p = str(k).split(':', 2)
        if len(p) < 3 or p[0] != 'layer' or not p[2]: recusados.append(k); continue
        item_id = id_trecho(p[2]) or p[2]          # o trecho inteiro, sem o sufixo da rota (a API guarda assim)
        if item_id in ja: continue
        nome = nome_do_item(G, k)
        b = {'k': k, 'item_id': item_id, 'layer': p[1], 'nome': nome[:200], 'motivo': (a.get('motivo') or '')[:300], 'semana': semana}
        if frota: b['api_id'] = frota.bloquear(item_id, nome, a.get('motivo'))
        G['bloqueios'].append(b); ok.append(k); ja.add(item_id)
    BLOQ[g] = bloqueios_de(G)
    a['_resultado'] = (f'{len(ok)} trechos bloqueados para a frota'
                       + (f'; {len(recusados)} recusados (só dá para bloquear trecho de camada, item "layer:...", não zona)' if recusados else ''))
    return bool(ok)


def acao_desbloquear_trecho(st, g, G, a, semana, frota):
    if g != 'mais':
        a['_resultado'] = 'trecho bloqueado só existe na Transportadora A+'; return False
    alvo = set(a.get('itens') or [])
    sai = [b for b in G['bloqueios'] if b['k'] in alvo]
    for b in sai:
        if frota: frota.desbloquear(b.get('api_id'))
    G['bloqueios'] = [b for b in G['bloqueios'] if b['k'] not in alvo]
    G.setdefault('bloqueios_removidos', []).extend(dict(b, removido_semana=semana) for b in sai)
    BLOQ[g] = bloqueios_de(G)
    a['_resultado'] = f'{len(sai)} trechos desbloqueados'
    return bool(sai)


ACOES3 = {'indicar_condutor': acao_indicar_condutor, 'cobrar_abastecimento': acao_cobrar_abastecimento, 'aderir_sne': acao_aderir_sne,
          'bloquear_trecho': acao_bloquear_trecho, 'desbloquear_trecho': acao_desbloquear_trecho}


# ------------------------------------------------------------------ semana
def agenda(m, data):
    """Viagens do dia: cada linha ativa roda vezes_por_semana nos dias de trabalho, espalhadas."""
    dow = data.isoweekday()
    dias = m.get('dias_trabalho') or [1, 2, 3, 4, 5]
    if dow not in dias: return []
    idx = dias.index(dow); out = []
    for i, l in enumerate(m['linhas']):
        if not l.get('ativa', True): continue
        vezes = min(len(dias), max(1, round(int(l.get('vezes_por_semana', 2)) * m.get('fator_viagens', 1.0))))
        # 2.0: cada linha começa num dia diferente da semana (antes todas começavam na segunda: 52% das viagens caíam nela)
        desloc = (int(hashlib.md5(f"{m.get('pid', '')}|{i}".encode()).hexdigest(), 16) % len(dias)) if V2 else 0
        escolhidos = {(desloc + round(j * len(dias) / vezes)) % len(dias) for j in range(vezes)}
        if idx in escolhidos: out.append((i, l))
    return out


def rodar_semana(n):
    st = load(OUT / 'estado.json'); personas = {p['id']: p for p in load(OUT / 'personas.json')}
    info = load(OUT / 'frota_info.json'); frotas = carregar_frotas(info)
    carregar_globais(st)
    marca(f'semana {n}: início')
    if n > 1: aplicar_decisoes(st, n - 1, frotas)
    tarefas, falhas = preparar(st, n, personas)
    d1 = min(DIAS, 7 * n)
    marca(f'aquecimento pronto ({len(tarefas)} viagens)')
    simular(st, n, personas, frotas, tarefas, falhas, d1)


def aquecer(n):
    """Calcula de antemão as rotas e planos da semana n com o estado atual (antes das decisões da equipe), em paralelo
    ao workflow da equipe. O que as decisões mudarem (horário, linha) é calculado na hora, na semana de verdade."""
    st = load(OUT / 'estado.json'); personas = {p['id']: p for p in load(OUT / 'personas.json')}
    carregar_globais(st)
    marca(f'aquecer {n}: início')
    tarefas, falhas = preparar(st, n, personas)
    marca(f'aquecer {n}: pronto ({len(tarefas)} viagens, {len(falhas)} falhas)')


def preparar(st, n, personas):
    d0 = 7 * (n - 1); d1 = min(DIAS, 7 * n)
    tarefas = []
    for dia in range(d0, d1):
        data = INICIO + dt.timedelta(days=dia)
        for g in GRUPOS:
            for pid, m in st['grupos'][g]['motoristas'].items():
                m.setdefault('dias_trabalho', personas[pid].get('dias_trabalho')); m['pid'] = pid
                if m.get('parado_ate') and data.isoformat() <= m['parado_ate']: continue
                hora_livre = None
                for i, l in agenda(m, data):
                    hora = int(l.get('hora_saida', 6)) if hora_livre is None else int(math.ceil(hora_livre))
                    if hora > 22: break
                    tarefas.append((g, pid, i, data, hora))
                    hora_livre = hora + 3        # estimativa para encadear a 2ª viagem do dia; refinada abaixo
    # pré-aquece o cache de rotas em paralelo (o que é igual nos grupos é calculado uma vez; 3.0: a 'mais' com bloqueios
    # tem chave própria, e a rota sem bloqueio também é calculada, para saber se o bloqueio a muda)
    uniq = {}
    for g, pid, i, data, hora in tarefas:
        m = st['grupos'][g]['motoristas'][pid]; l = m['linhas'][i]
        bq = BLOQ.get(g) if V3 else None
        uniq[(l['origem'], l['destino'], m['veiculo'], m['hazmat'], 'F' if data in FERIADOS else data.isoweekday(), hora, bool(m.get('aetc')))
             + ((hash_bloq(bq),) if bq else ())] = ((l['origem'], l['destino'], m['veiculo'], m['hazmat'], data, hora, bool(m.get('aetc'))), bq)
    falhas = []
    def aquece(x):
        args, bq = x
        try: rota_legal(*args, bloq=bq); rota_gps_carro(*args, bloq=bq)
        except Exception as e: falhas.append((args[:2], str(e)[:120]))
    with ThreadPoolExecutor(int(os.environ.get('SIM_THREADS', '4'))) as ex: list(ex.map(aquece, uniq.values()))
    if V2:   # planos de abastecimento de todas as faixas de nível das linhas da semana, em paralelo (antes: um a um no meio da simulação)
        if V3:   # cada empresa com os seus convênios e bloqueios: um plano por combinação diferente
            planos = {}
            for g, pid, i, data, hora in tarefas:
                m = st['grupos'][g]['motoristas'][pid]; l = m['linhas'][i]
                x = (l['origem'], l['destino'], m['veiculo'], m['hazmat'], bool(m.get('aetc')))
                bq = BLOQ.get(g)
                planos[x + (_cv(_conv(g)), hash_bloq(bq) if bq else '')] = x + (g,)
            planos = set(planos.values())
        else:
            planos = {(a[0], a[1], a[2], a[3], a[6]) for a, _ in uniq.values()}
        def aquece_plano(x):
            try: planos_linha(*x)
            except Exception as e: falhas.append(((x[0], x[1]), 'plano: ' + str(e)[:100]))
        with ThreadPoolExecutor(int(os.environ.get('SIM_THREADS', '4'))) as ex: list(ex.map(aquece_plano, planos))
    with cache_lock: save(CACHE_P, CACHE)
    return tarefas, falhas


def simular(st, n, personas, frotas, tarefas, falhas, d1):
    d0 = 7 * (n - 1)
    frota = frotas.get('com')         # 2.0: só a empresa com o app usa a frota
    # simula na ordem do calendário
    eventos_semana = {g: [] for g in GRUPOS}
    frota_jobs = []
    for g, pid, i, data, hora in tarefas:
        m = st['grupos'][g]['motoristas'][pid]; l = m['linhas'][i]
        rng = random.Random(f'{pid}|{data}|{i}|{hora}')         # mesma sorte para os gêmeos: compara ferramenta, não azar
        try:
            ev, geom = simular_viagem(g, pid, m, l, data, hora, rng)
        except Exception as e:
            falhas.append(((l['origem'], l['destino']), str(e)[:120])); continue
        ev['semana'] = n; ev['linha'] = i
        if ev['colisoes']:
            m['parado_ate'] = (data + dt.timedelta(days=PARAMS['colisao_dias_parado'])).isoformat()
        if V3:
            # P3/P4: notificação e prazo de cada multa; pontos só com o condutor identificado (presencial ou indicado)
            notificar_multas(st['grupos'][g], ev, m)
            ev['odometro_saida_km'] = round(m['odometro_km'], 1); m['odometro_km'] += ev['km']
        else:
            for mu in ev['multas']: m['pontos'].append({'data': ev['data'], 'pontos': mu['pontos']})
        st['grupos'][g]['eventos'].append(ev); eventos_semana[g].append(ev)
        if V3:
            if g in frotas: frota_jobs.append((g, pid, ev, geom, l))
        elif g == 'com' and frota and geom: frota_jobs.append((pid, ev, geom, l))
    marca('viagens simuladas')
    painel = {}
    if V3:
        painel = semana_frota3(st, n, frotas, frota_jobs, d1)
        frota_jobs = []; frota = None          # já enviado acima
    if frota and V2:
        hoje_fim = (INICIO + dt.timedelta(days=d1 - 1)).isoformat()
        def extras(pid):
            for e in eventos_semana['com']:
                if e['motorista'] != pid: continue
                frota.abastecimento(pid, e)
                for mu in e['multas']:
                    if mu.get('presencial') and not mu.get('api_id'): frota.multa_motorista(pid, mu, e)
        with ThreadPoolExecutor(FROTA_THREADS) as ex: list(ex.map(extras, {e['motorista'] for e in eventos_semana['com']}))
        # notificações que chegaram nesta semana (de qualquer semana anterior): a equipe completa no painel
        for e in st['grupos']['com']['eventos']:
            for mu in e['multas']:
                if mu['aviso_em'] <= hoje_fim and not mu.get('notificada'):
                    mu['notificada'] = True; frota.multa_equipe(mu, e)
    marca('abastecimentos e multas na frota')
    if frota:   # um motorista só tem uma viagem em andamento: as dele vão em fila, motoristas em paralelo
        por_mot = {}
        for job in frota_jobs: por_mot.setdefault(job[0], []).append(job)
        with ThreadPoolExecutor(FROTA_THREADS) as ex: list(ex.map(lambda js: [frota.viagem(*a) for a in js], por_mot.values()))
    marca('viagens enviadas à frota')
    st['dia_atual'] = d1
    save(OUT / 'estado.json', st)
    if V3: rel = {g: relatorio(st, g, n, eventos_semana[g], personas, painel.get(g)) for g in GRUPOS}
    else: rel = {g: relatorio(st, g, n, eventos_semana[g], personas) for g in GRUPOS}
    for g in GRUPOS: save(OUT / 'relatorios' / f'semana_{n}_{g}.json', rel[g])
    if V3:   # o que a empresa não enxerga (diesel desviado, conferência do painel contra a verdade): só para o relatório final
        save(OUT / 'verdade' / f'semana_{n}.json', {g: verdade_semana(st, g, n, eventos_semana[g], painel.get(g)) for g in GRUPOS})
    with cache_lock: save(CACHE_P, CACHE)      # guarda também as rotas da conferência de janelas
    resumo = {g: {k: rel[g]['semana'][k] for k in ('viagens', 'km', 'multas_cometidas', 'retornos', 'colisoes', 'atrasos')} for g in GRUPOS}
    erros = (sum(f.erros for f in frotas.values()) if frotas else None) if V3 else (frota.erros if frota else None)
    print(json.dumps({'semana': n, 'dias': [str(INICIO + dt.timedelta(days=d0)), str(INICIO + dt.timedelta(days=d1 - 1))],
                      'resumo': resumo, 'falhas_rota': len(falhas), 'frota_erros': erros}, ensure_ascii=False))
    if falhas: save(OUT / f'falhas_semana_{n}.json', falhas)


def semana_frota3(st, n, frotas, frota_jobs, d1):
    """3.0, depois das viagens da semana: frota das empresas com app, indicação automática (mais), NIC (todas) e as
    leituras do painel da 'mais' para o relatório."""
    hoje_fim = (INICIO + dt.timedelta(days=d1 - 1)).isoformat(); hoje = (INICIO + dt.timedelta(days=d1)).isoformat()
    # 1) viagens com abastecimentos e multas presenciais: as de um motorista em fila (uma em andamento por vez)
    por_mot = {}
    for g, pid, ev, geom, l in frota_jobs: por_mot.setdefault((g, pid), []).append((ev, geom, l))
    with ThreadPoolExecutor(FROTA_THREADS) as ex:
        list(ex.map(lambda kv: [frotas[kv[0][0]].viagem3(kv[0][1], *a) for a in kv[1]], por_mot.items()))
    marca('viagens, abastecimentos e multas presenciais na frota')
    # 2) notificações que chegaram até o fim da semana: a equipe registra no painel (com data, prazo e vencimento)
    for g, frota in frotas.items():
        for e in st['grupos'][g]['eventos']:
            for mu in e['multas']:
                if mu['aviso_em'] <= hoje_fim and not mu.get('notificada'):
                    mu['notificada'] = True; frota.multa_equipe(mu, e)
    # 3) F3 (mais): o sistema indica o condutor sozinho até 2 dias depois da notificação
    for g in GRUPOS:
        if g == 'mais':
            feitas = indicar_automatico(st['grupos'][g], hoje_fim)
            if feitas and frotas.get(g): frotas[g].indicar(feitas, automatica=True)
    # 4) P4: prazo de indicação vencido sem indicação → NIC (todas as empresas)
    for g in GRUPOS: processar_prazos(st['grupos'][g], hoje, n)
    # 5) leituras do painel da 'mais' (conferência do diesel e prazos das multas)
    painel = {}
    if 'mais' in frotas:
        f = frotas['mais']
        painel['mais'] = {'conciliacao': f.ler(f"/api/frota/conciliacao-diesel?dias={PARAMS['conciliacao_dias']}&tolerancia_pct={PARAMS['conciliacao_tolerancia_pct']}"),
                          'prazos': f.ler('/api/frota/multas/prazos'), 'consultado_em': time.time(),
                          'veiculos': f.info['veiculos'], 'motoristas': f.info['motoristas']}
    marca('multas, prazos e painel')
    return painel


def soma(evs, campo): return round(sum(e[campo] for e in evs), 2)


EMPRESA_REL = {'com': 'com BrasaWay', 'mais': 'com BrasaWay e as novidades (A+)', 'sem': 'sem BrasaWay'}


def relatorio(st, g, n, evs, personas, painel=None):
    """O que a equipe interna enxerga na segunda de manhã. Sem BrasaWay: só multas cuja notificação já chegou, retornos
    e batidas que o motorista contou e atrasos. Com BrasaWay: também o que o app evitou e os avisos de zona/trecho."""
    G = st['grupos'][g]; hoje = (INICIO + dt.timedelta(days=st['dia_atual'])).isoformat()
    multas_visiveis = [dict(mu, motorista=e['motorista'], data=e['data'], linha=e['linha'], destino=e['destino'])
                       for e in G['eventos'] for mu in e['multas'] if mu['aviso_em'] <= hoje and mu['aviso_em'] > (INICIO + dt.timedelta(days=st['dia_atual'] - 7)).isoformat()]
    por_mot = {}
    for e in evs:
        r = por_mot.setdefault(e['motorista'], {'viagens': 0, 'retornos': 0, 'colisoes': 0, 'atrasos': 0, 'ignorou_app': 0})
        r['viagens'] += 1; r['retornos'] += e['retornos']; r['colisoes'] += e['colisoes']; r['atrasos'] += e['atraso']
        r['ignorou_app'] += e['rota'] == 'ignorou_app'
    problemas = {}
    for e in evs:
        for v in e['violacoes']:
            if not usa_app(g) and not (e['retornos'] or e['colisoes']) and v['cat'] == 'circulacao':
                continue          # sem app, ninguém fica sabendo da passagem irregular até a multa chegar
            p = problemas.setdefault(v['k'], {'item': v['k'], 'nome': v['nome'], 'tipo': v['cat'], 'vezes': 0, 'motoristas': set()})
            p['vezes'] += 1; p['motoristas'].add(e['motorista'])
    probl = sorted(({**p, 'motoristas': sorted(p['motoristas'])} for p in problemas.values()), key=lambda x: -x['vezes'])[:15]
    pts = {pid: sum(x['pontos'] for x in m['pontos'] if x['data'] >= (INICIO + dt.timedelta(days=st['dia_atual'] - 365)).isoformat())
           for pid, m in G['motoristas'].items()}
    linhas = {pid: [{'i': i, 'origem': l['origem'], 'destino': l['destino'], 'hora_saida': l['hora_saida'], 'ativa': l.get('ativa', True),
                     'janela_entrega_ate': l.get('janela_entrega_ate')} for i, l in enumerate(m['linhas'])]
              for pid, m in G['motoristas'].items()}
    sem = {'viagens': len(evs), 'km': soma(evs, 'km'), 'horas': soma(evs, 'horas'), 'diesel_rs': soma(evs, 'custo_diesel'),
           'motorista_rs': soma(evs, 'custo_motorista'), 'retornos': sum(e['retornos'] for e in evs),
           'colisoes': sum(e['colisoes'] for e in evs), 'atrasos': sum(e['atraso'] for e in evs),
           'multas_cometidas': sum(len(e['multas']) for e in evs)}
    rel = {'empresa': EMPRESA_REL[g], 'semana': sem, 'semana_n': n, 'hoje': hoje,
           'multas_notificadas_na_semana': multas_visiveis,
           'por_motorista': por_mot, 'pontos_cnh_12m': {k: v for k, v in pts.items() if v},
           'problemas_conhecidos': probl, 'linhas': linhas,
           'nota': ('Dados do painel BrasaWay: rotas legais, restrições evitadas, entregas em zona restrita avisadas antes da saída.'
                    if usa_app(g) else 'Sem sistema: a empresa só sabe das multas quando a notificação chega (~3 semanas), dos retornos e batidas que o motorista conta e dos atrasos que o cliente reclama.')}
    if V2:
        compr = sum(e.get('diesel_comprado_l', 0) for e in evs); gasto = sum(e.get('diesel_gasto_rs', 0) for e in evs)
        # na 2.0 o diesel é o comprado e o consumido de verdade; a estimativa fixa da 1.0 (diesel_rs) confundia a equipe
        rel['semana'].pop('diesel_rs', None)
        rel['semana']['diesel_litros_consumidos'] = round(sum(e.get('diesel_consumido_l', 0) for e in evs))
        rel['semana']['diesel_litros_comprados'] = round(compr); rel['semana']['diesel_gasto_rs'] = round(gasto, 2)
        rel['semana']['diesel_preco_medio_pago'] = round(gasto / compr, 3) if compr else None
        rel['semana']['multas_presenciais'] = sum(1 for e in evs for mu in e['multas'] if mu.get('presencial'))
        if usa_app(g):
            # o painel lista as multas que já chegaram (notificação ou registro do motorista) e ainda sem feedback
            rel['multas_sem_feedback'] = [{'mid': mu['mid'], 'motorista': e['motorista'], 'data': e['data'], 'nome': mu['nome'], 'gravidade': mu['gravidade'],
                                           'presencial': mu.get('presencial', False)}
                                          for e in G['eventos'] for mu in e['multas'] if mu['aviso_em'] <= hoje and not mu.get('feedback')][:40]
            rel['semana']['alertas_ao_vivo_que_evitaram'] = sum(e.get('evitadas_alerta', 0) for e in evs)
            uso = {}
            for mm in G['motoristas'].values():
                for cnpj, (nome, litros, gasto) in (mm.get('_uso_postos') or {}).items():
                    u = uso.setdefault(cnpj, [nome, 0.0, 0.0]); u[1] += litros; u[2] += gasto
            conv = {c['cnpj']: c['desconto_rs_l'] for c in G.get('conveniados', [])}
            rel['postos_mais_usados'] = [{'cnpj': c, 'nome': u[0], 'litros_acumulados': round(u[1]), 'preco_medio_pago': round(u[2] / u[1], 3) if u[1] else None,
                                          'desconto_pix': conv.get(c)} for c, u in sorted(uso.items(), key=lambda x: -x[1][1])[:15]]
            rel['postos_conveniados'] = len(conv)
            rel['semana']['diesel_preco_medio_das_rotas'] = round(sum(e.get('preco_medio_rota', 0) * e.get('diesel_consumido_l', 0) for e in evs) /
                                                                  max(1, sum(e.get('diesel_consumido_l', 0) for e in evs)), 3)
            # o planejamento avisa janela que não cabe na viagem (rota legal + pausas)
            jan = []
            # calcula em paralelo as rotas da conferência (antes: uma a uma, dezenas de minutos no fim da semana)
            dia_jan = INICIO + dt.timedelta(days=st['dia_atual'])
            args_jan = [(l['origem'], l['destino'], G['motoristas'][pid]['veiculo'], G['motoristas'][pid]['hazmat'], dia_jan, int(l['hora_saida']),
                         bool(G['motoristas'][pid].get('aetc'))) for pid, ls in linhas.items() for l in ls
                        if l['janela_entrega_ate'] is not None and l['ativa']]
            bq = BLOQ.get(g) if V3 else None
            def _pre(a):
                try: rota_legal(*a, bloq=bq)
                except Exception: pass
            with ThreadPoolExecutor(int(os.environ.get('SIM_THREADS', '4'))) as ex: list(ex.map(_pre, args_jan))
            for pid, ls in linhas.items():
                for l in ls:
                    if l['janela_entrega_ate'] is None or not l['ativa']: continue
                    mm = G['motoristas'][pid]
                    try: lg = rota_legal(l['origem'], l['destino'], mm['veiculo'], mm['hazmat'], INICIO + dt.timedelta(days=st['dia_atual']), int(l['hora_saida']), bool(mm.get('aetc')), bloq=bq)
                    except Exception: continue
                    if not lg.get('ok'): continue
                    horas = lg['seg'] / 3600; pausas = 0.5 * int(horas // 5.5) + (11 if horas > 13 else 0)
                    jfim = l['janela_entrega_ate'] + (24 if l['janela_entrega_ate'] <= l['hora_saida'] else 0)
                    chegada = l['hora_saida'] + horas + pausas
                    if chegada > jfim: jan.append({'motorista': pid, 'linha': l['i'], 'saida': l['hora_saida'], 'janela_ate': l['janela_entrega_ate'],
                                                   'chegada_prevista': round(chegada % 24, 1), 'sair_ate': round((jfim - horas - pausas) % 24, 1)})
            rel['janelas_inviaveis'] = jan
        else:
            rel['multas_sem_feedback'] = [{'mid': mu['mid'], 'motorista': e['motorista'], 'data': e['data'], 'nome': mu['nome']}
                                          for e in G['eventos'] for mu in e['multas']
                                          if (INICIO + dt.timedelta(days=st['dia_atual'] - 7)).isoformat() < mu['aviso_em'] <= hoje and not mu.get('feedback')]
    if usa_app(g):
        rel['semana']['evitadas_pelo_app'] = sum(e['evitadas_app'] for e in evs)
        rel['semana']['viagens_ignorando_app'] = sum(e['rota'] == 'ignorou_app' for e in evs)
        rel['semana']['avisos_de_risco'] = sum(e.get('avisos_risco', 0) for e in evs)
    if V3: relatorio3(rel, st, g, n, evs, painel)
    return rel


def relatorio3(rel, st, g, n, evs, painel):
    """3.0: o que muda no relatório da equipe. Diesel: o que a empresa comprou (litros cobrados) e o esperado pelo km (o
    consumo de verdade e o desvio não aparecem). Multas: prazos de indicação, NIC e SNE. A+: trechos bloqueados e o
    painel de conferência do diesel."""
    G = st['grupos'][g]; hoje = rel['hoje']; s = rel['semana']
    s.pop('diesel_litros_consumidos', None)
    s['diesel_litros_esperados_pelo_km'] = round(sum(e['km'] / PARAMS['km_por_litro'][e['veiculo']] for e in evs))
    pend, ini = [], (INICIO + dt.timedelta(days=st['dia_atual'] - 7)).isoformat()
    for e in G['eventos']:
        for mu in e['multas']:
            if pendente_indicacao(mu) and mu.get('chegada') and mu['chegada'] <= hoje and mu['prazo'] >= hoje:
                pend.append({'mid': mu['mid'], 'motorista': e['motorista'], 'data': e['data'], 'nome': mu['nome'][:80], 'valor': mu['valor'],
                             'chegada_notificacao': mu['chegada'], 'prazo': mu['prazo'],
                             'dias_restantes': (dt.date.fromisoformat(mu['prazo']) - dt.date.fromisoformat(hoje)).days})
    pend.sort(key=lambda x: (x['dias_restantes'], x['mid']))
    if g == 'mais':
        rel['multas_aguardando_indicacao_automatica'] = len(pend)
        s['condutores_indicados_pelo_sistema'] = sum(1 for e in G['eventos'] for mu in e['multas']
                                                     if mu.get('indicada_por') == 'sistema' and ini <= mu['indicada_em'] < hoje)
    else:
        rel['multas_para_indicar'] = pend[:80]
    nics = [(e, mu) for e in G['eventos'] for mu in e['multas'] if mu.get('nic')]
    rel['nic'] = {'nesta_semana': [{'mid': mu['mid'], 'motorista': e['motorista'], 'data': e['data'], 'nome': mu['nome'][:80], 'valor_multa': mu['valor'],
                                    'infracoes_iguais_12m': mu['nic']['n'], 'valor_nic': mu['nic']['valor'],
                                    'notificacao': 'não chegou' if mu.get('perdida') else f"chegou em {mu['chegada']}"}
                                   for e, mu in nics if mu['nic']['semana'] == n],
                  'total_ate_agora': len(nics), 'valor_total_rs': round(sum(mu['nic']['valor'] for _, mu in nics), 2),
                  'pago_rs': round(sum(mu['nic']['valor'] * fator_pagamento(mu.get('sne'), False) for _, mu in nics), 2),
                  'regra': 'Sem indicar o condutor até o prazo (30 dias da notificação), a empresa paga a NIC: o valor da multa × o número de multas iguais em 12 meses.'}
    rel['sne'] = {'aderida': bool(G.get('sne_desde')), 'desde': G.get('sne_desde')}
    if g == 'mais':
        recentes = [mu for e in G['eventos'] for mu in e['multas'] if not mu.get('sne') and mu.get('situacao') is None
                    and (INICIO + dt.timedelta(days=st['dia_atual'] - 28)).isoformat() <= e['data']]
        if not G.get('sne_desde'):
            economia = sum(mu['valor'] for mu in recentes) * (PARAMS['pagamento_no_prazo'] - PARAMS['pagamento_sne'])
            rel['sne']['recomendacao'] = ('O painel recomenda aderir ao SNE (Sistema de Notificação Eletrônica): a notificação chega pelo app, sem '
                                          'atraso nem extravio, e a multa sem recurso sai com 40% de desconto em vez de 20%. Nas multas das últimas 4 '
                                          f'semanas, seriam R$ {economia:.2f} a menos.')
        st_p = ((painel or {}).get('prazos') or (0, None))[0]
        rel['sne']['painel_prazos'] = 'ok' if st_p == 200 else f'indisponível (HTTP {st_p})'
        # F1: trechos bloqueados e o desvio que causaram nesta semana
        uso = {}
        for e in evs:
            ids = e.get('bloqueios_evitados') or []
            for i in ids:
                u = uso.setdefault(id_trecho(i), [0, 0.0]); u[0] += 1; u[1] += (e.get('km_desvio_bloqueio') or 0) / len(ids)
        rel['trechos_bloqueados'] = [{'item': b['k'], 'nome': b['nome'], 'desde_semana': b['semana'], 'motivo': b.get('motivo'),
                                      'viagens_que_desviaram_na_semana': uso.get(id_trecho(b['item_id']), [0, 0.0])[0],
                                      'km_a_mais_na_semana': round(uso.get(id_trecho(b['item_id']), [0, 0.0])[1], 1)} for b in G.get('bloqueios') or []]
        s['km_desvio_bloqueios'] = round(sum(e.get('km_desvio_bloqueio') or 0 for e in evs), 1)
        bl = {b['k'] for b in G.get('bloqueios') or []}; bl_ids = {id_trecho(b['item_id']) for b in G.get('bloqueios') or []}
        for p in rel['problemas_conhecidos']:
            p['bloqueado'] = p['item'] in bl or (p['item'].startswith('layer:') and id_trecho(id_do_item(p['item'])) in bl_ids)
            p['bloqueavel'] = p['item'].startswith('layer:') and not p['bloqueado']
        rel['conciliacao_diesel'] = resumo_conciliacao(painel)


def _por_motorista_painel(painel):
    v2p = {v: k for k, v in (painel.get('veiculos') or {}).items()}; d2p = {v: k for k, v in (painel.get('motoristas') or {}).items()}
    return v2p, d2p


def resumo_conciliacao(painel):
    """F2: o painel de conferência do diesel (GET /api/frota/conciliacao-diesel) no relatório da A+, por motorista (m07)."""
    st_, body = (painel or {}).get('conciliacao') or (0, None)
    if st_ != 200 or not isinstance(body, dict): return {'erro': f'painel indisponível (HTTP {st_})'}
    v2p, d2p = _por_motorista_painel(painel)

    def linha(x, pid):
        fp = x.get('fora_do_plano') or {}
        return {'motorista': pid, 'km': x.get('km'), 'litros_esperados': x.get('litros_esperados'), 'litros_comprados': x.get('litros_comprados'),
                'diferenca_l': x.get('diferenca_l'), 'diferenca_pct': x.get('diferenca_pct'), 'fora_do_plano_l': fp.get('litros'),
                'sobrepreco_rs': fp.get('sobrepreco_rs'), 'alertas': [a.get('mensagem') or a.get('tipo') for a in x.get('alertas') or []]}
    placas = [dict(linha(x, v2p.get(x.get('vehicle_id'))), placa=x.get('plate')) for x in body.get('veiculos') or [] if x.get('alertas')]
    mots = [linha(x, d2p.get(x.get('driver_id'))) for x in body.get('por_motorista') or [] if x.get('alertas')]
    res = {k: v for k, v in (body.get('resumo') or {}).items() if k != 'sem_veiculo'}
    return {'fonte': f"painel BrasaWay: conferência do diesel dos últimos {body.get('dias')} dias", 'resumo': res,
            'placas_com_alerta': placas[:20], 'motoristas_com_alerta': mots[:20],
            'como_ler': 'Litros esperados = km ÷ consumo de referência do caminhão. Comprou bem mais do que o esperado: confira desvio de diesel. '
                        'Fora do plano: abasteceu num posto que não é parada do plano da viagem nem conveniado.'}


def verdade_semana(st, g, n, evs, painel):
    """O que a empresa não enxerga (só para o relatório final): o diesel desviado de verdade, as compras fora do plano, as
    notificações perdidas e, na A+, a conferência do painel contra a verdade."""
    G = st['grupos'][g]; M = G['motoristas']
    por_mot = {}
    for e in evs:
        if e.get('diesel_desviado_l'):
            d = por_mot.setdefault(e['motorista'], [0.0, 0.0]); d[0] += e['diesel_desviado_l']; d[1] += e['diesel_desviado_rs']
    compras = {}
    for e in evs:
        for c in e.get('compras') or []: compras[c[4]] = compras.get(c[4], 0.0) + c[0]
    mult = [mu for e in evs for mu in e['multas']]
    out = {'diesel_consumido_l': round(sum(e.get('diesel_consumido_l', 0) for e in evs)),
           'diesel_no_tanque_l': round(sum(e.get('diesel_no_tanque_l', 0) for e in evs)),
           'diesel_cobrado_l': round(sum(e.get('diesel_comprado_l', 0) for e in evs)),
           'diesel_desviado_l': round(sum(v[0] for v in por_mot.values()), 1), 'diesel_desviado_rs': round(sum(v[1] for v in por_mot.values()), 2),
           'desvio_por_motorista': {pid: {'litros': round(v[0], 1), 'rs': round(v[1], 2)} for pid, v in sorted(por_mot.items())},
           'desviadores': {pid: {'desvia': M[pid].get('desvia'), 'parou': M[pid].get('desvio_parou')} for pid in G.get('desviadores') or []},
           'litros_por_tipo_de_compra': {k: round(v) for k, v in sorted(compras.items())},
           # compra pelo plano do motor numa viagem cujo plano na API não tinha parada: foi sem CNPJ (não conta fora do plano)
           'litros_plano_sem_parada_na_api': round(sum(e.get('plano_api_sem_parada_l', 0) for e in evs), 1),
           'multas': len(mult), 'notificacoes_perdidas': sum(1 for mu in mult if mu.get('perdida')),
           'notificacoes_atrasadas': sum(1 for mu in mult if mu.get('atrasada')),
           'nic_semana': sum(1 for e in G['eventos'] for mu in e['multas'] if (mu.get('nic') or {}).get('semana') == n),
           'km_desvio_bloqueios': round(sum(e.get('km_desvio_bloqueio') or 0 for e in evs), 1)}
    if g == 'mais' and painel: out['conferencia_painel'] = conferir_conciliacao(G, painel)
    return out


def conferir_conciliacao(G, painel):
    """F2 contra a verdade: quem o painel apontou (consumo acima do esperado) × quem desviou diesel na mesma janela."""
    st_, body = painel.get('conciliacao') or (0, None)
    if st_ != 200 or not isinstance(body, dict): return {'erro': f'painel indisponível (HTTP {st_})'}
    v2p, d2p = _por_motorista_painel(painel)
    tem = lambda x, tipo: any(a.get('tipo') == tipo for a in x.get('alertas') or [])
    flag_v = {v2p.get(x.get('vehicle_id')) for x in body.get('veiculos') or [] if tem(x, 'consumo_acima')} - {None}
    flag_m = {d2p.get(x.get('driver_id')) for x in body.get('por_motorista') or [] if tem(x, 'consumo_acima')} - {None}
    fora_v = {v2p.get(x.get('vehicle_id')) for x in body.get('veiculos') or [] if tem(x, 'fora_do_plano')} - {None}
    dias = body.get('dias') or PARAMS['conciliacao_dias']
    limite = painel['consultado_em'] - dias * 86400
    janela = [e for e in G['eventos'] if e.get('_enviado_em', 0) >= limite]
    desviou, fora_sim = {}, {}
    for e in janela:
        if e.get('diesel_desviado_l'): desviou[e['motorista']] = desviou.get(e['motorista'], 0.0) + e['diesel_desviado_l']
        f = sum(c[0] for c in e.get('compras') or [] if c[4] != 'plano')
        if f: fora_sim[e['motorista']] = fora_sim.get(e['motorista'], 0.0) + f
    reais, flag = set(desviou), flag_v | flag_m
    return {'janela_dias': dias, 'viagens_na_janela': len(janela),
            'litros_cobrados_sim': round(sum(e.get('diesel_comprado_l', 0) for e in janela), 1),
            'litros_comprados_painel': (body.get('resumo') or {}).get('litros_comprados'),
            'desviaram_na_janela': {pid: round(v, 1) for pid, v in sorted(desviou.items())},
            'alertados_placa': sorted(flag_v), 'alertados_motorista': sorted(flag_m),
            'acertos': sorted(reais & flag), 'falsos_alarmes': sorted(flag - reais), 'nao_pegos': sorted(reais - flag),
            'fora_do_plano_alertados': sorted(fora_v),
            'fora_do_plano_sim_l': round(sum(fora_sim.values()), 1),
            'fora_do_plano_painel_l': ((body.get('resumo') or {}).get('fora_do_plano') or {}).get('litros')}


# ------------------------------------------------------------------ final
def final():
    st = load(OUT / 'estado.json'); res = {}
    for g in GRUPOS:
        G = st['grupos'][g]; evs = G['eventos']
        multas = [mu for e in evs for mu in e['multas']]
        pagas = [mu for mu in multas if mu.get('situacao') != 'cancelada']
        extra = sum(c['valor'] for c in G['custos_extra'])
        plan = len(evs) * PARAMS['planejamento_min_viagem'].get(g, PARAMS['planejamento_min_viagem']['com']) / 60 * PARAMS['custo_hora_roteirista']
        mens = PARAMS['mensalidade_veiculo'] * len(G['motoristas']) * DIAS / 30 if usa_app(g) else 0
        susp = sum(1 for m in G['motoristas'].values() for l in m['linhas'] if not l.get('ativa', True))
        pts = {pid: sum(x['pontos'] for x in m['pontos']) for pid, m in G['motoristas'].items()}
        res[g] = {
            'viagens': len(evs), 'km': soma(evs, 'km'), 'horas_ao_volante': soma(evs, 'horas'),
            'multas': len(multas), 'multas_rs': round(sum(m['valor'] for m in pagas), 2), 'multas_canceladas': len(multas) - len(pagas),
            'pontos_cnh_total': sum(pts.values()), 'motoristas_20+_pontos': sum(1 for v in pts.values() if v >= 20),
            'retornos': sum(e['retornos'] for e in evs), 'colisoes': sum(e['colisoes'] for e in evs),
            'colisoes_rs': sum(e['colisoes'] for e in evs) * PARAMS['colisao_rs'],
            'atrasos': sum(e['atraso'] for e in evs), 'atrasos_rs': sum(e['atraso'] for e in evs) * PARAMS['atraso_rs'],
            'diesel_rs': soma(evs, 'custo_diesel'), 'motorista_rs': soma(evs, 'custo_motorista'),
            'planejamento_rs': round(plan, 2), 'decisoes_custos_rs': extra, 'mensalidade_rs': mens,
            'linhas_suspensas': susp,
            'passagens_irregulares': sum(len(e['violacoes']) for e in evs),
            'por_camada': {}, 'por_uf': {},
        }
        for e in evs:
            for v in e['violacoes']:
                res[g]['por_camada'][v['layer'] or '?'] = res[g]['por_camada'].get(v['layer'] or '?', 0) + 1
            uf = LOCAIS[e['destino']]['uf']
            u = res[g]['por_uf'].setdefault(uf, {'viagens': 0, 'multas': 0, 'retornos': 0, 'passagens_irregulares': 0})
            u['viagens'] += 1; u['multas'] += len(e['multas']); u['retornos'] += e['retornos']; u['passagens_irregulares'] += len(e['violacoes'])
        r = res[g]
        r['custo_total_rs'] = round(r['multas_rs'] + r['colisoes_rs'] + r['atrasos_rs'] + r['diesel_rs'] + r['motorista_rs']
                                    + r['planejamento_rs'] + r['decisoes_custos_rs'] + r['mensalidade_rs'], 2)
        if V2:
            cons = sum(e.get('diesel_consumido_l', 0) for e in evs); compr = sum(e.get('diesel_comprado_l', 0) for e in evs)
            gasto = sum(e.get('diesel_gasto_rs', 0) for e in evs)
            r['diesel_litros_consumidos'] = round(cons); r['diesel_litros_comprados'] = round(compr); r['diesel_gasto_rs'] = round(gasto, 2)
            r['diesel_preco_medio_pago'] = round(gasto / compr, 3) if compr else None
            r['diesel_custo_do_consumido_rs'] = round(cons * gasto / compr, 2) if compr else None
            r['multas_presenciais'] = sum(1 for mu in multas if mu.get('presencial'))
            r['multas_com_feedback'] = sum(1 for mu in multas if mu.get('feedback'))
            r['alertas_ao_vivo_que_evitaram'] = sum(e.get('evitadas_alerta', 0) for e in evs)
            # custo total da 2.0 usa o diesel efetivamente pago (consumido × preço médio pago), não o diesel fixo da 1.0
            r['custo_total_rs'] = round(r['custo_total_rs'] - r['diesel_rs'] + (r['diesel_custo_do_consumido_rs'] or r['diesel_rs']), 2)
        if usa_app(g):
            r['evitadas_pelo_app'] = sum(e['evitadas_app'] for e in evs)
            r['viagens_ignorando_app'] = sum(e['rota'] == 'ignorou_app' for e in evs)
            r['avisos_de_risco'] = sum(e.get('avisos_risco', 0) for e in evs)
        if V3: final3(r, G, evs)
        r['decisoes'] = G['decisoes_aplicadas']; r['mensagens'] = G['mensagens']
    res['params'] = PARAMS
    if V3: res['premissas'] = premissas3(load(OUT / 'personas.json') or [])
    save(OUT / 'resultado.json', res)
    print(json.dumps({g: {k: v for k, v in res[g].items() if not isinstance(v, (dict, list))} for g in GRUPOS}, ensure_ascii=False, indent=1))


def nic_certas_no_fim(evs, fim_iso):
    """P4 no fim da simulação: multa com a notificação extraviada e o prazo depois do fim. Ninguém pode indicar o condutor
    (a notificação não chega, nem o sistema nem a equipe a veem), então a NIC é certa; só não venceu dentro dos dias
    simulados (o prazo é a infração + 21 + 30 dias: só as extraviadas até ~51 dias antes do fim viram NIC na simulação).
    {mid: {'n', 'valor'}} com o n e o valor da NIC como em processar_prazos."""
    todas = [(e['data'], mu['k']) for e in evs for mu in e['multas'] if mu.get('situacao') != 'cancelada']
    out = {}
    for e in evs:
        for mu in e['multas']:
            if mu.get('perdida') and pendente_indicacao(mu) and mu.get('prazo') and mu['prazo'] >= fim_iso:
                n = nic_n(todas, mu['k'], e['data'])
                out[mu['mid']] = {'n': n, 'valor': round(mu['valor'] * n, 2)}
    return out


def final3(r, G, evs):
    """3.0: custos com o modelo novo: multas pagas com desconto (P5), NIC (P4), diesel desviado (P2) e o desvio de rota
    causado pelos trechos bloqueados (F1, já dentro do diesel e das horas; aqui separado para o relatório)."""
    fim = (INICIO + dt.timedelta(days=DIAS)).isoformat()
    mult = [(e, mu) for e in evs for mu in e['multas']]
    cheio = pago = desc_sne = 0.0
    for e, mu in mult:
        if mu.get('situacao') == 'cancelada': continue
        cheio += mu['valor']; pago += mu['valor'] * fator_pagamento(mu.get('sne'), mu.get('situacao') is not None)
        if mu.get('sne') and mu.get('situacao') is None: desc_sne += mu['valor'] * (PARAMS['pagamento_no_prazo'] - PARAMS['pagamento_sne'])
    nics = [mu for _, mu in mult if mu.get('nic')]
    certas = nic_certas_no_fim(evs, fim)
    fp_cert = fator_pagamento(False, False)          # extraviada só acontece sem SNE
    # NIC por causa: notificação extraviada (o SNE evita) × chegou e ninguém indicou a tempo (a indicação automática evita)
    causa = {'extraviada': [0, 0.0], 'nao_indicada': [0, 0.0]}
    for mu in nics:
        c = causa['extraviada' if mu.get('perdida') else 'nao_indicada']; c[0] += 1; c[1] += mu['nic']['valor'] * fator_pagamento(mu.get('sne'), False)
    for x in certas.values():
        causa['extraviada'][0] += 1; causa['extraviada'][1] += x['valor'] * fp_cert
    # compra fora do posto do plano (P1): o que pagou a mais que o preço do plano da viagem
    preco_pl = [(c[0], c[1]) for e in evs for c in e.get('compras') or [] if c[4] == 'plano']
    preco_pl_medio = sum(l * p_ for l, p_ in preco_pl) / sum(l for l, _ in preco_pl) if preco_pl and sum(l for l, _ in preco_pl) else None
    sobre = 0.0
    for e in evs:
        ref = e.get('preco_plano') or preco_pl_medio
        if ref is None: continue
        sobre += sum(c[0] * max(0.0, c[1] - ref) for c in e.get('compras') or [] if c[4] == 'fora_do_plano')
    ind, fontes, tipos = {}, {}, {}
    for _, mu in mult:
        if mu.get('indicada_em'): ind[mu.get('indicada_por')] = ind.get(mu.get('indicada_por'), 0) + 1
        fontes[mu.get('fonte') or '?'] = fontes.get(mu.get('fonte') or '?', 0) + 1
    for e in evs:
        for c in e.get('compras') or []: tipos[c[4]] = tipos.get(c[4], 0.0) + c[0]
    cons = sum(e.get('diesel_consumido_l', 0) for e in evs); compr = sum(e.get('diesel_comprado_l', 0) for e in evs)
    gasto = sum(e.get('diesel_gasto_rs', 0) for e in evs); preco = gasto / compr if compr else 0.0
    desv_rs = sum(e.get('diesel_desviado_rs', 0) for e in evs)
    km_b = km_b_rs = 0.0
    for e in evs:
        kd = e.get('km_desvio_bloqueio') or 0
        if kd:
            vel = max(15.0, e['km'] / max(e['horas'], 0.01))
            km_b += kd; km_b_rs += kd / PARAMS['km_por_litro'][e['veiculo']] * preco + kd / vel * PARAMS['custo_hora_motorista']
    desv_mot = {}
    for e in evs:
        if e.get('diesel_desviado_l'):
            d = desv_mot.setdefault(e['motorista'], [0.0, 0.0]); d[0] += e['diesel_desviado_l']; d[1] += e['diesel_desviado_rs']
    M = G['motoristas']
    r.update({
        'multas_rs_valor_cheio': round(cheio, 2), 'multas_rs': round(pago, 2), 'multas_desconto_rs': round(cheio - pago, 2),
        'multas_com_sne': sum(1 for _, mu in mult if mu.get('sne')), 'condutor_indicado': ind, 'multas_por_fonte': fontes,
        'nic': len(nics), 'nic_rs_valor_cheio': round(sum(mu['nic']['valor'] for mu in nics), 2),
        'nic_rs': round(sum(mu['nic']['valor'] * fator_pagamento(mu.get('sne'), False) for mu in nics), 2),
        'nic_notificacao_perdida': sum(1 for mu in nics if mu.get('perdida')),
        # NIC já certa no fim (notificação extraviada, prazo depois do último dia): entra no custo, separada das cobradas
        'nic_certa_no_fim': len(certas), 'nic_certa_no_fim_rs_valor_cheio': round(sum(x['valor'] for x in certas.values()), 2),
        'nic_certa_no_fim_rs': round(sum(x['valor'] for x in certas.values()) * fp_cert, 2),
        'nic_certa_no_fim_mid': {k: round(v['valor'] * fp_cert, 2) for k, v in certas.items()},
        'nic_por_causa': {k: {'n': v[0], 'rs': round(v[1], 2)} for k, v in causa.items()},
        'multas_desconto_sne_rs': round(desc_sne, 2),
        # no fim, ainda no prazo e sem indicação (a notificação chegou ou vai chegar): pode virar NIC ou não
        'multas_aguardando_indicacao_no_fim': sum(1 for _, mu in mult if pendente_indicacao(mu) and not mu.get('perdida') and mu.get('prazo') and mu['prazo'] >= fim),
        'notificacoes_perdidas': sum(1 for _, mu in mult if mu.get('perdida')),
        'notificacoes_atrasadas': sum(1 for _, mu in mult if mu.get('atrasada')),
        'sne_desde': G.get('sne_desde'),
        'diesel_desviado_l': round(sum(e.get('diesel_desviado_l', 0) for e in evs)), 'diesel_desviado_rs': round(desv_rs, 2),
        'diesel_custo_do_consumido_rs': round(cons * preco, 2),
        'diesel_custo_rs': round(cons * preco + desv_rs, 2),     # consumido ao preço pago + o desviado (pago e não posto no tanque)
        'diesel_litros_por_tipo_de_compra': {k: round(v) for k, v in sorted(tipos.items())},
        'fora_do_plano_sobrepreco_rs': round(sobre, 2),
        'km_desvio_bloqueios': round(km_b, 1), 'km_desvio_bloqueios_rs': round(km_b_rs, 2),
        'evitadas_por_orientacao': sum(e.get('evitadas_orientacao', 0) for e in evs),
        'desviadores': {pid: {'parou': M[pid].get('desvio_parou'), 'litros': round(desv_mot.get(pid, [0, 0])[0], 1),
                              'rs': round(desv_mot.get(pid, [0, 0])[1], 2)} for pid in G.get('desviadores') or []},
        'bloqueios': G.get('bloqueios') or [], 'bloqueios_removidos': G.get('bloqueios_removidos') or [], 'cobrancas': G.get('cobrancas') or [],
        'conveniados': len(G.get('conveniados') or []),
    })
    r['custo_total_rs'] = round(r['multas_rs'] + r['nic_rs'] + r['nic_certa_no_fim_rs'] + r['colisoes_rs'] + r['atrasos_rs'] + r['diesel_custo_rs']
                                + r['motorista_rs'] + r['planejamento_rs'] + r['decisoes_custos_rs'] + r['mensalidade_rs'], 2)


def _n(v, casas=2):
    return f'{v:,.{casas}f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


def premissas3(personas):
    """Premissas da 3.0 (e as da 2.0 que pesam na comparação), com os valores usados, para o relatório final."""
    p = PARAMS3 if not V3 else PARAMS
    ap, cn, ct, dc = p['adesao_posto'], p['cobrar_nomeado'], p['cobrar_todos'], p['desvio_de_cabeca']
    pa = PARAMS['p_autuacao']
    return [
        {'id': 'P1', 'nome': 'Adesão ao posto do plano', 'valor': f"{_n(ap['mais_barato_que_conhece'])} (hábito “mais barato que conhece” ou “cartão da empresa”); {_n(ap['outros'])} (os outros)",
         'texto': 'Seguindo a rota do app, o motorista compra no posto do plano com essa chance; senão, no posto de costume, ao preço médio da rota ajustado pelo hábito (como quem ignora o app).'},
        {'id': 'P2', 'nome': 'Desvio de diesel', 'valor': f"{p['desviadores_n']} motoristas ({', '.join(desviadores(personas, p['desviadores_n']))}); {_n(p['desvio_pct'] * 100, 0)}% a mais de litros",
         'texto': 'Motoristas sorteados pelo id (sorteio fixo, sem olhar o perfil: as equipes leem as personas e não têm como adivinhar quem desvia) '
                  'cobram a mais do que põem no tanque em todo abastecimento, até serem paradas. Os mesmos gêmeos nas três empresas.'},
        {'id': 'P3', 'nome': 'Notificação pelo correio', 'valor': f"{PARAMS['aviso_multa_dias']} dias; {_n(p['p_notificacao_atrasa'] * 100, 0)}% chegam {p['notificacao_atraso_dias']} dias depois; {_n(p['p_notificacao_perdida'] * 100, 0)}% se perdem",
         'texto': 'Sem SNE. Com SNE, chega no prazo, sem atraso nem extravio. Multa presencial: o condutor é identificado na hora (não precisa indicar).'},
        {'id': 'P4', 'nome': 'NIC', 'valor': f"prazo = chegada + {p['prazo_indicacao_dias']} dias; NIC = valor × n (mesma restrição em {p['nic_janela_dias']} dias)",
         'texto': 'Sem indicação do condutor até o prazo (ou sem notificação), a empresa paga a multa por não identificação. Indicada, os pontos vão para o motorista. '
                  'Notificação extraviada com o prazo vencendo depois do último dia simulado (infração + 51 dias): ninguém pode indicar, e a NIC entra no custo como já certa.'},
        {'id': 'P5', 'nome': 'Pagamento das multas', 'valor': f"{_n(p['pagamento_no_prazo'] * 100, 0)}% do valor; {_n(p['pagamento_sne'] * 100, 0)}% com SNE (sem recurso)",
         'texto': 'Todas pagas no prazo com desconto; a NIC também.'},
        {'id': 'F3', 'nome': 'Indicação automática (A+)', 'valor': f"até {p['indicacao_automatica_dias']} dias depois da notificação",
         'texto': 'O sistema indica o condutor de toda multa notificada com motorista conhecido.'},
        {'id': 'A1', 'nome': 'Cobrar abastecimento (nominal)', 'valor': f"+{_n(cn['adesao_posto_mais'])} na adesão ao posto (até {_n(cn['adesao_posto_max'])}); desviador para com chance {_n(cn['p_para_desvio'])}; no máximo {cn['max_semana']} motoristas por semana",
         'texto': 'A equipe cobra um motorista pelo nome (uma conversa do gerente; os nomes além do limite da semana ficam sem conversa).'},
        {'id': 'A2', 'nome': 'Cobrar abastecimento (todos)', 'valor': f"+{_n(ct['adesao_posto_mais'])} na adesão de todos; cada desviador para com chance {_n(ct['p_para_desvio'])}",
         'texto': 'Cobrança geral, sem saber quem.'},
        {'id': 'F1', 'nome': 'Trecho bloqueado conhecido', 'valor': _n(p['conhece_bloqueado']),
         'texto': 'Quem ignora a rota do app conhece o trecho bloqueado pela empresa pelo menos com essa chance. A rota do app desvia do trecho se houver qualquer caminho.'},
        {'id': 'O1', 'nome': 'Desvio por orientação', 'valor': f"orientação × (1 − 0,3 × risco); +{_n(dc['km_pct'] * 100, 0)}% de km e {dc['min']} min",
         'texto': 'Motorista orientado sobre um trecho “sem alternativa” da rota do app desvia por conta própria (orientar 0,75; conversa sobre a multa 0,85).'},
        {'id': '2.0', 'nome': 'Autuação por passagem irregular', 'valor': f"zona {_n(pa['zone'])}; restrições RMSP {_n(pa['restricoes_rmsp'])}; rodovias com horário {_n(pa['rodovias_horario'])}; perigosos {_n(pa['perigosos'])}; outras {_n(pa['outro'])}",
         'texto': 'Chance de virar multa em cada passagem (câmera ou agente).'},
        {'id': '2.0', 'nome': 'Multa presencial', 'valor': _n(PARAMS['p_multa_presencial']), 'texto': 'Parte das autuações feita por agente na hora.'},
        {'id': '2.0', 'nome': 'Alerta ao vivo evita', 'valor': _n(PARAMS['p_alerta_ao_vivo_evita']), 'texto': 'Motorista fora da rota do app que recebe o alerta e volta.'},
        {'id': '2.0', 'nome': 'Valor das multas', 'valor': f"média R$ {_n(PARAMS['multa']['media'][0])} ({PARAMS['multa']['media'][1]} pontos); grave R$ {_n(PARAMS['multa']['grave'][0])} ({PARAMS['multa']['grave'][1]} pontos)",
         'texto': 'CTB.'},
        {'id': '2.0', 'nome': 'Mensalidade do BrasaWay', 'valor': f"R$ {_n(PARAMS['mensalidade_veiculo'])} por caminhão por mês (A e A+)", 'texto': 'As novidades entram no mesmo plano.'},
        {'id': '2.0', 'nome': 'Planejamento', 'valor': f"{PARAMS['planejamento_min_viagem']['com']} min por viagem com o app; {PARAMS['planejamento_min_viagem']['sem']} min sem, a R$ {_n(PARAMS['custo_hora_roteirista'])}/h",
         'texto': 'Tempo do roteirista.'},
        {'id': 'F2', 'nome': 'Janela da conferência do diesel', 'valor': f"{p['conciliacao_dias']} dias (pedido ao painel)",
         'texto': 'A simulação roda as semanas em horas: a janela de 7 dias do painel cobre tudo o que já foi enviado.'},
        {'id': 'F2', 'nome': 'Tolerância da conferência do diesel', 'valor': f"{_n(p['conciliacao_tolerancia_pct'], 0)}% acima do esperado (a padrão do painel)",
         'texto': 'O painel compara com o consumo de referência do cadastro do caminhão, não com o consumo de cada motorista: quem gasta mais '
                  f"que a referência é apontado mesmo sem desviar, e o desviador que gasta menos que ela pode ficar abaixo da tolerância (o desvio é de {_n(p['desvio_pct'] * 100, 0)}%)."},
    ]


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'preparar': preparar_frota()
    elif cmd == 'semana': rodar_semana(int(sys.argv[2]))
    elif cmd == 'aquecer': aquecer(int(sys.argv[2]))
    elif cmd == 'final': final()
    else: sys.exit(__doc__)
