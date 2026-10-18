import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as turf from '@turf/turf';
import { pool, route, waitForStack } from '../helpers.js';
import { pool as apiPool } from '../../src/db.js';
import { hazmatInfo, trechoRuleDecision } from '../../src/services/hazmat.js';

/**
 * Camada "perigosos", Sul e Centro-Oeste (importador hazmat_trechos_sudeste, fonte 'sudeste'; pesquisa
 * docs/research/estados_sul_co, verificada em 18/10/2026). Só o RS tem ato estadual de trecho para produtos perigosos:
 *  - Rota do Sol (RSC-453 km 242,17–255,77 e ERS-486 km 0–38,66): DN DAER 127/2019, arts. 1º, 2º e 6º (alterada pela DN 136/2021);
 *  - Estrada do Mar (ERS-389, Osório–Torres): DN DAER 152/2023, art. 8º, § 2º;
 *  - DN DAER 29/2002 (ERS-030/040/118): registrada e NÃO aplicada (vigência não confirmada, km antigos).
 * PR, SC, GO, MT, MS e DF não têm ato vigente por trecho/manancial/túnel/ponte: nenhuma regra (ver docs/layers/perigosos_sudeste.md).
 * 2026-10-13 é terça-feira. Roda contra a API local (API_URL) e o banco (TEST_DATABASE_URL).
 */

type Line = { coords: [number, number][]; bbox: [number, number, number, number] };

async function regraLines(regra: string): Promise<Line[]> {
  const r = await pool.query(
    `select ST_AsGeoJSON(geom, 6)::json as g from data_features
      where layer_id = 'perigosos' and kind = 'trecho_proibido' and props->>'regra_id' = $1 and (valid_to is null or valid_to > now())`, [regra]);
  return r.rows.map((x: any) => ({ coords: x.g.coordinates, bbox: turf.bbox(turf.lineString(x.g.coordinates)) as Line['bbox'] }));
}

/** metros da rota que correm a até `tolM` de alguma das linhas (meio de cada segmento da rota) */
function overlapM(routeBody: any, lines: Line[], tolM = 10): number {
  const cs: [number, number][] = routeBody.geometry.coordinates;
  const pad = 0.0002;
  let m = 0;
  for (let i = 0; i < cs.length - 1; i++) {
    const a = cs[i], b = cs[i + 1];
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const hit = lines.some((l) => mid[0] >= l.bbox[0] - pad && mid[0] <= l.bbox[2] + pad && mid[1] >= l.bbox[1] - pad && mid[1] <= l.bbox[3] + pad
      && turf.pointToLineDistance(turf.point(mid), turf.lineString(l.coords), { units: 'meters' }) <= tolM);
    if (hit) m += turf.distance(a, b, { units: 'meters' });
  }
  return m;
}

const trecho = (body: any, regra: string) => (body.layers.perigosos?.data?.trechos as any[] | undefined)?.find((t) => t.regra_id === regra);

// Torres -> São Francisco de Paula: o caminho natural sobe pela Rota do Sol (BR-101 até Terra de Areia, ERS-486/RSC-453); 137 km
const TORRES = { lat: -29.3350, lon: -49.7270 };
const SAO_FRANCISCO = { lat: -29.4485, lon: -50.5826 };
// dois pontos da própria Estrada do Mar (ERS-389) entre Arroio do Sal e Torres: o caminho natural é a rodovia (28 km)
const MAR_A = { lat: -29.6200, lon: -49.9700 };
const MAR_B = { lat: -29.4300, lon: -49.8100 };
const GASOLINA = { preset: 'truck', hazmat: true, hazmat_un: '1203' };   // classe 3
const CLASSE_9 = { preset: 'truck', hazmat: true, hazmat_un: '3082' };   // classe 9: a DN 127/152 proíbe todo PP
const DIA = '2026-10-13T14:00';

afterAll(async () => { await apiPool.end(); await pool.end(); });

