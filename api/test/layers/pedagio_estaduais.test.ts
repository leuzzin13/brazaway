import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, route, waitForStack } from '../helpers.js';
import { inTariffWindow, priceFor, tollProfile, type Tariff, type TariffWindow } from '../../src/services/tollCost.js';
import type { Vehicle } from '../../src/services/vehicle.js';

/**
 * Pedágio das concessões ESTADUAIS (RJ: AGETRANSP; MG: ARTEMIG) e MUNICIPAIS (Rio, Pirapetinga), fontes 'agetransp',
 * 'artemig' e 'municipais' da camada pedagio (importers/sources/toll_agetransp.py, toll_artemig.py, toll_municipais.py;
 * docs/layers/pedagio_estaduais.md). Rotas reais contra a API local (API_URL) e o Valhalla/banco compartilhados.
 * Os valores esperados saem da tarifa gravada no banco (categoria de 5 eixos), não ficam fixos no teste.
 */
const CARRETA5 = { preset: 'carreta', axle_count: 5 };
const QUARTA = '2026-10-14T10:00';
const SEXTA_TARDE = '2026-10-16T15:00';
const RIO_BONITO = { lat: -22.7085, lon: -42.609 };
const CABO_FRIO = { lat: -22.8894, lon: -42.0286 };

async function tariffOf(id: string): Promise<Tariff> {
  const r = await pool.query(`select props->'tarifa' as t from data_features where id = $1`, [id]);
  return r.rows[0].t as Tariff;
}
const cat5 = (t: Tariff) => t.categorias!.find((c) => c.rodagem === 'dupla' && (c.eixos === 5 || (c.eixos <= 5 && (c.eixos_ate ?? 0) >= 5)))!;

async function pedagio(o: { lat: number; lon: number }, d: { lat: number; lon: number }, at = QUARTA, vehicle: Record<string, unknown> = CARRETA5) {
  const r = await route({ origin: o, destination: d, vehicle, departure_at: at });
  expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(200);
  return { body: r.body, d: r.body.layers.pedagio.data, warnings: (r.body.warnings as any[]).filter((w) => w.layer === 'pedagio') };
}

beforeAll(async () => { await waitForStack(); });

describe('RJ-124 Via Lagos (AGETRANSP, Deliberação 1630/2025): Rio Bonito → Cabo Frio, carreta 5 eixos', () => {
  it('quarta 10h: cobra a TBP da AGETRANSP (não a TBA de fim de semana do OSM)', async () => {
    const { d } = await pedagio(RIO_BONITO, CABO_FRIO);
    const vl = d.pracas.find((p: any) => p.oficial_fonte === 'agetransp' && /Via Lagos/.test(p.nome));
    expect(vl, JSON.stringify(d.pracas)).toBeTruthy();
    expect(vl.fonte).toBe('AGETRANSP');
    const t = await tariffOf(vl.oficial_id);
    expect(t.janela_fds?.semana).toEqual({ de: [5, 12], ate: [1, 12] });
    const c = cat5(t);
    expect(vl.valor).toBe(c.valor);            // R$ 92,00 na tabela de 01/08/2025
    expect(vl.valor).not.toBe(c.valor_fds);    // antes: R$ 153,00 numa quarta (TBA do OSM)
    expect(vl.janela_alternativa).toBe(false);
    expect(vl.passagem_estimada).toMatch(/^quarta 14\/10 1\d:\d\d$/);
    expect(d.total).toBeCloseTo(d.pracas.reduce((s: number, p: any) => s + (p.valor ?? 0), 0), 2);
  });

  it('sexta 15h (depois das 12h): TBA, com o horário estimado de passagem', async () => {
    const { d, warnings } = await pedagio(RIO_BONITO, CABO_FRIO, SEXTA_TARDE);
    const vl = d.pracas.find((p: any) => p.oficial_fonte === 'agetransp');
    const t = await tariffOf(vl.oficial_id);
    expect(vl.valor).toBe(cat5(t).valor_fds);  // R$ 153,00
    expect(vl.janela_alternativa).toBe(true);
    expect(vl.regra).toMatch(/TBA/);
    // o OSM só sabe "dia útil x fim de semana": sem aviso de divergência quando o período é outro
    expect(warnings.some((w) => w.code === 'toll_tariff_divergence')).toBe(false);
  });

  it('a alternativa sem pedágio desvia da praça (via sem toll=yes no mapa): não é "mesmos pontos"', async () => {
    const { d } = await pedagio(RIO_BONITO, CABO_FRIO);
    const alt = d.alternativa_sem_pedagio;
    expect(alt, JSON.stringify(alt)).toBeTruthy();
    expect(alt.motivo).not.toBe('mesmos_pontos');
  });
});

