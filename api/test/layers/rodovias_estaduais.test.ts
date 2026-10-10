import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { lineOf, midpointOf, pool, route, waitForStack } from '../helpers.js';
import layer, { criterioTrechoAplica, motivoBloqueioPC, type PontoCriticoProps } from '../../src/layers/rodovias_estaduais.layer.js';
import { resolveVehicle } from '../../src/services/vehicle.js';
import { pool as apiPool } from '../../src/db.js';
import type { RouteCtx } from '../../src/layers/types.js';

/**
 * Frente ders_estaduais: pontos críticos vivos do DER-MG (camada rodovias_estaduais), regras de trecho do DER-ES e do
 * DER-RJ e pontes estaduais do ES (camada oae, source der-es).
 *
 * Os pontos críticos reais mudam a toda hora (e hoje nenhum "interrompida para pesados" fica num corredor curto com
 * alternativa), então o teste de bloqueio insere um ponto de TESTE (source TEST_SOURCE) no meio de uma rota real em MG e
 * o apaga no fim. As regras do ES e as pontes vêm dos seeds versionados (db/seed/layers/*__der-es.sql).
 */
const TEST_SOURCE = 'teste_ders_estaduais';
const DEP = '2026-10-14T10:00';   // quarta-feira, dia útil sem feriado

// Lagoa Santa → Pedro Leopoldo (MG): estradas estaduais com alternativas pela malha da RMBH
const MG_A = { lat: -19.6283, lon: -43.8933 };
const MG_B = { lat: -19.6181, lon: -44.0431 };
// ES-060 (Rodovia do Sol): km 27 (Ponta da Fruta) → km 44 (Guarapari), passa pelo trecho do km 33–39 (IS DER-ES 003-N/2024)
const ES060_A = { lat: -20.52306, lon: -40.37372 };
const ES060_B = { lat: -20.61023, lon: -40.47117 };
// ES-476 (Viana): atravessa a Ponte sobre o Rio Jacarandá, PBT máx. 12 t (IS DER-ES 029-N/2024)
const JAC_A = { lat: -20.45, lon: -40.52 };
const JAC_B = { lat: -20.46, lon: -40.46 };
const JAC_PONTE: [number, number] = [-40.49225, -20.45340];
// Paracambi → Mendes (RJ-127, Serra de Paracambi): regra do DER-RJ registrada e desativada
const RJ_A = { lat: -22.62, lon: -43.70 };
const RJ_B = { lat: -22.52, lon: -43.735 };

const CARRETA = { preset: 'carreta' };
const TOCO = { preset: 'toco' };   // 16 t, 2 eixos
const VUC = { preset: 'vuc', is_vuc: true };
const UTILITARIO = { preset: 'utilitario' };   // 3,5 t: não é caminhão (CTB, Anexo I)

afterAll(async () => { await pool.end(); await apiPool.end(); });

const distM = (r: any, lonlat: [number, number]) => turf.pointToLineDistance(turf.point(lonlat), lineOf(r), { units: 'meters' });
const warnsOf = (r: any, code?: string) => (r.warnings as any[]).filter((w) => w.layer === 'rodovias_estaduais' && (!code || w.code === code));

function pc(over: Partial<PontoCriticoProps>): PontoCriticoProps {
  return { situacao: 'livre', ativo: true, ...over } as PontoCriticoProps;
}

