import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signJwt, withRls } from '../../src/frota/auth.js';
import { LocalHashEmbedder, VoyageEmbedder, vectorLiteral } from '../../src/frota/brain.js';
import { DB_URL, PTS } from '../helpers.js';

/**
 * Second Brain + Mentor de Logística, contra uma instância PRÓPRIA da API (src/frota/dev_server_brain.ts, porta 3200)
 * com cliente Anthropic FALSO (FROTA_FAKE_LLM=1) que devolve tool_use roteirizado. Cria empresas/usuários no
 * beforeAll (superusuário via pg) e apaga tudo no afterAll.
 * Sem chaves reais: nada aqui chama a Anthropic nem a Voyage.
 */

const PORT = Number(process.env.BRAIN_TEST_PORT ?? 3200);
const BASE = process.env.BRAIN_TEST_URL ?? `http://127.0.0.1:${PORT}`;
const db = new pg.Pool({ connectionString: DB_URL, max: 4 });
let server: ChildProcess | null = null;

const id = () => randomUUID();
const A = { co: id(), gestor: id(), gestor2: id(), mot1: id(), mot2: id(), veh: id(), tripDone: id(), tripReorder: id(), tripAssign: id(), del: [id(), id(), id()] as string[], reDel: [id(), id(), id()] as string[] };
const B = { co: id(), gestor: id(), mot: id(), veh: id(), tripDone: id() };
const tok = (sub: string) => signJwt({ sub, role: 'authenticated' });
const SERVICE = signJwt({ role: 'service_role' });

