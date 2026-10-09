# Produtos perigosos (PP): regras e restrições de rota (pesquisa de 09/10/2026, rodadas 1 e 2)

Pasta: `research/carga_perigosa/`. Tudo abaixo foi testado com curl, python, osmium ou GDAL, exceto o que estiver marcado como "não confirmado".
A lista estruturada de regras e trechos está em `regras_trechos_carga_perigosa.json` (20 itens, cada um com status). A rodada 1 está preservada em `NOTES_rodada1_backup.md`.

## 1. Resumo para decisão
- **Não existe regra federal de rota para PP no RTPP atual.** A Res. ANTT 5.998/2022 está vigente desde 01/06/2023, com alterações das Res. 6.016/2023 e 6.056/2024; esta última vale desde 27/02/2025. Ela regula veículo, documentos, condutor e multas: valores no art. 42, infrações no art. 43. Nenhuma das infrações do art. 43 trata de itinerário.
  - Quem restringe rota e horário é o órgão com circunscrição sobre a via (CTB arts. 21 e 24): prefeitura, DER, ARTESP, ANTT/PRF.
  - O art. 38 da Res. 5.998 só autoriza essas autoridades a fiscalizar.
  - A infração por circular fora de local ou horário permitido é a do CTB art. 187, I (média).
  - **Correção da rodada 1:** antes eu tinha escrito que o "art. 38" dava a competência de rota.
- **Regra principal na Grande SP:** Portaria SMT.GAB 051/2024. Proíbe PP de seg a sex, exceto feriados, das **07–10h e 17–20h**, nas vias do minianel (Anexo IV) e no centro expandido.
  - Os grupos III (consumo local) e IV (outros) podem circular o dia todo **dentro** do centro expandido, mas **nunca nas vias do minianel** durante as janelas.
  - **Novo:** dentro da ZMRC/ZERC vale ainda a Portaria 137/2018 art. 35. PP só entra das 10h às 16h, com AETC, em caminhão de até 2 eixos traseiros e só nos grupos "consumo local" e "outros". A AETC exige cópia da LETPP.
- **A LETPP é obrigatória por veículo em todo o município de SP, 24h** (Decreto 50.446/2009, alterado pelo Decreto 60.169/2021, que exige a TAG Brasil-ID). A isenção por quantidade limitada não vale para a LETPP.
- **Isenção por quantidade limitada** (Res. 5.998, Parte 3, itens 3.4.2.6 e 3.4.3.4): abaixo da coluna 8 da Relação, a carga fica livre de "limitações quanto a itinerário, estacionamento e locais de carga e descarga".
  - **Novo:** a Relação inteira foi parseada, com 2.336 nº ONU. Distribuição do limite por veículo:

    | Limite por veículo | Nº ONU |
    |---|---|
    | 333 kg | 1.006 |
    | 20 kg | 762 |
    | 1.000 kg | 343 |
    | ZERO (sem isenção) | 137 |
    | ILIMITADA | 62 |

  - Exemplos: gasolina (1203) 333 kg; diesel (1202) 1.000 kg; GLP (1075) 333 kg; cloro (1017) 20 kg.
- **Trechos estaduais proibidos para PP, com fonte primária:**
  - **SP-008 (Rod. Arão Sahm), km 25+280 a 31+500, Mairiporã, na RMSP (NOVO).** Fonte: Portaria PR/DER-164/2025, DOE de 08/10/2025. Vale 24h e também proíbe carga com C>14 m. A portaria cita como motivo os "recursos hídricos". O trecho tem 6,1 km e está **100% dentro da APRM Alto Juquery**: geometria em `sp008_km25_31_trecho.geojson`.
  - **SP-324, km 86+620 a 90+700** (Portaria SUP/DER-062/2024), fora da RMSP.
  - Nenhum dos dois aparece no OSM.
