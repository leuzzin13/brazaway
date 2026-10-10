import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { get, pool, route, waitForStack } from '../helpers.js';
import layer, { describeJanelas, enquadrar, regraAplicavel, type Regra } from '../../src/layers/restricoes_rmsp.layer.js';
import { resolveVehicle } from '../../src/services/vehicle.js';

/**
 * Grande Vitória (frente mun_vitoria): Vitória (3205309), Vila Velha (3205200) e Serra (3205002) no formato por
 * município da camada restricoes_rmsp, carregados pelo importador `municipios` (fontes vitoria, vila-velha e serra;
 * seeds db/seed/layers/restricoes_rmsp__<fonte>.sql). Regras e aplicação chamando o módulo da camada (mesmo banco);
 * poucas rotas reais contra a API (API_URL). 2026-10-13 é terça; 2026-10-17, sábado; 2026-10-18, domingo.
 * Atos e decisões: docs/layers/municipios/mun_vitoria.md.
 */
const TZ = 'America/Sao_Paulo';
const LAYER = 'restricoes_rmsp';
const FONTES = ['vitoria', 'vila-velha', 'serra'];
const at = (s: string) => DateTime.fromISO(s, { zone: TZ }).toJSDate();
const veic = (v: Record<string, unknown>) => resolveVehicle(v as any);
type P = { lat: number; lon: number };
const ctxOf = (o: P, d: P, when: string, vehicle: Record<string, unknown>) =>
  ({ vehicle: veic(vehicle), at: at(when), departureLocal: when, origin: o, destination: d, tz: TZ }) as any;

// pontos de teste (fora das zonas, salvo indicação)
const VV_COBILANDIA = { lat: -20.3480, lon: -40.3460 };   // Vila Velha, perto da Av. Carlos Lindenberg
const SERRA_CARAPINA = { lat: -20.2240, lon: -40.2840 };  // Serra, perto da BR-101
const VIX_CENTRO = { lat: -20.3203, lon: -40.3335 };      // Centro de Vitória (art. 1º, III), fora da Cidade Alta
const VIX_PRAIA_SUA = { lat: -20.3125, lon: -40.2930 };   // Vitória, cabeceira norte da Terceira Ponte
const VV_PRAIA_COSTA = { lat: -20.3420, lon: -40.2870 };  // Vila Velha, Praia da Costa
const SERRA_LARANJEIRAS = { lat: -20.2010, lon: -40.2580 }; // Serra, perto da Av. Norte-Sul
const SERRA_BARCELONA = { lat: -20.1745, lon: -40.2525 };
const CARRETA = { preset: 'carreta_5e' };                 // 41,5 t, 5 eixos
const tipos = (xs: { item: { type?: string } }[]) => new Set(xs.map((x) => x.item.type));

interface Linha { id: string; kind: string; props: Regra & { tipo: string; abrangencia_ibge?: string[] }; valid_to: Date | null }
let regras: Map<string, Linha>;
let vitoriaRecuada: GeoJSON.Geometry;          // limite de Vitória (zona de pico) recuado 30 m
let meioPonte: GeoJSON.Feature<GeoJSON.Point>;  // ponto sobre a Terceira Ponte, no meio do vão
let portoVV: { lat: number; lon: number };      // ponto dentro da zona do porto de Vila Velha
const regra = (id: string) => {
  const r = regras.get(id);
  if (!r) throw new Error(`regra ${id} ausente no banco`);
  return r.props;
};

