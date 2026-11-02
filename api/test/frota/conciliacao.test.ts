import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signJwt } from '../../src/frota/auth.js';
import { pool } from '../helpers.js';

/**
 * Conferência do diesel por placa (GET /api/frota/conciliacao-diesel). Precisa de uma instância da API (API_URL) e do
 * Postgres com as migrations da Frota (0300-0404):
 *   API_URL=http://localhost:3602 npx vitest run test/frota/conciliacao.test.ts
 * Cria empresas, usuários, veículos, viagens concluídas (km em trips.distance_m, a mesma fonte do consumo médio) e
 * abastecimentos com ids próprios (prefixo c0c1) no beforeAll, como superusuário, e apaga tudo no afterAll.
 */
const BASE = process.env.API_URL ?? 'http://localhost:3100';

const id = (n: number) => `c0c10000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CO_A = id(1), CO_B = id(2);
const OWNER_A = id(11), MOT_A1 = id(12), MOT_A2 = id(13), OUTSIDER = id(14), OWNER_B = id(21), MOT_B = id(22);
const ALL_USERS = [OWNER_A, MOT_A1, MOT_A2, OUTSIDER, OWNER_B, MOT_B];
// VEH1 carreta com consumo cadastrado (desvio); VEH2 toco sem cadastro (fora do plano); VEH3 com hodômetro;
// VEH4 rodou sem abastecer; VEH5 comprou menos do que rodou; VEHB é da outra empresa
const VEH1 = id(101), VEH2 = id(102), VEH3 = id(103), VEH4 = id(104), VEH5 = id(105), VEHB = id(201);
const T1A = id(301), T1B = id(302), T2 = id(303), T3 = id(304), T4 = id(305), T5 = id(306), TB = id(401);
const CNPJ_PLANO = '11111111000111', CNPJ_FORA = '22222222000122', CNPJ_CONV = '33333333000133', CNPJ_CONV_INATIVO = '44444444000144';

const tok = (sub: string) => signJwt({ sub, role: 'authenticated' });
const T = { ownerA: tok(OWNER_A), motA1: tok(MOT_A1), outsider: tok(OUTSIDER), ownerB: tok(OWNER_B) };

async function call(path: string, token: string) {
  const res = await fetch(`${BASE}/api/frota${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

async function wipe() {
  await pool.query('delete from companies where id = any($1::uuid[])', [[CO_A, CO_B]]);
  await pool.query('delete from auth.users where id = any($1::uuid[])', [ALL_USERS]);
}

/** viagem concluída: km em distance_m; `fim` = há quanto tempo terminou (intervalo do Postgres) */
const viagem = (tid: string, co: string, veh: string, driver: string | null, km: number, fim: string, plano: object | null = null) =>
  pool.query(
    `insert into trips (id, company_id, vehicle_id, driver_id, status, title, started_at, ended_at, distance_m, plano_abastecimento)
     values ($1, $2, $3, $4, 'concluida', 'Conciliação', now() - $6::interval - interval '20 hours', now() - $6::interval, $5, $7::jsonb)`,
    [tid, co, veh, driver, km * 1000, fim, plano ? JSON.stringify(plano) : null]);

/** abastecimento: `quando` = há quanto tempo (intervalo do Postgres); preço em R$/L */
const abastece = (o: { co?: string; veh?: string | null; driver?: string | null; trip?: string | null; quando: string; litros: number; preco?: number;
                       cnpj?: string | null; odometro?: number; combustivel?: string }) =>
  pool.query(
    `insert into abastecimentos (company_id, vehicle_id, driver_id, trip_id, ocorrido_em, litros, valor_cents, posto_cnpj, odometro_km, combustivel, origem)
     values ($1, $2, $3, $4, now() - $5::interval, $6, $7, $8, $9, $10, 'gestor')`,
    [o.co ?? CO_A, o.veh ?? null, o.driver ?? null, o.trip ?? null, o.quando, o.litros, o.preco === undefined ? null : Math.round(o.preco * o.litros * 100),
     o.cnpj ?? null, o.odometro ?? null, o.combustivel ?? 's10']);

beforeAll(async () => {
  await wipe();
  await pool.query(`insert into auth.users (id, email) select u, 'conc-test-' || right(u::text, 4) || '@teste' from unnest($1::uuid[]) u`, [ALL_USERS]);
  await pool.query(`insert into companies (id, name) values ($1, 'Conciliação Teste A'), ($2, 'Conciliação Teste B')`, [CO_A, CO_B]);
  await pool.query(
    `insert into vehicles (id, company_id, plate, preset, consumo_km_l) values
       ($1, $6, 'CCA1C01', 'carreta_5e', 2.5), ($2, $6, 'CCA1C02', 'toco', null), ($3, $6, 'CCA1C03', 'truck', 3.0),
       ($4, $6, 'CCA1C04', 'truck', null), ($5, $6, 'CCA1C05', 'truck', 3.0), ($7, $8, 'CCB1C01', 'carreta_5e', 2.0)`,
    [VEH1, VEH2, VEH3, VEH4, VEH5, CO_A, VEHB, CO_B]);
  await pool.query(
    `insert into company_members (company_id, user_id, role, display_name, default_vehicle_id) values
       ($1, $3, 'owner', 'Dono A', null), ($1, $4, 'motorista', 'Motorista A1', $8), ($1, $5, 'motorista', 'Motorista A2', $9),
       ($2, $6, 'owner', 'Dono B', null), ($2, $7, 'motorista', 'Motorista B', $10)`,
    [CO_A, CO_B, OWNER_A, MOT_A1, MOT_A2, OWNER_B, MOT_B, VEH1, VEH2, VEHB]);
  await pool.query(
    `insert into postos_conveniados (company_id, cnpj, nome, preco_rs_l, ativo) values
       ($1, $2, 'Rede conveniada', 6.0, true), ($1, $3, 'Convênio encerrado', 6.0, false)`, [CO_A, CNPJ_CONV, CNPJ_CONV_INATIVO]);

  // VEH1 (2,5 km/L cadastrado): 1.000 km → 400 L esperados; comprou 600 L a R$ 6,00 → +200 L (50%)
  await viagem(T1A, CO_A, VEH1, MOT_A1, 500, '3 days');
  await viagem(T1B, CO_A, VEH1, MOT_A1, 500, '2 days');
  await abastece({ veh: VEH1, driver: MOT_A1, trip: T1A, quando: '3 days 10 hours', litros: 200, preco: 6, cnpj: CNPJ_CONV });
  await abastece({ veh: VEH1, driver: MOT_A1, trip: T1B, quando: '2 days 10 hours', litros: 200, preco: 6, cnpj: CNPJ_CONV });
  // sem placa e sem viagem: entra no veículo padrão do motorista
  await abastece({ driver: MOT_A1, quando: '1 day', litros: 200, preco: 6, cnpj: CNPJ_CONV });
  await abastece({ veh: VEH1, driver: MOT_A1, quando: '1 day', litros: 50, preco: 4, combustivel: 'arla32' });      // ARLA não conta
  await abastece({ veh: VEH1, driver: MOT_A1, quando: '40 days', litros: 100, preco: 6, cnpj: CNPJ_CONV });          // fora dos 30 dias

  // VEH2 (toco sem cadastro: 4,5 km/L do tipo): 900 km → 200 L; viagem com plano (parada no CNPJ_PLANO a R$ 6,00)
  await viagem(T2, CO_A, VEH2, MOT_A2, 900, '5 days', {
    paradas: [{ km_rota: 300, posto: 'Posto do Plano', cnpj: CNPJ_PLANO, litros: 150, preco_rs_l: 6.0 }], preco_medio_rota_rs_l: 6.3,
  });
  const naT2 = { veh: VEH2, driver: MOT_A2, trip: T2 };
  await abastece({ ...naT2, quando: '5 days 15 hours', litros: 100, preco: 6.5, cnpj: CNPJ_FORA });            // fora: (6,50 − 6,00) × 100 = 50
  await abastece({ ...naT2, quando: '5 days 12 hours', litros: 60, preco: 6.8, cnpj: CNPJ_CONV });             // conveniado: não é fora
  await abastece({ ...naT2, quando: '5 days 10 hours', litros: 50, preco: 6.0, cnpj: CNPJ_PLANO });            // parada do plano
  await abastece({ ...naT2, quando: '5 days 8 hours', litros: 10, preco: 6.5 });                                // sem CNPJ
  await abastece({ ...naT2, quando: '5 days 6 hours', litros: 20, preco: 6.2, cnpj: CNPJ_CONV_INATIVO });      // convênio inativo: fora, 0,20 × 20 = 4

  // VEH3 (3 km/L): hodômetro 100.000 → 101.200 = 1.200 km → 400 L; conferidos os 410 L depois da 1ª leitura
  await viagem(T3, CO_A, VEH3, null, 50, '10 days');
  await abastece({ veh: VEH3, quando: '20 days', litros: 300, preco: 6, cnpj: CNPJ_CONV, odometro: 100000 });
  await abastece({ veh: VEH3, quando: '12 days', litros: 200, preco: 6, cnpj: CNPJ_CONV, odometro: 100600 });
  await abastece({ veh: VEH3, quando: '4 days', litros: 210, preco: 6, cnpj: CNPJ_CONV, odometro: 101200 });

  // VEH4: 400 km e nenhum abastecimento; VEH5 (3 km/L): 1.500 km → 500 L, comprou 300 L
  await viagem(T4, CO_A, VEH4, null, 400, '6 days');
  await viagem(T5, CO_A, VEH5, null, 1500, '7 days');
  await abastece({ veh: VEH5, quando: '7 days 5 hours', litros: 300, preco: 6, cnpj: CNPJ_CONV });

  // empresa B: 800 km a 2 km/L → 400 L; comprou 1.000 L
  await viagem(TB, CO_B, VEHB, MOT_B, 800, '2 days');
  await abastece({ co: CO_B, veh: VEHB, driver: MOT_B, trip: TB, quando: '2 days 5 hours', litros: 1000, preco: 6 });
});

afterAll(async () => { await wipe(); });

const tipos = (x: { alertas: { tipo: string }[] }) => x.alertas.map((a) => a.tipo).sort();

describe('conferência do diesel: permissão e isolamento', () => {
  it('motorista e usuário sem empresa → 403', async () => {
    expect((await call('/conciliacao-diesel', T.motA1)).status).toBe(403);
    expect((await call('/conciliacao-diesel', T.outsider)).status).toBe(403);
  });

  it('entrada inválida → 422', async () => {
    expect((await call('/conciliacao-diesel?dias=3', T.ownerA)).status).toBe(422);
    expect((await call('/conciliacao-diesel?dias=400', T.ownerA)).status).toBe(422);
    expect((await call('/conciliacao-diesel?tolerancia_pct=abc', T.ownerA)).status).toBe(422);
    expect((await call('/conciliacao-diesel?vehicle_id=xyz', T.ownerA)).status).toBe(422);
  });

  it('outra empresa não vê as placas, os motoristas nem os números', async () => {
    const b = await call('/conciliacao-diesel', T.ownerB);
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect(b.body.veiculos.map((v: any) => v.plate)).toEqual(['CCB1C01']);
    expect(b.body.por_motorista.map((m: any) => m.driver_id)).toEqual([MOT_B]);
    expect(b.body.resumo).toMatchObject({ veiculos: 1, litros_comprados: 1000, km: 800 });
    expect(tipos(b.body.veiculos[0])).toContain('consumo_acima');
    expect((await call(`/conciliacao-diesel?vehicle_id=${VEH1}`, T.ownerB)).status).toBe(404);
    const a = await call('/conciliacao-diesel', T.ownerA);
    expect(a.body.veiculos.map((v: any) => v.vehicle_id)).not.toContain(VEHB);
    expect(JSON.stringify(a.body)).not.toContain(MOT_B);
  });
});

describe('conferência do diesel: litros esperados × comprados', () => {
  let r: { status: number; body: any };
  const veic = (vid: string) => r.body.veiculos.find((v: any) => v.vehicle_id === vid);
  beforeAll(async () => { r = await call('/conciliacao-diesel', T.ownerA); });

  it('km das viagens concluídas ÷ consumo cadastrado: diferença, valor e consumo_acima', () => {
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ dias: 30, tolerancia_pct: 8 });
    expect(r.body.nota).toMatch(/nível do tanque/);
    const v = veic(VEH1);
    expect(v).toMatchObject({
      plate: 'CCA1C01', km: 1000, km_fonte: 'viagens', consumo_ref_km_l: 2.5, consumo_fonte: 'cadastro do veículo',
      litros_esperados: 400, abastecimentos: 3, litros_comprados: 600, litros_conferidos: 600, valor_rs: 3600, preco_medio_rs_l: 6,
      diferenca_l: 200, diferenca_pct: 50, valor_diferenca_rs: 1200, valor_em_risco_rs: 1200, atribuidos_pelo_motorista: 1,
      consumo_medido_km_l: 1.43,          // 90 dias: 1.000 km ÷ 700 L (inclui o de 40 dias atrás), só informativo
      fora_do_plano: { abastecimentos: 0, litros: 0, sobrepreco_rs: 0 },
    });
    expect(tipos(v)).toEqual(['consumo_acima', 'sem_hodometro']);
    expect(v.detalhe).toBeUndefined();
  });

  it('fora do plano: posto fora das paradas e da rede conveniada, com sobrepreço; conveniado e parada do plano não contam', () => {
    const v = veic(VEH2);
    expect(v).toMatchObject({
      km: 900, consumo_ref_km_l: 4.5, consumo_fonte: 'estimativa do tipo de caminhão', litros_esperados: 200,
      litros_comprados: 240, diferenca_l: 40, diferenca_pct: 20,
      fora_do_plano: { abastecimentos: 2, litros: 120, valor_rs: 774, sobrepreco_rs: 54 },
      sem_cnpj: { abastecimentos: 1, litros: 10 },
    });
    // +20% mas só 40 L: abaixo do mínimo de 100 L, não é consumo_acima
    expect(tipos(v)).toEqual(['fora_do_plano', 'sem_hodometro']);
    expect(v.valor_em_risco_rs).toBeCloseTo(40 * (1547 / 240) + 54, 1);
  });

  it('com duas leituras de hodômetro ou mais, os km vêm do hodômetro', () => {
    const v = veic(VEH3);
    expect(v).toMatchObject({
      km: 1200, km_fonte: 'hodometro', km_viagens: 50, hodometro: { leituras: 3, inicial_km: 100000, final_km: 101200 },
      litros_esperados: 400, litros_comprados: 710, litros_conferidos: 410, diferenca_l: 10, diferenca_pct: 2.5,
    });
    expect(v.alertas).toEqual([]);
  });

  it('rodou sem registrar abastecimento → sem_registro; comprou bem menos do que rodou → consumo_abaixo', () => {
    expect(tipos(veic(VEH4))).toEqual(['sem_registro']);
    expect(veic(VEH4)).toMatchObject({ km: 400, consumo_ref_km_l: 3.5, abastecimentos: 0, valor_em_risco_rs: 0 });
    expect(veic(VEH5)).toMatchObject({ litros_esperados: 500, litros_comprados: 300, diferenca_l: -200, diferenca_pct: -40, valor_em_risco_rs: 0 });
    expect(tipos(veic(VEH5))).toEqual(['consumo_abaixo', 'sem_hodometro']);
  });

  it('resumo e ordem por valor em risco', () => {
    expect(r.body.veiculos.map((v: any) => v.plate).slice(0, 2)).toEqual(['CCA1C01', 'CCA1C02']);
    expect(r.body.resumo).toMatchObject({
      veiculos: 5, veiculos_com_alerta: 4, km: 5000, litros_comprados: 1850,
      alertas: { consumo_acima: 1, consumo_abaixo: 1, fora_do_plano: 1, sem_hodometro: 3, sem_registro: 1 },
      fora_do_plano: { abastecimentos: 2, litros: 120, valor_rs: 774, sobrepreco_rs: 54 },
      sem_cnpj: { abastecimentos: 1, litros: 10 }, sem_veiculo: { abastecimentos: 0, litros: 0 },
    });
    const risco = r.body.veiculos.reduce((t: number, v: any) => t + v.valor_em_risco_rs, 0);
    expect(r.body.resumo.valor_em_risco_rs).toBeCloseTo(risco, 1);
    expect(r.body.resumo.valor_em_risco_rs).toBeGreaterThan(1200 + 54);
  });

  it('por motorista: litros, fora do plano, sobrepreço e alertas', () => {
    const m1 = r.body.por_motorista.find((m: any) => m.driver_id === MOT_A1);
    const m2 = r.body.por_motorista.find((m: any) => m.driver_id === MOT_A2);
    expect(m1).toMatchObject({ nome: 'Motorista A1', km: 1000, litros_comprados: 600, litros_esperados: 400, diferenca_l: 200 });
    expect(tipos(m1)).toEqual(['consumo_acima']);
    expect(m2).toMatchObject({ nome: 'Motorista A2', litros_comprados: 240, fora_do_plano: { litros: 120, sobrepreco_rs: 54 } });
    expect(tipos(m2)).toEqual(['fora_do_plano']);
    expect(r.body.por_motorista[0].driver_id).toBe(MOT_A1);
  });
});

