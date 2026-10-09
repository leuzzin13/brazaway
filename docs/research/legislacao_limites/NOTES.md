# Legislação de dimensões, pesos e jornada — validação dos valores "confirmar"

Pesquisa de 09/10/2026. Pasta: `research/legislacao_limites/`. Somente leitura no projeto.
Tabela completa (49 linhas, norma + artigo + URL): `tabela_valores_oficiais.csv`.
Configs propostas (não aplicadas): `proposta/*.json`.

## 1. Pesos e dimensões (federal)

- **A Res. CONTRAN 210/2006 foi revogada.** Quem revogou foi a Res. CONTRAN 882/2021 (art. 64, I), em vigor desde 03/01/2022. A 882 também revogou a 211/2006 (CVC/AET) e outras 24 resoluções.
  PDF oficial: https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-contran/resolucoes/Resolucao8822021.pdf (HTTP 200, 1,76 MB, DOU de 24/12/2021).
- Alterações da 882 encontradas e baixadas (todas HTTP 200 em gov.br/transportes/.../resolucoes/):
  - Res. 899/2022: referenda a Deliberação 250/2021; AET pode ser dispensada por trecho publicado (art. 19 §5), boiadeiro até 25 m.
  - Res. 994/2023: largura de 2,80 m e comprimento de 15 m para tratores e máquinas; 2,60 m para os demais.
  - **Res. 1.005/2024: cavalo + semirreboque passa de 18,60 m para 19,30 m** (art. 4 III e).
  - Res. 1.015/2024: eixo dianteiro de 7 t e +1 t no PBT/PBTC para GNV, GNL, biometano, elétrico, híbrido e H2.
  - A busca não achou alteração dos limites em 2025/2026. A Res. 1.021/2026 trata de motor elétrico auxiliar e altera a Res. 916, não a 882.
- Valores principais (art. 4 e art. 6): largura 2,60 m; altura 4,40 m; não articulado 14 m; cavalo+SR 19,30 m; caminhão+reboque 19,80 m; mais de 2 unidades 19,80 m.
  Pesos: eixo simples 6 t; eixo de rodagem dupla 10 t; 2 direcionais 12 t; tandem duplo 17 t; não-tandem 15 t; tandem triplo 25,5 t. PBT de não articulado 29 t.
  Bitrem sem AET: até 57 t, 7 eixos, entre 17,5 e 19,8 m (art. 6 I j).
  AET obrigatória acima de 57 t ou acima de 19,80 m (art. 18). Com AET: até 74 t e até 30 m; acima de 57 t o comprimento deve ficar entre 25 e 30 m (art. 19).
  Com AET a CVC só roda do amanhecer ao pôr do sol, a 80 km/h. Em pista dupla com separador e 2 ou mais faixas, pode rodar dia e noite (art. 20).
- Tolerância na balança (art. 50): 5% no PBT/PBTC e 12,5% por eixo. Até 50 t só o PBT/PBTC é fiscalizado. A tolerância não pode ser usada para carregar mais (§3).
  A Lei 7.408/1985 vigorou até 30/09/2022 (Lei 14.229/2021). Desde então o tema é regulado pelo Contran (CTB art. 99 §§2 e 4).
- Definição: caminhão é veículo com PBT acima de 3.500 kg (CTB Anexo I, redação da Lei 14.440/2022; Res. 882 art. 3 I). Caminhonete até 3.500 kg não é caminhão.

## 2. São Paulo (município)

Fontes primárias testadas:
- CET: https://www.cetsp.com.br/consultas/caminhoes.aspx e subpáginas (HTTP 200).
- Catálogo de legislação municipal (texto compilado): https://legislacao.prefeitura.sp.gov.br/leis/portaria-secretaria-municipal-de-mobilidade-e-transportes-smt-137-de-3-de-agosto-de-2018.
- Base: Decreto 56.920/2016, que revogou os Decretos 48.338/2007, 49.487/2008 e outros. A regulamentação está na Portaria SMT.GAB 137/2018, em vigor desde 03/10/2018, com as alterações das Portarias 154/2018, 49/2021 e 57/2021.

**ZMRC** (Portaria 137/18, art. 1): proibido de seg a sex das 05h às 21h e no sáb das 10h às 14h, **exceto feriados**.

