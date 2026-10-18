import re,html,sys
src,start=sys.argv[1],sys.argv[2]
n=int(sys.argv[3]) if len(sys.argv)>3 else 6000
t=open(src,errors='ignore').read()
t=re.sub(r'<(script|style).*?</\1>','',t,flags=re.S)
t=re.sub(r'<br\s*/?>|</p>|</div>|</li>|</tr>','\n',t)
t=re.sub(r'<[^>]+>','',t); t=html.unescape(t)
t=re.sub(r'[ \t]+',' ',t); t=re.sub(r'\n\s*\n+','\n',t)
i=t.find(start)
print(t[i:i+n] if i>=0 else 'NOT FOUND '+str(len(t)))
