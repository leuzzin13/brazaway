# Camada `altura_osm` — limites de altura/largura/peso gravados em nós do OSM

**O que resolve.** O Valhalla 3.9.1 (o do container, `3.9.1-c803bdc2f`) só lê `maxheight`/`maxwidth`/`maxweight`
em **vias** (ways). Limite gravado num **nó** — `barrier=height_restrictor`, portal/cancela com `maxheight`, ponto sob
o viaduto — é ignorado (`nodes_proc` do `lua/graph.lua` não lê essas chaves; issue aberta
https://github.com/valhalla/valhalla/issues/3487; ver `docs/research/osm_qualidade_valhalla/NOTES.md`). A rota passava
por cima dele. Esta camada aplica esses limites na rota **só para o veículo acima do limite**.

| Peça | Arquivo |
|---|---|
| Importador | `importers/sources/osm_altura_nos.py` → seed `db/seed/layers/altura_osm__osm.sql` (0,2 MB) |
| API | `api/src/layers/altura_osm.layer.ts` (`costLines`, `annotate`, `features`) |
| Testes | `api/test/layers/altura_osm.test.ts` (16 casos, junto com `lacunas_osm`) |

## Fonte e licença

- **OpenStreetMap**, extrato Geofabrik Sudeste (`data/valhalla/sudeste-latest.osm.pbf`, replicação 2026-10-08T20:21Z),
  **o mesmo PBF que gerou os tiles do Valhalla** (mesma topologia, os trechos casam com as arestas).
- Licença **ODbL 1.0 — © colaboradores do OpenStreetMap**. É dado derivado do próprio OSM, usado junto do roteamento
  OSM; fica em `data_features` (`layer_id='altura_osm'`, `source='osm'`). Nada volta para o OSM.
  Se um dia a base derivada for publicada, vale o share-alike da ODbL.

## O que o importador extrai

Nós com `maxheight`, `maxheight:physical`, `maxwidth`, `maxwidth:physical` ou `maxweight` que estão numa via
trafegável por caminhão (classes com `truck_forward=true` no `graph.lua`: motorway…tertiary, unclassified, residential,
living_street, service, road, track e links).

- Valores: `4.3`, `4,3`, `4.3 m`, `430 cm`, pés/polegadas → metros. Com `maxheight` e `maxheight:physical`, vale o menor.
  `default`, `none`, `below_default`, texto → não é número (vai para a camada `lacunas_osm`).
- Faixa válida: altura 0,5–15 m, largura 0,3–15 m; fora disso o valor é descartado (erro de digitação).
- `maxweight` em nó: número sem unidade = t (padrão OSM), vírgula decimal aceita, `kg`/`lb` convertidos; valor < 1 t ou
  número sem unidade ≥ 200 (provável kg) é suspeito e **não bloqueia**. Nós de heliponto, balança, terminal de balsa,
  elevador etc. (`amenity`, `aeroway`, `ferry`, `public_transport`, `man_made`, `highway=elevator`) não são restrição
  de trânsito e ficam de fora.
- Para cada via que passa pelo nó grava `props.lines`: o trecho da via de até **60 m para cada lado do nó, parando no
  próximo cruzamento** (nó compartilhado por 2+ vias trafegáveis) ou no fim da via, já no **sentido de circulação**
  (`oneway=yes/-1`, rotatória), densificado a cada 20 m.

Contagem (PBF de 2026-10-08): 256 nós com limite numérico; **216 em via trafegável** (165 altura, 43 limitador de
altura, 8 largura); 40 fora de via trafegável (calçada, área). Na RMSP: 106 (91 altura + 15 limitadores), batendo com a
pesquisa (107). **`maxweight` em nó: 0** — no Sudeste só existem em heliponto (4), terminal de balsa (2), elevador (2) e
balança (1); o código trata o caso se aparecer.

A maioria dos limites de altura abaixo de 4,40 m está em **garagem/estacionamento** (`highway=service`, 2,0–2,5 m).
Fora de via de serviço, no Sudeste, são 26 nós com altura < 4,40 m ou com largura (ex.: Av. Humberto de Campos 4,3 m em
São Bernardo, Av. Dom Aguirre 4,3 m em Sorocaba, Rua Anhanguera 3,7 m em Americana, Dutra 4,3 m em Volta Redonda — ver
"A conferir"); em 10 deles a própria via já tem `maxheight`, que o Valhalla aplica.

## Como entra na rota

`costLines(ctx)`:
1. Nós no corredor origem–destino (caixa com folga de 35%) que o veículo **excede**: altura/largura/peso do veículo
   **estritamente maior** que o limite (igual passa — mesma regra do Valhalla nas vias).
2. Calcula a **rota livre** (Valhalla, sem restrições) e mede, em PostGIS, quanto de cada trecho fica a 5 m e a 15 m dela.
   - Trecho que corre **paralelo** à rota livre (< 10% a 5 m, ≥ 50% a 15 m) e não é usado por ela — pista do outro sentido,
     marginal — **não vai**: o `routing.ts` mede "a rota usa o trecho" com 15 m de tolerância e daria falso "trecho
     restrito" (aconteceu na Dutra e na Humberto de Campos antes deste filtro).
   - Nó em via de serviço/estacionamento a mais de 2 km da rota livre, e nó em outra via a mais de 10% do comprimento da
     rota livre (5–30 km), **não vai** (não muda a rota e cada linha custa tempo na comparação do `routing.ts`).
3. Cada trecho vira `linear_cost_factors` com **fator 100000** (os dois sentidos em via de mão dupla). Penaliza **só a
   via**: a rua que cruza por cima/baixo do ponto continua livre (por isso não usamos `exclude_polygons`).
4. Cada trecho é validado uma vez por perfil de veículo (cache em memória): se o Valhalla não casar a linha com as
   arestas (erro 233 "Failed to edge walk", ex.: a própria via já tem `maxheight` menor), o pedido inteiro falharia;
   tentamos as duas metades e descartamos o que não casar.

**Por que 100000 e não o 1000 sugerido em `types.ts`:** o Valhalla aplica a média do fator na aresta inteira
(`custom_cost_t::avg_factor`); o trecho de ~120 m numa aresta longa de rodovia dilui o 1000, e em rota longa o Valhalla
poda vias locais no meio do caminho, então o desvio fica mais caro que o trecho "penalizado". Medido: carreta Rio→SP
com 1000 saía idêntica à rota sem fator (passava pelo nó 3908618328 da Dutra); com 100000 desvia. É o teto dos fatores
na doc do Valhalla. Continua sendo "proibido salvo sem alternativa": se não houver outro caminho, a rota passa e o
`routing.ts` avisa `uses_restricted_way` (danger).

`annotate(ctx, route)`:
- `summary`: "Desvia de N ponto(s) com limite abaixo do seu veículo…" e "N pontos com limite … na rota; M compatíveis".
- `warnings`:
  - `osm_node_tight_height` / `osm_node_tight_width` (**warn**): a rota passa por limite com folga ≤ 10 cm.
  - `osm_node_limit_on_route` (**danger**): rede de segurança — a rota passa por um nó que o veículo excede e cuja linha
    não foi enviada ao Valhalla (fora do corredor, filtro de distância, linha que não casou). Severidade igual à do
    `uses_restricted_way` do `routing.ts` para a mesma situação: o veículo excede o limite mapeado (placa/limitador).
- `data`: `na_rota` (nós percorridos, com o que o veículo excede), `evitados` (nós que a rota livre usaria),
  `enviados` (quantas linhas foram ao Valhalla e quantas foram descartadas e por quê).
- "Percorre" = algum trecho do nó com ≥ 60% a até 5 m da rota. Passar por cima/baixo do ponto não conta.

`features(bbox, {zoom})`: pontos a partir do zoom 10 (tipo, limite, via, link do nó no OSM); a partir do zoom 16
também o trecho bloqueado.

## Desempenho (medido no ambiente local)

| Rota | Sem camadas (API main) | Com a camada |
|---|---|---|
| Av. Humberto de Campos (1,3 km) | — | 0,2–0,4 s |
| SP→Rio, carreta (421 km) | 3,5 s | 4,0 s (16 linhas enviadas) |

A maior parte do custo extra é a comparação do `routing.ts` (turf, ~10 ms por linha numa rota de 400 km) e as consultas
de uso, que picam a rota (`ST_Subdivide`) e medem em UTM SIRGAS 2000 (EPSG 31978–31985) só perto de cada trecho.

## Como atualizar

Sempre que o PBF do Valhalla for atualizado (os trechos precisam casar com os tiles):

```sh
# na raiz do repo (data/valhalla/*.osm.pbf é achado sozinho); pyosmium está em importers/requirements.txt
docker compose --profile import build importer   # uma vez, para instalar o pyosmium na imagem
docker compose --profile import run --rm importer osm_altura_nos osm_lacunas
# imagem antiga sem pyosmium:
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed \
  --entrypoint sh truck-router-importer -c "pip install -q osmium==4.0.2 && python run.py osm_altura_nos osm_lacunas"
```

Leva ~1 min cada no PBF do Sudeste. `OSM_PBF=/caminho/arquivo.osm.pbf` troca o PBF (ex.: num worktree sem
`data/valhalla`). O seed é determinístico. Os `id` em `data_features` mudam a cada carga: use `props.osm_node`.
Reinicie a API depois (o cache de validação é em memória).

## Limitações e decisões

- **Sentido**: o limite do nó vale para os dois sentidos da via (não tratamos `direction=*` nem `maxheight:forward/backward`
  em nó; na prática os limitadores ficam um em cada pista).
- **Corredor**: nó fora da caixa origem–destino ou longe da rota livre não é enviado. Se a rota final passar por ele, o
  aviso `osm_node_limit_on_route` (danger) aparece, mas a rota não foi desviada.
- **`avoided` do `routing.ts`**: usa 15 m de tolerância. Com o filtro de paralelas o caso comum (pista do outro sentido)
  sumiu, mas uma linha enviada que corra paralela à rota final (não à livre) ainda pode aparecer como evitada/usada.
- **Rota longa**: como o Valhalla poda vias locais no meio de rotas longas, um nó em rodovia pode gerar desvio grande
  (Dutra 4,3 m: +38 km para carreta Rio→SP). Perto da origem/destino o desvio é local (+0,4 km no mesmo ponto).
- **Qualidade do dado**: é o que está no OSM. Nenhum nó tem `source:maxheight`; poucos têm `source`.
- `access=private`/`customers` (garagens) entram: limitam veículo alto de qualquer forma.
- **Bloqueio estrito (>)**: veículo igual ao limite passa, com aviso de pouca folga. Não somamos margem de segurança.

### A conferir (dado que muda rota de veículo legal de 4,40 m)

- Nó **3908618328**, Rodovia Presidente Dutra (pista sentido SP), Volta Redonda (-22.5329, -44.1957): `maxheight=4.3`,
  `source=signpost`, via sem `maxheight`. Faz carreta de 4,40 m desviar no sentido Rio→SP. Confirmar em campo; se for
  erro, corrigir no OSM (nota/edição com fonte própria) e reimportar.
- Nós **7867297145** e **8528811679**, Av. Humberto de Campos sob o Rodoanel (São Bernardo): limitadores de 4,3 m nas duas
  pistas (usados nos testes).

## Testes (`api/test/layers/altura_osm.test.ts`)

Caso real conferido no PBF com pyosmium: nó 7867297145 (`barrier=height_restrictor`, `maxheight=4.3`, versão 3) na way
767744222 (Av. Humberto de Campos, trunk, `oneway=yes`, sem `maxheight`).
- Valhalla puro manda a carreta de 4,40 m pelo nó (a issue #3487 reproduzida);
- pela API, a carreta desvia (passa a > 50 m do nó; `avoided` e `evitados` com o nó; a pista paralela não entra);
- truck de 4,20 m passa (aviso `osm_node_tight_height`); veículo de exatamente 4,30 m passa;
- rota longa Rio→SP: carreta desvia do nó da Dutra, truck 4,20 m passa por ele;
- `features()` devolve ponto e trecho; `exceeded()` cobre altura, largura e peso.
