# Cidade do Rio de Janeiro (IBGE 3304557) — restrições municipais a caminhão

Frente `mun_rio` da camada genérica de restrições municipais (`layer_id` `restricoes_rmsp`; formato, importador e
política em [`../restricoes_municipais.md`](../restricoes_municipais.md)). O Rio entra só como **arquivos de regras**:
nenhum código do núcleo foi alterado.

| Peça | Arquivo |
|---|---|
| Regras (ato, artigo, URL, horários, alvo, VUC, status, confiança) | `data/raw/municipios/3304557.json` (fonte `rio-de-janeiro`) |
| Vias restritas (OSM curado) | `data/raw/municipios/geo/3304557_vias.geojson` |
| Polígonos aproximados da regra geral suspensa (ARP e ARM/ARV) | `data/raw/municipios/geo/3304557_res3055_zonas.geojson` |
| Seed | `db/seed/layers/restricoes_rmsp__rio-de-janeiro.sql` (406 feições, 1,0 MB) |
| Teste | `api/test/layers/mun_rio.test.ts` (17 testes: regras, revisão, camada e 3 cenários de rota real) |

Pesquisa e verificação de 10/10/2026 (tema `rio_capital`: `research.json` + `verify.json`, com as correções do
verify aplicadas). Os atos foram lidos no D.O. Rio (busca e download de edições) e no Querido Diário.

## Achado que muda o produto: a regra geral está SUSPENSA

A regra geral de caminhões do Rio é o **Dec. Rio 45.433/2018** (conceitos ART/ARP/ARM/ARV/VRE, VUC e AEVC) com a
**Res. SMTR 3.055/2018** (polígonos e horários: ARP no Centro, dias úteis 6h–21h; ARM/ARV, dias úteis 6h–10h e
17h–21h). Ela está **suspensa por prazo indeterminado** desde 20/03/2020:

- Res. SMTR 3.254, de 19/03/2020, art. 1º (DO Rio 20/03/2020, p. 42): "Ficam suspensas, por prazo indeterminado, as
  disposições contidas na Resolução SMTR nº 3055";
- Dec. Rio 47.285/2020, art. 1º, "r" (cita os decretos de 2016–2017, já revogados; o parecer da CET-Rio no DO de
  11/01/2024, p. 17, o lê como suspensão do Dec. 45.433 e da Res. 3.055);
- confirmada pela SMTR (página da AEVC, atualizada em 03/03/2023), pelo 1746 (artigo editado em 08/06/2026) e pela
  CET-Rio (DO 11/01/2024); nenhuma revogação da suspensão no DO até 10/2026.

As duas áreas entram **registradas como `suspensa`** (`kind=suspensa`) e **nunca são aplicadas**: não viram exclusão
nem custo; a rota que passa por elas recebe só o aviso informativo `municipal_regra_nao_aplicada` com o motivo.
Sinal contrário (verify): a CRV publicou autorizações com base na 3.055 em 2021–2022, válidas até 2024 — inércia
administrativa, não revogação. Se a suspensão cair, basta trocar `status` para `ativa` (os polígonos são
aproximados: ver Geometria).

## Regras do arquivo

Caminhão = PBT acima de 3,5 t (CTB, Anexo I). "24 h" = o ato não fixa horário.

