# IMPSC14: Feliz Natal, São José do Rio Claro, Nova Monte Verde, Nova Maringá e Nova Marilândia (MT)

Lote do Sul/Centro-Oeste na camada genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)).
Pesquisa e verificação de 2026-10-18 em `docs/research/cidades_sul_co/` (`res/<ibge>.json`, `verif/<ibge>.json`). Geometria pelos nomes do OSM (cache do PBF, sem Overpass), ODbL 1.0; atos em domínio público (Lei 9.610/1998, art. 8º, IV). Nenhum dos municípios define VUC (`vuc: null`). Os atos vêm do Jornal Oficial da AMM-MT (amm.diariomunicipal.org).

| ibge | Município | fonte_id | Ativas | Desativadas | Casos de rota | Teste |
|---|---|---|---|---|---|---|
| 5103700 | Feliz Natal/MT | `feliz-natal` | 1 | 1 | 2 evita | passou |
| 5107305 | São José do Rio Claro/MT | `sao-jose-do-rio-claro` | 1 | 0 | 2 evita, 1 sem_alternativa | passou |
| 5108956 | Nova Monte Verde/MT | `nova-monte-verde` | 1 | 0 | 3 evita | passou |
| 5108907 | Nova Maringá/MT | `nova-maringa` | 0 | 1 | nenhum | sem fixture (sem geometria) |
| 5108857 | Nova Marilândia/MT | `nova-marilandia` | 0 | 1 | nenhum | sem fixture (sem geometria) |

Todas as regras ativas valem 24 h, 7 dias, sem exceção de feriado (`feriados: aplica`); por isso não há horário "fora da janela" nos casos de rota. O controle usado foi um veículo não atingido (utilitário, toco ou VUC) fazendo o mesmo trajeto pela via.

## Feliz Natal/MT (5103700)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `feliz_natal_av_maravilha_pesados_5t` | ativa (média) | Lei 1.042, de 10/12/2025 (nova redação do art. 1º da Lei 230/2007), art. 1º, §6º, I; multa art. 3º. [AMM-MT](https://amm.diariomunicipal.org/publicacao/1742330/) | 24 h, 7 dias | PBT acima de 5 t | `5103700_vias.geojson`: 10 ways da Avenida Maravilha (par de mãos únicas, ~2,4 km), toda a extensão | evita: carreta (3,11 km contra 2,18 km do utilitário, que usa 1,9 km da avenida) e toco |
| `feliz_natal_perimetro_urbano_pesados_5t` | desativada (média) | Lei 1.042/2025, art. 1º, caput e §4º | 24 h | PBT acima de 5 t | vazia | nenhuma |

Motivo da desativada: o perímetro urbano não é delimitado no ato, há exceções amplas (carga e descarga 06h–18h, residentes com garagem, serviços) e vias liberadas nomeadas, entre elas a MT-225 (rodovia estadual).

Exceções (só nos avisos): carga e descarga para o comércio local com nota fiscal, 06h–18h, com autorização da Secretaria de Infraestrutura (art. 1º, §6º, I; **não modelada**: a regra vale 24 h para todo caminhão acima de 5 t); ônibus, frota pública, coleta, emergências, guincho, concretagem, remoção de terra/entulho, valores, eventos e mudanças (§1º e §3º); residente com garagem própria e sem carga (art. 2º).

Pendências: "acima de 5 toneladas" lido como PBT (o art. 1º-A, §2º fala em "peso"); sinalização não confirmada; nenhuma pendência do import.

## São José do Rio Claro/MT (5107305)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `sao_jose_do_rio_claro_av_siegfried_buss_15t` | ativa (média) | Lei 1.238, de 26/09/2019, art. 1º (proibição), art. 4º (exceção), art. 3º (multa). [AMM-MT](https://amm.diariomunicipal.org/publicacao/594036/) | 24 h, 7 dias | PBT acima de 15 t | `5107305_vias.geojson`: 2 ways da Avenida Siegfried Buss (mão única em cada sentido, 1,3 km), toda a extensão | evita: truck e carreta; sem_alternativa: truck de ponta a ponta |

Casos: de uma rua ao lado da avenida (-13.4499, -56.7191) a (-13.4500, -56.7240) o truck faz 0,83 km sem usar a avenida e o utilitário 0,94 km, com 0,39 km por ela; o VUC (9 t, abaixo do corte) também não é atingido. De uma ponta à outra (-13.4449, -56.7273 a -13.4511, -56.7173) a avenida é a única ligação no sentido noroeste para sudeste (a Rodovia Domingos Briante paralela é de mão única para noroeste): a rota usa a avenida e avisa `rmsp_via_restrita_na_rota`. No sentido contrário todos usam a rodovia.

