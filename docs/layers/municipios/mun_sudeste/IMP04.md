# Lote IMP04: restrições municipais a caminhão (MG)

Frente `mun_sudeste`, camada genérica `restricoes_rmsp`. O formato e o passo a passo estão em
[`../../restricoes_municipais.md`](../../restricoes_municipais.md). As regras vêm da pesquisa cidade por cidade
(`docs/research/cidades_sudeste/res/<ibge>.json`), com as correções do verificador (`verif/<ibge>.json`). O lote só
acrescentou arquivos: nenhum código do importador, da API ou dos testes foi alterado.

| ibge | Município | `fonte_id` | Ativas | Não aplicadas | Casos de rota | Arquivos |
|---|---|---|---|---|---|---|
| 3150802 | Piranga | `piranga` | 2 zonas | – | 2 evita | `3150802.json`, `geo/3150802_area_urbana.geojson` |
| 3151107 | Pirapetinga | `pirapetinga` | 1 zona | – | 1 evita | `3151107.json`, `geo/3151107_perimetro_urbano.geojson` |
| 3152105 | Ponte Nova | `ponte-nova` | 1 via | – | 1 evita | `3152105.json`, `geo/3152105_vias.geojson` |
| 3151800 | Poços de Caldas | `pocos-de-caldas` | 1 via | 2 desativadas | 1 evita | `3151800.json`, `geo/3151800_vias.geojson`, `geo/3151800_hipercentro.geojson` |
| 3154101 | Recreio | `recreio` | 1 via | – | 1 evita | `3154101.json`, `geo/3154101_vias.geojson` |
| 3157807 | Santa Luzia | `santa-luzia` | 1 via | 1 revogada | 1 evita | `3157807.json`, `geo/3157807_vias.geojson` |
| 3167103 | Serro | `serro` | 1 via | 2 desativadas | 1 evita | `3167103.json`, `geo/3167103_vias.geojson`, `geo/3167103_ser152.geojson` |
| 3167202 | Sete Lagoas | `sete-lagoas` | 1 zona + 2 vias | 1 desativada | 4 evita | `3167202.json`, `geo/3167202_area_central.geojson`, `geo/3167202_vias.geojson`, `geo/3167202_orla.geojson` |
| 3163706 | São Lourenço | `sao-lourenco` | 1 via | 1 desativada | 1 evita | `3163706.json`, `geo/3163706_vias.geojson` |
| 3168606 | Teófilo Otoni | `teofilo-otoni` | 1 zona | – | 2 evita | `3168606.json`, `geo/3168606_regiao_central.geojson` |
| 3170404 | Unaí | `unai` | 1 via | – | 2 evita | `3170404.json`, `geo/3170404_vias.geojson` |

Os arquivos ficam em `data/raw/municipios/`. Os seeds são `db/seed/layers/restricoes_rmsp__<fonte_id>.sql` e os casos de
rota estão em `api/test/fixtures/mun_sudeste/<ibge>.json`. Teste:
`cd api && API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"`. Os 11 municípios
passam (28 testes, rodados em 11/10/2026).

Nos casos de rota, `evita` quer dizer que, dentro da janela, a rota passa menos de 50 m na via ou na zona e o item aparece
em `avoided`. Quando a regra tem janela, o caso também traz um horário fora dela, em que a rota usa a via ou a zona. Nas
regras de 24 h, a nota do caso compara com um veículo que a regra não atinge. Todas as datas são da terça 13/10/2026.

## Como a geometria foi feita (sem Overpass)

- **Vias por nome** (`construir: trechos`). A fonte é o cache `data/cache/municipios/osm_named_<ibge>.json`, gerado do PBF
  local. Os nomes foram conferidos no cache e as pontas são transversais ou `lonlat`. O limite municipal do IBGE foi
  baixado para `data/cache/municipios/ibge_malha_<ibge>.geojson`, pelo mesmo URL que o importador usa.
- **Mancha urbana aproximada** (Piranga e Pirapetinga, cujo ato fala em "área/perímetro urbano" sem delimitar). Parte da
  união das faixas de 60 m em torno das vias urbanas com nome do OSM (Rua, Avenida, Praça, Travessa, Beco, Ladeira...) a
  até 2,5 km do centro da sede. Fica só a mancha contínua da sede, sem buracos, suavizada (buffer de −30/+30 m) e
  simplificada a 5 m. É derivada do OSM (ODbL) e marcada como `aproximado`.
