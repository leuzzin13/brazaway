# bh_capital — restrições de caminhões em Belo Horizonte e RMBH (pesquisa 10/10/2026)

Repo somente leitura. Nada foi escrito no banco nem no repo. WebSearch esgotou o orçamento da sessão no fim; o resto foi
feito com curl/python.

## Fontes testadas (o que respondeu)

| Fonte | Teste | Resultado |
|---|---|---|
| API do DOM-BH `https://api-dom.pbh.gov.br/api/v1/edicoes/atos/pesquisar` (achada no JS do SPA dom-web; `env.json` dá `VUE_APP_URL_API`) | GET com `termo`, `pesquisa_exata`, `documentos[]=A|AA`, `local_pesquisa[]=T|C`, `paginacao={"pagina":1,"itens_por_pagina":50}` | 200, JSON (Elasticsearch). Indexa de 1996 a hoje (atos legados inclusive). `data_inicio`/`data_fim` deram 400 (formato não descoberto) — paginar por data. Texto do ato: `/api/v1/edicoes/atos/{id}/publicado` (campo `conteudo_html`). Scripts: `dom_search.py`, `dom_s2.py`, `dom_ato.py`. |
| Portaria BHTRANS DPR 138/2009 (id 199503), 077/2014 (293524), 004/2019 (375340), 139/2013 (276691, revogada) | texto completo | `ato_*.txt` |
| Página BHTrans "Áreas de carga, descarga e com restrições" (atualizada 07/10/2021) | 200 | tabela de horários + 18 corredores; `bhtrans_areas.txt` |
| Mapa BHTrans `mapa-restricao-cd-55ton-portal.pdf` (CorelDRAW, 14/02/2019) | 200, 176.922 B, 1 p., vetorial | 5 polígonos laranja (Área Central), 11 linhas vermelhas (corredores), 5 azuis (tobogã), verde (N. Sra. do Carmo), 904 contornos de quadra. `mapa_bh-1.png` |
| Página DTLP (atualizada 03/09/2026) | 200 | ainda cita 138/2009 e 077/2014 como vigentes; posto 24 h na BR-356 (Ponteio) |
| Lei 12.016/2026 (id 483485) | texto | revoga a Lei 7.648/1999 (Anexo I: leis com declaração de inconstitucionalidade) |
| Lei 7.794/1999 (id 58857) | texto | N. Sra. do Carmo, > 2 t, 7–20h; NÃO achei revogação no DOM |
| BHMap WFS `https://bhmap.pbh.gov.br/v2/api/idebhgeo/wfs` | GetCapabilities 200 (354 camadas); GetFeature GeoJSON EPSG:4326 OK | `CIRCULACAO_VIARIA` 231.028; `CLASSIFICACAO_VIARIA_11181` 54.784; `LOGRADOURO_OBRA_DE_ARTE` 507; `ESTACIONAMENTO_ROTATIVO_SEGUNDA_SEXTA` 882. **Nenhuma camada de restrição de caminhão nem de vaga de carga e descarga.** `geoservicos.pbh.gov.br/geoserver/wfs` tem 752 camadas (mesmas + outros workspaces), idem. |
| CKAN `dados.pbh.gov.br` | package_search/show 200 | `rede-prioritaria-onibus` (711 trechos: 150 pista exclusiva, 354 faixa exclusiva, 207 preferencial; sem horário), `estacionamento_rotativo` (1.103 faces; sem tipo carga/descarga), `fiscalizacao-eletronica` (447 equipamentos; 20 no Anel, 18 a 70 km/h; sem DTLP), `circulacao-viaria2`. Licença cc-by. CSV com WKT EPSG:31983. |
| PBH notícias Anel (03/06/2025, 18/03/2026) e release PDF (15/05/2026) | 200 | municipalização 22,4 km; placas R-9 faixa esquerda; Betânia faixas 1 e 2 |
| Querido Diário API | Contagem 4.239 diários, Betim 3.524, Nova Lima 0; buscas dão 500/503 intermitente (repetir) | Betim Lei 5.797/2014; Contagem Req. 497/2026 |
| OSM (PBF Sudeste local, pyosmium, bbox RMBH) | 101.719 vias | BH: 0 `hgv:conditional`, 11 `hgv=no` (1 km), 0 regra da Área Central; Anel com `maxspeed`/`maxspeed:hgv` 80 em ~22 km (radares da PBH: 70) |

## Georreferenciamento expedito do mapa (georef/)
- `extrai_mapa.py` (PyMuPDF) -> `mapa_paths.json`.
- Corredores do mapa são **esquemáticos** (encurtados): pontas não servem de ponto de controle (afim com 10 pontas deu RMS 1,1 km — descartado).
- `georef_bh2.py`: similaridade por 3 pontos (Afonso Pena x Amazonas, Praça Raul Soares, Praça da Liberdade) + ICP (13.815 vértices de quadra x 15.802 nós OSM). Mediana 13 m (canto de quadra x eixo, esperado), p90 22 m; checagem Praça Sete 10 m, Raul Soares 28 m, Liberdade 39 m (rótulo x centróide).
- `bh_area_central_georref.geojson`: Área Central 7,47 km² (polígono único). Ruas internas >90% dentro; Sapucaí/Aarão Reis (Floresta/Praça da Estação) fora; Av. do Contorno 21% dentro (usar recuo de 20 m, como Osasco). Geometria derivada do OSM (ODbL) pelo ICP.

## Armadilhas
- "Capacidade de carga" (lotação) ≠ PBT. O app só tem `weight_t` (PBT).
- Fontes secundárias erram: PlanetaCaminhão diz 7h–21h (portaria: 7h–20h); notícia de 2018 diz 5 t (desde 2019: 5,5 t).
- O "Decreto 11.178/2010" que um resumo de busca atribuiu a Betim é de **Campo Grande/MS** (benchmark da Política de Logística Urbana de BH, p. ~2455 do texto).
- A Lei 7.648/1999 (BH) foi revogada em 2026; a Lei 5.797/2014 de Betim é cópia dela.
