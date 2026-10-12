import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { pool } from '../db.js';

/**
 * Autenticação e contexto de RLS da Frota.
 *
 * O cliente (app do motorista, painel) manda o access token do Supabase Auth em `Authorization: Bearer <jwt>`.
 * O token é HS256 assinado com o JWT secret do projeto (SUPABASE_JWT_SECRET). Cada requisição roda numa transação
 * com `set local role authenticated` e `request.jwt.claims` = claims do token: as políticas de RLS e as RPC do schema
 * `app` (db/migrations/0302, 0303) valem exatamente como no PostgREST do Supabase.
 *
 * Tokens de service_role (jobs, edge functions) rodam sem RLS (papel service_role).
 * Em desenvolvimento, sem SUPABASE_JWT_SECRET, usa FROTA_DEV_JWT_SECRET (padrão 'dev-secret-troque').
 */
export const JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? process.env.FROTA_DEV_JWT_SECRET ?? 'dev-secret-troque';

export type Claims = { sub?: string; role: 'authenticated' | 'service_role' | 'anon'; exp?: number; [k: string]: unknown };

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signJwt(claims: Claims, secret = JWT_SECRET, ttlS = 3600): string {
  const body = { iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlS, ...claims };
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify(body));
  const s = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${s}`;
}

export function verifyJwt(token: string, secret = JWT_SECRET): Claims {
  const parts = token.split('.');
  if (parts.length !== 3) throw httpError(401, 'token inválido');
  const [h, p, s] = parts;
  let header: { alg?: string };
  try { header = JSON.parse(Buffer.from(h, 'base64url').toString()); } catch { throw httpError(401, 'token inválido'); }
  if (header?.alg !== 'HS256') throw httpError(401, 'algoritmo de token não suportado');
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const got = Buffer.from(s, 'base64url');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw httpError(401, 'assinatura do token inválida');
  let claims: Claims;
  try { claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Claims; } catch { throw httpError(401, 'token inválido'); }
  if (!claims || typeof claims !== 'object') throw httpError(401, 'token inválido');
  if (claims.exp && claims.exp < Date.now() / 1000) throw httpError(401, 'token expirado');
  if (!['authenticated', 'service_role'].includes(claims.role)) throw httpError(401, 'papel do token não permitido');
  if (claims.role === 'authenticated' && !claims.sub) throw httpError(401, 'token sem usuário');
  return claims;
}

export function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

export function claimsOf(req: FastifyRequest): Claims {
  const a = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(a);
  if (!m) throw httpError(401, 'envie Authorization: Bearer <token>');
  return verifyJwt(m[1]);
}

/**
 * Roda `fn` numa transação com o papel e as claims do token (RLS ativa para authenticated).
 * Erros de permissão do banco (42501, RLS) viram 403; violação de regra de negócio das RPC (42501 com mensagem) também.
 */
export async function withRls<T>(claims: Claims, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
    await c.query(claims.role === 'service_role' ? 'set local role service_role' : 'set local role authenticated');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e: any) {
    await c.query('rollback').catch(() => {});
    if (e?.code === '42501') throw httpError(403, e.message);
    if (e?.code === '23505') throw httpError(409, e.detail ?? e.message);
    if (e?.code === '23503' || e?.code === '23514' || e?.code === '22P02' || e?.code === '22023') throw httpError(400, e.message);
    throw e;
  } finally {
    c.release();
  }
}

/** Atalho para rotas: autentica e roda com RLS. */
export async function asUser<T>(req: FastifyRequest, fn: (c: pg.PoolClient, claims: Claims) => Promise<T>): Promise<T> {
  const claims = claimsOf(req);
  return withRls(claims, (c) => fn(c, claims));
}

/** Só service_role (jobs). */
export function requireService(req: FastifyRequest, _reply: FastifyReply) {
  const claims = claimsOf(req);
  if (claims.role !== 'service_role') throw httpError(403, 'só service_role');
  return claims;
}
