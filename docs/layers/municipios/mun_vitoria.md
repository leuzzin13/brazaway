# Grande Vitória (ES): restrições municipais a caminhões (frente `mun_vitoria`)

Vitória, Vila Velha e Serra no formato por município da camada de restrições municipais (`layer_id`
`restricoes_rmsp`; formato e mecânica em [`../restricoes_municipais.md`](../restricoes_municipais.md)). A frente só
acrescenta arquivos: nenhum código do núcleo foi alterado. Fonte das regras: pesquisa `vitoria_es` (research.json com
as correções do verify.json), conferida no texto dos atos em 10/10/2026.

O critério é sempre o **PBT** ("peso bruto total ... maior que"); nenhum dos três municípios define VUC (`vuc: null`:
VUC acima do limite é caminhão). A política da ZMRC vale para todas as zonas: com origem ou destino dentro, a zona não é
excluída e a rota avisa (`rmsp_origem_na_zona` / `rmsp_destino_na_zona`).

| Peça | Arquivo |
|---|---|
| Regras | `data/raw/municipios/3205309.json` (Vitória + Terceira Ponte), `3205200.json` (Vila Velha), `3205002.json` (Serra) |
| Geometria curada (OSM) | `data/raw/municipios/geo/3205309_*.geojson`, `3205200_*.geojson`, `3205002_vias_curadas.geojson` |
| Trechos montados pelo importador | `data/raw/municipios/geo/3205309_vias.geojson`, `3205002_vias.geojson` (`construir: trechos`) |
| Script de curadoria | `data/raw/municipios/curadoria/grande_vitoria.py` |
| Seeds | `db/seed/layers/restricoes_rmsp__vitoria.sql`, `__vila-velha.sql`, `__serra.sql` |
| Teste | `api/test/layers/mun_vitoria.test.ts` |

## Regras

Dias: dias úteis = segunda a sexta. "Feriado" = coluna `feriados` do formato (`suspende` quando o ato excetua
feriados ou fala em dias úteis; `aplica` quando não excetua).

### Vitória (3205309) — Dec. 16.243/2015 e alterações

Dec. 16.243/2015 (DOMV 06/03/2015, vigência 60 dias depois, art. 8º: 05/05/2015; revogou o Dec. 10.364/1999), alterado
pelos Decs. 16.301/2015 (DOMV 08/05/2015), 16.575/2015 (DOMV 05/01/2016; o sistema de atos da Prefeitura não o lista
entre os alteradores) e 18.103/2020 (DOMV 09/09/2020). Autorização: AET da Secretaria de Transportes, Trânsito e
Infraestrutura Urbana (art. 3º). Exceções do art. 1º, §2º: redes de serviço, lixo, manutenção viária, socorro mecânico,
art. 29, VII, do CTB.

