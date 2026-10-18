# toolkit/ — ferramentas compartilhadas da pesquisa municipal (Sul e Centro-Oeste: PR, SC, RS, GO, MT, MS, DF)

Tudo aqui é **somente leitura** (GET/POST de formulário de busca público). Não chama o Valhalla, não escreve no repo fora de `docs/research/cidades_sul_co`.
Português do Brasil. Portais mapeados em 18/10/2026 (1.659 municípios de `../municipios.csv`).

| arquivo | para quê |
|---|---|
| `legislacao.py` | busca de **atos normativos** (leis, decretos, portarias) nos sistemas de legislação da prefeitura/câmara de cada município |
| `../leads/portais.json` | mapa dos 1.659 municípios → sistema de legislação da prefeitura e da câmara, URL de busca, se o cliente foi testado e todas as fontes achadas |
| `diarios_consolidados.py` | busca em **diários oficiais consolidados**. Ver o docstring no topo do próprio arquivo; lead pronto em `../leads/diarios_consolidados.json` |
| `../portais_work/` | scripts e caches que geraram o `portais.json` (ver seção 5) |

---

## 1. Uso rápido (agente de pesquisa por cidade)

```bash
cd /home/user/brazaway/docs/research/cidades_sul_co/toolkit
python3 legislacao.py info 4100459                       # o que se sabe do município (portais.json)
python3 legislacao.py buscar 4100459 "caminh|carga e descarga|veículos pesados|veiculos pesados|tráfego|trafego"
python3 legislacao.py buscar 4100459 "caminhões" --principal --json --max 50   # só a melhor fonte, saída JSON
python3 legislacao.py buscar 5003504 "caminhões" --fonte camara                 # só fontes da Câmara
python3 legislacao.py direto sapl https://sapl.campinas.sp.leg.br "carga e descarga"   # instância avulsa
python3 legislacao.py sistemas                            # clientes disponíveis
python3 legislacao.py testar webline 3 "trânsito"         # roda o cliente em 3 municípios daquele sistema
```

Saída texto: `TIPO NUM/ANO | data | ementa | url` por ato, com cabeçalho `## sistema @ base (órgão) termos={termo: total} atos=N`
e `ERRO:`/`obs:` quando houver. `--json` devolve
`{"ibge","nome","uf","resultados":[{"sistema","base","orgao","total","termos","atos":[{tipo,numero,ano,data,ementa,url,situacao,...}],"erro","obs"}]}`.

Opções: `--max N` (por termo e fonte, padrão 100) · `--texto` (busca também no texto integral onde o sistema permite:
SAPL/SAGL/Siscam/Instar/Portal Fácil/Legislação Digital) · `--fonte camara|prefeitura` · `--principal` (só a 1ª fonte com cliente)
· `--sem-wp` (ignora a busca geral de sites WordPress).

### Como montar os termos
* Quase todos os sistemas buscam **substring na ementa**; vários são **sensíveis a acento**. Passe variantes separadas por `|`:
  `"caminh|carga e descarga|veículos pesados|veiculos pesados|tráfego|trafego|trânsito|transito|VUC|zona de restrição|zona de restricao"`.
* Radical curto (`caminh`) pega caminhão/caminhões (busca por substring). Acento: SAPL é sensível (Campinas: `caminh` = 88, `caminhoes` = 3);
  Instar não é (Araújos: `transito` = `TRÂNSITO` = 6). Na dúvida, mande as duas grafias.
* Resultado é **pista**: abra a `url` do ato e confira número, data, artigo e vigência antes de usar (regra ATIVA só com ato primário conferido).

