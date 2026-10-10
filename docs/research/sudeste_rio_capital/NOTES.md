# rio_capital — Cidade do Rio de Janeiro (IBGE 3304557): restrições a caminhões, carga e descarga e perigosos

Pesquisa de 10/10/2026. Repositório não editado. A cota de WebSearch da sessão acabou no início do tema, por isso
quase tudo veio de fonte primária consultada direto: o D.O. Rio (busca + download de edições), o Querido Diário, a
SMTR, o 1746, o ArcGIS do IPP, o data.rio, o Overpass, o anttlegis e o DOU.

## 1. Conclusão central

**A regra geral de caminhões do Rio está SUSPENSA desde 20/03/2020 e continua suspensa.**
- A regra é o Dec. Rio 45.433/2018, que traz os conceitos ART/ARP/ARM/ARV/VRE, o VUC e a AEVC. Os polígonos e
  horários estão na Res. SMTR 3.055/2018 (DO 11/12/2018, p. 24–26).
- A Res. SMTR 3.254/2020 (DO 20/03/2020, p. 42) suspendeu a Res. 3.055 "por prazo indeterminado". O Dec. Rio
  47.285/2020, art. 1º, "r", também suspendeu, mas cita os decretos de 2016–2017, que já estavam revogados.
- A suspensão foi confirmada em três lugares:
  - página da SMTR sobre a AEVC (atualizada em 03/03/2023);
  - artigo do 1746 editado em 08/06/2026 (API Zendesk `updated_at`);
  - parecer da CET-Rio no DO de 11/01/2024, p. 17: "temporariamente estão suspensos".
- Nenhum ato de revogação da suspensão foi encontrado no DO até set/2026.

**O que segue valendo são atos por via, editados pela SMTR e pela CRV (Coordenadoria de Regulamentação e Infrações
Viárias).** A CRV continuou emitindo autorizações excepcionais por placa com base neles até 2020–2022:
- Linha Vermelha: Res. SMTR 2.204/2012, proíbe 24h caminhão de qualquer espécie, reboques e **produtos perigosos**;
- Linha Amarela: Res. SMTR 2.063/2010, proíbe veículos de carga em dias úteis das 6h às 10h e das 17h às 20h;
- corredor Rebouças: Portaria TR/SUB/CRV 24.914/2003, proíbe caminhões com PBT ≥ 6,4 t e reboques em 6 vias;
- Centro: Portaria TR/SUBG/CRV 10.798/2017 (Praça XV, Primeiro de Março, São José e Orla Conde);
- Transoeste: Res. SMTR 2.242/2012, art. 5º (Túnel da Grota Funda e pista central da Av. das Américas);
- portarias pontuais recentes: Rua Gonzaga Duque (2024), Ruas João Borges e Duque Estrada (2023), Caminho da Canoa (2020).

**Av. Brasil não tem restrição horária em vigor.**
- O Dec. 42.272/2016, art. 4º, foi revogado pelo Dec. 45.433/2018, e a Res. 3.055 não incluiu a avenida.
- A CET-Rio anunciou para 16/03/2024 uma restrição na pista central (Irajá–Caju, 4h às 22h todos os dias) e nas
  laterais. Ela foi **adiada em 10/03/2024**. Até set/2026 não saiu nenhum ato no DO nem notícia no COR (WP API).
- Vale apenas a faixa exclusiva de ônibus/BRT (2ª faixa da esquerda da pista central). Nela o caminhão é proibido a
  qualquer hora (Res. SMTR 3.718/2024 com a redação da 3.726/2024). A restrição é por faixa e o router não modela isso.

**Perigosos.**
- Municipal: só a Linha Vermelha (Res. 2.204/2012, art. 1º, IV). Busquei "produtos perigosos" no DO de 2002 a 2026
  (123 páginas) e não apareceu outra regra de rota.
- Federal: a Ponte Rio–Niterói e a Av. Portuária tinham a Res. ANTT 1.713/2006, com classes 1, 2.1, 2.3, 3, 4, 5 e 8
  proibidas. A Res. 5.936/2021 estendeu à Av. Portuária. A Res. 6.000/2022 revogou a 1.713 (já levantado em
  `carga_perigosa`). O ato que a substituiu **não foi achado**: DOU sem resultado e site da Ecoponte com 403.

