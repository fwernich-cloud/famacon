import { config } from '../config/index.js';

// ── Solar pump via weather API (§6.7) ──────────────────────────────────────
// The pilot's solar pump has NO current sensor. Instead we ask a weather API for
// solar irradiation at the field's lat/lon, turn that into EXPECTED pumping via
// Famacon's pump table (product data), and cross it with the tank: if the sun
// says it should be filling and the tank isn't rising → problem. Same "what + why"
// philosophy, equipment signal estimated from weather instead of measured.

/** Current shortwave solar irradiance (W/m²) at a location, from Open-Meteo. */
export async function currentIrradiance(lat, lon, { fetchImpl = fetch } = {}) {
  if (lat == null || lon == null) return null;
  const url = `${config.weatherApiBase}/forecast?latitude=${lat}&longitude=${lon}` +
              `&current=shortwave_radiation&timezone=UTC`;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const v = data?.current?.shortwave_radiation;
    return typeof v === 'number' ? v : null;
  } catch {
    return null; // weather outage must never crash evaluation
  }
}

/** Linear interpolation of expected liters/hour from the pump table. */
export function expectedPumping(irradianceWm2, table) {
  if (irradianceWm2 == null || !table?.length) return null;
  const pts = [...table].sort((a, b) => a.irradiance_wm2 - b.irradiance_wm2);
  if (irradianceWm2 <= pts[0].irradiance_wm2) return pts[0].expected_lph;
  const last = pts[pts.length - 1];
  if (irradianceWm2 >= last.irradiance_wm2) return last.expected_lph;
  for (let i = 1; i < pts.length; i++) {
    if (irradianceWm2 <= pts[i].irradiance_wm2) {
      const a = pts[i - 1], b = pts[i];
      const t = (irradianceWm2 - a.irradiance_wm2) / (b.irradiance_wm2 - a.irradiance_wm2);
      return a.expected_lph + t * (b.expected_lph - a.expected_lph);
    }
  }
  return last.expected_lph;
}
