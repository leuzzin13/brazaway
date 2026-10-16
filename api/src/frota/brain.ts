import type { FastifyInstance } from 'fastify';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { pool } from '../db.js';
import { httpError, requireService } from './auth.js';
import { summaryModel, textOf, anthropicClientFromEnv, type LlmClient } from './llm.js';

/**
 * Second Brain da Frota: resumos factuais de viagem, documentos de entrega falha/atraso e de conversas do Mentor,
 * com embedding (pgvector, 1024 dimensões) para a busca semântica (app.search_knowledge). É RAG (busca + SQL), não
 * treino de modelo. Veja docs/frota/README.md, seção "Second Brain".
 */

export const EMBEDDING_DIM = 1024;
const TZ = 'America/Sao_Paulo';

export interface Queryable { query: (text: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }

// ------------------------------------------------------------------ embeddings

export type EmbedKind = 'document' | 'query';
export interface Embedder {
  /** gravado em knowledge_docs.embedding_model */
  readonly model: string;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

const STOPWORDS = new Set(['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'nas', 'nos', 'um', 'uma',
  'para', 'por', 'com', 'que', 'se', 'ao', 'aos', 'foi', 'ser', 'sao', 'mais', 'como']);

function fnv1a(s: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * Embedder local e determinístico para desenvolvimento e teste (sem rede, sem chave): hash de n-gramas (palavras,
 * pares de palavras e trigramas de caracteres, que absorvem plural e flexão) num vetor de 1024 posições com sinal,
 * normalizado (norma 1). Não tem semântica de verdade (sinônimos não aproximam); serve para exercitar o pipeline.
 */
export class LocalHashEmbedder implements Embedder {
  readonly model = 'local-hash-1024-v1';

  static tokens(text: string): string[] {
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  }

  vector(text: string): number[] {
    const v = new Array<number>(EMBEDDING_DIM).fill(0);
    const add = (feat: string, w: number) => {
      const h = fnv1a(feat, 0);
      v[h % EMBEDDING_DIM] += (fnv1a(feat, 0x9e3779b1) & 1 ? 1 : -1) * w;
    };
    const toks = LocalHashEmbedder.tokens(text).filter((t) => !STOPWORDS.has(t));
    for (let i = 0; i < toks.length; i++) {
      add('w:' + toks[i], 1);
      if (i + 1 < toks.length) add('b:' + toks[i] + '_' + toks[i + 1], 0.6);
      if (toks[i].length >= 4) {
        const p = `^${toks[i]}$`;
        for (let j = 0; j + 3 <= p.length; j++) add('c:' + p.slice(j, j + 3), 0.3);
      }
    }
    let n = 0;
    for (const x of v) n += x * x;
    if (n === 0) { v[0] = 1; return v; }   // vetor nulo não serve para distância de cosseno
    n = Math.sqrt(n);
    return v.map((x) => x / n);
  }

  async embed(texts: string[]): Promise<number[][]> { return texts.map((t) => this.vector(t)); }
}

/** Voyage AI (voyage-3.5, 1024 dimensões) via HTTP. VOYAGE_API_KEY obrigatória. */
export class VoyageEmbedder implements Embedder {
  readonly model: string;
  constructor(private apiKey: string, model = process.env.VOYAGE_MODEL || 'voyage-3.5', private url = 'https://api.voyageai.com/v1/embeddings') {
    this.model = model;
  }
  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 64) {
      const batch = texts.slice(i, i + 64).map((t) => t.slice(0, 20_000));
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ input: batch, model: this.model, input_type: kind, output_dimension: EMBEDDING_DIM, truncation: true }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Voyage ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      const j = (await res.json()) as { data: { embedding: number[]; index: number }[] };
      for (const d of [...j.data].sort((a, b) => a.index - b.index)) {
        if (d.embedding.length !== EMBEDDING_DIM) throw new Error(`Voyage devolveu ${d.embedding.length} dimensões (esperado ${EMBEDDING_DIM})`);
        out.push(d.embedding);
      }
    }
    return out;
  }
}

