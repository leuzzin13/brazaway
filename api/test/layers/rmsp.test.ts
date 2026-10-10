import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { get, pool, route, waitForStack } from '../helpers.js';
import layer, { describeJanelas, enquadrar, janelaAtiva, usoDaLinha, type Regra } from '../../src/layers/restricoes_rmsp.layer.js';
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

  it('features aceita zoom fracionário ou inválido (sem 500)', async () => {
    for (const z of ['12.5', '13.7', 'abc', '']) {
      const r = await get(`/api/layers/restricoes_rmsp/features?bbox=-46.80,-23.55,-46.76,-23.52&zoom=${z}`);
      expect(r.status, `zoom=${z}`).toBe(200);
      expect(r.body.features.length).toBeGreaterThan(0);
    }
  });

  it('linhas de via com até ~450 m (o critério de 50% do routing.ts precisa de linhas curtas) e validadas no Valhalla', async () => {
    const q = await pool.query(`select count(*)::int n, max(ST_Length(geom::geography))::float as max_m,
        sum(case when (props->>'valhalla_validado')::boolean then 0 else 1 end)::int as sem_teste,
        sum(case when ST_GeometryType(geom) <> 'ST_LineString' then 1 else 0 end)::int as multi
      from data_features where layer_id = 'restricoes_rmsp' and kind = 'via'`);
    expect(q.rows[0].n).toBeGreaterThan(500);
    expect(q.rows[0].max_m).toBeLessThan(450);
    expect(q.rows[0].sem_teste).toBe(0);
    expect(q.rows[0].multi).toBe(0);
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

  it('saída às 6h55: VER fora da janela na saída, mas a rota avisa se passar nela já no horário (annotate)', async () => {
    // rota sintética: 2 km em linha reta e depois uma VER de mão dupla de Osasco fora da ZMRC; 20 min de viagem →
    // a VER é alcançada por volta das 7h12 (janela 7h–9h)
    const q = await pool.query(`select ST_AsGeoJSON(geom)::json g from data_features
      where layer_id = 'restricoes_rmsp' and props->>'regra_id' = 'osasco_ver' and props->>'sentido' = 'ambos'
        and ST_Length(geom::geography) between 250 and 450
        and not ST_DWithin(geom::geography, (select geom::geography from data_features where layer_id = 'restricoes_rmsp' and props->>'regra_id' = 'osasco_zmrc' and kind = 'zona'), 1500)
      order by id limit 1`);
    expect(q.rows.length).toBe(1);
    const ver = q.rows[0].g.coordinates as [number, number][];
    const a = ver[0], b = ver[1];
    const back = turf.destination(turf.point(a), 2, turf.bearing(turf.point(b), turf.point(a)), { units: 'kilometers' }).geometry.coordinates as [number, number];
    const coords = [back, ...ver];
    const routeGeom = { line: turf.lineString(coords), distance_km: turf.length(turf.lineString(coords)), duration_s: 20 * 60 };
    const o = { lon: back[0], lat: back[1] }, d = { lon: ver[ver.length - 1][0], lat: ver[ver.length - 1][1] };
    const ann = await layer.annotate!(ctxOf(o, d, '2026-10-13T06:55', CARRETA) as any, routeGeom as any);
    const hit = (ann.data as any).hits.find((h: any) => h.regra_id === 'osasco_ver');
    expect(hit).toMatchObject({ ativa_na_saida: false, ativa_na_passagem: true });
    expect(ann.warnings!.some((w) => w.code === 'rmsp_via_ativa_na_passagem')).toBe(true);
    // às 10h a VER está fora da janela na saída e na passagem: sem aviso
    const ann10 = await layer.annotate!(ctxOf(o, d, '2026-10-13T10:00', CARRETA) as any, routeGeom as any);
    expect(ann10.warnings!.some((w) => w.code === 'rmsp_via_ativa_na_passagem' || w.code === 'rmsp_via_restrita_na_rota')).toBe(false);
  });

  it('vias do art. 3º da ZMRC entram como costLines no horário da ZMRC, inclusive as que o polígono deixa de fora', async () => {
    const cl = await layer.costLines!(ctxOf(OSA_A, OSA_B, '2026-10-13T10:00', CARRETA) as any);
    const zv = cl.filter((c) => c.item.type === 'ZMRC (vias do art. 3º)');
    const nomes = new Set(zv.map((c) => c.item.name));
    for (const v of ['Viaduto Presidente Tancredo de Almeida Neves', 'Avenida Maria Campos', 'Avenida das Nações Unidas']) {
      expect([...nomes].some((n) => n?.includes(v)), v).toBe(true);
    }
    // fora do horário (22h) e com origem dentro da ZMRC (política da zona: não restringe, avisa) não entram
    const noite = await layer.costLines!(ctxOf(OSA_A, OSA_B, '2026-10-13T22:00', CARRETA) as any);
    expect(noite.some((c) => c.item.type === 'ZMRC (vias do art. 3º)')).toBe(false);
    const dentro = await layer.costLines!(ctxOf(OSA_CENTRO, OSA_B, '2026-10-13T10:00', CARRETA) as any);
    expect(dentro.some((c) => c.item.type === 'ZMRC (vias do art. 3º)')).toBe(false);
  });
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

  it('feriado: VER de Osasco fica suspensa (a portaria excetua feriados); a ZMRC de Osasco não', async () => {
    // feriado fictício numa terça distante, só para o teste (removido ao final)
    const ins = await pool.query(
      `insert into holidays (day, scope, name, source) values ('2030-03-12', 'national', 'TESTE rmsp', 'teste')
       on conflict do nothing returning id`);
    try {
      const comum = await layer.costLines!(ctxOf(OSA_A, OSA_B, '2030-03-19T08:00', CARRETA) as any);
      expect(comum.some((c) => c.item.type === 'VER' && /Osasco/.test(c.item.name ?? ''))).toBe(true);
      const feriado = await layer.costLines!(ctxOf(OSA_A, OSA_B, '2030-03-12T08:00', CARRETA) as any);
      expect(feriado.some((c) => c.item.type === 'VER' && /Osasco/.test(c.item.name ?? ''))).toBe(false);
      const zonas = await layer.exclusions!(ctxOf(OSA_A, OSA_B, '2030-03-12T08:00', CARRETA) as any);
      expect(zonas.some((e) => e.item.type === 'ZMRC')).toBe(true);
    } finally {
      if (ins.rows[0]) await pool.query(`delete from holidays where id = $1`, [ins.rows[0].id]);
    }
  });

  it('Ribeirão Pires: ZRC vira exclusão para caminhão 3 eixos e não para 2 eixos/16 t', async () => {
    const o = { lat: -23.7030, lon: -46.4250 }, d = { lat: -23.7160, lon: -46.3990 };
    const ex3 = await layer.exclusions!(ctxOf(o, d, '2026-10-13T03:00', { preset: 'truck' }) as any);
    expect(ex3.some((e) => e.item.type === 'ZRC')).toBe(true);
    const ex2 = await layer.exclusions!(ctxOf(o, d, '2026-10-13T03:00', { preset: 'toco', weight_t: 16, axle_count: 2 }) as any);
    expect(ex2.some((e) => e.item.type === 'ZRC')).toBe(false);
  });

  it('Santana de Parnaíba (art. 2º, I): exceção só com DESTINO no município e só nas vias de acesso listadas', async () => {
    const barueriA = { lat: -23.495, lon: -46.850 }, barueriB = { lat: -23.490, lon: -46.835 };
    const santana = { lat: -23.4675, lon: -46.8460 };
    const inc = (cl: any[]) => new Set(cl.filter((c) => c.item.type === 'PBT > 15 t (24h)').map((c) => c.item.id.split(':')[1]));
    const passa = await layer.costLines!(ctxOf(barueriA, barueriB, '2026-10-13T11:00', CARRETA) as any);
    expect(inc(passa).size).toBeGreaterThan(0);
    // origem em Santana, destino em Barueri: a exceção NÃO vale (o decreto fala em carga a ser entregue no município)
    const saindo = await layer.costLines!(ctxOf(santana, barueriB, '2026-10-13T11:00', CARRETA) as any);
    expect([...inc(saindo)]).toEqual(expect.arrayContaining(['II.1', 'II.2', 'II.4']));
    const entrega = await layer.costLines!(ctxOf(barueriA, santana, '2026-10-13T11:00', CARRETA) as any);
    expect(inc(entrega).size).toBe(0);
    // destino em Santana: Av. Pérola Byington (II.3) e R. D'Alessandro Carmine (II.12) não estão no art. 2º, I
    const carapicuiba = { lat: -23.520, lon: -46.840 }, santanaNorte = { lat: -23.4250, lon: -46.8600 };
    const ida = inc(await layer.costLines!(ctxOf(carapicuiba, santanaNorte, '2026-10-13T11:00', CARRETA) as any));
    expect([...ida].sort()).toEqual(['II.12', 'II.3']);
    const volta = inc(await layer.costLines!(ctxOf(santanaNorte, carapicuiba, '2026-10-13T11:00', CARRETA) as any));
    expect([...volta]).toEqual(expect.arrayContaining(['II.3', 'II.12', 'II.1', 'II.4']));
  });

  it('Santana de Parnaíba: rota que usa só parte da Estr. Tenente Marques às 17h (carreta) avisa', async () => {
    // pontas a 30% e 70% do eixo de ~4,2 km: antes, a cadeia de 4,9 km dava razão < 50% e nenhum aviso saía
    const o = { lat: -23.42550, lon: -46.89205 }, d = { lat: -23.43153, lon: -46.90325 };
    const r = await route({ origin: o, destination: d, vehicle: CARRETA, departure_at: '2026-10-13T17:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const q = await pool.query(`select ST_AsGeoJSON(ST_Collect(geom))::json g from data_features where layer_id = 'restricoes_rmsp' and props->>'regra_id' = 'santana_parnaiba_ten_marques'`);
    const tm = q.rows[0].g.coordinates as [number, number][][];
    const usado = tm.reduce((a, c) => a + usoDaLinha(r.body.geometry.coordinates, c, false).metros, 0);
    expect(usado, 'pré-condição: a rota usa a Estr. Tenente Marques').toBeGreaterThan(300);
    const avisos = r.body.warnings.filter((w: any) => (w.code === 'uses_restricted_way' || w.code === 'rmsp_via_restrita_na_rota') && /Tenente Marques/.test(w.message));
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos.every((w: any) => w.severity === 'danger')).toBe(true);
    // fora da janela (12h) não há aviso
    const meioDia = await route({ origin: o, destination: d, vehicle: CARRETA, departure_at: '2026-10-13T12:00' });
    expect(meioDia.body.warnings.some((w: any) => /Tenente Marques/.test(w.message) && w.severity === 'danger')).toBe(false);
  }, 180_000);

  it('via restrita usada fora do corredor enviado ao Valhalla ou só em parte: annotate avisa (danger)', async () => {
    // linha de sentido único (desenhada no sentido restrito): a rota sintética anda no mesmo sentido
    const q = await pool.query(`select ST_AsGeoJSON(geom, 6)::json g from data_features
      where layer_id = 'restricoes_rmsp' and props->>'regra_id' = 'barueri_ver' and props->>'sentido' = 'unico'
        and ST_Length(geom::geography) between 300 and 450 order by id limit 1`);
    expect(q.rows.length).toBe(1);
    const c = q.rows[0].g.coordinates as [number, number][];
    const line = turf.lineString(c);
    const geomOf = (coords: number[][]) => ({ line: turf.lineString(coords), distance_km: turf.length(turf.lineString(coords)), duration_s: 60 });
    // O–D em Guarulhos: a via de Barueri nem entra no request (corredor), mas a rota (sintética) passa nela às 18h
    const longe = await layer.annotate!(ctxOf({ lat: -23.40, lon: -46.30 }, { lat: -23.45, lon: -46.30 }, '2026-10-13T18:00', CARRETA) as any, geomOf(c) as any);
    expect(longe.warnings!.some((w) => w.code === 'rmsp_via_restrita_na_rota' && w.severity === 'danger')).toBe(true);
    // O–D na própria via, rota usando ~40% dela (> 100 m, < 50%): o routing.ts não vê; a camada avisa
    const len = turf.length(line, { units: 'meters' });
    const parte = turf.lineSliceAlong(line, 0, len * 0.4, { units: 'meters' }).geometry.coordinates;
    const p0 = { lon: c[0][0], lat: c[0][1] }, p1 = { lon: parte[parte.length - 1][0], lat: parte[parte.length - 1][1] };
    const parcial = await layer.annotate!(ctxOf(p0, p1, '2026-10-13T18:00', CARRETA) as any, geomOf(parte) as any);
    expect(parcial.warnings!.some((w) => w.code === 'rmsp_via_restrita_na_rota')).toBe(true);
    // rota percorrendo a linha inteira: o routing.ts avisa (uses_restricted_way); a camada não repete
    const inteira = await layer.annotate!(ctxOf(p0, { lon: c[c.length - 1][0], lat: c[c.length - 1][1] }, '2026-10-13T18:00', CARRETA) as any, geomOf(c) as any);
    expect(inteira.warnings!.some((w) => w.code === 'rmsp_via_restrita_na_rota')).toBe(false);
    // sábado: VER de Barueri não vale
    const sab = await layer.annotate!(ctxOf({ lat: -23.40, lon: -46.30 }, { lat: -23.45, lon: -46.30 }, '2026-10-17T18:00', CARRETA) as any, geomOf(c) as any);
    expect(sab.warnings!.some((w) => w.code === 'rmsp_via_restrita_na_rota')).toBe(false);
  });

  it('rota longa (Rio → SP): o corredor de vias enviadas ao Valhalla fica limitado a 15 km do segmento O–D', async () => {
    const rio = { lat: -22.9, lon: -43.2 }, sp = { lat: -23.52, lon: -46.58 };
    // 22h30: só as vias 24h de Santana (PBT > 15 t) estão ativas, a ~25 km do destino — fora do corredor
    const noite = await layer.costLines!(ctxOf(rio, sp, '2026-10-13T22:30', CARRETA) as any);
    expect(noite.length).toBe(0);
    // 18h: o trevo de Bonsucesso (Guarulhos), a ~7 km do segmento e na Dutra, entra; Santana e Cajamar não
    const pico = await layer.costLines!(ctxOf(rio, sp, '2026-10-13T18:00', CARRETA) as any);
    expect(pico.some((c) => c.item.type === 'ZRCC-TB')).toBe(true);
    expect(pico.some((c) => /Santana|Cajamar/.test(c.item.name ?? ''))).toBe(false);
  });

  it('Barueri: trechos com sentido do decreto (XV Aruanã, XVI Paiol Velho) só num sentido; demais VER nos dois', async () => {
    const O = { lat: -23.495, lon: -46.850 }, D = { lat: -23.497, lon: -46.828 };
    const lines = await layer.costLines!(ctxOf(O, D, '2026-10-13T18:00', CARRETA) as any);
    const barueri = lines.filter((c) => c.item.type === 'VER' && /Barueri/.test(c.item.name ?? ''));
    expect(barueri.length).toBeGreaterThan(0);
    const key = (c: [number, number][]) => c.map((p) => p.join(',')).join(';');
    const all = new Set(barueri.map((c) => key(c.coordinates)));
    // via de mão dupla sem sentido no decreto: a mesma linha vai nos dois sentidos
    const q = await pool.query(`select ST_AsGeoJSON(geom, 6)::json g from data_features where layer_id = 'restricoes_rmsp'
      and props->>'regra_id' = 'barueri_ver' and props->>'sentido' = 'ambos'`);
    const ambos = q.rows.map((r: any) => r.g.coordinates as [number, number][]).filter((c) => all.has(key(c)));
    expect(ambos.length).toBeGreaterThan(0);
    for (const c of ambos) expect(all.has(key([...c].reverse()))).toBe(true);
    // incisos com sentido: nenhuma linha no sentido oposto ao do decreto (de → até); o OSM tem as duas pistas
    // (Aruanã "sentido São Paulo": de Tucunaré para Piracema, rumo sudeste; Paiol Velho XVI "sentido Al. Mamoré": rumo sul/oeste)
    const sent = await pool.query(`select props->>'inciso' inc, ST_AsGeoJSON(geom, 6)::json g from data_features where layer_id = 'restricoes_rmsp'
      and props->>'regra_id' = 'barueri_ver' and props->>'inciso' in ('XV', 'XVI') and ST_Length(geom::geography) > 50`);
    expect(sent.rows.length).toBeGreaterThan(1);
    const decree: Record<string, [number, number]> = { XV: [-46.8346, -23.4926], XVI: [-46.8390, -23.4869] };   // ponta "de" de cada trecho
    for (const r of sent.rows) {
      const c = r.g.coordinates as [number, number][];
      const fromDe = turf.distance(decree[r.inc], c[0]) < turf.distance(decree[r.inc], c[c.length - 1]);
      expect(fromDe, `inciso ${r.inc} desenhado no sentido do decreto`).toBe(true);
      expect(all.has(key([...c].reverse()))).toBe(false);
    }
    // às 18h de sábado não há restrição em Barueri (seg–sex)
    const sab = await layer.costLines!(ctxOf(O, D, '2026-10-17T18:00', CARRETA) as any);
    expect(sab.some((c) => /Barueri/.test(c.item.name ?? ''))).toBe(false);
  });

  it('Barueri XV: rota pela pista do sentido livre da Av. Aruanã não é tratada como uso do trecho restrito', async () => {
    // pista noroeste (livre): ways 176698791 → 257084487 do OSM; a pista sudeste (sentido São Paulo) é a restrita
    const livre = await route({ origin: { lat: -23.495547, lon: -46.829594 }, destination: { lat: -23.492366, lon: -46.8348 }, vehicle: CARRETA, departure_at: '2026-10-13T18:00' });
    expect(livre.status, JSON.stringify(livre.body)).toBe(200);
    expect(livre.body.distance_km).toBeLessThan(1.5);
    const nossos = livre.body.warnings.filter((w: any) => w.layer === 'restricoes_rmsp' || w.code === 'uses_restricted_way');
    expect(nossos.some((w: any) => /Aruanã/.test(w.message ?? ''))).toBe(false);
    const hits = (livre.body.layers.restricoes_rmsp?.data as any)?.hits ?? [];
    expect(hits.some((h: any) => /Aruanã/.test(h.vias ?? ''))).toBe(false);
    // o mesmo traçado no sentido da linha restrita conta como uso
    const q = await pool.query(`select ST_AsGeoJSON(geom)::json g from data_features where layer_id = 'restricoes_rmsp' and props->>'regra_id' = 'barueri_ver' and props->>'inciso' = 'XV' order by ST_Length(geom) desc limit 1`);
    const c = q.rows[0].g.coordinates as [number, number][];
    expect(usoDaLinha(c, c, true).ratio).toBeGreaterThan(0.9);
    expect(usoDaLinha([...c].reverse(), c, true).ratio).toBe(0);
    expect(usoDaLinha([...c].reverse(), c, false).ratio).toBeGreaterThan(0.9);
  }, 120_000);

  it('Guarulhos: ZRCC-TB às 7h de terça penaliza ramos e braços do trevo (nunca a Dutra); VUC 2,20 x 7,20 fica livre', async () => {
    const o = { lat: -23.4350, lon: -46.4300 }, d = { lat: -23.4180, lon: -46.3900 };
    const carreta = await layer.costLines!(ctxOf(o, d, '2026-10-13T07:00', CARRETA) as any);
    const z = carreta.filter((c) => c.item.type === 'ZRCC-TB');
    expect(z.length).toBeGreaterThan(0);
    // só alças/ramos e as vias transversais do anexo: nenhuma feição é pista da Dutra (motorway/trunk) nem marginal
    const hw = await pool.query(`select props->>'via' via, props->>'highway' hw from data_features where layer_id = 'restricoes_rmsp' and source = 'guarulhos'`);
    for (const r of hw.rows) {
      expect(['motorway', 'trunk'], r.via).not.toContain(r.hw);
      expect(r.via ?? '').not.toMatch(/Dutra|Marginal/);
    }
    // nenhuma linha corre sobre a pista da Dutra (eixo aproximado do OSM): < 50% dos vértices a até 15 m dele
    const dutra = turf.lineString([[-46.4200, -23.4327], [-46.4128, -23.4295], [-46.4068, -23.4269], [-46.4016, -23.4247], [-46.3973, -23.4232]]);
    for (const c of z) {
      const perto = c.coordinates.filter((p) => turf.pointToLineDistance(turf.point(p), dutra, { units: 'meters' }) < 15).length;
      expect(perto / c.coordinates.length, c.item.name).toBeLessThan(0.5);
    }
    // braço sul do contorno (Estr. Pres. JK, ~1 km do trevo) além do raio de 450 m
    const centro = turf.point([-46.4068, -23.4268]);
    expect(z.some((c) => /Juscelino/.test(c.item.name ?? '') && c.coordinates.some((p) => turf.distance(centro, turf.point(p), { units: 'meters' }) > 800))).toBe(true);
    const vuc = await layer.costLines!(ctxOf(o, d, '2026-10-13T07:00', { preset: 'vuc', length_m: 7.2, width_m: 2.2 }) as any);
    expect(vuc.some((c) => c.item.type === 'ZRCC-TB')).toBe(false);
  });
});