| Regra (`id`) | Onde | Quando | Quem | Ato e artigo | Confiança | Status |
|---|---|---|---|---|---|---|
| `rio_linha_vermelha` | Linha Vermelha (Via Expressa Pres. João Goulart) no município | 24 h, todos os dias | caminhão de qualquer espécie, inclusive VUC | Res. SMTR 2.204/2012, art. 1º, I, 3; II, 2, a, h, i, j; II, 4, a; parágrafo único, arts. 3º e 4º (DO 19/03/2012, p. 38–39) | alta | ativa |
| `rio_linha_amarela` | Linha Amarela (Av. Gov. Carlos Lacerda), com o Túnel da Covanca | dias úteis 6h–10h e 17h–20h (feriado suspende) | veículos de carga | Res. SMTR 2.063/2010, arts. 1º a 3º (DO 15/12/2010, p. 45) | média | ativa |
| `rio_corredor_reboucas` | Viaduto Saint Hilaire (I), Túneis Antônio (II) e André Rebouças (III), Av. Vital Brasil (IV), Elevados Eng. Freyssinet (V) e Eng. Rufino de Almeida Pizarro (VI) | 24 h | PBT igual ou superior a 6,4 t e reboques (exceto COMLURB) | Portaria TR/SUB/CRV 24.914/2003, art. 1º, I a VI (DO 25/11/2003, p. 36–37) | média | ativa |
| `rio_centro_10798` | Praça XV (I), R. Primeiro de Março (II), R. São José (III), Orla Prefeito Luiz Paulo Conde (IV), no Centro | 24 h | caminhões ("entrada e circulação") | Portaria TR/SUBG/CRV 10.798/2017, art. 1º, I a IV (DO 10/11/2017, p. 61) | média | ativa |
| `rio_transoeste` | Túnel da Grota Funda (I) e pista central da Av. das Américas entre a Av. Ayrton Senna e a Estr. Ver. Alceu de Carvalho, exceto o trecho do Viaduto Alm. Orlando Raso (II) | 24 h, "em quaisquer faixas" | caminhões e reboques | Res. SMTR 2.242/2012, art. 5º, I e II (DO 24/07/2012, p. 27–28) | média | ativa |
| `rio_gonzaga_duque` | R. Gonzaga Duque (Ramos), toda a extensão | 24 h | caminhões (exceto emergência, concessionárias e lixo) | Portaria TR/SUBTT/CRV 8.083/2024, art. 1º e parágrafo único (DO 19/07/2024, p. 20) | alta | ativa |
| `rio_gavea_1451` | R. João Borges (art. 1º) e R. Duque Estrada (art. 2º), Gávea | 24 h | caminhões | Portaria TR/SUBTT/CRV 1.451/2023, arts. 1º e 2º (DO 26/07/2023, p. 28) | alta | ativa |
| `rio_caminho_da_canoa` | Caminho da Canoa (São Conrado) | 24 h | caminhões | Portaria TR/CRV 4.536/2020, art. 1º (DO 21/07/2020, p. 38) | alta | ativa |
| `rio_afonso_de_taunay` | Av. Afonso de Taunay (Barra), da Av. Alda Garrido até a Av. Armando Lombardi | 24 h | ônibus e caminhões (exceto emergência, concessionárias e lixo) | Portaria TR/SUBG/CRV 10.417/2026, art. 1º e parágrafo único (DO 05/08/2026, republicada em 06/08/2026, p. 17) | média | ativa |
| `rio_grumari_verao_2025` | Estr. Roberto Burle Marx, entre a Estrada do Grumari e a Praia do Canto | sáb e dom 6h–22h, de 18/10/2025 a 01/03/2026 | caminhões (exceto utilidade pública e militares) | Portaria TR/SUBG/CRV 5.142/2025, art. 2º (DO 15/10/2025, p. 26–27) | média | ativa, **vencida** (vigência gravada) |
| `rio_santa_cruz_2242` | Santa Cruz: 5 trechos de Barão de Laguna, Felipe Cardoso, Lucindo Passos e Teresa Cristina | seg–sex 6h–20h | caminhões | Res. SMTR 2.242/2012, art. 4º, I a V | baixa | **desativada** |
| `rio_res3055_arp` | ARP do Centro (27 vias-limite e a orla) | dias úteis 6h–21h | caminhões acima do VUC | Res. SMTR 3.055/2018, arts. 2º, 4º e 5º; Dec. 45.433/2018, art. 1º, § 1º, II, VI–VIII | alta | **suspensa** (Res. SMTR 3.254/2020, art. 1º; Dec. 47.285/2020, art. 1º, "r") |
| `rio_res3055_arm_arv` | ARM/ARV (26 vias-limite e a orla: Centro, Zona Sul, Grande Tijuca, parte da Zona Norte e de Jacarepaguá) | dias úteis 6h–10h e 17h–21h | caminhões acima do VUC | Res. SMTR 3.055/2018, arts. 3º a 5º; Dec. 45.433/2018, art. 1º, § 1º, III, IV, VI–VIII | alta | **suspensa** (idem) |

Exceções de cada ato (socorro, guinchos, COMLURB, autorizações por placa da CRV etc.) estão em `excecoes` e só
aparecem nos avisos: o perfil do veículo não tem autorizações municipais.

