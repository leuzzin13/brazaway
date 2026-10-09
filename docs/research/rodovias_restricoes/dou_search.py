import sys,re,json,urllib.parse,subprocess
q=sys.argv[1]
url="https://www.in.gov.br/consulta/-/buscar/dou?q="+urllib.parse.quote(q)+"&s=todos&exactDate=all&sortType=0"
s=subprocess.run(['curl','-sS','-L','-A','Mozilla/5.0',url],capture_output=True,text=True).stdout
m=re.search(r'<script id="_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params" type="application/json">(.*?)</script>',s,re.S)
d=json.loads(m.group(1))
for r in d.get('jsonArray',[])[:int(sys.argv[2]) if len(sys.argv)>2 else 10]:
    print(re.sub('<[^>]+>','',r.get('title','')),'|',r.get('pubDate'),'|',r.get('pubName'),'|',r.get('hierarchyStr','')[:80],'| https://www.in.gov.br/web/dou/-/'+r.get('urlTitle',''))