## 2. Atos e onde estão (todos lidos na fonte primária)

| Ato | DO | URL de teste | Página salva |
|---|---|---|---|
| Dec. 45.433/2018 (VUC 2,50 × 7,20 × 3,50 m; ART/ARP/ARM/ARV/VRE; AEVC) | DO 10/12/2018 | QD `3304557/2018-12-10/a16190d5...pdf` | — (texto também no legisweb id=371007) |
| Res. SMTR 3.055/2018 (ARP Centro 6h–21h; ARM/ARV 6h–10h e 17h–21h; exceções; AEVC) | DO 11/12/2018 p. 24–26 | QD `2018-12-11/a411269d...pdf` | atos/DO-2018-12-11_res_smtr_3055_p24..26 |
| Res. SMTR 3.254/2020 (suspensão) | DO 20/03/2020 p. 42 | QD `2020-03-20/85f5557e...pdf` | atos/DO-2020-03-20_res_smtr_3254_p42 |
| Dec. 47.285/2020, art. 1º, "r" | DO 23/03/2020, 2ª ed. | doweb edição 4485 | atos/DO-2020-03-23_dec_47285_p2 |
| Res. SMTR 2.063/2010 (Linha Amarela) | DO 15/12/2010 p. 45 | doweb edição 1085 | atos/DO-2010-12-15_res_smtr_2063_p45 |
| Res. SMTR 2.204/2012 (Linha Vermelha) | DO 19/03/2012 p. 38–39 | doweb edição 1681 | atos/DO-2012-03-19_res_smtr_2204_p38/39 |
| Portaria TR/SUB/CRV 24.914/2003 (Rebouças) | DO 25/11/2003 p. 36–37 (OCR) | doweb edição 7379 | atos/DO-2003-11-25_portaria_crv_24914 |
| Res. SMTR 2.242/2012 (Transoeste; revoga a 2.228/2012) | DO 24/07/2012 p. 27–28 | doweb edição 1823 | atos/DO-2012-07-24_res_smtr_2242 |
| Portarias CRV de 13/12/2012 (Joá, Joatinga, Elevado das Bandeiras, Túnel de São Conrado) | DO 14/12/2012 p. 38 | doweb edição 1947 | atos/DO-2012-12-14_portarias_joa_p38 |
| Portaria TR/SUBG/CRV 10.798/2017 (Centro) | DO 10/11/2017 p. 61 | QD `2017-11-10/4f492f35...pdf` | atos/DO-2017-11-10_portaria_crv_10798_p61 |
| Res. SMTR 3.718/2024 (faixas exclusivas na Av. Brasil) | DO extra 27/03/2024 p. 2 | doweb edição 6506 | atos/DO-2024-03-27extra_res_smtr_3718_p2 |
| Res. SMTR 3.726/2024 (caminhão vedado na faixa) | DO 17/04/2024 p. 16 | doweb edição 6555 (texto pela API) | — |
| Portaria TR/SUBTT/CRV 8.083/2024 (R. Gonzaga Duque, Ramos) | DO 19/07/2024 p. 20 | QD `2024-07-19/d7934039...pdf` | — |
| Portaria TR/SUBTT/CRV 1.451/2023 (R. João Borges e R. Duque Estrada, Gávea) | DO 26/07/2023 p. 28 | QD `2023-07-26/e1f43048...pdf` | — |
| Portaria TR/CRV 4.536/2020 (Caminho da Canoa, São Conrado) | DO 21/07/2020 p. 38 | QD `2020-07-21/4436fb6f...pdf` | — |
| Portaria CRV (Maracanã em dia de jogo: caminhões e utilitários) | DO 06/09/2022 p. 21 | QD `2022-09-06/c40be937...pdf` | — |
| Portaria CRV sazonal da Estr. Roberto Burle Marx (Grumari): caminhões e C/D proibidos sáb, dom e feriados 6h–22h, 18/10/2025–01/03/2026 | DO 15/10/2025 p. 27 | doweb (texto pela API) | — (número da portaria não legível no índice) |
| Edital CPLOG-Rio 01/2023 (pauta: restrição de caminhões na Av. Brasil por causa do Transbrasil) | DO 14/12/2023 p. 69 | QD `2023-12-14/0b596cb7...pdf` | — |

