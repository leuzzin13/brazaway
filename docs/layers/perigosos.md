# Camada `perigosos` (produtos perigosos)

A camada só age quando o veículo transporta produto perigoso (PP), ou seja, com `vehicle.hazmat = true`.
É o mesmo sinal que o resto da pilha usa: o costing do Valhalla (que respeita `hazmat=no` do OSM), os
reportes `hazmat_ban` e as zonas `hazmat_only`.

Na API, o `resolveVehicle` (`vehicle.ts`) marca `hazmat = true` sempre que vier um nº ONU reconhecível
em `hazmat_un` (inclusive uma lista, como "UN 2908 / 1017") ou `cargo_type: 'hazmat'`. Então, na
prática, qualquer um dos três campos liga a camada, e a rota nunca sai protegida pela metade. Quem
chamar `hazmatInfo()` direto com nº ONU e `hazmat: false` recebe o aviso `hazmat_flag_missing` (warn)
e nenhuma regra de PP.

Sem PP, ela não muda a rota e não anota nada. O mapa continua mostrando os trechos, as vias, as
paradas e as emergências.

| Peça | Arquivo |
|---|---|
| Módulo da API | `api/src/layers/perigosos.layer.ts` |
| Tabela ONU, grupos de SP e quantidade limitada | `api/src/services/hazmat.ts` (fonte única: `vehicle.ts` e `zones.ts` usam os grupos daqui) |
| Campos do veículo | `api/src/schemas.ts` e `api/src/services/vehicle.ts`: `hazmat_un`, `hazmat_local_delivery`, `hazmat_biodiesel`, `hazmat_qty_kg`, `rear_axle_count` |
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
portarias. Na última execução (09/10/2026) encontrou só essas duas portarias, nenhuma candidata nova.

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
da frente `core_legal`, em `restriction_zones`, agora com a exceção `hazmat_local_or_other` para os
grupos III e IV. Ver a seção 5.

### 1.3 ZMRC (Portaria SMT.GAB 137/2018, art. 35)

> "Fica autorizado na ZMRC e ZERC, no período das 10 às 16 horas, mediante AETC, o trânsito de caminhões
> de até dois eixos traseiros destinados ao transporte dos produtos perigosos de 'consumo local' e 'outros'..."
>
> "§ 2º O trânsito de 'caminhão-trator' não será autorizado para esta modalidade de transporte."

Quem aplica essa exceção é a zona ZMRC da `core_legal`. Esta camada só emite um aviso
`hazmat_zmrc` (info) quando a rota toca a ZMRC ou quando a origem ou o destino estão nela. O aviso
diz se o veículo se enquadra:

- **Sem nº ONU:** pede o nº ONU, em vez de dizer que o produto não se enquadra.
- **Grupo:** só consumo local e outros (grupos III e IV).
- **AETC:** `has_aetc`.
- **Caminhão-trator:** semirreboque e CVC nunca se enquadram (§ 2º).
- **Eixos traseiros:** usa `rear_axle_count` quando informado. Sem ele, só afirma com até 3 eixos no
  total. Com 4 ou mais (ex.: "bitruck" rígido, com 2 eixos dianteiros e 2 traseiros) ou caminhão com
  reboque, o aviso pede para conferir os eixos traseiros.

A exceção `rear_axles_le_2` do `zones.ts` também passou a usar `rear_axle_count` quando informado.

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

`hazmat_local_delivery` cobre só a condição de entrega fracionada para consumo local. O Anexo II tem
dois qualificadores, conferidos no PDF da CET:

| Nº ONU | Texto do Anexo II | Regra em `spGroup` |
|---|---|---|
| 1075 | "GLP (ENGARRAFADOS/FRACIONADO)" | É o que `hazmat_local_delivery` descreve: grupo III |
| 3082 | "(BIODIESEL, conforme estabelecido pela ABNT NBR 15512)" | Grupo III só com `hazmat_local_delivery` **e** `hazmat_biodiesel`. Sem a indicação de biodiesel, continua grupo II e o resumo explica |

