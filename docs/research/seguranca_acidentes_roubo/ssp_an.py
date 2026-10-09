import pandas as pd, sys
from rmsp import RMSP_N, norm
c = pd.read_csv(sys.argv[1], dtype=str)
print('linhas', len(c)); print(c.NATUREZA_APURADA.value_counts().to_string())
r = c[c.NATUREZA_APURADA=='ROUBO DE CARGA'].copy()
# BO único
print('ROUBO DE CARGA linhas', len(r), ' BOs unicos', r[['NUM_BO','ANO_BO','NOME_DELEGACIA']].drop_duplicates().shape[0])
print('meses estatistica:'); print(r.groupby('MES_ESTATISTICA').size().to_string())
for col in ['LATITUDE','LONGITUDE']:
    r[col] = pd.to_numeric(r[col].str.replace(',','.'), errors='coerce')
r['coord'] = r.LATITUDE.notna() & (r.LATITUDE!=0)
print('com coordenada:', r.coord.mean().round(3))
r['mun'] = r.NOME_MUNICIPIO.map(norm)
import json
RM=set(json.load(open('rmsp_ibge.json')))
r['rmsp'] = r['COD IBGE'].astype(str).str.split('.').str[0].isin(RM)
print('RMSP:', r.rmsp.sum(), 'de', len(r), f'({r.rmsp.mean()*100:.1f}%)', ' RMSP com coord', r[r.rmsp].coord.mean().round(3))
print('Top municipios:'); print(r.NOME_MUNICIPIO.value_counts().head(20).to_string())
print('Periodo:'); print(r.DESC_PERIODO.value_counts().to_string())
print('Tipo local:'); print(r.DESCR_TIPOLOCAL.value_counts().head(10).to_string())
print('Subtipo local:'); print(r.DESCR_SUBTIPOLOCAL.value_counts().head(10).to_string())
print('Conduta:'); print(r.DESCR_CONDUTA.value_counts().head(10).to_string())
print('Rubrica:'); print(r.RUBRICA.value_counts().head(5).to_string())
print('Top logradouros RMSP:'); print(r[r.rmsp].LOGRADOURO.value_counts().head(30).to_string())
print('Hora preenchida:', r.HORA_OCORRENCIA_BO.notna().mean().round(3)); print('Hora (h) dist:'); h = (pd.to_numeric(r.HORA_OCORRENCIA_BO, errors='coerce')*24); print((h//1).value_counts().sort_index().to_string())
# grid 1km RMSP
t = r[r.rmsp & r.coord].copy()
t = t[t.LATITUDE.between(-24.1,-23.15) & t.LONGITUDE.between(-47.25,-45.65)]
t['gx']=(t.LONGITUDE/0.01).round().astype(int); t['gy']=(t.LATITUDE/0.01).round().astype(int)
g = t.groupby(['gy','gx']).agg(n=('NUM_BO','size'), lat=('LATITUDE','mean'), lon=('LONGITUDE','mean'), via=('LOGRADOURO', lambda x: (x.dropna().value_counts().index.tolist() or [''])[0]), mun=('NOME_MUNICIPIO','first')).sort_values('n', ascending=False)
print('celulas ~1km RMSP com roubo de carga:', len(g), ' >=5:', (g.n>=5).sum(), ' >=10:', (g.n>=10).sum())
print(g.head(20).to_string())
g.reset_index().to_csv(sys.argv[2], index=False)
