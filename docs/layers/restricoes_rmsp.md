# Camada `restricoes_rmsp` — restrições de caminhão nos municípios da Grande SP

Restrições municipais a caminhões **fora da capital**: Osasco (ZMRC + VER), Barueri (VER), Guarulhos (ZRCC-TB, Trevo
de Bonsucesso), Cajamar (Anexos I–IV), Santana de Parnaíba (PBT > 15 t) e Ribeirão Pires (ZRC). A restrição
regional do ABC de 2012 fica registrada como **revogada** e nunca é aplicada.

Peças:

| Peça | Arquivo |
|---|---|
| Regras legais (horários, dimensões, VUC, exceções, ato e artigo, URL conferida) | `data/raw/rmsp/regras.json` |
| Geometria curada (versionada; o import não depende do Overpass) | `data/raw/rmsp/*.geojson` |
| Curadoria do mapa vetorial de Osasco (georreferenciamento) | `data/raw/rmsp/curadoria/osasco_georef.py` + pontos de controle |
| Importadores | `importers/sources/rmsp_*.py` (`rmsp_municipios.py` também é a biblioteca comum) |
| Seeds | `db/seed/layers/restricoes_rmsp__<fonte>.sql` |
| API | `api/src/layers/restricoes_rmsp.layer.ts` |
| Testes | `api/test/layers/rmsp.test.ts` (18 testes) |

Não foi preciso migration (usa `data_features`/`data_layer_runs` e o calendário legal `holidays`).

## Regras implementadas (conferidas na fonte primária em 09/10/2026)

| Município | Ato | Tipo no app | Quando | Quem | VUC |
|---|---|---|---|---|---|
| Osasco | Dec. 10.676/2012, art. 3º (red. Dec. 13.704/2023, art. 1º); mapa DEMUTRAN (IOMO 2434, p. 98); Portaria SETRAN (IOMO 2487, art. 1º IV "c") | ZMRC → **exclusão** (polígono) | seg–sex 5h–21h; sáb 10h–14h; vale em feriado (o ato não excetua) | caminhão | isenção **não confirmada** → VUC tratado como caminhão |
| Osasco | Dec. 10.676/2012, art. 5º (49 incisos; XI e XLVII–XLIX red./incl. pelo Dec. 13.704/2023, art. 2º); mapa; Portaria SETRAN art. 1º IV "a" | VER → **costLines** | seg–sex 7h–9h e 17h–19h, exceto feriados | caminhão | idem |
| Barueri | Dec. 9.025/2019, arts. 4º–6º (JOB ed. 1.169) | VER → costLines (16 trechos; XIII–XVI só no sentido do decreto) | seg–sex 17h–20h, exceto feriados | caminhão | ≤ 2,20 x 6,30 m **só com cadastro** na Sec. de Segurança e Mobilidade Urbana → a rota mantém a restrição e avisa |
| Guarulhos | Dec. 37.887/2021 (arts. 2º–4º) com a redação do Dec. 38.400/2021 (art. 3º) | ZRCC-TB → costLines (ramos do trevo) | seg–sex 6h–9h e 17h–20h; sáb 10h–14h; vale em feriado | caminhão | ≤ 2,20 x 7,20 m isento |
| Cajamar | Dec. 7.397/2025, arts. 2º, 4º, 5º, 7º e Anexos I–IV | costLines | Anexo I todos os dias: caminhão 7h–9h e 16h–20h, **carreta (> 3 eixos ou > 14 m) 6h–20h**; Anexo II seg–sex (mesma divisão); Anexos III e IV seg–sex 7h–9h e 16h–20h | caminhão/carreta | ≤ 2,20 x 7,20 m isento (o "até 3 t" de capacidade não é verificável) |
| Santana de Parnaíba | Dec. 4.288/2019, arts. 1º–3º | costLines | Estr. Tenente Marques 16h–19h diariamente; 12 vias 24h | PBT > 15 t | — |
| Santana de Parnaíba | idem, art. 2º | exceção de **destino local** | — | carga para o município | — |
| Ribeirão Pires | Dec. 7.608/2025, arts. 1º, 4º–6º e 15 (DO ed. 44/2026) | ZRC → exclusão | período integral | > 2 eixos **ou** PBT > 16 t | — (AETE, Lei 5.972/2015) |
| ABC (Santo André, SBC, São Caetano, Diadema) | restrição regional de 2012 | `kind=revogada`, `valid_to=2012-04-03` | — | — | cancelada pelo Consórcio antes de vigorar (DGABC 03/04/2012); não aplicada |

Caminhão = PBT acima de 3,5 t (CTB, Anexo I). A definição de VUC é **por município** (`regras.json → vuc`): a
pergunta é se o veículo cabe nas dimensões máximas daquele município (largura e comprimento), não o `is_vuc` global.

