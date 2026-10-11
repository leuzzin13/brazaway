import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, pool, route, waitForStack } from '../helpers.js';

/**
 * Frente mun_sudeste: municípios do Sudeste vindos da pesquisa cidade por cidade (docs/research/cidades_sudeste/),
 * na camada genérica restricoes_rmsp (data/raw/municipios/<ibge>.json; doc em docs/layers/municipios/mun_sudeste.md).
 *
 * Os casos de rota ficam em api/test/fixtures/mun_sudeste/<ibge>.json, um por município, gravados por quem importou o
 * município depois de conferir a rota na API real:
 *   { ibge, fonte_id, regras: {<regra_id>: "zona"|"via"|"desativada"|"suspensa"|"revogada"},
 *     casos: [{ regra_id, origin, destination, vehicle, departure_at, departure_fora?, espera: "evita"|"sem_alternativa", nota? }] }
 * "evita": no horário da regra a rota passa (quase) nada pela via/zona; com departure_fora (fora da janela), passa mais.
 * "sem_alternativa": a via é a única ligação; a rota a usa e avisa (rmsp_via_restrita_na_rota).
 */
const LAYER = 'restricoes_rmsp';
const DIR = join(__dirname, '..', 'fixtures', 'mun_sudeste');
type Caso = {
  regra_id: string; origin: { lat: number; lon: number }; destination: { lat: number; lon: number };
  vehicle: Record<string, unknown>; departure_at: string; departure_fora?: string; espera: 'evita' | 'sem_alternativa'; nota?: string;
};
type Fixture = { ibge: string; fonte_id: string; regras: Record<string, string>; casos: Caso[] };
const FIX: Fixture[] = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));
const FONTES = FIX.map((f) => f.fonte_id);

/** km da rota a até tolM das feições da regra (via: as linhas; zona: o polígono recuado 20 m, como na rota) */
async function kmNaRegra(geometry: GeoJSON.LineString, regraId: string, tolM: number): Promise<number> {
  const q = await pool.query(
    `select coalesce(ST_Length(ST_Intersection(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography,
            ST_Buffer(ST_Collect(geom)::geography, $3))::geometry::geography), 0) / 1000 as km
       from data_features where layer_id = $2 and props->>'regra_id' = $4`,
    [JSON.stringify(geometry), LAYER, tolM, regraId]);
  return Number(q.rows[0].km);
}

beforeAll(async () => { await waitForStack(); }, 600_000);
afterAll(async () => { await pool.end(); });

describe('carga e registro', () => {
  it('há fixtures', () => { expect(FIX.length).toBeGreaterThan(0); });

  it('uma fonte por município em data_layer_runs, com licença real e registros', async () => {
    const r = await get('/api/layers');
    const l = r.body.find((x: any) => x.id === LAYER);
    expect(l.runs.map((x: any) => x.source)).toEqual(expect.arrayContaining(FONTES));
    const q = await pool.query(`select distinct on (source) source, license, record_count from data_layer_runs
                                 where layer_id = $1 and source = any($2) order by source, imported_at desc`, [LAYER, FONTES]);
    expect(q.rows.length).toBe(FONTES.length);
    for (const x of q.rows) {
      expect(x.license, x.source).toMatch(/Lei 9\.610\/1998|IBGE|ODbL/i);
      expect(x.record_count, x.source).toBeGreaterThan(0);
    }
  });

  it.each(FIX.map((f) => [f.ibge, f] as const))('%s: kinds por status batem com o arquivo do município', async (_ibge, f) => {
    const q = await pool.query(`select props->>'regra_id' as id, kind from data_features where layer_id = $1 and source = $2 group by 1, 2`,
      [LAYER, f.fonte_id]);
    const k = Object.fromEntries(q.rows.map((x) => [x.id, x.kind]));
    expect(k).toMatchObject(f.regras);
  });

  it('toda regra cita ato, artigo e URL; confiança baixa/unverifiable nunca está ativa', async () => {
    const q = await pool.query(`select distinct on (props->>'regra_id') props from data_features where layer_id = $1 and source = any($2)`, [LAYER, FONTES]);
    expect(q.rows.length).toBeGreaterThan(0);
    for (const { props: p } of q.rows) {
      expect(p.base_legal.length, p.regra_id).toBeGreaterThan(0);
      for (const b of p.base_legal) expect(b.artigo && b.ato && /^https?:\/\//.test(b.url), p.regra_id).toBeTruthy();
      if (['baixa', 'unverifiable'].includes(p.confianca)) expect(p.status, p.regra_id).not.toBe('ativa');
      if (p.status !== 'ativa') expect(p.status_motivo, p.regra_id).toBeTruthy();
    }
  });
});

const CASOS = FIX.flatMap((f) => f.casos.map((c) => [`${f.ibge} ${c.regra_id} (${c.espera})`, f, c] as const));

describe('rotas reais: a rota desvia mesmo?', () => {
  it.each(CASOS)('%s', async (_n, f, c) => {
    const tipo = f.regras[c.regra_id];
    const tol = tipo === 'zona' ? -20 : 10;   // zona: o polígono recuado 20 m (vias-limite livres), como na rota
    const r = await route({ origin: c.origin, destination: c.destination, vehicle: c.vehicle, departure_at: c.departure_at });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const km = await kmNaRegra(r.body.geometry, c.regra_id, tol);
    if (c.espera === 'evita') {
      expect(km, `rota passou ${km.toFixed(3)} km por ${c.regra_id}`).toBeLessThan(0.05);
      expect(r.body.avoided.some((a: any) => a.layer === LAYER)).toBe(true);
      if (c.departure_fora) {
        const fora = await route({ origin: c.origin, destination: c.destination, vehicle: c.vehicle, departure_at: c.departure_fora });
        expect(fora.status).toBe(200);
        expect(await kmNaRegra(fora.body.geometry, c.regra_id, tol), 'fora da janela a rota deveria usar a via/zona').toBeGreaterThan(km);
      }
    } else {
      expect(km).toBeGreaterThan(0);
      expect((r.body.warnings ?? []).some((w: any) => w.code === 'rmsp_via_restrita_na_rota')).toBe(true);
    }
  }, 300_000);
});
