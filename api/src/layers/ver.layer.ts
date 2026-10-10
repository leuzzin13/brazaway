import { DateTime } from 'luxon';
import { env } from '../config.js';
import { query } from '../db.js';
import { legalDayInfo, type LegalDayInfo } from '../services/calendar.js';
import { blockingReports, reportToRing } from '../services/restrictions.js';
import * as valhalla from '../services/valhalla.js';
import type { Ring } from '../services/valhalla.js';
import type { Vehicle } from '../services/vehicle.js';
import { activeZones, pointInZone, zoneApplies, zoneRings } from '../services/zones.js';
import { featuresInBbox } from './data.js';
import type { LayerCostLine, LayerItem, LayerWarning, RouteCtx, RouteGeom, RouteLayer } from './types.js';

/**
 * VER — Vias Estruturais Restritas da cidade de São Paulo.
 *
 * Regras: Portaria SMT.GAB 137/2018, art. 2º, §§ 1º a 4º (texto compilado), com as exceções do Capítulo III que dá para
 * modelar com o perfil do veículo (VUC com AETC — art. 18; perecíveis — art. 32; concretagem — arts. 27/28; mudança —
 * art. 30). O § 5º (Portaria SMT.GAB 49/2021: Marginal Tietê proibida em qualquer horário) ainda NÃO está em vigor
 * (art. 3º: só com a liberação do Rodoanel Norte); com VER_PORTARIA_49_VIGENTE=1 ele passa a valer e os incisos I a IV
 * do § 4º deixam de valer (art. 2º da Portaria 49/2021).
 *
 * Geometria: cadeias DIRIGIDAS (sentido de circulação proibido) casadas com ways do OSM pelo importador
 * importers/sources/ver_portaria137.py. Na rota: cada cadeia vira um linear_cost_factor (factor 1000) quando a janela vale
 * para o veículo no horário de SAÍDA; depois, annotate() calcula o horário estimado de passagem em cada VER usada (pela
 * posição na rota) e avisa (danger) se a rota ainda usa uma VER proibida naquele horário.
 */

export const PORTARIA_49_VIGENTE = process.env.VER_PORTARIA_49_VIGENTE === '1';
/**
 * Última conferência do gatilho da Portaria 49/2021 (art. 3º: "conclusão das obras do trecho norte do Rodoanel e sua
 * liberação"). Em 09/10/2026: trecho 1 (Dutra–Fernão Dias, km 129–153) liberado em 23/12/2025 — abertura parcial, NÃO
 * dispara o art. 3º; trecho 2 (Fernão Dias–Av. Raimundo Pereira de Magalhães) previsto para o 2º semestre de 2026 e ainda
 * sem liberação. Ao reconferir, atualizar esta data e docs/layers/ver.md.
 */
export const P49_CONFERIDA_EM = '09/10/2026';
const P49_SITUACAO = `situação conferida em ${P49_CONFERIDA_EM}: trecho 1 do Rodoanel Norte (Dutra–Fernão Dias) liberado em 23/12/2025; `
  + 'trecho 2 (Fernão Dias–Av. Raimundo Pereira de Magalhães) previsto para o 2º semestre de 2026';
const DEBUG = process.env.VER_DEBUG === '1';
const FACTOR = 1000;
/** Até este número de cadeias candidatas, todas vão para a rota sem pré-seleção. */
const MAX_DIRETO = 12;
/** Fallback da pré-seleção (se não convergir): cadeias a até este raio (m) da última rota de referência. */
const RAIO_SELECAO_M = 800;
const MAX_ITER = 6;
const AMBOS = 'ambos os sentidos';
const COR: Record<number, string> = { 1: '#dc2626', 2: '#ea580c', 3: '#d97706', 4: '#7c3aed', 5: '#64748b' };
const PAR_TXT: Record<number, string> = { 1: '§ 1º', 2: '§ 2º', 3: '§ 3º', 4: '§ 4º', 5: '§ 5º' };

