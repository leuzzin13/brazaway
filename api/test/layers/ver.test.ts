import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { get, pool, route, waitForStack } from '../helpers.js';
import verLayer, { decide, vigente, type VerProps } from '../../src/layers/ver.layer.js';
import { pool as apiPool } from '../../src/db.js';
import type { RouteCtx } from '../../src/layers/types.js';
import type { Vehicle } from '../../src/services/vehicle.js';

// 2026-10-13 é terça-feira; 2026-10-17 é sábado; 2026-10-18 é domingo
const TZ = 'America/Sao_Paulo';
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ });
const TRUCK: Vehicle = { id: 'truck', label: 'Truck', height_m: 4.2, width_m: 2.6, length_m: 12, weight_t: 23, axle_load_t: 8.5, axle_count: 3, hazmat: false, is_vuc: false };
const VUC: Vehicle = { id: 'vuc', label: 'VUC', height_m: 3.2, width_m: 2.2, length_m: 6.3, weight_t: 7, axle_load_t: 5, axle_count: 2, hazmat: false, is_vuc: true };

afterAll(async () => { await apiPool.end(); });

async function props(sourceId: string): Promise<VerProps> {
  const r = await pool.query(`select props from data_features where layer_id = 'ver' and source_id = $1`, [sourceId]);
  expect(r.rows.length, `feição ${sourceId} não está no banco (rode o importador ver_portaria137 ou o seed)`).toBe(1);
  return r.rows[0].props as VerProps;
}

describe('VER — regras da Portaria SMT 137/2018 (dados do banco)', () => {
  let s1: VerProps, s2: VerProps, s4: VerProps, s5: VerProps, s4i: VerProps;
  beforeAll(async () => {
    [s1, s2, s4, s5, s4i] = await Promise.all(['p137-a2-s1-iv', 'p137-a2-s2-iv', 'p137-a2-s4-xxiii', 'p137-a2-s5-i', 'p137-a2-s4-i'].map(props));
  });

  it('§ 1º: seg–sex 05–21h e sáb 10–14h; livre à noite, sábado à tarde e domingo', () => {
    expect(decide(s1, TRUCK, at('2026-10-13T10:00')).proibido).toBe(true);
    expect(decide(s1, TRUCK, at('2026-10-13T05:00')).proibido).toBe(true);
    expect(decide(s1, TRUCK, at('2026-10-13T04:59')).proibido).toBe(false);
    expect(decide(s1, TRUCK, at('2026-10-13T21:00')).proibido).toBe(false);
    expect(decide(s1, TRUCK, at('2026-10-17T12:00')).proibido).toBe(true);
    expect(decide(s1, TRUCK, at('2026-10-17T15:00')).proibido).toBe(false);
    expect(decide(s1, TRUCK, at('2026-10-18T10:00')).proibido).toBe(false);
  });

  it('§ 1º: VUC com AETC continua proibido (art. 18 só libera §§ 2º a 4º)', () => {
    expect(decide(s1, { ...VUC, has_aetc: true }, at('2026-10-13T10:00')).proibido).toBe(true);
    expect(decide(s2, { ...VUC, has_aetc: true }, at('2026-10-13T10:00')).codigo).toBe('excecao');
    expect(decide(s2, VUC, at('2026-10-13T10:00')).proibido).toBe(true); // sem AETC não há exceção
    expect(decide(s4, { ...VUC, has_aetc: true }, at('2026-10-13T07:00')).codigo).toBe('excecao');
  });

  it('exceções por carga com AETC: perecíveis (art. 32), concretagem (arts. 27/28), mudança (art. 30, não vale no § 1º)', () => {
    const perec = { ...TRUCK, has_aetc: true, cargo_type: 'perishable' as const };
    expect(decide(s1, perec, at('2026-10-13T11:59')).codigo).toBe('excecao');
    expect(decide(s1, perec, at('2026-10-13T12:00')).proibido).toBe(true);
    expect(decide(s1, { ...perec, has_aetc: false }, at('2026-10-13T10:00')).proibido).toBe(true);
    expect(decide(s4, perec, at('2026-10-13T07:00')).codigo).toBe('excecao');
    expect(decide(s4, perec, at('2026-10-13T18:00')).proibido).toBe(true); // § 4º: perecível só 05–09h
    const concreto = { ...TRUCK, has_aetc: true, cargo_type: 'concrete' as const };
    expect(decide(s1, concreto, at('2026-10-13T15:30')).codigo).toBe('excecao');
    expect(decide(s1, concreto, at('2026-10-13T16:30')).proibido).toBe(true);
    // art. 28, § 3º: a concretagem-bomba fica estacionada seg–sex 12–14h nas VER do § 1º (o perfil não separa da betoneira)
    expect(decide(s1, concreto, at('2026-10-13T11:00')).codigo).toBe('excecao');
    expect(decide(s1, concreto, at('2026-10-13T13:00')).proibido).toBe(true);
    expect(decide(s1, concreto, at('2026-10-17T12:30')).codigo).toBe('excecao'); // sábado: o § 3º do art. 28 fala só de 2ª a 6ª
    expect(decide(s2, concreto, at('2026-10-13T13:00')).codigo).toBe('excecao'); // §§ 2º–4º: sem a parada das 12–14h
    const mudanca = { ...TRUCK, has_aetc: true, cargo_type: 'moving' as const };
    expect(decide(s1, mudanca, at('2026-10-13T10:00')).proibido).toBe(true);
    expect(decide(s2, mudanca, at('2026-10-13T10:00')).codigo).toBe('excecao');
  });

  it('§ 4º: só 05–09h e 17–21h nos dias úteis', () => {
    expect(decide(s4, TRUCK, at('2026-10-13T07:00')).proibido).toBe(true);
    expect(decide(s4, TRUCK, at('2026-10-13T10:00')).proibido).toBe(false);
    expect(decide(s4, TRUCK, at('2026-10-13T18:00')).proibido).toBe(true);
    expect(decide(s4, TRUCK, at('2026-10-17T11:00')).proibido).toBe(true);
  });

  it('feriado e veículo de até 3,5 t não sofrem a restrição', () => {
    expect(decide(s1, TRUCK, at('2026-10-13T10:00'), { holiday: { name: 'teste', scope: 'national' } }).codigo).toBe('feriado');
    expect(decide(s1, { ...TRUCK, weight_t: 3.5 }, at('2026-10-13T10:00')).codigo).toBe('nao_caminhao');
  });

  it('§ 5º (Portaria 49/2021) fica inativo até a liberação do Rodoanel Norte e então revoga § 4º I–IV', () => {
    expect(vigente(s5, false)).toBe(false);
    expect(vigente(s5, true)).toBe(true);
    expect(vigente(s4i, false)).toBe(true);
    expect(vigente(s4i, true)).toBe(false);
    expect(decide(s5, TRUCK, at('2026-10-13T23:00')).proibido).toBe(true); // período integral
    expect(decide(s5, { ...TRUCK, cargo_od_in_city: true }, at('2026-10-13T10:00')).codigo).toBe('excecao');
    expect(decide(s5, { ...TRUCK, cargo_od_in_city: true, has_aetc: true }, at('2026-10-13T10:00')).proibido).toBe(true); // art. 38-A, p. único
    expect(decide(s5, { ...TRUCK, cargo_od_in_city: true, has_aetc: true }, at('2026-10-13T22:00')).codigo).toBe('excecao');
  });
});

