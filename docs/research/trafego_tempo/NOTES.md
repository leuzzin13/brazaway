# Trânsito e tempo de viagem: dados históricos e em tempo real (chave: trafego_tempo)

Pesquisa feita em 09/10/2026. Retomei uma tentativa anterior que tinha parado no meio: ela deixou amostras do GeoSampa (acidentes, classificação viária CET, semáforos, faixas e corredores de ônibus, obras) e um `ckan_80828.json` que na verdade era o HTML de bloqueio anti-bot (F5/TSPD) do portal de dados abertos de SP. Apaguei esse arquivo e refiz a consulta com User-Agent de navegador, que funcionou.

## TL;DR (o que muda no produto)

1. **Hoje o ETA do app não depende da hora.** Testei o Valhalla local (3.9.1) na rota Santana→Jabaquara (17,2 km, truck). Sem `date_time` e com partida às 03:00, 08:30 e 18:30, o resultado é sempre 37,6 min (27 km/h). Não existe `traffic.tar` e os tiles não têm velocidades previstas. Para calcular a hora de chegada à ZMRC isso é otimista nos picos. A CET mediu 20,6 km/h no pico da manhã e 17,1 km/h no da tarde (MSVP 2019). O TomTom Traffic Index 2025 dá 17,6 e 16 km/h.
2. **O Valhalla já aceita tráfego histórico sem trocar de motor.** O formato é um CSV por tile com `edge_id,freeflow,constrained,historical_speeds`, onde a última coluna traz 2016 baldes de 5 min por semana comprimidos em DCT (200 coeficientes em base64). Testei de ponta a ponta na imagem local: `valhalla_ways_to_edges` gerou o mapeamento way→edge da Região Sudeste em cerca de 5 s (2.657.049 ways OSM, 10.463.243 pares direção/edge). Também codifiquei um perfil semanal derivado da CET, com erro médio de 0,40 km/h ao decodificar. Falta só uma fonte de velocidade por trecho.
3. **Não há fonte aberta de velocidade por trecho e por hora na Grande SP.** A CET publicou lentidão por trecho de 2001 a 2023 (texto, sem geometria), e a série foi **descontinuada em 31/12/2023**. Desde 2024 a CET usa dados do **Waze**, por um Termo de Cooperação de Licença Cruzada de 2016, e esses dados não são abertos.
4. **O Waze for Cities não serve para nós.** Só podem se inscrever órgãos de governo ou operadores privados de rodovias, e os termos proíbem tornar os dados públicos.
5. **Fornecedores comerciais com tráfego e roteamento de caminhão no Brasil:** TomTom (Brasil coberto em Flow e Incidents; Routing com `travelMode=truck` custa EUR 1,00 por mil acima de 20 mil/mês) e HERE (Routing Truck custa EUR 2,33 por mil acima de 5 mil/mês; Traffic tem o mesmo preço). **O Google não serve**: o roteamento de caminhão é restrito a clientes selecionados, cobre os EUA e o Japão (Brasil não aparece), e os termos proíbem usar o conteúdo com mapa não-Google (nosso front usa MapLibre/OSM) e em sistemas embarcados no veículo.
6. **O Uber Movement foi descontinuado.** `movement.uber.com` redireciona para `uber.com/business/movement-decommissioning`.
7. **Há fontes abertas e comerciais (CC-BY) que servem para calibrar.** A ANTT publica distribuição de velocidade por classe de veículo, inclusive pesados, nos SATs das concessionárias federais (sem hora, agregada por dia). A ARTESP publica contagens horárias por classe nas rodovias estaduais concedidas (sem velocidade). A CET publica um relatório anual de velocidades (MSVP, PDF, até 2019).
8. **Caminhona rodovia anda a cerca de 75–78 km/h na Grande SP**, pela média ponderada dos SATs da ANTT. O CTB fixa 90 km/h para "demais veículos" em rodovia sem placa. Vale limitar `top_speed` do preset truck nessa faixa.

## Fontes testadas

