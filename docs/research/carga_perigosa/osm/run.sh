set -e
apt-get update -qq >/dev/null && apt-get install -y -qq osmium-tool >/dev/null
mkdir -p /out && cd /out
osmium tags-filter /data/sudeste-latest.osm.pbf w/hazmat w/hazmat:water w/hazmat:A w/hazmat:B w/hazmat:C w/hazmat:D w/hazmat:E w/hazmat:conditional -o hazmat_sudeste.osm.pbf --overwrite
osmium export hazmat_sudeste.osm.pbf -f geojsonseq -o hazmat_sudeste.geojsonseq --overwrite --geometry-types=linestring
osmium extract -b -47.21,-24.07,-45.69,-23.18 /data/sudeste-latest.osm.pbf -o rmsp_bbox.osm.pbf --overwrite
osmium tags-filter rmsp_bbox.osm.pbf w/highway w/tunnel=yes,building_passage,culvert -o tmp_hw.osm.pbf --overwrite
osmium tags-filter rmsp_bbox.osm.pbf 'w/tunnel=yes' -o tunnels_rmsp.osm.pbf --overwrite
osmium export tunnels_rmsp.osm.pbf -f geojsonseq -o tunnels_rmsp.geojsonseq --overwrite --geometry-types=linestring
rm -f tmp_hw.osm.pbf
ls -la