## VUC carioca

Dec. Rio 45.433/2018, art. 1º, § 1º, VI: VUC é o caminhão com até **2,50 m de largura, 7,20 m de comprimento e
3,50 m de altura total** (diferente de SP, o Rio limita a altura); caminhão é "todo e qualquer veículo automotor de
carga" acima disso (VII). A isenção só vale com **AEVC** da SMTR (VIII; Res. SMTR 3.055/2018, art. 5º, I).

No arquivo, o `vuc` do município tem essa definição com `exige_cadastro: true`, mas **só a regra geral suspensa a
herda**. As definições valem "para efeitos deste Decreto", que está suspenso, e nenhum ato por via isenta o VUC: a
Linha Vermelha proíbe "caminhão, de qualquer espécie"; a Linha Amarela, "veículos de carga"; os demais, "caminhões".
Por isso todas as regras por via têm `vuc: null` e uma `vuc_nota` (o VUC é tratado como caminhão e, com
`is_vuc`, a rota avisa `rmsp_vuc_nao_confirmado`).

## Decisões

- **Linha Vermelha: extensão pelo cadastro municipal.** O OSM tem name=Linha Vermelha também no Elevado Rufino de
  Almeida Pizarro e na parte que passa por Duque de Caxias/São João de Meriti. A extensão vem do CadLog/IPP
  ("Avenida Presidente João Goulart", sem o homônimo do Vidigal): da Pavuna ao Caju. Junto ao rio São João de Meriti
  a malha generalizada do IBGE põe a via em Duque de Caxias, mas o cadastro do Rio a tem como logradouro do
  município (Cordovil) — prevaleceu o cadastro. Na Pavuna, o cadastro tem só ~40 m, que coincidem com a ponte do way
  997177619 (já com hgv=no no OSM): só ela entra. O critério "a até 120 m do CadLog" tinha puxado também os ways
  15091902, 757987510, 758007474 e 209956172 (~0,5 km, long. -43,3460 a -43,3437), fora do cadastro e, pela malha do
  IBGE, quase todos em São João de Meriti (209956172 e 758007474 inteiros, 67 m do 757987510; o 15091902 só encosta no
  cadastro): saíram na revisão de 10/10/2026, para a regra municipal não valer fora do município. O Elevado Rufino
  Pizarro (logradouro próprio no CadLog) fica no corredor Rebouças (inciso VI). Cerca de 1,5 km do cadastro em São
  Cristóvão (ligações com a Ponte e o Gasômetro, que no OSM são outras vias) não entra.
- **Corredor Rebouças: "igual ou superior a 6,4 t"** está gravado como `pbt_t` acima de 6,399 t: o formato só tem
  `acima` (>) e `ate` (<=), e o PBT do CRLV tem duas casas decimais (o teste confere 6,40 t dentro e 6,39 t fora).
  "Reboques" = carreta, caminhão + reboque e CVC; reboque atrás de veículo leve não é avaliado.
- **Linha Amarela com confiança média, ativa.** O texto confere, mas a última citação no DO é de 05/2021 e há risco
  de repristinação (os Decs. 42.252 e 42.272/2016 regularam a via de novo e foram revogados). Sem revogação e com a
  CRV aplicando até 2021, fica ativa. "Dias úteis" = `feriados: suspende` (feriados nacionais, do RJ e do Rio no
  calendário `holidays`). Os veículos de carga até 3,5 t também são atingidos pelo ato, mas a camada só avalia
  caminhões.
- **Transoeste: pista central = pista expressa junto ao BRT.** No OSM a pista central da Av. das Américas é
  `highway=trunk` e as laterais são `secondary` (conferido em seis seções transversais). A exceção do Viaduto Orlando
  Raso tira os ways do último acesso lateral→central antes do viaduto até a primeira saída central→lateral depois dele
  (sentido Recreio: 164948434, 164948422, 963064562, 195631888; sentido Barra: 295577284, 164948428, 164948421).
- **Av. Afonso de Taunay, "a partir da Av. Alda Garrido".** O ato não diz o sentido. A numeração do CadLog/IPP cresce
  da orla (nº 72) para a Av. Armando Lombardi (nº 801); "a partir" foi lido no sentido da numeração: trecho da Alda
  Garrido (nº ~500) até a Armando Lombardi. Regra nova achada só no verify: confiança média.
