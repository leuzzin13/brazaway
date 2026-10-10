#!/usr/bin/env bash
# Build completo dos tiles do Valhalla com as correções locais do OSM e o relevo, numa pasta separada, e troca opcional.
#
#   ./scripts/build-tiles.sh            # download (se faltar) -> correções -> relevo (se faltar) -> tiles em data/valhalla_build
#   ./scripts/build-tiles.sh --swap     # idem e, no fim, troca o Valhalla principal (restart de ~30 s)
#
# Variáveis: OSM_PBF_URL (default Sudeste), BUILD_THREADS (default 3), BUILD_DIR (default data/valhalla_build).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
BUILD_DIR="${BUILD_DIR:-$ROOT/data/valhalla_build}"
PBF_URL="${OSM_PBF_URL:-https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf}"
PBF_NAME="$(basename "$PBF_URL")"
SRC_DIR="$ROOT/data/osm"; mkdir -p "$SRC_DIR" "$BUILD_DIR"
log() { echo "[build-tiles $(date +%H:%M:%S)] $*"; }

# 1) PBF original (fonte), separado da pasta de build
if [ ! -f "$SRC_DIR/$PBF_NAME" ]; then
  if [ -f "$ROOT/data/valhalla/$PBF_NAME" ]; then ln "$ROOT/data/valhalla/$PBF_NAME" "$SRC_DIR/$PBF_NAME" 2>/dev/null || cp "$ROOT/data/valhalla/$PBF_NAME" "$SRC_DIR/$PBF_NAME"
  else log "baixando $PBF_URL"; curl -fL -o "$SRC_DIR/$PBF_NAME" "$PBF_URL"; fi
fi

# 2) correções locais (data/osm-overrides/overrides.json, só as 'ativas')
log "aplicando correções do OSM"
rm -f "$BUILD_DIR/$PBF_NAME"
"$ROOT/scripts/osm-overrides/apply.sh" "$SRC_DIR/$PBF_NAME" "$BUILD_DIR/$PBF_NAME"

# 3) relevo: reaproveita os HGT do principal por hardlink; se não houver, gera do ANADEM
if ! find "$BUILD_DIR/elevation_data" -name '*.hgt*' 2>/dev/null | grep -q .; then
  if find "$ROOT/data/valhalla/elevation_data" -name '*.hgt*' 2>/dev/null | grep -q .; then
    rm -rf "$BUILD_DIR/elevation_data"; cp -al "$ROOT/data/valhalla/elevation_data" "$BUILD_DIR/elevation_data"
  else
    log "gerando HGT do ANADEM (~6 GB de download)"; VALHALLA_ELEV_DIR="$BUILD_DIR" "$ROOT/scripts/build-elevation.sh" dem
  fi
fi

# 4) tiles
log "construindo tiles em $BUILD_DIR"
FORCE=1 VALHALLA_ELEV_DIR="$BUILD_DIR" ELEV_BUILD_THREADS="${BUILD_THREADS:-3}" "$ROOT/scripts/build-elevation.sh" tiles

# 5) troca (opcional): a pasta atual vira data/cache/valhalla_anterior (rollback)
if [ "${1:-}" = "--swap" ]; then
  log "trocando o Valhalla principal"
  docker compose stop valhalla
  rm -rf "$ROOT/data/cache/valhalla_anterior"; mkdir -p "$ROOT/data/cache"
  mv "$ROOT/data/valhalla" "$ROOT/data/cache/valhalla_anterior"
  mv "$BUILD_DIR" "$ROOT/data/valhalla"
  docker compose up -d valhalla
  log "pronto. Rollback: docker compose stop valhalla && mv data/valhalla $BUILD_DIR && mv data/cache/valhalla_anterior data/valhalla && docker compose up -d valhalla"
fi