/** Voyage se houver VOYAGE_API_KEY (FROTA_EMBEDDER=local força o local); senão o embedder local. */
export function pickEmbedder(): Embedder {
  if (process.env.VOYAGE_API_KEY && process.env.FROTA_EMBEDDER !== 'local') return new VoyageEmbedder(process.env.VOYAGE_API_KEY);
  return new LocalHashEmbedder();
}

export const vectorLiteral = (v: number[]) => '[' + v.map((x) => Number(x.toPrecision(7))).join(',') + ']';

// ------------------------------------------------------------------ formatação

const dt = (ts: Date | string | null | undefined) => (ts ? DateTime.fromJSDate(new Date(ts)).setZone(TZ).toFormat('dd/MM/yyyy HH:mm') : null);
const hm = (ts: Date | string | null | undefined) => (ts ? DateTime.fromJSDate(new Date(ts)).setZone(TZ).toFormat('HH:mm') : null);
const km = (m: number | null | undefined) => (m == null ? null : (m / 1000).toFixed(1).replace('.', ',') + ' km');
export function fmtDur(s: number | null | undefined): string | null {
  if (s == null) return null;
  const min = Math.round(s / 60);
  if (min < 60) return `${min}min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}min`;
}
const short = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

// ------------------------------------------------------------------ fatos da viagem

export interface TripFacts { companyId: string; title: string; text: string; metadata: Record<string, unknown> }

