# Restrições de caminhão nos municípios da Grande SP (exceto a capital): notas de pesquisa
Data: 2026-10-09. Pasta: research/restricoes_rmsp_municipios/
Rodada 1 foi interrompida (seções 1 a 5 abaixo). A rodada 2 continuou sem refazer downloads (seções 6 em diante).
Arquivos com "falso positivo" foram mantidos só quando já estavam na pasta; os PDFs grandes novos e irrelevantes foram apagados.

## 0. Resumo para o produto
- Regras confirmadas em fonte primária (out/2026):
  | Município | Ato | Tipo | Quando | Quem é barrado |
  |---|---|---|---|---|
  | Osasco | Dec. 10.676/2012 alt. por 13.704/2023 + mapa DEMUTRAN 2023 | ZMRC (polígono) | seg–sex 5–21h, sáb 10–14h | caminhão (VUC ≤6,30 m livre, só secundária) |
  | Osasco | idem | VER (49 vias/trechos) | seg–sex 7–9h e 17–19h | caminhão |
  | Guarulhos | Dec. 37.887/2021 alt. 38.400/2021 | ZRCC-TB (alças do trevo de Bonsucesso, Dutra) | seg–sex 6–9h e 17–20h, sáb 10–14h | caminhão exceto VUC 2,20 x 7,20 m |
  | Barueri | Dec. 9.025/2019 | VER (16 trechos, 4 com sentido) | seg–sex 17–20h, exceto feriado | caminhão; VUC 2,20 x 6,30 m só se cadastrado |
  | Cajamar | Dec. 7.397/2025 | 4 anexos de vias | 7–9h e 16–20h (carreta 6–20h no Centro; Centro todos os dias) | caminhão >7,20 m e carreta |
  | Santana de Parnaíba | Dec. 4.288/2019 | 13 vias | 24h (Estr. Ten. Marques 16–19h) | PBT >15 t, exceto destino local |
  | Ribeirão Pires | Dec. 7.608/2025 | ZRC (polígono do centro) | período integral | >2 eixos ou PBT >16 t, exceto com AETE |
  | Cotia | só placas (notícia oficial 2022/2023) | 2 vias | permanente | >2 eixos (Estr. Velha de Cotia); só VUC (R. Rio Maicure) |
- NÃO existe base estruturada (WFS, GeoJSON ou CSV) de restrição de caminhão em nenhuma prefeitura da RMSP testada.
  Tudo está em decreto ou portaria publicados em PDF no diário oficial. A geometria é lista de vias ou trechos ("entre a rua X e a rua Y", "do nº 30 ao 288"),
  às vezes com mapa em imagem. Osasco é exceção: o mapa é vetorial no PDF.
- O OSM não tem nenhuma dessas regras: hgv:conditional = 0 fora da capital. O que há são hgv=no pontuais (placas R-9).
- Cada município usa uma definição própria de VUC: SP 2,50 x 7,20 m; Guarulhos e Cajamar 2,20 x 7,20 m; Barueri e Osasco 6,30 m;
  Diadema "até 4 t". Ribeirão Pires e Santana de Parnaíba usam eixos ou PBT (>2 eixos ou >16 t; >15 t). Cotia usa ">2 eixos" em via.
  → O modelo precisa de regra por jurisdição com predicados de dimensão, PBT e eixos, e não um is_vuc global.
- Há restrição por SENTIDO (Barueri: 4 trechos; Santo André 2012 também) e por TRECHO de via.
- A restrição regional do ABC (19 vias, 6h30–8h30 e 17–20h, 2012) foi CANCELADA pelo Consórcio antes das multas (DGABC 03/04/2012).
  Notícias antigas e guias ainda a citam, então não implementar.
- O guia compilado de referência é pago: IPTC/SETCESP "Guia de Restrições" 2024 (R$ 250) e 2023 (R$ 180, 36 municípios).
  Ele serve de checklist, mas não pode ser redistribuído.

## 1. OSM (PBF local sudeste-latest, recorte por bbox da RMSP + malha IBGE)
- Comando: osmium extract -b -47.25,-24.10,-45.65,-23.10 → tags-filter w/hgv w/hgv:conditional w/maxweight ... → export geojsonseq → osm_por_municipio.py
  (point-in-polygon pelo ponto médio da via, malha IBGE qualidade=maxima). Resultado em osm/contagem_por_municipio.txt e osm/rmsp_osm_restricoes.geojson.
