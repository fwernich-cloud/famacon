import { withTenant, resolveGateway } from '../db/withTenant.js';
import { getDecoder } from '../decoders/registry.js';
import { enqueueEvaluation } from '../engine/queue.js';

/**
 * Ingest one gateway message. Steps:
 *   1. resolve gateway -> tenant/field/profile   (cross-tenant routing lookup)
 *   2. set tenant context (RLS scoping)
 *   3. store raw payload with idempotency guard   (§6.1)  -> duplicates dropped
 *   4. decode via the profile's decoder            (§2)
 *   5. store normalized readings, tagged           (§3.2)
 *   6. bump gateway heartbeat (watchdog input)      (§6.4)
 *
 * @param {object} args
 * @param {'http'|'mqtt'} args.transport
 * @param {string} args.gatewayRef  routing id from the envelope (body.gw or MQTT topic)
 * @param {object} args.payload     verbatim inbound payload
 * @param {import('fastify').FastifyBaseLogger} [args.log]
 * @returns {Promise<{status:string, duplicate?:boolean, stored?:number, skipped?:number}>}
 */
export async function ingestMessage({ transport, gatewayRef, payload, log }) {
  if (!gatewayRef) return { status: 'rejected', reason: 'missing gateway ref' };

  const gw = await resolveGateway(gatewayRef);
  if (!gw) {
    log?.warn({ gatewayRef }, 'ingest: unknown gateway');
    return { status: 'rejected', reason: 'unknown gateway' };
  }

  const decoder = getDecoder(gw.hardware_profile);
  let decoded;
  try {
    decoded = decoder.decode(payload);
  } catch (err) {
    log?.error({ err: err.message, gatewayRef }, 'ingest: decode failed');
    return { status: 'rejected', reason: `decode: ${err.message}` };
  }

  const msgUuid = decoded.msgUuid || payload?.uuid;
  if (!msgUuid) return { status: 'rejected', reason: 'missing message uuid (idempotency key)' };

  return withTenant(gw.tenant_id, async (client) => {
    // 3 — idempotent raw store. ON CONFLICT => this exact message already landed.
    const raw = await client.query(
      `INSERT INTO raw_message (tenant_id, gateway_id, gateway_ext, msg_uuid, transport, payload)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (gateway_ext, msg_uuid) DO NOTHING
       RETURNING id`,
      [gw.tenant_id, gw.gateway_id, gatewayRef, msgUuid, transport, payload]
    );
    if (raw.rowCount === 0) {
      log?.info({ gatewayRef, msgUuid }, 'ingest: duplicate dropped (idempotent)');
      return { status: 'duplicate', duplicate: true, stored: 0 };
    }
    const rawMsgId = raw.rows[0].id;

    // 5 — resolve sensors (within tenant) and store readings.
    let stored = 0, skipped = 0;
    for (const r of decoded.readings) {
      const sensor = await client.query(
        `SELECT id, field_id FROM sensor WHERE gateway_id = $1 AND ext_ref = $2`,
        [gw.gateway_id, r.sensorRef]
      );
      if (sensor.rowCount === 0) {
        log?.warn({ gatewayRef, sensorRef: r.sensorRef }, 'ingest: unknown sensor, skipped');
        skipped++;
        continue;
      }
      const s = sensor.rows[0];
      const ins = await client.query(
        `INSERT INTO reading (ts, tenant_id, field_id, sensor_id, kind, value, battery, rssi, raw_msg_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (sensor_id, ts) DO NOTHING`,
        [r.ts || new Date(), gw.tenant_id, s.field_id, s.id, r.kind,
         r.value, r.battery ?? null, r.rssi ?? null, rawMsgId]
      );
      stored += ins.rowCount;
      if (ins.rowCount === 0) skipped++;
    }

    // 6 — heartbeat: gateway is alive; learn signal baseline (EWMA) for watchdog.
    const rssiVals = decoded.readings.map((r) => r.rssi).filter((x) => x != null);
    const avgRssi = rssiVals.length ? rssiVals.reduce((a, b) => a + b, 0) / rssiVals.length : null;
    await client.query(
      `UPDATE gateway
         SET last_seen_at = now(),
             signal_baseline_rssi = CASE
               WHEN $2::float8 IS NULL THEN signal_baseline_rssi
               WHEN signal_baseline_rssi IS NULL THEN $2::float8
               ELSE 0.8 * signal_baseline_rssi + 0.2 * $2::float8 END
       WHERE id = $1`,
      [gw.gateway_id, avgRssi]
    );

    await client.query(`UPDATE raw_message SET decoded = true WHERE id = $1`, [rawMsgId]);

    log?.info({ gatewayRef, msgUuid, stored, skipped }, 'ingest: stored');
    return { status: 'ok', stored, skipped, tenantId: gw.tenant_id, fieldId: gw.field_id };
  }).then(async (res) => {
    // Enqueue engine evaluation AFTER the ingest tx commits (only if data landed).
    if (res.status === 'ok' && res.stored > 0) {
      await enqueueEvaluation(res.tenantId, res.fieldId).catch((err) =>
        log?.error({ err: err.message }, 'enqueue evaluation failed'));
    }
    return res;
  });
}
