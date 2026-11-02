#!/usr/bin/env bash
# Simulação 3.0: espera o workflow da equipe (sim/equipe_workflow3.js) gravar a saída, roda a semana N e já começa a
# aquecer a N+1. Uso: sim/encadear3.sh N <arquivo de saída do workflow da semana N-1>
set -uo pipefail
cd "$(dirname "$0")/.."
N=$1; W=$2
until [ -s "$W" ] && python3 -c "import json,sys; json.load(open(sys.argv[1]))['result']" "$W" 2>/dev/null; do sleep 5; done
sim/rodar3.sh "$N" "$W" > "sim/out3/rodar_$N.txt" 2>&1
[ "$N" -lt 13 ] && [ -f "sim/out3/relatorios/semana_${N}_sem.json" ] && sim/aquecer3.sh $((N + 1))
