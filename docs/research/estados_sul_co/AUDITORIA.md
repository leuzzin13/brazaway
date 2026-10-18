# Auditoria de expansão do BrasaWay: Sul (PR, SC, RS) e Centro-Oeste (GO, MT, MS, DF)

Data: 2026-10-18. Somente leitura no repositório (exceto esta pasta). Não chamei o Valhalla nem a API local; não houve commit.
Base: `api/src/layers/*.ts`, `importers/sources/*.py`, `docs/layers/*.md`, `docs/LAYERS.md`, mais os arquivos de infra citados.
Contagens "no seed" vêm de varredura de texto dos `db/seed/layers/*.sql` (campo `"uf"` quando existe, ou o sufixo `/UF` no
rótulo da via, no caso da PRF). Não rodei SQL. Onde não achei evidência, escrevo "não verifiquei".

Legenda de ação: **nada** (já nacional), **ampliar_bbox** (mesma fonte, só muda a área/UF/PBF), **nova_fonte_estadual**
(precisa fonte por UF ou por município), **nao_se_aplica**.

## 1. Resumo executivo

1. **O gargalo único é o PBF do OSM.** Tiles do Valhalla, `altura_osm`, `lacunas_osm`, `radares`, `descanso` (OSM),
   `pedagio` (nós OSM) e o casamento de posição dos `postos_diesel` leem o mesmo `data/valhalla/*.osm.pbf`, hoje
   `sudeste-latest.osm.pbf` (945 MB). Sem PBF novo, nada do Sul/CO roteia nem gera esses seeds. Os scripts aceitam **um** PBF
   só (ver seção 4), então o caminho mais simples é um PBF único (Brasil inteiro, como o README já prevê, ou a fusão
   Sudeste + Sul + Centro-Oeste com `osmium merge`, que existe em `/usr/bin/osmium` nesta máquina).
2. **As fontes federais já são nacionais e os seeds já têm dados do Sul/CO**: PRF/acidentes, ANTT (pedágio, balanças, SAU,
   pontes), PPD do Ministério dos Transportes, SIAET, DNIT (pontes e alertas), PRF/DOU (janelas de feriado). Nada a fazer
   nelas, só ter tiles para a rota passar por ali.
3. **Três lugares do código têm UF/região fixa e precisam de uma linha de mudança** (todos "ampliar_bbox"):
   `cnefe_municipios.py:27` (`GEO_UFS` = 35,33,31,32), `snv_dnit.py:33` (`UFS_DEFAULT` = ES,MG,RJ,SP) e
   `postos_anp.py:52` (`POSTOS_UFS` = SP,RJ,MG,ES). Os três aceitam variável de ambiente, então nem exigem editar o código.
4. **Um bug silencioso de UX no Sul/CO se não ampliar `GEO_UFS`**: sem polígonos de município fora do Sudeste, `municipiosAt()`
   devolve `null` para origem e destino e `routeTouchesSaoPaulo()` (`api/src/services/routing.ts:437`) responde "sim, o
   comportamento antigo". Resultado: em feriado, rota Curitiba -> Porto Alegre recebe o aviso "ZMRC, rodízio e restrição de
   perigosos em SP não se aplicam". O geocoder também cai em SP (seção 3).
5. **Feriados**: `UF_BY_PREFIX` (`feriados_sudeste.py:54`) só tem 31/32/33/35, então qualquer regra municipal de PR/SC/RS/GO/
   MT/MS/DF **falha na validação** (`check_rule`, linha 154). Estaduais não passam por essa checagem, mas não existe nenhuma
   regra delas em `data/raw/feriados/regras.json` (hoje: SP/MG/RJ/ES apenas). `calendar.ts` já conhece todos os 27 prefixos IBGE.
6. **Precisam de fonte estadual/municipal (trabalho de pesquisa/curadoria, não de código)**: DER/estradas estaduais
   (`rodovias_estaduais`, `oae`, `balancas`, `placas_restricao`), pedágio estadual, acidentes e roubo de carga fora das BRs,
   restrições a produtos perigosos, feriados estaduais/municipais e restrições municipais (`restricoes_rmsp`/`municipios`).
