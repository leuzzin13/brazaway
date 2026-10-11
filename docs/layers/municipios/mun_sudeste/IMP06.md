# mun_sudeste — lote IMP06

Onze municípios (2 do RJ, 9 de SP) da pesquisa cidade por cidade (`docs/research/cidades_sudeste/res/` e `verif/`), na
camada genérica `restricoes_rmsp` (`data/raw/municipios/<ibge>.json`). Regras e correções vêm do rascunho e do
verificador, que prevalece. Geometria das vias: OSM (ODbL), a partir do cache `data/cache/municipios/osm_named_<ibge>.json`.
Ruas sem nome e rios vêm de um extrato do PBF local (`data/valhalla/sudeste-latest.osm.pbf`). Zonas sem delimitação no
ato: setores censitários urbanos do IBGE 2022.

Casos de rota: `api/test/fixtures/mun_sudeste/<ibge>.json`. Todos foram conferidos na API (`localhost:3000`) e passam em
`API_URL=http://localhost:3000 npx vitest run test/layers/mun_sudeste.test.ts -t "<ibge>"`. Datas: terça 13/10/2026.
"km na regra" é o trecho da rota a até 10 m da via (zona: dentro do polígono recuado 20 m), como mede o teste.

## Decisões comuns

- **Perímetro urbano sem polígono no ato** (Resende, Altinópolis). Usei a união dos setores censitários do IBGE 2022
  (`CD_SIT` 1 e 2, área urbana de cidade) do distrito-sede. O IBGE classifica a situação urbana pelo perímetro urbano
  legal, então é uma aproximação honesta. Fica marcada como `aproximado` e a confiança continua média. As rodovias de
  outra jurisdição ficam livres: foram recortadas com folga (BR-116 em Resende; SP-351/BR-265 e SPV-48 em Altinópolis).
  Furos são preenchidos, porque a API só usa o anel externo de cada polígono. Scripts:
  `data/raw/municipios/geo/<ibge>_perimetro_urbano_curadoria.py`.
- **Origem ou destino dentro da zona**: a zona não é aplicada e a rota avisa (padrão da camada). Por isso os casos de
  zona usam origem e destino fora dela.
- **Registros sem área delimitável** (desativadas: "centro da cidade", Centro Histórico, carga e descarga, praças, pistas
  sem extensão) entram com `{"geojson": FeatureCollection vazia}`. Ficam no arquivo e não geram feição, para não
  espalhar aviso `municipal_regra_nao_aplicada` pelo município inteiro. Revogadas sem geometria própria usam o limite do
  município (`municipios`) ou a geometria da regra que as substituiu. Nunca são aplicadas nem avisadas.
- **Import**: rodei `municipios:<ibge>` com `MUNICIPIOS_DIR` apontando só para o arquivo do município. Arquivos de outros
  lotes ainda em edição travavam o `carregar_todos`. Antes do import, a malha do IBGE do município foi baixada para o
  cache (`data/cache/municipios/ibge_malha_<ibge>.geojson`), porque o contêiner do importador não tem o proxy.

## 3304201 Resende (RJ) — `resende`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| resende_perimetro_urbano_picos | ativa (média) | Dec. 6.966/2013, arts. 2º e 3º, II (B.O. 028/2013) | todos os dias 11h30–13h30 e 16h30–19h30; feriados aplica | carga útil > 4 t, altura > 4,40 m, comprimento > 6,30 m ou articulado/CVC | zona: setores urbanos IBGE 2022 do distrito-sede, sem a BR-116 (60 m), 2 partes (`geo/3304201_perimetro_urbano.geojson`) | evita: margem norte (Agulhas Negras) → Estrada da Limeira, toco; 12h: 92 km e nada na zona; 10h: 18 km e 3,5 km na zona |
| resende_pontes_articulados | ativa (média) | Dec. 6.966/2013, art. 3º, III | 24 h | semirreboque, caminhão + reboque, CVC | ponte Tácito Vianna pelo nome (mão única norte) + Ponte Miguel Couto Filho = way 191567348 sem nome (mão única sul), pela malha do Valhalla (`geo/3304201_pontes.geojson`) | evita ×2, carreta, 10h: Tácito (28,7 km de volta; o truck usa 0,2 km), Miguel Couto (26,5 km; o truck usa 0,16 km) |
| resende_centro_articulados | desativada | Dec. 6.966/2013, art. 3º, III | 24 h | articulados | sem geometria ("centro da cidade" não delimitado) | — |
| resende_centro_historico_pesados | desativada | Dec. 12.253/2019, art. 1º | 24 h | PBT > 3,5 t | sem geometria (Centro Histórico não delimitado; rebaixada pelo verificador) | — |
| resende_carga_descarga_supermercados | desativada | Dec. 6.966/2013, art. 3º, IV; Dec. 10.090/2017 (art. 4º-A); Lei 3.814/2022 | — | — | sem geometria (operação de carga e descarga) | — |

