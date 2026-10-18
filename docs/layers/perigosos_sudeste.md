# Camada `perigosos` — trechos fora de SP (frente `perigosos_sudeste`)

Extensão da camada [`perigosos`](perigosos.md) para o resto do Sudeste. Os trechos novos ficam em
`data_features` com `layer_id = 'perigosos'` e `source = 'sudeste'`, no mesmo `kind = 'trecho_proibido'` dos
trechos do DER-SP, com um `regra_id` que liga cada pedaço de via à sua regra. Não há camada nova nem migration:
o número **0206** reservado para esta frente ficou sem uso.

| Peça | Arquivo |
|---|---|
| Regras (curadas, com ato e artigo) | `data/raw/hazmat/trechos_sudeste_pp.json` (versionado com `git add -f`) |
| Importador | `importers/sources/hazmat_trechos_sudeste.py` (`LAYER_ID = 'perigosos'`, `SOURCE = 'sudeste'`) |
| Decisão por classe ONU | `api/src/services/hazmat.ts`: `classRuleApplies`, `classesOutside`, `inTimeWindows`, `trechoRuleDecision` |
| Aplicação na rota | `api/src/layers/perigosos.layer.ts` (`plan`, `mocangueInfo`, `trechoUse`, `sudesteTrechos`) |
| Seed | `db/seed/layers/perigosos__sudeste.sql` (≈ 1,6 MB, 472 feições: 57 do Sudeste + 415 do RS, seção 6) |
| Testes | `api/test/layers/perigosos_sudeste.test.ts`, `api/test/layers/perigosos_sul_co.test.ts` (RS), `importers/tests/test_hazmat_trechos_sudeste.py` |

Fonte das regras: pesquisas `docs/research/sudeste_perigosos_fora_sp` e `docs/research/sudeste_rio_capital`
(com as correções dos `verify.json`). Conferido em 10/10/2026.

## 1. Regras

| Regra (`regra_id`) | Ato e artigo | Publicação | Classes proibidas | Janela | Isenção da Parte 3 (RTPP) | Situação |
|---|---|---|---|---|---|---|
| Ponte Rio–Niterói (BR-101) e acessos (`RJ-PONTE-RIO-NITEROI`) | Portaria SPRF-RJ/PRF nº 407/2024, art. 1º e parágrafo único | DOU 22/11/2024, Seção 1, ed. 225 (portaria de 14/11/2024; art. 5º: vigência na publicação) | 1, 2.1, 2.3, 3, 4, 5, 6 e 8 | 24h | Sim (parágrafo único) | **Aplicada** |
| Av. Portuária, Av. Brasil → Porto do Rio (`RJ-AV-PORTUARIA`) | Portaria SPRF-RJ/PRF nº 407/2024, art. 4º-A | idem | as mesmas | 24h | Sim | **Aplicada** |
| Linha Vermelha, trecho no Município do Rio (`RJ-RIO-LINHA-VERMELHA`) | Res. SMTR nº 2.204/2012, art. 1º, IV | DO Rio 19/03/2012, p. 38–39 | todas | 24h (o ato não fixa horário) | Não prevista | **Aplicada** |
| Terceira Ponte, ES-060, Vitória–Vila Velha (`ES-TERCEIRA-PONTE`) | IS DERTES nº 021-N/2004, art. 1º, g, e "Horários", item 2 | DIO-ES 27/09/2004 (vale desde 23/09/2004) | todas | 0h às 24h | Não prevista | **Aplicada** (com nota de vigência, seção 1.1) |

Textos conferidos (atos oficiais, Lei 9.610/98 art. 8º IV):

- **Portaria 407/2024, art. 1º:** "Proibir, ao longo da Ponte Rio - Niterói (BR-101) e seus acessos, o tráfego de
  veículos transportando produtos perigosos relacionados nas classes indicadas", com as alíneas a) Classe 1,
  b) Subclasse 2.1, c) Subclasse 2.3, d) Classe 3, e) Classe 4, f) Classe 5, g) Classe 6 e h) Classe 8. Ficam de
  fora a 2.2, a 7 e a 9. **Parágrafo único:** a proibição não se aplica quando o produto, a embalagem ou a quantidade
  se enquadram nas isenções da Parte 3 da Res. ANTT 5.998/2022. **Art. 2º:** exceção da Ilha de Mocanguê (seção 2.3).
  **Art. 3º:** veículo vazio não limpo segue a proibição. **Art. 4º:** multa do CTB, art. 187, I. **Art. 4º-A:**
  aplica a portaria "ao trecho da Avenida Portuária que liga a Avenida Brasil ao Porto do Rio de Janeiro". A busca no
  DOU por "SPRF-RJ/PRF" até 10/10/2026 não achou revogação (só as Portarias 340, 347 e 364/2026, de outros assuntos).
