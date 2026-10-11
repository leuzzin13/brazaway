# GUIA da pesquisa municipal de caminhões — Sudeste (fila do orquestrador)

Atualizado em 11/10/2026, depois da RODADA 1 (triagem). Vale para todos os agentes de cidade das filas `R1-*`.
Caminho base: `/private/tmp/claude-501/-Users-arthurleuzzi-Projetos-truck-router/391889ae-a946-45ef-a0f8-d122c8f49438/scratchpad/cidades` (abaixo, `$C`).

Regra de ouro: **regra ativa só com ato primário vigente, com número, artigo e URL**. Pé na Estrada, OSM, notícia,
ata de Câmara, requerimento e trecho de diário são PISTAS. Nunca escreva no repositório: o resultado vai para
`$C/res/<ibge>.json`.

---

## 1. Estado depois da R1

| | cidades |
|---|---|
| Municípios do Sudeste | 1.668 |
| Fora da fila: já no repo (`data/raw/municipios/*.json`, 34) + capital paulista 3550308 | 35 |
| Fora da fila: lotes de nível profundo A01–A30 (outra frente, em paralelo) | 146 |
| Triados na R1 | **1.487** |
| Resolvidos DIRETO na triagem (`res/`, `nivel_busca: varredura_consolidada`) | **850** (846 `nao_achou`, 4 `sem_restricao_declarada`) |
| Fila DIRIGIDA (alguma pista) | **385** em 23 lotes |
| Fila MÉDIA (500–2.000 caminhões, sem pista) | **252** em 14 lotes |

Script da triagem (sem rede, reexecutável): `$C/triagem_r1.py` (`--gravar` grava; nunca sobrescreve `res/` existente).
Decisão de cada município (fila, classe, flags): `$C/triagem_r1.json`.

### Critérios usados
* **Pista** = qualquer um: página do Pé na Estrada dizendo que há restrição; `acertos_relevantes > 0` no Querido
  Diário (`leads/querido_diario.json`); `acertos > 0` no diário consolidado (`leads/diarios_consolidados.json`);
  indício forte de diário (edição do DOSP com frase exata de caminhão/pesado cujo PDF não foi lido); qualquer contagem
  no OSM (`osm_hints_por_municipio.json`: hgv=no, hgv:conditional, maxweight, maxlength, outras condicionais);
  pesquisa anterior com indício (frente `mun_rmsp_restante`).
* **Direto** = < 500 caminhões e nenhuma pista. Status `sem_restricao_declarada` só quando o Pé na Estrada diz
  "Não possui restrições"; senão `nao_achou`. Cada `res` lista só o que foi consultado na preparação e tem o bloco
  `triagem` (`cobertura_minima: true` em **267** deles: nenhum diário oficial varrido — sobretudo MG fora da AMM e RJ).
  Esses são os primeiros candidatos se sobrar orçamento numa rodada futura.
* **Média** = 500–2.000 caminhões sem pista (Embu-Guaçu, 2.091, também entrou aqui).

### Classes dos lotes (campo `classe` no lote e em cada cidade)
| código | o que é | n |
|---|---|---|
| `DF` | pista documental **forte**: trecho com veículo pesado + proibição/horário (sem cara de licitação/frota/evento), frase exata em edição do DOSP não lida, Pé na Estrada com restrição ou pesquisa anterior com indício | 93 |
| `DW` | acerto de diário só pelo regex do lead, provável ruído (frota, diário de bordo, caminhão de lixo, plano diretor, food truck) | 103 (inclui DX) |
| `DO` | só OSM | 189 (inclui DX) |
| `DX` | lote misto (RJ e ES têm poucas cidades) | 30 |
| `M` | média, sem pista | 252 |

Índice dos lotes (cada arquivo `$C/fila/<id>.json` traz `foco`, `sistemas` e por cidade `pistas`, `nota`, `portal`, `flags`):

