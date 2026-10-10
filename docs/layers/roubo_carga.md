# Camada `roubo_carga` — roubo e furto de carga por área e horário

Camada **informativa** (grupo `seguranca`): não muda a rota. Mostra no mapa células de 1 km com ocorrências de roubo
ou furto de carga e, no resultado da rota, um resumo e até 5 avisos `warn` que **dependem do horário**: a API estima a
hora em que o veículo passa por cada área e só avisa onde há histórico relevante **naquela faixa do dia**.

| Peça | Arquivo |
|---|---|
| Importador | `importers/sources/roubo_carga_ssp.py` |
| Seed | `db/seed/layers/roubo_carga__ssp-sp.sql` (0,4 MB) |
| API | `api/src/layers/roubo_carga.layer.ts` |
| Testes | `api/test/layers/seguranca.test.ts` |

## Fonte e licença

- **SSP-SP — microdados de boletins de ocorrência** (`SPDadosCriminais_AAAA.xlsx`), listados em
  `https://www.ssp.sp.gov.br/assets/estatistica/transparencia/spDados160_516.json` (página "SP Dados" do portal da SSP).
  ~700 mil linhas por ano, 126–218 MB por arquivo, lat/lon em 99% dos roubos de carga.
- **Licença**: os arquivos não trazem licença explícita. O Plano de Dados Abertos da SSP (2025–2027) fala em "formatos
  abertos e reutilizáveis" e cita o Decreto SP 68.769/2024, que no art. 1º §1º trata as informações de transparência
  ativa como "de livre utilização pela sociedade" e no art. 2º, V define dado aberto como disponível sob licença aberta
  que permita livre utilização e reutilização. **Incerteza:** para uso comercial convém confirmar via SIC. A camada só
  publica agregados.
- Conferência: o importador compara o total de ROUBO DE CARGA do ano corrente nos microdados com a API de estatísticas
  mensais da SSP (`/v1/OcorrenciasMensais/RecuperaDadosMensaisAgrupados`). Carga de 09/10/2026: **1.638 × 1.638**.
- Nomes de município pela API de localidades do IBGE (a SSP abrevia: "S.Paulo", "S.Bernardo do Campo").
- Os dados ficam em `data_features` (`layer_id = 'roubo_carga'`), fora do OSM, e nunca vão para o OSM.

## Método (importador)

1. Baixa em streaming os **dois arquivos mais recentes** publicados (ano corrente e anterior; hoje 2025 e 2026 até 08/2026)
   para `data/cache/ssp` e lê o XLSX com `iterparse` (sharedStrings + abas, liberando as linhas lidas): sem openpyxl,
   sem pandas, sem carregar a planilha. ~50 s por arquivo.
2. Fica só com `NATUREZA_APURADA` = **ROUBO DE CARGA** ou **FURTO DE CARGA**; remove duplicatas por
   (NUM_BO, ANO_BO, delegacia, natureza). Carga de 09/10/2026: 5.108 roubos + 760 furtos; 142 sem coordenada.
3. **Faixa do dia** pela `HORA_OCORRENCIA_BO` (fração de dia do Excel, com tolerância de arredondamento) ou, sem hora, pela
   `DESC_PERIODO` da SSP: madrugada 0h–5h59, manhã 6h–11h59, tarde 12h–17h59, noite 18h–23h59.
   No estado: madrugada 12%, manhã 48%, tarde 28%, noite 11%, sem hora 1%.
4. **Células de 1 km** (EPSG:5880) publicadas como polígono, com **pelo menos 3 ocorrências**. Propriedades: `total`,
   `roubo`, `furto`, `periodo` (por faixa), `pico`, `local` (via pública, rodovia, acostamento, posto, outro),
   `fim_de_semana`, `municipio`, `regiao`/`via` (só quando ao menos 3 ocorrências da célula têm o mesmo bairro/logradouro),
   `nivel` (`muito_alto` ≥ 25, `alto` ≥ 10, senão `moderado`, somando os dois anos), `anos`, `periodo_dados`.
   Carga de 09/10/2026: 593 células (9 muito alto, 91 alto).

**Privacidade:** nenhum número de BO, endereço com número, data, hora ou coordenada individual sai do importador; os
nomes de via/bairro só aparecem quando representam 3 ou mais ocorrências. Registros com "VEDAÇÃO DA DIVULGAÇÃO" ficam sem nome.

## Na rota (API)

- `annotate`: células que a rota **atravessa** (`featuresNearRoute` com raio 0). A posição de cada célula na rota dá a
  **hora estimada de passagem** = saída + fração da rota × duração (proporcional à distância). Células a até 1,5 km uma
  da outra ao longo da rota formam um **trecho** (máx. 5 km). Para cada trecho soma-se `na_passagem` = ocorrências da
  faixa em que o veículo passa por *cada* célula.
  `na_passagem_por_faixa` separa essa soma pela faixa de passagem, na ordem da rota (um trecho pode atravessar a virada
  de faixa, ex.: entra 11:59 e sai 12:02).
