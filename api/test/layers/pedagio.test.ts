import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, route, waitForStack } from '../helpers.js';
import { multiplier, priceFor, tollProfile, type Tariff } from '../../src/services/tollCost.js';
import type { Vehicle } from '../../src/services/vehicle.js';

/**
 * Camada "pedagio" contra a API local (API_URL) e o banco/Valhalla compartilhados.
 * Rota de referência: Lapa (SP) → Jundiaí, pela Bandeirantes (praça Campo Limpo, sentido interior) ou Anhanguera.
 * Os valores esperados saem do próprio banco (tabela oficial importada), não ficam fixos no teste.
 */
const LAPA = { lat: -23.5205, lon: -46.7045 };
const JUNDIAI = { lat: -23.1857, lon: -46.8978 };
const WEEKDAY = '2026-10-14T10:00'; // quarta-feira
const VALHALLA = process.env.VALHALLA_URL ?? 'http://localhost:8002';

async function tariffOf(id: string): Promise<Tariff> {
  const r = await pool.query(`select props->'tarifa' as t from data_features where id = $1`, [id]);
  return r.rows[0].t as Tariff;
}

describe('pedágio: Lapa → Jundiaí (carreta 5 eixos)', () => {
  let body: any;
  beforeAll(async () => {
    await waitForStack();
    const r = await route({ origin: LAPA, destination: JUNDIAI, vehicle: { preset: 'carreta', axle_count: 5 }, departure_at: WEEKDAY });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    body = r.body;
  });

  it('lista as praças cobradas com valor, fonte e data', () => {
    const d = body.layers.pedagio.data;
    expect(d.veiculo.eixos_cobrados).toBe(5);
    expect(d.veiculo.rodagem).toBe('dupla');
    const cobradas = d.pracas.filter((p: any) => p.valor > 0);
    expect(cobradas.length).toBeGreaterThanOrEqual(1);
    for (const p of cobradas) {
      expect(['ARTESP', 'ANTT', 'OSM']).toContain(p.fonte);
      expect(p.data, `praça ${p.nome} sem data da tarifa`).toBeTruthy();
      expect(['SP-348', 'SP-330', 'SP-021']).toContain(p.rodovia);
    }
    // Bandeirantes ou Anhanguera: exatamente UMA praça de tronco (Campo Limpo/Caieiras ou Perus) no sentido interior
    const tronco = cobradas.filter((p: any) => p.rodovia === 'SP-348' || p.rodovia === 'SP-330');
    expect(tronco.length, JSON.stringify(cobradas)).toBe(1);
    expect(body.layers.pedagio.summary[0]).toMatch(/^Pedágio estimado: R\$ \d+,\d{2}/);
  });

  it('valor = tarifa oficial por eixo x 5 eixos e total = soma das praças', async () => {
    const d = body.layers.pedagio.data;
    let soma = 0;
    for (const p of d.pracas.filter((x: any) => x.valor != null)) {
      if (p.oficial_id && p.fonte === 'ARTESP') {
        const t = await tariffOf(p.oficial_id);
        expect(t.modelo).toBe('por_eixo');
        expect(p.valor).toBeCloseTo(t.eixo! * 5, 2);
      }
      soma += p.valor;
    }
    expect(d.total).toBeCloseTo(soma, 2);
  });

  it('compara com a alternativa sem pedágio (exclude_tolls): diferença em R$, km e min', () => {
    const alt = body.layers.pedagio.data.alternativa_sem_pedagio;
    expect(alt?.disponivel, JSON.stringify(alt)).toBe(true);
    expect(alt.delta_km).toBeGreaterThan(0);
    expect(alt.delta_min).toBeGreaterThan(0);
    expect(alt.economia).toBe(body.layers.pedagio.data.total);
    expect(alt.pedagio_na_ponta).toBe(false);
    expect(body.layers.pedagio.summary.join('\n')).toMatch(/Sem pedágio: \+\d+,\d km e \+\d+ min para economizar R\$/);
  });

  it('não bloqueia nem penaliza nada (só anota)', () => {
    expect(body.avoided.filter((a: any) => a.layer === 'pedagio')).toEqual([]);
    expect(body.warnings.filter((w: any) => w.layer === 'pedagio' && w.severity === 'danger')).toEqual([]);
  });

  it('eixos suspensos (caminhão vazio) não pagam: 5 − 2 = 3 eixos', async () => {
    const r = await route({ origin: LAPA, destination: JUNDIAI, vehicle: { preset: 'carreta', axle_count: 5, suspended_axles: 2 }, departure_at: WEEKDAY });
    expect(r.status).toBe(200);
    const d = r.body.layers.pedagio.data;
    expect(d.veiculo.eixos_cobrados).toBe(3);
    expect(d.total).toBeCloseTo((body.layers.pedagio.data.total * 3) / 5, 2);
    expect(r.body.layers.pedagio.summary.join('\n')).toMatch(/Lei 13\.103\/2015, art\. 17/);
  });
});

