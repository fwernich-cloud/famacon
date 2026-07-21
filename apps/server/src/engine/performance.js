// ── Windmill performance / wear foundation (§6.8, FORMULA doc) ──────────────
// Rendimiento = litros reales ÷ litros teóricos, to detect cuero wear over months.
// Wear PREDICTION is Phase 2; here we lay the foundation: the formula + the
// clean-window measurement + graceful "trend vs absolute" handling.
//
// Litros teóricos = geometric volume per stroke × η (calibrated with a new cuero).
// η is a DB parameter (never hardcoded); until calibrated we report TREND, not
// an absolute rendimiento, so a wrong η can't flag every windmill as worn on day 1.

const PI = Math.PI;

/** Geometric liters displaced per stroke. D and carrera in CENTIMETRES → liters. */
export function geometricLitersPerStroke(D_cm, carrera_cm) {
  if (!(D_cm > 0) || !(carrera_cm > 0)) return null;
  return (PI / 4) * D_cm * D_cm * carrera_cm / 1000;
}

/** Theoretical liters per stroke for a healthy windmill = geometric × η. */
export function theoreticalLitersPerStroke(D_cm, carrera_cm, eta) {
  const g = geometricLitersPerStroke(D_cm, carrera_cm);
  if (g == null || !(eta > 0)) return null;
  return g * eta;
}

/** Tank cross-section area (m²) from geometry (mm inputs). */
export function tankAreaM2(geom) {
  if (!geom) return null;
  if (geom.shape === 'rectangular' && geom.width_mm && geom.length_mm) {
    return (geom.width_mm / 1000) * (geom.length_mm / 1000);
  }
  if (geom.diameter_mm) {
    const r = geom.diameter_mm / 1000 / 2;
    return PI * r * r;
  }
  return null;
}

/**
 * Real liters that entered the tank over a window, from the % level rise.
 * level is stored as % of the tank's useful height.
 */
export function realLitersFromRise(deltaLevelPct, usefulHeight_m, areaM2) {
  if (deltaLevelPct == null || !(usefulHeight_m > 0) || !(areaM2 > 0)) return null;
  const rise_m = (deltaLevelPct / 100) * usefulHeight_m;
  return rise_m * areaM2 * 1000; // m³ → L
}

/**
 * Combine a clean-window measurement into a performance result.
 * Modes: 'calibrated' (absolute rendimiento), 'trend' (ratio vs geometric,
 * η not yet measured), or 'insufficient' (missing config/geometry/strokes).
 */
export function computeWindowPerformance({ strokes, D_cm, carrera_cm, eta, realLiters }) {
  const geomPerStroke = geometricLitersPerStroke(D_cm, carrera_cm);
  if (geomPerStroke == null || !(strokes > 0) || realLiters == null) {
    return { mode: 'insufficient', geomPerStroke };
  }
  const geomLiters = geomPerStroke * strokes;
  if (eta > 0) {
    const theoretical = geomLiters * eta;
    return { mode: 'calibrated', rendimiento: realLiters / theoretical, geomPerStroke, geomLiters, theoretical };
  }
  // η not measured yet → report the raw ratio for trending only.
  return { mode: 'trend', ratio: realLiters / geomLiters, geomPerStroke, geomLiters };
}

import {
  windmillConfigFull, tankGeometryByRef, strokesSum, tankRiseByRef,
} from '../db/queries.js';

/**
 * DB-backed performance for one windmill over a recent clean window (tank rising).
 * Reads config (cylinder→D, wheel→carrera, η), tank geometry, strokes and level
 * rise — all tenant-scoped. Returns a status the dashboard can render honestly,
 * degrading gracefully while pilot values are "a confirmar".
 */
export async function computePerformanceForWindmill(client, equipmentId, sinceIso) {
  const cfg = await windmillConfigFull(client, equipmentId);
  if (!cfg) return { mode: 'insufficient', reason: 'no equipment' };
  if (cfg.internal_diameter_mm == null || cfg.carrera_cm == null) {
    return { mode: 'no_config', reason: 'cilindro/carrera a confirmar' };
  }
  const D_cm = cfg.internal_diameter_mm / 10;
  const geom = await tankGeometryByRef(client, cfg.fills_tank);
  const rise = await tankRiseByRef(client, cfg.fills_tank, sinceIso);
  const strokes = await strokesSum(client, equipmentId, sinceIso);

  if (!geom || geom.height_mm == null) {
    return { mode: 'trend_pending_geometry', reason: 'geometría del tanque a confirmar',
      geomPerStroke: geometricLitersPerStroke(D_cm, cfg.carrera_cm), strokes };
  }
  const area = tankAreaM2(geom);
  const deltaPct = rise && rise.first_v != null && rise.last_v != null ? rise.last_v - rise.first_v : null;
  if (deltaPct == null || deltaPct <= 0) {
    return { mode: 'no_clean_window', reason: 'el tanque no subió en la ventana' };
  }
  const realLiters = realLitersFromRise(deltaPct, geom.height_mm / 1000, area);
  return computeWindowPerformance({ strokes, D_cm, carrera_cm: cfg.carrera_cm, eta: cfg.eta_base, realLiters });
}
