# Balsas e travessias: regra real da operadora para caminhão

Pesquisa de 09/10/2026 (sexta, véspera do feriado de N. Sra. Aparecida). O escopo é o litoral de SP agora e o Norte e o Nordeste na expansão.
Nada foi alterado no repositório. Todo acesso foi testado com curl, python ou docker (somente leitura). As amostras ficam nesta pasta.

## TL;DR

1. **A regra do litoral de SP existe, é pública e é bem detalhada.** Ela está nas páginas de cada travessia do site da
   Coordenadoria de Travessias/Semil (`semil.sp.gov.br/travessias/travessias-automoveis/<id>/`), em HTML. Cada página traz:
   - eixos permitidos;
   - janelas de horário por dia da semana, feriado e lado de embarque;
   - PBT máximo de 40 t (Ilhabela);
   - restrição por maré (Ilhabela, 3 ou mais eixos com maré abaixo de 0,5 m);
   - regra de perigosos;
   - tarifa por classe/eixo, com valores diferentes para dia útil e fim de semana;
   - lado onde se paga.

   Não existe API nem dataset estruturado dessas regras. É preciso curar e versionar uma tabela (amostra em
   `regras_travessias_sp.sample.json`) e vigiar as páginas por hash.
2. **Há fila e aviso ao vivo, num JSON aberto e não documentado.** O endereço é
   `https://drivetis-travessias.brazilsouth.cloudapp.azure.com:1444/TravessiaService/PT`, usado pelo próprio site.
   Para as 8 travessias, ele traz o tempo de espera em minutos em cada margem, a capacidade em veículos por hora, o
   número de embarcações e um aviso textual. Às 22:27 o aviso de Ilhabela era *"Travessia com maré baixa,
   impossibilitando o transporte de veículos pesados"*. Às 23:17 a espera em São Sebastião tinha caído de 240 para
   180 min. O JSON não tem licença e vai mudar de dono em **09/11/2026**, quando a **AcquaVias SP** (PPP de 20 anos,
   regulada pela ARTESP) assume as 14 linhas.
3. **O Valhalla erra nos dois sentidos, e a razão é a tag OSM, não a regra.**
   - Santos–Guarujá: VUC, toco e truck fazem um desvio de 55 km mesmo de madrugada num dia útil (00–08h), que é
     justamente a janela em que a operadora os aceita.
   - Ilhabela: truck 3 eixos e carreta de 40 t são roteados a qualquer hora, sem olhar janela nem maré.
   - Carreta acima de 40 t recebe "No path" sem explicação.
4. **A maré pesa no ETA de Ilhabela.** Pela tábua do CHM (Marinha) de 2026, que parseei
   (`mare_sao_sebastiao_2026.csv`, 1.537 extremos, 365 dias), a maré fica **abaixo de 0,5 m 32% do tempo**, cerca de
   7,7 h por dia (mínimo 3,3 h, máximo 11 h). O modelo (interpolação cossenoidal) bateu com o aviso ao vivo: 0,53 m às
   22:27 de 09/10 e subindo, e o aviso de "maré baixa" saiu entre 22:27 e 23:17.
5. **No nível nacional:**
   - SNV 202607A (DNIT WFS): 27 segmentos TRV e 153,9 km. São **25 travessias físicas**, porque 2 pares são
     coincidentes BR-174/BR-319 no AM.
   - O SNV está desatualizado: a travessia BR-153 Xambioá (TO/PA) virou ponte em 18/11/2025 e ainda aparece como TRV.
   - ANTAQ: 93 linhas de travessia outorgadas (shape/KML, mai/2025), só com localização.
   - Estudo ANTAQ da Chamada Pública 01/2026 (Manaus–Careiro): fator de equivalência por tipo de veículo, preço de
     carro em 58 linhas e grade horária com **saídas exclusivas para inflamáveis**.
6. **Perigosos.** Há uma regra nacional: NORMAM-202/DPC item 10.9 manda transportar veículo com carga inflamável ou
   explosiva em **viagem exclusiva**, sem passageiros nem outros veículos. Nas balsas de SP:
   - Santos–Guarujá e Bertioga: proibido sempre.
   - Ilhabela, Iguape e Ilha Comprida: viagem exclusiva.
   - Ilhabela: exige também agendamento prévio na Semil.

## 1. Diagnóstico no Valhalla local (confirmação das pistas)

Consultas de leitura em `localhost:8002` (Valhalla 3.9.1). Presets de `config/vehicle-presets.json`. Script em `valhalla_test.py`.

