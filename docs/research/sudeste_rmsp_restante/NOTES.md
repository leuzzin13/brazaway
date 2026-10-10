# rmsp_restante — os 32 municípios da Grande SP ainda sem restrição mapeada
Data: 2026-10-10. Pasta: scratchpad/sudeste/rmsp_restante/ (~10 MB; PDFs grandes foram cortados para as páginas relevantes).
Escopo: RMSP menos {São Paulo, Osasco, Barueri, Guarulhos, Cajamar, Santana de Parnaíba, Ribeirão Pires} = 32 municípios
(a lista da pista repetia Itapecerica; os 32 são os da tabela abaixo).

Reaproveitado sem refazer: docs/research/restricoes_rmsp_municipios (NOTES.md, research.json, verify.json): cancelamento do ABC 2012,
GeoServer de Santo André (feiras livres), hierarquia viária de SBC, notícias de Cotia, cobertura do Querido Diário e o método de busca,
contagem OSM por município (osm/contagem_por_municipio.txt da rodada anterior), casamento de nomes com o OSM. Também o schema da camada
api/src/layers/restricoes_rmsp.layer.ts (Regra: alvo.qualquer[{campo,acima}], vuc, excecao_destino_local, sentido etc.).

## 1. Quadro por município (status em 10/10/2026)
Legenda: REGRA-ATO = ato primário lido; REGRA-OFICIAL = página/serviço/dado oficial da prefeitura sem o ato; PISTA = só imprensa ou
compilação de terceiros; PONTUAL = placa isolada; NÃO ACHOU = buscas negativas; SEM RESTRIÇÃO DECLARADA = prefeitura disse à imprensa que não há.

