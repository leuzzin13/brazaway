# Belo Horizonte (IBGE 3106200) — restrições municipais a caminhões

Frente `mun_bh` da camada genérica de restrições municipais (`layer_id` `restricoes_rmsp`; formato e passo a passo em
[`../restricoes_municipais.md`](../restricoes_municipais.md)). Belo Horizonte entrou **só com arquivos**, sem tocar no
código do núcleo (importador, schema e `restricoes_rmsp.layer.ts`).

| Peça | Arquivo |
|---|---|
| Regras | `data/raw/municipios/3106200.json` (`fonte_id` `belo-horizonte`) |
| Área Central (polígono curado) | `data/raw/municipios/geo/3106200_area_central.geojson` |
| Corredores, tobogã, Av. N. Sra. do Carmo e a via do perímetro da Área Central (vias do OSM pelo nome) | `data/raw/municipios/geo/3106200_vias.geojson` (`construir: trechos`) |
| Lei 7.648/1999 (revogada, registro histórico) | `data/raw/municipios/geo/3106200_lei_7648_contorno.geojson` |
| Seed | `db/seed/layers/restricoes_rmsp__belo-horizonte.sql` (268 feições, 0,7 MB) |
| Teste | `api/test/layers/mun_bh.test.ts` (16 testes; 4 rotas reais) |

Pesquisa usada: `bh_capital` (`research.json` com as correções do `verify.json`), com o texto integral dos atos baixado
da API do Diário Oficial do Município (`api-dom.pbh.gov.br`). Atos conferidos em 10/10/2026.

## Quem é atingido

Portaria BHTRANS DPR 138/2009, art. 1º, I e II (e os incisos iguais dos arts. 2º a 7º), com a redação da Portaria
077/2014, art. 2º ("lotação" passa a "capacidade de carga"), e da Portaria 004/2019, art. 1º (5 t passa a 5,50 t):

- **livre**: capacidade de carga até 5,5 t **E** comprimento até 6,50 m;
- **restrito**: capacidade de carga acima de 5,5 t **OU** comprimento acima de 6,50 m;
- **carretas e caminhões-trator (cavalos mecânicos)**: proibidos em qualquer horário na Área Central (art. 1º, III) e na
  Av. Nossa Senhora do Carmo (art. 7º, III); nos corredores e no tobogã entram nas mesmas janelas dos demais (art. 6º, II;
  Portaria 077/2014, art. 1º, II).

No arquivo: `alvo.qualquer = [payload_t acima de 5,5; comprimento_m acima de 6,5; tipo em semitrailer/truck_trailer/cvc]`
e, na Área Central e na N. Sra. do Carmo, a variante `carreta` (mesmo tipo) com 24 h, todos os dias. O critério é a
**capacidade de carga** (lotação do CRLV), não o PBT: usa o campo `payload_t` do núcleo. Sem a capacidade informada, a
camada fica com o lado seguro (a regra vale se valer com alguma capacidade possível até o PBT) e avisa
`municipal_capacidade_nao_informada` pedindo a capacidade do CRLV. BH não define VUC (`vuc: null`).

## Regras

