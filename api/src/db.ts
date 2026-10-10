import pg from 'pg';
import { env } from './config.js';

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });
// conexão ociosa derrubada (ex.: Postgres reiniciando): sem este handler o 'error' do pool derruba o processo da API
pool.on('error', (err) => console.error(`[db] conexão ociosa perdida: ${err.message}`));

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}
