set -e
apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null
mkdir -p /out && cd /out
osmium extract -b -47.6,-24.2,-45.8,-23.0 /pbf/sudeste-latest.osm.pbf -o gsp.osm.pbf --overwrite
osmium tags-filter gsp.osm.pbf w/highway w/railway w/bridge w/tunnel w/maxheight w/maxheight:physical n/maxheight n/traffic_sign n/barrier=height_restrictor n/hazard -o gsp_filt.osm.pbf --overwrite
osmium export gsp_filt.osm.pbf -f geojsonseq -o gsp_ways.geojsonseq --overwrite --geometry-types=linestring,point -a type,id
osmium tags-filter gsp.osm.pbf n/traffic_sign w/traffic_sign -o ts.osm.pbf --overwrite
osmium export ts.osm.pbf -f geojsonseq -o ts.geojsonseq --overwrite -a type,id
ls -la >&2; tar -C /out -cf - gsp_ways.geojsonseq ts.geojsonseq
