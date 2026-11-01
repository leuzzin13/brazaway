import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { env } from '../config.js';
import type { RouteRequest } from '../schemas.js';
import { resolveVehicle, type Vehicle } from './vehicle.js';
import { priorizarAvisos, type ResumoAvisos } from './alertas.js';
import { planoAbastecimento, planosPorNivel, type PlanoAbastecimento } from './abastecimento.js';
import * as valhalla from './valhalla.js';
import { NoRouteError, type Ring } from './valhalla.js';
import { activeReportsInBbox, blockingReports, crowdAlertsInBbox, reportToRing, type ReportRow } from './restrictions.js';
import { activeZones, describeWindows, pointInZone, zoneApplies, zoneRings, type ZoneRow } from './zones.js';
import { endpointHolidays, legalDayInfo, municipiosAt, SAO_PAULO_IBGE, type EndpointHolidays, type Holiday, type Municipio } from './calendar.js';
import { etaPorHorario, type EtaHorario } from './etaHorario.js';
import { drivingPlan, restStopsAlongRoute, type DrivingPlan, type RestStop } from './restStops.js';
import { loadLayers } from '../layers/index.js';
import type { LayerCostLine, LayerItem, LayerWarning, RouteCtx, RouteGeom, RouteLayer, RouteLine } from '../layers/types.js';

export interface AvoidedItem {
  kind: 'report' | 'zone' | 'layer';
  layer?: string;
  id: string;
  type?: string;        // report type
  value_num?: number | null;
  name?: string;        // zone name
  rule?: string;        // zone window description
  lat?: number;
  lon?: number;
  note?: string | null;
}
export interface Warning {
  code: string; message: string; report_id?: string; zone_id?: string; layer?: string; severity?: 'info' | 'warn' | 'danger'; lat?: number; lon?: number; id?: string;
  /** zona na origem/destino: primeiro horário (local, YYYY-MM-DDTHH:mm) em que ESTE veículo pode estar lá, nas próximas 36 h */
  liberado_em?: string | null;
  /** zona na origem/destino: um VUC com AETC poderia entrar no horário pedido */
  vuc_aetc_entra?: boolean;
}

export interface RouteResponse {
  geometry: GeoJSON.LineString;
  distance_km: number;
  duration_s: number;
  departure_at: string;
  vehicle: ReturnType<typeof resolveVehicle>;
  avoided: AvoidedItem[];
  warnings: Warning[];
  rest_stops: RestStop[];
  driving_plan: DrivingPlan;
  /** tempo de viagem ajustado pelo horário de saída (fator CET; null fora da área ou se falhar) */
  eta_horario: EtaHorario | null;
  /** resultado de cada camada de dados (resumo + dados próprios) */
  layers: Record<string, { label: string; group: string; summary?: string[]; data?: unknown }>;
  /** para a tela do motorista: até 3 avisos que pedem ação, e o resto resumido (ver services/alertas.ts) */
  alertas_motorista: Warning[];
  resumo_avisos: ResumoAvisos;
  /** só quando o pedido traz `abastecimento`: onde parar e quantos litros (ver services/abastecimento.ts) */
  plano_abastecimento?: PlanoAbastecimento | null;
  planos_abastecimento?: (PlanoAbastecimento & { nivel_pct: number })[] | null;
  valhalla: { costing: 'truck'; exclude_polygons_count: number; cost_lines_count: number; timings_ms?: Record<string, number> };
}

export class RouteBlockedError extends Error {
  statusCode = 409;
  constructor(public blocked_by: AvoidedItem[], message: string, public limited_by: VehicleLimit[] = []) { super(message); }
}

/** Medida do veículo que, sozinha, impede qualquer rota (limite do próprio grafo: maxweight, maxheight... do OSM). */
export type VehicleLimit = 'peso' | 'peso_por_eixo' | 'altura' | 'largura' | 'comprimento' | 'carga_perigosa';
const LIMIT_RELAX: Record<VehicleLimit, (v: Vehicle) => Partial<Vehicle> | null> = {
  peso: (v) => (v.weight_t > 3.5 ? { weight_t: 3.5 } : null),
  peso_por_eixo: (v) => (v.axle_load_t > 3 ? { axle_load_t: 3 } : null),
  altura: (v) => (v.height_m > 2.5 ? { height_m: 2.5 } : null),
  largura: (v) => (v.width_m > 2 ? { width_m: 2 } : null),
  comprimento: (v) => (v.length_m > 6 ? { length_m: 6 } : null),
  carga_perigosa: (v) => (v.hazmat ? { hazmat: false } : null),
};
const br = (n: number) => String(n).replace('.', ',');
const LIMIT_LABEL: Record<VehicleLimit, (v: Vehicle) => string> = {
  peso: (v) => `o peso do veículo (${br(v.weight_t)} t)`,
  peso_por_eixo: (v) => `o peso por eixo (${br(v.axle_load_t)} t)`,
  altura: (v) => `a altura do veículo (${br(v.height_m)} m)`,
  largura: (v) => `a largura do veículo (${br(v.width_m)} m)`,
  comprimento: (v) => `o comprimento do veículo (${br(v.length_m)} m)`,
  carga_perigosa: () => 'carga perigosa',
};

/** Sem rota e sem regra culpada: descobre qual medida do veículo fecha o caminho (ex.: rampa da balsa de Ilhabela com
 *  maxweight 40 t). Só roda na falha; até 6 consultas ao Valhalla, em paralelo. */
