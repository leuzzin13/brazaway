import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { env } from '../config.js';
import type { RouteRequest } from '../schemas.js';
import { resolveVehicle } from './vehicle.js';
import * as valhalla from './valhalla.js';
import { NoRouteError, type Ring } from './valhalla.js';
import { activeReportsInBbox, blockingReports, reportToRing, type ReportRow } from './restrictions.js';
import { activeZones, describeWindows, pointInZone, zoneApplies, zoneRings, type ZoneRow } from './zones.js';
import { legalDayInfo } from './calendar.js';
import { drivingPlan, restStopsAlongRoute, type DrivingPlan, type RestStop } from './restStops.js';
import { loadLayers } from '../layers/index.js';
import type { LayerCostLine, LayerItem, LayerWarning, RouteCtx, RouteGeom, RouteLine } from '../layers/types.js';

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
export interface Warning { code: string; message: string; report_id?: string; zone_id?: string; layer?: string; severity?: 'info' | 'warn' | 'danger'; lat?: number; lon?: number; id?: string }

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
  /** resultado de cada camada de dados (resumo + dados próprios) */
  layers: Record<string, { label: string; group: string; summary?: string[]; data?: unknown }>;
  valhalla: { costing: 'truck'; exclude_polygons_count: number; cost_lines_count: number };
}

export class RouteBlockedError extends Error {
  statusCode = 409;
  constructor(public blocked_by: AvoidedItem[], message: string) { super(message); }
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
 * Trecho contíguo da rota (do 1º ao último segmento) que toca o bbox da linha com folga de ~30 m. Fora dele nenhum
 * ponto da rota fica a até 15 m da linha, então a checagem de uso dá o mesmo resultado olhando só ali — e não percorre
 * a rota inteira (milhares de pontos) para cada uma das centenas de linhas de custo. null = rota longe da linha.
 */
function routeNearLine(route: GeoJSON.Feature<GeoJSON.LineString>, coords: [number, number][], pad = 0.0003): GeoJSON.Feature<GeoJSON.LineString> | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of coords) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const rc = route.geometry.coordinates;
  let first = -1, last = -1;
  for (let i = 0; i < rc.length - 1; i++) {
    const a = rc[i], b = rc[i + 1];
    if (Math.max(a[0], b[0]) >= x0 && Math.min(a[0], b[0]) <= x1 && Math.max(a[1], b[1]) >= y0 && Math.min(a[1], b[1]) <= y1) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  return turf.lineString(rc.slice(first, last + 2));
}

/**
 * A rota usa o trecho penalizado NO MESMO SENTIDO? (linhas de mão única ou penalizadas só num sentido:
 * a rota que passa pela pista contrária não "usa" o trecho). Amostra pontos da linha que ficam perto da rota e
 * compara o rumo local da linha com o rumo da rota no ponto mais próximo (diferença < 90°).
 */
