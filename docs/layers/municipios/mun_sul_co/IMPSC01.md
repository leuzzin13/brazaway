# IMPSC01: Campo Grande, Três Lagoas, Luziânia e Cuiabá

Lote do Centro-Oeste na camada genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)).
Regras a partir de `docs/research/cidades_sul_co/res/<ibge>.json` com os vereditos de `verif/<ibge>.json` (2026-10-18; todos
"confirmado"). Arquivos: `data/raw/municipios/<ibge>.json`, geometria em `data/raw/municipios/geo/`, seeds
`db/seed/layers/restricoes_rmsp__<fonte_id>.sql`, casos de rota em `api/test/fixtures/mun_sul_co/<ibge>.json`, teste
`api/test/layers/mun_sul_co.test.ts`.

**Geometria.** O cache das vias com nome (`data/cache/municipios/osm_named_<ibge>.json`) foi gerado do PBF local
`data/osm/sse_co.osm.pbf` com a malha do IBGE de cada município (mesma lógica de `curadoria/osm_pbf_cache_sudeste.py`, que só
conhece os UFs do Sudeste). Polígonos e linhas são derivados do OSM (ODbL 1.0), ditos em `fonte.licenca`; os atos são
domínio público (Lei 9.610/1998, art. 8º, IV).

| Município | fonte_id | Ativas | Desativadas | Revogadas | Casos de rota | Teste |
|---|---|---|---|---|---|---|
| 5002704 Campo Grande/MS | `campo-grande` | 7 (6 zonas + 1 via) | 0 | 1 | 7 evita | passou |
| 5008305 Três Lagoas/MS | `tres-lagoas` | 1 | 1 | 0 | 1 evita | passou |
| 5212501 Luziânia/GO | `luziania` | 2 (vias) | 0 | 0 | 2 evita | passou |
| 5103403 Cuiabá/MT | `cuiaba` | 0 | 3 | 1 | 0 | passou (só carga e registro) |

## 5002704 Campo Grande (MS)

Decreto 16.664, de 17/06/2026 (DIOGRANDE 8.374, 1/7/2026; vigência na publicação, revoga o Decreto 11.178/2010). Domingos e
feriados livres (`feriados: suspende`) nas zonas; a Rua 14 de Julho é 24 h (`aplica`). VUC local (até 2,20 x 7,20 m e 10 t, sem
cadastro) livre na AR e na ARM; não vale na Rua 14 de Julho (art. 6º, `vuc: null` na regra). Confiança média em todas as ativas:
início da fiscalização (período educativo) não localizado e o art. 9º chama as restrições de "experimentais".

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| `cg_ar_toco` | ativa | Dec. 16.664/2026, art. 5º, §1º, III | seg-sex 6-8h e 17h30-20h; sáb 6-9h | PBT 10,1 a 16 t | `geo/5002704_ar.geojson` (polígono do art. 2º) | evita (toco, ter 07:00; fora 10:00) |
| `cg_ar_truck` | ativa | art. 5º, §1º, IV | seg-sex 6-8h, 11-14h e 17h30-20h; sáb 6-9h | rígido PBT 16,1 a 24 t | idem | evita (truck, ter 12:00; fora 15:00) |
| `cg_ar_articulado` | ativa | art. 5º, §1º, V | seg-sex 6-20h; sáb 6-15h | articulado PBT acima de 16 t | idem | evita (carreta 5e, ter 10:00; fora dom 10:00) |
| `cg_arm_toco` | ativa | art. 5º, §2º, III | seg-sex 6-9h e 17-20h; sáb 6-15h | PBT 10,1 a 16 t | `geo/5002704_arm.geojson` (polígono do art. 3º) | evita (toco, ter 08:30; fora 10:00) |
| `cg_arm_truck` | ativa | art. 5º, §2º, IV | seg-sex 6-9h, 11-14h e 17h30-20h; sáb 6-15h | rígido PBT 16,1 a 24 t | idem | evita (truck, ter 13:00; fora 15:00) |
| `cg_arm_articulado` | ativa | art. 5º, §2º, V | seg-sex 5-20h; sáb 5-15h | articulado PBT acima de 16 t | idem | evita (carreta 5e, ter 05:30; fora dom 05:30) |
| `cg_rua14julho` | ativa | art. 6º | todos os dias, 24 h | PBT acima de 3,5 t | `geo/5002704_vias.geojson` (trecho "R. 14 de Julho entre Av. Fernando Corrêa da Costa e Av. Mato Grosso") | evita (toco, ter 12:00) |
| `cg_decreto_11178_2010` | revogada (art. 11 do 16.664) | Dec. 11.178/2010, arts. 2º e 4º | placeholder | capacidade acima de 1 t | vazia (registro histórico) | n/a |

