# Camada `ver` — Vias Estruturais Restritas (cidade de São Paulo)

Proíbe caminhões nas VER da capital nos dias e horários do **art. 2º da Portaria SMT.GAB 137/2018** (texto compilado),
com as exceções que dá para deduzir do perfil do veículo. O § 5º criado pela **Portaria SMT.GAB 49/2021** (Marginal Tietê
proibida em período integral) está carregado, mas **inativo**: só entra em vigor com a liberação do trecho norte do Rodoanel.

| Peça | Arquivo |
|---|---|
| Importador | `importers/sources/ver_portaria137.py` (`LAYER_ID=ver`, `SOURCE=smt-137-2018`) |
| Seed | `db/seed/layers/ver__smt-137-2018.sql` (0,6 MB, 79 feições) |
| API | `api/src/layers/ver.layer.ts` |
| Testes | `api/test/layers/ver.test.ts` (regras com os dados do banco + rotas) |

## Fontes e licença

| Fonte | Uso | Licença |
|---|---|---|
| Portaria 137/2018-SMT.GAB, texto compilado — https://legislacao.prefeitura.sp.gov.br/leis/portaria-secretaria-municipal-de-mobilidade-e-transportes-smt-137-de-3-de-agosto-de-2018 | lista das 79 VER (art. 2º §§ 1º–4º), horários, exceções (arts. 18, 27, 28, 30, 32), vigência (art. 44) | ato oficial, sem proteção autoral (Lei 9.610/98, art. 8º, IV) |
| Portaria 49/2021-SMT.GAB — https://legislacao.prefeitura.sp.gov.br/leis/portaria-secretaria-municipal-de-mobilidade-e-transito-smt-49-de-8-de-outubro-de-2021 | § 5º (Marginal Tietê), art. 38-A, revogação de § 4º I–IV, vigência (art. 3º) | idem |
| Portaria 57/2021-SMT.GAB (VUC: largura 2,50 m) e 154/2018 (valores) | só referência (não alteram horários das VER) | idem |
| CTB (Lei 9.503/97) Anexo I e art. 187, I | caminhão = PBT > 3.500 kg; multa (média) por transitar em horário/local proibido | idem |
| OpenStreetMap (PBF Geofabrik `sudeste-latest`, o mesmo dos tiles do Valhalla) | geometria das vias | **ODbL 1.0** — © colaboradores do OpenStreetMap. A geometria da camada é base derivada do OSM: atribuir e manter sob ODbL se for redistribuída |
| Google My Maps da CET (3 KML: VER §1, §2/§3, §4) | **só conferência** (% de cobertura); nada do KML vai para o seed | sem licença explícita |

Horários, exceções e vigências foram conferidos no texto compilado da Portaria 137/2018 e no texto da Portaria 49/2021, em
09/10/2026. Os trechos usados estão em `data/raw/ver/portaria137_2018_trechos.txt` e `data/raw/ver/portaria49_2021.txt`; a cada
importação o importador confere, letra por letra, que o texto de cada um dos 81 incisos (`texto_legal`) está no texto oficial.

## Regras modeladas

Todas as VER valem **exceto feriados** (art. 2º, caput). Caminhão = PBT > 3,5 t (CTB, Anexo I); abaixo disso a camada não age.