### Quando o sistema principal não tem cliente
| situação (campo `sistema`) | o que fazer |
|---|---|
| `leismunicipais` (leismunicipais.com.br / leis.org) | **403 Cloudflare** para curl e WebFetch — não contornar. Use as outras `fontes` do município (Câmara: SAPL/Siscam/SPL…), `diarios_consolidados.py` e Querido Diário |
| `legislacaodigital` em `www.legislacaodigital.com.br` | mesmo bloqueio (o cliente devolve erro explícito). Domínio próprio (ex.: `legislacao.limeira.sp.leg.br`) funciona. Instâncias **Siscam antigo** costumam listar as mesmas normas com link para o Legislação Digital — use o Siscam |
| `cespro` | pesquisa com reCAPTCHA — sem automação; abrir manualmente (WebFetch) ou usar outra fonte |
| `atende` (IPM Atende.net) | SPA Vue; a pesquisa (`atende.php?rot=25040`) fica atrás de captcha/anti-robô — **não automatizada**. O cliente só confirma que o módulo existe e devolve a URL `/autoatendimento/servicos/legislacao-municipal/detalhar/1`. Usar a Câmara / diário / Querido Diário |
| `nucleogov` (GO: `acessoainformacao.<m>.<uf>.gov.br/cidadao/legislacao/...`) | lista montada por JS (`static.nucleogov.com.br`); sem cliente. O host passou a responder 403 ao IP desta pesquisa depois do mapeamento — abrir à mão |
| `plenus`, `1doc`, `diario`, `manual` | sem busca automática; `url_busca` aponta a página certa (`obs` explica) |
| `portal_proprio` | cliente **heurístico** (preenche o formulário de busca da página e extrai "Lei/Decreto nº X/AAAA" ao redor). Só pista; se vier vazio, abra `url_busca` com WebFetch |
| `desconhecido` | não achamos página de legislação; `url_busca` = home do site (quando há). Procurar à mão (WebFetch) e/ou diários |

---

## 2. `../leads/portais.json`

```json
{"4100459": {
  "nome": "Altamira do Paraná", "uf": "PR",
  "sistema_prefeitura": "elotech",       // sistema de legislação da prefeitura (ou portal_proprio / desconhecido / nao_encontrado / inacessivel)
  "sistema_camara": "portal_proprio",    // idem, da Câmara
  "url_busca": "https://altamiradoparana.oxy.elotech.com.br/portaltransparencia/1/leiseatos-geral/geral",  // melhor fonte (testada > com cliente > específica)
  "testado": true,                       // o cliente da fonte principal rodou sem erro no teste de fumaça (termo "trânsito")
  "sistema": "elotech", "orgao": "prefeitura", "cliente": true,      // idem, da fonte principal (compatível com legislacao.py)
  "url_busca_prefeitura": "...", "url_busca_camara": "...",
  "sites": {"prefeitura": "https://...", "camara": "https://..."},   // home confirmada (null = não achada/inacessível)
  "fontes": [ {"orgao","sistema","base","url_busca","evidencia":[...],"cliente","testado",
               "teste":{"termo","total","quando","erro"}, "verificar", "plataforma", "obs"} , ... ]
}}
```
* `fontes` vem **ordenada** (melhor primeiro: testada ok, depois com cliente, depois sistema específico; câmara antes de prefeitura no empate). Inclui até ~5 alternativas por órgão.
* `testado`: `true` (cliente rodou ok), `false` (rodou com erro — ver `teste.erro`), `null` (sem cliente automático / não exercitado).
* `evidencia`: `home` (a própria home já é o sistema), `link:<texto>` (link "Legislação/Leis" achado no site oficial e aberto), `dns:sapl` / `dns` (host por padrão de domínio respondeu e a página bate com o município), `desafio/bloqueio:<status>`.
* `verificar`: SaaS por subdomínio (atende/1doc/siscam/eloweb...) sem UF no domínio nem "Município/UF" na página — confira que não é homônimo de outro estado.
* Elotech: o cliente lê as entidades da API (`obs: entidades: CIDADE/UF`); fontes com UF diferente da do município são descartadas na consolidação.
* Brasília (DF): sem prefeitura/câmara municipal; entrada `manual` apontando para SINJ-DF.
* Descoberta: Wikidata (P856) + padrões de domínio (`<m>.<uf>.gov.br`, `<m>.<uf>.leg.br`, `cm<m>`, `camara<m>`, `sapl.<m>.<uf>.leg.br`, `<m>.atende.net`, `<m>.1doc.com.br`, `<m>.siscam.com.br`, `<m>.cespro.com.br`, `acessoainformacao.<m>...`, ...) + fingerprint da home e dos links de legislação (domínio inexistente = CONNECT 502 no proxy).

