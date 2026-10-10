# ders_estaduais — DER-MG, DER-RJ e DER-ES (pesquisa de 10/10/2026)

Repo só lido. Nada escrito no repo nem no banco. Amostras nesta pasta (47 MB).

## Reaproveitado (não retestado)
- `superficie_pavimento`: IDE-Sisema `IDE:ide_0401_mg_rodovias_lin` (3.444 trechos, 12/2021). Reconfirmei só o GetCapabilities:
  a IDE-Sisema não tem camada de OAE, balança ou placa (1.421 camadas, só malhas e transporte coletivo da RMBH).
- `rodovias_restricoes`: notícia da Portaria DER-MG 4.162/2025, agora substituída pela 4.242/2026 (fonte primária abaixo).
- `pontes_federais` / `federal_restricoes`: SIAET, DNITGeo, ANTT pontes. Valem para as BRs em MG/RJ/ES; não refiz.
- `pesagem_pedagio`: ANTT PPV (federais). Balanças estaduais só agora.
- `pontes_sp_estado_municipio` e `altura_sinalizacao`: padrão DER-SP (OAE_DBO, Sinalizacao_Vertical) para comparar.

## MG — o melhor estado (dados vivos e abertos)
Servidor ArcGIS público do Observatório da Infraestrutura (SEINFRA/DER-MG):
`https://observatorio.infraestrutura.mg.gov.br/server/rest/services` (ArcGIS 11.4, consulta anônima).

| Camada | Registros | O que traz | Teste |
|---|---|---|---|
| `00_PUBLICACOES/pontos_criticos_publico/FeatureServer/0` | 833 (459 ativos) | interdições/meia-pista/OAE danificada, `trafegabilidade` (inclui código 4 "Pista interrompida para veículos pesados"), `limite_carga`, causas, variante, prazo | 200; última edição 09/10/2026 18:42 UTC; 5 ativos com pista interrompida, 19 meia-pista |
| `00_PUBLICACOES/pontos_criticos_variantes/FeatureServer/0` | 9 | traçado das variantes (desvios) | 200 |
| `Hosted/pontes_20_05_2025/FeatureServer/0` | 4.370 | cadastro de OAEs DER-MG: tipo, extensão, largura, estrutura, código SRE | 200; 3.352 pontes, 217 viadutos, 66 passarelas, 7 túneis, 8 madeira; 1.021 com largura < 5,5 m (405 < 4 m) |
| `Hosted/Pontes/FeatureServer/0` | 1.456 | inspeção: `condestrut`, `conddurabi` (0,2,3,4; escala não documentada), `qtdfaixas`, `larguratot`, `alturatota` (altura da estrutura, não gabarito) | 200; 277 de 1 faixa |
| `00_PUBLICACOES/pracas_pesagem/FeatureServer/2` e `Hosted/Balancas_V2/FeatureServer/0` | 52 / 57 | balanças com lat/lon e status | 200; V2 editada em 03/2025 |
| `Hosted/sremg_2026_02/FeatureServer/0` (`ano='202602'`) | 3.647 trechos, 43.163 km | SRE com km SRE e marco km, `sitfis` PAV/DUP/IMP/LEN, `resp` (DER, concessionária, DNIT, município), VMD | 200; MG-010 km 12,4 bate com a portaria |
| item "Ocorrências significativas" | — | licença declarada "Dados de uso restrito DER-MG" | NÃO usar |

Licença: o portal não declara licença (licenseInfo vazio). O site der.mg.gov.br ("Aspectos legais") permite reutilizar conteúdo "desde que identificada a fonte e atribuído o crédito".

Site DER-MG:
- `/transportes/pracas-de-pesagem`: tabela de 43 postos em operação (URG, rodovia, km, município, 24 h/Estratégica). 37 casados com coordenada do ArcGIS (`mg/der_mg_balancas_site_geocod.geojson`); 6 sem par.
- `/transportes/localizacao-de-radares-fixos-e-portateis`: 710 radares com velocidade regulamentada (bônus para `trafego_tempo`).
- Portarias 2026 em PDF: `/institucional/legislacao/portarias/507-legislacao/portarias/4268-portarias-2026`.

Regras (fonte primária):
- **Portaria DER-MG 4.242, de 06/02/2026** (publicada em 07/02/2026), PDF `https://www.der.mg.gov.br/files/2692/Ano-de-2026/36720/Portaria-nº-4242.pdf`. Texto em `mg/portaria_4242_2026.txt`, janelas em `mg/portaria_4242_2026_anexo_I.csv`.
- **Portaria DER-MG 4.262, de 26/06/2026** (DOE-MG 27/06/2026), AET. Lida no LegisWeb (cópia secundária); revoga a 3.902/2021. Art. 45: AET circula do amanhecer ao pôr do sol. Art. 36 §2º III: 24 h se largura ≤ 3,00 m, comprimento ≤ 20 m e altura ≤ 4,40 m. Art. 3º §2º: proibido iniciar viagem com chuva, neblina ou fumaça.
- Cerca de 24.132 km de estadual de pista simples pavimentada (DER + concessionárias, SRE 2026_02) entram no art. 1º §1º.

