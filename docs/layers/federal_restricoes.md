# Camada `federal_restricoes`: restrições físicas das rodovias federais (SIAET/DNIT)

Limites de **altura, largura, PBT e comprimento** que o DNIT cadastra no SIAET por segmento do PNV (restrição
**definitiva** e **temporária**), com geometria do SNV. Entra na rota como `costLines` (só a via, não as
travessias). Também aplica os alertas do DNIT aprovados na curadoria (ver `pontes_federais.md`).

| | |
|---|---|
| Importador | `importers/sources/siaet_restricoes.py` (`LAYER_ID=federal_restricoes`, `SOURCE=siaet`) |
| API | `api/src/layers/federal_restricoes.layer.ts` |
| Tabelas | `data_features` (feições) e `siaet_osm_match` (cache do casamento com o grafo, migration `0112_siaet.sql`) |
| Seed | `db/seed/layers/federal_restricoes__siaet.sql` (~9 MB, 4.891 linhas, ref. 10/2026) |
| Testes | `api/test/layers/siaet.test.ts` |

## Fontes e licenças

| Fonte | O que dá | Licença / uso |
|---|---|---|
| DNIT/SIAET: PDFs mensais por UF em `https://www.gov.br/dnit/pt-br/assuntos/infraestrutura-rodoviaria/aet/restricoes/restricao-{definitiva\|temporaria}/{MM-AAAA}/{uf}.pdf` | BR, UF, PNV, km e, por pista, altura, largura (faixa e total na definitiva), PBT, comprimento e raio de giro | Dado divulgado pelo Poder Executivo federal: livre utilização (Decreto 8.777/2016, art. 4º caput e §1º, red. Decreto 9.903/2019). O cadastro oficial de restrições também não é obra protegida (Lei 9.610/1998, art. 8º IV e V: atos oficiais e "cadastros"). O rodapé do portal gov.br cita CC BY-ND 3.0 para o conteúdo do site: guardamos **só os valores factuais**, citando o DNIT, e os PDFs não são redistribuídos (ficam em `data/cache`, fora do git). |
| DNITGeo WFS `vgeo:vw_snv_rod` (SNV) | geometria dos segmentos PNV (versão vigente e histórico) | Dado público do DNIT, de livre utilização (Decreto 8.777/2016, art. 4º). O WFS não declara licença (`Fees=NONE`, `AccessConstraints=NONE`). Citar o DNIT. |
| DNITGeo WFS `vgeo:oae_sgo` | OAEs, para saber se o segmento tem uma única ponte | Idem. |

Nenhum dado desta camada vai para o OSM. O cache `siaet_osm_match` guarda linhas derivadas do grafo do Valhalla
(OSM, ODbL) só para uso interno no roteamento. Ele não é exportado nem misturado a `data_features`.

## Como atualizar (mensal)

O DNIT publica o mês novo nos primeiros dias do mês, com o cabeçalho "Atualizado em: dd/mm/aaaa". O importador pega
o mês mais recente disponível: tenta o mês atual e volta até 3 meses (`404` quer dizer que ainda não saiu).

```bash
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed \
  truck-router-importer siaet_restricoes
```

- `SIAET_MES=10-2026` força o mês. `SIAET_UFS=mg,rj` limita as UFs (para testes; não commite o seed parcial).
- 1ª carga: ~5 min (54 PDFs de ~0,5 MB e o SNV vigente por UF, ~150 MB). O SNV fica em `data/cache/snv/<versão>/` e
  só é baixado de novo quando sai versão nova.
- Depois de importar, a API recasa sozinha o que mudou: o hash da geometria entra na chave do cache.
- Confira em `GET /api/sources`: `data_layer_runs.notes` traz o mês, a data de atualização e os métodos de geometria.

## Parser

`pdftotext -bbox` (poppler, já na imagem do importador), com colunas pela posição x do cabeçalho ("Pista 1"/"Pista 2",
"Altura", "Faixa", "Total", "Peso", "Giro", "Comp."). Validado contra o parser da pesquisa (pdfplumber):
**0 divergências** em 3.374 linhas definitivas e 1.532 temporárias (out/2026).

## Geometria (PNV do SIAET para o SNV)

O SIAET usa o código PNV como chave, mas tem quilometragem própria (às vezes de versões antigas do SNV):

| Método (`props.geom_metodo`) | Quando | Out/2026 |
|---|---|---|
| `snv_codigo` | o código existe no SNV vigente e a extensão bate (±5% ou ±0,3 km) | 3.701 |
| `snv_codigo_extensao_siaet` | o código existe, mas a extensão diverge: a partir do início do código, segue o eixo principal vigente pela extensão do SIAET (aproximada) | 867 |
| `snv_historico` | o código não existe no SNV vigente: usa a versão histórica do `vw_snv_rod` com os km mais próximos | 327 |
| sem geometria | código não encontrado em nenhuma versão | 11 (descartadas) |

