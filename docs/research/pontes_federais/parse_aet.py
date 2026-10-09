import pdfplumber,glob,csv,re,collections
def num(s):
    try: return float(s.replace('.','').replace(',','.'))
    except: return None
def parse(path,kind):
    out=[]; cols=None
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            ws=page.extract_words()
            pista=[w for w in ws if w['text']=='Pista']
            htop=-1
            if len(pista)>=2:
                xsplit=(pista[0]['x0']+pista[1]['x0'])/2
                names={'Altura':'altura','Peso':'peso','Comp.':'comp','Giro':'raio_giro','Total':'larg_total','Rolamento':'larg_faixa'} if kind=='definitiva' else {'Altura':'altura','Peso':'peso','Comp.':'comp','Largura':'largura'}
                htop=max(w['top'] for w in ws if w['text'] in ('BR','PNV'))
                cols=[]
                for w in ws:
                    if w['text'] in names and htop-15<=w['top']<=htop+25:
                        side='p1' if w['x0']<xsplit else 'p2'
                        cols.append(((w['x0']+w['x1'])/2,side+'_'+names[w['text']]))
                if kind=='temporaria':
                    # 'Largura' only on one line in temporaria; keep those near htop+7
                    pass
                cols.sort()
            rows=collections.defaultdict(list)
            for w in ws:
                if w['top']>htop+20: rows[round(w['top'])].append(w)
            for top,rw in sorted(rows.items()):
                rw.sort(key=lambda w:w['x0'])
                t=[w['text'] for w in rw]
                if len(t)<5 or not re.match(r'^\d{3}[A-Z]{2,3}\d{4}$',t[2]): continue
                rec={'br':t[0],'uf':t[1],'pnv':t[2],'km_ini':num(t[3]),'km_fim':num(t[4])}
                for w in rw[5:]:
                    cx=(w['x0']+w['x1'])/2
                    c=min(cols,key=lambda c:abs(c[0]-cx))
                    rec[c[1]]=num(w['text'])
                out.append(rec)
    return out
res={}
for kind in ['definitiva','temporaria']:
    allr=[]
    for f in sorted(glob.glob(f'aet_pdfs/{kind}_*.pdf')): allr+=parse(f,kind)
    keys=['br','uf','pnv','km_ini','km_fim']+sorted({k for r in allr for k in r if k.startswith('p')})
    with open(f'aet_restricoes_{kind}_2026-10.csv','w',newline='') as fh:
        w=csv.DictWriter(fh,fieldnames=keys); w.writeheader(); w.writerows(allr)
    res[kind]=allr
    print(kind,'linhas',len(allr),'| UFs',len({r['uf'] for r in allr}))
    print(' por UF',dict(collections.Counter(r['uf'] for r in allr).most_common()))
    for col in keys[5:]:
        vals=[r[col] for r in allr if r.get(col) is not None]
        if vals: print('  ',col,'n',len(vals),'min',min(vals),'max',max(vals),'top',collections.Counter(vals).most_common(6))
d=res['definitiva']
lowh=[r for r in d if any((r.get(c) or 99)<4.6 for c in ('p1_altura','p2_altura'))]
print('definitiva: trechos com altura <4,6 m:',len(lowh)); [print('   ',r['br'],r['uf'],r['pnv'],r['km_ini'],r['km_fim'],r.get('p1_altura'),r.get('p2_altura')) for r in lowh]
pw=[r for r in d if r.get('p1_peso') or r.get('p2_peso')]
print('definitiva com peso:',len(pw)); [print('   ',r['br'],r['uf'],r['pnv'],r['km_ini'],r['km_fim'],r.get('p1_peso'),r.get('p2_peso')) for r in pw]
sp=[r for r in d if r['uf']=='SP']; print('SP definitiva',len(sp))
t=res['temporaria']; tp=[r for r in t if (r.get('p1_peso') is not None and 0<r['p1_peso']<=57)]
print('temporaria peso<=57t:',len(tp)); [print('   ',r['br'],r['uf'],r['pnv'],r['km_ini'],r['km_fim'],r.get('p1_peso'),r.get('p1_altura')) for r in tp[:40]]
