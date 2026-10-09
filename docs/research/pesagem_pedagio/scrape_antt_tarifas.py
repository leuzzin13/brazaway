# Raspa as páginas "tarifas-de-pedagio" de todas as concessões federais listadas pela ANTT
import re, html, json, urllib.request, sys, os, time
from html.parser import HTMLParser
BASE='https://www.gov.br/antt/pt-br/assuntos/rodovias/concessionarias/lista-de-concessoes/'
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'antt')
lst=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'antt_concessionarias.html'),encoding='utf-8').read()
slugs=sorted(set(s for s in re.findall(r'lista-de-concessoes/([A-Za-z0-9\-]+)"',lst)))
class TP(HTMLParser):
    def __init__(s): super().__init__(); s.tables=[]; s.row=None; s.cell=None; s.intable=0
    def handle_starttag(s,t,a):
        if t=='table': s.intable+=1; s.tables.append([])
        elif t=='tr' and s.intable: s.row=[]
        elif t in('td','th') and s.row is not None: s.cell=''
    def handle_endtag(s,t):
        if t=='table': s.intable-=1
        elif t=='tr' and s.row is not None: s.tables[-1].append(s.row); s.row=None
        elif t in('td','th') and s.cell is not None: s.row.append(re.sub(r'\s+',' ',s.cell).strip()); s.cell=None
    def handle_data(s,d):
        if s.cell is not None: s.cell+=d
res={}
for sl in slugs:
    url=BASE+sl+'/tarifas-de-pedagio'
    try:
        req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0 truck-router-mvp/0.1'})
        r=urllib.request.urlopen(req,timeout=60); t=r.read().decode('utf-8','replace'); code=r.status
    except Exception as e:
        res[sl]={'url':url,'erro':str(e)}; print(sl,'ERRO',e); continue
    open(os.path.join(OUT,'tarifas_html',sl+'.html'),'w').write(t)
    p=TP(); p.feed(t)
    tabs=[tb for tb in p.tables if any('Categoria' in ' '.join(r) or 'Eixo' in ' '.join(r) or 'eixo' in ' '.join(r) for r in tb)]
    res[sl]={'url':url,'http':code,'n_tabelas':len(p.tables),'n_tabelas_tarifa':len(tabs),'tabelas':tabs}
    print(sl,code,'tabelas',len(p.tables),'c/ categoria',len(tabs),'linhas',[len(tb) for tb in tabs])
    time.sleep(0.5)
json.dump(res,open(os.path.join(OUT,'antt_tarifas_raspadas.json'),'w'),ensure_ascii=False,indent=1)
