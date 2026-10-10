/**
 * Camada "relevo": precisa da API (API_URL) com esta camada e de um Valhalla com elevação. Hoje é o próprio Valhalla
 * principal (tiles com ANADEM; ver docs/layers/relevo.md): VALHALLA_ELEV_URL, senão VALHALLA_URL, senão localhost:8002.
 * Se ele não devolver altitude no /height, os testes de rota são pulados (a camada não anota); os testes de limites,
 * de funções internas e os com Valhalla simulado (servidor HTTP local) rodam sempre.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as turf from '@turf/turf';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { API, get, pool, route, waitForStack } from '../helpers.js';

const MAIN = process.env.VALHALLA_URL ?? 'http://localhost:8002';
const ELEV = process.env.VALHALLA_ELEV_URL ?? MAIN;
const up = async (u: string) => fetch(`${u}/status`).then((r) => r.ok).catch(() => false);
/** o Valhalla devolve altitude no /height (Sé, ~757 m no ANADEM)? */
const hasElev = async (u: string) => fetch(`${u}/height`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ shape: [{ lat: -23.5505, lon: -46.6339 }] }),
}).then((r) => r.json()).then((j: any) => typeof j.height?.[0] === 'number').catch(() => false);
const elevUp = await hasElev(ELEV);
const mainUp = await up(MAIN);
const mainHasElev = mainUp && (ELEV === MAIN ? elevUp : await hasElev(MAIN));
if (!elevUp) console.warn(`[relevo.test] ${ELEV} sem elevação (ou fora do ar): testes de rampa pulados (ver scripts/build-elevation.sh e docs/layers/relevo.md).`);

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
    // "carreta" é alias de carreta_5e; os limites vêm do preset (não da faixa por peso)
    expect(rel.data.limits).toMatchObject({ warn_pct: 6, avoid_pct: 8, source: 'preset', ref_weight_t: 41.5 });
    expect(rel.data.max_up_pct).toBeGreaterThan(8);
    expect(rel.data.max_up_pct_valhalla).toBeGreaterThan(8);
    expect(rel.data.coverage_pct).toBeGreaterThan(90);
    const seg = rel.data.segments.find((s: any) => s.level === 'evitar');
    expect(seg).toBeTruthy();
    expect(seg.name).toMatch(/Teodoro Sampaio/);
    expect(seg.bump).toBe(false);
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
    expect(avoid.message).toMatch(/para Carreta[^.]*\(8%\)/);
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

  it('truck com 30 t (acima dos 23 t do preset): limites caem para ~8,9/11,2% e aparecem com vírgula', async () => {
    const r = await route({ ...LADEIRA, vehicle: { preset: 'truck', weight_t: 30 } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rel = r.body.layers.relevo;
    expect(rel.data.limits).toMatchObject({ warn_pct: 8.9, avoid_pct: 11.2, source: 'preset+peso', ref_weight_t: 23 });
    expect(rel.summary[0]).toMatch(/atenção > 8,9%, evitar > 11,2%/);
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

// Falsos positivos do MDT: o ANADEM guarda resíduo de prédio em avenida plana e densa (a Paulista "oscila" 819–840 m a
// cada ~200 m; a Av. Rio Branco aparece a 24–42 m, quando fica a ~5 m). Nenhuma delas pode virar "evitar" nem costLine.
const PLANAS = [
  { nome: 'Av. Paulista (metrô Consolação → metrô Paraíso)', origin: { lat: -23.5576, lon: -46.6606 }, destination: { lat: -23.5762, lon: -46.6403 } },
  { nome: 'Av. Paulista (metrô Paraíso → metrô Consolação)', origin: { lat: -23.5762, lon: -46.6403 }, destination: { lat: -23.5576, lon: -46.6606 } },
  { nome: 'Centro do Rio (Praça Mauá → Cinelândia)', origin: { lat: -22.8968, lon: -43.1813 }, destination: { lat: -22.9110, lon: -43.1757 } },
  { nome: 'Centro do Rio (Cinelândia → Praça Mauá)', origin: { lat: -22.9110, lon: -43.1757 }, destination: { lat: -22.8968, lon: -43.1813 } },
];

describe.runIf(elevUp)('Relevo: avenida plana com prédios (resíduo do MDT) não vira "evitar"', () => {
  const res: Record<string, any> = {};
  beforeAll(async () => {
    await waitForStack();
    for (const c of PLANAS) {
      const r = await route({ origin: c.origin, destination: c.destination, departure_at: LADEIRA.departure_at, vehicle: { preset: 'carreta' } });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      res[c.nome] = r.body;
    }
  });

  for (const c of PLANAS) {
    it(`carreta: ${c.nome}: nenhum trecho "evitar", nenhum steep_grade_avoid, nenhuma costLine sugerida`, () => {
      const body = res[c.nome];
      const rel = body.layers.relevo;
      expect(rel, 'camada relevo não anotou a rota').toBeTruthy();
      expect(rel.data.segments.filter((s: any) => s.level === 'evitar').map((s: any) => `${s.name} ~${s.max_up_pct}%`)).toEqual([]);
      expect(body.warnings.filter((w: any) => w.layer === 'relevo' && /^steep_grade_avoid/.test(w.code)).map((w: any) => w.message)).toEqual([]);
      expect(rel.data.cost_lines_suggested).toEqual([]);
      expect(body.warnings.some((w: any) => w.layer === 'relevo' && w.severity === 'danger')).toBe(false);
    });
  }

  it('Av. Paulista: nenhum trecho nem aviso na avenida; o resíduo que passa da janela de 300 m fica em data.bumps', () => {
    const bumps: any[] = [];
    for (const c of PLANAS.slice(0, 2)) {
      const body = res[c.nome];
      const rel = body.layers.relevo;
      expect(rel.data.segments.filter((s: any) => /Paulista/.test(s.name)).map((s: any) => `${s.level} ~${s.max_up_pct}%`)).toEqual([]);
      expect(body.warnings.filter((w: any) => w.layer === 'relevo' && /Paulista/.test(w.message)).map((w: any) => w.message)).toEqual([]);
      expect(rel.data.bumps_count).toBe(rel.data.bumps.length);
      const paulista = rel.data.bumps.filter((b: any) => /Paulista/.test(b.name));
      for (const b of paulista) {
        expect(b.bump).toBe(true);
        expect(b.road_class).toBe('primary');
        expect(b.undone_m).toBeGreaterThanOrEqual(0.5 * b.rise_m);
        // o máximo da rota (e o resumo) não usa as lombadas escondidas
        expect(rel.data.max_up_pct).toBeLessThan(b.max_up_pct);
      }
      bumps.push(...paulista);
    }
    // no sentido Paraíso → Consolação o ANADEM ainda tem uma "lombada" de ~6,6% (300 m) na avenida
    expect(bumps.length).toBeGreaterThan(0);
  });
});

describe.runIf(elevUp)('Relevo: sonda de elevação depende do lugar', () => {
  it('linha no mar (sem DEM) não anota e não impede a próxima rota de ser anotada', async () => {
    vi.resetModules();
    const saved = process.env.VALHALLA_ELEV_URL;
    process.env.VALHALLA_ELEV_URL = ELEV;
    try {
      const layer = (await import('../../src/layers/relevo.layer.js')).default;
      const { resolveVehicle } = await import('../../src/services/vehicle.js');
      const ctx = { vehicle: resolveVehicle({ preset: 'carreta' } as any), at: new Date(), departureLocal: LADEIRA.departure_at, origin: LADEIRA.origin, destination: LADEIRA.destination, tz: 'America/Sao_Paulo' };
      const mar = turf.lineString([[-45.9, -24.6], [-45.8, -24.65], [-45.7, -24.7]]);
      expect(await layer.annotate!(ctx, { line: mar, distance_km: 22, duration_s: 1000 })).toEqual({});
      const res = await fetch(`${ELEV}/route`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locations: [{ ...LADEIRA.origin }, { ...LADEIRA.destination }], costing: 'truck', date_time: { type: 1, value: LADEIRA.departure_at } }),
      });
      const j: any = await res.json();
      const { decodePolyline6 } = await import('../../src/services/polyline.js');
      const out: any = await layer.annotate!(ctx, { line: turf.lineString(decodePolyline6(j.trip.legs[0].shape)), distance_km: 2.8, duration_s: 600 });
      expect(out.data?.max_up_pct).toBeGreaterThan(8);
    } finally {
      if (saved === undefined) delete process.env.VALHALLA_ELEV_URL; else process.env.VALHALLA_ELEV_URL = saved;
    }
  });
});

describe('Relevo: limites por preset/PBT (config/grade-limits.json)', () => {
  it('todo preset de config/vehicle-presets.json tem limites próprios (não cai na faixa por peso)', async () => {
    const { limitsFor, gradeConfig } = await import('../../src/layers/relevo.layer.js');
    const { resolveVehicle } = await import('../../src/services/vehicle.js');
    const { vehiclePresets } = await import('../../src/config.js');
    for (const p of vehiclePresets.presets) {
      expect(gradeConfig().presets[p.id], `config/grade-limits.json sem o preset ${p.id}`).toBeTruthy();
      expect(limitsFor(resolveVehicle({ preset: p.id } as any)).source, p.id).not.toBe('peso');
    }
  });

  it('preset no PBT de referência', async () => {
    const { limitsFor } = await import('../../src/layers/relevo.layer.js');
    const { resolveVehicle } = await import('../../src/services/vehicle.js');
    // "carreta" é alias de carreta_5e (cavalo 4x2, 41,5 t)
    expect(limitsFor(resolveVehicle({ preset: 'carreta' } as any))).toMatchObject({ warn_pct: 6, avoid_pct: 8, source: 'preset', ref_weight_t: 41.5 });
    expect(limitsFor(resolveVehicle({ preset: 'utilitario' } as any))).toMatchObject({ warn_pct: 15, avoid_pct: 20, source: 'preset' });
    expect(limitsFor(resolveVehicle({ preset: 'rodotrem' } as any))).toMatchObject({ warn_pct: 6, avoid_pct: 9, source: 'preset' });
    expect(limitsFor(resolveVehicle({ preset: 'vuc' } as any))).toMatchObject({ warn_pct: 15, avoid_pct: 20 });
    // VUC: os limites vêm do cálculo do toco 4x2 de 16 t (ref_weight_t), então um VUC carregado até 16 t não muda
    expect(limitsFor(resolveVehicle({ preset: 'vuc', weight_t: 12 } as any))).toMatchObject({ warn_pct: 15, avoid_pct: 20, source: 'preset' });
    expect(limitsFor(resolveVehicle({ preset: 'truck' } as any))).toMatchObject({ warn_pct: 12, avoid_pct: 15 });
    expect(limitsFor(resolveVehicle({ preset: 'bitrem' } as any))).toMatchObject({ warn_pct: 10, avoid_pct: 12 });
    // sem preset na config: só a faixa de peso
    expect(limitsFor({ ...resolveVehicle({ preset: 'truck' } as any), id: 'outro', weight_t: 20 })).toMatchObject({ warn_pct: 12, avoid_pct: 15, source: 'peso' });
  });

  it('acima do PBT de referência: cai pela relação de aderência do Anexo III da Res. CONTRAN 882/2021', async () => {
    const { limitsFor } = await import('../../src/layers/relevo.layer.js');
    const { resolveVehicle } = await import('../../src/services/vehicle.js');
    // lim' = (lim + 1,1) × ref/PBT − 1,1
    expect(limitsFor(resolveVehicle({ preset: 'truck', weight_t: 30 } as any))).toMatchObject({ warn_pct: 8.9, avoid_pct: 11.2, source: 'preset+peso', ref_weight_t: 23 });
    expect(limitsFor(resolveVehicle({ preset: 'bitrem', weight_t: 63 } as any))).toMatchObject({ warn_pct: 8.9, avoid_pct: 10.8, source: 'preset+peso' });
    // presets derivados: carreta 6 eixos (cavalo 6x2, 48,5 t) a partir da carreta 5 eixos; romeu-e-julieta (50 t) do truck
    expect(limitsFor(resolveVehicle({ preset: 'carreta_6e' } as any))).toMatchObject({ warn_pct: 5, avoid_pct: 6.7, source: 'preset+peso', ref_weight_t: 41.5 });
    expect(limitsFor(resolveVehicle({ preset: 'carreta', weight_t: 48.5 } as any))).toMatchObject({ warn_pct: 5, avoid_pct: 6.7 });
    expect(limitsFor(resolveVehicle({ preset: 'romeu_julieta' } as any))).toMatchObject({ warn_pct: 4.9, avoid_pct: 6.3, source: 'preset+peso', ref_weight_t: 23 });
  });

  it('mais peso no mesmo preset nunca afrouxa os limites, e não há degrau > 2 p.p. entre pesos vizinhos (1 t)', async () => {
    const { limitsFor } = await import('../../src/layers/relevo.layer.js');
    const { resolveVehicle } = await import('../../src/services/vehicle.js');
    const { vehiclePresets } = await import('../../src/config.js');
    for (const p of vehiclePresets.presets.map((x) => x.id)) {
      let prev = limitsFor(resolveVehicle({ preset: p, weight_t: 1 } as any));
      for (let w = 2; w <= 100; w++) {
        const cur = limitsFor(resolveVehicle({ preset: p, weight_t: w } as any));
        const tag = `${p} ${w - 1} t → ${w} t: ${prev.warn_pct}/${prev.avoid_pct} → ${cur.warn_pct}/${cur.avoid_pct}`;
        expect(cur.warn_pct, tag).toBeLessThanOrEqual(prev.warn_pct);
        expect(cur.avoid_pct, tag).toBeLessThanOrEqual(prev.avoid_pct);
        expect(prev.warn_pct - cur.warn_pct, tag).toBeLessThanOrEqual(2);
        expect(prev.avoid_pct - cur.avoid_pct, tag).toBeLessThanOrEqual(2);
        expect(cur.warn_pct, tag).toBeLessThanOrEqual(cur.avoid_pct);
        prev = cur;
      }
    }
  });
});

describe('Relevo: funções internas (sem Valhalla)', () => {
  it('descida longa: intervalo unido é conferido de novo (nunca sai média abaixo de min_avg_pct)', async () => {
    const { longDescents } = await import('../../src/layers/relevo.layer.js');
    // 0–1600 m: −70 m; 1600–2000 m: −31 m; 2000–3600 m: −70 m; depois plano. Toda janela de 2 km entre 0 e 1600 m cai
    // 101 m (5,05%), mas a união [0, 3600] cai 171 m em 3,6 km (4,75%), que antes saía como "descida de 4,7%".
    const pts: [number, number][] = [[0, 1000], [1600, 930], [2000, 899], [3600, 829], [5000, 829]];
    const elev = (x: number) => {
      for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (x - pts[i - 1][0])) / (pts[i][0] - pts[i - 1][0]);
      return pts[pts.length - 1][1];
    };
    const out = longDescents(elev, 5000, 2000, 5);
    expect(out.length).toBeGreaterThan(0);
    for (const iv of out) {
      expect(iv.e - iv.s).toBeGreaterThanOrEqual(2000);
      expect(((elev(iv.s) - elev(iv.e)) / (iv.e - iv.s)) * 100).toBeGreaterThanOrEqual(5);
    }
  });

  it('ponte dividida em várias arestas: um vão só, aplainado entre as cabeceiras (sem serrote nas junções)', async () => {
    const { bridgeSpans, buildProfile } = await import('../../src/layers/relevo.layer.js');
    const edge = (d0: number, d1: number, o: { bridge?: boolean; tunnel?: boolean } = {}) => ({
      up: 0, down: 0, weighted: 0, meanElev: 0, lengthM: d1 - d0, bridge: !!o.bridge, tunnel: !!o.tunnel, b: 0, e: 0, d0, d1,
    });
    const edges = [edge(0, 100), edge(100, 150, { bridge: true }), edge(150, 200, { bridge: true }), edge(200, 260), edge(260, 300, { tunnel: true })];
    expect(bridgeSpans(edges)).toEqual([{ kind: 'ponte', d0: 100, d1: 200 }, { kind: 'tunel', d0: 260, d1: 300 }]);
    // vale em V entre 100 e 200 m (fundo de 50 m em 150 m), terreno a 100 m fora dele
    const samples: [number, number | null][] = [];
    for (let x = 0; x <= 300; x += 10) samples.push([x, x <= 100 || x >= 200 ? 100 : 100 - 50 * (1 - Math.abs(x - 150) / 50)]);
    const p = buildProfile(samples, 300, edges as any)!;
    let worst = 0;
    for (let i = 0; i < p.d.length; i++) if (p.d[i] >= 100 && p.d[i] <= 200) worst = Math.max(worst, Math.abs(p.h[i] - 100));
    expect(worst).toBeLessThan(1);
  });

  it('lombada do MDT × subida contínua (bumpCheck)', async () => {
    const { bumpCheck } = await import('../../src/layers/relevo.layer.js');
    // avenida plana a 820 m com "prédio" no MDT: sobe 18 m entre 400 e 520 m e volta até 640 m
    const lomb = (x: number) => (x < 400 ? 820 : x < 520 ? 820 + (18 * (x - 400)) / 120 : x < 640 ? 838 - (18 * (x - 520)) / 120 : 820);
    const a = bumpCheck(lomb, 1200, 400, 520, 460, 120, 240);
    expect(a.rise_m).toBeGreaterThan(15);
    expect(a.undone_m).toBeGreaterThanOrEqual(0.5 * a.rise_m);
    // ladeira de verdade: 740 → 820 m em 1 km (8%), sem descida depois
    const ladeira = (x: number) => 740 + 0.08 * Math.min(1000, Math.max(0, x));
    const b = bumpCheck(ladeira, 1200, 400, 520, 460, 120, 240);
    expect(b.rise_m).toBeGreaterThan(10);
    expect(b.undone_m).toBeLessThan(0.5 * b.rise_m);
  });

  it('erros: tempo esgotado não é "fora do ar"', async () => {
    const { isTimeout, isConnError } = await import('../../src/layers/relevo.layer.js');
    const abort = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    const undiciTimeout = Object.assign(new TypeError('fetch failed'), { cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } });
    const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    expect(isTimeout(abort)).toBe(true);
    expect(isConnError(abort)).toBe(false);
    expect(isTimeout(undiciTimeout)).toBe(true);
    expect(isConnError(undiciTimeout)).toBe(false);
    expect(isTimeout(refused)).toBe(false);
    expect(isConnError(refused)).toBe(true);
    expect(isConnError(Object.assign(new Error('Valhalla trace_attributes 400: x'), { statusCode: 502 }))).toBe(false);
  });

  it('mínimo/máximo de perfis enormes sem estourar a pilha', async () => {
    const { minMax } = await import('../../src/layers/relevo.layer.js');
    const h = new Float64Array(400_000).map((_, i) => Math.sin(i / 1000) * 100 + 500);
    const mm = minMax(h); // Math.min(...h)/Math.max(...h) estouram a pilha com ~150 mil itens no Node 26
    expect(mm.min).toBeCloseTo(400, 3);
    expect(mm.max).toBeCloseTo(600, 3);
  });
});