describe('pedágio: sentido de cobrança (Jundiaí → Lapa)', () => {
  it('na volta cobra a praça do outro sentido, não a da ida', async () => {
    await waitForStack();
    const [ida, volta] = await Promise.all([
      route({ origin: LAPA, destination: JUNDIAI, vehicle: { preset: 'carreta', axle_count: 5 }, departure_at: WEEKDAY }),
      route({ origin: JUNDIAI, destination: LAPA, vehicle: { preset: 'carreta', axle_count: 5 }, departure_at: WEEKDAY }),
    ]);
    expect(volta.status, JSON.stringify(volta.body)).toBe(200);
    const tronco = (b: any) => b.layers.pedagio.data.pracas.filter((p: any) => p.valor > 0 && (p.rodovia === 'SP-348' || p.rodovia === 'SP-330'));
    const ti = tronco(ida.body), tv = tronco(volta.body);
    expect(tv.length).toBe(1);
    // Bandeirantes: Campo Limpo (km 39) cobra no sentido interior e Caieiras (km 36) no sentido capital.
    // Se as duas viagens usam a SP-348, a praça (nó OSM) tem de ser outra.
    if (ti[0].rodovia === 'SP-348' && tv[0].rodovia === 'SP-348') {
      expect(tv[0].osm_id).not.toBe(ti[0].osm_id);
      expect(tv[0].oficial_id).not.toBe(ti[0].oficial_id);
    }
  });
});

describe('pedágio: rota urbana sem pedágio', () => {
  it('não lista praça nem calcula alternativa', async () => {
    const r = await route({ origin: { lat: -23.5205, lon: -46.7045 }, destination: { lat: -23.5660, lon: -46.6920 }, vehicle: { preset: 'vuc' }, departure_at: WEEKDAY });
    expect(r.status).toBe(200);
    const l = r.body.layers.pedagio;
    expect(l.data.pracas).toEqual([]);
    expect(l.data.total).toBe(0);
    expect(l.data.alternativa_sem_pedagio).toBeNull();
    expect(l.summary[0]).toMatch(/Nenhuma praça/);
  });
});

