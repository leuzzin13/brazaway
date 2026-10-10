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
/**
 * Remove vértices consecutivos repetidos (comparação exata, SEM arredondar: arredondar tira do eixo linhas que as
 * camadas validaram com mais casas, como as de altura_osm). As geometrias servidas pelo PostGIS com 6 casas podem trazer
 * vértices iguais depois do arredondamento delas, e o Valhalla recusa a linha inteira por isso.
 */
export function dedupeCoords(cs: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of cs) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

/** Velocidade máxima do caminhão (CTB art. 61, II, a/b: 90 km/h para os demais veículos em rodovia). */
export const TRUCK_TOP_SPEED_KMH = Number(process.env.TRUCK_TOP_SPEED_KMH ?? 90);

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
        // CTB art. 61: 90 km/h para "demais veículos" em rodovia sem placa (o padrão do Valhalla é 120)
        top_speed: TRUCK_TOP_SPEED_KMH,
      },
    },
    units: 'kilometers',
    language: 'pt-BR',
  };
  if (o.departureLocal) body.date_time = { type: 1, value: o.departureLocal };
  if (o.excludePolygons && o.excludePolygons.length) body.exclude_polygons = o.excludePolygons;
  if (o.costLines && o.costLines.length) {
    // As geometrias saem do PostGIS com 6 casas (ST_AsGeoJSON(geom, 6)); depois do arredondamento, vértices
    // consecutivos podem ficar iguais e o Valhalla recusa a linha ("Failed to edge walk line feature" → HTTP 400/502
    // na rota inteira). Deduplicamos e descartamos linhas que ficam com menos de 2 pontos.
    body.linear_cost_factors = o.costLines
      .map((c) => ({ coords: dedupeCoords(c.coordinates), factor: c.factor }))
      .filter((c) => c.coords.length >= 2)
      .map((c) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c.coords }, properties: { factor: c.factor } }));
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
  const distance_km = Number(trip.summary.length);
  let duration_s = Number(trip.summary.time);
  if (body.linear_cost_factors) {
    const t = await retime(trip.legs.map((l: { shape: string }) => l.shape), body, distance_km);
    if (t != null) duration_s = t;
  }
  return { coordinates, distance_km, duration_s };
}

/**
 * O Valhalla (3.9.1) aplica o `factor` dos linear_cost_factors também ao TEMPO das arestas, não só ao custo: quando a
 * rota não consegue evitar um trecho penalizado (origem/destino nele, sem alternativa), `trip.summary.time` explode
 * (ex.: VUC na VER, 14,6 km com factor 1000 → 16 507 s, contra 2 028 s re-cronometrando a mesma geometria). A duração
 * alimenta o ETA das camadas, o plano de direção (Lei 13.103) e o front, então re-cronometramos a geometria escolhida
 * com /trace_route (mesmo costing, mesmas opções e date_time, sem as penalidades). edge_walk sobre a shape devolvida
 * pelo próprio /route reproduz o tempo do /route sem penalidade (diferença < 0,1 s, ~10 ms); map_snap é o reserva
 * (limite de 200 km no serviço). Se os dois falharem, fica o tempo do /route (inflado) e um aviso no log.
 * Exportada para quem monta o próprio /route com linear_cost_factors (ex.: services/tollCost.ts).
 */
export async function retime(shapes: string[], routeBody: Record<string, unknown>, distanceKm: number): Promise<number | null> {
  // map_snap (HMM) em traçado longo é patológico no Valhalla: já levou 15 min num pedido que a API abandonou em 15 s,
  // prendendo uma thread do servidor e enfileirando as outras rotas. Só como reserva em rota curta.
  const modes: ('edge_walk' | 'map_snap')[] = distanceKm <= 20 ? ['edge_walk', 'map_snap'] : ['edge_walk'];
  for (const mode of modes) {
    try {
      let total = 0;
      for (const shape of shapes) {
        const r = await postJson(`${env.valhallaUrl}/trace_route`, {
          encoded_polyline: shape,
          shape_match: mode,
          costing: routeBody.costing,
          costing_options: routeBody.costing_options,
          ...(routeBody.date_time ? { date_time: routeBody.date_time } : {}),
          units: 'kilometers',
          directions_type: 'none',
        }, 15000);
        const t = Number(r.json?.trip?.summary?.time);
        if (!r.ok || !Number.isFinite(t)) throw new Error(r.json?.error ?? `HTTP ${r.status}`);
        total += t;
      }
      return total;
    } catch (e) {
      console.warn(`[valhalla] trace_route (${mode}) não re-cronometrou a rota com linear_cost_factors: ${(e as Error).message}`);
    }
  }
  return null;
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
