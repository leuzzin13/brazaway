# IMPSC13: Vacaria RS

Lote do Sul/Centro-Oeste na camada genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)).
Pesquisa e verificação de 2026-10-18 em `docs/research/cidades_sul_co/` (`res/4322509.json`, `verif/4322509.json`, atos em `atos/4322509/`).
Geometria pelos nomes do OSM (cache do PBF, sem Overpass), ODbL 1.0; atos em domínio público (Lei 9.610/1998, art. 8º, IV). O município não define VUC (`vuc: null`).

| ibge | Município | fonte_id | Ativas | Desativadas | Casos de rota | Teste |
|---|---|---|---|---|---|---|
| 4322509 | Vacaria/RS | `vacaria` | 1 | 1 | 3 evita | passou |

## Vacaria/RS (4322509)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `vacaria_area_central_caminhoes_9t` | ativa (confiança média) | Decreto 0001, de 12/01/2016, art. 1º, alíneas a) a q); exceções no art. 2º; permissão da Guarda no art. 4º; art. 9º revoga o Decreto 88/2015. [Câmara](https://www.vacaria.rs.leg.br/proposicoes/pesquisa/0/1/0/6838) | 10h às 15h, 7 dias (o ato não diz "dias úteis"), feriados não excetuados | caminhão com PBT acima de 9 t | tipo via: 15 dos 17 trechos nomeados, todos aproximados (`4322509_vias.geojson`, 40 feições) | evita: carreta (norte a sul) e 2 de truck, cada um com a rota às 17h passando pelas vias |
| `vacaria_estradas_rurais_chuva_dec144_2024` | desativada (confiança média) | Decreto 144, de 21/05/2024, art. 1º e parágrafo único. [Câmara](https://www.vacaria.rs.leg.br/proposicoes/pesquisa/0/1/0/31490) | 24 h (só em dia de chuva e 24 h depois) | caminhões com guincho ou com toras | nenhuma (geometria vazia) | nenhuma |

Motivo da desativada: depende de chuva, vale só para guincho e toras (excluídos cargas vivas, ração e produtos agrícolas) e fala em "estradas do interior" sem nomear vias.

Exceções (só nos avisos): art. 2º (segurança, SAMU, ambulância em emergência, transporte de valores; caminhão abaixo de 9 t e até 7,50 m para carga e descarga nos 4 pontos sinalizados) e art. 4º (poder público e caminhões particulares com permissão da Guarda Municipal).

Casos de rota (terça 2026-10-13, 11h dentro da janela, 17h fora; km medidos a até 10 m das feições):

| Veículo | Origem | Destino | 11h | 17h |
|---|---|---|---|---|
| carreta | -28.4960, -50.9370 | -28.5150, -50.9300 | 5,09 km, 0,00 km nas vias, evita e) e f) | 3,03 km, 1,10 km nas vias |
| truck | -28.4975, -50.9300 | -28.5090, -50.9480 | 3,43 km, 0,04 km (travessias), evita m) | 2,63 km, 0,62 km |
| truck | -28.4960, -50.9370 | -28.5150, -50.9440 | 3,22 km, 0,04 km, evita e) | 2,60 km, 1,03 km |

Rota de passagem (carreta, oeste a leste, -28.5200,-50.9600 a -28.5000,-50.9100): 7,3 km às 11h contra 7,0 km às 17h, sem volta absurda. O VUC (preset, abaixo de 9 t) não é atingido: a rota é a mesma nos dois horários.

Geometria e decisões:
- O texto lido pela Câmara é "informativo"; nomes do ato ajustados ao OSM: "Rua Mal Floriano" é a Rua Marechal Floriano; "Rua João Teodoro Duarte" é a Rua João Teobaldo Duarte (mesmo local, via de mão única entre Atílio Giuriolo e Cel. Avelino Paim); "Rua Quinze de Novembro" é a "Rua 15 de Novembro".
- A **Avenida Militar** (OSM: trunk, provável trecho urbano de BR-116/285) é só o limite final das alíneas e), f), g) e i) e **não entra** na geometria; as pontas das vias que a tocam terminam no cruzamento.
- Alínea a): o ato não dá ponto de partida; leitura da pesquisa, entre a Pinheiro Machado e a General Lima, trecho aproximado.
- As alíneas c) (Atílio Giuriolo) e f) (Marechal Floriano) usam a malha do Valhalla entre os dois cruzamentos, porque o OSM as desenha em mão única em ramos que não se encadeiam.
- Alínea j): a Rua Farroupilha fica além da ponta oeste da Rua Inácia Vieira no OSM; o trecho vai até o extremo oeste mapeado.

Pendências:
- **"Rua General Lima" não existe no OSM** (alíneas a, b, n): assumida a Rua General Cunha, transversal a oeste do centro que fecha os três trechos de forma coerente. Confirmar com a prefeitura.
- **Alínea i) Rua João Borges Pinto** e **alínea p) Rua São João** não existem no OSM e ficam fora da geometria (a restrição real não é aplicada nelas).
- Não foi achado decreto posterior alterando o 1/2016, mas a Câmara indexa só parte dos atos e o FAMURS cobre Vacaria apenas de 2023-07 a 2026-10; sinalização não confirmada.
- "Carga máxima permitida acima de 9 t PBT" é ambíguo (carga x PBT): modelado como `pbt_t`.
- Pendências do import: nenhuma.
