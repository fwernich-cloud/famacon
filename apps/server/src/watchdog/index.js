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
          `SELECT s.id, s.ext_ref, s.kind, s.expected_period_s, s.commissioned_at,
                  (SELECT max(ts) FROM reading r WHERE r.sensor_id = s.id) AS last_ts,
                  (SELECT r.rssi FROM reading r WHERE r.sensor_id = s.id AND r.rssi IS NOT NULL
                     ORDER BY r.ts DESC LIMIT 1) AS last_rssi
             FROM sensor s WHERE s.gateway_id = $1`, [gw.gateway_id]);

        for (const s of sensors) {
          // Hito 4 #9 — only COMMISSIONED sensors can raise an alert. A sensor not declared
          // installed stays silent even while transmitting: this is what stops the false
          // "equipo caído" when a distributor's spare sensors auto-join the gateway and then
          // leave range (exactly the 3 windmills that were in Fede's truck).
          if (s.commissioned_at == null) continue;
          // A commissioned sensor that hasn't sent its first packet yet gets a grace pass
          // (it flips to monitored on its first valid reading); don't alarm at install time.
          if (s.last_ts == null) continue;
          // Windmill strokes sensors DO emit a periodic heartbeat (EM300-DI sends temp/humidity/
          // counter on a programmed interval, ~10 min — confirmed with field data), so absence
          // IS a valid "caído" signal for them now. "Molino parado" (counter not rising while
          // uplinks arrive) is a separate, non-alarming condition handled in the rules, not here.
          const ageS = (now - new Date(s.last_ts).getTime()) / 1000;
          // Adaptive absence threshold: tolerate a number of MISSED UPLINKS (multiples of
          // the sensor's own interval), more when the link is weak — so normal packet loss
          // on a marginal sensor isn't read as a dead one (§6.4, Bozzano false alarm).
          const weakLink = s.last_rssi != null && s.last_rssi <= p.rssi_marginal_dbm;
          const missesAllowed = p.heartbeat_miss_base + (weakLink ? p.heartbeat_miss_weak_extra : 0);
          const thresholdS = s.expected_period_s * (missesAllowed + 1);
          if (ageS > thresholdS) {
            // CASE 1 — equipment down: this node reported before but has gone silent
            // past its adaptive tolerance, while its gateway is fine.
            const key = `watchdog:sensor:${s.id}`;
            activeKeys.push(key);
            await open({
              tenantId: gw.tenant_id, fieldId: gw.field_id, level: 'watchdog',
              type: 'equipment_down', severity: 'urgent', subject: s.ext_ref, dedupKey: key,
              diagnosis: `El sensor ${s.ext_ref} dejó de reportar (${fmtAge(ageS)}) ` +
                         `mientras el gateway sigue transmitiendo: equipo caído.`,
              detail: { sensor: s.ext_ref, silent_for_s: isFinite(ageS) ? Math.round(ageS) : null,
                        rssi: s.last_rssi, misses_allowed: missesAllowed, threshold_s: thresholdS },
            });
          }
        }

        // CASE 3 — degrading signal (preventive, distinct from a failure).
        // DISABLED by default (p.signal_degraded_enabled): the old query took the LATEST
        // reading's RSSI from ANY sensor and compared it to the GATEWAY's baseline — so a
        // far sensor (e.g. Bozzano at -117) looked like the gateway degrading. Correct model
        // is per-sensor RSSI vs its own baseline; rework before re-enabling.
        const { rows: sig } = p.signal_degraded_enabled ? await client.query(
          `SELECT rssi FROM reading WHERE field_id=$1 AND rssi IS NOT NULL
           ORDER BY ts DESC LIMIT 1`, [gw.field_id]) : { rows: [] };
        const latestRssi = sig[0]?.rssi;
        const base = gw.signal_baseline_rssi;
        const degraded = p.signal_degraded_enabled && latestRssi != null && (
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

    // Always hand the field to the dispatch sweep (even with no new opens) so retry
    // cadences fire; dispatch early-returns when the field has no open alerts.
    if (onOpened) {
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
