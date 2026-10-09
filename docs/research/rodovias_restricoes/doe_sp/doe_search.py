import sys,json,urllib.parse,subprocess
terms=sys.argv[1:]
res={}
for page in range(1,6):
    q=[('periodStartingDate','personalized'),('PageNumber',str(page)),('FromDate','2023-01-01'),('ToDate','2026-10-09'),('PageSize','50'),('SortField','Date')]
    for i,t in enumerate(terms): q.append((f'Terms[{i}]',t))
    url='https://do-api-web-search.doe.sp.gov.br/v2/advanced-search/publications?'+urllib.parse.urlencode(q)
    s=subprocess.run(['curl','-sS','-A','Mozilla/5.0','-H','Accept: application/json',url],capture_output=True,text=True).stdout
    d=json.loads(s)
    items=d.get('items',[])
    for it in items:
        if 'Estradas de Rodagem' in it.get('hierarchy','') or 'DER' in it.get('hierarchy',''):
            res[it['id']]=it
    if len(items)<50: break
for it in sorted(res.values(),key=lambda x:x['date']):
    print(it['date'][:10],'|',it['title'][:80],'|',it['hierarchy'][-60:],'| https://doe.sp.gov.br/'+it['slug'])
    print('    ',it['excerpt'][:300].replace('\n',' '))
