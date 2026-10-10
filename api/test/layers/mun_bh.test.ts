import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { get, pool, route, waitForStack } from '../helpers.js';
import layer, { describeJanelas, enquadrar, janelaAtiva, type Regra } from '../../src/layers/restricoes_rmsp.layer.js';
import { legalDayInfo } from '../../src/services/calendar.js';
import { resolveVehicle } from '../../src/services/vehicle.js';

/**
 * Belo Horizonte (IBGE 3106200) na camada genérica restricoes_rmsp: data/raw/municipios/3106200.json, importado com
 * `municipios:3106200` (fonte belo-horizonte; seed db/seed/layers/restricoes_rmsp__belo-horizonte.sql).
 * Portarias BHTRANS DPR 138/2009, 077/2014 e 004/2019: capacidade de carga (payload_t) acima de 5,5 t OU comprimento
 * acima de 6,50 m; carretas e cavalos mecânicos 24 h na Área Central e na Av. N. Sra. do Carmo.
 * 2026-10-14 é quarta; 2026-10-17 sábado; 2026-10-18 domingo. Rotas contra a API (API_URL); regras chamando o módulo.
 */
const TZ = 'America/Sao_Paulo';
const LAYER = 'restricoes_rmsp';
const at = (s: string) => DateTime.fromISO(s, { zone: TZ }).toJSDate();
const veic = (v: Record<string, unknown>) => resolveVehicle(v as any);
const ctxOf = (o: { lat: number; lon: number }, d: { lat: number; lon: number }, when: string, vehicle: Record<string, unknown>) =>
  ({ vehicle: veic(vehicle), at: at(when), departureLocal: when, origin: o, destination: d, tz: TZ });
const routeOf = (coords: number[][], min = 10) => ({ line: turf.lineString(coords), distance_km: turf.length(turf.lineString(coords)), duration_s: min * 60 });

// Lagoinha/Bonfim (norte, fora da Contorno) → Serra/Cruzeiro (sul, fora da Contorno): o caminho natural corta o centro
const NORTE = { lat: -19.9050, lon: -43.9420 };
const SUL = { lat: -19.9450, lon: -43.9300 };
const PRACA_SETE = { lat: -19.91922, lon: -43.93806 };        // dentro da Área Central
const TOCO = { preset: 'toco' };                               // 9 m: o comprimento decide (> 6,50 m)
const PEQUENO = { preset: 'vuc', length_m: 6.3, width_m: 2.2 }; // 6,3 m, PBT 9 t: decide a capacidade de carga
const CARRETA = { preset: 'carreta' };

const regra = async (id: string): Promise<Regra> => {
  const q = await pool.query(`select props from data_features where layer_id = $1 and source = 'belo-horizonte' and props->>'regra_id' = $2 limit 1`, [LAYER, id]);
  expect(q.rows.length, `regra ${id} não importada (rode municipios:3106200 ou aplique o seed restricoes_rmsp__belo-horizonte.sql)`).toBe(1);
  return q.rows[0].props;
};
const temZona = (ex: { item: { type?: string; note?: string | null } }[]) => ex.some((e) => e.item.type === 'Área Central' && e.item.note === 'Belo Horizonte');
const tipos = (cl: { item: { type?: string } }[]) => new Set(cl.map((c) => c.item.type));

let zona: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
/** a rota entra na Área Central? polígono recuado 30 m (a API recua 20 m: vias-limite livres) */
const cruzaZona = (coords: number[][]) => {
  const inset = turf.buffer(zona as any, -0.03, { units: 'kilometers' }) ?? zona;
  return turf.booleanIntersects(turf.lineString(coords), inset as any);
};

beforeAll(async () => {
  const f = await get(`/api/layers/restricoes_rmsp/features?bbox=-43.97,-19.95,-43.91,-19.90&zoom=14`);
  expect(f.status).toBe(200);
  zona = f.body.features.find((x: any) => x.properties.kind === 'zona' && x.properties.municipio === 'Belo Horizonte');
  expect(zona, 'Área Central de BH não está no banco').toBeTruthy();
  for (const p of [NORTE, SUL]) expect(turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), zona as any)).toBe(false);
  expect(turf.booleanPointInPolygon(turf.point([PRACA_SETE.lon, PRACA_SETE.lat]), zona as any)).toBe(true);
}, 120_000);

afterAll(async () => { await pool.end(); });