/**
 * Valhalla simulado. Sem `profile`: /height com altitude e trace_attributes com arestas "sem elevação" (-500).
 * Com `profile` (altitude em função da distância ao longo da linha): /height com range devolve esse perfil e o
 * trace_attributes devolve 3 arestas (25% / 50% / 25% da linha), a do meio com `up` % e classe `roadClass`.
 */
function fakeValhalla(opts: { slowFirstTraceMs?: number; profile?: (d: number) => number; roadClass?: string; up?: number } = {}) {
  const calls = { height: 0, trace: 0 };
  const server: Server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const send = (j: unknown) => { if (!res.writableEnded && !res.destroyed) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(j)); } };
    const { decodePolyline6 } = await import('../../src/services/polyline.js');
    if (req.url === '/height') {
      calls.height++;
      if (body.shape) return send({ height: body.shape.map(() => 760) });
      if (!opts.profile) return send({ range_height: [[0, 760], [1000, 760]] });
      const total = turf.length(turf.lineString(decodePolyline6(body.encoded_polyline)), { units: 'meters' });
      const step = body.resample_distance ?? 30;
      const out: [number, number][] = [];
      for (let d = 0; d < total; d += step) out.push([d, opts.profile(d)]);
      out.push([total, opts.profile(total)]);
      return send({ range_height: out });
    }
    if (req.url === '/trace_attributes') {
      calls.trace++;
      if (calls.trace === 1 && opts.slowFirstTraceMs) await new Promise((r) => setTimeout(r, opts.slowFirstTraceMs));
      const n = decodePolyline6(body.encoded_polyline).length;
      if (!opts.profile) {
        return send({
          shape: body.encoded_polyline,
          edges: [{ max_upward_grade: -500, max_downward_grade: -500, weighted_grade: 0, mean_elevation: -500, length: 2.8, way_id: 1, names: ['Rua Teste'], road_class: 'residential', begin_shape_index: 0, end_shape_index: n - 1 }],
        });
      }
      const cut = [0, Math.round((n - 1) / 4), Math.round((3 * (n - 1)) / 4), n - 1];
      const edge = (k: number, up: number, rc: string) => ({
        max_upward_grade: up, max_downward_grade: -up, weighted_grade: 0, mean_elevation: 830, length: (cut[k + 1] - cut[k]) * 0.01,
        way_id: 100 + k, names: ['Rua Teste'], road_class: rc, begin_shape_index: cut[k], end_shape_index: cut[k + 1],
      });
      return send({ shape: body.encoded_polyline, edges: [edge(0, 1, 'residential'), edge(1, opts.up ?? 14, opts.roadClass ?? 'residential'), edge(2, 1, 'residential')] });
    }
    res.statusCode = 404; send({ error: 'not found' });
  });
  return new Promise<{ url: string; calls: typeof calls; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) });
    });
  });
}

