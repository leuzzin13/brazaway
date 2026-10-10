# Superfície e condição do pavimento (terra, obra, pavimento ruim) — expansão Brasil

Pesquisa feita em 2026-10-09. Tudo o que está marcado como "testado" foi baixado ou consultado de verdade (curl/python) a partir desta máquina.
As amostras estão nesta pasta. O repositório `/Users/arthurleuzzi/Projetos/truck-router` não foi editado.

## 0. Resumo

1. **O risco é maior do que parece, e o maior buraco está no OSM.** O Valhalla 3.9.1 trata como **pavimentada** toda via
   `tertiary`, `unclassified` ou `residential` sem `surface`, `tracktype` ou `smoothness` (`pbfgraphparser.cc`, bloco "If no surface has been set").
   - No Brasil, entre as `unclassified` que têm `surface`, **92 a 99% são de terra** (14 UFs medidas).
   - Mas **23 a 75% das `unclassified` não têm tag nenhuma**.
   - Só no PBF do Sudeste são cerca de 207 mil km de `unclassified` sem tag, que o Valhalla trata como asfalto.
   - Por isso `exclude_unpaved` sozinho não resolve.
2. **Hoje o custo do truck penaliza pouco a terra.** O fator de superfície soma só +0,1 (compactada), +0,2 (terra) e +0,5 (cascalho) ao custo.
   A **velocidade não muda**: uma secondary de cascalho roda a 44 km/h, igual à asfaltada. O ETA em terra fica otimista.
3. **Experimento com 260 rotas truck aleatórias** (carreta de 45 t, origem e destino em via pavimentada):

   | Região | Rotas que passam por terra já marcada no OSM | Km de terra (mediana) | Efeito do `exclude_unpaved` | Sem rota (erro 442) |
   |---|---|---|---|---|
   | Anel de 40 km da RMSP | 13% | 2,6 km | +10% km | 6 de 120 |
   | Sul de MG | 24% | 12 km, 19% da rota | +63% km e +42% tempo | 6 de 80 |
   | Norte de MG | 18% | 17 km, 27% da rota | +128% km e +80% tempo | 3 de 60 |

   Conclusão: `exclude_unpaved` sempre precisa de fallback. Ele também pode dobrar a rota, então serve melhor como penalidade "macia" (duas rotas e comparação) do que como bloqueio.
4. **Dados oficiais bons e abertos existem e foram testados:**
   - **SNV/DNIT WFS:** superfície e obra das federais, com estadual coincidente.
   - **DNIT ICM, CKAN do próprio DNIT, sem token:** condição mensal por km, **inclusive das federais não pavimentadas**, com prova de sazonalidade.
   - **DER-SP:** `tipopista` IMP nas estaduais de SP, licença CC-BY-4.0.
   - **DER-MG:** IDE-Sisema, WFS com `superficie`.
   - **IBGE BC250 2025:** WFS nacional com `revestimento` e **`trafego = Periódico`**.
   - **INMET:** avisos ativos e normais de chuva.
5. **A Pesquisa CNT tem dados por trecho de cerca de 10 km.** Vem pelo Power BI público, com classe do pavimento, geometria e "Em obra".
   Porém **não tem licença**: a CNT é entidade privada. Não usar em produção sem autorização por escrito.
6. **Descartados por licença:** HeiGIT/Planet (só não comercial). O HeiGIT/Mapillary é ODbL e utilizável, mas acrescenta só cerca de 1% de cobertura no Brasil.

---

## 1. Como o Valhalla 3.9.1 trata a superfície (código e testes)

O código-fonte é o do commit `c803bdc2f`, o mesmo de `/status` (`3.9.1-c803bdc2f`), e está salvo em `valhalla_src/`.

### 1.1 Tags que viram superfície (`pbfgraphparser.cc`, linhas 1476–1580 e 3016+)

| Tag OSM | Superfície no Valhalla |
|---|---|
| `surface` com `unpaved` | kGravel |
| `surface` asphalt, concrete, paved | kPavedSmooth |
| `surface` paving_stones, sett | kPaved |
| `surface` cobblestone | kPavedRough |
| `surface` compacted | kCompacted |
| `surface` dirt, ground, earth, mud, clay, laterite | kDirt |
| `surface` gravel, sand | kGravel |
| `surface` grass | kPath |
| `tracktype` (só sem `surface`) | grade1 = PavedRough, grade2 = Compacted, grade3 = Dirt, grade4 = Gravel, grade5 = Path |
| `smoothness` (só sem `surface` e sem `tracktype`) | bad = Compacted, very_bad = Dirt, horrible = Gravel, impassable = Impassable (bloqueia) |
| **Nenhuma das três tags** | motorway a residential = **PavedSmooth**; `track` = Dirt; service = PavedSmooth |

`unpaved()` é verdadeiro quando a superfície é Compacted ou pior (`directededge.h:753`).

### 1.2 Custo do truck (`truckcost.cc`)

- A partir da linha 84: `kSurfaceFactor = {0, 0, 0, 0.1 (compacted), 0.2 (dirt), 0.5 (gravel), 1.0 (path)}`, **somado** ao fator da aresta. Não é configurável por requisição.
- A partir da linha 469, em `Allowed()`: `exclude_unpaved_ && !pred.unpaved() && edge->unpaved()` → a aresta é proibida.
  Ou seja, a rota não pode *entrar* em terra vinda de asfalto, mas pode começar ou terminar nela.
- A velocidade da aresta **não depende da superfície**. Nem `speed_assigner.h` nem `graphbuilder.cc` citam surface.
  Medido com `trace_attributes` nos trechos LEN/IMP do SNV no Sudeste:

  | Classe | Velocidade em terra | Velocidade em asfalto |
  |---|---|---|
  | primary | 51 km/h | 50 km/h |
  | secondary | 44 km/h | 43 km/h |
  | tertiary | 33 km/h | 33 km/h |

