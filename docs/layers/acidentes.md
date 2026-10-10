# Camada `acidentes` — pontos críticos de acidentes com caminhão

Camada **informativa** (grupo `seguranca`): não muda a rota. Mostra no mapa um heatmap dos pontos críticos e, no
resultado da rota, um resumo com a contagem e até 5 avisos `warn` dos trechos críticos atravessados.

| Peça | Arquivo |
|---|---|
| Importadores | `importers/sources/acidentes_infosiga.py` (também guarda os utilitários comuns), `acidentes_artesp.py`, `acidentes_prf.py`, `acidentes_reds_mg.py` (MG, ver [seguranca_mg.md](seguranca_mg.md)) |
| Seeds | `db/seed/layers/acidentes__infosiga.sql`, `acidentes__artesp.sql`, `acidentes__prf.sql`, `acidentes__sejusp-mg.sql` (0,2 / 1,9 / 2,5 / 5,0 MB) |
| API | `api/src/layers/acidentes.layer.ts` |
| Testes | `api/test/layers/seguranca.test.ts`, `api/test/layers/seguranca_mg.test.ts` |

## Fontes e licenças

| Fonte | Cobertura | Licença registrada | Atualização |
|---|---|---|---|
| **Infosiga SP** (Detran-SP) — `https://infosiga.detran.sp.gov.br/painel/download/file/dados_infosiga.zip` | Estado de SP, todas as vias; só sinistros **com vítima** e notificações | Sem licença nomeada. O Guia de Referência do Infosiga define os dados abertos como de uso, reuso e redistribuição livres, sujeitos no máximo a atribuição e à "manutenção dos mesmos termos de abertura". Citação pedida: "DEPARTAMENTO ESTADUAL DE TRÂNSITO DE SÃO PAULO (Detran-SP). Infosiga: Dados abertos". O Decreto SP 68.769/2024 (art. 1º §1º e art. 2º, V) trata as informações de transparência ativa como de livre utilização. | Mensal (dado até 08/2026 na carga de 09/10/2026) |
| **ARTESP** — `https://dadosabertos.artesp.sp.gov.br/dataset/acidentes` | Rodovias estaduais **concedidas** de SP; inclui acidentes **sem vítima** | CC-BY (Creative Commons Attribution), conforme o CKAN da ARTESP | CSV anual, atualizado ao longo do ano |
| **PRF** — `https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf` | Rodovias **federais** de todo o país; inclui acidentes sem vítima | Registrada (igual na API, no importador e aqui): "Dados abertos PRF — livre utilização (Decreto federal 8.777/2016, art. 4º, caput e § 1º, red. Decreto 9.903/2019); o rodapé do gov.br cita CC BY-ND 3.0 para o conteúdo do site, interpretado como não aplicável aos dados; confirmar via Fala.BR". Ver nota abaixo. | Mensal (CSV "agrupado por pessoa", Google Drive) |
| **SEJUSP-MG (REDS)**, Painel de Sinistro de Trânsito — `https://drive.google.com/drive/folders/1W_4SsAW8u5bvsaBoHhwInpUr72vES8yw` | Estado de MG, todas as vias exceto as BRs (que ficam com a PRF); inclui acidentes **sem vítima** | Sem licença nomeada; Decreto MG 48.383/2022, art. 22 (livre utilização, observados o art. 6º da LGPD e a Lei 14.129/2021). Redação completa e incerteza em [seguranca_mg.md](seguranca_mg.md) | CSV anual no Google Drive (ano corrente atualizado mais ou menos todo mês) |
| API de localidades do IBGE (`servicodados.ibge.gov.br`) | Só para grafar o nome oficial do município ("SAO PAULO" → "São Paulo") | Dado público do IBGE | Cache de 90 dias |

Os dados ficam em `data_features` (`layer_id = 'acidentes'`), separados do OSM, e **nunca** vão para o OSM.
Cada carga registra fonte, URL, licença e um resumo em `data_layer_runs` (`GET /api/sources`).

**Licença da PRF (conferida em 09/10/2026):** os arquivos não trazem licença. A base legal é o **Decreto federal
8.777/2016, art. 4º** (redação do Decreto 9.903/2019, conferida no Planalto): "Os dados disponibilizados pelo Poder
Executivo federal e as informações de transparência ativa são de livre utilização pelos Poderes Públicos e pela
sociedade"; o § 1º autoriza a utilização gratuita das bases de dados cujo detentor de direitos patrimoniais seja a União.
A própria página da PRF cita esse decreto. A frase "sem restrição de licenças" que aparece no topo da página é só a
definição genérica de "Dados Abertos", não uma licença do conjunto de dados. O rodapé do portal gov.br diz que o
conteúdo do site está sob CC BY-ND 3.0; interpretamos que vale para os textos do site, não para os dados (que o
decreto declara de livre utilização). Atribuímos a fonte por boa prática.

