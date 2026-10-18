# IMPSC09 — RS: São Francisco de Paula, São Sebastião do Caí e São Jerônimo

Lote da pesquisa profunda do Sul/Centro-Oeste (`docs/research/cidades_sul_co/res|verif/<ibge>.json`, verificação de 2026-10-18) na camada
genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)). Um arquivo por município em
`data/raw/municipios/<ibge>.json`, geometria em `data/raw/municipios/geo/<ibge>_*.geojson`, seed
`db/seed/layers/restricoes_rmsp__<fonte_id>.sql`, casos de rota em `api/test/fixtures/mun_sul_co/<ibge>.json` (teste:
`api/test/layers/mun_sul_co.test.ts`, passando para os três municípios).

| IBGE | Município | fonte_id | Ativas | Desativadas | Casos de rota |
|---|---|---|---|---|---|
| 4318200 | São Francisco de Paula | `sao-francisco-de-paula` | 1 (6 vias) | 2 | 1 evita |
| 4319505 | São Sebastião do Caí | `sao-sebastiao-do-cai` | 1 (zona) | 1 | 1 evita |
| 4318408 | São Jerônimo | `sao-jeronimo` | 2 (74 vias) | 1 | 1 evita, 1 sem_alternativa |

Nenhum dos três define VUC (`vuc: null`): o VUC é tratado como caminhão (em Caí a regra só atinge mais de 4 eixos, o que já exclui o VUC).
Geometria derivada do OSM (ODbL), dita em `fonte.licenca`; cache de vias com nome gerado do PBF com `osm_pbf_cache_regioes.py` (uma passada para os três).

## 4318200 São Francisco de Paula/RS (`sao-francisco-de-paula`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `sfpaula_av_julio_castilhos_veda_caminhao` | ativa (alta) | Decreto 2.308/2022, art. 2º (vedação), art. 4º (revoga o Dec. 309/2007), art. 5º (vigor em 18/09/2022) | 24 h, todos os dias (feriado aplica) | qualquer caminhão | via: Av. Júlio de Castilhos entre R. Cel. Serrano e Av. Benjamin Constant (6 feições, ~1,9 km, pista dupla desmembrada em mão única) | carreta do sudoeste ao norte: 2,28 km, 0 km no trecho; o utilitário passa (1,64 km, 0,99 km no trecho) |
| `sfpaula_estacionamento_carretas_perimetro` | desativada (alta) | Decreto 2.308/2022, arts. 1º e 3º | 24 h | caminhão | vazia | — (estacionamento, não circulação) |
| `sfpaula_cd_horarios_av_julio_castilhos` | desativada (média) | Decreto 2.410/2023, arts. 1º, 2º e 8º | seg-sex 6h-9h e 18h-22h; sáb 6h-9h e 13h-24h | caminhão | vazia | — (janela de carga e descarga, horário do sábado incerto no OCR) |

Pendências: nenhuma de geometria (pontas casadas pelas transversais). O OSM não marca hgv/maxweight nessa avenida (divergência já registrada na pesquisa: a vedação só existe aqui). A exceção do parágrafo único do art. 2º (autorização por escrito) aparece só nos avisos. Regra 24 h: não há horário fora da janela para provar a diferença.

## 4319505 São Sebastião do Caí/RS (`sao-sebastiao-do-cai`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `saosebastiaodocai_zona_central_veiculos_pesados` | ativa (média) | Lei 3.232/2010, art. 1º (red. Lei 4.378/2021), art. 2º (exceção de coleta/descarga com nota fiscal); Lei 4.145/2019 | 24 h, todos os dias (feriado aplica) | caminhão com mais de 4 eixos | zona: polígono manual aproximado (Av. Dr. Bruno Cassel a leste, R. João Pereira ao norte, R. Cel. Guimarães/Tiradentes ao sul, oeste junto ao Rio Caí), derivado do OSM | carreta de 5 eixos do norte ao sul do centro: 2,21 km, 0 km dentro; o truck (3 eixos) atravessa (1,69 km, 0,47 km dentro). Passagem pela Bruno Cassel (fora do polígono): 3,92 km, igual ao toco |
| `saosebastiaodocai_mineracao_caminhoes` | desativada (média) | Lei 3.844/2015, art. 1º e parágrafo único | 24 h | caminhão com mais de 2 eixos | vazia | — (depende da carga: mineração do município) |

