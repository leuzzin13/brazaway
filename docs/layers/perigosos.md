# Camada `perigosos` (produtos perigosos)

A camada só age quando o veículo transporta produto perigoso (PP). Isso vale se o veículo tiver
`vehicle.hazmat`, `vehicle.hazmat_un` ou `cargo_type: 'hazmat'`.

Sem PP, ela não muda a rota e não anota nada. O mapa continua mostrando os trechos, as vias, as
paradas e as emergências.

| Peça | Arquivo |
|---|---|
| Módulo da API | `api/src/layers/perigosos.layer.ts` |
| Tabela ONU, grupos de SP e quantidade limitada | `api/src/services/hazmat.ts` |
| Importadores | `importers/sources/hazmat_trechos_der.py`, `hazmat_minianel_vias.py`, `hazmat_aprm.py`, `hazmat_paradas_artesp.py`, `hazmat_municipio_sp.py` e `cetesb_emergencias.py` |
| Dados versionados | `data/raw/hazmat/` (CSV das regras e da Relação ANTT, scripts de extração) |
| Seeds | `db/seed/layers/perigosos__*.sql` |
| Testes | `api/test/layers/perigosos.test.ts` |

Não há migration nova: tudo fica em `data_features` (`layer_id = 'perigosos'`), e o número 0113
ficou sem uso.

## 1. Regras aplicadas e base legal

Conferi cada horário e cada trecho no texto da norma em 09/10/2026.

### 1.1 Trechos de rodovia proibidos para PP, 24h, nos dois sentidos

Os dois entram na rota como `costLines` com fator 1000, ou seja, só a pista é penalizada.

| Trecho | Norma | Texto conferido | Exceção |
|---|---|---|---|
| SP-008 (Rod. Arão Sahm), km 25+280 a 31+500, em Mairiporã | Portaria PR/DER-164/2025, art. 2º (DOE-SP de 08/10/2025) | "Fica igualmente proibida a circulação de veículos transportando produtos perigosos no referido trecho." O art. 1º proíbe no mesmo trecho veículo de carga com mais de 14 m. | Nenhuma prevista |
| SP-324 (Rod. Miguel Melhado Campos), km 86+620 a 90+700, em Campinas | Portaria SUP/DER-062/2024, art. 1º (DOE-SP de 01/08/2024) | "...no trecho compreendido entre o km 86+620 m e o km 90+700 m, em ambos os sentidos." | Art. 2º: veículos que vão a estabelecimentos lindeiros, se autorizados pela DR.1 |

Conferi os textos pela API do DOE-SP (`do-api-web-search.doe.sp.gov.br/v2/publications/<slug>`).

O importador também faz uma busca no DOE-SP por "produtos perigosos". Ele filtra pelo DER e por
portarias. Na última execução encontrou só essas duas portarias, nenhuma candidata nova.

Fiquei com elas porque a pesquisa (`docs/research/carga_perigosa`) não achou outra proibição do
DER/ARTESP com fonte primária. Ficaram de fora:

- **Descida da Imigrantes:** a proibição vale para todos os caminhões (Portaria ARTESP DGR/DPL-11/2002,
  citada no FAQ da Ecovias). O OSM já marca `hgv=no` e `hazmat=no`, e o Valhalla já respeita.
- **Subida da Imigrantes:** a proibição específica para PP não foi confirmada, então não entrou.

### 1.2 Minianel de São Paulo, nas vias, para todos os grupos

A regra é a Portaria SMT.GAB 051/2024, art. 3º I e Anexo IV:

> "...proibido o trânsito de veículos que transportam produtos perigosos, de segundas às sextas-feiras,
> exceto feriados, no período das 07 às 10 horas e das 17 às 20 horas: I – no minianel viário ..."

O parágrafo único libera os grupos III e IV só na área interna, "não incluindo as vias do minianel".
Por isso as vias entram como `costLines` para todos os grupos. Quem só cruza o anel por ponte ou
viaduto não é penalizado.

Exceções aplicadas:

