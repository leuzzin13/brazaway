import { describe, expect, it } from 'vitest';
import { route, waitForStack } from './helpers.js';

/**
 * Correções locais do OSM (docs/OSM_OVERRIDES.md). A Res. SMTR 3.055/2018 do Rio está suspensa desde 20/03/2020
 * (Res. SMTR 3.254/2020), mas 29 ways do OSM ainda tinham a hgv:conditional dela; com a tag, o Valhalla forçava caminhão
 * a desviar ~52 km (Barra → Centro, dia útil 8h) em vez de ~28 km. O build com scripts/build-tiles.sh remove a tag.
 */
describe('Correções locais do OSM no grafo', () => {
  it('Rio: regra suspensa da Res. SMTR 3.055 não desvia caminhão (Barra → Centro, terça 8h)', async () => {
    await waitForStack();
    const body = { origin: { lat: -23.0003, lon: -43.3659 }, destination: { lat: -22.9035, lon: -43.2096 }, vehicle: { preset: 'truck' } };
    const pico = await route({ ...body, departure_at: '2026-10-13T08:00' });
    const noite = await route({ ...body, departure_at: '2026-10-13T22:00' });
    expect(pico.status, JSON.stringify(pico.body).slice(0, 300)).toBe(200);
    expect(noite.status).toBe(200);
    expect(pico.body.distance_km).toBeLessThan(35);
    expect(Math.abs(pico.body.distance_km - noite.body.distance_km)).toBeLessThan(3);
  }, 300_000);
});
