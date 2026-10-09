import { DateTime } from 'luxon';
import { query } from '../db.js';
import { env } from '../config.js';

export interface LegalDayInfo {
  /** feriado (nacional, estadual SP ou municipal do município informado) */
  holiday: { name: string; scope: string } | null;
  /** suspensões publicadas (CET) vigentes no instante */
  suspensions: { scope: string; applies_to_heavy: boolean; description: string | null }[];
}

/** Feriados e suspensões vigentes no instante `at` para o município (default: São Paulo). */
export async function legalDayInfo(at: Date, ibgeCode = '3550308', uf = 'SP'): Promise<LegalDayInfo> {
  const day = DateTime.fromJSDate(at).setZone(env.tz).toISODate();
  const [h, s] = await Promise.all([
    query<{ name: string; scope: string }>(
      `select name, scope from holidays
        where day = $1 and (scope = 'national' or (scope = 'state' and uf = $2) or (scope = 'municipal' and ibge_code = $3))
        order by scope limit 1`, [day, uf, ibgeCode]).catch(() => ({ rows: [] as { name: string; scope: string }[] })),
    query<{ scope: string; applies_to_heavy: boolean; description: string | null }>(
      `select scope, applies_to_heavy, description from rule_suspensions
        where ibge_code = $1 and starts_at <= $2 and ends_at > $2`, [ibgeCode, at.toISOString()]).catch(() => ({ rows: [] as any[] })),
  ]);
  return { holiday: h.rows[0] ?? null, suspensions: s.rows };
}
