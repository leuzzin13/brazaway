#!/usr/bin/env node
// Gera db/seed/demo/frota_demo.sql a partir de frota_demo.sql.tpl.
// Pede 3 rotas reais ao roteador (POST /api/route, que usa o Valhalla) e produz os pings ao longo das ruas dessas rotas
// (ruído de GPS determinístico). O resultado já está commitado: só rode de novo para mudar rotas/pontos.
//   API_URL=http://localhost:3100 node db/seed/demo/gerar_frota_demo.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const API = process.env.API_URL ?? 'http://localhost:3100';

// ------------------------------------------------------------ rotas (Grande São Paulo)
const ROTAS = {
  // viagem concluída (toco): Vila Leopoldina (CEAGESP) → Guarulhos
  concluida: { origin: { lat: -23.5316, lon: -46.7400 }, destination: { lat: -23.4538, lon: -46.5333 }, vehicle: { preset: 'toco', height_m: 4.0, plate_last_digit: 1 } },
  // em andamento (truck): Barueri → Mooca
  andamento: { origin: { lat: -23.5057, lon: -46.8761 }, destination: { lat: -23.5600, lon: -46.6000 }, vehicle: { preset: 'truck', height_m: 4.2, plate_last_digit: 2 } },
  // planejada atribuída (carreta): São Bernardo do Campo → Cajamar
  planejada: { origin: { lat: -23.6914, lon: -46.5646 }, destination: { lat: -23.3550, lon: -46.8780 }, vehicle: { preset: 'carreta_5e', height_m: 4.4, plate_last_digit: 3 }, departure_at: amanha() },
};
function amanha() { const d = new Date(Date.now() + 86_400_000); return `${d.toISOString().slice(0, 10)}T05:30`; }

// ------------------------------------------------------------ utilidades
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = 6371008.8, rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
function hav(a, b) { const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]); const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); }
function bearing(a, b) { const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1])); const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0])); return (deg(Math.atan2(y, x)) + 360) % 360; }
const r6 = (x) => Math.round(x * 1e6) / 1e6;

class Path {
  constructor(cs) { this.cs = cs; this.cum = [0]; for (let i = 1; i < cs.length; i++) this.cum.push(this.cum[i - 1] + hav(cs[i - 1], cs[i])); this.len = this.cum.at(-1); }
  at(d) {
    d = Math.max(0, Math.min(this.len, d));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= d) lo = m; else hi = m; }
    const seg = this.cum[hi] - this.cum[lo] || 1, f = (d - this.cum[lo]) / seg;
    const a = this.cs[lo], b = this.cs[hi];
    return { lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, heading: bearing(a, b) };
  }
}

/**
 * Percorre a rota gerando pings: a cada 30 s em movimento (velocidade 25-60 km/h por trecho) e a cada 5 min parado.
 * stops = [{ frac, dwell_s }] (fração da rota). Para em `until` (fração) se informado.
 */
function simular(coords, { stops = [], seed = 1, until = 1, endDwell_s = 0 }) {
  const path = new Path(coords), rnd = mulberry32(seed);
  const pings = [], paradas = [];
  let t = 0, d = 0, v = 40;
  const alvo = until * path.len;
  const emit = (dist, speed, accuracy = 6 + rnd() * 8) => {
    const p = path.at(dist);
    // ruído lateral de GPS (até ~8 m) e de velocidade
    const ang = rad(p.heading + 90), off = (rnd() - 0.5) * 16;
    const lat = p.lat + (off * Math.cos(ang)) / 111320, lon = p.lon + (off * Math.sin(ang)) / (111320 * Math.cos(rad(p.lat)));
    pings.push([Math.round(t), r6(lat), r6(lon), Math.round(speed * 10) / 10, Math.round(p.heading), Math.round(accuracy * 10) / 10]);
    return p;
  };
  const fila = stops.map((s) => ({ ...s, dist: s.frac * path.len })).sort((a, b) => a.dist - b.dist);
  emit(0, 0); t += 30;
  while (d < alvo) {
    if (rnd() < 0.12) v = 25 + rnd() * 35;
    let step = (v / 3.6) * 30;
    const prox = fila[0];
    if (prox && d + step >= prox.dist) {
      const chegada = t + (prox.dist - d) / (v / 3.6);
      t = chegada; d = prox.dist;
      const p0 = emit(d, 0, 8);   // chegada (parado)
      const arrive = t;
      for (let k = 300; k < prox.dwell_s; k += 300) { t = arrive + k; emit(d, 0); }
      t = arrive + prox.dwell_s; emit(d, 0, 8);
      paradas.push({ ...prox, lat: r6(p0.lat), lon: r6(p0.lon), arrive_s: Math.round(arrive), depart_s: Math.round(t) });
      fila.shift(); t += 30; continue;
    }
    d += step; t += 30;
    emit(Math.min(d, alvo), v);
  }
  if (endDwell_s) { const a = t; for (let k = 300; k < endDwell_s; k += 300) { t = a + k; emit(alvo, 0); } t = a + endDwell_s; emit(alvo, 0, 8); }
  return { pings, paradas, last_s: Math.round(t), len_m: Math.round(path.len), path };
}

