import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { computeRoute } from '../services/routing.js';
import { claimsOf, httpError, withRls, type Claims } from './auth.js';
import { brainRoutes, pickEmbedder, type BrainOptions, type Embedder } from './brain.js';
import { anthropicClientFromEnv, mentorModel, textOf, type Block, type LlmClient } from './llm.js';
import { executeAction, runTool, TOOL_DEFS, type ToolCtx } from './mentor_tools.js';

/**
 * Mentor de Logística: agente (Claude, tool use) que responde ao gestor com base nos dados da própria empresa.
 * Leituras executam direto (SQL fixo, com a RLS do gestor); ações só viram PROPOSTA em agent_actions e executam depois
 * da confirmação explícita (POST .../actions/:id/confirm). Veja docs/frota/README.md, seção "Mentor de Logística".
 */

const TZ = 'America/Sao_Paulo';
const MAX_TURNS = 10;            // chamadas ao modelo por pergunta (cada tool_use consome uma)
const MAX_HISTORY_ROWS = 120;    // linhas de agent_messages por conversa (não truncamos o histórico: veja nota abaixo)
const MAX_OUTPUT_TOKENS = 8000;

/**
 * O prefixo (tools + system) é fixo entre requisições para o cache de prompt funcionar: data e hora vão num bloco no
 * início de cada mensagem do usuário (gravado junto com ela), nunca aqui.
 * O histórico é reenviado COMPLETO e sem edição: o Opus 5.5 liga o pensamento sempre e os blocos de pensamento ficam
 * presos à conversa (editar ou cortar turnos antigos invalida o histórico). Por isso há um teto de mensagens por conversa.
 */
export const MENTOR_SYSTEM = `Você é o Mentor de Logística: especialista em operação de transporte rodoviário de cargas no Brasil (roteirização de caminhões, restrições de circulação urbana, jornada do motorista, janelas de entrega, custo por km, manutenção, indicadores de nível de serviço) que apoia o gestor de uma transportadora.

Como trabalhar
- Responda SOMENTE com base nos dados da empresa obtidos pelas ferramentas. Antes de afirmar qualquer número, nome, placa ou fato da operação, consulte a ferramenta adequada. Se a ferramenta não trouxer dado, diga claramente que não há dado para aquilo (e o período consultado); nunca invente nem estime sem avisar.
- Conhecimento geral de logística e da legislação brasileira pode embasar explicações e sugestões, mas separe com clareza o que é dado da empresa do que é orientação geral. Não cite artigos de lei de memória como certeza: indique que deve ser conferido.
- Use o período que o gestor pedir; se ele não disse, use o padrão da ferramenta (últimos 30 dias) e diga qual período usou. Datas e horas estão no fuso de Brasília.
- Para perguntas de "por quê" ou de histórico, combine os números (kpi_*) com a busca no Second Brain (buscar_conhecimento) e com o historico_viagem.
- Prefira consultas objetivas: poucas chamadas, parâmetros precisos. Chame ferramentas independentes ao mesmo tempo.

Ações (criar viagem, atribuir, enviar mensagem, reordenar entregas)
- As ferramentas propor_* NÃO executam nada: elas registram uma PROPOSTA que o gestor precisa confirmar. Depois de propor, diga ao gestor, em destaque, que a ação está pendente de confirmação, resuma o que será feito e informe o id da ação. Nunca diga que algo foi feito, enviado ou criado antes da confirmação.
- Antes de propor, use listar_cadastros para obter os ids corretos de motorista, veículo e viagem. Se houver ambiguidade (dois motoristas com o mesmo nome, por exemplo), pergunte em vez de escolher.
- Para criar viagem, o roteador respeita o veículo cadastrado (altura, peso, perfil); informe origem e destino com latitude e longitude. Se não tiver as coordenadas, peça-as ao gestor.
- Mensagens ao motorista: curtas, educadas e objetivas.

Sugestões de melhoria: dê em texto, fundamentadas nos dados consultados (o que foi observado, o impacto, o que fazer), e ofereça propor a ação correspondente quando houver uma.

Estilo: português do Brasil, direto e profissional, sem rodeios. Use listas curtas ou tabelas quando ajudarem a comparar números; sem excesso de formatação.`;

export interface MentorOptions extends BrainOptions {
  /** undefined = cliente real se houver ANTHROPIC_API_KEY (senão 503 no chat); null = indisponível; função = resolvido a cada chamada (testes) */
  mentorLlm?: LlmClient | null | (() => LlmClient | null);
  /** roteador interno (padrão: computeRoute de services/routing.ts) */
  route?: typeof computeRoute;
}