Pendências:
- Trocar o polígono aproximado pelo perímetro urbano oficial (anexos da Lei 3.460/2019) quando houver. O distrito de
  Agulhas Negras, na margem norte entre o rio e a Dutra, ficou fora porque não é a sede (lado conservador).
- A Ponte Miguel Couto Filho foi identificada por inferência: é a ponte sem nome no prolongamento norte da Av. Saturnino
  Braga e forma binário com a Ponte Tácito Vianna. A way 847911809, citada na pesquisa, cruza um afluente, não o
  Paraíba. Confirmar com a prefeitura.

## 3304904 São Gonçalo (RJ) — `sao-goncalo`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| sao_goncalo_flavio_monteiro_barros_carga | ativa (média) | Res. 084/SEMTRAN/2010, arts. 1º e 2º | 24 h | todo caminhão | ways 249980050 + 298631067 (só a Avenida) | evita: pontas norte/sul, toco; 5,0 km e 0,02 km na via |
| sao_goncalo_porto_velho_16t | ativa (alta) | Res. 093/SEMTRAN/2014, art. 1º | 24 h | PBT > 16 t ou semirreboque/CVC | Rua Lafaiete Silva (182872943) + Rua Antônio Carlos (249687001, recortada por lonlat) | evita: carreta, 0,04 km (cruzamentos); o toco usa 0,39 km |
| sao_goncalo_orla_pedrinhas_pesados | ativa (média) | Res. 44/SEMMATRAN/2025, arts. 3º, 4º, 7º e 10 | 24 h | todo caminhão | só a way 201015940 (aproximado) | sem caso: a orla é um ramal sem saída (ver pendência) |
| sao_goncalo_lucio_tome_feteira_muvi | desativada (baixa) | Res. 19/SEMTRAN/2024, arts. 3º e 5º | 24 h | todo caminhão | Rua Lúcio Tomé Feteira inteira (registro) | — |

Pendências:
- **Orla**: não há rota de passagem, e a rota até a orla passa nela e avisa `uses_restricted_way` (routing.ts). O caso
  "sem_alternativa" do teste exige `rmsp_via_restrita_na_rota`, que o annotate só emite quando o routing.ts não cobre a
  linha. Por isso a orla ficou sem caso no fixture.
- Arts. 4º e 7º da Res. 44/2025 não modelados: orla fechada a todos os veículos aos sábados, domingos e feriados, e
  conversão obrigatória na R. Magalhães Bastos.

## 3500709 Agudos (SP) — `agudos`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| agudos_domelia_grande_porte | ativa (média) | Lei 6.068/2026, art. 1º e §§1º–3º, art. 3º (DOSP ed. 1925, 15/05/2026) | 24 h | todo caminhão ("grande porte" não definido) | zona: setor censitário urbano de Domélia (IBGE 2022, 350070910000001), aproximado (`geo/3500709_domelia.geojson`) | evita: estradas a NO e SE da vila, toco; 71 km de volta, nada na zona |
| agudos_domelia_lei5079_2017 | revogada | Lei 5.079/2017, art. 1º (revogada pela Lei 6.068/2026, art. 3º) | — | — | a mesma área | — |

Pendência: a lei alcança "as vias com pavimentação asfáltica do Distrito de Domélia" sem listá-las. A zona cobre só a
vila. Trechos asfaltados fora dela, como a Estrada para Domélia na zona rural do distrito, ficam de fora. Sem
regulamento (art. 1º, §3º).

