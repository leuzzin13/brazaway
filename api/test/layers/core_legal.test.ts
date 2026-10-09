/**
 * core_legal: presets CONTRAN, VUC/AETC, ZMRC, rodízio, perigosos, feriados, suspensões da CET e jornada.
 * Parte unitária (regras puras, sem rede) + parte ponta a ponta contra a API (API_URL) e o banco (TEST_DATABASE_URL).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { crossesZone, get, pool, PTS, route, waitForStack } from '../helpers.js';
import { resolveVehicle } from '../../src/services/vehicle.js';
import { zoneApplies, type ZoneRules } from '../../src/services/zones.js';
import { drivingPlan, DRIVING_RULES } from '../../src/services/restStops.js';

const cfg = JSON.parse(readFileSync(new URL('../../../config/zmrc-rules.json', import.meta.url), 'utf8'));
const ZMRC: ZoneRules = cfg.rules;
const zoneById = (suffix: string): ZoneRules => cfg.other_zones.find((z: any) => z.id.endsWith(suffix)).rules;
const RODIZIO_CAMINHAO = zoneById('0002');
const PERIGOSOS = zoneById('0003');
const RODIZIO_LEVES = zoneById('0004');
const at = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Sao_Paulo' }).toJSDate();
const HOLIDAY = { holiday: { name: 'teste' } };

// Pontos: Osasco -> Penha pela Marginal Tietê (vias do Minianel); Santana -> Jabaquara atravessa a ZMRC.
const OSASCO = { lat: -23.5320, lon: -46.7700 };
const PENHA = { lat: -23.5250, lon: -46.5450 };
const zoneNames = (r: any) => r.avoided.filter((a: any) => a.kind === 'zone').map((a: any) => a.name as string);

describe('core_legal — regras (unitário)', () => {
  it('presets: aliases dos ids antigos e limites da Res. CONTRAN 882/2021', () => {
    const carreta = resolveVehicle({ preset: 'carreta' });
    expect(carreta.preset_id).toBe('carreta_5e');
    expect(carreta.length_m).toBe(19.3);                 // art. 4º III e (red. Res. 1.005/2024)
    expect(resolveVehicle({ preset: 'bitrem' }).requires_aet).toBe(false);   // 57 t / 19,80 m: art. 6º I j
    expect(resolveVehicle({ preset: 'rodotrem' }).requires_aet).toBe(true);  // art. 18
    expect(resolveVehicle({ preset: 'carreta', length_m: 21 }).requires_aet).toBe(true);
    expect(resolveVehicle({ preset: 'carreta', requires_aet: false, width_m: 2.9 }).requires_aet).toBe(true);
    expect(resolveVehicle({ preset: 'utilitario' }).is_truck).toBe(false);   // PBT <= 3,5 t (CTB Anexo I)
    for (const id of ['truck', 'vuc', 'toco', 'bitrem', 'rodotrem', 'carreta_6e', 'romeu_julieta']) expect(resolveVehicle({ preset: id }).preset_id).toBe(id);
  });

  it('ZMRC: seg–sex 05–21h, sáb 10–14h, exceto feriados; utilitário não é caminhão', () => {
    const c = resolveVehicle({ preset: 'carreta' });
    expect(zoneApplies(ZMRC, c, at('2026-10-13T04:59'))).toBe(false);
    expect(zoneApplies(ZMRC, c, at('2026-10-13T05:00'))).toBe(true);
    expect(zoneApplies(ZMRC, c, at('2026-10-13T20:59'))).toBe(true);
    expect(zoneApplies(ZMRC, c, at('2026-10-13T21:00'))).toBe(false);
    expect(zoneApplies(ZMRC, c, at('2026-10-17T09:59'))).toBe(false);   // sábado
    expect(zoneApplies(ZMRC, c, at('2026-10-17T10:00'))).toBe(true);
    expect(zoneApplies(ZMRC, c, at('2026-10-17T14:00'))).toBe(false);
    expect(zoneApplies(ZMRC, c, at('2026-10-18T10:00'))).toBe(false);   // domingo
    expect(zoneApplies(ZMRC, c, at('2026-10-13T10:00'), HOLIDAY)).toBe(false);
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'utilitario' }), at('2026-10-13T10:00'))).toBe(false);
  });

  it('VUC: isento só com AETC, dentro de 2,50 x 7,20 m e com até 15 anos', () => {
    const t = at('2026-10-13T10:00');
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'vuc', has_aetc: true }), t)).toBe(false);
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'vuc' }), t)).toBe(true);                                        // sem AETC
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'vuc', has_aetc: true, width_m: 2.6 }), t)).toBe(true);           // largo demais
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'vuc', has_aetc: true, length_m: 7.5 }), t)).toBe(true);          // comprido demais
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'vuc', has_aetc: true, manufacture_year: 2011 }), t)).toBe(false); // 15 anos
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'vuc', has_aetc: true, manufacture_year: 2010 }), t)).toBe(true);  // 16 anos
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'vuc', has_aetc: true, hazmat: true }), t)).toBe(true);            // art. 18 §4º
    expect(resolveVehicle({ preset: 'vuc' }).legal_notes.join(' ')).toMatch(/AETC/);
  });

  it('ZMRC: perecível com AETC 05–12h (art. 32) e perigoso de consumo local 10–16h (art. 35)', () => {
    const pere = resolveVehicle({ preset: 'truck', cargo_type: 'perishable', has_aetc: true });
    expect(zoneApplies(ZMRC, pere, at('2026-10-13T11:59'))).toBe(false);
    expect(zoneApplies(ZMRC, pere, at('2026-10-13T12:00'))).toBe(true);
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'truck', cargo_type: 'perishable' }), at('2026-10-13T08:00'))).toBe(true);
    const glp = { preset: 'truck', hazmat_un: '1075', hazmat_local_delivery: true, has_aetc: true };   // GLP fracionado (Anexo II)
    expect(zoneApplies(ZMRC, resolveVehicle(glp), at('2026-10-13T10:00'))).toBe(false);
    expect(zoneApplies(ZMRC, resolveVehicle(glp), at('2026-10-13T16:00'))).toBe(true);
    expect(zoneApplies(ZMRC, resolveVehicle({ ...glp, hazmat_local_delivery: false }), at('2026-10-13T11:00'))).toBe(true); // granel
    expect(zoneApplies(ZMRC, resolveVehicle({ ...glp, preset: 'carreta' }), at('2026-10-13T11:00'))).toBe(true);           // cavalo
  });

  it('rodízio: final de placa por dia, 07–10h e 17–20h, exceções do Decreto 58.584/2018 art. 3º', () => {
    const c1 = resolveVehicle({ preset: 'carreta', plate_last_digit: 1 });
    expect(zoneApplies(RODIZIO_CAMINHAO, c1, at('2026-10-19T07:00'))).toBe(true);   // segunda, finais 1 e 2
    expect(zoneApplies(RODIZIO_CAMINHAO, c1, at('2026-10-19T10:00'))).toBe(false);
    expect(zoneApplies(RODIZIO_CAMINHAO, c1, at('2026-10-19T17:30'))).toBe(true);
    expect(zoneApplies(RODIZIO_CAMINHAO, c1, at('2026-10-20T08:00'))).toBe(false);  // terça: 3 e 4
    expect(zoneApplies(RODIZIO_CAMINHAO, resolveVehicle({ preset: 'carreta', plate_last_digit: 0 }), at('2026-10-23T08:00'))).toBe(true);
    expect(zoneApplies(RODIZIO_CAMINHAO, c1, at('2026-10-19T08:00'), HOLIDAY)).toBe(false);
    expect(zoneApplies(RODIZIO_CAMINHAO, resolveVehicle({ preset: 'carreta', plate_last_digit: 1, cargo_type: 'perishable' }), at('2026-10-19T08:00'))).toBe(false);
    expect(zoneApplies(RODIZIO_CAMINHAO, resolveVehicle({ preset: 'truck', plate_last_digit: 1, powertrain: 'electric' }), at('2026-10-19T08:00'))).toBe(false);
    expect(zoneApplies(RODIZIO_CAMINHAO, resolveVehicle({ preset: 'truck', plate_last_digit: 1, powertrain: 'gas' }), at('2026-10-19T08:00'))).toBe(true);
    expect(zoneApplies(RODIZIO_CAMINHAO, resolveVehicle({ preset: 'vuc', plate_last_digit: 1, has_aetc: true }), at('2026-10-19T08:00'))).toBe(false);
    expect(zoneApplies(RODIZIO_CAMINHAO, resolveVehicle({ preset: 'vuc', plate_last_digit: 1 }), at('2026-10-19T08:00'))).toBe(true);
    // caminhão x leve: cada zona vale para um grupo
    const u1 = resolveVehicle({ preset: 'utilitario', plate_last_digit: 1 });
    expect(zoneApplies(RODIZIO_CAMINHAO, u1, at('2026-10-19T08:00'))).toBe(false);
    expect(zoneApplies(RODIZIO_LEVES, u1, at('2026-10-19T08:00'))).toBe(true);
    expect(zoneApplies(RODIZIO_LEVES, c1, at('2026-10-19T08:00'))).toBe(false);
    // sem placa informada, o rodízio não é aplicado
    expect(zoneApplies(RODIZIO_CAMINHAO, resolveVehicle({ preset: 'carreta' }), at('2026-10-19T08:00'))).toBe(false);
  });

  it('suspensão da CET: "mantido para pesados" não libera veículo de carga', () => {
    const u1 = resolveVehicle({ preset: 'utilitario', plate_last_digit: 1 });
    const t = at('2026-10-19T08:00');
    expect(zoneApplies(RODIZIO_LEVES, u1, t, { suspensions: [{ scope: 'rodizio', applies_to_heavy: true }] })).toBe(true);
    expect(zoneApplies(RODIZIO_LEVES, u1, t, { suspensions: [{ scope: 'rodizio', applies_to_heavy: false }] })).toBe(false);
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'carreta' }), t, { suspensions: [{ scope: 'rodizio', applies_to_heavy: false }] })).toBe(true);
    expect(zoneApplies(ZMRC, resolveVehicle({ preset: 'carreta' }), t, { suspensions: [{ scope: 'zmrc', applies_to_heavy: false }] })).toBe(false);
  });

  it('perigosos (Portaria SMT.GAB 051/2024): seg–sex 07–10h e 17–20h, exceto feriados', () => {
    const p = resolveVehicle({ preset: 'carreta', hazmat_un: 'UN 1203' });
    expect(p.hazmat).toBe(true);
    expect(p.hazmat_group_sp).toBe('ambiguo');           // gasolina: Anexos I e II
    expect(zoneApplies(PERIGOSOS, p, at('2026-10-13T07:00'))).toBe(true);
    expect(zoneApplies(PERIGOSOS, p, at('2026-10-13T10:00'))).toBe(false);
    expect(zoneApplies(PERIGOSOS, p, at('2026-10-13T19:59'))).toBe(true);
    expect(zoneApplies(PERIGOSOS, p, at('2026-10-17T08:00'))).toBe(false);   // sábado
    expect(zoneApplies(PERIGOSOS, p, at('2026-10-13T08:00'), HOLIDAY)).toBe(false);
    expect(zoneApplies(PERIGOSOS, resolveVehicle({ preset: 'carreta' }), at('2026-10-13T08:00'))).toBe(false);
  });

  it('jornada: CTB 67-C (5h30, 11 h ininterruptas — ADI 5322) e CLT 235-C só para empregado', () => {
    const h = 3600;
    expect(DRIVING_RULES.max_continuous_driving_s).toBe(5.5 * h);
    expect(DRIVING_RULES.daily_rest_s).toBe(11 * h);
    const emp = drivingPlan(12 * h, [], { employment: 'employee' });
    expect(emp.daily_rests).toBe(1);                       // 8 h + 2 h extras
    expect(emp.suggested_stops.find((s) => s.kind === 'daily_rest')!.after_s).toBeLessThanOrEqual(10 * h);
    expect(emp.suggested_stops.some((s) => s.kind === 'meal' && s.duration_s === h)).toBe(true);
    for (const s of emp.suggested_stops) expect(s.after_s).toBeGreaterThan(0);
    const tac = drivingPlan(12 * h, [], { employment: 'autonomous' });
    expect(tac.daily_rests).toBe(0);                       // autônomo: só limites do CTB
    expect(tac.required_breaks).toBe(2);
    const gaps = [0, ...tac.suggested_stops.map((s) => s.after_s), 12 * h].map((v, i, a) => (i ? v - a[i - 1] : 0)).slice(1);
    for (const g of gaps) expect(g).toBeLessThanOrEqual(5.5 * h);
    const unk = drivingPlan(9 * h, []);
    expect(unk.regime).toBe('unknown');
    expect(unk.notes.join(' ')).toMatch(/Vínculo do motorista não informado/);
    expect(drivingPlan(20 * h, [], { employment: 'autonomous' }).daily_rests).toBe(1);
  });
});

describe('core_legal — rotas (ponta a ponta)', () => {
  beforeAll(async () => {
    await waitForStack();
    await pool.query(`delete from rule_suspensions where source = 'test-core-legal'`);
    // datas sem feriado: 10/03/2027 (qua) suspensão só para "passeio"; 17/03/2027 (qua) suspensão geral do rodízio e da ZMRC
    await pool.query(
      `insert into rule_suspensions (ibge_code, starts_at, ends_at, scope, applies_to_heavy, description, source)
       values ('3550308', '2027-03-10T00:00-03', '2027-03-11T00:00-03', 'rodizio', true, 'teste core_legal', 'test-core-legal'),
              ('3550308', '2027-03-17T00:00-03', '2027-03-18T00:00-03', 'rodizio', false, 'teste core_legal', 'test-core-legal'),
              ('3550308', '2027-03-17T00:00-03', '2027-03-18T00:00-03', 'zmrc', false, 'teste core_legal', 'test-core-legal')
       on conflict do nothing`);
  });
  afterAll(async () => {
    await pool.query(`delete from rule_suspensions where source = 'test-core-legal'`);
    await pool.end();
  });

  it('presets expostos com base legal e aliases', async () => {
    const r = await get('/api/vehicles/presets');
    expect(r.status).toBe(200);
    const ids = r.body.presets.map((p: any) => p.id);
    for (const id of ['utilitario', 'vuc', 'toco', 'truck', 'carreta_5e', 'carreta_6e', 'romeu_julieta', 'bitrem', 'rodotrem']) expect(ids).toContain(id);
    for (const p of r.body.presets) expect(p.legal_basis, p.id).toMatch(/\S{10,}/);
    expect(r.body.aliases.carreta).toBe('carreta_5e');
    const vuc = r.body.presets.find((p: any) => p.id === 'vuc');
    expect([vuc.width_m, vuc.length_m]).toEqual([2.5, 7.2]);
  });

  it('VUC SEM AETC às 10h de terça é tratado como caminhão e desvia da ZMRC', async () => {
    const r = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: { preset: 'vuc', height_m: 3.2, is_vuc: true }, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(zoneNames(r.body).join()).toMatch(/ZMRC/);
    expect(r.body.vehicle.legal_notes.join(' ')).toMatch(/AETC/);
  });

  it('feriado nacional (12/10) às 10h: carreta atravessa a ZMRC e a resposta avisa o feriado', async () => {
    const z = await get('/api/zones');
    const zmrc = z.body.features.find((f: any) => /ZMRC/.test(f.properties.name));
    const r = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: { preset: 'carreta' }, departure_at: '2026-10-12T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(zoneNames(r.body)).toEqual([]);
    expect(crossesZone(r.body, zmrc)).toBe(true);
    const w = r.body.warnings.find((x: any) => x.code === 'holiday');
    expect(w?.message).toMatch(/Aparecida/);
  });

  it('feriado municipal (25/01/2027, aniversário de SP) também suspende a ZMRC', async () => {
    const r = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: { preset: 'carreta' }, departure_at: '2027-01-25T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(zoneNames(r.body)).toEqual([]);
    expect(r.body.warnings.some((x: any) => x.code === 'holiday')).toBe(true);
  });

  it('rodízio: caminhão com placa do dia usa as marginais (vias do Minianel); utilitário não', async () => {
    const base = { origin: OSASCO, destination: PENHA, departure_at: '2026-10-19T08:00' };
    const livre = await route({ ...base, vehicle: { preset: 'carreta', plate_last_digit: 3 } });
    const rod = await route({ ...base, vehicle: { preset: 'carreta', plate_last_digit: 1 } });
    expect(rod.status, JSON.stringify(rod.body)).toBe(200);
    expect(zoneNames(rod.body)).toEqual([]);
    expect(rod.body.distance_km).toBeLessThan(livre.body.distance_km * 1.05);
    const leve = await route({ ...base, vehicle: { preset: 'utilitario', plate_last_digit: 1 } });
    expect(leve.status, JSON.stringify(leve.body)).toBe(200);
    expect(zoneNames(leve.body).join()).toMatch(/Rodízio.*não são caminhão/);
    const eletrico = await route({ ...base, vehicle: { preset: 'utilitario', plate_last_digit: 1, powertrain: 'electric' } });
    expect(zoneNames(eletrico.body)).toEqual([]);
  });

  it('perecível com AETC: ZMRC liberada até 12h e isento do rodízio', async () => {
    const v = { preset: 'truck', cargo_type: 'perishable', has_aetc: true, plate_last_digit: 1 };
    const manha = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: v, departure_at: '2026-10-19T08:00' });
    expect(manha.status, JSON.stringify(manha.body)).toBe(200);
    expect(zoneNames(manha.body)).toEqual([]);
    const tarde = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: v, departure_at: '2026-10-19T13:00' });
    expect(zoneNames(tarde.body).join()).toMatch(/ZMRC/);
  });

  it('produto perigoso às 8h de terça evita o Minianel; às 11h e no feriado, não', async () => {
    const v = { preset: 'carreta', hazmat_un: '1203' };
    const pico = await route({ origin: OSASCO, destination: PENHA, vehicle: v, departure_at: '2026-10-13T08:00' });
    expect(pico.status, JSON.stringify(pico.body)).toBe(200);
    expect(zoneNames(pico.body).join()).toMatch(/perigosos/i);
    const fora = await route({ origin: OSASCO, destination: PENHA, vehicle: v, departure_at: '2026-10-13T11:00' });
    expect(zoneNames(fora.body)).toEqual([]);
    const feriado = await route({ origin: OSASCO, destination: PENHA, vehicle: v, departure_at: '2026-10-12T08:00' });
    expect(zoneNames(feriado.body)).toEqual([]);
  });

  it('suspensão da CET: "mantido para pesados" segue restringindo; suspensão geral libera', async () => {
    const base = { origin: OSASCO, destination: PENHA, vehicle: { preset: 'utilitario', plate_last_digit: 5 } };   // quarta: 5 e 6
    const mantido = await route({ ...base, departure_at: '2027-03-10T08:00' });
    expect(mantido.status, JSON.stringify(mantido.body)).toBe(200);
    expect(zoneNames(mantido.body).join()).toMatch(/Rodízio/);
    const geral = await route({ ...base, departure_at: '2027-03-17T08:00' });
    expect(zoneNames(geral.body)).toEqual([]);
    const zmrc = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: { preset: 'carreta' }, departure_at: '2027-03-17T10:00' });
    expect(zoneNames(zmrc.body)).toEqual([]);
  });
});
