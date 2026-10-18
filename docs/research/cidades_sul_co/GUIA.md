# GUIA da pesquisa municipal de caminhões — Sul e Centro-Oeste (fila do orquestrador)

Atualizado em 18/10/2026, depois da RODADA 1 (triagem). Vale para todos os agentes de cidade dos lotes `R1-*`.
Caminho base: `/home/user/brazaway/docs/research/cidades_sul_co` (abaixo, `$C`). Base de experiência: `docs/research/cidades_sudeste/GUIA.md`.

Regra de ouro: **regra ativa só com ato primário vigente, com número, artigo e URL**. Pé na Estrada, OSM, notícia,
ata de Câmara, requerimento, plano diretor e trecho de diário são PISTAS. O resultado vai para `$C/res/<ibge>.json`
(um por município); não escreva em `data/` do repositório.

---

## 1. Estado depois da R1

| | cidades |
|---|---|
| Municípios (PR, SC, RS, GO, MT, MS, DF) | 1.659 |
| Frente profunda em paralelo (`lotes_profundos.json`, > 100 mil hab.) — fora da fila | 84 (todas já com `res/`) |
| Triados na R1 | **1.575** |
| Resolvidos DIRETO (`res/`, `nivel_busca: varredura_consolidada`, todos `nao_achou`) | **785** |
| Fila DIRIGIDA | **675** em 39 lotes |
| Fila MÉDIA (30–100 mil hab., sem pista) | **115** (em 4 lotes M + 4 lotes mistos DX) |

Script da triagem (sem rede, reexecutável): `$C/triagem_r1.py` (`--gravar` grava `res/`; nunca sobrescreve `res/` existente).
Decisão de cada município (classe, flags, força, portal): `$C/triagem_r1.json`. Resumo e índice dos lotes: `$C/fila_r1_resumo.json`.

### Critérios
* **Pista** = acerto do diário consolidado (`leads/diarios_consolidados.json`, `acertos > 0`), acerto relevante no Querido
  Diário (`leads/querido_diario.json`), página do Pé na Estrada com restrição (no Sul/CO só Florianópolis, que é da frente
  profunda) ou etiqueta OSM (`osm_hints_por_municipio.json`) em via **sem `ref` de rodovia**.
* O orquestrador **re-pontuou** cada trecho (função `forca` do script: veículo pesado + proibição/restrição + ato
  normativo − ruído de licitação/frota/ISS/servidão/plano diretor...). Isso separa as classes abaixo.
* **Direto** = < 30 mil hab. e nenhuma pista (inclusive quem só tem indício abaixo do limiar). OSM só em rodovia
  estadual/federal (`ref` SC-/PR-/BR-...) foi descartado (competência DER/DNIT) e anotado em `fontes_consultadas`
  (35 casos). `triagem.cobertura_minima: true` (nenhum diário varrido): **383** municípios diretos — RS 173, PR 131,
  GO 65, MS 12, MT 1, SC 1 → primeiros candidatos se sobrar orçamento numa rodada futura.

### Classes (campo `classe` no lote e em cada cidade)
| código | o que é | n | orçamento/cidade |
|---|---|---|---|
| `DF` | pista documental **forte**: ementa/trecho de lei/decreto proibindo ou restringindo caminhão/veículo pesado/carga | 151 | ~25 min |
| `DW` | pista **fraca**: caminhão + circulação em lei genérica (código de trânsito/posturas, sistema viário, plano) | 92 | ~10 min |
| `DO` | só OSM (hgv=no / maxweight / maxlength em via municipal) | 126 | ~10 min |
| `DR` | **conferência barata**: a preparação contou "acerto", mas o trecho re-pontuado é ruído (ISS item 11.04 "carga, descarga", "motorista de veículos pesados", lei orgânica genérica, servidão, frota, licitação) | 306 | ~5 min |
| `M` | média (30–100 mil hab.) sem pista | 115 | ~8 min |
| `DX` | lote misto da UF (grupos < 12 juntados); cada cidade traz sua própria `classe` | — | conforme a classe |

Pequenos com pista forte (DF) e médios com qualquer pista vão para lotes D*; médios sem pista ou só com ruído vão para M.

