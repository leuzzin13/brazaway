# mun_sudeste — lote IMP07 (11 municípios de SP)

Bastos, Bauru, Bebedouro, Bertioga, Botucatu, Bragança Paulista, Buritama, Buritizal, Cardoso, Conchal e Cordeirópolis, na
camada genérica `restricoes_rmsp` (`data/raw/municipios/<ibge>.json`; formato em
[`../../restricoes_municipais.md`](../../restricoes_municipais.md)). As regras vêm de `docs/research/cidades_sudeste/res/<ibge>.json`,
com as correções de `verif/<ibge>.json` (verificação de 11/10/2026), que prevalecem.

Resumo: **17 regras ativas** em 11 municípios (7 zonas, 10 vias) e **11 desativadas**. Os casos de rota foram conferidos na API
real (`localhost:3000`) e gravados em `api/test/fixtures/mun_sudeste/<ibge>.json`: 17 casos, todos "evita" (nenhum
"sem_alternativa"). Todos passam em `API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"`
(12/10/2026). Data usada nos casos: terça 13/10/2026 (10h dentro da janela; 20h fora, quando há janela).

## Como a geometria foi feita

- **Vias** (`construir: "trechos"`): nomes exatamente como no OSM (cache `data/cache/municipios/osm_named_<ibge>.json`). O import
  gerou `geo/<ibge>_vias.geojson` com `pendencias` vazias em todos os municípios. Onde o OSM parte a via nos cruzamentos ou ela é
  um só way, as pontas são `{"lonlat"}`.
- **Perímetro urbano sem polígono no ato** (Bastos, Buritama, Buritizal): união dos setores censitários urbanos do IBGE 2022
  (`CD_SIT` 1 e 2) do distrito-sede, sem furos, com as rodovias estaduais recortadas (folga de 40 m). Marcado aproximado,
  confiança média. Script em `data/raw/municipios/geo/<ibge>_perimetro_urbano_curadoria.py`.
- **Município inteiro** (Cardoso): malha municipal do IBGE (`data/cache/municipios/ibge_malha_3510708.geojson`) sem as rodovias
  estaduais/federais (folga de 40 m). Script em `geo/3510708_municipio_curadoria.py`.
- **Vicinais por código** (Bastos): ways do OSM com `ref` BAS-010, BAS-020, BAS-050 e BAS-168, cortadas no limite municipal
  (`construir: "manual"`, script `geo/3505807_vicinais_curadoria.py`).
- **Áreas centrais descritas por ruas** (Bauru, Bebedouro): quadrilátero pelos cruzamentos dos eixos do OSM. Na rota a zona é
  recuada 20 m: em Bebedouro isso deixa livres as vias-limite (como manda o ato); em Bauru, onde o ato inclui as vias do
  perímetro, elas entram numa regra de via vinculada.
- **Desativada sem área definida**: `{"geojson": FeatureCollection vazia}` — fica no arquivo, não vai ao banco nem ao `regras`
  da fixture.
- **Import**: `municipios:<ibge>`, um município por vez. A malha do IBGE foi pré-baixada no host para o cache.

---

## 3505807 Bastos (`bastos`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `bastos_dec1758_7eixos` | ativa (média) | Dec. 1.758/2024, art. 1º, caput e §1º; art. 9º | 24 h | 7 eixos ou mais (`eixos > 6`) | `geo/3505807_perimetro_urbano.geojson`: setores urbanos IBGE 2022 sem SP-457 e SP-294 (aproximado) | evita, bitrem, BAS-010 (norte) → BA-040 (sudoeste): 21,6 km, 0 km na zona; carreta de 6 eixos atravessa (2,1 km na zona) |
| `bastos_dec1758_7eixos_vicinais` | ativa (média) | Dec. 1.758/2024, art. 1º, caput e §1º | 24 h | 7 eixos ou mais | `geo/3505807_vicinais.geojson`: 34 ways com ref BAS-010/020/050/168 | evita, bitrem, BA-040 → PRP-138: 13,5 km, 0 km nas vicinais; carreta de 6 eixos usa 4,3 km delas |
| `bastos_dec1758_cana_esterco` | desativada (média) | Dec. 1.758/2024, art. 1º, §2º; art. 3º | 24 h | por tipo de carga | vazia | — |

