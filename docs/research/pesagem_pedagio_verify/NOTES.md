# Verificação cética: pesagem_pedagio (09/10/2026)

Re-testei com curl/python3/osmium (imagem local osmq-img com osmium 1.15) e Valhalla local (3.9.1). Arquivos baixados nesta pasta.

## O que mudou em relação ao relatório original
1. **Tabela ARTESP 2026 EXISTE em fonte primária** (o relatório dizia que não):
   - Notícia ARTESP 29/06/2026 "Revisão tarifária anual das rodovias concedidas entra em vigor em 1º de julho" (reajuste 4,72% IPCA; Tamoios 5,08% provisório; Entrevias em 06/07).
     https://www.artesp.sp.gov.br/artesp/noticias/revisao+tarifaria+anual+das+rodovias+concedidas+entra+em+vigor+em+1+de+julho
   - PDF 01/07/2026 (4 p., 80 KB, 136 linhas, PASSEIO = COMERCIAL POR EIXO em todas; Perus R$ 14,50 = OSM): artesp/tarifas_2026_0107.pdf
     https://admin.cms.sp.gov.br/dx/api/dam/v1/collections/c65c8bbb-34b7-45e5-8e68-23f626d5293a/items/15f70220-8ead-4e26-9334-1ab21443ec97/renditions/663c7fe6-a19b-4847-bdf9-b731b3a6339b?binary=true
   - PDF Entrevias 06/07/2026 (CAT-1..9, Manual/AVI): artesp/tarifas_2026_entrevias.pdf
     https://admin.cms.sp.gov.br/dx/api/dam/v1/collections/c65c8bbb-34b7-45e5-8e68-23f626d5293a/items/95b34aa8-0ea4-469b-a98c-ed0b3cc6cb75/renditions/0f8c3d94-07d3-4aeb-8f79-9ed922b5972d?binary=true
   - O link "Valor Atual das Tarifas" da página de pedágios ainda aponta para o PDF de 2025 (por isso a confusão).
2. **Site www.artesp.sp.gov.br respondeu 200 ao curl** (UA padrão, UA do projeto e Mozilla): não reproduzi o bloqueio Imperva.
3. **Licenças**: páginas gov.br (ANTT tarifas, free flow) têm rodapé "Creative Commons Atribuição-SemDerivações 3.0" (CC BY-ND 3.0), não "sem licença". Portais cms.sp.gov.br (ARTESP, DER-SP) dizem "Todos os direitos reservados ... não podem ser reproduzidos ... sem permissão expressa". CKAN ANTT e CKAN ARTESP malha = CC-BY (confirmado).
4. **Operação PPV**: OPERACAO_PPV-2026_1 (jan/2026) e 2026_2 (fev/2026) TÊM dados (1.054 e 952 linhas); só 2026_3 e 2026_4 vêm vazios. Arquivos são mensais (34 postos x dias). Jan/26: média 66%; Miracatu 68%, Itapecerica 67%, Guararema 95%, Queluz 94%. Fev/26: média 66%; Miracatu 66%, Itapecerica 59%, Guararema 99%, Queluz 73%. Out/25 (arquivo 2025_12) bate: 73%, 98/96/55/37%.
5. **SIFAMA 2026**: total 121.554 evasões e 4.638 SP batem, mas as linhas de evasão só cobrem JAN–ABR/2026; mai–set só tem excesso de peso (16 autos no total).
6. **ANTT praças**: 93 linhas com "free flow" no nome (inclui 4 "FREEFLOW" da EPR Iguaçu), logo 184 físicas, não 89/188. 73 SP, 62 na bbox, 51 FF da Dutra, 32 coords com 2 casas: confirmados. O KMZ do dataset é de 30/01/2024 (defasado).
7. **KMZ ARTESP**: 23 KMZ somam ~82 MB (não 170 MB; 170 MB é com os KML extraídos). Contagens com a bbox do relatório (lat -24,10..-23,15; lon -47,25..-45,65): praças 187 (49), PGF 47 (16) [relatório: 48], PPM 75 (6), free flow 29 (Rota Sorocabana), cargas excepcionais 71 (19), perigosos 47 (16), TCP 213. A bbox inclui Baixada Santista, Jundiaí, Atibaia, Itu: não é "Grande SP" estrita. l29 precisa remover atributo py:pytype; l26 "SP Serra" contém "LOTE RODOANEL NORTE" (confirmado). Em l11 os PGF têm nome "PPM ..." (inconsistência).
8. **DER-SP peso oficial**: o PDF é "TABELA OFICIAL DE PESO 2018 - ATUALIZADO 2-2018" (criado 2019), 127 p., 7,6 MB. Defasado.
9. **Lei 7.408 art. 1º §1º** (Lei 14.229/2021): veículos/combinações com PBT regulamentar ≤ 50 t são fiscalizados só pelo PBT/PBTC (sem checagem por eixo), salvo casos do Contran. Lei 13.103 art. 17: redação vigente é da Lei 13.711/2018 (conversão da MP 833).
10. **QualP tem API**: https://api.qualp.com.br/ (planos a partir de R$ 390/mês para 1.000 consultas; lista "Pedágios" e "Balanças de Pesagem"). qualp.com.br/api dá 404 (confirmado), mas a API existe noutro host.
11. Google Routes API tem modo TRUCK (vehicleInfo com dimensões, peso, reboque, hazmat), mas sem número de eixos; tollPasses só DRIVE/TWO_WHEELER.