**VUC (ATENÇÃO, mudou)**: largura até **2,50 m** (Portaria SMT 57/2021; antes era 2,20 m), comprimento até **7,20 m**, fabricação a partir de jan/2005 e idade máxima de 15 anos.
- A liberação exige **AETC** (cadastro no DSV) e vistoria da CET (art. 18).
- A CET ainda mostra 2,20 m na página "Exceções", que está desatualizada. O texto compilado é o que vale.
- O VUC é liberado o dia todo em ZMRC, ZERC e VER §§2 a 4. **Não** é liberado nas VER §1 (Paulista, Rebouças, 9 de Julho, 23 de Maio, Radial Leste, Rio Branco/Rudge Ramos e outras).
- Os 6,30 m do nosso preset vêm dos decretos de 2007/2008, já revogados.

**VER** (art. 2), com proibição exceto feriados:
- §1 (26 vias), §2 (Marginal Pinheiros entre Jaguaré e Morumbi, Bandeirantes, Taunay, Roberto Marinho) e §3 (Morumbi): seg a sex 05h–21h e sáb 10h–14h.
- §4 (Marginal Tietê, Av. do Estado, Salim Farah Maluf, Tancredo Neves etc., 40 itens): seg a sex 05h–09h e 17h–21h, sáb 10h–14h.
- **A Portaria SMT 49/2021 revoga os itens I–IV do §4 e proíbe caminhões na Marginal Tietê sem horário.** Ficam liberados os caminhões com carga de origem ou destino no município. Quem tem AETC continua proibido de seg a sex 05h–21h e no sáb 10h–14h.
  Ela só entra em vigor "a partir da conclusão das obras do trecho norte do Rodoanel e sua liberação". O trecho 1 (Dutra–Fernão Dias, 24 km) abriu em 23/12/2025. Em 28/06/2026 o trecho final estava com 68% das obras, com entrega prevista para o 2º semestre de 2026 (mobilidadesampa, ndmais). **Monitorar.**
- Perecíveis com AETC (art. 32): na ZMRC e nas VER §§1 a 3, das 05h às 12h e sáb das 10h às 14h. Nas VER §4, das 05h às 09h e sáb das 10h às 14h.
- Placa R-9 "Exceto veículos autorizados" (Portaria 024/2012): seg a sex 05h–09h e 17h–22h, sáb 10h–14h.

**Rodízio** (Decreto 58.584/2018):
- Seg a sex, **exceto feriados**, das 07h às 10h e das 17h às 20h. Finais de placa: 1-2 seg, 3-4 ter, 5-6 qua, 7-8 qui, 9-0 sex. Inclui caminhões.
- A área inclui os limites do Minianel, mas **caminhões podem usar as vias do Minianel** (art. 2 §2). O recuo de 15 m que já existe no projeto atende isso.
- Exceções de carga (art. 3): VUC (VIII m), perecíveis (VIII l), elétrico/híbrido/hidrogênio (IX a), Correios, valores.
  A Portaria DSV.G 09/2019 art. 7 diz que o cadastro AETC isenta automaticamente do rodízio: VUC, guincho, Correios, valores, reportagem e obras essenciais.
