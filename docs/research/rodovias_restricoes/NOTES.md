# Restrições de caminhão em rodovias: feriados, horários e operações especiais (pesquisa em 09/10/2026)

Pasta: `research/rodovias_restricoes/`. Tudo abaixo foi testado com curl, python3, osmium e GDAL (Docker), salvo onde está marcado "NÃO TESTADO".

## 1. Resumo do que muda decisões

1. **PRF, feriados nacionais (rodovias federais).** A regra vale para veículos **excedentes** (L>2,60 m, H>4,40 m, C>19,80 m ou PBTC>58,5 t) e para CVC/CTV/CTVP **mesmo com AET/AE**. Ela atinge **só a pista simples**, com exceções por UF. Em 2026 a regra está na Portaria DIOP/PRF nº 121, de 08/09/2026, publicada no DOU de 09/09/2026 (edição extra). Essa portaria revogou a nº 26/2026, que já tinha revogado a nº 12/2026, que por sua vez revogou a nº 172/2025. **Foram 3 revisões no mesmo ano**, então é preciso monitorar o DOU.
   - O padrão é sempre o mesmo: véspera 16h–22h, dia do feriado 06h–12h e último dia 16h–22h. Nas eleições a janela é 07h–18h.
   - Em 2026 são **30 janelas nacionais** (190 h). Há ainda 3 janelas de Festejos Juninos (BA, PB, PE e RN), 6 trechos especiais em SP (Aparecida) e 1 trecho em MS.
   - A PRF **não segue a lista de feriados**: Tiradentes (21/04), Finados (02/11) e 15/11 ficaram de fora, e os dois turnos das eleições entraram. Por isso não dá para tirar a restrição de uma API de feriados como a BrasilAPI.
2. **Grande SP.** Pelo SNV do DNIT (07/2026), toda rodovia federal sob jurisdição federal no recorte RMSP é **duplicada** (BR-116 Dutra/Régis com 187,7 km e BR-381 Fernão Dias com 58,6 km). Assim, a restrição de pista simples da PRF **não se aplica na Grande SP**. A única exceção é a operação **N. Sra. Aparecida em SP**, que vale para quem tem AET/AE:
   - BR-116 km 0–231 (Dutra inteira em SP, de 02 ou 05/10 a 12/10), com largura >3,20 m na semana anterior e todas as restrições de 09 a 12/10;
   - BR-459 km 0–32;
   - BR-488 km 0–5.
3. **Brasil.** A regra federal cobre cerca de **58.000 km** de pista simples federal pavimentada (SNV 202607A, jurisdição federal, sem AC, AM, AP, PA e RR). MS e RO entram só no Fim de Ano.
4. **Sistema Anchieta-Imigrantes (Porto de Santos)** tem o maior impacto para o piloto:
   - **Descer** a serra pela Imigrantes é proibido para caminhões, ônibus e vans (Portaria ARTESP 11/2002, citada no FAQ da Ecovias).
   - **Subir** pela Imigrantes aparece como "restrição de pesados" (status ao vivo no site da Ecovias, km 62→40 sentido SP) e como mensagens diárias nos PMVs ("CAMINHÕES SP DEVEM UTILIZAR SERRA ANCHIETA").
   - O OSM local já tem `hgv=no` em 24 ways da pista sul. O Valhalla local manda o caminhão pela Anchieta **nos dois sentidos** (testado: Santos↔SP).
   - Na **Anchieta serra (km 40–55)**, a Portaria SUP/DER-084/2023 diz que CVC com AET (até 74 t e 30 m, ou seja, rodotrem e bitrem de 9 eixos) **só circula de madrugada, de segunda a sexta (23h–05h)**, e nunca em feriados prolongados. Conjuntos de carga indivisível e ônibus com mais de 26 m são proibidos. CVC não usa a faixa esquerda entre 18h e 20h. **Hoje o app não modela nada disso.**
