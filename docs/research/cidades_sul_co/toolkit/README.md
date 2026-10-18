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