async function diagnoseVehicleLimits(base: Parameters<typeof valhalla.route>[0]): Promise<VehicleLimit[]> {
  const tries = (Object.keys(LIMIT_RELAX) as VehicleLimit[])
    .map((k) => ({ k, patch: LIMIT_RELAX[k](base.vehicle) }))
    .filter((t): t is { k: VehicleLimit; patch: Partial<Vehicle> } => t.patch !== null);
  const ok = await Promise.all(tries.map((t) => valhalla.route({ ...base, vehicle: { ...base.vehicle, ...t.patch } }).then(() => true, () => false)));
  return tries.filter((_, i) => ok[i]).map((t) => t.k);
}

interface Exclusion { item: AvoidedItem; rings: Ring[]; polygon: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> }

function reportItem(r: ReportRow): AvoidedItem {
  const c = turf.centroid(turf.feature(r.geometry)).geometry.coordinates;
  return { kind: 'report', id: r.id, type: r.type, value_num: r.value_num, lon: c[0], lat: c[1], note: r.note };
}
function zoneItem(z: ZoneRow): AvoidedItem {
  return { kind: 'zone', id: z.id, name: z.name, rule: describeWindows(z.rules) };
}

function intersects(line: GeoJSON.Feature<GeoJSON.LineString>, ex: Exclusion): boolean {
  return turf.booleanIntersects(line, ex.polygon);
}

/** fração dos pontos da linha penalizada que ficam a até tolM da rota (aprox. "a rota usa o trecho") */
function overlapRatio(route: GeoJSON.Feature<GeoJSON.LineString>, coords: [number, number][], tolM = 15): number {
  if (!coords.length) return 0;
  const pts = coords.length > 40 ? coords.filter((_, i) => i % Math.ceil(coords.length / 40) === 0) : coords;
  const hits = pts.filter((c) => turf.pointToLineDistance(turf.point(c), route, { units: 'meters' }) <= tolM).length;
  return hits / pts.length;
}
/**
 * Índice em grade dos segmentos da rota (célula de 0,002°, ~200 m), para o usesCostLine não percorrer a rota inteira a
 * cada ponto amostrado (com dezenas de costLines e rotas de milhares de vértices, era o maior custo da resposta).
 * Cada segmento é registrado nas células de pontos espaçados de no máximo meia célula ao longo dele; um ponto a até
 * 15 m da rota cai, então, na vizinhança 3×3 de alguma dessas células.
 */
const GRID_DEG = 0.002;
const routeGrids = new WeakMap<GeoJSON.Feature<GeoJSON.LineString>, Map<string, number[]>>();
const cellKey = (x: number, y: number) => `${Math.floor(x / GRID_DEG)}:${Math.floor(y / GRID_DEG)}`;
function routeGrid(route: GeoJSON.Feature<GeoJSON.LineString>): Map<string, number[]> {
  let g = routeGrids.get(route);
  if (g) return g;
  g = new Map();
  const cs = route.geometry.coordinates;
  for (let i = 0; i < cs.length - 1; i++) {
    const [x0, y0] = cs[i], [x1, y1] = cs[i + 1];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / (GRID_DEG / 2)));
    const seen = new Set<string>();
    for (let k = 0; k <= n; k++) {
      const key = cellKey(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
      if (seen.has(key)) continue;
      seen.add(key);
      const list = g.get(key);
      if (list) list.push(i); else g.set(key, [i]);
    }
  }
  routeGrids.set(route, g);
  return g;
}
/** Ponto da rota mais próximo de p, olhando só os segmentos das células vizinhas (dist = Infinity se não houver). */
function nearestOnRoute(route: GeoJSON.Feature<GeoJSON.LineString>, p: [number, number]): { dist: number; index: number } {
  const g = routeGrid(route);
  const cx = Math.floor(p[0] / GRID_DEG), cy = Math.floor(p[1] / GRID_DEG);
  const cand = new Set<number>();
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const i of g.get(`${cx + dx}:${cy + dy}`) ?? []) cand.add(i);
  let best = { dist: Infinity, index: 0 };
  const cs = route.geometry.coordinates;
  for (const i of cand) {
    const d = turf.pointToLineDistance(turf.point(p), turf.lineString([cs[i], cs[i + 1]]), { units: 'meters' });
    if (d < best.dist) best = { dist: d, index: i };
  }
  return best;
}

/**
 * A rota usa o trecho penalizado NO MESMO SENTIDO? (linhas de mão única ou penalizadas só num sentido:
 * a rota que passa pela pista contrária não "usa" o trecho). Amostra pontos da linha que ficam perto da rota e
 * compara o rumo local da linha com o rumo da rota no ponto mais próximo (diferença < 90°).
 */
