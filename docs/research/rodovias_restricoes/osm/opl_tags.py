import re
def dec(v):
    return re.sub(r'%([0-9a-fA-F]+)%',lambda m: chr(int(m.group(1),16)),v)
def tags(l):
    m=re.search(r' T(\S*)',l); t={}
    if m and m.group(1):
        for kv in m.group(1).split(','):
            if '=' in kv:
                k,v=kv.split('=',1); t[dec(k)]=dec(v)
    return t
