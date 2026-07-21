import { ingestMessage } from './ingestService.js';

// HTTP ingestion (§6.1). The demo/curl path and a fallback for gateways that
// prefer HTTPS POST over MQTT.
export default async function httpIngestRoutes(fastify) {
  fastify.post('/ingest', {
    schema: {
      body: {
        type: 'object',
        required: ['gw', 'readings'],
        properties: {
          gw: { type: 'string' },
          uuid: { type: 'string' },
          ts: { type: 'string' },
          readings: { type: 'array' },
        },
      },
    },
  }, async (request, reply) => {
    const result = await ingestMessage({
      transport: 'http',
      gatewayRef: request.body.gw,
      payload: request.body,
      log: request.log,
    });
    const code = result.status === 'ok' ? 202
      : result.status === 'duplicate' ? 200
      : 422;
    return reply.code(code).send(result);
  });
}