describe('Relevo: política da "lombada" do MDT (Valhalla simulado, carreta 6/8%)', () => {
  // linha reta de 1,2 km (121 pontos a cada 10 m); aresta do meio = 300–900 m
  const coords: [number, number][] = Array.from({ length: 121 }, (_, i) => [-46.65, -23.56 + (i * 10) / 111195]);
  // sobe 40 m em 300 m (13,3%) a partir dos 300 m; "lombada" desce de volta em 300 m, "ladeira" fica no alto
  const lombada = (d: number) => (d < 300 ? 820 : d < 600 ? 820 + (40 * (d - 300)) / 300 : d < 900 ? 860 - (40 * (d - 600)) / 300 : 820);
  const ladeira = (d: number) => (d < 300 ? 820 : d < 600 ? 820 + (40 * (d - 300)) / 300 : 860);
  const saved = process.env.VALHALLA_ELEV_URL;
  afterAll(() => { if (saved === undefined) delete process.env.VALHALLA_ELEV_URL; else process.env.VALHALLA_ELEV_URL = saved; });
  const run = async (opts: Parameters<typeof fakeValhalla>[0]) => {
    const fake = await fakeValhalla(opts);
    try {
      vi.resetModules();
      process.env.VALHALLA_ELEV_URL = fake.url;
      const layer = (await import('../../src/layers/relevo.layer.js')).default;
      const { resolveVehicle } = await import('../../src/services/vehicle.js');
      const ctx = { vehicle: resolveVehicle({ preset: 'carreta' } as any), at: new Date(), departureLocal: '2026-10-13T22:30', origin: LADEIRA.origin, destination: LADEIRA.destination, tz: 'America/Sao_Paulo' };
      return (await layer.annotate!(ctx, { line: turf.lineString(coords), distance_km: 1.2, duration_s: 200 })) as any;
    } finally {
      await fake.close();
    }
  };
  const codes = (out: any) => (out.warnings ?? []).map((w: any) => w.code);

  it('lombada em avenida (primary): fica só em data.bumps — sem trecho, sem aviso, sem costLine, fora do máximo da rota', async () => {
    const out = await run({ profile: lombada, roadClass: 'primary' });
    expect(out.data.segments).toEqual([]);
    expect(out.data.bumps.length).toBe(1);
    expect(out.data.bumps[0]).toMatchObject({ bump: true, road_class: 'primary', window_m: 300 });
    expect(out.data.bumps[0].max_up_pct).toBeGreaterThan(8);
    expect(codes(out).filter((c: string) => /^steep_grade/.test(c))).toEqual([]);
    expect(out.data.cost_lines_suggested).toEqual([]);
    expect(out.data.max_up_pct).toBeLessThan(out.data.bumps[0].max_up_pct);
  });

  it('lombada em rua (residential): no máximo "atencao" (aviso de marcha), nunca "evitar" nem costLine', async () => {
    const out = await run({ profile: lombada, roadClass: 'residential' });
    expect(out.data.bumps).toEqual([]);
    expect(out.data.segments.map((s: any) => [s.level, s.bump])).toEqual([['atencao', true]]);
    expect(out.data.segments[0].max_up_pct).toBeGreaterThan(8);
    expect(codes(out)).toContain('steep_grade_warn');
    expect(codes(out)).not.toContain('steep_grade_avoid');
    expect(out.data.cost_lines_suggested).toEqual([]);
  });

  it('ladeira contínua na mesma rua (sem descida depois do topo): "evitar", aviso steep_grade_avoid e costLine no sentido da subida', async () => {
    const out = await run({ profile: ladeira, roadClass: 'residential' });
    expect(out.data.segments.map((s: any) => [s.level, s.bump])).toEqual([['evitar', false]]);
    expect(codes(out)).toContain('steep_grade_avoid');
    expect(out.data.cost_lines_suggested.length).toBe(1);
    const cl = out.data.cost_lines_suggested[0];
    // geometria da aresta no sentido do percurso (sul → norte, latitude crescente)
    expect(cl.coordinates[cl.coordinates.length - 1][1]).toBeGreaterThan(cl.coordinates[0][1]);
  });
});

