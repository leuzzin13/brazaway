import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { get, pool, route, waitForStack } from '../helpers.js';
import layer, { describeJanelas, enquadrar, janelaAtiva, type Regra } from '../../src/layers/restricoes_rmsp.layer.js';
import { resolveVehicle } from '../../src/services/vehicle.js';

/**
 * Frente mun_interior_sp: municípios do interior e do litoral de SP na camada genérica restricoes_rmsp (arquivos
 * data/raw/municipios/<ibge>.json; doc em docs/layers/municipios/mun_interior_sp.md). Regras e recortes de rota chamando o
 * módulo da camada (mesmo banco); poucas rotas reais contra a API (API_URL). 2026-10-13 é terça; 2026-10-18, domingo.
 */
const TZ = 'America/Sao_Paulo';
const LAYER = 'restricoes_rmsp';
const at = (s: string) => DateTime.fromISO(s, { zone: TZ }).toJSDate();
const veic = (v: Record<string, unknown>) => resolveVehicle(v as any);
const ctxOf = (o: { lat: number; lon: number }, d: { lat: number; lon: number }, when: string, vehicle: Record<string, unknown>) =>
  ({ vehicle: veic(vehicle), at: at(when), departureLocal: when, origin: o, destination: d, tz: TZ });
const routeOf = (coords: [number, number][], min = 10) => ({ line: turf.lineString(coords), distance_km: turf.length(turf.lineString(coords)), duration_s: min * 60 });

const FONTES = ['campinas', 'sorocaba', 'sao-vicente', 'santos', 'guaruja', 'piracicaba', 'jacarei', 'sao-jose-do-rio-preto', 'mirassol', 'jundiai'];
const CARRETA = { preset: 'carreta' };                                   // 19,3 m, 5 eixos, 41,5 t
const VLC_JACAREI = { preset: 'vuc', length_m: 7.0, width_m: 2.4, weight_t: 7.5, axle_count: 2 };   // VCL do Dec. 247/2017
const VUC_SOROCABA = { preset: 'vuc', length_m: 6.0, width_m: 2.2, payload_t: 3 };   // VLC da Res. SEMOB 02/25 (carga útil > 1,5 t)
const BITREM = { preset: 'bitrem' };                                     // VCPB do Dec. 247/2017 (cvc)
const ROMEU_JULIETA = { preset: 'romeu_julieta' };                       // VCPB (caminhão + reboque)
/** Jacareí: pontos nas Rotas de Cargas Pesadas (Rod. Nilo Máximo, Av. Malek Assad, Av. Industrial) */
const JAC = { nilo: { lat: -23.31102, lon: -45.93163 }, malek: { lat: -23.28878, lon: -45.96906 }, industrial: { lat: -23.29213, lon: -45.98684 } };
const GUARAREMA = { lat: -23.4127, lon: -46.0359 }, SJC = { lat: -23.1790, lon: -45.8869 };   // vizinhos de Jacareí (fora do município)
/** Guarujá: frente do Assaí na R. Valdomiro Macário e a Rod. Cônego Domênico Rangoni ao norte */
const GUARUJA = { assai: { lat: -23.97350, lon: -46.26985 }, rodovia: { lat: -23.9500, lon: -46.2790 } };

const regra = async (id: string): Promise<Regra> => {
  const q = await pool.query(`select props from data_features where layer_id = $1 and props->>'regra_id' = $2 limit 1`, [LAYER, id]);
  expect(q.rows.length, `regra ${id} não importada (rode o importador municipios:<ibge> ou aplique o seed)`).toBe(1);
  return q.rows[0].props;
};
/** quanto (km) da rota fica a até `tolM` das vias da regra */
async function kmNasVias(geometry: GeoJSON.LineString, regraId: string, tolM = 10): Promise<number> {
  const q = await pool.query(
    `select coalesce(ST_Length(ST_Intersection(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography,
            ST_Buffer(ST_Collect(geom)::geography, $3))::geometry::geography), 0) / 1000 as km
       from data_features where layer_id = $2 and props->>'regra_id' = $4`,
    [JSON.stringify(geometry), LAYER, tolM, regraId]);
  return Number(q.rows[0].km);
}

