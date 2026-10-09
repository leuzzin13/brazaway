#!/bin/bash
# uso: compare_area.sh NOME  (depois de run_area.sh + pdal)
set -e
N=$1; cd /w/dem
gdalwarp -q -overwrite -t_srs EPSG:4326 -tr 0.00001 0.00001 -r bilinear -srcnodata -9999 -dstnodata -9999 -co COMPRESS=DEFLATE -co TILED=YES lidar_$N.tif lidar_${N}_4326.tif
read MINX MAXY MAXX MINY < <(python3 - <<P
from osgeo import gdal
ds=gdal.Open('lidar_${N}_4326.tif');gt=ds.GetGeoTransform()
print(gt[0], gt[3], gt[0]+gt[1]*ds.RasterXSize, gt[3]+gt[5]*ds.RasterYSize)
P
)
TE=$(python3 -c "
import math
r=1/3600; x0=-47-r/2; y0=-23+r/2
minx,miny,maxx,maxy=$MINX+0.0002,$MINY+0.0002,$MAXX-0.0002,$MAXY-0.0002
a=x0+math.ceil((minx-x0)/r)*r; b=x0+math.floor((maxx-x0)/r)*r
c=y0-math.floor((y0-miny)/r)*r; d=y0-math.ceil((y0-maxy)/r)*r
print(f'{a:.9f} {c:.9f} {b:.9f} {d:.9f}')")
gdalwarp -q -overwrite -t_srs EPSG:4326 -te $TE -tr 0.000277777777778 0.000277777777778 -r average -srcnodata -9999 -dstnodata -9999 lidar_$N.tif lidar_${N}_1arcsec.tif
B=$(python3 -c "print($MINX+0.0012, $MINY+0.0012, $MAXX-0.0012, $MAXY-0.0012)")
cd /w && python3 -W ignore - <<P
import sys
sys.argv=["x"]
import grade_analysis as ga
ga.DEMS["lidar_resampled_1arcsec"]="/w/dem/lidar_${N}_1arcsec.tif"
b="$B".split()
sys.argv=["lidar_compare.py","/w/roads.geojsonseq","/w/dem/lidar_${N}_4326.tif","/w/lidar_compare_${N}.json"]+b
exec(open("/w/lidar_compare.py").read(), {"__name__":"__main__"})
P
