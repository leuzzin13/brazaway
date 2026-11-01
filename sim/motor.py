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

Uso:
  python3 sim/motor.py preparar            # cria as empresas e motoristas no banco (Frota) e o estado inicial
  python3 sim/motor.py semana N            # roda a semana N (1..9) com as decisões da semana N-1 e grava o relatório
  python3 sim/motor.py final               # consolida tudo em sim/out/resultado.json
"""
import base64, datetime as dt, hashlib, hmac, json, math, os, random, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = Path(os.environ.get('SIM_OUT', ROOT / 'out'))
API = os.environ.get('SIM_API', 'http://localhost:3000')
VALHALLA = os.environ.get('SIM_VALHALLA', 'http://localhost:8002')
JWT_SECRET = os.environ.get('FROTA_DEV_JWT_SECRET', 'dev-secret-troque')
INICIO = dt.date(2026, 9, 1)          # terça-feira
DIAS = int(os.environ.get('SIM_DIAS', '60'))
FERIADOS = {dt.date(2026, 9, 7), dt.date(2026, 10, 12), dt.date(2026, 11, 2), dt.date(2026, 11, 15), dt.date(2026, 11, 20)}
V2 = os.environ.get('SIM_V2') == '1'   # simulação 2.0: diesel, multas no app, alerta ao vivo, janelas
GRUPOS = ('com', 'sem')

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


def call(method, path, token, body=None, timeout=60):
    h = {'authorization': 'Bearer ' + token}
    data = None
    if body is not None:
        h['content-type'] = 'application/json'; data = json.dumps(body).encode()
    req = urllib.request.Request(API + path, data=data, headers=h, method=method)
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


def rota_legal(o, d, preset, hazmat, data, hora, aetc=False):
    k = 'L|' + chave(o, d, preset, hazmat, data, hora, aetc)
    with cache_lock:
        if k in CACHE: return CACHE[k]
    a, b = LOCAIS[o], LOCAIS[d]
    body = {'origin': {'lat': a['lat'], 'lon': a['lon']}, 'destination': {'lat': b['lat'], 'lon': b['lon']},
            'vehicle': {'preset': preset, **({'hazmat': True} if hazmat else {}), **({'has_aetc': True} if aetc else {})},
            'departure_at': f'{data.isoformat()}T{hora:02d}:00'}
    st, r = post(API + '/api/route', body)
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
    elif st == 409:
        res = {'ok': False, 'motivo': (r or {}).get('message', 'sem rota')}
    else:
        raise RuntimeError(f'/api/route {st}: {str(r)[:200]}')
    with cache_lock: CACHE[k] = res
    return res


def rota_gps_carro(o, d, preset, hazmat, data, hora, aetc=False):
    k = 'G|' + chave(o, d, preset, hazmat, data, hora, aetc)
    with cache_lock:
        if k in CACHE: return CACHE[k]
    a, b = LOCAIS[o], LOCAIS[d]
    st, v = post(VALHALLA + '/route', {'locations': [{'lat': a['lat'], 'lon': a['lon']}, {'lat': b['lat'], 'lon': b['lon']}],
                                       'costing': 'auto', 'units': 'km'})
    if st != 200: raise RuntimeError(f'valhalla auto {st}: {str(v)[:200]}')
    shape = decode6(v['trip']['legs'][0]['shape'])
    body = {'origin': {'lat': a['lat'], 'lon': a['lon']}, 'destination': {'lat': b['lat'], 'lon': b['lon']},
            'vehicle': {'preset': preset, **({'hazmat': True} if hazmat else {}), **({'has_aetc': True} if aetc else {})},
            'departure_at': f'{data.isoformat()}T{hora:02d}:00', 'coordinates': shape}
    st, e = post(API + '/api/sim/avaliar', body)
    if st != 200: raise RuntimeError(f'/api/sim/avaliar {st}: {str(e)[:200]}')
    res = {'km': v['trip']['summary']['length'], 'seg_carro': v['trip']['summary']['time'],
           'cruza': [item_min(x) for x in e['crossed']],
           'zona_destino': [w.get('message', '') for w in e.get('endpoint_warnings') or []]}
    with cache_lock: CACHE[k] = res
    return res


CONVENIOS = {'com': []}       # postos com desconto no PIX fechados pela empresa com o app (preenchido pelo estado)


def plano_abast(o, d, preset, hazmat, data, hora, aetc, nivel_pct):
    """Plano de abastecimento do BrasaWay para a linha, saindo com nivel_pct (em faixas de 10%). Também traz o preço médio
    dos postos com preço a até 2 km da rota, que é o que paga quem abastece em qualquer posto do caminho."""
    faixa = min(FAIXAS, key=lambda f: abs(f - nivel_pct))
    # preço de posto não muda com a hora: o plano vale por linha, caminhão e faixa de nível (bem menos cálculo)
    data, hora = dt.date(2026, 11, 3), 10
    conv = CONVENIOS['com']
    cv = hashlib.md5(json.dumps(sorted((c['cnpj'], c['desconto_rs_l']) for c in conv)).encode()).hexdigest()[:8] if conv else '0'
    k = f'P2|{o}|{d}|{preset}|{int(bool(hazmat))}|{int(bool(aetc))}|{faixa}|{cv}'
    with cache_lock:
        if k in CACHE: return CACHE[k]
    a, b = LOCAIS[o], LOCAIS[d]
    body = {'origin': {'lat': a['lat'], 'lon': a['lon']}, 'destination': {'lat': b['lat'], 'lon': b['lon']},
            'vehicle': {'preset': preset, **({'hazmat': True} if hazmat else {}), **({'has_aetc': True} if aetc else {})},
            'departure_at': f'{data.isoformat()}T{hora:02d}:00',
            'abastecimento': {'nivel_pct': faixa, 'tanque_l': PARAMS['tanque_l'][preset], 'consumo_km_l': PARAMS['km_por_litro'][preset],
                              'conveniados': [{'cnpj': c['cnpj'], 'desconto_rs_l': c['desconto_rs_l'], 'pagamento': 'PIX'} for c in conv]}}
    st, r = post(API + '/api/route', body)
    pl = (r or {}).get('plano_abastecimento') if st == 200 else None
    res = {'litros': pl['litros'], 'custo': pl['custo_rs'], 'media': pl['preco_medio_rota_rs_l'], 'paradas': len(pl['paradas']),
           'chega_com_l': pl['chega_com_l'],
           'postos': [[x['cnpj'], x['posto'][:60], x['litros'], x['preco_rs_l'], x['origem_preco']] for x in pl['paradas']]} if pl else \
          {'litros': 0, 'custo': 0, 'media': None, 'paradas': 0, 'chega_com_l': None, 'postos': []}
    with cache_lock: CACHE[k] = res
    return res


FAIXAS = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95]


def planos_linha(o, d, preset, hazmat, aetc):
    """Planos de todas as faixas de nível de uma linha numa só rota (abastecimento.niveis_pct): 11× menos cálculo de rota."""
    conv = CONVENIOS['com']
    cv = hashlib.md5(json.dumps(sorted((c['cnpj'], c['desconto_rs_l']) for c in conv)).encode()).hexdigest()[:8] if conv else '0'
    chaves = {f: f'P2|{o}|{d}|{preset}|{int(bool(hazmat))}|{int(bool(aetc))}|{f}|{cv}' for f in FAIXAS}
    with cache_lock:
        if all(k in CACHE for k in chaves.values()): return
    a, b = LOCAIS[o], LOCAIS[d]
    body = {'origin': {'lat': a['lat'], 'lon': a['lon']}, 'destination': {'lat': b['lat'], 'lon': b['lon']},
            'vehicle': {'preset': preset, **({'hazmat': True} if hazmat else {}), **({'has_aetc': True} if aetc else {})},
            'departure_at': '2026-11-03T10:00',
            'abastecimento': {'niveis_pct': FAIXAS, 'tanque_l': PARAMS['tanque_l'][preset], 'consumo_km_l': PARAMS['km_por_litro'][preset],
                              'conveniados': [{'cnpj': c['cnpj'], 'desconto_rs_l': c['desconto_rs_l'], 'pagamento': 'PIX'} for c in conv]}}
    st, r = post(API + '/api/route', body)
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
    costume, ao preço médio dos postos da rota ajustado pelo hábito dele."""
    tanque = PARAMS['tanque_l'][preset]
    cons = PARAMS['km_por_litro'][preset] / float(m.get('fator_consumo', 1.0))
    usa = km / cons
    nivel = m.setdefault('nivel_l', tanque * 0.6)
    pl = plano_abast(o, d, preset, hz, data, hora, bool(m.get('aetc')), 100 * nivel / tanque)
    media = pl['media'] or PARAMS['preco_diesel_padrao']
    comprado = 0.0; gasto = 0.0
    if g == 'com' and segue_app and pl['litros']:
        comprado = pl['litros']; gasto = pl['custo']
        nivel = min(tanque, nivel + comprado) - usa
        uso = m.setdefault('_uso_postos', {})
        for cnpj, nome, litros, preco, origem in pl.get('postos') or []:
            u = uso.setdefault(cnpj, [nome, 0.0, 0.0]); u[1] += litros; u[2] += litros * preco
    else:
        nivel -= usa
    # quem segue o app abastece pelo plano da próxima viagem; só cai no posto de costume numa emergência (abaixo de 10%)
    limite = 0.10 if (g == 'com' and segue_app and pl['media'] is not None) else PARAMS['abastece_abaixo_pct']
    if nivel < tanque * limite:
        litros = tanque * PARAMS['enche_ate_pct'] - max(nivel, 0)
        preco = media * (1 + PARAMS['habito_preco'].get(m.get('habito', 'posto_de_costume'), 0.0))
        comprado += litros; gasto += litros * preco
        nivel = tanque * PARAMS['enche_ate_pct']
    m['nivel_l'] = max(0.0, nivel)
    ev['diesel_consumido_l'] = round(usa, 1); ev['diesel_comprado_l'] = round(comprado, 1); ev['diesel_gasto_rs'] = round(gasto, 2)
    ev['preco_medio_rota'] = media