* MG: DF01–DF03 (15/14/14), DW01–DW03 (17/17/18), DO01–DO04 (16 cada), M01–M05 (19 cada)
* SP: DF01–DF03 (14/15/14), DW01–DW02 (17/17), DO01–DO05 (20/19/20/20/20), M01–M06 (19/19/19/19/18/19)
* RJ: DX01 (10), DO01 (20), M01 (19)
* ES: DX01 (20), M01 (13), M02 (12)

Os lotes foram agrupados por UF e, dentro dela, pela família do sistema de legislação (`portal.sistema`), na ordem de
frota. Alguns lotes juntam cidades do mesmo sistema: **não rode mais de ~4 lotes do mesmo SaaS ao mesmo tempo**
(Interlegis `sapl.*.leg.br`, `*.siscam.com.br`, `camarasempapel`, `legislacaocompilada`, `webline`): um pedido por host
por vez e pausa de ~1 s.

---

## 2. O que cada agente entrega: `$C/res/<ibge>.json`

Mesmo formato dos 109 da frente profunda (ex.: `res/3129806.json` para não-achado com indício OSM desativado,
`res/3507506.json` para regras ativas):

```
{ibge, nome, uf, status, nivel_busca, data, fontes_consultadas:[{url, resultado}], observacoes,
 osm_divergencias:[...], regras_rascunho:[...], vuc?, vuc_nota?}
```
* `nivel_busca`: `dirigida` (lotes D*) ou `media` (lotes M). Ao refazer um município triado direto, use o nível novo
  e substitua o arquivo (o bloco `triagem` pode ser apagado).
* `status` (vocabulário em uso):
  `regra_com_ato` (pelo menos uma regra com ato primário conferido) · `regra_sem_ato` (regra real — sinalização,
  nota oficial, plano que diz "manter a atual restrição" — mas ato não achado) · `pontual` (só regras não roteáveis ou
  muito locais: estacionamento, carga e descarga, evento, calçadão) · `pista` (indício sem confirmação) ·
  `sem_restricao_declarada` (fonte oficial ou plano diz que não há, ou busca completa sem nada) ·
  `confirmou_que_nao_tem` (órgão confirmou ausência por escrito) · `nao_achou` (busca sem resultado; não prova ausência).
* `fontes_consultadas`: **exatamente** o que você consultou (URL + resultado, inclusive "403", "sem resultado").
  Não liste fonte que não abriu. Reaproveite as linhas da preparação que estão nos `pistas` do lote.
* `regras_rascunho`: formato do núcleo (`docs/layers/restricoes_municipais.md` do repo): `id` (prefixo da cidade),
  `tipo` zona|via|ponte, `regime`, `nome`, `status` ativa|desativada|revogada, `status_motivo` (obrigatório se não
  ativa), `confianca` (baixa/unverifiable → só desativada), `janelas` ([{days 1..7, from, to}], 1 = segunda,
  `to` exclusivo, virada de noite = 2 janelas), `feriados` aplica|suspende, `alvo` ({caminhao:true, qualquer/todas:
  [{campo: pbt_t|payload_t|comprimento_m|largura_m|altura_m|eixos|tipo, acima|ate|em}]}), `excecoes`, `base_legal`
  ([{ato, artigo, url}] — ato e artigo obrigatórios), `vigencia_inicio`/`vigencia_fim`, `trechos` (via, de, ate,
  descricao, aproximado), `geometria` ([{arquivo: "municipios/geo/<ibge>_<nome>.geojson", construir: trechos|manual}]).
  **"Capacidade de carga" ≠ PBT**: use `payload_t` para lotação/capacidade e `pbt_t` para peso bruto.
* OSM com hgv=no sem ato: registre em `osm_divergencias` e, se quiser, como regra **desativada** (`confianca: baixa`).

---

## 3. Fluxo por classe de lote (orçamento sugerido por cidade)

**DF (até ~25 min/cidade)**
1. Leia `nota` e `pistas` da cidade. Abra a URL do trecho (AMM: `diariomunicipal.com.br/amm-mg/materia/<id>`;
   DOSP: `dosp.com.br/exibe_do.php?i=...` é PDF — `pdftotext`; QD: troque `.pdf` por `.txt` em
   `data.queridodiario.ok.org.br/...`).