## Como a rota usa a camada

- **Zonas** (`kind=zona`): `exclusions()` devolve o polígono recuado 20 m (vias-limite livres e folga para o erro do
  georreferenciamento de Osasco) quando a regra está ativa no horário de **saída**, para aquele veículo, considerando
  feriado (`holidays` via `legalDayInfo(at, ibge)`). Origem ou destino dentro da zona: **não exclui**, avisa
  (`rmsp_origem_na_zona` / `rmsp_destino_na_zona`), mesma política da ZMRC de SP.
- **Vias** (`kind=via`): `costLines()` com fator 1000 ("proibido salvo sem alternativa"). O `linear_cost_factors` do
  Valhalla vale **só no sentido do desenho** (testado): vias de mão dupla entram nos dois sentidos; mão única e trechos
  com sentido do decreto (Barueri XIII–XVI), num só. Só entram as vias a até max(2,5 km; 40% da distância O–D) do
  segmento origem–destino.
- **Destino local** (Santana): se origem ou destino estão no município (limite IBGE), as vias 24h não entram e a rota
  avisa para levar a nota fiscal.
- `annotate()`: estima o horário de passagem (saída + duração × posição na rota) e avisa quando a rota entra numa
  zona/via que estará ativa nesse momento (`rmsp_zona_ativa_na_passagem`, `rmsp_via_ativa_na_passagem`); avisa VUC
  com cadastro (Barueri), isenção de VUC não confirmada (Osasco), trechos aproximados e destino local; resumo por
  município em `layers.restricoes_rmsp.summary` e os cruzamentos em `data.hits`.
- Mapa: `features()` devolve zonas e vias (estilo linha vermelha), com regra legível e ato em `description`/`source`.

## Geometria — de onde veio e quão boa é

- **Osasco**: o mapa oficial (IOMO 2434, p. 98) é vetorial. `curadoria/osasco_georef.py` extrai os paths, faz uma afim
  inicial com 7 cruzamentos lidos no mapa e casados com nós do OSM, refina com ICP local (quadras do mapa × eixos do
  OSM) e thin-plate spline. Erro típico estimado 10–25 m (conferido no centro, no Rodoanel a oeste e na Praça Iacanga
  ao sul). A ZMRC é o preenchimento verde (3,2 km²; as 12 vias do art. 3º ficam dentro ou na borda). As VER são os
  eixos azuis (esqueletonizados) casados com o grafo do Valhalla nos dois sentidos (`trace_attributes`), filtrando
  rodovias, transversais e trechos laterais — 67 km. Os 4 incisos de 2023 também são montados pelo nome e trecho do
  decreto (prevalecem sobre o mapa no mesmo way).
