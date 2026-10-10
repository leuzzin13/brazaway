# core_legal — regras legais do núcleo

Frente que corrige as regras legais que o roteador aplica a todo veículo, sem camada própria no mapa:
perfis de veículo (CONTRAN), VUC e AETC, ZMRC, rodízio, produtos perigosos no Minianel, feriados,
suspensões publicadas pela CET e jornada do motorista.

Cada valor abaixo foi conferido em 09/10/2026 no texto da norma (fonte primária). Onde a norma não
dá para modelar com segurança, a regra ficou conservadora ou desligada, e isso está dito em
"Limitações".

## Arquivos

| Arquivo | O que faz |
|---|---|
| `config/vehicle-presets.json` | Perfis com `legal_basis` em cada um; `aliases` para os ids antigos (`carreta` → `carreta_5e`) |
| `config/zmrc-rules.json` | Regras das 4 zonas de SP (ZMRC, rodízio para caminhões, rodízio para leves, perigosos) e o perfil de largura do corredor do Minianel |
| `scripts/gen-zones-seed.py` | Gera `db/seed/0002_zones.sql`; com `--measure`, remede o corredor do Minianel no Valhalla local |
| `db/migrations/0101_core_legal.sql` | `holidays.legal_basis`; `rule_suspensions.source/period/raw_text/updated_at`; índices |
| `db/seed/0004_holidays.sql` | Feriados de 2026 a 2028 (nacionais, estadual de SP e municipais de São Paulo), com a lei de cada um |
| `importers/sources/feriados_sp.py` | Recalcula os feriados pela lei e regrava `holidays` e o seed (a BrasilAPI só serve para conferência) |
| `importers/sources/cet_suspensoes.py` | Raspa as suspensões da CET e grava direto em `rule_suspensions` |
| `api/src/services/vehicle.ts` | Resolve o perfil, calcula `is_truck`, `requires_aet`, o grupo do produto perigoso e os avisos `legal_notes` |
| `api/src/services/zones.ts` | Exceções (`vuc_aetc`, perecível, elétrico, perigoso de consumo local), `vehicle_scope`, feriado e suspensão |
| `api/src/services/calendar.ts` | Feriados e suspensões do dia (cai para "dia comum" se o banco não tiver as tabelas) |
| `api/src/services/restStops.ts` | Plano de jornada pelo CTB art. 67-C e pela CLT art. 235-C, já com a ADI 5322 |
| `web/src/components/VehicleForm.tsx` | Seção "Autorizações e carga": AETC, tipo de carga, motorização, ano de fabricação, nº ONU |
| `api/test/layers/core_legal.test.ts` | 8 testes de regra (sem rede) e 8 testes de rota contra a API |

## Fontes e licenças

Atos oficiais (leis, decretos, resoluções, portarias, decisões) não têm proteção de direito autoral
(Lei 9.610/1998 art. 8º IV). Podem ser usados citando a fonte.

| Norma | Onde foi conferida | Licença |
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
| Polígonos da ZMRC e do Minianel | GeoSampa WFS | CC-BY-SA 4.0 (já usado pelo projeto) |

Os dados de terceiros ficam em tabelas próprias (`restriction_zones`, `holidays`,
`rule_suspensions`) e nunca vão para o OSM. O seed das zonas leva só geometria do GeoSampa e
números (larguras); nenhuma geometria do OSM.

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

### ZMRC (zona `...0001`)

Portaria SMT.GAB 137/2018 art. 1º: caminhões proibidos de segunda a sexta das 5h às 21h e aos
sábados das 10h às 14h, excetuados os feriados (`skip_on_holidays`). Vale só para caminhão
(`vehicle_scope: trucks`). Exceções:
- VUC com AETC, em período integral (art. 18);
- perecível com AETC, das 5h às 12h e aos sábados das 10h às 14h (art. 32 I);
- perigoso de "consumo local" ou "outros" (Anexos II e III da Portaria 051/2024), caminhão com até dois
  eixos traseiros, que não seja caminhão-trator, com AETC, das 10h às 16h (art. 35 e §2º).

Suspensão: `suspension_scope: zmrc`.

### Rodízio (zonas `...0002` para caminhões e `...0004` para leves)