7. **Camadas que não se aplicam**: `ver`, `carga_descarga`, `corredores_onibus` (todas da capital paulista), ZMRC/rodízio
   (`restriction_zones`) e `etaHorario` (Grande SP). Equivalentes de outras capitais entram como regras municipais.

## 2. Tabela por camada

Cobertura atual: "nacional" = sem filtro de UF no importador; "PBF" = acompanha o PBF do Valhalla (hoje Sudeste).

| Camada | Importadores | Cobertura atual | Ação |
|---|---|---|---|
| acidentes | acidentes_prf, acidentes_infosiga, acidentes_artesp, acidentes_reds_mg | PRF nacional (BRs); Infosiga/ARTESP só SP; REDS só MG | nova_fonte_estadual |
| altura_osm | osm_altura_nos | PBF (Sudeste) | ampliar_bbox |
| balancas | weigh_antt_ppv, weigh_artesp, weigh_dersp, weigh_dermg | ANTT nacional; ARTESP/DER-SP só SP; DER-MG só MG | nova_fonte_estadual |
| carga_descarga | geosampa_zona_azul, geosampa_vaga_caminhao | capital de SP | nao_se_aplica |
| core_legal | feriados_sudeste, cet_suspensoes (+ seed `0004_holidays.sql`) | nacionais; estaduais SP/RJ/ES/MG; 98 regras municipais do Sudeste; CET só SP capital | nova_fonte_estadual |
| corredores_onibus | geosampa_faixa_onibus, geosampa_corredor_onibus | capital de SP | nao_se_aplica |
| descanso | descanso_ppd, descanso_antt, descanso_artesp, descanso_osm (+ tabela `rest_stops`) | PPD e ANTT nacionais; ARTESP SP; OSM = PBF; `rest_stops` Grande SP | ampliar_bbox |
| federal_restricoes | siaet_restricoes | nacional (27 UFs) | nada |
| geocoding | cnefe_municipios, cnefe_enderecos, cep_ipea, geosampa_logradouro | CEP nacional; polígonos de município só Sudeste (1.668); endereços CNEFE só RMSP + Baixada | ampliar_bbox |
| lacunas_osm | osm_lacunas, mapillary_placas (opcional) | PBF (Sudeste); Mapillary só Grande SP | ampliar_bbox |
| oae | oae_der_sp, oae_der_mg, oae_der_es, artesp_passarelas, oae_geosampa, siurb_oae, oae_restricoes_curadas | SP, MG, ES (estaduais); capital de SP; curadoria | nova_fonte_estadual |
| pedagio | toll_antt, toll_osm, toll_artesp, toll_agetransp, toll_artemig, toll_municipais | ANTT nacional; OSM = PBF; estaduais SP/RJ/MG | nova_fonte_estadual |
| perigosos | hazmat_trechos_der, hazmat_trechos_sudeste, hazmat_minianel_vias, hazmat_aprm, hazmat_municipio_sp, hazmat_paradas_artesp, cetesb_emergencias | regra ANTT nacional (código); trechos/zonas só SP, RJ, ES | nova_fonte_estadual |
| placas_restricao | der_sinalizacao, mapillary_placas | DER-SP | nova_fonte_estadual (opcional) |
| pontes_federais | dnit_pontes, dnit_alertas, antt_pontes | nacional | nada |
| postos_diesel | postos_anp | `POSTOS_UFS` = SP, RJ, MG, ES | ampliar_bbox |
| radares | radares_osm | PBF (Sudeste) | ampliar_bbox |
| relevo | (sem importador; `anadem_to_hgt.py` + `build-elevation.sh`) | ANADEM, zonas MGRS do Sudeste | ampliar_bbox |
| restricoes_rmsp (municipais) | municipios (+ `data/raw/municipios/<ibge>.json`) | 184 arquivos: SP 118, MG 46, RJ 14, ES 6 | nova_fonte_estadual (por município) |
| rodovias_estaduais | rodovias_estaduais_der_mg, _der_es, _der_rj (+ `_ders.py`, `_sre_mg.py`) | MG, ES, RJ | nova_fonte_estadual |
| rodovias_horario | snv_dnit, prf_feriados, der_portarias | PRF/DOU nacional; SNV só ES,MG,RJ,SP; DER-SP só Anchieta | ampliar_bbox |
| roubo_carga | roubo_carga_ssp | SSP-SP | nova_fonte_estadual |
| ver | ver_portaria137 | capital de SP | nao_se_aplica |

