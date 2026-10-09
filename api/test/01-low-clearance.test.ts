import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestReports, DEVICE, midpointOf, minDistM, pool, post, PTS, route, TRUCK_410, VUC_320, waitForStack } from './helpers.js';

describe('Reporte "viaduto 3,80 m" numa via usada pela rota', () => {
  let reportId: string;
  let viaduto: { lat: number; lon: number };

  beforeAll(async () => {
    await waitForStack();
    await cleanupTestReports();
    // rota livre do caminhão para descobrir uma via realmente usada
    const free = await route({ origin: PTS.clearanceA, destination: PTS.clearanceB, vehicle: TRUCK_410, departure_at: '2026-10-13T22:30' });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    viaduto = midpointOf(free.body);
    const created = await post('/api/reports', { type: 'low_clearance', geometry: { type: 'Point', coordinates: [viaduto.lon, viaduto.lat] }, value_num: 3.8, note: 'teste viaduto', device_id: DEVICE });
    expect(created.status).toBe(201);
    reportId = created.body.id;
    // score 0 já afeta a rota (regra: score >= 0)
  });

  afterAll(async () => { await cleanupTestReports(); await pool.end(); });

  it('caminhão de 4,10 m desvia do viaduto', async () => {
    const r = await route({ origin: PTS.clearanceA, destination: PTS.clearanceB, vehicle: TRUCK_410, departure_at: '2026-10-13T22:30' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = minDistM(r.body, viaduto);
    expect(d, `rota passou a ${d.toFixed(0)} m do viaduto`).toBeGreaterThan(20);
    expect(r.body.avoided.map((a: any) => a.id)).toContain(reportId);
  });

  it('VUC de 3,20 m passa pelo viaduto', async () => {
    const r = await route({ origin: PTS.clearanceA, destination: PTS.clearanceB, vehicle: VUC_320, departure_at: '2026-10-13T22:30' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = minDistM(r.body, viaduto);
    expect(d, `VUC deveria passar pelo viaduto (dist ${d.toFixed(0)} m)`).toBeLessThan(30);
    expect(r.body.avoided.map((a: any) => a.id)).not.toContain(reportId);
  });
});
