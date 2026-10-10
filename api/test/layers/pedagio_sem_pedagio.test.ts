import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rota sem pedágio (services/tollCost.ts → noTollRoute) contra o Valhalla local, com as consultas ao banco simuladas.
 * Confere que, recebendo as restrições que a rota principal usou (RouteGeom.restrictions, preenchido por routing.ts),
 * a alternativa NÃO consulta de novo zonas, reportes e camadas; e que, sem elas, uma consulta que falha não derruba
 * a alternativa e fica registrada em `falhas` (vira `restricoes_parciais` na camada).
 */
const calls = vi.hoisted(() => ({ zones: 0, reports: 0, layers: 0, calendar: 0 }));
vi.mock('../../src/services/zones.js', () => ({
  activeZones: async () => { calls.zones++; throw new Error('banco fora do ar'); },
  pointInZone: () => false, zoneApplies: () => false, zoneRings: () => [],
}));
vi.mock('../../src/services/restrictions.js', () => ({
  blockingReports: async () => { calls.reports++; throw new Error('banco fora do ar'); },
  reportToRing: () => [],
}));
vi.mock('../../src/services/calendar.js', () => ({
  legalDayInfo: async () => { calls.calendar++; return {}; },
}));
vi.mock('../../src/layers/index.js', () => ({
  loadLayers: async () => {
    calls.layers++;
    return [{ meta: { id: 'camada_x', label: 'Camada X' }, exclusions: async () => { throw new Error('banco fora do ar'); } }];
  },
}));

import { noTollRoute } from '../../src/services/tollCost.js';
import type { RouteCtx } from '../../src/layers/types.js';

const ctx: RouteCtx = {
  vehicle: { id: 'carreta', label: 'carreta', height_m: 4.4, width_m: 2.6, length_m: 18.6, weight_t: 41.5, axle_load_t: 10, axle_count: 5, hazmat: false, is_vuc: false } as RouteCtx['vehicle'],
  at: new Date('2026-10-14T13:00:00Z'),
  departureLocal: '2026-10-14T10:00',
  origin: { lat: -23.5205, lon: -46.7045 },      // Lapa
  destination: { lat: -23.1857, lon: -46.8978 }, // Jundiaí
  tz: 'America/Sao_Paulo',
};

describe('rota sem pedágio: restrições da rota principal', () => {
  beforeEach(() => { calls.zones = calls.reports = calls.layers = calls.calendar = 0; });

  it('com RouteGeom.restrictions, não consulta zonas, reportes, calendário nem camadas de novo', async () => {
    const nt = await noTollRoute(ctx, 'pedagio', { excludePolygons: [], costLines: [] });
    expect(nt, 'Valhalla sem rota sem pedágio Lapa→Jundiaí').not.toBeNull();
    expect(nt!.has_toll).toBe(false);
    expect(nt!.falhas).toEqual([]);
    expect(calls).toEqual({ zones: 0, reports: 0, layers: 0, calendar: 0 });
  });

  it('sem elas, consulta tudo de novo; falha de consulta fica em `falhas` e a alternativa sai mesmo assim', async () => {
    const nt = await noTollRoute(ctx, 'pedagio');
    expect(nt).not.toBeNull();
    expect(nt!.falhas).toEqual(expect.arrayContaining(['zonas de restrição', 'reportes de bloqueio', 'Camada X']));
    expect(calls.zones).toBe(1);
    expect(calls.reports).toBe(1);
    expect(calls.layers).toBe(1);
  });
});
