export const meta = {
  name: 'sudeste-cidades-orquestrado-v2',
  description: 'Pesquisa das regras de caminhão de cada município do Sudeste com preparação compartilhada (pistas em massa + ferramentas), agente orquestrador que faz triagem e conduz ondas com aprendizado, e verificação',
  phases: [
    { title: 'Preparação', detail: 'pistas em massa (penaestrada, Querido Diário, diários consolidados) e ferramentas por sistema de legislação' },
    { title: 'Profundo', detail: 'cidades grandes, em paralelo com a preparação' },
    { title: 'Orquestração', detail: 'agente coordenador: triagem, fila, guia e reavaliação a cada onda' },
    { title: 'Ondas', detail: 'pesquisa dirigida pelas pistas', model: 'sonnet' },
    { title: 'Verificação', detail: 'verificador cético das regras ativas' },
  ],
}

const R = args.repo
const NS = args.ns
const C = NS + '/cidades'
const SCHEMA_TXT = `${R}/data/raw/municipios/schema.json (formato das regras) e ${R}/docs/layers/restricoes_municipais.md; exemplo pronto ${R}/data/raw/municipios/3205309.json (Vitória)`
const SAIDA = `SAÍDA POR CIDADE (grave ao terminar cada uma; se o arquivo já existir com status final, pule a cidade): ${C}/res/<ibge>.json = {ibge, nome, uf, status: "regra_com_ato"|"regra_sem_ato"|"pista"|"pontual"|"sem_restricao_declarada"|"confirmou_que_nao_tem"|"nao_achou", nivel_busca, fontes_consultadas:[{url, resultado}], data:"2026-10-10", observacoes, osm_divergencias:[...], regras_rascunho:[regras no formato de ${SCHEMA_TXT}, sem geometria, com vias/limites em texto; "ativa" SÓ com ato primário vigente com número, artigo e URL lida por você; pista de OSM/notícia/penaestrada → "desativada" com motivo; suspensa/revogada registrada como tal]}. Atos baixados em ${C}/atos/<ibge>/.`
const REGRAS = `SOMENTE LEITURA no repo ${R} e no banco; não chame o Valhalla. Outra sessão do Claude é a única que escreve na main. Convenções: ${NS}/sudeste/CONVENCOES_IMPLEMENTACAO.md. Cota baixa de WebSearch: NO MÁXIMO 2 por agente — use WebFetch/curl direto nas fontes e as ferramentas de ${C}/toolkit/ quando existirem (carregue WebFetch/WebSearch com ToolSearch "select:WebSearch,WebFetch"). Não invente ato, artigo, URL nem horário. Português do Brasil.`

const LOTE_RET = { type: 'object', properties: {
  lote: { type: 'string' },
  cidades: { type: 'array', items: { type: 'object', properties: { ibge: { type: 'string' }, nome: { type: 'string' }, status: { type: 'string' }, regras_ativas: { type: 'integer' }, regras_desativadas: { type: 'integer' }, fonte_decisiva: { type: 'string' }, resumo: { type: 'string' } }, required: ['ibge', 'nome', 'status', 'regras_ativas', 'regras_desativadas', 'resumo'] } },
  aprendizados: { type: 'array', items: { type: 'string' }, description: 'o que funcionou/não funcionou por sistema de legislação ou UF, útil para outros lotes' },
  osm_divergencias: { type: 'array', items: { type: 'string' } },
  pendencias: { type: 'array', items: { type: 'string' } },
}, required: ['lote', 'cidades', 'aprendizados', 'osm_divergencias', 'pendencias'] }
const VER = { type: 'object', properties: {
  lote: { type: 'string' },
  cidades: { type: 'array', items: { type: 'object', properties: { ibge: { type: 'string' }, veredito: { type: 'string', enum: ['confirmado', 'corrigido', 'refutado', 'inverificavel'] }, nota: { type: 'string' } }, required: ['ibge', 'veredito', 'nota'] } },
}, required: ['lote', 'cidades'] }
const PREP_RET = { type: 'object', properties: {
  arquivo: { type: 'string' }, cobertura: { type: 'string' }, como_usar: { type: 'string' }, limitacoes: { type: 'array', items: { type: 'string' } },
}, required: ['arquivo', 'cobertura', 'como_usar', 'limitacoes'] }
const FILA = { type: 'object', properties: {
  resolvidas_direto: { type: 'integer' },
  lotes: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, foco: { type: 'string' }, ibges: { type: 'array', items: { type: 'string' } } }, required: ['id', 'foco', 'ibges'] } },
  guia: { type: 'string', description: 'caminho do guia atualizado' },
  parar: { type: 'boolean' }, motivo: { type: 'string' },
}, required: ['resolvidas_direto', 'lotes', 'guia', 'parar', 'motivo'] }