2. Ache o número do ato e busque o texto integral no portal (`toolkit/legislacao.py buscar <ibge> "<termos>" --texto`)
   ou no SAPL/Siscam da Câmara; leia artigos, horários, alvo (PBT/capacidade/eixos/comprimento), vias e exceções.
3. Vigência: procure alteração/revogação (mesmo número na ementa de atos posteriores; "revoga"; ADI no TJ).
4. Monte `regras_rascunho` e `status`.

**DW (até ~10 min/cidade)** — confira o trecho em 1 minuto. Se for ruído (frota, coleta de lixo, plano diretor,
licitação, evento), faça a busca padrão (seção 6) no portal e conclua. Se o trecho for real, trate como DF.

**DO (até ~10 min/cidade)** — 1) Overpass na área do município (`area["IBGE:GEOCODIGO"="<ibge>"]`) listando os ways com
`hgv`, `maxweight`, `maxlength`, `hgv:conditional` (nome, highway, bridge, operador); 2) descarte o que não é restrição
municipal: helipontos (`aeroway=helipad` — Guaíra tinha 4 "maxweight" assim), pontes de rodovia estadual/federal
(competência DER/DNIT), `hgv=destination`/`delivery`; 3) para hgv=no em rua municipal, busque o ato pelo nome da via
no portal e nos diários; sem ato → `nao_achou` (ou `pista`) com `osm_divergencias`.

**M (até ~8 min/cidade)** — `legislacao.py buscar <ibge> "<termos>" --json` (todas as fontes) +
`diarios_consolidados.py buscar <ibge> "circulação de caminhões"` (e "trânsito de caminhões", "veículos pesados").
Abra só os atos com ementa promissora. Nada → `nao_achou`; plano/órgão dizendo que não há → `sem_restricao_declarada`.
Se aparecer algo forte, aprofunde como DF.

Orçamento de WebSearch é baixo: só como último recurso, 1 consulta por cidade no máximo, e só em DF.

---

## 4. Ferramentas

```bash
cd $C/toolkit
python3 legislacao.py info <ibge>                                   # sistema, URLs, fontes do município
python3 legislacao.py buscar <ibge> "caminh|carga e descarga|veículos pesados|veiculos pesados|tráfego|trafego|trânsito|transito" --json
python3 legislacao.py buscar <ibge> "caminhões" --texto              # texto integral (SAPL/SAGL/Siscam/Instar/Portal Fácil/Leg. Digital)
python3 legislacao.py direto sapl https://sapl.<cidade>.<uf>.leg.br "carga e descarga"
python3 diarios_consolidados.py lead <ibge>                         # o que a varredura já achou
python3 diarios_consolidados.py buscar <ibge> "circulação de caminhões" --json
```
Leads por município: `jq '."<ibge>"' $C/leads/penaestrada.json`, `.../querido_diario.json`,
`.../diarios_consolidados.json`, `.../portais.json`. Ferramentas avulsas da frente profunda (CESPRO, Instar, SAGL,
Overpass): `$C/_tools_A01/` (ex.: `cespro.py`, `osmshow.py`, `sagl_list.py`).

---

## 5. Fontes que funcionam, por UF

**MG** (853 municípios; 805 na triagem)
* Diário da AMM (`diariomunicipal.com.br/amm-mg`, SIGPub, desde 2009): ~504 aderentes; busca por palavras (E lógico,
  sem frase exata). Deu 108 municípios com acerto na varredura. Melhor fonte para decretos de prefeituras pequenas.
  **333 municípios de MG não estão em nenhum diário consolidado** — para eles só o portal.
* Portais: `legislacoes_dt` (JSON, ementa), `portalfacil` (AjaxPro, ementa e texto), `webline`, `instar`,
  `docman` (só título — fraco), SAPL das Câmaras (`sapl.<cidade>.mg.leg.br`, API REST, ótimo).
* Na frente profunda, os atos de MG vieram de: portal da prefeitura (`<cidade>.mg.gov.br`), SAPL MG e AMM.
* `leismunicipais.com.br` (muitas cidades MG): 403 Cloudflare — use SAPL/AMM no lugar.

