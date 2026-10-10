# Camada `restricoes_rmsp` — restrições de caminhão nos municípios da Grande SP

> A camada é **genérica por município** desde 10/10/2026: formato, importador, status, capacidade de carga e o passo a
> passo para uma frente adicionar um município estão em [`restricoes_municipais.md`](restricoes_municipais.md). O id
> `restricoes_rmsp` foi mantido (decisão explicada lá). Este arquivo trata só da Grande SP.

Restrições municipais a caminhões **fora da capital**: Osasco (ZMRC + VER), Barueri (VER), Guarulhos (ZRCC-TB, Trevo
de Bonsucesso), Cajamar (Anexos I–IV), Santana de Parnaíba (PBT > 15 t) e Ribeirão Pires (ZRC). A restrição
regional do ABC de 2012 fica registrada como **revogada** e nunca é aplicada.

Peças:

| Peça | Arquivo |
|---|---|
| Regras legais (horários, dimensões, VUC, exceções, ato e artigo, URL conferida) | um arquivo por município: `data/raw/municipios/3534401.json` (Osasco), `3505708.json` (Barueri), `3518800.json` (Guarulhos), `3509205.json` (Cajamar), `3547304.json` (Santana de Parnaíba), `3543303.json` (Ribeirão Pires) e `3547809.json` (Santo André: registro revogado do ABC 2012). Até 10/10/2026: `data/raw/rmsp/regras.json` |
| Geometria curada (versionada; o import não depende do Overpass) | `data/raw/rmsp/*.geojson` (referenciada nos arquivos de município) |
| Curadoria do mapa vetorial de Osasco (georreferenciamento) | `data/raw/rmsp/curadoria/osasco_georef.py` + pontos de controle |
| Importador | `importers/sources/municipios.py` (genérico; biblioteca `_municipios_lib.py`). Até 10/10/2026: `rmsp_*.py` |
| Seeds | `db/seed/layers/restricoes_rmsp__<fonte>.sql` (fontes `osasco`, `barueri`, `guarulhos`, `cajamar`, `santana-parnaiba`, `ribeirao-pires`, `santo-andre` e `ibge` = limites) |
| API | `api/src/layers/restricoes_rmsp.layer.ts` |
| Testes | `api/test/layers/rmsp.test.ts` (25 testes, contra a API), `importers/tests/test_rmsp_linhas.py` (corte/encadeamento das linhas, sem rede) e `importers/tests/test_municipios.py` (os arquivos da RMSP montam as mesmas feições dos importadores antigos) |

Não foi preciso migration (usa `data_features`/`data_layer_runs` e o calendário legal `holidays`).

## Regras implementadas (conferidas na fonte primária em 09/10/2026)

| Município | Ato | Tipo no app | Quando | Quem | VUC |
|---|---|---|---|---|---|
| Osasco | Dec. 10.676/2012, art. 3º (red. Dec. 13.704/2023, art. 1º); mapa DEMUTRAN (IOMO 2434, p. 98); Portaria SETRAN (IOMO 2487, art. 1º IV "c") | ZMRC → **exclusão** (polígono) **e** as 12 vias do art. 3º → **costLines** (regra `osasco_zmrc_vias`) | seg–sex 5h–21h; sáb 10h–14h; vale em feriado (o ato não excetua) | caminhão | isenção **não confirmada** → VUC tratado como caminhão |
| Osasco | Dec. 10.676/2012, art. 5º (49 incisos; XI e XLVII–XLIX red./incl. pelo Dec. 13.704/2023, art. 2º); mapa; Portaria SETRAN art. 1º IV "a" | VER → **costLines** | seg–sex 7h–9h e 17h–19h, exceto feriados | caminhão | idem |
| Barueri | Dec. 9.025/2019, arts. 4º–6º (JOB ed. 1.169) | VER → costLines (16 trechos; XIII–XVI só no sentido do decreto) | seg–sex 17h–20h, exceto feriados | caminhão | ≤ 2,20 x 6,30 m **só com cadastro** na Sec. de Segurança e Mobilidade Urbana → a rota mantém a restrição e avisa |
| Guarulhos | Dec. 37.887/2021 (arts. 2º–4º) com a redação do Dec. 38.400/2021 (art. 3º) | ZRCC-TB → costLines (ramos do trevo + braços do contorno) | seg–sex 6h–9h e 17h–20h; sáb 10h–14h; vale em feriado | caminhão | ≤ 2,20 x 7,20 m isento |
| Cajamar | Dec. 7.397/2025, arts. 2º, 4º, 5º, 7º e Anexos I–IV | costLines | Anexo I todos os dias: caminhão 7h–9h e 16h–20h, **carreta (> 3 eixos ou > 14 m) 6h–20h**; Anexo II seg–sex (mesma divisão); Anexos III e IV seg–sex 7h–9h e 16h–20h | caminhão/carreta | ≤ 2,20 x 7,20 m isento (o "até 3 t" de capacidade não é verificável) |
| Santana de Parnaíba | Dec. 4.288/2019, art. 1º, I e II, e art. 3º (Imprensa Oficial ed. 298, p. 7) | costLines | Estr. Tenente Marques 16h–19h diariamente; 12 vias 24h | PBT > 15 t | — |
| Santana de Parnaíba | idem, art. 2º, I | exceção de **entrega no município** | só quando o **destino** está no município, e só nas 10 vias de acesso do inciso I (II.1, II.2, II.4–II.11) | carga com nota fiscal para obra/residência/comércio no município | — |
| Ribeirão Pires | Dec. 7.608/2025, arts. 1º, 4º–6º e 15 (DO ed. 44/2026) | ZRC → exclusão | período integral | > 2 eixos **ou** PBT > 16 t | — (AETE, Lei 5.972/2015) |
| ABC (Santo André, SBC, São Caetano, Diadema) | restrição regional de 2012 | `kind=revogada`, `valid_to=2012-04-02` (arquivo de Santo André, fonte `santo-andre`) | — | — | cancelada pelo Consórcio em 02/04/2012, antes de vigorar (DGABC 03/04/2012); não aplicada |

