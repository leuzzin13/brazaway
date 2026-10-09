import * as turf from '@turf/turf';
import { DateTime } from 'luxon';
import { query } from '../db.js';
import { env } from '../config.js';
import { isHazmatLocalOrOther, isTruck, isVucSP, type Vehicle } from './vehicle.js';
import type { Ring } from './valhalla.js';

export interface ZoneWindow { days: number[]; from: string; to: string }

/**
 * Exceção de uma zona. String = condição única (ver vehicleMatchesException). Objeto = todas as condições de `if`
 * precisam valer e, se houver `windows`, a exceção só vale dentro dessas janelas
 * (ex.: perecível com AETC na ZMRC só das 05h às 12h — Portaria SMT.GAB 137/2018 art. 32 I).
 */
export type ZoneException = string | { if: string[]; windows?: ZoneWindow[]; legal_basis?: string };

export interface ZoneRules {
  windows: ZoneWindow[];
  exceptions?: ZoneException[];
  /** a regra não vale em feriados (ZMRC, rodízio e perigosos em SP: "exceto feriados") */
  skip_on_holidays?: boolean;
  /** escopo usado para casar com rule_suspensions da CET ('rodizio' | 'zmrc' | 'zmrf' | 'hazmat') */
  suspension_scope?: string;
  /** só vale para veículo transportando produto perigoso */
  hazmat_only?: boolean;
  /** 'trucks' = só caminhões (PBT > 3,5 t); 'non_trucks' = só quem não é caminhão; ausente = todos */
  vehicle_scope?: 'trucks' | 'non_trucks';
  /** Rodízio: dígitos finais de placa proibidos por dia ISO (1=seg). Se presente, a zona só vale para esses dígitos. */
  plate_rule?: { digits_by_day: Record<string, number[]> };
  /** recuo (m) para dentro aplicado ao polígono; negativo = expande para fora. Default ZONE_INSET_M. */
  inset_m?: number;
  /** não desenhar no mapa (zonas auxiliares que repetem o polígono de outra) */
  hide_on_map?: boolean;
  /** norma e artigo de cada parte da regra */
  legal_basis?: string | string[];
}
export interface ZoneRow {
  id: string;
  name: string;
  rules: ZoneRules;
  source: string;
  /** Polígono recuado (rules.inset_m ou ZONE_INSET_M) e simplificado: vai para o Valhalla (exclude_polygons). */
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
       select id, name, rules, source,
              ST_Multi(ST_Buffer(geom::geography, -(coalesce((rules->>'inset_m')::float, $2::float)))::geometry) as g
         from restriction_zones where active)
     select id, name, rules, source,
            ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(g, $1)))::json as geometry,
            ST_AsGeoJSON(g)::json as geometry_full
       from z where not ST_IsEmpty(g)`,
    [simplifyTolerance, ZONE_INSET_M],
  );
  return r.rows;
}

/** Geometria original (sem recuo) para exibição no mapa. Zonas auxiliares (rules.hide_on_map) ficam de fora. */
export async function zonesForDisplay(simplifyTolerance = 0.0001) {
  const r = await query<Omit<ZoneRow, 'geometry_full'>>(
    `select id, name, rules, source,
            ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(geom, $1)))::json as geometry
       from restriction_zones where active and coalesce((rules->>'hide_on_map')::boolean, false) = false`,
    [simplifyTolerance],
  );
  return r.rows;
}

const DAY_NAMES = ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
function describeDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length > 2 && contiguous) return `${DAY_NAMES[sorted[0]]}–${DAY_NAMES[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => DAY_NAMES[d]).join(', ');
}

/** Descrição legível da janela (para avisos). */
export function describeWindows(rules: ZoneRules): string {
  // agrupa janelas com os mesmos dias: "seg–sex 07:00–10:00 e 17:00–20:00"
  const byDays = new Map<string, ZoneWindow[]>();
  for (const w of rules.windows) {
    const k = describeDays(w.days);
    byDays.set(k, [...(byDays.get(k) ?? []), w]);
  }
  const s = [...byDays.entries()].map(([d, ws]) => `${d} ${ws.map((w) => `${w.from}–${w.to}`).join(' e ')}`).join(', ');
  return rules.skip_on_holidays ? `${s}, exceto feriados` : s;
}

/**
 * Contexto legal do dia (feriado e suspensões publicadas). Limitação do MVP: a regra usa só o horário de SAÍDA;
 * não calculamos a hora em que a rota efetivamente entra na zona.
 */