- `use_tracks` vale 0 por padrão no truck (`kDefaultUseTracks`), mas só afeta `highway=track`.

### 1.3 Na resposta da rota

- As manobras em aresta não pavimentada vêm com **`"rough": true`**. Isso foi testado: as 46 rotas que usaram terra tinham manobras `rough`.
  O campo dá para gerar aviso e ajustar o ETA **sem chamada extra** (cada manobra já traz `length` e `time`).
- `summary` não tem `has_unpaved`.
- Com `exclude_unpaved: true` e sem caminho pavimentado, o Valhalla devolve **erro 442** ("No path could be found").
  Em `valhalla.ts` isso vira `NoRouteError`. É obrigatório refazer sem a opção e avisar.
- `grep -rni "unpaved\|ferry\|rough" api/src` não acha nada, e "surface" só aparece em `ST_PointOnSurface`. Confirma a pista.

### 1.4 Experimento `exp_exclude_unpaved.py` (Valhalla local, tiles do Sudeste)

Método:
- Origem e destino aleatórios, com 8 a 60 km em linha reta, ambos em via pavimentada de motorway a tertiary (conferido com `/locate`).
- Truck de 4,4 m × 2,6 m × 18,6 m, 45 t e 6 eixos.
- Cada par foi roteado com e sem `exclude_unpaved`.
- Os km de terra vêm de `trace_attributes` sobre o shape da rota.
- Resultados em `exp_exclude_unpaved_*.json`.

| Zona | Rotas | Usam terra marcada no OSM | Km de terra (mediana) | Fração da rota | +km com exclude (mediana) | +tempo (mediana) | Sem rota com exclude |
|---|---|---|---|---|---|---|---|
| Anel de 40 km da RMSP | 120 | 16 (13%) | 2,6 (máx. 15,4) | 3% | +10% (máx. +97%) | +7% | 6 |
| Sul de MG | 80 | 19 (24%) | 12,0 (máx. 32,6) | 19% | +63% (máx. +156%) | +42% | 6 |
| Norte de MG | 60 | 11 (18%) | 16,9 | 27% | +128% | +80% | 3 |

Esses números são um **piso**: contam só a terra *marcada*. A terra sem tag (item 2) passa como asfalto.

---

## 2. Cobertura de surface no OSM

### 2.1 PBF do Sudeste local

Arquivo: `data/valhalla/sudeste-latest.osm.pbf`, 860 MB. Script `osm_surface_stats.py` (pyosmium) aplicando a mesma regra do Valhalla.
Saída em `osm_surface_stats_sudeste.json`.

| Zona | Classe | km | Com `surface` | Sem info (vira asfalto) | Terra marcada | % de terra entre os que têm tag |
|---|---|---|---|---|---|---|
| SP | tertiary | 33.973 | 78% | 22% | 12.002 km | 45% |
| SP | unclassified | 136.605 | 50% | 49% | 65.691 km | 95% |
| MG | tertiary | 63.736 | 88% | 12% | 48.699 km | 87% |
| MG | unclassified | 282.345 | 56% | 44% | 157.509 km | 99% |
| RJ | unclassified | 24.035 | 58% | 42% | 13.564 km | 97% |
| ES | unclassified | 37.281 | 86% | 14% | 31.713 km | 99% |
| RMSP | unclassified | 5.056 | 58% | 42% | 2.392 km | 81% |
| Anel de 40 km da RMSP | tertiary | 4.178 | 76% | 24% | 1.488 km | 47% |
| Anel de 40 km da RMSP | unclassified | 11.771 | 58% | 41% | 6.354 km | 92% |

- Trunk e primary têm `surface` em 87 a 100% dos km.
- **Estimativa grosseira de terra "escondida"** (km sem tag × proporção de terra entre os que têm tag):
  - SP: cerca de 64 mil km de `unclassified`;
  - MG: cerca de 123 mil km;
  - anel de 40 km da RMSP: cerca de 4.500 km de `unclassified` e 470 km de `tertiary`.
  - É um teto: o viés de quem marca é desconhecido.
- `osm_unpaved_anel40km_rmsp.geojson.gz` traz 7.781 ways com terra explícita no anel de 40 km: 6.354 km de `unclassified`, 1.488 km de `tertiary` e 77 km de `secondary`.

### 2.2 Outras UFs (Overpass, contagem de *ways*)

Arquivos em `overpass/*_counts.json`, gerados por `overpass/q.sh UF` com User-Agent.

| UF | `unclassified` sem surface | % de terra entre as que têm surface | `tertiary` sem surface |
|---|---|---|---|
| MT | 45% | 99% | 51% |
| PA | 67% | 97% | 57% |
| GO | 57% | 98% | 51% |
| MS | 47% | 97% | 53% |
| BA | 37% | 99% | 29% |
| PR | 53% | 97% | 49% |
| TO | 55% | 97% | 64% |
| MA | 36% | 99% | 62% |
| RO | 54% | 98% | 53% |
| AM | 52% | 92% | 29% |
| SC | 23% | 93% | 19% |
| CE | 75% | 97% | 52% |

RS falhou: 504 no overpass-api.de e 500 no espelho private.coffee, em 3 tentativas.

### 2.3 Taginfo e HeiGIT

- **Taginfo da Geofabrik:** `south-america:brazil` dá **HTTP 500** e falhou. As instâncias regionais (`south-america:brazil:sudeste` etc.) funcionam,
  mas `tag/combinations` também dá 500. Por isso foram usados o PBF e o Overpass.
- **HeiGIT, metadados no HDX:**
  - O OSM do Brasil tem 4,57 milhões de km de via, e **47,4% sem informação de superfície**.
  - O modelo Mapillary preenche só 23 mil km (1,1%).
  - Nos arteriais (motorway a secondary), o modelo PlanetScope tem 89,2% de acurácia, contra 64,7% das tags do OSM.