beforeAll(async () => {
  await waitForStack();
  const r = await pool.query<Linha>(
    `select distinct on (props->>'regra_id') props->>'regra_id' as id, kind, props, valid_to
       from data_features where layer_id = $1 and source = any($2) order by props->>'regra_id', id`, [LAYER, FONTES]);
  regras = new Map(r.rows.map((x) => [x.id, x]));
  expect(regras.size, 'rode o importador municipios:3205309,3205200,3205002 ou aplique os seeds restricoes_rmsp__{vitoria,vila-velha,serra}.sql').toBe(27);
  const z = await pool.query(
    `select ST_AsGeoJSON(ST_Buffer(geom::geography, -30)::geometry, 6)::json as g from data_features
      where layer_id = $1 and source = 'vitoria' and props->>'regra_id' = 'vitoria_municipio_23t'`, [LAYER]);
  vitoriaRecuada = z.rows[0].g;
  const p = await pool.query(
    `select ST_X(m) as lon, ST_Y(m) as lat from (select ST_ClosestPoint(ST_Collect(geom), ST_Centroid(ST_Collect(geom))) as m
       from data_features where layer_id = $1 and source = 'vitoria' and props->>'regra_id' = 'es_terceira_ponte_lei_9602') s`, [LAYER]);
  meioPonte = turf.point([p.rows[0].lon, p.rows[0].lat]);
  const q = await pool.query(
    `select ST_X(c) as lon, ST_Y(c) as lat from (select ST_PointOnSurface(ST_Buffer(geom::geography, -40)::geometry) as c from data_features
      where layer_id = $1 and source = 'vila-velha' and props->>'regra_id' = 'vila_velha_porto') s`, [LAYER]);
  portoVV = { lat: q.rows[0].lat, lon: q.rows[0].lon };
}, 600_000);

afterAll(async () => { await pool.end(); });