Com vários nº ONU na carga, vale o grupo mais restritivo.

O `vehicle.ts` da `core_legal` (`hazmatGroupSP`, `isHazmatLocalOrOther`) passou a usar
`spGroup`/`spGroupForLoad` daqui. Assim, as exceções `hazmat_local_or_other` das zonas (ZMRC art. 35 e
zona de PP do Minianel) seguem os mesmos anexos e o mesmo qualificador do 3082.

### 1.5 Isenção por quantidade limitada (Res. ANTT 5.998/2022, Parte 3)

| Item | O que diz |
|---|---|
| 3.4.3.1 | A isenção vale para quantidade igual ou menor que a coluna 8. "Zero" quer dizer sem isenção. |
| 3.4.3.2 | Com vários produtos, vale o menor valor da coluna 8 sobre o peso bruto total. |
| 3.4.3.4 c | Dispensa "limitações quanto a itinerário, estacionamento e locais de carga e descarga". |

O peso bruto vem de `vehicle.hazmat_qty_kg` (no schema desde 09/10/2026; o formulário do front tem o
campo "Peso da carga perigosa").

O item 3.4.3.4 c dispensa as limitações de itinerário do **próprio regulamento** (RTPP). A pesquisa
da frente registra que o RTPP não cria proibição de rota: quem proíbe é o órgão da via. E as
normas do órgão da via não têm exceção por quantidade. Conferi o texto:

| Norma | Alcance | Exceção |
|---|---|---|
| Portaria SMT.GAB 051/2024, art. 3º | "veículos que transportam produtos perigosos" | Nenhuma por quantidade |
| PR/DER-164/2025, art. 2º | "veículos transportando produtos perigosos" | Nenhuma |
| SUP/DER-062/2024, art. 1º | "veículos transportando produtos perigosos" | Só a do art. 2º (estabelecimentos comerciais ou lindeiros ao trecho, com autorização da DR.1) |

Por isso, com o peso bruto informado e dentro do limite:

- as `costLines` dos trechos do DER e das vias do Minianel **continuam**, assim como os avisos do
  Minianel;
- o aviso `hazmat_limited_qty_exempt` (info) diz que as restrições municipais e do DER continuam
  valendo;
- só os avisos do RTPP são rebaixados: `hazmat_aprm` (Decreto 96.044/1988, art. 9º) vira info, e o
  resumo das paradas (art. 14) diz que a carga está dispensada da regra de estacionamento;
- `data.isento_quantidade_limitada` fica `true`.

A LETPP continua obrigatória em São Paulo (Decreto 50.446/2009, art. 5º; FAQ PMSP de 2019, itens
32 e 33).

Até a revisão de 09/10/2026, a isenção zerava o plano. Não chegou a ter efeito porque o zod
descartava `hazmat_qty_kg`, mas viraria bug quando o campo entrasse no schema (e entrou).

### 1.6 Avisos sem bloqueio