export function usesCostLine(route: GeoJSON.Feature<GeoJSON.LineString>, cl: Pick<LayerCostLine, 'coordinates'>): boolean {
  const coords = cl.coordinates;
  if (coords.length < 2) return overlapRatio(route, coords) >= 0.5;
  // Mede o COMPRIMENTO percorrido sobre o trecho, não só os vértices: amostra a linha a cada ~20 m (até 60 pontos) e
  // conta os pontos a até 15 m da rota com o mesmo rumo. Antes, um trecho curto de 2 ou 3 vértices cruzado num viaduto
  // ou num trevo (30 m de contato) contava como "usa a via" e virava aviso falso de "trecho restrito sem alternativa"
  // (achado da simulação: Linha Vermelha a partir de Duque de Caxias).
  const line = turf.lineString(coords);
  const lenM = turf.length(line, { units: 'meters' });
  const n = Math.min(60, Math.max(4, Math.ceil(lenM / 20)));
  let near = 0, same = 0;
  for (let i = 0; i < n; i++) {
    const d0 = (lenM * i) / n, d1 = Math.min(lenM, (lenM * (i + 1)) / n);
    const a = turf.along(line, d0, { units: 'meters' }).geometry.coordinates as [number, number];
    const b = turf.along(line, d1, { units: 'meters' }).geometry.coordinates as [number, number];
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const np = nearestOnRoute(route, mid);
    if (np.dist > 15) continue;
    near++;
    const idx = Math.min(np.index, route.geometry.coordinates.length - 2);
    const r0 = route.geometry.coordinates[idx], r1 = route.geometry.coordinates[idx + 1];
    const bl = turf.bearing(turf.point(a), turf.point(b));
    const br = turf.bearing(turf.point(r0 as [number, number]), turf.point(r1 as [number, number]));
    if (Math.abs(((bl - br + 540) % 360) - 180) < 90) same++;
  }
  const sobreM = (same / n) * lenM;
  // usa o trecho: metade dele, ou 300 m seguidos de via restrita (trecho longo usado em parte também é infração)
  return near > 0 && same / near >= 0.5 && (same / n >= 0.5 || sobreM >= 300);
}
function itemLabel(b: AvoidedItem): string {
  if (b.kind === 'zone') return b.name ?? 'zona';
  if (b.kind === 'layer') return `${b.name ?? b.type ?? b.layer}${b.rule ? ` (${b.rule})` : ''}`;
  return `${b.type}${b.value_num ? ` ${b.value_num}` : ''}`;
}

function minDistanceM(line: GeoJSON.Feature<GeoJSON.LineString>, g: GeoJSON.Point | GeoJSON.LineString): number {
  const pts = g.type === 'Point' ? [g.coordinates] : g.coordinates;
  return Math.min(...pts.map((p) => turf.pointToLineDistance(turf.point(p), line, { units: 'meters' })));
}

/** Passos 1–3 da rota: veículo, horário, zonas, reportes que bloqueiam e restrições das camadas. */
async function prepareRestrictions(req: RouteRequest) {
  const vehicle = resolveVehicle(req.vehicle);
  const dep = req.departure_at
    ? DateTime.fromISO(req.departure_at, { zone: env.tz })
    : DateTime.now().setZone(env.tz);
  if (!dep.isValid) throw Object.assign(new Error('departure_at inválido (use YYYY-MM-DDTHH:mm)'), { statusCode: 422 });
  const departureLocal = dep.toFormat("yyyy-LL-dd'T'HH:mm");
  const at = dep.toJSDate();

  const warnings: Warning[] = [];
  const exclusions: Exclusion[] = [];

  // 1) Zonas de restrição por horário (só horário de saída — limitação documentada). Os avisos de feriado saem no
  //    passo 6, quando já se sabe por onde a rota passa e a que horas chega (município da origem e do destino).
  const [zones, dayInfo, ends] = await Promise.all([
    activeZones(), legalDayInfo(at),
    municipiosAt([req.origin, req.destination]).catch((): (Municipio | null)[] => [null, null]),
  ]);
  for (const z of zones) {
    if (!zoneApplies(z.rules, vehicle, at, dayInfo)) continue;
    const oIn = pointInZone(z, req.origin);
    const dIn = pointInZone(z, req.destination);
    if (oIn || dIn) {
      // O que fazer, e não só o aviso: próximo horário em que este veículo pode estar lá, e se um VUC com AETC entraria
      // agora (achado da simulação de 60 dias: 44 entregas em zona proibida seguindo o app, sem dizer como resolver).
      const liberado = await nextAllowedTime(z, vehicle, at).catch(() => null);
      const vucEntra = !vehicle.is_vuc && !zoneApplies(z.rules, resolveVehicle({ preset: 'vuc', has_aetc: true }), at, dayInfo);
      const dica = [
        liberado ? `Horário liberado para este veículo: ${describeLocal(liberado, at)}.` : null,
        vucEntra ? 'Um VUC com AETC pode entrar no horário pedido.' : null,
      ].filter(Boolean).join(' ');
      warnings.push({
        code: oIn && dIn ? 'origin_and_destination_in_zone' : oIn ? 'origin_in_zone' : 'destination_in_zone',
        zone_id: z.id,
        message: `${oIn && dIn ? 'Origem e destino estão' : oIn ? 'Origem está' : 'Destino está'} dentro de "${z.name}" (${describeWindows(z.rules)}); a zona NÃO foi excluída da rota. Verifique autorização/exceção.${dica ? ` ${dica}` : ''}`,
        liberado_em: liberado ? DateTime.fromJSDate(liberado).setZone(env.tz).toFormat("yyyy-LL-dd'T'HH:mm") : null,
        vuc_aetc_entra: vucEntra,
      });
      continue;
    }
    exclusions.push({ item: zoneItem(z), rings: zoneRings(z), polygon: turf.multiPolygon(z.geometry_full.coordinates) });
  }

  // 2) Reportes colaborativos que bloqueiam ESTE veículo (base separada do OSM)
  const blocking = await blockingReports(vehicle, at);
  for (const r of blocking) {
    const ring = reportToRing(r);
    exclusions.push({ item: reportItem(r), rings: [ring], polygon: turf.polygon([ring]) });
  }

  // 3) Camadas de dados (data_features): exclusões duras e trechos penalizados
  const ctx: RouteCtx = { vehicle, at, departureLocal, origin: req.origin, destination: req.destination, tz: env.tz };
  const layers = await loadLayers();
  const costLines: LayerCostLine[] = [];
  const timings: Record<string, number> | null = TIMINGS ? {} : null;
  await Promise.all(layers.map(async (l) => {
    try {
      if (l.exclusions) {
        for (const ex of await timed(timings, `pre:${l.meta.id}`, () => l.exclusions!(ctx))) {
          const poly = ex.rings.length === 1 ? turf.polygon([closeRing(ex.rings[0])]) : turf.multiPolygon(ex.rings.map((r) => [closeRing(r)]));
          exclusions.push({ item: ex.item, rings: ex.rings, polygon: poly });
        }
      }
      if (l.costLines) costLines.push(...(await timed(timings, `pre:${l.meta.id}`, () => l.costLines!(ctx))));
    } catch (err) {
      warnings.push({ code: 'layer_error', layer: l.meta.id, severity: 'info', message: `Camada "${l.meta.label}" indisponível nesta rota: ${(err as Error).message}` });
    }
  }));

  return { vehicle, dep, departureLocal, at, warnings, exclusions, zones, dayInfo, ends, ctx, layers, costLines, timings };
}

