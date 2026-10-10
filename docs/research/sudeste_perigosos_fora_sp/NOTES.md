# Produtos perigosos fora de SP (RJ, MG, ES) — notas de pesquisa (10/10/2026)

Tema `perigosos_fora_sp`. Complementa `docs/research/carga_perigosa` (focado em SP). Repo lido, nada escrito.
Regras estruturadas: `regras_perigosos_fora_sp.csv` (8 linhas).

## O que vale de verdade (fonte primária lida)

| Regra | Ato | Texto conferido |
|---|---|---|
| Ponte Rio–Niterói (BR-101) e acessos: PP das classes 1, 2.1, 2.3, 3, 4, 5, 6 e 8 proibido 24h | Portaria SPRF-RJ/PRF nº 407, de 14/11/2024, DOU 22/11/2024 (Seção 1) | arts. 1º–4º; § único do art. 1º isenta quantidade limitada/provisões especiais (Parte 3 da Res. ANTT 5.998/2022); art. 2º Mocanguê (Niterói↔Mocanguê, 23–04h e 11–16h, aviso 24h à concessionária); art. 3º vazios não limpos; art. 4º CTB 187 I; art. 4º-A Av. Portuária |
| Av. Portuária (Av. Brasil → Porto do Rio) | mesma portaria, art. 4º-A | idem |
| Terceira Ponte (Vitória–Vila Velha, ES-060): todos os veículos com PP, 0–24h | Instrução de Serviço DERTES nº 021-N/2004 (DIO-ES 27/09/2004) | art. 1º g + "Horários" item 2; alternativas: Segunda Ponte, ES-471 (Darly Santos), Av. Carlos Lindenberg |

Histórico da ponte: Res. ANTT 1.713/2006 (classes 1, 2.1, 2.3, 3, 4, 5, 8) + Res. 5.936/2021 (Av. Portuária) foram
revogadas pela Res. ANTT 6.000/2022, art. 234, II, "após 1 ano" da vigência (vigência 01/07/2023 → revogação 01/07/2024).
O vazio foi coberto pela PRF em 14/11/2024 (publicado em 22/11/2024), que **acrescentou a classe 6**. Isso fecha a
lacuna "ato que substituiu a 1.713" do tema carga_perigosa.

Como achei no DOU: a busca textual do in.gov.br não acha o título; o `leiturajornal?data=DD-MM-AAAA&secao=do1`
(JSON em `<script id="params">`) filtrado por hierarquia "Polícia Rodoviária Federal/Superintendência" achou as
portarias 406/407/408 em 22/11/2024 (`lj.py`). A busca por título "SPRF-RJ/PRF" 2024–2026 lista só 240/2024,
406–408/2024, 340/2026 (Serra de Petrópolis, temporária), 347 e 364/2026 (JARI): nenhuma revoga a 407.

## Leis municipais do Rio (texto lido, aplicação duvidosa)

- Lei 1.632/1990 (CMRJ: "Em Vigor"): "veículos de cargas perigosas" (combustíveis e derivados ou elementos químicos
  de alta periculosidade) só circulam no perímetro urbano das 21h às 6h. Sem regulamentação localizada.
- Lei 2.959/1999 (CMRJ: "Em Vigor"): Av. Brasil — caminhões só 22h–6h; "cargas tóxicas, nocivas ao meio ambiente"
  só 22h–2h e nas pistas laterais. Art. 4º: "O Poder Executivo regulamentará". O regime real de caminhões é o
  Decreto Rio 45.433/2018 (ART/ARP/ARM/ARV; polígonos por ato da SMTR) — sem PP no texto; o 1746 diz que a
  Resolução SMTR 3.055/2018 está suspensa pela 3.254/2020.
- Muitas leis de trânsito de iniciativa da Câmara foram declaradas inconstitucionais (CF art. 22 XI); estas duas não.
  → só aviso no app.

## MG / BH

- Anel Rodoviário de BH: notícia de 2011 (Transporta Brasil) diz que o DNIT limitou PP a 23h–5h com autorização.
  Não achei o ato. Desde 03/06/2025 o Anel (22,4 km) é da PBH; DOM-BH (API, 2008–2026) não tem ato de PP no Anel.
  Fiscalizações PBH+ANTT em 2026 (22/07, 13/08, 17/09) checam RTPP (documentos, EPI), não horário. → não aplicar.
- DER-MG: listagens de portarias 1999–2026 (28 páginas) só têm a Portaria 3.302/2014 (Copa) com PP. Holiday
  portarias (ex. 4.242/2026) tratam de excedentes, não de PP.
- BHTRANS 51/2014 e ato de 2013 (Copa das Confederações): PP proibido em dias de jogo. Expirados.
- DOM-BH 28/05/2016: veto do Prefeito a proposição de lei sobre "critérios para transporte de carga perigosa" em BH.
- Lei MG 22.805/2017 e Decreto 47.629/2019: medidas pós-acidente e engenharia em "trechos vulneráveis";
  sem proibição de rota (fontes secundárias: normasbrasil, demarest).
- Lei MG 16.197/2006 (APA Vargem das Flores, texto ALMG): nada sobre PP.

## ES

- DER-ES página "Legislação" lista: IS 011-N/2003 (proíbe caminhões na 3ª Ponte), IS 021-N/2004 (a que vale, com PP),
  IS 006-N/2006 e 009-N/2008 (23 t PBT na ES-010), Lei 4.463/1990 (Rodovia do Sol: >2 eixos ou PBT>15 t proibidos —
  regra geral de caminhão, passar ao tema de rodovias e conferir vigência).