| Caso | Carro | VUC | Truck 3e | Carreta 5e (41,5 t) | Regra real da operadora |
|---|---|---|---|---|---|
| Santos (Ponta da Praia) → Guarujá centro | 6,7 km via balsa | 55,2 km por terra | 55,2 km | 55,2 km | 2 e 3 eixos de "rodagem alta" só seg–sex 00h–08h (fora de feriado); mais de 3 eixos, inflamáveis e carro-forte nunca |
| Bertioga → Perequê (Guarujá) | 18,7 km via balsa | 53,7 km | n/t | n/t | 2 eixos de rodagem alta e 3+ eixos sempre impedidos (OSM `hgv=no` está certo) |
| São Sebastião → Ilhabela | 10 km via balsa | via balsa | via balsa | **No path** | PBT até 40 t; 3 eixos com janelas na sex/sáb/dom/feriado; 4+ eixos com janelas diárias; 3+ eixos proibidos com maré < 0,5 m |
| Bororé (Billings, capital) | 3,4 km via balsa | via balsa | 18,9 km (OSM `maxlength=10`) | 18,9 km | não publicada (EMAE); a confirmar |

Correções e detalhes das pistas:
- **Santos–Guarujá não se explica só por "1 dos 4 trechos com `hgv=discouraged`".** Os 4 berços (ways 48452393,
  199126702, 199126709 e 199126828) são paralelos. O bloqueio vem do conjunto berço + acessos:
  - `hgv=discouraged` no berço 199126828 e na "Via de Desembarque da Balsa" (48452342);
  - `hgv=discouraged` na Av. Adhemar de Barros junto ao terminal (48452408);
  - `hgv=no` no berço "Velho de Santos" (199126708).

  O Valhalla trata `discouraged` como proibido (já documentado em `docs/research/osm_qualidade_valhalla`). Por
  `/locate`, as arestas dos berços 48452393 e 199126709 têm `truck:true`, mas não conectam a rede de caminhão dos dois
  lados. **O overlay tem que normalizar berços e acessos juntos.**
- **O "No path" da carreta para Ilhabela vem do peso e não da balsa.** As avenidas de acesso aos dois terminais têm
  `maxweight=40t`:
  - Av. Antônio Januário do Nascimento (230995683, 594768837, 607133658, 966029241);
  - Av. Princesa Isabel (356877810, 1056389143, 1056389144).

  Com `weight=40` a carreta passa pela balsa, e com 41,5 t não. O resultado coincide com a regra (PBT máximo de 40 t),
  mas a API devolve 409 sem dizer o porquê. Mudar comprimento, altura ou eixos não altera nada.
- `use_ferry` 0 ou 1 não muda nada para o VUC em Santos–Guarujá (testado com `date_time` numa terça às 03:00), porque
  a aresta está proibida e não apenas penalizada.
- O Valhalla já devolve `summary.has_ferry` e as manobras `type 28` (kFerryEnter) e `29` (kFerryExit), com
  `street_names` ("Balsa Santos - Guarujá") e `time`. **A API (`api/src/services/valhalla.ts`) não lê nada disso.**
- A `duration` do OSM não é o tempo de travessia. Santos–Guarujá está com 00:15 no OSM, contra 5 min da operadora.
  Ilhabela está com 00:45, contra 14–18 min da operadora. A balsa custa 28 min no ETA de carro (1.683 s na manobra), e
  quem domina o tempo é a fila, não a travessia.
- **OSM do Sudeste** (`osm_ferry_sudeste.geojson`, extraído com pyosmium do `data/valhalla/sudeste-latest.osm.pbf`):
  - 228 ways `route=ferry` (confirmado);
  - `hgv` em 7 ways (6 `no`, 1 `discouraged`);
  - `maxweight` em 1 (balsa municipal de Laranjal Paulista, 3 t);
  - `maxlength` em 1 (Bororé, 10 m);
  - `maxaxles` em 1;
  - `hgv:conditional` em nenhuma;
  - nenhuma balsa do litoral com peso, comprimento ou horário de caminhão.

  O subconjunto operado por DH ou EMAE está em `osm_ferry_sp_operadas.geojson` (14 ways).

## 2. Fontes testadas

### 2.1 Litoral de SP: regra da operadora

