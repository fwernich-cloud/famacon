// Alerting policy — thresholds/windows from the pliego (§6.3). These are DEFAULTS;
// a per-field override can be stored in field.alert_policy (jsonb) and is merged on
// top, so tuning stays data, not code.
export const DEFAULT_POLICY = {
  // N1 — thresholds
  tank_low_pct: 20,          // "tanque bajo 20%"
  tank_critical_pct: 10,
  battery_low_pct: 20,
  equipment_zero_grace_min: 30, // windmill strokes / pump current at zero for X min

  // N2 — time window (leak detection): drop > X% within Y minutes
  window_drop_pct: 30,       // "cae más de 30%"
  window_minutes: 60,        // "en menos de una hora"

  // Cross-diagnosis
  tank_drop_epsilon_pct: 1.5, // below this per-window delta counts as "stable"

  // Watchdog
  heartbeat_grace_factor: 1.6, // missed if age > expected_period_s * factor
  rssi_degraded_abs: -95,      // absolute weak-signal floor (dBm)
  rssi_degraded_margin: 12,    // or this many dB below the learned baseline

  // Solar (weather-estimated pump)
  solar_min_expected_lph: 80,  // above this, the sun says the pump SHOULD be filling
};

export function policyFor(fieldPolicy) {
  return { ...DEFAULT_POLICY, ...(fieldPolicy || {}) };
}
