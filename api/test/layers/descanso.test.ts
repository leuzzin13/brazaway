/**
 * Camadas "descanso" (PPD, áreas de descanso, SAU, OSM) e "postos_diesel" (ANP) + prioridade no plano de direção.
 * Parte unitária (regras puras) + ponta a ponta contra a API (API_URL) e o banco (TEST_DATABASE_URL).
 * Não cria nem apaga reportes.
 */
import { request } from 'node:http';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, pool, waitForStack } from '../helpers.js';
import { drivingPlan, DRIVING_RULES, type RestStop } from '../../src/services/restStops.js';
import { classify, orderForPlan, withoutForbiddenDailyRest, type RestStopCandidate, type RestTier } from '../../src/services/restStopsData.js';
import { cheapest, type PostoOnRoute } from '../../src/layers/postos_diesel.layer.js';
import { restGaps } from '../../src/layers/descanso.layer.js';

const H = 3600;

/** POST sem o limite de 300 s do fetch (undici headersTimeout): a rota longa, com todas as camadas, pode passar disso
 *  quando o banco compartilhado está carregado. */
function postLong(path: string, body: unknown, timeoutMs = 900_000): Promise<{ status: number; body: any }> {
  const u = new URL(path, API);
  const data = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = request({ hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST', timeout: timeoutMs,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(buf) }); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout de ${timeoutMs} ms em ${path}`)));
    req.on('error', reject);
    req.end(data);
  });
}
const W = DRIVING_RULES.prefer_window_s;

function cand(id: string, etaH: number, tier: RestTier, extra: Partial<RestStopCandidate> = {}): RestStopCandidate {
  return {
    id, name: id, kind: tier === 4 ? 'sau' : tier === 1 ? 'ppd' : 'fuel_hgv', lat: -23, lon: -46, tags: {},
    fraction: 0, distance_km: etaH * 80, eta_s: Math.round(etaH * H), off_route_m: 50,
    source: 'teste', tier, category: `tier ${tier}`, daily_rest_ok: tier !== 4, vagas: null, validade: null, ...extra,
  };
}