beforeAll(async () => { await waitForStack(); }, 600_000);
afterAll(async () => { await pool.end(); });

describe('carga e registro', () => {
  it('uma fonte por município em data_layer_runs, com licença real', async () => {
    const r = await get('/api/layers');
    const l = r.body.find((x: any) => x.id === LAYER);
    expect(l.runs.map((x: any) => x.source)).toEqual(expect.arrayContaining(FONTES));
    const q = await pool.query(`select distinct on (source) source, license, record_count from data_layer_runs where layer_id = $1 and source = any($2) order by source, imported_at desc`, [LAYER, FONTES]);
    expect(q.rows.length).toBe(FONTES.length);
    for (const x of q.rows) {
      expect(x.license, x.source).toMatch(/Lei 9\.610\/1998|IBGE|ODbL|notícia|Notícias/i);
      expect(x.record_count, x.source).toBeGreaterThan(0);
    }
  });

  it('kinds por status: ativas viram zona/via; Santos e Piracicaba desativadas; Rio Preto, Mirassol e Jundiaí revogadas no passado', async () => {
    const q = await pool.query(
      `select props->>'regra_id' as id, kind, count(*)::int as n, bool_and(valid_to is null or valid_to < now()) as ok_validade
         from data_features where layer_id = $1 and source = any($2) group by 1, 2`, [LAYER, FONTES]);
    const k = Object.fromEntries(q.rows.map((x) => [x.id, x.kind]));
    expect(k).toMatchObject({
      campinas_anel_rodoviario: 'zona', campinas_nova_aparecida: 'zona', campinas_anel_reboucas: 'zona',
      sorocaba_res_semob_02_2025: 'via', sao_vicente_arc: 'zona', sao_vicente_ponte_pensil: 'via',
      sao_vicente_oswaldo_toschi: 'desativada', sao_vicente_rua_campos: 'desativada', sao_vicente_lei_669a: 'desativada',
      guaruja_valdomiro_macario: 'via', jacarei_fora_rcp: 'zona', jacarei_vcpb_vcpt: 'zona',
      santos_gonzaga: 'desativada', piracicaba_area_central: 'desativada', piracicaba_radares_3_eixos: 'desativada',
      rio_preto_lei_14748_2024: 'revogada', mirassol_lei_4206_2019: 'revogada', jundiai_pl_14649_2025: 'revogada',
    });
    const rev = await pool.query(`select props->>'regra_id' as id, valid_to < now() as passou from data_features where layer_id = $1 and kind = 'revogada' and source = any($2)`, [LAYER, FONTES]);
    expect(rev.rows.map((x) => x.passou)).toEqual([true, true, true]);
    // Jacareí: um polígono por pedaço do município fora das rotas (art. 5º) e fora das rodovias (arts. 6º e 8º)
    expect(q.rows.find((x) => x.id === 'jacarei_fora_rcp').n).toBeGreaterThan(10);
    expect(q.rows.find((x) => x.id === 'jacarei_vcpb_vcpt').n).toBeGreaterThan(5);
  });

  it('toda regra cita ato, artigo e URL; confiança baixa/unverifiable nunca está ativa', async () => {
    const q = await pool.query(`select distinct on (props->>'regra_id') props from data_features where layer_id = $1 and source = any($2)`, [LAYER, FONTES]);
    for (const { props: p } of q.rows) {
      expect(p.base_legal.length, p.regra_id).toBeGreaterThan(0);
      for (const b of p.base_legal) expect(b.artigo && b.ato && /^https?:\/\//.test(b.url), p.regra_id).toBeTruthy();
      if (['baixa', 'unverifiable'].includes(p.confianca)) expect(p.status, p.regra_id).not.toBe('ativa');
      if (p.status !== 'ativa') expect(p.status_motivo, p.regra_id).toBeTruthy();
    }
  });

  it('vias ativas em pedaços de até ~450 m, validadas no Valhalla e com 6 casas decimais (o que a API manda)', async () => {
    const q = await pool.query(
      `select count(*)::int n, max(ST_Length(geom::geography))::float max_m,
              sum(case when (props->>'valhalla_validado')::boolean then 0 else 1 end)::int sem_teste,
              sum(case when ST_AsGeoJSON(geom, 9) = ST_AsGeoJSON(geom, 6) then 0 else 1 end)::int mais_de_6_casas
         from data_features where layer_id = $1 and kind = 'via' and source = any($2)`, [LAYER, FONTES]);
    expect(q.rows[0].n).toBeGreaterThan(50);
    expect(q.rows[0].max_m).toBeLessThan(450);
    expect(q.rows[0].sem_teste).toBe(0);
    expect(q.rows[0].mais_de_6_casas).toBe(0);
  });
});

describe('regras por município (módulo da camada)', () => {
  it('Campinas (Res. 079/2017): Anel Rodoviário e Nova Aparecida para mais de 14 m; Anel Rebouças para mais de 6,30 m', async () => {
    const anel = await regra('campinas_anel_rodoviario');
    expect(describeJanelas(anel.janelas)).toBe('seg–sex 6h–9h e 16h–20h; sáb 9h–14h');
    expect(enquadrar(anel, veic(CARRETA)).aplica).toBe(true);
    expect(enquadrar(anel, veic({ preset: 'truck' })).aplica).toBe(false);               // 12 m
    expect(janelaAtiva(anel.janelas, at('2026-10-13T08:59'))).toBe(true);
    expect(janelaAtiva(anel.janelas, at('2026-10-13T12:00'))).toBe(false);
    expect(janelaAtiva(anel.janelas, at('2026-10-17T10:00'))).toBe(true);                // sábado 9h–14h
    const na = await regra('campinas_nova_aparecida');
    expect(describeJanelas(na.janelas)).toBe('todos os dias o dia todo');
    const reb = await regra('campinas_anel_reboucas');
    expect(describeJanelas(reb.janelas)).toBe('seg–sex 6h–20h; sáb 6h–14h');
    expect(enquadrar(reb, veic({ preset: 'truck' })).aplica).toBe(true);
    expect(enquadrar(reb, veic({ preset: 'vuc', length_m: 6.3, width_m: 2.2 })).aplica).toBe(false);
    expect(enquadrar(reb, veic({ preset: 'vuc' })).aplica).toBe(true);                   // VUC de SP: 7,20 m
    // a zona é de Campinas: a faixa que o anel fechava em Valinhos (Av. Eng. Antônio Francisco de Paula Souza) ficou de fora
    const valinhos = await pool.query(
      `select bool_or(ST_Contains(geom, ST_SetSRID(ST_Point(-47.02337, -22.95339), 4326))) as dentro
         from data_features where layer_id = $1 and props->>'regra_id' = 'campinas_anel_rodoviario'`, [LAYER]);
    expect(valinhos.rows[0].dentro).toBe(false);
  });

  it('Sorocaba (Res. SEMOB 02/25): caminhão proibido 24 h; VUC/VLC até 6,30 x 2,20 m com carga útil acima de 1,5 t isento', async () => {
    const r = await regra('sorocaba_res_semob_02_2025');
    expect(describeJanelas(r.janelas)).toBe('todos os dias o dia todo');
    expect(r.vuc ?? null).toBeNull();                                                   // a isenção está no alvo (art. 2º, I)
    expect(enquadrar(r, veic(VUC_SOROCABA)).aplica).toBe(false);                        // 6,0 x 2,2 m, 3 t informadas
    expect(enquadrar(r, veic({ ...VUC_SOROCABA, payload_t: 1.5 })).aplica).toBe(true);  // carga útil até 1,5 t: não é VUC/VLC
    // sem a capacidade informada: aplica (lado seguro) e marca a suposição (aviso municipal_capacidade_nao_informada)
    const { payload_t: _p, ...semCapacidade } = VUC_SOROCABA;
    const e = enquadrar(r, veic(semCapacidade));
    expect(e.aplica).toBe(true);
    expect(e.capacidadeSuposta).toBeTruthy();
    const o = { lat: -23.4660, lon: -47.4560 }, d = { lat: -23.5090, lon: -47.4540 };
    const via = await pool.query(`select ST_AsGeoJSON(geom, 6)::json as g from data_features where layer_id = $1 and props->>'regra_id' = 'sorocaba_res_semob_02_2025' order by ST_Length(geom::geography) desc limit 1`, [LAYER]);
    const a = await layer.annotate!(ctxOf(o, d, '2026-10-13T10:00', semCapacidade) as any, routeOf(via.rows[0].g.coordinates) as any);
    expect(a.warnings!.find((w) => w.code === 'municipal_capacidade_nao_informada')?.message).toMatch(/Sorocaba.*capacidade de carga.*não foi informada.*lado seguro/);
    expect(enquadrar(r, veic({ preset: 'vuc', payload_t: 3 })).aplica).toBe(true);      // 7,20 x 2,50 m
    expect(enquadrar(r, veic({ preset: 'toco' })).aplica).toBe(true);
  });

  it('Jacareí (Dec. 247/2017): VCL (até 7,99 t, 7,20 m e 2 eixos) livre; o resto só nas Rotas de Cargas Pesadas', async () => {
    const r = await regra('jacarei_fora_rcp');
    expect(enquadrar(r, veic(VLC_JACAREI)).aplica).toBe(false);
    expect(enquadrar(r, veic({ ...VLC_JACAREI, weight_t: 9 })).aplica).toBe(true);
    expect(enquadrar(r, veic({ ...VLC_JACAREI, axle_count: 3 })).aplica).toBe(true);
    expect(enquadrar(r, veic({ preset: 'toco' })).aplica).toBe(true);
    // arts. 6º e 8º: bitrem e caminhão + reboque (VCPB) só com AETC, inclusive nas RCP; treminhão (VCPT) proibido
    const b = await regra('jacarei_vcpb_vcpt');
    expect(describeJanelas(b.janelas)).toBe('todos os dias o dia todo');
    expect(b.base_legal[0].artigo).toMatch(/art\. 6º.*art\. 8º/);
    expect(enquadrar(b, veic(BITREM)).aplica).toBe(true);
    expect(enquadrar(b, veic(ROMEU_JULIETA)).aplica).toBe(true);
    expect(enquadrar(b, veic({ preset: 'rodotrem' })).aplica).toBe(true);
    expect(enquadrar(b, veic(CARRETA)).aplica).toBe(false);                              // cavalo + 1 semirreboque: VCP
    expect(enquadrar(b, veic({ preset: 'toco' })).aplica).toBe(false);
  });

  it('São Vicente: ARC seg–sáb 10h–19h exceto feriados (Lei 2163-A/2009); Ponte Pênsil sempre; leis de rua só registradas', async () => {
    const arc = await regra('sao_vicente_arc');
    expect(describeJanelas(arc.janelas)).toBe('seg–sáb 10h–19h');
    expect(arc.feriados).toBe('suspende');
    const o = { lat: -23.9690, lon: -46.3935 }, d = { lat: -23.9700, lon: -46.3730 };    // dos dois lados do Centro
    const tem = async (when: string) => (await layer.exclusions!(ctxOf(o, d, when, { preset: 'toco' }) as any)).some((e) => e.item.type === 'ARC');
    expect(await tem('2026-10-13T11:00')).toBe(true);
    expect(await tem('2026-10-13T20:00')).toBe(false);
    expect(await tem('2026-10-18T11:00')).toBe(false);                                  // domingo
    const ins = await pool.query(`insert into holidays (day, scope, name, source) values ('2030-03-12', 'national', 'TESTE mun_interior_sp', 'teste') on conflict do nothing returning id`);
    try {
      expect(await tem('2030-03-12T11:00')).toBe(false);                                // terça, feriado
      expect(await tem('2030-03-19T11:00')).toBe(true);
    } finally {
      if (ins.rows[0]) await pool.query(`delete from holidays where id = $1`, [ins.rows[0].id]);
    }
    const ponte = await layer.costLines!(ctxOf({ lat: -23.9740, lon: -46.3870 }, { lat: -23.9800, lon: -46.3920 }, '2026-10-18T03:00', { preset: 'toco' }) as any);
    expect(ponte.some((c) => c.item.type === 'Ponte Pênsil')).toBe(true);
  });

  it('Jacareí: com o destino num pedaço, só ele deixa de ser excluído (e a rota avisa); VCL não tem exclusão', async () => {
    const { nilo, malek } = JAC, centro = { lat: -23.3040, lon: -45.9690 };
    const pecas = (ex: any[]) => ex.filter((e) => e.item.type === 'Rota de Cargas Pesadas').length;
    const todas = pecas(await layer.exclusions!(ctxOf(nilo, malek, '2026-10-13T10:00', CARRETA) as any));
    expect(todas).toBeGreaterThan(10);
    expect(pecas(await layer.exclusions!(ctxOf(nilo, centro, '2026-10-13T10:00', CARRETA) as any))).toBe(todas - 1);
    expect(pecas(await layer.exclusions!(ctxOf(nilo, malek, '2026-10-13T10:00', VLC_JACAREI) as any))).toBe(0);
  });

  it('Jacareí (arts. 6º e 8º): bitrem de passagem tem as RCP urbanas excluídas; com destino na Av. Industrial, o pedaço urbano fica e a rota avisa a AETC', async () => {
    const vcpb = (ex: any[]) => ex.filter((e) => e.item.type === 'Bitrem, reboque e treminhão');
    const cobre = (ex: any[], p: { lat: number; lon: number }) =>
      ex.some((e) => e.rings.some((r: [number, number][]) => turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), turf.polygon([r]))));
    const passagem = vcpb(await layer.exclusions!(ctxOf(GUARAREMA, SJC, '2026-10-13T10:00', BITREM) as any));
    expect(passagem.length).toBeGreaterThan(3);
    for (const p of [JAC.malek, JAC.industrial, JAC.nilo]) expect(cobre(passagem, p)).toBe(true);   // RCP 4, 5 e 6
    expect(vcpb(await layer.exclusions!(ctxOf(GUARAREMA, SJC, '2026-10-13T10:00', ROMEU_JULIETA) as any)).length).toBe(passagem.length);
    expect(vcpb(await layer.exclusions!(ctxOf(GUARAREMA, SJC, '2026-10-13T10:00', CARRETA) as any)).length).toBe(0);   // VCP: RCP livres
    // destino na Av. Industrial (RCP 5): antes, nenhum pedaço da zona fora das RCP tinha o destino e nada avisava
    const ex = await layer.exclusions!(ctxOf(GUARAREMA, JAC.industrial, '2026-10-13T10:00', BITREM) as any);
    expect(vcpb(ex).length).toBe(passagem.length - 1);
    expect(cobre(vcpb(ex), JAC.malek)).toBe(false);
    const a = await layer.annotate!(ctxOf(GUARAREMA, JAC.industrial, '2026-10-13T10:00', BITREM) as any,
      routeOf([[GUARAREMA.lon, GUARAREMA.lat], [JAC.industrial.lon, JAC.industrial.lat]]) as any);
    expect(a.warnings!.find((w) => w.code === 'rmsp_destino_na_zona' && /bitrem/.test(w.message))?.message)
      .toMatch(/Exige AETC prévia para bitrem e caminhão \+ reboque.*treminhão é proibido/);
  });

  it('Guarujá: só o trecho a oeste do acesso ao Assaí leva custo (sem o começo da rua nem as alças da rodovia)', async () => {
    const cl = (await layer.costLines!(ctxOf(GUARUJA.assai, GUARUJA.rodovia, '2026-10-13T10:00', { preset: 'toco' }) as any))
      .filter((c) => c.item.type === 'Sinalização (R. Valdomiro Macário)');
    expect(cl.length).toBeGreaterThan(0);
    expect(Math.max(...cl.flatMap((c) => c.coordinates.map((x) => x[0])))).toBeLessThan(-46.2694);    // acesso ao Assaí: -46,26948
    const m = cl.reduce((acc, c) => acc + turf.length(turf.lineString(c.coordinates), { units: 'meters' }), 0) / 2;   // ida e volta
    expect(m).toBeGreaterThan(500);
    expect(m).toBeLessThan(620);
  });

  it('Campinas: Nova Aparecida exclui a passagem de carreta a qualquer hora; caminhão de 12 m não', async () => {
    const o = { lat: -22.835, lon: -47.165 }, d = { lat: -22.880, lon: -47.130 };     // dos dois lados do distrito
    const na = async (v: Record<string, unknown>, when: string) => (await layer.exclusions!(ctxOf(o, d, when, v) as any)).some((e) => e.item.type === 'Nova Aparecida');
    expect(await na(CARRETA, '2026-10-18T03:00')).toBe(true);
    expect(await na({ preset: 'truck' }, '2026-10-18T03:00')).toBe(false);
  });
});