describe('perigosos RS — regras no banco (importador hazmat_trechos_sudeste)', () => {
  let rota: Line[];
  let mar: Line[];
  beforeAll(async () => {
    await waitForStack();
    rota = await regraLines('RS-ROTA-DO-SOL');
    mar = await regraLines('RS-ESTRADA-DO-MAR');
  }, 120_000);

  it('Rota do Sol e Estrada do Mar importadas (dezenas de km de pistas) com ato, artigo e vigência', async () => {
    const km = (ls: Line[]) => ls.reduce((s, l) => s + turf.length(turf.lineString(l.coords), { units: 'kilometers' }), 0);
    expect(km(rota), 'Rota do Sol não importada (importer hazmat_trechos_sudeste)').toBeGreaterThan(90);      // ~52 km x 2 sentidos
    expect(km(mar), 'Estrada do Mar não importada').toBeGreaterThan(140);                                      // ~83 km x 2 sentidos
    const r = await pool.query(
      `select distinct props->>'regra_id' as id, props->>'norma' as norma, props->>'artigo' as artigo, props->>'situacao' as situacao,
              props->>'ativa' as ativa, props->'classes_proibidas' as classes
         from data_features where layer_id = 'perigosos' and kind = 'trecho_proibido' and props->>'uf' = 'RS' order by 1`);
    expect(r.rows).toEqual([
      { id: 'RS-ESTRADA-DO-MAR', norma: 'Decisão Normativa DAER nº 152/2023', artigo: 'art. 8º, § 2º, c/c art. 3º, §§ 2º a 4º', situacao: 'vigente', ativa: 'true', classes: null },
      { id: 'RS-ROTA-DO-SOL', norma: 'Decisão Normativa DAER nº 127/2019 (alterada pela DN 136/2021)', artigo: 'arts. 1º, 2º e 6º', situacao: 'vigente', ativa: 'true', classes: null },
    ]);
  });

  it('DN 29/2002 (ERS-030/040/118) fica registrada e nunca aplicada; PR, SC, GO, MT, MS e DF não têm regra de trecho', async () => {
    const reg = await pool.query(
      `select kind, props->>'ativa' as ativa, props->>'situacao' as situacao, props->>'motivo_inativa' as motivo
         from data_features where layer_id = 'perigosos' and props->>'regra_id' = 'RS-DN-29-2002-ERS-030-040-118'`);
    expect(reg.rows).toHaveLength(1);
    expect(reg.rows[0]).toMatchObject({ kind: 'regra_registrada', ativa: 'false', situacao: 'vigencia_incerta' });
    expect(reg.rows[0].motivo).toMatch(/não aplicada|Registrada e não aplicada/);
    const outras = await pool.query(
      `select count(*)::int as n from data_features where layer_id = 'perigosos' and source = 'sudeste'
          and props->>'uf' in ('PR', 'SC', 'GO', 'MT', 'MS', 'DF')`);
    expect(outras.rows[0].n).toBe(0);
  });

  it('decisão: DN 127/2019 e 152/2023 valem para todas as classes e sem isenção por quantidade', () => {
    const hz = (un: string, kg?: number) => hazmatInfo({ hazmat: true, hazmat_un: un, hazmat_qty_kg: kg } as any);
    for (const id of ['RS-ROTA-DO-SOL', 'RS-ESTRADA-DO-MAR']) {
      const p = { regra_id: id, classes_proibidas: null, isencao_qtd_limitada: false, ativa: true, situacao: 'vigente' };
      expect(trechoRuleDecision(p, hz('3082')).code, id).toBe('aplicada');
      expect(trechoRuleDecision(p, hz('1203', 300)).code, id).toBe('aplicada');
      expect(trechoRuleDecision({ ...p, ativa: false }, hz('1203')).code, id).toBe('inativa');
    }
  });

  it('ONU 1203 de Torres a São Francisco de Paula desvia da Rota do Sol (DN 127/2019, art. 2º)', async () => {
    const livre = await route({ origin: TORRES, destination: SAO_FRANCISCO, vehicle: { preset: 'truck' }, departure_at: DIA });
    expect(livre.status, JSON.stringify(livre.body)).toBe(200);
    expect(overlapM(livre.body, rota)).toBeGreaterThan(30_000);          // sem PP a rota sobe pela Rota do Sol
    expect(livre.body.avoided.some((a: any) => a.layer === 'perigosos')).toBe(false);

    const r = await route({ origin: TORRES, destination: SAO_FRANCISCO, vehicle: GASOLINA, departure_at: DIA });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, rota)).toBeLessThan(500);
    expect(r.body.distance_km).toBeGreaterThan(livre.body.distance_km);
    const av = r.body.avoided.filter((a: any) => a.layer === 'perigosos');
    expect(av.map((a: any) => a.name).join('|')).toMatch(/Rota do Sol/);
    expect(av.find((a: any) => /Rota do Sol/.test(a.name)).rule).toMatch(/Decisão Normativa DAER nº 127\/2019.*arts\. 1º, 2º e 6º/);
    expect(trecho(r.body, 'RS-ROTA-DO-SOL')).toMatchObject({ aplicada: true, decisao: 'aplicada', uf: 'RS' });
  }, 300_000);

  it('ONU 3082 (classe 9) também desvia: a DN 127/2019 proíbe todo produto perigoso', async () => {
    const r = await route({ origin: TORRES, destination: SAO_FRANCISCO, vehicle: CLASSE_9, departure_at: DIA });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, rota)).toBeLessThan(500);
    expect(trecho(r.body, 'RS-ROTA-DO-SOL')).toMatchObject({ aplicada: true, decisao: 'aplicada', classes_proibidas: null });
  }, 300_000);

  it('ONU 1203 entre dois pontos da Estrada do Mar desvia da ERS-389 (DN 152/2023, art. 8º, § 2º); sem PP a rota segue a rodovia', async () => {
    const livre = await route({ origin: MAR_A, destination: MAR_B, vehicle: { preset: 'truck' }, departure_at: DIA });
    expect(livre.status, JSON.stringify(livre.body)).toBe(200);
    const usoLivre = overlapM(livre.body, mar);
    expect(usoLivre).toBeGreaterThan(15_000);

    const r = await route({ origin: MAR_A, destination: MAR_B, vehicle: GASOLINA, departure_at: DIA });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(overlapM(r.body, mar)).toBeLessThan(usoLivre * 0.4);
    const av = r.body.avoided.filter((a: any) => a.layer === 'perigosos');
    expect(av.map((a: any) => a.name).join('|')).toMatch(/Estrada do Mar/);
    expect(av.find((a: any) => /Estrada do Mar/.test(a.name)).rule).toMatch(/Decisão Normativa DAER nº 152\/2023.*art\. 8º, § 2º/);
    expect(trecho(r.body, 'RS-ESTRADA-DO-MAR')).toMatchObject({ aplicada: true, decisao: 'aplicada', uf: 'RS' });
  }, 300_000);
});
