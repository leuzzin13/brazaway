import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { query } from '../db.js';
import { env } from '../config.js';
import type { Vehicle } from './vehicle.js';
import type { Ring } from './valhalla.js';

export interface ZoneWindow { days: number[]; from: string; to: string }
export interface ZoneRules {
  windows: ZoneWindow[];
  exceptions?: string[];              // ex.: ["is_vuc"]
  /** Rodízio: dígitos finais de placa proibidos por dia ISO (1=seg). Se presente, a zona só vale para esses dígitos. */
  plate_rule?: { digits_by_day: Record<string, number[]> };
}
export interface ZoneRow {
  id: string;
  name: string;
  rules: ZoneRules;
  source: string;
  geometry: GeoJSON.MultiPolygon;
}

export async function activeZones(simplifyTolerance = 0.0003): Promise<ZoneRow[]> {
  const r = await query<ZoneRow>(
    `select id, name, rules, source,
            ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geom, $1)))::json as geometry
       from restriction_zones where active`,
    [simplifyTolerance],
  );
  return r.rows;
}

/** Descrição legível da janela (para avisos). */
export function describeWindows(rules: ZoneRules): string {
  const dayNames = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
  return rules.windows
    .map((w) => {
      const ds = w.days.length > 1 ? `${dayNames[w.days[0]]}–${dayNames[w.days[w.days.length - 1]]}` : dayNames[w.days[0]];
      return `${ds} ${w.from}–${w.to}`;
    })
    .join(', ');
}

/**
 * A zona restringe este veículo neste horário? (só horário de SAÍDA — limitação do MVP:
 * não calculamos a hora em que a rota efetivamente entra na zona.)
 */
export function zoneApplies(rules: ZoneRules, v: Vehicle, at: Date): boolean {
  if (rules.exceptions?.includes('is_vuc') && v.is_vuc) return false;
  const local = DateTime.fromJSDate(at).setZone(env.tz);
  const dow = local.weekday; // 1=seg..7=dom
  const hhmm = local.toFormat('HH:mm');
  if (rules.plate_rule) {
    if (v.plate_last_digit === undefined) return false; // sem placa informada não dá para aplicar rodízio
    const digits = rules.plate_rule.digits_by_day[String(dow)] ?? [];
    if (!digits.includes(v.plate_last_digit)) return false;
  }
  return rules.windows.some((w) => w.days.includes(dow) && hhmm >= w.from && hhmm < w.to);
}

export function zoneRings(z: ZoneRow): Ring[] {
  return z.geometry.coordinates.map((poly) => poly[0].map(([lon, lat]) => [lon, lat] as [number, number]));
}

export function pointInZone(z: ZoneRow, p: { lat: number; lon: number }): boolean {
  return turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), turf.multiPolygon(z.geometry.coordinates));
}
