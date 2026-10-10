# Grande SP restante — restrições municipais (frente `mun_rmsp_restante`)

Municípios da Região Metropolitana de São Paulo que ainda não tinham regra na camada `restricoes_rmsp` (a capital,
Osasco, Barueri, Guarulhos, Cajamar, Santana de Parnaíba e Ribeirão Pires já estavam). Entraram **só como arquivos**
no formato do núcleo ([`docs/layers/restricoes_municipais.md`](../restricoes_municipais.md)): um
`data/raw/municipios/<ibge>.json` por município, a geometria em `data/raw/municipios/geo/` e o seed
`db/seed/layers/restricoes_rmsp__<fonte_id>.sql`. Nenhum código do núcleo foi alterado.

Fonte das regras: pesquisa `rmsp_restante` (research.json com as correções do verify.json, 10/10/2026). Os atos foram
conferidos de novo quando o texto estava disponível (Arujá, Itapecerica, Caieiras, Mogi) e a Lei 4.391/2025 de
Mairiporã foi lida na Imprensa Oficial (ed. 1443), como o verify indicou.

## Regras

**Aplicadas na rota** (via → `costLines`, fator 1000; zona → `exclusions` com recuo de 20 m):

| Município (IBGE) | Regra (`regra_id`) | Quem | Quando | Ato e artigo | Confiança |
|---|---|---|---|---|---|
| Arujá (3503901) | `aruja_24h`: R. Oscar Schiavon, Av. Amazonas (só bairro/centro), Av. Hans Ossamu Suzuki, Av. Getúlio Vargas, Av. Antônio Afonso de Lima | todo caminhão (sem isenção de VUC, art. 7º, §2º) | todos os dias, 24 h | Dec. 8.183/2023, art. 8º, II e Anexo I, incs. I, IV, V, VI e VII | alta |
| Arujá | `aruja_5h_24h`: Av. Mário Covas (Av. Fatec → Estr. dos Vados, 2 sentidos), Av. dos Expedicionários (bairro/centro, Pça Narciso José Lopes → rotatória Dalila Ferreira Barbosa), Al. Capelinha, R. Duque de Caxias, R. Licínio Rodrigues de Paiva | todo caminhão; **variantes 24 h**: PBT acima de 31,5 t (veículo simples) ou PBTC acima de 33,075 t (combinação) | todos os dias, 5h–23h59 (variantes: 24 h) | Dec. 8.183/2023, art. 8º, III e Anexo I, incs. II, III, VIII, IX e X; art. 8º, I e parágrafo único | alta |
| Itapecerica da Serra (3522208) | `itapecerica_centro`: Av. XV de Novembro, R. Manoel Maximino da Rosa, R. Treze de Maio, Estr. Ary Domingues Mandu (toda a extensão) | caminhões e carretas | seg–sex 5h–21h; sáb 5h–14h (feriado não excetuado) | Dec. 2.184/2010, art. 1º, I e II; art. 2º (exceções); art. 3º (Cartão-Caminhão) | alta |
| Caieiras (3509007) | `caieiras_vila_rosina`: R. Narciso Degrandi, Av. David Kasitzky, Av. Rodolfo Polidoro (R. Esmeraldo Felipe Santiago não existe no OSM) | caminhão e carreta; o VUC é excetuado pela lei, mas sem definição (a rota o trata como caminhão) | 24 h (a lei não fixa horário) | Lei 5.486/2021, arts. 1º e 2º | alta |
| Caieiras | `caieiras_comprimento_12m` (zona): todas as ruas e avenidas municipais, **sem** as rodovias estaduais (SP-332, SP-348, SP-023, SP-354 e alças) | comprimento acima de 12 m | 24 h | Lei 3.560/2004, art. 1º (12 m) e art. 3º (autorização especial); mantida pela Lei 5.233/2019, art. 5º | média |
| Mairiporã (3528502) | `mairipora_cantareira`: Av. Ver. Belarmino Pereira de Carvalho (SP-023 → Av. José Gianesella) e Av. José Gianesella (entrada do Parque Águas Claras → Av. Dr. Luiz Felippe França Ramos), 2 sentidos | veículo de carga com mais de 2 eixos | 24 h | Lei 4.391/2025, art. 1º (proibição), art. 2º (eventos excepcionais), arts. 3º e 4º (multa) | alta |
| Diadema (3513801) | `diadema_vias_restricao`: 11 vias do Centro e 3 do Jd. Eldorado (lista do serviço oficial) | comprimento acima de 6,30 m **ou** largura acima de 2,20 m | seg–sex 6h–20h; sáb 6h–14h | Serviço 55 "Cadastro de caminhões para vias de restrição" (página oficial, sem artigo; decreto de 2011 não localizado) | alta |
| Suzano (3552502) | `suzano_centro`: 24 ruas do Centro (eixos do OSM sob a camada oficial) | caminhão | seg–sáb 7h–21h | Camada oficial "MOB-Restrição trânsito de caminhões" do GeoSuzano, campos Dt_Ho e Obs (sem artigo; ato não localizado) | alta |

