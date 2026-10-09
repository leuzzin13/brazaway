import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { vehiclePresets } from '../config.js';
import { decodePolyline6 } from '../services/polyline.js';
import { heightProfileAt, traceAttributesAt } from '../services/valhalla.js';
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
 * Se o Valhalla de elevação estiver fora do ar (VALHALLA_ELEV_URL), a camada simplesmente não anota.
 * Trechos acima do limite "evitar" saem em data.cost_lines_suggested (LayerCostLine no sentido da subida) para uma
 * 2ª rodada de rota; a rota atual não é alterada (ver docs/layers/relevo.md).
 */

// ----------------------------------------------------------------------------------------------- configuração
interface Limits { warn_pct: number; avoid_pct: number; basis?: string }
interface GradeConfig {
  presets: Record<string, Limits>;
  by_weight: { weight_override_ratio: number; tiers: (Limits & { max_weight_t: number })[] };
  descent: { min_weight_t: number; min_drop_m: number; min_avg_pct: number };
  cost_lines: { avoid_factor: number };
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
  cost_lines: { avoid_factor: 10 },
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
    };
  } catch {
    cfgCache = DEFAULT_CFG;
  }
  return cfgCache;
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
function elevUrl(): string | null {
  const u = (process.env.VALHALLA_ELEV_URL ?? 'http://localhost:8003').trim();
  return !u || u === 'off' ? null : u.replace(/\/$/, '');
}
let downUntil = 0;
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
const fmtKm = (m: number) => (m / 1000).toLocaleString('pt-BR', { maximumFractionDigits: m < 10000 ? 1 : 0, minimumFractionDigits: m < 10000 ? 1 : 0 });
const fmtPct = (v: number) => `${Math.round(v)}%`;

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
  way_ids: number[];
  /** rampa máxima de subida (Valhalla, % arredondado para cima) */
  max_up_pct: number;
  /** rampa máxima medida no perfil (janelas de 60 m), 1 casa */
  max_up_pct_profile: number | null;
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

