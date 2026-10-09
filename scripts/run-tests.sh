#!/usr/bin/env bash
# Roda os testes automatizados contra o ambiente local (docker compose up já rodando).
# Espera o Valhalla terminar o build de tiles (pode levar bastante tempo na primeira vez).
set -euo pipefail
cd "$(dirname "$0")/../api"
export API_URL="${API_URL:-http://localhost:${API_PORT:-3000}}"
export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgres://${POSTGRES_USER:-truck}:${POSTGRES_PASSWORD:-truck}@localhost:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-truck_router}}"
[ -d node_modules ] || npm install --no-audit --no-fund
echo "Aguardando API + Valhalla em ${API_URL}/api/health ..."
until curl -sf "${API_URL}/api/health" | grep -q '"ok":true'; do sleep 10; printf '.'; done; echo
npm test