async function api(method: string, path: string, token?: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const chat = (t: string, message: string, conversation_id?: string) => api('POST', '/api/frota/mentor/chat', t, { message, conversation_id });
const setScript = (responses: unknown[]) => api('POST', '/__test/llm_script', undefined, { responses });
const llmCalls = async () => (await api('GET', '/__test/llm_calls')).body as { calls: any[]; summary_calls: any[]; remaining: number };
const reset = () => api('DELETE', '/__test/llm_calls');
const text = (t: string) => ({ content: [{ type: 'text', text: t }] });
const use = (...tools: { name: string; input?: object }[]) => ({ content: tools.map((t, i) => ({ type: 'tool_use', id: `tu_${i}_${t.name}`, name: t.name, input: t.input ?? {} })) });
/** tool_results que o Mentor devolveu ao "modelo" na chamada n */
const results = (call: any) => (call.messages.at(-1).content as any[]).filter((b) => b.type === 'tool_result').map((b) => ({ ...b, json: safeJson(b.content) }));
const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
const day = (offset: number, hhmm: string) => DateTime.now().setZone('America/Sao_Paulo').startOf('day').plus({ days: offset }).set({ hour: +hhmm.slice(0, 2), minute: +hhmm.slice(3) }).toISO()!;

beforeAll(async () => {
  // ---- dados (superusuário)
  const users = [A.gestor, A.gestor2, A.mot1, A.mot2, B.gestor, B.mot];
  for (const u of users) await db.query(`insert into auth.users (id, email) values ($1, $2)`, [u, `${u}@mentor.teste`]);
  await db.query(`insert into companies (id, name) values ($1, 'Mentor Teste A'), ($2, 'Mentor Teste B')`, [A.co, B.co]);
  const mem = (co: string, u: string, role: string, name: string) =>
    db.query(`insert into company_members (company_id, user_id, role, display_name) values ($1, $2, $3, $4)`, [co, u, role, name]);
  await mem(A.co, A.gestor, 'gestor', 'Gestor A'); await mem(A.co, A.gestor2, 'gestor', 'Gestor A2');
  await mem(A.co, A.mot1, 'motorista', 'Motorista A1'); await mem(A.co, A.mot2, 'motorista', 'Motorista A2');
  await mem(B.co, B.gestor, 'gestor', 'Gestor B'); await mem(B.co, B.mot, 'motorista', 'Motorista B');
  await db.query(`insert into vehicles (id, company_id, plate, preset, label) values ($1, $2, 'TST1A23', 'toco', 'Toco A'), ($3, $4, 'BBB9B99', 'carreta_5e', 'Carreta B')`, [A.veh, A.co, B.veh, B.co]);

  // viagem concluída da A: planejado 12 km, feito 13 km, desvio 350 m; 3 entregas (atrasada, falhou, no prazo)
  await db.query(
    `insert into trips (id, company_id, driver_id, vehicle_id, status, title, origin_label, destination_label, started_at, ended_at,
                        planned_distance_m, planned_duration_s, distance_m, duration_s, deviation_max_m)
     values ($1, $2, $3, $4, 'concluida', 'Rota Centro A', 'CD Barueri', 'Centro SP', $5, $6, 12000, 1800, 13000, 2400, 350)`,
    [A.tripDone, A.co, A.mot1, A.veh, day(-2, '08:00'), day(-2, '14:30')]);
  await db.query(
    `insert into stops (company_id, trip_id, driver_id, type, source, geom, arrived_at, departed_at, address) values
       ($1, $2, $3, 'entrega', 'manual', ST_SetSRID(ST_MakePoint(-46.65, -23.55), 4326), $4, $5, 'Av. Paulista, 1000'),
       ($1, $2, $3, 'descanso', 'manual', ST_SetSRID(ST_MakePoint(-46.70, -23.52), 4326), $6, $7, 'Posto Rodoanel')`,
    [A.co, A.tripDone, A.mot1, day(-2, '10:20'), day(-2, '10:50'), day(-2, '12:00'), day(-2, '12:20')]);
  await db.query(
    `insert into deliveries (id, company_id, trip_id, sequence, customer_name, address, window_start, window_end, status, status_at, failure_reason) values
       ($1, $4, $5, 1, 'Mercado Alfa', 'Rua A, 10', $6, $7, 'entregue', $8, null),
       ($2, $4, $5, 2, 'Farmácia Beta', 'Rua B, 20', $9, $10, 'falhou', $11, 'cliente ausente'),
       ($3, $4, $5, 3, 'Padaria Gama', 'Rua C, 30', $12, $13, 'entregue', $14, null)`,
    [A.del[0], A.del[1], A.del[2], A.co, A.tripDone, day(-2, '08:30'), day(-2, '10:00'), day(-2, '10:25'),
     day(-2, '11:00'), day(-2, '12:00'), day(-2, '11:30'), day(-2, '12:30'), day(-2, '14:00'), day(-2, '13:00')]);
  await db.query(`insert into messages (company_id, trip_id, sender_id, recipient_id, body) values ($1, $2, $3, $4, 'Atenção ao horário da primeira entrega')`, [A.co, A.tripDone, A.gestor, A.mot1]);
  await db.query(`insert into live_positions (driver_id, company_id, vehicle_id, geom, speed_kmh, moving, recorded_at) values ($1, $2, $3, ST_SetSRID(ST_MakePoint(-46.63, -23.55), 4326), 42, true, now() - interval '3 minutes')`, [A.mot1, A.co, A.veh]);

  // viagens abertas da A (reordenar / atribuir)
  await db.query(`insert into trips (id, company_id, vehicle_id, status, title) values ($1, $3, $4, 'planejada', 'Viagem Reordenar'), ($2, $3, $4, 'planejada', 'Viagem Atribuir')`, [A.tripReorder, A.tripAssign, A.co, A.veh]);
  for (let i = 0; i < 3; i++) await db.query(`insert into deliveries (id, company_id, trip_id, sequence, customer_name, address) values ($1, $2, $3, $4, $5, 'Rua X')`, [A.reDel[i], A.co, A.tripReorder, i + 1, `Cliente R${i + 1}`]);

  // empresa B: tudo com marcas inconfundíveis
  await db.query(`insert into trips (id, company_id, driver_id, vehicle_id, status, title, started_at, ended_at, planned_distance_m, distance_m, deviation_max_m) values ($1, $2, $3, $4, 'concluida', 'Rota Secreta B', $5, $6, 50000, 51000, 9999)`,
    [B.tripDone, B.co, B.mot, B.veh, day(-1, '08:00'), day(-1, '15:00')]);
  await db.query(`insert into deliveries (company_id, trip_id, sequence, customer_name, address, window_end, status, status_at, failure_reason) values ($1, $2, 1, 'Cliente-B-Secreto', 'Rua B', $3, 'falhou', $4, 'endereço inexistente B')`, [B.co, B.tripDone, day(-1, '10:00'), day(-1, '10:30')]);
  await db.query(`insert into live_positions (driver_id, company_id, vehicle_id, geom, speed_kmh, moving, recorded_at) values ($1, $2, $3, ST_SetSRID(ST_MakePoint(-43.2, -22.9), 4326), 10, true, now())`, [B.mot, B.co, B.veh]);

  // ---- servidor próprio com LLM falso
  if (!process.env.BRAIN_TEST_URL) {
    const env = { ...process.env, FROTA_FAKE_LLM: '1', BRAIN_PORT: String(PORT), LOG_LEVEL: 'warn' } as Record<string, string | undefined>;
    delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN; delete env.VOYAGE_API_KEY; delete env.FROTA_EMBEDDER;
    // a porta precisa estar livre: um servidor antigo responderia ao health e os testes rodariam contra ele
    if (await fetch(`${BASE}/__health`).then((r) => r.ok, () => false)) throw new Error(`a porta ${PORT} já está em uso; libere-a ou use BRAIN_TEST_URL`);
    // detached: o tsx cria um processo filho; o grupo inteiro é encerrado no afterAll
    server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/frota/dev_server_brain.ts'], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
  }
  const t0 = Date.now();
  for (;;) {
    try { if ((await fetch(`${BASE}/__health`)).ok) break; } catch { /* aguardando */ }
    if (Date.now() - t0 > 60_000) throw new Error('dev_server_brain não subiu em 60 s');
    await new Promise((r) => setTimeout(r, 300));
  }
});

afterAll(async () => {
  if (server?.pid) {
    const exited = new Promise<void>((r) => server!.once('exit', () => r()));
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* já saiu */ }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    try { process.kill(-server.pid, 'SIGKILL'); } catch { /* já saiu */ }
    for (let i = 0; i < 50 && (await fetch(`${BASE}/__health`).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 100));
  }
  // empresas primeiro (cascata em membros, viagens, paradas, entregas, mensagens, conhecimento, agente); depois os usuários
  await db.query(`delete from companies where id = any($1)`, [[A.co, B.co]]);
  await db.query(`delete from auth.users where id = any($1)`, [[A.gestor, A.gestor2, A.mot1, A.mot2, B.gestor, B.mot]]);
  await db.end();
});

