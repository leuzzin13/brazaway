# Qualidade do OSM no Brasil para caminhões e quais tags o Valhalla lê

Tema: `osm_qualidade_valhalla` · rodada concluída em 2026-10-09 (continuação da tentativa interrompida, que só tinha baixado o código do Valhalla em `valhalla_src/`).
Dados OSM usados: PBF Geofabrik Sudeste de 2026-10-08T20:21Z (seq 2485), taginfo Geofabrik (data_until 2026-10-08T20:19Z), Overpass (ao vivo), ohsome (até 2026-07-27).

## 0. Como reproduzir / onde estão as coisas
- `valhalla_src/`: arquivos do Valhalla **no commit exato que roda no container** (`valhalla_service --version` → `3.9.1-c803bdc2f`; `tree.json` = árvore do commit c803bdc2f). `v391/` é idêntico (diff vazio). Baixados agora também: `valhalla_mjolnir_adminconstants.h`, `src_mjolnir_countryaccess.cc`, `lua_admin.lua`, `releases.json`.
- `taginfo/`: `br_key_stats.json`, `br_key_values.json` (valores por chave), `br_chron_*.json` (crescimento), `regioes_ways.json` (por região Geofabrik).
- `osmium/`: `rmsp_union.geojson` (união dos 39 municípios da RMSP, IBGE, vindo do tema restricoes_rmsp_municipios), `analise_rmsp.py` (imita o parser do Valhalla), `resultado_rmsp.json`, `rmsp_vias_tags_caminhao.csv` (1.765 vias com tag de caminhão), `rmsp_nos_maxheight.geojson` (107 nós), `passagens_inferiores_sem_maxheight_rmsp.geojson` (vias principais sob ponte/viaduto sem maxheight), `roads_rmsp.geojsonseq.gz` (export filtrado; `gunzip` antes de rodar o script).
- `overpass/`: `br_conditional_ways.json` (1.326 vias com maxweight:conditional, hgv:conditional ou hgv=discouraged no BR), `br_mh_default_2026.json`, `br_counts.json`, changesets.
- `ohsome/`: séries anuais RMSP. `qa_tools/`: Osmose, OSM Inspector, notas OSM. `licencas/`: parecer AddressForAll, categorias do fórum, UMBRAOSM. `valhalla_tests/`: respostas do Valhalla local.
- Docker: o bind mount de `/private/tmp/...` **não funciona no Colima** (a pasta aparece vazia no container; foi o que travou a tentativa anterior). Usei `docker cp`. Container `osmq2` (imagem `osmq-img`, osmium 1.15) com `/tmp/rmsp.osm.pbf` (144 MB, recorte poligonal da RMSP).
  ```
  docker cp osmium/rmsp_union.geojson osmq2:/tmp/
  docker exec osmq2 osmium extract -p /tmp/rmsp_union.geojson -s smart /data/sudeste-latest.osm.pbf -o /tmp/rmsp.osm.pbf
  docker exec osmq2 sh -c 'osmium tags-filter /tmp/rmsp.osm.pbf w/highway=... w/railway=... w/bridge n/maxheight n/barrier=height_restrictor ... -o /tmp/roads.osm.pbf && osmium export -c /tmp/export_cfg.json -f geojsonseq /tmp/roads.osm.pbf -o /tmp/roads.geojsonseq'
  docker cp osmq2:/tmp/roads.geojsonseq osmium/roads_rmsp.geojsonseq && ../venv/bin/python osmium/analise_rmsp.py osmium/roads_rmsp.geojsonseq
  ```

## 1. O que o Valhalla 3.9.1 (c803bdc2f) lê para caminhão — confirmado no código
Fluxo: `lua/graph.lua` normaliza tags da **via** → `src/mjolnir/pbfgraphparser.cc` cria `AccessRestriction` → `src/sif/truckcost.cc` (`ModeSpecificAllowed`) e `valhalla/sif/dynamiccost.h` (`EvaluateRestrictions`) decidem na rota.