A pesquisa tinha uma regra ativa; ela foi separada em zona (perímetro urbano) e via (vicinais) porque a camada aceita um só tipo
de geometria por regra.

Pendências:
- O perímetro urbano não está delimitado no decreto (zona aproximada).
- A "BAS 152" do ato não existe no OSM (há uma BAS-252 a oeste, não incluída); a ligação asfaltada para Tupã não tem código e
  ficou fora.
- A ressalva de carga/descarga com nota fiscal não é modelada como exceção de destino (a rota avisa).

## 3506003 Bauru (`bauru`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `bauru_zona_a_central` | ativa (média) | Dec. 11.096/2009, art. 3º, I, c; art. 2º, §1º; art. 8º | todos os dias 7h–19h; feriados aplica | comprimento > 13,20 m ou PBT > 15 t | `geo/3506003_zona_a.geojson`: quadrilátero R. Antônio Alves / R. Primeiro de Agosto / R. Azarias Leite / R. Cussy Júnior | evita, carreta, oeste → leste pela Av. Rodrigues Alves: 10h 0 km dentro; 20h corta (0,6 km) |
| `bauru_zona_a_perimetro` | ativa (média) | Dec. 11.096/2009, art. 2º, §1º; art. 3º, I, c | 7h–19h | idem | `geo/3506003_vias.geojson`: as 4 vias-limite entre os cruzamentos (6 feições) | evita, carreta, leste da zona → R. Primeiro de Agosto: 10h 0 km; 20h 0,2 km na R. Azarias Leite |
| `bauru_carga_descarga_zonas_a_b` | desativada (média) | Dec. 11.096/2009, art. 3º, I, a, e II, a; art. 5º | seg–sáb 12h–20h | capacidade 1,35–6 t | vazia | — |

Pendências:
- O horário 7h–19h pode ser lido como só da tração animal (confiança média). Não foi possível confirmar no sistema oficial que o
  decreto não foi alterado.
- Carga e descarga nas Zonas A e B é regra de operação no destino; a Zona B não foi desenhada.

## 3506102 Bebedouro (`bebedouro`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `bebedouro_quadrilatero_central` | ativa (alta) | Dec. 11.503/2015, art. 1º, I e II, par. único; art. 3º; Lei 4.887/2014 | seg–sex 9h–18h, sáb 9h–14h; feriados suspende | comprimento > 6,30 m ou largura > 2,20 m | `geo/3506102_quadrilatero_central.geojson`: R. Campos Salles / R. Vanor Junqueira Franco / R. Dr. Brandão Veras / R. N. Sra. de Fátima (vias-limite livres) | evita, toco, noroeste → sudeste: 10h 0 km dentro; 20h corta (0,7 km) |
| `bebedouro_zona_azul_6_12m` | desativada (baixa) | Lei 4.887/2014, art. 3º; Dec. 11.502/2015 | — | 6,30–12 m | vazia | — |
| `bebedouro_cana_vinhaca_perimetro_urbano` | desativada (alta) | Lei 2.675/1997, art. 1º (red. Lei 3.720/2007) | 24 h | por tipo de carga | vazia | — |

VUC local registrado (2,20 × 6,30 m, Lei 4.887/2014, art. 5º, I).

Pendências:
- Zona Azul (Anexo I do Dec. 11.502/2015) não conferida; redação permissiva sem dias da semana.
- Cana/vinhaça: critério de carga e perímetro (sede, Botafogo, Turvínea, Andes) sem delimitação.

## 3506359 Bertioga (`bertioga`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `bertioga_pbt10_av19maio_manoel_gajo` | ativa (média) | Dec. 2.071/2013, arts. 1º a 3º e 6º | 24 h | PBT > 10 t | `geo/3506359_vias.geojson`: Av. Dezenove de Maio e R. Manoel Gajo, da Rod. Dr. Manoel Hipólito do Rego à Av. Tomé de Souza (16 feições, pontas por coordenada) | evita, truck (23 t), R. Manoel Gajo (norte da rodovia) → Av. Tomé de Souza: 9,2 km, 0 km nas vias; o VUC usa 1,5 km |

Pendências:
- O art. 3º cita "horários do art. 2º", que não traz horário (inconsistência do texto); tratado como 24 h.
- O SAPL da Câmara pode não ter todos os decretos do Executivo (vigência com confiança média).