describe('Belo Horizonte — regras importadas', () => {
  it('kinds, status, confiança e ato/artigo de cada regra', async () => {
    const q = await pool.query(`select props->>'regra_id' as id, kind, count(*)::int n from data_features
      where layer_id = $1 and source = 'belo-horizonte' group by 1, 2 order by 1`, [LAYER]);
    const kinds = Object.fromEntries(q.rows.map((r) => [r.id, r.kind]));
    expect(kinds).toEqual({
      bh_area_central: 'zona', bh_area_central_vias_limite: 'via', bh_corredores: 'via', bh_contorno_toboga: 'via', bh_nsra_carmo: 'via',
      bh_lei_7794_1999: 'desativada', bh_lei_7648_1999: 'revogada',
    });
    for (const id of Object.keys(kinds)) {
      const r = await regra(id);
      expect([r.uf, r.ibge], id).toEqual(['MG', '3106200']);
      for (const b of r.base_legal) expect(b.artigo?.length, `${id}: ${b.ato}`).toBeGreaterThan(3);
    }
    expect((await regra('bh_lei_7794_1999')).confianca).toBe('baixa');
    const area = await regra('bh_area_central');
    expect(area.base_legal.map((b) => b.ato)).toEqual(expect.arrayContaining(['Portaria BHTRANS DPR 138/2009', 'Portaria BHTRANS DPR 077/2014', 'Portaria BHTRANS DPR 004/2019']));
    expect(describeJanelas(area.janelas)).toBe('seg–sex 7h–20h; sáb 7h–15h');
    expect(describeJanelas((await regra('bh_area_central_vias_limite')).janelas)).toBe('seg–sex 7h–20h; sáb 7h–15h');
    expect(describeJanelas((await regra('bh_corredores')).janelas)).toBe('seg–sex 7h–9h e 17h–20h; sáb 7h–9h');
    expect(describeJanelas((await regra('bh_contorno_toboga')).janelas)).toBe('todos os dias o dia todo');
    expect(describeJanelas((await regra('bh_nsra_carmo')).janelas)).toBe('seg–sex 7h–20h; sáb 7h–15h');
  });

  it('16 trechos de corredores (art. 6º, com o parágrafo único do art. 1º da Portaria 077/2014), validados no Valhalla', async () => {
    const q = await pool.query(`select distinct props->>'inciso' inc from data_features
      where layer_id = $1 and source = 'belo-horizonte' and props->>'regra_id' = 'bh_corredores'`, [LAYER]);
    const incs = q.rows.map((r) => r.inc).sort();
    expect(incs).toEqual(['6º-1', '6º-10', '6º-11', '6º-12', '6º-13', '6º-14', '6º-15a', '6º-15b', '6º-2', '6º-3', '6º-4', '6º-5', '6º-6', '6º-7', '6º-8', '6º-9']);
    const v = await pool.query(`select max(ST_Length(geom::geography))::float max_m,
        sum(case when (props->>'valhalla_validado')::boolean then 0 else 1 end)::int sem_teste
      from data_features where layer_id = $1 and source = 'belo-horizonte' and kind = 'via'`, [LAYER]);
    expect(v.rows[0].max_m).toBeLessThan(450);
    expect(v.rows[0].sem_teste).toBe(0);
  });

  it('6º-7 (Av. Pedro II): da Av. Carlos Luz até a Lagoinha, nas duas pistas, cada uma no seu sentido', async () => {
    const q = await pool.query(`select ST_AsGeoJSON(geom)::json g, ST_Length(geom::geography)::float m,
        ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(-43.948, -19.9128), 4326)::geography)::float d
      from data_features where layer_id = $1 and source = 'belo-horizonte' and props->>'inciso' = '6º-7'`, [LAYER]);
    // ponto da Pedro II entre a Lagoinha e o Carlos Prates (antes ficava fora: a N. Sra. de Fátima era encaixada no Carlos Prates)
    expect(Math.min(...q.rows.map((r) => r.d))).toBeLessThan(10);
    const km = q.rows.reduce((a, r) => a + r.m, 0) / 1000;
    expect(km).toBeGreaterThan(4.2);
    expect(km).toBeLessThan(4.8);
    const xs = q.rows.flatMap((r) => (r.g.coordinates as number[][]).map((c) => c[0]));
    expect(Math.max(...xs)).toBeGreaterThan(-43.9450);   // ponta leste: início da Pedro II na Lagoinha
    expect(Math.min(...xs)).toBeLessThan(-43.9620);      // ponta oeste: Av. Carlos Luz
    // perto da Lagoinha: uma pista rumo oeste (sentido Carlos Luz) e outra rumo leste (sentido Lagoinha)
    const rumos = new Set(q.rows.filter((r) => Math.max(...(r.g.coordinates as number[][]).map((c) => c[0])) > -43.947)
      .map((r) => { const c = r.g.coordinates as number[][]; return c[c.length - 1][0] - c[0][0] < 0 ? 'oeste' : 'leste'; }));
    expect(rumos).toEqual(new Set(['oeste', 'leste']));
  });

  it('Lei 7.648/1999 registrada como revogada (Lei 12.016/2026) e fora do mapa; Lei 7.794/1999 desativada', async () => {
    const q = await pool.query(`select kind, props->>'status' st, valid_to::date::text vt, valid_to < now() expirada from data_features
      where layer_id = $1 and source_id = 'bh-lei-7648-1999-revogada'`, [LAYER]);
    expect(q.rows[0]).toEqual({ kind: 'revogada', st: 'revogada', vt: '2026-08-20', expirada: true });
    const f = await get('/api/layers/restricoes_rmsp/features?bbox=-43.97,-19.95,-43.91,-19.90&zoom=14');
    const bh = f.body.features.filter((x: any) => x.properties.municipio === 'Belo Horizonte');
    expect(new Set(bh.map((x: any) => x.properties.kind))).toEqual(new Set(['zona', 'via']));
    expect(bh.some((x: any) => /7\.648|7\.794/.test(x.properties.regime ?? ''))).toBe(false);
  });
});