**Histórico (não aplicar):**
- Dec. 29.231/2008: orla Copacabana–Barra e 26 vias, 6h–10h e 17h–20h.
- Dec. 38.055/2013.
- Decs. 41.867 e 41.940/2016 (Olimpíada).
- Dec. 42.252/2016, revogado poucos dias depois pelo 42.272/2016.
- Dec. 42.272/2016 e Dec. 43.970/2017 (Região Portuária), ambos revogados pelo Dec. 45.433/2018.

A revogação expressa do Dec. 29.231/2008 não foi verificada.

## 3. Fontes testadas

- **Busca do D.O. Rio (Elasticsearch)**:
  `https://doweb.rio.rj.gov.br/busca/busca/buscar/query/{pag}/y:{anos}/?1=1&q=...`. Devolve JSON com `conteudo`
  (texto da página), `data`, `pagina`, `diario_id` e `pdf_id`.
  - Texto entre aspas vira `match_phrase` com slop 3. Sem aspas, a busca usa OR.
  - Em parte das buscas por frase, `hits` vem vazio, mas `aggregations.Edicoes` traz os ids das edições.
  - A edição inteira baixa em `/portal/edicoes/download/{diario_id}` (PDF de 0,4 a 86 MB).
  - Cobertura de 2002 a set/2026. "caminhões" em 2019–2026 deu 1.279 páginas, todas baixadas (13 MB gz em
    doweb/cam_2019_2026.jsonl.gz).
  - Licença: ato oficial, sem proteção autoral (Lei 9.610/98, art. 8º, IV).
- **Querido Diário** (Rio level 3, já usado em `restricoes_rmsp_municipios`): funciona, mas é instável (500/520 em
  frases com "Nº" ou em consultas repetidas). Os PDFs de `data.queridodiario.ok.org.br` são a cópia mais fácil do DO.
- **SMTR, página da AEVC**: HTTP 200. Os PDFs do decreto e da resolução linkados nela dão 404.
- **1746 (Zendesk)**: a página dá 403; a API pública `/api/v2/help_center/pt-br/articles/10872428930203.json` dá 200.
- **IPP pgeo3 ArcGIS**: `CadLog/Trechos_Logradouros/FeatureServer/0` tem **132.064 trechos** com nome completo,
  bairro, hierarquia, `oneway`, velocidade e `tipo_trecho` (Túnel/Viaduto). Licença **CC BY 4.0** (item data.rio
  899168c8...). Pasta `GeoVias` exige token (499).
- **data.rio search API** (`/api/search/v1/collections/dataset/items?q=`): não há dataset de restrição de caminhão,
  de vaga de carga e descarga nem de túnel. Há BRS (25 corredores com nº de portaria), Trajetos BRT (5) e ciclovias,
  todos CC BY 4.0.
- **Overpass (Rio, admin_level 8)**: 653 ways com tag de caminhão, sendo 157 `hgv=no`, 33 `hgv:conditional` e
  435 `maxheight`.
  - Linha Vermelha: 79 de 86 ways com `hgv=no`.
  - Túneis Rebouças: `hgv=no`. Os elevados do corredor (Freyssinet, Pizarro, Saint Hilaire, Vital Brasil) não têm tag.
  - Linha Amarela: **sem** condicional (só 11 ways `hgv=discouraged`).
  - Primeiro de Março e São José: `hgv=no`.
  - Túnel José Alencar: `hgv=no`.
  - Elevado do Joá, Ponte da Joatinga, Av. Niemeyer e Autoestrada Lagoa-Barra: `hgv=no`, sem ato atual achado.
  - **As 33 `hgv:conditional` são resíduo da Res. 3.055 suspensa** (Av. Menezes Côrtes, Estr. dos Três Rios,
    Pau-Ferro: "Mo-Fr 06:00-10:00,17:00-21:00"; Av. Atlântica; R. Equador; R. Nelson Carneiro). Elas fazem o
    Valhalla desviar caminhão sem base legal hoje.
  - No 2º teste, por nome, o Overpass deu 504 e 500 em três instâncias.
