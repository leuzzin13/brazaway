# Resumo da pesquisa municipal — Sul e Centro-Oeste

Gerado por `consolidar_final.py` em 2026-10-18. Municípios em `municipios.csv`: 1659; com resultado em `res/`: **1659**; gravados no fechamento por falta de resultado: **0**.

Status: `regra_com_ato` = ato primário achado (a regra só entra no app se `ativa`); `regra_sem_ato` = restrição conhecida sem ato lido; `pista`/`pontual` = indício ou restrição pontual sem regra ativa; `sem_restricao_declarada` = fonte oficial diz que não há/foi revogada; `nao_achou` = nada encontrado.

## Por status

| Status | Cidades |
|---|---|
| nao_achou | 1367 |
| regra_com_ato | 147 |
| pontual | 88 |
| pista | 40 |
| regra_sem_ato | 12 |
| sem_restricao_declarada | 5 |
| **total** | **1659** |

Por nível de busca: dirigida: 605, r3_fonte_municipal: 368, varredura_profunda_diario: 250, r6_sigpub_profunda: 211, profunda: 74, media: 74, varredura_consolidada: 68, softcam_camara: 6, profundo: 3

Cidades com pelo menos uma regra **ativa**: **70** (92 regras ativas). Cidades sem regra ativa (em `varredura_final.json`): **1589**. Com `falha_de_fonte` (negativo não conclusivo): **410**.

## Por UF

| UF | nao_achou | regra_com_ato | pontual | pista | regra_sem_ato | sem_restricao_declarada | total | com regra ativa | falha de fonte |
|---|---|---|---|---|---|---|---|---|---|
| DF | 0 | 1 | 0 | 0 | 0 | 0 | 1 | 1 | 0 |
| GO | 231 | 5 | 3 | 3 | 2 | 2 | 246 | 3 | 76 |
| MS | 57 | 12 | 2 | 8 | 0 | 0 | 79 | 6 | 21 |
| MT | 101 | 22 | 15 | 3 | 1 | 0 | 142 | 8 | 15 |
| PR | 321 | 44 | 19 | 5 | 8 | 2 | 399 | 21 | 112 |
| RS | 462 | 18 | 12 | 4 | 1 | 0 | 497 | 9 | 165 |
| SC | 195 | 45 | 37 | 17 | 0 | 1 | 295 | 22 | 21 |

## Verificação

Arquivos em `verif/`: 150. Vereditos por cidade: corrigido: 74, confirmado: 72, rebaixada: 3, inverificavel: 1. Vereditos por regra: confirmado: 187, corrigido: 86, rebaixada: 5, inverificavel: 2, refutado: 1. Cidades com regra ativa ainda sem verificação: **0**. As correções do verificador já estão aplicadas nos `res/` (regras rebaixadas ficaram `desativada`).

## Cidades com regra ativa verificada

