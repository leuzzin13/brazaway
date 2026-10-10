import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { get, lineOf, pool, route, waitForStack } from '../helpers.js';
import oaeLayer, { criterioAplica, motivosBloqueio, restricaoVigente, type OaeProps, type Restricao } from '../../src/layers/oae.layer.js';
import { resolveVehicle } from '../../src/services/vehicle.js';
import { pool as apiPool } from '../../src/db.js';
import type { RouteCtx } from '../../src/layers/types.js';

/**
 * Frente placas_gabarito: passarelas ARTESP com altura (bloqueio por altura com folga de 0,10 m), restrições
 * curadas em pontes/viadutos (vigente bloqueia, histórica só informa), OAEs nomeadas da SIURB e placas do DER-SP.
 *
 * As passarelas reais da ARTESP têm >= 5,38 m, então os testes de bloqueio inserem feições de TESTE (source
 * TEST_SOURCE) no mesmo ponto de uma passarela real que a rota usa, e as apagam no fim.
 */
const TEST_SOURCE = 'teste_placas_gabarito';
const DEP = '2026-10-13T22:30';   // terça à noite: fora da ZMRC e do rodízio

// Corredor da Anhanguera (SP-330) na capital: Lapa → Jaraguá (passa sob ~11 passarelas da ARTESP)
const ANH_A = { lat: -23.5050, lon: -46.7180 };
const ANH_B = { lat: -23.4300, lon: -46.7900 };
// Travessia da Ponte do Limão (Limão → Barra Funda)
const LIM_A = { lat: -23.5080, lon: -46.6700 };
const LIM_B = { lat: -23.5250, lon: -46.6640 };
// SP-036 (DER-SP), trecho com placas R-14/R-18
const SP036_A = { lat: -23.3995, lon: -46.4440 };
const SP036_B = { lat: -23.3480, lon: -46.4180 };

afterAll(async () => { await pool.end(); await apiPool.end(); });

const CARRETA_440 = { preset: 'carreta', height_m: 4.4 };
const TRUCK_420 = { preset: 'truck', height_m: 4.2 };
const TRUCK_419 = { preset: 'truck', height_m: 4.19 };
const VUC_320 = { preset: 'vuc', height_m: 3.2, is_vuc: true };

async function insertFixture(sourceId: string, name: string, kind: string, geometry: GeoJSON.Geometry, props: Record<string, unknown>): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `insert into data_features (layer_id, source, source_id, name, kind, geom, props)
     values ('oae', $1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326), $6::jsonb)
     on conflict (layer_id, source, source_id) do update set name = excluded.name, geom = excluded.geom, props = excluded.props
     returning id::text`,
    [TEST_SOURCE, sourceId, name, kind, JSON.stringify(geometry), JSON.stringify(props)],
  );
  return r.rows[0].id;
}
const cleanup = () => pool.query(`delete from data_features where source = $1`, [TEST_SOURCE]);

const distM = (r: any, lonlat: [number, number]) => turf.pointToLineDistance(turf.point(lonlat), lineOf(r), { units: 'meters' });
const warningsOf = (r: any, layer: string) => (r.warnings as any[]).filter((w) => w.layer === layer);