const verificar = (id, r) => {
  const com = ((r && r.cidades) || []).filter((c) => c.regras_ativas > 0)
  if (!com.length) return Promise.resolve(null)
  return agent(`Você é um verificador CÉTICO e independente. Para cada cidade abaixo, leia ${C}/res/<ibge>.json, abra o ATO OFICIAL de cada regra ativa e confira número, artigo, vigência (alteração/revogação posterior), dias, horários, veículos afetados, exceções e VUC local. Na dúvida, rebaixe para desativada. Grave ${C}/verif/<ibge>.json ({ibge, veredito, regras:[{id, veredito, correcao, nota}]}) e, se corrigir, ATUALIZE o res/<ibge>.json (registre "verificado em 2026-10-10: ..." em observacoes). ${REGRAS}\n\nCIDADES DO LOTE ${id}:\n${JSON.stringify(com)}`,
    { label: `verifica:${id}`, phase: 'Verificação', schema: VER })
}

// ---------- PREPARAÇÃO ----------
phase('Preparação')
const PREP = [
  { key: 'penaestrada', task: `Baixe, com respeito a limites de taxa (≥1 s entre pedidos, User-Agent identificado), as páginas de restrição de caminhões do site penaestrada.com.br para TODOS os 1.668 municípios do Sudeste (lista em ${C}/municipios_sudeste.csv: ibge;nome;uf). Descubra o padrão de URL/slug (há exemplo /restricoes/<slug>/) ou um índice/sitemap. Extraia por município: existe página?, texto do que ela diz (possui/não possui restrição, vias, horários, VUC, fontes citadas), data. Grave ${C}/leads/penaestrada.json ({ibge: {...}}) e um resumo. É compilação de terceiros: serve só como PISTA.` },
  { key: 'querido_diario', task: `Usando a API pública do Querido Diário (https://queridodiario.ok.org.br/api/gazettes, documentação em https://queridodiario.ok.org.br/api/docs), consulte, para TODOS os municípios do Sudeste cobertos pelo QD (lista de territórios em ${C}/qd_cities.json; filtre os do Sudeste, códigos 31/32/33/35), os termos-chave de restrição de caminhões (ex.: "caminhões" + "circulação", "veículos pesados", "carga e descarga", "VUC", "zona de restrição", "trânsito pesado", "toneladas"), respeitando a taxa. Para cada município: número de acertos relevantes, as 10 melhores ocorrências (data, trecho, URL do PDF/texto). Grave ${C}/leads/querido_diario.json ({ibge: {...}}).` },
  { key: 'diarios_consolidados', task: `Diários oficiais consolidados por UF: MG (AMM, https://www.diariomunicipal.com.br/amm-mg/ — 853 municípios), ES (DOM-ES/AMUNES, https://diariomunicipal.es.gov.br), e procure o equivalente em SP e RJ (ex.: imprensaoficialmunicipal.com.br, consórcios, plataformas comuns de diário). Descubra a busca de cada um (API/formulário), escreva um cliente reutilizável em ${C}/toolkit/diarios_consolidados.py (CLI: buscar <ibge|nome> <termo>), e RODE os termos-chave de restrição de caminhões para TODOS os municípios cobertos, respeitando a taxa. Grave ${C}/leads/diarios_consolidados.json ({ibge: {acertos, ocorrências com data/trecho/URL}}) e documente a cobertura de cada diário.` },
  { key: 'portais', task: `Mapeie, para TODOS os 1.668 municípios do Sudeste (${C}/municipios_sudeste.csv), qual sistema de legislação a prefeitura e a Câmara usam (Leis Municipais/leismunicipais.com.br, SAPL, Siscam, Legislação Digital, Legislação Compilada, Instar, Atende.net, CESPRO, nopapercloud, 1doc/1dom, WordPress, portal próprio) e a URL de busca. Use heurísticas baratas (domínio padrão <cidade>.<uf>.gov.br e <cidade>.<uf>.leg.br, páginas de legislação, padrões de URL conhecidos) com curl e paralelismo moderado. Escreva clientes reutilizáveis por sistema em ${C}/toolkit/legislacao.py (CLI: buscar <ibge> <termo> → lista de atos com número, data, ementa, URL), testados em pelo menos 3 municípios de cada sistema. Grave ${C}/leads/portais.json ({ibge: {sistema, url_busca, testado}}) e ${C}/toolkit/README.md (como usar).` },
]
const prepPromise = parallel(PREP.map((p) => () => agent(`Você é um PREPARADOR: monta insumos compartilhados para dezenas de agentes que vão pesquisar as regras municipais de circulação de caminhões no Sudeste. Trabalhe em escala (scripts, não cidade a cidade à mão) e de forma robusta (retomada se cair: grave parciais). ${REGRAS}\n\nTAREFA (${p.key}): ${p.task}`,
  { label: `prep:${p.key}`, phase: 'Preparação', schema: PREP_RET })))