- **Imigrantes (SP-160), serra:**
  - Na **descida**, todos os caminhões, vans e ônibus são proibidos pela Portaria ARTESP DGR/DPL-11/2002, citada no FAQ oficial da Ecovias. Isso cobre PP por tabela. Os pesados trocam para a Anchieta na Interligação (km 40).
  - Na **subida**, a proibição específica de PP **não foi confirmada**. O OSM marca hgv=no e hazmat=no nas duas pistas. O FAQ da Ecovias dá a entender que pesados sobem e cita "tráfego de veículos tanto leves quanto pesados".
  - Isso interfere no roteamento de caminhão em geral: o Valhalla hoje manda o caminhão subir pela Anchieta.
- **Mananciais:**
  - Não há proibição geral de PP nas APRM: as leis das APRM não trazem nada e as portarias DER/ARTESP encontradas também não.
  - Existe **uma proibição pontual motivada por água**, a SP-008 descrita acima.
  - A CETESB registrou 110 emergências químicas de transporte rodoviário dentro das 4 bacias entre 2014 e 2026, sendo 55 no Rodoanel. A base vai até **06/10/2026**, ou seja, é atualizada em poucos dias.
  - → Tratar como aviso ou penalidade, mais os bloqueios pontuais que tiverem portaria.
- **Túneis:** não encontrei proibição específica de PP na capital nem no Rodoanel. O RTPP não tem categorias de túnel no estilo ADR.
  - A revisão do RTPP em 2026 (AP ANTT 7/2026) também não tem: a minuta de 78 páginas não menciona itinerário, rota, túnel nem estacionamento.
  - O Rodoanel Norte terá 7 túneis (cerca de 11 km) e 4 baias para PP, segundo o relatório da ARTESP de 2024.
- **OSM quase não tem dados de PP.**
  - Brasil: 73 ways com `hazmat` (lista completa em `overpass_br_hazmat_ways.json`). 37 estão na serra da Imigrantes. Os outros 36 são ruído: 30 vias de pedestre em Brasília, 7 `hazmat=yes` na BA-148 e 3 acessos a hospital na BA.
  - Não há nenhum `hazmat:water` nem `hazmat:A–E`.
  - **Hoje o checkbox "Carga perigosa" do app não muda nenhuma rota**: o teste no Valhalla deu rota idêntica.
- **Outros municípios da RMSP:** Guarulhos declara oficialmente que **não tem** legislação municipal de PP (Plano de Riscos Tecnológicos 2024). Para Santo André, São Bernardo, Mauá, Diadema, Osasco e Barueri a busca web não achou regra municipal de rota para PP. Não confirmado.

## 2. Fontes testadas