- **Barueri, Cajamar, Santana**: nome do decreto casado com o OSM (com variantes: "Alameda Alphaville" = "Avenida
  Alphaville" no OSM, "Alameda das Américas" = "Alameda América", "Avenida Alphanorte" = "Avenida Alfa Norte" etc.);
  "entre X e Y" = caminho mais curto pela própria via entre os cruzamentos com X e Y (respeitando mão única), nas duas
  pistas quando é pista dupla; recorte no limite municipal.
- **Guarulhos**: o Anexo Único é uma imagem; modelado como os ramos (`*_link`) e as vias transversais (Av. Papa João
  Paulo I, Estr. Pres. Juscelino Kubitschek, Av. Dr. Arthur Marcondes de Siqueira) a até 450 m do cruzamento. Pista
  principal e marginais da Dutra ficam livres.
- **Ribeirão Pires**: o Anexo I é uma imagem sobre base Google; o contorno foi digitalizado à mão sobre a malha do OSM
  (faces entre Av. Pref. Valdírio Prisco, Av. Francisco Monteiro e Av. Capitão José Galo/Av. Kaethe Richers), 0,43 km².
- No import, toda linha é testada contra o Valhalla (`Failed to edge walk line feature` derruba o `/route` inteiro):
  a que não casa é reencaixada (`map_snap`) ou descartada (2 trechos descartados na carga atual), e trechos contíguos
  da mesma via são encadeados (≈ 50% menos linhas). **Depois de reconstruir os tiles do Valhalla, rode os importadores
  de novo** para revalidar.

### Trechos aproximados (`props.aproximado = true`, aviso `rmsp_trecho_aproximado`)

- Barueri inc. I — Al. Alphaville "entre o nº 1.555 e a Al. Mamoré": numeração não existe no OSM; aplicado da Al. Mamoré
  até o limite norte de Barueri (pode ser maior que o do decreto).
- Cajamar Anexo I.1 (Av. Prof. Walter Ribas de Andrade, rotatória do Paço não identificada: via inteira), Anexo II
  (Av. Tenente Marques entre as duas rotatórias do Polvilho; Estádio e R. Pe. Luiz Chrispim não estão no OSM),
  III.2 (R. Guapiara não está no OSM: até a ponta leste) e III.5 (trecho sem nome no OSM, definido pelos cruzamentos).
- Guarulhos (recorte do Anexo Único) e Ribeirão Pires (contorno digitalizado).

## Decisões

- **VER dentro da ZMRC de Osasco**: o mapa marca como VER vias que atravessam a ZMRC (Av. dos Autonomistas, Av. João
  Batista...). Sem o texto de 2012 não dá para saber se elas ficam liberadas fora do pico. A rota mantém a ZMRC inteira
  proibida no horário dela (lado seguro); se a SETRAN confirmar que as VER são corredores, basta trocar a zona por
  polígonos recortados pelos eixos VER.
- **VUC de Osasco** (6,30 m segundo o SETCESP 2012) não confirmado → regra desativada (VUC = caminhão), com aviso.
- **VUC de Barueri** exige cadastro e o veículo da API não tem esse dado → a restrição vale para o VUC, com aviso.
  Quando existir um campo de autorizações municipais no veículo, a regra já traz `vuc.exige_cadastro`.
- **Feriados**: só suspende quando o ato diz "exceto feriados" (VER de Osasco e de Barueri). Feriados **municipais**
  desses municípios ainda não estão em `holidays` (lá só nacionais/SP); nesses dias a restrição continua (lado seguro).
- **Horário**: avaliado na saída (como a ZMRC de SP); a estimativa de passagem só gera aviso.
- Severidade: `warn` para origem/destino na zona e passagem em horário restrito; `info` para VUC, destino local e
  trecho aproximado; o `danger` "trecho restrito sem alternativa" vem do `routing.ts` quando a rota não tem saída.

## Licenças

- Atos oficiais (decretos, portarias, mapas publicados nos diários): domínio público (Lei 9.610/1998, art. 8º, IV).
- Geometria das vias e do contorno de Ribeirão Pires: OpenStreetMap, **ODbL 1.0** (© colaboradores do OSM) — base
  derivada mantida separada (`data_features`), nunca exportada para o OSM. O georreferenciamento de Osasco usa o OSM
  só como referência de pontos de controle; o polígono da ZMRC é do mapa oficial.
- Limites municipais: IBGE Malha Municipal (dados públicos, citar a fonte).
- Querido Diário (OKBR) só como espelho dos diários de Osasco (o ato é público).
- O Guia de Restrições IPTC/SETCESP é pago e **não** foi usado como dado.

## Como atualizar

1. Conferir o ato na fonte primária e editar `data/raw/rmsp/regras.json` (janelas, alvo, VUC, base legal, `trechos`).
2. Refazer a geometria de nome/trecho: `RMSP_REBUILD=1` no importador (consulta o Overpass, cache em `data/cache/rmsp/`;
   trechos `caminho: valhalla` usam o Valhalla) e revisar `pendencias` no GeoJSON gerado.
3. Osasco: `WORK=/tmp/osasco python3 data/raw/rmsp/curadoria/osasco_georef.py` (fora da imagem do importador; requer
   numpy, scipy, shapely, pyproj, scikit-image, networkx, requests e poppler; `--refit` refaz os pontos de controle).
   A execução completa é lenta (dezenas de minutos: parsing de ~75 mil paths do PDF).
4. Carregar:
   `docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e VALHALLA_URL=http://valhalla:8002 -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer rmsp_municipios rmsp_osasco rmsp_barueri rmsp_guarulhos rmsp_cajamar rmsp_santana_parnaiba rmsp_ribeirao_pires`
5. Vigilância sugerida: Querido Diário por município ("trânsito de caminhões", "circulação de caminhões", "10.676",
   "Vias Estruturais Restritas"); o diário de Barueri não tem busca para 2023–2026.

## Limitações conhecidas

- O texto do Dec. 10.676/2012 (Osasco) não está online: as 45 VER originais vêm só do mapa; exceções e VUC do texto
  original não foram vistos. Pedir via e-SIC/SETRAN.
- Barueri: não dá para descartar alteração do Dec. 9.025/2019 entre 2023 e 2026 (busca do diário incompleta).
- Guarulhos: o Dec. 22.911/2004 delega ao Departamento de Trânsito criar áreas por ato próprio; portarias não
  indexadas podem existir.
- Sem geometria/regra: Cotia (só placas), Diadema (2011, sem ato primário), Taboão, Mogi, Suzano e os demais.
- Desempenho: com Osasco inteira ativa (pico), ~200 linhas de custo; a rota leva ~3–4 s, a maior parte no cálculo de
  sobreposição do `routing.ts` (turf).
- Exceções por atividade (correios, coleta, betoneira em operação, AETE etc.) não estão no perfil do veículo:
  aparecem no texto da regra, mas a rota não as aplica.
