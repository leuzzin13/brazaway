# toolkit/ — ferramentas compartilhadas da pesquisa municipal (Sudeste)

Tudo aqui é **somente leitura** (GET/POST de formulário de busca público). Não chama o Valhalla, não escreve no repo.
Português do Brasil. Gerado em 10/10/2026.

| arquivo | para quê |
|---|---|
| `legislacao.py` | busca de **atos normativos** (leis, decretos, portarias) nos sistemas de legislação da prefeitura/câmara de cada município |
| `../leads/portais.json` | mapa dos 1.668 municípios → sistema de legislação, URL de busca, se o cliente foi testado e todas as fontes achadas |
| `diarios_consolidados.py` | busca em **diários oficiais consolidados** (AMM-MG, DOM-ES, DOE-SP municípios etc.). Ver o docstring no topo do próprio arquivo; lead pronto em `../leads/diarios_consolidados.json` |

---

## 1. Uso rápido (agente de pesquisa por cidade)

```bash
cd /private/tmp/claude-501/-Users-arthurleuzzi-Projetos-truck-router/391889ae-a946-45ef-a0f8-d122c8f49438/scratchpad/cidades/toolkit
python3 legislacao.py info 3549904                       # o que se sabe do município (portais.json)
python3 legislacao.py buscar 3549904 "caminh|carga e descarga|veículos pesados|veiculos pesados|tráfego|trafego"
python3 legislacao.py buscar 3549904 "caminhões" --principal --json --max 50   # só a melhor fonte, saída JSON
python3 legislacao.py buscar 3304557 "caminhões" --fonte camara                 # só fontes da Câmara
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
| `atende` (IPM Atende.net) | portal do cidadão em JS; módulo de legislação não automatizado. Usar a Câmara / diário |
| `plenus`, `1doc`, `diario`, `manual` | sem busca automática; `url_busca` aponta a página certa (`obs` explica) |
| `portal_proprio` | cliente **heurístico** (preenche o formulário de busca da página e extrai "Lei/Decreto nº X/AAAA" ao redor). Só pista; se vier vazio, abra `url_busca` com WebFetch |
| `desconhecido` | não achamos página de legislação; `url_busca` = home do site (quando há). Procurar à mão (WebFetch) e/ou diários |

---

## 2. `../leads/portais.json`

```json
{"3549904": {
  "nome": "São José dos Campos", "uf": "SP",
  "sistema": "spl",                      // sistema principal (melhor fonte, ver prioridade abaixo)
  "url_busca": "https://camarasempapel.camarasjc.sp.gov.br/legislacao/",
  "orgao": "camara",                     // de quem é a fonte principal
  "testado": true,                       // o cliente da fonte principal rodou sem erro no teste de fumaça
  "cliente": true,                       // há cliente automático para a fonte principal
  "sites": {"prefeitura": "https://www.sjc.sp.gov.br/", "camara": "http://www.camarasjc.sp.gov.br/"},
  "fontes": [ {"orgao","sistema","base","url_busca","evidencia":[...],"cliente","testado",
               "teste":{"termo","total","quando","erro"}, "n_normas", "verificar", "obs", "plataforma"} , ... ]
}}
```
* `fontes` vem **ordenada** (melhor primeiro). `testado`: `true` (rodou ok), `false` (rodou com erro — ver `teste.erro`), `null` (não exercitado: sem cliente ou fonte secundária).
* `evidencia`: `probe:dns|fp|link|wild` (confirmado por GET no sistema), `link:<orgao>` (link achado no site oficial), `html:<plataforma>` (assinatura da plataforma no HTML), `manual:...` (conferido à mão).
* `verificar`: suspeita de homônimo (SaaS por subdomínio sem UF no título) — confira antes de usar.
* Prioridade do principal: sapl > sp_catalogo > siscam > domino > instar > SPL (legislacaocompilada/nopapercloud/spl) > legislacoes_dt > portalfacil > webline > legver > sagl > leismunicipais > legislacaodigital > cespro > manual > docman > portal_proprio > plenus > wordpress > atende > diario > 1doc (fonte que falhou no teste, sem normas ou com `verificar` perde posição).

### Cobertura (10/10/2026)
* 1.668 municípios; **1.385** com pelo menos uma fonte cujo cliente rodou ok; **1.285** com a fonte principal testada ok.
* Por UF (principal testado ok / total): ES 72/78 · MG 651/853 · RJ 60/92 · SP 502/645.
* Principal por sistema: portal_proprio 374 · sapl 342 · instar 180 · webline 146 · leismunicipais 112 · siscam 97 · desconhecido 96 ·
  legislacoes_dt 91 · portalfacil 79 · docman 59 · spl 37 · wordpress 15 · legislacaocompilada 10 · nopapercloud 6 · cespro 6 ·
  sagl 4 · atende 3 · legislacaodigital 3 · manual 2 · plenus 2 · legver/domino/sp_catalogo/1doc 1.

---

## 3. Clientes (`legislacao.py`) e testes

Teste de fumaça = `buscar_em(sistema, base, ["trânsito"], 5)` em **todas** as instâncias com cliente (heurístico só quando é o principal).
"ok" = rodou sem erro (para o heurístico: extraiu ≥1 ato com "trânsito" ou "lei").

| sistema | o que é / como busca | instâncias ok/testadas | exemplos testados ok |
|---|---|---|---|
| `sapl` | SAPL 3 Interlegis — API REST `/api/norma/normajuridica/?ementa__icontains=` (delega a `sagl` se for Zope) | 365/366 | Alegre/ES, Aracruz/ES, Baixo Guandu/ES |
| `sagl` | SAGL/OpenLegis/SAPL 2.5 — `normas_table_json` (fallback HTML) | 6/6 | Assis/SP, Campo Limpo Paulista/SP, Ibitinga/SP |
| `siscam` | Sino Siscam — novo: grupo "Legislação" + export CSV; antigo: menu `/index/<id>/8` + `/Documentos/Pesquisa?Pesquisa=Avancada` | 102/107 | Andradas/MG, Fronteira/MG, Frutal/MG (antigo: Piracicaba/SP, Americana/SP) |
| `instar` | Instar `/portal/leis_decretos/…` (ementa; até 5 páginas; layout sem link de detalhe usa `/portal/leis_decretos/<id>/`) | 253/253 | Ibiraçu/ES, Vila Valério/ES, Aguanil/MG |
| `legislacaocompilada` `nopapercloud` `spl` | SPL (ASP.NET): POST em `/legislacao/` (`txt_termo`); 1ª página. `spl` = auto-hospedado (`spl.<camara>.gov.br`, `*.camarasempapel.com.br`, `*.splonline.com.br`) | 17/22 · 12/12 · 62/93 | Anchieta/ES, Colatina/ES, Afonso Cláudio/ES |
| `portalfacil` | Portal Fácil antigo (AjaxPro `leg_lis.GetLegLis` em `/legislacao`) | 117/117 | Alto Rio Novo/ES, Dores do Rio Preto/ES, Ibitirama/ES |
| `legislacoes_dt` | portais MG com DataTables `/legislacoes/get/todas?ementa=` (JSON) | 129/129 | Açucena/MG, Água Boa/MG, Águas Formosas/MG |
| `webline` | Webline Sistemas (MG/SP, inclui `*.wls.com.br`): `?pag=T0dRPU9EZz1PR009T1RnPQ==&idtipolei=N&descricao=` por tipo e ano | 260/269 | Caldas/MG, Campina Verde/MG, Canápolis/MG |
| `legver` | portal ES/MG `/legislacao?busca=` (itens `/legislacao/ver/<id>/detalhes`) | 6/6 | Águia Branca/ES, Atílio Vivácqua/ES, Nova Venécia/ES |
| `docman` | Joomla DOCman (listagem por categoria, `search=` no título) — só título/data de publicação (46 das 124 acharam algo com "trânsito") | 124/124 | Alto Caparaó/MG, Alto Jequitibá/MG, Amparo do Serra/MG |
| `legislacaodigital` | Legislação Digital (Sino) `?Pesquisa=Textual&EmentaAssunto=` — só domínio próprio | 1/80 (79 = Cloudflare) | Limeira/SP |
| `sp_catalogo` | Catálogo de Legislação Municipal da Prefeitura de SP (`/busca?assunto=`) | 1/1 (sistema único) | São Paulo/SP |
| `domino` | Lotus Domino `?SearchView&Query=` (Câmara do Rio, Leis Ordinárias) | 1/1 (sistema único) | Rio de Janeiro/RJ |
| `wordpress` | `wp-json/wp/v2/search` (posts/páginas; não é base de normas) | 402/409 | Alegre/ES, Alto Rio Novo/ES, Baixo Guandu/ES |
| `portal_proprio` | heurístico genérico (formulário + regex) | 276/564 | Apiacá/ES, Acaiaca/MG, Aimorés/MG |

Falhas conhecidas: SPL do `legislacaocompilada.com.br` com busca textual atrás de Cloudflare (o cliente cai para varredura por **tema**
de trânsito/transporte e, se não houver tema, devolve erro); Siscam de Niterói exige login; alguns Webline com módulo desligado;
SAGL de Uberlândia e Mogi Guaçu devolvem 403 para robôs.

---

## 4. Fluxo recomendado para o orquestrador

1. Ordem: `../prioridade.json` (frota de caminhões) — começar pelos maiores.
2. Por município: `diarios_consolidados.py lead <ibge>` + `legislacao.py buscar <ibge> "<termos>" --json` (todas as fontes) →
   abrir os atos candidatos (WebFetch/curl na `url`) → conferir artigo/vigência.
3. Agrupar agentes **por sistema** ajuda (mesma forma de ler o ato), mas respeite **um pedido por host** e no máximo ~4 simultâneos
   no Interlegis (`sapl.*.leg.br`) e nos SaaS compartilhados (siscam.com.br, camarasempapel, legislacaocompilada).
4. Cota de WebSearch é baixa: use `url_busca`/`sites` daqui antes de pesquisar na web.

---

## 5. Como regenerar / retomar (`../portais_work/`)

Todas as fases gravam JSONL incremental e pulam o que já fizeram — se cair, rode o mesmo comando de novo.
```bash
W=../portais_work
python3 $W/descobrir.py dns      # hosts candidatos (<slug>.<uf>.gov.br/.leg.br, sapl.*, SaaS sem curinga) -> dns.jsonl
python3 $W/descobrir.py http     # home da prefeitura e da câmara -> http.jsonl + html/*.gz
python3 $W/descobrir.py wild     # <slug>.siscam.com.br (DNS curinga) -> wild.jsonl
python3 $W/descobrir2.py         # 2ª passada de domínios (iniciais, pm/cm/camara+nome) só p/ quem falhou; exige o nome do município na página
python3 $W/saas_dns.py           # splonline / camarasempapel / wls por município
python3 $W/agrega_fp.py          # assinaturas + links "Legislação" -> fp.jsonl
python3 $W/pag2.py               # segue os links de legislação -> pag2.jsonl (rodar agrega_fp.py de novo depois)
python3 $W/probe.py              # confirma sistemas por GET leve -> probe.jsonl   (REFAZ=1 refaz falhas transitórias)
python3 $W/vendor.py gravar      # plataformas de portal próprio (Webline, DataTables, DOCman, SPL, Plenus...) -> vendor.jsonl
python3 $W/consolida.py          # -> ../leads/portais.json  (usa manual.json p/ correções conferidas à mão)
python3 $W/smoke.py              # teste de fumaça dos clientes -> smoke.jsonl (REFAZ=1, SO=<sistema>)
python3 $W/consolida.py          # de novo, para gravar 'testado'
```
Correções manuais (sites errados do Wikidata, sistemas de capitais): `../portais_work/manual.json` (`sites`, `fontes`, `excluir_hosts`).

## 6. Limitações
* Descoberta por padrão de domínio: 21 municípios sem nenhum site achado; câmaras sem domínio padrão podem ter ficado de fora.
* SaaS por subdomínio (atende.net, nopapercloud, camarasempapel, siscam) pode ter homônimo de outro estado: descartamos quando o
  título traz outra UF e marcamos `verificar` quando o título não traz UF.
* O teste de fumaça prova que o cliente **funciona** naquela instância, não que a base esteja completa ou atualizada.
* Nenhum ato, artigo ou horário foi inferido aqui — este mapa só diz **onde** e **como** buscar.
