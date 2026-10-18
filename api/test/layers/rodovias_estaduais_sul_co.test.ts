import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, route, waitForStack } from '../helpers.js';
import { criterioTrechoAplica, janelaVale, type CriterioTrecho } from '../../src/layers/rodovias_estaduais.layer.js';
import { resolveVehicle } from '../../src/services/vehicle.js';
import { pool as apiPool } from '../../src/db.js';

/**
 * Frente ders_estaduais, Sul e Centro-Oeste: regras de trecho do DER-PR, DAER-RS, GOINFRA, SINFRA-MT e DER-DF
 * (camada rodovias_estaduais; curadoria em data/raw/ders_estaduais/regras.json; seeds rodovias_estaduais__{der-pr,daer-rs,
 * goinfra,sinfra-mt,der-df}.sql). SC (SIE) e MS (AGESUL) não têm ato vigente de restrição de trecho: nada a testar, a ausência
 * está documentada em docs/layers/rodovias_estaduais.md.
 *
 * Os testes de rota comparam um veículo alcançado pelo ato com um que não é (mesmo trajeto): o alcançado desvia
 * (`regra_estadual_desvio`) ou, sem alternativa, recebe `regra_estadual_na_rota`; o outro passa em silêncio.
 */
const DEP = '2026-10-14T10:00';   // quarta-feira, dia útil sem feriado
const CARRETA = { preset: 'carreta' };   // 5 eixos, 41,5 t, 18,6 m
const TOCO = { preset: 'toco' };   // 2 eixos, 16 t
const BITREM = { preset: 'bitrem' };   // 7 eixos, 57 t, 19,80 m
const RODOTREM = { preset: 'rodotrem' };   // 9 eixos, 74 t, 30 m
const UTILITARIO = { preset: 'utilitario' };

afterAll(async () => { await pool.end(); await apiPool.end(); });

const warnsOf = (r: any, code: string, re?: RegExp) =>
  (r.warnings as any[]).filter((w) => w.layer === 'rodovias_estaduais' && w.code === code && (!re || re.test(w.message)));
const avoidedOf = (r: any, re: RegExp) => (r.avoided as any[]).filter((a) => a.layer === 'rodovias_estaduais' && re.test(a.name ?? ''));

