# IMPSC10: Ventania PR, Chuí RS, Nova Xavantina MT, Santo Antônio de Leverger MT

Lote do Sul/Centro-Oeste na camada genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)).
Pesquisa e verificação de 2026-10-18 em `docs/research/cidades_sul_co/` (`res/` e `verif/`). Geometria das vias pelos nomes do OSM
(cache gerado do PBF, sem Overpass); licença ODbL 1.0 para a geometria, domínio público (Lei 9.610/1998, art. 8º, IV) para os atos.
Nenhum município do lote define VUC (`vuc: null`): o VUC é tratado como caminhão. Todas as janelas são 24 h, todos os dias, `feriados: aplica`.

| ibge | Município | fonte_id | Ativas | Desativadas | Casos de rota | Teste |
|---|---|---|---|---|---|---|
| 4128534 | Ventania/PR | `ventania` | 1 | 0 | 1 evita, 1 sem_alternativa | passou |
| 4305439 | Chuí/RS | `chui` | 1 | 0 | 1 evita | passou |
| 5106257 | Nova Xavantina/MT | `nova-xavantina` | 0 | 1 | 0 (sem fixture: regra sem geometria) | n/a |
| 5107800 | Santo Antônio de Leverger/MT | `santo-antonio-de-leverger` | 1 | 3 | 2 evita, 1 sem_alternativa | passou |

## Ventania/PR (4128534)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `ventania_lei779_vias_16t` | ativa (confiança média) | Lei Municipal 779/2019, art. 1º, caput e §§1º a 4º; art. 2º (CTB art. 187, I); art. 5º. [PDF](https://ventania.pr.gov.br/legislacao/o_1d6gogi0012pvt611g4cs6r4e3i.pdf) | 24 h, todos os dias | caminhão com PBT de 16 t ou mais (modelado como acima de 15,99 t) ou tipo `cvc` (bitrem/treminhão) | 11 ruas inteiras (6 na sede, 5 no distrito de Novo Barro Preto), 23 linhas de `trechos` por nome | evita: Rua Castro Alves (sede), carreta; sem_alternativa: Rua Abel Alves da Silva, carreta (usa a rua e avisa) |

Exceções (só nos avisos): autorização especial da Prefeitura (§2º); serviços públicos essenciais, emergência, guincho, imprensa, obras de
emergência, Correios e sinalização emergencial (§4º). A lei vale para caminhão carregado, que o roteador não sabe: aplica-se a todo veículo
no limite de peso. Nomes no OSM: "Rua Florido Caetano Ferreira", "Rua Sete de Setembro" e "Rua Quinze de Novembro" (as duas últimas com o
número em `alt_name`).

Pendências:
- "Peso igual ou superior a 16 t": a lei não diz se é PBT ou peso real; lido como PBT (lado seguro).
- Não conferido se alguma das 11 ruas é rodovia estadual.
- Rede densamente restrita: na sede as 11 ruas formam uma malha que obriga desvios longos (um caso de teste, Rua Rui Barbosa, deu 15 km de rota para a carreta); não é erro de geometria.
- Divergência OSM (não corrigida aqui): Rua Enelcio Carneiro e Travessa Santa Felicidade têm `hgv=no` e não constam da lei. Encaminhar para `data/osm-overrides/overrides.json` como pendente.
- Os casos de teste do distrito de Novo Barro Preto não entraram: a grade de ruas restritas faz toda rota de carreta cruzar 2 a 4 delas (mais de 0,05 km dentro da regra, limite do teste).

## Chuí/RS (4305439)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `chui_lei2218_2023_av_samuel_prilliac` | ativa (confiança média) | Lei Municipal 2.218, de 15/08/2023, art. 1º (proibição em toda a extensão), art. 3º e parágrafo único (exceções), art. 2º, art. 4º. [Câmara](https://www.camarachui.rs.gov.br/proposicoes/Leis-ordinarias/2023/1/0/3218) | 24 h, todos os dias | todo caminhão e veículo pesado (sem faixa de peso) | Av. Samuel Priliac inteira, 5 linhas (no OSM: "Rua Samuel Priliac", 4 ways tertiary, e "Samuel Priliac", 1 way) | evita: carreta de oeste a leste ao longo da avenida (0 km dentro; o leve usa 0,79 km) |

Exceções: coleta de lixo urbano e veículos oficiais de emergência (art. 3º, parágrafo único). O art. 2º (acesso a residências e estabelecimentos
dos proprietários nas quadras contíguas) não é representável. O toco (2 eixos) também é restringido: a lei não tem faixa de peso.

Pendências: contradição interna entre os arts. 2º e 3º (modelada só a avenida); sinalização e jurisdição da via (trecho de rodovia) não
confirmadas; a travessia da avenida por caminhão é inevitável em alguns pares (a rota cruza com aviso `uses_restricted_way`, 0,04 km).

