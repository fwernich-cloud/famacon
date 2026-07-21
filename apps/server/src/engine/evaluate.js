import { withTenant } from '../db/withTenant.js';
import {
  latestReadings, equipmentForField, previousValue, fieldMeta, pumpTable,
  openAlert, resolveStaleAlerts,
} from '../db/queries.js';
import { policyFor } from './policy.js';
import { n1Threshold, n2Window } from './rules.js';
import { currentIrradiance, expectedPumping } from '../solar/index.js';

/**
 * Evaluate one field after new data. Runs cross-diagnosis + N1 + N2, then
 * reconciles the open-alert set (opens new incidents, resolves cleared ones).
 * WhatsApp dispatch of the newly-opened alerts happens in M3.
 *
 * @returns {Promise<{alerts:Array, opened:Array, resolved:Array, diagnostics:Array}>}
 */
export async function evaluateField({ tenantId, fieldId, log, fetchImpl }) {
  return withTenant(tenantId, async (client) => {
    const field = await fieldMeta(client, fieldId);
    if (!field) return { alerts: [], opened: [], resolved: [], diagnostics: [] };
    const policy = policyFor(field.alert_policy);

    const readings = await latestReadings(client, fieldId);
    const equipment = await equipmentForField(client, fieldId);

    const tanks = readings.filter((r) => r.kind === 'tank_level' && r.ts);
    const strokes = readings.filter((r) => r.kind === 'windmill_strokes');
    const currents = readings.filter((r) => r.kind === 'pump_current');
    const batteries = readings.filter((r) => r.battery != null);

    // tank trend: last vs previous reading (immediate direction).
    const tankTrend = new Map();
    for (const t of tanks) {
      const prev = await previousValue(client, t.sensor_id, t.ts);
      tankTrend.set(t.tank_ref || t.ext_ref, {
        level: t.value,
        delta: prev ? t.value - prev.value : null,
      });
    }

    const candidates = [];
    const diagnostics = [];

    // ── Cross-diagnosis PER TANK ──
    // A tank can be fed by more than one equipment (e.g. tank_01 = MOL-01 + BE-01).
    // It's only in trouble when it's dropping AND *every* feeder is stopped — if any
    // feeder (windmill or the shared pump) is delivering, the tank is being served →
    // silence. One alert per tank, never a false urgent from one stopped co-feeder.
    const stateOf = async (eq) => {
      if (eq.kind === 'windmill') {
        const v = strokes.find((x) => x.equipment_id === eq.id)?.value ?? null;
        return { state: v == null ? 'unknown' : v > 0 ? 'running' : 'stopped',
          delivering: v != null && v > 0, extra: { strokes: v } };
      }
      if (eq.kind === 'pump') {
        const v = currents.find((x) => x.equipment_id === eq.id)?.value ?? null;
        return { state: v == null ? 'unknown' : v > 0.2 ? 'running' : 'stopped',
          delivering: v != null && v > 0.2, extra: { current: v } };
      }
      if (eq.kind === 'solar_pump') {
        const irr = await currentIrradiance(field.lat, field.lon, { fetchImpl });
        const expLph = expectedPumping(irr, await pumpTable(client, eq.name));
        const trend = tankTrend.get(eq.fills_tank) || {};
        const shouldRun = expLph != null && expLph >= policy.solar_min_expected_lph;
        const rising = trend.delta != null && trend.delta > policy.tank_drop_epsilon_pct;
        return { state: shouldRun ? 'should_run' : 'stopped',
          delivering: shouldRun && rising, extra: { irradiance_wm2: irr, expected_lph: expLph } };
      }
      return { state: 'unknown', delivering: false, extra: {} };
    };

    const byTank = new Map();
    for (const eq of equipment) {
      const st = await stateOf(eq);
      diagnostics.push({ equipment: eq.name, tank: eq.fills_tank, ...st });
      if (!eq.fills_tank) continue;
      if (!byTank.has(eq.fills_tank)) byTank.set(eq.fills_tank, []);
      byTank.get(eq.fills_tank).push({ eq, ...st });
    }

    for (const [tref, feeders] of byTank) {
      if (!tanks.find((t) => (t.tank_ref || '') === tref)) continue;
      const trend = tankTrend.get(tref) || {};
      const dropping = trend.delta != null && trend.delta < -Math.abs(policy.tank_drop_epsilon_pct);
      const anyDelivering = feeders.some((f) => f.delivering);
      const anyKnown = feeders.some((f) => f.state !== 'unknown');
      if (dropping && !anyDelivering && anyKnown) {
        const stopped = feeders.map((f) => f.eq.name).join(', ');
        candidates.push({
          level: 'cross', type: 'cross_situation_3', severity: 'urgent',
          subject: tref, dedupKey: `cross:${tref}`,
          diagnosis: `Tanque ${tref} bajando y sin reposición (parado: ${stopped}).`,
          detail: { tank: tref, level: trend.level, delta: trend.delta,
            feeders: feeders.map((f) => ({ name: f.eq.name, state: f.state, ...f.extra })) },
        });
      }
    }

    // ── N1 threshold + N2 window ──
    candidates.push(...n1Threshold({ tankSensors: tanks, batterySensors: batteries, policy }));
    candidates.push(...(await n2Window({ client, tankSensors: tanks, policy })));

    // ── Reconcile open-alert set ──
    const opened = [];
    for (const c of candidates) {
      const r = await openAlert(client, { tenantId, fieldId, ...c });
      if (r.created) opened.push({ id: r.id, ...c });
    }
    const activeKeys = candidates.map((c) => c.dedupKey);
    const resolved = await resolveStaleAlerts(
      client, fieldId, ['cross', 'n1_threshold', 'n2_window'], activeKeys);

    log?.info({ fieldId, candidates: candidates.length, opened: opened.length, resolved: resolved.length },
      'engine: evaluated');
    return { alerts: candidates, opened, resolved, diagnostics };
  });
}