def item_min(x):
    return {'k': f"{x.get('kind')}:{x.get('layer') or ''}:{x.get('id')}", 'kind': x.get('kind'), 'layer': x.get('layer'),
            'type': x.get('type'), 'name': x.get('name'), 'rule': x.get('rule'), 'value_num': x.get('value_num')}


def simplificar(coords, n):
    if len(coords) <= n: return coords
    passo = (len(coords) - 1) / (n - 1)
    return [coords[round(i * passo)] for i in range(n)]


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
    for g in GRUPOS:
        mot = {}
        for p in personas:
            mot[p['id']] = {
                'veiculo': p['veiculo'], 'hazmat': bool(p.get('carga_perigosa')),
                'linhas': [dict(l, ativa=True) for l in p['linhas']],
                'conhece': {},                                   # item -> 0..1 aprendido
                'regional': p.get('conhecimento_regional') or {},
                'risco': float(p.get('tolerancia_risco', 0.3)),
                'adesao': float(p.get('adesao_app', 0.8)) if g == 'com' else 0.0,
                'pontos': [], 'parado_ate': None, 'treinado': 0.0,
                # 2.0: combustível (gêmeos começam iguais)
                'fator_consumo': float(p.get('fator_consumo') or (1.0 + (int(hashlib.md5(p['id'].encode()).hexdigest(), 16) % 17 - 8) / 100)),
                'habito': p.get('habito_abastecimento') or ('cartao_da_empresa' if p.get('vinculo') == 'clt' else 'posto_de_costume'),
                'nivel_l': PARAMS['tanque_l'][p['veiculo']] * (0.4 + (int(hashlib.md5(('n' + p['id']).encode()).hexdigest(), 16) % 41) / 100),
            }
        st['grupos'][g] = {'motoristas': mot, 'eventos': [], 'custos_extra': [], 'mensagens': [], 'decisoes_aplicadas': []}
    return st


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
    legal = rota_legal(o, d, preset, hz, data, hora, aetc)
    gps = rota_gps_carro(o, d, preset, hz, data, hora, aetc)
    ev = {'grupo': g, 'motorista': pid, 'data': data.isoformat(), 'hora': hora, 'origem': o, 'destino': d, 'veiculo': preset,
          'multas': [], 'retornos': 0, 'colisoes': 0, 'evitadas_app': 0, 'evitadas_conhecimento': 0, 'violacoes': []}
    segue_app = g == 'com' and legal.get('ok') and rng.random() < m['adesao']
    if segue_app:
        km, seg = legal['km'], legal['seg']
        ev['rota'] = 'app'; ev['evitadas_app'] = len(legal['evitou'])
        ev['avisos_risco'] = legal['avisos_risco']
        # trechos restritos sem alternativa e entrega dentro de zona: o app avisa, mas a passagem existe
        expostos = [{'k': 'zona_destino:' + d, 'kind': 'zone', 'name': msg[:400], 'layer': None} for msg in legal['zona_destino']]
        expostos += [{'k': 'sem_alt:' + msg[:60], 'kind': 'layer', 'layer': 'restricoes_rmsp', 'name': msg[:120]} for msg in legal['restrito_sem_alternativa']]
        avisado = True
    else:
        ev['rota'] = 'gps_carro' if g == 'sem' else 'ignorou_app'
        cruza = gps['cruza']
        expostos = list(cruza) + [{'k': 'zona_destino:' + d, 'kind': 'zone', 'name': msg[:120], 'layer': None} for msg in gps['zona_destino']]
        avisado = g == 'com'
        nao_evitadas = []
        ev['evitadas_alerta'] = 0
        for it in cruza:
            k = conhecimento(m, it, uf) + (0.2 if avisado else 0.0)
            if rng.random() < k and rng.random() > m['risco'] * 0.3:
                ev['evitadas_conhecimento'] += 1
            elif V2 and g == 'com' and rng.random() < PARAMS['p_alerta_ao_vivo_evita']:
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

    def multa_motorista(self, pid, mu, ev):
        """Multa presencial: o motorista registra pelo app na hora."""
        st, r = call('POST', '/api/frota/multas', self.tok[pid], {'ocorrida_em': f"{ev['data']}T{ev['hora']:02d}:30:00-03:00",
            'descricao': f"Fui parado: {mu['nome']}", 'local': LOCAIS[ev['destino']]['nome']})
        if st == 201: mu['api_id'] = r['id']
        else: self.erros += 1

    def multa_equipe(self, mu, ev):
        """Notificação chegou: a equipe completa (ou registra) a multa no painel."""
        corpo = {'status': 'notificada', 'gravidade': 'media' if mu['gravidade'] == 'media' else 'grave', 'valor_cents': int(round(mu['valor'] * 100)),
                 'pontos': mu['pontos'], 'enquadramento': mu['nome'][:200], 'prazo_indicacao': (dt.date.fromisoformat(mu['aviso_em']) + dt.timedelta(days=15)).isoformat()}
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