## Nova Xavantina/MT (5106257)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `novaxavantina_lei2936_2025_beirario` | desativada (confiança média, ato confirmado) | Lei Ordinária 2.936, de 04/09/2025, art. 2º (caminhões proibidos em toda a Av. Beira Rio, exceto carga e descarga); art. 1º (mão única). [SAPL](https://sapl.novaxavantina.mt.leg.br/norma/3043) | 24 h, todos os dias | todo caminhão | nenhuma (sem geometria confiável) | nenhuma |

Motivo: nenhuma via do OSM se chama "Avenida Beira Rio" (busca no cache do PBF, em Nominatim e na extração local ao redor da Praia do Sol).
A avenida existe sem nome ou com outro nome no OSM; o ato a situa entre o estacionamento da Praia do Sol e o embarcador municipal, junto ao
Rio das Mortes. Candidatas à beira do rio perto da Praia do Sol (Rua Fortaleza, 24 m da margem; Av. Couto Magalhães) não puderam ser
confirmadas. A regra entra com geometria vazia (sem feições no banco, sem fixture de rota).

Pendências:
- Georreferenciar a Av. Beira Rio (Prefeitura ou campo; ou nomear a via no OSM) e então ativar a regra com `construir: "trechos"` ou linha manual.
- Data de publicação oficial não vista (usada a da sanção); sinalização em 30 dias (art. 3º) não verificada.

## Santo Antônio de Leverger/MT (5107800)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `santoantonioleverger_lei1428_2023_vias` | ativa (confiança média) | Lei 1.428, de 06/10/2023, art. 1º (a, b, c), art. 2º (exceções), art. 3º (multa), art. 5º. [Portal](https://transparencia.leverger.mt.gov.br/Legislacao/Leis/Lei-14282023-1315) | 24 h, todos os dias | caminhão com 3 eixos ou mais E PBT acima de 20 t | Av. Américo Pinto Brasil (trecho, aproximado), Rua Amilton Figueiredo (OSM: Rua Milton Figueiredo) e Rua Guaporé: 9 linhas | evita: Rua Milton Figueiredo e Rua Guaporé (carreta); sem_alternativa: início da avenida (carreta) |
| `santoantonioleverger_zrm_pbt_10_16` | desativada (baixa; verificador: inverificável) | Lei 1.095/2013, arts. 2º e 3º; Decretos 33/2013 e 53/2014 (mapa anexo) | fora de 8h-12h e 14h-17h30 | PBT acima de 10 t até 16 t (`todas`: acima de 10 e até 16) | nenhuma | nenhuma |
| `santoantonioleverger_zrm_pbt_16_aet` | desativada (baixa; inverificável) | Lei 1.095/2013, art. 4º; Decreto 33/2013, arts. 1º e 5º | 24 h (exige AET) | PBT acima de 16 t | nenhuma | nenhuma |
| `santoantonioleverger_rua_americo_pinto_brasil` | desativada (baixa; confirmada, mas provisória) | Decreto 06/GP/2012, arts. 1º e 2º | 24 h | todo caminhão | nenhuma | nenhuma |

Decisão sobre "caminhões de três eixos e mais de 20 t": a lei não diz se as 20 t são PBT ou carga. Adotada a leitura menos restritiva
(`eixos` acima de 2 E `pbt_t` acima de 20), conforme a verificação. Se a leitura certa for capacidade de carga, trocar `pbt_t` por `payload_t`.
Conferido com o toco (2 eixos): passa pela Rua Milton Figueiredo (0,44 km dentro), a carreta contorna.

Pendências:
- Ambiguidade PBT x carga nas 20 t (acima); decreto regulamentador (art. 5º) não localizado; sinalização não verificada.
- Av. Américo Pinto Brasil: a "Rua Coronel Arruda" (ponta de partida) não existe no OSM. A ponta leste do trecho é o início da avenida no OSM (`lonlat`), marcado `aproximado` (aviso `rmsp_trecho_aproximado`). A Rua "Amilton" Figueiredo aparece no OSM como "Rua Milton Figueiredo"; confirmar. A avenida tem `ref=MT-452` em parte do OSM (jurisdição estadual a confirmar).
- ZRM (perímetro só em mapa anexo aos Decretos 33/2013 e 53/2014) e Decreto 06/2012 (provisório; ruas-limite Nossa Senhora da Conceição e Marechal Rondon ausentes no OSM): registradas sem geometria. Vigência após 2015 não confirmada.
- Janelas da ZRM de 10 a 16 t modeladas como complemento dos horários permitidos; a lei não fala em feriados e fins de semana.
