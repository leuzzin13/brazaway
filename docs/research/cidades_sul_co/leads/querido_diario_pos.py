#!/usr/bin/env python3
"""Pos-processa qd_raw/*.json -> querido_diario.json ({ibge: {...}})."""
import json, os, re, glob, unicodedata, csv
BASE=os.path.dirname(os.path.abspath(__file__)); CID=os.path.dirname(BASE); RAW=os.path.join(BASE,'qd_raw')
def n(s): return unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower()
CAM=re.compile(r'caminh|veiculos? pesad|veiculos? de carga|\bvuc\b|carga e descarga|zona de restricao|transito pesado|toneladas|\bton\b|\bpbt\b')
CTX=re.compile(r'proib|restri|circula|horario|vedad|vedacao|permit|trafeg|transito|\bvia\b|\bvias\b|\brua\b|avenida|perimetro|zona|estacionamento')
RUIDO=re.compile(r'contratacao de empresa|pregao|registro de precos|locacao de|aquisicao de|dispensa de licitacao|inexigibilidade|tomada de precos|fornecimento de|prestacao de servico|ata de registro|extrato de contrato|aditivo|ordem de servico|combustivel|pecas')
def pontua(t):
    s=n(t); sc=0
    if CAM.search(s): sc+=2
    else: return -9
    if re.search(r'circula|proib|restri|vedad|trafeg',s): sc+=2
    if re.search(r'horario|\bas \d|das \d|\d ?h\b',s): sc+=1
    if re.search(r'decreto|lei (complementar )?n|portaria|resolucao|art\.',s): sc+=1
    if re.search(r'carga e descarga|zona de restricao|transito pesado|veiculos? pesad|\bvuc\b',s): sc+=1
    if CTX.search(s): sc+=1
    if RUIDO.search(s): sc-=3
    return sc
cid={c['territory_id']:c for c in json.load(open(os.path.join(RAW,'cities.json')))['cities']}
out={}; por={}
for f in sorted(glob.glob(os.path.join(RAW,'*__*.json'))):
    d=json.load(open(f)); por.setdefault(d['ibge'],[]).append(d)
for ib,ds in sorted(por.items()):
    c=cid[ib]; termos={}; ocor={}
    for d in ds:
        termos[d['termo']]={'total_diarios':d['total'],'recuperados':len(d['gazettes'])}
        for g in d['gazettes']:
            ex=[re.sub(r'\s+',' ',e).strip() for e in g.get('excerpts',[])]
            best=max(((pontua(e),e) for e in ex),default=(-9,''))
            k=g['url']; o=ocor.setdefault(k,{'data':g['date'],'edicao':g.get('edition'),'extra':g.get('is_extra_edition'),'url':g['url'],'url_txt':g.get('txt_url'),'termos':[],'score':-9,'trecho':''})
            o['termos'].append(d['termo'])
            if best[0]>o['score']: o['score']=best[0]; o['trecho']=best[1]
    rel=[o for o in ocor.values() if o['score']>=4]
    rel.sort(key=lambda o:(-o['score'],-len(o['termos']),o['data']),reverse=False)
    rel.sort(key=lambda o:(o['score'],len(o['termos']),o['data']),reverse=True)
    n_termos_ok=len([d for d in ds])
    out[ib]={'nome':c['territory_name'],'uf':c['state_code'],'nivel_qd':c['level'],'disponivel_desde':c.get('availability_date') or None,
        'termos_consultados':len(ds),'termos':termos,'diarios_distintos_recuperados':len(ocor),
        'acertos_relevantes':len(rel),'criterio_relevancia':'trecho com termo de caminhao/carga + contexto de circulacao/proibicao/horario/ato, sem ruido de licitacao (score>=4, heuristica; conferir no diario)',
        'melhores_10':[{k:o[k] for k in ('data','trecho','url','url_txt','edicao','termos','score')} for o in rel[:10]]}
meta={'_meta':{'fonte':'https://api.queridodiario.org.br/gazettes (via queridodiario.ok.org.br/api, que redireciona)','termos':sorted({d['termo'] for ds in por.values() for d in ds}),
    'cobertos_total':len(por),'com_acerto_relevante':sum(1 for v in out.values() if v['acertos_relevantes']),
    'nota':'Cobertura = municipios de municipios.csv com level>0 ou availability_date em /cities. Por termo foram recuperados so os 10 diarios mais relevantes; total_diarios e o total bruto da API. So PISTA.'}}
json.dump({**meta,**out},open(os.path.join(BASE,'querido_diario.json'),'w'),ensure_ascii=False,indent=1)
print(meta['_meta']['cobertos_total'],meta['_meta']['com_acerto_relevante'])
