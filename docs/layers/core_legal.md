# core_legal — regras legais do núcleo

Frente que corrige as regras legais que o roteador aplica a todo veículo: perfis de veículo (CONTRAN),
VUC e AETC, ZMRC, rodízio, produtos perigosos no Minianel, feriados, suspensões publicadas pela CET e
jornada do motorista. As zonas aparecem no mapa por `/api/zones`. A camada `core_legal` ("Calendário
legal de SP", sem desenho no mapa) só acrescenta o aviso das suspensões da CET na rota.

Cada valor abaixo foi conferido em 09/10/2026 no texto da norma (fonte primária). Onde a norma não
dá para modelar com segurança, a regra ficou conservadora ou desligada, e isso está dito em
"Limitações".

## Arquivos

| Arquivo | O que faz |
|---|---|
| `config/vehicle-presets.json` | Perfis com `legal_basis` em cada um; `aliases` para os ids antigos (`carreta` → `carreta_5e`) |
| `config/zmrc-rules.json` | Regras das 4 zonas de SP, anos dos feriados (`holiday_years`) e o perfil de largura do corredor do Minianel |
| `scripts/gen-zones-seed.py` | Gera `db/seed/0002_zones.sql` e `db/seed/0004_holidays.sql`; com `--measure`, remede o corredor no GeoSampa |
| `db/migrations/0101_core_legal.sql` | `holidays.legal_basis`; `rule_suspensions.source/period/raw_text/updated_at`; `restriction_zones.geom_endpoint`; filtro de `truck_ban` pelo PBT |
| `db/seed/0004_holidays.sql` | Feriados de 2026 a 2028 (nacionais, estadual de SP e municipais de São Paulo), com a lei de cada um |
| `importers/sources/cet_suspensoes.py` | Raspa as suspensões da CET, grava em `rule_suspensions` e gera `db/seed/layers/core_legal__cet-suspensoes.sql` |
| `importers/run.py`, `importers/common.py` | Mudança mínima no runner: usa `RECORD_COUNT` e `SEED_SQL` do módulo quando existem (fonte que grava em tabela própria) |
| `importers/tests/test_cet_suspensoes.py` | Interpretação das linhas da CET (sem rede) e proteções da gravação (com `CET_DB_TEST=1`) |
| `data/import/import-zmrc.sh` | Atualiza a ZMRC no banco e os GeoJSON de `data/raw`; o Mini-Anel passa pelo gerador (não desfaz o corte) |
| `api/src/services/vehicle.ts` | Resolve o perfil, calcula `is_truck`, `requires_aet`, o grupo do produto perigoso e os avisos `legal_notes` |
| `api/src/services/zones.ts` | Exceções (`vuc_aetc`, perecível, elétrico, perigoso de consumo local), `vehicle_scope`, feriado, suspensão e polígono de origem/destino |
| `api/src/services/calendar.ts` | Feriados e suspensões do dia (cai para "dia comum" se o banco não tiver as tabelas) |
| `api/src/layers/core_legal.layer.ts` | Camada "Calendário legal de SP": aviso `cet_suspension` quando há suspensão publicada no horário de saída e a rota toca a zona |
| `api/src/services/restrictions.ts`, `api/src/services/routing.ts` | Núcleo, mudança mínima: VUC só isento de `truck_ban` com AETC; vínculo do motorista passado ao plano de jornada |
| `api/src/services/restStops.ts` | Plano de jornada pelo CTB art. 67-C e pela CLT art. 235-C, já com a ADI 5322 |
| `web/src/components/VehicleForm.tsx` | Seção "Autorizações e carga": AETC, tipo de carga, motorização, ano de fabricação, nº ONU, vínculo do motorista |
| `api/test/layers/core_legal.test.ts` | Testes de regra (sem rede) e de rota contra a API |

## Fontes e licenças

Atos oficiais (leis, decretos, resoluções, portarias, decisões) não têm proteção de direito autoral
(Lei 9.610/1998 art. 8º IV). Podem ser usados citando a fonte.

| Norma ou dado | Onde foi conferida | Licença |
|---|---|---|
| Res. CONTRAN 882/2021 (arts. 3º, 4º, 6º, 18 a 20) | PDF do DOU em gov.br/transportes (`Resolucao8822021.pdf`) | ato oficial |
| Res. CONTRAN 899/2022, 994/2023, 1.005/2024 e 1.015/2024 | textos do DOU / gov.br | ato oficial |
| CTB (Lei 9.503/1997) Anexo I, arts. 67-A e 67-C | texto compilado do Planalto | ato oficial |
| CLT arts. 235-A e 235-C | texto compilado do Planalto | ato oficial |
| STF, ADI 5322 | notícia oficial do STF de 05/07/2023 (sessão virtual encerrada em 30/06/2023); modulação nos embargos (ex nunc) | ato oficial |
| Portaria SMT.GAB 137/2018 (arts. 1º, 18, 32 e 35), com as Portarias 154/2018 e 57/2021 | texto compilado do Catálogo de Legislação Municipal | ato oficial |
| Decreto municipal 58.584/2018 (arts. 1º a 3º e 8º) | PDF da CET | ato oficial |
| Portaria SMT.DSV.GAB 009/2019 (arts. 2º e 7º) | PDF da CET | ato oficial |
| Portaria SMT.GAB 051/2024 (arts. 2º e 3º; Anexos I a IV), republicada em 20/12/2024 | PDF do SEI publicado pela CET | ato oficial |
| Lei 662/1949 (red. Lei 10.607/2002), Lei 6.802/1980, Lei 14.759/2023, Lei 9.093/1995 | Planalto | ato oficial |
| Lei estadual SP 9.497/1997 | ALESP, texto compilado | ato oficial |
| Lei municipal SP 14.485/2007 (arts. 9º e 10) | PDF da Câmara Municipal | ato oficial |
| Suspensões do rodízio/ZMRC: `webforms.cetsp.com.br/suspensaorodizio/Relatorio?year=AAAA` | conferida em 09/10/2026: HTTP 200, tabela HTML desde 1997 | página da CET sem licença explícita; o conteúdo são portarias (atos oficiais). Citar a fonte |
| Polígonos da ZMRC e do Minianel | GeoSampa WFS (`restricao_circulacao_veiculo_zmrc` e `_mian`) | CC-BY-SA 4.0 — GeoSampa/Prefeitura de São Paulo |
| Eixo de logradouros, para medir o corredor do Minianel | GeoSampa WFS `geoportal:segmento_logradouro` (218.768 segmentos; usados os ~28 mil a até 700 m da borda) | CC-BY-SA 4.0 — GeoSampa/Prefeitura de São Paulo |

**Nenhum dado do OpenStreetMap entra nos seeds desta frente.** A versão anterior media o corredor do
Minianel no traçado do OSM (Valhalla `/locate`), e as 1.338 larguras gravadas eram dado derivado do
OSM (ODbL) misturado ao polígono do GeoSampa (CC-BY-SA 4.0). As duas licenças não se combinam num
banco derivado redistribuído. Agora a medição usa o eixo de logradouros do próprio GeoSampa: a zona
`...0002`, as larguras em `config/zmrc-rules.json` e o seed são derivados só do GeoSampa e continuam
CC-BY-SA 4.0, com atribuição em `restriction_zones.source`. O Valhalla (OSM) só é usado em tempo de
execução, para rotear, e nos testes. Os dados de terceiros ficam em tabelas próprias
(`restriction_zones`, `holidays`, `rule_suspensions`) e nunca vão para o OSM.

## Regras implementadas

### Perfis de veículo (Res. CONTRAN 882/2021 e alterações)

Limites sem AET (art. 4º): largura 2,60 m (red. Res. 994/2023), altura 4,40 m; comprimento 14 m
(não articulado), 19,30 m (cavalo + semirreboque, red. Res. 1.005/2024) e 19,80 m (caminhão +
reboque ou mais de duas unidades). Peso por eixo (art. 6º): simples 6 t, simples de rodagem dupla
10 t, tandem duplo 17 t, tandem triplo 25,5 t.

| id | Classe | PBT/PBTC | Comprimento | Base |
|---|---|---|---|---|
| `utilitario` | leve | 3,5 t | 5,5 m (típico) | CTB Anexo I: PBT até 3.500 kg não é caminhão |
| `vuc` | rígido | 9 t (típico) | 7,20 m | Portaria SMT 137/2018 art. 18 |
| `toco` | rígido | 16 t | 9 m | 6 + 10 t (art. 6º II e III) |
| `truck` | rígido | 23 t | 12 m | 6 + 17 t (art. 6º V) |
| `carreta_5e` | cavalo + SR | 41,5 t | 19,30 m | 6 + 10 + 25,5 t; teto 54,5 t (art. 6º I d) |
| `carreta_6e` | cavalo + SR | 48,5 t | 19,30 m | 6 + 17 + 25,5 t |
| `romeu_julieta` | caminhão + reboque | 50 t | 19,80 m | art. 6º I h (até 57 t com 17,5 m ou mais), limitado pela soma dos eixos |
| `bitrem` | CVC | 57 t | 19,80 m | art. 6º I j: sem AET até 57 t, 7 eixos, 17,5 a 19,8 m |
| `rodotrem` | CVC com AET | 74 t | 30 m | arts. 18 a 20 |

- Aliases: `carreta` → `carreta_5e`. Os ids `truck`, `vuc`, `toco`, `bitrem` e `rodotrem` foram
  mantidos. A resposta da rota traz `vehicle.preset_id` com o id efetivo.
- `is_truck` é calculado: PBT acima de 3,5 t (CTB Anexo I, red. Lei 14.440/2022).
- `requires_aet` é calculado pelas dimensões: acima do art. 4º, ou CVC acima de 57 t (art. 18). O
  cliente pode declarar `requires_aet: true`, mas não consegue "dispensar" a AET.
- CVC com AET: só do amanhecer ao pôr do sol e a 80 km/h, salvo em pista dupla com separador e 2 ou
  mais faixas por sentido (art. 20 §1º). Isso entra em `legal_notes`; o horário não é aplicado na rota.
- A Res. 1.015/2024 dá +1 t no PBT/PBTC para GNV, biometano, elétrico, híbrido e hidrogênio. Ela está
  citada no arquivo, mas não altera os perfis (o usuário informa o peso real).
- Reporte colaborativo "proibido caminhão" (`truck_ban`): vale só para PBT acima de 3,5 t (função
  `active_reports_for_vehicle`, redefinida na 0101; antes bloqueava também o utilitário de 3,5 t, que não
  é caminhão). O VUC continua isento, mas só o que se enquadra no ano da viagem **e tem AETC**
  (`restrictions.ts`): sem AETC ele é caminhão comum, como na ZMRC e no rodízio.

### VUC em São Paulo

Portaria SMT.GAB 137/2018 art. 18, com a redação da Portaria SMT 57/2021:
- largura até 2,50 m, comprimento até 7,20 m, fabricado a partir de janeiro de 2005 (§1º);
- idade máxima de 15 anos, "excluído o ano de fabricação" (§3º). Em 2026, vale fabricado em 2011 ou depois;
- a liberação na ZMRC é "mediante AETC" (caput). No rodízio, o cadastro de caminhões do DSV é
  obrigatório para isentar o VUC (Portaria DSV.G 09/2019 art. 7º VI e parágrafo único).

A exceção das regras agora se chama `vuc_aetc`. Ela vale só com `is_vuc`, `has_aetc`, dimensões e
idade dentro do limite, e sem carga perigosa: pelo §4º o VUC com perigoso segue a regra de perigosos
(art. 35 na ZMRC). O nome antigo `is_vuc` continua aceito como sinônimo, com a mesma exigência de
AETC. VUC sem AETC, ou fora das medidas, é tratado como caminhão comum e recebe um aviso em
`vehicle.legal_notes`.

A idade é conferida com o ano da saída da viagem (zones.ts). O aviso não depende da data: ele diz a
data-limite (por exemplo, "vale como VUC em São Paulo só até 31/12/2026"), então não contradiz a rota
numa viagem marcada para o ano seguinte.

### ZMRC (zona `...0001`)

Portaria SMT.GAB 137/2018 art. 1º: caminhões proibidos de segunda a sexta das 5h às 21h e aos
sábados das 10h às 14h, excetuados os feriados (`skip_on_holidays`). Vale só para caminhão
(`vehicle_scope: trucks`). Exceções:
- VUC com AETC, em período integral (art. 18);
- perecível com AETC, das 5h às 12h e aos sábados das 10h às 14h (art. 32 I);
- perigoso de "consumo local" ou "outros" (Anexos II e III da Portaria 051/2024), caminhão com até dois
  eixos traseiros, que não seja caminhão-trator, com AETC, das 10h às 16h (art. 35 e §2º). Os demais
  perigosos (por exemplo, diesel ou gasolina a granel, do Anexo I) não têm exceção no horário da ZMRC.

Suspensão: `suspension_scope: zmrc`.

### Rodízio (zonas `...0002` para caminhões e `...0004` para leves)

Decreto 58.584/2018 art. 1º: de segunda a sexta, exceto feriados, das 7h às 10h e das 17h às 20h,
por final de placa (segunda 1 e 2, terça 3 e 4, quarta 5 e 6, quinta 7 e 8, sexta 9 e 0). Sem
`plate_last_digit` informado, o rodízio não é aplicado.
- A área inclui os limites do Minianel (art. 2º §1º), mas **caminhões podem circular pelas vias do
  Minianel** (art. 2º §2º). Por isso há duas zonas:
  - `...0002`, só caminhões: na rota, o polígono do Minianel **menos o corredor das vias-limite**,
    com o recuo padrão de 15 m. Para dizer se a origem ou o destino estão no rodízio, vale o polígono
    inteiro (`geom_endpoint`);
  - `...0004`, só para quem não é caminhão (utilitário até 3,5 t): polígono inteiro, expandido 25 m
    para fora para pegar as vias-limite. Fica escondida no mapa (`hide_on_map`).
- Exceções do art. 3º modeladas: VUC (VIII m, com AETC/cadastro), perecível (VIII l) e elétrico,
  hidrogênio ou híbrido (IX a). GNV não é isento. Os demais incisos (serviços públicos, Correios,
  valores etc.) não têm campo no app.

**Origem e destino no corredor.** A rota usa o polígono recortado, mas origem e destino são
testados contra o Minianel inteiro (com o recuo de 15 m): um endereço em Bom Retiro ou na Vila
Leopoldina que fica dentro do corredor continua "dentro do rodízio". Nesse caso a rota sai com o aviso
`origin_in_zone`/`destination_in_zone` e a zona não é excluída, como nas outras zonas. Antes, esses
pontos ficavam fora da zona: um destino na Av. Gastão Vidigal dava `NO_ROUTE` e um ponto do corredor
saía sem aviso nenhum.

**Corredor do Minianel.** O polígono do GeoSampa contém o corredor inteiro das marginais: as duas
pistas e o rio. Com só 15 m de recuo, um caminhão com a placa do dia era proibido de usar a Marginal,
o que contraria o art. 2º §2º e gerava desvios de mais de 15 km. Uma largura fixa também não serve: a
Marginal Tietê fica a até 430 m da borda perto da Ponte das Bandeiras.

`scripts/gen-zones-seed.py --measure` mede o corredor sobre o eixo de logradouros do GeoSampa
(`segmento_logradouro`, baixado em tiles e guardado em `data/cache`, fora do git):
1. amostra a borda a cada 25 m;
2. separa os segmentos das vias do Minianel pelas denominações oficiais do GeoSampa (lista em
   `config/zmrc-rules.json`, a partir do art. 2º e do Anexo IV da Portaria 051/2024, "em todas as suas
   denominações"): Marginal Tietê (expressa, central, Av. Pres. Castelo Branco, Av. Otaviano Alves de
   Lima, Av. Morvan Dias de Figueiredo, Av. Emb. Macedo Soares, Av. Assis Chateaubriand...), Marginal
   Pinheiros (Av. das Nações Unidas, Av. Dra. Ruth Cardoso, Av. Magalhães de Castro, Av. Eng.
   Billings...), Bandeirantes, Afonso D'Escragnolle Taunay, Complexo Maria Maluf, Tancredo Neves,
   Juntas Provisórias, Anhaia Mello, Salim Farah Maluf e os viadutos. Trechos homônimos longe da borda
   (mais de 450 m nas marginais, 200 m nas avenidas, 300 m nos viadutos) ficam de fora. Os acessos
   oficiais a essas vias e às pontes sobre os rios também contam como pista: tipo `AC` com o nome da via
   ou casando com `access_patterns` (abreviações como "AV PRES C BRANCO" e "AV OTAVIANO A DE LIMA", e
   "PONTE DO PIQUERI", "PONTE DA CASA VERDE"...). São a entrada e a saída das vias. Sem eles, a ponte
   chegava à marginal por uma aresta dentro da zona, e o caminhão com a placa do dia desviava. Acessos a
   ruas internas (por exemplo, "AC A AV DR GASTAO VIDIGAL", "AC A AV SANTOS DUMONT") ficam de fora;
3. cada ponto das pistas (a cada 10 m) cai no trecho da borda mais próximo. Ele só alarga o corredor
   se o raio borda→ponto não cruzar, depois da primeira pista, uma rua local paralela à borda. Isso
   evita engolir quadras entre pistas: em Bom Retiro, a Av. Pres. Castelo Branco entra no bairro, e a
   R. dos Italianos e a R. Sérgio Tomás ficam fora do corredor. Pontes, acessos, viadutos, praças de
   trevo e rodovias não bloqueiam o raio;
4. largura do trecho = maior distância + 8 m (mínimo 35 m). Vales com menos de 400 m entre trechos mais
   largos são preenchidos: o eixo do GeoSampa tem falhas, por exemplo sob a Ponte do Jaguaré;
5. pistas que não cabem na faixa entram como linhas com buffer de 8 m: são as do passo 3 e as que a
   verificação final não acha dentro da faixa.

O seed faz `ST_Difference(minianel, faixas de um lado só ao longo da borda ∪ linhas com buffer)`. Os
números ficam em `minianel_corridors.measured`. Na medição de 09/10/2026: 334 faixas, largura mediana
de 185 m e máxima de 435 m; 1.153 segmentos de pista (com os acessos) e 61 linhas com buffer. O
corredor tem 7,9 km², contra 8,3 km² do corte original. A medição é reprodutível: rodar `--measure`
de novo sobre o mesmo cache dá o mesmo perfil.

Remeça quando o polígono do GeoSampa ou o viário mudar. Se a borda mudar, o gerador recusa o perfil
antigo ("rode --measure de novo").

Validação no Valhalla local (com elevação), carreta com a placa do dia, em 20 pares de origem e
destino fora do Minianel (marginais nos dois sentidos, Cebolão, travessias de ponte, Bandeirantes,
Tancredo Neves, Juntas Provisórias, Anhaia Mello e Salim Farah Maluf), em 09/10/2026:
- nenhum par ficou sem rota, e nenhum ficou mais longo que com o corte sem os acessos;
- 17 pares saem iguais à rota livre ou mais curtos;
- os acessos levaram Casa Verde → Penha de 31,6 km para 17,1 km (igual à livre), Santo Amaro →
  Freguesia de 35,4 para 27,4 km (igual à livre), Butantã → Santana de 40,7 para 28,6 km (livre 25,1),
  Freguesia → Vila Maria de 26,0 para 20,4 km (livre 17,3) e Sacomã → Jabaquara de 12,6 para 11,1 km
  (livre 10,1). O que sobra está em "Limitações".

### Produtos perigosos no Minianel (zona `...0003`)

Portaria SMT.GAB 051/2024 art. 3º: proibido de segunda a sexta, exceto feriados, das 7h às 10h e das
17h às 20h, nas vias do Minianel (I, Anexo IV) e na área interna, o centro expandido (II). A zona usa o
polígono inteiro expandido 25 m (`inset_m: -25`) e vale só com `hazmat` (`hazmat_only`). Fica escondida
no mapa porque repete o polígono do rodízio.

Parágrafo único: os grupos III (consumo local, Anexo II) e IV (outros, Anexo III) "poderão transitar por
período integral na área prevista no inciso II [...], não incluindo as vias do minianel". A zona tem a
exceção `hazmat_local_or_other` para esses grupos, e as vias do Minianel ficam proibidas para eles pela
camada `perigosos` (`costLines` das vias do Anexo IV, para todos os grupos). Conferido na rota: GLP
fracionado (1075 com `hazmat_local_delivery`) às 8h de terça vai da Av. Paulista à Vila Mariana sem a
zona; gasolina (1203) recebe o aviso de origem e destino na zona.

O grupo do produto vem do nº ONU (`hazmat_un`), pelos Anexos I a III conferidos um a um:
`alta_frequencia`, `consumo_local`, `outros` ou `nao_listado`. Vários números estão nos Anexos I e II
(diesel 1202, gasolina 1203, GLP 1075, etanol 1170 etc.) e ficam `ambiguo`: contam como consumo local
só com `hazmat_local_delivery: true`.

Em São Paulo o transporte de perigoso exige a LETPP, "expedida pelo DSV", e o transportador inscrito no
CTPP (Decreto municipal 50.446/2009 art. 5º, conferido no Catálogo de Legislação Municipal; a Portaria
137/2018 art. 35 §1º pede a LETPP para a AETC). Isso vai como aviso em
`legal_notes`. O aviso do VUC com carga perigosa depende do grupo: consumo local ou "outros" → "na ZMRC,
só das 10h às 16h e com AETC"; os demais → "sem exceção na ZMRC no horário da restrição".

### Feriados

Todas as restrições municipais acima valem "exceto feriados". O seed `0004_holidays.sql` tem 39
datas de 2026 a 2028, calculadas pela lei, não pela BrasilAPI:
- nacionais (Lei 662/1949, red. Lei 10.607/2002): 1º/1, 21/4, 1º/5, 7/9, 2/11, 15/11 e 25/12; 12/10
  (Lei 6.802/1980); 20/11 (Lei 14.759/2023);
- estadual de SP: 9 de julho (Lei estadual 9.497/1997);
- municipais de São Paulo (Lei municipal 14.485/2007 art. 10, com a Lei 9.093/1995 art. 2º): 25 de
  janeiro, Sexta-feira da Paixão e Corpus Christi (2/11 e 20/11 também constam, mas já são nacionais);
- **Carnaval não é feriado**, é ponto facultativo. A CET mantém a ZMRC no Carnaval: a tabela de 2026
  traz 16 a 18/02 com a restrição "MANTIDO para veículos pesados". A BrasilAPI marca Carnaval como
  feriado nacional, por isso não é usada como fonte.

Num feriado, a rota traz o aviso `holiday` (montado em `routing.ts`). O cálculo fica no mesmo gerador
das zonas (as regras valem "exceto feriados"). Para estender os anos, mude `holiday_years` em
`config/zmrc-rules.json` e rode:

```bash
python3 scripts/gen-zones-seed.py                    # regenera 0002 e 0004 (stdlib, sem rede)
python3 scripts/gen-zones-seed.py --check-brasilapi  # opcional: confere com a BrasilAPI e só avisa diferenças
docker exec -i truck-router-db psql -U truck -d truck_router < db/seed/0004_holidays.sql
```

O antigo `importers/sources/feriados_sp.py` saiu: ele gravava no banco por conta própria, fora do
contrato do runner, e não estava na lista de arquivos da frente.

### Suspensões da CET

O Decreto 58.584/2018 art. 8º permite à SMT suspender o rodízio por portaria (§2º: só um período do
dia). A CET publica o histórico em `https://webforms.cetsp.com.br/suspensaorodizio/Relatorio?year=AAAA`,
com as colunas DATA, LOCAL AFETADO, EVENTO, PERÍODO e OBSERVAÇÕES.

`importers/sources/cet_suspensoes.py` lê o ano anterior e o atual (`CET_ANOS=2025-2026` muda isso).
Suspensão não tem geometria, então os dados vão para `rule_suspensions`, não para `data_features`.

Como o texto de OBSERVAÇÕES é interpretado:
- o que vem antes de "MANTIDO" diz o que foi suspenso: Rodízio ou "Horário de Pico" vira `rodizio`;
  ZMRC vira `zmrc`; ZMRF vira `zmrf`;
- "MANTIDO para veículos pesados" vira `applies_to_heavy = true`: a restrição continua para caminhões;
- LOCAL AFETADO preenchido vira `scope = local` (só um trecho; não suspende zona);
- PERÍODO "Manhã" vira 0h–12h, "Tarde" vira 12h–24h e vazio vira o dia inteiro. Um intervalo de vários
  dias com período vira um registro por dia (as manhãs, não um bloco contínuo).

Proteções:
- o importador só mexe nas linhas com `source = 'cet'`: uma linha manual ou de teste com a mesma
  chave fica como está e é contada em `NOTES`;
- linhas sem regra reconhecida são ignoradas e contadas em `NOTES`;
- nada é apagado se o site estiver fora, se a página do ano não tiver nenhuma suspensão reconhecida
  ou se mais da metade das linhas do ano não for reconhecida (sinal de que a CET mudou o texto).

Contrato com o runner (`importers/run.py`):
- `fetch()` devolve lista vazia (nada vai para `data_features`) e preenche dois atributos do módulo,
  que o runner usa quando existem (mudança mínima e retrocompatível em `run.py`/`common.py`; as outras
  fontes seguem iguais):
  - `RECORD_COUNT`: a contagem real vai para `data_layer_runs.record_count`, e `/api/sources` mostra
    o número de suspensões, não zero feições;
  - `SEED_SQL`: o seed `db/seed/layers/core_legal__cet-suspensoes.sql` traz as suspensões (upsert só
    sobre linhas da CET) e a carga em `data_layer_runs` uma vez só (`where not exists`), em vez do seed
    genérico de `data_features`;
- `--seed-only` não toca no banco (conferido com `PGHOST` inexistente).

Em 09/10/2026 foram 51 suspensões (2025–2026), 15 delas mantendo a restrição para pesados.

```bash
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck \
  -e PGDATABASE=truck_router -e DATA_DIR=/data -e SEED_DIR=/seed/layers \
  -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer cet_suspensoes
python3 importers/sources/cet_suspensoes.py --file pagina.html   # mostra o que seria gravado (sem banco)
```

Recomendação: rodar diariamente com `--no-seed` (cron), porque as suspensões costumam sair no
próprio dia, e regenerar o seed de vez em quando.

**Aviso na rota.** A camada `core_legal` (`api/src/layers/core_legal.layer.ts`, grupo "Calendário")
devolve o aviso `cet_suspension` (info) quando há suspensão publicada no horário de saída e a rota, a
rota livre ou a origem/destino tocam a zona correspondente (`suspension_scope`; `all` e `local` valem
para qualquer zona de SP; ZMRF é de fretamento e não tem zona no app). Exemplos:
- "A CET suspendeu rodízio em 17/02/2026 (...Carnaval) só para veículos de passeio: MANTIDO para
  veículos pesados. Para veículo de carga a restrição continua valendo";
- "A CET suspendeu ZMRC em 17/03/2027 (...): a rota foi calculada sem essa restrição".

Num feriado a suspensão geral não gera aviso, porque o aviso `holiday` do `routing.ts` já diz que as
regras não se aplicam. Rota fora de São Paulo não recebe aviso.

**Decisão conservadora.** Suspensão "para veículos de passeio, MANTIDO para veículos pesados" não
libera nenhum veículo de carga, nem o utilitário até 3,5 t. Ele não é pesado, mas também não é
"de passeio".

### Jornada (Lei 13.103/2015 e ADI 5322)

- CTB art. 67-C, que vale para empregado e autônomo (art. 67-A):
  - no máximo 5h30 de direção ininterrupta (caput);
  - 30 min de descanso dentro de cada 6 h, fracionáveis (§1º);
  - 11 h de descanso a cada 24 h (§3º).
- STF, ADI 5322 (sessão virtual encerrada em 30/06/2023, efeitos ex nunc):
  - caiu o fracionamento das 11 h e a coincidência com as pausas: o descanso diário passa a ser de 11 h ininterruptas;
  - o tempo de espera (carga, descarga e fiscalização) conta como jornada;
  - caiu o descanso com o veículo em movimento.
- CLT art. 235-C, só para o motorista empregado (art. 235-A): jornada de 8 h + até 2 h extras (até 4 h
  com convenção ou acordo coletivo) e 1 h de refeição (§2º).
- Autônomo (TAC): sem limite de jornada da CLT; valem os limites do CTB. O plano permite 13 h entre
  descansos de 11 h, menos as pausas.

`drivingPlan(duration, stops, { employment })` monta as pausas de 30 min (1 h de refeição para o
empregado), os descansos de 11 h seguidas e as notas. A rota passa `vehicle.employment` (`routing.ts`) e
devolve o regime em `driving_plan.regime`. Sem vínculo informado, usa o limite do empregado (mais
restritivo) e avisa. O plano só conhece o tempo de direção estimado pelo Valhalla: espera,
carga e descarga não entram.

## Testes

```bash
cd api
API_URL=http://localhost:3121 npx vitest run test/layers/core_legal.test.ts     # API da frente, banco compartilhado
docker run --rm -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest tests.test_cet_suspensoes -v
```

`api/test/layers/core_legal.test.ts` (24 testes; o arquivo segue a convenção `api/test/layers/<id>.test.ts`
de `docs/LAYERS.md`):
- regras sem rede: presets, ZMRC, VUC e AETC, perecível e art. 35, rodízio, suspensão, perigosos
  (inclusive grupos III e IV liberados na área interna), jornada e os avisos `legal_notes` (VUC com
  perigoso pelo grupo, LETPP do DSV, idade do VUC com data-limite);
- rotas contra a API: VUC sem AETC, feriados nacional e municipal, rodízio nas marginais, perecível,
  perigosos no Minianel, suspensões (com o aviso `cet_suspension`), destino na Av. Gastão Vidigal e
  origem na R. Sérgio Tomás (corredor, com aviso de zona), Cebolão sem desvio, GLP fracionado no centro
  expandido, `truck_ban` (função SQL e rota: VUC sem AETC desvia, com AETC e utilitário passam) e o
  vínculo do motorista no plano de jornada.

Os 9 testes antigos continuam passando. Mudança de propósito: o VUC dos testes (`VUC_320` em
`helpers.ts`) manda `has_aetc: true`, porque a isenção exige AETC.

Os testes que gravam no banco limpam o que gravaram:
- suspensões: `rule_suspensions` com `source = 'test-core-legal'`, datas de março de 2027;
- reporte `truck_ban` da função SQL: dentro de uma transação desfeita (`rollback`);
- reporte `truck_ban` da rota: `device_id = 'test-core-legal-vuc'`, apagado no `finally`, num trecho da
  Mooca às 22h30 (não cruza os testes das outras camadas);
- importador: com `CET_DB_TEST=1`, linhas de 2031 (ano que a CET não publica), apagadas no fim.

## Como aplicar num banco existente

```bash
docker exec -i truck-router-db psql -U truck -d truck_router < db/migrations/0101_core_legal.sql
docker exec -i truck-router-db psql -U truck -d truck_router < db/seed/0002_zones.sql
docker exec -i truck-router-db psql -U truck -d truck_router < db/seed/0004_holidays.sql
docker exec -i truck-router-db psql -U truck -d truck_router < db/seed/layers/core_legal__cet-suspensoes.sql
```

Numa máquina limpa, o `migrate` aplica tudo em ordem: migrations, depois seeds.

**Aplique os quatro juntos.** Feriados e suspensões sem o seed 0002 deixam a API num estado
contraditório: zonas sem `skip_on_holidays` e a rota avisando "Feriado: ZMRC... não se aplicam" enquanto
evita a ZMRC.

Estado do banco compartilhado (`truck_router`) em 09/10/2026, depois da integração: 0101, seeds 0002 e
0004 e as 51 suspensões da CET aplicados. O banco `truck_router_core_legal` era só uma cópia de
desenvolvimento da frente e pode ser apagado.

## Limitações e pendências

- **Só o horário de saída** (limitação do MVP): a regra não usa a hora em que a rota entra na zona.
- **Vazamento que sobra no corredor.** O corredor ainda contém trechos de ruas locais:
  - o começo das ruas perpendiculares às marginais (por exemplo, a Av. Dr. Gastão Vidigal na Vila
    Leopoldina e a R. do Acre na Mooca). O raio não diferencia essas ruas de uma ponte ou de um acesso.
    Para trânsito de passagem isso pesa pouco: a aresta que continua para dentro da zona é excluída
    inteira pelo Valhalla, então a rua vira um beco sem saída no corredor. Para origem e destino, o
    polígono inteiro (`geom_endpoint`) já resolve;
  - ruas paralelas coladas na pista mais afastada, dentro da margem de 8 m + 15 m de recuo (parte da
    R. Hungria, no Jardim Europa, onde o GeoSampa não tem a pista local da Marginal Pinheiros);
  - ruas entre a borda do polígono e a primeira pista. Pela leitura do art. 2º, elas ficam fora da
    área delimitada pelas vias;
  - os acessos às vias do Minianel e às pontes que entraram no corredor trazem junto o começo de praças
    de trevo e ruas vizinhas (por exemplo, perto da Ponte do Jaguaré e da Ponte do Piqueri);
  - no total, cerca de 30,3 km de ruas locais e praças ficam no corredor (24,7 km sem os acessos; 36,6
    km no corte original). São esses trechos em que um caminhão com a placa do dia ainda pode passar
    sem aviso. Medido cruzando o eixo de logradouros do GeoSampa com a faixa recortada. É a troca feita
    de propósito: menos desvio indevido para quem usa as marginais (art. 2º §2º), um pouco mais de
    vazamento perto das pontes.
- **Diferença entre o traçado do GeoSampa e o do OSM.** O corredor é medido no GeoSampa e a rota anda
  no OSM. Onde os dois divergem mais que a margem (8 m) + o recuo (15 m), a pista do OSM cai na zona, e
  o Valhalla exclui a aresta inteira. Casos achados na validação, com carreta e a placa do dia:
  - Av. Dra. Ruth Cardoso perto do Viaduto Laszlo Braun (Ceagesp) e entre o Jaguaré e Pinheiros: o
    GeoSampa não tem a pista local ali. Butantã → Santana sai com 28,6 km contra 25,1 km livres;
  - uma alça sem nome no OSM junto à Marginal Tietê, perto da Av. Guilherme Cotching (R. José Nei
    Cabral Júnior no GeoSampa): Freguesia → Vila Maria sai com 20,4 km contra 17,3 km;
  - o acesso a um viaduto sem denominação junto à Av. Afonso D'Escragnolle Taunay: Sacomã → Jabaquara
    sai com 11,1 km contra 10,1 km.
  Nenhum par ficou sem rota. Corrigir isso pede uma fonte de pistas com o mesmo traçado do roteador (o
  OSM, que é ODbL e não pode entrar no seed CC-BY-SA) ou um ajuste manual por trecho.
- **Perigosos de consumo local/outros nas vias do Minianel:** a proibição das vias (art. 3º I e parágrafo
  único) vem da camada `perigosos`, por `costLines` com fator 1000 ("proibido salvo sem alternativa"),
  e não da zona. Sem a carga `perigosos/osm-minianel` no banco, esses grupos ficam sem a restrição das
  vias. Para os grupos I e II a zona continua bloqueando área e vias.
- **Aviso de suspensão:** só para o horário de saída, como as zonas. Suspensão "local" (um trecho)
  vira só aviso: o app não sabe qual trecho.
- **VER, ZERC, placas R-9 e a Portaria SMT 49/2021** (Marginal Tietê, que só entra em vigor com a
  conclusão do Rodoanel Norte) não estão aqui. VER e rodovias ficam nas frentes `ver` e
  `rodovias_horario`.
- **Feriados:**
  - só nacionais, o estadual de SP e os municipais da capital;
  - os de outros municípios da RMSP ficam para a frente `rmsp_municipios`;
  - o seed cobre 2026 a 2028: avance `holiday_years` todo ano.
- **AETC e cadastro** são declarados pelo usuário. O app não consulta o SUAE/DSV.
- **Denominações das marginais no GeoSampa.** A lista de nomes foi montada pela posição dos
  segmentos (paralelos ao rio, dentro do corredor) e pelo art. 2º ("em todas as suas denominações").
  A Av. Assis Chateaubriand (pista junto à Ponte das Bandeiras) e a Av. Dra. Ruth Cardoso (pista local
  da Marginal Pinheiros) entraram por isso. Não conferi cada denominação no cadastro de logradouros
  (CADLOG).
- A página de suspensões da CET não tem licença explícita. O conteúdo são atos oficiais; guardamos
  a URL de origem em cada linha.
