import json, collections, re, math, sys
from shapely.geometry import shape, Point
from shapely.strtree import STRtree
from shapely.prepared import prep
B='/private/tmp/claude-501/-Users-arthurleuzzi-Downloads-n8n-code-javascript/de99f64a-b388-4b25-9cc1-69bceb35b74f/scratchpad/research/altura_sinalizacao/'
poly=json.load(open(B+'rmsp_capital.json'))
RMSP=prep(shape(poly['rmsp'])); CAP=prep(shape(poly['capital']))
MAIN={'motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link'}
TERT={'tertiary','tertiary_link'}
OTHER={'unclassified','residential','service','living_street','road'}
DRIVE=MAIN|TERT|OTHER
def layer(p):
    try: return float(str(p.get('layer','0')).split(';')[0])
    except: return 0.0
def isbridge(p): return p.get('bridge') not in (None,'no')
def istunnel(p): return p.get('tunnel') not in (None,'no')
def hasmh(p): return any(k in p for k in ('maxheight','maxheight:physical'))
roads=[];structs=[];tunnels=[];nodes_mh=[];barriers=[]
mhvals=collections.Counter(); mh_by_class=collections.Counter()
with open(B+'osm/gsp_ways.geojsonseq') as f:
    for line in f:
        line=line.strip('\x1e\n ')
        if not line: continue
        ft=json.loads(line); p=ft['properties']; g=ft['geometry']
        if g['type']=='Point':
            if 'maxheight' in p: nodes_mh.append((p,g))
            if p.get('barrier')=='height_restrictor': barriers.append((p,g))
            continue
        if g['type']!='LineString': continue
        hw=p.get('highway'); rw=p.get('railway')
        geom=shape(g)
        if hasmh(p):
            mhvals[p.get('maxheight',p.get('maxheight:physical'))]+=1
        if isbridge(p) and (hw or rw):
            structs.append((p,geom))
        if hw in DRIVE and p.get('area')!='yes':
            if istunnel(p): tunnels.append((p,geom))
            elif not isbridge(p): roads.append((p,geom))
print('roads(non-bridge,non-tunnel drivable)',len(roads),'structures(bridge=*)',len(structs),'tunnels drivable',len(tunnels))
print('nodes c/ maxheight',len(nodes_mh),'barrier=height_restrictor',len(barriers))
tree=STRtree([g for _,g in roads])
pairs=[]
for sp,sg in structs:
    sl=layer(sp)
    for idx in tree.query(sg,predicate='crosses'):
        rp,rg=roads[idx]
        if layer(rp)>=sl and 'layer' in sp: continue
        if layer(rp)>sl: continue
        ip=sg.intersection(rg)
        pt=ip if ip.geom_type=='Point' else ip.representative_point()
        pairs.append(dict(road_id=rp['@id'] if '@id' in rp else rp.get('id'),hw=rp['highway'],name=rp.get('name') or rp.get('ref'),
            road_mh=hasmh(rp),mh=rp.get('maxheight') or rp.get('maxheight:physical'),
            struct_kind=('rail' if sp.get('railway') else ('foot' if sp.get('highway') in ('footway','path','cycleway','steps','pedestrian') else 'road')),
            struct_name=sp.get('name'),lon=pt.x,lat=pt.y))
print('pares estrutura-sobre-via',len(pairs))
# dedupe clustering ~25 m grid per road class group
def cluster(ps,tol=25):
    cells={};out=[]
    for p in ps:
        kx=int(p['lon']*111320*0.917/tol);ky=int(p['lat']*110540/tol)
        hit=None
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                if (kx+dx,ky+dy) in cells: hit=cells[(kx+dx,ky+dy)];break
            if hit is not None: break
        if hit is None:
            out.append(dict(p,n=1,any_mh=p['road_mh'],all_mh=p['road_mh']));cells[(kx,ky)]=len(out)-1
        else:
            o=out[hit];o['n']+=1;o['any_mh']|=p['road_mh'];o['all_mh']&=p['road_mh']
    return out
