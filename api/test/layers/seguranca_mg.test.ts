import { beforeAll, describe, expect, it } from 'vitest';
import { CARRETA, get, route, waitForStack } from '../helpers.js';

// Frente "seguranca_mg": SEJUSP-MG/REDS como fonte da camada acidentes (docs/layers/seguranca_mg.md).
// 2026-10-13 é terça-feira.
const ANEL_AMAZONAS = { lat: -19.9445, lon: -44.0077 };     // Anel Rodoviário x Av. Amazonas (Gameleira)
const ANEL_CRISTIANO = { lat: -19.8577, lon: -43.9213 };    // Anel Rodoviário x Av. Cristiano Machado (São Paulo/Ipiranga)
const BH_BBOX = '-44.10,-20.05,-43.85,-19.80';
const FONTE = 'SEJUSP-MG (REDS)';

const layerWarnings = (r: any, layer: string) => r.warnings.filter((w: any) => w.layer === layer);

describe('Acidentes em MG: SEJUSP-MG (REDS)', () => {
  beforeAll(async () => { await waitForStack(); });

  it('catálogo: a camada acidentes traz a SEJUSP-MG com licença e a carga registrada', async () => {
    const r = await get('/api/layers');
    expect(r.status).toBe(200);
    const ac = r.body.find((l: any) => l.id === 'acidentes');
    expect(ac, 'camada não carregada').toBeTruthy();
    expect(ac.affects_route).toBe(false);                                // informativa: não muda a rota
    const src = ac.sources.find((s: any) => /SEJUSP-MG/.test(s.name));
    expect(src, 'fonte SEJUSP-MG em meta.sources').toBeTruthy();
    expect(src.license).toMatch(/Decreto MG 48\.383\/2022, art\. 22/);
    expect(src.url).toMatch(/drive\.google\.com/);
    const run = ac.runs.find((x: any) => x.source === 'sejusp-mg');
    expect(run, 'carga da sejusp-mg em data_layer_runs').toBeTruthy();
    expect(run.record_count).toBeGreaterThan(500);
    expect(run.license).toBe(src.license);                               // mesma redação no importador e na API
  });

  it('features em BH: pontos agregados da SEJUSP-MG, sem registro individual e sem BR', async () => {
    const r = await get(`/api/layers/acidentes/features?bbox=${BH_BBOX}&zoom=12`);
    expect(r.status).toBe(200);
    const mg = r.body.features.filter((f: any) => f.properties.fonte === FONTE);
    expect(mg.length).toBeGreaterThan(50);
    for (const f of mg) {
      expect(f.geometry.type).toBe('Point');
      expect(f.properties.acidentes_caminhao).toBeGreaterThanOrEqual(3);   // mínimo por célula
      expect(f.properties.name ?? '').not.toMatch(/^BR-\d{3}/);            // BRs ficam com a PRF
      const keys = Object.keys(f.properties).join(' ').toLowerCase();
      expect(keys).not.toMatch(/ocorrencia|reds|data_fato|horario|latitude|placa/);
    }
    // o Anel Rodoviário (sem registro da PRF no trecho central) fica com o REDS
    expect(mg.some((f: any) => /Anel Rodoviário/.test(f.properties.name))).toBe(true);
  });

  it('rota pelo Anel Rodoviário de BH: resumo de acidentes com pontos da fonte REDS', async () => {
    const r = await route({ origin: ANEL_AMAZONAS, destination: ANEL_CRISTIANO, vehicle: CARRETA, departure_at: '2026-10-13T09:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.warnings.filter((w: any) => w.code === 'layer_error')).toEqual([]);

    const ac = r.body.layers.acidentes;
    expect(ac?.summary?.[0]).toMatch(/ponto\(s\) crítico\(s\) de acidente com caminhão/);
    expect(ac.summary.join('\n')).toMatch(/Fontes?: .*SEJUSP-MG \(REDS\)/);   // atribuição da fonte no resumo
    expect(ac.data.pontos).toBeGreaterThan(0);
    const trechos: any[] = ac.data.trechos;
    expect(trechos.some((t) => t.fontes.includes('sejusp-mg'))).toBe(true);
    expect(trechos.some((t) => t.fontes.includes('sejusp-mg') && /Anel Rodoviário/.test(t.name))).toBe(true);

    const wa = layerWarnings(r.body, 'acidentes');
    expect(wa.length).toBeGreaterThanOrEqual(1);
    expect(wa.length).toBeLessThanOrEqual(5);
    expect(wa.every((w: any) => w.code === 'accident_hotspot' && w.severity === 'warn')).toBe(true);
    expect(wa.map((w: any) => w.message).join('\n')).toMatch(/Anel Rodoviário, Belo Horizonte/);
  });
});