### Cobertura (18/10/2026)
* 1.659 municípios; home da **prefeitura** confirmada em 1.512 e da **Câmara** em 1.400; 1.600 com pelo menos uma fonte; **591** com a fonte principal testada ok (cliente automático rodou).
* Por UF (testado ok / total): GO 39/246 · MS 31/79 · MT 101/142 · PR 236/399 · RS 117/497 · SC 67/295 · DF 0/1.
* Principal por sistema: portal_proprio 410 · sapl 355 · leismunicipais 201 · nucleogov 152 · cespro 142 · atende 57 · desconhecido 42 · 1doc 41 ·
  webline 33 · instar 30 · mpx 26 · elotech 20 · sinsoft 18 · legislacaomunicipal 18 · legislador 15 · leisnaweb 11 · megasoft 9 · siscam 7 · cr2 4 · cittatec 4 · legissuper 2 ·
  betha/cidade360/manual 1 · nao_encontrado 59.
* Prefeituras (sistema): portal_proprio 281 · leismunicipais 280 · cespro 219 · nucleogov 174 · 1doc 153 · atende 138 · instar 38 · elotech 31 · mpx 25 · sem site achado 146 (+133 site sem página de legislação identificada/bloqueado).
* Câmaras (sistema): sapl 357 · portal_proprio 356 · nucleogov 174 · leismunicipais 170 · atende 83 · cespro 79 · webline 34 · cittatec 24 · sem site achado 258.
* Sem automação possível nem com cliente: leismunicipais (Cloudflare), cespro (reCAPTCHA), atende (captcha), nucleogov (JS + 403 ao nosso IP), 1doc, cittatec (Angular) — para esses use a outra fonte do município, diário oficial e Querido Diário.

---

## 3. Clientes (`legislacao.py`) e testes

Teste de fumaça = `buscar_em(sistema, base, ["trânsito"], 5)` em **todas** as fontes com cliente (`../portais_work/smoke.py` -> `smoke.jsonl`).
"ok" = rodou sem erro (para o heurístico `portal_proprio`: extraiu ≥1 ato).

| sistema | o que é / como busca | fontes ok/testadas | exemplos testados ok |
|---|---|---|---|
| `sapl` | SAPL 3 Interlegis — API REST `/api/norma/normajuridica/?ementa__icontains=` (delega a `sagl` se for Zope) | 355/368 | Alvorada do Norte/GO, Anápolis/GO, Caldas Novas/GO |
| `siscam` | Sino Siscam (novo e antigo) | 7/10 | Jaraguari/MS, Sorriso/MT, Guaíra/PR |
| `instar` | Instar `/portal/leis_decretos/…` (ementa) | 41/46 | Douradina/MS, Inocência/MS, Ivinhema/MS |
| `webline` | Webline Sistemas (`?pag=…&idtipolei=N&descricao=`) | 67/68 | Bataguassu/MS, Paranaíba/MS |
| `elotech` **(novo)** | Elotech Oxy / eloweb — API pública `…/portaltransparencia-api/api/leisatos?entidade=&exercicio=&subAbaLeiAtos=geral&descricaoSumula=` (ementa; sem acento diferente) | 28/33 (as 5 falhas: variante de API diferente ou 502) | Altamira do Paraná/PR, Antonina/PR, Andirá/PR |
| `atende` **(novo, parcial)** | IPM Atende.net: pesquisa atrás de captcha/anti-robô — **sem busca**; confirma o módulo e devolve a URL | n/a (erro explícito por desenho) | confirmação de módulo em Entre Rios do Oeste/PR, Anahy/PR, Sumaré/SP (host `*.atende.net`) |
| `nucleogov` **(novo, stub)** | só devolve erro explicativo (lista por JS; host bloqueou nosso IP) | n/a | — |
| `mpx` `legislador` `legislacaomunicipal` `leisnaweb` `megasoft` `cr2` `legissuper` `sinsoft` **(novos, via heurístico genérico)** | formulário de busca + regex de "Lei/Decreto nº" | 46/46 · 20/21 · 27/32 · 15/15 · 11/11 · 8/8 · 5/5 · 17/18 | MPX: Campo Grande/MS, Naviraí/MS, Alto Garças/MT; Legislador: Colorado/PR, Ipiranga/PR; Leis na Web: Gentil/RS; Sinsoft: André da Rocha/RS; Legislação Municipal: Anchieta/SC |
| `legislacaocompilada` `nopapercloud` `spl` | SPL (ASP.NET): POST em `/legislacao/` | 0/1 (poucas instâncias no Sul/CO) | — |
| `portal_proprio` | heurístico genérico | 81/637 (**baixo**: muitos portais próprios são JS, WordPress sem módulo de normas ou páginas erradas — conferir `url_busca` à mão) | Cachoeira Dourada/GO |
| `portalfacil`, `legislacoes_dt`, `legver`, `docman`, `wordpress`, `sagl`, `legislacaodigital`, `sp_catalogo`, `domino` | clientes herdados do Sudeste, mantidos | não aparecem como principal no Sul/CO | ver README do Sudeste |