function usesCostLine(route: GeoJSON.Feature<GeoJSON.LineString>, cl: LayerCostLine): boolean {
  const coords = cl.coordinates;
  if (coords.length < 2) return overlapRatio(route, coords) >= 0.5;
  const sub = routeNearLine(route, coords);
  if (!sub) return false;
  const step = Math.max(1, Math.ceil((coords.length - 1) / 30));
  let near = 0, same = 0, total = 0;
  for (let i = 0; i < coords.length - 1; i += step) {
    total++;
    const a = coords[i], b = coords[i + 1];
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const np = turf.nearestPointOnLine(sub, turf.point(mid), { units: 'meters' });
    if ((np.properties.dist ?? Infinity) > 15) continue;
    near++;
    const idx = Math.min(np.properties.index ?? 0, sub.geometry.coordinates.length - 2);
    const r0 = sub.geometry.coordinates[idx], r1 = sub.geometry.coordinates[idx + 1];
    const bl = turf.bearing(turf.point(a), turf.point(b));
    const br = turf.bearing(turf.point(r0 as [number, number]), turf.point(r1 as [number, number]));
    const diff = Math.abs(((bl - br + 540) % 360) - 180);
    if (diff < 90) same++;
  }
  if (!total || near / total < 0.5) return false;
  return same / near >= 0.5;
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

export async function computeRoute(req: RouteRequest): Promise<RouteResponse> {
  const vehicle = resolveVehicle(req.vehicle);
  const dep = req.departure_at
    ? DateTime.fromISO(req.departure_at, { zone: env.tz })
    : DateTime.now().setZone(env.tz);
  if (!dep.isValid) throw Object.assign(new Error('departure_at inválido (use YYYY-MM-DDTHH:mm)'), { statusCode: 422 });
  const departureLocal = dep.toFormat("yyyy-LL-dd'T'HH:mm");
  const at = dep.toJSDate();

  const warnings: Warning[] = [];
  const exclusions: Exclusion[] = [];

  // 1) Zonas de restrição por horário (só horário de saída — limitação documentada)
  const [zones, dayInfo] = await Promise.all([activeZones(), legalDayInfo(at)]);
  if (dayInfo.holiday) warnings.push({ code: 'holiday', severity: 'info', message: `Feriado (${dayInfo.holiday.name}): ZMRC, rodízio e restrição de perigosos em SP não se aplicam; rodovias podem ter restrição de feriado.` });
  for (const z of zones) {
    if (!zoneApplies(z.rules, vehicle, at, dayInfo)) continue;
    const oIn = pointInZone(z, req.origin);
    const dIn = pointInZone(z, req.destination);
    if (oIn || dIn) {
      warnings.push({
        code: oIn && dIn ? 'origin_and_destination_in_zone' : oIn ? 'origin_in_zone' : 'destination_in_zone',
        zone_id: z.id,
        message: `${oIn && dIn ? 'Origem e destino estão' : oIn ? 'Origem está' : 'Destino está'} dentro de "${z.name}" (${describeWindows(z.rules)}); a zona NÃO foi excluída da rota. Verifique autorização/exceção.`,
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
  await Promise.all(layers.map(async (l) => {
    try {
      if (l.exclusions) {
        for (const ex of await l.exclusions(ctx)) {
          const poly = ex.rings.length === 1 ? turf.polygon([closeRing(ex.rings[0])]) : turf.multiPolygon(ex.rings.map((r) => [closeRing(r)]));
          exclusions.push({ item: ex.item, rings: ex.rings, polygon: poly });
        }
      }
      if (l.costLines) costLines.push(...(await l.costLines(ctx)));
    } catch (err) {
      warnings.push({ code: 'layer_error', layer: l.meta.id, severity: 'info', message: `Camada "${l.meta.label}" indisponível nesta rota: ${(err as Error).message}` });
    }
  }));

  const excludePolygons = exclusions.flatMap((e) => e.rings);
  const base = { origin: req.origin, destination: req.destination, vehicle, departureLocal };
  const restrictedOpts = { ...base, excludePolygons, costLines: costLines.map((c) => ({ coordinates: c.coordinates, factor: c.factor })) };
  const hasRestrictions = exclusions.length > 0 || costLines.length > 0;
  let freeCache: Promise<valhalla.ValhallaRouteResult | null> | null = null;
  const freeRoute = () => (freeCache ??= valhalla.route(base).catch(() => null));

  // 3) Rota restrita
  let restricted: valhalla.ValhallaRouteResult;
  try {
    restricted = await valhalla.route(restrictedOpts);
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
    throw new RouteBlockedError(
      blockedBy,
      blockedBy.length
        ? `Sem rota viável para este veículo: bloqueado por ${names.join(', ')}.`
        : `Sem rota viável: ${e.valhallaMessage}. Verifique se origem/destino estão sobre vias acessíveis a caminhões.`,
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

  // 6) Pontos de descanso ao longo da rota + plano de direção (Lei 13.103)
  let restStops: RestStop[] = [];
  try { restStops = await restStopsAlongRoute(line.geometry, restricted.distance_km, restricted.duration_s, undefined, { at, employment: vehicle.employment }); } catch { /* tabela vazia/erro: segue sem */ }
  const plan = drivingPlan(restricted.duration_s, restStops);
  for (const n of plan.notes) warnings.push({ code: 'driving_time', message: n });
  for (const sgt of plan.suggested_stops) if (!sgt.stop) warnings.push({ code: 'no_rest_stop', message: sgt.message });

  // 7) Anotações das camadas (pedágio, OAEs, acidentes, roubo de carga, relevo...)
  const routeGeom: RouteGeom = { line, distance_km: restricted.distance_km, duration_s: restricted.duration_s, free: freeGeom };
  const layerOut: RouteResponse['layers'] = {};
  await Promise.all(layers.map(async (l) => {
    if (!l.annotate) return;
    try {
      const a = await l.annotate(ctx, routeGeom);
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
    rest_stops: restStops,
    driving_plan: plan,
    layers: layerOut,
    valhalla: { costing: 'truck', exclude_polygons_count: excludePolygons.length, cost_lines_count: costLines.length },
  };
}

export function describeReport(r: { type: string; value_num: number | null }): string {
  const labels: Record<string, string> = {
    low_clearance: 'viaduto baixo', weight_limit: 'limite de peso', length_limit: 'limite de comprimento',
    truck_ban: 'proibido caminhão', hazmat_ban: 'proibido carga perigosa', road_closed: 'via interditada',
    steep_grade: 'subida íngreme',
  };
  const unit = r.type === 'weight_limit' || r.type === 'steep_grade' ? 't' : 'm';
  return `${labels[r.type] ?? r.type}${r.value_num != null ? ` ${String(r.value_num).replace('.', ',')} ${unit}` : ''}`;
}

function closeRing(r: [number, number][]): [number, number][] {
  if (!r.length) return r;
  const [a, b] = [r[0], r[r.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a];
}
export type { LayerItem };
