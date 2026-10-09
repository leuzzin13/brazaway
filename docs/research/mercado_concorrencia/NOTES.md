# Mercado e concorrência: frota, perfil do caminhoneiro e apps (pesquisa de 09/10/2026)

Pasta: esta. A rodada anterior foi interrompida antes de criar a pasta, então nada tinha sido salvo. Comecei do zero.
Roubo de carga já foi levantado em detalhe em `../seguranca_acidentes_roubo/NOTES.md` (SSP-SP, Sinesp, ISP-RJ). Aqui só faço referência a ele.

Subpastas: `senatran/` (frota Renavam e Renach), `antt_rntrc/` (RNTRC, anuário, infográfico RAIS), `cnt/` (pesquisas CNT 2019 e 2025),
`apps/` (Google Play, App Store e documentação de Google, HERE, Mapbox e Maplink), `outros/` (CNTA 2025, Fenabrave, StatCounter, Cetic, SEST SENAT).
Python com pandas: `../seguranca_acidentes_roubo/.venv/bin/python`.
Volume baixado: cerca de 134 MB guardados, mais 161 MB lidos em streaming sem gravar (CSV de transportadores do RNTRC, que tem CPF e CNPJ).
Arquivos grandes medidos só por HEAD ou Range: Renavam marca/modelo (137 MB zip, 1,2 GB descompactado) e RAIS SP 2024 (1,07 GB .7z).
No fim da sessão acabou a cota de buscas na web (200). O que faltou checar está em "Lacunas".

---------------------------------------------------------------------------------------------------
## 1. SENATRAN – Frota de veículos (Renavam) – TESTADO OK
- Página: https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/frota-de-veiculos-2026 (HTTP 200)
  Os arquivos ficam em .../conteudo-Senatran/frota-de-veiculos-2026-2/<arquivo>.xlsx.
  **HEAD devolve 403, mas GET com User-Agent de navegador devolve 200.** Range também funciona.
- Agosto/2026 (o mês mais recente na página):
  - `Frota_por_uf_e_tipo_de_veiculo_Agosto_2026.xlsx` (27 KB)
  - `Frota_por_municipio_e_tipo_Agosto_2026.xlsx` (735 KB, 5.572 municípios, 22 tipos)
  - `G_Frota_por_UF_Municipio_TIPO_ESPECIE_EIXOS_Agosto_2026.xlsx` (8,0 MB, 277.544 linhas: UF, município, tipo, espécie, eixos e quantidade)
  - `F_..._ANO_FAB_MOD_...` (17,5 MB) não separa por tipo de veículo e não serve aqui. Baixei, olhei e apaguei.
  - `H_..._RESTRICAO_...` (1 MB) também não separa por tipo. Tem a categoria "Restrição por Roubo e Furto", mas sem tipo de veículo não ajuda.
- CKAN: https://dados.transportes.gov.br/api/3/action/package_show?id=registro-nacional-de-veiculos-automotores-renavam
  (158 recursos, licença "Outra (Domínio Público)"). Traz também `i_frota_por_uf_municipio_marca_e_modelo_ano_<mes>_2026.zip`, com
  137 MB até set/2026 e colunas UF;Município;Marca Modelo;Ano;Qtd. Esse arquivo **não tem tipo de veículo**: para separar VUC, toco e truck
  seria preciso uma tabela de modelos (FIPE). Li só o cabeçalho, por Range (`senatran/zip_peek2.py`).
- Resultados (ago/2026, frota registrada com placa):
  | Recorte | Caminhão | Caminhão-trator | Reboque | Semirreboque | Caminhonete | Total geral |
  |---|---|---|---|---|---|---|
  | Brasil | 3.253.427 | 1.029.220 | 2.711.019 | 1.494.881 | 10.471.742 | 132.827.716 |
  | Estado de SP | 742.271 | 248.914 | 565.525 | 358.114 | 2.359.378 | 36.072.610 |
  | RMSP (39 municípios) | 279.623 | 85.638 | 129.606 | 121.778 | 934.761 | 16.499.929 |
  | Capital SP | 148.752 | 40.768 | 73.375 | 51.013 | 560.699 | 10.138.862 |
  Somando caminhão e caminhão-trator, a RMSP tem 365.261 veículos (8,5% do Brasil) e o estado de SP tem 991.185 (23,1%).
  Na RMSP, os municípios seguintes à capital são Guarulhos (22.548 + 9.248), São Bernardo (10.696 + 10.006), Osasco, Santo André e Barueri.
