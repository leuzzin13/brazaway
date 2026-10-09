import urllib.request, struct, zlib, sys, re
url = sys.argv[1]; want = sys.argv[2:] 
def rng(a,b):
    req = urllib.request.Request(url, headers={'User-Agent':'Mozilla/5.0','Range':f'bytes={a}-{b}'})
    return urllib.request.urlopen(req, timeout=120).read()
h = urllib.request.urlopen(urllib.request.Request(url, method='HEAD', headers={'User-Agent':'Mozilla/5.0'}))
size = int(h.headers['Content-Length'])
tail = rng(size-65536, size-1)
i = tail.rfind(b'PK\x05\x06'); cd_size, cd_off = struct.unpack('<II', tail[i+12:i+20])
cd = rng(cd_off, cd_off+cd_size-1)
entries={}; p=0
while p < len(cd) and cd[p:p+4]==b'PK\x01\x02':
    comp, csz, usz = struct.unpack('<HII', cd[p+10:p+12]+cd[p+20:p+28])
    nl, el, cl = struct.unpack('<HHH', cd[p+28:p+34]); off = struct.unpack('<I', cd[p+42:p+46])[0]
    name = cd[p+46:p+46+nl].decode(); entries[name]=(off,csz,usz,comp); p += 46+nl+el+cl
for k,v in entries.items(): print(k, 'comp', v[1], 'uncomp', v[2])
def peek(name, nbytes=1500000):
    off,csz,usz,comp = entries[name]
    lh = rng(off, off+29); nl, el = struct.unpack('<HH', lh[26:30])
    data = rng(off+30+nl+el, off+30+nl+el+min(csz,nbytes)-1)
    d = zlib.decompressobj(-15); return d.decompress(data).decode('utf-8','ignore')
for w in want:
    txt = peek(w)
    open('/dev/stdout','w').write(f'\n### {w} (primeiros {len(txt)} chars)\n')
    print(txt[:200])
    if 'sharedStrings' in w:
        ss = re.findall(r'<si>(.*?)</si>', txt, re.S)
        print([re.sub('<[^>]+>','',s) for s in ss[:200]])
    else:
        rows = re.findall(r'<row [^>]*>(.*?)</row>', txt, re.S)[:5]
        for r in rows: print(re.findall(r'<c r="([A-Z]+)\d+"[^>]*?(?: t="(\w+)")?[^>]*>(?:<v>([^<]*)</v>|<is><t>([^<]*)</t></is>)', r))
