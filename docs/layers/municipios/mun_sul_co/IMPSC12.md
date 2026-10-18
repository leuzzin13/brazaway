# IMPSC12: Palmas PR, Paraíso do Norte PR, Reserva PR

Lote do Sul/Centro-Oeste na camada genérica `restricoes_rmsp` (formato em [`restricoes_municipais.md`](../../restricoes_municipais.md)).
Pesquisa e verificação de 2026-10-18 em `docs/research/cidades_sul_co/` (`res/` e `verif/`). Geometria pelos nomes do OSM (cache do PBF, sem Overpass);
ODbL 1.0 para a geometria, domínio público (Lei 9.610/1998, art. 8º, IV) para os atos. Nenhum município define VUC (`vuc: null`). Janelas 24 h, `feriados: aplica`.

| ibge | Município | fonte_id | Ativas | Desativadas | Casos de rota | Teste |
|---|---|---|---|---|---|---|
| 4117602 | Palmas/PR | `palmas` | 1 | 1 | 2 evita | passou |
| 4118006 | Paraíso do Norte/PR | `paraiso-do-norte` | 1 | 5 | 2 evita | passou |
| 4121703 | Reserva/PR | `reserva` | 0 | 1 | 0 (sem fixture: regra sem geometria) | n/a |

## Palmas/PR (4117602)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `palmas_anel_central_pbt_gt10t` | ativa (confiança média) | Lei 2293, de 22/04/2015, art. 1º, §§1º-2º; art. 4º; art. 5º. [Câmara](https://www.camarapalmas.pr.gov.br/proposicoes/pesquisa/0/1/0/2251) | 24 h, todos os dias | caminhão com PBT acima de 10 t | zona aproximada (`4117602_anel_central.geojson`, manual sobre vias do OSM) | evita: carreta (oeste a leste) e truck (norte a sul), contornando o anel; o VUC atravessa |
| `palmas_anel_central_pbt_3_5a10t_janela` | desativada (confiança baixa) | Lei 2293/2015, art. 2º; art. 4º, §1º | seg-sáb 9h30-18h e domingo (como rascunhado) | PBT de 3,5 a 10 t | nenhuma | nenhuma |

Exceção (só nos avisos): autorização prévia do Diretor do DEPALTRAN, por 1 dia (art. 4º), e classe especial (§3º).

Geometria: o ato descreve o anel só por vias nomeadas (R. Manoel Inácio de Loyola, R. Marechal Deodoro, Av. Barão do Rio Branco, R. Ver. Amazonas Fonseca, R. Augusto Guimarães, R. Marechal Floriano Peixoto), sem anexo cartográfico. O polígono é aproximado: borda sul pela Marechal Deodoro, oeste pela Marechal Floriano Peixoto, norte por Augusto Guimarães e Barão do Rio Branco; a borda leste foi assumida na meridiana do início da Rua Manoel Inácio de Loyola (o OSM não traz a ligação Loyola a Barão do Rio Branco). Ampliado cerca de 30 m além do eixo das vias-limite para que o recuo de 20 m da camada as mantenha na zona. As vias internas (art. 1º, §2º) entram. Sem rodovia dentro do polígono. Rota de passagem (oeste a leste, 21,7 km pela rodovia, sem desvio) conferida.

Pendências:
- Corte de 10 t de PBT é a leitura segura da ambiguidade tara x PBT do art. 1º, §1º ("3,5 t de tara, equivalente a 10 t do PBT").
- Vigência após 2019 não comprovada (acervo da Câmara termina em 2019; Palmas não está no diário AMP nem no Querido Diário). Sinalização não verificada.
- A faixa de 3,5 a 10 t (art. 2º) fica desativada: depende da leitura tara x PBT.