| Tag OSM (em ways) | Como é lida | Efeito no costing truck |
|---|---|---|
| `hgv`, `hgv:forward`, `hgv:backward` (+ `access`, `motor_vehicle`, `vehicle`, `motor_vehicle:forward/backward`) | tabela `truck` do graph.lua: designated/yes/destination/delivery/local/private/permissive/official/permit/residents = permitido; **no/agricultural/forestry/discouraged/unsuitable = proibido** | proibido = aresta fechada (a menos que `hgv_no_access_penalty` < 43200) |
| `hgv=destination/delivery/private/permit/customers/residents` | `private_hgv` → `destination_only_hgv` | só entra se origem/destino estiver lá |
| `maxheight` (se não numérico, cai em `maxheight:physical`), `maxheight:forward/backward` | `normalize_measurement`: aceita `4.5`, `4,5`, `4.5 m`, `450 cm`, pés/polegadas; `default`, `below_default`, `none`, texto → **ignorado** | bloqueia se altura do veículo **>** limite (igual passa) |
| `maxwidth` (fallback `maxwidth:physical`), `maxwidth:forward/backward` | idem | idem |
| `maxlength`, `maxlength:forward/backward` | idem (sem `:physical`) | idem |
| `maxweight`, `maxweight:forward/backward` | `normalize_weight`: `45`, `45 t`, `45000 kg`, `ton`, `lbs`; **vírgula não é tratada** (`3,5` vira 3; `4,30` vira 4); número sem unidade grande (`4500`) vira 4.500 t (sem efeito) | bloqueia se peso > limite |
| `maxaxleload` | normalize_weight | só caminhão |
| `maxaxles` | tonumber | só caminhão |
| `<tag>:conditional` = `none @ destination` / `none @ delivery` / `no @ destination` / `none @ (destination)` para maxweight/maxheight/maxlength/maxwidth/hazmat | marca a restrição como "exceto destino" | libera se destino estiver no trecho |
| `hazmat`, `hazmat:water`, `hazmat:A..E` (+ `:forward/:backward`) | yes/designated = permitido; no/destination/delivery = proibido | só afeta pedido com `hazmat:true` |
| `hgv:conditional`, `motor_vehicle:conditional`, `access:conditional`, `motorcar:conditional` (+ psv/bus/taxi/hov...) | `no` → TimedDenied; `yes/private/delivery/designated` → TimedAllowed; `destination` → DestinationAllowed; **só se o valor tiver exatamente um `@`** | aplicado **somente se o pedido trouxer `date_time`**; sem `date_time` é ignorado |
| `maxspeed:hgv` (+ forward/backward) | velocidade de caminhão da aresta | tempo estimado |
| `hgv=designated`/`hgv=local`, `hgv:national_network`, `hgv:state_network` | `truck_route` | preferência com `use_truck_route` |
| `restriction:hgv` (relação), `restriction:conditional` | restrição de conversão | idem conversões |

**NÃO lidos (confirmado no código):**
- `maxheight`/`maxweight` em **nós** e `barrier=height_restrictor` — `nodes_proc` só lê access/barreiras genéricas. Issue aberta: https://github.com/valhalla/valhalla/issues/3487. Teste local: nó 6354358414 (maxheight=2.1) → arestas vizinhas com `access_restriction:false`.
- `maxweight:conditional` com horário/estação (ex.: `none @ (Mo-Fr ...)`, `17 @ (Dec-May)`) — só o caso "exceto destino". Issue aberta: https://github.com/valhalla/valhalla/issues/4683. Resultado: o `maxweight` base vale 24 h.
- Qualificadores dentro de condicionais (`weight>4`, `axles>3`, `width>...`): o parser de tempo (`src/mjolnir/timeparsing.cc`) pula esses tokens → a regra vale para **todo** caminhão. `PH` (feriado) também é ignorado.
- Condicionais com várias regras separadas por `;` e mais de um `@` (ex.: `yes @ (weight < 4); yes @ (...)`) → `GetTagTokens(...,'@')` devolve 3+ pedaços → **descartadas inteiras**.
- `maxweight:hgv`, `maxweightrating`, `maxgcweight`, `goods`, `maxheight:signed`, `maxweight:signed`, `traffic_sign`, `bridge:structure`, `incline`.
- Rampa: `truckcost.cc` não usa grade/elevação (nenhuma ocorrência de "grade"); e o projeto está com `build_elevation: "False"`.
- Override de país: Brasil em `adminconstants.h` só mexe em `bridleway` (nada de caminhão).
- Padrões do costing truck (EUA): altura 4,11 m, largura 2,6 m, comprimento 21,64 m, peso 21,77 t, eixo 9,07 t, 5 eixos. As restrições de altura/largura/comprimento/peso também valem para auto/ônibus/táxi/HOV.