| Regra (`id`) | Onde | Quando | Quem | Ato e artigo | Status |
|---|---|---|---|---|---|
| `vitoria_municipio_23t` | todas as vias do município (zona = limite do IBGE) | dias úteis 6h–10h e 16h–20h; sáb 6h–14h; feriado livre | PBT > 23 t | Dec. 16.243/2015, art. 1º, IV, a | ativa, alta |
| `vitoria_municipio_45t` | todo o município | 24 h, todos os dias | PBT > 45 t | art. 1º, IV, b | ativa, alta |
| `vitoria_cegonheira_16t` | todo o município | dias úteis 6h–20h; sáb 6h–14h | cegonheira com PBT > 16 t | art. 1º, IV, c | **desativada** (o perfil não informa cegonheira) |
| `vitoria_centro_16t` | Centro (§3º: da R. Sebastião Tourinho/R. Raimundo Nonato, no Forte São João, à Ponte Seca, na Vila Rubim) | dias úteis 6h–20h; sáb 6h–14h | PBT > 16 t | art. 1º, III, a e §3º | ativa, alta |
| `vitoria_cidade_alta_10t` | setor "à direita do sentido de circulação" da R. Henrique Novaes, Av. Jerônimo Monteiro, R. General Osório, R. Thiers Velloso e R. Padre José de Anchieta (Cidade Alta) | dias úteis 7h–19h; sáb 8h–14h | PBT > 10 t | art. 1º, I, a | ativa, **média** (geometria interpretada) |
| `vitoria_cidade_alta_16t` | mesmo setor | 24 h | PBT > 16 t | art. 1º, I, b | ativa, média |
| `vitoria_beira_mar_16t` | Av. Mal. Mascarenhas de Moraes (Beira-Mar), da R. Josué Prado à Av. Paulino Muller, nos dois sentidos | 24 h | PBT > 16 t | art. 1º, II, a | ativa, alta |
| `vitoria_maruipe_paulino_muller_16t` | sentido Centro: Av. Maruípe (Rod. Serafim Derenzi → R. José Cassiano dos Santos), R. José Cassiano dos Santos e Av. Paulino Muller (→ Av. Vitória) | 24 h (o ato não fixa horário) | PBT > 16 t | Dec. 16.575/2015, art. 1º (art. 1º, IV, d, do 16.243) | ativa, alta (desde 05/01/2016) |
| `vitoria_mercado_vila_rubim_16t` | Mercado da Vila Rubim (§2º) | dias úteis 6h–20h; sáb 6h–14h | PBT > 16 t | art. 2º, III e §2º | ativa, alta |
| `vitoria_porto_centro` | instalações portuárias do Centro (Cais Comercial) | dias úteis 7h–9h (entrada e saída) | caminhão | Dec. 18.103/2020, art. 2º (art. 2º, §1º, do 16.243) | ativa, alta (desde 09/09/2020) |
| `vitoria_porto_centro_17h_19h` | idem | dias úteis 17h–19h | caminhão | Dec. 16.301/2015, art. 1º; caiu com o Dec. 18.103/2020, art. 2º | **revogada** (05/05/2015 a 09/09/2020) |
| `vitoria_carga_descarga_centro` | Centro, do Forte São João à Ilha do Príncipe | proibida a carga e descarga dias úteis 6h–19h e sáb até 14h (permitida 19h–6h, sáb 14h–24h, domingo e feriado) | carga e descarga | Lei 6.490/2005, arts. 1º a 5º | **desativada** (regra de destino, não de circulação) |

Exceções que não viram geometria: §1º do art. 1º (destino no porto segue o trajeto do art. 2º) e §4º (red. Dec.
16.301/2015: veículos do Berço 909, em Jesus de Nazareth, ficam fora do inciso IV e circulam pela rota fixa das 22h às
6h). Estão no campo `excecoes` e nos avisos.

### Vila Velha (3205200) — Dec. 161/2001

Assinado em 22/06/2001 (o portal mostra 22/07; vale o texto), Boletim Oficial de 15/08/2001, vigência 60 dias depois
(art. 8º: 14/10/2001); situação "Em Vigor", sem alterações. Autorização Especial da SEMUT (art. 3º).

| Regra (`id`) | Onde | Quando | Quem | Ato e artigo | Status |
|---|---|---|---|---|---|
| `vila_velha_centro_10t` | bairro Centro de Vila Velha (inclui a Prainha) | dias úteis 11h–19h; sáb 8h–19h; domingo e feriado livres | PBT > 10 t | art. 1º, I, a | ativa, alta |
| `vila_velha_centro_16t` | idem | 24 h | PBT > 16 t | art. 1º, I, b | ativa, alta |
| `vila_velha_gloria_10t` | Glória, exceto R. Santa Teresinha, Estrada Jerônimo Monteiro e Rod. Carlos Lindenberg | dias úteis 11h–19h | PBT > 10 t | art. 1º, II, a | ativa, alta |
| `vila_velha_gloria_10t_sabado` | idem | sáb 7h–18h, **inclusive feriado** | PBT > 10 t | art. 1º, II, a | ativa, alta |
| `vila_velha_gloria_16t` | idem | 24 h | PBT > 16 t | art. 1º, II, b | ativa, alta |
| `vila_velha_orla_10t` | orla de Praia da Costa, Itapuã e Itaparica (Av. Antônio Gil Veloso e Av. Estudante José Júlio de Souza) | todos os dias 10h–20h | PBT > 10 t | art. 1º, III, a | ativa, **média** (o ato não lista as vias) |
| `vila_velha_praias_16t` | todas as ruas de Praia da Costa, Itapuã e Praia de Itaparica | todos os dias 7h–20h | PBT > 16 t | art. 1º, III, b (c: estacionamento) | ativa, **média** (redação ambígua) |
| `vila_velha_porto` | instalações portuárias (Capuaba, Paul e terminais vizinhos) | dias úteis 7h–9h e 17h–19h (entrada e saída) | caminhão | art. 2º, parágrafo único | ativa, alta |

