import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { env } from '../config.js';
import { LatLon, VehicleInput } from '../schemas.js';
import { computeRoute, RouteBlockedError } from '../services/routing.js';
import { findPreset } from '../config.js';
import { asUser, httpError, requireService, withRls } from './auth.js';

/**
 * API da Frota (/api/frota/*). Toda rota exige `Authorization: Bearer <jwt do Supabase>` e roda numa transação com RLS
 * (auth.ts): a regra de negócio fica nas RPC do schema `app` (db/migrations/0303); aqui só entrada (zod), saída e erros.
 * Erros: 401 token; 403 permissão/regra de negócio das RPC e da RLS; 404 não existe (ou não é visível); 409 duplicidade;
 * 422 entrada inválida.
 */

// ------------------------------------------------------------------ entrada
const Uuid = z.string().uuid();
const IsoDateTime = z.string().datetime({ offset: true });
const Text = (max: number) => z.string().trim().min(1).max(max);

function parse<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const msg = r.error.issues.map((i) => `${i.path.join('.') || 'entrada'}: ${i.message}`).join('; ');
  throw httpError(422, `entrada inválida: ${msg}`);
}
const idParam = (req: FastifyRequest, name = 'id') => parse(Uuid, (req.params as Record<string, string>)[name]);

const Place = LatLon.extend({ label: z.string().trim().max(200).optional() });

const PingIn = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  speed_kmh: z.number().min(0).max(250).optional().nullable(),
  heading_deg: z.number().min(0).lt(360).optional().nullable(),
  accuracy_m: z.number().min(0).optional().nullable(),
  recorded_at: IsoDateTime,
  trip_id: Uuid.optional().nullable(),
});
const PingsBody = z.object({ pings: z.array(PingIn).min(1).max(500), vehicle_id: Uuid.optional().nullable() });

