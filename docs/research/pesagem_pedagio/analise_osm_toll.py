# Conta pedágios/balanças no extrato OSM (sudeste) e na bbox da Grande SP
import json,collections,math,sys,os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),'osm'))
BB=(-24.1,-47.25,-23.15,-45.65)
feats=[json.loads(l.strip().lstrip('\x1e')) for l in open('toll_sudeste.geojsonseq') if l.strip()]
def first(g):
    c=g['coordinates']; return c if g['type']=='Point' else c[len(c)//2]
def inb(lon,lat): return BB[0]<=lat<=BB[2] and BB[1]<=lon<=BB[3]
def length(c):
    L=0
    for (a,b),(x,y) in zip(c,c[1:]):
        L+=math.hypot((x-a)*111320*math.cos(math.radians(b)),(y-b)*110540)
    return L
cnt=collections.Counter(); cntg=collections.Counter(); tollkm=collections.Counter(); tollkm_g=collections.Counter(); tagsamp=collections.Counter()
for f in feats:
    p=f['properties']; g=f['geometry']; lon,lat=first(g); ing=inb(lon,lat); keys=[]
    if p.get('barrier')=='toll_booth': keys.append(g['type']+' barrier=toll_booth')
    if p.get('highway')=='toll_gantry': keys.append(g['type']+' highway=toll_gantry')
    if p.get('amenity')=='weighbridge': keys.append(g['type']+' amenity=weighbridge')
    if p.get('highway')=='weigh_station': keys.append(g['type']+' highway=weigh_station')
    if 'weighbridge' in p: keys.append('weighbridge=*')
    if g['type']=='LineString' and 'toll' in p: keys.append('way toll='+str(p['toll']))
    if g['type']=='LineString' and 'toll:hgv' in p: keys.append('way toll:hgv='+str(p['toll:hgv']))
    if g['type']=='LineString' and any(k.startswith('toll:') for k in p): keys.append('way toll:* (qualquer subchave)')
    for k in keys:
        cnt[k]+=1; cntg[k]+=ing
    if g['type']=='LineString' and p.get('toll')=='yes' and 'highway' in p:
        L=length(g['coordinates'])/1000; tollkm[p['highway']]+=L
        if ing: tollkm_g[p['highway']]+=L
    if g['type']=='Point' and (p.get('barrier')=='toll_booth' or p.get('highway')=='toll_gantry' or p.get('amenity')=='weighbridge'):
        for k in p:
            if k not in('@type','@id'): tagsamp[k]+=1
print('Sudeste (PBF Geofabrik local):'); [print('  ',k,v,'| Grande SP bbox:',cntg[k]) for k,v in cnt.most_common()]
print('km de vias toll=yes por highway (sudeste):',{k:round(v) for k,v in tollkm.most_common(8)})
print('km de vias toll=yes por highway (Grande SP):',{k:round(v) for k,v in tollkm_g.most_common(8)})
print('tags nos nós toll_booth/gantry/weighbridge:',tagsamp.most_common(25))
print('\nPontos na Grande SP:')
out=[]
for f in feats:
    p=f['properties']; g=f['geometry']
    if g['type']=='Point' and (p.get('barrier')=='toll_booth' or p.get('highway')=='toll_gantry' or p.get('amenity')=='weighbridge' or p.get('highway')=='weigh_station'):
        lon,lat=g['coordinates']; out.append(f)
        if inb(lon,lat): print('  ',p.get('@type'),p.get('@id'),{k:v for k,v in p.items() if k not in('@type','@id')},round(lat,5),round(lon,5))
json.dump({'type':'FeatureCollection','features':out},open('osm_toll_weigh_points_sudeste.geojson','w'),ensure_ascii=False)
