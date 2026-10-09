# Verificação cética — restricoes_sp_capital (09/10/2026)

Objeto: conferir /Users/arthurleuzzi/Downloads/truck-router/docs/research/restricoes_sp_capital/research.json.
Todas as URLs abaixo foram baixadas de novo nesta pasta (curl, UA de navegador). Nada foi copiado da pasta do agente original,
exceto consulta pontual a arquivos dele para descobrir links (IDs de My Maps, dicionário da OD).

## Re-testes de URL (HTTP, tamanho)
- Catálogo Portaria 137/18: 200, 74.343 B. Alterações listadas: 154/2018, 49/2021, 57/2021. Anexo II = 57 trechos (I–LVII).
- PDF CET p-137_18: 200, 828.240 B, 20 p. Contagem VER: §1 26, §2 4, §3 9, §4 40 (=79). OK.
- Portaria 49/2021: 200, 23.024 B. §5 (Marginal Tietê, todas as pistas, 2 sentidos) SEM janela horária; art. 38-A libera origem/destino SP;
  parágrafo único mantém proibição para quem tem AETC 2ª–6ª 05–21h e sáb 10–14h (redação ambígua). Vigência: conclusão do Rodoanel Norte.
- Portaria 57/2021: 200, 22.059 B. Só troca art. 18 §1º I para 2,50 m (considerandos citam veículos não poluentes/baterias, mas o texto vale para todo VUC).
- Decreto 56.920/16 (saopaulo.sp.leg.br): 200, 13.816 B. Art. 7º cria Programa de Entrega Noturna.
- Decreto 58.584/18 (PDF CET): 200, 290.389 B. Art. 1º janelas/dígitos; art. 2º §1º "inclusive seus limites"; §2º caminhões podem circular nas vias do Minianel;
  art. 3º VIII l) perecíveis, m) VUC; IX a) elétrico/hidrogênio/híbrido. Dec. 58.604/19 só altera isenção PcD.
- Portaria 051/2024 (PDF CET): 200, 232.599 B, 5 p. Também no catálogo (200). Art. 3º 07–10h e 17–20h no Minianel (Anexo IV, 13 vias) e área interna;
  grupos III/IV liberados na área interna, não nas vias do Minianel. Revoga Port. 100/2016-DSV.
- Portaria 024/12 (PDF CET): 200, 126.416 B, 12 p. Continua listada na página de legislação da CET.
- CET resumo/ZMRC/ZERC/FAQ/rodízio/zona azul/superdimensionados/fiscalização: todas 200.
  * Página "como funciona" do rodízio NÃO fala de VUC; a isenção do VUC cadastrado está na FAQ ("liberados do Rodízio, desde que cadastrados").
  * Página excecoes.aspx da CET ainda traz VUC 2,20 m (confirmado).
  * FAQ: multa R-9 R$ 130,16, média, 4 pontos; "fora do horário não precisa cadastro"; Zona Azul Caminhão 1 CAD = 30 min; carga/descarga em ZA com CAD ativo.
  * Página ZERC: fiscalização por radares com LAP.
- Suspensões (webforms.cetsp.com.br/suspensaorodizio/Relatorio?year=): 200 para 2024, 2025, 2026, 1997. Linhas com data: 2024=14, 2025=13, 2026=15
  (inclui linhas que atravessam o ano). Em 2024–2026 TODAS as suspensões não-feriado foram "MANTIDO para pesados/ZMRC" (7/7, 7/7, 9/9).
  Feriados: base Dec. 37.085/1997 e Dec. 49.800/2008 (citados na tabela).
- OD Cargas CSV: 200, 6.093.486 B, 12.424 linhas, 3.001 empresas. TIPO_VEIC_MOV: 2=34,6%, 3=23,6%, 5=10,2%, 1=10,0%, 4=8,9%, 9=5,3% (código 9 NÃO existe
  no dicionário), 6=5,1%, vazio=2,0%, 7=0,2%, 8=0,1%. Amostra bruta (não expandida). Página diz que o resultado "será de domínio público".
- GeoSampa WFS hits: zona_azul 4.595; vaga_especial 6.734; faixa_onibus 7.378; corredor_onibus 45; classificacao_viaria_cet 210.754; obra_arte 6.548;
  equipamento_feira_livre 975; controle_uso_via_publica_geoinfra 1.902; acidente_cet 5.716; perimetro_zona_lei_18081_24 61.692 (ZER* = 2.979);
  zmrc/mian/zmrf 1 cada. zona_azul: 775 trechos c/ caminhão, 2.806 vagas, fretamento 23/149, auto 56.357, dt_carga 2026-10-03.
  vaga_especial CA 816 pontos / 2.521 vagas, todos in_rotativo=S, dt_carga 2025-06-07. Feiras: tx_horario_funcionamento nulo em 975/975.
  Áreas (aprox. planar): ZMRC 100,7 km², MIAN 151,3 km², ZMRF 75,0 km² (dt_carga 2018-02-14). GetCapabilities: nenhuma camada ZERC/VER.
