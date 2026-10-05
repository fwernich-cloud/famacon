// Ingest-time transforms (§13). A decoder may hand us a RAW device measurement
// (cumulative counter, ultrasonic distance, submersible depth) that only becomes a
// final reading once combined with live config the decoder can't see. These are the
// pure conversions; the DB lookups live in ingestService. Raw is kept in reading.meta.

const clamp0100 = (x) => Math.max(0, Math.min(100, x));

/**
 * Cumulative pulse counter → strokes in this report = delta vs the previous counter.
 * No previous value yet → null (unknown until a baseline exists, never a false 0>0).
 * A counter that went DOWN means the device reset → the new count is the delta.
 */
export function counterDelta(current, previous) {
  if (current == null) return null;
  if (previous == null) return null;
  return current >= previous ? current - previous : current;
}

/**
 * Ultrasonic distance (mm, sensor at the top) → level % of useful height.
 * distance = sensor→water. Full tank ⇒ distance ≈ sensor_offset; empty ⇒ offset + útil.
 *   nivel% = (útil − (distancia − offset)) / útil × 100
 */
export function distanceTopToLevelPct(distance_mm, { height_mm, sensor_offset_mm } = {}) {
  if (distance_mm == null || !(height_mm > 0)) return null;
  const offset = sensor_offset_mm || 0;
  return clamp0100(((height_mm - (distance_mm - offset)) / height_mm) * 100);
}

/**
 * Submersible depth (mm, measured from the bottom) → level % of useful height.
 *   nivel% = profundidad / útil × 100
 */
export function depthBottomToLevelPct(depth_mm, { height_mm } = {}) {
  if (depth_mm == null || !(height_mm > 0)) return null;
  return clamp0100((depth_mm / height_mm) * 100);
}
