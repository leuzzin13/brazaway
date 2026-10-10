# Grande Vitória (ES): restrições de caminhões (chave `vitoria_es`), 10/10/2026

Somente leitura no repositório. Nada foi escrito no repo nem no Postgres, e nenhum teste foi rodado.
As fontes foram testadas com curl e python. Regras estruturadas: `regras_rmgv.json`, no esquema de `data/raw/rmsp/regras.json`.

## Reaproveitado (não refeito)
- `restricoes_rmsp_municipios`: formato `regras.json`, política de zona/via (exclusions × costLines), "origem/destino na zona → avisa", Querido Diário API (testada lá; aqui só conferi a cobertura do ES).
- `rodovias_restricoes`: PRF Portaria DIOP 121/2026 (vale em pista simples federal, inclusive ES) e o importador `prf_feriados` (já trata ES).
- `pontes_federais`: o SIAET já cobre o ES (`siaet_restricoes.py`, UFS inclui `es`), assim como o PROARTE e o `oae_sgo`.
- `osm_qualidade_valhalla`: como o Valhalla lê `hgv:conditional`. Só aceita valor com **um** `@`, ignora qualificadores `weight<`, `axles>` e PH, e lê `maxaxles`.
- `porto_santos_terminais`: modelo de "destino com janela e agendamento".

## Atos primários baixados (texto nesta pasta)
| Município/órgão | Ato | Arquivo |
|---|---|---|
| Vitória | Dec. 16.243/2015 (DOMV 06/03/2015) | D16243.pdf/.txt |
| Vitória | Dec. 16.301/2015 (§4º Berço 909; janela do porto) | D16301.* |
| Vitória | Dec. 16.575/2015 (alínea d: Maruípe/Paulino Muller, PDF escaneado, lido por imagem) | D16575.pdf, d16575-1.png |
| Vitória | Dec. 18.103/2020 (rota do porto; janela só 7–9h) | D18103.* |
| Vitória | Lei 6.490/2005 (carga/descarga no Centro) | L6490.* |
| Vila Velha | Dec. 161/2001 (em vigor, sem remissões) | vv_D1612001.* |
| Serra | Dec. 5.881/2020 compilado (+2.872/2022, 6.056/2024); Dec. 3.312/2018 revogado | serra_D*.txt, serra_dom_2022-05-26.* |
| Estado | Lei 9.602/2010 (Terceira Ponte: >2 eixos OU PBT>15 t, 24h) | LEI96022010.html (UTF-16) |
| DER-ES | IS 001-N, 002-N, 003-N de 23/01/2024 (Rodovia do Sol) e IS 009-N/2023 (insubsistente) | dio_20240124_p40_41.json |
| DER-ES | 21 IS de restrição por PBT em pontes estaduais (2018–2026) | der_es_is_restricoes.csv (parser der_oae2.py) |
| CETURB/ES | Norma Complementar 001/2024 (guarita no km 3,3 sentido norte barra caminhões na Terceira Ponte) | via busca DIO |

## Fontes de dados testadas
- **DIO-ES (busca full-text, Elasticsearch)**: `https://ioes.dio.es.gov.br/busca/busca/buscar/query/{pag}/di:AAAA-MM-DD/df:AAAA-MM-DD/?1=1&q=...` devolve JSON com o texto de cada página.
  - Lista de edições: `/apifront/portal/edicoes/edicoes_from_data/AAAA-MM-DD.json`.
  - Indexa só o Diário do Estado (tipo_edicao 1): nem o DOM da Serra nem as atas municipais.
  - Para "PROIBIR o tráfego" achei 16 páginas e 21 atos do DER-ES. São 3 da Rodovia do Sol, a ES-164/Itapina (2018) e 17 pontes com PBT máximo, código OAE, km e coordenadas SIRGAS.
- **Vitória, atos normativos**: POST em `https://sistemas.vitoria.es.gov.br/atosnormativos/aberto/op/legislacao-buscar.cfm`.
  - Exige cookie de sessão e o header `X-Requested-With`; sem eles, dá 500.
  - PDF em `/atosnormativos/arquivos/AAAA/D{num}.PDF`.
- **Vila Velha, legislação online** (ASP.NET):
  - A busca por número é rápida: `consulta-legislacao.aspx?tipo=6&numero=161&ano=2001&interno=0`.
  - A busca full-text leva cerca de 150 s.
  - Texto em `/Arquivo/Documents/legislacao/html/D1612001.html`.