describe('Critérios novos das regras de trecho (sem rota)', () => {
  const v = (o: Record<string, unknown>) => resolveVehicle(o as any);
  const carreta = v(CARRETA), toco = v(TOCO), bitrem = v(BITREM), rodotrem = v(RODOTREM);

  it('comprimento entra com OU: PBT 41,5 t não passa de 45 t, mas 18,6 m passa de 17,5 m (PR-092, Portaria 319/2010)', () => {
    const c: CriterioTrecho = { caminhoes: true, peso_acima_t: 45, comprimento_acima_m: 17.5 };
    expect(criterioTrechoAplica(c, carreta, 2026)).toBe(true);
    expect(criterioTrechoAplica(c, toco, 2026)).toBe(false);
  });
  it('cumulativo exige todos os limites (MT-040, Portaria 010/2023: > 45 t, > 6 eixos e > 16 m)', () => {
    const c: CriterioTrecho = { caminhoes: true, peso_acima_t: 45, eixos_acima: 6, comprimento_acima_m: 16, cumulativo: true };
    expect(criterioTrechoAplica(c, rodotrem, 2026)).toBe(true);
    expect(criterioTrechoAplica(c, carreta, 2026)).toBe(false);   // 41,5 t e 5 eixos: só o comprimento passa
    expect(criterioTrechoAplica(c, bitrem, 2026)).toBe(true);     // 57 t, 7 eixos, 19,80 m
  });
  it('faixas com "ou" (DAER-RS, DN 148/2022: CR6 e CTS11): bitrem de 57 t entra, rodotrem e carreta de 41,5 t não', () => {
    const c: CriterioTrecho = { caminhoes: true, ou: [
      { peso_acima_t: 45, peso_ate_t: 57, comprimento_ate_m: 19.8, eixos_ate: 7 },
      { peso_acima_t: 48.5, peso_ate_t: 58.5, comprimento_ate_m: 18.6, eixos_ate: 7 }] };
    expect(criterioTrechoAplica(c, bitrem, 2026)).toBe(true);
    expect(criterioTrechoAplica(c, rodotrem, 2026)).toBe(false);
    expect(criterioTrechoAplica(c, carreta, 2026)).toBe(false);
    expect(criterioTrechoAplica(c, v({ preset: 'carreta', weight_t: 50, axle_count: 7 }), 2026)).toBe(true);   // CTS11
  });
  it('carga isenta (GOINFRA, art. 4º: perecíveis) e limite "a partir de" (peso_igual_ou_acima_t)', () => {
    const c: CriterioTrecho = { caminhoes: true, eixos_acima: 3, isenta_carga: ['perishable'] };
    expect(criterioTrechoAplica(c, carreta, 2026)).toBe(true);
    expect(criterioTrechoAplica(c, v({ preset: 'carreta', cargo_type: 'perishable' }), 2026)).toBe(false);
    expect(criterioTrechoAplica(c, toco, 2026)).toBe(false);
    expect(criterioTrechoAplica({ caminhoes: true, peso_igual_ou_acima_t: 16 }, toco, 2026)).toBe(true);   // toco = 16 t
  });
  it('janelas: datas, dias da semana e horário local de saída', () => {
    const js = [{ datas: ['2026-11-02'], inicio: '07:00', fim: '20:00' }, { datas: ['2026-02-18'], inicio: '07:00', fim: '12:00' }];
    expect(janelaVale(js, '2026-11-02T09:00')).toBe(true);
    expect(janelaVale(js, '2026-11-02T20:00')).toBe(false);   // fim exclusivo
    expect(janelaVale(js, '2026-11-02T06:59')).toBe(false);
    expect(janelaVale(js, '2026-11-03T09:00')).toBe(false);
    expect(janelaVale(js, '2026-02-18T11:59')).toBe(true);
    expect(janelaVale(js, '2026-02-18T12:00')).toBe(false);   // quarta-feira de cinzas: só até o meio-dia
    const dom = [{ dias_semana: [7], inicio: '06:00', fim: '18:00' }];
    expect(janelaVale(dom, '2026-10-18T10:00')).toBe(true);    // domingo
    expect(janelaVale(dom, '2026-10-17T10:00')).toBe(false);   // sábado
    expect(janelaVale(undefined, '2026-10-17T10:00')).toBe(true);
  });
});

describe('Seeds do Sul e do Centro-Oeste', () => {
  it('toda regra ativa cita ato com artigo/item, tem confiança média ou alta e vigência; inativa tem motivo', async () => {
    const r = await pool.query(
      `select source, source_id, props from data_features where layer_id = 'rodovias_estaduais' and kind = 'regra_trecho'
        and source in ('der-pr','daer-rs','goinfra','sinfra-mt','der-df')`);
    const por: Record<string, number> = {};
    for (const x of r.rows) {
      por[x.source] = (por[x.source] ?? 0) + 1;
      const p = x.props;
      if (p.ativa) {
        expect(p.status, x.source_id).toBe('vigente');
        expect(['alta', 'media'], x.source_id).toContain(p.confianca);
        expect(p.ato, x.source_id).toMatch(/\b(art\.|arts\.|item)/);
      } else {
        expect(p.motivo_inativa, x.source_id).toBeTruthy();
      }
    }
    expect(Object.keys(por).sort()).toEqual(['daer-rs', 'der-df', 'der-pr', 'goinfra', 'sinfra-mt']);
    expect(por['der-pr']).toBeGreaterThanOrEqual(15);
  });
  it('Ponte do Rio Melchior (DF-180, DER-DF) fica registrada e desativada; o Eixão (DF-002) e a Barragem do Paranoá (DF-001) estão ativos', async () => {
    const r = await pool.query(`select source_id, props->>'ativa' as ativa from data_features where layer_id = 'rodovias_estaduais' and source = 'der-df'`);
    const m = new Map(r.rows.map((x) => [x.source_id, x.ativa]));
    expect(m.get('df_180_ponte_rio_melchior_ins14_2021_mais_2_eixos')).toBe('false');
    expect(m.get('df_002_eixao_decreto32563_pesados')).toBe('true');
    expect(m.get('df_001_barragem_paranoa_ins3_2019_mais_2_eixos')).toBe('true');
  });
});