describe('RJ-116 Rota 116 (AGETRANSP, Deliberação 1631/2025): estrutura não linear', () => {
  it('Itaboraí → Nova Friburgo, 5 eixos: 4 x TBP por praça (categorias III a VI), sem aviso de divergência com o OSM', async () => {
    const { d, warnings } = await pedagio({ lat: -22.744, lon: -42.859 }, { lat: -22.282, lon: -42.531 });
    const r116 = d.pracas.filter((p: any) => p.oficial_fonte === 'agetransp');
    expect(r116.length, JSON.stringify(d.pracas)).toBeGreaterThanOrEqual(2);
    for (const p of r116) {
      const t = await tariffOf(p.oficial_id);
      expect(t.nao_linear).toBe(true);
      expect(p.valor).toBeCloseTo(4 * t.base!, 2);   // R$ 38,40 (o OSM dava 12,80 x 5 = R$ 64,00)
      expect(p.regra).toMatch(/3 a 6 eixos/);
    }
    expect(warnings.some((w) => w.code === 'toll_tariff_divergence')).toBe(false);
  });

  it('9 eixos: categoria VIII (8 eixos) + 1 eixo adicional = 9 x TBP, sem estimativa pelo multiplicador', async () => {
    const { d } = await pedagio({ lat: -22.744, lon: -42.859 }, { lat: -22.282, lon: -42.531 }, QUARTA, { preset: 'carreta', axle_count: 9 });
    const p = d.pracas.find((x: any) => x.oficial_fonte === 'agetransp');
    const t = await tariffOf(p.oficial_id);
    expect(p.valor).toBeCloseTo(9 * t.base!, 2);
    expect(p.regra).toMatch(/eixo\(s\) adicional/);
  });
});

describe('MG: uma rota por concessão estadual (ARTEMIG), carreta 5 eixos', () => {
  const casos: { nome: string; conc: string; o: { lat: number; lon: number }; d: { lat: number; lon: number }; min: number }[] = [
    { nome: 'Lote 1 Triângulo (EPR Triângulo): Uberlândia → Araxá pela BR-452', conc: 'mg_lote1_triangulo', o: { lat: -18.92, lon: -48.28 }, d: { lat: -19.59, lon: -46.94 }, min: 2 },
    { nome: 'Lote 2 Sul de Minas (EPR Sul de Minas): Poços de Caldas → BR-459', conc: 'mg_lote2_sul_de_minas', o: { lat: -21.787, lon: -46.561 }, d: { lat: -22.23, lon: -45.937 }, min: 2 },
    { nome: 'Lote 3 Varginha-Furnas (EPR Vias do Café): Lavras → Boa Esperança pela BR-265', conc: 'mg_lote3_varginha_furnas', o: { lat: -21.245, lon: -45.0 }, d: { lat: -21.09, lon: -45.56 }, min: 2 },
    { nome: 'MG-050 (Via Nascentes): Itaúna → Formiga', conc: 'mg_mg050_via_nascentes', o: { lat: -20.075, lon: -44.576 }, d: { lat: -20.46, lon: -45.43 }, min: 1 },
    { nome: 'BR-135 (Ecovias Norte Minas): Montes Claros → Bocaiúva', conc: 'mg_br135_ecovias_norte_minas', o: { lat: -16.73, lon: -43.86 }, d: { lat: -17.11, lon: -43.81 }, min: 1 },
  ];
  for (const c of casos) {
    it(c.nome, async () => {
      const { d } = await pedagio(c.o, c.d);
      const mg = d.pracas.filter((p: any) => p.oficial_fonte === 'artemig');
      expect(mg.length, JSON.stringify(d.pracas.map((p: any) => [p.nome, p.fonte, p.valor]))).toBeGreaterThanOrEqual(c.min);
      for (const p of mg) {
        const q = await pool.query(`select props->>'concessao' conc, props->'tarifa' t from data_features where id = $1`, [p.oficial_id]);
        expect(q.rows[0].conc).toBe(c.conc);
        expect(p.fonte).toBe('ARTEMIG');
        expect(p.valor).toBe(cat5(q.rows[0].t).valor);
        expect(p.estimado, p.observacao).toBe(false);
      }
    });
  }

  it('Lote 2, pórtico free flow da MG-459 (Monte Sião), sem nó no OSM: cobrado pela posição oficial e com aviso de free flow', async () => {
    const { d, warnings } = await pedagio({ lat: -22.283, lon: -46.37 }, { lat: -22.43, lon: -46.57 });
    const ff = d.pracas.find((p: any) => p.deteccao === 'oficial_sem_osm');
    expect(ff, JSON.stringify(d.pracas)).toBeTruthy();
    expect(ff.tipo).toBe('portico');
    expect(ff.free_flow).toBe(true);
    const t = await tariffOf(ff.oficial_id);
    expect(ff.valor).toBe(cat5(t).valor);  // subcláusula 3.5 do 2º Termo Aditivo: mesma tarifa das praças
    const w = warnings.find((x) => x.code === 'toll_free_flow');
    expect(w?.message).toMatch(/30 dias/);
  });

  it('reajuste do Lote 2 suspenso pelo TCE-MG fica registrado e não é aplicado (TBP R$ 10,10)', async () => {
    const q = await pool.query(`select props->'tarifa'->>'base' base, props->'reajuste_suspenso' r from data_features
      where layer_id = 'pedagio' and source = 'artemig' and props->>'concessao' = 'mg_lote2_sul_de_minas'`);
    expect(q.rows.length).toBe(8);
    for (const row of q.rows) {
      expect(Number(row.base)).toBe(10.1);
      expect(row.r.status).toBe('suspenso');
      expect(row.r.aplicado).toBe(false);
    }
  });
});