### 2.1 Normas (fonte primária)
| Fonte | URL | Teste |
|---|---|---|
| Portaria SMT.GAB 051/2024 (PMSP) | https://cetsp.com.br/media/1592296/portaria-051-24.pdf | HTTP 200, 232 KB. Anexos com os nº ONU em `sp_portaria_smt_051_2024_grupos_onu.csv` |
| Página CET "Transporte de produtos perigosos" | https://www.cetsp.com.br/consultas/transporte-de-produtos-perigosos.aspx | HTTP 200, 37 KB (`cet_produtos_perigosos.html`). Remete à 051/2024, ao Decreto 50.446 consolidado e à Portaria 54/SVMA/2009 (PAE) |
| Portaria 137/2018-SMT.GAB (VER/ZMRC/ZERC), arts. 5, 18 e 35 | texto em `research/legislacao_limites/pdf/p-137_18.txt` (tema irmão) | Lido. Art. 35 = regra de PP na ZMRC |
| Lei municipal 11.368/1993; Decretos 50.446/2009 e 60.169/2021 | legislacao.prefeitura.sp.gov.br | HTTP 200 |
| FAQ PMSP de 2019 | prefeitura.sp.gov.br/.../perguntasfrequentesprodutosperigosos_1566334708.pdf | HTTP 200. Cita a Portaria 100/2016, já revogada |
| Página SMUT | prefeitura.sp.gov.br/web/mobilidade/... | **Desatualizada**: cita a Portaria 21/2013 |
| Res. ANTT 5.998/2022 compilada | anttlegis (link na rodada 1) | HTTP 200. Arts. 20, 38, 39, 42 e 43 lidos |
| Relação de Produtos Perigosos (anexo) | https://anexosportal.datalegis.net/arquivos/1774888.pdf | HTTP 200, 125 p. **Parse completo** em `antt_relacao_produtos_perigosos_parse_completo.csv` (veja a lista abaixo) |
| Partes 1, 3 e 7 da Res. 5.998 | anexosportal.datalegis.net 1774868, 1774878, 1774884 | HTTP 200 |
| **AP ANTT 7/2026** (revisão do RTPP para o Orange Book 23ª ed.) | aviso: anttlegis `tipo=AUD&numeroAto=00000007&valorAno=2026`; notícia: gov.br/antt/.../antt-abre-audiencia-publica-para-revisar-regulamento-do-transporte-rodoviario-de-produtos-perigosos | HTTP 200. Aviso no DOU de 08/05/2026; contribuições de 15/05 a 28/06/2026; 38 participantes e 117 contribuições. Minuta, Nota Técnica 4006/2026 e relatório baixados em `antt_ap007_2026/` (veja a nota abaixo) |
| Decreto 96.044/1988 | Planalto (rodada 1) e https://legis.senado.leg.br/norma/518684 | HTTP 200. Vigência explicada abaixo |
| Res. CONTRAN 1.020/2025 e Portaria SENATRAN 923/2025 | https://www.gov.br/transportes/pt-br/assuntos/transito/arquivos-senatran/portarias/2025/Portaria9232025.pdf | HTTP 200, 258 KB. Curso especializado de PP com 50 h. Que a Res. 1.020 acabou com a renovação de 5 anos do MOPP veio só de fonte secundária (SETCESP, 10/03/2026) |
| **DOE-SP, busca "produtos perigosos" 2020–2026** | API `https://do-api-web-search.doe.sp.gov.br/v2/advanced-search/publications?Terms[0]=produtos perigosos&...` (`doe_sp/doe_search_der.py`) | HTTP 200, 2.364 publicações (o acervo útil começa em 2023). Os achados do DER estão abaixo |
| Portaria SUP/DER-062/2024 (SP-324) | setcesp.org.br/.../Portaria-SUP_DER-062.2024.pdf | HTTP 200 |
| **Portaria PR/DER-164/2025 (SP-008)** | https://doe.sp.gov.br/executivo/secretaria-de-meio-ambiente-infraestrutura-e-logistica/portaria-pr-der-164-2025-202510071132192141389342 | HTTP 200. Texto também em `research/rodovias_restricoes/doe_sp/` |
| Portaria ARTESP DGR/DPL-11/2002 (Imigrantes) | FAQ: https://www.ecoviasimigrantes.com.br/atendimento/duvidas | curl e WebFetch: 403 (WAF). Pelo navegador embutido: OK. O link da portaria no site da ARTESP está quebrado (tema `rodovias_restricoes`) |
| **DNIT IN 5/2023 (STRPP)** | gov.br/dnit/.../instrucao-normativa-05-2023-...pdf | HTTP 200, 356 KB. Art. 5: declaração anual de 1º dia útil a 30/09. Art. 6: dispensas (mesmo município, municípios conurbados, item 3.4.3, classe 7, OLUC, logística reversa). Os dados declarados não são públicos (login) |
| Res. ANTT 6.000/2022 (concessões), arts. 188 e 234 | anttlegis `RES 00006000/2022` | HTTP 200. O art. 188 dá à ANTT a decisão sobre restrição contínua por "cargas especiais e perigosas" em rodovia federal concedida. O art. 234 revogou a Res. 1.713/2006 (PP na Ponte Rio–Niterói) após 1 ano |
| Res. ANTT 1.713/2006 (Ponte Rio–Niterói) | anttlegis `RES 00001713/2006` | HTTP 200, marcada como **Revogada**. Não achei o ato que a substituiu |
| Guarulhos, Plano de Riscos Tecnológicos 2024 | guarulhos.sp.gov.br/.../PLANO MUNICIPAL DE RISCOS TECNOLÓGICOS DE GUARULHOS - 2024.pdf | HTTP 200, 817 KB, 80 p. Na tabela de PP: "Legislação Municipal Pertinente: Não há" |
| Portaria SUP/DER-058/2011; página DER "Autorização de Circulação" | (rodada 1) | HTTP 200. Sem lista de trechos |