- O campo de eixos (arquivo G) não é confiável. Eixos = 0 aparecem em 29% dos caminhões no Brasil e em **63% na RMSP**.
  Entre os registros preenchidos da RMSP, os caminhões se dividem em 2 eixos (17.147), 3 eixos (77.507) e 4 eixos (7.610).
  Não dá para estimar a participação de VUC, toco e truck por aí. Amostra: `senatran/amostra_eixos_rmsp_ago2026.csv`.
- Feito para o app: `senatran/frota_caminhoes_municipios_ago2026.csv`, com a frota de caminhões por município e o código IBGE
  (cruzamento pelo nome normalizado mais a UF, usando https://servicodados.ibge.gov.br/api/v1/localidades/municipios).
  37 de 5.572 municípios não casaram por grafia diferente ou nome cortado em 30 caracteres. Os 39 da RMSP casaram.
- Ressalva: "frota registrada" não é "frota em circulação". Veículos baixados de fato sem baixa no Renavam continuam contando, e caminhões de
  outras UFs que rodam na RMSP não entram na conta da RMSP.
- Scripts: `senatran/frota_an.py`, `eixos_an.py` e `frota_ibge.py`.

## 2. SENATRAN – RENACH (condutores habilitados) – TESTADO OK, mas DESATUALIZADO
- CKAN: https://dados.transportes.gov.br/api/3/action/package_show?id=renach (55 recursos, "Other (Public Domain)").
  **O recurso mais recente é de 08/2024.** Não há nenhum de 2025 ou 2026 no CKAN.
  As páginas `.../conteudo-Senatran/condutores-habilitados*` e `estatisticas-*` dão 404.
- Arquivo: `quantidadedecondutoreshabilitadosporregioufsexofaixaetriaporcategoriaagosto2024.csv` (744 KB, UTF-16, separador vírgula, números com ponto de milhar)
- Ago/2024: 84.168.606 habilitados no Brasil. Somando C, D, E, AC, AD e AE são 11.514.077, dos quais 3.164.858 em SP.
  Categoria E ou AE (carreta): 2.269.636 no Brasil e 564.001 em SP.
  Nas categorias C a E, 96,6% são homens. Na E/AE, 41% têm 51 anos ou mais e só 5% têm até 30 anos.
- Ressalva: categoria D também autoriza conduzir caminhão, então o número de habilitados é bem maior que o de caminhoneiros ativos.
  Use como teto. Análise em `senatran/renach_an.txt`.

## 3. ANTT – RNTRC (transportadores e veículos) – TESTADO OK (é a melhor fonte de "quem é o cliente")
- CKAN: https://dados.antt.gov.br/api/3/action/package_search?q=rntrc. Licença "Creative Commons Atribuição" em todos (uso comercial com atribuição).
  a) `rntrc`: um CSV mensal de transportadores (ago/2020 a ago/2026). O mais recente:
     https://dados.antt.gov.br/dataset/b4a055d1-97a2-46f1-9461-cb17fbc6b6b3/resource/ce319c77-342c-4c35-87fa-a15a9f1bec03/download/transportadores_rntrc_08_2026.csv
     (161 MB, latin1, separador `;`, 1.174.540 linhas). Colunas: nome_transportador, numero_rntrc, data_primeiro_cadastro, situacao_rntrc,
     **cpfcnpjtransportador**, categoria_transportador, cep, municipio, uf, equiparado, data_situacao_rntrc.
     **Tem CPF de pessoas físicas (TAC), o que é dado pessoal sob a LGPD.** Por isso li em streaming e guardei só agregados
     (`antt_rntrc/rntrc_stream.py` gera `rntrc_agregado_08_2026.json`). Rodou em 69 s.
  b) `rntrc-veiculos`: https://dados.antt.gov.br/dataset/2b564396-5593-4b5c-ba2c-3de3fa0a92c0/resource/73efb515-d639-46b7-8c7d-1013320763eb/download/rntrc-veiculos.csv
     (10,9 MB, 98.119 linhas agregadas, atualizado em 06/10/2026). Colunas: categoria do transportador, tipo (Tração/Implemento), UF,
     categoria do veículo (CAMINHÃO LEVE 3,5–7,99 t; SIMPLES 8–29 t; TRATOR; CAMINHONETE/FURGÃO...), carroceria, ano e quantidade.
  c) `rntrc-historico`: CSV de 2 KB com um resumo mensal por categoria (nº de transportadores, veículos e idade média), de abr a out/2026.
  d) Dicionários em PDF (baixados) e um painel Power BI (só visualização).