- **Serra**: `prefeiturasempapel.serra.es.gov.br/Arquivo/Documents/legislacao/html/D{num}{ano}.html` responde 200 (texto compilado). O caminho `/image/*.pdf` virou SPA, e a API `/api/v1/legislation` exige login (400 "sem permissão").
- **Querido Diário**: Vitória (desde 2014-07, 3.769 diários), Vila Velha (desde 2020-08), Serra (desde 2021-01). Cariacica, Viana, Guarapari e Fundão: 0.
- **GeoWeb Vitória** (ArcGIS Hub): `https://gis.vitoria.es.gov.br/arcgis/rest/services/Opendata/HubGeoweb/MapServer`, com geoJSON e maxRecordCount 2000.
  - Camada 32, bairros (Lei 8.611/13): 80 polígonos.
  - Camada 59, hierarquia viária PDU 2018: 9.624 linhas.
  - Camada 73, ZEIU 1 Centro: 1 polígono.
  - Camada 66, endereços: 178.651 pontos.
  - Sem licença declarada ("envie e-mail para geoweb@vitoria.es.gov.br"). Não há camada de restrição de caminhão.
- **GEOBASES/IDE-ES** WFS `https://ide.geobases.es.gov.br/geoserver/ows`, com 670 feature types:
  - `der_rodovias_es_epsg_31984`: 894 segmentos SRE com km_inicial/km_final, atualizado em 20/05/2026.
  - `ijsn_limite_bairro_2020_UTF8`: 1.471 bairros. Vila Velha (92) e Serra (129) presentes; Cariacica, 0.
  - `pdui_rodovias_rmgv` (152) e `pdui_serra_hierarquia_viaria`.
  - Licença não declarada (CSW sem dc:rights útil).
- **dados.es.gov.br** (CKAN): não tem nada sobre restrição.
  - Achei só o "Fluxo de veículos Rodosol" (ARSP, CC-BY), com dados até 2023, quando a concessão acabou, e as séries do DETRAN-ES (CC0).
- **Vports**: REP 2024 (PDF, 64 p.) com portarias, agendamento SGP/CADWeb e pátio regulador só da concessionária; não define janela horária.
- **Vale**: regulamento de Tubarão/Praia Mole 2025 (28 p.), sem regra para caminhão.
- **OSM (Overpass)**: busca de tags de caminhão nos 7 municípios da RMGV (rmgv_hgv.json, 135 elementos) e checagem de nomes de vias (nomes.json).

## Achados no OSM (importantes para o Valhalla)
- A Terceira Ponte tem `hgv:conditional=yes @ (10:00-16:00 AND weight<10); yes @ (22:00-06:00 AND weight<15)` sem `hgv=no` de base. Como o valor tem **dois** `@`, o Valhalla ignora a tag. Sobra só `maxweight=15`, e apenas em 4 ways (48496350, 318855448, 1057658099, 1057658100).
  - Resultado: um caminhão de 3 ou mais eixos com até 15 t atravessa, o que a Lei 9.602/2010 proíbe.
  - Falta `maxaxles=2`. A origem das janelas 10–16h e 22–6h não foi confirmada.
- A ES-060 "Rodovia José Ribeiro Tristão", do km ~51 ao ~65 (Contorno de Guarapari → Meaípe, SRE 060EES0140/0150), está com `hgv=no` + `maxweight=15` em 25 ways.
  - Não achei ato vigente para isso: a IS 009-N/2023 caiu e a Lei 9.602 só proíbe na ponte. É provável que seja tag velha da época da Rodosol, e ela barra todo caminhão.
- As regras vigentes da Rodovia do Sol não estão no OSM: km 33–39 e Acesso 9020, PBT > 23 t.
- A ES-469 "Rod. Dr. Vinícius Barbosa Santos" (Cariacica/Vila Velha) está com `hgv=no` em 9 ways, sem ato encontrado.
- A ponte da Rod. Jones dos Santos Neves (ES-060 acesso 9012, km ~10,5) está com `maxweight=15`, sem ato encontrado.
- Nenhuma regra municipal de Vitória, Vila Velha ou Serra está no OSM, e não há `hgv:conditional` fora da ponte.
- Os nomes das vias citadas nos decretos existem no OSM. É preciso recortar no limite municipal (Av. Central e Av. Guarapari se repetem). "Rua Gaivota" e "Rua Gaivotas" coexistem.

## Lacunas
- Cariacica: o portal de legislação não devolve nada, nem para "trânsito" (busca quebrada), e o município não está no Querido Diário. Segundo A Gazeta (26/01/2022), não há lei municipal. **Não confirmado** em fonte primária.
- Viana, Guarapari e Fundão (restrições municipais): não pesquisado a fundo; nenhum está no Querido Diário.
- Terceira Ponte: não achei o ato das janelas 10–16h (<10 t) e 22–6h (<15 t) que o OSM e a imprensa citam. O PL 475/2020 (isenções) não foi confirmado como lei.
- Feriados municipais de Vila Velha e Serra não levantados. Os de Vitória (Lei 1.732/1967, calendário de 2026) foram conferidos: Paixão, N. Sra. da Penha (13/04/2026), Corpus Christi e N. Sra. da Vitória (08/09).
- Plantas anexas dos decretos da Serra (Anexos I–V) não foram baixadas.
- Vila Velha: a busca por "veículos de carga" deu 12 resultados e eu vi 10 (a paginação é por JS).
