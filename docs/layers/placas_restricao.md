# Camada `placas_restricao`: placas de restrição a caminhões (DER-SP)

Módulo: `api/src/layers/placas_restricao.layer.ts` · Importador: `importers/sources/der_sinalizacao.py`
(`layer_id = 'placas_restricao'`, `source = 'der-sp'`) · Testes: `api/test/layers/placas_gabarito.test.ts`.

## Fonte
- DER-SP, inventário de Sinalização Vertical (rodovias estaduais **não concedidas**):
  `https://mapas.der.sp.gov.br/server/rest/services/Hosted/Sinalizacao_Vertical_DBO/FeatureServer/0`
  (mesmos dados do CKAN `dadosabertos.sp.gov.br/dataset/sinalizacao-vertical`). 427.785 placas no total.
- Licença: **CC-BY-4.0** (citar "DER-SP").
- Filtro: `código_pl` contendo R-9, R-14, R-15, R-16, R-17 ou R-18 (inclui combinadas como `R-18-R-14`) → 584 placas
  (R-14 212, R-15 180, R-9 116, R-18 60, R-17 9, R-16 7). Seed: `db/seed/layers/placas_restricao__der-sp.sql`.
- Rodar: `docker compose --profile import run --rm importer der_sinalizacao` (cache de 30 dias em `data/cache/`).

| Placa | Significado (MBST Vol. I, CONTRAN 2022) | Infração por desrespeito (CTB, Lei 9.503/1997) |
|---|---|---|
| R-9 | Proibido trânsito de caminhões | art. 187, I |
| R-14 | Peso bruto total máximo permitido | art. 231, V |
| R-15 | Altura máxima permitida | art. 231, IV |
| R-16 | Largura máxima permitida | art. 231, IV |
| R-17 | Peso máximo permitido por eixo | art. 231, V |
| R-18 | Comprimento máximo permitido | art. 231, IV |

Nomes conferidos no Manual Brasileiro de Sinalização de Trânsito, Vol. I (índice de sinais); artigos conferidos no texto
compilado do CTB no Planalto em 09/10/2026.

## O que a camada faz
- **Nunca bloqueia**: o inventário **não traz o número da placa** (só código, rodovia, km, data do levantamento e "atende à
  norma"). Sem o valor não há como saber se o veículo viola o limite.
- `annotate`: placas a até **30 m** da rota (`PLACA_RAIO_M`) viram aviso `warn`:
  "Placa de limite de altura (R-15) a 12 m da rota (SP-055 km 5,2) — confira o valor no local." /
  "Placa de proibição de caminhões (R-9) a 8 m da rota (…) — confira se vale para sua pista e horário."
  Placas iguais a menos de 150 m (par nos dois lados, repetição) viram um aviso só; no máximo 10 avisos + um `info` com o resto.
  Resumo: contagem por código. `data.placas` traz id, códigos, rodovia, km, distância e data do levantamento.
- `features`: pontos vermelhos a partir do zoom 9, com popup (placa, significado, rodovia/km, levantamento, CTB).

## Decisões
- Severidade `warn` (atenção), não `danger`: não sabemos se o limite alcança o veículo.
- Raio de 30 m: placas ficam no acostamento/canteiro; acima disso aumentam os falsos positivos em vias que cruzam.
- R-9 incluída além de R-14..R-18 porque é a restrição mais direta a caminhões e está no mesmo inventário.

## Limitações
- Sem valor da placa e sem sentido de tráfego: a placa pode valer para a pista oposta ou para uma via transversal.
- Só malha DER-SP (não concedida). Concessionárias (ARTESP), DNIT e prefeituras não publicam inventário de placas.
- Levantamentos de 2024–2026; placas novas/removidas depois disso não aparecem.
- Próximo passo natural: pedir via LAI ao DER-SP o valor das placas R-14/R-15 (ou casar com `maxweight`/`maxheight` do OSM).
