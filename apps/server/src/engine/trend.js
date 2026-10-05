// Wave-tolerant trend detection (spec §4). An ultrasonic sensor over a windy tank
// reads waves, so raw last-vs-previous deltas oscillate and would flip "bajando" on
// and off. We smooth with a moving average and only call it a fall on a SUSTAINED
// drop over the smoothed series. Pure — unit-testable without a DB.

/** Moving average of `series` with window `w`. Returns the smoothed points. */
export function movingAverage(series, w = 3) {
  const v = (series || []).filter((x) => x != null);
  if (v.length === 0) return [];
  if (v.length < w) return [v.reduce((a, b) => a + b, 0) / v.length];
  const out = [];
  for (let i = 0; i + w <= v.length; i++) {
    let s = 0;
    for (let j = i; j < i + w; j++) s += v[j];
    out.push(s / w);
  }
  return out;
}

/**
 * Sustained fall of ≥ dropPct over the smoothed series (§4: "caída sostenida de
 * ≥5% en 3 lecturas consecutivas, sobre promedio móvil de las últimas 3 mediciones").
 * @param {number[]} seriesOldestFirst level % values, oldest→newest
 */
export function detectBajando(seriesOldestFirst, dropPct = 5, w = 3) {
  const v = (seriesOldestFirst || []).filter((x) => x != null);
  if (v.length < 3) return false;
  const ma = movingAverage(v, Math.min(w, v.length));
  if (ma.length < 2) return false;
  const drop = ma[0] - ma[ma.length - 1];
  return drop >= dropPct;
}

/** Drop rate in %/h from a first/last sample pair with timestamps. Negative = falling. */
export function ratePctPerHour({ firstV, firstTs, lastV, lastTs }) {
  if (firstV == null || lastV == null || !firstTs || !lastTs) return null;
  const hours = (new Date(lastTs).getTime() - new Date(firstTs).getTime()) / 3_600_000;
  if (!(hours > 0)) return null;
  return (lastV - firstV) / hours;
}
