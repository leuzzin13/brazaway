import zipfile, xml.etree.ElementTree as ET, csv, re, sys, collections, time
fn = sys.argv[1]; out = sys.argv[2]
NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
z = zipfile.ZipFile(fn)
t0=time.time()
ss=[]
for ev, el in ET.iterparse(z.open('xl/sharedStrings.xml')):
    if el.tag == NS+'si':
        ss.append(''.join(x.text or '' for x in el.iter(NS+'t'))); el.clear()
print('sharedStrings', len(ss), round(time.time()-t0,1),'s', flush=True)
def col(ref):
    m = re.match(r'([A-Z]+)', ref).group(1); n=0
    for ch in m: n = n*26 + ord(ch)-64
    return n-1
wb = z.read('xl/workbook.xml').decode()
rels = z.read('xl/_rels/workbook.xml.rels').decode()
sheets = re.findall(r'<sheet name="([^"]+)" sheetId="\d+" r:id="(rId\d+)"', wb)
relmap = dict((b,a) for a,b in re.findall(r'Target="([^"]+)"[^>]*Id="(rId\d+)"', rels)) or {}
relmap.update(dict(re.findall(r'Id="(rId\d+)"[^>]*Target="([^"]+)"', rels)))
cnt = collections.Counter(); w=None; header=None; total=0
fo = open(out,'w',newline='')
for name, rid in sheets:
    target = relmap[rid].lstrip('/'); target = target if target.startswith('xl/') else 'xl/'+target
    if 'Campos' in name: 
        continue
    hdr=None
    for ev, el in ET.iterparse(z.open(target)):
        if el.tag == NS+'row':
            vals = {}
            for c in el.findall(NS+'c'):
                v = c.find(NS+'v'); 
                if v is None:
                    isv = c.find(NS+'is'); val = ''.join(x.text or '' for x in isv.iter(NS+'t')) if isv is not None else ''
                else:
                    val = ss[int(v.text)] if c.get('t')=='s' else v.text
                vals[col(c.get('r'))] = val
            row = [vals.get(i,'') for i in range(max(vals)+1)] if vals else []
            el.clear()
            if hdr is None:
                hdr = row; print(name, 'header', hdr, flush=True)
                if w is None: w = csv.writer(fo); w.writerow(['ABA']+hdr); header=hdr
                continue
            total += 1
            d = dict(zip(hdr,row))
            nat = d.get('NATUREZA_APURADA',''); cnt[nat]+=1
            if 'CARGA' in nat.upper() or 'Carga' in d.get('DESCR_CONDUTA','') or 'Carga' in d.get('DESCR_TIPOLOCAL','') :
                w.writerow([name]+[d.get(h,'') for h in header])
    print(name, 'rows ate agora', total, round(time.time()-t0,1),'s', flush=True)
fo.close()
print('TOTAL linhas', total)
for k,v in cnt.most_common(60): print(v, k)