/** Janelas de ~60 m (comprimentos iguais, sem sobreposição) a partir do início do trecho, como o elevationbuilder do Valhalla. */
function windows(d0: number, d1: number, elev: (x: number) => number, step = 60): { s: number; e: number; g: number }[] {
  const len = d1 - d0;
  if (len < 10) return [];
  const n = Math.max(1, Math.round(len / step));
  const w = len / n;
  const out: { s: number; e: number; g: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = d0 + i * w, b = i === n - 1 ? d1 : a + w;
    out.push({ s: a, e: b, g: ((elev(b) - elev(a)) / (b - a)) * 100 });
  }
  return out;
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
    const base = elevUrl();
    if (!base || Date.now() < downUntil) return {};
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
      if (isConnError(e)) { downUntil = Date.now() + 60_000; return {}; }
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

    // ---- arestas acima do limite de atenção (rampa de subida no sentido do percurso)
    const flagged = edges.map((e, i) => ({ e, i })).filter(({ e }) => e.up != null && (e.up as number) > lim.warn_pct);
    // agrupa arestas sinalizadas consecutivas (folga de até 50 m entre elas) em trechos
    const groups: Edge[][] = [];
    for (const { e } of flagged) {
      const g = groups[groups.length - 1];
      if (g && e.d0 - g[g.length - 1].d1 <= 50) g.push(e); else groups.push([e]);
    }
    const segments: GradeSegment[] = groups.map((g) => {
      const maxUp = Math.max(...g.map((e) => e.up as number));
      let overWarn = 0, overAvoid = 0, best: { s: number; e: number; g: number } | null = null;
      for (const e of g) {
        const w = elev ? windows(e.d0, e.d1, elev) : [];
        const hits = w.filter((x) => x.g > lim.warn_pct);
        if (!w.length || !hits.length) {
          // perfil sem a janela (amostragem diferente da do Valhalla): conta a aresta (até 60 m) pelo valor do Valhalla
          const l = Math.min(e.d1 - e.d0, 60);
          overWarn += l;
          if ((e.up as number) > lim.avoid_pct) overAvoid += l;
          if (!best) best = { s: e.d0, e: e.d0 + l, g: e.up as number };
          continue;
        }
        for (const x of w) {
          if (x.g > lim.warn_pct) overWarn += x.e - x.s;
          if (x.g > lim.avoid_pct && (e.up as number) > lim.avoid_pct) overAvoid += x.e - x.s;
          if (!best || x.g > best.g) best = { ...x };
        }
      }
      // garante coerência: se o Valhalla diz > evitar, há ao menos um trecho contado
      if (maxUp > lim.avoid_pct && overAvoid === 0) overAvoid = Math.min(60, g.reduce((s, e) => s + e.d1 - e.d0, 0));
      const d0 = g[0].d0, d1 = g[g.length - 1].d1;
      const peak = best ? pointAt(G, cum, (best.s + best.e) / 2) : pointAt(G, cum, (d0 + d1) / 2);
      const a = G[g[0].b], b = G[g[g.length - 1].e];
      const segCoords = G.slice(g[0].b, g[g.length - 1].e + 1);
      const ways = [...new Set(g.map((e) => e.wayId).filter((x): x is number => typeof x === 'number'))];
      return {
        id: `relevo:${ways[0] ?? 'x'}:${Math.round(d0)}`,
        level: maxUp > lim.avoid_pct ? 'evitar' : 'atencao',
        name: mostCommonName(g),
        way_ids: ways,
        max_up_pct: maxUp,
        max_up_pct_profile: best && elev ? r1(best.g) : null,
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

    // ---- máximos da rota
    const maxUpEdge = withData.reduce((m, e) => ((e.up as number) > (m.up as number) ? e : m), withData[0]);
    const maxUp = maxUpEdge.up as number;
    const downs = edges.filter((e) => e.down != null).map((e) => Math.abs(e.down as number));
    const maxDown = downs.length ? Math.max(...downs) : 0;
    const maxUpAt = (() => {
      const seg = segments.find((s) => s.max_up_pct === maxUp);
      if (seg) return { lat: seg.lat, lon: seg.lon, name: seg.name };
      const p = pointAt(G, cum, (maxUpEdge.d0 + maxUpEdge.d1) / 2);
      return { lat: r5(p[1]), lon: r5(p[0]), name: maxUpEdge.name ?? 'via sem nome' };
    })();
    const overWarnM = segments.reduce((s, x) => s + x.over_warn_m, 0);
    const overAvoidM = segments.reduce((s, x) => s + x.over_avoid_m, 0);
    const avoidSegs = segments.filter((s) => s.level === 'evitar').sort((a, b) => b.max_up_pct - a.max_up_pct || b.over_avoid_m - a.over_avoid_m);
    const warnSegs = segments.filter((s) => s.level === 'atencao');

    // ---- perfil resumido
    let profileOut: Record<string, unknown> | null = null;
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
      // km de subida por faixa de rampa (janelas de 60 m na rota toda; pontes/túneis já aplainados)
      const bins: [string, number][] = [['0-3', 3], ['3-6', 6], ['6-8', 8], ['8-10', 10], ['10-12', 12], ['12-15', 15], ['15-20', 20], ['20+', Infinity]];
      for (const [k] of bins) histogram[k] = 0;
      let downSteep = 0;
      const ef = elevFn(profile);
      for (const w of windows(0, totalM, ef)) {
        const len = w.e - w.s;
        if (w.g <= -6) downSteep += len;
        if (w.g <= 0) continue;
        const bin = bins.find(([, hi]) => w.g < hi) ?? bins[bins.length - 1];
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
    for (const s of avoidSegs.slice(0, cfg.max_segment_warnings)) {
      warnings.push({
        code: 'steep_grade_avoid', severity: 'warn', id: s.id, lat: s.lat, lon: s.lon,
        message: `Rampa de ~${fmtPct(s.max_up_pct)} ${naVia(s.name)} (${s.length_m} m): acima do recomendado para ${label} (${lim.avoid_pct}%). Risco de patinar com piso molhado; avalie outra via.`,
      });
    }
    if (avoidSegs.length > cfg.max_segment_warnings) {
      warnings.push({ code: 'steep_grade_avoid_more', severity: 'warn', message: `Mais ${avoidSegs.length - cfg.max_segment_warnings} trecho(s) com rampa acima de ${lim.avoid_pct}% na rota (ver perfil).` });
    }
    if (warnSegs.length) {
      const worst = [...warnSegs].sort((a, b) => b.max_up_pct - a.max_up_pct)[0];
      const km = warnSegs.reduce((s, x) => s + x.over_warn_m, 0);
      warnings.push({
        code: 'steep_grade_warn', severity: 'warn', id: worst.id, lat: worst.lat, lon: worst.lon,
        message: `${warnSegs.length} trecho(s) com rampa entre ${lim.warn_pct}% e ${lim.avoid_pct}% (${fmtKm(km)} km); o pior, ~${fmtPct(worst.max_up_pct)}, ${naVia(worst.name)}. Reduza a marcha antes da subida.`,
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
      summary.push(`${fmtKm(overWarnM)} km acima de ${lim.warn_pct}% em ${segments.length} trecho(s)${avoidSegs.length ? `; ${avoidSegs.length} acima de ${lim.avoid_pct}%` : ''}.`);
    } else {
      summary.push(`Nenhum trecho acima de ${lim.warn_pct}%.`);
    }
    if (profileOut) summary.push(`Sobe ${profileOut.ascent_m} m e desce ${profileOut.descent_m} m (altitude ${profileOut.min_m}–${profileOut.max_m} m).`);
    summary.push('Estimativa por modelo de terreno (ANADEM, ~30 m): erro típico de 2 p.p.; confirme no local.');

    // ---- 2ª rodada (sugestão, não aplicada): trechos "evitar" como linear_cost_factors no sentido da subida
    const costLinesSuggested: LayerCostLine[] = avoidSegs.map((s) => ({
      item: { kind: 'layer', layer: 'relevo', id: s.id, name: s.name, type: 'steep_grade', rule: `rampa ~${s.max_up_pct}% > ${lim.avoid_pct}%`, value_num: s.max_up_pct, lat: s.lat, lon: s.lon, note: null },
      coordinates: s.coordinates,
      factor: cfg.cost_lines.avoid_factor,
    }));

    return {
      summary,
      warnings,
      data: {
        source: 'Valhalla trace_attributes + /height com elevação ANADEM v1 (HGT 1")',
        vehicle: { preset: ctx.vehicle.id, weight_t: ctx.vehicle.weight_t },
        limits: { warn_pct: lim.warn_pct, avoid_pct: lim.avoid_pct, source: lim.source, basis: lim.basis ?? null },
        max_up_pct: maxUp,
        max_up_at: maxUpAt,
        max_down_pct: maxDown,
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