---

## 3. Fontes (testadas)

### 3.1 SNV/DNIT via WFS DNITGeo — `vgeo:vw_snv_rod` (pista 1: CONFIRMADA)

- **Acesso:** `https://servicos.dnit.gov.br/dnitgeo/geoserver/wfs`, `typeNames=vgeo:vw_snv_rod`. É o mesmo WFS que o `siaet_restricoes.py` já usa (`snv_uf()`, `wfs_get`).
  - HTTP 200, GeoJSON, sem token.
  - Só atributos do Brasil todo: 4,2 MB em cerca de 2 s (`snv_202607A_attrs.json.gz`).
  - Geometria dos 545 trechos de terra ou obra: 17 MB em 41 s (`snv_202607A_naopav_obra.geojson.gz`).
- **Campos:** `Superficie_Federal`, `Obra`, `Superficie_Estadual_Coincidente`, `Estadual_Coincidente`, `Codigo_SNV`, `Coincidencia_Federal`, km inicial e final, `Administracao`, `Versao_SNV`.
- **Versão 202607A, extensão somada por `Superficie_Federal`** (bate exatamente com a pista):

  | Código | Significado | km | Segmentos |
  |---|---|---|---|
  | PAV | pavimentada | 65.415 | 3.809 |
  | DUP | duplicada | 9.182 | 1.193 |
  | IMP | implantada, sem pavimento | 6.143 | 269 |
  | LEN | leito natural | 1.925 | 58 |
  | TRV | travessia | 154 | 27 |
  | PLA | planejada | 48.872 | 2.317 |

  Sem contar duas vezes os trechos coincidentes (`Codigo_SNV == Coincidencia_Federal`): IMP 5.386 km e LEN 1.904 km.
- **PLA com estadual coincidente existe na prática.** A rodovia federal é planejada, mas a estadual por baixo existe:
  - PLA + estadual PAV: 21.077 km;
  - PLA + estadual DUP: 3.074 km;
  - **PLA + estadual IMP: 1.784 km**;
  - **PLA + estadual LEN: 1.390 km**;
  - PLA + estadual EOP: 73 km.

  A superfície efetiva é `Superficie_Federal`, ou `Superficie_Estadual_Coincidente` quando a federal é PLA.
- **`Obra`:**

  | Código | Leitura | km |
  |---|---|---|
  | EOD | em obras de duplicação; quase tudo sobre PAV | 1.044 |
  | EOP | em obras de pavimentação; quase tudo sobre IMP | 945 + 90 LEN + 22 PAV |
  | EOI | em obras de implantação; sobre LEN | 28 |

  - Por UF: PA 274 km de EOP, BA 262 de EOD, RS 248 de EOD, AM 158 de EOP etc.
  - A leitura das siglas segue o padrão do SNV, com as mesmas abreviações de DER-MG e DER-SP.
  - O PDF "Terminologias Rodoviárias v11.1" do DNIT deu **503** duas vezes e não foi lido.
- **UFs com mais terra efetiva** (LEN + IMP, federal e estadual coincidente):

  | UF | km |
  |---|---|
  | PA | 1.525 |
  | MG | 1.422 |
  | AM | 1.384 |
  | BA | 1.236 |
  | MT | 806 |
  | AP | 554 |
  | RS | 465 |
  | RR | 383 |

  - **SP:** 39 km, todos estadual ou municipal coincidente:
    - BR-101 Cananéia/Mandira, 14,5 km;
    - BR-478 Capivari–Porto Feliz, 24,2 km. Esse já está asfaltado no OSM, então o SNV está defasado.
- **Validação contra o OSM/Valhalla** (`cmp_snv_valhalla.py` → `cmp_snv_valhalla_sudeste.json`, MG/ES/RJ/SP):

  | Trecho no SNV | Casado com o Valhalla | Não pavimentado no Valhalla |
  |---|---|---|
  | LEN | 414 km | **90%** |
  | IMP | 304 km | **83%** |
  | IMP estadual coincidente | 612 km | 83% |
  | LEN estadual coincidente | 409 km | 81% |
  | **IMP + EOP** | 96 km | **4%** |
  | PAV + EOD | 76 km | 0% |

  Interpretação:
  - IMP + EOP: as obras de pavimentação provavelmente já terminaram. O SNV atrasa e o OSM está à frente.
  - Divergências conferidas na API do OSM: quase sempre `surface=asphalt` explícito no OSM (BR-484/ES, BR-259/MG, BR-478/SP), ou seja, o SNV está defasado.
  - Exceção: BR-101/SP Colônia Santa Maria–Mandira é `tertiary` **sem tag**, o que mostra o caso "terra virando asfalto por default".
- **Atualização:** o SNV sai mais de uma vez por ano (versões AAAAMM + letra). Descobrir a mais recente pelo `sortBy=Versao_SNV D`, como em `siaet_restricoes.snv_version()`.
- **Licença:** WFS com `Fees=NONE` e `AccessConstraints=NONE`, sem licença explícita. É dado público federal; o portal gov.br do DNIT usa CC BY-ND 3.0.
  - **Uso comercial:** aceitável como dado público factual citando o DNIT, com a mesma postura já registrada em `snv_dnit.py` e `siaet_restricoes.py`.
  - Não redistribuir o shapefile como produto.
- **Valor:** ALTO para federais (terra e obra). **Esforço:** baixo.

### 3.2 DNIT — "Condições do Pavimento" (ICM), CKAN do DNIT (pista 3: CONFIRMADA, com correção)

- **Correção:** o token só é exigido pela API nova do dados.gov.br. O **CKAN do próprio DNIT é aberto**:
  - `https://servicos.dnit.gov.br/dadosabertos/api/3/action/package_show?id=condicoes-do-pavimento` → 200, sem token (`dnit_icm/package_show.json`).