| Código | Severidade | Base |
|---|---|---|
| `hazmat_flag_missing` | warn | Nº ONU ou `cargo_type: 'hazmat'` sem `vehicle.hazmat` (só fora da API; o `resolveVehicle` já marca): nenhuma regra de PP foi aplicada |
| `hazmat_minianel_used` | danger | A rota usa vias do Minianel na janela (sem alternativa) |
| `hazmat_minianel_eta` | warn | A saída está fora da janela, mas a passagem estimada cai dentro dela |
| `hazmat_aprm` | warn (info em quantidade limitada) | km da rota em APRM. Decreto 96.044/1988, art. 9º ("deverá evitar o uso de vias em áreas ... de proteção de mananciais") |
| `hazmat_limited_qty_exempt` | info | Peso bruto dentro da quantidade limitada: dispensa só as limitações do RTPP; município e DER continuam valendo |
| `hazmat_trecho_lindeiro` | warn | Origem ou destino a até 300 m de trecho proibido. Mostra a exceção da portaria ou o Decreto 96.044, art. 12 |
| `hazmat_letpp` | info | A rota passa pelo município de SP (Decreto 50.446/2009, art. 5º) |
| `hazmat_zmrc` | info | Portaria SMT.GAB 137/2018, art. 35 e § 2º |
| `hazmat_interior_zone_missing` | info | A zona do centro expandido para PP não está cadastrada |
| `hazmat_interior_group_iii_iv` | info | A zona do centro expandido está sem a exceção `hazmat_local_or_other` e foi aplicada a grupo III ou IV (proteção caso a configuração volte atrás) |
| `hazmat_emergencias_hotspot` | info | Faixa de 2 km da rota com 3 ou mais emergências da CETESB |
| `hazmat_un_missing` / `hazmat_un_unknown` | info / warn | Nº ONU ausente ou fora da Relação |
| `hazmat_transport_prohibited` | danger | Relação ANTT: "TRANSPORTE PROIBIDO" (ONU 1798) |
| `hazmat_layer_stale` | info | Traçados que não casaram com os tiles atuais (rodar os importadores) |
| `hazmat_layer_unverified` | warn | O Valhalla não respondeu ao validar traçados (timeout, ocupado): parte das vias pode ter ficado fora; nada fica em cache |
| `hazmat_tileset_unconfirmed` | info | O `/status` do Valhalla não respondeu em duas tentativas: usados os traçados da importação |

O resumo (`layers.perigosos.summary`) traz:

- produto e grupo SP (e, no 3082 com entrega local sem biodiesel, por que ficou no grupo II);
- quantidade limitada;
- uso e horário de passagem no Minianel, ou quanto do Minianel a rota evitou (só quando o caminho
  livre usaria o anel);
- km em APRM;
- emergências a até 250 m;
- paradas de PP na rota, com o Decreto 96.044, art. 14 (descanso só em áreas determinadas).

`data` traz a mesma informação em formato estruturado. Em `data.minianel`: `usado_m`, `evitado_m`
(metros do anel no caminho livre), `vias_no_plano` (pedaços de via considerados) e a passagem
estimada. Em `data.tracados`: traçados desatualizados, sem resposta do Valhalla e tileset não
confirmado.

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
`http://valhalla:8002`; com o compose deste repositório o container se chama
`truck-router-valhalla`).

Os arquivos de `data/raw/hazmat/` foram adicionados com `git add -f`, porque o `.gitignore` ignora
`data/raw/*`.

Contagens da última carga (09/10/2026; os traçados foram casados de novo com o tileset
1791576041, o do Valhalla com elevação ANADEM):

| Tipo | Quantidade |
|---|---|
| Trechos | 2 |
| Pedaços de via do Minianel | 200 (cerca de 205 km de pistas, 12 dos 13 itens do Anexo IV) |
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

**Relação ANTT (`parse_relacao_antt.py` + `build_relacao.py`):**

- Colunas pela posição x dos rótulos "(1)".."(10)" do cabeçalho de cada página.
- Linhas pela faixa entre os fios horizontais da coluna (1): o texto das outras colunas é
  centralizado na vertical e às vezes começa acima do nº ONU, então cada palavra vai para a faixa que
  contém o seu centro.
- O número da página (isolado, acima do rodapé) fica de fora. Antes ele entrava no nº de risco da
  última linha das 125 páginas (ex.: 0054 "1", 1105 "33 15", 1250 "X338 21").
- Nome com tolerância horizontal de 1,0 pt: nas linhas justificadas o espaço entre palavras chega a
  1,4 pt, e dentro da palavra o vão é de até 0,2 pt. Com o padrão (3 pt), o pdfplumber colava
  palavras (ex.: 0133 "comnomínimo40% deágua").
- Efeitos da correção de 09/10/2026 na tabela: nº de risco de 127 nº ONU (126 com o número da página
  colado; o 3509 ficou com o "90", que pela geometria da tabela é dele), 94 nomes (inclusive
  3533–3534 e 3545–3549, que estavam deslocados), a grafia de 18 células da coluna 8 ("I L IMITADA")
  e a coluna 8 do 3534 (de vazio para "ZERO", conferido no texto do PDF; nos dois casos, sem isenção).
  A coluna 8 normalizada dos demais nº ONU não mudou.