describe('registros inativos (confiança baixa ou cobrança não iniciada)', () => {
  it('ficam no banco sem tarifa aplicável e com o motivo', async () => {
    const q = await pool.query(`select source, props->>'concessao' conc, props->'tarifa' t, props->>'motivo_inativo' m from data_features
      where layer_id = 'pedagio' and source in ('agetransp', 'artemig', 'municipais') and props->>'ativo' = 'false'`);
    const concs = new Set(q.rows.map((r: any) => r.conc));
    expect(concs.has('mg_crp_pirapetinga')).toBe(true);
    expect(concs.has('mg_lote7_via_liberdade')).toBe(true);
    for (const r of q.rows) {
      expect(r.t).toBeNull();
      expect(r.m).toBeTruthy();
    }
  });

  it('CRP Pirapetinga (cobrança contestada): o valor segue o do OSM (estimado) e a rota avisa da situação incerta', async () => {
    const { d, warnings } = await pedagio({ lat: -21.7, lon: -42.3 }, { lat: -21.6, lon: -42.45 });
    const p = d.pracas.find((x: any) => /Pirapetinga/.test(x.nome));
    expect(p, JSON.stringify(d.pracas)).toBeTruthy();
    expect(p.oficial_id).toBeNull();
    expect(p.fonte).toBe('OSM');
    expect(p.registro_inativo?.fonte).toBe('municipais');
    expect(warnings.some((w) => w.code === 'toll_status_uncertain')).toBe(true);
  });
});

