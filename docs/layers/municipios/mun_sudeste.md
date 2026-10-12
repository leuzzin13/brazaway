# Frente mun_sudeste — municípios do Sudeste vindos da pesquisa cidade por cidade

Origem: `docs/research/cidades_sudeste/` (pesquisa e verificação de 11/10/2026). Implementação em 12/10/2026, em 12 lotes
(detalhes, decisões e pendências por município em [`mun_sudeste/IMP01.md`](mun_sudeste/IMP01.md) … `IMP12.md`).

- 131 municípios com arquivo em `data/raw/municipios/<ibge>.json` (das 132 cidades com regra ativa na pesquisa; Viçosa entrou sem feição).
- 131 municípios com casos de rota em `api/test/fixtures/mun_sudeste/`: 171 regras ativas importadas (kind zona/via) e 172 casos de rota real conferidos.
- Teste: `api/test/layers/mun_sudeste.test.ts` (registro, kinds por status, base legal e "a rota desvia mesmo?").
- Regra ativa da pesquisa sem geometria honesta (via inexistente no OSM, área sem delimitação no ato) ou com veredito "inverificável" entrou **desativada** com `status_motivo`.

## Decisões gerais

- Perímetro urbano/área central sem polígono no ato: setores censitários urbanos do IBGE 2022 ou ruas do OSM, marcado `aproximado`, confiança no máximo média.
- Travessias de rodovia (BR/SP/MG/RJ e vias trunk/primary da travessia) ficam **fora** das zonas, salvo quando o ato as inclui; em Piranga, Pirapetinga, Garça e Mangaratiba isso foi corrigido depois de a suíte acusar rotas sem saída ou voltas de 85–165 km (ver IMP04, IMP05, IMP08). Scripts: `data/raw/municipios/curadoria/zona_liberar_travessia.py`, `zona_rodovia_lib.py`.
- Polígonos simplificados para até ~800 vértices (sempre para dentro), porque rotas longas somavam mais de 20 mil vértices em `exclude_polygons` (limite do Valhalla). Script: `curadoria/simplificar_zona.py`.
- Cache das vias com nome a partir do PBF local quando o Overpass não responde: `curadoria/osm_pbf_cache_sudeste.py`.

## Limitações e pendências conhecidas

- Bugs do importador contornados nos dados (não corrigidos): `build_trecho` quebra com `Cannot linemerge` quando a via tem um só way e o trecho tem pontas; `MUNICIPIOS_REBUILD=1` tenta refazer geometria manual; `municipios:<ibge>` valida todos os arquivos antes de filtrar; o import valida linhas como `auto` e a rota usa `truck`; `valhalla_check` aceita linha fora do grafo.
- Regras que, pelo próprio ato, fecham a única ligação curta (ex.: Praia Grande, São Pedro, Catuçaba, São Bento do Sapucaí) geram desvios longos: corretos pela lei, mas vale avisar o motorista.
- Validado com tiles do Valhalla sem relevo e sem as correções locais do OSM (`scripts/build-tiles.sh`); rodar a suíte de novo com os tiles completos.

## Municípios com casos de rota