## 3. Detalhe por camada

### acidentes
- PRF (`acidentes_prf.py`): `BR_BBOX = (-74.5,-34.5,-28.5,5.5)` (linha 25), sem filtro de UF. Seed `acidentes__prf.sql` tem 3.912
  pontos críticos no país; por sufixo da via: PR 463, SC 493, RS 176, GO 123, MT 166, MS 45, DF 29 (contagem aproximada).
  **BRs do Sul/CO já estão cobertas**.
- Infosiga e ARTESP: SP (`SP_BBOX` em `acidentes_infosiga.py:302`, usado como filtro de `in_bbox`). REDS: `MG_BBOX`
  (`acidentes_reds_mg.py:74`). Estradas estaduais e vias urbanas de PR/SC/RS/GO/MT/MS/DF não têm fonte. A divisão por jurisdição
  da doc (`acidentes.md`, "Divisão por jurisdição") se repetiria: BR = PRF; o resto = fonte estadual, com `covered_cells()` da PRF
  para evitar dupla contagem (`acidentes_prf.py:107`).
- Textos fixos a atualizar quando houver fonte nova: `acidentes.layer.ts:143` ("SP, MG e rodovias federais") e `:216`.
- Fonte estadual: não pesquisei neste passo; não afirmo que exista dado aberto equivalente em cada UF.

### altura_osm e lacunas_osm
- `osm_altura_nos.py` e `osm_lacunas.py` leem `pbf_path()` (`osm_altura_nos.py:39`): `$OSM_PBF` ou o **primeiro** (ordem alfabética)
  `data/valhalla/*.osm.pbf`. Sem filtro geográfico. `SOURCE_URL` cita "sudeste" (texto, linhas 22 e 27).
- Basta apontar para o PBF novo e rodar de novo. O seed cresce (Sudeste: `lacunas_osm__osm.sql` 6,5 MB, `altura_osm__osm.sql` 195 KB).
- `mapillary_placas.py:30` `BBOX_RMSP`: opcional (exige `MAPILLARY_TOKEN`), só Grande SP; `MAPILLARY_BBOX` muda a área. Não é bloqueante.

### balancas
- ANTT (`weigh_antt_ppv.py`): nacional. Seed: PR 6, SC 3, RS 6, GO 4, MT 1, MS 3, DF 0 (45 no total).
- ARTESP/DER-SP/DER-MG: por UF. Sul/CO sem fonte estadual. A doc (`balancas.md`) diz que postos do DNIT fora das concessões não têm lista aberta com coordenadas.
- Fonte estadual: a pesquisar. O motor de sentido (`directionVerdict`) é genérico; só falta dado.

### carga_descarga, corredores_onibus, ver
Geoportal da capital de SP (GeoSampa / CET / Portaria SMT 137/2018). Sem equivalente a replicar; restrições de outras capitais
entram como regra municipal (`data/raw/municipios/<ibge>.json`, sem importador novo; ver `restricoes_municipais.md`).

### core_legal (calendário)
- Importador: `feriados_sudeste.py` + `data/raw/feriados/regras.json` (anos 2026-2028; 106 regras: SP 44 mun., MG 22 mun. + 1 est.,
  RJ 16 mun. + 6 est., ES 16 mun. + 1 est.). Seed próprio `core_legal__feriados-sudeste.sql`.
- **Código**: `UF_BY_PREFIX` na linha 54 deve ganhar `'41':'PR','42':'SC','43':'RS','50':'MS','51':'MT','52':'GO','53':'DF'`; sem isso
  `check_rule` (linha 154) rejeita todo feriado municipal fora do Sudeste e **a carga inteira falha** (comportamento desejado, mas
  bloqueia o lote). Estadual não leva IBGE (linha 156), então passa.
- **Dados**: feriado estadual de cada UF e municipal das capitais/polos precisa de ato oficial citado (o validador exige `base_legal`,
  `fonte`, `confianca`, `status`). O DF só tem escopo estadual (53). Pesquisa de atos: `docs/research/cidades_sul_co/` já existe
  (municipios.csv, atos, fila); não a li por inteiro.
- `calendar.ts:27-30` já mapeia todos os 27 prefixos; `municipiosAt()` (`calendar.ts:98`) depende do polígono de município da camada
  `geocoding` (ver abaixo).