| Município | Status | Resumo |
|---|---|---|
| Arujá | REGRA-ATO | Dec. 8.183/2023: 10 vias; 24h/5h–23h59; PBT>31,5 t / PBTC>33,075 t em todas |
| Biritiba-Mirim | NÃO ACHOU | site sem WP/busca; QD nível 0; Pé na Estrada: "não possui" |
| Caieiras | REGRA-ATO (leis) | Lei 5.486/2021 (4 vias, exceto VUC); Lei 3.560/2004 (13 t e 12 m em todas as vias; perigosos proibidos); Lei 5.233/2019 rodízio par/ímpar (decreto de vias não achado); Lei 2.386/1994; Lei 3.237/2002 |
| Carapicuíba | NÃO ACHOU | Instar leis_decretos vazio; Pé na Estrada: "não possui" |
| Cotia | PONTUAL | rodada anterior (Estr. Velha de Cotia >2 eixos; R. Rio Maicure só VUC) |
| Diadema | REGRA-OFICIAL | portal e-Processo, serviço 55: 11 vias Centro + 3 Jd. Eldorado; >2,20 m ou >6,30 m; seg–sex 6–20h, sáb 6–14h |
| Embu das Artes | PONTUAL | conversão Av. Elias Yazbek → R. Muni Stemberg proibida a caminhão/ônibus (2025) |
| Embu-Guaçu | NÃO ACHOU | SAPL (2.428 normas) sem norma de caminhão; Pé na Estrada: "não possui" |
| Ferraz de Vasconcelos | SEM RESTRIÇÃO DECLARADA | prefeitura (Diário de Suzano 2022/2023/2025); só calçadão XV de Novembro (carga/descarga 9–22h) |
| Francisco Morato | NÃO ACHOU | QD nível 1; Pé na Estrada: "não possui" |
| Franco da Rocha | PONTUAL | R. Cel. Domingos Ortiz (subida) só leves (2015); WP sem ato; SETCESP "15 t" não confirmado |
| Guararema | SEM RESTRIÇÃO DECLARADA | só AET para excedentes (Diário de Suzano 2023/2025) |
| Itapecerica da Serra | REGRA-ATO | Dec. 2.184/2010 (Lei 2.162/2010): 4 vias, seg–sex 5–21h, sáb 5–14h, Cartão-Caminhão; radares de "restrição de veículos" nas mesmas vias (2023) |
| Itapevi | NÃO ACHOU (PISTA) | QD nível 3 (2019+): nada; Pé na Estrada lista 15 vias 16–20h/sáb 7–14h — não confirmado |
| Itaquaquecetuba | PISTA | Cartão-Caminhão (Vila Japão, Maria Augusta, Centro); site migrou (404/403) |
| Jandira | NÃO ACHOU | QD nível 3: 0 hits; Pé na Estrada: "não possui" |
| Juquitiba | PISTA | Pé na Estrada: Estr. Márcia(Martha) Maria de Jesus, 3–4 eixos, seg–sex; WP/SAPL sem nada |
| Mairiporã | REGRA (lei citada, texto não lido) | Lei 4.391/2025: >2 eixos e fretamento nas Av. Ver. Belarmino P. de Carvalho, Av. José Gianesella, Av. Sen. José Ermírio de Moraes |
| Mauá | REGRA-OFICIAL (parcial) | SEMOB: 3 pontos de fiscalização eletrônica de "restrição de circulação de veículos de carga"; regra (horário/peso) não achada |
| Mogi das Cruzes | REGRA-ATO + OFICIAL | Lei 2.903/1985 + Dec. 899/1985 (red. 1.782/2000) + Dec. 8.375/2008: área central (16 logradouros); prática: >3,5 t 10–20h |
| Pirapora do Bom Jesus | NÃO ACHOU | QD nível 0; Pé na Estrada: "não possui" |
| Poá | SEM RESTRIÇÃO HORÁRIA | placas em ruas estreitas do centro; Pé na Estrada: R. Padre Eustáquio e Av. Nove de Julho (não confirmado) |
| Rio Grande da Serra | NÃO ACHOU | WP: 3 posts sem relação; QD nível 0 |
| Salesópolis | NÃO ACHOU | Pé na Estrada: "não possui" |
| Santa Isabel | PISTA | Dec. 5.568: carga/descarga Av. da República 11–20h seg–sáb; VUC ≤7,30 m (imprensa); ato não lido |
| Santo André | CONFIRMOU QUE NÃO TEM (forte) | lista oficial de legislação de mobilidade (Observatório) sem restrição; QD sem ato; só feiras (WFS) |
| São Bernardo do Campo | NÃO ACHOU (forte) | QD 2017+ sem ato; Guia de Serviços sem cadastro/autorização de via restrita; Res. ST 004/2015 só cargas especiais |
| São Caetano do Sul | PISTA | 2 radares de "restrição de circulação de veículos" (Terminal Nicolau Delic; R. Manoel Coelho 536); Pé na Estrada: Av. Goiás e centro 6–22h — não confirmado |
| São Lourenço da Serra | NÃO ACHOU | Pé na Estrada: "não possui" |
| Suzano | REGRA-OFICIAL + DADO ESTRUTURADO ★ | ArcGIS FeatureService "MOB-Restrição trânsito de caminhões": 2 polígonos, seg–sáb 7–21h, perecíveis liberados |
| Taboão da Serra | REGRA-OFICIAL | todo o município seg–sex 5–21h, sáb 10–14h desde 06/12/2010; Cartão Caminhão ativo (Conam); ato não achado |
| Vargem Grande Paulista | NÃO ACHOU | Pé na Estrada: "não possui" |

Contagem: regra com ato lido 5 (Arujá, Caieiras, Itapecerica, Mogi, + Mairiporã só por ementa/imprensa); regra oficial sem ato 4 (Diadema, Suzano, Taboão, Mauá parcial);
pista 5 (Itaquá, Juquitiba, Santa Isabel, São Caetano, Itapevi); pontual 3 (Cotia, Embu, Franco); sem restrição declarada 3 (Ferraz, Guararema, Poá);
confirmou que não tem 1 (Santo André); não achou 11.