- **Feriados:** vêm de `legalDayInfo`, tabela `holidays`.
- **Suspensões:** vêm de `rule_suspensions` com escopo `hazmat` ou `all` e `applies_to_heavy = false`.

A **área interna** (centro expandido, grupos I e II) não é desenhada aqui. Ela é a zona `hazmat_only`
da frente `core_legal`, em `restriction_zones`. Ver a seção 5.

### 1.3 ZMRC (Portaria SMT.GAB 137/2018, art. 35)

> "Fica autorizado na ZMRC e ZERC, no período das 10 às 16 horas, mediante AETC, o trânsito de caminhões
> de até dois eixos traseiros destinados ao transporte dos produtos perigosos de 'consumo local' e 'outros'..."

Quem aplica essa exceção é a zona ZMRC da `core_legal`. Esta camada só emite um aviso
`hazmat_zmrc` (info) quando a rota toca a ZMRC ou quando a origem ou o destino estão nela. O aviso
diz se o veículo se enquadra: grupo, `has_aetc` e eixos traseiros.

### 1.4 Grupos de São Paulo por nº ONU (`hazmat.ts`)

| Grupo | Origem | Nº ONU |
|---|---|---|
| I (alta periculosidade intrínseca) | Decreto 50.446/2009, art. 3º I: produtos da classificação ONU | Todos os da Relação fora dos anexos |
| II (alta frequência) | Anexo I da Portaria 051/2024 | 19 |
| III (consumo local) | Anexo II | 20 |
| IV (outros) | Anexo III | 9 |

O CSV dos anexos está em `data/raw/hazmat/portaria_smt_051_2024_anexos.csv`, transcrito do PDF da
CET.

Nove nº ONU estão nos Anexos I e II: 1072, 1073, 1075, 1170, 1202, 1203, 1977, 3082 e 3475. Para
eles:

- sem `hazmat_local_delivery`, o produto conta como grupo II, a opção mais restritiva;
- com `hazmat_local_delivery`, conta como grupo III;
- GLP a granel ("bobtail") não é consumo local (FAQ PMSP de 2019, item 31; Lei 11.368/1993, art. 3º III).

### 1.5 Isenção por quantidade limitada (Res. ANTT 5.998/2022, Parte 3)

| Item | O que diz |
|---|---|
| 3.4.3.1 | A isenção vale para quantidade igual ou menor que a coluna 8. "Zero" quer dizer sem isenção. |
| 3.4.3.2 | Com vários produtos, vale o menor valor da coluna 8 sobre o peso bruto total. |
| 3.4.3.4 c | Dispensa "limitações quanto a itinerário, estacionamento e locais de carga e descarga". |

Com o peso bruto informado e dentro do limite, a camada não gera `costLines` e emite o aviso
`hazmat_limited_qty_exempt`.

A LETPP continua obrigatória em São Paulo (Decreto 50.446/2009, art. 5º; FAQ PMSP de 2019, itens
32 e 33).

O peso bruto é lido de `vehicle.hazmat_qty_kg`, mas o campo ainda **não existe no schema**. Ver a
seção 6.

### 1.6 Avisos sem bloqueio

| Código | Severidade | Base |
|---|---|---|
| `hazmat_minianel_used` | danger | A rota usa vias do Minianel na janela (sem alternativa) |
| `hazmat_minianel_eta` | warn | A saída está fora da janela, mas a passagem estimada cai dentro dela |
| `hazmat_aprm` | warn | km da rota em APRM. Decreto 96.044/1988, art. 9º ("deverá evitar o uso de vias em áreas ... de proteção de mananciais") |
| `hazmat_trecho_lindeiro` | warn | Origem ou destino a até 300 m de trecho proibido. Mostra a exceção da portaria ou o Decreto 96.044, art. 12 |
| `hazmat_letpp` | info | A rota passa pelo município de SP (Decreto 50.446/2009, art. 5º) |
| `hazmat_zmrc` | info | Portaria SMT.GAB 137/2018, art. 35 |
| `hazmat_interior_zone_missing` | info | A zona do centro expandido para PP não está cadastrada (antes do merge da `core_legal`) |
| `hazmat_interior_group_iii_iv` | info | A zona do centro expandido foi aplicada a grupo III ou IV (ver a seção 5) |
| `hazmat_emergencias_hotspot` | info | Faixa de 2 km da rota com 3 ou mais emergências da CETESB |
| `hazmat_un_missing` / `hazmat_un_unknown` | info / warn | Nº ONU ausente ou fora da Relação |
| `hazmat_transport_prohibited` | danger | Relação ANTT: "TRANSPORTE PROIBIDO" (ONU 1798) |
| `hazmat_layer_stale` | info | Traçados que não casaram com os tiles atuais |