- **Licença:** `other-open` ("Outra (Aberta)"). Dado aberto federal (Decreto 8.777/2016).
  - **Uso comercial permitido com citação**, com a ressalva de que a licença não é nomeada.
- **Periodicidade:** **mensal**. O mês M sai por volta do dia 10 do mês M+1; agosto/2026 saiu em 2026-09-11.
  - 82 recursos, de dez/2020 a ago/2026.
  - Desde jan/2026 são dois CSVs por mês: `levantamentos_pavimentada_AAAA_MM.csv` e `levantamentos_nao_pavimentada_AAAA_MM.csv`. Antes eram XLSX ou CSV.
  - Alguns meses estão sem URL: fev/2026 e dez/2025 não pavimentada, mai/2021.
- **Formato:** CSV com `;`, UTF-8 com BOM, decimal às vezes com vírgula e às vezes com ponto, até no mesmo arquivo. Exige parser tolerante.
  - **Pavimentada (ago/2026):** 93.334 linhas, 1 linha por km e por sentido (C/D), 27 UFs, 115 BRs, 69 contratos.
    - Campos: `id_malha, UF, Contrato, Ano, Mes, Panela, Remendo, Trincamento, Rocada, Drenagem, Sinalizacao_*, Rodovia, km, Sentido, Km_Inicial, Km_Final, Num_Faixas, Superfície, Data Aval., IP, IC, ICM, ICM_Unificado`.
  - **Não pavimentada (ago/2026):** 5.447 linhas, cerca de 5.400 km, 18 UFs, 38 BRs.
    - Campos: `Panela, Corrugacoes, trilha_roda, Secao_Transversal, Poca_dagua, Drenagem, Poeira, ..., ICM`.
    - `Poca_dagua` muda de formato entre meses.
- **Escala do ICM** (dicionário de 2021, `dicionario-de-dados-icm.pdf`): abaixo de 30 Bom, de 30 a 50 Regular, de 50 a 70 Ruim, acima de 70 Péssimo.
  - O dicionário está desatualizado: cita lat/lon e ICC/ICP, que não existem mais.
- **Números de ago/2026:**
  - Pavimentada: 87% Bom, 3,5% Ruim ou Péssimo (pelo ICM).
    - Ruim ou Péssimo por UF: AC 25%, SC 16%, ES 7%, PA 6%.
  - **Não pavimentada:** 53% Bom, 15% Ruim, 9% Péssimo.
    - Ruim ou Péssimo: RJ 86%, ES 78%, CE 76%, RN 72%, PE 71%.
- **Georreferenciamento:** não há coordenadas. Precisa de **referência linear no SNV** (UF + BR + km dentro de `Quilometragem_Inicio`/`Fim`, interpolado na geometria).
  - Testado em ago/2026, 99,9% das linhas casam:
    - não pavimentada → SNV IMP 4.333 e LEN 970 (**97,4% coerente**), PAV 112;
    - pavimentada → PAV/DUP 98%, 874 em SNV IMP. Este último caso indica asfalto recente que o SNV ainda não registrou e serve para detectar defasagem do SNV.
- **SAZONALIDADE (pista 6, evidência forte):** compara as mesmas 4.660 linhas (UF, BR, km) entre mar/2026 (chuva) e ago/2026 (seca).
  - **64% ficaram piores em março** (ICM mais de 5 pontos acima) e 19% piores em agosto.
  - ICM médio, março × agosto:

    | UF | Março | Agosto |
    |---|---|---|
    | MT | 55 | 25 |
    | PA | 56 | 34 |
    | RR | 62 | 24 |
    | TO | 56 | 21 |
    | AM | 44 | 27 |
    | BA | 40 | 23 |
    | PR | 40 | 18 |

  - Distribuição por mês (Ruim + Péssimo): jan 42%, mar 46%, mai 34%, ago 24%.
  - A cobertura varia muito por mês: 5,4 mil linhas em agosto contra 16 mil em maio.
- **Valor:** ALTO. É o único dado oficial mensal de condição das federais de terra. **Esforço:** médio (parser e referência linear).

### 3.3 Pesquisa CNT de Rodovias (pista 4: há dado por trecho; LICENÇA BLOQUEIA)

- O SPA `https://pesquisarodovias.cnt.org.br/` (Angular) consome `https://api.cnt.org.br/pesquisacntrodovia/v1/...`.
  - Endpoints públicos testados com 200:
    - `v1/mapabrasil`: só JPEG em base64;
    - `v1/ufs`;
    - `v1/getpreviousversion`;
    - `v1/fotos?uf=SP...`: 830 fotos em SP, com lat/lon, data, rodovia e município.
  - `v1/mapa` deu "Erro interno". Downloads de conteúdo exigem login.
  - Os painéis `pbi.cnt.org.br` **não resolvem DNS** (intranet).
- **Dados por trecho estão no Power BI "publish to web" embutido no SPA:**
  - Painel 2025: chave `0e4868e3-06db-4f7a-acfd-5f56c7be211e`, modelo 512570.
  - Ranking 2025: chave `a4941d3b-8d8c-4332-8876-c028440cb694`, modelo 512569.
  - Cluster `wabi-brazil-south-d-primary-api`. Os clusters brazil-south-b e us-east deram 401.
  - A consulta `querydata` funciona com o mesmo decodificador DSR do `dnit_pontes.py` (`cnt/pbi.py`).
  - **Tabelas:**
    - `Base_rodovias_notas`: 13.780 UPs (Unidades de Pesquisa) e 121.805 UCs. Traz notas `pav`/`sin`/`geom`/`geral` e classes `cpavim`/`cgeral` (1 Ótimo a 5 Péssimo, conferido contra `classe_geral`), além de jurisdição, concessão e tipo de pista.
    - `vw_rodovias_trecho_2025`: `trecho_stringline` em **WKT LINESTRING completo** e lon/lat inicial.
    - `dados_mapa_powerbi`: pontos ordenados por UP.
    - `PCR_EXTENSAO`: `atn_pavimento_predominante` (Perfeito, Desgastado, Trincas em malha/remendos, Afundamentos/ondulações/buracos, Destruído) e `atn_condicao_rolamento`.
    - **`Em_Obras`**: 12.822 UPs, sendo 1.182 com "Em obra = Sim".
  - **Números 2025** (`cnt/cnt2025_base_rodovias_notas.json.gz`):
    - Pavimento Ruim ou Péssimo por UF: AC 80%, AM 57%, MA 35%, MT 31%, PA 29%, MG 28%, SP 3%.
    - Coleta de 30/06 a 29/07/2025, publicada em dez/2025. A edição de 2026 começou em ago/2026, com IA e cobertura ampliada.