/** Monta o texto factual da viagem só com SQL (nada inventado). Retorna null se a viagem não existe. */
export async function buildTripFacts(db: Queryable, tripId: string): Promise<TripFacts | null> {
  const t = (await db.query(
    `select t.id, t.company_id, t.status::text as status, t.title, t.origin_label, t.destination_label, t.driver_id,
            t.started_at, t.ended_at, t.departure_planned_at, t.planned_distance_m, t.planned_duration_s,
            t.distance_m, t.duration_s, t.deviation_max_m, t.vehicle_id,
            (t.planned_route is not null) as has_planned, (t.actual_route is not null) as has_actual,
            m.display_name as driver_name, v.plate, v.label as vehicle_label, v.preset
       from trips t
       left join company_members m on m.user_id = t.driver_id
       left join vehicles v on v.id = t.vehicle_id
      where t.id = $1`, [tripId])).rows[0];
  if (!t) return null;

  const stops = (await db.query(
    `select type::text as type, count(*)::int as n, coalesce(sum(duration_s), 0)::int as total_s, coalesce(max(duration_s), 0)::int as max_s
       from stops where trip_id = $1 group by type order by total_s desc`, [tripId])).rows;
  const deliveries = (await db.query(
    `select sequence, customer_name, status::text as status, window_start, window_end, status_at, failure_reason
       from deliveries where trip_id = $1 order by sequence nulls last, created_at`, [tripId])).rows;
  const msgs = (await db.query(
    `select ms.body, ms.created_at, ms.agent_action_id is not null as by_agent, s.display_name as sender, s.role::text as sender_role,
            r.display_name as recipient
       from messages ms
       left join company_members s on s.user_id = ms.sender_id
       left join company_members r on r.user_id = ms.recipient_id
      where ms.trip_id = $1 order by ms.created_at limit 12`, [tripId])).rows;
  const msgCount = (await db.query(`select count(*)::int as n from messages where trip_id = $1`, [tripId])).rows[0].n as number;

  const L: string[] = [];
  L.push(`Viagem: ${t.title ?? '(sem título)'} — status ${t.status}.`);
  L.push(`Motorista: ${t.driver_name ?? 'não atribuído'}. Veículo: ${t.plate ? `${t.plate}${t.vehicle_label ? ` (${t.vehicle_label})` : ''}${t.preset ? `, perfil ${t.preset}` : ''}` : 'não informado'}.`);
  if (t.origin_label || t.destination_label) L.push(`Origem: ${t.origin_label ?? 'n/d'}. Destino: ${t.destination_label ?? 'n/d'}.`);
  if (t.started_at) L.push(`Início: ${dt(t.started_at)}${t.ended_at ? `; fim: ${dt(t.ended_at)}` : ' (ainda em andamento)'}.`);
  else if (t.departure_planned_at) L.push(`Saída planejada: ${dt(t.departure_planned_at)} (viagem não iniciada).`);

  const planned = t.planned_distance_m != null || t.planned_duration_s != null
    ? `planejado ${[km(t.planned_distance_m), fmtDur(t.planned_duration_s)].filter(Boolean).join(' em ')}` : 'sem rota planejada';
  const done = t.distance_m != null || t.duration_s != null
    ? `feito ${[km(t.distance_m), fmtDur(t.duration_s)].filter(Boolean).join(' em ')}` : 'sem rota registrada';
  L.push(`Distância e tempo: ${planned}; ${done}.`);
  if (t.planned_distance_m && t.distance_m != null) {
    const diff = t.distance_m - t.planned_distance_m;
    L.push(`Diferença de distância (feito − planejado): ${diff >= 0 ? '+' : '−'}${km(Math.abs(diff))} (${Math.round((diff / t.planned_distance_m) * 100)}%).`);
  }
  if (t.planned_duration_s && t.duration_s != null) {
    const diff = t.duration_s - t.planned_duration_s;
    L.push(`Diferença de duração (feito − planejado): ${diff >= 0 ? '+' : '−'}${fmtDur(Math.abs(diff))}.`);
  }
  L.push(t.deviation_max_m != null ? `Desvio máximo da rota planejada: ${t.deviation_max_m} m.` : 'Desvio máximo da rota planejada: não calculado.');

  const totalStops = stops.reduce((a: number, s: any) => a + s.n, 0);
  const totalStopS = stops.reduce((a: number, s: any) => a + s.total_s, 0);
  if (totalStops === 0) L.push('Paradas: nenhuma registrada.');
  else L.push(`Paradas: ${totalStops} (${fmtDur(totalStopS)} no total) — ${stops.map((s: any) => `${s.type}: ${s.n} (${fmtDur(s.total_s)}, maior ${fmtDur(s.max_s)})`).join('; ')}.`);

  let late = 0, failed = 0, delivered = 0, pending = 0, early = 0;
  const dl: string[] = [];
  for (const d of deliveries) {
    const win = d.window_start || d.window_end ? `janela ${hm(d.window_start) ?? '…'}–${hm(d.window_end) ?? '…'}` : 'sem janela';
    let line = `#${d.sequence ?? '?'} ${d.customer_name}: `;
    if (d.status === 'entregue') {
      delivered++;
      line += `entregue às ${hm(d.status_at)} (${win})`;
      if (d.window_end && d.status_at && new Date(d.status_at) > new Date(d.window_end)) {
        late++; line += `, ATRASO de ${fmtDur((new Date(d.status_at).getTime() - new Date(d.window_end).getTime()) / 1000)}`;
      } else if (d.window_start && d.status_at && new Date(d.status_at) < new Date(d.window_start)) {
        early++; line += ', antes da janela';
      } else if (d.window_end) line += ', dentro da janela';
    } else if (d.status === 'falhou') {
      failed++; line += `FALHOU (${win}): ${d.failure_reason ?? 'sem motivo'}`;
    } else { pending++; line += `pendente (${win})`; }
    dl.push(line + '.');
  }
  if (deliveries.length === 0) L.push('Entregas: nenhuma cadastrada.');
  else {
    L.push(`Entregas: ${deliveries.length} — ${delivered} entregue(s), ${failed} falha(s), ${pending} pendente(s); ${late} entregue(s) fora da janela (atraso)${early ? `, ${early} antes da janela` : ''}.`);
    L.push(...dl.map((x) => '  - ' + x));
  }
  if (msgCount === 0) L.push('Mensagens da viagem: nenhuma.');
  else {
    L.push(`Mensagens da viagem: ${msgCount}${msgCount > msgs.length ? ` (mostrando as ${msgs.length} primeiras)` : ''}.`);
    for (const m of msgs) L.push(`  - ${hm(m.created_at)} ${m.sender ?? 'sistema'}${m.by_agent ? ' (via Mentor)' : ''} → ${m.recipient ?? '?'}: "${short(String(m.body).replace(/\s+/g, ' '), 200)}"`);
  }

  return {
    companyId: t.company_id,
    title: `Viagem ${t.title ?? t.id.slice(0, 8)}${t.driver_name ? ` — ${t.driver_name}` : ''}${t.ended_at ? ` (${DateTime.fromJSDate(new Date(t.ended_at)).setZone(TZ).toFormat('dd/MM/yyyy')})` : ''}`,
    text: L.join('\n'),
    metadata: {
      trip_id: t.id, status: t.status, driver_id: t.driver_id, vehicle_id: t.vehicle_id, plate: t.plate ?? null,
      started_at: t.started_at, ended_at: t.ended_at, distance_m: t.distance_m, deviation_max_m: t.deviation_max_m,
      deliveries: deliveries.length, deliveries_late: late, deliveries_failed: failed, stops: totalStops,
    },
  };
}

