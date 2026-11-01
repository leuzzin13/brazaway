export const meta = {
  name: 'brasaway-equipe-semana-2',
  description: 'Simulação 2.0: equipe interna das duas transportadoras lê o relatório da semana e decide',
  phases: [{ title: 'Análise', detail: 'roteirista e financeiro de cada empresa' }, { title: 'Decisão', detail: 'gerente de operações de cada empresa' }],
}
const N = args.semana
const BASE = args.base || '/home/user/brazaway/sim/out2'
const TOTAL = args.total || 13
const EMPRESAS = [
  { g: 'com', nome: 'Transportadora A (usa o BrasaWay: painel com rotas legais, restrições evitadas, avisos antes da saída com o horário liberado, janelas de entrega que não cabem na viagem, alerta ao vivo quando o motorista sai da rota, multas registradas no app com a caixa "feedback enviado?", plano de abastecimento e preço pago contra a média da rota)' },
  { g: 'sem', nome: 'Transportadora B (sem sistema: planilha, WhatsApp e o GPS de celular de cada motorista; só sabe das multas quando a notificação chega pelo correio, ~3 semanas depois, ou quando o motorista conta que foi parado; cada um abastece no posto de costume)' },
]
const ACOES = `Ações possíveis (use só estas, com os campos indicados; motorista = id tipo "m07"; linha = índice i da linha do motorista no relatório):
- {"acao":"orientar","motoristas":["m07"] ou ["todos"],"itens":["<item de problemas_conhecidos>"]}  (avisar sobre uma restrição específica)
- {"acao":"mudar_horario","motorista":"m07","linha":0,"hora":10}
- {"acao":"trocar_veiculo","motorista":"m07","preset":"vuc"}  (presets: utilitario, vuc, toco, truck, carreta_5e, carreta_6e, romeu_julieta, bitrem, rodotrem; veículo menor = mais viagens para a mesma carga)
- {"acao":"cadastrar_aetc","motorista":"m07"}  (Autorização Especial de Trânsito de Caminhão da Prefeitura de SP: só vale para VUC, que com ela fica liberado da ZMRC e do rodízio; sem ela VUC é tratado como caminhão comum. Leva a semana para sair.)
- {"acao":"advertir","motorista":"m07"}
- {"acao":"exigir_app","motorista":"m07"}  (só na Transportadora A)
- {"acao":"treinamento","motoristas":["m07"] ou ["todos"]}  (R$ 250 por motorista)
- {"acao":"recorrer_multas"}  (recorre das multas notificadas; R$ 60 por recurso, ~15% são canceladas)
- {"acao":"suspender_linha","motorista":"m07","linha":1,"motivo":"..."} / {"acao":"reativar_linha","motorista":"m07","linha":1}
- {"acao":"feedback","multas":["<mid de multas_sem_feedback>"],"nota":"..."} ou {"acao":"feedback","motorista":"m07","nota":"..."}  (conversa com o motorista sobre a multa: ele passa a conhecer o trecho e arrisca menos)
- {"acao":"renegociar_janela","motorista":"m07","linha":1,"ate":12}  (pede ao cliente para receber até outra hora; cerca de 60% aceitam)
- {"acao":"nenhuma"}`
const PAPEIS = {
  roteirista: 'Você é a Patrícia, roteirista/programadora de tráfego há 12 anos. Monta a programação diária, conhece as dores dos motoristas e odeia retrabalho.',
  financeiro: 'Você é o Ricardo, do financeiro e segurança (SSMA). Paga as multas, cuida da pontuação das CNHs, do seguro e dos custos; é cético com gasto novo.',
  gerente: 'Você é o Marcos, gerente de operações. Decide o que muda na semana que vem e fala com os motoristas. Precisa cumprir as janelas dos clientes sem estourar custo.',
}
const SUG = { type: 'object', properties: { leitura: { type: 'string' }, sugestoes: { type: 'array', items: { type: 'string' } } }, required: ['leitura', 'sugestoes'] }
const DEC = {
  type: 'object',
  properties: {
    acoes: { type: 'array', items: { type: 'object' }, maxItems: 25 },
    mensagem_aos_motoristas: { type: 'string' },
    justificativa: { type: 'string' },
  },
  required: ['acoes', 'mensagem_aos_motoristas', 'justificativa'],
}
const contexto = (e) => `Simulação de operação real, semana ${N} de ${TOTAL} (setembro a novembro de 2026). Você trabalha na ${e.nome}.
Leia o relatório desta semana em ${BASE}/relatorios/semana_${N}_${e.g}.json (totais, diesel comprado e preço pago, multas notificadas e as sem feedback com o mid, por motorista, pontos de CNH, problemas conhecidos com o id do item, as linhas de cada motorista com horário e janela de entrega e, quando houver, janelas que não cabem na viagem).
${N > 1 ? `As decisões das semanas anteriores estão em ${BASE}/decisoes/semana_<n>_${e.g}.json (n = 1 a ${N - 1}); veja o que já foi feito antes de repetir.` : ''}
As personas dos motoristas estão em ${BASE}/personas.json (perfil e como cada um reage). Trabalhe só com o que a sua empresa enxerga no relatório.`

const res = await parallel(EMPRESAS.map((e) => async () => {
  const [rot, fin] = await parallel(['roteirista', 'financeiro'].map((p) => () => agent(
    `${PAPEIS[p]}\n\n${contexto(e)}\n\nFaça a sua leitura da semana em 3 a 5 frases e dê até 5 sugestões concretas ao gerente (quem, o quê, por quê, quanto custa). Seja realista: nada de solução mágica.`,
    { label: `${p}:${e.g}:s${N}`, phase: 'Análise', schema: SUG })))
  const dec = await agent(
    `${PAPEIS.gerente}\n\n${contexto(e)}\n\nSugestões da equipe:\nPatrícia (roteirista): ${JSON.stringify(rot)}\nRicardo (financeiro/SSMA): ${JSON.stringify(fin)}\n\nDecida o que muda a partir de segunda. ${ACOES}\nDepois escreva a mensagem que vai para todos os motoristas (curta, no tom de um gerente de transportadora) e uma justificativa de 2 a 4 frases. Não exagere: mudar demais desorganiza a operação.`,
    { label: `gerente:${e.g}:s${N}`, phase: 'Decisão', schema: DEC })
  return { g: e.g, semana: N, roteirista: rot, financeiro: fin, ...(dec || { acoes: [], mensagem_aos_motoristas: '', justificativa: 'sem resposta' }) }
}))
return res.filter(Boolean)
