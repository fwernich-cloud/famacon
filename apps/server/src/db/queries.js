// Tenant-scoped read helpers. Every function takes a tenant-pinned client
// (from withTenant), so RLS guarantees results never cross producers.

/** Latest reading per sensor for a field, with sensor + equipment metadata. */
export async function latestReadings(client, fieldId) {
  const { rows } = await client.query(
    `SELECT DISTINCT ON (s.id)
        s.id AS sensor_id, s.ext_ref, s.kind, s.tank_ref, s.equipment_id,
        s.expected_period_s, s.for_engine, s.commissioned_at,
        e.kind AS equipment_kind, e.name AS equipment_name,
        e.fills_tank, r.ts, r.value, r.battery, r.rssi, r.meta->>'geometry' AS geometry
     FROM sensor s
     LEFT JOIN equipment e ON e.id = s.equipment_id
     LEFT JOIN reading r ON r.sensor_id = s.id
     WHERE s.field_id = $1
     ORDER BY s.id, r.ts DESC NULLS LAST`,
    [fieldId]
  );
  return rows;
}

/** Value of a sensor's reading at/just before a cutoff, for trend/window math. */
export async function valueAtOrBefore(client, sensorId, cutoff) {
  const { rows } = await client.query(
    `SELECT ts, value FROM reading
     WHERE sensor_id = $1 AND ts <= $2
     ORDER BY ts DESC LIMIT 1`,
    [sensorId, cutoff]
  );
  return rows[0] || null;
}

/** Max/min of a sensor within a time window (leak detection). */
export async function windowStats(client, sensorId, sinceIso) {
  const { rows } = await client.query(
    `SELECT max(value) AS max_v, min(value) AS min_v,
            (SELECT value FROM reading WHERE sensor_id=$1 ORDER BY ts DESC LIMIT 1) AS last_v,
            (SELECT value FROM reading WHERE sensor_id=$1 AND ts>=$2 ORDER BY ts ASC LIMIT 1) AS first_v
     FROM reading WHERE sensor_id = $1 AND ts >= $2`,
    [sensorId, sinceIso]
  );
  return rows[0] || null;
}

export async function equipmentForField(client, fieldId) {
  const { rows } = await client.query(
    `SELECT id, kind, name, fills_tank FROM equipment WHERE field_id = $1`, [fieldId]
  );
  return rows;
}

/** Previous reading value strictly before a timestamp (for trend/delta). */
export async function previousValue(client, sensorId, beforeTs) {
  const { rows } = await client.query(
    `SELECT ts, value FROM reading WHERE sensor_id=$1 AND ts < $2 ORDER BY ts DESC LIMIT 1`,
    [sensorId, beforeTs]
  );
  return rows[0] || null;
}

/** Full windmill config with derived diameter (mm) and carrera (cm). */
export async function windmillConfigFull(client, equipmentId) {
  const { rows } = await client.query(
    `SELECT e.fills_tank, wc.wheel_ft, wc.cylinder_nominal, wc.eta_base,
            ws.carrera_cm, cc.internal_diameter_mm
       FROM equipment e
       LEFT JOIN windmill_config wc ON wc.equipment_id = e.id
       LEFT JOIN wheel_spec ws ON ws.wheel_ft = wc.wheel_ft AND ws.tenant_id = e.tenant_id
       LEFT JOIN cylinder_catalog cc ON cc.nominal = wc.cylinder_nominal AND cc.tenant_id = e.tenant_id
      WHERE e.id = $1`, [equipmentId]);
  return rows[0] || null;
}

export async function tankGeometryByRef(client, tankRef) {
  const { rows } = await client.query(
    `SELECT shape, diameter_mm, width_mm, length_mm, height_mm, sensor_offset_mm
       FROM tank_geometry WHERE tank_ref = $1`,
    [tankRef]);
  return rows[0] || null;
}

/** Sum of stroke counts reported in a window (strokes are per-report counters). */
export async function strokesSum(client, tankRefEquipmentId, sinceIso) {
  const { rows } = await client.query(
    `SELECT coalesce(sum(r.value),0) AS strokes
       FROM reading r JOIN sensor s ON s.id = r.sensor_id
      WHERE s.equipment_id = $1 AND s.kind='windmill_strokes' AND r.ts >= $2`,
    [tankRefEquipmentId, sinceIso]);
  return Number(rows[0]?.strokes || 0);
}

/** First and last tank level (%) in a window, by tank_ref. Only the engine's
 *  PRIMARY level sensor (for_engine) — a comparison sensor on the same tank must
 *  not contaminate the clean-window rise. */
export async function tankRiseByRef(client, tankRef, sinceIso) {
  const { rows } = await client.query(
    `WITH r AS (
       SELECT rd.ts, rd.value FROM reading rd JOIN sensor s ON s.id = rd.sensor_id
       WHERE s.tank_ref = $1 AND s.kind='tank_level' AND s.for_engine AND rd.ts >= $2 ORDER BY rd.ts)
     SELECT (SELECT value FROM r ORDER BY ts ASC LIMIT 1) AS first_v,
            (SELECT value FROM r ORDER BY ts DESC LIMIT 1) AS last_v`,
    [tankRef, sinceIso]);
  return rows[0] || null;
}