### Serra (3205002) — Dec. 5.881/2020 e alterações

Dec. 5.881/2020 (17/03/2020; vigência 30 dias após a publicação, art. 10, data da publicação não conferida →
`vigencia_inicio: null`; revogou o Dec. 3.312/2018, de igual conteúdo, que a imprensa ainda cita), alterado pelo Dec.
2.872/2022 (DOM de 26/05/2022, vigência 30 dias depois) e pelo Dec. 6.056/2024 (revoga o art. 5º, VI). Proíbe a
circulação **e a carga e descarga**; o art. 6º restringe a caminhões com PBT > 23 t, salvo a Av. Central (> 16 t).
Exceções do art. 5º, I a V; autorização especial da Secretaria Municipal de Defesa Social, pedida com 3 dias úteis
(art. 7º).

| Regra (`id`) | Onde | Quando | Quem | Ato e artigo | Status |
|---|---|---|---|---|---|
| `serra_pico_23t` | Av. Norte-Sul (Av. João Palácio → Av. Região Sudeste, Barcelona) e R. Carioca (BR-101 → Av. Norte-Sul) | dias úteis 7h–9h e 17h–19h | PBT > 23 t | art. 1º, I, a e c; art. 6º | ativa, alta |
| `serra_av_central_pico_16t` | Av. Central, do início (Valparaíso) à Av. Norte-Sul | dias úteis 7h–9h e 17h–19h | PBT > 16 t | art. 1º, I, b; art. 6º | ativa, alta |
| `serra_av_central_dia_16t` | Av. Central, da Av. Norte-Sul ao final (rotatória do Hospital Dório Silva) | dias úteis 8h–19h | PBT > 16 t | art. 1º, II, b; art. 6º | ativa, alta |
| `serra_av_central_sabado_16t` | idem | sáb 8h–14h, inclusive feriado | PBT > 16 t | art. 1º, §1º; art. 6º | ativa, alta |
| `serra_vias_24h` | 10 ruas da Serra Sede (art. 2º), estrada de Calogi/Muribeca (art. 3º, coordenadas UTM) e Av. Guarapari entre a Av. Anchieta e a R. Santos Dumont (art. 4º) | 24 h | PBT > 23 t | arts. 2º a 4º; art. 6º | ativa, alta |
| `serra_novo_horizonte_24h` | Av. Brasil, R. Papagaio e R. Gaivota, no bairro Novo Horizonte | 24 h | PBT > 23 t | Dec. 2.872/2022, art. 1º (art. 4º-A) | ativa, alta (desde 25/06/2022) |

### Terceira Ponte (registro regional, lei estadual)

| Regra (`id`) | Onde | Quando | Quem | Ato e artigo | Status |
|---|---|---|---|---|---|
| `es_terceira_ponte_lei_9602` | Ponte Deputado Darcy Castello de Mendonça (ES-060), toda a extensão, as duas pistas | 24 h | veículo de carga com **mais de 2 eixos OU PBT > 15 t** | Lei estadual 9.602/2010, art. 2º ("Em Vigor" na ALES); guarita da CETURB no km 3,3 (NC 001/2024) | ativa, alta |

Está no arquivo de Vitória como registro regional (`ibge: null`, `abrangencia_ibge: [3205309, 3205200]`, município
"Vitória e Vila Velha (lei estadual)"). O OSM só tem `maxweight=15` em 4 ways da ponte e um `hgv:conditional` com dois
`@` que o Valhalla descarta: sem esta regra, um caminhão de 3 eixos com até 15 t cruzaria a ponte.

## As 28 regras da pesquisa `vitoria_es`

