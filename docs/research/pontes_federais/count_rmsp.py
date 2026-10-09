import json,collections,sys
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from shapely.prepared import prep
r=json.load(open('rmsp_municipios.geojson'))
polys=[(f['properties']['nome'],shape(f['geometry'])) for f in r['features']]
U=prep(unary_union([p for _,p in polys]))
def fix(s):
    if not isinstance(s,str): return s
    try: return s.encode('latin-1').decode('utf-8')
    except Exception: return s
d=json.load(open('oae_sgo_full.json'))
out=[]
for f in d['features']:
    pt=Point(f['geometry']['coordinates'])
    if U.contains(pt):
        mun=next(n for n,p in polys if p.contains(pt))
        p={k:fix(v) for k,v in f['properties'].items()}; p['municipio']=mun
        out.append({'type':'Feature','geometry':f['geometry'],'properties':p})
print('RMSP OAEs',len(out))
print(collections.Counter((o['properties']['br'],o['properties']['tipo_obra']) for o in out).most_common())
print(collections.Counter(o['properties']['municipio'] for o in out).most_common())
print(collections.Counter(o['properties']['tipo_estr'] for o in out).most_common())
json.dump({'type':'FeatureCollection','features':out},open('oae_sgo_rmsp.geojson','w'),ensure_ascii=False)