**Registradas e NÃO aplicadas** (`kind=desativada`; a rota só avisa `municipal_regra_nao_aplicada` quando passa nelas
com veículo alvo):

| Município | Regra | Motivo (resumo; texto completo em `status_motivo`) | Ato/fonte | Confiança |
|---|---|---|---|---|
| Caieiras | `caieiras_carga_13t` (zona) | "13 t para o transporte de cargas" pode ser carga útil ou PBT; sem decreto regulamentador; fiscalização eventual | Lei 3.560/2004, art. 1º | média |
| Mogi das Cruzes (3530607) | `mogi_area_central` (zona aproximada) | Lei (6h–22h, "transporte pesado") x decreto (carga e descarga 20h–9h, PBT acima de 1 t, experimental) x prefeitura (acima de 3,5 t, 10h–20h, outro perímetro); sinalização define (Dec. 8.375/2008) | Lei 2.903/1985, art. 1º; Dec. 899/1985, arts. 1º e 2º (red. Dec. 1.782/2000); Dec. 8.375/2008 | média |
| Taboão da Serra (3552809) | `taboao_municipio` (zona: município sem a BR-116) | Portaria SETRAM GS 003/2021 ("áreas e vias com restrição") não lida; "município inteiro" e horários de 2010 podem estar superados | Portaria SETRAM GS 003/2021 (só a ementa); imprensa 2010–2011 | média |
| Santa Isabel (3546801) | `santa_isabel_av_republica` | só imprensa (seg–sáb 11h–20h); Dec. 5.568 não lido | Diário de Suzano 20/04/2025 e 02/10/2022 | baixa |
| Franco da Rocha (3516408) | `franco_domingos_ortiz` | notícia oficial de 2015 (subida só para leves), sem ato | notícia da prefeitura, 06/03/2015 | baixa |
| Mauá (3529401) | `maua_fiscalizacao_carga` (R. Onze de Junho, R. Aquidabam) | há fiscalização eletrônica de restrição de carga, mas horário e critério não publicados | lista de equipamentos da SEMOB (2025) | baixa |
| Embu das Artes (3515004) | `embu_muni_stemberg` | conversão à direita proibida (Av. Elias Yazbek → R. Muni Stemberg): a camada não representa conversões | notícia oficial, 26/05/2025 | média |

## Decisões

- **Arujá, art. 8º, I.** O inciso I (24 h para PBT acima de 31,5 t ou PBTC acima de 33,075 t) vale em todas as 10 vias. Nas
  5 vias do inciso II (24 h para todos) ele já está coberto; nas 5 do inciso III entra como duas **variantes**
  (`tipo` light/rigid com `pbt_t` acima de 31,5; `tipo` semitrailer/truck_trailer/cvc com `pbt_t` acima de 33,075 — o
  `weight_t` de uma combinação é o PBTC). "05h00 às 23h59" = janela 05:00–24:00 (`to` exclusivo).
- **Sentido bairro/centro** (Arujá, incisos III e IV): de nordeste para sudoeste, rumo ao Centro (nó `place=suburb`
  "Centro" do OSM). A Av. Amazonas foi montada em dois trechos porque, no OSM, a pista simples não se liga por nome à
  pista dupla; a pista do sentido centro/bairro fica livre.
- **Diadema, "2,20 m de altura e 6,30 de comprimento".** Ao pé da letra (altura E comprimento), como todo caminhão tem
  mais de 2,20 m de altura, a regra vira "comprimento acima de 6,30 m"; a leitura usual (largura, o VUC de 2,20 x
  6,30 m de Barueri e Osasco) dá "largura acima de 2,20 m ou comprimento acima de 6,30 m". A rota aplica a união das
  duas leituras (lado seguro). A R. Santo Antônio é só a do Centro (há outra no sul do município).
- **Caieiras, Lei 3.560/2004.** Vale "nas avenidas e ruas do município": a zona é o limite do IBGE menos uma faixa de
  30 m (pontas redondas) em torno das rodovias estaduais do OSM, que seguem livres. O comprimento (12 m) é aplicado
  (confiança média: lei de 2004 sem decreto regulamentador localizado); o peso (13 t) fica desativado pela ambiguidade.
  Origem ou destino em Caieiras: a zona não é excluída e a rota avisa (`rmsp_origem_na_zona`/`rmsp_destino_na_zona`),
  como na ZMRC. Proibição de produtos perigosos (art. 2º) não representada (ver pendências).
