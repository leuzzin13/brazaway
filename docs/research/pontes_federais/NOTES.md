# Pontes e viadutos em rodovias federais: limite de peso, classe de projeto e estado de conservação

Pesquisa feita em 09/10/2026. Pasta: `research/pontes_federais/` (~100 MB).
A primeira rodada foi interrompida sem NOTES.md. Esta rodada reaproveitou todos os arquivos já baixados, reprocessou tudo e completou o que faltava.

Os testes usaram curl, python3 (venv `../venv` com shapely e pdfplumber), osmium (imagem `osmq-img`) e o navegador embutido. O navegador foi usado só para descobrir o host da API do Power BI.

## 1. Resumo do que muda decisões de produto

1. **Nenhuma fonte pública traz um limite de peso por ponte, com coordenada, para caminhão comum.** O que existe se divide em quatro peças:
   - (a) **SIAET/DNIT**: limites de altura, largura, **peso (PBT, em t)**, comprimento e raio de giro **por segmento PNV/SNV**, voltados à AET. São publicados em PDF por UF e atualizados todo mês.
   - (b) **Painel Power BI do PROARTE/DNIT**: **nota técnica 1–5 por OAE, com coordenada e data da vistoria**. As vistorias são de 2020–2021 e o painel foi atualizado pela última vez em 09/04/2025.
   - (c) **DNITGeo WFS `vgeo:oae_sgo`**: 8.795 OAEs com ponto, tipo, estrutura, extensão e largura. Não traz peso, classe nem nota.
   - (d) **ANTT "Pontes e similares"**: 3.513 OAEs das concessões, com coordenada de início e fim. Não traz peso, classe nem nota.
2. **Na Grande SP, o tema quase não afeta o roteamento.** As 3 rodovias federais da RMSP são concedidas à ANTT: Dutra (RIOSP), Régis (Autopista Régis) e Fernão Dias (Motiva Minas SP).
   - O SIAET não tem **nenhum limite de peso abaixo de 150 t nem de altura abaixo de 5,0 m** nos 11 segmentos federais que tocam a RMSP (ver §3.2).
   - O painel PROARTE **não cobre** OAEs de concessão federal em SP: só 58 OAEs em SP, nenhuma na RMSP.
   - As 139 OAEs do `oae_sgo` na RMSP **não têm código SGO**, ou seja, não têm nota.
   - **Conclusão para o piloto**: a restrição de ponte que importa na Grande SP é municipal ou estadual (ver temas `pontes_sp_estado_municipio` e `restricoes_sp_capital`), não federal.
3. **No Brasil, o SIAET é o único "limite de peso" estruturado que existe para rodovia federal.** Ele cobre 608 segmentos PNV com peso ou bloqueio (out/2026):
   - 85 segmentos com valor 0 (AET bloqueada ou interdição), somando 3.572 km;
   - 24 segmentos com menos de 23 t (619 km);
   - 133 segmentos entre 23 e 45 t (2.736 km, dos quais 98 no AM);
   - 59 segmentos entre 45 e 57 t (1.322 km);
   - 97 segmentos entre 57 e 74 t (1.473 km);
   - 210 segmentos acima de 74 t (3.675 km).

   A Res. DNIT 11/2022 define a restrição temporária como incluindo "pontes com limitação de peso". O cruzamento com notícias do DNIT confirma vários casos:
   - BR-365/MG, Rio das Velhas: 23 t no SIAET;
   - BR-235/TO, ponte do Rio Tocantins: 0;
   - BR-259/ES, Córrego Treviso: 0;
   - BR-116/RS, Rio das Antas: 0;
   - BR-367/MG: 12 t no SIAET e `maxweight=12` no OSM.
4. **O SIAET atrasa e tem lacunas.** Dois exemplos:
   - BR-361/PB, ponte do Rio Piancó: interditada desde 25/09/2026 segundo o DNIT, mas o SIAET de 05/10/2026 ainda mostra **12 t**.
   - BR-432/RR, Igarapé Baruaninha (km 80): restrita segundo o DNIT em 18/09/2026, mas **ausente** do SIAET.

   Por isso as notícias de "Alerta de serviços" do DNIT precisam entrar como segunda fonte, com curadoria.
