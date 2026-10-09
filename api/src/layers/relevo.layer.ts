import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env, vehiclePresets } from '../config.js';
import { decodePolyline6 } from '../services/polyline.js';
import { heightAt, heightProfileAt, traceAttributesAt } from '../services/valhalla.js';
import type { Vehicle } from '../services/vehicle.js';
import type { LayerCostLine, LayerWarning, RouteLayer } from './types.js';

/**
 * Relevo / rampa. Depois da rota, consulta um Valhalla COM elevação (tiles gerados com o ANADEM v1, ver
 * scripts/build-elevation.sh e docs/layers/relevo.md):
 *  - trace_attributes (edge_walk sobre a geometria da rota) → rampa máxima de subida por aresta no sentido do percurso
 *    (edge.max_upward_grade, % arredondado para cima), descida, rampa ponderada, comprimento, way_id, ponte/túnel;
 *  - /height ao longo da mesma linha (a cada 30 m) → perfil, km acima do limite e localização do ponto mais íngreme.
 * Compara com config/grade-limits.json (por preset; PBT acima do preset usa a faixa de peso mais restritiva).
 *
 * Não é restrição legal (nenhuma norma proíbe subir X%): os avisos são 'warn' (risco) ou 'info', nunca 'danger'.
 * Valhalla de elevação: VALHALLA_ELEV_URL ou, sem ela, localhost:8003 e depois o principal (VALHALLA_URL) — o primeiro
 * que responde /height com altitude. Se nenhum tiver elevação (ou estiverem fora do ar), a camada simplesmente não anota.
 * Trechos acima do limite "evitar" saem em data.cost_lines_suggested (LayerCostLine no sentido da subida) para uma
 * 2ª rodada de rota; a rota atual não é alterada (ver docs/layers/relevo.md).
 */

// ----------------------------------------------------------------------------------------------- configuração
interface Limits { warn_pct: number; avoid_pct: number; basis?: string }
interface GradeConfig {
  presets: Record<string, Limits>;
  by_weight: { weight_override_ratio: number; tiers: (Limits & { max_weight_t: number })[] };
  descent: { min_weight_t: number; min_drop_m: number; min_avg_pct: number };
  cost_lines: { avoid_factor: number; exclude_road_classes: string[] };
  /** trecho só é reportado se a rampa sustentada passar do limite de atenção em pelo menos min_over_m metros */
  min_over_m: number;
  /** janela (m) da rampa sustentada por classe de via do Valhalla (road_class); "default" para as demais */
  window_m: Record<string, number>;
  max_segment_warnings: number;
}
const DEFAULT_CFG: GradeConfig = {
  presets: {
    vuc: { warn_pct: 15, avoid_pct: 20 }, toco: { warn_pct: 15, avoid_pct: 20 }, truck: { warn_pct: 12, avoid_pct: 15 },
    carreta: { warn_pct: 6, avoid_pct: 8 }, bitrem: { warn_pct: 10, avoid_pct: 12 }, rodotrem: { warn_pct: 6, avoid_pct: 9 },
  },
  by_weight: {
    weight_override_ratio: 1.1,
    tiers: [
      { max_weight_t: 16, warn_pct: 15, avoid_pct: 20 },
      { max_weight_t: 23, warn_pct: 12, avoid_pct: 15 },
      { max_weight_t: 999, warn_pct: 6, avoid_pct: 8 },
    ],
  },
  descent: { min_weight_t: 16, min_drop_m: 150, min_avg_pct: 5 },
  cost_lines: { avoid_factor: 10, exclude_road_classes: ['motorway', 'trunk'] },
  min_over_m: 30,
  window_m: { motorway: 300, trunk: 300, default: 120 },
  max_segment_warnings: 5,
};

let cfgCache: GradeConfig | null = null;
export function gradeConfig(): GradeConfig {
  if (cfgCache) return cfgCache;
  const dir = process.env.CONFIG_DIR ?? resolve(process.cwd(), '..', 'config');
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'grade-limits.json'), 'utf8')) as Partial<GradeConfig>;
    cfgCache = {
      ...DEFAULT_CFG,
      ...raw,
      presets: { ...DEFAULT_CFG.presets, ...(raw.presets ?? {}) },
      by_weight: { ...DEFAULT_CFG.by_weight, ...(raw.by_weight ?? {}) },
      descent: { ...DEFAULT_CFG.descent, ...(raw.descent ?? {}) },
      cost_lines: { ...DEFAULT_CFG.cost_lines, ...(raw.cost_lines ?? {}) },
      window_m: { ...DEFAULT_CFG.window_m, ...(raw.window_m ?? {}) },
    };
  } catch {
    cfgCache = DEFAULT_CFG;
  }
  return cfgCache;
}

const isHighway = (rc: string | null | undefined) => rc === 'motorway' || rc === 'trunk';

