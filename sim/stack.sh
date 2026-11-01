#!/usr/bin/env bash
# Sobe o stack local para a simulação: Docker (se o daemon caiu), Postgres, Valhalla e a API com SIM_ENDPOINTS=1.
# Idempotente: se a API já responde, não faz nada. PID da API em sim/out/api.pid (para matar só ela).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p sim/out
# 2ª instância da API (porta 3001) só para cálculo de rotas: o Node usa um núcleo só e era o gargalo da simulação
segunda_api() {
  curl -sf -m 5 localhost:3001/api/health | grep -q '"ok":true' && return 0
  if [ -f sim/out/api2.pid ] && kill -0 "$(cat sim/out/api2.pid)" 2>/dev/null; then kill "$(cat sim/out/api2.pid)"; sleep 1; fi
  (cd api; setsid nohup env PORT=3001 DATABASE_URL=postgres://truck:truck@localhost:5432/truck_router \
    VALHALLA_URL=http://localhost:8002 VALHALLA_ELEV_URL=http://localhost:8002 CONFIG_DIR="$PWD/../config" \
    TZ=America/Sao_Paulo SIM_ENDPOINTS=1 FROTA_USUARIOS_EXTERNOS=1 node dist/server.js > ../sim/out/api2.log 2>&1 < /dev/null & echo $! > ../sim/out/api2.pid)
  for _ in $(seq 1 30); do curl -sf localhost:3001/api/health | grep -q '"ok":true' && return 0; sleep 1; done
  echo "2ª API não respondeu (segue só com a 3000)"; return 0
}
if curl -sf -m 5 localhost:3000/api/health | grep -q '"ok":true'; then segue=1; else segue=0; fi
if [ "$segue" = 1 ]; then [ "${SIM_API2:-0}" = 1 ] && segunda_api; echo "stack ok"; exit 0; fi
if ! docker info >/dev/null 2>&1; then
  rm -f /var/run/docker.pid /var/run/docker.sock
  setsid nohup dockerd > sim/out/dockerd.log 2>&1 < /dev/null & disown
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
docker compose up -d db valhalla >/dev/null 2>&1
for _ in $(seq 1 90); do curl -sf localhost:8002/status >/dev/null && docker compose exec -T db pg_isready -U truck >/dev/null 2>&1 && break; sleep 2; done
if [ -f sim/out/api.pid ] && kill -0 "$(cat sim/out/api.pid)" 2>/dev/null; then kill "$(cat sim/out/api.pid)"; sleep 1; fi
(cd api; setsid nohup env PORT=3000 DATABASE_URL=postgres://truck:truck@localhost:5432/truck_router \
  VALHALLA_URL=http://localhost:8002 VALHALLA_ELEV_URL=http://localhost:8002 CONFIG_DIR="$PWD/../config" \
  TZ=America/Sao_Paulo SIM_ENDPOINTS=1 FROTA_USUARIOS_EXTERNOS=1 node dist/server.js > ../sim/out/api.log 2>&1 < /dev/null & echo $! > ../sim/out/api.pid)
for _ in $(seq 1 30); do curl -sf localhost:3000/api/health | grep -q '"ok":true' && { [ "${SIM_API2:-0}" = 1 ] && segunda_api; echo "stack ok"; exit 0; }; sleep 1; done
echo "API não respondeu"; tail -20 sim/out/api.log; exit 1
