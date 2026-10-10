# Camada `descanso` — PPD, áreas de descanso, SAU e paradas do OSM (Lei 13.103)

Arquivos: `api/src/layers/descanso.layer.ts` (mapa e anotação da rota), `api/src/services/restStopsData.ts`
(candidatos do plano de direção e prioridade), importadores `importers/sources/descanso_ppd.py`, `descanso_artesp.py`,
`descanso_antt.py`, `descanso_osm.py` (+ `_osm_pois.py`), testes em `api/test/layers/descanso.test.ts`.

A camada **não muda a rota**. Ela faz três coisas:

1. **Mapa** (`features`): cada ponto com ícone e cor por tipo (`properties.icon`, `properties.color`), prioridade,
   validade da certificação, vagas, serviços, horário e fonte.
2. **Plano de direção** (`rest_stops` e `driving_plan` da resposta de `POST /api/route`): os candidatos de parada
   passam a vir de todas as fontes abaixo, com prioridade **PPD válido > área de descanso de concessionária >
   posto/pátio para caminhão > SAU (apoio)**. As regras de jornada (5h30, 30 min, 11 h; Lei 13.103/2015 e STF ADI 5322)
   continuam em `restStops.ts` (`drivingPlan`, `DRIVING_RULES`) e não foram alteradas.
3. **Resumo da rota** (`layers.descanso`): quantos pontos de cada prioridade há a até 500 m da rota, os PPD e áreas
   de descanso com km e tempo de direção, PPD vencidos e trechos de mais de 5h30 de direção sem ponto de descanso.

## Fontes e licenças

| Fonte (`source`) | O que traz | Licença | Registros (09/10/2026) |
|---|---|---|---|
| Ministério dos Transportes — painel Power BI "PPDs" (`ppd-mt`), tabela `TB_Dados_PPD` | PPD **certificados** (Portaria MInfra 45/2021): portaria, **validade da certificação** (4 anos), vagas aprovadas e declaradas, chuveiros, serviços, funcionamento, CNPJ, rodovia/km, lat/lon | dado público governamental, **sem licença declarada** (a publicação da lista é obrigação legal: Lei 13.103/2015 art. 11 e CTB art. 67-C §9º); citamos a fonte | 183 (90 com validade ≥ 09/10/2026, 90 vencidos, 3 sem data); 6.206 vagas aprovadas nos válidos |
| idem, tabela `TB_Concessionarias` (`ppd-mt`, `kind = ppd_concessao`) | PPD exigidos nas concessões federais (Portaria MT 387/2024; o art. 14 dispensa a certificação): status, vagas, coordenada do PPD ou do edital | idem | 15 com coordenada (12 entregues). SP: Dutra km 95 (Pindamonhangaba, entregue, 120 vagas) e Dutra km 182 (em obras, posição do edital) |
| ARTESP — Cadastro de Ativos, "Recursos Operacionais" (`artesp`) | **Áreas de descanso** das concessões estaduais de SP e **SAU** (postos de atendimento e bases operacionais) | CC-BY | 9 áreas de descanso (10 linhas; SP-280 km 57 repetida na troca ViaOeste/Sorocabana) e 242 SAU |
| ANTT — Edificações operacionais (`antt`) | bases operacionais (SAU) das concessões federais | CC-BY | 362 SAU (Sudeste e demais UFs) |
| OpenStreetMap (`osm`, PBF do Valhalla, Sudeste) | `highway=rest_area`, `highway=services` com nome de posto/parada/rede, `amenity=truck_stop`, estacionamento de caminhão, posto com `hgv=yes` ou `fuel:HGV_diesel=yes` | ODbL 1.0 | 559 (218 rest_area, 307 services, 16 estacionamentos, 18 postos com acesso de caminhão) |
| OpenStreetMap — tabela `rest_stops` (Overpass, só Grande SP; `scripts/fetch-rest-stops.py`) | mesmos critérios, já existente | ODbL 1.0 | 101 |

Proprietário, telefone e e-mail do painel de PPD **não são baixados** (dados pessoais). Fontes e licenças ficam em
`meta.sources` e em `data_layer_runs` (`GET /api/sources`). Nada é escrito no OSM.

Não usados: XLSX "Lista de PPDs certificados" (sem coordenadas, parado em maio/2025), XLSX do DNIT (2023), app InfraBR
(sem API pública), listas de redes privadas (Graal, Frango Assado, Siga Bem: sem licença; uso só com parceria).

## Prioridade no plano de direção

| Tier | O que entra | Pode ser o descanso de 11 h? |
|---|---|---|
| 1 — PPD válido | PPD certificado com validade ≥ hoje (horário de Brasília); PPD de concessão **entregue** | sim |
| 2 — área de descanso de concessionária | ARTESP "Área de Descanso" | sim |
| 3 — posto/pátio para caminhão | OSM (rest_area, services, truck_stop, estacionamento, posto com acesso de caminhão) e **PPD com certificação vencida** | sim |
| 4 — SAU (apoio) | SAU da ANTT e da ARTESP; pontos do OSM com nome "SAU", "Base Operacional" ou "Atendimento ao Usuário" | **não** — só pausa curta |

Pontos a menos de 100 m uns dos outros são o mesmo lugar: fica o de melhor tier (empate: PPD > ARTESP > ANTT > OSM).

**Como a prioridade chega ao `drivingPlan` sem mexer nele.** O `pick()` do plano escolhe o **último elemento da
lista** entre os candidatos da janela preferida (a última 1h30 antes do limite de 5h30 ou do limite diário) e, se a
janela estiver vazia, entre todos os candidatos antes do limite. `restStopsData.ts` entrega a lista ordenada por

    escore = tempo de direção até o ponto + (4 − tier) × 1h30   (crescente)