- Resultados:
  - Out/2026 (histórico): 634.945 TAC com 750.471 veículos de tração e **idade média de 24,0 anos**. 222.300 ETC equiparadas a TAC
    (312.274 veículos de tração, 15,3 anos). 54.129 ETC (772.061 veículos de tração, 9,3 anos). 473 CTC.
  - Ago/2026 (CSV de transportadores, situação ATIVO): **906.022 transportadores no Brasil** (632.817 TAC, 218.960 ETC equiparadas,
    53.773 ETC e 472 CTC), mais 268.518 PENDENTES.
    **RMSP: 120.525 ativos** (91.850 TAC, 23.896 ETC equiparadas, 4.762 ETC e 17 CTC), 13,3% do Brasil. Capital: 41.716 TAC e 12.516 ETC.
    Guarulhos: 12.068 TAC. Osasco: 5.346 TAC.
    Novos cadastros ativos por ano do primeiro registro: 72.531 (2024), 89.436 (2025) e 82.328 (2026 até agosto). O mercado está crescendo.
  - Veículos (rntrc-veiculos, out/2026): 2.882.341 no total (1.745.881 de tração). No Brasil, os de tração são 710.032 caminhões-trator,
    535.127 caminhões simples, 251.928 caminhonetes ou furgões e 242.361 caminhões leves.
    **Em SP, 182.750 dos 456.374 veículos de tração (40%) são caminhonete/furgão ou caminhão leve.** É o segmento urbano típico de VUC, ZMRC e rodízio.
    Tanque de produto perigoso: 52.498 no Brasil e 13.897 em SP. Análise em `antt_rntrc/rntrc_veiculos_an.txt`.
- Outros documentos da ANTT (gov.br, site em CC BY-ND 3.0 segundo o rodapé; usamos só os números, com citação):
  - Anuário TRC 2025: https://www.gov.br/antt/pt-br/assuntos/cargas/dadostrc/anuario_trc_2025_antt.pdf (4,0 MB, 67 páginas)
    Em 2025 houve 534.972 admissões de motoristas de caminhão no Novo CAGED. No fim de 2025, os TAC eram 73,27% dos transportadores e
    tinham 32,56% da frota. A frota de tração dos TAC tem 24,4 anos de idade média.
  - Infográfico RAIS 2024: https://www.gov.br/antt/pt-br/assuntos/cargas/dadostrc/infograficoperfilmotoristasrais2024.pdf
    Mostra 713.229 motoristas de caminhão CLT em 2024 (+1,7% sobre 2023), mediana de remuneração de R$ 3.120 e 14% com mais de 55 anos.
  - Página de perfil dos motoristas: https://www.gov.br/antt/pt-br/assuntos/cargas/dadostrc/Perfil_Motoristas (3 painéis Power BI e um boletim em PDF).

## 4. Pesquisas sobre o caminhoneiro
### 4a. CNT "Perfil e Preferências dos Caminhoneiros" (set/2025) – TESTADO OK (é a edição mais recente da CNT)
- PDF: https://cdn.cnt.org.br/diretorioVirtual/e291a057-703a-4ee5-8849-e276ebe749c0.pdf (2,2 MB, 35 páginas, com texto extraível)
- 800 entrevistas feitas de 25/09 a 03/10/2025 em 58 postos e CEASAs. Margem de erro de 3,5 pontos. Em São Paulo, os locais foram CEAGESP,
  Terminal Fernão Dias, Rodoanel, Dutra e 25 de Março.