### Índice dos lotes (`$C/fila/<id>.json`: `id, rodada, tipo, classe, uf, foco, sistemas, guia, cidades:[{ibge, nome, uf, populacao, caminhoes, classe, flags, pistas, portal, nota}]`)
* PR: DF01–DF03 (19 cada), DW01–DW03 (14/14/13), DO01–DO03 (16/15/15), DR01–DR03 (20/19/19), M01 (23)
* SC: DF01–DF04 (17/17/17/16), DO01–DO02 (20/19), DX01–DX02 (20/19: DW + M), DR01–DR05 (18/18/18/17/17)
* RS: DX01 (19: DF + DW), DO01–DO02 (18/18), DR01–DR02 (19/18), M01–M02 (19/18)
* MT: DX01 (15: DF + DW + DO), DR01–DR04 (18/18/18/17), M01 (18)
* MS: DX01 (22: DF + DO + M), DR01–DR02 (14/13)
* GO: DX01–DX02 (13/12: DF + DW + M), DR01–DR02 (13/12)

Prioridade sugerida de execução: DF e DX primeiro, depois DW/DO, M e por último DR.
Dentro da UF, os lotes estão ordenados pela família do sistema de legislação (`portal.sistema`). **Não rode mais de ~4
lotes do mesmo SaaS ao mesmo tempo** (`sapl.*.leg.br` — PR/MT, `atende.net`, `1doc`, `cespro`, `siscam`, `diariomunicipal.com.br`):
um pedido por host por vez e pausa de ~1 s. Os 4 lotes `R1-PR-*` concentram SAPL (107 cidades do PR na fila).

---

## 2. O que cada agente entrega: `$C/res/<ibge>.json`

Mesmo formato dos 84 da frente profunda (ex.: `res/4101408.json` Apucarana — pista com lei sem perímetro;
`res/4100400.json` Almirante Tamandaré — regra com ato e verificação em `verif/`):

```
{ibge, nome, uf, status, nivel_busca, falha_de_fonte, data, fontes_consultadas:[{url, resultado}], observacoes,
 osm_divergencias:[...], regras_rascunho:[...], vuc?, vuc_nota?}
```
* `nivel_busca`: `dirigida` (lotes D*/DX/DR) ou `media` (lotes M). Se o município já tiver `res/` da triagem, substitua.
* `falha_de_fonte: true` quando a fonte principal estava fora do ar/bloqueada e não houve alternativa — o "não achou" fica inconclusivo.
* `status`: `regra_com_ato` · `regra_sem_ato` · `pontual` (estacionamento, carga e descarga, evento, calçadão, estrada rural em dia de chuva) ·
  `pista` · `sem_restricao_declarada` · `confirmou_que_nao_tem` · `nao_achou`.
* `fontes_consultadas`: **exatamente** o que você abriu (URL + resultado, inclusive 403/404/sem resultado). Reaproveite
  as linhas da preparação que estão em `pistas` da cidade no lote.
* `regras_rascunho`: formato do núcleo (`docs/layers/restricoes_municipais.md`): `id` (prefixo da cidade), `tipo`
  zona|via|ponte, `regime`, `nome`, `status` ativa|desativada|revogada, `status_motivo`, `confianca`, `janelas`
  ([{days 1..7, from, to}], 1 = segunda, `to` exclusivo, virada da noite = 2 janelas), `feriados`, `alvo`
  ({caminhao:true, qualquer/todas:[{campo: pbt_t|payload_t|comprimento_m|largura_m|altura_m|eixos|tipo, acima|ate|em}]}),
  `excecoes`, `base_legal` ([{ato, artigo, url}]), `vigencia_inicio`/`vigencia_fim`, `trechos`, `geometria`.
  **"Capacidade de carga" ≠ PBT** (`payload_t` vs `pbt_t`). Restrição **sazonal** (ex.: alta temporada no litoral de SC) →
  janelas + `vigencia_inicio/fim` ou nota em `status_motivo` se o período muda a cada ano.

---

## 3. Fluxo por classe

**DF** — 1) leia `nota` e `pistas`; abra a URL do trecho (SIGPub: `diariomunicipal.com.br/<amp|famurs|agm|fgm|amm-mt|ms>/materia/<id>`;
DOM/SC: `diariomunicipal.sc.gov.br/atos/<id>`; QD: troque `.pdf` por `.txt`). 2) Ache o texto integral (o próprio diário
costuma trazer o ato inteiro; senão `legislacao.py buscar <ibge> "<termos>" --texto` ou SAPL da Câmara). 3) Vigência: procure
alteração/revogação (`diarios_consolidados.py buscar <ibge> "<nº do ato>"`). 4) `regras_rascunho` + `status`.