## 3507506 Botucatu (`botucatu`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `botucatu_alcides_soares_bitrem` | ativa (alta) | Dec. 10.866/2017, art. 2º (red. Dec. 10.881/2017) | 24 h | CVC (bitrem, treminhão; rodotrem por segurança) | `geo/3507506_vias.geojson`: Rodovia Alcides Soares do km 2 ao km 14 (pontas estimadas, aproximado) | evita, bitrem, Botucatu → Vitoriana: 44,7 km pelas rodovias, 0 km no trecho; carreta usa 9,9 km |
| `botucatu_alcides_soares_treminhao` | desativada (alta) | Dec. 10.866/2017, art. 1º | 24 h | treminhão | registro (rodovia inteira) | — |
| `botucatu_dom_lucio_2eixos` | ativa (média) | Res. DET 02/10 | 24 h | mais de 2 eixos | Av. Dom Lucio entre a R. Manoel Fernandes Cardoso e a R. Carlino de Oliveira | evita, truck: 0,02 km (só cruzamento); o toco passa 0,17 km |
| `botucatu_cesar_neto_2eixos` | ativa (média) | Res. DET 001/10 | 24 h | mais de 2 eixos | R. Firmino Pontes Ribeiro inteira (~0,6 km, aproximado) | evita, truck, SP-300 → César Neto: entra pelo acesso oeste (0,03 km na rua); o toco usa 0,53 km |
| `botucatu_centro_carga_descarga` | desativada (média) | Dec. 6.090/2000, art. 1º (red. Dec. 7.929/2009) | 9h–19h | > 1,5 t | vazia | — |
| `botucatu_amando_de_barros` | desativada (média) | Dec. 8.966/2012, art. 4º, par. único; art. 3º, b | 9h–19h | caminhão | registro (R. Amando de Barros, R. Prudente de Moraes → R. Coronel Fonseca) | — |
| `botucatu_cana_area_urbana` | desativada (média) | Lei 5.006/2008, arts. 1º e 2º | 24 h | por tipo de carga | vazia | — |

Pendências:
- O perfil não distingue treminhão de bitrem: o treminhão em toda a BTC-010 fica só como registro.
- Km 2 e km 14 estimados (sem marcos quilométricos no OSM).
- Extensão do trecho "sob a ponte da Fepasa" não dada no ato (rua inteira).
- "Vias centrais" de carga e descarga não delimitadas; Amando de Barros com texto ambíguo; cana depende de regulamentação não
  localizada.

## 3507605 Bragança Paulista (`braganca-paulista`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `braganca_paulista_estrada_antonio_moreno` | ativa (média) | Dec. 2.484/2017, art. 1º, §3º, I (red. Dec. 4.041/2022; orig. Dec. 3.873/2022) | 24 h | todo caminhão | `geo/3507605_vias.geojson`: Estrada Municipal Antônio Moreno inteira | evita, toco, ponta oeste → leste: 10,8 km, 0 km na estrada; utilitário usa 3,5 km |
| `braganca_paulista_rua_itapechinga` | ativa (média) | Dec. 2.484/2017, art. 1º, §3º, II (red. Dec. 4.041/2022) | 24 h | todo caminhão | Rua Itapechinga inteira | evita, toco: 0 km na rua (sobe pela Av. Alberto Diniz); utilitário usa 0,5 km |
| `braganca_paulista_av_alpheu_grimello` | ativa (média) | Dec. 2.484/2017, art. 1º, §3º, III (Dec. 4.572/2024) | 24 h | todo caminhão | Avenida Alpheu Grimello inteira | evita, toco, Praça Nove de Julho → ponta sul: 0,01 km (cruzamentos); utilitário usa 1,1 km |
| `braganca_paulista_rocha_leal` | desativada (baixa) | Dec. 4.866/2025 (art. 1º, IV, do Dec. 2.484/2017) | seg–sex 7h–22h (compilação de terceiros) | veículo pesado (indefinido) | registro (Av. José Gomes da Rocha Leal, R. Felipe Siqueira → Av. Dr. Plínio Salgado) | — |
| `braganca_paulista_art1_vias_centrais` | desativada (baixa) | Dec. 2.484/2017, art. 1º, I–III (só compilação de terceiros) | seg–sex 7h–22h | veículo pesado | vazia | — |

