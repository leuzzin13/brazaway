import * as turf from '@turf/turf';
import { query } from '../db.js';
import { env } from '../config.js';
import { DateTime } from 'luxon';
import { isVucSP, type Vehicle } from './vehicle.js';
import type { Ring } from './valhalla.js';
import type { ReportType } from '../schemas.js';

export interface ReportRow {
  id: string;
  type: ReportType;
  geometry: GeoJSON.Point | GeoJSON.LineString;
  value_num: number | null;
  time_window: unknown;
  note: string | null;
  score: number;
  status: string;
  created_at: string;
}

const SELECT = `select id, type, ST_AsGeoJSON(geom)::json as geometry, value_num::float as value_num,
  time_window, note, score, status, created_at`;

/** Reportes ativos que bloqueiam ESTE veículo no horário informado (regras na função SQL). */
export async function blockingReports(v: Vehicle, at: Date): Promise<ReportRow[]> {
  await query('select expire_stale_road_closed()');
  // "proibido caminhão" não vale para VUC, mas só para o VUC que se enquadra (medidas e idade no ano da viagem) e tem AETC:
  // sem isso ele é caminhão comum (Portaria SMT.GAB 137/2018 art. 18), como na ZMRC e no rodízio (zones.ts).
  const vuc = isVucSP(v, DateTime.fromJSDate(at).setZone(env.tz).year) && !!v.has_aetc;
  const r = await query<ReportRow>(
    `${SELECT} from active_reports_for_vehicle($1,$2,$3,$4,$5,$6) r`,
    [v.height_m, v.weight_t, v.length_m, v.hazmat, vuc, at.toISOString()],
  );
  return r.rows;
}

/** Reportes ativos (qualquer tipo) dentro de um bbox, para avisos de proximidade. */
export async function activeReportsInBbox(bbox: [number, number, number, number]): Promise<ReportRow[]> {
  const r = await query<ReportRow>(
    `${SELECT} from reports r where status = 'active' and geom && ST_MakeEnvelope($1,$2,$3,$4,4326)`,
    bbox,
  );
  return r.rows;
}

/** Buffer pequeno em volta do ponto/trecho → anel exterior [lon,lat][] para exclude_polygons. */
export function reportToRing(r: ReportRow, bufferM = env.reportBufferM): Ring {
  const feature = turf.feature(r.geometry);
  const buffered = turf.buffer(feature, bufferM, { units: 'meters', steps: 8 });
  if (!buffered) throw new Error(`Não foi possível gerar buffer do reporte ${r.id}`);
  const coords = buffered.geometry.type === 'Polygon'
    ? buffered.geometry.coordinates[0]
    : buffered.geometry.coordinates[0][0];
  return coords.map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))] as [number, number]);
}