describe('DER-PR: Portaria 280/2020 (PR-447, PBTC 45 t) e Portaria 501/2022 (PRC-476, ponte Manoel Ribas, PBTC 25 t)', () => {
  beforeAll(async () => { await waitForStack(); });
  const CRUZ_MACHADO = { lat: -26.0185, lon: -51.3503 };
  const UNIAO_DA_VITORIA = { lat: -26.2286, lon: -51.087 };
  const BITURUNA = { lat: -26.1608, lon: -51.553 };

  it('carreta de 50 t usa a PR-447 sem alternativa e recebe o alerta; de 44 t passa em silêncio por ela', async () => {
    const pesada = await route({ origin: CRUZ_MACHADO, destination: UNIAO_DA_VITORIA, vehicle: { ...CARRETA, weight_t: 50 }, departure_at: DEP });
    expect(pesada.status).toBe(200);
    const w = warnsOf(pesada.body, 'regra_estadual_na_rota', /280\/2020/);
    expect(w.length, 'a carreta de 50 t deveria receber o alerta da Portaria 280/2020').toBe(1);
    expect(w[0].severity).toBe('danger');
    const leve = await route({ origin: CRUZ_MACHADO, destination: UNIAO_DA_VITORIA, vehicle: { ...CARRETA, weight_t: 44 }, departure_at: DEP });
    expect(leve.status).toBe(200);
    expect(warnsOf(leve.body, 'regra_estadual_na_rota', /280\/2020/)).toHaveLength(0);
    expect(avoidedOf(leve.body, /PR-447/)).toHaveLength(0);
  });
  it('carreta (41,5 t) desvia da ponte de 25 t; toco (16 t) atravessa', async () => {
    const carreta = await route({ origin: UNIAO_DA_VITORIA, destination: BITURUNA, vehicle: CARRETA, departure_at: DEP });
    expect(carreta.status).toBe(200);
    expect(avoidedOf(carreta.body, /PRC-476, ponte Manoel Ribas/)).toHaveLength(1);
    expect(warnsOf(carreta.body, 'regra_estadual_desvio', /501\/2022/)).toHaveLength(1);
    const toco = await route({ origin: UNIAO_DA_VITORIA, destination: BITURUNA, vehicle: TOCO, departure_at: DEP });
    expect(toco.status).toBe(200);
    expect(avoidedOf(toco.body, /PRC-476/)).toHaveLength(0);
  });
});

describe('DAER-RS: Estrada do Mar (DN 152/2023), CR6/CTS11 (DN 148/2022) e Rota do Sol (DN 135/2021)', () => {
  beforeAll(async () => { await waitForStack(); });

  it('Estrada do Mar (ERS-389): carreta (41,5 t, 5 eixos) desvia e faz caminho maior; toco (16 t, 2 eixos) segue pela estrada', async () => {
    const o = { lat: -29.993, lon: -50.135 }, d = { lat: -29.5444, lon: -49.8908 };   // Tramandaí → Arroio do Sal
    const toco = await route({ origin: o, destination: d, vehicle: TOCO, departure_at: DEP });
    const carreta = await route({ origin: o, destination: d, vehicle: CARRETA, departure_at: DEP });
    expect(toco.status).toBe(200);
    expect(carreta.status).toBe(200);
    expect(avoidedOf(toco.body, /Estrada do Mar/)).toHaveLength(0);
    expect(avoidedOf(carreta.body, /Estrada do Mar/)).toHaveLength(1);
    expect(warnsOf(carreta.body, 'regra_estadual_desvio', /152\/2023/).length + warnsOf(carreta.body, 'regra_estadual_desvio', /Estrada do Mar/).length).toBeGreaterThan(0);
    expect(carreta.body.distance_km).toBeGreaterThan(toco.body.distance_km + 10);
  });
  it('DN 148/2022: bitrem de 57 t e 7 eixos (CR6) desvia dos trechos com obras de arte; carreta de 44 t passa', async () => {
    const o = { lat: -28.9, lon: -50.1 }, d = { lat: -28.7, lon: -49.97 };   // ERS-020, Cambará do Sul / Osvaldo Kroeff
    const bitrem = await route({ origin: o, destination: d, vehicle: BITREM, departure_at: DEP });
    const carreta = await route({ origin: o, destination: d, vehicle: { ...CARRETA, weight_t: 44, axle_count: 6 }, departure_at: DEP });
    expect(bitrem.status).toBe(200);
    expect(carreta.status).toBe(200);
    expect(avoidedOf(bitrem.body, /DN 148\/2022/)).toHaveLength(1);
    expect(warnsOf(bitrem.body, 'regra_estadual_desvio', /DN 148\/2022|148\/2022/)).toHaveLength(1);
    expect(avoidedOf(carreta.body, /DN 148\/2022/)).toHaveLength(0);
    expect(bitrem.body.distance_km).toBeGreaterThan(carreta.body.distance_km + 10);
  });
  it('Rota do Sol (DN 135/2021, art. 2º): rodotrem (30 m, 9 eixos, 74 t) desvia; bitrem (57 t, 19,80 m) e carreta passam', async () => {
    const o = { lat: -29.1681, lon: -51.1794 }, d = { lat: -29.5789, lon: -50.0634 };   // Caxias do Sul → Terra de Areia
    const rodotrem = await route({ origin: o, destination: d, vehicle: RODOTREM, departure_at: DEP });
    const bitrem = await route({ origin: o, destination: d, vehicle: BITREM, departure_at: DEP });
    expect(rodotrem.status).toBe(200);
    expect(bitrem.status).toBe(200);
    expect(avoidedOf(rodotrem.body, /Rota do Sol/)).toHaveLength(1);
    expect(avoidedOf(bitrem.body, /Rota do Sol/)).toHaveLength(0);
    expect(rodotrem.body.distance_km).toBeGreaterThan(bitrem.body.distance_km + 20);
  });
});

