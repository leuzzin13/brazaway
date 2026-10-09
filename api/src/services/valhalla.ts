import { env } from '../config.js';
import type { Vehicle } from './vehicle.js';
import { decodePolyline6 } from './polyline.js';

export type Ring = [number, number][]; // [lon, lat]

export interface ValhallaRouteResult {
  coordinates: [number, number][];
  distance_km: number;
  duration_s: number;
}

export class NoRouteError extends Error {
  constructor(public valhallaMessage: string, public errorCode?: number) {
    super(`Valhalla não encontrou rota: ${valhallaMessage}`);
  }
}

interface Opts {
  origin: { lat: number; lon: number };
  destination: { lat: number; lon: number };
  vehicle: Vehicle;
  departureLocal?: string; // "YYYY-MM-DDTHH:mm"
  excludePolygons?: Ring[];
  /** trechos penalizados (Valhalla linear_cost_factors): só as arestas sob a linha, não as que cruzam */
  costLines?: { coordinates: [number, number][]; factor: number }[];
}

/**
 * Chama POST /route com costing "truck". Nomes dos parâmetros conforme a doc
 * atual (api/route/api-reference): costing_options.truck.{height,width,length,
 * weight,axle_load,axle_count,hazmat}; exclude_polygons = [[[lon,lat],...],...];
 * date_time = {type:1 (departure), value:"YYYY-MM-DDThh:mm"}.
 */
export async function route(o: Opts): Promise<ValhallaRouteResult> {
  const v = o.vehicle;
  const body: Record<string, unknown> = {
    locations: [
      { lat: o.origin.lat, lon: o.origin.lon, type: 'break' },
      { lat: o.destination.lat, lon: o.destination.lon, type: 'break' },
    ],
    costing: 'truck',
    costing_options: {
      truck: {
        height: v.height_m,
        width: v.width_m,
        length: v.length_m,
        weight: v.weight_t,
        axle_load: v.axle_load_t,
        axle_count: v.axle_count,
        hazmat: v.hazmat,
      },
    },
    units: 'kilometers',
    language: 'pt-BR',
  };
  if (o.departureLocal) body.date_time = { type: 1, value: o.departureLocal };
  if (o.excludePolygons && o.excludePolygons.length) body.exclude_polygons = o.excludePolygons;
  if (o.costLines && o.costLines.length) {
    body.linear_cost_factors = o.costLines.map((c) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: c.coordinates },
      properties: { factor: c.factor },
    }));
  }

  const res = await fetch(`${env.valhallaUrl}/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as any;
  if (!res.ok) {
    const code: number | undefined = json?.error_code;
    const msg: string = json?.error ?? res.statusText;
    // 442 = No path could be found; 171/172 = sem via próxima dos pontos
    if (code === 442 || code === 171 || code === 172 || /no path|no suitable edges/i.test(msg)) {
      throw new NoRouteError(msg, code);
    }
    throw Object.assign(new Error(`Valhalla ${res.status}: ${msg}`), { statusCode: 502 });
  }
  const trip = json.trip;
  const coordinates: [number, number][] = [];
  for (const leg of trip.legs) coordinates.push(...decodePolyline6(leg.shape));
  return {
    coordinates,
    distance_km: Number(trip.summary.length),
    duration_s: Number(trip.summary.time),
  };
}

export async function status(): Promise<{ ok: boolean; detail?: unknown }> {
  try {
    const res = await fetch(`${env.valhallaUrl}/status`);
    const j = await res.json();
    return { ok: res.ok, detail: j };
  } catch (e) {
    return { ok: false, detail: String(e) };
  }
}

/** trace_attributes sobre uma geometria já calculada (ex.: pedágio por aresta, way_id, velocidade). */
export async function traceAttributes(coordinates: [number, number][], vehicle: Vehicle, filterAttributes: string[]): Promise<any> {
  const body = {
    shape: coordinates.map(([lon, lat]) => ({ lat, lon })),
    costing: 'truck',
    shape_match: 'map_snap',
    costing_options: { truck: { height: vehicle.height_m, width: vehicle.width_m, length: vehicle.length_m, weight: vehicle.weight_t } },
    filters: { attributes: filterAttributes, action: 'include' },
  };
  const res = await fetch(`${env.valhallaUrl}/trace_attributes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const json = (await res.json()) as any;
  if (!res.ok) throw Object.assign(new Error(`Valhalla trace_attributes ${res.status}: ${json?.error ?? ''}`), { statusCode: 502 });
  return json;
}
