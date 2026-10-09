# Extrai pontos de praças de pedágio, pórticos free flow e sistemas de pesagem dos KMZ de malha rodoviária da ARTESP
import zipfile, re, sys, os, json, glob, collections
import xml.etree.ElementTree as ET
D=os.path.join(os.path.dirname(os.path.abspath(__file__)),'artesp','kmz')
KW=re.compile(r'(?i)ped[aá]g|pra[cç]a|balan[cç]|pesag|ppv|p[oó]rtico|free.?flow|livre passagem|arrecada|cabine|bloqueio|PaP\b|TCP\b|PPM\b')
def strip(tag): return tag.split('}',1)[-1]
out=[]; stats={}
for kmz in sorted(glob.glob(os.path.join(D,'l*.kmz'))):
    lote=os.path.basename(kmz)[:-4]
    z=zipfile.ZipFile(kmz)
    kmls=[n for n in z.namelist() if n.lower().endswith('.kml')]
    cnt=collections.Counter(); folders_kw=collections.Counter()
    for kn in kmls:
        raw=z.read(kn)
        raw=re.sub(rb'\s(py):[A-Za-z_]+="[^"]*"',b'',raw)
        try: root=ET.fromstring(raw)
        except Exception as e: print(lote,kn,'ERRO XML',e); continue
        def walk(el,path):
            t=strip(el.tag)
            if t in('Folder','Document'):
                nm=None
                for c in el:
                    if strip(c.tag)=='name': nm=(c.text or '').strip(); break
                path=path+[nm or '?']
                for c in el: walk(c,path)
            elif t=='Placemark':
                nm=''; geom=None; coords=None; ext={}
                for c in el.iter():
                    st=strip(c.tag)
                    if st=='name' and not nm: nm=(c.text or '').strip()
                    if st in('Point','LineString','Polygon') and geom is None: geom=st
                    if st=='coordinates' and coords is None: coords=(c.text or '').strip()
                    if st=='SimpleData': ext[c.get('name')]=(c.text or '').strip()
                    if st=='Data':
                        v=[x for x in c if strip(x.tag)=='value']; ext[c.get('name')]=(v[0].text or '').strip() if v else ''
                cnt[geom]+=1
                fp=' / '.join(p for p in path if p)
                if KW.search(fp+' '+nm+' '+' '.join(ext.values())):
                    lon=lat=None
                    if geom=='Point' and coords:
                        try: lon,lat=[float(x) for x in coords.split()[0].split(',')[:2]]
                        except: pass
                    folders_kw[fp]+=1
                    out.append({'lote':lote,'pasta':fp,'nome':nm,'geom':geom,'lat':lat,'lon':lon,'atributos':ext})
            else:
                for c in el: walk(c,path)
        walk(root,[])
    stats[lote]={'kmls':len(kmls),'geom':dict(cnt),'pastas_relevantes':dict(folders_kw)}
json.dump(out,open(os.path.join(D,'..','artesp_pedagio_pesagem_kmz.json'),'w'),ensure_ascii=False,indent=1)
json.dump(stats,open(os.path.join(D,'..','artesp_kmz_stats.json'),'w'),ensure_ascii=False,indent=1)
for l,s in stats.items():
    print(l,s['kmls'],s['geom']); 
    for k,v in s['pastas_relevantes'].items(): print('    ',v,k[:160])
print('total pontos relevantes',len(out))

def classify(r):
    fp=r['pasta']; nm=r['nome']; full=fp+' / '+nm
    parts=[x.strip() for x in fp.split(' / ')]
    if re.search(r'(?i)equipamentos$',fp) and 'Pesagem' in fp: return 'pgf_equipamento'
    if re.search(r'(?i)free.?flow|p[oó]rtico|livre passagem',full): return 'free_flow'
    if re.search(r'(?i)produtos? perigosos',fp): return 'parada_produtos_perigosos'
    if re.search(r'(?i)cargas? excep',fp): return 'parada_cargas_excepcionais'
    if re.search(r'(?i)/ PGF( / |$)',fp): return 'pgf_posto_geral_fiscalizacao'
    if re.search(r'(?i)/ PPM( / |$)',fp): return 'ppm_pesagem_movel'
    if re.search(r'(?i)balan',full): return 'balanca_outro'
    if re.search(r'(?i)Sistema de Arrecada[cç][aã]o / Pra[cç]as? de Ped[aá]gio',fp): return 'praca_pedagio'
    if re.search(r'(?i)/ TCP',fp): return 'tcp'
    if re.search(r'(?i)/ PaP',fp): return 'pap'
    if re.search(r'(?i)/ CCA',fp): return 'cca'
    return 'outro'
import csv
rows=[]
for r in out:
    r['tipo']=classify(r); rows.append(r)
BB=(-24.1,-47.25,-23.15,-45.65)
def inb(r): return r['lat'] is not None and BB[0]<=r['lat']<=BB[2] and BB[1]<=r['lon']<=BB[3]
c=collections.Counter((r['tipo'],r['geom']) for r in rows)
print('\nCLASSIFICACAO (tipo,geom):'); [print('  ',k,v) for k,v in sorted(c.items())]
for t in ['praca_pedagio','free_flow','pgf_posto_geral_fiscalizacao','ppm_pesagem_movel','parada_cargas_excepcionais','parada_produtos_perigosos']:
    pts=[r for r in rows if r['tipo']==t and r['lat'] is not None]
    print(t,'pontos',len(pts),'| na bbox Grande SP:',sum(inb(r) for r in pts))
with open(os.path.join(D,'..','artesp_pedagio_pesagem_pontos.csv'),'w',newline='') as f:
    w=csv.writer(f); w.writerow(['lote','tipo','nome','pasta','lat','lon','atributos'])
    for r in rows:
        if r['lat'] is not None and r['tipo'] not in ('outro','pgf_equipamento'):
            w.writerow([r['lote'],r['tipo'],r['nome'],r['pasta'],r['lat'],r['lon'],json.dumps(r['atributos'],ensure_ascii=False)])
print('\nGrande SP - praças/free flow/PGF/PPM:')
for r in rows:
    if inb(r) and r['tipo'] in ('praca_pedagio','free_flow','pgf_posto_geral_fiscalizacao','ppm_pesagem_movel'):
        print('  ',r['lote'],r['tipo'],'|',r['nome'],'|',r['pasta'].split(' / ')[-1],'|',round(r['lat'],5),round(r['lon'],5),'|',json.dumps(r['atributos'],ensure_ascii=False)[:160])