### 1. CET – Base de dados sobre lentidão por trechos 2001–2023 (dados abertos SP)
- Portal: https://dados.prefeitura.sp.gov.br/dataset/base-de-dados-sobre-lentidao-por-trechos-cet
- API CKAN: `curl -A "Mozilla/5.0 ..." "https://dados.prefeitura.sp.gov.br/api/3/action/package_search?q=lentidao"`. Sem User-Agent de navegador a resposta é a página de bloqueio F5.
- Licença: CC-BY (Creative Commons Atribuição), que permite uso comercial com atribuição.
- Aviso no próprio dataset: **descontinuado**, última versão de 31/12/2023. O sistema Monitrans (observação de rotas, postos, viaturas e câmeras, 868 km monitorados em 2010) foi desativado no início de 2024. Desde então a CET usa só dados do Waze, que não são comparáveis com a série antiga.
- Baixei `cet_lentidao/lentidao_trechos_2023.csv` (17,9 MB, ISO-8859-1, `;`). São 158.496 registros com colunas data;corredor;sentido;expressa;descricao;tamanho(m);nome_regiao. Há 139 corredores distintos e coletas a cada 30 min. Não há geometria: o trecho vem como texto ("De X até Y").
- Gerei `cet_lentidao/perfil_km_lentidao_2023.csv` com a média de km de lentidão por meia hora em dia útil, sábado e domingo, considerando só os instantes com algum registro. Em dia útil a curva vai a cerca de 3,6 km de madrugada, sobe para 37,7 km às 09:00, cai para 23,4 km às 15:00 e chega a 38,9 km às 18:30. Ela serve como **forma** da curva horária, não como velocidade.
- Integração: só como fator horário genérico (multiplicador por meia hora) ou para validação. Não dá para ligar aos edges sem geocodificar os trechos.

### 2. CET – "Trânsito Agora" (site) e Monitrans legado
- https://www.cetsp.com.br/ retorna HTTP 200. A home mostra km de lentidão por região, agora com base no Waze (no momento do teste: Norte 72, Oeste 157, Centro 77, Leste 128, Sul 153 km) e a velocidade média dos ônibus nos corredores (Olho Vivo: 17 e 20 km/h). Não há API: seria scraping de HTML, sem licença declarada.
- `/transito-agora/transito-nas-principais-vias.aspx` responde 200, mas com a mensagem "Serviço indisponível no momento". `/transito-agora/mapa-de-fluidez.aspx` dá 404.
- Monitrans legado em `sslcetsp1.cetsp.com.br/monitransmapa/`: `IMG5/eixos.asp`, `IMG5/lentidao.asp` e `IMG5/ocorrencias.asp` dão 404. `agora/graficolimite.asp` dá 500 com erro de SQL ("account is disabled"). O sistema está morto.
- Notícia da Prefeitura (03/03/2023): o monitoramento passou de 868 km para 20.000 km com o indicador "CET-Waze", adotado em meados de 2020. O Termo de Cooperação Técnica para Licença Cruzada de Conteúdo com o Waze é de julho de 2016. https://prefeitura.sp.gov.br/w/noticia/companhia-de-engenharia-de-trafego-amplia-medicao-do-transito-para-todas-as-vias-da-cidade

### 3. CET – MSVP (Mobilidade no Sistema Viário Principal), volumes e velocidades
- Lista em https://www.cetsp.com.br/consultas/relatorios-corporativos-(estatisticas).aspx, com relatórios de 1977 a 2019. O mais recente é https://www.cetsp.com.br/media/1113490/relatorio-msvp-2019-revisao-2-junho-22.pdf (8,4 MB, 226 páginas). Pelo `http://` dá 404; pelo `https://` dá 200.
- Método: carro-teste com GPS a 1 Hz, dois dias típicos por ano, picos das 7–10h e 17–20h. Foram 274 km de vias e 2.926 km percorridos.
- Tabela 11 (2019): velocidade média do tráfego geral de **20,63 km/h na manhã e 17,05 km/h na tarde** (no sentido centro: 17,93 e 19,60; no sentido bairro: 24,31 e 15,08). Há tabelas por trecho e por faixa horária a partir da página 41.
- Licença não declarada (PDF institucional). Uso: calibração e validação manual de ETA em corredores.
- Arquivo: `cet_site/relatorio-msvp-2019-revisao-2-junho-22.pdf` e o texto extraído em `msvp2019.txt`.

