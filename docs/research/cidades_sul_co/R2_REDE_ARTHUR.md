# R2 — pacote "rodar da rede do Arthur"

O que a nuvem não alcançou (Cloudflare 403, IP bloqueado, API do Querido Diário em 522) e que deve funcionar numa conexão residencial brasileira.
Cobre as **522 cidades com `falha_de_fonte=true`** (`falhas_de_fonte.json`) e dois insumos estaduais (seção final).
Nada aqui contorna captcha ou login: CESPRO, Atende.net e 1doc viram uma lista de links para abrir no navegador.

## O que roda

`toolkit/rodar_da_rede.py` (Python 3, só biblioteca padrão; usa `requests` se estiver instalado). Por cidade, grava `leads/rede_arthur/<ibge>.json`:

| fonte (`--so`) | o que faz |
|---|---|
| `qd` | Querido Diário: `api.queridodiario.org.br/gazettes?territory_ids=<ibge>&querystring=<termo>&excerpt_size=500&number_of_excerpts=3&size=10` para `caminhões`, `"veículos pesados"`, `"trânsito pesado"`, `toneladas`, `"carga e descarga"`. Retenta 522/520. |
| `leis` | leismunicipais.com.br / leis.org: só testa se a página abre daí e gera os links (o repositório não documenta formato de busca; não inventamos). Se abrir, pesquise no navegador. |
| `nucleogov` | GO: acha `dom.<dominio>` e varre a API JSON do diário (`toolkit/nucleogov.py`); a lista de legislação `acessoainformacao.<m>.go.gov.br/cidadao/legislacao/...` é montada por JS sem API documentada, então vai como link. |
| `legislacao` | Reaplica os clientes de `toolkit/legislacao.py` (SAPL, Webline, Elotech, Instar, portal próprio...) nas fontes do município que têm cliente, para sites que deram 403/timeout à nuvem (até 4 fontes por cidade, termos `caminh`, `carga e descarga`, `veículos pesados`, `tonelad`...). |
| `manual` | CESPRO, Atende.net, 1doc: gera `_manual.html` e `_manual.csv` (não automatiza). |
| `insumos` | Baixa os brutos do SNV/DNIT e da ANP (seção final). |

Sempre >= 1 s entre pedidos ao mesmo host. **Retomável**: cada resultado vai para `leads/rede_arthur/_cache/<fonte>/<ibge>.json`; se cair, rode o mesmo comando. `--refazer-erros` repete só o que ficou com erro.

## Quantas cidades, por UF e por bloqueio

Uma cidade pode ter mais de um bloqueio (as colunas não somam). "legislacao" = cidades com alguma fonte que tem cliente automático; "sem URL" = a pesquisa na nuvem não achou nenhum portal (nada a refazer além do Querido Diário, se coberto).

| UF | cidades | Querido Diário | leismunicipais | NucleoGov (GO) | CESPRO | Atende | 1doc | site da prefeitura/câmara (403/timeout) | legislacao (com cliente) | sem URL |
|---|---|---|---|---|---|---|---|---|---|---|
| GO | 82 | 21 | 9 | 76 | 3 | 0 | 9 | 66 | 19 | 0 |
| MS | 21 | 3 | 5 | 2 | 0 | 2 | 5 | 14 | 17 | 3 |
| MT | 14 | 4 | 7 | 1 | 3 | 0 | 3 | 7 | 8 | 3 |
| PR | 156 | 104 | 53 | 1 | 1 | 21 | 32 | 40 | 87 | 16 |
| RS | 233 | 164 | 89 | 1 | 101 | 33 | 53 | 81 | 73 | 4 |
| SC | 16 | 7 | 10 | 0 | 0 | 8 | 3 | 13 | 4 | 1 |
| **total** | **522** | **303** | **173** | **81** | **108** | **64** | **105** | **221** | **208** | **27** |

(Reproduzir: `python3 docs/research/cidades_sul_co/toolkit/rodar_da_rede.py --contagem`. A coluna Querido Diário inclui as cidades com spider mesmo sem o host citado na falha.)

Lista manual (CESPRO/Atende/1doc): **468 links em 236 cidades** (Atende 186, CESPRO 154, 1doc 128; RS 153, PR 50, GO 12, SC 9, MS 7, MT 5).

## Como rodar (Mac)

Pré-requisitos: `python3` (3.9+), `curl` (já vem no macOS; o `legislacao.py` o usa) e a branch com `docs/research/cidades_sul_co/`.
Se o Python for o da python.org e der `CERTIFICATE_VERIFY_FAILED`, rode `/Applications/Python 3.x/Install Certificates.command` ou `pip3 install requests certifi`.

