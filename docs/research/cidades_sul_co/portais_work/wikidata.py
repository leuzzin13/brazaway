import json,subprocess,urllib.parse
q='''SELECT ?ibge ?site WHERE { ?m wdt:P1585 ?ibge . OPTIONAL{?m wdt:P856 ?site} FILTER(REGEX(?ibge,"^(41|42|43|50|51|52|53)")) }'''
out=subprocess.run(['curl','-4','-s','-m','120','-G','https://query.wikidata.org/sparql','--data-urlencode','query='+q,'-H','Accept: application/json','-A','brazaway-research/1.0'],capture_output=True).stdout
d=json.loads(out)
r={}
for b in d['results']['bindings']:
    r.setdefault(b['ibge']['value'],[]).append(b.get('site',{}).get('value'))
json.dump(r,open('wikidata_sites.json','w'),ensure_ascii=False,indent=0)
print(len(r),sum(1 for v in r.values() if any(v)))