5. **Nota técnica ruim não equivale a limite de peso.** Das 178 OAEs com nota 1 (crítica) no painel, só 23 estão em segmento SIAET com limite de 57 t ou menos, ou com bloqueio. A nota serve como **aviso ou informação** e para priorizar a verificação colaborativa (reportes `weight_limit` e `road_closed`). Não serve como bloqueio automático de rota.
6. **A classe de projeto (TB-45, TB-36 e outras) não é pública por ponte.**
   - A ficha cadastral do SGE tem o campo "Trem-Tipo" (Norma DNIT 010/2024-PRO, Anexo A), mas ele não aparece no WFS nem no Power BI.
   - Um proxy possível é o ano de construção ligado à norma vigente na época: NB-6/1960 com classes 36, 24 e 12 (1960–1984), NBR 7188:1984 com classes 45, 30 e 12 (1984–2013) e NBR 7188:2013 com TB-450 e TB-240. Só que o ano de construção também não é público.
   - **Não usar classe de projeto como limite no app.**
7. **A governança está mudando.**
   - A Portaria MT nº 309/2026 (DOU de 06/05/2026) faz do **SGE o cadastro único de todas as OAEs federais, inclusive as concedidas**. A atualização passa a ser anual, com **prazo de 1 ano (até cerca de mai/2027)** para atualizar o cadastro geral, e o texto cita a LAI.
   - A Portaria MT nº 308/2026 cria o programa nacional e manda mapear as OAEs críticas.
   - Quando isso estiver pronto, vale um pedido via LAI (Fala.BR) da extração do SGE com nota, trem-tipo e coordenadas, incluindo as concessões.
8. **Números oficiais para contexto:**
   - DNIT dispõe de 7.815 OAEs (ata da 10ª Reunião da Diretoria Colegiada, 18/03/2025);
   - "400 OAEs com notas 1 e 2" (apresentação do DNIT na CVT da Câmara, 04/11/2025);
   - 936 OAEs "Problemáticas" (notas 1+2) no PLANILHÃO do Power BI (base com refresh em abr/2025);
   - cerca de 700 pontes de madeira (MT, mai/2026); são 728 no PLANILHÃO.

## 2. Fontes testadas

### 2.1 DNIT/SIAET: Restrições Definitivas e Temporárias por UF (PDF mensal) — VALOR ALTO
- Página: https://www.gov.br/dnit/pt-br/assuntos/infraestrutura-rodoviaria/aet/restricoes (HTTP 200)
- Padrão dos PDFs: `https://www.gov.br/dnit/pt-br/assuntos/infraestrutura-rodoviaria/aet/restricoes/restricao-{definitiva|temporaria}/{MM-AAAA}/{uf}.pdf`
  - Teste: `curl -sL -o x.pdf .../restricao-definitiva/10-2026/sp.pdf` deu 200, 531.495 bytes, `application/pdf`.
  - Há versão antiga, como `.../restricao-temporaria/05-2026/ro.pdf` (200). Ou seja, o **histórico mensal fica online**.
- Os 54 PDFs (27 UFs × 2) foram baixados em `aet_pdfs/` e parseados com `parse_aet.py` (pdfplumber, colunas por posição x do cabeçalho; colunas validadas em §3.1).
  - Resultado: `aet_restricoes_definitiva_2026-10.csv` (3.374 linhas, 27 UFs) e `aet_restricoes_temporaria_2026-10.csv` (1.532 linhas, 26 UFs).
- Campos:
  - BR, UF, PNV, km inicial e final;
  - por pista (Pista 1 = sentido crescente, Pista 2 = decrescente): altura, largura da faixa de rolamento, largura total, **peso (t)**, raio de giro e comprimento na definitiva; altura, largura, peso e comprimento na temporária.
  - Cabeçalho: "Atualizado em: 05/10/2026". Os PDFs são gerados do Excel.
- Semântica, pelos manuais do SIAET (`siaet_int.txt`) e pela Res. DNIT 11/2022, art. 2º, XXVII e XXVIII:
  - Definitiva: limitação física permanente, como "gabarito vertical de pontes, viadutos e passarelas... **trem-tipo**".
  - Temporária: limitação eventual, incluindo "comprometimento estrutural das OAE" e "pontes com limitação de peso".
  - Os valores valem para o **segmento PNV inteiro**, não para um ponto.
  - A origem do valor pode ser levantamento, UNIT ou "AET", isto é, inferida de AETs já emitidas.
  - **0,0 = AET não autorizada ou trecho bloqueado.** Exemplo: 116BSP2550 (Marginal Tietê), que é de jurisdição estadual no SNV, não está fechado.
