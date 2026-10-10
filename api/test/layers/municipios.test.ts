import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { pool } from '../helpers.js';
import layer, {
  describeJanelas, enquadrar, fitsVuc, municipiosOD, regraAplicavel, ufDe, type Regra,
} from '../../src/layers/restricoes_rmsp.layer.js';
import { resolveVehicle } from '../../src/services/vehicle.js';

/**
 * Formato genérico por município (camada restricoes_rmsp) com o município FICTÍCIO de fixture (IBGE 3599999), compilado
 * pelo importador (importers/tests/test_municipios.py gera api/test/fixtures/municipio_ficticio.json). A geometria fica
 * no oceano (~150 km da costa de SP): nenhuma rota real passa por ela. Os testes de banco gravam as feições com a fonte
 * da fixture e apagam no fim. 2026-10-13 é terça.
 */
const FIX = JSON.parse(readFileSync(new URL('../fixtures/municipio_ficticio.json', import.meta.url), 'utf8'));
const SOURCE: string = FIX.fonte_id;
const LAYER = 'restricoes_rmsp';
const TZ = 'America/Sao_Paulo';
const at = (s: string) => DateTime.fromISO(s, { zone: TZ }).toJSDate();
const regra = (id: string): Regra => FIX.features.find((f: any) => f.props.regra_id === id).props;
const veic = (v: Record<string, unknown>) => resolveVehicle(v as any);
const ctxOf = (o: { lat: number; lon: number }, d: { lat: number; lon: number }, when: string, vehicle: Record<string, unknown>) =>
  ({ vehicle: veic(vehicle), at: at(when), departureLocal: when, origin: o, destination: d, tz: TZ });
const routeOf = (coords: [number, number][], min = 10) => ({ line: turf.lineString(coords), distance_km: turf.length(turf.lineString(coords)), duration_s: min * 60 });

// caminhão pequeno (2,2 x 6,0 m, 9 t) sem a capacidade informada: o perfil VUC tem capacidade típica de 5 t
const PEQUENO = { preset: 'vuc', length_m: 6.0, width_m: 2.2 };