| UF | Município | IBGE | Status | Regras ativas | Veredito (verif/) | Regras |
|---|---|---|---|---|---|---|
| DF | Brasília | 5300108 | regra_com_ato | 2 | confirmado | Brasilia: Decreto 32.563/2010, art. 2, vedacao de veiculos pesados no ; Brasilia: DER-DF Instrucao 3/2019, Barragem do Paranoa (DF-001, EPCT): |
| GO | Goiânia | 5208707 | regra_com_ato | 1 | corrigido | Goiania: Portaria 224/2011-AMT (arts. 2, 3 e 7; art. 3 com redacao da  |
| GO | Luziânia | 5212501 | regra_com_ato | 2 | confirmado | Luziania: Lei 3.073/2007, trafego de onibus, caminhoes e carretas proi; Luziania: Lei 1.579/1993, trafego de caminhoes e carretas proibido nas |
| GO | Santa Helena de Goiás | 5219308 | regra_com_ato | 1 | confirmado | Santa Helena de Goiás: Alameda Hildebrando Domingues da Silva (entre o |
| MS | Aparecida do Taboado | 5001003 | regra_com_ato | 1 | corrigido | Aparecida do Taboado: veículos com mais de 18 t de carga útil e/ou alt |
| MS | Campo Grande | 5002704 | regra_com_ato | 7 | confirmado | Campo Grande AR: caminhão simples (toco) PBT 10,1 a 16 t; Campo Grande AR: caminhão truck (eixo duplo/tandem) PBT 16,1 a 24 t; Campo Grande AR: veículo pesado articulado PBT acima de 16 t; Campo Grande ARM: caminhão simples (toco) PBT 10,1 a 16 t; Campo Grande ARM: caminhão truck (eixo duplo) PBT 16,1 a 24 t; Campo Grande ARM: veículo pesado articulado PBT acima de 16 t; Campo Grande: Rua 14 de Julho (Av. Fernando Corrêa da Costa a Av. Mato |
| MS | Eldorado | 5003751 | regra_com_ato | 1 | confirmado | Eldorado: proibido trânsito de caminhões pesados na Rua Iguatemi entre |
| MS | Sidrolândia | 5007901 | regra_com_ato | 1 | confirmado | Sidrolândia: proibido trânsito de caminhões, carretas e bitrem na Av.  |
| MS | São Gabriel do Oeste | 5007695 | regra_com_ato | 1 | corrigido | São Gabriel do Oeste: proibido o trânsito de veículos de grande porte  |
| MS | Três Lagoas | 5008305 | regra_com_ato | 1 | confirmado | Três Lagoas: proibição de trânsito de caminhões de carga com PBT acima |
| MT | Cuiabá | 5103403 | regra_com_ato | 1 | confirmado | Cuiabá: Lei 5.463/2011, Zona de Restrição Máxima (ZRM), caminhões acim |
| MT | Feliz Natal | 5103700 | regra_com_ato | 1 | confirmado | Avenida Maravilha: trânsito e estacionamento de veículos pesados > 5 t |
| MT | Lucas do Rio Verde | 5105259 | regra_com_ato | 1 | confirmado | Av. das Acácias (MT-449 a Linha 5): veículos acima de três eixos proib |
| MT | Nova Monte Verde | 5108956 | regra_com_ato | 1 | corrigido | Avs. Mato Grosso e Genésio Alves da Fonseca e entorno da Praça da Bíbl |
| MT | Nova Xavantina | 5106257 | regra_com_ato | 1 | confirmado | Nova Xavantina: Avenida Beira Rio (Setor Nova Brasília), trânsito de c |
| MT | Santo Antônio de Leverger | 5107800 | regra_com_ato | 1 | confirmado | Santo Antônio de Leverger: Av. Américo Pinto Brasil (trecho), Rua Amil |
| MT | Sinop | 5107909 | regra_com_ato | 2 | confirmado | Sinop: Avenida Nelson Moggi, veículos de carga acima de 8 t; Sinop: prolongamento da Avenida das Figueiras, veículos de carga acima |
| MT | São José do Rio Claro | 5107305 | regra_com_ato | 1 | confirmado | Avenida Siegfried Buss (antiga Av. Brasil): veículos > 15 t (Lei 1.238 |
| PR | Almirante Tamandaré | 4100400 | regra_com_ato | 1 | confirmado | Avenida Emílio Johnson (Centro): caminhões acima de 10 t (Decreto 968/ |
| PR | Balsa Nova | 4102307 | regra_com_ato | 1 | confirmado | Estrada Municipal Atílio Ramos: proibido caminhões com 4 eixos ou mais |
| PR | Campo Mourão | 4104303 | regra_com_ato | 1 | confirmado | Perímetro da Zona Central – veículos de carga > 16 t PBT ou > 8 m (Lei |
| PR | Campo do Tenente | 4104105 | regra_com_ato | 1 | confirmado | Ruas Olívio Belich e Augustinho Tiburski: proibido caminhões com PBT a |
| PR | Curitiba | 4106902 | regra_com_ato | 2 | confirmado | Zona Central de Tráfego de Curitiba (Decreto 934/1997); BR-476 (Linha Verde) km 120,9 a 142,8 — veículos de carga acima de 10  |
| PR | Goioxim | 4108650 | regra_com_ato | 1 | confirmado | Vias centrais de Goioxim: proibida a circulação de veículos de carga ( |
| PR | Irati | 4110706 | regra_com_ato | 1 | confirmado | Estrada vicinal BR-277 a Caratuva II (2,28 km): caminhões com 4 eixos  |
| PR | Mamborê | 4114005 | regra_com_ato | 1 | confirmado | Vias centrais de Mamborê: proibido o tráfego de caminhões (e maquinári |
| PR | Mandaguari | 4114203 | regra_com_ato | 1 | confirmado | Área Central de Tráfego: veículos > 7 t e/ou > 7 m proibidos 9h-18h30  |
| PR | Maringá | 4115200 | regra_com_ato | 2 | confirmado | Maringá: área central (Anexo I da LC 660/2007), veículos de carga acim; Maringá: Av. Morangueira entre Av. Colombo e Contorno Norte, veículos  |
| PR | Matinhos | 4115705 | regra_com_ato | 1 | confirmado | Av. Atlântica (Rua Ipiranga a Rua Itacolomi): veículos > 7 t PBT ou >  |
| PR | Morretes | 4116208 | regra_com_ato | 1 | confirmado | Estrada de Barreiros: proibido trânsito de caminhões exceto classes 2C |
| PR | Palmas | 4117602 | regra_com_ato | 1 | corrigido | Anel viário central de Palmas: caminhões pesados (Lei 2293/2015) |
| PR | Palmeira | 4117701 | regra_com_ato | 1 | confirmado | Ruas Eugênio Nogueira dos Santos e Gustavo Marcondes Zanardini (Bairro |
| PR | Paranaguá | 4118204 | regra_com_ato | 1 | corrigido | Zona de tráfego de veículos pesados da Ilha dos Valadares (Decreto 5.5 |
| PR | Paraíso do Norte | 4118006 | regra_com_ato | 1 | confirmado | Avenida Tapejara: veículos pesados com PBT acima de 14 t (Lei 346/2018 |
| PR | Pato Branco | 4118501 | regra_com_ato | 1 | confirmado | Centro (área do ESTAR, Anexo I): proibida circulação, parada e estacio |
| PR | Pitangueiras | 4119657 | regra_com_ato | 1 | confirmado | Perímetro Central de Pitangueiras (Av. Central e Ruas 7 de Setembro, O |
| PR | Sarandi | 4126256 | regra_com_ato | 1 | confirmado | Vias com proibição a veículos acima de 22 t PBT (Decreto 307/2021) |
| PR | Telêmaco Borba | 4127106 | regra_com_ato | 1 | confirmado | Área Central de Tráfego - circulação de veículos acima de 7 t e/ou 7 m |
| PR | Ventania | 4128534 | regra_com_ato | 1 | confirmado | Restrição a caminhões >=16 t, bitrens e treminhões em vias urbanas da  |
| RS | Caxias do Sul | 4305108 | regra_com_ato | 1 | confirmado | Área de Restrição de Circulação de Caminhões (centro, interior do Prim |
| RS | Chuí | 4305439 | regra_com_ato | 1 | corrigido | Avenida Samuel Prilliac: caminhões e veículos pesados proibidos em tod |
| RS | Passo Fundo | 4314100 | regra_com_ato | 2 | confirmado | Area central de Passo Fundo: caminhoes > 7 t PBT proibidos das 10h as ; Av. Brasil, Av. Presidente Vargas e Av. Moacir da Motta Fortes: caminh |
| RS | Sant'Ana do Livramento | 4317103 | regra_com_ato | 1 | confirmado | Sant'Ana do Livramento: Lei 965/1972 (art. 1º red. Lei 2.757/1990) |
| RS | São Francisco de Paula | 4318200 | regra_com_ato | 1 | confirmado | Av. Júlio de Castilhos (Rua Cel. Serrano a Rua Benjamin Constant) - ve |
| RS | São Jerônimo | 4318408 | regra_com_ato | 2 | confirmado | Av. Ramiro Barcelos, Av. Rio Branco (Rua Flores da Cunha a Rua Marecha; Vias arteriais de São Jerônimo (Av. Dr. José Athanásio, Rua Gal. Osóri |
| RS | São José dos Ausentes | 4318622 | regra_com_ato | 1 | confirmado | Av. Ismenia Batista Ribeiro Velho (toda a extensao): caminhoes acima d |
| RS | São Sebastião do Caí | 4319505 | regra_com_ato | 1 | confirmado | Zona central de São Sebastião do Caí - proibido trânsito de veículos p |
| RS | Vacaria | 4322509 | regra_com_ato | 1 | corrigido | Vacaria: circulação de caminhões acima de 9 t (PBT) das 10h às 15h em  |
| SC | Abelardo Luz | 4200101 | regra_com_ato | 1 | confirmado | Avenida Getúlio Vargas (perímetro urbano): proibido tráfego de veículo |
| SC | Balneário Rincão | 4220000 | regra_com_ato | 2 | corrigido | Balneário Rincão: Dec. 057/2020, proibido veículo de carga com mais de; Balneário Rincão: Dec. 160/2024, proibido trânsito de caminhões na Av. |
| SC | Botuverá | 4202701 | regra_com_ato | 1 | confirmado | Botuverá: Rua João Assini, Dec. 3.213/2023, proibida a circulação de c |
| SC | Calmon | 4203154 | regra_com_ato | 1 | confirmado | 15 ruas do perímetro urbano de Calmon: PBT/PBTC > 23 t proibido (Decre |
| SC | Campos Novos | 4203600 | regra_com_ato | 1 | confirmado | Campos Novos: Decreto 7.560/2016, proibição de trânsito de veículos co |
| SC | Cocal do Sul | 4204251 | regra_com_ato | 1 | corrigido | Cocal do Sul: Decreto SAF 322/2019, proibida a entrada, parada, estaci |
| SC | Correia Pinto | 4204558 | regra_com_ato | 1 | confirmado | Correia Pinto: Lei 1361/2005 - Av. Tancredo Neves (Rua Ema Sevei a Rua |
| SC | Gaspar | 4205902 | regra_com_ato | 1 | corrigido | Gaspar: Decreto 7.588/2017 - travessia da Ponte Hercílio Deeke limitad |
| SC | Irineópolis | 4207908 | regra_com_ato | 1 | confirmado | Irineópolis: Dec. 3.314/2017, proibido tráfego de caminhões com PBT >  |
| SC | Joinville | 4209102 | regra_com_ato | 1 | confirmado | Joinville: Área Central, circulação de veículos com capacidade de carg |
| SC | Laguna | 4209409 | regra_com_ato | 1 | corrigido | Laguna: Lei 2.073/2019, proibido o tráfego de caminhões e combinações  |
| SC | Macieira | 4210050 | regra_com_ato | 1 | confirmado | Área central de Macieira: caminhões só 08h-18h em dias úteis; sábado l |
| SC | Maracajá | 4210407 | regra_com_ato | 1 | confirmado | Bairro São Cristóvão: Ruas Antônio Alípio Gabriel, Santino Manoel da S |
| SC | Morro da Fumaça | 4211207 | regra_com_ato | 6 | corrigido | Rua 20 de Maio (trecho), Rua José Cechinel (trecho) e Rua Prefeito Ver; Rua Euclides Piva e Rua Genoveva Guglielmi Bortolatto: proibido PBT ac; Rua João de Rocchi (Distrito de Estação Cocal): proibido PBT acima de ; Rua Santo Antônio e Rua Professor Paschoal Zaccaron (Distrito de Estaç; Rodovia municipal Líbero Fortunato: proibido PBT acima de 35 t, bitrem; Rua José Cechinel, Rua Vanteiro Margotti e Rua Urussanga: proibido bit |
| SC | Nova Veneza | 4211603 | regra_com_ato | 2 | corrigido | Nova Veneza: Dec. 187/2020, proibido o trânsito de veículos com PBT > ; Nova Veneza: Dec. 457/2019, proibido o trânsito de veículos com PBT >  |
| SC | Paulo Lopes | 4212304 | regra_com_ato | 1 | corrigido | Cinco logradouros de Sorocaba, Morro do Freitas, Areias e Tigela: cami |
| SC | Porto Belo | 4213500 | regra_com_ato | 3 | corrigido | Porto Belo/Tijucas: Ponte sobre o Rio Santa Luzia, proibição de PBT > ; Porto Belo: Dec. 2.289/2019, proibido o trânsito de veículos com mais ; Porto Belo: Dec. 2.289/2019, proibido o trânsito de veículos com mais  |
| SC | Seara | 4217501 | regra_com_ato | 1 | corrigido | Seara: Lei 2.218/2023 art. 2, II, descida do Contorno Viario pela Rua  |
| SC | Turvo | 4218806 | regra_com_ato | 1 | corrigido | Turvo: Dec. 68/2023 art. 1, II, proibido tráfego de caminhões e veícul |
| SC | Videira | 4219309 | regra_com_ato | 1 | corrigido | Videira: Lei 2.685/2011, proibido o trânsito de caminhão-trator articu |
| SC | Vitor Meireles | 4219358 | regra_com_ato | 1 | corrigido | Vitor Meireles/Itaiópolis: Ponte Denecke (Rio Hercílio/Itajaí Norte),  |
| SC | Xaxim | 4219705 | regra_com_ato | 1 | corrigido | Vias centrais de Xaxim: veículos com PBT acima de 10 t restritos (11 t |

## Cidades onde a fonte falhou

410 cidades com `falha_de_fonte=true` (lista completa com motivo em `falhas_de_fonte.json`).

| Motivo (classificação aproximada) | Cidades |
|---|---|
| portal bloqueado ao IP da nuvem (403/Cloudflare/Akamai) | 256 |
| sem legislação municipal pesquisável online | 72 |
| outras (diário/API instável, portal próprio não varrido) | 42 |
| portal sem cliente automático (JS, login, reCAPTCHA) | 40 |

Por UF: GO 76, MS 21, MT 15, PR 112, RS 165, SC 21

Por sistema de legislação (triagem): não mapeado 156, portal_proprio 64, cespro 46, nucleogov 45, leismunicipais 37, nao_encontrado 18, webline 11, sapl 10, desconhecido 9, atende 5, 1doc 5, cittatec 1, sinsoft 1, leisnaweb 1, instar 1

Com achado parcial e fonte falha (prioridade para refazer):

- Atalaia (PR, 4102208): pontual
- Cascavel (PR, 4104808): regra_sem_ato
- Curitiba (PR, 4106902): regra_com_ato
- Dois Vizinhos (PR, 4107207): pontual
- Foz do Iguaçu (PR, 4108304): regra_sem_ato
- Francisco Beltrão (PR, 4108403): pista
- Londrina (PR, 4113700): sem_restricao_declarada
- Palmas (PR, 4117602): regra_com_ato
- Paranaguá (PR, 4118204): regra_com_ato
- Ponta Grossa (PR, 4119905): pontual
- Umuarama (PR, 4128104): pontual
- Araranguá (SC, 4201406): pista
- Forquilhinha (SC, 4205456): pista
- Pomerode (SC, 4213203): pista
- Rio Rufino (SC, 4215059): pontual
- Alvorada (RS, 4300604): regra_com_ato
- Catuípe (RS, 4305009): pista
- Garibaldi (RS, 4308607): pontual
- Porto Alegre (RS, 4314902): regra_sem_ato
- Santo Ângelo (RS, 4317509): pontual
- Sapucaia do Sul (RS, 4320008): pontual
- Aquidauana (MS, 5001102): pista
- Brasilândia (MS, 5002308): regra_com_ato
- Chapadão do Sul (MS, 5002951): pista
- Costa Rica (MS, 5003256): pontual
- Dourados (MS, 5003702): pista
- Itaporã (MS, 5004502): pista
- Paranaíba (MS, 5006309): pontual
- Selvíria (MS, 5007802): pista
- Cuiabá (MT, 5103403): regra_com_ato
- Primavera do Leste (MT, 5107040): pista
- Rondonópolis (MT, 5107602): regra_sem_ato
- Sorriso (MT, 5107925): regra_com_ato
- Várzea Grande (MT, 5108402): pontual
- Goianira (GO, 5208806): pista
- Jataí (GO, 5211909): regra_sem_ato

## O que só pedido de LAI resolveria

Bloqueio de IP e portais com JS/reCAPTCHA se resolvem consultando da rede do usuário ou no navegador; não precisam de LAI. Precisam de pedido de acesso à informação (Lei 12.527/2011, e-SIC da prefeitura):

**A. Restrição conhecida sem ato primário lido (12)**: pedir número, texto e mapa/anexo do ato (decreto/portaria/resolução) que fundamenta a restrição divulgada.

- Jaraguá (GO, 5211800): Restrição real e com ato primário, mas sem vias/áreas delimitadas e sem o decreto de rotas (art. 6º da lei). Por isso regra desativada, status regra_sem_ato. Pendente: obter pelo p…
- Jataí (GO, 5211909): Restrição existe e é divulgada pela SMT, mas o ato primário (provável decreto/portaria da Superintendência Municipal de Trânsito) não foi achado: regra desativada. Pendências: núme…
- Rondonópolis (MT, 5107602): Há restrição municipal (ZRMC) mas o ato primário não pôde ser lido: status regra_sem_ato. Pendências: obter Lei 6.595/2011 e Portaria 074/2013 (leismunicipais via navegador, Dioron…
- Cascavel (PR, 4104808): Cascavel tem lei de Zona Central de Trafego com restricao de circulacao de veiculos pesados por area: Lei 6.164/2012 (ementa lida na listagem da Camara; revoga a Lei 2.707/97). Doc…
- Foz do Iguaçu (PR, 4108304): Foz disciplina carga e descarga de mercadorias pela Lei 3.133/2005 (28/11/2005; revogou a Lei 1.955/1995), alterada pela Lei 4.159/2013 (inciso III do art. 3: veiculos com capacida…
- Laranjal (PR, 4113254): Lei 20/2026 (AMP 13/08/2026), lida por trechos (arts. 1-6): marco legal para limitar PBT, PBTC e peso por eixo em vias, pontes e obras de arte municipais POR DECRETO, com estudo té…
- Paranavaí (PR, 4118402): Lei 5.437/2024 (Plano de Mobilidade, AMP 19/12/2024) lida integralmente: Seção VIII (Transporte de Carga), art. 36 prevê regulamentar a circulação de caminhões em determinadas vias…
- Paula Freitas (PR, 4118600): Regra condicional em lei sem decreto regulamentador localizado: fica como pista/desativada. Prefeitura (portal) não consultada por falta de cliente, mas o decreto seria publicado n…
- Porto Amazonas (PR, 4120101): Lei 843/2009 (Regulamenta estacionamento na Rua XV de Novembro e restringe o tráfego de veículo pesado nas ruas do perímetro urbano), na redação da Lei 1.043/2016 (AMP 22/03/2016, …
- Santo Antônio do Sudoeste (PR, 4124400): PISTA RELEVANTE. Lei 3506/2026, art. 31: "A circulação de caminhões com peso bruto total superior a 10 (dez) toneladas será integralmente proibida na Avenida Brasil e em, no mínimo…
- Turvo (PR, 4127965): [Lote R1-PR-DR03] Achado real vindo da DR: a LC 06/2022 institui 'rota permitida' para veículos de carga na sede e em Faxinal da Boa Vista, mas não traz proibição expressa fora da …
- Porto Alegre (RS, 4314902): A regra do Centro Histórico existe e é divulgada pela EPTC (fonte oficial de serviço) e pelo DOPA de 2011, mas o ATO PRIMÁRIO (decreto/resolução/portaria com número e artigo) NÃO f…

**B. Sem legislação municipal pesquisável online e sem diário varrido (63)**: pedir a lista de leis/decretos vigentes sobre circulação, peso ou horário de veículos de carga.

Niquelândia (GO, 5214606), Pilar de Goiás (GO, 5216908), Posse (GO, 5218300), Sítio d'Abadia (GO, 5220702), Terezópolis de Goiás (GO, 5221197), Coxim (MS, 5003306), Glória de Dourados (MS, 5004007), Itaquiraí (MS, 5004601), Nova Alvorada do Sul (MS, 5006002), Rio Negro (MS, 5007307), Alto Taquari (MT, 5100607), Canabrava do Norte (MT, 5102694), Jaciara (MT, 5104807), Alto Paraná (PR, 4100608), Barracão (PR, 4102604), Cornélio Procópio (PR, 4106407), Cruzeiro do Oeste (PR, 4106605), Cândido de Abreu (PR, 4104402), Esperança Nova (PR, 4107520), Floraí (PR, 4107801), Guairaçá (PR, 4108908), Imbituva (PR, 4110102), Jandaia do Sul (PR, 4112108), Laranjeiras do Sul (PR, 4113304), Mirador (PR, 4115903), Munhoz de Melo (PR, 4116307), Nova América da Colina (PR, 4116604), Nova Santa Bárbara (PR, 4117214), Ortigueira (PR, 4117305), Ourizona (PR, 4117404), Perobal (PR, 4118857), Porto Barreiro (PR, 4120150), Quedas do Iguaçu (PR, 4120903), Rosário do Ivaí (PR, 4122651), Santa Cecília do Pavão (PR, 4123204), Santa Tereza do Oeste (PR, 4124020), Santo Antônio do Caiuá (PR, 4124202), Santo Inácio (PR, 4124509), São Carlos do Ivaí (PR, 4124608), São Jorge d'Oeste (PR, 4125209), São Jorge do Ivaí (PR, 4125308), São Pedro do Ivaí (PR, 4125803), Terra Rica (PR, 4127304), Vera Cruz do Oeste (PR, 4128559), Wenceslau Braz (PR, 4128500), Arroio do Meio (RS, 4301008), Canguçu (RS, 4304507), Carlos Barbosa (RS, 4304804), Dom Pedrito (RS, 4306601), Esperança do Sul (RS, 4307450), Estrela (RS, 4307807), Estrela Velha (RS, 4307815), Forquetinha (RS, 4308433), Guabiju (RS, 4309258), Relvado (RS, 4315453), Roque Gonzales (RS, 4316303), Santa Tereza (RS, 4317251), Santo Antônio das Missões (RS, 4317707), Sério (RS, 4320453), Vista Alegre do Prata (RS, 4323606), Westfália (RS, 4323770), Faxinal dos Guedes (SC, 4205308), São João Batista (SC, 4216305)

## Divergências com o OSM

228 entradas em `osm_divergencias.json` (sem_ato: 222, contra_ato: 6); excluídas 121 (rodovias fora da competência municipal ou OSM não conferido).
