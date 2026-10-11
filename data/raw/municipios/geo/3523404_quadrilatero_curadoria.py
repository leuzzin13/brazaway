"""Itatiba (3523404): quadrilátero central da Lei 2.455/1993 (red. Leis 4.635/2014 e 5.789/2025), art. 1º.

Gera 3523404_quadrilatero.geojson: o quadrilátero formado pelos eixos das ruas Cel. Camilo Pires, Benjamin Constant,
Tobias Franco e Quintino Bocaiúva no OpenStreetMap (ODbL 1.0), cortados entre os cruzamentos, com folga de 30 m para
fora (a camada recua a zona 20 m; as ruas-limite, que também são do art. 1º, ficam dentro).

  python3 data/raw/municipios/geo/3523404_quadrilatero_curadoria.py 3523404 <saida.geojson> 30 \
      "Rua Coronel Camilo Pires" "Rua Benjamin Constant" "Rua Tobias Franco" "Rua Quintino Bocaiúva"

Lê o extrato do OSM em osm/all_3523404.json (formato Overpass "out geom tags"). Requer shapely e pyproj.
"""
import warnings; warnings.filterwarnings('ignore')
import json, sys
from shapely.geometry import LineString, Polygon, mapping
from shapely.ops import unary_union, linemerge, substring, transform
from pyproj import Transformer
T=Transformer.from_crs(4326,31983,always_xy=True).transform; Ti=Transformer.from_crs(31983,4326,always_xy=True).transform
ibge,out,folga=sys.argv[1],sys.argv[2],float(sys.argv[3]); vias=sys.argv[4:]
els=json.load(open(f'osm/all_{ibge}.json'))['elements']
L={}
for n in vias:
    u=unary_union([LineString([(p['lon'],p['lat']) for p in e['geometry']]) for e in els if e['tags'].get('name')==n and 'highway' in e['tags']])
    L[n]=transform(T,u if u.geom_type=='LineString' else linemerge(u))
def pt(a,b):
    i=L[a].intersection(L[b])
    if i.is_empty: 
        from shapely.ops import nearest_points
        p,q=nearest_points(L[a],L[b]); return p
    return i if i.geom_type=='Point' else list(i.geoms)[0]
coords=[]
for k in range(4):
    v=vias[k]; c0=pt(vias[k-1],v); c1=pt(v,vias[(k+1)%4])
    line=L[v]
    if line.geom_type!='LineString':
        line=min(line.geoms,key=lambda g:g.distance(c0)+g.distance(c1))
    a,b=line.project(c0),line.project(c1)
    s=substring(line,min(a,b),max(a,b))
    cs=list(s.coords)
    if a>b: cs=cs[::-1]
    dev=max(LineString([cs[0],cs[-1]]).distance(__import__('shapely.geometry',fromlist=['Point']).Point(c)) for c in cs)
    print(v,f'{s.length:.0f} m, desvio da reta {dev:.0f} m')
    coords+=cs
P=Polygon(coords).buffer(0)
P=P.buffer(folga,join_style=2)
P=Polygon(P.exterior).simplify(1)
G=transform(Ti,P)
print('area m2',round(P.area))
json.dump({'type':'FeatureCollection','fonte_geometria':'Eixos das 4 ruas-limite no OpenStreetMap (ODbL 1.0), folga de %d m para fora' % folga,
           'features':[{'type':'Feature','properties':{'descricao':'Quadrilátero central de Itatiba (ruas Cel. Camilo Pires, Benjamin Constant, Tobias Franco e Quintino Bocaiúva), com as ruas-limite','folga_m':folga},
                        'geometry':{'type':'Polygon','coordinates':[[[round(x,6),round(y,6)] for x,y in G.exterior.coords]]}}]},open(out,'w'),ensure_ascii=False)