**Incerteza de licença:** Infosiga e PRF não têm uma licença padrão (CC etc.) nomeada nos arquivos; a leitura acima vem
das páginas oficiais e da norma (ver `docs/research/seguranca_acidentes_roubo/NOTES.md`). Para uso comercial em escala,
vale confirmar por SIC/Fala.BR. A camada só publica agregados, o que reduz o risco.

## Método (importadores)

1. **Janela de 3 anos** terminando no último dia do mês do dado mais recente de cada fonte
   (carga de 09/10/2026: ARTESP 01/10/2023–30/09/2026; PRF e Infosiga 01/09/2023–31/08/2026).
2. **"Com caminhão"**: Infosiga `qtd_caminhao > 0`; ARTESP `VEICULOS_ENVOLVIDOS` com CAMINHÃO, CARRETA, BITREM/CVC,
   SEMI-REBOQUE ou REBOQUE (a verificação da pesquisa mostrou que filtrar por "CAMINH" pega CAMINHONETE e perde BITREM);
   PRF `tipo_veiculo` em Caminhão, Caminhão-trator, Semireboque, Reboque (sem Caminhonete).
3. **Grade de 250 m** em SIRGAS 2000 / Brazil Polyconic (EPSG:5880). A célula só é publicada com **pelo menos 3 acidentes
   com caminhão** na janela. O ponto publicado é a média das coordenadas desses acidentes (cai sobre a via, não no centro
   da célula); com no mínimo 3 eventos, não é a posição de nenhum acidente individual.
4. **Propriedades** (`props`): `total` e `fatais` (todos os veículos na célula), `caminhao`, `caminhao_vitima`,
   `caminhao_fatais`, `obitos`, `caminhao_moto`, `caminhao_pedestre`, `periodo` (acidentes com caminhão por faixa:
   madrugada 0h–5h59, manhã 6h–11h59, tarde 12h–17h59, noite 18h–23h59 — os mesmos turnos do Infosiga), `pico`,
   `via` (só se ao menos 2 acidentes da célula têm o mesmo nome), `municipio`, `score`, `nivel`, `janela`, `fonte`.
5. **Nível**: `score = com caminhão com vítima + 2 × com caminhão com morte + 0,2 × com caminhão sem vítima`.
   Os sem vítima pesam pouco porque só ARTESP e PRF os publicam (o Infosiga não): assim o nível fica comparável entre
   vias urbanas e rodovias. `muito_alto` ≥ 15, `alto` ≥ 8, senão `moderado`. Carga de 09/10/2026:
   ARTESP 2.829 células (9 muito alto, 118 alto), PRF 3.912 (33 / 316), Infosiga 317 (1 / 23). Carga de 10/10/2026 da
   SEJUSP-MG: 7.523 células (8 / 57).

### Divisão por jurisdição (sem dupla contagem)

O mesmo acidente numa rodovia de SP pode estar no Infosiga **e** na ARTESP ou na PRF. Decisão: cada malha vem de uma
fonte só.

- rodovias estaduais concedidas → **ARTESP** (mais completa: inclui sem vítima, 100% georreferenciada);
- rodovias federais → **PRF**;
- demais vias (municipais, como as Marginais, e estaduais do DER) → **Infosiga**.

Em MG vale a mesma divisão, com a SEJUSP-MG (REDS) no papel do Infosiga: logradouro de BR fica sempre com a PRF, e as
rodovias estaduais e o Anel Rodoviário de BH só saem do REDS nas células (±1) onde a PRF tem acidentes. O trecho central do
Anel quase não tem registro da PRF (2 em 3 anos). Detalhes e números em [seguranca_mg.md](seguranca_mg.md).

No Infosiga são descartados os sinistros com `administracao` CONCESSIONÁRIA/ARTESP/DNIT ou `circunscricao` FEDERAL e,
como o campo `administracao` não é confiável, também os sinistros "de rodovia" (administração ≠ PREFEITURA,
circunscrição ESTADUAL, tipo de via "ESTRADAS E RODOVIAS" ou logradouro "SP 330", "BR 116"...) que caem numa célula
(±1 célula) onde ARTESP ou PRF têm acidentes.

**Exceções (nunca contam como rodovia coberta):**
- **Marginais Tietê e Pinheiros** (logradouro "SP 015 - TIETE"/"SP 015 - PINHEIROS"). Têm código de rodovia estadual e o
  Infosiga as marca quase sempre com circunscrição ESTADUAL e tipo "ESTRADAS E RODOVIAS", mas são administradas pela
  Prefeitura (`administracao` = PREFEITURA no Infosiga) e **nem ARTESP nem PRF registram acidentes nelas** (conferido:
  nenhum registro "SP015" nos CSVs da ARTESP de 2023 a 2026; a PRF só cobre BRs). Antes da exceção, os acidentes da Marginal perto dos
  entroncamentos (Dutra, Ayrton Senna, Anhanguera, Bandeirantes, Castello) caíam em células cobertas e sumiam da camada.
