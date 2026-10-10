import { DateTime } from 'luxon';
import { query } from '../db.js';
import { env } from '../config.js';

export interface Holiday { name: string; scope: string; legal_basis?: string | null }
export interface Suspension { scope: string; applies_to_heavy: boolean; description: string | null; period?: string | null; source_url?: string | null; raw_text?: string | null }

export interface LegalDayInfo {
  /** feriado (nacional, estadual SP ou municipal do município informado) */
  holiday: Holiday | null;
  /** todos os feriados do dia (ex.: 20/11 é nacional e municipal em SP) */
  holidays: Holiday[];
  /** suspensões publicadas (CET) vigentes no instante */
  suspensions: Suspension[];
}

export const SAO_PAULO_IBGE = '3550308';

/**
 * Feriados e suspensões vigentes no instante `at` para o município (default: São Paulo).
 * Feriados: seed db/seed/0004_holidays.sql (scripts/gen-zones-seed.py). Suspensões: importers/sources/cet_suspensoes.py.
 * Falha de banco (tabela ausente) não derruba a rota: devolve dia comum.
 */
export async function legalDayInfo(at: Date, ibgeCode = SAO_PAULO_IBGE, uf = 'SP'): Promise<LegalDayInfo> {
  const day = DateTime.fromJSDate(at).setZone(env.tz).toISODate();
  const [h, s] = await Promise.all([
    query<Holiday>(
      `select name, scope, legal_basis from holidays
        where day = $1 and (scope = 'national' or (scope = 'state' and uf = $2) or (scope = 'municipal' and ibge_code = $3))
        order by case scope when 'national' then 1 when 'state' then 2 else 3 end`, [day, uf, ibgeCode])
      .catch(() => query<Holiday>(
        // banco sem a migration 0101 (sem legal_basis)
        `select name, scope from holidays
          where day = $1 and (scope = 'national' or (scope = 'state' and uf = $2) or (scope = 'municipal' and ibge_code = $3))`, [day, uf, ibgeCode]))
      .catch(() => ({ rows: [] as Holiday[] })),
    query<Suspension>(
      `select scope, applies_to_heavy, description, period, source_url, raw_text from rule_suspensions
        where ibge_code = $1 and starts_at <= $2 and ends_at > $2`, [ibgeCode, at.toISOString()])
      .catch(() => query<Suspension>(
        `select scope, applies_to_heavy, description from rule_suspensions
          where ibge_code = $1 and starts_at <= $2 and ends_at > $2`, [ibgeCode, at.toISOString()]))
      .catch(() => ({ rows: [] as Suspension[] })),
  ]);
  return { holiday: h.rows[0] ?? null, holidays: h.rows, suspensions: s.rows };
}