/** Primeiro instante (passos de 15 min, até 36 h) em que a zona não se aplica a este veículo. null = não libera nesse prazo. */
async function nextAllowedTime(z: ZoneRow, vehicle: Vehicle, from: Date): Promise<Date | null> {
  const days = new Map<string, Awaited<ReturnType<typeof legalDayInfo>>>();
  const step = 15 * 60_000;
  const start = Math.ceil(from.getTime() / step) * step;
  for (let t = start; t <= from.getTime() + 36 * 3600_000; t += step) {
    const at = new Date(t);
    const key = DateTime.fromJSDate(at).setZone(env.tz).toISODate()!;
    if (!days.has(key)) days.set(key, await legalDayInfo(at));
    if (!zoneApplies(z.rules, vehicle, at, days.get(key))) return t === start && t - from.getTime() < step ? from : at;
  }
  return null;
}

function describeLocal(d: Date, ref: Date): string {
  const l = DateTime.fromJSDate(d).setZone(env.tz), r = DateTime.fromJSDate(ref).setZone(env.tz);
  const dia = l.hasSame(r, 'day') ? 'hoje' : l.hasSame(r.plus({ days: 1 }), 'day') ? 'amanhã' : l.toFormat('dd/LL');
  return `${dia} às ${l.toFormat('HH:mm')}`;
}

/**
 * Próximo instante (até 24 h, de hora em hora e depois refinado em 15 min) em que a camada não restringe mais o trecho
 * `itemId` para este veículo. Usa a própria regra da camada (costLines no horário testado). undefined = não deu para
 * calcular; null = não libera em 24 h. O horário é o de saída, como nas camadas (limitação documentada).
 */
async function nextLayerFreeTime(layers: RouteLayer[], ctx: RouteCtx, layerId: string, itemId: string): Promise<Date | null | undefined> {
  const l = layers.find((x) => x.meta.id === layerId);
  if (!l?.costLines) return undefined;
  const ainda = async (t: Date) => {
    const local = DateTime.fromJSDate(t).setZone(env.tz).toFormat("yyyy-LL-dd'T'HH:mm");
    const cls = await l.costLines!({ ...ctx, at: t, departureLocal: local });
    return cls.some((c) => c.item.id === itemId);
  };
  for (let h = 1; h <= 24; h++) {
    const t = new Date(ctx.at.getTime() + h * 3600_000);
    if (await ainda(t)) continue;
    for (const q of [45, 30, 15]) {
      const tq = new Date(t.getTime() - q * 60_000);
      if (!(await ainda(tq))) return tq;
    }
    return t;
  }
  return null;
}

