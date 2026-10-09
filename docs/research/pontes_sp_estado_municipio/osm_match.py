import json,math,collections,csv
from pip import mun_rmsp, pip, load_rmsp
K=111320*math.cos(math.radians(-23.6));KY=110540
def xy(lon,lat): return (lon*K,lat*KY)
osm=[]
for line in open('osm/rmsp_oae_candidates.geojsonseq'):
    line=line.strip().lstrip('\x1e')
    if not line: continue
    f=json.loads(line);p=f['properties']
    if 'highway' not in p: continue
    osm.append(f)
br=[f for f in osm if f['properties'].get('bridge') not in (None,'no')]
tn=[f for f in osm if f['properties'].get('tunnel') not in (None,'no')]
print('OSM highway ways no bbox: total cand',len(osm),'bridges',len(br),'tunnels',len(tn))
# municipality assignment by midpoint
RM=load_rmsp()
def mid(c): return c[len(c)//2]
cnt=collections.Counter();sp=[]
for f in br:
    lo,la=mid(f['geometry']['coordinates']);m=mun_rmsp(lo,la);f['mun']=m
    if m: cnt['RMSP']+=1
    if m=='São Paulo': sp.append(f)
print('bridges RMSP',cnt['RMSP'],'cidade SP',len(sp))
hw=collections.Counter(f['properties']['highway'] for f in br if f['mun']);print('highway de pontes RMSP',hw.most_common(12))
tags=collections.Counter()
for f in br:
    if f['mun']:
        for k in ['maxweight','maxweight:hgv','maxaxleload','maxheight','hgv','bridge:structure','name','bridge:name','layer']:
            if k in f['properties']: tags[k]+=1
print('tags em pontes RMSP',tags)
mw=[(f['properties'].get('name'),f['properties'].get('maxweight'),f['mun']) for f in br if f['mun'] and ('maxweight' in f['properties'] or 'maxweight:hgv' in f['properties'])]
print('pontes RMSP com maxweight',len(mw),mw[:20])
# grid index of bridge segments
G=collections.defaultdict(list);CELL=100
def segs(f):
    c=[xy(*p[:2]) for p in f['geometry']['coordinates']]
    return list(zip(c,c[1:]))
for i,f in enumerate(br):
    for a,b in segs(f):
        for gx in range(int(min(a[0],b[0])//CELL)-1,int(max(a[0],b[0])//CELL)+2):
            for gy in range(int(min(a[1],b[1])//CELL)-1,int(max(a[1],b[1])//CELL)+2):
                G[(gx,gy)].append((a,b,i))
def dseg(p,a,b):
    ax,ay=a;bx,by=b;px,py=p;dx,dy=bx-ax,by-ay
    t=0 if dx==dy==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-(ax+t*dx),py-(ay+t*dy))
def nearest(lon,lat,maxd=100):
    p=xy(lon,lat);best=(1e9,None)
    for gx in range(int(p[0]//CELL)-1,int(p[0]//CELL)+2):
        for gy in range(int(p[1]//CELL)-1,int(p[1]//CELL)+2):
            for a,b,i in G.get((gx,gy),[]):
                d=dseg(p,a,b)
                if d<best[0]: best=(d,i)
    return best if best[0]<=maxd else (None,None)