| id | Tipo | Onde | Horário | Status (confiança) | Ato e artigo |
|---|---|---|---|---|---|
| `bh_area_central` | zona | Área Central: Hipercentro, Savassi, Lourdes, Assembleia/Barro Preto e Área Hospitalar (7,52 km²) | seg–sex 7h–20h; sáb 7h–15h; carretas e cavalos 24 h, todos os dias | ativa (alta) | Portaria BHTRANS DPR 138/2009, arts. 1º a 5º (perímetros), art. 1º, I a III, art. 8º (áreas dos arts. 2º a 5º na regra do art. 1º) e art. 9º (autorização); Portaria 077/2014, art. 2º; Portaria 004/2019, art. 1º |
| `bh_area_central_vias_limite` | via | Av. Afonso Pena entre a R. dos Inconfidentes e a Av. do Contorno, nos dois sentidos (via do perímetro citada no art. 2º que ficou na borda externa do polígono) | igual à Área Central: seg–sex 7h–20h; sáb 7h–15h; carretas e cavalos 24 h | ativa (alta) | Portaria 138/2009, art. 2º (inclui a Av. Afonso Pena entre a R. dos Timbiras e a Av. do Contorno), art. 8º, art. 1º, II e III, e art. 9º; Portaria 077/2014, art. 2º; Portaria 004/2019, art. 1º |
| `bh_corredores` | via | 16 trechos de corredores de acesso (tabela abaixo) | seg–sex 7h–9h e 17h–20h; sáb 7h–9h (carretas também) | ativa (alta) | Portaria 138/2009, art. 6º e inciso II; Portaria 077/2014, art. 1º, parágrafo único (trechos da Contorno) e art. 2º; Portaria 004/2019, art. 1º |
| `bh_contorno_toboga` | via | Tobogã da Av. do Contorno: R. dos Inconfidentes → R. Ceará e R. Andaluzita → Av. Afonso Pena, só nesse sentido | 24 h, todos os dias (carretas também) | ativa (alta) | Portaria 077/2014, art. 1º, I e II (desde 01/07/2014), art. 3º (autorização) e art. 4º (revoga a 139/2013); Portaria 004/2019, art. 1º |
| `bh_nsra_carmo` | via | Av. Nossa Senhora do Carmo (BR-356), entre a Av. do Contorno e a R. Professor Rodrigues Seabra, nos dois sentidos | seg–sex 7h–20h; sáb 7h–15h; carretas e cavalos 24 h | ativa (alta) | Portaria 138/2009, art. 7º, I a III (desde 25/01/2010); Portarias 077/2014, art. 2º, e 004/2019, art. 1º |
| `bh_lei_7794_1999` | via | Av. Nossa Senhora do Carmo inteira | todos os dias 7h–20h (o texto não limita os dias) | **desativada** (baixa) | Lei 7.794/1999, art. 1º (capacidade de carga acima de 2.000 kg) |
| `bh_lei_7648_1999` | zona | Área da Av. do Contorno, inclusive (art. 1º, I); os 11 corredores dos incisos II a XII não foram desenhados | era seg–sex 7h–19h30 | **revogada** (alta) | Lei 7.648/1999, art. 1º; revogada pela Lei 12.016/2026, art. 1º (Anexo I, item LXV, da Lei 11.520/2023) e art. 4º |

Todas com `feriados: aplica` (os atos não excetuam feriado) e domingo livre (os atos só fixam horário de segunda a
sábado). A exceção dos atos é a autorização da BHTRANS para casos excepcionais (Portaria 138/2009, art. 9º; Portaria
077/2014, art. 3º), que o perfil do veículo não tem: aparece só no texto dos avisos.

### Os 16 trechos de corredores (Portaria 138/2009, art. 6º)

O art. 6º lista 15 itens; o parágrafo único do art. 1º da Portaria 077/2014 troca o 15º (Contorno entre Afonso Pena e
Amazonas, sentido horário) por dois, de sentido único. O `inciso` `6º-n` é a posição do item na lista do art. 6º.

