import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { get, pool, route, waitForStack } from '../helpers.js';
import { describeWins, windowActive } from '../../src/layers/apoio_urbano.js';

/**
 * Frente apoio_urbano: carga_descarga (Zona Azul Caminhão) e corredores_onibus (faixas/corredores de ônibus).
 * Contra a API local com os seeds do GeoSampa carregados (importers: geosampa_zona_azul, geosampa_vaga_caminhao,
 * geosampa_faixa_onibus, geosampa_corredor_onibus).
 * Datas (a tabela holidays precisa ter os feriados nacionais de 2026):
 *  - 2026-10-12 = segunda, FERIADO nacional (N. Sra. Aparecida); 2026-10-13 = terça (dia seguinte ao feriado);
 *  - 2026-10-14 = quarta (dia comum, véspera também comum); 2026-11-02 = segunda, FERIADO nacional (Finados).
 * Nas funções puras o feriado só conta quando passado em `opts`.
 */
const VUC = { preset: 'vuc' };
const LAPA = { lat: -23.5226, lon: -46.7046 };
const STA_IFIGENIA = { lat: -23.5395, lon: -46.6375 };   // R. dos Andradas / Santa Ifigênia (muitas vagas de caminhão)
const PINHEIROS = { lat: -23.5670, lon: -46.6930 };
const PARAISO = { lat: -23.5760, lon: -46.6400 };          // passa por Teodoro Sampaio, Paulista, Bernardino de Campos
const BUTANTA = { lat: -23.5710, lon: -46.7080 };
const COTIA = { lat: -23.6040, lon: -46.9190 };            // fora do município: a mais de 20 km da vaga mais próxima
const CASA_VERDE = { lat: -23.5100, lon: -46.6600 };       // no município, ~2,4 km da vaga mais próxima
// Av. Amador Bueno da Veiga (Penha): faixa à direita seg–sex 06h–09h no sentido leste→oeste e 17h–20h no oeste→leste
const AMADOR_L = { lat: -23.5228, lon: -46.5240 };
const AMADOR_O = { lat: -23.5231, lon: -46.5440 };
// R. Vinte e Quatro de Maio (centro): face de Zona Azul Caminhão seg–sex e sáb 07h–02h (cruza a meia-noite)
const VINTE_E_QUATRO = { lat: -23.54424302, lon: -46.6395535 };
const REPUBLICA = { lat: -23.5432, lon: -46.6425 };

const layerWarnings = (r: any, layer: string) => (r.warnings as any[]).filter((w) => w.layer === layer);
const codes = (r: any, layer: string) => layerWarnings(r, layer).map((w) => w.code);

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
    // em modo 'weekday' (faixas de ônibus) o feriado conta como dia comum
    expect(windowActive(ws, new Date('2026-10-12T10:00:00-03:00'), { holiday: true, holidayMode: 'weekday' })).toBe(true);
    expect(describeWins([{ days: [1, 2, 3, 4, 5], from: '06:00', to: '09:00' }, { days: [1, 2, 3, 4, 5], from: '17:00', to: '20:00' }, { days: [6], from: '06:00', to: '14:00' }]))
      .toBe('seg–sex 06h–09h e 17h–20h; sáb 06h–14h');
  });

  it('madrugada do dia seguinte a um feriado: a janela da véspera (feriado) não vale em modo own', () => {
    const ws = [{ days: [1, 2, 3, 4, 5], from: '07:00', to: '02:00' }];
    const tue0100 = new Date('2026-10-13T01:00:00-03:00');   // a segunda 12/10 foi feriado
    expect(windowActive(ws, tue0100, { prevHoliday: true, holidayMode: 'own' })).toBe(false);
    expect(windowActive(ws, tue0100, { prevHoliday: false, holidayMode: 'own' })).toBe(true);
    // janela de feriado que cruza a meia-noite continua valendo na madrugada seguinte
    expect(windowActive([{ days: [8], from: '20:00', to: '02:00' }], tue0100, { prevHoliday: true, holidayMode: 'own' })).toBe(true);
    // faixa de ônibus ('weekday') ignora o feriado da véspera
    expect(windowActive(ws, tue0100, { prevHoliday: true, holidayMode: 'weekday' })).toBe(true);
  });
});

