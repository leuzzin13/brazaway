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

// ---------------------------------------------------------------------------------------------------------------
// Valhalla com elevação (camada "relevo"). Funções extras com URL explícita: o Valhalla principal (VALHALLA_URL)
// pode estar sem elevação; o de elevação roda à parte (VALHALLA_ELEV_URL, default http://localhost:8003).

/** Codifica [lon, lat][] em polyline de precisão 1e6 (formato do Valhalla). */
export function encodePolyline6(coords: [number, number][]): string {
  let out = '';
  let pLat = 0, pLon = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) { out += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
    out += String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of coords) {
    const iLat = Math.round(lat * 1e6), iLon = Math.round(lon * 1e6);
    enc(iLat - pLat); enc(iLon - pLon);
    pLat = iLat; pLon = iLon;
  }
  return out;
}

async function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; json: any }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

export interface TraceAttributesAtOpts {
  /** edge_walk (rápido, exige a mesma malha do Valhalla que gerou a rota) ou map_snap (tolerante) */
  shapeMatch?: 'edge_walk' | 'map_snap';
  timeoutMs?: number;
}

/**
 * trace_attributes num Valhalla escolhido (ex.: o de elevação). Atributos de rampa no 3.9.1:
 * edge.max_upward_grade / edge.max_downward_grade (%, inteiro arredondado para cima; -500 = sem elevação),
 * edge.weighted_grade (%), edge.mean_elevation (m), edge.length (km), edge.way_id, edge.bridge, edge.tunnel,
 * edge.begin_shape_index / edge.end_shape_index (índices no `shape` devolvido).
 */
export async function traceAttributesAt(
  baseUrl: string, coordinates: [number, number][], vehicle: Vehicle, filterAttributes: string[], opts: TraceAttributesAtOpts = {},
): Promise<any> {
  const body = {
    encoded_polyline: encodePolyline6(coordinates),
    costing: 'truck',
    shape_match: opts.shapeMatch ?? 'edge_walk',
    costing_options: { truck: { height: vehicle.height_m, width: vehicle.width_m, length: vehicle.length_m, weight: vehicle.weight_t } },
    filters: { attributes: filterAttributes, action: 'include' },
  };
  const r = await postJson(`${baseUrl}/trace_attributes`, body, opts.timeoutMs ?? 15000);
  if (!r.ok) throw Object.assign(new Error(`Valhalla trace_attributes ${r.status}: ${r.json?.error ?? ''}`), { statusCode: 502, valhallaCode: r.json?.error_code });
  return r.json;
}

/**
 * Perfil de altitude (POST /height) ao longo de uma linha: devolve [distância_m, altitude_m][]
 * reamostrado a cada `resampleDistance` metros (mínimo do serviço: 10 m). Altitude null = sem dado (mar/fora do DEM).
 */
export async function heightProfileAt(
  baseUrl: string, coordinates: [number, number][], opts: { resampleDistance?: number; timeoutMs?: number } = {},
): Promise<[number, number | null][]> {
  const body = { encoded_polyline: encodePolyline6(coordinates), range: true, resample_distance: opts.resampleDistance ?? 30, height_precision: 1 };
  const r = await postJson(`${baseUrl}/height`, body, opts.timeoutMs ?? 15000);
  if (!r.ok) throw Object.assign(new Error(`Valhalla height ${r.status}: ${r.json?.error ?? ''}`), { statusCode: 502 });
  return (r.json.range_height ?? []) as [number, number | null][];
}

/** Altitude em pontos soltos (POST /height). null = sem dado (Valhalla sem DEM ou fora da cobertura). */
export async function heightAt(baseUrl: string, points: { lat: number; lon: number }[], timeoutMs = 3000): Promise<(number | null)[]> {
  const r = await postJson(`${baseUrl}/height`, { shape: points.map((p) => ({ lat: p.lat, lon: p.lon })) }, timeoutMs);
  if (!r.ok) throw Object.assign(new Error(`Valhalla height ${r.status}: ${r.json?.error ?? ''}`), { statusCode: 502 });
  return (r.json.height ?? []) as (number | null)[];
}