describe('descanso — regras (unitário)', () => {
  it('classifica PPD pela validade, PPD de concessão pela entrega e SAU como apoio', () => {
    expect(classify('ppd', 'ppd-mt', { validade: '2029-08-01' }, '2026-10-09')).toMatchObject({ tier: 1, daily_rest_ok: true });
    expect(classify('ppd', 'ppd-mt', { validade: '2025-05-31' }, '2026-10-09')).toMatchObject({ tier: 3 });
    expect(classify('ppd', 'ppd-mt', { validade: '2025-05-31' }, '2026-10-09')!.category).toMatch(/vencida em 31\/05\/2025/);
    expect(classify('ppd_concessao', 'ppd-mt', { operando: true })).toMatchObject({ tier: 1 });
    expect(classify('ppd_concessao', 'ppd-mt', { operando: false })).toBeNull();
    expect(classify('area_descanso', 'artesp', {})).toMatchObject({ tier: 2, daily_rest_ok: true });
    expect(classify('sau', 'antt', {})).toMatchObject({ tier: 4, daily_rest_ok: false });
    expect(classify('fuel_hgv', 'osm', {})).toMatchObject({ tier: 3 });
    // SAU marcado como rest_area no OSM continua sendo só apoio
    expect(classify('rest_area', 'osm', {}, undefined, 'Base Operacional 6')).toMatchObject({ tier: 4, daily_rest_ok: false });
  });

  it('dentro da janela preferida o plano escolhe o tier melhor, não o ponto mais tardio', () => {
    // limite da 1ª pausa: 5h30; janela preferida: 4h00–5h30
    const stops = orderForPlan([cand('posto', 4.2, 3), cand('ppd', 4.1, 1), cand('area', 4.4, 2), cand('sau', 5.4, 4), cand('cedo', 1.0, 3)], W);
    const plan = drivingPlan(7 * H, stops);
    expect(plan.suggested_stops[0].stop?.id).toBe('ppd');
    // sem PPD na janela: área de descanso; sem área: posto; só SAU: SAU (pausa curta é permitida)
    expect(drivingPlan(7 * H, orderForPlan([cand('posto', 4.2, 3), cand('area', 4.4, 2), cand('sau', 5.4, 4)], W)).suggested_stops[0].stop?.id).toBe('area');
    expect(drivingPlan(7 * H, orderForPlan([cand('posto', 4.2, 3), cand('sau', 5.4, 4)], W)).suggested_stops[0].stop?.id).toBe('posto');
    expect(drivingPlan(7 * H, orderForPlan([cand('sau', 5.4, 4)], W)).suggested_stops[0].stop?.id).toBe('sau');
  });

  it('fora da janela, tier melhor só vence se estiver até 1h30 por nível antes', () => {
    // nada na janela (4h–5h30). Escore = direção até o ponto + (4 − tier) × 1h30.
    // PPD às 2h00 (2h00 + 4h30 = 6h30) vence o posto às 3h45 (3h45 + 1h30 = 5h15)
    expect(drivingPlan(7 * H, orderForPlan([cand('ppd', 2.0, 1), cand('posto', 3.75, 3)], W)).suggested_stops[0].stop?.id).toBe('ppd');
    // PPD muito cedo (0h30 + 4h30 = 5h00) perde para o posto às 3h50 (3h50 + 1h30 = 5h20)
    expect(drivingPlan(7 * H, orderForPlan([cand('ppd', 0.5, 1), cand('posto', 3.83, 3)], W)).suggested_stops[0].stop?.id).toBe('posto');
  });

  it('SAU nunca vira o local do descanso de 11 h (em nenhum regime), mas pode servir para a pausa de 30 min', () => {
    // 20 h de direção; único ponto perto do fim do dia é um SAU
    const list = orderForPlan([cand('posto_cedo', 3.0, 3), cand('sau_dia', 9.8, 4), cand('sau_pausa', 8.0, 4)], W);
    for (const employment of [undefined, 'employee', 'autonomous'] as const) {
      const before = drivingPlan(20 * H, list, { employment });
      const filtered = withoutForbiddenDailyRest(list, 20 * H, drivingPlan as never);
      const after = drivingPlan(20 * H, filtered, { employment });
      for (const s of after.suggested_stops) if (s.kind === 'daily_rest' && s.stop) expect((s.stop as RestStopCandidate).daily_rest_ok).toBe(true);
      expect(before.suggested_stops.length).toBeGreaterThan(0);
    }
    const filtered = withoutForbiddenDailyRest(list, 20 * H, drivingPlan as never);
    expect(filtered.some((c) => c.tier === 4)).toBe(true);   // SAU que só serve de pausa continua na lista
  });

  it('trechos sem descanso: mais de 5h30 entre pontos (SAU não conta)', () => {
    const g = restGaps([cand('a', 1, 3), cand('s', 4, 4), cand('b', 8, 2)], 10 * H, 800);
    expect(g).toHaveLength(1);
    expect(g[0].de_s).toBe(1 * H);
    expect(g[0].ate_s).toBe(8 * H);
  });

  it('postos: ordena pelo preço do S10 e desempata pelo desvio', () => {
    const p = (id: string, v: number | null, desvio: number): PostoOnRoute => ({
      id, nome: id, bandeira: null, cnpj: id, municipio: null, uf: null, endereco: null,
      diesel_s10: v === null ? null : { valor: v, data: '2026-10-01' }, diesel_s500: null, km_rota: 1, distancia_m: 10,
      desvio_km: desvio, posicao: 'pmqc', aceita_caminhao: null, lat: 0, lon: 0,
    });
    const top = cheapest([p('a', 6.99, 0), p('b', 6.49, 2), p('c', null, 0), p('d', 6.49, 0.5), p('e', 7.2, 0)], 'diesel_s10', 3);
    expect(top.map((x) => x.id)).toEqual(['d', 'b', 'a']);
  });
});