## 3501004 Altinópolis (SP) — `altinopolis`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| altinopolis_perimetro_urbano_carga | ativa (média) | LC 97/2017, art. 1º e §§1º–3º, arts. 2º, 3º, 5º e 7º | 24 h | todo caminhão; exceção de entrega local (art. 1º, §2º) | zona: setores urbanos IBGE 2022 do distrito-sede, sem a SP-351/BR-265 e a SPV-48 (40 m), aproximado | evita: Serrana → Santo Antônio da Alegria (destino fora do município), toco; 67,5 km e nada na zona |
| altinopolis_ruas_centrais_fim_de_semana | desativada (baixa) | Lei 1.633/2009, art. 3º | sáb/dom 18h–24h | todo caminhão | 5 ruas recortadas pelas transversais do ato (`geo/3501004_vias.geojson`) | — |

Pendência: o perímetro oficial (Lei 1.770/2010) está só em texto. Com origem ou destino em Altinópolis, a exceção de
entrega local libera a zona, e a rota que cruza a cidade passa e avisa. Esse é o comportamento esperado.

## 3501608 Americana (SP) — `americana`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| americana_barragem_salto_grande | ativa (média) | Dec. 4.722/1998, arts. 1º, 3º e 4º | 24 h | todo caminhão | ~130 m sobre o aterro (Guilherme Schimidt/Rio Camanducaia, pelo Valhalla entre as pontas estimadas), aproximado | evita: oeste → leste da barragem, toco; 16,7 km contra 0,7 km |
| americana_centro_dec_5814_2003 | ativa (média) | Dec. 5.814/2003, art. 1º, I–XIV, art. 2º e parágrafo único, art. 3º | seg–sáb 9h–18h; feriados suspende | capacidade de carga > 2 t | 13 incisos por nome e trecho; sem o inc. XII e os trechos de calçadão (`geo/3501608_centro_dec_5814_2003.geojson`) | evita: sul do Centro → Av. Dr. Antônio Lobo, toco 10h; 0,02 km (cruzamento) |
| americana_centro_lei_3621_2002 | revogada | Lei 3.621/2002, art. 1º (ADI 93.547.0/1) | — | — | as 9 vias citadas, inteiras (registro) | — |
| americana_carga_descarga_dec_4313_1997 | desativada | Dec. 4.313/1997, art. 1º | — | — | sem geometria (operação) | — |
| americana_perigosos_dec_6431_2005 | desativada | Dec. 6.431/2005, arts. 1º–4º | — | — | sem geometria (frente de perigosos) | — |

Pendências:
- Dezembro (9h–24h, art. 2º, parágrafo único) não é modelado, porque as janelas não têm mês.
- A Rua Fernando de Camargo (inc. XII) e os trechos de calçadão da R. Dr. Vieira Bueno e da R. 30 de Julho estão como
  `highway=pedestrian` no OSM e ficaram fora.
- A `vigencia_fim` da lei revogada é 12/06/2003, data do decreto substituto, porque falta a data do acórdão da ADI.
- Não há caso com `departure_fora` no Centro: o desvio do Centro cruza outras vias restritas (grade) e a rota "fora"
  testada coincidia com a de dentro.

## 3502507 Aparecida (SP) — `aparecida`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| aparecida_ponte_velha_pesados | ativa (média) | Dec. 2.881/1996, arts. 1º, 2º e 4º | 24 h | todo caminhão | ponte da Av. Sólon Pereira (way 258715355), a ponte antiga a montante da Ponte Min. Roberto Cardoso Alves; aproximado | sem caso (ver pendência) |
| aparecida_praca_ns_aparecida_pesados | desativada (baixa) | Lei 1.267/1967, art. 1º e § único, art. 2º | — | — | sem geometria (praça sem perímetro) | — |

Pendência: no OSM a ponte antiga já tem `motor_vehicle=no`, então o roteador nunca a usa e não dá para mostrar desvio. A
regra é redundante na rota, mas registra a proibição legal. A identificação da "Ponte Velha" com a Gov. Adhemar de
Barros é inferência. Conferir também se a Ponte Min. Roberto Cardoso Alves, interditada pelo Dec. 3.573/2006 e aberta no
OSM, reabriu.

