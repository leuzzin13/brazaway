# IMPSC02 — Sul: Curitiba, Joinville, Caxias do Sul, Paranaguá, Campo Mourão, Sarandi e Almirante Tamandaré

Lote da pesquisa profunda do Sul (`docs/research/cidades_sul_co/res|verif/<ibge>.json`, verificação de 2026-10-18) na camada
genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)). Um arquivo por município em
`data/raw/municipios/<ibge>.json`, geometria em `data/raw/municipios/geo/<ibge>_*.geojson`, seed
`db/seed/layers/restricoes_rmsp__<fonte_id>.sql`, casos de rota em `api/test/fixtures/mun_sul_co/<ibge>.json` (teste:
`api/test/layers/mun_sul_co.test.ts`).

| IBGE | Município | fonte_id | Ativas | Desativadas | Revogadas | Casos de rota |
|---|---|---|---|---|---|---|
| 4106902 | Curitiba/PR | `curitiba` | 2 | 2 | 1 | 2 evita |
| 4209102 | Joinville/SC | `joinville` | 1 | 0 | 0 | 1 evita |
| 4305108 | Caxias do Sul/RS | `caxias-do-sul` | 1 | 0 | 0 | 1 evita |
| 4118204 | Paranaguá/PR | `paranagua` | 1 | 3 | 0 | 0 (ver seção) |
| 4104303 | Campo Mourão/PR | `campo-mourao` | 1 | 1 | 1 | 1 evita |
| 4126256 | Sarandi/PR | `sarandi` | 1 | 0 | 0 | 1 evita |
| 4100400 | Almirante Tamandaré/PR | `almirante-tamandare` | 1 | 0 | 0 | 1 evita |

## Geometria (como foi feita, sem Overpass)

- O cache de vias com nome (`data/cache/municipios/osm_named_<ibge>.json`) foi gerado a partir do PBF `data/osm/sse_co.osm.pbf`
  com uma cópia do `curadoria/osm_pbf_cache_sudeste.py` que lê a malha do IBGE de cada município
  (`ibge_malha_<ibge>.geojson`) em vez da malha por UF (o script original só conhece as UFs do Sudeste). O script original não foi alterado.
- Polígonos de zona (Curitiba, Joinville, Caxias do Sul, Campo Mourão): perímetro do ato montado sobre os eixos das vias-limite do
  OSM (vértices nas esquinas das vias consecutivas e trechos pelo eixo de cada via). Derivados do OSM: **ODbL** (dito em
  `fonte.licenca`). Todos marcados `aproximado`.
- Paranaguá: limite administrativo "Ilha dos Valadares" do OSM (ODbL), ilha inteira.
- Linha Verde (Curitiba): pistas principais (`trunk`/`primary`/`motorway`) com `name=Linha Verde` das duas pistas, ~20,6 km por sentido
  (a Linha Verde tem ~22 km no município, igual ao trecho km 120,9–142,8 da portaria); marginais, ramais e vias locais do mesmo nome ficam de fora.
- Sarandi e Almirante Tamandaré: `construir: "trechos"` pelo nome do OSM; `pendencias` zeradas.
- Zonas de área urbana: não há rodovia com `ref` (BR/PR/SC/RS) dentro de nenhuma delas; rotas de passagem pela cidade (Curitiba, Joinville,
  Caxias do Sul, Campo Mourão) não mudam por causa da zona, exceto Caxias do Sul (norte–sul passando pelo centro: +2,3 km).

## 4106902 Curitiba/PR (`curitiba`)

VUC: sem definição local (Curitiba não define VUC nos atos lidos).

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `curitiba_zct_circulacao` | ativa (média) | Decreto 934/1997, arts. 2º, 8º, 10 e 11 | seg–sex 9h–19h; sáb 9h–13h30 (feriado livre, art. 10) | caminhão com capacidade acima de 7 t OU comprimento acima de 7 m | zona de 5,9 km² (perímetro do art. 2º no OSM, aproximado) | carreta, terça 10h, oeste→leste do centro: 0 km dentro, 8,6 km; às 20h atravessa (1,48 km dentro, 6,7 km) |
| `curitiba_zct_carga_descarga` | desativada | Decreto 934/1997, arts. 3º a 5º | — | — | mesmo polígono (registro) | — (regra de vaga, não de passagem) |
| `curitiba_br476_linha_verde` | ativa (média) | Portaria SMDT 11/2022, arts. 1º, 2º e 4º | seg–sex 7h–9h e 17h–19h | caminhão com PBT acima de 10 t | pistas principais da Linha Verde (132 linhas, 135 após o Valhalla) | carreta, terça 8h, norte→sul: 0,04 km nas pistas, 22,8 km; às 11h usa a Linha Verde (15,7 km nas pistas, 18,2 km) |
| `curitiba_br476_portaria_71_2016` | revogada | Portaria SETRAN 71/2016, revogada pelo art. 4º da Portaria SMDT 11/2022 (`vigencia_fim` 2022-02-18) | — | — | mesmas pistas (registro) | — |
| `curitiba_ztc_linha_verde_2012` | desativada (baixa) | Portaria SETRAN 16/2012, arts. 2º, 3º (II) e par. único | — | — | mesmas pistas (registro) | — |

