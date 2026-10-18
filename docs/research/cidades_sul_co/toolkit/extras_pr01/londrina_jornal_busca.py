import subprocess,json,re,sys,html,urllib.parse
CJ='/tmp/w/lon.cj'
def init():
    h=subprocess.run(['curl','-sS','-m','40','-A','Mozilla/5.0','-c',CJ,'-b',CJ,'https://portal.londrina.pr.gov.br/busca-jornal'],capture_output=True,text=True).stdout
    return re.search(r'"csrf.token":"([0-9a-f]+)"',h).group(1)
def search(tok,phrase,cat='',df='',dt='',page=0,order='desc'):
    d=urllib.parse.urlencode({'option':'com_ajax','module':'web_sampa_search','phrase':phrase,'dateFrom':df,'dateTo':dt,'category':cat,'order':order,'page':page,'format':'raw'})
    r=subprocess.run(['curl','-sS','-m','90','-A','Mozilla/5.0','-b',CJ,'-c',CJ,'-H','X-CSRF-Token: '+tok,'-H','X-Requested-With: XMLHttpRequest','-X','POST','https://portal.londrina.pr.gov.br/','-d',d],capture_output=True,text=True)
    try: j=json.loads(r.stdout)
    except Exception: return {'erro':r.stdout[:300]}
    return j
def txt(s): return re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',s))).strip()
if __name__=='__main__':
    tok=init()
    for ph in sys.argv[1:]:
        j=search(tok,ph)
        if 'erro' in j: print(ph,j); continue
        print('###',ph,txt(j.get('total','')))
        for li in re.findall(r'<li.*?</li>',j['data'],re.S)[:12]:
            hr=re.findall(r'href="([^"]+)"',li)
            print('  ',txt(li)[:200],hr[:1])
