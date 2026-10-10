import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { env, vehiclePresets } from '../config.js';
import { decodePolyline6 } from '../services/polyline.js';
import { heightAt, heightProfileAt, traceAttributesAt } from '../services/valhalla.js';
import type { Vehicle } from '../services/vehicle.js';
import type { LayerCostLine, LayerWarning, RouteLayer } from './types.js';

/**
 * Relevo / rampa. Depois da rota, consulta um Valhalla COM elevação (tiles gerados com o ANADEM v1, ver
 * scripts/build-elevation.sh e docs/layers/relevo.md; hoje é o próprio Valhalla principal):
 *  - trace_attributes (edge_walk sobre a geometria da rota) → rampa máxima de subida por aresta no sentido do percurso
 *    (edge.max_upward_grade, % arredondado para cima), descida, rampa ponderada, comprimento, way_id, ponte/túnel;
 *  - /height ao longo da mesma linha (a cada 30 m) → perfil, km acima do limite e localização do ponto mais íngreme.
 * Compara com config/grade-limits.json (por preset; PBT acima do PBT de referência do preset reduz os limites pela relação
 * de aderência do Anexo III da Resolução CONTRAN 882/2021, ver limitsFor).
 *
 * Não é restrição legal (nenhuma norma proíbe subir X%): os avisos são 'warn' (risco) ou 'info', nunca 'danger'.
 * Valhalla de elevação: VALHALLA_ELEV_URL ou, sem ela, o principal (VALHALLA_URL), desde que responda /height com
 * altitude. Sem elevação (ou fora do ar), a camada simplesmente não anota.
 * Trechos acima do limite "evitar" saem em data.cost_lines_suggested (LayerCostLine no sentido da subida) para uma
 * 2ª rodada de rota; a rota atual não é alterada (ver docs/layers/relevo.md).
 */

