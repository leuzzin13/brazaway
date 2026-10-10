import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { pool, route, waitForStack } from '../helpers.js';
import layer, { describeJanelas, enquadrar, janelaAtiva, regraAplicavel, usoDaLinha, type Regra } from '../../src/layers/restricoes_rmsp.layer.js';
import { resolveVehicle } from '../../src/services/vehicle.js';

/**
 * Cidade do Rio de Janeiro (IBGE 3304557) na camada de restrições municipais: data/raw/municipios/3304557.json, importado
 * com `run.py municipios:3304557` (fonte rio-de-janeiro; seed db/seed/layers/restricoes_rmsp__rio-de-janeiro.sql).
 * Regras e recortes chamando o módulo da camada (mesmo banco); poucas rotas reais contra a API (API_URL).
 * 2026-10-13 é terça; 2026-10-17 sábado; 2026-01-10 sábado (verão 2025/26); 2030-04-16 terça (feriado de teste).
 */
const TZ = 'America/Sao_Paulo';
const LAYER = 'restricoes_rmsp';
const SOURCE = 'rio-de-janeiro';
const at = (s: string) => DateTime.fromISO(s, { zone: TZ }).toJSDate();
const veic = (v: Record<string, unknown>) => resolveVehicle(v as any);
const ctxOf = (o: { lat: number; lon: number }, d: { lat: number; lon: number }, when: string, vehicle: Record<string, unknown>) =>
  ({ vehicle: veic(vehicle), at: at(when), departureLocal: when, origin: o, destination: d, tz: TZ });
const routeOf = (coords: [number, number][], min = 10) => ({ line: turf.lineString(coords), distance_km: turf.length(turf.lineString(coords)), duration_s: min * 60 });

const regra = async (id: string): Promise<Regra> => {
  const q = await pool.query(`select props from data_features where layer_id = $1 and source = $2 and props->>'regra_id' = $3 limit 1`, [LAYER, SOURCE, id]);
  expect(q.rows.length, `regra ${id} não importada (rode run.py municipios:3304557 ou aplique o seed)`).toBe(1);
  return q.rows[0].props;
};
const linhasDe = async (id: string): Promise<[number, number][][]> =>
  (await pool.query(`select ST_AsGeoJSON(geom, 6)::json g from data_features where layer_id = $1 and source = $2 and props->>'regra_id' = $3`, [LAYER, SOURCE, id]))
    .rows.map((r: any) => r.g.coordinates);

// Linha Amarela: Freguesia (Jacarepaguá) → Bonsucesso; o caminho natural de caminhão usa a via
const FREGUESIA = { lat: -22.9400, lon: -43.3550 }, BONSUCESSO = { lat: -22.8680, lon: -43.2580 };
// Av. das Américas: Recreio → Barra (pista central entre a Alceu de Carvalho e a Ayrton Senna)
const RECREIO = { lat: -23.0175, lon: -43.4800 }, BARRA = { lat: -23.0003, lon: -43.3800 };
// Centro → Tijuca (dentro das áreas da regra geral suspensa)
const CENTRO = { lat: -22.9035, lon: -43.1790 }, TIJUCA = { lat: -22.9250, lon: -43.2330 };
const VIADUTO_ORLANDO_RASO: [number, number] = [-43.4373, -23.0069];

beforeAll(async () => {
  const q = await pool.query(`select count(*)::int n from data_features where layer_id = $1 and source = $2`, [LAYER, SOURCE]);
  expect(q.rows[0].n, 'Rio não está no banco: rode run.py municipios:3304557 ou aplique db/seed/layers/restricoes_rmsp__rio-de-janeiro.sql').toBeGreaterThan(300);
});
afterAll(async () => { await pool.end(); });