## RJ — pouco dado
- dadosabertos.rj.gov.br (CKAN), org `der`: "Sinalização Vertical" (PDDL), mas é **agregado por rodovia** (43 linhas: unidades, m², custo), não inventário. "Situação da Rede Estadual" (PDF de 30/11/2024: km DUP/PAV/IMP/LEN/PLA por RJ). "Condições das Rodovias" Regional I e III (CSV, 2025). "Fluxo de veículos e autuação 2024". Todos PDDL, sem geometria.
- INEA ArcGIS `geoportal.inea.rj.gov.br/server/rest/services/MAREM`: BC25 (IBGE/SEA 2018). `gln_rod_trecho_rodoviario_25` com 182.819 trechos e `sigla` RJ-xxx, mas jurisdição sem "Estadual". `gpt_tra_ponte_25` com 7.387 pontos: `cargasupor` e `vaovertica` = 0 em 100%, 337 de madeira.
- DER-RJ site (ASP, notícias paradas em 09/2024): AET via `derrj.sider.softplan.com.br/portalaet/`. RJ-127 (Paracambi–Mendes): pesados proibidos desde 09/2024 (pare-e-siga só para leves, 5–10 h e 17–24 h). Status em 2026 **não confirmado**.
- Não achei portaria de feriado do DER-RJ, inventário de OAE, nem lista de balanças. A busca citou balanças em postos fiscais da SEFAZ (Nhangapi, Levy Gasparian, Morro do Coco), mas o PDF da SEFAZ devolveu HTML (não confirmado).
- CEPERJ: 24 datasets, nenhum de malha viária.

## ES
- DER-ES "Rede Rodoviária" (KML, out/2025, zip de 11 MB): 895 trechos e 9.719 km, com SRE, sigla, km inicial e final, `SIT` (PAV/DUP/LEN/PLA/EOP) e `RELEVO`. É a mesma base do WFS GEOBASES `geonode:der_rodovias_es_epsg_31984` (894 feições; licença "Not Specified"). Amostra em `es/sre_es060_es010_es477.geojson`.
- Atos em der.es.gov.br/legislacao-2 (PDF, texto extraído em `es/*.txt`):
  - Lei 4.463/1990: Rodovia do Sol, proíbe carga com mais de 2 eixos ou PBT > 15 t.
  - IS 011-N/2003 e IS 021-N/2004: Terceira Ponte.
  - IS 009-N/2008: ES-010, proíbe PBT > 23 t entre o Portal de Aracruz e o trevo de Santa Cruz (revoga a IS 006-N/2006).
  - Res. CA 0778/2005: AET para 45–57 t.
  - IS 001-N/2014: AET.
  - IS 007-N/2018: interdição da ES-177, km 14.
  - IS 019-N/2011: é imagem escaneada; não fiz OCR.
- Notícia de 23/01/2024 (Semobi/DER-ES; atos no DIO-ES de 24/01/2024, número não confirmado): PBT > 23 t proibido na ES-060, km 33 a 39 (Village do Sol–Setiba), e no trecho "ES-477" da antiga praça até a ES-388. Esse "ES-477" não bate com a ES-477 do SRE, que fica perto de Castelo.
- PDA DER-ES 2024: só bases administrativas. Nenhuma malha, OAE, interdição ou balança prevista.
- dados.es.gov.br: 8 datasets do DER-ES, todos administrativos. "Pontes Rurais" (SEAG, CC0) cobre estradas vicinais.

## OSM e Valhalla (PBF local de 09/10/2026, osmium; Valhalla local)
- Ways com hgv/maxweight em rodovia estadual: MG 3, MGC 0, LMG 2, RJ 129 (116 na Linha Vermelha), ES 84.
- Terceira Ponte: só `hgv:conditional=yes @ (...)`, sem `hgv=no` de base, em 10 de 14 ways; `maxweight=15` em 4. Valhalla desvia um caminhão de 25 t, 3 eixos (Praia do Canto → Praia da Costa: 19,4 km pela Segunda Ponte e a Florentino Avidos; carro 6,2 km pela Terceira Ponte).
- ES-060 "José Ribeiro Tristão": `hgv=no` + `maxweight=15` em 25 ways (é a regra da lei de 1990, não a de 23 t de 2024). Uma rota de 40 t, Vila Velha → Guarapari, não toca o trecho do SRE no km 31,9–39,8 (0 de 2.461 pontos a menos de 30 m). Faz 94 km contra 42 de carro.
