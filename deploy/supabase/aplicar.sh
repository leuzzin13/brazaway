#!/usr/bin/env bash
# Aplica o banco do BrasaWay num projeto Supabase: migrations, seeds (camadas, cidades, feriados) e a blindagem.
#
# Uso:  SUPABASE_DB_URL='postgresql://postgres:<senha>@db.<ref>.supabase.co:5432/postgres' deploy/supabase/aplicar.sh
#   (Supabase → Project Settings → Database → Connection string → "Direct connection" ou "Session pooler" porta 5432.
#    NÃO use o "Transaction pooler" (6543): os seeds grandes e os blocos `do $$` precisam de sessão.)
#   --sem-seed   só schema (para testar)
#
# Idempotente: dá para rodar de novo depois de um `git pull` com migrations ou seeds novos.
# Precisa do psql 15+ na máquina (brew install libpq / apt install postgresql-client).
set -euo pipefail
: "${SUPABASE_DB_URL:?defina SUPABASE_DB_URL (connection string do Supabase, porta 5432)}"
cd "$(dirname "$0")/../.."
SEED=1; [ "${1:-}" = "--sem-seed" ] && SEED=0

run() { echo "==> $1"; psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$1"; }

for f in db/migrations/*.sql; do
  # 0300 cria auth.users/auth.uid() e os papéis para o Postgres local; no Supabase eles já existem (e o schema auth
  # não é nosso: o GRANT do shim falharia).
  [ "$(basename "$f")" = "0300_frota_auth_shim.sql" ] && continue
  run "$f"
done
if [ "$SEED" = 1 ]; then
  for f in db/seed/*.sql db/seed/layers/*.sql; do run "$f"; done
fi
run deploy/supabase/9000_supabase_hardening.sql
run deploy/supabase/9100_storage_comprovantes.sql
psql "$SUPABASE_DB_URL" -Atc "select 'banco: ' || pg_size_pretty(pg_database_size(current_database()))"
echo "Supabase OK"