| § | Horário proibido | Exceções modeladas (todas exigem AETC, `has_aetc: true`) |
|---|---|---|
| 1º (26 vias) | seg–sex 05h–21h; sáb 10h–14h | perecíveis 05h–12h e sáb 10h–14h (art. 32, I); concretagem 05h–16h (arts. 27, I e 28, I). **VUC proibido mesmo com AETC** (art. 18 só libera ZMRC, ZERC e VER dos §§ 2º–4º). Mudança **não** é exceção no § 1º (art. 30, I cita só §§ 2º e 3º) |
| 2º (4 vias) | seg–sex 05h–21h; sáb 10h–14h | VUC período integral (art. 18); perecíveis 05h–12h e sáb 10h–14h (art. 32, I); concretagem 05h–16h (arts. 27/28, I); mudança 05h–16h (art. 30, I) |
| 3º (9 vias) | seg–sex 05h–21h; sáb 10h–14h | igual ao § 2º |
| 4º (40 itens) | seg–sex 05h–09h e 17h–21h; sáb 10h–14h | VUC integral (art. 18); perecíveis, concretagem e mudança seg–sex 05h–09h e sáb 10h–14h (arts. 32, II; 27/28, II; 30, II) |
| 5º (Portaria 49/2021, **inativo**) | período integral | carga com origem/destino no município liberada (art. 38-A); quem tem AETC segue proibido seg–sex 05h–21h e sáb 10h–14h (art. 38-A, parágrafo único) |

Mapeamento do perfil: VUC = `is_vuc`; perecíveis = `cargo_type: perishable`; concretagem = `cargo_type: concrete`; mudança =
`cargo_type: moving`; origem/destino no município = `cargo_od_in_city`. Janelas: início incluído, fim excluído (05:00 proíbe,
21:00 libera). Suspensões da CET só afastam a VER se tiverem escopo `ver` ou `all` e não valerem para pesados.

**Não modeladas** (dependem de serviço sem campo no perfil; o motorista com AETC dessas atividades deve conferir a própria
autorização): acesso a estacionamento próprio (art. 19), guincho (20), reportagem (21), sinalização (23), zoonose (24), obras
e serviços essenciais (25), vacinas (26), feiras e Ceagesp (29), coleta de lixo (31), entulho (33), caçambas (34), valores
(36, Portaria 154/2018), material de construção (37), serviço postal (38).

**Portaria 49/2021:** quando o Rodoanel Norte for liberado, ligue `VER_PORTARIA_49_VIGENTE=1` na API: o § 5º passa a valer e os
incisos I–IV do § 4º deixam de valer (art. 2º da Portaria 49/2021). Antes disso, rotas pela Marginal Tietê recebem um aviso
`info` (`ver_portaria_49`). Acompanhar a obra e o DOC.

## Na rota (`ver.layer.ts`)

- **costLines:** para cada inciso vigente cuja janela vale para o veículo **no horário de saída**, as cadeias dirigidas do
  inciso viram `linear_cost_factors` com `factor: 1000` (só a via, no sentido proibido; travessias seguem livres).
  - *Pré-seleção:* o `services/routing.ts` compara cada linha penalizada com as rotas (custo ∝ nº de linhas × tamanho da rota),
    então mandar as ~300 cadeias ativas deixava a rota com 8–10 s. A camada calcula a rota com as mesmas exclusões (zonas e
    reportes, mesma regra do routing.ts), penaliza as cadeias proibidas que ela usa, recalcula e repete até não aparecer cadeia
    nova (máx. 6 voltas; se não convergir, manda também as vizinhas a 800 m). Resultado típico: 2 a 15 linhas.
  - *Edge walk:* uma linha que não casa com o grafo derruba a rota inteira (Valhalla erro 233). O importador testa e quebra as
    cadeias problemáticas; a API testa de novo todas as cadeias (1 requisição; busca binária se falhar) uma vez por versão dos
    tiles (`/status`) e deixa de fora as que falharem (log `[ver]`).