- População de referência: 1.248.403 caminhoneiros (740.903 autônomos do RNTRC em ago/2025 e 507.500 motoristas do TRC na RAIS 2024).
- Idade média de 45,3 anos (autônomos 46,0, empregados 44,3). 15,4% dos autônomos têm 60 anos ou mais.
  Escolaridade até a 9ª série: 41,3% dos autônomos.
  Renda líquida média de R$ 6.948. Rodam em média 9.859 km por mês. 55 a 65% fazem viagem longa (mais de 500 km por dia). Jornada média de 10h30.
- Onde pernoitam: **73% em postos de combustível**, só 5 a 8% em PPD homologados e 4 a 5% na beira da estrada.
  Serviços que mais querem num ponto de parada: banheiro com chuveiro (80%), restaurante (69%) e **estacionamento com vigilância (54 a 58%)**.
- Sobre o descanso entre jornadas: 76,6% dos autônomos querem poder fracionar as 11 horas, e a maioria prefere 8h + 3h.
- **Esta edição não pergunta sobre celular ou apps.**
### 4b. CNT "Perfil dos Caminhoneiros 2019" – TESTADO OK
- Fonte primária (repositório do ITL, ligado à CNT): https://repositorio.itl.org.br/jspui/bitstream/123456789/153/1/Pesquisa%20CNT%20Perfil%20dos%20Caminhoneiros%202019.pdf
  (22,6 MB, 134 páginas). É o mesmo arquivo do espelho static.poder360.com.br (mesmo tamanho em bytes).
- 1.066 entrevistas feitas de ago a set/2018. Os gráficos são imagens, então as páginas 91, 93, 99, 100, 101 e 104 foram lidas como figura.
- **87,8% usam computador ou smartphone, e 98% desses acessam principalmente pelo celular.** 87,7% usam internet. Finalidade: redes sociais 68,1%, uso profissional 55,4%.
- 7,6% foram vítimas de roubo de carga nos últimos 2 anos. **49,5% já recusaram uma viagem por medo de roubo** (60,2% dos autônomos).
### 4c. CNTA "Realidade do Transportador Autônomo de Cargas" (3ª pesquisa, 2025) – TESTADO OK (só a apresentação)
- Apresentação na Comissão de Viação e Transportes da Câmara em 09/12/2025:
  https://www2.camara.leg.br/atividade-legislativa/comissoes/comissoes-permanentes/cvt/apresentacoes-em-eventos/eventos-2025/arquivos-de-eventos-2025/ap-25-12-09-allan-medeiros-cnta
  (PDF de 3,1 MB, 24 páginas, só imagem). Li renderizando as páginas (`outros/cnta_pages/`).
- 2.002 TAC cadastrados no RNTRC, entrevistados de jun a ago/2025. A página 2 lista 11 UFs (AM, TO, BA, PE, SE, DF, GO, **MG, SP**, PR e SC),
  mas as notícias falam em 12. Os locais foram postos, centros de carga, balanças e paradas. A coleta foi da Trucker Inovação e Empreendedorismo Social.
- **Principal meio de conseguir frete: aplicativo de frete (46,6%)**, direto com o embarcador (38%) e agenciador (14,9%).
- **Onde para para cumprir a Lei do Descanso: posto de combustível (96,6%)**, PPD certificado (0,6%). **78,4% dizem que é difícil achar local.**
- Segurança: 57,7% nunca se sentem seguros nas rodovias. 16,9% já sofreram furto e 13,3% já sofreram roubo com violência.
- Idade média de 46 anos e 99,7% homens. Jornada de 14 horas, 25 dias por mês. Caminhão com 15 anos em média.
  Recebe vale-pedágio na TAG: 47,8% sim. 57,3% aceitam frete abaixo do piso.
- O relatório completo não foi encontrado. A home do site cnta.org.br não tem link para ele.
### 4d. Outras pesquisas (secundárias, não usar como número principal)
- Childhood Brasil e UFS, "O Perfil do Caminhoneiro Brasileiro": uso de smartphone passou de 32% em 2005 para 82% em 2021 (citado por mundologistica.com.br em 07/03/2024).
- Apresentação do SEST SENAT na Câmara (set/2025): 65,1% dos empresários do TRC dizem não encontrar motoristas com facilidade (dado da CNT, Perfil Empresarial).
  `outros/sestsenat_camara_2025.pdf`