**DW** — conferir o trecho em 1–2 min. Ruído (plano diretor só com diretriz, código de posturas sobre estacionamento,
definição de "veículo de carga" em lei de trânsito) → busca padrão (seção 5) e concluir. Trecho real → tratar como DF.

**DO** — Overpass (`area["IBGE:GEOCODIGO"="<ibge>"]`, ways com `hgv`, `maxweight`, `maxlength`, `hgv:conditional`);
descartar heliponto, ponte/rodovia DER-DNIT, `hgv=destination/delivery`; para via municipal, buscar o ato pelo nome da
via no portal e no diário; sem ato → `nao_achou`/`pista` + `osm_divergencias`. Overpass é instável: se cair, use os
`exemplos` já anotados em `pistas.osm`.

**DR** — leia os trechos anotados (1 min). Rode **uma** busca de portal (`legislacao.py buscar <ibge> "caminh|veículos pesados|veiculos pesados|carga e descarga" --principal`)
e **uma** de diário (`diarios_consolidados.py buscar <ibge> "trânsito de caminhões"`). Nada concreto → `nao_achou`. Se surgir
ato real, aprofunde como DF (e anote no `observacoes` que o lead veio da DR).

**M** — `legislacao.py buscar <ibge> "<termos>" --json` (todas as fontes) + `diarios_consolidados.py buscar <ibge> "circulação de caminhões"`
(e "trânsito de caminhões", "veículos pesados"). Abra só ementas promissoras. Nada → `nao_achou`.

WebSearch: no máximo 1 por cidade e só em DF/DX-DF, como último recurso.

---

## 4. Fontes que funcionam, por UF (preparação de 18/10/2026)

**SC** (295) — **DOM/SC** (`diariomunicipal.sc.gov.br`, sem `www`, acervo desde ~2013) cobre 294: é a melhor fonte, traz o
ato inteiro. Sem data o site devolve só 3 semanas: mande `dataInicial=01/01/2000` (o cliente já manda). Teto de 200 por
consulta. Portais: portal próprio (73 na fila), `leismunicipais` (51, Cloudflare), `atende` (31, captcha), SAPL (22),
`legislador` (14), `legislacaomunicipal` (13). Achados típicos: proibição de **carretas e betoneiras na alta temporada**
(Itapema Dec. 103/2023, Gov. Celso Ramos Dec. 123/2022), ponte com limite de carga (Ponte Deneke — Itaiópolis Dec. 3.391/2025
e Vitor Meireles Dec. 009/2025), estradas vicinais em dia de chuva (Bom Retiro, Bela Vista do Toldo).

**PR** (399) — **AMP** (SIGPub) cobre 182 (desde 2009). 181 sem diário consolidado (131 diretos com cobertura mínima).
**SAPL** é o sistema mais comum na fila (107) e funciona bem (API REST, sensível a acento: mande `caminh|caminhoes`).
Também `elotech` (API pública), `webline`, `legislador`; `atende`/`1doc`/`leismunicipais` sem automação. Exemplos reais:
Palmeira Lei 3.773/2014 (veículos pesados no bairro Elias Farajala Bacila), Paiçandu Lei 3.385/2025 (caminhões),
Campina do Simão Lei 698/2020, Paranaguá Dec. 5.562 (Ilha dos Valadares).
Ruído típico do PR: decretos de servidão (SANEPAR/Copel) "transitar com veículos pesados" na faixa — não é regra.

**RS** (497) — **FAMURS** (SIGPub) cobre 270; 200 sem diário (173 diretos com cobertura mínima). Portais: **CESPRO**
(36 na fila, reCAPTCHA — não automatizar; abrir à mão ou usar a Câmara), `leismunicipais` (27, Cloudflare), SAPL (24),
`instar`, `sinsoft`. Exemplo: Protásio Alves (restrição a veículos de 7 eixos/PBTC > 45 t).

**MT** (142) — **AMM-MT** (SIGPub) cobre 141; muito ruído (ISS, frota, "motorista de veículos pesados") → 71 cidades DR.
Portais: SAPL (45 na fila), portal próprio, **MPX** (13; cliente heurístico ok), Siscam (Sorriso).