### Testes no Valhalla local (http://localhost:8002, tiles do PBF 2026-10-08) — `valhalla_tests/`
1. Marginal Tietê (Expressa), way 4614918, `hgv:conditional=no @ (Mo-Fr 05:00-09:00,17:00-21:00; Sa 10:00-14:00)`, rota truck de (-23.51705,-46.6560) a (-23.51891,-46.6405):
   - sem `date_time` → rota 1,60 km (restrição ignorada);
   - `date_time` 2026-10-14T08:00 (quarta) → erro 442 "No path";
   - 2026-10-14T12:00 → rota 1,60 km.
2. `hgv=discouraged` (way 153812960, R. São Gabriel Arcânjo) → `/locate`: `truck:false`.
3. Ponte da Vila Guilherme (`maxweight=60`) → `access_restriction:true`.
4. Nó com maxheight 2.1 → nenhuma restrição gravada.
A API do projeto (`api/src/services/valhalla.ts`) só manda `date_time` se `departureLocal` vier — sem ele, toda condicional é ignorada.

## 2. Contagens Brasil (taginfo Geofabrik, 2026-10-08)
API testada: `curl -A "truck-router-mvp/0.1" "https://taginfo.geofabrik.de/south-america:brazil/api/4/key/stats?key=maxheight"` → 200 JSON. Também `key/values`, `key/chronology`, `tag/chronology`, e sub-regiões `south-america:brazil:{sudeste,sul,nordeste,norte,centro-oeste}`.

| chave | objetos | ways | obs. |
|---|---|---|---|
| maxheight | 10.100 | 9.774 (+322 nós) | 3.587 não numéricos: default 3.057, below_default 307, none 178, no_indications 39 → ~6.513 lidos |
| maxweight | 4.227 | 4.195 | valores 6 (768), 10 (391), 45 (374), 23 (264), 7.5 (254)... alguns <1 t (0, 0.01, 0.6, `120 kg`) e kg sem unidade (4500, 7000, 4536) |
| maxlength | 1.150 | 1.145 | 6.5 (657), 9 (230); `211` ×28 parece comprimento da ponte (erro) |
| maxwidth | 893 | 811 | 2.2 (630); `1` ×19 bloquearia tudo |
| hgv | 5.124 | 5.048 | no 3.063, **discouraged 663**, designated 656, yes 589, destination 27, permit 24, delivery 19 |
| hgv:conditional | 350 | 349 | ver §4 |
| maxweight:conditional | 318 | 317 | ver §4 |
| motor_vehicle:conditional / access:conditional | 384 / 114 | | |
| hazmat | 74 | 74 | no 61, yes 7, designated 6; hazmat:A..E/water = 0 |
| maxaxleload / maxaxles | 12 / 20 | | |
| maxspeed:hgv | 13.458 | 12.929 | 80 (6.041), 90 (5.320), 60, 50 |
| maxweight:signed / maxheight:signed | 807 / 164 | | "no" = conferido sem placa (StreetComplete) |
| restriction:hgv | 44 relações | | |
| traffic_sign | 8.731 | | BR:R-14..R-18 (placas de peso/altura/largura/comprimento) = **0**; `maxheight` 11, `maxweight` 9 |
| goods / incline / bridge:structure | 852 / 9.691 / 2.578 | | |