5. **SP-055 Litoral Sul (Padre Manoel da Nóbrega, km 327→270,4, sentido Cubatão).** O DER publica todo verão uma portaria que proíbe pesados aos domingos, das 12h às 06h de segunda (2023/24, 2024/25 e 2025/26). Ela é revogada depois da temporada. Em dezembro de 2026 deve sair outra.
6. **AutoBAn, "Operação Caminhão".** Aos domingos e feriados anunciados, das 14h às 22h, o caminhão que vai para a Capital pela Bandeirantes tem de sair no km 48 e seguir pela Anhanguera até o km 23. Em 2025 houve 50 dias com mensagem nos PMVs. Não achei portaria no DOE: é uma medida operacional anunciada em release.
7. **O OSM quase não tem restrição temporal de caminhão.** Em todo o Sudeste há só 53 ways com `hgv/maxweight/maxlength/hazmat:conditional`. Na RMSP+Baixada são 6 ways com `hgv:conditional` (3 na SP-015 e 3 na ZMRC) e nenhum codifica regra da PRF ou do DER. **Precisamos de uma camada própria de restrições temporais.**
8. **Nenhuma fonte oficial traz essas regras em formato estruturado.** PRF tem HTML do DOU com tabela e PNG no gov.br. DER tem texto no DOE-SP (API JSON não documentada). Concessionárias publicam releases e redes sociais. A ARTESP publica PMVs em CSV, que servem de **registro histórico** das operações, com cerca de 1 mês de atraso.

## 2. Fontes testadas

### 2.1 PRF: página "Restrição de Tráfego" (por ano)
- URL: https://www.gov.br/prf/pt-br/seguranca-viaria/restricao-de-trafego (com sub-páginas de 2022 a 2026)
- Teste: HTTP 200. O texto de 2026 está em HTML, mas o **Anexo I é imagem PNG** (`.../restricao-de-trafego-2026/image.png/@@download/image`, 50 kB, e `image-1.png`, 37 kB). Os anos anteriores trazem PDFs por portaria (2023 tem portarias estaduais das superintendências: PR, SC, ES, MG, RN, CE e PI).
- Licença do portal: CC BY-ND 3.0 (rodapé gov.br). Ato oficial é domínio público pela Lei 9.610/98, art. 8º, IV.
- Arquivos: `prf_restricao_20xx.html`, `prf2026_anexo_image*.png`, `prf_portaria_12_2026.pdf`

### 2.2 DOU (Imprensa Nacional): texto das portarias
- Busca: `https://www.in.gov.br/consulta/-/buscar/dou?q=...` devolve um JSON embutido no HTML, no script `_br_com_seatecnologia_in_buscadou_BuscaDouPortlet_params`. Script: `dou_search.py`.
- Portaria 121/2026: https://www.in.gov.br/web/dou/-/portaria-diop/prf-n-121-de-8-de-setembro-de-2026-730790480 (HTTP 200, 105 kB). **A tabela vem em `<table>` HTML**, que dá para parsear: `dou_portaria_121_2026.txt`.
- Resultado estruturado: `prf_2026_restricoes_estruturado.csv/json` com 40 linhas (30 nacionais, 3 juninas, 6 de SP e 1 de MS).
- Também no DOU: Portaria DNIT nº 4.447/2026, restrição pontual no feriado de 7/9 na ponte do Estreito dos Mosquitos (BR-135/MA, km 24,4–24,9), arquivo `dnit_portaria_4447_2026.txt`; e Resolução DNIT nº 1/2026, que alterou a Resolução DNIT nº 11/2022 sobre AET digital, arquivo `dnit_resolucao_1_2026.txt`.
- A busca do DOU não achou o texto da Res. CONTRAN 882/2021. Para os arts. 18–20, usei um resumo do legisweb (fonte secundária): CVC acima de 57 t ou 19,80 m precisa de AET; limite de 74 t e 30 m; circulação "do amanhecer ao pôr do sol" a 80 km/h, com trânsito diuturno em pista dupla. **Conferir no texto oficial.** A cópia em PDF da UDOP devolveu HTML.

### 2.3 DNIT SNV: base geométrica das rodovias federais com km
- URL: Nextcloud público `http://servicos.dnit.gov.br/dnitcloud/index.php/s/oTpPRmYs5AAdiNr`. Dá para listar por WebDAV: `curl -u "oTpPRmYs5AAdiNr:" -X PROPFIND -H "Depth: 1" https://servicos.dnit.gov.br/dnitcloud/public.php/webdav/`
- Último arquivo: `SNV Bases Geométricas (2013-Atual) (SHP)/202607A.zip`, com 68,5 MB baixados. Tem 7.673 trechos, EPSG:4674 e os campos `vl_br, sg_uf, vl_km_inic, vl_km_fina, ds_sup_fed (DUP/PAV/PLA/...), ds_jurisdi, vl_codigo`. Há também planilhas XLS (`SNV_202607A.xls`, 2,6 MB).
- Uso: converter "BR-116 km 0–231 SP" em geometria e separar pista simples (PAV) de duplicada (DUP), que é o escopo da PRF.
- Números: Brasil (federal) tem 65.415 km de PAV e 9.182 km de DUP. Tirando AC, AM, AP, PA e RR, ficam 58.024 km de PAV. SP (federal) tem 450 km de PAV e 749 km de DUP. A RMSP tem 0 km de PAV federal.
- Licença: dado público federal, sem licença explícita na pasta. **Confirmar.**

