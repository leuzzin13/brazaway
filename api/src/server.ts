import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config.js';
import { routeRoutes } from './routes/route.js';
import { reportRoutes } from './routes/reports.js';
import { miscRoutes } from './routes/misc.js';

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
await app.register(cors, { origin: true });
await app.register(miscRoutes);
await app.register(routeRoutes);
await app.register(reportRoutes);

app.setErrorHandler((err: any, _req, reply) => {
  const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
  if (status >= 500) app.log.error(err);
  reply.code(status).send({ error: status >= 500 ? 'INTERNAL' : 'ERROR', message: err.message });
});

await app.listen({ port: env.port, host: '0.0.0.0' });
