import sys,json,re,html,subprocess
for slug in sys.argv[1:]:
    url='https://do-api-web-search.doe.sp.gov.br/v2/publications/'+slug
    s=subprocess.run(['curl','-sS','-A','Mozilla/5.0','-H','Accept: application/json',url],capture_output=True,text=True).stdout
    try: d=json.loads(s)
    except Exception as e: print('ERR',slug,s[:200]); continue
    c=re.sub(r"<style.*?</style>","",d.get("content",""),flags=re.S)
    t=re.sub(r'</p>|<br\s*/?>|</tr>','\n',c); t=re.sub(r'</td>',' | ',t); t=html.unescape(re.sub('<[^>]+>','',t)); t=re.sub(r'\n\s*\n+','\n',t)
    name=slug.split('/')[-1][:60]
    open(f'txt_{name}.txt','w').write(d.get('title','')+'\n'+d.get('date','')+'\n'+t)
    print('=====',d.get('title'),d.get('date','')[:10],len(t))
    print(re.sub(r"p\.[A-Za-z_]+[^}]*}","",t)[:3500])
