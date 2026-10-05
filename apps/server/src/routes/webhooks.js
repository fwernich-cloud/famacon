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

          // Account-level events (§6.5) — the ones that would have warned us the day Meta
          // silently moved our templates to Marketing. We must NOT find out by accident again.
          if (change.field === 'message_template_status_update') {
            // event: APPROVED | REJECTED | PENDING | PAUSED | DISABLED; on a silent
            // recategorization Meta sends event=APPROVED with a new category.
            const bad = ['REJECTED', 'PAUSED', 'DISABLED', 'FLAGGED'].includes(v.event) ||
              (v.new_category && v.new_category.toUpperCase() !== 'UTILITY');
            const line = { template: v.message_template_name, lang: v.message_template_language,
              event: v.event, reason: v.reason, category: v.new_category };
            if (bad) req.log.error(line, 'WA TEMPLATE ALERT — plantilla degradada/recategorizada');
            else req.log.info(line, 'wa template status');
            await captureOpsEvent('template_status', line, req.log);
          } else if (change.field === 'message_template_quality_update') {
            const line = { template: v.message_template_name,
              from: v.previous_quality_score, to: v.new_quality_score };
            const bad = ['RED', 'YELLOW'].includes((v.new_quality_score || '').toUpperCase());
            req.log[bad ? 'warn' : 'info'](line, 'wa template quality');
            await captureOpsEvent('template_quality', line, req.log);
          } else if (change.field === 'phone_number_quality_update') {
            const line = { event: v.event, current_limit: v.current_limit };
            const bad = /RED|YELLOW|FLAGGED|DOWNGRADE/i.test(`${v.event}`);
            req.log[bad ? 'warn' : 'info'](line, 'wa number quality');
            await captureOpsEvent('number_quality', line, req.log);
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

// Persist account-level WhatsApp events (template status/quality, number quality) so
// a silent Meta change (e.g. UTILITY→MARKETING) leaves a durable, queryable trace
// instead of only a log line. Table is created lazily; not tenant-scoped (account-wide).
let opsTableReady = false;
async function captureOpsEvent(kind, detail, log) {
  try {
    if (!opsTableReady) {
      await pool.query(`CREATE TABLE IF NOT EXISTS ops_event (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        kind text NOT NULL,
        detail jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now())`);
      opsTableReady = true;
    }
    await pool.query('INSERT INTO ops_event (kind, detail) VALUES ($1,$2)', [kind, detail]);
  } catch (err) {
    log?.error({ err: err.message, kind }, 'ops event capture failed');
  }
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