describe('Regras sem rota', () => {
  const carreta = resolveVehicle(CARRETA as any);
  const toco = resolveVehicle(TOCO as any);
  const vuc = resolveVehicle(VUC as any);
  const util = resolveVehicle({ preset: 'utilitario' } as any);
  const truck = resolveVehicle({ preset: 'truck' } as any);

  it('pista interrompida para pesados: bloqueia todo caminhão (PBT > 3,5 t), VUC inclusive; só o utilitário (3,5 t) passa', () => {
    const p = pc({ situacao: 'interrompida_pesados' });
    expect(motivoBloqueioPC(p, carreta)?.code).toBe('pc_interrompida_pesados');
    expect(motivoBloqueioPC(p, toco)?.code).toBe('pc_interrompida_pesados');
    expect(motivoBloqueioPC(p, vuc)?.code).toBe('pc_interrompida_pesados');
    // a definição de VUC do app (Portaria SMT 137/2018 de SP) não limita o PBT: um "VUC" de 14 t continua pesado
    expect(motivoBloqueioPC(p, resolveVehicle({ ...VUC, weight_t: 14 } as any))?.code).toBe('pc_interrompida_pesados');
    expect(motivoBloqueioPC(p, util)).toBeNull();
  });
  it('pista interrompida (sem variante) bloqueia todos; com variante e meia-pista só avisam', () => {
    expect(motivoBloqueioPC(pc({ situacao: 'interrompida' }), util)?.code).toBe('pc_interrompida');
    expect(motivoBloqueioPC(pc({ situacao: 'interrompida_com_variante' }), carreta)).toBeNull();
    expect(motivoBloqueioPC(pc({ situacao: 'meia_pista' }), carreta)).toBeNull();
  });
  it('ponto inativo nunca bloqueia; limite de carga só com valor', () => {
    expect(motivoBloqueioPC(pc({ situacao: 'interrompida', ativo: false }), carreta)).toBeNull();
    expect(motivoBloqueioPC(pc({ limite_carga: 'Sim', limite_carga_t: null }), carreta)).toBeNull();
    expect(motivoBloqueioPC(pc({ limite_carga: 'Sim', limite_carga_t: 12 }), toco)?.code).toBe('pc_limite_carga');
    expect(motivoBloqueioPC(pc({ limite_carga: 'Sim', limite_carga_t: 12 }), vuc)).toBeNull();
  });
  it('critério de trecho: PBT > 23 t (estrito) e "mais de 2 eixos ou PBT > 15 t" (Lei ES 4.463/1990)', () => {
    const c23 = { caminhoes: true, peso_acima_t: 23 };
    expect(criterioTrechoAplica(c23, carreta, 2026)).toBe(true);
    expect(criterioTrechoAplica(c23, truck, 2026)).toBe(false);   // 23 t não passa de 23 t
    expect(criterioTrechoAplica(c23, toco, 2026)).toBe(false);
    const lei = { caminhoes: true, peso_acima_t: 15, eixos_acima: 2 };
    expect(criterioTrechoAplica(lei, toco, 2026)).toBe(true);     // 16 t
    expect(criterioTrechoAplica(lei, truck, 2026)).toBe(true);    // 3 eixos
    expect(criterioTrechoAplica(lei, vuc, 2026)).toBe(false);
    expect(criterioTrechoAplica({ caminhoes: true }, util, 2026)).toBe(false);
  });
});