- **Licença:** **nenhuma declarada**.
  - A CNT é entidade privada e a pesquisa é obra protegida. O "publish to web" torna o dado público, mas não o licencia.
  - **Uso comercial: NÃO**, sem autorização escrita da CNT. Útil só como validação interna ou como pedido de parceria.
  - Cobre só rodovias pavimentadas (federais e estaduais principais). Não ajuda com terra.
- **Valor:** médio. Duplica parcialmente o ICM nas federais, mas cobre estaduais. **Esforço:** baixo tecnicamente. **Bloqueio:** jurídico.

### 3.4 DER-SP (pista 5)

- **Malha estadual com tipo de pista:**
  - FeatureServer `https://mapas.der.sp.gov.br/server/rest/services/Hosted/Malha_Rodoviária/FeatureServer/6`: 4.790 trechos, `maxRecordCount` 2000, `lastEdit` 2026-05.
  - Também há XLSX no CKAN, **CC-BY-4.0**: `https://dadosabertos.sp.gov.br/dataset/sistema-rodoviario-estadual`.
    - SHP, KMZ e XLSX; o XLSX tem `last-modified` 2026-09-25 e aba "MalhaSetembro".
  - **Campo `tipopista`:**

    | Código | km |
    |---|---|
    | PAV | 13.330 |
    | DUP | 6.602 |
    | **IMP** | **976** |
    | PLAN | 794 |

    O campo `status` vale sempre "Concluído": não indica obra.
- **IMP perto da capital** (`dersp/dersp_malha_imp_plan.geojson`): **75 km dentro da RMSP e 57 km no anel de 40 km**. Exemplos:
  - SP-008 Mairiporã km 36–44, "trecho em terra";
  - SP-043 Ribeirão Pires/Suzano/Mogi;
  - SP-092 Biritiba Mirim km 75–95;
  - SP-102 Mogi–Bertioga km 81–86;
  - SP-057 e SPA-070/230 em Juquitiba;
  - SP-008 Atibaia/Bragança;
  - SPA-097/250 Piedade–Votorantim;
  - SP-077 Santa Branca.
- **Comparação com o OSM/Valhalla:**
  - RMSP + anel: 92 de 131 km (**70%**) estão marcados como terra.
  - Estado todo: 543 de 782 km (69%).
  - O resto aparece como asfalto: em parte asfaltado de fato depois do cadastro (SP-008 Atibaia), em parte falta de tag.
- **Vicinais sem pavimento na borda da RMSP** (pista 5): pelo OSM, 6.354 km de `unclassified` e 1.488 km de `tertiary` explicitamente de terra no anel de 40 km, mais cerca de 4.900 km de `unclassified` sem tag.
  - O DER-SP não publica uma malha municipal com superfície. O serviço `Municipais_View` deu 500 e `Estadualização_de_Trechos_Vicinais` deu 500, ambos falharam.
- **IRI (rugosidade):**
  - `Hosted/IRI_Classe_DNIT_v2/FeatureServer/0`: 157.370 segmentos de 100 m, cerca de 16.242 km coletados.
  - Classes: Ótimo 13.144 km, Bom 2.771, Regular 283, mais 1.066 km não coletados.
  - Pela amostra, são **estradas municipais** ("Estrada Mun., 289 – Mogi Guaçu") medidas em programas de pavimentação de vicinais.
  - Servem como prova de que a vicinal *é* pavimentada (desmentem um `surface=unpaved` antigo no OSM).
  - Licença sem texto no serviço; o portal do DER usa CC-BY-4.0.
- **Obras DER-SP:** `Hosted/Empreendimentos` tem 6 multipontos só com nome. `SP_PRA_TODA_OBRAS_VIEW` deu 500 e `Obras_POS_view` não tem camada 0. Baixo valor.
- **Valor:** ALTO para SP (estaduais de terra perto da capital). **Esforço:** baixo (ArcGIS REST ou XLSX).

### 3.5 Outros DERs

- **DER-MG, via IDE-Sisema** (GeoServer da SEMAD):
  - `https://geoserver.meioambiente.mg.gov.br/IDE/ows?service=WFS&typeName=IDE:ide_0401_mg_rodovias_lin`, com saída CSV, SHAPE-ZIP e XLSX. HTTP 200, 3.444 trechos.
  - Campo `superficie`, nas estaduais:

    | Código | km |
    |---|---|
    | PAV | 21.416 |
    | **IMP** | **3.634** |
    | **LEN** | **1.200** |
    | EOP | 333 |
    | DUP | 511 |

  - Dados de 12/2021, compilados do SNV 2018. Licença: "O acesso ao dado é livre", sem licença formal.
  - **Uso comercial:** provável, mas confirmar. Valor médio, porque está defasado.