const TripStatus = z.enum(['planejada', 'atribuida', 'em_andamento', 'concluida', 'cancelada']);
const TripsQuery = z.object({
  status: z.string().optional().transform((s) => (s ? s.split(',') : undefined)).pipe(z.array(TripStatus).optional()),
  driver_id: Uuid.optional(),
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const DeliveryIn = z.object({
  customer_name: Text(200),
  address: Text(300),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  window_start: IsoDateTime.optional(),
  window_end: IsoDateTime.optional(),
  sequence: z.number().int().min(1).max(32000).optional(),
  notes: z.string().max(1000).optional(),
}).refine((d) => (d.lat === undefined) === (d.lon === undefined), { message: 'informe lat e lon juntos' });

const NewTrip = z.object({
  title: Text(200).optional(),
  origin: Place.optional(),
  destination: Place.optional(),
  departure_planned_at: IsoDateTime.optional(),
  driver_id: Uuid.optional(),
  vehicle_id: Uuid.optional(),
  plan_route: z.boolean().default(false),
  vehicle: VehicleInput.optional(),      // atributos extras/sobrescritas só para o cálculo da rota (hazmat_un, has_aetc...)
  deliveries: z.array(DeliveryIn).max(200).optional(),
}).refine((t) => !t.plan_route || (t.origin && t.destination), { message: 'plan_route exige origin e destination' });

const StopType = z.enum(['entrega', 'descanso', 'abastecimento', 'pernoite', 'imprevisto', 'nao_classificada']);
const NewStop = z.object({
  type: StopType,
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  arrived_at: IsoDateTime.optional(),
  departed_at: IsoDateTime.optional(),
  note: z.string().max(1000).optional(),
  trip_id: Uuid.optional(),
});
const PatchStop = z.object({
  type: StopType.optional(),
  note: z.string().max(1000).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  departed_at: IsoDateTime.nullable().optional(),
}).refine((s) => Object.keys(s).length > 0, { message: 'nada para alterar' });

const PatchDelivery = z.object({
  status: z.enum(['pendente', 'entregue', 'falhou']),
  failure_reason: z.string().trim().min(1).max(500).optional(),
  proof_photo_path: z.string().max(500).optional(),
  signature_path: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  stop_id: Uuid.optional(),
}).refine((d) => d.status !== 'falhou' || !!d.failure_reason, { message: 'informe o motivo da falha (failure_reason)', path: ['failure_reason'] });

const MessagesQuery = z.object({
  box: z.enum(['inbox', 'sent', 'all']).default('all'),
  peer: Uuid.optional(),
  trip_id: Uuid.optional(),
  unread: z.enum(['true', 'false', '1', '0']).optional().transform((v) => v === 'true' || v === '1'),
  before: IsoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const NewMessage = z.object({ recipient_id: Uuid, body: Text(4000), trip_id: Uuid.optional() });

const NewInvite = z.object({
  role: z.enum(['motorista', 'gestor']).default('motorista'),
  vehicle_id: Uuid.optional(),
  invitee_name: Text(120).optional(),
  invitee_email: z.string().email().max(200).optional(),
  invitee_phone: Text(30).optional(),
  valid_hours: z.number().int().min(1).max(720).default(72),
});
const AcceptInvite = z.object({ code: Text(40), display_name: Text(120), phone: Text(30).optional() });

const Plate = z.string().trim().transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')).pipe(z.string().regex(/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/, 'placa inválida'));
const VehicleFields = {
  label: z.string().trim().max(120).nullable().optional(),
  preset: z.string().max(60).nullable().optional(),
  height_m: z.number().positive().max(10).nullable().optional(),
  width_m: z.number().positive().max(5).nullable().optional(),
  length_m: z.number().positive().max(40).nullable().optional(),
  weight_t: z.number().positive().max(200).nullable().optional(),
  payload_t: z.number().nonnegative().max(150).nullable().optional(),
  axle_load_t: z.number().positive().max(30).nullable().optional(),
  axle_count: z.number().int().min(2).max(12).nullable().optional(),
  hazmat: z.boolean().optional(),
  is_vuc: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
};
const NewVehicle = z.object({ plate: Plate, ...VehicleFields });
const PatchVehicle = z.object({ plate: Plate.optional(), ...VehicleFields }).refine((v) => Object.keys(v).length > 0, { message: 'nada para alterar' });

// ------------------------------------------------------------------ saída (colunas)
type Db = pg.PoolClient;

const VEHICLE_COLS = `v.id, v.plate, v.label, v.preset, v.height_m::float8 as height_m, v.width_m::float8 as width_m,
  v.length_m::float8 as length_m, v.weight_t::float8 as weight_t, v.payload_t::float8 as payload_t,
  v.axle_load_t::float8 as axle_load_t, v.axle_count, v.hazmat, v.is_vuc, v.status, v.created_at, v.updated_at`;

const TRIP_COLS = `t.id, t.company_id, t.driver_id, m.display_name as driver_name, t.vehicle_id, v.plate as vehicle_plate, t.status, t.title,
  ST_AsGeoJSON(t.origin)::jsonb as origin, t.origin_label, ST_AsGeoJSON(t.destination)::jsonb as destination, t.destination_label,
  t.departure_planned_at, t.planned_distance_m, t.planned_duration_s, t.started_at, t.ended_at, t.distance_m, t.duration_s,
  t.deviation_max_m, t.summary, t.created_by, t.created_at, t.updated_at`;
const TRIP_FROM = `from trips t left join company_members m on m.user_id = t.driver_id left join vehicles v on v.id = t.vehicle_id`;

const STOP_COLS = `s.id, s.trip_id, s.driver_id, s.type, s.source, ST_Y(s.geom) as lat, ST_X(s.geom) as lon, s.address, s.arrived_at,
  s.departed_at, s.duration_s, s.note, s.created_at, s.updated_at`;
const DELIVERY_COLS = `d.id, d.trip_id, d.stop_id, d.sequence, d.customer_name, d.address, ST_Y(d.geom) as lat, ST_X(d.geom) as lon,
  d.window_start, d.window_end, d.status, d.status_at, d.failure_reason, d.proof_photo_path, d.signature_path, d.notes,
  d.created_at, d.updated_at`;

async function tripById(c: Db, id: string, full: boolean) {
  const extra = full
    ? `, ST_AsGeoJSON(ST_Force2D(t.planned_route))::jsonb as planned_route, ST_AsGeoJSON(ST_Force2D(t.actual_route))::jsonb as actual_route,
       (select array_agg(ST_M(g.geom) order by g.path) from ST_DumpPoints(t.actual_route) g) as actual_route_times,
       t.route_response,
       coalesce((select jsonb_agg(to_jsonb(x) order by x.arrived_at) from (select ${STOP_COLS} from stops s where s.trip_id = t.id) x), '[]') as stops,
       coalesce((select jsonb_agg(to_jsonb(x) order by x.sequence, x.created_at) from (select ${DELIVERY_COLS} from deliveries d where d.trip_id = t.id) x), '[]') as deliveries`
    : '';
  const r = await c.query(`select ${TRIP_COLS}${extra} ${TRIP_FROM} where t.id = $1`, [id]);
  if (!r.rows[0]) throw httpError(404, 'viagem não encontrada');
  return r.rows[0];
}

async function one<T = any>(c: Db, sql: string, params: unknown[], notFound: string): Promise<T> {
  const r = await c.query(sql, params);
  if (!r.rows[0]) throw httpError(404, notFound);
  return r.rows[0] as T;
}

async function requireStaff(c: Db) {
  const r = await c.query('select app.is_staff() as ok');
  if (!r.rows[0].ok) throw httpError(403, 'apenas a equipe da empresa (owner, admin ou gestor)');
}

/** monta `col = $n, ...` só com os campos presentes (as chaves vêm de schemas zod fixos, nunca do cliente) */
function setClause(fields: Record<string, unknown>, firstParam: number) {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  return { sql: entries.map(([k], i) => `${k} = $${firstParam + i}`).join(', '), params: entries.map(([, v]) => v) };
}

const point = (lat: number | undefined, lon: number | undefined) => (lat === undefined ? null : { lat, lon });

/** linha de vehicles → formato de veículo da API de rota (POST /api/route) */
function vehicleToApi(v: Record<string, any>): z.infer<typeof VehicleInput> {
  const o: Record<string, unknown> = {};
  if (v.preset) o.preset = v.preset;
  for (const k of ['height_m', 'width_m', 'length_m', 'weight_t', 'payload_t', 'axle_load_t', 'axle_count'] as const) {
    if (v[k] !== null && v[k] !== undefined) o[k] = Number(v[k]);
  }
  o.hazmat = !!v.hazmat;
  o.is_vuc = !!v.is_vuc;
  const last = Number(String(v.plate).slice(-1));
  if (Number.isInteger(last)) o.plate_last_digit = last;
  return o as z.infer<typeof VehicleInput>;
}

// ------------------------------------------------------------------ rotas
export async function frotaRoutes(app: FastifyInstance) {
  app.register(async (api) => {
    // ---------------------------------------------------------- perfil
    api.get('/me', (req) => asUser(req, async (c, claims) => {
      const r = await c.query(
        `select m.user_id, m.role, m.status, m.display_name, m.phone, m.default_vehicle_id, co.id as company_id, co.name as company_name,
                co.ping_interval_moving_s, co.ping_interval_stopped_s
           from company_members m join companies co on co.id = m.company_id where m.user_id = $1`, [claims.sub]);
      return r.rows[0] ?? { user_id: claims.sub, role: null, company_id: null };   // autenticado, mas sem convite aceito
    }));

    // ---------------------------------------------------------- pings
    api.post('/pings', (req) => asUser(req, async (c) => {
      const b = parse(PingsBody, req.body);
      const r = await c.query('select app.send_pings($1::jsonb, $2::uuid) as r', [JSON.stringify(b.pings), b.vehicle_id ?? null]);
      const x = r.rows[0].r;
      return { accepted: x.accepted, received: b.pings.length, trip_id: x.trip_id, interval_moving_s: x.interval_moving_s, interval_stopped_s: x.interval_stopped_s };
    }));

    // ---------------------------------------------------------- viagens
    api.get('/trips', (req) => asUser(req, async (c) => {
      const q = parse(TripsQuery, req.query);
      const w: string[] = []; const p: unknown[] = [];
      if (q.status) { p.push(q.status); w.push(`t.status::text = any($${p.length})`); }
      if (q.driver_id) { p.push(q.driver_id); w.push(`t.driver_id = $${p.length}`); }
      if (q.from) { p.push(q.from); w.push(`coalesce(t.started_at, t.departure_planned_at, t.created_at) >= $${p.length}`); }
      if (q.to) { p.push(q.to); w.push(`coalesce(t.started_at, t.departure_planned_at, t.created_at) <= $${p.length}`); }
      p.push(q.limit, q.offset);
      const r = await c.query(
        `select ${TRIP_COLS} ${TRIP_FROM} ${w.length ? 'where ' + w.join(' and ') : ''}
          order by coalesce(t.started_at, t.departure_planned_at, t.created_at) desc, t.id limit $${p.length - 1} offset $${p.length}`, p);
      return { items: r.rows, limit: q.limit, offset: q.offset };
    }));

    // viagem avulsa (declarada antes de /trips/:id/... não há conflito: rota estática vence)
    api.post('/trips/start', (req) => asUser(req, async (c) => {
      const b = parse(z.object({ title: Text(200).optional(), vehicle_id: Uuid.optional() }), req.body ?? {});
      const r = await c.query('select (app.start_trip(null, $1, $2)).id as id', [b.title ?? null, b.vehicle_id ?? null]);
      return tripById(c, r.rows[0].id, false);
    }));

    api.get('/trips/:id', (req) => asUser(req, (c) => tripById(c, idParam(req), true)));

    api.post('/trips', async (req, reply) => {
      const b = parse(NewTrip, req.body);
      // 1) contexto e veículo (transação curta); 2) cálculo da rota sem segurar conexão; 3) grava tudo numa transação
      const ctx = await asUser(req, async (c) => {
        await requireStaff(c);
        let veh: Record<string, any> | null = null;
        if (b.vehicle_id) veh = await one(c, `select v.id, v.plate, v.preset, v.height_m, v.width_m, v.length_m, v.weight_t, v.payload_t,
                                                      v.axle_load_t, v.axle_count, v.hazmat, v.is_vuc from vehicles v where v.id = $1`,
                                           [b.vehicle_id], 'veículo não encontrado');
        if (b.driver_id) await one(c, `select 1 from company_members where user_id = $1 and role = 'motorista'`, [b.driver_id], 'motorista não encontrado');
        return { veh };
      });

      let plan: Awaited<ReturnType<typeof computeRoute>> | null = null;
      if (b.plan_route) {
        const merged = { ...(ctx.veh ? vehicleToApi(ctx.veh) : {}), ...(b.vehicle ?? {}) };
        const vehicle = parse(VehicleInput, merged);
        const departure = b.departure_planned_at ? DateTime.fromISO(b.departure_planned_at, { setZone: true }).setZone(env.tz).toFormat("yyyy-MM-dd'T'HH:mm") : undefined;
        try {
          plan = await computeRoute({ origin: b.origin!, destination: b.destination!, departure_at: departure, vehicle });
        } catch (e) {
          if (e instanceof RouteBlockedError) return reply.code(409).send({ error: 'NO_ROUTE', message: e.message, blocked_by: e.blocked_by, limited_by: e.limited_by });
          throw e;
        }
      }

      const trip = await asUser(req, async (c) => {
        const route = plan
          ? { geojson: JSON.stringify(plan.geometry), dist: Math.round(plan.distance_km * 1000), dur: Math.round(plan.duration_s),
              resp: JSON.stringify({ avoided: plan.avoided, warnings: plan.warnings, rest_stops: plan.rest_stops, driving_plan: plan.driving_plan,
                                     eta_horario: plan.eta_horario, departure_at: plan.departure_at, vehicle: plan.vehicle }) }
          : null;
        const ins = await c.query(
          `insert into trips (company_id, status, title, origin, origin_label, destination, destination_label, departure_planned_at,
                              vehicle_id, planned_route, planned_distance_m, planned_duration_s, route_response, created_by)
           values (app.company_id(), 'planejada', $1,
                   case when $2::float8 is null then null else ST_SetSRID(ST_MakePoint($3::float8, $2::float8), 4326) end, $4,
                   case when $5::float8 is null then null else ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326) end, $7,
                   $8::timestamptz, $9::uuid,
                   case when $10::text is null then null else ST_Force2D(ST_SetSRID(ST_GeomFromGeoJSON($10::text), 4326)) end,
                   $11::int, $12::int, $13::jsonb, auth.uid())
           returning id`,
          [b.title ?? null, b.origin?.lat ?? null, b.origin?.lon ?? null, b.origin?.label ?? null,
           b.destination?.lat ?? null, b.destination?.lon ?? null, b.destination?.label ?? null,
           b.departure_planned_at ?? null, b.vehicle_id ?? null, route?.geojson ?? null, route?.dist ?? null, route?.dur ?? null, route?.resp ?? null]);
        const id: string = ins.rows[0].id;
        let seq = 0;
        for (const d of b.deliveries ?? []) {
          seq += 1;
          const pt = point(d.lat, d.lon);
          await c.query(
            `insert into deliveries (company_id, trip_id, sequence, customer_name, address, geom, window_start, window_end, notes)
             values (app.company_id(), $1, $2, $3, $4, case when $5::float8 is null then null else ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326) end,
                     $7::timestamptz, $8::timestamptz, $9)`,
            [id, d.sequence ?? seq, d.customer_name, d.address, pt?.lat ?? null, pt?.lon ?? null, d.window_start ?? null, d.window_end ?? null, d.notes ?? null]);
        }
        if (b.driver_id) await c.query('select app.assign_trip($1, $2, $3)', [id, b.driver_id, b.vehicle_id ?? null]);
        return tripById(c, id, true);
      });
      return reply.code(201).send(trip);
    });

    api.post('/trips/:id/assign', (req) => asUser(req, async (c) => {
      const id = idParam(req);
      const b = parse(z.object({ driver_id: Uuid, vehicle_id: Uuid.optional() }), req.body);
      await c.query('select app.assign_trip($1, $2, $3)', [id, b.driver_id, b.vehicle_id ?? null]);
      return tripById(c, id, false);
    }));

    api.post('/trips/:id/start', (req) => asUser(req, async (c) => {
      const id = idParam(req);
      const b = parse(z.object({ vehicle_id: Uuid.optional() }), req.body ?? {});
      await c.query('select app.start_trip($1, null, $2)', [id, b.vehicle_id ?? null]);
      return tripById(c, id, false);
    }));

    api.post('/trips/:id/end', (req) => asUser(req, async (c) => {
      const id = idParam(req);
      await c.query('select app.end_trip($1, false)', [id]);
      return tripById(c, id, true);
    }));

    api.post('/trips/:id/cancel', (req) => asUser(req, async (c) => {
      const id = idParam(req);
      await c.query('select app.end_trip($1, true)', [id]);
      return tripById(c, id, false);
    }));

    // ---------------------------------------------------------- paradas
    api.post('/stops', async (req, reply) => {
      const stop = await asUser(req, async (c) => {
        const b = parse(NewStop, req.body);
        const r = await c.query('select (app.register_stop($1::app.stop_type, $2, $3, coalesce($4::timestamptz, now()), $5::timestamptz, $6, $7::uuid)).id as id',
          [b.type, b.lat, b.lon, b.arrived_at ?? null, b.departed_at ?? null, b.note ?? null, b.trip_id ?? null]);
        return one(c, `select ${STOP_COLS} from stops s where s.id = $1`, [r.rows[0].id], 'parada não encontrada');
      });
      return reply.code(201).send(stop);
    });

    api.patch('/stops/:id', (req) => asUser(req, async (c) => {
      const id = idParam(req);
      const b = parse(PatchStop, req.body);
      const s = setClause(b, 2);
      const r = await c.query(`update stops set ${s.sql} where id = $1 returning id`, [id, ...s.params]);
      if (!r.rows[0]) throw httpError(404, 'parada não encontrada');
      return one(c, `select ${STOP_COLS} from stops s where s.id = $1`, [id], 'parada não encontrada');
    }));

    // ---------------------------------------------------------- entregas
    api.post('/trips/:id/deliveries', async (req, reply) => {
      const out = await asUser(req, async (c) => {
        const tripId = idParam(req);
        await requireStaff(c);
        await one(c, 'select 1 from trips where id = $1', [tripId], 'viagem não encontrada');   // visível pela RLS = da empresa
        const items = parse(z.union([DeliveryIn, z.array(DeliveryIn).min(1).max(200)]), req.body);
        const list = Array.isArray(items) ? items : [items];
        const seqR = await c.query('select coalesce(max(sequence), 0) as n from deliveries where trip_id = $1', [tripId]);
        let seq = Number(seqR.rows[0].n);
        const ids: string[] = [];
        for (const d of list) {
          seq += 1;
          const r = await c.query(
            `insert into deliveries (company_id, trip_id, sequence, customer_name, address, geom, window_start, window_end, notes)
             values (app.company_id(), $1, $2, $3, $4, case when $5::float8 is null then null else ST_SetSRID(ST_MakePoint($6::float8, $5::float8), 4326) end,
                     $7::timestamptz, $8::timestamptz, $9) returning id`,
            [tripId, d.sequence ?? seq, d.customer_name, d.address, d.lat ?? null, d.lon ?? null, d.window_start ?? null, d.window_end ?? null, d.notes ?? null]);
          ids.push(r.rows[0].id);
        }
        const rows = await c.query(`select ${DELIVERY_COLS} from deliveries d where d.id = any($1::uuid[]) order by d.sequence`, [ids]);
        return Array.isArray(items) ? { items: rows.rows } : rows.rows[0];
      });
      return reply.code(201).send(out);
    });

    api.patch('/deliveries/:id', (req) => asUser(req, async (c) => {
      const id = idParam(req);
      const b = parse(PatchDelivery, req.body);
      await c.query('select app.register_delivery($1, $2::app.delivery_status, $3, $4, $5, $6, $7::uuid)',
        [id, b.status, b.failure_reason ?? null, b.proof_photo_path ?? null, b.signature_path ?? null, b.notes ?? null, b.stop_id ?? null]);
      return one(c, `select ${DELIVERY_COLS} from deliveries d where d.id = $1`, [id], 'entrega não encontrada');
    }));

    // ---------------------------------------------------------- mensagens
    api.get('/messages', (req) => asUser(req, async (c, claims) => {
      const q = parse(MessagesQuery, req.query);
      const w: string[] = ['$1::uuid is not null']; const p: unknown[] = [claims.sub];
      if (q.box === 'inbox' || q.unread) w.push('x.recipient_id = $1');
      if (q.box === 'sent') w.push('x.sender_id = $1');
      if (q.unread) w.push('x.read_at is null');
      if (q.peer) { p.push(q.peer); w.push(`(x.sender_id = $${p.length} or x.recipient_id = $${p.length})`); }
      if (q.trip_id) { p.push(q.trip_id); w.push(`x.trip_id = $${p.length}`); }
      if (q.before) { p.push(q.before); w.push(`x.created_at < $${p.length}`); }
      p.push(q.limit);
      const r = await c.query(
        `select x.id, x.trip_id, x.sender_id, sm.display_name as sender_name, x.recipient_id, rm.display_name as recipient_name,
                x.body, x.read_at, x.created_at
           from messages x left join company_members sm on sm.user_id = x.sender_id left join company_members rm on rm.user_id = x.recipient_id
          where ${w.join(' and ')} order by x.created_at desc, x.id limit $${p.length}`, p);
      return { items: r.rows, limit: q.limit };
    }));

    api.post('/messages', async (req, reply) => {
      const msg = await asUser(req, async (c, claims) => {
        const b = parse(NewMessage, req.body);
        if (b.trip_id) await one(c, 'select 1 from trips where id = $1', [b.trip_id], 'viagem não encontrada');
        // a política de INSERT (can_message) recusa destinatário de outra empresa e motorista → motorista
        const r = await c.query(
          `insert into messages (company_id, trip_id, sender_id, recipient_id, body) values (app.company_id(), $1, $2, $3, $4)
           returning id, trip_id, sender_id, recipient_id, body, read_at, created_at`, [b.trip_id ?? null, claims.sub, b.recipient_id, b.body]);
        return r.rows[0];
      });
      return reply.code(201).send(msg);
    });

    api.post('/messages/read', (req) => asUser(req, async (c) => {
      const b = parse(z.object({ ids: z.array(Uuid).min(1).max(500) }), req.body);
      const r = await c.query('select app.mark_messages_read($1::uuid[]) as n', [b.ids]);
      return { marked: r.rows[0].n };
    }));

    // ---------------------------------------------------------- convites e membros
    api.post('/invites', async (req, reply) => {
      const out = await asUser(req, async (c) => {
        const b = parse(NewInvite, req.body ?? {});
        const r = await c.query(
          'select invite_id, code, expires_at from app.create_invite($1::app.member_role, $2::uuid, $3, $4, $5, $6)',
          [b.role, b.vehicle_id ?? null, b.invitee_name ?? null, b.invitee_email ?? null, b.invitee_phone ?? null, b.valid_hours]);
        // o código em claro só existe nesta resposta
        return { id: r.rows[0].invite_id, code: r.rows[0].code, expires_at: r.rows[0].expires_at, role: b.role };
      });
      return reply.code(201).send(out);
    });

    const INVITE_COLS = `i.id, i.role, i.invitee_name, i.invitee_email, i.invitee_phone, i.vehicle_id, i.code_hint, i.expires_at, i.status,
      case when i.status = 'pendente' and i.expires_at <= now() then 'expirado' else i.status::text end as effective_status,
      i.created_by, i.created_at, i.accepted_at, i.accepted_by, i.revoked_at`;

    api.get('/invites', (req) => asUser(req, async (c) => {
      await requireStaff(c);
      const q = parse(z.object({ status: z.enum(['pendente', 'aceito', 'expirado', 'revogado']).optional() }), req.query);
      const r = await c.query(
        `select * from (select ${INVITE_COLS} from invites i) i ${q.status ? 'where effective_status = $1' : ''} order by created_at desc`,
        q.status ? [q.status] : []);
      return { items: r.rows };
    }));

    api.post('/invites/accept', (req) => asUser(req, async (c) => {
      const b = parse(AcceptInvite, req.body);
      const r = await c.query('select (app.accept_invite($1, $2, $3)).user_id as user_id', [b.code, b.display_name, b.phone ?? null]);
      return one(c, `select m.user_id, m.role, m.status, m.display_name, m.phone, m.default_vehicle_id, co.id as company_id, co.name as company_name,
                            co.ping_interval_moving_s, co.ping_interval_stopped_s
                       from company_members m join companies co on co.id = m.company_id where m.user_id = $1`, [r.rows[0].user_id], 'membro não encontrado');
    }));

    api.post('/invites/:id/revoke', (req) => asUser(req, async (c) => {
      const id = idParam(req);
      await c.query('select app.revoke_invite($1)', [id]);
      return one(c, `select ${INVITE_COLS} from invites i where i.id = $1`, [id], 'convite não encontrado');
    }));

    api.get('/members', (req) => asUser(req, async (c) => {
      await requireStaff(c);
      const q = parse(z.object({ role: z.enum(['owner', 'admin', 'gestor', 'motorista']).optional(), status: z.enum(['active', 'disabled']).optional() }), req.query);
      const w: string[] = []; const p: unknown[] = [];
      if (q.role) { p.push(q.role); w.push(`role::text = $${p.length}`); }
      if (q.status) { p.push(q.status); w.push(`status::text = $${p.length}`); }
      const r = await c.query(
        `select user_id, role, status, display_name, phone, default_vehicle_id, invite_id, disabled_at, created_at
           from company_members ${w.length ? 'where ' + w.join(' and ') : ''} order by role, display_name`, p);
      return { items: r.rows };
    }));

    api.post('/members/:userId/status', (req) => asUser(req, async (c) => {
      const userId = idParam(req, 'userId');
      const b = parse(z.object({ status: z.enum(['active', 'disabled']) }), req.body);
      await c.query('select app.set_member_status($1, $2::app.member_status)', [userId, b.status]);
      return one(c, `select user_id, role, status, display_name, phone, default_vehicle_id, disabled_at from company_members where user_id = $1`,
        [userId], 'membro não encontrado');
    }));

    // ---------------------------------------------------------- veículos
    api.get('/vehicles', (req) => asUser(req, async (c) => {
      const q = parse(z.object({ status: z.enum(['active', 'inactive']).optional() }), req.query);
      const r = await c.query(`select ${VEHICLE_COLS} from vehicles v ${q.status ? 'where v.status::text = $1' : ''} order by v.plate`, q.status ? [q.status] : []);
      return { items: r.rows };
    }));

    api.post('/vehicles', async (req, reply) => {
      const v = await asUser(req, async (c) => {
        await requireStaff(c);
        const b = parse(NewVehicle, req.body);
        const pr = b.preset ? findPreset(b.preset) : undefined;
        if (b.preset && !pr) throw httpError(422, `preset de veículo desconhecido: ${b.preset}`);
        // dimensões omitidas vêm do preset (config/vehicle-presets.json); o que foi informado vale
        const pick = <T>(x: T | null | undefined, d: T | undefined) => (x === undefined || x === null ? d ?? null : x);
        const r = await c.query(
          `insert into vehicles (company_id, plate, label, preset, height_m, width_m, length_m, weight_t, payload_t, axle_load_t, axle_count,
                                 hazmat, is_vuc, status)
           values (app.company_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::app.vehicle_status) returning id`,
          [b.plate, b.label ?? null, pr?.id ?? b.preset ?? null, pick(b.height_m, pr?.height_m), pick(b.width_m, pr?.width_m), pick(b.length_m, pr?.length_m),
           pick(b.weight_t, pr?.weight_t), pick(b.payload_t, pr?.payload_t), pick(b.axle_load_t, pr?.axle_load_t), pick(b.axle_count, pr?.axle_count),
           b.hazmat ?? pr?.hazmat ?? false, b.is_vuc ?? pr?.is_vuc ?? false, b.status ?? 'active']);
        return one(c, `select ${VEHICLE_COLS} from vehicles v where v.id = $1`, [r.rows[0].id], 'veículo não encontrado');
      });
      return reply.code(201).send(v);
    });

    api.patch('/vehicles/:id', (req) => asUser(req, async (c) => {
      const id = idParam(req);
      await requireStaff(c);
      const b = parse(PatchVehicle, req.body);
      if (b.preset && !findPreset(b.preset)) throw httpError(422, `preset de veículo desconhecido: ${b.preset}`);
      const { status, ...rest } = b;
      const s = setClause({ ...rest, ...(status ? { status } : {}) }, 2);
      const sql = s.sql.replace(/status = \$(\d+)/, 'status = $$$1::app.vehicle_status');
      const r = await c.query(`update vehicles set ${sql} where id = $1 returning id`, [id, ...s.params]);
      if (!r.rows[0]) throw httpError(404, 'veículo não encontrado');
      return one(c, `select ${VEHICLE_COLS} from vehicles v where v.id = $1`, [id], 'veículo não encontrado');
    }));

    // ---------------------------------------------------------- ao vivo e cobrança
    api.get('/live', (req) => asUser(req, async (c) => {
      const r = await c.query(
        `select l.driver_id, m.display_name, l.vehicle_id, v.plate, l.trip_id, l.speed_kmh, l.heading_deg, l.accuracy_m, l.moving, l.recorded_at,
                extract(epoch from now() - l.recorded_at)::int as age_s, ST_X(l.geom) as lon, ST_Y(l.geom) as lat
           from live_positions l left join company_members m on m.user_id = l.driver_id left join vehicles v on v.id = l.vehicle_id
          order by m.display_name nulls last, l.driver_id`);
      return {
        type: 'FeatureCollection',
        features: r.rows.map(({ lon, lat, ...props }) => ({ type: 'Feature', id: props.driver_id, geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props })),
      };
    }));

    api.get('/billing', (req) => asUser(req, async (c) => {
      await requireStaff(c);
      const q = parse(z.object({ from: z.string().regex(/^\d{4}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}$/).optional() }), req.query);
      const w: string[] = []; const p: unknown[] = [];
      if (q.from) { p.push(`${q.from}-01`); w.push(`b.month >= $${p.length}::date`); }
      if (q.to) { p.push(`${q.to}-01`); w.push(`b.month <= $${p.length}::date`); }
      const r = await c.query(
        `select to_char(b.month, 'YYYY-MM') as month, b.active_vehicles::int as active_vehicles, b.amount_cents::int as amount_cents, co.price_per_vehicle_cents
           from billing_active_vehicles_monthly b join companies co on co.id = b.company_id
          ${w.length ? 'where ' + w.join(' and ') : ''} order by b.month desc`, p);
      return { items: r.rows };
    }));

    // ---------------------------------------------------------- job (service_role)
    api.post('/jobs/compaction', async (req, reply) => {
      const claims = await requireService(req, reply);
      return runCompaction(claims);
    });
  }, { prefix: '/api/frota' });
}

type ServiceClaims = Parameters<typeof withRls>[0];

/** Executa app.run_compaction() com o papel service_role (compacta viagens/rastros, expira convites, apaga pings crus vencidos). */
export function runCompaction(claims: ServiceClaims = { role: 'service_role' }) {
  return withRls(claims, async (c) => (await c.query('select app.run_compaction() as r')).rows[0].r);
}

/** Agenda o job a cada N minutos (FROTA_JOBS_INTERVAL_MIN). Falha do job só é registrada: não derruba a API. */
export function startFrotaJobs(log: { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void }) {
  const min = Number(process.env.FROTA_JOBS_INTERVAL_MIN);
  if (!process.env.FROTA_JOBS_INTERVAL_MIN || !Number.isFinite(min) || min <= 0) return null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { log.info(await runCompaction(), 'frota: job de compactação'); }
    catch (e) { log.error(e, 'frota: job de compactação falhou'); }
    finally { running = false; }
  };
  const timer = setInterval(tick, min * 60_000);
  timer.unref();
  log.info({ every_min: min }, 'frota: job de compactação agendado');
  return timer;
}