# ------------------------------------------------------------------ preparar
def preparar():
    personas = load(OUT / 'personas.json')
    if not personas: sys.exit('falta sim/out/personas.json')
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


# ------------------------------------------------------------------ decisões
def aplicar_decisoes(st, semana, frota):
    for g in GRUPOS:
        dec = load(OUT / 'decisoes' / f'semana_{semana}_{g}.json')
        if not dec: continue
        G = st['grupos'][g]; M = G['motoristas']
        alvo = lambda lst: list(M) if (not lst or 'todos' in lst) else [x for x in lst if x in M]
        for a in dec.get('acoes', []):
            t = a.get('acao'); aplicada = True
            if t == 'orientar':
                for pid in alvo(a.get('motoristas')):
                    for k in a.get('itens', []):
                        M[pid]['conhece'][k] = max(M[pid]['conhece'].get(k, 0.0), 0.75)
                    M[pid]['risco'] *= 0.9
            elif t == 'mudar_horario' and a.get('motorista') in M:
                ls = M[a['motorista']]['linhas']; i = int(a.get('linha', 0))
                if 0 <= i < len(ls): ls[i]['hora_saida'] = int(a['hora']) % 24
                else: aplicada = False
            elif t == 'trocar_veiculo' and a.get('motorista') in M and a.get('preset') in PARAMS['km_por_litro']:
                m = M[a['motorista']]
                m['fator_viagens'] = PARAMS['carga_t'][m['veiculo']] / PARAMS['carga_t'][a['preset']] * m.get('fator_viagens', 1.0)
                m['veiculo'] = a['preset']
            elif t == 'cadastrar_aetc' and a.get('motorista') in M:
                M[a['motorista']]['aetc'] = True          # autorização de VUC em SP (vale para VUC; nos outros não muda nada)
                G['custos_extra'].append({'semana': semana, 'tipo': 'aetc', 'valor': 0})
            elif t == 'advertir' and a.get('motorista') in M:
                M[a['motorista']]['risco'] *= 0.6
            elif t == 'exigir_app' and g == 'com' and a.get('motorista') in M:
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
                            n += 1; mu['situacao'] = 'cancelada' if rng.random() < PARAMS['p_recurso_ok'] else 'mantida'
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
                        if g == 'com' and frota: frota.feedback(mu, a.get('nota') or 'Conversa sobre a multa')
            elif t == 'renegociar_janela' and a.get('motorista') in M:
                ls = M[a['motorista']]['linhas']; i = int(a.get('linha', 0))
                aceita = random.Random(f"jan|{g}|{a['motorista']}|{i}|{semana}").random() < PARAMS['p_cliente_aceita_janela']
                if 0 <= i < len(ls) and aceita and a.get('ate') is not None:
                    ls[i]['janela_entrega_ate'] = float(a['ate'])
                else:
                    aplicada = False                 # cliente não aceitou (ou linha errada)
            elif t == 'convenio_pix' and g == 'com':
                # negocia desconto no PIX com os postos onde a frota mais abastece (pelo plano do app)
                desc = float(a.get('desconto_rs_l', 0.2)); n = int(a.get('quantos', 15))
                uso = {}
                for mm in M.values():
                    for cnpj, (nome, litros, _) in (mm.get('_uso_postos') or {}).items():
                        u = uso.setdefault(cnpj, [nome, 0.0]); u[1] += litros
                ja = {c['cnpj'] for c in G.setdefault('conveniados', [])}
                alvo = [c for c, _ in sorted(uso.items(), key=lambda x: -x[1][1]) if c not in ja][:n]
                p_aceita = 0.7 if desc <= 0.2 else 0.5 if desc <= 0.3 else 0.25
                rng_c = random.Random(f'conv|{semana}|{desc}')
                fechados = []
                for cnpj in alvo:
                    if rng_c.random() < p_aceita:
                        G['conveniados'].append({'cnpj': cnpj, 'nome': uso[cnpj][0], 'desconto_rs_l': desc, 'semana': semana}); fechados.append(cnpj)
                        if frota: call('POST', '/api/frota/postos-conveniados', frota.gestor, {'cnpj': cnpj, 'nome': uso[cnpj][0], 'desconto_rs_l': desc, 'pagamento': 'PIX'})
                CONVENIOS['com'] = G['conveniados']
                a['_resultado'] = f'{len(fechados)} de {len(alvo)} postos aceitaram R$ {desc:.2f}/L no PIX'
            elif t == 'nenhuma':
                pass
            else:
                aplicada = False
            G['decisoes_aplicadas'].append({'semana': semana, 'acao': a, 'aplicada': aplicada})
        msg = (dec.get('mensagem_aos_motoristas') or '').strip()
        if msg:
            G['mensagens'].append({'semana': semana, 'texto': msg, 'canal': 'BrasaWay (mensagens)' if g == 'com' else 'WhatsApp'})
            if g == 'com' and frota:
                for pid in list(M)[:50]: frota.mensagem(pid, msg)


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
    info = load(OUT / 'frota_info.json'); frota = Frota(info) if info else None
    CONVENIOS['com'] = st['grupos']['com'].get('conveniados', [])
    if n > 1: aplicar_decisoes(st, n - 1, frota)
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
    # pré-aquece o cache de rotas em paralelo (o que é igual nos dois grupos é calculado uma vez)
    uniq = {}
    for g, pid, i, data, hora in tarefas:
        m = st['grupos'][g]['motoristas'][pid]; l = m['linhas'][i]
        uniq[(l['origem'], l['destino'], m['veiculo'], m['hazmat'], 'F' if data in FERIADOS else data.isoweekday(), hora, bool(m.get('aetc')))] = (l['origem'], l['destino'], m['veiculo'], m['hazmat'], data, hora, bool(m.get('aetc')))
    falhas = []
    def aquece(args):
        try: rota_legal(*args); rota_gps_carro(*args)
        except Exception as e: falhas.append((args[:2], str(e)[:120]))
    with ThreadPoolExecutor(int(os.environ.get('SIM_THREADS', '4'))) as ex: list(ex.map(aquece, uniq.values()))
    if V2:   # planos de abastecimento de todas as faixas de nível das linhas da semana, em paralelo (antes: um a um no meio da simulação)
        planos = {(a[0], a[1], a[2], a[3], a[6]) for a in uniq.values()}
        def aquece_plano(x):
            try: planos_linha(*x)
            except Exception as e: falhas.append(((x[0], x[1]), 'plano: ' + str(e)[:100]))
        with ThreadPoolExecutor(int(os.environ.get('SIM_THREADS', '4'))) as ex: list(ex.map(aquece_plano, planos))
    save(CACHE_P, CACHE)
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
        for mu in ev['multas']: m['pontos'].append({'data': ev['data'], 'pontos': mu['pontos']})
        st['grupos'][g]['eventos'].append(ev); eventos_semana[g].append(ev)
        if g == 'com' and frota and geom: frota_jobs.append((pid, ev, geom, l))
    if frota and V2:
        hoje_fim = (INICIO + dt.timedelta(days=d1 - 1)).isoformat()
        def extras(pid):
            for e in eventos_semana['com']:
                if e['motorista'] != pid: continue
                frota.abastecimento(pid, e)
                for mu in e['multas']:
                    if mu.get('presencial') and not mu.get('api_id'): frota.multa_motorista(pid, mu, e)
        with ThreadPoolExecutor(4) as ex: list(ex.map(extras, {e['motorista'] for e in eventos_semana['com']}))
        # notificações que chegaram nesta semana (de qualquer semana anterior): a equipe completa no painel
        for e in st['grupos']['com']['eventos']:
            for mu in e['multas']:
                if mu['aviso_em'] <= hoje_fim and not mu.get('notificada'):
                    mu['notificada'] = True; frota.multa_equipe(mu, e)
    if frota:   # um motorista só tem uma viagem em andamento: as dele vão em fila, motoristas em paralelo
        por_mot = {}
        for job in frota_jobs: por_mot.setdefault(job[0], []).append(job)
        with ThreadPoolExecutor(4) as ex: list(ex.map(lambda js: [frota.viagem(*a) for a in js], por_mot.values()))
    st['dia_atual'] = d1
    save(OUT / 'estado.json', st)
    rel = {g: relatorio(st, g, n, eventos_semana[g], personas) for g in GRUPOS}
    for g in GRUPOS: save(OUT / 'relatorios' / f'semana_{n}_{g}.json', rel[g])
    resumo = {g: {k: rel[g]['semana'][k] for k in ('viagens', 'km', 'multas_cometidas', 'retornos', 'colisoes', 'atrasos')} for g in GRUPOS}
    print(json.dumps({'semana': n, 'dias': [str(INICIO + dt.timedelta(days=d0)), str(INICIO + dt.timedelta(days=d1 - 1))],
                      'resumo': resumo, 'falhas_rota': len(falhas), 'frota_erros': frota.erros if frota else None}, ensure_ascii=False))
    if falhas: save(OUT / f'falhas_semana_{n}.json', falhas)


