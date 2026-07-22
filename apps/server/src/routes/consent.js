import { withTenant } from '../db/withTenant.js';
import { recordConsent, revokeConsent } from '../whatsapp/consent.js';
import { requireApi } from '../lib/auth.js';

// Consent management (§6.5 / NFR5). Famacon-only (basic auth). Captures IP +
// timestamp for the audit trail; supports revocation (rectification/deletion).
export default async function consentRoutes(fastify) {
  fastify.post('/admin/consent', { preHandler: requireApi, schema: {
    body: { type: 'object', required: ['tenantId', 'recipientId'],
      properties: { tenantId: { type: 'string' }, recipientId: { type: 'string' },
        policyVersion: { type: 'string' } } },
  } }, async (req, reply) => {
    const { tenantId, recipientId, policyVersion } = req.body;
    const row = await withTenant(tenantId, (c) =>
      recordConsent(c, { tenantId, recipientId, ip: req.ip, policyVersion }));
    if (!row) return reply.code(404).send({ error: 'recipient not found in tenant' });
    return reply.code(201).send({ ok: true, consent: row, ip: req.ip });
  });

  fastify.delete('/admin/consent', { preHandler: requireApi, schema: {
    body: { type: 'object', required: ['tenantId', 'recipientId'],
      properties: { tenantId: { type: 'string' }, recipientId: { type: 'string' } } },
  } }, async (req, reply) => {
    const { tenantId, recipientId } = req.body;
    const n = await withTenant(tenantId, (c) => revokeConsent(c, recipientId));
    return reply.send({ ok: true, revoked: n });
  });
}
