import json,collections,math
from shapely.geometry import shape, Point
from shapely.strtree import STRtree
feats=[]
for line in open('osm_bridges_gsp_bbox.geojsonseq'):
    line=line.strip().lstrip('\x1e')
    if not line: continue
    f=json.loads(line); p=f['properties']
    if 'highway' not in p: continue
    feats.append(f)
print('OSM ways ponte com highway (bbox GSP):',len(feats))
road=[f for f in feats if f['properties']['highway'] in ('motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','tertiary')]
geoms=[shape(f['geometry']) for f in road]
tree=STRtree(geoms)
def m2deg(m): return m/111000
for name,path,ptkey in [('DNIT SGO','oae_sgo_rmsp.geojson',None),('ANTT','antt_pontes_rmsp.geojson',None)]:
    fs=json.load(open(path))['features']
    if name=='DNIT SGO': fs=[f for f in fs if f['properties']['tipo_obra'] not in ('Passarela','Passagem de Pedestres')]
    hit=0; withw=0; withh=0; tags=collections.Counter()
    for f in fs:
        g=shape(f['geometry'])
        pt=g if g.geom_type=='Point' else g.interpolate(0.5,normalized=True)
        idx=tree.query(pt.buffer(m2deg(60)))
        near=[road[i] for i in idx]
        if near:
            hit+=1
            if any('maxweight' in n['properties'] for n in near): withw+=1
            if any('maxheight' in n['properties'] for n in near): withh+=1
            for n in near: tags[n['properties'].get('ref','(sem ref)')]+=1
    print(f'{name}: OAEs (sem passarela) {len(fs)} | com ponte OSM a <=60 m: {hit} | dessas com maxweight no OSM: {withw} | com maxheight: {withh}')
print('maxweight em pontes rodoviarias principais do bbox:',sum(1 for f in road if 'maxweight' in f['properties']),'de',len(road))
print('exemplos maxweight:',[ (f['properties'].get('name'),f['properties'].get('ref'),f['properties'].get('maxweight')) for f in road if 'maxweight' in f['properties']][:15])