| Fonte | URL | Teste | Conteúdo útil | Licença / uso comercial |
|---|---|---|---|---|
| Páginas das 6 travessias de veículos (Coordenadoria de Travessias/Semil) | `https://semil.sp.gov.br/travessias/travessias-automoveis/{santos-guaruja,sao-sebastiao-ilhabela,bertioga-guaruja,iguape-jureia,cananeia-continente,cananeia-ilha-comprida}/` | HTTP 200, 71–103 KB de HTML (WordPress), salvos em `raw/` | Tarifas por classe (Res. SLT-STM 001/2018), proibições por eixo e carga, janelas e lado da cobrança. Em Ilhabela: tabela da Res. SEMIL 79/2023 e imagem de pesos por configuração (`raw/peso-Maximo-SS-IB-OUT2023.png`) | Sem licença declarada. São atos normativos e tarifas públicas, e o texto de ato oficial não tem proteção autoral (Lei 9.610/98, art. 8º, IV). Uso comercial do **fato** com atribuição: OK. Não reproduzir layout ou imagens |
| Home das travessias | `https://semil.sp.gov.br/travessias/` | 200, 108 KB | Distância, tempo de travessia, horário de funcionamento e endereços dos terminais das 8 travessias | idem |
| **TravessiaService (JSON ao vivo)** | `https://drivetis-travessias.brazilsouth.cloudapp.azure.com:1444/TravessiaService/PT` (descoberto em `wp-content/themes/travessias/assets/travessia-service-prd.js`) | 200, 8,9 KB, `application/json`, sem autenticação, IIS/ASP.NET. Atualiza (amostras às 22:27 e 23:17). `/EN` dá 404 | Por travessia (Id 1950–1957): `EsperaPontoA/B` (min), `CapVeiculo` (veíc./h), `NumEmbarca`, `EmbarcaAtivo`, `AvisoUsuario`/`AvisoUsuarioApp` (ex.: maré baixa impede pesados), `ClimaA/B` e `DataConsulta` (hora local) | **Sem licença nem termos.** Endpoint de contratada (DriveTIS) e não documentado. O próprio JS diz "atualizar os dados e caminhos quando parar de funcionar". Uso comercial ambíguo: usar com cache (≥ 2 min), atribuição e pedido formal de acesso à Semil, ARTESP ou AcquaVias. Risco alto de quebra em 09/11/2026 |
| Agendamento de perigosos e resíduos (Ilhabela) | `https://semil.sp.gov.br/consema/agendamento-veiculos-cargas-perigosas-e-residuos/` | 200 (formulário com Cloudflare Turnstile; não submetido) | Confirma a regra da maré (< 0,5 m bloqueia carretas e trucados de 3+ eixos) e o agendamento gratuito. **Divergência:** antecedência mínima de "2 horas" aqui contra "48 horas" na página da travessia | idem |
| Tábua de marés do CHM, Porto de São Sebastião 2026 | `https://www.marinha.mil.br/chm/sites/www.marinha.mil.br.chm/files/dados_de_mare/45%20-%20PORTO%20DE%20S%C3%83O%20SEBASTI%C3%83O%20-%20145%20-%20147.pdf` (link da própria Semil) | 200, 58 KB, 3 páginas. Parser `parse_mare_chm.py` (`pdftotext -bbox`): 365 dias, 1.537 extremos, horas em ordem e 1º/jan conferido | Preamar e baixa-mar (UTC−3, altura em m); nível médio 0,64 m | Publicação da Marinha. O PDF é gratuito no site, mas a versão impressa é vendida pela EMGEPRON. Sem licença explícita. Usar como dado factual com citação e confirmar com o CHM antes de uso comercial |
| Notícias oficiais da concessão | ARTESP (`artesp.sp.gov.br/.../governo+de+sp+assina+contrato+da+ppp+de+travessias+hidricas`) e metrocptm (07/10/2026) | 200 | Contrato assinado em 15/05/2026 com a AcquaVias SP Travessias SPE S.A. (grupo Internacional Marítima). Desconto de 12,6% no leilão de 13/11/2025. **Fase de operação a partir de 09/11/2026** (deliberação ARTESP). Tarifa-base mantida. 14 linhas: as 8 litorâneas, mais João Basso, Bororé e Taquacetuba (Billings) e Varginha, Paraitinga e Natividade (Paraibuna) | notícias |
| Histórico do órgão | `https://semil.sp.gov.br/travessias/conheca-o-departamento-hidroviario/` | 200 | DERSA (1989–2020) → DH (20/10/2020) → Semil (2023) → Coordenadoria de Travessias/Semil (desde 01/04/2024) | n/a |

**Regras transcritas** (09/10/2026; detalhe em `regras_travessias_sp.sample.json`):
- **Santos–Guarujá** (450 m, 5 min, 24 h). Paga-se só no embarque no Guarujá, e a tarifa vale ida e volta.
  - Caminhão 2 eixos: R$ 43,30. Caminhão 3 eixos: R$ 98,60, sem diferença entre dia útil e fim de semana.
  - 2 e 3 eixos "de rodagem alta" só seg–sex das 00h00 às 08h00, vedados em fim de semana e feriado.
  - Mais de 3 eixos, carro-forte e cargas inflamáveis ou explosivas: nunca.
  - Ônibus: nunca, salvo autorização.
