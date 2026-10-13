import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { get, midpointOf, pool, post, PTS, route, TRUCK_410, waitForStack } from '../helpers.js';

/**
 * Reportes da comunidade "radar_movel" e "blitz" (migration 0400): informativos, nunca bloqueiam a rota.
 * Só geram aviso (radar_movel_reportado / blitz_reportada) com idade e votos; expiram 2 h depois do último voto positivo
 * ou da criação; score < -2 desativa como os demais tipos; sem value_num.
 */
const DEV = 'radar-blitz-test-0001';
const VOTERS = ['voter-000000-a', 'voter-000000-b', 'voter-000000-c', 'voter-000000-d', 'voter-000000-e'];
const DEP = '2026-10-13T22:30';
const pt = (p: { lat: number; lon: number }) => ({ type: 'Point', coordinates: [p.lon, p.lat] });

async function cleanup() { await pool.query(`delete from reports where device_id = $1`, [DEV]); }
const create = (type: string, p: { lat: number; lon: number }, extra: Record<string, unknown> = {}) =>
  post('/api/reports', { type, geometry: pt(p), device_id: DEV, ...extra });
const vote = (id: string, device_id: string, v: 1 | -1) => post(`/api/reports/${id}/votes`, { device_id, vote: v });
const listIds = async (p: { lat: number; lon: number }) => {
  const d = 0.01;
  const r = await get(`/api/reports?bbox=${p.lon - d},${p.lat - d},${p.lon + d},${p.lat + d}`);
  expect(r.status).toBe(200);
  return (r.body as any[]).map((x) => x.id as string);
};
const age = (id: string, interval: string) => pool.query(`update reports set created_at = now() - $2::interval where id = $1`, [id, interval]);