describe('regras do formato (sem banco)', () => {
  it('fixture compilada pelo importador: kinds por status, ponte como via, props com UF, confiança e artigo', () => {
    const kinds = Object.fromEntries(FIX.features.map((f: any) => [f.props.regra_id, f.kind]));
    expect(kinds).toEqual({
      ficticio_area_central: 'zona', ficticio_corredor: 'via', ficticio_ponte: 'via',
      ficticio_lei_antiga: 'desativada', ficticio_suspensa: 'suspensa', ficticio_revogada: 'revogada',
    });
    const z = regra('ficticio_area_central');
    expect([z.uf, z.ibge, z.confianca, z.base_legal[0].artigo]).toEqual(['SP', '3599999', 'alta', 'art. 1º (área e horários), art. 2º (VUC) e art. 9º (autorização)']);
    expect(describeJanelas(z.janelas)).toBe('seg–sex 7h–20h; sáb 7h–15h');
    expect(regraAplicavel(z)).toBe(true);
    expect(regraAplicavel({ status: 'vigente' })).toBe(true);                // cargas antigas
    for (const s of ['desativada', 'suspensa', 'revogada']) expect(regraAplicavel({ status: s })).toBe(false);
  });

  it('capacidade de carga: sem o dado vale o lado seguro (e marca a suposição); informada decide', () => {
    const z = regra('ficticio_area_central');   // capacidade acima de 5,5 t OU comprimento acima de 6,5 m
    const semDado = enquadrar(z, veic(PEQUENO));
    expect(semDado).toMatchObject({ aplica: true, classe: 'caminhão', capacidadeSuposta: { estimativa_t: 5, com_estimativa: { aplica: false } } });
    expect(enquadrar(z, veic({ ...PEQUENO, payload_t: 5 }))).toMatchObject({ aplica: false });
    expect(enquadrar(z, veic({ ...PEQUENO, payload_t: 5 })).capacidadeSuposta).toBeUndefined();
    expect(enquadrar(z, veic({ ...PEQUENO, payload_t: 6 }))).toMatchObject({ aplica: true, classe: 'caminhão' });
    // comprimento acima de 6,5 m decide sozinho: sem suposição
    const toco = enquadrar(z, veic({ preset: 'toco' }));
    expect(toco.aplica).toBe(true);
    expect(toco.capacidadeSuposta).toBeUndefined();
    // utilitário (PBT 3,5 t) não é caminhão: nunca entra
    expect(enquadrar(z, veic({ preset: 'utilitario' })).aplica).toBe(false);
  });

  it('variante por tipo de veículo: carreta e caminhão + reboque 24 h na zona', () => {
    const z = regra('ficticio_area_central');
    for (const p of ['carreta', 'carreta_6e', 'romeu_julieta', 'bitrem']) {
      const e = enquadrar(z, veic({ preset: p }));
      expect(e.classe, p).toBe('carreta');
      expect(describeJanelas(e.janelas)).toBe('todos os dias o dia todo');
    }
    expect(enquadrar(z, veic({ preset: 'truck' })).classe).toBe('caminhão');
  });

  it('predicado "todas" (E): mais de 2 eixos e PBT acima de 10 t', () => {
    const c = regra('ficticio_corredor');
    expect(enquadrar(c, veic({ preset: 'truck' })).aplica).toBe(true);                         // 3 eixos, 23 t
    expect(enquadrar(c, veic({ preset: 'toco' })).aplica).toBe(false);                         // 2 eixos
    expect(enquadrar(c, veic({ preset: 'truck', weight_t: 9.5 })).aplica).toBe(false);         // 3 eixos, 9,5 t
  });

  it('VUC local com capacidade máxima: sem a capacidade informada não é VUC (lado seguro)', () => {
    const vuc = regra('ficticio_area_central').vuc!;
    expect(vuc).toMatchObject({ largura_max_m: 2.2, comprimento_max_m: 6.3, payload_max_t: 3 });   // herdado do município
    expect(fitsVuc(veic(PEQUENO), vuc)).toBe(false);
    expect(fitsVuc(veic({ ...PEQUENO, payload_t: 2.5 }), vuc)).toBe(true);
    expect(fitsVuc(veic({ ...PEQUENO, payload_t: 3.5 }), vuc)).toBe(false);
    expect(fitsVuc(veic({ ...PEQUENO, length_m: 6.5, payload_t: 2 }), vuc)).toBe(false);
  });

  it('UF da regra para o feriado estadual (cargas antigas sem uf ficam em SP)', () => {
    expect(ufDe({ uf: 'MG', ibge: '3106200' })).toBe('MG');
    expect(ufDe({ ibge: '3304557' })).toBe('RJ');
    expect(ufDe({ ibge: '3205309' })).toBe('ES');
    expect(ufDe({ ibge: null })).toBe('SP');
  });

  it('veículo: capacidade informada x típica do perfil (aproximada)', () => {
    expect(veic({ preset: 'toco' })).toMatchObject({ payload_t: 10, payload_t_aproximado: true });
    expect(veic({ preset: 'toco', payload_t: 8.5 })).toMatchObject({ payload_t: 8.5, payload_t_aproximado: false });
  });
});

