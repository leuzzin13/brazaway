import pg from 'pg';
import { env } from './config.js';

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });
// Sem este handler, uma conexão ociosa que cai (Postgres reiniciando/em recuperação) emite 'error' sem ouvinte e derruba
// o processo inteiro da API. O pool descarta a conexão e abre outra na próxima consulta.
pool.on('error', (err) => { console.error(`[db] conexão ociosa com o Postgres caiu: ${err.message}`); });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}
