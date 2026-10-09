import re,html,sys
x=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
t=re.sub(r'<script.*?</script>|<style.*?</style>','',x,flags=re.S|re.I)
t=re.sub(r'<br\s*/?>|</p>|</li>|</tr>|</h\d>|</div>','\n',t,flags=re.I)
t=html.unescape(re.sub(r'<[^>]+>',' ',t)); t=re.sub(r'[ \t\r]+',' ',t); t=re.sub(r'\n\s*\n+','\n',t)
s=sys.argv[2] if len(sys.argv)>2 else None
if s:
    i=t.find(s); t=t[i:] if i>=0 else t
e=sys.argv[3] if len(sys.argv)>3 else None
if e:
    j=t.find(e,200); t=t[:j] if j>0 else t
print(t)
