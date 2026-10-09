import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { env } from '../config.js';
import type { RouteRequest } from '../schemas.js';
import { resolveVehicle } from './vehicle.js';
import * as valhalla from './valhalla.js';
import { NoRouteError, type Ring } from './valhalla.js';
import { activeReportsInBbox, blockingReports, reportToRing, type ReportRow } from './restrictions.js';
import { activeZones, describeWindows, pointInZone, zoneApplies, zoneRings, type ZoneRow } from './zones.js';
import { drivingPlan, restStopsAlongRoute, type DrivingPlan, type RestStop } from './restStops.js';

export interface AvoidedItem {
  kind: 'report' | 'zone';
  id: string;
  type?: string;        // report type
  value_num?: number | null;
  name?: string;        // zone name
  rule?: string;        // zone window description
  lat?: number;
  lon?: number;
  note?: string | null;
}
export interface Warning { code: string; message: string; report_id?: string; zone_id?: string }

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
  valhalla: { costing: 'truck'; exclude_polygons_count: number };
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
  const zones = await activeZones();
  for (const z of zones) {
    if (!zoneApplies(z.rules, vehicle, at)) continue;
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

  const excludePolygons = exclusions.flatMap((e) => e.rings);
  const base = { origin: req.origin, destination: req.destination, vehicle, departureLocal };

  // 3) Rota restrita
  let restricted: valhalla.ValhallaRouteResult;
  try {
    restricted = await valhalla.route({ ...base, excludePolygons });
  } catch (e) {
    if (!(e instanceof NoRouteError)) throw e;
    // Descobrir quem bloqueou: rota livre e interseção com as exclusões
    let blockedBy: AvoidedItem[] = [];
    if (exclusions.length) {
      try {
        const free = await valhalla.route(base);
        const line = turf.lineString(free.coordinates);
        blockedBy = exclusions.filter((ex) => intersects(line, ex)).map((ex) => ex.item);
      } catch { /* sem rota nem livre */ }
    }
    const names = blockedBy.map((b) => (b.kind === 'zone' ? b.name : `${b.type}${b.value_num ? ` ${b.value_num}` : ''}`));
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
  if (exclusions.length) {
    try {
      const free = await valhalla.route(base);
      const freeLine = turf.lineString(free.coordinates);
      for (const ex of exclusions) {
        if (intersects(freeLine, ex) && !intersects(line, ex)) avoided.push(ex.item);
      }
    } catch { /* se a rota livre falhar, só não listamos "avoided" */ }
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
  try { restStops = await restStopsAlongRoute(line.geometry, restricted.distance_km, restricted.duration_s); } catch { /* tabela vazia/erro: segue sem */ }
  const plan = drivingPlan(restricted.duration_s, restStops);
  for (const n of plan.notes) warnings.push({ code: 'driving_time', message: n });
  for (const sgt of plan.suggested_stops) if (!sgt.stop) warnings.push({ code: 'no_rest_stop', message: sgt.message });

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
    valhalla: { costing: 'truck', exclude_polygons_count: excludePolygons.length },
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
