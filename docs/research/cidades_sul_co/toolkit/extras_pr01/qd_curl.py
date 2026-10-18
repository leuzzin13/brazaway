import sys,json,subprocess,urllib.parse,time
def q(ibge,term,size=10,extra=''):
    u="https://api.queridodiario.org.br/gazettes?territory_ids=%s&querystring=%s&size=%d&sort_by=%s&excerpt_size=500&number_of_excerpts=3%s"%(ibge,urllib.parse.quote(term),size,'relevance',extra)
    for k in range(4):
        r=subprocess.run(['curl','-sS','-m','100','-A','Mozilla/5.0',u],capture_output=True,text=True)
        try: return json.loads(r.stdout)
        except Exception: time.sleep(4)
    return {'erro':(r.stderr or r.stdout)[:170]}
if __name__=='__main__':
    ibge=sys.argv[1]; extra=''
    args=sys.argv[2:]
    if args and args[0].startswith('&'): extra=args.pop(0)
    for term in args:
        r=q(ibge,term,extra=extra)
        print('###',term,r.get('total_gazettes'),r.get('erro',''))
        for g in r.get('gazettes',[]):
            print(g['date'],g.get('edition'),g.get('txt_url'))
            for e in g.get('excerpts',[])[:1]: print('    ',e.replace('\n',' ')[:170])