// ---------- PROFUNDO (já começa) ----------
phase('Profundo')
const profundo = pipeline(
  args.lotesProfundos,
  (id) => agent(`Você pesquisa, em NÍVEL PROFUNDO, as REGRAS MUNICIPAIS DE CIRCULAÇÃO DE CAMINHÕES das cidades do lote ${id} em ${C}/lotes.json (objeto com "id" = "${id}": ibge, nome, uf, frota, indícios do OSM, nota do que a pesquisa anterior já tentou — não repita). Esgote as fontes oficiais de cada cidade (portal de legislação da prefeitura, sistema da Câmara — SAPL/Siscam/Leis Municipais/Legislação Digital/Instar/Atende.net/CESPRO —, diário oficial, Querido Diário, diário consolidado da UF, página de trânsito/serviços); use penaestrada.com.br/restricoes/<slug>/ e notícias só como pista; leia o texto integral dos atos e extraia TODAS as regras (zonas, vias, pontes, carga e descarga, perigosos, VUC local, exceções, cadastros), conferindo alteração/revogação. Se já houver pistas em ${C}/leads/ e ferramentas em ${C}/toolkit/ (a preparação roda em paralelo), use-as. Leia antes ${SCHEMA_TXT}.\n${SAIDA}\n${REGRAS}`,
    { label: `profundo:${id}`, phase: 'Profundo', schema: LOTE_RET }),
  (r, id) => verificar(id, r).then((v) => ({ lote: id, pesquisa: r, verificacao: v })),
)


const prepRes = await prepPromise
log(`Preparação: ${prepRes.filter(Boolean).length}/${PREP.length} insumos prontos`)

// ---------- ORQUESTRADOR ----------
phase('Orquestração')
const ORQ = `Você é o AGENTE ORQUESTRADOR da pesquisa das regras municipais de caminhões no Sudeste. Você NÃO pesquisa cidade por cidade: você decide o trabalho dos outros. Insumos: lista ${C}/municipios_sudeste.csv; prioridade e frota ${C}/prioridade.json e ${C}/tiers.json; indícios do OSM ${C}/osm_hints_por_municipio.json; pistas em ${C}/leads/*.json; ferramentas em ${C}/toolkit/ (README.md); resultados já gravados em ${C}/res/*.json e ${C}/verif/*.json; cidades já cobertas no repo (${R}/data/raw/municipios/*.json e a capital paulista 3550308 — NÃO entram na fila); as cidades dos lotes de nível profundo (A01–A30 em ${C}/lotes.json) são tratadas por outra frente que roda em paralelo: NÃO as coloque na fila.\nRESUMO DA PREPARAÇÃO: ${JSON.stringify(prepRes).slice(0, 8000)}`
const filaFrom = (instr) => agent(`${ORQ}\n\n${instr}\n\nREGRAS DA TRIAGEM: (1) cidade pequena (< 500 caminhões) sem nenhuma pista (penaestrada sem página ou "não possui", 0 acerto no QD e no diário consolidado, sem indício no OSM) → resolva DIRETO: grave ${C}/res/<ibge>.json com status "nao_achou" (ou "sem_restricao_declarada" se a pista disser que não possui), nivel_busca "varredura_consolidada" e fontes_consultadas listando exatamente o que foi consultado na preparação (escreva um script; não invente consulta que não houve); (2) cidade com qualquer pista → fila de pesquisa DIRIGIDA, com a pista anotada; (3) cidade média (500–2.000) sem pista → fila de pesquisa MÉDIA (verificação rápida no portal de legislação via toolkit); agrupe em lotes de 10–20 cidades da MESMA UF e, se possível, do mesmo sistema de legislação. Grave cada lote em ${C}/fila/<id>.json ({id, foco, cidades:[{ibge, nome, uf, caminhoes, pistas:{...}, nota}]}) e o guia em ${C}/GUIA.md (fontes que funcionam por UF e por sistema, armadilhas, termos que dão acerto, aprendizados das ondas). Ids de lote únicos por rodada (ex.: R1-MG-01). Devolva a fila.`,
  { label: 'orquestrador', phase: 'Orquestração', schema: FILA })