**Achados do DOE-SP na busca acima:**
- Normas do DER sobre PP: **só duas proibições de trecho** desde 2023, a SUP/DER-062/2024 e a PR/DER-164/2025.
- PR/DER-030/2025: tabela de códigos das infrações do RTPP no DER-SP, vigente desde 27/02/2025.
- PR/DER-015/2025: cita o Decreto 96.044 como vigente.
- Relatório ARTESP 2024: o Rodoanel Norte terá 4 baias para PP.

**Relação de Produtos Perigosos, parse completo:**
- Colunas extraídas:
  - nº ONU;
  - nome;
  - classe (col. 3);
  - risco subsidiário (col. 4);
  - nº de risco (col. 5);
  - grupo de embalagem (col. 6);
  - provisões especiais (col. 7);
  - qtd. limitada por veículo (col. 8);
  - qtd. limitada por embalagem interna (col. 9);
  - `qtd_limitada_veiculo_min`, que guarda o valor mais restritivo.
- O CSV antigo `antt_relacao_produtos_perigosos_onu_classe.csv` fica substituído.
- Itens marcados: 13 "NAO_SUJEITO?" e 1 "TRANSPORTE_PROIBIDO?" (1798, ácido nitroclorídrico).

**AP ANTT 7/2026:**
- O ParticipANTT tem API JSON aberta:
  - lista de eventos: `/api/ManterEvento?...`;
  - anexos: `/api/ManterEvento/Documentacao/AnexoProposta?CodProposta=1504`;
  - download: `https://participanttfile.srvs.antt.gov.br/file-api/ManageFile/Download/PropostaNorma/FileContent/{id}`.
- **A minuta não traz regra de rota.** Ela traz novos nº ONU (3551, 3552, 3556–3558), baterias de sódio, veículos elétricos e a instrução de embalagem P912.

**Decreto 96.044/1988, vigência:**
- O Senado registra só a alteração do art. 7 pelo Decreto 4.097/2002, sem revogação.
- Seguem citando o decreto como vigente: DER-SP em 2025, DNIT em 2023 (art. 10) e ANTT (a Res. 1.713/2006 se baseava nos arts. 11 e 13).
- → Vigência **provável** dos arts. 9–14 sobre itinerário e estacionamento. Confirmar com o jurídico.
- legislacao.presidencia.gov.br e planalto d4097: conexão resetada.