- hgv:conditional fora da capital = 0 (capital = 6 vias). Nenhuma janela de horário municipal da RMSP está no OSM.
  Os *:conditional fora da capital são feiras livres (motor_vehicle:conditional "no @ (Su 04:00-14:00)" etc.).
- Rodada 2: conferi as vias com tag por município. Nenhuma via dos decretos abaixo está marcada (Barueri VER, Osasco ZMRC/VER, trevo de Bonsucesso,
  anexos de Cajamar, vias de 15 t de Santana de Parnaíba, ZRC de Ribeirão Pires). O que existe são casos pontuais:
  Guarulhos 6 vias (R. Lions hgv=no); Osasco 5 (Av. da Liberdade hgv=no); Barueri 2; Santo André 64 (inclui ~21 ways hgv=permit perto de -46,50/-23,68);
  SBC 64 (inclui trechos da Imigrantes hgv=no, provavelmente pistas específicas); Suzano 3 com maxweight=10; Arujá maxlength=5,5 na Av. Fatec;
  Mogi 1 com maxweight=10; Itapevi 1 com maxweight=3.2. Mauá e Ribeirão Pires: 0.
- Licença ODbL (uso comercial ok, share-alike na base derivada). Manter as regras municipais em base própria, separada do OSM.

## 2. Guarulhos (fonte primária confirmada)
- Decreto 37.887 de 01/04/2021 (DOM 01/04/2021) cria a ZRCC-TB (Zona de Restrição de Circulação de Caminhões do Trevo de Bonsucesso).
- Decreto 38.400/2021 (DOM 08/10/2021) altera o art. 3º: seg–sex 6h–9h e 17h–20h; SÁBADO 10h–14h (no original era sáb 7h–12h, e o SETCESP ainda cita 7–12).
- VUC = largura ≤2,20 m e comprimento ≤7,20 m. Exceções: VUC, lixo, zoonoses, obras e serviços essenciais, Correios, sinalização, socorro, carro-forte, betoneira em operação, insumos de saúde.
- O mapa do Anexo Único mostra só as alças e ramos do trevo na Dutra (guarulhos/zrcc_tb_mapa-001.jpg). Modelar como conjunto de vias, não como polígono grande.
- PDFs: https://www.guarulhos.sp.gov.br/06_prefeitura/leis/decretos_2021/37887decr.pdf (HTTP 200, 147 KB) e .../38400decr.pdf (200, 55 KB)
- Busca de legislação: https://consultaleis.guarulhos.sp.gov.br/?ementa=caminh%C3%B5es&tipo=3 (HTML; parâmetros numero/ano/tipo/ementa; tipo 3=DECRETO, 6=PORTARIAS NORMATIVAS).
  Só retorna o Decreto 37.887 como restrição.
- Decreto 22.911/2004: delega ao Depto de Trânsito (STT2) delimitar áreas e horários de restrição de caminhões por ato próprio.
  Por isso podem existir regras finas em portarias não indexadas.
- Lei 6.272/2007 define VLC (carga útil 1,5–4,5 t, largura 2,20 m, comprimento 6,30 m) para o serviço de carga-frete. É daí o "4,5 t" que o SETCESP cita.
- Notícia da prefeitura (guarulhos/art_reabertura-...html): o antigo viaduto do Trevo de Bonsucesso foi reaberto só para automóveis e motos,
  com placa de "proibido caminhão" e altura máxima de 2,5 m. Isso vira um ponto maxheight + hgv=no.
- Os arquivos guarulhos/do_*.pdf/txt são falsos positivos da rodada 1 (diários sem regra de caminhão).

## 3. Barueri (fonte primária confirmada)
- Decreto 9.025 de 12/09/2019, Jornal Oficial de Barueri ed. 1.169 de 14/09/2019 (PDF 3,6 MB):
  http://portal.barueri.sp.gov.br/Upload/Diario/pdf/JOB-1169-14Set2019-web_637039980038937304.pdf (301→https, 200)
