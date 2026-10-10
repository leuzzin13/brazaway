# Restrições municipais — camada genérica por município (código IBGE)

Restrições a caminhão definidas pelos **municípios** (zona, via ou ponte; horário, PBT, capacidade de carga,
dimensões, eixos, tipo de veículo), **um arquivo por município**: `data/raw/municipios/<ibge>.json`. Uma frente
regional (BH, Rio, Vitória, interior de SP...) **só adiciona arquivos**: o arquivo do município e, se precisar, o
GeoJSON curado da geometria. Não há camada por cidade, nem importador por cidade, nem código novo na API.

Os detalhes da Grande SP (Osasco, Barueri, Guarulhos, Cajamar, Santana de Parnaíba, Ribeirão Pires e o registro
revogado do ABC 2012) estão em [`restricoes_rmsp.md`](restricoes_rmsp.md).

| Peça | Arquivo |
|---|---|
| Regras de cada município | `data/raw/municipios/<ibge>.json` |
| Formato (JSON Schema 2020-12) | `data/raw/municipios/schema.json` |
| Validador (schema + coerência, sem dependência nova) | `importers/sources/_municipios_schema.py` |
| Importador genérico (uma fonte por município) | `importers/sources/municipios.py` |
| Geometria: OSM por nome/trecho, entorno, limites, corte e validação no Valhalla | `importers/sources/_municipios_lib.py` |
| Geometria curada | `data/raw/municipios/geo/<ibge>_<nome>.geojson` (as da RMSP continuam em `data/raw/rmsp/`) |
| Seeds | `db/seed/layers/restricoes_rmsp__<fonte_id>.sql` (um por município) |
| API | `api/src/layers/restricoes_rmsp.layer.ts` |
| Testes | `importers/tests/test_municipios.py`, `api/test/layers/municipios.test.ts` (município fictício `3599999`), `api/test/layers/rmsp.test.ts` (RMSP) |

## Decisão: o `layer_id` continua `restricoes_rmsp`

A camada foi generalizada **sem trocar o id**. Migrar para `restricoes_municipais` exigiria renomear as linhas de
`data_features`/`data_layer_runs` no banco compartilhado (a API da `main` e as outras frentes perderiam a camada até o
merge), regravar os 7 seeds e mudar os testes de RMSP, os códigos de aviso `rmsp_*`, o caminho
`/api/layers/restricoes_rmsp/...` e o front, sem ganho para o usuário. Mudou só o rótulo ("Restrições municipais"). O
id é histórico; o formato e o importador são genéricos. Os códigos de aviso antigos (`rmsp_*`) foram mantidos; os
novos usam o prefixo `municipal_`.

Não foi preciso migration: tudo continua em `data_features`/`data_layer_runs` e no calendário `holidays`.

## O arquivo do município

Exemplo completo (fictício, usado nos testes): [`importers/tests/fixtures/municipios/3599999.json`](../../importers/tests/fixtures/municipios/3599999.json).
Exemplos reais: `3505708.json` (Barueri, vias por nome e trecho), `3543303.json` (Ribeirão Pires, zona desenhada),
`3534401.json` (Osasco, zona + vias de duas origens), `3518800.json` (Guarulhos, vias no entorno de um trevo),
`3547809.json` (Santo André: registro regional revogado do ABC).

Nível do município:

| Campo | O que é |
|---|---|
| `formato` | `1` |
| `ibge`, `municipio`, `uf` | código IBGE (= nome do arquivo), nome e UF (tem de bater com os 2 primeiros dígitos do IBGE) |
| `fonte_id` | nome curto da fonte (ex.: `belo-horizonte`): vira o seed `restricoes_rmsp__<fonte_id>.sql` e a linha em `data_layer_runs`; `ibge` é reservado |
| `fonte` | `url` (os atos), `licenca` (licença **real** dos atos e da geometria) e `notas` |
| `verificado_em` | data em que os atos foram conferidos na fonte primária |
| `vuc` | **definição local de VUC** (largura e comprimento máximos e, se o ato fixar, altura, PBT, capacidade e eixos; `exige_cadastro`; `artigo`). `null` = o município não define VUC ou a isenção não foi confirmada: o VUC é tratado como caminhão |
| `vuc_nota` | nota herdada pelas regras sem `vuc_nota` |
| `regras` | lista de regras |