### 2.4 ARTESP: dados abertos (CKAN)
- API: https://dadosabertos.artesp.sp.gov.br/api/3/action/package_list (47 conjuntos). A licença da maioria é **CC BY**, então o uso comercial é permitido com atribuição.
- **Mensagens PMV** (`registro-de-mensagens-em-paineis`): CSV anual, 2025 com 49 MB e 257.495 linhas. Campos: CONCESSIONARIA, RODOVIA, SENTIDO, KM, TIPO_MENSAGEM, MENSAGEM, MUNICIPIO, LAT, LON, DATA, HORA. O arquivo de 2026 tem 84 MB e foi atualizado em 21/08/2026.
  - Em 2025, 25.063 mensagens tratam de caminhão ou operação.
  - Ecovias: "Operação Descida" aparece em 74 dias, "Operação Subida" em 237 dias e "Comboio" em 1.069 mensagens.
  - Proibição ou restrição de pesados na Ecovias: 5.799 mensagens em 339 dias.
  - AutoBAn, "Operação Caminhão": 375 mensagens em 50 dias, 317 delas em domingos, das 13h às 23h.
  - "Cargas especiais / Imigrantes fechada": 1.033 mensagens, sobretudo das 22h às 00h.
- **Malha rodoviária**: XLSX com 1,9 MB e KMZ por concessionária (Ecovias Imigrantes com 3 MB, Rodoanel com 0,5 MB e outras).
- **Camadas auxiliares** (Google Drive público, pasta 1icWZ6vr2O-JyfrPeYUJkCMjp6BERMg6Z):
  - `marcos_quilometricos.gpkg` (1,66 MB, 8.300 marcos de concessionárias, entre eles SP150 com 57, SP160 com 63, SP055 com 178, SP021 com 131 e SP348 com 161). Baixado em `estadual/`.
  - `rodovias_sirgas2000.gpkg` é **derivado do OSM** (os campos são tags OSM), portanto fica sob ODbL.
- Também úteis: `ocorrencias` (panes, alagamento e queda de talude, atualizado diariamente), `volume-de-trafego` (praças e SAT, por hora) e `programacao-de-obras` (schema GeoJSON).
- `legislacao-portarias-20xx` traz só atos administrativos da ARTESP, sem nenhuma restrição de tráfego. A Portaria 11/2002 é anterior ao acervo, que começa em 2004.

### 2.5 DOE-SP (DER-SP): portarias de circulação
- Busca (API JSON não documentada, achada no bundle do site): `https://do-api-web-search.doe.sp.gov.br/v2/advanced-search/publications?Terms[0]=...&FromDate=...&ToDate=...&PageSize=50&PageNumber=1&SortField=Date&periodStartingDate=personalized`
- Texto: `https://do-api-web-search.doe.sp.gov.br/v2/publications/{slug}` devolve JSON com o campo `content` em HTML. Scripts: `doe_sp/doe_search.py` e `doe_sp/doe_fetch_slug.py`. **Só encontrei atos de 2023 em diante.**
- Atos encontrados (texto em `doe_sp/txt_*.txt`):
  - SUP/DER-084-01/11/2023: Anchieta serra km 40–55, com as regras de CVC/AET descritas acima.
  - SUP/DER-075/2023, SUP/DER-174/2024 e PR/DER-228/2025: SP-055 km 327→270,4, sentido leste, pesados proibidos no verão. As revogações saíram em SUP/DER-014/2024, PR/DER-073/2025 e PR/DER-127/2026.
  - PR/DER-147/2025: SP-055 km 130–198,3, proíbe carga com C>14 m e PBT>23 t.
  - PR/DER-164/2025: SP-008 km 25,28–31,5, proíbe C>14 m e produtos perigosos.
  - SUP/DER-037/2024: SP-148 km 58,7–59,0, proíbe PBT>12 t e C>14 m.
  - PR/DER-145/2025: SP-215 km 0–26, proíbe C>14 m.
  - SUP/DER-062/2024: SP-324 km 86,62–90,7, proíbe produtos perigosos.
  - SUP/DER-001/2024: **revoga** as proibições de carga na SP-099 Tamoios (SUP/DER-061/2015 e 133/2021).
  - PR/DER-047/2026: norma do estudo de viabilidade para AET de CVC até 91 t (Res. CONTRAN 872/2021).
