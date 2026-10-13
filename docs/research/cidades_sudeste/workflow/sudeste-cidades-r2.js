export const meta = {
  name: 'sudeste-cidades-r2',
  description: '2ª rodada (Sonnet) nas 280 cidades com falha_de_fonte na R1: refaz a busca de outra rede e verifica as regras ativas novas',
  phases: [
    { title: 'Rodada 2', detail: 'lotes de fila_r2.json', model: 'sonnet' },
    { title: 'Verificação', detail: 'regras ativas novas', model: 'sonnet' },
  ],
}

// args: { repo: '/caminho/absoluto/do/repo' }  (ex.: /Users/arthurleuzzi/Projetos/truck-router)
// opcional: args.lotes = ['R2-SP-01', ...] para rodar só alguns lotes
const R = args.repo
const C = `${R}/docs/research/cidades_sudeste`
const LOTES = args.lotes || ["R2-ES-01", "R2-ES-02", "R2-ES-03", "R2-MG-01", "R2-MG-02", "R2-MG-03", "R2-MG-04", "R2-MG-05", "R2-MG-06", "R2-MG-07", "R2-MG-08", "R2-MG-09", "R2-RJ-01", "R2-RJ-02", "R2-SP-01", "R2-SP-02", "R2-SP-03", "R2-SP-04", "R2-SP-05", "R2-SP-06", "R2-SP-07", "R2-SP-08", "R2-SP-09", "R2-SP-10", "R2-SP-11"]

const SCHEMA_TXT = `${R}/data/raw/municipios/schema.json (formato das regras) e ${R}/docs/layers/restricoes_municipais.md; exemplo pronto ${C}/res/3201209.json`
const REGRAS = `NÃO faça git commit/push e NÃO edite nada fora de ${C}/res, ${C}/verif e ${C}/atos. Não chame o Valhalla. Convenções obrigatórias: ${C}/CONVENCOES_IMPLEMENTACAO.md. Cota baixa de WebSearch: NO MÁXIMO 2 por agente — use curl direto nas fontes e o toolkit (python3 ${C}/toolkit/legislacao.py e python3 ${C}/toolkit/diarios_consolidados.py; WebFetch/WebSearch via ToolSearch "select:WebSearch,WebFetch"). Arquivos antigos (GUIA.md, toolkit/README.md) citam caminhos de outra máquina (/private/tmp/.../scratchpad/cidades): troque esse prefixo por ${C}. Não invente ato, artigo, URL nem horário. Divergência com OSM vira pendência. Português do Brasil.`

const LOTE_RET = { type: 'object', properties: {
  lote: { type: 'string' },
  cidades: { type: 'array', items: { type: 'object', properties: { ibge: { type: 'string' }, nome: { type: 'string' }, status_antes: { type: 'string' }, status: { type: 'string' }, regras_ativas: { type: 'integer' }, falha_de_fonte: { type: 'boolean' }, resumo: { type: 'string' } }, required: ['ibge', 'nome', 'status', 'regras_ativas', 'falha_de_fonte', 'resumo'] } },
  aprendizados: { type: 'array', items: { type: 'string' } },
}, required: ['lote', 'cidades', 'aprendizados'] }
const VER = { type: 'object', properties: {
  lote: { type: 'string' },
  cidades: { type: 'array', items: { type: 'object', properties: { ibge: { type: 'string' }, veredito: { type: 'string', enum: ['confirmado', 'corrigido', 'refutado', 'inverificavel'] }, regras_ativas_final: { type: 'integer' }, nota: { type: 'string' } }, required: ['ibge', 'veredito', 'regras_ativas_final', 'nota'] } },
}, required: ['lote', 'cidades'] }

phase('Rodada 2')
const res = await pipeline(
  LOTES,
  (id) => agent(`2ª RODADA da pesquisa das REGRAS MUNICIPAIS DE CIRCULAÇÃO DE CAMINHÕES. Lote ${id}, descrito em ${C}/fila_r2.json (procure o objeto com id "${id}"). Na 1ª rodada estas cidades ficaram com falha_de_fonte=true: o portal de legislação/Câmara/diário estava bloqueado (Cloudflare, reCAPTCHA, 403) ou fora do ar a partir da nuvem. Agora você roda de outra rede.

Para cada cidade: leia ${C}/res/<ibge>.json (o que já foi tentado e o que falhou em fontes_consultadas — NÃO repita o que funcionou e não achou nada; foque nas fontes que falharam) e ${C}/leads/portais.json (sistema e URLs). Leia antes ${C}/GUIA.md, ${C}/toolkit/README.md e ${SCHEMA_TXT}. Tente de novo as fontes que falharam; se continuarem bloqueadas, tente alternativas (Câmara × Prefeitura, diário oficial, Querido Diário, diário consolidado, leismunicipais, Wayback). No máximo ~10 consultas por cidade. Se uma ementa sugerir restrição a caminhões, ABRA o ato e leia o texto.

SAÍDA: REESCREVA ${C}/res/<ibge>.json mantendo o formato e acrescentando: fontes_consultadas novas (as antigas continuam, marque as novas com "rodada": "R2"), "rodada": "R2", data "<data de hoje>", falha_de_fonte atualizado (false se agora as fontes principais responderam), status e regras_rascunho revistos ("status":"ativa" SÓ com ato primário vigente com número, artigo e URL lida por você; pista → "desativada" com motivo). Registre em observacoes "R2: ...". Atos baixados em ${C}/atos/<ibge>/ (só se úteis; nada > 5 MB).
${REGRAS}
No retorno, informe o status antes e depois de cada cidade e os APRENDIZADOS (que fontes passaram a funcionar).`,
    { label: `r2:${id}`, phase: 'Rodada 2', schema: LOTE_RET, model: 'sonnet', effort: 'medium' }),
  (r, id) => {
    const com = ((r && r.cidades) || []).filter((c) => c.regras_ativas > 0).map((c) => ({ ibge: c.ibge, nome: c.nome, regras_ativas: c.regras_ativas, resumo: c.resumo }))
    if (!com.length) return { lote: id, pesquisa: r, verificacao: null }
    return agent(`Você é um verificador CÉTICO e independente das regras municipais de circulação de caminhões. Para cada cidade abaixo, leia ${C}/res/<ibge>.json, abra o ATO OFICIAL de cada regra com status "ativa" e confira número, artigo, vigência (alteração/revogação posterior), dias, horários, veículos afetados, exceções e VUC local. Na dúvida, rebaixe para "desativada" com motivo. Grave ${C}/verif/<ibge>.json ({ibge, nome, veredito, data, regras:[{id, veredito, correcao, nota}]}, formato de ${C}/verif/3167202.json) e, se corrigir ou rebaixar, ATUALIZE o res/<ibge>.json (registre "verificado na R2: ..." em observacoes). Se o ato não abrir, veredito "inverificavel" e explique. ${REGRAS}\n\nCIDADES DO LOTE ${id}:\n${JSON.stringify(com)}`,
      { label: `verifica:${id}`, phase: 'Verificação', schema: VER, model: 'sonnet' })
      .then((v) => ({ lote: id, pesquisa: r, verificacao: v }))
  },
)
const ok = res.filter(Boolean)
const cid = ok.flatMap((x) => (x.pesquisa && x.pesquisa.cidades) || [])
log(`R2: ${cid.length} cidades; ainda com falha_de_fonte: ${cid.filter((c) => c.falha_de_fonte).length}; com regra ativa: ${cid.filter((c) => c.regras_ativas > 0).length}`)
return { lotes: ok.length, de: LOTES.length, resultados: ok }