export interface Janela { days: number[]; from: string; to: string }
export type Janelas = Janela[] | 'integral';
export interface Excecao { codigo: string; artigo: string; janelas: Janelas; texto: string; proibido_com_aetc?: Janela[] }
export interface VerProps {
  paragrafo: number;
  inciso: string;
  texto_legal: string;
  norma: string;
  janelas: Janelas;
  horario: string;
  exceto_feriados: boolean;
  excecoes: Excecao[];
  vuc: string;
  ativo: boolean;
  vigencia: string;
  revogado_quando_s5_vigorar?: boolean;
  sentido?: string | null;
  extensao_km?: number;
  conferencia_cet_pct?: number | null;
  nota?: string | null;
  [k: string]: unknown;
}
type Coord = [number, number];
type BBox = [number, number, number, number];
interface Trecho { id: string; name: string; props: VerProps; chains: Coord[][]; bbox: BBox }

// ------------------------------------------------------------------------------------------------ regras
/** A regra do inciso está em vigor (considerando a Portaria 49/2021)? */
export function vigente(p: Pick<VerProps, 'paragrafo' | 'ativo' | 'revogado_quando_s5_vigorar'>, p49 = PORTARIA_49_VIGENTE): boolean {
  if (p.paragrafo === 5) return p49;
  if (p.revogado_quando_s5_vigorar && p49) return false;
  return p.ativo !== false;
}

export function emJanela(j: Janelas | undefined, local: DateTime): boolean {
  if (!j) return false;
  if (j === 'integral') return true;
  const dow = local.weekday;
  const hhmm = local.toFormat('HH:mm');
  return j.some((w) => w.days.includes(dow) && hhmm >= w.from && hhmm < w.to);
}

/** Minutos até a borda mais próxima (início/fim) de uma janela no mesmo dia; Infinity se não houver janela no dia. */
function minutosDaBorda(j: Janelas, local: DateTime): number {
  if (j === 'integral') return Infinity;
  const m = local.hour * 60 + local.minute;
  let best = Infinity;
  for (const w of j) {
    if (!w.days.includes(local.weekday)) continue;
    for (const t of [w.from, w.to]) {
      const [h, mm] = t.split(':').map(Number);
      best = Math.min(best, Math.abs(h * 60 + mm - m));
    }
  }
  return best;
}

export interface Decisao {
  proibido: boolean;
  codigo: 'nao_caminhao' | 'feriado' | 'suspensao' | 'fora_horario' | 'excecao' | 'proibido';
  motivo: string;
  excecao?: Excecao;
}

function excecaoVale(e: Excecao, v: Vehicle, local: DateTime): boolean {
  switch (e.codigo) {
    case 'vuc_aetc': return !!v.is_vuc && !!v.has_aetc && emJanela(e.janelas, local);
    case 'perecivel_aetc': return v.cargo_type === 'perishable' && !!v.has_aetc && emJanela(e.janelas, local);
    case 'concreto_aetc': return v.cargo_type === 'concrete' && !!v.has_aetc && emJanela(e.janelas, local);
    case 'mudanca_aetc': return v.cargo_type === 'moving' && !!v.has_aetc && emJanela(e.janelas, local);
    case 'od_municipio': // Portaria 49/2021, art. 38-A e parágrafo único
      if (!v.cargo_od_in_city) return false;
      return !(v.has_aetc && e.proibido_com_aetc && emJanela(e.proibido_com_aetc, local));
    default: return false;
  }
}

/** A VER proíbe este veículo neste instante (hora local)? */
export function decide(p: VerProps, v: Vehicle, local: DateTime, day: Partial<Pick<LegalDayInfo, 'holiday' | 'suspensions'>> = {}): Decisao {
  if (v.weight_t <= 3.5) return { proibido: false, codigo: 'nao_caminhao', motivo: 'PBT até 3,5 t não é caminhão (CTB, Anexo I)' };
  if (p.exceto_feriados !== false && day.holiday) return { proibido: false, codigo: 'feriado', motivo: `feriado (${day.holiday.name})` };
  if (day.suspensions?.some((s) => (s.scope === 'ver' || s.scope === 'all') && !s.applies_to_heavy)) {
    return { proibido: false, codigo: 'suspensao', motivo: 'restrição suspensa pela CET' };
  }
  if (!emJanela(p.janelas, local)) return { proibido: false, codigo: 'fora_horario', motivo: `fora do horário (${p.horario})` };
  for (const e of p.excecoes ?? []) {
    if (excecaoVale(e, v, local)) return { proibido: false, codigo: 'excecao', motivo: e.texto, excecao: e };
  }
  return { proibido: true, codigo: 'proibido', motivo: p.horario };
}