let fila = await filaFrom('RODADA 1: faça a triagem inicial de TODOS os municípios restantes.')
const ondas = []
let rodada = 1
while (fila && fila.lotes && fila.lotes.length && !fila.parar && rodada <= 3) {
  log(`Onda ${rodada}: ${fila.lotes.length} lotes; ${fila.resolvidas_direto} cidades resolvidas direto pelo orquestrador`)
  const res = await pipeline(
    fila.lotes,
    (l) => agent(`Você pesquisa as REGRAS MUNICIPAIS DE CIRCULAÇÃO DE CAMINHÕES do lote ${l.id} (foco: ${l.foco}), lido em ${C}/fila/${l.id}.json (cidades com as PISTAS já levantadas). Leia ANTES o guia ${C}/GUIA.md e ${C}/toolkit/README.md e use as ferramentas (não refaça a descoberta de fontes). Para cada cidade: siga as pistas até o ato oficial e leia-o; sem pista, faça a verificação rápida no portal de legislação/diário via toolkit com os termos-chave (não mais que ~8 consultas). Leia antes ${SCHEMA_TXT}.\n${SAIDA}\n${REGRAS}\nNo retorno, liste APRENDIZADOS úteis para o guia.`,
      { label: `onda${rodada}:${l.id}`, phase: 'Ondas', schema: LOTE_RET, model: 'sonnet', effort: 'medium' }),
    (r, l) => verificar(l.id, r).then((v) => ({ lote: l.id, pesquisa: r, verificacao: v })),
  )
  ondas.push({ rodada, resultados: res.filter(Boolean) })
  const resumo = res.filter(Boolean).map((x) => ({ lote: x.lote, cidades: (x.pesquisa?.cidades || []).map((c) => ({ ibge: c.ibge, status: c.status, ativas: c.regras_ativas })), aprendizados: x.pesquisa?.aprendizados, pendencias: x.pesquisa?.pendencias }))
  rodada++
  fila = await filaFrom(`RODADA ${rodada}: reavalie. Resultados da onda anterior: ${JSON.stringify(resumo).slice(0, 40000)}\nAtualize o GUIA.md com os aprendizados. Monte nova fila SÓ com: cidades que falharam ou ficaram sem res/; cidades médias/grandes que ficaram "nao_achou" por falha de fonte (site fora, JS) se houver caminho alternativo agora conhecido; pistas novas surgidas. Se o ganho esperado for baixo, devolva parar=true com o motivo.`)
}

const prof = await profundo
const final = await agent(`${ORQ}\n\nFECHAMENTO: (1) consolide ${C}/varredura_final.json com TODAS as cidades do Sudeste sem regra encontrada (ibge, nome, uf, status, nivel_busca, fontes consultadas resumidas, data) — formato pronto para virar data/raw/municipios/_varredura.json; (2) consolide ${C}/osm_divergencias.json (casos de tag do OSM sem ato ou contra ato vigente, com evidência); (3) liste em ${C}/RESUMO.md: totais por status e UF, cidades com regra ativa (verificada) e quantas regras, cidades onde a fonte falhou, e o que só um pedido de LAI resolveria. Devolva os totais.`,
  { label: 'orquestrador:fechamento', phase: 'Orquestração', schema: { type: 'object', properties: { totais: { type: 'string' }, cidades_com_regra: { type: 'integer' }, regras_ativas: { type: 'integer' }, sem_regra: { type: 'integer' }, falhas_de_fonte: { type: 'integer' }, arquivos: { type: 'array', items: { type: 'string' } } }, required: ['totais', 'cidades_com_regra', 'regras_ativas', 'sem_regra', 'falhas_de_fonte', 'arquivos'] } })

return { preparacao: prepRes, profundo: prof.filter(Boolean), ondas, fechamento: final }
