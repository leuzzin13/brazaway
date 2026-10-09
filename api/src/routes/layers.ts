import type { FastifyInstance } from 'fastify';
import { loadLayers, getLayer } from '../layers/index.js';
import { lastRuns } from '../layers/data.js';
import { BboxQuery } from '../schemas.js';

export async function layerRoutes(app: FastifyInstance) {
  // Catálogo de camadas (para o painel do mapa e a tela de fontes)
  app.get('/api/layers', async () => {
    const layers = await loadLayers();
    const runs = await lastRuns().catch(() => []);
    return layers.map((l) => ({
      ...l.meta,
      has_features: !!l.features,
      affects_route: !!(l.exclusions || l.costLines),
      annotates_route: !!l.annotate,
      runs: runs.filter((r: any) => r.layer_id === l.meta.id),
    }));
  });

  app.get('/api/layers/:id/features', async (req, reply) => {
    const { id } = req.params as { id: string };
    const layer = await getLayer(id);
    if (!layer?.features) return reply.code(404).send({ error: 'NOT_FOUND' });
    const q = BboxQuery.safeParse(req.query);
    if (!q.success) return reply.code(422).send({ error: 'VALIDATION', message: 'bbox=minLon,minLat,maxLon,maxLat obrigatório' });
    const zoom = Number((req.query as { zoom?: string }).zoom ?? 12);
    return layer.features(q.data.bbox, { zoom });
  });

  // Proveniência: o que foi importado, de onde, com qual licença e quando
  app.get('/api/sources', async () => lastRuns());
}