// ------------------------------------------------------------------ resumo (LLM opcional)

const SUMMARY_SYSTEM = `Você resume viagens de caminhão para o gestor de logística de uma transportadora brasileira.
Regras: use SOMENTE os fatos fornecidos; nunca invente números, nomes, causas ou eventos; se um dado não está nos fatos, não o mencione.
Escreva em português do Brasil, em até 6 frases curtas, em texto corrido (sem listas, sem títulos).
Destaque o que importa para a operação: diferença entre planejado e feito, desvio máximo, paradas longas, entregas atrasadas ou que falharam (com o motivo) e mensagens relevantes.`;

/** Resumo curto a partir dos fatos. Sem cliente (ou se a chamada falhar), o texto factual é o resumo. */
export async function summarizeFacts(llm: LlmClient | null, facts: string, system = SUMMARY_SYSTEM): Promise<{ text: string; source: 'llm' | 'fatos'; error?: string }> {
  if (!llm) return { text: facts, source: 'fatos' };
  try {
    const r = await llm.create({
      model: summaryModel(), max_tokens: 2048, effort: 'low', system,
      messages: [{ role: 'user', content: `Fatos:\n${facts}\n\nEscreva o resumo.` }],
    });
    const text = textOf(r.content);
    if (!text) return { text: facts, source: 'fatos', error: `resposta vazia (stop_reason=${r.stop_reason})` };
    return { text, source: 'llm' };
  } catch (e: any) {
    return { text: facts, source: 'fatos', error: e?.message ?? String(e) };
  }
}

// ------------------------------------------------------------------ knowledge_docs

export interface DocInput {
  companyId: string; sourceType: 'trip' | 'delivery' | 'conversation' | 'stop' | 'note'; sourceId: string;
  title: string; content: string; metadata?: Record<string, unknown>;
}

/** Upsert por (empresa, tipo, origem). Gera o embedding; se o embedder falhar, grava sem embedding (o job completa depois). */
export async function upsertKnowledgeDoc(db: Queryable, embedder: Embedder, d: DocInput): Promise<{ id: string; embedded: boolean }> {
  let emb: number[] | null = null;
  try { emb = (await embedder.embed([`${d.title}\n${d.content}`], 'document'))[0]; } catch { emb = null; }
  const r = await db.query(
    `insert into knowledge_docs (company_id, source_type, source_id, title, content, metadata, embedding, embedding_model)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::vector, $8)
     on conflict (company_id, source_type, source_id) do update
       set title = excluded.title, content = excluded.content, metadata = excluded.metadata,
           embedding = excluded.embedding, embedding_model = excluded.embedding_model
     returning id`,
    [d.companyId, d.sourceType, d.sourceId, d.title, d.content, JSON.stringify(d.metadata ?? {}),
     emb ? vectorLiteral(emb) : null, emb ? embedder.model : null]);
  return { id: r.rows[0].id, embedded: !!emb };
}

/** Gera (ou reaproveita) o resumo da viagem, grava trips.summary e faz upsert do documento 'trip'. */
export async function generateTripSummary(db: Queryable, tripId: string, o: { embedder: Embedder; llm: LlmClient | null; force?: boolean }) {
  const facts = await buildTripFacts(db, tripId);
  if (!facts) throw httpError(404, 'viagem não encontrada');
  const cur = (await db.query(`select summary from trips where id = $1`, [tripId])).rows[0];
  let summary: string = cur.summary;
  let source: string = 'existente';
  if (!summary || o.force) {
    const s = await summarizeFacts(o.llm, facts.text);
    summary = s.text; source = s.source;
    await db.query(`update trips set summary = $2, summary_generated_at = now() where id = $1`, [tripId, summary]);
  }
  // O documento leva o resumo e os fatos: a busca semântica acha por qualquer um dos dois.
  const content = summary === facts.text ? summary : `${summary}\n\nFatos:\n${facts.text}`;
  const doc = await upsertKnowledgeDoc(db, o.embedder, {
    companyId: facts.companyId, sourceType: 'trip', sourceId: tripId, title: facts.title, content,
    metadata: { ...facts.metadata, summary_source: source },
  });
  return { summary, source, doc };
}