O resumo (`layers.perigosos.summary`) traz:

- produto e grupo SP;
- quantidade limitada;
- uso e horário de passagem no Minianel;
- km em APRM;
- emergências a até 250 m;
- paradas de PP na rota, com o Decreto 96.044, art. 14 (descanso só em áreas determinadas).

`data` traz a mesma informação em formato estruturado.

## 2. Fontes, licenças e como atualizar

| Fonte (`source`) | Importador | Licença | Atualizar |
|---|---|---|---|
| Portarias DER-SP (`der-sp`) | `hazmat_trechos_der` | Atos oficiais (Lei 9.610/98, art. 8º IV). Geometria da malha CETESB: licença **não declarada** (AccessConstraints NONE); só atribuição. O traçado casado é do OSM (ODbL). | Nova portaria: acrescentar uma linha em `data/raw/hazmat/trechos_rodovias_pp.csv` e rodar o importador. O monitor do DOE lista as candidatas em `notes`. |
| Vias do Minianel (`osm-minianel`) | `hazmat_minianel_vias` | ODbL (traçado OSM via tiles do Valhalla); contorno GeoSampa/CET; regra é ato oficial | Rodar de novo **sempre que os tiles do Valhalla forem reconstruídos** |
| APRM (`datageo-aprm`) | `hazmat_aprm` | DataGEO/SIMA: **não declarada** | Anual |
| Emergências CETESB (`cetesb`) | `cetesb_emergencias` | CETESB/DataGEO: **não declarada** | Semanal: o ano corrente é atualizado em poucos dias |
| Paradas de PP (`artesp`) | `hazmat_paradas_artesp` | CC-BY (ARTESP); nome da via do OSM | Mensal (KMZ por lote, cache de 30 dias) |
| Município de SP (`ibge`) | `hazmat_municipio_sp` | IBGE (dados públicos; citar) | Raramente |
| Relação ANTT | `data/raw/hazmat/parse_relacao_antt.py` + `build_relacao.py` | Ato oficial | Só quando a ANTT publicar nova Relação. A AP ANTT 7/2026 está em curso e acrescenta nº ONU. |

Rodar:

```bash
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed \
  truck-router-importer hazmat_trechos_der hazmat_minianel_vias hazmat_aprm cetesb_emergencias hazmat_paradas_artesp hazmat_municipio_sp
```

`hazmat_trechos_der` e `hazmat_minianel_vias` precisam do Valhalla (`VALHALLA_URL`, padrão
`http://valhalla:8002`).

Os arquivos de `data/raw/hazmat/` foram adicionados com `git add -f`, porque o `.gitignore` ignora
`data/raw/*`.

Contagens da última carga (09/10/2026):

| Tipo | Quantidade |
|---|---|
| Trechos | 2 |
| Pedaços de via do Minianel | 200 (cerca de 205 km de pistas) |
| APRM | 4 |
| Emergências de transporte rodoviário | 2.349 (2014 a 2026) |
| Paradas de PP | 48 |
| Polígono do município | 1 |
| Produtos na tabela ONU | 2.336 |

### Detalhes de georreferenciamento

**Trechos DER:**

1. Os segmentos "Eixo" da malha CETESB trazem km inicial e final. São encadeados e orientados.
2. O km da portaria é interpolado ao longo da geometria do segmento. O erro estimado fica entre 100
   e 300 m, porque a "extensão" da CETESB difere do comprimento do desenho.