export async function computeRoute(req: RouteRequest): Promise<RouteResponse> {
  const { vehicle, departureLocal, at, warnings, exclusions, zones, dayInfo, ends, ctx, layers, costLines, timings } = await prepareRestrictions(req);
  const excludePolygons = exclusions.flatMap((e) => e.rings);
  const base = { origin: req.origin, destination: req.destination, vehicle, departureLocal };
  // Trechos penalizados que o Valhalla não consegue casar com o grafo ("Failed to edge walk line feature") derrubariam a
  // rota inteira. Os já conhecidos saem antes; um novo é achado por busca binária, descartado com aviso e lembrado.
  const knownBad = costLines.filter((c) => BAD_COST_LINES.has(costLineKey(c)));
  if (knownBad.length) {
    costLines.splice(0, costLines.length, ...costLines.filter((c) => !BAD_COST_LINES.has(costLineKey(c))));
    noteDroppedLines(knownBad, warnings);
  }
  const restrictedOpts = { ...base, excludePolygons, costLines: costLines.map((c) => ({ coordinates: c.coordinates, factor: c.factor })) };
  const hasRestrictions = exclusions.length > 0 || costLines.length > 0;
  let freeCache: Promise<valhalla.ValhallaRouteResult | null> | null = null;
  const freeRoute = () => (freeCache ??= timed(timings, 'valhalla:livre', () => valhalla.route(base)).catch(() => null));

  // 3) Rota restrita
  let restricted: valhalla.ValhallaRouteResult;
  try {
    try {
      restricted = await timed(timings, 'valhalla:restrita', () => valhalla.route(restrictedOpts));
    } catch (e) {
      if (!isEdgeWalkError(e) || !costLines.length) throw e;
      const bad = await findBadCostLines(costLines, (ls) => valhalla.route({ ...base, excludePolygons, costLines: ls.map((c) => ({ coordinates: c.coordinates, factor: c.factor })) }));
      for (const b of bad) BAD_COST_LINES.add(costLineKey(b));
      costLines.splice(0, costLines.length, ...costLines.filter((c) => !bad.includes(c)));
      noteDroppedLines(bad, warnings);
      restrictedOpts.costLines = costLines.map((c) => ({ coordinates: c.coordinates, factor: c.factor }));
      restricted = await timed(timings, 'valhalla:restrita', () => valhalla.route(restrictedOpts));
    }
  } catch (e) {
    if (!(e instanceof NoRouteError)) throw e;
    // Descobrir quem bloqueou: rota livre e interseção com as exclusões
    let blockedBy: AvoidedItem[] = [];
    if (exclusions.length) {
      const free = await freeRoute();
      if (free) {
        const line = turf.lineString(free.coordinates);
        blockedBy = exclusions.filter((ex) => intersects(line, ex)).map((ex) => ex.item);
      }
    }
    const names = blockedBy.map(itemLabel);
    if (blockedBy.length) throw new RouteBlockedError(blockedBy, `Sem rota viável para este veículo: bloqueado por ${names.join(', ')}.`);
    const limits = await timed(timings, 'valhalla:diagnostico', () => diagnoseVehicleLimits(base)).catch(() => [] as VehicleLimit[]);
    throw new RouteBlockedError(
      [],
      limits.length
        ? `Sem rota para este veículo: todo caminho até o destino passa por via, ponte ou travessia (balsa) que não comporta ${limits.map((l) => LIMIT_LABEL[l](vehicle)).join(' nem ')}. Com essa medida menor existe rota.`
        : `Sem rota viável: ${e.valhallaMessage}. Verifique se origem/destino estão sobre vias acessíveis a caminhões.`,
      limits,
    );
  }
  const line = turf.lineString(restricted.coordinates);

  // 4) O que foi efetivamente evitado (rota livre cruza, rota restrita não)
  const avoided: AvoidedItem[] = [];
  let freeGeom: RouteLine | undefined;
  if (hasRestrictions) {
    const free = await freeRoute();
    if (free) {
      const freeLine = turf.lineString(free.coordinates);
      freeGeom = { line: freeLine, distance_km: free.distance_km, duration_s: free.duration_s };
      for (const ex of exclusions) {
        if (intersects(freeLine, ex) && !intersects(line, ex)) avoided.push(ex.item);
      }
      for (const cl of costLines) {
        const freeUses = usesCostLine(freeLine, cl);
        const restrictedUses = usesCostLine(line, cl);
        if (freeUses && !restrictedUses) avoided.push(cl.item);
        else if (restrictedUses) {
          warnings.push({ code: 'uses_restricted_way', layer: cl.item.layer, severity: 'danger', id: cl.item.id, lat: cl.item.lat, lon: cl.item.lon,
            message: `A rota passa por trecho restrito sem alternativa razoável: ${itemLabel(cl.item)}. Confira a regra antes de seguir.` });
        }
      }
      if (avoided.length && restricted.distance_km > free.distance_km * 1.5) {
        warnings.push({
          code: 'large_detour',
          message: `Desvio grande: ${restricted.distance_km.toFixed(1)} km contra ${free.distance_km.toFixed(1)} km sem as restrições (+${Math.round(restricted.distance_km - free.distance_km)} km). Verifique se há autorização/exceção aplicável.`,
        });
      }
    }
  }

  // 4b) Trecho restrito sem alternativa: a que horas ele libera para este veículo (achado da simulação de 60 dias: em
  //     Mairiporã e na ZRCC de Guarulhos o app avisava, mas não dizia que saindo um pouco mais tarde passava legalmente).
  const restritos = warnings.filter((w) => w.code === 'uses_restricted_way' && w.layer && w.id).slice(0, 3);
  await Promise.all(restritos.map(async (w) => {
    const t = await withTimeout(nextLayerFreeTime(layers, ctx, w.layer!, w.id!), 8000, 'horário de liberação').catch(() => undefined);
    if (t === undefined) return;
    w.liberado_em = t ? DateTime.fromJSDate(t).setZone(env.tz).toFormat("yyyy-LL-dd'T'HH:mm") : null;
    w.message += t ? ` O trecho libera para este veículo ${describeLocal(t, at)}: saindo nesse horário, a passagem é legal.` : ' O trecho não libera nas próximas 24 h para este veículo.';
  }));

  // 5) Avisos: rota passa perto de reporte não confirmado (score <= 0), de qualquer tipo
  const [minX, minY, maxX, maxY] = turf.bbox(line);
  const pad = 0.002;
  const near = await activeReportsInBbox([minX - pad, minY - pad, maxX + pad, maxY + pad]);
  const excludedIds = new Set(exclusions.map((e) => e.item.id));
  for (const r of near) {
    if (excludedIds.has(r.id)) continue;
    const d = minDistanceM(line, r.geometry);
    if (d > env.warnRadiusM) continue;
    const label = `${describeReport(r)}`;
    if (r.score <= 0) {
      warnings.push({ code: 'near_unconfirmed_report', report_id: r.id, message: `Rota passa a ${Math.round(d)} m de reporte não confirmado (${label}).` });
    } else {
      warnings.push({ code: 'near_report', report_id: r.id, message: `Rota passa a ${Math.round(d)} m de reporte confirmado que não bloqueia este veículo (${label}).` });
    }
  }

  // 5b) Radar móvel e blitz reportados pela comunidade: SÓ aviso (nunca exclude_polygon). Expiram em 2 h (expire_stale_reports).
  try {
    const crowd = await crowdAlertsInBbox([minX - pad, minY - pad, maxX + pad, maxY + pad]);
    for (const r of crowd) {
      const d = minDistanceM(line, r.geometry);
      if (d > env.warnRadiusM) continue;
      const c = r.geometry.type === 'Point' ? r.geometry.coordinates : r.geometry.coordinates[0];
      const km = turf.nearestPointOnLine(line, turf.point(c), { units: 'kilometers' }).properties.location;
      const ageMin = Math.max(0, Math.round((Date.now() - new Date(r.created_at).getTime()) / 60000));
      const idade = ageMin < 60 ? `${ageMin} min` : `${Math.floor(ageMin / 60)} h ${String(ageMin % 60).padStart(2, '0')} min`;
      const conf = r.votes_up === 1 ? '1 confirmação' : `${r.votes_up} confirmações`;
      const neg = r.votes_down ? ` e ${r.votes_down === 1 ? '1 negação' : `${r.votes_down} negações`}` : '';
      const isBlitz = r.type === 'blitz';
      warnings.push({
        code: isBlitz ? 'blitz_reportada' : 'radar_movel_reportado', report_id: r.id, id: r.id, severity: 'info', lat: c[1], lon: c[0],
        message: `${isBlitz ? 'Blitz' : 'Radar móvel'} reportada por motoristas há ${idade} (${conf}${neg}), a ${Math.round(d)} m da rota, no km ${String(km?.toFixed(1) ?? '?').replace('.', ',')}. Informação da comunidade, pode já ter saído.`,
      });
    }
  } catch (err) {
    warnings.push({ code: 'layer_error', layer: 'reports', severity: 'info', message: `Reportes de radar móvel/blitz indisponíveis nesta rota: ${(err as Error).message}` });
  }

  // 6) Pontos de descanso ao longo da rota + plano de direção (Lei 13.103)
  let restStops: RestStop[] = [];
  try { restStops = await withTimeout(restStopsAlongRoute(line.geometry, restricted.distance_km, restricted.duration_s, undefined, { at, employment: vehicle.employment }), LAYER_POST_TIMEOUT_MS, 'pontos de descanso'); } catch { /* tabela vazia/erro: segue sem */ }
  // vínculo do motorista (CLT x autônomo): muda o limite de jornada (CLT art. 235-C só para empregado)
  const plan = drivingPlan(restricted.duration_s, restStops, { employment: vehicle.employment });
  for (const n of plan.notes) warnings.push({ code: 'driving_time', message: n });
  for (const sgt of plan.suggested_stops) if (!sgt.stop) warnings.push({ code: 'no_rest_stop', message: sgt.message });

  // 6b) Avisos de feriado (no começo da lista, como antes): 'holiday' (calendário de São Paulo capital, só se a rota
  //     toca a capital, ou o nacional) e 'holiday_local' (município da origem na saída e do destino na chegada prevista:
  //     saída + direção + pausas e descansos do plano da Lei 13.103).
  const arrival = new Date(at.getTime() + plan.total_with_breaks_s * 1000);
  const localHolidays = await endpointHolidays(at, req.origin, req.destination, { arrivalAt: arrival, municipios: ends }).catch(() => []);
  const spCapital = dayInfo.holidays.length > 0 && routeTouchesSaoPaulo(ends, zones, line);
  warnings.unshift(...holidayWarnings(dayInfo.holidays, spCapital, localHolidays));

  // 7) Anotações das camadas (pedágio, OAEs, acidentes, roubo de carga, relevo...)
  const routeGeom: RouteGeom = {
    line, distance_km: restricted.distance_km, duration_s: restricted.duration_s, free: freeGeom,
    restrictions: { excludePolygons, costLines: restrictedOpts.costLines },
  };
  const layerOut: RouteResponse['layers'] = {};
  await Promise.all(layers.map(async (l) => {
    if (!l.annotate) return;
    try {
      const a = await timed(timings, `post:${l.meta.id}`, () => l.annotate!(ctx, routeGeom));
      for (const w of a.warnings ?? []) warnings.push({ ...w, layer: w.layer ?? l.meta.id } as Warning & LayerWarning);
      if (a.summary?.length || a.data !== undefined) layerOut[l.meta.id] = { label: l.meta.label, group: l.meta.group, summary: a.summary, data: a.data };
    } catch (err) {
      warnings.push({ code: 'layer_error', layer: l.meta.id, severity: 'info', message: `Camada "${l.meta.label}" falhou: ${(err as Error).message}` });
    }
  }));

  // Deduplicação: o mesmo item pode chegar por várias linhas (mão dupla, nó em várias vias, cadeias de trechos)
  const seenAvoided = new Set<string>();
  const avoidedUniq = avoided.filter((a) => {
    const k = `${a.kind}:${a.layer ?? ''}:${a.id}`;
    if (seenAvoided.has(k)) return false;
    seenAvoided.add(k); return true;
  });
  const seenWarn = new Set<string>();
  const warningsUniq = warnings.filter((w) => {
    const k = w.id ? `${w.code}:${w.layer ?? ''}:${w.id}` : `${w.code}:${w.layer ?? ''}:${w.message}`;
    if (seenWarn.has(k)) return false;
    seenWarn.add(k); return true;
  });
  avoided.length = 0; avoided.push(...avoidedUniq);
  warnings.length = 0; warnings.push(...warningsUniq);

  return {
    geometry: line.geometry,
    distance_km: restricted.distance_km,
    duration_s: restricted.duration_s,
    departure_at: departureLocal,
    vehicle,
    avoided,
    warnings,
    eta_horario: await withTimeout(etaPorHorario(line.geometry, restricted.duration_s, at), 10_000, 'tempo por horário').catch(() => null),
    rest_stops: restStops,
    driving_plan: plan,
    layers: layerOut,
    ...priorizarAvisos(warnings),
    ...(req.abastecimento ? { plano_abastecimento: await withTimeout(planoAbastecimento(line.geometry, restricted.distance_km, vehicle.preset_id ?? req.vehicle.preset, req.abastecimento), LAYER_POST_TIMEOUT_MS, 'plano de abastecimento').catch(() => null) } : {}),
    ...(req.abastecimento?.niveis_pct?.length ? { planos_abastecimento: await withTimeout(planosPorNivel(line.geometry, restricted.distance_km, vehicle.preset_id ?? req.vehicle.preset, req.abastecimento, req.abastecimento.niveis_pct), LAYER_POST_TIMEOUT_MS, 'planos por nível').catch(() => null) } : {}),
    valhalla: { costing: 'truck', exclude_polygons_count: excludePolygons.length, cost_lines_count: costLines.length, ...(timings ? { timings_ms: timings } : {}) },
  };
}