- **dentro da janela** vence sempre o tier melhor (a diferença de bônus entre dois tiers é a largura da janela);
- **fora da janela** (janela vazia) um tier melhor só vence se estiver até 1h30 por nível antes do outro: um PPD 2 h
  antes de um posto vence; um PPD 4 h antes, não (parar cedo demais encurta o dia de direção).

**SAU nunca é o descanso de 11 h.** Depois de ordenar, o plano é simulado nos três regimes (empregado, autônomo, não
informado). Se algum descanso diário cair num SAU, esse SAU sai da lista e a simulação se repete até estabilizar. O SAU
continua valendo para a pausa de 30 min e continua no mapa e em `layers.descanso.data.apoio_sau`.

Exemplo (teste ponta a ponta): Barueri → Barra da Tijuca, 521 km, 6h30 de direção. Na janela da 1ª pausa (4h00–5h30)
há o PPD da CCR RioSP em Itatiaia (BR-116 km 319,6, 140 vagas, às 4h21) e quatro SAU depois dele. Com a lista em
ordem de posição (como era), o `pick()` ficaria com o último ponto da janela (um SAU às 5h26); com a ordem por
prioridade, fica com o PPD. Antes desta camada o trecho nem tinha candidato (`rest_stops` só cobria a Grande SP).

**Formato da resposta.** `rest_stops` e `driving_plan` mantêm todos os campos de antes. Cada parada ganhou `source`,
`tier`, `category`, `daily_rest_ok`, `vagas` e `validade`; `kind` ganhou os valores `ppd`, `ppd_concessao`,
`area_descanso` e `sau`. **`rest_stops` não vem mais ordenado pela posição na rota** (vem na ordem de prioridade do
plano): para listar por posição, ordene por `distance_km`.

## Saída na rota (`layers.descanso`)

- `summary`: contagem por prioridade a até 500 m da rota; uma linha por PPD válido/área de descanso (km, tempo de
  direção, vagas); PPD vencidos ("conta como posto com pátio, não como PPD").
- `warnings`: `rest_gap` (`info`) para cada trecho de mais de 5h30 de direção sem ponto de tier 1–3, citando os SAU do
  trecho ("serve para a pausa curta, não para o descanso de 11 h").
- `data`: `ppd_validos`, `areas_descanso`, `postos_patio`, `apoio_sau` (id, nome, categoria, tier, km na rota, tempo de
  direção até o ponto, distância da rota, vagas, validade, `descanso_11h`, fonte) e `trechos_sem_descanso`.

## Como atualizar

```bash
docker compose --profile import run --rm importer descanso_ppd descanso_artesp descanso_antt
# OSM: usa o PBF do Valhalla (data/valhalla/*.osm.pbf) ou OSM_PBF=/caminho.osm.pbf
docker compose --profile import run --rm importer descanso_osm
```

- `descanso_ppd`: consulta os endpoints públicos do Power BI (`modelsAndExploration` + `querydata`, os mesmos que o
  navegador usa ao abrir o link do painel). Se falharem, usa a última resposta em `data/cache/descanso_ppd_powerbi.json`.
  A validade é gravada como data (o painel grava meia-noite de Brasília em UTC: `1748736000000` = 31/05/2025); a API
  decide na hora se o PPD está vigente, então um PPD que vence entre duas cargas cai sozinho para o tier 3.
  Novas certificações saem no DOU (ex.: Portaria nº 857/2026); o painel costuma ser atualizado depois.
- `descanso_artesp`: `recursos.xlsx` do CKAN da ARTESP (atualizado a cada poucos meses).
- `descanso_antt`: CSV do CKAN da ANTT (URL descoberta pelo `package_show`).
- Seeds: `db/seed/layers/descanso__{ppd-mt,artesp,antt,osm}.sql` (≈ 0,6 MB no total).

## Limitações

- **Na Grande SP só há 1 PPD certificado — e vencido**: Paradouro Batistella (Guararema, BR-116 km 177, 200 vagas),
  certificação válida até 31/05/2025. Fora dele, o mais perto é o PPD de concessão da Dutra km 95 (Pindamonhangaba). O
  PPD da Dutra km 182 (Guararema/Jacareí) está em obras e aparece no mapa só com a posição do edital. No estado de SP
  há 2 PPD certificados (ambos vencidos) e 2 de concessão.
- Áreas de descanso da ARTESP **sem número de vagas** (a planilha não traz). Ocupação em tempo real não existe em
  nenhuma fonte (CTB art. 67-C §8º prevê exceção por falta de vaga, ainda sem regulamentação do Contran encontrada).
- O painel do MT é um **endpoint não documentado** do Power BI: pode mudar sem aviso. Coordenadas e vagas dos PPD são
  as declaradas no processo de certificação.
- **Sentido da via não é conferido**: um ponto a até 500 m da rota pode estar na pista contrária de uma rodovia
  duplicada (as áreas da ARTESP trazem `sentido`, mas o plano ainda não filtra por lado). Confira antes de parar.
- OSM: `highway=rest_area` e `highway=services` são usados para muita coisa no Brasil (há "rest_area" chamadas "Casa");
  `services` só entra com nome de posto/parada/rede. Bases do SAU marcadas como rest_area no OSM são reconhecidas pelo
  nome e tratadas como SAU.
- O tempo até cada ponto é proporcional à distância ao longo da rota (mesma aproximação do plano).
