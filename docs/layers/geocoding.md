# Geocodificação própria (frente `geocoding`)

O Photon público errava endereço com número no Brasil. Na pesquisa (`docs/research/enderecos_geocoding`), o erro
mediano foi de 647 m em 10 endereços logísticos. Também mandou "Rua Joaquim Távora, 500, Santos" para a Vila Mariana
e "Rua Santos Dumont, 81, Santos" para Mallet-PR.

Agora `/api/geocode` resolve endereço numa base própria em PostGIS (CNEFE 2022 do IBGE, GeoSampa e CEPs).
O Photon continua só para POI e nomes de lugar. Ele é chamado sempre com bbox e o município do resultado é conferido.

Resultado nos mesmos testes: **erro mediano de 0 m nos 10 endereços logísticos** (9 de 10 a até 100 m) e
**30 de 30 a até 100 m** nos 30 endereços aleatórios da pesquisa. O tempo mediano é de 51 ms por busca sem Photon.

## Cascata de precisão

Cada resultado traz `precisao` e `desvio_m`. `desvio_m` é o raio estimado, em metros, dentro do qual o endereço
real deve estar. Os níveis, do melhor para o pior:

| `precisao` | De onde vem | `desvio_m` típico |
|---|---|---|
| `numero` | o número existe no CNEFE (ponto coletado em campo pelo recenseador) | 10–60 m, conforme `NV_GEO_COORD` |
| `numero_aproximado` | interpolado entre os vizinhos do CNEFE no mesmo logradouro (mesma paridade). Na capital, também pela faixa par/ímpar do segmento do GeoSampa; fica o de menor desvio estimado | 15–150 m |
| `logradouro` | só a rua: o endereço real mais central, filtrado pelo bairro ou CEP digitado. Inclui "s/n" | 40 m a alguns km |
| `cep` | centroide do CEP (IPEA/CNEFE). CEP de grande usuário (`-9xx`) vai ao ViaCEP para obter logradouro e número, que depois passam pela cascata | o desvio da fonte |
| `bairro` | endereço mais central do bairro (`DSC_LOCALIDADE` do CNEFE) | centenas de m |
| `municipio` | ponto interno do polígono do município (IBGE) | km |
| `poi` | lugar com nome do OpenStreetMap, via Photon | pela extensão do objeto |

Outros campos: `fonte`, `metodo`, `logradouro`, `numero`, `bairro`, `municipio`, `uf`, `cod_ibge`, `cep` e `aviso`.
`fonte` vale `cnefe`, `geosampa`, `cep`, `viacep+cnefe`, `osm` ou `ibge`. `aviso` é uma frase curta para o motorista.
O formato antigo (`label`, `lat`, `lon`) continua igual, e a interface `Geocoder` não mudou.
`?debug=1` devolve `{parsed, uf, results, photon, ms}`, útil para diagnosticar o parser.

### Regras principais
- **A cidade digitada vence a posição do usuário.** Com "…, Santos" a busca fica restrita a Santos. Os resultados do
  Photon fora do polígono de Santos (com 300 m de tolerância) são descartados. A posição do usuário só desempata
  homônimos.
- **Sem cidade digitada**, a busca usa os municípios com CNEFE da UF de referência. A UF vem do texto, da posição do
  usuário ou, na falta dos dois, é SP. O Photon recebe o bbox da UF, e um resultado fora dela é rejeitado.
- **Texto sem vírgula que termina com nome de cidade** vira só uma *preferência* por aquela cidade, não um filtro.
  Exemplos: "Vila Leopoldina" não é Leopoldina-MG, e "Shopping Eldorado" não é Eldorado-SP. Com vírgula
  ("…, Guarujá") ou depois do número ("Rua Joaquim Távora 500 Santos"), a cidade vira filtro.
- **Homônimos** (o mesmo nome de rua em bairros diferentes da mesma cidade) geram um resultado por grupo, cada um
  com o bairro no rótulo. Bairro ou CEP digitados desempatam.
- **"s/n"**: o resultado principal é o centro dos pontos "sem número" do logradouro. Logo abaixo vêm os
  estabelecimentos "s/n" do CNEFE naquela via, com prioridade para terminal, CD, armazém etc. Exemplo: em
  "Av. Santos Dumont, s/n, Guarujá" aparecem os terminais do porto. Se a busca trouxer o nome
  ("Santos Brasil, Av. Santos Dumont, s/n, Guarujá"), o estabelecimento mais parecido vem primeiro.