### 2.2 Dados geográficos e estatísticos
| Fonte | Acesso | Teste / contagem |
|---|---|---|
| **CETESB, Emergências Químicas 2014–2026** (DataGEO) | WFS `https://datageo.ambiente.sp.gov.br/geoserver/datageo/wfs`, camadas `datageo:VWM_ACIDENTES_AMBIENTAIS_CETESB_{ano}_PTO` | HTTP 200. Detalhes logo abaixo da tabela |
| CETESB SIEQ | HTML | **Falhou**: casca vazia de 2.472 bytes |
| **CETESB ArcGIS, Malha Rodoviária Estadual** (km inicial e final por trecho) | `https://arcgis.cetesb.sp.gov.br/server/rest/services/Hosted/Malha_Rodovi%C3%A1ria_Estadual_SP/FeatureServer/0/query?where=rodovia like '%008%'&f=geojson` | HTTP 200, 41 trechos da SP-008 (`cetesb_malha_sp008.geojson`). Usada para georreferenciar portarias DER por km. Licença não declarada |
| Limites das bacias/APRM (DataGEO) e mananciais GeoSampa | WFS | HTTP 200. Arquivos em `mananciais/` e `geosampa_manancial_*.geojson` |
| **ARTESP, Paradas de PP** (KMZ `malha-rodoviaria`, CKAN, CC-BY) | parse do tema `pesagem_pedagio` | 47 paradas no estado, 16 na bbox da Grande SP (detalhe abaixo). Arquivo: `artesp_paradas_produtos_perigosos.csv` |
| OSM local (`sudeste-latest`) | osmium (`osm/run*.sh`) | Detalhe abaixo da tabela |
| OSM Brasil | Overpass `overpass-api.de` | HTTP 200, 46 KB, 73 ways (veja o §1). Na rodada 1, a lista falhou por timeout. Agora foi OK |
| Valhalla 3.9.1 | binário e teste local | `hazmat` booleano; não lê `hazmat:conditional`. Rota Jabaquara→Santos idêntica com e sem hazmat |
| IBAMA SIEMA (WFS) | — | **Falhou**: 301 e depois 404 |
| IBAMA AATIPP (CSV por UF e ano) | `dadosabertos.ibama.gov.br/dados/AATIPP/...` | HTTP 200. SP 2025 tem 341 MB (só amostra). Serve para dimensionar o mercado, não para rota |
| ARTESP e ANTT, acidentes | CKAN CC-BY | Sem campo de PP |
| dadosabertos.sp.gov.br / dados.antt.gov.br | CKAN | 0 datasets de "produtos perigosos" |
| DNIT STRPP (rotas declaradas) | `servicos.dnit.gov.br/cargasperigosas` | 307 para o login. **Não público** (pedir via LAI) |
| Portal LETPP `letpp.moovii.com.br` | — | DNS não resolve |
| Normas do DER anteriores a 2023 | `200.144.30.104/der/portarias/webportarias/` | 403 na listagem. Sem índice |

**CETESB, Emergências Químicas:**
- 4.103 registros, dos quais 2.349 são de transporte rodoviário e 502 desses na RMSP.
- A camada de 2026 vai até 06/10/2026: atualização quase contínua.
- Produtos nos registros de transporte: diesel 686, etanol/álcool cerca de 510, ácidos 166, gasolina 111, soda 40, GLP 38, hipoclorito 32.
- Cuidado: "diesel" inclui vazamento do tanque do próprio veículo.

**ARTESP, Paradas de PP na bbox da Grande SP (16):**

| Concessão | Paradas |
|---|---|
| SPMar (Rodoanel Sul/Leste) | 12 |
| Rodoanel Oeste | 3 |
| Ecovias | 1 |

**OSM local (`sudeste-latest`):**
- `hazmat`: 37 ways, todas na SP-160 serra, mais as paradas "designated".
- SP-008 Arão Sahm está presente: ref=SP-008, cerca de 25 km. Nenhuma tag de restrição.
- Túneis na RMSP: 218 ways.
- **Novo:** `osm_vias_minianel_buffer45m.geojson` traz 1.005 ways a até 45 m do contorno do MIAN, com ≥70% do comprimento dentro do buffer, total de 152 km de pistas. É candidata para a regra dos grupos III/IV (vias do minianel); **revisar** ruídos como R. Pirajá. ODbL.