// ------------------------------------------------------------------ documentos de entrega

async function deliveryDoc(db: Queryable, id: string): Promise<DocInput | null> {
  const d = (await db.query(
    `select d.id, d.company_id, d.trip_id, d.customer_name, d.address, d.status::text as status, d.status_at, d.window_start, d.window_end,
            d.failure_reason, d.notes, t.title as trip_title, m.display_name as driver, v.plate
       from deliveries d join trips t on t.id = d.trip_id
       left join company_members m on m.user_id = t.driver_id left join vehicles v on v.id = t.vehicle_id
      where d.id = $1`, [id])).rows[0];
  if (!d) return null;
  const win = d.window_start || d.window_end ? `${hm(d.window_start) ?? '…'}–${hm(d.window_end) ?? '…'}` : 'sem janela';
  const who = `Viagem ${d.trip_title ?? d.trip_id.slice(0, 8)}, motorista ${d.driver ?? 'n/d'}, veículo ${d.plate ?? 'n/d'}.`;
  if (d.status === 'falhou') {
    return { companyId: d.company_id, sourceType: 'delivery', sourceId: d.id, title: `Entrega falhou — ${d.customer_name}`,
      content: `Entrega FALHOU em ${dt(d.status_at) ?? 'data n/d'}. Cliente: ${d.customer_name}. Endereço: ${d.address}. Motivo: ${d.failure_reason}. Janela: ${win}. ${who}${d.notes ? ` Observações: ${d.notes}` : ''}`,
      metadata: { kind: 'falha', trip_id: d.trip_id, delivery_id: d.id, customer: d.customer_name, reason: d.failure_reason } };
  }
  if (d.status === 'entregue' && d.window_end && d.status_at && new Date(d.status_at) > new Date(d.window_end)) {
    const atraso = fmtDur((new Date(d.status_at).getTime() - new Date(d.window_end).getTime()) / 1000);
    return { companyId: d.company_id, sourceType: 'delivery', sourceId: d.id, title: `Entrega atrasada — ${d.customer_name}`,
      content: `Entrega ATRASADA: entregue em ${dt(d.status_at)}, ${atraso} depois do fim da janela (${win}). Cliente: ${d.customer_name}. Endereço: ${d.address}. ${who}${d.notes ? ` Observações: ${d.notes}` : ''}`,
      metadata: { kind: 'atraso', trip_id: d.trip_id, delivery_id: d.id, customer: d.customer_name, delay_s: Math.round((new Date(d.status_at).getTime() - new Date(d.window_end).getTime()) / 1000) } };
  }
  return null;
}

// ------------------------------------------------------------------ documentos de conversa (Mentor)

const CONV_SYSTEM = `Você resume conversas entre um gestor de logística e o Mentor de Logística (assistente com dados da empresa).
Regras: use SOMENTE o conteúdo fornecido; não invente. Em português do Brasil, até 5 frases curtas, em texto corrido:
o que o gestor perguntou, o que o Mentor respondeu de relevante (números e conclusões citados) e quais ações foram propostas e o desfecho.`;