describe('avisos de regras não aplicadas e registros (sem rota real)', () => {
  it('Santos: a Zona do Gonzaga (desativada, sem ato) só avisa; nunca vira exclusão', async () => {
    const o = { lat: -23.9640, lon: -46.3450 }, d = { lat: -23.9640, lon: -46.3200 };
    expect((await layer.exclusions!(ctxOf(o, d, '2026-10-13T13:00', { preset: 'toco' }) as any)).some((e) => /Gonzaga/.test(e.item.type ?? ''))).toBe(false);
    const a = await layer.annotate!(ctxOf(o, d, '2026-10-13T13:00', { preset: 'toco' }) as any, routeOf([[o.lon, o.lat], [d.lon, d.lat]]) as any);
    const w = a.warnings!.find((x) => x.code === 'municipal_regra_nao_aplicada');
    expect(w?.message).toMatch(/Santos: a rota passa por "Zona de Restrição do Gonzaga.*todos os dias 12h–20h.*desativada.*Sem ato normativo/);
  });

  it('Piracicaba: avenida com radar para mais de 3 eixos avisa a carreta e não o toco (2 eixos)', async () => {
    const q = await pool.query(
      `select ST_AsGeoJSON(g, 6)::json as g from (
         select (ST_Dump(geom)).geom as g from data_features where layer_id = $1 and props->>'regra_id' = 'piracicaba_radares_3_eixos'
            and props->>'via' = 'Avenida Independência') x order by ST_Length(g::geography) desc limit 1`, [LAYER]);
    const c = q.rows[0].g.coordinates as [number, number][];
    expect(turf.length(turf.lineString(c), { units: 'meters' })).toBeGreaterThan(100);
    const o = { lon: c[0][0], lat: c[0][1] }, d = { lon: c[c.length - 1][0], lat: c[c.length - 1][1] };
    const car = await layer.annotate!(ctxOf(o, d, '2026-10-13T10:00', CARRETA) as any, routeOf(c) as any);
    expect(car.warnings!.find((x) => x.code === 'municipal_regra_nao_aplicada')?.message).toMatch(/Piracicaba.*radar.*desativada/);
    const toco = await layer.annotate!(ctxOf(o, d, '2026-10-13T10:00', { preset: 'toco' }) as any, routeOf(c) as any);
    expect((toco.warnings ?? []).some((x) => x.code === 'municipal_regra_nao_aplicada' && /radar/.test(x.message))).toBe(false);
  });

  it('Rio Preto, Mirassol e Jundiaí (lei inconstitucional e PL vetado): nunca excluem nem avisam e não aparecem no mapa', async () => {
    const rp = { lat: -20.8100, lon: -49.3800 }, rp2 = { lat: -20.8300, lon: -49.4000 };
    const ex = await layer.exclusions!(ctxOf(rp, rp2, '2026-10-13T10:00', CARRETA) as any);
    expect(ex.some((e) => /Rio Preto|14\.748/.test(e.item.name ?? ''))).toBe(false);
    const a = await layer.annotate!(ctxOf(rp, rp2, '2026-10-13T10:00', CARRETA) as any, routeOf([[rp.lon, rp.lat], [rp2.lon, rp2.lat]]) as any);
    expect((a.warnings ?? []).length).toBe(0);
    const jd = await get('/api/layers/restricoes_rmsp/features?bbox=-46.95,-23.25,-46.85,-23.15&zoom=14');
    expect(jd.body.features.some((f: any) => f.properties.municipio === 'Jundiaí')).toBe(false);
  });
});

describe('rotas reais (API)', () => {
  it('Sorocaba: o toco desvia da Av. Dom Aguirre; o VLC (6,0 x 2,2 m) passa por ela', async () => {
    const o = { lat: -23.4660, lon: -47.4560 }, d = { lat: -23.5090, lon: -47.4540 };   // pontas da avenida, ao longo do rio
    const toco = await route({ origin: o, destination: d, vehicle: { preset: 'toco' }, departure_at: '2026-10-13T10:00' });
    expect(toco.status, JSON.stringify(toco.body).slice(0, 300)).toBe(200);
    expect(toco.body.avoided.some((a: any) => a.layer === LAYER && a.type === 'Res. SEMOB 02/25')).toBe(true);
    expect(await kmNasVias(toco.body.geometry, 'sorocaba_res_semob_02_2025')).toBeLessThan(0.5);
    const vlc = await route({ origin: o, destination: d, vehicle: VUC_SOROCABA, departure_at: '2026-10-13T10:00' });
    expect(vlc.status).toBe(200);
    expect(vlc.body.avoided.some((a: any) => a.layer === LAYER)).toBe(false);
    expect(await kmNasVias(vlc.body.geometry, 'sorocaba_res_semob_02_2025')).toBeGreaterThan(2);
  }, 180_000);

  it('Jacareí: a carreta entre duas Rotas de Cargas Pesadas sai pelas rodovias; o VCL corta a cidade', async () => {
    const nilo = { lat: -23.31102, lon: -45.93163 }, malek = { lat: -23.28878, lon: -45.96906 };
    const car = await route({ origin: nilo, destination: malek, vehicle: CARRETA, departure_at: '2026-10-13T10:00' });
    expect(car.status, JSON.stringify(car.body).slice(0, 300)).toBe(200);
    expect(car.body.avoided.some((a: any) => a.layer === LAYER && a.type === 'Rota de Cargas Pesadas')).toBe(true);
    const vcl = await route({ origin: nilo, destination: malek, vehicle: VLC_JACAREI, departure_at: '2026-10-13T10:00' });
    expect(vcl.status).toBe(200);
    expect(vcl.body.avoided.some((a: any) => a.layer === LAYER)).toBe(false);
    expect(car.body.distance_km).toBeGreaterThan(vcl.body.distance_km);
  }, 180_000);

  it('Jacareí: bitrem com destino na Av. Industrial (RCP 5) chega e recebe o aviso da AETC (arts. 6º e 8º)', async () => {
    const r = await route({ origin: GUARAREMA, destination: JAC.industrial, vehicle: BITREM, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const w = r.body.warnings.find((x: any) => x.layer === LAYER && x.code === 'rmsp_destino_na_zona' && /bitrem/.test(x.message));
    expect(w?.message).toMatch(/AETC prévia para bitrem/);
  }, 180_000);

  it('Guarujá: caminhão saindo do Assaí para a rodovia não leva aviso de via restrita', async () => {
    const r = await route({ origin: GUARUJA.assai, destination: GUARUJA.rodovia, vehicle: { preset: 'toco' }, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body.warnings.filter((w: any) => w.layer === LAYER && ['uses_restricted_way', 'rmsp_via_restrita_na_rota'].includes(w.code))).toEqual([]);
  }, 180_000);

  it('Campinas: carreta saindo do Centro às 7h passa pelo Anel Rodoviário e pelo Anel Rebouças (origem dentro: não exclui, avisa)', async () => {
    const centro = { lat: -22.9030, lon: -47.0611 }, oeste = { lat: -22.9500, lon: -47.1300 };
    const r = await route({ origin: centro, destination: oeste, vehicle: CARRETA, departure_at: '2026-10-13T07:00' });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    expect(r.body.avoided.some((a: any) => a.layer === LAYER && /Anel/.test(a.type ?? ''))).toBe(false);
    const ws = r.body.warnings.filter((w: any) => w.layer === LAYER && w.code === 'rmsp_origem_na_zona').map((w: any) => w.message).join(' | ');
    expect(ws).toMatch(/Anel Rodoviário.*Exige acesso só pelas entradas e roteiros liberados do Anexo II/);
    expect(ws).toMatch(/Anel de Integração Eng\. Rebouças.*Exige ACC ou ACM da EMDEC/);
  }, 180_000);
});
