#!/usr/bin/env bash
# Sobe o BrasaWay no Mac para o app do Lovable usar: banco, roteador e API no Docker (OrbStack ou Docker Desktop) e um
# túnel HTTPS público (cloudflared) apontando para a API. Login fica no Supabase do Lovable Cloud.
#
#   deploy/mac/subir_local.sh           # 1ª vez: confere o que falta, gera os tiles (~1 h) e sobe tudo
#   deploy/mac/subir_local.sh --tunel   # só abre o túnel de novo (o endereço muda a cada vez)
#
# No fim aparece um endereço https://....trycloudflare.com: cole em "Servidor BrasaWay" na tela de login do app.
# Precisa de: Docker rodando, `brew install cloudflared osmium-tool` e `pip3 install osmium` (para os tiles).
set -euo pipefail
cd "$(dirname "$0")/../.."
log() { echo "[brasaway $(date +%H:%M:%S)] $*"; }
falta() { echo "falta: $1" >&2; exit 1; }

tunel() {
  log "abrindo o túnel (Ctrl+C fecha; a API continua rodando)"
  cloudflared tunnel --no-autoupdate --url http://localhost:3000 2>&1 | while IFS= read -r l; do
    case "$l" in *trycloudflare.com*) u=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' <<<"$l" || true)
      [ -n "$u" ] && { echo; echo "  >>> Servidor BrasaWay: $u"; echo "      teste: curl $u/api/health"; echo; } ;; esac
  done
}

command -v docker >/dev/null || falta "Docker (OrbStack: brew install orbstack)"
docker info >/dev/null 2>&1 || falta "abrir o OrbStack/Docker"
command -v cloudflared >/dev/null || falta "cloudflared (brew install cloudflared)"
[ "${1:-}" = "--tunel" ] && { tunel; exit 0; }

# .env da raiz (fora do git): login no Supabase do Lovable Cloud e criação do usuário no 1º acesso
if ! grep -q '^SUPABASE_URL=' .env 2>/dev/null; then
  log "criando .env com o Supabase do Lovable"
  { echo "SUPABASE_URL=https://jlupfrwiemicyemhhabm.supabase.co"; echo "FROTA_USUARIOS_EXTERNOS=1"; echo "FROTA_JOBS_INTERVAL_MIN=15"; } >> .env
fi

# tiles do roteador (Sudeste + Sul + Centro-Oeste com as correções locais do OSM)
if [ ! -s data/valhalla/valhalla_tiles.tar ]; then
  command -v osmium >/dev/null || falta "osmium-tool (brew install osmium-tool)"
  python3 -c 'import osmium' 2>/dev/null || falta "pyosmium (pip3 install osmium)"
  log "gerando os tiles (baixa ~1,6 GB e leva cerca de 1 h; precisa de ~8 GB de RAM livres)"
  ./scripts/build-tiles-regioes.sh --swap
fi

log "subindo banco, migrations + camadas, roteador e API"
docker compose up -d --build db migrate valhalla api
for i in $(seq 1 120); do curl -sf localhost:3000/api/health >/dev/null && break; sleep 5; done
curl -sf localhost:3000/api/health >/dev/null || { docker compose logs --tail 40 api; falta "a API não respondeu em localhost:3000"; }
log "API ok: $(curl -s localhost:3000/api/health | head -c 60)..."
tunel