| # | Regra da pesquisa | Aqui |
|---|---|---|
| 1–2 | Vitória > 23 t (pico) e > 45 t | `vitoria_municipio_23t`, `vitoria_municipio_45t` |
| 3 | Vitória, cegonheira > 16 t | `vitoria_cegonheira_16t` (desativada) |
| 4 | Vitória, setor do art. 1º, I (> 10 t e > 16 t) | `vitoria_cidade_alta_10t`, `vitoria_cidade_alta_16t` |
| 5 | Vitória, demais vias do Centro | `vitoria_centro_16t` |
| 6 | Beira-Mar | `vitoria_beira_mar_16t` |
| 7 | Maruípe / José Cassiano / Paulino Muller | `vitoria_maruipe_paulino_muller_16t` |
| 8 | Mercado da Vila Rubim | `vitoria_mercado_vila_rubim_16t` |
| 9 | Acesso ao porto do Centro | `vitoria_porto_centro` (+ `vitoria_porto_centro_17h_19h`, revogada) |
| 10 | Berço 909 (rota 22h–6h) | exceção nas regras do inciso IV e da Beira-Mar (não é restrição) |
| 11 | Carga e descarga no Centro (Lei 6.490/2005) | `vitoria_carga_descarga_centro` (desativada) |
| 12–16 | Vila Velha: Centro, Glória, orla, bairros de praia, porto | `vila_velha_*` (8 regras) |
| 17–19 | Serra: pico, Av. Central, vias 24 h | `serra_*` (6 regras) |
| 20 | Terceira Ponte (Lei 9.602/2010) | `es_terceira_ponte_lei_9602` |
| 21–23 | ES-060 km 33–39 (IS 003-N/2024), Acesso 9020 (IS 002-N/2024), IS 009-N/2023 (revogada) | frente `ders_estaduais` (camada `rodovias_estaduais`); não duplicadas aqui |
| 24–26 | Pontes do Rio Jacarandá (12 t), Rio Calçado (10 t) e Rio Fundão (16 t) | frente `ders_estaduais` (camada `oae`, fonte `der-es`) |
| 27 | OSM: ES-060 "Rodovia José Ribeiro Tristão" com `hgv=no` (sem ato; *unverifiable*) | correção do OSM na main (`data/osm-overrides/overrides.json`, `es060-contorno-guarapari-hgv-no`, pendente de confirmação; ver `docs/OSM_OVERRIDES.md`); não é regra municipal |
| 28 | OSM: janelas do `hgv:conditional` da Terceira Ponte (sem ato; *unverifiable*) | não registrada: são liberações sem base legal, e a lei vigente é a da regra 20 |

## Decisões

- **Vitória inteira como zona.** O art. 1º, IV, vale nas "demais vias do município da Capital"; o verify corrigiu a
  pesquisa: o ato **não** exclui as vias estaduais ou federais (a exclusão era inferência). A zona é o limite do IBGE
  (`municipios: ["3205309"]`, simplificado a ~20 m). Na prática a carreta que não vai a Vitória passa pela BR-101
  (Contorno) no pico; quem tem origem ou destino em Vitória não perde a zona e recebe o aviso.