**MS** (79) — Diário dos Municípios no SIGPub com slug **`/ms`** (`/assomasul` dá 404) cobre 56. Portais: portal próprio,
SAPL, `instar`, `webline`, `siscam`. Alguns sites de prefeitura (ex.: amambai.ms.gov.br) dão 403 ao IP da nuvem.

**GO** (246) — **AGM** (108) e **FGM** (62) no SIGPub; 72 sem diário. Portais: **NucleoGov** (22 na fila; JS + 403 ao nosso
IP — sem cliente; usar SAPL da Câmara, AGM e site da prefeitura), portal próprio, SAPL.

**Querido Diário** (187 cidades do Sul/CO com spider): API `api.queridodiario.org.br` lenta (~40 s) e instável (520);
os arquivos estáticos `data.queridodiario.ok.org.br/<ibge>/<data>/<hash>.txt` não dependem da busca.

**Pé na Estrada**: só Florianópolis tem página no Sul/CO (frente profunda). Não procure lá para as outras.

---

## 5. Busca padrão (termos que dão acerto)

Diários (frase; no SIGPub vira E-lógico entre palavras): "circulação de caminhões", "trânsito de caminhões", "tráfego de
caminhões", "tráfego de veículos pesados", "circulação de veículos pesados", "veículos de carga", "carretas", "betoneiras",
"bitrem", "toneladas", "eixos", "zona de restrição", "estacionamento de caminhões".

Portais (substring na ementa; mande variantes com e sem acento):
`caminh|veículos pesados|veiculos pesados|veículo de carga|veiculos de carga|carga e descarga|tráfego|trafego|trânsito|transito|tonelad|eixos|carreta|betoneira|bitrem|zona de restrição|zona de restricao`.

Ementas que acertam: "Proíbe a circulação/o tráfego de caminhões...", "Disciplina o trânsito de caminhões...",
"Regulamenta a proibição do tráfego de veículos de carga na ponte...", "Dispõe sobre a restrição de circulação de
veículos com N eixos", "Dispõe sobre medidas a serem adotadas na circulação de carretas e caminhões-betoneiras".

---

## 6. Armadilhas

* **Ruído dos diários SIGPub** (AMP/FAMURS/AMM-MT/AGM/MS): sem frase exata; "veículos pesados" casa cargo de motorista,
  dotação "Veículos Pesados" de orçamento, lista de serviços do ISS ("11.04 – armazenamento, carga, descarga"), servidão
  administrativa, cadastro de produtores para uso de caminhões da prefeitura. O título "LEI"/"DECRETO" não basta.
* **Lei orgânica / código de trânsito municipal / lei do sistema viário** com "fixar a tonelagem máxima" ou "estabelecer
  rotas" é só competência/diretriz → não é regra. Idem **plano diretor / plano de mobilidade** ("criar rota", "retirar
  veículos pesados das zonas residenciais"), salvo quando o próprio plano proíbe com vias e horários.
* **Placa "proibido trânsito de caminhões" em licitação** = pista fraca de sinalização, não ato.
* **Restrição temporária** (evento, obra, alta temporada de um ano específico) → `pontual`, a não ser que o ato seja
  permanente/recorrente (aí regra com `vigencia`/janelas).
* **Estrada rural em dia de chuva** e **ponte com limite de peso**: regras reais, mas confira se é via municipal (ponte em
  rodovia estadual = DER).
* **Revogação**: sempre procure ato posterior com o mesmo número/assunto (ex.: Apucarana: Lei 182/2014 revogada pela LC 006/2015).
* **Ato que delega a decreto** o perímetro (Apucarana LC 006/2015): sem o decreto/anexo a regra fica `desativada` (`status: pista` ou `regra_sem_ato`).
* **Capacidade de carga ≠ PBT** (Almirante Tamandaré Dec. 968/2015: "capacidade acima de 10 t" → `payload_t`).
* **OSM**: maxweight em rodovia (SC-135, BR-158), heliponto, `hgv=no` em trunk internacional (Corumbá). Nunca ativa regra.
* **Bloqueios — não contornar**: `leismunicipais.com.br` (Cloudflare), CESPRO (reCAPTCHA), Atende.net (captcha), NucleoGov
  (403), alguns sites de MS/SC e cianorte.pr.gov.br. Use Câmara (SAPL), diário consolidado e Querido Diário.