describe('Belo Horizonte — enquadramento (capacidade de carga x comprimento)', () => {
  it('capacidade de carga acima de 5,5 t OU comprimento acima de 6,50 m (não é PBT)', async () => {
    const area = await regra('bh_area_central');
    expect(enquadrar(area, veic({ ...PEQUENO, payload_t: 5.5 })).aplica).toBe(false);           // até 5,5 t e 6,3 m: livre
    expect(enquadrar(area, veic({ ...PEQUENO, payload_t: 5.6 })).aplica).toBe(true);
    expect(enquadrar(area, veic({ ...PEQUENO, length_m: 6.6, payload_t: 3 })).aplica).toBe(true);
    // PBT alto não decide: 6,3 m com 5 t de capacidade informada e PBT 12 t continua livre
    expect(enquadrar(area, veic({ ...PEQUENO, weight_t: 12, payload_t: 5 })).aplica).toBe(false);
    // sem a capacidade informada: lado seguro (aplica) e marca a suposição para o aviso
    expect(enquadrar(area, veic(PEQUENO))).toMatchObject({ aplica: true, classe: 'caminhão', capacidadeSuposta: { estimativa_t: 5 } });
    // comprimento decide sozinho: sem suposição
    const toco = enquadrar(area, veic(TOCO));
    expect(toco).toMatchObject({ aplica: true, classe: 'caminhão' });
    expect(toco.capacidadeSuposta).toBeUndefined();
    expect(enquadrar(area, veic({ preset: 'utilitario' })).aplica).toBe(false);                // PBT 3,5 t: não é caminhão
  });

  it('carretas e cavalos mecânicos: 24 h na Área Central e na N. Sra. do Carmo; nos corredores, as mesmas janelas', async () => {
    const [area, carmo, corr] = await Promise.all([regra('bh_area_central'), regra('bh_nsra_carmo'), regra('bh_corredores')]);
    for (const p of ['carreta', 'carreta_6e', 'romeu_julieta', 'bitrem']) {
      for (const r of [area, carmo]) {
        const e = enquadrar(r, veic({ preset: p }));
        expect(e.classe, `${p} ${r.regra_id}`).toBe('carreta');
        expect(janelaAtiva(e.janelas, at('2026-10-18T03:00'))).toBe(true);                    // domingo de madrugada
      }
      const c = enquadrar(corr, veic({ preset: p }));
      expect(c.aplica).toBe(true);
      expect(describeJanelas(c.janelas)).toBe('seg–sex 7h–9h e 17h–20h; sáb 7h–9h');
    }
  });
});