// ------------------------------------------------------------------------------------------------ dados
let cache: { at: number; data: Promise<Trecho[]> } | null = null;
const CACHE_MS = 5 * 60_000;

function bboxOf(chains: Coord[][]): BBox {
  const b: BBox = [Infinity, Infinity, -Infinity, -Infinity];
  for (const c of chains) for (const [x, y] of c) {
    if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
  }
  return b;
}
const intersects = (a: BBox, b: BBox) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

async function loadTrechos(): Promise<Trecho[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const data = (async () => {
    const r = await query<{ id: string; name: string; props: VerProps; geometry: GeoJSON.MultiLineString | GeoJSON.LineString }>(
      `select id::text, name, props, ST_AsGeoJSON(geom, 7)::json as geometry
         from data_features where layer_id = 'ver' and (valid_to is null or valid_to > now()) order by source_id`);
    return r.rows.map((row) => {
      const chains = (row.geometry.type === 'LineString' ? [row.geometry.coordinates] : row.geometry.coordinates) as Coord[][];
      return { id: row.id, name: row.name, props: row.props, chains, bbox: bboxOf(chains) };
    });
  })();
  cache = { at: Date.now(), data };
  data.catch(() => { cache = null; });
  return data;
}

// ------------------------------------------------------------------------------------------------ checagem no Valhalla
// linear_cost_factors faz "edge walk": uma linha que não casa com o grafo derruba a requisição inteira (erro 233).
// O importador já testa e conserta as cadeias; aqui testamos de novo (1 requisição com todas, busca binária se falhar),
// uma vez por versão dos tiles, e deixamos de fora as que falharem.
let walkCache: { key: string; bad: Promise<Set<string>> } | null = null;
let statusCache: { at: number; key: Promise<string | null> } | null = null;

async function tilesetKey(): Promise<string | null> {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.key;
  const key = fetch(`${env.valhallaUrl}/status`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json() as Promise<{ tileset_last_modified?: number; version?: string }>)
    .then((j) => `${j.version ?? ''}:${j.tileset_last_modified ?? ''}`)
    .catch(() => null);
  statusCache = { at: Date.now(), key };
  return key;
}

async function walkOk(lines: Coord[][]): Promise<boolean | null> {
  const body = {
    locations: [{ lat: -23.5505, lon: -46.634 }, { lat: -23.5614, lon: -46.6559 }],
    costing: 'truck',
    directions_type: 'none',
    linear_cost_factors: lines.map((c) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: { factor: 1 } })),
  };
  try {
    const res = await fetch(`${env.valhallaUrl}/route`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return true;
    const j = (await res.json().catch(() => ({}))) as { error_code?: number };
    return j.error_code === 233 ? false : true;
  } catch {
    return null;
  }
}

async function findBad(lines: Coord[][], idx: number[]): Promise<number[]> {
  const ok = await walkOk(idx.map((i) => lines[i]));
  if (ok !== false) return [];
  if (idx.length === 1) return idx;
  const mid = Math.floor(idx.length / 2);
  return [...(await findBad(lines, idx.slice(0, mid))), ...(await findBad(lines, idx.slice(mid)))];
}

async function badChains(trechos: Trecho[]): Promise<Set<string>> {
  const tk = await tilesetKey();
  if (!tk) return new Set(); // Valhalla sem /status: confia na checagem do importador
  const keys: string[] = [];
  const lines: Coord[][] = [];
  for (const t of trechos) t.chains.forEach((c, k) => { keys.push(`${t.id}:${k}`); lines.push(c); });
  const key = `${tk}|${keys.length}|${keys[0] ?? ''}|${keys[keys.length - 1] ?? ''}`;
  if (walkCache?.key === key) return walkCache.bad;
  const bad = findBad(lines, lines.map((_, i) => i)).then((ix) => {
    if (ix.length) console.warn(`[ver] ${ix.length} cadeia(s) não casam com os tiles do Valhalla e ficam fora: ${ix.map((i) => keys[i]).join(', ')}`);
    return new Set(ix.map((i) => keys[i]));
  });
  walkCache = { key, bad };
  bad.catch(() => { walkCache = null; });
  return bad;
}