- **anttlegis**: Res. 1.713/2006 (marcada "Revogada pela Res. 6000/2022") e Res. 5.936/2021, HTTP 200.
- **DOU (in.gov.br)**: nada sobre restrição de caminhão ou PP na Ponte entre out/2024 e mar/2025. Só achei atos
  contratuais da Ecoponte/Ecovias Ponte, como a Decisão SUROD 1.324/2026 (velocidade média).
- **Ecoponte**: 403. **CET-Rio, prefeitura.rio e transportes.prefeitura.rio (WP REST)**: 401.
  **COR.rio WP REST**: 200, útil para vigiar eventos e interdições.

## 4. Geometria (amostra em geo/amostra_vias_restritas_rio.geojson)

CadLog por nome:

| Via | Nome no CadLog | Trechos | Extensão |
|---|---|---|---|
| Linha Vermelha | "Avenida Presidente João Goulart" | 128 | 35,2 km |
| Linha Amarela | "Avenida Carlos Lacerda" | 249 | 39,1 km |
| Corredor Rebouças | 6 nomes | 109 | 20,7 km |
| Grota Funda | "Tunel Vice Presidente José Alencar" | 2 | 2,3 km |
| Gonzaga Duque | — | — | 0,71 km |
| João Borges + Duque Estrada | — | — | 1,18 km |
| Caminho da Canoa | — | — | 0,18 km |

Cuidados com os nomes:
- **Homônimos**: "Rua São José" aparece em 15 bairros e "Avenida Presidente João Goulart" também existe no Vidigal.
  É obrigatório filtrar por bairro.
- "Orla Prefeito Luiz Paulo Conde" não foi encontrada no CadLog.
- A pista central da Av. das Américas não se separa por nome. Use o OSM (carriageway).
- Os polígonos da Res. 3.055 só existem como **imagem** (Anexos I e II no DO). Dá para reconstruir pelas vias-limite
  (27 e 26 incisos) com o CadLog.

## 5. Carga e descarga

Não há regra geral em vigor (a Res. 3.055 está suspensa). As vagas são criadas uma a uma por portaria da CRV.
- Modelo recorrente: VUC/utilitário em dias úteis das 8h às 18h e sáb das 8h às 13h; caminhão em dias úteis das 10h
  às 16h e sáb das 8h às 13h. Algumas vagas são com limite de PBT (8,5 t ou 12,5 t).
- Volume: cerca de 1.000 páginas por ano do DO citam "carga / descarga" (8.489 de 2019 a 2026).
- Não há dataset espacial.
- Mudança residencial: Res. SMTR 1.599/2006 (permissão especial de estacionamento).

## 6. Pendências

- Ato vigente da ANTT/Ecoponte para PP e caminhões na Ponte Rio–Niterói. A notícia secundária de 05/12/2024 cita:
  2 eixos sentido Niterói seg–sex 4h–10h; 3+ eixos sentido Niterói 4h–12h e sentido Rio 12h–22h; PP proibido.
  Não confirmado.
- Situação atual do Joá: a portaria de dez/2012 parecia valer de 17/12/2012 a 17/12/2013. Também falta ato para a
  Av. Niemeyer e a Autoestrada Lagoa-Barra (no OSM, `hgv=no`).
- Linha Amarela: não há autorização da CRV depois de 2021 que confirme a aplicação atual.
- Repristinação: os Decs. 42.252 e 42.272/2016 regularam de novo a Linha Amarela e a Linha Vermelha e foram
  revogados em 2018. A CRV continuou citando a Res. 2.063 e a Res. 2.204, ou seja, a prática administrativa as trata
  como vigentes.
- Inventário completo das portarias "proíbe a circulação de caminhões" de 2020 a 2026: a API esconde os hits. As
  contagens por ano são 15 + 27 + 8 páginas, e só parte foi lida.
- Feriados municipais e estaduais do RJ, para aplicar "dias úteis": tema `feriados`.
