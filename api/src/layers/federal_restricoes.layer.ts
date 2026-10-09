import { createHash } from 'node:crypto';
import * as turf from '@turf/turf';
import { env } from '../config.js';
import { query } from '../db.js';
import { decodePolyline6 } from '../services/polyline.js';
import type { Vehicle } from '../services/vehicle.js';
import { featuresNearRoute } from './data.js';
import type { LayerCostLine, LayerItem, LayerWarning, RouteCtx, RouteGeom, RouteLayer } from './types.js';

/**
 * Restrições físicas das rodovias federais cadastradas no SIAET/DNIT (PDFs mensais por UF, restrição definitiva e
 * temporária), com geometria do segmento PNV (SNV/DNITGeo). Importador: importers/sources/siaet_restricoes.py.
 *
 * Regras (docs/layers/federal_restricoes.md):
 *  - limite > 0 e o veículo excede (altura, largura útil, PBT, comprimento) -> trecho penalizado (costLines).
 *    Base: Res. DNIT 11/2022, art. 4º XXVII–XXVIII e art. 29 §§2º–3º (restrição temporária "limita o trânsito normal
 *    de veículos" e exige sinalização); Res. CONTRAN 882/2021, art. 61 (órgão pode fixar limites menores por OAE).
 *  - limite = 0 -> "AET não autorizada" naquela grandeza: só penaliza veículo que precisa de AET por ela
 *    (Res. CONTRAN 882/2021, art. 4º I–II e art. 18); para os demais vira aviso.
 *  - violação só de PBT e o segmento tem exatamente 1 ponte/viaduto (DNITGeo) -> penaliza só a ponte OSM casada.
 * A linha penalizada precisa seguir exatamente as arestas do Valhalla (edge walk), então cada segmento é casado uma vez
 * com trace_attributes, validado e guardado em siaet_osm_match (por versão dos tiles).
 * Também aplica os alertas do DNIT APROVADOS na curadoria (dnit_alertas_curadoria); pendentes nunca entram na rota.
 */

type LonLat = [number, number];
export type Dim = 'altura' | 'largura' | 'peso' | 'comprimento';
const DIMS: Dim[] = ['altura', 'largura', 'peso', 'comprimento'];
const PROP: Record<Dim, 'altura_m' | 'largura_m' | 'peso_t' | 'comprimento_m'> = { altura: 'altura_m', largura: 'largura_m', peso: 'peso_t', comprimento: 'comprimento_m' };
const UNIT: Record<Dim, string> = { altura: 'm', largura: 'm', peso: 't', comprimento: 'm' };
const LABEL: Record<Dim, string> = { altura: 'altura máx.', largura: 'largura útil', peso: 'PBT máx.', comprimento: 'comprimento máx.' };

/** Res. CONTRAN 882/2021: art. 4º I–II (largura 2,60 m; altura 4,40 m sem AET) e art. 18 (CVC com PBTC > 57 t ou > 19,80 m só com AET). */
export const SEM_AET = { altura_m: 4.4, largura_m: 2.6, peso_t: 57, comprimento_m: 19.8 } as const;

export interface SiaetProps {
  tipo: 'definitiva' | 'temporaria';
  br: string; uf: string; pnv: string; km_ini: number; km_fim: number;
  ref_mes: string; atualizado_em: string | null;
  altura_m: number | null; largura_m: number | null; peso_t: number | null; comprimento_m: number | null;
  aet_bloqueada: Dim[];
  n_oae: number;
  oae_unica: { nome: string | null; tipo: string | null; km: number | null; lon: number; lat: number; cod_obra?: string } | null;
  geom_metodo: string; geom_aprox: boolean;
  local_inicio?: string | null; local_fim?: string | null; fonte_url?: string; administracao?: string | null;
}

/**
 * `bloqueia` = vira trecho penalizado na rota. Não bloqueiam (só avisam):
 *  - comprimento da restrição DEFINITIVA para veículo que não precisa de AET por comprimento: é restrição geométrica
 *    cadastrada para análise de AET (Res. DNIT 11/2022, art. 4º XXVII); para o trânsito normal só a temporária é
 *    expressa (art. 29 §2º). Confira a placa R-18;
 *  - 0 (AET bloqueada) em trecho que não é de administração federal: o DNIT não emite AET ali (art. 1º, parágrafo
 *    único) e a autorização é do órgão estadual/municipal (ex.: 116BSP2550, Marginal Tietê).
 */
export interface Violation { dim: Dim; limite: number; valor: number; aet: boolean; bloqueia: boolean; motivo?: string }

const ADM_NAO_FEDERAL = /estadual|municipal|^der$/i;

function vehicleValue(v: Vehicle, d: Dim): number {
  return d === 'altura' ? v.height_m : d === 'largura' ? v.width_m : d === 'peso' ? v.weight_t : v.length_m;
}

/** Grandezas em que o veículo precisa de AET (e portanto é barrado por um 0 do SIAET). */
export function aetDims(v: Vehicle): Set<Dim> {
  const s = new Set<Dim>();
  if (v.height_m > SEM_AET.altura_m) s.add('altura');
  if (v.width_m > SEM_AET.largura_m) s.add('largura');
  if (v.weight_t > SEM_AET.peso_t) s.add('peso');
  if (v.length_m > SEM_AET.comprimento_m) s.add('comprimento');
  // declarou que roda com AET mas nenhuma dimensão passa do limite legal: não sabemos o motivo -> todas
  if (v.requires_aet && !s.size) for (const d of DIMS) s.add(d);
  return s;
}

type LimitProps = Pick<SiaetProps, 'altura_m' | 'largura_m' | 'peso_t' | 'comprimento_m' | 'aet_bloqueada'> & { tipo?: string; administracao?: string | null };