Cada regra:

| Campo | O que é |
|---|---|
| `id` | id estável e único no projeto, prefixado pelo município (ex.: `bh_area_central`) |
| `tipo` | `zona` (polígono → `exclusions`), `via` ou `ponte` (linhas → `costLines`, só a via) |
| `regime`, `nome` | rótulo curto (aparece como tipo do item evitado) e nome |
| `status` | `ativa`, `desativada`, `suspensa` ou `revogada` (ver abaixo) |
| `status_motivo` | obrigatório quando não é `ativa` |
| `confianca` | `alta`, `media`, `baixa` ou `unverifiable`, do `verify.json` da pesquisa |
| `janelas` | `[{days: [1..7], from: "HH:MM", to: "HH:MM"}]`; 1 = segunda; `to` exclusivo; `24:00` permitido; janela que vira a noite = duas janelas |
| `variantes` | janelas próprias de uma classe (ex.: carreta 24 h): `{classe, quando: {qualquer/todas}, janelas}` |
| `feriados` | `suspende` (o ato excetua feriados) ou `aplica` (o ato não excetua) |
| `alvo` | `{caminhao: true, qualquer?: [...], todas?: [...]}`: sempre só caminhão (PBT acima de 3,5 t, CTB Anexo I) e o predicado |
| `vuc` | ausente = herda a do município; `null` = sem VUC nesta regra |
| `excecoes`, `autorizacao` | textos citados nos avisos (o perfil do veículo não tem autorizações municipais) |
| `excecao_destino_local` (+ `_incisos`, `_artigo`) | carga com **entrega** no município fica fora da regra (só com destino no município) |
| `zona_vinculada` | id de uma regra-zona do mesmo arquivo: a via segue a política da zona com origem/destino dentro dela |
| `base_legal` | `[{ato, artigo, url, nota?}]`: **ato e artigo obrigatórios** (fonte sem artigo, como mapa ou notícia, diz o que é) |
| `vigencia_inicio`, `vigencia_fim` | viram `valid_from`/`valid_to`; a rota compara com o horário de saída. Revogada exige `vigencia_fim` |
| `geometria` | lista de origens de geometria (abaixo) |
| `trechos` | trechos "rua X entre Y e Z" do ato, para `construir: trechos` |
| `municipio`, `ibge: null`, `abrangencia_ibge`, `source_id` | só para registro regional de vários municípios (ex.: ABC 2012) |

### Predicado do veículo (`alvo`, `variantes[].quando`)

Condição: `{campo, acima | ate | em}` (exatamente um operador). `acima` é "maior que", `ate` é "menor ou igual".

| `campo` | Veículo | Observação |
|---|---|---|
| `pbt_t` | `weight_t` | peso bruto total |
| `payload_t` | `payload_t` | **capacidade de carga** (lotação, CTB Anexo I). Não confunda com PBT: BH restringe por "capacidade de carga" acima de 5,5 t (Portaria BHTRANS DPR 138/2009, art. 1º, II; o termo vem do art. 2º da Portaria 077/2014 e as 5,5 t do art. 1º da Portaria 004/2019) |
| `comprimento_m`, `largura_m`, `altura_m` | `length_m`, `width_m`, `height_m` | |
| `eixos` | `axle_count` | |
| `tipo` | `vehicle_class` | `em: ["semitrailer", "truck_trailer", "cvc"]` etc. (`light`, `rigid`, `semitrailer` = cavalo + semirreboque, `truck_trailer` = caminhão + reboque, `cvc` = bitrem/rodotrem) |

`qualquer` = basta uma (OU); `todas` = todas (E); com as duas, valem as duas.

**Capacidade de carga sem o dado.** O veículo da API tem `payload_t` opcional. Sem ele, o perfil traz um valor
**típico e aproximado** (`config/vehicle-presets.json`, `payload_t_aproximado: true`), que **não decide** regra. A
camada enquadra o veículo com **cada capacidade possível** (0, cada limiar de `payload_t` da regra e logo acima dele,
até o PBT — a capacidade nunca passa do PBT) e fica com o **lado seguro**:

- a regra vale se valer com alguma capacidade (vale para `acima` e para `ate`, no `alvo` e nas variantes);
- entre as classes que valem, fica a de horário que cobre os das outras (ex.: carreta 6h–20h cobre caminhão 7h–9h e
  16h–20h); se nenhuma cobre, a rota usa a **união** dos horários (classe "caminhão ou leve"). Uma variante "classe
  menor" (`payload_t` `ate` X) com janela mais curta nunca encurta a restrição de quem não informou a capacidade;
- uma definição de VUC com `payload_max_t` não é atendida (sem o dado do CRLV, não é VUC ali).

Quando a regra foi aplicada e a capacidade mudaria a decisão, a rota avisa `municipal_capacidade_nao_informada`
(info) pedindo a capacidade do CRLV: com o efeito da capacidade típica do perfil quando ela decidiria diferente, e
sempre que o veículo cabe no VUC local pelas dimensões mas o VUC exige capacidade máxima. Regra que não se aplica ao
veículo (ex.: VUC isento por dimensões) não gera esse aviso. Com o valor informado pelo usuário, a regra usa o valor.

### Status e confiança

| Status | Grava como | Na rota |
|---|---|---|
| `ativa` | `kind=zona` ou `kind=via` (ponte também é `via`, com `props.tipo = ponte`) | aplicada (zona: `exclusions`; via/ponte: `costLines` com fator 1000) |
| `desativada` | `kind=desativada` | **nunca aplicada**; aviso `municipal_regra_nao_aplicada` (info) se a rota passa nela e o veículo seria alvo |
| `suspensa` | `kind=suspensa` | idem |
| `revogada` | `kind=revogada`, `valid_to` = data da revogação | nunca aplicada nem avisada (registro histórico) |

Confiança `baixa` ou `unverifiable` **só entra desativada**: o validador recusa `ativa` com essa confiança. Regra
`media` pode ficar ativa (registre o porquê em `nota`).

### Geometria (`geometria: [...]`)

Cada item tem exatamente uma origem:

| Origem | Uso |
|---|---|
| `{"arquivo": "municipios/geo/<ibge>_<nome>.geojson", "construir": "manual"}` | polígono ou linhas curados à mão / georreferenciados (caminho relativo a `data/raw/`) |
| `{"arquivo": "...", "construir": "trechos"}` | vias pelo **nome** do ato no OSM (Overpass, cache em `data/cache/municipios/`), a partir de `regra.trechos`: `via` (nome e variantes do OSM), `de`/`ate` (transversais ou `{"lonlat": [lon, lat]}`), `sentido: true` (só de → até), `caminho: "valhalla"` (entre dois pontos pela malha), `aproximado` e `nota`. Arquivo compartilhado por várias regras: as feições levam `regra_id` |
| `{"arquivo": "...", "construir": "entorno", "entorno": {...}}` | ramos e vias nomeadas num raio em torno de um ponto (ex.: trevo), sem as pistas principais |
| `{"geojson": {...}}` | geometria pequena embutida no próprio arquivo |
| `{"municipios": ["<ibge>", ...], "simplificar": 0.002, "casas": 5}` | união de limites municipais (só zona; registro regional) |

Opcionais: `props` (propriedades acrescentadas a cada feição, ex.: `fonte_trecho`, `aproximado`, `sentido`),
`formato: "eixos"` (linhas com `{nome, oneway}`), `omitir_ways_de` (a outra geometria prevalece no mesmo way do OSM),
`como_gerar` (instrução quando o arquivo manual falta). Nas vias, `sentido: "unico"` ou `mao_unica: true` = o custo vai
só no sentido do desenho; senão, nos dois.

Zonas: o polígono é recuado 20 m na rota (vias-limite livres; absorve o erro de georreferenciamento). Vias: no import,
cada linha é cortada em pedaços de até 400 m e testada contra o grafo do Valhalla (`linear_cost_factors` derruba a rota
inteira com `Failed to edge walk`); a que não casa é reencaixada (`map_snap`) ou descartada.

## Como a rota usa a camada

