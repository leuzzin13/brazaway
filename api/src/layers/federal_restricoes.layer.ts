import { createHash } from 'node:crypto';
import * as turf from '@turf/turf';
import { env, vehiclePresets } from '../config.js';
import { query } from '../db.js';
import { decodePolyline6 } from '../services/polyline.js';
import { MAX_LENGTH_BY_CLASS, resolveVehicle, type Vehicle } from '../services/vehicle.js';
import type { LayerCostLine, LayerItem, LayerWarning, RouteCtx, RouteGeom, RouteLayer } from './types.js';

/**
 * Restrições físicas das rodovias federais cadastradas no SIAET/DNIT (PDFs mensais por UF, restrição definitiva e
 * temporária), com geometria do segmento PNV (SNV/DNITGeo). Importador: importers/sources/siaet_restricoes.py.
 *
 * Regras (docs/layers/federal_restricoes.md):
 *  - limite > 0 e o veículo excede (altura, largura útil, PBT, comprimento) -> trecho penalizado (costLines).
 *    Base: Res. DNIT 11/2022, art. 4º XXVII–XXVIII e art. 29 §§2º–3º (restrição temporária "limite temporariamente o
 *    trânsito normal de veículos" e exige sinalização).
 *  - PBT = 0 numa restrição TEMPORÁRIA de rodovia sob jurisdição federal -> trecho impedido (interdição) para todo
 *    veículo de carga. A Res. 11/2022 não define o 0; a leitura vem dos casos conferidos em notícias do DNIT/imprensa
 *    (Rio Tocantins/BR-235/TO, Rio Piquiri/BR-272/PR, Córrego Treviso Grande/BR-259/ES, Rio das Antas/BR-116/RS,
 *    Rio Igarassu/BR-101/PE pista 1, BR-232/PE km 314): todos interditados ou com carga proibida.
 *  - 0 em altura/largura/comprimento -> "AET não autorizada" naquela grandeza (há linhas com largura 0 e PBT 60 t):
 *    só penaliza veículo que precisa de AET por ela (Res. CONTRAN 882/2021, arts. 4º e 18); para os demais vira aviso.
 *  - violação só de PBT e o segmento tem exatamente 1 ponte/viaduto (DNITGeo) -> penaliza só a ponte OSM casada.
 * A linha penalizada precisa seguir exatamente as arestas do Valhalla (edge walk), então cada segmento é casado uma vez
 * com trace_attributes, validado e guardado em siaet_osm_match (por versão dos tiles). Toda linha é DIRIGIDA (sentido
 * crescente ou decrescente do km): o linear_cost_factors é por aresta dirigida e o routing.ts confere o sentido.
 * Também aplica os alertas do DNIT APROVADOS na curadoria (dnit_alertas_curadoria); pendentes nunca entram na rota.
 */

type LonLat = [number, number];
export type Dim = 'altura' | 'largura' | 'peso' | 'comprimento';
const DIMS: Dim[] = ['altura', 'largura', 'peso', 'comprimento'];
const PROP: Record<Dim, 'altura_m' | 'largura_m' | 'peso_t' | 'comprimento_m'> = { altura: 'altura_m', largura: 'largura_m', peso: 'peso_t', comprimento: 'comprimento_m' };
const UNIT: Record<Dim, string> = { altura: 'm', largura: 'm', peso: 't', comprimento: 'm' };
const LABEL: Record<Dim, string> = { altura: 'altura máx.', largura: 'largura máx.', peso: 'PBT máx.', comprimento: 'comprimento máx.' };

/**
 * Limites sem AET: Res. CONTRAN 882/2021 art. 4º (largura 2,60 m, red. Res. 994/2023; altura 4,40 m; comprimento por
 * classe, ver MAX_LENGTH_BY_CLASS) e art. 18 (CVC acima de 57 t só com AET). Para os demais veículos 57 t é o balizador
 * de "veículo de carga cujo transporte não necessite de AET" da Res. DNIT 11/2022, art. 29 §6º.
 */
export const SEM_AET = { altura_m: 4.4, largura_m: 2.6, peso_t: 57 } as const;