- `core_legal.layer.ts:8,23,27-28`: descrição e fontes dizem "Sudeste" (só texto).
- `cet_suspensoes.py`: capital de SP; nao_se_aplica.
- `rodovias_horario.layer.ts:91-93` (`HOLIDAYS_SQL`) só considera feriado estadual de SP e 6 municípios paulistas, mas serve **apenas** à regra
  da Anchieta (§5º da portaria do DER-SP); não afeta o Sul/CO.

### descanso
- `descanso_ppd.py`: nacional (seed: RS 58, SC 21, PR 9, MT 5, MS 4, GO 3, DF 3; 198 no total). `descanso_antt.py`: nacional (PR 55, GO 44,
  MS 34, RS 26, SC 24, MT 19, DF 1; 362 no total). `descanso_artesp.py`: só SP. `descanso_osm.py`: via `_osm_pois.extract` e o PBF.
- `scripts/fetch-rest-stops.py:9` (`bbox` Grande SP, Overpass) alimenta a tabela `rest_stops`/`0003_rest_stops.sql`; é complemento (a API
  deduplica contra o OSM do PBF). Não precisa ampliar.
- Ação: rodar `descanso_osm` com o PBF novo.

### federal_restricoes e pontes_federais
Nacionais. `siaet_restricoes.py:46` lista as 27 UFs. Seed SIAET: PR 339, SC 300, RS 335, GO 245, MT 264, MS 230, DF 44 (4.891 no total).
DNIT pontes: PR 319, SC 480, RS 799, GO 373, MT 260, MS 217, DF 86. Alertas DNIT: RS 17, PR 2, SC 2. As camadas `.ts` não têm UF fixa.
Atenção: a aplicação de restrição de peso numa "ponte OSM" (SIAET) e o edge walk dependem do OSM/tiles novos.

### geocoding (não é `.layer.ts`; importadores com `LAYER_ID = 'geocoding'`)
- `cep_ipea.py`: nacional (928.905 CEPs). Nada.
- `cnefe_municipios.py:27`: `os.environ.get('GEO_UFS', '35,33,31,32')`. O código já tem `UF_SIGLA` das 27 UFs (linhas 19-21).
  **Ampliar com `GEO_UFS=35,33,31,32,41,42,43,50,51,52,53`** (ou editar o default). O seed `geocoding__ibge-malhas.sql` (3,1 MB) é regenerado.
  Consumidores: `calendar.ts#municipiosAt`, `restricoes_rmsp.layer.ts:358-370` (`municipiosOD`), `geocoder/municipios.ts`
  (`ufBbox`, `ufAt`, `pointsInMunicipio`), `postos_anp.py:291`.
- `cnefe_enderecos.py:30,39`: `UF_DIR` e `UF_SIGLA` só têm 35,33,31,32,41 (PR já está). Faltam 42,43,50,51,52,53 (pastas `42_SC`, `43_RS`,
  `50_MS`, `51_MT`, `52_GO`, `53_DF` seguindo o padrão `41_PR`; **não conferi os nomes de pasta no FTP do IBGE**). Só precisa se quiser
  endereço com número em polos (hoje só RMSP + Baixada, 48 municípios); a cascata funciona sem isso (CEP + município + Photon).
  `fetch()` levanta `ValueError('UF ... sem pasta configurada')` (linha 302) se aparecer código IBGE de UF ausente.
- API (`api/src/services/geocoder.ts`): `SP_BBOX` fallback (linha 27, usado na 65); UF default `'SP'` (linha 53); `municipios.ts:77`
  prefere SP quando o nome é ambíguo ("região-piloto"). Sem polígonos do Sul/CO, `ufAt()` não acha UF, a UF cai em SP e o Photon é chamado
  com o bbox de SP: endereço digitado em Curitiba/Goiânia sem UF explícita fica enviesado para SP. Com `GEO_UFS` ampliado isso se resolve;
  ressalva: `ufAt` escolhe a UF de **menor bbox** que contém o ponto, e o retângulo do DF (menor) fica dentro do de GO, então pontos de GO
  dentro do retângulo do DF viram "DF" (mesma classe de problema que já existe entre ES e MG). Vale um teste.