describe('Rio de Janeiro — regras importadas (banco, sem rota)', () => {
  it('kinds por status: vias ativas, Santa Cruz desativada, regra geral da Res. 3.055 suspensa; linhas validadas no Valhalla', async () => {
    const q = await pool.query(`select props->>'regra_id' r, kind, count(*)::int n,
        bool_and(coalesce((props->>'valhalla_validado')::boolean, false)) validadas, max(ST_Length(geom::geography))::float max_m
      from data_features where layer_id = $1 and source = $2 group by 1, 2`, [LAYER, SOURCE]);
    const k = Object.fromEntries(q.rows.map((x: any) => [x.r, x.kind]));
    expect(k).toMatchObject({
      rio_linha_vermelha: 'via', rio_linha_amarela: 'via', rio_corredor_reboucas: 'via', rio_centro_10798: 'via', rio_transoeste: 'via',
      rio_gonzaga_duque: 'via', rio_gavea_1451: 'via', rio_caminho_da_canoa: 'via', rio_afonso_de_taunay: 'via', rio_grumari_verao_2025: 'via',
      rio_santa_cruz_2242: 'desativada', rio_res3055_arp: 'suspensa', rio_res3055_arm_arv: 'suspensa',
    });
    for (const x of q.rows.filter((r: any) => r.kind === 'via')) {
      expect(x.validadas, x.r).toBe(true);
      expect(x.max_m, x.r).toBeLessThan(450);
    }
    for (const id of ['rio_res3055_arp', 'rio_res3055_arm_arv', 'rio_santa_cruz_2242']) expect(regraAplicavel(await regra(id))).toBe(false);
    const arp = await regra('rio_res3055_arp');
    expect(arp.status_motivo).toMatch(/Res\. SMTR 3\.254\/2020, art\. 1º/);
    expect(arp.base_legal.map((b) => b.ato).join(' | ')).toMatch(/3\.055.*45\.433.*3\.254.*47\.285/);
  });

  it('todo horário/limite cita ato e artigo', async () => {
    const q = await pool.query(`select distinct on (props->>'regra_id') props from data_features where layer_id = $1 and source = $2`, [LAYER, SOURCE]);
    expect(q.rows.length).toBe(13);
    for (const { props: r } of q.rows as { props: Regra }[]) {
      expect(r.base_legal.length, r.regra_id).toBeGreaterThan(0);
      for (const b of r.base_legal) {
        expect(b.artigo, r.regra_id).toMatch(/art/);
        expect(b.url, r.regra_id).toMatch(/^https:\/\//);
      }
      expect(r.uf).toBe('RJ');
    }
  });

  it('VUC carioca (2,50 x 7,20 x 3,50 m, só com AEVC) só na regra geral suspensa; nas vias o VUC é caminhão', async () => {
    const vuc = veic({ preset: 'vuc' });                                   // 2,5 x 7,2 x 3,2 m, 9 t
    const arp = await regra('rio_res3055_arp');
    expect(arp.vuc).toMatchObject({ largura_max_m: 2.5, comprimento_max_m: 7.2, altura_max_m: 3.5, exige_cadastro: true });
    expect(enquadrar(arp, vuc)).toMatchObject({ aplica: true, classe: 'VUC', vucSoComCadastro: true });
    expect(enquadrar(arp, veic({ preset: 'vuc', height_m: 3.6 }))).toMatchObject({ aplica: true, classe: 'caminhão' });   // altura acima de 3,50 m
    const lv = await regra('rio_linha_vermelha');
    expect(lv.vuc).toBeNull();
    expect(enquadrar(lv, vuc)).toMatchObject({ aplica: true, classe: 'caminhão' });
    expect(enquadrar(lv, veic({ preset: 'utilitario' })).aplica).toBe(false);        // PBT 3,5 t não é caminhão
    expect(describeJanelas(lv.janelas)).toBe('todos os dias o dia todo');
  });

  it('corredor Rebouças: PBT igual ou superior a 6,4 t ou reboque', async () => {
    const r = await regra('rio_corredor_reboucas');
    expect(enquadrar(r, veic({ preset: 'toco', weight_t: 6.4 })).aplica).toBe(true);
    expect(enquadrar(r, veic({ preset: 'toco', weight_t: 6.39 })).aplica).toBe(false);
    expect(enquadrar(r, veic({ preset: 'carreta' })).aplica).toBe(true);
    expect(enquadrar(r, veic({ preset: 'vuc', weight_t: 6 })).aplica).toBe(false);
  });

  it('Linha Amarela: dias úteis 6h–10h e 17h–20h', async () => {
    const r = await regra('rio_linha_amarela');
    expect(describeJanelas(r.janelas)).toBe('seg–sex 6h–10h e 17h–20h');
    expect(r.feriados).toBe('suspende');
    expect(janelaAtiva(r.janelas, at('2026-10-13T08:00'))).toBe(true);
    expect(janelaAtiva(r.janelas, at('2026-10-13T10:00'))).toBe(false);
    expect(janelaAtiva(r.janelas, at('2026-10-13T19:59'))).toBe(true);
    expect(janelaAtiva(r.janelas, at('2026-10-13T20:00'))).toBe(false);
    expect(janelaAtiva(r.janelas, at('2026-10-17T08:00'))).toBe(false);          // sábado
  });

  it('Av. Afonso de Taunay: só o trecho da Av. Alda Garrido à Av. Armando Lombardi', async () => {
    const ls = await linhasDe('rio_afonso_de_taunay');
    expect(ls.length).toBeGreaterThan(0);
    for (const c of ls) for (const [, lat] of c) expect(lat).toBeGreaterThan(-23.0095);
  });
});

describe('Rio de Janeiro — camada na rota (módulo)', () => {
  it('regra geral suspensa nunca vira exclusão; Linha Amarela vira costLine no horário e cai no feriado municipal', async () => {
    const ex = await layer.exclusions!(ctxOf(CENTRO, TIJUCA, '2026-10-13T08:00', { preset: 'carreta' }) as any);
    expect(ex.filter((e) => /Res\. 3\.055/.test(e.item.type ?? ''))).toEqual([]);
    const la = async (when: string) => (await layer.costLines!(ctxOf(FREGUESIA, BONSUCESSO, when, { preset: 'carreta' }) as any))
      .filter((c) => c.item.type === 'Linha Amarela');
    const pico = await la('2026-10-13T08:00');
    expect(pico.length).toBeGreaterThan(20);
    expect(pico[0].factor).toBe(1000);
    expect(pico[0].item.rule).toMatch(/seg–sex 6h–10h e 17h–20h, exceto feriados/);
    expect(await la('2026-10-13T12:00')).toEqual([]);
    // feriado municipal do Rio (código IBGE da regra) numa terça: "dias úteis" não vale
    const ins = await pool.query(`insert into holidays (day, scope, uf, ibge_code, name, source) values ('2030-04-16', 'municipal', 'RJ', '3304557', 'TESTE mun_rio', 'teste') returning id`);
    try {
      expect(await la('2030-04-16T08:00')).toEqual([]);
      expect((await la('2030-04-09T08:00')).length).toBeGreaterThan(0);     // terça anterior, dia útil
    } finally {
      await pool.query(`delete from holidays where id = $1`, [ins.rows[0].id]);
    }
  });

  it('Transoeste: pista central nos dois sentidos, fora o trecho do Viaduto Orlando Raso; utilitário livre', async () => {
    const cl = (await layer.costLines!(ctxOf(RECREIO, BARRA, '2026-10-18T03:00', { preset: 'truck' }) as any)).filter((c) => c.item.type === 'Transoeste');
    expect(cl.length).toBeGreaterThan(30);
    const v = turf.point(VIADUTO_ORLANDO_RASO);
    expect(cl.every((c) => c.coordinates.every((p) => turf.distance(v, turf.point(p), { units: 'meters' }) > 60))).toBe(true);
    // a pista central é mão única por sentido: as linhas vêm desenhadas nos dois rumos (leste e oeste)
    const rumos = new Set(cl.map((c) => (c.coordinates[c.coordinates.length - 1][0] > c.coordinates[0][0] ? 'leste' : 'oeste')));
    expect(rumos).toEqual(new Set(['leste', 'oeste']));
    expect((await layer.costLines!(ctxOf(RECREIO, BARRA, '2026-10-18T03:00', { preset: 'utilitario' }) as any)).some((c) => c.item.type === 'Transoeste')).toBe(false);
  });

  it('Grumari: só aos sábados e domingos do verão 2025/26 (vigência gravada no banco)', async () => {
    const o = { lat: -23.0450, lon: -43.5500 }, d = { lat: -23.0700, lon: -43.5680 };
    const g = async (when: string) => (await layer.costLines!(ctxOf(o, d, when, { preset: 'toco' }) as any)).some((c) => c.item.type === 'Operação Verão (Grumari)');
    expect(await g('2026-01-10T10:00')).toBe(true);     // sábado, dentro da vigência
    expect(await g('2026-01-13T10:00')).toBe(false);    // terça
    expect(await g('2026-01-10T23:00')).toBe(false);    // fora das 6h–22h
    expect(await g('2026-10-17T10:00')).toBe(false);    // sábado, portaria vencida
  });

  it('mapa: vias ativas e vigentes; sem a regra geral suspensa, a desativada de Santa Cruz nem a sazonal vencida', async () => {
    const fc = await layer.features!([-43.80, -23.09, -43.09, -22.74], { zoom: 14 });
    const rio = fc.features.filter((f) => f.properties?.municipio === 'Rio de Janeiro');
    const regimes = new Set(rio.map((f) => f.properties?.regime));
    for (const r of ['Linha Vermelha', 'Linha Amarela', 'Corredor Rebouças', 'Centro', 'Transoeste', 'Proibição de caminhões', 'Proibição de caminhões e ônibus']) {
      expect(regimes.has(r), r).toBe(true);
    }
    for (const r of ['ARP (Res. 3.055/2018)', 'ARM/ARV (Res. 3.055/2018)', 'Santa Cruz (Res. 2.242/2012)', 'Operação Verão (Grumari)']) expect(regimes.has(r), r).toBe(false);
    const reb = rio.find((f) => f.properties?.regime === 'Corredor Rebouças')!;
    expect(reb.properties?.description).toMatch(/todos os dias o dia todo\. Caminhões com PBT acima de 6,399 t ou carreta/);
  });

  it('annotate: rota pela área da regra geral suspensa e pela rua desativada de Santa Cruz só avisa (info)', async () => {
    // reta Centro → Tijuca (atravessa a ARP e a ARM/ARV)
    const a = await layer.annotate!(ctxOf(CENTRO, TIJUCA, '2026-10-13T08:00', { preset: 'carreta' }) as any,
      routeOf([[CENTRO.lon, CENTRO.lat], [TIJUCA.lon, TIJUCA.lat]]) as any);
    const nao = a.warnings!.filter((w) => w.code === 'municipal_regra_nao_aplicada');
    expect(nao.every((w) => w.severity === 'info')).toBe(true);
    expect((a.data as any).nao_aplicadas.map((x: any) => x.regra_id).sort()).toEqual(['rio_res3055_arm_arv', 'rio_res3055_arp']);
    expect(nao[0].message).toMatch(/suspensa que o app NÃO aplica: Suspensa por prazo indeterminado pela Res\. SMTR 3\.254\/2020/);
    // Rua Felipe Cardoso (Santa Cruz, Res. 2.242/2012 art. 4º, desativada por confiança baixa)
    const fc = (await linhasDe('rio_santa_cruz_2242')).sort((x, y) => turf.length(turf.lineString(y)) - turf.length(turf.lineString(x)))[0];
    const b = await layer.annotate!(ctxOf({ lon: fc[0][0], lat: fc[0][1] }, { lon: fc[fc.length - 1][0], lat: fc[fc.length - 1][1] }, '2026-10-13T08:00', { preset: 'truck' }) as any,
      routeOf(fc) as any);
    expect(b.warnings!.find((w) => w.code === 'municipal_regra_nao_aplicada')?.message).toMatch(/Santa Cruz.*desativada que o app NÃO aplica: Confiança baixa/);
  });
});

describe('Rio de Janeiro — rotas reais (API)', () => {
  beforeAll(async () => { await waitForStack(); }, 600_000);

  const usoM = async (geom: { coordinates: [number, number][] }, id: string) =>
    (await linhasDe(id)).reduce((s, c) => s + usoDaLinha(geom.coordinates, c, true).metros, 0);

  it('desvia: carreta às 12h de terça usa a Linha Amarela; às 8h (horário do ato) desvia dela', async () => {
    const meioDia = await route({ origin: FREGUESIA, destination: BONSUCESSO, vehicle: { preset: 'carreta' }, departure_at: '2026-10-13T12:00' });
    expect(meioDia.status, JSON.stringify(meioDia.body)).toBe(200);
    expect(await usoM(meioDia.body.geometry, 'rio_linha_amarela'), 'pré-condição: fora do horário a rota usa a Linha Amarela').toBeGreaterThan(2000);
    expect(meioDia.body.avoided.some((x: any) => x.layer === LAYER && x.type === 'Linha Amarela')).toBe(false);
    const pico = await route({ origin: FREGUESIA, destination: BONSUCESSO, vehicle: { preset: 'carreta' }, departure_at: '2026-10-13T08:00' });
    expect(pico.status, JSON.stringify(pico.body)).toBe(200);
    expect(await usoM(pico.body.geometry, 'rio_linha_amarela')).toBeLessThan(300);
    expect(pico.body.avoided.some((x: any) => x.layer === LAYER && x.type === 'Linha Amarela')).toBe(true);
  }, 240_000);

  it('passa pela região: caminhão Centro → Tijuca às 8h de terça atravessa a área da regra geral (suspensa), sem exclusão e com aviso', async () => {
    const r = await route({ origin: CENTRO, destination: TIJUCA, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.avoided.some((x: any) => x.layer === LAYER && /Res\. 3\.055/.test(x.type ?? ''))).toBe(false);
    const w = r.body.warnings.filter((x: any) => x.layer === LAYER && x.code === 'municipal_regra_nao_aplicada');
    expect(w.some((x: any) => /ARM\/ARV/.test(x.message) && /suspensa/.test(x.message))).toBe(true);
    expect(r.body.distance_km).toBeLessThan(12);
  }, 240_000);

  it('Av. das Américas: o caminhão vai pelas pistas laterais; o utilitário pode usar a pista central', async () => {
    const truck = await route({ origin: RECREIO, destination: BARRA, vehicle: { preset: 'truck' }, departure_at: '2026-10-13T11:00' });
    expect(truck.status, JSON.stringify(truck.body)).toBe(200);
    const util = await route({ origin: RECREIO, destination: BARRA, vehicle: { preset: 'utilitario' }, departure_at: '2026-10-13T11:00' });
    expect(util.status).toBe(200);
    const central = await usoM(util.body.geometry, 'rio_transoeste');
    expect(central, 'pré-condição: sem restrição, a rota usa a pista central').toBeGreaterThan(5000);
    expect(await usoM(truck.body.geometry, 'rio_transoeste')).toBeLessThan(central * 0.1);
    expect(truck.body.avoided.some((x: any) => x.layer === LAYER && x.type === 'Transoeste')).toBe(true);
  }, 240_000);
});