Pendências:
- Texto original do Dec. 2.484/2017 (caput do art. 1º, horário, definição de "veículo pesado") não localizado: as vias do
  art. 1º, I–IV ficam desativadas até ele aparecer.
- As exceções do §4º (empresas com acesso só pela via, serviços essenciais) e o cadastro de placas (§5º) não são modelados.

## 3508108 Buritama (`buritama`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `buritama_zona_urbana_longos_pesados` | ativa (média) | Lei 4.704/2021, arts. 1º, 2º e 4º; Dec. 4.537/2021 | 24 h | 5 eixos ou mais (`eixos > 4`) | `geo/3508108_perimetro_urbano.geojson`: setores urbanos IBGE 2022 sem o acesso SPA-052/461 (aproximado) | evita, carreta, nordeste → sudoeste: 31,3 km, 0 km na zona; o truck atravessa (2,8 km) |

Pendências:
- "Vias públicas da cidade" sem delimitação (zona aproximada). Carga/descarga e moradores dependem de autorização (não modelado).

## 3508207 Buritizal (`buritizal`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `buritizal_lei1932_acima_2_eixos` | ativa (média) | Lei 1.932/2026, art. 11, caput e §§1º–5º; art. 12 | 24 h | mais de 2 eixos | `geo/3508207_perimetro_urbano.geojson`: setores urbanos IBGE 2022 (aproximado; BTZ-030 no contorno) | evita, truck, oeste → BTZ-030 sul: 11,5 km, 0 km na zona; o toco atravessa (1,0 km) |

Pendências:
- "Vias públicas da cidade" sem delimitação (zona aproximada). Carga/descarga e moradores com autorização não modelados.

## 3510708 Cardoso (`cardoso`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `cardoso_altura_4_71` | ativa (média) | Dec. 3.491/2020, arts. 1º a 4º | 24 h | articulados com altura > 4,71 m | `geo/3510708_municipio.geojson`: malha municipal do IBGE sem SP-461/BR-154 e SP-322/SP-154 | evita, carreta 4,80 m, oeste (PNL-329) → leste (SP-322): 104 km, 0 km na zona; carreta de 4,40 m usa 10,6 km |

Pendências:
- A "Resolução nº 735/2018" citada no decreto não foi conferida (não muda o limite). As rodovias ficaram livres por convenção
  (não são de jurisdição municipal).

## 3512209 Conchal (`conchal`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `conchal_rua_araras_cvc` | ativa (alta) | Lei 2.397/2023, art. 1º e par. único, art. 4º; Lei 2.463/2025 | 24 h | Romeu e Julieta (`truck_trailer`), bitrem/rodotrem (`cvc`) ou mais de 5 eixos | `geo/3512209_vias.geojson`: Rua Araras inteira (2 ways) | evita, bitrem, estrada a oeste → Centro: 0 km na rua; o truck usa 0,19 km |

Pendências:
- Proibição de parada e estacionamento não modelada.

## 3512407 Cordeirópolis (`cordeiropolis`)

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `cordeiropolis_vias_acima_6t` | ativa (média) | Dec. 6.642/2023, art. 4º, I a VI (e arts. 3º, 5º, 10) | 24 h | capacidade > 6 t (`payload_t`) | `geo/3512407_vias.geojson`: Av. do Barro Preto, COR 010 Carmelo Fior (aprox.), R. Flamínio Levy, Av. Presidente Vargas, R. Francisco Minatel, R. Guilherme Krauter, R. José Moreira (28 feições) | evita, truck, Estrada do Barro Preto (norte) → leste da cidade: 4,7 km, 0 km nas vias; utilitário usa 1,3 km |
| `cordeiropolis_municipio_pbt24_triarticulado` | desativada (baixa) | Dec. 6.642/2023, art. 9º | 24 h | PBT > 24 t ou tri-articulado | vazia | — |

Pendências:
- "Acima de 6 toneladas" sem dizer PBT ou capacidade (adotada capacidade, como no art. 2º).
- Art. 9º refutado pelo verificador (contradiz os arts. 3º, 5º, 11 e 13); `status_motivo` acrescentado nesta retomada e
  município reimportado.
- Data de publicação (início dos efeitos) não conferida.

## Observações gerais

- Nenhum bug encontrado no importador ou na API durante a retomada.
