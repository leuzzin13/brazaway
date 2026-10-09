import json,sys,collections,math
R=sys.argv[1]
mal=json.load(open(f'{R}/ibge/rmsp_malha.geojson'))
polys=[]
for f in mal['features']:
    g=f['geometry']; rings=[]
    if g['type']=='Polygon': ps=[g['coordinates']]
    else: ps=g['coordinates']
    xs=[c[0] for p in ps for r in p for c in r]; ys=[c[1] for p in ps for r in p for c in r]
    polys.append((f['properties']['nome'],ps,(min(xs),min(ys),max(xs),max(ys))))
def inring(x,y,r):
    ins=False; j=len(r)-1
    for i in range(len(r)):
        xi,yi=r[i][0],r[i][1]; xj,yj=r[j][0],r[j][1]
        if ((yi>y)!=(yj>y)) and (x < (xj-xi)*(y-yi)/(yj-yi)+xi): ins=not ins
        j=i
    return ins
def which(x,y):
    for n,ps,bb in polys:
        if not(bb[0]<=x<=bb[2] and bb[1]<=y<=bb[3]): continue
        for p in ps:
            if inring(x,y,p[0]) and not any(inring(x,y,h) for h in p[1:]): return n
    return None
def hav(a,b):
    lon1,lat1=map(math.radians,a);lon2,lat2=map(math.radians,b)
    d=math.sin((lat2-lat1)/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 2*6371000*math.asin(math.sqrt(d))
stats=collections.defaultdict(collections.Counter)
km=collections.defaultdict(collections.Counter)
cond_samples=collections.defaultdict(list)
out=[]
for line in open(f'{R}/osm/hw_restr.geojsonseq'):
    line=line.strip().lstrip('\x1e')
    if not line: continue
    f=json.loads(line); g=f['geometry']
    if g['type']!='LineString': continue
    cs=g['coordinates']; mid=cs[len(cs)//2]
    n=which(mid[0],mid[1])
    if not n: continue
    t=f['properties']; L=sum(hav(cs[i],cs[i+1]) for i in range(len(cs)-1))/1000
    keys=[]
    if t.get('hgv') in ('no','destination','delivery','private','permissive','designated','yes'): keys.append('hgv='+t['hgv'])
    for k in ('hgv:conditional','maxweight:conditional','access:conditional','motor_vehicle:conditional','goods:conditional'):
        if k in t: keys.append(k); cond_samples[n].append((t.get('name'),k,t[k]))
    for k in ('maxweight','maxlength','maxheight','maxwidth','maxaxleload','hazmat','goods','maxweightrating:hgv','maxweight:hgv'):
        if k in t: keys.append(k)
    if 'bridge' in t and 'maxweight' in t: keys.append('ponte_com_maxweight')
    for k in keys: stats[n][k]+=1; km[n][k]+=L
    f['properties']['municipio']=n
    out.append(f)
json.dump({'type':'FeatureCollection','features':out},open(f'{R}/osm/rmsp_osm_restricoes.geojson','w'),ensure_ascii=False)
cols=['hgv=no','hgv=destination','hgv=delivery','hgv=designated','hgv:conditional','maxweight','ponte_com_maxweight','maxlength','maxheight','maxwidth','hazmat','access:conditional','motor_vehicle:conditional','maxweight:conditional']
print('municipio;'+';'.join(cols))
tot=collections.Counter()
for n,_,_ in sorted(polys):
    print(n+';'+';'.join(str(stats[n][c]) for c in cols)); tot.update(stats[n])
print('TOTAL RMSP;'+';'.join(str(tot[c]) for c in cols))
print('\nKM hgv=no/destination por municipio:')
for n,_,_ in sorted(polys):
    if km[n]['hgv=no'] or km[n]['hgv:conditional']: print(n, round(km[n]['hgv=no'],1),'km hgv=no;', round(km[n]['hgv:conditional'],1),'km hgv:conditional')
print('\nAMOSTRAS *:conditional fora de SP capital:')
for n,v in cond_samples.items():
    if n=='São Paulo': continue
    for s in v[:8]: print(n,'|',s)
print('\nTotal conditional SP capital:',len(cond_samples['São Paulo']))
c=collections.Counter(s[2] for s in cond_samples['São Paulo']); print(c.most_common(8))