- **São Sebastião–Ilhabela** (2,4 km, 14–18 min, 24 h). Paga-se só no embarque em São Sebastião.
  - Tarifas: 2e R$ 66,30 / 99,40 (útil / fim de semana); 3e R$ 151,50 / 227,30; reboque ou semirreboque
    R$ 189,50 / 284,20; inflamáveis R$ 208,00 / 312,00.
  - **PBT acima de 40 t: proibido.** 3+ eixos com maré abaixo de 0,5 m: proibido.
  - Perigosos e resíduos carregados: agendamento prévio e viagem exclusiva.
  - Desconto de 20% entre 0h e 6h, exceto VUC e toco.
  - Janelas restritas (Res. SEMIL 79/2023, vigente desde 16/10/2023):
    - 3 eixos, embarque em São Sebastião: sex 10–24h, sáb 8–16h, dom 8–14h, véspera de feriado 11–24h, 1º dia de
      feriado prolongado 8–16h. Embarque em Ilhabela: sex 14–24h, sáb 16–24h, dom 10–24h, último dia de feriado 6–24h,
      1º dia útil depois 6–15h.
    - 4+ eixos, embarque em São Sebastião: seg–qui 6–20h, sex 6–24h, sáb e dom 6–20h, véspera 6–24h, 1º dia 6–20h.
      Embarque em Ilhabela: seg–qui 6–20h, sex, sáb, dom e último dia de feriado 6–24h, 1º dia útil depois 6–20h.
  - VUC e toco de 2 eixos estão isentos das janelas.
  - Serviços essenciais estão isentos das janelas. A lista inclui "gêneros alimentícios perecíveis e não perecíveis",
    o que na prática alcança muita carga.
- **Bertioga–Guarujá** (550 m, 6 min). Cobra-se nos dois sentidos.
  - Caminhão 2 eixos: R$ 21,65 / 32,45.
  - 2 eixos de rodagem alta, 3+ eixos, lixo, carro-forte e inflamáveis: sempre impedidos.
- **Cananéia–Continente** (1,1 km, 6–24h): caminhões e ônibus sempre impedidos.
- **Cananéia–Ilha Comprida e Iguape–Juréia** (cobradas só em Cananéia e só na Juréia, respectivamente):
  - Caminhões aceitos.
  - 3 eixos, reboque ou semirreboque e carro-forte: impedidos em sábado, domingo e feriado.
  - Inflamáveis: viagem exclusiva.
  - Tarifas: 2e R$ 43,30 / 64,90; 3e R$ 98,60; reboque R$ 123,40.
- Ambiguidade: **"rodagem alta (veículos pesados, de suspensão alta)"** não tem definição. A página de Bertioga lista
  tarifa para "caminhão 2 eixos" e ao mesmo tempo veta o de rodagem alta. Proposta: tratar VUC e toco como rodagem alta
  (conservador), avisar e confirmar pelo 0800-77-33-711.

### 2.2 Nacional e expansão (Norte e Nordeste)