- `geocoder/cnefe.ts:19,253,317` usa `COD_SP = 3550308` só para os segmentos do GeoSampa (capital). Não afeta outras UFs.
- Front: `web/src/components/PlaceInput.tsx:46` (`near ?? {lat:-23.55, lon:-46.63}`) e `MapView.tsx:6` (`SP_CENTER`). Quem não dá
  geolocalização recebe viés de SP no autocompletar; trocar por centro do Brasil ou pela última rota.
- Teste existente `api/test/geocoding.test.ts:256-285` usa Mallet-PR como "fora"; continua válido, porque rejeita por município/UF de referência.

### oae
- `oae_der_sp`, `oae_der_mg`, `oae_der_es`, `artesp_passarelas` (`SP_BBOX` linha 56), `oae_geosampa`, `siurb_oae` (`SP_BBOX` linha 24): por UF/cidade.
- `oae.layer.ts` não tem UF fixa no código, só o nome das fontes (`COUNT_SOURCES`, linha 28). Cada DER novo entra como `source` novo.
- Pontes federais já cobertas por `pontes_federais` (DNIT/ANTT).
- Fonte estadual: a pesquisar. Para bloquear por altura/peso precisa de dado numérico publicado; senão fica só contagem/aviso, como DER-SP/DER-MG.

### pedagio
- `toll_antt.py`: nacional (seed: PR 47, GO 26, RS 12, SC 11, MT 11, MS 9; 231 no total). Sem ação.
- `toll_osm.py`: lê o PBF; **sem PBF** cai em Overpass com `BBOX = -25.4,-53.2,-14.2,-39.6` (linha 26, formato S,W,N,E). O corte sul de
  -25,4 deixa Santa Catarina e o Rio Grande do Sul fora e corta o Paraná; se for por Overpass, defina `OSM_TOLL_BBOX`.
  Com PBF novo, nada a mudar.
- `toll_artesp`, `toll_agetransp` (RJ), `toll_artemig` (MG), `toll_municipais` (RJ/MG, `_toll_estaduais.py` + `data/raw/pedagio/concessoes_estaduais.json`):
  curadoria por concessão. Praças estaduais de PR/SC/RS/GO/MT/MS/DF: fonte a pesquisar; o framework `_toll_estaduais.py` aceita
  nova concessão por JSON (campo `importador`), mas cada importador novo exige um `toll_<x>.py` pequeno.
- `pedagio.layer.ts` descreve SP/RJ/MG no `description` (linha 417) e nas `sources`; texto apenas.

### perigosos
- A regra nacional (Res. ANTT 5.998/2022, tabela ONU, quantidade limitada) está em `hazmat.ts` e vale em qualquer UF.
- Trechos/zonas locais: `hazmat_trechos_der.py` (DER-SP), `hazmat_trechos_sudeste.py` (RJ, ES; regras em `data/raw/hazmat/trechos_sudeste_pp.json`;
  o código **não tem UF fixa**, `uf` é só um campo da regra), `hazmat_minianel_vias.py`/`hazmat_municipio_sp.py`/`hazmat_aprm.py` (SP),
  `hazmat_paradas_artesp.py` (SP), `cetesb_emergencias.py` (SP, WFS DataGEO).
- Novas regras do Sul/CO entram no mesmo JSON e no mesmo importador (o nome "sudeste" é histórico e está em `SOURCE = 'sudeste'`,
  linha 37, e no arquivo; renomear órfã o seed `perigosos__sudeste.sql`). Esse importador usa o Valhalla (`valhalla_tileset`, `/locate`), então
  **só roda depois dos tiles novos**. Conteúdo (portarias de DER/PRF/prefeituras): pesquisa por UF; não afirmo que existam.
- Emergências químicas (CETESB): não há equivalente confirmado; órgão ambiental estadual, a pesquisar.

### placas_restricao
`der_sinalizacao.py`: inventário de sinalização do DER-SP. Não sei se outros DERs publicam; marcar como opcional/baixa prioridade.

