import * as turf from '@turf/turf';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signJwt } from '../../src/frota/auth.js';
import { pool } from '../helpers.js';

/**
 * Trechos bloqueados pela empresa (/api/frota/trechos-bloqueados, migration 0405) e o efeito deles na rota, na
 * conferência de rota de fora (/api/sim/avaliar), na viagem planejada e no alerta ao vivo. Precisa da API (API_URL),
 * do Postgres com as migrations da Frota e do Valhalla:
 *   API_URL=http://localhost:3601 npx vitest run test/frota/bloqueios.test.ts
 * Cria empresas/usuários com ids próprios (prefixo b10c) no beforeAll, como superusuário, e apaga tudo no afterAll.
 */
const BASE = process.env.API_URL ?? 'http://localhost:3100';

const id = (n: number) => `b10c0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CO_A = id(1), CO_B = id(2);
const OWNER_A = id(11), MOT_A = id(12), OWNER_B = id(21);
const ALL_USERS = [OWNER_A, MOT_A, OWNER_B];
const VEH_A = id(31);

const tok = (sub: string) => signJwt({ sub, role: 'authenticated' });
const T = { ownerA: tok(OWNER_A), motA: tok(MOT_A), ownerB: tok(OWNER_B) };

type Pt = [number, number];
const SP = { origin: { lat: -23.5316, lon: -46.7400, label: 'CEAGESP' }, destination: { lat: -23.5770, lon: -46.7430, label: 'USP' } };
// dois pontos na mesma pista da Rodovia dos Bandeirantes, sem saída entre eles: não há desvio possível
const BANDEIRANTES = { origin: { lat: -23.217430, lon: -46.914680 }, destination: { lat: -23.210015, lon: -46.923237 } };

async function req(method: string, url: string, token?: string | null, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(110_000),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
const call = (method: string, path: string, token?: string | null, body?: unknown) => req(method, `${BASE}/api/frota${path}`, token, body);
const rota = (body: unknown) => req('POST', `${BASE}/api/route`, null, body);

/** Pedaço da própria geometria da rota (vértices dela: casa com as vias), começando em `ini` do comprimento. */
function pedaco(cs: Pt[], ini: number, compM: number): Pt[] {
  const cum = [0];
  for (let i = 1; i < cs.length; i++) cum.push(cum[i - 1] + turf.distance(cs[i - 1], cs[i], { units: 'meters' }));
  const i0 = cum.findIndex((d) => d >= cum[cum.length - 1] * ini);
  const i1 = cum.findIndex((d) => d >= cum[i0] + compM);
  return cs.slice(i0, (i1 < 0 ? cs.length - 1 : i1) + 1);
}
const comprimento = (cs: Pt[]) => turf.length(turf.lineString(cs), { units: 'meters' });

/** A rota percorre o trecho no mesmo sentido (metade dele a até 15 m)? Versão simples do usesCostLine do roteador. */
function usa(rotaCs: Pt[], trecho: Pt[]): boolean {
  const linha = turf.lineString(rotaCs);
  const t = turf.lineString(trecho);
  const len = comprimento(trecho);
  const n = Math.max(4, Math.min(60, Math.ceil(len / 20)));
  let mesmo = 0;
  for (let i = 0; i < n; i++) {
    const a = turf.along(t, (len * i) / n, { units: 'meters' }), b = turf.along(t, (len * (i + 1)) / n, { units: 'meters' });
    const np = turf.nearestPointOnLine(linha, turf.midpoint(a, b), { units: 'meters' });
    if ((np.properties.dist ?? Infinity) > 15) continue;
    const k = Math.min(np.properties.index ?? 0, rotaCs.length - 2);
    const dif = Math.abs(((turf.bearing(a, b) - turf.bearing(rotaCs[k], rotaCs[k + 1]) + 540) % 360) - 180);
    if (dif < 90) mesmo++;
  }
  return mesmo / n >= 0.5;
}

async function wipe() {
  await pool.query('delete from companies where id = any($1::uuid[])', [[CO_A, CO_B]]);   // cascata: trechos, viagens, alertas...
  await pool.query('delete from auth.users where id = any($1::uuid[])', [ALL_USERS]);
}

// estado compartilhado (os testes rodam em ordem)
const S: { itemId?: string; linhaId?: string; carretaId?: string; sp?: Pt[]; trecho?: Pt[]; band?: Pt[] } = {};

beforeAll(async () => {
  await wipe();
  await pool.query(`insert into auth.users (id, email) select u, 'bloq-test-' || right(u::text, 4) || '@teste' from unnest($1::uuid[]) u`, [ALL_USERS]);
  await pool.query(`insert into companies (id, name, price_per_vehicle_cents) values ($1, 'Bloqueios Teste A', 9900), ($2, 'Bloqueios Teste B', 9900)`, [CO_A, CO_B]);
  await pool.query(`insert into company_members (company_id, user_id, role, display_name) values
      ($1, $3, 'owner', 'Dono A'), ($1, $4, 'motorista', 'Motorista A'), ($2, $5, 'owner', 'Dono B')`, [CO_A, CO_B, OWNER_A, MOT_A, OWNER_B]);
  await pool.query(`insert into vehicles (id, company_id, plate, preset, height_m, width_m, length_m, weight_t, axle_count)
                    values ($1, $2, 'BLQ1A11', 'toco', 4.0, 2.6, 9.0, 16, 2)`, [VEH_A, CO_A]);
});

afterAll(async () => { await wipe(); });

describe('cadastro e permissões', () => {
  it('equipe bloqueia item da camada; repetido → 409; sem item nem linha → 422; linha fora do Brasil ou curta → 422', async () => {
    const r = await call('POST', '/trechos-bloqueados', T.ownerA, { item_id: 'teste_camada:trecho-1', nome: 'Rua do Teste', motivo: '3 multas no mês' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ item_id: 'teste_camada:trecho-1', nome: 'Rua do Teste', ativo: true, presets: null, coordinates: null, created_by: OWNER_A });
    S.itemId = r.body.id;
    expect((await call('POST', '/trechos-bloqueados', T.ownerA, { item_id: 'teste_camada:trecho-1', nome: 'De novo' })).status).toBe(409);
    expect((await call('POST', '/trechos-bloqueados', T.ownerA, { nome: 'Sem nada' })).status).toBe(422);
    expect((await call('POST', '/trechos-bloqueados', T.ownerA, { nome: 'Lisboa', coordinates: [[-9.14, 38.72], [-9.15, 38.73]] })).status).toBe(422);
    expect((await call('POST', '/trechos-bloqueados', T.ownerA, { nome: 'Um ponto', coordinates: [[-46.74, -23.55]] })).status).toBe(422);
    expect((await call('POST', '/trechos-bloqueados', T.ownerA, { item_id: 'x', presets: ['naoexiste'] })).status).toBe(422);
    // id antigo do tipo de caminhão vira o canônico
    const c = await call('POST', '/trechos-bloqueados', T.ownerA, { item_id: 'teste_camada:trecho-2', nome: 'Só carreta', presets: ['carreta'] });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.presets).toEqual(['carreta_5e']);
    S.carretaId = c.body.id;
  });

  it('motorista lê e não escreve; outra empresa não vê nem altera; anon não acessa a tabela', async () => {
    const l = await call('GET', '/trechos-bloqueados', T.motA);
    expect(l.status).toBe(200);
    expect(l.body.items.map((x: any) => x.id).sort()).toEqual([S.itemId, S.carretaId].sort());
    expect((await call('POST', '/trechos-bloqueados', T.motA, { item_id: 'teste_camada:trecho-3', nome: 'Motorista' })).status).toBe(403);
    expect((await call('PATCH', `/trechos-bloqueados/${S.itemId}`, T.motA, { ativo: false })).status).toBe(403);
    expect((await call('DELETE', `/trechos-bloqueados/${S.itemId}`, T.motA)).status).toBe(403);
    expect((await call('GET', '/trechos-bloqueados', T.ownerB)).body.items).toEqual([]);
    expect((await call('PATCH', `/trechos-bloqueados/${S.itemId}`, T.ownerB, { ativo: false })).status).toBe(404);
    expect((await call('DELETE', `/trechos-bloqueados/${S.itemId}`, T.ownerB)).status).toBe(404);
    // a B pode bloquear o mesmo item na empresa dela (a unicidade é por empresa)
    expect((await call('POST', '/trechos-bloqueados', T.ownerB, { item_id: 'teste_camada:trecho-1', nome: 'Da B' })).status).toBe(201);
    const c = await pool.connect();
    try {
      await c.query('begin; set local role anon');
      await expect(c.query('select 1 from trechos_bloqueados')).rejects.toMatchObject({ code: '42501' });
    } finally { await c.query('rollback'); c.release(); }
    expect((await call('GET', '/trechos-bloqueados', null)).status).toBe(401);
  });

  it('equipe altera (nome, ativo, presets, motivo) e apaga', async () => {
    const p = await call('PATCH', `/trechos-bloqueados/${S.itemId}`, T.ownerA, { nome: 'Rua do Teste (travada)', ativo: false, presets: ['toco', 'truck'], motivo: null });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ nome: 'Rua do Teste (travada)', ativo: false, presets: ['toco', 'truck'], motivo: null });
    expect((await call('GET', '/trechos-bloqueados?ativo=true', T.ownerA)).body.items.map((x: any) => x.id)).toEqual([S.carretaId]);
    expect((await call('PATCH', `/trechos-bloqueados/${S.itemId}`, T.ownerA, {})).status).toBe(422);
    expect((await call('PATCH', `/trechos-bloqueados/${id(999)}`, T.ownerA, { ativo: true })).status).toBe(404);
    expect((await call('PATCH', `/trechos-bloqueados/${S.itemId}`, T.ownerA, { ativo: true, presets: null })).body).toMatchObject({ ativo: true, presets: null });
    expect((await call('DELETE', `/trechos-bloqueados/${S.carretaId}`, T.ownerA)).body).toEqual({ ok: true });
    expect((await call('DELETE', `/trechos-bloqueados/${S.carretaId}`, T.ownerA)).status).toBe(404);
  });

  it('id do aviso com os sufixos da rota (~n, #k) vira o id do trecho: vale para o trecho inteiro', async () => {
    const r = await call('POST', '/trechos-bloqueados', T.ownerA, { item_id: 'teste_camada:trecho-7~2#3', nome: 'Pedaço 3 (teste)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.item_id).toBe('teste_camada:trecho-7');
    expect((await call('POST', '/trechos-bloqueados', T.ownerA, { item_id: 'teste_camada:trecho-7#2', nome: 'Pedaço 2 (teste)' })).status).toBe(409);
    expect((await call('DELETE', `/trechos-bloqueados/${r.body.id}`, T.ownerA)).body).toEqual({ ok: true });
  });
});

describe('roteamento com bloqueios', () => {
  it('linha bloqueada no meio da rota CEAGESP → USP: a rota nova não passa por ela', async () => {
    const r0 = await rota({ origin: SP.origin, destination: SP.destination, vehicle: { preset: 'toco' } });
    expect(r0.status, JSON.stringify(r0.body)).toBe(200);
    S.sp = r0.body.geometry.coordinates as Pt[];
    S.trecho = pedaco(S.sp, 0.45, 500);
    const len = comprimento(S.trecho);
    expect(len).toBeGreaterThan(300);
    expect(len).toBeLessThan(800);
    expect(usa(S.sp, S.trecho)).toBe(true);

    const r1 = await rota({ origin: SP.origin, destination: SP.destination, vehicle: { preset: 'toco' },
                            bloqueios: { linhas: [{ id: 't1', nome: 'Trecho travado (teste)', coordinates: S.trecho }] } });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    const w = r1.body.warnings as any[];
    expect(w.filter((x) => x.code === 'cost_line_ignored'), 'a linha casou com as vias').toEqual([]);
    const avisou = w.some((x) => x.code === 'uses_company_blocked_way' && x.id === 'bloqueio_empresa:t1');
    if (!avisou) {
      expect(usa(r1.body.geometry.coordinates, S.trecho)).toBe(false);
      expect(r1.body.avoided).toContainEqual(expect.objectContaining({ layer: 'bloqueio_empresa', id: 'bloqueio_empresa:t1', name: 'Trecho travado (teste)', bloqueado_empresa: true }));
    }
    // pedido inválido: linha com 1 ponto
    expect((await rota({ ...SP, bloqueios: { linhas: [{ nome: 'x', coordinates: [[-46.7, -23.5]] }] } })).status).toBe(422);
  });

  it('sem nenhum desvio possível (pista da Bandeirantes): aviso uses_company_blocked_way no lugar de uses_restricted_way', async () => {
    const r0 = await rota({ ...BANDEIRANTES, vehicle: { preset: 'toco' } });
    expect(r0.status, JSON.stringify(r0.body)).toBe(200);
    S.band = r0.body.geometry.coordinates as Pt[];
    expect(comprimento(S.band)).toBeGreaterThan(500);
    const r1 = await rota({ ...BANDEIRANTES, vehicle: { preset: 'toco' },
                            bloqueios: { linhas: [{ id: 'band', nome: 'Bandeirantes (teste)', coordinates: S.band }] } });
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    const w = (r1.body.warnings as any[]).filter((x) => x.id === 'bloqueio_empresa:band');
    expect(w.map((x) => x.code), JSON.stringify(r1.body.warnings)).toEqual(['uses_company_blocked_way']);
    expect(w[0]).toMatchObject({ severity: 'danger', layer: 'bloqueio_empresa' });
    expect(w[0].message).toBe('A rota passa por trecho bloqueado pela empresa sem nenhum desvio possível: Bandeirantes (teste). Fale com a central antes de seguir.');
    expect((r1.body.alertas_motorista as any[]).some((x) => x.code === 'uses_company_blocked_way')).toBe(true);
    // a duração não explode com o fator (re-cronometrada sem a penalidade)
    expect(r1.body.duration_s).toBeLessThan(r0.body.duration_s * 2 + 60);
  });

  it('/api/sim/avaliar: linha da empresa e item de camada cruzados vêm com bloqueado_empresa', async () => {
    const base = { origin: SP.origin, destination: SP.destination, vehicle: { preset: 'toco' }, coordinates: S.sp };
    const sem = await req('POST', `${BASE}/api/sim/avaliar`, null, base);
    expect(sem.status, JSON.stringify(sem.body)).toBe(200);
    expect((sem.body.crossed as any[]).some((x) => x.layer === 'bloqueio_empresa')).toBe(false);
    const com = await req('POST', `${BASE}/api/sim/avaliar`, null, { ...base, bloqueios: { linhas: [{ id: 't1', nome: 'Trecho travado (teste)', coordinates: S.trecho }] } });
    expect(com.status, JSON.stringify(com.body)).toBe(200);
    expect(com.body.crossed).toContainEqual(expect.objectContaining({ layer: 'bloqueio_empresa', id: 'bloqueio_empresa:t1', bloqueado_empresa: true }));

    // item de camada: um trecho real da Linha Vermelha (proibida a caminhão 24 h), percorrido no sentido dele
    const f = (await pool.query(`select ST_AsGeoJSON(geom)::json as g from data_features
                                  where layer_id = 'restricoes_rmsp' and props::text ilike '%linha vermelha%'
                                  order by ST_Length(geom::geography) desc limit 1`)).rows[0];
    expect(f, 'Linha Vermelha carregada na base').toBeTruthy();
    const cs = f.g.coordinates as Pt[];
    const lv = { origin: { lon: cs[0][0], lat: cs[0][1] }, destination: { lon: cs[cs.length - 1][0], lat: cs[cs.length - 1][1] },
                 departure_at: '2026-11-03T10:00', vehicle: { preset: 'toco' }, coordinates: cs };
    const a = await req('POST', `${BASE}/api/sim/avaliar`, null, lv);
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const item = (a.body.crossed as any[]).find((x) => x.kind === 'layer');
    expect(item, JSON.stringify(a.body.crossed)).toBeTruthy();
    expect(item.bloqueado_empresa).toBeUndefined();
    const b = await req('POST', `${BASE}/api/sim/avaliar`, null, { ...lv, bloqueios: { item_ids: [item.id] } });
    expect(b.body.crossed).toContainEqual(expect.objectContaining({ id: item.id, bloqueado_empresa: true }));
    // bloqueado a partir do aviso de outra rota, com sufixo (pedaço 3 do trecho achado de novo): vale do mesmo jeito
    const c = await req('POST', `${BASE}/api/sim/avaliar`, null, { ...lv, bloqueios: { item_ids: [`${item.id}~2#3`] } });
    expect(c.body.crossed).toContainEqual(expect.objectContaining({ id: item.id, bloqueado_empresa: true }));
  });
});