describe('acesso ao chat', () => {
  it('sem token: 401; motorista: 403; sem ANTHROPIC_API_KEY real o servidor de teste usa o falso', async () => {
    expect((await chat('', 'oi')).status).toBe(401);
    const m = await chat(tok(A.mot1), 'quanto rodei?');
    expect(m.status).toBe(403);
    const antes = await db.query(`select count(*)::int as n from agent_conversations where company_id = $1`, [A.co]);
    expect(antes.rows[0].n).toBe(0);        // motorista não cria conversa nem consome o modelo
    expect((await llmCalls()).calls.length).toBe(0);
    // service_role não é usuário da equipe
    expect((await chat(SERVICE, 'oi')).status).toBe(403);
  });
});

describe('tools de leitura (RLS do gestor)', () => {
  let convId: string;

  it('KPIs devolvem só dados da empresa do gestor e a conversa fica gravada com empresa/usuário do gestor', async () => {
    await reset();
    await setScript([
      use({ name: 'kpi_atrasos_por_motorista' }, { name: 'kpi_tempo_parado', input: { agrupar_por: 'tipo' } }, { name: 'kpi_tempo_parado', input: { agrupar_por: 'local' } },
        { name: 'kpi_km_rodados', input: { agrupar_por: 'motorista' } }, { name: 'kpi_km_rodados', input: { agrupar_por: 'veiculo' } },
        { name: 'kpi_viagens_por_status' }, { name: 'kpi_desvios_rota' }, { name: 'posicao_atual' },
        { name: 'status_entregas', input: { status: 'falhou' } }, { name: 'historico_viagem', input: { viagem_id: A.tripDone } },
        { name: 'listar_cadastros', input: { tipo: 'motoristas' } }, { name: 'listar_cadastros', input: { tipo: 'veiculos' } }, { name: 'listar_cadastros', input: { tipo: 'viagens' } }),
      text('Resumo dos KPIs.'),
    ]);
    const r = await chat(tok(A.gestor), 'Como foi a operação nos últimos dias?');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.reply).toBe('Resumo dos KPIs.');
    expect(r.body.tool_calls).toHaveLength(13);
    expect(r.body.tool_calls.every((t: any) => !t.is_error)).toBe(true);
    expect(r.body.pending_confirmation).toBe(false);
    convId = r.body.conversation_id;

    const { calls } = await llmCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].model).toBe('claude-opus-5-5');
    expect(calls[0].tools.map((t: any) => t.name)).toContain('buscar_conhecimento');
    const res = results(calls[1]);
    expect(res).toHaveLength(13);
    const all = res.map((x) => x.content).join('\n');
    // dados da A presentes
    expect(all).toContain('Motorista A1');
    expect(all).toContain('TST1A23');
    expect(all).toContain('cliente ausente');
    expect(all).toContain('Mercado Alfa');
    // nada da B
    for (const marca of ['Motorista B', 'BBB9B99', 'Cliente-B-Secreto', 'Rota Secreta B', 'endereço inexistente B', 'Gestor B']) expect(all).not.toContain(marca);
    // números
    const atrasos = res[0].json.motoristas.find((m: any) => m.motorista === 'Motorista A1');
    expect(atrasos).toMatchObject({ entregas_total: 3, entregues: 2, fora_da_janela: 1, atraso_medio_min: 25, falhas: 1 });
    const parado = res[1].json.grupos;
    expect(parado.find((g: any) => g.grupo === 'entrega').total_min).toBe(30);
    expect(parado.find((g: any) => g.grupo === 'descanso').total_min).toBe(20);
    expect(res[3].json.grupos[0]).toMatchObject({ grupo: 'Motorista A1', km_rodados: 13, km_planejados: 12 });
    expect(res[6].json.viagens[0]).toMatchObject({ desvio_max_m: 350 });
    expect(res[7].json.posicoes).toHaveLength(1);
    expect(res[7].json.posicoes[0]).toMatchObject({ motorista: 'Motorista A1', em_movimento: true });
    expect(res[9].json.entregas).toHaveLength(3);
    expect(res[9].json.mensagens[0].texto).toContain('Atenção ao horário');
    expect(res[10].json.motoristas.map((m: any) => m.nome).sort()).toEqual(['Motorista A1', 'Motorista A2']);

    // persistência: empresa e usuário do gestor, tokens
    const conv = (await db.query(`select company_id, user_id from agent_conversations where id = $1`, [convId])).rows[0];
    expect(conv).toEqual({ company_id: A.co, user_id: A.gestor });
    const msgs = (await db.query(`select role, company_id, model, input_tokens, output_tokens from agent_messages where conversation_id = $1 order by id`, [convId])).rows;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(msgs.every((m) => m.company_id === A.co)).toBe(true);
    expect(msgs[1]).toMatchObject({ model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 100 });
  });

  it('a conversa continua: o histórico volta inteiro ao modelo, sem edição', async () => {
    await reset();
    await setScript([text('Continuando.')]);
    const r = await chat(tok(A.gestor), 'E o desvio?', convId);
    expect(r.status).toBe(200);
    expect(r.body.conversation_id).toBe(convId);
    const { calls } = await llmCalls();
    expect(calls[0].messages).toHaveLength(5);                  // 4 gravadas + a nova
    expect(calls[0].messages[0].content[1].text).toBe('Como foi a operação nos últimos dias?');
    expect(calls[0].messages[1].content.filter((b: any) => b.type === 'tool_use')).toHaveLength(13);
    expect(calls[0].messages[2].role).toBe('user');             // tool_results voltam como mensagem do usuário
  });

  it('tool não acha viagem de outra empresa e parâmetros inválidos viram erro para o modelo', async () => {
    await reset();
    await setScript([
      use({ name: 'historico_viagem', input: { viagem_id: B.tripDone } }, { name: 'kpi_tempo_parado', input: { agrupar_por: 'banana' } },
        { name: 'status_entregas', input: { viagem_id: B.tripDone } }, { name: 'tool_inexistente' }),
      text('ok'),
    ]);
    const r = await chat(tok(A.gestor), 'me mostre a viagem da outra empresa');
    expect(r.status).toBe(200);
    const res = results((await llmCalls()).calls[1]);
    expect(res[0].is_error).toBe(true);
    expect(res[0].content).toContain('não encontrada');
    expect(res[1].is_error).toBe(true);
    expect(res[2].is_error).toBeUndefined();
    expect(res[2].json.entregas).toEqual([]);                    // filtro por viagem alheia: vazio, nunca a linha da B
    expect(res[3].is_error).toBe(true);
  });
});