describe('regras carregadas (banco)', () => {
  it('27 regras: status x kind, UF ES, confiança e ato com artigo em todas', () => {
    const kinds = Object.fromEntries([...regras.values()].map((x) => [x.id, x.kind]));
    expect(kinds).toEqual({
      vitoria_municipio_23t: 'zona', vitoria_municipio_45t: 'zona', vitoria_cegonheira_16t: 'desativada',
      vitoria_centro_16t: 'zona', vitoria_cidade_alta_10t: 'zona', vitoria_cidade_alta_16t: 'zona',
      vitoria_beira_mar_16t: 'via', vitoria_maruipe_paulino_muller_16t: 'via', vitoria_mercado_vila_rubim_16t: 'zona',
      vitoria_porto_centro: 'zona', vitoria_porto_centro_17h_19h: 'revogada', vitoria_carga_descarga_centro: 'desativada',
      es_terceira_ponte_lei_9602: 'via',
      vila_velha_centro_10t: 'zona', vila_velha_centro_16t: 'zona', vila_velha_gloria_10t: 'zona',
      vila_velha_gloria_10t_sabado: 'zona', vila_velha_gloria_16t: 'zona', vila_velha_orla_10t: 'via',
      vila_velha_praias_16t: 'zona', vila_velha_porto: 'zona',
      serra_pico_23t: 'via', serra_av_central_pico_16t: 'via', serra_av_central_dia_16t: 'via',
      serra_av_central_sabado_16t: 'via', serra_vias_24h: 'via', serra_novo_horizonte_24h: 'via',
    });
    for (const { id, props } of regras.values()) {
      expect(props.uf, id).toBe('ES');
      expect(['alta', 'media'], id).toContain(props.confianca);   // nenhuma baixa/unverifiable nesta frente
      for (const b of props.base_legal) {
        expect(b.ato.length, id).toBeGreaterThan(5);
        expect((b.artigo ?? '').length, id).toBeGreaterThan(3);
        expect(b.url, id).toMatch(/^https?:\/\//);
      }
      if (props.status !== 'ativa') expect(props.status_motivo?.length, id).toBeGreaterThan(10);
      expect(props.vuc, id).toBeNull();                          // nenhum dos 3 municípios define VUC
    }
    // revogada: vigência encerrada (nunca vai para a rota)
    expect(regras.get('vitoria_porto_centro_17h_19h')!.valid_to!.toISOString().slice(0, 10)).toBe('2020-09-09');
    // Terceira Ponte: registro regional (lei estadual), ponte vira via
    const tp = regra('es_terceira_ponte_lei_9602') as Linha['props'];
    expect([tp.tipo, tp.ibge, tp.municipio]).toEqual(['ponte', null, 'Vitória e Vila Velha (lei estadual)']);
    expect(tp.abrangencia_ibge).toEqual(['3205309', '3205200']);
    expect(tp.base_legal[0].ato).toMatch(/Lei estadual 9\.602\/2010/);
  });

  it('janelas, feriados e alvos batem com os atos', () => {
    expect(describeJanelas(regra('vitoria_municipio_23t').janelas)).toBe('seg–sex 6h–10h e 16h–20h; sáb 6h–14h');
    expect(describeJanelas(regra('vitoria_cidade_alta_10t').janelas)).toBe('seg–sex 7h–19h; sáb 8h–14h');
    expect(describeJanelas(regra('vitoria_porto_centro').janelas)).toBe('seg–sex 7h–9h');
    expect(describeJanelas(regra('vila_velha_centro_10t').janelas)).toBe('seg–sex 11h–19h; sáb 8h–19h');
    expect(describeJanelas(regra('vila_velha_praias_16t').janelas)).toBe('todos os dias 7h–20h');
    expect(describeJanelas(regra('serra_pico_23t').janelas)).toBe('seg–sex 7h–9h e 17h–19h');
    expect(describeJanelas(regra('serra_av_central_sabado_16t').janelas)).toBe('sáb 8h–14h');
    // feriado: "exceto domingos e feriados"/"dias úteis" suspende; sábado do inciso II de Vila Velha e §1º da Serra não
    expect(['vitoria_municipio_23t', 'vila_velha_centro_10t', 'vila_velha_gloria_10t', 'serra_pico_23t', 'serra_av_central_dia_16t']
      .map((id) => regra(id).feriados)).toEqual(['suspende', 'suspende', 'suspende', 'suspende', 'suspende']);
    expect(['vila_velha_gloria_10t_sabado', 'serra_av_central_sabado_16t', 'vitoria_municipio_45t', 'es_terceira_ponte_lei_9602']
      .map((id) => regra(id).feriados)).toEqual(['aplica', 'aplica', 'aplica', 'aplica']);
    // PBT "maior que": 23 t exatos não entram na de 23 t; 16 t exatos não entram nas de 16 t
    expect(enquadrar(regra('vitoria_municipio_23t'), veic({ preset: 'truck' })).aplica).toBe(false);     // 23 t
    expect(enquadrar(regra('vitoria_municipio_23t'), veic(CARRETA)).aplica).toBe(true);
    expect(enquadrar(regra('serra_av_central_dia_16t'), veic({ preset: 'toco' })).aplica).toBe(false);   // 16 t
    expect(enquadrar(regra('serra_av_central_dia_16t'), veic({ preset: 'truck' })).aplica).toBe(true);
    expect(enquadrar(regra('vila_velha_centro_10t'), veic({ preset: 'vuc' })).aplica).toBe(false);       // 9 t
    // Terceira Ponte: mais de 2 eixos OU mais de 15 t
    const tp = regra('es_terceira_ponte_lei_9602');
    expect(enquadrar(tp, veic({ preset: 'truck', weight_t: 14 })).aplica).toBe(true);   // 3 eixos
    expect(enquadrar(tp, veic({ preset: 'toco', weight_t: 14 })).aplica).toBe(false);   // 2 eixos, 14 t
    expect(enquadrar(tp, veic({ preset: 'toco' })).aplica).toBe(true);                  // 2 eixos, 16 t
    // desativadas e revogada nunca aplicadas
    for (const id of ['vitoria_cegonheira_16t', 'vitoria_carga_descarga_centro', 'vitoria_porto_centro_17h_19h']) {
      expect(regraAplicavel(regra(id)), id).toBe(false);
    }
  });
});

describe('aplicação na rota (módulo da camada)', () => {
  it('Vitória, PBT > 23 t: só no pico; sábado até 14h; domingo livre; origem em Vitória não exclui; > 45 t sempre', async () => {
    const ex = async (o: P, d: P, when: string, v: Record<string, unknown>) => tipos(await layer.exclusions!(ctxOf(o, d, when, v)));
    expect((await ex(VV_COBILANDIA, SERRA_CARAPINA, '2026-10-13T08:00', CARRETA)).has('PBT > 23 t (pico)')).toBe(true);
    expect((await ex(VV_COBILANDIA, SERRA_CARAPINA, '2026-10-13T11:00', CARRETA)).has('PBT > 23 t (pico)')).toBe(false);
    expect((await ex(VV_COBILANDIA, SERRA_CARAPINA, '2026-10-17T12:00', CARRETA)).has('PBT > 23 t (pico)')).toBe(true);
    expect((await ex(VV_COBILANDIA, SERRA_CARAPINA, '2026-10-18T12:00', CARRETA)).has('PBT > 23 t (pico)')).toBe(false);
    expect((await ex(VV_COBILANDIA, SERRA_CARAPINA, '2026-10-13T08:00', { preset: 'truck' })).has('PBT > 23 t (pico)')).toBe(false);
    // origem dentro de Vitória: política da ZMRC (não exclui; o annotate avisa)
    expect((await ex(VIX_CENTRO, SERRA_CARAPINA, '2026-10-13T08:00', CARRETA)).has('PBT > 23 t (pico)')).toBe(false);
    const dom = await ex(VV_COBILANDIA, SERRA_CARAPINA, '2026-10-18T03:00', { preset: 'bitrem' });
    expect(dom.has('PBT > 45 t (24 h)')).toBe(true);
    expect(dom.has('Cegonheira > 16 t')).toBe(false);                     // desativada
  });

  it('feriado municipal de Vitória suspende a zona de pico; o de Vila Velha não', async () => {
    const dia = '2030-04-16';   // terça, sem feriado nacional
    const ins = async (ibge: string) => (await pool.query(
      `insert into holidays (day, scope, uf, ibge_code, name, source) values ($1, 'municipal', 'ES', $2, 'TESTE mun_vitoria', 'teste-mun-vitoria') returning id`,
      [dia, ibge])).rows[0].id;
    const pico = async () => tipos(await layer.exclusions!(ctxOf(VV_COBILANDIA, SERRA_CARAPINA, `${dia}T08:00`, CARRETA))).has('PBT > 23 t (pico)');
    let id = await ins('3205200');
    try { expect(await pico()).toBe(true); } finally { await pool.query(`delete from holidays where id = $1`, [id]); }
    id = await ins('3205309');
    try { expect(await pico()).toBe(false); } finally { await pool.query(`delete from holidays where id = $1`, [id]); }
  });

  it('Vila Velha: Centro e Glória com mais de 10 t no sábado; em sábado feriado só a Glória continua', async () => {
    const ex = async (when: string) => tipos(await layer.exclusions!(ctxOf(VIX_PRAIA_SUA, VV_COBILANDIA, when, { preset: 'toco' })));
    const sab = await ex('2026-10-17T10:00');
    expect(sab.has('Centro (PBT > 10 t)')).toBe(true);
    expect(sab.has('Glória (PBT > 10 t, sábado)')).toBe(true);
    expect(sab.has('Glória (PBT > 16 t, 24 h)')).toBe(false);             // toco = 16 t (não é maior que 16)
    expect((await ex('2026-10-13T10:00')).has('Glória (PBT > 10 t, dias úteis)')).toBe(false);   // começa às 11h
    expect((await ex('2026-10-13T12:00')).has('Glória (PBT > 10 t, dias úteis)')).toBe(true);
    const dia = '2030-06-08';   // sábado, sem feriado nacional
    const id = (await pool.query(
      `insert into holidays (day, scope, uf, name, source) values ($1, 'state', 'ES', 'TESTE mun_vitoria', 'teste-mun-vitoria') returning id`, [dia])).rows[0].id;
    try {
      const fer = await ex(`${dia}T10:00`);
      expect(fer.has('Centro (PBT > 10 t)')).toBe(false);                  // "liberado aos domingos e feriados"
      expect(fer.has('Glória (PBT > 10 t, sábado)')).toBe(true);           // o inciso II não excetua feriados
    } finally { await pool.query(`delete from holidays where id = $1`, [id]); }
  });

  it('portos: janela de acesso (Vitória 7h–9h; Vila Velha 7h–9h e 17h–19h); destino no porto não exclui', async () => {
    const ex = async (d: P, when: string) => tipos(await layer.exclusions!(ctxOf(SERRA_CARAPINA, d, when, { preset: 'truck' })));
    const oito = await ex(VV_COBILANDIA, '2026-10-13T08:00');
    expect(oito.has('Acesso ao porto (7h–9h)')).toBe(true);
    expect(oito.has('Acesso ao porto (7h–9h e 17h–19h)')).toBe(true);
    const tarde = await ex(VV_COBILANDIA, '2026-10-13T18:00');
    expect(tarde.has('Acesso ao porto (7h–9h)')).toBe(false);             // 17h–19h revogada em Vitória (Dec. 18.103/2020)
    expect(tarde.has('Acesso ao porto (7h–9h e 17h–19h)')).toBe(true);
    expect((await ex(VV_COBILANDIA, '2026-10-17T08:00')).has('Acesso ao porto (7h–9h e 17h–19h)')).toBe(false);   // sábado
    expect((await ex(portoVV, '2026-10-13T08:00')).has('Acesso ao porto (7h–9h e 17h–19h)')).toBe(false);         // destino no porto
  });

  it('Terceira Ponte: custo (fator 1000) para > 2 eixos ou > 15 t; 2 eixos até 15 t livre', async () => {
    const cl = async (v: Record<string, unknown>) => (await layer.costLines!(ctxOf(VIX_PRAIA_SUA, VV_PRAIA_COSTA, '2026-10-18T03:00', v)))
      .filter((c) => c.item.type === 'Terceira Ponte (até 2 eixos e 15 t)');
    const tres = await cl({ preset: 'truck', weight_t: 14 });
    expect(tres.length).toBeGreaterThan(5);
    expect(tres.every((c) => c.factor === 1000)).toBe(true);
    expect((await cl({ preset: 'toco', weight_t: 14 })).length).toBe(0);
    expect((await cl({ preset: 'toco' })).length).toBeGreaterThan(5);     // 16 t
  });

  it('Serra: pico só nos dias úteis; Av. Central > 16 t de dia e no sábado; vias de 24 h sempre', async () => {
    const cl = async (when: string, v: Record<string, unknown> = CARRETA) =>
      tipos(await layer.costLines!(ctxOf(SERRA_LARANJEIRAS, SERRA_BARCELONA, when, v)));
    const pico = await cl('2026-10-13T18:00');
    expect([...['Pico (PBT > 23 t)', 'Pico (PBT > 16 t)', 'Av. Central (PBT > 16 t, dias úteis)', 'PBT > 23 t (24 h)'].filter((t) => pico.has(t))])
      .toEqual(['Pico (PBT > 23 t)', 'Pico (PBT > 16 t)', 'Av. Central (PBT > 16 t, dias úteis)', 'PBT > 23 t (24 h)']);
    const meioDia = await cl('2026-10-13T12:00');
    expect(meioDia.has('Pico (PBT > 23 t)')).toBe(false);
    expect(meioDia.has('Av. Central (PBT > 16 t, dias úteis)')).toBe(true);
    expect(meioDia.has('PBT > 23 t (24 h)')).toBe(true);
    const sab = await cl('2026-10-17T10:00');
    expect(sab.has('Av. Central (PBT > 16 t, sábado)')).toBe(true);
    expect(sab.has('Av. Central (PBT > 16 t, dias úteis)')).toBe(false);
    expect(sab.has('Pico (PBT > 23 t)')).toBe(false);
    const truck = await cl('2026-10-13T18:00', { preset: 'truck' });       // 23 t: só as de 16 t
    expect(truck.has('Pico (PBT > 23 t)')).toBe(false);
    expect(truck.has('Pico (PBT > 16 t)')).toBe(true);
  });

  it('mapa: zonas e vias dos 3 municípios e a Terceira Ponte; desativadas e revogada ficam fora', async () => {
    const r = await get('/api/layers/restricoes_rmsp/features?bbox=-40.45,-20.40,-40.15,-20.05&zoom=14');
    expect(r.status).toBe(200);
    const fs = r.body.features as any[];
    const munis = new Set(fs.map((f) => f.properties.municipio));
    for (const m of ['Vitória', 'Vila Velha', 'Serra', 'Vitória e Vila Velha (lei estadual)']) expect(munis.has(m), m).toBe(true);
    expect(fs.some((f) => /cegonheira|Carga e descarga|17h–19h, revogado/i.test(`${f.properties.name} ${f.properties.regime}`))).toBe(false);
    const tp = fs.find((f) => f.properties.regime === 'Terceira Ponte (até 2 eixos e 15 t)');
    expect(tp.properties.description).toBe('todos os dias o dia todo. Caminhões com mais de 2 eixos ou PBT acima de 15 t.');
    const l = (await get('/api/layers')).body.find((x: any) => x.id === LAYER);
    expect(l.runs.map((x: any) => x.source)).toEqual(expect.arrayContaining(FONTES));
    expect(l.runs.filter((x: any) => FONTES.includes(x.source)).every((x: any) => /ODbL/.test(x.license) && /9\.610/.test(x.license))).toBe(true);
  });
});

describe('rotas reais (API)', () => {
  const cruza = (r: any, g: GeoJSON.Geometry) => turf.booleanIntersects(turf.lineString(r.geometry.coordinates), g as any);
  const nossos = (r: any) => (r.avoided ?? []).filter((a: any) => a.layer === LAYER).map((a: any) => a.type);
  let pico: any;

  it('desvia: carreta de Vila Velha à Serra às 8h de terça contorna Vitória (Dec. 16.243/2015, art. 1º, IV, a)', async () => {
    const r = await route({ origin: VV_COBILANDIA, destination: SERRA_CARAPINA, vehicle: CARRETA, departure_at: '2026-10-13T08:00' });
    expect(r.status).toBe(200);
    pico = r.body;
    expect(nossos(r.body)).toContain('PBT > 23 t (pico)');
    expect(cruza(r.body, vitoriaRecuada)).toBe(false);
  });

  it('passa pela região: a mesma rota às 11h (fora do pico) atravessa Vitória e fica mais curta', async () => {
    const r = await route({ origin: VV_COBILANDIA, destination: SERRA_CARAPINA, vehicle: CARRETA, departure_at: '2026-10-13T11:00' });
    expect(r.status).toBe(200);
    expect(nossos(r.body)).not.toContain('PBT > 23 t (pico)');
    expect(cruza(r.body, vitoriaRecuada)).toBe(true);
    expect(r.body.distance_km).toBeLessThan(pico.distance_km - 3);
  });

  it('destino no Centro de Vitória às 10h: a zona do Centro não é excluída e a rota avisa', async () => {
    const r = await route({ origin: VV_COBILANDIA, destination: VIX_CENTRO, vehicle: CARRETA, departure_at: '2026-10-13T10:00' });
    expect(r.status).toBe(200);
    expect(nossos(r.body)).not.toContain('Centro (PBT > 16 t)');
    const w = r.body.warnings.find((x: any) => x.code === 'rmsp_destino_na_zona' && /Centro de Vitória/.test(x.message));
    expect(w?.message).toMatch(/seg–sex 6h–20h; sáb 6h–14h, exceto feriados.*Autorização Especial de Trânsito/);
  });

  it('Terceira Ponte: caminhão de 3 eixos e 14 t dá a volta; toco de 14 t (2 eixos) cruza', async () => {
    const dist = (r: any) => turf.pointToLineDistance(meioPonte, turf.lineString(r.geometry.coordinates), { units: 'meters' });
    const tres = await route({ origin: VIX_PRAIA_SUA, destination: VV_PRAIA_COSTA, vehicle: { preset: 'truck', weight_t: 14 }, departure_at: '2026-10-18T03:00' });
    const dois = await route({ origin: VIX_PRAIA_SUA, destination: VV_PRAIA_COSTA, vehicle: { preset: 'toco', weight_t: 14 }, departure_at: '2026-10-18T03:00' });
    expect([tres.status, dois.status]).toEqual([200, 200]);
    expect(nossos(tres.body)).toContain('Terceira Ponte (até 2 eixos e 15 t)');
    expect(dist(tres.body)).toBeGreaterThan(500);
    expect(nossos(dois.body)).not.toContain('Terceira Ponte (até 2 eixos e 15 t)');
    expect(dist(dois.body)).toBeLessThan(40);                // numa das pistas da ponte
    expect(tres.body.distance_km).toBeGreaterThan(dois.body.distance_km + 5);
  });
});