export function violations(p: LimitProps, v: Vehicle): Violation[] {
  const out: Violation[] = [];
  const need = aetDims(v);
  for (const d of DIMS) {
    const lim = p[PROP[d]];
    const val = vehicleValue(v, d);
    if (lim != null && lim > 0 && val > lim + 1e-9) {
      const geom = p.tipo === 'definitiva' && d === 'comprimento' && !need.has('comprimento');
      out.push({ dim: d, limite: lim, valor: val, aet: false, bloqueia: !geom, motivo: geom ? 'definitiva_comprimento' : undefined });
    }
  }
  const naoFederal = ADM_NAO_FEDERAL.test(p.administracao ?? '');
  for (const z of p.aet_bloqueada ?? []) {
    if (need.has(z) && !out.some((o) => o.dim === z)) {
      out.push({ dim: z, limite: 0, valor: vehicleValue(v, z), aet: true, bloqueia: !naoFederal, motivo: naoFederal ? 'aet_fora_jurisdicao' : undefined });
    }
  }
  return out;
}

export function fmtNum(n: number, max = 2): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: max });
}
function fmtKm(n: number): string { return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

export function describeViolations(vs: Violation[]): string {
  return vs.map((x) => x.aet
    ? `AET não autorizada para excesso de ${x.dim}`
    : `${LABEL[x.dim]} ${fmtNum(x.limite)} ${UNIT[x.dim]}, veículo ${fmtNum(x.valor)} ${UNIT[x.dim]}`).join('; ');
}

// ------------------------------------------------------------------------------------------------ geometria

export function distM(a: LonLat, b: LonLat): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111_320;
}
function lineLenM(c: LonLat[]): number { let s = 0; for (let i = 1; i < c.length; i++) s += distM(c[i - 1], c[i]); return s; }

function densify(coords: LonLat[], stepM = 80): LonLat[] {
  const out: LonLat[] = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const n = Math.max(1, Math.ceil(distM(a, b) / stepM));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (coords.length) out.push(coords[coords.length - 1]);
  return out;
}

function partsOf(g: GeoJSON.Geometry): LonLat[][] {
  if (g.type === 'LineString') return [g.coordinates as LonLat[]];
  if (g.type === 'MultiLineString') return g.coordinates as LonLat[][];
  return [];
}

/** Índice em grade dos segmentos de uma linha (rota) para distâncias rápidas ponto→rota. */
export class RouteIndex {
  private cells = new Map<string, number[]>();
  private readonly size = 0.01;
  constructor(public readonly coords: LonLat[]) {
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i], b = coords[i + 1];
      const x0 = Math.floor(Math.min(a[0], b[0]) / this.size), x1 = Math.floor(Math.max(a[0], b[0]) / this.size);
      const y0 = Math.floor(Math.min(a[1], b[1]) / this.size), y1 = Math.floor(Math.max(a[1], b[1]) / this.size);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const l = this.cells.get(k);
        if (l) l.push(i); else this.cells.set(k, [i]);
      }
    }
  }
  /** menor distância (m) do ponto à rota, considerando só segmentos a até ~1 célula; Infinity se longe */
  nearest(p: LonLat): { d: number; seg: number } {
    const cx = Math.floor(p[0] / this.size), cy = Math.floor(p[1] / this.size);
    let best = { d: Infinity, seg: -1 };
    const seen = new Set<number>();
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) {
      for (const i of this.cells.get(`${x},${y}`) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const d = segDistM(p, this.coords[i], this.coords[i + 1]);
        if (d < best.d) best = { d, seg: i };
      }
    }
    return best;
  }
  /** rumo (graus a partir do norte, 0–180) do segmento `seg` da rota */
  bearing(seg: number): number {
    const a = this.coords[seg], b = this.coords[seg + 1];
    const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
    const deg = (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
    return ((deg % 180) + 180) % 180;
  }
  /** metros da linha `c` que ficam a até tolM da rota (amostra a cada ~25 m) */
  usedLengthM(c: LonLat[], tolM: number): number {
    let used = 0;
    for (let i = 0; i < c.length - 1; i++) {
      const L = distM(c[i], c[i + 1]);
      const n = Math.max(1, Math.ceil(L / 25));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const p: LonLat = [c[i][0] + (c[i + 1][0] - c[i][0]) * t, c[i][1] + (c[i + 1][1] - c[i][1]) * t];
        if (this.nearest(p).d <= tolM) used += L / n;
      }
    }
    return used;
  }
}

function segDistM(p: LonLat, a: LonLat, b: LonLat): number {
  const k = Math.cos((p[1] * Math.PI) / 180) * 111_320, m = 111_320;
  const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * m, bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * m;
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function angleDiff180(a: number, b: number): number {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
}

/** Mesmo critério do routing.ts ("a rota usa o trecho"): ≥50% de até 40 pontos da linha a ≤15 m da rota. */
function routingUses(route: GeoJSON.Feature<GeoJSON.LineString>, coords: LonLat[]): boolean {
  if (!coords.length) return false;
  const pts = coords.length > 40 ? coords.filter((_, i) => i % Math.ceil(coords.length / 40) === 0) : coords;
  const hits = pts.filter((c) => turf.pointToLineDistance(turf.point(c), route, { units: 'meters' }) <= 15).length;
  return hits / pts.length >= 0.5;
}

// ------------------------------------------------------------------------------------------------ Valhalla

const VALHALLA_TIMEOUT_MS = 20_000;
/** espera máxima, por rota, pelo casamento de trechos ainda não cacheados (o casamento continua em segundo plano) */
const MATCH_BUDGET_MS = Number(process.env.FEDERAL_RESTRICOES_MATCH_BUDGET_MS ?? 25_000);
const EDGE_BUDGET = 25_000; // service_limits.max_linear_cost_edges do Valhalla é 50 000 por requisição (todas as camadas)

function limiter(n: number) {
  let active = 0;
  const q: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((r) => q.push(r));
    active++;
    try { return await fn(); } finally { active--; q.shift()?.(); }
  };
}
const vlimit = limiter(Number(process.env.FEDERAL_RESTRICOES_VALHALLA_CONCURRENCY ?? 3));

