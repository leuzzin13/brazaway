# Camada `pedagio` — praças, tarifa por veículo e alternativa sem pedágio

Arquivos: `api/src/layers/pedagio.layer.ts`, `api/src/services/tollCost.ts`,
`importers/sources/toll_antt.py`, `toll_artesp.py`, `toll_osm.py`, testes em `api/test/layers/pedagio.test.ts`.

A camada **não bloqueia nem penaliza nada**. Depois da rota calculada, ela:

1. lista as praças/pórticos por onde a rota passa, **no sentido em que a rota passa**;
2. calcula o valor de cada uma para o veículo (eixos cobrados, rodagem, dia da semana, TAG quando a tabela traz);
3. soma o total e compara com a **rota sem pedágio** (diferença em R$, km e min);
4. mostra fonte e data de cada tarifa e avisa quando o valor é estimado, desconhecido ou possivelmente defasado.

## Fontes e licenças

| Fonte | O que traz | Licença | Registros (09/10/2026) |
|---|---|---|---|
| ANTT CKAN `praca-de-pedagio` (dados.antt.gov.br) | praças federais concedidas: concessionária, rodovia, km, sentido, lat/lon. Sem tarifa | CC-BY | 277 linhas → 236 pontos (as 93 linhas de free flow, pares entrada/saída, viram 1 ponto por pórtico de entrada) |
| ANTT páginas "tarifas-de-pedagio" por concessão (gov.br/antt) | tabela por categoria: eixos, rodagem, multiplicador, valor por praça (algumas com coluna FDS) e data "Atualizado em" | CC BY-ND 3.0 (rodapé gov.br) | 103 praças com tarifa; 7 concessões com página 404 (Litoral Sul, Planalto Sul, Ecovias Rio Minas, EPR Via Mineira, Rota Verde Goiás, Via Campo, Via Cristais) |
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
5. **Reserva OSM.** Sem tarifa oficial, usa a `charge` do nó (ex.: `14.50BRL/hgv/axle`, ou `Mo-Fr …;Sa-Su …`), marcada
   como **estimada** e com a data `check_date`.
6. Cabine do OSM sem tarifa, sem rodovia e sem praça oficial perto (estacionamento, condomínio) é ignorada.
7. **Praças "possíveis".** Praça oficial a até 60 m da rota sem nenhum nó de pedágio do OSM a até 300 m (lacuna do mapa)
   é listada à parte, **sem somar**. Se o OSM tem cabine perto e a rota não passou por ela, a rota não cruza a cabine
   (pista oposta, alça ou viaduto sobre a praça).

### Valor por veículo (`tollCost.ts`)

- **Eixos cobrados** = `axle_count − suspended_axles` (mínimo 2). Base legal: Lei 13.103/2015, art. 17 (redação da
  Lei 13.711/2018): "Em todo o território nacional, os veículos de transporte de cargas que circularem vazios ficarão
  isentos da cobrança de pedágio sobre os eixos que mantiverem suspensos"; §3º: consideram-se vazios os que passam na
  praça com eixo suspenso, sujeito a fiscalização. Conferido em planalto.gov.br em 09/10/2026. O resumo lembra que a
  isenção vale só com o caminhão vazio.
- **Rodagem**: `dual_wheels` (padrão: dupla, caso de caminhões e VUC). **Multiplicador** das tabelas ANTT/ARTESP:
  rodagem dupla = nº de eixos; rodagem simples 2/3/4 eixos = 1 / 1,5 / 2 (categorias 1, 3 e 5 das tabelas).
- **ANTT (categorias)**: valor da categoria com o mesmo nº de eixos e rodagem. Se o veículo tem mais eixos que a tabela
  (ex.: Régis vai até 6 eixos), usa valor por unidade de multiplicador x multiplicador e marca **estimado**.
  Coluna "FDS" (fim de semana) usada em sábado e domingo (a página não define se inclui feriados; não incluímos).
