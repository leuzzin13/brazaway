import type { FastifyInstance } from 'fastify';
import { query } from '../db.js';
import { vehiclePresets } from '../config.js';
import { describeWindows, zonesForDisplay } from '../services/zones.js';
import { makeGeocoder } from '../services/geocoder.js';
import { BboxQuery } from '../schemas.js';
import * as valhalla from '../services/valhalla.js';

const geocoder = makeGeocoder();

export async function miscRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => {
    let db = false;
    try { await query('select 1'); db = true; } catch { /* down */ }
    const v = await valhalla.status();
    return { ok: db && v.ok, db, valhalla: v.ok, valhalla_detail: v.detail };
  });

  app.get('/api/vehicles/presets', async () => vehiclePresets);

  app.get('/api/zones', async () => {
    const zones = await zonesForDisplay(0.0001);
    return {
      type: 'FeatureCollection',
      features: zones.map((z) => ({
        type: 'Feature',
        id: z.id,
        geometry: z.geometry,
        properties: { id: z.id, name: z.name, rules: z.rules, source: z.source, description: describeWindows(z.rules) },
      })),
    };
  });

  app.get('/api/rest-stops', async (req, reply) => {
    const q = BboxQuery.safeParse(req.query);
    if (!q.success) return reply.code(422).send({ error: 'VALIDATION', message: 'bbox=minLon,minLat,maxLon,maxLat obrigatório' });
    const r = await query(
      `select id, osm_id, name, kind, ST_Y(geom) as lat, ST_X(geom) as lon, tags from rest_stops where geom && ST_MakeEnvelope($1,$2,$3,$4,4326) limit 500`,
      q.data.bbox,
    );
    return r.rows;
  });

  app.get('/api/geocode', async (req, reply) => {
    const { q, lat, lon } = req.query as { q?: string; lat?: string; lon?: string };
    if (!q || q.trim().length < 3) return reply.code(422).send({ error: 'VALIDATION', message: 'q com pelo menos 3 caracteres' });
    return geocoder.search(q.trim(), { lat: lat ? Number(lat) : undefined, lon: lon ? Number(lon) : undefined });
  });
}