- Licença: ato oficial (art. 8º da Lei 9.610/98). Os termos de uso da API não foram localizados.

### 2.6 CETESB ArcGIS: malha rodoviária estadual (km inicial e final por trecho)
- `https://arcgis.cetesb.sp.gov.br/server/rest/services/Hosted/Malha_Rodovi%C3%A1ria_Estadual_SP/FeatureServer/0/query` (HTTP 200).
- 4.777 trechos e 843 rodovias. Campos: rodovia, kminicial, kmfinal, tipopista (DUP/PAV), administra, jurisdicao. A consulta aceita `f=geojson`.
- Licença: o serviço não diz qual é. **Confirmar.**

### 2.7 Concessionárias
- **Ecovias Imigrantes** (`ecoviasimigrantes.com.br`): curl e WebFetch recebem **HTTP 403** (WAF). Pelo navegador embutido abriram:
  - `/condicoes-da-via`: status por trecho, HTML renderizado no servidor; snapshot em `concessionarias/ecovias_condicoes_snapshot_2026-10-09.txt`;
  - `/atendimento/duvidas`: o FAQ cita a Portaria ARTESP 11/2002 e as regras do comboio;
  - `/institucional/sistema-anchieta-imigrantes`: extensão por km.
  - A URL antiga da Portaria ARTESP 11/2002 (`artesp.sp.gov.br/Shared Documents/...`) devolve HTML de 1 kB, então o link está quebrado.
- **Motiva AutoBAn** (`rodovias.motiva.com.br/autoban/...`): HTTP 200. O release da Páscoa de 2026 confirma a Operação Caminhão. A página "motoristas-de-caminhao" de autoban, viaoeste, rodoanel e spvias diz que carga excepcional (largura ≥4,50 m, altura ≥5,40 m, comprimento ≥35 m ou PBT >100 t) exige agendamento prévio.
- **Concessionária Tamoios** (`www23.concessionariatamoios.com.br/a-tamoios/restricoes`): HTTP 200. Descreve a Operação Comboio com fechamento da Serra Antiga por chuva, decidido por 5 estações meteorológicas. Horários só no Instagram e no X (@tamoios099). Não há API.

### 2.8 OSM local (`sudeste-latest.osm.pbf`) com osmium
- Recorte usado: bbox -47,40 -24,20 -45,60 -23,10 (RMSP + Baixada).
- Contagens:
  - `*:conditional` em 194 ways, quase todas `motor_vehicle`, ciclofaixa ou Paulista;
  - `hgv:conditional` em só 6;
  - `hgv:lanes` em 16 (SP-160 e SP-150);
  - SP-160 tem 24 ways com `hgv=no` e 22 com `hazmat=no` (trecho de túneis da pista sul).
- Sudeste inteiro: 53 ways com conditional de caminhão.
- O Rodoanel Norte trecho 1 está como motorway (`opening_date=2025-12-22`, cerca de 49,7 km somando as duas pistas). Ainda há 11,1 km em `construction`.

### 2.9 Valhalla local (localhost:8002)
- Teste em `valhalla_tests/*.json`:
  - truck de Santos para SP: Anchieta → Rodoanel → Imigrantes no planalto, 67,3 km;
  - truck de SP para Santos: Imigrantes no planalto → Interligação → Anchieta, 71,3 km.
- Ou seja, o OSM já respeita a proibição da Imigrantes serra. As janelas de CVC/AET na Anchieta não são modeladas.

### 2.10 Calendário
- BrasilAPI `https://brasilapi.com.br/api/feriados/v1/2026`: HTTP 200, 14 datas "national" (inclui Carnaval e Corpus Christi). Não traz feriados estaduais nem municipais. Licença MIT do projeto (os dados vêm de lei). **A restrição da PRF não deve ser derivada dela.**

### 2.11 Outras fontes vistas
- DER-MG: Portaria nº 4.162/2025 (Agência Minas) restringe CVC, CTV e indivisíveis com AET em estaduais de pista simples e em trechos duplicados no Carnaval e na Romaria. Mostra que **cada DER estadual tem regra própria**.
- PRF dados abertos, infrações: https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-infracoes. A página lista até 2021, e a principal tem links do Drive. NÃO BAIXADO. Serviria para medir a fiscalização do código 574-61 (art. 187 I) em feriados.

