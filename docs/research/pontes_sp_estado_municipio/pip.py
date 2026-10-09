import json
def rings(geom):
    if geom['type']=='Polygon': return [geom['coordinates']]
    return geom['coordinates']
def pip_ring(x,y,ring):
    ins=False;n=len(ring);j=n-1
    for i in range(n):
        xi,yi=ring[i][:2];xj,yj=ring[j][:2]
        if ((yi>y)!=(yj>y)) and (x<(xj-xi)*(y-yi)/(yj-yi+1e-300)+xi): ins=not ins
        j=i
    return ins
def pip(x,y,geom):
    for poly in rings(geom):
        if pip_ring(x,y,poly[0]) and not any(pip_ring(x,y,h) for h in poly[1:]): return True
    return False
def load_rmsp():
    rm=json.load(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'rmsp_ibge.json')))
    ids={str(m['id']):m['nome'] for m in rm['municipios']}
    feats=[f for f in json.load(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'sp_mun.geojson')))['features'] if f['properties']['codarea'] in ids]
    out=[]
    for f in feats:
        g=f['geometry'];xs=[];ys=[]
        for p in rings(g):
            for c in p[0]: xs.append(c[0]);ys.append(c[1])
        out.append((ids[f['properties']['codarea']],g,(min(xs),min(ys),max(xs),max(ys))))
    return out
RM=None
def mun_rmsp(x,y):
    global RM
    if RM is None: RM=load_rmsp()
    for nome,g,b in RM:
        if b[0]<=x<=b[2] and b[1]<=y<=b[3] and pip(x,y,g): return nome
    return None
