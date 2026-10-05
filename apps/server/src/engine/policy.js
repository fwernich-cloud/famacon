// Alerting policy — the spec's parameters (Federico v1, §8). These are DEFAULTS;
// a per-field override lives in field.alert_policy (jsonb) and is merged on top, so
// tuning stays data, not code. Per-node override is Phase B.
export const DEFAULT_POLICY = {
  // ── Tank tiers (§1) ──
  tank_low_pct: 50,          // "Bajo" 30–50
  tank_muy_bajo_pct: 30,     // "Muy bajo" 20–30
  tank_critical_pct: 20,     // "Crítico" < 20

  // ── Equipment timing (§2/§3) ──
  equipo_aviso_h: 2,         // R2: sin pulsos > 2 h
  equipo_prolongado_h: 6,    // R3: sin pulsos > 6 h

  // ── "Tanque bajando" (§4): ≥5% sostenida sobre media móvil de 3 lecturas ──
  bajando_drop_pct: 5,
  bajando_ma_window: 3,

  // ── R6 caída rápida (§5.4): piso absoluto día-uno; el relativo (1,8×) se activa
  //    recién con el nodo calibrado (Fase B) ──
  leak_abs_pct_per_h: 8,     // absolute floor: 8 %/h
  leak_rel_factor: 1.8,      // relative (Phase B — needs the learned baseline)
  leak_rate_window_min: 90,  // window used to estimate the drop rate

  // ── R7 nocturnal window + field timezone ──
  night_from_h: 2,
  night_to_h: 5,
  utc_offset_h: -3,          // Argentina (per-field configurable)

  // ── Anti-saturation (§7/§8) ──
  notify_node_min: 120,      // 1 aviso por nodo cada 2 h
  notify_field_daily_max: 6, // 6 avisos por campo por día

  // ── Cross-diagnosis epsilon (solar rising test) ──
  tank_drop_epsilon_pct: 1.5,

  // ── Watchdog (§6.4) ──
  heartbeat_grace_factor: 1.6,        // gateway-down (zone outage) grace on its own period
  // Sensor "equipment down" is adaptive, not a fixed time: we tolerate a number of MISSED
  // UPLINKS (multiples of the sensor's own report interval), and allow MORE on a weak link
  // where packet loss is normal coverage noise, not a dead sensor. A tank sensor at -114 dBm
  // routinely skips an uplink or two; the old fixed 1.6× threshold read that as "equipo caído"
  // (the false alarm on Casco Bozzano, 24 min silence at -117 dBm = ~2 lost uplinks).
  heartbeat_miss_base: 2,             // tolerate 2 missed uplinks on a healthy link
  heartbeat_miss_weak_extra: 4,       // +4 more when the link is marginal (total 6)
  rssi_marginal_dbm: -110,            // at/below this, treat the link as marginal
  signal_degraded_enabled: false,  // cross-sensor RSSI-vs-gateway compare is wrong; off until per-sensor rework
  rssi_degraded_abs: -95,
  rssi_degraded_margin: 12,

  // ── Solar (weather-estimated pump) ──
  solar_min_expected_lph: 80,
};

export function policyFor(fieldPolicy) {
  return { ...DEFAULT_POLICY, ...(fieldPolicy || {}) };
}
