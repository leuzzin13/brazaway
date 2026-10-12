import Anthropic from '@anthropic-ai/sdk';

/**
 * Cliente de LLM da Frota (Second Brain e Mentor).
 *
 * A API da Anthropic é chamada pelo SDK oficial (@anthropic-ai/sdk). O resto do código depende só da interface
 * `LlmClient`, para que os testes injetem um cliente falso (sem ANTHROPIC_API_KEY) que devolve tool_use roteirizado.
 *
 * Modelos (ids exatos, sem sufixo de data):
 *  - resumos de viagem: claude-haiku-5-5 (pequeno e barato; a tarefa é reescrever fatos em poucas frases);
 *  - Mentor: claude-opus-5-5 (o mais capaz da linha corrente; tool use com várias consultas por pergunta).
 * Configuráveis por FROTA_SUMMARY_MODEL e FROTA_MENTOR_MODEL.
 */
export const DEFAULT_SUMMARY_MODEL = 'claude-haiku-5-5';
export const DEFAULT_MENTOR_MODEL = 'claude-opus-5-5';

export const summaryModel = () => process.env.FROTA_SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL;
export const mentorModel = () => process.env.FROTA_MENTOR_MODEL || DEFAULT_MENTOR_MODEL;

export type Block = Record<string, any> & { type: string };

export interface LlmRequest {
  model: string;
  max_tokens: number;
  /** blocos de texto do system prompt; o último leva cache_control quando `cache` é true */
  system: string;
  tools?: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  effort?: 'low' | 'medium' | 'high';
}

export interface LlmResponse {
  content: Block[];
  stop_reason: string | null;
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
}

export interface LlmClient {
  create(req: LlmRequest): Promise<LlmResponse>;
}

/** Cliente real. Retorna null sem credenciais (nem ANTHROPIC_API_KEY nem ANTHROPIC_AUTH_TOKEN). */
export function anthropicClientFromEnv(): LlmClient | null {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  const sdk = new Anthropic({ maxRetries: 2, timeout: 120_000 });
  return {
    async create(req) {
      // O prefixo (tools + system) é estável entre requisições: o breakpoint no system cacheia as duas partes.
      // Opus 5.5: o pensamento é sempre ligado (não enviamos `thinking`); `effort` controla a profundidade.
      const r = await sdk.messages.create({
        model: req.model,
        max_tokens: req.max_tokens,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        ...(req.tools?.length ? { tools: req.tools } : {}),
        messages: req.messages,
        output_config: { effort: req.effort ?? 'medium' },
      });
      return { content: r.content as unknown as Block[], stop_reason: r.stop_reason, model: r.model, usage: r.usage as LlmResponse['usage'] };
    },
  };
}

export const textOf = (content: Block[]) => content.filter((b) => b.type === 'text').map((b) => b.text as string).join('\n').trim();