describe('Passarela com altura conhecida (ARTESP) na rota', () => {
  let passarela: { id: string; name: string; lon: number; lat: number; altura: number };
  let fixtureId: string;

  beforeAll(async () => {
    await waitForStack();
    await cleanup();
    // rota de VUC pela Anhanguera e uma passarela ARTESP real no meio dela
    const free = await route({ origin: ANH_A, destination: ANH_B, vehicle: VUC_320, departure_at: DEP });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    const line = JSON.stringify(free.body.geometry);
    const q = await pool.query(
      `with l as (select ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) g)
       select f.id::text, f.name, ST_X(f.geom) lon, ST_Y(f.geom) lat, (f.props->>'altura_livre_m')::float altura
         from data_features f, l
        where f.layer_id = 'oae' and f.source = 'artesp' and (f.props->>'altura_livre_m') is not null
          and ST_DWithin(f.geom::geography, l.g::geography, 15)
        order by ST_LineLocatePoint(l.g, f.geom)`,
      [line],
    );
    expect(q.rows.length, 'a rota da Anhanguera deveria passar sob passarelas da ARTESP').toBeGreaterThan(2);
    passarela = q.rows[Math.floor(q.rows.length / 2)];
    // feição de teste: mesma passarela, altura livre 4,30 m (real é >= 5,38 m)
    fixtureId = await insertFixture('passarela_430', `Passarela de teste 4,30 m (${passarela.name})`, 'passarela',
      { type: 'Point', coordinates: [passarela.lon, passarela.lat] },
      { altura_livre_m: 4.3, altura_fonte: 'teste automatizado', peso_max_t: null,
        bloqueio: { modo: 'sob', pontos: [[passarela.lon, passarela.lat]], raio_m: 35 } });
  });

  afterAll(async () => { await cleanup(); });

  it('a passarela real aparece na rota com a altura publicada (info)', async () => {
    const r = await route({ origin: ANH_A, destination: ANH_B, vehicle: VUC_320, departure_at: DEP });
    expect(r.status).toBe(200);
    const ids = (r.body.layers.oae.data.altura_conhecida as any[]).map((a) => a.id);
    expect(ids).toContain(passarela.id);
  });

  it('carreta de 4,40 m recebe bloqueio duro na passarela de 4,30 m (desvio + aviso danger)', async () => {
    const r = await route({ origin: ANH_A, destination: ANH_B, vehicle: CARRETA_440, departure_at: DEP });
    if (r.status === 409) {
      expect(r.body.blocked_by.map((b: any) => b.id)).toContain(fixtureId);
      return;
    }
    expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(200);
    expect(r.body.avoided.map((a: any) => a.id)).toContain(fixtureId);
    const d = distM(r.body, [passarela.lon, passarela.lat]);
    expect(d, `rota passou a ${d.toFixed(0)} m da passarela`).toBeGreaterThan(25);
    const w = warningsOf(r.body, 'oae').find((x) => x.id === fixtureId);
    expect(w, JSON.stringify(warningsOf(r.body, 'oae'))).toBeTruthy();
    expect(w.severity).toBe('danger');
    expect(w.code).toBe('oae_altura_desvio');
    expect(w.message).toMatch(/altura livre 4,30 m/);
  });

  it('caminhão de 4,20 m também é bloqueado (altura >= 4,30 m - folga 0,10 m)', async () => {
    const r = await route({ origin: ANH_A, destination: ANH_B, vehicle: TRUCK_420, departure_at: DEP });
    expect([200, 409]).toContain(r.status);
    const ids = r.status === 200 ? r.body.avoided.map((a: any) => a.id) : r.body.blocked_by.map((b: any) => b.id);
    expect(ids).toContain(fixtureId);
  });

  it('caminhão de 4,19 m passa sob a passarela (fora da folga)', async () => {
    const r = await route({ origin: ANH_A, destination: ANH_B, vehicle: TRUCK_419, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(r.body.avoided.map((a: any) => a.id)).not.toContain(fixtureId);
    expect(distM(r.body, [passarela.lon, passarela.lat])).toBeLessThan(35);
  });

  it('VUC de 3,20 m passa sob a passarela, só com aviso info', async () => {
    const r = await route({ origin: ANH_A, destination: ANH_B, vehicle: VUC_320, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(r.body.avoided.map((a: any) => a.id)).not.toContain(fixtureId);
    expect(distM(r.body, [passarela.lon, passarela.lat])).toBeLessThan(35);
    const oae = warningsOf(r.body, 'oae');
    expect(oae.some((w) => w.severity === 'danger')).toBe(false);
    const info = oae.find((w) => w.code === 'oae_altura_ok');
    expect(info?.severity).toBe('info');
    expect(info?.message).toMatch(/menor 4,30 m/);
  });
});

describe('Restrições curadas em pontes/viadutos', () => {
  let limaoHistId: string;
  let fixtureId: string;

  beforeAll(async () => {
    await waitForStack();
    await cleanup();
    const h = await pool.query(`select id::text, props->'bloqueio' bloqueio, ST_AsGeoJSON(geom)::json g
                                  from data_features where layer_id = 'oae' and source = 'curadoria' and source_id = 'ponte_limao_2021'`);
    expect(h.rows.length, 'rode o importador oae_restricoes_curadas').toBe(1);
    limaoHistId = h.rows[0].id;
    // restrição VIGENTE de teste no mesmo eixo: proibido caminhões, VUC liberado
    fixtureId = await insertFixture('limao_vigente', 'Ponte do Limão (restrição de teste)', 'ponte', h.rows[0].g, {
      restricao: { tipo: 'proibido_pesados', valor: null, unidade: null, aplica_a: 'caminhões (teste), exceto VUC', criterio: { caminhoes: true, exceto_vuc: true },
        sentido: 'ambos', status: 'vigente', inicio: '2026-01-01', fim: null, ato: 'teste automatizado', fonte_url: 'https://example.invalid/teste',
        fonte_data: '2026-10-09', liberacao: null, liberacao_url: null, liberacao_data: null, liberacao_fonte: null, verificado_em: '2026-10-09', orgao: 'teste', obs: null },
      altura_livre_m: null, peso_max_t: null, bloqueio: h.rows[0].bloqueio,
    });
  });

  afterAll(async () => { await cleanup(); });

  it('restrição vigente que alcança o veículo vira bloqueio (carreta desvia da ponte)', async () => {
    const r = await route({ origin: LIM_A, destination: LIM_B, vehicle: CARRETA_440, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(200);
    expect(r.body.avoided.map((a: any) => a.id)).toContain(fixtureId);
    const w = warningsOf(r.body, 'oae').find((x) => x.id === fixtureId);
    expect(w?.severity).toBe('danger');
    expect(w?.code).toBe('oae_restricao_desvio');
  });

  it('VUC (exceção do critério) passa pela ponte e recebe só informação', async () => {
    const r = await route({ origin: LIM_A, destination: LIM_B, vehicle: VUC_320, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(r.body.avoided.map((a: any) => a.id)).not.toContain(fixtureId);
    const oae = warningsOf(r.body, 'oae');
    expect(oae.find((x) => x.id === fixtureId)?.code).toBe('oae_restricao_nao_aplica');
    // a restrição real de 2021 é histórica: a fonte oficial fala em obra concluída e faixas liberadas, sem citar
    // caminhões → aviso "confira" (warn), nunca bloqueio
    const hist = oae.find((x) => x.id === limaoHistId);
    expect(hist?.code).toBe('oae_restricao_historica');
    expect(hist?.severity).toBe('warn');
    expect(hist?.message).toMatch(/Ponte do Limão.*obra concluída \(fonte oficial de 14\/09\/2021\), mas sem liberação explícita para caminhões/);
  });

  it('restrição histórica não bloqueia ninguém', async () => {
    await cleanup();
    const r = await route({ origin: LIM_A, destination: LIM_B, vehicle: CARRETA_440, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(r.body.avoided.map((a: any) => a.id)).not.toContain(limaoHistId);
    const w = warningsOf(r.body, 'oae').find((x) => x.id === limaoHistId);
    expect(w?.code).toBe('oae_restricao_historica');
    expect(w?.severity).not.toBe('danger');
  });
});

describe('OAEs nomeadas (SIURB) e placas do DER-SP', () => {
  beforeAll(async () => { await waitForStack(); });

  it('rota que sai do Viaduto Guadalajara lista o nome e o status da obra', async () => {
    const q = await pool.query(`select ST_X(geom) lon, ST_Y(geom) lat from data_features where layer_id = 'oae' and source = 'siurb' and name = 'Viaduto Guadalajara'`);
    expect(q.rows.length, 'rode o importador siurb_oae').toBe(1);
    const r = await route({ origin: { lat: q.rows[0].lat, lon: q.rows[0].lon }, destination: { lat: -23.5470, lon: -46.5800 }, vehicle: TRUCK_420, departure_at: DEP });
    expect(r.status).toBe(200);
    expect((r.body.layers.oae.summary as string[]).join(' ')).toMatch(/Viaduto Guadalajara \(obra concluída/);
  });

  it('placas R-14/R-18 perto da rota viram aviso "confira" (sem bloquear)', async () => {
    const r = await route({ origin: SP036_A, destination: SP036_B, vehicle: TRUCK_420, departure_at: DEP });
    expect(r.status).toBe(200);
    const ws = warningsOf(r.body, 'placas_restricao');
    expect(ws.length).toBeGreaterThan(0);
    expect(ws.every((w) => w.severity === 'warn' || w.severity === 'info')).toBe(true);
    expect(ws.some((w) => /^Placa de limite de peso bruto total \(R-14\) a \d+ m da rota \(SP-036 km [\d,]+\) — confira/.test(w.message))).toBe(true);
    expect(ws.some((w) => /^Placa de limite de comprimento \(R-18\) a \d+ m da rota \(SP-036 km [\d,]+\) — confira o valor no local\.$/.test(w.message))).toBe(true);
    expect(r.body.layers.placas_restricao.summary[0]).toMatch(/R-14/);
    expect(r.body.avoided.filter((a: any) => a.layer === 'placas_restricao')).toEqual([]);
  });

  it('catálogo e feições das camadas', async () => {
    const l = await get('/api/layers');
    const byId = Object.fromEntries((l.body as any[]).map((x) => [x.id, x]));
    expect(byId.oae.affects_route).toBe(true);
    expect(byId.placas_restricao.annotates_route).toBe(true);
    expect(byId.oae.runs.map((r: any) => r.source)).toEqual(expect.arrayContaining(['artesp', 'siurb', 'curadoria']));
    // zoom 10 na Anhanguera: só feições com limite/nome (passarelas ARTESP com "limite")
    const f = await get('/api/layers/oae/features?bbox=-46.80,-23.52,-46.70,-23.42&zoom=10');
    const art = (f.body.features as any[]).filter((x) => x.properties.source === 'artesp');
    expect(art.length).toBeGreaterThan(3);
    expect(art.some((x) => /^altura livre \d,\d{2} m$/.test(x.properties.limite))).toBe(true);
    expect((f.body.features as any[]).some((x) => x.properties.source === 'geosampa')).toBe(false);
    const p = await get('/api/layers/placas_restricao/features?bbox=-46.46,-23.40,-46.40,-23.34&zoom=12');
    expect((p.body.features as any[]).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Regras da camada sem Valhalla (funções exportadas de oae.layer.ts + dados reais do banco)

const V = (o: Record<string, unknown>) => resolveVehicle(o as any);
const ctxDe = (vehicle: ReturnType<typeof V>, departureLocal: string, origin: { lat: number; lon: number }, destination: { lat: number; lon: number }): RouteCtx => ({
  vehicle, departureLocal, origin, destination, tz: 'America/Sao_Paulo',
  at: new Date(`${departureLocal}:00-03:00`),
});
const TATUI = { lat: -23.3556, lon: -47.8569 };
const IPERO = { lat: -23.3503, lon: -47.6889 };

async function curada(sourceId: string): Promise<{ id: string; props: OaeProps; eixo: [number, number][] }> {
  const q = await pool.query(`select id::text, props, ST_AsGeoJSON(geom)::json g from data_features where layer_id = 'oae' and source = 'curadoria' and source_id = $1`, [sourceId]);
  expect(q.rows.length, `rode o importador oae_restricoes_curadas (${sourceId})`).toBe(1);
  return { id: q.rows[0].id, props: q.rows[0].props, eixo: q.rows[0].g.coordinates };
}
const restricaoBase = (o: Partial<Restricao>): Restricao => ({
  tipo: 'proibido_pesados', valor: null, unidade: null, aplica_a: null, criterio: { caminhoes: true }, sentido: null,
  status: 'vigente', inicio: null, fim: null, ato: null, fonte_url: 'https://example.invalid', fonte_data: null,
  liberacao: null, liberacao_url: null, liberacao_data: null, liberacao_fonte: null, verificado_em: '2026-10-09',
  orgao: 'teste', obs: null, ...o,
});

describe('Regras da camada oae (sem rota)', () => {
  it('Tatuí–Iperó (interditada desde 30/05/2026, critério todos) bloqueia carreta e VUC na data da viagem, não antes', async () => {
    const t = await curada('ponte_tatui_ipero_2026');
    expect(t.props.restricao?.status).toBe('vigente');
    for (const v of [V(CARRETA_440), V(VUC_320)]) {
      const m = motivosBloqueio(t.props, v, '2026-10-13');
      expect(m.map((x) => x.code)).toEqual(['oae_restricao']);
      expect(m[0].mensagem).toMatch(/^interditada desde 30\/05\/2026/);
      expect(motivosBloqueio(t.props, v, '2026-05-29')).toEqual([]);
    }
  });

  it('critério pbt>23 e eixos>2 usam ">" estrito; exceto_vuc libera VUC', () => {
    expect(criterioAplica({ peso_acima_t: 23 }, V({ preset: 'carreta' }))).toBe(true);           // 41,5 t
    expect(criterioAplica({ peso_acima_t: 23 }, V({ preset: 'truck' }))).toBe(false);            // 23 t
    expect(criterioAplica({ peso_acima_t: 23 }, V({ preset: 'truck', weight_t: 23.1 }))).toBe(true);
    expect(criterioAplica({ eixos_acima: 2 }, V({ preset: 'truck' }))).toBe(true);               // 3 eixos
    expect(criterioAplica({ eixos_acima: 2 }, V({ preset: 'toco' }))).toBe(false);               // 2 eixos
    expect(criterioAplica({ altura_min_m: 4.4 }, V(CARRETA_440))).toBe(true);
    expect(criterioAplica({ altura_min_m: 4.4 }, V(TRUCK_420))).toBe(false);
    expect(criterioAplica({ caminhoes: true, exceto_vuc: true }, V(VUC_320))).toBe(false);
    expect(criterioAplica({ caminhoes: true, exceto_vuc: false }, V(VUC_320))).toBe(true);
    expect(criterioAplica({ nenhum: true }, V(CARRETA_440))).toBe(false);
  });

  it('restricaoVigente respeita status, início e fim (inclusive) na data local', () => {
    const r = restricaoBase({ inicio: '2026-06-01', fim: '2026-06-30' });
    expect(restricaoVigente(r, '2026-05-31')).toBe(false);
    expect(restricaoVigente(r, '2026-06-01')).toBe(true);
    expect(restricaoVigente(r, '2026-06-30')).toBe(true);
    expect(restricaoVigente(r, '2026-07-01')).toBe(false);
    expect(restricaoVigente({ ...r, status: 'historica' }, '2026-06-15')).toBe(false);
    expect(restricaoVigente(restricaoBase({}), '2030-01-01')).toBe(true);
  });

  it('limite de altura/peso de restrição curada só vale dentro da vigência (início futuro não bloqueia hoje)', () => {
    const p: OaeProps = {
      altura_livre_m: 4.3, peso_max_t: 12, bloqueio: { modo: 'sob', pontos: [[-46.6, -23.5]], raio_m: 10 },
      restricao: restricaoBase({ tipo: 'altura', valor: 4.3, criterio: { altura_min_m: 4.2 }, inicio: '2026-12-01' }),
    };
    expect(motivosBloqueio(p, V(CARRETA_440), '2026-10-13')).toEqual([]);
    expect(motivosBloqueio(p, V(CARRETA_440), '2026-12-01').map((m) => m.code)).toEqual(['oae_altura', 'oae_peso']);
    // sem restrição curada (ex.: ARTESP) o limite vale sempre
    expect(motivosBloqueio({ altura_livre_m: 4.3 }, V(CARRETA_440), '2026-10-13').map((m) => m.code)).toEqual(['oae_altura']);
  });

  it('exclusions(): corredor Tatuí→Iperó traz a ponte interditada na data da viagem, e não antes do início', async () => {
    const t = await curada('ponte_tatui_ipero_2026');
    const ex = await oaeLayer.exclusions!(ctxDe(V(CARRETA_440), '2026-10-13T22:30', TATUI, IPERO));
    const it_ = ex.find((e) => e.item.id === t.id);
    expect(it_, JSON.stringify(ex.map((e) => e.item.name))).toBeTruthy();
    expect(it_!.item.rule).toBe('interditada');
    expect(it_!.rings.length).toBe(1);
    expect(turf.booleanPointInPolygon(turf.point([-47.73833, -23.35373]), turf.polygon([it_!.rings[0]]))).toBe(true);
    const vuc = await oaeLayer.exclusions!(ctxDe(V(VUC_320), '2026-10-13T22:30', TATUI, IPERO));
    expect(vuc.map((e) => e.item.id)).toContain(t.id);
    const antes = await oaeLayer.exclusions!(ctxDe(V(CARRETA_440), '2026-05-29T10:00', TATUI, IPERO));
    expect(antes.map((e) => e.item.id)).not.toContain(t.id);
  });

  it('annotate() sobre a Ponte Jânio Quadros: histórica liberada explicitamente → só info "já liberada"', async () => {
    const j = await curada('ponte_janio_quadros_2019');
    const line = turf.lineString(j.eixo);
    const ctx = ctxDe(V(CARRETA_440), '2026-10-13T22:30', { lon: j.eixo[0][0], lat: j.eixo[0][1] }, { lon: j.eixo[1][0], lat: j.eixo[1][1] });
    expect(await oaeLayer.exclusions!(ctx).then((e) => e.map((x) => x.item.id))).not.toContain(j.id);
    const a = await oaeLayer.annotate!(ctx, { line, distance_km: 0.3, duration_s: 30 });
    const w = a.warnings!.find((x) => x.id === j.id);
    expect(w?.code).toBe('oae_restricao_historica');
    expect(w?.severity).toBe('info');
    expect(w?.message).toMatch(/já liberada \(fonte oficial de 04\/11\/2019\)/);
  });

  it('ARTESP: altura "2,40 m" (suspeita) nunca bloqueia, só informa; a passarela de 6,35 m do mesmo RA entra como altura conhecida', async () => {
    const q = await pool.query(`select id::text, source_id, props from data_features where layer_id = 'oae' and source = 'artesp' and props->>'ra' = '010113000276' order by source_id`);
    expect(q.rows.map((r) => r.source_id)).toEqual(['010113000276', '010113000276-2', '010113000276-3']);
    const susp = q.rows.filter((r) => r.props.altura_suspeita);
    expect(susp.length).toBe(2);
    const ok = q.rows.find((r) => !r.props.altura_suspeita)!;
    expect(ok.props.altura_livre_m).toBe(6.35);
    const [lon, lat] = ok.props.bloqueio.pontos[0];
    const line = turf.lineString([[lon, lat - 0.0008], [lon, lat], [lon, lat + 0.0008]]);
    const ctx = ctxDe(V(CARRETA_440), '2026-10-13T22:30', { lon, lat: lat - 0.0008 }, { lon, lat: lat + 0.0008 });
    const ex = (await oaeLayer.exclusions!(ctx)).map((e) => e.item.id);
    for (const r of q.rows) expect(ex).not.toContain(r.id);
    const a = await oaeLayer.annotate!(ctx, { line, distance_km: 0.2, duration_s: 10 });
    const ws = a.warnings!.filter((w) => susp.some((s) => s.id === w.id));
    expect(ws.length).toBe(2);
    expect(ws.every((w) => w.code === 'oae_altura_suspeita' && w.severity === 'info')).toBe(true);
    expect(ws[0].message).toMatch(/informa altura de 2,40 m, valor incompatível/);
    expect((a.data as any).altura_conhecida.map((x: any) => x.id)).toContain(ok.id);
  });
});

describe('ARTESP: passarela com altura por pista (linha "Transversal")', () => {
  beforeAll(async () => { await waitForStack(); });

  it('SP-264 km 112,8 ("Pista Norte: 5,48m; Pista Sul: 5,43m") bloqueia veículo de 5,40 m e deixa passar o de 5,32 m', async () => {
    const q = await pool.query(`select id::text, source_id, props from data_features where layer_id = 'oae' and source = 'artesp' and source_id = any($1) order by source_id`,
      [['SP-264-105.7', 'SP-264-112.8', 'SP-264-116.3']]);
    expect(q.rows.length, 'rode o importador artesp_passarelas').toBe(3);
    const [a, alvo, b] = q.rows;
    expect(alvo.props.altura_livre_m).toBe(5.43);
    expect(alvo.props.altura_por_pista).toEqual([{ pista: 'Pista Norte', altura_m: 5.48 }, { pista: 'Pista Sul', altura_m: 5.43 }]);
    expect(alvo.props.bloqueio.ajuste).toBe('pistas_rodovia');
    expect(alvo.props.bloqueio.pontos.length).toBeGreaterThanOrEqual(2);
    const [olon, olat] = a.props.bloqueio.pontos[0];
    const [dlon, dlat] = b.props.bloqueio.pontos[0];
    const od = { origin: { lat: olat, lon: olon }, destination: { lat: dlat, lon: dlon }, departure_at: DEP };

    const baixo = await route({ ...od, vehicle: { preset: 'truck', height_m: 5.32 } });
    expect(baixo.status).toBe(200);
    expect(baixo.body.avoided.map((x: any) => x.id)).not.toContain(alvo.id);
    expect((baixo.body.layers.oae.data.altura_conhecida as any[]).map((x) => x.id)).toContain(alvo.id);

    const alto = await route({ ...od, vehicle: { preset: 'truck', height_m: 5.4 } });
    expect([200, 409]).toContain(alto.status);
    if (alto.status === 409) {
      expect(alto.body.blocked_by.map((x: any) => x.id)).toContain(alvo.id);
      return;
    }
    expect(alto.body.avoided.map((x: any) => x.id)).toContain(alvo.id);
    const w = warningsOf(alto.body, 'oae').find((x) => x.id === alvo.id);
    expect(w?.severity).toBe('danger');
    expect(w?.message).toMatch(/altura livre 5,43 m/);
    for (const [lon, lat] of alvo.props.bloqueio.pontos as [number, number][]) expect(distM(alto.body, [lon, lat])).toBeGreaterThan(8);
  });
});