- AR e ARM são polígonos montados com as vias-limite do OSM (Av. Ernesto Geisel, Av. Mascarenhas de Moraes, Av. Cel. Antonino,
  R. São Borja, R. Ceará, R. Joaquim Murtinho, Av. Eduardo Elias Zahran, Av. Salgado Filho; e, para a ARM, Av. Mato Grosso,
  Av. Ernesto Geisel, Av. Fernando Corrêa da Costa e R. Bahia). Marcados `aproximado`: o ato descreve o perímetro em texto e o
  mapa oficial não foi vetorizado. A Av. Mato Grosso não encosta na Av. Ernesto Geisel no OSM (200 m); o canto foi fechado em
  linha reta. A ARM fica dentro da AR (sobra de ~0,02 km² no canto noroeste por causa das pistas da Geisel). Janelas da AR
  estão contidas nas da ARM em todos os portes, então a sobreposição não muda a decisão.
- Nenhuma rodovia (BR/MS) passa dentro dos polígonos (conferido nas vias com `ref` e `trunk/primary`).
- Rota de passagem conferida: norte-sul pela BR (47,8 km) e diagonais pelo anel não são afetadas. Leste-oeste atravessando o
  centro com carreta, ter 10h: 58,0 km contra 31,3 km no domingo (desvio pelo contorno, é o efeito da proibição das 6-20h; não é
  desvio absurdo, existe alternativa).
- Lacunas do ato, não modeladas (verificador): "extrapesados" (proibidos salvo autorização, sem definição), rígido acima de 24 t,
  caminhão até 10 t acima de 2,20 x 7,20 m. A ARM limita carga e descarga a vagas sinalizadas (art. 6º, parágrafo único), não modelado.
- Pendências: data de início da autuação; conferência do mapa oficial para reduzir o erro do polígono.

## 5008305 Três Lagoas (MS)

Decreto 141/2011 (arts. 1º a 5º), em vigor 40 dias depois da publicação (Decreto 154/2011), com os arts. 1º e 4º alterados
pelo Decreto 140/2012. Sem VUC definido. Confiança média: o diário da ASSOMASUL não cobre Três Lagoas depois de 2019 e as bases
de leis estavam bloqueadas, então alteração posterior não pôde ser excluída.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| `tres_lagoas_d141_retangulo_central` | ativa | Dec. 141/2011, art. 1º e parágrafo único (red. Dec. 140/2012, art. 1º); arts. 2º e 3º | todos os dias, 24 h (feriados: aplica) | caminhão de carga PBT acima de 12 t | `geo/5008305_retangulo_central.geojson` | evita (truck 23 t, ter 10:00) |
| `tres_lagoas_d141_carga_descarga` | desativada | Dec. 141/2011, art. 4º (red. Dec. 140/2012) | seg-sex 9-17h; sáb 9-14h | PBT acima de 3 t | vazia | n/a |

- Polígono: R. Duque de Caxias, Av. (Advogado) Rosário Congro e R. José Amilcar Congro Bastos pelo OSM e, a oeste, a Av. Filinto
  Muller, que fecha a faixa "entre a Rua João Silva e a Av. Filinto Muller" do parágrafo único. A Av. Filinto Muller (liberada
  como corredor pelo Dec. 140/2012) ficou fora: o polígono é cortado 25 m ao redor dela. `aproximado`: o ato não traz mapa e
  descreve o "retângulo" pelas vias. Grafia: o OSM tem "José Amilcar Congro Bastos" (o Dec. 141/2011 diz "Hamílcar").
- Carga e descarga com nota fiscal fora do horário do art. 4º (§1º do Dec. 141/2011) não é modelada: a regra vale 24 h (lado
  seguro, texto do verificador).
- `tres_lagoas_d141_carga_descarga` é restrição de operação (parada), não de circulação; fica desativada e sem geometria (o
  perímetro de Eloy de Miranda Chaves, Rosário Congro, João Silva e Alfredo Justino não foi georreferenciado).
- Não há janela de horário, então o caso de rota não tem `departure_fora`; um utilitário (3,5 t) faz 5,75 km passando 1,06 km
  pelo polígono, o truck contorna (10,5 km).
- Pendências: confirmar ausência de alteração posterior no portal da prefeitura.

## 5212501 Luziânia (GO)

Duas leis municipais antigas, sem lei posterior localizada no SAPL. Sem horário de zona, VUC ou decreto regulamentador
(`vuc: null`, VUC tratado como caminhão). Sinalização e fiscalização não confirmadas (confiança média). As geometrias saíram do
import com `pendencias` vazias.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| `luziania_lei3073_2007_rosario` | ativa | Lei 3.073/2007, art. 1º (e §1º: carga e descarga 20-22h) | 24 h, todos os dias | caminhão/carreta (PBT acima de 3,5 t) | `geo/5212501_vias.geojson`: R. do Rosário, R. São Benedito e R. Bate Couro, inteiras | evita (carreta 5e, ter 10:00) |
| `luziania_lei1579_1993_comercio` | ativa | Lei 1.579/1993, art. 1º (exceto carga e descarga) | 24 h, todos os dias | caminhão/carreta | mesmo arquivo: R. do Comércio, R. Cel. Antônio Carneiro e R. Santíssimo Sacramento, inteiras | evita (carreta 5e, destino fora de Luziânia, ter 10:00) |