## 2. Detalhe das regras novas (texto conferido)
### Arujá — Dec. 8.183 de 08/03/2023 (regulamenta Lei 2.295/2010; revoga Dec. 5.557/2010)
PDF https://www.prefeituradearuja.sp.gov.br/Atos/Decretos/Livro110_OCR/DECRETO%208.183_2023_OCR.pdf (200, 4.884.769 B, 8 p.) → aruja/
- "Tipo caminhão" = caminhão, caminhão-trator, reboque, semirreboque (art. 1º par. ún.). Sem isenção de VUC (art. 7º §2º).
- Art. 8º I: 24h todos os dias, todas as vias do Anexo I, se PBT > 31.500 kg ou PBTC > 33.075 kg (par. ún.: exceto instalados no trecho ou passagem obrigatória).
- Art. 8º II: 24h todos os dias, incisos I, IV, V, VI, VII. Art. 8º III: 05:00–23:59 todos os dias, incisos II, III, VIII, IX, X.
- Anexo I: I R. Oscar Schiavon; II Av. Mário Covas (Av. Fatec → Estr. dos Vados, 2 sentidos); III Av. dos Expedicionários (sentido bairro/centro, Pça Narciso José Lopes →
  Rot. Dalila Ferreira Barbosa); IV Av. Amazonas (sentido bairro/centro); V Av. Hans Ossamu Suzuki; VI Av. Getúlio Vargas; VII Av. Antônio Afonso de Lima;
  VIII Al. Capelinha; IX R. Duque de Caxias; X R. Licínio Rodrigues de Paiva.
- Exceções por cadastro DMT (13 categorias do art. 7º §3º), validade 1 ano; emergência 30 dias. Radar (art. 17). Sistema de cadastro: /projeto/viaRestricao/login.php.
### Caieiras — leis da Câmara (texto consolidado no sistema camaraonline.org; decretos não indexados)
- Lei 5.486 de 22/06/2021: proíbe caminhão e carreta, EXCETO VUC (sem definição), nas R. Narciso Degrandi Ernesto, R. Esmeraldo Felipe Santiago, Av. David Kasitzky,
  Av. Rodolfo Polidoro (Vila Rosina). Sem horário (24h). Exceções: oficiais, concessionárias, entrega local com NF.
  https://camaraonline.org/cm_caieiras/doc_legis/2021/HTM/LEI5486_2021.htm (200)
- Lei 3.560 de 17/06/2004 (art. 4º red. Lei 3.780/2006): 13 t de "limite máximo para o transporte de cargas" e 12 m de comprimento máximo em TODAS as avenidas e ruas;
  proíbe produtos perigosos em todas as ruas; exceção por autorização especial do Depto de Trânsito. https://camaraonline.org/cm_caieiras/doc_legis/2004/HTM/LEI3560_2004.htm
  ("13 t de carga" é ambíguo: carga útil ou PBT; diagnóstico oficial de 2017 diz que a fiscalização é "mediante disponibilidade").
- Lei 5.233 de 18/09/2019: AUTORIZA rodízio de caminhão/carreta por final de placa (par em dia par, ímpar em dia ímpar), seg–sáb exceto feriados, 6h–20h, nas vias que um
  DECRETO especificar; isentos: placas de Caieiras, oficiais, serviços essenciais, entrega local com NF + cadastro DEMUTRAN. Decreto NÃO localizado (busca de decretos vazia).
- Lei 2.386/1994: 15 t nas "ruas centrais" (a listar por decreto). Lei 3.237/2002: proíbe caminhões de lixo/resíduos químicos e industriais na área central. Lei 4.358/2010:
  carga/descarga de empresas em área residencial só 6h–23h30.