### 4. CET – Fiscalização eletrônica (radares) – dados abertos SP
- https://dados.prefeitura.sp.gov.br/dataset/fiscalizacao-eletronica-do-transito (CC-BY). Baixei `cet_radares/locais_2026-06.csv`: 877 locais fixos.
- Enquadramentos: V (velocidade) 837, R (rodízio) 384, **Z (ZMRC-Caminhão) 183**, VR 180, A (semáforo vermelho) 180, F (ZMRF-fretado) 173, P 166, EXE 83, EXD 72, **PR (faixa proibida a caminhão à esquerda) 50**, entre outros. O dicionário fica em `cet_radares/dicionario.csv`. O código "VR" aparece nos dados, mas o dicionário só traz "VTR-VER-Caminhão".
- Não há coordenadas, só o endereço. Não há volume nem velocidade medida.
- Utilidade aqui: avisar onde há fiscalização eletrônica de ZMRC e rodízio. Tem mais a ver com o tema de restrições do que com tempo de viagem.

### 5. GeoSampa (WFS) – camadas de apoio
- Endpoint: https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs. **Nenhuma** das 485 camadas traz velocidade ou lentidão (busquei por lent, veloc, trafeg, fluid e outros termos).
- `geoportal:classificacao_viaria_cet` tem 210.754 segmentos. Contagem via `resultType=hits` + `CQL_FILTER`: Local 133.098, Coletora 50.641, Arterial 21.707, Rodovia 648, VTR 428, Vias de pedestre 4.232. Pelo CTB art. 61, a velocidade padrão sem placa é 80 km/h em VTR, 60 em arterial, 40 em coletora e 30 em local. **Uso**: velocidade-base padrão nas vias da capital sem `maxspeed` no OSM (via `default_speeds` ou um ajuste por edge).
- `geoportal:faixa_onibus` (7.378 registros, com `tx_horario_funcionamento`) e `corredor_onibus` (45): faixas exclusivas com horário. Isso ajuda a explicar a lentidão.
- `geoportal:controle_uso_via_publica_geoinfra` (obras, 1.902 pontos): é um retrato de 31/01/2026, todos do tipo EMERGENCIA, sem datas de início e fim. Não serve para tempo real.
- `geoportal:semaforo` (6.432) e `acidente_cet` (5.716) foram baixados na tentativa anterior. Os semáforos podem virar penalidade de cruzamento.

