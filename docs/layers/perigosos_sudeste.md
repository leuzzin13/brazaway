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
| Seed | `db/seed/layers/perigosos__sudeste.sql` (≈ 210 KB, 56 feições) |
| Testes | `api/test/layers/perigosos_sudeste.test.ts`, `importers/tests/test_hazmat_trechos_sudeste.py` |

Fonte das regras: pesquisas `docs/research/sudeste_perigosos_fora_sp` e `docs/research/sudeste_rio_capital`
(com as correções dos `verify.json`). Conferido em 10/10/2026.

## 1. Regras

| Regra (`regra_id`) | Ato e artigo | Publicação | Classes proibidas | Janela | Isenção da Parte 3 (RTPP) | Situação |
|---|---|---|---|---|---|---|
| Ponte Rio–Niterói (BR-101) e acessos (`RJ-PONTE-RIO-NITEROI`) | Portaria SPRF-RJ/PRF nº 407/2024, art. 1º e parágrafo único | DOU 22/11/2024, Seção 1, ed. 225 (portaria de 14/11/2024; art. 5º: vigência na publicação) | 1, 2.1, 2.3, 3, 4, 5, 6 e 8 | 24h | Sim (parágrafo único) | **Aplicada** |
| Av. Portuária, Av. Brasil → Porto do Rio (`RJ-AV-PORTUARIA`) | Portaria SPRF-RJ/PRF nº 407/2024, art. 4º-A | idem | as mesmas | 24h | Sim | **Aplicada** |
| Linha Vermelha, trecho no Município do Rio (`RJ-RIO-LINHA-VERMELHA`) | Res. SMTR nº 2.204/2012, art. 1º, IV | DO Rio 19/03/2012, p. 38–39 | todas | 24h (o ato não fixa horário) | Não prevista | **Aplicada** |
| Terceira Ponte, ES-060, Vitória–Vila Velha (`ES-TERCEIRA-PONTE`) | IS DERTES nº 021-N/2004, art. 1º, g, e "Horários", item 2 | DIO-ES 27/09/2004 | todas | 0h às 24h | Não prevista | **Desativada** (vigência não confirmada) |

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

### 1.1 Por que a Terceira Ponte entrou desativada

O texto foi conferido no PDF do DER-ES e a IS ainda aparece na página de legislação do órgão. Mas não há
confirmação de que continue valendo depois do fim da concessão da Rodosol (22/12/2023), da gestão temporária pela
Ceturb (projeto de lei complementar aprovado em 24/10/2023) e da ampliação da ponte. Buscas de 10/10/2026 (DER-ES,
imprensa) acharam só as regras de caminhão por peso e horário, sem menção a PP. O `verify.json` classifica a
vigência como de confiança média. Pela convenção da frente, a regra entra registrada com `ativa: false`,
`situacao: 'vigencia_nao_confirmada'` e o motivo, nunca vira restrição e só gera o aviso
`hazmat_regra_nao_confirmada` quando a rota passa pela ponte. Para ativá-la, basta confirmar o ato com o DER-ES,
trocar `ativa` para `true` no JSON e rodar o importador.

### 1.2 Registradas e nunca aplicadas

Entram como `kind = 'regra_registrada'` (ponto de referência) ou `'zona_registrada'` (polígono), com `ativa: false`:

| Registro | Situação | Efeito |
|---|---|---|
| Res. ANTT 1.713/2006 (Ponte, classes 1, 2.1, 2.3, 3, 4, 5 e 8) | Revogada pela Res. ANTT 6.000/2022, art. 234, II, em 01/07/2024 (`valid_to`) | Nenhum (histórico) |
| Res. ANTT 5.936/2021 (acrescentou o art. 4º-A à 1.713) | Alteradora da 1.713; o efeito caiu com ela (correção do `verify.json`: não falava em "trajeto então utilizado") | Nenhum |
| Lei Rio 1.632/1990, art. 1º e parágrafo único (PP só das 21h às 6h no perímetro urbano) | "Em Vigor" na CMRJ, sem regulamentação nem fiscalização localizadas: confiança baixa | Aviso `hazmat_lei_municipal` (info) quando a rota passa pelo Rio com saída entre 6h e 21h |
| Lei Rio 2.959/1999 (cargas tóxicas na Av. Brasil só das 22h às 2h, nas pistas laterais) | Pede regulamentação (art. 4º), não localizada; veto total, promulgada pela Câmara; DCM 03/01/2000 e DO Rio 18/01/2000 (data corrigida pelo `verify.json`) | Nenhum (restrição por pista lateral, que o roteador não modela) |

## 2. Como a decisão é tomada (`trechoRuleDecision`)

A ordem é a mesma para todo trecho com `regra_id`. Os trechos do DER-SP não têm os campos novos e continuam valendo
para todo PP, sem isenção.

1. **Regra inativa** (`ativa: false`, ou `situacao` revogada/suspensa): nunca vale.
2. **Classe** (`classRuleApplies`): vale a classe ou subclasse de risco **principal** (coluna 3 da Relação da Res.
   ANTT 5.998/2022), porque a portaria fala em "produtos perigosos relacionados nas classes indicadas" da Parte 2
   (classificação). "4" alcança 4.1, 4.2 e 4.3; "6" alcança 6.1 e 6.2; "2.1" só a 2.1. Um nº ONU com mais de uma linha
   na Relação conta com todas as classes. Carga com vários produtos: basta um na lista.
   - O risco subsidiário não decide (ex.: oxigênio comprimido, ONU 1072, é 2.2 com risco subsidiário 5.1): o resumo
     avisa e sugere confirmar com a PRF.
   - **Sem nº ONU** ou nº ONU fora da Relação: a regra vale (lado conservador), com o aviso `hazmat_trecho_classe`
     dizendo quais classes não são proibidas ali (2.2, 7 e 9 na Ponte).