- Pé na Estrada (2022) lista para Caieiras: R. João Dartora/R. Waldemar Gomes Marino, Av. Prof. Carvalho Pinto, Av. Paulicéia, Av. Maestro Luiz Milano Filho (pista para o decreto).
### Diadema — Portal de Atendimento (e-Processo), serviço 55 "CADASTRO DE CAMINHÕES PARA VIAS DE RESTRIÇÃO" (setor Processamento/Trânsito)
JSON público: https://eprocesso.diadema.sp.gov.br/externo-portal-backend/v1/servicos/55 (200) → diadema/servico55.json
- "Proibido o trânsito de caminhões que contenham medidas acima de 2,20 m de altura [sic, provavelmente largura] e acima de 6,30 de comprimento"; seg–sex 6h–20h, sáb 6h–14h.
- Centro: R. São Manoel, R. Santo Antonio, R. São Francisco de Assis, R. São Joaquim, R. São Jorge, Av. São José, R. Arthur Sampaio Moreira, R. Izaurino Lopes da Silva,
  R. São Judas Tadeu, Av. N. Sra. das Vitórias, Av. Santa Maria (com CEPs). Jd. Eldorado: Av. N. Sra. dos Navegantes, Av. Frei Ambrósio de Oliveira Luz, R. João Antônio de Araújo.
- Bate com SETCESP/A Tarde 2011 (11 vias). O decreto de 2011 não foi achado.
### Itapecerica da Serra — Dec. 2.184 de 27/12/2010 (art. 4º da Lei 2.162 de 14/12/2010)
PDF http://www.ecrie.com.br/sistema/conteudos/arquivo/arquivo_5_18102018164433.pdf (200, 42.606 B; servido pelo CMS do portal da prefeitura) → itapecerica/dec2184_2010.pdf
- Art. 1º: proíbe caminhões e carretas em toda a extensão de Av. XV de Novembro, R. Manoel Maximino da Rosa, R. Treze de Maio, Estr. Ary Domingues Mandu; seg–sex 5h–21h, sáb 5h–14h.
- Art. 2º exceções (com Cartão-Caminhão, art. 3º): carga/descarga ao comércio, combustível/gás local, lixo, valores, perecíveis, socorro, obras de emergência, serviços essenciais,
  mudanças, presos, bombeiros. Vigência: efeitos 30 dias após publicação (~fim de jan/2011).
- Notícia oficial 15/08/2023: radares com "restrição de veículos" e "controle de acesso de caminhões que circulam apenas como rota de passagem" na R. Treze de Maio 229,
  Av. Quinze de Novembro 906 e Estr. Ary Domingues Mandu 346/1002 → indica que segue vigente.
### Mogi das Cruzes — Lei 2.903/1985; Dec. 899/1985 (red. Dec. 1.782/2000); Dec. 8.375/2008
Serviço oficial com os PDFs: https://www.mogidascruzes.sp.gov.br/servico/todos-os-assuntos/transito-autorizacao-de-carga-ou-descarga (200) → mogi/
- Lei 2.903/1985: proíbe "veículos de transporte pesado" nas ruas centrais, 6h–22h. Dec. 1.782/2000 (PDF imagem): carga/descarga de pesados (PBT > 1.000 kg) na área central
  só 20h–9h; perímetro de 16 logradouros (ver lista no arquivo). Dec. 8.375/2008: horários diferentes por sinalização.
- Prática declarada (prefeitura à imprensa, 2023 e 2025): >3,5 t não circula na área central 10h–20h; calçadão R. Dr. Deodato Wertheimer até 9h.
### Suzano — dado estruturado oficial ★
- Item ArcGIS Online a9d96b0a77c7415ea4acb990d7ae0424 "MOB-Restrição trânsito de caminhões" (owner DPT.Geotecnologias, Sec. Planejamento Urbano e Habitação), hub
  https://infodata-geosuzano.hub.arcgis.com ; serviço https://services8.arcgis.com/q05L6PnVEyBJZq9L/arcgis/rest/services/Restricao_transito_de_caminhoes/FeatureServer/0
  query f=geojson → 200, 2 polígonos (65.988 m² com 14 anéis + 3.695 m²), bbox ≈ -46.3146,-23.5464 / -46.3064,-23.5346 (centro).
  Campos: Dt_Ho = "Segunda a Sábado - 07:00 - 21:00"; Obs = "Transporte de carga perecível permitido desde que devidamente identificado". lastEditDate 2025-03-18.
  licenseInfo vazio (sem licença declarada); acesso público sem token. → suzano/suzano_restricao_caminhoes.geojson (7,6 KB).
