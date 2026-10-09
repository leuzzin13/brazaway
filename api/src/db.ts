import pg from 'pg';
import { env } from './config.js';

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}
