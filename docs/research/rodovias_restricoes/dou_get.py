import sys,re,html,subprocess
url=sys.argv[1]; out=sys.argv[2]
s=subprocess.run(['curl','-sS','-L','-A','Mozilla/5.0',url],capture_output=True,text=True).stdout
m=re.search(r'<div class="texto-dou">(.*?)<div class="(?:informacao-conteudo-dou|footer)',s,re.S) or re.search(r'<div class="texto-dou">(.*?)</article>',s,re.S)
body=m.group(1) if m else s
txt=re.sub(r'</p>|</tr>|<br\s*/?>','\n',body); txt=re.sub(r'</td>',' | ',txt)
txt=html.unescape(re.sub('<[^>]+>','',txt))
txt=re.sub(r'[ \t]+',' ',txt); txt=re.sub(r'\n\s*\n+','\n',txt)
open(out,'w').write(txt)
print(len(txt))
