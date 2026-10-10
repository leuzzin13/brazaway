# Concessões rodoviárias estaduais/municipais de RJ, MG e ES: praças, tarifas por eixo e balanças (10/10/2026)

Pasta: esta. Repo lido em modo somente leitura (seeds `db/seed/layers/pedagio__*.sql`, `balancas__antt.sql`, PBF
`data/valhalla/sudeste-latest.osm.pbf`). API local (porta 3000) e Valhalla (8002) consultados só com GET/POST de rota.

## 0. O que já existia (não refeito)
- `docs/research/pesagem_pedagio` + `_verify`: ANTT (CKAN praças, PPV, tarifas HTML), ARTESP, DER-SP, OSM `charge`,
  Valhalla (`exclude_tolls`, sem preço), leis (Lei 13.103 art. 17, Lei 7.408, CTB 209/209-A, Lei 10.209). Reaproveitado.
- Camadas `pedagio` (fontes antt/artesp/osm) e `balancas` (antt_ppv/artesp/dersp) já cobrem as FEDERAIS de RJ/MG/ES
  (ANTT: 231 pontos; PPV: RJ 7, MG 7, ES 4). Fora de SP, praça estadual só entra pela reserva OSM ("estimado").
- `superficie_pavimento`: IDE-Sisema/DER-MG WFS `ide_0401_mg_rodovias_lin` (reusado aqui para rodovia+km).
- `rodovias_restricoes`: DER-MG portaria de feriados (outra frente).

## 1. Inventário OSM (PBF local de 08/10/2026) — scripts `osm_extract.py`, `osm_state.py`, `osm_node_way.py`
- RJ/MG/ES: 227 nós toll_booth/gantry; 81 são de concessões estaduais/municipais (ES: 0).
- Por operador (nós / praças agrupadas a 700 m / nós em via `toll=yes`):
  EPR Sul de Minas 14/7/2; EPR Triângulo 12/6/0; EPR Vias do Café 12/6/0; EcoVias NorteMinas 12/6/12;
  Nascentes das Gerais 10/5/10 + "Appia Via Nascentes" 2/1/2; Rota 116 8/4/4; LAMSA 4/1/0; ViaRio 4/2/2;
  CCR ViaLagos 2/1/0; CRP Concessionaria 1/1/1. Saída: `osm_toll_nodes_rj_mg_es.csv`.
- Só 33 de 81 nós estaduais/municipais ficam em via `toll=yes` → `exclude_tolls` do Valhalla não evita as praças da
  EPR (Triângulo, Vias do Café, Sul de Minas), ViaLagos e Linha Amarela. Confirmado na API: alternativa "mesmos_pontos".
- Balanças OSM (weighbridge) RJ/MG/ES: 14 nós, quase sem atributos (mesma conclusão de antes: baixo valor).

## 2. RJ — AGETRANSP (estaduais) — fonte primária HTML + PDF
- Só 2 rodovias estaduais concedidas: **CCR ViaLagos (RJ-124)** e **Rota 116 (RJ-116)**
  (`https://www.agetransp.rj.gov.br/operadoras/vialagos`, `/operadoras/rota116`; tabelas em HTML, cobrança desde 01/08/2025).
- ViaLagos: Deliberação AGETRANSP/CD 1630/2025 (29/07/2025): TBP R$ 18,3712 → praticada 18,40; TBA 30,6187 → 30,60.
  Multiplicadores padrão (moto 0,5; 2e dupla 2; 3e dupla 3; ...; 6e dupla 6). 5 eixos: R$ 92,00 (útil) / R$ 153,00 (TBA).
  Janela TBA (Motiva, notícia 07/2025): sexta 12h → segunda 12h e 12h da véspera → 12h do dia seguinte a feriado nacional.
  PDF: `rj/delib_1630_vialagos.pdf`.
- Rota 116: Deliberação 1631/2025: TBP R$ 9,60. **Estrutura não linear**: 3 a 6 eixos rodagem dupla = 4 x TBP (R$ 38,40);
  7 eixos = 7x (67,20); 8 eixos = 8x (76,80, PDF de evolução). Rodagem simples 2–4 eixos = 1x. Motos isentas.
  4 praças (Itaboraí, Cachoeiras de Macacu, Nova Friburgo, Cordeiro), cobrança bidirecional. Site: "Tarifas válidas até 31/07/2026".
  Contrato 08/2001 prorrogado pelo 6º Termo Aditivo (Deliberação 1790 de 16/06/2026 cita a Cláusula Quarta que fixa a
  metodologia de reajuste; ciência à Fundação DER-RJ). `rj/rota116_evolucao_tarifas.pdf` (2018–2025).
- Reajuste de agosto/2026 NÃO localizado: páginas AGETRANSP ainda mostram 01/08/2025; deliberações online vão até
  nº 1816 (25/06/2026) (sondagem 1684–1950 por URL `.../deliberacoes/numero/N/visualizar`; títulos em `rj/delib2026_titulos.txt`).
- Lista de deliberações é POST com CSRF; GET por número funciona.
- Municipais do Rio (Prefeitura): Linha Amarela/LAMSA (tabela 18/04/2026 em imagem `rj_municipal/lamsa_2026.jpg`;
  não linear: 2e dupla 6,00; 3e 13,30; 4e 14,50; 5e 16,10; 6e 20,10; 7+ 24,10) e Transolímpica/ViaRio (03/05/2026:
  5e 39,80; 6e 49,75; 7e 59,70; site Motiva bloqueia curl com "Requisição recusada", WebFetch funcionou).

