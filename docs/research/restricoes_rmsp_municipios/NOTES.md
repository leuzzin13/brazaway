# Restrições de caminhão nos municípios da Grande SP (exceto capital) — notas de pesquisa
Data da pesquisa: 2026-10-09. Pasta: research/restricoes_rmsp_municipios/

## (rascunho em andamento — ver seções abaixo)

### 1. OSM (PBF local sudeste-latest, recorte bbox RMSP + malha IBGE)
- Comando: osmium extract -b -47.25,-24.10,-45.65,-23.10 → tags-filter w/hgv w/hgv:conditional w/maxweight ... → export geojsonseq → osm_por_municipio.py (point-in-polygon pelo ponto médio da via, malha IBGE qualidade=maxima).
- Resultado em osm/contagem_por_municipio.txt e osm/rmsp_osm_restricoes.geojson.
- ACHADO: hgv:conditional fora da capital = 0 (capital = 6 vias). Nenhuma janela de horário municipal da RMSP está no OSM.
  Os *:conditional fora da capital são feiras livres (motor_vehicle:conditional "no @ (Su 04:00-14:00)" etc.).

### 2. Guarulhos (fonte primária confirmada)
- Decreto 37.887 de 01/04/2021 (DOM 01/04/2021) cria a ZRCC-TB (Zona de Restrição de Circulação de Caminhões do Trevo de Bonsucesso).
- Decreto 38.400/2021 (DOM 08/10/2021) altera o art. 3º: seg–sex 6h–9h e 17h–20h; SÁBADO 10h–14h (o original era sáb 7h–12h; SETCESP ainda cita 7–12).
- VUC = largura ≤2,20 m e comprimento ≤7,20 m. Exceções: VUC, lixo, zoonoses, obras/serviços essenciais, Correios, sinalização, socorro, carro-forte, betoneira em operação, insumos de saúde.
- Mapa do Anexo Único = só as alças/ramos do trevo na Dutra (imagem guarulhos/zrcc_tb_mapa-001.jpg) → modelar como conjunto de vias, não polígono grande.
- PDF: https://www.guarulhos.sp.gov.br/06_prefeitura/leis/decretos_2021/37887decr.pdf (HTTP 200, 147 KB) e .../38400decr.pdf (200, 55 KB)
- Busca de legislação: https://consultaleis.guarulhos.sp.gov.br/?ementa=caminh%C3%B5es&tipo=3 (HTML, parâmetros numero/ano/tipo/ementa; tipo 3=DECRETO, 6=PORTARIAS NORMATIVAS)
- Decreto 22.911/2004: delega ao Depto de Trânsito (STT2) delimitar áreas e horários de restrição de caminhões por ato próprio ("Cartão Caminhão") → regras finas podem estar em portarias não indexadas.
- Lei 6.272/2007: define VLC (veículo leve de carga) 1,5–4,5 t, largura 2,20 m, comprimento 6,30 m (para carga-frete).

### 3. Barueri (fonte primária confirmada)
- Decreto 9.025 de 12/09/2019, Jornal Oficial de Barueri ed. 1.169 de 14/09/2019 (PDF 3,6 MB):
  http://portal.barueri.sp.gov.br/Upload/Diario/pdf/JOB-1169-14Set2019-web_637039980038937304.pdf (301→https, 200)
- Revoga o Decreto 8.739/2018. "Vias Estruturais Restritas – VER": seg–sex 17h–20h, exceto feriados. 16 trechos em Alphaville/Tamboré
  (Al. Alphaville [nº1.555→Al. Mamoré], Mamoré, Rio Negro, Grajaú, Itapecuru, Oiapoque, Praça Oiapoque, Amazonas, Purus, Av. Cauaxi, Al. Madeira,
  Al. Araguaia [Dib Sauaia Neto→Al. Juari], Av. Piracema (2 trechos COM SENTIDO), Av. Aruanã (sentido SP), Av. Paiol Velho (sentido Al. Mamoré)).
