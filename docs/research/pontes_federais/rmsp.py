import json, unicodedata
names="""Arujá, Barueri, Biritiba Mirim, Caieiras, Cajamar, Carapicuíba, Cotia, Diadema, Embu das Artes, Embu-Guaçu, Ferraz de Vasconcelos, Francisco Morato, Franco da Rocha, Guararema, Guarulhos, Itapecerica da Serra, Itapevi, Itaquaquecetuba, Jandira, Juquitiba, Mairiporã, Mauá, Mogi das Cruzes, Osasco, Pirapora do Bom Jesus, Poá, Ribeirão Pires, Rio Grande da Serra, Salesópolis, Santa Isabel, Santana de Parnaíba, Santo André, São Bernardo do Campo, São Caetano do Sul, São Lourenço da Serra, São Paulo, Suzano, Taboão da Serra, Vargem Grande Paulista""".split(', ')
def n(s): return unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower().replace('-',' ').strip()
mun=json.load(open('ibge_mun_sp.json'))
ids={}
for m in mun:
    if n(m['nome']) in {n(x) for x in names}: ids[str(m['id'])]=m['nome']
missing={n(x) for x in names}-{n(v) for v in ids.values()}
print(len(ids),'missing',missing)
# check rmsp microrregião field
rm=[m for m in mun if m['microrregiao']['mesorregiao']['nome']=='Metropolitana de São Paulo']
print('meso metrop SP',len(rm))
g=json.load(open('ibge_malha_sp.geojson'))
feats=[f for f in g['features'] if f['properties']['codarea'] in ids]
for f in feats: f['properties']['nome']=ids[f['properties']['codarea']]
print('poly',len(feats))
json.dump({'type':'FeatureCollection','features':feats},open('rmsp_municipios.geojson','w'))
