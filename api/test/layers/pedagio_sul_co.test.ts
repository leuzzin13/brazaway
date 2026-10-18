import { beforeAll, describe, expect, it } from 'vitest';
import { pool, route, waitForStack } from '../helpers.js';
import { priceFor, tollProfile, type Tariff } from '../../src/services/tollCost.js';
import type { Vehicle } from '../../src/services/vehicle.js';

/**
 * Pedágio das concessões ESTADUAIS do RS (EGR, Rota de Santa Maria), MS (AGEMS: Way-306 e Way-112) e MT (AGER/MT),
 * fontes 'rs-estadual', 'agems' e 'agermt' da camada pedagio (importers/sources/toll_rs_estadual.py, toll_agems.py,
 * toll_agermt.py; docs/layers/pedagio_estaduais.md). Rotas reais contra a API local (API_URL); os valores esperados são
 * os das tabelas oficiais (carreta de 5 eixos, rodagem dupla). Origem e destino ficam longe das praças (uma rota que
 * começa em cima da praça lista também a cabine do OSM).
 */
const CARRETA5 = { preset: 'carreta', axle_count: 5 };
const QUARTA = '2026-10-21T10:00';
type P = { lat: number; lon: number };

async function pedagio(o: P, d: P, vehicle: Record<string, unknown> = CARRETA5) {
  const r = await route({ origin: o, destination: d, vehicle, departure_at: QUARTA });
  expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);
  const data = r.body.layers.pedagio.data;
  const por = (fonte: string) => data.pracas.filter((p: any) => p.oficial_fonte === fonte);
  return { data, por };
}
async function tariffOf(id: string): Promise<Tariff> {
  const r = await pool.query(`select props->'tarifa' as t from data_features where id = $1`, [id]);
  return r.rows[0].t as Tariff;
}

beforeAll(async () => { await waitForStack(); });

describe('MS: Way-306 e Way-112 (AGEMS, Portarias 333 e 326/2026)', () => {
  it('Costa Rica → Cassilândia (MS-306): P2 e P3 a R$ 72,00 (categoria 7, 5 eixos)', async () => {
    const { data, por } = await pedagio({ lat: -18.544, lon: -53.133 }, { lat: -19.113, lon: -51.734 });
    const p = por('agems');
    expect(p.map((x: any) => x.nome).join('|')).toMatch(/P2 Chapadão do Sul.*P3 Cassilândia/);
    for (const x of p) { expect(x.valor).toBe(72); expect(x.fonte).toBe('AGEMS'); expect(x.estimado).toBe(false); }
    const t = await tariffOf(p[0].oficial_id);
    expect(t.vigencia_inicio).toBe('2026-04-09');
    expect(data.total).toBeCloseTo(data.pracas.reduce((s: number, x: any) => s + (x.valor ?? 0), 0), 2);
  });

  it('Way-112 BR-158: P5 e P7 a R$ 70,00; praça P6 (BR-436) tem tabela própria (R$ 23,00)', async () => {
    const a = await pedagio({ lat: -19.51, lon: -51.09 }, { lat: -20.45, lon: -51.34 });
    expect(a.por('agems').map((x: any) => [x.nome.slice(0, 2), x.valor])).toEqual([['P5', 70], ['P7', 70]]);
    const b = await pedagio({ lat: -20.0948, lon: -50.95 }, { lat: -19.95, lon: -51.15 });
    expect(b.por('agems').map((x: any) => [x.nome.slice(0, 2), x.valor])).toEqual([['P6', 23]]);
  });

  it('Way-112 MS-112: Selvíria (P8) e Cassilândia II (P9)', async () => {
    const { por } = await pedagio({ lat: -20.2, lon: -51.9 }, { lat: -19.08, lon: -51.69 });
    expect(por('agems').map((x: any) => [x.nome.slice(0, 2), x.valor])).toEqual([['P8', 70], ['P9', 70]]);
  });

  it('tarifa por eixo: 3 eixos = categoria 4 (3 x R$ 14,40 = R$ 43,20), 9 eixos = R$ 129,60', async () => {
    const t = await tariffOf((await pedagio({ lat: -18.544, lon: -53.133 }, { lat: -19.113, lon: -51.734 })).por('agems')[0].oficial_id);
    const at = new Date('2026-10-21T13:00:00Z');
    const v = (n: number) => priceFor(t, tollProfile({ axle_count: n } as Vehicle, at))!;
    expect(v(3).valor).toBe(43.2);
    expect(v(9).valor).toBe(129.6);
    expect(v(10).valor).toBe(144);   // categoria 9 + categoria 1 por eixo excedente (nota 2 da portaria)
    expect(v(10).estimado).toBe(false);
  });
});

