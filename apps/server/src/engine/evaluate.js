import { withTenant } from '../db/withTenant.js';
import {
  latestReadings, equipmentForField, previousValue, fieldMeta, pumpTable,
  openAlert, resolveStaleAlerts, lastNReadings, levelRate, equipmentActivity,
} from '../db/queries.js';
import { policyFor } from './policy.js';
import { evaluateRules, ruleText } from './ruleset.js';
import { detectBajando, ratePctPerHour } from './trend.js';
import { currentIrradiance, expectedPumping } from '../solar/index.js';

const CURRENT_ACTIVE = 0.2; // pump current (A) above this = running

/**
 * Evaluate one field after new data. Builds a per-tank context (level, sustained
 * trend, drop rate, feeder state) and runs the graded rule set R1–R7 (§3), then
 * reconciles the open-alert set. R8 (sin comunicación) is the watchdog's job.
 *
 * @returns {Promise<{alerts:Array, opened:Array, resolved:Array, diagnostics:Array}>}
 */
export async function evaluateField({ tenantId, fieldId, log, fetchImpl }) {
  return withTenant(tenantId, async (client) => {
    const field = await fieldMeta(client, fieldId);
    if (!field) return { alerts: [], opened: [], resolved: [], diagnostics: [] };
    const policy = policyFor(field.alert_policy);
    const now = Date.now();

    const readings = await latestReadings(client, fieldId);
    const equipment = await equipmentForField(client, fieldId);

    // Only the engine's PRIMARY level sensor per tank (a head-to-head comparison
    // sensor on the same tank is stored for the dashboard but must not fire alerts).
    // And only COMMISSIONED sensors generate alerts (Hito 4 #9): a sensor that was never
    // declared installed stays silent even while transmitting (spare sensors that auto-join).
    const tanks = readings.filter((r) => r.kind === 'tank_level' && r.ts
      && r.for_engine !== false && r.commissioned_at != null);
    const strokes = readings.filter((r) => r.kind === 'windmill_strokes');
    const currents = readings.filter((r) => r.kind === 'pump_current');

    // Local hour for the nocturnal rule (R7), per-field UTC offset.
    const localHour = ((new Date(now).getUTCHours() + (policy.utc_offset_h || 0)) % 24 + 24) % 24;
    const night = localHour >= policy.night_from_h && localHour < policy.night_to_h;

    const diagnostics = [];

    // Per-equipment state: is it delivering water now, and since when has it stopped.
    const stateOf = async (eq) => {
      if (eq.kind === 'windmill') {
        const v = strokes.find((x) => x.equipment_id === eq.id)?.value ?? null;
        const act = await equipmentActivity(client, eq.id, 'windmill_strokes', 0);
        return { delivering: v != null && v > 0, act, extra: { strokes: v } };
      }
      if (eq.kind === 'pump') {
        const v = currents.find((x) => x.equipment_id === eq.id)?.value ?? null;
        const act = await equipmentActivity(client, eq.id, 'pump_current', CURRENT_ACTIVE);
        return { delivering: v != null && v > CURRENT_ACTIVE, act, extra: { current: v } };
      }
      if (eq.kind === 'solar_pump') {
        // Solar exception (§2): when the sun isn't up we treat the tank as served, so
        // no false night alert. When the sun says it SHOULD fill, "delivering" = tank rising.
        const irr = await currentIrradiance(field.lat, field.lon, { fetchImpl });
        const expLph = expectedPumping(irr, await pumpTable(client, eq.name));
        const shouldRun = expLph != null && expLph >= policy.solar_min_expected_lph;
        let rising = false;
        const tl = tanks.find((x) => (x.tank_ref || x.ext_ref) === eq.fills_tank);
        if (tl) {
          const prev = await previousValue(client, tl.sensor_id, tl.ts);
          rising = prev ? (tl.value - prev.value) > policy.tank_drop_epsilon_pct : false;
        }
        return { delivering: shouldRun ? rising : true, act: null,
          extra: { irradiance_wm2: irr, expected_lph: expLph, should_run: shouldRun } };
      }
      return { delivering: false, act: null, extra: {} };
    };

    const byTank = new Map();
    for (const eq of equipment) {
      const st = await stateOf(eq);
      diagnostics.push({ equipment: eq.name, tank: eq.fills_tank, delivering: st.delivering, ...st.extra });
      if (!eq.fills_tank) continue;
      if (!byTank.has(eq.fills_tank)) byTank.set(eq.fills_tank, []);
      byTank.get(eq.fills_tank).push({ eq, ...st });
    }

    const candidates = [];
    for (const t of tanks) {
      const tref = t.tank_ref || t.ext_ref;
      const feeders = byTank.get(tref) || [];
      const running = feeders.some((f) => f.delivering);

      // Hours since the last real delivery across this tank's feeders (0 if running).
      let hoursStopped = 0;
      if (!running) {
        let lastActMs = null, firstSeenMs = null;
        for (const f of feeders) {
          const la = f.act?.last_active ? new Date(f.act.last_active).getTime() : null;
          const fs = f.act?.first_seen ? new Date(f.act.first_seen).getTime() : null;
          if (la != null) lastActMs = Math.max(lastActMs ?? 0, la);
          if (fs != null) firstSeenMs = firstSeenMs == null ? fs : Math.min(firstSeenMs, fs);
        }
        const ref = lastActMs ?? firstSeenMs;
        hoursStopped = ref ? (now - ref) / 3_600_000 : 0;
      }

      // Sustained fall (§4) over the last few readings, wave-smoothed.
      const recent = await lastNReadings(client, t.sensor_id, 5);
      const bajando = detectBajando(recent.map((r) => r.value).reverse(),
        policy.bajando_drop_pct, policy.bajando_ma_window);

      // Drop rate (%/h) for R6.
      const sinceIso = new Date(now - policy.leak_rate_window_min * 60_000).toISOString();
      const lr = await levelRate(client, t.sensor_id, sinceIso);
      const rate = lr ? ratePctPerHour(
        { firstV: lr.first_v, firstTs: lr.first_ts, lastV: lr.last_v, lastTs: lr.last_ts }) : null;

      const rules = evaluateRules({
        level: t.value, bajando, running, hoursStopped, night, ratePctPerHour: rate, policy,
      });
      for (const rc of rules) {
        candidates.push({
          level: 'rule', type: rc.type, severity: rc.severity, subject: tref,
          dedupKey: `rule:${rc.type}:${tref}`,
          diagnosis: ruleText(rc.type, { name: tref, level: t.value, hours: hoursStopped }),
          detail: {
            tank: tref, level: t.value, bajando, running,
            hours_stopped: Math.round(hoursStopped * 10) / 10,
            rate_pct_h: rate == null ? null : Math.round(rate * 10) / 10,
            feeders: feeders.map((f) => ({ name: f.eq.name, delivering: f.delivering, ...f.extra })),
          },
        });
      }
    }

    // ── Reconcile open-alert set (rules only; watchdog owns its own levels) ──
    const opened = [];
    for (const c of candidates) {
      const r = await openAlert(client, { tenantId, fieldId, ...c });
      if (r.created) opened.push({ id: r.id, ...c });
    }
    const activeKeys = candidates.map((c) => c.dedupKey);
    const resolved = await resolveStaleAlerts(client, fieldId, ['rule'], activeKeys);

    log?.info({ fieldId, candidates: candidates.length, opened: opened.length, resolved: resolved.length },
      'engine: evaluated');
    return { alerts: candidates, opened, resolved, diagnostics };
  });
}
