# Camada `postos_diesel` — postos com diesel e preço da ANP

Arquivos: `api/src/layers/postos_diesel.layer.ts`, `importers/sources/postos_anp.py` (+ `_osm_pois.py`), testes em
`api/test/layers/descanso.test.ts` (bloco "postos").

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
| ANP — PMQC (Programa de Monitoramento da Qualidade, CSV mensal) | latitude/longitude do posto onde a amostra foi colhida e o produto amostrado | CC-BY | posição (mediana das coletas dos últimos 12 arquivos) e evidência de que vende diesel |
| OpenStreetMap — `amenity=fuel` (PBF do Valhalla) | posição do posto, `hgv`, `fuel:HGV_diesel`, `fuel:diesel`, endereço | ODbL 1.0 | conflação (≤ 100 m) e posição de quem não tem PMQC |
| IBGE — CNEFE 2022 (tabelas do geocodificador próprio, se carregadas) | ponto do endereço (logradouro + número) | dados públicos IBGE | só para achar o posto do OSM a ≤ 100 m do endereço |

A atribuição "Fonte: ANP" está em `meta.sources` (nomes das fontes começam com "Fonte: ANP"), no resumo da rota e no
`fonte` de cada feição do mapa. Feições cuja posição veio do OSM dizem "posição © OpenStreetMap".
O rodapé "CC BY-ND 3.0" do gov.br vale para o conteúdo editorial do portal, não para esses conjuntos (ver
`docs/research/descanso_postos_combustivel/NOTES.md`, §4).

## Como cada posto ganha posição (`props.coord_fonte`)

1. **`pmqc`** — o CNPJ foi amostrado pelo PMQC: posição = mediana das coletas (a dispersão entre coletas do mesmo
   posto tem mediana de ~20 m). Se houver `amenity=fuel` do OSM a ≤ 100 m, o posto é **ligado** a ele (`props.osm`:
   id, distância, nome, marca, `hgv`, `fuel:HGV_diesel`, horário); a posição continua a do PMQC.
2. **`cnefe+osm`** — sem PMQC: o endereço do cadastro é achado no CNEFE (mesmo município, logradouro normalizado e
   número; prefere o mesmo tipo de logradouro e o mesmo CEP) e a posição passa a ser a do `amenity=fuel` do OSM mais
   próximo **a até 100 m** desse ponto (um posto do OSM só é usado por um CNPJ).
3. **`osm_endereco`** — sem PMQC nem CNEFE: um único `amenity=fuel` do OSM com o mesmo CEP e número
   (`addr:postcode` + `addr:housenumber`) ou a mesma rua e número no mesmo município.

Sem nenhuma das três, o posto fica de fora: não usamos centroide de CEP (o CEP único de cidade pequena e de rodovia
põe o posto a quilômetros do lugar).

**Vende diesel?** O cadastro não diz. Entra só posto com evidência (`props.diesel_evidencia`): preço de diesel no LPC,
amostra de diesel S10/S500 no PMQC ou `fuel:diesel`/`fuel:HGV_diesel=yes` no OSM ligado.

## Alcance

UFs **SP, RJ, MG e ES** (o mesmo extrato do Valhalla; `POSTOS_UFS`). Contagem da carga de 09/10/2026:
| UF | Postos com diesel e posição | Com preço do LPC | Posição pelo PMQC | CNEFE + OSM | OSM por endereço | Ligados a um posto do OSM |
|---|---|---|---|---|---|---|
| SP | 2.477 | 560 | 2.198 | 193 | 86 | 1.627 |
| RJ | 1.030 | 181 | 1.023 | 0 | 7 | 705 |
| MG | 1.961 | 231 | 1.941 | 0 | 20 | 1.047 |
| ES | 457 | 66 | 452 | 0 | 5 | 350 |
| **Total** | **5.925** | **1.038** | **5.614** | **193** | **118** | **3.729** |

Entrada: 16.201 postos no cadastro das 4 UFs; 2.131 com preço de diesel no LPC (coletas de 14/09 a 09/10/2026: SP 1.269
postos em 100 municípios, Grande SP 428 em 19 municípios, RJ 305, MG 464, ES 93); 6.207 CNPJs com coordenada no PMQC
(out/2025 a set/2026). Ficaram de fora **1.093 postos com preço no LPC sem posição confiável: só 49% dos postos com
preço entram no mapa** (o PMQC não amostrou o CNPJ, o endereço não está no CNEFE carregado e não há posto do OSM com o
mesmo endereço), e 9.216 postos do cadastro sem evidência de diesel.
O CNEFE só está carregado nos 48 municípios da Grande SP e Baixada (`addr_municipio`), por isso o passo 2 só posicionou
postos de SP. Média do diesel S10 nos postos carregados: R$ 7,20; S500: R$ 6,80.

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