| inciso | Trecho do ato | No OSM | Extensão (pistas) |
|---|---|---|---|
| 6º-1 | Av. Afonso Pena, entre a Av. do Contorno e a Av. Bandeirantes | 2 pistas | 2,5 km |
| 6º-2 | Av. Prudente de Morais (toda) | 2 pistas | 3,6 km |
| 6º-3 | Av. Raja Gabáglia, entre a Av. do Contorno e a Av. Barão Homem de Melo | 2 pistas (`Raja Gabaglia` e `Raja Gabáglia`) | 8,6 km |
| 6º-4 | Av. Amazonas, entre a Av. do Contorno e a Av. Silva Lobo | 2 pistas | 2,8 km |
| 6º-5 | Av. Tereza Cristina, entre a Av. do Contorno e a Av. Silva Lobo | 2 pistas (`Tereza` e `Teresa`); a ponta é o Viaduto Deputado Ulysses Guimarães, por onde a Silva Lobo cruza a avenida | 4,4 km |
| 6º-6 | Elevado Castelo Branco | `Via Elevada Dona Helena Greco` (`old_name` Elevado Castelo Branco) | 1,8 km |
| 6º-7 | Av. Pedro II, entre a Av. N. Sra. de Fátima e a Av. Carlos Luz | `Avenida Dom Pedro II`, do início dela na Lagoinha (onde começa a N. Sra. de Fátima) à Carlos Luz; uma pista por trecho, cada uma no seu sentido | 4,5 km |
| 6º-8 | Av. Antônio Carlos, entre a Av. N. Sra. de Fátima e a Av. Bernardo Vasconcelos | do início da avenida no Complexo da Lagoinha (a 380 m da N. Sra. de Fátima) à Bernardo Vasconcelos; **aproximado** | 6,2 km |
| 6º-9 | Túneis Presidente Tancredo Neves e Prefeito Souza Lima (Lagoinha) | os dois túneis (sem as pistas do BRT MOVE) | 0,8 km |
| 6º-10 | Av. Cristiano Machado, entre os túneis e a Av. Silviano Brandão | 2 pistas | 1,6 km |
| 6º-11 | Av. dos Andradas, entre a Av. do Contorno e a Av. Silviano Brandão | 2 pistas | 5,6 km |
| 6º-12 | R. Itajubá, entre a Av. do Contorno e a R. Pouso Alegre | mão única | 0,1 km |
| 6º-13 | R. Pouso Alegre, entre a Av. Flávio dos Santos e a R. Jacuí | mão única para oeste até a R. Itajubá e para leste a partir da R. Jacuí: montado em duas partes | 0,8 km |
| 6º-14 | R. Jacuí, entre a R. Pouso Alegre e a Av. Cristiano Machado | mão única no começo, mão dupla depois | 0,8 km |
| 6º-15a | Av. do Contorno, entre a R. Ceará e a Av. Amazonas, **sentido horário** | pista interna, rumo oeste no lado sul | 3,3 km |
| 6º-15b | Av. do Contorno, entre a Av. Amazonas e a R. Andaluzita, **sentido anti-horário** | pista externa, rumo leste no lado sul | 3,3 km |

Na Contorno (mão dupla com canteiro, mão de direção à direita), o sentido horário é a pista interna. No lado sul, a
ordem das transversais, de oeste para leste, é: Amazonas, …, Nossa Senhora do Carmo, Andaluzita (do lado de fora),
Ceará (do lado de dentro), Afonso Pena, Inconfidentes. Assim, no sentido horário (rumo oeste) o tobogã vai da
Inconfidentes à Ceará e o corredor continua da Ceará à Amazonas; no anti-horário (rumo leste) o corredor vai da Amazonas
à Andaluzita e o tobogã continua da Andaluzita à Afonso Pena. O teste confere o rumo de cada linha.

## Decisões

- **Capacidade de carga, não PBT** (Portaria 077/2014, art. 2º): `payload_t` em todas as regras. Um caminhão de 6,3 m
  com 5 t de capacidade informada é livre mesmo com PBT de 12 t; sem a capacidade, o app aplica a regra e avisa.
- **Carreta** = cavalo + semirreboque, caminhão + reboque e CVC. O ato fala em "carretas e caminhões-trator (cavalos
  mecânicos)"; incluir o caminhão + reboque é o lado seguro (na prática ele já passa de 6,50 m).
- **Feriado**: os atos não falam em feriado; a regra vale também no feriado (interpretação do silêncio do ato, como
  anotou o verify). **Domingo**: livre, porque os atos só fixam horário de segunda a sábado (a tabela da BHTrans, página
  "Áreas de carga, descarga e com restrições", atualizada em 07/10/2021, diz o mesmo).
- **Origem ou destino dentro da Área Central**: a zona não é excluída e a rota avisa (`rmsp_origem_na_zona` /
  `rmsp_destino_na_zona`). É política do app (como na ZMRC de SP); o ato não traz essa exceção. A via do perímetro
  (`bh_area_central_vias_limite`) segue a zona (`zona_vinculada: bh_area_central`): com origem ou destino na Área Central,
  ela também não restringe. Os corredores, o tobogã e a N. Sra. do Carmo continuam valendo (não têm `zona_vinculada`).
