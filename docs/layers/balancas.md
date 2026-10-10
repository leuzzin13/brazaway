# Camada `balancas` — postos de pesagem no sentido da rota

Arquivos: `api/src/layers/balancas.layer.ts`, `importers/sources/weigh_antt_ppv.py`, `weigh_artesp.py`,
`weigh_dersp.py`, testes em `api/test/layers/balancas.test.ts`.

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

## Sentido da rota

Para cada ponto a até 300 m da rota (pontos com posição aproximada só até 120 m):

1. Rótulo `norte/sul/leste/oeste` (ARTESP/DER-SP) comparado com o rumo da rota no ponto: cosseno ≥ 0,35 = mesmo
   sentido; ≤ −0,35 = oposto. É o sentido nominal da rodovia (ex.: Anhanguera "norte" = capital→interior, rumo NO).
2. Posição exata e a ≥ 12 m da linha: **lado da via**. No Brasil o posto fica à direita de quem ele fiscaliza.
   Conferido com os PPV da ANTT: Itapecerica (BR-116 km 296,3, crescente = sentido Curitiba) fica à direita indo para o
   PR; Guararema (km 179,4, crescente = sentido São Paulo, a quilometragem da Dutra em SP cresce de Queluz para a
   capital) fica à direita indo para SP. `crescente/decrescente` (ANTT) é resolvido só pelo lado.
3. `crescente+decrescente` = atende os dois sentidos.
4. Rótulo e lado discordam, ou nenhum dos dois decide: **"sentido não confirmado"** (a balança é listada assim).
   As do sentido oposto são omitidas (contadas em `data.sentido_oposto_omitidas`).

A mesma balança vinda de mais de uma fonte é juntada (mesma rodovia até 1 km ao longo da rota, senão 400 m), ficando
com a posição exata e a fonte mais confiável (ANTT > ARTESP > DER-SP).

## Saída na rota (`layers.balancas`)

- `summary`: quantas no sentido da rota (fixas, PPM, HS-WIM), uma linha por balança com o km da rota e a nota do CTB.
- `warnings`: `weigh_station` (`info`) para balança fixa ou HS-WIM no sentido da rota (até 5), com lat/lon.
  "Entre se estiver sinalizada aberta (CTB art. 209)". Pontos móveis só aparecem no resumo (operação eventual).
- `data.balancas[]`: id, nome, tipo, km na rota, rodovia, km, sentido da fonte, `no_sentido` (`sim`/`provavel`/
  `incerto`), `como` (qual regra decidiu), administrador, precisão, fontes, disponibilidade (ANTT).

Exemplo (09/10/2026): Lapa → Jundiaí pela Bandeirantes lista o PGF SP-348 km 40 (sentido norte, AutoBAn); na volta ele
some e aparece o PGF SP-330 km 53 (sentido sul). SP → Juquitiba pela Régis lista o PPV de Itapecerica da Serra; na
volta, não.

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
- A camada não estima excesso de peso nem tolerâncias (Lei 7.408/1985 e CONTRAN): isso é de outra frente.
