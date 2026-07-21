import crypto from 'node:crypto';
import { pool } from '../db/pool.js';

// ── WhatsApp webhook (§6.5) ─────────────────────────────────────────────────
// GET  = Meta verification handshake.
// POST = delivery statuses (sent/delivered/read/failed) → stored per message, and
//        inbound messages (for consent replies, logged). Signature-verified when
//        WA_APP_SECRET is set.

export default async function webhookRoutes(fastify) {
  // Capture the raw body for signature verification.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    req.rawBody = body;
    try { done(null, JSON.parse(body.toString() || '{}')); }
    catch (err) { done(err, undefined); }
  });

  fastify.get('/webhooks/whatsapp', async (req, reply) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token && token === process.env.WA_VERIFY_TOKEN) {
      return reply.code(200).type('text/plain').send(challenge);
    }
    return reply.code(403).send('forbidden');
  });

  fastify.post('/webhooks/whatsapp', async (req, reply) => {
    if (!verifySignature(req)) return reply.code(401).send({ error: 'bad signature' });

    let updated = 0;
    try {
      for (const entry of req.body?.entry || []) {
        for (const change of entry.changes || []) {
          const v = change.value || {};
          for (const st of v.statuses || []) {
            const err = st.errors?.[0]?.title || null;
            const { rows } = await pool.query('SELECT wa_update_status($1,$2,$3) AS n',
              [st.id, st.status, err]);
            updated += rows[0]?.n || 0;
          }
          for (const msg of v.messages || []) {
            req.log.info({ from: msg.from, type: msg.type, text: msg.text?.body }, 'whatsapp inbound');
            // (consent opt-in via reply keyword is handled in the consent flow)
          }
        }
      }
    } catch (err) {
      req.log.error({ err: err.message }, 'webhook processing error');
    }
    // Always 200 so Meta doesn't retry a processed event.
    return reply.code(200).send({ ok: true, updated });
  });
}

function verifySignature(req) {
  const secret = process.env.WA_APP_SECRET;
  if (!secret) return true; // not configured yet (test number path)
  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !req.rawBody) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); }
  catch { return false; }
}