export interface ZoneDayCtx {
  holiday?: { name: string } | null;
  suspensions?: { scope: string; applies_to_heavy: boolean }[];
}

/** Exceções suportadas em rules.exceptions (string ou itens de `if`). */
export function vehicleMatchesException(exc: string, v: Vehicle, at: Date = new Date()): boolean {
  const year = DateTime.fromJSDate(at).setZone(env.tz).year;
  switch (exc) {
    // VUC só é liberado com AETC (Portaria SMT.GAB 137/2018 art. 18; Portaria DSV.G 09/2019 art. 7º).
    // 'is_vuc' é o nome antigo: mantido como sinônimo para seeds antigos, com a mesma exigência de AETC.
    case 'is_vuc':
    case 'vuc_aetc': return isVucSP(v, year) && !!v.has_aetc;
    case 'vuc_sp': return isVucSP(v, year);
    case 'has_aetc': return !!v.has_aetc;
    case 'cargo_perishable': return v.cargo_type === 'perishable';
    // Decreto 58.584/2018 art. 3º IX a: elétrico, hidrogênio ou híbrido (GNV não é isento)
    case 'powertrain_electric': return v.powertrain === 'electric' || v.powertrain === 'hybrid' || v.powertrain === 'hydrogen';
    case 'hazmat_local_or_other': return isHazmatLocalOrOther(v);
    // "caminhões de até dois eixos traseiros" (Portaria 137/2018 art. 35): caminhão simples com até 3 eixos
    case 'rear_axles_le_2': return (v.vehicle_class ?? 'rigid') === 'rigid' && v.axle_count - 1 <= 2;
    // art. 35 §2º: caminhão-trator não é autorizado
    case 'not_tractor': return v.vehicle_class !== 'semitrailer' && v.vehicle_class !== 'cvc';
    default: return false;
  }
}

function inWindows(windows: ZoneWindow[], dow: number, hhmm: string): boolean {
  return windows.some((w) => w.days.includes(dow) && hhmm >= w.from && hhmm < w.to);
}

/** O veículo está isento da zona neste instante? */
export function vehicleExempt(rules: ZoneRules, v: Vehicle, at: Date): boolean {
  const local = DateTime.fromJSDate(at).setZone(env.tz);
  const dow = local.weekday;
  const hhmm = local.toFormat('HH:mm');
  return (rules.exceptions ?? []).some((e) => {
    if (typeof e === 'string') return vehicleMatchesException(e, v, at);
    if (!e.if?.length || !e.if.every((c) => vehicleMatchesException(c, v, at))) return false;
    return !e.windows?.length || inWindows(e.windows, dow, hhmm);
  });
}

export function zoneApplies(rules: ZoneRules, v: Vehicle, at: Date, day: ZoneDayCtx = {}): boolean {
  const truck = v.is_truck ?? isTruck(v);
  if (rules.vehicle_scope === 'trucks' && !truck) return false;
  if (rules.vehicle_scope === 'non_trucks' && truck) return false;
  if (rules.hazmat_only && !v.hazmat) return false;
  if (rules.skip_on_holidays && day.holiday) return false;
  // suspensão publicada (CET): só libera se NÃO estiver "mantido para veículos pesados"
  if (rules.suspension_scope && day.suspensions?.some((s) => (s.scope === rules.suspension_scope || s.scope === 'all') && !s.applies_to_heavy)) return false;
  const local = DateTime.fromJSDate(at).setZone(env.tz);
  const dow = local.weekday; // 1=seg..7=dom
  const hhmm = local.toFormat('HH:mm');
  if (rules.plate_rule) {
    if (v.plate_last_digit === undefined) return false; // sem placa informada não dá para aplicar rodízio
    const digits = rules.plate_rule.digits_by_day[String(dow)] ?? [];
    if (!digits.includes(v.plate_last_digit)) return false;
  }
  if (!inWindows(rules.windows, dow, hhmm)) return false;
  return !vehicleExempt(rules, v, at);
}

export function zoneRings(z: ZoneRow): Ring[] {
  return z.geometry.coordinates.map((poly) => poly[0].map(([lon, lat]) => [lon, lat] as [number, number]));
}

export function pointInZone(z: ZoneRow, p: { lat: number; lon: number }): boolean {
  return turf.booleanPointInPolygon(turf.point([p.lon, p.lat]), turf.multiPolygon(z.geometry_full.coordinates));
}
