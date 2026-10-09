import { beforeAll, describe, expect, it } from 'vitest';
import { CARRETA, get, route, waitForStack } from '../helpers.js';

// Frente "seguranca": camadas acidentes (Infosiga + ARTESP + PRF) e roubo_carga (SSP-SP).
// 2026-10-13 é terça-feira.
const CEAGESP = { lat: -23.5316, lon: -46.74 };          // Vila Leopoldina (sai pela Marginal Tietê)
const GUARULHOS = { lat: -23.4356, lon: -46.4731 };      // Cumbica (Dutra)
const RODOANEL_SUL = { lat: -23.5935, lon: -46.835 };    // Cotia/Osasco, junto ao Rodoanel Oeste
const BARUERI = { lat: -23.497, lon: -46.807 };          // Barueri (Castello Branco)
const RMSP_BBOX = '-46.9,-23.7,-46.4,-23.4';

const layerWarnings = (r: any, layer: string) => r.warnings.filter((w: any) => w.layer === layer);

describe('Camadas de segurança: acidentes e roubo de carga', () => {
  beforeAll(async () => { await waitForStack(); });

  it('catálogo lista as duas camadas com fonte e licença', async () => {
    const r = await get('/api/layers');
    expect(r.status).toBe(200);
    const ac = r.body.find((l: any) => l.id === 'acidentes');
    const rc = r.body.find((l: any) => l.id === 'roubo_carga');
    for (const l of [ac, rc]) {
      expect(l, 'camada não carregada').toBeTruthy();
      expect(l.group).toBe('seguranca');
      expect(l.annotates_route).toBe(true);
      expect(l.affects_route).toBe(false);          // informativas: não mudam a rota
      expect(l.sources.every((s: any) => s.license && s.url)).toBe(true);
    }
    expect(ac.runs.map((x: any) => x.source).sort()).toEqual(['artesp', 'infosiga', 'prf']);
    expect(rc.runs.map((x: any) => x.source)).toEqual(['ssp-sp']);
  });

  it('features de acidentes: pontos agregados com weight, sem registro individual', async () => {
    const r = await get(`/api/layers/acidentes/features?bbox=${RMSP_BBOX}&zoom=11`);
    expect(r.status).toBe(200);
    expect(r.body.type).toBe('FeatureCollection');
    expect(r.body.features.length).toBeGreaterThan(50);
    for (const f of r.body.features) {
      expect(f.geometry.type).toBe('Point');
      expect(f.properties.weight).toBeGreaterThan(0);
      expect(f.properties.weight).toBeLessThanOrEqual(1);
      expect(f.properties.acidentes_caminhao).toBeGreaterThanOrEqual(3);   // mínimo por célula
    }
    // zoom baixo: só os piores
    const far = await get('/api/layers/acidentes/features?bbox=-53,-25,-44,-19&zoom=6');
    expect(far.status).toBe(200);
    expect(far.body.features.every((f: any) => f.properties.nivel === 'muito alto')).toBe(true);
  });

  it('features de roubo de carga: células de 1 km, sem BO nem endereço', async () => {
    const r = await get(`/api/layers/roubo_carga/features?bbox=${RMSP_BBOX}&zoom=11`);
    expect(r.status).toBe(200);
    expect(r.body.features.length).toBeGreaterThan(50);
    for (const f of r.body.features) {
      expect(f.geometry.type).toBe('Polygon');
      expect(f.properties.ocorrencias).toBeGreaterThanOrEqual(3);
      const keys = Object.keys(f.properties).join(' ').toLowerCase();
      expect(keys).not.toMatch(/num_bo|bo\b|numero|logradouro|data_ocorr|hora_ocorr|placa/);
    }
  });

  it('rota pela Marginal Tietê e Dutra às 9h: resumo e avisos das duas camadas', async () => {
    const r = await route({ origin: CEAGESP, destination: GUARULHOS, vehicle: CARRETA, departure_at: '2026-10-13T09:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.warnings.filter((w: any) => w.code === 'layer_error')).toEqual([]);

    const ac = r.body.layers.acidentes;
    expect(ac?.summary?.[0]).toMatch(/ponto\(s\) crítico\(s\) de acidente com caminhão/);
    expect(ac.data.pontos).toBeGreaterThan(0);
    const wa = layerWarnings(r.body, 'acidentes');
    expect(wa.length).toBeGreaterThanOrEqual(1);
    expect(wa.length).toBeLessThanOrEqual(5);
    expect(wa.every((w: any) => w.code === 'accident_hotspot' && w.severity === 'warn' && typeof w.lat === 'number')).toBe(true);
    expect(wa.map((w: any) => w.message).join('\n')).toMatch(/Marginal Tietê|Dutra/);

    const rc = r.body.layers.roubo_carga;
    expect(rc?.summary?.[0]).toMatch(/roubo\/furto de carga/);
    const wr = layerWarnings(r.body, 'roubo_carga');
    expect(wr.length).toBeGreaterThanOrEqual(1);
    expect(wr.every((w: any) => w.code === 'cargo_theft_area' && w.severity === 'warn')).toBe(true);
    expect(wr[0].message).toMatch(/de manhã/);
    // nunca 'danger': são avisos de risco, não restrição legal
    expect([...wa, ...wr].some((w: any) => w.severity === 'danger')).toBe(false);
  });

  it('rota pelo Rodoanel: aviso de trecho crítico do Rodoanel', async () => {
    const r = await route({ origin: RODOANEL_SUL, destination: BARUERI, vehicle: CARRETA, departure_at: '2026-10-13T09:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.layers.acidentes?.summary?.length).toBeGreaterThan(0);
    expect(r.body.layers.roubo_carga?.summary?.length).toBeGreaterThan(0);
    const wa = layerWarnings(r.body, 'acidentes');
    expect(wa.some((w: any) => /Rodoanel/.test(w.message))).toBe(true);
  });

  it('roubo de carga depende do horário: de madrugada o risco na passagem é menor que às 9h', async () => {
    const [manha, madrugada] = await Promise.all([
      route({ origin: CEAGESP, destination: GUARULHOS, vehicle: CARRETA, departure_at: '2026-10-13T09:00' }),
      route({ origin: CEAGESP, destination: GUARULHOS, vehicle: CARRETA, departure_at: '2026-10-13T03:00' }),
    ]);
    expect(manha.status).toBe(200);
    expect(madrugada.status).toBe(200);
    const a = manha.body.layers.roubo_carga.data;
    const b = madrugada.body.layers.roubo_carga.data;
    expect(a.total).toBe(b.total);                       // mesmas áreas (mesma rota)
    expect(a.na_passagem).toBeGreaterThan(b.na_passagem);
    for (const w of layerWarnings(madrugada.body, 'roubo_carga')) expect(w.message).toMatch(/de madrugada/);
    expect(layerWarnings(madrugada.body, 'roubo_carga').length).toBeLessThan(layerWarnings(manha.body, 'roubo_carga').length);
  });
});
