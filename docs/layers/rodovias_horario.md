# Camada `rodovias_horario`: restrições de horário em rodovias

Cobre três regras com horário, todas citadas pela norma e pelo artigo. Os textos foram conferidos na fonte primária em 09/10/2026.

| # | Regra | Norma (fonte primária) | Quem é afetado | Onde | Quando |
|---|-------|------------------------|----------------|------|--------|
| 1 | Feriados da PRF | **Portaria DIOP/PRF nº 121, de 08/09/2026**, DOU de 09/09/2026, ed. 170-A, Seção 1 Extra A, p. 1. Art. 1º (I a IV, §§ 1º a 4º) e Anexo I. Em vigor desde a publicação (art. 6º). Revoga a nº 26/2026 (art. 5º) | Veículo com largura > 2,60 m, altura > 4,40 m, comprimento > 19,80 m ou PBTC > 58,5 t (art. 1º). Também CVC/CTV/CTVP, **mesmo com AET/AE** (§ 1º) | Trechos de **pista simples** de rodovia federal (§ 2º). Não vale em AC, AM, AP, PA e RR. MS e RO só na Operação Fim de Ano (§§ 3º e 4º) | As 30 janelas nacionais do Anexo I (véspera 16h–22h, 1º dia 06h–12h, último dia 16h–22h; Eleições 07h–18h). Mais 3 janelas dos Festejos Juninos (só BA/PB/PE/RN) |
| 1b | Operação N. Sra. Aparecida (SP) | Mesma portaria: art. 1º, § 5º, e tabela "Restrição aplicável apenas ao Estado de São Paulo" | **Só quem tem AET/AE** (nota da tabela). Nas datas "Acima de 3,20 m de largura", só quem passa dessa largura | BR-116 km 0–195 e 196–231, BR-459 km 0–32 e BR-488 km 0–5, **inclusive em pista dupla** | Por data: 02 a 08/10 e 05 a 08/10 (largura > 3,20 m); 09 a 12/10 (todas as restrições do art. 1º); BR-488 de 02 a 12/10 |
| 2 | Serra da Anchieta | **Portaria SUP/DER-084-01/11/2023**, DOE-SP de 07/11/2023, Executivo, p. 147. Art. 3º, §§ 1º, 2º e 5º, e art. 4º. Em vigor 15 dias após a publicação (art. 8º) | CVC com AET (PBTC até 74 t, comprimento até 30 m) | SP-150, km 40–55, pistas sul e norte | Circulação permitida **só** seg 01h–05h, seg 23h → ter 05h, ter 23h → qua 05h, qua 23h → qui 05h e qui 23h → sex 05h (§ 1º). Chegada ao sistema Anchieta-Imigrantes a partir das 22h (§ 2º). Nada disso vale em feriado prolongado de quinta a terça (§ 5º) |
| 3 | Descida da Imigrantes | Portaria ARTESP 11/2002, citada no FAQ da Ecovias. O link original está quebrado | Caminhões | SP-160, pista sul, serra | Sempre |

## Como entra na rota

1. **Vale no horário de saída e o veículo é afetado.**
   - A camada calcula a rota livre.
   - Recorta dela os pedaços que passam pelos trechos restritos.
   - Penaliza esses pedaços com `costLines` (fator 1000, "proibido salvo sem alternativa"; variável `RODOVIAS_HORARIO_FATOR`).
   - Refaz a rota e repete até 3 vezes, para pegar alternativas que também são restritas (exemplo: BR-459 → BR-383 → BR-354).
   - Gera o aviso `danger`:
     - `prf_feriado_desvio`: a rota evitou o trecho. O aviso diz quando a passagem é liberada.
     - `prf_feriado_na_rota`: não há alternativa razoável e a rota passa pelo trecho. O aviso diz "espere até…".
     - `anchieta_cvc_aet_desvio` / `anchieta_cvc_aet_na_rota`: o aviso traz a **próxima janela permitida**.
   - O fim do bloqueio encadeia janelas que se encostam. Exemplo: em 06/10 a regra de largura > 3,20 m termina em 08/10, mas a de 09 a 12/10 também pega o veículo, então o aviso diz "liberado a partir de ter 13/10 00:00".