- **Via do perímetro fora do polígono** (`bh_area_central_vias_limite`): o art. 2º inclui expressamente a "Av. Afonso Pena
  entre Rua dos Timbiras e Av. do Contorno", e o art. 8º aplica a ela a regra do art. 1º. Da Timbiras à Inconfidentes a
  avenida é interna à Área Central (entre as áreas dos arts. 2º e 5º); da Inconfidentes à Contorno ela fica na borda
  externa do polígono (recorte junto ao tobogã) e, com o recuo de 20 m, ficaria livre. Esse trecho (cerca de 130 m por
  pista) entra como via, com as janelas, o alvo e a variante de carreta da Área Central. Os demais trechos-limite citados
  nos arts. 2º a 5º são internos à união das áreas e já estão na zona. Sobram pontas de 15 a 30 m da Afonso Pena junto à
  esquina com a Inconfidentes, dentro da faixa de 20 m do recuo, como em toda esquina do polígono.
- **Pedro II (6º-7)**: a Av. N. Sra. de Fátima não cruza a Pedro II. Ela começa na Lagoinha, a cerca de 70 m do início
  da Pedro II, e segue paralela a ela até o Carlos Prates. O ponto de partida do trecho é o início da Pedro II na Lagoinha,
  o mesmo marco usado no 6º-8, e o mapa BHTrans de 14/02/2019 desenha a Pedro II restrita da Carlos Luz até a Lagoinha.
  A primeira versão encaixava a N. Sra. de Fátima onde ela chega a 25 m da Pedro II, no Carlos Prates (lon -43,9517), e
  deixava cerca de 0,8 km por pista sem restrição; corrigido na revisão.
- **Carga e descarga**: os atos proíbem também a operação de carga e descarga; o app só trata a circulação.
- **Vigência registrada (`vigencia_inicio`)**: 29/01/2019, data da redação atual (5,5 t; Portaria 004/2019, art. 2º:
  vigência na publicação). Histórico nas notas: hipercentro desde 13/10/2009 (Portaria 111/2009, consolidada no art. 1º);
  Savassi (art. 2º) desde 25/01/2010, Lourdes (art. 3º) desde 26/04/2010, Barro Preto (art. 4º) desde 26/07/2010 e
  Hospitalar (art. 5º) desde 25/10/2010, com horário de pico no primeiro ano e a regra do art. 1º depois (art. 8º);
  corredores desde 21/02/2011; N. Sra. do Carmo desde 25/01/2010; tobogã desde 01/07/2014.
- **Lei 7.794/1999** (N. Sra. do Carmo, capacidade acima de 2 t, 7h–20h): não aparece revogada no DOM nem nos Anexos das
  Leis 11.520/2023 e 12.016/2026, mas a BHTrans aplica a Portaria 138/2009 na avenida. Confiança baixa: entra
  **desativada**, com o motivo; a rota só avisa (`municipal_regra_nao_aplicada`) quando passa na avenida com veículo que
  seria alvo.
- **Lei 7.648/1999** (área da Contorno e corredores; mais de 1 eixo **e** capacidade acima de 8 t; seg–sex 7h–19h30):
  revogada pela Lei 12.016/2026 (DOM de 22/05/2026). A lei entra em vigor 90 dias depois da publicação (art. 4º);
  contando o dia da publicação e o último dia (LC 95/1998, art. 8º, § 1º), o prazo termina em 19/08/2026 e a revogação
  vale a partir de **20/08/2026** (`vigencia_fim`). Registro histórico, nunca aplicado.
- **Não registrados**: a Portaria 139/2013 (tobogã anterior, revogada pela 077/2014, art. 4º) e a Portaria 111/2009
  (revogada pela 138/2009, art. 10) são versões anteriores das mesmas regras; ficam só aqui no histórico.

### Correções do `verify.json` aplicadas

