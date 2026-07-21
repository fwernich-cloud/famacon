import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  geometricLitersPerStroke, theoreticalLitersPerStroke, tankAreaM2,
  realLitersFromRise, computeWindowPerformance,
} from '../src/engine/performance.js';

const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;

// The doc's verifiable example: wheel 12' (carrera 22cm), cylinder 3" (D=7.62cm).
test('geometric L/stroke matches FORMULA doc example (1.0032 L)', () => {
  const g = geometricLitersPerStroke(7.62, 22);
  assert.ok(near(g, 1.0032, 1e-3), `got ${g}`);
});

test('theoretical L/stroke with η=0.85 matches doc (0.853 L)', () => {
  const t = theoreticalLitersPerStroke(7.62, 22, 0.85);
  assert.ok(near(t, 0.853, 1e-3), `got ${t}`);
});

test('geometric returns null on missing/invalid inputs', () => {
  assert.equal(geometricLitersPerStroke(0, 22), null);
  assert.equal(geometricLitersPerStroke(7.62, null), null);
});

test('tank area: cylinder Ø2m → ~3.1416 m²', () => {
  assert.ok(near(tankAreaM2({ shape: 'cylinder', diameter_mm: 2000 }), Math.PI, 1e-3));
});

test('tank area: rectangular 2×3 m → 6 m²', () => {
  assert.equal(tankAreaM2({ shape: 'rectangular', width_mm: 2000, length_mm: 3000 }), 6);
});

test('real liters from a 10% rise, 1.5m useful height, π m² area', () => {
  // 0.10 * 1.5 = 0.15 m rise; × π m² × 1000 = ~471.24 L
  const L = realLitersFromRise(10, 1.5, Math.PI);
  assert.ok(near(L, 471.238, 1e-2), `got ${L}`);
});

test('performance: calibrated mode when η known', () => {
  const r = computeWindowPerformance({ strokes: 100, D_cm: 7.62, carrera_cm: 22, eta: 0.85, realLiters: 80 });
  assert.equal(r.mode, 'calibrated');
  // theoretical = 1.0032*100*0.85 = 85.27; rendimiento = 80/85.27 ≈ 0.938
  assert.ok(near(r.rendimiento, 0.938, 1e-2), `got ${r.rendimiento}`);
});

test('performance: trend mode when η not yet measured', () => {
  const r = computeWindowPerformance({ strokes: 100, D_cm: 7.62, carrera_cm: 22, eta: null, realLiters: 80 });
  assert.equal(r.mode, 'trend');
  assert.ok(r.ratio > 0);
});

test('performance: insufficient when no config', () => {
  const r = computeWindowPerformance({ strokes: 100, D_cm: null, carrera_cm: 22, eta: 0.85, realLiters: 80 });
  assert.equal(r.mode, 'insufficient');
});
