#!/usr/bin/env bash
# Sobe o stack local para a simulação: Docker (se o daemon caiu), Postgres, Valhalla e a API com SIM_ENDPOINTS=1.
# Idempotente: se a API já responde, não faz nada. PID da API em sim/out/api.pid (para matar só ela).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p sim/out
if curl -sf -m 5 localhost:3000/api/health | grep -q '"ok":true'; then echo "stack ok"; exit 0; fi
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
for _ in $(seq 1 30); do curl -sf localhost:3000/api/health | grep -q '"ok":true' && { echo "stack ok"; exit 0; }; sleep 1; done
echo "API não respondeu"; tail -20 sim/out/api.log; exit 1