- **Zonas** ativas, para aquele veículo, no horário de **saída**, considerando feriado (`holidays` pelo IBGE e pela
  **UF** da regra): viram `exclude_polygons`. Origem ou destino dentro da zona: **não exclui** e avisa
  (`rmsp_origem_na_zona` / `rmsp_destino_na_zona`), como a ZMRC de SP. Só entram zonas a até máx(50 km; 60% da
  distância O–D) do segmento origem–destino (uma rota em SP não leva as zonas de BH ao Valhalla).
- **Vias e pontes** ativas: `linear_cost_factors` com fator 1000 ("proibido salvo sem alternativa"), só as a até
  máx(2,5 km; 40% da distância O–D, limitado a 15 km) do segmento O–D.
- **Município da origem/destino** (exceção de entrega local): limite próprio da camada (39 municípios da RMSP, fonte
  `ibge`) ou, fora dele, a malha do IBGE da camada `geocoding` (`ibge-malhas`, todos os municípios do Sudeste).
- `annotate()`: horário estimado de passagem (`rmsp_zona_ativa_na_passagem`, `rmsp_via_ativa_na_passagem`), via
  restrita usada que o `routing.ts` não vê (`rmsp_via_restrita_na_rota`, danger), VUC (`rmsp_vuc_cadastro`,
  `rmsp_vuc_nao_confirmado`), trecho aproximado (`rmsp_trecho_aproximado`), entrega local (`rmsp_destino_local`),
  capacidade não informada (`municipal_capacidade_nao_informada`) e regra desativada/suspensa no caminho
  (`municipal_regra_nao_aplicada`; lista em `data.nao_aplicadas`).
- Cargas antigas (status `vigente`, sem `uf`/`confianca`) continuam valendo como `ativa` em SP.

## Passo a passo: uma frente regional adiciona um município

1. **Regras.** Use a pesquisa da frente (`research.json` **com as correções do `verify.json`**). Para cada regra:
   ato, **artigo**, URL da fonte primária, horários, quem é atingido, exceções, VUC local, feriados (o ato excetua?),
   confiança. Regra `baixa`/`unverifiable`: entra `desativada` com `status_motivo`. Revogada ou suspensa: registre
   assim mesmo (nunca é aplicada). Capacidade de carga (lotação) vai em `payload_t`, nunca em `pbt_t`.
2. **Arquivo.** Crie `data/raw/municipios/<ibge>.json` (copie a fixture `3599999.json` ou um município parecido e
   troque tudo). `fonte_id` em minúsculas com hífen (ex.: `belo-horizonte`), `$schema: "./schema.json"` (o editor
   valida enquanto você escreve). Ids de regra prefixados pelo município. Textos em português do Brasil.
3. **Geometria.**
   - Zona desenhada ou georreferenciada: `data/raw/municipios/geo/<ibge>_<nome>.geojson` (Polygon/MultiPolygon em
     EPSG:4326) com `construir: "manual"` e `como_gerar`. Se foi ajustada aos eixos do OSM, é **derivada do OSM
     (ODbL)**: diga isso em `fonte.licenca`.
   - Vias do ato: `construir: "trechos"` + `trechos` com os nomes como estão no OSM; o import monta o arquivo e grava
     as `pendencias` (trechos não achados) dentro dele. Revise e corrija nomes/pontas até zerar.
   - Ponte: linha curta sobre a ponte (`tipo: "ponte"`), alvo pelo limite da placa ou do ato.
4. **Validar sem banco nem rede** (não chama o Overpass nem a malha do IBGE e não grava nada em `data/raw`; geometria
   que só o import gera aparece como "geometria a gerar no import"; geometria existente incoerente com a regra falha):
   ```bash
   docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data:/data -e DATA_DIR=/data \
     --entrypoint python truck-router-importer -m sources.municipios --validar
   ```
   (todos os arquivos: confere também `fonte_id` e ids de regra repetidos entre municípios).
