/**
 * core_legal: presets CONTRAN, VUC/AETC, ZMRC, rodízio, perigosos, feriados, suspensões da CET e jornada.
 * Parte unitária (regras puras, sem rede) + parte ponta a ponta contra a API (API_URL) e o banco (TEST_DATABASE_URL).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { crossesZone, DEVICE, get, midpointOf, pool, PTS, route, waitForStack } from '../helpers.js';
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
const BUTANTA = { lat: -23.5700, lon: -46.7300 };
// Dentro do Minianel, mas no corredor das vias-limite (cortado da zona de caminhões na rota): Vila Leopoldina e Bom Retiro
const GASTAO_VIDIGAL = { lat: -23.5184, lon: -46.7416 };
const SERGIO_TOMAS = { lat: -23.5204, lon: -46.6446 };
const RODIZIO_CAMINHOES_ID = '22222222-2222-4222-8222-000000000002';
const PERIGOSOS_ID = '22222222-2222-4222-8222-000000000003';
// Dentro do centro expandido (e da ZMRC): Av. Paulista -> Vila Mariana
const PAULISTA = { lat: -23.5614, lon: -46.6559 };
const VILA_MARIANA = { lat: -23.5890, lon: -46.6340 };
// Mooca (dentro do Minianel, fora da ZMRC): trecho curto para o reporte "proibido caminhão"
const MOOCA_A = { lat: -23.5560, lon: -46.5990 };
const MOOCA_B = { lat: -23.5630, lon: -46.5850 };
const cetWarnings = (r: any) => r.body.warnings.filter((w: any) => w.code === 'cet_suspension').map((w: any) => w.message as string).join(' | ');
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

  it('perigosos: grupos III e IV (consumo local/outros) podem circular na área interna (art. 3º parágrafo único)', () => {
    const t = at('2026-10-13T08:00');
    const glp = resolveVehicle({ preset: 'truck', hazmat_un: '1075', hazmat_local_delivery: true });   // GLP fracionado: Anexo II
    expect(zoneApplies(PERIGOSOS, glp, t)).toBe(false);
    expect(glp.legal_notes.join(' ')).toMatch(/evita só as vias do Minianel/);
    expect(zoneApplies(PERIGOSOS, resolveVehicle({ preset: 'truck', hazmat_un: '2908' }), t)).toBe(false);   // Anexo III (outros)
    expect(zoneApplies(PERIGOSOS, resolveVehicle({ preset: 'truck', hazmat_un: '1075' }), t)).toBe(true);    // GLP a granel: Anexo I
    expect(zoneApplies(PERIGOSOS, resolveVehicle({ preset: 'truck', hazmat_un: '1005' }), t)).toBe(true);    // só no Anexo I
    expect(zoneApplies(PERIGOSOS, resolveVehicle({ preset: 'truck', hazmat: true }), t)).toBe(true);         // sem nº ONU: conservador
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

  it('avisos legais: VUC com perigoso depende do grupo (art. 35), LETPP do DSV e idade do VUC com data-limite', () => {
    const diesel = resolveVehicle({ preset: 'vuc', has_aetc: true, hazmat_un: '1202' }).legal_notes.join(' ');
    expect(diesel).toMatch(/não tem exceção na ZMRC/);
    expect(diesel).not.toMatch(/10h às 16h e com AETC/);
    expect(diesel).toMatch(/LETPP, expedida pelo DSV/);
    const glp = resolveVehicle({ preset: 'vuc', has_aetc: true, hazmat_un: '1075', hazmat_local_delivery: true }).legal_notes.join(' ');
    expect(glp).toMatch(/só das 10h às 16h e com AETC \(art\. 35\)/);
    expect(resolveVehicle({ preset: 'vuc', has_aetc: true, hazmat: true }).legal_notes.join(' ')).toMatch(/consumo local ou "outros"/);
    const y = new Date().getFullYear();
    expect(resolveVehicle({ preset: 'vuc', has_aetc: true, manufacture_year: y - 15 }).legal_notes.join(' ')).toMatch(new RegExp(`só até 31/12/${y}`));
    expect(resolveVehicle({ preset: 'vuc', has_aetc: true, manufacture_year: y - 16 }).legal_notes.join(' ')).toMatch(/passou do limite de 15 anos/);
    expect(resolveVehicle({ preset: 'vuc', has_aetc: true, manufacture_year: y - 5 }).legal_notes.join(' ')).not.toMatch(/15 anos/);
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
    const r = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: { preset: 'carreta', employment: 'autonomous' }, departure_at: '2027-01-25T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(zoneNames(r.body)).toEqual([]);
    expect(r.body.warnings.some((x: any) => x.code === 'holiday')).toBe(true);
    // o vínculo informado chega ao plano de jornada (routing.ts -> drivingPlan)
    expect(r.body.driving_plan.regime).toBe('autonomous');
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
    expect(cetWarnings(mantido)).toMatch(/rodízio em 10\/03\/2027.*MANTIDO para veículos pesados/);   // camada core_legal
    const geral = await route({ ...base, departure_at: '2027-03-17T08:00' });
    expect(zoneNames(geral.body)).toEqual([]);
    expect(cetWarnings(geral)).toMatch(/rodízio em 17\/03\/2027.*calculada sem essa restrição/);
    expect(cetWarnings(geral)).not.toMatch(/ZMRC/);   // Osasco -> Penha não toca a ZMRC
    const zmrc = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: { preset: 'carreta' }, departure_at: '2027-03-17T10:00' });
    expect(zoneNames(zmrc.body)).toEqual([]);
    expect(cetWarnings(zmrc)).toMatch(/ZMRC em 17\/03\/2027/);
    // dia sem suspensão: nenhum aviso
    const comum = await route({ origin: PTS.zmrcA, destination: PTS.zmrcB, vehicle: { preset: 'carreta' }, departure_at: '2027-03-16T22:00' });
    expect(cetWarnings(comum)).toBe('');
  });

  it('perigoso de consumo local (GLP fracionado) circula no centro expandido às 8h; gasolina não', async () => {
    const inZone = (r: any) => r.body.warnings.filter((w: any) => /in_zone$/.test(w.code)).map((w: any) => w.zone_id);
    const glp = await route({ origin: PAULISTA, destination: VILA_MARIANA, vehicle: { preset: 'vuc', hazmat_un: '1075', hazmat_local_delivery: true }, departure_at: '2026-10-13T08:00' });
    expect(glp.status, JSON.stringify(glp.body)).toBe(200);
    expect(inZone(glp)).not.toContain(PERIGOSOS_ID);
    const gasolina = await route({ origin: PAULISTA, destination: VILA_MARIANA, vehicle: { preset: 'vuc', hazmat_un: '1203' }, departure_at: '2026-10-13T08:00' });
    expect(gasolina.status, JSON.stringify(gasolina.body)).toBe(200);
    expect(inZone(gasolina)).toContain(PERIGOSOS_ID);
  });

  it('reporte "proibido caminhão": VUC sem AETC desvia (é caminhão comum); com AETC e utilitário passam', async () => {
    const dev = 'test-core-legal-vuc';
    const base = { origin: MOOCA_A, destination: MOOCA_B, departure_at: '2026-10-13T22:30' };
    const free = await route({ ...base, vehicle: { preset: 'vuc', has_aetc: true } });
    expect(free.status, JSON.stringify(free.body)).toBe(200);
    const p = midpointOf(free.body);
    const { rows: [rep] } = await pool.query(
      `insert into reports (type, geom, device_id, status, score) values ('truck_ban', ST_SetSRID(ST_MakePoint($1, $2), 4326), $3, 'active', 1) returning id`,
      [p.lon, p.lat, dev]);
    try {
      const avoids = async (vehicle: Record<string, unknown>) => {
        const r = await route({ ...base, vehicle });
        expect(r.status, JSON.stringify(r.body)).toBe(200);
        return r.body.avoided.some((a: any) => a.id === rep.id);
      };
      expect(await avoids({ preset: 'vuc' })).toBe(true);                    // sem AETC
      expect(await avoids({ preset: 'vuc', has_aetc: true })).toBe(false);
      expect(await avoids({ preset: 'utilitario' })).toBe(false);             // PBT 3,5 t: não é caminhão
      expect(await avoids({ preset: 'toco' })).toBe(true);
    } finally {
      await pool.query('delete from reports where device_id = $1', [dev]);
    }
  });

  it('rodízio: destino no corredor do Minianel (Av. Gastão Vidigal) continua dentro do rodízio', async () => {
    const r = await route({ origin: OSASCO, destination: GASTAO_VIDIGAL, vehicle: { preset: 'carreta', plate_last_digit: 1 }, departure_at: '2026-10-19T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = r.body.warnings.find((x: any) => x.code === 'destination_in_zone');
    expect(w?.zone_id).toBe(RODIZIO_CAMINHOES_ID);
  });

  it('rodízio: origem no corredor em Bom Retiro (R. Sérgio Tomás) sai com aviso, sem bloqueio', async () => {
    const r = await route({ origin: SERGIO_TOMAS, destination: PENHA, vehicle: { preset: 'carreta', plate_last_digit: 1 }, departure_at: '2026-10-19T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.warnings.find((x: any) => x.code === 'origin_in_zone')?.zone_id).toBe(RODIZIO_CAMINHOES_ID);
  });

  it('rodízio: placa do dia passa pelo Cebolão (Marginal Tietê -> Marginal Pinheiros) sem desvio', async () => {
    const base = { origin: { lat: -23.5085, lon: -46.6350 }, destination: BUTANTA, departure_at: '2026-10-19T08:00' };
    const livre = await route({ ...base, vehicle: { preset: 'carreta', plate_last_digit: 3 } });
    const rod = await route({ ...base, vehicle: { preset: 'carreta', plate_last_digit: 1 } });
    expect(rod.status, JSON.stringify(rod.body)).toBe(200);
    expect(zoneNames(rod.body)).toEqual([]);
    expect(rod.body.distance_km).toBeLessThan(livre.body.distance_km * 1.05);
  });

  it('reporte "proibido caminhão" não vale para o utilitário de 3,5 t nem para o VUC (active_reports_for_vehicle, 0101)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const { rows: [rep] } = await c.query(
        `insert into reports (type, geom, device_id, status, score)
         values ('truck_ban', ST_SetSRID(ST_MakePoint(-46.70, -23.60), 4326), $1, 'active', 1) returning id`, [DEVICE]);
      const blocks = async (weight: number, isVuc: boolean) => (await c.query(
        `select count(*)::int as n from active_reports_for_vehicle(2.5, $1, 5.5, false, $2, now()) where id = $3`,
        [weight, isVuc, rep.id])).rows[0].n === 1;
      expect(await blocks(3.5, false)).toBe(false);   // utilitário: não é caminhão (CTB Anexo I)
      expect(await blocks(16, false)).toBe(true);     // toco
      expect(await blocks(9, true)).toBe(false);      // VUC
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
