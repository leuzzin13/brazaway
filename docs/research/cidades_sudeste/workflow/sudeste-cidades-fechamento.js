export const meta = {
  name: 'sudeste-cidades-fechamento',
  description: 'Verifica as 44 cidades com regra ativa sem verif/ e roda a 1ª onda dos 37 lotes da fila (Sonnet), com verificação das regras novas',
  phases: [
    { title: 'Verificação pendente', detail: 'cidades já pesquisadas com regra ativa e sem verif/' },
    { title: 'Ondas', detail: 'lotes de fila/ (pesquisa dirigida/média)', model: 'sonnet' },
    { title: 'Verificação nova', detail: 'regras ativas surgidas na onda' },
  ],
}

const C = args.C
const R = args.repo
const SCHEMA_TXT = `${R}/data/raw/municipios/schema.json (formato das regras) e ${R}/docs/layers/restricoes_municipais.md; exemplo pronto ${R}/data/raw/municipios/3205309.json (Vitória)`
const PATHS = `ATENÇÃO A CAMINHOS: arquivos antigos (GUIA.md, toolkit/README.md, fila/*.json) citam caminhos de outra máquina do tipo /private/tmp/.../scratchpad/cidades — troque esse prefixo por ${C}. O toolkit roda com: python3 ${C}/toolkit/legislacao.py ... e python3 ${C}/toolkit/diarios_consolidados.py ...`
const SAIDA = `SAÍDA POR CIDADE (grave ao terminar cada uma; se ${C}/res/<ibge>.json já existir, PULE a cidade): ${C}/res/<ibge>.json = {ibge, nome, uf, status: "regra_com_ato"|"regra_sem_ato"|"pista"|"pontual"|"sem_restricao_declarada"|"confirmou_que_nao_tem"|"nao_achou", nivel_busca: "dirigida"|"media", fontes_consultadas:[{url, resultado}], data:"2026-10-11", observacoes, falha_de_fonte: true|false (true se as fontes principais estavam fora do ar/bloqueadas e o "nao_achou" não é conclusivo), osm_divergencias:[...], regras_rascunho:[regras no formato de ${SCHEMA_TXT}, sem geometria, com vias/limites em texto; "status":"ativa" SÓ com ato primário vigente com número, artigo e URL lida por você; pista de OSM/notícia/penaestrada → "desativada" com motivo; suspensa/revogada registrada como tal]}. Siga o formato dos res/ existentes (ex.: ${C}/res/3201209.json). Atos baixados em ${C}/atos/<ibge>/ (só se úteis; PDFs grandes > 5 MB não grave).`
const REGRAS = `NÃO faça git commit/push e NÃO edite nada fora de ${C}/res, ${C}/verif e ${C}/atos. Não chame o Valhalla. Convenções obrigatórias: ${C}/CONVENCOES_IMPLEMENTACAO.md. Cota baixa de WebSearch: NO MÁXIMO 2 por agente — use curl direto nas fontes e as ferramentas do toolkit (WebFetch/WebSearch via ToolSearch "select:WebSearch,WebFetch" se precisar). Alguns sites dão 403/timeout pelo proxy desta máquina: registre como falha e tente fonte alternativa (Câmara, diário oficial, Querido Diário, diário consolidado). Não invente ato, artigo, URL nem horário. Divergência com OSM vira pendência, não correção. Português do Brasil. ${PATHS}`

