# penaestrada.com.br — páginas de restrição de caminhões (Sudeste)

Gerado em 2026-10-10 por `penaestrada_coleta.py` (mesma pasta). Dados: `penaestrada.json` ({ibge: {...}}, 1.668 municípios + `_meta`).
Compilação de terceiros (Trucão / Pé na Estrada). Serve **só como pista**; regra ativa exige ato primário vigente.

## Como foi feito
- Índice completo do site: `restricoes-sitemap.xml` e o seletor "Selecione um município" de /restricoes/ trazem as mesmas 53 páginas (nenhuma divergência). Não há API REST para esse tipo de página.
- Baixadas só as páginas do índice (1,5 s entre pedidos, User-Agent identificado); HTML guardado em `penaestrada_raw/pages/` (rodar o script de novo reaproveita o cache).
- Controle: 24 slugs prováveis de cidades grandes fora do índice (Campinas, Santos, BH, Vitória, Niterói...) deram 404; os controles positivos (São Paulo, Rio, Guarulhos) deram 200. Não vale sondar os 1.668 slugs.
- Notícias do site (REST `wp/v2/posts?search=`, 8 buscas) ligadas a município **à mão** (o casamento automático por nome no título dava falso positivo).

## Números
- Municípios do Sudeste com página: **48** (RJ 1, SP 47); MG e ES: nenhuma. Os outros 1620 têm `existe_pagina: false`.
- Fora do Sudeste no índice: florianopolis, fortaleza-capital, maceio-capital, manaus, salvador.
- A página diz que **há restrição**: 19; diz **"Não possui restrições"**: 29.
- Datas (lastmod do sitemap): de 2018-09-11 a 2019-07-16. São dados de 2018-2019, sem atualização desde então.
- Nenhuma página cita lei, decreto, portaria nem link de fonte: os campos são Contato, Telefone, Tipo de Caminhão, horários (seg-sex, sáb, dom/feriados), "Tem Cartão Caminhão?" e Trechos.
- 10 das páginas "não possui" têm contato genérico (Detran/Ciretran/não informado; várias com o telefone geral do Detran-SP (11) 3322-3333): ausência fraca, não prova que não há regra.
- Casamento incerto: `janiru` (site) ligado a Jarinu (3525201). `agua-da-prata` ligado a Águas da Prata (3500402); o contato da página cita "Prefeitura de Águas da Prata".

## Páginas que dizem haver restrição
| IBGE | Município | Seg-Sex | Sáb | Dom/Fer | Tipo | Trechos (início) | Data | Já no repo |
|---|---|---|---|---|---|---|---|---|
| 3503901 | Arujá | 24h | 24h | 24H | Não especificado | Av. Governador Mário Covas Jr; Av. dos Expedicionários; Estrada de Sa… | 2019-02-14 | sim |
| 3504107 | Atibaia | 09h - 18h | 09h - 14h | Livre | Não especificado | Rua João Pires; Rua Lourenço Franco; Rua Castro Fafe; Rua Monsenhor K… | 2019-02-14 | não |
| 3507605 | Bragança Paulista | 7h - 22h | Livre | Livre | Não especificado | Av. Dom Pedro I; Av. dos Imigrantes entre a Praça Nove de Julho e a r… | 2019-02-14 | não |
| 3509007 | Caieiras | 24h | 24h | 24h | Não especificado | Rua João Dartora ou Rua Waldemar Gomes Marino; Av. Prof. Carvalho Pin… | 2019-02-14 | sim |
| 3509205 | Cajamar | 6h - 20h | Livre | Livre | Não especificado | Av. Tenente Marques. | 2018-09-11 | sim |
| 3513801 | Diadema | 6h - 20h | 6h - 14h | Livre | VUC acima de 2,20 de largura e aci… | Rua São Manoel ◉ Rua Santo Antônio ◉ Rua São Francisco de Assis ◉ Rua… | 2018-09-11 | sim |
| 3518800 | Guarulhos | 8h às 20h |  | Livre | Não especificado | Toda região central de guarulhos | 2019-05-20 | sim |
| 3522208 | Itapecerica da Serra | 05h - 21h | 05h - 14h | Livre | Não especificado | Avenida XV de Novembro ◉ Rua Manoel Maximino da Rosa ◉ Rua 13 de Maio… | 2018-09-11 | sim |
| 3522505 | Itapevi | 16h - 20h | 7h - 14h | Livre | Não especificado | Av. Feres Nacif Chaluppe ◉ Av. Rubens Caramez ◉ Av. Brasil; Rua Pedro… | 2018-09-11 | não |
| 3523107 | Itaquaquecetuba | 24h | 24h | 24h |  | Vila Japão ◉ Vila Maria Augusta ◉ Centro | 2018-09-11 | não |
| 3523404 | Itatiba | 18h - 10h | Livre | Livre |  | Rua Benjamin Constant ◉ Rua Tobias Franco ◉ Rua Quintino Bocaiúva ◉ R… | 2018-09-11 | não |
| 3526209 | Juquitiba | 24h | Livre | Livre | 3 ou 4 eixos | Estrada Marcia Maria de Jesus. | 2018-09-11 | não |
| 3528502 | Mairiporã | 6h - 20h | 6h - 20h | Livre | restrição por placa; placas PARES … | Em toda área urbana do município. | 2018-09-11 | sim |
| 3539806 | Poá | 24h | Livre | Livre |  | Rua Padre Eustáquio e Av. Nove de Julho. | 2018-09-11 | não |
| 3304557 | Rio de Janeiro | 6h às 10h e 17h às 21h |  |  |  | • Av. Francisco Bicalho;; • Av. Francisco Eugênio;; • Av. Bartolomeu … | 2019-05-30 | sim |
| 3552502 | Suzano | 07h - 21h | 07h - 21h | Livre |  | Rua Whashington Luiz; Rua José da Costa Conceição ◉ Rua General Franc… | 2018-09-11 | sim |
| 3548807 | São Caetano do Sul | 06h - 22h | Livre | Livre |  | Av. Goiás e território central do município. | 2018-09-11 | não |
| 3550308 | São Paulo | 05h - 21h | 10h - 14h | Livre | Variado - consulte o mapa | Laranja – proibido o trânsito de caminhões (VUC liberado).; Trechos: … | 2018-09-11 | sim |
| 3500402 | Águas da Prata | Não | das 6h às 20h | das 6h às 20h | Acima de 5 toneladas | Avenida Washington Luiz | 2019-07-16 | não |

