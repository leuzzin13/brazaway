/**
 * Camada "relevo": precisa da API (API_URL) com esta camada e de um Valhalla com elevação (VALHALLA_ELEV_URL,
 * default http://localhost:8003; ver scripts/build-elevation.sh). Sem o Valhalla de elevação, os testes que
 * dependem dele são pulados (a camada não anota) e o teste de indisponibilidade continua valendo.
 */
import * as turf from '@turf/turf';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { API, get, pool, route, waitForStack } from '../helpers.js';

const ELEV = process.env.VALHALLA_ELEV_URL ?? 'http://localhost:8003';
const MAIN = process.env.VALHALLA_URL ?? 'http://localhost:8002';
const up = async (u: string) => fetch(`${u}/status`).then((r) => r.ok).catch(() => false);
const elevUp = await up(ELEV);
const mainUp = await up(MAIN);
if (!elevUp) console.warn(`[relevo.test] Valhalla com elevação fora do ar em ${ELEV}: testes de rampa pulados (rode scripts/build-elevation.sh).`);

// Rua Teodoro Sampaio subindo de Pinheiros (Largo da Batata, ~740 m) até a Av. Dr. Arnaldo (~820 m).
// Trecho mais íngreme perto da R. Capote Valente: ~11–12% no ANADEM. Terça 22h30 (fora do horário da ZMRC).
const LADEIRA = {
  origin: { lat: -23.5665, lon: -46.6925 },
  destination: { lat: -23.5540, lon: -46.6735 },
  departure_at: '2026-10-13T22:30',
};

let carreta: any;