- Lei 1.579/1993: `excecao_destino_local` (carga e descarga). Com destino em Luziânia a rota usa as ruas (aviso
  `rmsp_destino_local`); o caso de teste usa destino em Cidade Ocidental. A Lei 3.073/2007 só permite carga e descarga das 20h
  às 22h, que não foi modelado como exceção (lado seguro).
- Sem janela de horário, não há `departure_fora`. Os utilitários de comparação usam 0,4 a 0,6 km dessas ruas.
- Pendências: portarias da Superintendência Municipal de Trânsito e diário oficial não consultados; sinalização em campo.

## 5103403 Cuiabá (MT)

Lei 5.463/2011 (Gazeta Municipal 1.078, 30/09/2011) e Decreto 5.207/2012 (AET). Texto lido por OCR do Querido Diário
(`falha_de_fonte`: portais oficiais fora do ar na pesquisa). Nenhuma regra ficou ativa.

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota |
|---|---|---|---|---|---|---|
| `cuiaba_lei5463_2011_zrm` | desativada: "sem geometria confiável" | Lei 5.463/2011, arts. 3º a 5º e 8º; Dec. 5.207/2012 | 6-20h todos os dias; acima de 24 t 24 h | PBT acima de 10 t | limite municipal do IBGE só como registro | n/a |
| `cuiaba_lei5463_2011_zac` | desativada (perímetro da ZAC não consta da lei) | art. 2º | seg-sex 6-8h, 12-14h, 17h30-20h; sáb 6-8h; dom 6-20h | PBT acima de 10 t | vazia | n/a |
| `cuiaba_lei5463_2011_demais_zonas` | desativada (Macrozona Urbana sem perímetro) | arts. 6º e 7º | seg-sex 6-20h; sáb 6-14h | PBT acima de 24 t | vazia | n/a |
| `cuiaba_lc2009_arts63_64_lc103` | revogada (Lei 5.463/2011) | LC de 30/12/2009, arts. 2º e 3º | seg-sex 6-20h; sáb 6-14h | PBT acima de 16 t | vazia | n/a |

- **ZRM sem geometria confiável.** Tentei montar o perímetro do art. 4º com as vias do OSM, em sequência. Não fecha com
  honestidade: Av. Prof. João Gomes Sobrinho, Trav. Tufik Affi e Praça Luís de Albuquerque não existem com esse nome no OSM
  (e a lei foi lida por OCR); os nomes que existem têm grafia diferente (`Avenida Senador Filinto Müller`, `Avenida Presidente
  Joaquim Augusto da Costa Marques`, `Avenida General Vale`, `Avenida Tenente-Coronel Duarte`, `Avenida João Eugênio Gonçalves
  Pinheiro`); vários cruzamentos têm mais de um ponto; ligando as vias o polígono deu saltos de centenas de metros sem
  cruzamento (vértices a 138 a 527 m das vias). A regra fica registrada com horários e PBT conferidos e
  desativada. Pendência para reativar: o texto oficial do art. 4º (ou o mapa da ZRM) e a conferência dos nomes de via.
- A Av. Fernando Corrêa da Costa é a BR-163/364 no trecho urbano e faz parte do perímetro da ZRM: ao reativar, mantê-la fora
  do polígono (art. 7º da lei libera a BR-364 até o perímetro urbano).
- Pendências já registradas pela pesquisa: perímetro da ZAC e da Macrozona Urbana (zoneamento/Plano Diretor); se a minuta da
  Portaria SEMOB 020/2024 virou lei; lacuna de 10 a 16 t no art. 2º/5º (tratada pelo lado seguro: restringe acima de 10 t).

## Observações para quem mantém o importador e a API (sem alterações feitas)

- `curadoria/osm_pbf_cache_sudeste.py` só conhece os UFs do Sudeste (`UF = {'31','32','33','35'}`) e baixa a malha por UF; para o
  Sul/Centro-Oeste foi preciso uma cópia que lê `data/cache/municipios/ibge_malha_<ibge>.geojson` (a mesma malha que o
  importador usa). Vale generalizar o script (UFs 41-53 e `--pbf data/osm/sse_co.osm.pbf`).
- `schema.json` exige `geometria` com ao menos um item, então regra desativada sem área usa `{"geojson": FeatureCollection vazia}`.
