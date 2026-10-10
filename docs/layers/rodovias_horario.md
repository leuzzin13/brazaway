# Camada `rodovias_horario`: restrições de horário em rodovias

Cobre três regras com horário, todas citadas pela norma e pelo artigo. Os textos foram conferidos na fonte primária em 09/10/2026.

| # | Regra | Norma (fonte primária) | Quem é afetado | Onde | Quando |
|---|-------|------------------------|----------------|------|--------|
| 1 | Feriados da PRF | **Portaria DIOP/PRF nº 121, de 08/09/2026**, DOU de 09/09/2026, ed. 170-A, Seção 1 Extra A, p. 1. Art. 1º (I a IV, §§ 1º a 4º) e Anexo I. Em vigor desde a publicação (art. 6º). Revoga a nº 26/2026 (art. 5º) | Veículo com largura > 2,60 m, altura > 4,40 m, comprimento > 19,80 m ou PBTC > 58,5 t (art. 1º). Também CVC/CTV/CTVP **com AET/AE** (§ 1º), mesmo dentro desses limites | Trechos de **pista simples** de rodovia federal (§ 2º). Não vale em AC, AM, AP, PA e RR. MS e RO só na Operação Fim de Ano (§§ 3º e 4º) | As 30 janelas nacionais do Anexo I (véspera 16h–22h, 1º dia 06h–12h, último dia 16h–22h; Eleições 07h–18h). Mais 3 janelas dos Festejos Juninos (só BA/PB/PE/RN) |
| 1b | Operação N. Sra. Aparecida (SP) | Mesma portaria: art. 1º, § 5º, e tabela "Restrição aplicável apenas ao Estado de São Paulo" | **Só quem tem AET/AE** (nota da tabela). Nas datas "Acima de 3,20 m de largura", só quem passa dessa largura | BR-116 km 0–195 e 196–231, BR-459 km 0–32 e BR-488 km 0–5, **inclusive em pista dupla** | Por data: 02 a 08/10 e 05 a 08/10 (largura > 3,20 m); 09 a 12/10 (todas as restrições do art. 1º); BR-488 de 02 a 12/10 (todas as restrições do art. 1º) |
| 1c | Trecho especial de MS | Mesma portaria, tabela de MS | Restrições do art. 1º | BR-262/MS km 233–328 | 09/04 das 12h às 22h (horário na própria tabela). Importado, mas fora dos tiles do Sudeste |
| 2 | Serra da Anchieta | **Portaria SUP/DER-084-01/11/2023**, DOE-SP de 07/11/2023, Executivo, p. 147. Art. 3º, §§ 1º, 2º e 5º, e art. 4º. Em vigor 15 dias após a publicação (art. 8º) | CVC com AET (PBTC até 74 t, comprimento até 30 m). Veículo simples com AET não entra ("A CVC ... portadores de AET") | SP-150, km 40–55, pistas sul e norte | Circulação permitida **só** seg 01h–05h, seg 23h → ter 05h, ter 23h → qua 05h, qua 23h → qui 05h e qui 23h → sex 05h (§ 1º). Chegada ao sistema Anchieta-Imigrantes a partir das 22h (§ 2º). Nada disso vale nos feriados prolongados (§ 5º, ver Decisões) |
| 3 | Descida da Imigrantes | Portaria ARTESP 11/2002, citada no FAQ da Ecovias. O link original está quebrado | Caminhões | SP-160, pista sul, serra | Sempre |

## Como entra na rota

