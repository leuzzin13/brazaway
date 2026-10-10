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
const RODOTREM = { preset: 'rodotrem' };   // 30 m, 74 t: excede comprimento e PBTC (art. 1º); CVC com AET
const CARRETA = { preset: 'carreta' };     // 19,3 m, 41,5 t: dentro dos limites, sem AET
const TRUCK = { preset: 'truck' };         // 12 m, 2,6 m, 23 t: dentro dos limites
// Truck com carga de 2,80 m de largura: excede a largura do art. 1º (2,60 m) e não é CVC. Nas rotas pela BR-459/SP ele é
// o excedente "puro": o SIAET/DNIT (camada federal_restricoes) tem restrição temporária de 15 m de comprimento na
// BR-459/SP km 0–32,2 (10/2026), que tira dali a carreta e o rodotrem em qualquer dia.
const LARGO = { preset: 'truck', width_m: 2.8 };
const layerWarnings = (r: any) => r.body.warnings.filter((w: any) => w.layer === LAYER);
const costLines = (r: any) => r.body.layers?.[LAYER]?.data?.cost_lines ?? 0;

let br459: { lat: number; lon: number };   // meio da BR-459/SP km 16,5–32,2 (SNV)
let br459a: { lat: number; lon: number };  // BR-459/SP km ~5 (30% do 459BSP0170)
let br459b: { lat: number; lon: number };  // BR-459/SP km ~11,5 (70% do 459BSP0170)
let dutra: { lat: number; lon: number };   // meio da BR-116/SP km 117,4–128,1 (SNV 116BSP2410), entre SJC e Taubaté

