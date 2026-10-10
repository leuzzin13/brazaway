import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pool, route, waitForStack } from '../helpers.js';

/**
 * Balanças do DER-MG (fonte 'der-mg' da camada balancas; importers/sources/weigh_dermg.py, docs/layers/pedagio_estaduais.md).
 * Lista vigente do site do DER-MG (43 postos em operação) + coordenadas da camada pública pracas_pesagem do Observatório
 * da Infraestrutura (a Balancas_V2, de uso restrito, não é usada) + rodovia+km no SRE-MG para quem não tem par.
 */
beforeAll(async () => { await waitForStack(); });

describe('balanças do DER-MG', () => {
  it('importa os postos em operação, sem lado da pista (precisão aproximada) e com o tipo de operação', async () => {
    const q = await pool.query(`select kind, props->>'precisao' prec, props->>'operacao' op, props->>'uf' uf from data_features
      where layer_id = 'balancas' and source = 'der-mg'`);
    expect(q.rows.length).toBeGreaterThanOrEqual(40);
    expect(q.rows.length).toBeLessThanOrEqual(43);
    for (const r of q.rows) {
      expect(r.kind).toBe('fixo');
      expect(['aprox', 'aprox_km']).toContain(r.prec);
      expect(['24 horas', 'estratégica']).toContain(r.op);
      expect(r.uf).toBe('MG');
    }
    const run = await pool.query(`select license from data_layer_runs where layer_id = 'balancas' and source = 'der-mg' order by imported_at desc limit 1`);
    expect(run.rows[0].license).toMatch(/Balancas_V2.*não é usada/);
  });

  it('Itaúna → Divinópolis (MG-050): lista o posto do km 109 (Carmo do Cajuru), com sentido não confirmado', async () => {
    const r = await route({ origin: { lat: -20.075, lon: -44.576 }, destination: { lat: -20.14, lon: -44.89 }, vehicle: { preset: 'carreta', axle_count: 5 }, departure_at: '2026-10-14T10:00' });
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const b = r.body.layers.balancas.data.balancas as any[];
    const p = b.find((x) => x.fontes.includes('der-mg') && /MG-050 km 109/.test(x.nome));
    expect(p, JSON.stringify(b)).toBeTruthy();
    expect(p.tipo).toBe('fixa');
    expect(p.no_sentido).toBe('incerto');
    expect(r.body.layers.balancas.summary.join('\n')).toMatch(/CTB art\. 209/);
  });
});

afterAll(async () => { await pool.end(); });
