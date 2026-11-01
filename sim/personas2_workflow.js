export const meta = {
  name: 'brasaway-personas-2',
  description: 'Cria mais 50 personas de caminhoneiros (m51 a m100) para a simulação 2.0 do BrasaWay',
  phases: [{ title: 'Personas', detail: 'um agente por motorista' }],
}
const IDS = Array.from({ length: 50 }, (_, i) => `m${String(i + 51).padStart(2, '0')}`)
const PRESETS = ['utilitario', 'vuc', 'toco', 'truck', 'carreta_5e', 'carreta_6e', 'romeu_julieta', 'bitrem', 'rodotrem']
const SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' }, nome: { type: 'string' }, idade: { type: 'integer' }, anos_estrada: { type: 'integer' },
    uf_base: { type: 'string' }, perfil: { type: 'string' },
    vinculo: { type: 'string', enum: ['clt', 'autonomo'] },
    veiculo: { type: 'string', enum: PRESETS }, carga_perigosa: { type: 'boolean' },
    dias_trabalho: { type: 'array', items: { type: 'integer', minimum: 1, maximum: 7 }, minItems: 3, maxItems: 7 },
    linhas: { type: 'array', minItems: 2, maxItems: 4, items: { type: 'object', properties: {
      origem: { type: 'string' }, destino: { type: 'string' },
      vezes_por_semana: { type: 'integer', minimum: 1, maximum: 6 },
      hora_saida: { type: 'integer', minimum: 0, maximum: 23 },
      janela_entrega_ate: { type: ['number', 'null'] },
      motivo: { type: 'string' } }, required: ['origem', 'destino', 'vezes_por_semana', 'hora_saida', 'janela_entrega_ate'] } },
    conhecimento_regional: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 1 } },
    tolerancia_risco: { type: 'number', minimum: 0, maximum: 1 },
    adesao_app: { type: 'number', minimum: 0, maximum: 1 },
    usa_gps: { type: 'string', enum: ['waze', 'google_maps', 'nenhum', 'gps_caminhao'] },
    como_reage: { type: 'string' },
    fator_consumo: { type: 'number', minimum: 0.8, maximum: 1.25 },
    habito_abastecimento: { type: 'string', enum: ['posto_de_costume', 'mais_barato_que_conhece', 'cartao_da_empresa', 'onde_tiver_vaga'] },
  },
  required: ['id', 'nome', 'idade', 'anos_estrada', 'uf_base', 'perfil', 'vinculo', 'veiculo', 'carga_perigosa', 'dias_trabalho', 'linhas', 'conhecimento_regional', 'tolerancia_risco', 'adesao_app', 'usa_gps', 'como_reage', 'fator_consumo', 'habito_abastecimento'],
}
phase('Personas')
const res = await parallel(IDS.map((id) => () => agent(
`Você vai dar vida a UM caminhoneiro brasileiro para uma simulação de 60 dias de trabalho (setembro e outubro de 2026). Seu motorista é o ${id}.

Leia o arquivo /home/user/brazaway/sim/out/seeds.json: em "seeds" ache o item com id "${id}" (região, UFs de atuação, arquétipo e veículo sugerido) e em "locais" a lista de pontos de carga e entrega (id, nome, uf, tipo: "cd" = galpão/distrito fora do centro, "centro" = entrega em área central).

Crie a pessoa de forma realista e coerente com o arquétipo e a região:
- nome brasileiro, idade, anos de estrada, UF de base, perfil em 2 ou 3 frases (rotina, família, como trabalha).
- vínculo (clt ou autonomo) e o veículo (use o sugerido salvo se não fizer sentido); carga_perigosa só se o arquétipo for de produto perigoso.
- dias_trabalho: 1=segunda ... 7=domingo (ex.: [1,2,3,4,5] ou [1,2,3,4,5,6]).
- linhas: de 2 a 4 rotas que ele faz toda semana, usando SOMENTE ids da lista de locais, origem ≠ destino, coerentes com a região e o veículo (VUC/utilitário/toco: urbano e metropolitano; carreta/bitrem/rodotrem: CD, porto, distrito e rodovia, às vezes entrega em centro). Para cada uma: vezes_por_semana (rotas longas, acima de ~300 km, no máximo 2), hora_saida (hora cheia em que costuma sair; seja realista: muita gente sai entre 5h e 9h, distribuição urbana pega horário comercial), janela_entrega_ate (hora até a qual o cliente recebe, ex. 11 ou 16.5; null se não houver janela) e motivo curto. Inclua pelo menos uma entrega em local "centro" se o veículo for urbano.
- conhecimento_regional: para cada UF onde ele roda, 0 a 1, o quanto ele conhece de cabeça as regras de caminhão (horários, zonas, vias proibidas, viadutos baixos). Veterano local ~0,7–0,85; novato ~0,15–0,35; quem mudou de região: baixo na nova UF.
- tolerancia_risco: 0 a 1, o quanto aceita passar onde sabe que é proibido para ganhar tempo.
- adesao_app: 0 a 1, o quanto ele seguiria a rota de um app de caminhão como o BrasaWay se a empresa desse (desconfiado ~0,4–0,6; tecnológico ~0,9).
- usa_gps: o que ele usa hoje.
- como_reage: 2 frases sobre como reage a multa, a ordem do gestor e a mudança de horário.
- fator_consumo: 0,8 a 1,25 sobre o consumo típico do caminhão (1 = média; pé pesado, carga alta e serra gastam mais: 1,1 a 1,25; quem dirige econômico: 0,85 a 0,95).
- habito_abastecimento: onde ele costuma abastecer hoje (posto_de_costume, mais_barato_que_conhece, cartao_da_empresa ou onde_tiver_vaga).

Não invente locais fora da lista. Responda só com o objeto.`,
  { label: `persona:${id}`, phase: 'Personas', schema: SCHEMA })))
const ok = res.filter(Boolean)
log(`${ok.length} de 50 personas novas criadas`)
return ok