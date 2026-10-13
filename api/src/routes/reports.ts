import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { BboxQuery, CreateReport, VoteInput } from '../schemas.js';

const COLS = `id, type, ST_AsGeoJSON(geom)::json as geometry, value_num::float as value_num, time_window, note,
  score, status, (score > 0) as confirmed, created_at, updated_at,
  case when type::text in ('radar_movel','blitz') then
    greatest(created_at, coalesce((select max(v.created_at) from report_votes v where v.report_id = reports.id and v.vote = 1), created_at))
    + make_interval(secs => report_ttl_hours(type::text) * 3600) end as expires_at`;

export async function reportRoutes(app: FastifyInstance) {
  app.get('/api/reports', async (req, reply) => {
    const q = BboxQuery.safeParse(req.query);
    if (!q.success) return reply.code(422).send({ error: 'VALIDATION', message: 'bbox=minLon,minLat,maxLon,maxLat obrigatório' });
    await query('select expire_stale_reports()');
    const r = await query(
      `select ${COLS} from reports where status = 'active' and geom && ST_MakeEnvelope($1,$2,$3,$4,4326)
       order by created_at desc limit 2000`,
      q.data.bbox,
    );
    return r.rows;
  });

  app.get('/api/reports/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await query('select expire_stale_reports()');
    const r = await query(`select ${COLS} from reports where id = $1`, [id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'NOT_FOUND' });
    return r.rows[0];
  });

  app.post('/api/reports', async (req, reply) => {
    const p = CreateReport.safeParse(req.body);
    if (!p.success) return reply.code(422).send({ error: 'VALIDATION', issues: p.error.issues });
    const d = p.data;
    const needsValue = ['low_clearance', 'weight_limit', 'length_limit', 'steep_grade'].includes(d.type);
    if (needsValue && d.value_num == null) return reply.code(422).send({ error: 'VALIDATION', message: `value_num obrigatório para ${d.type}` });
    const r = await query(
      `insert into reports (type, geom, value_num, time_window, note, device_id)
       values ($1, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326), $3, $4, $5, $6)
       returning ${COLS}`,
      [d.type, JSON.stringify(d.geometry), needsValue ? d.value_num : null, d.time_window ? JSON.stringify(d.time_window) : null, d.note ?? null, d.device_id],
    );
    return reply.code(201).send(r.rows[0]);
  });

  app.post('/api/reports/:id/votes', async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = VoteInput.safeParse(req.body);
    if (!p.success) return reply.code(422).send({ error: 'VALIDATION', issues: p.error.issues });
    const exists = await query('select 1 from reports where id = $1', [id]);
    if (!exists.rowCount) return reply.code(404).send({ error: 'NOT_FOUND' });
    await query(
      `insert into report_votes (report_id, device_id, vote) values ($1, $2, $3)
       on conflict (report_id, device_id) do update set vote = excluded.vote, created_at = now()`,
      [id, p.data.device_id, p.data.vote],
    );
    const r = await query('select id, score, status from reports where id = $1', [id]);
    return r.rows[0];
  });

  // Remoção pelo próprio device (usado pelos testes e para desfazer um reporte errado)
  app.delete('/api/reports/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { device_id } = (req.query as { device_id?: string }) ?? {};
    if (!device_id) return reply.code(422).send({ error: 'VALIDATION', message: 'device_id obrigatório' });
    const r = await query('delete from reports where id = $1 and device_id = $2', [id, device_id]);
    if (!r.rowCount) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.code(204).send();
  });
}
