# Camada `lacunas_osm` — altura/peso desconhecidos no mapa (informativa)

**O que é.** Fila de coleta e aviso na rota para os buracos do OSM que importam para caminhão: viaduto, passarela,
ponte ferroviária ou túnel em via principal **sem `maxheight`**, e valores duvidosos. **Nada aqui bloqueia rota.**

| Peça | Arquivo |
|---|---|
| Importador OSM | `importers/sources/osm_lacunas.py` → `db/seed/layers/lacunas_osm__osm.sql` (7,9 MB) |
| Importador Mapillary (opcional) | `importers/sources/mapillary_placas.py` → `db/seed/layers/lacunas_osm__mapillary.sql` (só com token) |
| API | `api/src/layers/lacunas_osm.layer.ts` (`annotate`, `features`) |
| Testes | `api/test/layers/altura_osm.test.ts` (bloco `lacunas_osm`) |

## Tipos (`kind`)

| kind | Regra | Sudeste | RMSP |
|---|---|---|---|
| `passagem_sem_altura` | via motorway…tertiary (com links), não-ponte, **cruzando por baixo** de ponte/viaduto/passarela/ferrovia (cruzamento geométrico, `layer` maior por cima, sem nó em comum) e sem `maxheight`. Um ponto por estrutura em cada via de baixo (cruzamentos a ≤ 25 m na mesma via viram um). Geometria = trecho de ~60 m da via de baixo centrado no cruzamento. | 11.282 | 2.547 (1.410 sob viaduto, 815 sob passarela, 308 sob ferrovia, 14 sob ponte) |
| `tunel_sem_altura` | túnel/via coberta em via principal sem `maxheight` | 1.156 | 166 |
| `altura_abaixo_padrao` | `maxheight=below_default` (há limite abaixo do legal, valor desconhecido; o Valhalla ignora) | 12 | 4 |
| `restritor_sem_valor` | `barrier=height_restrictor` sem valor, em via trafegável sem `maxheight` | 2 | 0 |
| `maxheight_suspeito` | `maxheight` numérico > 7 m (provável gabarito medido, não placa; ex.: Rodoanel 10, Anchieta 12) | 76 | 38 |
| `maxweight_suspeito` | `maxweight` < 1 t, sem unidade e ≥ 200 (provável kg) ou com vírgula (o Valhalla lê `3,5` como 3 t) | 8 | 1 |
| `placa_*_detectada` | (Mapillary, opcional) placa de altura/peso/largura/comprimento vista em imagem, **sem o valor** | — | — |

"Sem `maxheight`" = sem número em `maxheight`/`maxheight:physical` e sem `maxheight=default|none|no_indications` ou
`maxheight:signed=no` (que querem dizer "conferido, sem placa"). **Também não é lacuna** a passagem cuja via de baixo tem
um **nó** com `maxheight` numérico a até 100 m do cruzamento, nem o túnel com nó assim (a camada `altura_osm` aplica o
limite): 76 passagens saíram por isso, ex.: Av. Humberto de Campos sob o Rodoanel (limitadores de 4,3 m).

Contagem comparada à pesquisa (`docs/research/altura_sinalizacao`, `osm_qualidade_valhalla`): ela achou 1.145 locais
(motorway…secondary, cruzamentos agrupados entre vias) a 2.104 vias (principais, por via) sem `maxheight` na RMSP. Aqui
contamos por via de baixo — pista dupla conta duas vezes, uma por sentido, que é o que a rota percorre: 2.303 até
secondary (1.529 sem as passarelas).

## Na rota (`annotate`)

- Considera só o que a rota **percorre**: passagem = ≥ 60% do trecho de 60 m da via de baixo a até 5 m da rota (quem passa
  **por cima** do viaduto não conta); túnel e demais vias = 40 m ou 80% dentro do buffer; placas Mapillary a até 25 m.
  A mesma estrutura vista em dois ways de baixo (via picada sob a ponte) conta uma vez.
- Passagem com reporte colaborativo `low_clearance` ativo (score ≥ 0) a até 30 m sai de "desconhecidas" e vai para
  "reportadas".
- **Veículo com 4,0 m ou mais** (regra de produto pedida na especificação, não norma): `summary` "Altura livre
  desconhecida no mapa em N passagens da rota: …" e aviso `height_unknown_crossings` (**info**) pedindo para conferir as
  placas e reportar; limitador sem valor e `below_default` geram `height_restrictor_unknown` / `height_below_default`
  (**warn**, até 5); placa de altura vista no Mapillary gera `height_sign_detected` (**warn**, até 3).
- Qualquer veículo: `maxweight_suspeito` num trecho percorrido gera `suspicious_maxweight` — **warn** se o peso do
  veículo passa do valor provável (kg → t, vírgula), senão **info**; placas de peso/largura/comprimento do Mapillary
  geram `restriction_signs_detected` (**info**).