Pendências e observações:

- Vigência da delegação da PRF (Acordo de Cooperação Técnica 1/2021, 12 meses) não confirmada como renovada; a portaria não tem prazo próprio.
- Não foi confirmado que o Decreto 934/1997 não foi alterado por portaria do IPPUC (art. 11); portal de legislação inacessível. Confiança média.
- O ato diz "acima de 7,0 toneladas e/ou comprimento acima de 7,0 metros" sem dizer se é capacidade ou PBT: usado `payload_t` (verificação confirmou).
- ZCT: o polígono liga em linha reta os cantos onde o ato contorna a Praça do Japão e o viaduto Capanema; o recuo de 20 m da camada deixa as vias-limite livres (o ato diz "no interior").
- Linha Verde: com carreta às 7h–9h/17h–19h a rota de longa distância norte–sul (do Xisto à Régis) faz volta grande (46 km contra 19 km) porque a Linha Verde é o corredor rápido; é o efeito esperado da regra, não erro de geometria.
- O OSM não restringe (`hgv`) a Linha Verde.

## 4209102 Joinville/SC (`joinville`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `joinville_area_central_5t` | ativa (média) | Decreto 10.251/2001, art. 6º (§§ 1º e 2º), art. 14; perímetro: art. 2º na redação do Decreto 12.512/2005 | seg–sex 7h–19h; sáb 7h–13h (domingo e feriado livres) | capacidade de carga acima de 5,0 t (`payload_t`) | zona de 1,05 km² (perímetro no OSM, aproximado) | carreta, terça 10h, oeste→leste: 0 km dentro, 6,86 km; às 20h atravessa (1,47 km dentro, 6,84 km) |

Pendências: vigência real e sinalização com o DETRANS Joinville (o ato cita a CONURB); cópia dos decretos no DOM/SC é de acervo; a Rua Marechal
Deodoro e a Rua Tijucas entraram no perímetro em 2005 mas não constam da lista de vias liberadas (§ 1º): pelo recuo de 20 m ficam livres, como
as demais vias-limite.

## 4305108 Caxias do Sul/RS (`caxias-do-sul`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `caxias_arc_centro` | ativa (média), vigência a partir de 2026-07-04 | Decreto 23.582/2025, arts. 2º (§§ 1º e 2º), 4º, 5º e 12 (nova redação do Decreto 23.905/2025: 395 dias) | 24 h, todos os dias (o ato não fixa horário) | caminhão com PBT acima de 10 t | zona de 0,9 km² (Os 18 do Forte, Coronel Flores, 20 de Setembro, Vereador Mário Pezzi; aproximado) | carreta, terça 10h, oeste→leste: 0 km dentro, 3,8 km; o VUC atravessa (1,57 km dentro, 3,4 km) |

Pendências: o mapa do Anexo I não foi lido; nenhum diário de Caxias em 2026 na base usada (janela cega para adiamentos); sinalização não
confirmada. Início da vigência = republicação (04/06/2025) + 395 dias (pela publicação original seria 25/05/2026).

## 4118204 Paranaguá/PR (`paranagua`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `paranagua_ilha_valadares_pesados` | ativa (média) | Decreto 5.562/2024, arts. 1º e 2º (alvo corrigido pela verificação para PBT) | 24 h, todos os dias (a única exceção é a entrega ao comércio local, § 1º) | caminhão com PBT acima de 6,0 t | zona da ilha inteira (limite do OSM) | ver abaixo |
| `paranagua_zru_lei_1913` | desativada (não verificável) | Lei 4.097/2021 (só o polígono) / Lei 1.913/1995 (texto não obtido) | — | — | sem geometria (registro) | — |
| `paranagua_lei_3039_residencial` | desativada (não verificável) | Lei 3.039/2009 (texto não obtido; 12 t PBT citado em considerando) | — | — | sem geometria (registro) | — |
| `paranagua_valadares_atilio_fontana_2880` | desativada | Decreto 2.880/2015, art. 1º §§ 1º e 4º (itinerário, sem horário) | — | — | sem geometria (registro) | — |

