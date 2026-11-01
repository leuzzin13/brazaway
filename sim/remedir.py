#!/usr/bin/env python3
"""Mede o efeito de uma mudança no roteador sobre as rotas da simulação: recalcula cada rota legal e cada rota de GPS
de carro do cache (sim/out/cache_rotas.json) numa API nova (SIM_API_NOVA, padrão :3001) e compara.
Uso: python3 sim/remedir.py  → grava sim/out/remedicao.json"""
import json, os, sys, datetime as dt
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import motor
NOVA = os.environ.get('SIM_API_NOVA', 'http://localhost:3001')
cache = json.load(open(motor.OUT / 'cache_rotas.json'))
INICIO = motor.INICIO

def data_de(dia):
    if dia == 'F': return dt.date(2026, 9, 7)
    d = INICIO
    while d.isoweekday() != int(dia): d += dt.timedelta(days=1)
    return d

def um(item):
    k, antes = item
    tipo, o, d, preset, hz, dia, hora, *resto = k.split('|')
    aetc = bool(resto)
    data = data_de(dia); hora = int(hora); hz = hz == '1'
    a, b = motor.LOCAIS[o], motor.LOCAIS[d]
    veh = {'preset': preset, **({'hazmat': True} if hz else {}), **({'has_aetc': True} if aetc else {})}
    base = {'origin': {'lat': a['lat'], 'lon': a['lon']}, 'destination': {'lat': b['lat'], 'lon': b['lon']}, 'vehicle': veh,
            'departure_at': f'{data.isoformat()}T{hora:02d}:00'}
    if tipo == 'L':
        if not antes.get('ok'): return None
        st, r = motor.post(NOVA + '/api/route', base)
        if st != 200: return {'k': k, 'erro': st}
        w = r.get('warnings') or []
        return {'k': k, 'tipo': 'L', 'sem_alt_antes': len(antes['restrito_sem_alternativa']),
                'sem_alt_depois': sum(1 for x in w if x.get('code') == 'uses_restricted_way'),
                'avisos_antes': antes['avisos'], 'avisos_depois': len(w),
                'evitou_antes': len(antes['evitou']), 'evitou_depois': len(r.get('avoided') or []),
                'km_antes': antes['km'], 'km_depois': r['distance_km'],
                'por_codigo': {c: sum(1 for x in w if x.get('code') == c) for c in {x.get('code') for x in w}}}
    st, v = motor.post(motor.VALHALLA + '/route', {'locations': [base['origin'], base['destination']], 'costing': 'auto', 'units': 'km'})
    shape = motor.decode6(v['trip']['legs'][0]['shape'])
    st, e = motor.post(NOVA + '/api/sim/avaliar', {**base, 'coordinates': shape})
    if st != 200: return {'k': k, 'erro': st}
    return {'k': k, 'tipo': 'G', 'cruza_antes': len(antes['cruza']), 'cruza_depois': len(e['crossed'])}

with ThreadPoolExecutor(int(os.environ.get('SIM_THREADS', '4'))) as ex:
    res = [r for r in ex.map(um, cache.items()) if r]
json.dump(res, open(motor.OUT / 'remedicao.json', 'w'), ensure_ascii=False)
L = [r for r in res if r.get('tipo') == 'L']; G = [r for r in res if r.get('tipo') == 'G']
s = lambda xs, c: sum(x[c] for x in xs)
print(json.dumps({'rotas_legais': len(L), 'sem_alt': [s(L, 'sem_alt_antes'), s(L, 'sem_alt_depois')],
                  'avisos': [s(L, 'avisos_antes'), s(L, 'avisos_depois')], 'evitou': [s(L, 'evitou_antes'), s(L, 'evitou_depois')],
                  'rotas_gps': len(G), 'gps_cruza': [s(G, 'cruza_antes'), s(G, 'cruza_depois')],
                  'erros': sum(1 for r in res if 'erro' in r)}, ensure_ascii=False))
