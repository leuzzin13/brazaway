# Camada `postos_diesel` — postos com diesel e preço da ANP

Arquivos: `api/src/layers/postos_diesel.layer.ts`, `importers/sources/postos_anp.py` (+ `_osm_pois.py`), testes em
`api/test/layers/descanso.test.ts` (bloco "postos") e `importers/tests/test_descanso_postos.py` (endereço, pontos-padrão
do PMQC).

A camada **não muda a rota**. No mapa, mostra os postos que vendem diesel, com o preço do S10 e do S500 e a data da
coleta. Na rota (`layers.postos_diesel`):

- `summary`: média do diesel S10 (e do S500) nos postos com preço a até **2 km** da rota, faixa de preço e os
  **5 mais baratos** (km da rota, preço, posto, bandeira, município, data da coleta e desvio aproximado), terminando com
  a atribuição **"Fonte: ANP — Levantamento de Preços de Combustíveis"** e o período das coletas;
- `warnings`: `diesel_price_stale` (`info`) quando a coleta mais recente do trecho tem mais de 28 dias antes da saída;
- `data`: `mais_baratos_s10`, `mais_baratos_s500` (id, nome, bandeira, CNPJ, endereço, `diesel_s10`/`diesel_s500` =
  `{valor, data}`, km na rota, distância da rota, `desvio_km`, como a posição foi obtida, acesso de caminhão segundo o
  OSM), `media_s10`, `media_s500` (`postos`, `media`, `minimo`, `maximo`, `coleta_de`, `coleta_ate`), `postos_com_preco`.

**Desvio aproximado** = 2 × distância em linha reta do posto até a rota × 1,4 (sinuosidade da malha); até 150 m conta
como "na rota". Não é rota calculada: serve para comparar postos, não para planejar a manobra.

## Fontes e licenças

| Fonte | O que traz | Licença | Uso |
|---|---|---|---|
| ANP — Cadastro de revendedores varejistas (CSV diário) | CNPJ (chave), razão social, endereço, CEP, município, UF, bandeira, autorização | CC-BY (dados.gov.br, `license_id` cc-by) | universo de postos e dados exibidos |
| ANP — Levantamento de Preços de Combustíveis, "últimas 4 semanas" de diesel/GNV | preço de venda de DIESEL S10 e DIESEL (S500) por CNPJ e **data da coleta** | CC-BY | preço: guardamos a coleta mais recente de cada produto |
| ANP — PMQC (Programa de Monitoramento da Qualidade, CSV mensal) | latitude/longitude do posto onde a amostra foi colhida e o produto amostrado | CC-BY | posição (mediana das coletas dos últimos 12 arquivos, sem os pontos-padrão) e evidência de que vende diesel |
| OpenStreetMap — `amenity=fuel` (PBF do Valhalla) | posição do posto, nome, marca, `hgv`, `fuel:HGV_diesel`, `fuel:diesel`, horário, endereço | ODbL 1.0 | conflação (≤ 100 m: `props.osm`), acesso de caminhão e posição de quem não tem PMQC |
| IBGE — malha municipal (camada `geocoding`, `kind = municipio`) | polígono de cada município | dados públicos IBGE | conferir se a coordenada do PMQC cai no município do próprio posto |
| IBGE — CNEFE 2022 (tabelas do geocodificador próprio, se carregadas) | ponto do endereço (logradouro + número) | dados públicos IBGE | só para achar o posto do OSM a ≤ 100 m do endereço |

A atribuição "Fonte: ANP" está em `meta.sources` (nomes das fontes começam com "Fonte: ANP"), no resumo da rota e no
`fonte` de cada feição do mapa e de cada posto de `data.mais_baratos_*`. O que vem do OSM (ODbL) também é atribuído:
posto ligado a um `amenity=fuel` (`props.osm`) diz "acesso de caminhão © colaboradores do OpenStreetMap (ODbL)"; posto
posicionado pelo OSM (`cnefe+osm`, `osm_endereco`) diz "posição e acesso de caminhão © …". `data.fonte` e a última
linha do resumo acrescentam o crédito ao OSM quando algum posto listado usa dado de lá.

