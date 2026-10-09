import type { FastifyInstance } from 'fastify';
import { RouteRequest } from '../schemas.js';
import { computeRoute, RouteBlockedError } from '../services/routing.js';

export async function routeRoutes(app: FastifyInstance) {
  app.post('/api/route', async (req, reply) => {
    const parsed = RouteRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send({ error: 'VALIDATION', issues: parsed.error.issues });
    try {
      return await computeRoute(parsed.data);
    } catch (e) {
      if (e instanceof RouteBlockedError) {
        return reply.code(409).send({ error: 'NO_ROUTE', message: e.message, blocked_by: e.blocked_by });
      }
      throw e;
    }
  });
}