| Fonte | URL | Teste | Conteúdo | Licença |
|---|---|---|---|---|
| **SNV 202607A, DNITGeo WFS** `vgeo:vw_snv_rod` com `Superficie_Federal='TRV'` | `https://servicos.dnit.gov.br/dnitgeo/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=vgeo:vw_snv_rod&outputFormat=application/json&CQL_FILTER=Superficie_Federal='TRV'` (usar `--data-urlencode`) | 200, 1,38 MB, 1.360 feições de todas as versões (`Versao_SNV`). Filtrado para 202607A: **27 segmentos, 153,9 km**: AM 9, PA 6, BA 3, RS 3, TO 2, MG 2, SC 1, AC 1 (`snv_trv_202607A.geojson`) | BR, UF, código SNV, km, extensão e "INÍCIO/FIM TRAVESSIA RIO X". Não traz operador, regra nem horário. Coincidências: 174BAM0490 = 319BAM0030 (Careiro, 12 km) e 174BAM0405 = 319BAM0115 (Igapó-Açu, 0,4 km), o que dá 25 travessias físicas e cerca de 141,5 km. **Defasado:** 153BTO0077 (Araguaia, Xambioá) virou ponte em 18/11/2025 | DNIT, sem licença explícita no WFS (`Fees=NONE`, `AccessConstraints=NONE`; o portal gov.br usa CC BY-ND 3.0). Mesma postura do importador `snv_dnit.py` |
| **ANTAQ: linhas de travessia outorgadas** (mai/2025) | `https://www.gov.br/antaq/pt-br/central-de-conteudos/Linhasdetravessias06052025.zip` (página `.../central-de-conteudos/informacoes-geograficas`) | 200, 47 KB: SHP (linhas), KML, XLSX e DBF. **93 linhas** (`antaq_linhas_travessia.json`): 79 nacionais e 14 internacionais (AR, PY, BO). 31 sem coordenada | Nome, municípios, IBGE, UF, rio, coordenadas de origem e destino. 9 citam "Diretriz BR-xxx", que casam com o SNV. Sem tarifa, horário nem restrição. Inclui SP: Santa Albertina–Carneirinho (MG), Riolândia–S. Francisco de Sales (MG), Florínia–Santa Mariana (PR) e Cândido Mota–Itambaracá (PR) | gov.br; sem licença no zip. A página "dados abertos" da ANTAQ não lista este arquivo. Uso factual com atribuição |
| **ANTAQ: Chamada Pública 01/2026, estudo referencial Manaus–Careiro (BR-319)** | `https://www.gov.br/antaq/pt-br/assuntos/chamamentos/chamada-publica-ndeg-01-2026/anexo-1-estudo-referencial-para-selecao-de-empresas-travessia-manaus-careiro-da-varzea.pdf/@@download/file` | 200, 4,3 MB, 73 p. | (a) **Fator de Equivalência Espacial** por tipo de veículo, com auto = 1 (`fee_antaq.csv`): toco carregado 3,85; truck 4,60; carreta 5,55; bitrem 9,85; rodotrem 12,30. Serve para estimar a tarifa de caminhão onde só há preço de carro. (b) **Preço de carro em 58 linhas** (atualizado em 06/06/2024, `antaq_preco_auto_58_linhas_2024.csv`). Ex.: Manaus–Careiro R$ 47,25 em 12 km; Itaituba–Miritituba R$ 25,00. (c) Grade da Res. 5.573-ANTAQ/2017: 15 saídas por sentido para veículos comuns e **3 por sentido exclusivas para inflamáveis** (Manaus→Careiro 6:30, 12h e 16:30; volta 9:30, 14h e 18:30). Só 1 saída noturna (4h). Na navegação de travessia autorizada **o preço é livre** (Lei 10.233/2001, art. 43) | documento público de licitação |
| **NORMAM-202/DPC** (Marinha, navegação interior) | `https://assets.marinha.mil.br/sites/default/files/atos-normativos/dpc/normam/normam-202.pdf` | 200, 9 MB, 662 p. (mod. 05/01/2026) | Cap. 10, Seção II "Navegação de travessia". **10.9: veículo com carga inflamável ou explosiva só em viagem exclusiva**, sem passageiros nem outros veículos. 10.7: veículos calçados e motor desligado. 10.11: capacidade pelo peso máximo autorizado | ato normativo (art. 8º, IV, Lei 9.610/98) |
| **Bahia: ferry Salvador–Itaparica** (BR-420 no SNV, 14,3 km), AGERBA e Internacional Travessias Salvador | Tarifas: `https://www.internacionaltravessias.com.br/tarifas/`. Res. 16/2026: `https://www.ba.gov.br/agerba/sites/site-agerba/files/2026-04/Res162026.pdf` | 200 nas duas | Tarifas pela Res. AGERBA 11/2026: caminhão simples R$ 196,00 / 275,20; trucado R$ 264,40 / 372,30; jamanta R$ 383,10 / 539,50. **Res. AGERBA 16/2026 suspende ônibus, jamanta, caminhão simples e trucado (e utilitário com 1,5 t ou mais) nos feriados de 2026**, por sentido e janela. Hoje: ida de 09/10 05h até 10/10 15h e volta de 12/10 05h até 14/10 05h. Exceção para alimentos e perecíveis | ato normativo (PDF); tarifas são fato público |
| **Maranhão: ferry Ponta da Espera–Cujupe** (cerca de 20 km, ~1 h), Internacional Marítima e MOB | `https://internacionalmaritima.com.br/ferryboat/` | 200 | 5 saídas por dia em cada sentido (São Luís 07, 08, 13, 14 e 20h; Cujupe 09:30, 10:30, 15:30, 16:30 e 22:30), só desta operadora (há outra, Servi-Porto). Tarifa por tipo e por carregado ou vazio: carreta R$ 660 / 820, bitrem R$ 865 / 1.100, toco R$ 240 / 315. Hora Marcada com sobretaxa | site comercial; fato público. Os PDFs da Portaria MOB 510 e do horário estão em 404 |
| **Pará: ARTRAN-PA** (sucedeu a ARCON no transporte hidroviário intermunicipal, lei de dez/2023) | notícias (agenciapara e oliberal) | Sem portal de dados | Icoaraci/Comara–Camará (Marajó): várias operadoras privadas e horários em notícias. Desde 2019 os pesados embarcam no Porto do Comara | n/a |
| **EMAE: balsas da Billings** (Bororé, Taquacetuba e João Basso, **Grande SP**) | `https://emae.com.br/balsas/` | 200, sem regra de veículo | 24 h, 3 embarcações, nova balsa de 32 veículos. Nenhuma regra de caminhão publicada. O OSM tem `maxlength=10` só no Bororé. Entram na PPP AcquaVias em 09/11/2026 | n/a |
| Túnel Santos–Guarujá (PPP) | `https://www.parceriaseminvestimentos.sp.gov.br/.../tunel-imerso-santos-guaruja` | 200 | Mota-Engil com CCCC, contrato assinado em 28/01/2026, 30 anos. 2026 é dedicado a projetos; obra a partir de 2027; **operação prevista para 2031**. Admite caminhões. A regra de perigosos no túnel não foi publicada | n/a |