Por região (ways): maxheight Sul 5.213 · Sudeste 3.268 · Nordeste 1.049 · Centro-Oeste 172 · Norte 73; maxweight Sul 2.508 · Sudeste 1.083 · Norte 277 · Nordeste 245 · CO 82; hgv Sul 2.162 · Sudeste 2.156 · Nordeste 433 · CO 305 · Norte 3.
Overpass (Brasil, área 3600059470): **123.397 trechos de ponte rodoviária, 336 com maxweight (0,27%)**, 773 com `maxweight:signed=no`; 3.862 túneis rodoviários, 359 com maxheight (9,3%).
Crescimento (acumulado no fim de cada ano): maxheight 1.162 (2016) → 5.965 (2025) → 10.108 (out/2026); maxweight 251 → 4.230; hgv 375 → 5.129; hgv:conditional parado em ~345 desde 2023.
**O salto de 2026 é um mapeador só**: 2.894 vias com `maxheight=default` editadas desde 14/01/2026, 2.600 delas por `ftrebien`, na Grande Porto Alegre (204 changesets, JOSM, `source=Survey`, comentário "Adicionado limite de altura"; ex.: https://api.openstreetmap.org/api/0.6/changeset/177544973.json). Ou seja: a cobertura de altura depende de poucas pessoas, concentradas no Sul.

## 3. Contagens Grande SP (RMSP, 39 municípios, osmium no PBF local)
- 302.426 vias dirigíveis (54.409 km; 11.388 km de motorway→tertiary).
- maxheight: 1.108 vias (1.015 numéricas, 851 em vias principais; 33 default, 30 no_indications, 26 none, 4 below_default). **257 vias com limite < 4,40 m** (altura máxima legal usada nos presets) — ex.: Túnel Jânio Quadros 3,5 m; Túnel Fanganiello Melhem 4,1; Av. 23 de Maio 4,1; Av. Pacaembu 3,8. **Nenhuma** tem `source:maxheight`. Valores >7 m em rodovias (Fernão Dias 8,7; Rodoanel 10; Anchieta 12) parecem gabarito físico medido/estimado, não placa.
- Passagens inferiores (via não-ponte cruzando geometricamente por baixo de ponte/viaduto rodoviário ou ferroviário, com layer): 3.084 vias; **2.407 (78%) sem maxheight**; nas principais 2.747 → 2.104 sem.
- Túneis/cobertos: 1.948 vias; 108 com maxheight numérico. Osmose item 7130 "Missing maxheight tag": 95 alertas na RMSP, 775 no Brasil.
- Nós: 107 com maxheight (73 soltos na via, 17 lift_gate, 15 height_restrictor) — **todos ignorados pelo Valhalla**.
- Pontes: 3.389 trechos de ponte/viaduto em vias dirigíveis; **6 com maxweight** (5 em vias principais); 46 `maxweight:signed=no`. maxweight em toda a RMSP: 26 vias (ohsome: 22). ohsome: pontes com maxweight 0 (2018) → 6 (2026).
- maxlength 12 · maxwidth 5 · maxaxleload 1 · maxaxles 0.
- hgv: 403 vias (no 287 = 68 km; designated 45; permit 23; destination 13; **discouraged 13 = 2,4 km tratados como proibidos**; local 10). hgv=no inclui Minhocão, Imigrantes (10 trechos), túneis da Imigrantes, Radial Leste, etc.
- hgv:conditional: só 6 vias — **3 dos 103 trechos da Marginal Tietê (Expressa)** têm a restrição; os outros 100 não. Marcação parcial gera rota incoerente.
- hazmat 25 (Imigrantes e túneis: no; "Parada para Cargas Especiais": designated).
- motor_vehicle:conditional 160 (ex.: Paulista domingo `no @ (Su 09:00-17:00)` funciona com date_time); access:conditional 14 (6 com dois `@` → ignoradas).
- maxspeed:hgv 2.605 vias (1.275 km).
- Idade da última edição de vias com maxheight numérico: maioria 2021–2026.
- ohsome (bpolys RMSP): maxheight 332 (2018) → 1.067 (2026); hgv 20 → 414; usuários distintos editando vias com maxheight/maxweight/hgv por ano: 36 (2018), 104 (2020), 112 (2021), 37 (2022), 50, 61, 79 (2025).
- Notas OSM na RMSP: 7 com "caminhão", 7 com "altura"; quase todas fechadas por mapeadores. Uma relata maxheight tirado "segundo imagens do Google Maps" (fonte não permitida no OSM → risco de dado removido).

## 4. Onde o Valhalla erra com dado brasileiro (fora da RMSP)
- Santa Maria/RS: 211 vias `maxweight=7.5` + `maxweight:conditional=none @ psv,emergency;none @ (Mo-Fr 00:00-08:00,20:00-24:00;Sa ...)` → Valhalla aplica 7,5 t **24 h**.
- Amazonas (BR-319 e arredores): 92 vias `maxweight=23` + `17 @ (Dec-May)` → limite sazonal ignorado.
- Blumenau/SC: 87 vias `hgv=no` + `delivery @ (... AND weight>4)` → janela liberada para todo caminhão (peso ignorado).
- Região de Erechim/RS (-27.6,-52.3): 24 vias `yes @ (weight < 4); yes @ (...)` → descartado, `hgv=no` vale 24 h.
- Fortaleza 90 vias, Passo Fundo 81, Rio 29, Vitória 14 → formatos lidos corretamente (com date_time).
- hgv=discouraged: 663 no Brasil (concentrações por célula de 0,1°: Timbó/Vale do Itajaí-SC 51, Guaratinguetá/Aparecida-SP 51+, interior de Goiás (-15.3,-49.6) 23, Zona da Mata-MG 15+, Recôncavo-BA 15+, Rio 13, centro de SP 13) → bloqueadas.

## 5. Comunidade OSM Brasil, importação e licenças
- Fórum: https://community.openstreetmap.org/c/communities/br/55 (588 tópicos; busca por "maxheight" e "altura viaduto" = 0 tópicos; não há discussão de caminhão). Propostas recentes de importação: GDF (ago/2026), edifícios de Brasília (dez/2025), CNEFE/IBGE (2024), **Santo André/SP (nov/2023, dados municipais sob ODbL)**.
- Associação: UMBRAOSM (União dos Mapeadores Brasileiros do OpenStreetMap), https://umbraosm.com.br (site no ar).
- Wiki de importações BR: https://wiki.openstreetmap.org/wiki/WikiProject_Brazil/Importa%C3%A7%C3%B5es — processo: achar responsável, mandar e-mail oficial pedindo licença compatível, registrar no wiki, catalogar. Autorizações listadas: GEOMINAS, IBGE (fronteiras), IPECE, IJSN (domínio público), SEMAD-MG; MMA negou (2010). Nada sobre GeoSampa, DER, DNIT, ANTT, CET.
- Regras globais: https://wiki.openstreetmap.org/wiki/Import/Guidelines — discutir com a comunidade local e no fórum (tags `import`/`import-proposal`, 14 dias), página no wiki, conta `_import` dedicada, licença compatível com permissão explícita; edição automatizada segue também o Automated Edits code of conduct.
- Compatibilidade (OSMF, página atualizada 20/11/2025): https://osmfoundation.org/wiki/Licence/Licence_Compatibility — CC0, domínio público verificado, OGL 2/3 ok; **CC BY 4.0 só com waiver explícito**; CC BY-SA, NC, ND incompatíveis.
- GeoSampa: **CC BY-SA 4.0** (https://prefeitura.sp.gov.br/web/licenciamento/w/licen%C3%A7a-para-uso-de-dados-do-geosampa, página de 03/04/2025) → não pode ir para o OSM sem autorização específica; pode ser usado no app (comercial ok) com atribuição e mesma licença ao redistribuir derivados.
- Parecer AddressForAll (https://wiki.osm.org/w/images/3/38/Licenciamento_eixos_viarios.pdf) defende que dado geográfico municipal é domínio público (Lei 9.610/98 art. 8 + LAI). É posição de uma ONG, não da OSMF; a comunidade BR na prática ainda pede autorização por escrito (ex.: IJSN 2015).
- Base coletiva x derivada (ODbL): guideline endossada pela OSMF em 17/06/2016 — https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline. Nossos reportes ficam fora do share-alike se, por propriedade e região, usarmos "tudo OSM ou nada OSM"; misturar maxheight do OSM com maxheight reportado no mesmo atributo/região tende a virar base derivada (share-alike se publicada). Decisão jurídica a validar.
- Wiki Pt:Key:hgv define veículo pesado no BR como >3.500 kg citando "Resolução CONTRAN nº 798" — **não confirmei a norma** (busca web esgotada); tratar como não verificado.

## 6. Ferramentas de QA testadas
- Osmose API (`https://osmose.openstreetmap.fr/api/0.3/issues?item=7130&bbox=-47.21,-24.07,-45.69,-23.18`) → 200; RMSP: 7130 (túnel sem maxheight) 95, 3350 (condicional ruim) 236, 7012 (ponte/túnel mal conectado) 224, 9006 (formato numérico) ≥500, 2130 (barreira bloqueando via) ≥500. Brasil: 7130 = 775, 3350 = 1.017. Item 8320 (placas Mapillary não integradas) = 0 na RMSP.
- OSM Inspector (Geofabrik) WMS `https://tools.geofabrik.de/osmi/view/highways/wxs` tem camadas maxheight/maxweight/maxlength; `view/routing` tem islands_car etc. WFS respondeu 200, mas a camada maxheight veio vazia num bbox do centro de SP (provavelmente só mostra valores problemáticos — não confirmado).
- Notas OSM (API 0.6 `notes/search.json`) → 200.

## 7. Falhas / limitações
- `dados.prefeitura.sp.gov.br/api/3/action/package_search` → página anti-bot (HTML com JS) e depois 502; não deu para listar licenças do CKAN da PMSP.
- `dados.gov.br/dados/api/...` → 401 (exige token).
- Overpass: primeira tentativa 504 (sobrecarga); repetida → 200.
- Logs do Valhalla não têm estatística de tags inválidas (tiles carregados do tar, `use_tiles_ignore_pbf`).
- Bind mount /private/tmp no Colima vazio (ver §0).
- Busca web atingiu o limite da sessão no fim; UMBRAOSM confirmado por curl.

## 8. Como integrar no app (resumo)
1. **Sempre mandar `date_time`** (agora, fuso America/Sao_Paulo) no `/route`; sem isso hgv:conditional/motor_vehicle:conditional não valem.
2. **Pré-processar o PBF antes do build** (script osmium/pyosmium num container): (a) copiar `maxheight` de nós/`height_restrictor` para o trecho da via (dividir a via no nó); (b) `hgv=discouraged|unsuitable` → remover ou trocar por penalidade via `linear_cost_factors`; (c) normalizar `maxweight` com vírgula e kg sem unidade; (d) para `maxweight:conditional` com horário, gerar `hgv:conditional` equivalente ou tirar o maxweight base e tratar na nossa camada de restrições; (e) quebrar condicionais com dois `@` em regras aceitas. Guardar o PBF derivado como privado (é base derivada ODbL — se for publicado, share-alike).
3. **Tabela `osm_quality_gaps`** (PostGIS): passagens inferiores sem maxheight (2.104 nas vias principais da RMSP), pontes sem maxweight, túneis do Osmose 7130 → usar como "zona de incerteza" (aviso na rota para veículo >4,0 m) e como fila de checagem dos reportes colaborativos.
4. **Ciclo de volta ao OSM**: reporte confirmado por votos → abrir nota OSM (texto do motorista, sem dado pessoal) ou desafio MapRoulette; nunca escrever no OSM em massa sem seguir Import Guidelines. Não usar Google/Street View como fonte.
5. Monitorar mensalmente via taginfo/ohsome (séries acima) e Osmose (bbox RMSP) para medir cobertura.