A geometria do SNV segue o km crescente (conferido em 3.533 encadeamentos de 8 UFs, 0 invertidos), então a pista 1 do
SIAET é o sentido da linha. Ela é guardada simplificada (~10 m), com 5 casas decimais.

## Regras na rota

Base legal conferida nos textos:

- **Res. DNIT nº 11/2022** (alterada pela Res. DNIT nº 1/2026, que só trata da AET digital):
  - art. 1º e parágrafo único: vale para rodovias federais, inclusive as concedidas ou delegadas;
  - art. 4º XXVII: a restrição definitiva cobre impedimentos permanentes de gabarito vertical e horizontal;
  - art. 4º XXVIII: a temporária inclui "pontes com limitação de peso";
  - art. 29 §2º: a temporária "limite temporariamente o trânsito normal de veículos", por exemplo altura, largura ou
    PBTC máximos;
  - art. 29 §3º: o cadastro exige sinalização no trecho;
  - art. 29 §5º: a nota de avaliação do SGO, isolada, não é parâmetro de restrição de peso de carga especial;
  - art. 29 §6º: balizadores de 57 t para veículo sem AET e 74 t para CVC;
  - art. 31: as restrições cadastradas são consideradas na análise da AET.
- **Res. CONTRAN nº 882/2021**:
  - art. 4º: sem AET, largura de 2,60 m (red. Res. 994/2023), altura de 4,40 m e comprimento de 14 m (não
    articulado), 19,30 m (cavalo + semirreboque, red. Res. 1.005/2024) ou 19,80 m (demais combinações);
  - art. 18: CVC com mais de 57 t ou mais de 19,80 m só circula com AET;
  - art. 61: o órgão da via pode fixar limites menores por "área, via, pista, faixa ou obra de arte", com placas R-14
    (PBT) e R-17 (peso por eixo). As placas R-15, R-16 e R-18 (altura, largura e comprimento) são do MBST vol. I.

| Situação (por pista) | Na rota |
|---|---|
| limite > 0 e o veículo excede (altura, largura ou PBT; comprimento só na **temporária**) | `costLines` no trecho e item em `avoided`. Se a rota ainda usar o trecho: `danger` |
| comprimento da **definitiva** excedido por veículo que não precisa de AET por comprimento | só aviso `warn` (`siaet_restricao_geometrica`). É restrição geométrica cadastrada para AET; para o trânsito normal, só a temporária é expressa (art. 29 §2º) |
| **PBT 0 na temporária** de via sob jurisdição federal | **trecho impedido para todo veículo de carga** (`costLines`; `rule` diz "trecho impedido") |
| 0 em altura, largura ou comprimento ("AET não autorizada" naquela grandeza), e o veículo precisa de AET por ela | `costLines` (bloqueio) |
| 0 em altura, largura ou comprimento, e o veículo não precisa de AET | aviso `info` `siaet_aet_bloqueada` |
| qualquer 0 em via estadual ou municipal (ex.: 116BSP2550, Marginal Tietê) | não bloqueia. Veículo com AET: `warn` `siaet_aet_outro_orgao` (a AET é do órgão da via). Sem AET: `info` |

### O que o valor 0 quer dizer

**A Res. 11/2022 não define o 0**, então a regra acima vem dos dados e de casos conferidos fora do SIAET:

- **PBT 0 na temporária = interdição.** Seis linhas do SIAET de out/2026 foram conferidas em notícias de 2025–2026:
  - `235BTO0495`, ponte do Rio Tocantins na BR-235/TO (Pedro Afonso): interditada a todos desde 19/06/2026;
  - `272BPR0560`, ponte do Rio Piquiri na BR-272/PR: fechada, travessia por balsa;
  - `259BES0015`, BR-259/ES km 15,32 (Córrego Treviso Grande): interdição total desde 18/08/2026;
  - `116BRS3070`, ponte do Rio das Antas na BR-116/RS (km 95,7): bloqueio total;
  - `101BPE0370/0390`, BR-101/PE no Rio Igarassu: PBT 0 só na pista 1, e o DNIT listou "bloqueio parcial (pista 1)";
  - `232BPE0270`, BR-232/PE km 314,1: "cargas proibidas".
  Por isso o PBT 0 barra todo veículo de carga, com ou sem AET, inclusive o utilitário (as interdições conferidas
  valiam para todos). A regra vale também para "Convênio Adm.Federal/…" (via federal delegada) e para administração
  em branco.