**Cruzamento SNV TRV × OSM** (Overpass kumi, base de 15/07/2026, raio de cerca de 2 km; `snv_trv_vs_osm.json`):
- 21 dos 27 segmentos têm ferry no OSM.
- Os 6 sem ferry:
  - BR-030/BA (rio Gavião);
  - BR-010/TO (rio Perdida);
  - BR-153/TO (Xambioá, que já é ponte);
  - BR-158/PA (Xingu, 2,5 km);
  - BR-235/PA (Xingu, 1,2 km);
  - BR-251/MG (São Francisco).

  Nesses pontos o Valhalla não atravessa o rio. O resultado é 409 ou desvio, mesmo que a balsa exista.
- Onde há ferry, as tags são quase só `motor_vehicle=yes`, o que deixa VUC e carreta igualmente liberados.
- 6 têm `opening_hours`, que o Valhalla ignora. Exemplos: Igapó-Açu na BR-319 (06–22, Amazônia Navegações); Sucunduri
  e Aripuanã na BR-230 (06–21).
- Taquari na BR-470/RS tem `maxweight=30`.
- Itapiranga/SC tem `maxweight=187.13`, valor sem sentido.

## 3. Como integrar (camadas, ver `docs/LAYERS.md`)

O problema tem duas metades. (a) O grafo **proíbe** onde a operadora permite, porque o Valhalla trata `discouraged`
como `no` e uma camada não "desbloqueia" uma aresta `truck:false`. (b) O grafo **permite** sem olhar janela, maré,
PBT e eixo. Proposta em 4 peças:

**A. Overlay no PBF antes do `valhalla_build_tiles`** (no pipeline do pré-processador já proposto em `osm_qualidade_valhalla`):
- para as balsas com regra curada, deixar o grafo permissivo:
  - nos berços e nos acessos listados em `regras_travessias_sp.sample.json` (`osm_ferry_ways` e `osm_approach_ways_hgv`),
    trocar `hgv=discouraged|no` por `hgv=yes`;
  - copiar o `maxweight=40` para o próprio way da balsa de Ilhabela;
  - gravar a `duration` da operadora.
- A regra fica toda na camada. Daria para usar `hgv:conditional` e `maxaxles` no PBF, já que o Valhalla lê condicional
  com um único `@` quando a requisição traz `date_time`. Mas isso não expressa feriado, maré, lado de embarque, PBT nem
  "rodagem alta", e não deve ser a fonte da regra.
- Validar com a bateria de testes abaixo, já que só se sabe depois de recompilar os tiles.

**B. Importadores** (`importers/sources/`):
1. `travessias_sp.py` (`LAYER_ID='travessias'`, `SOURCE='semil-travessias'`):
   - baixa as 6 páginas e extrai as tabelas de tarifa (HTML simples) e o hash do bloco de regras;
   - junta com a tabela curada versionada no repositório (JSON com as janelas da Res. SEMIL 79/2023 etc.);
   - geometria: linha da balsa pelos IDs de way do OSM (ODbL; manter separado em props, como em `hazmat_trechos_der`);
   - se o hash mudar, a carga falha com alerta para revisão humana;
   - a partir de 09/11/2026, trocar a fonte para AcquaVias/ARTESP.
2. `mare_chm.py` (`LAYER_ID='travessias'`, `SOURCE='chm-mare'`):
   - roda o PDF anual por porto (`parse_mare_chm.py`, sem dependência nova além de poppler, ou trocar por pdfplumber);
   - grava os extremos como feições `kind='mare_extremo'` (data, hora e altura), com o ponto do marégrafo;
   - começar por São Sebastião. Na expansão: Santos, Belém, São Luís (Itaqui) e Salvador, onde a maré afeta rampa.