```bash
cd brazaway
# 1) fumaça: 3 cidades, saída separada em leads/rede_arthur/_teste/
python3 docs/research/cidades_sul_co/toolkit/rodar_da_rede.py --teste
# 2) completo (retomável)
python3 docs/research/cidades_sul_co/toolkit/rodar_da_rede.py
# variações
python3 docs/research/cidades_sul_co/toolkit/rodar_da_rede.py --uf GO,MS --so qd,nucleogov --limite 20
python3 docs/research/cidades_sul_co/toolkit/rodar_da_rede.py --so legislacao --refazer-erros
```

Se o `--teste` mostrar `qd=ERRO` com HTTP 522 mesmo da sua rede, a API está fora do ar naquele momento: rode o resto (`--so leis,nucleogov,legislacao,manual`) e o `qd` depois.
O script desliga uma fonte nesta execução depois de 15 cidades seguidas com erro (para não martelar um host caído); rode de novo mais tarde.

Tempo estimado (a API do Querido Diário leva 5 a 60 s por pedido): `qd` 303 cidades x 5 termos ≈ 1,5 a 4 h; `legislacao` ≈ 1 a 2 h; `nucleogov` ≈ 15 min; `leis` ≈ 10 min; `manual` instantâneo. Total ≈ 3 a 6 h. Dá para abrir 2 terminais com fontes diferentes (`--so qd` e `--so leis,nucleogov,legislacao`); hosts diferentes, sem conflito de cache.

## O que devolver

Saídas em `docs/research/cidades_sul_co/leads/rede_arthur/`:
`<ibge>.json` (um por cidade: resultados, URLs que bloquearam, links manuais), `_resumo.json` (contagem por fonte e lista de cidades com algum resultado), `_manual.html` / `_manual.csv`, `_cache/` (brutos).

Devolver como **branch** (`git checkout -b rede-arthur && git add docs/research/cidades_sul_co/leads/rede_arthur && git commit && git push`) ou **zip** (`zip -r rede_arthur.zip docs/research/cidades_sul_co/leads/rede_arthur`). Se fez a pesquisa manual, anote em `leads/rede_arthur/manual_achados.md`: cidade, ato (tipo nº/ano), artigo, URL.
Resultado é pista: abrir o ato e conferir número, data, artigo e vigência antes de virar regra.

## Lista manual (captcha/login)

Abra `leads/rede_arthur/_manual.html` (filtro por cidade/sistema; também em `_manual.csv`). Cada linha traz o link do portal (CESPRO, Atende.net, 1doc), uma busca `site:` no Google e a instrução. Termos: `caminh`, `carga e descarga`, `veículos pesados`, `tonelada`. Prioridade: RS (153 cidades) e PR (50), onde CESPRO/Atende dominam. Também há links para abrir à mão em `<ibge>.json` > `fontes.leis.links_navegador` (leismunicipais) e `fontes.nucleogov.links_navegador` (GO).

---

## Insumos estaduais que também falharam da nuvem

Os dois ficam em `importers/sources/`; gravam em `data/cache/` (`DATA_DIR/cache`, ignorado pelo git), **não** em `data/raw/`. O `http_get` (importers/common.py) reaproveita o arquivo se estiver no cache, então basta o Mac baixar e você copiar a pasta para o mesmo caminho na máquina/sessão que roda o importador.

Só baixar os brutos (não precisa de banco, Docker nem das dependências do importador):

```bash
python3 docs/research/cidades_sul_co/toolkit/rodar_da_rede.py --so insumos          # grava em <repo>/data/cache/
DATA_DIR=/algum/lugar/data python3 docs/research/cidades_sul_co/toolkit/rodar_da_rede.py --so insumos
```

### (i) SNV/DNIT — `importers/sources/snv_dnit.py`

* Bloqueio: `servicos.dnit.gov.br` (reset/403 da nuvem).
* URLs do código: pasta WebDAV pública do Nextcloud `https://servicos.dnit.gov.br/dnitcloud/public.php/webdav/SNV%20Bases%20Geom%C3%A9tricas%20(2013-Atual)%20(SHP)/`, autenticação básica com usuário `oTpPRmYs5AAdiNr` e senha vazia (é o token do link público `https://servicos.dnit.gov.br/dnitcloud/index.php/s/oTpPRmYs5AAdiNr`). A versão mais nova sai de um `PROPFIND` (zip `AAAAMM[A-Z].zip`, ex. `202607A.zip`, ~69 MB); o zip é baixado de `<webdav><pasta><nome>.zip`.
* Destino: `data/cache/snv/<nome>.zip` (validade 365 dias). O `--so insumos` faz o PROPFIND e grava aí. Para fixar a versão: `SNV_VERSION=202607A`.
* Depois (qualquer máquina com o banco): copie `data/cache/snv/` para o mesmo caminho e rode o importador (`docs/layers/rodovias_horario.md`, "Como atualizar"). Se o PROPFIND falhar nessa máquina, o código usa o zip do cache sozinho:

