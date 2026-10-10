# Camada `corredores_onibus` — faixas exclusivas e corredores de ônibus (São Paulo)

Faixas exclusivas de ônibus (com o horário de cada trecho) e corredores de ônibus da cidade de São Paulo. Caminhão
não pode trafegar nem parar na faixa no horário de funcionamento, nem no corredor em momento algum. As demais
faixas da via continuam liberadas, então a camada **avisa** e **não bloqueia** a via.

- Módulo da API: `api/src/layers/corredores_onibus.layer.ts` (grupo `restricoes`).
- Importadores: `importers/sources/geosampa_faixa_onibus.py` e `importers/sources/geosampa_corredor_onibus.py`.
- Testes: `api/test/layers/apoio_urbano.test.ts`.

## Fontes e licença

| fonte (`source`) | camada GeoSampa | o que entra | licença |
|---|---|---|---|
| `geosampa-faixa` | `geoportal:faixa_onibus` (levantamento CET) | 7.378 segmentos unidos em 1.415 trechos (exclusiva 1.348 / 723 km; reversível 42; preferencial 17; temporária 8) | CC-BY-SA 4.0 — GeoSampa/PMSP |
| `geosampa-corredor` | `geoportal:corredor_onibus` (SPTrans/EMTU) | 40 corredores "Em Operação" (220 km de eixo; inclui trechos da RMSP) | CC-BY-SA 4.0 — GeoSampa/PMSP |

`props.osm` (traçado casado com a malha do Valhalla, usado só pela penalidade opcional) é derivado do OpenStreetMap
(**ODbL 1.0**) e vai versionado no seed `corredores_onibus__geosampa-faixa.sql`, nas mesmas linhas das faixas: serve
apenas como endereço das arestas no Valhalla (`linear_cost_factors`), não é exibido nem exportado pela API. Por isso
`meta.sources` da camada declara três fontes: as duas do GeoSampa (CC-BY-SA 4.0) e o OpenStreetMap (ODbL 1.0), e
`data_layer_runs.license` registra as duas licenças. A geometria e os atributos exibidos são do GeoSampa. Nada disso
vai para o OSM.

## Regras (conferidas na fonte)

- **CTB (Lei 9.503/97) art. 184** (texto do Planalto, conferido em 09/10/2026): I — faixa da direita exclusiva, exceto
  acesso a imóveis lindeiros ou conversão à direita (leve); II — faixa da esquerda exclusiva (grave); III — faixa ou
  via exclusiva de transporte público coletivo, salvo força maior e com autorização (gravíssima, multa, apreensão e
  remoção; incluído pela Lei 13.154/2015).
- **CET, Perguntas Frequentes** (cetsp.com.br/perguntas-frequentes.aspx, cópia de 09/10/2026): transitar em faixa
  exclusiva ou corredor é infração gravíssima (enquadramento 758-70); na faixa à direita só se entra para acessar
  garagem/lote (guia rebaixada) ou no trecho **tracejado** imediatamente antes da conversão à direita; embarque e
  desembarque proibidos em todas as faixas e pistas exclusivas.
- **Horário de cada faixa:** texto livre da CET em `tx_horario_funcionamento` ("2ª a 6ª das 06-09h(C) e das
  17-20h(B); Sáb. das 06-14h", "INTEGRAL"...), interpretado em janelas semanais (1.407 de 1.415 trechos; os 8
  "BLOQUEIO NA AV PAULISTA" ficam sem janela). `(C)`/`(B)` = sentido centro/bairro.
- **Feriados e madrugada — Portaria 083/16-SMT.GAB** (transcrição publicada no Diário do Transporte em 04/10/2016,
  conferida em 09/10/2026; **não consegui abrir o texto primário** no Catálogo de Legislação Municipal):
  - art. 2º: libera os **corredores** a veículos automotores de passageiros e de uso misto nos fins de semana (15h de
    sábado às 4h de segunda), nos feriados (0h às 4h do dia seguinte) e nos demais dias das 23h às 4h; parágrafo
    único: "não será permitida a circulação de veículos de carga e de tração animal";
  - art. 3º: libera as **faixas exclusivas** (à esquerda e à direita) nos feriados, independentemente do horário da
    placa, **só para veículos automotores de passageiros e de uso misto** (§ 1º: não vale para faixa ativada como
    medida operacional; § 2º: faixa de período integral fica liberada das 0h do feriado às 4h do dia seguinte).
  - Caminhão e caminhonete são veículos **de carga** (CTB art. 96, II, b, 5 e 6). Na faixa, o caminhão fica de fora
    da liberação do art. 3º por não estar entre os veículos liberados; no corredor, pela vedação expressa do
    parágrafo único do art. 2º. A FAQ da CET remete às Portarias 083/16 e 084/16. Para caminhão a camada segue o
    horário da placa também em feriados, e o corredor vale em tempo integral.

## Como entra na rota

`annotate()`:
- mede quanto da rota corre junto a faixa (eixo a até 15 m do traçado, sobreposição ≥ 45 m e ≥ metade do trecho
  ou 150 m — cruzar a via não conta), no **sentido** em que a rota anda e na **hora estimada de passagem** (fração
  da rota × duração);