describe('Ponto crítico de teste "pista interrompida para veículos pesados" (DER-MG)', () => {
  let ponto: [number, number];
  let fixtureId: string;
  let livreLine: GeoJSON.Feature<GeoJSON.LineString>;
  /** ponto `m` metros adiante do ponto de teste, sobre a rota livre */
  const adiante = (m: number) => {
    const len = turf.length(livreLine, { units: 'kilometers' });
    const c = turf.along(livreLine, len / 2 + m / 1000, { units: 'kilometers' }).geometry.coordinates;
    return { lon: c[0], lat: c[1] };
  };

  beforeAll(async () => {
    await waitForStack();
    await pool.query(`delete from data_features where source = $1`, [TEST_SOURCE]);
    // o utilitário (3,5 t) nunca é bloqueado pelo ponto: a rota dele é a rota livre (carreta, VUC e utilitário fazem o
    // mesmo caminho Lagoa Santa → Pedro Leopoldo pela LMG-800)
    const livre = await route({ origin: MG_A, destination: MG_B, vehicle: UTILITARIO, departure_at: DEP });
    expect(livre.status, JSON.stringify(livre.body)).toBe(200);
    livreLine = lineOf(livre.body);
    const m = midpointOf(livre.body);
    ponto = [m.lon, m.lat];
    const props: PontoCriticoProps = {
      orgao: 'DER-MG', uf: 'MG', ativo: true, objectid: -1, rodovia: 'MG-TESTE', municipio: 'Teste',
      situacao: 'interrompida_pesados', trafeg_variante: 'Pista interrompida para veículos pesados', status: 'Em andamento',
      causa: 'Danos na estrutura da OAE', fonte_url: 'teste automatizado',
      bloqueio: { pontos: [ponto], raio_m: 20, ajuste: 'teste' },
    };
    const r = await pool.query<{ id: string }>(
      `insert into data_features (layer_id, source, source_id, name, kind, geom, props, valid_to)
       values ('rodovias_estaduais', $1, 'pc_pesados', 'Ponto crítico de teste', 'ponto_critico',
               ST_SetSRID(ST_MakePoint($2, $3), 4326), $4::jsonb, now() + interval '2 hours')
       returning id::text`,
      [TEST_SOURCE, ponto[0], ponto[1], JSON.stringify(props)],
    );
    fixtureId = r.rows[0].id;
  });
  afterAll(async () => { await pool.query(`delete from data_features where source = $1`, [TEST_SOURCE]); });

  it('carreta desvia do ponto ativo', async () => {
    const r = await route({ origin: MG_A, destination: MG_B, vehicle: CARRETA, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(200);
    expect(distM(r.body, ponto)).toBeGreaterThan(25);
    expect(r.body.avoided.some((a: any) => a.layer === 'rodovias_estaduais' && a.id === fixtureId)).toBe(true);
    expect(warnsOf(r.body, 'pc_desvio').some((w: any) => w.id === fixtureId)).toBe(true);
  });

  it('VUC também desvia: o DER-MG não define "pesado" e a definição de VUC do app não limita o PBT', async () => {
    const r = await route({ origin: MG_A, destination: MG_B, vehicle: VUC, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(distM(r.body, ponto)).toBeGreaterThan(25);
    expect(r.body.avoided.some((a: any) => a.layer === 'rodovias_estaduais' && a.id === fixtureId)).toBe(true);
    expect(warnsOf(r.body, 'pc_pesados_liberado').some((w: any) => w.id === fixtureId)).toBe(false);
  });

  it('utilitário (3,5 t, não é caminhão) passa pelo ponto, com aviso para conferir a sinalização', async () => {
    const r = await route({ origin: MG_A, destination: MG_B, vehicle: UTILITARIO, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(distM(r.body, ponto)).toBeLessThan(25);
    expect(r.body.avoided.some((a: any) => a.id === fixtureId)).toBe(false);
    const w = warnsOf(r.body, 'pc_pesados_liberado').find((x: any) => x.id === fixtureId);
    expect(w?.severity).toBe('warn');
    expect(w?.message).toMatch(/até 3,5 t/);
  });

  it('destino no próprio ponto: não bloqueia e avisa (pc_origem_destino, política da ZMRC)', async () => {
    const r = await route({ origin: MG_A, destination: { lon: ponto[0], lat: ponto[1] }, vehicle: CARRETA, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(200);
    expect(r.body.avoided.some((a: any) => a.id === fixtureId)).toBe(false);
    const w = warnsOf(r.body, 'pc_origem_destino').find((x: any) => x.id === fixtureId);
    expect(w?.severity).toBe('danger');
    expect(w?.message).toMatch(/^O destino fica/);
    expect(warnsOf(r.body, 'pc_bloqueio_na_rota').some((x: any) => x.id === fixtureId)).toBe(false);
  });

  it('destino ~300 m adiante, em outra aresta do grafo: a carreta continua desviando (sem isenção)', async () => {
    const d = adiante(300);
    const r = await route({ origin: MG_A, destination: d, vehicle: CARRETA, departure_at: DEP });
    expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(200);
    expect(distM(r.body, ponto)).toBeGreaterThan(20);   // não entra no círculo de bloqueio
    expect(r.body.avoided.some((a: any) => a.layer === 'rodovias_estaduais' && a.id === fixtureId)).toBe(true);
    expect(warnsOf(r.body, 'pc_origem_destino').some((x: any) => x.id === fixtureId)).toBe(false);
  });

  it('isenção só na aresta cortada pelo círculo (/locate); ponto vencido (valid_to no passado) não bloqueia', async () => {
    const ctx = (d: { lat: number; lon: number }): RouteCtx => ({
      vehicle: resolveVehicle(CARRETA as any), at: new Date(), departureLocal: DEP, origin: MG_A, destination: d, tz: 'America/Sao_Paulo',
    });
    const ids = async (d: { lat: number; lon: number }) => (await layer.exclusions!(ctx(d))).map((e) => e.item.id);
    expect(await ids(MG_B)).toContain(fixtureId);
    // ~100 m adiante, fora do círculo (20 m) mas na mesma aresta da LMG-800 (535 m): o círculo tiraria a aresta inteira
    // do grafo e isolaria o destino -> não bloqueia (annotate avisa)
    expect(await ids(adiante(100))).not.toContain(fixtureId);
    // ~300 m adiante, já na aresta seguinte: bloqueia
    expect(await ids(adiante(300))).toContain(fixtureId);
    await pool.query(`update data_features set valid_to = now() - interval '1 minute' where id = $1`, [fixtureId]);
    expect(await ids(MG_B)).not.toContain(fixtureId);
    await pool.query(`update data_features set valid_to = now() + interval '2 hours' where id = $1`, [fixtureId]);
  });
});

describe('DER-ES: ES-060 km 33–39, PBT > 23 t (IS 003-N/2024)', () => {
  beforeAll(async () => { await waitForStack(); });

  it('carreta (41,5 t) é desviada do trecho; toco (16 t) passa e o resumo diz que a regra não o alcança', async () => {
    const carreta = await route({ origin: ES060_A, destination: ES060_B, vehicle: CARRETA, departure_at: DEP });
    expect(carreta.status).toBe(200);
    const id = carreta.body.avoided.find((a: any) => a.layer === 'rodovias_estaduais' && a.type === 'regra_trecho')?.id;
    expect(id, 'a carreta deveria evitar o trecho da IS 003-N/2024').toBeTruthy();
    expect(warnsOf(carreta.body, 'regra_estadual_desvio').some((w: any) => /003-N/.test(w.message))).toBe(true);

    const toco = await route({ origin: ES060_A, destination: ES060_B, vehicle: TOCO, departure_at: DEP });
    expect(toco.status).toBe(200);
    expect(toco.body.distance_km).toBeLessThan(carreta.body.distance_km);
    expect((toco.body.layers.rodovias_estaduais?.summary ?? []).some((s: string) => /não alcança o seu veículo/.test(s))).toBe(true);
  });
});

describe('DER-ES: Ponte sobre o Rio Jacarandá, ES-476, PBT máx. 12 t (camada oae, source der-es)', () => {
  beforeAll(async () => { await waitForStack(); });

  it('toco (16 t) desvia da ponte; VUC (9 t) passa com aviso de restrição que não o alcança', async () => {
    const toco = await route({ origin: JAC_A, destination: JAC_B, vehicle: TOCO, departure_at: DEP });
    expect(toco.status).toBe(200);
    expect(distM(toco.body, JAC_PONTE)).toBeGreaterThan(25);
    expect(toco.body.avoided.some((a: any) => a.layer === 'oae' && /Jacarand/.test(a.name ?? ''))).toBe(true);
    const vuc = await route({ origin: JAC_A, destination: JAC_B, vehicle: VUC, departure_at: DEP });
    expect(vuc.status).toBe(200);
    expect(distM(vuc.body, JAC_PONTE)).toBeLessThan(25);
    expect((vuc.body.warnings as any[]).some((w) => w.layer === 'oae' && w.code === 'oae_restricao_nao_aplica' && /Jacarand/.test(w.message))).toBe(true);
  });
});

describe('DER-RJ: RJ-127 (Serra de Paracambi) registrada e desativada', () => {
  beforeAll(async () => { await waitForStack(); });

  it('não bloqueia o toco e avisa que a regra não é aplicada', async () => {
    const r = await route({ origin: RJ_A, destination: RJ_B, vehicle: TOCO, departure_at: DEP });
    expect(r.status).toBe(200);
    expect(r.body.avoided.some((a: any) => a.layer === 'rodovias_estaduais')).toBe(false);
    const w = warnsOf(r.body, 'regra_estadual_nao_aplicada').find((x: any) => /RJ-127/.test(x.message));
    expect(w?.severity).toBe('info');
    expect(w?.message).toMatch(/NÃO aplicada/);
  });
});