- **Rodovia "km N"** usa o ponto do CNEFE com modificador `KM` mais próximo, até 3 km de diferença.
- **Números por extenso**: "Rua 25 de Março" encontra "RUA VINTE E CINCO DE MARCO", que é como o CNEFE grava, e
  vice-versa. "1º de Maio" encontra "PRIMEIRO DE MAIO".
- **Photon** só é chamado quando a base própria não resolveu bem: POI, nome de lugar ou número não encontrado.
  O timeout é de 3,5 s. Quando a busca não parece endereço (sem tipo de logradouro e sem número), POI vem antes
  de rua achada só pelo nome.

### Provedor (`GEOCODER_PROVIDER`)
- `photon` (padrão do `docker-compose.yml`) ou `cascata`: cascata própria + Photon para POI.
- `cnefe`: só a base própria, sem Photon.
- `photon_puro`: comportamento antigo, só Photon, sem bbox e sem validação.

O valor `photon` passou a significar a cascata para não exigir mudança no compose. Ele "mantém o Photon" para POI.
**Sugestão para quem mantém o README/compose:** trocar o padrão para `cascata` e atualizar a linha de `/api/geocode`
no README. Essas edições ficaram fora desta frente.

Outras variáveis:
- `PHOTON_URL` e `PHOTON_TIMEOUT_MS` (3500).
- `VIACEP_URL`: padrão `https://viacep.com.br`. Vazio desliga o ViaCEP.
- `VIACEP_TIMEOUT_MS` (3500).

## Fontes e licenças

| Fonte | Tabela | Licença | Observação |
|---|---|---|---|
| IBGE, **CNEFE 2022**: CSV por município (`ftp.ibge.gov.br/.../Arquivos_CNEFE/CSV/Municipio/`) | `addr_street`, `addr_point`, `addr_bairro`, `addr_municipio` | Dado público do IBGE, uso livre com **citação obrigatória**: "Fonte: IBGE, Censo Demográfico 2022 — CNEFE" | O site do IBGE devolve 403 para robôs, então não consegui ler um termo específico do CNEFE. A licença se apoia na declaração geral do IBGE (domínio público com citação) e no registro do OpenAddresses ("attribution: IBGE"). **Incerteza registrada.** |
| IBGE, API de malhas v3 e de localidades | `data_features` (`layer_id='geocoding'`, `kind='municipio'`) | Dado público do IBGE com citação | Polígonos simplificados ("intermediária"), só para reconhecer e validar município. Não servem como limite legal. |
| IPEA, `ipea/padronizacao_cnefe` release v0.5.0, `municipio_cep.parquet` | `cep_centroid` | Dado derivado do CNEFE (IBGE, citar). O repositório **não declara licença**; o pacote `geocodebr`, que distribui esses dados, é MIT | **Licença do arquivo incerta.** Se isso pesar, dá para recalcular os centroides direto do `addr_point` (`group by cep`) para os municípios carregados. |
| Prefeitura de SP, **GeoSampa** `geoportal:segmento_logradouro` (WFS) | `addr_segment` | **CC BY-SA 4.0** | Fica em tabela separada. Resultado que usa o segmento sai com `fonte: 'geosampa'` e o front mostra "GeoSampa (CC BY-SA)". |
| ViaCEP (`viacep.com.br`) | `cep_lookup_cache` | Serviço gratuito sem licença declarada. A informação de CEP vem dos Correios (DNE, proprietário) | Só é consultado para CEP **ausente** de `cep_centroid`, com cache (180 dias quando acha, 7 quando não acha). Não tem coordenada: o ponto sai da cascata do CNEFE. Para desligar, use `VIACEP_URL=`. |
| Photon público (komoot), dados OSM | não guardado | Dados ODbL; o serviço avisa que "uso extensivo será limitado" | Só para POI. Antes de ter usuários reais, migrar para Photon auto-hospedado (dump BR de cerca de 706 MB, GraphHopper). |

Nenhum desses dados vai para o OSM. O front mostra a fonte do ponto escolhido, por exemplo "Fonte: IBGE – CNEFE 2022".

Privacidade: só guardamos logradouro, número, bairro, CEP, coordenada e, quando existe, o nome do estabelecimento.
O nome do estabelecimento é texto livre do recenseador, como "GLP CAJAMAR 2" ou "BORRACHARIA". Complementos de
domicílio (apto, casa 2) não são guardados.

## Como carregar ou atualizar

