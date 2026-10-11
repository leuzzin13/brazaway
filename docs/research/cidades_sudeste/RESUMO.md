# Resumo da pesquisa municipal — Sudeste

Gerado por `workflow/consolidar.py`. Municípios: 1667; já no app: 35; com resultado em `res/`: **1614**; sem resultado: **19**.

## Por status

| Status | Cidades |
|---|---|
| nao_achou | 1304 |
| regra_com_ato | 159 |
| pontual | 65 |
| sem_restricao_declarada | 34 |
| pista | 33 |
| regra_sem_ato | 18 |
| confirmou_que_nao_tem | 1 |

Por nível de busca: varredura_consolidada: 850, dirigida: 385, media: 233, profundo: 146

Com `falha_de_fonte` (resultado não conclusivo, refazer quando a fonte voltar): **280**.

## Por UF

| UF | nao_achou | regra_com_ato | pontual | sem_restricao_declarada | pista | regra_sem_ato | confirmou_que_nao_tem | total |
|---|---|---|---|---|---|---|---|---|
| ES | 60 | 5 | 4 | 3 | 3 | 0 | 0 | 75 |
| MG | 748 | 51 | 31 | 8 | 11 | 3 | 0 | 852 |
| RJ | 59 | 15 | 10 | 3 | 3 | 1 | 0 | 91 |
| SP | 437 | 88 | 20 | 20 | 16 | 14 | 1 | 596 |

## Verificação

Arquivos em `verif/`: 73. Vereditos: confirmado: 53, corrigido: 16, inverificavel: 3, rebaixado: 1. Cidades com regra ativa ainda sem verificação: 67.

## Cidades com regra (rascunho)