1. **Vale no horário de saída e o veículo é afetado.**
   - A camada calcula a rota livre.
   - Recorta dela os pedaços que passam pelos trechos restritos.
   - Penaliza esses pedaços com `costLines` (fator 1000, "proibido salvo sem alternativa"; variável `RODOVIAS_HORARIO_FATOR`).
   - Refaz a rota enquanto ela cair em outro trecho restrito, até 6 rotas (exemplo: BR-459 → BR-383 → BR-354). A 6ª rodada penaliza sem refazer; o que sobrar na rota final sai como "desvio não testado" (abaixo).
   - "Trecho novo" é trecho do SNV **+ sentido**. O fator do `linear_cost_factors` só vale no sentido da linha penalizada; sem isso, um desvio que entra no mesmo trecho pela outra ponta (ou pela outra pista) não paga nada. Exemplo real: Taubaté → BR-488 km 3 em 10/10, com a BR-488 penalizada no sentido da ida, a rota seguinte chegava à Basílica pelo outro lado e usava a BR-488 no sentido contrário de graça. Agora esse sentido também é penalizado na rodada seguinte. O sentido sai da posição, ao longo do trecho do SNV (digitalizado no sentido do km), do primeiro e do último ponto da rota no trecho.
   - Gera os avisos:
     - `prf_feriado_desvio` (danger): a rota evitou o trecho. O aviso diz quando a passagem é liberada.
     - `prf_feriado_na_rota` (danger): a rota final ainda passa por trecho restrito e o `routing.ts` **não** avisou. Dois casos, com textos diferentes: "sem alternativa razoável" (o trecho foi penalizado no sentido em que a rota passa e mesmo assim ficou) e "trecho restrito cujo desvio não foi testado" (o trecho nunca foi penalizado nesse sentido, porque a rota final mudou por zonas, reportes ou outras camadas que a rota livre da camada não vê, ou porque passou do limite de rodadas).
     - `prf_feriado_sem_alternativa` (info): o trecho penalizado ficou na rota e o `routing.ts` já emitiu `uses_restricted_way` (danger) para ele. A camada não repete o danger; só complementa com a regra, a norma e o "espere até…". O critério é cópia do `usesCostLine` do `routing.ts`, que é sensível ao sentido: ≥ 50% das amostras da linha a até 15 m da rota e, dessas, ≥ 50% com rumo a menos de 90° do rumo da rota, com a rota livre calculada. Se o `routing.ts` mudar o critério, mude `usesCostLineLikeRouting` na camada também.
     - `anchieta_cvc_aet_desvio` / `anchieta_cvc_aet_na_rota` (danger) e `anchieta_cvc_aet_sem_alternativa` (info, mesma regra de não duplicar): o aviso traz a **próxima janela permitida**.
   - O fim do bloqueio encadeia janelas que se encostam. Exemplo: em 06/10 a regra de largura > 3,20 m termina em 08/10, mas a de 09 a 12/10 também pega o veículo, então o aviso diz "liberado a partir de ter 13/10 00:00".
2. **Não vale na saída, mas há janela que afeta o veículo nas próximas 24 h e a rota usa o trecho.**
   - Aviso `info` (`prf_feriado_proximo`).
   - Vira `warn` (`prf_feriado_eta`) quando a passagem estimada pelo trecho cai dentro da janela. A estimativa é a fração da distância × a duração da rota.
3. **Anchieta com a janela aberta:**
   - `info` (`anchieta_cvc_aet_janela`) mostra até quando a janela vai;
   - `warn` (`anchieta_cvc_aet_eta`) se a chegada estimada à serra passar do fim da janela;
   - `info` (`anchieta_faixa_esquerda`) para qualquer CVC com chegada estimada entre 18h e 20h (art. 4º). CVC = semirreboque, reboque ou CVC (`vehicle_class`); sem classe, comprimento > 14 m.
4. **Imigrantes:** já está no OSM. Há `hgv=no` em 24 ways da SP-160 pista sul (a maioria também com `hazmat=no`). O Valhalla local manda o caminhão de SP para Santos pela Interligação e pela Anchieta. O teste `descida da Imigrantes` garante isso, ficando a mais de 1 km do marco km 45 da SP-160 e a menos de 150 m do km 45 da SP-150. A camada não duplica essa regra.

**Por que recortar a própria rota em vez de mandar a geometria do SNV.** O Valhalla aplica `linear_cost_factors` por *edge walk*:

- A linha precisa seguir as arestas do grafo. Mandar a geometria do DNIT dá erro 233 ("Failed to edge walk line feature"), e esse erro derruba a rota inteira.
- O fator vale **só no sentido percorrido**.

Os vértices da própria rota do Valhalla satisfazem as duas condições. O casamento rota × trecho usa tolerância de 30 m, com sequências de pelo menos 300 m. Na BR-459, a distância SNV × OSM tem mediana de 3 m, p90 de 7 m e máximo de 39 m. Na Anchieta, a serra não tem saída no meio: as sequências a menos de 3 km de distância são unidas, e o mínimo é 1,5 km (assim não conta quem só encosta no km 55, em Cubatão).

