import { withTenant } from '../db/withTenant.js';
import {
  latestReadings, equipmentForField, previousValue, fieldMeta, pumpTable,
  openAlert, resolveStaleAlerts,
} from '../db/queries.js';
import { policyFor } from './policy.js';
import { crossDiagnose } from './crossDiagnosis.js';
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

    // ── Cross-diagnosis per equipment→tank pair ──
    for (const eq of equipment) {
      const tank = tanks.find((t) => (t.tank_ref || '') === (eq.fills_tank || ''));
      if (!tank) continue;
      const trend = tankTrend.get(tank.tank_ref || tank.ext_ref) || {};

      let equipmentState = 'unknown';
      let tankRising;
      const extra = {};

      if (eq.kind === 'windmill') {
        const s = strokes.find((x) => x.equipment_id === eq.id);
        equipmentState = s && s.value != null ? (s.value > 0 ? 'running' : 'stopped') : 'unknown';
        extra.strokes = s?.value ?? null;
      } else if (eq.kind === 'pump') {
        const c = currents.find((x) => x.equipment_id === eq.id);
        equipmentState = c && c.value != null ? (c.value > 0.2 ? 'running' : 'stopped') : 'unknown';
        extra.current = c?.value ?? null;
      } else if (eq.kind === 'solar_pump') {
        // No current sensor — estimate from weather (§6.7).
        const irr = await currentIrradiance(field.lat, field.lon, { fetchImpl });
        const table = await pumpTable(client, eq.name);
        const expLph = expectedPumping(irr, table);
        extra.irradiance_wm2 = irr;
        extra.expected_lph = expLph;
        if (expLph != null && expLph >= policy.solar_min_expected_lph) {
          equipmentState = 'should_run';
          tankRising = trend.delta != null ? trend.delta > policy.tank_drop_epsilon_pct : undefined;
        } else {
          equipmentState = 'stopped'; // sun too low to expect pumping (e.g. night)
        }
      }

      const dx = crossDiagnose({
        tankLevel: trend.level, tankDelta: trend.delta,
        equipmentState, dropEpsilon: policy.tank_drop_epsilon_pct, tankRising,
      });
      diagnostics.push({ equipment: eq.name, tank: eq.fills_tank, equipmentState, ...trend, ...extra, ...dx });

      if (dx.alert) {
        candidates.push({
          level: 'cross', type: `cross_situation_${dx.situation}`, severity: dx.severity,
          subject: eq.fills_tank || eq.name, dedupKey: `cross:${eq.fills_tank || eq.name}`,
          diagnosis: `${eq.name}: ${dx.reason}`,
          detail: { equipment: eq.name, equipmentState, ...trend, ...extra },
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