| UF | Município | IBGE | Regras ativas | Casos de rota |
|---|---|---|---|---|
| ES | Cachoeiro de Itapemirim | 3201209 | 3 | 3 |
| ES | Itarana | 3202900 | 0 | 0 |
| ES | Pedro Canário | 3204054 | 0 | 0 |
| MG | Araxá | 3104007 | 2 | 2 |
| MG | Arcos | 3104205 | 1 | 1 |
| MG | Astolfo Dutra | 3104601 | 1 | 1 |
| MG | Betim | 3106705 | 2 | 2 |
| MG | Brasilândia de Minas | 3108552 | 0 | 0 |
| MG | Campo Florido | 3111408 | 1 | 1 |
| MG | Campos Gerais | 3111606 | 1 | 1 |
| MG | Capinópolis | 3112604 | 0 | 0 |
| MG | Carbonita | 3113503 | 1 | 1 |
| MG | Congonhas | 3118007 | 1 | 1 |
| MG | Conselheiro Lafaiete | 3118304 | 0 | 0 |
| MG | Cristália | 3120300 | 1 | 1 |
| MG | Diamantina | 3121605 | 1 | 1 |
| MG | Formiga | 3126109 | 1 | 1 |
| MG | Frutal | 3127107 | 1 | 1 |
| MG | Grão Mogol | 3127800 | 0 | 0 |
| MG | Ibiá | 3129509 | 1 | 1 |
| MG | Itaúna | 3133808 | 1 | 1 |
| MG | Iturama | 3134400 | 2 | 2 |
| MG | João Pinheiro | 3136306 | 1 | 1 |
| MG | Juiz de Fora | 3136702 | 2 | 2 |
| MG | Lambari | 3137809 | 2 | 2 |
| MG | Leopoldina | 3138401 | 0 | 0 |
| MG | Luz | 3138807 | 2 | 2 |
| MG | Manhuaçu | 3139409 | 1 | 2 |
| MG | Matutina | 3141207 | 2 | 2 |
| MG | Minas Novas | 3141801 | 1 | 1 |
| MG | Nova Lima | 3144805 | 3 | 4 |
| MG | Ouro Preto | 3146107 | 1 | 1 |
| MG | Perdões | 3149903 | 2 | 2 |
| MG | Piranga | 3150802 | 2 | 2 |
| MG | Pirapetinga | 3151107 | 1 | 1 |
| MG | Ponte Nova | 3152105 | 1 | 1 |
| MG | Poços de Caldas | 3151800 | 1 | 1 |
| MG | Recreio | 3154101 | 1 | 1 |
| MG | Santa Luzia | 3157807 | 1 | 1 |
| MG | Serro | 3167103 | 1 | 1 |
| MG | Sete Lagoas | 3167202 | 3 | 4 |
| MG | São Lourenço | 3163706 | 1 | 1 |
| MG | Teófilo Otoni | 3168606 | 1 | 2 |
| MG | Unaí | 3170404 | 1 | 2 |
| RJ | Barra Mansa | 3300407 | 1 | 1 |
| RJ | Campos dos Goytacazes | 3301009 | 3 | 3 |
| RJ | Itaguaí | 3302007 | 1 | 1 |
| RJ | Macaé | 3302403 | 2 | 2 |
| RJ | Magé | 3302502 | 0 | 0 |
| RJ | Mangaratiba | 3302601 | 1 | 1 |
| RJ | Maricá | 3302700 | 2 | 2 |
| RJ | Miguel Pereira | 3302908 | 1 | 1 |
| RJ | Niterói | 3303302 | 2 | 2 |
| RJ | Piraí | 3304003 | 1 | 0 |
| RJ | Resende | 3304201 | 2 | 3 |
| RJ | São Gonçalo | 3304904 | 3 | 2 |
| SP | Agudos | 3500709 | 1 | 1 |
| SP | Altinópolis | 3501004 | 1 | 1 |
| SP | Americana | 3501608 | 2 | 2 |
| SP | Aparecida | 3502507 | 1 | 0 |
| SP | Araraquara | 3503208 | 2 | 0 |
| SP | Araçariguama | 3502754 | 1 | 1 |
| SP | Atibaia | 3504107 | 1 | 1 |
| SP | Avaré | 3504503 | 1 | 1 |
| SP | Barretos | 3505500 | 1 | 1 |
| SP | Bastos | 3505807 | 2 | 2 |
| SP | Bauru | 3506003 | 2 | 2 |
| SP | Bebedouro | 3506102 | 1 | 1 |
| SP | Bertioga | 3506359 | 1 | 1 |
| SP | Botucatu | 3507506 | 3 | 3 |
| SP | Bragança Paulista | 3507605 | 3 | 3 |
| SP | Buritama | 3508108 | 1 | 1 |
| SP | Buritizal | 3508207 | 1 | 1 |
| SP | Cardoso | 3510708 | 1 | 1 |
| SP | Conchal | 3512209 | 1 | 1 |
| SP | Cordeirópolis | 3512407 | 1 | 1 |
| SP | Cunha | 3513603 | 1 | 1 |
| SP | Dobrada | 3514007 | 1 | 1 |
| SP | Garça | 3516705 | 1 | 1 |
| SP | Getulina | 3517000 | 1 | 1 |
| SP | Guareí | 3518503 | 3 | 1 |
| SP | Guariba | 3518602 | 1 | 1 |
| SP | Ibitinga | 3519600 | 1 | 1 |
| SP | Ibiúna | 3519709 | 6 | 6 |
| SP | Indaiatuba | 3520509 | 2 | 2 |
| SP | Itapeva | 3522406 | 3 | 3 |
| SP | Itapevi | 3522505 | 1 | 2 |
| SP | Itapira | 3522604 | 2 | 2 |
| SP | Itararé | 3523206 | 1 | 1 |
| SP | Itatiba | 3523404 | 2 | 2 |
| SP | Itápolis | 3522703 | 1 | 1 |
| SP | Jaú | 3525300 | 0 | 0 |
| SP | Leme | 3526704 | 1 | 1 |
| SP | Limeira | 3526902 | 1 | 1 |
| SP | Lins | 3527108 | 1 | 1 |
| SP | Lourdes | 3527256 | 1 | 1 |
| SP | Maracaí | 3528809 | 1 | 1 |
| SP | Marília | 3529005 | 2 | 2 |
| SP | Matão | 3529302 | 1 | 1 |
| SP | Meridiano | 3529609 | 1 | 1 |
| SP | Nova Aliança | 3532801 | 1 | 1 |
| SP | Olímpia | 3533908 | 3 | 3 |
| SP | Ourinhos | 3534708 | 1 | 1 |
| SP | Parapuã | 3536000 | 1 | 1 |
| SP | Pardinho | 3536109 | 1 | 1 |
| SP | Paulicéia | 3536406 | 1 | 1 |
| SP | Penápolis | 3537305 | 1 | 1 |
| SP | Piedade | 3537800 | 1 | 1 |
| SP | Pindamonhangaba | 3538006 | 2 | 2 |
| SP | Pirangi | 3539004 | 1 | 1 |
| SP | Praia Grande | 3541000 | 2 | 2 |
| SP | Presidente Prudente | 3541406 | 1 | 1 |
| SP | Rio Claro | 3543907 | 1 | 1 |
| SP | Rosana | 3544251 | 0 | 0 |
| SP | Santa Branca | 3546009 | 1 | 1 |
| SP | Santo Expedito | 3548302 | 1 | 1 |
| SP | São Bento do Sapucaí | 3548609 | 1 | 1 |
| SP | São Luiz do Paraitinga | 3550001 | 1 | 1 |
| SP | São Manuel | 3550100 | 1 | 1 |
| SP | São Pedro | 3550407 | 1 | 1 |
| SP | São Roque | 3550605 | 1 | 1 |
| SP | Tanabi | 3553401 | 1 | 1 |
| SP | Tatuí | 3554003 | 1 | 1 |
| SP | Taubaté | 3554102 | 1 | 1 |
| SP | Valinhos | 3556206 | 2 | 3 |
| SP | Vinhedo | 3556701 | 1 | 1 |
| SP | Vista Alegre do Alto | 3556909 | 1 | 1 |
| SP | Votorantim | 3557006 | 1 | 2 |
| SP | Votuporanga | 3557105 | 2 | 2 |
| SP | Águas da Prata | 3500402 | 1 | 1 |
| SP | Águas de São Pedro | 3500600 | 1 | 0 |