- Contagens no Brasil: §1 item 3. Junção com `oae_sgo` pelo código SNV em `aet_join_oae.py` → `aet_restricoes_peso_baixo_x_oae.json`:
  - 402 segmentos com peso de 74 t ou menos, ou com 0;
  - 59 desses têm exatamente 1 OAE não-passarela no segmento, o que torna possível apontar a ponte;
  - 119 têm 2 OAEs ou mais;
  - 224 não têm nenhuma OAE pelo `cod_snv`. Atenção: o `cod_snv` do `oae_sgo` às vezes é de versão antiga do SNV.
- Licença: ato e informação pública. O site gov.br é CC BY-ND 3.0. **Uso comercial do dado factual é OK com citação.** Não redistribuir os PDFs como "nossos".

### 2.2 DNIT: Painel Power BI "OBRAS DE ARTE ESPECIAIS" (PROARTE) — VALOR ALTO (Brasil) / NULO (RMSP)
- URL pública, divulgada pelo SETCESP em 28/04/2025 (https://setcesp.org.br/noticias/informacoes-sobre-a-situacao-das-obras-de-arte-especiais-oae/): https://app.powerbi.com/view?r=eyJrIjoiZWU3NWRjYjQtNGVmMS00ZmEwLTk2MmYtODM3NWIxYWRlZWZhIiwidCI6IjQ0MTBhNmY2LWM2MTMtNGNkNy05M2VjLTY1MzBhZjdhMzA1MyJ9
  - Não encontrei link para ele no gov.br/dnit (as páginas do PROARTE não apontam para o painel).
- Teste:
  - O navegador embutido mostrou "Total de OAEs 5335", com filtros de Região, UF, Unidade Local, Município, Rodovia, **Nota Técnica (SGO)**, Supervisoras e Condição Estrutural, mais um mapa colorido por nota.
  - A API pública responde por curl em `https://wabi-brazil-south-b-primary-api.analysis.windows.net/public/reports/...` com o header `X-PowerBI-ResourceKey: ee75dcb4-...` (o host `-redirect` falha por curl).
  - `modelsAndExploration` → modelo `PROARTE_MAPA_REAB_MANUT`, id 5764495, **LastRefreshTime 2025-04-09**.
  - `conceptualschema` (gzip) → tabelas `BASE BRÁULIOS` e `PLANILHÃO`.
  - `querydata` com DSR decodificado pelo script `powerbi_oae/pbi_query.py` (stdlib).
- Resultados:
  - `powerbi_oae/planilhao.csv`: **7.828 OAEs**, 7.743 com lat/lon e 7.767 com código SNV.
    - Campos: CodPro, Supervisora, Código SGO, nome, rodovia, UF, município, km, SNV, extensão, largura, altura (só 129 preenchidas), tipo de estrutura e de obra, lat/lon, **data da vistoria e Nota Técnica Atual (SGO)**, condição, **histórico de até 4 inspeções com nota**, administração, jurisdição, banco de dados e observações.
    - Notas: 1 = 178, 2 = 758, 3 = 2.215, 4 = 3.579, 5 = 102, vazio = 996.
    - Ano da última vistoria: 4.679 em 2020, 1.277 em 2021, 2 em 2022, o restante antes disso. **O dado está defasado.**
    - Administração: 6.178 Federal, 1.145 Concessão Federal, 338 Estadual.
    - Tipos: 728 pontes de madeira (MT 157, PA 148, AM 126...).
  - `powerbi_oae/base_braulios.csv`: 5.335 OAEs (só Federal), com o status do PROARTE (01 Indicada, 02 Manutenção prevista, 03 Manutenção contratada/concluída, 04 Reabilitação prevista, 05 Redirecionada, 06 Reabilitação concluída).
  - SP: 58 OAEs (BR-459, BR-101 Ubatuba, BR-488, BR-158). **RMSP: 0.**
  - O `oae_sgo.cod_sgo` casa 100% (6.428 de 6.428) com o PLANILHÃO e as coordenadas são idênticas, o que permite juntar ponto do WFS e nota do Power BI.
- Licença: **não declarada.** É um painel "publish to web" oficial. A informação é pública (LAI), mas a base pode ser protegida como compilação (Lei 9.610, art. 7º XIII).
  - Recomendação: usar como referência interna e camada informativa citando "DNIT/PROARTE", e pedir a base formalmente (LAI) antes de uso comercial pesado.
  - A API não é documentada e pode mudar ou sair do ar.
- Comando de teste: `python3 powerbi_oae/pbi_query.py` (sem argumentos usa BASE BRÁULIOS; ver exemplo com PLANILHÃO no histórico).

### 2.3 DNITGeo GeoServer WFS (VGeo) — VALOR MÉDIO (geometria e chave)
- WFS: https://servicos.dnit.gov.br/dnitgeo/geoserver/wfs (GetCapabilities em `dnitgeo_wfs_caps.xml`, 128 camadas; WMS em `dnitgeo_wms_caps.xml`, 229). `Fees=NONE` e `AccessConstraints=NONE`.
- `vgeo:oae_sgo`: 8.795 feições em EPSG:4674.
  - Campos: cod_obra, descr_obra, cod_snv, br, uf, tipo_estr, tipo_obra, km_inicial, extens_m, largura_m, rotation, cod_sgo.
  - 6.428 têm cod_sgo; extens_m falta em 562 e largura_m em 1.937.
  - Tipos: 5.413 pontes, 2.182 viadutos, 600 passarelas, 378 pontilhões, 45 "OAE Inservível" e outros.
  - Texto com mojibake latin1→utf8 (corrigido por `fix()`).
  - **Não há peso, classe nem nota.**
  - RMSP: 139 OAEs (BR-116: 41 viadutos, 41 passarelas e 18 pontes; BR-381: 21 viadutos, 11 passarelas e 7 pontes), todas **sem cod_sgo** → `oae_sgo_rmsp.geojson`.
- `vgeo:vw_oae`: 8.373 feições (id, código, lat/lon, ângulo). Tem 227 "Ponte de Madeira". Não acrescenta atributo.
- `sge_hml:vw_oaes_aprovadas` (homologação do SGE): campos statushistorico, ponto e codigosgo. GetFeature devolve **"permission denied for view vw_oaes_aprovadas"**. FALHOU.
- `vgeo:vw_cadastros`: 943 registros de imóveis e desapropriação. Não é relevante.
- `vgeo:vw_snv_rod` (SNV 202607A): baixado para SP em `snv_sp_202607A.geojson` (416 segmentos, 2,8 MB). Usado para geolocalizar os segmentos SIAET.
- VGeo (Leaflet): https://servicos.dnit.gov.br/vgeo/ (200). Os JS estão salvos e não revelam outras camadas de OAE.
- Exemplo: `curl "https://servicos.dnit.gov.br/dnitgeo/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=vgeo:oae_sgo&outputFormat=application/json&count=3"`

### 2.4 ANTT, dados abertos: "Pontes e similares" — VALOR MÉDIO (localização nas concessões)
- Pacote: https://dados.antt.gov.br/dataset/pontes-similares (CKAN; `antt_pontes_similares.json`). Licença **Creative Commons Atribuição** (uso comercial OK com atribuição). Atualizado em 28/09/2026.
- CSV: https://dados.antt.gov.br/dataset/f9cdb7dc-549f-4bd3-97aa-a35bdff94c26/resource/80cd0864-b0ca-4ab5-bf5a-ffcbeec33235/download/pontes-e-similares-das-rodovias-concedidas.csv (HEAD 200, text/csv). Arquivo de 584 KB, cp1252, separador `;`. Também há a datastore API.
- 3.513 OAEs (1.830 pontes e 1.646 viadutos) de 30 concessionárias, com km e lat/lon de início e fim, sentido e pista. 3 coordenadas são inválidas.
- **Sem peso, classe ou condição** (dicionário em `antt_pontes_dicionario.pdf`).
- RMSP: **130**. Motiva Minas SP BR-381: 35 viadutos e 13 pontes. RIOSP BR-116: 33 viadutos e 14 pontes. Régis BR-116: 25 viadutos e 10 pontes. Arquivo `antt_pontes_rmsp.geojson`.
- Busca no CKAN da ANTT por "monitoracao", "OAE" e "gabarito": 0 pacotes. Os relatórios de monitoração de OAE das concessionárias (exigidos nos contratos) **não são abertos**.
- Vizinho útil (tema altura): "Detecção de Altura / Estação Meteorológica" (`antt_deteccao_altura.csv`, CC-BY) tem 65 detectores de altura, só 1 na RMSP (BR-116, km 296,2, Itapecerica).

### 2.5 OSM (PBF local `sudeste-latest.osm.pbf`)
- Extração: `docker run --rm -v .../data/valhalla:/in:ro osmq-img sh -c 'osmium tags-filter /in/sudeste-latest.osm.pbf w/bridge -o /tmp/b.osm.pbf && osmium export /tmp/b.osm.pbf -f geojsonseq -o -' > osm_work/sudeste_bridges.geojsonseq`
  - A montagem de `/private/tmp` no Colima não grava. Por isso a saída vai por stdout.
- Sudeste: 63.945 ways de ponte com highway; **4.554 com ref BR-xxx**. Desses:
  - **7 têm maxweight** (12, 24 e 25 t: BR-367/MG com 12 t, igual ao SIAET; BR-267 com 25 t; BR-342 com 24 t; SP-125/BR-383 com 25 t; SP-055/BR-101 com 12 t);
  - 15 têm maxheight e 21 têm hgv;
  - nenhum tem maxaxleload.
- Bbox da Grande SP (`osm_bridges_gsp_bbox.geojsonseq`, extraído na 1ª rodada; o Overpass deu timeout, ver `osm_bridges_gsp_bbox.json`): só 9 de 3.209 pontes de vias principais têm maxweight. Das OAEs DNIT e ANTT da RMSP, cerca de 80–90% casam com ponte OSM a 60 m ou menos, mas só 2 têm maxweight (`match_osm.py`).
- Licença ODbL. Não misturar com a base de reportes.

### 2.6 Normas e atos (contexto e semântica)
- **Norma DNIT 010/2024-PRO**, "Inspeções em pontes e viadutos":
  - URL: https://www.gov.br/dnit/pt-br/assuntos/planejamento-e-pesquisa/ipr/coletanea-de-normas/coletanea-de-normas/procedimento-pro/dnit_010_2024_pro.pdf (`dnit_010_2024_pro.pdf` e `.txt`).
  - Notas de 1 a 5: 5 excelente, 4 boa, 3 regular, 2 ruim, 1 crítica. A nota 1 pode exigir "restrição da carga na estrutura, interdição total ou parcial".
  - Inspeção rotineira a cada 2 anos e especial a cada 5.
  - A ficha cadastral tem o campo "Trem-Tipo".
  - Tentativa de baixar a 010/2004: `dnit_010_2004_pro.pdf` é só `{"error_type":"NotFound"}` (FALHOU, URL antiga).
- **IN DNIT nº 2/2026** (05/03/2026), PROARTE:
  - URL: https://www.gov.br/dnit/pt-br/central-de-conteudos/atos-normativos/tipo/instrucao-normativa/2026/instrucao-normativa-no-2-2026
  - Anexo I: https://www.gov.br/dnit/pt-br/central-de-conteudos/atos-normativos/tipo/instrucao-normativa/2026/sei_24791965_anexo_i.pdf
  - Meta de "eliminar OAEs com notas 1 e 2". A reabilitação inclui "atualização do trem-tipo". O registro no SGE é obrigatório.
- **Portarias MT nº 308 e 309/2026** (DOU de 06/05/2026):
  - 308: https://www.in.gov.br/web/dou/-/portaria-n-308-de-5-de-maio-de-2026-703489475
  - 309: https://www.in.gov.br/web/dou/-/portaria-n-309-de-5-de-maio-de-2026-703399805
  - Textos em `dou_portaria_mt_30{8,9}_2026.txt`.
  - O art. 10 da 309 diz que o SGE é o "cadastro geral unificado de todas as OAEs existentes na malha rodoviária federal", com atualização anual e 1 ano para a atualização geral.
  - O art. 13 cria o indicador "% de OAEs críticas".
- **Res. DNIT nº 11/2022** (AET de carga indivisível e excedente):
  - URL: https://www.gov.br/dnit/pt-br/assuntos/infraestrutura-rodoviaria/aet/resolucoes-aet/Resoluon11_2022PortugusBrasil.pdf (200, 994 KB; cópia de texto via LegisWeb em `resolucao_dnit_11_2022.txt`).
  - Define restrição definitiva e temporária, o SGO, o EVE (estudo de viabilidade estrutural das OAE do percurso) e o LTA. Exige consulta de viabilidade acima de 4,50 m de largura, 5,30 m de altura, 30 m de comprimento ou PBTC de 100 t.
  - **Alterada pela Res. DNIT nº 1/2026** (DOU de 25/03/2026, AET digital): https://www.gov.br/dnit/pt-br/assuntos/infraestrutura-rodoviaria/aet/resolucoes-aet/resolucao_n1_19_mar_2026.pdf
- **Res. CONTRAN 882/2021** (pesos e dimensões):
  - URL: https://www.in.gov.br/en/web/dou/-/resolucao-contran-n-882-de-13-de-dezembro-de-2021-370017699 (`contran_882_2021.pdf`).
  - O "limite legal" observa o "limite estabelecido pela sinalização da via". Ou seja, a placa de peso da ponte se sobrepõe ao limite do veículo.
  - CVC acima de 57 t ou acima de 19,80 m só circula com AET (art. 18), com PBTC até 74 t (art. 19).
  - O art. 6º, III, prevê que os OEER informem as limitações das OAE às Forças Armadas.
- Evolução do trem-tipo (Mascarenhas, Vitório, Christoforo e Carvalho, Anais do 62º CBC 2020/IBRACON; arquivo local `vitorio_melo_cbc2020_cargas_moveis.pdf`, URL pública não reencontrada):
  - NB-6/43 com classes I, II e III;
  - NB-6/60 com classes 36, 24 e 12 (vigente de 1960 a 1984);
  - NBR 7188:1984 com classes 45, 30 e 12;
  - NBR 7188:2013 com TB-450 e TB-240.
  - A NBR 7188 e a NBR 9452 (inspeção) são **pagas na ABNT**. Não testado.
- **EnInfra/DNIT, v.4 n.5 (dez/2025)**, "Avaliação patrimonial de OAEs", https://doi.org/10.70859/2764-9539.v4.n5.146 (`eninfra_146.pdf`):
  - Mostra os campos do SGE (UF, rodovia, natureza, tipo, sistema construtivo, nota técnica, extensão, largura).
  - Usa 6.830 OAEs com dois ciclos de inspeção (2018–2021).
  - Cerca de R$ 1,56 bi do patrimônio está em OAEs com notas 1 e 2.

### 2.7 Notícias e alertas do DNIT (fonte de atualização, não estruturada)
- Lista: https://www.gov.br/dnit/pt-br/central-de-conteudos/noticias-alerta-de-servicos (200, HTML). `/RSS` e `/rss.xml` dão 404, ou seja, **não há feed**. Seria preciso raspar o HTML (título e data de publicação).
- Exemplos de pontes:
  - interdição total da ponte do Rio Piancó, BR-361/PB (23/09/2026);
  - restrição de cargas pesadas no Igarapé Baruaninha, BR-432/RR (18/09/2026);
  - interdição total da ponte do Rio das Antas, BR-116/RS;
  - interdição temporária no Igarapé Pará, BR-319/AM.
- Brasil61 (03/02/2025, https://brasil61.com/n/brasil-tem-pontes-bloqueadas-em-nove-estados-informa-dnit-bras2513429) listou pontes com limites de 14, 18, 25, 40, 45, 57 e 72 t. Vários batem com o SIAET (§1 item 3), com valores um pouco diferentes (por exemplo, BR-153/RS com 18 t na notícia e 25 t no SIAET hoje).

### 2.8 Outras fontes avaliadas
- **dados.gov.br**:
  - `dnit_ckan_all.json` tem 12 pacotes do DNIT (condições do pavimento, contagem, pesagem, jurisdição de vias...). **Nenhum de OAE.**
  - A API nova (`dados.gov.br/dados/api/publico/...`) deu **401**, pois exige token. FALHOU sem chave.
  - O CKAN do MT (https://dados.transportes.gov.br, organizações `mpor` e `transportes`) também não tem pacote de OAE ("pontes" retorna 0).
- **PDA DNIT 2024–2026** (https://www.gov.br/dnit/pt-br/plano_de_dados_dnit_junho2024-junho2026.pdf): o inventário e o cronograma **não incluem SGE/OAE**. O PDA do MT 2026–2028 (`mt_pda_2026_2028.pdf`) também não.
- **PROARTE (páginas gov.br)**: só texto institucional. Os "critérios de priorização" são uma imagem JPG do PNMR. Não há dados.
- **TCU**: consulta pública de 2025 com 485 contribuições e 365 pontes indicadas (https://portal.tcu.gov.br/imprensa/noticias/tcu-conclui-consulta-publica-sobre-pontes-federais-com-485-contribuicoes-da-sociedade). Não publica base de dados.
- **CNT, Radar Pontos Críticos 2025** (https://data.cnt.org.br/wp-content/uploads/2026/03/Pontos-criticos-2025.pdf, 200, 12 págs.): os pontos de "ponte estreita" e "ponte caída" são georreferenciados internamente, mas o PDF só traz agregados por UF. Sem dado por ponto. Licença não declarada.
- **Apresentação do DNIT na CVT da Câmara** (04/11/2025): https://www2.camara.leg.br/atividade-legislativa/comissoes/comissoes-permanentes/cvt/apresentacoes-em-eventos/eventos-2025/arquivos-de-eventos-2025/ap-25-11-04-fabio-pessoa-dnit (PDF de 13 págs.). Fala em "400 OAEs com notas 1 e 2".
- **Ata da 10ª Reunião Ordinária da Diretoria Colegiada do DNIT** (18/03/2025): https://www.gov.br/dnit/pt-br/composicao/diretoria-colegiada/atas/2025/ata-da-10a-reuniao-ordinaria-da-colegiada-de-18-03-25.pdf. Registra 7.815 OAEs, com o PROARTE atuando em média em 4,62 OAEs por ano.
- Endpoints do SGE e do SGO: `servicos.dnit.gov.br/sge` deu 404; `/sgo` e `sge.dnit.gov.br` não responderam. **Não há acesso público.**
- **DER-SP OAE** (estadual, CC-BY-4.0, 1.873 OAEs, sem peso): fica no tema `pontes_sp_estado_municipio`. Cópia aqui em `der_sp_oae.xlsx`.

## 3. Validações
### 3.1 Colunas do PDF de restrição definitiva
Posições x medidas no cabeçalho (pdfplumber), Pista 1: Altura 394 | Larg. faixa 449 | Larg. total 504 | **Peso 555** | Raio de giro 606 | Comp. 658. A Pista 2 fica deslocada em +316.
O valor "150,0" da BR-116/SP km 117,3–127,6 cai em x=555, então é Peso (t). O parser está correto.

### 3.2 RMSP × SIAET (`aet_rmsp.py` → `aet_restricoes_rmsp.geojson`)
- SNV 202607A: 30 segmentos tocam a RMSP. Os federais são BR-116 e BR-381 em Concessão Federal, todos com pista dupla.
- Restrição definitiva na RMSP: 11 segmentos. Altura mínima de 5,4 m (Régis), largura de faixa mínima de 4,3 m (BR-381 km 64,9–83,9, Pista 1). **Sem peso.**
- Restrição temporária na RMSP: 11 segmentos. Altura de 5,0 a 6,3 m, peso de 150 t (Dutra) e 180 t (Régis). O 116BSP2550 tem 0 porque não é jurisdição federal.
- **Nenhum desses valores afeta veículo legal** (altura até 4,40 m, PBTC até 74 t).

### 3.3 Nota × limite (`powerbi_oae` + SIAET pelo código SNV)
| Nota | Sem registro SIAET | Segmento sem peso | Limite >74 t | 57–74 t | ≤57 t | Bloqueio 0 |
|---|---|---|---|---|---|---|
| 1 | 46 | 94 | 13 | 2 | 16 | 7 |
| 2 | 202 | 441 | 37 | 20 | 43 | 15 |

Entre as pontes de madeira (728): 455 sem registro, 196 com 57 t ou menos, 48 com bloqueio 0.

## 4. Como integrar ao app
1. **Tabela `federal_road_restrictions`** (Postgres/PostGIS, fonte separada):
   - Campos: `source='DNIT_SIAET'`, `tipo` (definitiva/temporaria), `br`, `uf`, `pnv`, `km_ini`, `km_fim`, `pista` (1 = crescente, 2 = decrescente), `max_height_m`, `max_width_m`, `max_weight_t`, `max_length_m`, `blocked_aet` (bool para 0), `ref_month`, `geom` (linha do SNV `vw_snv_rod` pelo `Codigo_SNV`).
   - Importador mensal: baixa 54 PDFs, parseia com `parse_aet.py` e faz diff contra o mês anterior, com alerta quando surgir peso de 57 t ou menos ou bloqueio.
2. **Uso no roteamento (Valhalla):**
   - (a) Converter os segmentos com `max_weight_t` menor que o PBT do preset em `exclude_polygons` (buffer de cerca de 15 m da geometria do segmento) **só para os presets acima do limite**. Os limites de 23 a 57 t afetam Truck, Carreta e Bitrem.
   - (b) **Não usar o valor 0 para veículo legal**: ele significa AET bloqueada. Aplicar só nos presets que exigem AET (Rodotrem e CVC acima de 57 t) e para carga excedente.
   - (c) A altura e a largura do SIAET valem para carga excedente. Mesmo assim, há **60 segmentos definitivos com altura de 4,5 m ou menos** Desses, 4 têm menos de 4,4 m: BR-030/BA (4,0), BR-101/RJ km 350,4–353,2 (4,0), BR-495/RJ (4,0) e BR-277/PR km 0–4,7 (4,1). Muitos outros têm exatamente 4,4 m (BR-174/AM, BR-010/TO, BR-343/PI, BR-050/SP km 0–5,7). Também há 30 temporários com 4,5 m ou menos. Isso **afeta** caminhão alto ou baú de 4,40 m. Usar como `max_height` do segmento, junto com o tema `altura_sinalizacao`.
   - Como o segmento PNV é longo (km), preferir projetar sobre o way OSM da ponte quando o segmento tem 1 OAE (59 casos), usando o ponto do `oae_sgo` e a OSM bridge mais próxima, e aplicar o bloqueio só ali.
3. **Camada informativa `bridges_federal`:** `oae_federal_merged.geojson` (8.795 pontos, gerado por `build_merged.py`) junta o ponto do `oae_sgo`, a nota e a data de vistoria do Power BI e o limite SIAET do segmento.
   - No front: ícone de ponte com cor pela nota, tooltip "Nota DNIT X (vistoria AAAA) — dado defasado".
   - Nota 1 ou 2 **não bloqueia**: dispara um aviso na rota e pede confirmação colaborativa (`weight_limit`, `road_closed`).
4. **Reportes colaborativos:** pré-semear as "perguntas" ("Há placa de peso nesta ponte?") nas OAEs com nota 1 ou 2 e nas que estão em segmento SIAET com 57 t ou menos. A resposta fica na base de reportes, **separada do OSM**.
5. **Alertas DNIT:** raspagem diária da lista "noticias-alerta-de-servicos" com filtro "ponte|viaduto|interdi|restri". Vira item de fila para curadoria humana e depois um registro `road_closed` ou `weight_limit` com validade.
6. **Pedido via LAI (Fala.BR) ao DNIT:** extração do SGE com código SGO, coordenada, **trem-tipo**, ano de construção, nota atual e data, incluindo concessões. Isso fica possível após a Portaria MT 309/2026. Pedir também a licença de reuso.
7. **Licenças:**
   - SIAET, WFS e notícias: informação pública e ato oficial; citar DNIT.
   - ANTT: CC-BY.
   - Power BI: sem licença declarada; tratar como referência e pedir formalização.
   - OSM: ODbL; manter em camada própria.
   - Reportes: base própria, separada.

## 5. Lacunas
- Não existe limite de peso **pontual** (por ponte) em base aberta. O SIAET é por segmento e o OSM quase não tem a tag.
- A classe de projeto (trem-tipo) e o ano de construção por OAE não são públicos.
- As notas do Power BI são de 2020–2021, com refresh em 09/04/2025, e não cobrem concessões em SP. Concessões ANTT não têm condição pública.
- O SIAET atrasa em relação aos alertas e às interdições (exemplos do Piancó e do Baruaninha).
- O `cod_snv` do `oae_sgo` às vezes é de versão antiga do SNV. 224 segmentos com limite ficaram sem OAE associada.
- Não reencontrei a URL pública do artigo do CBC 2020. NBR 7188 e NBR 9452 não foram consultadas (pagas).
- A API do Power BI não é documentada. O host `-redirect` falha por curl e o `-api` funciona.

## 6. Arquivos principais
- **SIAET:**
  - originais em `aet_pdfs/` (54 PDFs);
  - `aet_restricoes_{definitiva,temporaria}_2026-10.csv`;
  - `aet_restricoes_rmsp.geojson`;
  - `aet_restricoes_peso_baixo_x_oae.json`;
  - scripts `parse_aet.py`, `aet_rmsp.py` e `aet_join_oae.py`.
- **Power BI:** `powerbi_oae/{planilhao.csv, base_braulios.csv, mae.json, schema.json (gzip), pbi_query.py, analise.py}`.
- **DNITGeo:** `oae_sgo_full.json`, `vw_oae_full.json`, `oae_sgo_rmsp.geojson`, `snv_sp_202607A.geojson`, `snv_br_current_attrs.json` e as capabilities.
- **ANTT:** `antt_pontes_similares.csv`, `antt_pontes_rmsp.geojson`, `antt_deteccao_altura.csv`.
- **OSM:** `osm_work/sudeste_bridges.geojsonseq`, `osm_br_bridges.py`, `match_osm.py`.
- **Junção:** `oae_federal_merged.geojson` e `build_merged.py`.
- **Atos e textos:** `dnit_010_2024_pro.*`, `in_2_2026.*`, `in2_2026_anexo_i.*`, `dou_portaria_mt_30{8,9}_2026.txt`, `resolucao_dnit_{11_2022.txt,1_2026.pdf}`, `contran_882_2021.pdf`, `eninfra_146.*`, `camara_dnit_2025-11-04.pdf`, `dnit_ata_10_2025.pdf`, `cnt_pontos_criticos_2025.*`.