describe('tools de ação: proposta, confirmar e rejeitar', () => {
  it('ação vira proposta e NÃO executa; só a confirmação envia a mensagem (com agent_action_id)', async () => {
    await reset();
    await setScript([
      use({ name: 'propor_enviar_mensagem', input: { motorista_id: A.mot1, texto: 'Pode antecipar a saída em 30 min?', viagem_id: A.tripDone } }),
      text('Proposta registrada; confirme para enviar.'),
    ]);
    const r = await chat(tok(A.gestor), 'Avise o Motorista A1 para antecipar a saída');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.pending_confirmation).toBe(true);
    expect(r.body.actions_proposed).toHaveLength(1);
    const actionId = r.body.actions_proposed[0].id as string;

    const tr = results((await llmCalls()).calls[1])[0];
    expect(tr.content).toContain('PROPOSTA');                    // o modelo é instruído a avisar o gestor
    const a = (await db.query(`select * from agent_actions where id = $1`, [actionId])).rows[0];
    expect(a).toMatchObject({ company_id: A.co, requested_by: A.gestor, tool: 'enviar_mensagem', status: 'proposta', requires_confirmation: true, conversation_id: r.body.conversation_id });
    expect(a.executed_at).toBeNull();
    expect((await db.query(`select count(*)::int as n from messages where agent_action_id = $1`, [actionId])).rows[0].n).toBe(0);

    // lista de propostas
    const list = await api('GET', '/api/frota/mentor/actions?status=proposta', tok(A.gestor));
    expect(list.status).toBe(200);
    expect(list.body.actions.map((x: any) => x.id)).toContain(actionId);
    expect(list.body.actions.find((x: any) => x.id === actionId).resumo).toContain('Motorista A1');

    // motorista não confirma nem lista
    expect((await api('POST', `/api/frota/mentor/actions/${actionId}/confirm`, tok(A.mot1))).status).toBe(403);
    expect((await api('GET', '/api/frota/mentor/actions', tok(A.mot1))).status).toBe(403);

    // gestor confirma → executa
    const c = await api('POST', `/api/frota/mentor/actions/${actionId}/confirm`, tok(A.gestor));
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.ok).toBe(true);
    expect(c.body.action).toMatchObject({ status: 'executada', confirmed_by: A.gestor });
    expect(c.body.action.executed_at).toBeTruthy();
    const msg = (await db.query(`select * from messages where agent_action_id = $1`, [actionId])).rows;
    expect(msg).toHaveLength(1);
    expect(msg[0]).toMatchObject({ company_id: A.co, sender_id: A.gestor, recipient_id: A.mot1, trip_id: A.tripDone, body: 'Pode antecipar a saída em 30 min?' });
    // a mensagem chega ao motorista (lida com a RLS dele)
    const doMot = await withRls({ sub: A.mot1, role: 'authenticated' }, (cl) => cl.query(`select body, agent_action_id from messages where agent_action_id = $1`, [actionId]));
    expect(doMot.rows).toEqual([{ body: 'Pode antecipar a saída em 30 min?', agent_action_id: actionId }]);

    // idempotência: confirmar de novo não reenvia
    expect((await api('POST', `/api/frota/mentor/actions/${actionId}/confirm`, tok(A.gestor))).status).toBe(409);
    expect((await api('POST', `/api/frota/mentor/actions/${actionId}/reject`, tok(A.gestor))).status).toBe(409);
    expect((await db.query(`select count(*)::int as n from messages where agent_action_id = $1`, [actionId])).rows[0].n).toBe(1);
  });

  it('rejeitar não executa', async () => {
    await reset();
    await setScript([use({ name: 'propor_enviar_mensagem', input: { motorista_id: A.mot2, texto: 'Mensagem que será rejeitada' } }), text('proposta')]);
    const r = await chat(tok(A.gestor), 'Mande uma mensagem ao Motorista A2');
    const actionId = r.body.actions_proposed[0].id as string;
    const rej = await api('POST', `/api/frota/mentor/actions/${actionId}/reject`, tok(A.gestor));
    expect(rej.status).toBe(200);
    expect(rej.body.action.status).toBe('rejeitada');
    expect((await db.query(`select count(*)::int as n from messages where body = 'Mensagem que será rejeitada'`)).rows[0].n).toBe(0);
    expect((await api('POST', `/api/frota/mentor/actions/${actionId}/confirm`, tok(A.gestor))).status).toBe(409);
    expect((await db.query(`select status::text as s, executed_at from agent_actions where id = $1`, [actionId])).rows[0]).toMatchObject({ s: 'rejeitada', executed_at: null });
  });

  it('proposta com motorista/veículo de outra empresa é recusada ao modelo e nada é gravado', async () => {
    await reset();
    await setScript([
      use({ name: 'propor_enviar_mensagem', input: { motorista_id: B.mot, texto: 'oi' } },
        { name: 'propor_atribuir_viagem', input: { viagem_id: A.tripAssign, motorista_id: A.mot2, veiculo_id: B.veh } },
        { name: 'propor_reordenar_entregas', input: { viagem_id: A.tripReorder, ordem: [A.reDel[0]] } }),
      text('não foi possível'),
    ]);
    const antes = (await db.query(`select count(*)::int as n from agent_actions where company_id = $1`, [A.co])).rows[0].n;
    const r = await chat(tok(A.gestor), 'tente ações inválidas');
    expect(r.status).toBe(200);
    expect(r.body.pending_confirmation).toBe(false);
    const res = results((await llmCalls()).calls[1]);
    expect(res.every((x) => x.is_error)).toBe(true);
    expect((await db.query(`select count(*)::int as n from agent_actions where company_id = $1`, [A.co])).rows[0].n).toBe(antes);
  });

  it('atribuir viagem e reordenar entregas só executam depois de confirmar', async () => {
    await reset();
    const nova = [A.reDel[2], A.reDel[0], A.reDel[1]];
    await setScript([
      use({ name: 'propor_atribuir_viagem', input: { viagem_id: A.tripAssign, motorista_id: A.mot2, veiculo_id: A.veh } },
        { name: 'propor_reordenar_entregas', input: { viagem_id: A.tripReorder, ordem: nova } }),
      text('duas propostas'),
    ]);
    const r = await chat(tok(A.gestor), 'Atribua a viagem ao A2 e reordene as entregas');
    expect(r.body.actions_proposed).toHaveLength(2);
    const [ida, idr] = r.body.actions_proposed.map((x: any) => x.id as string);
    // antes de confirmar: nada mudou
    expect((await db.query(`select status::text as s, driver_id from trips where id = $1`, [A.tripAssign])).rows[0]).toEqual({ s: 'planejada', driver_id: null });
    expect((await db.query(`select id from deliveries where trip_id = $1 order by sequence`, [A.tripReorder])).rows.map((x) => x.id)).toEqual(A.reDel);

    expect((await api('POST', `/api/frota/mentor/actions/${ida}/confirm`, tok(A.gestor))).body.ok).toBe(true);
    expect((await api('POST', `/api/frota/mentor/actions/${idr}/confirm`, tok(A.gestor))).body.ok).toBe(true);
    expect((await db.query(`select status::text as s, driver_id from trips where id = $1`, [A.tripAssign])).rows[0]).toEqual({ s: 'atribuida', driver_id: A.mot2 });
    expect((await db.query(`select id from deliveries where trip_id = $1 order by sequence`, [A.tripReorder])).rows.map((x) => x.id)).toEqual(nova);
  });

  it('ação que falha na execução vira status falhou com o erro', async () => {
    await reset();
    // propõe atribuir a viagem; antes de confirmar a viagem é concluída → app.assign_trip recusa
    const t = id();
    await db.query(`insert into trips (id, company_id, status, title) values ($1, $2, 'planejada', 'Viagem Falha')`, [t, A.co]);
    await setScript([use({ name: 'propor_atribuir_viagem', input: { viagem_id: t, motorista_id: A.mot1 } }), text('ok')]);
    const r = await chat(tok(A.gestor), 'atribua a viagem falha ao A1');
    const actionId = r.body.actions_proposed[0].id as string;
    await db.query(`update trips set status = 'cancelada' where id = $1`, [t]);
    const c = await api('POST', `/api/frota/mentor/actions/${actionId}/confirm`, tok(A.gestor));
    expect(c.status).toBe(200);
    expect(c.body.ok).toBe(false);
    expect(c.body.action.status).toBe('falhou');
    expect(c.body.action.error).toContain('cancelada');
  });

  it('criar viagem: o roteador interno respeita o veículo e a viagem só nasce na confirmação', async () => {
    await reset();
    await setScript([
      use({ name: 'propor_criar_viagem', input: {
        titulo: 'Viagem criada pelo Mentor', veiculo_id: A.veh, motorista_id: A.mot1,
        origem: { ...PTS.clearanceA, rotulo: 'Vila Leopoldina' }, destino: { ...PTS.clearanceB, rotulo: 'Jaguaré' },
        entregas: [{ cliente: 'Cliente M1', endereco: 'Rua M, 1' }, { cliente: 'Cliente M2', endereco: 'Rua M, 2' }],
      } }),
      text('proposta de viagem'),
    ]);
    const r = await chat(tok(A.gestor), 'Crie uma viagem da Vila Leopoldina ao Jaguaré com o toco, para o A1');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const actionId = r.body.actions_proposed[0].id as string;
    expect((await db.query(`select count(*)::int as n from trips where title = 'Viagem criada pelo Mentor'`)).rows[0].n).toBe(0);
    const c = await api('POST', `/api/frota/mentor/actions/${actionId}/confirm`, tok(A.gestor));
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.ok, JSON.stringify(c.body.action)).toBe(true);
    const t = (await db.query(`select company_id, driver_id, vehicle_id, status::text as s, planned_distance_m, planned_duration_s, ST_NPoints(planned_route) as pts,
                                      route_response->'vehicle'->>'preset_id' as preset from trips where id = $1`, [c.body.action.result.viagem_id])).rows[0];
    expect(t).toMatchObject({ company_id: A.co, driver_id: A.mot1, vehicle_id: A.veh, s: 'atribuida', preset: 'toco' });
    expect(t.planned_distance_m).toBeGreaterThan(1000);
    expect(t.pts).toBeGreaterThan(5);
    expect((await db.query(`select customer_name, sequence from deliveries where trip_id = $1 order by sequence`, [c.body.action.result.viagem_id])).rows)
      .toEqual([{ customer_name: 'Cliente M1', sequence: 1 }, { customer_name: 'Cliente M2', sequence: 2 }]);
  });
});