const LOTE_RET = { type: 'object', properties: {
  lote: { type: 'string' },
  cidades: { type: 'array', items: { type: 'object', properties: { ibge: { type: 'string' }, nome: { type: 'string' }, status: { type: 'string' }, regras_ativas: { type: 'integer' }, regras_desativadas: { type: 'integer' }, falha_de_fonte: { type: 'boolean' }, resumo: { type: 'string' } }, required: ['ibge', 'nome', 'status', 'regras_ativas', 'regras_desativadas', 'resumo'] } },
  aprendizados: { type: 'array', items: { type: 'string' } },
  pendencias: { type: 'array', items: { type: 'string' } },
}, required: ['lote', 'cidades', 'aprendizados', 'pendencias'] }
const VER = { type: 'object', properties: {
  lote: { type: 'string' },
  cidades: { type: 'array', items: { type: 'object', properties: { ibge: { type: 'string' }, nome: { type: 'string' }, veredito: { type: 'string', enum: ['confirmado', 'corrigido', 'refutado', 'inverificavel'] }, regras_ativas_final: { type: 'integer' }, nota: { type: 'string' } }, required: ['ibge', 'veredito', 'regras_ativas_final', 'nota'] } },
}, required: ['lote', 'cidades'] }

const verificar = (id, cidades, phaseName) => {
  if (!cidades.length) return Promise.resolve(null)
  return agent(`Você é um verificador CÉTICO e independente das regras municipais de circulação de caminhões. Para cada cidade abaixo, leia ${C}/res/<ibge>.json, abra o ATO OFICIAL de cada regra com status "ativa" e confira número, artigo, vigência (alteração/revogação posterior), dias, horários, veículos afetados, exceções e VUC local. Na dúvida, rebaixe para "desativada" com motivo. Veja o formato dos verificadores anteriores em ${C}/verif/ (ex.: ${C}/verif/3167202.json). Grave ${C}/verif/<ibge>.json ({ibge, veredito, data:"2026-10-11", regras:[{id, veredito, correcao, nota}]}) e, se corrigir ou rebaixar, ATUALIZE o res/<ibge>.json (registre "verificado em 2026-10-11: ..." em observacoes). Se o ato não puder ser aberto daqui (site bloqueado), tente fontes alternativas (Câmara, diário oficial, Querido Diário, leisMunicipais via busca); se ainda assim não der, veredito "inverificavel" e mantenha a regra como está, explicando na nota. ${REGRAS}\n\nCIDADES DO LOTE ${id}:\n${JSON.stringify(cidades)}`,
    { label: `verifica:${id}`, phase: phaseName, schema: VER })
}

// Fase A: verificação pendente (corre em paralelo com as ondas)
phase('Verificação pendente')
const pend = pipeline(args.verifLotes, (l) => verificar(l.id, l.cidades, 'Verificação pendente'))

// Fase B/C: ondas + verificação das novas
phase('Ondas')
const ondas = pipeline(
  args.filaLotes,
  (id) => agent(`Você pesquisa as REGRAS MUNICIPAIS DE CIRCULAÇÃO DE CAMINHÕES das cidades do lote ${id}, descrito em ${C}/fila/${id}.json (foco do lote e, por cidade, as PISTAS já levantadas na preparação: penaestrada, Querido Diário, diários consolidados, OSM, sistema de legislação). Leia ANTES ${C}/GUIA.md, ${C}/toolkit/README.md e ${SCHEMA_TXT}; use as ferramentas (não refaça a descoberta de fontes nem a preparação). Para cada cidade: com pista, siga-a até o ato oficial e leia o texto; sem pista, faça a verificação rápida no portal de legislação/Câmara/diário via toolkit com os termos-chave (no máximo ~8 consultas por cidade). Cidade pequena sem nada → "nao_achou" registrando exatamente o que foi consultado.\n${SAIDA}\n${REGRAS}\nNo retorno, liste APRENDIZADOS úteis e pendências.`,
    { label: `onda:${id}`, phase: 'Ondas', schema: LOTE_RET, model: 'sonnet', effort: 'medium' }),
  (r, id) => {
    const com = ((r && r.cidades) || []).filter((c) => c.regras_ativas > 0).map((c) => ({ ibge: c.ibge, nome: c.nome, regras_ativas: c.regras_ativas, resumo: c.resumo }))
    return verificar(id, com, 'Verificação nova').then((v) => ({ lote: id, pesquisa: r, verificacao: v }))
  },
)

const [a, b] = await Promise.all([pend, ondas])
return { verificacao_pendente: a.filter(Boolean), ondas: b.filter(Boolean) }
