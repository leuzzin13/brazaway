# Camada `pontes_federais`: pontes e viadutos das rodovias federais (informativa)

Pontes e viadutos federais com a **nota técnica do DNIT** (PROARTE), as OAEs das **concessões** (ANTT) e os
**alertas de interdição** publicados pelo DNIT. A camada **nunca bloqueia a rota**: ela avisa e pede reporte. Os
alertas aprovados na curadoria entram na rota pela camada `federal_restricoes`.

| | |
|---|---|
| Importadores | `importers/sources/dnit_pontes.py` (`dnit`), `importers/sources/antt_pontes.py` (`antt`), `importers/sources/dnit_alertas.py` (`dnit-alertas`, opcional) |
| API | `api/src/layers/pontes_federais.layer.ts` (usa o índice de rota e o `nearRoute` da `federal_restricoes`) |
| Tabelas | `data_features` (layer `pontes_federais`) e `dnit_alertas_curadoria` (decisões humanas, migration `0112_siaet.sql`) |
| Seeds | `db/seed/layers/pontes_federais__dnit.sql` (~7 MB, 9.372 OAEs), `__antt.sql` (3.527), `__dnit-alertas.sql` (51) |
| Testes | `api/test/layers/siaet.test.ts` (nota 1–2, alerta pendente e aprovado, features) |

## Fontes e licenças

| Fonte | O que dá | Licença / uso |
|---|---|---|
| DNITGeo WFS `vgeo:oae_sgo` (`https://servicos.dnit.gov.br/dnitgeo/geoserver/wfs`) | 8.795 OAEs: ponto, tipo, estrutura, extensão, largura, código SGO e rotação do símbolo | Dado público do DNIT, de livre utilização (Decreto 8.777/2016, art. 4º, red. Decreto 9.903/2019); o WFS não declara licença (`AccessConstraints=NONE`). Citar o DNIT. |
| Painel Power BI "Obras de Arte Especiais" do PROARTE/DNIT (publish-to-web, divulgado pelo SETCESP em 28/04/2025) | tabela `PLANILHÃO`: nota técnica de 1 a 5 do SGO, data da vistoria e até 4 inspeções; tabela `BASE BRÁULIOS`: situação no PROARTE | **Sem licença declarada.** É divulgação pública do DNIT (transparência ativa), o que o Decreto 8.777/2016, art. 4º, faz de livre utilização. Mesmo assim: uso informativo, citando DNIT/PROARTE, e antes de uso comercial pesado peça a base e a licença via LAI (Fala.BR). A API do painel não é documentada e pode mudar. |
| ANTT, "Pontes e similares das rodovias concedidas" (`https://dados.antt.gov.br/dataset/pontes-similares`) | 3,5 mil OAEs das concessões, com coordenadas de início e fim por pista | **CC-BY** (Creative Commons Atribuição, `license_id = cc-by` no CKAN). A atribuição está em `meta.sources`. |
| DNIT, "Alertas de serviços" (`https://www.gov.br/dnit/pt-br/central-de-conteudos/noticias-alerta-de-servicos`) | notícias de interdição ou restrição de ponte | Portal gov.br (CC BY-ND 3.0): guardamos só os fatos (local, tipo, data) e o link, não o texto. |

A nota segue a Norma DNIT 010/2024-PRO, Anexo C (normativo):

| Nota | Classificação |
|---|---|
| 5 | excelente |
| 4 | boa |
| 3 | regular |
| 2 | ruim |
| 1 | crítica: "risco tangível de colapso estrutural" |

A nota 1 "pode configurar uma situação de emergência", com medidas como restrição da carga ou interdição total ou
parcial. Mas essa é uma decisão do DNIT, não um limite publicado.

## Como atualizar

```bash
# mesmo docker run da camada federal_restricoes, trocando o nome do importador
... truck-router-importer dnit_pontes antt_pontes      # mensal, ou quando o painel ou a ANTT atualizarem
... truck-router-importer dnit_alertas                 # diário ou semanal (opcional; ver a curadoria abaixo)
```

- **`dnit_pontes`**:
  - baixa o `oae_sgo` (cache de 30 dias, compartilhado com o `siaet_restricoes`);
  - consulta o Power BI: `modelsAndExploration` descobre o modelo e o `LastRefreshTime`, e `querydata` usa o DSR
    decodificado (o mesmo extrator da pesquisa, `powerbi_oae/pbi_query.py`);
  - junta os dois pelo código SGO, que casa 100% com o WFS. As OAEs do painel sem ponto no WFS (577) entram pelo
    lat/lon do painel;
  - se o Power BI falhar, carrega só o WFS e anota em `NOTES`.
- **`antt_pontes`**: o CSV publicado tem 26 colunas no cabeçalho e 24 nas linhas (faltam `municipio_*`); o importador
  detecta e alinha. Gera uma feição por pista com coordenadas (linha de início a fim quando < 3 km).
- **`dnit_alertas`**: `DNIT_ALERTAS_DIAS` (padrão 150) e `DNIT_ALERTAS_PAGINAS` (padrão 15, com 30 notícias por página).

## Regras na rota