3. `travessias_brasil.py` (`SOURCE='snv-dnit+antaq'`):
   - SNV TRV de todas as UFs, reaproveitando `snv_dnit.py` com `TRV` em vez de descartar;
   - mais as 93 linhas ANTAQ;
   - mais a tabela de preço de carro e o FEE;
   - marca cada travessia com `regra_curada: bool`;
   - cruza com o OSM (ferry way a até 2 km) para achar balsas que o grafo não conhece;
   - a ponte de Xambioá mostra por que é preciso conferir.
4. `travessias_feriados_ba.py` (opcional):
   - transcreve as resoluções AGERBA de suspensão por feriado em janelas `(sentido, início, fim)`;
   - padrão semelhante ao de `prf_feriados.py`.

**C. Serviço ao vivo** `api/src/services/travessiasLive.ts`:
- GET no TravessiaService com cache de 2 a 5 min e timeout curto;
- em caso de falha, a camada segue sem dado ao vivo;
- devolve espera por margem, aviso e número de embarcações;
- opcional: um poller (cron do importer a cada 10 min) grava o histórico para aprender a espera típica por travessia,
  dia da semana e hora, porque a Semil não publica série histórica.

**D. Camada** `api/src/layers/travessias.layer.ts` (grupo `restricoes`; tarifa em `custos`):
- `exclusions(ctx)`: proibição absoluta para o veículo vira um polígono fino **na água** em volta do meio da linha da
  balsa, sem tocar rua. Casos:
  - Santos–Guarujá com 4+ eixos, perigoso ou ônibus;
  - Bertioga com caminhão de rodagem alta;
  - Cananéia–Continente com qualquer caminhão;
  - Ilhabela com PBT acima de 40 t.

  Quando não sobra rota (ilha), o 409 tem que dizer o motivo, por exemplo "Ilhabela: PBT acima de 40 t não embarca
  (Res. SEMIL 79/2023)". Hoje o 409 é mudo.
- `costLines(ctx)`: proibição por janela (Ilhabela, Santos–Guarujá fora de 00–08h em dia útil, fim de semana em
  Iguape e Ilha Comprida) e por maré vira `factor: 1000` na linha da balsa. Se houver alternativa, o Valhalla desvia; se
  não houver, usa a balsa e a camada calcula a espera.
- **O horário avaliado é o da chegada à balsa, não o da partida.** Para isso a API precisa expor as balsas da rota. A
  proposta é estender `RouteGeom` com
  `ferries: [{name, enter_s, exit_s, lat, lon}]`, lido das manobras `type 28/29` e de `summary.has_ferry`. Fluxo:
  1. 1ª rota;
  2. avaliar a regra no instante de chegada;
  3. se a regra muda o resultado, 2ª rota com a balsa penalizada ou excluída.
- `annotate(ctx, route)`. Avisos com severidade:
  - `travessia_fora_da_janela` (próxima janela, por exemplo "embarque em São Sebastião liberado às 16h");
  - `mare_baixa` (próximo horário com maré ≥ 0,5 m, calculado pela tábua);
  - `perigosos_viagem_exclusiva`;
  - `agendamento_obrigatorio` (link da Semil);
  - `aviso_operadora` (texto ao vivo);
  - `rodagem_alta_ambigua`.

  Linhas de resumo:
  - "Balsa São Sebastião→Ilhabela: espera ~180 min (ao vivo 23:17), travessia 14–18 min";
  - "Tarifa R$ 151,50 (3 eixos, dia útil), paga no embarque em São Sebastião e vale a volta".

  O ETA soma espera, janela e maré. Em `data` vão as balsas, as tarifas e as esperas, que alimentam o plano de jornada.
- `features(bbox)`: linhas das balsas coloridas pela espera ao vivo, com popup de regra e tarifa. Nas travessias sem
  regra curada (Norte e Nordeste, via SNV e ANTAQ), aviso `info`: "travessia por balsa; horário e tarifa não verificados".
- Pedágio: `tollCost.ts` não cobre balsa. A tarifa de balsa entra no total de custos da rota.
  - Tarifa de ida e volta cobrada só num lado: atribuir ao sentido em que se paga.
  - Na expansão, onde não há tabela: estimativa pelo preço de carro da ANTAQ × FEE, marcada como "estimada".

**Testes** em `api/test/layers/travessias.test.ts`:
- VUC Santos→Guarujá numa terça às 03:00 usa a balsa (exige o overlay); às 10:00, desvia;
- carreta sempre desvia;
- truck 3e embarcando em São Sebastião na sexta às 12:00 recebe aviso ou espera até 24h;
- truck 3e em 10/10/2026 às 08:00 (maré 0,07 m) espera até a maré passar de 0,5 m;
- carreta de 45 t para Ilhabela dá 409 com motivo;
- perigoso em Santos–Guarujá é excluído;
- truck de 12 m no Bororé segue o `maxlength`;
- Salvador–Itaparica em 12/10/2026 dá aviso de suspensão AGERBA.

