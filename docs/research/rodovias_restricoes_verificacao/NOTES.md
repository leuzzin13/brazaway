# Verificação cética: rodovias_restricoes (09/10/2026)

Pasta de trabalho: `research/rodovias_restricoes_verificacao/`. Downloads: SNV 202607A.zip (68,5 MB), PMV ARTESP 2025 (49 MB), marcos km ARTESP (1,7 MB), CONTRAN 882 PDF (1,8 MB), resto pequeno. PMV 2026 só por HEAD e Range.

## Confirmado na fonte primária
- DOU, Portaria DIOP/PRF 121/2026 (HTTP 200, 105 kB, DOU 09/09/2026, ed. 170-A extra). Limites 2,60/4,40/19,80/58,5 t. §1º CVC/CTV/CTVP mesmo com AET/AE. §2º pista simples, exceto AC/AM/AP/PA/RR. §5º SP Aparecida BR-116 km 0–231, BR-459 km 0–32, BR-488 km 0–5. Revoga a 26/2026.
- Cadeia de revogação: 12/2026 (DOU 02/02) revoga 172/2025; 26/2026 (DOU 09/03, URL .../prf-n-26-de-6-de-marco-de-2026-691165658) revoga 12/2026; 121/2026 revoga 26/2026. A 121 acrescentou as janelas de Eleições.
- 30 janelas nacionais e 190 h (28×6 h + 2×11 h). Tiradentes, Finados e 15/11 fora da tabela.
- SUP/DER-084/2023 (Anchieta km 40–55), PR/DER-228/2025, PR/DER-127/2026 (revoga a 228), PR/DER-147/2025, PR/DER-164/2025, SUP/DER-037/2024 (SP-148), PR/DER-145/2025 (SP-215), SUP/DER-062/2024 (SP-324), SUP/DER-001/2024 (Tamoios). Todas lidas pela API do DOE-SP (`/v2/publications/<slug>`). A API não devolve nada antes de 2023.
- Ecovias: o curl leva 403. Pelo navegador embutido, o FAQ confirma a Portaria ARTESP 11/2002 de 06/12/2002 e as regras do comboio. O status ao vivo mostrou "restrição de pesados" na Imigrantes km 62→40 sentido SP e "operação comboio" na Anchieta km 31–40 sentido litoral (snapshot em ecovias_condicoes_verif_2026-10-09.txt).
- PMV ARTESP 2025: 257.495 linhas, CC BY. AutoBAn "Operação Caminhão": 375 mensagens em 50 dias, 317 em domingos (bate exatamente).
- Release Motiva AutoBAn (Páscoa 2026): sexta 03/04 e domingo 05/04, 14h–22h, Bandeirantes → Anhanguera do km 48 ao 23, saída 48.
- DNIT Portaria 4.447/2026: BR-135/MA km 24,40–24,90; 04/09 16–22h, 05/09 07–12h, 07/09 12–18h; cita a Res. DNIT 11/2022 e a Portaria DIOP/PRF 26/2026.
- OSM (PBF local, timestamp 2026-10-08): 53 ways com conditional de caminhão no Sudeste; 6 com hgv:conditional no bbox; 16 com hgv:lanes; SP-160 com 24 hgv=no e 22 hazmat=no; Rodoanel Norte com 115 ways motorway e opening_date=2025-12-22.
- Valhalla local: truck Santos→SP 67,3 km pela Anchieta; truck SP→Santos 71,3 km pela Anchieta; auto usa a Imigrantes (reproduzido).