3. Os pontos km 25,28 da SP-008 e km 90,7 da SP-324 coincidem com marcos da malha: início da
   jurisdição estadual e entroncamento com a SP-075.
4. O trecho é casado com o OSM nos dois sentidos (`trace_route`) e validado no edge walk.

**Vias do Minianel:**

1. Uma grade de `/locate` do Valhalla cobre uma faixa do contorno do Mini-Anel do GeoSampa, de 40 m
   para fora até 450 m para dentro. O polígono inclui as duas margens das marginais.
2. As arestas são atribuídas a um item do Anexo IV pelo nome OSM. As marginais entram "em todas as
   suas denominações": Expressa, Central, Local e os nomes oficiais de cada margem (Av. Pres.
   Castelo Branco, Embaixador Macedo Soares, Otaviano Alves de Lima, Morvan Dias de Figueiredo,
   Assis Chateaubriand, Condessa Elisabeth de Robiano, Nações Unidas, Dra. Ruth Cardoso, Magalhães
   de Castro, Via Prof. Simão Faiguenboim).
3. A distância ao contorno também conta. Alças (`ramp`) ficam fora.
4. As arestas são encadeadas por sentido e cortadas em pedaços de cerca de 2 km. Cada pedaço é
   validado no edge walk.
5. A conferência visual (Cebolão, Bandeirantes, Salim Farah Maluf, Ponte do Limão) mostrou todas as
   pistas das duas margens e nenhuma rua paralela. A R. Hungria, por exemplo, ficou fora.

## 3. Como a camada entra na rota

`plan(ctx)` é calculado uma vez por requisição e compartilhado entre `exclusions` e `costLines`:

1. **Corredor:** só entram feições na elipse com focos na origem e no destino. A condição é
   d(O,p) + d(D,p) ≤ L + máx(5 km; 0,3·L).
2. **Minianel:**
   - só entra quando a janela vale no **horário de saída**, como as zonas;
   - só entram as vias a até 2,5 km da rota livre, calculada aqui com uma chamada ao Valhalla;
   - se a rota livre atravessa a ZMRC ou o miolo do Minianel (mais de 500 m para dentro), entram
     todas as vias do corredor, porque as outras restrições podem empurrar a rota para qualquer lado
     do anel.
3. **Traçados:**
   - se `props.osm.tileset` é o tileset atual, os traçados da importação são usados;
   - se não, a camada casa de novo em tempo de execução (`trace_route`, 8 em paralelo, cache por
     tileset) e valida tudo no edge walk com uma rota de prova, por bisseção. Um traçado inválido
     derrubaria a rota inteira (Valhalla erro 233);
   - um trecho de rodovia sem traçado válido vira exclusão de 12 m em volta da geometria da fonte;
   - uma via do Minianel sem traçado válido só gera o aviso `hazmat_layer_stale`.
4. **Junção de linhas:**
   - na pista simples (SP-008), ida e volta viram uma linha só, com retorno no fim. Ela passa no edge
     walk e não duplica o item em "evitado";
   - pedaços contíguos da mesma via do Minianel são reunidos em uma linha antes de ir para o Valhalla.

## 4. Mapa

Estilo `circle`, cor `#c2410c`, ícone ☣️, a partir do zoom 8:

- **Pontos:** paradas de PP e emergências CETESB (a partir do zoom 9, com `weight`);
- **Linhas:** trechos proibidos e vias do Minianel.

O popup mostra norma, artigo, janela e exceção. Os campos `osm` e `segmentos_cetesb` não vão para o
front. APRM e município não são desenhados: servem só para os avisos.

## 5. Alinhamento com a frente `core_legal`

A `core_legal` cria a zona "Produtos perigosos — Minianel e centro expandido": `hazmat_only`,
polígono do MIAN expandido 25 m, mesmas janelas, `exceptions: []`.

Hoje, depois do merge:

| Grupo | Efeito |
|---|---|
| I e II | A zona bloqueia área e vias; as `costLines` desta camada repetem as vias (redundante, sem efeito colateral) |
| III e IV | A zona também bloqueia a área interna. É mais restritivo que a portaria, e a `core_legal` reconhece isso em `docs/layers/core_legal.md`. |

