# IMP16 — Macaubal e Taguaí (SP)

Regras achadas na rodada 7 da pesquisa (varredura das Câmaras e portais de legislação de SP/RJ/ES) e confirmadas por
verificador independente (`docs/research/cidades_sudeste/verif/`).

## Macaubal (3528106)

| regra | status | ato | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `macaubal_rua_carmo_buissa` | ativa (média) | Decreto 45/2014, arts. 1º e 2º (revoga o Dec. 40/2014) | 24 h, todos os dias | caminhões e carretas (`caminhao: true`) | Rua Carmo Buissa entre a R. Laurindo Guimarães e a Av. Nazira Husni Chamas (`construir: trechos`, ways 195994425 e 1184298863, 1,12 km) | carreta e toco evitam (2,00 km, 0 km na rua); utilitário usa 1,14 km |

As 11 exceções do art. 2º estão em `excecoes` (inclusive carga e descarga, sem limitação a destino local, por isso sem
`excecao_destino_local`). Pendência: o verificador só conferiu a ficha do ato (sem revogação visível); sinalização não
confirmada.

## Taguaí (3553005)

| regra | status | ato | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| `taguai_vicinal_clovis_fonseca_30t` | ativa (média, aproximada) | Lei 1.282/2025, arts. 1º–3º; extremos pela Lei 753/2002 (TGI-010, de Taguaí à divisa com Tejupá) | 24 h, todos os dias | `pbt_t` > 30 | manual, 7,0 km: way 207732644 (secondary, asfalto, sem nome nem ref no OSM) da saída urbana de Taguaí até o limite municipal com Tejupá, cortada na malha do IBGE | carreta (41,5 t) e bitrem desviam (43,25 km, aviso `large_detour`); truck e toco (< 30 t) usam 7,02 km da via (23,03 km) |

Pendências:
- A estrada não tem `ref` TGI-010 nem o nome do ato no OSM. Foi identificada como a única ligação pavimentada
  (secondary) entre as sedes de Taguaí e Tejupá pela rota do Valhalla, sem alternativa em `alternates`; é a mesma cadeia
  apontada pelo verificador. Confirmar no local (placa do art. 3º).
- O script `geo/3553005_vicinal_curadoria.py` lê `data/cache/municipios/taguai_tejupa_rota_valhalla.json` (cache fora do
  git); o docstring explica como regenerar. O `.geojson` curado está versionado.
- Data da lei: 12/11/2025 no PDF, 03/12/2025 no cadastro do SAPL; usada a do PDF.

## Fica para depois

Planalto (3539608, Decreto 14/2017) também foi confirmado pelo verificador, mas a regra é "corredor permitido" (proíbe
veículos acima de 1.500 kg nas demais vias da área urbana, que o ato não delimita): exige polígono da área urbana curado
à mão. Não implementado nesta rodada.
