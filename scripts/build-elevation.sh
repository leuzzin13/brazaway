#!/usr/bin/env bash
# Constrói um 2º conjunto de tiles do Valhalla COM elevação (ANADEM v1 -> HGT 1") em data/valhalla_elev/
# e sobe um Valhalla separado na porta 8003. NÃO toca no Valhalla principal (porta 8002, data/valhalla/).
#
# Uso:  ./scripts/build-elevation.sh [all|dem|tiles|serve|check|clean]      (default: all = dem + tiles + serve + check)
#
# Variáveis (opcionais):
#   VALHALLA_MAIN_DIR   tiles/PBF do Valhalla principal (default: <repo>/data/valhalla) — só leitura
#   VALHALLA_ELEV_DIR   saída (default: <repo>/data/valhalla_elev)
#   ELEV_BBOX           bbox "minLon,minLat,maxLon,maxLat" dos tiles HGT quando não há grafo principal para listar
#                       (default: Sudeste -53.2,-25.4,-39.6,-14.2)
#   ELEV_BUILD_THREADS  threads do valhalla_build_tiles (default 6, deixa folga para o 8002 seguir respondendo)
#   DEM_JOBS            conversões HGT em paralelo (default 6)
#   VALHALLA_ELEV_PORT  porta do serviço (default 8003)
#   FORCE=1             refaz os tiles mesmo se já existirem (os HGT já convertidos são reaproveitados)
#
# Tempos e tamanhos medidos ficam em $VALHALLA_ELEV_DIR/logs/ (ver docs/layers/relevo.md).
set -o errexit -o pipefail -o nounset

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN_DIR="${VALHALLA_MAIN_DIR:-$ROOT/data/valhalla}"
ELEV_DIR="${VALHALLA_ELEV_DIR:-$ROOT/data/valhalla_elev}"
ELEV_BBOX="${ELEV_BBOX:--53.2,-25.4,-39.6,-14.2}"
THREADS="${ELEV_BUILD_THREADS:-6}"
DEM_JOBS="${DEM_JOBS:-6}"
PORT="${VALHALLA_ELEV_PORT:-8003}"
GDAL_IMAGE="${GDAL_IMAGE:-ghcr.io/osgeo/gdal:ubuntu-small-3.9.3}"
VALHALLA_IMAGE="${VALHALLA_IMAGE:-truck-router-valhalla}"
PBF_URL="${OSM_PBF_URL:-https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf}"
LOGS="$ELEV_DIR/logs"

mkdir -p "$ELEV_DIR/elevation_data" "$LOGS"
# a pasta se ignora sozinha no git (não depende do .gitignore da raiz)
[ -f "$ELEV_DIR/.gitignore" ] || printf '*\n' > "$ELEV_DIR/.gitignore"

log() { echo "[$(date '+%H:%M:%S')] $*"; }
record() { # record <etapa> <segundos>
  local f="$LOGS/times.tsv"
  printf '%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" >> "$f"
}

ensure_valhalla_image() {
  if ! docker image inspect "$VALHALLA_IMAGE" >/dev/null 2>&1; then
    log "imagem $VALHALLA_IMAGE não existe; construindo de ./valhalla"
    docker build -t "$VALHALLA_IMAGE" "$ROOT/valhalla"
  fi
}

step_dem() {
  local t0; t0=$(date +%s)
  local src_args
  if [ -d "$MAIN_DIR/valhalla_tiles/2" ]; then
    log "DEM: tiles HGT = células de 1° do grafo principal ($MAIN_DIR/valhalla_tiles)"
    src_args=(-v "$MAIN_DIR/valhalla_tiles:/graph:ro" "$GDAL_IMAGE" python3 /scripts/anadem_to_hgt.py --from-graph /graph)
  else
    log "DEM: grafo principal não encontrado; usando bbox $ELEV_BBOX"
    src_args=("$GDAL_IMAGE" python3 /scripts/anadem_to_hgt.py --bbox "$ELEV_BBOX")
  fi
  docker run --rm --name truck-router-elev-dem \
    -v "$ROOT/valhalla/elevation:/scripts:ro" -v "$ELEV_DIR:/out" \
    "${src_args[@]}" --out /out/elevation_data -j "$DEM_JOBS" 2>&1 | tee "$LOGS/dem.log"
  record dem $(( $(date +%s) - t0 ))
}

