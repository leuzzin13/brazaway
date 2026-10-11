# Pesquisa cidade por cidade — Sudeste (estado em 11/10/2026, 05h)

Rascunhos de regras municipais de circulação de caminhões, um arquivo por município em `res/<ibge>.json`, no formato de `data/raw/municipios/schema.json` (sem geometria). **Ainda não estão no app**: falta verificar as regras ativas, gerar geometria e validar no Valhalla (ver "Como continuar").

## Situação

- Municípios do Sudeste: 1.668. Já no app antes desta pesquisa: 34 + capital paulista. Com resultado aqui: **991**.
- Por nível de busca: varredura_consolidada: 850, profundo: 141
- Por status: nao_achou: 855, regra_com_ato: 72, sem_restricao_declarada: 23, pontual: 17, pista: 13, regra_sem_ato: 10, confirmou_que_nao_tem: 1
- Regras marcadas "ativa" nos rascunhos: 99 (só 18 cidades passaram pelo verificador independente; o resto precisa de verificação).
- Por faixa de prioridade (frota Senatran): A: 141/146, B: 0/420, C: 0/43, D: 848/1009
- Municípios ainda sem resultado: 629 (lista: rodar o script em `workflow/`; ele pula quem já tem `res/`).

## Cidades com regra com ato (rascunho)

| UF | Município | IBGE | Regras ativas | Verificada |
|---|---|---|---|---|
| ES | Cachoeiro de Itapemirim | 3201209 | 3 | não |
| ES | Colatina | 3201506 | 0 | sim |
| ES | Viana | 3205101 | 0 | não |
| MG | Araxá | 3104007 | 2 | não |
| MG | Arcos | 3104205 | 1 | não |
| MG | Betim | 3106705 | 2 | não |
| MG | Congonhas | 3118007 | 1 | não |
| MG | Conselheiro Lafaiete | 3118304 | 1 | não |
| MG | Formiga | 3126109 | 1 | não |
| MG | Frutal | 3127107 | 1 | não |
| MG | Itabirito | 3131901 | 1 | não |
| MG | Itaúna | 3133808 | 1 | não |
| MG | João Pinheiro | 3136306 | 1 | não |
| MG | Juiz de Fora | 3136702 | 2 | não |
| MG | Lavras | 3138203 | 0 | não |
| MG | Manhuaçu | 3139409 | 1 | não |
| MG | Nova Lima | 3144805 | 3 | não |
| MG | Poços de Caldas | 3151800 | 1 | sim |
| MG | Santa Luzia | 3157807 | 1 | não |
| MG | Sete Lagoas | 3167202 | 3 | sim |
| MG | Teófilo Otoni | 3168606 | 1 | não |
| MG | Uberaba | 3170107 | 0 | não |
| MG | Uberlândia | 3170206 | 0 | não |
| MG | Unaí | 3170404 | 1 | não |
| RJ | Barra Mansa | 3300407 | 1 | não |
| RJ | Campos dos Goytacazes | 3301009 | 3 | não |
| RJ | Itaguaí | 3302007 | 1 | não |
| RJ | Macaé | 3302403 | 2 | sim |
| RJ | Magé | 3302502 | 1 | não |
| RJ | Niterói | 3303302 | 2 | sim |
| RJ | Nova Friburgo | 3303401 | 0 | não |
| RJ | Resende | 3304201 | 2 | sim |
| RJ | São Gonçalo | 3304904 | 3 | sim |
| RJ | São João de Meriti | 3305109 | 0 | sim |
| RJ | Volta Redonda | 3306305 | 0 | não |
| SP | Americana | 3501608 | 2 | sim |
| SP | Araraquara | 3503208 | 2 | não |
| SP | Atibaia | 3504107 | 1 | sim |
| SP | Avaré | 3504503 | 1 | não |
| SP | Barretos | 3505500 | 1 | não |
| SP | Bauru | 3506003 | 2 | não |
| SP | Bebedouro | 3506102 | 1 | não |
| SP | Botucatu | 3507506 | 3 | não |
| SP | Bragança Paulista | 3507605 | 3 | sim |
| SP | Ibiúna | 3519709 | 6 | não |
| SP | Indaiatuba | 3520509 | 2 | não |
| SP | Itapeva | 3522406 | 3 | sim |
| SP | Itapevi | 3522505 | 1 | não |
| SP | Itapira | 3522604 | 2 | não |
| SP | Itatiba | 3523404 | 3 | sim |
| SP | Jaú | 3525300 | 1 | não |
| SP | Leme | 3526704 | 1 | não |
| SP | Limeira | 3526902 | 1 | sim |
| SP | Lins | 3527108 | 1 | não |
| SP | Marília | 3529005 | 2 | não |
| SP | Matão | 3529302 | 1 | não |
| SP | Ourinhos | 3534708 | 1 | não |
| SP | Paulínia | 3536505 | 0 | não |
| SP | Penápolis | 3537305 | 1 | não |
| SP | Piedade | 3537800 | 1 | não |
| SP | Pindamonhangaba | 3538006 | 2 | não |
| SP | Praia Grande | 3541000 | 2 | sim |
| SP | Presidente Prudente | 3541406 | 1 | não |
| SP | Rio Claro | 3543907 | 1 | não |
| SP | Santa Bárbara d'Oeste | 3545803 | 0 | não |
| SP | São Caetano do Sul | 3548807 | 0 | não |
| SP | São José dos Campos | 3549904 | 0 | não |
| SP | Tatuí | 3554003 | 1 | sim |
| SP | Taubaté | 3554102 | 1 | sim |
| SP | Valinhos | 3556206 | 2 | sim |
| SP | Votorantim | 3557006 | 1 | não |
| SP | Votuporanga | 3557105 | 2 | não |

