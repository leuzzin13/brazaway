import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Projetos novos do Supabase assinam o access token com ES256 (JWT signing keys); a API busca a chave pública no JWKS.
// Aqui um servidor local faz o papel do <SUPABASE_URL>/auth/v1/.well-known/jwks.json.
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const outra = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = () => Math.floor(Date.now() / 1000) + 3600;
function es256(claims: Record<string, unknown>, kid = 'k1', key: KeyObject = privateKey) {
  const h = b64({ alg: 'ES256', typ: 'JWT', kid });
  const p = b64(claims);
  return `${h}.${p}.${sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

let srv: http.Server;
let verifyJwt: (t: string) => Promise<{ sub?: string }>;

beforeAll(async () => {
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256', use: 'sig' };
  srv = http.createServer((_q, r) => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify({ keys: [jwk] })); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  vi.stubEnv('SUPABASE_URL', `http://127.0.0.1:${(srv.address() as AddressInfo).port}`);
  vi.resetModules();
  ({ verifyJwt } = await import('../../src/frota/auth.js'));
});
afterAll(() => { vi.unstubAllEnvs(); srv.close(); });

describe('token ES256 do Supabase (JWKS)', () => {
  it('aceita token assinado pela chave publicada', async () => {
    expect((await verifyJwt(es256({ sub: 'u1', role: 'authenticated', exp: exp() }))).sub).toBe('u1');
  });
  it('recusa assinatura de outra chave, kid desconhecido e token expirado', async () => {
    await expect(verifyJwt(es256({ sub: 'u1', role: 'authenticated', exp: exp() }, 'k1', outra))).rejects.toMatchObject({ statusCode: 401 });
    await expect(verifyJwt(es256({ sub: 'u1', role: 'authenticated', exp: exp() }, 'k9'))).rejects.toMatchObject({ statusCode: 401 });
    await expect(verifyJwt(es256({ sub: 'u1', role: 'authenticated', exp: 1 }))).rejects.toMatchObject({ statusCode: 401, message: 'token expirado' });
  });
});