describe('Reportes radar_movel e blitz', () => {
  let mid: { lat: number; lon: number };
  let baseGeom: number[][];

  beforeAll(async () => {
    await waitForStack();
    await cleanup();
    const free = await route({ origin: PTS.clearanceA, destination: PTS.clearanceB, vehicle: TRUCK_410, departure_at: DEP });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    mid = midpointOf(free.body);
    baseGeom = free.body.geometry.coordinates;
  });
  beforeEach(cleanup);
  afterAll(async () => { await cleanup(); await pool.end(); });

  it('cria os dois tipos sem value_num (ignora o valor enviado) e expõe expires_at', async () => {
    const a = await create('radar_movel', mid, { note: 'viatura com radar' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.type).toBe('radar_movel');
    expect(a.body.value_num).toBeNull();
    expect(a.body.status).toBe('active');
    const ms = new Date(a.body.expires_at).getTime() - new Date(a.body.created_at).getTime();
    expect(ms).toBe(2 * 3600 * 1000);
    const b = await create('blitz', mid, { value_num: 5 });
    expect(b.status).toBe(201);
    expect(b.body.value_num).toBeNull();
    expect(b.body.expires_at).toBeTruthy();
    // tipos de medida continuam exigindo value_num e não têm expires_at
    const c = await create('low_clearance', mid);
    expect(c.status).toBe(422);
    const ok = await create('low_clearance', mid, { value_num: 3.9 });
    expect(ok.status).toBe(201);
    expect(ok.body.expires_at).toBeNull();
    const bad = await create('radar_fixo', mid);
    expect(bad.status).toBe(422);
  });

  it('banco recusa value_num nos tipos informativos (constraint)', async () => {
    await expect(pool.query(
      `insert into reports (type, geom, value_num, device_id) values ('blitz', ST_SetSRID(ST_MakePoint(-46.7,-23.5),4326), 3, $1)`, [DEV],
    )).rejects.toThrow(/reports_value_required/);
  });

  it('votos: confirmar e negar mudam o score; 4 negações desativam (score < -2)', async () => {
    const r = await create('blitz', mid);
    const id = r.body.id as string;
    expect((await vote(id, VOTERS[0], 1)).body.score).toBe(1);
    expect((await vote(id, VOTERS[1], 1)).body.score).toBe(2);
    expect((await vote(id, VOTERS[1], -1)).body.score).toBe(0);   // mudou de ideia
    for (const v of VOTERS.slice(1, 4)) await vote(id, v, -1);
    let s = await vote(id, VOTERS[4], -1);
    expect(s.body.score).toBe(-4 + 1);                              // +1 (a) e -4 (b..e)
    expect(s.body.status).toBe('disabled');
    expect(await listIds(mid)).not.toContain(id);
    // dois votos a menos negativos reativam (limite é score < -2)
    await vote(id, VOTERS[4], 1);
    s = await vote(id, VOTERS[3], 1);
    expect(s.body.status).toBe('active');
  });

  it('expira 2 h depois da criação sem confirmação', async () => {
    const fresh = (await create('radar_movel', mid)).body.id as string;
    const old = (await create('blitz', mid)).body.id as string;
    const justUnder = (await create('blitz', mid)).body.id as string;
    await age(old, '2 hours 5 minutes');
    await age(justUnder, '1 hour 55 minutes');
    const ids = await listIds(mid);
    expect(ids).toContain(fresh);
    expect(ids).toContain(justUnder);
    expect(ids).not.toContain(old);
    const row = await get(`/api/reports/${old}`);
    expect(row.body.status).toBe('expired');
  });

  it('um voto positivo renova a janela de 2 h; voto positivo antigo não', async () => {
    const renewed = (await create('radar_movel', mid)).body.id as string;
    const stale = (await create('radar_movel', mid)).body.id as string;
    const neg = (await create('blitz', mid)).body.id as string;
    for (const id of [renewed, stale, neg]) await age(id, '3 hours');
    await vote(renewed, VOTERS[0], 1);                              // confirmação agora
    await vote(stale, VOTERS[0], 1);
    await pool.query(`update report_votes set created_at = now() - interval '2 hours 10 minutes' where report_id = $1`, [stale]);
    await vote(neg, VOTERS[0], -1);                                 // negação não renova
    const ids = await listIds(mid);
    expect(ids).toContain(renewed);
    expect(ids).not.toContain(stale);
    expect(ids).not.toContain(neg);
  });

  it('road_closed e os demais tipos mantêm as regras anteriores (24 h; sem expirar radar por engano)', async () => {
    const closed = (await create('road_closed', mid)).body.id as string;
    const low = (await create('low_clearance', mid, { value_num: 3.9 })).body.id as string;
    await age(closed, '3 hours'); await age(low, '30 hours');
    const ids = await listIds(mid);
    expect(ids).toContain(closed);                                  // road_closed só expira com 24 h
    expect(ids).toContain(low);                                     // low_clearance não expira
  });

  it('aparece como aviso na rota (com idade e votos) e NÃO muda a rota', async () => {
    const radar = (await create('radar_movel', mid)).body.id as string;
    const blitz = (await create('blitz', mid)).body.id as string;
    await age(blitz, '25 minutes');
    await vote(blitz, VOTERS[0], 1); await vote(blitz, VOTERS[1], 1); await vote(blitz, VOTERS[2], -1);
    const r = await route({ origin: PTS.clearanceA, destination: PTS.clearanceB, vehicle: TRUCK_410, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.geometry.coordinates).toEqual(baseGeom);          // mesma geometria de antes dos reportes
    expect(r.body.avoided.filter((a: any) => a.kind === 'report')).toEqual([]);
    const wr = r.body.warnings.find((w: any) => w.code === 'radar_movel_reportado' && w.report_id === radar);
    const wb = r.body.warnings.find((w: any) => w.code === 'blitz_reportada' && w.report_id === blitz);
    expect(wr, 'aviso de radar móvel ausente').toBeTruthy();
    expect(wb, 'aviso de blitz ausente').toBeTruthy();
    expect(wr.severity).toBe('info');
    expect(wb.message).toMatch(/há 25 min/);
    expect(wb.message).toMatch(/2 confirmações/);
    expect(wb.message).toMatch(/1 negação/);
    expect(wr.message).toMatch(/há 0 min|há \d+ min/);
    expect(wr.message).toMatch(/0 confirmações/);
    // não duplica no aviso genérico de reporte próximo
    expect(r.body.warnings.filter((w: any) => /near_(unconfirmed_)?report/.test(w.code) && [radar, blitz].includes(w.report_id))).toEqual([]);
  });

  it('expirado ou desativado não avisa', async () => {
    const old = (await create('blitz', mid)).body.id as string;
    await age(old, '3 hours');
    const r = await route({ origin: PTS.clearanceA, destination: PTS.clearanceB, vehicle: TRUCK_410, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(r.body.warnings.filter((w: any) => w.report_id === old)).toEqual([]);
    expect(r.body.geometry.coordinates).toEqual(baseGeom);
  });

  it('reporte longe da rota não avisa', async () => {
    const far = (await create('blitz', { lat: mid.lat + 0.02, lon: mid.lon + 0.02 })).body.id as string;
    const r = await route({ origin: PTS.clearanceA, destination: PTS.clearanceB, vehicle: TRUCK_410, departure_at: DEP });
    expect(r.body.warnings.filter((w: any) => w.report_id === far)).toEqual([]);
  });

  it('DELETE pelo próprio device remove o reporte', async () => {
    const id = (await create('blitz', mid)).body.id as string;
    const res = await fetch(`${process.env.API_URL ?? 'http://localhost:3000'}/api/reports/${id}?device_id=${DEV}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
  });
});
