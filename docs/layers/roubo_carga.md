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
- Aviso `warn` (`code: cargo_theft_area`) para os **5 trechos** com mais ocorrências na faixa de passagem, desde que
  `na_passagem` ≥ **5** (≈ uma ocorrência a cada 4 meses naquela faixa de 6 h, numa área de poucos km²). Ex.:
  "Roubo de carga na região de Rua dos Condoreiros, São Paulo (km 18–22 da rota, ~09:22): 37 ocorrências de manhã em
  2025–2026 (67 no total). Evite parar na região; se precisar, use local vigiado."
- Resumo: nº de áreas atravessadas, total de ocorrências e quantas na faixa de passagem; faixa mais crítica na rota e se
  o veículo passa nela ("se puder, ajuste a saída"); se não houver aviso, diz isso. `data` traz `por_faixa`, `pico`,
  `na_passagem` e até 50 trechos.
- Mudar o horário de saída muda os avisos (ex.: CEAGESP → Guarulhos às 9h tem 5 avisos; às 3h, menos e "de madrugada").
- `features`: polígonos (fill) com propriedades legíveis (ocorrências por faixa, local, anos). Zoom < 8 só "muito alto";
  < 10 alto e muito alto; a partir de 10 todas.
- Severidade nunca é `danger`: é risco, não restrição legal.

## Como atualizar

```sh
docker compose --profile import run --rm importer roubo_carga_ssp
```
O arquivo do ano corrente é rebaixado se o cache tiver mais de 7 dias (o do ano anterior, 60 dias). A SSP publica o
arquivo do ano corrente mensalmente. Na virada do ano, o importador passa sozinho a usar os dois anos mais recentes.

## Limitações

- **Só o estado de SP.** Para outros estados há apenas números por UF (Sinesp VDE) ou por distrito policial (ISP-RJ),
  sem coordenada; não entram aqui.
- **Subnotificação e local do BO**: a coordenada é a do local informado no BO; parte dos roubos é registrada onde a
  carga/veículo foi achado ou onde a vítima foi liberada.
- **Células de 1 km**: a ocorrência pode ter sido numa rua paralela à rota, não na via usada; por isso o texto fala em
  "região".
- **Hora de passagem** aproximada (proporcional à distância; sem trânsito real nem paradas). Não considera dia da
  semana (o dado de fim de semana está em `props.fim_de_semana`, não usado no aviso).
- **Volume absoluto**, sem normalizar pela quantidade de caminhões que passam.
- Os anos são os de **estatística** da SSP (`ANO_ESTATISTICA`); algumas ocorrências de 2025 têm data de 2024 (BO
  registrado depois).