describe('apoio_urbano: camadas carga_descarga e corredores_onibus', () => {
  beforeAll(async () => { await waitForStack(); });
  afterAll(async () => { await pool.end(); });

  it('catálogo: duas camadas, fonte GeoSampa CC-BY-SA, componente OSM (ODbL) declarado e cargas registradas', async () => {
    const r = await get('/api/layers');
    expect(r.status).toBe(200);
    for (const id of ['carga_descarga', 'corredores_onibus']) {
      const l = r.body.find((x: any) => x.id === id);
      expect(l, `camada ${id} não carregada`).toBeTruthy();
      expect(l.sources.every((s: any) => typeof s.license === 'string' && s.license.trim().length > 0)).toBe(true);
      expect(l.sources.some((s: any) => /CC-BY-SA 4\.0/.test(s.license))).toBe(true);
      expect(l.runs.length, `${id} sem carga em data_layer_runs`).toBeGreaterThan(0);
      expect(l.runs.every((x: any) => x.record_count > 0 && /CC-BY-SA/.test(x.license))).toBe(true);
    }
    const bus = r.body.find((x: any) => x.id === 'corredores_onibus');
    expect(bus.sources.some((s: any) => /ODbL/.test(s.license) && /openstreetmap/i.test(s.url))).toBe(true);
    expect(r.body.find((x: any) => x.id === 'carga_descarga').affects_route).toBe(false);
    expect(r.body.find((x: any) => x.id === 'feiras_livres'), 'feiras_livres saiu desta frente').toBeUndefined();
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
    const bbox = 'bbox=-46.665,-23.572,-46.645,-23.555';
    const r = await get(`/api/layers/corredores_onibus/features?${bbox}&zoom=14`);
    expect(r.status).toBe(200);
    const paulista = r.body.features.filter((x: any) => /Paulista/i.test(x.properties.name));
    expect(paulista.length).toBeGreaterThan(0);
    expect(paulista[0].properties.horario).toMatch(/\d/);
    expect(paulista[0].properties.regra).toMatch(/184/);
    const low = await get(`/api/layers/corredores_onibus/features?${bbox}&zoom=10`);
    expect(low.status).toBe(200);
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

  it('carga_descarga: vaga mais próxima entre 1 e 5 km → aviso no_loading_bay_near_destination com a distância', async () => {
    const r = await route({ origin: LAPA, destination: CASA_VERDE, vehicle: VUC, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const l = r.body.layers.carga_descarga;
    expect(l, 'a 1–5 km de uma vaga a camada deve responder').toBeTruthy();
    expect(l.data.vagas).toHaveLength(0);
    const w = layerWarnings(r.body, 'carga_descarga');
    expect(w.map((x) => x.code)).toEqual(['no_loading_bay_near_destination']);
    expect(w[0].severity).toBe('info');
    expect(w[0].message).toMatch(/a mais próxima fica a \d+,\d km/);
  });

  it('carga_descarga: destino fora de São Paulo não gera resultado', async () => {
    const r = await route({ origin: BUTANTA, destination: COTIA, vehicle: VUC, departure_at: '2026-10-13T10:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.layers.carga_descarga).toBeUndefined();
    expect(layerWarnings(r.body, 'carga_descarga')).toHaveLength(0);
  });

  it('carga_descarga: madrugada depois do feriado — face 07h–02h fora de operação; depois de dia comum, em operação', async () => {
    const after = await route({ origin: REPUBLICA, destination: VINTE_E_QUATRO, vehicle: VUC, departure_at: '2026-10-13T00:50' });
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    const d1 = after.body.layers.carga_descarga.data;
    expect(d1.dia_anterior_feriado).toBe(true);
    const v1 = d1.vagas.find((v: any) => /02h/.test(v.horario));
    expect(v1, 'face da R. Vinte e Quatro de Maio (07h–02h) não veio entre as vagas').toBeTruthy();
    expect(v1.em_operacao_na_chegada).toBe(false);

    const normal = await route({ origin: REPUBLICA, destination: VINTE_E_QUATRO, vehicle: VUC, departure_at: '2026-10-14T00:50' });
    expect(normal.status, JSON.stringify(normal.body)).toBe(200);
    const d2 = normal.body.layers.carga_descarga.data;
    expect(d2.dia_anterior_feriado).toBe(false);
    expect(d2.vagas.find((v: any) => v.id === v1.id)?.em_operacao_na_chegada).toBe(true);
  });

  it('corredores_onibus: aviso de faixa exclusiva em operação no pico e nada às 23h30', async () => {
    const r = await route({ origin: PINHEIROS, destination: PARAISO, vehicle: VUC, departure_at: '2026-10-13T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const data = r.body.layers.corredores_onibus?.data;
    expect(data.faixa_em_operacao_m).toBeGreaterThan(1000);
    const lane = layerWarnings(r.body, 'corredores_onibus').find((x) => x.code === 'bus_lane_active');
    expect(lane?.severity).toBe('warn');
    expect(lane?.message).toMatch(/184/);

    const night = await route({ origin: PINHEIROS, destination: PARAISO, vehicle: VUC, departure_at: '2026-10-13T23:30' });
    expect(night.status).toBe(200);
    expect(codes(night.body, 'corredores_onibus')).not.toContain('bus_lane_active');
    expect(night.body.layers.corredores_onibus.data.faixa_fora_do_horario_m).toBeGreaterThan(1000);
  });

  it('feriado (Finados 08h): faixa segue valendo para caminhão (Portaria 083/16 não libera carga) e a Zona Azul não opera', async () => {
    const r = await route({ origin: PINHEIROS, destination: PARAISO, vehicle: VUC, departure_at: '2026-11-02T08:00' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.layers.corredores_onibus.data.faixa_em_operacao_m).toBeGreaterThan(1000);
    expect(codes(r.body, 'corredores_onibus')).toContain('bus_lane_active');
    const c = r.body.layers.carga_descarga.data;
    expect(c.feriado).toBe(true);
    expect(c.vagas.length).toBeGreaterThan(0);
    expect(c.vagas[0].em_operacao_na_chegada).toBe(false);
  });

  it('corredores_onibus: o horário vale por sentido (Av. Amador Bueno da Veiga, faixa só de um lado em cada pico)', async () => {
    const lo730 = await route({ origin: AMADOR_L, destination: AMADOR_O, vehicle: VUC, departure_at: '2026-10-13T07:30' });
    expect(lo730.status, JSON.stringify(lo730.body)).toBe(200);
    expect(codes(lo730.body, 'corredores_onibus')).toContain('bus_lane_active');
    const d = lo730.body.layers.corredores_onibus.data;
    expect(d.faixa_em_operacao_m).toBeGreaterThan(300);
    // trechos que só existem no outro sentido não contam como "fora do horário" nem aparecem sem horário
    expect(d.faixa_sentido_oposto_m).toBeGreaterThan(0);
    expect(d.faixa_fora_do_horario_m).toBe(0);
    expect(d.trechos.every((t: any) => t.horario !== 'horário não informado')).toBe(true);

    const ol730 = await route({ origin: AMADOR_O, destination: AMADOR_L, vehicle: VUC, departure_at: '2026-10-13T07:30' });
    expect(ol730.status, JSON.stringify(ol730.body)).toBe(200);
    expect(codes(ol730.body, 'corredores_onibus')).not.toContain('bus_lane_active');
    // destino ao lado da faixa do outro sentido (06h–09h, ativa): quem chega de oeste para leste para do lado 17h–20h
    expect(codes(ol730.body, 'corredores_onibus')).not.toContain('destination_on_bus_lane');

    const ol1800 = await route({ origin: AMADOR_O, destination: AMADOR_L, vehicle: VUC, departure_at: '2026-10-13T18:00' });
    expect(ol1800.status, JSON.stringify(ol1800.body)).toBe(200);
    expect(codes(ol1800.body, 'corredores_onibus')).toContain('bus_lane_active');
    expect(codes(ol1800.body, 'corredores_onibus')).toContain('destination_on_bus_lane');
  });
});