2. **Não vale na saída, mas há janela que afeta o veículo nas próximas 24 h e a rota usa o trecho.**
   - Aviso `info` (`prf_feriado_proximo`).
   - Vira `warn` (`prf_feriado_eta`) quando a passagem estimada pelo trecho cai dentro da janela. A estimativa é a fração da distância × a duração da rota.
3. **Anchieta com a janela aberta:**
   - `info` (`anchieta_cvc_aet_janela`) mostra até quando a janela vai;
   - `warn` (`anchieta_cvc_aet_eta`) se a chegada estimada à serra passar do fim da janela;
   - `info` (`anchieta_faixa_esquerda`) para qualquer CVC (comprimento > 14 m) com chegada estimada entre 18h e 20h (art. 4º).
4. **Imigrantes:** já está no OSM. Há `hgv=no` em 24 ways da SP-160 pista sul (a maioria também com `hazmat=no`). O Valhalla local manda o caminhão de SP para Santos pela Interligação e pela Anchieta. O teste `descida da Imigrantes` garante isso, ficando a mais de 1 km do marco km 45 da SP-160 e a menos de 150 m do km 45 da SP-150. A camada não duplica essa regra.

**Por que recortar a própria rota em vez de mandar a geometria do SNV.** O Valhalla aplica `linear_cost_factors` por *edge walk*:

- A linha precisa seguir as arestas do grafo. Mandar a geometria do DNIT dá erro 233 ("Failed to edge walk line feature"), e esse erro derruba a rota inteira.
- O fator vale **só no sentido percorrido**.

Os vértices da própria rota do Valhalla satisfazem as duas condições. O casamento rota × trecho usa tolerância de 30 m, com sequências de pelo menos 300 m. Na BR-459, a distância SNV × OSM tem mediana de 3 m, p90 de 7 m e máximo de 39 m. Na Anchieta, a serra não tem saída no meio: as sequências a menos de 3 km de distância são unidas, e o mínimo é 1,5 km (assim não conta quem só encosta no km 55, em Cubatão).

## Fontes, importadores e licenças

| Importador | `source` | O que grava | Licença |
|------------|----------|-------------|---------|
| `importers/sources/snv_dnit.py` | `snv-dnit` | Trechos de jurisdição **Federal** do SNV mais recente (202607A). Pista simples = PAV, IMP ou LEN; pista dupla = DUP. UFs em `SNV_UFS`, padrão ES, MG, RJ e SP (a área dos tiles); `ALL` pega o Brasil todo. Ficam 583 trechos de pista simples e 231 de pista dupla (seed de 2,1 MB). Os coincidentes (ex.: BR-116/459) viram uma feição só, com `props.coinc` | Dado público federal (DNIT), **sem licença explícita** no repositório Nextcloud. O rodapé do portal gov.br do DNIT diz CC BY-ND 3.0; se isso valer para os dados, derivados ficam proibidos. **Incerto**: usamos o SNV só como referência geométrica interna e não redistribuímos o shapefile. Confirmar com o DNIT antes de uso comercial |
| `importers/sources/prf_feriados.py` | `prf-dou` | 40 janelas (`kind='janela'`, com início e fim em `valid_from`/`valid_to`, -03:00) e o ato, os limites, as UFs e os trechos em `props` | Ato oficial, domínio público (Lei 9.610/98, art. 8º, IV) |
| `importers/sources/der_portarias.py` | `der-sp` | 1 regra semanal (`kind='regra_semanal'`), com as janelas, os limites, a chegada mínima, o § 5º e o art. 4º, lidos do texto | Ato oficial (domínio público). Marcos km: ARTESP (CC BY). Geometria casada na malha OSM pelo Valhalla (© OpenStreetMap contributors, ODbL) |