export interface SiaetProps {
  tipo: 'definitiva' | 'temporaria';
  br: string; uf: string; pnv: string; km_ini: number; km_fim: number;
  ref_mes: string; atualizado_em: string | null;
  altura_m: number | null; largura_m: number | null; peso_t: number | null; comprimento_m: number | null;
  aet_bloqueada: Dim[];
  /** limites por pista: 1 = sentido crescente do km (= sentido da geometria do SNV), 2 = decrescente */
  pista1?: PistaLimits | null; pista2?: PistaLimits | null;
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
 *  - 0 em trecho fora da jurisdição federal: a Res. DNIT 11/2022 trata de rodovia federal, inclusive concedida ou
 *    delegada (art. 1º e parágrafo único); em via estadual/municipal o 0 não diz nada sobre o trânsito normal e a AET é
 *    do órgão da via (ex.: 116BSP2550, Marginal Tietê, 0 em tudo e aberta ao tráfego).
 */
export interface PistaLimits { altura_m: number | null; largura_m: number | null; peso_t: number | null; comprimento_m: number | null }

/** limites de uma pista no formato de `violations` (0 = PBT impedido / AET bloqueada naquela grandeza) */
function pistaProps(pl: PistaLimits, base: Pick<SiaetProps, 'tipo' | 'administracao'>) {
  const lim = (x: number | null | undefined) => (x != null && x > 0 ? x : null);
  const zeros = DIMS.filter((d) => pl[PROP[d]] === 0);
  return { altura_m: lim(pl.altura_m), largura_m: lim(pl.largura_m), peso_t: lim(pl.peso_t), comprimento_m: lim(pl.comprimento_m), aet_bloqueada: zeros, tipo: base.tipo, administracao: base.administracao };
}

/**
 * Limites que valem para os sentidos usados: só o crescente -> pista 1; só o decrescente -> pista 2 (ou a 1, se a 2
 * não foi publicada); os dois ou desconhecido -> o mais restritivo das pistas (props do topo, conservador).
 */
function limitsFor(p: SiaetProps, dirs: Set<Dir>): LimitProps {
  if (!p.pista1 || dirs.size !== 1) return p;
  const temP2 = !!p.pista2 && DIMS.some((d) => p.pista2![PROP[d]] != null);
  return dirs.has('crescente') || !temP2 ? pistaProps(p.pista1, p) : pistaProps(p.pista2!, p);
}

export interface Violation {
  dim: Dim; limite: number; valor: number;
  /** 0 de AET (só barra quem precisa de AET naquela grandeza) */
  aet: boolean;
  /** PBT 0 na temporária de via federal: trecho impedido para veículo de carga */
  interdicao?: boolean;
  bloqueia: boolean;
  motivo?: 'definitiva_comprimento' | 'aet_fora_jurisdicao' | 'interdicao';
}

/**
 * Administração fora da jurisdição federal. "Convênio Adm.Federal/Estadual|Municipal" é rodovia federal delegada
 * (continua sob a Res. DNIT 11/2022, art. 1º parágrafo único); vazio = sem informação, tratado como federal.
 */
export function naoFederal(adm: string | null | undefined): boolean {
  const a = (adm ?? '').trim();
  return /estadual|municipal|^der$/i.test(a) && !/federal/i.test(a);
}

function vehicleValue(v: Vehicle, d: Dim): number {
  return d === 'altura' ? v.height_m : d === 'largura' ? v.width_m : d === 'peso' ? v.weight_t : v.length_m;
}

/** Grandezas em que o veículo precisa de AET (e portanto é barrado por um 0 de AET do SIAET). */
export function aetDims(v: Vehicle): Set<Dim> {
  const s = new Set<Dim>();
  if (v.height_m > SEM_AET.altura_m) s.add('altura');
  if (v.width_m > SEM_AET.largura_m) s.add('largura');
  if (v.weight_t > SEM_AET.peso_t) s.add('peso');
  if (v.length_m > MAX_LENGTH_BY_CLASS[v.vehicle_class ?? 'rigid']) s.add('comprimento');
  // declarou que roda com AET mas nenhuma dimensão passa do limite legal: não sabemos o motivo -> todas
  if (v.requires_aet && !s.size) for (const d of DIMS) s.add(d);
  return s;
}

type LimitProps = Pick<SiaetProps, 'altura_m' | 'largura_m' | 'peso_t' | 'comprimento_m' | 'aet_bloqueada'> & { tipo?: string; administracao?: string | null };

export function violations(p: LimitProps, v: Vehicle): Violation[] {
  const out: Violation[] = [];
  const need = aetDims(v);
  const fora = naoFederal(p.administracao);
  const zeros = p.aet_bloqueada ?? [];
  if (p.tipo === 'temporaria' && !fora && zeros.includes('peso')) {
    out.push({ dim: 'peso', limite: 0, valor: v.weight_t, aet: false, interdicao: true, bloqueia: true, motivo: 'interdicao' });
  }
  for (const d of DIMS) {
    const lim = p[PROP[d]];
    const val = vehicleValue(v, d);
    if (lim != null && lim > 0 && val > lim + 1e-9 && !out.some((o) => o.dim === d)) {
      const geom = p.tipo === 'definitiva' && d === 'comprimento' && !need.has('comprimento');
      out.push({ dim: d, limite: lim, valor: val, aet: false, bloqueia: !geom, motivo: geom ? 'definitiva_comprimento' : undefined });
    }
  }
  for (const z of zeros) {
    if (need.has(z) && !out.some((o) => o.dim === z)) {
      out.push({ dim: z, limite: 0, valor: vehicleValue(v, z), aet: true, bloqueia: !fora, motivo: fora ? 'aet_fora_jurisdicao' : undefined });
    }
  }
  return out;
}

export function fmtNum(n: number, max = 2): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: max });
}
function fmtKm(n: number): string { return n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }

export function describeViolations(vs: Violation[]): string {
  return vs.map((x) => x.interdicao
    ? 'trecho impedido para veículo de carga: PBT 0 na restrição temporária'
    : x.aet
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
  /** rumo dirigido (graus a partir do norte, 0–360) do segmento `seg` da rota */
  heading(seg: number): number {
    return headingOf(this.coords[seg], this.coords[seg + 1]);
  }
  /**
   * metros da linha `c` que ficam a até tolM da rota (amostra a cada ~25 m). Com `sameDir`, só conta onde a rota
   * anda no mesmo sentido da linha (diferença de rumo < 90°, como o routing.ts).
   */
  usedLengthM(c: LonLat[], tolM: number, sameDir = false): number {
    const u = this.usedByDirM(c, tolM);
    return sameDir ? u.mesmo : u.mesmo + u.contrario;
  }
  /** metros da linha `c` a até tolM da rota, separados pelo sentido em que a rota anda em relação à linha */
  usedByDirM(c: LonLat[], tolM: number): { mesmo: number; contrario: number } {
    const out = { mesmo: 0, contrario: 0 };
    for (let i = 0; i < c.length - 1; i++) {
      const L = distM(c[i], c[i + 1]);
      if (!L) continue;
      const h = headingOf(c[i], c[i + 1]);
      const n = Math.max(1, Math.ceil(L / 25));
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const p: LonLat = [c[i][0] + (c[i + 1][0] - c[i][0]) * t, c[i][1] + (c[i + 1][1] - c[i][1]) * t];
        const nr = this.nearest(p);
        if (nr.d > tolM) continue;
        if (angleDiff360(this.heading(nr.seg), h) < 90) out.mesmo += L / n; else out.contrario += L / n;
      }
    }
    return out;
  }
}