const SCOPE_PT: Record<string, string> = { national: 'nacional', state: 'estadual', municipal: 'municipal' };

/**
 * A rota toca São Paulo capital? Origem ou destino no município (malha do IBGE) ou a linha cruza uma zona que vale
 * "exceto feriados" (ZMRC, rodízio, perigosos: todas na capital). Origem e destino fora da malha (ou a busca falhou):
 * sim, o comportamento antigo (aviso de SP para toda rota).
 */
export function routeTouchesSaoPaulo(ends: (Municipio | null)[], zones: ZoneRow[], line: GeoJSON.Feature<GeoJSON.LineString>): boolean {
  if (!ends.some(Boolean)) return true;
  if (ends.some((m) => m?.ibge === SAO_PAULO_IBGE)) return true;
  const [lx0, ly0, lx1, ly1] = turf.bbox(line);
  return zones.some((z) => {
    if (!z.rules.skip_on_holidays) return false;
    const poly = turf.multiPolygon(z.geometry_full.coordinates);
    const [zx0, zy0, zx1, zy1] = turf.bbox(poly);
    if (zx0 > lx1 || zx1 < lx0 || zy0 > ly1 || zy1 < ly0) return false;
    return turf.booleanIntersects(line, poly);
  });
}

/**
 * Avisos de feriado da rota.
 * - 'holiday': feriados do dia de saída no calendário de São Paulo capital (`spDay` = legalDayInfo(at)). Rota que toca a
 *   capital (`spCapital`): o primeiro deles, com o efeito nas zonas da capital. Fora dela, só o nacional, sem falar de
 *   SP (o 9/7 paulista e os municipais da capital não valem no Rio).
 * - 'holiday_local': estaduais e municipais do município da origem (dia da saída) e do destino (dia da chegada
 *   prevista; nesse dia, também o nacional), com a norma. Não repete o que já saiu no 'holiday'.
 */
