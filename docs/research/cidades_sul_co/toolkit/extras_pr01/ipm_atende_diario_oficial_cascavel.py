import subprocess,json,re,sys,time,html,urllib.parse
CJ='/tmp/w/cas.cj'; B='https://prefa.cascavel.pr.gov.br'
def init():
    subprocess.run(['curl','-sS','-m','60','-A','Mozilla/5.0','-c',CJ,'-b',CJ,B+'/diariooficial','-o','/dev/null'])
def search(termo,di,df,pagina=None,plug=1,extra=None):
    f={"termo":termo,"dataInicial":di,"dataFinal":df}
    if pagina: f["pagina"]=pagina
    if extra: f.update(extra)
    data={"chave":json.dumps({}),"caller":"null","parametro":json.dumps({"codigoPlugin":plug,"filtroPlugin":f}),"autoId":"1","monitor":"0","flush":"0","portalCidadao":"true"}
    url=B+"/atende.php?rot=54015&aca=101&ajax=t&processo=loadPluginDiarioOficial&ajaxPrevent=%d"%int(time.time()*1000)
    cmd=['curl','-sS','-m','90','-A','Mozilla/5.0','-b',CJ,'-c',CJ,'-H','X-Requested-With: XMLHttpRequest','-X','POST',url]
    for k,v in data.items(): cmd+=['--data-urlencode',f'{k}={v}']
    r=subprocess.run(cmd,capture_output=True)
    return r.stdout.decode('utf-8','ignore')
def clean(h):
    t=re.sub(r'<script.*?</script>|<style.*?</style>','',h,flags=re.S)
    t=re.sub(r'<[^>]+>',' ',t); return re.sub(r'\s+',' ',html.unescape(t))
if __name__=='__main__':
    init()
    r=search(sys.argv[1],sys.argv[2],sys.argv[3])
    print(len(r)); print(clean(r)[:1500]); open('/tmp/w/cas_res.html','w').write(r)
