import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestReports, DEVICE, midpointOf, minDistM, pool, post, PTS, route, TRUCK_410, waitForStack } from './helpers.js';

describe('Reporte com score -3 não afeta a rota', () => {
  let viaduto: { lat: number; lon: number };
  let reportId: string;

  beforeAll(async () => {
    await waitForStack();
    await cleanupTestReports();
    const free = await route({ origin: PTS.clearanceA, destination: PTS.clearanceB, vehicle: TRUCK_410, departure_at: '2026-10-13T22:30' });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    viaduto = midpointOf(free.body);
    const created = await post('/api/reports', { type: 'low_clearance', geometry: { type: 'Point', coordinates: [viaduto.lon, viaduto.lat] }, value_num: 3.8, note: 'teste score', device_id: DEVICE });
    expect(created.status).toBe(201);
    reportId = created.body.id;
    for (const d of ['voter-a-00000000', 'voter-b-00000000', 'voter-c-00000000']) {
      const v = await post(`/api/reports/${reportId}/votes`, { device_id: d, vote: -1 });
      expect(v.status).toBe(200);
    }
  });

  afterAll(async () => { await cleanupTestReports(); await pool.end(); });

  it('score -3 desativa o reporte', async () => {
    const r = await pool.query('select score, status from reports where id = $1', [reportId]);
    expect(r.rows[0].score).toBe(-3);
    expect(r.rows[0].status).toBe('disabled');
  });

  it('caminhão de 4,10 m passa normalmente pelo ponto reportado', async () => {
    const r = await route({ origin: PTS.clearanceA, destination: PTS.clearanceB, vehicle: TRUCK_410, departure_at: '2026-10-13T22:30' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(minDistM(r.body, viaduto)).toBeLessThan(30);
    expect(r.body.avoided.map((a: any) => a.id)).not.toContain(reportId);
  });

  it('reporte desativado não aparece na listagem por bbox', async () => {
    const res = await fetch(`${process.env.API_URL ?? 'http://localhost:3000'}/api/reports?bbox=${viaduto.lon - 0.01},${viaduto.lat - 0.01},${viaduto.lon + 0.01},${viaduto.lat + 0.01}`);
    const list = await res.json();
    expect(list.map((x: any) => x.id)).not.toContain(reportId);
  });
});