def soma(evs, campo): return round(sum(e[campo] for e in evs), 2)


def relatorio(st, g, n, evs, personas):
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
            if g == 'sem' and not (e['retornos'] or e['colisoes']) and v['cat'] == 'circulacao':
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
    rel = {'empresa': 'com BrasaWay' if g == 'com' else 'sem BrasaWay', 'semana': sem, 'semana_n': n, 'hoje': hoje,
           'multas_notificadas_na_semana': multas_visiveis,
           'por_motorista': por_mot, 'pontos_cnh_12m': {k: v for k, v in pts.items() if v},
           'problemas_conhecidos': probl, 'linhas': linhas,
           'nota': ('Dados do painel BrasaWay: rotas legais, restrições evitadas, entregas em zona restrita avisadas antes da saída.'
                    if g == 'com' else 'Sem sistema: a empresa só sabe das multas quando a notificação chega (~3 semanas), dos retornos e batidas que o motorista conta e dos atrasos que o cliente reclama.')}
    if V2:
        compr = sum(e.get('diesel_comprado_l', 0) for e in evs); gasto = sum(e.get('diesel_gasto_rs', 0) for e in evs)
        rel['semana']['diesel_litros_comprados'] = round(compr); rel['semana']['diesel_gasto_rs'] = round(gasto, 2)
        rel['semana']['diesel_preco_medio_pago'] = round(gasto / compr, 3) if compr else None
        rel['semana']['multas_presenciais'] = sum(1 for e in evs for mu in e['multas'] if mu.get('presencial'))
        if g == 'com':
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
            for pid, ls in linhas.items():
                for l in ls:
                    if l['janela_entrega_ate'] is None or not l['ativa']: continue
                    mm = G['motoristas'][pid]
                    try: lg = rota_legal(l['origem'], l['destino'], mm['veiculo'], mm['hazmat'], INICIO + dt.timedelta(days=st['dia_atual']), int(l['hora_saida']), bool(mm.get('aetc')))
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
    if g == 'com':
        rel['semana']['evitadas_pelo_app'] = sum(e['evitadas_app'] for e in evs)
        rel['semana']['viagens_ignorando_app'] = sum(e['rota'] == 'ignorou_app' for e in evs)
        rel['semana']['avisos_de_risco'] = sum(e.get('avisos_risco', 0) for e in evs)
    return rel