5. **Importar só o seu município** (gera a geometria que faltar, valida as linhas no Valhalla, grava no banco e escreve
   o seed). Nunca rode `municipios` sem filtro nem `all`: isso refaz todos os municípios (milhares de testes no
   Valhalla) e regrava os seeds das outras frentes.
   ```bash
   docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
     -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e VALHALLA_URL=http://valhalla:8002 \
     -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer municipios:<ibge>
   ```
   Para refazer a geometria a partir do OSM: `-e MUNICIPIOS_REBUILD=1` (ou apague o GeoJSON gerado).
6. **Conferir na API** (`/api/layers/restricoes_rmsp/features?bbox=...`, uma ou duas rotas de exemplo).
7. **Teste próprio** em `api/test/layers/<frente>.test.ts`, chamando o módulo da camada como em
   `api/test/layers/municipios.test.ts` (e poucas rotas reais). Não altere `rmsp.test.ts` nem `municipios.test.ts`;
   rode só o seu teste.
8. **Doc da frente** em `docs/layers/<frente>.md`: tabela de regras com ato e artigo, decisões, licenças, limitações.
   Não é preciso editar este arquivo nem o `.layer.ts`.
9. **Commit**: o `<ibge>.json`, a geometria em `data/raw/municipios/geo/`, o seed `restricoes_rmsp__<fonte_id>.sql`, o
   teste e a doc. Não toque nos seeds nem nos arquivos de outros municípios.

Feriados municipais/estaduais: a regra só diz se o ato excetua feriado (`feriados`); o calendário (`holidays`, por
`ibge_code` e `uf`) é responsabilidade da frente de feriados.

## Testes

- `importers/tests/test_municipios.py` (sem rede): validador, montagem da fixture, erros de formato, `--validar`
  offline, carga `ibge` sem o arquivo de limites (recusa) e os **digests**: `legado` prova que os 6 municípios da RMSP
  saem iguais aos dos importadores `rmsp_*` antigos (as mudanças intencionais depois deles, como a capacidade de
  Cajamar, ficam em `LEGADO_IGNORAR` e são desfeitas nos dois lados); `exato` congela a montagem atual (mudança
  intencional num arquivo da RMSP: `ATUALIZAR=1`).
  ```bash
  docker run --rm -v $(pwd):/repo -w /repo/importers -e DATA_DIR=/repo/data --entrypoint python truck-router-importer \
    -m unittest tests.test_municipios tests.test_rmsp_linhas -v
  ```
- `api/test/layers/municipios.test.ts`: a camada com o município fictício (geometria no oceano, gravada e apagada pelo
  teste, fonte `teste-municipio-ficticio`).
- `api/test/layers/rmsp.test.ts`: os 26 testes da Grande SP (o de Cajamar cobre a capacidade de 3 t do VUC e de 14 t
  do caminhão).

## Licenças

Atos oficiais: domínio público (Lei 9.610/1998, art. 8º, IV). Geometria do OSM ou ajustada a ele: ODbL 1.0
(© colaboradores do OpenStreetMap), mantida separada em `data_features`, nunca exportada para o OSM. Limites
municipais: IBGE (dados públicos, citar a fonte). Notícias: só o fato, com citação. Cada município registra a licença
real em `fonte.licenca` (vai para `data_layer_runs`, `GET /api/sources`).

## Limitações

- Janela avaliada no horário de saída (o `annotate` só avisa a passagem estimada).
- Capacidade de carga sem o dado do CRLV: lado seguro entre as capacidades possíveis até o PBT (a regra vale se valer
  em alguma; nas variantes, o horário que cobre os outros ou a união) e a rota avisa.
- O perfil do veículo não tem autorizações municipais (AETV, AETE, cadastro de VUC) nem tipo de carga/sede da empresa:
  essas exceções só aparecem nos avisos.
- Regras por faixa (ex.: "caminhão na faixa da direita") não são representáveis no Valhalla.
- Seeds de Osasco, Barueri, Guarulhos e Santana de Parnaíba ainda são os do importador antigo (props sem
  `uf`/`confianca`, status `vigente`), equivalentes; a próxima carga com o Valhalla (`municipios:<ibge>`) regrava no
  formato novo (o de Cajamar já foi regravado, com a capacidade de carga). Nessa carga, os 6 braços da ZRCC-TB de Guarulhos mudam de `source_id` (o índice passou a ser por
  arquivo de geometria).