- Vitória: Código de Posturas (Lei 6.080/2003) e Decreto 11.975/2004 não têm regra de rota de PP. Decreto de
  caminhões 16.243/2015 citado pela imprensa: texto não obtido.

## RJ estadual

- ALERJ (contlei): nenhuma lei de rota/horário de PP. Lei 3.007/1998 art. 7º: transporte de resíduos perigosos
  para dentro/fora do RJ exige licenciamento ambiental (compliance, não rota).
- DER-RJ: índice de legislação sem portaria de PP.

## OSM e Valhalla (PBF Sudeste local, tileset 1791576041)

- `hazmat*` no Sudeste: 37 ways, todas em SP (Imigrantes, Tamoios/Caraguatatuba). Nada em RJ/MG/ES.
- Ponte Rio–Niterói: 54 ways motorway (26,5 km) + 13 links (2,2 km), `hgv=yes` em parte, sem hazmat.
- Av. Portuária: 13 ways (3,8 km), `hgv=designated`.
- Terceira Ponte ("Ponte Deputado Darcy Castello de Mendonça", ES-060): 14 ways, 6,8 km,
  `hgv:conditional=yes @ (10:00-16:00 AND weight<10);yes @ (22:00-06:00 AND weight<15)` — bate com a IS 021-N para
  caminhão comum; sem hazmat.
- Linha Vermelha (RJ-071): `hgv=no` (40 km) → já fora para qualquer caminhão.
- Anel BH: sem tags de caminhão/PP.
- Valhalla, truck hazmat=true, 10/10/2026:
  - Niterói Centro → Caju: 19,6 km/24 min pela ponte; sem a ponte 108,5 km/99 min.
  - Vila Velha → Vitória: caminhão pesado (padrão) já evita a 3ª Ponte (17,5 km). Caminhão leve 8 t/2 eixos com
    hazmat=true PASSA na ponte (6,5 km/12 min) → violaria a IS 021-N; sem a ponte: 17,5 km/38 min.
  - km em área de manancial: Caju→Resende (Dutra) 18,9 km de 159,5 na APA do Rio Guandu; BH→Itabirito (BR-040)
    46,6 km de 69,5 na APA Sul RMBH.
- Overpass: 504 em 10/10/2026 (consultas pequenas também). Usado o PBF local via `osmq-img` (osmium 1.15).

## Dados geográficos novos testados

| Fonte | Endpoint | Resultado |
|---|---|---|
| FEAM/IDE-Sisema "Acidentes ambientais" 2014–2025 | `https://geoserver.meioambiente.mg.gov.br/ows` typeNames `IDE:ide_2302_mg_acidentes_ambientais_AAAA_pto` | 200. 4.012 registros, 2.881 "Transporte Rodoviário" (todos com ponto). 2025 em JSON falha ("JSON does not allow non-finite numbers"): usar CSV/WFS 1.0. Campo `empresa` traz CPF em 7 linhas de 2025 → descartar |
| FEAM bases de atendimento a emergências com PP | `IDE:ide_230202_mg_base_empresas_atendimento_acidentes_pto` | 200, 32 bases |
| IDE-Sisema UCs estaduais MG | `IDE:ide_2010_mg_unidades_conservacao_estaduais_pol` | 200, 95 UCs; APA Sul RMBH (Dec. 35.624/94…), APA Vargem das Flores (Lei 16.197/06) |
| INEA via INDE | `https://geoservicos.inde.gov.br/geoserver/ows` `INEA:apa_rio_guandu` | 200, 1 polígono, 74.295 ha, EPSG:4674 |
| INEA via INDE | `INEA:gpt_ponto_captacao_2021` / `INEA:gpl_aipms_sedes_distritos_2021` | 200; 514 pontos / 514 bacias (28 MB; bacias enormes, ex. Paraíba do Sul 6 Mha → inúteis como aviso de km) |
| INEA geoportal ArcGIS | `https://geoportal.inea.rj.gov.br/server/rest/services` | lista OK, consultas em timeout |
| INEA ArcGIS Online | services6.arcgis.com/8oW8Vw6yLtm5Xojn | 499 Token Required |
| Licença IDE-Sisema e INDE | GetCapabilities | Fees NONE / AccessConstraints NONE (não declarada) |

## Fontes que falharam ou não foram verificadas

- gov.br/prf notícia RJ: 401 (curl e WebFetch). Ecovias Ponte: 403 no curl; OK no navegador embutido.
- leismunicipais.com.br: 403. DOM-BH e api-dom.pbh.gov.br: WAF bloqueia curl; OK via navegador.
- ALMG dados abertos: 403/500 na busca; texto da lei via navegador.
- Orçamento de busca web (200) esgotado durante a pesquisa: municípios além de Rio/BH/Vitória não foram varridos.

## Scripts nesta pasta

`lj.py` (DOU por dia/seção/hierarquia), `dsearch.py` (busca DOU), `dou_get.py`/`dou_search.py` (copiados de
rodovias_restricoes), `cmrj.py` (CMRJ e ALERJ Lotus Notes), `alerj.py`, `txt.py`. Amostras: `portaria_sprf_rj_407.txt`,
`portaria_sprf_rj_406.txt`, `lei_rio_1632_1990.txt`, `es/der_doc1-3.pdf`, `dermg/portaria_3302_2014.pdf`,
`osm/*.geojsonseq`, `rj/INEA_apa_rio_guandu.json`, `mg_acidentes/`, `valhalla/*.json`.
