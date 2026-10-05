// R1–R8 graded cross-rules (spec §3). PURE: evaluate.js assembles the per-tank
// context from the DB and calls evaluateRules(). R8 ("sin comunicación") is the
// watchdog's job, so it lives there, not here.
//
// Each rule carries its dispatch severity (mapped to the 3 tiers info/warning/urgent)
// and its retry cadence. once=true fires a single time and never retries.

export const RULE_META = {
  R1: { severity: 'info',    retry_min: null, once: true }, // informativa — avisa una vez
  R2: { severity: 'warning', retry_min: 360 },              // advertencia (reintento 6 h)
  R3: { severity: 'warning', retry_min: 240 },              // advertencia alta (4 h)
  R4: { severity: 'urgent',  retry_min: 120 },              // crítica (2 h)
  R5: { severity: 'urgent',  retry_min: 120 },              // crítica (2 h)
  R6: { severity: 'warning', retry_min: 360 },              // consultiva (6 h)
  R7: { severity: 'warning', retry_min: 360 },              // advertencia nocturna
};

// Spec §7 — castellano rioplatense, voseo, sin tecnicismos.
export function ruleText(type, { name, level, hours }) {
  const lvl = level == null ? '—' : Math.round(level);
  const hrs = hours == null ? '—' : Math.round(hours);
  switch (type) {
    case 'R1': return `Tanque ${name} al ${lvl}%. El molino está bombeando normalmente. Te avisamos para que lo tengas presente.`;
    case 'R2': return `Tanque ${name} al ${lvl}% y bajando. El molino no registra movimiento hace ${hrs} horas. Puede ser falta de viento, pero quedate atento.`;
    case 'R3': return `El molino de ${name} no se mueve hace ${hrs} horas y el tanque viene bajando (${lvl}%). Convendría darle una revisada.`;
    case 'R4': return `${name} — Tanque al ${lvl}%. El molino está parado hace ${hrs} horas. Hay que ir a revisar.`;
    case 'R5': return `${name} — Tanque al ${lvl}%. El molino está bombeando, pero el consumo es mayor a lo que entra. Puede faltar agua.`;
    case 'R6': return `Tanque ${name} está bajando más rápido de lo habitual. ¿Cargaste más hacienda o puede ser una pérdida? Te seguimos avisando si continúa.`;
    case 'R7': return `Tanque ${name} bajó durante la noche con el molino parado. La hacienda no toma a esa hora, así que puede haber una pérdida.`;
    default:   return `Aviso en ${name}.`;
  }
}

/**
 * Pick the single highest-priority "supply" rule (R1–R5, R7) plus, independently,
 * R6 (fast-fall / leak question). Returns [] when nothing applies — e.g. tank full
 * & stable, or equipment stopped but tank not dropping (§3 R3 note).
 *
 * @param {object} ctx
 * @param {number}  ctx.level           tank level %
 * @param {boolean} ctx.bajando         sustained fall (§4)
 * @param {boolean} ctx.running         any feeder delivering water now
 * @param {number}  ctx.hoursStopped    hours since the last activity (0 if running)
 * @param {boolean} ctx.night           local time within the nocturnal window
 * @param {number}  ctx.ratePctPerHour  drop rate (negative = falling), for R6
 * @param {object}  ctx.policy
 * @returns {Array<{type:string, severity:string, retry_min:number|null, once?:boolean}>}
 */
export function evaluateRules(ctx) {
  const { level, bajando, running, hoursStopped, night, ratePctPerHour, policy: p } = ctx;
  const out = [];
  const stopped = !running;
  const stoppedH = hoursStopped ?? 0;
  const below = (limit) => level != null && level < limit;

  // ── Supply rule — highest severity/urgency first (mutually exclusive) ──
  let type = null;
  if (below(p.tank_critical_pct) && stopped) type = 'R4';                                     // crítica, parado
  else if (below(p.tank_critical_pct) && running) type = 'R5';                                // crítica, bombeando
  else if (stopped && stoppedH > p.equipo_prolongado_h && bajando) type = 'R3';               // detenido prolongado
  else if (night && bajando && stopped) type = 'R7';                                          // nocturna
  else if (below(p.tank_low_pct) && stopped && stoppedH > p.equipo_aviso_h && bajando) type = 'R2';
  else if (below(p.tank_low_pct) && running) type = 'R1';                                     // informativa

  if (type) out.push({ type, ...RULE_META[type] });

  // ── R6 fast-fall (independent leak question) — absolute floor works day-one;
  //    the relative 1,8× criterion is added in Phase B once the node is calibrated. ──
  if (ratePctPerHour != null && ratePctPerHour <= -Math.abs(p.leak_abs_pct_per_h)) {
    out.push({ type: 'R6', ...RULE_META.R6 });
  }
  return out;
}