async function conversationFacts(db: Queryable, convId: string): Promise<{ companyId: string; userId: string; title: string; text: string } | null> {
  const c = (await db.query(
    `select c.id, c.company_id, c.user_id, c.title, c.created_at, m.display_name
       from agent_conversations c left join company_members m on m.user_id = c.user_id where c.id = $1`, [convId])).rows[0];
  if (!c) return null;
  const msgs = (await db.query(`select role, content from agent_messages where conversation_id = $1 order by id`, [convId])).rows;
  const acts = (await db.query(`select tool, status::text as status, input->>'_resumo' as resumo from agent_actions where conversation_id = $1 order by created_at`, [convId])).rows;
  const L: string[] = [`Conversa com o Mentor — gestor ${c.display_name ?? 'n/d'}, iniciada em ${dt(c.created_at)}.`];
  let q = 0;
  for (const m of msgs) {
    if (m.role === 'tool' || !Array.isArray(m.content)) continue;
    const t = (m.content as any[]).filter((b) => b.type === 'text' && !String(b.text).startsWith('[Data e hora')).map((b) => b.text).join(' ').trim();
    if (!t) continue;
    if (m.role === 'user') L.push(`Pergunta ${++q}: ${short(t.replace(/\s+/g, ' '), 400)}`);
    else L.push(`Resposta: ${short(t.replace(/\s+/g, ' '), 700)}`);
  }
  if (acts.length) { L.push('Ações propostas:'); for (const a of acts) L.push(`  - ${a.tool} (${a.status})${a.resumo ? `: ${short(a.resumo, 200)}` : ''}`); }
  return { companyId: c.company_id, userId: c.user_id, title: `Conversa com o Mentor: ${c.title ?? convId.slice(0, 8)}`, text: L.join('\n') };
}

// ------------------------------------------------------------------ job

export interface BrainJobOptions {
  embedder: Embedder; llm: LlmClient | null;
  companyIds?: string[]; limit?: number; idleMinutes?: number;
}
export interface BrainJobReport {
  embedding_model: string; trips_summarized: number; trips_docs_rebuilt: number; delivery_docs: number; conversation_docs: number;
  embeddings_filled: number; errors: { kind: string; id: string; message: string }[];
}

/**
 * Idempotente: só toca no que falta. (1) viagens concluídas sem resumo; (2) viagens com resumo mas sem documento;
 * (3) entregas falhas/atrasadas sem documento (ou alteradas depois); (4) conversas paradas há `idleMinutes` sem
 * documento (ou com mensagens novas); (5) documentos sem embedding ou com embedding de outro modelo.
 */
