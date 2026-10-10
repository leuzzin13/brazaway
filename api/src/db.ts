import pg from 'pg';
import { env } from './config.js';

// Tempos limite: statement_timeout (no servidor) corta consulta lenta; query_timeout (no cliente) cobre conexão
// morta no meio da consulta, que senão ficaria esperando para sempre e penduraria a rota.
export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 20,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  keepAlive: true,
  statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 20_000),
  query_timeout: Number(process.env.DB_QUERY_TIMEOUT_MS ?? 25_000),
});
// Sem este handler, uma conexão ociosa que cai (Postgres reiniciando/em recuperação) emite 'error' sem ouvinte e derruba
// o processo inteiro da API. O pool descarta a conexão e abre outra na próxima consulta.
pool.on('error', (err) => { console.error(`[db] conexão ociosa com o Postgres caiu: ${err.message}`); });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) {
  return pool.query<T>(text, params);
}
