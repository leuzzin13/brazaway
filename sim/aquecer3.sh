#!/usr/bin/env bash
# Simulação 3.0: calcula as rotas e planos da semana N enquanto a equipe (workflow) decide a semana anterior. Uso: sim/aquecer3.sh N
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p sim/out3
echo $$ > sim/out3/aquecer.pid
export SIM_OUT="$PWD/sim/out3" GRUPOS=com,mais,sem SIM_V3=1 SIM_DIAS=90 SIM_THREADS=6 SIM_API2=1
export SIM_API_ROTAS="http://localhost:3000,http://localhost:3001"
sim/stack.sh >/dev/null
python3 sim/motor.py aquecer "$1" > "sim/out3/aquecer_$1.txt" 2>&1