**SP** (645; 547 na triagem)
* DOSP/DiOE (`imprensaoficialmunicipal.com.br/<slug>` = `dosp.com.br`): ~274 cidades, busca por cidade na íntegra;
  sem trecho na busca (abrir o PDF). Deu 66 municípios com acerto.
* DOE-SP caderno Municípios (desde 05/2023): dominado por licitações; útil só para atos recentes.
* Siscam das Câmaras (`<cidade>.siscam.com.br`, CSV/texto) e SAPL (`sapl.<cidade>.sp.leg.br`) foram as fontes de ato
  mais produtivas na frente profunda (Bebedouro, Tatuí, Paulínia, Araraquara, Lins via Siscam).
* Instar (`/portal/leis_decretos/`), Webline, SPL/`camarasempapel` (Taubaté, São José dos Campos), legislação própria
  de prefeitura (`<cidade>.sp.gov.br/legislacao/...`, ex.: Botucatu).
* `legislacaodigital.com.br` e `leismunicipais.com.br`: Cloudflare. Instâncias de Siscam antigo listam as mesmas
  normas com link para o Legislação Digital — use o Siscam.

**RJ** (92; 70 na triagem)
* Diários próprios grandes no Querido Diário (33 RJ); AEMERJ só 10 aderentes.
* SAPL das Câmaras (`sapl.<cidade>.rj.leg.br`) deu atos em vários municípios; a frente profunda buscou em texto no CESPRO de
  Itaboraí e Nova Iguaçu (`_tools_A01/cespro.py`); onde houver reCAPTCHA, não automatizar.
* Atos de trânsito no RJ costumam ser **resolução/portaria do órgão municipal** (SEMTRAN, IMTT, NitTrans,
  DEGETRAN), não decreto: busque também "Resolução" e "Portaria".

**ES** (78; 65 na triagem)
* DOM-ES/AMUNES (`ioes.dio.es.gov.br/dom`, desde 2021): frase exata; o município é atribuído pela página
  (confira o cabeçalho). Colatina (Dec. 31.286/2025) foi achado aí; Cachoeiro, no SPL (`legislacaocompilada`).
* SPL (`legislacaocompilada.com.br`, `splonline`, `camarasempapel`), SAPL, `portalfacil`, `legver`.
  `legislacaocompilada` tem busca textual atrás de Cloudflare: o cliente cai para busca por tema.

---

## 6. Busca padrão (termos que dão acerto)

Termos que mais produziram acerto real (veículo + proibição) na varredura dos diários: "circulação de caminhões",
"trânsito de caminhões", "tráfego de caminhões", "tráfego de veículos pesados", "circulação de veículos pesados",
"trânsito de veículos pesados", "circulação de veículos de carga", "tráfego pesado", "estacionamento de caminhões".

Para portais (substring na ementa; mande variantes com e sem acento):
`caminh|veículos pesados|veiculos pesados|veículo de carga|veiculos de carga|carga e descarga|tráfego|trafego|trânsito|transito|tonelad|eixos|carreta|bitrem|zona de restrição|zona de restricao`.

Vocabulário típico dos atos achados: "Zona de Restrição à Circulação (ZRC/ZRCVC)", "Área de Restrição de Circulação",
"Vias Estruturais Restritas", "quadrilátero central", "perímetro urbano", "capacidade de carga acima de X t",
"PBT acima de X t", "mais de 2/3/4 eixos", "carretas, bitrens e cavalos mecânicos", "Área Azul/Zona Azul (carga e
descarga)", "Rotas de Controle de Cargas Pesadas", "Código de Posturas", "Resolução SEMTRAN/DET", "Portaria DMTT/IMTT".
Ementas: "Dispõe sobre a proibição do tráfego de caminhões...", "Regulamenta a circulação de veículos de grande
porte...", "Dispõe sobre a restrição de circulação de caminhões no trecho urbano da Rodovia...".

---