- aviso `bus_lane_active` (`warn`) com as ruas e horários e a orientação (não trafegar nem parar; à direita só para
  garagem ou no tracejado antes de virar);
- aviso `bus_corridor_on_route` (`info`) quando a rota segue ≥ 200 m ao lado de corredor (pista do canteiro
  central proibida em tempo integral);
- trecho de faixa que só existe no **outro sentido** da via (janelas vazias no sentido da rota) não entra no aviso
  nem em "fora do horário": vai só para `data.faixa_sentido_oposto_m`; faixa sem horário interpretável ("BLOQUEIO
  NA AV PAULISTA") vai para `data.faixa_sem_horario_m` e gera uma linha de resumo "confira a placa";
- aviso `destination_on_bus_lane` (`warn`) quando o destino está a até 25 m de faixa em operação na chegada (não
  parar na faixa para carga e descarga). Vale o lado em que o caminhão chega: se os últimos 60 m da rota correm junto
  à faixa (≥ 30 m dentro de 15 m), só as janelas desse sentido; se a rota chega por uma transversal, as dos dois
  sentidos (conservador);
- `data`: metros em faixa ativa, fora do horário, só no sentido oposto e sem horário; corredores; trechos (até 50)
  e o estado da penalidade.

`costLines()` — **penalidade moderada opcional, DESLIGADA por padrão**. Com `CORREDORES_ONIBUS_FATOR=<fator>`
(ex.: 1.3; aceita de >1 a 10) no ambiente da API, as faixas exclusivas/reversíveis em operação na hora estimada de
passagem (estimativa: distância em linha reta da origem × 1,3 a 20 km/h) recebem esse fator em
`linear_cost_factors`, por sentido, para o roteador preferir avenidas sem faixa no pico.

Por que desligada: o `routing.ts` atual transforma **toda** costLine que a rota usa em aviso
`uses_restricted_way` com severidade `danger` ("trecho restrito sem alternativa razoável"). Para faixa de ônibus
isso é falso — o caminhão pode usar as outras faixas. Medido com fator 1.3 (09/10/2026, 5 rotas urbanas de teste):
4 de 5 rotas ganharam de 1 a 5 avisos `danger` falsos; sem a penalidade, zero. Proposta para quem mantém o
`routing.ts`: usar `severity: cl.factor >= 10 ? 'danger' : 'info'` (ou um campo do `LayerItem` dizendo que a
restrição é parcial) — com isso dá para ligar a penalidade por padrão.

Traçados: o importador casa cada trecho com a malha (`/trace_route`, `map_snap`, por sentido) e valida cada
traçado numa chamada `/route` real (um traçado que falha no *edge walk* derruba a rota inteira com erro 233). Só
os traçados validados vão para `props.osm.lines`, marcados com o `tileset_last_modified` do Valhalla; a API só os
usa se o tileset atual for o mesmo (1.720 traçados válidos de 1.734 casados na última carga). Recompilou o
Valhalla → rode o importador de novo.

`features()`: trechos a partir do zoom 12 com tipo, lado, sentido, horário, situação agora e regra.

## Como atualizar

```sh
docker compose --profile import run --rm importer geosampa_faixa_onibus geosampa_corredor_onibus
```

O importador de faixas precisa do Valhalla (`VALHALLA_URL`, padrão `http://valhalla:8002`); sem ele as faixas
entram sem `props.osm` (tudo funciona, menos a penalidade opcional). Seeds: `corredores_onibus__geosampa-faixa.sql`
(2,9 MB) e `corredores_onibus__geosampa-corredor.sql`. Recomendado mensal (a CET altera faixas com frequência).

## Limitações e decisões

- Sentido centro/bairro (C/B) é inferido pela distância ao Marco Zero (Praça da Sé); sentidos cardeais e destinos
  nomeados ("CASTELO", "AIRTON SENNA", "INTERLAGOS") pela direção da linha. Em 144 trechos (29 em via de mão dupla,
  115 em mão única) o sentido ficou incerto e as janelas valem para os dois sentidos (conservador; numa via de mão
  única o caminhão nem anda no sentido proibido).
- Sentido pela malha, só em via de **mão única** (`tx_sentido_via_cet = ÚNICO`): 20 trechos com o sentido inferido
  trocado (só o oposto casou no `/trace_route`) e 65 com sentido incerto resolvido (os dois sentidos tentados e
  exatamente um casou no `/trace_route`). A decisão usa o casamento do `/trace_route`, não a validação do edge walk:
  uma falha técnica do edge walk (14 de 1.734 traçados na última carga) tira só a penalidade opcional daquele
  traçado, não as janelas do sentido. Em via de mão dupla nada é decidido pela malha.
- 82 trechos em vias de mão dupla não dizem o sentido (nem no horário nem em `tx_sentido_faixa_corredor`): a janela
  vale nos dois sentidos.
- A hora de passagem é estimada pela fração da rota × duração (sem trânsito real).
- Faixas "ativadas como medida operacional" (eventos, obras) não estão na base.
- Corredores: o eixo do GeoSampa é o canteiro central; a pista exclusiva normalmente já está no OSM como
  `highway=busway`/`access=no` e o Valhalla não a usa. Por isso corredor só gera aviso informativo.
- Faixa Azul (motos) não é faixa de ônibus e não entra aqui.