prepare_inputs() {
  # PBF: hardlink do principal (mesmo arquivo, sem ocupar disco), senão cópia, senão download
  local pbf; pbf="$(basename "$PBF_URL")"
  if ! ls "$ELEV_DIR"/*.pbf >/dev/null 2>&1; then
    if [ -f "$MAIN_DIR/$pbf" ]; then
      ln "$MAIN_DIR/$pbf" "$ELEV_DIR/$pbf" 2>/dev/null || cp "$MAIN_DIR/$pbf" "$ELEV_DIR/$pbf"
      log "PBF: $ELEV_DIR/$pbf (hardlink/cópia do principal)"
    else
      log "PBF: baixando $PBF_URL"
      curl -fL -o "$ELEV_DIR/$pbf" "$PBF_URL"
    fi
  fi
  # bancos auxiliares: os do principal (gerados do mesmo PBF) evitam ~2 min de build
  for f in admins.sqlite timezones.sqlite default_speeds.json; do
    if [ ! -f "$ELEV_DIR/$f" ] && [ -f "$MAIN_DIR/$f" ]; then cp "$MAIN_DIR/$f" "$ELEV_DIR/$f"; fi
  done
}

step_tiles() {
  ensure_valhalla_image
  if [ -f "$ELEV_DIR/valhalla_tiles.tar" ] && [ "${FORCE:-0}" != "1" ]; then
    log "tiles: $ELEV_DIR/valhalla_tiles.tar já existe (FORCE=1 para refazer)"; return 0
  fi
  if ! find "$ELEV_DIR/elevation_data" -name '*.hgt*' | grep -q .; then
    echo "ERRO: $ELEV_DIR/elevation_data sem HGT; rode antes: $0 dem" >&2; exit 1
  fi
  prepare_inputs
  if docker ps -a --format '{{.Names}}' | grep -qx truck-router-valhalla-elev; then
    log "parando o serviço valhalla-elev durante o build"
    docker rm -f truck-router-valhalla-elev >/dev/null
  fi
  rm -rf "$ELEV_DIR/valhalla_tiles" "$ELEV_DIR/valhalla_tiles.tar"
  local pbf; pbf="$(cd "$ELEV_DIR" && ls *.pbf | head -1)"
  local t0; t0=$(date +%s)
  log "tiles: valhalla_build_tiles com elevação ($THREADS threads); log em $LOGS/build.log"
  # amostra a memória do contêiner de build a cada 10 s (pico vai para logs/build_mem.txt)
  ( while sleep 10; do docker stats --no-stream --format '{{.MemUsage}}' truck-router-valhalla-elev-build 2>/dev/null | cut -d/ -f1 >> "$LOGS/build_mem.tsv" || true; done ) &
  local mon=$!
  docker run --rm --name truck-router-valhalla-elev-build \
    -v "$ELEV_DIR:/custom_files" --entrypoint bash "$VALHALLA_IMAGE" -c "
      set -euo pipefail
      cd /custom_files
      valhalla_build_config \
        --mjolnir-tile-dir /custom_files/valhalla_tiles \
        --mjolnir-tile-extract /custom_files/valhalla_tiles.tar \
        --mjolnir-admin /custom_files/admins.sqlite \
        --mjolnir-timezone /custom_files/timezones.sqlite \
        --mjolnir-traffic-extract /custom_files/traffic.tar \
        --mjolnir-transit-dir /custom_files/transit_tiles \
        --mjolnir-transit-feeds-dir /gtfs_feeds \
        --mjolnir-concurrency $THREADS \
        --additional-data-elevation /custom_files/elevation_data > valhalla.json
      if [ -f default_speeds.json ]; then
        jq '.mjolnir.default_speeds_config = \"/custom_files/default_speeds.json\"' valhalla.json | sponge valhalla.json
      fi
      [ -f admins.sqlite ] || valhalla_build_admins -c valhalla.json $pbf
      [ -f timezones.sqlite ] || valhalla_build_timezones > timezones.sqlite
      echo == valhalla_build_tiles; date -u
      time valhalla_build_tiles -c valhalla.json -j $THREADS /custom_files/$pbf
      echo == valhalla_build_extract; date -u
      time valhalla_build_extract -c valhalla.json -v
      # mesmo hash que o entrypoint oficial grava (sha256 do caminho do PBF), para ele não querer rebuildar
      printf '%s' /custom_files/$pbf | sha256sum | cut -f1 -d' ' > file_hashes.txt
      find /custom_files -path /custom_files/elevation_data -prune -o -type d -exec chmod 775 {} \; -o -type f -exec chmod 664 {} \;
    " > "$LOGS/build.log" 2>&1 || { { kill $mon && wait $mon; } 2>/dev/null; tail -40 "$LOGS/build.log"; echo "ERRO no build (log: $LOGS/build.log)" >&2; exit 1; }
  { kill $mon && wait $mon; } 2>/dev/null || true
  local dt=$(( $(date +%s) - t0 ))
  record tiles "$dt"
  log "tiles prontos em ${dt}s"
  grep -E "^(real|== )" "$LOGS/build.log" || true
  log "pico de memória do build: $(sort -h "$LOGS/build_mem.tsv" 2>/dev/null | tail -1)"
  du -sh "$ELEV_DIR"/valhalla_tiles "$ELEV_DIR"/valhalla_tiles.tar "$ELEV_DIR"/elevation_data | tee "$LOGS/disk.txt"
}

step_serve() {
  ensure_valhalla_image
  log "subindo valhalla-elev na porta $PORT"
  VALHALLA_ELEV_DIR="$ELEV_DIR" VALHALLA_ELEV_PORT="$PORT" \
    docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.elevation.yml" up -d --no-deps --no-build valhalla-elev
  for _ in $(seq 1 60); do
    if curl -sf "http://localhost:$PORT/status" >/dev/null; then log "valhalla-elev respondendo em http://localhost:$PORT"; return 0; fi
    sleep 5
  done
  echo "ERRO: valhalla-elev não respondeu em 5 min (docker logs truck-router-valhalla-elev)" >&2; exit 1
}

step_check() {
  # /height no Marco Zero (Sé, ~757 m no ANADEM) e rampa máxima da subida da R. Teodoro Sampaio (Pinheiros -> Av. Dr. Arnaldo,
  # ~12% no Valhalla) via route + trace_attributes (edge_walk). Roda dentro do contêiner (curl + jq).
  log "check /height (Sé):"
  curl -s "http://localhost:$PORT/height" -d '{"shape":[{"lat":-23.5505,"lon":-46.6339}]}'; echo
  log "check rampa (R. Teodoro Sampaio, subida):"
  docker exec truck-router-valhalla-elev bash -c '
    shape=$(curl -s localhost:8002/route -d "{\"locations\":[{\"lat\":-23.5665,\"lon\":-46.6925},{\"lat\":-23.5540,\"lon\":-46.6735}],\"costing\":\"truck\"}" | jq -r ".trip.legs[0].shape")
    curl -s localhost:8002/trace_attributes -d "{\"encoded_polyline\":$(jq -Rn --arg s "$shape" "\$s"),\"costing\":\"truck\",\"shape_match\":\"edge_walk\",\"filters\":{\"attributes\":[\"edge.max_upward_grade\",\"edge.names\"],\"action\":\"include\"}}" \
      | jq -c "[.edges[] | select(.max_upward_grade > -500)] | {arestas: length, rampa_max_pct: (map(.max_upward_grade) | max), via: (max_by(.max_upward_grade).names[0])}"'
}

step_clean() {
  docker rm -f truck-router-valhalla-elev 2>/dev/null || true
  log "removendo $ELEV_DIR/{valhalla_tiles,valhalla_tiles.tar} (HGT e PBF ficam)"
  rm -rf "$ELEV_DIR/valhalla_tiles" "$ELEV_DIR/valhalla_tiles.tar"
}

case "${1:-all}" in
  dem) step_dem ;;
  tiles) step_tiles ;;
  serve) step_serve ;;
  check) step_check ;;
  clean) step_clean ;;
  all) step_dem; step_tiles; step_serve; step_check ;;
  *) echo "uso: $0 [all|dem|tiles|serve|check|clean]" >&2; exit 2 ;;
esac