Notas de rede:
* O proxy da nuvem só aceita HTTPS; o `http()` do toolkit e os scripts de descoberta reescrevem `http://` -> `https://` (inclusive em redirecionamentos).
* Algumas câmaras (SoftCam, PR/SC) mostram a página "Bot Verification" a User-Agents de navegador, mas servem a página real ao curl puro: o `http()` repete uma vez com `curl/8.5.0` quando vê essa página (não é captcha).
* **Bloqueios por WAF depois da varredura** (não contornados): NucleoGov (`*.nucleogov.com.br` e `acessoainformacao.*`), alguns sites de MS/SC (ex. amambai.ms.gov.br, sangao.sc.gov.br) passaram a responder 403/reset ao IP desta pesquisa. Cloudflare "Just a moment" (ex. cianorte.pr.gov.br) idem. Marcados como `desconhecido`/`bloqueado`; tentar de outro IP/mais tarde.

---

## 4. Fluxo recomendado para o orquestrador

1. Ordem: `../prioridade.json` (frota de caminhões) — começar pelos maiores.
2. Por município: `legislacao.py info <ibge>` (sistemas e `url_busca`) + `legislacao.py buscar <ibge> "<termos>" --json` (todas as fontes) +
   `diarios_consolidados.py lead <ibge>` → abrir os atos candidatos (WebFetch/curl na `url`) → conferir artigo/vigência.
3. Agrupar agentes **por sistema** ajuda (mesma forma de ler o ato), mas respeite **um pedido por host** e no máximo ~4 simultâneos
   no Interlegis (`sapl.*.leg.br`) e nos SaaS compartilhados (siscam.com.br, atende.net, 1doc.com.br, cespro.com.br).
4. Cota de WebSearch é baixa (≤2 por agente): use `url_busca`/`sites` daqui antes de pesquisar na web.
5. Para quem tem `sistema` sem automação (leismunicipais/cespro/atende/nucleogov): abrir `url_busca` com WebFetch e, se for SPA/captcha, trocar para a fonte alternativa em `fontes`.

---

## 5. Como regenerar / retomar (`../portais_work/`)

Todos os passos gravam `fetch.jsonl` (cache de GET, uma linha por URL) e pulam o que já fizeram — se cair, rode o mesmo comando de novo.
```bash
cd ../portais_work
python3 wikidata.py          # sites oficiais (P856) por IBGE -> wikidata_sites.json
T=48 python3 descobrir.py    # fase A: hosts candidatos de prefeitura/câmara (≈50 mil URLs; CONNECT 502 = domínio inexistente)
python3 descobrir2.py        # fase A2: padrões extras (SaaS, .leg.br, .com.br, acessoainformacao.*, transparencia.*)
python3 refaz.py erros|nx    # repete falhas transitórias (nx tem ~0,1% de falso negativo)
python3 sites.py             # escolhe sites vivos e válidos (nome no título/corpo, UF) -> sites.json
python3 pag2.py              # fase C: segue os links de legislação das homes
python3 classifica.py        # sistema por órgão (regras de URL/host) -> classif.json (só lê o cache)
python3 consolida.py         # -> ../leads/portais.json (usa smoke.jsonl p/ 'testado')
python3 smoke.py             # teste de fumaça dos clientes (REFAZ=1, SO=<sistema>, T=<threads>) -> smoke.jsonl ; depois consolida.py de novo
```
`html/` (cache gz das páginas, ~450 MB) é ignorado pelo git e pode ser apagado; `fetch.jsonl` guarda só metadados. Se apagar `html/`, `classifica.py` perde o conteúdo — refaça `descobrir.py`/`pag2.py`.

