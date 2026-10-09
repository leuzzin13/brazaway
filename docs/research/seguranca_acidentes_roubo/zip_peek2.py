import urllib.request, struct, zlib, sys
url = sys.argv[1]; want = sys.argv[2:]
UA={'User-Agent':'Mozilla/5.0'}
def rng(a,b):
    return urllib.request.urlopen(urllib.request.Request(url, headers={**UA,'Range':f'bytes={a}-{b}'}), timeout=120).read()
h = urllib.request.urlopen(urllib.request.Request(url, method='HEAD', headers=UA)); size=int(h.headers['Content-Length'])
tail = rng(size-65536, size-1); i = tail.rfind(b'PK\x05\x06')
cd_size, cd_off = struct.unpack('<II', tail[i+12:i+20])
if cd_off == 0xFFFFFFFF:  # zip64
    j = tail.rfind(b'PK\x06\x06'); cd_size, cd_off = struct.unpack('<QQ', tail[j+40:j+56])
cd = rng(cd_off, cd_off+cd_size-1); entries={}; p=0
while p < len(cd) and cd[p:p+4]==b'PK\x01\x02':
    comp = struct.unpack('<H', cd[p+10:p+12])[0]; csz, usz = struct.unpack('<II', cd[p+20:p+28])
    nl, el, cl = struct.unpack('<HHH', cd[p+28:p+34]); off = struct.unpack('<I', cd[p+42:p+46])[0]
    name = cd[p+46:p+46+nl].decode('cp437')
    extra = cd[p+46+nl:p+46+nl+el]
    if 0xFFFFFFFF in (csz,usz,off):
        k=0
        while k < len(extra):
            hid, hl = struct.unpack('<HH', extra[k:k+4]); body = extra[k+4:k+4+hl]
            if hid==1:
                vals=[]; q=0
                for f in ('usz','csz','off'):
                    v = {'usz':usz,'csz':csz,'off':off}[f]
                    if v==0xFFFFFFFF: vals.append((f, struct.unpack('<Q', body[q:q+8])[0])); q+=8
                for f,v in vals:
                    if f=='usz': usz=v
                    if f=='csz': csz=v
                    if f=='off': off=v
            k += 4+hl
    entries[name]=(off,csz,usz,comp); p += 46+nl+el+cl
print('size', size)
for k,v in entries.items(): print(f'{k}  comp={v[1]} uncomp={v[2]}')
for w in want:
    off,csz,usz,comp = entries[w]
    lh = rng(off, off+29); nl, el = struct.unpack('<HH', lh[26:30])
    data = rng(off+30+nl+el, off+30+nl+el+min(csz,400000)-1)
    txt = zlib.decompressobj(-15).decompress(data) if comp==8 else data
    print(f'\n### {w}'); print(txt[:2500].decode('utf-8','replace'))
