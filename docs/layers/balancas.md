# Camada `balancas` — postos de pesagem no sentido da rota

Arquivos: `api/src/layers/balancas.layer.ts`, `importers/sources/weigh_antt_ppv.py`, `weigh_artesp.py`,
`weigh_dersp.py`, `weigh_dermg.py` (DER-MG, ver [pedagio_estaduais.md](pedagio_estaduais.md)), testes em
`api/test/layers/balancas.test.ts` e `balancas_dermg.test.ts`.

A camada **só informa** as balanças que ficam no sentido da rota. **Nunca sugere desvio de balança**: não tem
`exclusions`/`costLines`, não calcula rota alternativa e os textos não falam em evitar o posto. Deixar de entrar na
área de pesagem é infração grave (CTB art. 209, redação da Lei 14.157/2021: "Transpor, sem autorização, bloqueio viário
com ou sem sinalização ou dispositivos auxiliares, ou deixar de adentrar as áreas destinadas à pesagem de veículos:
Infração - grave; Penalidade - multa"; conferido em planalto.gov.br em 09/10/2026). O resumo da rota repete isso.

## Fontes e licenças

| Fonte | O que traz | Licença | Registros (09/10/2026) |
|---|---|---|---|
| ANTT CKAN `ppv` | PPV das concessões federais: lat/lon, rodovia, km, sentido (crescente/decrescente), tipo (Fixo, Móvel, HS-WIM) | CC-BY | 45 ativos (37 fixos, 7 HS-WIM, 1 móvel); SP: Itapecerica da Serra, Miracatu, Guararema, Queluz |
| ANTT CKAN `posto-pesagem-veicular` | operação diária (tempo funcionando x parado) | CC-BY | último mês com dados: fev/2026 (mar e abr/2026 vêm vazios); casado com 30 PPV |
| ARTESP CKAN `malha-rodoviaria` (KMZ por lote), pasta "Sistema de Pesagem" | PGF (posto geral de fiscalização, fixo) e PPM (ponto de pesagem móvel) com posição exata | CC-BY | 51 PGF + 75 PPM |
| DER-SP "Pontos para pesagem de veículos" (tabela HTML) | rodovia, km+m, sentido, trecho, administrador (DR ou concessionária), FIXO/MÓVEL. **Sem coordenadas** | sem licença aberta; rodapé do portal cms.sp.gov.br: "todos os direitos reservados" | 136 pontos |
| DER-SP ArcGIS `Balancas_DER_DBO` | balanças da malha DER com lat/lon, rodovia, km, trecho | idem | 87 pontos (62 casados com a tabela; 25 só na camada) |
| DER-SP ArcGIS `pontos_1km_rodovias` | marcos de km das rodovias de SP | idem | usado para posicionar 74 pontos da tabela sem par |
| DER-MG "Praças de pesagem" (tabela do site) + Observatório da Infraestrutura `00_PUBLICACOES/pracas_pesagem` + SRE-MG 2026_02 (fonte `der-mg`, 10/10/2026) | 43 postos em operação (URG, rodovia, km, município, operação 24 h ou estratégica); coordenada da camada pública (40) ou rodovia+km no SRE (2); **sem lado da pista** (`precisao: 'aprox'`, sentido "não confirmado") | site: reutilização com fonte e crédito; camadas sem licença declarada (a `Balancas_V2` é de "uso restrito DER-MG" e não é usada) | 42 postos (MGC-354 km 94,5 sem posição); detalhes em [pedagio_estaduais.md](pedagio_estaduais.md) |

Licença DER-SP/ARTESP (portal): não há licença aberta declarada e o rodapé diz "todos os direitos reservados".
**Antes de uso comercial, pedir autorização ao DER-SP ou parecer jurídico.** ANTT e o KMZ ARTESP são CC-BY
(atribuição em `meta.sources` e `GET /api/sources`). Nada vai para o OSM.

**DER-SP só com rodovia + km:** a posição é interpolada entre os centros de km consecutivos do mesmo subtrecho
(camada `pontos_1km_rodovias`), com erro de algumas centenas de metros (`props.precisao = 'aprox_km'`,
`erro_km_estimado`). Antes disso, cada linha da tabela é casada com a camada `Balancas_DER_DBO` (mesma rodovia, km a até
0,6 km; desempate pelo trecho origem/destino), o que dá posição exata para 62 dos 136.

Não usados: OSM `amenity=weighbridge` (59 nós no Sudeste, quase sem atributos e com balanças privadas) e postos do DNIT
fora das concessões (não há lista aberta com coordenadas: as páginas do PNP/DNIT só trazem texto e o GeoServer
DNITGeo não tem camada de pesagem).

## Balanças estaduais do Sul e do Centro-Oeste (pesquisa de 18/10/2026): nenhuma fonte confiável

Pesquisa: `docs/research/estados_sul_co/<UF>.json`, tema `balancas`. **Nada foi importado nem inventado**: nenhum órgão estadual de
PR, SC, RS, GO, MT, MS ou DF publica lista de postos de pesagem com coordenada (ou rodovia + km no SRE) e sentido, então não
há `weigh_*` novo. As balanças federais concedidas dessas UFs já entram pela ANTT (`weigh_antt_ppv`: PR 6, SC 3, RS 6, GO 4, MT 1,
MS 3 e DF 0 em 08/2026; o PPV 01 e 02 da Ecovias Minas Goiás ficam na BR-050 em Ipameri-GO).

| UF | Órgão | O que existe | Por que não entra |
|---|---|---|---|
| PR | DER/PR | Duas balanças na PR-412 em Guaratuba (km 8+000) e Matinhos, confirmadas pela AEN em 02/06/2026; em 2023, cinco estáticas deslocáveis no Oeste (PRC-467, PR-180, PRC-280, PR-317, PR-488) e duas na PR-151 em Piraí do Sul | Sem coordenada, sem sentido e, nas deslocáveis, sem km; o km 8+000 fica antes do trecho urbano de Guaratuba (o SRE 412S0018 começa no km 12,4) e a posição exata não foi confirmada. A lista oficial depende de LAI. Os 60 postos fiscais agropecuários do geoserver (SEAB/ADAPAR) não são balanças |
| SC | SIE/PMRv | Nada: o GeoSIE traz 25 postos da PMRv (endereço textual) sem campo de pesagem | Sem balança estadual publicada |
| RS | DAER/EGR/CRBM | Nada: a busca do DAER por "balança" só devolve páginas gerais; o WFS do mapa do DAER não abre (cadeia TLS incompleta); concessionárias migrando para HS-WIM sem lista de locais | Sem dado |
| GO | GOINFRA | A página "Controle de Pesagem de Cargas" descreve atribuições (balanças fixas e móveis) e não nomeia nenhum posto; o relatório de equipamentos (711 equipamentos) é só de velocidade | Sem posto, sem km |
| MT | SINFRA/concessões | O PER da concessão MT-130 (Morro da Mesa) prevê duas balanças fixas nos km 10+700 e 107+600 do esquema linear da concessão; o OSM tem balanças na BR-163 km 109 (federais) e uma privada | O km do PER é da concessão, não do SRE, sem coordenada nem sentido; as da BR-163 já estão na ANTT |
| MS | AGESUL/PMMS | Nada em operação: a Way-306 prevê 4 postos móveis (adiados para o ano 10 do contrato) e a Rota da Celulose 8 postos HS-WIM | Nenhum instalado |
| DF | DER-DF/PMDF | Competência de fiscalizar excesso de peso (Decreto 48.239/2026); sem lista | Sem dado; o recorte do OSM do DF não tem `amenity=weighbridge` |

Quando um órgão publicar a lista (ou responder à LAI), seguir o padrão do `weigh_dermg.py`: rodovia + km casados no SRE ou
coordenada da fonte, `precisao: 'aprox'` e sentido "não confirmado" quando a fonte não trouxer o lado da pista.

## Sentido da rota

Para cada ponto a até 300 m da rota (pontos com posição aproximada só até 120 m), `directionVerdict()`:

1. **Posição exata a ≥ 12 m da linha: decide o lado da via.** No Brasil o posto fica à direita de quem ele
   fiscaliza. Conferido com os PPV da ANTT: Itapecerica (BR-116 km 296,3, crescente = sentido Curitiba) fica à direita
   indo para o PR; Guararema (km 179,4, crescente = sentido São Paulo, a quilometragem da Dutra em SP cresce de Queluz
   para a capital) fica à direita indo para SP. Se o rótulo da fonte discordar do lado, **o rótulo é ignorado** (fica
   anotado em `como`). `crescente/decrescente` (ANTT) só é resolvido assim.
2. Sem lado (posição aproximada, ou ponto a menos de 12 m da linha, que pode estar no próprio eixo): o rótulo
   `norte/sul/leste/oeste` (ARTESP/DER-SP) é comparado com o **rumo geral da rota**, a corda da rota entre 4 km antes e
   4 km depois do ponto (cosseno ≥ 0,35 = mesmo sentido). Não se usa o rumo local: o rótulo é o sentido NOMINAL da
   rodovia e pode não bater com a direção da pista naquele trecho. Ex.: SP-332 km 44,5 (DER-SP tem dois postos,
   "norte" e "sul", a 34 m um do outro): ali a via corre a 229° (sudoeste) no sentido norte; com o rumo local a balança
   "norte" era omitida indo para Jundiaí.
3. **Rótulo sozinho nunca omite.** Rótulo a favor = `provavel`; rótulo contra = `incerto` (listada como "sentido não
   confirmado"). Sem lado nem rótulo, `incerto`.
4. `crescente+decrescente` = atende os dois sentidos (`sim`).

Só a regra 1 omite balança (outro sentido). As omitidas são contadas em `data.sentido_oposto_omitidas` e listadas em
`data.omitidas_outro_sentido` (id, nome, km na rota, fontes, regra).

**Mesma balança em várias fontes** (ex.: PGF da ARTESP com posição exata + a mesma balança na tabela do DER-SP, por
rodovia/km): as entradas são juntadas **antes** de filtrar o sentido, e o grupo fica com a posição, o nome e o veredito
da fonte de melhor posição (exata > aproximada; ANTT > ARTESP > DER-SP). Se essa fonte não decide o sentido, vale o
veredito de outra fonte do mesmo posto, com a fonte citada em `como`. Assim, a cópia aproximada (DER-SP) de um posto que
o lado da via mostrou ser do outro sentido sai junto com ele; antes ela sobrava como "sentido não confirmado" (ex.:
Anhanguera km 132 e Castello km 74 no sentido contrário). Critério de "mesmo posto": rótulos de sentido compatíveis
(nunca junta "norte" com "sul"); nunca duas posições exatas que o lado da via põe em pistas opostas; e perto — mesma
rodovia com km da fonte a até 0,5 km (e até 3 km ao longo da rota, porque a posição aproximada pode cair 1–2 km ao
lado: Castello, DER-SP km 95,2 x ARTESP km 95) ou até 1 km ao longo da rota; rodovias diferentes, até 400 m.

## Saída na rota (`layers.balancas`)

- `summary`: quantas no sentido da rota (fixas, PPM, HS-WIM) e, à parte, quantas com sentido não confirmado; uma
  linha por balança com o km da rota (as não confirmadas marcadas) e a nota do CTB.
- `warnings`: `weigh_station` (`info`) para balança fixa ou HS-WIM no sentido da rota (até 5), com lat/lon.
  "Entre se estiver sinalizada aberta (CTB art. 209)". Pontos móveis só aparecem no resumo (operação eventual).
- `data.balancas[]`: id, nome, tipo, km na rota, rodovia, km, sentido da fonte, `no_sentido` (`sim`/`provavel`/
  `incerto`), `como` (qual regra decidiu), `distancia_m` e `lado` (direita/esquerda de quem segue a rota),
  administrador, precisão, fontes, disponibilidade (ANTT).
- `data.sentido_oposto_omitidas` e `data.omitidas_outro_sentido[]`.

Exemplos (09/10/2026): Lapa → Jundiaí pela Bandeirantes lista o PGF SP-348 km 40 (sentido norte, AutoBAn, 27,9 m à
direita); na volta ele some e aparece o PGF SP-330 km 53 (sentido sul). SP → Juquitiba pela Régis lista o PPV de
Itapecerica da Serra; na volta, não. SP-332 km 44,5: indo para Jundiaí lista a balança "norte" (rótulo x corda de
4 km); indo para São Paulo lista a "sul" (13,4 m à direita) e não junta as duas.

## Como atualizar

```sh
docker compose --profile import run --rm importer weigh_antt_ppv weigh_artesp weigh_dersp
```

Seeds em `db/seed/layers/balancas__*.sql` (≈ 0,2 MB). A disponibilidade ANTT usa o último mês publicado com dados.

## Limitações

- Rodovias federais não concedidas (DNIT) e municipais: sem dados.
- KMZ ARTESP: atributos não padronizados entre lotes; 47 pontos sem sentido no rótulo (decididos pelo lado da via
  quando possível). No lote 11 os PGF vêm com nome "PPM …" (inconsistência da fonte; o tipo vem da pasta do KMZ).
- DER-SP: 74 posições aproximadas por rodovia+km; a tabela não tem data de atualização.
- PPM/pontos móveis indicam onde a fiscalização móvel pode operar, não que ela esteja lá.
- Posição aproximada (DER-SP por rodovia+km) com rótulo contra o rumo da rota fica como "sentido não confirmado" em vez
  de omitida (regra 3): em rodovia que corre na direção do rótulo (ex.: Castello, leste/oeste) é quase sempre a pista
  oposta, mas o rótulo é nominal e não há lado para confirmar. Quando a mesma balança existe com posição exata em outra
  fonte, o grupo segue o lado da via (ver acima).
- A camada não estima excesso de peso nem tolerâncias (Lei 7.408/1985 e CONTRAN): isso é de outra frente.