- **ARTESP (por eixo)**: COMERCIAL POR EIXO x multiplicador. Contratos novos (ViaPaulista, Entrevias) em categorias;
  com `has_toll_tag` usa a coluna AVI (TAG).
- Desconto de TAG só quando a própria tabela traz a coluna (ViaPaulista/Entrevias). Outros descontos (usuário frequente,
  descontos de TAG não tabelados) não são modelados.
- O resumo cita que o pedágio de veículo de carga é pago pelo embarcador (Vale-Pedágio, Lei 10.209/2001, art. 1º, §1º,
  conferido em planalto.gov.br em 09/10/2026).

### Alternativa sem pedágio

`noTollRoute()` chama o Valhalla com `costing_options.truck.exclude_tolls = true` e as **mesmas restrições** da rota
principal (zonas por horário, reportes que bloqueiam o veículo, exclusões e trechos penalizados das outras camadas).
Conferido no Valhalla 3.9.1 local (Lapa→Jundiaí, carreta 5 eixos): padrão 48,8 km/48 min com pedágio;
`use_tolls: 0` ainda passa no pedágio (48,9 km/53 min); `exclude_tolls` evita (59,8 km/96 min). Há teste para isso.
A doc do Valhalla diz que `exclude_tolls` permite pedágio no começo e no fim da rota; quando isso acontece
(`summary.has_toll`), o resumo avisa. Só é calculada quando a rota tem cobrança.

## Saída na rota (`layers.pedagio`)

- `summary`: total, uma linha por praça (km da rota, nome, valor, fonte e data), "possíveis", alternativa e notas legais.
- `warnings` (todos `info`): `toll_price_unknown` (ponto sem tarifa publicada, fora do total), `toll_free_flow`
  (pórtico sem cabine; prazo de 30 dias da ANTT para quem não tem TAG, conforme FAQ do free flow da ANTT, conferido em
  09/10/2026; evasão é infração grave, CTB art. 209-A), `toll_estimated`, `toll_tariff_divergence` (a tabela oficial é
  mais antiga que o valor conferido no OSM e difere dele: provável reajuste ainda não publicado na fonte; ex.: RIOSP,
  página ANTT de 29/08/2025 x OSM conferido em 01/09/2026).
- `data`: `total`, `veiculo` (eixos cobrados, suspensos, rodagem, multiplicador, TAG, fim de semana), `pracas[]`
  (nome, km na rota, valor, regra, fonte, data, url, `valor_osm`, ids), `possiveis[]`, `alternativa_sem_pedagio`
  (`delta_km`, `delta_min`, `economia`, `pedagio_na_ponta`), `divergencias_oficial_osm[]`.

Exemplo (09/10/2026, carreta 5 eixos, quarta 10h): Lapa → Jundiaí = R$ 72,50 (Campo Limpo, ARTESP 01/07/2026,
R$ 14,50/eixo); sem pedágio +11,0 km e +48 min. Na volta cobra Caieiras (R$ 72,50), não Campo Limpo.

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
- **OSM:** reimportar quando os tiles do Valhalla forem regerados (o nó da cabine tem de ser o mesmo do grafo).
- Os seeds `db/seed/layers/pedagio__*.sql` são regerados pelo runner (≈ 1 MB no total).

## Limitações conhecidas

- **Free flow da Dutra (RIOSP, km 205–231):** a tarifa é por par entrada/saída e não está publicada em tabela aberta;
  os pórticos sem `charge` no OSM entram como "tarifa não publicada" (fora do total, com aviso).
- 7 concessões federais sem página de tarifa (404) e os lotes ARTESP 30–35 (contratos novos) fora dos PDFs: valem os
  valores do OSM (estimados, com data) ou "não publicada".
- Páginas ANTT podem ficar defasadas (ex.: RIOSP "atualizado em 29/08/2025"); o aviso de divergência com o OSM mostra
  os dois valores, mas o total usa a tabela oficial.
- Mais eixos que a tabela, rodagem simples com 5+ eixos: valor estendido pela regra do multiplicador (estimado).
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
