#!/usr/bin/env python3
"""Economia de diesel com o plano de abastecimento, nas viagens da simulação (empresa com BrasaWay, 60 dias).
Para cada linha (origem, destino, caminhão) pede a rota com o plano saindo na reserva + 10% (precisa comprar o diesel
da viagem) e compara o preço por litro do plano com o preço médio dos postos com preço a até 2 km da rota (o que paga
quem para em qualquer posto). Aplica a taxa a todos os litros que as viagens daquela linha consumiram.
Uso: SIM_API=http://localhost:3100 python3 sim/diesel.py"""
import json, os, sys, statistics
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(__file__))
import motor
API = os.environ.get('SIM_API', 'http://localhost:3100')
st = json.load(open(motor.OUT / 'estado.json'))
ev = st['grupos']['com']['eventos']
linhas = {}
for e in ev:
    k = (e['origem'], e['destino'], e['veiculo'])
    L = linhas.setdefault(k, {'viagens': 0, 'km': 0.0})
    L['viagens'] += 1; L['km'] += e['km']

def um(k):
    o, d, p = k; a, b = motor.LOCAIS[o], motor.LOCAIS[d]
    st_, r = motor.post(API + '/api/route', {'origin': {'lat': a['lat'], 'lon': a['lon']}, 'destination': {'lat': b['lat'], 'lon': b['lon']},
                                            'vehicle': {'preset': p}, 'departure_at': '2026-11-03T05:00', 'abastecimento': {'nivel_pct': 25}})
    if st_ != 200 or not r.get('plano_abastecimento'): return k, None
    pl = r['plano_abastecimento']
    return k, {'km_rota': r['distance_km'], 'litros': pl['litros'], 'custo': pl['custo_rs'], 'media': pl['preco_medio_rota_rs_l'],
               'paradas': len(pl['paradas']), 'cons': pl['consumo_km_l']}

with ThreadPoolExecutor(4) as ex:
    res = dict(ex.map(um, linhas))
tot_l = tot_base = tot_plan = 0.0; sem_preco_l = 0.0; por_faixa = {}
for k, L in linhas.items():
    r = res.get(k)
    cons = (r or {}).get('cons') or motor.PARAMS['km_por_litro'][k[2]]
    litros = L['km'] / cons
    tot_l += litros
    faixa = 'acima de 150 km' if (r and r['km_rota'] > 150) else 'até 150 km'
    f = por_faixa.setdefault(faixa, {'litros': 0.0, 'base': 0.0, 'plano': 0.0, 'linhas': 0, 'viagens': 0})
    f['linhas'] += 1; f['viagens'] += L['viagens']; f['litros'] += litros
    if not r or not r['media'] or not r['litros']:
        sem_preco_l += litros; continue
    preco_plano = r['custo'] / r['litros']
    taxa = max(0.0, 1 - preco_plano / r['media'])
    tot_base += litros * r['media']; tot_plan += litros * r['media'] * (1 - taxa)
    f['base'] += litros * r['media']; f['plano'] += litros * r['media'] * (1 - taxa)
out = {'linhas': len(linhas), 'viagens': len(ev), 'litros_60d': round(tot_l), 'litros_sem_posto_com_preco': round(sem_preco_l),
       'gasto_preco_medio_rs': round(tot_base), 'gasto_com_plano_rs': round(tot_plan), 'economia_rs_60d': round(tot_base - tot_plan),
       'economia_pct': round(100 * (tot_base - tot_plan) / tot_base, 2) if tot_base else None,
       'por_faixa': {k: {**v, 'litros': round(v['litros']), 'base': round(v['base']), 'plano': round(v['plano']),
                         'economia_pct': round(100 * (v['base'] - v['plano']) / v['base'], 2) if v['base'] else None} for k, v in por_faixa.items()}}
json.dump({'resumo': out, 'linhas': {'|'.join(k): v for k, v in res.items()}}, open(motor.OUT / 'diesel.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
