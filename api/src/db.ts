import pg from 'pg';
import { env } from './config.js';

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });
// Erro num cliente ocioso (ex.: o Postgres reiniciou) é emitido no pool; sem este handler o Node derruba a API.
// O pool descarta o cliente e abre outro na próxima consulta.
pool.on('error', (err) => { console.error(`[db] cliente ocioso do pool perdeu a conexão: ${err.message}`); });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}