res={}
def report(label,flt):
    ps=[p for p in pairs if flt(p)]
    for area,pr in (('bbox',None),('RMSP',RMSP),('capital',CAP)):
        qs=[p for p in ps if pr is None or pr.contains(Point(p['lon'],p['lat']))]
        cl=cluster(qs)
        nomh=sum(1 for c in cl if not c['any_mh'])
        r=dict(pares=len(qs),pares_com_mh=sum(p['road_mh'] for p in qs),locais=len(cl),locais_sem_mh=nomh,pct_sem=round(100*nomh/max(1,len(cl)),1))
        res[(label,area)]=r
        print(f'{label:45s} {area:8s}',r)
report('via principal (motorway..secondary) sob qualquer estrutura',lambda p:p['hw'] in MAIN)
report('via principal sob ponte rodoviaria',lambda p:p['hw'] in MAIN and p['struct_kind']=='road')
report('via principal sob ponte ferroviaria',lambda p:p['hw'] in MAIN and p['struct_kind']=='rail')
report('via principal sob passarela',lambda p:p['hw'] in MAIN and p['struct_kind']=='foot')
report('tertiary sob qualquer estrutura',lambda p:p['hw'] in TERT)
report('local/servico sob qualquer estrutura',lambda p:p['hw'] in OTHER)
# tunnels
for area,pr in (('bbox',None),('RMSP',RMSP),('capital',CAP)):
    t=[(p,g) for p,g in tunnels if pr is None or pr.contains(g.representative_point())]
    tm=[(p,g) for p,g in t if p['highway'] in MAIN|TERT]
    print('tuneis',area,'total ways',len(t),'sem mh',sum(1 for p,_ in t if not hasmh(p)),'| principais+tert',len(tm),'sem mh',sum(1 for p,_ in tm if not hasmh(p)),'| tunnel=building_passage',sum(1 for p,_ in t if p.get('tunnel')=='building_passage'))
# maxheight values
def num(v):
    m=re.match(r'^\s*([0-9]+(?:[.,][0-9]+)?)\s*(m)?\s*$',str(v))
    return float(m.group(1).replace(',','.')) if m else None
vals=[(v,num(v)) for v in mhvals.elements()]
nums=[n for v,n in vals if n is not None]
print('maxheight ways total',len(vals),'numericos',len(nums),'nao numericos',collections.Counter(v for v,n in vals if n is None).most_common(10))
bins=collections.Counter()
for n in nums:
    b='<3.0' if n<3 else '3.0-3.49' if n<3.5 else '3.5-3.99' if n<4 else '4.0-4.39' if n<4.4 else '4.40-4.99' if n<5 else '>=5.0'
    bins[b]+=1
print('faixas',sorted(bins.items()))
print('top valores',mhvals.most_common(15))
# export low clearance main-road crossings without maxheight (sample)
cl=cluster([p for p in pairs if p['hw'] in MAIN and RMSP.contains(Point(p['lon'],p['lat']))])
sem=[c for c in cl if not c['any_mh']]
json.dump({'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'Point','coordinates':[c['lon'],c['lat']]},'properties':{k:c[k] for k in ('hw','name','struct_kind','struct_name','n')}} for c in sem]},open(B+'osm/rmsp_vias_principais_sob_estrutura_sem_maxheight.geojson','w'))
json.dump({'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'Point','coordinates':[c['lon'],c['lat']]},'properties':{k:c[k] for k in ('hw','name','struct_kind','struct_name','n','any_mh','mh')}} for c in cl]},open(B+'osm/rmsp_vias_principais_sob_estrutura_todos.geojson','w'))
print('exportados',len(sem),'de',len(cl))
# top names without maxheight
print(collections.Counter(c['name'] for c in sem).most_common(25))