- **annotate:** detecta as VER que a rota percorre **no sentido da cadeia** (amostras a cada ~20 m, até 12 m e 50° da rota) e
  estima o horário de passagem pela posição na rota (fração da distância × duração). Avisos:
  - `ver_proibida` — `danger` quando a VER está proibida para o veículo no horário estimado (inclusive quando a saída é antes da
    janela e a chegada cai dentro dela); `warn` se a passagem fica a até 15 min da borda da janela. Agrupa incisos da mesma via
    (ex.: pistas da Marginal Tietê). Cita norma e, no § 1º, que VUC com AETC não é liberado; se origem/destino estão na própria
    VER, lembra da AETC de acesso (art. 19).
  - `ver_horario_limite` (`warn`) — liberada, mas a até 15 min do início/fim da restrição.
  - `ver_excecao` (`info`) — liberada por exceção (ex.: VUC com AETC, perecíveis): leve a AETC.
  - `ver_portaria_49` (`info`) — usa a Marginal Tietê enquanto o § 5º não vigora.
  - Resumo (`layers.ver.summary`): cada VER usada com "PROIBIDA às ~hh:mm" ou "liberada às ~hh:mm — motivo"; `data.usadas`.
  O `routing.ts` ainda emite o aviso genérico `uses_restricted_way` para cadeias penalizadas que a rota não conseguiu evitar.
- **features:** linhas (MultiLineString por inciso) a partir do zoom 10, só dos incisos vigentes, com `color` por parágrafo
  (§1 vermelho `#dc2626`, §2 laranja `#ea580c`, §3 âmbar `#d97706`, §4 roxo `#7c3aed`), horário, sentido, VUC, exceções, norma
  e vigência no popup. O front atual pinta a camada com `meta.style.color`; para colorir por parágrafo basta usar
  `['coalesce', ['get', 'color'], st.color]` no `line-color` do MapView (fora do escopo desta frente).

## Geometria: como cada inciso foi casado com o OSM

O importador lê as vias `highway=*` do município (osmium → OPL, cache em `data/cache/ver/`) e, para cada inciso, pega os ways com
o nome do OSM dentro de um retângulo e aplica um dos modos:

- **toda extensão** — todos os ways com o nome (com `clip`, só as arestas dentro do retângulo);
- **entre limites** (`segs`) — menor caminho, respeitando mão única, entre os nós em que a via cruza as transversais (regex de
  nome) ou um ponto fixo quando a transversal/praça não encosta na via no OSM; só no sentido indicado quando a portaria diz;
- **corredor** (`cor`) — eixo entre dois limites e todas as pistas paralelas a até N m, filtradas por sentido e por pista
  (local/central/expressa): Marginais, avenidas de pista dupla com "entre X e Y";
- `dir` — mantém só as cadeias no rumo do sentido proibido (pontes "sentido Norte-Sul").

Depois monta **cadeias dirigidas** (quebradas em bifurcação, junção ou retorno), testa no Valhalla e grava uma feição por inciso
(`source_id = p137-a2-s<§>-<inciso>`), com texto legal, norma, janelas, exceções, sentido, ways do OSM e % de conferência.
Túneis, viadutos e praças que dão continuidade à via entram quando têm nome próprio no eixo (definição de VER da CET).

Decisões por inciso (também no campo `nota` de cada feição):

- **§1 IV Francisco Morato:** a Pça. Jorge Lima não existe como via no OSM — limite no largo Eusébio Matoso × Vital Brasil.
- **§1 IX/X Santos Dumont e Tiradentes:** a R. dos Bandeirantes não aparece com esse nome no OSM; o limite é o encontro
  Tiradentes × Santos Dumont (Armênia). Incluí as pistas externas até a Ponte das Bandeiras, como no mapa da CET.
- **§1 XI Prestes Maia** inclui o Túnel São João Paulo II (Anhangabaú); **§1 XXI 23 de Maio** inclui o trecho que o OSM chama de
  "Parque Anhangabau".
- **§1 XII Passagem Tom Jobim** e **§4 XXIX Vd. Gazeta do Ipiranga:** não há via com esses nomes no OSM nem nos mapas da CET —
  **sem geometria** (a Tom Jobim fica, pela CET, no conjunto Prestes Maia/Tiradentes, que está na camada). Pendência: localizar em
  campo/GeoSampa e mapear.