- Licença GeoSampa: 200; CC-BY-SA 4.0 (SEI 6066.2020/0003044-4); a página diz que os dados NÃO são domínio público.
- CET classvias.zip: HEAD 200, 29.935.581 B, Last-Modified 22/12/2025. gpkg 210.740 feições (LOCAL 133.264, COLETORA 50.471, ARTERIAL 21.767,
  VIA DE PEDESTRES 4.151, RODOVIA 653, VTR 429, nulo 5). Só o gpkg veio no zip.
- shapesMiniAnel.zip: 200, 13.412 B (arquivos de 12/02/2019). shapesZMRC/VER/ZMRF/Caminhao: 404.
- My Maps KML (forcekml=1): Caminhão 1 = 25 linhas/105,0 km; Caminhão 2 = 30/154,6 km; Caminhão 3 = 13/69,4 km; ZMRF 61 linhas.
  CORREÇÃO: Vd. 9 de Julho, Vd. Jacareí, R. Maria Paula, Sen. Queirós, Ipiranga, São Luiz e Dona Paulina ESTÃO no KML (placemark "Rótula", 3 linhas).
  Faltam de fato: Av. Cidade Jardim e Av. Santos Dumont (§1), Melo Freire, Conde de Frontin, Gen. Edgar Facó, Bresser, Taquari, Gazeta do Ipiranga,
  Pte. Tatuapé, São Miguel/Mal. Tito/Beraldo Marcondes/Pça. Aleixo Mafra. Rótulo "Rio Branco/Rudge Ramos" confirmado.
- Fiscalização eletrônica CET: 200; só link para app.powerbi.com.
- CTB (Planalto): 200, 788 KB. Anexo I CAMINHÃO > 3.500 kg (Lei 14.440/2022); CAMINHONETE ≤ 3.500 kg; art. 184 I leve, III gravíssima + remoção;
  art. 187 I média; art. 258 III média = R$ 130,16. Lei 9.610 art. 8º IV confirmado.
- Valhalla master: pbfgraphparser.cc (200, 236.257 B) linhas 2609–2675 hgv:conditional → kTimedDenied/kTimedAllowed.
  dynamiccost.h EvaluateRestrictions: com current_time==0 (sem date_time) as restrições temporais são IGNORADAS.
  src/mjolnir/timeparsing.cc: feriado (PH/SH) é ignorado ou a regra é descartada → "exceto feriados" não cabe no grafo.
- CONTRAN: Res. 1.005/2024 (gov.br, 200) altera Res. 882/21: caminhão-trator + semirreboque até 19,30 m.
- Querido Diário: hoje responde 200; São Paulo (3550308) está indexado (level 1) mas só 20 edições (29/01/2025 a 24/03/2025). Inútil para monitorar.
- DOC SP oficial: https://diariooficial.prefeitura.sp.gov.br/md_epubli_controlador.php?acao=inicio (200), com pesquisa de matérias e clipping. Não automatizado.
- Rodoanel: matéria Mobilidade Sampa 200 (publicada 2026-06-29T01:43Z, datada 28/06/2026: trecho final 68%, entrega 2º sem./2026).
  Via Appia "De olho na obra" (WebFetch): previsão 2º semestre/2026, sem percentual. Liberação até 09/10/2026 NÃO confirmada (cota de WebSearch esgotada).

## OSM: município x bbox (osmium 1.15 no PBF local, relação r298285, IBGE 3550308)
Comandos (em volume Docker `verif_osm`, porque /private/tmp não é montado no Colima):
  osmium extract -b -46.83,-24.01,-46.36,-23.35 sudeste-latest.osm.pbf -o bbox.pbf -s smart
  (ids das ways outer de r298285) → osmium getid -r ... ; osmium merge ... -o boundary.osm
  osmium extract -p boundary.osm bbox.pbf -o sp_mun.pbf -s complete_ways
  osmium tags-filter hw.pbf w/<tag> -R ; osmium fileinfo -e -g data.count.ways
| tag | bbox (o que o agente reportou) | município (polígono) |
|---|---|---|
| highway ways | 285.230 | 174.617 |
| hgv=no | 346 | 201 |
| hgv:conditional | 6 | 6 |
| hgv=destination | 13 | 12 |
| motor_vehicle:conditional | 160 | 141 |
| maxweight | 23 | 18 |
| maxheight | 978 | 594 |
| maxlength | 11 | 1 |
| hazmat | 35 | 0 |
| highway=busway | 1.035 | 583 |
Os 6 hgv:conditional já trazem janelas VER (Marginal Tietê expressa 05–09/17–21 e duas vias 05–21).
motor_vehicle:conditional no município: 49 ways "Su 09:00-17:00" (Paulista/ruas abertas), 72 "Mo-Fr 00:00-07:00,20:00-24:00; Sa,Su,PH", vários de feira (We 05:00-16:00 etc.).
Polígono do município salvo em osm_sp_boundary.geojson.

## Extra
- Portaria DSV.GAB 022/92 (CET, 200): R-9 com "Exceto Veículos Autorizados" (sem horário) libera serviços públicos, mudanças e entrega/retirada
  com nota fiscal → semântica de hgv=delivery/destination. Portaria DSV.G 018/96: guincho liberado em R-9.
- Seed do projeto (db/seed/0002_zones.sql): Mini-Anel com "exceptions": [] (confirma que o VUC não é isento); config/zmrc-rules.json isenta is_vuc sem exigir AETC.