**Nada de valor legal fica fixo no código.** Os limites (2,60/4,40/19,80/58,5), as UFs, as datas e horas das janelas e as janelas da Anchieta são extraídos do texto publicado. Se a redação mudar e algo não for reconhecido, o importador **falha**: preferimos ficar sem a regra a usar uma regra errada. A única exceção são os limites de AET da Res. CONTRAN 882/2021, art. 18 (CVC > 57 t ou > 19,80 m), usados para inferir "CVC com AET" na Anchieta quando o usuário não informa `requires_aet`. Texto conferido no PDF oficial: https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-contran/resolucoes/Resolucao8822021.pdf.

Dados de terceiros ficam só em `data_features` e nunca vão para o OSM.

## Verificação feita em 09/10/2026

- **DOU.** A busca pela frase da ementa ("restrição do trânsito de Veículos e Combinações de Veículos excedentes") devolveu as portarias DIOP/PRF 121/2026, 26/2026, 12/2026, 172/2025 etc.
  - A 121/2026 é a mais recente. O HTML baixado agora é idêntico ao da pesquisa. Ela revoga a 26/2026.
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
  - Afetado: excede qualquer limite do art. 1º **ou** tem `requires_aet=true` (§ 1º: CVC com AET).
  - Presets afetados: Bitrem (25 m) e Rodotrem (30 m e 74 t). A Carreta (18,6 m e 41,5 t) não é.
  - **Risco:** a leitura literal do § 1º pode incluir qualquer CVC, até o bitrem de 7 eixos com 57 t e até 19,80 m. Não adotamos essa leitura porque o caput fala em "excedentes". O DER-MG cita bitrens expressamente nas regras dele.
- **"Pista simples"** são os trechos do SNV com `ds_sup_fed` PAV, IMP ou LEN e jurisdição Federal.
  - Trechos com BR delegada ao estado (jurisdição estadual) ficam fora, porque lá a autoridade não é a PRF.
  - Na Grande SP não há pista simples federal: Dutra, Régis e Fernão Dias são duplicadas. Lá a regra só pesa na Operação Aparecida.
- **Tabela de SP (§ 5º) sem horário.** O Anexo traz só datas ("02/10/2026 a 08/10/2026"), ao contrário da tabela nacional e da de MS, que têm coluna de horário.
  - Adotamos o **dia inteiro**, das 00:00 do primeiro dia às 24:00 do último. É a leitura literal de um período por datas, mas é uma interpretação.
  - Excedente conta como "portador de AET/AE", porque sem AET ele nem pode rodar.
- **Recorte por km nos trechos da tabela.** Quando um trecho do SNV cruza o limite (ex.: BR-116 km 169,2–199,7 contra "0 a 195"), ele é recortado por interpolação de km. O SNV é digitalizado no sentido do km (conferido em 116BSP2470, 116BSP2230 e 459BSP0170).
- **Fuso.** As horas da portaria foram tratadas como horário de Brasília (-03:00). Para o Sudeste isso é exato. Em UFs com outro fuso a hora pode ser a local; isso não foi verificado.
- **Feriado prolongado na Anchieta (§ 5º).** A norma não define o termo. Usamos duas fontes:
  - os períodos das operações de feriado da própria PRF (do dia da primeira à última janela, sem Eleições);
  - se a tabela `holidays` estiver carregada (nacional, SP e municipais de Santos, Cubatão, São Bernardo do Campo, São Paulo, São Vicente e Praia Grande), o feriado de qui/sex/seg/ter mais o fim de semana ligado a ele.
  - Por isso a janela de seg 12/10 23h → ter 13/10 05h também fica bloqueada (começa no feriado). É conservador.
- **Só o horário de saída decide a penalidade.** É a limitação do framework. A passagem estimada por cada trecho gera `warn`, mas não muda a rota.

## Fora do escopo ou desativado (com motivo)