describe('isolamento entre empresas e entre gestores', () => {
  it('gestor da empresa B não vê conversa nem ação da A (nem age sobre elas)', async () => {
    const act = (await db.query(`select id, conversation_id from agent_actions where company_id = $1 and status = 'proposta' limit 1`, [A.co])).rows[0]
      ?? (await (async () => {
        await reset();
        await setScript([use({ name: 'propor_enviar_mensagem', input: { motorista_id: A.mot1, texto: 'pendente' } }), text('p')]);
        const r = await chat(tok(A.gestor), 'proponha uma mensagem pendente');
        return { id: r.body.actions_proposed[0].id, conversation_id: r.body.conversation_id };
      })());
    const tb = tok(B.gestor);
    const list = await api('GET', '/api/frota/mentor/actions', tb);
    expect(list.status).toBe(200);
    expect(list.body.actions).toEqual([]);
    expect((await api('POST', `/api/frota/mentor/actions/${act.id}/confirm`, tb)).status).toBe(404);
    expect((await api('POST', `/api/frota/mentor/actions/${act.id}/reject`, tb)).status).toBe(404);
    expect((await api('GET', '/api/frota/mentor/conversations', tb)).body.conversations).toEqual([]);
    expect((await api('GET', `/api/frota/mentor/conversations/${act.conversation_id}`, tb)).status).toBe(404);
    expect((await chat(tb, 'continue a conversa da A', act.conversation_id)).status).toBe(404);
    expect((await db.query(`select status::text as s from agent_actions where id = $1`, [act.id])).rows[0].s).toBe('proposta');

    // conversa é privada do gestor que conversou: o outro gestor da mesma empresa também não a vê
    const t2 = tok(A.gestor2);
    expect((await api('GET', `/api/frota/mentor/conversations/${act.conversation_id}`, t2)).status).toBe(404);
    expect((await chat(t2, 'continue', act.conversation_id)).status).toBe(404);
    expect((await api('GET', `/api/frota/mentor/conversations/${act.conversation_id}`, tok(A.gestor))).status).toBe(200);
  });

  it('a B só enxerga os próprios dados nas tools', async () => {
    await reset();
    await setScript([use({ name: 'kpi_atrasos_por_motorista' }, { name: 'posicao_atual' }, { name: 'listar_cadastros', input: { tipo: 'viagens' } }), text('ok')]);
    const r = await chat(tok(B.gestor), 'kpis');
    expect(r.status).toBe(200);
    const all = results((await llmCalls()).calls[1]).map((x) => x.content).join('\n');
    expect(all).toContain('Motorista B');
    for (const marca of ['Motorista A1', 'TST1A23', 'Mercado Alfa', 'Rota Centro A']) expect(all).not.toContain(marca);
  });
});

