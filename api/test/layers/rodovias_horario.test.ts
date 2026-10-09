import { beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { get, minDistM, pool, route, waitForStack } from '../helpers.js';

/**
 * Camada rodovias_horario contra a API local (API_URL) e o banco carregado pelos importadores
 * snv_dnit, prf_feriados e der_portarias. Datas são da Portaria DIOP/PRF nº 121/2026 (feriados de 2026).
 */
const LAYER = 'rodovias_horario';
const P = {
  itajuba: { lat: -22.4256, lon: -45.4528 },        // MG — sai pela BR-459 (pista simples federal) até Lorena
  guaratingueta: { lat: -22.8166, lon: -45.1925 },  // SP — Vale do Paraíba
  sjc: { lat: -23.1896, lon: -45.8841 },            // São José dos Campos
  taubate: { lat: -23.0264, lon: -45.5553 },        // Taubaté (Dutra km ~100–150 no meio)
  sp: { lat: -23.62, lon: -46.63 },                 // São Paulo (zona sul)
  santos: { lat: -23.9535, lon: -46.333 },
  anchieta45: { lat: -23.8903761, lon: -46.4814427 },    // marco km 45 da SP-150 (ARTESP)
  imigrantes45: { lat: -23.9281853, lon: -46.5489501 },  // marco km 45 da SP-160 (ARTESP)
};
const RODOTREM = { preset: 'rodotrem' };   // 30 m, 74 t: excede comprimento e PBTC (art. 1º)
const CARRETA = { preset: 'carreta' };     // 18,6 m, 41,5 t: dentro dos limites
const layerWarnings = (r: any) => r.body.warnings.filter((w: any) => w.layer === LAYER);
const costLines = (r: any) => r.body.layers?.[LAYER]?.data?.cost_lines ?? 0;

let br459: { lat: number; lon: number };   // meio da BR-459/SP km 16,5–32,2 (SNV)

describe('Camada rodovias_horario (PRF feriados + serra da Anchieta)', () => {
  beforeAll(async () => {
    await waitForStack();
    const layers = await get('/api/layers');
    const l = layers.body.find((x: any) => x.id === LAYER);
    expect(l, 'camada rodovias_horario não carregada na API').toBeTruthy();
    expect(l.affects_route).toBe(true);
    const sources = new Set(l.runs.map((r: any) => r.source));
    for (const s of ['snv-dnit', 'prf-dou', 'der-sp']) expect(sources.has(s), `importador ${s} não rodou`).toBe(true);
    const f = await get('/api/layers/rodovias_horario/features?bbox=-45.3,-22.8,-45.0,-22.5&zoom=12');
    const seg = f.body.features.find((x: any) => x.properties.codigo_snv === '459BSP0190');
    expect(seg, 'trecho 459BSP0190 (SNV) não encontrado no mapa da camada').toBeTruthy();
    const line = seg.geometry.type === 'LineString' ? turf.lineString(seg.geometry.coordinates) : turf.lineString(seg.geometry.coordinates[0]);
    const c = turf.along(line, turf.length(line) / 2).geometry.coordinates;
    br459 = { lon: c[0], lat: c[1] };
  });

  it('importou a Portaria DIOP/PRF nº 121/2026 do DOU com os limites do art. 1º e as janelas do Anexo I', async () => {
    const r = await pool.query(
      `select props->>'ato' ato, props->'limites' lim, count(*) over () n,
              count(*) filter (where props->>'escopo' = 'pista_simples_federal') over () nac
         from data_features where layer_id = $1 and source = 'prf-dou' and kind = 'janela' limit 1`, [LAYER]);
    expect(r.rows[0].ato).toBe('Portaria DIOP/PRF nº 121/2026');
    expect(r.rows[0].lim).toEqual({ largura_m: 2.6, altura_m: 4.4, comprimento_m: 19.8, pbtc_t: 58.5 });
    expect(Number(r.rows[0].nac)).toBe(33);   // 30 nacionais + 3 dos Festejos Juninos
    const ap = await pool.query(
      `select valid_from, valid_to from data_features where layer_id = $1 and source = 'prf-dou'
          and name like '%Consciência Negra · 20/11%'`, [LAYER]);
    expect(ap.rows[0].valid_from.toISOString()).toBe('2026-11-20T09:00:00.000Z');   // 06:00 de Brasília
    expect(ap.rows[0].valid_to.toISOString()).toBe('2026-11-20T15:00:00.000Z');     // 12:00 de Brasília
  });

  // ------------------------------------------------------------------ PRF, pista simples federal
  it('excedente em feriado (20/11 08:00, Consciência Negra): evita a BR-459 e avisa (danger) quando libera', async () => {
    const r = await route({ origin: P.itajuba, destination: P.guaratingueta, vehicle: RODOTREM, departure_at: '2026-11-20T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r).find((x: any) => x.code === 'prf_feriado_desvio');
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.severity).toBe('danger');
    expect(w.message).toMatch(/Liberado a partir de sex 20\/11 12:00/);
    expect(w.message).toMatch(/Portaria DIOP\/PRF nº 121\/2026/);
    expect(r.body.avoided.some((a: any) => a.layer === LAYER && String(a.id).includes('459BSP0170'))).toBe(true);
    expect(r.body.valhalla.cost_lines_count).toBeGreaterThan(0);
    expect(minDistM(r.body, br459), 'rota no feriado não deveria passar pela BR-459').toBeGreaterThan(1000);
  });

  it('mesmo veículo fora da janela (qua 18/11 08:00, nada nas próximas 24 h): usa a BR-459, sem aviso nem penalidade', async () => {
    const r = await route({ origin: P.itajuba, destination: P.guaratingueta, vehicle: RODOTREM, departure_at: '2026-11-18T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(layerWarnings(r).filter((w: any) => /^prf_/.test(w.code))).toEqual([]);
    expect(costLines(r)).toBe(0);
    expect(minDistM(r.body, br459)).toBeLessThan(60);
  });

  it('qui 19/11 10:00: a janela começa em menos de 24 h → só aviso info, sem desvio', async () => {
    const r = await route({ origin: P.itajuba, destination: P.guaratingueta, vehicle: RODOTREM, departure_at: '2026-11-19T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r).find((x: any) => x.code === 'prf_feriado_proximo');
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.severity).toBe('info');
    expect(w.message).toMatch(/qui 19\/11 16:00–22:00/);
    expect(costLines(r)).toBe(0);
    expect(minDistM(r.body, br459)).toBeLessThan(60);
  });

  it('carreta dentro dos limites no feriado (20/11 08:00) não é afetada', async () => {
    const r = await route({ origin: P.itajuba, destination: P.guaratingueta, vehicle: CARRETA, departure_at: '2026-11-20T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(layerWarnings(r).filter((w: any) => /^prf_/.test(w.code))).toEqual([]);
    expect(minDistM(r.body, br459)).toBeLessThan(60);
  });

  // ------------------------------------------------------------------ PRF, Operação N. Sra. Aparecida (SP, § 5º)
  it('Aparecida (§ 5º): rodotrem com AET na madrugada de 11/10 evita a Dutra (pista dupla) entre SJC e Taubaté', async () => {
    const r = await route({ origin: P.sjc, destination: P.taubate, vehicle: { ...RODOTREM, requires_aet: true }, departure_at: '2026-10-11T03:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r).find((x: any) => x.code === 'prf_feriado_desvio');
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.severity).toBe('danger');
    expect(w.message).toMatch(/BR-116\/SP km 0–195/);
    expect(w.message).toMatch(/ter 13\/10 00:00/);
    expect(r.body.avoided.some((a: any) => a.layer === LAYER && /prf:116BSP/.test(a.id))).toBe(true);
  });

  it('Aparecida: carreta sem AET no mesmo horário segue pela Dutra', async () => {
    const r = await route({ origin: P.sjc, destination: P.taubate, vehicle: CARRETA, departure_at: '2026-10-11T03:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(layerWarnings(r).filter((w: any) => /^prf_/.test(w.code))).toEqual([]);
    expect(costLines(r)).toBe(0);
  });

  // ------------------------------------------------------------------ Serra da Anchieta (SUP/DER-084/2023)
  it('CVC com AET às 10h de ter 13/10: serra da Anchieta fechada → danger com a próxima janela (ter 23:00)', async () => {
    const r = await route({ origin: P.sp, destination: P.santos, vehicle: RODOTREM, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r).find((x: any) => /^anchieta_cvc_aet_(desvio|na_rota)$/.test(x.code));
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.severity).toBe('danger');
    expect(w.message).toMatch(/Próxima janela: ter 13\/10 23:00 às qua 14\/10 05:00/);
    expect(w.message).toMatch(/SUP\/DER-084-01\/11\/2023/);
    expect(costLines(r)).toBeGreaterThan(0);
  });

  it('mesmo veículo às 23h30 de terça: janela aberta → desce pela Anchieta, só aviso info', async () => {
    const r = await route({ origin: P.sp, destination: P.santos, vehicle: RODOTREM, departure_at: '2026-10-13T23:30' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r).find((x: any) => x.code === 'anchieta_cvc_aet_janela');
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.severity).toBe('info');
    expect(costLines(r)).toBe(0);
    expect(minDistM(r.body, P.anchieta45)).toBeLessThan(150);
  });

  it('seg 12/10 02:00 (feriado prolongado de N. Sra. Aparecida, § 5º): a janela de segunda 01h–05h não vale', async () => {
    const r = await route({ origin: P.sp, destination: P.santos, vehicle: RODOTREM, departure_at: '2026-10-12T02:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r).find((x: any) => /^anchieta_cvc_aet_(desvio|na_rota)$/.test(x.code));
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.message).toMatch(/Próxima janela: ter 13\/10 23:00/);
  });

  it('carreta (não exige AET) desce a Anchieta às 10h sem aviso da portaria', async () => {
    const r = await route({ origin: P.sp, destination: P.santos, vehicle: CARRETA, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(layerWarnings(r).filter((w: any) => /^anchieta_/.test(w.code))).toEqual([]);
    expect(minDistM(r.body, P.anchieta45)).toBeLessThan(150);
  });

  // ------------------------------------------------------------------ Imigrantes: descida proibida a caminhão (OSM hgv=no)
  it('descida da Imigrantes: caminhão SP→Santos desce pela Anchieta, nunca pela SP-160 serra (já vem do OSM)', async () => {
    const r = await route({ origin: P.sp, destination: P.santos, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(minDistM(r.body, P.imigrantes45)).toBeGreaterThan(1000);
    expect(minDistM(r.body, P.anchieta45)).toBeLessThan(150);
  });
});