Exceção (só nos avisos, **não modelada**): carga e descarga em comércio ou residência localizada na própria avenida (art. 4º). A avenida é via municipal no OSM (residential, sem ref de rodovia).

Pendências: "peso superior a 15 t" assumido PBT; placas não confirmadas. A avenida é pouco usada como atalho: poucos pares origem-destino a utilizam, por isso só há um caso de desvio (a rodovia paralela absorve o tráfego).

## Nova Monte Verde/MT (5108956)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `nova_monte_verde_avs_mato_grosso_genesio_biblia` | ativa (média) | Lei 741, de 06/05/2015, art. 1º e §1º, art. 2º ([AMM-MT](https://amm.diariomunicipal.org/publicacao/27741/)); Lei 778/2015 (Código de Posturas), art. 254, §2º ([AMM-MT](https://amm.diariomunicipal.org/publicacao/91098/)) | 24 h, 7 dias | comprimento acima de 14 m **ou** mais de 2 eixos **ou** semirreboque/reboque | `5108956_vias.geojson`: 5 ways da Avenida Mato Grosso (~2,1 km) e 2 da "Avenida Genesio Alves Fonseca" (grafia do OSM, ~1 km) | evita: truck, carreta (22h) e romeu_julieta; o toco (2 eixos, 9 m) e o VUC passam pelas avenidas |

Casos: de (-9.9805, -57.4642) a (-9.9725, -57.4682) o truck faz 1,76 km pelo contorno e o toco 1,31 km, com 0,84 km pelas avenidas; de (-9.976, -57.466) a (-9.972, -57.472), pelo cruzamento das duas avenidas, o caminhão com reboque faz 1,88 km contra 1,35 km do toco.

Decisões e pendências:
- **Praça da Bíblia não mapeada** e "ao redor" sem raio no ato: o entorno ficou **fora** da geometria. A praça fica na própria Avenida Mato Grosso (~-9.9796, -57.4672), já inteira na regra, mas as ruas laterais que a cercam não são restringidas (a restrição real é um pouco maior que a modelada).
- Alvo é interpretação do texto "caminhões tipo Truck ou superiores e carretas" (o art. 2º diz que a sinalização proíbe acima do tipo "toco"): truck = 3 eixos; toco = 2 eixos e liberado.
- Carga e descarga do comércio só pelas vias laterais (§1º): **não modelada**.
- Jurisdição: as avenidas são vias municipais no OSM (a MT-208 é via distinta, ao norte). Correção da verificação: Código de Posturas art. 254, §2º (a pesquisa citava o art. 250).
- Sinalização não confirmada; nenhuma pendência do import.

## Nova Maringá/MT (5108907): registro desativado, sem geometria

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `nova_maringa_av_amos_zanchet_caminhoes` | desativada (baixa) | Decreto 010/2015/GABPRE, art. 2º e §1º. [AMM-MT](https://amm.diariomunicipal.org/publicacao/25230/) | 24 h | qualquer caminhão | vazia | nenhuma |

Motivo: a Av. Amos Bernardino Zanchet é a **MT-160** (rodovia estadual) no OSM; o decreto é municipal, sem anuência do órgão rodoviário estadual e sem o mapa em anexo, e o art. 6º cita o Código de Polícia Administrativa de Campo Grande/MS (texto copiado de outro município). Não há fixture de rota (nenhuma feição no banco).

## Nova Marilândia/MT (5108857): registro desativado, sem geometria

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `nova_marilandia_lei_1143_2026_escolas_8t` | desativada (baixa) | Lei 1.143, de 22/04/2026, art. 1º, I e II; art. 3º. [AMM-MT](https://amm.diariomunicipal.org/publicacao/1820281/) | 24 h | capacidade de carga de 8 t ou mais (`payload_t` acima de 7,99) | vazia | nenhuma |

Motivo: as vias de referência dos trechos (Rua das Azaleias, Rua Flor de Tubarão, Rua das Bromélias, Avenida Blairo Maggi) não existem no OSM; só a Rua dos Cravos está mapeada, e restringi-la inteira excederia o trecho da lei. Não há fixture de rota.

## Observações gerais

- Desativadas com geometria vazia não entram em `data_features`; os seeds `restricoes_rmsp__nova-maringa.sql` e `restricoes_rmsp__nova-marilandia.sql` ficam sem feições (como Sinop e Reserva) e esses dois municípios não têm fixture em `api/test/fixtures/mun_sul_co/`.
- Cache do PBF gerado com `osm_pbf_cache_regioes.py 5103700 5107305 5108956` (os dois desativados não precisam de cache).