export function holidayWarnings(spDay: Holiday[], spCapital: boolean, local: EndpointHolidays[]): Warning[] {
  const out: Warning[] = [];
  const shown = spDay.filter((h) => spCapital || h.scope === 'national');
  if (shown.length) {
    out.push({ code: 'holiday', severity: 'info', message: spCapital
      ? `Feriado (${shown[0].name}): ZMRC, rodízio e restrição de perigosos em SP não se aplicam; rodovias podem ter restrição de feriado.`
      : `Feriado nacional (${shown[0].name}): regras locais que valem "exceto feriados" não se aplicam nesse dia; rodovias podem ter restrição de feriado.` });
  }
  out.push(...holidayLocalWarnings(local, shown));
  return out;
}

/**
 * Aviso 'holiday_local': feriado do município da origem/destino (calendar.endpointHolidays), com a norma e o dia
 * avaliado (o da chegada prevista, para o destino). Pula o que já está em `already` (o que saiu no aviso 'holiday').
 */
export function holidayLocalWarnings(list: EndpointHolidays[], already: Holiday[]): Warning[] {
  const seen = new Set(already.map((h) => h.id).filter(Boolean));
  const out: Warning[] = [];
  for (const e of list) {
    const hs = e.holidays.filter((h) => !h.id || !seen.has(h.id));
    if (!hs.length) continue;
    const pontos = e.pontos.join(' e ') + (e.chegada ? ', na chegada prevista' : '');
    const where = `${e.municipio.nome}/${e.municipio.uf} (${pontos})`;
    const dia = DateTime.fromISO(e.day).toFormat('dd/LL/yyyy');
    const what = hs.map((h) => `${h.name} — feriado ${SCOPE_PT[h.scope] ?? h.scope}${h.legal_basis ? ` (${h.legal_basis})` : ''}`).join('; ');
    out.push({ code: 'holiday_local', severity: 'info', id: `${e.municipio.ibge}:${e.day}`,
      message: `Feriado em ${where} em ${dia}: ${what}. Regras locais que valem "exceto feriados" não se aplicam nesse dia; rodovias podem ter restrição de feriado.` });
  }
  return out;
}