3. **Isenção da Parte 3**, só onde a norma prevê (`isencao_qtd_limitada: true`, Portaria 407/2024):
   - quantidade limitada: peso bruto informado (`hazmat_qty_kg`) dentro da coluna 8 (mesma conta da seção 1.5 de
     `perigosos.md`, `hz.lqExempt`);
   - produto "não sujeito" na Relação (provisões especiais), `hz.notSubject`.
   A Res. SMTR 2.204/2012 e as portarias do DER-SP não têm essa isenção.
4. **Exceção da própria norma**, conferida por quem chama (`exceptionOk`): hoje só a de Mocanguê.

### 2.1 Na rota

- O `plan()` busca os trechos no corredor (elipse origem–destino, como os do DER) e decide uma vez por regra. Só os
  pedaços de regra que **vale para o veículo** viram `costLines` (fator 1000, "proibido salvo sem alternativa").
- Todos os pedaços da mesma regra (sentidos, alças) levam o mesmo id (`trecho-<regra_id>`), o mesmo nome (`via`) e o
  mesmo ponto de referência: em "evitado" a regra aparece uma vez.
- Origem ou destino dentro da regra **não exclui**: como é `costLine`, a rota sai e o `routing.ts` avisa
  `uses_restricted_way` (danger); a camada acrescenta `hazmat_trecho_lindeiro` com as exceções do ato.
- Quando o tileset do Valhalla muda, os traçados são recasados em tempo de execução só no sentido do tráfego (o
  traçado já é exato; antes os trechos do DER eram casados nos dois sentidos, e continuam assim).

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
| `hazmat_trecho_isento` | info | A rota passa pela ponte/Av. Portuária dentro da quantidade limitada ou com produto "não sujeito" |
| `hazmat_mocangue` | warn | Origem ou destino na Ilha de Mocanguê, com ou sem a exceção do art. 2º |
| `hazmat_regra_nao_confirmada` | warn | A rota passa (≥ 100 m) por regra registrada e desativada (Terceira Ponte) |
| `hazmat_trecho_usado` | danger | A rota passa por regra que vale para o veículo, mas que ficou fora do corredor do plano (rede de segurança) |
| `hazmat_lei_municipal` | info | Lei Rio 1.632/1990 (registrada, não aplicada), com saída entre 6h e 21h |
| `hazmat_trecho_lindeiro` | warn | Origem/destino a até 300 m de trecho cuja regra vale para o veículo (uma vez por regra e ponta) |

Resumo: com a classe liberada, a camada diz que a passagem é permitida (ex.: "Ponte Rio–Niterói (BR-101) e
acessos: carga da classe 9, fora das proibidas (...); passagem permitida.").

`layers.perigosos.data.trechos` lista as regras no corredor ou usadas pela rota, com `regra_id`, `via`, `uf`,
`norma`, `artigo`, `situacao`, `classes_proibidas`, `aplicada`, `decisao` (`aplicada`, `inativa`,
`classe_liberada`, `qtd_limitada`, `nao_sujeito`, `excecao`), `no_plano` e `usado_m` (metros da rota sobre a via,
buffer de 8 m em SIRGAS 2000 / UTM 23S). `data.mocangue` traz a avaliação da exceção quando uma ponta está na ilha.

O mapa mostra os pedaços como os demais trechos (`trecho_proibido`); o popup traz `regra_id`, classes, isenção,
situação (a Terceira Ponte aparece como "desativada: ...") e a nota do ato.

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

Carga de 10/10/2026 (tileset 1791646166):

| Regra | Pedaços | Pistas |
|---|---|---|
| Ponte Rio–Niterói e acessos | 18 | 28,6 km (o OSM tem 26,5 km de motorway + 2,2 km de links com o nome) |
| Av. Portuária | 9 | 5,7 km (inclui os dois sentidos dos trechos de mão dupla) |
| Linha Vermelha (Rio) | 19 | 30,0 km (cerca de 15 km por sentido) |
| Terceira Ponte (desativada) | 4 | 6,8 km |

Mais 2 `area_excecao` (Mocanguê e Niterói), 1 `zona_registrada` (Lei 1.632/1990) e 3 `regra_registrada`.

Efeito medido (truck 23 t, 13/10/2026 14h): Niterói → Caju com ONU 1203 sai por 105,8 km/97 min contornando a baía
(sem a restrição, 19,9 km pela ponte); com ONU 3082 (classe 9), ou com 300 kg de gasolina, 19,9 km pela ponte.

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

## 6. Limitações e pendências

- **Terceira Ponte:** confirmar a vigência da IS 021-N/2004 com o DER-ES/Ceturb (seção 1.1).
- **Acessos da ponte:** "acessos" = as ways que o OSM chama de "Ponte Rio-Niterói" (inclui as alças com esse nome).
  A "Ligação Ponte - Linha Vermelha" e as avenidas de chegada (Av. Brasil, Av. do Contorno) não entram; a Linha
  Vermelha tem regra própria.
- **Av. Portuária:** a extensão exata do "trecho que liga a Avenida Brasil ao Porto" é a das ways com esse nome no
  OSM (confiança média, como na pesquisa).
- **Vazio não limpo (art. 3º da Portaria 407):** o app não tem esse campo; quem roda vazio sem descontaminar deve
  marcar "carga perigosa" com o nº ONU do último produto.
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