## 4. Fontes que falharam

- `gov.br/antaq/.../noticias/2021/disponibilizada-a-atualizacao-dos-arquivos-das-linhas-de-travessia...`: pede login
  (redireciona para `require_login`). O arquivo atual está em "informacoes-geograficas".
- DNIT "condições das rodovias" (`servicos.dnit.gov.br/condicoes/condicoesdrf.asp?BR=319...`): 404, serviço descontinuado.
- Internacional Marítima: `.../uploads/2023/08/portaria_510_12_2023.pdf` e `.../2024/02/Horario_travessias.pdf`: 404.
- Overpass `overpass-api.de` e `maps.mail.ru`: 504; `overpass.private.coffee`: 500. O `overpass.kumi.systems` funcionou
  (base de 15/07/2026), mas com limite de taxa: consultas por caixa falharam em série e a consulta única (união das
  27 caixas) deu 500 quatro vezes antes de responder.
- TravessiaService `/EN`: 404 (só `/PT` responde).
- Semil/DH: não há dados abertos de movimento, fila ou caminhões por travessia (só números em notícias, por exemplo
  Carnaval 2025: caminhões +101% em Santos–Guarujá e +34% em Ilhabela).
- ANTT Res. 5.998/2022 (perigosos rodoviários): não encontrei artigo específico sobre balsa. A regra aplicável é a
  NORMAM-202. Não li o texto integral da resolução.

## 5. Lacunas

- Definição operacional de **"rodagem alta"** (VUC e toco entram ou não?). Divergência de antecedência no agendamento
  de perigosos em Ilhabela (48 h ou 2 h).
- **Regras da AcquaVias a partir de 09/11/2026**: o contrato mantém a tarifa-base, mas o regulamento operacional e o
  endpoint ao vivo podem mudar. Buscar o contrato e os anexos no site da ARTESP ou da SPI.
- Balsas da Billings (Grande SP) e do Paraibuna: nenhuma regra de caminhão publicada (só o `maxlength=10` do Bororé no OSM).
- Norte: não há regra centralizada. As linhas ANTAQ têm preço livre, e as estaduais (ARTRAN-PA, ARSEPAM-AM, MOB-MA,
  AGERBA-BA) publicam em PDF, site da operadora ou notícia. Dimensão e peso máximos por embarcação não aparecem em
  nenhuma fonte; a NORMAM remete à capacidade da embarcação.
- Fila: só a do litoral de SP tem dado ao vivo. No Norte (ex.: BR-319 Igapó-Açu, filas de dias em 2024) só há notícia.
- Licença formal do TravessiaService e da tábua do CHM para uso comercial: pedir por escrito.
- O cruzamento SNV × OSM usou caixa de cerca de 2 km em volta do segmento. Um ferry vizinho pode ter sido casado
  errado: em BR-163/PA aparecem "Santarém–Alenquer" e "Manaus–Santarém". Falta conferir um por um, e falta incluir as
  linhas estaduais e as da ANTAQ fora de BR.

## 6. Arquivos nesta pasta

- `NOTES.md`: este arquivo.
- `regras_travessias_sp.sample.json`: tabela curada (amostra) das 6 travessias de veículos de SP.
- `snv_trv.geojson` (todas as versões) e `snv_trv_202607A.geojson` (27 segmentos).
- `antaq_linhas_travessia.json` (93 linhas), `antaq_preco_auto_58_linhas_2024.csv`, `fee_antaq.csv`.
- `mare_sao_sebastiao_2026.csv` e `parse_mare_chm.py`.
- `osm_ferry_sudeste.geojson` (228 ways), `osm_ferry_sp_operadas.geojson`, `osm_ferries.py`, `osm_bbox_tags.py`.
- `valhalla_test.py`.
- `snv_trv_vs_osm.json`: cruzamento parcial com Overpass.
- `raw/`:
  - HTML das páginas da Semil e o JS `travessia-service-prd.js`;
  - 2 amostras do JSON ao vivo (`travessiaservice_PT*.json`);
  - PDF da tábua do CHM;
  - imagem de pesos de Ilhabela;
  - NORMAM-202 (PDF e txt);
  - estudo ANTAQ Manaus–Careiro (PDF e txt);
  - zip ANTAQ;
  - Res. AGERBA 16/2026;
  - páginas da Internacional Marítima, ITS e EMAE.