- **Faixa de 150 m** (Teófilo Otoni, art. 4º da Lei 7.942/2026). É a união das faixas de 150 m em torno dos eixos das
  vias da lei, sem buracos internos. A Av. Dr. Luiz Boali Porto Salman, que tem 6,7 km, entra só dentro da envoltória
  convexa das outras vias + 150 m.
- **Poligonal pelos eixos** (Área Central de Sete Lagoas). O contorno anda pelo caminho mais curto em cada via, entre os
  cruzamentos do OSM. Há 5 emendas retas, de 10 a 87 m, onde os ways não se tocam.
- **Orla** (Sete Lagoas). São os trechos das vias com nome a até 45 m dos espelhos d'água do OSM (relações 10977328 e
  17936010, lidos do PBF). Entram só as vias que contornam a água.
- Em todos os casos, a licença declarada em `fonte.licenca` é a do ato (domínio público) mais a do OSM (ODbL).

## 3150802 Piranga

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `piranga_urbana_5eixos_11_17` | ativa (média) | Dec. 3.002/2020, art. 2º, p. único, I | todos os dias 11h–17h, feriados inclusive | eixos > 4 | zona: mancha urbana aproximada da sede (1,79 km²) | carreta pela BR-482, oeste→leste. Às 12h: 0 km na zona, mas 101,6 km de volta. Às 9h: 2,28 km na zona (6,9 km) |
| `piranga_urbana_3eixos_22_05` | ativa (média) | idem, II | todos os dias 22h–5h (00–05 e 22–24) | eixos > 2 | mesma zona | truck: às 23h, 0 km (101,6 km); às 20h, 2,28 km |

Pendências e ressalvas:

- A travessia urbana da BR-482 (Rua Nova, Rua Hélio Guimarães, Rua do Mercado) fica dentro da zona. Como o decreto vale
  "até que se alcance o almejado desvio" e o desvio não existe, a rota de passagem dá uma volta de cerca de 100 km. Quem
  vai decidir se a regra fica ativa deve saber disso.
- Não há perímetro urbano legal; o polígono é aproximado.

## 3151107 Pirapetinga

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `pirapetinga_perimetro_urbano_carretas_combinacoes` | ativa (média) | Dec. 130/2019, art. 1º, I–V; art. 2º (exceções, VIII = destino local); art. 5º | 24 h | tipo semitrailer, truck_trailer, cvc | zona: mancha urbana aproximada da sede (1,49 km²; distritos fora) | carreta da BR-393 (oeste) a Santo Antônio de Pádua (RJ): 0 km no perímetro, volta de 164,8 km. O truck, que a regra não atinge, passa 1,59 km (38,3 km) |

Pendências e ressalvas:

- A lei do perímetro urbano não foi localizada.
- A travessia urbana da BR-393 fica dentro da zona, e a carreta de passagem dá uma volta muito grande. A via alternativa
  discutida na audiência pública de 2023 ainda não existe.
- A exceção de placa local (art. 2º, IX) não é modelável.

## 3152105 Ponte Nova

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `ponte_nova_nucleo_historico_7t` | ativa (média) | Dec. 13.003/2023, art. 2º (vias), art. 4º e p. único; arts. 3º, 5º e 6º | 24 h | PBT > 7 t, comprimento > 8 m ou altura > 3,5 m | 11 das 13 vias do art. 2º, por nome (14 linhas) | toco, sul→norte do núcleo: 0,04 km nas vias (4,5 km). Um veículo de 6,5 t passa 0,68 km |

Pendências e ressalvas:

- Praça Getúlio Vargas e Travessa Albano Bráulio não têm nome no OSM. Ficaram sem geometria e estão registradas em
  `pendencias` no GeoJSON.
- A "Travessa Mário Bonffati" está no OSM como "Travessa Mário Bonfante". Foi casada pela posição e marcada `aproximado`.
- A "Praça Dom Parreira Lara" está no OSM como "Praça Parreira Lara".
- Um sentido da Rua Vigário Miguel Chaves foi descartado no teste do Valhalla.
- A vigência começa em 08/05/2023, data da publicação (art. 7º), conforme a correção do verificador.

