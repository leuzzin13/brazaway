# IMPSC04 — Calmon, Paulo Lopes, Macieira, Maracajá, Botuverá, Campos Novos, Cocal do Sul e Laguna (SC)

Lote do Sul/Centro-Oeste implementado em 18/10/2026 na camada genérica `restricoes_rmsp` (um arquivo por município em
`data/raw/municipios/<ibge>.json`, ver [`../../restricoes_municipais.md`](../../restricoes_municipais.md)). A pesquisa
(`docs/research/cidades_sul_co/res/<ibge>.json`) e a verificação de 18/10/2026 (`verif/<ibge>.json`) são a fonte; onde
divergem, vale a verificação. Geometria: nomes das vias casados no OSM (cache do PBF local, ODbL) e polígono da área
central de Macieira desenhado sobre os eixos do OSM. Fixtures de rota: `api/test/fixtures/mun_sul_co/<ibge>.json`
(teste `api/test/layers/mun_sul_co.test.ts`, todos passando). Nenhum município do lote define VUC (`vuc: null`).

| ibge | Município | fonte_id | Ativas | Desativadas | Rotas (evita / sem alternativa) |
|---|---|---|---|---|---|
| 4203154 | Calmon | `calmon` | 1 | 0 | 0 / 1 |
| 4212304 | Paulo Lopes | `paulo-lopes` | 1 | 0 | 1 / 1 |
| 4210050 | Macieira | `macieira` | 1 | 0 | 2 / 0 |
| 4210407 | Maracajá | `maracaja` | 1 | 4 | 0 / 1 |
| 4202701 | Botuverá | `botuvera` | 1 | 0 | 1 / 0 |
| 4203600 | Campos Novos | `campos-novos` | 1 | 0 | 1 / 1 |
| 4204251 | Cocal do Sul | `cocal-do-sul` | 1 | 0 | 0 / 0 (ver pendência) |
| 4209409 | Laguna | `laguna` | 1 | 1 | 1 / 1 |

Em todos, `feriados: aplica` (o ato não excetua) salvo Macieira (`suspende`: o §2º do art. 3º libera domingos e feriados).

## Calmon (4203154)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `calmon_dec_101_2026_23t` | ativa (alta) | Decreto 101/2026, art. 1º, I-XV e §§1º-4º; arts. 5º-6º (autorização); art. 12 (vigência em 08/09/2026) | 24 h, todos os dias | PBT/PBTC acima de 23 t | 15 ruas inteiras pelo nome no OSM (19 feições; Av. Manoel Fortunato e Rua Guilherme Whöeringer ficam de fora, §4º) | sem alternativa: carreta, ter 10h, 1,0 km nas ruas |

Pendências: a malha restrita cobre quase toda a cidade, então não existe par origem-destino com desvio real (nenhum caso
"evita"); sinalização (art. 4º) não verificada.

## Paulo Lopes (4212304)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `paulolopes_dec_03_2014_caminhoes` | ativa (média) | Decreto 03/2014, art. 1º e parágrafo único; art. 3º, I, a-e; art. 5º e 7º (exceções) | 24 h | capacidade de carga acima de 10 t (`payload_t`; o ato não diz PBT ou capacidade, art. 9º) | 3 das 5 vias (José Joaquim da Silveira, Sebastião Francisco Cabral, Amadeu Antônio Moisés) | evita: carreta, ter 10h (8,2 km contra 5,1 km do vuc); sem alternativa: 0,23 km na Rua Amadeu Antônio Moisés |

Pendências: Rua Maria Teodora Marcos (Morro do Freitas) e Rua Geral Tigela (Tigela) não existem com esse nome no OSM
(há "Estrada Geral da Tijela", não adotada sem prova); ficam sem geometria. Sinalização não verificada.

## Macieira (4210050)

| Regra | Status | Ato e artigo | Janela (proibida) | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `macieira_dec_1508_2015_area_central` | ativa (média) | Decreto 1.508/2015, art. 2º (perímetro), art. 3º e §§1º-3º (horários), art. 4º, art. 6º | seg-sex 00-08h e 18-24h; sábado 00-14h (correção do verificador); domingo e feriado livres | todo caminhão | polígono aproximado (~0,18 km²) do perímetro das Ruas Dona Maria Mendes, José Augusto Royer, Rodolfo Nickel e Antonio Wosniak, `4210050_area_central.geojson` | evita: carreta, ter 20h (dentro 0 km; 15,4 km; fora da janela, às 10h, atravessa 0,24 km) e sáb 10h (fora da janela, 15h, atravessa) |

O ato não traz coordenadas e não diz se as ruas-limite entram: o polígono usa as pontas das ruas no OSM, com o lado oeste
fechado em linha reta (aproximado). A Rua José Augusto Royer e o trecho sul da Rua Dona Maria Mendes são a travessia da
rodovia Rui Luiz Salamoni e ficam na borda (fora com o recuo de 20 m). Rota de passagem pela rodovia (SO a NE, 14,1 km)
não é afetada. A tolerância de 30 min para descarga em curso não é modelada. Divergência do OSM registrada sem virar
regra: Rua Sérgio João Bertotto `maxweight=16` sem ato.