## 3. Como a camada entra na rota

`plan(ctx)` é calculado uma vez por requisição e compartilhado entre `exclusions` e `costLines`:

1. **Trechos do DER (corredor):** só entram os trechos na elipse com focos na origem e no destino.
   A condição é d(O,p) + d(D,p) ≤ L + máx(5 km; 0,3·L).
2. **Minianel:**
   - só entra quando a janela vale no **horário de saída**, como as zonas;
   - entram **todas** as vias a até 30 km do retângulo origem–destino, sem a elipse e sem filtro pela
     rota livre. São 200 pedaços, que viram 84 linhas depois do encadeamento;
   - motivo: a ZMRC e a área interna empurram a rota restrita para o anel por caminhos longe da rota
     livre. Na revisão de 09/10/2026, com o filtro antigo (elipse + 2,5 km da rota livre), 3 de 6
     pares dentro de SP às 08h saíam por vias do Minianel que nunca viraram `costLine`, embora
     houvesse alternativa. Exemplo: Butantã→Mooca, 3,7 km na Marginal Tietê. Agora a rota evita o
     anel (91,8 km), e o teste `perigosos.test.ts` cobre esse caso.
3. **Quantidade limitada:** não muda o plano (seção 1.5).
4. **Traçados:**
   - se `props.osm.tileset` é o tileset atual, os traçados da importação são usados;
   - se não, a camada casa de novo em tempo de execução (`trace_route`, 8 em paralelo, cache por
     tileset) e valida tudo no edge walk com uma rota de prova, por bisseção. Um traçado inválido
     derrubaria a rota inteira (Valhalla erro 233);
   - um trecho de rodovia sem traçado válido vira exclusão de 12 m em volta da geometria da fonte;
   - uma via do Minianel sem traçado válido só gera aviso: `hazmat_layer_stale` quando o dado está
     desatualizado, `hazmat_layer_unverified` quando o Valhalla não respondeu.
5. **Falhas do Valhalla:**
   - o `/status` é tentado duas vezes. Uma falha não entra no cache; sem resposta, a camada usa o
     último tileset conhecido ou, sem ele, os traçados da importação, e emite
     `hazmat_tileset_unconfirmed`;
   - no recasamento, uma falha transitória (rede, timeout, 5xx, edge walk sem resposta) sai do cache
     assim que resolve, e a próxima requisição tenta de novo;
   - um traçado que não casou de verdade fica em cache por 10 minutos, não até reiniciar a API.
6. **Junção de linhas e "evitado":**
   - na pista simples (SP-008), ida e volta viram uma linha só, com retorno no fim. Ela passa no edge
     walk;
   - pedaços contíguos da mesma via do Minianel são reunidos em uma linha antes de ir para o Valhalla;
   - todas as linhas de um mesmo trecho (os dois sentidos da SP-324) e de uma mesma via do Anexo IV
     (id `minianel-anexo-iv-<item>`) levam o mesmo id. Como o `routing.ts` deduplica "evitado" e os
     avisos por id, cada via aparece uma vez só.

**Desempenho:** o `routing.ts` mede, para cada `costLine`, se as rotas livre e restrita a usam
(`usesCostLine`). Antes, cada ponto amostrado percorria a rota inteira com
`turf.nearestPointOnLine`: com as 84 linhas do Minianel numa rota de 1.800 vértices, isso levava cerca
de 3 s por rota. Agora há um índice em grade da rota (células de 0,002°), e cada ponto só olha os
segmentos das células vizinhas. Com os mesmos dados, o resultado é idêntico (conferido linha a linha
em duas rotas) e o custo caiu de 3.036 ms para 8 ms, e de 1.475 ms para 46 ms. O tempo que sobra na
resposta é do Valhalla e das outras camadas. Butantã→Mooca às 08h, no ambiente compartilhado de
09/10/2026 (vários agentes rodando suítes ao mesmo tempo): 18 a 23 s com PP e cerca de 27 s sem PP
com carga moderada, e até 160 s no pico. Os testes de rota desta camada têm limite de 300 s.

