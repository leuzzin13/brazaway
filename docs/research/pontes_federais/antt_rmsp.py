import csv,collections,json
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from shapely.prepared import prep
r=json.load(open('rmsp_municipios.geojson'))
polys=[(f['properties']['nome'],shape(f['geometry'])) for f in r['features']]
U=prep(unary_union([p for _,p in polys]))
cols=['concessionaria','tipo','nome','ano_pnv_snv','extensao','localizacao','rodovia_entrada','pista_entrada','sentido_entrada','km_ini','lat_ini','lon_ini','km_fim','lat_fim','lon_fim','rodovia_saida','pista_saida','sentido_saida','km_ini_s','lat_ini_s','lon_ini_s','km_fim_s','lat_fim_s','lon_fim_s']
rows=list(csv.reader(open('antt_pontes_similares.csv',encoding='cp1252'),delimiter=';'))[1:]
recs=[dict(zip(cols,r)) for r in rows]
bad=0;out=[]
for d in recs:
    try: lat=float(d['lat_ini']); lon=float(d['lon_ini'])
    except: bad+=1; continue
    if not(-35<lat<6 and -75<lon<-30): bad+=1; continue
    pt=Point(lon,lat)
    if U.contains(pt):
        d['municipio']=next(n for n,p in polys if p.contains(pt)); out.append(d)
print('total',len(recs),'coord invalida',bad)
print('RMSP',len(out))
print(collections.Counter((d['concessionaria'],d['rodovia_entrada'],d['tipo']) for d in out).most_common())
print(collections.Counter(d['municipio'] for d in out).most_common())
print(collections.Counter(d['rodovia_entrada'] for d in recs).most_common(40))
json.dump({'type':'FeatureCollection','features':[{'type':'Feature','geometry':{'type':'LineString','coordinates':[[float(d['lon_ini']),float(d['lat_ini'])],[float(d['lon_fim'] or d['lon_ini']),float(d['lat_fim'] or d['lat_ini'])]]},'properties':d} for d in out]},open('antt_pontes_rmsp.geojson','w'),ensure_ascii=False)