- **Res. SMTR 2.204/2012, art. 1º, IV:** proíbe na "Rodovia Expressa João Goulart – Linha Vermelha" os "Veículos
  transportando produtos perigosos, conforme Resoluções 420/2004 da ANTT e suas modificações" (hoje a Res. ANTT
  5.998/2022). Exceções: art. 1º, parágrafo único (veículos do CTB, art. 29, VII), art. 3º (excepcionalidades da CRV
  após análise da CET-Rio) e art. 4º (guinchos e veículos a serviço da CET-Rio). A mesma resolução proíbe "caminhão,
  de qualquer espécie" (art. 1º, II, 2, a).
- **IS DERTES 021-N/2004:** art. 1º, g, "Todos veículos transportando produtos perigosos", de 0h às 24h; art. 2º
  indica as alternativas (Segunda Ponte, Rod. Darly Santos/ES-471, Av. Carlos Lindenberg); art. 3º cita o CTB,
  arts. 187 e 231, IV.

### 1.1 Terceira Ponte: aplicada, com nota de vigência

A pesquisa dá confiança **alta** à IS 021-N/2004 e o `verify.json` a marca como **confirmed**: o PDF do DER-ES foi
lido (art. 1º, g: "Todos veículos transportando produtos perigosos", 0h às 24h) e a página de legislação do órgão
ainda lista a IS, sem revogação localizada. A convenção da frente só desativa regra de confiança baixa ou não
verificável, então a regra entra com `ativa: true` e `situacao: 'vigente'` e vira `costLine` para qualquer veículo
com PP. Isso atende à recomendação P1 da pesquisa: o caminhão leve e o utilitário com PP, que a `hgv:conditional` de
peso do OSM não alcança, deixam de passar pela ponte.

A dúvida que resta (vigência não confirmada com o órgão depois do fim da concessão da Rodosol em 22/12/2023, da
gestão pela Ceturb e da ampliação da ponte) fica em `nota_vigencia` e sai no aviso `hazmat_trecho_vigencia` (info)
quando a regra pesa na rota, junto com as alternativas do art. 2º. Se o DER-ES confirmar a revogação, troque para
`ativa: false` com `situacao: 'revogada'` e `valid_to` no JSON e rode o importador.

### 1.2 Registradas e nunca aplicadas

Entram como `kind = 'regra_registrada'` (ponto de referência) ou `'zona_registrada'` (polígono), com `ativa: false`:

| Registro | Situação | Efeito |
|---|---|---|
| Res. ANTT 1.713/2006 (Ponte, classes 1, 2.1, 2.3, 3, 4, 5 e 8) | Revogada pela Res. ANTT 6.000/2022, art. 234, II, em 01/07/2024 (`valid_to`) | Nenhum (histórico) |
| Res. ANTT 5.936/2021 (acrescentou o art. 4º-A à 1.713) | `situacao: 'sem_efeito'`: o ANTTlegis a classifica como "Alteradora", não "Revogada" (correção do `verify.json`); o efeito caiu com a 1.713 em 01/07/2024 (`valid_to`). Não falava em "trajeto então utilizado" | Nenhum |
| Lei Rio 1.632/1990, art. 1º e parágrafo único (PP só das 21h às 6h no perímetro urbano) | "Em Vigor" na CMRJ, sem regulamentação nem fiscalização localizadas: confiança baixa | Aviso `hazmat_lei_municipal` (info) quando a **passagem estimada** pela cidade (entrada ou saída da área) cai entre 6h e 21h |
| Lei Rio 2.959/1999 (cargas tóxicas na Av. Brasil só das 22h às 2h, nas pistas laterais) | Pede regulamentação (art. 4º), não localizada; veto total, promulgada pela Câmara; DCM 03/01/2000 e DO Rio 18/01/2000 (data corrigida pelo `verify.json`) | Nenhum (restrição por pista lateral, que o roteador não modela) |

## 2. Como a decisão é tomada (`trechoRuleDecision`)

A ordem é a mesma para todo trecho com `regra_id`. Os trechos do DER-SP não têm os campos novos e continuam valendo
para todo PP, sem isenção.