## 4. Mapa

Estilo `circle`, cor `#c2410c`, ícone ☣️, a partir do zoom 8:

- **Pontos:** paradas de PP e emergências CETESB (a partir do zoom 9, com `weight`);
- **Linhas:** trechos proibidos e vias do Minianel.

O popup mostra norma, artigo, janela e exceção. Os campos `osm` e `segmentos_cetesb` não vão para o
front. APRM e município não são desenhados: servem só para os avisos.

## 5. Alinhamento com a frente `core_legal`

A `core_legal` cria a zona "Produtos perigosos — Minianel e centro expandido" (`...0003`):
`hazmat_only`, polígono do MIAN expandido 25 m, mesmas janelas e, desde 09/10/2026,
`exceptions: ["hazmat_local_or_other"]` (em `config/zmrc-rules.json` e no seed
`db/seed/0002_zones.sql`, gerado por `scripts/gen-zones-seed.py`).

| Grupo | Efeito |
|---|---|
| I e II | A zona bloqueia área e vias; as `costLines` desta camada repetem as vias (redundante, sem efeito colateral) |
| III e IV | A zona não se aplica (art. 3º parágrafo único). As vias do Anexo IV continuam proibidas pelas `costLines` desta camada |

O aviso `hazmat_interior_group_iii_iv` continua no código para o caso de a exceção sair da zona.

Os grupos vêm de uma fonte só: `hazmatGroupSP()` e `isHazmatLocalOrOther()` do `vehicle.ts` chamam o
`hazmat.ts`, que traz também a tabela ANTT, o grupo I, os qualificadores do Anexo II e a quantidade
limitada. O texto de `legal_notes` para consumo local/outros diz que o app evita só as vias do
Minianel nos horários da portaria.

## 6. Limitações e pendências

- **Horário:** como nas zonas, vale o horário de **saída**. A passagem estimada (fração da rota ×
  duração) só gera aviso (`hazmat_minianel_eta`) e não muda a rota.
- **R. Cipriano Siqueira (item 9 do Anexo IV):** no OSM a única via com esse nome é residencial, a
  cerca de 500 m do contorno da CET. Não foi incluída; a ligação entre R. Malvina Ferrara Samarone e
  R. das Juntas Provisórias tem cerca de 50 m. O importador avisa a cada execução. Conferir em campo.
- **Risco de edge walk com o Valhalla mudo:** com o Valhalla sem `/status`, a API recém-reiniciada e os
  tiles trocados depois da importação, um traçado velho pode ir para o edge walk e derrubar a rota
  (erro 233). A saída é rodar os importadores depois de cada reconstrução de tiles (seção 2).
- **Front:** uma camada tem um estilo só (`meta.style`). As emergências CETESB saem como pontos com
  `weight`, mas são desenhadas como círculos junto com linhas e paradas. Heatmap de verdade pede
  subcamadas no front ou um `*.layer.ts` separado.
- **Seeds:** os 6 `db/seed/layers/perigosos__*.sql` (cerca de 1,9 MB) são gerados pelo runner, como na
  camada `oae`, e não têm dado pessoal. A revisão pediu que a exceção à lista de arquivos da frente
  fique registrada na integração.
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
    1017 = 20 kg, 1005 = 20 kg, 1075 = 333 kg, 3082 = 1.000 kg, 2187 = 1.000 kg, 3534 = "ZERO").
  - 11 nº ONU dependem de provisão especial ("Ver PE 277") ou têm a célula vazia: sem isenção
    automática.
  - 13 são "não sujeito": a restrição continua aplicada, com aviso.
  - Ainda há nomes longos com palavras coladas em poucas linhas em que o PDF não deixa vão entre as
    palavras; a coluna 8 não é afetada.
  - Não conferi se a Res. 6.056/2024 alterou a coluna 8. A AP ANTT 7/2026 vai acrescentar nº ONU:
    reprocessar com `data/raw/hazmat/*.py`.