## 3. MG — ARTEMIG (criada pela Lei Estadual 25.235/2025; assumiu a regulação antes da SEINFRA)
- Páginas por concessão em `https://artemig.mg.gov.br/artemig/<lote>/` (ficha, contrato, PER, aditivos, tarifas e praças
  em IMAGEM). Imagens baixadas em `mg/img/`. Contratos vigentes: `infraestrutura.mg.gov.br/ppp/contratos-vigentes/`.
- Concessões com cobrança: Lote 1 Triângulo (EPR, R$ 14,00/eixo, até 21/10/2026, 8 praças), Lote 2 Sul de Minas
  (EPR, R$ 10,10, 8 praças + free flow MG-459 Monte Sião), Lote 3 Varginha-Furnas (EPR Vias do Café, R$ 15,80 desde
  26/07/2026, 6 praças), MG-050 (Via Nascentes, R$ 9,10 desde 13/06/2026, 6 praças), BR-135/LMG-754 (Ecovias Norte Minas,
  R$ 10,60, 6 praças). Todas com multiplicador = nº de eixos (rodagem dupla) e eixo adicional = TBP.
- Lote 2: Deliberação ARTEMIG 41/2026 (25/09) subiria para R$ 10,60 em 09/10/2026; TCE-MG suspendeu em 07/10/2026;
  ARTEMIG publicou em 09/10/2026 que suspendeu a aplicação. Tarifa vigente = 10,10.
- Free flow MG: só EPR Sul de Minas (MG-459, Monte Sião, desde 04/06/2024), pagamento em até 30 dias; transição sem multa
  até 16/11/2026 (notícia ARTEMIG 15/06/2026). Lote 7 Via Liberdade (contrato 2026): 4 pórticos previstos, cobrança não iniciada.
- "Rota das Grutas" (pista) é concessão de PARQUES (Peter Lund), não rodovia. "MGO" e "Via Sul" são federais/outros estados.
- CRP Concessionária (MGC-393, Pirapetinga): concessão municipal, cobrança suspensa judicialmente (MPMG, 13/10/2025), mas
  site e OSM (2026-05-13) mostram tarifa: situação incerta.
- Posicionar praça por rodovia+km pela malha DER-MG (IDE-Sisema) dá deslocamento sistemático de 4–8 km (MG-050 ~7 km,
  BR-135 ~4,4 km, CMG-491 ~4 km): o km da concessão ≠ km do SRE. `mg_pracas_oficiais.py` → `mg_pracas_oficiais_posicionadas.csv`.
- OSM x oficial MG: valores por eixo conferem em todas as 5; erros pontuais: 1 nó de Azurita com 6.10/hgv/axle, 1 nó de
  Nepomuceno com 15.90. Faltam no OSM: Lote 1 P6 ("LMG-190", código inexistente na malha DER-MG) e P8 (MG-427 km 15,
  Água Comprida); Lote 2 P8 (MG-459 km 6,4) e o pórtico free flow de Monte Sião.
- Balanças DER-MG: 49 estaduais, decisão TJMG mantida pelo STF obriga ≥ 50% operando (notícia 04/03/2026); nenhuma lista
  aberta com localização. PERs dos lotes só exigem "estudo de implantação" e pesagem móvel. Lote 7: balança BR-356 km 62,3.

## 4. ES — ARSP
- Pedágio estadual (Rodosol: Terceira Ponte e Rodovia do Sol/ES-060) encerrado em 22/12/2023; ARSP lista a última
  tabela "1º/01/2023 até 21/12/2023" (`https://arsp.es.gov.br/tarifas-infraestrutura`). OSM sem nós Rodosol (correto).
  Só há pedágio federal (Ecovias Capixaba, já na camada).

## 5. Teste na API local (carreta_5e, `api_tests/run.py`, JSON salvos)
| Caso | App (OSM) | Oficial | Erro |
|---|---|---|---|
| ViaLagos quarta 10h | R$ 153,00 (30,60 x 5) | R$ 92,00 (TBP) | +66% (o OSM tem `Mo-Fr 18.40BRL/hgv` sem `/axle`; `tollCost` cai no valor de fim de semana) |
| ViaLagos sexta 15h | R$ 153,00 | R$ 153,00 (TBA desde sexta 12h) | ok por acaso |
| Rota 116 Itaboraí→Friburgo | R$ 128,00 (12,80 x 5 x 2) | R$ 76,80 (38,40 x 2) | +67% |
| Transolímpica | R$ 49,75 | R$ 39,80 | +25% |
| Sul de Minas (2 praças) | R$ 101,00 | R$ 101,00 | ok |
| Triângulo (2 praças) | R$ 140,00 | R$ 140,00 | ok (mas "estimado") |
| MG-050 / BR-135 | 45,50 / 53,00 | 45,50 / 53,00 | ok |
Nome da praça ViaLagos sai como o texto da tag `note` ("Preço: R$ 18,40 ...").

## 6. Licenças
- Atos oficiais (deliberações AGETRANSP/ARTEMIG): Lei 9.610/1998 art. 8º IV (não protegidos). Sites: AGETRANSP sem
  licença declarada; ARTEMIG/SEINFRA "Todos os direitos reservados"; LAMSA "Todos os direitos reservados".
- Lei 8.987/1995 art. 9º §5º (Lei 13.673/2018): concessionária deve publicar tabela de tarifas e evolução de 5 anos.
- OSM ODbL 1.0. IDE-Sisema: "acesso ao dado é livre" (ver superficie_pavimento).

## 7. Arquivos
`tarifas_estaduais_oficiais.json` (amostra estruturada p/ importador), `osm_toll_nodes_rj_mg_es.csv`,
`mg_pracas_oficiais_posicionadas.csv`, `rj/` (páginas e PDFs AGETRANSP/Rota 116), `rj_municipal/`, `mg/` (ARTEMIG,
SEINFRA, PERs, imagens), `es/`, `api_tests/`.