* **Homônimos** em SaaS por subdomínio (atende, 1doc, siscam, eloweb): confira a UF (`verificar` em `portais.json`).
* **PDF escaneado**: `pdftotext`; se vazio, OCR (`tesseract -l por`), anotando "OCR" em `fontes_consultadas`.

---

## 7. Aprendizados das ondas

**Frente profunda (84 cidades > 100 mil hab., 18/10/2026)**: 21 `regra_com_ato`, 6 `regra_sem_ato`, 6 `pontual`,
12 `pista`, 3 `sem_restricao_declarada`, 36 `nao_achou`; 17 verificadas em `verif/`. Os atos vieram sobretudo do Querido
Diário (26 bases legais), do SIGPub (23), do DOM/SC (9) e de SAPL de Câmaras — os diários consolidados são a melhor fonte
nesta região, mais que os portais.

**Triagem R1**: 50% saíram direto. O "acerto" da preparação é muito ruidoso no SIGPub (MT: 99 de 141 com acerto, quase
tudo ISS/frota): a re-pontuação mandou 306 cidades para conferência barata (DR) em vez de pesquisa cara.

(Próximas rodadas: acrescentar aqui o que funcionou e o que falhou em cada lote.)

## Aprendizado das ondas (18/10/2026)
- **DOM/SC — texto integral do ato:** a página do ato não traz o texto, mas `https://diariomunicipal.sc.gov.br/?r=ato/getHtml&id=<id>` com o header `X-Requested-With: XMLHttpRequest` devolve o texto completo. Rendeu 17 cidades com regra ativa em 2 lotes de SC. Confira alteração/revogação buscando no DOM/SC pela entidade.
- **Querido Diário:** use `api.queridodiario.org.br` via curl (o domínio `...ok.org.br` falha no TLS daqui; pelo Python dá 403).

---

## 8. Reavaliação da RODADA 2 (18/10/2026, orquestrador)

**Decisão: nenhuma fila R2 nova (parar).** Estado conferido em disco:
* Os 1.659 municípios têm `res/<ibge>.json`. Nenhuma cidade ficou sem resultado por falha do agente.
* Os 522 municípios com `falha_de_fonte: true` já estão todos nas filas das rodadas 3 e 4 (`$C/fila_r3/`): R3-FF-* (fontes que
  falharam), R3-CM-* (cobertura mínima), R3-PIS-* / R3-VER-* (pistas e verificação), R3-MT-AMM, R4-NUCLEOGOV-GO
  (`toolkit/nucleogov.py`), R4-AGM-GO, R4-ELOTECH-PR-MS, R4-PLENUS-RS e R4-SOFTCAM. Uma fila R2 repetiria esse trabalho.
* Só 2 cidades com `pista`/`regra_sem_ato` ficaram fora dessas filas: Bodoquena-MS (Dec. 058/2012 contraditório, verificado
  2 vezes) e Porto Amazonas-PR (faltam a Lei 843/2009 original e a Lei 838/2009, verificado). O que falta é consulta manual
  à prefeitura, não pesquisa automatizada.