## 3503208 Araraquara (SP) — `araraquara`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| araraquara_centro_vias_horario | ativa (alta) | Lei 4.420/1994, art. 1º, I–XII (red. Lei 10.956/2023, art. 1º) | dias úteis 10h–19h, sáb 10h–14h; feriados suspende | todo caminhão | 12 trechos por nome e transversais (`geo/3503208_centro.geojson`) | sem caso (ver pendência) |
| araraquara_voluntarios_patria | ativa (média) | Lei 4.420/1994, art. 1º, parágrafo único (red. Lei 10.956/2023) | 24 h | todo caminhão | Voluntários da Pátria, XV de Novembro → José Bonifácio | sem caso (ver pendência) |
| araraquara_ara080_bueno_andrada | desativada (média) | Dec. 7.208/1997, art. 1º, I–III, art. 2º | 24 h | PBT > 6 t, comprimento > 10 m, largura > 2,10 m | ARA-080 pelos dois nomes do OSM, aproximado (`geo/3503208_ara080.geojson`) | — |

Pendências:
- Todas as ways dos 13 trechos têm `hgv=no` **sem condição** no OSM. O roteador já as evita 24 h, dentro e fora da
  janela, e o desvio da camada não aparece no `avoided`. Por isso não há caso de rota. A divergência (deveria ser
  `hgv:conditional`) vai para `data/osm-overrides/overrides.json` como pendente, pela outra sessão.
- Inc. XII (Av. Osório): a avenida é uma só way, exatamente entre as transversais, e foi usada inteira. O importador
  falha com `de`/`ate` quando a via tem uma única linha (bug abaixo).
- ARA-080: há indício de um limite de 7 t PBT, mas o ato vigente não foi localizado.

## 3502754 Araçariguama (SP) — `aracariguama`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| aracariguama_centro_caminhoes_tratores | ativa (média) | Dec. 3.635/2022, arts. 1º (I–XVIII), 2º, 3º, 5º e 6º | 24 h (carga e descarga seg–sex 19h–10h só como exceção) | todo caminhão; VUC local (2,20 × 7,20 m) isento | 18 vias por nome (`geo/3502754_centro.geojson`) | evita: R. Leopoldo da Silva → sul do Centro, toco; 3,5 km e 0,04 km (cruzamentos) |

Pendências:
- Inc. II (R. Aparecida, "entre a Av. Nicolau Ferreira de Souza e a Al. 19 de Maio"): no OSM a avenida não chega à rua
  (para ~144 m antes) e a Alameda cruza junto à ponte. Foi aplicada a R. Aparecida inteira (~0,5 km), aproximada.
- Inc. VII: vai da R. Leopoldo da Silva até a ponta leste da avenida, aproximado.
- O inc. XII ("Rua Heitor Boccato") está no OSM como "Avenida Prefeito Heitor Bocatto - Rino Bocatto".
- O `maxweight` do OSM (4 ways) não foi cruzado com o decreto.

## 3504107 Atibaia (SP) — `atibaia`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| atibaia_quadrilatero_central | ativa (alta) | Dec. 6.667/2012, arts. 2º (I e II), 3º–7º e 10; Dec. 10.197/2022, art. 52 | seg–sex 9h–18h, sáb 9h–14h; feriados suspende | largura > 2,20 m, comprimento > 6,30 m ou capacidade > 3 t (VUC local isento) | vias dos incisos I e II recortadas pelo polígono do perímetro do inciso I (`geo/3504107_quadrilatero.geojson`, script `3504107_quadrilatero_curadoria.py`) | evita: norte da R. João Pires → sul do Centro, toco; 10h nada nas vias; 20h 0,59 km |
| atibaia_ape_centro_historico_6t | desativada (baixa) | LC 470/2005, art. 5º | 24 h | PBT > 6 t | sem geometria (Anexo I ilegível) | — |
| atibaia_estrada_dos_pires | desativada (unverifiable) | penaestrada (sem ato) | 24 h | todo caminhão | Estrada dos Pires inteira (registro de pista) | — |
| atibaia_serrinha_lucas_garcez | desativada (baixa) | indicação de vereador (IOE 3016/2026) | 24 h | todo caminhão | sem geometria (extensão desconhecida) | — |

