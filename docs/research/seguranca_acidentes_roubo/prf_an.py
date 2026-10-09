import pandas as pd
from rmsp import RMSP_N, norm
TRUCK = {'Caminhão','Caminhão-trator','Semireboque','Reboque'}
out=[]
for yr in ['2025','2026']:
    t = pd.read_csv(f'prf/acidentes{yr}_todas_causas_tipos.csv', sep=';', encoding='latin1', decimal=',', low_memory=False)
    d = pd.read_csv(f'prf/datatran{yr}.csv', sep=';', encoding='latin1', decimal=',', low_memory=False)
    truck_ids = set(t.loc[t.tipo_veiculo.isin(TRUCK),'id'])
    d['truck'] = d.id.isin(truck_ids)
    d['rmsp'] = (d.uf=='SP') & d.municipio.map(norm).isin(RMSP_N)
    print(f'===== {yr}: datas {d.data_inversa.min()}..{d.data_inversa.max()}')
    for name, m in [('Brasil', d.uf.notna()), ('SP', d.uf=='SP'), ('RMSP', d.rmsp)]:
        s = d[m]; st = s[s.truck]
        print(f'{name}: ocorrencias {len(s)}, com caminhao {len(st)} ({len(st)/len(s)*100:.1f}%), mortos total {s.mortos.sum()}, mortos em acid c/ caminhao {st.mortos.sum()} ({st.mortos.sum()/max(1,s.mortos.sum())*100:.1f}%)')
    # coords
    print('lat/lon nulos:', d.latitude.isna().sum(), ' lat fora BR:', ((d.latitude>6)|(d.latitude<-34)).sum())
    r = d[d.rmsp & d.truck]
    print('RMSP caminhao por BR:'); print(r.br.value_counts().to_string())
    print('RMSP caminhao por municipio:'); print(r.municipio.value_counts().head(15).to_string())
    print('RMSP caminhao tipo_acidente:'); print(r.tipo_acidente.value_counts().head(10).to_string())
    print('RMSP caminhao causa:'); print(r.causa_acidente.value_counts().head(10).to_string())
    print('RMSP caminhao fase_dia:'); print(r.fase_dia.value_counts().to_string())
    r = r.copy(); r['km_int'] = r.km.astype(float).astype(int)
    print('Top trechos (BR, km inteiro, sentido) RMSP caminhao:')
    print(r.groupby(['br','km_int']).agg(n=('id','size'), mortos=('mortos','sum'), feridos_graves=('feridos_graves','sum'), mun=('municipio','first')).sort_values('n', ascending=False).head(20).to_string())
    bt = d[d.truck]
    print('Brasil caminhao top UFs:'); print(bt.uf.value_counts().head(10).to_string())
    print('Brasil caminhao tipo_acidente:'); print(bt.tipo_acidente.value_counts().head(8).to_string())
    print('Brasil caminhao causa:'); print(bt.causa_acidente.value_counts().head(10).to_string())
    if yr=='2025':
        d[d.rmsp].to_csv('prf/amostra_prf_rmsp_2025.csv', index=False)