describe('Belo Horizonte — exclusões, linhas de custo e avisos (módulo da camada)', () => {
  it('Área Central: toco às 10h de quarta e às 14h de sábado; não às 21h, nem às 15h de sábado, nem no domingo', async () => {
    expect(temZona(await layer.exclusions!(ctxOf(NORTE, SUL, '2026-10-14T10:00', TOCO) as any))).toBe(true);
    expect(temZona(await layer.exclusions!(ctxOf(NORTE, SUL, '2026-10-17T14:59', TOCO) as any))).toBe(true);
    expect(temZona(await layer.exclusions!(ctxOf(NORTE, SUL, '2026-10-14T21:00', TOCO) as any))).toBe(false);
    expect(temZona(await layer.exclusions!(ctxOf(NORTE, SUL, '2026-10-17T15:00', TOCO) as any))).toBe(false);
    expect(temZona(await layer.exclusions!(ctxOf(NORTE, SUL, '2026-10-18T10:00', TOCO) as any))).toBe(false);
    // carreta: 24 h, todos os dias
    expect(temZona(await layer.exclusions!(ctxOf(NORTE, SUL, '2026-10-18T03:00', CARRETA) as any))).toBe(true);
    // 6,3 m com 4 t informadas: livre
    expect(temZona(await layer.exclusions!(ctxOf(NORTE, SUL, '2026-10-14T10:00', { ...PEQUENO, payload_t: 4 }) as any))).toBe(false);
  });

  it('feriado: o ato não excetua feriados, a Área Central vale também no feriado', async () => {
    const dia = '2030-04-16';   // terça
    const ins = await pool.query(
      `insert into holidays (day, scope, uf, name, source) values ($1, 'state', 'MG', 'TESTE mun_bh', 'teste') returning id`, [dia]);
    try {
      expect((await legalDayInfo(at(`${dia}T10:00`), '3106200', 'MG')).holiday).toBeTruthy();
      expect(temZona(await layer.exclusions!(ctxOf(NORTE, SUL, `${dia}T10:00`, TOCO) as any))).toBe(true);
    } finally {
      await pool.query(`delete from holidays where id = $1`, [ins.rows[0].id]);
    }
  });

  it('origem dentro da Área Central: não exclui a zona e avisa', async () => {
    expect(temZona(await layer.exclusions!(ctxOf(PRACA_SETE, SUL, '2026-10-14T10:00', TOCO) as any))).toBe(false);
    const reta = routeOf([[PRACA_SETE.lon, PRACA_SETE.lat], [SUL.lon, SUL.lat]]);
    const a = await layer.annotate!(ctxOf(PRACA_SETE, SUL, '2026-10-14T10:00', TOCO) as any, reta as any);
    const w = a.warnings!.find((x) => x.code === 'rmsp_origem_na_zona');
    expect(w?.message).toMatch(/Área Central de BH.*não foi excluída/);
  });

  it('costLines: corredores só no pico; tobogã 24 h e só no sentido do ato; N. Sra. do Carmo 7h–20h (carreta 24 h)', async () => {
    const pico = tipos(await layer.costLines!(ctxOf(NORTE, SUL, '2026-10-14T08:00', TOCO) as any));
    expect(pico.has('Corredor de tráfego')).toBe(true);
    expect(pico.has('Tobogã da Av. do Contorno')).toBe(true);
    expect(pico.has('Av. Nossa Senhora do Carmo')).toBe(true);
    const meio = tipos(await layer.costLines!(ctxOf(NORTE, SUL, '2026-10-14T11:00', TOCO) as any));
    expect(meio.has('Corredor de tráfego')).toBe(false);
    expect(meio.has('Tobogã da Av. do Contorno')).toBe(true);
    expect(meio.has('Av. Nossa Senhora do Carmo')).toBe(true);
    expect([...meio].some((t) => /7\.794/.test(t ?? ''))).toBe(false);                       // desativada nunca
    const noite = tipos(await layer.costLines!(ctxOf(NORTE, SUL, '2026-10-14T22:00', TOCO) as any));
    expect(noite.has('Av. Nossa Senhora do Carmo')).toBe(false);
    expect(noite.has('Tobogã da Av. do Contorno')).toBe(true);
    const carretaNoite = await layer.costLines!(ctxOf(NORTE, SUL, '2026-10-14T22:00', CARRETA) as any);
    expect(tipos(carretaNoite).has('Av. Nossa Senhora do Carmo')).toBe(true);
    expect(tipos(carretaNoite).has('Corredor de tráfego')).toBe(false);
    // tobogã: só no sentido do ato (nenhuma linha vai também invertida); a) R. dos Inconfidentes → R. Ceará (rumo oeste),
    // b) R. Andaluzita → Av. Afonso Pena (rumo leste)
    const tob = carretaNoite.filter((c) => c.item.type === 'Tobogã da Av. do Contorno');
    expect(new Set(tob.map((c) => c.item.id.split(':')[1]))).toEqual(new Set(['1º-a', '1º-b']));
    const key = (c: [number, number][]) => c.map((p) => p.join(',')).join(';');
    const enviados = new Set(tob.map((c) => key(c.coordinates)));
    for (const c of tob) {
      expect(enviados.has(key([...c.coordinates].reverse()))).toBe(false);
      const dx = c.coordinates[c.coordinates.length - 1][0] - c.coordinates[0][0];
      expect(c.item.id.includes(':1º-a:') ? dx < 0 : dx > 0, c.item.id).toBe(true);
    }
  });

  it('Av. Afonso Pena entre a R. dos Inconfidentes e a Contorno (Portaria 138/2009, art. 2º): fora do polígono recuado, entra como via da Área Central', async () => {
    const r = await regra('bh_area_central_vias_limite');
    expect(r.zona_vinculada).toBe('bh_area_central');
    expect(r.base_legal[0].artigo).toMatch(/art\. 2º.*art\. 8º/);
    const PONTO = [-43.92657, -19.93834];                                          // Afonso Pena, entre a Inconfidentes e a Contorno
    const inset = turf.buffer(zona as any, -0.02, { units: 'kilometers' }) ?? zona;
    expect(turf.booleanPointInPolygon(turf.point(PONTO), inset as any), 'pré-condição: fora do polígono recuado 20 m').toBe(false);
    const perim = async (o: typeof NORTE, when: string, v: Record<string, unknown>) =>
      (await layer.costLines!(ctxOf(o, SUL, when, v) as any)).filter((c) => c.item.type === 'Área Central (via do perímetro)');
    const dez = await perim(NORTE, '2026-10-14T10:00', TOCO);
    expect(dez.length).toBeGreaterThan(0);
    const dist = Math.min(...dez.map((c) => turf.pointToLineDistance(turf.point(PONTO), turf.lineString(c.coordinates), { units: 'meters' })));
    expect(dist).toBeLessThan(10);
    // pista dupla de mão única: cada linha só no sentido do desenho (nenhuma vai também invertida)
    const key = (c: [number, number][]) => c.map((p) => p.join(',')).join(';');
    const enviados = new Set(dez.map((c) => key(c.coordinates)));
    for (const c of dez) expect(enviados.has(key([...c.coordinates].reverse()))).toBe(false);
    expect((await perim(NORTE, '2026-10-17T14:00', TOCO)).length).toBeGreaterThan(0);              // sábado 14h
    expect(await perim(NORTE, '2026-10-14T21:00', TOCO)).toEqual([]);
    expect(await perim(NORTE, '2026-10-18T10:00', TOCO)).toEqual([]);                             // domingo
    expect((await perim(NORTE, '2026-10-18T03:00', CARRETA)).length).toBeGreaterThan(0);          // carreta 24 h
    expect(await perim(NORTE, '2026-10-14T10:00', { ...PEQUENO, payload_t: 4 })).toEqual([]);      // 6,3 m e 4 t: livre
    // origem na Área Central: segue a política da zona (não restringe; o annotate avisa)
    expect(await perim(PRACA_SETE, '2026-10-14T10:00', TOCO)).toEqual([]);
  });

  it('Contorno nos corredores (Portaria 077/2014, art. 1º, parágrafo único): 6º-15a no sentido horário e 6º-15b no anti-horário', async () => {
    // trecho sul da avenida: horário = rumo oeste; anti-horário = rumo leste
    const q = await pool.query(`select props->>'inciso' inc, ST_AsGeoJSON(geom)::json g from data_features
      where layer_id = $1 and source = 'belo-horizonte' and props->>'inciso' in ('6º-15a', '6º-15b')
        and ST_YMax(geom) < -19.936 and ST_Length(geom::geography) > 50`, [LAYER]);
    expect(q.rows.length).toBeGreaterThan(4);
    for (const r of q.rows) {
      const c = r.g.coordinates as [number, number][];
      const dx = c[c.length - 1][0] - c[0][0];
      expect(r.inc === '6º-15a' ? dx < 0 : dx > 0, r.inc).toBe(true);
    }
  });

  it('Lei 7.794/1999 (desativada, confiança baixa): avisa na Av. N. Sra. do Carmo para capacidade acima de 2 t, sem aplicar', async () => {
    const q = await pool.query(`select ST_AsGeoJSON(geom)::json g from data_features where layer_id = $1 and source = 'belo-horizonte'
      and props->>'regra_id' = 'bh_lei_7794_1999' order by ST_Length(geom) desc limit 1`, [LAYER]);
    const c = q.rows[0].g.coordinates as number[][];
    const o = { lon: c[0][0], lat: c[0][1] }, d = { lon: c[c.length - 1][0], lat: c[c.length - 1][1] };
    // 6,3 m e 3 t: a Portaria 138/2009 (5,5 t) não alcança o veículo; a lei (acima de 2 t) alcançaria
    const a = await layer.annotate!(ctxOf(o, d, '2026-10-14T10:00', { ...PEQUENO, payload_t: 3 }) as any, routeOf(c) as any);
    const w = a.warnings!.find((x) => x.code === 'municipal_regra_nao_aplicada');
    expect(w?.message).toMatch(/Lei 7\.794\/1999.*desativada.*Confiança baixa/);
    expect((a.data as any).nao_aplicadas.map((x: any) => x.regra_id)).toEqual(['bh_lei_7794_1999']);
    const b = await layer.annotate!(ctxOf(o, d, '2026-10-14T10:00', { ...PEQUENO, payload_t: 1.5 }) as any, routeOf(c) as any);
    expect((b.warnings ?? []).some((x) => x.code === 'municipal_regra_nao_aplicada')).toBe(false);
    const cl = await layer.costLines!(ctxOf(o, d, '2026-10-14T10:00', { ...PEQUENO, payload_t: 3 }) as any);
    expect(cl.some((x) => /7\.794/.test(x.item.type ?? ''))).toBe(false);
  });
});

