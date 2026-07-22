import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import { config, assertConfig } from './config/index.js';
import { pool } from './db/pool.js';
import healthRoutes from './routes/health.js';
import httpIngestRoutes from './ingestion/http.js';
import webhookRoutes from './routes/webhooks.js';
import consentRoutes from './routes/consent.js';
import apiRoutes from './routes/api.js';
import authRoutes from './routes/auth.js';
import { requirePage } from './lib/auth.js';
import { startMqtt } from './ingestion/mqtt.js';
import { startWorkers, onAlertsOpened } from './engine/queue.js';
import { dispatchAlerts } from './whatsapp/dispatch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

assertConfig();

const fastify = Fastify({
  logger: { level: config.env === 'production' ? 'info' : 'debug' },
  trustProxy: true, // behind nginx — needed for real client IP (consent audit, NFR5)
});

await fastify.register(fastifyCookie);
await fastify.register(healthRoutes);
await fastify.register(httpIngestRoutes);
await fastify.register(webhookRoutes);
await fastify.register(authRoutes);
await fastify.register(consentRoutes);
await fastify.register(apiRoutes);

// Static site + app. Landing ("/") and the sign-in page are PUBLIC; the operator
// pages redirect to /login.html without a valid session. /api enforces its own 401.
await fastify.register(async (ui) => {
  ui.addHook('onRequest', (req, reply, done) => {
    const p = (req.raw.url || '').split('?')[0];
    if (p === '/dashboard.html' || p === '/admin.html') return requirePage(req, reply, done);
    done();
  });
  await ui.register(fastifyStatic, { root: join(__dirname, '..', 'public') });
});

// Wire engine/watchdog opened-alerts → WhatsApp dispatch (consent-gated).
onAlertsOpened((payload) => dispatchAlerts({ ...payload, log: fastify.log }));

const mqttClient = startMqtt(fastify.log);
const workers = startWorkers(fastify.log);

const shutdown = async (signal) => {
  fastify.log.info({ signal }, 'shutting down');
  try { mqttClient?.end(true); } catch {}
  try { await workers.evalWorker.close(); await workers.wdWorker.close(); } catch {}
  await fastify.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

try {
  await fastify.listen({ port: config.port, host: '0.0.0.0' });
  fastify.log.info(`Famacon Control server on :${config.port} (${config.env})`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
