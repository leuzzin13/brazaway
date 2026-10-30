import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Login no Supabase do Lovable Cloud e banco da Frota no Postgres da API: com FROTA_USUARIOS_EXTERNOS=1 o usuário do
// token entra no auth.users local no primeiro acesso, e a RLS passa a valer para ele como para qualquer outro.
const sub = randomUUID();
const email = `externo-${sub.slice(0, 8)}@teste.example`;
let withRls: typeof import('../../src/frota/auth.js').withRls;
let pool: typeof import('../../src/db.js').pool;

beforeAll(async () => {
  vi.stubEnv('FROTA_USUARIOS_EXTERNOS', '1');
  vi.resetModules();
  ({ withRls } = await import('../../src/frota/auth.js'));
  ({ pool } = await import('../../src/db.js'));
});
afterAll(async () => {
  await pool.query('delete from auth.users where id = $1', [sub]);
  await pool.end();
  vi.unstubAllEnvs();
});

describe('usuário de um Supabase externo', () => {
  it('é criado no auth.users local no primeiro acesso, com o e-mail do token', async () => {
    const claims = { sub, role: 'authenticated' as const, email: email.toUpperCase() };
    const uid = await withRls(claims, async (c) => (await c.query('select auth.uid() as u')).rows[0].u);
    expect(uid).toBe(sub);
    const r = await pool.query('select email from auth.users where id = $1', [sub]);
    expect(r.rows[0]?.email).toBe(email);
  });

  it('sem convite aceito não enxerga empresa nenhuma', async () => {
    const n = await withRls({ sub, role: 'authenticated' }, async (c) => (await c.query('select count(*)::int as n from companies')).rows[0].n);
    expect(n).toBe(0);
  });

  it('a linha fica mesmo quando a requisição falha', async () => {
    const outro = randomUUID();
    await expect(withRls({ sub: outro, role: 'authenticated' }, async (c) => { await c.query('select 1/0'); })).rejects.toThrow();
    const r = await pool.query('select 1 from auth.users where id = $1', [outro]);
    expect(r.rowCount).toBe(1);
    await pool.query('delete from auth.users where id = $1', [outro]);
  });
});
