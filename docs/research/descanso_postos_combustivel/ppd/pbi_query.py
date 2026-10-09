# Consulta o painel público Power BI de PPDs (Ministério dos Transportes) e decodifica a resposta DSR.
import json,sys,urllib.request
K='f5fae26d-bf88-4a62-a827-e63967fef624'
HOST='https://wabi-brazil-south-api.analysis.windows.net'
models=json.load(open('pbi_models.json'))
DSID=models['models'][0]['dbName']; MID=models['models'][0]['id']
REP=models['exploration']['report'].get('objectId')
def query(entity,cols,count=2000):
    sel=[{"Column":{"Expression":{"SourceRef":{"Source":"t"}},"Property":c},"Name":f"t.{c}"} for c in cols]
    body={"version":"1.0.0","queries":[{"Query":{"Commands":[{"SemanticQueryDataShapeCommand":{"Query":{"Version":2,"From":[{"Name":"t","Entity":entity,"Type":0}],"Select":sel},
      "Binding":{"Primary":{"Groupings":[{"Projections":list(range(len(cols)))}]},"DataReduction":{"DataVolume":3,"Primary":{"Window":{"Count":count}}},"Version":1}}}]},
      "QueryId":"","ApplicationContext":{"DatasetId":DSID,"Sources":[{"ReportId":REP,"VisualId":""}]}}],"cancelQueries":[],"modelId":MID}
    req=urllib.request.Request(HOST+'/public/reports/querydata?synchronous=true',data=json.dumps(body).encode(),headers={'X-PowerBI-ResourceKey':K,'Content-Type':'application/json','User-Agent':'truck-router-mvp/0.1'})
    r=json.load(urllib.request.urlopen(req,timeout=120))
    ds=r['results'][0]['result']['data']['dsr']['DS'][0]
    vd=ds.get('ValueDicts',{})
    ph=ds['PH'][0]['DM0']
    schema=ph[0]['S']
    rows=[];prev=[None]*len(cols)
    for row in ph:
        if 'S' in row: schema=row['S']
        C=row.get('C',[]); R=row.get('R',0); N=row.get('Ø',0)
        vals=[];ci=0
        for i in range(len(cols)):
            if R & (1<<i): v=prev[i]
            elif N & (1<<i): v=None
            else:
                v=C[ci]; ci+=1
                dn=schema[i].get('DN')
                if dn and isinstance(v,int): v=vd[dn][v]
            vals.append(v)
        prev=vals; rows.append(dict(zip(cols,vals)))
    return rows
if __name__=='__main__':
    ent=sys.argv[1]; cols=sys.argv[2].split('|'); out=sys.argv[3]
    rows=query(ent,cols)
    json.dump(rows,open(out,'w'),ensure_ascii=False,indent=1)
    print(ent,len(rows))
