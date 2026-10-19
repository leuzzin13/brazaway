# IMPSC16: Passo Fundo e São José dos Ausentes (RS)

Lote do Sul/Centro-Oeste na camada genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)).
Pesquisa e verificação de 2026-10-19 (rodada 7) em `docs/research/cidades_sul_co/` (`res/<ibge>.json`, `verif/<ibge>.json`, atos em `atos/<ibge>/`).
Geometria pelos nomes do OSM (cache do PBF `osm_named_<ibge>.json`, sem Overpass), ODbL 1.0; atos em domínio público (Lei 9.610/1998, art. 8º, IV). Nenhum dos dois define VUC (`vuc: null`). Confiança média nas três regras (texto de terceiro em Passo Fundo; PDF escaneado e redação ambígua em São José dos Ausentes).

| ibge | Município | fonte_id | Ativas | Desativadas | Casos de rota | Teste |
|---|---|---|---|---|---|---|
| 4314100 | Passo Fundo/RS | `passo-fundo` | 2 | 0 | 8 evita | passou |
| 4318622 | São José dos Ausentes/RS | `sao-jose-dos-ausentes` | 1 | 0 | 2 evita, 1 sem_alternativa | passou |

Teste do lote: `cd api && API_URL=http://localhost:3000 ./node_modules/.bin/vitest run test/layers/mun_sul_co.test.ts -t "4314100|4318622"` (13 testes: 2 de kinds + 11 de rota).

## Passo Fundo/RS (4314100)