## Paraíso do Norte/PR (4118006)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `paraisodonorte_av_tapejara_pbt_14t` | ativa (confiança média) | Lei 346, de 18/12/2018, art. 1º, b; art. 2º; art. 6º; art. 8º; alterada pela Lei 369/2019. [Câmara](https://www.paraisodonorte.pr.leg.br/proposicoes/pesquisa/0/1/0/2538) | 24 h, todos os dias | caminhão com PBT acima de 14 t | Av. Tapejara (via municipal, nome do OSM) do extremo norte até o cruzamento com a Av. Luiz Curioni (3 linhas, trecho marcado aproximado) | evita: carreta (norte a sul, 5,61 km contra 3,49 km) e truck (6,83 km) |
| `paraisodonorte_av_rui_barbosa_limite_pr559` | desativada (baixa) | Lei 346/2018, art. 1º, a; art. 3º; Lei 369/2019, art. 1º | 24 h | caminhão (limite remetido à PR-559) | nenhuma | nenhuma |
| `paraisodonorte_demais_vias_urbanas_pbt_14t` | desativada (baixa) | Lei 346/2018, art. 1º, c | 24 h | PBT acima de 14 t | nenhuma | nenhuma |
| `paraisodonorte_prolongamento_tapejara_limite_pr492` | desativada (baixa) | Lei 346/2018, art. 1º, d e §§1º-3º | 24 h | caminhão (limite remetido à PR-492) | nenhuma | nenhuma |
| `paraisodonorte_barro_argila_cana` | desativada (baixa) | Lei 346/2018, art. 4º; art. 1º, §2º; art. 6º, II | 24 h | por tipo de carga | nenhuma | nenhuma |
| `paraisodonorte_estacionamento_gt14m` | desativada (baixa) | Lei 346/2018, art. 7º | 24 h | comprimento acima de 14 m (só estacionamento) | nenhuma | nenhuma |

Exceções (só nos avisos): art. 2º, veículos pesados com destino final no município nos serviços listados; art. 3º, grãos de produtores rurais do município na Av. Rui Barbosa. Na prática a restrição pesa sobre o tráfego de passagem.

Geometria: a regra ativa cobre a Av. Tapejara do extremo norte (Prefeitura) até o cruzamento com a Av. Luiz Curioni (acesso ao Conjunto Eldorado); dali em diante é o prolongamento (art. 1º, d), com limite próprio da PR-492, que fica **fora** (regra desativada). O ponto final é uma coordenada (`lonlat`) no cruzamento; por isso o trecho é marcado aproximado e a rota emite `rmsp_trecho_aproximado` (info). Pendências do import: nenhuma. A Av. Tapejara não tem `ref` no OSM (via municipal).

Pendências:
- Data de publicação da lei não localizada (vigência 30 dias depois; art. 9º); texto lido por OCR de PDF escaneado.
- Limites numéricos das alíneas a e d (PR-559 e PR-492) não constam do ato; obras da PR-685 (Lei 369/2019) sem data de término.
- Rota de passagem pela cidade: não há travessia pela Av. Tapejara na rodovia; a PR-559 (Av. Rui Barbosa) fica fora da regra ativa.

## Reserva/PR (4121703)

| Regra | Status | Ato e artigo | Janela | Alvo | Geometria | Rotas testadas |
|---|---|---|---|---|---|---|
| `reserva_perimetro_urbano_carga_gt3_5t` | desativada (baixa; contradição do ato) | Lei 413, de 27/10/2011 (altera a Lei 153/2007), art. 1º, parágrafo único; art. 2º; art. 3º; Anexo I. [Câmara](https://www.camarareserva.pr.gov.br/proposicoes/pesquisa/0/1/0/873) | 24 h | capacidade de carga (`payload_t`) acima de 3,5 t | nenhuma (registro) | nenhuma |

Motivo: o parágrafo único manda os veículos acima de 3,5 t circularem pelas vias que delimitam o perímetro, mas o Anexo I (vias com proibição de circulação) lista as mesmas vias de contorno (Benjamin Constant, Dom Pedro II, Quintino Bocaiúva, Osires de Oliveira Viana, Av. Cel. Rogério Borba, Marcílio Dias, XV de Novembro e Pastor Gregório em trechos). A Lei 413 altera a 153/2007 sem dizer o que revoga. Sem como saber quais vias de contorno ficam liberadas, a geometria não é determinável.

Pendências: esclarecer com a prefeitura qual das duas leituras vale e se a Lei 153/2007 segue em vigor (Marcílio Dias, Generoso Marques e Av. Cel. Rogério Borba, com transversais); decretos de horário de carga e descarga (art. 2º) não localizados; prefeitura (Elotech) inacessível.
