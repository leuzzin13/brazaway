import sys,re,html,subprocess,json
url=sys.argv[1]; out=sys.argv[2]
s=subprocess.run(['curl','-sS','-L','-A','Mozilla/5.0',url],capture_output=True,text=True).stdout
m=re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',s,re.S)
txt=''
if m:
    d=json.loads(m.group(1))
    def walk(o):
        global txt
        if isinstance(o,dict):
            for k,v in o.items():
                if isinstance(v,str) and len(v)>500 and ('<p' in v or 'Artigo' in v): txt+=v
                else: walk(v)
        elif isinstance(o,list):
            for v in o: walk(v)
    walk(d)
if not txt: txt=s
t=re.sub(r'</p>|<br\s*/?>|</tr>','\n',txt); t=re.sub(r'</td>',' | ',t)
t=html.unescape(re.sub('<[^>]+>','',t)); t=re.sub(r'\n\s*\n+','\n',t)
open(out,'w').write(t); print(len(t))
