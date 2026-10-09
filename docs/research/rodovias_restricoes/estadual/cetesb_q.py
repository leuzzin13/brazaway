import json,sys,urllib.parse,urllib.request
B="https://arcgis.cetesb.sp.gov.br/server/rest/services/Hosted/Malha_Rodovi%C3%A1ria_Estadual_SP/FeatureServer/0/query"
for rod in sys.argv[1:]:
    q=urllib.parse.urlencode({'where':f"rodovia='{rod}'",'outFields':'rodovia,kminicial,kmfinal,extensao,tipopista,administra,jurisdicao,descricaoi,descricaof,denominaca,dataatuali','returnGeometry':'false','f':'json'})
    d=json.load(urllib.request.urlopen(B+'?'+q,timeout=60)); fs=d.get('features',[])
    print('###',rod,len(fs),d.get('error'))
    for f in sorted(fs,key=lambda f:f['attributes']['kminicial'] or 0)[:14]:
        a=f['attributes']; print('  ',a['kminicial'],a['kmfinal'],a['tipopista'],(a['administra'] or '')[:22],(a['denominaca'] or '')[:28],'|',(a['descricaoi'] or '')[:25],'->',(a['descricaof'] or '')[:25],a['dataatuali'])