/** Max pump current in a window for a pump that SHARES the given tank. Used to
 *  reject windmill-performance windows contaminated by the pump's water. */
export async function pumpMaxCurrentSharingTank(client, tankRef, sinceIso) {
  const { rows } = await client.query(
    `SELECT max(r.value) AS max_current
       FROM reading r JOIN sensor s ON s.id = r.sensor_id
       JOIN equipment e ON e.id = s.equipment_id
      WHERE e.kind='pump' AND e.fills_tank=$1 AND s.kind='pump_current' AND r.ts >= $2`,
    [tankRef, sinceIso]);
  return rows[0]?.max_current ?? null;
}

export async function fieldMeta(client, fieldId) {
  const { rows } = await client.query(
    `SELECT id, name, lat, lon, alert_policy FROM field WHERE id = $1`, [fieldId]
  );
  return rows[0] || null;
}

/** Last N non-null readings for a sensor, newest first (for the §4 "bajando" filter). */
export async function lastNReadings(client, sensorId, n) {
  const { rows } = await client.query(
    `SELECT ts, value FROM reading
      WHERE sensor_id=$1 AND value IS NOT NULL ORDER BY ts DESC LIMIT $2`,
    [sensorId, n]);
  return rows;
}

/** First/last value+ts of a sensor within a window, for the R6 drop-rate (%/h). */
export async function levelRate(client, sensorId, sinceIso) {
  const { rows } = await client.query(
    `SELECT
       (SELECT value FROM reading WHERE sensor_id=$1 AND ts>=$2 AND value IS NOT NULL ORDER BY ts ASC  LIMIT 1) AS first_v,
       (SELECT ts    FROM reading WHERE sensor_id=$1 AND ts>=$2 AND value IS NOT NULL ORDER BY ts ASC  LIMIT 1) AS first_ts,
       (SELECT value FROM reading WHERE sensor_id=$1 AND value IS NOT NULL ORDER BY ts DESC LIMIT 1) AS last_v,
       (SELECT ts    FROM reading WHERE sensor_id=$1 AND value IS NOT NULL ORDER BY ts DESC LIMIT 1) AS last_ts`,
    [sensorId, sinceIso]);
  return rows[0] || null;
}

/** When an equipment last DELIVERED (value>threshold) and when it was first seen —
 *  so "sin pulsos hace X h" counts from the last real activity, not from now. */
export async function equipmentActivity(client, equipmentId, kind, threshold) {
  const { rows } = await client.query(
    `SELECT max(r.ts) FILTER (WHERE r.value > $3) AS last_active, min(r.ts) AS first_seen
       FROM reading r JOIN sensor s ON s.id = r.sensor_id
      WHERE s.equipment_id=$1 AND s.kind=$2`,
    [equipmentId, kind, threshold]);
  return rows[0] || null;
}

/** Product data for solar expected-pumping interpolation. */
export async function pumpTable(client, pumpName) {
  const { rows } = await client.query(
    `SELECT irradiance_wm2, expected_lph FROM product_pump_table
     WHERE pump_name = $1 ORDER BY irradiance_wm2 ASC`, [pumpName]
  );
  return rows;
}

/**
 * Upsert an open alert by dedup_key (one open incident per subject). Returns
 * { id, created } — created=true only the first time the incident opens.
 */
export async function openAlert(client, a) {
  const { rows } = await client.query(
    `INSERT INTO alert (tenant_id, field_id, level, type, severity, status,
                        subject, dedup_key, diagnosis, detail, opened_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8,$9, now(), now())
     ON CONFLICT (tenant_id, dedup_key) WHERE status='open'
       DO UPDATE SET last_seen_at = now(), diagnosis = EXCLUDED.diagnosis,
                     detail = EXCLUDED.detail, severity = EXCLUDED.severity
     RETURNING id, (xmax = 0) AS created`,
    [a.tenantId, a.fieldId, a.level, a.type, a.severity, a.subject,
     a.dedupKey, a.diagnosis, a.detail || {}]
  );
  return rows[0];
}

/**
 * Resolve open alerts OWNED by the given levels (engine vs. watchdog) whose
 * dedup_key is no longer in the active set — so the engine never resolves the
 * watchdog's alerts and vice-versa.
 */
export async function resolveStaleAlerts(client, fieldId, levels, activeKeys) {
  const { rows } = await client.query(
    `UPDATE alert SET status='resolved', resolved_at=now()
     WHERE field_id=$1 AND status='open'
       AND level = ANY($2::text[])
       AND NOT (dedup_key = ANY($3::text[]))
     RETURNING id, dedup_key`,
    [fieldId, levels, activeKeys.length ? activeKeys : ['__none__']]
  );
  return rows;
}