- **CONTRAN 882/2021, art. 20.** A CVC que exige AET só roda do amanhecer ao pôr do sol, salvo em pista dupla com separador (§ 1º) ou com autorização (§ 2º). A regra é importante, mas não foi modelada: depende do horário solar por ponto e do que diz cada AET. **Desativada** por ora.
- **SUP/DER-084/2023, art. 1º** (conjunto de carga indivisível ou ônibus com mais de 26 m, PBT até 70 t). O app não sabe se a carga é indivisível. Fica só no texto (`props.indivisivel_onibus`).
- **Portarias das superintendências da PRF (SPRF-xx) e dos DERs estaduais** (DER-MG etc.). Não há feed. O importador só pega a DIOP nacional.
- **SP-055 no verão** (o DER-SP publica todo ano; a próxima deve sair em dez/2026), AutoBAn "Operação Caminhão" (medida operacional, sem ato no DOE) e Operações Comboio/Descida da Ecovias (dinâmicas).
- **Trechos especiais de MS (BR-262 km 233–328) e de RO (BR-319 km 140–144,4 no Carnaval).** Estão no banco ou fora dele, mas ficam fora dos tiles do Sudeste. A janela de MS é importada; a de RO (só no texto do § 4º) não.

## Como atualizar

```bash
# no worktree/repo, com a rede do compose
docker run --rm --network truck-router_default -e PGHOST=db -e PGUSER=truck -e PGPASSWORD=truck -e PGDATABASE=truck_router \
  -e DATA_DIR=/data -e SEED_DIR=/seed/layers -v $(pwd)/importers:/app -v $(pwd)/data:/data -v $(pwd)/db/seed:/seed \
  truck-router-importer snv_dnit prf_feriados der_portarias
```

- **PRF.**
  - Rode `prf_feriados` toda semana e logo que sair a portaria do ano seguinte (costuma sair em dez/jan). Em 2026 houve **3 revisões**.
  - O importador pega a portaria DIOP/PRF mais recente **de cada ano** (a mais nova revoga as anteriores daquele ano), cobrindo o ano corrente e o seguinte.
  - Para forçar uma URL: `PRF_PORTARIA_URL=...`.
- **SNV.** A versão mais nova é achada por PROPFIND no Nextcloud do DNIT. Para fixar uma: `SNV_VERSION=202607A`. O zip (69 MB) fica em `data/cache/snv/`.
- **DER-SP.** Novos atos entram na lista `ACTS` de `der_portarias.py`, cada um com seu parser. A checagem de revogação roda a cada carga.
- **Geometria da Anchieta.** Vem dos marcos ARTESP casados no Valhalla do momento da importação. Se os tiles mudarem muito, rode `der_portarias` de novo. A detecção tolera 40 m, e os `costLines` saem sempre da rota atual.

## Testes

`api/test/layers/rodovias_horario.test.ts` (12 testes), contra a API local:

- importação da 121/2026: limites do art. 1º, 33 janelas nacionais e juninas, horário em UTC;
- **feriado** (20/11 08:00, Consciência Negra): rodotrem evita a BR-459 com `danger` e "Liberado a partir de sex 20/11 12:00";
- **fora da janela** (18/11): usa a BR-459, sem aviso;
- janela em menos de 24 h (19/11 10:00): `info`;
- carreta no feriado: não é afetada;
- Aparecida: rodotrem com AET evita a Dutra entre SJC e Taubaté; carreta não;
- Anchieta: ter 10h fechada, com a próxima janela ter 23:00; ter 23h30 aberta; seg 12/10 02h bloqueada pelo feriado prolongado; carreta livre;
- Imigrantes: o caminhão desce pela Anchieta.

As datas são as da portaria de 2026. Quando a carga de 2026 sair do banco (o importador mantém o ano anterior), atualize as datas dos testes.

## Desempenho

- Sem regra ativa para o veículo, a camada não faz nenhuma chamada extra.
- Com regra ativa, faz 1 a 3 rotas extras no Valhalla, cada uma em dezenas de ms. A consulta do SNV usa pré-filtro planar e índice em grade em memória.
- A maior parte do tempo extra vem de fora da camada, quando o desvio é longo:
  - `usesCostLine`/`overlapRatio` do `routing.ts` (turf);
  - o `annotate` de outras camadas sobre rotas longas, como a `oae` em desvio de 200 km.
