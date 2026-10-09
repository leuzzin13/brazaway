#!/usr/bin/env bash
# Wrapper do entrypoint oficial (docker-entrypoint.sh) da imagem valhalla-scripted.
# - Cria /custom_files/valhalla.json se ainda não existir (o script oficial o
#   reaproveita e corrige os caminhos de tiles/admin/timezone via jq).
# - Eleva os service_limits para aceitar exclude_polygons grandes (perímetro da
#   ZMRC passa dos 10 km default) e mais exclude_locations.
set -o errexit -o pipefail -o nounset

CUSTOM_FILES="${CUSTOM_FILES:-/custom_files}"
CONFIG_FILE="${CUSTOM_FILES}/valhalla.json"
mkdir -p "${CUSTOM_FILES}"

if ! test -f "${CONFIG_FILE}"; then
  echo "INFO [truck-router]: gerando ${CONFIG_FILE}"
  valhalla_build_config > "${CONFIG_FILE}"
fi

echo "INFO [truck-router]: ajustando service_limits em ${CONFIG_FILE}"
jq '.service_limits.max_exclude_polygons_length = 20000000
    | .service_limits.max_exclude_locations = 500
    | .service_limits.max_avoid_polygons_length = 20000000
    | .service_limits.max_avoid_locations = 500' "${CONFIG_FILE}" | sponge "${CONFIG_FILE}"

exec /valhalla/scripts/docker-entrypoint.sh "$@"
