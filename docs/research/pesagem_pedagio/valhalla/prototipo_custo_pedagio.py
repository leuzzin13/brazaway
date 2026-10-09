# Protótipo: custo de pedágio por rota = pontos de cobrança OSM (charge) a <=25 m da polilinha, com checagem de sentido (tag direction)
import json, math, re, urllib.request, sys, os
V='http://localhost:8002'
BASE=os.path.dirname(os.path.abspath(__file__))
pts=json.load(open(os.path.join(BASE,'..','osm','osm_toll_weigh_points_sudeste.geojson')))['features']
tolls=[f for f in pts if f['properties'].get('barrier')=='toll_booth' or f['properties'].get('highway')=='toll_gantry']
def post(path, body):
    r=urllib.request.Request(V+path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(r, timeout=120))
def decode(s, prec=6):
    i=lat=lon=0; out=[]
    while i<len(s):
        for which in (0,1):
            sh=res=0
            while True:
                b=ord(s[i])-63; i+=1; res|=(b&0x1f)<<sh; sh+=5
                if b<0x20: break
            d=~(res>>1) if res&1 else res>>1
            if which==0: lat+=d
            else: lon+=d
        out.append((lat/10**prec, lon/10**prec))
    return out
def xy(lat,lon,lat0): return (lon*111320*math.cos(math.radians(lat0)), lat*110540)
def seg_dist(p,a,b):
    ax,ay=a; bx,by=b; px,py=p; dx,dy=bx-ax,by-ay
    t=0 if dx==dy==0 else max(0,min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)))
    return math.hypot(px-(ax+t*dx),py-(ay+t*dy)), (math.degrees(math.atan2(dx,dy))%360)
def charge_hgv_axle(c, weekend=False):
    if not c: return None
    parts=c.split(';'); best=None
    for p in parts:
        m=re.match(r'(?:(Mo-Fr|Sa-Su)\s+)?([0-9.]+)\s*BRL/hgv/axle',p.strip())
        if m:
            if m.group(1) is None or (m.group(1)=='Sa-Su')==weekend: best=float(m.group(2))
    return best
def custo(locs, eixos, costing_extra=None):
    co={'axle_count':eixos}; co.update(costing_extra or {})
    res=post('/route',{'locations':locs,'costing':'truck','costing_options':{'truck':co}})
    shape=decode(res['trip']['legs'][0]['shape'])
    lat0=shape[0][0]; S=[xy(a,b,lat0) for a,b in shape]
    hits=[]
    for f in tolls:
        lon,lat=f['geometry']['coordinates']
        if not (min(p[0] for p in shape)-0.01<lat<max(p[0] for p in shape)+0.01 and min(p[1] for p in shape)-0.01<lon<max(p[1] for p in shape)+0.01): continue
        P=xy(lat,lon,lat0); best=(1e9,None)
        for a,b in zip(S,S[1:]):
            d,brg=seg_dist(P,a,b)
            if d<best[0]: best=(d,brg)
        if best[0]<=25:
            pr=f['properties']; dirs=[float(x) for x in re.findall(r'[0-9.]+',pr.get('direction',''))]
            ang=lambda a,b: min(abs(a-b)%360,360-abs(a-b)%360)
            # convencao observada no OSM-BR: direction aponta para o trafego que chega (oposto ao rumo); nos sobre a via (dist<=3 m) contam sempre
            ok=best[0]<=3 or (bool(dirs) and any(ang(best[1],(d+180)%360)<60 for d in dirs))
            hits.append({'osm_id':pr['@id'],'nome':pr.get('note') or pr.get('name'),'operador':pr.get('operator'),'dist_m':round(best[0],1),'rumo_rota':round(best[1]),'direction':pr.get('direction'),'sentido_ok':ok,'R$_eixo':charge_hgv_axle(pr.get('charge')),'check_date':pr.get('check_date')})
    tot=sum(h['R$_eixo']*eixos for h in hits if h['sentido_ok'] and h['R$_eixo'])
    return res['trip']['summary'], hits, tot
if __name__=='__main__':
    casos={'Lapa(SP)->Jundiai':[{'lat':-23.5205,'lon':-46.7045},{'lat':-23.1857,'lon':-46.8978}],
           'Guarulhos(Dutra)->Sao Jose dos Campos':[{'lat':-23.4628,'lon':-46.4890},{'lat':-23.2237,'lon':-45.9009}],
           'Barueri->Santos(porto)':[{'lat':-23.5113,'lon':-46.8760},{'lat':-23.9535,'lon':-46.3332}]}
    for nome,locs in casos.items():
        for eixos in (2,5,9):
            s,hits,tot=custo(locs,eixos)
            print(f"{nome} | {eixos} eixos | {s['length']:.1f} km | has_toll={s.get('has_toll')} | pontos casados={len(hits)} | custo estimado R$ {tot:.2f}")
        for h in hits: print('    ',h)