// Barueri (Grande SP) → Barra da Tijuca (Rio): ~520 km pelo Rodoanel, Carvalho Pinto e Dutra, ~6h30 de direção.
const BARUERI = { lat: -23.5050, lon: -46.8750 };
const RIO_BARRA = { lat: -22.9990, lon: -43.3650 };
// Dutra (Guarulhos) → Marginal Tietê (Barra Funda)
const GUARULHOS_DUTRA = { lat: -23.4660, lon: -46.5150 };
const BARRA_FUNDA = { lat: -23.5180, lon: -46.6700 };
const WEEKDAY = '2026-10-14T06:00';

describe('descanso — ponta a ponta', () => {
  let longa: any;
  beforeAll(async () => {
    await waitForStack();
    const r = await postLong('/api/route', { origin: BARUERI, destination: RIO_BARRA, vehicle: { preset: 'carreta' }, departure_at: WEEKDAY });
    expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(200);
    longa = r.body;
  }, 960_000);

  it('camadas registradas com fontes e licenças (Fonte: ANP)', async () => {
    const r = await get('/api/layers');
    const d = r.body.find((l: any) => l.id === 'descanso');
    const p = r.body.find((l: any) => l.id === 'postos_diesel');
    expect(d?.has_features && d?.annotates_route).toBe(true);
    expect(p?.has_features && p?.annotates_route).toBe(true);
    expect(p.sources.some((s: any) => /^Fonte: ANP/.test(s.name) && /CC-BY/.test(s.license))).toBe(true);
    expect(d.sources.map((s: any) => s.license).join(' ')).toMatch(/CC-BY/);
  });

  it('features: PPD de Guararema vencido, área de descanso da Ecovias e SAU com ícones por tipo', async () => {
    const r = await get('/api/layers/descanso/features?bbox=-46.60,-23.95,-46.05,-23.25&zoom=10');
    expect(r.status).toBe(200);
    const fs = r.body.features as any[];
    const batistella = fs.find((f) => /Batistella/i.test(f.properties.name));
    expect(batistella?.properties.tipo).toBe('PPD com certificação vencida');
    expect(batistella?.properties.validade).toBe('31/05/2025');
    expect(batistella?.properties.vagas).toBeGreaterThan(0);
    const ecovias = fs.find((f) => f.properties.tipo === 'Área de descanso de concessionária');
    expect(ecovias?.properties.prioridade).toMatch(/^2/);
    const sau = fs.find((f) => /^SAU/.test(f.properties.tipo));
    expect(sau?.properties.descanso_11h).toMatch(/não/);
    const icons = new Set(fs.map((f) => f.properties.icon));
    expect(icons.size).toBeGreaterThanOrEqual(3);
  });

  it('postos_diesel: features com preço e data da coleta', async () => {
    const r = await get('/api/layers/postos_diesel/features?bbox=-46.75,-23.56,-46.45,-23.44&zoom=12');
    expect(r.status).toBe(200);
    const comPreco = (r.body.features as any[]).filter((f) => f.properties.diesel_s10);
    expect(comPreco.length).toBeGreaterThan(5);
    expect(comPreco[0].properties.diesel_s10).toMatch(/^R\$ \d+,\d{2} \(coleta \d{2}\/\d{2}\/\d{4}\)$/);
    expect(comPreco[0].properties.fonte).toMatch(/Fonte: ANP/);
  });

  it('rota longa SP→Rio: a pausa de 30 min prioriza PPD/área de descanso da janela, não o ponto mais tardio', () => {
    expect(longa.duration_s).toBeGreaterThan(DRIVING_RULES.max_continuous_driving_s);
    const plan = longa.driving_plan;
    const first = plan.suggested_stops[0];
    expect(first?.stop, JSON.stringify(plan)).toBeTruthy();
    // 1ª pausa: limite = 5h30 de direção; janela preferida = última 1h30
    const limit = DRIVING_RULES.max_continuous_driving_s;
    const janela = (longa.rest_stops as any[]).filter((s) => s.eta_s >= limit - W && s.eta_s <= limit);
    const melhor = Math.min(...janela.map((s) => s.tier));
    expect(first.stop.tier).toBe(melhor);
    if (melhor <= 2) expect(['ppd', 'ppd_concessao', 'area_descanso']).toContain(first.stop.kind);
    // a prioridade venceu a regra antiga ("o mais tardio da janela"): havia ponto pior depois dele
    expect(janela.some((s) => s.eta_s > first.stop.eta_s && s.tier > first.stop.tier)).toBe(true);
    expect(first.message).toMatch(/PPD|Área de descanso/);
  });

  it('rota longa: rest_stops traz as fontes novas no formato antigo (+ campos de prioridade); SAU nunca é descanso de 11 h', () => {
    const rs = longa.rest_stops as any[];
    for (const s of rs) {
      for (const k of ['id', 'kind', 'lat', 'lon', 'distance_km', 'eta_s', 'off_route_m', 'tags']) expect(s).toHaveProperty(k);
      expect([1, 2, 3, 4]).toContain(s.tier);
    }
    const fontes = new Set(rs.map((s) => s.source));
    for (const f of ['ppd-mt', 'antt', 'osm']) expect(fontes.has(f), [...fontes].join(',')).toBe(true);
    expect(rs.some((s) => s.tier === 4 && s.daily_rest_ok === false)).toBe(true);
    for (const s of longa.driving_plan.suggested_stops) {
      if (s.kind === 'daily_rest' && s.stop) expect(s.stop.daily_rest_ok).toBe(true);
    }
    const d = longa.layers.descanso;
    expect(d.summary[0]).toMatch(/PPD válido/);
    expect(d.data.ppd_validos.length).toBeGreaterThanOrEqual(1);
    expect(d.data.apoio_sau.every((s: any) => s.descanso_11h === false)).toBe(true);
  });

  it('postos com preço numa rota pela Dutra e Marginal Tietê: 5 mais baratos a até 2 km, com data e desvio, e média', async () => {
    const r = await postLong('/api/route', { origin: GUARULHOS_DUTRA, destination: BARRA_FUNDA, vehicle: { preset: 'carreta' }, departure_at: '2026-10-14T22:00' });
    expect(r.status, JSON.stringify(r.body).slice(0, 500)).toBe(200);
    const p = r.body.layers.postos_diesel;
    expect(p, JSON.stringify(Object.keys(r.body.layers))).toBeTruthy();
    const top = p.data.mais_baratos_s10 as any[];
    expect(top.length).toBe(5);
    for (let i = 1; i < top.length; i++) expect(top[i].diesel_s10.valor).toBeGreaterThanOrEqual(top[i - 1].diesel_s10.valor);
    for (const x of top) {
      expect(x.diesel_s10.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(x.distancia_m).toBeLessThanOrEqual(2000);
      expect(typeof x.desvio_km).toBe('number');
    }
    expect(p.data.media_s10.media).toBeGreaterThanOrEqual(p.data.media_s10.minimo);
    expect(p.data.media_s10.media).toBeLessThanOrEqual(p.data.media_s10.maximo);
    expect(p.summary.join('\n')).toMatch(/Fonte: ANP/);
    expect(p.summary.join('\n')).toMatch(/média R\$ \d+,\d{2}/);
  }, 900_000);

  it('banco: só 1 PPD certificado na Grande SP e com certificação vencida (limitação documentada)', async () => {
    const r = await pool.query(`select props->>'validade' v from data_features where layer_id = 'descanso' and kind = 'ppd'
      and ST_Intersects(geom, ST_MakeEnvelope(-47.3, -24.1, -45.9, -23.1, 4326))`);
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].v < new Date().toISOString().slice(0, 10)).toBe(true);
  });
});