function windowFor(roadClass: string | undefined, cfg: GradeConfig): number {
  return (roadClass && cfg.window_m[roadClass]) || cfg.window_m.default || 120;
}

/** Limites do veículo: preset; se o PBT passar do PBT de referência do preset × ratio (ou sem preset), vale o mais restritivo com a faixa de peso. */
export function limitsFor(v: Vehicle, cfg = gradeConfig()): Limits & { source: 'preset' | 'peso' | 'preset+peso' } {
  const tiers = [...cfg.by_weight.tiers].sort((a, b) => a.max_weight_t - b.max_weight_t);
  const tier = tiers.find((t) => v.weight_t <= t.max_weight_t) ?? tiers[tiers.length - 1];
  const preset = cfg.presets[v.id];
  if (!preset) return { warn_pct: tier.warn_pct, avoid_pct: tier.avoid_pct, source: 'peso' };
  const ref = vehiclePresets.presets.find((p) => p.id === v.id)?.weight_t;
  if (ref && v.weight_t > ref * cfg.by_weight.weight_override_ratio) {
    return {
      warn_pct: Math.min(preset.warn_pct, tier.warn_pct), avoid_pct: Math.min(preset.avoid_pct, tier.avoid_pct),
      basis: preset.basis, source: 'preset+peso',
    };
  }
  return { warn_pct: preset.warn_pct, avoid_pct: preset.avoid_pct, basis: preset.basis, source: 'preset' };
}

// ------------------------------------------------------------------------------------- disponibilidade/serviço
/**
 * Qual Valhalla tem elevação: VALHALLA_ELEV_URL se definido ("off" desliga a camada); senão tenta o de elevação local
 * (http://localhost:8003) e o principal (VALHALLA_URL) — assim, depois de trocar o principal pelos tiles com elevação,
 * a camada passa a usá-lo sem configuração. Cada candidato é sondado com /height na origem da rota (cache de 5 min se
 * tem elevação, 1 min se não tem/está fora).
 */
function candidates(): string[] {
  const v = process.env.VALHALLA_ELEV_URL?.trim();
  if (v === 'off') return [];
  const list = v ? [v] : ['http://localhost:8003', env.valhallaUrl];
  return [...new Set(list.map((u) => u.replace(/\/$/, '')))];
}
const probes = new Map<string, { ok: boolean; until: number }>();
function markDown(base: string) { probes.set(base, { ok: false, until: Date.now() + 60_000 }); }
async function hasElevation(base: string, at: { lat: number; lon: number }): Promise<boolean> {
  const c = probes.get(base);
  if (c && Date.now() < c.until) return c.ok;
  let ok = false;
  try { ok = typeof (await heightAt(base, [at]))[0] === 'number'; } catch { ok = false; }
  probes.set(base, { ok, until: Date.now() + (ok ? 300_000 : 60_000) });
  return ok;
}
async function pickBase(at: { lat: number; lon: number }): Promise<string | null> {
  for (const b of candidates()) if (await hasElevation(b, at)) return b;
  return null;
}
function isConnError(e: unknown): boolean {
  const err = e as { name?: string; cause?: { code?: string }; message?: string };
  return err?.name === 'AbortError' || /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|UND_ERR/i.test(`${err?.message} ${err?.cause?.code ?? ''}`);
}

