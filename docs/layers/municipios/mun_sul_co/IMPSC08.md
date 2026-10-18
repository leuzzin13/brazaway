# IMPSC08 — Telêmaco Borba (PR) e Gaspar (SC)

Verificação dos atos em 2026-10-18 (`docs/research/cidades_sul_co/verif/`). Geometria do OSM (ODbL 1.0) obtida do PBF Sudeste+Sul+CO (`osm_pbf_cache_regioes.py`), sem Overpass.

## 4127106 Telêmaco Borba/PR (`telemaco-borba`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota |
|---|---|---|---|---|---|---|
| `telemacoborba_area_central_lc137_2023` | ativa (média) | LC 137/2023, arts. 2º, 6º e 7º | seg-sex 9h-19h, sáb 9h-13h30; feriados suspendem | caminhão com capacidade de carga > 7 t e/ou comprimento > 7 m | zona manual `geo/4127106_area_central.geojson`, aproximada, sobre as vias-limite do art. 2º no OSM | 1 `evita` (carreta, 10h x 20h) |
| `telemacoborba_lei_1623_2007` | revogada | Lei 1.623/2007, art. 1º; revogada pelo art. 9º da LC 137/2023 | n/a | carretas, romeu e julieta e trucados carregados | vazia (registro histórico) | n/a |

Rota real: carreta de (-24.3300, -50.6330) a (-24.3270, -50.6120), terça 10h: contorna a zona (0 km dentro, 3,25 km); às 20h a atravessa (0,38 km dentro, 3,07 km). Sábado 14h (após 13h30) o caminhão (truck) também atravessa; sábado 10h contorna. Travessia norte-sul pela PR-160 (18 km) não sofre desvio: a rodovia fica fora do polígono.

Pendências e observações:
- O art. 6º não diz se as 7 t são PBT ou capacidade de carga; modelado como `payload_t` (lado seguro da camada). Na prática o limite de 7 m domina.
- Decretos do Executivo e ajustes do Conselho de Mobilidade (art. 8º) não verificáveis (Atende.net com captcha).
- Janela de carga e descarga por porte (art. 3º) não modelada. Exceção do art. 5º (autorização DMSPT/TBTran) só em aviso.
- Perímetro aproximado: o ato nomeia as ruas, mas o polígono foi montado por vértices nas esquinas; a Av. Euclides Bonifácio Londres a leste do cruzamento com a Av. Chanceler Horácio Lafer fica fora (o ato a cita só até esse ponto).
- VUC: não definido no ato (tratado como caminhão).

## 4205902 Gaspar/SC (`gaspar`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Casos de rota |
|---|---|---|---|---|---|---|
| `gaspar_dec7588_2017_ponte_hercilio_deeke` | ativa (média) | Decreto 7.588/2017, art. 1º (altera o art. 1º do Decreto 5.699/2013) | 24 h, todos os dias; feriados aplicam | caminhão com PBT > 10 t; exceções: transporte coletivo municipal e Bombeiros em emergência | linha manual `geo/4205902_ponte_hercilio_deeke.geojson` = way 112322733 do OSM | nenhum (ver abaixo) |

Divergência com o OSM: a way 112322733 ("Ponte Hercílio Decke", grafia do OSM) já tem `hgv=no` e `maxweight=10`. O `maxweight` bate com o decreto, mas `hgv=no` é mais restritivo (o decreto permite caminhões até 10 t de PBT). O roteador evita a ponte sozinho para qualquer caminhão, inclusive VUC e toco abaixo de 10 t: rota de teste de (-26.9250, -48.9590) a (-26.9320, -48.9570) dá 17 km de desvio para carreta, truck e vuc, sem `avoided` da camada. Por isso não há caso `evita` (não provaria a camada) nem `sem_alternativa` (existe alternativa). A fixture tem `casos: []`.

Pendências:
- Sem ato posterior ao Decreto 7.588/2017 localizado; portal da prefeitura bloqueado.
- Ruas Coronel Aristiliano Ramos (`hgv=no`, `maxweight=4`) e Barão do Rio Branco (`hgv=no`/`maxweight=25`) têm restrição no OSM sem ato localizado: não modeladas.
- VUC: não definido no decreto.