Por que geometria manual: o inciso II só vale dentro do perímetro do inciso I. O `construir: trechos` não recorta por
polígono, e várias vias têm uma só way, caso em que `de`/`ate` cai no bug abaixo. O script monta o perímetro com as
próprias vias do OSM: dois blocos, a oeste e a leste da R. Lourenço Franco, unidos. Depois recorta as ways com folga de
12 m. A R. João Pires é o limite e fica livre.

Pendência: a STT pode ter mudado as vias por portaria ou sinalização (art. 2º, parágrafo único). Nenhuma foi achada.

## 3504503 Avaré (SP) — `avare`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| avare_centro_nobre_4500kg | ativa (alta) | Lei 2.165/2017, art. 4º e parágrafo único; Lei 2.294/2019, art. 1º | 24 h | capacidade de carga > 4,5 t | zona: quadrilátero pelos 4 cruzamentos (`geo/3504503_centro_nobre.geojson`); com o recuo, as vias-limite ficam livres | evita: R. Rio Grande do Sul leste → oeste, toco; nada na zona |
| avare_vias_urbanas_pbt25_lei2165 | revogada | Lei 2.165/2017, art. 1º (revogado pela Lei 2.294/2019) | — | — | limite do município | — |
| avare_avrs_pbt45_lei2165 | revogada | Lei 2.165/2017, art. 2º (revogado pela Lei 2.294/2019) | — | — | limite do município | — |

Pendência: o Dec. 360/1996 ("Disciplina o tráfego de veículos") não foi lido.

## 3505500 Barretos (SP) — `barretos`

| id | status | ato e artigo | janela | alvo | geometria | casos de rota |
|---|---|---|---|---|---|---|
| barretos_av_agostinho_pereira | ativa (média) | Lei 4.581/2011, arts. 1º–3º | 24 h | eixos > 3 ou semirreboque/reboque/CVC | Av. Agostinho Pereira inteira (4 ways) | evita: pontas oeste/leste, carreta; 0,04 km (cruzamentos); o toco usa 1,28 km |
| barretos_cana_perimetro_urbano_lei_4298 | revogada | Lei 4.298/2010, art. 1º (ADIN 2218753-02.2014.8.26.0000) | — | — | limite do município | — |

Pendência: a situação "EM VIGOR" no Siscam da Câmara não pôde ser reaberta pelo verificador (DNS).

## Bugs e limitações encontrados (fora do escopo do lote, não alterados)

1. `importers/sources/_municipios_lib.py`, `build_trecho`: `linemerge(unary_union(lines))` levanta
   `ValueError: Cannot linemerge` quando a via (já recortada) é uma única LineString e o trecho tem `de`/`ate`.
   Correção sugerida: passar a lista de linhas, `linemerge(lines)`, ou tratar o caso LineString.
2. `MUNICIPIOS_REBUILD=1` falha num município que mistura geometria `manual` e `trechos`: `build_or_load` chama o
   construtor também para o arquivo manual, que levanta "ausente". Contorno: apagar só o GeoJSON de trechos e importar
   sem a variável.
3. `run.py municipios:<ibge>` valida todos os arquivos (`carregar_todos`). Um arquivo inválido de outro lote, ainda em
   edição, impede o import de qualquer município. Contorno: `-e MUNICIPIOS_DIR` montando só o arquivo do município.
4. O contêiner do importador não tem o proxy de saída: a malha do IBGE (`municipio_geom`) não baixa. Contorno: pré-baixar
   para `data/cache/municipios/ibge_malha_<ibge>.geojson`.
5. Caso "sem_alternativa" do teste: quando o routing.ts cobre a linha, o aviso é `uses_restricted_way` e não
   `rmsp_via_restrita_na_rota`. Uma via sem saída (orla de São Gonçalo) não passa nesse critério.
6. A camada usa só o anel externo dos polígonos (`ringsOf`): furos são ignorados. Os polígonos deste lote foram gerados
   sem furos.