```bash
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e SNV_UFS=ES,MG,RJ,SP,PR,SC,RS,GO,MT,MS,DF \
  -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer snv_dnit
```

Variáveis: `DATA_DIR` (padrão `/data`), `SEED_DIR`, `PG*` (banco), `SNV_UFS` (padrão as 11 UFs; `ALL` = Brasil), `SNV_VERSION`. Para só gerar o seed SQL sem banco, acrescente `--seed-only` ao final do comando do importador.

### (ii) PMQC e preços ANP — `importers/sources/postos_anp.py`

URLs do código (`BASE = https://www.gov.br/anp/pt-br/centrais-de-conteudo/dados-abertos`):

| arquivo | URL | destino em `data/cache/` |
|---|---|---|
| cadastro de revendedores | `BASE/arquivos/arquivos-dados-cadastrais-dos-revendedores-varejistas-de-combustiveis-automotivos/dados-cadastrais-revendedores-varejistas-combustiveis-automoveis.csv` | `anp_revendedores.csv` (24 h) |
| LPC diesel/GNV (preços, 4 semanas) | `BASE/arquivos/shpc/qus/ultimas-4-semanas-diesel-gnv.csv` | `anp_lpc_4sem_diesel.csv` (24 h) |
| página do PMQC (índice dos arquivos) | `BASE/pmqc-programa-de-monitoramento-da-qualidade-dos-combustiveis` | `anp_pmqc_page.html` (24 h) |
| PMQC mensal (12 meses, `PMQC_MESES`) | links `.../arquivos/pmqc/AAAA/....csv` achados na página | `anp_pmqc/<AAAA>_<arquivo>.csv` (60 dias) |

**Achado importante (causa dos "0 arquivos baixados")**: o cadastro e o LPC já estão em `data/cache/` (baixaram), e a página do PMQC também (`anp_pmqc_page.html`), mas a página **não tem nenhum link `.csv`**. Hoje ela publica **zips**: `BASE/arquivos/pmqc/pmqc_2026_01.zip`, `pmqc_2026_03.zip` ... `pmqc_2026_09.zip` (e `pmqc_2016.zip` ... `pmqc_2025.zip` por ano). O regex de `pmqc_urls()` (`.../arquivos/pmqc/\d{4}/....csv`) não casa com nada, então o importador usa 0 arquivos, mesmo com rede boa. Além disso, da nuvem o `gov.br/anp/.../pmqc_2026_09.zip` responde 403. Dois consertos necessários:

1. Baixar os zips na sua rede: `--so insumos` baixa os 12 mais novos para `data/cache/anp_pmqc_zip/` e extrai os CSV para `data/cache/anp_pmqc/pmqc_AAAA_MM__<arquivo>.csv` (também baixa cadastro, LPC e a página, se tiverem mais de 24 h).
2. **Ajustar `pmqc_urls()`/`pmqc()` em `importers/sources/postos_anp.py`** para aceitar `pmqc_\d{4}_\d{2}\.zip` e ler o CSV de dentro do zip (hoje só aceita `.csv` em `/pmqc/AAAA/`). Isso é mudança de código, não de rede; **não foi feita aqui**. Sem ela, copiar os arquivos para `data/cache/` não faz o importador usá-los. Não conferi o conteúdo dos zips (sem acesso daqui): o `--so insumos` mostra os nomes extraídos; o importador espera as colunas `Uf`, `CnpjPosto`, `Latitude`, `Longitude`, `Produto`, `DataColeta`, `Município`, separador `;`.

Comando do importador depois (precisa do banco e do PBF do OSM; ver `docs/layers/postos_diesel.md`):

```bash
OSM_PBF=/caminho/sudeste.osm.pbf docker compose --profile import run --rm importer postos_anp
```

Variáveis: `DATA_DIR` (padrão `/data`; o compose monta `./data`), `POSTOS_UFS` (padrão `SP,RJ,MG,ES,PR,SC,RS,GO,MT,MS,DF`), `PMQC_MESES` (padrão 12), `OSM_PBF`, `PG*`, `SEED_DIR`.