Caminhão = PBT acima de 3,5 t (CTB, Anexo I). A definição de VUC é **por município** (campo `vuc` do arquivo do município): a
pergunta é se o veículo cabe nas dimensões máximas daquele município (largura e comprimento), não o `is_vuc` global.

**Santana de Parnaíba, art. 2º (texto conferido):** "Ficam excluídos da proibição, prevista no inciso II do art. 1º":
I — veículos cuja carga, comprovada por nota fiscal, "deva ser entregue em obras, residências ou estabelecimentos
comerciais situados no perímetro do Município" e cujo acesso se faça por Paiol Velho, Al. das Américas, Marcos
Penteado de Ulhôa Rodrigues, Yojiro Takaoka, Alphanorte, Estr. da Bela Vista, Benedito Crispim de Oliveira, Angola,
Líbano e Luiz Maximiliano Chiló; II — caminhões de **água e concreto (betoneira) de empresas com sede no município**,
com entrega no município, que também podem usar a Av. Pérola Byington. A exceção vale só para o **destino** (sair de
Santana para Barueri não está isento), não alcança a Estr. Tenente Marques (art. 1º, I) e a R. D'Alessandro Carmine
(II.12) não está em nenhum dos dois incisos. O inciso II não é aplicado: o perfil do veículo não informa a carga nem
a sede da empresa.

## Como a rota usa a camada

- **Zonas** (`kind=zona`): `exclusions()` devolve o polígono recuado 20 m (vias-limite livres e folga para o erro do
  georreferenciamento de Osasco) quando a regra está ativa no horário de **saída**, para aquele veículo, considerando
  feriado (`holidays` via `legalDayInfo(at, ibge)`). Origem ou destino dentro da zona: **não exclui**, avisa
  (`rmsp_origem_na_zona` / `rmsp_destino_na_zona`), mesma política da ZMRC de SP.
- **Vias** (`kind=via`): `costLines()` com fator 1000 ("proibido salvo sem alternativa"). O `linear_cost_factors` do
  Valhalla vale **só no sentido do desenho** (testado): vias de mão dupla entram nos dois sentidos; mão única e trechos
  com sentido do decreto (Barueri XIII–XVI), num só. Só entram as vias a até max(2,5 km; 40% da distância O–D) do
  segmento origem–destino, **limitado a 15 km**: numa rota longa (Rio–SP) os 40% pegavam a Grande SP inteira e
  centenas de linhas iam ao Valhalla e à checagem do `routing.ts` (a rota de teste do `altura_osm` estourava 120 s).