describe('MT: concessões estaduais (AGER/MT)', () => {
  it('Morro da Mesa (MT-130), Rondonópolis → Primavera do Leste: P-01 e P-02 a R$ 58,50', async () => {
    const { por } = await pedagio({ lat: -16.47, lon: -54.64 }, { lat: -15.55, lon: -54.3 });
    const p = por('agermt');
    expect(p.length).toBe(2);
    for (const x of p) { expect(x.valor).toBe(58.5); expect(x.fonte).toBe('AGER/MT'); }
  });

  it('Via Brasil MT-246: Rosário Oeste e Barra do Bugres a R$ 57,00 (TBP 11,40, DOE 31/08/2026)', async () => {
    const { por } = await pedagio({ lat: -15.25, lon: -56.1 }, { lat: -14.79, lon: -57.45 });
    const p = por('agermt');
    expect(p.map((x: any) => x.valor)).toEqual([57, 57]);
    expect(p[0].nome).toMatch(/Rosário Oeste/);
  });

  it('Via Brasil MT-320 (Colíder, Nova Canaã) e MT-100 (Alto Taquari, Alto Araguaia): R$ 58,50 por praça', async () => {
    const a = await pedagio({ lat: -11.0, lon: -55.2 }, { lat: -10.3, lon: -55.9 });
    expect(a.por('agermt').map((x: any) => x.valor)).toEqual([58.5, 58.5]);
    const b = await pedagio({ lat: -18.05, lon: -53.2 }, { lat: -17.2, lon: -53.3 });
    expect(b.por('agermt').map((x: any) => x.valor)).toEqual([58.5, 58.5]);
  });

  it('MT-320: tabela com vigência até 28/10/2026 sai estimada depois dessa data', async () => {
    const { por } = await pedagio({ lat: -11.0, lon: -55.2 }, { lat: -10.3, lon: -55.9 });
    const t = await tariffOf(por('agermt')[0].oficial_id);
    expect(t.vigencia_fim).toBe('2026-10-28');
    const v = { axle_count: 5 } as Vehicle;
    expect(priceFor(t, tollProfile(v, new Date('2026-10-21T13:00:00Z')))!.estimado).toBe(false);
    const depois = priceFor(t, tollProfile(v, new Date('2026-11-10T13:00:00Z')))!;
    expect(depois.estimado).toBe(true);
    expect(depois.observacao).toMatch(/vencida em 28\/10\/2026/);
  });
});

describe('RS: Rota de Santa Maria (RSC-287) e EGR', () => {
  it('RSC-287: P03 Candelária e P04 Paraíso do Sul a R$ 27,00 (categoria VII, 5 eixos), sem a cabine do OSM duplicada', async () => {
    const { data, por } = await pedagio({ lat: -29.731, lon: -53.5547 }, { lat: -29.6912, lon: -52.3495 });
    const p = por('rs-estadual');
    expect(p.map((x: any) => [x.nome.slice(0, 3), x.valor])).toEqual([['P04', 27], ['P03', 27]]);
    expect(data.pracas.length).toBe(2);
    expect(data.total).toBe(54);
  });

  it('EGR: Gramado e São Francisco de Paula (grupo B, 7,10 por eixo) a R$ 35,50; a data da tabela é a das imagens da EGR', async () => {
    const { por } = await pedagio({ lat: -29.3906, lon: -50.9369 }, { lat: -29.3236, lon: -50.7329 });
    const p = por('rs-estadual');
    expect(p.map((x: any) => x.valor)).toEqual([35.5, 35.5]);
    expect(p[0].fonte).toBe('EGR');
    expect(JSON.stringify(p[0])).toMatch(/05\/2022/);
    expect(p[0].nome).toMatch(/Gramado/);
  });

  it('Campo Bom (ERS-239, grupo C): R$ 3,25 por eixo, igual ao charge do OSM', async () => {
    const r = await pool.query(`select props->'tarifa' as t from data_features where layer_id='pedagio' and source='rs-estadual' and name ilike '%Campo Bom%'`);
    const t = r.rows[0].t as Tariff;
    expect(t.base).toBe(3.25);
    expect(priceFor(t, tollProfile({ axle_count: 5 } as Vehicle, new Date('2026-10-21T13:00:00Z')))!.valor).toBe(16.25);
  });
});

describe('o que ficou fora', () => {
  it('só as fontes verificadas estão no banco: 35 praças em RS, MS e MT', async () => {
    const r = await pool.query(`select source, count(*)::int as n from data_features where layer_id='pedagio' and source in ('rs-estadual','agems','agermt') group by 1 order by 1`);
    expect(Object.fromEntries(r.rows.map((x) => [x.source, x.n]))).toEqual({ agems: 9, agermt: 11, 'rs-estadual': 15 });
  });
});