- **§1 XV Ipiranga:** o trecho junto à praça se chama "Praça da República" no OSM (entra só o paralelo ao eixo).
- **§3 I Gronchi:** o trecho do estádio se chama "Praça Roberto Gomes Pedrosa" no OSM; a Av. Morumbi só encontra a Gronchi no
  extremo leste.
- **§3 VI** a portaria escreve "João Jorge Saad"; o logradouro é Av. Jorge João Saad. **§3 VII** "R." Eng. Oscar Americano é Avenida.
- **§4 I–IV Marginal Tietê:** corredor sobre todas as denominações (Marginal Tietê Expressa/Central/Local, Av. Pres. Castelo
  Branco, Condessa Elisabeth de Robiano, Embaixador Macedo Soares, Otaviano Alves de Lima, Morvan Dias de Figueiredo, Assis
  Chateaubriand), filtrado por sentido e pista. Limites por ponto: Ponte Aricanduva, Av. Raimundo Pereira de Magalhães, R. dos
  Botocudos, Cebolão. **§4 III** (sob a Ponte do Tatuapé, entre as alças da Salim): limites **aproximados**, ~500 m de cada lado.
- **§4 V Edgar Facó** (no OSM "Edgard"): a R. da Balsa não encosta na avenida; limite no ponto mais próximo (~100 m). O trecho
  restrito tem só ~80 m por sentido até a Ponte do Piqueri.
- **§4 XIX/XX Bresser:** no OSM o tabuleiro do viaduto se chama "Rua Bresser" (o way "Viaduto Bresser" é um trecho curto no
  sentido Brás, que não é o proibido).
- **§4 XXVII Complexo Emygdio de Barros Filho:** a alça excetuada (Av. Vila Ema/Salim sentido V. Prudente → Anhaia sentido
  Sapopemba) são os ways 782418953 e 39239337, identificados pela conectividade; as outras alças do complexo não têm nome no OSM.
  **Se o OSM mudar esses ids, revisar.**
- **§4 XXXV–XL (São Miguel / Marechal Tito / Beraldo Marcondes / Pça. Aleixo):** os mapas da CET não têm esses itens (conferência
  0%); casados só pelo texto. Laudelino Ferreira do Amaral e a Pça. Aleixo não encostam nas vias no OSM: limites por ponto.

### Conferência com os My Maps da CET

- Precisão: % da extensão casada a até 40 m de uma linha da CET (campo `conferencia_cet_pct`). Ver tabela abaixo.
- Cobertura (o inverso): as 68 linhas VER dos três mapas da CET ficam todas ≥ 88% cobertas pela camada (mínimo: Ermano
  Marchetti sentido oeste, 88%; mediana ~99%). Os KML da CET são parciais (faltam itens de 2018) e não têm licença, por isso só
  servem de conferência.

