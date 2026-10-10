#!/usr/bin/env bash
# Atualiza as zonas de restrição de São Paulo a partir do GeoSampa (ZMRC e Mini-Anel do rodízio), via ogr2ogr.
# Roda dentro do container gdal: docker compose --profile import run --rm gdal
#
# 1) Para cada camada (zmrc, mian): se existir arquivo em /data/raw (GeoJSON, SHP ou GPKG baixado manualmente), usa ele;
#    senão, baixa do WFS público do GeoSampa. O resultado fica sempre em
#    /data/raw/geosampa_restricao_circulacao_veiculo_<camada>.geojson, que é a entrada de scripts/gen-zones-seed.py.
# 2) ZMRC (...0001): atualiza a geometria no banco na hora (as regras ficam como estão).
# 3) Mini-Anel: NÃO grava no banco. As zonas ...0002 (rodízio de caminhões, sem o corredor das vias do Minianel),
#    ...0003 e ...0004 saem de scripts/gen-zones-seed.py, e o corte do corredor depende de remedir a borda. Gravar o
#    polígono inteiro na ...0002 desfazia o corte (Decreto 58.584/2018 art. 2º §2º) até o próximo migrate.
#    Depois deste script, no host:
#      python3 scripts/gen-zones-seed.py --measure      # remede o corredor e regenera db/seed/0002_zones.sql
#      docker exec -i truck-router-db psql -U truck -d truck_router < db/seed/0002_zones.sql
#    (o gerador também lê a ZMRC de data/raw, então o seed fica igual ao banco)
set -euo pipefail
RAW=/data/raw
WFS="https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs"
PG="PG:host=${PGHOST} user=${PGUSER} password=${PGPASSWORD} dbname=${PGDATABASE}"

fetch_layer() { # $1=layer (zmrc|mian) -> caminho do GeoJSON canônico em /data/raw
  local layer=$1 out f
  out="${RAW}/geosampa_restricao_circulacao_veiculo_${layer}.geojson"
  # arquivo baixado à mão (o mais recente que não seja o canônico) tem prioridade
  f=$(ls -t ${RAW}/*${layer}*.shp ${RAW}/*${layer}*.gpkg ${RAW}/*${layer}*.geojson ${RAW}/*${layer}*.json 2>/dev/null | grep -vxF "$out" | head -1 || true)
  if [[ -z "$f" && -s "$out" ]]; then
    echo "==> usando $out" >&2
  elif [[ -z "$f" ]]; then
    echo "==> baixando ${layer} do WFS GeoSampa" >&2
    curl -sf --max-time 120 "${WFS}?service=WFS&version=1.0.0&request=GetFeature&typeName=geoportal:restricao_circulacao_veiculo_${layer}&outputFormat=application/json&srsName=EPSG:4326" -o "$out" \
      || { echo "ERRO: não consegui baixar ${layer}; veja data/raw/README.md" >&2; return 1; }
  else
    echo "==> convertendo $f -> $out" >&2
    rm -f "$out.tmp"
    ogr2ogr -f GeoJSON -t_srs EPSG:4326 "$out.tmp" "$f" && mv "$out.tmp" "$out"
  fi
  echo "$out"
}

ZMRC_RULES=$(python3 -c "import json;print(json.dumps(json.load(open('/config/zmrc-rules.json'))['rules']))" 2>/dev/null \
  || echo '{"windows":[{"days":[1,2,3,4,5],"from":"05:00","to":"21:00"},{"days":[6],"from":"10:00","to":"14:00"}],"skip_on_holidays":true,"vehicle_scope":"trucks","suspension_scope":"zmrc","exceptions":["vuc_aetc"]}')

f=$(fetch_layer zmrc)
echo "==> importando $f (ZMRC)"
ogr2ogr -f PostgreSQL "$PG" "$f" -nln zone_import_tmp -overwrite -t_srs EPSG:4326 -nlt PROMOTE_TO_MULTI -lco GEOMETRY_NAME=geom
src="GeoSampa WFS geoportal:restricao_circulacao_veiculo_zmrc (import $(date -u +%F); CC-BY-SA 4.0)"
# a imagem do GDAL não tem psql: o SQL vai pelo driver PostgreSQL do OGR (ExecuteSQL repassa ao servidor)
ogrinfo "$PG" -q -sql "insert into restriction_zones (id, name, geom, rules, source)
select '22222222-2222-4222-8222-000000000001', 'ZMRC São Paulo', ST_Multi(ST_Union(geom)), \$r\$${ZMRC_RULES}\$r\$::jsonb, \$s\$${src}\$s\$
  from zone_import_tmp
on conflict (id) do update set geom = excluded.geom, source = excluded.source" >/dev/null
ogrinfo "$PG" -q -sql "drop table zone_import_tmp" >/dev/null

f=$(fetch_layer mian)
echo "==> Mini-Anel salvo em $f (não gravado no banco: o corte do corredor precisa de nova medição)"
echo "    no host: python3 scripts/gen-zones-seed.py --measure && docker exec -i truck-router-db psql -U truck -d truck_router < db/seed/0002_zones.sql"
echo "zonas OK"