describe('município fictício gravado no banco (fonte da fixture)', () => {
  // O e D a oeste e a leste das zonas; a reta O–D cruza a zona suspensa, a área central e a ponte
  const O = { lat: -24.805, lon: -44.84 }, D = { lat: -24.805, lon: -44.78 };
  const DENTRO = { lat: -24.805, lon: -44.805 };   // dentro da área central

  beforeAll(async () => {
    await pool.query(`delete from data_features where layer_id = $1 and source = $2`, [LAYER, SOURCE]);
    for (const f of FIX.features) {
      await pool.query(
        `insert into data_features (layer_id, source, source_id, name, kind, geom, props, valid_from, valid_to)
         values ($1, $2, $3, $4, $5, ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), $7::jsonb, $8, $9)`,
        [LAYER, SOURCE, f.source_id, f.name, f.kind, JSON.stringify(f.geometry), JSON.stringify(f.props), f.valid_from ?? null, f.valid_to ?? null]);
    }
  });
  afterAll(async () => {
    await pool.query(`delete from data_features where layer_id = $1 and source = $2`, [LAYER, SOURCE]);
    await pool.end();
  });

  it('exclusions: só a zona ativa, no horário; suspensa e revogada nunca; origem dentro não exclui', async () => {
    const ex = await layer.exclusions!(ctxOf(O, D, '2026-10-13T10:00', { preset: 'truck' }) as any);
    const nossas = ex.filter((e) => e.item.note === 'Município Fictício (teste)');
    expect(nossas.map((e) => e.item.type)).toEqual(['Área Central']);
    expect((await layer.exclusions!(ctxOf(O, D, '2026-10-13T21:00', { preset: 'truck' }) as any)).some((e) => e.item.type === 'Área Central')).toBe(false);
    // carreta: 24 h (variante)
    expect((await layer.exclusions!(ctxOf(O, D, '2026-10-18T03:00', { preset: 'carreta' }) as any)).some((e) => e.item.type === 'Área Central')).toBe(true);
    // capacidade informada abaixo do limite e 6 m: livre; sem a capacidade: lado seguro
    expect((await layer.exclusions!(ctxOf(O, D, '2026-10-13T10:00', { ...PEQUENO, payload_t: 5 }) as any)).some((e) => e.item.type === 'Área Central')).toBe(false);
    expect((await layer.exclusions!(ctxOf(O, D, '2026-10-13T10:00', PEQUENO) as any)).some((e) => e.item.type === 'Área Central')).toBe(true);
    expect((await layer.exclusions!(ctxOf(DENTRO, D, '2026-10-13T10:00', { preset: 'truck' }) as any)).some((e) => e.item.type === 'Área Central')).toBe(false);
  });

  it('costLines: ponte (PBT acima de 12 t) nos dois sentidos; corredor só 17h–20h e só para 3+ eixos e acima de 10 t', async () => {
    const dez = await layer.costLines!(ctxOf(O, D, '2026-10-13T10:00', { preset: 'truck' }) as any);
    const ponte = dez.filter((c) => c.item.type === 'Ponte (PBT até 12 t)');
    expect(ponte.length).toBe(2);
    expect(ponte[0].factor).toBe(1000);
    expect(dez.some((c) => c.item.type === 'Corredor')).toBe(false);
    expect(dez.some((c) => /Lei antiga/.test(c.item.type ?? ''))).toBe(false);          // desativada nunca
    const pico = await layer.costLines!(ctxOf(O, D, '2026-10-13T18:00', { preset: 'truck' }) as any);
    expect(pico.some((c) => c.item.type === 'Corredor')).toBe(true);
    const toco = await layer.costLines!(ctxOf(O, D, '2026-10-13T18:00', { preset: 'toco' }) as any);
    expect(toco.some((c) => c.item.type === 'Corredor')).toBe(false);
    expect(toco.some((c) => c.item.type === 'Ponte (PBT até 12 t)')).toBe(true);        // 16 t
  });

  it('feriado estadual pela UF da regra: o corredor (exceto feriados) cai no feriado de SP e não no de MG', async () => {
    const dia = '2030-04-16';   // terça
    const ins = async (uf: string) => (await pool.query(
      `insert into holidays (day, scope, uf, name, source) values ($1, 'state', $2, 'TESTE municipios', 'teste') returning id`, [dia, uf])).rows[0].id;
    const corredor = async () => (await layer.costLines!(ctxOf(O, D, `${dia}T18:00`, { preset: 'truck' }) as any)).some((c) => c.item.type === 'Corredor');
    let id = await ins('MG');
    try { expect(await corredor()).toBe(true); } finally { await pool.query(`delete from holidays where id = $1`, [id]); }
    id = await ins('SP');
    try { expect(await corredor()).toBe(false); } finally { await pool.query(`delete from holidays where id = $1`, [id]); }
  });

  it('annotate: capacidade não informada avisa; regra suspensa no caminho avisa sem aplicar', async () => {
    const reta = routeOf([[-44.84, -24.8075], [-44.78, -24.8075]]);   // cruza a zona suspensa e a área central
    const sem = await layer.annotate!(ctxOf(O, D, '2026-10-13T10:00', PEQUENO) as any, reta as any);
    const codes = sem.warnings!.map((w) => w.code);
    expect(codes).toContain('municipal_capacidade_nao_informada');
    expect(sem.warnings!.find((w) => w.code === 'municipal_capacidade_nao_informada')!.message).toMatch(/~5 t, aproximada\) ela não valeria/);
    expect(codes).toContain('municipal_regra_nao_aplicada');
    expect(sem.warnings!.find((w) => w.code === 'municipal_regra_nao_aplicada')!.message).toMatch(/suspensa.*Portaria fictícia 2\/2026/);
    expect((sem.data as any).nao_aplicadas.map((x: any) => x.regra_id)).toEqual(['ficticio_suspensa']);
    const com = await layer.annotate!(ctxOf(O, D, '2026-10-13T10:00', { ...PEQUENO, payload_t: 5 }) as any, reta as any);
    expect(com.warnings!.some((w) => w.code === 'municipal_capacidade_nao_informada')).toBe(false);
    expect(com.summary!.some((s) => /Área Central do Município Fictício.*não se aplica a este veículo/.test(s))).toBe(true);
  });

  it('annotate: via desativada (confiança baixa) usada pela rota avisa; revogada nunca', async () => {
    const naRua = routeOf([[-44.815, -24.812], [-44.815, -24.805], [-44.815, -24.798]]);
    const a = await layer.annotate!(ctxOf({ lat: -24.812, lon: -44.815 }, { lat: -24.798, lon: -44.815 }, '2026-10-13T10:00', PEQUENO) as any, naRua as any);
    const w = a.warnings!.find((x) => x.code === 'municipal_regra_nao_aplicada');
    expect(w?.message).toMatch(/Rua Antiga.*desativada.*Confiança baixa/);
    // capacidade informada abaixo do limite da lei (2 t): a regra nem alcança o veículo
    const b = await layer.annotate!(ctxOf({ lat: -24.812, lon: -44.815 }, { lat: -24.798, lon: -44.815 }, '2026-10-13T10:00', { ...PEQUENO, payload_t: 1.5 }) as any, naRua as any);
    expect(b.warnings ?? []).toEqual([]);
    const revogada = routeOf([[-44.86, -24.8075], [-44.84, -24.8075]]);
    const c = await layer.annotate!(ctxOf({ lat: -24.8075, lon: -44.86 }, { lat: -24.8075, lon: -44.84 }, '2026-10-13T10:00', { preset: 'truck' }) as any, revogada as any);
    expect((c.warnings ?? []).some((x) => /revogada|antiga/i.test(x.message))).toBe(false);
  });

  it('mapa: features mostra só zona e vias aplicáveis da fixture', async () => {
    const fc = await layer.features!([-44.86, -24.82, -44.78, -24.79], { zoom: 14 });
    const nossas = fc.features.filter((f) => f.properties?.municipio === 'Município Fictício (teste)');
    expect(new Set(nossas.map((f) => f.properties?.regime))).toEqual(new Set(['Área Central', 'Corredor', 'Ponte (PBT até 12 t)']));
    const z = nossas.find((f) => f.properties?.regime === 'Área Central')!;
    expect(z.properties?.description).toMatch(/Caminhões com capacidade de carga acima de 5,5 t ou comprimento acima de 6,5 m\. VUC \(até 2,2 x 6,3 m, capacidade até 3 t\) isento\./);
  });

  it('município de origem/destino: limite próprio da RMSP ou, fora dela, a malha do IBGE do geocoding', async () => {
    const osasco = { lat: -23.5320, lon: -46.7800 }, bh = { lat: -19.9245, lon: -43.9352 };
    expect(await municipiosOD({ origin: osasco, destination: bh })).toEqual({ origem: '3534401', destino: '3106200' });
    expect(await municipiosOD({ origin: O, destination: D })).toEqual({ origem: null, destino: null });
  });
});