## 3151800 Poços de Caldas

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `pocos_de_caldas_arc_7t` | ativa (alta) | Dec. 8.984/2007 (red. Dec. 9.186/2008), art. 1º, II, §§1º, 2º e 5º, arts. 2º–5º; Dec. 10.501/2012, art. 1º; Lei 6.620/1998 | 24 h | PBT > 7 t | 20 dos 21 incisos do §2º, por nome (63 linhas) | toco, norte→sul do Centro: 0,03 km (5,5 km). Com PBT de 6,5 t: 0,79 km |
| `pocos_de_caldas_arc_hipercentro_7t` | desativada | art. 1º, §2º, caput (Anexo I) | 24 h | PBT > 7 t | envoltória convexa das vias I–XIX (registro) | – |
| `pocos_de_caldas_carga_descarga_13h_16h` | desativada | Lei 5.664/1994, art. 1º, 1–4 e p. único | 13h–16h | caminhão | 6 trechos por nome | – |

Pendências e ressalvas:

- **Inciso XIX** (Rua XV de Novembro, entre a Rio Grande do Sul e a Corrêa Netto) não foi aplicado. No OSM, a Rua Quinze
  de Novembro só existe a leste da Correia Neto; entre a RGS e a Correia Neto, o eixo se chama Rua Espírito Santo. A
  pendência está no GeoJSON.
- A "Praça das Rosas" (pontas dos incisos I e IX) não existe no OSM. Usei a Praça Brasil, onde a Correia Neto encontra a
  Pernambuco.
- O "Praça Paul Harris" é um parque, não uma via. Por isso o inciso VII usa a Praça Getúlio Vargas inteira e o VIII começa
  na Av. Francisco Salles.
- O inciso II começa na Rua Espírito Santo, porque a XV de Novembro não cruza a Santa Catarina no OSM.
- O inciso XVIII usa a praça inteira, de 117 m.
- O Anexo I (mapa do hipercentro) ainda precisa ser obtido com o DEMUTRAN.
- A exigência de lona e autorização para basculantes é uma restrição a mais, não modelada; está registrada em `nota`.

## 3154101 Recreio

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `recreio_estrada_recreio_angaturama_12t` | ativa (média) | Dec. 016/2013, art. 1º, I; art. 2º | 24 h | PBT > 12 t | traçado aproximado: caminho do Valhalla entre o fim da Rua Sapê (sede) e a entrada de Angaturama, cerca de 8,7 km por sentido | truck (23 t), sede→Angaturama: 0 km, por outra estrada de terra (14,5 km). O VUC (9 t) usa 8,7 km da estrada |

Pendências e ressalvas:

- A estrada não tem nome nem ref no OSM, e existem outras estradas de terra entre a sede e Angaturama. É preciso
  conferir o traçado com a prefeitura.
- Os "4 ways com hgv=no" citados na preparação não aparecem no PBF do Valhalla, que só tem `hgv=discouraged` em
  estradas de terra.

## 3157807 Santa Luzia

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `santa_luzia_centro_historico` | ativa (alta) | Dec. 4.056/2022, art. 1º, I–XIII e Anexo I; arts. 2º–8º; Dec. 4.412/2024, art. 1º (inciso XI) | 24 h | comprimento > 6,5 m ou PBT > 5,5 t | as 13 vias por nome (22 linhas) | toco, da R. do Bonfim à R. do Serro: 0 km (5,4 km). O utilitário passa 1,06 km |
| `santa_luzia_centro_historico_2021` | revogada (vigência até 30/08/2022) | Dec. 3.841/2021, art. 1º; revogado pelo art. 10 do Dec. 4.056/2022 | – | idem | mesmas vias (registro) | – |

Pendências e ressalvas:

- A "Rua João Santana" (XII) não existe no OSM. Usei a "Rua Santana" do Centro, marcada `aproximado`. Na hora da rota com
  `truck`, essa linha não casa com o grafo (aviso `cost_line_ignored`), embora tenha passado no teste do import, que usa
  `auto`.
- A Rua Direita foi restrita ao Centro Histórico com pontas `lonlat`, porque há outra Rua Direita em São Benedito.