async function snvMid(sourceId: string, frac = 0.5) {
  const r = await pool.query(
    `select ST_Y(p) lat, ST_X(p) lon from (select ST_LineInterpolatePoint(ST_GeometryN(geom, 1), $3) p
       from data_features where layer_id = $1 and source = 'snv-dnit' and source_id = $2) x`, [LAYER, sourceId, frac]);
  expect(r.rows[0], `trecho ${sourceId} (SNV) não encontrado`).toBeTruthy();
  return { lat: Number(r.rows[0].lat), lon: Number(r.rows[0].lon) };
}

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
    dutra = await snvMid('116BSP2410');
    br459a = await snvMid('459BSP0170', 0.3);
    br459b = await snvMid('459BSP0170', 0.7);
  });

  it('importou a Portaria DIOP/PRF nº 121/2026 do DOU com os limites do art. 1º e as janelas do Anexo I', async () => {
    const r = await pool.query(
      `select props->>'ato' ato, props->'limites' lim, count(*) over () n,
              count(*) filter (where props->>'escopo' = 'pista_simples_federal') over () nac,
              count(*) filter (where props->>'escopo' = 'trechos') over () tr
         from data_features where layer_id = $1 and source = 'prf-dou' and kind = 'janela' limit 1`, [LAYER]);
    expect(r.rows[0].ato).toBe('Portaria DIOP/PRF nº 121/2026');
    expect(r.rows[0].lim).toEqual({ largura_m: 2.6, altura_m: 4.4, comprimento_m: 19.8, pbtc_t: 58.5 });
    expect(Number(r.rows[0].nac)).toBe(33);   // 30 nacionais + 3 dos Festejos Juninos
    expect(Number(r.rows[0].tr)).toBe(7);     // 6 de SP (§ 5º, Aparecida) + 1 de MS (BR-262)
    const ap = await pool.query(
      `select valid_from, valid_to from data_features where layer_id = $1 and source = 'prf-dou'
          and name like '%Consciência Negra · 20/11%'`, [LAYER]);
    expect(ap.rows[0].valid_from.toISOString()).toBe('2026-11-20T09:00:00.000Z');   // 06:00 de Brasília
    expect(ap.rows[0].valid_to.toISOString()).toBe('2026-11-20T15:00:00.000Z');     // 12:00 de Brasília
    // tabela de SP: "Acima de 3,20 m de largura" (02 a 08/10 na BR-116 km 0–195), só para quem tem AET/AE
    const larg = await pool.query(
      `select props from data_features where layer_id = $1 and source = 'prf-dou' and props->>'criterio' = 'largura'
        order by valid_from`, [LAYER]);
    expect(larg.rows.length).toBe(2);
    expect(larg.rows.every((x: any) => x.props.largura_min_m === 3.2 && x.props.so_aet === true)).toBe(true);
    expect(larg.rows[0].props.trechos).toEqual([{ br: '116', uf: 'SP', km_ini: 0, km_fim: 195 }]);
    expect(larg.rows[0].props.inicio).toBe('2026-10-02T00:00:00-03:00');
    expect(larg.rows[0].props.fim).toBe('2026-10-09T00:00:00-03:00');
    // tabela de MS: BR-262 km 233–328, 09/04 das 12h às 22h, com horário na própria tabela
    const ms = await pool.query(
      `select props from data_features where layer_id = $1 and source = 'prf-dou' and props->'trechos'->0->>'uf' = 'MS'`, [LAYER]);
    expect(ms.rows.length).toBe(1);
    expect(ms.rows[0].props.trechos).toEqual([{ br: '262', uf: 'MS', km_ini: 233, km_fim: 328 }]);
    expect(ms.rows[0].props.criterio).toBe('art1');
    expect(ms.rows[0].props.horario_na_tabela).toBe(true);
    expect([ms.rows[0].props.inicio, ms.rows[0].props.fim]).toEqual(['2026-04-09T12:00:00-03:00', '2026-04-09T22:00:00-03:00']);
  });

  // ------------------------------------------------------------------ PRF, pista simples federal
  it('excedente em feriado (20/11 08:00, Consciência Negra): evita a BR-459 e avisa (danger) quando libera', async () => {
    const r = await route({ origin: P.itajuba, destination: P.guaratingueta, vehicle: LARGO, departure_at: '2026-11-20T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r).find((x: any) => x.code === 'prf_feriado_desvio');
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.severity).toBe('danger');
    expect(w.message).toMatch(/Liberado a partir de sex 20\/11 12:00/);
    expect(w.message).toMatch(/Portaria DIOP\/PRF nº 121\/2026/);
    expect(w.message).toMatch(/largura 2,8 m > 2,6 m/);
    expect(w.message, 'truck não é CVC: o § 1º não se aplica').not.toMatch(/CVC com AET/);
    expect(r.body.avoided.some((a: any) => a.layer === LAYER && String(a.id).includes('459BSP0170'))).toBe(true);
    expect(r.body.valhalla.cost_lines_count).toBeGreaterThan(0);
    expect(minDistM(r.body, br459), 'rota no feriado não deveria passar pela BR-459').toBeGreaterThan(1000);
  });

  it('mesmo veículo fora da janela (qua 18/11 08:00, nada nas próximas 24 h): usa a BR-459, sem aviso nem penalidade', async () => {
    const r = await route({ origin: P.itajuba, destination: P.guaratingueta, vehicle: LARGO, departure_at: '2026-11-18T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(layerWarnings(r).filter((w: any) => /^prf_/.test(w.code))).toEqual([]);
    expect(costLines(r)).toBe(0);
    expect(minDistM(r.body, br459)).toBeLessThan(60);
  });

  it('qui 19/11 10:00: a janela começa em menos de 24 h → só aviso info, sem desvio', async () => {
    const r = await route({ origin: P.itajuba, destination: P.guaratingueta, vehicle: LARGO, departure_at: '2026-11-19T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r).find((x: any) => x.code === 'prf_feriado_proximo');
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.severity).toBe('info');
    expect(w.message).toMatch(/qui 19\/11 16:00–22:00/);
    expect(costLines(r)).toBe(0);
    expect(minDistM(r.body, br459)).toBeLessThan(60);
  });

  it('truck dentro dos limites no feriado (20/11 08:00) não é afetado e segue pela BR-459', async () => {
    const r = await route({ origin: P.itajuba, destination: P.guaratingueta, vehicle: TRUCK, departure_at: '2026-11-20T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(layerWarnings(r).filter((w: any) => /^prf_/.test(w.code))).toEqual([]);
    expect(minDistM(r.body, br459)).toBeLessThan(60);
  });

  it('truck de 16 m (AET por comprimento, art. 4º) dentro dos limites do art. 1º: a PRF não pega (§ 1º é só para CVC)', async () => {
    const r = await route({ origin: P.itajuba, destination: P.guaratingueta, vehicle: { ...TRUCK, length_m: 16 }, departure_at: '2026-11-20T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.vehicle.requires_aet).toBe(true);
    expect(layerWarnings(r).filter((w: any) => /^prf_/.test(w.code)), JSON.stringify(layerWarnings(r))).toEqual([]);
    expect(costLines(r)).toBe(0);
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
    expect(minDistM(r.body, dutra), 'rota com AET não deveria passar pela Dutra km 117–128').toBeGreaterThan(1000);
  });

  it('Aparecida: carreta sem AET no mesmo horário segue pela Dutra', async () => {
    const r = await route({ origin: P.sjc, destination: P.taubate, vehicle: CARRETA, departure_at: '2026-10-11T03:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(layerWarnings(r).filter((w: any) => /^prf_/.test(w.code))).toEqual([]);
    expect(costLines(r)).toBe(0);
    expect(minDistM(r.body, dutra), 'carreta deveria seguir pela Dutra').toBeLessThan(60);
  });

  it('Aparecida, regra de largura (02 a 08/10): carreta de 3,30 m em 06/10 10:00 evita a Dutra até ter 13/10 00:00', async () => {
    const r = await route({ origin: P.sjc, destination: P.taubate, vehicle: { ...CARRETA, width_m: 3.3 }, departure_at: '2026-10-06T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r).find((x: any) => x.code === 'prf_feriado_desvio');
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.severity).toBe('danger');
    expect(w.message).toMatch(/largura 3,3 m > 3,2 m/);
    // a de largura acaba em 08/10, mas a de 09 a 12/10 (todas as restrições do art. 1º) também pega 3,30 m > 2,60 m
    expect(w.message).toMatch(/Liberado a partir de ter 13\/10 00:00/);
    expect(minDistM(r.body, dutra)).toBeGreaterThan(1000);
  });

  it('Aparecida, regra de largura: carreta de 3,00 m em 06/10 10:00 não é afetada (só acima de 3,20 m) e segue pela Dutra', async () => {
    const r = await route({ origin: P.sjc, destination: P.taubate, vehicle: { ...CARRETA, width_m: 3.0 }, departure_at: '2026-10-06T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    // 3,00 m > 2,60 m: a BR-488 (todas as restrições do art. 1º desde 02/10) pega o veículo, mas a rota não passa lá
    const prf = layerWarnings(r).filter((w: any) => /^prf_/.test(w.code));
    expect(prf.filter((w: any) => w.severity !== 'info'), JSON.stringify(prf)).toEqual([]);
    expect(prf.every((w: any) => !/BR-116/.test(w.message)), JSON.stringify(prf)).toBe(true);
    expect(costLines(r)).toBe(0);
    expect(minDistM(r.body, dutra)).toBeLessThan(60);
  });

  it('origem e destino na própria BR-459 no feriado: um só danger para o trecho, "sem alternativa", nunca "não testado"', async () => {
    // a rota não tem como evitar a BR-459 (km ~5 → km ~11,5). O trecho foi penalizado pela camada, então:
    //  - ou o routing.ts avisa 'uses_restricted_way' (danger) e a camada só complementa com info (prf_feriado_sem_alternativa);
    //  - ou o routing.ts não avisa (a rota usa menos da metade de cada linha penalizada) e a camada dá o danger
    //    'prf_feriado_na_rota' com "sem alternativa razoável".
    // Nos dois casos, um só danger para a BR-459, e nunca "desvio não testado" (o desvio foi tentado).
    const r = await route({ origin: br459a, destination: br459b, vehicle: LARGO, departure_at: '2026-11-20T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const generic = r.body.warnings.filter((w: any) => w.code === 'uses_restricted_way' && w.layer === LAYER && /BR-459/.test(w.message));
    const naRota = layerWarnings(r).filter((x: any) => x.code === 'prf_feriado_na_rota' && /BR-459/.test(x.message));
    expect(generic.length + naRota.length, JSON.stringify(r.body.warnings)).toBeGreaterThan(0);
    expect(naRota.every((x: any) => !/não foi testado/.test(x.message)), JSON.stringify(naRota)).toBe(true);
    if (generic.length) {
      expect(naRota, 'danger duplicado com o uses_restricted_way do routing.ts').toEqual([]);
      const info = layerWarnings(r).find((x: any) => x.code === 'prf_feriado_sem_alternativa');
      expect(info, JSON.stringify(r.body.warnings)).toBeTruthy();
      expect(info.severity).toBe('info');
      expect(info.message).toMatch(/espere até sex 20\/11 12:00/);
    } else {
      expect(naRota.length).toBe(1);
      expect(naRota[0].severity).toBe('danger');
      expect(naRota[0].message).toMatch(/BR-459\/SP km [\d,]+–[\d,]+, sem alternativa razoável/);
      expect(naRota[0].message).toMatch(/espere até sex 20\/11 12:00/);
    }
    expect(costLines(r)).toBeGreaterThan(0);
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

  it('segunda de Carnaval (16/02/2026 01:30, § 5º cita o Carnaval): serra fechada; próxima janela só depois do Carnaval', async () => {
    const r = await route({ origin: P.sp, destination: P.santos, vehicle: RODOTREM, departure_at: '2026-02-16T01:30' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(layerWarnings(r).find((x: any) => x.code === 'anchieta_cvc_aet_janela'), JSON.stringify(r.body.warnings)).toBeFalsy();
    const w = layerWarnings(r).find((x: any) => /^anchieta_cvc_aet_(desvio|na_rota)$/.test(x.code));
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(w.severity).toBe('danger');
    // seg 01h, seg→ter e ter→qua (começa na terça de Carnaval) bloqueadas; a de quarta 23h (Cinzas) já vale
    expect(w.message).toMatch(/Próxima janela: qua 18\/02 23:00 às qui 19\/02 05:00/);
    expect(costLines(r)).toBeGreaterThan(0);
  });

  it('quarta de Cinzas 23h30 (18/02/2026): fora do feriado prolongado, janela aberta', async () => {
    const r = await route({ origin: P.sp, destination: P.santos, vehicle: RODOTREM, departure_at: '2026-02-18T23:30' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r).find((x: any) => x.code === 'anchieta_cvc_aet_janela');
    expect(w, JSON.stringify(r.body.warnings)).toBeTruthy();
    expect(costLines(r)).toBe(0);
    expect(minDistM(r.body, P.anchieta45)).toBeLessThan(150);
  });

  it('carreta (não exige AET) desce a Anchieta às 10h sem aviso da portaria', async () => {
    const r = await route({ origin: P.sp, destination: P.santos, vehicle: CARRETA, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(layerWarnings(r).filter((w: any) => /^anchieta_/.test(w.code))).toEqual([]);
    expect(minDistM(r.body, P.anchieta45)).toBeLessThan(150);
  });

  it('truck com AET por largura (2,80 m) não é CVC: a regra da serra (art. 3º, "A CVC ... portadores de AET") não se aplica', async () => {
    const r = await route({ origin: P.sp, destination: P.santos, vehicle: LARGO, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.vehicle.requires_aet).toBe(true);
    expect(layerWarnings(r).filter((w: any) => /^anchieta_/.test(w.code)), JSON.stringify(layerWarnings(r))).toEqual([]);
  });

  // ------------------------------------------------------------------ Imigrantes: descida proibida a caminhão (OSM hgv=no)
  it('descida da Imigrantes: caminhão SP→Santos desce pela Anchieta, nunca pela SP-160 serra (já vem do OSM)', async () => {
    const r = await route({ origin: P.sp, destination: P.santos, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(minDistM(r.body, P.imigrantes45)).toBeGreaterThan(1000);
    expect(minDistM(r.body, P.anchieta45)).toBeLessThan(150);
  });
});
