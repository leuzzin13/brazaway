# Resumo da pesquisa municipal — Sudeste

Gerado por `workflow/consolidar.py`. Municípios: 1667; já no app: 35; com resultado em `res/`: **1427**; sem resultado: **206**.

## Por status

| Status | Cidades |
|---|---|
| nao_achou | 1167 |
| regra_com_ato | 134 |
| pontual | 56 |
| sem_restricao_declarada | 26 |
| pista | 26 |
| regra_sem_ato | 17 |
| confirmou_que_nao_tem | 1 |

Por nível de busca: varredura_consolidada: 850, dirigida: 292, profundo: 146, media: 139

Com `falha_de_fonte` (resultado não conclusivo, refazer quando a fonte voltar): **176**.

## Por UF

| UF | nao_achou | regra_com_ato | pontual | sem_restricao_declarada | pista | regra_sem_ato | confirmou_que_nao_tem | total |
|---|---|---|---|---|---|---|---|---|
| ES | 60 | 5 | 4 | 3 | 3 | 0 | 0 | 75 |
| MG | 748 | 51 | 31 | 8 | 11 | 3 | 0 | 852 |
| RJ | 59 | 15 | 10 | 3 | 3 | 1 | 0 | 91 |
| SP | 300 | 63 | 11 | 12 | 9 | 13 | 1 | 409 |

## Verificação

Arquivos em `verif/`: 62. Vereditos: confirmado: 45, corrigido: 14, inverificavel: 3. Cidades com regra ativa ainda sem verificação: 57.

## Cidades com regra (rascunho)