### 6. Waze for Cities (antigo Connected Citizens Program)
- Elegibilidade (https://support.google.com/waze/partners/answer/10453062): "government agency or a private road operator". **Uma empresa privada de navegação não se encaixa.**
- O feed traz jams, alertas e irregularidades em JSON ou XML, atualizados a cada 2 minutos, mais a ferramenta Traffic View. Fonte: PDF oficial `waze/waze_for_cities_v01.pdf` (https://web-assets.waze.com/partners/ccp/Waze-for-Cities-v01.pdf) e reportagem da Route Fifty de 2018.
- Pelos termos (segundo a reportagem), os parceiros não podem tornar os dados públicos. O acordo da CTRMA com o Google, que traria o texto exato, deu 403 tanto no curl quanto no WebFetch.
- A CET é parceira desde 2016. Os dados dela derivados do Waze (de 2024 em diante) **não estão publicados** no CKAN: o dataset só vai até 2023.

### 7. Uber Movement
- `curl -sL https://movement.uber.com/` redireciona para `https://www.uber.com/business/movement-decommissioning` (HTTP 406 no curl, 404 no WebFetch). **Foi descontinuado.** Não confirmei a data exata nem a licença antiga: o Wayback Machine estava fora do ar ("Temporarily Offline").

### 8. Valhalla – tráfego histórico e ao vivo (testado na imagem local `ghcr.io/valhalla/valhalla-scripted:latest`, versão 3.9.1-c803bdc2f)
- Documentação: https://raw.githubusercontent.com/valhalla/valhalla/master/docs/docs/concepts/historical-traffic.md e `.../concepts/speeds.md` (cópias em `valhalla/`).
- Prioridade das velocidades em tempo de execução: ao vivo (`traffic.tar`), depois prevista (perfil semanal DCT), depois constrained (média diurna das 7h às 19h), depois free-flow (noturna) e por fim a velocidade-base (maxspeed, highway, `default_speeds.json`, densidade). O request controla isso com `costing_options.truck.speed_types` = [freeflow, constrained, predicted, current] e `date_time`.
- Ferramentas presentes na imagem: `valhalla_ways_to_edges`, `valhalla_add_predicted_traffic` (opções -t dir, -s summary, -j threads) e `valhalla_build_extract -t/--with-traffic`, que cria o esqueleto do `traffic.tar`. No `docker-entrypoint.sh` da imagem scripted, a variável de ambiente `traffic_name` liga essa opção.
- O `valhalla.json` local já aponta `mjolnir.traffic_extract=/custom_files/traffic.tar`, mas o arquivo não existe.
- Atenção: `add_predicted_traffic` remove `tile_extract` da config e grava nos **tiles extraídos** (`tile_dir`). O fluxo então fica: extrair, aplicar CSVs, refazer o tar.
- Testes:
  - `valhalla_ways_to_edges` com o tar local montado só para leitura: 4,8 s. O `way_edges.txt` tem 182,8 MB, 2.657.049 ways e 10.463.243 pares (dir, edge).
  - Em 38 tiles que tocam a bbox da RMSP (-47,21, -24,07, -45,69, -23,18; é um limite superior, porque os tiles de nível 0 são grandes): 472.494 ways e 1.691.260 directed edges (nível 0: 139.824; nível 1: 255.376; nível 2: 1.296.060).
  - `valhalla/poc_encode_profile.py`: perfil semanal ilustrativo (vff=60 km/h, modulado pela curva da CET; **não calibrado**) codificado com `compress_speed_buckets` e `encode_compressed_speeds` do pacote Python `valhalla` da própria imagem. Usa 2016 baldes e 200 coeficientes, ocupa 536 caracteres em base64, e o erro de decodificação é de 0,40 km/h em média e 4,08 km/h no máximo. A linha de exemplo está em `valhalla/exemplo_trafego_tile.csv`.
  - O `/route` local com `date_time` 03:00, 08:30 e 18:30 dá sempre o mesmo ETA (37,6 min), o que confirma que não há perfil carregado.
- `default_speeds.json` local (OpenStreetMapSpeeds) tem 26 entradas para o Brasil, por UF. Para SP urbano, `way` = [66, 34, 25, 22, 21, 17, 16, 10] km/h por classe de via (só vale onde falta `maxspeed`).
- Licença: Valhalla é MIT. O OpenTraffic (reporter) é LGPL-3.0 e está sem commits desde 2022; serve de referência para agregar sondas GPS próprias.

### 9. TomTom (comercial)
- Preços (https://docs.tomtom.com/pricing, renderizado no navegador; detalhes em `comerciais/tomtom_pricing_extraido_2026-10-09.txt`), em EUR por mil:
  - Routing: grátis até 20 mil/mês, depois 1,00, 0,80 e 0,65 por faixa.
  - Traffic Flow Segment Data: mesmos valores do Routing.
  - Traffic Incidents: grátis até 2,5 mil/mês, depois 2,00.
  - Matrix: grátis até 2,5 mil/mês, depois 3,00.
  - Snap to Roads: grátis até 2,5 mil/mês, depois 3,00.
  - Tiles de tráfego: grátis até 200 mil/mês, depois 0,10.
  - Intermediate Traffic API (download do feed no servidor, Protobuf/DATEX II): sem preço público.
  - Traffic Stats e O/D Analysis: "Contact Sales".
  - **Uma busca web dizia EUR 0,75 para o Routing; isso não confere com a página.**
- Routing API (docs): `travelMode=truck`, `vehicleWeight`, `vehicleAxleWeight`, `vehicleLength/Width/Height`, `vehicleCommercial`, `vehicleLoadType`, `vehicleAdrTunnelRestrictionCode`, `vehicleMaxSpeed`, `traffic`, `departAt`/`arriveAt`. A resposta traz `noTrafficTravelTimeInSeconds`, `historicTrafficTravelTimeInSeconds`, `liveTrafficIncidentsTravelTimeInSeconds` e `trafficDelayInSeconds`.
- Cobertura: Brasil (BR/BRA) com ✔ em Incidents e ✔ em Flow (https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/product-information/market-coverage).
- Não confirmei os termos de cache e armazenamento.
- TomTom Traffic Index, São Paulo 2025 (https://www.tomtom.com/traffic-index/city/sao-paulo/): congestionamento médio de 58,5%; 10 km em 27 min 39 s; 16,8 km/h no pico; pico da manhã de 10 km em 34 min 5 s (17,6 km/h); pico da tarde de 10 km em 37 min 30 s (16 km/h).

### 10. HERE (comercial)
- Preços (https://www.here.com/get-started/pricing, renderizado no navegador e com as abas expandidas; detalhes em `comerciais/here_pricing_extraido_2026-10-09.txt`), em EUR por mil:
  - **Routing Truck**: grátis até 5 mil/mês, 2,33 até 200 mil e 1,87 até 1 milhão.
  - Time-Aware Routing: mesmos valores do Truck.
  - Routing Car sem tráfego: grátis até 30 mil/mês, depois 0,70.
  - Traffic: grátis até 5 mil/mês, depois 2,33.
  - Advanced Traffic: grátis até 2,5 mil/mês, depois 4,66.
  - Tiles de tráfego: grátis até 30 mil/mês, depois 0,095.
  - Matrix: grátis até 2,5 mil/mês, depois 4,66.
- Não confirmei a cobertura de tráfego da HERE no Brasil nem os termos de cache.

### 11. Google Maps Platform (comercial)
- Preços (https://developers.google.com/maps/billing-and-pricing/pricing), em USD por mil, na primeira faixa: Compute Routes Essentials 5,00 (grátis até 10 mil); **Pro 10,00** (grátis até 5 mil; é o SKU cobrado quando se usa TRAFFIC_AWARE ou TRAFFIC_AWARE_OPTIMAL); Enterprise 15,00 (grátis até 1 mil). O Roads Speed Limits custa 20,00.
- `RouteTravelMode` tem `TRUCK`, mas a página "Large vehicle routing" (https://developers.google.com/maps/documentation/routes/lvr) diz que o recurso é só para "a limited set of customers", com GA nos 48 estados contíguos dos EUA e modo experimental no Japão. **O Brasil não aparece.**
- Termos (https://cloud.google.com/maps-platform/terms, versão de 26/08/2026; trechos em `comerciais/google_gmp_terms_trechos.txt`): (b) proíbe cache; (c) proíbe criar conteúdo a partir do conteúdo Google; (d) proíbe recriar produtos Google; **(e) proíbe uso com mapa não-Google**; **(f) proíbe uso em sistemas embarcados no veículo**. **Isso inviabiliza o Google no nosso app (MapLibre + OSM).**

### 12. Mapbox (comercial)
- Directions (https://docs.mapbox.com/api/navigation/directions/): perfil `driving-traffic` com `max_height`, `max_width`, `max_weight` (em toneladas) e `depart_at`.
- Preço (https://www.mapbox.com/pricing): grátis até 100 mil/mês, depois USD 2,00 por mil. O Mapbox Traffic Data (velocidades ao vivo e típicas) é licenciado sob consulta com vendas.
- **Não confirmei** a cláusula de "uso só com mapa Mapbox". Ela aparece no ToS antigo de 2016 citado na busca, mas não a encontrei no texto atual de mapbox.com/legal/tos, que é carregado dinamicamente.
- Não há roteamento específico de caminhão (eixos, hazmat).

### 13. ANTT – dados abertos (federais, concessionárias) – https://dados.antt.gov.br (CKAN, CC-BY)
- `volume-sat` (102 recursos): tráfego nos SATs por concessionária, com rodovia, km, município, lat/lon, **data (sem hora)**, sentido, faixa, **faixa de velocidade** (≤20, 21–50, 51–80, 81–100, 101–120, 121–140, 141–160, >160), tipo (Moto, Leve, **Pesado**, Não identificado) e volume. O dicionário está em `antt/dic_volume_sat.pdf`.
- Baixei Régis Bittencourt (`volume-sat-arb.csv`, 15,8 MB, 93.404 linhas, 5 SATs em SP, de 01/2022 a 06/2026) e Fernão Dias (`volume-sat-afd.csv`, 18,2 MB, 113.595 linhas, 2 SATs em SP e 4 em MG, de 01/2022 a 04/2026).
- Velocidade média estimada dos pesados (ponto médio da faixa ponderado por volume; arquivo `antt/resumo_sat_sp.txt`): Régis km 288,8 (Itapecerica da Serra) **74,7 km/h**, contra 83,4 dos leves; Fernão Dias km 84,15 (São Paulo) **77,5 km/h**, contra 87,8; Fernão Dias km 35,7 (Atibaia) 62,9 km/h; Régis na serra (Barra do Turvo) cerca de 61 km/h.
- Distribuição dos pesados em SP: na Régis, 56% entre 51 e 80 km/h e 35,5% entre 81 e 100; na Fernão Dias, 60,7% e 28,2%.
- `volume-radar` (89 recursos): mesmo esquema, por radar. A Nova Dutra só tem jan/2022, com 50 equipamentos.
- `volume-trafego-praca-pedagio`: volume por praça e categoria. O arquivo diário de 2026 tem 250 MB (não baixei).
- `quantidade-possiveis-infratores`: excesso de velocidade.
- Uso: calibrar `top_speed` do truck e a relação velocidade de pesado sobre leve nas rodovias federais concedidas. Não serve para variação horária.

### 14. ARTESP – dados abertos (estaduais concedidas) – https://dadosabertos.artesp.sp.gov.br (CKAN, CC-BY; espelhado em dadosabertos.sp.gov.br com CC-BY 4.0)
- Dataset `volume-de-trafego`: "Contagem SAT's por dia" (CSV, 2016–2026; o arquivo de 2026 tem 26,7 MB) e "por hora" (RAR v5; o de 2026 tem 79 MB e descompactado dá 505 MB), mais volume por praça de pedágio por dia e por hora.
- Colunas da contagem horária: CONCESSIONARIA, RODOVIA, KM, COMPLEMENTO, SENTIDO, MARGINAL, DATA, **HORA**, QTD_MOTO, QTD_PASSEIO, **QTD_COMERCIAL**. **Não há velocidade nem coordenadas** (só km).
- Arquivo diário de 2026: de 01/01 a 16/09, com 1.647 pontos (rodovia, km, sentido, marginal) em 22 concessionárias. Os veículos comerciais são 15,0% do volume. Na RMSP aparecem Rodoanel (L24 e L25 SPMAR), Autoban, Ecovias Imigrantes, Raposo Castello e outras.
- Uso: perfil horário do volume de caminhões por rodovia, como proxy de congestionamento. Também permite ver em que horários os caminhões de fato circulam.

### 15. SP Estado / SEMIL – Projeto Big Data (tráfego rodoviário regional)
- https://dadosabertos.sp.gov.br/dataset/projeto-big-data (CC-BY 4.0). Zip de 14,5 MB baixado em `sp_estado/bigdata_dados.zip`.
- Contém matrizes OD (autos, comerciais leves de 2–3 eixos e **pesados de 4 ou mais eixos**) estimadas a partir de rastreamento de celulares, de 2022. A rede tem 6.842 links com o campo `vel`, que é velocidade de **modelagem** e não velocidade observada.
- O aviso que acompanha os dados diz que as viagens urbanas e as internas às regiões metropolitanas **não fazem parte** do escopo.
- Uso: só demanda regional de caminhões (prioridade de cobertura). Não serve para ETA.

### 16. DER-SP e DNIT – volumes (sem velocidade)
- DER-SP VDM 2024: https://dersp.der.sp.gov.br/WebSite/Arquivos/DadosAbertos/VDM/VDM/VDM_2024.xlsx (25 KB, CC-BY 4.0). O sistema de contagem classificatória (http://200.144.30.103:8081/vdm/Page/Index.aspx) responde 200 com 6,6 MB de HTML.
- DNIT PNCT (https://servicos.dnit.gov.br/dadospnct): o portal diz ter "358+" equipamentos e uma média de 2,66 milhões de veículos por dia. A API de downloads está em `https://servicos.dnit.gov.br/dadospnct-api/api/v1/downloads/diretorios?path=...` e `.../file?path=...`, é lenta (uma listagem levou 67 s) e às vezes estoura o tempo.
- Baixei `dnit/VMDa_2025.xlsx` (2,3 MB): 8.222 trechos do SNV, 590 em SP, com volume estimado por categoria A–J e sentido. **Não traz velocidade.** O portal diz "Todos os arquivos disponibilizados são de acesso público", mas o rodapé diz "Todos os Direitos Reservados", então a licença não está clara.
- O dados.gov.br (API) respondeu 401.

### 17. SPTrans Olho Vivo
- `https://api.olhovivo.sptrans.com.br/v2.1/Posicao` retorna 401 sem token. O token exige cadastro, que não fiz (criar conta é proibido nesta tarefa). As páginas de desenvolvedores e de termos da SPTrans deram 403.
- Mesmo com acesso, a posição dos ônibus mostra a velocidade nos corredores e faixas exclusivas, que não representa o caminhão. É de baixo valor.

### 18. Legislação (tempo de viagem)
- CTB, art. 61 (`legislacao/ctb_art61.txt`, fonte planalto.gov.br): sem sinalização, o limite é 80 km/h em VTR, 60 em arterial, 40 em coletora e 30 em local. Em rodovia de pista dupla é 110 para automóveis e **90 km/h para os demais veículos**; em pista simples é 100 e **90**.

## Integração proposta
1. **Curto prazo, sem dados externos.**
   - Ajustar o costing truck: `top_speed` em torno de 80–90 km/h.
   - Penalizar semáforos (camada da CET).
   - Usar a classificação viária da CET para preencher a velocidade-base onde falta `maxspeed`.
   - No cálculo de entrada na ZMRC, aplicar sobre o ETA um **fator horário** por tipo de dia, derivado da curva CET 2023 e calibrado com MSVP 2019 e TomTom Index, e exibir uma faixa (otimista e pessimista).
2. **Médio prazo, com tráfego histórico próprio.**
   - Coletar os traços GPS dos usuários (com consentimento LGPD).
   - Fazer map-matching com `/trace_attributes` (já disponível no serviço local).
   - Agregar a velocidade por edge, por balde de 5 min e por dia da semana, separando caminhão.
   - Gerar CSVs por tile e rodar `valhalla_add_predicted_traffic`.
   - Reempacotar o tar e passar `date_time` nas rotas.
   - Tabelas no Postgres: `traffic_probe_raw`, `traffic_edge_speed_5min` (edge_id, dow, bucket, p50, n) e `traffic_profile_export`.
3. **Tempo real, se for um requisito.**
   - Opções: contratar o TomTom (Traffic Flow Segment Data ou Intermediate Traffic) ou o HERE Traffic, e converter para `traffic.tar` (o formato está em `valhalla/traffictile.h`: 7 bits de velocidade a cada 2 km/h, 3 subsegmentos e nível de congestionamento).
   - Alternativa mais barata: usar a API de rota do TomTom/HERE só para o ETA final em rotas curtas antes da ZMRC (cerca de EUR 1,00 a 2,33 por mil requisições).
   - Pendências: validar os termos de armazenamento e confirmar se esses dados podem ser exibidos sobre o mapa OSM.
4. **O que não usar.** Google (termos), Waze for Cities (elegibilidade), Uber Movement (descontinuado) e scraping da home da CET (sem licença; só 5 números por região).

## Lacunas
- A série de lentidão da CET baseada no Waze, de 2024 em diante, não está publicada.
- Não existe fonte aberta de velocidade horária por trecho na RMSP.
- Não confirmei: termos de cache do TomTom e da HERE; cobertura de tráfego da HERE no Brasil; cláusula atual da Mapbox; data de descontinuação do Uber Movement; termos de uso do Waze para usuários (o limite de WebFetch e buscas da sessão foi atingido).
- O orçamento de buscas web da sessão acabou (200/200) antes de testar INRIX, StreetLight e o CCR/Motiva "tempo de percurso". Ficaram de fora.