// ----------------------------------------------------------------------------------------------- configuração
interface Limits { warn_pct: number; avoid_pct: number; basis?: string }
interface PresetLimits extends Limits {
  /** PBT (t) para o qual os limites do preset valem; acima dele os limites caem (ver limitsFor). Default: PBT do preset. */
  ref_weight_t?: number;
}
interface GradeConfig {
  presets: Record<string, PresetLimits>;
  /** só para preset sem entrada em `presets` */
  by_weight: { tiers: (Limits & { max_weight_t: number })[] };
  descent: { min_weight_t: number; min_drop_m: number; min_avg_pct: number; window_m: number };
  cost_lines: { avoid_factor: number; exclude_road_classes: string[] };
  /** trecho só é reportado se a rampa sustentada passar do limite de atenção em pelo menos min_over_m metros */
  min_over_m: number;
  /** janela (m) da rampa sustentada por classe de via do Valhalla (road_class); "default" para as demais */
  window_m: Record<string, number>;
  /**
   * "Lombada" do MDT (fora de rodovia): a subida é desfeita por uma descida de pelo menos min_ratio × a subida em até
   * window_factor × janela depois do topo (ou o MDT sobe o mesmo tanto logo antes do pé: "buraco"). É o desenho do resíduo
   * de prédio/viaduto no ANADEM em avenida plana (Paulista, Centro do Rio), mas também o de lombada real em bairro de
   * morro (validação com o LiDAR da PMSP, docs/layers/relevo.md). Por isso: nas classes de `hide_road_classes`
   * (avenidas) a lombada sai dos avisos (fica em data.bumps); nas demais o trecho fica no máximo em "atencao".
   * Em nenhum caso vira "evitar" nem costLine.
   */
  bump: { window_factor: number; min_ratio: number; hide_road_classes: string[] };
  max_segment_warnings: number;
}
const DEFAULT_CFG: GradeConfig = {
  // chaves = id do preset em config/vehicle-presets.json (ver config/grade-limits.json)
  presets: {
    utilitario: { warn_pct: 15, avoid_pct: 20, ref_weight_t: 16 }, vuc: { warn_pct: 15, avoid_pct: 20, ref_weight_t: 16 },
    toco: { warn_pct: 15, avoid_pct: 20, ref_weight_t: 16 }, truck: { warn_pct: 12, avoid_pct: 15 },
    carreta_5e: { warn_pct: 6, avoid_pct: 8 }, carreta_6e: { warn_pct: 6, avoid_pct: 8, ref_weight_t: 41.5 },
    romeu_julieta: { warn_pct: 12, avoid_pct: 15, ref_weight_t: 23 }, bitrem: { warn_pct: 10, avoid_pct: 12 },
    rodotrem: { warn_pct: 6, avoid_pct: 9 },
  },
  by_weight: {
    tiers: [
      { max_weight_t: 16, warn_pct: 15, avoid_pct: 20 },
      { max_weight_t: 23, warn_pct: 12, avoid_pct: 15 },
      { max_weight_t: 999, warn_pct: 6, avoid_pct: 8 },
    ],
  },
  descent: { min_weight_t: 16, min_drop_m: 150, min_avg_pct: 5, window_m: 2000 },
  cost_lines: { avoid_factor: 10, exclude_road_classes: ['motorway', 'trunk'] },
  min_over_m: 30,
  window_m: { motorway: 1000, trunk: 1000, primary: 300, default: 120 },
  bump: { window_factor: 2, min_ratio: 0.5, hide_road_classes: ['primary'] },
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
      bump: { ...DEFAULT_CFG.bump, ...(raw.bump ?? {}) },
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

/** Resistência ao rolamento do CONTRAN 882 (art. 19 §1º e Anexo III): 11 kgf/t, que equivale a 1,1 ponto de rampa. */
const RR_PCT = 1.1;

/**
 * Limites do veículo.
 * - Preset até o PBT de referência (`ref_weight_t`, default o PBT do preset): os do preset.
 * - Acima dele: a mesma relação de aderência que gerou os limites (Anexo III da Resolução CONTRAN 882/2021:
 *   i = Ft/(10·G) − Rr/10, com Ft = Fad = P_motriz·μ quando a aderência limita). Com a carga no eixo motriz fixa,
 *   (i + 1,1) cai na proporção ref/PBT: lim' = (lim + 1,1) × ref/PBT − 1,1. Contínuo e decrescente com o peso
 *   (truck 23 t → 30 t: 12/15 → 8,9/11,2). Mais peso também pode pôr mais carga no eixo motriz; a fórmula ignora isso e
 *   fica do lado conservador.
 * - Preset sem entrada na config: faixas de peso (`by_weight`).
 * Presets derivados de outro (carreta_6e da carreta_5e, romeu_julieta do truck) usam os limites do preset de origem com o
 * ref_weight_t dele, e caem pela mesma relação até o próprio PBT (carreta_6e 48,5 t: 5/6,7; romeu_julieta 50 t: 4,9/6,3).
 */
export function limitsFor(v: Vehicle, cfg = gradeConfig()): Limits & { source: 'preset' | 'peso' | 'preset+peso'; ref_weight_t: number | null } {
  // id do preset; aceita na config também o nome antigo (alias, ex.: "carreta" → carreta_5e)
  const alias = Object.entries(vehiclePresets.aliases ?? {}).find(([, real]) => real === v.id)?.[0];
  const preset = cfg.presets[v.id] ?? (alias ? cfg.presets[alias] : undefined);
  if (!preset) {
    const tiers = [...cfg.by_weight.tiers].sort((a, b) => a.max_weight_t - b.max_weight_t);
    const tier = tiers.find((t) => v.weight_t <= t.max_weight_t) ?? tiers[tiers.length - 1];
    return { warn_pct: tier.warn_pct, avoid_pct: tier.avoid_pct, source: 'peso', ref_weight_t: null };
  }
  const ref = preset.ref_weight_t ?? vehiclePresets.presets.find((p) => p.id === v.id)?.weight_t ?? null;
  if (ref && v.weight_t > ref) {
    const k = ref / v.weight_t;
    const scale = (lim: number) => Math.max(0.5, r1((lim + RR_PCT) * k - RR_PCT));
    return { warn_pct: scale(preset.warn_pct), avoid_pct: scale(preset.avoid_pct), basis: preset.basis, source: 'preset+peso', ref_weight_t: ref };
  }
  return { warn_pct: preset.warn_pct, avoid_pct: preset.avoid_pct, basis: preset.basis, source: 'preset', ref_weight_t: ref };
}

// ------------------------------------------------------------------------------------- disponibilidade/serviço
/**
 * Qual Valhalla tem elevação: VALHALLA_ELEV_URL se definido ("off" desliga a camada); senão o principal (VALHALLA_URL),
 * cujos tiles já têm a elevação do ANADEM (troca feita em 09/10/2026, ver docs/layers/relevo.md). Um Valhalla de
 * elevação avulso (ex.: scripts/build-elevation.sh serve, porta 8003, para testar um build novo antes de trocar) só é
 * usado se apontado em VALHALLA_ELEV_URL. O candidato é sondado com /height em pontos da rota (ver hasElevation).
 */
function candidates(): string[] {
  const v = process.env.VALHALLA_ELEV_URL?.trim();
  if (v === 'off') return [];
  const list = v ? [v] : [env.valhallaUrl];
  return [...new Set(list.map((u) => u.replace(/\/$/, '')))];
}
const probes = new Map<string, { ok: boolean; until: number }>();
function markDown(base: string, ms = 60_000) { probes.set(base, { ok: false, until: Date.now() + ms }); }
/**
 * O Valhalla tem elevação na região da rota? /height na origem, no meio e no destino. Positivo fica 5 min em cache;
 * fora do ar, 1 min; sonda (3 pontos, 3 s) que estoura o tempo, 15 s; "respondeu sem altitude" não fica em cache
 * (depende do lugar: mar, fora dos tiles), e a sonda é barata.
 */
async function hasElevation(base: string, pts: { lat: number; lon: number }[]): Promise<boolean> {
  const c = probes.get(base);
  if (c && Date.now() < c.until) return c.ok;
  try {
    const ok = (await heightAt(base, pts)).some((h) => typeof h === 'number');
    if (ok) probes.set(base, { ok, until: Date.now() + 300_000 });
    return ok;
  } catch (e) {
    if (isConnError(e)) markDown(base);
    else if (isTimeout(e)) markDown(base, 15_000);
    return false;
  }
}
async function pickBase(pts: { lat: number; lon: number }[]): Promise<string | null> {
  for (const b of candidates()) if (await hasElevation(b, pts)) return b;
  return null;
}
type ErrLike = { name?: string; cause?: { code?: string }; message?: string; code?: string };
/** Tempo esgotado (AbortController do cliente ou timeouts do undici): o serviço está no ar, só lento. */
export function isTimeout(e: unknown): boolean {
  const err = e as ErrLike;
  return err?.name === 'AbortError' || err?.name === 'TimeoutError'
    || /UND_ERR_[A-Z_]*TIMEOUT/.test(`${err?.message ?? ''} ${err?.code ?? ''} ${err?.cause?.code ?? ''}`);
}
/** Falha de conexão (serviço fora do ar / DNS); não inclui tempo esgotado. */
export function isConnError(e: unknown): boolean {
  if (isTimeout(e)) return false;
  const err = e as ErrLike;
  return /ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET/i.test(`${err?.message ?? ''} ${err?.code ?? ''} ${err?.cause?.code ?? ''}`)
    || err?.message === 'fetch failed';
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
/** limite de rampa em pt-BR, até 1 casa ("8", "11,2") */
const fmtLim = (v: number) => (Math.round(v * 10) / 10).toLocaleString('pt-BR');
/** mínimo e máximo sem espalhar o array em argumentos (Math.min(...a) estoura a pilha com ~150 mil itens) */
export function minMax(a: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < min) min = v; if (v > max) max = v; }
  return { min, max };
}
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