## Corrigido
- Padrão PRF: não é "dia do feriado 06–12h". É véspera do feriadão 16–22h, primeiro dia do feriadão 06–12h e último dia 16–22h. Exemplos: Independência 05/09 (sábado), Aparecida 10/10 (sábado). O Carnaval tem 4 janelas (inclui quarta de Cinzas 06–12h).
- SNV: as contagens "RMSP" (BR-116 187,7 km, BR-381 58,6 km) vêm do bbox RMSP+Baixada (-47,40 -24,20 -45,60 -23,10), não da RMSP. Com os 39 municípios do IBGE (malha API v3) dão cerca de 119 km de BR-116 DUP e 42 km de BR-381 DUP. A conclusão (0 km de pista simples federal na RMSP) se mantém. O total de 58.024 km soma em dobro os trechos coincidentes. Deduplicando por ds_coinc ficam cerca de 52.819 km (SP: 417 km em vez de 450).
- CONTRAN 882/2021: o texto oficial existe em https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-contran/resolucoes/Resolucao8822021.pdf (PDF 1,76 MB) e no DOU https://www.in.gov.br/web/dou/-/resolucao-contran-n-882-de-13-de-dezembro-de-2021-370017699. Art. 18: CVC com mais de 2 unidades e PBTC >57 t ou comprimento >19,80 m precisa de AET. Art. 19: até 74 t e até 30 m. Art. 20: do amanhecer ao pôr do sol, 80 km/h, diuturno em pista dupla com separador. O valor de 58,5 t é outro limite: PBTC de cavalo + semirreboque de 4 eixos (tandem triplo + distanciado) com 17,5 m ou mais. Não há divergência.
- OSM: no bbox são 697 ways com `*:conditional` (osmium tags-filter -R), não 194.
- ARTESP malha-rodoviaria: 25 recursos, não 24.
- Link da ARTESP 11/2002: devolve HTML de cerca de 114 kB (página do portal), não 1.053 bytes. Continua sem PDF.

## Não verificável ou dependente de regex
- "5.799 mensagens de restrição de pesados em 339 dias" e "25.063 mensagens sobre caminhão ou operação": dependem do regex. Os meus deram 5.840 mensagens/306 dias (Ecovias, proibição ou restrição + pesado ou caminhão), 7.411/347 dias (qualquer concessionária, pesado ou caminhão + Anchieta) e 22.097 (caminh|pesad|operação|comboio).
- Abertura efetiva do Rodoanel Norte em 23/12/2025: a fonte é uma notícia de 18/12 que só anunciava a data. O OSM tem opening_date 2025-12-22. Não há fonte primária.
- Horário das restrições de Aparecida em SP: a tabela do DOU não traz hora. O CSV do pesquisador assumiu 00h–24h.

## Riscos de interpretação
- §1º da Portaria 121 ("abrange CVC, CTV e CTVP, ainda que autorizadas por AET/AE"): a leitura literal pode incluir qualquer CVC, até o bitrem de 7 eixos com 57 t e até 19,80 m, que já é CVC. A recomendação "Bitrem dentro de 19,80 m e 58,5 t não é afetado" é uma interpretação e não está confirmada. O DER-MG cita bitrens expressamente.
- A página da PRF 2026 ainda cita a Portaria 26/2026 no texto, enquanto o anexo já é da 121/2026. Vale o DOU.
- Página do DNIT (PNV/SNV) sob CC BY-ND 3.0 (rodapé gov.br). Se isso valer para os dados, derivados ficam proibidos. Confirmar com o DNIT.
- PMV 2026: o arquivo foi atualizado em 21/08/2026 e as amostras vão até 20/08. Hoje (09/10) o atraso é de cerca de 7 semanas, não 1 mês.

## Comandos principais
- DOU: `curl -sSL -A Mozilla/5.0 <url>`; busca: `python3 dou_search.py '"PORTARIA DIOP/PRF Nº 26"'`.
- SNV: `curl -u "oTpPRmYs5AAdiNr:" ".../public.php/webdav/SNV%20Bases%20Geom%c3%a9tricas%20(2013-Atual)%20(SHP)/202607A.zip"`; parse do DBF em Python; RMSP com shapely e IBGE `api/v3/malhas/estados/35?intrarregiao=municipio` (script snv_rmsp.py).
- DOE-SP: `https://do-api-web-search.doe.sp.gov.br/v2/advanced-search/publications?Terms[0]=...&FromDate=...` e `/v2/publications/<slug>`.
- osmium no Docker (debian:bookworm-slim) montando data/valhalla.
