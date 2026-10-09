import unicodedata
RMSP = ["Arujá","Barueri","Biritiba-Mirim","Caieiras","Cajamar","Carapicuíba","Cotia","Diadema","Embu das Artes","Embu-Guaçu","Ferraz de Vasconcelos","Francisco Morato","Franco da Rocha","Guararema","Guarulhos","Itapecerica da Serra","Itapevi","Itaquaquecetuba","Jandira","Juquitiba","Mairiporã","Mauá","Mogi das Cruzes","Osasco","Pirapora do Bom Jesus","Poá","Ribeirão Pires","Rio Grande da Serra","Salesópolis","Santa Isabel","Santana de Parnaíba","Santo André","São Bernardo do Campo","São Caetano do Sul","São Lourenço da Serra","São Paulo","Suzano","Taboão da Serra","Vargem Grande Paulista"]
def norm(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii','ignore').decode().upper().replace('-',' ').strip()
    return ' '.join(s.split())
RMSP_N = {norm(x) for x in RMSP}
# variantes
RMSP_N |= {"EMBU", "BIRITIBA MIRIM", "EMBU GUACU", "MOJI DAS CRUZES"}