- Revoga o Decreto 8.739/2018. Cria as "Vias Estruturais Restritas – VER" com restrição seg–sex 17h–20h, exceto feriados, em 16 trechos de Alphaville/Tamboré:
  Al. Alphaville [nº 1.555→Al. Mamoré], Mamoré, Rio Negro, Grajaú, Itapecuru, Oiapoque, Praça Oiapoque, Amazonas, Purus, Av. Cauaxi, Al. Madeira,
  Al. Araguaia [Dib Sauaia Neto→Al. Juari], Av. Piracema (2 trechos COM SENTIDO), Av. Aruanã (sentido SP) e Av. Paiol Velho (sentido Al. Mamoré).
- VUC só fica isento se cadastrado e autorizado pela Sec. Segurança e Mobilidade Urbana. VUC = largura ≤2,20 m e comprimento ≤6,30 m.
- Rodada 2: busca no diário por "9.025" retorna só a ed. 1.169. A busca (https://portal.barueri.sp.gov.br/Diario/Buscar?term=...) devolve no máximo 20 PDFs,
  todos até 2022. As edições novas ficam em servicos.barueri.sp.gov.br/cms. Por isso não dá para garantir que não houve alteração entre 2023 e 2026 (lacuna).
- Câmara (SAPL, rodapé CC-BY 4.0): https://sapl.barueri.sp.leg.br/api/norma/normajuridica/?ementa__icontains=caminh → 18 normas, nenhuma de restrição.

## 4. Cajamar (fonte primária confirmada; polo logístico da Anhanguera)
- Decreto 7.397 de 10/01/2025, DOM Cajamar ed. 1358: https://cajamar.sp.gov.br/diariooficial/wp-content/uploads/sites/3/edicao-no1358.pdf (200, 395 KB)
- Consolida e revoga os Decretos 5.237/2015, 6.058/2019, 6.364/2020, 6.529/2021, 6.969/2023 e 7.366/2024.
- Classes: VUC (larg ≤2,20 m, compr ≤7,20 m, até 3 t) sem restrição; CAMINHÃO (7,21–14 m, até 14 t, até 3 eixos); CARRETA (>14 m, >14 t, >3 eixos).
- Anexo I Centro/Água Fria: TODOS os dias; caminhão 7–9h e 16–20h; carreta 6–20h. Anexo II Av. Tenente Marques (Polvilho): seg–sex, mesmos horários.
  Anexo III Jordanésia: seg–sex, caminhão e carreta 7–9h e 16–20h. Anexo IV Av. José Marques Ribeiro: seg–sex 7–9h e 16–20h.
- Carga e descarga nas vias dos anexos só das 20h às 6h. Exige cadastro no Depto de Mobilidade. Vias definidas por TRECHO.

## 5. Santana de Parnaíba (fonte primária confirmada)
- Decreto 4.288 de 13/09/2019, Imprensa Oficial ed. 298 (20–26/09/2019), PDF 2,3 MB (santana_parnaiba/ed298.pdf).
- Regra por PESO: proíbe caminhões com PBT > 15 t. (I) Estrada Tenente Marques: 16h–19h DIARIAMENTE. (II) Av. Paiol Velho, Al. das Américas,
  Av. Pérola Byington, Av. Marcos Penteado de Ulhôa Rodrigues, Av. Yojiro Takaoka, Av. Alphanorte, Estr. da Bela Vista e mais 5 ruas: 24h, todos os dias.
- Exceção "destino local" (NF para obra, residência ou comércio no município). Equivale a hgv=destination condicionado a PBT > 15 t.
- Busca full-text por ano: https://prefeitura.santanadeparnaiba.sp.gov.br/PortalComunicacao/imprensa-oficial/search?NUM_Ano=2019&DS_ArquivoConteudo=caminh%C3%B5es
- Cuidado: os diários trazem CPF e nomes. Não armazenar PDFs inteiros sem necessidade.

## 6. Osasco (fonte primária confirmada na rodada 2) ★
- Ato base: Decreto 10.676 de 07/03/2012, "programa de restrição ao trânsito de veículos automotores pesados, do tipo caminhão".
  O SETCESP (14/02/2012) noticiou antes o Decreto 10.661 de 01/02/2012. O ato vigente citado em 2023–2026 é o 10.676/12.
  O TEXTO BASE NÃO ESTÁ ONLINE: a listagem de IOMO no site (osasco/iomo_index.json, 2.960 edições) não tem 2011 a 2013.
- Decreto 13.704 de 10/03/2023, IOMO 2408 de 15/03/2023: https://osasco.sp.gov.br/wp-content/uploads/2023/03/iomo-2408.pdf (200, 11,7 MB).
  Guardei só as págs. 6 a 8 (osasco/iomo2408_dec13704_p6..p8.pdf) e o texto (osasco/dec_13704_2023.txt).
  · Art. 3º (perímetro ou vias da ZMRC), 12 incisos: Av. Fuad Auada; Av. Maria Campos; Av. Lázaro de Mello Brandão; Av. Bussocaba; R. Narciso Sturlini;
    R. Alfredo Sturlini; R. Caetano Poli; Av. Santo Antonio; R. Ângelo Broski Siqueira; Av. Visconde de Nova Granada; Viaduto Pres. Dr. Tancredo de Almeida Neves; Av. das Nações Unidas.
  · Art. 5º (VER): hoje vai até o inciso XLIX (49 itens). Os itens XI, XLVII, XLVIII e XLIX foram alterados ou incluídos (Av. João Batista, R. Fiorino Beltramo,
    R. Dr. Mariano J. M. Ferraz, R. Antônio Biscuola, por trecho). Os outros 45 itens só estão no texto de 2012, que não está online.
- MAPA OFICIAL (DEMUTRAN/SETRAN), IOMO 2434 de 03/05/2023, p. 97–98. Achado via Querido Diário:
  https://data.queridodiario.ok.org.br/3534401/2023-05-03/39d9486475020047b3fc4292dac595f56e7f4815.pdf (200, 15,7 MB).
  Guardei só as págs. 97 e 98 (querido_diario/osasco_iomo2434_p97.pdf e _p98.pdf) e a imagem (osasco_mapa_restricao-098.png).
  Legenda (querido_diario/legenda-098.png): **ZMRC seg–sex 5h–21h e sáb 10h–14h; VER seg–sex 7h–9h e 17h–19h**.
  Isso difere do SETCESP 2012, que dava às VER 5–21h e ainda tinha uma "VMRC" de 5–24h. No mapa de 2023 não há mais VMRC.
- O mapa é VETORIAL no PDF. Com pdftocairo -svg saem 75.038 paths: 72.897 do arruamento em preto, 279 azuis (VER) e 399 verde-claro + 13 verde-escuro (ZMRC).
  Extraí os coloridos em querido_diario/osasco_mapa_p98_restricoes.svg (1.047 paths). Dá para georreferenciar por ajuste afim
  (casando o arruamento preto com o OSM) e gerar as linhas VER e o polígono ZMRC sem digitalizar à mão.
- 2ª fonte primária para o horário das VER: portaria da SETRAN sobre obras (IOMO 2487 de 09/08/2023,
  https://data.queridodiario.ok.org.br/3534401/2023-08-09/15a8c2132fb4e242a1b9e7988a0569f0b2354049.pdf, 11,9 MB, só lido o trecho pela API).
  O texto diz que nas VER "os caminhões estão proibidos de transitar de segunda a sexta-feira, das 07h às 09h, e das 17h às 19h,
  excetuando-se sábados, domingos e feriados". Isso confirma a legenda do mapa.
- Outras citações do 10.676/12 (via Querido Diário):
  portarias de 2022 e 2026 sobre pedidos em calçadões e praças avaliados "considerando ... Decreto nº 10.676/12".
- VUC (SETCESP 2012): até 6,30 m de comprimento, livre na ZMRC. Não confirmado em fonte primária.
- Os falsos positivos da rodada 1 (IOMO 518/545/700/1943, Ed1061/1197, homologacao_*) não falam de restrição e foram APAGADOS na rodada 2
  (traziam dados pessoais). O mesmo vale para guarulhos/do_* e maua/d88*.pdf (COVID).

## 7. Ribeirão Pires (fonte primária confirmada na rodada 2) ★
- Decreto 7.608 de 08/12/2025, publicado no Diário Oficial ed. 44 de 26/01/2026:
  https://www.ribeiraopires.sp.gov.br/uploads/diario_oficial_26_01_2026_26033144.pdf (200, 392 KB; ribeirao_pires/do_rp_2026-01-26_ed44.pdf e ed44.txt).
  O link estável passa por /portal/download/diario-oficial/CRLxwP/, que faz meta-refresh para /uploads/....
- Regra: proíbe caminhão com MAIS DE 2 EIXOS ou PBT ACIMA DE 16 t na ZRC (Zona de Restrição de Circulação), em período integral (sem janela de horário).
  Até 16 t ou 2 eixos circula livre. Base legal municipal: Lei 5.972/2015, que cria a AETE (autorização especial, validade de até 1 ano).
- Anexo I traz o mapa em imagem sobre fundo de Google Maps (ribeirao_pires/rp_dec7608_anexoI_mapa_zrc.jpg). Não é georreferenciado e precisa ser digitalizado à mão.
  Anexo II lista os limites: Av. Kaethe Richers (sentido centro a partir do 1º retorno após o portal), R. Angelo Maziero, R. Afonso Zampol, R. Batista Lion,
  R. Presidente Kennedy, Tv. Gilberto Pereira de Figueiredo, Av. Fortuna, R. José Elias Chiedde, R. Giácomo Sortino, R. Boa Vista, R. Miguel Prisco (nº 30 ao 288).
- Exceções com janelas: concretagem 9–16h e sáb 10–15h; mudança 9–16h; caçamba/poliguincho 9–16h; perigosos só com até 2 eixos traseiros; serviços essenciais.
- Diário com dados abertos (JSON): https://www.ribeiraopires.sp.gov.br/portal/dados-abertos/diario-oficial/2026 (200, 25 KB, 210 edições com número e data, sem texto).
- Fonte secundária: DGABC 27/01/2026 (https://www.dgabc.com.br/Noticia/4281788/...), que diz que a vigência começou em 01/12/2025.

## 8. ABC (Santo André, SBC, São Caetano, Diadema, Mauá)
- Restrição regional de 2012 (Consórcio Intermunicipal): 19 vias, 6h30–8h30 e 17h–20h, multas a partir de 08 ou 09/04/2012
  (SETCESP 09/03/2012 https://setcesp.org.br/noticias/cidades-do-abc-terao-restricao-e-multa-para-caminhoes-a-partir-de-abril/).
  Mauá saiu da lista (SETCESP 07/02/2012). **O Consórcio CANCELOU a medida** (DGABC 03/04/2012, https://www.dgabc.com.br/Noticia/28201/consorcio-cancela-restricao-a-caminhao).
  Não achei restrição horária vigente equivalente em nenhuma das 4 cidades.
- Diadema: em fev/2011 proibiu caminhões em 11 vias do Centro, seg–sex 6–20h e sáb 6–14h; VUC até 4 t, perecíveis e serviços essenciais liberados
  (SETCESP 14/02/2011 https://setcesp.org.br/noticias/diadema-proibe-circulacao-de-caminhoes-em-11-vias-do-centro/).
  NÃO achei o decreto primário nem a lista das 11 vias. O diário (WordPress) não tem busca útil:
  /wp-json/wp/v2/search?search=caminhões → []. Em 2023 a prefeitura disse ser "inviável limitar" caminhões na R. Jacuí (ABCD Jornal 03/04/2023).
- Santo André: tem GeoServer público com WFS 2.0 (https://sigamapa.santoandre.sp.gov.br/geoserver/ows), 177 camadas, sem camada de restrição de caminhão. Camadas úteis:
  · siga:SIGA_CRA_FEIRAS_LIVRES: 70 trechos com dia e DSC_HORARIO_INTERDICAO (ex.: "6h às 14h"); a maioria das interdições é das 6h às 14h ou 14h30.
    São restrições temporárias reais para o roteamento (santoandre/feiras_all.geojson).
  · siga:SIGA_MUR_CONTAG_VEICULAR: 639 postos com TOTAL_CAMINHOES (dez/2019).
  · siga:SIGA_MUR_RADARES e SIGA_MUR_CORREDORES_TRANSP (13 corredores com horário).
  · siga:SIGA_PLA_RESTR_ADICIONAIS: 20 polígonos de gabarito de EDIFICAÇÃO (Lei 10.556/2022), NÃO de trânsito.
  WFS sem AccessConstraints ("NONE"); licença não declarada.
- SBC: hierarquia viária em shapefile (sbc/hierarquia_viaria_SBC.zip, 15,9 MB, 14.188 trechos, SIRGAS 2000 UTM 23S, campos TIPO/NOME/COD_LOG/HIERARQUIA:
  LOCAL 10.483, COLETORA 1.350, ARTERIAL1/2/3, METROPOLITANO 87). Não tem atributo de caminhão. A URL de origem não foi registrada na rodada 1;
  o geoportal (geo.saobernardo.sp.gov.br/pmsbc) é um frameset ASP. Diário de SBC é DiOE/DOSP (dosp.com.br), com busca via JS, que não testei a fundo.
- Mauá: a busca de legislação (https://sistemas.maua.sp.gov.br/legislaconsulta/consulta.php, GET nlei/inputPalavraChave/tipolei[]) devolveu 0 linhas no HTML
  (provavelmente a lista é preenchida por JS). Os maua/d8835, d8855 e d8944.pdf da rodada 1 são decretos de COVID (falsos positivos).
- São Caetano: nada encontrado (busca web e portal com 2 KB). Lacuna.

## 9. Outros municípios
- Cotia (só notícias da prefeitura, sem decreto):
  · Estrada Velha de Cotia, altura do nº 740 (perto do Assaí): a placa "acima de 10 t" virou "proibido caminhões acima de 2 eixos",
    com fiscalização eletrônica desde 21/08/2023 (cotia/dia-21-08-...json, API WP https://cotia.sp.gov.br/wp-json/wp/v2/posts).
  · R. Rio Maicure (Jd. da Glória): só VUC desde 26/04/2022 (cotia/prefeitura-implanta-...json).
- Taboão da Serra: SETCESP 2022 diz "VUC regulamentado em 7,20 m" e houve reunião sobre excesso de multas a caminhões (SETCESP 13/04/2016).
  Ato primário não encontrado (o portal devolve 226 bytes).
- Itapevi: só indicações e requerimentos da Câmara (R-9 na R. Tabata; estudo de proibição na Av. Cesário de Abreu). Nenhum decreto achado.
- Mogi das Cruzes: GeoMogi (https://geomogi.mogidascruzes.sp.gov.br) usa GeoServer em https://geoserver1.mogidascruzes.sp.gov.br/geoserver.
  O WFS não tem nenhuma FeatureType pública e o WMS só tem 16 camadas de ortofoto e mosaico (gis_probe/mogi_wms_caps.xml). Nenhum decreto de caminhão achado.
- Suzano, Itaquaquecetuba, Arujá, Poá, Carapicuíba, Embu das Artes, Jandira, Vargem Grande, Franco da Rocha, Caieiras e Mairiporã: busca web sem ato primário.
  Carapicuíba e Ribeirão Pires usam a plataforma de portal com /portal/leis_decretos, mas a busca por POST devolveu 0 blocos até para "trânsito".
  O SETCESP 2023 cita Franco da Rocha (15 t), Juquitiba, Mairiporã, Cajamar e Caieiras com regras de peso, comprimento e eixos, sem detalhe.

## 10. Fontes agregadas e de busca
- Querido Diário (Open Knowledge Brasil): https://queridodiario.ok.org.br/api/cities e /api/gazettes. Licença dos dados: atos oficiais; o projeto é aberto.
  Cobertura RMSP (querido_diario/rmsp_cobertura.json): os 39 municípios estão listados, mas só 7 têm level 3 (texto pesquisável):
  Guarulhos (desde 2022-07-09), Santo André (2022-10-10), Osasco (2023-08-03), SBC (2023-10-03), Itapevi (2023-10-03), Jandira (2023-10-05) e Suzano (2023-11-21).
  Consultas com OR e várias frases deram HTTP 500 ou 520. Frases simples funcionam, ex.: territory_ids=3534401&querystring="10.676" → 8 diários.
  Foi o que achou o mapa de Osasco. Script em querido_diario/qd_busca.py e resultados em qd_resultados.json (cada consulta leva de 60 a 110 s).
  Resultados das frases: Guarulhos "trânsito de caminhões" 8 (só o Dec. 37.887 é relevante; o resto é licenciamento florestal e compra de placas R-9);
  Guarulhos "circulação de caminhões" 3 (Dec. 37.887, Dec. 38.400 e regra de caçambas de 2019); Santo André 0+0; SBC 0+0; Itapevi 1 (plano de defesa civil);
  Jandira 0; Osasco "Vias Estruturais Restritas" 1 (IOMO 2487). Suzano ("veículos pesados") só deu licitações.
  Conclusão: nos 7 municípios indexados, só Guarulhos e Osasco têm ato de restrição publicado desde 2021–2023.
- SETCESP/IPTC "Guia de Restrições": o link antigo https://conteudo.setcesp.org.br/restricoes dá 404 e http://www.iptcsp.com.br/restricoes também dá 404.
  O guia agora é vendido em https://iptcsp.com.br/conteudos/ebooks-guias/catalogo/?slug=guia-de-restricoes: 2024 por R$ 250 e 2023 por R$ 180 ("36 municípios").
  É conteúdo pago e protegido, então serve como checklist interno e não como dado do app.
- leismunicipais.com.br: Cloudflare 403 (leismunicipais/osasco.html).
- SAPL: Barueri funciona (CC-BY 4.0). Mairiporã e Embu-Guaçu retornaram JSON vazio ou pequeno (sapl/*.json).

## 10b. Teste de casamento de nomes com o OSM (Overpass, matching/)
- Barueri (matching/q_barueri.ql → barueri_ver_osm.json): 13 dos 15 logradouros das VER têm nome idêntico no OSM, em 139 ways (128 com oneway=yes,
  o que ajuda nos trechos com sentido). Faltaram "Alameda Alphaville" e "Alameda Oiapoque" (outra grafia ou outro município).
- Osasco (art. 3º + alterações de 2023): 14 de 16 nomes com match exato. Faltaram o Viaduto Pres. Tancredo Neves e a R. Dr. Mariano J. M. Ferraz (grafia).
- Ribeirão Pires (Anexo II): 7 de 11 com match exato. Faltaram R. Batista Lion, Tv. Gilberto P. de Figueiredo, R. José Elias Chiedde e R. Giácomo Sortino.
- Conclusão: casar por nome resolve de 65% a 90% e o resto pede correção manual (aliases e fuzzy). Trechos "entre X e Y" pedem corte do way nas interseções.

## 11. Comandos de teste úteis
- curl -s -L -A "Mozilla/5.0" "https://queridodiario.ok.org.br/api/gazettes?territory_ids=3534401&querystring=%2210.676%22&excerpt_size=500&size=20"
- curl -s "https://sigamapa.santoandre.sp.gov.br/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=siga:SIGA_CRA_FEIRAS_LIVRES&outputFormat=application/json"
- curl -s "https://www.ribeiraopires.sp.gov.br/portal/dados-abertos/diario-oficial/2026"
- pdftocairo -svg -f 98 -l 98 osasco_iomo2434_p98.pdf mapa.svg  (depois filtrar stroke rgb(0%,0%,100%) = VER)

## 12. Como integrar (proposta)
- Tabela truck_rules(jurisdiction_ibge, rule_id, kind[zone|line|point], geom, direction[both|forward|backward], days, time_windows,
  vehicle_predicate {max_len_m, max_width_m, max_pbt_t, max_axles, vuc_def_id}, exceptions[], requires_permit(AET/AETE/AETC), source_url, act_number, act_date, verified_at).
- Geometria: casar nome de logradouro + trecho com os ways do OSM (por nome, normalizado, dentro do polígono municipal do IBGE) e guardar os way_ids.
  Para Osasco, georreferenciar o SVG vetorial. Para Ribeirão Pires, digitalizar o polígono à mão sobre o OSM.
- No Valhalla: zonas e linhas com horário entram como exclude_polygons dinâmicos (como já é feito com a ZMRC de SP), montados no request conforme o horário de partida
  e o perfil do veículo. Regras 24h de peso ou eixo (Santana de Parnaíba e Ribeirão Pires) também podem ir para exclude por perfil.
  Não gravar no OSM nem no PBF.
- Feiras livres de Santo André: importar do WFS toda semana como fechamento temporário por dia e hora.
- Vigilância: Querido Diário semanal por município (frases "trânsito de caminhões", "circulação de caminhões", "10.676", "veículos pesados")
  para avisar quando houver ato novo.