## 3. Falhas e lacunas
- Res. CONTRAN 882/2021: não achei o texto oficial em gov.br pela busca. A cópia da UDOP veio como HTML. O limite de 57 t (art. 18, segundo legisweb) diverge dos 58,5 t da PRF. Conferir o texto consolidado.
- Portaria ARTESP 11/2002: o link antigo está quebrado, e a portaria é anterior ao CKAN. Fica a citação do FAQ da Ecovias.
- A base normativa da "restrição de pesados" na subida da Imigrantes e da "Operação Caminhão" da AutoBAn não foi localizada no DOE-SP, que só tem acervo a partir de 2023.
- Portaria SUP/DER-138/2021 (AET de indivisível, citada por blog): **não confirmada**. O DOE só achou outra portaria com o mesmo número.
- Operações Descida, Subida e Comboio são dinâmicas e não existe feed estruturado. As fontes são o status no site da Ecovias (com WAF), o X e o Instagram, e o CSV de PMV da ARTESP, que chega cerca de 1 mês depois.
- Caminhões na Marginal Tietê e Pinheiros e as VER da CET ficaram para o tema `restricoes_sp_capital`.
- O orçamento de WebSearch da sessão acabou. A busca da portaria de 2026 do DER-MG e a de "faixa exclusiva" ficaram incompletas.

## 4. Como integrar no app
1. **Tabela `time_restrictions`** (Postgres/PostGIS), separada do OSM e dos reportes. Campos:
   - `id`, `source`, `act`, `act_url`, `published_at`, `revoked_by`;
   - `scope` (federal_pista_simples / trecho / UF), `road_ref`, `km_ini`, `km_fim`, `direction`, `geom` (multilinestring);
   - `vehicle_rule` (jsonb com min_width, min_height, min_length, min_pbtc, requires_aet, classes, hazmat);
   - `windows` (tstzrange[] ou RRULE e opening_hours), `action` (forbid/divert/lane), `status_verificacao`.
2. **Importadores:**
   - (a) PRF: job semanal na busca do DOU (`dou_search.py` com "DIOP/PRF" e "restrição do trânsito"). Faz parse da tabela HTML (`dou_portaria_121_2026.txt`) e alerta quando houver revogação.
   - (b) DER-SP: job diário na API do DOE-SP com os termos "Dispõe sobre a circulação de veículos", "fica proibido o tráfego" e "veículos pesados", filtrando hierarchy=DER. Extração semiautomática com revisão humana.
   - (c) DNIT: portarias DNIT no DOU.
3. **Geometria:**
   - Federal: SNV (`vl_br`, `vl_km_inic`, `vl_km_fina`). Para "pista simples", usar `ds_sup_fed='PAV'` e jurisdição Federal.
   - Estadual: `marcos_quilometricos.gpkg` (ARTESP) com interpolação ou CETESB kminicial/kmfinal. Projetar sobre os ways do OSM por map-matching (Valhalla `trace_attributes`) para obter edge IDs.
4. **Roteamento:**
   - Na hora da requisição, calcular as restrições ativas para (data/hora prevista em cada trecho × perfil do veículo).
   - Nos presets **Bitrem 9 eixos e Rodotrem** (CVC com AET), e em carga excedente, aplicar `exclude_polygons` (buffer do trecho) ou um `exclude_locations` equivalente.
   - Preset Carreta/Bitrem dentro dos limites (≤19,80 m e ≤58,5 t) **não** é afetado pela PRF.
   - Anchieta km 40–55 para CVC/AET: se a ETA cair fora das janelas noturnas, devolver um aviso com o "próximo horário permitido" ou bloquear.
5. **Front:**
   - Calendário de restrições, com banner "feriado com restrição PRF para o seu perfil".
   - Badge "operação ativa" no SAI e na AutoBAn (Operação Caminhão aos domingos das 14h às 22h, regra "provável", com o texto de que é operacional).
   - Aviso de comboio e neblina.
6. **Licenças:**
   - Atos oficiais (DOU e DOE) são domínio público.
   - ARTESP CKAN é CC BY (atribuir "ARTESP").
   - Páginas gov.br são CC BY-ND (copiar só o dado/ato, não o layout).
   - Camadas ARTESP derivadas do OSM ficam sob ODbL; manter separadas dos reportes.
   - Concessionárias: sem licença, então só links e resumos.