describe('conferência do diesel: filtros e detalhe', () => {
  it('detalhe=true lista os abastecimentos de cada placa com as marcas', async () => {
    const r = await call(`/conciliacao-diesel?detalhe=true`, T.ownerA);
    expect(r.status).toBe(200);
    const veic = (vid: string) => r.body.veiculos.find((v: any) => v.vehicle_id === vid);
    const d2 = veic(VEH2).detalhe as any[];
    expect(d2).toHaveLength(5);
    const doCnpj = (cnpj: string | null) => d2.find((a) => a.posto_cnpj === cnpj);
    expect(doCnpj(CNPJ_FORA)).toMatchObject({ litros: 100, preco_rs_l: 6.5, preco_ref_rs_l: 6, sobrepreco_rs: 50, trip_id: T2, driver_name: 'Motorista A2' });
    expect(doCnpj(CNPJ_FORA).marcas).toEqual(expect.arrayContaining(['fora_do_plano', 'sobrepreco']));
    expect(doCnpj(CNPJ_CONV).marcas).toContain('conveniado');
    expect(doCnpj(CNPJ_CONV).marcas).not.toContain('fora_do_plano');
    expect(doCnpj(CNPJ_PLANO).marcas).toContain('no_plano');
    expect(doCnpj(CNPJ_CONV_INATIVO).marcas).toContain('fora_do_plano');
    expect(doCnpj(null).marcas).toContain('sem_cnpj');
    const d1 = veic(VEH1).detalhe as any[];
    expect(d1).toHaveLength(3);                                       // nem ARLA nem o de 40 dias atrás
    expect(d1.filter((a) => a.marcas.includes('veiculo_do_motorista'))).toHaveLength(1);
    expect(d1.every((a) => a.marcas.includes('sem_plano'))).toBe(true);
    const d3 = veic(VEH3).detalhe as any[];
    expect(d3.find((a) => a.odometro_km === 100000).marcas).toContain('antes_do_hodometro');
    expect(veic(VEH4).detalhe).toEqual([]);
  });

  it('vehicle_id, dias e tolerancia_pct', async () => {
    const so = await call(`/conciliacao-diesel?vehicle_id=${VEH1}`, T.ownerA);
    expect(so.body.veiculos.map((v: any) => v.vehicle_id)).toEqual([VEH1]);
    expect(so.body.por_motorista.map((m: any) => m.driver_id)).toEqual([MOT_A1]);
    expect(so.body.resumo).toMatchObject({ veiculos: 1, litros_comprados: 600 });
    const longo = await call(`/conciliacao-diesel?vehicle_id=${VEH1}&dias=60`, T.ownerA);
    expect(longo.body.veiculos[0]).toMatchObject({ litros_comprados: 700, diferenca_l: 300 });
    const tolerante = await call(`/conciliacao-diesel?vehicle_id=${VEH1}&tolerancia_pct=60`, T.ownerA);
    expect(tipos(tolerante.body.veiculos[0])).toEqual(['sem_hodometro']);
    expect((await call(`/conciliacao-diesel?vehicle_id=${id(999)}`, T.ownerA)).status).toBe(404);
  });
});