- **Grumari (sazonal).** Entra como ativa com a vigência da portaria (`vigencia_inicio` 2025-10-18, `vigencia_fim`
  2026-03-02, exclusiva): o app só a aplica com saída nesse período; hoje está vencida e não aparece no mapa. A
  portaria do verão 2026/27 não foi achada até 10/10/2026 (a anterior saiu em 15/10): quando sair, copiar a regra com
  as datas novas.
- **Santa Cruz desativada.** Confiança baixa na pesquisa (o verify confirmou o texto do art. 4º, mas não a aplicação
  atual nem as exceções; outras portarias de caminhão em Santa Cruz foram revogadas em 2018). Fica registrada e só
  avisa. A Rua Antares (ponta do inciso III) não está no OSM: o trecho é aproximado.
- **Gávea sem inciso.** A Portaria 1.451/2023 tem só artigos (art. 1º, R. João Borges; art. 2º, R. Duque Estrada):
  as feições têm `inciso: null` (o item da rota mostraria "inc. art. 1º") e o artigo vai no `trecho` e em
  `base_legal.artigo`.
- **Centro, só no bairro Centro.** Há Rua São José em 15 bairros e Rua Primeiro de Março em outros dois; só as do
  Centro entram. A Praça XV aberta a veículos é a pista do Largo do Paço (alt_name Praça 15 de Novembro); a Orla Conde
  é quase toda de pedestres e VLT: entram só os trechos de serviço. O sentido contrário dessas duas pistas de serviço
  não casou com o grafo do Valhalla e ficou fora (só o sentido do desenho).

## Não modelado (registrado aqui, não no arquivo)

| Assunto | Situação | Por quê |
|---|---|---|
| Av. Brasil, faixa exclusiva de ônibus (Res. SMTR 3.718/2024 com a 3.726/2024; § 4º incluído pela Res. 3.951/2026: reboques, guinchos e plataformas de socorro fora da vedação) | caminhão proibido só na faixa, a qualquer hora | regra por faixa: o Valhalla não modela faixa (limitação do núcleo) |
| Av. Brasil, restrição horária anunciada para 16/03/2024 (pista central Irajá–Caju 4h–22h; laterais nos picos) | **adiada** em 10/03/2024; nenhum ato até 10/2026 | não há ato; vigiar o DO e a CPLOG-Rio |
| Maracanã em dia de jogo (Portaria TR/SUBEX/CRV 1.549/2022: caminhões e utilitários nas vias adjacentes) | vigente por evento | depende do calendário de jogos e a lista de vias não foi lida inteira |
| Joá, Ponte da Joatinga, Elevado das Bandeiras e Túnel de São Conrado (portaria de 13/12/2012) | **expirada** em 17/12/2013 (obras) | o OSM ainda tem hgv=no no Elevado do Joá e na Ponte da Joatinga sem ato atual (ver OSM) |
| Ponte Rio–Niterói e Av. Portuária (Res. ANTT 1.713/2006 e 5.936/2021) | regime antigo revogado pela Res. ANTT 6.000/2022 (efeito em 01/07/2024); ato atual não achado | federal, não municipal; sem ato vigente verificável |
| Linha Vermelha: produtos perigosos (Res. SMTR 2.204/2012, art. 1º, IV) | vigente | é da camada perigosos (`hazmat_trechos_*`), não desta |
| Vagas de carga e descarga | uma portaria da CRV por vaga, sem dataset | fora do escopo de rota |

## Geometria

Tudo derivado do **OpenStreetMap** (Overpass, extrato de 10/10/2026), com `construir: manual` porque o construtor de
trechos do núcleo não filtra por bairro, classe de via nem por um cadastro de referência (ver Pendências).

**Vias (`3304557_vias.geojson`)**: ways com `highway` de veículo (motorway a service, sem footway/pedestrian/path)
pelos nomes do OSM; mão única desenhada no sentido do way (`sentido: unico`), mão dupla nos dois (`ambos`). Recorte:
tira o que passa para os municípios vizinhos (malha do IBGE recuada 40 m), sem recortar pela linha de costa (as pontes
da Linha Vermelha sobre a baía ficam).