## 3167103 Serro

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `serro_vias_7t_art2_art4` | ativa (média) | Dec. 4.801/2014, arts. 2º e 4º; arts. 5º–6º | 24 h | PBT > 7 t | 18 logradouros por nome (25 linhas) | toco, do sul da sede ao leste do centro: 0,02 km (6,4 km). O utilitário passa 0,80 km |
| `serro_rodovia_municipal_ser152_7t` | **desativada** (sem geometria confiável) | Dec. 4.801/2014, art. 3º | 24 h | PBT > 7 t | candidata: way 504793528, por Várzea de Baixo até a MG-010 | – |
| `serro_vias_7t_autorizacao_temporaria` | desativada (baixa) | Dec. 4.844/2014, art. 1º e §§ | – | PBT > 7 t | Rua Paraná, Rua Dep. Augusto Clementino e Rua Minas Gerais | – |

Pendências e ressalvas:

- A **SER-152** estava "ativa" na pesquisa, mas entrou desativada por falta de traçado confiável: o OSM não tem a ref
  nem o nome, e a ligação com a BR-259 não foi confirmada.
- Rua Bela Vista: a única com esse nome no OSM fica num distrito, a cerca de 10 km da sede.
- Av. Pasto do Padilha, Praça Teófilo Otoni e Praça Dr. João Pinheiro não têm nome no OSM.
- Casadas por grafia ou posição: "Avenida Dom José André" é "Avenida Dom André" no OSM (`aproximado`), "Avenida Dom José
  Pedro Costa" é "Rua Dom José Pedro Costa", "Rua Nagib Bahmed" é "Rua Nacib Bahmed" e "Travessa do Magalhães" é
  "Travessa Magalhães".

## 3167202 Sete Lagoas

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `sete_lagoas_arc_area_central` | ativa (média) | Dec. 5.096/2014, arts. 2º, 5º, 6º e 13; Dec. 5.365/2016, art. 3º; Portaria 003/2015-SELTRANS, arts. 3º, 4º e 11 | seg–sex 7h–19h; sáb 7h–14h; feriados inclusive | largura > 2,2 m ou comprimento > 6,5 m (VUC/VMP livre) | zona: poligonal ÁREA CENTRAL pelos eixos do OSM (1,76 km²) | toco, norte→sul. Às 10h: 0 km (6,1 km). Às 20h: 1,26 km na zona |
| `sete_lagoas_arc_vias_art2` | ativa (média) | Portaria 003/2015, art. 2º, I–XVII e art. 3º; mesmos decretos | idem | idem | 17 trechos por nome (103 linhas); `zona_vinculada` à Área Central | toco pela R. Santa Juliana. Às 10h: 0,04 km (3,9 km). Às 20h: 2,40 km |
| `sete_lagoas_orla_lagoas` | ativa (média) | Dec. 5.096/2014, art. 5º, III | 24 h | idem | vias lindeiras à água: Av. Getúlio Vargas, Av. Cel. Altino França e Pç. Dom Carlos Carmelo Mota (Paulino); Av. Prof. Maurílio de Jesus Peixoto (Boa Vista) | toco na Boa Vista às 10h: 0 km. O utilitário passa 0,27 km. Na Paulino às 22h: 0 km. O utilitário passa 0,60 km |
| `sete_lagoas_arc_vias_acesso` | desativada (baixa) | Portaria 003/2015, art. 3º | idem | idem | registro sobre o polígono da Área Central | – |

Pendências e ressalvas:

- `sete_lagoas_arc_vias_acesso`: o `tipo` mudou de `via` para `zona`, só para ter geometria de registro. O ato não lista
  as vias de acesso.
- A Rua Dr. Sebastião Mascarenhas (VIII) só tem 88 m com nome no OSM.
- Praça do Maçom e Praça José Cirilo não estão no OSM, por isso o inciso XVII usa a Av. Raquel Teixeira Viana inteira.
- O inciso V foi montado em duas partes, porque a pista dupla se divide na rotatória da Praça José Lucidio Avelar.
- No OSM, a Av. Antônio Olinto ocupa o lado que o ato chama de "Av. Múcio José Reis (Norte-Sul)".
- O art. 11 do decreto mantém restrições anteriores do Hipercentro, cujos atos não estão online.
- O VUC local (VMP: até 2,20 m de largura e 6,50 m de comprimento, sem cadastro) fica no nível do município.