# ------------------------------------------------------------------ final
def final():
    st = load(OUT / 'estado.json'); res = {}
    for g in GRUPOS:
        G = st['grupos'][g]; evs = G['eventos']
        multas = [mu for e in evs for mu in e['multas']]
        pagas = [mu for mu in multas if mu.get('situacao') != 'cancelada']
        extra = sum(c['valor'] for c in G['custos_extra'])
        plan = len(evs) * PARAMS['planejamento_min_viagem'][g] / 60 * PARAMS['custo_hora_roteirista']
        mens = PARAMS['mensalidade_veiculo'] * 50 * 2 if g == 'com' else 0
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
        if g == 'com':
            r['evitadas_pelo_app'] = sum(e['evitadas_app'] for e in evs)
            r['viagens_ignorando_app'] = sum(e['rota'] == 'ignorou_app' for e in evs)
            r['avisos_de_risco'] = sum(e.get('avisos_risco', 0) for e in evs)
        r['decisoes'] = G['decisoes_aplicadas']; r['mensagens'] = G['mensagens']
    res['params'] = PARAMS
    save(OUT / 'resultado.json', res)
    print(json.dumps({g: {k: v for k, v in res[g].items() if not isinstance(v, (dict, list))} for g in GRUPOS}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'preparar': preparar()
    elif cmd == 'semana': rodar_semana(int(sys.argv[2]))
    elif cmd == 'final': final()
    else: sys.exit(__doc__)