describe('Belo Horizonte — rotas reais (API)', () => {
  beforeAll(async () => { await waitForStack(); }, 600_000);

  it('quarta 10h: toco (9 m) desvia da Área Central', async () => {
    const r = await route({ origin: NORTE, destination: SUL, vehicle: TOCO, departure_at: '2026-10-14T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(cruzaZona(r.body.geometry.coordinates), 'a rota do toco não deveria entrar na Área Central').toBe(false);
    expect(r.body.avoided.some((a: any) => a.layer === LAYER && a.type === 'Área Central')).toBe(true);
    expect(r.body.layers.restricoes_rmsp.summary.some((s: string) => /Área Central de BH.*ativa na saída: a rota contorna a zona/.test(s))).toBe(true);
  }, 180_000);

  it('passa pela região: caminhão de 6,3 m com 4 t de capacidade informada às 10h e toco no domingo cruzam o centro', async () => {
    const leve = await route({ origin: NORTE, destination: SUL, vehicle: { ...PEQUENO, payload_t: 4 }, departure_at: '2026-10-14T10:00' });
    expect(leve.status, JSON.stringify(leve.body)).toBe(200);
    expect(cruzaZona(leve.body.geometry.coordinates), 'pré-condição: o caminho natural corta a Área Central').toBe(true);
    expect(leve.body.avoided.some((a: any) => a.layer === LAYER && a.type === 'Área Central')).toBe(false);
    expect(leve.body.layers.restricoes_rmsp.summary.some((s: string) => /Área Central de BH.*não se aplica a este veículo/.test(s))).toBe(true);
    const dom = await route({ origin: NORTE, destination: SUL, vehicle: TOCO, departure_at: '2026-10-18T10:00' });
    expect(dom.status, JSON.stringify(dom.body)).toBe(200);
    expect(cruzaZona(dom.body.geometry.coordinates)).toBe(true);
  }, 180_000);

  it('sem a capacidade informada: lado seguro (desvia) e pede a capacidade do CRLV', async () => {
    const r = await route({ origin: NORTE, destination: SUL, vehicle: PEQUENO, departure_at: '2026-10-14T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(cruzaZona(r.body.geometry.coordinates)).toBe(false);
    const w = r.body.warnings.find((x: any) => x.code === 'municipal_capacidade_nao_informada' && /Área Central de BH/.test(x.message));
    expect(w?.message).toMatch(/Informe a capacidade de carga do CRLV/);
  }, 180_000);
});