- **Linhas curtas**: no import, cada via é cortada em pedaços de até ~400 m e o encadeamento de trechos contíguos para
  em 400 m / 40 vértices. O `routing.ts` e o `annotate` só consideram que a rota "usa" o trecho quando cobre metade da
  linha: com as cadeias de até 4,9 km de antes, uma rota que rodava 2 km da Estr. Tenente Marques dava razão 0,35 e não
  gerava aviso. O item de rota das vias tem id = regra + inciso + rua, para o `routing.ts` (que deduplica por id)
  listar cada rua uma vez em `avoided` e nos avisos, e não cada pedaço.
- **Entrega local** (Santana, art. 2º, I): com **destino** no município (limite IBGE), as 10 vias de acesso do inciso
  I não entram e a rota avisa (`rmsp_destino_local`, info) para levar a nota fiscal. Av. Pérola Byington e
  R. D'Alessandro Carmine continuam restritas.
- **Vias da zona** (`zona_vinculada`): as 12 vias do art. 3º de Osasco seguem a política da ZMRC — com origem ou
  destino dentro da zona, não entram (o aviso de origem/destino na zona já sai).
- `annotate()`:
  - acha as vias perto da rota com a rota subdividida (`ST_Subdivide`, 32 vértices) para o índice espacial não
    devolver a Grande SP inteira numa rota longa;
  - estima o horário de passagem (saída + duração × posição na rota) e avisa quando a rota entra numa zona/via que
    estará ativa nesse momento (`rmsp_zona_ativa_na_passagem`, `rmsp_via_ativa_na_passagem`);
  - mede o uso de cada via com amostras a cada ~15 m (`usoDaLinha`): conta como uso metade da linha **ou** 100 m dela
    a até 10 m da rota; em via de mão única/sentido do ato, só quando a rota anda no mesmo sentido (a pista do sentido
    livre da Av. Aruanã/Paiol Velho em Barueri não conta). 10 m e não os 15 m do `routing.ts`: rota e linhas saem da
    mesma malha (uso real a 1–3 m), e a 15 m o começo de uma alça colada à pista principal contava como uso (alça do
    trevo de Bonsucesso na rota Rio–SP pela Dutra: 56% a 15 m, 21% a 8 m);
  - `rmsp_via_restrita_na_rota` (**danger**): regra ativa na saída **e no horário estimado de passagem**, e a rota usa
    a via, mas o `routing.ts` não vai avisar (via fora do corredor enviado ao Valhalla, ou uso parcial da linha).
    Quando o `routing.ts` já cobre a rua (`uses_restricted_way`), a camada não repete;
  - avisa VUC com cadastro (Barueri), isenção de VUC não confirmada (Osasco), trechos aproximados e entrega local;
    resumo por município em `layers.restricoes_rmsp.summary` e os cruzamentos em `data.hits` (com `uso_m`).
- Mapa: `features()` devolve zonas e vias (estilo linha vermelha), com regra legível e ato em `description`/`source`.
  O `zoom` é decidido no JS (fracionário ou inválido não dá mais 500).

## Geometria — de onde veio e quão boa é

- **Osasco**: o mapa oficial (IOMO 2434, p. 98) é vetorial. `curadoria/osasco_georef.py` extrai os paths, faz uma afim
  inicial com 7 cruzamentos lidos no mapa e casados com nós do OSM, refina com ICP local (quadras do mapa × eixos do
  OSM) e thin-plate spline. Erro típico estimado 10–25 m (conferido no centro, no Rodoanel a oeste e na Praça Iacanga
  ao sul). A ZMRC é o preenchimento verde (3,2 km²). **O polígono não cobre todas as vias do art. 3º** (medido com a
  geometria do OSM): a Av. das Nações Unidas (XII) fica ~220–310 m fora, o Viaduto Pres. Tancredo Neves (XI) 17–95 m
  fora e a Av. Maria Campos (II) está quase toda na faixa de 20 m do recuo. Por isso as 12 vias do art. 3º entram
  também como vias (`osasco_zmrc_vias.geojson`, pelo nome, inteiras dentro de Osasco, 16 km de linhas somando as
  pistas). As VER são os eixos
  azuis (esqueletonizados) casados com o grafo do Valhalla nos dois sentidos (`trace_attributes`), filtrando rodovias,
  transversais e trechos laterais — 67 km. Os 4 incisos de 2023 também são montados pelo nome e trecho do decreto
  (prevalecem sobre o mapa no mesmo way).