**Separação ODbL × CC-BY.** Tudo vai para a fonte `anp` de `data_features`, mas a parte do OSM fica separável: está só
em `props.osm` (id, distância, nome, marca, `hgv`, `fuel:HGV_diesel`, `fuel:diesel`, horário) e na geometria dos
postos com `coord_fonte` ≠ `pmqc`. A licença registrada da fonte (`data_layer_runs`, `GET /api/sources`) diz isso.
O rodapé "CC BY-ND 3.0" do gov.br vale para o conteúdo editorial do portal, não para esses conjuntos (ver
`docs/research/descanso_postos_combustivel/NOTES.md`, §4).

## Como cada posto ganha posição (`props.coord_fonte`)

1. **`pmqc`** — o CNPJ foi amostrado pelo PMQC: posição = mediana das coletas (a dispersão entre coletas do mesmo
   posto tem mediana de ~20 m). **O PMQC às vezes grava o centro da cidade ou um ponto padrão** em vez do posto (na
   carga anterior, 12 postos de S. J. do Rio Preto num ponto só, 11 em Ribeirão Preto, e 20 postos de ES, MG, SP e RJ
   num ponto em S. João de Meriti, ao lado da Dutra). Por isso a posição do PMQC é descartada quando:
   - o ponto exato (6 casas) aparece para **2 ou mais CNPJs** (a amostra sai; se o CNPJ tiver outras, fica a mediana delas);
   - a coordenada tem **3 casas decimais ou menos** (precisão de ~100 m ou pior);
   - as coletas do CNPJ estão **espalhadas** (mediana da distância à mediana > 500 m);
   - o ponto fica a **mais de 1 km do polígono do município do próprio posto** (malha do IBGE da camada `geocoding`,
     casada pelo nome normalizado + UF; sem a malha carregada, essa conferência é pulada e o NOTES da carga avisa).
   O posto descartado segue para os passos 2 e 3 (`props.pmqc_posicao_descartada` diz o motivo). Se houver
   `amenity=fuel` do OSM a ≤ 100 m (ainda não ligado a outro CNPJ), o posto é **ligado** a ele (`props.osm`: id,
   distância, nome, marca, `hgv`, `fuel:HGV_diesel`, horário); a posição continua a do PMQC. Os postos do PMQC são
   ligados primeiro, antes dos achados por endereço.
2. **`cnefe+osm`** — sem PMQC: o endereço do cadastro é achado no CNEFE (mesmo município, logradouro normalizado e
   número; prefere o mesmo tipo de logradouro e o mesmo CEP) e a posição passa a ser a do `amenity=fuel` do OSM mais
   próximo **a até 100 m** desse ponto (um posto do OSM só é usado por um CNPJ).
3. **`osm_endereco`** — sem PMQC nem CNEFE: um único `amenity=fuel` do OSM com o mesmo CEP e número
   (`addr:postcode` + `addr:housenumber`) ou a mesma rua e número no mesmo município.

O endereço do cadastro ("LOGRADOURO,  NÚMERO") é separado **na vírgula**: o nome do logradouro pode ter número
("RUA 24 DE MAIO, 1281", "RODOVIA BR 101, KM 578"); ponto de milhar ("1.310") é juntado e km dentro do logradouro
("RODOVIA BR 262 KM 169, S/N") vira o número com `km = true`.

Sem nenhuma das três, o posto fica de fora: não usamos centroide de CEP (o CEP único de cidade pequena e de rodovia
põe o posto a quilômetros do lugar).

**Vende diesel?** O cadastro não diz. Entra só posto com evidência (`props.diesel_evidencia`): preço de diesel no LPC,
amostra de diesel S10/S500 no PMQC ou `fuel:diesel`/`fuel:HGV_diesel=yes` no OSM ligado.

## Alcance