async function valhallaPost(path: string, body: unknown): Promise<{ ok: boolean; json: any }> {
  return vlimit(async () => {
    try {
      const res = await fetch(`${env.valhallaUrl}/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(VALHALLA_TIMEOUT_MS),
      });
      return { ok: res.ok, json: await res.json().catch(() => ({})) };
    } catch (e) {
      return { ok: false, json: { error: String(e) } };
    }
  });
}

let tilesetMemo: { v: string; at: number } | null = null;
let cleanedFor: string | null = null;
export async function tilesetVersion(): Promise<string | null> {
  if (tilesetMemo && Date.now() - tilesetMemo.at < 60_000) return tilesetMemo.v;
  try {
    const r = await fetch(`${env.valhallaUrl}/status`, { signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { tileset_last_modified?: number; version?: string };
    const v = String(j.tileset_last_modified ?? j.version ?? 'desconhecido');
    tilesetMemo = { v, at: Date.now() };
    if (cleanedFor !== v) {
      cleanedFor = v;
      query('delete from siaet_osm_match where tileset <> $1', [v]).catch(() => {});
      memCache.clear();
    }
    return v;
  } catch {
    return null;
  }
}

interface TraceEdge { way_id?: number; bridge?: boolean; length?: number; begin_shape_index: number; end_shape_index: number }
interface Trace { shape: LonLat[]; edges: TraceEdge[] }

async function trace(coords: LonLat[]): Promise<Trace | null> {
  if (coords.length < 2) return null;
  const r = await valhallaPost('trace_attributes', {
    shape: coords.map(([lon, lat]) => ({ lon, lat })), costing: 'auto', shape_match: 'map_snap',
    trace_options: { search_radius: 60 },
    filters: { attributes: ['edge.way_id', 'edge.bridge', 'edge.length', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape'], action: 'include' },
  });
  if (!r.ok || typeof r.json?.shape !== 'string' || !Array.isArray(r.json.edges) || !r.json.edges.length) return null;
  return { shape: decodePolyline6(r.json.shape), edges: r.json.edges };
}

/** trechos contínuos do casamento (quebra onde o fim de uma aresta não encosta no começo da próxima) */
function runs(t: Trace): TraceEdge[][] {
  const out: TraceEdge[][] = [];
  let cur: TraceEdge[] = [];
  for (const e of t.edges) {
    const prev = cur[cur.length - 1];
    if (prev && distM(t.shape[prev.end_shape_index], t.shape[e.begin_shape_index]) > 5) { out.push(cur); cur = []; }
    cur.push(e);
  }
  if (cur.length) out.push(cur);
  return out;
}
function shapeOf(t: Trace, es: TraceEdge[]): LonLat[] {
  return t.shape.slice(es[0].begin_shape_index, es[es.length - 1].end_shape_index + 1);
}

/** linear_cost_factors é recusado inteiro (erro 233) se uma linha não fizer edge walk: valida cada linha antes de usar. */
async function validLine(line: LonLat[]): Promise<boolean> {
  if (line.length < 2) return false;
  const a = line[0], b = line[Math.floor(line.length / 2)] ?? line[line.length - 1];
  const r = await valhallaPost('route', {
    locations: [{ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] }], costing: 'auto',
    linear_cost_factors: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: line }, properties: { factor: 2 } }],
  });
  return r.ok;
}

interface MatchResult { ok: boolean; lines: LonLat[][]; info: Record<string, unknown> }

/** Linhas válidas para os dois sentidos: ida-e-volta numa linha só (pista simples) ou ida + volta (pista dupla). */
async function bothDirections(fwd: LonLat[], revInput: () => Promise<LonLat[] | null>): Promise<LonLat[][]> {
  const oab = [...fwd, ...fwd.slice(0, -1).reverse()];
  if (await validLine(oab)) return [oab];
  const out: LonLat[][] = [];
  if (await validLine(fwd)) out.push(fwd);
  const rev = await revInput();
  if (rev && rev.length > 1 && (await validLine(rev))) out.push(rev);
  return out;
}

function trimRun(t: Trace, run: TraceEdge[]): TraceEdge[] {
  // a 1ª e a última aresta começam/terminam no ponto projetado (meio da aresta); sem elas a volta acontece num nó
  return run.length >= 3 ? run.slice(1, -1) : run;
}

async function matchSegment(geometry: GeoJSON.Geometry): Promise<MatchResult> {
  const lines: LonLat[][] = [];
  let edges = 0, matchedM = 0;
  for (const part of partsOf(geometry)) {
    const dense = densify(part, 80);
    for (let i = 0; i < dense.length - 1; i += 1500) {
      const chunk = dense.slice(i, i + 1501);
      const tf = await trace(chunk);
      if (!tf) continue;
      const fruns = runs(tf).map((r) => trimRun(tf, r)).filter((r) => r.length);
      let revCache: Trace | null | undefined;
      for (const run of fruns) {
        const fwd = shapeOf(tf, run);
        if (lineLenM(fwd) < 30) continue;
        const got = await bothDirections(fwd, async () => {
          if (revCache === undefined) revCache = await trace([...chunk].reverse());
          if (!revCache) return null;
          // trecho do casamento reverso mais próximo desta corrida
          const rr = runs(revCache).map((r) => trimRun(revCache!, r)).filter((r) => r.length);
          const mid = fwd[Math.floor(fwd.length / 2)];
          let best: LonLat[] | null = null, bd = Infinity;
          for (const r of rr) {
            const s = shapeOf(revCache, r);
            const d = Math.min(...s.filter((_, k) => k % 10 === 0).map((c) => distM(c, mid)));
            if (d < bd) { bd = d; best = s; }
          }
          return bd < 2000 ? best : null;
        });
        for (const l of got) { lines.push(l); edges += l.length; }
        if (got.length) matchedM += lineLenM(fwd);
      }
    }
  }
  return { ok: lines.length > 0, lines, info: { modo: 'segmento', pontos: edges, casado_km: Math.round(matchedM / 100) / 10 } };
}

function bridgeGroups(t: Trace): TraceEdge[][] {
  const out: TraceEdge[][] = [];
  let cur: TraceEdge[] = [];
  for (const e of t.edges) {
    if (e.bridge) {
      const prev = cur[cur.length - 1];
      if (prev && prev.end_shape_index !== e.begin_shape_index) { out.push(cur); cur = []; }
      cur.push(e);
    } else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}

function nearestGroup(t: Trace, focus: LonLat, maxM: number): LonLat[] | null {
  let best: LonLat[] | null = null, bd = Infinity;
  for (const g of bridgeGroups(t)) {
    const s = shapeOf(t, g);
    const d = Math.min(...s.map((c, i) => (i < s.length - 1 ? segDistM(focus, c, s[i + 1]) : distM(focus, c))));
    if (d < bd) { bd = d; best = s; }
  }
  return bd <= maxM ? best : null;
}

/** Só a ponte: casa ~3 km do eixo em torno da OAE e pega o grupo de arestas `bridge` mais próximo do ponto do DNIT. */
async function matchBridge(geometry: GeoJSON.Geometry, focus: LonLat): Promise<MatchResult | null> {
  const parts = partsOf(geometry).filter((p) => p.length > 1);
  if (!parts.length) return null;
  const fp = turf.point(focus);
  let bestPart = parts[0], bd = Infinity;
  for (const p of parts) {
    const d = turf.pointToLineDistance(fp, turf.lineString(p), { units: 'meters' });
    if (d < bd) { bd = d; bestPart = p; }
  }
  if (bd > 1500) return null;
  const ls = turf.lineString(bestPart);
  const loc = turf.nearestPointOnLine(ls, fp, { units: 'kilometers' }).properties.location ?? 0;
  const total = turf.length(ls, { units: 'kilometers' });
  const slice = turf.lineSliceAlong(ls, Math.max(0, loc - 1.5), Math.min(total, loc + 1.5), { units: 'kilometers' }).geometry.coordinates as LonLat[];
  const input = densify(slice, 60);
  const tf = await trace(input);
  if (!tf) return null;
  const fwd = nearestGroup(tf, focus, 250);
  if (!fwd) return null;
  const lines = await bothDirections(fwd, async () => {
    const tr = await trace([...input].reverse());
    return tr ? nearestGroup(tr, focus, 250) : null;
  });
  if (!lines.length) return null;
  return { ok: true, lines, info: { modo: 'ponte', pontos: lines.reduce((s, l) => s + l.length, 0), ponte_m: Math.round(lineLenM(fwd)) } };
}

const memCache = new Map<string, Promise<MatchResult>>();

interface MatchReq { key: string; mode: 'segmento' | 'ponte'; geometry: GeoJSON.Geometry; focus?: LonLat }

function geomHash(r: MatchReq): string {
  return createHash('md5').update(JSON.stringify([r.geometry, r.focus ?? null])).digest('hex');
}

async function computeMatch(r: MatchReq): Promise<MatchResult> {
  if (r.mode === 'ponte' && r.focus) {
    const b = await matchBridge(r.geometry, r.focus);
    if (b) return b;
    const s = await matchSegment(r.geometry);
    return { ...s, info: { ...s.info, aviso: 'ponte não encontrada no grafo OSM: aplicado ao segmento inteiro' } };
  }
  return matchSegment(r.geometry);
}

/** Casamento com cache (memória -> siaet_osm_match -> Valhalla). */
export function matchLines(r: MatchReq, tileset: string): Promise<MatchResult> {
  const gh = geomHash(r);
  const k = `${r.key}|${r.mode}|${tileset}|${gh}`;
  let p = memCache.get(k);
  if (!p) {
    p = (async () => {
      const db = await query<{ ok: boolean; lines: LonLat[][] | null; info: Record<string, unknown> | null; geom_hash: string }>(
        'select ok, lines, info, geom_hash from siaet_osm_match where feature_key = $1 and mode = $2 and tileset = $3', [r.key, r.mode, tileset],
      ).catch(() => ({ rows: [] as any[] }));
      const hit = db.rows[0];
      if (hit && hit.geom_hash === gh) return { ok: hit.ok, lines: hit.lines ?? [], info: hit.info ?? {} };
      const m = await computeMatch(r);
      await query(
        `insert into siaet_osm_match (feature_key, mode, tileset, geom_hash, ok, lines, info) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (feature_key, mode, tileset) do update set geom_hash = excluded.geom_hash, ok = excluded.ok, lines = excluded.lines,
           info = excluded.info, created_at = now()`,
        [r.key, r.mode, tileset, gh, m.ok, JSON.stringify(m.lines), JSON.stringify(m.info)],
      ).catch(() => {});
      return m;
    })();
    memCache.set(k, p);
    p.catch(() => memCache.delete(k));
  }
  return p;
}

// ------------------------------------------------------------------------------------------------ candidatos

interface Row { id: string; source: string; source_id: string; name: string | null; kind: string | null; props: any; geometry: GeoJSON.Geometry }

interface Candidate {
  row: Row;
  itemId: string;
  viols: Violation[];
  mode: 'segmento' | 'ponte';
  focus?: LonLat;
  label: string;
  /** descrição curta da violação (sem a fonte) */
  desc: string;
  rule: string;
  valueNum: number | null;
  /** distância (graus) do centro do trecho à reta origem–destino, para priorizar quando estoura o orçamento de arestas */
  prio: number;
}

interface Applied { cand: Candidate; lines: LonLat[][]; bridge: boolean }
interface Memo { lines: LayerCostLine[]; byItem: Map<string, Applied>; pendentes: number; sem_casamento: Candidate[] }
const memos = new WeakMap<RouteCtx, Memo>();

function corridor(ctx: RouteCtx): [number, number, number, number] {
  const dx = Math.abs(ctx.origin.lon - ctx.destination.lon), dy = Math.abs(ctx.origin.lat - ctx.destination.lat);
  const pad = Math.max(0.8, 0.5 * Math.max(dx, dy));
  return [Math.min(ctx.origin.lon, ctx.destination.lon) - pad, Math.min(ctx.origin.lat, ctx.destination.lat) - pad,
    Math.max(ctx.origin.lon, ctx.destination.lon) + pad, Math.max(ctx.origin.lat, ctx.destination.lat) + pad];
}

function prioOf(ctx: RouteCtx, g: GeoJSON.Geometry): number {
  try {
    const c = turf.centroid(turf.feature(g)).geometry.coordinates;
    return turf.pointToLineDistance(turf.point(c), turf.lineString([[ctx.origin.lon, ctx.origin.lat], [ctx.destination.lon, ctx.destination.lat]]), { units: 'degrees' });
  } catch { return 99; }
}

const SIAET_COLS = `id::text, source, source_id, name, kind, props, ST_AsGeoJSON(geom, 6)::json as geometry`;

async function siaetCandidates(ctx: RouteCtx): Promise<Candidate[]> {
  const v = ctx.vehicle;
  const bbox = corridor(ctx);
  const r = await query<Row>(
    `select ${SIAET_COLS} from data_features
      where layer_id = 'federal_restricoes' and source = 'siaet' and geom && ST_MakeEnvelope($1,$2,$3,$4,4326)
        and (valid_to is null or valid_to > now())
        and ( (props->>'altura_m')::float < $5 or (props->>'largura_m')::float < $6 or (props->>'peso_t')::float < $7
              or (props->>'comprimento_m')::float < $8 or jsonb_array_length(coalesce(props->'aet_bloqueada', '[]'::jsonb)) > 0 )`,
    [...bbox, v.height_m, v.width_m, v.weight_t, v.length_m],
  );
  const out: Candidate[] = [];
  for (const row of r.rows) {
    const p = row.props as SiaetProps;
    const viols = violations(p, v).filter((x) => x.bloqueia);
    if (!viols.length) continue;
    const onlyWeight = viols.every((x) => x.dim === 'peso' && !x.aet);
    const ponte = onlyWeight && p.oae_unica ? p.oae_unica : null;
    const label = `${row.name ?? `BR-${p.br}/${p.uf}`}${ponte ? ` — ${ponte.nome ?? 'ponte'}` : ''}`;
    out.push({
      row, itemId: `siaet:${row.source_id}`, viols, mode: ponte ? 'ponte' : 'segmento', focus: ponte ? [ponte.lon, ponte.lat] : undefined,
      label, desc: describeViolations(viols), rule: `${describeViolations(viols)} — SIAET/DNIT ${p.tipo === 'temporaria' ? 'temporária' : 'definitiva'} ${p.ref_mes}`,
      valueNum: viols.find((x) => x.dim === 'peso')?.limite ?? viols[0].limite, prio: prioOf(ctx, row.geometry),
    });
  }
  return out;
}

/** Alertas do DNIT aprovados na curadoria (dnit_alertas_curadoria.status = 'aprovado'). */
async function alertCandidates(ctx: RouteCtx): Promise<Candidate[]> {
  const v = ctx.vehicle;
  const bbox = corridor(ctx);
  const r = await query<Row & { acao: string | null; peso_max_t: number | null; valido_ate: string | null }>(
    `select f.id::text, f.source, f.source_id, f.name, f.kind, f.props, ST_AsGeoJSON(f.geom, 6)::json as geometry,
            c.acao, c.peso_max_t::float as peso_max_t, c.valido_ate
       from data_features f join dnit_alertas_curadoria c on c.source_id = f.source_id
      where f.layer_id = 'pontes_federais' and f.source = 'dnit-alertas' and c.status = 'aprovado'
        and (c.valido_ate is null or c.valido_ate > now()) and f.geom && ST_MakeEnvelope($1,$2,$3,$4,4326)`,
    bbox,
  ).catch(() => ({ rows: [] as any[] }));
  const out: Candidate[] = [];
  for (const row of r.rows) {
    let viols: Violation[] = [];
    if (row.acao === 'interdicao') viols = [{ dim: 'peso', limite: 0, valor: v.weight_t, aet: false, bloqueia: true }];
    else if (row.acao === 'limite_peso' && row.peso_max_t != null && v.weight_t > row.peso_max_t) viols = [{ dim: 'peso', limite: row.peso_max_t, valor: v.weight_t, aet: false, bloqueia: true }];
    if (!viols.length) continue;
    const ponto = row.props?.ponto as LonLat | undefined;
    const regra = row.acao === 'interdicao' ? 'ponte interditada' : describeViolations(viols);
    out.push({
      row, itemId: `alerta:${row.source_id}`, viols, mode: ponto && row.geometry.type !== 'Point' ? 'ponte' : 'segmento', focus: ponto,
      label: `${row.props?.oae_nome ?? 'Ponte'} BR-${row.props?.br}/${row.props?.uf}${row.props?.km != null ? ` km ${fmtKm(Number(row.props.km))}` : ''}`,
      desc: regra, rule: `${regra} — alerta do DNIT revisado (${row.props?.publicado_em ?? ''})`, valueNum: viols[0].limite || null, prio: prioOf(ctx, row.geometry),
    });
  }
  return out;
}

function factorFor(lenM: number): number {
  // ~600 km de "custo equivalente" por sentido: só passa se não houver desvio razoável (aí routing.ts avisa 'danger')
  return Math.min(100_000, Math.max(1000, Math.round(600 / Math.max(lenM / 1000, 0.05))));
}

function centerOf(lines: LonLat[][], fallback: GeoJSON.Geometry): LonLat {
  const l = lines[0];
  if (l?.length) {
    const half = l.length > 2 && distM(l[0], l[l.length - 1]) < 1 ? l.slice(0, Math.ceil(l.length / 2)) : l;
    try { return turf.along(turf.lineString(half), turf.length(turf.lineString(half)) / 2).geometry.coordinates as LonLat; } catch { /* segue */ }
  }
  return turf.centroid(turf.feature(fallback)).geometry.coordinates as LonLat;
}

// ------------------------------------------------------------------------------------------------ aquecimento

let warmStarted = false;
/** Casa em segundo plano os trechos que barram os presets legais (o 1º cálculo de rota não paga a conta). */
function warmUp() {
  if (warmStarted || process.env.FEDERAL_RESTRICOES_WARMUP === '0') return;
  warmStarted = true;
  setTimeout(async () => {
    try {
      const ts = await tilesetVersion();
      if (!ts) return;
      const r = await query<Row>(
        `select ${SIAET_COLS} from data_features where layer_id = 'federal_restricoes' and source = 'siaet'
           and ((props->>'peso_t')::float < 57 or (props->>'altura_m')::float < 4.4 or (props->>'comprimento_m')::float < 19.8)`,
      );
      for (const row of r.rows) {
        const p = row.props as SiaetProps;
        // presets legais (carreta 41,5 t / 18,6 m / 4,40 m): mesmo modo que costLines escolheria
        const onlyWeight = !(p.altura_m != null && p.altura_m < 4.4) && !(p.tipo === 'temporaria' && p.comprimento_m != null && p.comprimento_m < 18.6);
        const mode = onlyWeight && p.oae_unica ? 'ponte' : 'segmento';
        await matchLines({ key: `federal_restricoes:siaet:${row.source_id}`, mode, geometry: row.geometry, focus: mode === 'ponte' ? [p.oae_unica!.lon, p.oae_unica!.lat] : undefined }, ts).catch(() => null);
      }
    } catch { /* banco/valhalla indisponível: costLines casa sob demanda */ }
  }, 8000).unref?.();
}

// ------------------------------------------------------------------------------------------------ camada

const layer: RouteLayer = {
  meta: {
    id: 'federal_restricoes',
    label: 'Restrições federais (SIAET/DNIT)',
    description: 'Limites de altura, largura, PBT e comprimento por trecho de rodovia federal (SIAET/DNIT, atualização mensal).',
    group: 'restricoes',
    sources: [
      { name: 'DNIT/SIAET — Restrições definitivas e temporárias por UF', url: 'https://www.gov.br/dnit/pt-br/assuntos/infraestrutura-rodoviaria/aet/restricoes', license: 'Informação pública DNIT (Res. DNIT 11/2022); portal gov.br CC BY-ND 3.0 — só valores factuais, com citação' },
      { name: 'DNIT/DNITGeo — SNV (vgeo:vw_snv_rod) e OAEs (vgeo:oae_sgo)', url: 'https://servicos.dnit.gov.br/dnitgeo/geoserver/wfs', license: 'Dado público DNIT, sem licença explícita (AccessConstraints=NONE)' },
    ],
    style: { kind: 'line', color: '#dc2626', width: 4, opacity: 0.75, minzoom: 5, icon: '⛔' },
    defaultVisible: false,
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 10;
    const where = z < 9
      ? `((props->>'peso_t')::float < 74 or (props->>'altura_m')::float < 4.6 or (props->>'comprimento_m')::float < 19.8
          or (props->>'largura_m')::float < 3 or jsonb_array_length(coalesce(props->'aet_bloqueada','[]'::jsonb)) > 0)`
      : null;
    const simplify = z < 7 ? 0.003 : z < 10 ? 0.0005 : 0;
    const r = await query<Row>(
      `select id::text, source, source_id, name, kind, props,
              ST_AsGeoJSON(${simplify ? `ST_SimplifyPreserveTopology(geom, ${simplify})` : 'geom'}, 5)::json as geometry
         from data_features
        where layer_id = 'federal_restricoes' and source = 'siaet' and geom && ST_MakeEnvelope($1,$2,$3,$4,4326)
          ${where ? `and ${where}` : ''}
        limit 3000`,
      bbox,
    );
    const lim = (v: number | null, u: string) => (v == null ? null : v === 0 ? '0 (AET bloqueada)' : `${fmtNum(v)} ${u}`);
    return {
      type: 'FeatureCollection',
      features: r.rows.map((row) => {
        const p = row.props as SiaetProps;
        return {
          type: 'Feature' as const, id: row.id, geometry: row.geometry,
          properties: {
            id: row.id, item_id: `siaet:${row.source_id}`, name: row.name,
            'Restrição': p.tipo === 'temporaria' ? 'temporária' : 'definitiva',
            'PBT máx.': lim(p.peso_t, 't'), 'Altura máx.': lim(p.altura_m, 'm'), 'Largura útil': lim(p.largura_m, 'm'),
            'Comprimento máx.': lim(p.comprimento_m, 'm'),
            'AET bloqueada': p.aet_bloqueada?.length ? p.aet_bloqueada.join(', ') : null,
            'OAEs no trecho': p.n_oae, 'Ponte': p.oae_unica?.nome ?? null,
            'Trecho': [p.local_inicio, p.local_fim].filter(Boolean).join(' → ') || null,
            'Referência': `SIAET ${p.ref_mes}${p.atualizado_em ? ` (atualizado ${p.atualizado_em})` : ''}`,
            'Geometria': p.geom_aprox ? 'aproximada (km do SIAET difere do SNV atual)' : 'segmento SNV',
            source: row.source,
          },
        };
      }),
    };
  },

  async costLines(ctx) {
    warmUp();
    const memo: Memo = { lines: [], byItem: new Map(), pendentes: 0, sem_casamento: [] };
    memos.set(ctx, memo);
    const cands = [...(await siaetCandidates(ctx)), ...(await alertCandidates(ctx))].sort((a, b) => a.prio - b.prio);
    if (!cands.length) return [];
    const ts = await tilesetVersion();
    if (!ts) { memo.sem_casamento.push(...cands); return []; }
    const deadline = Date.now() + MATCH_BUDGET_MS;
    const results = await Promise.all(cands.map(async (c) => {
      const p = matchLines({ key: `${c.row.source === 'siaet' ? 'federal_restricoes' : 'pontes_federais'}:${c.row.source}:${c.row.source_id}`, mode: c.mode, geometry: c.row.geometry, focus: c.focus }, ts);
      const left = deadline - Date.now();
      const res: MatchResult | null | 'timeout' = await Promise.race([
        p.catch(() => null),
        new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), Math.max(0, left)).unref?.()),
      ]);
      return { c, res };
    }));
    let budget = EDGE_BUDGET;
    for (const { c, res } of results) {
      if (res === 'timeout') { memo.pendentes++; memo.sem_casamento.push(c); continue; }
      if (!res || !res.ok || !res.lines.length) { memo.sem_casamento.push(c); continue; }
      const n = res.lines.reduce((s, l) => s + l.length, 0);
      if (n > budget) { memo.sem_casamento.push(c); continue; }
      budget -= n;
      const isBridge = res.info?.modo === 'ponte';
      const [lon, lat] = centerOf(res.lines, c.row.geometry);
      const item: LayerItem = {
        kind: 'layer', layer: 'federal_restricoes', id: c.itemId, name: isBridge || c.mode === 'segmento' ? c.label : `${c.row.name}`,
        type: c.row.source === 'siaet' ? `siaet_${c.row.kind}` : 'alerta_dnit', rule: c.rule, value_num: c.valueNum, lat, lon,
        note: isBridge ? 'Aplicado só na ponte (único OAE do segmento).' : c.row.props?.geom_aprox ? 'Geometria do trecho aproximada.' : null,
      };
      memo.byItem.set(c.itemId, { cand: c, lines: res.lines, bridge: isBridge });
      for (const l of res.lines) {
        const dirLen = l.length > 2 && distM(l[0], l[l.length - 1]) < 1 ? lineLenM(l) / 2 : lineLenM(l);
        memo.lines.push({ item, coordinates: l, factor: factorFor(dirLen) });
      }
    }
    return memo.lines;
  },

  async annotate(ctx, route) {
    const memo = memos.get(ctx);
    const v = ctx.vehicle;
    const coords = route.line.geometry.coordinates as LonLat[];
    const idx = new RouteIndex(coords);
    const rows = await featuresNearRoute('federal_restricoes', route.line.geometry, 50, { limit: 600, where: `f.source = 'siaet'` });
    const warnings: LayerWarning[] = [];
    const onRoute: { row: typeof rows[number]; p: SiaetProps; usedKm: number; viols: Violation[] }[] = [];
    for (const row of rows) {
      const p = row.props as unknown as SiaetProps;
      let total = 0, used = 0;
      for (const part of partsOf(row.geometry)) { total += lineLenM(part); used += idx.usedLengthM(part, 45); }
      if (used < Math.min(400, 0.5 * total)) continue;
      onRoute.push({ row, p, usedKm: used / 1000, viols: violations(p, v) });
    }

    // uso de uma linha penalizada (ida-e-volta conta só um sentido): ponte = ≥50% dela; segmento = ≥400 m ou ≥50%
    const dirLen = (l: LonLat[]) => (l.length > 2 && distM(l[0], l[l.length - 1]) < 1 ? lineLenM(l) / 2 : lineLenM(l));
    const usesLines = (ri: RouteIndex, a: Applied) => a.lines.some((l) => {
      const need = a.bridge ? 0.5 * dirLen(l) : Math.min(400, 0.5 * dirLen(l));
      return ri.usedLengthM(l, 15) >= Math.max(need, 15);
    });
    const freeIdx = route.free ? new RouteIndex(route.free.line.geometry.coordinates as LonLat[]) : null;
    const evitados: string[] = [];
    const violadas = new Set<string>();
    for (const [id, a] of memo?.byItem ?? []) {
      const uses = usesLines(idx, a);
      if (!uses) {
        if (freeIdx && usesLines(freeIdx, a)) evitados.push(`${a.cand.label} (${a.cand.desc})`);
        continue;
      }
      violadas.add(id);
      // routing.ts já avisa ('uses_restricted_way') quando a rota usa ≥50% da linha penalizada; aqui cobre o resto
      if (!a.lines.some((l) => routingUses(route.line, l))) {
        warnings.push({
          code: 'siaet_restricao_na_rota', severity: 'danger', id, lat: a.cand.row.props?.oae_unica?.lat, lon: a.cand.row.props?.oae_unica?.lon,
          message: `A rota passa por ${a.cand.label}, onde ${a.cand.desc} (${a.cand.row.source === 'siaet' ? 'SIAET/DNIT' : 'alerta do DNIT revisado'}). Sem desvio razoável encontrado: confira a sinalização e a AET antes de seguir.`,
        });
      }
    }

    for (const o of onRoute) {
      const itemId = `siaet:${o.row.source_id}`;
      for (const x of o.viols.filter((y) => !y.bloqueia)) {
        warnings.push(x.motivo === 'definitiva_comprimento'
          ? { code: 'siaet_restricao_geometrica', severity: 'warn', id: itemId,
              message: `${o.row.name}: o SIAET registra comprimento máx. ${fmtNum(x.limite)} m (restrição definitiva, cadastrada para AET); veículo de ${fmtNum(x.valor)} m. Confira a placa R-18 e as curvas do trecho antes de seguir.` }
          : { code: 'siaet_aet_outro_orgao', severity: 'warn', id: itemId,
              message: `${o.row.name}: trecho fora da jurisdição federal (${o.p.administracao ?? 'não federal'}); o DNIT não emite AET aqui. Peça a autorização ao órgão com circunscrição sobre a via.` });
      }
      if (o.viols.some((y) => y.bloqueia)) {
        if (!memo?.byItem.has(itemId) && !violadas.has(itemId)) {
          // viola mas não virou linha penalizada (fora do mapa carregado, casamento falhou ou ainda pendente)
          warnings.push({
            code: 'siaet_restricao_na_rota', severity: 'danger', id: itemId,
            message: `A rota usa ${o.row.name} (${o.usedKm.toFixed(1).replace('.', ',')} km), onde o SIAET/DNIT registra ${describeViolations(o.viols.filter((y) => y.bloqueia))}. A restrição não pôde ser aplicada no cálculo: confira a sinalização e a AET antes de seguir.`,
          });
        }
        continue;
      }
      const zeros = (o.p.aet_bloqueada ?? []).filter((z) => !aetDims(v).has(z) && !o.viols.some((y) => y.dim === z));
      if (zeros.length) {
        warnings.push({
          code: 'siaet_aet_bloqueada', severity: 'warn', id: itemId,
          message: `${o.row.name}: o SIAET marca AET bloqueada (${zeros.join(', ')}) neste trecho. Não há limite para veículo sem AET, mas pode haver obra ou interdição: confira os alertas do DNIT.`,
        });
      }
      const folga: string[] = [];
      for (const d of DIMS) {
        const lim = o.p[PROP[d]];
        const val = vehicleValue(v, d);
        if (lim != null && lim > 0 && val <= lim && lim - val < (d === 'peso' ? 1 : 0.1)) folga.push(`${LABEL[d]} ${fmtNum(lim)} ${UNIT[d]}`);
      }
      if (folga.length) {
        warnings.push({ code: 'siaet_folga_minima', severity: 'info', id: itemId, message: `${o.row.name}: veículo no limite do SIAET (${folga.join(', ')}). Sem margem para carga mais alta ou mais pesada.` });
      }
    }

    if (memo?.sem_casamento.length) {
      const pend = memo.pendentes;
      warnings.push({
        code: 'siaet_nao_aplicado', severity: 'info',
        message: pend
          ? `${pend} restrição(ões) federal(is) do SIAET ainda em preparação no mapa: recalcule a rota em instantes para aplicá-las.`
          : `${memo.sem_casamento.length} restrição(ões) do SIAET que barram este veículo ficam fora do mapa carregado ou não casaram com as vias; não foram aplicadas.`,
      });
    }

    const refs = [...new Set(onRoute.map((o) => o.p.ref_mes))];
    const ref = refs[0] ?? (rows[0]?.props as any)?.ref_mes ?? null;
    if (ref) {
      const [mm, yyyy] = String(ref).split('/').map(Number);
      const at = new Date(ctx.at);
      const months = (at.getUTCFullYear() - yyyy) * 12 + (at.getUTCMonth() + 1 - mm);
      if (months >= 2) warnings.push({ code: 'siaet_desatualizado', severity: 'info', message: `Restrições do SIAET com referência ${ref}: rode o importador mensal (siaet_restricoes) para atualizar.` });
    }

    const summary: string[] = [];
    if (onRoute.length) {
      summary.push(`${onRoute.length} trecho(s) federal(is) da rota com restrição no SIAET/DNIT (ref. ${refs.join(', ')}).`);
      const mins: string[] = [];
      for (const d of DIMS) {
        const vals = onRoute.map((o) => ({ v: o.p[PROP[d]], n: o.row.name })).filter((x) => x.v != null && x.v > 0) as { v: number; n: string }[];
        if (!vals.length) continue;
        const m = vals.reduce((a, b) => (b.v < a.v ? b : a));
        const relevant = d === 'peso' ? m.v < 74 : d === 'altura' ? m.v < 5 : d === 'comprimento' ? m.v < 30 : m.v < 3.2;
        if (relevant) mins.push(`${LABEL[d]} ${fmtNum(m.v)} ${UNIT[d]} (${m.n})`);
      }
      if (mins.length) summary.push(`Menores limites na rota: ${mins.join('; ')}.`);
    } else if (rows.length || memo?.byItem.size) {
      summary.push('Nenhum trecho federal da rota com limite do SIAET que afete veículos.');
    }
    if (evitados.length) summary.push(`Evitado(s) por exceder o limite: ${evitados.slice(0, 4).join('; ')}${evitados.length > 4 ? ` e mais ${evitados.length - 4}` : ''}.`);

    return {
      summary,
      warnings,
      data: {
        ref_mes: ref,
        aplicadas: memo?.byItem.size ?? 0,
        nao_aplicadas: memo?.sem_casamento.map((c) => c.itemId) ?? [],
        trechos: onRoute.map((o) => ({
          id: `siaet:${o.row.source_id}`, nome: o.row.name, tipo: o.p.tipo, br: o.p.br, uf: o.p.uf, km_ini: o.p.km_ini, km_fim: o.p.km_fim,
          altura_m: o.p.altura_m, largura_m: o.p.largura_m, peso_t: o.p.peso_t, comprimento_m: o.p.comprimento_m, aet_bloqueada: o.p.aet_bloqueada,
          km_na_rota: Math.round(o.usedKm * 10) / 10, viola: o.viols.filter((x) => x.bloqueia).map((x) => x.dim),
          atencao: o.viols.filter((x) => !x.bloqueia).map((x) => x.dim), geom_aprox: o.p.geom_aprox,
        })),
        evitados,
      },
    };
  },
};

export default layer;
