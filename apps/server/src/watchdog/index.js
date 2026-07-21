import { pool } from '../db/pool.js';
import { withTenant } from '../db/withTenant.js';
import { openAlert, resolveStaleAlerts } from '../db/queries.js';
import { DEFAULT_POLICY } from '../engine/policy.js';

// ── Absence-of-data watchdog (§6.4) — "the most important alert" ────────────
// The most important alert is often the ABSENCE of data. Three distinct cases:
//   1. Equipment down  — a sensor stops reporting but its gateway still transmits.
//   2. Zone outage     — the whole gateway goes silent → coverage loss, NOT an
//                        equipment failure (no false alarms in poor-coverage zones).
//   3. Degrading signal— gateway RSSI trending down before silence → preventive notice.

export async function runWatchdog(log, onOpened) {
  const p = DEFAULT_POLICY;
  const { rows: gateways } = await pool.query('SELECT * FROM wd_gateways()');
  const now = Date.now();
  let opened = 0, resolved = 0;

  for (const gw of gateways) {
    const gwAgeS = gw.last_seen_at ? (now - new Date(gw.last_seen_at).getTime()) / 1000 : Infinity;
    const gatewayDown = gwAgeS > gw.expected_period_s * p.heartbeat_grace_factor;
    const openedHere = [];

    await withTenant(gw.tenant_id, async (client) => {
      const activeKeys = [];
      const open = async (a) => {
        const r = await openAlert(client, a);
        if (r.created) { opened++; openedHere.push({ id: r.id, ...a }); }
      };

      if (gatewayDown) {
        // CASE 2 — zone outage. Distinct, lower-severity; suppress equipment-down.
        const key = `watchdog:gateway:${gw.gateway_id}`;
        activeKeys.push(key);
        await open({
          tenantId: gw.tenant_id, fieldId: gw.field_id, level: 'watchdog',
          type: 'zone_outage', severity: 'warning', subject: gw.ext_ref, dedupKey: key,
          diagnosis: `El gateway ${gw.ext_ref} dejó de reportar (${fmtAge(gwAgeS)}). ` +
                     `Se trata como corte de señal de zona, no como falla de equipo.`,
          detail: { gateway: gw.ext_ref, silent_for_s: Math.round(gwAgeS) },
        });
      } else {
        // Gateway alive → check each sensor's heartbeat (CASE 1) + signal (CASE 3).
        const { rows: sensors } = await client.query(
          `SELECT s.id, s.ext_ref, s.kind, s.expected_period_s,
                  (SELECT max(ts) FROM reading r WHERE r.sensor_id = s.id) AS last_ts
             FROM sensor s WHERE s.gateway_id = $1`, [gw.gateway_id]);

        for (const s of sensors) {
          const ageS = s.last_ts ? (now - new Date(s.last_ts).getTime()) / 1000 : Infinity;
          if (ageS > s.expected_period_s * p.heartbeat_grace_factor) {
            // CASE 1 — equipment down: this node is silent while the gateway is fine.
            const key = `watchdog:sensor:${s.id}`;
            activeKeys.push(key);
            await open({
              tenantId: gw.tenant_id, fieldId: gw.field_id, level: 'watchdog',
              type: 'equipment_down', severity: 'urgent', subject: s.ext_ref, dedupKey: key,
              diagnosis: `El sensor ${s.ext_ref} dejó de reportar (${fmtAge(ageS)}) ` +
                         `mientras el gateway sigue transmitiendo: equipo caído.`,
              detail: { sensor: s.ext_ref, silent_for_s: isFinite(ageS) ? Math.round(ageS) : null },
            });
          }
        }

        // CASE 3 — degrading signal (preventive, distinct from a failure).
        const { rows: sig } = await client.query(
          `SELECT rssi FROM reading WHERE field_id=$1 AND rssi IS NOT NULL
           ORDER BY ts DESC LIMIT 1`, [gw.field_id]);
        const latestRssi = sig[0]?.rssi;
        const base = gw.signal_baseline_rssi;
        const degraded = latestRssi != null && (
          latestRssi < p.rssi_degraded_abs ||
          (base != null && latestRssi < base - p.rssi_degraded_margin));
        if (degraded) {
          const key = `watchdog:signal:${gw.gateway_id}`;
          activeKeys.push(key);
          await open({
            tenantId: gw.tenant_id, fieldId: gw.field_id, level: 'watchdog',
            type: 'signal_degraded', severity: 'info', subject: gw.ext_ref, dedupKey: key,
            diagnosis: `Señal debilitándose en ${gw.ext_ref} (RSSI ${latestRssi} dBm, ` +
                       `base ${base ?? 'n/d'}). Aviso preventivo, posible corte próximo.`,
            detail: { gateway: gw.ext_ref, rssi: latestRssi, baseline: base },
          });
        }
      }

      const res = await resolveStaleAlerts(client, gw.field_id, ['watchdog'], activeKeys);
      resolved += res.length;
    });

    if (openedHere.length && onOpened) {
      try { await onOpened({ tenantId: gw.tenant_id, fieldId: gw.field_id, opened: openedHere }); }
      catch (err) { log?.error({ err: err.message }, 'watchdog onOpened failed'); }
    }
  }

  if (opened || resolved) log?.info({ opened, resolved, gateways: gateways.length }, 'watchdog: scan');
  return { opened, resolved, gateways: gateways.length };
}

function fmtAge(s) {
  if (!isFinite(s)) return 'sin datos';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}