export async function runBrainJob(db: Queryable, o: BrainJobOptions): Promise<BrainJobReport> {
  const limit = o.limit ?? 100;
  const idle = o.idleMinutes ?? Number(process.env.FROTA_CONVERSATION_IDLE_MIN ?? 30);
  const scope = o.companyIds?.length ? o.companyIds : null;
  const rep: BrainJobReport = { embedding_model: o.embedder.model, trips_summarized: 0, trips_docs_rebuilt: 0, delivery_docs: 0, conversation_docs: 0, embeddings_filled: 0, errors: [] };
  const fail = (kind: string, id: string, e: any) => rep.errors.push({ kind, id, message: e?.message ?? String(e) });

  const noSummary = (await db.query(
    `select t.id from trips t where t.status = 'concluida' and t.summary is null and ($1::uuid[] is null or t.company_id = any($1))
      order by t.ended_at nulls last limit $2`, [scope, limit])).rows;
  for (const r of noSummary) {
    try { await generateTripSummary(db, r.id, { embedder: o.embedder, llm: o.llm }); rep.trips_summarized++; } catch (e) { fail('trip', r.id, e); }
  }

  const noDoc = (await db.query(
    `select t.id from trips t where t.status = 'concluida' and t.summary is not null and ($1::uuid[] is null or t.company_id = any($1))
        and not exists (select 1 from knowledge_docs k where k.company_id = t.company_id and k.source_type = 'trip' and k.source_id = t.id)
      limit $2`, [scope, limit])).rows;
  for (const r of noDoc) {
    try { await generateTripSummary(db, r.id, { embedder: o.embedder, llm: o.llm }); rep.trips_docs_rebuilt++; } catch (e) { fail('trip_doc', r.id, e); }
  }

  const dels = (await db.query(
    `select d.id from deliveries d join trips t on t.id = d.trip_id
      where t.status <> 'cancelada' and ($1::uuid[] is null or d.company_id = any($1))
        and (d.status = 'falhou' or (d.status = 'entregue' and d.window_end is not null and d.status_at > d.window_end))
        and not exists (select 1 from knowledge_docs k where k.company_id = d.company_id and k.source_type = 'delivery'
                           and k.source_id = d.id and k.updated_at >= d.updated_at)
      limit $2`, [scope, limit])).rows;
  for (const r of dels) {
    try {
      const doc = await deliveryDoc(db, r.id);
      if (doc) { await upsertKnowledgeDoc(db, o.embedder, doc); rep.delivery_docs++; }
    } catch (e) { fail('delivery', r.id, e); }
  }

  const convs = (await db.query(
    `select c.id from agent_conversations c
      where ($1::uuid[] is null or c.company_id = any($1)) and c.updated_at <= now() - make_interval(mins => $3::int)
        and exists (select 1 from agent_messages m where m.conversation_id = c.id and m.role = 'assistant')
        and not exists (select 1 from knowledge_docs k where k.company_id = c.company_id and k.source_type = 'conversation'
                           and k.source_id = c.id and k.updated_at >= c.updated_at)
      limit $2`, [scope, limit, idle])).rows;
  for (const r of convs) {
    try {
      const f = await conversationFacts(db, r.id);
      if (!f) continue;
      const s = await summarizeFacts(o.llm, f.text, CONV_SYSTEM);
      await upsertKnowledgeDoc(db, o.embedder, {
        companyId: f.companyId, sourceType: 'conversation', sourceId: r.id, title: f.title,
        content: s.text === f.text ? f.text : `${s.text}\n\nConversa:\n${f.text}`,
        // user_id: a busca do Mentor só mostra conversas do próprio gestor (ou de admin)
        metadata: { conversation_id: r.id, user_id: f.userId, summary_source: s.source },
      });
      rep.conversation_docs++;
    } catch (e) { fail('conversation', r.id, e); }
  }

  // embeddings que faltam (falha do embedder na hora) ou de outro modelo (troca de local para Voyage, por exemplo)
  const missing = (await db.query(
    `select id, title, content from knowledge_docs
      where ($1::uuid[] is null or company_id = any($1)) and (embedding is null or embedding_model is distinct from $2)
      order by updated_at limit $3`, [scope, o.embedder.model, limit * 4])).rows;
  for (let i = 0; i < missing.length; i += 32) {
    const batch = missing.slice(i, i + 32);
    try {
      const vecs = await o.embedder.embed(batch.map((d: any) => `${d.title ?? ''}\n${d.content}`), 'document');
      for (let j = 0; j < batch.length; j++) {
        await db.query(`update knowledge_docs set embedding = $2::vector, embedding_model = $3 where id = $1`, [batch[j].id, vectorLiteral(vecs[j]), o.embedder.model]);
        rep.embeddings_filled++;
      }
    } catch (e) { fail('embedding', batch[0].id, e); }
  }
  return rep;
}

// ------------------------------------------------------------------ rotas

/** summaryLlm: undefined = cliente real se houver ANTHROPIC_API_KEY; null = sempre o texto factual; função = resolvido a cada chamada (testes). */
export interface BrainOptions { embedder?: Embedder; summaryLlm?: LlmClient | null | (() => LlmClient | null) }

const JobBody = z.object({
  company_ids: z.array(z.string().uuid()).max(100).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  idle_minutes: z.number().min(0).max(1440).optional(),
}).strict();

export async function brainRoutes(app: FastifyInstance, opts: BrainOptions = {}) {
  const embedder = opts.embedder ?? pickEmbedder();
  const real = opts.summaryLlm === undefined ? anthropicClientFromEnv() : null;
  const resolveLlm = () => (typeof opts.summaryLlm === 'function' ? opts.summaryLlm() : opts.summaryLlm === undefined ? real : opts.summaryLlm);
  let running = false;

  // POST /api/frota/jobs/brain — service_role. Resume viagens concluídas sem resumo e (re)gera embeddings faltantes.
  app.post('/api/frota/jobs/brain', async (req, reply) => {
    await requireService(req, reply);
    const parsed = JobBody.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(422).send({ error: 'VALIDATION', issues: parsed.error.issues });
    if (running) return reply.code(409).send({ error: 'BUSY', message: 'o job do Second Brain já está rodando' });
    running = true;
    try {
      const body = parsed.data;
      return await runBrainJob(pool, {
        embedder, llm: resolveLlm(),
        companyIds: body.company_ids, limit: body.limit, idleMinutes: body.idle_minutes,
      });
    } finally { running = false; }
  });
}
