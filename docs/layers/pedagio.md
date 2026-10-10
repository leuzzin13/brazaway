# Camada `pedagio` — praças, tarifa por veículo e alternativa sem pedágio

Arquivos: `api/src/layers/pedagio.layer.ts`, `api/src/services/tollCost.ts`,
`importers/sources/toll_antt.py`, `toll_artesp.py`, `toll_osm.py`, testes em `api/test/layers/pedagio.test.ts` (API)
e `importers/tests/test_pedagio_parsers.py` (parsers, sem rede nem banco).

A camada **não bloqueia nem penaliza nada**. Depois da rota calculada, ela:

1. lista as praças/pórticos por onde a rota passa, **no sentido em que a rota passa**;
2. calcula o valor de cada uma para o veículo (eixos cobrados, rodagem, dia da semana, TAG quando a tabela traz);
3. soma o total e compara com a **rota sem pedágio** (diferença em R$, km e min);
4. mostra fonte e data de cada tarifa e avisa quando o valor é estimado, desconhecido ou possivelmente defasado.

## Fontes e licenças

| Fonte | O que traz | Licença | Registros (09/10/2026) |
|---|---|---|---|
| ANTT CKAN `praca-de-pedagio` (dados.antt.gov.br) | praças federais concedidas: concessionária, rodovia, km, sentido, lat/lon. Sem tarifa | CC-BY | 277 linhas → 231 pontos: 183 praças e 48 pórticos de free flow (os pares entrada/saída da Dutra viram 1 ponto por pórtico de entrada); 5 praças repetidas por troca de concessionária descartadas (3 da CONCER, 2 da RIOSP em Seropédica, ver abaixo) |
| ANTT páginas "tarifas-de-pedagio" por concessão (gov.br/antt) e "Localização das praças de pedágio" | tabela por categoria: eixos, rodagem, multiplicador, valor por praça (algumas com coluna FDS) e data "Atualizado em" (ou "Publicado em"); a página de localização liga o nome da praça ao nº da coluna (P1, P2…) | CC BY-ND 3.0 (rodapé gov.br) | 202 pontos com tarifa oficial: 175 de 183 praças (as 8 restantes são de concessões com cobrança suspensa) e 27 de 48 pórticos (os de ponto único, com coluna própria no quadro). Sem tarifa por pórtico: os 10 pórticos de entrada do free flow da Dutra (tarifa por par entrada/saída, não publicada) e os 11 da Rota Verde Goiás (pasta de tarifas vazia na ANTT em 09/10/2026) |
| ARTESP PDF de tarifas 2026 (vigência 01/07/2026) e PDF Entrevias (06/07/2026) | por praça: rodovia, km, PASSEIO e COMERCIAL POR EIXO; Entrevias em CAT-1..9 com Manual e AVI | Não especificada no CKAN; rodapé do portal cms.sp.gov.br: "todos os direitos reservados" | 144 linhas |
| ARTESP PDF de tarifas 2025 (vigência 01/07/2025) | só para lotes ausentes das tabelas 2026: ViaPaulista (L29), cujo contrato reajusta em novembro (vigência 23/11/2025 a 22/11/2026) | idem | 11 linhas |
| ARTESP PDF "Histórico de Tarifas (Contratos Vigentes)" | COBRANÇA uni/bidirecional e TARIFA uni/bidirecional por praça | idem | 104 praças |
| ARTESP CKAN `malha-rodoviaria` (KMZ por lote) | posição das praças ("Sistema de Arrecadação") | CC-BY | 132 linhas do PDF posicionadas pelo KMZ, 23 por rodovia+km, 55 pontos só no KMZ (sem tarifa) |
| DER-SP `pontos_1km_rodovias` (ArcGIS) | marcos de km, para posicionar praça do PDF sem par no KMZ | ver `balancas.md` | — |
| OpenStreetMap `barrier=toll_booth` / `highway=toll_gantry` | nó de cada cabine/pórtico (o mesmo extrato do Valhalla), `charge`, `check_date`, `direction` | ODbL 1.0 | 710 nós; 687 com `charge` |

As fontes ficam em `data_features` (layer_id `pedagio`, uma `source` por fonte), separadas do OSM do roteamento.
Nada disso vai para o OSM. O texto da licença ARTESP/DER-SP ("todos os direitos reservados") não é uma licença
aberta: **antes de uso comercial, pedir autorização à ARTESP ou parecer jurídico**. As tabelas ANTT estão em
CC BY-ND 3.0; usamos os valores sem alterá-los e citamos a fonte, mas a cláusula "SemDerivações" também merece parecer.

