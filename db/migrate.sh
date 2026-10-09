#!/usr/bin/env bash
# Aplica migrations e seeds (todas idempotentes) em ordem.
set -euo pipefail
until pg_isready -q; do sleep 1; done
for f in /db/migrations/*.sql /db/seed/*.sql; do
  echo "==> $f"
  psql -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "migrations + seed OK"