- Aviso `warn` (`code: cargo_theft_area`) para os **5 trechos** com mais ocorrências na faixa de passagem, desde que
  `na_passagem` ≥ **5** (≈ uma ocorrência a cada 4 meses naquela faixa de 6 h, numa área de poucos km²). Ex.:
  "Roubo de carga na região de Rua dos Condoreiros, São Paulo (km 18–22 da rota, ~09:22): 37 ocorrências de manhã em
  2025–2026 (67 no total). Evite parar na região; se precisar, use local vigiado."
  Se o trecho atravessa a virada de faixa, o texto cita cada faixa com a sua contagem (faixas sem ocorrência ficam de
  fora): "Roubo de carga na região de Rodovia Presidente Dutra, Guarulhos (km 31–32 da rota, ~11:59): 2 ocorrências de
  manhã e 10 à tarde (horário de passagem) em 2025–2026 (35 no total). ..." (CEAGESP → Guarulhos saindo às 11:20).
- Resumo: nº de áreas atravessadas, total de ocorrências e quantas na faixa de passagem; faixa mais crítica na rota e se
  o veículo passa nela ("se puder, ajuste a saída"); se não houver aviso, diz isso. `data` traz `por_faixa`, `pico`,
  `na_passagem` e até 50 trechos.
- Mudar o horário de saída muda os avisos (ex.: CEAGESP → Guarulhos às 9h tem 5 avisos; às 3h, menos e "de madrugada").
- `features`: polígonos (fill) com até 12 propriedades exibíveis (o popup genérico do mapa corta em 12): nome, nível,
  ocorrências, anos, roubos, furtos, as 4 faixas do dia e `local` ("via pública 12 · rodovia/acostamento 0 · posto 0").
  A fonte aparece no rodapé do popup (`meta.sources`); não há `weight` (o estilo é fill). Zoom < 8 só "muito alto";
  < 10 alto e muito alto; a partir de 10 todas.
- Severidade nunca é `danger`: é risco, não restrição legal.

## Como atualizar

```sh
docker compose --profile import run --rm importer roubo_carga_ssp
```
O arquivo do ano corrente é rebaixado se o cache tiver mais de 7 dias (o do ano anterior, 60 dias). A SSP publica o
arquivo do ano corrente mensalmente. Na virada do ano, o importador passa sozinho a usar os dois anos mais recentes.

## Limitações

- **Só o estado de SP.** Para outros estados há apenas números por UF (Sinesp VDE), por município (SEJUSP-MG) ou por
  área de delegacia (ISP-RJ), sem coordenada; não entram aqui (ver a seção seguinte).
- **Subnotificação e local do BO**: a coordenada é a do local informado no BO; parte dos roubos é registrada onde a
  carga/veículo foi achado ou onde a vítima foi liberada.
- **Células de 1 km**: a ocorrência pode ter sido numa rua paralela à rota, não na via usada; por isso o texto fala em
  "região".
- **Hora de passagem** aproximada (proporcional à distância; sem trânsito real nem paradas). Não considera dia da
  semana (o dado de fim de semana está em `props.fim_de_semana`, não usado no aviso).
- **Volume absoluto**, sem normalizar pela quantidade de caminhões que passam.
- Os anos são os de **estatística** da SSP (`ANO_ESTATISTICA`); algumas ocorrências de 2025 têm data de 2024 (BO
  registrado depois).

## Rio de Janeiro, Minas Gerais e Espírito Santo: sem coordenada (não implementado)

Pesquisa de 10/10/2026 (`seguranca_rj_mg_es`, com as correções da verificação). Nenhum dos três estados publica roubo de
carga com coordenada, então nada entra no mapa nem na rota com o método de SP (células de 1 km). A tarefa admitia um aviso
informativo por município ou por área de delegacia **só com dado agregado de licença clara**. Nenhuma fonte cumpre essa
condição, por isso **não há importador nem aviso** para esses estados.

