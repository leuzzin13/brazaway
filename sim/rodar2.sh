#!/usr/bin/env bash
# Simulação 2.0: grava as decisões da semana anterior (saída do workflow) e roda a semana N. Uso: sim/rodar2.sh N <saida_workflow>
set -euo pipefail
cd "$(dirname "$0")/.."
export SIM_OUT="$PWD/sim/out2" SIM_V2=1 SIM_DIAS=90 SIM_THREADS=6
[ -n "${2:-}" ] && python3 sim/salvar_decisoes.py "$2" | grep -v "mensagem:"
sim/stack.sh >/dev/null
python3 sim/motor.py semana "$1" > "sim/out2/log_semana_$1.txt" 2>&1
tail -1 "sim/out2/log_semana_$1.txt" | cut -c1-600
python3 - "$1" <<'PY'
import json, sys
n = sys.argv[1]
for g in ('com', 'sem'):
    r = json.load(open(f'sim/out2/relatorios/semana_{n}_{g}.json'))
    print(g, json.dumps({k: r['semana'].get(k) for k in ('viagens', 'multas_cometidas', 'retornos', 'atrasos', 'diesel_preco_medio_pago', 'alertas_ao_vivo_que_evitaram')}))
PY
