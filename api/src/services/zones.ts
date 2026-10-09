import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { query } from '../db.js';
import { env } from '../config.js';
import type { Vehicle } from './vehicle.js';
import type { Ring } from './valhalla.js';

export interface ZoneWindow { days: number[]; from: string; to: string }
export interface ZoneRules {
  windows: ZoneWindow[];
  exceptions?: string[];              // ex.: ["is_vuc"], ["vuc_aetc", "cargo_perishable", "powertrain_electric"]
  /** a regra não vale em feriados (ZMRC, rodízio e perigosos em SP: "exceto feriados") */
  skip_on_holidays?: boolean;
  /** escopo usado para casar com rule_suspensions da CET ('rodizio' | 'zmrc' | 'zmrf' | 'hazmat') */
  suspension_scope?: string;
  /** só vale para veículo transportando produto perigoso */
  hazmat_only?: boolean;
  /** Rodízio: dígitos finais de placa proibidos por dia ISO (1=seg). Se presente, a zona só vale para esses dígitos. */
  plate_rule?: { digits_by_day: Record<string, number[]> };
}
export interface ZoneRow {
  id: string;
  name: string;
  rules: ZoneRules;
  source: string;
  /** Polígono recuado INSET_M para dentro e simplificado: vai para o Valhalla (exclude_polygons). */
  geometry: GeoJSON.MultiPolygon;
  /** Polígono recuado sem simplificação: usado nos testes de interseção/ponto-dentro. */
  geometry_full: GeoJSON.MultiPolygon;
}

/** Recuo (m) para dentro: as vias que formam o contorno da zona (marginais, avenidas-limite)
 *  continuam liberadas e não entram como "evitadas" por falso positivo. */
export const ZONE_INSET_M = 15;

export async function activeZones(simplifyTolerance = 0.0001): Promise<ZoneRow[]> {
  const r = await query<ZoneRow>(
    `with z as (
       select id, name, rules, source, ST_Multi(ST_Buffer(geom::geography, -($2::float))::geometry) as g
         from restriction_zones where active)
     select id, name, rules, source,
            ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(g, $1)))::json as geometry,
            ST_AsGeoJSON(g)::json as geometry_full
       from z where not ST_IsEmpty(g)`,
    [simplifyTolerance, ZONE_INSET_M],
  );
  return r.rows;
}

/** Geometria original (sem recuo) para exibição no mapa. */
export async function zonesForDisplay(simplifyTolerance = 0.0001) {
  const r = await query<Omit<ZoneRow, 'geometry_full'>>(
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
export interface ZoneDayCtx {
  holiday?: { name: string } | null;
  suspensions?: { scope: string; applies_to_heavy: boolean }[];
}

/** Exceções suportadas em rules.exceptions. */
export function vehicleMatchesException(exc: string, v: Vehicle): boolean {
  switch (exc) {
    case 'is_vuc': return !!v.is_vuc;
    case 'vuc_aetc': return !!v.is_vuc && !!v.has_aetc;           // VUC só é liberado com AETC (Portaria SMT 137/2018)
    case 'cargo_perishable': return v.cargo_type === 'perishable';
    case 'powertrain_electric': return v.powertrain === 'electric' || v.powertrain === 'hybrid' || v.powertrain === 'hydrogen';
    default: return false;
  }
}

export function zoneApplies(rules: ZoneRules, v: Vehicle, at: Date, day: ZoneDayCtx = {}): boolean {
  if (rules.hazmat_only && !v.hazmat) return false;
  if (rules.exceptions?.some((e) => vehicleMatchesException(e, v))) return false;
  if (rules.skip_on_holidays && day.holiday) return false;
  if (rules.suspension_scope && day.suspensions?.some((s) => (s.scope === rules.suspension_scope || s.scope === 'all') && !s.applies_to_heavy)) return false;
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
  return turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), turf.multiPolygon(z.geometry_full.coordinates));
}
