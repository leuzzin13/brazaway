#!/bin/bash
# uso: run_area.sh NOME LON LAT   (área ~1,6 x 1,7 km centrada no ponto)
set -e
N=$1; LON=$2; LAT=$3
read X Y _ < <(echo "$LON $LAT" | gdaltransform -s_srs EPSG:4326 -t_srs EPSG:31983)
X0=$(python3 -c "print(int($X-800))"); X1=$(python3 -c "print(int($X+800))"); Y0=$(python3 -c "print(int($Y-870))"); Y1=$(python3 -c "print(int($Y+870))")
cat > /w/ept_$N.json <<J
{"pipeline":[
 {"type":"readers.ept","filename":"https://ept-m3dc-pmsp.s3.sa-east-1.amazonaws.com/ept.json","bounds":"([$X0,$X1],[$Y0,$Y1])","resolution":0.7},
 {"type":"filters.range","limits":"Classification[2:2]"},
 {"type":"writers.gdal","filename":"/w/dem/lidar_$N.tif","resolution":1.0,"output_type":"idw","window_size":6,"data_type":"float32","nodata":-9999,"gdalopts":"COMPRESS=DEFLATE,TILED=YES","override_srs":"EPSG:31983"}
]}
J
echo "$X0 $X1 $Y0 $Y1"