- `data`: contagens por tipo de estrutura, lista das passagens (até 100) com prioridade, placas (até 50). Para veículo
  abaixo de 4,0 m a contagem fica só em `data` (sem ruído no resumo).

## No mapa (`features`) — fila de coleta

A partir do zoom 12 (valores > 7 m só a partir do 14), ordenado por prioridade (1 = ferrovia/túnel/limitador/
`below_default`/placa de altura; 2 = viaduto/ponte/peso; 3 = passarela/valor > 7 m). Passagem aparece como ponto no
cruzamento. Propriedades: `tipo`, `via`, `estrutura`, `valor`, `motivo`, `pedido` (o que o motorista deve informar),
`fonte` e `link` (way/nó no OSM ou ponto no Mapillary).

## Fontes e licenças

- **OpenStreetMap** (PBF do Valhalla, ver `altura_osm.md`): **ODbL 1.0 — © colaboradores do OpenStreetMap**.
- **Mapillary** (opcional): conteúdo dos usuários sob **CC BY-SA 4.0** (Termos de Uso Mapillary de 15/02/2024; o link
  da licença na página aponta para `creativecommons.org/licenses/by-sa/4.0`). Uso **comercial** só nos termos da
  **seção 12**: melhoria/desenvolvimento de produtos, mapas, apps, bases de dados, ou serviço a clientes, com
  salvaguardas contra reidentificação/desborramento. **Atribuição obrigatória**: ao integrar dado extraído pela API, exibir
  o **logo do Mapillary com link para a home do Mapillary**. A seção 13 permite usar o conteúdo para editar o OSM.
  Dado do Mapillary fica em `data_features` com `source='mapillary'`, separado do OSM. (Texto dos termos conferido em
  `research/altura_sinalizacao/mapillary_terms.txt`, salvo na pesquisa.)

## Importador Mapillary (opcional)

Só roda com `MAPILLARY_TOKEN` no ambiente. Sem token ele **para com erro explicativo e não altera nada** (o runner
mostra "FALHARAM: mapillary_placas" — por isso rode-o pelo nome, não dentro de `all`, se não tiver token).

Como obter o token (gratuito): entrar em https://www.mapillary.com/dashboard/developers com conta Mapillary/Meta →
"Register application" → copiar o **Client Token** (começa com `MLY|`). O token vai no cabeçalho
`Authorization: OAuth …` (não aparece em URL nem em log).

```sh
docker compose --profile import run --rm -e MAPILLARY_TOKEN='MLY|...' importer mapillary_placas
# outro recorte: -e MAPILLARY_BBOX=minLon,minLat,maxLon,maxLat (padrão: Grande SP -47.21,-24.07,-45.69,-23.18)
```

- API `GET https://graph.mapillary.com/map_features` com `object_values` das classes de altura (`regulatory--height-limit--g1`,
  `warning--height-restriction--g2..g5`, `information/complementary--height-limit`), peso (`regulatory--weight-limit--g1..g7`
  e variantes por eixo), largura e comprimento.
- Limites da API: bbox < 0,01 grau² e até 2.000 resultados por consulta → grade de 0,09° (170 consultas na Grande SP)
  e subdivisão em 4 quando a resposta vem cheia. Cache de 7 dias em `data/cache/mapillary/`.
- **As classes de altura/peso não trazem o número** (só as de velocidade trazem), então cada detecção vira "placa
  detectada, valor desconhecido". O valor vem de reporte no app (ou, no futuro, OCR do recorte da imagem).
- Não testado com token real (a sessão não tinha um). Sem token: erro claro. Com token inválido o Mapillary respondeu
  HTTP 500 "Service temporarily unavailable" (o importador tenta 4 vezes e falha com a mensagem do servidor).

## Como atualizar

Junto com `altura_osm`, sempre que o PBF do Valhalla mudar:
`docker compose --profile import run --rm importer osm_altura_nos osm_lacunas` (~1 min cada; ver `altura_osm.md` para a
variante com `pip install osmium` e `OSM_PBF`).

## Limitações

- Detecção geométrica: estruturas sem `layer`/`bridge` corretos, ou via de baixo com nó em comum com a ponte (erro de
  mapeamento), escapam; complexos multinível podem gerar passagem "sob" uma alça que na verdade está por cima se o
  `layer` estiver errado.
- Passarela entra como passagem (prioridade 3): na RMSP a ARTESP mede passarelas de rodovia com mínimo de 5,42 m, mas as
  municipais não têm medida publicada.
- Uma passagem sem altura no OSM não quer dizer altura baixa: os buracos são, em geral, estruturas altas (piloto LiDAR
  da pesquisa: ~9% suspeitas). Por isso só avisa (info) e pede reporte.
- Placas Mapillary: posição triangulada (pode cair no lado errado da via) e detecção automática (pode errar a classe).
- **Atribuição Mapillary no front**: o popup do mapa mostra o nome das fontes, mas não o **logo** exigido pelos termos.
  Antes de carregar dados do Mapillary em produção, o front precisa exibir o logo com link (fora desta frente).