- Mesmo hub: MOB-Radares (14), MOB-Declividade sistema viário, LOGRADOUROS_25062024, Zona azul (63).
- Imprensa (Diário de Suzano 2019–2025) diz >3,5 t; ato não achado (site com Cloudflare 403).
### Taboão da Serra
- Restrição em todas as vias municipais seg–sex 5h–21h e sáb 10h–14h desde 06/12/2010 (O Taboanense 07/12/2010; Frota&Cia 16/11/2011: infração 5746-3).
- Serviço vigente "CONCESSAO DE CARTAO CAMINHÃO - DIGITAL": https://protocolo.cidadao.conam.com.br/taboao/servicos/novo/c308daa0-f621-480a-a546-4b076121969b (200);
  exige 2 NF com entrega/retirada no município em 120 dias (só quem tem destino local recebe o cartão).
- "Portaria SETRAM GS 003/2021" apareceu num resumo de busca, mas NÃO está no HTML do 1doc nem no site → não confirmada.
### Mairiporã — Lei 4.391/2025 (sancionada 11/04/2025)
- Ementa (espelho leismunicipais/leggicomunali, 403 Cloudflare): "Dispõe sobre o tráfego de veículos de carga na Avenida Vereador Belarmino Pereira de Carvalho e Avenida José Gianesella".
- Metrópoles 22/04/2025 e CONACE 07/11/2025: caminhões com mais de 2 eixos e ônibus de fretamento; Av. Ver. Belarmino P. de Carvalho (SP-023 → Av. José Gianesella), Av. José
  Gianesella, Av. Sen. José Ermírio de Moraes (entrada do Pq. Águas Claras → Av. Dr. Luiz Felippe França Ramos); multa municipal R$ 5.104 (R$ 10.208 reincidência).
  Projeto de alteração (2-eixos, VUC, ônibus) ainda em tramitação em nov/2025.
### Mauá — Lista oficial de equipamentos (SEMOB, ago–set/2025)
https://www.maua.sp.gov.br/public/docs/locais/2567c20a9d4d6b4110e1581e2a185c21.pdf (200, 9,9 MB, 41 p.) → maua/semob_locais_p3.pdf + .txt
- "Restrição de Circulação de Veículos de Carga (Caminhões)": 3 equipamentos (piezo): Viaduto Mário Covas Júnior x Av. Capitão João (B/C), R. Onze de Junho ~166 (B/C),
  R. Aquidabam ~383 (C/B). Horário e critério não publicados.
### São Caetano do Sul — lista de fiscalização eletrônica (SEMOB, 18/04/2023)
https://www.saocaetanodosul.sp.gov.br/storage/uploads/tWYSkb58tbwrXVtPKCrJHAxCyRs3LeHs5d3lELlO.pdf: "restrição de circulação de veículos" = 2 equipamentos
(Terminal Rodoviário Dr. Nicolau Delic; R. Manoel Coelho ~536, C/B). Não diz que é de caminhão.

## 3. Fonte agregada nova (só checklist): Pé na Estrada / Trucão "Restrições"
https://penaestrada.com.br/restricoes/<slug>/ (200, 28 municípios da RMSP raspados → penaestrada/penaestrada_rmsp.json). © 2022, sem data por município e com ERROS
comprovados: Barueri e Cotia "não possui restrições" (falso), Guarulhos "8–20h centro" (falso), Cajamar "Av. Ten. Marques 6–20h" (desatualizado), Mairiporã com o rodízio
par/ímpar que é da Lei 5.233/2019 de CAIEIRAS. Usar só como pista. Conteúdo de terceiros sem licença.

