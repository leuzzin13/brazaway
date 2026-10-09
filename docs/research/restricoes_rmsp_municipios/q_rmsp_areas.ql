[out:json][timeout:300];
area["ISO3166-2"="BR-SP"]["admin_level"="4"]->.sp;
rel(area.sp)["boundary"="administrative"]["admin_level"="8"]["name"~"^(Arujá|Barueri|Biritiba Mirim|Caieiras|Cajamar|Carapicuíba|Cotia|Diadema|Embu das Artes|Embu-Guaçu|Ferraz de Vasconcelos|Francisco Morato|Franco da Rocha|Guararema|Guarulhos|Itapecerica da Serra|Itapevi|Itaquaquecetuba|Jandira|Juquitiba|Mairiporã|Mauá|Mogi das Cruzes|Osasco|Pirapora do Bom Jesus|Poá|Ribeirão Pires|Rio Grande da Serra|Salesópolis|Santa Isabel|Santana de Parnaíba|Santo André|São Bernardo do Campo|São Caetano do Sul|São Lourenço da Serra|São Paulo|Suzano|Taboão da Serra|Vargem Grande Paulista)$"];
out tags;
