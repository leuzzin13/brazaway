# IMPSC15: Goiânia GO, Brasília DF

Lote do Sul/Centro-Oeste na camada genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)).
Pesquisa e verificação de 2026-10-18 em `docs/research/cidades_sul_co/` (`res/` e `verif/`). Atos oficiais em domínio público (Lei 9.610/1998, art. 8º, IV);
geometria derivada do OSM (ODbL 1.0, cache do PBF, sem Overpass). Nenhum dos dois define VUC (`vuc: null`).

| ibge | Município | fonte_id | Ativas | Desativadas | Casos de rota | Teste |
|---|---|---|---|---|---|---|
| 5208707 | Goiânia/GO | `goiania` | 1 | 1 | 2 evita (com horário fora da janela) | passou |
| 5300108 | Brasília/DF | não importado | 0 | 0 | 0 | n/a |

## Goiânia/GO (5208707)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `goiania_zrt1_portaria224_2011` | ativa (confiança média) | Portaria 224/2011-AMT, arts. 1, 2, 7 (DOM 5.214, 21/10/2011); art. 3 com redação da Portaria 70/2013-SMT, art. 1º (DOM 5.697, 14/10/2013; vigência 12/04/2014); Anexo I com item 14 da Portaria 21/2015-SMT (DOM 6.045); Lei 9.028/2011, art. 1 | seg-sex 7h-19h, feriados suspendem | caminhão com PBT acima de 8,3 t **ou** comprimento acima de 8,0 m | zona aproximada (`5208707_zrt1.geojson`, manual sobre vias do OSM, 2,4 km²) | evita: carreta (oeste a leste, 6,66 km contra 5,29 km às 20h) e truck (norte a sul, 9,01 km contra 8,91 km às 20h) |
| `goiania_ctv_portaria70_2013_perimetro_urbano` | desativada (confiança média) | Portaria 70/2013-SMT, art. 2 (nova redação do art. 4 da Portaria 224/2011) | seg-sex 7h-9h, 11h-14h, 17h-19h | cegonha (CTV) acima de 14 m | nenhuma (registro) | nenhuma |

Motivo da desativada (verificação): o perfil de veículo não tem a classe cegonha/CTV; o alvo por comprimento e tipo bloquearia toda carreta no perímetro urbano, o que o ato não diz.

Exceções (só nos avisos): art. 7 da Portaria 224 (urgência, Correios, coleta de lixo etc. em período integral; concretagem, guindaste, mudança, perecíveis, remoção de terra das 8h às 16h), art. 6 (utilidade pública), art. 5 (autorização especial da Secretaria de Engenharia de Trânsito), Lei 9.028 art. 3 (ônibus e forças públicas). O Veículo Urbano de Carga até 7,0 t e 8,0 m já fica fora do alvo.

Geometria: o Anexo I lista só os logradouros limitadores e o Anexo II é um mapa raster sem coordenadas. O polígono foi montado sobre as vias-limite do OSM: Av. Independência (da Rua 74 à Rua 68), Rua 74/Av. Alfredo Nasser (oeste), Rua 68 (leste), Av. Paranaíba (arco oeste e trecho leste até a Anhanguera/Alameda Botafogo), Alameda Botafogo, Rua 10, Rua 94, Av. Assis Chateaubriand e Alameda dos Buritis (sul e oeste), mais o corredor de 60 m da Av. Universitária, Praça Universitária e Rua 261 (Setor Leste Universitário). Ampliado 25 m para o recuo de 20 m da camada manter as vias-limite dentro da zona. Sem rodovia federal ou estadual dentro (BR-153, BR-060 e GO-020 ficam fora); a Av. Anhanguera é via urbana e fica dentro. Rota de passagem norte a sul (truck, 9,01 km) sem volta absurda.

Pendências:
- Av. E (Jardim Goiás, item 14 da Portaria 21/2015) ficou fora do polígono: ponto isolado a ~3 km do corredor, sem como saber a área que acrescenta. Georreferenciar o Anexo II (mapa) e reajustar o polígono.
- Tabela da Portaria 70/2013 sem conectivo entre peso e comprimento: lida como OU (lado seguro). Confirmar com a Secretaria de Engenharia de Trânsito, e se vale em feriados (o ato é omisso; a Lei 9.028 exclui feriados).
- A verificação de 2026-10-18 registra em nota que o Anexo I "não foi localizado", mas a pesquisa leu o Anexo I no PDF oficial do DOM 5.214; prevaleceu o veredito `confirmado` da regra, com a regra ativa como no rascunho.
- Regra da cegonha volta a poder ser ativada se o perfil ganhar a classe CTV; geometria seria o perímetro urbano menos as rodovias.

## Brasília/DF (5300108): não importado aqui

Nenhuma regra de Brasília foi gravada em `data/raw/municipios/5300108.json`. As duas regras ativas pedidas já estão implementadas, com geometria do OSM e fonte `der-df`, na camada `rodovias_estaduais` (frente ders_estaduais, 18/10/2026; `data/raw/ders_estaduais/regras.json`, seed `db/seed/layers/rodovias_estaduais__der-df.sql`):

| Regra | Ato e artigo | Onde está |
|---|---|---|
| Eixão (DF-002), veículos pesados, 24 h, todos os dias | Decreto distrital 32.563/2010, art. 2 | `df_002_eixao_decreto32563_pesados` (camada `rodovias_estaduais`) |
| Barragem do Paranoá (DF-001/EPCT), caminhões com mais de dois eixos simples | Instrução DER-DF 3/2019, art. 1 | camada `rodovias_estaduais`, fonte `der-df` |

Motivos para não duplicar: (1) a pesquisa (`res/5300108.json` e `verif/5300108.json`) concluiu que são atos do DER-DF/GDF sobre rodovia distrital e que não restou regra municipal; (2) importar de novo na `restricoes_rmsp` aplicaria o mesmo custo duas vezes na rota e duplicaria avisos e itens evitados.

Jurisdição: o DF é ente distrital (sem municípios; Brasília, ibge 5300108, é a única unidade). O DER-DF e o GDF são a autoridade das rodovias DF-xxx, então a jurisdição dos atos é válida e eles ficam na camada de rodovias estaduais, que é a de DERs. Os demais registros da pesquisa (Ponte do Rio Melchior/DF-180, desativada; EPIA/BR-040 6h-9h, Instrução 148/2013, desativada; carga e descarga SCLS/SCLN, Instrução DETRAN-DF 98/2008, desativada, regula parada; DF-463, Decreto 46.287/2024, revogado) também são do DER-DF/DETRAN-DF; o Melchior e o Eixão do Lazer (Decreto 46.226/2024) já constam da camada de rodovias estaduais.

Importador: o validador aceita o IBGE 53xxxxx e a UF DF (`_municipios_schema.py`, prefixo `53`: `DF`); nenhum ajuste de código foi necessário. Se o coordenador preferir registrar mesmo assim os desativados/revogado como registro municipal, basta um `5300108.json` sem geometria (como a regra da cegonha de Goiânia).
