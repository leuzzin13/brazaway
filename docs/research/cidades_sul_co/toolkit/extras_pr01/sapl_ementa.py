import subprocess,json,sys,urllib.parse
def q(base,term,field='ementa__icontains',maxp=20,cacert=None):
    out=[];u=f"{base}/api/norma/normajuridica/?{field}={urllib.parse.quote(term)}&page_size=100"
    while u and maxp:
        cmd=['curl','-sS','-m','60','-A','Mozilla/5.0']+(['--cacert',cacert] if cacert else [])+[u]
        r=subprocess.run(cmd,capture_output=True,text=True).stdout
        try: j=json.loads(r)
        except Exception: print('ERR',r[:200]); break
        out+=j['results']; u=j.get('pagination',{}).get('links',{}).get('next'); maxp-=1
    return out
if __name__=='__main__':
    base=sys.argv[1]; ca=sys.argv[2] if sys.argv[2]!='-' else None
    for t in sys.argv[3:]:
        res=q(base,t,cacert=ca)
        print('###',t,len(res))
        for x in res[:30]:
            print('  ',x.get('__str__','')[:62],'|',(x.get('ementa') or '')[:170].replace('\n',' '),'|',x.get('id'))