| UF | Município | IBGE | Status | Regras ativas | Verificação |
|---|---|---|---|---|---|
| ES | Cachoeiro de Itapemirim | 3201209 | regra_com_ato | 3 | confirmado |
| ES | Colatina | 3201506 | regra_com_ato | 0 | corrigido |
| ES | Itarana | 3202900 | regra_com_ato | 1 | não |
| ES | Pedro Canário | 3204054 | regra_com_ato | 1 | não |
| ES | Viana | 3205101 | regra_com_ato | 0 | não |
| MG | Araxá | 3104007 | regra_com_ato | 2 | confirmado |
| MG | Arcos | 3104205 | regra_com_ato | 1 | confirmado |
| MG | Astolfo Dutra | 3104601 | regra_com_ato | 1 | não |
| MG | Betim | 3106705 | regra_com_ato | 2 | confirmado |
| MG | Brasilândia de Minas | 3108552 | regra_com_ato | 1 | não |
| MG | Campo Florido | 3111408 | regra_com_ato | 1 | não |
| MG | Campos Gerais | 3111606 | regra_com_ato | 1 | não |
| MG | Capinópolis | 3112604 | regra_com_ato | 1 | não |
| MG | Carbonita | 3113503 | regra_com_ato | 1 | não |
| MG | Congonhas | 3118007 | regra_com_ato | 1 | confirmado |
| MG | Conquista | 3118205 | regra_com_ato | 0 | não |
| MG | Conselheiro Lafaiete | 3118304 | regra_com_ato | 1 | inverificavel |
| MG | Cristália | 3120300 | regra_com_ato | 1 | não |
| MG | Cássia | 3115102 | regra_com_ato | 1 | não |
| MG | Diamantina | 3121605 | regra_com_ato | 1 | não |
| MG | Formiga | 3126109 | regra_com_ato | 1 | confirmado |
| MG | Frutal | 3127107 | regra_com_ato | 1 | confirmado |
| MG | Grão Mogol | 3127800 | regra_com_ato | 1 | não |
| MG | Ibiá | 3129509 | regra_com_ato | 1 | não |
| MG | Itabirito | 3131901 | regra_com_ato | 0 | corrigido |
| MG | Itaguara | 3132206 | regra_com_ato | 1 | não |
| MG | Itaúna | 3133808 | regra_com_ato | 1 | confirmado |
| MG | Iturama | 3134400 | regra_com_ato | 2 | não |
| MG | João Pinheiro | 3136306 | regra_com_ato | 1 | confirmado |
| MG | Juiz de Fora | 3136702 | regra_com_ato | 2 | confirmado |
| MG | Lambari | 3137809 | regra_com_ato | 2 | não |
| MG | Lavras | 3138203 | regra_com_ato | 0 | não |
| MG | Leopoldina | 3138401 | regra_com_ato | 1 | não |
| MG | Luz | 3138807 | regra_com_ato | 2 | não |
| MG | Manhuaçu | 3139409 | regra_com_ato | 1 | confirmado |
| MG | Matutina | 3141207 | regra_com_ato | 2 | não |
| MG | Minas Novas | 3141801 | regra_com_ato | 1 | não |
| MG | Nova Lima | 3144805 | regra_com_ato | 3 | confirmado |
| MG | Ouro Fino | 3146008 | regra_com_ato | 1 | não |
| MG | Ouro Preto | 3146107 | regra_com_ato | 1 | não |
| MG | Perdões | 3149903 | regra_com_ato | 2 | não |
| MG | Piranga | 3150802 | regra_com_ato | 2 | não |
| MG | Pirapetinga | 3151107 | regra_com_ato | 1 | não |
| MG | Ponte Nova | 3152105 | regra_com_ato | 1 | não |
| MG | Poços de Caldas | 3151800 | regra_com_ato | 1 | corrigido |
| MG | Recreio | 3154101 | regra_com_ato | 1 | não |
| MG | Santa Luzia | 3157807 | regra_com_ato | 1 | confirmado |
| MG | Serro | 3167103 | regra_com_ato | 2 | não |
| MG | Sete Lagoas | 3167202 | regra_com_ato | 3 | confirmado |
| MG | São Lourenço | 3163706 | regra_com_ato | 1 | não |
| MG | Teófilo Otoni | 3168606 | regra_com_ato | 1 | confirmado |
| MG | Uberaba | 3170107 | regra_com_ato | 0 | não |
| MG | Uberlândia | 3170206 | regra_com_ato | 0 | não |
| MG | Unaí | 3170404 | regra_com_ato | 1 | confirmado |
| MG | Viçosa | 3171303 | regra_com_ato | 1 | não |
| MG | Várzea da Palma | 3170800 | regra_com_ato | 1 | não |
| RJ | Barra Mansa | 3300407 | regra_com_ato | 1 | confirmado |
| RJ | Campos dos Goytacazes | 3301009 | regra_com_ato | 3 | confirmado |
| RJ | Itaguaí | 3302007 | regra_com_ato | 1 | confirmado |
| RJ | Macaé | 3302403 | regra_com_ato | 2 | corrigido |
| RJ | Magé | 3302502 | regra_com_ato | 1 | inverificavel |
| RJ | Mangaratiba | 3302601 | regra_com_ato | 1 | não |
| RJ | Maricá | 3302700 | regra_com_ato | 2 | não |
| RJ | Miguel Pereira | 3302908 | regra_com_ato | 1 | não |
| RJ | Niterói | 3303302 | regra_com_ato | 2 | corrigido |
| RJ | Nova Friburgo | 3303401 | regra_com_ato | 0 | não |
| RJ | Piraí | 3304003 | regra_com_ato | 1 | não |
| RJ | Resende | 3304201 | regra_com_ato | 2 | corrigido |
| RJ | São Gonçalo | 3304904 | regra_com_ato | 3 | corrigido |
| RJ | São João de Meriti | 3305109 | regra_com_ato | 0 | corrigido |
| RJ | Volta Redonda | 3306305 | regra_com_ato | 0 | não |
| SP | Altinópolis | 3501004 | regra_com_ato | 1 | não |
| SP | Americana | 3501608 | regra_com_ato | 2 | corrigido |
| SP | Aparecida | 3502507 | regra_com_ato | 1 | não |
| SP | Araraquara | 3503208 | regra_com_ato | 2 | confirmado |
| SP | Araçariguama | 3502754 | regra_com_ato | 1 | não |
| SP | Atibaia | 3504107 | regra_com_ato | 1 | corrigido |
| SP | Avaré | 3504503 | regra_com_ato | 1 | confirmado |
| SP | Barretos | 3505500 | regra_com_ato | 1 | confirmado |
| SP | Bastos | 3505807 | regra_com_ato | 1 | não |
| SP | Bauru | 3506003 | regra_com_ato | 2 | confirmado |
| SP | Bebedouro | 3506102 | regra_com_ato | 1 | confirmado |
| SP | Botucatu | 3507506 | regra_com_ato | 3 | confirmado |
| SP | Bragança Paulista | 3507605 | regra_com_ato | 3 | confirmado |
| SP | Buritama | 3508108 | regra_com_ato | 1 | não |
| SP | Buritizal | 3508207 | regra_com_ato | 1 | não |
| SP | Cosmorama | 3512902 | regra_com_ato | 0 | não |
| SP | Cunha | 3513603 | regra_com_ato | 2 | não |
| SP | Dobrada | 3514007 | regra_com_ato | 2 | não |
| SP | Estrela d'Oeste | 3515202 | regra_com_ato | 0 | não |
| SP | Garça | 3516705 | regra_com_ato | 1 | não |
| SP | Iaras | 3519253 | regra_com_ato | 0 | não |
| SP | Ibitinga | 3519600 | regra_com_ato | 1 | não |
| SP | Ibiúna | 3519709 | regra_com_ato | 6 | confirmado |
| SP | Indaiatuba | 3520509 | regra_com_ato | 2 | confirmado |
| SP | Itapeva | 3522406 | regra_com_ato | 3 | corrigido |
| SP | Itapevi | 3522505 | regra_com_ato | 1 | confirmado |
| SP | Itapira | 3522604 | regra_com_ato | 2 | confirmado |
| SP | Itararé | 3523206 | regra_com_ato | 1 | não |
| SP | Itatiba | 3523404 | regra_com_ato | 3 | confirmado |
| SP | Jaú | 3525300 | regra_com_ato | 1 | inverificavel |
| SP | Junqueirópolis | 3526001 | regra_com_ato | 0 | não |
| SP | Leme | 3526704 | regra_com_ato | 1 | confirmado |
| SP | Limeira | 3526902 | regra_com_ato | 1 | corrigido |
| SP | Lins | 3527108 | regra_com_ato | 1 | confirmado |
| SP | Lourdes | 3527256 | regra_com_ato | 1 | não |
| SP | Marília | 3529005 | regra_com_ato | 2 | confirmado |
| SP | Matão | 3529302 | regra_com_ato | 1 | confirmado |
| SP | Olímpia | 3533908 | regra_com_ato | 2 | não |
| SP | Ourinhos | 3534708 | regra_com_ato | 1 | confirmado |
| SP | Pardinho | 3536109 | pontual | 1 | não |
| SP | Paulínia | 3536505 | regra_com_ato | 0 | não |
| SP | Penápolis | 3537305 | regra_com_ato | 1 | confirmado |
| SP | Piedade | 3537800 | regra_com_ato | 1 | confirmado |
| SP | Pindamonhangaba | 3538006 | regra_com_ato | 2 | confirmado |
| SP | Pirangi | 3539004 | regra_com_ato | 1 | não |
| SP | Praia Grande | 3541000 | regra_com_ato | 2 | confirmado |
| SP | Presidente Prudente | 3541406 | regra_com_ato | 1 | confirmado |
| SP | Rio Claro | 3543907 | regra_com_ato | 1 | confirmado |
| SP | Rio Grande da Serra | 3544103 | regra_com_ato | 0 | não |
| SP | Santa Bárbara d'Oeste | 3545803 | regra_com_ato | 0 | não |
| SP | São Bento do Sapucaí | 3548609 | regra_com_ato | 1 | não |
| SP | São Caetano do Sul | 3548807 | regra_com_ato | 0 | não |
| SP | São José dos Campos | 3549904 | regra_com_ato | 0 | não |
| SP | São Manuel | 3550100 | regra_com_ato | 1 | não |
| SP | São Roque | 3550605 | regra_com_ato | 1 | não |
| SP | Tanabi | 3553401 | regra_com_ato | 1 | não |
| SP | Tatuí | 3554003 | regra_com_ato | 1 | confirmado |
| SP | Taubaté | 3554102 | regra_com_ato | 1 | corrigido |
| SP | Valinhos | 3556206 | regra_com_ato | 2 | corrigido |
| SP | Vinhedo | 3556701 | regra_com_ato | 1 | não |
| SP | Votorantim | 3557006 | regra_com_ato | 1 | confirmado |
| SP | Votuporanga | 3557105 | regra_com_ato | 2 | confirmado |
| SP | Águas da Prata | 3500402 | regra_com_ato | 1 | não |
| SP | Águas de São Pedro | 3500600 | regra_com_ato | 1 | não |