describe('Relevo: Valhalla de elevação indisponível, sem elevação ou lento → camada não anota', () => {
  const coords: [number, number][] = [[-46.6925, -23.5665], [-46.6830, -23.5600], [-46.6735, -23.5540]];
  const ctxFor = async () => {
    const { resolveVehicle } = await import('../../src/services/vehicle.js');
    const vehicle = resolveVehicle({ preset: 'carreta' } as any);
    return { vehicle, at: new Date(), departureLocal: '2026-10-13T22:30', origin: LADEIRA.origin, destination: LADEIRA.destination, tz: 'America/Sao_Paulo' };
  };
  const routeGeom = () => ({ line: turf.lineString(coords), distance_km: 2.8, duration_s: 600 });
  const saved = { url: process.env.VALHALLA_ELEV_URL, timeout: process.env.RELEVO_TRACE_TIMEOUT_MS };
  afterAll(async () => {
    if (saved.url === undefined) delete process.env.VALHALLA_ELEV_URL; else process.env.VALHALLA_ELEV_URL = saved.url;
    if (saved.timeout === undefined) delete process.env.RELEVO_TRACE_TIMEOUT_MS; else process.env.RELEVO_TRACE_TIMEOUT_MS = saved.timeout;
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

  it('arestas sem elevação (-500, como o Valhalla sem DEM devolve): devolve {}', async () => {
    const fake = await fakeValhalla();
    try {
      vi.resetModules();
      process.env.VALHALLA_ELEV_URL = fake.url;
      const layer = (await import('../../src/layers/relevo.layer.js')).default;
      expect(await layer.annotate!(await ctxFor(), routeGeom())).toEqual({});
      expect(fake.calls.trace).toBe(1);
    } finally {
      await fake.close();
    }
  });

  it('trace_attributes lento (tempo esgotado): esta rota sai sem relevo, mas a próxima volta a consultar o Valhalla', async () => {
    const fake = await fakeValhalla({ slowFirstTraceMs: 1500 });
    try {
      vi.resetModules();
      process.env.VALHALLA_ELEV_URL = fake.url;
      process.env.RELEVO_TRACE_TIMEOUT_MS = '300';
      const layer = (await import('../../src/layers/relevo.layer.js')).default;
      const t0 = Date.now();
      expect(await layer.annotate!(await ctxFor(), routeGeom())).toEqual({});
      expect(Date.now() - t0).toBeLessThan(1400);
      // não marcou o serviço como fora do ar: a 2ª rota chega ao trace_attributes
      expect(await layer.annotate!(await ctxFor(), routeGeom())).toEqual({});
      expect(fake.calls.trace).toBe(2);
    } finally {
      delete process.env.RELEVO_TRACE_TIMEOUT_MS;
      await fake.close();
    }
  });

  it.runIf(mainUp && !mainHasElev)('Valhalla real sem elevação (só roda se o principal não tiver os tiles com ANADEM): devolve {}', async () => {
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
