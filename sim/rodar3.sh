#!/usr/bin/env bash
# Simulação 3.0 (três empresas: com, mais, sem): grava as decisões da semana anterior (saída do workflow
# sim/equipe_workflow3.js) e roda a semana N. Uso: sim/rodar3.sh N <saida_workflow>
# Antes da semana 1: sim/rodar3.sh preparar (cria as 3 empresas na frota, copia as personas da 2.0 e o estado inicial).
# Depois da semana 13: sim/rodar3.sh final (consolida em sim/out3/resultado.json e escreve docs/simulacao/relatorio_3_0.html).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p sim/out3
echo $$ > sim/out3/rodar.pid
export SIM_OUT="$PWD/sim/out3" GRUPOS=com,mais,sem SIM_V3=1 SIM_DIAS=90 SIM_THREADS=6 SIM_FROTA_THREADS=6 SIM_API2=1
export SIM_API_ROTAS="http://localhost:3000,http://localhost:3001"
# viagem na frota com rota e plano de abastecimento da API (fora do plano na conferência do diesel); 0 = sem plano, mais rápido
export SIM_FROTA_PLANO="${SIM_FROTA_PLANO:-1}"
if [ "$1" = preparar ]; then sim/stack.sh >/dev/null; python3 sim/motor.py preparar; exit 0; fi
if [ "$1" = final ]; then python3 sim/motor.py final > sim/out3/final.txt; python3 sim/relatorio_final3.py; exit 0; fi
[ -n "${2:-}" ] && python3 sim/salvar_decisoes.py "$2" | grep -v "mensagem:"
sim/stack.sh >/dev/null
# se o aquecimento desta semana (sim/aquecer3.sh) ainda está rodando, espera ele gravar o cache
A=sim/out3/aquecer.pid; while [ -f $A ] && kill -0 "$(cat $A)" 2>/dev/null; do sleep 10; done
python3 sim/motor.py semana "$1" > "sim/out3/log_semana_$1.txt" 2>&1
tail -1 "sim/out3/log_semana_$1.txt" | cut -c1-800
python3 - "$1" <<'PY'
import json, sys
n = sys.argv[1]
for g in ('com', 'mais', 'sem'):
    r = json.load(open(f'sim/out3/relatorios/semana_{n}_{g}.json'))
    s = r['semana']
    print(g, json.dumps({**{k: s.get(k) for k in ('viagens', 'multas_cometidas', 'retornos', 'atrasos', 'diesel_preco_medio_pago',
                                                  'alertas_ao_vivo_que_evitaram', 'km_desvio_bloqueios', 'condutores_indicados_pelo_sistema')},
                         'nic': r.get('nic', {}).get('total_ate_agora'), 'para_indicar': len(r.get('multas_para_indicar') or []),
                         'sne': r.get('sne', {}).get('aderida'), 'bloqueios': len(r.get('trechos_bloqueados') or []),
                         'conciliacao': (r.get('conciliacao_diesel') or {}).get('erro') or len((r.get('conciliacao_diesel') or {}).get('placas_com_alerta') or [])
                         if g == 'mais' else None}, ensure_ascii=False))
PY