- Exemplos da AETV (carga indivisível, betoneira, guindaste, mudança, utilidade pública) vêm da página da BHTrans, não do
  art. 9º: o texto da exceção diz isso.
- "Domingo livre" vem da tabela da BHTrans; aplicar no feriado é interpretação do silêncio do ato; "origem/destino: avisa"
  é escolha de produto: tudo registrado nas notas e aqui.
- A página DTLP (03/09/2026) não cita a Portaria 004/2019 nem 5,5 t: não foi usada como confirmação do limite.
- Lei 7.648/1999: área da Contorno **e 11** corredores (12 incisos), mais de 1 eixo **e** acima de 8 t, e o art. 2º de
  carga e descarga no hipercentro.

## Geometria

- **Área Central** (`construir: manual`): polígono laranja do mapa BHTrans "Restrição CD" (PDF vetorial de 14/02/2019),
  georreferenciado pela pesquisa (similaridade por 3 pontos de controle — Afonso Pena x Amazonas, Praça Raul Soares e
  Praça da Liberdade — e ICP das quadras do mapa contra os nós do OSM; erro mediano de 13 m; o comentário do script que
  fala em "5 praças" está desatualizado, como notou o verify). Nesta frente ele foi **ajustado às quadras do OSM**: as vias do PBF foram poligonizadas em quadras, e
  entra a quadra com mais da metade da área dentro do polígono do mapa; os canteiros centrais das vias-limite (Contorno,
  Andradas) ficam de fora. O polígono do mapa cobria cerca de 1,8 km das pistas da Contorno no lado sul (mesmo com o recuo de
  20 m) e tinha 6 buracos de 1 a 206 m² (artefatos); o ajustado para na pista interna e não tem buracos. Resultado: 7,52 km² (mapa: 7,47 km²; diferença simétrica 0,19 km²). Conferido com os perímetros dos
  arts. 1º a 5º: as bordas são Contorno, Andradas (só a pista sul), Goitacazes e Rio Grande do Sul (canto noroeste, fora
  das áreas), Caetés, Rio de Janeiro, Guaicurus e Espírito Santo (recorte da Praça da Estação), Getúlio Vargas e
  Bernardo Guimarães (recorte do art. 5º) e Inconfidentes/Afonso Pena (recorte junto ao tobogã). A rota recua o polígono
  20 m, então as vias-limite ficam livres, exceto a Av. Afonso Pena entre a R. dos Inconfidentes e a Contorno, que o
  art. 2º inclui expressamente e entra como via (`bh_area_central_vias_limite`; ver Decisões). Por ser ajustado ao OSM,
  o polígono é derivado do OSM (ODbL).
  Para refazer: rodar o georreferenciamento da pesquisa (`bh_capital/georef/`) e repetir o ajuste às quadras (PBF de
  `data/valhalla/sudeste-latest.osm.pbf`, recorte com `osmium extract`, `shapely.ops.polygonize`).
- **Vias** (`construir: trechos`): montadas pelo construtor do núcleo a partir dos nomes e das transversais do ato. O OSM
  veio do PBF local (o mesmo dos tiles do Valhalla), gravado no formato do cache do Overpass
  (`data/cache/municipios/osm_named_3106200.json`), sem consulta ao Overpass. Ajustes de dados (sem mexer no núcleo):
  - 6º-1 (Afonso Pena) e 6º-3 (Raja Gabáglia): a pista sentido bairro tem um way de 5 m (OSM 963780960 e 700804619) que o
    construtor descarta (`L.length > 5`), o que corta o caminho; cada pista foi montada como trecho próprio, com a pista
    sentido bairro em duas partes (ponta `lonlat` dos dois lados do way curto);
  - 6º-5: a Av. Silva Lobo termina a 64 m da Tereza Cristina e cruza a avenida pelo Viaduto Deputado Ulysses Guimarães;
  - 6º-7: uma pista por trecho (`sentido: true`), com a ponta da Lagoinha em coordenada: início do way 314275940 (pista
    sentido Carlos Luz) e fim do way 497948131 (pista sentido Lagoinha);
  - 6º-8: as pistas da Antônio Carlos não se encontram na ponta sul; cada pista foi montada separada (`aproximado`);
  - 6º-13: R. Pouso Alegre em duas partes, por causa do sentido das mãos.
  `pendencias` do arquivo: nenhuma.