describe('viagens da frota levam os trechos bloqueados da empresa', () => {
  it('linha desenhada fora das vias: gravada, mas o POST avisa que não casa', async () => {
    const r = await call('POST', '/trechos-bloqueados', T.ownerA, { nome: 'Rabisco', coordinates: [S.trecho![0], S.trecho![S.trecho!.length - 1]], ativo: false });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.casa_com_vias).toBe(false);
    expect(r.body.aviso).toMatch(/não segue as vias/);
  });

  it('a linha só vale no sentido desenhado: a resposta diz se está na contramão ou se a via tem mão dupla', async () => {
    const novo = (nome: string, coordinates: Pt[]) => call('POST', '/trechos-bloqueados', T.ownerA, { nome, coordinates, ativo: false });
    const criados: string[] = [];
    // trecho da rota CEAGESP → USP (Av. Jaguaré, mão única) desenhado ao contrário: não pegaria ninguém
    const contra = await novo('Contramão (teste)', [...S.trecho!].reverse());
    expect(contra.status, JSON.stringify(contra.body)).toBe(201);
    criados.push(contra.body.id);
    expect(contra.body).toMatchObject({ casa_com_vias: false, mao_dupla: false });
    expect(contra.body.aviso).toBe('A linha foi desenhada na contramão e não vale para ninguém. Desenhe do primeiro ao último ponto no sentido de quem passa pela via.');
    // pista da Bandeirantes no sentido dela: mão única, sem aviso
    const pista = await novo('Pista (teste)', S.band!);
    criados.push(pista.body.id);
    expect(pista.body).toMatchObject({ casa_com_vias: true, mao_dupla: false });
    expect(pista.body.aviso).toBeUndefined();
    // trecho de mão dupla (Av. Imperatriz Leopoldina): vale só no sentido desenhado, a resposta diz como travar o outro
    const r = await rota({ origin: { lat: -23.530587, lon: -46.731241 }, destination: { lat: -23.528478, lon: -46.733202 }, vehicle: { preset: 'toco' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    for (const cs of [r.body.geometry.coordinates as Pt[], [...r.body.geometry.coordinates].reverse() as Pt[]]) {
      const dupla = await novo('Mão dupla (teste)', cs);
      criados.push(dupla.body.id);
      expect(dupla.body, JSON.stringify(dupla.body)).toMatchObject({ casa_com_vias: true, mao_dupla: true });
      expect(dupla.body.aviso).toBe('O bloqueio vale só no sentido em que a linha foi desenhada (do primeiro ao último ponto); a via tem mão dupla. Para travar também o outro sentido, cadastre a mesma linha desenhada ao contrário.');
    }
    for (const x of criados) expect((await call('DELETE', `/trechos-bloqueados/${x}`, T.ownerA)).status).toBe(200);
  });

  it('POST /trips: bloqueio só de carreta não vale para o toco; com todos os veículos, a rota planejada desvia', async () => {
    const l = await call('POST', '/trechos-bloqueados', T.ownerA, { nome: 'Trecho travado (teste)', coordinates: S.trecho, presets: ['carreta_5e'] });
    expect(l.status, JSON.stringify(l.body)).toBe(201);
    expect(l.body.casa_com_vias).toBe(true);
    S.linhaId = l.body.id;
    const viagem = { title: 'CEAGESP → USP', vehicle_id: VEH_A, plan_route: true, origin: SP.origin, destination: SP.destination };

    const t1 = await call('POST', '/trips', T.ownerA, viagem);
    expect(t1.status, JSON.stringify(t1.body)).toBe(201);
    expect((t1.body.route_response.avoided as any[]).some((x) => x.layer === 'bloqueio_empresa')).toBe(false);
    expect(usa(t1.body.planned_route.coordinates, S.trecho!)).toBe(true);

    expect((await call('PATCH', `/trechos-bloqueados/${S.linhaId}`, T.ownerA, { presets: null })).status).toBe(200);
    const t2 = await call('POST', '/trips', T.ownerA, viagem);
    expect(t2.status, JSON.stringify(t2.body)).toBe(201);
    const rr = t2.body.route_response;
    const avisou = (rr.warnings as any[]).some((x) => x.code === 'uses_company_blocked_way' && x.id === `bloqueio_empresa:${S.linhaId}`);
    if (!avisou) {
      expect(rr.avoided).toContainEqual(expect.objectContaining({ layer: 'bloqueio_empresa', id: `bloqueio_empresa:${S.linhaId}`, bloqueado_empresa: true }));
      expect(usa(t2.body.planned_route.coordinates, S.trecho!)).toBe(false);
    }
    await call('POST', `/trips/${t1.body.id}/cancel`, T.ownerA, {});
    await call('POST', `/trips/${t2.body.id}/cancel`, T.ownerA, {});
  });

  it('Mentor (criar_viagem confirmada): o roteador recebe os bloqueios que valem para o tipo do veículo', async () => {
    const { executeAction } = await import('../../src/frota/mentor_tools.js');
    let pedido: any = null;
    const route = (async (r: any) => {
      pedido = r;
      return { geometry: { type: 'LineString', coordinates: [[SP.origin.lon, SP.origin.lat], [SP.destination.lon, SP.destination.lat]] },
               distance_km: 7.8, duration_s: 900, avoided: [], warnings: [], alertas_motorista: [], resumo_avisos: null, vehicle: {}, departure_at: '2026-11-03T08:00' };
    }) as any;
    const out = await executeAction({ claims: { sub: OWNER_A, role: 'authenticated' }, userId: OWNER_A, companyId: CO_A, route }, id(900), 'criar_viagem',
      { titulo: 'Viagem do Mentor', veiculo_id: VEH_A, origem: { lat: SP.origin.lat, lon: SP.origin.lon }, destino: { lat: SP.destination.lat, lon: SP.destination.lon } });
    expect(out.viagem_id).toBeTruthy();
    expect(pedido.bloqueios.item_ids).toEqual(['teste_camada:trecho-1']);
    expect(pedido.bloqueios.linhas.map((l: any) => l.id)).toEqual([S.linhaId]);
    expect(pedido.bloqueios.linhas[0].coordinates).toEqual(S.trecho);
  });
});

describe('alerta ao vivo', () => {
  it('fora da rota: a equipe recebe fora_da_rota (fora da resposta do ping); trecho bloqueado à frente vira trecho_bloqueado', async () => {
    const t = await call('POST', '/trips', T.ownerA, { title: 'Teste fora da rota', vehicle_id: VEH_A, driver_id: MOT_A, plan_route: true,
                                                        origin: SP.origin, destination: SP.destination });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect((await call('POST', `/trips/${t.body.id}/start`, T.motA, {})).status).toBe(200);
    // linha desenhada (reta, 800 m) longe da rota planejada: o motorista está no começo dela, no rumo dela
    const ini: Pt = [BANDEIRANTES.origin.lon, BANDEIRANTES.origin.lat];
    const fim = turf.destination(ini, 0.8, 300, { units: 'kilometers' }).geometry.coordinates as Pt;
    const b = await call('POST', '/trechos-bloqueados', T.ownerA, { nome: 'Desvio proibido (teste)', coordinates: [ini, fim] });
    expect(b.status, JSON.stringify(b.body)).toBe(201);

    const r = await call('POST', '/pings', T.motA, { pings: [{ lat: ini[1], lon: ini[0], heading_deg: 300, speed_kmh: 60, recorded_at: new Date().toISOString() }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.trip_id).toBe(t.body.id);
    const alertas = r.body.alertas as any[];
    expect(alertas.some((a) => a.tipo === 'fora_da_rota'), JSON.stringify(alertas)).toBe(false);
    const bloq = alertas.find((a) => a.tipo === 'trecho_bloqueado');
    expect(bloq, JSON.stringify(alertas)).toBeTruthy();
    expect(bloq).toMatchObject({ item_id: `bloqueio_empresa:${b.body.id}`, item_nome: 'Desvio proibido (teste)' });
    expect(bloq.mensagem).toBe('Atenção: a menos de 1,5 km à frente há Desvio proibido (teste), trecho bloqueado pela empresa. Volte para a rota do app.');

    const fora = await call('GET', `/alertas?trip_id=${t.body.id}&tipo=fora_da_rota`, T.ownerA);
    expect(fora.status).toBe(200);
    expect(fora.body.items).toHaveLength(1);
    expect(fora.body.items[0].mensagem).toMatch(/^O motorista saiu da rota do app \([\d.]+ m\)\.$/);
    expect(fora.body.items[0].fora_rota_m).toBeGreaterThan(250);
    const tb = await call('GET', `/alertas?trip_id=${t.body.id}&tipo=trecho_bloqueado`, T.ownerA);
    expect(tb.body.items.map((x: any) => x.tipo)).toEqual(['trecho_bloqueado']);
    expect((await call('GET', `/alertas?trip_id=${t.body.id}&tipo=trecho_bloqueado,fora_da_rota`, T.ownerA)).body.items).toHaveLength(2);
    expect((await call('GET', '/alertas', T.ownerB)).body.items).toHaveLength(0);

    // o fora_da_rota é só da equipe: o motorista não lê nem marca como visto (não esvazia a fila do gestor)
    const foraId = fora.body.items[0].id;
    const doMot = await call('GET', `/alertas?trip_id=${t.body.id}`, T.motA);
    expect(doMot.status).toBe(200);
    expect(doMot.body.items.map((x: any) => x.tipo)).toEqual(['trecho_bloqueado']);
    expect((await call('POST', `/alertas/${foraId}/visto`, T.motA, {})).status).toBe(404);
    expect((await call('GET', `/alertas?trip_id=${t.body.id}&nao_vistos=true&tipo=fora_da_rota`, T.ownerA)).body.items).toHaveLength(1);
    expect((await call('POST', `/alertas/${bloq.id}/visto`, T.motA, {})).status).toBe(200);   // os outros, sim
    expect((await call('POST', `/alertas/${foraId}/visto`, T.ownerA, {})).status).toBe(200);
    // direto no banco, como o motorista (RLS): não vê nem altera
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: MOT_A, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      expect((await c.query(`select tipo from alertas_viagem where trip_id = $1 order by tipo`, [t.body.id])).rows.map((x) => x.tipo)).toEqual(['trecho_bloqueado']);
      expect((await c.query(`update alertas_viagem set visto_em = null where trip_id = $1 and tipo = 'fora_da_rota'`, [t.body.id])).rowCount).toBe(0);
    } finally { await c.query('rollback'); c.release(); }
    await call('POST', `/trips/${t.body.id}/end`, T.motA, {});
  });

  it('fora_da_rota: no máximo um por viagem a cada 2 h', async () => {
    const t = await call('POST', '/trips', T.ownerA, { title: 'Teste 2 h', vehicle_id: VEH_A, driver_id: MOT_A, plan_route: true,
                                                        origin: SP.origin, destination: SP.destination });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    // a linha reta do teste anterior não segue as vias: a rota sai sem ela, com aviso para a equipe
    expect(t.body.route_response.warnings).toContainEqual(expect.objectContaining({ code: 'cost_line_ignored', layer: 'bloqueio_empresa',
      message: expect.stringMatching(/bloqueado\(s\) pela empresa não seguem as vias do mapa.*Desvio proibido \(teste\)/) }));
    expect((await call('POST', `/trips/${t.body.id}/start`, T.motA, {})).status).toBe(200);
    // um aviso de 1 h atrás já existe: o ping fora da rota não grava outro
    await pool.query(`insert into alertas_viagem (company_id, trip_id, driver_id, vehicle_id, tipo, mensagem, fora_rota_m, criado_em)
                      values ($1, $2, $3, $4, 'fora_da_rota', 'O motorista saiu da rota do app (900 m).', 900, now() - interval '1 hour')`,
                     [CO_A, t.body.id, MOT_A, VEH_A]);
    const r = await call('POST', '/pings', T.motA, { pings: [{ lat: -23.5505, lon: -46.6333, heading_deg: 0, recorded_at: new Date().toISOString() }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const l = await call('GET', `/alertas?trip_id=${t.body.id}&tipo=fora_da_rota`, T.ownerA);
    expect(l.body.items).toHaveLength(1);
    await call('POST', `/trips/${t.body.id}/end`, T.motA, {});
  });

  it('na rota do app: trecho bloqueado depois de planejar a viagem, à frente, vira trecho_bloqueado', async () => {
    const t = await call('POST', '/trips', T.ownerA, { title: 'Teste na rota', vehicle_id: VEH_A, driver_id: MOT_A, plan_route: true,
                                                        origin: SP.origin, destination: SP.destination });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const cs = t.body.planned_route.coordinates as Pt[];
    // a equipe bloqueia um pedaço da rota já planejada
    const trecho = pedaco(cs, 0.6, 500);
    const b = await call('POST', '/trechos-bloqueados', T.ownerA, { nome: 'Travado depois (teste)', coordinates: trecho });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    expect(b.body.casa_com_vias).toBe(true);
    expect((await call('POST', `/trips/${t.body.id}/start`, T.motA, {})).status).toBe(200);
    // o motorista segue a rota do app, 300 m antes do trecho
    const linha = turf.lineString(cs);
    const ini = turf.nearestPointOnLine(linha, trecho[0], { units: 'meters' }).properties.location ?? 0;
    const p0 = turf.along(linha, Math.max(0, ini - 300), { units: 'meters' }).geometry.coordinates as Pt;
    const p1 = turf.along(linha, Math.max(0, ini - 280), { units: 'meters' }).geometry.coordinates as Pt;
    const r = await call('POST', '/pings', T.motA, { pings: [{ lat: p0[1], lon: p0[0], heading_deg: (turf.bearing(p0, p1) + 360) % 360, speed_kmh: 40, recorded_at: new Date().toISOString() }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const alertas = r.body.alertas as any[];
    const bloq = alertas.find((a) => a.tipo === 'trecho_bloqueado');
    expect(bloq, JSON.stringify(alertas)).toBeTruthy();
    expect(bloq).toMatchObject({ item_id: `bloqueio_empresa:${b.body.id}`, item_nome: 'Travado depois (teste)' });
    expect(bloq.mensagem).toBe('Atenção: a menos de 1,5 km à frente a rota do app passa por Travado depois (teste), trecho bloqueado pela empresa depois que a viagem foi planejada. Fale com a central antes de seguir.');
    expect(bloq.fora_rota_m).toBeLessThanOrEqual(250);
    expect(alertas.every((a) => a.tipo === 'trecho_bloqueado'), JSON.stringify(alertas)).toBe(true);
    // a equipe vê; e não é fora da rota
    expect((await call('GET', `/alertas?trip_id=${t.body.id}&tipo=trecho_bloqueado`, T.ownerA)).body.items).toHaveLength(1);
    expect((await call('GET', `/alertas?trip_id=${t.body.id}&tipo=fora_da_rota`, T.ownerA)).body.items).toHaveLength(0);
    await call('POST', `/trips/${t.body.id}/end`, T.motA, {});
    expect((await call('DELETE', `/trechos-bloqueados/${b.body.id}`, T.ownerA)).status).toBe(200);
  });
});
