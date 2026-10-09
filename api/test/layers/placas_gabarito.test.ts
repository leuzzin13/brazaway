import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { get, lineOf, pool, route, waitForStack } from '../helpers.js';

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
    // a restrição real de 2021 (histórica, liberada) só informa
    const hist = oae.find((x) => x.id === limaoHistId);
    expect(hist?.code).toBe('oae_restricao_historica');
    expect(hist?.severity).toBe('info');
    expect(hist?.message).toMatch(/Ponte do Limão.*liberada/);
  });

  it('restrição histórica não bloqueia ninguém', async () => {
    await cleanup();
    const r = await route({ origin: LIM_A, destination: LIM_B, vehicle: CARRETA_440, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(r.body.avoided.map((a: any) => a.id)).not.toContain(limaoHistId);
    expect(warningsOf(r.body, 'oae').find((x) => x.id === limaoHistId)?.severity).toBe('info');
  });
});

describe('OAEs nomeadas (SIURB) e placas do DER-SP', () => {
  beforeAll(async () => { await waitForStack(); });
  afterAll(async () => { await pool.end(); });

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
