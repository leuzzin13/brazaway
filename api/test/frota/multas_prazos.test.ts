import { DateTime } from 'luxon';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signJwt } from '../../src/frota/auth.js';
import { pool } from '../helpers.js';

/**
 * Prazos das multas (migration 0406 e frota/multas_prazos.ts): prazo de indicação calculado da notificação, indicação do
 * condutor em lote com formulário, lista de prazos com a NIC estimada e o valor a pagar (60/80/100%), adesão ao SNE.
 * Precisa da API (API_URL) e do Postgres com a 0406:
 *   API_URL=http://localhost:3603 npx vitest run test/frota/multas_prazos.test.ts
 * Empresas e usuários com ids próprios (prefixo a17a), criados no beforeAll como superusuário e apagados no afterAll.
 */
const BASE = process.env.API_URL ?? 'http://localhost:3100';

const id = (n: number) => `a17a0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CO_A = id(1), CO_B = id(2);
const OWNER_A = id(11), GESTOR_A = id(12), MOT_A = id(13), OWNER_B = id(21), MOT_B = id(22);
const ALL_USERS = [OWNER_A, GESTOR_A, MOT_A, OWNER_B, MOT_B];
const VEH_A = id(31);

const tok = (sub: string) => signJwt({ sub, role: 'authenticated' });
const T = { ownerA: tok(OWNER_A), gestorA: tok(GESTOR_A), motA: tok(MOT_A), ownerB: tok(OWNER_B), motB: tok(MOT_B) };

async function call(method: string, path: string, token?: string | null, body?: unknown) {
  const res = await fetch(`${BASE}/api/frota${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

const hoje = DateTime.now().setZone('America/Sao_Paulo').startOf('day');
const dia = (n: number) => hoje.plus({ days: n }).toISODate()!;
const br = (d: string) => d.split('-').reverse().join('/');
const quando = (n: number) => hoje.plus({ days: n, hours: 10 }).toISO()!;

/** multa direto no banco (superusuário); devolve o id */
async function multa(f: Record<string, unknown>) {
  const cols = Object.keys(f);
  const r = await pool.query(`insert into multas (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, Object.values(f));
  return r.rows[0].id as string;
}
const linha = async (mid: string) => (await pool.query(
  `select status::text as status, prazo_indicacao::text as prazo_indicacao, notificada_em::text as notificada_em, sne,
          condutor_indicado_em, condutor_indicado_por from multas where id = $1`, [mid])).rows[0];

async function wipe() {
  await pool.query('delete from companies where id = any($1::uuid[])', [[CO_A, CO_B]]);
  await pool.query('delete from auth.users where id = any($1::uuid[])', [ALL_USERS]);
}

beforeAll(async () => {
  await wipe();
  await pool.query(`insert into auth.users (id, email) select u, 'prazos-' || right(u::text, 4) || '@teste' from unnest($1::uuid[]) u`, [ALL_USERS]);
  await pool.query(`insert into companies (id, name) values ($1, 'Prazos Teste A'), ($2, 'Prazos Teste B')`, [CO_A, CO_B]);
  await pool.query(`insert into company_members (company_id, user_id, role, display_name) values
      ($1, $3, 'owner', 'Dona A'), ($1, $4, 'gestor', 'Gestor A'), ($1, $5, 'motorista', 'Motorista A'),
      ($2, $6, 'owner', 'Dono B'), ($2, $7, 'motorista', 'Motorista B')`, [CO_A, CO_B, OWNER_A, GESTOR_A, MOT_A, OWNER_B, MOT_B]);
  await pool.query(`insert into vehicles (id, company_id, plate, preset) values ($1, $2, 'PRZ1A23', 'toco')`, [VEH_A, CO_A]);
});

afterAll(async () => { await wipe(); });

describe('trigger: prazo de indicação = notificação + 30 dias', () => {
  it('no banco: notificada_em preenche o prazo; prazo informado é mantido; nova notificação recalcula o prazo calculado', async () => {
    const a = await multa({ company_id: CO_A, ocorrida_em: quando(-20), notificada_em: '2026-10-05', status: 'notificada' });
    expect((await linha(a)).prazo_indicacao).toBe('2026-11-04');
    const b = await multa({ company_id: CO_A, ocorrida_em: quando(-20), notificada_em: '2026-10-05', prazo_indicacao: '2026-10-20' });
    expect((await linha(b)).prazo_indicacao).toBe('2026-10-20');
    await pool.query(`update multas set notificada_em = '2026-10-10' where id = any($1::uuid[])`, [[a, b]]);
    expect((await linha(a)).prazo_indicacao).toBe('2026-11-09');     // era o calculado: acompanha a notificação
    expect((await linha(b)).prazo_indicacao).toBe('2026-10-20');     // informado à mão: fica
    await pool.query('delete from multas where id = any($1::uuid[])', [[a, b]]);
  });

  it('pela API: a equipe envia notificada_em, vencimento e sne; o motorista não consegue', async () => {
    const r = await call('POST', '/multas', T.ownerA, {
      ocorrida_em: quando(-15), notificada_em: dia(-10), vencimento: dia(20), sne: true, valor_cents: 19353, enquadramento: '218-III',
      driver_id: MOT_A, vehicle_id: VEH_A, status: 'notificada',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ notificada_em: dia(-10), vencimento: dia(20), sne: true, condutor_indicado_em: null, dias_para_indicar: 20 });
    expect((await linha(r.body.id)).prazo_indicacao).toBe(dia(20));
    const p = await call('PATCH', `/multas/${r.body.id}`, T.gestorA, { notificada_em: dia(-5), vencimento: dia(25), sne: false });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ notificada_em: dia(-5), vencimento: dia(25), sne: false, dias_para_indicar: 25 });
    expect((await call('PATCH', `/multas/${r.body.id}`, T.motA, { sne: true })).status).toBe(403);
    expect((await call('PATCH', `/multas/${r.body.id}`, T.ownerA, { notificada_em: '05/10/2026' })).status).toBe(422);

    const m = await call('POST', '/multas', T.motA, { ocorrida_em: quando(-1), descricao: 'Parado na balança', notificada_em: dia(-1), sne: true, vencimento: dia(5) });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    expect(m.body).toMatchObject({ notificada_em: null, vencimento: null, sne: false, prazo_indicacao: null, status: 'registrada' });
    await pool.query('delete from multas where company_id = $1', [CO_A]);
  });

  it('no banco: motorista inserindo direto (cliente do Supabase) não grava os campos de prazo', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: MOT_A, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      const r = await c.query(
        `insert into multas (company_id, driver_id, ocorrida_em, origem, notificada_em, sne, vencimento)
         values ($1, $2, now(), 'motorista', '2026-10-01', true, '2026-12-01') returning notificada_em, sne, vencimento, prazo_indicacao`, [CO_A, MOT_A]);
      expect(r.rows[0]).toMatchObject({ notificada_em: null, sne: false, vencimento: null, prazo_indicacao: null });
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});

describe('POST /multas/indicar-condutor', () => {
  const S: Record<string, string> = {};
  beforeAll(async () => {
    S.ok = await multa({ company_id: CO_A, driver_id: MOT_A, vehicle_id: VEH_A, ocorrida_em: quando(-12), notificada_em: dia(-8), status: 'notificada',
                         ait: 'IND0001', orgao: 'PRF', local: 'BR-116 km 220', enquadramento: '218-I' });
    S.semCondutor = await multa({ company_id: CO_A, vehicle_id: VEH_A, ocorrida_em: quando(-12), notificada_em: dia(-8), status: 'notificada', ait: 'IND0002' });
    S.paga = await multa({ company_id: CO_A, driver_id: MOT_A, ocorrida_em: quando(-40), status: 'paga', ait: 'IND0003' });
    S.vencida = await multa({ company_id: CO_A, driver_id: MOT_A, ocorrida_em: quando(-50), notificada_em: dia(-45), status: 'registrada', ait: 'IND0004' });
    S.deB = await multa({ company_id: CO_B, driver_id: MOT_B, ocorrida_em: quando(-12), notificada_em: dia(-8), status: 'notificada', ait: 'IND0005' });
  });
  afterAll(async () => { await pool.query('delete from multas where company_id = any($1::uuid[])', [[CO_A, CO_B]]); });

  it('motorista → 403; corpo inválido → 422', async () => {
    expect((await call('POST', '/multas/indicar-condutor', T.motA, { ids: [S.ok] })).status).toBe(403);
    expect((await linha(S.ok)).status).toBe('notificada');
    expect((await call('POST', '/multas/indicar-condutor', T.ownerA, { ids: [] })).status).toBe(422);
    expect((await call('POST', '/multas/indicar-condutor', T.ownerA, { ids: ['x'] })).status).toBe(422);
  });

  it('outra empresa não acessa: a multa de A fica como estava', async () => {
    const r = await call('POST', '/multas/indicar-condutor', T.ownerB, { ids: [S.ok] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ indicadas: 0, items: [{ id: S.ok, ok: false, motivo: 'não encontrada', formulario: null }] });
    expect((await linha(S.ok)).status).toBe('notificada');
  });

  it('indica em lote: status, quem e quando, formulário; motivos de quem não foi', async () => {
    const r = await call('POST', '/multas/indicar-condutor', T.gestorA, { ids: [S.ok, S.semCondutor, S.paga, S.deB, S.vencida] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.indicadas).toBe(2);
    const by = Object.fromEntries(r.body.items.map((x: any) => [x.id, x]));
    expect(by[S.ok]).toMatchObject({
      ok: true,
      formulario: {
        condutor: 'Motorista A', placa: 'PRZ1A23', ait: 'IND0001', orgao: 'PRF', local: 'BR-116 km 220', enquadramento: '218-I',
        prazo_indicacao: dia(22),
        instrucao: `Imprima, colha a assinatura do condutor e envie ao órgão autuador até ${br(dia(22))}. O BrasaWay não envia ao órgão.`,
      },
    });
    expect(by[S.ok].motivo).toBeUndefined();
    expect(by[S.ok].formulario.aviso).toBeUndefined();
    expect(DateTime.fromISO(by[S.ok].formulario.ocorrida_em).toMillis()).toBe(DateTime.fromISO(quando(-12)).toMillis());
    expect(by[S.semCondutor]).toMatchObject({ ok: false, motivo: 'sem condutor', formulario: null });
    expect(by[S.paga]).toMatchObject({ ok: false, motivo: 'status paga' });
    expect(by[S.deB]).toMatchObject({ ok: false, motivo: 'não encontrada' });
    expect(by[S.vencida]).toMatchObject({ ok: true, formulario: { prazo_indicacao: dia(-15), aviso: expect.stringContaining('NIC') } });

    const l = await linha(S.ok);
    expect(l.status).toBe('condutor_indicado');
    expect(l.condutor_indicado_por).toBe(GESTOR_A);
    expect(Date.now() - new Date(l.condutor_indicado_em).getTime()).toBeLessThan(60_000);
    expect((await linha(S.semCondutor)).status).toBe('notificada');
    expect((await linha(S.deB)).status).toBe('notificada');

    const de2 = await call('POST', '/multas/indicar-condutor', T.ownerA, { ids: [S.ok] });
    expect(de2.body.items[0]).toMatchObject({ ok: false, motivo: 'já indicada', formulario: { condutor: 'Motorista A' } });
    expect((await linha(S.ok)).condutor_indicado_por).toBe(GESTOR_A);       // não sobrescreve quem indicou
  });

  it('voltar para notificada desfaz a indicação (quem e quando)', async () => {
    const p = await call('PATCH', `/multas/${S.ok}`, T.ownerA, { status: 'notificada' });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ status: 'notificada', condutor_indicado_em: null, condutor_indicado_por: null });
  });
});

describe('GET /multas/prazos', () => {
  const S: Record<string, string> = {};
  beforeAll(async () => {
    await pool.query('update companies set sne_aderida_em = null where id = $1', [CO_A]);
    // indicação: prazo vencido, em 3 dias, em 12 dias, em 40 dias (fora da janela de 15) e uma já indicada
    S.vencida = await multa({ company_id: CO_A, driver_id: MOT_A, ocorrida_em: quando(-40), notificada_em: dia(-32), status: 'notificada',
                              enquadramento: '187-I', valor_cents: 13016 });
    // a mesma infração 100 dias antes (paga): conta para a NIC da de 3 dias
    S.anterior = await multa({ company_id: CO_A, driver_id: MOT_A, ocorrida_em: quando(-120), status: 'paga', enquadramento: '218-II', valor_cents: 19353 });
    S.em3 = await multa({ company_id: CO_A, driver_id: MOT_A, ocorrida_em: quando(-30), notificada_em: dia(-27), status: 'notificada',
                         enquadramento: '218-II', valor_cents: 19353 });
    S.em12 = await multa({ company_id: CO_A, ocorrida_em: quando(-20), notificada_em: dia(-18), status: 'registrada', restricao: 'zmrc-sp', valor_cents: 13016 });
    S.em40 = await multa({ company_id: CO_A, driver_id: MOT_A, ocorrida_em: quando(-1), notificada_em: dia(10), status: 'notificada', valor_cents: 8838 });
    S.indicada = await multa({ company_id: CO_A, driver_id: MOT_A, ocorrida_em: quando(-30), notificada_em: dia(-27), status: 'condutor_indicado', valor_cents: 8838 });
    // a de outra empresa com o mesmo enquadramento não conta
    S.deB = await multa({ company_id: CO_B, ocorrida_em: quando(-60), status: 'paga', enquadramento: '218-II', valor_cents: 19353 });
    // pagamento: vence em 10 dias com SNE, em 10 dias sem SNE, venceu ontem, em recurso com SNE, já paga
    S.pSne = await multa({ company_id: CO_A, ocorrida_em: quando(-50), status: 'condutor_indicado', vencimento: dia(10), sne: true, valor_cents: 10000 });
    S.pSemSne = await multa({ company_id: CO_A, ocorrida_em: quando(-50), status: 'condutor_indicado', vencimento: dia(10), valor_cents: 20000 });
    S.pVencida = await multa({ company_id: CO_A, ocorrida_em: quando(-80), status: 'condutor_indicado', vencimento: dia(-1), sne: true, valor_cents: 30000 });
    S.pRecurso = await multa({ company_id: CO_A, ocorrida_em: quando(-50), status: 'em_recurso', prazo_pagamento: dia(10), sne: true, valor_cents: 40000 });
    S.pPaga = await multa({ company_id: CO_A, ocorrida_em: quando(-50), status: 'paga', vencimento: dia(10), valor_cents: 50000 });
  });
  afterAll(async () => { await pool.query('delete from multas where company_id = any($1::uuid[])', [[CO_A, CO_B]]); });

  it('motorista → 403; outra empresa não vê as multas de A', async () => {
    expect((await call('GET', '/multas/prazos', T.motA)).status).toBe(403);
    expect((await call('GET', '/multas/prazos?dias=500', T.ownerA)).status).toBe(422);
    const b = await call('GET', '/multas/prazos', T.ownerB);
    expect(b.status).toBe(200);
    expect(b.body.pagamento).toEqual([]);
    expect(b.body.resumo).toMatchObject({ vencidas: 0, ate_7_dias: 0, nic_risco_cents: 0 });
  });

  it('indicação em grupos, dias restantes e NIC estimada (×2 com a mesma infração em 12 meses, ×1 sozinha)', async () => {
    const r = await call('GET', '/multas/prazos', T.gestorA);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const { indicacao } = r.body;
    expect(Object.keys(indicacao).sort()).toEqual(['ate_15_dias', 'ate_7_dias', 'vencida']);
    expect(indicacao.vencida.map((x: any) => x.id)).toEqual([S.vencida]);
    expect(indicacao.ate_7_dias.map((x: any) => x.id)).toEqual([S.em3]);
    expect(indicacao.ate_15_dias.map((x: any) => x.id)).toEqual([S.em12]);
    expect(indicacao.vencida[0]).toMatchObject({ dias_restantes: -2, prazo_indicacao: dia(-2), infracoes_iguais_12m: 1, nic_estimado_cents: 13016, tem_condutor: true });
    expect(indicacao.ate_7_dias[0]).toMatchObject({ dias_restantes: 3, infracoes_iguais_12m: 2, nic_estimado_cents: 2 * 19353, driver_name: 'Motorista A' });
    expect(indicacao.ate_15_dias[0]).toMatchObject({ dias_restantes: 12, infracoes_iguais_12m: 1, nic_estimado_cents: 13016, tem_condutor: false });
    expect(r.body.resumo).toMatchObject({ vencidas: 1, ate_7_dias: 1, ate_15_dias: 1, nic_risco_cents: 13016 + 2 * 19353 + 13016 });

    const r45 = await call('GET', '/multas/prazos?dias=45', T.ownerA);
    expect(r45.body.indicacao.ate_45_dias.map((x: any) => x.id)).toEqual([S.em12, S.em40]);
  });

  it('pagamento sem SNE aderido: 80% até o vencimento, 100% depois; economia possível com o SNE', async () => {
    const r = await call('GET', '/multas/prazos', T.ownerA);
    const by = Object.fromEntries(r.body.pagamento.map((x: any) => [x.id, x]));
    expect(Object.keys(by).sort()).toEqual([S.pSne, S.pSemSne, S.pVencida, S.pRecurso].sort());
    expect(by[S.pSne]).toMatchObject({ vencimento: dia(10), dias_para_vencer: 10, percentual: 80, valor_a_pagar_cents: 8000, economia_cents: 2000, economia_sne_possivel_cents: 2000 });
    expect(by[S.pSemSne]).toMatchObject({ percentual: 80, valor_a_pagar_cents: 16000, economia_sne_possivel_cents: 4000 });
    expect(by[S.pVencida]).toMatchObject({ vencida: true, percentual: 100, valor_a_pagar_cents: 30000, economia_cents: 0, economia_sne_possivel_cents: 0 });
    expect(by[S.pRecurso]).toMatchObject({ vencimento: dia(10), percentual: 80, valor_a_pagar_cents: 32000, economia_sne_possivel_cents: 0 });
    expect(r.body.resumo).toMatchObject({ sne_aderida: false, sne_aderida_em: null, economia_sne_possivel_cents: 6000, a_pagar_cents: 8000 + 16000 + 30000 + 32000 });
  });

  it('com SNE aderido: 60% na multa do SNE sem recurso; as outras continuam 80/100', async () => {
    expect((await call('PATCH', '/empresa/sne', T.ownerA, { aderida: true })).status).toBe(200);
    const r = await call('GET', '/multas/prazos', T.ownerA);
    const by = Object.fromEntries(r.body.pagamento.map((x: any) => [x.id, x]));
    expect(by[S.pSne]).toMatchObject({ percentual: 60, valor_a_pagar_cents: 6000, economia_cents: 4000, economia_sne_possivel_cents: 0 });
    expect(by[S.pSemSne]).toMatchObject({ percentual: 80, valor_a_pagar_cents: 16000, economia_sne_possivel_cents: 4000 });
    expect(by[S.pVencida]).toMatchObject({ percentual: 100, valor_a_pagar_cents: 30000 });
    expect(by[S.pRecurso]).toMatchObject({ percentual: 80, valor_a_pagar_cents: 32000 });
    expect(r.body.resumo).toMatchObject({ sne_aderida: true, sne_aderida_em: dia(0), economia_sne_possivel_cents: 4000 });
  });
});

describe('PATCH /empresa/sne', () => {
  it('gestor adere e desfaz; aderir de novo mantém a data; motorista → 403; não mexe na outra empresa', async () => {
    await pool.query('update companies set sne_aderida_em = null where id = any($1::uuid[])', [[CO_A, CO_B]]);
    expect((await call('PATCH', '/empresa/sne', T.motA, { aderida: true })).status).toBe(403);
    expect((await call('PATCH', '/empresa/sne', T.gestorA, { aderida: 'sim' })).status).toBe(422);
    const a = await call('PATCH', '/empresa/sne', T.gestorA, { aderida: true });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body).toEqual({ sne_aderida: true, sne_aderida_em: dia(0) });
    await pool.query(`update companies set sne_aderida_em = '2026-01-15' where id = $1`, [CO_A]);
    expect((await call('PATCH', '/empresa/sne', T.ownerA, { aderida: true })).body).toEqual({ sne_aderida: true, sne_aderida_em: '2026-01-15' });
    expect((await pool.query('select sne_aderida_em from companies where id = $1', [CO_B])).rows[0].sne_aderida_em).toBeNull();
    expect((await call('PATCH', '/empresa/sne', T.gestorA, { aderida: false })).body).toEqual({ sne_aderida: false, sne_aderida_em: null });
    expect((await pool.query('select sne_aderida_em from companies where id = $1', [CO_A])).rows[0].sne_aderida_em).toBeNull();
  });
});