describe('GOINFRA: Portaria 20/2026 (feriados prolongados, CVC e combinações com mais de 3 eixos, 07h–20h)', () => {
  beforeAll(async () => { await waitForStack(); });
  const O = { lat: -17.302, lon: -49.017 }, D = { lat: -17.745, lon: -48.625 };   // Piracanjuba → Caldas Novas
  const FINADOS = '2026-11-02T09:00', DIA_UTIL = '2026-11-03T09:00', FINADOS_NOITE = '2026-11-02T21:00';

  it('na segunda-feira de Finados, às 9h, a carreta desvia da GO-217; no dia seguinte e depois das 20h faz o caminho direto, só com o aviso informativo', async () => {
    const feriado = await route({ origin: O, destination: D, vehicle: CARRETA, departure_at: FINADOS });
    const util = await route({ origin: O, destination: D, vehicle: CARRETA, departure_at: DIA_UTIL });
    const noite = await route({ origin: O, destination: D, vehicle: CARRETA, departure_at: FINADOS_NOITE });
    expect(feriado.status).toBe(200);
    expect(util.status).toBe(200);
    expect(noite.status).toBe(200);
    expect(avoidedOf(feriado.body, /GO-217/)).toHaveLength(1);
    expect(warnsOf(feriado.body, 'regra_estadual_desvio', /20\/2026|feriados prolongados/)).not.toHaveLength(0);
    expect(avoidedOf(util.body, /GO-217/)).toHaveLength(0);
    expect(warnsOf(util.body, 'regra_estadual_fora_da_janela', /GO-217/)).toHaveLength(1);
    expect(avoidedOf(noite.body, /GO-217/)).toHaveLength(0);
    expect(feriado.body.distance_km).toBeGreaterThan(util.body.distance_km + 10);
  });
  it('carga perecível é isenta (art. 4º) e toco (2 eixos) não é alcançado', async () => {
    const pere = await route({ origin: O, destination: D, vehicle: { ...CARRETA, cargo_type: 'perishable' }, departure_at: FINADOS });
    const toco = await route({ origin: O, destination: D, vehicle: TOCO, departure_at: FINADOS });
    expect(pere.status).toBe(200);
    expect(toco.status).toBe(200);
    expect(avoidedOf(pere.body, /GO-217/)).toHaveLength(0);
    expect(avoidedOf(toco.body, /GO-217/)).toHaveLength(0);
  });
});