### Como o importador ANTT acha a tarifa de cada praça

1. **Página.** Tenta `<concessão>/tarifas-de-pedagio`; se não houver quadro, segue as abas ("Carregando conteúdo da aba",
   atributo `data-url`, às vezes aninhadas) e os itens de pasta; se ainda não houver, procura na página da concessão
   os links com `tarifas-de-pedag` (há `tarifas-de-pedagios`, `tarifas-de-pedagios-via-mineira`,
   `revisoes-e-reajustes/tarifas-de-pedagio`, `tarifa-de-pedagio/tarifas-de-pedagio/…`).
2. **Coluna.** Sempre pelo NOME do cabeçalho (`P5`, `P05`, `P 5`, `Praça 5`; `P8 FDS` = fim de semana), nunca pela
   posição: a EPR Litoral Pioneiro publica P1, P2, P3, P5…P9 (sem P4), e a posição dava a tarifa da praça vizinha.
3. **Nº da praça.** Do nome no CKAN (`P05 CARAMBEÍ`, `Praça 04 - Luz`, `… - P07`); senão da página "Localização das
   praças de pedágio" (mesmo nome, ou mesma rodovia e km a até 1,5 km; ex.: Ecovias Minas Goiás, `UBERABA` = P05);
   senão do texto acima do quadro (RIOSP: "P1, em Arujá/SP, P2, em cabines avançadas de Arujá…").
4. **Sem nº confiável**, só vale quadro de coluna única ou com **todas as colunas iguais em todas as linhas**
   (Autopista Fluminense: R$ 54,00 para 5 eixos nas 5 praças). Se as colunas diferem, a praça fica sem tarifa oficial
   (vale o OSM, estimado). Se a numeração do CKAN não existe no cabeçalho do quadro (Via Campo: CKAN P01–P03, quadro
   P3–P5), a numeração é ignorada para a concessão inteira.
5. **Troca de concessionária.** O CKAN lista como "Ativo" as praças da CONCER e da ELOVIAS no mesmo lugar da BR-040;
   fica a de tabela mais recente (ELOVIAS, R$ 21,00/eixo, igual ao OSM conferido em 10/11/2025; a CONCER mostrava
   R$ 14,50 de 2024). Mesma praça = mesma rodovia e km a até 3 (coordenadas a até ~3 km) **ou**, com coordenadas
   precisas, a até ~150 m mesmo com referência de km diferente: a RIOSP ainda lista "Viúva Graça Norte" (km 207,1) e
   "Viuvinha Norte" (km 208,6), a 20 m das praças P04/P05 "Viúva Graça" da ECOVIAS RIO MINAS (km 211,7/213,1, tarifa
   de 23/03/2026); ficam as da Ecovias.
6. **Pórtico de free flow de ponto único** (um pórtico cobra a passagem, como uma praça sem cabine) recebe a tarifa da
   sua coluna, achada como a de uma praça: RIOSP "Free Flow Paraty/Mangaratiba/Itaguaí" (BR-101) = P8/P9/P10 (com a
   coluna FDS); Motiva Paraná "FREE FLOW P2 MAUÁ DA SERRA" = P2; Nova 381, Nova 364, EPR Paraná e Way 262 pelo nº no
   nome. Os pares entrada/saída da Dutra (`PFE…`/`PPF…` → `PFS…`) seguem sem tarifa: ela depende do trecho percorrido.
7. **Slugs fora do padrão.** Motiva Paraná = `pr-vias`; Way-153 = `rota-sertaneja` (títulos das páginas conferidos na
   lista de concessões da ANTT em 09/10/2026).
8. **Cobrança suspensa** (`COBRANCA_SUSPENSA` no importador): o CKAN ainda lista como "Ativo" praças que não cobram.
   Elas ficam com `cobranca_suspensa` (desde, motivo, fonte) e **sem tarifa**; a API lista a praça como "cobrança
   suspensa", fora do total, e **não** usa o `charge` do OSM nela (o valor do mapa é de antes da suspensão).
   - ECOSUL (Polo de Pelotas, BR-116/BR-392/RS): contrato encerrado em 03/03/2026; sem pedágio desde 04/03/2026, com o
     DNIT administrando até a nova concessão (a ANTT publica a concessão como `ecosul-contrato-encerrado`).
   - Rodovia do Aço (BR-393/RJ): caducidade declarada pelo Decreto 12.479/2025, art. 1º (DOU de 03/06/2025, com base na
     Lei 8.987/1995, art. 38, §1º, II; texto conferido em planalto.gov.br); o DNIT assumiu em 10/06/2025 sem pedágio.
     Há disputa judicial (a concessionária tentou retomar a cobrança em Barra do Piraí com liminar do STF): o aviso
     pede para conferir se a cobrança voltou.