- **Suspensões** (https://webforms.cetsp.com.br/institucional/rodizio/default.asp, HTTP 200, tabela HTML):
  - Em 2026 houve 15 registros.
  - Nos feriados (03/04, 21/04, 01/05, 04/06, 09/07, 07/09) foram suspensos rodízio, ZMRC e ZMRF.
  - Nos demais (22/12/2025–09/01/2026, Carnaval de 16 a 18/02, greves da CPTM, jogo da Copa) a suspensão valeu só para veículos de passeio, com a restrição **mantida para pesados, inclusive a ZMRC**.
  - O parâmetro `?year=2025` via GET não trocou o ano. É preciso investigar o form.
  - Arquivo: `cet/rodizio_suspensoes_2026.csv`.

**Produtos perigosos** (Portaria SMT.GAB 051/2024, publicada em 13/12/2024 e republicada em 20/12/2024; revogou a Portaria DSV 100/2016):
- Proibido de seg a sex, exceto feriados, das 07h às 10h e das 17h às 20h nas vias do Minianel (Anexo IV) e no centro expandido.
- Os grupos "consumo local" (Anexo II) e "outros" (Anexo III) podem circular o dia todo dentro do centro expandido, mas não nas vias do Minianel.
- A LETPP é obrigatória (Decreto 50.446/2009).
- Na ZMRC o transporte de perigosos também precisa de AETC (Portaria 137 art. 35: até 2 eixos traseiros, das 10h às 16h).

**Geometria**:
- Os mapas Google My Maps da CET exportam KML. Foram testados 3 com `https://www.google.com/maps/d/kml?mid=<id>&forcekml=1` (HTTP 200, 62–92 KB): mid z9TqTcegPvdk.kotJ30qs8z8A, z9TqTcegPvdk.kT3jAfulmRU0 e z9TqTcegPvdk.kj1m9B2XHemE.
  - Convertidos em `ver/cet_caminhoes_ver_zmrc.geojson`: **68 linhas VER (cerca de 329 km)**, mais a ZMRC (11 vértices, simplificada) e o Minianel.
  - O mapa 2 não tem os itens adicionados em 2018 (Av. São Miguel, Marechal Tito, Beraldo Marcondes, Juntas Provisórias, Bresser etc.). A cobertura é parcial; conferir com o art. 2 da Portaria 137.
- O shapefile do Minianel da CET está em https://webforms.cetsp.com.br/mapabasico/export/shapesMiniAnel.zip (13 KB, WGS84, 1 polígono).
- GeoSampa WFS:
  - `restricao_circulacao_veiculo_zmrc`, `_mian` e `_zmrf`: 1 feição cada.
  - `vaga_especial`: 6.734 feições; o tipo CA (caminhão, carga e descarga) tem 816 áreas e 2.521 vagas.
  - `classificacao_viaria_cet`: 210.754 feições.
- No OSM o município de SP tem só 6 ways com `hgv:conditional` (Overpass, 09/10/2026), 3 deles na Marginal Tietê Expressa. Ou seja, **as VER praticamente não estão no OSM**.

**Outros municípios da Grande SP** têm regras próprias e definições de VUC diferentes. Fontes só parcialmente verificadas:
- Cajamar: Decreto 7.397/2025, lido no Diário Oficial. VUC com largura até 2,20 m, comprimento até 7,20 m e capacidade até 3 t.
- Osasco: Decreto 10.661, com ZMRC seg–sex 05–21h e sáb 10–14h (fonte SETCESP; o ano não foi confirmado).
- Ribeirão Pires: Decreto 7.608/2025 (DGABC).
- ABC: 19 vias restritas das 6h30 às 8h30 e das 17h às 20h (SETCESP, notícia antiga).

## 3. Jornada (Lei 13.103/2015, CTB e CLT)

Textos compilados do Planalto, HTTP 200.

- CTB art. 67-C:
  - Direção contínua de no máximo 5h30 (caput).
  - Pausa de 30 min dentro de cada 6 h, que pode ser fracionada (§1).
  - 11 h de descanso em 24 h (§3).
  - Pode estender até um local seguro (§2).
  - §8 (Lei 14.599/2023) e 67-E §1º-A (Lei 14.440/2022): sem penalidade se não houver PPD ou vaga, conforme regulamentação do Contran. Essa regulamentação não foi localizada.
  - §9: a União deve publicar a lista de PPD com o número de vagas.
- CLT art. 235-C:
  - Jornada de 8 h, mais até 2 h extras, ou até 4 h com convenção/acordo coletivo.
  - Refeição de pelo menos 1 h (§2).
  - Vale **só para o motorista empregado**. O TAC autônomo segue o CTB.
- **STF ADI 5322** (sessão virtual concluída em 30/06/2023, relator Alexandre de Moraes; notícia do STF de 05/07/2023):
  - Foram declarados inconstitucionais o fracionamento das 11 h e sua coincidência com as pausas (CTB 67-C §3 e CLT 235-C §3). **O descanso diário passa a ser de 11 h ininterruptas.**
  - O tempo de espera passou a contar como jornada (235-C §§1, 8, 9 e 12).
  - Também caíram o fracionamento e o acúmulo do descanso semanal (235-D caput parcial e §§1 e 2) e o descanso com o veículo em movimento (235-D §5 e 235-E III).
  - Nos embargos (out/2024) os efeitos foram modulados como ex nunc a partir da publicação da ata de julgamento. As fontes divergem sobre a data: 11/07 ou 12/07/2023.
  - O exame toxicológico foi mantido.
- Lei 13.103 art. 12: as regras do 67-C produzem efeito nos trechos de via publicados pelo órgão (art. 11).
- Res. CONTRAN 525/2015: fiscalização com retenção de 30 min ou de 11 h.
- No código, `api/src/services/restStops.ts` (DRIVING_RULES) atribui o 5h30 ao "art. 235-C da CLT" (o correto é CTB 67-C). Ele também trata 8 h como **direção** diária, mas 8 h é **jornada** (inclui espera e carga/descarga), e não tem a regra das 11 h.

## 4. Federal: PRF em feriados

- Página: https://www.gov.br/prf/pt-br/seguranca-viaria/restricao-de-trafego/restricao-de-trafego-2026 (HTTP 200, modificada em 11/09/2026). O link direto do PDF da Portaria 12/2026 devolveu HTML.
- Norma: Portaria DIOP/PRF 26/2026; o Anexo I foi alterado pela Portaria DIOP/PRF 121 de 08/09/2026.
- O que proíbe: CVC, CTV e CTVP (mesmo com AET ou AE) acima de 2,60 m de largura, 4,40 m de altura, 19,80 m de comprimento ou 58,5 t de PBTC, em **pista simples** de rodovia federal, nas janelas do anexo.
- Exemplo atual: N.S. Aparecida, 09/10 das 16h às 22h, 10/10 das 06h às 12h e 12/10 das 16h às 22h.
- Regra especial em SP: no BR-116 (km 0–231), BR-459 e BR-488, inclusive em pista dupla, entre 02 e 12/10 para veículos com AET/AE.
- A infração é a de código 574-61 (CTB art. 187 I).
- A tabela é uma imagem PNG; foi transcrita em `prf/prf_restricao_feriados_2026.csv` (39 linhas).
- DER-SP/ARTESP publicam portarias pontuais (por exemplo, SUP/DER-86 para AET em feriados). Não há feed estruturado.

## 5. PPD (pontos de parada e descanso)

- Lista do Ministério dos Transportes: https://www.gov.br/transportes/pt-br/assuntos/transporte-terrestre_/portal-trc/ppd/ListaPPDs15.05.2025.xlsx (HTTP 200, 21 KB).
- Tem 184 PPD; só 3 em SP e 1 na RMSP (Guararema, BR-116 km 177). Não tem coordenadas, só BR/km.
- Novas certificações saem por portaria no DOU (ex.: Portaria 802 de 14/10/2025).

## 6. Licenças

- Leis, decretos, resoluções, portarias e decisões judiciais **não têm proteção de direito autoral** (Lei 9.610/1998 art. 8 IV). Podemos usar os valores comercialmente, citando a fonte.
- Portais gov.br (PRF, MT, CONTRAN): o conteúdo do site é CC BY-ND 3.0. Os atos normativos em si são de domínio público pelo art. 8. A transcrição da tabela é fato ou ato oficial.
- Os KML/mapas da CET não têm licença explícita. É dado de órgão público: usar como referência, citar a fonte e manter em base própria (não importar no OSM).
- GeoSampa: não há licença explícita no WFS. A Prefeitura trata como dado aberto. **Confirmar** antes de uso comercial.
- OSM: ODbL. Manter separado dos reportes e das camadas legais.

## 7. Comandos de teste (resumo)

```
curl -sSL -A "Mozilla/5.0" https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-contran/resolucoes/Resolucao8822021.pdf -o pdf/Resolucao8822021.pdf
curl -sSL "https://www.google.com/maps/d/kml?mid=z9TqTcegPvdk.kT3jAfulmRU0&forcekml=1" -o ver/x.kml
curl -sSL https://webforms.cetsp.com.br/institucional/rodizio/default.asp
curl -sS "https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=geoportal:vaga_especial&resultType=hits"
STF: noticias.stf.jus.br responde 200 só com User-Agent de navegador; portal.stf.jus.br/processos -> 403.
```