Decreto 58.584/2018 art. 1º: de segunda a sexta, exceto feriados, das 7h às 10h e das 17h às 20h,
por final de placa (segunda 1 e 2, terça 3 e 4, quarta 5 e 6, quinta 7 e 8, sexta 9 e 0). Sem
`plate_last_digit` informado, o rodízio não é aplicado.
- A área inclui os limites do Minianel (art. 2º §1º), mas **caminhões podem circular pelas vias do
  Minianel** (art. 2º §2º). Por isso há duas zonas:
  - `...0002`, só caminhões: polígono do Minianel **menos o corredor das vias-limite**, com o recuo
    padrão de 15 m;
  - `...0004`, só para quem não é caminhão (utilitário até 3,5 t): polígono inteiro, expandido 25 m
    para fora para pegar as vias-limite. Fica escondida no mapa (`hide_on_map`).
- Exceções do art. 3º modeladas: VUC (VIII m, com AETC/cadastro), perecível (VIII l) e elétrico,
  hidrogênio ou híbrido (IX a). GNV não é isento. Os demais incisos (serviços públicos, Correios,
  valores etc.) não têm campo no app.

**Corredor do Minianel.** O polígono do GeoSampa contém o corredor inteiro das marginais: as duas
pistas e o rio. Com só 15 m de recuo, um caminhão com a placa do dia era proibido de usar a Marginal,
o que contraria o art. 2º §2º e gerava desvios de mais de 15 km. Uma largura fixa também não serve: a
Marginal Tietê fica a até cerca de 440 m da borda perto da Ponte das Bandeiras.

`scripts/gen-zones-seed.py --measure` resolve isso assim:
1. caminha pela borda do polígono a cada 40 m;
2. sonda o Valhalla local (`/locate`) para dentro, até 520 m;
3. guarda as arestas cujo nome é de uma via do Minianel (lista do art. 2º e do Anexo IV da Portaria
   051/2024);
4. grava em `config/zmrc-rules.json` a largura em cada ponto: a distância da pista mais afastada + 20 m.
   O teto é 500 m nas marginais e 250 m nas avenidas.

O seed faz `ST_Difference(minianel, união dos buffers de cada trecho da borda com a sua largura)`,
mais dois círculos nos trevos (Cebolão e Salim Farah Maluf). Resultado: mediana de 214 m nas
marginais e 50 m nas avenidas. Remeça quando o polígono do GeoSampa ou o viário mudar.

### Produtos perigosos no Minianel (zona `...0003`)

Portaria SMT.GAB 051/2024 art. 3º: proibido de segunda a sexta, exceto feriados, das 7h às 10h e das
17h às 20h, nas vias do Minianel (Anexo IV) e no centro expandido. A zona usa o polígono inteiro
expandido 25 m (`inset_m: -25`) e vale só com `hazmat` (`hazmat_only`). Fica escondida no mapa
porque repete o polígono do rodízio.

O grupo do produto vem do nº ONU (`hazmat_un`), pelos Anexos I a III conferidos um a um:
`alta_frequencia`, `consumo_local`, `outros` ou `nao_listado`. Vários números estão nos Anexos I e II
(diesel 1202, gasolina 1203, GLP 1075, etanol 1170 etc.) e ficam `ambiguo`: contam como consumo local
só com `hazmat_local_delivery: true`.

Em São Paulo o transporte de perigoso exige LETPP (Decreto 50.446/2009), e isso vai como aviso em
`legal_notes`.

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

Num feriado, a rota traz o aviso `holiday` (montado em `routing.ts`). Para recarregar ou estender os
anos:

```bash
python3 importers/sources/feriados_sp.py --seed-only 2027 2029   # só regenera o seed (stdlib)
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck \
  -e PGDATABASE=truck_router -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e FERIADOS_ANOS=2026-2028 \
  -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer feriados_sp --no-seed
```

### Suspensões da CET

O Decreto 58.584/2018 art. 8º permite à SMT suspender o rodízio por portaria (§2º: só um período do
dia). A CET publica o histórico em `https://webforms.cetsp.com.br/suspensaorodizio/Relatorio?year=AAAA`,
com as colunas DATA, LOCAL AFETADO, EVENTO, PERÍODO e OBSERVAÇÕES.

`importers/sources/cet_suspensoes.py` lê o ano anterior e o atual (`CET_ANOS=2025-2026` muda isso) e
grava direto em `rule_suspensions`. Ele não usa `data_features` (suspensão não tem geometria), mas
expõe `LAYER_ID`/`SOURCE`/`SOURCE_URL`/`LICENSE` para o runner registrar a carga em
`data_layer_runs`. Rode com `--no-seed`.

Como o texto de OBSERVAÇÕES é interpretado:
- o que vem antes de "MANTIDO" diz o que foi suspenso: Rodízio ou "Horário de Pico" vira `rodizio`;
  ZMRC vira `zmrc`; ZMRF vira `zmrf`;