### Aprendizados consolidados das ondas R1 (por UF e sistema)
**SIGPub (AMP, FAMURS, AGM, FGM, AMM-MT, /ms)**: `diariomunicipal.com.br/<slug>/materia/<id>` por curl devolve o ato inteiro.
Tire as tags; no AMM-MT, corte entre "Baixar a edição completa (PDF)" e "A autenticidade desta matéria". Há connection reset
de vez em quando: repita depois de 2 s. As frases limpas são "circulação de caminhões" e "trânsito de caminhões".
"veículos pesados" e "carretas" trazem quase só licitação e cargo de motorista. Para achar decreto regulamentador, busque
pelo nome do conceito ("Zona de Restrição Máxima", "Autorização Especial de Trânsito"). Acervo: AMM-MT forte em 2011-2015;
/ms até cerca de 2019. Atos mais novos saem do SAPL ou do portal.
**`diarios_consolidados.py buscar`**: dá "http 0" na 1ª tentativa e se recupera sozinho. Com `--json`, o log de retentativa
pode vir antes do JSON (parseie a partir do primeiro `[`). Cidade só no QD: use `--fonte qd`. Rode com timeout, em primeiro
plano ou uma cidade por vez.
**Querido Diário**: o `.txt` estático (`data.queridodiario.ok.org.br/...txt`) baixa por curl via proxy. Troque `.pdf` por `.txt`.
**SAPL**: a API REST funciona por curl mesmo quando o cliente diz "sem resposta reconhecível" (Bonito-MS). Confira o total sem
filtro: Cristalina, Porangatu e Lucas do Rio Verde dão 0, e base vazia não prova ausência. `texto_integral` vem em http://:
troque por https://. "caminh" casa "encaminhamento", "Caminho da Escola" e "Caminhada"; use `caminh(?!ad|ar|ei|am|ou)` e filtre
pela ementa. Em DR, rodar SAPL com `caminh|carga e descarga|corredor|mão única|tráfego` achou ato real fora do trecho anotado:
Ribas do Rio Pardo, Colniza, Nova Xavantina e Comodoro.
**NucleoLeg (GO)**: há API pública em `https://leis.<m>.go.gov.br/api/leis?per_page=100&page=N` (ou `.go.leg.br`). O campo `estrutura`
traz o texto integral. A busca é ignorada, então baixe tudo e filtre. Só leis, sem decretos. Teste antes com `per_page=1`
(Posse e Niquelândia: 200 com 0 atos).
**Instar (MS)**: o PDF da lei está em `/portal/download/legislacao/<codigo>/`, que faz meta-refresh para `/publicos/<arq>.pdf`.
O portal achou a Lei 1.246/2026 de Ladário, que nenhum diário tinha.
**WordPress de prefeitura e Câmara**: `/wp-json/wp/v2/search?search=<termo>` acha notícias e requerimentos. É pista, não ato.
**PDF imagem sem tesseract**: `pdftoppm -r 150 -png` e depois `rapidocr_onnxruntime` (python3 -I), ou ler o PNG como imagem. Anote "OCR".
**WebSearch**: rende pouco em GO. Achou a Lei 4.739/2026 de Ponta Porã-MS: vale 1 busca para cidade de 90 mil hab. ou mais sem pista.
**Bloqueios recorrentes**: NucleoGov `acessoainformacao.*` (403), leismunicipais e leis.org (Cloudflare), 1doc, CESPRO (reCAPTCHA),
MPX (fora do ar ou heurístico), Overpass (reset/504 o dia todo; use os `exemplos` de `osm_hints`). Hosts recusados pelo proxy:
belavistadegoias.go.gov.br. Hosts caídos: paranaiba e brasilandia.ms.gov.br. Guarde scripts no scratchpad (`/tmp` foi limpo).

### Convenções firmadas nas ondas
* Ato que cria zona ou rota sem listar vias ("conforme mapa anexo", "conforme sinalização", "em vias urbanas") → `regra_com_ato`
  se o ato primário foi lido. A regra fica `desativada`, com horário e peso registrados e o motivo dito. `pista` fica para quem
  só tem menção indireta ao ato (Rio Brilhante, Aquidauana).
* Lei autorizativa cujo decreto de rotas nunca saiu (Jaraguá-GO) → `regra_sem_ato`.
* "Corredor de deslocamento"/"rota de caminhões" que designa a rota sem vedar o resto → regra desativada, confiança baixa.
* Proibição em "todas as vias do município" (Alto Horizonte) → zona urbana sem rodovias estaduais ou federais, com geometria manual.
* Janela inferida ("permitida das 19h às 5h") → janela inversa em regra desativada, confiança baixa.
* Lei nova sem revogação expressa da anterior (Ladário 14 t × 23 t) → anterior revogada tacitamente, confiança média.
* Cláusula revogatória que cita o decreto errado (Brasilândia) → revogada com confiança baixa e nota de possível erro material.
* Separe estacionamento de circulação (Lucas do Rio Verde, Alto Garças). Uma restrição a ônibus não é restrição a caminhão (Colíder).
* Ruído confirmado em todas as UFs: ISS 11.04; plano de cargos; PPA/LDO; frota; lei orgânica com "fixar a tonelagem"; leis de
  órgão de trânsito/JARI ("escolta de cargas superdimensionadas"); uso do solo com "estacionamento de caminhões"; decreto de
  "situação de emergência"; taxa de serviço por veículo pesado.
* `falha_de_fonte`: false só quando uma fonte cobre o período e não teve acerto. Fica true quando a única fonte foi o diário
  antigo (AMM-MT 2011-2015, /ms até 2019) e o portal era bloqueado ou heurístico (o cliente `portal_proprio` devolve 0 mesmo com o site no ar).
