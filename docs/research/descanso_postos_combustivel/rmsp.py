import json,unicodedata,re,os
def norm(s):
    s=unicodedata.normalize('NFKD',str(s or '')).encode('ascii','ignore').decode().upper()
    return ' '.join(re.sub(r'[^A-Z ]',' ',s).split())
_here=os.path.dirname(os.path.abspath(__file__))
RMSP=set(norm(m['nome']) for m in json.load(open(os.path.join(_here,'rmsp_municipios.json'))))
RMSP_IBGE=set(m['id'] for m in json.load(open(os.path.join(_here,'rmsp_municipios.json'))))
RMSP |= {'EMBU','BIRITIBA MIRIM','MOJI DAS CRUZES'}
