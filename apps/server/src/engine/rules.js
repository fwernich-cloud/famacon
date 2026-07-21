import { windowStats, valueAtOrBefore } from '../db/queries.js';

// ── N1: threshold rules (§6.3) ─────────────────────────────────────────────
// A value crosses a limit. Returns an array of alert candidates.
export function n1Threshold({ tankSensors, batterySensors, policy }) {
  const out = [];
  for (const t of tankSensors) {
    if (t.value == null) continue;
    if (t.value <= policy.tank_critical_pct) {
      out.push(mk('n1_threshold', 'tank_critical', 'urgent', t.tank_ref || t.ext_ref,
        `Nivel de tanque crítico: ${t.value}% (≤ ${policy.tank_critical_pct}%).`,
        { sensor: t.ext_ref, value: t.value }));
    } else if (t.value <= policy.tank_low_pct) {
      out.push(mk('n1_threshold', 'tank_low', 'warning', t.tank_ref || t.ext_ref,
        `Nivel de tanque bajo: ${t.value}% (≤ ${policy.tank_low_pct}%).`,
        { sensor: t.ext_ref, value: t.value }));
    }
  }
  for (const b of batterySensors) {
    if (b.battery != null && b.battery <= policy.battery_low_pct) {
      out.push(mk('n1_threshold', 'battery_low', 'warning', b.ext_ref,
        `Batería baja en ${b.ext_ref}: ${b.battery}%.`, { sensor: b.ext_ref, battery: b.battery }));
    }
  }
  return out;
}

// ── N2: time-window trend rules (§6.3) — leak detection ────────────────────
// Tank drops more than X% within Y minutes → suspected leak. Reads the window
// from the hypertable (tenant-scoped client).
export async function n2Window({ client, tankSensors, policy }) {
  const out = [];
  const sinceIso = new Date(Date.now() - policy.window_minutes * 60_000).toISOString();
  for (const t of tankSensors) {
    const w = await windowStats(client, t.sensor_id, sinceIso);
    if (!w || w.max_v == null || w.last_v == null) continue;
    const drop = w.max_v - w.last_v;               // peak-to-now within the window
    if (drop >= policy.window_drop_pct) {
      out.push(mk('n2_window', 'leak_suspected', 'urgent', t.tank_ref || t.ext_ref,
        `Caída rápida: el tanque bajó ${drop.toFixed(0)}% en < ${policy.window_minutes} min (posible fuga).`,
        { sensor: t.ext_ref, drop, window_min: policy.window_minutes }));
    }
  }
  return out;
}

function mk(level, type, severity, subject, diagnosis, detail) {
  return { level, type, severity, subject, diagnosis, detail,
    dedupKey: `${level}:${type}:${subject}` };
}

export { valueAtOrBefore };
