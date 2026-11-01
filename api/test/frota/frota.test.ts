import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signJwt } from '../../src/frota/auth.js';
import { pool } from '../helpers.js';

/**
 * API da Frota (/api/frota) de ponta a ponta. Precisa da API na porta 3100 (ou API_URL), do Postgres local com as
 * migrations 0300-0303 e do Valhalla (rota planejada):
 *   API_URL=http://localhost:3100 npx vitest run test/frota
 * Cria empresas/usuários com ids próprios (prefixo fa0e) no beforeAll, como superusuário, e apaga tudo no afterAll.
 */
const BASE = process.env.API_URL ?? 'http://localhost:3100';

const id = (n: number) => `fa0e0000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CO_A = id(1), CO_B = id(2);
const OWNER_A = id(11), MOT_A = id(12), OUTSIDER = id(13), OWNER_B = id(21), MOT_B = id(22), GESTOR_A = id(14);
const ALL_USERS = [OWNER_A, MOT_A, OUTSIDER, OWNER_B, MOT_B, GESTOR_A];

const tok = (sub: string) => signJwt({ sub, role: 'authenticated' });
const T = {
  ownerA: tok(OWNER_A), motA: tok(MOT_A), outsider: tok(OUTSIDER), ownerB: tok(OWNER_B), motB: tok(MOT_B), gestorA: tok(GESTOR_A),
  service: signJwt({ role: 'service_role' }),
};

async function call(method: string, path: string, token?: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}/api/frota${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90_000),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

async function wipe() {
  // empresas primeiro (cascata: viagens, pings, paradas, mensagens...), depois os usuários
  await pool.query('delete from companies where id = any($1::uuid[])', [[CO_A, CO_B]]);
  await pool.query('delete from auth.users where id = any($1::uuid[])', [ALL_USERS]);
}

// estado compartilhado do fluxo (os testes rodam em ordem)
const S: { vehicleId?: string; inviteId?: string; code?: string; tripId?: string; deliveryId?: string; stopId?: string; autoStopId?: string; vehB?: string } = {};
const SP = { origin: { lat: -23.5316, lon: -46.7400, label: 'CEAGESP' }, destination: { lat: -23.5770, lon: -46.7430, label: 'USP' } };

beforeAll(async () => {
  await wipe();
  await pool.query(`insert into auth.users (id, email) select u, 'frota-test-' || right(u::text, 4) || '@teste' from unnest($1::uuid[]) u`, [ALL_USERS]);
  await pool.query(`insert into companies (id, name, price_per_vehicle_cents) values ($1, 'Frota Teste A', 9900), ($2, 'Frota Teste B', 9900)`, [CO_A, CO_B]);
  await pool.query(`insert into company_members (company_id, user_id, role, display_name) values
      ($1, $3, 'owner', 'Dono A'), ($2, $4, 'owner', 'Dono B'), ($2, $5, 'motorista', 'Motorista B')`, [CO_A, CO_B, OWNER_A, OWNER_B, MOT_B]);
  await pool.query(`insert into vehicles (company_id, plate, preset) values ($1, 'BBB1B11', 'carreta') returning id`, [CO_B]).then((r) => r);
  S.vehB = (await pool.query('select id from vehicles where company_id = $1', [CO_B])).rows[0].id;
});

afterAll(async () => { await wipe(); });

describe('autenticação', () => {
  it('sem token → 401', async () => { expect((await call('GET', '/trips')).status).toBe(401); });
  it('assinatura errada → 401', async () => {
    expect((await call('GET', '/trips', signJwt({ sub: OWNER_A, role: 'authenticated' }, 'outro-segredo'))).status).toBe(401);
  });
  it('token expirado → 401', async () => {
    expect((await call('GET', '/trips', signJwt({ sub: OWNER_A, role: 'authenticated' }, undefined, -60))).status).toBe(401);
  });
  it('lixo no lugar do token → 401 (nunca 500)', async () => {
    for (const t of ['abc', 'a.b.c', 'eyJhbGciOiJub25lIn0.e30.', '....']) expect((await call('GET', '/trips', t)).status).toBe(401);
  });
  it('papel anon ou token sem sub → 401', async () => {
    expect((await call('GET', '/trips', signJwt({ sub: OWNER_A, role: 'anon' }))).status).toBe(401);
    expect((await call('GET', '/trips', signJwt({ role: 'authenticated' }))).status).toBe(401);
  });
  it('esquema diferente de Bearer → 401', async () => {
    expect((await call('GET', '/trips', null, undefined, { authorization: `Basic ${T.ownerA}` })).status).toBe(401);
  });
});

describe('usuário autenticado sem convite não vê nada', () => {
  it('leituras vazias e escritas negadas', async () => {
    const me = await call('GET', '/me', T.outsider);
    expect(me.status).toBe(200);
    expect(me.body.company_id).toBeNull();
    for (const p of ['/trips', '/vehicles', '/messages']) {
      const r = await call('GET', p, T.outsider);
      expect(r.status, p).toBe(200);
      expect(r.body.items, p).toEqual([]);
    }
    expect((await call('GET', '/live', T.outsider)).body.features).toEqual([]);
    for (const p of ['/members', '/invites', '/billing']) expect((await call('GET', p, T.outsider)).status, p).toBe(403);
    expect((await call('POST', '/pings', T.outsider, { pings: [{ lat: -23.5, lon: -46.6, recorded_at: new Date().toISOString() }] })).status).toBe(403);
    expect((await call('POST', '/trips/start', T.outsider, {})).status).toBe(403);
    expect((await call('POST', '/vehicles', T.outsider, { plate: 'AAA1A11' })).status).toBe(403);
    expect((await call('POST', '/invites/accept', T.outsider, { code: 'ZZZZZ-ZZZZZ', display_name: 'Fulano' })).status).toBe(403);
  });
});

describe('fluxo completo: convite → aceite → viagem → pings → parada → entrega → encerrar → mensagem', () => {
  it('equipe cadastra veículo a partir do preset', async () => {
    const r = await call('POST', '/vehicles', T.ownerA, { plate: 'abc-1d23', label: 'Toco 01', preset: 'toco' });
    expect(r.status).toBe(201);
    expect(r.body.plate).toBe('ABC1D23');
    expect(r.body.height_m).toBe(4.0);           // do preset
    expect(r.body.length_m).toBe(9.0);
    expect(r.body.axle_count).toBe(2);
    S.vehicleId = r.body.id;
    expect((await call('POST', '/vehicles', T.ownerA, { plate: 'ABC1D23' })).status).toBe(409);        // placa repetida
    expect((await call('POST', '/vehicles', T.ownerA, { plate: '123' })).status).toBe(422);
    expect((await call('POST', '/vehicles', T.ownerA, { plate: 'XYZ9K99', preset: 'naoexiste' })).status).toBe(422);
    const p = await call('PATCH', `/vehicles/${S.vehicleId}`, T.ownerA, { label: 'Toco 01 (editado)', height_m: 3.9 });
    expect(p.status).toBe(200);
    expect(p.body.label).toBe('Toco 01 (editado)');
    expect(p.body.height_m).toBe(3.9);
  });

  it('gera convite (código só na criação) e lista sem expor hash', async () => {
    const r = await call('POST', '/invites', T.ownerA, { role: 'motorista', vehicle_id: S.vehicleId, invitee_name: 'João', valid_hours: 48 });
    expect(r.status).toBe(201);
    expect(r.body.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    S.inviteId = r.body.id; S.code = r.body.code;
    const l = await call('GET', '/invites?status=pendente', T.ownerA);
    expect(l.status).toBe(200);
    const inv = l.body.items.find((i: any) => i.id === S.inviteId);
    expect(inv.code_hint).toBe(S.code!.slice(-4));
    expect(JSON.stringify(l.body)).not.toContain(S.code!);
    expect(inv.code_hash).toBeUndefined();
    expect((await call('POST', '/invites', T.ownerA, { role: 'motorista', valid_hours: 9999 })).status).toBe(422);
  });

  it('motorista aceita o convite; reuso e segundo aceite são recusados', async () => {
    expect((await call('POST', '/invites/accept', T.motA, { code: 'ZZZZZ-ZZZZZ', display_name: 'João Motorista' })).status).toBe(403);
    const r = await call('POST', '/invites/accept', T.motA, { code: S.code!.toLowerCase(), display_name: 'João Motorista', phone: '11999990000' });
    expect(r.status).toBe(200);
    expect(r.body.role).toBe('motorista');
    expect(r.body.default_vehicle_id).toBe(S.vehicleId);
    expect(r.body.company_id).toBe(CO_A);
    expect((await call('POST', '/invites/accept', T.motA, { code: S.code, display_name: 'De novo' })).status).toBe(403);
    expect((await call('POST', '/invites/accept', T.outsider, { code: S.code, display_name: 'Intruso' })).status).toBe(403);   // código já usado
    const l = await call('GET', '/invites?status=aceito', T.ownerA);
    expect(l.body.items.some((i: any) => i.id === S.inviteId)).toBe(true);
    // convite aceito não é revogável
    expect((await call('POST', `/invites/${S.inviteId}/revoke`, T.ownerA)).status).toBe(403);
  });

  it('convite revogado não pode ser aceito', async () => {
    const inv = await call('POST', '/invites', T.ownerA, { role: 'motorista' });
    const rev = await call('POST', `/invites/${inv.body.id}/revoke`, T.ownerA);
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('revogado');
    expect((await call('POST', '/invites/accept', T.outsider, { code: inv.body.code, display_name: 'Tentativa' })).status).toBe(403);
  });

  it('equipe cria viagem com rota planejada, entrega e motorista', async () => {
    const r = await call('POST', '/trips', T.ownerA, {
      title: 'CEAGESP → USP', origin: SP.origin, destination: SP.destination, plan_route: true,
      driver_id: MOT_A, vehicle_id: S.vehicleId,
      departure_planned_at: new Date(Date.now() + 3600_000).toISOString(),
      deliveries: [{ customer_name: 'Cliente Teste', address: 'Av. Prof. Luciano Gualberto, 1', lat: -23.5600, lon: -46.7300 }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('atribuida');
    expect(r.body.driver_id).toBe(MOT_A);
    expect(r.body.planned_route.type).toBe('LineString');
    expect(r.body.planned_route.coordinates.length).toBeGreaterThan(10);
    expect(r.body.planned_distance_m).toBeGreaterThan(3000);
    expect(r.body.planned_duration_s).toBeGreaterThan(300);
    expect(Array.isArray(r.body.route_response.avoided)).toBe(true);
    expect(Array.isArray(r.body.route_response.warnings)).toBe(true);
    expect(r.body.deliveries).toHaveLength(1);
    S.tripId = r.body.id;
    S.deliveryId = r.body.deliveries[0].id;
  });

  it('validação: plan_route sem origem/destino → 422; veículo/motorista de outra empresa → 404', async () => {
    expect((await call('POST', '/trips', T.ownerA, { plan_route: true })).status).toBe(422);
    expect((await call('POST', '/trips', T.ownerA, { title: 'x', vehicle_id: S.vehB })).status).toBe(404);
    expect((await call('POST', '/trips', T.ownerA, { title: 'x', driver_id: MOT_B })).status).toBe(404);
    expect((await call('POST', '/trips', T.ownerA, { title: 'x', driver_id: 'nao-e-uuid' })).status).toBe(422);
  });

  it('motorista vê só a sua viagem e inicia', async () => {
    const l = await call('GET', '/trips', T.motA);
    expect(l.body.items.map((t: any) => t.id)).toEqual([S.tripId]);
    const f = await call('GET', '/trips?status=em_andamento', T.motA);
    expect(f.body.items).toHaveLength(0);
    const s = await call('POST', `/trips/${S.tripId}/start`, T.motA, {});
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.status).toBe('em_andamento');
    expect(s.body.started_at).toBeTruthy();
    // não inicia duas
    expect((await call('POST', '/trips/start', T.motA, { title: 'avulsa' })).status).toBe(403);
  });

  it('envia pings em lote (idempotente), com parada de 20 min', async () => {
    const trip = (await call('GET', `/trips/${S.tripId}`, T.motA)).body;
    const cs: [number, number][] = trip.planned_route.coordinates;
    const at = (f: number) => cs[Math.min(cs.length - 1, Math.floor(f * (cs.length - 1)))];
    const base = Date.now() - 3 * 3600_000;
    const pings: any[] = [];
    // deslocamento (a cada 5 min), parada de 20 min no meio da rota, deslocamento até o fim
    const frac = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.5, 0.5, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
    const minutes = [0, 5, 10, 15, 20, 25, 35, 45, 55, 60, 65, 70, 75, 80];
    frac.forEach((f, i) => {
      const [lon, lat] = at(f);
      pings.push({ lat, lon, speed_kmh: f === 0.5 && i > 5 && i < 9 ? 0 : 45, heading_deg: 90, accuracy_m: 8, recorded_at: new Date(base + minutes[i] * 60_000).toISOString() });
    });
    const r = await call('POST', '/pings', T.motA, { pings });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.accepted).toBe(pings.length);
    expect(r.body.trip_id).toBe(S.tripId);
    expect(r.body.interval_moving_s).toBe(30);
    expect(r.body.interval_stopped_s).toBe(300);
    const again = await call('POST', '/pings', T.motA, { pings });
    expect(again.body.accepted).toBe(0);                                   // reenvio idempotente
    expect((await call('POST', '/pings', T.motA, { pings: [] })).status).toBe(422);
    expect((await call('POST', '/pings', T.motA, { pings: [{ lat: 99, lon: 0, recorded_at: new Date().toISOString() }] })).status).toBe(422);
    const lost = await call('POST', '/pings', T.motA, { pings: [{ lat: -23.5, lon: -46.6, recorded_at: new Date().toISOString() }], vehicle_id: S.vehB });
    expect(lost.status).toBe(403);                                         // veículo de outra empresa
  });

  it('painel vê a posição ao vivo da empresa; motorista só a própria', async () => {
    const live = await call('GET', '/live', T.ownerA);
    expect(live.status).toBe(200);
    expect(live.body.type).toBe('FeatureCollection');
    expect(live.body.features).toHaveLength(1);
    expect(live.body.features[0].properties.driver_id).toBe(MOT_A);
    expect(live.body.features[0].properties.display_name).toBe('João Motorista');
    expect(live.body.features[0].properties.plate).toBe('ABC1D23');
    expect(live.body.features[0].geometry.type).toBe('Point');
    expect((await call('GET', '/live', T.motA)).body.features).toHaveLength(1);
  });

  it('motorista registra parada manual', async () => {
    const t = Date.now() - 3 * 3600_000;
    const r = await call('POST', '/stops', T.motA, {
      type: 'abastecimento', lat: -23.54, lon: -46.74, arrived_at: new Date(t + 12 * 60_000).toISOString(), departed_at: new Date(t + 14 * 60_000).toISOString(), note: 'Posto',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.source).toBe('manual');
    expect(r.body.trip_id).toBe(S.tripId);                                 // viagem em andamento
    expect(r.body.duration_s).toBe(120);
    S.stopId = r.body.id;
    expect((await call('POST', '/stops', T.motA, { type: 'invalido', lat: 0, lon: 0 })).status).toBe(422);
  });

  it('entrega: motivo obrigatório na falha, comprovante só no prefixo da empresa; registra entregue', async () => {
    expect((await call('PATCH', `/deliveries/${S.deliveryId}`, T.motA, { status: 'falhou' })).status).toBe(422);
    expect((await call('PATCH', `/deliveries/${S.deliveryId}`, T.motA, { status: 'entregue', proof_photo_path: `${CO_B}/x.jpg` })).status).toBe(403);
    const r = await call('PATCH', `/deliveries/${S.deliveryId}`, T.motA, {
      status: 'entregue', proof_photo_path: `${CO_A}/comprovantes/1.jpg`, signature_path: `${CO_A}/assinaturas/1.png`, stop_id: S.stopId,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('entregue');
    expect(r.body.status_at).toBeTruthy();
    expect(r.body.stop_id).toBe(S.stopId);
  });

  it('encerra a viagem: rota compactada, distância, desvio e parada automática', async () => {
    const e = await call('POST', `/trips/${S.tripId}/end`, T.motA);
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    expect(e.body.status).toBe('concluida');
    expect(e.body.ended_at).toBeTruthy();
    expect(e.body.distance_m).toBeGreaterThan(1000);
    expect(e.body.deviation_max_m).toBeGreaterThanOrEqual(0);
    expect(e.body.actual_route.type).toBe('LineString');
    expect(e.body.actual_route.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(e.body.actual_route_times.length).toBe(e.body.actual_route.coordinates.length);   // M = horário de cada ponto
    const auto = e.body.stops.filter((s: any) => s.source === 'auto');
    expect(auto).toHaveLength(1);                                          // 20 min parado
    expect(auto[0].duration_s).toBeGreaterThanOrEqual(1200);
    expect(auto[0].type).toBe('nao_classificada');
    S.autoStopId = auto[0].id;
    expect(e.body.stops.some((s: any) => s.id === S.stopId)).toBe(true);
    expect(e.body.deliveries[0].status).toBe('entregue');
    // pings crus ficam marcados como compactados
    const n = await pool.query(`select count(*) filter (where not compacted)::int as aberto from location_pings where trip_id = $1`, [S.tripId]);
    expect(n.rows[0].aberto).toBe(0);
    // encerrar de novo é recusado
    expect((await call('POST', `/trips/${S.tripId}/end`, T.motA)).status).toBe(403);
  });

  it('equipe classifica a parada automática; motorista também classifica as suas', async () => {
    const r = await call('PATCH', `/stops/${S.autoStopId}`, T.ownerA, { type: 'descanso', note: 'Almoço' });
    expect(r.status).toBe(200);
    expect(r.body.type).toBe('descanso');
    expect(r.body.note).toBe('Almoço');
    expect((await call('PATCH', `/stops/${S.stopId}`, T.motA, { type: 'entrega' })).body.type).toBe('entrega');
    expect((await call('PATCH', `/stops/${S.stopId}`, T.motA, {})).status).toBe(422);
  });

  it('detalhe e filtros de viagens', async () => {
    const d = await call('GET', `/trips/${S.tripId}`, T.ownerA);
    expect(d.status).toBe(200);
    expect(d.body.driver_name).toBe('João Motorista');
    expect(d.body.vehicle_plate).toBe('ABC1D23');
    expect(d.body.stops.length).toBe(2);
    const f = await call('GET', `/trips?status=concluida&driver_id=${MOT_A}`, T.ownerA);
    expect(f.body.items.map((t: any) => t.id)).toEqual([S.tripId]);
    const dia = new Date().toISOString();
    expect((await call('GET', `/trips?from=${encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString())}`, T.ownerA)).body.items).toHaveLength(0);
    expect((await call('GET', `/trips?to=${encodeURIComponent(dia)}`, T.ownerA)).body.items.length).toBeGreaterThanOrEqual(1);
    expect((await call('GET', '/trips?status=inexistente', T.ownerA)).status).toBe(422);
  });

  it('mensagens: equipe → motorista, leitura, resposta; motorista não escreve para colega', async () => {
    const m = await call('POST', '/messages', T.ownerA, { recipient_id: MOT_A, body: 'Boa viagem!', trip_id: S.tripId });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const inbox = await call('GET', '/messages?unread=true', T.motA);
    expect(inbox.body.items.map((x: any) => x.id)).toEqual([m.body.id]);
    expect(inbox.body.items[0].sender_id).toBe(OWNER_A);
    const rd = await call('POST', '/messages/read', T.motA, { ids: [m.body.id] });
    expect(rd.body.marked).toBe(1);
    expect((await call('POST', '/messages/read', T.motA, { ids: [m.body.id] })).body.marked).toBe(0);
    expect((await call('GET', '/messages?unread=true', T.motA)).body.items).toHaveLength(0);
    // remetente não consegue marcar como lida a mensagem que enviou
    expect((await call('POST', '/messages/read', T.ownerA, { ids: [m.body.id] })).body.marked).toBe(0);
    const reply = await call('POST', '/messages', T.motA, { recipient_id: OWNER_A, body: 'Entregue, voltando' });
    expect(reply.status).toBe(201);
    expect((await call('GET', '/messages?box=sent', T.motA)).body.items).toHaveLength(1);
    expect((await call('GET', `/messages?peer=${MOT_A}`, T.ownerA)).body.items).toHaveLength(2);
    // "falar com a central" sem destinatário: quem criou a viagem; sem viagem, alguém da equipe ativa da empresa
    const central = await call('POST', '/messages', T.motA, { body: 'Chegando no cliente', trip_id: S.tripId });
    expect(central.status, JSON.stringify(central.body)).toBe(201);
    expect(central.body.recipient_id).toBe(OWNER_A);
    const semViagem = await call('POST', '/messages', T.motA, { body: 'Pneu furado' });
    expect(semViagem.status).toBe(201);
    expect([OWNER_A, GESTOR_A]).toContain(semViagem.body.recipient_id);
    expect((await call('POST', '/messages', T.outsider, { body: 'oi' })).status).toBe(403);       // sem empresa
    await pool.query('delete from messages where id = any($1)', [[central.body.id, semViagem.body.id]]);
    // motorista → outro motorista da mesma empresa: bloqueado (precisa de um segundo motorista)
    await pool.query(`insert into company_members (company_id, user_id, role, display_name) values ($1, $2, 'motorista', 'Colega')`, [CO_A, OUTSIDER]);
    expect((await call('POST', '/messages', T.motA, { recipient_id: OUTSIDER, body: 'oi colega' })).status).toBe(403);
    expect((await call('POST', '/messages', T.ownerA, { recipient_id: MOT_B, body: 'vazando' })).status).toBe(403);            // outra empresa
    expect((await call('POST', '/messages', T.ownerA, { recipient_id: MOT_A, body: '' })).status).toBe(422);
    await pool.query(`delete from company_members where user_id = $1`, [OUTSIDER]);
  });

  it('cobrança: veículo ativo do mês × preço', async () => {
    const b = await call('GET', '/billing', T.ownerA);
    expect(b.status).toBe(200);
    expect(b.body.items[0].active_vehicles).toBe(1);
    expect(b.body.items[0].amount_cents).toBe(9900);
    expect(b.body.items[0].month).toMatch(/^\d{4}-\d{2}$/);
  });

  it('viagem avulsa, cancelamento e atribuição por equipe', async () => {
    const a = await call('POST', '/trips/start', T.motA, { title: 'Avulsa teste' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    expect(a.body.status).toBe('em_andamento');
    expect(a.body.vehicle_id).toBe(S.vehicleId);                           // veículo padrão do convite
    expect((await call('POST', `/trips/${a.body.id}/cancel`, T.motA)).body.status).toBe('cancelada');
    const p = await call('POST', '/trips', T.ownerA, { title: 'Sem rota' });
    expect(p.status).toBe(201);
    expect(p.body.status).toBe('planejada');
    expect(p.body.planned_route).toBeNull();
    const asg = await call('POST', `/trips/${p.body.id}/assign`, T.ownerA, { driver_id: MOT_A, vehicle_id: S.vehicleId });
    expect(asg.body.status).toBe('atribuida');
    const dl = await call('POST', `/trips/${p.body.id}/deliveries`, T.ownerA, [{ customer_name: 'A', address: 'Rua A, 1' }, { customer_name: 'B', address: 'Rua B, 2' }]);
    expect(dl.status).toBe(201);
    expect(dl.body.items.map((x: any) => x.sequence)).toEqual([1, 2]);
    expect((await call('POST', `/trips/${p.body.id}/cancel`, T.ownerA)).body.status).toBe('cancelada');
    expect((await call('POST', `/trips/${p.body.id}/assign`, T.ownerA, { driver_id: MOT_A })).status).toBe(403);     // cancelada
    expect((await call('POST', `/trips/${p.body.id}/assign`, T.ownerA, { driver_id: OWNER_A })).status).toBe(403);    // owner não é motorista
  });

  it('desativar o motorista corta o acesso na hora', async () => {
    const mem = await call('GET', '/members?role=motorista', T.ownerA);
    expect(mem.body.items.some((m: any) => m.user_id === MOT_A)).toBe(true);
    const d = await call('POST', `/members/${MOT_A}/status`, T.ownerA, { status: 'disabled' });
    expect(d.status).toBe(200);
    expect(d.body.status).toBe('disabled');
    expect((await call('GET', '/trips', T.motA)).body.items).toEqual([]);
    expect((await call('POST', '/trips/start', T.motA, {})).status).toBe(403);
    expect((await call('POST', `/members/${OWNER_A}/status`, T.ownerA, { status: 'disabled' })).status).toBe(403);   // ninguém desativa a si/owner
    expect((await call('POST', `/members/${MOT_A}/status`, T.ownerA, { status: 'active' })).body.status).toBe('active');
    expect((await call('GET', '/trips', T.motA)).body.items.length).toBeGreaterThan(0);
  });
});

describe('papéis: motorista não acessa rotas de equipe', () => {
  it('403 em tudo que é só da equipe', async () => {
    const t = T.motA;
    const checks: [string, string, unknown?][] = [
      ['POST', '/trips', { title: 'x' }], ['POST', `/trips/${S.tripId}/assign`, { driver_id: MOT_A }],
      ['POST', `/trips/${S.tripId}/deliveries`, { customer_name: 'x', address: 'y' }],
      ['POST', '/invites', { role: 'motorista' }], ['GET', '/invites'], ['POST', `/invites/${S.inviteId}/revoke`],
      ['GET', '/members'], ['POST', `/members/${OWNER_A}/status`, { status: 'disabled' }],
      ['POST', '/vehicles', { plate: 'QQQ1Q11' }], ['PATCH', `/vehicles/${S.vehicleId}`, { label: 'hack' }],
      ['GET', '/billing'], ['POST', '/jobs/compaction', {}],
    ];
    for (const [m, p, b] of checks) {
      const r = await call(m, p, t, b ?? (m === 'POST' || m === 'PATCH' ? {} : undefined));
      expect(r.status, `${m} ${p}`).toBe(403);
    }
  });
  it('motorista não promove a si mesmo nem altera viagem de outro', async () => {
    const a = await call('POST', '/invites', T.ownerA, { role: 'motorista' });
    expect(a.status).toBe(201);
    expect((await call('POST', '/invites', T.ownerA, { role: 'gestor' })).status).toBe(201);   // owner convida gestor
    expect((await call('POST', `/trips/${S.tripId}/cancel`, T.motB)).status).toBe(403);
  });
});

describe('job de compactação', () => {
  it('só service_role', async () => {
    expect((await call('POST', '/jobs/compaction', T.ownerA, {})).status).toBe(403);
    expect((await call('POST', '/jobs/compaction', null, {})).status).toBe(401);
    const r = await call('POST', '/jobs/compaction', T.service, {});
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    for (const k of ['trips_compacted', 'driver_days_compacted', 'raw_pings_deleted', 'invites_expired']) expect(typeof r.body[k]).toBe('number');
  });
});

describe('isolamento: empresa B não lê nem altera nada da A', () => {
  it('listas vazias', async () => {
    for (const p of ['/trips', '/invites', '/messages']) {
      const r = await call('GET', p, T.ownerB);
      expect(r.status, p).toBe(200);
      expect(r.body.items, p).toEqual([]);
    }
    expect((await call('GET', '/vehicles', T.ownerB)).body.items.map((x: any) => x.plate)).toEqual(['BBB1B11']);   // só o dela
    expect((await call('GET', '/live', T.ownerB)).body.features).toEqual([]);
    const mem = await call('GET', '/members', T.ownerB);
    expect(mem.body.items.map((m: any) => m.user_id).sort()).toEqual([OWNER_B, MOT_B].sort());
    expect((await call('GET', '/billing', T.ownerB)).body.items.map((i: any) => i.amount_cents)).toEqual([9900]);   // só o dela (veículo da B)
    expect((await call('GET', '/me', T.ownerB)).body.company_id).toBe(CO_B);
  });

  it('leitura por id → 404', async () => {
    expect((await call('GET', `/trips/${S.tripId}`, T.ownerB)).status).toBe(404);
    expect((await call('GET', `/trips/${S.tripId}`, T.motB)).status).toBe(404);
    expect((await call('PATCH', `/stops/${S.autoStopId}`, T.ownerB, { type: 'imprevisto' })).status).toBe(404);
    expect((await call('PATCH', `/vehicles/${S.vehicleId}`, T.ownerB, { label: 'hack' })).status).toBe(404);
    expect((await call('POST', `/trips/${S.tripId}/deliveries`, T.ownerB, { customer_name: 'x', address: 'y' })).status).toBe(404);
  });

  it('escrita/RPC cruzada → 403', async () => {
    expect((await call('POST', `/trips/${S.tripId}/assign`, T.ownerB, { driver_id: MOT_B })).status).toBe(403);
    expect((await call('POST', `/trips/${S.tripId}/start`, T.ownerB, {})).status).toBe(403);
    expect((await call('POST', `/trips/${S.tripId}/end`, T.ownerB)).status).toBe(403);
    expect((await call('POST', `/trips/${S.tripId}/cancel`, T.ownerB)).status).toBe(403);
    expect((await call('PATCH', `/deliveries/${S.deliveryId}`, T.ownerB, { status: 'falhou', failure_reason: 'x' })).status).toBe(403);
    expect((await call('POST', `/invites/${S.inviteId}/revoke`, T.ownerB)).status).toBe(403);
    expect((await call('POST', `/members/${MOT_A}/status`, T.ownerB, { status: 'disabled' })).status).toBe(403);
    expect((await call('POST', '/invites', T.ownerB, { role: 'motorista', vehicle_id: S.vehicleId })).status).toBe(403);   // veículo da A
    expect((await call('POST', '/messages', T.ownerB, { recipient_id: MOT_A, body: 'oi' })).status).toBe(403);
    expect((await call('POST', '/messages', T.ownerB, { recipient_id: MOT_B, body: 'ok', trip_id: S.tripId })).status).toBe(404);   // viagem da A
  });

  it('dados da B continuam intactos e a A não os vê', async () => {
    const v = await call('GET', '/vehicles', T.ownerA);
    expect(v.body.items.some((x: any) => x.plate === 'BBB1B11')).toBe(false);
    const b = await call('GET', '/vehicles', T.ownerB);
    expect(b.body.items.map((x: any) => x.plate)).toEqual(['BBB1B11']);
  });
});

/**
 * Regressões de dois bugs achados nas migrations 0302/0303 (corrigidos): cada teste roda direto no banco, como
 * `authenticated`, numa transação que é desfeita.
 */
describe('referências entre empresas e início de viagem (regressão)', () => {
  async function comoStaffA(fn: (c: import('pg').PoolClient) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`insert into trips (id, company_id, status, title) values ($1, $2, 'planejada', 'viagem B')`, [id(901), CO_B]);
      await c.query(`insert into trips (id, company_id, status, title) values ($1, $2, 'planejada', 'viagem A sem motorista')`, [id(902), CO_A]);
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: OWNER_A, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      await fn(c);
    } finally { await c.query('rollback').catch(() => {}); c.release(); }
  }

  it('equipe da A não grava entrega/viagem apontando para viagem ou veículo da B', async () => {
    await comoStaffA(async (c) => {
            await expect(c.query(`insert into deliveries (company_id, trip_id, customer_name, address) values ($1, $2, 'x', 'y')`, [CO_A, id(901)])).rejects.toThrow();
    });
    await comoStaffA(async (c) => {
      await expect(c.query(`insert into trips (company_id, vehicle_id, title) values ($1, $2, 't')`, [CO_A, S.vehB])).rejects.toThrow();
    });
  });

  it('equipe não vira motorista ao iniciar viagem sem motorista', async () => {
    await comoStaffA(async (c) => {
      await expect(c.query(`select (app.start_trip($1)).driver_id as d`, [id(902)])).rejects.toThrow(/atribua um motorista/);
    });
  });
});

describe('veículo com AETC (VUC liberado na ZMRC de SP)', () => {
  // achado da simulação de 60 dias: sem o campo no cadastro, todo VUC da frota era tratado como caminhão comum na ZMRC
  const SE = { lat: -23.5455, lon: -46.6360, label: 'Sé' };
  const viagem = (vehicle_id: string) => call('POST', '/trips', T.ownerA, {
    title: 'Barueri → Sé', vehicle_id, origin: { lat: -23.5010, lon: -46.8720, label: 'Barueri' }, destination: SE,
    departure_planned_at: '2026-11-03T08:00:00-03:00', plan_route: true,
  });
  const zonaNoDestino = (t: any) => (t.route_response?.warnings ?? []).some((w: any) => w.code === 'destination_in_zone' && /ZMRC/.test(w.message));
  let vuc = '';

  it('cadastro guarda has_aetc (padrão false) e o PATCH muda', async () => {
    const r = await call('POST', '/vehicles', T.ownerA, { plate: 'VUC1A21', preset: 'vuc', is_vuc: true });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.has_aetc).toBe(false);
    vuc = r.body.id;
  });

  it('sem AETC: entrega na Sé às 8h cai na ZMRC; com AETC, não', async () => {
    const sem = await viagem(vuc);
    expect(sem.status, JSON.stringify(sem.body)).toBe(201);
    expect(zonaNoDestino(sem.body)).toBe(true);
    const p = await call('PATCH', `/vehicles/${vuc}`, T.ownerA, { has_aetc: true });
    expect(p.body.has_aetc).toBe(true);
    const com = await viagem(vuc);
    expect(com.status, JSON.stringify(com.body)).toBe(201);
    expect(zonaNoDestino(com.body)).toBe(false);
    await pool.query('delete from trips where vehicle_id = $1', [vuc]);
  });
});

describe('janela do cliente que não cabe na viagem', () => {
  // achado da simulação de 60 dias: os mesmos atrasos toda semana vinham de janela impossível; agora o planejamento avisa
  const CAMPINAS = { lat: -22.9050, lon: -47.0600, label: 'Campinas' };
  const plano = (window_end: string) => call('POST', '/trips', T.ownerA, {
    title: 'CEAGESP → Campinas', origin: SP.origin, destination: CAMPINAS, departure_planned_at: '2026-11-03T08:00:00-03:00', plan_route: true,
    deliveries: [{ customer_name: 'Cliente Campinas', address: 'Centro de Campinas', window_end }],
  });
  const aviso = (t: any) => (t.route_response?.warnings ?? []).find((w: any) => w.code === 'janela_inviavel');

  it('janela até 8h30 para uma viagem de ~1h30: avisa com o horário-limite de saída', async () => {
    const r = await plano('2026-11-03T08:30:00-03:00');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const w = aviso(r.body);
    expect(w?.severity).toBe('danger');
    expect(w?.message).toMatch(/janela do cliente, que vai até 08:30\. Para chegar a tempo, a saída precisa ser até \d\d:\d\d/);
    await pool.query('delete from trips where id = $1', [r.body.id]);
  });

  it('janela até 14h: sem aviso', async () => {
    const r = await plano('2026-11-03T14:00:00-03:00');
    expect(r.status).toBe(201);
    expect(aviso(r.body)).toBeUndefined();
    await pool.query('delete from trips where id = $1', [r.body.id]);
  });
});

describe('multas: o motorista registra, a equipe completa e marca o feedback', () => {
  let multaId = '';
  const meio = async () => {
    const t = (await pool.query('select started_at, coalesce(ended_at, now()) as ended_at from trips where id = $1', [S.tripId])).rows[0];
    return new Date((new Date(t.started_at).getTime() + new Date(t.ended_at).getTime()) / 2).toISOString();
  };

  it('motorista registra pelo app; a viagem é ligada pelo horário; campos da equipe são ignorados', async () => {
    const r = await call('POST', '/multas', T.motA, {
      ocorrida_em: await meio(), lat: -23.55, lon: -46.70, local: 'Marginal Pinheiros', descricao: 'Fui parado pela CET',
      status: 'paga', feedback_enviado: true, pontos: 0,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.driver_id).toBe(MOT_A);
    expect(r.body.trip_id).toBe(S.tripId);
    expect(r.body.origem).toBe('motorista');
    expect(r.body.status).toBe('registrada');
    expect(r.body.feedback_enviado).toBe(false);
    expect(r.body.pontos).toBeNull();
    multaId = r.body.id;
  });

  it('motorista não altera; equipe completa o auto e marca "feedback enviado?"', async () => {
    expect((await call('PATCH', `/multas/${multaId}`, T.motA, { feedback_enviado: true })).status).toBe(403);
    const r = await call('PATCH', `/multas/${multaId}`, T.ownerA, {
      ait: 'S12345678', orgao: 'CET', gravidade: 'media', valor_cents: 13016, pontos: 4, status: 'notificada',
      prazo_indicacao: '2026-12-01', feedback_enviado: true, feedback_nota: 'Conversei sobre o horário da Marginal',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: 'notificada', gravidade: 'media', pontos: 4, feedback_enviado: true, driver_name: expect.any(String) });
    expect(r.body.feedback_por).toBe(OWNER_A);
    expect(r.body.feedback_em).toBeTruthy();
  });

  it('lista com resumo: equipe vê todas; motorista só as dele; outra empresa não vê', async () => {
    const e = await call('GET', '/multas?feedback=true', T.ownerA);
    expect(e.status).toBe(200);
    expect(e.body.items.map((x: any) => x.id)).toContain(multaId);
    expect(e.body.resumo).toMatchObject({ total: 1, sem_feedback: 0, valor_cents: 13016, pontos: 4 });
    expect((await call('GET', '/multas', T.motA)).body.items).toHaveLength(1);
    expect((await call('GET', '/multas', T.ownerB)).body.items).toHaveLength(0);
    expect((await call('GET', '/multas?status=inexistente', T.ownerA)).status).toBe(422);
  });

  it('desmarcar o feedback limpa quem e quando; AIT repetido na empresa → 409', async () => {
    const r = await call('PATCH', `/multas/${multaId}`, T.ownerA, { feedback_enviado: false });
    expect(r.body).toMatchObject({ feedback_enviado: false, feedback_em: null, feedback_por: null });
    const dup = await call('POST', '/multas', T.ownerA, { ait: 'S12345678', ocorrida_em: new Date().toISOString() });
    expect(dup.status).toBe(409);
    await pool.query('delete from multas where company_id = $1', [CO_A]);
  });
});