1. **Regra inativa** (`ativa: false`, ou `situacao` revogada, suspensa ou `sem_efeito`): nunca vale.
2. **Classe** (`classRuleApplies`): vale a classe ou subclasse de risco **principal** (coluna 3 da Relação da Res.
   ANTT 5.998/2022), porque a portaria fala em "produtos perigosos relacionados nas classes indicadas" da Parte 2
   (classificação). "4" alcança 4.1, 4.2 e 4.3; "6" alcança 6.1 e 6.2; "2.1" só a 2.1. Um nº ONU com mais de uma linha
   na Relação conta com todas as classes. Carga com vários produtos: basta um na lista.
   - **Risco subsidiário** (coluna 4): quando nenhuma classe principal está na lista mas algum risco subsidiário está,
     a regra **vale** (`basis: 'subsidiario'`), pelo lado conservador. É o que manda a pesquisa (`perigosos_fora_sp`,
     recomendação P1 a: "costLine com fator 1000 só quando a carga tem classe ou risco subsidiário listado"). Na Ponte,
     entram por aí os gases 2.2 com risco subsidiário 5.1: oxigênio comprimido (ONU 1072), oxigênio líquido
     refrigerado (1073), óxido nitroso (1070) e gás oxidante comprimido, n.e. (3156). Ar comprimido (1002) e
     nitrogênio comprimido (1066), 2.2 sem risco subsidiário, continuam liberados. A rota sai com o aviso
     `hazmat_trecho_subsidiario` (info), que sugere confirmar com a PRF.
   - **Sem nº ONU** ou nº ONU fora da Relação: a regra vale (lado conservador), com o aviso `hazmat_trecho_classe`
     dizendo quais classes não são proibidas ali (2.2, 7 e 9 na Ponte).
3. **Isenção da Parte 3**, só onde a norma prevê (`isencao_qtd_limitada: true`, Portaria 407/2024):
   - quantidade limitada: peso bruto informado (`hazmat_qty_kg`) **positivo** e dentro da coluna 8 (mesma conta da
     seção 1.5 de `perigosos.md`, `hz.lqExempt`). Com 0 kg a isenção não vale: é o veículo vazio não limpo nem
     descontaminado, que segue a proibição (Portaria 407/2024, art. 3º; o `verify.json` manda tratá-lo como
     proibido). A rota sai com o aviso `hazmat_trecho_vazio` (info);
   - produto "não sujeito" na Relação (provisões especiais), `hz.notSubject`.
   A Res. SMTR 2.204/2012, a IS DERTES 021-N/2004 e as portarias do DER-SP não têm essa isenção.
4. **Exceção da própria norma**, conferida por quem chama (`exceptionOk`): hoje só a de Mocanguê.

### 2.1 Na rota

- O `plan()` busca os trechos no corredor (elipse origem–destino, como os do DER) e decide uma vez por regra. Só os
  pedaços de regra que **vale para o veículo** viram `costLines` (fator 1000, "proibido salvo sem alternativa").
- Todos os pedaços da mesma regra (sentidos, alças) levam o mesmo id (`trecho-<regra_id>`), o mesmo nome (`via`) e o
  mesmo ponto de referência: em "evitado" a regra aparece uma vez.
- Origem ou destino dentro da regra **não exclui**: como é `costLine`, a rota sai e o `routing.ts` avisa
  `uses_restricted_way` (danger); a camada acrescenta `hazmat_trecho_lindeiro` com as exceções do ato.
- Quando o tileset do Valhalla muda (reconstrução dos tiles), os traçados são recasados em tempo de execução
  (`rematchRows`), só no sentido do tráfego (o traçado já é exato; os trechos do DER continuam casados nos dois
  sentidos):
  - o `trace_route` usa o **costing gravado na importação** (`props.osm.costing`, o da `selecao`). Com `truck`, a
    Linha Vermelha (`hgv=no`) não casa: um pedaço de 2.157 m voltava com 14 m;
  - o traçado exato da importação entra como **reserva** no mesmo edge walk: se a malha não mudou ali, ele passa como
    está;
  - sem traçado válido, o pedaço de regra fora de SP **fica de fora** da rota e a regra entra em `semTracado`, com o
    aviso `hazmat_layer_stale` (warn, id `stale-sudeste`) e `sem_tracado: true` em `data.trechos`. **Nunca vira
    exclusão**: o anel de 12 m dos trechos do DER cortaria também quem cruza ou sai da via. Na Linha Vermelha isso
    deixava sem rota qualquer veículo com PP indo para a Ilha do Governador/Galeão ou para a Ilha do Fundão ("No
    path could be found"), e contrariava as regras da frente (via → `costLine`; origem ou destino dentro da regra
    não bloqueia). Se a rota passar mesmo assim pela via, sai `hazmat_trecho_usado` (danger).