**Ajuste recomendado na `core_legal`:** pôr `"exceptions": ["hazmat_local_or_other"]` na zona
`...0003` em `config/zmrc-rules.json`. A exceção já existe no `zones.ts` dela.

Com o ajuste:

- grupos III e IV ficam liberados na área e proibidos só nas vias, pelas `costLines` desta camada;
- a camada emite `hazmat_interior_group_iii_iv` enquanto o ajuste não for feito.

Antes do merge (na `main`), a área interna não é restringida, e a camada avisa
(`hazmat_interior_zone_missing`).

A `core_legal` também tem `hazmatGroupSP()` em `vehicle.ts`, com os mesmos anexos. O `hazmat.ts`
desta frente acrescenta a tabela ANTT, o grupo I e a quantidade limitada. Vale unificar depois do
merge: `vehicle.ts` passa a chamar `hazmat.ts`.

## 6. Limitações e pendências

- **Peso bruto da carga:** `hazmat_qty_kg` não está em `schemas.ts`/`vehicle.ts` (fora desta frente);
  o zod descarta o campo. Para a isenção por quantidade limitada funcionar na rota, falta:
  - acrescentar `hazmat_qty_kg: z.number().nonnegative().optional()` em `VehicleInput`;
  - acrescentar o campo em `EXTRA_KEYS`.
  `hazmat_local_delivery` vem da `core_legal`. A camada lê os dois de forma defensiva.
- **Horário:** como nas zonas, vale o horário de **saída**. A passagem estimada (fração da rota ×
  duração) só gera aviso (`hazmat_minianel_eta`) e não muda a rota.
- **R. Cipriano Siqueira (item 9 do Anexo IV):** no OSM a única via com esse nome é residencial, a
  cerca de 500 m do contorno da CET. Não foi incluída; a ligação entre R. Malvina Ferrara Samarone e
  R. das Juntas Provisórias tem cerca de 50 m. Conferir em campo.
- **Desempenho:** o `routing.ts` mede a sobreposição de cada `costLine` com as rotas livre e restrita
  usando `turf.pointToLineDistance` geodésico, até 40 pontos por linha × todos os vértices da rota.
  - rota de PP que cruza SP na janela: 1 a 2 s;
  - desvio longo (Osasco→Penha às 08h, 77 km pelo Rodoanel): cerca de 8 s.
  A correção fica no `routing.ts`: pré-filtrar por bbox e usar distância planar, ou medir no PostGIS.
- **"Evitado":** pista dupla (SP-324) e vias do Minianel com várias linhas podem aparecer mais de
  uma vez. Os ids são distintos e o nome se repete. Deduplicar por nome no `routing.ts` ou no front.
- **Licenças:**
  - Malha CETESB, DataGEO (emergências e APRM): licença não declarada. Uso com atribuição; confirmar
    os termos com CETESB/SIMA.
  - Traçados do Minianel e casamento dos trechos: derivados do OSM (ODbL). Ficam na base da camada,
    nunca são enviados ao OSM. Publicar a base exige share-alike.
- **Lacunas de dados:**
  - portarias do DER anteriores a 2023 não têm índice público (pedir via LAI);
  - outros municípios da RMSP (exceto Guarulhos, que declara não ter regra): regra municipal de PP
    não encontrada;
  - Ponte Rio–Niterói está fora do piloto.
- **Relação ANTT:** é a versão de 2022.
  - O parse foi conferido amostralmente contra o texto do PDF (1203 = 333 kg, 1202 = 1.000 kg,
    1017 = 20 kg, 1005 = 20 kg, 1075 = 333 kg, 3082 = 1.000 kg, 2187 = 1.000 kg).
  - 12 nº ONU dependem de provisão especial ("Ver PE 277") ou têm a célula vazia: sem isenção
    automática.
  - 13 são "não sujeito": a restrição continua aplicada, com aviso.
  - Não conferi se a Res. 6.056/2024 alterou a coluna 8.