Divergência com o OSM (registrada, sem caso que só prove o OSM): o OSM tem `hgv=no` na R. 13 de Maio e na R. Pinheiro Machado (dentro do quadrilátero), mais restritivo que a lei (só mais de 4 eixos). O caso de rota usa um par O-D em que o toco passa 0,47 km dentro da zona e a carreta de 5 eixos não, o que a camada prova; as ruas com `hgv=no` são só 4 trechos curtos.

Pendências: o Rio Caí não está nos dados nomeados; o limite oeste do polígono (51,3845 O) é aproximado pelo fim das ruas do centro. As ruas-limite ficam fora do polígono recuado (20 m). "Veículos pesados" não é definido na lei (modelado como caminhão com mais de 4 eixos).

## 4318408 São Jerônimo/RS (`sao-jeronimo`)

Decreto 4.274/2010 (SAPL norma 244), só as vias nomeadas dos incisos II (15 t) e III (30 t) do art. 2º. A regra de vias locais e coletoras (inciso I, 10 t) fica desativada, sem geometria (não há lista nem hierarquia viária). Não modelados: largura 2,60 m, altura 4,60 m, comprimento 14/20 m e 5 t por eixo (art. 1º). Situação atual do decreto não confirmada no portal da prefeitura (confiança média).

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `saojeronimo_pbt_10t_vias_locais_coletoras` | desativada (média) | Decreto 4.274/2010, art. 2º, I | 24 h | PBT acima de 10 t | vazia | — (sem delimitação georreferenciável) |
| `saojeronimo_pbt_15t` | ativa (média) | Decreto 4.274/2010, art. 2º, II (a-c) | 24 h | PBT acima de 15 t | via: Av. Ramiro Barcelos (R. Sen. Ramiro Barcellos e R. Ramiro Barcelos no OSM), Av. Rio Branco entre R. Flores da Cunha e R. Marechal Floriano (R. Barão do Rio Branco), R. Antônio de Carvalho (25 feições) | sem_alternativa: toco de 16 t cruza a cidade e usa 72 m da R. Sen. Ramiro Barcellos; avisa `rmsp_via_restrita_na_rota` |
| `saojeronimo_pbt_30t` | ativa (média) | Decreto 4.274/2010, art. 2º, III (a-i) | 24 h | PBT acima de 30 t | via: R. Flores da Cunha (até a ponta norte, junto ao rio/balsa), Av. Rio Branco (Flores da Cunha a Dr. José Athanásio), Av. Dr. José Athanásio, R. Gal. Osório, R. Sen. Salgado Filho e R. Rafael Athanásio (trechos), Av. Maurício Cardoso, R. Dona Délia Drebes, R. Marechal Floriano (49 feições) | evita: carreta (41,5 t) pela Av. Maurício Cardoso, sem maxweight no OSM: 4,37 km, 0,02 km na via; o utilitário a usa (3,75 km, 0,85 km) |

Pendências e observações:

- O OSM de São Jerônimo tem muito `maxweight` (10, 15 e 30 t) e cerca o centro: caminhões de 16 t ou mais costumam ficar sem rota ou com desvio grande por causa do OSM, não da camada. Por isso o caso de 15 t é `sem_alternativa` e o de 30 t foi escolhido numa via sem tag (Av. Maurício Cardoso), onde a prova é da regra.
- Divergências OSM x decreto (só registradas, nada corrigido): R. Antônio de Carvalho (decreto 15 t, OSM 10 t), R. Gal. Osório (30 t no decreto, OSM 10/15 t em partes), R. Sen. Salgado Filho e R. Rafael Athanásio (30 t no decreto, OSM 10 t).
- "Atracadouro da balsa" não existe no OSM: a ponta do trecho da R. Flores da Cunha é a ponta norte da via (junto ao rio), aproximado.
- Nomes do ato x OSM: Av. Rio Branco = R. Barão do Rio Branco; Av. Ramiro Barcelos = R. Sen. Ramiro Barcellos / R. Ramiro Barcelos; R. Rafael Athanásio = R. Rafael Athanásio Sobrinho; R. Flores da Cunha = R. José Antônio Flores da Cunha; Av. Dr. José Athanásio = R. Doutor José Athanásio.
- O roteador registrou `cost_line_ignored` em algumas rotas pesadas (linhas da regra que o Valhalla não aceitou naquela consulta); o import validou todas as linhas.