- **Quando a OAE é "da rota".** A rota tem que passar **por cima** dela:
  - ponto do DNIT a até 30 m, com o rumo da rota alinhado (±30°) ao rumo da rodovia no DNITGeo (`rotação + 90°`;
    mediana de 0,9° na pesquisa). Sem rotação, até 15 m;
  - ANTT: início e fim a até 30 m;
  - só contam ponte, ponte de madeira, pontilhão e viaduto (passarela e túnel não limitam peso).
- **Nota 1–2: aviso `warn` `ponte_nota_baixa`** e item em `data.reportar` (`weight_limit`, "Há placa de peso (R-14) ou
  interdição nesta ponte?"), para o app abrir o reporte colaborativo (base própria, separada do OSM). São até 6 avisos
  individuais e 1 agregado. **Nunca bloqueia**: a nota, sozinha, não é parâmetro de restrição de peso de carga especial
  (Res. DNIT 11/2022, art. 29 §5º), não é limite publicado nem sinalizado (art. 29 §3º) e as vistorias publicadas são
  de 2020–2021 (refresh do painel em 09/04/2025).
- **Ponte de madeira:** `warn` `ponte_madeira_federal` (a capacidade não é publicada).
- **Alerta do DNIT pendente**, a até ~300 m da rota e publicado nos últimos 120 dias: `info` `alerta_dnit_pendente`.
  Alerta aprovado e perto da rota: `info` `alerta_dnit_revisado`, e a restrição entra pela `federal_restricoes`. Se a
  rota desviou da ponte, o desvio aparece em `avoided` e no resumo daquela camada.
- **Resumo:** número de pontes e viadutos federais na rota e quantos têm nota 1–2 (com os anos das vistorias), quantos
  são de madeira e quantos estão em concessão (sem nota). `data` traz `por_nota`, `nota_baixa`, `reportar` e `alertas`.

## Curadoria dos alertas do DNIT

O importador geolocaliza a notícia de dois jeitos:
1. pela OAE do DNITGeo na mesma BR/UF com o nome do rio, a até 5 km do km citado;
2. senão, pelo km no eixo do SNV.

Ele guarda um trecho de ~1 km do eixo em torno do ponto. **Tudo fica `pendente_revisao`.** Para aplicar, uma pessoa
lê a notícia (`props.url`) e registra a decisão:

```sql
-- aprovar com limite de peso conferido na notícia ou na placa
insert into dnit_alertas_curadoria (source_id, status, acao, peso_max_t, valido_ate, revisado_por, nota)
values ('<source_id>', 'aprovado', 'limite_peso', 12, '2027-01-25', 'fulano', 'restrição > 12 t, DNIT 23/09/2026')
on conflict (source_id) do update set status = excluded.status, acao = excluded.acao, peso_max_t = excluded.peso_max_t,
  valido_ate = excluded.valido_ate, revisado_por = excluded.revisado_por, revisado_em = now(), nota = excluded.nota;

-- interdição total
... values ('<source_id>', 'aprovado', 'interdicao', null, '2027-01-25', 'fulano', 'interdição total por 4 meses');

-- descartar (some do mapa e dos avisos)
... values ('<source_id>', 'rejeitado', null, null, null, 'fulano', 'obra concluída / não é restrição');

-- fila de revisão
select f.source_id, f.name, f.props->>'publicado_em' as publicado, f.props->>'url' as url, f.props->>'localizacao' as loc,
       f.props->>'tipo_alerta' as tipo, f.props->>'peso_mencionado_t' as peso
  from data_features f left join dnit_alertas_curadoria c using (source_id)
 where f.layer_id = 'pontes_federais' and f.source = 'dnit-alertas' and c.source_id is null
 order by f.valid_from desc;
```

A curadoria fica fora de `data_features` porque o runner apaga e recarrega as feições a cada importação. A decisão
sobrevive porque o `source_id` é o hash da URL da notícia. `peso_mencionado_t` e `tipo_alerta` são só pistas para o
revisor (regex no texto) e nunca são aplicados.

## Limitações e pendências

- A nota está defasada (vistorias de 2020–2021) e não cobre as concessões federais em SP (o painel não tem OAE na
  RMSP). A Portaria MT nº 309/2026 instituiu a política nacional de gestão de OAEs das rodovias federais: é uma boa
  janela para pedir via LAI a extração com nota, trem-tipo e coordenadas.
- A classe de projeto (trem-tipo) e o ano de construção não são públicos, então não os usamos como limite.
- Pontes gêmeas (LD/LE, marginal) a menos de 30 m e alinhadas podem ser contadas e avisadas mesmo se a rota usa só uma.
- A geolocalização dos alertas é por regex: 37 de 51 pelo km no SNV (pode errar alguns km) e 14 pelo nome da OAE.
  Notícias sem BR/UF reconhecível ficam de fora (listadas em `data_layer_runs.notes`).
- O alerta pendente some do mapa e dos avisos 120 dias depois da publicação, mesmo sem revisão.
- A API pública do Power BI não é documentada. Se ela mudar, a carga segue sem nota (com aviso em `NOTES`).