## Sem resultado

Adamantina (SP, 3500105), Aguaí (SP, 3500303), Águas de Lindóia (SP, 3500501), Águas de Santa Bárbara (SP, 3500550), Agudos (SP, 3500709), Alfredo Marcondes (SP, 3500808), Alto Alegre (SP, 3501103), Álvares Machado (SP, 3501301), Américo Brasiliense (SP, 3501707), Angatuba (SP, 3502200), Apiaí (SP, 3502705), Araçoiaba da Serra (SP, 3502903), Arandu (SP, 3503109), Artur Nogueira (SP, 3503802), Auriflama (SP, 3504206), Avaí (SP, 3504305), Bady Bassitt (SP, 3504602), Bananal (SP, 3504909), Bariri (SP, 3505203), Barra Bonita (SP, 3505302), Barra do Turvo (SP, 3505401), Barrinha (SP, 3505609), Batatais (SP, 3505906), Bernardino de Campos (SP, 3506300), Bertioga (SP, 3506359), Biritiba Mirim (SP, 3506607), Bom Jesus dos Perdões (SP, 3507100), Borborema (SP, 3507407), Brodowski (SP, 3507803), Brotas (SP, 3507902), Buri (SP, 3508009), Cabreúva (SP, 3508405), Caçapava (SP, 3508504), Cachoeira Paulista (SP, 3508603), Cafelândia (SP, 3508801), Cajati (SP, 3509254), Cajuru (SP, 3509403), Campo Limpo Paulista (SP, 3509601), Campos do Jordão (SP, 3509700), Cananéia (SP, 3509908), Cândido Mota (SP, 3510005), Capão Bonito (SP, 3510203), Capela do Alto (SP, 3510302), Capivari (SP, 3510401), Cardoso (SP, 3510708), Casa Branca (SP, 3510807), Catiguá (SP, 3511201), Cerqueira César (SP, 3511409), Cerquilho (SP, 3511508), Cesário Lange (SP, 3511607), Colina (SP, 3512001), Conchal (SP, 3512209), Conchas (SP, 3512308), Cordeirópolis (SP, 3512407), Cosmópolis (SP, 3512803), Cravinhos (SP, 3513108), Cruzeiro (SP, 3513405), Descalvado (SP, 3513702), Dirce Reis (SP, 3513850), Divinolândia (SP, 3513900), Dois Córregos (SP, 3514106), Dourado (SP, 3514304), Dracena (SP, 3514403), Dumont (SP, 3514601), Elias Fausto (SP, 3514908), Embu-Guaçu (SP, 3515103), Emilianópolis (SP, 3515129), Engenheiro Coelho (SP, 3515152), Espírito Santo do Pinhal (SP, 3515186), Ferraz de Vasconcelos (SP, 3515707), Flórida Paulista (SP, 3516002), Francisco Morato (SP, 3516309), Getulina (SP, 3517000), Guapiaçu (SP, 3517505), Guapiara (SP, 3517604), Guararapes (SP, 3518206), Guararema (SP, 3518305), Guaratinguetá (SP, 3518404), Guareí (SP, 3518503), Guariba (SP, 3518602), Herculândia (SP, 3519006), Holambra (SP, 3519055), Ibaté (SP, 3519303), Igaraçu do Tietê (SP, 3520004), Igarapava (SP, 3520103), Igaratá (SP, 3520202), Iguape (SP, 3520301), Ilhabela (SP, 3520400), Indiana (SP, 3520608), Iracemápolis (SP, 3521408), Itaberá (SP, 3521705), Itaí (SP, 3521804), Itanhaém (SP, 3522109), Itápolis (SP, 3522703), Itapuí (SP, 3522901), Itariri (SP, 3523305), Itirapina (SP, 3523602), Ituverava (SP, 3524105), Jacupiranga (SP, 3524600), Jales (SP, 3524808), Jandira (SP, 3525003), Jardinópolis (SP, 3525102), José Bonifácio (SP, 3525706), Juquiá (SP, 3526100), Laranjal Paulista (SP, 3526407), Louveira (SP, 3527306), Lucélia (SP, 3527405), Luís Antônio (SP, 3527603), Macatuba (SP, 3528007), Marabá Paulista (SP, 3528700), Maracaí (SP, 3528809), Mendonça (SP, 3529500), Meridiano (SP, 3529609), Miracatu (SP, 3529906), Mirandópolis (SP, 3530102), Mococa (SP, 3530508), Mongaguá (SP, 3531100), Monte Alegre do Sul (SP, 3531209), Monte Aprazível (SP, 3531407), Monte Azul Paulista (SP, 3531506), Monte Castelo (SP, 3531605), Morro Agudo (SP, 3531902), Nazaré Paulista (SP, 3532405), Nova Aliança (SP, 3532801), Nova Granada (SP, 3533007), Novo Horizonte (SP, 3533502), Orlândia (SP, 3534302), Osvaldo Cruz (SP, 3534609), Ouroeste (SP, 3534757), Pacaembu (SP, 3534906), Palmital (SP, 3535309), Panorama (SP, 3535408), Paraguaçu Paulista (SP, 3535507), Paranapanema (SP, 3535804), Parapuã (SP, 3536000), Pariquera-Açu (SP, 3536208), Paulicéia (SP, 3536406), Pederneiras (SP, 3536703), Pedreira (SP, 3537107), Pereira Barreto (SP, 3537404), Peruíbe (SP, 3537602), Piacatu (SP, 3537701), Pilar do Sul (SP, 3537909), Pinhalzinho (SP, 3538204), Piracaia (SP, 3538600), Piraju (SP, 3538808), Pirapozinho (SP, 3539202), Pirassununga (SP, 3539301), Pitangueiras (SP, 3539509), Pontal (SP, 3540200), Porangaba (SP, 3540507), Porto Ferreira (SP, 3540705), Potirendaba (SP, 3540804), Pradópolis (SP, 3540903), Pratânia (SP, 3541059), Presidente Venceslau (SP, 3541505), Promissão (SP, 3541604), Rancharia (SP, 3542206), Regente Feijó (SP, 3542404), Registro (SP, 3542602), Ribeirão Bonito (SP, 3542909), Ribeirão Branco (SP, 3543006), Ribeirão Grande (SP, 3543253), Rinópolis (SP, 3543808), Rio das Pedras (SP, 3544004), Rosana (SP, 3544251), Sales Oliveira (SP, 3544905), Salesópolis (SP, 3545001), Saltinho (SP, 3545159), Salto de Pirapora (SP, 3545308), Salto Grande (SP, 3545407), Santa Adélia (SP, 3545605), Santa Branca (SP, 3546009), Santa Cruz das Palmeiras (SP, 3546306), Santa Fé do Sul (SP, 3546603), Santa Gertrudes (SP, 3546702), Santa Rita do Passa Quatro (SP, 3547502), Santa Rosa de Viterbo (SP, 3547601), Santo Antônio de Posse (SP, 3548005), Santo Expedito (SP, 3548302), São Joaquim da Barra (SP, 3549409), São José do Barreiro (SP, 3549607), São Luiz do Paraitinga (SP, 3550001), São Miguel Arcanjo (SP, 3550209), São Pedro (SP, 3550407), São Sebastião (SP, 3550704), São Simão (SP, 3550902), Serrana (SP, 3551504), Serra Negra (SP, 3551603), Severínia (SP, 3551900), Socorro (SP, 3552106), Suzanápolis (SP, 3552551), Tabapuã (SP, 3552601), Tabatinga (SP, 3552700), Tambaú (SP, 3553302), Taquarituba (SP, 3553807), Tarumã (SP, 3553955), Teodoro Sampaio (SP, 3554300), Tietê (SP, 3554508), Torrinha (SP, 3554706), Ubatuba (SP, 3555406), Vargem (SP, 3556354), Vargem Grande do Sul (SP, 3556404), Várzea Paulista (SP, 3556503), Vera Cruz (SP, 3556602), Vista Alegre do Alto (SP, 3556909)