| Regra | Seleção no OSM |
|---|---|
| Linha Vermelha | name=Linha Vermelha (consulta por bbox: as pontes sobre a baía ficam fora da área administrativa do OSM), sem official_name=Elevado Rufino de Almeida Pizzarro, a até 120 m do CadLog "Avenida Presidente João Goulart" (sem o Vidigal); na Pavuna, só o way 997177619 (o único que coincide com o cadastro) |
| Linha Amarela | name=Linha Amarela e Túnel Engenheiro Raymundo de Paula Soares |
| Corredor Rebouças | Viaduto Saint-Hilaire; Túnel Antônio Rebouças; Túnel André Rebouças; Avenida Vital Brasil; Viaduto Engenheiro Freyssinet; Viaduto Professor Rufino de Almeida Pizarro, Elevado Professor Engenheiro Rufino de Almeida Pizarro e os ways name=Linha Vermelha com official_name=Elevado Rufino de Almeida Pizzarro |
| Centro | way 258032015 (Largo do Paço); Rua Primeiro de Março e Rua São José no bbox do Centro (-43.185, -22.910, -43.168, -22.893); Orla (da Guanabara) Prefeito Luiz Paulo Conde só `service` |
| Transoeste | Túnel Vice-Presidente da República José Alencar; Avenida das Américas `trunk` entre as longitudes -43.4935 (Alceu de Carvalho) e -43.3660 (Ayrton Senna), sem os 7 ways do Viaduto Orlando Raso |
| Ruas pontuais | Rua Gonzaga Duque; Rua João Borges; Rua Duque Estrada; Caminho das Canoas (official_name Rua Canoa da Pedra Bonita = "Caminho da Canoa" do CadLog); Avenida Afonso de Taunay ao norte de -23.0094 |
| Santa Cruz | cada trecho entre as junções com as transversais (cápsula de 45 m), bbox de Santa Cruz |
| Grumari | Estrada Roberto Burle Marx ao sul de -23.0516 (junção com a Estrada de Grumari) até o fim, em Barra de Guaratiba |

No import (`run.py municipios:3304557`), as linhas foram cortadas em até 400 m, testadas no Valhalla e encadeadas:
522 linhas → 388 vias, todas `valhalla_validado`.

**Zonas da Res. 3.055/2018 (`3304557_res3055_zonas.geojson`)**: os Anexos I e II só existem como imagem no DO. Os
polígonos foram **reconstruídos** encadeando as vias-limite na ordem dos incisos (junção = ponto mais próximo entre uma
via e a seguinte; entre junções, o caminho mais curto pela própria via; componentes da via ligados por até 800 m),
fechando pela orla com pontos no mar e recortando pelo limite municipal do IBGE (que exclui a baía e o oceano).
Substituições: Praça dos Estivadores e Praça Professora Camisão pelo centro da praça; Praça José de Souza Marques pelo
Terminal Dep. José de Souza Marques (Cascadura); Praça Guilhermina Guinle e Ponte Nova omitidas (a via anterior e a
seguinte se encontram). Resultado: ARP ≈ 4,6 km², ARM/ARV ≈ 210 km². São **aproximados** (`aproximado: true`) e só
geram aviso informativo.

## OSM e Valhalla

- 79 de 87 ways da Linha Vermelha, os túneis Rebouças, o Túnel José Alencar e a R. Primeiro de Março/R. São José já
  têm `hgv=no`: o Valhalla já tira o caminhão delas; a camada completa as que faltam, aplica o PBT do corredor
  Rebouças nos elevados e cita o ato nos avisos.
- O OSM tem 33 `hgv:conditional` (29 com o horário da Res. 3.055) e 5 `hgv='no @ ...'` inválidos na Rua Medina,
  resíduos da regra suspensa: fazem o Valhalla desviar caminhão sem base legal. A `main` remove as `hgv:conditional`
  da 3.055 no build dos tiles (`osm/overrides.json`, commit 4fe45cb); esta camada não consegue anulá-las.
- Sem ato atual: `hgv=no` no Elevado do Joá, na Ponte da Joatinga, na Av. Niemeyer e na Autoestrada Lagoa–Barra
  (a portaria de 2012 expirou em 2013).

