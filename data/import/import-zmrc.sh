#!/usr/bin/env bash
# Reimporta as zonas de restrição (ZMRC e Mini-Anel do rodízio) do GeoSampa para o PostGIS via ogr2ogr.
# Roda dentro do container gdal: docker compose --profile import run --rm gdal
# 1) Se existir arquivo em /data/raw (GeoJSON, SHP ou GPKG baixado manualmente), usa ele.
# 2) Senão, tenta baixar do WFS público do GeoSampa.
set -euo pipefail
RAW=/data/raw
WFS="https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs"
PG="PG:host=${PGHOST} user=${PGUSER} password=${PGPASSWORD} dbname=${PGDATABASE}"

import_layer() { # $1=layer (zmrc|mian) $2=uuid $3=nome $4=rules-json
  local layer=$1 id=$2 name=$3 rules=$4 src
  local f
  f=$(ls ${RAW}/*${layer}*.geojson ${RAW}/*${layer}*.json ${RAW}/*${layer}*.shp ${RAW}/*${layer}*.gpkg 2>/dev/null | head -1 || true)
  if [[ -z "$f" ]]; then
    f="${RAW}/geosampa_restricao_circulacao_veiculo_${layer}.geojson"
    echo "==> baixando ${layer} do WFS GeoSampa"
    curl -sf --max-time 120 "${WFS}?service=WFS&version=1.0.0&request=GetFeature&typeName=geoportal:restricao_circulacao_veiculo_${layer}&outputFormat=application/json&srsName=EPSG:4326" -o "$f" \
      || { echo "ERRO: não consegui baixar ${layer}; veja data/raw/README.md"; return 1; }
  fi
  echo "==> importando $f"
  ogr2ogr -f PostgreSQL "$PG" "$f" -nln zone_import_tmp -overwrite -t_srs EPSG:4326 -nlt PROMOTE_TO_MULTI -lco GEOMETRY_NAME=geom
  src="GeoSampa WFS geoportal:restricao_circulacao_veiculo_${layer} (import $(date -u +%F))"
  psql -v ON_ERROR_STOP=1 -q <<SQL
insert into restriction_zones (id, name, geom, rules, source)
select '${id}', \$n\$${name}\$n\$, ST_Multi(ST_Union(geom)), \$r\$${rules}\$r\$::jsonb, \$s\$${src}\$s\$ from zone_import_tmp
on conflict (id) do update set geom = excluded.geom, source = excluded.source;
drop table zone_import_tmp;
SQL
}

ZMRC_RULES=$(python3 -c "import json;print(json.dumps(json.load(open('/config/zmrc-rules.json'))['rules']))" 2>/dev/null \
  || echo '{"windows":[{"days":[1,2,3,4,5],"from":"05:00","to":"21:00"},{"days":[6],"from":"10:00","to":"14:00"}],"exceptions":["is_vuc"]}')
RODIZIO_RULES='{"windows":[{"days":[1,2,3,4,5],"from":"07:00","to":"10:00"},{"days":[1,2,3,4,5],"from":"17:00","to":"20:00"}],"exceptions":[],"plate_rule":{"digits_by_day":{"1":[1,2],"2":[3,4],"3":[5,6],"4":[7,8],"5":[9,0]}}}'

import_layer zmrc 22222222-2222-4222-8222-000000000001 "ZMRC São Paulo" "$ZMRC_RULES"
import_layer mian 22222222-2222-4222-8222-000000000002 "Rodízio municipal (Mini-Anel) São Paulo" "$RODIZIO_RULES"
echo "zonas importadas OK"