## Arquivos

- `res/<ibge>.json`: resultado por município (status, nível de busca, fontes consultadas, regras em rascunho, divergências do OSM).
- `verif/<ibge>.json`: verificação independente (só as que já rodaram).
- `leads/`: pistas em massa (Querido Diário, diários consolidados MG/ES, penaestrada, mapa de portais de legislação por município) e scripts de coleta. Os HTML/PDF brutos e os atos baixados (≈10 GB) ficaram fora do git; as URLs estão nos JSON.
- `toolkit/`: clientes de busca reutilizáveis (`legislacao.py`, `diarios_consolidados.py`; ver `toolkit/README.md`).
- `fila/`, `triagem_r1.json`, `fila_r1_resumo.json`: triagem e lotes da 1ª onda do orquestrador (a onda caiu pelo limite semanal antes de rodar).
- `GUIA.md`: guia de fontes por UF/sistema montado pelo orquestrador.
- `lotes.json`, `tiers.json`, `prioridade.json`, `municipios_sudeste.csv`, `osm_hints_por_municipio.json`, `qd_cities.json`: insumos.
- `CONVENCOES_IMPLEMENTACAO.md`: regras combinadas (regra ativa só com ato vigente conferido; cidades sem regra vão para `data/raw/municipios/_varredura.json`; divergência do OSM vira pendência em `data/osm-overrides/overrides.json`; Valhalla com no máximo ~4 rotas simultâneas).
- `workflow/sudeste-cidades-orquestrado.js`: o workflow (preparação → orquestrador → ondas → verificação → fechamento). Para rodar de outro lugar, troque `args.ns` para uma pasta onde exista `cidades/` com estes arquivos (ex.: copie `docs/research/cidades_sudeste/*` para `<ns>/cidades/`).

## Como continuar

1. Terminar a pesquisa: rodar o workflow de novo (pula cidades com `res/`). Falta a 1ª onda (cidades médias e pequenas com pista), as verificações das cidades grandes e o fechamento.
2. Verificar todas as cidades com regra "ativa" que ainda não têm `verif/`.
3. Implementar: para cada cidade com regra verificada, gerar `data/raw/municipios/<ibge>.json` (+ geometria em `data/raw/municipios/geo/`), seguindo `docs/layers/restricoes_municipais.md`; validar no Valhalla local em lotes pequenos; gerar `_varredura.json` com as cidades sem regra.
4. Rodar a suíte inteira (`./scripts/run-tests.sh`) — requer o ambiente Docker local (Postgres + Valhalla com os tiles do Sudeste).
