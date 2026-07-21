import { ping } from '../db/pool.js';
import { listProfiles } from '../decoders/registry.js';

export default async function healthRoutes(fastify) {
  fastify.get('/health', async (_req, reply) => {
    let db = false;
    try { db = await ping(); } catch { db = false; }
    const ok = db;
    return reply.code(ok ? 200 : 503).send({
      ok,
      db,
      decoders: listProfiles(),
      ts: new Date().toISOString(),
    });
  });
}