- "MANTIDO para veículos pesados" vira `applies_to_heavy = true`: a restrição continua para caminhões;
- LOCAL AFETADO preenchido vira `scope = local` (só um trecho; não suspende zona);
- PERÍODO "Manhã" vira 0h–12h, "Tarde" vira 12h–24h e vazio vira o dia inteiro.

Linhas sem regra reconhecida são ignoradas e contadas em `NOTES`. Se o site estiver fora, nada é
apagado. Em 09/10/2026 foram 51 suspensões (2025–2026), 15 delas mantendo a restrição para pesados.

```bash
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck \
  -e PGDATABASE=truck_router -e DATA_DIR=/data -e SEED_DIR=/seed/layers \
  -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer cet_suspensoes --no-seed
python3 importers/sources/cet_suspensoes.py --file pagina.html   # mostra o que seria gravado (sem banco)
```

Recomendação: rodar diariamente (cron), porque as suspensões costumam sair no próprio dia.

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
empregado), os descansos de 11 h seguidas e as notas. Sem vínculo informado, usa o limite do empregado
(mais restritivo) e avisa. O plano só conhece o tempo de direção estimado pelo Valhalla: espera,
carga e descarga não entram.

## Testes

```bash
cd api
API_URL=http://localhost:3101 TEST_DATABASE_URL=postgres://truck:truck@localhost:5432/truck_router_core_legal \
  npx vitest run test/layers/core_legal.test.ts
```

Os 9 testes antigos continuam passando. Mudança de propósito: o VUC dos testes (`VUC_320` em
`helpers.ts`) passa a mandar `has_aetc: true`, porque a isenção agora exige AETC. Um teste novo
mostra o VUC **sem** AETC tratado como caminhão.

O teste de suspensão grava e apaga as próprias linhas em `rule_suspensions`
(`source = 'test-core-legal'`, datas de março de 2027).

## Como aplicar num banco existente

```bash
docker exec -i truck-router-db psql -U truck -d truck_router < db/migrations/0101_core_legal.sql
docker exec -i truck-router-db psql -U truck -d truck_router < db/seed/0002_zones.sql
docker exec -i truck-router-db psql -U truck -d truck_router < db/seed/0004_holidays.sql
# e o importador de suspensões (acima)
```

Numa máquina limpa, o `migrate` aplica tudo em ordem: migrations, depois seeds.

## Limitações e pendências

- **Só o horário de saída** (limitação do MVP): a regra não usa a hora em que a rota entra na zona.
- **Vínculo do motorista na rota:** `routing.ts` (fora desta frente) chama
  `drivingPlan(duration, stops)` sem `employment`, então a rota sempre sai com regime `unknown`. A
  correção é passar `{ employment: vehicle.employment }`.
- **Aviso de suspensão:** a rota não avisa quando um dia tem suspensão publicada, porque o aviso
  precisaria de `routing.ts` ou de um módulo de camada. Os dados estão em `legalDayInfo().suspensions`.
- **Perigosos de consumo local/outros:** a Portaria 051/2024 (art. 3º, parágrafo único) libera esses
  grupos dentro do centro expandido, mas não nas vias do Minianel. A zona `...0003` tem a exceção
  `hazmat_local_or_other`, então os grupos III e IV ficam fora dela. As vias do Anexo IV entram como
  `costLines` da camada `perigosos`, para todos os grupos, sem bloquear quem só cruza o anel por ponte
  ou viaduto (ver `docs/layers/perigosos.md`). O grupo vem de `services/hazmat.ts`, com os
  qualificadores do Anexo II (o 3082 só conta como consumo local com `hazmat_biodiesel`).
- **VER, ZERC, placas R-9 e a Portaria SMT 49/2021** (Marginal Tietê, que só entra em vigor com a
  conclusão do Rodoanel Norte) não estão aqui. VER e rodovias ficam nas frentes `ver` e
  `rodovias_horario`.
- **Feriados:**
  - só nacionais, o estadual de SP e os municipais da capital;
  - os de outros municípios da RMSP ficam para a frente `rmsp_municipios`;
  - o seed cobre 2026 a 2028: rodar `feriados_sp` todo ano.
- **AETC e cadastro** são declarados pelo usuário. O app não consulta o SUAE/DSV.
- **Corredor medido no OSM:** as larguras vêm do traçado do OSM no Valhalla local, de 10/2026. Só os
  números vão para o seed, mas se o viário mudar é preciso rodar `--measure` de novo.
- A página de suspensões da CET não tem licença explícita. O conteúdo são atos oficiais; guardamos
  a URL de origem em cada linha.
