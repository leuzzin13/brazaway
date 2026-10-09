import json, urllib.request
V='http://localhost:8002'
def post(path, body):
    r=urllib.request.Request(V+path, data=json.dumps(body).encode(), headers={'Content-Type':'application/json'})
    return json.load(urllib.request.urlopen(r, timeout=120))
locs=[{'lat':-23.5205,'lon':-46.7045},{'lat':-23.1857,'lon':-46.8978}]  # Lapa (SP) -> Jundiaí
for name,opts in [('default',{}),('use_tolls=0',{'use_tolls':0}),('exclude_tolls',{'exclude_tolls':True}),('toll_booth_penalty=1800',{'toll_booth_penalty':1800})]:
    co={'axle_count':5,'height':4.4,'weight':45,'length':18.6}; co.update(opts)
    try:
        res=post('/route',{'locations':locs,'costing':'truck','costing_options':{'truck':co},'units':'kilometers'})
        s=res['trip']['summary']; man=res['trip']['legs'][0]['maneuvers']
        nt=sum(1 for m in man if m.get('toll'))
        streets=[]; [streets.extend(m.get('street_names',[])) for m in man if m.get('toll')]
        print(f"{name}: dist={s['length']:.1f}km tempo={s['time']/60:.0f}min has_toll={s.get('has_toll')} manobras_c/_toll={nt} vias={sorted(set(streets))[:6]}")
        if name=='default': shape=res['trip']['legs'][0]['shape']
    except Exception as e:
        print(name,'ERRO',e, getattr(e,'read',lambda:b'')()[:300])
ta=post('/trace_attributes',{'encoded_polyline':shape,'shape_match':'edge_walk','costing':'truck','filters':{'attributes':['edge.toll','edge.way_id','edge.length','node.type','edge.names'],'action':'include'}})
edges=ta['edges']; tolle=[e for e in edges if e.get('toll')]
nodes=[e.get('end_node',{}).get('type') for e in edges]
import collections
print('trace_attributes: edges',len(edges),'edges toll',len(tolle),'km toll',round(sum(e['length'] for e in tolle),1),'node types',collections.Counter(nodes))
print('way_ids com toll (amostra):',sorted(set(e['way_id'] for e in tolle))[:10])