/** tempo máximo do trace_attributes e do /height (ms); RELEVO_TRACE_TIMEOUT_MS muda (testes) */
const traceTimeoutMs = () => Number(process.env.RELEVO_TRACE_TIMEOUT_MS) || 20_000;

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
  /** subida com desenho de "lombada" do MDT (ver bumpCheck): não vira "evitar", aviso nem costLine */
  bump: boolean;
  /** subida (m) em volta do pico e quanto dela é desfeito logo antes/depois (null em rodovia ou sem perfil) */
  rise_m: number | null;
  undone_m: number | null;
  /** amplitude do perfil em ±600 m do pico (diagnóstico) */
  relief_m: number | null;
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
      return await traceAttributesAt(base, part, vehicle, ATTRS, { shapeMatch: 'edge_walk', timeoutMs: traceTimeoutMs() });
    } catch (e) {
      // fora do ar ou lento: não adianta tentar o map_snap (mais lento ainda)
      if (isConnError(e) || isTimeout(e)) throw e;
      // malha diferente da que gerou a rota (ou geometria fora das arestas): tenta casar por proximidade
      return traceAttributesAt(base, part, vehicle, ATTRS, { shapeMatch: 'map_snap', timeoutMs: Math.round(traceTimeoutMs() * 1.5) });
    }
  });
  const G: LonLat[] = [];
  const raw: { edge: RawEdge; b: number; e: number }[] = [];
  for (const res of results) {
    const shape = decodePolyline6(res.shape ?? '') as LonLat[];
    if (!shape.length) continue;
    const dropFirst = G.length > 0 && haversineM(G[G.length - 1], shape[0]) < 1;
    const base_ = G.length - (dropFirst ? 1 : 0);
    for (let i = dropFirst ? 1 : 0; i < shape.length; i++) G.push(shape[i]); // sem espalhar (pedaço grande estoura a pilha)
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

/** Vãos de ponte/túnel: arestas consecutivas do mesmo tipo (folga < 1 m) unidas; vãos com menos de 1 m saem. */
export function bridgeSpans(edges: Pick<Edge, 'bridge' | 'tunnel' | 'd0' | 'd1'>[]): { kind: 'ponte' | 'tunel'; d0: number; d1: number }[] {
  const out: { kind: 'ponte' | 'tunel'; d0: number; d1: number }[] = [];
  for (const e of edges) {
    if (!(e.bridge || e.tunnel)) continue;
    const kind = e.bridge ? 'ponte' : 'tunel';
    const last = out[out.length - 1];
    if (last && last.kind === kind && e.d0 - last.d1 < 1) last.d1 = Math.max(last.d1, e.d1);
    else out.push({ kind, d0: e.d0, d1: e.d1 });
  }
  return out.filter((x) => x.d1 - x.d0 >= 1);
}

/** Perfil (d, h) na mesma escala de distância de G; preenche buracos e "aplaina" pontes/túneis (reta entre as cabeceiras). */
export function buildProfile(samples: [number, number | null][], totalM: number, edges: Edge[]): { d: number[]; h: number[] } | null {
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
  // pontes/túneis: o DEM mede o terreno (vale/morro), não o tabuleiro. Ponte/túnel dividido em várias arestas
  // consecutivas vira um vão só (senão as junções ficam com a altitude do vale e o "aplainado" vira serrote).
  for (const sp of bridgeSpans(edges)) {
    const h0 = at(sp.d0), h1 = at(sp.d1);
    for (let i = seek(d, sp.d0); i < d.length && d[i] <= sp.d1; i++) {
      if (d[i] < sp.d0) continue;
      h[i] = h0 + ((h1 - h0) * (d[i] - sp.d0)) / (sp.d1 - sp.d0);
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

/** subida/descida acumuladas com histerese de `thr` m (o DEM oscila alguns metros em serra) */
function ascentDescent(h: number[], thr = 10): { up: number; down: number } {
  if (!h.length) return { up: 0, down: 0 };
  let last = h[0], up = 0, down = 0;
  for (const v of h) {
    const dv = v - last;
    if (Math.abs(dv) >= thr) { if (dv > 0) up += dv; else down -= dv; last = v; }
  }
  const tail = h[h.length - 1] - last; // resto abaixo do limiar no fim do perfil
  if (tail > 0) up += tail; else down -= tail;
  return { up, down };
}

/**
 * Descidas longas: janelas de `win` m (passo de 100 m) com queda média >= minAvg% viram intervalos (janelas que se
 * tocam são unidas). Robusto ao ruído do DEM em serra, onde a altitude "repica" dezenas de metros numa descida contínua.
 * A união de janelas pode ter média abaixo de minAvg (trecho mais suave entre duas rampas): o intervalo unido é
 * conferido de novo e aparado de 100 em 100 m pela ponta que mais melhora a média; se nem assim chega a minAvg, fica a
 * melhor janela dele.
 */
export function longDescents(elev: (x: number) => number, totalM: number, win: number, minAvg: number): { s: number; e: number }[] {
  const merged: { s: number; e: number }[] = [];
  if (totalM < win) return merged;
  let cur: { s: number; e: number } | null = null;
  for (let x = 0; x + win <= totalM; x += 100) {
    const avg = ((elev(x) - elev(x + win)) / win) * 100;
    if (avg >= minAvg) {
      if (cur && x <= cur.e) cur.e = x + win; else { if (cur) merged.push(cur); cur = { s: x, e: x + win }; }
    }
  }
  if (cur) merged.push(cur);
  const avgOf = (s: number, e: number) => ((elev(s) - elev(e)) / (e - s)) * 100;
  const out: { s: number; e: number }[] = [];
  for (const iv of merged) {
    let { s, e } = iv;
    while (e - s > win && avgOf(s, e) < minAvg) {
      if (avgOf(s + 100, e) >= avgOf(s, e - 100)) s += 100; else e -= 100;
    }
    if (avgOf(s, e) < minAvg) {
      let best = -Infinity;
      for (let x = iv.s; x + win <= iv.e; x += 100) {
        const a = avgOf(x, x + win);
        if (a > best) { best = a; s = x; e = x + win; }
      }
      if (best < minAvg) continue;
    }
    out.push({ s, e });
  }
  return out;
}

/**
 * "Lombada" do MDT: a subida em [d0, d1] (pico de rampa em peakX) é desfeita logo depois do topo, ou é a volta de um
 * "buraco" logo antes do pé? subida = máx. depois do pico − mín. antes do pico (na faixa do trecho + meia janela);
 * desfeito = o maior entre a queda até o mínimo nos `span` m depois do topo e a subida até o máximo nos `span` m antes do pé.
 */
export function bumpCheck(elev: (x: number) => number, totalM: number, d0: number, d1: number, peakX: number, L: number, span: number):
  { rise_m: number; undone_m: number; relief_m: number } {
  const ext = (x0: number, x1: number, wantMax: boolean) => {
    let best = elev(x0), bx = x0;
    for (let x = x0; x <= x1 + 1e-6; x += 10) {
      const v = elev(Math.min(x, x1));
      if (wantMax ? v > best : v < best) { best = v; bx = Math.min(x, x1); }
    }
    return { v: best, x: bx };
  };
  const a = Math.max(0, d0 - L / 2), b = Math.min(totalM, d1 + L / 2);
  const px = Math.max(a, Math.min(b, peakX));
  const lo = ext(a, px, false), hi = ext(px, b, true);
  const rise = hi.v - lo.v;
  // relevo em volta (±600 m): diagnóstico para calibrar (bairro de morro × avenida plana com resíduo de prédio)
  const r0 = Math.max(0, px - 600), r1_ = Math.min(totalM, px + 600);
  const relief = ext(r0, r1_, true).v - ext(r0, r1_, false).v;
  if (!(rise > 0)) return { rise_m: 0, undone_m: 0, relief_m: relief };
  const after = hi.x < totalM ? ext(hi.x, Math.min(totalM, hi.x + span), false).v : hi.v;
  const before = lo.x > 0 ? ext(Math.max(0, lo.x - span), lo.x, true).v : lo.v;
  return { rise_m: rise, undone_m: Math.max(hi.v - after, before - lo.v), relief_m: relief };
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
      // CC BY 4.0 §3(a)(1)(B): indicar que o material foi modificado (reamostrado para HGT 1" e usado para estimar rampa)
      { name: 'ANADEM v1 (ANA/UFRGS), MDT 30 m; derivado do Copernicus DEM GLO-30 (© DLR e.V., © Airbus); modificado: reamostrado (bilinear) para HGT 1" e usado para estimar rampas', url: 'https://metadados.snirh.gov.br/geonetwork/srv/api/records/93664c15-1ff8-4e87-bbed-2bb69d321309', license: 'CC-BY-4.0' },
      { name: 'Licença Creative Commons Atribuição 4.0 (ANADEM)', url: 'https://creativecommons.org/licenses/by/4.0/', license: 'CC-BY-4.0' },
      { name: 'OpenStreetMap (geometria das vias, via Valhalla)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL-1.0' },
    ],
    defaultVisible: false,
  },

  async annotate(ctx, route) {
    const cs = route.line.geometry.coordinates;
    if (cs.length < 2) return {};
    const probePts = [cs[0], cs[Math.floor(cs.length / 2)], cs[cs.length - 1]].map(([lon, lat]) => ({ lat, lon }));
    const base = await pickBase(probePts);
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
      // /height aceita no máximo service_limits.skadi.max_shape pontos (750 mil); com no máximo 100 mil amostras o
      // passo fica em 30 m até 3.000 km e cresce depois disso
      const step = Math.max(30, Math.ceil(totalM / 100_000));
      samples = await heightProfileAt(base, traced.G, { resampleDistance: step, timeoutMs: traceTimeoutMs() }).catch((e) => {
        if (isConnError(e)) throw e;
        // lento ou erro no /height: segue só com as rampas do trace_attributes (sem perfil)
        return [];
      });
    } catch (e) {
      if (isConnError(e)) { markDown(base); return {}; }
      // lento (rota muito longa, Valhalla ocupado): esta rota sai sem relevo, mas o serviço não é marcado como fora do ar
      if (isTimeout(e)) {
        console.warn(`[relevo] trace_attributes estourou o tempo em ${base}; rota sem anotação de relevo`);
        return {};
      }
      // o Valhalla de elevação não casou a rota (ex.: trecho fora da cobertura dos tiles com elevação): não anota
      if ((e as { statusCode?: number }).statusCode === 502) {
        console.warn(`[relevo] trace_attributes falhou (${(e as Error).message}); rota sem anotação de relevo`);
        return {};
      }
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
    // 1 km nelas e 120 m nas demais (ladeiras urbanas curtas continuam aparecendo).
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
      let rawMax = -Infinity;
      for (const e of es) rawMax = Math.max(rawMax, e.up as number);
      const overWarn = g.reduce((s, i) => s + stats[i].overWarn, 0);
      const overAvoid = maxUp > lim.avoid_pct ? g.reduce((s, i) => s + stats[i].overAvoid, 0) : 0;
      const d0 = es[0].d0, d1 = es[es.length - 1].d1;
      // "lombada" do MDT (só fora de rodovia; nas rodovias a janela de 1 km já absorve): subida desfeita logo depois
      const roadClass = edges[best].roadClass ?? null;
      const bc = elev && !isHighway(roadClass)
        ? bumpCheck(elev, totalM, d0, d1, stats[best].peakX, stats[best].window, cfg.bump.window_factor * stats[best].window)
        : null;
      const bump = !!bc && bc.rise_m > 0 && bc.undone_m >= cfg.bump.min_ratio * bc.rise_m;
      // "evitar" exige pelo menos min_over_m acima do limite (pico isolado de 15 m é ruído provável do DEM de 30 m) e
      // que não seja lombada do MDT
      const evitar = !bump && maxUp > lim.avoid_pct && overAvoid >= cfg.min_over_m;
      const peak = pointAt(G, cum, stats[best].peakX);
      const a = G[es[0].b], b = G[es[es.length - 1].e];
      const segCoords = G.slice(es[0].b, es[es.length - 1].e + 1);
      const ways = [...new Set(es.map((e) => e.wayId).filter((x): x is number => typeof x === 'number'))];
      return {
        id: `relevo:${ways[0] ?? 'x'}:${Math.round(d0)}`,
        level: evitar ? 'evitar' : 'atencao',
        name: mostCommonName(es),
        road_class: roadClass,
        way_ids: ways,
        max_up_pct: r1(maxUp),
        max_up_pct_valhalla: rawMax,
        window_m: stats[best].window,
        length_m: Math.round(d1 - d0),
        over_warn_m: Math.round(overWarn),
        over_avoid_m: Math.round(overAvoid),
        km_from_start: r1(d0 / 1000),
        bump,
        rise_m: bc ? Math.round(bc.rise_m) : null,
        undone_m: bc ? Math.round(bc.undone_m) : null,
        relief_m: bc ? Math.round(bc.relief_m) : null,
        lat: r5(peak[1]), lon: r5(peak[0]),
        start: { lat: r5(a[1]), lon: r5(a[0]) },
        end: { lat: r5(b[1]), lon: r5(b[0]) },
        coordinates: segCoords.map(([x, y]) => [r5(x), r5(y)] as LonLat),
      };
    });

    const segmentsLong = segmentsAll.filter((x) => x.over_warn_m >= cfg.min_over_m);
    const discardedShort = segmentsAll.length - segmentsLong.length;
    // lombadas do MDT em avenida (hide_road_classes): ficam em data.bumps (mapa/calibração), fora de avisos, resumo e
    // máximo da rota; nas outras vias a lombada fica em "atencao" (bump: true) — em bairro de morro quase sempre é real
    const hidden = (x: GradeSegment) => x.bump && cfg.bump.hide_road_classes.includes(x.road_class ?? '');
    const bumps = segmentsLong.filter(hidden);
    const segments = segmentsLong.filter((x) => !hidden(x));
    const bumpEdge = new Set<number>();
    for (let k = 0; k < groups.length; k++) if (hidden(segmentsAll[k])) for (const i of groups[k]) bumpEdge.add(i);

    // ---- máximos da rota (mesma regra das arestas: menor entre Valhalla e rampa sustentada; lombadas do MDT fora)
    const idxData = edges.map((_, i) => i).filter((i) => stats[i].up != null);
    const idxMax = idxData.filter((i) => !bumpEdge.has(i));
    const pool_ = idxMax.length ? idxMax : idxData;
    const maxIdx = pool_.reduce((m, i) => ((stats[i].up as number) > (stats[m].up as number) ? i : m), pool_[0]);
    const maxUp = Math.max(0, stats[maxIdx].up as number);
    let maxDown = 0;
    for (const i of idxData) maxDown = Math.max(maxDown, stats[i].down ?? 0);
    let maxUpValhalla = -Infinity;
    for (const e of edges) if (e.up != null) maxUpValhalla = Math.max(maxUpValhalla, e.up);
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
      const mm = minMax(h);
      profileOut = {
        step_m: Math.round((d[d.length - 1] - d[0]) / Math.max(1, d.length - 1)),
        min_m: Math.round(mm.min), max_m: Math.round(mm.max),
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
        const ef = elevFn(profile);
        for (const iv of longDescents(ef, totalM, cfg.descent.window_m, cfg.descent.min_avg_pct)) {
          const drop = ef(iv.s) - ef(iv.e), len = iv.e - iv.s;
          if (len <= 0 || drop < cfg.descent.min_drop_m) continue;
          const p = pointAt(G, cum, iv.s);
          descentList.push({ km_from_start: r1(iv.s / 1000), length_km: r1(len / 1000), drop_m: Math.round(drop), avg_pct: r1((drop / len) * 100), lat: r5(p[1]), lon: r5(p[0]), name: nameAt(edges, iv.s) });
        }
        descentList.sort((a, b) => b.drop_m - a.drop_m);
      }
    }

    // ---- avisos (nunca 'danger': rampa não é restrição legal; o DEM erra ~2 p.p.)
    const label = ctx.vehicle.label ?? ctx.vehicle.id;
    const warnL = fmtLim(lim.warn_pct), avoidL = fmtLim(lim.avoid_pct);
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
          ? `Subida forte ${naVia(top.name)} (${where}): até ~${fmtPct(top.max_up_pct)}, com ${fmtLen(overAvoid)} acima de ${avoidL}% (recomendado p/ ${label}). Engate marcha reduzida antes; com piso molhado há risco de perder tração.`
          : `Rampa de ~${fmtPct(top.max_up_pct)} ${naVia(top.name)} (trecho de ${top.length_m} m): acima do recomendado para ${label} (${avoidL}%). Risco de patinar com piso molhado; avalie outra via.`,
      });
    }
    if (ranked.length > cfg.max_segment_warnings) {
      warnings.push({ code: 'steep_grade_avoid_more', severity: 'warn', message: `Mais ${ranked.length - cfg.max_segment_warnings} trecho(s) com rampa acima de ${avoidL}% na rota (ver perfil).` });
    }
    if (warnSegs.length) {
      const worst = [...warnSegs].sort((a, b) => b.max_up_pct - a.max_up_pct)[0];
      const km = warnSegs.reduce((s, x) => s + x.over_warn_m, 0);
      warnings.push({
        code: 'steep_grade_warn', severity: 'warn', id: worst.id, lat: worst.lat, lon: worst.lon,
        message: `${warnSegs.length} trecho(s) com rampa acima de ${warnL}% (${fmtLen(km)} no total); o pior, ~${fmtPct(worst.max_up_pct)}, ${naVia(worst.name)}. Reduza a marcha antes da subida.`,
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
    summary.push(`Rampa máx. ~${fmtPct(maxUp)} ${naVia(maxUpAt.name)}. Limites p/ ${label}: atenção > ${warnL}%, evitar > ${avoidL}%.`);
    if (segments.length) {
      summary.push(`${fmtLen(overWarnM)} acima de ${warnL}% em ${segments.length} trecho(s)${avoidSegs.length ? `; ${avoidSegs.length} acima de ${avoidL}%` : ''}.`);
    } else {
      summary.push(`Nenhum trecho acima de ${warnL}%.`);
    }
    if (profileOut) summary.push(`Sobe ${profileOut.ascent_m} m e desce ${profileOut.descent_m} m (altitude ${profileOut.min_m}–${profileOut.max_m} m).`);
    summary.push('Estimativa por modelo de terreno (ANADEM, ~30 m): erro típico de 2 p.p.; confirme no local.');

    // ---- 2ª rodada (sugestão, não aplicada): trechos "evitar" como linear_cost_factors no sentido da subida
    const costLinesSuggested: LayerCostLine[] = avoidSegs.filter((s) => !cfg.cost_lines.exclude_road_classes.includes(s.road_class ?? '')).map((s) => ({
      item: { kind: 'layer', layer: 'relevo', id: s.id, name: s.name, type: 'steep_grade', rule: `rampa ~${fmtPct(s.max_up_pct)} > ${avoidL}%`, value_num: s.max_up_pct, lat: s.lat, lon: s.lon, note: null },
      coordinates: s.coordinates,
      factor: cfg.cost_lines.avoid_factor,
    }));

    const thin = (cs: LonLat[]) => (cs.length > 60 ? cs.filter((_, i) => i % Math.ceil(cs.length / 60) === 0 || i === cs.length - 1) : cs);
    return {
      summary,
      warnings,
      data: {
        source: 'Valhalla trace_attributes + /height com elevação ANADEM v1 (HGT 1")',
        window_m: cfg.window_m,
        vehicle: { preset: ctx.vehicle.id, weight_t: ctx.vehicle.weight_t },
        limits: { warn_pct: lim.warn_pct, avoid_pct: lim.avoid_pct, source: lim.source, ref_weight_t: lim.ref_weight_t, basis: lim.basis ?? null },
        max_up_pct: r1(maxUp),
        max_up_at: maxUpAt,
        max_down_pct: r1(maxDown),
        max_up_pct_valhalla: maxUpValhalla,
        /** arestas em que o Valhalla (60 m) passou do limite de atenção mas a rampa sustentada não (ruído provável do DEM) */
        discarded_spikes: discardedNoise + discardedShort,
        /** subidas com desenho de "lombada" do MDT em avenida (prédio/viaduto em via plana): sem aviso, sem costLine */
        bumps_count: bumps.length,
        bumps: bumps.slice(0, 50).map(({ coordinates, ...s }) => ({ ...s, coordinates: thin(coordinates) })),
        km_over_warn: r1(overWarnM / 1000),
        km_over_avoid: r1(overAvoidM / 1000),
        segments_count: segments.length,
        segments: segments.slice(0, 50).map(({ coordinates, ...s }) => ({ ...s, coordinates: thin(coordinates) })),
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