## Páginas que dizem "Não possui restrições"
Barueri (3505708, contato genérico), Biritiba Mirim (3506607), Bom Jesus dos Perdões (3507100), Campo Limpo Paulista (3509601, contato genérico), Carapicuíba (3510609), Cotia (3513009), Embu-Guaçu (3515103), Ferraz de Vasconcelos (3515707), Francisco Morato (3516309, contato genérico), Franco da Rocha (3516408, contato genérico), Guararema (3518305), Itupeva (3524006, contato genérico), Jandira (3525003, contato genérico), Jarinu (3525201), Joanópolis (3525508, contato genérico), Jundiaí (3525904, contato genérico), Louveira (3527306), Morungaba (3532009), Pedra Bela (3536802), Pinhalzinho (3538204), Piracaia (3538600), Pirapora do Bom Jesus (3539103), Salesópolis (3545001), Santa Isabel (3546801, contato genérico), São Lourenço da Serra (3549953), Tuiuti (3554953), Vargem (3556354), Vargem Grande Paulista (3556453), Várzea Paulista (3556503, contato genérico).

## Notícias do site ligadas a município (pistas secundárias)
- Rio de Janeiro (3304557), 2024-03-18: [Caminhão liberado na Avenida Brasil](https://penaestrada.com.br/caminhao-liberado-na-avenida-brasil/). corpo: Av. Brasil LIBERADA para caminhões (restrição revertida, mar/2024)
- Rio de Janeiro (3304557), 2024-03-11: [Prefeitura do Rio adia início da restrição de caminhões na Avenida Brasil](https://penaestrada.com.br/prefeitura-do-rio-adia-inicio-da-restricao-de-caminhoes-na-avenida-brasil/). corpo: CET-Rio/COR — restrição na Av. Brasil (pista central 4h-22h Irajá-Caju; laterais) ADIADA em mar/2024
- Santos (3548500), 2024-08-23: [Caminhões poderão ser proibidos de entrar no Porto de Santos sem agendamento](https://penaestrada.com.br/caminhoes-poderao-ser-proibidos-de-entrar-no-porto-de-santos-sem-agendamento/). título: acesso ao Porto de Santos com agendamento (ago/2024) — não é regra de circulação municipal
- São Paulo (3550308), 2026-04-29: [Rodízio de caminhões será suspenso no feriado, mas rodovias federais terão restrições](https://penaestrada.com.br/rodizio-caminhoes-suspenso-feriado/). corpo cita Prefeitura de SP/CET: rodízio municipal (inclui caminhões) suspenso no feriado de 1º/05/2026
- São Paulo (3550308), 2025-12-22: [Rodízio de carros deixa de valer hoje em São Paulo, mas segue normalmente para caminhões](https://penaestrada.com.br/rodizio-carros-sao-paulo-caminhoes/). título: rodízio de carros suspenso, mas segue para caminhões (dez/2025)
- São Paulo (3550308), 2025-07-08: [Veja como funcionará a circulação de caminhões para este feriado em São Paulo](https://penaestrada.com.br/circulacao-caminhoes-feriado-sao-paulo/). título: circulação de caminhões no feriado em São Paulo (jul/2025)
- São Paulo (3550308), 2025-05-16: [Muda o horário de restrição para caminhões com carga perigosa](https://penaestrada.com.br/muda-restricao-caminhoes-carga-perigosa/). corpo: nota da CET — ZMRC ampliada desde dez/2024 na Marginal Tietê e mini-anel (seg-sex 4h-10h e 16h-22h; sáb 10h-14h) e produtos perigosos 7h-10h/17h-20h; cita cetsp.com.br
- São Paulo (3550308), 2024-07-10: [O rodízio vale para o cavalo mecânico ou implemento?](https://penaestrada.com.br/o-rodizio-vale-para-o-cavalo-mecanico-ou-implemento/). corpo: rodízio municipal de SP para cavalo mecânico/implemento, resposta da CET; cita cetsp.com.br
- São Paulo (3550308), 2024-05-23: [Atenção: caminhões não estão liberados do rodízio de placas em São Paulo](https://penaestrada.com.br/atencao-caminhoes-nao-estao-liberados-do-rodizio-de-placas-em-sao-paulo/). título: caminhões não liberados do rodízio de placas (mai/2024)
- São Paulo (3550308), 2021-12-21: [Rodízio segue valendo para veículos pesados na cidade de São Paulo](https://penaestrada.com.br/rodizio-segue-valendo-para-veiculos-pesados-na-cidade-de-sao-paulo/). título: rodízio segue para veículos pesados (dez/2021)
- São Paulo (3550308), 2021-03-19: [Caminhões não estão incluídos no novo rodízio da cidade de São Paulo](https://penaestrada.com.br/caminhoes-nao-estao-incluidos-no-novo-rodizio-da-cidade-de-sao-paulo/). título: caminhões fora do novo rodízio (mar/2021)
- São Paulo (3550308), 2020-03-19: [São Paulo libera circulação de caminhões por tempo indeterminado](https://penaestrada.com.br/sao-paulo-libera-circulacao-de-caminhoes-por-tempo-indeterminado/). título: SP libera circulação de caminhões por tempo indeterminado (mar/2020) — corpo não lido; verificar se foi medida temporária
- São Paulo (3550308), 2020-02-17: [Chuva em SP: restrições para caminhão valem em dia de enchente?](https://penaestrada.com.br/chuva-em-sp-restricoes-para-caminhao-valem-em-dia-de-enchente/). título: restrições para caminhão em dia de enchente (fev/2020)
- São Paulo (3550308), 2019-07-08: [Confira as restrições de veículos em SP durante feriado](https://penaestrada.com.br/confira-as-restricoes-de-veiculos-em-sp-durante-feriado/). título: restrições de veículos em SP durante feriado (jul/2019)
- São Paulo (3550308), 2019-02-21: [Fim de rodízio de VUCs pode aquecer venda de implementos](https://penaestrada.com.br/fim-de-rodizio-de-vucs-pode-aquecer-venda-de-implementos/). corpo: VUCs isentos de rodízio desde dez/2018 por decreto (número não citado)
- São Paulo (3550308), 2019-01-24: [Aniversário de São Paulo: rodízio municipal e restrições serão suspensas](https://penaestrada.com.br/aniversario-de-sao-paulo-rodizio-municipal-e-restricoes-serao-suspensas/). título: rodízio e restrições suspensos no aniversário de SP (jan/2019)
- São Paulo (3550308), 2018-12-27: [VUC é liberado de rodízio em São Paulo](https://penaestrada.com.br/vuc-e-liberado-de-rodizio-em-sao-paulo/). título: VUC liberado do rodízio (dez/2018)
- Águas da Prata (3500402), 2019-07-16: [Prefeitura e Renovias disputam restrição para caminhões na SP 342](https://penaestrada.com.br/prefeitura-e-renovias-disputam-restricao-para-caminhoes-na-sp-342/). corpo: decreto de jul/2019 de Águas da Prata (>5 t, 6h-20h sáb/dom/feriados; Av. Washington Luiz e SP-342); liminar da Justiça (São João da Boa Vista) liberou o trecho da SP-342; cita g1

## Limitações
- Dados de terceiros e de 2018-2019; horários e vias podem ter mudado (ex.: SP ampliou a ZMRC da Marginal Tietê em dez/2024, segundo nota da CET reproduzida no site).
- `diz_possui_restricao`, `horarios_citados`, `menciona_vuc` e `atos_citados_texto` saem de heurística sobre o texto; o texto literal está em `campos` e `texto_completo`.
- `ja_coberto_no_repo` = `cidades/ja_cobertos.txt` + arquivos `data/raw/municipios/<ibge>.json` do repo no momento da coleta + São Paulo (ZMRC no núcleo).
