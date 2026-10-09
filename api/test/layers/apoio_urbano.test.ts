import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, minDistM, pool, route, waitForStack } from '../helpers.js';
import { describeWins, windowActive } from '../../src/layers/apoio_urbano.js';

/**
 * Frente apoio_urbano: carga_descarga (Zona Azul Caminhão), corredores_onibus (faixas/corredores) e feiras_livres.
 * Contra a API local com os seeds do GeoSampa carregados (importers: geosampa_zona_azul, geosampa_vaga_caminhao,
 * geosampa_faixa_onibus, geosampa_corredor_onibus, geosampa_feira_livre).
 * Datas: 2026-10-12 = segunda, 2026-10-13 = terça, 2029-12-25 = terça (Natal).
 */
const VUC = { preset: 'vuc' };
const LAPA = { lat: -23.5226, lon: -46.7046 };
const STA_IFIGENIA = { lat: -23.5395, lon: -46.6375 };   // R. dos Andradas / Santa Ifigênia (muitas vagas de caminhão)
const PINHEIROS = { lat: -23.5670, lon: -46.6930 };
const PARAISO = { lat: -23.5760, lon: -46.6400 };          // passa por Teodoro Sampaio, Paulista, Bernardino de Campos
const BUTANTA = { lat: -23.5710, lon: -46.7080 };
const COTIA = { lat: -23.6040, lon: -46.9190 };            // fora do município: a mais de 20 km da vaga mais próxima
// Rua Ministro Godoy (Perdizes): feira "Alto das Perdizes" às terças. O e D ficam 250 m antes/depois da quadra casada.
const GODOY_O = { lat: -23.536846697946153, lon: -46.67113690552912 };
const GODOY_D = { lat: -23.541305302053846, lon: -46.67464009447089 };

const layerWarnings = (r: any, layer: string) => (r.warnings as any[]).filter((w) => w.layer === layer);

describe('apoio_urbano: regras de janela (funções puras)', () => {
  it('janela que cruza a meia-noite (Zona Azul 07:00–02:00) e feriado com janela própria', () => {
    const ws = [{ days: [1, 2, 3, 4, 5], from: '07:00', to: '02:00' }];
    expect(windowActive(ws, new Date('2026-10-13T01:30:00-03:00'))).toBe(true);   // terça 01:30 (vem da segunda)
    expect(windowActive(ws, new Date('2026-10-13T03:00:00-03:00'))).toBe(false);
    expect(windowActive(ws, new Date('2026-10-12T06:59:00-03:00'))).toBe(false);
    expect(windowActive(ws, new Date('2026-10-12T07:00:00-03:00'))).toBe(true);
    // feriado em modo 'own': só valem janelas do dia 8
    expect(windowActive(ws, new Date('2026-10-12T10:00:00-03:00'), { holiday: true, holidayMode: 'own' })).toBe(false);
    expect(windowActive([...ws, { days: [8], from: '08:00', to: '18:00' }], new Date('2026-10-12T10:00:00-03:00'), { holiday: true, holidayMode: 'own' })).toBe(true);
    expect(describeWins([{ days: [1, 2, 3, 4, 5], from: '06:00', to: '09:00' }, { days: [1, 2, 3, 4, 5], from: '17:00', to: '20:00' }, { days: [6], from: '06:00', to: '14:00' }]))
      .toBe('seg–sex 06h–09h e 17h–20h; sáb 06h–14h');
  });
});

