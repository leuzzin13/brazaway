#!/usr/bin/env python3
"""Penaestrada (Trucao) - paginas /restricoes/<slug>/ para os 1.659 municipios do Sul/Centro-Oeste.
Adapta penaestrada_coleta.py (Sudeste): indice = sitemap + seletor; baixa so paginas do indice (cache);
e SONDA o slug de TODOS os municipios (sem seguir redirect, >=1,1 s) p/ confirmar indice completo.
Pagina de terceiros: so PISTA."""
import csv, json, os, re, sys, time, importlib.util
BASE=os.path.dirname(os.path.abspath(__file__)); CID=os.path.dirname(BASE)
spec=importlib.util.spec_from_file_location('pe',os.path.join(BASE,'penaestrada_coleta.py')); pe=importlib.util.module_from_spec(spec); spec.loader.exec_module(pe)
pe.DELAY=1.1
RAW=os.path.join(BASE,'penaestrada_sulco_raw'); PAGES=os.path.join(RAW,'pages'); os.makedirs(PAGES,exist_ok=True)
PROBES=os.path.join(RAW,'probes.json'); OUT=os.path.join(BASE,'penaestrada.json')
SITE=pe.SITE; HOJE=pe.HOJE
mun=[{'ibge':r[0],'nome':r[1],'uf':r[2]} for r in csv.reader(open(os.path.join(CID,'municipios.csv'),encoding='utf-8'),delimiter=';') if r[0].isdigit()]
pe.UF_EST.update({'parana':'PR','rio-grande-do-sul':'RS','goias':'GO','mato-grosso':'MT','mato-grosso-do-sul':'MS','distrito-federal':'DF'})
ESTADO_NOME={'PR':'parana','SC':'santa-catarina','RS':'rio-grande-do-sul','GO':'goias','MT':'mato-grosso','MS':'mato-grosso-do-sul','DF':'distrito-federal'}
def main():
    sm=pe.cached(os.path.join(RAW,'sitemap.xml'),SITE+'/restricoes-sitemap.xml').decode()
    idx={}
    for loc in re.findall(r'<loc>(.*?)</loc>',sm):
        if '/restricoes/' in loc and loc.rstrip('/').split('/')[-1]!='restricoes': idx[loc.rstrip('/').split('/')[-1]]={'url':loc}
    arch=pe.cached(os.path.join(RAW,'indice.html'),SITE+'/restricoes/').decode('utf-8','replace')
    for href,lab in re.findall(r'<option value="(https://penaestrada\.com\.br/restricoes/[^"]+)">(.*?)</option>',arch):
        idx.setdefault(href.rstrip('/').split('/')[-1],{'url':href})['rotulo']=pe.html.unescape(lab).strip()
    print('indice',len(idx),flush=True)
    paginas={}
    for slug,e in sorted(idx.items()):
        raw=pe.cached(os.path.join(PAGES,slug+'.html'),e['url'])
        if raw is None: continue
        p=pe.parse_page(raw,e['url']); p.update(e); p['slug']=slug; paginas[slug]=p
    # sondagem de todos os slugs
    probes=json.load(open(PROBES)) if os.path.exists(PROBES) else {}
    n=0
    for m in mun:
        ib=m['ibge']
        if ib in probes: continue
        slug=pe.slugify(m['nome'])
        if slug in idx: probes[ib]={'slug':slug,'status':'no_indice'}; continue
        st,body,loc=pe.fetch(f'{SITE}/restricoes/{slug}/',follow=False)
        probes[ib]={'slug':slug,'status':st,'location':loc}
        if st==200 and slug not in paginas:   # pagina fora do indice
            raw=body; open(os.path.join(PAGES,slug+'.html'),'wb').write(raw)
            p=pe.parse_page(raw,f'{SITE}/restricoes/{slug}/'); p['slug']=slug; p['fora_do_indice']=True; paginas[slug]=p
        n+=1
        if n%50==0: json.dump(probes,open(PROBES,'w')); print('sondados',n,flush=True)
    json.dump(probes,open(PROBES,'w'),ensure_ascii=False)
    # casamento
    byuf={}
    for m in mun: byuf.setdefault(m['uf'],{})[pe.norm(m['nome'])]=m
    match={}; fora=[]
    for slug,p in paginas.items():
        ufs=[u for u in p.get('uf_site',[]) if u in byuf]
        if not ufs: fora.append(slug); continue
        cand=None;met=None;inc=None
        for nm,how in ((p.get('rotulo'),'nome_seletor'),(p.get('titulo'),'titulo_h1'),(slug.replace('-',' '),'slug')):
            if not nm: continue
            for uf in ufs:
                mm=byuf[uf].get(pe.norm(nm))
                if mm: cand,met=mm,how;break
            if cand: break
        if not cand:
            # sufixo de capital ("-capital") ou apelido (poa)
            for nm in (re.sub(r'\bcapital\b','',p.get('titulo') or slug.replace('-',' ')).strip(), 'porto alegre' if slug=='poa' else ''):
                for uf in ufs:
                    mm=byuf[uf].get(pe.norm(nm)) if nm else None
                    if mm: cand,met,inc=mm,'alias('+nm+')','slug/titulo nao padrao; casado pelo UF do site'; break
                if cand: break
        if cand: match[cand['ibge']]=(slug,met,inc)
        else: fora.append(slug)
    print('casadas',len(match),'fora',fora,flush=True)
    out={}
    for m in mun:
        ib=m['ibge']; r={'nome':m['nome'],'uf':m['uf'],'fonte':'penaestrada.com.br (Trucao) - compilacao de terceiros, so PISTA','consultado_em':HOJE}
        if ib in match:
            slug,met,inc=match[ib]; p=paginas[slug]; c=p.get('campos',{})
            vias=c.get('Trechos','').strip() or None
            hor={k:c.get(k,'').strip() for k in ('Segunda a Sexta','Sábado','Domingo e Feriados') if c.get(k,'').strip()}
            fontes=[l for l in p.get('links_citados',[])]+[{'ato':a} for a in p.get('menciona_ato',[])]
            r.update({'tem_pagina':True,'url':p['url'],'diz':p.get('diz_possui_restricao'),'vias':vias,'horarios':hor or None,
                      'fontes_citadas':fontes,'tipo_caminhao':c.get('Tipo de Caminhão') or None,'campos':c,'texto_extra':p.get('texto_extra'),
                      'menciona_vuc':p.get('menciona_vuc'),'pagina_vazia':p.get('vazia'),'metodo_casamento':met,'casamento_incerto':inc,
                      'data_modificacao_sitemap':None})
        else:
            r.update({'tem_pagina':False,'diz':None,'vias':None,'horarios':None,'fontes_citadas':[],'slug_sondado':probes.get(ib,{}).get('slug'),'status_sondagem':probes.get(ib,{}).get('status')})
        out[ib]=r
    meta={'_meta':{'gerado_em':HOJE,'indice_total_paginas':len(idx),'paginas_fora_de_sul_co':fora,'municipios':len(mun),
        'sondagem':'slug de cada municipio sondado sem seguir redirect; 404 = sem pagina','aviso':'Compilacao de terceiros (Trucao/Pe na Estrada); pista, nao fonte primaria.'}}
    json.dump({**meta,**out},open(OUT+'.tmp','w'),ensure_ascii=False,indent=1); os.replace(OUT+'.tmp',OUT)
    print('gravado',OUT,len(out),'com pagina',sum(1 for v in out.values() if v['tem_pagina']),flush=True)
main()