## Confirmado sem ressalvas
- ANTT tarifas HTML: RIOSP P1 Arujá 4,50 / cat 7 (5 eixos, dupla) 22,50; colunas FDS em P8–P10 (Rio-Santos); Régis até 6 eixos (25,80); Fernão Dias até 8 eixos; datas 29/08/2025, 05/01/2026, 12/05/2026; CKAN "tarifa" = 0 resultados.
- PPV: 45 (37 fixo, 7 HS-WIM, 1 móvel); SP 4 (Itapecerica, Miracatu, Guararema, Queluz).
- ARTESP 2025: 136 linhas, PASSEIO = COMERCIAL POR EIXO em 100%; ViaPaulista CAT-1..9, AVI ~5% menor; histórico com COBRANÇA/TARIFA UNI/BIDIRECIONAL.
- OSM (PBF local de 08/10/2026): 592 toll_booth, 118 toll_gantry, 125 na bbox; 687 com charge BRL; 671 com BRL/hgv/axle; 509 com check_date 2026; 1 typo "hgva"; 15 gantries sem charge; weighbridge 59 nós (12 bbox) + 27 ways.
- Valhalla: Lapa→Jundiaí 5 eixos: padrão 48,8 km/48 min com pedágio; use_tolls=0 48,9 km/53 min ainda com pedágio; exclude_tolls e toll_booth_penalty=1800: 59,8 km/96 min sem pedágio. trace_attributes: 52 edges toll (20,6 km), 1 node toll_booth.
- Leis no planalto: CTB 209 (grave), 209-A (grave, Lei 14.157/2021), 231 V (média + valor por 200 kg); Lei 10.209 art. 1º §1º (pedágio a cargo do embarcador).
- Free flow ANTT: 9 trechos, 52 pórticos; Dutra 10 pórticos (Deliberação ANTT 467/2025; texto diz km 205–230, lista vai a km 231,3); 30 dias sem TAG; Deliberação 277/2026 suspende multas por 200 dias, tarifa continua devida.
- DER-SP pontos: 136 (34 FIXO, 102 MÓVEL), sem coordenadas.
- PRF: infrações_2025.zip = 318M (aviso do Drive). infrações_2026.zip = 185M.
- VPO: 75 linhas, 04/2025–10/2026, 100% "Tag" (inclusive 2025; o dataset só tem esse modelo).

## Comandos principais
- CKAN: curl "https://dados.antt.gov.br/api/3/action/package_show?id=<id>" ; package_search?q=tarifa
- ARTESP CKAN: curl "https://dadosabertos.artesp.sp.gov.br/api/3/action/package_show?id=malha-rodoviaria"
- osmium: docker run --rm -v .../data/valhalla:/data:ro osmq-img osmium tags-filter ... | osmium export -f geojsonseq -o - (o volume /private/tmp não é montado no Colima; usei stdout)
- Valhalla: valhalla/teste.py