### postos_diesel
`postos_anp.py:52` `POSTOS_UFS` default `SP,RJ,MG,ES` (filtro nas linhas 153, 166, 253). O restante (cadastro, LPC e PMQC da ANP) é nacional.
Rodar com `POSTOS_UFS=SP,RJ,MG,ES,PR,SC,RS,GO,MT,MS,DF`. Dependências: polígonos de município (`GEO_UFS`, linha 291),
`addr_municipio` do CNEFE (linha 351, só melhora o casamento) e o PBF novo (`_osm_pois`). `postos_diesel__anp.sql` tem 5,2 MB para 4 UFs;
com 11 UFs deve passar de 10 MB (estimativa, não medi). `postos_diesel.layer.ts:10` cita "SP, RJ, MG e ES" só em comentário.

### radares
`radares_osm.py` lê o PBF (`pbf_path` na linha 38, mesma regra de `osm_altura_nos`). Basta o PBF novo. Seed Sudeste: 5.176 radares (3,2 MB).
`SOURCE_URL` (linha 24) cita o extrato do Sudeste.

### relevo
Não há importador. O Valhalla principal já roda com elevação (ANADEM v1 -> HGT 1").
- `valhalla/elevation/anadem_to_hgt.py:34` `DEFAULT_ZONES = '21J,21K,22H,22J,22K,22L,23J,23K,23L,24K,24L'` (zonas MGRS do Sudeste); a variável
  `ANADEM_ZONES` (linha 156) sobrescreve. A lista das 52 zonas do ANADEM está em `docs/layers/relevo.md:331`.
- Pelo que calculei da grade MGRS (não conferi com `gdalinfo`): o RS exige ao menos a faixa H (21H, 22H já existe) e o Centro-Oeste exige
  20K/20L/20M, 21L, 21M, 22M, 23M (conforme latitude de MT/GO/DF). **Confirme as extensões com o próprio script (`source_extents`) antes de
  baixar.** Estimativa do doc: Brasil inteiro = 811 tiles HGT, ~21 GB em disco, ~46 GB de download.
- `scripts/build-elevation.sh:18,30` `ELEV_BBOX` default `-53.2,-25.4,-39.6,-14.2`; só é usado quando **não há grafo principal**. Com grafo
  principal, o `step_dem` usa `--from-graph` do grafo atual (Sudeste), ou seja, **gera HGT só do Sudeste** mesmo com PBF novo. Ver seção 4.
- `relevo.layer.ts` não tem região fixa. Sem HGT numa área a camada "não anota" (silêncio, sem erro), então o problema seria invisível.

### restricoes_rmsp (restrições municipais)
Id histórico; camada genérica por código IBGE. Não há importador por cidade: é um arquivo `data/raw/municipios/<ibge>.json` por município
(184 hoje: SP 118, MG 46, RJ 14, ES 6). O schema (`schema.json`, pattern `^[1-5][0-9]{6}$`, `uf` enum com as 27 UFs) e `_municipios_schema.py:20-22`
(`UF_IBGE`) já aceitam PR/SC/RS/GO/MT/MS/DF. `restricoes_rmsp.layer.ts:140` (`ufDe` cai em `'SP'` só se a regra não tiver `uf` nem `ibge`).
Dependências: malha IBGE de cada município (baixada pelo próprio importador, `_municipios_lib.municipio_geom`), Valhalla com tiles novos
(`valhalla_check`) e `geocoding` ampliado (`municipiosOD`, linhas 358-370). A pesquisa de municípios está em `docs/research/cidades_sul_co/`
(já existe, outro agente). Testes: `mun_sudeste.test.ts` + fixtures `api/test/fixtures/mun_sudeste/`.

### rodovias_estaduais
DER-MG (pontos críticos vivos, ArcGIS do Observatório), DER-ES (atos no DIO-ES), DER-RJ (notícia). Curadoria em `data/raw/ders_estaduais/regras.json`.
`_ders.py` tem funções específicas de MG (`rodovia_mg`, `rodovia_de_sre_mg`) e ES (`sre_es`); a camada `.ts` aceita qualquer `source`. Cada DER novo =
um importador pequeno + regras. Fonte: a pesquisar por UF.

### rodovias_horario
- `prf_feriados.py`: nacional (BRASIL envelope, `UF_NOMES` com as 27 UFs; trata MS e as UFs excluídas pela portaria). Seed: 40 janelas.
- `snv_dnit.py:33` `UFS_DEFAULT = 'ES,MG,RJ,SP'`; `SNV_UFS=ALL` ou a lista nova. **Sem isso a restrição de feriado da PRF não tem trecho
  nenhum no Sul/CO** (a regra existe, mas o casamento por SNV não acha pista simples). O seed `rodovias_horario__snv-dnit.sql` hoje: 2,1 MB, 814 feições
  (ES 89, MG 441, RJ 196, SP 88); ampliando para 11 UFs deve crescer várias vezes (não medi). `docs/layers/rodovias_horario.md` fala em ~69 MB de download do SNV.
- A doc (`rodovias_horario.md`, regra 1c) diz que o trecho especial de MS (BR-262/MS km 233-328, 09/04) está "importado, mas fora dos tiles do Sudeste": passa a valer com o SNV de MS.
- `der_portarias.py`: só Anchieta (SP-150); nao_se_aplica fora de SP.

### roubo_carga
`roubo_carga_ssp.py`: SSP-SP (`SP_BBOX` nas linhas 34 e 276). Fonte do Sul/CO: a pesquisar (secretarias de segurança); não afirmo existência.
`roubo_carga.layer.ts:154` descreve "SSP-SP".

## 4. Fora das camadas que assumem o Sudeste

| Onde | O que assume | Ação |
|---|---|---|
| `docker-compose.yml:10` | `tile_urls` default `.../sudeste-latest.osm.pbf` (`OSM_PBF_URL`) | trocar o PBF (um só arquivo) |
| `scripts/build-tiles.sh:7,11` | `OSM_PBF_URL` default Sudeste; `PBF_NAME` vem do `basename` | idem; o apply.sh e o build usam um PBF só |
| `scripts/build-tiles.sh:31-35` | **reaproveita por hardlink os HGT do Valhalla principal**; só gera do ANADEM se não houver nenhum | com Sul/CO, forçar a geração (apagar `data/valhalla_build/elevation_data` e o do principal, ou ajustar a condição) |
| `scripts/build-elevation.sh:30,36,58-66` | `ELEV_BBOX` Sudeste; `PBF_URL` Sudeste; `--from-graph` do principal quando existe | definir `ELEV_BBOX`/`ANADEM_ZONES` ou usar o grafo novo |
| `docker-compose.elevation.yml` | segundo Valhalla (porta 8003) para testar o conjunto novo | usar para validar antes da troca |
| `scripts/osm-overrides/apply.sh` | aceita um PBF; regras com `bbox` em `data/osm-overrides/overrides.json` (extração `osmium extract -b`) | nada se o PBF for único |
| `importers/sources/osm_altura_nos.py:39` (`pbf_path`), `radares_osm.py:38`, `toll_osm.py:29` | primeiro `*.osm.pbf` em ordem alfabética em `data/valhalla` | **cuidado**: se `sudeste-latest.osm.pbf` e o novo coexistirem, pode pegar o errado; use `OSM_PBF=` ou deixe um só |
| `importers/sources/ver_portaria137.py:64` | caminho fixo `data/valhalla/sudeste-latest.osm.pbf` (default) | só se o arquivo mudar de nome; a camada `ver` é SP |
| `importers/sources/_osm_pois.py` | usa `pbf_path` | idem |
| `api/src/services/calendar.ts:84-92` (`municipiosAt`) | polígono de município da camada `geocoding`/`ibge-malhas` ou `restricoes_rmsp` | ampliar `GEO_UFS` |
| `api/src/services/routing.ts:432-440` (`routeTouchesSaoPaulo`) | sem município => assume SP; avisos de feriado falam de SP | resolvido pelo item acima; considerar também mensagem neutra |
| `api/src/services/geocoder.ts:27,53,65` | `SP_BBOX`, UF default SP | resolvido em parte por `GEO_UFS`; revisar fallback |
| `api/src/services/geocoder/municipios.ts:77` | desempate prefere SP | revisar (vira problema com cidades homônimas: há "Santa Cruz", "São José" etc. em várias UFs) |
| `api/src/services/etaHorario.ts` + `config/eta-horario.json` (`area_bbox`) | curva de lentidão da CET para a Grande SP | nao_se_aplica (fora da bbox não ajusta) |
| `db/seed/0002_zones.sql`, `config/zmrc-rules.json`, `restriction_zones` | ZMRC, rodízio e PP da capital de SP | nao_se_aplica |
| `web/src/components/MapView.tsx:6`, `PlaceInput.tsx:46` | centro e viés em SP | trocar fallback |
| `api/src/schemas.ts:21,23` e `VehicleForm.tsx:97` | AETC e VUC são regras de SP | informativo; não bloqueia |
| `db/migrations/*` | sem CHECK por UF ou bbox (conferi 0002-0006, 0116, 0202) | nada |
| `README.md:27-33,84`, `deploy/README.md:8,37,43` | documentam Sudeste, RAM mínima 8 GB e disco | atualizar (Brasil: 16 GB de RAM, ~15 GB de disco, segundo o README) |
| `api/test/*` | testes "Sudeste" (`feriados_sudeste`, `mun_sudeste`, `perigosos_sudeste`, `importers/tests/test_feriados_sudeste.py`, `test_hazmat_trechos_sudeste.py`) | não quebram; faltam testes de PR/SC/RS/GO/MT/MS/DF (rota, feriado, geocoder, municipal) |

Notas sobre testes: os asserts de contagem usam `toBeGreaterThan` (ex.: `radares.test.ts:41,46`), então seeds maiores não quebram. Não rodei a suíte.

### Sobre o PBF (o que verifiquei e o que não)
- `data/osm/` já contém `central-west-latest.osm.pbf` (228 MB) e `south-latest.osm.pbf` (481 MB), criados hoje às 04:13 por outro processo; não toquei.
  Os nomes locais ("south", "central-west") **não batem** com o padrão `sudeste-latest` do repositório; eu esperaria `sul-latest` e `centro-oeste-latest` na
  Geofabrik, mas **não consegui confirmar** (o proxy derrubou as conexões com `download.geofabrik.de`). Confirmar a URL antes de documentar.
- `data/valhalla/` tem só o Sudeste (945 MB) mais os tiles. `osmium` está instalado (`/usr/bin/osmium`), então `osmium merge` dos três arquivos é viável localmente.
- Disco: 14 GB livres em `/` quando medi. Um merge (~1,7 GB) cabe; o build de tiles do conjunto grande, não verifiquei.
- Valhalla com 3 regiões: o container usa `tile_urls` (pode aceitar mais de uma URL; não confirmei na imagem), mas todos os scripts do repositório
  (`build-tiles.sh`, `apply.sh`, `build-elevation.sh`, `pbf_path`) assumem **um** PBF. Por isso a recomendação é um PBF único.

## 5. Ordem sugerida de execução

1. PBF único (Sudeste + Sul + Centro-Oeste, ou Brasil), `OSM_PBF_URL`, HGT do ANADEM para as novas zonas, `build-tiles.sh --swap`
   (usar antes o `docker-compose.elevation.yml` para validar). Sem isso as demais etapas que dependem do Valhalla não rodam.
2. `GEO_UFS` ampliado + `cnefe_municipios` (gera `geocoding__ibge-malhas.sql`).
3. Importadores que só dependem de PBF/UF: `osm_altura_nos`, `osm_lacunas`, `radares_osm`, `descanso_osm`, `toll_osm`, depois `postos_anp`
   (`POSTOS_UFS`) e `snv_dnit` (`SNV_UFS`). Depois `prf_feriados`, `siaet_restricoes`, `dnit_*` apenas para atualizar.
4. Correção de código mínima: `UF_BY_PREFIX` (feriados) e fallbacks de SP no geocoder/front.
5. Curadoria/pesquisa por UF (feriados estaduais, DERs, pedágio estadual, balanças, OAE, perigosos, acidentes/roubo estaduais, municípios).
6. Testes de rota para cada UF (uma capital e uma rodovia federal por UF) e de feriado/geocoder.

## 6. O que não verifiquei

- Não conferi existência, licença ou formato de nenhuma fonte estadual (nenhuma busca web neste passo): todas as linhas "nova_fonte_estadual"
  são lacunas de cobertura, não recomendação de fonte.
- URLs da Geofabrik para Sul/Centro-Oeste e pastas do CNEFE por UF (seção 3/4).
- Zonas MGRS do ANADEM para o Sul/CO (cálculo meu).
- Contagens por UF nos seeds são varreduras de texto (campo `uf` ou sufixo da via), sem SQL.
- Não rodei testes, importadores, Valhalla nem API.