async function rota(body) {
  const res = await fetch(`${API}/api/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`POST /api/route ${res.status}: ${await res.text()}`);
  return res.json();
}
const sqlJson = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'`;
const respResumo = (r) => ({ avoided: r.avoided, warnings: r.warnings, rest_stops: r.rest_stops, driving_plan: r.driving_plan, eta_horario: r.eta_horario, departure_at: r.departure_at });
const geojson = (r) => JSON.stringify({ type: 'LineString', coordinates: r.geometry.coordinates.map((c) => [r6(c[0]), r6(c[1])]) });

// ------------------------------------------------------------ geração
const out = {};
const rc = await rota(ROTAS.concluida), ra = await rota(ROTAS.andamento), rp = await rota(ROTAS.planejada);
for (const [k, r] of [['concluida', rc], ['andamento', ra], ['planejada', rp]]) console.error(`${k}: ${r.distance_km} km, ${Math.round(r.duration_s / 60)} min, ${r.geometry.coordinates.length} vértices`);

// concluída: 2 entregas (paradas manuais), almoço (parada automática) e 1 entrega que falhou
const sc = simular(rc.geometry.coordinates, { seed: 7, stops: [{ frac: 0.30, dwell_s: 900, nome: 'entrega1' }, { frac: 0.55, dwell_s: 1500, nome: 'almoco' }, { frac: 0.82, dwell_s: 780, nome: 'entrega2' }], endDwell_s: 600 });
const e1 = sc.paradas.find((p) => p.nome === 'entrega1'), e2 = sc.paradas.find((p) => p.nome === 'entrega2');
const falha = sc.path.at(0.93 * sc.path.len);
// em andamento: 62% da rota, uma parada (carga) de 12 min
const sa = simular(ra.geometry.coordinates, { seed: 11, stops: [{ frac: 0.25, dwell_s: 720, nome: 'carga' }], until: 0.62 });
const entAnd = [0.45, 0.8, 0.97].map((f) => { const p = new Path(ra.geometry.coordinates).at(f * new Path(ra.geometry.coordinates).len); return { lat: r6(p.lat), lon: r6(p.lon) }; });
const pathP = new Path(rp.geometry.coordinates);
const entPlan = [0.3, 0.65, 0.95].map((f) => { const p = pathP.at(f * pathP.len); return { lat: r6(p.lat), lon: r6(p.lon) }; });

const sub = {
  ROTA_CONCLUIDA: sqlJson(JSON.parse(geojson(rc))), ROTA_ANDAMENTO: sqlJson(JSON.parse(geojson(ra))), ROTA_PLANEJADA: sqlJson(JSON.parse(geojson(rp))),
  RESP_CONCLUIDA: sqlJson(respResumo(rc)), RESP_ANDAMENTO: sqlJson(respResumo(ra)), RESP_PLANEJADA: sqlJson(respResumo(rp)),
  DIST_CONCLUIDA: Math.round(rc.distance_km * 1000), DUR_CONCLUIDA: Math.round(rc.duration_s),
  DIST_ANDAMENTO: Math.round(ra.distance_km * 1000), DUR_ANDAMENTO: Math.round(ra.duration_s),
  DIST_PLANEJADA: Math.round(rp.distance_km * 1000), DUR_PLANEJADA: Math.round(rp.duration_s),
  PINGS_CONCLUIDA: sqlJson(sc.pings), PINGS_ANDAMENTO: sqlJson(sa.pings),
  FIM_CONCLUIDA_S: sc.last_s + 60, ULTIMO_ANDAMENTO_S: sa.last_s,
  ENTREGA1_CHEGADA_S: e1.arrive_s, ENTREGA1_SAIDA_S: e1.depart_s, ENTREGA1_LAT: e1.lat, ENTREGA1_LON: e1.lon,
  ENTREGA2_CHEGADA_S: e2.arrive_s, ENTREGA2_SAIDA_S: e2.depart_s, ENTREGA2_LAT: e2.lat, ENTREGA2_LON: e2.lon,
  FALHA_LAT: r6(falha.lat), FALHA_LON: r6(falha.lon),
  AND_E1_LAT: entAnd[0].lat, AND_E1_LON: entAnd[0].lon, AND_E2_LAT: entAnd[1].lat, AND_E2_LON: entAnd[1].lon, AND_E3_LAT: entAnd[2].lat, AND_E3_LON: entAnd[2].lon,
  PL_E1_LAT: entPlan[0].lat, PL_E1_LON: entPlan[0].lon, PL_E2_LAT: entPlan[1].lat, PL_E2_LON: entPlan[1].lon, PL_E3_LAT: entPlan[2].lat, PL_E3_LON: entPlan[2].lon,
  ORIGEM_CONCLUIDA_LAT: ROTAS.concluida.origin.lat, ORIGEM_CONCLUIDA_LON: ROTAS.concluida.origin.lon, DESTINO_CONCLUIDA_LAT: ROTAS.concluida.destination.lat, DESTINO_CONCLUIDA_LON: ROTAS.concluida.destination.lon,
  ORIGEM_ANDAMENTO_LAT: ROTAS.andamento.origin.lat, ORIGEM_ANDAMENTO_LON: ROTAS.andamento.origin.lon, DESTINO_ANDAMENTO_LAT: ROTAS.andamento.destination.lat, DESTINO_ANDAMENTO_LON: ROTAS.andamento.destination.lon,
  ORIGEM_PLANEJADA_LAT: ROTAS.planejada.origin.lat, ORIGEM_PLANEJADA_LON: ROTAS.planejada.origin.lon, DESTINO_PLANEJADA_LAT: ROTAS.planejada.destination.lat, DESTINO_PLANEJADA_LON: ROTAS.planejada.destination.lon,
};
let tpl = readFileSync(join(here, 'frota_demo.sql.tpl'), 'utf8');
for (const [k, v] of Object.entries(sub)) tpl = tpl.split(`@@${k}@@`).join(String(v));
const falta = tpl.match(/@@[A-Z0-9_]+@@/g);
if (falta) throw new Error(`placeholders sem valor: ${[...new Set(falta)].join(', ')}`);
writeFileSync(join(here, 'frota_demo.sql'), tpl);
console.error(`frota_demo.sql: ${(tpl.length / 1024).toFixed(0)} KB; pings concluída=${sc.pings.length}, em andamento=${sa.pings.length}`);