function headingOf(a: LonLat, b: LonLat): number {
  const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  const deg = (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI;
  return (deg + 360) % 360;
}
function angleDiff360(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return Math.min(d, 360 - d);
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

/**
 * Mesmo critério do usesCostLine do routing.ts ("a rota usa o trecho penalizado no mesmo sentido"): amostra até ~30
 * segmentos da linha; ≥50% deles a ≤15 m da rota e, desses, ≥50% com rumo a menos de 90° do rumo da rota.
 * Serve para saber se o routing.ts já avisou ('uses_restricted_way') e não repetir o aviso.
 */
export function routingUses(idx: RouteIndex, coords: LonLat[]): boolean {
  if (coords.length < 2) return coords.length === 1 && idx.nearest(coords[0]).d <= 15;
  const step = Math.max(1, Math.ceil((coords.length - 1) / 30));
  let near = 0, same = 0, total = 0;
  for (let i = 0; i < coords.length - 1; i += step) {
    total++;
    const a = coords[i], b = coords[i + 1];
    const nr = idx.nearest([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    if (nr.d > 15) continue;
    near++;
    if (angleDiff360(headingOf(a, b), idx.heading(nr.seg)) < 90) same++;
  }
  if (!total || near / total < 0.5) return false;
  return same / near >= 0.5;
}

/**
 * Feições a ~`deg` graus da rota (ST_DWithin planar). A rota é quebrada em pedaços de ≤64 vértices (ST_Subdivide)
 * para o índice GIST trabalhar por pedaço: com a rota inteira como uma geometria só, o bbox cobre centenas de km e o
 * ST_DWithin contra as linhas longas do SNV ficava lento em rotas longas. A medida fina é feita depois em JS (RouteIndex).
 */
export async function nearRoute(line: GeoJSON.LineString, layerId: string, where: string, deg: number, limit: number) {
  const r = await query<{ id: string; source: string; source_id: string; name: string | null; kind: string | null; props: any; geometry: GeoJSON.Geometry; valid_from: string | null }>(
    `with l as (select ST_SimplifyPreserveTopology(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326), 0.00005) as g),
          s as (select ST_Subdivide(ST_Segmentize(l.g, 0.05), 64) as g from l),
          c as (select distinct f.id from data_features f join s on f.geom && ST_Expand(s.g, $3) and ST_DWithin(f.geom, s.g, $3)
                 where f.layer_id = $2 and (f.valid_to is null or f.valid_to > now()) and (${where}))
     select f.id::text, f.source, f.source_id, f.name, f.kind, f.props, ST_AsGeoJSON(f.geom, 6)::json as geometry, f.valid_from
       from data_features f join c using (id)
      limit $4`,
    [JSON.stringify(line), layerId, deg, limit],
  );
  return r.rows;
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

interface TraceEdge {
  way_id?: number; bridge?: boolean; length?: number; traversability?: 'forward' | 'backward' | 'both'; names?: string[]; road_class?: string;
  begin_shape_index: number; end_shape_index: number;
}
interface Trace { shape: LonLat[]; edges: TraceEdge[]; medianM: number }

/** Casa uma linha com o grafo (map matching). Recusa casamento ruim: mediana da distância ponto→via > 45 m. */
async function trace(coords: LonLat[]): Promise<Trace | null> {
  if (coords.length < 2) return null;
  const r = await valhallaPost('trace_attributes', {
    shape: coords.map(([lon, lat]) => ({ lon, lat })), costing: 'auto', shape_match: 'map_snap',
    trace_options: { search_radius: 60 },
    filters: {
      attributes: ['edge.way_id', 'edge.bridge', 'edge.length', 'edge.traversability', 'edge.names', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape',
        'edge.road_class', 'matched.distance_from_trace_point', 'matched.type'],
      action: 'include',
    },
  });
  if (!r.ok || typeof r.json?.shape !== 'string' || !Array.isArray(r.json.edges) || !r.json.edges.length) return null;
  const ds = (r.json.matched_points ?? []).filter((m: any) => m.type === 'matched').map((m: any) => Number(m.distance_from_trace_point ?? 0)).sort((x: number, y: number) => x - y);
  const medianM = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  if (medianM > 45) return null;
  return { shape: decodePolyline6(r.json.shape), edges: r.json.edges, medianM };
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
/** sub-trechos consecutivos de mão dupla ('both') e de mão única (pista dupla, alças) */
function byTraversability(run: TraceEdge[]): { twoWay: boolean; edges: TraceEdge[] }[] {
  const out: { twoWay: boolean; edges: TraceEdge[] }[] = [];
  for (const e of run) {
    const tw = e.traversability === 'both';
    const last = out[out.length - 1];
    if (last && last.twoWay === tw) last.edges.push(e); else out.push({ twoWay: tw, edges: [e] });
  }
  return out;
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

/** sentido da linha penalizada: 'crescente' = sentido do km (pista 1 do SIAET, sentido da geometria do SNV); 'decrescente' = pista 2 */
export type Dir = 'crescente' | 'decrescente';
const oposto = (d: Dir): Dir => (d === 'crescente' ? 'decrescente' : 'crescente');
interface MatchResult { ok: boolean; lines: LonLat[][]; dirs: Dir[]; info: Record<string, unknown> }
/** muda quando o formato/algoritmo do cache muda (força recasar). v6: só linhas dirigidas (sem ida-e-volta). */
const MATCH_VERSION = 'v6';

/**
 * Acumula linhas DIRIGIDAS já validadas. O grafo do Valhalla tem as duas arestas dirigidas mesmo em via de mão única
 * e o linear_cost_factors é por aresta dirigida, então:
 *  - trecho de mão dupla ('both'): valida a ida-e-volta uma vez (uma chamada) e guarda as duas metades, cada uma com o
 *    seu sentido (a metade é um sub-percurso da ida-e-volta, cortado num nó: também faz edge walk). Assim cada sentido
 *    recebe os limites da sua pista e o routing.ts, que confere o sentido, reconhece o uso;
 *  - trecho de mão única (pista dupla): a linha casada, no sentido em que foi casada.
 */
class Lines {
  lines: LonLat[][] = [];
  dirs: Dir[] = [];
  pts = 0;
  async oneWay(l: LonLat[], d: Dir): Promise<boolean> {
    if (lineLenM(l) < 10 || !(await validLine(l))) return false;
    this.add(l, d);
    return true;
  }
  async twoWay(l: LonLat[], d: Dir): Promise<boolean> {
    if (lineLenM(l) < 10 || !(await validLine([...l, ...l.slice(0, -1).reverse()]))) return false;
    this.add(l, d);
    this.add([...l].reverse(), oposto(d));
    return true;
  }
  add(l: LonLat[], d: Dir) { this.lines.push(l); this.dirs.push(d); this.pts += l.length; }
}

/**
 * Linhas dos dois sentidos a partir das arestas casadas no sentido `fwd` (que é o sentido `d0` do km). Pedaços de mão
 * única são casados de novo com a geometria invertida (`rev`) para pegar a outra pista.
 */
async function directional(fwd: Trace, fwdEdges: TraceEdge[], d0: Dir, rev: () => Promise<{ t: Trace; edges: TraceEdge[] } | null>): Promise<Lines> {
  const out = new Lines();
  let oneWay = false;
  for (const sub of keptSubs(fwdEdges)) {
    const l = shapeOf(fwd, sub.edges);
    if (sub.twoWay) await out.twoWay(l, d0);
    else { oneWay = true; await out.oneWay(l, d0); }
  }
  if (oneWay) {
    const r = await rev();
    if (r) for (const sub of keptSubs(r.edges)) if (!sub.twoWay) await out.oneWay(shapeOf(r.t, sub.edges), oposto(d0));
  }
  return out;
}

function trimRun(run: TraceEdge[]): TraceEdge[] {
  // a 1ª e a última aresta começam/terminam no ponto projetado (meio da aresta); sem elas a volta acontece num nó
  return run.length >= 3 ? run.slice(1, -1) : run;
}

/** desloca a linha `m` metros para a direita do sentido de percurso */
function offsetLine(c: LonLat[], m: number): LonLat[] {
  return c.map((p, i) => {
    const a = c[Math.max(0, i - 1)], b = c[Math.min(c.length - 1, i + 1)];
    const k = Math.cos((p[1] * Math.PI) / 180);
    const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    return [p[0] + ((dy / L) * m) / 111_320 / k, p[1] + ((-dx / L) * m) / 111_320] as LonLat;
  });
}

/**
 * Pistas paralelas do mesmo sentido (expressa/local, ex.: Av. Brasil): a restrição da "pista 1/2" do SIAET vale para o
 * sentido inteiro. Casa a linha deslocada ±25/±40 m e aceita só vias de mão única do mesmo nome/ref da principal,
 * bem ajustadas (mediana ≤ 15 m) e ainda não cobertas. Só roda em trecho de pista dupla.
 */
async function parallelLanes(chunk: LonLat[], fwd: Trace, rev: Trace | null, dirsFound: Dir[]): Promise<{ line: LonLat[]; dir: Dir }[]> {
  const out: { line: LonLat[]; dir: Dir }[] = [];
  const names = new Set<string>();
  const seen = new Set<number>();
  for (const t of [fwd, rev]) for (const e of t?.edges ?? []) { (e.names ?? []).forEach((n) => names.add(n)); if (e.way_id != null) seen.add(e.way_id); }
  if (!names.size) return out;
  const sentidos: { dir: Dir; base: LonLat[] }[] = [];
  if (dirsFound.includes('crescente')) sentidos.push({ dir: 'crescente', base: chunk });
  if (dirsFound.includes('decrescente')) sentidos.push({ dir: 'decrescente', base: [...chunk].reverse() });
  for (const { dir, base } of sentidos) {
    for (const off of [-40, -25, 25, 40]) {
      const t = await trace(offsetLine(base, off));
      if (!t || t.medianM > 15) continue;
      for (const run of runs(t).map(trimRun)) {
        for (const sub of byTraversability(run)) {
          if (sub.twoWay) continue;
          const novos = sub.edges.filter((e) => e.way_id != null && !seen.has(e.way_id));
          const lenAll = sub.edges.reduce((n, e) => n + (e.length ?? 0), 0);
          const lenSame = sub.edges.filter((e) => (e.names ?? []).some((n) => names.has(n))).reduce((n, e) => n + (e.length ?? 0), 0);
          if (!novos.length || lenAll < 0.3 || lenSame < 0.6 * lenAll) continue;
          const l = shapeOf(t, sub.edges);
          if (await validLine(l)) { out.push({ line: l, dir }); sub.edges.forEach((e) => e.way_id != null && seen.add(e.way_id)); }
        }
      }
    }
  }
  return out;
}

const RUIM = new Set(['residential', 'service_other']);
const kmOf = (es: TraceEdge[]) => es.reduce((n, e) => n + (e.length ?? 0), 0);

/** corridas boas: sem as arestas parciais das pontas e com no máx. 50% em rua residencial/serviço (casou fora da BR) */
function goodRuns(t: Trace): TraceEdge[][] {
  return runs(t).map(trimRun).filter((r) => {
    const total = kmOf(r);
    return total >= 0.03 && kmOf(r.filter((e) => RUIM.has(e.road_class ?? ''))) <= 0.5 * total;
  });
}

/** sub-trechos a usar: em via predominantemente de mão dupla, ignora pedaços curtos de mão única (alças) */
function keptSubs(run: TraceEdge[]) {
  const subs = byTraversability(run);
  const total = kmOf(run) || 1;
  const mostlyTwoWay = subs.filter((x) => x.twoWay).reduce((n, x) => n + kmOf(x.edges), 0) >= 0.8 * total;
  return subs.filter((x) => x.twoWay || !mostlyTwoWay || kmOf(x.edges) >= 0.5);
}

/**
 * Segmento inteiro: mão dupla -> as duas metades dirigidas; mão única (pista dupla) -> a pista casada no sentido do
 * km ('crescente') e a outra pista, casada com a geometria invertida ('decrescente'), mais as pistas paralelas do
 * mesmo sentido (expressa/local). O casamento invertido também cobre o caso em que o eixo do SNV está desenhado sobre
 * uma pista de mão única no sentido contrário (ex.: Ponte General Dutra, Campos/RJ).
 */
async function matchSegment(geometry: GeoJSON.Geometry): Promise<MatchResult> {
  const out = new Lines();
  let matchedM = 0;
  for (const part of partsOf(geometry)) {
    const dense = densify(part, 80);
    for (let i = 0; i < dense.length - 1; i += 1500) {
      const chunk = dense.slice(i, i + 1501);
      const chunkKm = lineLenM(chunk) / 1000;
      const tf = await trace(chunk);
      const covered = new Set<number>();
      const oneWayDirs = new Set<Dir>();
      let fwdKm = 0;
      for (const run of tf ? goodRuns(tf) : []) {
        fwdKm += kmOf(run);
        for (const sub of keptSubs(run)) {
          const l = shapeOf(tf!, sub.edges);
          const ok = sub.twoWay ? await out.twoWay(l, 'crescente') : await out.oneWay(l, 'crescente');
          if (!ok) continue;
          if (sub.twoWay) sub.edges.forEach((e) => e.way_id != null && covered.add(e.way_id)); else oneWayDirs.add('crescente');
          matchedM += lineLenM(l);
        }
      }
      let tr: Trace | null = null;
      const fwdFalhou = fwdKm < 0.5 * chunkKm;
      if (oneWayDirs.size || fwdFalhou) {
        tr = await trace([...chunk].reverse());
        for (const run of tr ? goodRuns(tr) : []) {
          for (const sub of keptSubs(run)) {
            const l = shapeOf(tr!, sub.edges);
            if (!sub.twoWay) {
              if (await out.oneWay(l, 'decrescente')) { oneWayDirs.add('decrescente'); if (fwdFalhou) matchedM += lineLenM(l); }
            } else if (fwdFalhou) {
              const novo = kmOf(sub.edges.filter((e) => e.way_id == null || !covered.has(e.way_id)));
              if (novo >= 0.5 * kmOf(sub.edges) && (await out.twoWay(l, 'decrescente'))) matchedM += lineLenM(l);
            }
          }
        }
      }
      if (tf && oneWayDirs.size) {
        for (const par of await parallelLanes(chunk, tf, tr, [...oneWayDirs])) out.add(par.line, par.dir);
      }
    }
  }
  return { ok: out.lines.length > 0, lines: out.lines, dirs: out.dirs, info: { modo: 'segmento', pontos: out.pts, casado_km: Math.round(matchedM / 100) / 10 } };
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

function nearestGroup(t: Trace, focus: LonLat, maxM: number): TraceEdge[] | null {
  let best: TraceEdge[] | null = null, bd = Infinity;
  for (const g of bridgeGroups(t)) {
    const sh = shapeOf(t, g);
    const d = Math.min(...sh.map((c, i) => (i < sh.length - 1 ? segDistM(focus, c, sh[i + 1]) : distM(focus, c))));
    if (d < bd) { bd = d; best = g; }
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
  let tf = await trace(input);
  let g = tf ? nearestGroup(tf, focus, 250) : null;
  let inv = false;
  if (!g) {
    // eixo do SNV desenhado contra a mão de uma ponte de mão única: casa invertido
    tf = await trace([...input].reverse());
    g = tf ? nearestGroup(tf, focus, 250) : null;
    inv = true;
  }
  if (!tf || !g) return null;
  const got = await directional(tf, g, inv ? 'decrescente' : 'crescente', async () => {
    const tr = await trace(inv ? input : [...input].reverse());
    const rg = tr ? nearestGroup(tr, focus, 250) : null;
    return tr && rg ? { t: tr, edges: rg } : null;
  });
  if (!got.lines.length) return null;
  return { ok: true, lines: got.lines, dirs: got.dirs, info: { modo: 'ponte', pontos: got.pts, ponte_m: Math.round(lineLenM(shapeOf(tf, g))) } };
}

const memCache = new Map<string, Promise<MatchResult>>();

interface MatchReq { key: string; mode: 'segmento' | 'ponte'; geometry: GeoJSON.Geometry; focus?: LonLat }

function geomHash(r: MatchReq): string {
  return createHash('md5').update(JSON.stringify([MATCH_VERSION, r.geometry, r.focus ?? null])).digest('hex');
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
      if (hit && hit.geom_hash === gh && Array.isArray(hit.info?.dirs)) {
        return { ok: hit.ok, lines: hit.lines ?? [], dirs: hit.info!.dirs as Dir[], info: hit.info ?? {} };
      }
      const m = await computeMatch(r);
      await query(
        `insert into siaet_osm_match (feature_key, mode, tileset, geom_hash, ok, lines, info) values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (feature_key, mode, tileset) do update set geom_hash = excluded.geom_hash, ok = excluded.ok, lines = excluded.lines,
           info = excluded.info, created_at = now()`,
        [r.key, r.mode, tileset, gh, m.ok, JSON.stringify(m.lines), JSON.stringify({ ...m.info, dirs: m.dirs })],
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
  /** violações que bloqueiam: união dos sentidos, e por sentido (pista 1 = crescente, pista 2 = decrescente) */
  viols: Violation[];
  byDir: { crescente: Violation[]; decrescente: Violation[] };
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

interface Applied { cand: Candidate; lines: { line: LonLat[]; dir: Dir }[]; bridge: boolean }
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
    const c = siaetCandidate(row, v);
    if (c) out.push({ ...c, prio: prioOf(ctx, row.geometry) });
  }
  return out;
}

/** Restrição de uma linha do SIAET para o veículo (null = não barra). Mesma escolha de modo no costLines e no aquecimento. */
function siaetCandidate(row: Row, v: Vehicle): Omit<Candidate, 'prio'> | null {
  const p = row.props as SiaetProps;
  const block = (x: Violation[]) => x.filter((y) => y.bloqueia);
  // pista 2 publicada: cada sentido com seus limites; senão os da pista 1 valem para os dois
  const temP2 = !!p.pista2 && DIMS.some((d) => p.pista2![PROP[d]] != null);
  const v1 = p.pista1 ? block(violations(pistaProps(p.pista1, p), v)) : block(violations(p, v));
  const v2 = temP2 ? block(violations(pistaProps(p.pista2!, p), v)) : v1;
  const viols = mergeViols(v1, v2);
  if (!viols.length) return null;
  // só PBT (limite ou interdição) e um único OAE no segmento: a restrição é da ponte
  const onlyWeight = viols.every((x) => x.dim === 'peso' && !x.aet);
  const ponte = onlyWeight && p.oae_unica ? p.oae_unica : null;
  const label = `${row.name ?? `BR-${p.br}/${p.uf}`}${ponte ? ` — ${ponte.nome ?? 'ponte'}` : ''}`;
  const desc = describeViolations(viols);
  return {
    row, itemId: `siaet:${row.source_id}`, viols, byDir: { crescente: v1, decrescente: v2 }, mode: ponte ? 'ponte' : 'segmento',
    focus: ponte ? [ponte.lon, ponte.lat] : undefined, label, desc,
    rule: `${desc} — SIAET/DNIT ${p.tipo === 'temporaria' ? 'temporária' : 'definitiva'} ${p.ref_mes}`,
    valueNum: viols.find((x) => x.dim === 'peso')?.limite ?? viols[0].limite,
  };
}

/** BRs coincidentes (ex.: BR-101 e BR-356 na mesma ponte) viram um candidato só: um aviso e uma linha por trecho */
function mergeCoincident(cs: Candidate[]): Candidate[] {
  const by = new Map<string, Candidate>();
  for (const c of cs) {
    const k = createHash('md5').update(JSON.stringify([c.row.geometry, c.mode, c.focus ?? null])).digest('hex');
    const o = by.get(k);
    if (!o) { by.set(k, { ...c }); continue; }
    const viols = mergeViols(o.viols, c.viols);
    by.set(k, {
      ...o, viols, byDir: { crescente: mergeViols(o.byDir.crescente, c.byDir.crescente), decrescente: mergeViols(o.byDir.decrescente, c.byDir.decrescente) },
      label: o.label.includes(c.row.name ?? '§') ? o.label : `${o.label} / ${c.row.name}`,
      desc: describeViolations(viols), rule: o.rule.replace(o.desc, describeViolations(viols)),
    });
  }
  return [...by.values()];
}

/** união por grandeza, ficando com a mais restritiva: interdição > 0 de AET > menor limite */
function mergeViols(a: Violation[], b: Violation[]): Violation[] {
  const rank = (x: Violation) => (x.interdicao ? 2 : x.aet ? 1 : 0);
  const m = new Map<Dim, Violation>();
  for (const x of [...a, ...b]) {
    const o = m.get(x.dim);
    if (!o || rank(x) > rank(o) || (rank(x) === rank(o) && x.limite < o.limite)) m.set(x.dim, x);
  }
  return DIMS.filter((d) => m.has(d)).map((d) => m.get(d)!);
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
    if (row.acao === 'interdicao') viols = [{ dim: 'peso', limite: 0, valor: v.weight_t, aet: false, interdicao: true, bloqueia: true, motivo: 'interdicao' }];
    else if (row.acao === 'limite_peso' && row.peso_max_t != null && v.weight_t > row.peso_max_t) viols = [{ dim: 'peso', limite: row.peso_max_t, valor: v.weight_t, aet: false, bloqueia: true }];
    if (!viols.length) continue;
    const ponto = row.props?.ponto as LonLat | undefined;
    const regra = row.acao === 'interdicao' ? 'ponte interditada' : describeViolations(viols);
    out.push({
      row, itemId: `alerta:${row.source_id}`, viols, byDir: { crescente: viols, decrescente: viols }, mode: ponto && row.geometry.type !== 'Point' ? 'ponte' : 'segmento', focus: ponto,
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

function centerOf(l: LonLat[] | undefined, fallback: GeoJSON.Geometry): LonLat {
  if (l && l.length >= 2) {
    try { return turf.along(turf.lineString(l), turf.length(turf.lineString(l)) / 2).geometry.coordinates as LonLat; } catch { /* segue */ }
  }
  return turf.centroid(turf.feature(fallback)).geometry.coordinates as LonLat;
}

// ------------------------------------------------------------------------------------------------ aquecimento

let warmStarted = false;
/**
 * Casa em segundo plano os trechos que barram os perfis que rodam SEM AET (config/vehicle-presets.json), no mesmo modo
 * (segmento/ponte) que o costLines escolheria para cada perfil: o 1º cálculo de rota não paga a conta.
 */
function warmUp() {
  if (warmStarted || process.env.FEDERAL_RESTRICOES_WARMUP === '0') return;
  warmStarted = true;
  setTimeout(async () => {
    try {
      const ts = await tilesetVersion();
      if (!ts) return;
      const perfis = vehiclePresets.presets.map((p) => resolveVehicle({ preset: p.id } as Parameters<typeof resolveVehicle>[0])).filter((v) => !v.requires_aet);
      if (!perfis.length) return;
      const max = (f: (v: Vehicle) => number) => Math.max(...perfis.map(f));
      const r = await query<Row>(
        `select ${SIAET_COLS} from data_features where layer_id = 'federal_restricoes' and source = 'siaet'
           and ((props->>'peso_t')::float < $1 or (props->>'altura_m')::float < $2 or (props->>'largura_m')::float < $3
                or (props->>'comprimento_m')::float < $4 or props->'aet_bloqueada' ? 'peso')`,
        [max((v) => v.weight_t), max((v) => v.height_m), max((v) => v.width_m), max((v) => v.length_m)],
      );
      for (const row of r.rows) {
        const reqs = new Map<string, MatchReq>();
        for (const v of perfis) {
          const c = siaetCandidate(row, v);
          if (c) reqs.set(c.mode, { key: `federal_restricoes:siaet:${row.source_id}`, mode: c.mode, geometry: row.geometry, focus: c.focus });
        }
        for (const req of reqs.values()) await matchLines(req, ts).catch(() => null);
      }
    } catch { /* banco/valhalla indisponível: costLines casa sob demanda */ }
  }, 8000).unref?.();
}

// ------------------------------------------------------------------------------------------------ camada

const DEBUG = process.env.FEDERAL_RESTRICOES_DEBUG === '1';
export function dbg(label: string, t0: number) { if (DEBUG) console.error(`[federal_restricoes] ${label}: ${Date.now() - t0} ms`); }

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
            'PBT máx.': lim(p.peso_t, 't'), 'Altura máx.': lim(p.altura_m, 'm'), 'Largura máx.': lim(p.largura_m, 'm'),
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
    const t0 = Date.now();
    warmUp();
    const memo: Memo = { lines: [], byItem: new Map(), pendentes: 0, sem_casamento: [] };
    memos.set(ctx, memo);
    const cands = mergeCoincident([...(await siaetCandidates(ctx)), ...(await alertCandidates(ctx))]).sort((a, b) => a.prio - b.prio);
    if (!cands.length) return [];
    const ts = await tilesetVersion();
    if (!ts) { memo.sem_casamento.push(...cands); return []; }
    dbg(`candidatos (${cands.length})`, t0);
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
    dbg('casamento', t0);
    let budget = EDGE_BUDGET;
    for (const { c, res } of results) {
      if (res === 'timeout') { memo.pendentes++; memo.sem_casamento.push(c); continue; }
      if (!res || !res.ok || !res.lines.length) { memo.sem_casamento.push(c); continue; }
      const n = res.lines.reduce((s, l) => s + l.length, 0);
      if (n > budget) { memo.sem_casamento.push(c); continue; }
      budget -= n;
      const isBridge = res.info?.modo === 'ponte';
      // o nome só leva o sentido quando os dois sentidos têm restrições diferentes (pista 2 publicada)
      const porSentido = describeViolations(c.byDir.crescente) !== describeViolations(c.byDir.decrescente);
      const applied: { line: LonLat[]; dir: Dir }[] = [];
      res.lines.forEach((l, k) => {
        const dir = res.dirs[k];
        const vs = dir ? c.byDir[dir] : c.viols;
        if (!vs.length) return; // este sentido não tem restrição para o veículo
        applied.push({ line: l, dir });
        const [lon, lat] = centerOf(l, c.row.geometry);
        const sentido = porSentido ? (dir === 'crescente' ? ' (sentido crescente do km)' : ' (sentido decrescente do km)') : '';
        const desc = describeViolations(vs);
        const item: LayerItem = {
          kind: 'layer', layer: 'federal_restricoes', id: c.itemId, name: `${isBridge || c.mode === 'segmento' ? c.label : `${c.row.name}`}${sentido}`,
          type: c.row.source === 'siaet' ? `siaet_${c.row.kind}` : 'alerta_dnit',
          rule: c.rule.replace(c.desc, desc), value_num: c.valueNum, lat, lon,
          note: isBridge ? 'Aplicado só na ponte (único OAE do segmento).' : c.row.props?.geom_aprox ? 'Geometria do trecho aproximada.' : null,
        };
        memo.lines.push({ item, coordinates: l, factor: factorFor(lineLenM(l)) });
      });
      if (applied.length) memo.byItem.set(c.itemId, { cand: c, lines: applied, bridge: isBridge });
    }
    return memo.lines;
  },

  async annotate(ctx, route) {
    const t0 = Date.now();
    const memo = memos.get(ctx);
    const v = ctx.vehicle;
    const coords = route.line.geometry.coordinates as LonLat[];
    const idx = new RouteIndex(coords);
    const rows = await nearRoute(route.line.geometry, 'federal_restricoes', `f.source = 'siaet'`, 0.0005, 800);
    dbg(`annotate: ${rows.length} feições perto`, t0);
    const warnings: LayerWarning[] = [];
    const onRoute: { row: typeof rows[number]; p: SiaetProps; lim: LimitProps; sentidos: Dir[]; usedKm: number; viols: Violation[] }[] = [];
    for (const row of rows) {
      const p = row.props as unknown as SiaetProps;
      let total = 0, cresc = 0, decr = 0;
      for (const part of partsOf(row.geometry)) {
        total += lineLenM(part);
        const u = idx.usedByDirM(part, 45); // a geometria do SNV segue o km crescente
        cresc += u.mesmo; decr += u.contrario;
      }
      const used = cresc + decr;
      if (used < Math.min(400, 0.5 * total)) continue;
      const sentidos = new Set<Dir>();
      if (cresc >= 0.2 * used) sentidos.add('crescente');
      if (decr >= 0.2 * used) sentidos.add('decrescente');
      const lim = limitsFor(p, sentidos);
      onRoute.push({ row, p, lim, sentidos: [...sentidos], usedKm: used / 1000, viols: violations(lim, v) });
    }

    dbg('annotate: na rota', t0);
    // a rota usa uma linha penalizada NO SENTIDO dela: ponte = ≥50% da linha; segmento = ≥400 m ou ≥50%
    const usesLines = (ri: RouteIndex, a: Applied) => a.lines.some(({ line }) => {
      const len = lineLenM(line);
      const need = a.bridge ? 0.5 * len : Math.min(400, 0.5 * len);
      return ri.usedLengthM(line, 15, true) >= Math.max(need, 15);
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
      if (!a.lines.some(({ line }) => routingUses(idx, line))) {
        warnings.push({
          code: 'siaet_restricao_na_rota', severity: 'danger', id, lat: a.cand.row.props?.oae_unica?.lat, lon: a.cand.row.props?.oae_unica?.lon,
          message: `A rota passa por ${a.cand.label}, onde ${a.cand.desc} (${a.cand.row.source === 'siaet' ? 'SIAET/DNIT' : 'alerta do DNIT revisado'}). Sem desvio razoável encontrado: confira a sinalização e a AET antes de seguir.`,
        });
      }
    }

    // linhas definitiva/temporária do mesmo PNV e BRs coincidentes têm a mesma geometria: um aviso por (trecho, tipo)
    const grupos = new Map<string, typeof onRoute>();
    for (const o of onRoute) {
      const k = JSON.stringify(o.row.geometry);
      grupos.set(k, [...(grupos.get(k) ?? []), o]);
    }
    const ja = new Set<string>();
    const folgas = new Map<string, string[]>();
    const push = (gk: string, w: LayerWarning) => {
      const k = `${gk}|${w.code}`;
      if (ja.has(k)) return;
      ja.add(k);
      warnings.push(w);
    };
    for (const [gk, grupo] of grupos) {
      const nomes = [...new Set(grupo.map((o) => o.row.name ?? ''))].join(' / ');
      const ids = grupo.map((o) => `siaet:${o.row.source_id}`);
      const aplicada = ids.some((id) => memo?.byItem.has(id) || violadas.has(id)) || [...(memo?.byItem.values() ?? [])].some((a) => JSON.stringify(a.cand.row.geometry) === gk);
      for (const o of grupo) {
        const itemId = `siaet:${o.row.source_id}`;
        for (const x of o.viols.filter((y) => !y.bloqueia)) {
          push(gk, x.motivo === 'definitiva_comprimento'
            ? { code: 'siaet_restricao_geometrica', severity: 'warn', id: itemId,
                message: `${nomes}: o SIAET registra comprimento máx. ${fmtNum(x.limite)} m (restrição definitiva, cadastrada para AET); veículo de ${fmtNum(x.valor)} m. Confira a placa R-18 e as curvas do trecho antes de seguir.` }
            : { code: 'siaet_aet_outro_orgao', severity: 'warn', id: itemId,
                message: `${nomes}: trecho fora da jurisdição federal (${o.p.administracao ?? 'não federal'}); o DNIT não emite AET aqui. Peça a autorização ao órgão com circunscrição sobre a via.` });
        }
        const bloq = o.viols.filter((y) => y.bloqueia);
        if (bloq.length) {
          // viola mas não virou linha penalizada (fora do mapa carregado, casamento falhou ou ainda pendente)
          if (!aplicada) {
            push(gk, {
              code: 'siaet_restricao_na_rota', severity: 'danger', id: itemId,
              message: `A rota usa ${nomes} (${o.usedKm.toFixed(1).replace('.', ',')} km), onde o SIAET/DNIT registra ${describeViolations(bloq)}. A restrição não pôde ser aplicada no cálculo: confira a sinalização e a AET antes de seguir.`,
            });
          }
          continue;
        }
        const zeros = (o.lim.aet_bloqueada ?? []).filter((z) => !aetDims(v).has(z) && !o.viols.some((y) => y.dim === z));
        if (zeros.length && !o.viols.some((y) => y.motivo === 'aet_fora_jurisdicao')) {
          push(gk, {
            code: 'siaet_aet_bloqueada', severity: 'info', id: itemId,
            message: naoFederal(o.p.administracao)
              ? `${nomes}: o SIAET marca 0 (${zeros.join(', ')}) neste trecho de jurisdição ${o.p.administracao?.toLowerCase() ?? 'não federal'}; não vale como limite para veículo sem AET.`
              : `${nomes}: o SIAET não autoriza AET por excesso de ${zeros.join(', ')} neste trecho (valor 0). Sem efeito para veículo dentro dos limites legais; pode indicar obra ou estreitamento: confira a sinalização.`,
          });
        }
        const folga: string[] = [];
        for (const d of DIMS) {
          const lim = o.lim[PROP[d]];
          const val = vehicleValue(v, d);
          if (lim != null && lim > 0 && val <= lim && lim - val < (d === 'peso' ? 0.5 : 0.05)) folga.push(`${LABEL[d]} ${fmtNum(lim)} ${UNIT[d]}`);
        }
        for (const f of folga) folgas.set(f, [...new Set([...(folgas.get(f) ?? []), nomes])]);
      }
    }

    for (const [lim, trechos] of folgas) {
      warnings.push({
        code: 'siaet_folga_minima', severity: 'info',
        message: `Veículo no limite do SIAET (${lim}) em ${trechos.length} trecho(s): ${trechos.slice(0, 3).join('; ')}${trechos.length > 3 ? ` e mais ${trechos.length - 3}` : ''}. Sem margem para carga mais alta ou mais pesada.`,
      });
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

    dbg('annotate: avisos', t0);
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
      summary.push(`${grupos.size} trecho(s) federal(is) da rota com restrição cadastrada no SIAET/DNIT (ref. ${refs.join(', ')}).`);
      const mins: string[] = [];
      for (const d of DIMS) {
        const vals = onRoute.map((o) => ({ v: o.lim[PROP[d]], n: o.row.name })).filter((x) => x.v != null && x.v > 0) as { v: number; n: string }[];
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
          altura_m: o.lim.altura_m, largura_m: o.lim.largura_m, peso_t: o.lim.peso_t, comprimento_m: o.lim.comprimento_m, aet_bloqueada: o.lim.aet_bloqueada,
          sentidos: o.sentidos, interditado: o.viols.some((x) => x.interdicao),
          km_na_rota: Math.round(o.usedKm * 10) / 10, viola: o.viols.filter((x) => x.bloqueia).map((x) => x.dim),
          atencao: o.viols.filter((x) => !x.bloqueia).map((x) => x.dim), geom_aprox: o.p.geom_aprox,
        })),
        evitados,
      },
    };
  },
};

export default layer;