- **Validação no Valhalla** (import): 396 pedaços de até 400 m → 213 linhas encadeadas. Três pedaços não passam no
  `edge walk` do `linear_cost_factors` nem reencaixados: Raja Gabáglia (way 701522829, 316 m, pista sentido Contorno) e
  Amazonas (ways 244672379, 239 m, sentido bairro, e 964682951, 74 m, sentido Contorno), perto de (-43.966, -19.931) e
  (-43.956, -19.963). Testado à parte: nem a própria forma da rota do Valhalla nesses trechos passa no edge walk. Ficaram
  de fora (cerca de 630 m num sentido); o resto do corredor continua penalizado.
- **Lei 7.648/1999**: contorno externo das pistas da Av. do Contorno no OSM (faixa de 12 m, simplificado a 5 m).

## Como a rota usa

- Área Central: `exclusions` (bloqueio duro, polígono recuado 20 m) no horário de saída; origem/destino dentro: não exclui
  e avisa.
- Corredores, tobogã, N. Sra. do Carmo e a via do perímetro: `costLines` com fator 1000 (a via do perímetro sai com
  origem ou destino na Área Central); as pistas de mão única só no sentido do desenho
  (o tobogã e os trechos 6º-15a/b só no sentido do ato).
- `annotate`: passagem estimada, via restrita usada sem checagem do `routing.ts`, capacidade não informada, trecho
  aproximado (6º-8) e a Lei 7.794/1999 desativada.

Exemplo real (teste): Lagoinha/Bonfim (-19,905; -43,942) → Serra (-19,945; -43,930), quarta 10h. O toco (9 m) contorna a
Área Central (9,1 km); o caminhão de 6,3 m com 4 t de capacidade informada atravessa o centro (6,8 km); sem a capacidade
informada, o de 6,3 m desvia e a rota pede a capacidade do CRLV; no domingo o toco atravessa.

## Licenças

- Portarias BHTRANS e leis municipais (DOM de Belo Horizonte): ato oficial, domínio público (Lei 9.610/1998, art. 8º, IV).
- Mapa BHTrans "Restrição CD": material oficial, usado só como referência da área.
- Vias e polígonos ajustados ao OSM: ODbL 1.0 (© colaboradores do OpenStreetMap), em `data_features`, nunca exportados
  para o OSM.
- Registrado em `fonte.licenca` (vai para `data_layer_runs`, `GET /api/sources`, fonte `belo-horizonte`).

## Limitações

- Janela avaliada no horário de saída (o `annotate` só avisa a passagem estimada).
- A autorização da BHTRANS (AETV) e a carga e descarga não estão no perfil do veículo.
- A descrição da zona no mapa (`features`) mostra só as janelas gerais; a variante de carreta (24 h) aparece na rota.
- O aviso de trecho aproximado lista os nomes de todas as vias da regra usadas pela rota, não só o 6º-8.
- Fora do escopo desta frente (pesquisa `bh_capital`): Anel Rodoviário (caminhão na faixa da direita, CTB art. 29, IV;
  faixas 1 e 2 do Betânia; regra por faixa não é representável no Valhalla), vagas de carga e descarga do Rotativo
  Digital (sem base aberta), pistas do MOVE (camada `corredores_onibus`), projeto de restrição no Buritis (sem ato de
  implantação), Betim (Lei 5.797/2014, confiança baixa) e Contagem (sem regra de área).

## Testes

```bash
cd api && API_URL=http://localhost:3000 npx vitest run test/layers/mun_bh.test.ts
```

Reimportar só BH (gera a geometria que faltar, valida no Valhalla, grava no banco e regrava o seed):

```bash
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e VALHALLA_URL=http://valhalla:8002 \
  -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer municipios:3106200
```