## Maracajá (4210407)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `maracaja_dec_238_2021_sao_cristovao` | ativa (média) | Decreto 238/2021, art. 1º-2º | 24 h | PBT acima de 24 t (tráfego e estacionamento) | 4 ruas do bairro São Cristóvão (Rua "Pedro Samuel" + "Bernardino" do ato = Rua Pedro Samuel Bernardino no OSM, aproximado) | sem alternativa: carreta, ter 10h, 0,23 km |
| `maracaja_lei_1537_2026_noite` | desativada (baixa) | Lei 1.537/2026, art. 3º §1º, Anexo, art. 16 | fora de 06-18h | PBT acima de 10 t | rodovias Alcino de Freitas, Angelino Acordi, José Elizandro dos Santos (registro) | nenhum |
| `maracaja_lei_1537_2026_eixos` | desativada (baixa) | Lei 1.537/2026, art. 3º | 24 h | mais de 6 eixos | idem | nenhum |
| `maracaja_dec_106_2019_rodovias_10t` | desativada (baixa) | Decreto 106/2019, art. 1º (Lei 1.451/2024 revogada pelo art. 21 da Lei 1.537) | 24 h | PBT acima de 10 t | 3 rodovias (registro) | nenhum |
| `maracaja_dec_148_2021_manoel_pedroso` | desativada (média) | Decreto 148/2021, art. 1º | 24 h | PBT acima de 24 t | vazia (rua incerta: considerandos citam a Rua Francisco Constantino de Oliveira; art. 1º, a Rua Manoel Pedroso) | nenhum |

Só o Decreto 238/2021 está ativo, como pedido. As ruas são locais sem travessia: não há par com desvio possível, só o
caso de sem alternativa. O OSM tem `maxweight=10` na Rodovia Municipal Alcino de Freitas (regime revogado), mantido como
divergência.

## Botuverá (4202701)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `botuvera_dec3213_2023_rua_joao_assini` | ativa (média) | Decreto 3.213/2023, art. 1º e parágrafo único (acesso pela SC-486), art. 2º (exceções), art. 4º | 24 h, por tempo indeterminado | PBT acima de 30 t | Rua João Assini inteira (6,3 km, 3 ways; o decreto não delimita trecho; aproximado) | evita: carreta, ter 10h (0,04 km, só cruzamentos; 14,4 km contra 11,5 km) |

Pendência: origem emergencial (cheias de nov/2023); pode ter sido levantado de fato sem publicação.

## Campos Novos (4203600)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `campos_novos_dec7560_2016_vias` | ativa (média) | Decreto 7.560/2016, art. 2º, I-IX, §§1º, 2º e 4º; art. 3º; art. 6º (revoga o Decreto 6.238/2011) | 24 h (as janelas 06:00-09:30 e 18:00-21:00 do §4º são só de estacionar para carga e descarga, não liberam o trânsito) | capacidade de carga de 6,0 t ou mais (`payload_t` acima de 6; só difere em exatamente 6 t) | 17 trechos por nome e transversais (40 feições) | evita: carreta, ter 10h (0 km; 9,3 km contra 5,7 km); sem alternativa: 0,37 km |

Pendências: a Rua Dom Daniel Hostin (inciso IV) não existe no OSM e ficou fora; a Rua Duque de Caxias (inciso III) e a
Rua Leônidas Rupp (inciso VIII) entraram inteiras, de um só way (aproximado); "Rua Expedicionário" e "Rua Marechal
Floriano" são as grafias curtas do OSM. O art. 3º (estacionamento acima de 6 t) não é modelado.

## Cocal do Sul (4204251)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `cocaldosul_dec322_2019_vias_centrais` | ativa (alta) | Decreto SAF 322/2019, art. 1º, a-c; art. 2º (exceções); art. 3º | 24 h | PBT acima de 25 t ou comprimento acima de 14 m | Av. Dr. Polidoro Santiago (da Rua Anita Garibaldi à Rua Guy Marcos), Rua Guy Marcos Nunes de Souza (até a Rua Dr. Edson Gaidzinski), Rua Dr. Edson Gaidzinski e Rua Voluntários da Pátria (7 feições) | nenhum (ver abaixo) |

Pendência: sem caso de rota. O OSM já tem `hgv=no` e `maxweight=25` na Polidoro Santiago, na Edson Gaidzinski e na
Voluntários da Pátria (o roteador as evita sozinho), e o trecho de 130 m da Rua Guy Marcos (via de mão única sem restrição
no OSM) não aparece em nenhuma rota testada (nem de veículo leve): um caso "evita" não provaria a camada. As rodovias
SC-108 (estaduais) ficam fora do decreto.

## Laguna (4209409)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas |
|---|---|---|---|---|---|---|
| `laguna_lei2073_2019_ribeirao_pequeno` | ativa (média) | Lei 2.073/2019, art. 1º e parágrafo único (exceções), arts. 2º, 6º e 7º | 24 h | PBT acima de 20 t, carregado ou não | Rodovia Municipal João Batista Wendhausen Moraes inteira no OSM (8,2 km; o ato fala do trecho Bananal-Madre; aproximado) | evita: carreta, ter 10h (0 km; o vuc usa 8,2 km); sem alternativa: 5,6 km |
| `laguna_lei2303_2022_zona_azul_cd` | desativada (média) | Lei 2.303/2022 (Zona Azul), carga e descarga e art. 19 | sem janela no ato lido | capacidade acima de 5 t | vazia (regula estacionamento, não circulação; sem área definida) | nenhum |

A exceção por tipo de carga (cargas vivas, ração e produtos agrícolas) não é representável: a regra vale de forma
conservadora para todo caminhão acima de 20 t. O OSM tem `hgv=no` em 5 `secondary_link` sem nome, sem ato (divergência).

## Observações do lote

- `osm_pbf_cache_regioes.py` grava a malha do IBGE baixada como gzip (a resposta vem comprimida) e quebra em
  `read_text` com `UnicodeDecodeError`; foi preciso baixar a malha com `curl --compressed` antes. Descrever como bug do
  script de curadoria (não alterado).
- Rotas, pendências de nomes e limites do roteador estão nas notas de cada regra e nas fixtures.