describe('Valhalla: opção que evita pedágio (premissa da camada)', () => {
  const body = (opts: Record<string, unknown>) => ({
    locations: [{ lat: LAPA.lat, lon: LAPA.lon }, { lat: JUNDIAI.lat, lon: JUNDIAI.lon }],
    costing: 'truck', costing_options: { truck: { axle_count: 5, height: 4.4, weight: 41.5, length: 18.6, ...opts } }, units: 'kilometers',
  });
  const post = async (b: unknown) => (await (await fetch(`${VALHALLA}/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json()) as any;

  it('use_tolls=0 ainda passa no pedágio; exclude_tolls evita', async () => {
    const [def, use0, excl] = await Promise.all([post(body({})), post(body({ use_tolls: 0 })), post(body({ exclude_tolls: true }))]);
    expect(def.trip.summary.has_toll).toBe(true);
    expect(use0.trip.summary.has_toll).toBe(true);
    expect(excl.trip.summary.has_toll).toBe(false);
  });
});

describe('regras de preço (unitário)', () => {
  const v = (o: Partial<Vehicle>): Vehicle => ({ id: 't', label: 't', height_m: 4, width_m: 2.6, length_m: 18, weight_t: 40, axle_load_t: 10, axle_count: 5, hazmat: false, is_vuc: false, ...o });
  const WED = new Date('2026-10-14T13:00:00Z');
  const SAT = new Date('2026-10-17T13:00:00Z');
  const antt: Tariff = {
    modelo: 'categorias', fonte: 'ANTT', data: '2025-08-29', base: 4.8, max_eixos_tabela: 6,
    categorias: [
      { cat: 1, eixos: 2, rodagem: 'simples', mult: 1, valor: 4.8, valor_fds: 7.9 },
      { cat: 2, eixos: 2, rodagem: 'dupla', mult: 2, valor: 9.6, valor_fds: 15.8 },
      { cat: 3, eixos: 3, rodagem: 'simples', mult: 1.5, valor: 7.2, valor_fds: 11.85 },
      { cat: 4, eixos: 3, rodagem: 'dupla', mult: 3, valor: 14.4, valor_fds: 23.7 },
      { cat: 7, eixos: 5, rodagem: 'dupla', mult: 5, valor: 24.0, valor_fds: 39.5 },
      { cat: 8, eixos: 6, rodagem: 'dupla', mult: 6, valor: 28.8, valor_fds: 47.4 },
    ],
  };

  it('multiplicador ANTT/ARTESP', () => {
    expect(multiplier(2, true)).toBe(2);
    expect(multiplier(7, true)).toBe(7);
    expect(multiplier(2, false)).toBe(1);
    expect(multiplier(3, false)).toBe(1.5);
    expect(multiplier(4, false)).toBe(2);
  });

  it('eixos cobrados = eixos − suspensos, mínimo 2; rodagem dupla por padrão', () => {
    expect(tollProfile(v({ axle_count: 6, suspended_axles: 2 }), WED).eixos_cobrados).toBe(4);
    expect(tollProfile(v({ axle_count: 3, suspended_axles: 3 }), WED).eixos_cobrados).toBe(2);
    expect(tollProfile(v({}), WED).rodagem).toBe('dupla');
    expect(tollProfile(v({ dual_wheels: false }), WED).rodagem).toBe('simples');
    expect(tollProfile(v({}), SAT).fim_de_semana).toBe(true);
    expect(tollProfile(v({}), WED).fim_de_semana).toBe(false);
  });

  it('categoria exata, fim de semana e extrapolação acima da tabela', () => {
    expect(priceFor(antt, tollProfile(v({}), WED))!.valor).toBe(24.0);
    expect(priceFor(antt, tollProfile(v({}), SAT))!.valor).toBe(39.5);
    expect(priceFor(antt, tollProfile(v({ axle_count: 3, dual_wheels: false }), WED))!.valor).toBe(7.2);
    const nove = priceFor(antt, tollProfile(v({ axle_count: 9 }), WED))!;
    expect(nove.estimado).toBe(true);
    expect(nove.valor).toBeCloseTo(4.8 * 9, 2);
  });

  it('ARTESP por eixo, TAG (AVI) e OSM como reserva', () => {
    expect(priceFor({ modelo: 'por_eixo', fonte: 'ARTESP', eixo: 14.5 }, tollProfile(v({}), WED))!.valor).toBe(72.5);
    const vp: Tariff = { modelo: 'categorias', fonte: 'ARTESP', base: 18.3, categorias: [{ cat: 5, eixos: 5, rodagem: 'dupla', mult: 5, valor: 91.6, valor_tag: 87.02 }] };
    expect(priceFor(vp, tollProfile(v({ has_toll_tag: true }), WED))!.valor).toBe(87.02);
    expect(priceFor(vp, tollProfile(v({}), WED))!.valor).toBe(91.6);
    const osm: Tariff = { modelo: 'osm_charge', fonte: 'OSM', data: '2026-07-01', charge: { hgv_axle: { weekday: 1.05, weekend: 1.76 } } };
    const pw = priceFor(osm, tollProfile(v({}), WED))!;
    expect(pw.valor).toBeCloseTo(5.25, 2);
    expect(pw.estimado).toBe(true);
    expect(priceFor(osm, tollProfile(v({}), SAT))!.valor).toBeCloseTo(8.8, 2);
  });
});

afterAll(async () => { await pool.end(); });
