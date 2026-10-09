import csv,sys,re,json,os,urllib.request
cn=lambda s: re.sub(r'\D','',s)
out='pmqc_postos_coords.json'
postos=json.load(open(out)) if os.path.exists(out) else {}
for url in sys.argv[1:]:
    fn='tmp_pmqc.csv'
    req=urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})
    import subprocess; subprocess.run(["curl","-sL","--retry","3","-m","300","-A","Mozilla/5.0","-o",fn,url],check=True)
    n=0
    for r in csv.DictReader(open(fn,encoding='utf-8-sig',errors='replace'),delimiter=';'):
        c=cn(r.get('CnpjPosto',''))
        try: lat=float(r['Latitude']); lon=float(r['Longitude'])
        except: continue
        if not(-35<lat<6 and -75<lon<-30): continue
        postos.setdefault(c,{'uf':r['Uf'],'mun':r['Município'],'pts':[]})
        p=(round(lat,6),round(lon,6))
        if list(p) not in postos[c]['pts'] and len(postos[c]['pts'])<5: postos[c]['pts'].append(list(p))
        n+=1
    os.remove(fn)
    json.dump(postos,open(out,"w"))
    print(url.split('/')[-1],'linhas',n,'postos acumulados',len(postos),flush=True)
json.dump(postos,open(out,'w'))