**Recorte por km nos trechos da tabela.** Um trecho do SNV só entra numa regra por km se a sobreposição de km for de pelo menos 50 m. Quando ele cruza o limite (ex.: BR-116 km 169,2–199,7 contra "0 a 195"), é recortado por interpolação de km; se o recorte der menos de 50 m, o trecho fica fora (nunca o trecho inteiro). O SNV é digitalizado no sentido do km (conferido em 116BSP2470, 116BSP2230 e 459BSP0170).

## Fontes, importadores e licenças

| Importador | `source` | O que grava | Licença |
|------------|----------|-------------|---------|
| `importers/sources/snv_dnit.py` | `snv-dnit` | Trechos de jurisdição **Federal** do SNV mais recente (202607A). Pista simples = PAV, IMP ou LEN; pista dupla = DUP. UFs em `SNV_UFS`, padrão ES, MG, RJ e SP (a área dos tiles); `ALL` pega o Brasil todo. Ficam 583 trechos de pista simples e 231 de pista dupla. Os coincidentes (ex.: BR-116/459) viram uma feição só, com `props.coinc`. Geometria simplificada a ~3 m | Dados abertos do Poder Executivo federal: **livre utilização** (Decreto 8.777/2016, art. 4º, red. Decreto 9.903/2019; o art. 1º, I, inclui as autarquias, como o DNIT). Sem licença nomeada no arquivo. Ver a nota abaixo |
| `importers/sources/prf_feriados.py` | `prf-dou` | 40 janelas (`kind='janela'`, com início e fim em `valid_from`/`valid_to`, -03:00) e o ato, os limites, as UFs e os trechos em `props` | Ato oficial, domínio público (Lei 9.610/98, art. 8º, IV) |
| `importers/sources/der_portarias.py` | `der-sp` | 1 regra semanal (`kind='regra_semanal'`), com as janelas, os limites, a chegada mínima, o § 5º e o art. 4º, lidos do texto | Ato oficial (domínio público). Marcos km: ARTESP, arquivo `marcos_quilometricos` das "Camadas Geoespaciais Auxiliares" do dataset [Programação de Obras](https://dadosabertos.artesp.sp.gov.br/dataset/programacao-de-obras) (CC BY, conferido no CKAN em 09/10/2026). Geometria da serra casada na malha OSM pelo Valhalla (© OpenStreetMap contributors, ODbL) |

**Licença do SNV: o que de fato acontece e a decisão tomada.** O SNV **é redistribuído** de duas formas: o seed `db/seed/layers/rodovias_horario__snv-dnit.sql` (2,1 MB, commitado, com a geometria simplificada e os coincidentes fundidos, ou seja, um derivado) e o mapa público (`GET /api/layers/rodovias_horario/features` devolve a geometria e os atributos dos trechos). Não é "uso interno".

- O repositório Nextcloud do DNIT não traz licença. O rodapé do portal gov.br do DNIT diz CC BY-ND 3.0; se valesse para os dados, derivados seriam proibidos.
- Decisão: tratamos o SNV como dado aberto federal de **livre utilização** pelo Decreto 8.777/2016, art. 4º (conferido no Planalto em 09/10/2026: "Os dados disponibilizados pelo Poder Executivo federal e as informações de transparência ativa são de livre utilização pelos Poderes Públicos e pela sociedade"), e o rodapé CC BY-ND como licença do conteúdo do site, não dos dados. É a mesma leitura da camada `acidentes` para os dados da PRF. Atribuímos a fonte (DNIT/SNV, versão) em `meta.sources` e em `data_layer_runs`.
- Risco residual: o DNIT pode entender que o ND vale para a base. **Saída pronta:** `RODOVIAS_HORARIO_MAPA_SNV=0` tira os trechos do SNV do mapa (a rota continua usando o SNV internamente) e, se for o caso, o seed do SNV sai do git e passa a ser gerado na máquina pelo importador (`snv_dnit`, ~69 MB de download). Confirmar com o DNIT (Fala.BR) antes de uso comercial em escala.

**Nada de valor legal fica fixo no código.** Os limites (2,60/4,40/19,80/58,5), as UFs, as datas e horas das janelas e as janelas da Anchieta são extraídos do texto publicado. Se a redação mudar e algo não for reconhecido, o importador **falha**: preferimos ficar sem a regra a usar uma regra errada. Exceções: os limites de AET da Res. CONTRAN 882/2021, art. 18 (CVC > 57 t ou > 19,80 m), usados para inferir "CVC com AET" na Anchieta quando o usuário não informa `requires_aet` (texto conferido no PDF oficial: https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-contran/resolucoes/Resolucao8822021.pdf), e as datas de Carnaval e Semana Santa, que saem da Páscoa (ver Decisões).

Dados de terceiros ficam só em `data_features` e nunca vão para o OSM.

## Verificação feita em 09/10/2026

- **DOU.** A busca pela frase da ementa ("restrição do trânsito de Veículos e Combinações de Veículos excedentes") devolveu as portarias DIOP/PRF 121/2026, 26/2026, 12/2026, 172/2025 etc.
  - A 121/2026 é a mais recente. O HTML baixado agora é idêntico ao da pesquisa. Ela revoga a 26/2026.
  - A 172/2025 (DOU de 29/12/2025) e a 80/2025 são dos feriados de **2025**, e o parser não as lê (o § 2º tem outra redação). Na carga de 09/10/2026 o importador baixa a 172/2025, vê na ementa que é de 2025 e que a última data do texto (janeiro de 2026) já passou, e pula sem fazer o parse; a 80/2025 nem é baixada. Conferido rodando o importador contra o DOU ao vivo: 40 janelas, sem falha.
  - As portarias DIOP/PRF posteriores (nº 145, de 29/09/2026, e nº 152, de 08/10/2026) tratam de credenciamento de escolta e não alteram a restrição.
  - A página da PRF ainda cita a 26/2026 no texto, mas o anexo já é o da 121. Vale o DOU.
- **DOE-SP.** A SUP/DER-084-01/11/2023 foi relida pela API (`/v2/publications/<slug>`). Busquei "SUP/DER-084" e "DER-084" de 07/11/2023 a 09/10/2026 e não achei revogação. Os atos que aparecem são outros:
  - PR/DER-084/2026: velocidade dinâmica no Sistema Anchieta-Imigrantes. Não toca no art. 3º.
  - PR/DER-232/2026: revoga a SUP/DER-084-**15/05/2019** (JARI).
  - PR/DER-001/2025: revoga a SUP/DER-084-**06/12/2018**.
  - O importador refaz essa busca a cada carga e marca `status='revogada'` se achar "revoga…084-01/11/2023". Nesse caso, a API ignora a regra.
- **Valhalla local.** Caminhão de SP para Santos desce pela Anchieta. Automóvel usa a Imigrantes. Confirma o `hgv=no`.

## Decisões e interpretações (leia antes de mudar)

- **Quem é afetado pela PRF.**
  - Afetado: excede qualquer limite do art. 1º **ou** é combinação com AET (§ 1º: "abrange o trânsito de CVC, CTV e CTVP, ainda que autorizadas ... por meio de AET ou AE").
  - Combinação = `vehicle_class` semirreboque, reboque ou CVC; sem classe, comprimento > 14 m (maior veículo simples, Res. CONTRAN 882/2021, art. 4º). Desde a integração do núcleo legal, o `vehicle.ts` marca `requires_aet` também pelas dimensões (largura > 2,60 m, altura > 4,40 m, comprimento acima do limite da classe). Por isso um truck de 16 m (AET por comprimento, mas dentro do art. 1º) **não** é pego, e um truck com carga de 2,80 m é pego pela largura, não como "CVC com AET".
  - Presets afetados: só o Rodotrem (30 m e 74 t, com AET). O Bitrem (19,80 m e 57 t, sem AET) e a Carreta (19,30 m e 41,5 t) não são.
  - **Risco:** a leitura literal do § 1º pode incluir qualquer CVC, até o bitrem de 7 eixos com 57 t e até 19,80 m. Não adotamos essa leitura porque o caput fala em "excedentes". O DER-MG cita bitrens expressamente nas regras dele.
- **"Pista simples"** são os trechos do SNV com `ds_sup_fed` PAV, IMP ou LEN e jurisdição Federal.
  - Trechos com BR delegada ao estado (jurisdição estadual) ficam fora, porque lá a autoridade não é a PRF.
  - Na Grande SP não há pista simples federal: Dutra, Régis e Fernão Dias são duplicadas. Lá a regra só pesa na Operação Aparecida.
- **Tabela de SP (§ 5º) sem horário.** O Anexo traz só datas ("02/10/2026 a 08/10/2026"), ao contrário da tabela nacional e da de MS, que têm coluna de horário.
  - Adotamos o **dia inteiro**, das 00:00 do primeiro dia às 24:00 do último. É a leitura literal de um período por datas, mas é uma interpretação.
  - Excedente conta como "portador de AET/AE", porque sem AET ele nem pode rodar.
- **Anchieta: quem é "CVC com AET".** Combinação (mesmo critério acima) com `requires_aet`, ou com comprimento > 19,80 m ou PBTC > 57 t (exigem AET pela Res. CONTRAN 882/2021, art. 18). Veículo simples com AET (ex.: carga larga) não entra no art. 3º.
- **Fuso.** As horas da portaria foram tratadas como horário de Brasília (-03:00). Para o Sudeste isso é exato. Em UFs com outro fuso a hora pode ser a local; isso não foi verificado.
- **Feriado prolongado na Anchieta (art. 3º, § 5º).** O texto (relido no DOE-SP em 09/10/2026): "Não será permitida a circulação prevista no § 1º nos feriados prolongados, municipal, estadual ou federal, que envolvam os dias de quinta-feira até a terça-feira da semana subsequente, em especial o Carnaval, Semana Santa, Natal e Ano Novo". A norma define o termo pelo intervalo de quinta a terça e cita quatro feriados nominalmente. O bloqueio é a união de:
  - **operações de feriado da PRF** (sem Eleições), do dia da primeira ao da última janela da operação. Janelas da mesma operação a até 3,5 dias uma da outra formam um só período: Carnaval e Corpus Christi têm 3,17 dias entre a ida e a volta e ficam inteiros; Natal e Réveillon (3,75 dias) ficam separados. **Quarta-feira na ponta sai** (véspera à tarde, como a de Corpus Christi, ou volta de manhã, como a Quarta de Cinzas), porque o § 5º vai de quinta a terça; fica se a quarta for o próprio feriado;
  - **Carnaval** (sexta → terça de Carnaval) e **Semana Santa** (quinta → domingo de Páscoa), calculados pela data da Páscoa (algoritmo de Meeus/Jones/Butcher). Valem mesmo sem a portaria da PRF do ano no banco (ex.: Carnaval de 2027, 05 a 09/02);
  - **feriados da tabela `holidays`** (nacional, SP e municipais de Santos, Cubatão, São Bernardo do Campo, São Paulo, São Vicente e Praia Grande) e **Natal/Ano Novo por data**: qui → dom, sex (com a quinta) → dom, sáb → seg, sáb → ter (com a ponte de segunda). Natal ou Ano Novo em outro dia bloqueiam o próprio dia ("em especial ... Natal e Ano Novo").
  - Uma janela do § 1º é bloqueada se encosta no período. Assim a de seg 12/10 23h → ter 13/10 05h fica bloqueada (começa no feriado), e no Carnaval de 2026 a próxima janela depois de sex 13/02 é a de qua 18/02 23h.
  - Pontos de interpretação: a quinta à noite antes de uma operação que começa na sexta (ex.: qui 08/10 23h → sex 09/10 05h, antes do feriado de segunda 12/10) fica bloqueada, porque a operação da PRF começa na sexta; e a Quarta de Cinzas não é feriado prolongado. As duas leituras seguem o intervalo "quinta a terça" do § 5º.
- **Só o horário de saída decide a penalidade.** É a limitação do framework. A passagem estimada por cada trecho gera `warn`, mas não muda a rota.
- **A rota livre da camada não vê as outras restrições.** O `prepare()` calcula a rota sem os `exclude_polygons` de zonas e reportes e sem os `costLines` de outras camadas (o framework não passa isso para a camada). Por isso a rota final pode cair num trecho restrito que a camada nunca testou; o aviso então diz "desvio não testado" em vez de "sem alternativa".

## Fora do escopo ou desativado (com motivo)

- **CONTRAN 882/2021, art. 20.** A CVC que exige AET só roda do amanhecer ao pôr do sol, salvo em pista dupla com separador (§ 1º) ou com autorização (§ 2º). A regra é importante, mas não foi modelada: depende do horário solar por ponto e do que diz cada AET. **Desativada** por ora.
- **SUP/DER-084/2023, art. 1º** (conjunto de carga indivisível ou ônibus com mais de 26 m, PBT até 70 t). O app não sabe se a carga é indivisível. Fica só no texto (`props.indivisivel_onibus`).
- **Portarias das superintendências da PRF (SPRF-xx) e dos DERs estaduais** (DER-MG etc.). Não há feed. O importador só pega a DIOP nacional.
- **SP-055 no verão** (o DER-SP publica todo ano; a próxima deve sair em dez/2026), AutoBAn "Operação Caminhão" (medida operacional, sem ato no DOE) e Operações Comboio/Descida da Ecovias (dinâmicas).
- **Trechos especiais de MS (BR-262 km 233–328) e de RO (BR-319 km 140–144,4 no Carnaval).** Ficam fora dos tiles do Sudeste. A janela de MS é importada (e conferida no teste de importação); a de RO (só no texto do § 4º) não.

## Limitações conhecidas

- **Desvios enormes quando a origem ou o destino está no trecho restrito.** Com fator 1000, 1 km restrito "custa" 1.000 km, e o Valhalla prefere qualquer desvio que use menos trecho restrito. Exemplos medidos em 09/10/2026:
  - Taubaté (Dutra km ~114) → BR-488 km 3 em 10/10, rodotrem com AET: ~300 km pelo sul de MG (a Dutra km 0–195 inteira é restrita na Operação Aparecida; a BR-488 também tem restrição temporária do SIAET para esse veículo);
  - BR-459/SP km ~5 → km ~11,5 em 20/11 com carga de 2,80 m: 15,7 km em vez de 6,6 km, saindo e voltando para a BR-459 por estradas locais.
  - O `routing.ts` avisa com `large_detour`, e o aviso da camada diz quando libera; o certo, nesse caso, é esperar. Melhoria possível: não penalizar o pedaço que a viagem não tem como evitar, ou sugerir a espera em vez do desvio.
- **Restrição do SIAET na BR-459/SP.** A camada `federal_restricoes` tem restrição temporária (10/2026) de 15 m de comprimento na BR-459/SP km 0–32,2, que tira dali a carreta e o rodotrem em qualquer dia. Os testes da PRF nessa rodovia usam um truck com carga de 2,80 m (excedente em largura) para ver só o efeito da PRF.
- O `avoided` do `routing.ts` pode listar um pedaço penalizado que a rota final ainda usa em parte (menos de 50% da linha). O aviso da camada é que vale: ele olha os trechos do SNV na rota final.

## Como atualizar

```bash
# no worktree/repo, com a rede do compose
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed \
  truck-router-importer snv_dnit prf_feriados der_portarias
```

- **PRF.**
  - Rode `prf_feriados` toda semana e logo que sair a portaria do ano seguinte (costuma sair em dez/jan). Em 2026 houve **3 revisões**.
  - O importador pega a portaria DIOP/PRF mais recente **de cada ano** (a mais nova revoga as anteriores daquele ano, que nem são lidas): ano corrente, ano seguinte (se já saiu) e, do ano anterior, **só as janelas que ainda não acabaram** (ex.: Fim de Ano que entra em janeiro).
  - O ano de cada portaria sai da ementa ("feriados do ano de AAAA") antes do parse completo. Portaria de ano que já não importa é pulada sem ser lida.
  - Falha de leitura: tolerada (e registrada nas notas da carga) só numa portaria do ano anterior ou, já lido o ano corrente, numa de ano desconhecido. Se a do ano corrente ou do seguinte não for lida, a carga falha e o banco fica como estava.
  - Em janeiro, antes da portaria do ano novo, a carga passa com a cauda do ano anterior e anota "ATENÇÃO: nenhuma portaria com os feriados de AAAA". Carnaval e Semana Santa da Anchieta continuam valendo pela Páscoa.
  - Para forçar uma URL: `PRF_PORTARIA_URL=...`.
- **SNV.** A versão mais nova é achada por PROPFIND no Nextcloud do DNIT. Para fixar uma: `SNV_VERSION=202607A`. O zip (69 MB) fica em `data/cache/snv/`.
- **DER-SP.** Novos atos entram na lista `ACTS` de `der_portarias.py`, cada um com seu parser. A checagem de revogação roda a cada carga.
- **Geometria da Anchieta.** Vem dos marcos ARTESP casados no Valhalla do momento da importação. Se os tiles mudarem muito, rode `der_portarias` de novo. A detecção tolera 40 m, e os `costLines` saem sempre da rota atual.

## Testes

`api/test/layers/rodovias_horario.test.ts` (19 testes), contra a API local:

- importação da 121/2026: limites do art. 1º, 33 janelas nacionais e juninas, 7 por trecho (6 de SP e 1 de MS), as 2 de largura > 3,20 m (só AET/AE), a de MS (BR-262 km 233–328, 09/04 12h–22h), horário em UTC;
- **feriado** (20/11 08:00, Consciência Negra): truck com carga de 2,80 m evita a BR-459 com `danger`, "largura 2,8 m > 2,6 m" (sem "CVC com AET") e "Liberado a partir de sex 20/11 12:00";
- **fora da janela** (18/11): usa a BR-459, sem aviso;
- janela em menos de 24 h (19/11 10:00): `info`;
- truck dentro dos limites no feriado: não é afetado e segue pela BR-459;
- truck de 16 m (AET por comprimento, dentro do art. 1º): a PRF não pega;
- Aparecida: rodotrem com AET evita a Dutra entre SJC e Taubaté (a mais de 1 km do meio do 116BSP2410); a carreta segue pela Dutra (a menos de 60 m);
- Aparecida, regra de largura (06/10 10:00): carreta de 3,30 m evita a Dutra até ter 13/10 00:00; a de 3,00 m segue pela Dutra;
- origem e destino na própria BR-459 no feriado: um só danger para o trecho (ou `uses_restricted_way` + `prf_feriado_sem_alternativa` info, ou `prf_feriado_na_rota` com "sem alternativa razoável"), nunca "desvio não testado";
- Anchieta: ter 10h fechada, com a próxima janela ter 23:00; ter 23h30 aberta; seg 12/10 02h bloqueada pelo feriado prolongado; **segunda de Carnaval** (16/02/2026 01:30) fechada, próxima janela qua 18/02 23:00; quarta de Cinzas 23h30 aberta; carreta livre; truck com AET por largura livre (não é CVC);
- Imigrantes: o caminhão desce pela Anchieta.

`importers/tests/test_prf_feriados.py` (6 testes, sem rede e sem banco) cobre a escolha das portarias por ano: outubro (só a vigente é lida; a de 2025 não quebra a carga), janeiro sem portaria nova (fica a cauda do Fim de Ano), portaria nova antes do fim da cauda (ficam as duas), revisão de dezembro mais a do ano seguinte, e as falhas (a do ano corrente derruba a carga; a do ano anterior é tolerada e registrada). Rodar: `docker run --rm -v $(pwd)/importers:/app --entrypoint python truck-router-importer -m unittest tests.test_prf_feriados -v`.

As datas são as da portaria de 2026. Quando as janelas de 2026 saírem do banco (a partir de 2027 o importador guarda do ano anterior só o que ainda não acabou), atualize as datas dos testes.

## Desempenho

- Sem regra ativa para o veículo, a camada não faz nenhuma chamada extra.
- Com regra ativa, faz 1 a 6 rotas extras no Valhalla, cada uma em dezenas de ms. A consulta do SNV usa pré-filtro planar e índice em grade em memória.
- O tempo extra de verdade vem de fora da camada, quando o desvio é longo. Medido em 09/10/2026 no caso da Anchieta fechada (rodotrem SP → Santos às 10h, desvio de 213 km, 74 `costLines` de todas as camadas): resposta em 33–39 s, dos quais a camada gasta ~0,3 s (`prepare`) e ~2 ms (`annotate`); o `routing.ts` ~1,5 s (`usesCostLine` sensível ao sentido); o `annotate` da camada `corredores_onibus` ~30 s e o da `oae` ~10 s (rodam em paralelo).
