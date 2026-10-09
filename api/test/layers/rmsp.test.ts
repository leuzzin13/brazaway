import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { get, pool, route, waitForStack } from '../helpers.js';
import layer, { describeJanelas, enquadrar, janelaAtiva, type Regra } from '../../src/layers/restricoes_rmsp.layer.js';
import { resolveVehicle } from '../../src/services/vehicle.js';

/**
 * Camada restricoes_rmsp (Grande SP fora da capital). 2026-10-13 é terça; 2026-10-17 sábado; 2026-10-18 domingo.
 * Rotas contra a API (API_URL); regras e recortes de rota chamando o módulo da camada direto (mesmo banco).
 */
const TZ = 'America/Sao_Paulo';
const at = (s: string) => DateTime.fromISO(s, { zone: TZ }).toJSDate();
const ctxOf = (o: { lat: number; lon: number }, d: { lat: number; lon: number }, when: string, vehicle: Record<string, unknown>) =>
  ({ vehicle: resolveVehicle(vehicle as any), at: at(when), departureLocal: when, origin: o, destination: d, tz: TZ });

// Osasco: Av. dos Autonomistas a oeste do Centro → Vila Yara/Autonomistas a leste; o caminho natural corta a ZMRC
const OSA_A = { lat: -23.5262, lon: -46.7990 };
const OSA_B = { lat: -23.5420, lon: -46.7640 };
const OSA_CENTRO = { lat: -23.5320, lon: -46.7800 };          // dentro da ZMRC
const CARRETA = { preset: 'carreta' };

let zmrc: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
function crossesZmrc(r: any) {
  const inset = turf.buffer(zmrc as any, -0.03, { units: 'kilometers' }) ?? zmrc;
  return turf.booleanIntersects(turf.lineString(r.geometry.coordinates), inset as any);
}

beforeAll(async () => {
  await waitForStack();
  const f = await get(`/api/layers/restricoes_rmsp/features?bbox=-46.80,-23.55,-46.76,-23.52&zoom=14`);
  expect(f.status).toBe(200);
  zmrc = f.body.features.find((x: any) => x.properties.kind === 'zona' && /ZMRC de Osasco/.test(x.properties.name));
  expect(zmrc, 'ZMRC de Osasco não está no banco (rode os importadores rmsp_* ou aplique db/seed/layers/restricoes_rmsp__osasco.sql)').toBeTruthy();
  for (const p of [OSA_A, OSA_B]) expect(turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), zmrc as any)).toBe(false);
  expect(turf.booleanPointInPolygon(turf.point([OSA_CENTRO.lon, OSA_CENTRO.lat]), zmrc as any)).toBe(true);
}, 600_000);

afterAll(async () => { await pool.end(); });

describe('catálogo e mapa', () => {
  it('a camada aparece em /api/layers com fontes, licenças e efeito na rota', async () => {
    const r = await get('/api/layers');
    const l = r.body.find((x: any) => x.id === 'restricoes_rmsp');
    expect(l).toBeTruthy();
    expect(l.affects_route).toBe(true);
    expect(l.sources.some((s: any) => /ODbL/.test(s.license))).toBe(true);
    expect(l.runs.map((x: any) => x.source)).toEqual(expect.arrayContaining(['osasco', 'barueri', 'guarulhos', 'cajamar', 'santana-parnaiba', 'ribeirao-pires', 'ibge']));
  });

  it('features traz zonas e vias com regra legível, sem municípios nem a regra revogada', async () => {
    const r = await get('/api/layers/restricoes_rmsp/features?bbox=-46.90,-23.75,-46.35,-23.30&zoom=14');
    const kinds = new Set(r.body.features.map((f: any) => f.properties.kind));
    expect([...kinds].sort()).toEqual(['via', 'zona']);
    const ver = r.body.features.find((f: any) => f.properties.regime === 'VER' && f.properties.municipio === 'Osasco');
    expect(ver.properties.description).toMatch(/seg–sex 7h–9h e 17h–19h, exceto feriados/);
    for (const m of ['Osasco', 'Barueri', 'Guarulhos', 'Cajamar', 'Santana de Parnaíba', 'Ribeirão Pires']) {
      expect(r.body.features.some((f: any) => f.properties.municipio === m), m).toBe(true);
    }
  });

  it('restrição regional do ABC (2012) está registrada como revogada e nunca é aplicada', async () => {
    const q = await pool.query(`select kind, props->>'status' as status, valid_to < now() as expirada from data_features where layer_id = 'restricoes_rmsp' and source_id = 'abc-2012-revogada'`);
    expect(q.rows[0]).toEqual({ kind: 'revogada', status: 'revogada', expirada: true });
    const f = await get('/api/layers/restricoes_rmsp/features?bbox=-46.65,-23.80,-46.45,-23.60&zoom=14');
    expect(f.body.features.some((x: any) => /ABC/.test(x.properties.name ?? ''))).toBe(false);
  });
});

