# Segurança em MG: acidentes com caminhão do REDS (SEJUSP-MG)

Frente `seguranca_mg` (10/10/2026). Acrescenta a **SEJUSP-MG (REDS)** como fonte da camada `acidentes`, com o mesmo
método do Infosiga em SP. Não cria camada nova nem muda a rota: a camada continua informativa (ver
[acidentes.md](acidentes.md)). O roubo de carga em RJ, MG e ES **não** foi implementado, porque não há coordenada nem dado
agregado de licença clara; a análise está em [roubo_carga.md](roubo_carga.md#rio-de-janeiro-minas-gerais-e-espírito-santo-sem-coordenada-não-implementado).

Este tema não tem regra de circulação (horário, peso ou altura). A verificação da pesquisa confirmou `rules = []`, então
não há ato nem artigo a citar além da base legal da licença.

| Peça | Arquivo |
|---|---|
| Importador | `importers/sources/acidentes_reds_mg.py` (`LAYER_ID = 'acidentes'`, `SOURCE = 'sejusp-mg'`) |
| Apoio | `importers/sources/acidentes_prf.py`: `covered_cells(bbox)` aceita o bbox de MG |
| Seed | `db/seed/layers/acidentes__sejusp-mg.sql` (5,0 MB, 7.523 células) |
| API | `api/src/layers/acidentes.layer.ts`: fonte em `meta.sources`, MG na descrição e linha "Fonte(s)" no resumo |
| Testes | `api/test/layers/seguranca_mg.test.ts` |
| Migração | nenhuma (usa `data_features` e `data_layer_runs`) |

## Fonte e licença

- **SEJUSP-MG, base do Painel de Sinistro de Trânsito (REDS)**: pasta pública do Google Drive
  `https://drive.google.com/drive/folders/1W_4SsAW8u5bvsaBoHhwInpUr72vES8yw`. O link está no botão "Acesse a Base de Dados
  do Painel" da página `https://www.seguranca.mg.gov.br/index.php/component/sppagebuilder/page/289`.
- A pasta tem as subpastas Ocorrências, Veículo, Vítimas, Via e Condições, com um CSV por ano de 2012 até "Jan a Ago 2026"
  (publicado em 15/09/2026). O importador usa três delas, ligadas por `numero_ocorrencia_associado` (hash):
  - **Registros (Ocorrências)**: natureza (com/sem vítima), data, hora, tipo e nome do logradouro, bairro, município, unidade
    que registrou e `latitude_sirgas2000`/`longitude_sirgas2000` (decimal com vírgula). Cerca de 100 MB por ano;
  - **Veículo**: tipo de cada veículo envolvido. Cerca de 20 MB por ano;
  - **Vítimas**: condição física (FATAL) e envolvimento (pedestre). Cerca de 25 MB por ano.
- A listagem é feita sem login pelo `embeddedfolderview` do Drive, e o download por
  `drive.usercontent.google.com/download?id=<ID>&export=download&confirm=t`. Quando o ano corrente tem duas versões ("Jan a
  Jul" e "Jan a Ago"), fica a mais recente. Se a listagem falhar, o importador usa os ids conhecidos em 10/10/2026
  (`FALLBACK`).
- **Licença registrada** (a mesma redação no importador, na API e aqui): "SEJUSP-MG/REDS (Painel de Sinistro de Trânsito)
  — sem licença nomeada nos arquivos nem no CKAN; dados de transparência ativa "de livre utilização pela sociedade"
  (Decreto MG 48.383/2022, art. 22, observados o art. 6º da LGPD e a Lei 14.129/2021); atribuir SEJUSP-MG/REDS; confirmar
  uso comercial por pedido de acesso à informação".
  - O texto do art. 22 foi conferido na ALMG (`https://www.almg.gov.br/legislacao-mineira/texto/DEC/48383/2022/`). A
    verificação apontou que a citação da pesquisa estava truncada: o artigo continua com a ressalva da LGPD (art. 6º) e da
    Lei 14.129/2021, que agora consta da licença registrada.
  - Os 5 conjuntos da SEJUSP no CKAN (`dados.mg.gov.br`) têm `license_id` vazio.
  - **Incerteza:** não há licença padrão (CC etc.). Para uso comercial em escala, confirmar com a SEJUSP por pedido de
    acesso à informação. A camada só publica agregados (células com 3 ou mais acidentes), o que reduz o risco.
- Atribuição: `props.fonte = 'SEJUSP-MG (REDS)'` em cada ponto, em `meta.sources` e na linha "Fonte(s)" do resumo da rota.

## Método (importador)

O mesmo do Infosiga (`acidentes_infosiga.Hotspots`): grade de 250 m em EPSG:5880, janela de 3 anos, publicação só de
células com **pelo menos 3 acidentes com caminhão**, ponto publicado na média das coordenadas desses acidentes,
`score = com vítima + 2 × com morte + 0,2 × sem vítima` e níveis `muito_alto` ≥ 15 e `alto` ≥ 8. Nenhum registro
individual sai do importador.

1. **Janela**: termina no último dia do mês mais recente comum às três tabelas. Na carga de 10/10/2026 vai de
   01/09/2023 a 31/08/2026, com os arquivos de 2023, 2024, 2025 e jan–ago/2026.
2. **Streaming**: cada CSV é lido direto da resposta HTTP (`requests` com `stream=True`, `TextIOWrapper` sobre o corpo, sem
   gravar o arquivo bruto). Só um extrato gzip compacto fica em `data/cache/reds_mg/<tabela>_<id>.csv.gz`, um por id de
   arquivo. Arquivos que já viraram extrato não são baixados de novo; o do ano corrente troca de id todo mês. A falha de
   rede refaz o arquivo do zero, até 3 tentativas.
3. **Com caminhão**: a ocorrência tem ao menos um veículo `CAMINHAO`, `CAMINHAO/TRATOR`, `SEMI-REBOQUE` ou `REBOQUE`, os
   mesmos tipos usados para a PRF. Caminhonete e camioneta ficam de fora.
4. **Vítima e morte**: a natureza é "ACIDENTE DE TRANSITO COM VITIMA" ou há óbito. Os óbitos vêm da tabela Vítimas
   (`condicao_fisica_descricao = FATAL`, somando `qtd_envolvido`). `caminhao_moto` vem dos veículos MOTOCICLETA, MOTONETA
   ou CICLOMOTOR; `caminhao_pedestre` vem de uma vítima com envolvimento de pedestre.
5. **Nome da via**: código de rodovia como `MG-050`, `MGC-135` ou `BR-381`, "Anel Rodoviário" para as duas grafias do
   REDS, e tipo + nome nas demais ("Avenida Cristiano Machado", "Via Expressa de Contagem"). Os nomes ficam sem acento,
   como no REDS. Tipos que não são via (fazenda, povoado, córrego) ficam sem nome, e o ponto vira "trecho em <município>".
   O município é grafado como no IBGE.
6. **`total` e `fatais`** (todos os veículos) contam as demais ocorrências da célula que passam pelos mesmos filtros.

### Divisão por jurisdição (BRs com a PRF)

A divisão segue a do Infosiga em SP:

| Caso | Regra | Carga de 10/10/2026 |
|---|---|---|
| Logradouro com código de BR (`BR 381`, `- FERNAO DIAS BR 381`), ou tipo RODOVIA com nome Fernão Dias ou Rio-Bahia | Sempre descartado: fica com a PRF, como a circunscrição FEDERAL no Infosiga | 15.198 acidentes com caminhão |
| Logradouro "de rodovia" (tipo RODOVIA ou ESTRADA, código MG/MGC/AMG/LMG, Anel Rodoviário, "Rua Fernão Dias") numa célula (±1) com acidente da PRF | Descartado: a PRF cobre aquele trecho | 2.200 |
| Demais (vias urbanas, rodovias estaduais, Anel Rodoviário fora das células da PRF) | Fica com o REDS | — |

As células da PRF vêm de `acidentes_prf.covered_cells(MG_BBOX)`: todos os acidentes da PRF (qualquer veículo) no bbox de
MG, com 1 célula de folga. Na carga de 10/10/2026 são 127.676 células.

**Anel Rodoviário de BH.** Formalmente o Anel é trecho das BR-040, BR-262 e BR-381, mas a PRF praticamente não registra
acidentes no trecho central. Conferido em 10/10/2026: entre 09/2023 e 08/2026, a PRF tem **2 acidentes** no retângulo
−43,995/−19,905 a −43,925/−19,85. No mesmo retângulo, o REDS tem 1.394 acidentes com caminhão no Anel (3.615 no Anel
inteiro, em BH). A PRF só aparece
nas pontas: BR-040 km 523–532 em Contagem e BR-381 km 452–456 perto de Sabará. Como o REDS grava o Anel com o nome
"ANEL RODOVIARIO", sem código de BR, ele segue a regra de rodovia: sai nas células da PRF e fica no resto. Sem isso, o
principal ponto crítico de caminhão de BH ficaria fora da camada.

### Coordenadas repetidas (endereço geocodificado)

O REDS geocodifica o endereço informado, e a mesma coordenada exata se repete muito. Na janela, 2.277 coordenadas têm 5 ou
mais acidentes com caminhão. Elas reúnem 24% desses acidentes (25.248 de 104.400 com coordenada em MG) e **93% dos acidentes
do Anel** (3.401 de 3.648). A pesquisa recomendava descartar toda coordenada repetida 5 vezes ou mais. Testamos antes de
aplicar, com o `/locate` do Valhalla sobre o OSM:

- Numa amostra de 80 coordenadas repetidas, 66 ficam a até 200 m de uma via com o mesmo nome. A distância mediana é de
  **19 m** (p90 de 65 m).
- O Anel tem **137 coordenadas repetidas distintas** ao longo de ~27 km, ou seja, pontos de referência espaçados, não um
  único "ponto padrão" do logradouro.
- Das 2.277 coordenadas repetidas, só 46 não têm um logradouro dominante (nenhum nome com 80% dos casos).

Assim, a coordenada repetida está na via certa, mas perde a posição exata ao longo dela. Os casos **sem vítima** nesses pontos
são autodeclarados (a verificação confirmou que todos os 15.780 casos com caminhão da Delegacia Virtual em 2025 são sem
vítima). Eles se empilham no ponto do endereço e criariam "pontos críticos" só de batidas leves. Exemplos sem a regra: 294
acidentes na Av. Amazonas com 3 com vítima; 120 na Rua Lafaiete Brandão sem nenhuma vítima.

**Regra aplicada** (`MIN_REPETICAO = 5`, `PADRAO_NOME_DOMINANTE = 0,8`):

| Situação da coordenada | Efeito | Carga de 10/10/2026 |
|---|---|---|
| Repetida, sem logradouro dominante ou sem nome (centro de bairro ou município) | Saem todos os acidentes dela | 424 |
| Repetida, de um logradouro só | Saem os **sem vítima**; ficam os com vítima (registro da PM no local) | 14.075 |
| Não repetida | Fica | — |

Com a regra, os pontos críticos mais graves passam a ser os de vítimas e mortes: Anel Rodoviário em BH, MGC-135 em
Montes Claros e Curvelo, MG-188 em Paracatu. A comparação das três opções está nos números abaixo.

| Opção | Acidentes com caminhão mantidos | Células | muito alto / alto | Células no Anel |
|---|---|---|---|---|
| Descartar toda coordenada repetida (recomendação da pesquisa) | 71.378 | 7.411 | 0 / 23 | quase nenhuma (93% do Anel some) |
| Manter todas | 87.002 | 8.020 | 57 / 125, liderados por batidas sem vítima | 63 |
| **Regra aplicada** | **72.503** | **7.523** | **8 / 57** | 37 (5 muito alto, 12 alto) |

### Datum (SAD-69 × SIRGAS 2000)

O manual do painel diz que as coordenadas do REDS vêm de SAD-69 e são aproximadas, mas as colunas se chamam `_sirgas2000`.
A verificação pediu para validar antes de publicar. Fizemos isso com o `/locate` do Valhalla:

- 120 pontos da PM, não repetidos, em vias principais de BH e Contagem ficam a **8 m** (mediana) da via mais próxima. O
  deslocamento médio é de −0,6 m para leste e −0,7 m para norte.
- 59 de 60 pontos ficam a até 150 m da via com o mesmo nome (Anel, Cristiano Machado, Amazonas), com mediana de 15 m e
  deslocamento médio de (−5,9; −5,2) m.

Não há sinal do desvio sistemático de dezenas de metros que o SAD-69 daria, então as coordenadas são usadas como SIRGAS 2000.

### Resultado da carga de 10/10/2026

- 924.466 ocorrências na janela, 106.442 com caminhão. A verificação conferiu o arquivo de jan–ago/2026 com 214.694
  ocorrências, e não "cerca de 129 mil" como a pesquisa dizia.
- Descartados (com caminhão): 2.042 sem coordenada em MG ("nan" ou fora do bbox), 15.198 em BR, 2.200 em rodovia coberta
  pela PRF, 14.075 sem vítima em coordenada repetida e 424 em centro de bairro ou município.
- Mantidos: 72.503 acidentes com caminhão. As **7.523 células** publicadas (8 muito alto, 57 alto, 7.458 moderado) reúnem
  39.689 deles, com 4.307 com vítima, 340 com morte e 366 óbitos. Os demais caem em células com menos de 3 e não são
  publicados.
- Por município: Belo Horizonte tem 1.499 células (33 alto ou muito alto), Contagem 647 (16), Uberlândia 376, Betim 319,
  Juiz de Fora 195 e Montes Claros 188.
- Conferência com a pesquisa: em 2025 houve 36.074 ocorrências com caminhão, e 445 delas com vítima fatal (505 óbitos). Esse
  é o número corrigido pela verificação; o 436/495 da pesquisa só contava as ocorrências com coordenada válida.

## Na rota (API)

O `acidentes.layer.ts` não mudou de comportamento: tem o mesmo raio de 80 m, os mesmos trechos e os mesmos 5 avisos. As
mudanças são estas:

- `meta.sources` ganhou a SEJUSP-MG, e a descrição e o resumo vazio passaram a citar MG.
- O resumo ganhou uma última linha com as fontes dos pontos da rota, por exemplo "Fonte: SEJUSP-MG (REDS)." ou "Fontes:
  Infosiga SP (Detran-SP); PRF (rodovias federais).". Ela atende o pedido de atribuição da SEJUSP.

Exemplo (teste): uma carreta do Anel x Av. Amazonas até o Anel x Av. Cristiano Machado, às 9h. A rota tem 15,5 km e passa
por 49 pontos críticos em 5 trechos, quatro deles no Anel Rodoviário (até 10 acidentes com caminhão com morte num trecho).
Todos são da fonte REDS.

## Como atualizar

```sh
docker compose --profile import run --rm importer acidentes_prf acidentes_reds_mg
```

O importador usa as células da PRF, então os dois devem rodar juntos. Os arquivos de anos fechados não são baixados de
novo (o extrato fica no cache por id). O ano corrente é baixado quando a SEJUSP publica um arquivo novo, mais ou menos
todo mês. A primeira carga baixa ~550 MB em streaming, leva ~1 min e deixa ~40 MB de extratos em `data/cache/reds_mg`.

## Limitações

- **BRs delegadas ou sem PRF**: 3.264 acidentes com caminhão em logradouro de BR (já aplicada a regra das coordenadas
  repetidas) ficam fora das células da PRF. Os principais são BR-354 (517), BR-265 (413), BR-356 (258), BR-494 (234),
  BR-381 (231) e BR-259 (200). A regra "BR fica com
  a PRF" os descarta. Se forem trechos delegados ao DER-MG ou policiados pela PMRv, a PRF não os registra e eles ficam sem
  cobertura. Para melhorar, cruzar com a jurisdição do SNV (DNIT) e manter no REDS os trechos não federais.
- **Concessões estaduais** (MG-050 e outras) ficam com o REDS, porque não há base aberta das concessionárias.
- **Sem vítima em ponto repetido** sai da conta. Isso subestima as batidas leves nas avenidas com muito registro pela
  Delegacia Virtual, mas evita pontos críticos falsos.
- **Volume absoluto**, sem exposição (VMD), como nas demais fontes. Mais que em SP, o REDS inclui acidentes sem vítima
  (peso 0,2), então MG tem mais células moderadas que SP.
- **Licença** sem nome padrão (ver acima).