## 5. Celular e conectividade (contexto para decisões de produto)
- StatCounter, SO mobile no Brasil (CSV): https://gs.statcounter.com/os-market-share/mobile/brazil/chart.php?...&csv=1 (HTTP 200, 402 B)
  Em set/2026: **Android 79,2%** e iOS 20,8%. A licença CC BY-SA não foi conferida nesta sessão.
- Cetic.br TIC Domicílios 2025, tabela C16A: https://cetic.br/pt/tics/domicilios/2025/individuos/C16A/ (HTML)
  65% dos usuários de internet acessam só pelo celular. A taxa sobe para 84% entre quem tem ensino fundamental e 71% na faixa de 45 a 59 anos.
  A página não mostra licença.
- Cobertura 4G em rodovias federais: 54% (66 mil de 122 mil km), segundo o Mobile Time em 06/08/2025 (fonte secundária, baseada em
  Links Field, Anatel e DNIT). O painel da Anatel não foi testado. Justifica oferecer mapa e rota offline.

## 6. Concorrentes – TESTADO (lojas e documentação oficial)
Fontes: iTunes Search API (`https://itunes.apple.com/search?term=...&country=br&entity=software`, JSON público), páginas do Google Play
(`https://play.google.com/store/apps/details?id=<pkg>&hl=pt_BR&gl=BR`, HTML com JSON-LD) e App Store BR
(`https://apps.apple.com/br/app/id<ID>`, onde os preços estão nos pares `leadingText`/`trailingText`).
Arquivos: `apps/play_installs_iap.txt`, `apps/appstore_precos_br.txt`, `apps/itunes_busca_br.txt` e `apps/play_descricoes.json`.
**Ressalva: os números de instalação e as notas do Google Play são globais, não só do Brasil.**

| App | Tipo | Instalações Play (aprox.) | Nota Play (nº de avaliações) | Preço BR (App Store) | Restrição de caminhão |
|---|---|---|---|---|---|
| Sygic GPS Truck & Caravan | GPS de caminhão | 5,17 mi | 4,62 (63.784) | "Truck Brasil" R$ 499,90; licença "vitalícia" com 3 anos de atualização, segundo review | altura, peso, comprimento, eixos, hazmat (descrição) |
| CoPilot GPS (Trimble) | GPS | 6,41 mi | 3,73 (106.120) | caminhão R$ 37,90 a 41,90 por mês ou R$ 379,90 por ano | sim (descrição) |
| TomTom GO Expert | GPS de caminhão | 22,1 mi | 3,94 (277.980) | caminhão R$ 99,90 por mês ou R$ 399,90 por ano, com 1 semana grátis | dimensões e hazmat |
| CargoTour | GPS de caminhão | 410 mil | 3,80 (1.924) | IAP de R$ 11,99 a 539,99 | altura, peso, comprimento, hazmat |
| Odysseus, NaviTruck, Truck GPS (USK) | GPS de caminhão | 780 mil, 69 mil, 781 mil | 4,2; 2,0; 3,7 | IAP | sim (descrição) |
| MICHELIN Truckfly | GPS de caminhão (foco na Europa) | 931 mil | sem nota | IAP | sim |
| WikiRota (BR) | rota com custo, pedágio e combustível | 861 mil | **4,76 (24.694)** | Premium R$ 7,99 por mês ou 79,99 por ano; Pro R$ 9,99 ou 99,99 | tem perfil de caminhão para custo, mas uma review diz que **não respeita as restrições da Grande SP** (manda por dentro em vez do Rodoanel) |
| Rotas Brasil (Frete.com) | calculadora de pedágio | 182 mil | 3,77 | grátis | não |
| Fretebras (Frete.com) | marketplace de frete | **7,19 mi** | 4,02 (82.635) | IAP de R$ 14,99 a 999,99; review reclama de alta de 300% | — |
| TruckPad | marketplace de frete | 2,28 mi | 3,41 (14.842) | grátis | — |
| Waze | navegação para carro | 682 mi | 4,29 | grátis | **sem modo caminhão**. No fórum oficial (03/06/2026), editores da comunidade disseram que a chance é "zero" |
| Google Maps (app) | navegação | 22,5 bi | 4,37 | grátis | **sem modo caminhão no app** |
| HERE WeGo (app) | navegação | 41,5 mi | 3,48 | — | o app comum não tem modo caminhão; existe a versão paga WeGo Pro |
| CargoMaps (BR, App Store) | GPS de caminhão com promessa de ZMRC | lançado em 07/2025 | 0 avaliações | grátis com IAP | promete altura, peso e ZMRC (só na descrição; não testado) |

