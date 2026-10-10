# Interior e litoral de SP — restrições municipais (frente `mun_interior_sp`)

Polos do interior e do litoral paulista (fora da Grande SP) na camada genérica de restrições municipais (`layer_id`
`restricoes_rmsp`). Entraram **só como arquivos** no formato do núcleo
([`docs/layers/restricoes_municipais.md`](../restricoes_municipais.md)): um `data/raw/municipios/<ibge>.json` por
município, a geometria curada em `data/raw/municipios/geo/` e o seed `db/seed/layers/restricoes_rmsp__<fonte_id>.sql`.
Nenhum código do núcleo (camada, importador, schema, validador) foi alterado; o que o núcleo não representa está em
[Limitações e pendências](#limitações-e-pendências).

Fonte das regras: pesquisa `interior_sp` de 10/10/2026 (`research.json`) **com as correções do `verify.json`**. Os atos
foram lidos na fonte primária (Diário Oficial de Campinas via Querido Diário, URBES, SAPL de São Vicente, PDF do decreto
de Jacareí, Imprensa Oficial de Jundiaí). Nenhum município publica a restrição como dado estruturado e o OSM não tem
`hgv:conditional` em nenhum dos 12 municípios consultados: toda a geometria foi montada sobre o OSM pelas vias que o ato
cita.

| Município | IBGE | `fonte_id` | Arquivo |
|---|---|---|---|
| Campinas | 3509502 | `campinas` | `data/raw/municipios/3509502.json` |
| Sorocaba | 3552205 | `sorocaba` | `data/raw/municipios/3552205.json` |
| Jacareí | 3524402 | `jacarei` | `data/raw/municipios/3524402.json` |
| São Vicente | 3551009 | `sao-vicente` | `data/raw/municipios/3551009.json` |
| Guarujá | 3518701 | `guaruja` | `data/raw/municipios/3518701.json` |
| Santos | 3548500 | `santos` | `data/raw/municipios/3548500.json` |
| Piracicaba | 3538709 | `piracicaba` | `data/raw/municipios/3538709.json` |
| Jundiaí | 3525904 | `jundiai` | `data/raw/municipios/3525904.json` |
| São José do Rio Preto | 3549805 | `sao-jose-do-rio-preto` | `data/raw/municipios/3549805.json` |
| Mirassol | 3530300 | `mirassol` | `data/raw/municipios/3530300.json` |

## Regras

### Aplicadas na rota

Zona → `exclusions` (polígono recuado 20 m na API; origem ou destino dentro **não exclui** e avisa
`rmsp_origem_na_zona`/`rmsp_destino_na_zona`, como a ZMRC). Via/ponte → `costLines` com fator 1000.

| Município | Regra (`regra_id`) | Tipo | Quem | Quando | Ato e artigo | Confiança |
|---|---|---|---|---|---|---|
| Campinas | `campinas_anel_rodoviario`: área interna do Anel Rodoviário (Rod. D. Pedro I SP-065, Anhanguera SP-330 e José Roberto Magalhães Teixeira SP-083), recortada pelo limite de Campinas | zona (112,6 km²) | veículo de carga com **comprimento acima de 14 m** | seg–sex 6h–9h e 16h–20h; sáb 9h–14h; feriado não excetuado | Res. SETRANSP 079/2017, art. 3º, I e II, e parágrafo único; art. 6º e Anexos II e III (entradas liberadas); vigência confirmada pela Res. 349/2019, art. 1º, parágrafo único, e pela EMDEC (18/08/2025) | alta |
| Campinas | `campinas_nova_aparecida`: Distrito de Nova Aparecida (R. Batista Raffi, SP-330, Rod. Adalberto Panzan, Rod. Jorn. Francisco Aguirre Proença e divisas com Hortolândia e Sumaré) | zona (8,4 km²) | comprimento acima de 14 m, **de passagem** | todos os dias, 24 h | Res. 079/2017, art. 4º e parágrafo único; arts. 7º a 11 (exceções) | alta |
| Campinas | `campinas_anel_reboucas`: área interna do Anel de Integração Eng. Rebouças (as 20 vias do art. 5º, parágrafo único) | zona (17,3 km²) | comprimento **acima de 6,30 m** (o ato diz "qualquer veículo de carga"; o app só atinge caminhão, PBT acima de 3,5 t: ver Limitações) | seg–sex 6h–20h; sáb 6h–14h; feriado não excetuado | Res. 079/2017, art. 5º, I e II, e parágrafo único, I a XX; arts. 7º a 11 (ACC/ACM só seg–sex 9h–16h e sáb 6h–9h); Res. 349/2019, art. 8º; radares da EMDEC desde 18/08/2025 | alta |
| Sorocaba | `sorocaba_res_semob_02_2025`: Av. Dom Aguirre e Av. Eng. Carlos Reinaldo Mendes, em toda a extensão (22,2 km, 79 pedaços) | via | caminhão que **não é VUC/VLC**: comprimento acima de 6,30 m, largura acima de 2,20 m **ou carga útil até 1,5 t** (isentos VUC até 5,50 x 2,20 m e VLC até 6,30 x 2,20 m, os dois com carga útil acima de 1.500 kg); sem a capacidade informada, aplica e avisa | todos os dias, 24 h (sem janela no ato) | Res. SEMOB 02/25, art. 1º (proibição), art. 2º, I, a e b (VUC e VLC, com a carga útil mínima), art. 3º (autorização, 5 dias ou 24 h em urgência), art. 6º (vigência 12/08/2025; revoga a Res. 014/2003) | alta |
| Jacareí | `jacarei_fora_rcp`: município fora das 7 Rotas de Cargas Pesadas e das rodovias (22 pedaços) | zona (457 km²) | VCP: **PBT acima de 7,99 t, ou comprimento acima de 7,20 m, ou mais de 2 eixos** (o VCL é livre) | todos os dias, 24 h (fora da RCP só com AETC, a qualquer hora) | Dec. 247/2017, art. 2º, IV (as 7 RCP), VI (VCL) e VII (VCP); art. 3º (VCL e VCP livres nas RCP); art. 4º (VCL livre em todas as zonas); art. 5º (VCP fora das RCP só com AETC); arts. 9º e 12 (exceções); art. 15 (vigência) | média |
| Jacareí | `jacarei_vcpb_vcpt`: município **inclusive as 7 RCP**, menos só as rodovias estaduais e federais que o decreto não lista como RCP (Dutra, Carvalho Pinto, D. Pedro I, Henrique Eroles, Nicola Capucci) e as alças (14 pedaços) | zona (459 km²) | VCPB e VCPT pelo tipo do veículo: **caminhão + reboque (`truck_trailer`) e bitrem/rodotrem (`cvc`)**; o treminhão cai numa dessas classes | todos os dias, 24 h (VCPB só nas RCP e com AETC prévia; VCPT proibido) | Dec. 247/2017, art. 2º, VIII (VCPB) e IX (VCPT); art. 6º (VCPB nas RCP só com AETC); art. 8º (VCPT vedado no município); arts. 9º, 10 e 12 | média |
| São Vicente | `sao_vicente_arc`: ARC — Área de Restrição de Caminhões do Centro (Mem de Sá x Pres. Wilson → Benjamin Constant → Campos Salles → Frei Gaspar → Capitão-Mor Aguiar → R. do Colégio → Pça. 22 de Janeiro → Emb. Pedro de Toledo → Mem de Sá) | zona (0,8 km²) | caminhão (CTB) | seg–sáb 10h–19h, **exceto feriados** | Lei 2163-A/2009, art. 1º, caput, §§ 1º a 3º; art. 3º (Executivo pode mudar por decreto); não revogada pela Lei 4.633/2025 | média |
| São Vicente | `sao_vicente_ponte_pensil`: Ponte Pênsil | ponte (200 m) | caminhão (a lei inclui ônibus) | sempre | Lei 2.320/1990, art. 1º (lido na imagem do PDF); parágrafo único (exceção dos ônibus do Japuí) revogado pela Lei 425-A/1996: sem exceção para caminhão | média |
| Guarujá | `guaruja_valdomiro_macario`: R. Valdomiro Macário, Jd. Conceiçãozinha, do acesso ao Assaí até a Av. Santos Dumont (segundo trecho, 560 m); o começo da rua e as alças da rodovia ficam livres | via | caminhão (trânsito e estacionamento) | sempre; barreira física (esferas de concreto) desde 30/04/2025 | sem ato publicado: notícias da Prefeitura de 15/04/2025 (sinalização regulamentadora) e 30/04/2025 (barreira física) | média |

### Registradas e NÃO aplicadas (`kind=desativada`)

A rota não desvia; com veículo alvo, só avisa `municipal_regra_nao_aplicada` (info) quando passa nelas.

| Município | Regra | Motivo (texto completo em `status_motivo`) | Ato/fonte | Confiança |
|---|---|---|---|---|
| Santos | `santos_gonzaga`: Zona de Restrição do Gonzaga (Av. Bernardino de Campos, Pres. Wilson, Vicente de Carvalho, Cons. Nébias e Francisco Glicério), caminhão, todos os dias 12h–20h | sem ato normativo localizado; só notícia do DO de 2002 e radares de 2014; vigência atual não confirmada | DO Santos 16/02/2002 (notícia, sem artigo); DO Santos 03/12/2014, p. 15 (lista de radares) | unverifiable |
| Piracicaba | `piracicaba_area_central`: 17 trechos da área central (16 desenhados, 2 deles com a rua inteira; a travessa do inc. 7 não está no OSM) | sem ato nem horário; quem é atingido é ambíguo (página de mais de 3 eixos x cadastro para qualquer caminhão) | página de serviço da SEMUTTRAN (06/03/2026), sem artigo | unverifiable |
| Piracicaba | `piracicaba_radares_3_eixos`: avenidas com radar para caminhão com **mais de 3 eixos** (10 avenidas inteiras, aproximadas) | sem ato nem horário; a notícia de 2014 sugere proibição em toda a área urbana | página da SEMUTTRAN (06/03/2026) e notícia de 09/12/2024, sem artigo | unverifiable |
| São Vicente | `sao_vicente_oswaldo_toschi`: R. Ver. Oswaldo Toschi (no OSM, "Avenida"), caminhão | lei de rua sem confirmação de sinalização nem de fiscalização | Lei 3339-A/2015, art. 1º | baixa |
| São Vicente | `sao_vicente_rua_campos`: R. Campos, Vila Voturuá, caminhão | idem | Lei 1169-A/2002, art. 1º | baixa |
| São Vicente | `sao_vicente_lei_669a`: Ruas Argentina, Venezuela, Bolívia e Equador (até a Av. Augusto Severo), mais de 2 eixos | idem; a R. Equador entrou inteira (aproximada) | Lei 669-A/1998, art. 1º | baixa |

### Registro histórico (`kind=revogada`, nunca aplicado nem avisado, fora do mapa)

| Município | Regra | Situação | Fonte | `vigencia_fim` |
|---|---|---|---|---|
| São José do Rio Preto | `rio_preto_lei_14748_2024` | Lei 14.748/2024 (restrição a veículos pesados) declarada **inconstitucional**: TJSP, Órgão Especial, ADI 2155355-95.2025.8.26.0000, j. 03/09/2025, v.u. | ementa transcrita nas razões do Veto 22/2025 de Jundiaí (Imprensa Oficial de 25/09/2025) | 2025-09-03 |
| Mirassol | `mirassol_lei_4206_2019` | Lei 4.206/2019 (caminhões de cana, concreto, pedra e cargas pesadas em vias não pavimentadas) declarada **inconstitucional**: ADI 2202907-66.2019.8.26.0000, j. 12/02/2020 | idem (achado do verify) | 2020-02-12 |
| Jundiaí | `jundiai_pl_14649_2025` | PL 14.649/2025 (autorizaria zonas e horários para caminhão) **vetado** integralmente e veto mantido (07/10/2025, 10 votos a 2): nunca virou lei. Jundiaí não tem restrição geral | Veto 22/2025 (IOM 25/09/2025) e resenha da sessão (IOM 10/10/2025) | 2025-09-25 |

O registro existe para que ninguém aplique essas normas por engano (como o ABC 2012 em `3547809.json`).

## Correções do verify aplicadas

- **Jacareí** (verify "corrected"): (1) o decreto **não diz os dias** do horário de restrição (7h–9h e 17h–19h nas
  ZRMC/ZREC) — o "todos os dias" da pesquisa foi retirado; (2) o art. 4º libera o VCL em todas as zonas, sem ressalva de
  horário — o VCL não é alvo em nenhum horário; (3) confiança **média**, não alta (Decs. 1.085/2020 e 359/2022 e os
  Anexos I e II não lidos). A zona ativa é a do art. 5º (fora das RCP só com AETC, a qualquer hora), que independe dos
  anexos. O verify também confirma "bitrem com AETC, treminhão proibido" (arts. 2º–8º): entrou a zona dos arts. 6º e 8º
  (`jacarei_vcpb_vcpt`), também com confiança média.
- **Sorocaba** (verify "confirmed"): o VUC e o VLC do art. 2º, I, só são isentos **com carga útil acima de 1.500 kg**: a
  isenção está no alvo da regra, com a capacidade.
- **Campinas, Nova Aparecida** (verify "corrected"): exceções completadas — ACC e ACM só valem seg–sex 9h–16h e sáb
  6h–9h (art. 7º) e os veículos do art. 10 circulam sem autorização nessas janelas (art. 11).
- **São Vicente, Ponte Pênsil** (verify "corrected"): o art. 1º foi lido na imagem do PDF; a única exceção (ônibus do
  Japuí) foi revogada pela Lei 425-A/1996 — **sem exceção para caminhão**.
- **São Vicente, Lei 669-A/1998**: a R. Equador só até a Av. Augusto Severo (registrada como aproximada).
- **Santos, Piracicaba** (verify "unverifiable"): desativadas com o motivo.
- **Campinas, Anel Rebouças**: radar da Av. Brasil no sentido bairro–Centro (nota da regra).
- **Mirassol**: entrou a partir dos fatos do verify (ementa no mesmo veto de Jundiaí).

## Decisões

- **Campinas regula por comprimento**, não por PBT nem VUC: a Res. 079/2017 não usa o termo VUC (`vuc: null`). O VUC de
  7,20 m do perfil "VUC" de SP tem mais de 6,30 m e entra na restrição do Anel Rebouças; um caminhão até 6,30 m não.
- **Anel Rodoviário, entradas do Anexo II** (Av. Prestes Maia, Av. São José dos Campos, R. Pe. José de Quadros, Av. Lix
  da Cunha, Av. Com. Aladino Selmi, Av. Carolina Florence): são roteiros de ida e volta a partir das rodovias até destinos
  dentro do anel, não travessias. Com destino dentro do anel a zona já não é excluída (política da ZMRC) e o aviso cita
  as entradas liberadas; por isso as entradas não foram recortadas do polígono.
- **Anel Rodoviário, limite municipal**: a região que as três rodovias fecham passa da divisa com Valinhos numa faixa de
  0,24 km² (entre a SP-330 e a divisa, com vias como a Av. Eng. Antônio Francisco de Paula Souza). A resolução é de
  Campinas: o polígono foi recortado pelo limite de Campinas (IBGE, Malha Municipal, qualidade máxima), como o de Nova
  Aparecida e as zonas de Jacareí.
- **Nova Aparecida** proíbe a **passagem**: origem ou destino no distrito não exclui a zona (aviso). O polígono segue o
  parágrafo único do art. 4º, não a relação administrativa "Nova Aparecida" do OSM (que inclui áreas do outro lado da
  Anhanguera).
- **Sorocaba**: a isenção do VUC e do VLC (art. 2º, I, a e b: até 6,30 x 2,20 m **e** carga útil acima de 1.500 kg)
  entrou no **alvo** da regra, não numa definição de VUC (`vuc: null`): a regra vale para quem tem comprimento acima de
  6,30 m, largura acima de 2,20 m ou carga útil até 1,5 t. Sem a capacidade informada, o `enquadrar()` testa as
  capacidades possíveis (0 até o PBT), aplica a regra (lado seguro) e avisa `municipal_capacidade_nao_informada`, como o
  VUC de Cajamar. Só as duas avenidas nomeadas no art. 1º; as "demais vias com sinalização regulamentadora" não têm lista publicada. O OSM tem
  `hgv=no` na Itavuvu, Ipanema e Afonso Vergueiro (talvez de restrição antiga ou de obra) e nada nas vias do ato: a
  camada não usa essas tags. Os limitadores de altura (4,3 m na Dom Aguirre; 3,3 m na Luiz Gama) são da camada de altura.
- **Jacareí** foi modelada como a pesquisa recomendou: zona = limite do IBGE **menos** um corredor de 20 m das 7 RCP, das
  rodovias estaduais e federais (Dutra, Carvalho Pinto, D. Pedro I, Henrique Eroles, Nicola Capucci) e das alças, em 22
  pedaços. Com origem ou destino num pedaço, **só aquele pedaço** deixa de ser excluído e a rota avisa (a entrega no
  município ganha AETC pelo art. 12). Onze ligações curtas (até ~500 m) que o decreto não lista foram mantidas livres para
  que cada rota seja alcançável a partir da Dutra respeitando a mão única (lista em `ligacoes_entre_rotas` no GeoJSON).
  Ativa com confiança média porque o texto de 2017 confere, a notícia de 2023 (já com os decretos de 2020 e 2022) lista
  as mesmas 7 rotas, e as rodovias continuam livres.
- **Jacareí, bitrem, reboque e treminhão** (arts. 6º e 8º): o VCPB (caminhão + reboque, cavalo + semirreboque + reboque,
  cavalo + 2 semirreboques) só circula nas RCP e com AETC prévia, e o VCPT (treminhão) é proibido no município. Segunda
  zona, `jacarei_vcpb_vcpt`: o limite do IBGE menos **só** as rodovias estaduais e federais que o decreto não lista como
  RCP (Dutra, Carvalho Pinto, D. Pedro I, Henrique Eroles, Nicola Capucci) e as alças, em 14 pedaços; as 7 RCP ficam
  **dentro**, inclusive os trechos com nome de rodovia que o decreto lista como RCP (Rod. Euryale de Jesus Zerbine e Rod.
  Geraldo Scavone, da SP-066, e Rod. Nilo Máximo, da SP-077). Alvo pelo predicado `tipo` do núcleo:
  `truck_trailer` e `cvc`. Para o VCPB a regra é exata; o treminhão cai numa dessas classes e o app não o distingue do
  bitrem, então a zona vale igual para ele (do lado seguro, porque nem com AETC ele circula; o aviso diz que o treminhão
  é proibido). A carreta (cavalo + 1 semirreboque) é VCP e segue só a zona do art. 5º. O pedaço urbano é um só (as RCP não
  o cortam): com origem ou destino na cidade ele não é excluído e a rota avisa (`rmsp_destino_na_zona` etc.); a zona do
  art. 5º continua prendendo a rota às RCP. De passagem (origem e destino fora do município), o bitrem e o
  caminhão + reboque perdem as RCP urbanas e ficam nas rodovias.
- **São Vicente, ARC**: ativa com confiança média (texto e horário conferidos; lei não revogada; decretos do art. 3º não
  verificados). A "Av. Antônio Rodrigues" do perímetro não existe no OSM: o trecho da orla até a R. Mem de Sá está como
  Av. Embaixador Pedro de Toledo. `feriados: suspende` (o ato excetua feriados).
- **Guarujá**: a pesquisa sugeria só avisar até achar o ato, mas o verify confirmou as duas notícias (proibição de
  trânsito e de estacionamento, barreira física desde 30/04/2025, exceção para o Assaí). Ficou **ativa** (confiança
  média, permitida pelo núcleo) porque a barreira impede a passagem de qualquer forma e o ponto do "segundo trecho" foi
  fixado: o acesso ao estacionamento do Assaí no OSM (way 1354100246, a 35 m da rodovia). A regra vale dali até a Av.
  Santos Dumont (560 m, `de: {lonlat}` e `ate_extremo: oeste`); o começo da rua e as alças da Rod. Cônego Domênico
  Rangoni com o mesmo nome (ways 205257895 e 205258209) ficam livres, de modo que o caminhão que vai ao Assaí ou sai
  dele para a rodovia não leva custo nem aviso. Aproximado: a notícia não dá o ponto exato da barreira.
- **Leis de rua de São Vicente** (confiança baixa da pesquisa, texto confirmado pelo verify): desativadas. A Lei
  633-A/1998 (mais de 3 eixos em todo o Jardim Pombeba) não foi registrada: o bairro não tem contorno no OSM.
- **Feriados**: só a ARC de São Vicente excetua feriado; nos demais atos `feriados: aplica`.
- **Vigência**: `vigencia_inicio` = publicação (Campinas, 20/02/2017), data fixada no ato (Sorocaba, 12/08/2025) ou
  primeira notícia (Guarujá, 15/04/2025).

## Não registrados

| Caso | Por quê |
|---|---|
| Campinas/Rota das Bandeiras — acesso do km 116 da SP-332 (Real Parque), caminhão seg–sex 6h–9h e 16h–20h, sáb 6h–14h | medida da concessionária com a PM Rodoviária em rodovia estadual (notícia da EMDEC de 20/05/2013), não ato municipal; vigência em 2026 não confirmada (verify: unverifiable). Se confirmada, cabe à camada de rodovias/concessões, desativada até lá |
| São Vicente — Lei 633-A/1998 (Jardim Pombeba, mais de 3 eixos) | sem contorno do bairro no OSM |
| Santos — Av. Martins Fontes (contêiner fora dos picos 7h–9h e 16h–20h, DO 13/05/2005), "Zonas de Restrição" no plural nos contratos da CET, rua bloqueada no Piratininga (DO 30/09/2026) | só manchetes/indícios; a investigar |
| Sorocaba — "demais vias com sinalização regulamentadora" (Res. 02/25, art. 1º) | sem lista publicada (pedir via LAI) |
| Jacareí — horário de restrição 7h–9h e 17h–19h nas ZRMC e ZREC | Anexos I e II (mapas) não estão no PDF (pedir via LAI) |
| Ribeirão Preto — Lei 5.804/1990 (produto perigoso nas zonas residenciais e comerciais) | regra por tipo de carga (o predicado do núcleo não tem carga); é da frente de perigosos |
| Sumaré — Dec. 9.922/2016 (caminhão de lixo não contratado) | regra de nicho, fora do perfil do veículo |
| São José dos Campos, Taubaté, Ribeirão Preto (restrição geral); Bauru, Limeira, Americana, Indaiatuba, São Carlos, Araraquara, Franca, Marília | nada encontrado ou não pesquisado (orçamento de busca da pesquisa esgotado; Querido Diário só nível 1). "Não achou" não prova que não exista |

## Geometria

Os atos não trazem coordenadas. Tudo foi montado sobre o OSM (Overpass, 10/10/2026) e a Malha Municipal do IBGE pelo
script de curadoria `data/raw/municipios/geo/curadoria/mun_interior_sp_geo.py`. Ele roda à mão, uma vez; o resultado é
versionado e o import é determinístico (não consulta o Overpass quando o arquivo existe).

| Arquivo | Como foi montado |
|---|---|
| `3509502_anel_rodoviario.geojson` | região fechada pelas pistas, marginais e alças da SP-065, SP-330 e SP-083, a 25 m do eixo mais interno, recortada pelo limite de Campinas (IBGE; a faixa em Valinhos saiu) |
| `3509502_nova_aparecida.geojson` | limite do IBGE nas divisas com Hortolândia e Sumaré cortado pela R. Batista Raffi, SP-330, Rod. Adalberto Panzan e Rod. Jorn. Francisco Aguirre Proença, a 20 m do eixo |
| `3509502_anel_reboucas.geojson` | região fechada pelas 20 vias do art. 5º (cada uma entre a anterior e a seguinte), a 30 m do eixo; Av. Dr. Ângelo Simões, Av. Júlio Prestes e R. Dona Luísa de Gusmão entraram inteiras (não fecharam entre as transversais; ver `pendencias`) |
| `3524402_fora_rcp.geojson` | limite do IBGE menos corredor de 20 m das RCP, rodovias, alças e ligações; um polígono por pedaço; simplificado a 6 m |
| `3524402_vcpb_vcpt.geojson` | limite do IBGE menos corredor de 20 m só das rodovias estaduais e federais que não são RCP e das alças, rotatórias e conectores sem nome entre elas (as RCP ficam dentro); 14 pedaços; simplificado a 6 m |
| `3551009_arc.geojson` | perímetro do art. 1º percorrido pelas vias do OSM, a 10 m do eixo |
| `3548500_gonzaga.geojson` | quadrilátero das 5 avenidas, a 12 m do eixo |
| `3552205_vias.geojson`, `3551009_vias.geojson`, `3538709_vias.geojson`, `3518701_vias.geojson` | `construir: trechos` pelo importador genérico, com o Overpass restrito aos nomes citados. Guarujá: do acesso ao Assaí (`de: {lonlat}`) até a ponta oeste (`ate_extremo`); os pedaços do mesmo way que o `build_trecho` parte em cada nó são emendados antes do corte de 400 m (`_emendar_mesmo_way`; sem isso, um pedaço de 38 m na esquina da Av. Santos Dumont contava como usado por quem só cruzava a esquina) |

A API ainda recua as zonas 20 m (vias do contorno livres). **Vias ativas em 6 casas decimais**: a API manda as linhas ao
Valhalla com `ST_AsGeoJSON(geom, 6)`, mas o importador valida com a precisão do arquivo. Uma linha da Av. Dom Aguirre
passava na validação e, arredondada, derrubava a rota inteira ("Failed to edge walk line feature"). O script grava as
vias ativas já cortadas em pedaços de até 400 m e em 6 casas (`_seis_casas`), de modo que o importador testa exatamente o
que a API manda. As regras não aplicadas ficam numa feição por via (MultiLineString), o que deixa o seed pequeno.

```bash
# 1) geometria (só para regerar; --refazer apaga e remonta os arquivos de vias)
docker run --rm --network truck-router_default -v $(pwd)/importers:/app -v $(pwd)/data:/data -e DATA_DIR=/data \
  -e VALHALLA_URL=http://valhalla:8002 --entrypoint python truck-router-importer \
  /data/raw/municipios/geo/curadoria/mun_interior_sp_geo.py campinas sao-vicente santos jacarei vias --refazer
# 2) validação offline
docker run --rm -v $(pwd)/importers:/app -v $(pwd)/data:/data -e DATA_DIR=/data \
  --entrypoint python truck-router-importer -m sources.municipios --validar
# 3) import (grava no banco e escreve os seeds); sem MUNICIPIOS_REBUILD, para não perder as 6 casas
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -e VALHALLA_URL=http://valhalla:8002 \
  -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed truck-router-importer \
  municipios:3509502,3552205,3524402,3551009,3518701,3548500,3538709,3525904,3549805,3530300
```

Um `MUNICIPIOS_REBUILD=1` regera os arquivos de vias pelo importador genérico, **sem** o passo das 6 casas: depois dele,
rode o passo 1 (`vias`) antes de importar.

## Licenças

Atos oficiais (resoluções, decretos, leis, Diários e Imprensas Oficiais): domínio público (Lei 9.610/1998, art. 8º, IV).
Notícias e páginas de serviço oficiais (EMDEC, Guarujá, Piracicaba, Jacareí): só o fato, com link. Geometria derivada do
OpenStreetMap: ODbL 1.0 (© colaboradores do OpenStreetMap), mantida em `data_features`, nunca exportada para o OSM.
Limites municipais: IBGE, Malha Municipal (dados públicos, citar a fonte). Cada arquivo registra a licença real em
`fonte.licenca`, que vai para `data_layer_runs` (`GET /api/sources`).

## Testes

`api/test/layers/mun_interior_sp.test.ts` (20 testes; só lê o banco, exceto um feriado de teste em 2030 que ele mesmo
apaga):

- carga: uma fonte por município em `data_layer_runs` com licença; `kind` por status; ato, artigo e URL em toda regra;
  confiança baixa/unverifiable nunca ativa; vias ativas em pedaços de até ~450 m, validadas no Valhalla, em 6 casas;
- regras (módulo da camada): janelas de Campinas, comprimento de 14 m e 6,30 m, e o Anel Rodoviário sem a faixa de
  Valinhos; VUC/VLC de Sorocaba isento só com carga útil informada acima de 1,5 t (sem ela, aplica e avisa a
  capacidade); VCL de Jacareí livre (e alvo com 9 t ou 3 eixos); bitrem, rodotrem e caminhão + reboque na zona dos arts.
  6º e 8º, carreta e toco não; ARC de São Vicente no horário, fora dele, no domingo e no feriado; Ponte Pênsil sempre;
  pedaço de Jacareí com destino deixa de ser excluído; bitrem de passagem por Jacareí perde as RCP urbanas (Malek Assad,
  Industrial, Nilo Máximo) e, com destino na Av. Industrial, o pedaço urbano fica e o aviso cita a AETC; Guarujá só
  penaliza o trecho a oeste do acesso ao Assaí; Nova Aparecida exclui a carreta de passagem e não o caminhão de 12 m;
- avisos: Gonzaga (desativada) só avisa; radar de Piracicaba avisa a carreta e não o toco; Rio Preto, Mirassol e Jundiaí
  nunca excluem, nunca avisam e não aparecem no mapa;
- **rotas reais** (API): Sorocaba — o toco **desvia** da Av. Dom Aguirre e o VLC 6,0 x 2,2 m com 3 t de carga útil passa
  por ela; Jacareí — a carreta entre duas RCP sai pelas rodovias e o VCL corta a cidade; o bitrem de Guararema até a Av.
  Industrial chega e recebe o aviso da AETC; Guarujá — o toco que sai do Assaí para a rodovia não recebe aviso de via
  restrita; Campinas — a carreta saindo do Centro às 7h **passa pelas duas zonas** (origem dentro: não exclui) e recebe
  os avisos com as entradas liberadas e a ACC/ACM.

```bash
cd api && API_URL=http://localhost:3000 npx vitest run test/layers/mun_interior_sp.test.ts
```

## Limitações e pendências

- **Núcleo — 6 casas decimais.** O importador valida as linhas no Valhalla com a precisão do arquivo e a API as manda com
  6 casas: um vértice que se repete ou se desloca no arredondamento faz o Valhalla recusar a rota inteira. Esta frente
  contorna no script de curadoria. Proposta para o núcleo: arredondar para 6 casas e tirar os pontos repetidos em
  `_municipios_lib.py` antes de validar e gravar, e/ou `ST_AsGeoJSON(ST_RemoveRepeatedPoints(ST_SnapToGrid(geom,
  0.000001)), 6)` na camada.
- **Núcleo — tipo de carga no predicado.** Jacareí: produto perigoso só com AETC (Dec. 247/2017, art. 7º); Ribeirão
  Preto: Lei 5.804/1990. Proposta: campo `carga` (do `cargo_type` do veículo) no predicado do alvo.
- **Núcleo — treminhão.** O VCPT de Jacareí (art. 8º, proibido no município) cai em `cvc` ou `truck_trailer`, as mesmas
  classes do VCPB (bitrem, caminhão + reboque, só com AETC): a zona `jacarei_vcpb_vcpt` vale igual para os dois, e o
  aviso diz que o treminhão não tem AETC. Uma classe própria (3 unidades rebocadas) deixaria a diferença na rota.
- **Núcleo — veículo de carga até 3,5 t.** A Res. 079/2017 de Campinas restringe "qualquer veículo de carga" acima de
  6,30 m (Anel Rebouças) e de 14 m (Anel Rodoviário e Nova Aparecida); o núcleo só atinge caminhão (PBT acima de 3,5 t,
  `alvo.caminhao` constante). Um utilitário de carga de até 3,5 t com mais de 6,30 m (furgão de chassi longo, cerca de
  7 m) entra no Anel Rebouças no horário restrito **sem desvio e sem aviso**; nos 14 m, não há utilitário nesse
  tamanho. Proposta: alvo `veiculo_de_carga` sem o piso de 3,5 t (registrado também na `nota` de
  `campinas_anel_reboucas`).
- **Jacareí, horário de restrição** (7h–9h e 17h–19h nas ZRMC e ZREC, art. 2º, V): depende dos Anexos I e II, não
  publicados no PDF. Só aparece no texto da autorização.
- Campinas: as ACC/ACM, a AETC de Jacareí e as autorizações de Sorocaba e de São Vicente não estão no perfil do veículo;
  aparecem só nos avisos.
- Janela avaliada no horário de saída (o `annotate` avisa a passagem estimada), como no resto da camada.
- Zonas de Jacareí entram nas rotas de carreta e de bitrem que passam a até 50 km (ex.: Rio → SP pela Dutra, conferido
  com carreta e com bitrem: rota 200, pela Dutra, sem desvio). As vias desta frente não entram no corredor de 15 km do teste "rota longa (Rio → SP)" do
  `rmsp.test.ts`.
- Piracicaba: a Tv. Prof. Newton de Almeida Mello e a Av. Fioravante Cenedesi não estão no OSM com esses nomes
  (`pendencias` do GeoJSON); o radar da PIR-330 km 0+650 não foi desenhado; a R. São José (entre a R. do Rosário e a
  Pça. José Bonifácio) e a R. Moraes Barros entraram inteiras (o caminho entre as transversais não fechou no OSM).
- Vigilância sugerida pela pesquisa: posts WP da EMDEC, de Jacareí, de Sorocaba e de Piracicaba; SAPL de São Vicente e
  de Campinas; Querido Diário dos municípios de nível 3; pedidos por LAI (SEMUTTRAN Piracicaba, CET-Santos, Guarujá,
  anexos de Jacareí, vias sinalizadas de Sorocaba, SEMOB de SJC, Taubaté, Transerp).
