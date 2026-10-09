set -e
cd /out
# vias do minianel (Anexo IV Portaria SMT 051/2024) pelo nome
osmium tags-filter rmsp_bbox.osm.pbf 'w/highway' -o hw.osm.pbf --overwrite
osmium tags-filter hw.osm.pbf 'w/name=Marginal Tietê,Marginal Pinheiros,Avenida Marginal do Rio Tietê,Avenida Marginal do Rio Pinheiros,Avenida dos Bandeirantes,Avenida Afonso D'"'"'Escragnolle Taunay,Viaduto Ministro Aliomar Baleeiro,Complexo Viário Maria Maluf,Avenida Presidente Tancredo Neves,Rua Malvina Ferrara Samarone,Rua Cipriano Siqueira,Rua das Juntas Provisórias,Viaduto Grande São Paulo,Avenida Professor Luís Ignácio de Anhaia Melo,Avenida Professor Luiz Ignácio Anhaia Mello,Avenida Salim Farah Maluf' -o minianel.osm.pbf --overwrite
osmium export minianel.osm.pbf -f geojsonseq -o minianel.geojsonseq --overwrite --geometry-types=linestring
# nomes candidatos para conferir grafia
osmium tags-filter hw.osm.pbf 'w/name~Marginal' -o marg.osm.pbf --overwrite
osmium export marg.osm.pbf -f geojsonseq -o marg.geojsonseq --overwrite --geometry-types=linestring
osmium tags-filter hw.osm.pbf 'w/name~Anhaia' 'w/name~Taunay' 'w/name~Juntas' 'w/name~Salim' 'w/name~Tancredo' 'w/name~Aliomar' 'w/name~Maria Maluf' 'w/name~Grande São Paulo' 'w/name~Samarone' 'w/name~Cipriano Siqueira' 'w/name~Bandeirantes' -o names.osm.pbf --overwrite
osmium export names.osm.pbf -f geojsonseq -o names.geojsonseq --overwrite --geometry-types=linestring
ls -la *.geojsonseq