```bash
# 1) migration (idempotente)
docker exec -i truck-router-db psql -U truck -d truck_router < db/migrations/0116_geocoding.sql

# 2) municípios (Sudeste; GEO_UFS=35,33,31,32). Pequeno, gera seed versionado: db/seed/layers/geocoding__ibge-malhas.sql
docker compose --profile import run --rm importer cnefe_municipios

# 3) CNEFE (RMSP + Baixada = 48 municípios; ~290 MB de zip em data/cache/geocoding/cnefe). SEM seed:
docker compose --profile import run --rm importer cnefe_enderecos --no-seed
#    outros conjuntos: -e CNEFE_MUNICIPIOS=nucleo  (capital + Guarulhos, Osasco, Barueri, Cajamar, Santos, Guarujá)
#                      -e CNEFE_MUNICIPIOS=3550308,3518800   (códigos IBGE)

# 4) CEPs (928.905 CEPs do Brasil; precisa de pyarrow, já listado em importers/requirements.txt). SEM seed:
docker compose --profile import run --rm importer cep_ipea --no-seed
#    com a imagem antiga, sem rebuild:
#    docker run ... --entrypoint sh truck-router-importer -c "pip install -q pyarrow==17.0.0 && python run.py cep_ipea --no-seed"

# 5) GeoSampa, segmentos com faixa de numeração (capital). SEM seed:
docker compose --profile import run --rm importer geosampa_logradouro --no-seed
```

**Não rode os passos 3–5 sem `--no-seed`, e não versione** `db/seed/layers/geocoding__ibge-cnefe.sql`,
`geocoding__ipea-cep.sql` ou `geocoding__geosampa-segmentos.sql`. Esses importadores gravam direto nas tabelas
próprias (`addr_*`, `cep_centroid`, `addr_segment`) e devolvem ao runner só feições de *cobertura*: o fecho convexo
por município ou UF, com as contagens em `props`. Um seed desses numa máquina limpa registraria cobertura sem os
dados. Sem os passos 3–5, a API continua funcionando, só que cai em município ou Photon.

A ordem entre 3 e 5 não importa. A orientação dos segmentos do GeoSampa é conferida pelos endereços do CNEFE
(`addr_segment_orient()`) por quem rodar por último, desde que a capital esteja carregada.

### Tamanho e tempo (medidos em 09/10/2026, banco compartilhado, M4 Pro / Colima 8 vCPU)

| | Linhas | Espaço | Tempo |
|---|---|---|---|
| CNEFE, 48 municípios | 11.246.706 registros → **5.279.656 pontos**, 121.617 logradouros | `addr_point` 504 MB + `addr_street` 82 MB + `addr_bairro` 5 MB | capital: 61 s de COPY + 300 s de agregação; os outros 47, de 3 a 60 s cada (cerca de 20 min no total, mais o download) |
| Capital | 5.689.391 → 2.428.327 pontos, 50.612 logradouros | | |
| CEPs (IPEA) | 928.905 | 97 MB | 19 s |
| GeoSampa | 216.547 segmentos (79.786 conferidos pelo CNEFE, dos quais 13.424 foram invertidos) | 159 MB | cerca de 150 s + 5 min de conferência |
| Municípios (IBGE) | 1.668 polígonos (SP, RJ, MG, ES) | seed de 3,1 MB | 3 s |

Total aproximado: **850 MB no banco**. A RMSP inteira coube folgada, então não foi preciso recuar para só a capital
e os polos logísticos. A opção `CNEFE_MUNICIPIOS=nucleo` ficou disponível para máquinas menores.

Na primeira carga, um município (Guarujá) ficou cerca de 2 h parado, provavelmente esperando lock de outra sessão
no banco compartilhado. O importador agora usa `lock_timeout = 5min` e tenta de novo até 3 vezes por município.

## Precisão medida

- **10 endereços logísticos** (`api/test/geocoding.test.ts`; a verdade é o ponto do estabelecimento no CNEFE):
  - 8 com número exato: 0 m.
  - CEAGESP, "Av. Dr. Gastão Vidigal, 1946": a portaria está no CNEFE como "s/n", então o resultado é
    interpolado, a 51 m.
  - "Av. Santos Dumont, s/n, Guarujá" sem nome do terminal: nível de logradouro, a 336 m. Com o nome
    ("Santos Brasil, …"), o terminal vem primeiro.
  - **Mediana: 0 m.** Photon: 647 m. Nominatim: 780 m.
- **30 endereços aleatórios** de estabelecimentos do CNEFE (RMSP + Baixada): 30/30 a até 100 m.
  - Um caso é homônimo ("Rua Vitoria, 159, Guarulhos"), com duas ruas a 12,6 km uma da outra. Os dois
    resultados aparecem, com o bairro no rótulo.
  - Atenção: a verdade desses dois testes também vem do CNEFE, então isso mede a busca e o parser, não o CNEFE.
    A pesquisa conferiu o CNEFE contra os lotes do IPTU (GeoSampa), com cerca de 20 m de diferença.