- **Caieiras, Av. David Kasitzky.** Os dois pedaços de mão única do cruzamento com a SP-332 têm o nome da avenida no OSM,
  mas fazem parte do trevo da rodovia: ficaram de fora (com eles, a rota pela SP-332 recebia aviso de via restrita).
- **Mairiporã, art. 1º.** O texto cita a Av. Sen. José Ermírio de Moraes "na entrada do Parque Águas Claras" como ponta
  do trecho que vai até a Av. Dr. Luiz Felippe França Ramos: no OSM esse trecho é a Av. José Gianesella inteira (começa
  no entroncamento com a Ermírio de Moraes, na entrada do Núcleo Águas Claras do Parque Estadual da Cantareira), e a
  ementa fala só da Belarmino e da Gianesella. A pesquisa leu "3 avenidas"; a Ermírio de Moraes (ao sul do parque) não
  foi restringida. O ônibus de fretamento também é proibido, mas o app só trata caminhões.
- **Suzano.** A camada oficial do GeoSuzano desenha a superfície das ruas (um polígono com furos nos quarteirões), não
  uma zona — como zona, o recuo de 20 m apagaria ruas de ~10 m. Virou **via**: eixos do OSM com 30 m ou mais sob os
  polígonos (cruzamentos de ruas livres ficam de fora). Dados de 30/06/2021 (o 18/03/2025 é edição do esquema). A
  imprensa diz que o VUC é isento (2022), sem definição: a rota trata o VUC como caminhão.
- **Mogi das Cruzes** e **Taboão da Serra** ficaram desativadas pelas correções do verify (fontes divergentes; ato de 2021
  não lido). As janelas registradas são as do ato (Mogi, 6h–22h) e da imprensa de 2010 (Taboão), só para o aviso.
- **Feriados**: nenhum ato aplicado excetua feriados (`feriados: aplica`); Santa Isabel (desativada) registra o
  "domingo e feriado livres" da imprensa.

## Não registrados (sem geometria ou sem regra)

| Município | Situação |
|---|---|
| Caieiras — Lei 5.233/2019 (rodízio par/ímpar 6h–20h) | autorizativa; o decreto com as vias não foi localizado e o perfil do veículo não tem final de placa. As vias que o Pé na Estrada atribui ao rodízio foram refutadas pelo verify |
| Caieiras — Leis 2.386/1994 (15 t nas "ruas centrais"), 3.237/2002 (lixo e resíduos na área central) e 2.497/1995 (carga e descarga) | perímetros dependem de decretos não localizados; a 2.497 é de carga e descarga |
| Itaquaquecetuba | Cartão-Caminhão (Cobrasin), mas perímetros (Vila Japão, Vila Maria Augusta) e horário não publicados; fontes se contradizem |
| Juquitiba, Itapevi, Poá | só a compilação Pé na Estrada (erros comprovados, sem licença): nunca usada como dado |
| São Caetano do Sul | 2 equipamentos de "restrição de circulação de veículos" sem dizer que são de caminhão |
| Cotia | placas noticiadas pela prefeitura (Estr. Velha de Cotia, mais de 2 eixos; R. Rio Maicure, só VUC), sem ato — pesquisa anterior, fora desta frente |
| Ferraz de Vasconcelos, Guararema | prefeitura declarou à imprensa não ter restrição |
| Santo André, São Bernardo | nada achado (a restrição regional do ABC de 2012 já está registrada como revogada em `3547809.json`) |
| Biritiba-Mirim, Carapicuíba, Embu-Guaçu, Francisco Morato, Jandira, Pirapora do Bom Jesus, Rio Grande da Serra, Salesópolis, São Lourenço da Serra, Vargem Grande Paulista | nada achado ("não achou" não prova que não exista) |

## Geometria

- **Vias por nome** (`construir: trechos`): montadas pelo importador a partir do OSM. O Overpass público estava ocupado
  (timeouts) em 10/10/2026; o cache que o importador lê (`data/cache/municipios/osm_named_<ibge>.json`) foi gravado a
  partir do PBF local que gerou o grafo do Valhalla, com `data/raw/municipios/curadoria/osm_pbf_cache.py` (osmium na
  imagem `truck-router-osmtools` + pyosmium/shapely na do importador). Nomes do OSM diferentes do ato estão nas
  variantes de `via` (ex.: "Hans Osamu Suzuki", "Lícinio Rodreigues de Paiva", "David Kasitzki", "Artur Sampaio Moreira").
- **Curadas** (`construir: manual`), com `data/raw/municipios/curadoria/rmsp_restante_geo.py`: Suzano (eixos sob o
  GeoSuzano), Caieiras e Taboão (município menos rodovias) e Mogi (perímetro aproximado).