- **SINFRA-MT:** só um mapa ArcGIS (MapSeries `6150f1d5f9054c6cb554793e918e7bdb`), sem download aberto. Não testado a fundo.
- **DER-PR, DAER-RS, GOINFRA, DERBA:** sem dataset aberto com superfície encontrado nesta rodada. A BC250 do IBGE (3.6) cobre o Brasil.
- **Ministério dos Transportes/BIT** (`dados.transportes.gov.br`, dataset `geoprocessamento`): só tem `Base-GEO/BaseFerro.zip`. `BaseRodo.zip` e variantes deram **403**. FALHOU.

### 3.6 IBGE BC250 versão 2025 — `rod_trecho_rodoviario_l` (NOVA, nacional)

- **Acesso:** WFS `https://geoservicos.ibge.gov.br/geoserver/wfs`, `typeNames=CCAR:BC250_2025_rod_trecho_rodoviario_l`.
  - HTTP 200, GeoJSON e CSV. 124.687 trechos; atributos do Brasil todo em CSV com 14 MB em 7 s.
  - Também há download completo (SHP de 798 MB, GPKG de 864 MB) em `geoftp.ibge.gov.br/.../bc250/versao2025/`, datado de 2026-03-03.
- **Campos:** `revestimento`, `trafego`, `situacaofisica`, `jurisdicao`, `administracao`, `nrfaixas`, `tipopavimentacao`, `sigla`, `limitevelocidade`, `emperimetrourbano`.
- **Brasil:**

  | Campo | Valor | Trechos |
  |---|---|---|
  | revestimento | Revestimento primário (solto) | 53.884 |
  | revestimento | Pavimentado | 44.961 |
  | revestimento | **Sem revestimento (leito natural)** | **25.686** |
  | trafego | Permanente | 100.952 |
  | trafego | **Periódico** | **17.235** |
  | trafego | Desconhecido | 6.496 |

  - Entre os trechos de "Periódico", **11.711 são de leito natural**.
  - `trafego=Periódico` é a única fonte nacional que diz "**só passa em parte do ano**". É candidata direta a bloqueio sazonal para carreta.
- **Comparação com o OSM/Valhalla, RMSP + anel** (`ibge_bc250/bc250_2025_rmsp_bbox.geojson`, 1.170 trechos):

  | BC250 | Casado com o Valhalla | Não pavimentado no Valhalla |
  |---|---|---|
  | Pavimentado | 4.413 km | 6% |
  | Revestimento primário | 1.933 km | 60% |
  | Leito natural | 36 km | 76% |

  - Amostra de 40 ways onde a BC250 diz terra e o Valhalla diz asfalto: **metade sem tag no OSM** (asfalto por default, quase todas `unclassified`/`tertiary`) e metade com `surface` pavimentado explícito (provável BC250 defasada).
- **Licença:** o WFS declara `Fees=NONE` e `AccessConstraints=NONE`.
  - O termo de uso da BC250 (versão 2019, `BC250_termo_uso_2019.pdf`) diz que os dados são protegidos por direito autoral e que é **"vedada a locação ou comercialização" sem autorização escrita do IBGE**. Exige crédito.
  - **Uso comercial:** usar como *sinal interno* de risco, sem revender nem redistribuir o dado, é zona cinzenta. **Pedir autorização ao IBGE** antes de produção.
  - A versão 2025 não traz termo próprio.
- **Valor:** ALTO (nacional, municipais incluídas, tráfego periódico). **Esforço:** baixo. **Risco:** licença e escala 1:250k (geometria aproximada; casar por proximidade).

### 3.7 HeiGIT (HDX)

- **"Brazil: Road Surface Data"** (Mapillary + OSM), **ODbL**:
  - `https://downloads.ohsome.org/hdx/mapillary_road_surface/heigit_bra_roadsurface_lines.gpkg` (4,5 GB; GeoJSON de 10 GB).
  - HEAD e range testados com 200. Data dos dados: 2024-11.
  - Campos: `osm_id`, `pred_class`, `pred_label`, `combined_surface_osm_priority`, `n_of_predictions_used` etc.
  - Acrescenta só 1,1% de cobertura. **Uso comercial OK (ODbL, como o OSM).** Valor baixo.
- **"Brazil: Planet Road Surface, Width, and Passability"** (225 MB, só arteriais, inclui índice de passabilidade):
  - Licença **"Non-commercial use only… PlanetScope"**. **DESCARTADO** para o app comercial.

### 3.8 INMET (pista 6)

- **Avisos ativos:** `https://apiprevmet3.inmet.gov.br/avisos/ativos` → 200, JSON com `hoje` e `futuro`.
  - Cada aviso traz `poligono` (GeoJSON), `geocodes` IBGE dos municípios, `descricao` (Tempestade, Chuvas Intensas, Acumulado de Chuva…), `severidade` (Perigo Potencial, Perigo, Grande Perigo) e início/fim.
  - O RSS (`/avisos/rss`) também tem 200.
  - Licença do RSS: "o conteúdo… poderá ser reproduzido desde que citada a fonte". **Uso comercial OK com citação.**
  - O tema `interdicoes_temporarias_alagamentos` pode já ter isso. Reaproveitar.
  - `alertas2.inmet.gov.br` não respondeu.
- **Normais climatológicas 1991–2020:** `https://portal.inmet.gov.br/uploads/normais/Normal-Climatologica-PREC.xlsx` → 200.
  - 221 estações, precipitação mensal (mm).
  - Serve para definir a "época de chuva" por região: por exemplo, mês com normal acima de 150 mm na estação mais próxima.

### 3.9 DNIT — "Andamento de Obras" (CKAN do DNIT)

- `package_show?id=andamento-de-obras` → 200. Licença **`other-pd` (domínio público)**.
- Último arquivo: `01___janeiro_2025_a_outubro_2025_mensal.xlsx` (publicado em 2026-07-31, **atraso de cerca de 9 meses**).
  - Cerca de 80 contratos por mês, com UF, BR, objeto em texto livre (o km só aparece no texto, em 22 de 67), km de terraplenagem, pavimentação e restauração.