### 2.2 Veículos que não são caminhão

A regra de PP vale para **qualquer** veículo com PP (`vehicle.hazmat`), caminhão ou não: a Res. 2.204/2012 proíbe
"veículos transportando produtos perigosos". No OSM a Linha Vermelha já tem `hgv=no` em 79 de 87 ways, o que tira o
caminhão comum da via; a `costLine` cobre as 8 ways sem a etiqueta e vale também para o utilitário (3,5 t). Hoje a
API usa o costing `truck` para todos os perfis, então o utilitário também respeita o `hgv=no`; se um dia houver
costing próprio para ele, a regra de PP continua garantida pela `costLine`.

### 2.3 Exceção de Mocanguê (Portaria 407/2024, art. 2º)

"Permitir o transporte dos produtos previstos no art. 1º destinados às instalações militares da Ilha de
Mocanguê": I – só entre Niterói e a Ilha de Mocanguê (ida e volta); II – das 23h às 4h e das 11h às 16h; III –
comunicando a concessionária da ponte com 24 h de antecedência. O parágrafo único tira o limite em mobilização
nacional, conflito, estado de defesa ou de sítio e intervenção federal.

- A ilha é a envoltória convexa da way OSM 10939346 ("Ilha do Mocanguê", `place=islet`; a relação 3380552, com
  `landuse=military` e `military=naval_base`, tem o mesmo contorno) com folga de 150 m; Niterói é a malha do IBGE (3303302). As duas ficam como `kind = 'area_excecao'`.
- A exceção vale quando **uma** ponta está na ilha, a **outra** em Niterói e a **saída** está numa das janelas
  (`inTimeWindows`, que trata a janela que atravessa a meia-noite). Aí a regra da ponte não vira restrição e sai o
  aviso `hazmat_mocangue` (warn), pedindo para confirmar o destino militar e o aviso prévio, que o app não confere.
- Com uma ponta na ilha fora dessas condições (outra ponta no Rio, ou fora da janela), a proibição fica. Como a
  ilha só tem acesso pela ponte, a rota sai mesmo assim (`uses_restricted_way`) e o `hazmat_mocangue` explica por que
  a exceção não se aplicou.
- O horário considerado é o de **saída** (como nas zonas): o trecho Niterói–Mocanguê tem cerca de 3 km.

## 3. Avisos e dados na resposta

| Código | Severidade | Quando |
|---|---|---|
| `hazmat_trecho_classe` | info | Regra por classe aplicada sem nº ONU (ou com nº ONU fora da Relação); lista as classes que não são proibidas ali |
| `hazmat_trecho_subsidiario` | info | Regra por classe aplicada pelo risco subsidiário (classe principal fora da lista), quando a regra pesa na rota |
| `hazmat_trecho_vazio` | info | Regra com isenção da Parte 3 e quantidade de 0 kg: tratada como vazio não limpo (art. 3º), a proibição fica |
| `hazmat_trecho_vigencia` | info | Regra aplicada com nota de vigência (Terceira Ponte), quando a regra pesa na rota; traz as alternativas do art. 2º |
| `hazmat_trecho_isento` | info | A rota passa pela ponte/Av. Portuária dentro da quantidade limitada ou com produto "não sujeito" |
| `hazmat_mocangue` | warn | Origem ou destino na Ilha de Mocanguê, com ou sem a exceção do art. 2º |
| `hazmat_regra_nao_confirmada` | warn | A rota passa (≥ 100 m) por regra registrada e desativada (hoje nenhuma das quatro vias; fica para regra futura de confiança baixa) |
| `hazmat_trecho_usado` | danger | A rota passa por regra que vale para o veículo, mas que ficou fora do corredor do plano ou sem traçado válido na malha atual (rede de segurança) |
| `hazmat_layer_stale` | warn | Pedaço de regra fora de SP sem traçado válido depois de uma reconstrução dos tiles: ficou fora do cálculo, sem desvio (id `stale-sudeste`) |
| `hazmat_lei_municipal` | info | Lei Rio 1.632/1990 (registrada, não aplicada), com a passagem estimada pela cidade (entrada ou saída) entre 6h e 21h |
| `hazmat_trecho_lindeiro` | warn | Origem/destino a até 300 m de trecho cuja regra vale para o veículo (uma vez por regra e ponta) |