## 3. Comandos de teste usados
```bash
# DOE-SP: atos com "produtos perigosos" (2020–2026), filtra DER/ARTESP
python3 doe_sp/doe_search_der.py "produtos perigosos"
python3 doe_sp/doe_fetch_slug.py executivo/secretaria-de-meio-ambiente-infraestrutura-e-logistica/<slug>
# CETESB malha estadual por km (georreferenciar portaria DER)
curl -G "https://arcgis.cetesb.sp.gov.br/server/rest/services/Hosted/Malha_Rodovi%C3%A1ria_Estadual_SP/FeatureServer/0/query" \
  --data-urlencode "where=rodovia like '%008%'" --data-urlencode "outFields=*" --data-urlencode "f=geojson" --data-urlencode "outSR=4326"
# ParticipANTT (AP 7/2026)
curl "https://participantt.antt.gov.br/api/ManterEvento?ordering=ano&page=0&pageSize=50&codigoSituacao=3&codigoAno=2026&codigoTipoEvento=1"
curl "https://participantt.antt.gov.br/api/eventos/662/propostas"
curl "https://participantt.antt.gov.br/api/ManterEvento/Documentacao/AnexoProposta?CodProposta=1504"
curl -o minuta.pdf "https://participanttfile.srvs.antt.gov.br/file-api/ManageFile/Download/PropostaNorma/FileContent/7555"
# Relação de PP (todas as colunas)
../venv/bin/python parse_relacao.py   # pdfplumber, colunas por posição x do cabeçalho (1)…(10)
# OSM: SP-008 e rodovias (osmq-img; montar volume em ~/.cache, /private/tmp não monta no Colima)
docker run --rm -v .../data/valhalla:/data:ro -v ~/.cache/truck-research-carga:/out osmq-img:latest sh /out/run4.sh
# Overpass Brasil
curl -A "truck-router-mvp/0.1" -H "Accept: application/json" --data-urlencode "data@q_br_list2.ql" https://overpass-api.de/api/interpreter
# (rodada 1) WFS CETESB, osmium hazmat, Valhalla hazmat true/false, mananciais/analise.py
```

## 4. Como integrar no app
1. **Perfil do veículo:** trocar o booleano `hazmat` por `{ativo, onu[], classes[], qtd_por_onu_kg, granel, letpp_sp, entrega_consumo_local, eixos_traseiros}`.
   - O backend calcula `isento_qtd_limitada` comparando a quantidade com a `qtd_limitada_veiculo_min` de cada ONU. Vale o menor valor entre os produtos; ZERO quer dizer que nunca há isenção.
   - O grupo SP (I–IV) sai de `sp_portaria_smt_051_2024_grupos_onu.csv` mais o flag de consumo local.
   - Carregar a Relação ANTT numa tabela `un_dangerous_goods`, com versão. A AP 7/2026 vai acrescentar nº ONU.
2. **Tabela `hazmat_rules`** no PostGIS, separada do OSM. Campos: `id, jurisdicao, escopo (zona_interior | vias_limite | trecho | zona_autorizacao), geom, janelas jsonb, feriados_liberado, grupos_sp[], max_eixos_traseiros, requer_aetc, isencao_qtd_limitada, fonte_norma, url, status_verificacao, verificado_em`. Seed a partir de `regras_trechos_carga_perigosa.json`:
   - SP capital, grupos I/II: polígono MIAN **com buffer para fora** (30–50 m), seg–sex 07–10h e 17–20h.
   - SP capital, grupos III/IV: só as vias do minianel. Usar `osm_vias_minianel_buffer45m.geojson` revisado, com buffer de 15–25 m, nas mesmas janelas.
   - ZMRC/ZERC: PP só das 10h às 16h, grupos III/IV, ≤2 eixos traseiros e AETC no perfil. Fora disso, aplicar a janela da ZMRC.
   - SP-008 km 25,28–31,5 e SP-324 km 86,6–90,7: bloqueio 24h por `exclude_polygons` (buffer de cerca de 15 m em volta de `sp008_km25_31_trecho.geojson`). Para georreferenciar novas portarias DER por km, usar a malha CETESB.
3. **Roteamento:** avaliar as regras no horário estimado de chegada, como já se faz com ZMRC/MIAN.
   - Atenção: `exclude_polygons` corta também as vias que cruzam o trecho. Usar buffer estreito e conferir os viadutos.
   - Manter `hazmat:true` no Valhalla, mas sem contar com ele.