## 6. Limitações
* Descoberta por padrão de domínio + Wikidata: 100 prefeituras e ~260 câmaras sem home achada (muitas câmaras RS/PR/SC têm domínio próprio fora dos padrões) — podem usar sistema que não vimos; 59 municípios sem nenhuma fonte.
* Homônimos: SaaS por subdomínio sem UF → `verificar: true` (101 fontes).
* O teste de fumaça prova que o cliente **funciona** naquela instância, não que a base esteja completa ou atualizada.
* Atende.net, NucleoGov, CESPRO e Leis Municipais, os mais comuns na região, **não têm busca automática** (captcha/JS/Cloudflare/403) — são ~45% das prefeituras.
* Nenhum ato, artigo ou horário foi inferido aqui — este mapa só diz **onde** e **como** buscar.

---

## 7. Diários consolidados do Sul/Centro-Oeste (PR, SC, RS, GO, MT, MS, DF) — gerado em 18/10/2026

`diarios_consolidados.py` foi estendido (mesma CLI) para o Sul/Centro-Oeste; `municipios.csv` (ibge;nome;uf) é a base de municípios.
Lead pronto: **`../leads/diarios_consolidados.json`** → `{ibge: {nome, uf, diario, acertos, ocorrencias:[{data, titulo, trecho, url, fonte, score, motivos...}], indicios[...], fontes_que_cobrem, ...}}`
(`diario` = nome(s) do(s) diário(s) que cobrem o município; `acertos` = ocorrências com score ≥ 6 — ≥ 8 no Querido Diário — já sem duplicatas; `_meta` traz critério, termos, cobertura por diário e `sem_diario_consolidado` por UF).

```bash
python3 diarios_consolidados.py lead 4106902                          # o que a varredura achou (Curitiba)
python3 diarios_consolidados.py buscar 4209102 "veículos pesados"      # busca nova (Joinville) nos diários que a cobrem
python3 diarios_consolidados.py buscar "Pelotas/RS" "carga e descarga" --json
python3 diarios_consolidados.py fontes                                 # cobertura medida de cada diário
# regenerar / retomar (tudo retomável; se cair, rode de novo):
python3 diarios_consolidados.py cobertura --fontes sul_co,qd
python3 diarios_consolidados.py varrer-municipios --fontes sul_co --sem-consolidar   # termos x cada município coberto
python3 diarios_consolidados.py varrer-municipios --fontes qd --sem-consolidar
python3 diarios_consolidados.py varrer --fontes sul_co --sem-consolidar              # varredura global por termo
python3 diarios_consolidados.py consolidar
```
`lead` mostra só o consolidado; `buscar` consulta o diário ao vivo (mostra `score` e `url`). Lead **não é prova**: abrir a `url`, conferir
número, data, artigo e vigência do ato. Municípios com `acertos=0` e `fontes_que_cobrem` não vazio foram varridos sem achado (só nos termos/períodos abaixo).