- **Limpeza** (`rmsp_restante_geo.py limpar <arquivo>`): tira vértices a menos de 0,3 m das vias montadas. O import valida
  as linhas com 7 casas decimais, mas a API as manda com 6: o vértice repetido fazia o Valhalla recusar a rota inteira
  ("Failed to edge walk line feature", HTTP 502) em Diadema. Rodar depois de regerar um arquivo de vias e importar de novo.

```bash
# 1) PBF -> cache do Overpass (só se for regerar a geometria)
docker run --rm -v <repo>/data/valhalla:/pbf:ro -v $(pwd)/data/cache/rmsp_restante:/w --entrypoint sh truck-router-osmtools -c \
  "osmium extract -b -47.25,-24.10,-45.70,-23.15 /pbf/sudeste-latest.osm.pbf -o /w/rmsp.osm.pbf --overwrite && \
   osmium tags-filter /w/rmsp.osm.pbf w/highway -o /w/hw.osm.pbf --overwrite && \
   osmium export /w/hw.osm.pbf --geometry-types=linestring -f geojsonseq -a id -o /w/hw.geojsonseq --overwrite"
docker run --rm -v $(pwd)/data:/data -v $(pwd)/data/raw/municipios/curadoria:/c --entrypoint python truck-router-importer \
  /c/osm_pbf_cache.py 3503901 3522208 3509007 3528502 3513801 3546801 3516408 3529401 3515004
# 2) geometria curada e limpeza
docker run --rm -v $(pwd)/data:/data -v $(pwd)/data/raw/municipios/curadoria:/c --entrypoint python truck-router-importer \
  /c/rmsp_restante_geo.py suzano caieiras taboao mogi
# 3) import (um município por vez ou vários separados por vírgula)
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e VALHALLA_URL=http://valhalla:8002 \
  -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer \
  municipios:3503901,3522208,3509007,3528502,3513801,3552502,3530607,3552809,3546801,3516408,3529401,3515004
```

## Licenças

Leis e decretos: domínio público (Lei 9.610/1998, art. 8º, IV). Páginas e notícias oficiais (Diadema, Taboão, Mauá,
Franco da Rocha, Embu) e imprensa (Santa Isabel): só o fato, com citação. Camada do GeoSuzano: sem licença declarada
(`licenseInfo` vazio; a prefeitura pede atribuição ao Depto de Geotecnologias) — usada só para selecionar as vias; os
polígonos não são versionados. Linhas e recortes: OpenStreetMap (ODbL 1.0, © colaboradores do OSM). Limites: IBGE.
Cada município registra a licença em `fonte.licenca` (vai para `data_layer_runs`).

## Testes

`api/test/layers/mun_rmsp_restante.test.ts` (19 testes; não grava no banco). Regras chamando o módulo da camada e 9 rotas
reais: Itapecerica (toco desvia da Av. XV às 10h e passa às 22h), Mairiporã (carreta desvia da Belarmino/Gianesella,
toco de 2 eixos passa), Caieiras (o leve corta pela Vila Rosina, toco e carreta desviam pela SP-332 sem aviso falso;
carreta saindo do Centro recebe o aviso de origem na zona) e Diadema (caminhão desvia do Centro, VUC 2,20 x 6,30 passa).

```bash
cd api && API_URL=http://localhost:3000 npx vitest run test/layers/mun_rmsp_restante.test.ts
```

## Limitações e pendências

- Janela avaliada na saída (o `annotate` avisa a passagem estimada), como no resto da camada.
- O perfil do veículo não tem autorizações municipais (Cartão-Caminhão de Itapecerica e Taboão, cadastro do DMT de
  Arujá, serviço 55 de Diadema, autorização especial de Caieiras): as exceções só aparecem nos avisos.
- VUC sem definição no ato (Caieiras, Suzano) é tratado como caminhão.
- Produtos perigosos (Caieiras, Lei 3.560/2004, art. 2º), rodízio por final de placa (Caieiras, Lei 5.233/2019) e
  proibição de conversão (Embu) não são representáveis no formato atual.
- Polígono de Mogi aproximado (5 lacunas fechadas em linha reta; ver `lacunas` no GeoJSON).
- Mauá: as ruas foram registradas inteiras (a posição dos equipamentos pelo número não existe no OSM); o ponto do
  Viaduto Mário Covas Júnior x Av. Capitão João não foi desenhado.
- Vigilância sugerida pela pesquisa: `lastEditDate` do GeoSuzano, hash do JSON do serviço 55 de Diadema, novos decretos
  de Arujá (`/Atos/Decretos/LivroNNN_OCR/`), leis da Câmara de Caieiras e pedidos por LAI (Mauá, São Caetano, Suzano,
  Taboão, Itaquaquecetuba, Santa Isabel).