- **Setor do art. 1º, I = Cidade Alta.** No OSM as cinco vias formam uma cadeia de mão única (R. Henrique Novaes e Av.
  Jerônimo Monteiro para oeste, R. General Osório e R. Thiers Velloso para norte, R. José de Anchieta — o "Padre José
  de Anchieta" do ato — para oeste); "à direita do sentido de circulação" é o lado norte/leste, a Cidade Alta. O
  rascunho da pesquisa chamava o setor de "lado da baía": o sentido de circulação mostra o contrário. Confiança média
  pela interpretação; polígono = bairro Centro do OSM desse lado da cadeia (as cinco vias ficam livres pelo recuo).
- **Centro (§3º)**: bairros da Região Administrativa I do OSM (Centro, Parque Moscoso, Piedade, Fonte Grande, Santa
  Clara, Bairro do Moscoso), a Vila Rubim a leste da Ponte Seca e o Forte São João a oeste da linha R. Raimundo Nonato
  / R. Sebastião Tourinho; a Ilha do Príncipe fica fora. O polígono inclui o setor da Cidade Alta (regra própria mais
  restrita) e o Mercado da Vila Rubim (mesmo horário; registrado por ser dispositivo próprio).
- **Portos como zona sobre a área portuária.** As janelas de acesso (Vitória 7h–9h; Vila Velha 7h–9h e 17h–19h) são
  regras de entrada e saída das instalações. A zona cobre só a área do cais (sem vias públicas: só `service` dentro),
  então nunca afeta o trânsito de passagem; com origem ou destino no porto a rota não a exclui e avisa a janela. A
  rota obrigatória dos atos é citada nas exceções, não imposta. As "indústrias adjacentes" não foram delimitadas.
- **Desativadas com o motivo.** Cegonheira (o perfil do veículo não tem tipo de carroceria) e carga e descarga da Lei
  6.490/2005 (regra de destino: como zona, barraria a passagem pelo Centro). Ficam como aviso
  `municipal_regra_nao_aplicada` quando a rota passa nelas.
- **Feriado em sábado.** O inciso II do Dec. 161/2001 (Glória) e o §1º do art. 1º do Dec. 5.881/2020 (Av. Central) não
  excetuam feriados: viraram regras próprias de sábado com `feriados: aplica`; os dias úteis ficam com `suspende`.
- **Terceira Ponte fora das zonas de Vila Velha.** A ponte (ES-060, km 0–3,3, Sistema Rodovia do Sol, estadual) foi
  recortada (25 m) das zonas do Centro e dos bairros de praia: tem regra própria. A ES-060 urbana de Vila Velha (Av.
  Dr. Olívio Lira, Av. Prof.ª Francelina Carneiro Setúbal, Rod. Comandante Octávio Schneider Queiroz) fica dentro da
  zona dos bairros de praia, como diz o ato ("todas as ruas dos bairros"): o trecho do km 3,3 ao 11 não é do Sistema
  Rodovia do Sol (NCs da CETURB). Entre 7h e 20h, a rota de mais de 16 t para o litoral sul vai pela Rod. Darly Santos.
- **Bairros de praia de 2001.** "Itaparica" = bairro Praia de Itaparica do OSM; Nova Itaparica, Jockey de Itaparica e
  Coqueiral de Itaparica (desmembrados depois) ficam fora.
- **Serra, nomes repetidos.** As ruas do art. 2º foram recortadas na Região de Serra Sede do OSM e as do art. 4º-A no
  bairro Novo Horizonte (há homônimas em outros bairros). A Av. Norte-Sul vai só nas vias com esse nome na faixa da Av.
  João Palácio à Av. Região Sudeste: entre a Av. Carapebus e a ES-010 a pista aparece no OSM como Av. Desembargador
  Mário da Silva Nunes / Av. Lourival Nunes e ficou de fora (lacuna de ~1,6 km a confirmar no Anexo I).
- **Trechos pela malha do Valhalla** (`caminho: valhalla`) onde o casamento por nome falha: Av. Maruípe (o eixo do OSM
  tem uma lacuna de ~65 m; 98% do caminho sobre a avenida), pista sentido leste da Beira-Mar (as duas pistas têm o
  mesmo nome) e a estrada de Calogi (art. 3º, entre as coordenadas UTM 24S do ato).

## Geometria e licenças

| Dado | Origem | Licença |
|---|---|---|
| Atos (decretos de Vitória, Vila Velha e Serra; Lei 6.490/2005; Lei estadual 9.602/2010) | portais oficiais (URLs em cada regra) | domínio público (Lei 9.610/1998, art. 8º, IV) |
| Bairros, vias, ponte e áreas portuárias | OpenStreetMap, extrato do Sudeste usado pelo Valhalla | ODbL 1.0 (© colaboradores do OpenStreetMap); mantido em `data_features`, nunca exportado para o OSM |
| Limite de Vitória (zonas do município) | IBGE, Malha Municipal (API v3) | dados públicos, citar a fonte |

Não foram usados os bairros do GeoWeb Vitória nem os do IJSN/GEOBASES (sem licença declarada). A licença de cada
município está em `fonte.licenca` (vai para `data_layer_runs`, `GET /api/sources`).

`grande_vitoria.py` refaz toda a geometria curada a partir do PBF (o Overpass estava fora do ar na curadoria): recorte
do bbox da RMGV, extração de vias e áreas, polígonos e vias recortadas, e o cache `osm_named_<ibge>.json` que o
importador usa para montar os trechos sem o Overpass. Os ids do OSM usados ficam nas propriedades (`osm_ids`). Rodado de
novo sobre o mesmo PBF, gera arquivos idênticos.

## Como atualizar

```bash
# 1. geometria curada (só se o OSM ou a interpretação mudar; ver o cabeçalho do script)
docker run --rm -v $(pwd)/data:/data -v $(pwd)/data/valhalla/sudeste-latest.osm.pbf:/pbf/sudeste.osm.pbf:ro \
  -e WORK=/data/cache/grande_vitoria --entrypoint python truck-router-importer \
  /data/raw/municipios/curadoria/grande_vitoria.py recorte /pbf/sudeste.osm.pbf
# (mesmo comando com) extrair · geometria · cache-overpass
# 2. validar sem banco nem rede
docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data:/data -e DATA_DIR=/data \
  --entrypoint python truck-router-importer -m sources.municipios --validar
# 3. importar só estes municípios (trechos, validação no Valhalla, banco e seeds)
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e VALHALLA_URL=http://valhalla:8002 \
  -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer municipios:3205309,3205200,3205002
```

Monitorar: Diário Oficial de Vitória (Querido Diário, desde 2014), DOM da Serra (a Prefeitura "avalia a restrição"
de pesados na antiga rodovia e no Viaduto de Carapina, DOM de 24/02/2026), legislação de Vila Velha, DIO-ES (busca
full-text; com `&subtheme=dom` cobre o DOM-AMUNES de Viana, Guarapari e Fundão).

## Testes

`api/test/layers/mun_vitoria.test.ts` (13 testes; banco e API locais, `API_URL`):

- regras no banco (status x kind, UF, confiança, ato com artigo, revogada vencida, registro regional da ponte);
  janelas, feriados e alvos (PBT "maior que", ponte com mais de 2 eixos OU mais de 15 t);
- módulo da camada: zona de pico de Vitória (pico, sábado, domingo, origem dentro, feriado municipal de Vitória x de
  Vila Velha), Vila Velha (sábado feriado), portos, Terceira Ponte, Serra e o mapa;
- rotas reais: carreta Vila Velha → Serra às 8h de terça **desvia** de Vitória e às 11h **passa** por Vitória (mais
  curta); destino no Centro de Vitória às 10h avisa sem excluir; caminhão de 3 eixos e 14 t dá a volta na Terceira
  Ponte e o toco de 14 t cruza.

```bash
cd api && API_URL=http://localhost:3000 npx vitest run test/layers/mun_vitoria.test.ts
```

## Limitações e pendências

- Sem geometria: "Rua Um" (Serra, art. 2º, a: não existe com esse nome na Serra Sede; Anexo II não obtido) e "Rua M"
  (Serra, art. 1º, I, d: a do OSM fica a oeste da BR-101). Lacuna da Av. Norte-Sul entre a Av. Carapebus e a ES-010.
- Anexos (plantas) dos decretos da Serra não foram obtidos; o Dec. 5.881/2020 exclui da Norte-Sul os "segmentos
  internos aos cruzamentos" com as vias do decreto (não representado).
- Cegonheira e carga e descarga só avisam (ver Decisões); o aviso de regra desativada sai em qualquer horário quando a
  rota passa na zona.
- Estacionamento (> 16 t nos bairros de praia de Vila Velha) e rotas obrigatórias dos portos não são representáveis.
- Lei 3.499/1987 de Vitória (estacionamento de caminhões para carga e descarga na zona central, 7h–10h) aparece sem nota
  de revogação e pode conflitar com a Lei 6.490/2005 (verify): não revisada.
- Feriados municipais: o calendário (`holidays` por `ibge_code`) é da frente de feriados. Vitória: Lei 1.732/1967 (em
  2026: 03/04, 13/04, 04/06 e 08/09, Dec. 25.991/2025); Vila Velha e Serra não levantados nesta pesquisa.
- Cariacica, Viana, Guarapari e Fundão: sem regra municipal confirmada (Cariacica informou à imprensa, em 2022, que
  não tem lei; o portal de legislação dela não busca).
- Interdição temporária da 2ª Ponte (SEMOBI, 02/09 a 20/12/2026, 21h–5h, pesados desviados para as Cinco Pontes;
  DIO-ES de 31/08/2026) não foi implementada: é obra estadual, sem artigo conferido nesta frente.
