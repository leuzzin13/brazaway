/**
 * feriados_sudeste: feriados estaduais de RJ/ES e municipais das capitais e polos na tabela holidays
 * (importador feriados_sudeste, migration 0202), UF derivada do IBGE em calendar.ts e aviso 'holiday_local' da rota.
 * Parte contra o banco (TEST_DATABASE_URL, mesmo DATABASE_URL da API) e parte ponta a ponta contra a API (API_URL).
 * Datas de 2026: São Jorge (RJ) cai numa quinta, 23/04 (Lei estadual RJ 5.198/2008, art. 1º).
 * Requer o seed db/seed/layers/core_legal__feriados-sudeste.sql (ou o importador) e a malha municipal do IBGE
 * (seed geocoding__ibge-malhas.sql).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { pool, route, waitForStack } from '../helpers.js';
import { pool as apiPool } from '../../src/db.js';
import { endpointHolidays, legalDayInfo, municipiosAt, ufFromIbge } from '../../src/services/calendar.js';
import { holidayLocalWarnings } from '../../src/services/routing.js';
import { resolveVehicle } from '../../src/services/vehicle.js';
import rmsp from '../../src/layers/restricoes_rmsp.layer.js';

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Sao_Paulo' }).toJSDate();
const RIO = '3304557';
const SAO_PAULO = '3550308';
// Rio: Centro (Praça Mauá) -> São Cristóvão; São Paulo: Vila Leopoldina -> Butantã (fora da ZMRC)
const RIO_A = { lat: -22.8975, lon: -43.1850 };
const RIO_B = { lat: -22.8990, lon: -43.2210 };
const SP_A = { lat: -23.5316, lon: -46.7400 };
const SP_B = { lat: -23.5770, lon: -46.7430 };
// Osasco: Av. dos Autonomistas (mesmos pontos de rmsp.test.ts), caminho natural pelas VER
const OSA_A = { lat: -23.5262, lon: -46.7990 };
const OSA_B = { lat: -23.5420, lon: -46.7640 };
const names = (hs: { name: string }[]) => hs.map((h) => h.name);

afterAll(async () => { await apiPool.end(); await pool.end(); });

describe('feriados_sudeste — calendário (banco)', () => {
  it('UF pelo código IBGE: 31 MG, 32 ES, 33 RJ, 35 SP; código inválido não vira SP', () => {
    expect([ufFromIbge('3106200'), ufFromIbge('3205309'), ufFromIbge(RIO), ufFromIbge(SAO_PAULO)]).toEqual(['MG', 'ES', 'RJ', 'SP']);
    expect(ufFromIbge('0000000')).toBeNull();
    expect(ufFromIbge(null)).toBeNull();
  });

  it('São Jorge (23/04/2026) é feriado estadual no Rio e não em São Paulo', async () => {
    const rio = await legalDayInfo(at('2026-04-23T10:00'), RIO);           // sem UF: derivada do IBGE (33 = RJ)
    expect(rio.holiday?.name).toBe('Dia de São Jorge');
    expect(rio.holiday?.scope).toBe('state');
    expect(rio.holiday?.legal_basis).toContain('Lei estadual RJ 5.198/2008, art. 1º');
    const sp = await legalDayInfo(at('2026-04-23T10:00'), SAO_PAULO);
    expect(sp.holidays).toEqual([]);
    const padrao = await legalDayInfo(at('2026-04-23T10:00'));            // default: São Paulo capital
    expect(padrao.holidays).toEqual([]);
  });

  it('o 9/7 paulista não vale no Rio (antes a UF padrão era SP para qualquer município)', async () => {
    expect(names((await legalDayInfo(at('2026-07-09T10:00'), RIO)).holidays)).toEqual([]);
    expect(names((await legalDayInfo(at('2026-07-09T10:00'), SAO_PAULO)).holidays)).toContain('Revolução Constitucionalista de 1932 (data magna de SP)');
  });

  it('lei declarada inconstitucional fica registrada e nunca é aplicada (RJ, 2º domingo de maio, ADI 6133)', async () => {
    expect((await legalDayInfo(at('2026-05-10T10:00'), RIO)).holidays).toEqual([]);
    const r = await pool.query(`select active, status, inactive_reason from holidays where day = '2026-05-10' and scope = 'state' and uf = 'RJ'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ active: false, status: 'inconstitucional' });
    expect(r.rows[0].inactive_reason).toContain('ADI 6133');
  });

  it('confiança baixa/unverifiable fica desativada: Paixão no Rio não confirmada; Jubileu de Contagem 2027 inferido', async () => {
    expect((await legalDayInfo(at('2026-04-03T10:00'), RIO)).holidays).toEqual([]);
    expect(names((await legalDayInfo(at('2026-03-27T10:00'), '3118601')).holidays)).toEqual(['Jubileu de Nossa Senhora das Dores']);
    expect((await legalDayInfo(at('2027-03-19T10:00'), '3118601')).holidays).toEqual([]);
  });

  it('o banco recusa feriado ativo com norma não vigente ou confiança baixa (check da migration 0202)', async () => {
    const ins = (status: string, confidence: string) => pool.query(
      `insert into holidays (day, scope, uf, name, source, active, status, confidence)
       values ('2031-01-02', 'state', 'RJ', 'TESTE feriados_sudeste', 'teste', true, $1, $2)`, [status, confidence]);
    await expect(ins('inconstitucional', 'alta')).rejects.toMatchObject({ code: '23514' });
    await expect(ins('vigente', 'baixa')).rejects.toMatchObject({ code: '23514' });
  });

  it('ES: Penha (Páscoa + 8) em todo o estado; Corpus Christi é feriado em Vitória e não na Serra', async () => {
    expect(names((await legalDayInfo(at('2026-04-13T10:00'), '3205002')).holidays)).toEqual(['Nossa Senhora da Penha (data magna do ES)']);
    expect(names((await legalDayInfo(at('2026-06-04T10:00'), '3205309')).holidays)).toEqual(['Corpus Christi']);
    expect((await legalDayInfo(at('2026-06-04T10:00'), '3205002')).holidays).toEqual([]);   // ponto facultativo na Serra
  });

  it('correções do verify.json: Guarujá 29/06/2026 (antecipado) e não 30/06; Campinas 12/08', async () => {
    expect(names((await legalDayInfo(at('2026-06-29T10:00'), '3518701')).holidays)).toEqual(['Emancipação político-administrativa (antecipada)']);
    expect((await legalDayInfo(at('2026-06-30T10:00'), '3518701')).holidays).toEqual([]);
    expect(names((await legalDayInfo(at('2026-08-12T10:00'), '3509502')).holidays)).toEqual(['Dia do Evangélico']);
  });

  it('município da origem/destino pela malha do IBGE e feriados estaduais/municipais dele', async () => {
    const [rio, sp, mar] = await municipiosAt([RIO_A, SP_A, { lat: -23.9, lon: -45.0 }]);
    expect(rio).toMatchObject({ ibge: RIO, uf: 'RJ', nome: 'Rio de Janeiro' });
    expect(sp).toMatchObject({ ibge: SAO_PAULO, uf: 'SP' });
    expect(mar).toBeNull();                                               // no mar, fora da malha
    const e = await endpointHolidays(at('2026-04-23T10:00'), RIO_A, RIO_B);
    expect(e).toHaveLength(1);
    expect(e[0].pontos).toEqual(['origem', 'destino']);
    expect(names(e[0].holidays)).toEqual(['Dia de São Jorge']);
    expect(await endpointHolidays(at('2026-04-23T10:00'), SP_A, SP_B)).toEqual([]);
  });

  it('feriado municipal real suspende regra "exceto feriados": VER de Osasco no 19/02/2026 (Dec. 14.952/2025), não na "emenda" de 20/02', async () => {
    const ctx = (when: string) => ({ vehicle: resolveVehicle({ preset: 'carreta' } as any), at: at(when), departureLocal: when, origin: OSA_A, destination: OSA_B, tz: 'America/Sao_Paulo' });
    const ver = (cl: Awaited<ReturnType<NonNullable<typeof rmsp.costLines>>>) => cl.some((c) => c.item.type === 'VER' && /Osasco/.test(c.item.name ?? ''));
    expect(ver(await rmsp.costLines!(ctx('2026-02-19T08:00') as any)), 'VER de Osasco ativa no feriado de 19/02').toBe(false);
    expect(ver(await rmsp.costLines!(ctx('2026-02-20T08:00') as any)), '20/02 é ponto facultativo, não feriado').toBe(true);
  });

  it('aviso holiday_local não repete o feriado de São Paulo capital (aviso holiday)', () => {
    const mun = { ibge: '3509502', nome: 'Campinas', uf: 'SP' };
    const nove = { id: '1', name: 'Revolução Constitucionalista', scope: 'state', legal_basis: 'Lei estadual SP 9.497/1997 art. 1º' };
    const evang = { id: '2', name: 'Dia do Evangélico', scope: 'municipal', legal_basis: 'Lei municipal Campinas 16.785/2025' };
    expect(holidayLocalWarnings([{ municipio: mun, pontos: ['destino'], holidays: [nove] }], [nove], '09/07/2026')).toEqual([]);
    const w = holidayLocalWarnings([{ municipio: mun, pontos: ['destino'], holidays: [evang] }], [], '12/08/2026');
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ code: 'holiday_local', severity: 'info', id: '3509502' });
    expect(w[0].message).toContain('Campinas/SP (destino) em 12/08/2026: Dia do Evangélico — feriado municipal (Lei municipal Campinas 16.785/2025)');
  });
});

describe('feriados_sudeste — rota (API)', () => {
  beforeAll(async () => { await waitForStack(); });
  const truck = { preset: 'truck' };
  const local = (r: any) => r.body.warnings.filter((w: any) => w.code === 'holiday_local');
  const all = (r: any) => r.body.warnings.map((w: any) => w.message as string).join(' | ');

  it('rota no Rio em 23/04/2026: avisa o feriado estadual de São Jorge com a lei', async () => {
    const r = await route({ origin: RIO_A, destination: RIO_B, vehicle: truck, departure_at: '2026-04-23T10:00' });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const w = local(r);
    expect(w).toHaveLength(1);
    expect(w[0].message).toContain('Rio de Janeiro/RJ (origem e destino) em 23/04/2026: Dia de São Jorge — feriado estadual (Lei estadual RJ 5.198/2008, art. 1º)');
    expect(r.body.warnings.some((x: any) => x.code === 'holiday')).toBe(false);   // não é feriado em SP capital
  });

  it('rota em São Paulo no mesmo dia: nenhum aviso de São Jorge', async () => {
    const r = await route({ origin: SP_A, destination: SP_B, vehicle: truck, departure_at: '2026-04-23T10:00' });
    expect(r.status).toBe(200);
    expect(local(r)).toEqual([]);
    expect(all(r)).not.toMatch(/São Jorge/);
  });

  it('rota no Rio no dia seguinte (24/04/2026): sem feriado', async () => {
    const r = await route({ origin: RIO_A, destination: RIO_B, vehicle: truck, departure_at: '2026-04-24T10:00' });
    expect(r.status).toBe(200);
    expect(local(r)).toEqual([]);
  });
});
