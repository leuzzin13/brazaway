export const meta = {
  name: 'brasaway-equipe-semana-3',
  description: 'Simulação 3.0: equipe interna das três transportadoras (A com BrasaWay, A+ com as novidades, B sem) lê o relatório da semana e decide',
  phases: [{ title: 'Análise', detail: 'roteirista e financeiro de cada empresa' }, { title: 'Decisão', detail: 'gerente de operações de cada empresa' }],
}
const N = args.semana
const BASE = args.base || '/home/user/brazaway/sim/out3'
const TOTAL = args.total || 13
const EMPRESAS = [
  { g: 'com', nome: 'Transportadora A (usa o BrasaWay: painel com rotas legais, restrições evitadas, avisos antes da saída com o horário liberado, janelas de entrega que não cabem na viagem, alerta ao vivo quando o motorista sai da rota, multas registradas no app com a caixa "feedback enviado?", plano de abastecimento e preço pago contra a média da rota). As multas chegam pelo correio (~3 semanas; às vezes atrasam ou se perdem) e a indicação do condutor é com a equipe: o relatório lista as multas_para_indicar com o prazo.' },
  { g: 'mais', nome: `Transportadora A+ (usa o BrasaWay com tudo o que a A tem e mais três novidades:
  1) Trechos bloqueados: a equipe trava um trecho para a frota inteira (os "sem alternativa razoável" e os que geram multa aparecem em problemas_conhecidos com o id do item e bloqueavel=true); a rota de todos os motoristas passa a desviar dele se existir qualquer caminho (custa alguns km a mais, em trechos_bloqueados você vê quantas viagens desviaram e quantos km a mais).
  2) Conferência do diesel: o painel compara, por placa e por motorista, os litros esperados pelo km com os litros comprados e aponta compra fora do plano de abastecimento e sobrepreço (bloco conciliacao_diesel: consumo_acima pode ser desvio de diesel ou consumo fora do normal; fora_do_plano é abastecimento fora das paradas do plano e da rede conveniada).
  3) Prazos das multas: o sistema indica o condutor sozinho até 2 dias depois da notificação (não precisa listar), mostra prazos e NIC, e o painel recomenda aderir ao SNE (Sistema de Notificação Eletrônica): a notificação chega pelo app, sem atraso nem extravio, e a multa sem recurso sai com 40% de desconto em vez de 20%.)` },
  { g: 'sem', nome: 'Transportadora B (sem sistema: planilha, WhatsApp e o GPS de celular de cada motorista; só sabe das multas quando a notificação chega pelo correio, ~3 semanas depois e às vezes atrasada ou extraviada, ou quando o motorista conta que foi parado; cada um abastece no posto de costume; a indicação do condutor é com a equipe: o relatório lista as multas_para_indicar com o prazo).' },
]
const ACAO = {
  orientar: '- {"acao":"orientar","motoristas":["m07"] ou ["todos"],"itens":["<item de problemas_conhecidos>"]}  (avisar sobre uma restrição específica; o motorista orientado passa a desviar dela quando puder)',
  mudar_horario: '- {"acao":"mudar_horario","motorista":"m07","linha":0,"hora":10}',
  trocar_veiculo: '- {"acao":"trocar_veiculo","motorista":"m07","preset":"vuc"}  (presets: utilitario, vuc, toco, truck, carreta_5e, carreta_6e, romeu_julieta, bitrem, rodotrem; veículo menor = mais viagens para a mesma carga)',
  cadastrar_aetc: '- {"acao":"cadastrar_aetc","motorista":"m07"}  (Autorização Especial de Trânsito de Caminhão da Prefeitura de SP: só vale para VUC, que com ela fica liberado da ZMRC e do rodízio; sem ela VUC é tratado como caminhão comum. Leva a semana para sair.)',
  advertir: '- {"acao":"advertir","motorista":"m07"}',
  exigir_app: '- {"acao":"exigir_app","motorista":"m07"}  (cobra o uso da rota do app)',
  treinamento: '- {"acao":"treinamento","motoristas":["m07"] ou ["todos"]}  (R$ 250 por motorista)',
  recorrer_multas: '- {"acao":"recorrer_multas"}  (recorre das multas notificadas; R$ 60 por recurso, ~15% são canceladas; multa com recurso perde o desconto de 40% do SNE)',
  suspender_linha: '- {"acao":"suspender_linha","motorista":"m07","linha":1,"motivo":"..."} / {"acao":"reativar_linha","motorista":"m07","linha":1}',
  feedback: '- {"acao":"feedback","multas":["<mid de multas_sem_feedback>"],"nota":"..."} ou {"acao":"feedback","motorista":"m07","nota":"..."}  (conversa com o motorista sobre a multa: ele passa a conhecer o trecho e arrisca menos)',
  renegociar_janela: '- {"acao":"renegociar_janela","motorista":"m07","linha":1,"ate":12}  (pede ao cliente para receber até outra hora; cerca de 60% aceitam)',
  convenio_pix: '- {"acao":"convenio_pix","desconto_rs_l":0.25,"quantos":15}  (negocia desconto por litro pago no PIX com os postos mais usados pelo plano do app, listados em postos_mais_usados; até R$ 0,20 ~70% aceitam, até R$ 0,30 ~50%, acima ~25%; o plano passa a preferir esses postos)',
  indicar_condutor: '- {"acao":"indicar_condutor","multas":["<mid de multas_para_indicar>", "..."]}  (indica quem dirigia; liste cada multa pelo mid. Sem indicação até o prazo, a empresa paga a NIC: o valor da multa × o número de multas iguais em 12 meses. Indicada, os pontos vão para a CNH do motorista)',
  indicar_condutor_mais: '- {"acao":"indicar_condutor","multas":["<mid>"]}  (o sistema já indica sozinho até 2 dias depois da notificação; use só se ver alguma parada)',
  cobrar_abastecimento: '- {"acao":"cobrar_abastecimento","motoristas":["m07"] ou ["todos"],"nota":"..."}  (cobra o motorista sobre onde e quanto abastece: pelo nome tem muito mais efeito do que a cobrança geral, mas é uma conversa do gerente: no máximo 5 motoristas pelo nome por semana, somando as ações da semana)',
  aderir_sne: '- {"acao":"aderir_sne"}  (adesão da empresa ao SNE, o Sistema de Notificação Eletrônica do Denatran: a notificação chega sem atraso nem extravio e a multa sem recurso sai com 40% de desconto em vez de 20%; vale para as infrações a partir da adesão)',
  bloquear_trecho: '- {"acao":"bloquear_trecho","itens":["<item de problemas_conhecidos com bloqueavel=true>"],"motivo":"..."}  (trava o trecho para a frota inteira: a rota de todos desvia dele se existir caminho; só trecho de camada, "layer:...", não zona) / {"acao":"desbloquear_trecho","itens":["<item de trechos_bloqueados>"]}',
  nenhuma: '- {"acao":"nenhuma"}',
}
const LISTA = {
  com: ['orientar', 'mudar_horario', 'trocar_veiculo', 'cadastrar_aetc', 'advertir', 'exigir_app', 'treinamento', 'recorrer_multas', 'suspender_linha', 'feedback', 'renegociar_janela', 'convenio_pix', 'indicar_condutor', 'cobrar_abastecimento', 'aderir_sne', 'nenhuma'],
  mais: ['orientar', 'bloquear_trecho', 'mudar_horario', 'trocar_veiculo', 'cadastrar_aetc', 'advertir', 'exigir_app', 'treinamento', 'recorrer_multas', 'suspender_linha', 'feedback', 'renegociar_janela', 'convenio_pix', 'cobrar_abastecimento', 'aderir_sne', 'indicar_condutor_mais', 'nenhuma'],
  sem: ['orientar', 'mudar_horario', 'trocar_veiculo', 'cadastrar_aetc', 'advertir', 'treinamento', 'recorrer_multas', 'suspender_linha', 'feedback', 'renegociar_janela', 'indicar_condutor', 'cobrar_abastecimento', 'aderir_sne', 'nenhuma'],
}
const acoes = (g) => `Ações possíveis (use só estas, com os campos indicados; motorista = id tipo "m07"; linha = índice i da linha do motorista no relatório):\n${LISTA[g].map((k) => ACAO[k]).join('\n')}`
const PAPEIS = {
  roteirista: 'Você é a Patrícia, roteirista/programadora de tráfego há 12 anos. Monta a programação diária, conhece as dores dos motoristas e odeia retrabalho.',
  financeiro: 'Você é o Ricardo, do financeiro e segurança (SSMA). Paga as multas, cuida dos prazos de indicação do condutor, da pontuação das CNHs, do seguro, do diesel e dos custos; é cético com gasto novo.',
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
const LEITURA = {
  com: 'totais, diesel comprado e preço pago, diesel esperado pelo km, multas notificadas e as sem feedback com o mid, multas_para_indicar com o prazo, NIC pagas, por motorista, pontos de CNH, problemas conhecidos com o id do item, as linhas de cada motorista com horário e janela de entrega e, quando houver, janelas que não cabem na viagem',
  mais: 'totais, diesel comprado e preço pago, diesel esperado pelo km, conciliacao_diesel (conferência do diesel por placa e motorista), trechos_bloqueados, multas notificadas e as sem feedback com o mid, NIC, sne (com a recomendação do painel), por motorista, pontos de CNH, problemas conhecidos com o id do item e se dá para bloquear, as linhas de cada motorista com horário e janela de entrega e, quando houver, janelas que não cabem na viagem',
  sem: 'totais, diesel comprado e preço pago, diesel esperado pelo km, multas notificadas com o mid, multas_para_indicar com o prazo, NIC pagas, por motorista, pontos de CNH, os problemas que os motoristas contaram e as linhas de cada motorista com horário e janela de entrega',
}
const contexto = (e) => `Simulação de operação real, semana ${N} de ${TOTAL} (setembro a novembro de 2026). Você trabalha na ${e.nome}
Leia o relatório desta semana em ${BASE}/relatorios/semana_${N}_${e.g}.json (${LEITURA[e.g]}).
${N > 1 ? `As decisões das semanas anteriores estão em ${BASE}/decisoes/semana_<n>_${e.g}.json; leia só as das últimas 2 semanas (n = ${Math.max(1, N - 2)} a ${N - 1}), cada uma com o resultado (_aplicada, _resultado) do que foi aplicado, e só volte mais se precisar de um fato específico.` : ''}
As personas dos motoristas estão em ${BASE}/personas.json (perfil e como cada um reage). Trabalhe só com o que a sua empresa enxerga no relatório; não abra os arquivos das outras empresas, a pasta ${BASE}/verdade, os bastidores da simulação (${BASE}/estado.json, resultado.json, cache_rotas.json, frota_info.json, falhas_*.json e os logs *.txt) nem o código da simulação (sim/*.py, sim/*.sh, sim/*.js). Seja objetivo: leia as partes que importam com jq ou python (não imprima o arquivo inteiro) e não repita a mesma leitura.`

const res = await parallel(EMPRESAS.map((e) => async () => {
  const [rot, fin] = await parallel(['roteirista', 'financeiro'].map((p) => () => agent(
    `${PAPEIS[p]}\n\n${contexto(e)}\n\nFaça a sua leitura da semana em 3 a 5 frases e dê até 5 sugestões concretas ao gerente (quem, o quê, por quê, quanto custa). Seja realista: nada de solução mágica.`,
    { label: `${p}:${e.g}:s${N}`, phase: 'Análise', schema: SUG, effort: 'medium' })))
  const dec = await agent(
    `${PAPEIS.gerente}\n\n${contexto(e)}\n\nSugestões da equipe:\nPatrícia (roteirista): ${JSON.stringify(rot)}\nRicardo (financeiro/SSMA): ${JSON.stringify(fin)}\n\nA equipe já leu o relatório: parta das sugestões e abra os arquivos só para conferir ids, linhas, horários e mids das ações que vai tomar. Decida o que muda a partir de segunda. ${acoes(e.g)}\nDepois escreva a mensagem que vai para todos os motoristas (curta, no tom de um gerente de transportadora) e uma justificativa de 2 a 4 frases. Não exagere: mudar demais desorganiza a operação.`,
    { label: `gerente:${e.g}:s${N}`, phase: 'Decisão', schema: DEC, effort: 'medium' })
  return { g: e.g, semana: N, roteirista: rot, financeiro: fin, ...(dec || { acoes: [], mensagem_aos_motoristas: '', justificativa: 'sem resposta' }) }
}))
return res.filter(Boolean)
