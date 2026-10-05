import { withTenant, resolveGateway } from '../db/withTenant.js';
import { getDecoder } from '../decoders/registry.js';
import { enqueueEvaluation } from '../engine/queue.js';
import { tankGeometryByRef } from '../db/queries.js';
import { counterDelta, distanceTopToLevelPct, depthBottomToLevelPct } from './transforms.js';

/**
 * Finalize one decoded reading against live config, keeping the raw device value.
 * Decoders may emit a RAW measurement (cumulative counter / ultrasonic distance /
 * submersible depth) tagged with r.transform; this turns it into the engine's value
 * and returns { value, meta } — meta preserves the raw reading for audit/recalibration.
 */
async function finalizeReading(client, sensor, r) {
  let value = r.value;
  let meta = r.raw ? { ...r.raw } : null;

  if (r.transform === 'counter_delta') {
    // Strokes this window = counter now − counter at the previous report (reset-aware).
    const prev = await client.query(
      `SELECT (meta->>'counter')::float8 AS counter FROM reading
        WHERE sensor_id = $1 AND meta ? 'counter' AND ts < $2 ORDER BY ts DESC LIMIT 1`,
      [sensor.id, r.ts || new Date()]);
    const prevCounter = prev.rows[0]?.counter ?? null;
    value = counterDelta(r.value, prevCounter);
    meta = { ...(meta || {}), counter: r.value, counter_prev: prevCounter };
  } else if (r.transform === 'distance_top' || r.transform === 'depth_bottom') {
    // Distance/depth → level %, via the tank's geometry (Item C). A distance→level
    // (EM500-UDL, distance_top) reading needs BOTH the useful height AND the sensor
    // offset; a depth→level (SWL, depth_bottom) needs the height. Missing a required
    // input ⇒ NO % — the tank shows "sin calibrar". Never invent a value from a
    // missing datum (the transversal rule from the field review).
    const BLIND_ZONE_MM = 250;   // EM500-UDL C100 blind zone
    if (r.transform === 'distance_top' && r.value != null && r.value <= BLIND_ZONE_MM) {
      // Blind zone (Hito 4 #4): a distance at/below the sensor's blind zone is not a real
      // measurement — it reads the floor of the zone and would otherwise saturate the level.
      // Flag "revisar montaje"; never a %, never a tanque-vacío alert. Raw mm is kept in meta.
      value = null;
      meta = { ...(meta || {}), level_pct: null, geometry: 'revisar_montaje' };
    } else {
      const geom = sensor.tank_ref ? await tankGeometryByRef(client, sensor.tank_ref) : null;
      const needsOffset = r.transform === 'distance_top';
      const calibrated = !!geom && geom.height_mm != null &&
        (!needsOffset || geom.sensor_offset_mm != null);
      if (calibrated) {
        const pct = r.transform === 'distance_top'
          ? distanceTopToLevelPct(r.value, geom)
          : depthBottomToLevelPct(r.value, geom);
        value = pct == null ? null : Math.round(pct * 10) / 10;   // 1 decimal (Hito 4 #4)
        meta = { ...(meta || {}), level_pct: value, height_mm: geom.height_mm,
          sensor_offset_mm: geom.sensor_offset_mm ?? null };
      } else {
        value = null;
        meta = { ...(meta || {}), level_pct: null,
          geometry: (geom && geom.height_mm != null) ? 'sin_offset' : 'a confirmar' };
      }
    }
  }
  return { value, meta };
}

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
        `SELECT id, field_id, tank_ref, kind FROM sensor WHERE gateway_id = $1 AND ext_ref = $2`,
        [gw.gateway_id, r.sensorRef]
      );
      if (sensor.rowCount === 0) {
        log?.warn({ gatewayRef, sensorRef: r.sensorRef }, 'ingest: unknown sensor, skipped');
        skipped++;
        continue;
      }
      const s = sensor.rows[0];
      // Finalize raw device measurements (counter→delta, distance→level %) against
      // live config, keeping the raw value in reading.meta.
      const { value, meta } = await finalizeReading(client, s, r);
      const ins = await client.query(
        `INSERT INTO reading (ts, tenant_id, field_id, sensor_id, kind, value, battery, rssi, meta, raw_msg_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (sensor_id, ts) DO NOTHING`,
        [r.ts || new Date(), gw.tenant_id, s.field_id, s.id, r.kind,
         value, r.battery ?? null, r.rssi ?? null, meta, rawMsgId]
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