const ChatBody = z.object({ conversation_id: z.string().uuid().optional(), message: z.string().trim().min(1).max(4000) }).strict();
const Statuses = ['proposta', 'confirmada', 'rejeitada', 'executada', 'falhou'] as const;
const ActionsQuery = z.object({
  status: z.enum(Statuses).optional(), conversation_id: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
const IdParam = z.object({ id: z.string().uuid() });
const idOf = (req: { params: unknown }) => {
  const p = IdParam.safeParse(req.params);
  if (!p.success) throw httpError(422, 'id inválido');
  return p.data.id;
};

interface Me { user_id: string; company_id: string; role: string; display_name: string }

/** Autentica e exige equipe (owner/admin/gestor) ativa. Motorista, sem empresa ou desativado: 403. */
async function requireStaff(claims: Claims): Promise<Me> {
  if (claims.role !== 'authenticated') throw httpError(403, 'o Mentor atende apenas usuários da equipe (token de usuário)');
  const me = await withRls(claims, async (c) => (await c.query(
    `select user_id, company_id, role::text as role, display_name from app.my_membership()`)).rows[0] as Me | undefined);
  if (!me?.user_id) throw httpError(403, 'usuário sem acesso a nenhuma empresa ativa');
  if (!['owner', 'admin', 'gestor'].includes(me.role)) throw httpError(403, 'o Mentor é exclusivo da equipe (owner, admin e gestor)');
  return me;
}

const asService = <T>(fn: Parameters<typeof withRls<T>>[1]) => withRls<T>({ role: 'service_role' }, fn);

export async function frotaBrainMentorRoutes(app: FastifyInstance, opts: MentorOptions = {}) {
  const embedder: Embedder = opts.embedder ?? pickEmbedder();
  const realLlm = opts.mentorLlm === undefined ? anthropicClientFromEnv() : null;
  const resolveLlm = (): LlmClient | null => (typeof opts.mentorLlm === 'function' ? opts.mentorLlm() : opts.mentorLlm === undefined ? realLlm : opts.mentorLlm);
  const route = opts.route ?? computeRoute;
  const busy = new Set<string>();

  // Second Brain: POST /api/frota/jobs/brain
  await brainRoutes(app, { embedder, summaryLlm: opts.summaryLlm });

  // ------------------------------------------------------------------ POST /api/frota/mentor/chat
  app.post('/api/frota/mentor/chat', async (req, reply) => {
    const claims = await claimsOf(req);
    const me = await requireStaff(claims);
    const body = ChatBody.safeParse(req.body);
    if (!body.success) return reply.code(422).send({ error: 'VALIDATION', issues: body.error.issues });
    const llm = resolveLlm();
    if (!llm) return reply.code(503).send({ error: 'MENTOR_INDISPONIVEL', message: 'o Mentor precisa de ANTHROPIC_API_KEY configurada no servidor' });

    // conversa: existente (só do próprio gestor) ou nova. Gravação como service_role, SEMPRE com empresa/usuário do gestor.
    let convId = body.data.conversation_id;
    if (convId) {
      const c = await withRls(claims, async (db) => (await db.query(`select id, user_id from agent_conversations where id = $1`, [convId])).rows[0]);
      if (!c || c.user_id !== me.user_id) throw httpError(404, 'conversa não encontrada');
    } else {
      convId = (await asService((db) => db.query(
        `insert into agent_conversations (company_id, user_id, title) values ($1, $2, $3) returning id`,
        [me.company_id, me.user_id, body.data.message.slice(0, 80)]))).rows[0].id as string;
    }
    if (busy.has(convId)) throw httpError(409, 'esta conversa já está processando outra pergunta');
    busy.add(convId);
    try {
      const rows = (await asService((db) => db.query(`select role, content from agent_messages where conversation_id = $1 order by id`, [convId]))).rows;
      if (rows.length >= MAX_HISTORY_ROWS) throw httpError(409, 'conversa muito longa: inicie uma nova conversa (omita conversation_id)');
      const history: Anthropic.MessageParam[] = rows.map((r) => ({ role: r.role === 'assistant' ? 'assistant' : 'user', content: r.content }));

      const now = DateTime.now().setZone(TZ).setLocale('pt-BR');
      const userContent: Block[] = [
        { type: 'text', text: `[Data e hora agora: ${now.toFormat("cccc, dd/MM/yyyy HH:mm")} (horário de Brasília)]` },
        { type: 'text', text: body.data.message },
      ];
      const pending: { role: 'user' | 'assistant' | 'tool'; content: unknown; model?: string; input_tokens?: number; output_tokens?: number }[] = [{ role: 'user', content: userContent }];
      const messages: Anthropic.MessageParam[] = [...history, { role: 'user', content: userContent as Anthropic.ContentBlockParam[] }];

      const ctx: ToolCtx = { claims, userId: me.user_id, companyId: me.company_id, role: me.role, conversationId: convId, embedder, route };
      const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const toolCalls: { tool: string; is_error: boolean }[] = [];
      const proposed: { id: string; tool: string; resumo: string }[] = [];
      let reply_text = '';
      let finished = false;

      for (let turn = 0; turn < MAX_TURNS && !finished; turn++) {
        let r;
        try {
          r = await llm.create({ model: mentorModel(), max_tokens: MAX_OUTPUT_TOKENS, system: MENTOR_SYSTEM, tools: TOOL_DEFS, messages, effort: 'medium' });
        } catch (e: any) {
          req.log.error({ err: e?.message, status: e?.status }, 'mentor: falha na chamada ao modelo');
          const st = Number(e?.status);
          if (st === 429) throw httpError(429, 'limite de uso do modelo atingido; tente de novo em instantes');
          throw httpError(502, 'falha ao consultar o modelo de linguagem');
        }
        const u = r.usage;
        usage.input_tokens += u.input_tokens; usage.output_tokens += u.output_tokens;
        usage.cache_read_input_tokens += u.cache_read_input_tokens ?? 0; usage.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
        const toolUses = r.content.filter((b) => b.type === 'tool_use');

        if (r.stop_reason === 'tool_use' && toolUses.length) {
          pending.push({ role: 'assistant', content: r.content, model: r.model, input_tokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output_tokens: u.output_tokens });
          messages.push({ role: 'assistant', content: r.content as Anthropic.ContentBlockParam[] });
          // ferramentas independentes: executam juntas; os resultados voltam todos numa só mensagem, na ordem
          const results = await Promise.all(toolUses.map((b) => runTool(ctx, b.name, b.input)));
          const resultBlocks = toolUses.map((b, i) => {
            toolCalls.push({ tool: b.name, is_error: results[i].is_error });
            if (results[i].action) proposed.push(results[i].action!);
            return { type: 'tool_result', tool_use_id: b.id, content: results[i].content, ...(results[i].is_error ? { is_error: true } : {}) };
          });
          pending.push({ role: 'tool', content: resultBlocks });
          messages.push({ role: 'user', content: resultBlocks as Anthropic.ContentBlockParam[] });
          continue;
        }
        if (toolUses.length) throw httpError(502, `resposta do modelo interrompida (${r.stop_reason}); tente de novo com uma pergunta mais objetiva`);

        pending.push({ role: 'assistant', content: r.content, model: r.model, input_tokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output_tokens: u.output_tokens });
        reply_text = textOf(r.content);
        if (r.stop_reason === 'refusal') reply_text = reply_text || 'Não posso ajudar com esse pedido.';
        else if (r.stop_reason === 'max_tokens') reply_text += '\n\n(resposta cortada pelo limite de tamanho; peça para continuar)';
        finished = true;
      }
      if (!finished) throw httpError(502, 'o Mentor excedeu o limite de consultas para uma pergunta; refine a pergunta');

      // persiste a rodada inteira de uma vez (histórico nunca fica com tool_use sem tool_result)
      await asService(async (db) => {
        for (const m of pending) {
          await db.query(
            `insert into agent_messages (conversation_id, company_id, role, content, model, input_tokens, output_tokens) values ($1, $2, $3, $4::jsonb, $5, $6, $7)`,
            [convId, me.company_id, m.role, JSON.stringify(m.content), m.model ?? null, m.input_tokens ?? null, m.output_tokens ?? null]);
        }
        await db.query(`update agent_conversations set updated_at = now() where id = $1`, [convId]);
      });
      return {
        conversation_id: convId, reply: reply_text, actions_proposed: proposed, tool_calls: toolCalls,
        pending_confirmation: proposed.length > 0,
        usage: { ...usage, total_input_tokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens, model_calls: pending.filter((m) => m.role === 'assistant').length },
      };
    } finally { busy.delete(convId); }
  });

  // ------------------------------------------------------------------ conversas (leitura; a RLS limita ao próprio gestor, admin vê todas)
  app.get('/api/frota/mentor/conversations', async (req) => {
    const claims = await claimsOf(req);
    await requireStaff(claims);
    const rows = await withRls(claims, async (c) => (await c.query(
      `select id, title, user_id, created_at, updated_at from agent_conversations order by updated_at desc limit 100`)).rows);
    return { conversations: rows };
  });

  app.get('/api/frota/mentor/conversations/:id', async (req) => {
    const claims = await claimsOf(req);
    await requireStaff(claims);
    const id = idOf(req);
    return withRls(claims, async (c) => {
      const conv = (await c.query(`select id, title, user_id, created_at, updated_at from agent_conversations where id = $1`, [id])).rows[0];
      if (!conv) throw httpError(404, 'conversa não encontrada');
      const msgs = (await c.query(`select id, role, content, model, input_tokens, output_tokens, created_at from agent_messages where conversation_id = $1 order by id`, [id])).rows;
      // só o texto trocado com o gestor (sem blocos de ferramenta nem a linha de data)
      const visible = msgs.filter((m) => m.role !== 'tool').map((m) => ({
        id: m.id, role: m.role, created_at: m.created_at, model: m.model, input_tokens: m.input_tokens, output_tokens: m.output_tokens,
        text: (m.content as Block[]).filter((b) => b.type === 'text' && !String(b.text).startsWith('[Data e hora')).map((b) => b.text).join('\n'),
      })).filter((m) => m.text);
      return { conversation: conv, messages: visible };
    });
  });

  // ------------------------------------------------------------------ ações
  app.get('/api/frota/mentor/actions', async (req, reply) => {
    const claims = await claimsOf(req);
    await requireStaff(claims);
    const q = ActionsQuery.safeParse(req.query);
    if (!q.success) return reply.code(422).send({ error: 'VALIDATION', issues: q.error.issues });
    const rows = await withRls(claims, async (c) => (await c.query(
      `select id, conversation_id, tool, input - '_resumo' as input, input->>'_resumo' as resumo, requires_confirmation, status::text as status,
              requested_by, confirmed_by, confirmed_at, executed_at, result, error, created_at
         from agent_actions where ($1::text is null or status::text = $1) and ($2::uuid is null or conversation_id = $2)
        order by created_at desc limit $3`, [q.data.status ?? null, q.data.conversation_id ?? null, q.data.limit])).rows);
    return { actions: rows };
  });

  const loadAction = async (claims: Claims, id: string) => {
    // a RLS (staff da empresa) esconde ação de outra empresa: aparece como inexistente
    const a = await withRls(claims, async (c) => (await c.query(`select * from agent_actions where id = $1`, [id])).rows[0]);
    if (!a) throw httpError(404, 'ação não encontrada');
    return a;
  };
  const pub = (a: any) => { const { input, ...rest } = a; const { _resumo, ...args } = input ?? {}; return { ...rest, input: args, resumo: _resumo ?? null }; };

  app.post('/api/frota/mentor/actions/:id/confirm', async (req) => {
    const claims = await claimsOf(req);
    const me = await requireStaff(claims);
    const id = idOf(req);
    const a = await loadAction(claims, id);
    if (a.status !== 'proposta') throw httpError(409, `ação já está ${a.status}`);
    // confirma com a RLS do gestor (app.confirm_agent_action valida equipe e status 'proposta' com trava de linha)
    try {
      await withRls(claims, (c) => c.query(`select * from app.confirm_agent_action($1)`, [id]));
    } catch (e: any) {
      if (e?.statusCode === 403) throw httpError(409, 'ação não está mais pendente');
      throw e;
    }
    let outcome: { ok: boolean };
    try {
      const result = await executeAction({ claims, userId: me.user_id, companyId: me.company_id, route }, id, a.tool, a.input);
      await asService((c) => c.query(`update agent_actions set status = 'executada', executed_at = now(), result = $2::jsonb, error = null where id = $1`, [id, JSON.stringify(result)]));
      outcome = { ok: true };
    } catch (e: any) {
      const msg = String(e?.issues ? e.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ') : e?.message ?? e).slice(0, 800);
      req.log.warn({ action: id, tool: a.tool, err: msg }, 'mentor: ação confirmada falhou');
      await asService((c) => c.query(`update agent_actions set status = 'falhou', executed_at = now(), error = $2 where id = $1`, [id, msg]));
      outcome = { ok: false };
    }
    const done = await asService((c) => c.query(`select * from agent_actions where id = $1`, [id]));
    return { ok: outcome.ok, action: pub(done.rows[0]) };
  });

  app.post('/api/frota/mentor/actions/:id/reject', async (req) => {
    const claims = await claimsOf(req);
    await requireStaff(claims);
    const id = idOf(req);
    const a = await loadAction(claims, id);
    if (a.status !== 'proposta') throw httpError(409, `ação já está ${a.status}`);
    try {
      const r = await withRls(claims, (c) => c.query(`select * from app.reject_agent_action($1)`, [id]));
      return { ok: true, action: pub(r.rows[0]) };
    } catch (e: any) {
      if (e?.statusCode === 403) throw httpError(409, 'ação não está mais pendente');
      throw e;
    }
  });
}