// --------------------------------------------------------------------------------------------- geometria
type LonLat = [number, number];
const R = 6371008.8;
function haversineM(a: LonLat, b: LonLat): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
function cumulative(coords: LonLat[]): number[] {
  const out = [0];
  for (let i = 1; i < coords.length; i++) out.push(out[i - 1] + haversineM(coords[i - 1], coords[i]));
  return out;
}
/** índice i tal que cum[i] <= d < cum[i+1] */
function seek(cum: number[], d: number): number {
  let lo = 0, hi = cum.length - 1;
  if (d <= cum[0]) return 0;
  if (d >= cum[hi]) return Math.max(0, hi - 1);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
  return lo;
}
function pointAt(coords: LonLat[], cum: number[], d: number): LonLat {
  const i = seek(cum, d);
  const seg = cum[i + 1] - cum[i];
  if (!(seg > 0) || i + 1 >= coords.length) return coords[i];
  const t = (d - cum[i]) / seg;
  return [coords[i][0] + (coords[i + 1][0] - coords[i][0]) * t, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * t];
}
const r5 = (v: number) => Math.round(v * 1e5) / 1e5;
const r1 = (v: number) => Math.round(v * 10) / 10;
/** "350 m" ou "1,2 km" */
const fmtLen = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${fmtKm(m)} km`);
const fmtKm = (m: number) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: m < 10000 ? 1 : 0, minimumFractionDigits: m < 10000 ? 1 : 0 });
/** rampa em pt-BR: 1 casa abaixo de 10% ("8,1%"), inteiro acima ("12%") */
const fmtPct = (v: number) => (v < 10 ? `${(Math.round(v * 10) / 10).toLocaleString('pt-BR')}%` : `${Math.round(v)}%`);

/** Divide a linha em pedaços que cabem no service_limits.trace do Valhalla (200 km / 16000 pontos por padrão). */
function chunks(coords: LonLat[], cum: number[], maxM = 150_000, maxPts = 12_000): LonLat[][] {
  const out: LonLat[][] = [];
  let start = 0;
  for (let i = 1; i < coords.length; i++) {
    if (cum[i] - cum[start] > maxM || i - start + 1 > maxPts) {
      const end = Math.max(start + 1, i - 1);
      out.push(coords.slice(start, end + 1));
      start = end;
    }
  }
  if (start < coords.length - 1 || out.length === 0) out.push(coords.slice(start));
  return out;
}

async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (k < items.length) { const i = k++; res[i] = await fn(items[i], i); }
  }));
  return res;
}

// ------------------------------------------------------------------------------------------------- tipos
interface RawEdge {
  max_upward_grade?: number; max_downward_grade?: number; weighted_grade?: number; mean_elevation?: number;
  length?: number; way_id?: number; names?: string[]; bridge?: boolean; tunnel?: boolean; road_class?: string;
  begin_shape_index: number; end_shape_index: number; id?: number;
}
interface Edge {
  up: number | null; down: number | null; weighted: number | null; meanElev: number | null;
  lengthM: number; wayId?: number; name?: string; bridge: boolean; tunnel: boolean; roadClass?: string;
  b: number; e: number; d0: number; d1: number;
}
export interface GradeSegment {
  id: string;
  level: 'evitar' | 'atencao';
  name: string;
  road_class: string | null;
  way_ids: number[];
  /** rampa máxima de subida sustentada (menor entre o Valhalla e a média móvel de window_m no perfil), 1 casa */
  max_up_pct: number;
  /** edge.max_upward_grade bruto do Valhalla (postes de 60 m, % arredondado para cima) */
  max_up_pct_valhalla: number;
  window_m: number;
  length_m: number;
  over_warn_m: number;
  over_avoid_m: number;
  km_from_start: number;
  lat: number; lon: number;
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
  coordinates: LonLat[];
}

const ATTRS = [
  'edge.max_upward_grade', 'edge.max_downward_grade', 'edge.weighted_grade', 'edge.mean_elevation', 'edge.length',
  'edge.way_id', 'edge.names', 'edge.bridge', 'edge.tunnel', 'edge.road_class', 'edge.begin_shape_index', 'edge.end_shape_index',
  'shape',
];
const NO_DATA = -500; // valor que o Valhalla devolve em aresta sem elevação

/** trace_attributes por pedaço; costura shapes e arestas numa linha única (G) com distâncias acumuladas. */
async function traceRoute(base: string, coords: LonLat[], vehicle: Vehicle) {
  const cum0 = cumulative(coords);
  const parts = chunks(coords, cum0);
  const results = await pool(parts, 3, async (part) => {
    try {
      return await traceAttributesAt(base, part, vehicle, ATTRS, { shapeMatch: 'edge_walk', timeoutMs: 20000 });
    } catch (e) {
      if (isConnError(e)) throw e;
      // malha diferente da que gerou a rota (ou geometria fora das arestas): tenta casar por proximidade
      return traceAttributesAt(base, part, vehicle, ATTRS, { shapeMatch: 'map_snap', timeoutMs: 30000 });
    }
  });
  const G: LonLat[] = [];
  const raw: { edge: RawEdge; b: number; e: number }[] = [];
  for (const res of results) {
    const shape = decodePolyline6(res.shape ?? '') as LonLat[];
    if (!shape.length) continue;
    const dropFirst = G.length > 0 && haversineM(G[G.length - 1], shape[0]) < 1;
    const base_ = G.length - (dropFirst ? 1 : 0);
    G.push(...(dropFirst ? shape.slice(1) : shape));
    for (const e of (res.edges ?? []) as RawEdge[]) raw.push({ edge: e, b: base_ + e.begin_shape_index, e: base_ + e.end_shape_index });
  }
  const cum = cumulative(G);
  const edges: Edge[] = raw.map(({ edge, b, e }) => {
    const bi = Math.max(0, Math.min(b, G.length - 1)), ei = Math.max(bi, Math.min(e, G.length - 1));
    const up = edge.max_upward_grade, down = edge.max_downward_grade;
    return {
      up: up == null || up <= NO_DATA ? null : up,
      down: down == null || down <= NO_DATA ? null : down,
      weighted: edge.weighted_grade ?? null,
      meanElev: edge.mean_elevation == null || edge.mean_elevation <= NO_DATA ? null : edge.mean_elevation,
      lengthM: (edge.length ?? 0) * 1000,
      wayId: edge.way_id, name: edge.names?.[0], bridge: !!edge.bridge, tunnel: !!edge.tunnel, roadClass: edge.road_class,
      b: bi, e: ei, d0: cum[bi], d1: cum[ei],
    };
  });
  return { G, cum, edges };
}

/** Perfil (d, h) na mesma escala de distância de G; preenche buracos e "aplaina" pontes/túneis (reta entre as cabeceiras). */
function buildProfile(samples: [number, number | null][], totalM: number, edges: Edge[]): { d: number[]; h: number[] } | null {
  const valid = samples.filter((s) => s[1] != null && Number.isFinite(s[1] as number));
  if (valid.length < 2) return null;
  const lastD = samples[samples.length - 1][0] || 1;
  const k = totalM > 0 ? totalM / lastD : 1;
  const d = samples.map((s) => s[0] * k);
  const h = samples.map((s) => (s[1] == null ? NaN : (s[1] as number)));
  // buracos (NoData): interpolação linear entre vizinhos válidos
  for (let i = 0; i < h.length; i++) {
    if (!Number.isNaN(h[i])) continue;
    let a = i - 1; while (a >= 0 && Number.isNaN(h[a])) a--;
    let b = i + 1; while (b < h.length && Number.isNaN(h[b])) b++;
    h[i] = a < 0 ? h[b] : b >= h.length ? h[a] : h[a] + ((h[b] - h[a]) * (d[i] - d[a])) / (d[b] - d[a] || 1);
  }
  const at = (x: number) => {
    const i = seek(d, x);
    const j = Math.min(i + 1, d.length - 1);
    const t = d[j] > d[i] ? (x - d[i]) / (d[j] - d[i]) : 0;
    return h[i] + (h[j] - h[i]) * Math.max(0, Math.min(1, t));
  };
  // pontes/túneis: o DEM mede o terreno (vale/morro), não o tabuleiro
  for (const e of edges) {
    if (!(e.bridge || e.tunnel) || e.d1 - e.d0 < 1) continue;
    const h0 = at(e.d0), h1 = at(e.d1);
    for (let i = seek(d, e.d0); i < d.length && d[i] <= e.d1; i++) {
      if (d[i] < e.d0) continue;
      h[i] = h0 + ((h1 - h0) * (d[i] - e.d0)) / (e.d1 - e.d0);
    }
  }
  return { d, h };
}

function elevFn(p: { d: number[]; h: number[] }) {
  return (x: number) => {
    const i = seek(p.d, x);
    const j = Math.min(i + 1, p.d.length - 1);
    const t = p.d[j] > p.d[i] ? (x - p.d[i]) / (p.d[j] - p.d[i]) : 0;
    return p.h[i] + (p.h[j] - p.h[i]) * Math.max(0, Math.min(1, t));
  };
}

function ascentDescent(h: number[], thr = 5): { up: number; down: number } {
  if (!h.length) return { up: 0, down: 0 };
  let last = h[0], up = 0, down = 0;
  for (const v of h) {
    const dv = v - last;
    if (Math.abs(dv) >= thr) { if (dv > 0) up += dv; else down -= dv; last = v; }
  }
  return { up, down };
}

/** Descidas contínuas (sem repique maior que `rebound` m). */
function descents(p: { d: number[]; h: number[] }, rebound = 15): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  const { h } = p;
  let top = 0, bottom = 0;
  for (let i = 1; i < h.length; i++) {
    if (h[i] < h[bottom]) bottom = i;
    if (h[i] - h[bottom] > rebound) {
      if (bottom > top) out.push({ a: top, b: bottom });
      top = i; bottom = i;
    } else if (bottom === top && h[i] > h[top]) {
      top = i; bottom = i;
    }
  }
  if (bottom > top) out.push({ a: top, b: bottom });
  return out;
}

function mostCommonName(edges: Edge[]): string {
  const cnt = new Map<string, number>();
  for (const e of edges) if (e.name) cnt.set(e.name, (cnt.get(e.name) ?? 0) + e.lengthM);
  let best = '', n = -1;
  for (const [k, v] of cnt) if (v > n) { best = k; n = v; }
  return best || 'via sem nome';
}
function nameAt(edges: Edge[], d: number): string {
  const e = edges.find((x) => x.d0 <= d && d <= x.d1 && x.name) ?? edges.find((x) => x.d0 >= d && x.name);
  return e?.name ?? 'via sem nome';
}
/** "na Rua X", "no Viaduto Y", "em SP-150" */
function naVia(name: string): string {
  if (name === 'via sem nome') return 'em via sem nome';
  if (/^[A-Z]{2,3}-\d{2,4}\b/.test(name)) return `na ${name}`; // BR-116, SP-150
  if (/^(rua|avenida|av\.|alameda|estrada|rodovia|travessa|ladeira|viela|praça|ponte|marginal|via|passagem|rampa|rotatória|alça|vicinal)\b/i.test(name)) return `na ${name}`;
  if (/^(viaduto|túnel|tunel|complexo|elevado|acesso|anel|rodoanel|corredor|contorno|largo|caminho|trevo)\b/i.test(name)) return `no ${name}`;
  return `em ${name}`;
}
const aPartirDe = (name: string) => naVia(name).replace(/^na /, 'da ').replace(/^no /, 'do ').replace(/^em /, 'de ');

// -------------------------------------------------------------------------------------------------- camada
const layer: RouteLayer = {
  meta: {
    id: 'relevo',
    label: 'Relevo e rampas',
    description: 'Rampa máxima, km acima do limite do veículo e perfil de altitude (Valhalla com elevação ANADEM).',
    group: 'relevo',
    sources: [
      { name: 'ANADEM v1 (ANA/UFRGS), MDT 30 m', url: 'https://metadados.snirh.gov.br/files/anadem_v1_tiles/', license: 'CC-BY-4.0 (derivado do Copernicus DEM © DLR/Airbus)' },
      { name: 'OpenStreetMap (geometria das vias, via Valhalla)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL-1.0' },
    ],
    defaultVisible: false,
  },

  async annotate(ctx, route) {
    const first = route.line.geometry.coordinates[0];
    if (!first) return {};
    const base = await pickBase({ lon: first[0], lat: first[1] });
    if (!base) return {};
    const cfg = gradeConfig();
    const lim = limitsFor(ctx.vehicle, cfg);
    const coords = route.line.geometry.coordinates as LonLat[];
    if (coords.length < 2) return {};
    const t0 = Date.now();

    let traced: Awaited<ReturnType<typeof traceRoute>>;
    let samples: [number, number | null][] = [];
    try {
      traced = await traceRoute(base, coords, ctx.vehicle);
      if (!traced.G.length || !traced.edges.length) return {};
      const totalM = traced.cum[traced.cum.length - 1];
      // /height aceita no máximo service_limits.skadi.max_shape pontos (750 mil): passo maior em rotas muito longas
      const step = Math.max(30, Math.ceil(totalM / 200_000));
      samples = await heightProfileAt(base, traced.G, { resampleDistance: step, timeoutMs: 20000 }).catch((e) => {
        if (isConnError(e)) throw e;
        return [];
      });
    } catch (e) {
      if (isConnError(e)) { markDown(base); return {}; }
      throw e;
    }
    const { G, cum, edges } = traced;
    const totalM = cum[cum.length - 1];
    const withData = edges.filter((e) => e.up != null);
    const lenData = withData.reduce((s, e) => s + (e.d1 - e.d0), 0);
    // tiles sem elevação (ex.: VALHALLA_ELEV_URL apontando para um Valhalla sem DEM): não anota
    if (!withData.length) return {};

    const profile = buildProfile(samples, totalM, edges);
    const elev = profile ? elevFn(profile) : null;

    // ---- rampa "sustentada" por aresta: média móvel centrada de L m sobre o perfil (L por classe de via, ver
    // cfg.window_m). Com L=60 m o DEM de 30 m inventa rampas (erro de 2–4 p.p., >20 p.p. em rodovia encaixada em
    // encosta, ex.: Anchieta na serra); rodovias são projetadas com rampas longas e moderadas (IPR-706), então medimos
    // 300 m nelas e 120 m nas demais (ladeiras urbanas curtas continuam aparecendo).
    const gradeAt = (x: number, L: number): number => {
      if (!elev) return 0;
      let a = x - L / 2, b = x + L / 2;
      if (a < 0) { b = Math.min(totalM, b - a); a = 0; }
      if (b > totalM) { a = Math.max(0, a - (b - totalM)); b = totalM; }
      return b - a < 10 ? 0 : ((elev(b) - elev(a)) / (b - a)) * 100;
    };
    const SUB = 15;
    const stats = edges.map((e) => {
      const L = windowFor(e.roadClass, cfg);
      const len = e.d1 - e.d0;
      const n = Math.max(1, Math.ceil(len / SUB));
      const sub = len / n;
      let maxG = -Infinity, minG = Infinity, peakX = (e.d0 + e.d1) / 2, overWarn = 0, overAvoid = 0;
      if (elev) {
        for (let i = 0; i < n; i++) {
          const x = e.d0 + (i + 0.5) * sub;
          const g = gradeAt(x, L);
          if (g > maxG) { maxG = g; peakX = x; }
          if (g < minG) minG = g;
          if (g > lim.warn_pct) overWarn += sub;
          if (g > lim.avoid_pct) overAvoid += sub;
        }
      }
      // rampa da aresta: as duas fontes têm de concordar (o Valhalla mede o máximo em postes de 60 m e arredonda para
      // cima; a média móvel suaviza o ruído do DEM) — vale o menor dos dois; sem perfil, vale o do Valhalla
      const up = e.up == null ? null : elev ? Math.min(e.up, maxG) : e.up;
      const down = e.down == null ? null : elev ? Math.min(Math.abs(e.down), Math.max(0, -minG)) : Math.abs(e.down);
      return { up, down, peakX, overWarn: elev ? overWarn : Math.min(len, 60), overAvoid: elev ? overAvoid : Math.min(len, 60), window: L };
    });

    // ---- arestas acima do limite de atenção: o Valhalla (edge.max_upward_grade) E a rampa sustentada passam do limite
    const flaggedIdx = edges.map((_, i) => i).filter((i) => edges[i].up != null && (edges[i].up as number) > lim.warn_pct && (stats[i].up as number) > lim.warn_pct);
    const discardedNoise = edges.filter((e, i) => e.up != null && (e.up as number) > lim.warn_pct && !((stats[i].up as number) > lim.warn_pct)).length;
    // agrupa arestas sinalizadas consecutivas (folga de até 50 m entre elas) em trechos
    const groups: number[][] = [];
    for (const i of flaggedIdx) {
      const g = groups[groups.length - 1];
      if (g && edges[i].d0 - edges[g[g.length - 1]].d1 <= 50) g.push(i); else groups.push([i]);
    }
    const segmentsAll: GradeSegment[] = groups.map((g) => {
      const es = g.map((i) => edges[i]);
      const best = g.reduce((m, i) => ((stats[i].up as number) > (stats[m].up as number) ? i : m), g[0]);
      const maxUp = stats[best].up as number;
      const rawMax = Math.max(...es.map((e) => e.up as number));
      const overWarn = g.reduce((s, i) => s + stats[i].overWarn, 0);
      const overAvoid = maxUp > lim.avoid_pct ? g.reduce((s, i) => s + stats[i].overAvoid, 0) : 0;
      // "evitar" exige pelo menos min_over_m acima do limite (pico isolado de 15 m é ruído provável do DEM de 30 m)
      const evitar = maxUp > lim.avoid_pct && overAvoid >= cfg.min_over_m;
      const d0 = es[0].d0, d1 = es[es.length - 1].d1;
      const peak = pointAt(G, cum, stats[best].peakX);
      const a = G[es[0].b], b = G[es[es.length - 1].e];
      const segCoords = G.slice(es[0].b, es[es.length - 1].e + 1);
      const ways = [...new Set(es.map((e) => e.wayId).filter((x): x is number => typeof x === 'number'))];
      return {
        id: `relevo:${ways[0] ?? 'x'}:${Math.round(d0)}`,
        level: evitar ? 'evitar' : 'atencao',
        name: mostCommonName(es),
        road_class: edges[best].roadClass ?? null,
        way_ids: ways,
        max_up_pct: r1(maxUp),
        max_up_pct_valhalla: rawMax,
        window_m: stats[best].window,
        length_m: Math.round(d1 - d0),
        over_warn_m: Math.round(overWarn),
        over_avoid_m: Math.round(overAvoid),
        km_from_start: r1(d0 / 1000),
        lat: r5(peak[1]), lon: r5(peak[0]),
        start: { lat: r5(a[1]), lon: r5(a[0]) },
        end: { lat: r5(b[1]), lon: r5(b[0]) },
        coordinates: segCoords.map(([x, y]) => [r5(x), r5(y)] as LonLat),
      };
    });

    const segments = segmentsAll.filter((x) => x.over_warn_m >= cfg.min_over_m);
    const discardedShort = segmentsAll.length - segments.length;

    // ---- máximos da rota (mesma regra das arestas: menor entre Valhalla e rampa sustentada)
    const idxData = edges.map((_, i) => i).filter((i) => stats[i].up != null);
    const maxIdx = idxData.reduce((m, i) => ((stats[i].up as number) > (stats[m].up as number) ? i : m), idxData[0]);
    const maxUp = Math.max(0, stats[maxIdx].up as number);
    const maxDown = Math.max(0, ...idxData.map((i) => stats[i].down ?? 0));
    const maxUpAt = (() => {
      const p = pointAt(G, cum, stats[maxIdx].peakX);
      return { lat: r5(p[1]), lon: r5(p[0]), name: edges[maxIdx].name ?? 'via sem nome' };
    })();
    const overWarnM = segments.reduce((s, x) => s + x.over_warn_m, 0);
    const overAvoidM = segments.reduce((s, x) => s + (x.level === 'evitar' ? x.over_avoid_m : 0), 0);
    const avoidSegs = segments.filter((s) => s.level === 'evitar').sort((a, b) => b.max_up_pct - a.max_up_pct || b.over_avoid_m - a.over_avoid_m);
    const warnSegs = segments.filter((s) => s.level === 'atencao');

    // ---- perfil resumido
    let profileOut: Record<string, number | [number, number][]> | null = null;
    const histogram: Record<string, number> = {};
    const descentList: { km_from_start: number; length_km: number; drop_m: number; avg_pct: number; lat: number; lon: number; name: string }[] = [];
    if (profile) {
      const { d, h } = profile;
      const { up, down } = ascentDescent(h);
      const n = Math.min(120, d.length);
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const j = Math.round((i * (d.length - 1)) / Math.max(1, n - 1));
        pts.push([Math.round(d[j]) / 1000, Math.round(h[j])]);
      }
      profileOut = {
        step_m: Math.round((d[d.length - 1] - d[0]) / Math.max(1, d.length - 1)),
        min_m: Math.round(Math.min(...h)), max_m: Math.round(Math.max(...h)),
        ascent_m: Math.round(up), descent_m: Math.round(down),
        points: pts,
      };
      // km de subida por faixa de rampa sustentada (passo de 30 m na rota toda; pontes/túneis já aplainados)
      const bins: [string, number][] = [['0-3', 3], ['3-6', 6], ['6-8', 8], ['8-10', 10], ['10-12', 12], ['12-15', 15], ['15-20', 20], ['20+', Infinity]];
      for (const [k] of bins) histogram[k] = 0;
      let downSteep = 0;
      const STEP = 30;
      let ei = 0;
      for (let x = STEP / 2; x < totalM; x += STEP) {
        while (ei < edges.length - 1 && edges[ei].d1 < x) ei++;
        const g = gradeAt(x, windowFor(edges[ei]?.roadClass, cfg));
        const len = Math.min(STEP, totalM - (x - STEP / 2));
        if (g <= -6) downSteep += len;
        if (g <= 0) continue;
        const bin = bins.find(([, hi]) => g < hi) ?? bins[bins.length - 1];
        histogram[bin[0]] += len;
      }
      for (const k of Object.keys(histogram)) histogram[k] = r1(histogram[k] / 1000);
      histogram['descida_6+'] = r1(downSteep / 1000);
      // descidas longas (veículos pesados)
      if (ctx.vehicle.weight_t >= cfg.descent.min_weight_t) {
        for (const { a, b } of descents(profile)) {
          const drop = h[a] - h[b], len = d[b] - d[a];
          if (len <= 0) continue;
          const avg = (drop / len) * 100;
          if (drop >= cfg.descent.min_drop_m && avg >= cfg.descent.min_avg_pct) {
            const p = pointAt(G, cum, d[a]);
            descentList.push({ km_from_start: r1(d[a] / 1000), length_km: r1(len / 1000), drop_m: Math.round(drop), avg_pct: r1(avg), lat: r5(p[1]), lon: r5(p[0]), name: nameAt(edges, d[a]) });
          }
        }
      }
    }

    // ---- avisos (nunca 'danger': rampa não é restrição legal; o DEM erra ~2 p.p.)
    const label = ctx.vehicle.label ?? ctx.vehicle.id;
    const warnings: LayerWarning[] = [];
    // trechos "evitar": rodovias (motorway/trunk) próximos (<= 3 km) da mesma via viram um aviso só (serra)
    const clusters: GradeSegment[][] = [];
    for (const sg of [...avoidSegs].sort((a, b) => a.km_from_start - b.km_from_start)) {
      const c = clusters[clusters.length - 1];
      const last = c?.[c.length - 1];
      if (c && last && isHighway(sg.road_class) && isHighway(last.road_class) && sg.name === last.name
        && sg.km_from_start - (last.km_from_start + last.length_m / 1000) <= 3) c.push(sg);
      else clusters.push([sg]);
    }
    const ranked = clusters
      .map((c) => ({ c, top: c.reduce((m, x) => (x.max_up_pct > m.max_up_pct ? x : m), c[0]) }))
      .sort((a, b) => b.top.max_up_pct - a.top.max_up_pct);
    for (const { c, top } of ranked.slice(0, cfg.max_segment_warnings)) {
      const overAvoid = c.reduce((sum, x) => sum + x.over_avoid_m, 0);
      const k0 = c[0].km_from_start, k1 = c[c.length - 1].km_from_start + c[c.length - 1].length_m / 1000;
      const where = Math.round(k1) > Math.round(k0) ? `km ${Math.round(k0)}–${Math.round(k1)} da rota` : `km ${Math.round(k0)} da rota`;
      warnings.push({
        code: 'steep_grade_avoid', severity: 'warn', id: top.id, lat: top.lat, lon: top.lon,
        message: isHighway(top.road_class)
          ? `Subida forte ${naVia(top.name)} (${where}): até ~${fmtPct(top.max_up_pct)}, com ${fmtLen(overAvoid)} acima de ${lim.avoid_pct}% (recomendado p/ ${label}). Engate marcha reduzida antes; com piso molhado há risco de perder tração.`
          : `Rampa de ~${fmtPct(top.max_up_pct)} ${naVia(top.name)} (trecho de ${top.length_m} m): acima do recomendado para ${label} (${lim.avoid_pct}%). Risco de patinar com piso molhado; avalie outra via.`,
      });
    }
    if (ranked.length > cfg.max_segment_warnings) {
      warnings.push({ code: 'steep_grade_avoid_more', severity: 'warn', message: `Mais ${ranked.length - cfg.max_segment_warnings} trecho(s) com rampa acima de ${lim.avoid_pct}% na rota (ver perfil).` });
    }
    if (warnSegs.length) {
      const worst = [...warnSegs].sort((a, b) => b.max_up_pct - a.max_up_pct)[0];
      const km = warnSegs.reduce((s, x) => s + x.over_warn_m, 0);
      warnings.push({
        code: 'steep_grade_warn', severity: 'warn', id: worst.id, lat: worst.lat, lon: worst.lon,
        message: `${warnSegs.length} trecho(s) com rampa acima de ${lim.warn_pct}% (${fmtLen(km)} no total); o pior, ~${fmtPct(worst.max_up_pct)}, ${naVia(worst.name)}. Reduza a marcha antes da subida.`,
      });
    }
    for (const ds of descentList.slice(0, 3)) {
      warnings.push({
        code: 'long_descent', severity: 'info', lat: ds.lat, lon: ds.lon,
        message: `Descida longa: ${ds.length_km.toLocaleString('pt-BR')} km com média de ${ds.avg_pct.toLocaleString('pt-BR')}% (desce ${ds.drop_m} m) a partir ${aPartirDe(ds.name)}. Use freio-motor e marcha reduzida.`,
      });
    }

    // ---- resumo (linhas curtas)
    const summary: string[] = [];
    summary.push(`Rampa máx. ~${fmtPct(maxUp)} ${naVia(maxUpAt.name)}. Limites p/ ${label}: atenção > ${lim.warn_pct}%, evitar > ${lim.avoid_pct}%.`);
    if (segments.length) {
      summary.push(`${fmtLen(overWarnM)} acima de ${lim.warn_pct}% em ${segments.length} trecho(s)${avoidSegs.length ? `; ${avoidSegs.length} acima de ${lim.avoid_pct}%` : ''}.`);
    } else {
      summary.push(`Nenhum trecho acima de ${lim.warn_pct}%.`);
    }
    if (profileOut) summary.push(`Sobe ${profileOut.ascent_m} m e desce ${profileOut.descent_m} m (altitude ${profileOut.min_m}–${profileOut.max_m} m).`);
    summary.push('Estimativa por modelo de terreno (ANADEM, ~30 m): erro típico de 2 p.p.; confirme no local.');

    // ---- 2ª rodada (sugestão, não aplicada): trechos "evitar" como linear_cost_factors no sentido da subida
    const costLinesSuggested: LayerCostLine[] = avoidSegs.filter((s) => !cfg.cost_lines.exclude_road_classes.includes(s.road_class ?? '')).map((s) => ({
      item: { kind: 'layer', layer: 'relevo', id: s.id, name: s.name, type: 'steep_grade', rule: `rampa ~${fmtPct(s.max_up_pct)} > ${lim.avoid_pct}%`, value_num: s.max_up_pct, lat: s.lat, lon: s.lon, note: null },
      coordinates: s.coordinates,
      factor: cfg.cost_lines.avoid_factor,
    }));

    return {
      summary,
      warnings,
      data: {
        source: 'Valhalla trace_attributes + /height com elevação ANADEM v1 (HGT 1")',
        window_m: cfg.window_m,
        vehicle: { preset: ctx.vehicle.id, weight_t: ctx.vehicle.weight_t },
        limits: { warn_pct: lim.warn_pct, avoid_pct: lim.avoid_pct, source: lim.source, basis: lim.basis ?? null },
        max_up_pct: r1(maxUp),
        max_up_at: maxUpAt,
        max_down_pct: r1(maxDown),
        max_up_pct_valhalla: Math.max(...edges.filter((e) => e.up != null).map((e) => e.up as number)),
        /** arestas em que o Valhalla (60 m) passou do limite de atenção mas a rampa sustentada não (ruído provável do DEM) */
        discarded_spikes: discardedNoise + discardedShort,
        km_over_warn: r1(overWarnM / 1000),
        km_over_avoid: r1(overAvoidM / 1000),
        segments_count: segments.length,
        segments: segments.slice(0, 50).map(({ coordinates, ...s }) => ({ ...s, coordinates: coordinates.length > 60 ? coordinates.filter((_, i) => i % Math.ceil(coordinates.length / 60) === 0 || i === coordinates.length - 1) : coordinates })),
        profile: profileOut,
        histogram_up_km: profile ? histogram : null,
        long_descents: descentList,
        cost_lines_suggested: costLinesSuggested,
        coverage_pct: Math.round((lenData / Math.max(1, totalM)) * 100),
        elapsed_ms: Date.now() - t0,
        note: 'Rampa estimada (DEM ~30 m; erro típico 2–2,5 p.p. em morro; subestima rampas muito fortes e pode inventar rampa em área plana e densa). Não é restrição legal.',
      },
    };
  },
};

export default layer;