### Cobertura de cada diário (medida em 18/10/2026)
| fonte | diário | UF | municípios cobertos | como busca / observações |
|---|---|---|---|---|
| `domsc` | DOM/SC (FECAM/CIGA) `diariomunicipal.sc.gov.br` (sem `www`: o `www` redireciona) | SC | **294 de 295** (falta 1) | Solr; q + data + categoria + `codigoEntidade`. Paginação só funciona pelas rotas `r=site/portal` (com entidade) ou `r=site/index`; **sem data o site assume só as últimas 3 semanas** (o cliente sempre manda `dataInicial=01/01/2000`); teto 20 páginas (200 resultados) por consulta; OR só entre parênteses e ≤ ~8 frases por URL (senão 400); ordem por data decrescente. Entidades sem estatística (ex.: Joinville) são tratadas como ativas. |
| `famurs` | FAMURS `diariomunicipal.com.br/famurs` | RS | **270 de 497** | SIGPub; busca E-lógica por palavras (sem frase exata), 25 por página, relevância, teto 1.000/consulta. Entidades ≠ município (consórcios) ficam sem município. |
| `amp` | AMP `diariomunicipal.com.br/amp` | PR | **182 de 399** | idem. Curitiba, Londrina, Maringá etc. **não** estão (têm diário próprio → Querido Diário). |
| `agm` | AGM `diariomunicipal.com.br/agm` | GO | **108 de 246** | idem; alguns itens "Município de X" ambíguos ficam sem município. |
| `fgm` | FGM `diariomunicipal.com.br/fgm` | GO | **62** (sobrepõe parte do AGM) | idem. |
| `amm-mt` | AMM-MT `diariomunicipal.com.br/amm-mt` | MT | **141 de 142** | idem. |
| `ms` | ASSOMASUL `diariomunicipal.com.br/ms` (o slug `/assomasul` dá 404) | MS | **56 de 79** | idem. |
| `qd` | Querido Diário (API) | todas | **187** (SC 63, PR 46, RS 40, GO 16, MS 14, MT 7, DF 1) | só as cidades com spider; 82 delas não estão em nenhum outro diário (inclui Curitiba, Goiânia, Porto Alegre, Campo Grande, Londrina, Brasília). Varrido por cidade com 4 frases, 1 página de 10 diários (API lenta, 520 frequente); só as cidades sem outro diário + as 40 maiores. |

Municípios sem nenhum diário consolidado: ver `_meta.sem_diario_consolidado` do JSON (por UF) — para eles use `legislacao.py` (portais municipais) e os sites das prefeituras/câmaras.
Não cobertos por esta ferramenta (avaliados, sem busca automatizável por aqui): `assomasul.org.br` e `agm.org.br` (403), portais próprios de capitais
(Curitiba, Goiânia, Campo Grande, Cuiabá, Brasília: proxy 502 ou JS), `diariomunicipal.com.br/amm-go` e `/assomasul` (inexistentes). Querido Diário é o caminho para as capitais.

### Como a varredura foi feita
* **Por município** (`varrer-municipios`): SIGPub = 8 termos (`caminhões circulação`, `veículos pesados`, `veículos carga`, `carga descarga`, `zona restrição`, `trânsito pesado`, `VUC`, `toneladas caminhões`; E-lógico) × entidades Prefeitura/Câmara do município, 1ª página (25 por relevância).
  DOM/SC = 3 consultas (OR de frases: circulação/tráfego/trânsito de caminhões, veículos pesados, veículos de carga, VUC | carga e descarga, zona de restrição, trânsito pesado, tráfego pesado, veículo urbano de carga | caminhões/caminhão/carretas/bitrem) × categorias Leis, Decretos, Portarias, Instrução Normativa, Resoluções × Prefeitura, todas as páginas (até 20).
* **Global por termo** (`varrer`): 16 termos (ver `SUL_CO_TERMOS`) em cada diário; SIGPub ainda por filtro de título (todos | decreto | lei | portaria) para furar o ruído de licitação; DOM/SC por categoria normativa (teto 200).
* **Pontuação** (`pontua`): regex em título+trecho — veículo pesado/carga + circulação + restrição/horário/ato normativo − ruído de licitação/contrato/frota/covid. Duplicatas (mesma fonte+data+título+trecho) são fundidas.
* "toneladas" entra como `toneladas caminhões` (SIGPub), `(toneladas AND caminhões)` (varredura global DOM/SC) e como pontuação de limite em t no texto.

