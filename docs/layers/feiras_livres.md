# Camada `feiras_livres` — feiras livres que fecham a rua (São Paulo)

Camada extra da frente `apoio_urbano`, encontrada na varredura do GeoSampa: feiras livres por dia da semana. No dia
e horário da feira a rua fica fechada no trecho das bancas — para caminhão é desvio certo (e, no destino, não há
onde parar).

- Módulo da API: `api/src/layers/feiras_livres.layer.ts` (grupo `restricoes`).
- Importador: `importers/sources/geosampa_feira_livre.py`.
- Testes: `api/test/layers/apoio_urbano.test.ts`.

## Fonte e licença

`geoportal:equipamento_feira_livre` do GeoSampa (SMDU/Deinfo; `dt_atualizacao` 2026-06-24): 975 feiras, um ponto
de referência (endereço) por feira, com dia da semana, categoria (`T` 931, `N` 31, `O` 13) e número de
equipamentos. Licença **CC-BY-SA 4.0** (GeoSampa/PMSP). O GeoSampa avisa que o dado não traz número de barracas,
extensão nem localização exata; `tx_horario_funcionamento` vem vazio nas 975.

`props.osm` (aresta da malha casada e o ponto no meio dela) é derivado do OpenStreetMap (ODbL): serve só para
endereçar a quadra no Valhalla; não é exibido nem exportado. Nada vai para o OSM.

## Regra (conferida na fonte primária)

Decreto municipal **48.172/2007** (Catálogo de Legislação Municipal,
https://legislacao.prefeitura.sp.gov.br/leis/decreto-48172-de-6-de-marco-de-2007, conferido em 09/10/2026):

- **art. 4º**: as feiras funcionam de terça a domingo, exceto 25/12 e 1º/01;
- **art. 5º, I** (redação do Decreto 61.775/2022): feira comum — 7h–8h descarga e montagem, 8h–14h comercialização,
  14h–14h45 desmontagem e carregamento;
- **art. 5º, § 2º, III**: nos dias e horários das feiras, o tráfego e o estacionamento de veículos ficam
  **proibidos nos locais de montagem das bancas**;
- **art. 5º, § 1º**: horários diferenciados podem ser adotados para determinadas feiras (a pedido da Subprefeitura);
  **art. 5º, II**: feiras confinadas têm horário próprio.

Aplicação: janela **07:00–14:45** só para a categoria `T` (tradicional = feira comum). As categorias `N` e `O`
(siglas sem dicionário; `O` parece orgânica) ficam **sem janela** e só geram aviso informativo. O § 1º significa
que algumas feiras têm horário diferente do padrão — limitação documentada.

## Como entra na rota

Casamento (importador): o ponto é casado (`/locate` do Valhalla, raio 70 m) com a aresta de **mesmo nome de rua**
(nome normalizado: abreviações, acentos, "C/" de esquina); a aresta mais próxima que não seja ligação/serviço vence,
com penalidade quando o ponto cai na esquina. O meio dessa aresta (≈ a quadra da feira) vai em `props.osm.mid`.
713 das 921 feiras com endereço e janela legal casaram; arestas com menos de 24 m são descartadas.

`exclusions()`: para cada feira casada no corredor origem–destino cuja janela vale na **hora estimada de passagem**
(distância em linha reta da origem × 1,3 a 20 km/h), um polígono de **4 m de raio no meio da quadra**. O Valhalla
exclui só a aresta que passa por ali (os dois sentidos); as esquinas e as ruas que cruzam ficam livres. Se a origem
ou o destino está na própria quadra, ela não é bloqueada (a rota ainda chega) e a camada avisa.

`annotate()`:
- `street_market_on_route` (`warn`): feira casada, na rota, no horário pela hora de passagem calculada depois da
  rota, que não tinha sido bloqueada antes (estimativa de horário diferente);
- `street_market_near_route` (`info`): feira **sem** quadra casada a até 40 m da rota no horário (local não confirmado);
- `street_market_unknown_hours` (`info`): feira de categoria sem horário publicado no dia da passagem;
- `street_market_at_destination` (`warn`): feira ativa a até 150 m do destino na chegada (não há como parar);
- resumo: feiras na rota, "Desvio de N rua(s) de feira" (as que a rota livre usaria e a rota calculada evitou), e
  ruas de feira fora do horário; o item bloqueado aparece em `avoided` com nome, dia e horário.

### Por que polígono e não `costLines`

A regra do projeto é preferir `costLines` (linear_cost_factors) a polígonos. Testei (09/10/2026):
1. O traçado exato da aresta funciona no *edge walk*, inclusive ida e volta numa linha só (A→B→A), e penaliza os
   dois sentidos.
2. Mas uma quadra tem 2–4 vértices, e o `routing.ts` considera a costLine "usada" quando ≥ 50% dos vértices ficam a
   15 m da rota. O desvio em volta do quarteirão passa pelas duas esquinas → a linha conta como usada → aviso
   `danger` falso "trecho restrito sem alternativa razoável" (reproduzido na R. Min. Godoy).
3. Densificar a linha (para diluir as esquinas) funciona num sentido só; a ida e volta densificada falha no edge
   walk (erro 233, que derruba a rota inteira), e uma linha por sentido duplicaria os itens de "evitados".

O polígono minúsculo no meio da quadra não tem esses problemas, não encosta nas travessias (que é o motivo da regra)
e, ao contrário do traçado, continua válido se o tileset do Valhalla for recompilado.

## Como atualizar

```sh
docker compose --profile import run --rm importer geosampa_feira_livre
```

Precisa do Valhalla para o casamento (`VALHALLA_URL`, padrão `http://valhalla:8002`); sem ele as feiras entram sem
`props.osm` e só geram avisos. Seed: `db/seed/layers/feiras_livres__geosampa.sql` (0,9 MB). Recomendado mensal.

## Limitações

- Só a quadra do endereço de referência é bloqueada; a feira costuma ocupar mais de uma quadra (extensão não
  publicada). O resumo avisa isso.
- Horário padrão do decreto; feiras com horário diferenciado (art. 5º, § 1º) ou confinadas não estão identificadas.
- O OSM já tem algumas vias com `motor_vehicle:conditional` de feira (ex.: "We 05:00-16:00"), que o Valhalla aplica sozinho;
  as duas coisas convivem (o polígono só reforça).
- A hora de passagem é estimada; perto das 7h e das 14h45 o resultado pode variar alguns minutos.

## Varredura do GeoSampa (o que mais existe para caminhão)

Revisei a lista de 485 camadas (`all_layers.tsv` da pesquisa `restricoes_sp_capital`). Além das usadas nesta frente:
- `classificacao_viaria_cet` (210 mil trechos; Portaria DSV.G 18/19): útil para preferir arteriais, mas o Valhalla já
  usa a classe viária do OSM; ganho baixo para o custo de casar 210 mil trechos — não implementado.
- `risco_ocorrencia_alagamento` (292 pontos): só faria sentido com previsão/alerta de chuva em tempo real — fica
  para quando houver fonte meteorológica.
- `controle_uso_via_publica_geoinfra` (obras): só obras de emergência, retrato de jan/2026 — desatualizado.
- `restricao_circulacao_veiculo_zmrc/mian/zmrf`, `obra_arte`, `acidente_cet`: já cobertos por outras camadas/frentes.
- Não há no GeoSampa camada de VER, ZERC, placas R-9, alturas de viaduto ou vagas de carga e descarga fora da Zona Azul.
