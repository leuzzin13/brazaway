import json,glob,collections
from osgeo import ogr,osr
src=osr.SpatialReference(); src.ImportFromEPSG(4326); src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
dst=osr.SpatialReference(); dst.ImportFromEPSG(31983); dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
tr=osr.CoordinateTransformation(src,dst)
basins={}
for f in glob.glob('/w/mananciais/*.geojson'):
    d=json.load(open(f))
    # detect CRS: datageo may return lon/lat
    g=None
    for ft in d['features']:
        gg=ogr.CreateGeometryFromJson(json.dumps(ft['geometry']))
        g=gg if g is None else g.Union(gg)
    env=g.GetEnvelope()
    name=f.split('/')[-1].replace('.geojson','')
    g.Transform(tr); basins[name]=g.Buffer(0)
    print(name,'env',[round(v,3) for v in env],'area km2',round(basins[name].GetArea()/1e6,1))
roads=collections.defaultdict(float)
for line in open('/w/osm/mtp_rmsp.geojsonseq'):
    line=line.strip('\x1e\n')
    if not line: continue
    ft=json.loads(line); p=ft['properties']
    g=ogr.CreateGeometryFromJson(json.dumps(ft['geometry'])); g.Transform(tr)
    for b,bg in basins.items():
        if g.Intersects(bg):
            L=g.Intersection(bg).Length()
            key=(b,p.get('ref') or '',p.get('name') or '(sem nome)',p.get('highway'))
            roads[key]+=L
tot=collections.defaultdict(float)
for (b,ref,n,h),L in roads.items(): tot[b]+=L
print('km de motorway/trunk/primary(+links) dentro de cada bacia (soma de ways, pistas separadas contam 2x):',{k:round(v/1000,1) for k,v in tot.items()})
byname=collections.defaultdict(float)
for (b,ref,n,h),L in roads.items():
    if h in ('motorway','trunk'): byname[(b,ref,n)]+=L
for (b,ref,n),L in sorted(byname.items(), key=lambda x:-x[1])[:40]:
    print(f'{b:35s} {ref:12s} {L/1000:6.1f} km  {n}')
# CETESB emergencias TR dentro das bacias
import csv
cnt=collections.Counter(); rod=collections.Counter()
for r in csv.DictReader(open('/w/cetesb_emergencias_transporte_rodoviario_2014_2026.csv')):
    if not r['lon']: continue
    pt=ogr.Geometry(ogr.wkbPoint); pt.AddPoint_2D(float(r['lon']),float(r['lat'])); pt.Transform(tr)
    for b,bg in basins.items():
        if pt.Within(bg): cnt[b]+=1; rod[(b,r['Rodovia'])]+=1
print('emergencias CETESB transporte rodoviario 2014-2026 dentro das bacias:',dict(cnt))
print(rod.most_common(15))