### Limitações
* SIGPub não tem frase exata: "veículos pesados" casa "veículos leves, pesados"; muito ruído de compras/licitações/RH ("Motorista - Veículos Pesados"). Os hits de maior score são os melhores pistas, mas **todo** achado exige leitura do ato.
* Varredura por município do SIGPub olha só os 25 mais relevantes por termo; a global tem teto de 1.000 por consulta; DOM/SC, 200 (global) e 200 por consulta/categoria (município).
* Atos de categorias fora da lista (ex.: "Outras publicações", "Edital") no DOM/SC não foram varridos por município; Câmaras (resoluções) só entram quando aparecem nas varreduras globais/SIGPub.
* Acervo anterior à adesão do município ao diário não existe (DOM/SC desde ~2013; SIGPub desde 2009 conforme a adesão). Leis antigas (anos 80-2000) estão em `legislacao.py`/portais.
* Retentativas: a rede/proxy às vezes derruba conexões (`http 0`); o cliente retenta (5 s … 180 s) e o `estado.json`/`progresso_*.jsonl` permitem retomar.

### Resultado da varredura (18/10/2026)
* `../leads/diarios_consolidados.json`: 1.187 municípios (cobertos por ≥ 1 diário), **647 com ao menos um acerto** (score ≥ limiar). Por UF (no arquivo / com acerto / só indício / cobertos sem achado): SC 294/234/44/16 · PR 218/171/17/30 · RS 297/66/39/192 · GO 174/38/23/113 · MT 141/99/23/19 · MS 62/38/4/20 · DF 1/1/0/0.
* Sem nenhum diário consolidado (`_meta.sem_diario_consolidado`): PR 181 · RS 200 · GO 72 · MS 17 · MT 1 · SC 1 · DF 0.
* Bruto por diário e progresso: `../leads/diarios_consolidados_raw/` (`hits_<fonte>.jsonl`, `progresso_<fonte>.jsonl`, `estado.json`, `cobertura.json`, `log.txt`).

---

## 6. `nucleogov.py` — API pública dos diários NucleoGov (GO) — R4 2026-10-18

O portal `acessoainformacao.<m>.go.gov.br` dá 403, mas quando o município usa o **diário NucleoGov**, `https://dom.<dominio>/api/...` responde JSON sem login
(Laravel, 150 req/min): `/api/diarios` (edições, ordem decrescente), `/api/materias?search=<termo>&per_page=50&page=P` (texto integral em `texto`, `titulo`, `tipo.descricao`, `diario.data`), `/api/orgaos`.
`/api/legislacao|leis|atos|normas|tipos` devolvem o HTML da SPA (não existem como API). A busca ignora acento.

```bash
python3 nucleogov.py descobrir 5214606            # acha dom.* e mostra a faixa do acervo (primeiro/último diário, nº de matérias)
python3 nucleogov.py buscar 5214606 --termos "caminhões,toneladas" --saida /tmp/x.json
python3 nucleogov.py lote ../fila_r3/R4-NUCLEOGOV-GO.json /tmp/saida --workers 8
```
Como módulo: `descobrir(nome, sites)`, `acervo(host)`, `buscar(host, termo)`, `varrer(host)`, `relevante(m)` (pontua: ato normativo + veículo pesado + restrição; licitação/ata/extrato rebaixa).

**Resultado da varredura (82 cidades GO com portal NucleoGov na lista):** só **2** têm `dom.*` — Niquelândia (acervo 2023-04 a 2026-10, 339 edições, só licitações/atas/portarias de pessoal, nenhum ato de trânsito) e Abadia de Goiás (1 edição, 2025-11-26, 0 matérias). Nos outros 80 o host `dom.<slug>.go.gov.br` não existe (o proxy responde 502 no CONNECT).
Os municípios com acervo desde 2018 ou antes (critério para negativo conclusivo) não apareceram: o DOM NucleoGov é recente (2023+), então `falha_de_fonte` permanece como estava. Outros diários citados nas homes: Gameleira de Goiás e Trindade (`diariomunicipal.com.br/agm/`), Caldas Novas (`caldasnovas.integrame.app.br/app/#/site/diario-oficial`), Jataí (`intranet.jatai.go.gov.br/.../diario-site.php`), Vicentinópolis (Câmara `/diariooficial`).

