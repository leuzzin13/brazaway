import { Agent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new Agent({ connectTimeout: 10_000, headersTimeout: 60_000, bodyTimeout: 60_000 }));
import Fastify from 'fastify';
import { frotaBrainMentorRoutes } from './mentor.js';
import { anthropicClientFromEnv, type LlmClient, type LlmRequest, type LlmResponse } from './llm.js';

/**
 * Servidor de desenvolvimento/teste SÓ com o plugin do Second Brain + Mentor (porta BRAIN_PORT, padrão 3200).
 *   npx tsx src/frota/dev_server_brain.ts
 *
 * Com FROTA_FAKE_LLM=1 usa um cliente Anthropic FALSO (sem chave): o teste roteiriza as respostas (tool_use, texto) por
 * POST /__test/llm_script e lê o que o Mentor enviou ao "modelo" em GET /__test/llm_calls. Esses endpoints existem
 * apenas nesse modo. Sem FROTA_FAKE_LLM, usa o cliente real (ANTHROPIC_API_KEY) ou responde 503 no chat.
 */

type Scripted = { content: LlmResponse['content']; stop_reason?: string; usage?: Partial<LlmResponse['usage']> };

const fake = process.env.FROTA_FAKE_LLM === '1';
let script: Scripted[] = [];
const calls: LlmRequest[] = [];
const summaryCalls: LlmRequest[] = [];
let summaryMode: 'fatos' | 'fake' = 'fatos';

const fakeMentor: LlmClient = {
  async create(req) {
    calls.push(JSON.parse(JSON.stringify(req)));
    const next = script.shift() ?? { content: [{ type: 'text', text: '(sem roteiro para esta chamada)' }] };
    return {
      content: next.content, stop_reason: next.stop_reason ?? (next.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
      model: req.model, usage: { input_tokens: 1000, output_tokens: 100, ...next.usage },
    };
  },
};
const fakeSummary: LlmClient = {
  async create(req) {
    summaryCalls.push(JSON.parse(JSON.stringify(req)));
    const first = String((req.messages[0] as any).content).split('\n')[1] ?? '';
    return { content: [{ type: 'text', text: `RESUMO-FAKE: ${first}` }], stop_reason: 'end_turn', model: req.model, usage: { input_tokens: 10, output_tokens: 10 } };
  },
};

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } });
app.setErrorHandler((err: any, _req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) app.log.error(err);
  reply.code(status).send({ error: status >= 500 ? 'INTERNAL' : 'ERROR', message: err.message });
});
app.get('/__health', async () => ({ ok: true, fake }));

if (fake) {
  app.post('/__test/llm_script', async (req) => { script = ((req.body as any)?.responses ?? []) as Scripted[]; return { queued: script.length }; });
  app.get('/__test/llm_calls', async () => ({ calls, summary_calls: summaryCalls, remaining: script.length }));
  app.delete('/__test/llm_calls', async () => { calls.length = 0; summaryCalls.length = 0; script = []; return { ok: true }; });
  app.post('/__test/summary_mode', async (req) => { summaryMode = (req.body as any)?.mode === 'fake' ? 'fake' : 'fatos'; return { summaryMode }; });
}

await app.register(frotaBrainMentorRoutes, fake
  ? { mentorLlm: fakeMentor, summaryLlm: () => (summaryMode === 'fake' ? fakeSummary : null) }
  : { mentorLlm: anthropicClientFromEnv() });
await app.listen({ port: Number(process.env.BRAIN_PORT ?? 3200), host: '127.0.0.1' });