// ------------------------------------------------------------------------------------------------ geometria da rota
const KX = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);
const KY = 110540;
function bearingDeg(a: Coord, b: Coord): number {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return ((Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
}
const angDiff = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** Índice em grade dos segmentos da rota: ponto → segmento mais próximo (distância, km ao longo, rumo).
 *  `cell` em graus deve ser >= o raio de busca (a consulta olha só as 3x3 células vizinhas). */
class RouteIndex {
  private grid = new Map<string, number[]>();
  private cum: number[] = [0];
  constructor(private coords: Coord[], private readonly cell = 0.001) {
    for (let i = 0; i < coords.length - 1; i++) {
      const [a, b] = [coords[i], coords[i + 1]];
      this.cum.push(this.cum[i] + Math.hypot((b[0] - a[0]) * KX(a[1]), (b[1] - a[1]) * KY) / 1000);
      const x0 = Math.floor(Math.min(a[0], b[0]) / this.cell), x1 = Math.floor(Math.max(a[0], b[0]) / this.cell);
      const y0 = Math.floor(Math.min(a[1], b[1]) / this.cell), y1 = Math.floor(Math.max(a[1], b[1]) / this.cell);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const l = this.grid.get(k);
        if (l) l.push(i); else this.grid.set(k, [i]);
      }
    }
  }
  get totalKm() { return this.cum[this.cum.length - 1]; }
  nearest(p: Coord, maxM: number): { distM: number; km: number; bearing: number } | null {
    const cx = Math.floor(p[0] / this.cell), cy = Math.floor(p[1] / this.cell);
    const kx = KX(p[1]);
    let best: { distM: number; km: number; bearing: number } | null = null;
    const seen = new Set<number>();
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const i of this.grid.get(`${cx + dx},${cy + dy}`) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const a = this.coords[i], b = this.coords[i + 1];
        const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * KY, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * KY;
        const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
        const u = L2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2));
        const d = Math.hypot(ax + u * vx, ay + u * vy);
        if (d <= maxM && (!best || d < best.distM)) {
          best = { distM: d, km: this.cum[i] + (u * Math.sqrt(L2)) / 1000, bearing: bearingDeg(a, b) };
        }
      }
    }
    return best;
  }
}

/** A rota percorre a cadeia NO SENTIDO dela? Amostra a cada ~20 m; devolve metros percorridos e km (na rota) da entrada. */
function usage(idx: RouteIndex, chain: Coord[]): { metros: number; km: number } | null {
  let metros = 0;
  let km = Infinity;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i], b = chain[i + 1];
    const segM = Math.hypot((b[0] - a[0]) * KX(a[1]), (b[1] - a[1]) * KY);
    if (segM < 0.5) continue;
    const br = bearingDeg(a, b);
    const n = Math.max(1, Math.ceil(segM / 20));
    for (let s = 0; s < n; s++) {
      const f = (s + 0.5) / n;
      const p: Coord = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      const nr = idx.nearest(p, 12);
      if (nr && angDiff(nr.bearing, br) < 50) {
        metros += segM / n;
        if (nr.km < km) km = nr.km;
      }
    }
  }
  return metros > 0 ? { metros, km } : null;
}

function chainLenM(c: Coord[]): number {
  let m = 0;
  for (let i = 0; i < c.length - 1; i++) m += Math.hypot((c[i + 1][0] - c[i][0]) * KX(c[i][1]), (c[i + 1][1] - c[i][1]) * KY);
  return m;
}