## 3163706 São Lourenço

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `saolourenco_rua_xv_novembro_23t_14m` | ativa (média) | Dec. 8.537/2021, art. 1º, p. único | 24 h | PBT > 23 t ou comprimento > 14 m | Rua XV de Novembro, da R. Alda Garrido à Av. Dr. Getúlio Vargas | carreta, oeste→leste: 0,02 km. O toco passa 0,26 km |
| `saolourenco_entrada_br460_23t_14m` | desativada (média) | idem, caput | 24 h | idem | limite municipal do IBGE (registro) | – |

A pendência do Dec. 7.626/2019 foi resolvida: no OSM, a ordem das transversais, de oeste para leste, é Alda Garrido,
Marechal Floriano, Barão do Rio Branco, Batista Luzardo e Getúlio Vargas. Assim, o trecho do 7.626 (Batista Luzardo a
Getúlio Vargas, com 30 t e 18 m) fica dentro do trecho do 8.537, que é mais restritivo, e não sobra restrição residual.

## 3168606 Teófilo Otoni

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `teofilo_otoni_regiao_central_grande_porte` | ativa (média) | Lei 7.942/2026, arts. 2º, 3º, 4º, 5º, 8º e 9º | seg–sex 6h–20h; sáb 8h–14h; feriados inclusive | PBT > 7 t, eixos > 3 ou carreta/bitrem/rodotrem | zona: faixa de 150 m em torno de 16 das 19 vias (2,25 km²) | toco norte→sul: às 10h, 0 km (11,6 km); às 22h, 2,58 km. Toco oeste→leste: às 10h, 0 km (16,3 km); às 22h, 2,72 km |

Pendências e ressalvas:

- Praça Tiradentes, Praça Duque de Caxias e Rua Coronel Ramos não têm nome no OSM. Ficam dentro das faixas das vias
  vizinhas.
- A Av. Boali Porto Salman entra só no trecho central.
- Não há decreto regulamentador, que pode ajustar a delimitação (art. 4º, p. único). Se ele sair, é preciso repesquisar.

## 3170404 Unaí

| id | Status | Ato e artigo | Janela | Alvo | Geometria | Casos |
|---|---|---|---|---|---|---|
| `unai_av_governador_valadares` | ativa (média) | Lei 1.452/1993, arts. 1º–4º e 7º | 24 h (carga e descarga 7h–9h e 15h30–17h30 é exceção de destino, nos avisos) | caminhão | as duas pistas da Av. Gov. Valadares (BR-189 no OSM), da R. Rio Preto à Praça São Cristóvão | toco nos dois sentidos: 0 km. O utilitário passa 1,26 e 1,24 km |

Pendências e ressalvas:

- A Praça São Cristóvão não tem nome no OSM. A ponta é o fim das pistas de mão única, marcada `aproximado`.
- A avenida é a travessia urbana da BR-189.
- A lei é anterior ao CTB, e o município entrou no SNT só em 09/2026.

## Problemas encontrados fora do lote (não corrigidos)

1. **Importador, `build_trecho` (`importers/sources/_municipios_lib.py`).** Quando a via com `de`/`ate` é um único way
   (um `LineString` só depois do `unary_union`), `linemerge` dá `ValueError: Cannot linemerge LINESTRING` e o import
   inteiro do município cai. Contornei usando a via inteira, sem pontas: Praça Dr. Pedro Sanches em Poços de Caldas e
   Rua Dr. Sebastião Mascarenhas em Sete Lagoas.
2. **Validação das linhas.** O import testa as linhas no Valhalla com costing `auto`, mas a rota usa `truck`. Uma linha
   pode passar no import e ser descartada na rota com `cost_line_ignored`, como aconteceu com a Rua Santana de Santa
   Luzia.
3. **`--validar` e import travados por outros arquivos.** `--validar` e `municipios:<ibge>` validam todos os arquivos.
   Um município de outro lote em edição, com geometria manual ausente, derruba o import de todos. Para importar,
   apontei `MUNICIPIOS_DIR` para uma cópia com só o meu arquivo e o schema. A validação global, rodada no fim, deu
   94 arquivos válidos.