| Inciso | Via | km (cadeias dirigidas) | cadeias | CET % | modo |
|---|---|---|---|---|---|
| §1 I | Av. Paulista | 4.91 | 2 | 100.0 | corredor |
| §1 II | Av. Rebouças | 6.39 | 8 | 100.0 | corredor |
| §1 III | Av. Eusébio Matoso | 4.09 | 15 | 87.1 | toda extensão |
| §1 IV | Av. Prof. Francisco Morato | 10.88 | 2 | 99.2 | corredor |
| §1 V | Av. Nove de Julho | 12.79 | 17 | 100.0 | toda extensão |
| §1 VI | Av. Cidade Jardim | 2.61 | 6 | 100.0 | corredor |
| §1 VII | Av. São Gabriel | 1.5 | 2 | 98.8 | toda extensão |
| §1 VIII | Av. Santo Amaro | 13.53 | 15 | 98.0 | corredor |
| §1 IX | Av. Santos Dumont (Luz) | 3.37 | 14 | 91.3 | toda extensão |
| §1 X | Av. Tiradentes | 3.9 | 6 | 83.5 | toda extensão |
| §1 XI | Av. Prestes Maia | 4.14 | 14 | 100.0 | toda extensão |
| §1 XIII | Av. Rio Branco | 4.5 | 3 | 87.6 | toda extensão |
| §1 XIV | Av. Sen. Queirós | 1.2 | 2 | 100.0 | corredor |
| §1 XV | Av. Ipiranga | 1.44 | 2 | 100.0 | corredor |
| §1 XVI | Av. São Luís | 0.74 | 4 | 100.0 | toda extensão |
| §1 XVII | Vd. Nove de Julho | 0.57 | 2 | 100.0 | toda extensão |
| §1 XVIII | Vd. Jacareí | 0.39 | 2 | 100.0 | toda extensão |
| §1 XIX | R. Maria Paula | 0.59 | 2 | 100.0 | toda extensão |
| §1 XX | Vd. Dona Paulina | 0.27 | 3 | 78.6 | toda extensão |
| §1 XXI | Av. Vinte e Três de Maio | 12.82 | 12 | 100.0 | toda extensão |
| §1 XXII | Av. Rubem Berta | 5.85 | 4 | 100.0 | toda extensão |
| §1 XXIII | Av. Moreira Guimarães | 2.91 | 8 | 100.0 | corredor |
| §1 XXIV | Av. Alcântara Machado (Radial Leste) | 16.19 | 26 | 93.2 | toda extensão |
| §1 XXV | R. Melo Freire | 4.94 | 5 | 100.0 | toda extensão |
| §1 XXVI | Av. Conde de Frontin | 1.17 | 2 | 100.0 | corredor |
| §2 I | Marginal Pinheiros (Pte. Jaguaré–Pte. Morumbi) | 35.48 | 16 | 96.0 | corredor |
| §2 II | Av. dos Bandeirantes | 14.55 | 10 | 100.0 | toda extensão |
| §2 III | Av. Affonso D´Escragnolle Taunay | 4.49 | 4 | 89.0 | toda extensão |
| §2 IV | Av. Jornalista Roberto Marinho | 10.28 | 3 | 95.1 | toda extensão |
| §3 I | Av. Giovanni Gronchi | 13.82 | 27 | 100.0 | corredor |
| §3 II | Av. Morumbi | 11.82 | 20 | 100.0 | corredor |
| §3 III | R. Dr. Luiz Migliano | 4.62 | 15 | 100.0 | toda extensão |
| §3 IV | Av. Dr. Guilherme Dumont Vilares | 4.87 | 8 | 100.0 | corredor |
| §3 V | Av. Dep. Jacob Salvador Zveibil | 1.1 | 2 | 93.4 | toda extensão |
| §3 VI | Av. Jorge João Saad | 2.96 | 3 | 99.3 | toda extensão |
| §3 VII | Av. Eng. Oscar Americano | 2.88 | 9 | 100.0 | toda extensão |
| §3 VIII | Av. Padre Lebret | 1.7 | 2 | 100.0 | toda extensão |
| §3 IX | Av. Jules Rimet | 0.51 | 2 | 100.0 | corredor |
| §4 I | Marginal Tietê sentido Castelo (Pte. Aricanduva–Av. Raimundo P. Magalhães) | 49.38 | 29 | 99.7 | corredor |
| §4 II | Marginal Tietê sentido Ayrton Senna, local e central (R. Botocudos–Pte. Aricanduva) | 31.22 | 13 | 98.8 | corredor |
| §4 III | Marginal Tietê sentido Ayrton Senna sob a Ponte do Tatuapé | 1.45 | 4 | 100.0 | corredor |
| §4 IV | Marginal Tietê sentido Ayrton Senna, expressa (Cebolão–Pte. Aricanduva) | 20.9 | 4 | 100.0 | corredor |
| §4 V | Av. General Edgar Facó | 0.06 | 1 | 100.0 | entre limites |
| §4 VI | Av. Ermano Marchetti sentido Centro | 1.72 | 1 | 100.0 | entre limites |
| §4 VII | Av. Ermano Marchetti sentido Lapa | 1.4 | 2 | 100.0 | entre limites |
| §4 VIII | Av. Marquês de São Vicente | 6.45 | 4 | 94.3 | toda extensão |
| §4 IX | R. Norma Pieruccini Giannotti | 1.82 | 2 | 100.0 | toda extensão |
| §4 X | R. Sérgio Tomás | 1.52 | 4 | 100.0 | toda extensão |
| §4 XI | Av. Pres. Castello Branco (Sérgio Tomás–Av. do Estado) | 0.45 | 1 | 100.0 | corredor |
| §4 XII | Av. do Estado (Marginal–Anhaia Mello) | 22.42 | 13 | 100.0 | corredor |
| §4 XIII | Av. Anhaia Mello sentido Vila Formosa | 1.58 | 1 | 94.3 | corredor |
| §4 XIV | Av. Anhaia Mello sentido Ipiranga | 2.97 | 7 | 99.3 | corredor |
| §4 XV | Av. Pres. Tancredo Neves | 5.54 | 8 | 100.0 | toda extensão |
| §4 XVI | R. Malvina Ferrara Samarone | 0.9 | 2 | 77.8 | toda extensão |
| §4 XVII | R. das Juntas Provisórias sentido Cambuci | 1.06 | 1 | 100.0 | corredor |
| §4 XVIII | R. das Juntas Provisórias sentido Sacomã | 0.7 | 1 | 100.0 | corredor |
| §4 XIX | Vd. Bresser sentido Vila Prudente | 0.89 | 1 | 100.0 | entre limites |
| §4 XX | R. Bresser | 0.84 | 2 | 97.5 | entre limites |
| §4 XXI | R. Taquari | 0.36 | 2 | 100.0 | corredor |
| §4 XXII | Av. Paes de Barros | 7.66 | 2 | 100.0 | toda extensão |
| §4 XXIII | Av. Salim Farah Maluf | 20.55 | 29 | 100.0 | toda extensão |
| §4 XXIV | R. Ulisses Cruz | 0.32 | 1 | 100.0 | corredor |
| §4 XXV | Vd. Grande São Paulo | 1.62 | 4 | 90.8 | toda extensão |
| §4 XXVI | Vd. José Colassuono | 0.48 | 1 | 100.0 | toda extensão |
| §4 XXVII | Complexo Viário Sen. Antônio Emygdio de Barros Filho | 0.19 | 1 | 100.0 | toda extensão |
| §4 XXVIII | Vd. Pacheco e Chaves | 1.21 | 2 | 100.0 | toda extensão |
| §4 XXX | Complexo Viário Maria Maluf | 3.93 | 9 | 69.9 | toda extensão |
| §4 XXXI | Ponte do Piqueri | 0.49 | 2 | 100.0 | toda extensão |
| §4 XXXII | Av. Santos Dumont sentido Centro (Santana) | 0.24 | 1 | 100.0 | entre limites |
| §4 XXXIII | Ponte das Bandeiras sentido Centro | 0.24 | 1 | 100.0 | toda extensão |
| §4 XXXIV | Ponte do Tatuapé sentido Tatuapé | 0.87 | 1 | 34.3 | toda extensão |
| §4 XXXV | Av. São Miguel sentido bairro | 1.23 | 1 | 0.0 | entre limites |
| §4 XXXVI | Av. São Miguel sentido centro | 0.95 | 1 | 0.0 | entre limites |
| §4 XXXVII | Av. Marechal Tito sentido bairro | 1.64 | 1 | 0.0 | entre limites |
| §4 XXXVIII | Av. Marechal Tito sentido centro | 1.23 | 1 | 0.0 | entre limites |
| §4 XXXIX | R. Beraldo Marcondes sentido centro | 0.31 | 1 | 0.0 | entre limites |
| §4 XL | Pça. Pe. Aleixo Monteiro Mafra | 0.2 | 1 | 0.0 | toda extensão |
| §5 I | Marginal Tietê sentido Castelo Branco (Portaria 49/2021) | 63.59 | 41 | 81.0 | corredor |
| §5 II | Marginal Tietê sentido Ayrton Senna (Portaria 49/2021) | 60.47 | 20 | 93.5 | corredor |