- **Google Maps Platform, Large Vehicle Routing** (Routes API, Route Optimization e Navigation SDK): está disponível **só nos 48 estados
  contíguos dos EUA (GA) e no Japão (experimental)**, para um grupo limitado de clientes
  (https://developers.google.com/maps/documentation/routes/lvr, atualizada em 07/10/2026). **Não existe no Brasil.**
- **HERE WeGo Pro**: no Brasil a cobertura é "full motorway coverage", ou seja, restrições de caminhão só em rodovias e vias principais, não na rede toda
  (https://docs.here.com/wego-pro/docs/coverage). **A malha urbana da Grande SP não tem restrição de caminhão completa na HERE.**
- **Mapbox Directions**: tem os parâmetros `max_height`, `max_width` e `max_weight` e a ressalva "Coverage ... may vary by region"
  (https://docs.mapbox.com/api/navigation/directions/). Não trata janela de horário (ZMRC) nem rodízio.
- **Maplink** (BR, B2B): Trip API mais Restriction Zone API, com o exemplo "Example 1 – São Paulo ZMRC" na documentação
  (https://developers.maplink.global/en/category/restriction-zone-en/). **É o concorrente B2B mais direto para ZMRC.** Preço não público.
- Reviews de usuários do Brasil no Play (só as 3 que aparecem no HTML): no TomTom, "metade das ruas da minha cidade (Contagem-MG) com
  nomes errados"; no Sygic, rotas não confiáveis; no CargoTour, não funciona sem internet.
- Google Maps e Waze consideram o rodízio de SP para carros (Olhar Digital, 2018, fonte secundária). Não confirmei na documentação oficial
  (as URLs de suporte que testei deram 404).

## 7. Vendas de caminhões novos (Fenabrave) – TESTADO OK
- Lista mensal: https://www.fenabrave.org.br/portal/conteudo/emplacamentos. Os PDFs ficam em https://www.fenabrave.org.br/portal/files/AAAA_MM_02.pdf
  (**só funciona por https**; por http dá 404).
- 2025: **110.873 caminhões emplacados** (-8,65% sobre 2024, que teve 121.373). Por segmento: pesado 44,66%, semipesado 33,47%,
  médio 11,74%, leve 7,82%, semileve 2,31% (página 40).
- Jan a set/2026: 78.665 (-3,89% sobre o mesmo período de 2025).
- O relatório é proprietário. Usamos só os números, com citação.

## 8. Roubo de carga como dor (ver ../seguranca_acidentes_roubo/NOTES.md)
- SSP-SP: 3.470 roubos de carga no estado em 2025, dos quais **83% na RMSP**. De jan a ago/2026 foram 1.638 BOs com coordenadas, e 67% aconteceram entre 6h e 13h.
- Sinesp 2025: 8.565 no Brasil, e RJ mais SP somam 84,6%.
- NTC&Logística (secundária, CNN Brasil, 03/2026): 8.750 ocorrências em 2025 (-16,7%) e prejuízo de cerca de R$ 900 milhões. O Sudeste tem 86,8%.
- Percepção dos motoristas: 49,5% já recusaram viagem por risco (CNT 2019), 13,3% dos TAC já sofreram roubo e 57,7% nunca se sentem seguros (CNTA 2025).

## 9. Testado e falhou (ou não serve)
- HEAD nos xlsx da Senatran: 403. Usar GET com User-Agent de navegador.
- Páginas de condutores da Senatran (`condutores-habilitados-2026`, `estatisticas-renach` etc.): 404. No CKAN o RENACH vai só até 08/2024.
- Arquivo de transportadores do RNTRC: a versão de ago/2023 tem 85 bytes (vazia), e existem dois recursos "Set23" duplicados.
- eshop.sygic.com e copilotgps.com/map-coverage são páginas em JavaScript (SPA) e o curl recebe a casca vazia. Os preços vieram da App Store.
- Sem preço público de motorista para Fretebras e TruckPad.
- Fenabrave por http: 404. Por https: 200.
- O RSS da CNT (cdn.cnt.org.br/diretorioVirtual/rss.xml) é UTF-16 de podcast e não lista as pesquisas.
- Ajuda do Google sobre rodízio (support.google.com/waze/answer/7015306 e maps/answer/7017853): 404.
- O PDF da CNTA na Câmara é só imagem, então foi lido renderizando as páginas.
- RAIS 2024: ftp://ftp.mtps.gov.br/pdet/microdados/RAIS/2024/RAIS_VINC_PUB_SP.7z tem 1,07 GB e não foi baixado (só listei o diretório).

## 10. Como integrar ao app
1. Tabela `mercado_municipio` (cod_ibge, uf, nome, caminhao, caminhao_trator, reboque, semirreboque, caminhonete, utilitario, total,
   ref_mes) carregada por `scripts/import_frota_senatran.py`, que roda todo mês: GET com User-Agent, pandas e cruzamento com o IBGE por
   nome+UF, mais uma tabela de apelidos para os 37 que não casam. Uso: priorizar a expansão (mapa de calor de frota no admin), medir
   penetração (usuários ativos dividido pela frota do município) e escolher a próxima região depois da RMSP (Campinas, BH, Curitiba).
2. Tabela `mercado_rntrc` (uf, cod_ibge, categoria, situacao, qtd, ref_mes), gerada **em streaming e só com agregados** (sem CPF, CNPJ ou nome).
   Também serve para validar o RNTRC de quem faz reportes colaborativos, guardando só `sha256(numero_rntrc)`, situação, categoria e UF.
   Quem tem RNTRC ATIVO ganha selo de "transportador verificado" e peso maior na confiança do reporte.
   Antes de pôr isso em produção, consultar o jurídico sobre a LGPD.
3. Calibrar os presets com o rntrc-veiculos por UF: caminhonete/furgão e caminhão leve como base de VUC/3/4, caminhão simples como
   toco/truck e caminhão-trator como carreta/bitrem/rodotrem. Isso define a ordem dos presets no onboarding (em SP, 40% da tração é leve).
4. Monitorar concorrentes com um script mensal que consulta `itunes.apple.com/lookup?id=...&country=br` (API pública, JSON) para nota,
   versão e preço. Para o Google Play, fazer checagem manual ou usar um serviço pago (AppFollow, Sensor Tower), porque raspar o Play
   viola os termos de uso. Guardar em `concorrentes_snapshot`.
5. Os números das pesquisas (CNT, CNTA, ANTT e Fenabrave) ficam só em documentação e pitch, não no banco.

## Lacunas
- Não há contagem oficial de VUC. O Renavam não tem essa categoria e o campo de eixos está vazio em 63% dos caminhões da RMSP.
  O cruzamento por marca e modelo (zip de 137 MB mais FIPE) ficou para depois.
- Nenhuma pesquisa recente (2024 a 2026) mede o uso de apps de navegação por caminhoneiros. O último número primário é da CNT 2019 (87,8% usam smartphone).
- Não sei quantos caminhões de fora da RMSP circulam nela (seria preciso OD de cargas, MDF-e ou pedágio).
- Não testei os concorrentes na prática (exigiria instalar e pagar): não sei se Sygic, TomTom e CoPilot respeitam ZMRC, rodízio ou
  Mini-Anel. A ausência de cobertura urbana na HERE e no Google sugere que não.
- RENACH sem dados de 2025 e 2026 no CKAN. RAIS por município (CBO 7825) não foi baixada.
- O relatório completo da CNTA 2025 não foi achado. A licença do StatCounter e a do Cetic não foram conferidas.
- A cota de buscas na web acabou no fim da sessão.
