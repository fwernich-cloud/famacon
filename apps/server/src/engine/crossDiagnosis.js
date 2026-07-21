// ── Cross-diagnosis (§2) — the core differentiator ─────────────────────────
// Tank level × equipment state → the three situations. Silence is part of the
// product: we only raise the urgent cross-alert in situation 3.
//
//   1. tank OK/stable   + equipment running        → SILENCE
//   2. tank dropping    + equipment running         → SILENCE (animals drinking)
//   3. tank dropping    + equipment STOPPED         → URGENT ALERT
//
// For a solar pump with no current sensor, "running" is replaced by "the sun says
// it should be filling" (weather-estimated). Sun strong + tank not rising → problem.

/**
 * @param {object} p
 * @param {number} p.tankLevel      latest tank level (%)
 * @param {number} p.tankDelta      recent change in level (%), negative = dropping
 * @param {'running'|'stopped'|'should_run'|'unknown'} p.equipmentState
 * @param {number} p.dropEpsilon    below |delta| this counts as stable
 * @param {boolean} [p.tankRising]  for solar: is the tank actually rising?
 * @returns {{situation:number, alert:boolean, severity:string, reason:string}}
 */
export function crossDiagnose({ tankLevel, tankDelta, equipmentState, dropEpsilon, tankRising }) {
  const dropping = tankDelta != null && tankDelta < -Math.abs(dropEpsilon);

  // Solar case: the "equipment signal" is the weather estimate.
  if (equipmentState === 'should_run') {
    // Sun says it should be filling. If the tank is NOT rising (flat or dropping),
    // that's the solar analogue of situation 3.
    if (tankRising === false) {
      return { situation: 3, alert: true, severity: 'urgent',
        reason: 'El sol indica que la bomba debería estar llenando, pero el tanque no sube.' };
    }
    return { situation: 1, alert: false, severity: 'info',
      reason: 'Sol suficiente y tanque respondiendo. Normal.' };
  }

  if (equipmentState === 'running') {
    // Situations 1 & 2 — both silent.
    return dropping
      ? { situation: 2, alert: false, severity: 'info',
          reason: 'Tanque bajando con equipo andando: normal, los animales toman.' }
      : { situation: 1, alert: false, severity: 'info',
          reason: 'Tanque estable con equipo andando. Normal.' };
  }

  if (equipmentState === 'stopped') {
    if (dropping) {
      return { situation: 3, alert: true, severity: 'urgent',
        reason: 'Tanque bajando y equipo PARADO: el tanque se vacía sin reposición.' };
    }
    // Stopped but tank not dropping (e.g. tank full, float closed) → normal.
    return { situation: 1, alert: false, severity: 'info',
      reason: 'Equipo detenido pero tanque estable (probable tanque lleno). Normal.' };
  }

  return { situation: 0, alert: false, severity: 'info', reason: 'Estado de equipo desconocido.' };
}