---

## 8. `sigpub_texto.py` — texto integral no SIGPub (AGM/FGM, GO) por entidade — R4-AGM 2026-10-18

O SIGPub (`diariomunicipal.com.br/<assoc>/pesquisar`, GET `busca_avancada[texto|titulo|entidade|dataInicio|dataFim|ordenacao|pagina]`) já é a busca de texto integral
(E lógico, 25/pág., teto 10.000); não há API JSON separada. O que faltava: **entidade + faixa do acervo**. `texto` vazio + `entidade` lista tudo, e `ordenacao=antiga|recente` dá a primeira/última data e o total.
```bash
python3 sigpub_texto.py faixa 5221403                      # entidades do município em AGM/FGM + faixa/total
python3 sigpub_texto.py varrer 5221403 --saida /tmp/x.json  # 6 termos x (todos|decreto|lei|portaria) x 2 págs; score + 'plausivel'
python3 sigpub_texto.py lote ../fila_r3/R4-AGM-GO.json /tmp/saida
```
* O seletor de entidades do AGM traz nomes truncados ("Município de Abadia", "Município Gameleira", "Municipal de São Francisco", "Município de Montes Claros"...) que `resolve_entidade` deixa sem IBGE; `ALIAS` no módulo os mapeia (conferido: o cabeçalho das matérias diz ESTADO DE GOIÁS). Entidades como "Município de Niquelandia", Goianésia e Uruaçu existem mas estão **vazias** (0 matérias): a prefeitura não publica ali.
* Das 82 cidades do lote R4-AGM-GO, **26 são entidades** (AGM 20, FGM 6; 4 delas vazias): Abadia, Campestre, Corumbá(vazia), Cristalina, Gameleira, Goianira, Guarani, Ipiranga, Iporá, Lagoa Santa, Montes Claros, Niquelândia(vazia), Nova Iguaçu, Palmeiras, Petrolina, Pilar, Porangatu, Posse, São Francisco, Trindade (AGM); Diorama, Goianésia(vazia), Mineiros, Planaltina, Uruaçu(vazia), Teresina (FGM). As outras 56 não estão em nenhum SIGPub de GO.
* Faixa do acervo (primeira matéria): 2011 Diorama, Mineiros; 2013 Iporá, Lagoa Santa, Palmeiras; 2014 Abadia, Campestre, Guarani; 2015 Montes Claros; 2017 Ipiranga, Petrolina (só até 03/2021); 2018 Trindade (01), Posse (04), Gameleira (06); 2020 Planaltina; 2021 Goianira, Porangatu, Nova Iguaçu, São Francisco, Teresina; 2022 Cristalina; 2024 Pilar (só até 05/2025).
* Resultado: nenhum ato de restrição de circulação de caminhões novo. Em Trindade, os acertos plausíveis eram os já tratados (Decretos 606/2019, 505/2023, 737/2024, 2.960/2026 da Romaria), Portaria 009/2021 (acesso de caminhões ao aterro: só pesagem), Decreto 3.012/2026 (caminhão-pipa no Parque Lara Guimarães) e Lei 2.406/2025 art. 34 (carga e descarga x estacionamento rotativo). Negativo conclusivo (acervo ≤ 2018 e ≥ 500 matérias): Abadia de Goiás, Diorama, Gameleira de Goiás, Guarani de Goiás, Ipiranga de Goiás, Iporá, Lagoa Santa, Mineiros, Montes Claros de Goiás, Palmeiras de Goiás, Posse, Trindade → `falha_de_fonte=false` (a entidade pode não publicar tudo no AGM; relevância limita a ~50 matérias por consulta).
* Diários próprios: Vicentinópolis (Câmara) `/diariooficial` → 302 para `/ops/404` (inexistente); a "Legislação" da Câmara tem ~20 documentos e a busca (POST `/legislacao/filter`) para caminh/pesad/tonel dá 0. Jataí e Caldas Novas já tinham sido varridos (R3). SAPL das Câmaras .go.leg.br: só Cristalina, Porangatu e Uruaçu têm API (vazias ou 77 normas); o resto sem SAPL.