describe('VER — annotate(): feriado do dia da PASSAGEM, não do dia da saída', () => {
  // Rota sintética: 20 km em linha reta a oeste + a Ponte do Tatuapé sentido Tatuapé (§ 4º XXXIV, uma cadeia de ~860 m).
  // Com duration_s = 8 h, a passagem pela ponte fica ~7h40 depois da saída.
  async function anotar(departure: string) {
    const q = await pool.query(`select id::text, ST_AsGeoJSON(geom, 7)::json as g from data_features where layer_id = 'ver' and source_id = 'p137-a2-s4-xxxiv'`);
    expect(q.rows.length, 'p137-a2-s4-xxxiv não está no banco').toBe(1);
    const g = q.rows[0].g as GeoJSON.MultiLineString;
    const c = g.coordinates[0] as [number, number][];
    const far: [number, number] = [c[0][0] - 0.2, c[0][1]];
    const line = turf.lineString([far, ...c]);
    const ctx: RouteCtx = { vehicle: TRUCK, at: at(departure).toJSDate(), departureLocal: departure, tz: TZ,
      origin: { lon: far[0], lat: far[1] }, destination: { lon: c[c.length - 1][0], lat: c[c.length - 1][1] } };
    const a = await verLayer.annotate!(ctx, { line, distance_km: turf.length(line), duration_s: 8 * 3600 });
    const usada = ((a.data as any)?.usadas ?? []).find((u: any) => u.id === q.rows[0].id);
    expect(usada, JSON.stringify(a.data)).toBeTruthy();
    return { a, usada, id: q.rows[0].id as string };
  }

  it('sai às 22h do feriado (12/10) e passa às ~05h40 de terça, dia útil: PROIBIDA', async () => {
    const { a, usada, id } = await anotar('2026-10-12T22:00');
    expect(usada.data_passagem).toBe('2026-10-13');
    expect(usada.proibido).toBe(true);
    expect(a.warnings!.some((w) => w.code === 'ver_proibida' && w.id === id && w.severity === 'danger')).toBe(true);
    expect((a.summary ?? []).join(' ')).not.toMatch(/Feriado na passagem|— feriado \(/);
  });

  it('sai às 22h de domingo e passa às ~05h40 do feriado (12/10): liberada', async () => {
    const { a, usada, id } = await anotar('2026-10-11T22:00');
    expect(usada.data_passagem).toBe('2026-10-12');
    expect(usada.proibido).toBe(false);
    expect(usada.motivo).toMatch(/^feriado \(Nossa Senhora Aparecida\)/);
    expect(a.warnings!.some((w) => w.code === 'ver_proibida' && w.id === id)).toBe(false);
    expect(a.summary![0]).toMatch(/Feriado na passagem \(Nossa Senhora Aparecida, 12\/10\)/);
  });
});

// Morumbi (Av. Prof. Francisco Morato, perto da Av. Manfredo Leite) → Butantã: o caminho natural é a Francisco Morato (VER § 1º, IV),
// fora da ZMRC. Roberto Marinho (VER § 2º, IV): Brooklin → Campo Belo.
const FM_A = { lat: -23.6040, lon: -46.7440 };
const FM_B = { lat: -23.5700, lon: -46.7090 };
const RM_A = { lat: -23.6125, lon: -46.6960 };
const RM_B = { lat: -23.6370, lon: -46.6625 };

async function verLines(bbox: string, nome: RegExp): Promise<GeoJSON.Feature[]> {
  const r = await get(`/api/layers/ver/features?bbox=${bbox}&zoom=15`);
  expect(r.status).toBe(200);
  return r.body.features.filter((f: any) => nome.test(f.properties.name));
}

/** metros da rota que ficam a até 15 m de alguma das linhas */
function overlapM(r: any, feats: GeoJSON.Feature[]): number {
  const lines = feats.flatMap((f) => (f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [(f.geometry as GeoJSON.LineString).coordinates])
    .filter((c) => c.length >= 2).map((c) => turf.lineString(c)));
  const c = r.geometry.coordinates as [number, number][];
  let m = 0;
  for (let i = 0; i < c.length - 1; i++) {
    const mid = turf.midpoint(turf.point(c[i]), turf.point(c[i + 1]));
    if (lines.some((l) => turf.pointToLineDistance(mid, l, { units: 'meters' }) <= 15)) {
      m += turf.distance(turf.point(c[i]), turf.point(c[i + 1]), { units: 'meters' });
    }
  }
  return m;
}
const verAvoided = (r: any, nome: RegExp) => r.body.avoided.filter((a: any) => a.layer === 'ver' && nome.test(a.name ?? ''));

describe('VER — efeito na rota', () => {
  let fm: GeoJSON.Feature[];
  let rm: GeoJSON.Feature[];
  beforeAll(async () => {
    await waitForStack();
    const l = await get('/api/layers');
    const ver = l.body.find((x: any) => x.id === 'ver');
    expect(ver, 'camada ver não carregada na API').toBeTruthy();
    expect(ver.affects_route).toBe(true);
    fm = await verLines('-46.76,-23.62,-46.69,-23.56', /Francisco Morato/);
    rm = await verLines('-46.71,-23.65,-46.65,-23.60', /Roberto Marinho/);
    expect(fm.length && rm.length, 'feições da Francisco Morato / Roberto Marinho não encontradas').toBeTruthy();
  });

  it('caminhão às 22h de terça passa pela Av. Francisco Morato (fora da janela)', async () => {
    const r = await route({ origin: FM_A, destination: FM_B, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T22:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, fm), 'pré-condição: o caminho natural usa a Francisco Morato').toBeGreaterThan(1000);
    expect(verAvoided(r, /./)).toHaveLength(0);
    expect(r.body.warnings.some((w: any) => w.code === 'ver_proibida')).toBe(false);
    expect((r.body.layers.ver?.summary ?? []).join(' ')).toMatch(/Francisco Morato.*liberada/);
  });

  it('caminhão às 10h de terça desvia da VER § 1º', async () => {
    const r = await route({ origin: FM_A, destination: FM_B, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, fm)).toBeLessThan(150);
    expect(verAvoided(r, /Francisco Morato/).length).toBeGreaterThan(0);
    expect(r.body.warnings.some((w: any) => w.code === 'ver_proibida')).toBe(false);
    expect(r.body.valhalla.cost_lines_count).toBeGreaterThan(0);
  });

  it('VUC com AETC às 10h continua proibido na VER § 1º', async () => {
    const r = await route({ origin: FM_A, destination: FM_B, vehicle: { preset: 'vuc', has_aetc: true }, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, fm)).toBeLessThan(150);
    expect(verAvoided(r, /Francisco Morato/).length).toBeGreaterThan(0);
  });

  it('VER § 2º: VUC com AETC passa às 10h; caminhão desvia', async () => {
    const vuc = await route({ origin: RM_A, destination: RM_B, vehicle: { preset: 'vuc', has_aetc: true }, departure_at: '2026-10-13T10:00' });
    expect(vuc.status, JSON.stringify(vuc.body)).toBe(200);
    const natural = overlapM(vuc.body, rm);
    expect(natural, 'VUC com AETC deveria usar a Roberto Marinho').toBeGreaterThan(1000);
    expect(vuc.body.warnings.some((w: any) => w.code === 'ver_excecao')).toBe(true);
    const truck = await route({ origin: RM_A, destination: RM_B, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T10:00' });
    expect(truck.status, JSON.stringify(truck.body)).toBe(200);
    // cruzamentos e o acesso inicial perto da Marginal contam alguns metros; o trajeto pela avenida (> 1 km) some
    expect(overlapM(truck.body, rm)).toBeLessThan(Math.min(400, natural * 0.15));
    expect(verAvoided(truck, /Roberto Marinho/).length).toBeGreaterThan(0);
    expect(truck.body.warnings.some((w: any) => w.code === 'ver_proibida')).toBe(false);
  });

  it('aviso danger quando a rota chega à VER dentro da janela (saída 04:35 de Jundiaí, Marginal Tietê às ~05:20)', async () => {
    const r = await route({ origin: { lat: -23.1860, lon: -46.8840 }, destination: { lat: -23.5250, lon: -46.6000 }, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T04:35' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = r.body.warnings.filter((x: any) => x.code === 'ver_proibida');
    expect(w.length).toBeGreaterThan(0);
    expect(w.some((x: any) => x.severity === 'danger' && /Marginal Tietê/.test(x.message) && /§ 4º/.test(x.message))).toBe(true);
  });

  it('RJ → Mooca saindo 23h59 do feriado (12/10): a passagem é na terça e o feriado não libera as VER', async () => {
    const r = await route({ origin: { lat: -22.88, lon: -43.28 }, destination: { lat: -23.55, lon: -46.599 }, vehicle: { preset: 'truck' }, departure_at: '2026-10-12T23:59' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const usadas: any[] = r.body.layers.ver?.data?.usadas ?? [];
    expect(usadas.length, 'pré-condição: a rota chega à Mooca pela Radial/Salim/Bresser').toBeGreaterThan(0);
    for (const u of usadas) {
      expect(u.data_passagem).toBe('2026-10-13');
      expect(u.motivo).not.toMatch(/^feriado/);
    }
    expect((r.body.layers.ver?.summary ?? []).join(' ')).not.toMatch(/Feriado na passagem|— feriado \(/);
    // passagem por volta das 05h: o que cai a partir das 05:00 é proibido (§§ 1º e 4º) e vira ver_proibida
    if (usadas.some((u) => u.horario_passagem >= '05:00')) {
      expect(usadas.filter((u) => u.horario_passagem >= '05:00' && u.horario_passagem < '09:00').every((u) => u.proibido)).toBe(true);
      expect(r.body.warnings.some((w: any) => w.code === 'ver_proibida')).toBe(true);
    }
  }, 400_000); // rota de ~425 km com todas as camadas: 1–1,5 min com a máquina ocupada

  it('duração não inflada pelo factor 1000: VUC sem AETC às 10h com origem perto da VER (Jules Rimet)', async () => {
    const r = await route({ origin: { lat: -23.6, lon: -46.72 }, destination: { lat: -23.615, lon: -46.68 }, vehicle: { preset: 'vuc' }, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.valhalla.cost_lines_count).toBeGreaterThan(0);
    // o /route do Valhalla 3.9.1 devolvia 16 507 s (factor aplicado também ao tempo); re-cronometrada, ~34 min para ~15 km
    expect(r.body.duration_s).toBeLessThan(3600);
    expect(r.body.duration_s / 60 / r.body.distance_km).toBeLessThan(5); // < 5 min/km (> 12 km/h de média)
  });

  it('mapa: linhas com cor por parágrafo e sem o § 5º inativo', async () => {
    const r = await get('/api/layers/ver/features?bbox=-46.80,-23.66,-46.50,-23.48&zoom=12');
    expect(r.status).toBe(200);
    expect(r.body.features.length).toBeGreaterThan(50);
    const cores = new Set(r.body.features.map((f: any) => f.properties.color));
    expect(cores.size).toBeGreaterThanOrEqual(4);
    expect(r.body.features.every((f: any) => /LineString/.test(f.geometry.type))).toBe(true);
    expect(r.body.features.some((f: any) => f.properties.paragrafo === 5)).toBe(false);
  });
});