- VUC isento SOMENTE se cadastrado/autorizado pela Sec. Segurança e Mobilidade Urbana; VUC = largura ≤2,20 m e comprimento ≤6,30 m (diferente de SP/Guarulhos/Cajamar = 7,20 m).
- Restrição original (2011): notícia oficial 03/10/2011 http://www.barueri.sp.gov.br/sistemas/informativos/informativo.asp?id=14611 (≈2.800 caminhões/dia no pico).
- Busca no diário: https://portal.barueri.sp.gov.br/Diario/Buscar?term=... (HTML; retorna lista de edições em PDF; busca por palavra, sem ordenação).
- Câmara (SAPL, CC-BY 4.0 no rodapé): https://sapl.barueri.sp.leg.br/api/norma/normajuridica/?ementa__icontains=caminh → 18 normas, nenhuma de restrição (restrição é por DECRETO do Executivo, não lei).
- Atenção: restrição por SENTIDO de via (oneway-specific) em 4 trechos → o modelo precisa de direção.

### 4. Cajamar (fonte primária confirmada; polo logístico Anhanguera)
- Decreto 7.397 de 10/01/2025, DOM Cajamar ed. 1358: https://cajamar.sp.gov.br/diariooficial/wp-content/uploads/sites/3/edicao-no1358.pdf (200, 395 KB)
- Consolida e revoga Decretos 5.237/2015, 6.058/2019, 6.364/2020, 6.529/2021, 6.969/2023, 7.366/2024.
- Classes: VUC (larg ≤2,20 m, compr ≤7,20 m, até 3 t) = sem restrição; CAMINHÃO (7,21–14 m, até 14 t, até 3 eixos); CARRETA (>14 m, >14 t, >3 eixos).
- Anexo I Centro/Água Fria: TODOS os dias; caminhão 7–9h e 16–20h; carreta 6–20h. Anexo II Av. Tenente Marques (Polvilho): seg–sex, mesmos horários.
  Anexo III Jordanésia (Av. Jordano Mendes etc.): seg–sex, caminhão e carreta 7–9h e 16–20h. Anexo IV Av. José Marques Ribeiro: seg–sex 7–9h e 16–20h.
- Carga/descarga nas vias dos anexos só 20h–06h. Caminhões/carretas devem se cadastrar no Depto de Mobilidade.
- Vias definidas por TRECHO (entre rotatória X e rua Y; altura do nº), não por polígono.

### 5. Santana de Parnaíba (fonte primária confirmada)
- Decreto 4.288 de 13/09/2019, Imprensa Oficial ed. 298 (20–26/09/2019), PDF 2,3 MB via
  https://prefeitura.santanadeparnaiba.sp.gov.br/PortalComunicacao/arquivo/download/edN9NKmbgowoYQfiglT51dTSRmjwjeSjj_UfEFdblDHuwrct_6N8kaHuVr4E9_UsuLnyPw2
- Regra por PESO: proíbe caminhões/pesados com PBT > 15 t.
  (I) Estrada Tenente Marques: 16h–19h DIARIAMENTE; (II) Av. Paiol Velho, Al. das Américas, Av. Pérola Byington, Av. Marcos Penteado de Ulhôa Rodrigues,
  Av. Yojiro Takaoka, Av. Alphanorte, Estr. da Bela Vista, R. Benedito Crispim de Oliveira, Av. Angola, R. Líbano, R. Luiz Maximiliano Chiló, R. D'Alessandro Carmine: 24h, todos os dias.
- Exceção tipo "destino local": carga com NF para obra/residência/comércio no município com acesso por essas vias; água e betoneira de empresas locais.
  → equivale a hgv=destination condicionado a maxweight 15 t (OSM: maxweight:hgv / hgv:conditional=destination @ (weight>15)).
- Revoga Decretos 2.693/2005, 3.154/2009, 3.160/2009, 3.308/2011.
- Busca full-text por ano: https://prefeitura.santanadeparnaiba.sp.gov.br/PortalComunicacao/imprensa-oficial/search?NUM_Ano=2019&DS_ArquivoConteudo=caminh%C3%B5es (HTML, retorna página do PDF).
  Busca por "4.288" em 2020–2026 só trouxe falsos positivos (nº de CPF/Lei 4.288/2024 de outro tema) → sem alteração localizada.
- Cuidado: diários trazem CPF/nomes (dado pessoal) — não armazenar PDFs inteiros sem necessidade.