Decreto Municipal 78, de 12/07/2021 (efeitos desde 03/03/2021; revoga o Decreto 22/2021). Texto lido no Leis na Web (portal de legislação contratado pelo município): [ato 15525](https://leisnaweb.com.br/mostrar-ato/?ato=15525&cliente=passofundo). Vigência sustentada pela página de serviço da Prefeitura (2026), que cita o decreto como vigente; o Leis na Web só indexa decretos do Executivo até 2021, então alteração posterior não é provada.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `passofundo_area_central_7t` | ativa (média) | Decreto 78/2021, art. 4º e parágrafo único; arts. 2º e 3º (exceções) | 10h-19h, todos os dias, feriados incluídos | caminhão com PBT acima de 7 t **ou** comprimento acima de 6,30 m **ou** largura acima de 2,20 m | zona aproximada `4314100_area_central.geojson` (manual, 32 vértices, ~1,15 km²) | evita: VUC (9 t) de oeste a leste e do bairro a oeste ao sudeste do centro, às 11h; às 21h (fora da janela) a mesma rota atravessa a zona |
| `passofundo_av_brasil_15t` | ativa (média) | Decreto 78/2021, art. 5º, incisos I a VI e parágrafo único | 24 h, todos os dias | caminhão com PBT acima de 15 t | `4314100_vias.geojson`: 55 linhas (~16,5 km de via, 72 feições antes de encadear) pelos nomes Avenida Brasil Leste, Oeste e Centro, Avenida Presidente Vargas e Avenida Moacir da Motta Fortes | evita: carreta (Brasil Oeste ida, Brasil Leste ida, Presidente Vargas, Motta Fortes) e toco (Brasil Oeste volta, Brasil Leste volta), às 22h |

Trechos do art. 5º, cada um um trecho de sentido único no arquivo (o decreto fixa o sentido em II a V; I vale nos dois):

| Inciso | Descrição no ato | Modelado | Comprimento |
|---|---|---|---|
| I | Av. Brasil Leste, do trevo da BR-285 até a Rua Álvares Cabral, ambos os sentidos | dois trechos de sentido único, da Álvares Cabral ao fim da Av. Brasil Leste do OSM (NE) e o inverso | 1,87 km e 1,81 km |
| II | Av. Brasil, do trevo da RS-324 até o cruzamento da Av. Brasil Leste com a Av. Sete de Setembro, sentido Boqueirão/Petrópolis | Brasil Oeste, Centro e Leste, do encontro com a RSC-153/RS-324 até a Av. Sete de Setembro, oeste para leste | 5,02 km |
| III | Av. Brasil, da Rua Fidêncio Franciosi até o trevo da RS-324, sentido Petrópolis/Boqueirão | idem, da Rua Fidêncio Franciosi até a rodovia, leste para oeste | 4,64 km |
| IV | Av. Presidente Vargas, da Rua Aspirante Jenner até a Rua Gal. Canabarro, sentido São Cristóvão/Centro | pista noroeste da Presidente Vargas | 1,42 km |
| V | Av. Presidente Vargas, da Rua Gal. Canabarro até a Rua Duque de Caxias, sentido Centro/São Cristóvão | pista sudeste | 1,28 km |
| VI | Av. Moacir da Motta Fortes, da Rua Erechim até a Rua Lagoa Vermelha | as 4 ways da avenida (a Rua Erechim não está no OSM; a avenida inteira, ~0,5 km, termina na Rua Lagoa Vermelha) | 0,52 km |

Exceções (só nos avisos): concreto, gás a granel, combustíveis, oxigênio hospitalar e serviços públicos (art. 3º); transportes excepcionais com autorização prévia da Secretaria de Segurança Pública e Transporte (art. 3º, parágrafo único); entre 19h e 10h a carga e descarga de caminhões de 7 a 15 t é permitida na área central (art. 2º, I); caminhões com menos de 7 t, até 6,30 m e 2,20 m podem carregar e descarregar em qualquer horário nos locais indicados (art. 2º, II). Nada disso é modelado.

Casos de rota (todos conferidos na API; terça 2026-10-13):

- **Zona, evita com janela**: VUC (9 t, 7,2 m, 2,5 m: acima de 7 t, fora da regra de 15 t) de (-28.2640, -52.4290) a (-28.2560, -52.3880), 11h: rota de 7,06 km, 0 km na zona; às 21h, 6,15 km com 0,34 km dentro da zona. Segundo par, de (-28.2590, -52.4190) a (-28.2650, -52.3950): 4,04 km às 11h contra 3,64 km às 21h (0,34 km na zona). A carreta não serve de caso de janela, porque a regra de 15 t a desvia da Av. Brasil e o centro já fica fora da sua rota em qualquer horário.
- **Vias (24 h, às 22h para a zona estar fora da janela)**: carreta de (-28.2662, -52.4312) a (-28.2539, -52.4011), 4,58 km sem usar a Av. Brasil Oeste (o VUC faz 4,82 km e usa 1,6 km dela); toco no sentido contrário, 4,07 km (o VUC usa 1,26 km); carreta na Av. Brasil Leste de (-28.2472, -52.3857) a (-28.2397, -52.3755), 1,38 km, e o toco de volta (o VUC usa 1,34 e 1,40 km); carreta na Presidente Vargas de (-28.2663, -52.4018) a (-28.2693, -52.3917), 1,45 km (o VUC faz 1,30 km com 0,87 km na avenida); carreta na Motta Fortes de (-28.2475, -52.4260) a (-28.2575, -52.4140), 2,17 km (o VUC usa 0,54 km).
- **Rota de passagem**: de (-28.2450, -52.5000) a (-28.2300, -52.3300), por fora do centro, 20,7 km para a carreta e para o VUC, em qualquer horário, sem aviso de via evitada e sem volta absurda (as travessias de rodovia ficam fora do polígono).
- A Presidente Vargas no sentido centro para sudeste (inciso V) não gerou caso: o VUC já não usa a avenida nesse par, então não provaria nada.

Decisões e divergências:

- **Alvo da zona por "ou"**: o parágrafo único do art. 4º liga as três medidas por "e" (capacidade acima de 7.000 kg de PBT, mais de 6,30 m de comprimento e 2,20 m de largura). O rascunho da pesquisa modelou as três cumulativas; por instrução da coordenação ficou "basta exceder uma" (`qualquer`), porque o art. 2º, II, só trata como pequeno o caminhão que fica dentro das três. Na prática só muda para veículos de PBT até 7 t com mais de 6,30 m ou mais de 2,20 m. Reverter é trocar `qualquer` por `todas` no JSON.
- **Dias da semana**: o decreto não fixa dias, então vale todos os dias (texto legal). O OSM tem `hgv=no` com `hgv:conditional = yes @ (Mo-Sa 00:00-10:00;19:00-24:00; Su 00:00-24:00)` na Av. Brasil Centro, Rua General Canabarro, Rua General Osório, Rua Independência e partes da Presidente Vargas: coerente com a janela, mas libera o domingo; a sinalização real provavelmente é segunda a sábado. A divergência fica registrada, a regra não segue o OSM.
- **Rua Gal. Neto**: a pesquisa não a achou no Nominatim. No PBF existe a "Avenida General Netto", que liga a Rua Gal. Canabarro à Rua Gal. Osório (cerca de 0,1 km entre as duas); foi tomada como o lado correspondente do perímetro, por nome parecido e posição (**a confirmar**). Sem ela o polígono ficaria aberto.
- **Polígono**: caminho de cada lado pelas vias-limite do OSM (Rua Uruguai de Marcelino Ramos a Tiradentes, Rua Tiradentes até a Independência, Rua General Canabarro até a Gal. Neto, Gal. Neto até a Gal. Osório, Rua General Osório até a Marcelino Ramos, Rua Marcelino Ramos de volta à Uruguai), anel fechado, ampliado ~30 m (o recuo de 20 m da camada devolve as vias-limite, "incluídas em toda a largura") e simplificado. Sem rodovia dentro: as vias principais que o cortam (Av. Brasil Centro e Leste, Av. Sete de Setembro, Rua Coronel Chicuta, Rua Benjamin Constant, Rua Teixeira Soares) não têm `ref` no OSM.
- **Jurisdição do art. 5º**: as avenidas são municipais e não têm `ref` de rodovia no OSM (conferido nas 72 feições gravadas). Os trevos da BR-285 e da RS-324 e as rodovias ficam fora: a ponta oeste dos incisos II e III é o encontro da Av. Brasil Oeste com a Rodovia Gilmar Mühl (RSC-153/RS-324), e a leste a Av. Brasil Leste vai até o fim da via no OSM (BR-285 não aparece nas vias com nome do município). Nenhum trecho foi retirado por ser rodovia.
- **Item VII do art. 5º** (Rua Teixeira Soares, "da Rua Lagoa Vermelha até a Rua Teixeira Soares"): descartado por incoerência do texto. O caput do art. 5º cita também a "área definida no art. 4º" (acima de 15 t), mas os incisos listam só avenidas: leitura menos restritiva mantida, não modelada. O art. 3º remete ao "perímetro do art. 5º" (provável erro de remissão).
- **Pontas por coordenada**: Álvares Cabral, Fidêncio Franciosi, Sete de Setembro (cruzamento com a Av. Brasil Leste, não o da região central), Aspirante Jenner, Gal. Canabarro e Duque de Caxias entram como `lonlat` colhidos nos vértices da pista certa de cada sentido (as avenidas são pistas duplas de mão única no OSM). Todos os trechos ficam marcados aproximados, com o aviso `rmsp_trecho_aproximado` (info) nas rotas que os usam.

Pendências:
- Confirmar no local, ou com a Secretaria de Segurança Pública, se a "Rua Gal. Neto" do ato é a "Avenida General Netto" do OSM e qual o perímetro real (o decreto não tem mapa); trocar o polígono por um oficial se a prefeitura fornecer.
- Confirmar se a sinalização vale também aos domingos (divergência com o OSM) e se houve alteração posterior ao Decreto 78/2021 (busca não exaustiva).
- Leitura "e" ou "ou" das três medidas do art. 4º, parágrafo único (ver acima).
- Pendências do import: nenhuma (`pendencias: []`; todas as linhas casaram com o grafo do Valhalla).

## São José dos Ausentes/RS (4318622)

Decreto Municipal 11, de 24/02/2021 (vigor na publicação, art. 2º), fonte oficial: [PDF no site da Prefeitura](https://www.saojosedosausentes.rs.gov.br/wp-content/uploads/2021/02/Decreto-11.pdf), escaneado, relido na imagem da página pelo verificador. Sem ato posterior na busca do site.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `saojosedosausentes_av_ismenia_18t` | ativa (média) | Decreto 11/2021, art. 1º | 24 h, todos os dias | caminhão com PBT acima de 18 t | `4318622_vias.geojson`: toda a Avenida Ismênia B. Ribeiro Velho do OSM (nome exato do OSM; way 347787751 e as demais: duas pistas de mão única de ~0,67 km, um trecho de mão dupla de 0,26 km e ligações curtas; 6 feições, 1,74 km, as 3 ways de 7 m ficam de fora) | evita: carreta (terça 10h) e truck (domingo 3h); sem_alternativa: truck com origem e destino sobre a avenida |

Casos (API; origem e destino em (-28.7430, -50.0520) e (-28.7500, -50.0700)): carreta, terça 10h, volta de 4,40 km (`large_detour`) sem tocar a avenida; o toco (16 t, abaixo do corte) faz 1,89 km e usa 1,0 km dela. Truck, domingo 3h: 4,40 km, 0 km na avenida. No sentido inverso (do sudoeste ao nordeste) a rota roça 0,049 km da ponta da avenida, perto demais do limite de 0,05 km do teste, por isso só o sentido nordeste para sudoeste virou caso. "sem_alternativa": truck de (-28.7455, -50.0610) a (-28.7445, -50.0560), os dois pontos sobre a avenida (carga e descarga local): a rota ainda faz uma volta de 5,17 km, mas usa 0,2 km da avenida para entrar e sair e avisa `rmsp_via_restrita_na_rota`. Não é a avenida como única ligação entre dois bairros; é o caso de destino na própria via.

Decisões e pendências:
- **Ambiguidade 10 t x 18 t**: o texto diz "caminhões acima de 10 (dez) toneladas e PBT (peso bruto total) 18 toneladas". Modelado PBT acima de 18 t (carga útil acima de 10 t), a leitura menos restritiva, que cobre o que é proibido em qualquer interpretação; veículos de 10 a 18 t de PBT podem estar proibidos na leitura alternativa e passam na camada (o toco do perfil, 16 t, e o VUC, 9 t, não são atingidos).
- **Jurisdição**: a avenida é municipal no OSM (tertiary, sem `ref`; a BR-285 é outra via, ~1,2 km a leste), mas uma ação do DNIT na avenida em mai/2023 (notícia da prefeitura) deixa a jurisdição não totalmente excluída; tratada como municipal (decreto da prefeitura, via urbana asfaltada pela prefeitura em 2021). Sinalização não verificada (não é condição no texto).
- Pendências do import: nenhuma.

## Observações gerais

- Cache do PBF gerado com `osm_pbf_cache_regioes.py 4314100 4318622` (uma passada, ~3 min). Nada do Overpass.
- Os dois municípios importaram direto (`municipios:<ibge>`, ambiente nativo), com validação offline `--validar` limpa (258 arquivos).
- Seeds gerados: `db/seed/layers/restricoes_rmsp__passo-fundo.sql` (56 feições: 1 zona + 55 linhas) e `restricoes_rmsp__sao-jose-dos-ausentes.sql` (6 linhas).
- Todas as regras ativas valem 24 h, exceto a zona de Passo Fundo (10h-19h); `feriados: aplica` em todas. O controle dos casos de via foi sempre um veículo não atingido (VUC ou toco) fazendo o mesmo trajeto.

## Nota da coordenação (alvo da zona de Passo Fundo)

O art. 4º, parágrafo único, proíbe das 10h às 19h "caminhões com capacidade acima de 7.000 kg de peso bruto total, mais de
6,30 metros de comprimento e 2,20 metros de largura". O art. 2º, II, só libera a qualquer hora quem tem menos de 7.000 kg
E até 6,30 m E até 2,20 m. Por isso o alvo é `qualquer` (basta exceder um dos três limites), coerente com o art. 2º, II, e
não `todas`, a leitura literal isolada do parágrafo único.