describe.runIf(elevUp)('Relevo: ladeira conhecida de SP (Rua Teodoro Sampaio)', () => {
  beforeAll(async () => {
    await waitForStack();
    const layers = await get('/api/layers');
    expect(layers.body.map((l: any) => l.id), `a API em ${API} não tem a camada relevo`).toContain('relevo');
    const r = await route({ ...LADEIRA, vehicle: { preset: 'carreta' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    carreta = r.body;
  });

  it('carreta: acusa rampa > 8% (limite "evitar" da carreta) na Teodoro Sampaio, com lat/lon', () => {
    const rel = carreta.layers.relevo;
    expect(rel, 'camada relevo não anotou a rota').toBeTruthy();
    expect(rel.data.limits).toMatchObject({ warn_pct: 6, avoid_pct: 8 });
    expect(rel.data.max_up_pct).toBeGreaterThan(8);
    expect(rel.data.max_up_pct_valhalla).toBeGreaterThan(8);
    expect(rel.data.coverage_pct).toBeGreaterThan(90);
    const seg = rel.data.segments.find((s: any) => s.level === 'evitar');
    expect(seg).toBeTruthy();
    expect(seg.name).toMatch(/Teodoro Sampaio/);
    expect(seg.max_up_pct).toBeGreaterThan(8);
    expect(seg.over_avoid_m).toBeGreaterThan(0);
    expect(typeof seg.lat).toBe('number');
    expect(typeof seg.lon).toBe('number');
    // ponto mais íngreme fica na própria rota
    const d = turf.pointToLineDistance(turf.point([seg.lon, seg.lat]), turf.lineString(carreta.geometry.coordinates), { units: 'meters' });
    expect(d).toBeLessThan(20);
    expect(rel.data.km_over_warn).toBeGreaterThan(0);
    expect(rel.summary[0]).toMatch(/Rampa máx\./);
  });

  it('carreta: aviso "steep_grade_avoid" com severidade warn (rampa não é restrição legal → nunca danger)', () => {
    const ws = carreta.warnings.filter((w: any) => w.layer === 'relevo');
    const avoid = ws.find((w: any) => w.code === 'steep_grade_avoid');
    expect(avoid).toBeTruthy();
    expect(avoid.severity).toBe('warn');
    expect(avoid.message).toMatch(/Teodoro Sampaio/);
    expect(avoid.message).toMatch(/Carreta \(8%\)/);
    expect(typeof avoid.lat).toBe('number');
    expect(ws.some((w: any) => w.severity === 'danger')).toBe(false);
  });

  it('perfil resumido: sobe ~80 m (740 → 820 m) e traz pontos [km, m]', () => {
    const p = carreta.layers.relevo.data.profile;
    expect(p.points.length).toBeGreaterThan(10);
    expect(p.max_m - p.min_m).toBeGreaterThan(50);
    expect(p.ascent_m).toBeGreaterThan(50);
    expect(p.min_m).toBeGreaterThan(700);
    expect(p.max_m).toBeLessThan(860);
  });

  it('VUC na mesma rota: limites 15/20%, sem aviso de rampa', async () => {
    const r = await route({ ...LADEIRA, vehicle: { preset: 'vuc', is_vuc: true } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rel = r.body.layers.relevo;
    expect(rel.data.limits).toMatchObject({ warn_pct: 15, avoid_pct: 20 });
    expect(rel.data.max_up_pct).toBeGreaterThan(8);
    expect(r.body.warnings.some((w: any) => w.layer === 'relevo' && /^steep_grade/.test(w.code))).toBe(false);
  });

  it('2ª rodada (sugestão): costLines no sentido da subida fazem o Valhalla desviar do trecho íngreme', async () => {
    const sug = carreta.layers.relevo.data.cost_lines_suggested;
    expect(sug.length).toBeGreaterThan(0);
    const top = sug[0];
    expect(top.factor).toBeGreaterThan(1);
    expect(top.item).toMatchObject({ kind: 'layer', layer: 'relevo', type: 'steep_grade' });
    if (!mainUp) return;
    const v = carreta.vehicle;
    const body = {
      locations: [{ ...LADEIRA.origin, type: 'break' }, { ...LADEIRA.destination, type: 'break' }],
      costing: 'truck',
      costing_options: { truck: { height: v.height_m, width: v.width_m, length: v.length_m, weight: v.weight_t, axle_load: v.axle_load_t, axle_count: v.axle_count } },
      date_time: { type: 1, value: LADEIRA.departure_at },
      linear_cost_factors: sug.map((c: any) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c.coordinates }, properties: { factor: c.factor } })),
    };
    const res = await fetch(`${MAIN}/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(res.ok).toBe(true);
    const j: any = await res.json();
    const { decodePolyline6 } = await import('../../src/services/polyline.js');
    const line = turf.lineString(decodePolyline6(j.trip.legs[0].shape));
    const d = turf.pointToLineDistance(turf.point([top.item.lon, top.item.lat]), line, { units: 'meters' });
    expect(d).toBeGreaterThan(100);
  });
});

describe('Relevo: limites por preset/PBT (config/grade-limits.json)', () => {
  it('preset e PBT acima do preset', async () => {
    const { limitsFor } = await import('../../src/layers/relevo.layer.js');
    const { resolveVehicle } = await import('../../src/services/vehicle.js');
    expect(limitsFor(resolveVehicle({ preset: 'carreta' } as any))).toMatchObject({ warn_pct: 6, avoid_pct: 8, source: 'preset' });
    expect(limitsFor(resolveVehicle({ preset: 'vuc' } as any))).toMatchObject({ warn_pct: 15, avoid_pct: 20 });
    expect(limitsFor(resolveVehicle({ preset: 'truck' } as any))).toMatchObject({ warn_pct: 12, avoid_pct: 15 });
    expect(limitsFor(resolveVehicle({ preset: 'bitrem' } as any))).toMatchObject({ warn_pct: 10, avoid_pct: 12 });
    // truck carregado acima do PBT de referência (23 t × 1,1): vale a faixa de peso, mais restritiva
    expect(limitsFor(resolveVehicle({ preset: 'truck', weight_t: 30 } as any))).toMatchObject({ warn_pct: 6, avoid_pct: 8, source: 'preset+peso' });
    // sem preset conhecido: só a faixa de peso
    expect(limitsFor({ ...resolveVehicle({ preset: 'truck' } as any), id: 'outro', weight_t: 20 })).toMatchObject({ warn_pct: 12, avoid_pct: 15, source: 'peso' });
  });
});

describe('Relevo: Valhalla de elevação indisponível → camada não anota', () => {
  const coords: [number, number][] = [[-46.6925, -23.5665], [-46.6830, -23.5600], [-46.6735, -23.5540]];
  const ctxFor = async () => {
    const { resolveVehicle } = await import('../../src/services/vehicle.js');
    const vehicle = resolveVehicle({ preset: 'carreta' } as any);
    return { vehicle, at: new Date(), departureLocal: '2026-10-13T22:30', origin: LADEIRA.origin, destination: LADEIRA.destination, tz: 'America/Sao_Paulo' };
  };
  const routeGeom = () => ({ line: turf.lineString(coords), distance_km: 2.8, duration_s: 600 });
  const saved = process.env.VALHALLA_ELEV_URL;
  afterAll(async () => {
    if (saved === undefined) delete process.env.VALHALLA_ELEV_URL; else process.env.VALHALLA_ELEV_URL = saved;
    await pool.end();
  });

  it('porta fechada: devolve {} rápido, sem erro', async () => {
    vi.resetModules();
    process.env.VALHALLA_ELEV_URL = 'http://127.0.0.1:9';
    const layer = (await import('../../src/layers/relevo.layer.js')).default;
    const t0 = Date.now();
    const out = await layer.annotate!(await ctxFor(), routeGeom());
    expect(out).toEqual({});
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  it.runIf(mainUp)('Valhalla sem elevação (o principal, hoje): devolve {}', async () => {
    vi.resetModules();
    process.env.VALHALLA_ELEV_URL = MAIN;
    const layer = (await import('../../src/layers/relevo.layer.js')).default;
    // geometria real de rota (para o edge_walk casar com a malha)
    const res = await fetch(`${MAIN}/route`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locations: [{ ...LADEIRA.origin }, { ...LADEIRA.destination }], costing: 'truck' }),
    });
    const j: any = await res.json();
    const { decodePolyline6 } = await import('../../src/services/polyline.js');
    const line = turf.lineString(decodePolyline6(j.trip.legs[0].shape));
    const out = await layer.annotate!(await ctxFor(), { line, distance_km: 2.8, duration_s: 600 });
    expect(out).toEqual({});
  });
});