A ilha é um fundo de saco: nenhuma rota entre dois pontos fora dela passa por ela, então não há caso `evita`/`sem_alternativa` para a
fixture (o teste não tem caso para "destino na zona"). Conferido na API real: carreta com destino dentro da ilha (terça 10h) recebe
`rmsp_destino_na_zona` e entra na ilha (a zona não exclui origem/destino dentro dela); rota entre pontos do continente não é afetada.
Limitação: destino fora do polígono mas a ~130 m (na água) cujo ponto mais próximo da rede é uma via da ilha dá `NO_ROUTE` ("bloqueado por
Zona de tráfego de veículos pesados da Ilha dos Valadares"), porque a origem/destino só vale como "dentro" se estiver no polígono.

Pendências: textos das Leis 1.913/1995 e 3.039/2009 (portal Elotech e leismunicipais inacessíveis); sem regra municipal de acesso ao
porto (Pátio de Triagem é da APPA); decreto posterior alterando o 5.562/2024 não encontrado (busca limitada).

## 4104303 Campo Mourão/PR (`campo-mourao`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `campomourao_perimetro_zona_central` | ativa (alta) | Lei 5.019/2026, arts. 1º, 2º, 3º, 6º, 7º e 22; Decreto 12.775/2026, arts. 2º § 2º, 3º, 8º, 11 e 12 | 24 h, todos os dias (só a autorização especial tem horário) | veículo de carga com PBT acima de 16 t OU comprimento acima de 8 m OU largura acima de 2,50 m OU altura acima de 4,40 m | zona de 3,1 km² (Ruas Guarapuava e Santos Dumont, Avs. Jorge Walter e João Bento; aproximado) | carreta, terça 10h, oeste→leste: 0 km dentro, 9,0 km; o VUC atravessa (1,96 km dentro, 9,1 km) |
| `campomourao_zec_carga_descarga` | desativada | Decreto 12.775/2026, arts. 2º, 7º e 9º (vagas de carga e descarga) | — | — | sem geometria (registro) | — |
| `campomourao_lei_2882_revogada` | revogada (`vigencia_fim` 2026-04-28) | Lei 5.019/2026, art. 22 (revoga as Leis 2.882/2012 e 4.230/2021) | — | — | sem geometria (registro) | — |

Pendências: sinalização não confirmada (art. 20: só educativa por 30 dias após a sinalização definitiva); o DIRETRAN pode estender a proibição a
outras vias (art. 2º, par. único), não listadas. O ato diz que o perímetro é "delimitado pelas" quatro vias; no desenho o recuo de 20 m as deixa
livres (se o ato as incluir, a camada subestima a restrição nelas). Rotas de passagem (norte–sul e leste–oeste pelo entorno) não mudam.

## 4126256 Sarandi/PR (`sarandi`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `sarandi_decreto_307_pbt_22t` | ativa (alta) | Decreto 307/2021, arts. 1º (I–VIII), 2º e 3º; AET: Portaria SEMUTRANS 2.618/2023 | 24 h, todos os dias | caminhão com PBT acima de 22 t | 8 vias (63 linhas, 45 após o Valhalla), `trechos` | carreta, terça 10h, sul→norte: 0,02 km nas vias (só cruzamentos), 2,7 km; o toco passa pelas vias (2,49 km) |

Nomes no OSM: inciso I "Rua José Galindo" = "Rua José Galindo Garcia" (não há "Rua José Galindo"); inciso III "Rua Ângelo Perini" =
"Avenida Ângelo Perine" (grafia do OSM, marcado `aproximado`); inciso VII (Rua Francisco de Almeida entre a Av. Maringá e a Rua José Galindo
Garcia): 625 m. Pendência: alteração/revogação posterior a 2023 não verificada.

## 4100400 Almirante Tamandaré/PR (`almirante-tamandare`)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rota testada |
|---|---|---|---|---|---|---|
| `almirantetamandare_av_emilio_johnson_10t` | ativa (média) | Decreto 968/2015 republicado em 13/03/2015, art. 1º e par. único | 24 h, todos os dias (a exceção de carga/descarga 19h–8h não é modelável como janela) | caminhão com capacidade de carga acima de 10 t (`payload_t`) | Av. Emílio Johnson inteira no OSM (13 linhas, 9 após o Valhalla; aproximado, o ato não delimita o trecho) | carreta, terça 10h, de uma ponta à outra: 0 km na avenida, 1,31 km; o VUC a percorre (0,92 km, 1,04 km) |

Pendências: limites do trecho da avenida e sinalização; o Valhalla descartou um trecho/sentido que não casou com o grafo (o restante cobre a
avenida nos dois sentidos).

## Divergências e observações para quem cuida do importador/API

- `osm_pbf_cache_sudeste.py` só tem as UFs do Sudeste (`UF = {'31'...}`) e baixa a malha por UF; foi preciso uma cópia local (fora do repositório) para o Sul.
- Regra desativada/revogada com geometria vazia (`{"geojson": {"type": "FeatureCollection", "features": []}}`) não vira linha no banco; por isso
  fora de `regras` da fixture (Campo Mourão ZEC e Lei 2.882, Paranaguá ZRU, Lei 3.039 e Dec. 2.880).
- O teste `mun_sul_co.test.ts` não tem caso para "destino dentro da zona" (Paranaguá); ficou documentado acima.
