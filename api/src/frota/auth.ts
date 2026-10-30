import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify, type JsonWebKey, type KeyObject } from 'node:crypto';
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
 *
 * Projetos novos do Supabase assinam com chave assimétrica (ES256/RS256, "JWT signing keys"): com SUPABASE_URL definido,
 * a chave pública vem de <SUPABASE_URL>/auth/v1/.well-known/jwks.json (cache de 10 min, recarregado se aparecer `kid` novo).
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

const SUPABASE_URL = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const JWKS_TTL_MS = 10 * 60_000;
let jwks: { at: number; keys: Map<string, KeyObject> } | null = null;

async function loadJwks(): Promise<Map<string, KeyObject>> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`JWKS ${r.status}`);
  const body = (await r.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const keys = new Map<string, KeyObject>();
  for (const k of body.keys ?? []) if (k.kid) keys.set(k.kid, createPublicKey({ key: k, format: 'jwk' }));
  jwks = { at: Date.now(), keys };
  return keys;
}

async function publicKey(kid: string | undefined): Promise<KeyObject> {
  if (!SUPABASE_URL) throw httpError(401, 'algoritmo de token não suportado (defina SUPABASE_URL para ES256/RS256)');
  if (!kid) throw httpError(401, 'token sem kid');
  let keys = jwks && Date.now() - jwks.at < JWKS_TTL_MS ? jwks.keys : null;
  if (!keys?.has(kid)) keys = await loadJwks().catch(() => { throw httpError(503, 'não foi possível obter as chaves do Supabase Auth'); });
  const k = keys.get(kid);
  if (!k) throw httpError(401, 'chave do token desconhecida');
  return k;
}

export async function verifyJwt(token: string, secret = JWT_SECRET): Promise<Claims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw httpError(401, 'token inválido');
  const [h, p, s] = parts;
  let header: { alg?: string; kid?: string };
  try { header = JSON.parse(Buffer.from(h, 'base64url').toString()); } catch { throw httpError(401, 'token inválido'); }
  const got = Buffer.from(s, 'base64url');
  if (header?.alg === 'HS256') {
    const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw httpError(401, 'assinatura do token inválida');
  } else if (header?.alg === 'ES256' || header?.alg === 'RS256') {
    const key = await publicKey(header.kid);
    const ok = cryptoVerify('sha256', Buffer.from(`${h}.${p}`), header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, got);
    if (!ok) throw httpError(401, 'assinatura do token inválida');
  } else {
    throw httpError(401, 'algoritmo de token não suportado');
  }
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

export async function claimsOf(req: FastifyRequest): Promise<Claims> {
  const a = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(a);
  if (!m) throw httpError(401, 'envie Authorization: Bearer <token>');
  return verifyJwt(m[1]);
}

/**
 * Login num Supabase de fora (ex.: o Lovable Cloud) com o banco da Frota no Postgres da API: o usuário do token não
 * existe no `auth.users` local (o da 0300), e as FKs de `company_members`/`invites` apontam para ele. Com
 * FROTA_USUARIOS_EXTERNOS=1 a API cria a linha no primeiro acesso (id e e-mail do token). Nunca ligue isso com o banco
 * dentro do próprio Supabase: lá o `auth.users` é do Supabase Auth.
 */
const USUARIOS_EXTERNOS = process.env.FROTA_USUARIOS_EXTERNOS === '1';
const usuariosConhecidos = new Set<string>();

async function garantirUsuario(c: pg.PoolClient, claims: Claims) {
  if (!USUARIOS_EXTERNOS || claims.role !== 'authenticated' || !claims.sub || usuariosConhecidos.has(claims.sub)) return;
  const email = typeof claims.email === 'string' && claims.email ? claims.email.toLowerCase() : null;
  const phone = typeof claims.phone === 'string' && claims.phone ? claims.phone : null;
  await c.query('insert into auth.users (id, email, phone) values ($1, $2, $3) on conflict do nothing', [claims.sub, email, phone]);
  const r = await c.query('select 1 from auth.users where id = $1', [claims.sub]);
  if (!r.rowCount) throw httpError(409, 'e-mail ou telefone já usado por outro usuário');
  usuariosConhecidos.add(claims.sub);
}

/**
 * Roda `fn` numa transação com o papel e as claims do token (RLS ativa para authenticated).
 * Erros de permissão do banco (42501, RLS) viram 403; violação de regra de negócio das RPC (42501 com mensagem) também.
 */
export async function withRls<T>(claims: Claims, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await garantirUsuario(c, claims); // fora da transação: a linha fica mesmo se a requisição falhar
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
  const claims = await claimsOf(req);
  return withRls(claims, (c) => fn(c, claims));
}

/** Só service_role (jobs). */
export async function requireService(req: FastifyRequest, _reply: FastifyReply) {
  const claims = await claimsOf(req);
  if (claims.role !== 'service_role') throw httpError(403, 'só service_role');
  return claims;
}
