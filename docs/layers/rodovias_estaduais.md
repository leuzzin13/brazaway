# Camada `rodovias_estaduais`: DERs de MG, ES, RJ e, no Sul e Centro-Oeste, PR, RS, GO, MT e DF (e OAEs do DER-MG e do DER-ES na camada `oae`)

Módulo: `api/src/layers/rodovias_estaduais.layer.ts` · Testes: `api/test/layers/rodovias_estaduais.test.ts` e
`importers/tests/test_ders_estaduais.py` · Frente: `ders_estaduais` · Pesquisa: `docs/research/sudeste_ders_estaduais/`
(com a verificação) e, para os atos do DER-ES de 2024–2026, `docs/research/sudeste_vitoria_es/`.

A frente cobre os três DERs do Sudeste fora de SP e, desde 18/10/2026, as regras de trecho do Sul e do Centro-Oeste
(seção [Sul e Centro-Oeste](#sul-e-centro-oeste-pr-rs-go-mt-df); testes em `api/test/layers/rodovias_estaduais_sul_co.test.ts`;
pesquisa em `docs/research/estados_sul_co/`):

| O quê | Onde entra | Importador | Efeito na rota |
|---|---|---|---|
| Pontos críticos vivos do DER-MG (459 ativos em 10/10/2026) | `rodovias_estaduais`, source `der-mg` | `rodovias_estaduais_der_mg` | bloqueio só no ponto ativo e para o veículo afetado; aviso nos demais |
| Restrições de trecho do DER-ES (IS no DIO-ES) | `rodovias_estaduais`, source `der-es` | `rodovias_estaduais_der_es` | trecho penalizado (fator 1000) se a regra está ativa e alcança o veículo |
| RJ-127, Serra de Paracambi (DER-RJ, só notícia) | `rodovias_estaduais`, source `der-rj` | `rodovias_estaduais_der_rj` | desativada: só informa |
| Restrições de trecho do DER-PR (20 portarias de peso/comprimento/eixos), DAER-RS (Estrada do Mar, Rota do Sol, 165 trechos CR6/CTS11), GOINFRA (feriados prolongados), SINFRA-MT (Estrada-Parque, AET) e DER-DF (Eixão, Barragem do Paranoá, Ponte do Rio Melchior) | `rodovias_estaduais`, sources `der-pr`, `daer-rs`, `goinfra`, `sinfra-mt`, `der-df` | `rodovias_estaduais_der_pr`, `_daer_rs`, `_goinfra`, `_sinfra_mt`, `_der_df` | trecho penalizado (fator 1000) se a regra está ativa, alcança o veículo e a `janela` vale na saída |
| 4.370 OAEs do DER-MG (cadastro + inspeção) | `oae`, source `der-mg` | `oae_der_mg` | contagem, ponte de madeira, ponte estreita (só aviso) |
| 17 pontes estaduais do ES com PBT máximo (IS do DER-ES) | `oae`, source `der-es` | `oae_der_es` | bloqueio sobre a ponte para quem pesa mais que o limite |

Curadoria das regras do ES, do RJ, do Sul e do Centro-Oeste: `data/raw/ders_estaduais/regras.json` (versionado com `git add -f`;
o anexo da DN 148/2022 do DAER-RS fica em `data/raw/ders_estaduais/rs_dn148_trechos.json`).

## O que a camada faz na rota

### Pontos críticos do DER-MG

| Situação na fonte (`trafeg_variante`) | `props.situacao` | Veículo afetado | Efeito | Aviso |
|---|---|---|---|---|
| Pista Interrompida | `interrompida` | todos | exclusão pequena no ponto | `pc_desvio` (`warn`, rota desviada) ou `pc_bloqueio_na_rota` (`danger`) |
| Pista interrompida para veículos pesados | `interrompida_pesados` | todo caminhão (PBT > 3,5 t, CTB Anexo I), **VUC inclusive** | exclusão no ponto | idem; só o veículo até 3,5 t passa, com `pc_pesados_liberado` (`warn`) |
| `limite_carga` = Sim **com** `qnt_carga_limite` (t) | (qualquer) | PBT acima do valor | exclusão no ponto | idem; abaixo do valor, `pc_limite_carga_ok` (`info`) |
| Pista Interrompida - Com Variante | `interrompida_com_variante` | — | nenhum (há desvio no local) | `pc_variante` (`warn`) |
| Meia-Pista | `meia_pista` | — | nenhum | `pc_meia_pista` (`warn`, pare e siga) |
| `limite_carga` = Sim **sem** valor (100% hoje) | (qualquer) | — | nenhum | `pc_limite_carga_sem_valor` (`warn`) |
| Pista Normal (livre) / A definir | `livre` / `a_definir` | — | nenhum | só a contagem no resumo |

- **Só ponto ativo bloqueia.** O importador grava só `status` 1 (A iniciar), 2 (Em andamento) ou 3 (Paralisada) sem
  `data_conclusao`. Cada carga vale 72 h a partir do **download de fato** (`valid_to` = hora da consulta + 72 h, com
  `consultado_em` = hora da consulta; o cache da consulta vale 30 min e, quando é usado, a hora é a do arquivo); a API
  ignora feições vencidas (compara com o **agora**, não com a saída: uma viagem marcada para daqui a 5 dias usa a situação
  conhecida hoje). **Fonte fora do ar = carga falha:** o `http_get` comum, depois de 3 falhas, devolve o cache antigo de
  qualquer idade; esta fonte recusa cache com mais de 30 min (`query_geojson(..., sem_cache_vencido=True)`), a carga
  aborta sem tocar no banco e os pontos já gravados vencem sozinhos em 72 h, em vez de bloquear uma via já liberada.
- **Por que `trafeg_variante`:** é o campo que o painel público mostra como "Trafegabilidade" (widget de lista e gráfico
  do painel "Pontos críticos – Público"). A verificação de 10/10/2026 alertou que 4 dos 5 pontos com `trafegabilidade` =
  3 (interrompida) têm variante no local e que bloqueá-los desviaria de vias passáveis: por isso "com variante" só avisa.
  O campo também pega o único ponto ativo "para veículos pesados" (MG-220, Santo Hipólito), que tem `trafegabilidade` = 1
  (livre) — divergência da fonte; vale o que o painel mostra. Sem `trafeg_variante`, usa `trafegabilidade` +
  `solucao_trafego`. `veiculos_leves` = Sim numa interrupção total vira "só pesados".
- **"Veículo pesado"**: o DER-MG não define. Decisão de produto: pesado = **todo caminhão** (PBT > 3,5 t, CTB Anexo I,
  red. Lei 14.440/2022), **VUC inclusive**. A definição de VUC do app (`isVucSP`, Portaria SMT 137/2018 de São Paulo) só
  limita largura, comprimento e idade, não o PBT, e é municipal; o único ponto ativo "para pesados" (MG-220, Santo
  Hipólito) é dano em OAE, e o importador transforma "interrompida" + `veiculos_leves` = Sim em "para pesados" — só os
  leves foram liberados. Só o veículo de até 3,5 t passa, com aviso `warn` para conferir a sinalização.
- **Origem ou destino no próprio ponto:** dentro do círculo de bloqueio (a até `raio_m` do ponto) **ou** numa aresta do
  grafo que o círculo corta — o `exclude_polygons` do Valhalla tira a aresta inteira, e o `/locate` do endereço (perfil
  truck, raio 0) mostra que **todas** as arestas onde ele se encaixa sairiam junto, isolando-o. Aí o app não bloqueia e
  avisa (`pc_origem_destino`, `danger`) — a mesma política da ZMRC. **Nos outros casos, bloqueia**, mesmo com o endereço a
  poucos metros: na MG-430 em Igaratinga, um destino na outra cabeceira da ponte de 40 m (a 37 m do ponto, num nó com a
  aresta seguinte livre) é alcançado pelo desvio de 10,3 km, e destinos a 310 m e 700 m depois da ponte também (o
  limite antigo de 1 km mandava a carreta pela OAE quebrada). O `/locate` só é chamado para origem/destino a até 5 km do
  ponto; sem resposta do Valhalla, o bloqueio fica. Mesmo resultado em `exclusions()` e `annotate()` (cache por rota).
- **"Na rota"** (avisos): ponto com bloqueio = a rota passa dentro do círculo (`raio_m`), como o `passaPor` da camada
  `oae` (candidatos buscados a até 100 m do ponto da fonte: o importador leva o bloqueio até 80 m dele); ponto sem
  bloqueio (variante, meia-pista, livre) = a até 30 m do ponto da fonte.
- **Bloqueio (exclusão e não `costLines`):** pista interrompida é interrupção física num ponto; `costLines` com fator
  1000 ainda deixaria passar quando não há alternativa, e o ponto do DER-MG não traz extensão. O círculo (`raio_m`, padrão
  20 m — decisão de produto) fica sobre a pista da rodovia: o importador consulta o `/locate` do Valhalla e leva o ponto
  para a aresta com o código da rodovia no nome a até 80 m (MGC-xxx também casa BR-xxx; `ajuste = rodovia`), senão para a
  via mais próxima a até 30 m (`via_mais_proxima`); um ponto por pista. O raio encolhe (mínimo 8 m) se outra via (outro
  way do OSM, sem o nome da rodovia, que não é alça) passar a menos de raio + 5 m **do ponto de bloqueio** — medido num 2º
  `/locate` centrado nele (a distância ao ponto da fonte enganaria: uma transversal pode cruzar a rodovia junto do
  bloqueio e ter o ponto mais próximo da fonte longe dali). Em 10/10/2026: MG-430 em Igaratinga (2 pontos em arestas da MG-430, a 11,5 e 20,9 m do ponto da fonte) e MG-220 em Santo
  Hipólito (11,3 m). Exclusões só no corredor origem–destino (bbox com folga de max(0,3°, 25%)); fora dele o `annotate`
  ainda avisa pela rota real.
- O aviso traz causa, previsão (`data_prevista`; "vencida" se passou), a rota alternativa em texto (`obs_alternativa`) e a
  data da última edição do registro. O resumo dá a contagem por situação e a última edição da fonte.

### Regras de trecho (DER-ES, DER-RJ)

| Regra | Efeito | Aviso |
|---|---|---|
| `ativa` e `status = vigente`, critério alcança o veículo | trecho penalizado (`linear_cost_factors`, fator 1000) recortado da própria rota (até 3 rodadas, como em `rodovias_horario`) | `regra_estadual_desvio` (`warn`) ou `regra_estadual_na_rota` (`danger`, sem alternativa) |
| ativa, origem/destino a até 300 m do trecho | nenhum | `regra_estadual_origem_destino` (`danger`) |
| ativa, critério não alcança o veículo | nenhum | linha no resumo ("não alcança o seu veículo") |
| `desativada` (confiança baixa, sem verificação ou vigência não confirmada) | nenhum | `regra_estadual_nao_aplicada` (`info`, com o motivo) |
| `revogada` | nunca aplicada nem mostrada | — |

Critério: `peso_acima_t` (PBT **acima** de X t, estrito, como nos atos "superior a"), `peso_igual_ou_acima_t`, `peso_ate_t`,
`eixos_acima`, `eixos_ate`, `comprimento_acima_m`, `comprimento_ate_m`, `caminhoes`, `todos`, `isenta_carga` (lista de
`cargo_type` isentos, ex.: `perishable`); peso, eixos e comprimento combinam com OU (Lei ES 4.463/1990; os atos listam limites
que o veículo não pode exceder), ou com E se `cumulativo` (MT: "mais de 45 t, com mais de 6 eixos e mais de 16 m"); `ou` lista
combinações alternativas, cada uma cumulativa (RS, DN 148/2022: CR6 ou CTS11). `janelas` (opcional, na regra): `datas`
(`YYYY-MM-DD`) e/ou `dias_semana` (1 = segunda … 7 = domingo) com `inicio`/`fim` (hora local de saída, `fim` exclusivo); fora
da janela a regra não penaliza e o app avisa (`regra_estadual_fora_da_janela`, `info`). **A janela é conferida só no instante
de saída**, não na hora em que a viagem chega ao trecho. Tolerância rota ↔ eixo do SRE: 40 m (o SRE do DER-ES desenha uma
linha só nas pistas duplas), trecho mínimo de 200 m.

## Sul e Centro-Oeste (PR, RS, GO, MT, DF)

Pesquisa verificada: `docs/research/estados_sul_co/<UF>.json` e `.md` (e `AUDITORIA.md`). Só entra **ativa** a regra com ato
primário vigente conferido (texto lido na fonte oficial, artigo citado, sem revogação localizada); o resto fica registrado
como `desativada` (só informa) ou só neste documento.

| UF | Órgão | Entrou ativa | Registrada e desativada | Pendente (por quê) |
|---|---|---|---|---|
| PR | DER-PR | 19 portarias de peso/comprimento/eixos, 24 h: 481/2005 (PR-534, 25 t), 421/2005 (Porto Camargo–Umuarama, 45 t), 318/2009 (PR-518, 45 t), 010/2010 (PR-160, 25 t e 14 m), 095/2010 (PR-151, 45 t e 16 m), 158/2010 (PR-281 e PR-433), 319/2010 (PR-092, 45 t e 17,50 m), 284/2011 (PR-680), 299/2012 (PR-364 e PR-825), 356/2012 (PR-683), 518/2012 (PR-482), 519/2012 (PR-561), 094/2013 (PR-586, 25 t), 280/2020 (PR-447, 45 t), 365/2022 (PR-691, 16 t), 501/2022 (ponte Manoel Ribas, 25 t), 075/2023 (Graciosa, todo caminhão), 239/2026 (Guaratuba: 26 t, 18,60 m, 4 eixos), 451/2026 (PRC-466/PRC-272, 36 t) | 208/2010 (PR-151 sul; fora da lista do DER, vigência desconhecida), 095/2016 (PR-408/PR-804, 26 t; trecho curto sem como localizar), 414/2012 (ferry; sobrepõe a 239/2026), 702/2025 (ferry, vencida em 22/02/2026) | Ramal Casa Branca–Pérola (PR-182) da 421/2005 e PR-508 (508S0020/0030) da 239/2026 sem geometria. Sobreposições abertas com as liberações de CVC por AET (010/2010 × 326/2026; 451/2026 × 029/2022). Não há portaria de horário (feriado, serra, travessia) |
| SC | SIE/DEINFRA | — | — | Nenhum ato de restrição de trecho, de horário (feriado, serra, travessia) nem de peso/altura: só o regime de AET (rotas de CVC/CTV **liberadas**, uma lista de permissão cuja leitura como proibição fora da lista é inferência, IN SIE 007/2021 não lida) e avisos operacionais temporários do GeoSIE (SC-418 km 16,6, meia-pista só até 7,5 t, evento de chuva; não é regra fixa) |
| RS | DAER-RS | DN 152/2023 (ERS-389 Estrada do Mar: PBT > 23 t, > 3 eixos ou > 16 m vedado); DN 135/2021 art. 2º (Rota do Sol: > 19,80 m, > 7 eixos e > 57 t); DN 148/2022 (CR6/CTS11 em 122 dos 165 trechos do Anexo I) | DN 59/2007 (ERS-030, mais de 3 eixos; vigência não confirmada), DN 90/2014 (CVC 19,80 m/9 eixos/74 t; vale para toda a malha, sem trecho), DN 158/2026 (feriados; só excedentes e sem trechos) | Janelas das DN 152 (veículos de 12–23 t com AEC) e 135 (23–57 t, alta/baixa temporada) e produtos perigosos (DN 127/136): janelas semanais com feriados móveis e alta/baixa temporada não são modeladas. 43 trechos da DN 148 sem geometria: 17 com km do SRE alterado desde 2022, 24 sem ref/traçado casável no OSM e 2 sem código no SRE (lista em `rs_dn148_trechos.json`) |
| GO | GOINFRA | Portaria 20/2026 (feriados prolongados, 25 datas de 14/02/2026 a 03/01/2027, 07h–20h, e 18/02/2026 só das 07h às 12h): CVC e combinações com mais de 3 eixos; perecíveis isentos (art. 4º). 7 dos 23 trechos do art. 3º (GO-139 Cristianópolis–Quinca Mariano, GO-217, GO-338, GO-431, GO-507, GO-225, GO-330) | Interdição da Ponte Quinca Mariano (GO-139): só notícia da GOINFRA, vigência não reconfirmada | 16 trechos do art. 3º sem localização segura (descritivos, sem km nem SRE; ex.: GO-164, GO-206, GO-241, GO-210, GO-118, GO-080, GO-530, GO-441, GO-108, GO-239, GO-116, GO-213, GO-010/GO-139). O ato vale só para pista simples com duplo sentido e não diz quais segmentos duplicados ficam de fora. Portaria anual: reconfirmar em 2027. Base legal (Decreto 10.213/2023) revogada em 09/03/2026 |
| MT | SINFRA-MT | Portaria 010/2023 (MT-040/MT-361 Estrada-Parque, 175,7 km: > 45 t, > 6 eixos e > 16 m, só com AET em dia útil); Portaria 061/2021 incisos I e III (MT-010 Rosário Oeste–Acorizal e MT-246: ≥ 26 t, > 3 eixos e > 14 m) | Portaria 061/2021 inciso IV (MT-251 Estrada-Parque): o km do ato não casa com o SRE | Inciso II da 061/2021 (MT-010 até o km 4+600, Rodoanel). Os limites são lidos como cumulativos (o texto os liga com vírgula e "e"); a SINFRA está inacessível, vigência "provável" (sem revogação na busca do IOMAT). Janelas (só dia útil, fim de semana e feriado proibidos mesmo com AET) não são modeladas: a regra penaliza sempre |
| MS | AGESUL | — | — | Nenhum ato vigente de restrição de trecho: só a Res. SEOP/AGESUL 001/2009 (AET, nascer ao pôr do sol; vigência atual não confirmada) e duas resoluções de 2010 (Carnaval e Semana Santa, sem repetição). As restrições de obra (MS-345 10 t, MS-040 km 205/223, MS-168, MS-455) vêm de notícia e boletim, sem ato |
| DF | DER-DF / GDF | Decreto 32.563/2010 art. 2º (DF-002 Eixão: veículos pesados vedados todos os dias, lidos como caminhões); Decreto 46.226/2024 art. 2º (Eixão do Lazer: domingos e feriados nacionais, 6h–18h, todos os veículos); Instrução DER-DF 3/2019 (Barragem do Paranoá, DF-001: caminhão com mais de 2 eixos) | Instrução DER-DF 14/2021 (Ponte do Rio Melchior, DF-180 km ~19,5): não se sabe qual estrutura o ato cobre nem se a ponte nova (Codevasf, prevista para 05/2026) já abriu | Instrução DER-DF 148/2013 (EPIA/BR-040, 6h–9h) e Instrução Conjunta DETRAN/DER 1/2008 (EPTG): vigência indefinida; carga e descarga SCLS/SCLN (Instrução DETRAN 98/2008) regula parada, não circulação; feriados só distritais não entram no Eixão do Lazer |

As regras do DF (Eixão, Barragem do Paranoá e Ponte do Rio Melchior) também aparecem como rascunho em
`docs/research/cidades_sul_co/res/5300108.json` (Brasília); ficam **aqui** (rodovia distrital, ato do DER-DF/GDF) e não na
camada de restrições municipais, para não duplicar penalidade e aviso.

### Como a geometria é montada (`importers/sources/_ders_sulco.py`)

Os atos citam o trecho por rodovia + entroncamento/cidade (ou código SRE + km), nunca com geometria. O importador procura, no
OSM do Valhalla, os ways com `ref` igual ao da rodovia (`PR-534`, `ERS-389`, `GO-217`, `MT-040`, `DF-002`...), junta as falhas
curtas do ref (um way sem `ref` no meio, até 200 m, ou o `lacuna_m` da regra) e traça o caminho mais curto entre duas
**âncoras** guardadas em `regras.json`: as pontas do trecho SRE citado no ato (SRE do DER-PR no geoserver, planilha SRE 08/2026 do
DAER, GeoDados-MT), um nó `place=*` do OSM ou o cruzamento com outra rodovia. As pistas paralelas (até 60 m) entram junto. A
extensão pelo OSM é conferida contra a do ato (aviso se passar de 25%): nas regras com código SRE bate em 1% (PR-447: 45,61 km
no ato, 45,61 km no OSM; MT-040/MT-361: 177,8 km contra 175,7 km). Rodovia sem `ref` no OSM (PR-691, PR-807) e trechos urbanos
usam uma rota de carro do Valhalla entre as pontas (`geometria.rota`, com `via` opcional). O índice de ways por ref sai do PBF
(`osmium tags-filter w/ref`, ~5 min na 1ª vez) e fica em `data/cache/ders_sulco_refidx.json.gz`.

Limitações da geometria: (1) no GO, os trechos do art. 3º são descritivos; 7 foram localizados por cidades e entroncamentos
(a GO-139 e a GO-330 por rota do Valhalla, 75% e 86% sobre ways do ref; trechos concorrentes com BR no OSM, como a GO-330/BR-352,
entram inteiros); (2) o corredor da Portaria 421/2005 (PR) usa a numeração do ato (PR-489/PR-485/PR-182), que no OSM é PR-489/
PR-683/PR-485/PR-182: o traçado é uma rota por Porto Camargo, Porto Figueira, Alto Paraíso e Xambrê até Umuarama (95 km, conferida
contra os refs); (3) o PR-586 (Portaria 094/2013) é a rodovia inteira entre as pontas do ref no OSM.

## Fontes

### DER-MG — pontos críticos (`rodovias_estaduais_der_mg`)
- URL: `https://observatorio.infraestrutura.mg.gov.br/server/rest/services/00_PUBLICACOES/pontos_criticos_publico/FeatureServer/0`
  (ArcGIS 11.4, consulta anônima, `where status IN ('1','2','3') AND data_conclusao IS NULL`). Cadastro operacional do
  DER-MG/SEINFRA — **não é ato normativo**; por isso o efeito é de interdição física (bloqueio no ponto), não de regra.
- 10/10/2026: 833 registros, **459 ativos** — 1 interrompida (MG-430, Igaratinga, dano em OAE, sem variante), 1
  interrompida para pesados (MG-220, Santo Hipólito, dano em OAE), 4 interrompidas com variante (MG-457, MG-430 em São
  Gonçalo do Pará, LMG-828, LMG-850), 24 meia-pista, 429 livres. Última edição na fonte: 09/10/2026 18:42 UTC.
  `qnt_carga_limite` vazio em 100% (24 com `limite_carga` = Sim).
- Atualização: idempotente (apaga e regrava a source). **Rodar de hora em hora ou ao menos 1×/dia**:
  `docker compose --profile import run --rm importer rodovias_estaduais_der_mg` (cron no host). `DERMG_PC_VALIDADE_H`
  (padrão 72) muda a validade; `DERMG_PC_CACHE_H` (padrão 0,5) o cache da consulta, que é também a idade máxima aceita
  quando o Observatório não responde (cache mais velho = carga falha; o cron deve alertar a falha).
- **Seed sem feições** (`db/seed/layers/rodovias_estaduais__der-mg.sql`): o `migrate` reaplica os seeds a cada subida; um
  seed com os pontos do dia sobrescreveria dados frescos pelos antigos (e numa máquina limpa eles já estariam vencidos).
  O seed só apaga os vencidos e registra a fonte uma vez.
- Não usados: `pontos_criticos_variantes` (9 traçados de variantes; podem entrar como desenho no mapa depois) e
  `prazos_adicionais`.

### DER-ES — restrições de trecho (`rodovias_estaduais_der_es`)
Atos no DIO-ES (busca full-text `https://ioes.dio.es.gov.br/busca`, texto conferido em 10/10/2026). Geometria pelo SRE
do DER-ES (WFS do GEOBASES, `geonode:der_rodovias_es_epsg_31984`, 894 segmentos): segmentos inteiros ou recorte por km
(interpolação ao longo da geometria; o km do SRE é proporcional à extensão desenhada).

| `regra_id` | Trecho | Regra | Ato e artigo | Status | Confiança / verificação |
|---|---|---|---|---|---|
| `es_060_km33_39_23t` | ES-060 (Rodovia do Sol), km 33 (Village do Sol) – km 39 (Setiba), Guarapari | caminhão com PBT > 23 t proibido, 24 h | IS DER-ES nº 003-N, de 23/01/2024, art. 1º (DIO-ES de 24/01/2024, p. 35) | **ativa** | alta: verify vitoria_es confirmed. A pesquisa ders_estaduais só tinha a notícia (verify: unverifiable); o ato foi achado depois e o texto, conferido |
| `es_060_acesso_9020_23t` | ES-060, Acesso 9020 (Village do Sol – ES-388/BR-101, Amarelos), km 0–8,5 | caminhão com PBT > 23 t proibido, 24 h | IS DER-ES nº 002-N, de 23/01/2024, art. 1º (DIO-ES de 24/01/2024, p. 34) | **ativa** | alta (verify vitoria_es). A imprensa chamou o trecho de "ES-477", código que não existe ali |
| `es_060_darly_jones_23t_2023` | ES-060, Darly Santos (Vila Velha) – Rod. Jones dos Santos Neves (Guarapari) | PBT > 23 t | IS DER-ES nº 009-N, de 21/12/2023, art. 1º (DIO-ES de 22/12/2023, p. 96–97), tornada insubsistente pela IS 001-N/2024 | **revogada** | só registro, sem geometria |
| `es_terceira_ponte_is021_2004` | 3ª Ponte, ES-060 (SRE 060EES0010) | 3+ eixos, especiais e perigosos 24 h; 2 eixos até 10 t das 6–10h e 16–22h, até 15 t das 6–22h | IS DERTES nº 021-N, de 21/09/2004, art. 1º (DIO-ES de 27/09/2004) | desativada | média; vigência não confirmada: a ponte é regida hoje pela Lei estadual 9.602/2010, art. 2º (frente vitoria_es) |
| `es_010_aracruz_23t_is009_2008` | ES-010, Portal de Aracruz – trevo de Santa Cruz (≈ km 26,171–40,136) | PBT > 23,0 t | IS DER-ES nº 009-N, de 30/10/2008, item 1 (DIO-ES de 04/11/2008) | desativada | verify: unverifiable (vigência não provada) |
| `es_rodovia_do_sol_lei_4463_1990` | Rodovia do Sol inteira | > 2 eixos ou PBT > 15 t | Lei ES nº 4.463, de 14/11/1990, art. 1º | desativada | verify: unverifiable; sem geometria (evita aviso em toda a Rodovia do Sol) |
| `es_res_ca_0778_2005_aet` | trechos da Res. CRE 4.779/98 (lista não achada) | AET de 45 a 57 t | Res. C.A. DERTES nº 0778/2005, arts. 1º e 2º | desativada | verify: unverifiable; sem geometria |
| `es_164_itapina_12t_2018` | ES-164, BR-259 – Itapina | > 12 t | IS DER-ES nº 002-N, de 09/02/2018, art. 1º | desativada | medida ligada à interdição da BR-259 em 2018 |
| `es_177_km14_interdicao_2018` | ES-177 km 14 (Serra da Aliança) | interdição total | IS DER-ES nº 007-N, de 15/06/2018, art. 1º | desativada | emergência de 2018 sem confirmação |

### DER-ES — pontes com PBT máximo (`oae_der_es`, camada `oae`)
17 Instruções de Serviço de 2024–2026, todas "por tempo indeterminado" e em vigor na publicação (art. 2º). Achadas no
DIO-ES pela pesquisa vitoria_es (`der_es_is_restricoes.csv`) e conferidas de novo em 10/10/2026: texto, número da IS,
página e **nenhum ato posterior que cite a mesma OAE** (a busca pelo código da OAE em 2015–2026 só acha o ato).
Jacarandá, Calçado e Fundão também estão na verify vitoria_es (confiança alta); as demais, média.

| Ponte | PBT máx. | Ato (art. 1º) | Ponto de bloqueio |
|---|---|---|---|
| Córrego Boa Vista — ES-080 km 94 (Santa Teresa) | 8 t | IS 008-N, de 28/08/2026 (DIO-ES 31/08/2026, p. 31) | pista da rodovia (sem ponte no OSM) |
| Rio Mutum Preto — ES-164 km 122,54 (Baixo Guandu) | 12 t | IS 006-N, de 16/04/2025 (DIO-ES 17/04/2025) | ponte do OSM |
| Rio Sobreiro — ES-164 km 161 (Itaguaçu) | 10 t | IS 009-N, de 28/08/2026 (DIO-ES 31/08/2026, p. 31–32) | ponte do OSM |
| Córrego (Baixo Guandu) — ES-165 km 3,75 | 12 t | IS 020-N, de 25/10/2024 (DIO-ES 29/10/2024, p. 34) | km no SRE + ponte do OSM (o ato não dá coordenada) |
| Córrego Santo Amaro — ES-165 km 192,22 (Castelo) | 5 t | IS 021-N, de 25/10/2024 (DIO-ES 29/10/2024, p. 34–35) | km no SRE (165EES0150) + pista da rodovia (estrada de terra sem ponte no OSM; `ES-165/ES-379` a 9 m do km; `km_sre+rodovia_sem_ponte_osm`) |
| Córrego São Pedro — ES-177 km 55,78 | 5 t | IS 022-N, de 25/10/2024 (DIO-ES 29/10/2024, p. 35) | ponte do OSM |
| Rio Fundão — ES-261 km 104 (Fundão) | 16 t | IS 007-N, de 28/08/2026 (DIO-ES 31/08/2026, p. 31; processo E-Docs 2026-XJVWX) | ponte do OSM |
| Córrego Paraju — ES-357 km 8,11 (Itaguaçu) | 10 t | IS 028-N, de 03/12/2024 (DIO-ES 04/12/2024, p. 64) | pista da rodovia |
| Córrego Vargem Grande — ES-379 km 51,7 (Muniz Freire) | 5 t | IS 027-N, de 03/12/2024 (DIO-ES 04/12/2024, p. 64) | ponte do OSM |
| Córrego do Vinagre — ES-387 km 43,5 | 5 t | IS 024-N, de 25/10/2024 (DIO-ES 30/10/2024, p. 28–29) | ponte do OSM |
| Rio Calçado — ES-388 km 2,44 (Guarapari) | 10 t | IS 010-N, de 06/11/2025 (DIO-ES 07/11/2025, p. 37–38) | ponte do OSM |
| Córrego Oriente — ES-391 km 7,13 | 5 t | IS 023-N, de 25/10/2024 (DIO-ES 30/10/2024, p. 28) | ponte do OSM |
| Rio Braço Norte Esquerdo — ES-472 km 35,28 | 5 t | IS 025-N, de 25/10/2024 (DIO-ES 30/10/2024, p. 29) | ponte do OSM |
| Rio Jacarandá — ES-476 km 6,11 (Viana) | 12 t | IS 029-N, de 03/12/2024 (DIO-ES 04/12/2024, p. 64–65) | ponte do OSM |
| Ponte João Fardim Perim — ES-483 (Cachoeiro de Itapemirim) | 15 t ou 10 t por eixo | IS 011-N, de 31/08/2026 (DIO-ES 01/09/2026) | ponte do OSM |
| Córrego Água Fria — ES-484 km 85,37 (Afonso Cláudio) | 10 t | IS 009-N, de 02/09/2025 (DIO-ES 03/09/2025, p. 36) | ponte do OSM |
| Córrego Bom Sucesso — ES-484 km 87 (Afonso Cláudio) | 10 t | IS 008-N, de 02/09/2025 (DIO-ES 03/09/2025, p. 35) | ponte do OSM |

Na camada `oae` cada ponte tem `peso_max_t` (e `eixo_max_t` na ES-483), `restricao` (tipo `peso`, vigente desde a
publicação) e `bloqueio` (círculo de 15 m, ou menos se outra via passar perto do ponto de bloqueio, sobre a aresta
marcada como ponte no OSM mais perto da coordenada do ato — ou do km do SRE, quando o ato não dá coordenada; sem ponte no
OSM, sobre a pista da rodovia: Boa Vista, Paraju e Santo Amaro; `oae_peso_desvio`/`oae_peso_excedido` como as demais
fontes). Todas as 17 têm ponto de bloqueio no grafo (Santo Amaro só avisava antes da revisão de 10/10/2026: o km
192,22 no SRE fica a 9 m da `ES-165/ES-379` do OSM). O limite por eixo (`eixo_max_t`) entrou na regra geral da camada
`oae` (`motivosBloqueio`). O link do ato (`restricao.fonte_url`, também na nota dos avisos) é a busca full-text do DIO-ES
no dia da publicação pelo código da OAE **como está no texto**: no Rio Calçado ele vem colado (`OAE388EES0010-004`; a
busca por `388EES0010-004` não acha nada).

### DER-RJ (`rodovias_estaduais_der_rj`)
**O DER-RJ não publica cadastro de OAE, lista de balanças, portaria de restrição em feriados, malha com km nem painel de
interdições** (pesquisa de 10/10/2026: site do DER-RJ, CKAN `dadosabertos.rj.gov.br` org `der` com 13 datasets
agregados e sem geometria, BC25 do INEA com pontes sem carga nem gabarito). As balanças citadas em postos fiscais da
SEFAZ-RJ (Nhangapi, Levy Gasparian, Morro do Coco) não foram confirmadas (o PDF da SEFAZ bloqueia acesso).
O único caso levantado:

| `regra_id` | Trecho | Regra | Fonte | Status |
|---|---|---|---|---|
| `rj_127_serra_paracambi` | RJ-127, Serra de Paracambi (Paracambi – Mendes) | pesados proibidos na obra; pare e siga só para leves das 5h às 10h e das 17h às 24h | notícias DER-RJ ident. 1019 e 1021 (09/2024) e 1035 (21/07/2025); **sem ato normativo** | desativada (confiança baixa; status em 10/2026 não confirmado) |

Traçado: caminho de carro Paracambi → Mendes no grafo do Valhalla (OSM; aproximação do trecho da serra).

### DER-MG — OAEs (`oae_der_mg`, camada `oae`)
- Cadastro `Hosted/pontes_20_05_2025/FeatureServer/0`: 4.370 OAEs (data de referência 01/03/2024). Inspeção
  `Hosted/Pontes/FeatureServer/0`: 1.456 registros, ligados à OAE do cadastro a até 30 m (1.155 casaram; 299 sem par ficaram
  de fora para não duplicar a ponte).
- Kind: 3.652 pontes (308 inferidas: tipo em branco com curso d'água ou descrição "Ponte..." na inspeção), 8 de madeira,
  252 viadutos (inclui "Viaduto Ferroviário"), 66 passarelas, 7 túneis, 385 outras (esteiras, vertedouros, sem tipo).
- `props`: rodovia (do código SRE: `010EMG...` → MG-010, `CMG` → MGC, `LMG`, `AMG`), `sremg`, `id_cadastro`, `urg`,
  `tipo_original`, `estrutura`, `comprimento_m`, `largura_m`, `curso_dagua` e, quando casou, `condicao` com
  `nota_estrutural` (`condestrut`) e `nota_durabilidade` (`conddurabi`) **crus** (valores 0, 2, 3, 4; **escala não
  documentada pela fonte**, nunca usada para bloquear nem para ordenar), `faixas`, `largura_total_m`,
  `altura_estrutura_m` (altura da estrutura, **não** gabarito) e a descrição.
- Na rota (camada `oae`): entra na contagem de estruturas, no aviso `wooden_bridge` e no novo `oae_ponte_estreita`:
  ponte com largura cadastrada < 5,50 m ou 1 faixa → `info` "não cabem dois caminhões"; se a largura for menor que a
  largura do veículo + 0,60 m → `warn` "confira" (843 pontes com largura < 5,5 m; 235 de uma faixa). 5,50 m é decisão de
  produto (dois caminhões de 2,60 m, Res. CONTRAN 882/2021, art. 4º, I, lado a lado com folga); o DER-MG não diz se a
  largura é a total ou a da pista. **Sem limite de peso nem gabarito publicado: nunca bloqueia.**

## Licenças e riscos

| Fonte | Licença registrada | Risco |
|---|---|---|
| Observatório da Infraestrutura (pontos críticos, OAEs, inspeção) | **não declarada** (`licenseInfo` vazio nos itens). O site do DER-MG ("Aspectos legais") permite reutilizar conteúdo "desde que identificada a fonte e atribuído o crédito" | **uso comercial sem autorização expressa.** Antes de produção, pedir ao DER-MG/SEINFRA termo de uso (ideal CC-BY) ou via LAI. O app cita a fonte em cada aviso e em `GET /api/sources` |
| Observatório — itens com "uso restrito DER-MG" (`Hosted/Balancas_V2`, `Hosted/Ocorrências_significativas`, `Hosted/Cadastro` e outros 20+) | restrita | **não importados** |
| DIO-ES (IS do DER-ES), Lei ES 4.463/1990 | ato oficial, domínio público (Lei 9.610/98, art. 8º, IV) | — |
| SRE do DER-ES (GEOBASES) | "Not Specified" | só localiza os trechos dos atos; atribuição DER-ES/GEOBASES |
| Notícias do DER-RJ | fatos com citação (rodapé PRODERJ "todos os direitos reservados") | só fatos e link |
| Atos do DER-PR (Casa Civil/DER), DAER-RS (DN), GOINFRA (portaria/DOE-GO), SINFRA-MT (IOMAT) e DER-DF/GDF (SINJ-DF) | ato oficial, domínio público (Lei 9.610/98, art. 8º, IV) | — |
| SRE do DER-PR (geoserver), do DAER-RS (planilha `rel-sre-082026.xls`) e do GeoDados-MT | **não declarada** (GetCapabilities do PR: `Fees=NONE`, `AccessConstraints=NONE`) | só as pontas dos trechos viram âncora (coordenadas em `regras.json`); a geometria publicada é o OSM |
| OSM (ponto de bloqueio, traçado da RJ-127) | ODbL 1.0 | extração não substancial; nada volta para o OSM |

## Fora desta frente (sobreposição e lacunas)
- **Frente da Grande Vitória (vitoria_es / mun_vitoria)**: o rascunho `regras_rmgv.json` da pesquisa vitoria_es também
  traz a ES-060 km 33–39, o Acesso 9020, a IS 009-N/2023 revogada, a Terceira Ponte (Lei 9.602/2010) e as pontes do
  Jacarandá, Calçado e Fundão. Aqui ficam os atos do **DER-ES** (IS); a Lei 9.602/2010 da 3ª Ponte não foi implementada
  aqui (a IS 021-N/2004 entra desativada). No merge, manter uma implementação só de cada regra para não duplicar
  penalidade e aviso.
- **Portaria DER-MG 4.242/2026** (feriados, com a errata do DOE-MG de 31/03/2026: Semana Santa 05/04, não 06/04) e
  **Portaria DER-MG 4.262/2026** (AET): não implementadas aqui (feriados → `rodovias_horario`/frente de feriados; AET →
  `core_legal`). O SRE-MG 2026_02 do Observatório serve para o escopo "pista simples".
- **Balanças do DER-MG**: não importadas nesta frente. A tabela do site (43 postos) é a lista vigente; para coordenada só
  serve `00_PUBLICACOES/pracas_pesagem/FeatureServer/2` (sem licença; status de 2024) — `Balancas_V2` é de uso restrito.
- **DER-ES**: sem lista de balanças, de interdições atuais nem portaria de feriado (PDA de 07/2024 só com bases
  administrativas). O SRE marca uma "BALANÇA" na ES-060 km 147,786 (Campo Novo), não confirmada.

## Como atualizar
```bash
# pontos críticos: de hora em hora (cron no host)
docker compose --profile import run --rm importer rodovias_estaduais_der_mg
# OAEs do DER-MG (mensal), regras e pontes do ES/RJ (depois de editar data/raw/ders_estaduais/regras.json)
docker compose --profile import run --rm importer oae_der_mg oae_der_es rodovias_estaduais_der_es rodovias_estaduais_der_rj
# Sul e Centro-Oeste (precisa do PBF do Valhalla e, para as rotas `rota`, do Valhalla no ar)
docker compose --profile import run --rm importer rodovias_estaduais_der_pr rodovias_estaduais_daer_rs rodovias_estaduais_goinfra rodovias_estaduais_sinfra_mt rodovias_estaduais_der_df
```
- Nova regra do Sul/Centro-Oeste: acrescentar em `regras.json` (`uf`, `orgao`, `criterio`, `janelas` se for por data/hora, `geometria`
  com `osm_ref`+`de`/`para` ou `rota`); conferir a extensão no log (`geometria_info.aviso`) e rodar o importador da UF. SC e MS
  não têm importador (sem regra com ato vigente); ao surgir uma, criar `rodovias_estaduais_<orgao>.py` copiando o do DER-PR.
- A GOINFRA reedita a Portaria dos feriados todo ano (a de 2027 sai até fevereiro): trocar `janelas` e `publicacao` da regra.
- Curadoria: cada regra precisa citar ato e artigo/item; `ativa: true` só com `status: vigente` e confiança alta ou média;
  `ativa: false` exige `motivo_inativa`; revogada fica `status: revogada`. O importador recusa a carga se algo falhar.
- Para ativar uma regra desativada (ex.: IS 009-N/2008 da ES-010), confirmar a vigência no portal de Instruções de
  Serviço do DER-ES (`portalservicos.der.es.gov.br/IS/Index`, campo Situação) ou no DIO-ES e registrar em `verificacao`.
- Pontes do ES: buscar novas IS no DIO-ES por `"PROIBIR, por tempo indeterminado"` e `"LIBERAR o tráfego"`; incluir/
  remover em `regras.json` e rodar `oae_der_es`. `oae__der-es.sql` depende do grafo do Valhalla (ponto de bloqueio).

## Testes
- `api/test/layers/rodovias_estaduais_sul_co.test.ts` (API em `API_URL`): critérios novos sem rota (comprimento com OU, `cumulativo`, `ou`
  CR6/CTS11, `isenta_carga`, `janelaVale` com datas, dias da semana e fim exclusivo); seeds (ato com artigo, confiança, motivo da
  inativa; Melchior desativada); **uma rota por UF com regra**: PR (PR-447, carreta de 50 t com alerta × 44 t em silêncio; ponte
  Manoel Ribas, carreta desvia × toco passa), RS (Estrada do Mar, DN 148/2022 com bitrem × carreta, Rota do Sol com rodotrem ×
  bitrem), GO (Finados 02/11/2026 às 9h desvia, no dia seguinte e depois das 20h não; perecível isento), MT (rodotrem × carreta na
  MT-040), DF (Eixão, Eixão do Lazer no domingo às 10h × às 19h, Barragem do Paranoá). SC e MS não têm regra.
- `api/test/layers/rodovias_estaduais.test.ts` (API em `API_URL`): regras sem rota (pesados × VUC — inclusive "VUC" de
  14 t — e utilitário, interrompida, variante, meia-pista, limite com e sem valor, ponto inativo, critério de trecho
  estrito e com OU); **ponto crítico de teste "pista interrompida para pesados" no meio de uma rota Lagoa Santa → Pedro
  Leopoldo (LMG-800): carreta e VUC desviam; utilitário (3,5 t) passa com `pc_pesados_liberado`; destino no próprio ponto
  passa com `pc_origem_destino`; destino ~300 m adiante, na aresta seguinte, continua desviando**; nas exclusões, destino
  ~100 m adiante na mesma aresta de 535 m (fora do círculo) é isento pelo `/locate` e o de ~300 m não; ponto vencido não
  gera exclusão; ES-060 km 33–39 (carreta desviada, toco passa); ponte do Rio Jacarandá (toco desvia, VUC passa); RJ-127
  só informa.
- `importers/tests/test_ders_estaduais.py`: situação (`trafeg_variante` × `trafegabilidade`), códigos de rodovia, tipo de
  OAE, recorte por km, validação da curadoria (confiança baixa/revogada nunca ativa; ato sem artigo é recusado), cache
  vencido da fonte viva faz a carga falhar (e o válido data `valid_to` pelo download), raio medido a partir do ponto de
  bloqueio e ponte por km do SRE sem ponte no OSM caindo no snap da rodovia.

## Limitações
- Ponto crítico sem extensão: o bloqueio é um círculo de até 20 m no ponto; se a interrupção real for mais longa, o
  círculo ainda corta a via (a aresta inteira sai do grafo). Ponto que não casou com via (ajuste `ponto_original`) bloqueia
  no ponto da fonte.
- Endereço numa aresta cortada pelo círculo, mas fora dele, fica isento (só aviso) mesmo que a outra ponta da aresta seja
  alcançável pelo desvio: o `exclude_polygons` tira a aresta inteira e o Valhalla não chegaria ao endereço. Na MG-430 em
  Igaratinga, isso vale para os 141 m da aresta da rodovia que encosta na cabeceira leste da ponte.
- Variante: o traçado (camada `pontos_criticos_variantes`) não é usado; "com variante" só avisa.
- Regras de trecho por sentido não existem no ES (os atos valem nos dois sentidos).
- O km do SRE é interpolado na geometria (erro típico < 1%); o Portal de Aracruz (ES-010) é aproximado.
- Sul e Centro-Oeste: `janelas` só são conferidas no instante de saída (uma viagem de 6 h pode chegar ao trecho depois da janela);
  a geometria vem do OSM e pode incluir pistas concorrentes com BR (GO-330/BR-352, RSC-453/BR-453) ou deixar de fora o que o OSM
  não marca com o `ref` do ato; janelas semanais com feriados móveis (RS Estrada do Mar, Rota do Sol; MT dia útil) não são modeladas.