UFs **SP, RJ, MG e ES** (o mesmo extrato do Valhalla; `POSTOS_UFS`). Contagem da carga de 09/10/2026 (com o descarte
dos pontos-padrão do PMQC):
| UF | Postos com diesel e posição | Com preço do LPC | Posição pelo PMQC | CNEFE + OSM | OSM por endereço | Ligados a um posto do OSM |
|---|---|---|---|---|---|---|
| SP | 2.191 | 525 | 1.877 | 201 | 113 | 1.637 |
| RJ | 1.024 | 180 | 1.017 | 0 | 7 | 699 |
| MG | 1.916 | 227 | 1.889 | 0 | 27 | 1.026 |
| ES | 463 | 64 | 439 | 0 | 24 | 359 |
| **Total** | **5.594** | **996** | **5.222** | **201** | **171** | **3.721** |

Entrada: 16.201 postos no cadastro das 4 UFs; 2.131 com preço de diesel no LPC (coletas de 14/09 a 09/10/2026: SP 1.269
postos em 100 municípios, Grande SP 428 em 19 municípios, RJ 305, MG 464, ES 93); 6.207 CNPJs com coordenada no PMQC
(out/2025 a set/2026). Posição do PMQC **descartada em 399 postos** do universo (309 em ponto repetido em outros CNPJs,
25 com 3 casas decimais ou menos, 6 com coletas espalhadas, 59 a mais de 1 km do próprio município); 21 deles foram
reposicionados pelo CNEFE/OSM, os outros ficaram de fora. Nenhum ponto da camada é compartilhado por dois CNPJs e nenhum
posto fica a mais de 1 km do próprio município. Ficaram de fora **1.135 postos com preço no LPC sem posição confiável:
só 47% dos postos com preço entram no mapa** (o PMQC não amostrou o CNPJ ou deu ponto padrão, o endereço não está no
CNEFE carregado e não há posto do OSM com o mesmo endereço), e 8.831 postos do cadastro sem evidência de diesel.
O CNEFE só está carregado nos 48 municípios da Grande SP e Baixada (`addr_municipio`), por isso o passo 2 só posicionou
postos de SP. Média do diesel S10 nos postos carregados: R$ 7,19; S500: R$ 6,79.

O LPC é **amostral**: a ANP coleta preço em parte dos postos de parte dos municípios (na Grande SP, 19 dos 39
municípios). Rodovia longe de cidade pesquisada pode não ter nenhum posto com preço; o resumo da rota avisa.

## Como atualizar

```bash
# preços mudam toda semana: rodar semanalmente (o LPC "últimas 4 semanas" sai às sextas/segundas)
OSM_PBF=/caminho/sudeste.osm.pbf docker compose --profile import run --rm importer postos_anp
```

- Cache em `data/cache/`: cadastro e LPC por 24 h; PMQC mensal por 60 dias (cada mês publicado não muda).
  Primeira carga baixa ~200 MB (12 meses de PMQC).
- O CNEFE só é usado se as tabelas do geocodificador estiverem carregadas (`docs/layers/geocoding.md`); sem elas, o
  passo 2 é pulado e menos postos sem PMQC ganham posição.
- Seed: `db/seed/layers/postos_diesel__anp.sql`.

## Limitações

- **Preço da data da coleta**, não do dia da viagem: o resumo mostra a data e avisa quando passa de 28 dias. Para SP
  não há fonte pública de preço por NFC-e (o Menor Preço do Paraná existe, mas sem licença e só no PR).
- O cadastro **não diz se o posto atende caminhão** (pátio, bico de alta vazão, ARLA 32). Só o OSM traz `hgv`/
  `fuel:HGV_diesel`, e em poucos postos.
- Posto na pista contrária de rodovia duplicada aparece como "na rota" (sem conferência de sentido).
- Postos que vendem diesel mas não aparecem no LPC nem no PMQC e não estão marcados no OSM ficam de fora.
- Ponto padrão do PMQC usado por **um só** CNPJ dentro do próprio município (ex.: centro da cidade pequena com um
  posto amostrado) não é detectável e passa; a malha municipal usada é simplificada, por isso a tolerância de 1 km.