describe('Second Brain', () => {
  it('embedder local: 1024 dimensões, norma 1, determinístico; textos parecidos ficam mais perto', async () => {
    const e = new LocalHashEmbedder();
    const [a, a2, b, c] = await e.embed(['entrega atrasada no cliente Mercado Alfa', 'entrega atrasada no cliente Mercado Alfa', 'entregas atrasadas para o Mercado Alfa', 'abastecimento no posto da rodovia'], 'document');
    expect(a).toHaveLength(1024);
    expect(Math.hypot(...a)).toBeCloseTo(1, 6);
    expect(a2).toEqual(a);
    const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i], 0);
    expect(dot(a, b)).toBeGreaterThan(dot(a, c) + 0.3);
    expect((await e.embed([''], 'query'))[0]).toHaveLength(1024);   // texto vazio não gera vetor nulo
  });

  it('embedder Voyage: corpo da requisição (voyage-3.5, 1024, input_type) e ordem dos vetores', async () => {
    const orig = globalThis.fetch;
    let seen: any;
    globalThis.fetch = (async (_url: any, init: any) => {
      seen = { url: String(_url), headers: init.headers, body: JSON.parse(init.body) };
      const data = seen.body.input.map((_: string, i: number) => ({ index: i, embedding: new Array(1024).fill(i + 1) })).reverse();
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as typeof fetch;
    try {
      const v = new VoyageEmbedder('chave-falsa');
      const out = await v.embed(['um', 'dois'], 'query');
      expect(seen.url).toBe('https://api.voyageai.com/v1/embeddings');
      expect(seen.headers.authorization).toBe('Bearer chave-falsa');
      expect(seen.body).toMatchObject({ model: 'voyage-3.5', input_type: 'query', output_dimension: 1024, input: ['um', 'dois'] });
      expect(out[0][0]).toBe(1); expect(out[1][0]).toBe(2);
      expect(v.model).toBe('voyage-3.5');
    } finally { globalThis.fetch = orig; }
  });

  it('job exige service_role', async () => {
    expect((await api('POST', '/api/frota/jobs/brain', tok(A.gestor), {})).status).toBe(403);
    expect((await api('POST', '/api/frota/jobs/brain', undefined, {})).status).toBe(401);
  });

  it('resumo factual (sem chave): fatos do SQL em trips.summary + documentos com embedding; idempotente', async () => {
    await api('POST', '/__test/summary_mode', undefined, { mode: 'fatos' });
    const run = await api('POST', '/api/frota/jobs/brain', SERVICE, { company_ids: [A.co, B.co], idle_minutes: 0 });
    expect(run.status, JSON.stringify(run.body)).toBe(200);
    expect(run.body.errors).toEqual([]);
    expect(run.body).toMatchObject({ embedding_model: 'local-hash-1024-v1', trips_summarized: 2, delivery_docs: 3 });   // A: atraso + falha; B: falha
    expect(run.body.conversation_docs).toBeGreaterThanOrEqual(1);

    const t = (await db.query(`select summary, summary_generated_at from trips where id = $1`, [A.tripDone])).rows[0];
    expect(t.summary_generated_at).toBeTruthy();
    for (const frag of ['Rota Centro A', 'Motorista A1', 'TST1A23', 'CD Barueri', 'Centro SP', 'planejado 12,0 km em 30min', 'feito 13,0 km em 40min',
      'Desvio máximo da rota planejada: 350 m', 'entrega: 1 (30min', 'descanso: 1 (20min', '3 — 2 entregue(s), 1 falha(s), 0 pendente(s); 1 entregue(s) fora da janela',
      'ATRASO de 25min', 'FALHOU', 'cliente ausente', 'Mensagens da viagem: 2', 'Atenção ao horário', '(via Mentor)'])
      expect(t.summary, frag).toContain(frag);
    expect(t.summary).not.toContain('Cliente-B-Secreto');

    const docs = (await db.query(`select company_id, source_type, source_id, embedding is not null as emb, embedding_model, title from knowledge_docs where company_id = any($1)`, [[A.co, B.co]])).rows;
    const trip = docs.find((d) => d.source_type === 'trip' && d.source_id === A.tripDone);
    expect(trip).toMatchObject({ company_id: A.co, emb: true, embedding_model: 'local-hash-1024-v1' });
    expect(docs.filter((d) => d.source_type === 'delivery' && d.company_id === A.co).map((d) => d.title).sort()).toEqual(['Entrega atrasada — Mercado Alfa', 'Entrega falhou — Farmácia Beta']);
    expect(docs.filter((d) => d.company_id === B.co && d.source_type === 'delivery')).toHaveLength(1);
    expect(docs.every((d) => d.emb)).toBe(true);

    // segunda rodada: nada a fazer
    const again = await api('POST', '/api/frota/jobs/brain', SERVICE, { company_ids: [A.co, B.co], idle_minutes: 0 });
    expect(again.body).toMatchObject({ trips_summarized: 0, trips_docs_rebuilt: 0, delivery_docs: 0, conversation_docs: 0, embeddings_filled: 0, errors: [] });

    // troca de modelo de embedding / embedding faltando → o job refaz só o que precisa
    await db.query(`update knowledge_docs set embedding_model = 'outro-modelo' where id = (select id from knowledge_docs where company_id = $1 and source_type = 'trip' limit 1)`, [A.co]);
    await db.query(`update knowledge_docs set embedding = null, embedding_model = null where id = (select id from knowledge_docs where company_id = $1 and source_type = 'delivery' limit 1)`, [A.co]);
    const fix = await api('POST', '/api/frota/jobs/brain', SERVICE, { company_ids: [A.co, B.co], idle_minutes: 0 });
    expect(fix.body.embeddings_filled).toBe(2);
    expect((await db.query(`select count(*)::int as n from knowledge_docs where company_id = $1 and (embedding is null or embedding_model <> 'local-hash-1024-v1')`, [A.co])).rows[0].n).toBe(0);
  });

  it('resumo com modelo: o texto do Claude é gravado, partindo dos fatos', async () => {
    await reset();
    await api('POST', '/__test/summary_mode', undefined, { mode: 'fake' });
    const t = id();
    await db.query(`insert into trips (id, company_id, driver_id, status, title, started_at, ended_at) values ($1, $2, $3, 'concluida', 'Viagem Com LLM', $4, $5)`, [t, A.co, A.mot2, day(-1, '08:00'), day(-1, '09:00')]);
    const run = await api('POST', '/api/frota/jobs/brain', SERVICE, { company_ids: [A.co], idle_minutes: 1440 });
    expect(run.body).toMatchObject({ trips_summarized: 1, errors: [] });
    const { summary_calls } = await llmCalls();
    expect(summary_calls).toHaveLength(1);
    expect(summary_calls[0].model).toBe('claude-haiku-5-5');
    expect(summary_calls[0].messages[0].content).toContain('Motorista A2');          // recebeu os fatos
    expect(summary_calls[0].system).toContain('SOMENTE os fatos');
    const row = (await db.query(`select summary from trips where id = $1`, [t])).rows[0];
    expect(row.summary).toMatch(/^RESUMO-FAKE: Viagem: Viagem Com LLM/);
    const doc = (await db.query(`select content, metadata from knowledge_docs where source_id = $1`, [t])).rows[0];
    expect(doc.content).toContain('Fatos:');
    expect(doc.metadata.summary_source).toBe('llm');
    await api('POST', '/__test/summary_mode', undefined, { mode: 'fatos' });
  });

  it('busca semântica (embedder local): acha o caso certo e nunca devolve documento de outra empresa', async () => {
    const e = new LocalHashEmbedder();
    const [q] = await e.embed(['entrega que falhou por cliente ausente'], 'query');
    const hitsA = await withRls({ sub: A.gestor, role: 'authenticated' }, (c) => c.query(`select * from app.search_knowledge($1, $2::vector, 5)`, [A.co, vectorLiteral(q)]));
    expect(hitsA.rows.length).toBeGreaterThan(0);
    expect(hitsA.rows[0].title).toBe('Entrega falhou — Farmácia Beta');
    expect(hitsA.rows.some((r) => String(r.content).includes('Cliente-B-Secreto'))).toBe(false);
    // chamando com a empresa errada, a RLS esvazia
    const cross = await withRls({ sub: A.gestor, role: 'authenticated' }, (c) => c.query(`select * from app.search_knowledge($1, $2::vector, 5)`, [B.co, vectorLiteral(q)]));
    expect(cross.rows).toEqual([]);

    // pela tool do Mentor
    await reset();
    await setScript([use({ name: 'buscar_conhecimento', input: { pergunta: 'entrega falhou cliente ausente', limite: 3 } }), text('achei')]);
    const r = await chat(tok(A.gestor), 'Por que a entrega da Farmácia Beta falhou?');
    expect(r.status).toBe(200);
    const res = results((await llmCalls()).calls[1])[0];
    expect(res.is_error).toBeUndefined();
    expect(res.json.modelo_embedding).toBe('local-hash-1024-v1');
    expect(res.json.resultados[0].titulo).toBe('Entrega falhou — Farmácia Beta');
    expect(res.json.resultados[0].similaridade).toBeGreaterThan(0.2);
    expect(res.content).not.toContain('Cliente-B-Secreto');
  });

  it('conversas anteriores só aparecem na busca para o gestor que conversou', async () => {
    const buscar = async (t: string) => {
      await reset();
      await setScript([use({ name: 'buscar_conhecimento', input: { pergunta: 'Pergunta Como foi a operação nos últimos dias', tipos: ['conversation'], limite: 12 } }), text('ok')]);
      const r = await chat(t, 'busque conversas');
      expect(r.status).toBe(200);
      return results((await llmCalls()).calls[1])[0].json.resultados as any[];
    };
    const meus = await buscar(tok(A.gestor));
    expect(meus.length).toBeGreaterThan(0);
    expect(meus.every((x) => x.tipo === 'conversation')).toBe(true);
    // a conversa nova (esta própria busca) ainda não virou documento: o gestor 2 não pode ver nenhuma das do gestor 1
    const dele = await buscar(tok(A.gestor2));
    expect(dele).toEqual([]);
    const docs = (await db.query(`select metadata->>'user_id' as u from knowledge_docs where company_id = $1 and source_type = 'conversation'`, [A.co])).rows;
    expect(docs.every((d) => d.u === A.gestor)).toBe(true);
  });
});
