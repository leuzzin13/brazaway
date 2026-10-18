# IMPSC11: Correia Pinto SC, Sinop MT

Lote do Sul/Centro-Oeste na camada genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)).
Pesquisa e verificação de 2026-10-18 em `docs/research/cidades_sul_co/` (`res/` e `verif/`). Geometria pelos nomes do OSM (cache do PBF, sem Overpass);
ODbL 1.0 para a geometria, domínio público (Lei 9.610/1998, art. 8º, IV) para os atos. Nenhum município define VUC (`vuc: null`). Janelas 24 h, `feriados: aplica`.

| ibge | Município | fonte_id | Ativas | Desativadas | Casos de rota | Teste |
|---|---|---|---|---|---|---|
| 4204558 | Correia Pinto/SC | `correia-pinto` | 1 | 0 | 2 evita | passou |
| 5107909 | Sinop/MT | `sinop` | 0 | 2 | 0 (sem fixture: regras sem geometria) | n/a |

## Correia Pinto/SC (4204558)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `correiapinto_lei1361_2005_av_tancredo_neves` | ativa (confiança média) | Lei 1361, de 15/12/2005, art. 1º, caput e §§1º e 2º; art. 2º (sinalização). [Câmara](https://www.camaracorreiapinto.sc.gov.br/proposicoes/pesquisa/0/1/0/3697) | 24 h, todos os dias | todo caminhão ("grande porte" sem peso na lei, convenção dos lotes anteriores: tratado como caminhão) | Av. Presidente Tancredo Neves entre a Rua Dona Ema Sevei de Oliveira e a Rua Presidente Kennedy (nomes do OSM), 3 linhas | evita: carreta (sudeste a noroeste) e truck (ponta a ponta), ambos por via paralela, 0,03 km de travessia |

Exceções (só nos avisos): ônibus; carga e descarga 7h00-10h30 e 16h30-19h30 (§1º, não modelada: a regra vale 24 h); casos autorizados pela SEPLAN (§2º).

Pendências: sinalização (art. 2º) e vigência fática não confirmadas; texto lido por OCR. Sem janela fora da regra, então não há caso "fora".

## Sinop/MT (5107909)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `sinop_av_nelson_moggi_8t` | desativada (sem geometria confiável) | Lei 2.243, de 11/12/2015, art. 1º e §1º; Lei 2.111/2015 (memorial). [AMM-MT](https://amm.diariomunicipal.org/publicacao/99406/) | 24 h | caminhão com PBT acima de 8 t | nenhuma | nenhuma |
| `sinop_prolong_av_figueiras_8t` | desativada (sem geometria confiável) | Lei 2.241, de 11/12/2015, art. 1º e §1º. [AMM-MT](https://amm.diariomunicipal.org/publicacao/99403/) | 24 h | caminhão com PBT acima de 8 t | nenhuma | nenhuma |

Motivos:
- Av. Nelson Moggi: nenhuma via do OSM tem esse nome (nem em outras tags); a Lei 2.111/2015 traz só memorial por azimutes, a partir da "Estrada Ruth", para 23,18 km.
- Prolongamento da Av. das Figueiras: os limites estão na Lei 2.042/2014, que não está no AMM-MT (busca por número, tema e "Figueiras" em 18/10/2026; só a Lei 2.260/2015, que a altera sem dar limites, e a Lei 2.341/2016, área desafetada de 15.215 m² junto à Rua dos Jaborandis). A Av. das Figueiras tem dezenas de ways no OSM, e a avenida inteira passaria do ato; por isso desativada.

Pendências:
- Obter a Lei 2.042/2014 (limites do prolongamento) e localizar a Av. Nelson Moggi (Prefeitura/campo) para ativar as duas regras (`construir: "trechos"` ou linha manual).
- "Peso ou carga acima de 8 t" ambíguo; lido como PBT. Vigência após 2017 não verificada (AMM-MT cobre Sinop só até 2017); sinalização não verificada.