- Vias com administração PREFEITURA e circunscrição MUNICIPAL **sem código de rodovia** no logradouro (ex.: "AVENIDA
  MARGINAL ..." com tipo de via "ESTRADAS E RODOVIAS", vias marginais municipais ao lado das concessões).

Efeito na carga de 09/10/2026 (janela 09/2023–08/2026): voltam 82 acidentes com caminhão que eram descartados (67 nas
Marginais: 37 na Pinheiros e 30 na Tietê; 15 em avenidas marginais municipais), e o Infosiga passa de 307 para 317
células (1 muito alto, 23 alto). Nenhum dos recuperados tem logradouro de rodovia concedida ou federal ("RODOVIA ...",
"SP 330", "BR 116"), então não há dupla contagem com ARTESP/PRF. Continuam descartados, por precaução, os registros da
Prefeitura com código no logradouro (ex.: "SPI 091/270", "sp 330"), que podem ser acessos de concessões.

Conferido em 09/10/2026 com os acidentes com caminhão de 2025:
- o Infosiga marca boa parte das concessões como "DER" (Anhanguera SP-330: 157 DER × 111 CONCESSIONÁRIA; Rodoanel SP-021:
  36 × 78; Castello SP-280: 50 × 99), por isso o filtro só por `administracao` não basta;
- casar registro a registro não funciona: só 39% dos acidentes com caminhão "CONCESSIONÁRIA" do Infosiga têm um acidente
  com caminhão da ARTESP no mesmo dia a até 1 km (33% para os "DER"). Por isso a divisão é por malha, não por registro.

## Na rota (API)

- `annotate`: pontos críticos a até **80 m** da linha da rota (`featuresNearRoute`). Pontos consecutivos a até 1 km
  uns dos outros (ao longo da rota) formam um **trecho** de no máximo 3 km. Viram aviso `warn` (`code: accident_hotspot`)
  os **5 trechos** com pelo menos um ponto alto/muito alto e maior score somado, exibidos na ordem da rota, com km da rota,
  hora aproximada de passagem, nº de acidentes com caminhão, mortes e a faixa do dia com mais acidentes.
  O resumo traz quantos pontos (por nível) e trechos, o total de acidentes com caminhão e as mortes; `data.trechos`
  traz até 50 trechos com todos os números.
- `features`: pontos com `weight` = score/15 (entre 0,15 e 1) para o heatmap. Zoom < 7 só "muito alto"; < 9 alto e
  muito alto; a partir de 9 todos. Propriedades legíveis, no máximo 12 exibíveis (o popup genérico do mapa corta em 12):
  nível, acidentes com caminhão/com vítima/com morte, óbitos, `por_faixa_do_dia` ("madrugada 0 · manhã 2 · ..."),
  período dos dados, fonte, acidentes com todos os veículos e score.
- Severidade nunca é `danger`: não há restrição legal, só risco.

## Como atualizar

```sh
docker compose --profile import run --rm importer acidentes_artesp acidentes_prf acidentes_infosiga
```
O Infosiga usa as células cobertas por ARTESP/PRF, então rode as três juntas. Para MG:
`importer acidentes_prf acidentes_reds_mg` (o REDS também usa as células da PRF). Arquivos brutos ficam em `data/cache`
(Infosiga 147 MB; ARTESP ~10 MB/ano; PRF ~9 MB/ano), com cache de 7 dias (anos antigos: 90 dias). Os ids do Google
Drive da PRF são lidos da página; se ela mudar de formato, o importador usa os ids conhecidos (`FALLBACK_IDS`).

## Limitações

- **Sem exposição**: contagem absoluta, sem dividir pelo volume de tráfego. Rodoanel e Dutra aparecem muito porque
  passam muitos caminhões. Normalizar por VMD (ARTESP/ANTT volume) fica para depois.
- **Infosiga só tem acidentes com vítima** (e notificações, 75% sem coordenada); vias urbanas ficam sub-representadas
  frente às rodovias, o que o peso 0,2 dos sem vítima só compensa em parte.
- **Rodovias federais concedidas pela ANTT** (Dutra, Régis, Fernão Dias) já estão na PRF; os arquivos da ANTT não têm
  coordenada (só km) e não foram usados.
- **Viadutos e cruzamentos**: com raio de 80 m, um ponto crítico de uma via que passa por baixo/por cima da rota pode
  entrar na conta. O agrupamento por trecho e o top 5 reduzem o ruído, mas não eliminam.
- **Hora de passagem** estimada proporcionalmente à distância (sem trânsito real nem paradas obrigatórias).
- Cobertura: estados de SP (Infosiga + ARTESP) e MG (SEJUSP-MG/REDS) e BRs do país (PRF). Nos outros estados, só as BRs
  (RJ e ES não publicam acidentes com coordenada e tipo de veículo; ver a pesquisa `seguranca_rj_mg_es`).
