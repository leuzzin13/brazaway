import subprocess,re,html,sys,urllib.parse,time
B="https://www.legislador.com.br/LegisladorWEB.ASP?WCI="
def curl(u,data=None):
    cmd=['curl','-sS','-m','90','-A','Mozilla/5.0',u]
    if data: cmd+=['-d',data]
    return subprocess.run(cmd,capture_output=True).stdout.decode('latin-1')
def clean(h):
    t=re.sub(r'<script.*?</script>|<style.*?</style>','',h,flags=re.S)
    t=re.sub(r'<br\s*/?>|</p>|</div>','\n',t)
    t=re.sub(r'<[^>]+>',' ',t); t=html.unescape(t).replace('\xa0',' ')
    return re.sub(r'[ \t]+',' ',re.sub(r'\n\s*\n+','\n',t))
def items(h):
    out=[]
    for blk in re.split(r'<h5 class="card-title">',h)[1:]:
        m=re.match(r'\s*([^<]+?)\s*<a',blk)
        d=re.search(r'text-muted">\s*de ([\d/]+)',blk)
        p=re.search(r'<p class="card-text">\s*(.*?)</p>',blk,re.S)
        e=re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>','',p.group(1)))).strip() if p else ''
        w=re.search(r'WinTXT\((\d+),(\d+),(\d+),(\d+)',blk)
        out.append((m.group(1).strip() if m else '',d.group(1) if d else '',e[:300],w.groups() if w else None))
    return out
def search(ID,verbete,esp=0,maxpages=30):
    h=curl(B+"LeiConsulta&ID=%s&inEspecieLei=%d&dsVerbete=%s"%(ID,esp,urllib.parse.quote(verbete,encoding='latin-1')))
    res=items(h)
    m=re.search(r'Página (\d+) de (\d+)',h); tot=int(m.group(2)) if m else 1
    for pg in range(1,min(tot,maxpages)):
        data="ID=%s&pgAtual=%d&ttPaginas=%d&inEspecieLei=%d&nrLeiDE=&nrLeiATE=&dsVerbete=%s&obj=&inEOU=0&dtInicial=&dtFinal=&ordernarPor=0&Navegar=%%3E"%(ID,pg,tot,esp,urllib.parse.quote(verbete,encoding='latin-1'))
        h=curl(B+"LeiConsulta",data); res+=items(h)
    return res,tot
def texto(ID,esp,nr,aa):
    return clean(curl(B+"LeiTexto&ID=%s&inEspecieLei=%s&nrLei=%s&aaLei=%s"%(ID,esp,nr,aa)))
if __name__=='__main__':
    ID=sys.argv[1]
    for v in sys.argv[2:]:
        r,t=search(ID,v)
        print('###',v,'paginas',t,'itens',len(r))
        for x in r: print(' ',x[0],x[1],'|',x[2][:150],'|',','.join(x[3][1:]) if x[3] else '')
