#!/usr/bin/env bash
# Tiles do Valhalla para várias regiões do Brasil (padrão: Sudeste + Sul + Centro-Oeste) e o PBF fundido dos importadores.
#
#   ./scripts/build-tiles-regioes.sh            # baixa (se faltar) -> correções locais -> tiles em data/valhalla_build (porta 8004)
#   ./scripts/build-tiles-regioes.sh --swap     # idem e troca o Valhalla principal (o atual vai para data/cache/valhalla_anterior)
#
# Os extratos regionais repetem os objetos da divisa, às vezes em versões diferentes (o download.openstreetmap.fr
# atualiza ao longo do dia). `osmium merge` não remove essas duplicatas, e o Valhalla, lendo os PBF regionais juntos,
# monta um grafo QUEBRADO na divisa ("Could not find candidate edge used for destination label" em Itararé/Sengés).
# Por isso tudo sai de um PBF único sem duplicatas, data/osm/sse_co.osm.pbf (scripts/osm/dedup_pbf.py): os tiles e os
# importadores (radares, altura, lacunas, pedágio, descanso, postos; ver importers/common.py:osm_pbf()).
# As correções locais (data/osm-overrides) são aplicadas em cada PBF regional que tenha regra ativa no seu bbox.
# Variáveis: REGIOES (default "southeast south central-west", nomes do download.openstreetmap.fr), BUILD_THREADS (3).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
REGIOES="${REGIOES:-southeast south central-west}"
SRC="$ROOT/data/osm"; B="$ROOT/data/valhalla_build"; W="$ROOT/data/cache/osm-overrides-regioes"
BASE_URL="https://download.openstreetmap.fr/extracts/south-america/brazil"
log() { echo "[build-tiles-regioes $(date +%H:%M:%S)] $*"; }
mkdir -p "$SRC" "$B" "$W"

# 1) extratos (o mesmo dia para todos, senão a divisa diverge mais)
for r in $REGIOES; do
  [ -s "$SRC/$r-latest.osm.pbf" ] || { log "baixando $r"; curl -fL -o "$SRC/$r-latest.osm.pbf.part" "$BASE_URL/$r-latest.osm.pbf" && mv "$SRC/$r-latest.osm.pbf.part" "$SRC/$r-latest.osm.pbf"; }
done

# 2) correções locais: só nas regiões cujo PBF cruza o bbox de alguma regra ativa
python3 - "$ROOT/data/osm-overrides/overrides.json" > "$W/rules.tsv" <<'PY'
import json,sys
for r in json.load(open(sys.argv[1]))['rules']:
    if r['status'] == 'ativa':
        b=r['bbox']; print(f"{r['id']}\t{b[0]},{b[1]},{b[2]},{b[3]}")
PY
for r in $REGIOES; do
  in="$SRC/$r-latest.osm.pbf"; OSCS=()
  while IFS=$'\t' read -r id bbox; do
    osmium extract -b "$bbox" "$in" -o "$W/$r.$id.pbf" --overwrite -s smart
    python3 "$ROOT/scripts/osm-overrides/find_and_patch.py" "$ROOT/data/osm-overrides/overrides.json" "$W/$r.$id.pbf" "$id" "$W/$r.$id.osc" "$W/$r.$id.json" | sed "s/^/  $r: /"
    grep -q '<way ' "$W/$r.$id.osc" && OSCS+=("$W/$r.$id.osc")
    rm -f "$W/$r.$id.pbf"
  done < "$W/rules.tsv"
  if [ ${#OSCS[@]} -gt 0 ]; then osmium apply-changes "$in" "${OSCS[@]}" -o "$W/$r-latest.osm.pbf" --overwrite
  else ln -f "$in" "$W/$r-latest.osm.pbf"; fi
done

# 3) PBF único sem duplicatas (com as correções): ~1 h de Python para Sudeste+Sul+CO
log "PBF fundido"
osmium merge "$W"/*-latest.osm.pbf -o "$W/fundido_tmp.osm.pbf" --overwrite; rm -f "$W"/*-latest.osm.pbf
python3 -I "$ROOT/scripts/osm/dedup_pbf.py" "$W/fundido_tmp.osm.pbf" "$SRC/sse_co.osm.pbf"; rm -f "$W/fundido_tmp.osm.pbf"
ln -f "$SRC/sse_co.osm.pbf" "$B/sse_co.osm.pbf"

# 4) tiles (o contêiner não tem internet: fusos horários e velocidades vêm do conjunto atual)
cp "$ROOT/data/valhalla/valhalla.json" "$ROOT/data/valhalla/default_speeds.json" "$ROOT/data/valhalla/timezones.sqlite" "$B/"
log "construindo tiles"
docker rm -f valhalla-build >/dev/null 2>&1 || true
docker run -d --name valhalla-build -p 8004:8002 -v "$B:/custom_files" \
  -e server_threads="${BUILD_THREADS:-3}" -e build_admins=True -e build_time_zones=False -e build_elevation=False \
  -e force_rebuild=True -e use_tiles_ignore_pbf=True -e tile_urls= truck-router-valhalla:latest
until curl -sf localhost:8004/status >/dev/null; do sleep 30; docker ps -q -f name=valhalla-build | grep -q . || { docker logs --tail 50 valhalla-build; exit 1; }; done
log "valhalla-build respondendo em 8004"

if [ "${1:-}" = "--swap" ]; then
  docker rm -f valhalla-build >/dev/null; docker compose stop valhalla
  rm -rf "$ROOT/data/cache/valhalla_anterior"; mv "$ROOT/data/valhalla" "$ROOT/data/cache/valhalla_anterior"
  mv "$B" "$ROOT/data/valhalla"; touch "$ROOT/data/valhalla/.gitkeep"
  docker compose up -d valhalla
  log "pronto. Rollback: docker compose stop valhalla && mv data/valhalla $B && mv data/cache/valhalla_anterior data/valhalla && docker compose up -d valhalla"
fi