describe('Osasco — ZMRC e VER', () => {
  it('carreta às 22h de terça passa pela ZMRC (fora da janela)', async () => {
    const r = await route({ origin: OSA_A, destination: OSA_B, vehicle: CARRETA, departure_at: '2026-10-13T22:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(crossesZmrc(r.body), 'rota livre deveria cortar a ZMRC (pré-condição)').toBe(true);
    expect(r.body.avoided.find((a: any) => a.layer === 'restricoes_rmsp')).toBeUndefined();
  }, 120_000);

  it('carreta às 08h de terça desvia da ZMRC e das VER', async () => {
    const r = await route({ origin: OSA_A, destination: OSA_B, vehicle: CARRETA, departure_at: '2026-10-13T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(crossesZmrc(r.body), 'rota às 08h não deveria cortar a ZMRC').toBe(false);
    const av = r.body.avoided.filter((a: any) => a.layer === 'restricoes_rmsp');
    expect(av.some((a: any) => a.type === 'ZMRC' && /Osasco/.test(a.name))).toBe(true);
    expect(av.some((a: any) => a.type === 'VER')).toBe(true);
  }, 120_000);

  it('sábado 12h a ZMRC vale; domingo 12h não', async () => {
    const sab = await route({ origin: OSA_A, destination: OSA_B, vehicle: CARRETA, departure_at: '2026-10-17T12:00' });
    expect(sab.status).toBe(200);
    expect(crossesZmrc(sab.body)).toBe(false);
    const dom = await route({ origin: OSA_A, destination: OSA_B, vehicle: CARRETA, departure_at: '2026-10-18T12:00' });
    expect(dom.status).toBe(200);
    expect(crossesZmrc(dom.body)).toBe(true);
  }, 120_000);

  it('origem dentro da ZMRC: não exclui a zona e avisa', async () => {
    const r = await route({ origin: OSA_CENTRO, destination: OSA_B, vehicle: CARRETA, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.avoided.find((a: any) => a.type === 'ZMRC' && /Osasco/.test(a.name ?? ''))).toBeUndefined();
    expect(r.body.warnings.some((w: any) => w.code === 'rmsp_origem_na_zona' && w.layer === 'restricoes_rmsp')).toBe(true);
  }, 120_000);

  it('VUC em Osasco é tratado como caminhão (isenção não confirmada) e recebe aviso', async () => {
    const r = await route({ origin: OSA_A, destination: OSA_B, vehicle: { preset: 'vuc', is_vuc: true }, departure_at: '2026-10-13T10:00' });
    expect(r.status).toBe(200);
    expect(crossesZmrc(r.body)).toBe(false);
    expect(r.body.warnings.some((w: any) => w.code === 'rmsp_vuc_nao_confirmado')).toBe(true);
  }, 120_000);

  it('saída às 6h55: VER fora da janela na saída, mas a rota avisa se passar nela já no horário', async () => {
    const r = await route({ origin: OSA_A, destination: OSA_B, vehicle: CARRETA, departure_at: '2026-10-13T06:55' });
    expect(r.status).toBe(200);
    // a ZMRC (5h–21h) está ativa: desvia
    expect(crossesZmrc(r.body)).toBe(false);
    const data = r.body.layers.restricoes_rmsp?.data as any;
    if (data?.hits?.some((h: any) => h.regime === 'VER' && h.ativa_na_passagem && !h.ativa_na_saida)) {
      expect(r.body.warnings.some((w: any) => w.code === 'rmsp_via_ativa_na_passagem')).toBe(true);
    }
  }, 120_000);
});

describe('regras por município (módulo da camada)', () => {
  const regra = async (id: string): Promise<Regra> => {
    const q = await pool.query(`select props from data_features where layer_id = 'restricoes_rmsp' and props->>'regra_id' = $1 limit 1`, [id]);
    expect(q.rows.length, `regra ${id} não importada`).toBe(1);
    return q.rows[0].props;
  };

  it('janelas e descrição', async () => {
    const r = await regra('guarulhos_zrcc_tb');
    expect(describeJanelas(r.janelas)).toBe('seg–sex 6h–9h e 17h–20h; sáb 10h–14h');
    expect(janelaAtiva(r.janelas, at('2026-10-13T08:59'))).toBe(true);
    expect(janelaAtiva(r.janelas, at('2026-10-13T09:00'))).toBe(false);
    expect(janelaAtiva(r.janelas, at('2026-10-17T11:00'))).toBe(true);
  });

  it('VUC por município: Guarulhos 2,20 x 7,20 isento; Barueri 2,20 x 6,30 só com cadastro; SP-VUC 7,2 m não é VUC em Barueri', async () => {
    const vuc = resolveVehicle({ preset: 'vuc', length_m: 7.2, width_m: 2.2 } as any);
    expect(enquadrar(await regra('guarulhos_zrcc_tb'), vuc)).toMatchObject({ aplica: false, vucIsento: true });
    expect(enquadrar(await regra('barueri_ver'), vuc)).toMatchObject({ aplica: true, classe: 'caminhão' });
    const vuc63 = resolveVehicle({ preset: 'vuc', length_m: 6.3, width_m: 2.2 } as any);
    expect(enquadrar(await regra('barueri_ver'), vuc63)).toMatchObject({ aplica: true, vucSoComCadastro: true });
  });

  it('Cajamar: carreta (>3 eixos) tem janela 6h–20h no Centro; caminhão 7h–9h e 16h–20h', async () => {
    const r = await regra('cajamar_anexo_1');
    const carreta = enquadrar(r, resolveVehicle({ preset: 'carreta' } as any));
    const truck = enquadrar(r, resolveVehicle({ preset: 'truck' } as any));
    expect(carreta.classe).toBe('carreta');
    expect(janelaAtiva(carreta.janelas, at('2026-10-18T12:00'))).toBe(true);   // domingo também (Anexo I)
    expect(truck.classe).toBe('caminhão');
    expect(janelaAtiva(truck.janelas, at('2026-10-18T12:00'))).toBe(false);
  });

  it('Santana de Parnaíba (PBT > 15 t) e Ribeirão Pires (> 2 eixos ou > 16 t)', async () => {
    const sp = await regra('santana_parnaiba_24h');
    expect(enquadrar(sp, resolveVehicle({ preset: 'toco', weight_t: 15 } as any)).aplica).toBe(false);
    expect(enquadrar(sp, resolveVehicle({ preset: 'toco', weight_t: 15.5 } as any)).aplica).toBe(true);
    const rp = await regra('ribeirao_pires_zrc');
    expect(enquadrar(rp, resolveVehicle({ preset: 'toco', weight_t: 16, axle_count: 2 } as any)).aplica).toBe(false);
    expect(enquadrar(rp, resolveVehicle({ preset: 'truck' } as any)).aplica).toBe(true);   // 3 eixos
  });

  it('Ribeirão Pires: ZRC vira exclusão para caminhão 3 eixos e não para 2 eixos/16 t', async () => {
    const o = { lat: -23.7030, lon: -46.4250 }, d = { lat: -23.7160, lon: -46.3990 };
    const ex3 = await layer.exclusions!(ctxOf(o, d, '2026-10-13T03:00', { preset: 'truck' }) as any);
    expect(ex3.some((e) => e.item.type === 'ZRC')).toBe(true);
    const ex2 = await layer.exclusions!(ctxOf(o, d, '2026-10-13T03:00', { preset: 'toco', weight_t: 16, axle_count: 2 }) as any);
    expect(ex2.some((e) => e.item.type === 'ZRC')).toBe(false);
  });

  it('Santana de Parnaíba: vias 24h saem do request quando o destino é no município (art. 2º)', async () => {
    const barueriA = { lat: -23.495, lon: -46.850 }, barueriB = { lat: -23.490, lon: -46.835 };
    const santana = { lat: -23.4675, lon: -46.8460 };
    const passa = await layer.costLines!(ctxOf(barueriA, barueriB, '2026-10-13T11:00', CARRETA) as any);
    expect(passa.some((c) => c.item.type === 'PBT > 15 t (24h)')).toBe(true);
    const entrega = await layer.costLines!(ctxOf(barueriA, santana, '2026-10-13T11:00', CARRETA) as any);
    expect(entrega.some((c) => c.item.type === 'PBT > 15 t (24h)')).toBe(false);
  });

  it('Barueri: trecho com sentido (Av. Aruanã sentido São Paulo) entra só num sentido; demais VER nos dois', async () => {
    const lines = await layer.costLines!(ctxOf({ lat: -23.495, lon: -46.850 }, { lat: -23.497, lon: -46.828 }, '2026-10-13T18:00', CARRETA) as any);
    const barueri = lines.filter((c) => /Barueri/.test(c.item.name ?? ''));
    expect(barueri.length).toBeGreaterThan(0);
    const aruana = barueri.filter((c) => /Aruanã/.test(c.item.name ?? ''));
    expect(aruana.length).toBeGreaterThan(0);
    const key = (c: [number, number][]) => c.map((p) => p.join(',')).join(';');
    const fw = new Set(aruana.map((c) => key(c.coordinates)));
    expect(aruana.some((c) => fw.has(key([...c.coordinates].reverse())))).toBe(false);
    // às 18h de sábado não há restrição em Barueri (seg–sex)
    const sab = await layer.costLines!(ctxOf({ lat: -23.495, lon: -46.850 }, { lat: -23.497, lon: -46.828 }, '2026-10-17T18:00', CARRETA) as any);
    expect(sab.some((c) => /Barueri/.test(c.item.name ?? ''))).toBe(false);
  });

  it('Guarulhos: ZRCC-TB às 7h de terça penaliza só os ramos do trevo; VUC 2,20 x 7,20 fica livre', async () => {
    const o = { lat: -23.4350, lon: -46.4300 }, d = { lat: -23.4180, lon: -46.3900 };
    const carreta = await layer.costLines!(ctxOf(o, d, '2026-10-13T07:00', CARRETA) as any);
    expect(carreta.some((c) => c.item.type === 'ZRCC-TB')).toBe(true);
    const vuc = await layer.costLines!(ctxOf(o, d, '2026-10-13T07:00', { preset: 'vuc', length_m: 7.2, width_m: 2.2 }) as any);
    expect(vuc.some((c) => c.item.type === 'ZRCC-TB')).toBe(false);
  });
});