- **0 nas outras grandezas = AET não autorizada.** Há linhas com largura 0 e PBT 60 t (`495BRJ0010`, Teresópolis) ou
  com altura e largura 0 e PBT 25 t (`364BMG0350`). Um trecho fechado não teria PBT publicado, então nesses casos o 0
  barra só quem precisa de AET naquela grandeza.
- **Fora da jurisdição federal o 0 não vale.** O `116BSP2550` (Marginal Tietê, "Estadual") tem 0 em tudo e está aberto.
  Vias planejadas ou em implantação (`superficie` PLA/IMP, AM/RR) também têm 0 em tudo. Elas são federais e ficam
  impedidas, o que bate com a realidade (sem via pavimentada).

### Sentido, ponte e fator

- **Pista 1 × pista 2.** Toda linha penalizada é **dirigida**: o sentido crescente usa os limites da pista 1 e o
  decrescente os da pista 2 (sem pista 2 publicada, a pista 1 vale para os dois). Exemplo: Av. Brasil, BR-101/RJ
  km 350,4–353,2, com 4,0 m no sentido crescente e 4,9 m no decrescente. O `annotate` também mede em que sentido a rota
  usa cada trecho e mostra os limites da pista usada (`data.trechos[].sentidos`).
- **Só a ponte.** Se a violação é só de PBT (limite ou interdição) e o segmento tem exatamente 1 ponte ou viaduto do
  DNITGeo (até 80 m do eixo, mesma BR ou BR coincidente), a penalidade vai só nas arestas `bridge` do OSM mais
  próximas do ponto do DNIT (até 250 m). Sem ponte casada, vale o segmento inteiro. São 950 linhas com OAE único.
- **Fator.** Cada linha recebe um custo equivalente a ~600 km (mínimo de 1000×). Sem desvio razoável, a rota passa e
  sai `danger`: `uses_restricted_way` do routing.ts, ou `siaet_restricao_na_rota` desta camada (uso parcial de trechos
  longos, ou restrição que não pôde ser aplicada).
- **Corredor.** Só entram feições no retângulo origem–destino ampliado (máx(0,8°, 50% da maior dimensão)). O
  orçamento é de 25 mil pontos de linha por rota (o Valhalla aceita 50 mil arestas de `linear_cost_factors`, somando
  todas as camadas).

### Casamento com o grafo (por que existe `siaet_osm_match`)

`linear_cost_factors` faz *edge walk*: a linha precisa seguir **exatamente** as arestas do grafo, senão o Valhalla
recusa a rota inteira (erro 233). A geometria do SNV fica a 5–40 m da via do OSM, então cada trecho é casado uma vez:

1. Densifica o eixo (80 m) e roda `trace_attributes` (`map_snap`, raio de 60 m). Recusa o casamento se a mediana
   passar de 45 m ou se mais da metade cair em rua residencial ou de serviço. Tira as arestas parciais das pontas.
2. Trecho de **mão dupla** (`traversability = both`): valida a ida-e-volta numa chamada só e guarda **as duas metades
   como linhas separadas**, uma por sentido. O fator é por aresta dirigida, e o routing.ts confere o sentido. Uma linha
   ida-e-volta única ficava com metade dos pontos "na contramão" e não era reconhecida como usada. Trecho de **mão
   única** (pista dupla): a pista do sentido do km e a outra pista, casada com a geometria invertida. O casamento
   invertido também cobre eixo desenhado contra a mão (Ponte General Dutra, Campos/RJ).
3. Em pista dupla, procura **pistas paralelas do mesmo sentido** (expressa e local): casa a linha deslocada ±25/±40 m
   e aceita só vias de mão única com o mesmo nome ou ref (ex.: pista lateral da Av. Brasil).
4. Cada linha é validada com uma rota curta. Só as válidas entram.
5. O resultado fica guardado por `(feição, modo, tileset_last_modified)`. Trocar os tiles invalida tudo; mudar o
   algoritmo troca `MATCH_VERSION` (hoje `v6`), que entra no hash.

Aquecimento: 8 s depois da 1ª rota, a API casa em segundo plano os trechos que barram os perfis sem AET de
`config/vehicle-presets.json`, no mesmo modo (segmento ou ponte) que a rota usaria (`FEDERAL_RESTRICOES_WARMUP=0`
desliga). Se o casamento de um trecho do corredor não terminar em 25 s (`FEDERAL_RESTRICOES_MATCH_BUDGET_MS`), a
rota sai sem ele, com aviso `siaet_nao_aplicado`; a próxima já usa o cache. `FEDERAL_RESTRICOES_VALHALLA_CONCURRENCY`
(padrão 3) limita as chamadas simultâneas ao Valhalla. `FEDERAL_RESTRICOES_DEBUG=1` mostra os tempos no log.

### Avisos