"Pesa na rota" quer dizer que a rota ou a rota livre (sem as restrições) passa ≥ 100 m pela via. A passagem
estimada da Lei 1.632 usa a mesma conta do Minianel: fração da rota na primeira entrada e na última saída do
município × duração da rota, somada à hora de saída. Ex.: São José dos Campos → Caju saindo às 03h00 passa pelo Rio
das 06h51 às 07h05 e avisa; saindo às 18h00 passa das 21h51 às 22h05 e não avisa.

Resumo: com a classe liberada, a camada diz que a passagem é permitida (ex.: "Ponte Rio–Niterói (BR-101) e
acessos: carga da classe 9, fora das proibidas e sem risco subsidiário na lista (...); passagem permitida.").

`layers.perigosos.data.trechos` lista as regras no corredor ou usadas pela rota, com `regra_id`, `via`, `uf`,
`norma`, `artigo`, `situacao`, `classes_proibidas`, `aplicada`, `decisao` (`aplicada`, `inativa`,
`classe_liberada`, `qtd_limitada`, `nao_sujeito`, `excecao`), `base_classe` (`todas`, `proibida`, `subsidiario`,
`liberada`, `sem_onu`, `desconhecido`), `no_plano`, `sem_tracado` e `usado_m` (metros da rota sobre a via, buffer de
8 m em SIRGAS 2000 / UTM 23S). `data.mocangue` traz a avaliação da exceção quando uma ponta está na ilha.

O mapa mostra os pedaços como os demais trechos (`trecho_proibido`); o popup traz `regra_id`, classes, isenção,
situação e a nota do ato.

## 4. Geometria (importador)

Sem Overpass e sem PBF: tudo pelo Valhalla, como o `hazmat_minianel_vias`.

1. **Rotas-semente** (`selecao.sementes`, nos dois sentidos) desenham o eixo aproximado. Costing `auto` para a
   Linha Vermelha (`hgv=no`) e a Terceira Ponte; `truck` para a Av. Portuária (ways `service` com `access=no`,
   `motor_vehicle=yes` em parte e `hgv=designated`).
2. **Grade de `/locate`** (45 m, raio 40 m) numa faixa de ±150 m das sementes. O `/locate` devolve a aresta mais
   próxima de cada ponto, com nome OSM e geometria exata.
3. **Nome**: fica a aresta com algum nome igual ao padrão da regra (regex inteira, sem acento). Assim "Avenida
   Portuária 8 de Janeiro", outra rua do porto, fica de fora. Classe viária e uso (`road`, `ramp`, `service_road`)
   também por regra; as alças nomeadas "Ponte Rio-Niterói" entram (os "acessos" do art. 1º).
4. **Jurisdição** (Linha Vermelha): a Res. 2.204/2012 vale só no trecho sob jurisdição do Rio. A malha do IBGE do Rio
   segue a linha de costa e a via corre sobre a baía, então o corte é por **exclusão** do vizinho: sai a aresta com
   mais da metade do comprimento dentro de Duque de Caxias (IBGE 3301702) recuado 25 m. Entre o Caju e Vigário Geral a
   divisa passa entre as duas pistas (a 2–9 m de cada uma, no IBGE e no limite do OSM): as duas ficam; a oeste de
   −43,289 as duas pistas estão a 60–220 m dentro de Caxias e saem (5,3 km descartados).
5. **Encadeamento** por sentido de tráfego (fim = início, mudança de rumo < 46°; a alça que sai da pista vira cadeia
   própria), corte em pedaços de até ~2 km em fronteira de aresta e **validação no edge walk** de
   `linear_cost_factors` (o edge walk passa também nas arestas com `hgv=no`).
6. Cada pedaço grava `props.osm = {tileset, geom: true, costing}`, com o costing da `selecao`, que a API usa para
   recasar quando o tileset muda (seção 2.1).

Carga de 10/10/2026 (tileset 1791646166):

| Regra | Pedaços | Pistas |
|---|---|---|
| Ponte Rio–Niterói e acessos | 18 | 28,6 km (o OSM tem 26,5 km de motorway + 2,2 km de links com o nome) |
| Av. Portuária | 9 | 5,7 km (inclui os dois sentidos dos trechos de mão dupla) |
| Linha Vermelha (Rio) | 19 | 30,0 km (cerca de 15 km por sentido) |
| Terceira Ponte | 4 | 6,8 km |

Mais 2 `area_excecao` (Mocanguê e Niterói), 1 `zona_registrada` (Lei 1.632/1990) e 3 `regra_registrada`.

Efeito medido (13/10/2026, 14h):

- Niterói → Caju (truck 23 t): com ONU 1203 sai por 105,8 km/97 min contornando a baía (sem a restrição, 19,9 km pela
  ponte); com ONU 3082 (classe 9), ou com 300 kg de gasolina, 19,9 km pela ponte; com 0 kg de gasolina, contorna.
- Vila Velha → Vitória (utilitário 3,5 t): com ONU 1203, 18,4 km/39 min, sem a Terceira Ponte; sem PP, 5,8 km/10 min
  pela ponte.
- Av. Brasil (Caju) → Porto do Rio (truck): com ONU 3082, 5,8 km, 2,8 km deles pela Av. Portuária; com ONU 1203,
  8,7 km, só 0,5 km na via, junto ao destino (aviso `hazmat_trecho_lindeiro`).

## 5. Fontes, licenças e atualização

| Fonte | Licença |
|---|---|
| Portaria SPRF-RJ/PRF 407/2024 (DOU), Res. SMTR 2.204/2012 (DO Rio), IS DERTES 021-N/2004 (DER-ES), Res. ANTT 1.713/2006 e 5.936/2021, Leis Rio 1.632/1990 e 2.959/1999 | Atos oficiais (Lei 9.610/98, art. 8º IV) |
| Traçado das vias e contorno da Ilha de Mocanguê | ODbL — © OpenStreetMap contributors (via tiles do Valhalla) |
| Malhas municipais (Niterói, Rio, Duque de Caxias) | IBGE, dados públicos (uso livre com citação da fonte) |

A proveniência fica em `data_layer_runs` (`GET /api/sources`), com as contagens por regra em `notes`.

Rodar de novo **sempre que os tiles do Valhalla forem reconstruídos** (o traçado registra o tileset; sem isso a
API recasa em tempo de execução):

```bash
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed \
  truck-router-importer hazmat_trechos_sudeste
```

Regra nova: acrescentar em `data/raw/hazmat/trechos_sudeste_pp.json` (ato, artigo, publicação, URL, classes,
isenção, situação, `ativa` e `selecao`) e rodar o importador. Testes:

```bash
cd api && API_URL=http://localhost:3000 npx vitest run test/layers/perigosos_sudeste.test.ts
docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data/raw:/data/raw:ro --entrypoint python truck-router-importer \
  -m unittest tests.test_hazmat_trechos_sudeste -v
```

## 6. Sul e Centro-Oeste (PR, SC, RS, GO, MT, MS, DF)

Expansão de 18/10/2026, da pesquisa `docs/research/estados_sul_co/<UF>.json` e `.md` (tema "perigosos", atos relidos nos PDFs
guardados em `fontes/`). O importador não tem UF fixa: as regras novas entram no mesmo `trechos_sudeste_pp.json`, com o mesmo
`SOURCE = sudeste` e o mesmo nome de arquivo (o seed `perigosos__sudeste.sql` não fica órfão). **Só o RS tem ato estadual vigente
de trecho para produtos perigosos**; os outros seis estados não têm.

### 6.1 Regras aplicadas (RS, DAER)

| Regra (`regra_id`) | Ato e artigo | Publicação | Classes | Janela | Isenção (quantidade) | Situação |
|---|---|---|---|---|---|---|
| Rota do Sol: RSC-453 km 242,17–255,77 e ERS-486 km 0–38,66, Terra de Areia–Aratinga–São Francisco de Paula, 52,26 km (`RS-ROTA-DO-SOL`) | DN DAER 127/2019 (alterada pela DN 136/2021), arts. 1º, 2º e 6º | DOE 22/11/2019, pp. 121-122 (Res. CA 10.290/2019); vigora 30 dias depois (art. 11), isto é, desde 22/12/2019 | todas | 24h; **exceção** só para abastecer postos e estabelecimentos lindeiros, com nota fiscal/manifesto e licença ambiental, de segunda a quinta, 10h–15h (art. 2º §§ 2º-3º e art. 6º) | Não prevista | **Aplicada** |
| Estrada do Mar: ERS-389, Osório–Torres, 90,3 km (`RS-ESTRADA-DO-MAR`) | DN DAER 152/2023, art. 8º, § 2º, c/c art. 3º, §§ 2º a 4º | DOE 25/04/2023 (Res. CA 13.414/2023); vigora na publicação (art. 17) | todas | 24h; **exceção** para prestadores de serviço público, abastecimento dos postos da própria rodovia e coleta de esgoto sanitário (até 23 t, 3 eixos, 16 m, com AEC) | Não prevista | **Aplicada** |

- A DN 136/2021 só revogou o art. 4º e os incisos I e II do art. 5º da DN 127 (limites de peso/horário de carga comum): os arts. 2º e 6º, de produtos perigosos,
  seguem. A DN 94/2015 (PP de 12h de sexta a 12h de segunda e 17h–8h) foi revogada pelo art. 10 da DN 127. A DN 135/2021, art. 1º, § 4º, remete à DN 127 para PP.
- O texto "salvo lindeiros" não é modelado como exceção por rota: as duas regras são trechos de custo alto ("proibido salvo sem alternativa", como as demais),
  então quem tem origem ou destino lindeiro ainda consegue entrar, com o aviso de origem junto ao trecho (`hazmat_trecho_lindeiro`).
- Geometria: vias do OSM que o Valhalla nomeia `ERS-486`, `RSC-453` e `Rota do Sol Euclides Triches` (Rota do Sol, ~61 km no OSM contra 52,26 km do SRE; 161 pedaços,
  124,8 km nos dois sentidos) e `Estrada do Mar`, `ERS-389` e `Rodovia Nelson Gonçalves` (254 pedaços, 167,4 km nos dois sentidos), sementes de várias paradas
  para a rota seguir a rodovia e não a BR-101. Confiança "média" na extensão (o km do ato e o do OSM não coincidem).
- Resultado na rota (2026-10-13, terça): ONU 1203 e ONU 3082 de Torres a São Francisco de Paula desviam da Rota do Sol (137,3 km sem PP, 144,1 km com PP, `avoided` com a DN 127/2019);
  ONU 1203 entre dois pontos da Estrada do Mar desvia da ERS-389 (27,9 km contra 30,2 km).

### 6.2 Registrada e não aplicada

| Registro | Situação | Efeito |
|---|---|---|
| DN DAER 29/2002, art. 1º e §§ 1º-2º: caminhões com cargas da Portaria MT 204/1997 das 22h às 6h (das 15h às 6h em dias de tráfego excepcional) em RS-030 Gravataí–Osório km 0–82,47, RS-040 Viamão–Pinhal km 11,2–83,53 e RS-118 Gravataí–Viamão km 21,69–38,17 (`RS-DN-29-2002-ERS-030-040-118`, ponto em Gravataí) | `vigencia_incerta`, confiança baixa: a página do DAER ainda lista o ato, mas ele usa a nomenclatura RS-0xx e km antigos que não casam com o SRE atual, é anterior ao fim das concessões e não há prova de fiscalização do BPRv | Nenhum (só consta como `regra_registrada`); falta confirmar com o DAER e converter os km |

### 6.3 Sem regra: pendências por UF

| UF | O que a pesquisa achou | Por que não entrou |
|---|---|---|
| PR | Portaria DER/PR 702/2025, art. 2º: travessia isolada de PP no ferry de Guaratuba (janelas IMO da operadora: Guaratuba–Caiobá 09h e 13h, Caiobá–Guaratuba 08h e 12h, segunda a sexta); Portaria DER/PR 075/2023: Graciosa (PR-410) proíbe qualquer carga >= 16 t | A travessia é de balsa (a página da operadora a dava "fora de operação" em 10/10/2026) e as janelas são da operadora, não de ato; a Graciosa é limite de peso (tema de rodovias estaduais, não de PP). Nenhum ato do DER/PR ou do IAT por trecho, manancial, túnel ou ponte foi localizado ("não localizado", não "inexistente"); há só o polígono de interesse de manancial do geoserver, sem ato |
| SC | IMA: licenciamento do transporte (LAC, IN IMA 77/2020) | É licença do transportador, não restrição de trecho. O Túnel Antonieta de Barros (Florianópolis) foi cenário de simulado em jun/2026, sem ato de proibição. Res. CONSEMA 250/2024 possivelmente mais nova, não confirmada |
| GO | Lei GO 19.423/2016, art. 13 (agrotóxicos; regulamento Decreto 9.286/2018; alterada pela Lei 24.389/2026) | Remete à legislação federal de perigosos; nenhum ato por trecho |
| MT | SEMA-MT: licença LAS do transporte de PP | Licença do transportador; nenhum ato por trecho |
| MS | IMASUL: Res. SEMADE 9/2015 (alterada pela SEMADESC 118/2025); Res. AGESUL 001/2009, art. 12, § 3º (AET/CVC só de dia e sem neblina ou chuva forte) | A AGESUL vale para veículo com AET, não é regra de PP |
| DF | DER-DF: IN 17, 19 e 21/2018 (horários 6h–9h e 17h30–19h15 e proibição perto da Barragem do Paranoá) **revogadas em cadeia** pela IN 1/2019 (DODF 240, p. 32, para a de 18/12/2018); IS DETRAN 576/1984 (carga perigosa a granel, exceto GLP, na W3, setores comerciais e bancários, avenidas comerciais de Taguatinga e quadras residenciais); IBRAM IN 82/2009 (licença do transportador) | Nenhuma restrição viária vigente: a 576/1984 se baseia no Decreto federal 88.821/1983 (substituído) e tem vigência prática duvidosa, sem eixo definido para o roteador. Registrar como `regra_registrada` quando houver trecho conferido |

Para entrar ativa uma regra nova precisa de ato primário vigente conferido (como no restante da camada). Regra de estado novo: acrescentar
em `data/raw/hazmat/trechos_sudeste_pp.json` (ato, artigo, publicação, URL, classes, isenção, situação, `ativa` e `selecao` com
sementes nos dois sentidos) e rodar `hazmat_trechos_sudeste` (usa o Valhalla; no máximo 2 rotas simultâneas).

## 7. Limitações e pendências

- **Terceira Ponte:** a regra é aplicada; falta só confirmar a vigência da IS 021-N/2004 com o DER-ES/Ceturb
  (seção 1.1). Se ela tiver caído, desative no JSON e rode o importador.
- **Risco subsidiário:** a leitura conservadora (seção 2) pode desviar da Ponte uma carga que a PRF libere, como o
  oxigênio. Se a PRF disser que vale só a classe principal, basta tirar o `subsidiario` de `classRuleApplies`.
- **Reconstrução dos tiles:** depois de reconstruir, rode de novo o importador. Até lá, um pedaço que não casar fica
  fora do cálculo, com aviso (seção 2.1).
- **Acessos da ponte:** "acessos" = as ways que o OSM chama de "Ponte Rio-Niterói" (inclui as alças com esse nome).
  A "Ligação Ponte - Linha Vermelha" e as avenidas de chegada (Av. Brasil, Av. do Contorno) não entram; a Linha
  Vermelha tem regra própria.
- **Av. Portuária:** a extensão exata do "trecho que liga a Avenida Brasil ao Porto" é a das ways com esse nome no
  OSM (confiança média, como na pesquisa).
- **Vazio não limpo (art. 3º da Portaria 407):** o app não tem esse campo. Quem roda vazio sem descontaminar deve
  marcar "carga perigosa" com o nº ONU do último produto e **deixar a quantidade em branco**. Com 0 kg a camada
  também trata como vazio não limpo e mantém a proibição (seção 2, item 3), mas outras partes da camada (avisos do
  RTPP em SP) leem 0 kg como quantidade limitada.
- **Mocanguê:** vale o horário de saída; o destino militar e o aviso prévio não são conferidos (só avisados).
- **Corredor:** como nos trechos do DER, só as regras na elipse origem–destino viram restrição. Uma regra que a rota
  use fora dela gera `hazmat_trecho_usado` (danger).
- **"Evitado" e `uses_restricted_way` juntos:** quando a rota usa só parte dos pedaços de uma regra (ex.: Niterói →
  Mocanguê fora da janela), o `routing.ts` lista a regra nos dois, porque mede cada linha separadamente.
- **Fora do escopo desta frente** (achados da pesquisa, não implementados): Lei BH 8.068/2000 (autorização prévia
  da BHTrans para PP em via pública e proibição na Av. do Contorno e no perímetro dela, art. 6º — apontada pelo
  `verify.json`); a janela 23h–5h do Anel de BH (notícia de 2011, provavelmente AET de carga indivisível; não
  aplicar); mananciais de RJ/MG (APA do Rio Guandu, APA Sul RMBH, APA Vargem das Flores) como aviso de km, como a
  APRM de SP.
