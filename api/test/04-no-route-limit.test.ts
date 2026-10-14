import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CARRETA, pool, route, waitForStack } from './helpers.js';

// Balsa São Sebastião–Ilhabela: as rampas das duas pontas têm maxweight=40t no OSM. A carreta de 5 eixos (41,5 t) não
// tem rota, sem nenhuma regra culpada; a API tem de dizer qual medida fecha o caminho.
const SAO_SEBASTIAO = { lat: -23.817, lon: -45.415 };
const ILHABELA = { lat: -23.779, lon: -45.357 };

describe('Sem rota por limite do próprio veículo', () => {
  beforeAll(async () => { await waitForStack(); });
  afterAll(async () => { await pool.end(); });

  it('carreta de 41,5 t até Ilhabela: NO_ROUTE com limited_by peso e mensagem explicando', async () => {
    const r = await route({ origin: SAO_SEBASTIAO, destination: ILHABELA, vehicle: CARRETA, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe('NO_ROUTE');
    expect(r.body.blocked_by).toEqual([]);
    expect(r.body.limited_by).toEqual(['peso']);
    expect(r.body.message).toMatch(/balsa.*peso do veículo \(41,5 t\)/);
  });

  it('a mesma carreta com 38 t passa pela balsa', async () => {
    const r = await route({ origin: SAO_SEBASTIAO, destination: ILHABELA, vehicle: { ...CARRETA, weight_t: 38 }, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  });
});
