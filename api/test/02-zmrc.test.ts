import { beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { CARRETA, crossesZone, get, PTS, route, VUC_320, waitForStack } from './helpers.js';

describe('Rota que atravessa a ZMRC', () => {
  let zmrc: GeoJSON.Feature;
  beforeAll(async () => {
    await waitForStack();
    const z = await get('/api/zones');
    zmrc = z.body.features.find((f: any) => /ZMRC/i.test(f.properties.name));
    expect(zmrc, 'zona ZMRC não encontrada no banco (seed 0002_zones.sql)').toBeTruthy();
    for (const p of [PTS.zmrcA, PTS.zmrcB]) {
      expect(turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), zmrc as any), 'ponto de teste deveria estar fora da ZMRC').toBe(false);
    }
  });

  // 2026-10-13 é terça-feira
  it('carreta às 22h passa pela ZMRC (fora da janela)', async () => {
    const r = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: CARRETA, departure_at: '2026-10-13T22:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(crossesZone(r.body, zmrc), 'rota livre deveria cruzar a ZMRC (pré-condição do teste)').toBe(true);
    expect(r.body.avoided.find((a: any) => a.kind === 'zone')).toBeUndefined();
  });

  it('carreta às 10h de terça desvia da ZMRC', async () => {
    const r = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: CARRETA, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(crossesZone(r.body, zmrc), 'rota às 10h não deveria cruzar a ZMRC').toBe(false);
    expect(r.body.avoided.find((a: any) => a.kind === 'zone')?.name).toMatch(/ZMRC/);
  });

  it('VUC com AETC passa sempre (10h de terça)', async () => {
    const r = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: VUC_320, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(crossesZone(r.body, zmrc)).toBe(true);
    expect(r.body.avoided.find((a: any) => a.kind === 'zone')).toBeUndefined();
  });

  it('origem dentro da ZMRC: não exclui e devolve aviso', async () => {
    const inside = { lat: -23.5614, lon: -46.6560 }; // Av. Paulista
    const r = await route({ origin: inside, destination: PTS.zmrcB, vehicle: CARRETA, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.warnings.some((w: any) => w.code === 'origin_in_zone')).toBe(true);
  });
});