describe('SINFRA-MT: Portaria 010/2023 (MT-040/MT-361, Estrada-Parque: > 45 t, > 6 eixos e > 16 m, só com AET)', () => {
  beforeAll(async () => { await waitForStack(); });
  const CUIABA = { lat: -15.5987, lon: -56.0991 }, BARAO = { lat: -16.19, lon: -55.97 };

  it('rodotrem recebe o alerta de trecho restrito na rota; carreta (5 eixos) não é alcançada', async () => {
    const rodotrem = await route({ origin: CUIABA, destination: BARAO, vehicle: RODOTREM, departure_at: DEP });
    const carreta = await route({ origin: CUIABA, destination: BARAO, vehicle: CARRETA, departure_at: DEP });
    expect(rodotrem.status).toBe(200);
    expect(carreta.status).toBe(200);
    const w = warnsOf(rodotrem.body, 'regra_estadual_na_rota', /010\/2023/);
    expect(w).toHaveLength(1);
    expect(w[0].severity).toBe('danger');
    expect(warnsOf(carreta.body, 'regra_estadual_na_rota')).toHaveLength(0);
    expect(avoidedOf(carreta.body, /MT-040/)).toHaveLength(0);
  });
});

describe('DER-DF: Eixão (Decreto 32.563/2010, art. 2º), Eixão do Lazer (Decreto 46.226/2024) e Barragem do Paranoá (Instrução 3/2019)', () => {
  beforeAll(async () => { await waitForStack(); });
  const ASA_SUL = { lat: -15.8267, lon: -47.9218 }, ASA_NORTE = { lat: -15.7633, lon: -47.8796 };
  const LAGO_SUL = { lat: -15.835, lon: -47.845 }, PARANOA = { lat: -15.769, lon: -47.78 };

  it('Eixão: caminhão (carreta e toco) desvia todos os dias; utilitário (3,5 t, não é caminhão) passa em dia útil', async () => {
    const carreta = await route({ origin: ASA_SUL, destination: ASA_NORTE, vehicle: CARRETA, departure_at: DEP });
    const toco = await route({ origin: ASA_SUL, destination: ASA_NORTE, vehicle: TOCO, departure_at: DEP });
    const util = await route({ origin: ASA_SUL, destination: ASA_NORTE, vehicle: UTILITARIO, departure_at: DEP });
    for (const r of [carreta, toco, util]) expect(r.status).toBe(200);
    expect(avoidedOf(carreta.body, /Eixão \(Eixo|Eixo Rodoviário Sul e Norte \(Eixão\)/)).toHaveLength(1);
    expect(warnsOf(carreta.body, 'regra_estadual_desvio', /32\.563\/2010/)).toHaveLength(1);
    expect(avoidedOf(toco.body, /Eixão/)).toHaveLength(1);
    expect(avoidedOf(util.body, /Eixão/)).toHaveLength(0);
  });
  it('Eixão do Lazer: no domingo às 10h até o utilitário desvia; depois das 18h passa', async () => {
    const dom = await route({ origin: ASA_SUL, destination: ASA_NORTE, vehicle: UTILITARIO, departure_at: '2026-10-18T10:00' });
    const noite = await route({ origin: ASA_SUL, destination: ASA_NORTE, vehicle: UTILITARIO, departure_at: '2026-10-18T19:00' });
    expect(dom.status).toBe(200);
    expect(noite.status).toBe(200);
    expect(avoidedOf(dom.body, /Eixão do Lazer/)).toHaveLength(1);
    expect(warnsOf(dom.body, 'regra_estadual_desvio', /46\.226\/2024/)).toHaveLength(1);
    expect(avoidedOf(noite.body, /Eixão do Lazer/)).toHaveLength(0);
  });
  it('Barragem do Paranoá (DF-001): carreta (5 eixos) desvia da barragem; toco (2 eixos) atravessa', async () => {
    const carreta = await route({ origin: LAGO_SUL, destination: PARANOA, vehicle: CARRETA, departure_at: DEP });
    const toco = await route({ origin: LAGO_SUL, destination: PARANOA, vehicle: TOCO, departure_at: DEP });
    expect(carreta.status).toBe(200);
    expect(toco.status).toBe(200);
    expect(avoidedOf(carreta.body, /Barragem do Paranoá/)).toHaveLength(1);
    expect(warnsOf(carreta.body, 'regra_estadual_desvio', /3\/2019/)).toHaveLength(1);
    expect(avoidedOf(toco.body, /Barragem do Paranoá/)).toHaveLength(0);
    expect(carreta.body.distance_km).toBeGreaterThan(toco.body.distance_km + 10);
  });
});