## Licenças

Atos do Município (D.O. Rio, Querido Diário): domínio público (Lei 9.610/1998, art. 8º, IV). Geometria: OpenStreetMap,
ODbL 1.0 (© colaboradores do OpenStreetMap), mantida em `data_features`, nunca exportada para o OSM; os polígonos da
Res. 3.055 são derivados do OSM (ODbL). CadLog/IPP (Trechos de Logradouros, Instituto Pereira Passos), CC BY 4.0: usado
para conferir a extensão da Linha Vermelha e a numeração da Av. Afonso de Taunay. Limites municipais: IBGE (dados
públicos, citar a fonte). A licença está em `fonte.licenca` (vai para `data_layer_runs` e `GET /api/sources`).

## Testes

```bash
# importar só o Rio (grava a fonte rio-de-janeiro e o seed)
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e VALHALLA_URL=http://valhalla:8002 \
  -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer municipios:3304557
# só o teste da frente (rotas contra a API em API_URL)
cd api && API_URL=http://localhost:3000 npx vitest run test/layers/mun_rio.test.ts
```

Os cenários de rota real: **desvia** — carreta Freguesia → Bonsucesso usa a Linha Amarela às 12h de terça (~6 km
nela) e desvia às 8h; **passa pela região** — caminhão Centro → Tijuca às 8h atravessa a área da regra geral
suspensa sem exclusão e recebe o aviso; Av. das Américas — o caminhão vai pelas laterais e o utilitário usa a pista
central (~10 km).

**Efeito num teste do núcleo (para o merge).** Com a fonte `rio-de-janeiro` no banco, `rmsp.test.ts` › "rota longa
(Rio → SP)" falha em `expect(noite.length).toBe(0)`: a origem (-22,9; -43,2) fica no Rio, e as vias 24 h do Rio a até
15 km do segmento O–D (Linha Vermelha, Rebouças, Centro, Transoeste e as ruas pontuais) entram nas
`costLines` às 22h30 (275 linhas, a até 13,6 km do segmento). É o comportamento previsto da camada; a premissa do teste
é que caiu. A frente não altera esse arquivo (passo 7 de `restricoes_municipais.md`). Filtrar só o Rio não basta: no
banco compartilhado, Arujá e Mairiporã (outra frente) também entram (90 linhas). O ajuste que não depende de quais
municípios estão no banco é conferir o próprio invariante do teste: toda linha com algum ponto a até 15 km do
segmento O–D e nenhuma de Santana de Parnaíba às 22h30.

## Limitações

- Janela avaliada no horário de saída (o `annotate` estima a passagem e avisa).
- O perfil não tem AEVC nem autorizações por placa da CRV: as exceções só aparecem nos avisos.
- "Veículos de carga" até 3,5 t (Linha Amarela) e reboque atrás de veículo leve (Rebouças, Transoeste) não são
  avaliados: a camada só trata caminhão.
- Grumari: o ato inclui os feriados em dia útil, mas o formato não tem "feriado como dia da janela"; esses dias ficam
  sem restrição. A proibição de carga e descarga não é modelada.
- Regras por faixa (Av. Brasil) não são representáveis.
- A regra geral suspensa gera aviso informativo em boa parte das rotas dentro da cidade (a ARM/ARV cobre ~210 km²). A
  ARP fica dentro da ARM/ARV: a rota pelo Centro recebe dois avisos (o núcleo avisa uma vez por regra). Para não pesar,
  o `status_motivo` (que vai no texto do aviso) cita só a suspensão (Res. SMTR 3.254/2020, art. 1º; Dec. 47.285/2020,
  art. 1º, "r"); as confirmações da SMTR, do 1746 e da CET-Rio ficam na `nota`.

## Vigilância (o que pode mudar)

D.O. Rio (busca por "circulação de caminhões", "tráfego de caminhões", "3.055", "3254", "CPLOG", "veículos de carga"),
o artigo do 1746 (updated_at) e o COR: fim da suspensão da Res. 3.055; ato da Av. Brasil; portaria do Grumari 2026/27;
novas proibições pontuais da CRV (o inventário de 2020–2026 está incompleto: a busca do DO esconde parte dos hits).