| UF | O que existe | Granularidade | Licença | Decisão |
|---|---|---|---|---|
| MG | SEJUSP, base completa por REDS no Google Drive (pasta `1CjziaHx_ehpY6XozeV5FIR-zoCfCjh8k`): `Alvo - Roubo Consumado - Jan 2015 a Ago 2026.csv` (197 MB, 635.714 linhas) e `Alvo - Furto Consumado - Jan 2022 a Ago 2026.csv`. Também há um agrupado (município × mês × alvo) no portal da SEJUSP | Município. Tem data, hora, faixa, meio, tipo de local e bairro; **não tem lat/lon nem nome do logradouro** | Nenhuma licença nomeada (CKAN da SEJUSP com `license_id` vazio). Base legal genérica: Decreto MG 48.383/2022, art. 22 (dados de transparência ativa de livre utilização, observados o art. 6º da LGPD e a Lei 14.129/2021). Para uso comercial, a própria pesquisa recomenda confirmar por pedido de acesso à informação | Não implementado |
| RJ | ISP: série mensal por CISP (`BaseDPEvolucaoMensalCisp.csv`, até 08/2026) e polígonos das 137 CISPs (`CISPshp.rar`, RAR v5, WGS84, mediana de 169,4 km²) | Área de delegacia (CISP), **sem horário** e sem tipo de local | Nenhuma licença nos arquivos públicos. A Portaria ISP nº 127/2022, art. 3º §1º, diz que as bases disponibilizadas pelo ISP não podem ser comercializadas "em nenhuma hipótese". O texto não limita isso de forma expressa aos dados fornecidos sob pedido. Licença **incerta** | Não implementado; pedir ao ISP, por escrito, autorização para uso comercial dos dados de transparência ativa |
| ES | SESP-ES não publica roubo de carga (busca "carga" no CKAN: 0 resultados). O `roubo-veiculo` (CC-BY) tem 6.239 linhas por veículo (6.116 BOs) de 2023 a 2025, 77 com caminhão, sem coordenada | — | — | Não implementado: 7 roubos de carga no estado em 2025 (Sinesp VDE) |

**Números conferidos (verificação de 10/10/2026):**
- **MG, roubo de carga (alvo "Cargas")**: 662 em 2015, 217 em 2024, 132 em 2025 e 59 em jan–ago/2026. O total de 2025
  bate com o Sinesp VDE (132). Em 2025–26 (191 casos): 104 em rodovia (54%), 84 entre 0h e 6h (44%), 124 com arma de
  fogo (65%). Municípios: Contagem 25, Belo Horizonte 24, Betim 16. O padrão é madrugada e rodovia, diferente de SP.
- **MG, furto de carga**: 536 em 2025 e 297 em jan–ago/2026, cerca de 4 vezes o roubo; 48% em rodovia em 2025–26.
- **MG, veículos roubados**: em 2025, 297 caminhões, caminhões-trator, semirreboques e reboques. Sem coordenada.
- **RJ, roubo de carga (ISP)**: 3.113 em 2025 (o Sinesp dá 3.777, por diferença de metodologia) e 2.035 em jan–ago/2026,
  em 87 CISPs com pelo menos 1 caso. Maiores em 2025: CISP 59 Duque de Caxias (Centro) 402, 60 Campos Elyseos 287,
  64 São João de Meriti 212, 21 Bonsucesso/Maré 194 e 39 Pavuna 165. As 10 maiores somam 60,7% de 2025–26.
- **Sinesp VDE 2025**: RJ 3.777, SP 3.470, MG 132, ES 7. Para roubo de carga nesses estados a coluna de município vem
  "NÃO INFORMADO", então o Sinesp só serve por UF.
- **Microdados do ISP sob pedido** (Portaria ISP 127/2022, art. 2º §2º): desagregação máxima CISP, AISP, RISP, bairro e
  município, sem coordenada, e com proibição de comercializar e de repassar a terceiros. Não servem para o app.
- **Rio, data.rio**: o mapa antigo "Roubo de Cargas" aponta para um serviço ArcGIS que responde 404. Não há pontos.

**Por que não implementar, além da licença:**
- MG: 132 roubos de carga por ano no estado inteiro, espalhados por município (Belo Horizonte tem 331 km²). Um aviso como
  "no município de Contagem houve 25 roubos em 20 meses" pouco ajuda a decidir onde parar.
- RJ: o volume é alto (mais que SP no Sinesp), mas a CISP mediana tem 169 km² e não há horário. O aviso não poderia
  depender da hora de passagem, que é o que dá valor à camada em SP.

**Se a licença for confirmada**, o caminho já está desenhado na pesquisa:
- RJ: importador `roubo_carga_isp_rj` (`SOURCE = 'isp-rj'`) com o polígono da CISP, só CISPs com 12 ou mais casos por ano
  (37 em 2025). O `CISPshp.rar` exige `bsdtar` (pacote `libarchive-tools`) na imagem do importador, ou guardar o GeoJSON
  já convertido. A API precisa de um caminho sem `periodo`, com aviso pelo total e o texto "a fonte não informa o horário".
- MG: importador `roubo_carga_sejusp_mg` com roubo **e** furto de carga por município (malha municipal do IBGE), aviso por
  faixa do dia (há hora) e texto "no município", não "na região". Conferir a soma anual contra o Sinesp.