"km" soma os dois sentidos (e todas as pistas nas marginais). Os 2 incisos sem geometria (§1 XII e §4 XXIX) não estão no seed.

## Como atualizar

1. **Regras** (portaria nova/alterada): editar `PARAGRAFOS`/`TRECHOS` no importador, citando norma e artigo; conferir no
   catálogo de legislação municipal (aba "Alterações" da Portaria 137/2018) e no DOC.
2. **Geometria** (OSM novo ou tiles reconstruídos): rodar o importador; ele reextrai o OPL quando o PBF é mais novo que o cache.
   ```sh
   docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
     -e DATA_DIR=/data -e SEED_DIR=/seed/layers -v $PWD/importers:/app -v $PWD/data:/data -v $PWD/db/seed:/seed \
     -v $PWD/data/valhalla:/pbf -e OSM_PBF=/pbf/sudeste-latest.osm.pbf -e VER_DEBUG=1 \
     --entrypoint sh truck-router-importer -c "apt-get update -qq && apt-get install -y -qq osmium-tool && python run.py ver_portaria137"
   ```
   Sem `osmium` funciona se o cache `data/cache/ver/sp_highways.opl` existir. `VER_DEBUG=1` imprime km, nº de cadeias, % CET e
   avisos de casamento por inciso; `VALHALLA_URL` (padrão `http://valhalla:8002`, `off` desliga) testa o edge walk.
