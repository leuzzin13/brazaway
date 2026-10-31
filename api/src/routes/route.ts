import type { FastifyInstance } from 'fastify';
import { RouteRequest } from '../schemas.js';
import { z } from 'zod';
import { computeRoute, evaluateLine, RouteBlockedError } from '../services/routing.js';

export async function routeRoutes(app: FastifyInstance) {
  app.post('/api/route', async (req, reply) => {
    const parsed = RouteRequest.safeParse(req.body);
    if (!parsed.success) return reply.code(422).send({ error: 'VALIDATION', issues: parsed.error.issues });
    try {
      return await computeRoute(parsed.data);
    } catch (e) {
      if (e instanceof RouteBlockedError) {
        return reply.code(409).send({ error: 'NO_ROUTE', message: e.message, blocked_by: e.blocked_by, limited_by: e.limited_by });
      }
      throw e;
    }
  });

  // Simulação comparativa (sim/): confere uma rota de fora (GPS de carro) contra as restrições. Só em desenvolvimento.
  if (process.env.SIM_ENDPOINTS === '1') {
    const Avaliar = z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])).min(2).max(50_000) });
    app.post('/api/sim/avaliar', { bodyLimit: 8_000_000 }, async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const parsed = RouteRequest.safeParse(body);
      const linha = Avaliar.safeParse(body);
      if (!parsed.success || !linha.success) return reply.code(422).send({ error: 'VALIDATION', issues: [...(parsed.error?.issues ?? []), ...(linha.error?.issues ?? [])] });
      return evaluateLine(parsed.data, linha.data.coordinates);
    });
  }
}