- **Valor:** baixo a médio. O SNV `Obra` e o CNT `Em_Obras` são mais úteis. **Esforço:** médio (parse de texto).

---

## 4. Fontes que falharam (e motivo)

| Fonte | Motivo |
|---|---|
| Taginfo Geofabrik `south-america:brazil` | HTTP 500. Nas regionais, `tag/combinations` também dá 500. |
| Overpass RS | 504 no overpass-api.de e 500 no espelho private.coffee (3 tentativas). |
| `pbi.cnt.org.br` (painéis 2021–2024 da CNT) | DNS não resolve (intranet). |
| CNT API `v1/mapa` | "Erro interno". Downloads exigem login. |
| BIT/MT `BaseRodo.zip` | 403. Só a base ferroviária está pública. |
| DER-SP `Municipais_View`, `Estadualização_de_Trechos_Vicinais_v1_MIL1`, `SP_PRA_TODA_OBRAS_VIEW` | 500 ("GISService not instantiated" / "featureserver not found"). |
| DNIT Terminologias Rodoviárias v11.1 (PDF) | 503 duas vezes. Legenda EOP/EOD/EOI não confirmada no documento oficial. |
| `alertas2.inmet.gov.br` | Sem resposta. |
| HeiGIT/Planet | Acessível, mas licença não comercial. |
| DNIT ICA 2025 (xlsx no mesmo pacote) | Acessível, mas é Índice Crítico de **acidentes**, não pavimento. Descartado. |

**Nota operacional:** o Postgres local (`truck-router-db`) entrou em *crash recovery* várias vezes durante a sessão. Houve quedas antes da minha primeira consulta (22:25 e 22:28).
Uma consulta minha de `ST_Union`/`ST_Buffer` também foi derrubada por uma queda às 22:34. Depois disso, a geometria da RMSP foi montada localmente a partir de `data/raw/rmsp/ibge_rmsp_municipios.geojson`.
Há um contêiner do importer rodando (`awesome_carson`) e um segundo Valhalla (`pedantic_villani`). Vale investigar à parte.

---

## 5. Como integrar ao app (camada de dados + roteamento)

Segue o padrão de `docs/LAYERS.md`: importador, módulo `*.layer.ts` e testes.

### 5.1 Mudanças no roteamento, sem dado novo (prioridade 1, para o Brasil)

1. **Política por preset em `config.ts`:** `unpaved: 'avoid' | 'penalize' | 'allow'`, mais um limiar de desvio aceitável. Por exemplo:
   - carreta e bitrem: `avoid`;
   - toco e truck: `penalize`, até +25% do tempo;
   - VUC: `allow`.
2. **Em `services/routing.ts`:**
   - Calcular a rota normal.
   - Se alguma manobra tiver `rough: true` e o preset não for `allow`, calcular de novo com `costing_options.truck.exclude_unpaved = true`.
   - Escolher a pavimentada se o acréscimo de tempo estiver dentro do limiar do preset. Senão, manter a de terra e emitir aviso.
   - **Erro 442 com `exclude_unpaved`:** manter a rota original e emitir o aviso "destino só acessível por estrada sem pavimento".
   - Isso funciona como uma penalidade "macia" sem mexer nos tiles. O Valhalla não tem `use_unpaved`.
3. **ETA:** somar às manobras `rough` o tempo extra com teto de velocidade.
   - Exemplo: 30 km/h para carreta em terra seca e 20 km/h em época de chuva. Calibrar depois com telemetria.
   - Isso torna o ETA realista sem chamada extra, porque a manobra já traz `length` e `time`.
4. **Aviso no resultado:** "N km sem pavimento (vias X, Y)", usando os nomes das manobras `rough`.

### 5.2 Camada `superficie` (dados oficiais; corrige o "asfalto por default")

**Importadores:**
- `importers/sources/snv_superficie.py`:
  - Reaproveitar `wfs_get` e `snv_uf()`/`snv_version()` de `siaet_restricoes.py`, que já buscam o `vw_snv_rod` completo por UF com cache.
  - Filtrar por superfície efetiva em {LEN, IMP} ou `Obra` não nula.
  - `kind` = `leito_natural`, `implantada`, `obra_pavimentacao`, `obra_duplicacao` ou `obra_implantacao`.
  - Props: BR, UF, código, km e `versao_snv`.
  - Alternativa: o `snv_dnit.py` (Nextcloud SHP) já lê `ds_sup_fed`, mas o WFS traz `Obra` e a estadual coincidente com nomes claros.
- `importers/sources/dnit_icm.py`:
  - CKAN do DNIT (`package_show`): pegar os dois CSVs mais recentes.
  - Linha por km, com referência linear na geometria do SNV (UF + BR + km).
  - Props: ICM, classe, panela, poça d'água, poeira, mês.
  - Guardar 12 meses de histórico do não pavimentado para o fator sazonal por trecho.
- `importers/sources/dersp_malha_superficie.py`:
  - FeatureServer `Malha_Rodoviária/6`, com `where tipopista='IMP'`; ou o XLSX CC-BY-4.0 mais a geometria do serviço.
- **Opcional, só depois de liberado pelo IBGE:** `ibge_bc250_revestimento.py`.
  - WFS por bbox ou UF; guardar só `revestimento` diferente de Pavimentado ou `trafego=Periódico`.
- **Já existe ou existirá em outro tema:** importador INMET de avisos (polígonos ativos). Usar só a leitura.

