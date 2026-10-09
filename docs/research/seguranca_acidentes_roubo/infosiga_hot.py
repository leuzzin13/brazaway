import pandas as pd
fs = ['infosiga/dados_infosiga/sinistros_2022-2024.csv','infosiga/dados_infosiga/sinistros_2025-2026.csv']
s = pd.concat([pd.read_csv(f, sep=';', encoding='latin1', low_memory=False) for f in fs])
for c in ['latitude','longitude']:
    s[c] = pd.to_numeric(s[c].astype(str).str.replace(',','.'), errors='coerce')
rm = s[s.regiao_administrativa.str.contains('METROPOLITANA', na=False)]
print('RMSP 2022-2026/08 sinistros', len(rm), ' com caminhao', (rm.qtd_caminhao.fillna(0)>0).sum())
print('por ano (RMSP c/ caminhao):'); print(rm[rm.qtd_caminhao.fillna(0)>0].groupby('ano_sinistro').size().to_string())
tr = rm[(rm.qtd_caminhao.fillna(0)>0)]
inb = tr.latitude.between(-24.1,-23.15) & tr.longitude.between(-47.25,-45.65)
print('RMSP caminhao com coord valida dentro bbox:', inb.sum(), ' sem coord/fora:', (~inb).sum())
t = tr[inb].copy()
t['gx'] = (t.longitude/0.005).round().astype(int); t['gy']=(t.latitude/0.005).round().astype(int)
g = t.groupby(['gy','gx']).agg(n=('id_sinistro','size'), fatais=('qtd_gravidade_fatal', lambda x: x.fillna(0).sum()), lat=('latitude','mean'), lon=('longitude','mean'), via=('logradouro', lambda x: (x.dropna().value_counts().index.tolist() or [''])[0]), mun=('municipio','first')).sort_values('n', ascending=False)
print('celulas ~500m com >=1 sinistro c/ caminhao:', len(g), ' com >=5:', (g.n>=5).sum(), ' com >=10:', (g.n>=10).sum())
print(g.head(25).to_string())
g.reset_index().to_csv('infosiga/hotspots_caminhao_rmsp_grid500m_2022_2026.csv', index=False)