3. Conferir: incisos com "sem geometria", "âncora não encontrada" ou CET muito abaixo do esperado; rodar
   `API_URL=http://localhost:<porta> npx vitest run test/layers/ver.test.ts`.
4. **Portaria 49/2021:** ao ser publicada a liberação do Rodoanel Norte, `VER_PORTARIA_49_VIGENTE=1` na API (sem reimportar).

## Limitações

- **Horário:** a penalidade usa o horário de **saída** (como as zonas do app). O aviso usa o horário estimado de passagem
  (proporcional à posição na rota, sem trânsito). Saída 20:50 pode evitar uma VER à toa; saída 04:40 de longe pode chegar dentro da
  janela — nesse caso só há aviso `danger`, a rota não é recalculada.
- **Geometria derivada do OSM:** nomes/ways mudam; o casamento depende de nomes exatos e limites aproximados em alguns incisos (ver
  decisões). Acessos e alças **sem nome** que levam à VER não são penalizados (a via principal é).
- **Placas em campo** (art. 2º, caput: vale o que está sinalizado com R-9 "VIA RESTRITA") podem diferir da portaria e do OSM.
- Exceções de serviço (estacionamento próprio, guincho, valores, postal...) não são modeladas; cadastro/vistoria da AETC e idade
  máxima do VUC (15 anos, art. 18 § 3º) também não são verificados — o perfil `has_aetc: true` é tomado como AETC válida para a VER.
- A pré-seleção replica zonas e reportes do `routing.ts`; exclusões/penalidades de **outras camadas** não entram nas rotas de
  referência — se alguma outra camada empurrar a rota para uma VER não selecionada, a rota pode usá-la (o `annotate` avisa).
- O aviso genérico `uses_restricted_way` do `routing.ts` é independente do sentido; em via de mão dupla com restrição só num
  sentido (ex.: São Miguel, Bresser) ele pode aparecer quando a rota usa o sentido liberado. O aviso `ver_proibida` desta camada
  considera o sentido.
- Os "avoided" saem por cadeia (uma via pode aparecer mais de uma vez na lista do front).