**`api/src/layers/superficie.layer.ts`:**
- **`costLines(ctx)`:** trechos LEN/IMP do SNV e do DER-SP, e BC250 se liberada, que o OSM *não* marca como terra.
  - A camada não sabe a superfície do grafo. Basta aplicar a todos: em asfalto real, o fator só encarece um pouco.
  - Fator por preset e época: por exemplo, carreta 3 na seca e 1000 ("proibido salvo sem alternativa") na chuva; truck 1,5 e 3.
  - **Cuidado (erro 233):** cada linha do `linear_cost_factors` precisa casar com o grafo. Reaproveitar a validação em lote de `perigosos.layer.ts`/`altura_osm.layer.ts` (bisseção).
  - Respeitar o sentido do desenho: aplicar nos dois sentidos, como em `restricoes_rmsp.layer.ts`.
- **Época de chuva:** mês corrente acima de X mm na normal INMET da estação mais próxima, **ou** aviso INMET ativo (Chuvas Intensas ou Acumulado, severidade Perigo ou mais) sobre o trecho.
  - Usar também o ICM não pavimentado do mês: Ruim ou Péssimo vira fator alto.
- **`exclusions()`:** não usar. Bloqueio duro em polígono afetaria as travessias.
- **`annotate(ctx, route)`:** cruzar a rota com as feições. Avisos:
  - "Trecho sem pavimento (SNV LEN, BR-xxx km a–b)";
  - "Trecho em obra (SNV EOP/EOD)";
  - "Pavimento péssimo (ICM ago/2026)";
  - "Estrada de tráfego periódico (IBGE)";
  - "Chuva forte prevista (INMET) em trecho de terra".
  - Somar os km e aplicar o ajuste de ETA.
- **`features(bbox)`:** linhas coloridas por classe para o mapa.
- **`meta.sources`:**
  - DNIT/SNV (WFS DNITGeo, sem licença explícita);
  - DNIT/ICM (CKAN, "Outra (Aberta)");
  - DER-SP (CC-BY-4.0);
  - INMET (reprodução com citação);
  - IBGE BC250 (só com autorização).

### 5.3 Correção no grafo (prioridade 2, maior impacto, precisa de experimento)

- O problema principal (`unclassified` sem tag virando asfalto) só se resolve **antes do build dos tiles**. Duas opções:
  - **(a)** Pré-processar o PBF (pyosmium, no entrypoint do Valhalla).
    - Em `highway=unclassified` sem `surface`, `tracktype` e `smoothness`, e **fora de área urbana**, gravar `surface=unpaved`.
    - Área urbana: IBGE "Áreas Urbanizadas" ou `landuse=residential`/`place` no OSM.
    - Aplicar o mesmo a `tertiary` sem tag só onde a BC250, o SNV ou o DER disserem que é terra.
  - **(b)** Lua de tag transform customizado (`mjolnir.graph_lua_name`), que não tem acesso à localização. Só a opção (a) serve.
- Validar repetindo `exp_exclude_unpaved.py` antes e depois, com os dados oficiais como "verdade", e medir os falsos positivos em ruas de bairro.
- Licença: o resultado continua derivado do OSM (ODbL). Os tiles são de uso interno, então não há obrigação de compartilhar, desde que não sejam distribuídos.

### 5.4 Prioridade sugerida

1. Item 5.1. É só código e já reduz o risco no Brasil.
2. SNV + DER-SP + ICM na camada `superficie` (licenças OK).
3. Pré-processamento do PBF (5.3) com experimento.
4. BC250 depois da resposta do IBGE.
5. CNT só com parceria.

---

## 6. Arquivos desta pasta

| Arquivo | Conteúdo |
|---|---|
| `snv_202607A_attrs.json.gz` | Atributos do SNV do Brasil (7.673 segmentos) |
| `snv_202607A_naopav_obra.geojson.gz` | 545 trechos LEN/IMP/obra com geometria |
| `snv_describe.xml` | Schema do WFS |
| `cmp_snv_valhalla.py`, `cmp_snv_valhalla_sudeste.json` | SNV × superfície do Valhalla. Usa `vh.py` (POST no Valhalla local). O script espera o geojson descompactado. |
| `osm_surface_stats.py`, `osm_surface_stats_sudeste.json` | Cobertura do OSM no Sudeste por zona e classe. `rmsp_ring.json` tem a RMSP e o anel de 40 km; `uf_3x.geojson` são as UFs do IBGE. |
| `osm_unpaved_anel40km_rmsp.geojson.gz` | Ways de terra explícita no anel de 40 km |
| `exp_exclude_unpaved.py`, `exp_exclude_unpaved_{anel40km,sul_mg,norte_mg}.json` | Experimento de rotas |
| `overpass/q.sh`, `overpass/*_counts.json` | Contagem por UF |
| `dnit_icm/` | `package_show.json`; não pavimentada de 2026 (01, 03, 05.gz, 08); amostra de 2.000 linhas da pavimentada de 08; dicionário |
| `dnit_obras/` | `package_show.json` e XLSX de jan a out/2025 |
| `cnt/` | `main.js` do SPA, `pbi.py` (cliente querydata), schemas dos modelos 512570 e 512569, `cnt2025_base_rodovias_notas.json.gz`, `cnt2025_em_obras.json.gz`, amostra de `vw_rodovias_trecho_2025`, `fotos_sp.json` |
| `dersp/` | `hosted.json` (lista de serviços), `dersp_malha_imp_plan.geojson`, `iri_sample.geojson`, `sre.xlsx` (CKAN, CC-BY-4.0), `ckan_sp_malha.json` |
| `ders/` | DER-MG (`mg_record.json`, `mg_rodovias_attrs.csv`), BIT (`bit_mapas.html`), CKAN do MT |
| `ibge_bc250/` | `bc250_2025_attrs.csv.gz` (Brasil), `bc250_2025_rmsp_bbox.geojson`, documentação técnica de 2025, termo de uso de 2019 |
| `heigit/` | Metadados do HDX (licenças) |
| `inmet/` | Avisos ativos (JSON e RSS de 2026-10-09) e normais de precipitação 1991–2020 |
| `valhalla_src/` | Fontes do Valhalla no commit `c803bdc2f` usadas na análise |