## 7. Armadilhas (aprendidas na frente profunda e na preparação)

* **Plano Diretor / PlanMob** quase sempre traz só **diretriz** ("criar rotas", "estudar restrição") → não é regra.
  Mas quando o plano manda **manter a "atual" restrição** (Birigui) ou o órgão a cita, é `regra_sem_ato`.
* **Código de Posturas**: geralmente estacionamento, carga e descarga, lavagem de caminhão → `pontual`. Às vezes
  proíbe trânsito no perímetro urbano (Arcos) — leia o artigo.
* **Ementa enganosa**: Pouso Alegre, Lei 4.511/2006 ("Circulação de Veículos de Cargas Pesadas") só regula carga e
  descarga. Leia o texto.
* **Revogada / inconstitucional**: Catanduva (Lei 5.018/2010, ADI no TJSP), Mogi Guaçu (Lei 4.033/2003 revogada
  em 2023). Sempre procure ato posterior com o mesmo número.
* **Restrição de evento** (carnaval, festa, Corpus Christi — ex.: Castelo/ES, Guarani/MG) é temporária → `pontual`.
* **Requerimentos/indicações de vereador** pedindo proibição em uma rua indicam que a regra geral **não** existe;
  não são ato.
* **Ruído dos diários**: decretos de frota/diário de bordo, "caminhões coletores", consórcios de máquinas, COVID
  ("restrição de circulação"), licitação. Placa "proibido caminhões" comprada em licitação é pista fraca de sinalização.
* **OSM**: maxweight em heliponto; ponte de rodovia estadual/federal; hgv=no de mapeador sem ato. Nunca ativa regra.
* **Pé na Estrada**: dados de 2018–2019, sem ato; vários erros comprovados (Juquitiba, Itapevi, Poá). "Não possui"
  com contato Detran/Ciretran é ausência fraca.
* **Bloqueios**: `leismunicipais.com.br`/`leis.org` e `www.legislacaodigital.com.br` (403 Cloudflare), CESPRO com
  reCAPTCHA, `doem.org.br` (desafio anti-robô). **Não contornar** — use Câmara, diários e Querido Diário.
* **PDF escaneado**: comum em leis antigas e no SAPL (28 dos 109 resultados da frente profunda citam PDF escaneado ou OCR). Use
  `pdftotext` e, se vazio, OCR (tesseract `-l por`), registrando "OCR" em `fontes_consultadas`.
* **Querido Diário**: API instável (503/520 com `size` grande); os arquivos estáticos (`.pdf`/`.txt`) em
  `data.queridodiario.ok.org.br` não dependem da API de busca. 160 municípios estão com coleta por município pendente.
* **Homônimos** em SaaS por subdomínio (siscam, atende.net, camarasempapel): confira a UF no título (`verificar` no
  `portais.json`).
* **Capacidade de carga vs PBT**: BH, Juiz de Fora e outros usam "capacidade/lotação"; não converter para PBT.

---

## 8. Aprendizados das ondas

**Frente profunda (A01–A30, cidades maiores; 109 resultados em 11/10/2026)**: 53 `regra_com_ato`, 8 `regra_sem_ato`,
15 `pontual`, 8 `pista`, 17 `sem_restricao_declarada`, 7 `nao_achou`, 1 `confirmou_que_nao_tem`. Ou seja, metade das
cidades grandes tem regra com ato; em cidade média/pequena a taxa deve ser bem menor, mas os acertos de DF da R1
incluem ementas claras, ainda a conferir (ex.: Ouro Fino/MG Lei 3.313/2025, PBT > 30 t; Pardinho/SP Lei 1.488/2022;
São Lourenço/MG Dec. 8.537, AMM de 18/10/2021; Ponte Nova/MG Dec. 13.003, AMM de 08/05/2023, núcleo histórico).

**Triagem R1**: 57% dos restantes saíram direto (pequenos sem pista). Em MG o fator limitante é a cobertura: 333
municípios fora da AMM e sem Querido Diário.

(Próximas rodadas: acrescentar aqui o que funcionou e o que falhou em cada lote.)