describe('regras de preço das tabelas estaduais (unitário)', () => {
  const v = (o: Partial<Vehicle>): Vehicle => ({ id: 't', label: 't', height_m: 4, width_m: 2.6, length_m: 18, weight_t: 40, axle_load_t: 10, axle_count: 5, hazmat: false, is_vuc: false, ...o });
  const tba: TariffWindow = { rotulo: 'TBA', semana: { de: [5, 12], ate: [1, 12] }, feriados_nacionais: { vespera_desde_h: 12, dia_seguinte_ate_h: 12 } };
  const feriados = ['2026-10-12', '2026-11-20'];
  const at = (iso: string) => new Date(iso);

  it('janela da TBA: sexta 12h a segunda 12h e véspera de feriado nacional 12h ao dia seguinte 12h', () => {
    expect(inTariffWindow(tba, at('2026-10-16T14:59:00Z'), feriados)).toBe(false); // sexta 11h59 (UTC−3)
    expect(inTariffWindow(tba, at('2026-10-16T15:00:00Z'), feriados)).toBe(true);  // sexta 12h00
    expect(inTariffWindow(tba, at('2026-10-18T13:00:00Z'), feriados)).toBe(true);  // domingo
    expect(inTariffWindow(tba, at('2026-10-19T14:59:00Z'), feriados)).toBe(true);  // segunda 11h59
    expect(inTariffWindow(tba, at('2026-10-19T15:01:00Z'), feriados)).toBe(false); // segunda 12h01
    expect(inTariffWindow(tba, at('2026-10-13T13:00:00Z'), feriados)).toBe(true);  // terça 10h, dia seguinte ao feriado de 12/10
    expect(inTariffWindow(tba, at('2026-10-13T16:00:00Z'), feriados)).toBe(false); // terça 13h
    expect(inTariffWindow(tba, at('2026-11-19T14:00:00Z'), feriados)).toBe(false); // quinta 11h, véspera do 20/11
    expect(inTariffWindow(tba, at('2026-11-19T16:00:00Z'), feriados)).toBe(true);  // quinta 13h, véspera do 20/11
  });

  const vialagos: Tariff = {
    modelo: 'categorias', fonte: 'AGETRANSP', data: '2025-08-01', base: 18.4, max_eixos_tabela: 6, janela_fds: tba,
    categorias: [{ cat: 7, eixos: 5, rodagem: 'dupla', mult: 5, valor: 92, valor_fds: 153 }, { cat: 8, eixos: 6, rodagem: 'dupla', mult: 6, valor: 110.4, valor_fds: 183.6 }],
  };
  it('a TBA vale pelo horário de PASSAGEM (não pela data de saída)', () => {
    const prof = { ...tollProfile(v({}), at('2026-10-16T14:00:00Z')), feriados_nacionais: feriados }; // sai sexta 11h
    expect(priceFor(vialagos, prof)!.valor).toBe(92);
    expect(priceFor(vialagos, prof, at('2026-10-16T15:30:00Z'))!.valor).toBe(153); // passa 12h30
    const sete = priceFor(vialagos, prof, at('2026-10-16T15:30:00Z'))!;
    expect(sete.janela_alternativa).toBe(true);
  });

  it('faixa de eixos ("3 a 6", "7 ou mais"), eixo adicional oficial e tabela não linear sem extrapolação', () => {
    const wed = at('2026-10-14T13:00:00Z');
    const r116: Tariff = { modelo: 'categorias', fonte: 'AGETRANSP', base: 9.6, max_eixos_tabela: 8, eixo_adicional: 9.6, nao_linear: true, categorias: [
      { cat: 1, eixos: 2, eixos_ate: 4, rodagem: 'simples', mult: 1, valor: 9.6 },
      { cat: 3, eixos: 3, eixos_ate: 6, rodagem: 'dupla', mult: 4, valor: 38.4 },
      { cat: 8, eixos: 8, rodagem: 'dupla', mult: 8, valor: 76.8 },
    ] };
    expect(priceFor(r116, tollProfile(v({ axle_count: 3 }), wed))!.valor).toBe(38.4);
    expect(priceFor(r116, tollProfile(v({ axle_count: 6 }), wed))!.valor).toBe(38.4);
    expect(priceFor(r116, tollProfile(v({ axle_count: 4, dual_wheels: false }), wed))!.valor).toBe(9.6);
    const dez = priceFor(r116, tollProfile(v({ axle_count: 10 }), wed))!;
    expect(dez.valor).toBeCloseTo(96, 2);
    expect(dez.estimado).toBe(false);
    const lamsa: Tariff = { modelo: 'categorias', fonte: 'X', base: 4, nao_linear: true, categorias: [
      { cat: 5, eixos: 5, rodagem: 'dupla', mult: 4.025, valor: 16.1 }, { cat: 10, eixos: 7, eixos_ate: 99, rodagem: 'dupla', mult: 6.025, valor: 24.1 },
    ] };
    expect(priceFor(lamsa, tollProfile(v({ axle_count: 9 }), wed))!.valor).toBe(24.1);
    const transol: Tariff = { modelo: 'categorias', fonte: 'X', base: 9.95, max_eixos_tabela: 7, nao_linear: true, categorias: [
      { cat: 9, eixos: 7, rodagem: 'dupla', mult: 6, valor: 59.7 },
    ] };
    expect(priceFor(transol, tollProfile(v({ axle_count: 9 }), wed))).toBeNull();
  });

  it('OSM: valor de fim de semana NÃO serve de reserva em dia útil', () => {
    const osm: Tariff = { modelo: 'osm_charge', fonte: 'OSM', charge: { hgv_axle: { weekend: 30.6 }, motorcar: { weekday: 18.4, weekend: 30.6 } } };
    const wed = priceFor(osm, tollProfile(v({}), at('2026-10-14T13:00:00Z')))!;
    expect(wed.valor).toBeCloseTo(18.4 * 5, 2); // carro x multiplicador, não 30,60 x 5
    expect(priceFor(osm, tollProfile(v({}), at('2026-10-17T13:00:00Z')))!.valor).toBeCloseTo(153, 2);
  });
});

afterAll(async () => { await pool.end(); });