function regionOf(ctx: RouteCtx): BBox {
  const xs = [ctx.origin.lon, ctx.destination.lon], ys = [ctx.origin.lat, ctx.destination.lat];
  const b: BBox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const m = Math.max(0.1, 0.25 * Math.hypot(b[2] - b[0], b[3] - b[1]));
  return [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
}

/** Exclusões que a rota principal vai usar (zonas e reportes que bloqueiam o veículo) — mesma regra de
 *  services/routing.ts, para que as rotas de referência da pré-seleção passem pelos mesmos lugares que a rota final. */
let zonesCache: { at: number; data: ReturnType<typeof activeZones> } | null = null;
function zonasAtivas(): ReturnType<typeof activeZones> {
  if (!zonesCache || Date.now() - zonesCache.at > 60_000) {
    const data = activeZones();
    zonesCache = { at: Date.now(), data };
    data.catch(() => { zonesCache = null; });
  }
  return zonesCache.data;
}

async function exclusoesBase(ctx: RouteCtx, day: LegalDayInfo): Promise<Ring[]> {
  const [zones, reports] = await Promise.all([zonasAtivas().catch(() => []), blockingReports(ctx.vehicle, ctx.at).catch(() => [])]);
  const rings = zones.filter((z) => zoneApplies(z.rules, ctx.vehicle, ctx.at, day) && !pointInZone(z, ctx.origin) && !pointInZone(z, ctx.destination))
    .flatMap((z) => zoneRings(z));
  for (const r of reports) rings.push(reportToRing(r));
  return rings;
}

interface Cand { t: Trecho; k: number; c: Coord[] }
const candKey = (x: Cand) => `${x.t.id}:${x.k}`;

/** Cadeias candidatas a até RAIO_SELECAO_M de uma rota. */
function perto(cands: Cand[], rota: Coord[]): Cand[] {
  if (rota.length < 2) return [];
  const cell = (RAIO_SELECAO_M / 111000) * 1.05;
  const idx = new RouteIndex(rota, cell);
  const bb = bboxOf([rota]);
  const box: BBox = [bb[0] - cell, bb[1] - cell, bb[2] + cell, bb[3] + cell];
  return cands.filter(({ c }) => intersects(bboxOf([c]), box)
    && c.some((p, i) => (i % 3 === 0 || i === c.length - 1) && idx.nearest(p, RAIO_SELECAO_M) !== null));
}

/** Cadeias que a rota percorre de fato, no sentido da cadeia. */
function usadasPor(rota: Coord[], cands: Cand[]): Cand[] {
  if (rota.length < 2 || !cands.length) return [];
  const idx = new RouteIndex(rota);
  const bb = bboxOf([rota]);
  const box: BBox = [bb[0] - 0.001, bb[1] - 0.001, bb[2] + 0.001, bb[3] + 0.001];
  return cands.filter((x) => {
    if (!intersects(bboxOf([x.c]), box)) return false;
    const u = usage(idx, x.c);
    return !!u && (u.metros >= 30 || u.metros >= 0.5 * chainLenM(x.c));
  });
}

/**
 * Pré-seleção por "geração de restrições": o services/routing.ts confere cada linha penalizada contra as rotas (custo
 * proporcional ao número de linhas × tamanho da rota), então mandar as ~300 cadeias ativas da cidade deixaria a rota
 * lenta. Calculamos a rota com as mesmas exclusões (zonas e reportes) e sem penalidade de VER, penalizamos as cadeias
 * proibidas que ela usa, recalculamos e repetimos até a rota não usar nenhuma cadeia nova (ou MAX_ITER). O conjunto
 * final é o que a rota principal recebe — com as mesmas exclusões, ela chega na mesma rota da última iteração.
 */
async function selecionar(ctx: RouteCtx, day: LegalDayInfo, cands: Cand[]): Promise<Cand[]> {
  if (cands.length <= MAX_DIRETO) return cands;
  const rings = await exclusoesBase(ctx, day);
  const base = { origin: ctx.origin, destination: ctx.destination, vehicle: ctx.vehicle, departureLocal: ctx.departureLocal, excludePolygons: rings };
  let rota = (await valhalla.route(base).catch(() => null))?.coordinates as Coord[] | undefined;
  if (!rota) return cands; // sem referência: manda tudo (mais lento, mas correto)
  const sel = new Map<string, Cand>();
  for (let it = 0; it < MAX_ITER; it++) {
    const novas = usadasPor(rota, cands.filter((x) => !sel.has(candKey(x))));
    if (DEBUG) console.log(`[ver] pré-seleção volta ${it}: +${novas.length} (${novas.map((x) => x.t.name).join(' | ')})`);
    if (!novas.length) return [...sel.values()];
    for (const x of novas) sel.set(candKey(x), x);
    const r = await valhalla.route({ ...base, costLines: [...sel.values()].map((x) => ({ coordinates: x.c, factor: FACTOR })) }).catch(() => null);
    if (!r) break;
    rota = r.coordinates as Coord[];
  }
  for (const x of perto(cands, rota)) sel.set(candKey(x), x); // não convergiu: vizinhas da última rota
  if (DEBUG) console.log(`[ver] pré-seleção não convergiu em ${MAX_ITER} voltas: ${sel.size} cadeias`);
  return [...sel.values()];
}

function itemOf(t: Trecho, c: Coord[]): LayerItem {
  const mid = c[Math.floor(c.length / 2)];
  const sentido = t.props.sentido && t.props.sentido !== AMBOS ? ` (${t.props.sentido})` : '';
  return {
    // id do inciso (não da cadeia): o routing.ts deduplica avoided/avisos por id, então cada via aparece uma vez só
    kind: 'layer', layer: 'ver', id: t.id, name: t.name, type: `VER ${PAR_TXT[t.props.paragrafo] ?? ''}`.trim(),
    rule: t.props.horario, lon: mid[0], lat: mid[1], note: `${t.name}${sentido}: ${t.props.horario}`,
  };
}

// ------------------------------------------------------------------------------------------------ camada
const layer: RouteLayer = {
  meta: {
    id: 'ver',
    label: 'VER — vias restritas a caminhão (SP)',
    description: 'Vias Estruturais Restritas da capital: proibidas a caminhões em dias e horários da Portaria SMT 137/2018 (art. 2º). '
      + 'A rota evita a via (não as travessias) quando a restrição vale no horário de saída.',
    group: 'restricoes',
    sources: [
      { name: 'Portaria SMT.GAB 137/2018, art. 2º (texto compilado) e Portaria SMT.GAB 49/2021', url: 'https://legislacao.prefeitura.sp.gov.br/leis/portaria-secretaria-municipal-de-mobilidade-e-transportes-smt-137-de-3-de-agosto-de-2018', license: 'Ato oficial, sem proteção autoral (Lei 9.610/98, art. 8º, IV)' },
      { name: 'OpenStreetMap (geometria das vias)', url: 'https://www.openstreetmap.org/copyright', license: 'ODbL 1.0 — © colaboradores do OpenStreetMap' },
    ],
    style: { kind: 'line', color: '#dc2626', width: 4, opacity: 0.75, minzoom: 10, icon: '⛔' },
    defaultVisible: true,
  },

  async features(bbox, { zoom }) {
    const z = zoom ?? 12;
    if (z < 10) return { type: 'FeatureCollection', features: [] };
    const rows = await featuresInBbox('ver', bbox, { limit: 500, simplify: z < 14 ? 0.00002 : undefined });
    return {
      type: 'FeatureCollection',
      features: rows.filter((r) => vigente(r.props as unknown as VerProps)).map((r) => {
        const p = r.props as unknown as VerProps;
        return {
          type: 'Feature' as const,
          id: r.id,
          geometry: r.geometry,
          properties: {
            id: r.id,
            name: `${r.name} — VER ${PAR_TXT[p.paragrafo]}`,
            horario: p.horario,
            sentido: p.sentido,
            vuc: p.vuc,
            excecoes: (p.excecoes ?? []).map((e) => e.texto).join('; '),
            norma: p.norma,
            vigencia: p.vigencia,
            extensao_km: p.extensao_km,
            paragrafo: p.paragrafo,
            kind: r.kind,
            color: COR[p.paragrafo] ?? '#dc2626',
          },
        };
      }),
    };
  },

  async costLines(ctx) {
    const [trechos, day] = await Promise.all([loadTrechos(), legalDayInfo(ctx.at)]);
    const local = DateTime.fromJSDate(ctx.at).setZone(ctx.tz);
    const region = regionOf(ctx);
    const ativos = trechos.filter((t) => vigente(t.props) && intersects(t.bbox, region) && decide(t.props, ctx.vehicle, local, day).proibido);
    if (!ativos.length) return [];
    const bad = await badChains(trechos);
    const cands: Cand[] = [];
    for (const t of ativos) t.chains.forEach((c, k) => { if (c.length >= 2 && !bad.has(`${t.id}:${k}`)) cands.push({ t, k, c }); });
    const sel = await selecionar(ctx, day, cands);
    return sel.map(({ t, c }) => ({ item: itemOf(t, c), coordinates: c, factor: FACTOR }));
  },

  async annotate(ctx, route: RouteGeom) {
    const v = ctx.vehicle;
    if (v.weight_t <= 3.5) return {};
    const coords = route.line.geometry.coordinates as Coord[];
    if (coords.length < 2) return {};
    const rb = bboxOf([coords]);
    const pad = 0.0005;
    const trechos = (await loadTrechos()).filter((t) => (vigente(t.props) || t.props.paragrafo === 5)
      && intersects(t.bbox, [rb[0] - pad, rb[1] - pad, rb[2] + pad, rb[3] + pad]));
    if (!trechos.length) return {};
    // Feriado e suspensões valem no DIA/INSTANTE DA PASSAGEM, não no da saída: quem sai às 23h59 de um feriado chega de
    // madrugada num dia útil (e vice-versa). Memo por minuto da passagem (poucas VER por rota).
    const dias = new Map<string, Promise<LegalDayInfo>>();
    const diaDe = (t: DateTime): Promise<LegalDayInfo> => {
      const k = t.toFormat("yyyy-LL-dd'T'HH:mm");
      let p = dias.get(k);
      if (!p) { p = legalDayInfo(t.toJSDate()); dias.set(k, p); }
      return p;
    };
    const dep = DateTime.fromJSDate(ctx.at).setZone(ctx.tz);
    const idx = new RouteIndex(coords);
    const totalKm = idx.totalKm || route.distance_km;

    interface Uso { t: Trecho; km: number; metros: number; ponto: Coord }
    const usados: Uso[] = [];
    for (const t of trechos) {
      let metros = 0, km = Infinity, total = 0;
      let ponto: Coord = t.chains[0][0];
      for (const c of t.chains) {
        total += chainLenM(c);
        const u = usage(idx, c);
        if (u) {
          metros += u.metros;
          if (u.km < km) { km = u.km; ponto = c[Math.floor(c.length / 2)]; }
        }
      }
      // usa de verdade: >= 60 m (ou metade de um trecho curto, como pontes e viadutos)
      if (metros >= 60 || (metros >= 25 && metros >= 0.5 * Math.min(total, 120))) usados.push({ t, km, metros, ponto });
    }
    if (!usados.length) return {};
    usados.sort((a, b) => a.km - b.km);

    const warnings: LayerWarning[] = [];
    // proibições agrupadas pela via (ex.: vários incisos da Marginal Tietê viram um aviso só)
    const proib = new Map<string, { nome: string; incisos: string[]; par: number; hora: string; horario: string; norma: string; borda: boolean;
      ponta: boolean; vucS1: boolean; id: string; lon: number; lat: number }>();
    const summary: string[] = [];
    const data: Record<string, unknown>[] = [];
    const excecoesAvisadas = new Set<string>();
    const feriadosNaPassagem = new Map<string, string>(); // dd/MM → nome do feriado que liberou alguma VER usada
    let avisouP49 = false;
    const pertoDaPonta = (km: number) => km < 0.3 || totalKm - km < 0.3;

    for (const u of usados) {
      const p = u.t.props;
      const eta = dep.plus({ seconds: Math.round(route.duration_s * Math.min(1, u.km / Math.max(totalKm, 1e-6))) });
      const hora = eta.toFormat('HH:mm');
      const rotulo = `${u.t.name} (VER ${PAR_TXT[p.paragrafo]}, inciso ${p.inciso})`;
      const mid = u.ponto;
      if (!vigente(p)) {
        if (p.paragrafo === 5 && !avisouP49) {
          avisouP49 = true;
          warnings.push({ code: 'ver_portaria_49', severity: 'info', id: u.t.id,
            message: 'Marginal Tietê: a Portaria SMT 49/2021 vai proibir caminhões em qualquer horário quando o trecho norte do Rodoanel '
              + 'estiver concluído e liberado (art. 3º; carga com origem/destino em SP seguirá liberada, art. 38-A). Ainda não está valendo '
              + `(${P49_SITUACAO}).` });
        }
        continue;
      }
      const day = await diaDe(eta);
      const d = decide(p, v, eta, day);
      if (d.codigo === 'feriado' && day.holiday) feriadosNaPassagem.set(eta.toFormat('dd/LL'), day.holiday.name);
      data.push({ id: u.t.id, nome: u.t.name, paragrafo: p.paragrafo, inciso: p.inciso, horario_passagem: hora,
        data_passagem: eta.toISODate(), metros: Math.round(u.metros), proibido: d.proibido, motivo: d.motivo, norma: p.norma });
      if (d.proibido) {
        const via = u.t.name.split(/ sentido | \(/)[0].trim();
        const g = proib.get(`${p.paragrafo}|${via}`);
        const borda = minutosDaBorda(p.janelas, eta) <= 15;
        if (g) {
          g.incisos.push(p.inciso);
          g.borda &&= borda;
          g.ponta ||= pertoDaPonta(u.km);
        } else {
          proib.set(`${p.paragrafo}|${via}`, { nome: via, incisos: [p.inciso], par: p.paragrafo, hora, horario: p.horario,
            norma: p.norma.replace(/, [IVXL]+$/, ''), borda, ponta: pertoDaPonta(u.km), vucS1: p.paragrafo === 1 && !!v.is_vuc,
            id: u.t.id, lon: mid[0], lat: mid[1] });
        }
        summary.push(`${u.t.name} (${PAR_TXT[p.paragrafo]}): PROIBIDA às ~${hora}`);
      } else {
        if (d.codigo === 'fora_horario' && minutosDaBorda(p.janelas, eta) <= 15) {
          warnings.push({ code: 'ver_horario_limite', severity: 'warn', id: u.t.id, lon: mid[0], lat: mid[1],
            message: `Rota passa por ${rotulo} por volta das ${hora}, perto do início/fim da restrição (${p.horario}). Poucos minutos de diferença podem cair no horário proibido (multa: CTB art. 187, I).` });
        }
        if (d.codigo === 'excecao' && d.excecao && !excecoesAvisadas.has(d.excecao.codigo)) {
          excecoesAvisadas.add(d.excecao.codigo);
          warnings.push({ code: 'ver_excecao', severity: 'info', id: u.t.id,
            message: `VER liberada por exceção: ${d.excecao.texto} (${d.excecao.artigo}). Leve a AETC válida.` });
        }
        summary.push(`${u.t.name} (${PAR_TXT[p.paragrafo]}): liberada às ~${hora} — ${d.motivo}`);
      }
    }
    for (const g of proib.values()) {
      const inc = g.incisos.length > 1 ? `incisos ${g.incisos.join(', ')}` : `inciso ${g.incisos[0]}`;
      warnings.unshift({
        code: 'ver_proibida', severity: g.borda ? 'warn' : 'danger', id: g.id, lon: g.lon, lat: g.lat,
        message: `Rota usa ${g.nome} (VER ${PAR_TXT[g.par]}, ${inc}) por volta das ${g.hora}: proibido para este caminhão (${g.horario}).`
          + `${g.vucS1 ? ' VUC, mesmo com AETC, não é liberado nas VER do § 1º (art. 18).' : ''}`
          + `${g.ponta ? ' Origem/destino na própria VER: só com AETC (ex.: acesso a estacionamento próprio, art. 19).' : ''}`
          + `${g.borda ? ' Horário no limite da restrição: confira a hora de passagem.' : ' Mude o horário de saída ou o trajeto.'} Base: ${g.norma}.`,
      });
    }
    for (const [dia, nome] of [...feriadosNaPassagem].reverse()) summary.unshift(`Feriado na passagem (${nome}, ${dia}): as VER não se aplicam.`);
    const proibidas = data.filter((x) => x.proibido).length;
    return {
      warnings: warnings.slice(0, 10),
      summary: summary.slice(0, 8),
      data: { usadas: data, proibidas, portaria_49_vigente: PORTARIA_49_VIGENTE, portaria_49_conferida_em: P49_CONFERIDA_EM },
    };
  },
};

export default layer;
