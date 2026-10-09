import urllib.request, urllib.parse, json, re, sys, time, os
D=os.path.dirname(os.path.abspath(__file__))
BASE='https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs'
layers=sys.argv[1:]
def get(params, timeout=120):
    url=BASE+'?'+urllib.parse.urlencode(params)
    req=urllib.request.Request(url, headers={'User-Agent':'truck-router-mvp/0.1'})
    t=time.time()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        b=r.read(); return r.status, b, time.time()-t
res={}
for L in layers:
    out={'layer':L}
    try:
        st,b,dt=get({'service':'WFS','version':'2.0.0','request':'GetFeature','typeNames':'geoportal:'+L,'resultType':'hits'})
        m=re.search(rb'numberMatched="(\d+|unknown)"',b)
        out['hits']=m.group(1).decode() if m else b[:200].decode('utf-8','replace')
    except Exception as e: out['hits']='ERR '+str(e)[:120]
    try:
        st,b,dt=get({'service':'WFS','version':'2.0.0','request':'DescribeFeatureType','typeNames':'geoportal:'+L})
        els=re.findall(rb'<xsd:element[^>]*name="([^"]+)"[^>]*type="([^"]+)"',b)
        out['fields']=[(a.decode(),t.decode()) for a,t in els]
    except Exception as e: out['fields']='ERR '+str(e)[:120]
    try:
        st,b,dt=get({'service':'WFS','version':'2.0.0','request':'GetFeature','typeNames':'geoportal:'+L,'count':'5','outputFormat':'application/json','srsName':'EPSG:4326'})
        open(os.path.join(D,'wfs_samples',L+'.json'),'wb').write(b)
        j=json.loads(b)
        out['sample_props']=[f['properties'] for f in j['features'][:3]]
        out['geom']=j['features'][0]['geometry']['type'] if j['features'] and j['features'][0]['geometry'] else None
    except Exception as e: out['sample_props']='ERR '+str(e)[:200]
    res[L]=out
    print(json.dumps(out,ensure_ascii=False,default=str)[:2500]); print('---',flush=True)
json.dump(res,open(os.path.join(D,'wfs_probe_'+str(int(time.time()))+'.json'),'w'),ensure_ascii=False,indent=1,default=str)