4. **Mananciais:** não bloquear. Avisar quantos km da rota ficam em APRM e oferecer uma alternativa sem bacia. A exceção é a SP-008, que é bloqueio de verdade.
5. **Paradas e descanso:** importar as 47 paradas de PP da ARTESP como POI "parada recomendada para PP". Marcar como não recomendados para PP os `rest_stops` dentro de bacia ou de área densa (Decreto 96.044, art. 14).
6. **Camada de risco:** `hazmat_incidents` a partir do WFS CETESB, com atualização semanal, já que a base acompanha os dias. Heatmap e alerta nos trechos com mais registros.
7. **Compliance:**
   - Alerta de LETPP ao entrar no município de SP.
   - Multas: RTPP (art. 42) e CTB 187, I quando a rota viola uma restrição.
   - MOPP no perfil do condutor (curso de 50 h; sem renovação desde a Res. CONTRAN 1.020/2025, conferir).
   - **Ideia de produto:** exportar os fluxos anuais (origem, destino, classe, quantidade) para o expedidor declarar no **STRPP do DNIT até 30/09**. Viagens dentro do mesmo município ou entre municípios conurbados são dispensadas.
8. **Monitoramento normativo:**
   - Job semanal na API do DOE-SP (termos "produtos perigosos" e "Portaria PR/DER") para pegar novas proibições DER.
   - ParticipANTT e anttlegis para a nova resolução que sai da AP 7/2026.
   - DOU para atos ANTT de restrição contínua (Res. 6.000, art. 188).
9. **Reportes colaborativos `hazmat_ban`:** manter em base separada do OSM. São a principal forma de descobrir restrições municipais da RMSP que não têm dataset.

## 5. Licenças
- Atos oficiais (leis, decretos, portarias, resoluções, DOE, DOU): art. 8º, IV, da Lei 9.610/98. Uso comercial livre, citando a fonte. Os termos de uso da API do DOE-SP e do ParticipANTT não foram localizados; usar com moderação.
- OSM, incluindo `osm_vias_minianel_buffer45m.geojson` e `sp008_osm.geojsonseq`: ODbL. Os reportes ficam fora (já é assim).
- ARTESP CKAN (paradas de PP e acidentes) e ANTT CKAN: CC-BY. IBAMA SIEMA: ODbL. AATIPP: "Other (Open)".
- GeoSampa, DataGEO/CETESB e a malha ArcGIS da CETESB: sem licença explícita por camada (`AccessConstraints NONE`). Atribuir a fonte e confirmar os termos.
- Plano de Guarulhos e FAQ da Ecovias: documentos públicos. Citar como referência, sem redistribuir.

## 6. Lacunas
- **Imigrantes, subida:** é proibido para PP (ou para todos os pesados)? O OSM diz que sim, o FAQ da Ecovias sugere que não. Pedir à ARTESP/Ecovias o texto da Portaria DGR/DPL-11/2002 e as regras vigentes.
- **Portarias DER anteriores a 2023:** sem índice público (403). Pedir ao DER, via SIC/LAI, a lista de portarias vigentes que proíbem PP ou restringem carga por trecho.
- **Ponte Rio–Niterói / Av. Portuária:** a Res. 1.713/2006 foi revogada pela Res. 6.000/2022 e o ato que a substituiu não foi encontrado. Fora do piloto, importa para a expansão.
- Outros municípios da RMSP, exceto Guarulhos: a busca web não achou regra de PP. Não está confirmado que não exista.
- Fim da renovação do MOPP pela Res. CONTRAN 1.020/2025: o texto da resolução não foi baixado (só fonte secundária). A Res. ANTT 5.998 art. 20 ainda fala em curso "vencido".
- A Portaria 137/2018 art. 35 (ZMRC) precisa ser conferida contra alterações posteriores. O tema `restricoes_sp_capital` tem a lista.
- A Relação parseada é a versão de 09/2022. Conferir as alterações da Res. 6.056/2024 nos anexos e a futura resolução da AP 7/2026.
- Dados do STRPP (rotas reais de PP) e da LETPP (frota licenciada) não são públicos. Ambos dependem de LAI.