describe('apoio_urbano: camadas carga_descarga, corredores_onibus e feiras_livres', () => {
  let godoy: { id: string; mid: [number, number] };

  beforeAll(async () => {
    await waitForStack();
    const r = await pool.query(
      `select id::text, props->'osm'->'mid' as mid from data_features
        where layer_id = 'feiras_livres' and props->>'rua' = 'RUA MIN GODOY' and (props->>'dia')::int = 2 and props ? 'osm'`);
    expect(r.rows.length, 'feira da R. Min. Godoy (terça) não encontrada: rode o importador geosampa_feira_livre').toBe(1);
    godoy = r.rows[0];
  });
  afterAll(async () => { await pool.end(); });

  it('catálogo: três camadas com fonte GeoSampa CC-BY-SA e cargas registradas', async () => {
    const r = await get('/api/layers');
    expect(r.status).toBe(200);
    for (const id of ['carga_descarga', 'corredores_onibus', 'feiras_livres']) {
      const l = r.body.find((x: any) => x.id === id);
      expect(l, `camada ${id} não carregada`).toBeTruthy();
      expect(l.sources.every((s: any) => /CC-BY-SA 4\.0/.test(s.license))).toBe(true);
      expect(l.runs.length, `${id} sem carga em data_layer_runs`).toBeGreaterThan(0);
      expect(l.runs.every((x: any) => x.record_count > 0 && /CC-BY-SA/.test(x.license))).toBe(true);
    }
    expect(r.body.find((x: any) => x.id === 'carga_descarga').affects_route).toBe(false);
    expect(r.body.find((x: any) => x.id === 'feiras_livres').affects_route).toBe(true);
  });

  it('features: vagas de caminhão no centro trazem horário e regra do CAD', async () => {
    const r = await get('/api/layers/carga_descarga/features?bbox=-46.645,-23.548,-46.630,-23.535&zoom=15');
    expect(r.status).toBe(200);
    expect(r.body.features.length).toBeGreaterThan(10);
    const f = r.body.features.find((x: any) => x.properties.vagas > 0 && /seg–sex/.test(x.properties.horario));
    expect(f, 'nenhuma vaga com horário').toBeTruthy();
    expect(f.properties.regra).toMatch(/CAD/);
    expect(f.properties.fonte).toMatch(/CC-BY-SA/);
  });

  it('features: faixas de ônibus da Av. Paulista com horário; zoom baixo não devolve nada', async () => {
    const r = await get('/api/layers/corredores_onibus/features?bbox=-46.665,-23.572,-46.645,-23.555&zoom=14');
    expect(r.status).toBe(200);
    const paulista = r.body.features.filter((x: any) => /Paulista/i.test(x.properties.name));
    expect(paulista.length).toBeGreaterThan(0);
    expect(paulista[0].properties.horario).toMatch(/\d/);
    expect(paulista[0].properties.regra).toMatch(/184/);
    const low = await get('/api/layers/feiras_livres/features?bbox=-46.8,-23.7,-46.4,-23.4&zoom=10');
    expect(low.body.features).toHaveLength(0);
  });

  it('carga_descarga: até 5 vagas a até 1 km do destino, em ordem de distância, com regra e status na chegada', async () => {
    const r = await route({ origin: LAPA, destination: STA_IFIGENIA, vehicle: VUC, departure_at: '2026-10-13T07:30' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const data = r.body.layers.carga_descarga?.data;
    expect(data, 'camada carga_descarga sem resultado').toBeTruthy();
    expect(data.vagas.length).toBeGreaterThan(0);
    expect(data.vagas.length).toBeLessThanOrEqual(5);
    const ds = data.vagas.map((v: any) => v.distancia_m);
    expect(ds).toEqual([...ds].sort((a, b) => a - b));
    expect(Math.max(...ds)).toBeLessThanOrEqual(1000);
    for (const v of data.vagas) expect(v.regra).toMatch(/CAD/);
    expect(data.vagas[0].em_operacao_na_chegada).toBe(true);          // terça ~07:50, Zona Azul 07h–19h
    const w = layerWarnings(r.body, 'carga_descarga');
    expect(w.map((x) => x.code)).toContain('loading_bay_near_destination');
    expect(w.every((x) => x.severity === 'info')).toBe(true);

    const night = await route({ origin: LAPA, destination: STA_IFIGENIA, vehicle: VUC, departure_at: '2026-10-13T22:00' });
    expect(night.status).toBe(200);
    expect(night.body.layers.carga_descarga.data.vagas[0].em_operacao_na_chegada).toBe(false);
  });

  it('carga_descarga: destino fora de São Paulo não gera resultado', async () => {
    const r = await route({ origin: BUTANTA, destination: COTIA, vehicle: VUC, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.layers.carga_descarga).toBeUndefined();
    expect(layerWarnings(r.body, 'carga_descarga')).toHaveLength(0);
  });

  it('corredores_onibus: aviso de faixa exclusiva em operação no pico e nada às 23h30', async () => {
    const r = await route({ origin: PINHEIROS, destination: PARAISO, vehicle: VUC, departure_at: '2026-10-13T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const data = r.body.layers.corredores_onibus?.data;
    expect(data.faixa_em_operacao_m).toBeGreaterThan(1000);
    const w = layerWarnings(r.body, 'corredores_onibus');
    const lane = w.find((x) => x.code === 'bus_lane_active');
    expect(lane?.severity).toBe('warn');
    expect(lane?.message).toMatch(/184/);
    // penalidade desligada por padrão: nenhum aviso 'danger' falso de "trecho restrito" por faixa de ônibus
    if (!data.penalidade?.ativa) expect(w.filter((x) => x.severity === 'danger')).toHaveLength(0);

    const night = await route({ origin: PINHEIROS, destination: PARAISO, vehicle: VUC, departure_at: '2026-10-13T23:30' });
    expect(night.status).toBe(200);
    expect(layerWarnings(night.body, 'corredores_onibus').find((x) => x.code === 'bus_lane_active')).toBeUndefined();
    expect(night.body.layers.corredores_onibus.data.faixa_fora_do_horario_m).toBeGreaterThan(1000);
  });

  it('feiras_livres: segunda passa pela quadra; terça 9h desvia (sem aviso danger); terça 15h e Natal passam', async () => {
    const mid = { lon: godoy.mid[0], lat: godoy.mid[1] };
    const mon = await route({ origin: GODOY_O, destination: GODOY_D, vehicle: VUC, departure_at: '2026-10-12T09:00' });
    expect(mon.status, JSON.stringify(mon.body)).toBe(200);
    expect(minDistM(mon.body, mid), 'pré-condição: sem feira, a rota usa a quadra').toBeLessThan(12);

    const tue = await route({ origin: GODOY_O, destination: GODOY_D, vehicle: VUC, departure_at: '2026-10-13T09:00' });
    expect(tue.status, JSON.stringify(tue.body)).toBe(200);
    expect(minDistM(tue.body, mid)).toBeGreaterThan(12);
    const av = tue.body.avoided.find((a: any) => a.layer === 'feiras_livres');
    expect(av?.id).toBe(godoy.id);
    expect(av?.name).toMatch(/Godoy/);
    expect(av?.rule).toMatch(/ter 07h–14h45/);
    expect(tue.body.warnings.filter((w: any) => w.layer === 'feiras_livres' && w.severity === 'danger')).toHaveLength(0);
    expect(tue.body.layers.feiras_livres.summary.join(' ')).toMatch(/Desvio de 1/);

    for (const when of ['2026-10-13T15:00', '2029-12-25T09:00']) {
      const r = await route({ origin: GODOY_O, destination: GODOY_D, vehicle: VUC, departure_at: when });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(minDistM(r.body, mid), `${when}: sem feira, a rota deveria usar a quadra`).toBeLessThan(12);
      expect(r.body.avoided.find((a: any) => a.layer === 'feiras_livres')).toBeUndefined();
    }
  });

  it('feiras_livres: destino na quadra da feira não bloqueia a rota e avisa', async () => {
    const mid = { lon: godoy.mid[0], lat: godoy.mid[1] };
    const r = await route({ origin: GODOY_O, destination: mid, vehicle: VUC, departure_at: '2026-10-13T09:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const w = layerWarnings(r.body, 'feiras_livres');
    const dest = w.find((x) => x.code === 'street_market_at_destination');
    expect(dest?.severity).toBe('warn');
    expect(dest?.message).toMatch(/Decreto 48\.172\/2007/);
    expect(w.find((x) => x.code === 'street_market_on_route' && x.id === godoy.id)).toBeUndefined();
  });
});