- **Interpolação entre vizinhos do CNEFE, deixando um de fora** (600 endereços por município):

  | Município | p50 | p80 | p90 |
  |---|---|---|---|
  | Guarulhos | 7 m | 18 m | 44 m |
  | Capital | 8 m | 29 m | 74 m |
  | Santos | 9 m | 31 m | 72 m |

  O p95 (116–447 m) vem de homônimos e de numeração irregular.
- **Segmentos do GeoSampa**: a mediana é de 16–20 m nos segmentos conferidos pelo CNEFE. Nos não conferidos, que
  não têm endereço do CNEFE a até 40 m, a mediana é de cerca de 230 m: ali a numeração do cadastro municipal e a do
  IBGE divergem. Por isso o desvio estimado é maior para esses segmentos, e a API prefere o CNEFE quando os dois
  discordam.
- Faixa original do GeoSampa: cerca de 30% das linhas vinham desenhadas no sentido contrário ao da numeração.
  O campo `cd_numero_ordem_segmento` também não acompanha a numeração em várias vias. O importador deduz a
  orientação pela sequência de numeração (81% de acerto) e o banco corrige pelos endereços do CNEFE (95%).

## Decisões
- **Tabelas próprias em vez de `data_features`.** São 5 M de pontos, que precisam de índice `(street_id, numero)` e
  de trigramas por nome. `data_features` fica só com a cobertura (mapa e `/api/sources`) e com os polígonos de município.
- **Um ponto por endereço único** (logradouro + número + bairro). É a média das coordenadas de nível 1–2; 98,6% dos
  pontos têm nível 1 (coordenada original de campo). São 274.909 pontos "s/n", 1.546 com km de rodovia e
  1,01 milhão com nome de estabelecimento. "Sem número" fica agrupado em células de cerca de 11 m. Mantive o bairro na chave para não
  fundir homônimos.
- **`lat`/`lon` em `real` (float4)**, com resolução de cerca de 0,4 m, e **sem índice espacial** em `addr_point`.
  Toda busca entra pelo logradouro. Isso economiza algumas centenas de MB (coluna geometry + índice GiST em 5 M linhas).
- **Normalização com fonte única.** A tabela `geo_abbrev` (AV→AVENIDA, DR→DOUTOR, JD→JARDIM, preposições removidas…)
  é usada por `geo_canon()` no import e carregada pela API para normalizar a busca do mesmo jeito.
  "S" (São) e "N" (Nossa/nº) ficaram de fora por ambiguidade.
- **Números por extenso** são tratados como variantes na hora da busca, sem reescrever a base.
- **O ViaCEP só entra para CEP que não está no centroide.** As coordenadas da BrasilAPI e da AwesomeAPI não são
  usadas, conforme a pesquisa: proveniência e licença incertas, e erros de 5–10 km.

## Limitações e próximos passos
- **Cobertura com número: só RMSP + Baixada** (48 municípios). Fora disso a cascata dá CEP (Brasil todo), município
  (Sudeste) ou Photon. Para expandir, use `CNEFE_MUNICIPIOS` com códigos de outros municípios (pasta `UF_DIR` no
  importador). O CSV da UF SP inteira tem 1 GB.
- O CNEFE é um retrato de 2022: ruas e números abertos depois disso não estão lá. Os nomes vêm **sem acento**,
  como no IBGE.
- **Portaria de grandes áreas**: o ponto do CNEFE é onde o recenseador registrou o estabelecimento, e nem sempre é
  o portão de caminhões. A tabela `site_access` da pesquisa (portarias e acessos colaborativos) não foi feita aqui.
- O nome de estabelecimento só é usado no "s/n". Não há busca de POI pelo nome do CNEFE; isso fica com o Photon.
- "Rodovia X, km N" só funciona onde o CNEFE tem registro com `KM`. Os marcos quilométricos (DER/DNIT) são outro tema.
- Os polígonos de município cobrem só o Sudeste (`GEO_UFS`). Fora deles, a validação do Photon usa o nome da cidade
  e o bbox da UF.
- O Photon público tem limite de uso. Em produção, auto-hospedar e apontar `PHOTON_URL`.
- Atribuição no mapa: o front mostra a fonte do ponto escolhido. Falta incluir "Endereços: IBGE – CNEFE 2022" no
  rodapé de atribuições do mapa, no `MapView.tsx`, que é de outra frente.