- **Barueri, Cajamar, Santana**: nome do decreto casado com o OSM (com variantes: "Alameda Alphaville" = "Avenida
  Alphaville" no OSM, "Alameda das Américas" = "Alameda América", "Avenida Alphanorte" = "Avenida Alfa Norte" etc.);
  "entre X e Y" = caminho mais curto pela própria via entre os cruzamentos com X e Y (respeitando mão única), nas duas
  pistas quando é pista dupla; recorte no limite municipal.
- **Guarulhos**: o Anexo Único é uma imagem sem coordenadas (rotacionada: o topo é o leste). Modelado como os ramos
  (`*_link`) e as vias transversais (Av. Papa João Paulo I, Estr. Pres. Juscelino Kubitschek, Av. Dr. Arthur Marcondes
  de Siqueira) a até 450 m do cruzamento (`guarulhos_vias.geojson`) **mais os dois braços** que o contorno desenha ao
  longo da transversal: Estr. Pres. JK até ~1 km ao sul (lado do Posto Shell) e Av. Dr. Arthur Marcondes de
  Siqueira/Estr. Capuava até ~0,6 km ao norte (`guarulhos_bracos.geojson`, pela malha do Valhalla entre as pontas de
  `trechos` da regra em `3518800.json`). Escala estimada pela largura do trevo no anexo (~1,8 m/px). Pista principal e marginais
  da Dutra ficam livres (testado: nenhuma linha corre sobre o eixo da Dutra).
- **Ribeirão Pires**: o Anexo I é uma imagem sobre base Google; o contorno foi digitalizado à mão sobre a malha do OSM
  (faces entre Av. Pref. Valdírio Prisco, Av. Francisco Monteiro e Av. Capitão José Galo/Av. Kaethe Richers), 0,43 km².
  O Anexo II lista **pontos de entrada/sinalização**, não o perímetro: as ruas dele (Afonso Zampol, Fortuna, Miguel
  Prisco, Boa Vista, Giacomo Sortino, Pres. Kennedy) ficam em boa parte dentro do polígono (até ~200 m do contorno). O
  recuo de 20 m só libera as avenidas do contorno digitalizado.
- No import, toda linha é testada contra o Valhalla (`Failed to edge walk line feature`, error_code 233, derruba o
  `/route` inteiro). Antes do teste, cada parte de MultiLineString vira feição própria e as linhas longas são cortadas
  (≤ 400 m). A que não casa é reencaixada (`map_snap`) ou descartada (na carga atual: 1 pedaço de 250 m da Estr.
  Tenente Marques e 1 alça de 246 m do trevo de Bonsucesso). Erro de rede/timeout: tenta de novo; sem teste, a linha é
  tratada como falha (`valhalla_validado` só é `true` quando testou) e mais de 5 linhas sem teste abortam o import.
  **Depois de reconstruir os tiles do Valhalla, rode os importadores de novo** para revalidar (feito em 09/10/2026 com
  o grafo com elevação ANADEM).

Carga atual (`data_features`, layer `restricoes_rmsp`): osasco 1 zona + 380 linhas (VER 67 km + vias da ZMRC 16 km);
barueri 97 (24,4 km); guarulhos 37 (7,3 km); cajamar 69 (17,4 km); santana-parnaiba 182 (50,8 km);
ribeirao-pires 1 zona (0,43 km²); ibge 39 limites municipais + 1 registro revogado (ABC 2012). Linha mais longa: 439 m.

### Trechos aproximados (`props.aproximado = true`, aviso `rmsp_trecho_aproximado`)

- Barueri inc. I — Al. Alphaville "entre o nº 1.555 e a Al. Mamoré": numeração não existe no OSM; aplicado da Al. Mamoré
  até o limite norte de Barueri (pode ser maior que o do decreto).
- Cajamar Anexo I.1 (Av. Prof. Walter Ribas de Andrade, rotatória do Paço não identificada: via inteira), Anexo II
  (Av. Tenente Marques entre as duas rotatórias do Polvilho; Estádio e R. Pe. Luiz Chrispim não estão no OSM),
  III.2 (R. Guapiara não está no OSM: até a ponta leste) e III.5 (trecho sem nome no OSM, definido pelos cruzamentos).
- Guarulhos (recorte do Anexo Único e pontas dos braços estimadas pela escala) e Ribeirão Pires (contorno digitalizado).

## Decisões

- **Vias do art. 3º de Osasco inteiras**: o Dec. 13.704/2023 lista as 12 vias da ZMRC **sem trecho** e o caput do
  art. 3º (texto de 2012) não está online; o SETCESP (14/02/2012, sobre o decreto anterior, 10.661/2012) descreve a
  ZMRC como o centro expandido que "compreende" as vias listadas. Lado seguro e leitura literal: cada via vale inteira
  dentro de Osasco no horário da ZMRC (somando as pistas no OSM: Av. Visconde de Nova Granada 4 km, Av. Santo
  Antônio 2,9 km, Av. das Nações Unidas 2,3 km). Se a SETRAN/DEMUTRAN confirmar que a ZMRC é só o centro, basta recortar `osasco_zmrc_vias` pelo
  polígono (com folga) no arquivo `3534401.json`.
- **VER dentro da ZMRC de Osasco**: o mapa marca como VER vias que atravessam a ZMRC (Av. dos Autonomistas, Av. João
  Batista...). Sem o texto de 2012 não dá para saber se elas ficam liberadas fora do pico. A rota mantém a ZMRC inteira
  proibida no horário dela (lado seguro); se a SETRAN confirmar que as VER são corredores, basta trocar a zona por
  polígonos recortados pelos eixos VER.
- **VUC de Osasco** (6,30 m segundo o SETCESP 2012) não confirmado → regra desativada (VUC = caminhão), com aviso.
- **VUC de Barueri** exige cadastro e o veículo da API não tem esse dado → a restrição vale para o VUC, com aviso.
  Quando existir um campo de autorizações municipais no veículo, a regra já traz `vuc.exige_cadastro`.
- **Santana, art. 2º**: só destino, só as vias do inciso I; o inciso II (betoneira/água de empresa com sede no
  município) não é aplicado (o veículo não informa carga nem sede).
- **Feriados**: só suspende quando o ato diz "exceto feriados" (VER de Osasco e de Barueri). Feriados **municipais**
  desses municípios ainda não estão em `holidays` (lá só nacionais/SP); nesses dias a restrição continua (lado seguro).
- **Horário**: avaliado na saída (como a ZMRC de SP); a estimativa de passagem só gera aviso.
- Severidade: `warn` para origem/destino na zona e passagem em horário restrito; `info` para VUC, entrega local e
  trecho aproximado; `danger` para "trecho restrito sem alternativa" (`uses_restricted_way`, do `routing.ts`) e para
  `rmsp_via_restrita_na_rota` (o que o `routing.ts` não consegue ver).
- O `routing.ts` já deduplica `avoided`/avisos por id e testa o **sentido** no uso de cada linha de custo (commit
  "rota: uso de trecho penalizado sensível ao sentido"): as duas linhas de uma via de mão dupla e os pedaços de uma
  mesma rua aparecem uma vez só. Mudança mínima feita no núcleo por esta frente: `usesCostLine` mede cada linha só
  contra o trecho da rota perto dela (mesmo resultado, sem percorrer a rota inteira por linha).

## Licenças

- Atos oficiais (decretos, portarias, mapas publicados nos diários): domínio público (Lei 9.610/1998, art. 8º, IV).
- Geometria das vias e do contorno de Ribeirão Pires: OpenStreetMap, **ODbL 1.0** (© colaboradores do OSM) — base
  derivada mantida separada (`data_features`), nunca exportada para o OSM.
- **Polígono da ZMRC de Osasco**: vem do mapa oficial, mas foi ajustado aos eixos do OSM (ICP + thin-plate spline),
  então também é **derivado do OSM (ODbL 1.0)** — registrado no `LICENSE` do importador e em `meta.sources`.
- Limites municipais: IBGE Malha Municipal (dados públicos, citar a fonte).
- Querido Diário (OKBR) só como espelho dos diários de Osasco (o ato é público).
- O Guia de Restrições IPTC/SETCESP é pago e **não** foi usado como dado (a notícia aberta do SETCESP de 2012 só foi
  usada para interpretar o art. 3º de Osasco).

## Como atualizar

1. Conferir o ato na fonte primária e editar o arquivo do município em `data/raw/municipios/` (janelas, alvo, VUC, base
   legal com ato e artigo, `trechos`); validar com `python -m sources.municipios --validar` (ver
   `restricoes_municipais.md`). Mudança intencional: regravar os digests `exato` do teste (`ATUALIZAR=1`).
2. Refazer a geometria de nome/trecho: `MUNICIPIOS_REBUILD=1` no importador (consulta o Overpass, cache em
   `data/cache/municipios/`; trechos `caminho: valhalla` usam o Valhalla) e revisar `pendencias` no GeoJSON gerado.
   Para refazer só um arquivo, apague o GeoJSON curado correspondente (ex.: `guarulhos_bracos.geojson`).
3. Osasco: `WORK=/tmp/osasco python3 data/raw/rmsp/curadoria/osasco_georef.py` (fora da imagem do importador; requer
   numpy, scipy, shapely, pyproj, scikit-image, networkx, requests e poppler; `--refit` refaz os pontos de controle).
   A execução completa é lenta (uma rodada levou mais de 1 h: parsing de ~75 mil paths do PDF) e reproduziu a ZMRC
   com 23 m² de diferença simétrica.
4. Carregar (com o Valhalla no ar — as linhas são validadas contra o grafo):
   `docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e VALHALLA_URL=http://valhalla:8002 -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer municipios:ibge,3534401,3505708,3518800,3509205,3547304,3543303,3547809`
   (só um município: `municipios:3505708`). Em 10/10/2026 só foram regravados os seeds sem vias (`ibge`,
   `ribeirao-pires`, `santo-andre`); os de Osasco, Barueri, Guarulhos, Cajamar e Santana são os do importador antigo
   (equivalentes, conferido por digest) até a próxima carga com o Valhalla.
5. Vigilância sugerida: Querido Diário por município ("trânsito de caminhões", "circulação de caminhões", "10.676",
   "Vias Estruturais Restritas"); o diário de Barueri não tem busca para 2023–2026.

## Limitações conhecidas e pendências

- **Osasco, Dec. 10.676/2012**: o texto não está online (45 incisos originais de VER, exceções, VUC, caput do
  art. 3º). Pedir via e-SIC/SETRAN. As 45 VER originais vêm só do mapa. O SETCESP de 2012 cita ainda as **VMRC** (Vias
  de Máxima Restrição de Circulação, acessos das rodovias, seg–sex 5h–24h) do decreto anterior; o mapa de 2023 só tem
  ZMRC e VER, então as VMRC não foram modeladas — confirmar se ainda existem.
- Barueri: não dá para descartar alteração do Dec. 9.025/2019 entre 2023 e 2026 (busca do diário incompleta).
- Guarulhos: o Dec. 22.911/2004 delega ao Departamento de Trânsito criar áreas por ato próprio; portarias não
  indexadas podem existir. As pontas dos braços da ZRCC-TB são estimadas (anexo sem coordenadas).
- Feriados municipais dos municípios da camada não estão em `holidays` (nesses dias a restrição continua).
- O perfil do veículo não tem autorizações municipais (cadastro de VUC em Barueri, AETE de Ribeirão Pires, cadastro de
  Cajamar) nem tipo de carga/sede da empresa (Santana art. 2º, II): a rota não aplica essas exceções, só as cita.
- Exceções por atividade (correios, coleta, betoneira em operação etc.) também não estão no perfil do veículo.
- Sem geometria/regra: Cotia (só placas), Diadema (2011, sem ato primário), Taboão, Mogi, Suzano e os demais.
- Desempenho: com Osasco inteira ativa (pico), ~320 linhas de custo numa rota dentro de Osasco e ~530 numa rota
  Osasco–Penha (os pedaços de 400 m e as vias da ZMRC aumentaram o número). O Valhalla absorve bem (~0,3 s com 530
  linhas); o gargalo era a checagem de uso do `routing.ts`, que media cada linha contra a rota inteira — agora ela só
  olha o trecho da rota perto de cada linha (Osasco–Penha às 8h: de 70–160 s para ~30 s, o resto é annotate de outras
  camadas; o `annotate` desta camada leva ~0,3 s nessa rota).
- O `routing.ts` só checa as linhas que recebeu e usa razão ≥ 50%: os casos que ele não vê (via fora do corredor,
  uso parcial) são cobertos pelo aviso `rmsp_via_restrita_na_rota` da camada, não por desvio.
- O uso de via é geométrico (10 m): numa via de mão dupla sem sentido no ato, uma rua paralela a menos de 10 m
  (marginal colada) usada por mais de 100 m pode contar como uso (falso positivo raro; nas de sentido único o rumo da
  rota filtra). O `routing.ts` usa 15 m: numa rota pela Dutra no pico da ZRCC-TB, o começo de uma alça colada à pista
  pode gerar `uses_restricted_way` falso (follow-up do núcleo: tolerância menor ou recorte das pontas das alças).
- Rotas longas: o corredor de 15 km deixa de fora vias distantes do segmento O–D; se a rota desviar e usar uma delas,
  não há desvio, só o aviso `rmsp_via_restrita_na_rota`.