| UF | Município | IBGE | Status | Regras ativas | Verificação |
|---|---|---|---|---|---|
| ES | Cachoeiro de Itapemirim | 3201209 | regra_com_ato | 3 | confirmado |
| ES | Colatina | 3201506 | regra_com_ato | 0 | corrigido |
| ES | Itarana | 3202900 | regra_com_ato | 1 | confirmado |
| ES | Pedro Canário | 3204054 | regra_com_ato | 1 | confirmado |
| ES | Viana | 3205101 | regra_com_ato | 0 | não |
| MG | Araxá | 3104007 | regra_com_ato | 2 | confirmado |
| MG | Arcos | 3104205 | regra_com_ato | 1 | confirmado |
| MG | Astolfo Dutra | 3104601 | regra_com_ato | 1 | não |
| MG | Betim | 3106705 | regra_com_ato | 2 | confirmado |
| MG | Brasilândia de Minas | 3108552 | regra_com_ato | 1 | não |
| MG | Campo Florido | 3111408 | regra_com_ato | 1 | confirmado |
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
| MG | Luz | 3138807 | regra_com_ato | 2 | confirmado |
| MG | Manhuaçu | 3139409 | regra_com_ato | 1 | confirmado |
| MG | Matutina | 3141207 | regra_com_ato | 2 | não |
| MG | Minas Novas | 3141801 | regra_com_ato | 1 | não |
| MG | Nova Lima | 3144805 | regra_com_ato | 3 | confirmado |
| MG | Ouro Fino | 3146008 | regra_com_ato | 0 | corrigido |
| MG | Ouro Preto | 3146107 | regra_com_ato | 1 | não |
| MG | Perdões | 3149903 | regra_com_ato | 2 | confirmado |
| MG | Piranga | 3150802 | regra_com_ato | 2 | não |
| MG | Pirapetinga | 3151107 | regra_com_ato | 1 | não |
| MG | Ponte Nova | 3152105 | regra_com_ato | 1 | corrigido |
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
| SP | Agudos | 3500709 | regra_com_ato | 1 | não |
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
| SP | Bertioga | 3506359 | regra_com_ato | 1 | não |
| SP | Botucatu | 3507506 | regra_com_ato | 3 | confirmado |
| SP | Bragança Paulista | 3507605 | regra_com_ato | 3 | confirmado |
| SP | Buritama | 3508108 | regra_com_ato | 1 | não |
| SP | Buritizal | 3508207 | regra_com_ato | 1 | não |
| SP | Cardoso | 3510708 | regra_com_ato | 1 | não |
| SP | Catiguá | 3511201 | regra_com_ato | 0 | não |
| SP | Conchal | 3512209 | regra_com_ato | 1 | não |
| SP | Cordeirópolis | 3512407 | regra_com_ato | 2 | não |
| SP | Cosmorama | 3512902 | regra_com_ato | 0 | não |
| SP | Cunha | 3513603 | regra_com_ato | 2 | não |
| SP | Dobrada | 3514007 | regra_com_ato | 2 | não |
| SP | Dumont | 3514601 | regra_com_ato | 0 | rebaixado |
| SP | Estrela d'Oeste | 3515202 | regra_com_ato | 0 | não |
| SP | Garça | 3516705 | regra_com_ato | 1 | não |
| SP | Getulina | 3517000 | regra_com_ato | 1 | não |
| SP | Guareí | 3518503 | regra_com_ato | 4 | não |
| SP | Guariba | 3518602 | regra_com_ato | 1 | não |
| SP | Holambra | 3519055 | regra_com_ato | 0 | não |
| SP | Iaras | 3519253 | regra_com_ato | 0 | não |
| SP | Ibitinga | 3519600 | regra_com_ato | 1 | não |
| SP | Ibiúna | 3519709 | regra_com_ato | 6 | confirmado |
| SP | Igarapava | 3520103 | regra_com_ato | 0 | não |
| SP | Indaiatuba | 3520509 | regra_com_ato | 2 | confirmado |
| SP | Itapeva | 3522406 | regra_com_ato | 3 | corrigido |
| SP | Itapevi | 3522505 | regra_com_ato | 1 | confirmado |
| SP | Itapira | 3522604 | regra_com_ato | 2 | confirmado |
| SP | Itararé | 3523206 | regra_com_ato | 1 | não |
| SP | Itatiba | 3523404 | regra_com_ato | 3 | confirmado |
| SP | Itápolis | 3522703 | regra_com_ato | 2 | não |
| SP | Jaú | 3525300 | regra_com_ato | 1 | inverificavel |
| SP | Junqueirópolis | 3526001 | regra_com_ato | 0 | não |
| SP | Leme | 3526704 | regra_com_ato | 1 | confirmado |
| SP | Limeira | 3526902 | regra_com_ato | 1 | corrigido |
| SP | Lins | 3527108 | regra_com_ato | 1 | confirmado |
| SP | Lourdes | 3527256 | regra_com_ato | 1 | não |
| SP | Maracaí | 3528809 | regra_com_ato | 1 | confirmado |
| SP | Marília | 3529005 | regra_com_ato | 2 | confirmado |
| SP | Matão | 3529302 | regra_com_ato | 1 | confirmado |
| SP | Meridiano | 3529609 | regra_com_ato | 2 | não |
| SP | Nova Aliança | 3532801 | regra_com_ato | 1 | não |
| SP | Olímpia | 3533908 | regra_com_ato | 2 | não |
| SP | Ourinhos | 3534708 | regra_com_ato | 1 | confirmado |
| SP | Parapuã | 3536000 | regra_com_ato | 1 | confirmado |
| SP | Pardinho | 3536109 | pontual | 1 | não |
| SP | Paulicéia | 3536406 | regra_com_ato | 1 | não |
| SP | Paulínia | 3536505 | regra_com_ato | 0 | não |
| SP | Penápolis | 3537305 | regra_com_ato | 1 | confirmado |
| SP | Piedade | 3537800 | regra_com_ato | 1 | confirmado |
| SP | Pindamonhangaba | 3538006 | regra_com_ato | 2 | confirmado |
| SP | Pirangi | 3539004 | regra_com_ato | 1 | não |
| SP | Praia Grande | 3541000 | regra_com_ato | 2 | confirmado |
| SP | Presidente Prudente | 3541406 | regra_com_ato | 1 | confirmado |
| SP | Rio Claro | 3543907 | regra_com_ato | 1 | confirmado |
| SP | Rio Grande da Serra | 3544103 | regra_com_ato | 0 | não |
| SP | Rosana | 3544251 | regra_com_ato | 1 | não |
| SP | Santa Branca | 3546009 | regra_com_ato | 1 | não |
| SP | Santa Bárbara d'Oeste | 3545803 | regra_com_ato | 0 | não |
| SP | Santo Expedito | 3548302 | regra_com_ato | 1 | não |
| SP | Serrana | 3551504 | regra_com_ato | 0 | não |
| SP | São Bento do Sapucaí | 3548609 | regra_com_ato | 1 | não |
| SP | São Caetano do Sul | 3548807 | regra_com_ato | 0 | não |
| SP | São José dos Campos | 3549904 | regra_com_ato | 0 | não |
| SP | São Luiz do Paraitinga | 3550001 | regra_com_ato | 2 | não |
| SP | São Manuel | 3550100 | regra_com_ato | 1 | não |
| SP | São Pedro | 3550407 | regra_com_ato | 1 | não |
| SP | São Roque | 3550605 | regra_com_ato | 1 | não |
| SP | Tanabi | 3553401 | regra_com_ato | 1 | não |
| SP | Tatuí | 3554003 | regra_com_ato | 1 | confirmado |
| SP | Taubaté | 3554102 | regra_com_ato | 1 | corrigido |
| SP | Valinhos | 3556206 | regra_com_ato | 2 | corrigido |
| SP | Vinhedo | 3556701 | regra_com_ato | 1 | não |
| SP | Vista Alegre do Alto | 3556909 | regra_com_ato | 1 | confirmado |
| SP | Votorantim | 3557006 | regra_com_ato | 1 | confirmado |
| SP | Votuporanga | 3557105 | regra_com_ato | 2 | confirmado |
| SP | Águas da Prata | 3500402 | regra_com_ato | 1 | não |
| SP | Águas de São Pedro | 3500600 | regra_com_ato | 1 | não |

## Sem resultado

Adamantina (SP, 3500105), Américo Brasiliense (SP, 3501707), Artur Nogueira (SP, 3503802), Bariri (SP, 3505203), Campo Limpo Paulista (SP, 3509601), Colina (SP, 3512001), Conchas (SP, 3512308), Dracena (SP, 3514403), Embu-Guaçu (SP, 3515103), Guapiaçu (SP, 3517505), Ituverava (SP, 3524105), Jardinópolis (SP, 3525102), Mococa (SP, 3530508), Monte Azul Paulista (SP, 3531506), Morro Agudo (SP, 3531902), Palmital (SP, 3535309), Pereira Barreto (SP, 3537404), Saltinho (SP, 3545159), Socorro (SP, 3552106)