| Código | Severidade | Quando |
|---|---|---|
| `uses_restricted_way` (routing.ts) / `siaet_restricao_na_rota` | danger | a rota ainda usa, no sentido restrito, um trecho cujo limite o veículo excede |
| `siaet_aet_outro_orgao` | warn | 0 em trecho não federal para veículo com AET |
| `siaet_restricao_geometrica` | warn | comprimento da definitiva excedido por veículo sem AET de comprimento |
| `siaet_aet_bloqueada` | info | 0 que não vale para este veículo (grandeza em que ele não precisa de AET, ou via não federal) |
| `siaet_folga_minima` | info | veículo exatamente no limite (folga < 5 cm ou < 0,5 t), agregado |
| `siaet_nao_aplicado` | info | restrição do corredor que não casou (fora dos tiles carregados) ou ainda em preparo |
| `siaet_desatualizado` | info | mês de referência com 2 ou mais meses de atraso |

`layers.federal_restricoes.data` traz:
- `ref_mes`;
- `trechos`: os trechos da rota, com os limites da pista usada, `sentidos`, `interditado`, `viola` e `atencao`;
- `evitados`, `aplicadas` e `nao_aplicadas`.

## Alertas do DNIT revisados

Os alertas de interdição ou restrição de ponte raspados das notícias do DNIT (importador `dnit_alertas`, camada
`pontes_federais`) **nunca entram sozinhos**. Depois que uma pessoa aprova o alerta em `dnit_alertas_curadoria`
(ver `docs/layers/pontes_federais.md`), esta camada o aplica:
- `acao = 'interdicao'` barra todo veículo;
- `acao = 'limite_peso'` barra quem excede `peso_max_t`.

O item na rota é `alerta:<source_id>`.

## Limitações e pendências

- **O valor vale para o segmento PNV inteiro, não para um ponto** (exceto no caso de OAE único). Um segmento de 30 km
  com uma ponte fraca bloqueia os 30 km. Isso inclui interdições: na BR-259/ES, a ponte do km 15,32 bloqueia o
  segmento km 15,3–49,1, que tem 7 OAEs.
- **A leitura do PBT 0 como interdição é inferência** a partir de seis casos conferidos, não está escrita na norma.
  Se o DNIT publicar a legenda do SIAET, revise `violations()`. Dois casos não foram confirmados em notícia: a Ponte
  General Dutra (Campos/RJ, temporária com PBT 0 e largura 3,6 m) e os trechos da BR-116/RS em Vila Cristina.
- **O SIAET atrasa** em relação às interdições (Rio Piancó/BR-361/PB, interditada em 25/09/2026, ainda tinha 12 t no
  SIAET de 05/10; o Igarapé Baruaninha/BR-432/RR não aparece). Por isso existem os alertas do DNIT com curadoria.
- Dados do SIAET com cara de erro são aplicados como estão (ex.: 352BMG0173 com PBT 2 t; larguras de 2,3–2,4 m). Para
  largura, usamos a **maior** entre a faixa de rolamento e a largura total da pista (o PDF não deixa claro qual é o
  limite do veículo; valores < 2,6 m só aparecem em erros evidentes).
- Os valores de altura, largura e comprimento do SIAET foram cadastrados para a análise de AET, e alguns barram
  caminhão legal (ex.: BR-495/RJ km 0–30,1 e Av. Brasil com 4,0 m; BR-459/SP e BR-365/MG com comprimento de 15 m).
  Não confirmamos a sinalização no local: os avisos pedem para conferir a placa.
- A geometria é aproximada em ~24% das linhas (`geom_aprox = true`), porque o km do SIAET não bate com o SNV
  vigente. Há 13 linhas `MultiLineString` em que a orientação de cada parte não foi conferida.
- Os tiles do Valhalla do ambiente cobrem só o Sudeste. Fora dele, as restrições não casam (`siaet_nao_aplicado`),
  mas continuam no mapa e nos avisos. Trocando para o PBF do Brasil, o casamento acontece sozinho.
- O casamento automático pode errar em nós urbanos complexos: a validação garante que a linha existe no grafo, não que
  é a via certa. Se o casamento pegou só uma das pistas, o uso da outra não gera `danger`.
- Uma pista paralela do mesmo sentido que não foi casada, a menos de 15 m da casada, pode receber
  `uses_restricted_way` do routing.ts.
- **Conflito com o teste da `rodovias_horario`.** O SIAET de out/2026 dá à BR-459/SP comprimento máx. de 15 m (na
  temporária e na definitiva) e PBT máx. de 45 t (459BSP0190, 459BMG0130). Por isso o rodotrem (74 t, 30 m) e a carreta
  (19,30 m) desviam da BR-459 em qualquer horário, inclusive na API da main. O teste que espera o rodotrem na BR-459
  fora da janela de feriado da PRF falha por causa disso, e precisa de um veículo com AET que caiba nesses limites.