Conferência com o OSM (valor por eixo, mesma praça): Ecovias Rio Minas P04/P06/P07/P08/P09/P15 = OSM de 22/03/2026;
RIOSP Free Flow Itaguaí R$ 4,80/eixo (ANTT 29/08/2025) x R$ 4,90 no OSM (01/09/2026), sinalizado como divergência;
EPR Via Mineira R$ 13,60 = OSM; Ecovias Minas Goiás, Via Cristais e Way 262 com reajuste uniforme (~7–13%) sobre o OSM
mais antigo, coerente com a coluna escolhida. Os parsers têm teste unitário com o cabeçalho da Litoral Pioneiro.

**ATENÇÃO (ARTESP):** o link "Valor Atual das Tarifas" da página de pedágios da ARTESP ainda aponta para a tabela
de 01/07/2025. As tabelas 2026 estão na notícia ARTESP de 29/06/2026 ("Revisão tarifária anual das rodovias
concedidas entra em vigor em 1º de julho"; Entrevias em 6 de julho). O cabeçalho do PDF 2026 imprime "07/01/2026"
(mês/dia); a vigência usada (`2026-07-01`) vem da notícia, configurada em `PDFS` no importador.

## Como a rota é cobrada (algoritmo)

1. **Passagem pela cabine.** A polilinha do Valhalla passa exatamente pelos nós do grafo, que vêm do mesmo extrato
   OSM importado em `source='osm'`. Um nó de pedágio a até 3 m da rota = a rota passa pela cabine **naquela pista**.
   A pista do sentido oposto fica 10–60 m ao lado e não conta. Assim, praça unidirecional (só tem cabine num sentido)
   é cobrada só no sentido certo. Ex.: Bandeirantes, Campo Limpo (km 39) cobra no sentido interior e Caieiras (km 36)
   no sentido capital; Imigrantes/Anchieta cobram só na descida.
2. Em via de mão dupla com `direction` no nó, a cabine só conta se algum rumo cobrado estiver a até 120° do rumo da rota
   (convenção "a cabine olha para o tráfego que chega", conferida em 690 nós de vias de mão única, 0 contra).
3. Nós a menos de 500 m entre si ao longo da rota = uma praça (faixas da mesma praça).
4. **Tarifa oficial.** Cada praça é associada à praça oficial ANTT/ARTESP mais próxima (até 1,5 km). Mesma rodovia,
   nome parecido, tipo (praça x pórtico) e nome com o sentido certo ("Arujá Norte" indo para o norte) pesam a favor.
   Pórticos "ponto a ponto" (PaP) da ARTESP não são somados: cobram só de quem aderiu ao sistema com TAG, no lugar da praça.
   PaP = `(PaP)` ou a palavra `PaP` no nome da linha do PDF (palavra inteira: "AV. PAPA JOÃO XXIII", praças 7 e
   Leste 1 da SPMar, são praças comuns e são cobradas).
5. **Reserva OSM.** Sem tarifa oficial, usa a `charge` do nó (ex.: `14.50BRL/hgv/axle`, ou `Mo-Fr …;Sa-Su …`), marcada
   como **estimada** e com a data `check_date`.
6. Cabine do OSM sem tarifa, sem rodovia e sem praça oficial perto (estacionamento, condomínio) é ignorada.
7. **Praças "possíveis".** Praça oficial a até 60 m da rota sem nenhum nó de pedágio do OSM a até 300 m (lacuna do mapa)
   é listada à parte, **sem somar**. Se o OSM tem cabine perto e a rota não passou por ela, a rota não cruza a cabine
   (pista oposta, alça ou viaduto sobre a praça).
8. **Cobrança suspensa.** Praça oficial com `cobranca_suspensa` (ECOSUL, Rodovia do Aço; ver o importador ANTT) é
   listada como "cobrança suspensa desde …", com valor 0 e fora do total, sem usar o `charge` do OSM; aviso
   `toll_suspended` pede para conferir se a cobrança voltou.

### Valor por veículo (`tollCost.ts`)

- **Eixos cobrados** = `axle_count − suspended_axles` (mínimo 2). Base legal: Lei 13.103/2015, art. 17 (redação da
  Lei 13.711/2018): "Em todo o território nacional, os veículos de transporte de cargas que circularem vazios ficarão
  isentos da cobrança de pedágio sobre os eixos que mantiverem suspensos"; §3º: consideram-se vazios os que passam na
  praça com eixo suspenso, sujeito a fiscalização. Conferido em planalto.gov.br em 09/10/2026. O resumo lembra que a
  isenção vale só com o caminhão vazio.
- **Rodagem**: `dual_wheels` (padrão: dupla, caso de caminhões e VUC). **Multiplicador** das tabelas ANTT/ARTESP:
  rodagem dupla = nº de eixos; rodagem simples 2/3/4 eixos = 1 / 1,5 / 2 (categorias 1, 3 e 5 das tabelas).
- **ANTT (categorias)**: valor da categoria com o mesmo nº de eixos e rodagem. Só se o veículo tem MAIS eixos que o
  maior da tabela (ex.: tabela até 6 eixos, veículo com 9), usa valor por unidade de multiplicador x multiplicador e
  marca **estimado** (com TAG, aplica a razão AVI/manual da própria tabela). Categoria que falta DENTRO da faixa da
  tabela (ex.: Via Brasil P3 Trairão só publica 4 a 8 eixos) = "tarifa não encontrada" (fora do total, com aviso).
  Coluna "FDS" (fim de semana) usada em sábado e domingo (a página não define se inclui feriados; não incluímos).
- **Vigência**: tabela com `vigencia_fim` anterior à data da viagem (ex.: ViaPaulista, tabela 2025 até 22/11/2026) sai
  como **estimada**, com a observação "tabela vencida em …".
- **ARTESP (por eixo)**: COMERCIAL POR EIXO x multiplicador. Contratos novos (ViaPaulista, Entrevias) em categorias;
  com `has_toll_tag` usa a coluna AVI (TAG).
- Desconto de TAG só quando a própria tabela traz a coluna (ViaPaulista/Entrevias). Outros descontos (usuário frequente,
  descontos de TAG não tabelados) não são modelados.
- O resumo cita que o pedágio de veículo de carga é pago pelo embarcador (Vale-Pedágio, Lei 10.209/2001, art. 1º, §1º,
  conferido em planalto.gov.br em 09/10/2026).

### Alternativa sem pedágio

`noTollRoute()` chama o Valhalla com `costing_options.truck.exclude_tolls = true` e as **mesmas restrições** da rota
principal (zonas por horário, reportes que bloqueiam o veículo, exclusões e trechos penalizados das outras camadas).
As restrições não são consultadas de novo: `routing.ts` entrega às camadas, em `RouteGeom.restrictions`, os
`exclude_polygons` e `linear_cost_factors` que usou na rota principal, e a alternativa usa exatamente esses.
Sem elas (outro chamador de `noTollRoute`), a função consulta tudo de novo, em paralelo; se alguma consulta falhar, a
alternativa sai com `restricoes_parciais: true`, `restricoes_com_falha` e uma linha "Atenção" no resumo.
Teste: `api/test/layers/pedagio_sem_pedagio.test.ts` (com as restrições da rota, nenhuma consulta ao banco).
Conferido no Valhalla 3.9.1 local (Lapa→Jundiaí, carreta 5 eixos): padrão 48,8 km/48 min com pedágio;
`use_tolls: 0` ainda passa no pedágio (48,9 km/53 min); `exclude_tolls` evita (59,8 km/96 min). Há teste para isso.
A doc do Valhalla diz que `exclude_tolls` permite pedágio no começo e no fim da rota; quando isso acontece
(`summary.has_toll`), o resumo avisa. Só é calculada quando a rota tem cobrança.

**A alternativa é cobrada com a mesma regra da rota** (`plazasOnLine`, nós de pedágio do OSM a até 3 m da linha).
O `exclude_tolls` só evita o que o grafo marca como pedágio (`toll=yes` na via); pórtico free flow e algumas cabines
ficam em vias sem essa marca e o Valhalla passa por eles. Ex.: BR-101/RJ Rio Bonito → Casimiro de Abreu e RIOSP
Itaguaí: a "rota sem pedágio" passava pelas mesmas praças e o resumo prometia economizar o total. Agora:
- a alternativa não passa por nenhum ponto de cobrança → "Sem pedágio: +x km e +y min para economizar R$ …";
- passa por parte deles → "Com menos pedágio: … para economizar R$ (total − pedágio da alternativa)", com
  `pedagio_restante` (valor e pontos);
- não evita nenhum → `disponivel: false`, `motivo: 'mesmos_pontos'` e "Rota sem pedágio não encontrada: a
  alternativa calculada passa pelos mesmos pontos de cobrança …"; troca por outros pontos sem sair mais barata →
  `motivo: 'sem_economia'`.

## Saída na rota (`layers.pedagio`)

- `summary`: total, uma linha por praça (km da rota, nome, valor, fonte e data), "possíveis", alternativa e notas legais.
- `warnings` (todos `info`): `toll_price_unknown` (ponto sem tarifa nas fontes importadas, fora do total),
  `toll_suspended` (praça com cobrança suspensa, fora do total), `toll_free_flow`
  (pórtico sem cabine; prazo de 30 dias da ANTT para quem não tem TAG, conforme FAQ do free flow da ANTT, conferido em
  09/10/2026; evasão é infração grave, CTB art. 209-A), `toll_estimated`, `toll_tariff_divergence` (a tabela oficial é
  mais antiga que o valor conferido no OSM e difere dele: provável reajuste ainda não publicado na fonte; ex.: RIOSP,
  página ANTT de 29/08/2025 x OSM conferido em 01/09/2026).
- `data`: `total`, `veiculo` (eixos cobrados, suspensos, rodagem, multiplicador, TAG, fim de semana), `pracas[]`
  (nome, km na rota, valor, regra, fonte, data, url, `valor_osm`, `cobranca_suspensa`, ids), `possiveis[]`,
  `alternativa_sem_pedagio` (`disponivel`, `motivo`, `delta_km`, `delta_min`, `economia`, `pedagio_na_ponta`,
  `pedagio_restante`, `restricoes_parciais`), `divergencias_oficial_osm[]`.

Exemplos (09/10/2026, carreta 5 eixos, quarta 10h): Lapa → Jundiaí = R$ 72,50 (Campo Limpo, ARTESP 01/07/2026,
R$ 14,50/eixo); sem pedágio +11,0 km e +48 min. Na volta cobra Caieiras (R$ 72,50), não Campo Limpo.
BR-101/RJ (-22,827,-43,053 → -22,37,-41,79) = R$ 108,00 (Rio Bonito e Casimiro de Abreu, ANTT 04/09/2026; antes da
correção saía R$ 75,00 pelo OSM de 2025); a alternativa do Valhalla (+21 km) passa pelas mesmas praças, então não há
"rota sem pedágio". Rodoanel Leste (-23,54,-46,31 → -23,6677,-46,4613): Praça Leste 1, R$ 21,50.
Rio–Santos (-22,96,-44,05 → -22,86,-43,78): Free Flow Itaguaí, R$ 24,00 (ANTT, coluna P10). BR-393/RJ
(-22,47,-43,83 → -22,00,-42,90): Paraíba do Sul, "cobrança suspensa desde 10/06/2025", total R$ 0,00.

## Como atualizar

```sh
# importadores (rede do compose; o toll_osm lê data/valhalla/*.osm.pbf, o mesmo extrato dos tiles)
docker compose --profile import run --rm importer toll_osm toll_antt toll_artesp
```

- **Reajuste ARTESP (todo 1º de julho; ViaPaulista em novembro; Entrevias em data própria):** achar o PDF novo na
  notícia de revisão tarifária da ARTESP (ou na página de pedágios), pôr a URL e a vigência no topo de `PDFS` em
  `toll_artesp.py` (ou `ARTESP_PDF_TARIFAS`/`ARTESP_PDF_ENTREVIAS`) e rodar o importador. O formato do PDF muda pouco
  entre anos; o parser aceita nome da praça e rodovia em linhas vizinhas.
- **ANTT:** as páginas são relidas a cada execução (cache de 3 dias). Concessão nova: incluir o slug em `SLUG`.
  O log do importador lista as concessões sem quadro e as praças sem coluna identificada; confira-as a cada carga.
- **Testes dos parsers:** `docker run --rm -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest discover -s tests -v`.
- **OSM:** reimportar quando os tiles do Valhalla forem regerados (o nó da cabine tem de ser o mesmo do grafo).
- Os seeds `db/seed/layers/pedagio__*.sql` são regerados pelo runner (≈ 1 MB no total).

## Limitações conhecidas

- **Free flow da Dutra (RIOSP, km 205–231):** a tarifa é por par entrada/saída e não está publicada em tabela aberta;
  os pórticos sem `charge` no OSM entram como "tarifa não publicada" (fora do total, com aviso).
- Rota Verde Goiás (11 pórticos free flow; pasta de tarifas vazia na ANTT em 09/10/2026) e os lotes ARTESP 30–35
  (contratos novos) fora dos PDFs: valem os valores do OSM (estimados, com data) ou "tarifa não encontrada".
- `COBRANCA_SUSPENSA` é uma lista mantida à mão (ECOSUL, Rodovia do Aço). Se a cobrança voltar (Rodovia do Aço está em
  disputa judicial; o Polo de Pelotas terá nova concessão), tirar a concessão da lista e rodar o `toll_antt`. O quadro
  da Rodovia do Aço (sem coluna de rodagem; só "Valores a serem praticados") e o da ECOSUL (sem multiplicador) têm
  formato de 5 colunas que o parser ainda não lê.
- A associação de pórtico do OSM com o pórtico oficial não confere o sentido "crescente/decrescente" da ANTT (só o
  nome norte/sul/leste/oeste): no free flow da Dutra, o nome do pórtico listado pode ser o do sentido oposto no mesmo
  km (sem efeito no total, pois esses pórticos não têm tarifa publicada).
- A data da tarifa ANTT é a da página ("Atualizado em"/"Publicado em"), não a de início de vigência; quando o texto
  acima do quadro diz "a partir de dd/mm/aaaa", ela vai em `vigencia_inicio`.
- Páginas ANTT podem ficar defasadas (ex.: RIOSP "atualizado em 29/08/2025"); o aviso de divergência com o OSM mostra
  os dois valores, mas o total usa a tabela oficial.
- Mais eixos que a tabela: valor estendido pela regra do multiplicador (estimado). Rodagem simples com 5+ eixos não
  existe nas tabelas por categoria: fica "tarifa não encontrada" (ARTESP por eixo: estimado).
- Feriados não acionam a tarifa de fim de semana; descontos de usuário frequente não são modelados.
- A cobrança depende do nó de pedágio do OSM: praça sem nó no OSM vira "possível" (não somada). Na região do
  Valhalla (Sudeste), 178 de 210 pontos ARTESP e 93 de 164 pontos ANTT têm nó do OSM a até 300 m (o restante são,
  em boa parte, pórticos de free flow e pontos com coordenada de 2 casas decimais).
- Coordenadas de 32 praças ANTT têm só 2 casas decimais (~1 km); por isso a associação usa até 1,5 km.
- Fora do Sudeste o Valhalla local não tem grafo; os dados nacionais (ANTT) ficam prontos para quando tiver.

## Decisões

- Tarifa oficial sempre ganha do OSM no total; o OSM entra só como reserva e como sinal de reajuste.
- Sentido de cobrança resolvido pela geometria (nó na pista) em vez do campo "cobrança uni/bidirecional" das fontes:
  o histórico ARTESP marca Caieiras e Campo Limpo como "cobrança bidirecional", mas no terreno cada uma cobra um
  sentido (o par forma a cobrança nos dois sentidos). O campo é guardado em `cobranca` só como informação.
- Sem severidade `danger`/`warn`: pedágio não é restrição legal; todos os avisos são `info`.
- Praça com cobrança suspensa fica no resultado (com o motivo) em vez de sumir: o motorista vê a cabine na estrada e
  sabe por que ela não entra na conta.
- A alternativa sem pedágio reaproveita as restrições da rota (`RouteGeom.restrictions`, mudança mínima em
  `types.ts`/`routing.ts`) em vez de consultá-las de novo: mesma resposta, sem dobrar as consultas ao banco.
- Coluna de tarifa sem identificação segura = sem tarifa oficial (cai para o OSM, marcado como estimado). Preferimos
  "não encontrada"/estimado a mostrar como oficial o valor de outra praça.
- O fallback do `toll_osm` pela Overpass pede as ways com `out body geom` (com `nodes`); com `out tags geom` o nó
  ficava sem rodovia, sem `oneway` e sem rumo. O caminho normal continua sendo o `.osm.pbf` dos tiles do Valhalla
  (o `data/valhalla` de um worktree não tem o PBF: rode o importador a partir do repositório principal ou passe
  `OSM_PBF`).