## 4. Buscas negativas e método (reprodutível)
- Querido Diário (frases, qd/*.json): Santo André 7 frases, SBC 7, Suzano 8, Itapevi 4, Jandira 4 → nenhum ato de restrição. Só 7 municípios da RMSP têm texto (nível 3).
- SAPL (sapl.<slug>.sp.leg.br): só Embu-Guaçu (2.428 normas), Juquitiba (0) e Mairiporã (0) existem.
- Instar /portal/leis_decretos: Taboão, Carapicuíba, Santo André → "Nenhum ato foi encontrado" mesmo sem filtro.
- WordPress REST /wp-json/wp/v2/posts?search=: Cotia, Diadema, Embu das Artes, Franco da Rocha, Itapevi, Poá, Juquitiba, Rio Grande da Serra (portais/wp_search.json).
- ArcGIS Online search ("restrição caminhões", "trânsito de caminhões", "ZMRC"): só Suzano.
- Bloqueios: suzano.sp.gov.br (Cloudflare 403), leismunicipais.com.br e espelho leggicomunali.it (403), itaquaquecetuba.sp.gov.br (migrado, 404/403),
  overpass-api.de ocupado (timeouts) para parte do teste de nomes. Orçamento de WebSearch da sessão esgotou no fim (200/200).

## 5. Integração proposta (camada existente restricoes_rmsp; convenção CONVENCOES_IMPLEMENTACAO.md item 1)
- Acrescentar regras em data/raw/rmsp/regras.json e um importador por fonte (importers/sources/rmsp_<municipio>.py), como os 7 atuais:
  · rmsp_suzano.py: baixa o FeatureServer (f=geojson) → kind=zona (polígonos já prontos, sem georreferenciar); refresh semanal comparando lastEditDate.
  · rmsp_aruja.py / rmsp_itapecerica.py / rmsp_caieiras.py / rmsp_mairipora.py / rmsp_diadema.py: vias por nome (Overpass/PBF + polígono IBGE), trecho e sentido quando o ato fixa.
  · rmsp_mogi.py: perímetro de 16 logradouros → polígono (fechar o anel pelas vias; vias-limite livres, como a ZMRC de SP).
  · rmsp_taboao.py: zona = polígono municipal IBGE, menos rodovias (Régis/BR-116 e SP-…: jurisdição não municipal) → exclusão com aviso; exceção = destino local.
- Predicados: Arujá usa alvo.qualquer [{pbt_t>31,5}] para o inciso I e "caminhao" para II/III; Diadema [{comprimento_m>6,3},{largura_m>2,2}]; Caieiras 5.486 caminhão exceto VUC
  (VUC sem definição local → usar a do CTB/Res. ou tratar como caminhão); Mairiporã [{eixos>2}]; Caieiras 3.560 [{comprimento_m>12}] em todo o município (avisar, peso ambíguo).
- NÃO suportado hoje: rodízio por final de placa (Caieiras 5.233) — exige placa no perfil; e decreto de vias não achado → não implementar.

## 6. Higiene
- Excertos do Querido Diário removidos dos qd/*.json (traziam nomes/CNPJ de terceiros); ficaram só data, URL e totais.
- Diário de Itapevi 1541 (3,7 MB, sem regra, com dados pessoais) apagado. PDFs grandes de Caieiras (12,6 MB) e Mauá (9,9 MB) cortados para as páginas citadas.

## 7. Teste de casamento de nomes com o OSM (Overpass, matching/; área admin_level=8 pelo nome)
- Arujá 7/10 exatos (faltam Av. Mário Covas [no OSM "Av. Gov. Mário Covas Jr."?], Av. Hans Ossamu Suzuki, R. Licínio Rodrigues de Paiva).
- Diadema 11/14 (faltam R. Arthur Sampaio Moreira, R. São Judas Tadeu, R. João Antônio de Araújo).
- Caieiras (Lei 5.486) 1/4 (só Av. Rodolfo Polidoro) → precisa de alias/fuzzy ou digitalização.
- Mairiporã 2/3 (Av. Sen. José Ermírio de Moraes não está com esse nome dentro do polígono de Mairiporã).
- Mogi (perímetro, regex): 11/16 exatos, 14/16 com variantes (Rua Olegário Paiva, Rua Antônio Nascimento Costa, Rua Ten. Galdino Pinheiro Franco); faltam R. Rafael Fernandes e R. das Primaveras.
- Itapecerica: overpass-api.de "server too busy" em 3 tentativas — não testado.
Conclusão igual à rodada anterior: 65–80% por nome exato; o resto pede alias manual.