export function describeReport(r: { type: string; value_num: number | null }): string {
  const labels: Record<string, string> = {
    low_clearance: 'viaduto baixo', weight_limit: 'limite de peso', length_limit: 'limite de comprimento',
    truck_ban: 'proibido caminhão', hazmat_ban: 'proibido carga perigosa', road_closed: 'via interditada',
    steep_grade: 'subida íngreme', radar_movel: 'radar móvel', blitz: 'blitz',
  };
  const unit = r.type === 'weight_limit' || r.type === 'steep_grade' ? 't' : 'm';
  return `${labels[r.type] ?? r.type}${r.value_num != null ? ` ${String(r.value_num).replace('.', ',')} ${unit}` : ''}`;
}

/** Medição de tempo por etapa/camada (só com ROUTE_TIMINGS=1; vai em valhalla.timings_ms e no log). */
const TIMINGS = process.env.ROUTE_TIMINGS === '1';
/** Tempo máximo de cada camada por etapa (ms). Uma camada que não termina vira aviso, e a rota sai sem ela. */
const LAYER_PRE_TIMEOUT_MS = Number(process.env.LAYER_PRE_TIMEOUT_MS ?? 20_000);
const LAYER_POST_TIMEOUT_MS = Number(process.env.LAYER_POST_TIMEOUT_MS ?? 25_000);
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, rej) => { timer = setTimeout(() => {
    console.warn(`[rota] ${label} passou de ${ms} ms e foi ignorada nesta rota`);
    rej(new Error(`tempo esgotado (${Math.round(ms / 1000)} s)`));
  }, ms); });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}
async function timed<T>(t: Record<string, number> | null, key: string, fn: () => Promise<T>): Promise<T> {
  const ms = key.startsWith('post:') ? LAYER_POST_TIMEOUT_MS : key.startsWith('pre:') ? LAYER_PRE_TIMEOUT_MS : 0;
  if (ms) { const inner = fn; fn = () => withTimeout(inner(), ms, `camada ${key}`); }
  if (!t) return fn();
  const t0 = performance.now();
  try { return await fn(); } finally { t[key] = Math.round((t[key] ?? 0) + performance.now() - t0); }
}

/** Trechos penalizados que já falharam no edge walk do Valhalla (por processo; somem num restart ou tileset novo). */
const BAD_COST_LINES = new Set<string>();
function costLineKey(c: LayerCostLine): string {
  const a = c.coordinates[0], b = c.coordinates[c.coordinates.length - 1];
  return `${c.item.layer}|${c.item.id}|${c.coordinates.length}|${a?.join(',')}|${b?.join(',')}`;
}
function isEdgeWalkError(e: unknown): boolean {
  return /edge walk/i.test(String((e as Error)?.message ?? ''));
}
/** Busca binária: devolve as linhas que, sozinhas, fazem o Valhalla recusar o pedido por edge walk. */
async function findBadCostLines(lines: LayerCostLine[], attempt: (ls: LayerCostLine[]) => Promise<unknown>): Promise<LayerCostLine[]> {
  const ok = async (ls: LayerCostLine[]) => {
    try { await attempt(ls); return true; } catch (e) { if (isEdgeWalkError(e)) return false; return true; } // sem rota etc. não é culpa da linha
  };
  const rec = async (ls: LayerCostLine[]): Promise<LayerCostLine[]> => {
    if (!ls.length || await ok(ls)) return [];
    if (ls.length === 1) return ls;
    const mid = ls.length >> 1;
    return [...await rec(ls.slice(0, mid)), ...await rec(ls.slice(mid))];
  };
  return rec(lines);
}
function noteDroppedLines(bad: LayerCostLine[], warnings: Warning[]) {
  const byLayer = new Map<string, LayerCostLine[]>();
  for (const b of bad) byLayer.set(b.item.layer, [...(byLayer.get(b.item.layer) ?? []), b]);
  for (const [layer, ls] of byLayer) {
    console.warn(`[rota] ${ls.length} trecho(s) da camada ${layer} não casam com o grafo do Valhalla e foram ignorados: ${ls.slice(0, 5).map((l) => l.item.id).join(', ')}`);
    warnings.push({ code: 'cost_line_ignored', layer, severity: 'info',
      message: `${ls.length} trecho(s) da camada "${layer}" não casaram com o mapa e não foram considerados nesta rota (${ls.slice(0, 3).map((l) => l.item.name ?? l.item.id).join('; ')}).` });
  }
}

function closeRing(r: [number, number][]): [number, number][] {
  if (!r.length) return r;
  const [a, b] = [r[0], r[r.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a];
}
export type { LayerItem };

/**
 * Confere uma rota que NÃO veio do BrasaWay (ex.: a de um GPS de carro) contra as mesmas restrições que a rota legal
 * evitaria para este veículo e horário: zonas, reportes que bloqueiam e camadas (exclusões e trechos restritos).
 * Usado pela simulação comparativa (rota /api/sim, só com SIM_ENDPOINTS=1).
 */
export async function evaluateLine(req: RouteRequest, coordinates: [number, number][]) {
  const { vehicle, departureLocal, exclusions, costLines, warnings } = await prepareRestrictions(req);
  const line = turf.lineString(coordinates);
  const crossed: AvoidedItem[] = [];
  for (const ex of exclusions) if (intersects(line, ex)) crossed.push(ex.item);
  for (const cl of costLines) if (usesCostLine(line, cl)) crossed.push(cl.item);
  const seen = new Set<string>();
  const items = crossed.filter((a) => { const k = `${a.kind}:${a.layer ?? ''}:${a.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { departure_at: departureLocal, vehicle, crossed: items, endpoint_warnings: warnings.filter((w) => /zone/.test(w.code)) };
}
