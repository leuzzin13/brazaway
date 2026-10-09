import pandas as pd
for n in ['riosp','afd','arb']:
    d = pd.read_csv(f'antt/{n}.csv', sep=';', encoding='latin1', low_memory=False, on_bad_lines='skip')
    d['dt'] = pd.to_datetime(d.data, format='%d/%m/%Y', errors='coerce')
    d['km_f'] = pd.to_numeric(d.km.astype(str).str.replace(',','.'), errors='coerce')
    print(f'===== {n}: linhas {len(d)} datas {d.dt.min().date()}..{d.dt.max().date()} trechos {d.trecho.value_counts().to_dict()}')
    r = d[d.dt.dt.year==2025]
    cam = r[pd.to_numeric(r.caminhao, errors='coerce').fillna(0)>0]
    print(f'  2025: ocorrencias {len(r)}, com caminhao {len(cam)} ({len(cam)/max(1,len(r))*100:.1f}%), mortos {pd.to_numeric(r.mortos,errors="coerce").sum()}, mortos c/ caminhao {pd.to_numeric(cam.mortos,errors="coerce").sum()}')
    print('  tipo_de_ocorrencia:', r.tipo_de_ocorrencia.value_counts().to_dict())
    # trechos SP: km ranges
    sp = cam[cam.trecho.astype(str).str.contains('/SP')]
    sp = sp.assign(kmi=sp.km_f//1)
    print('  top km (caminhao, SP, 2025):'); print(sp.groupby(['trecho','kmi','sentido']).size().sort_values(ascending=False).head(10).to_string())
