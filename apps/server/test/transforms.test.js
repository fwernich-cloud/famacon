import { test } from 'node:test';
import assert from 'node:assert/strict';
import { counterDelta, distanceTopToLevelPct, depthBottomToLevelPct } from '../src/ingestion/transforms.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('counterDelta: normal increment', () => {
  assert.equal(counterDelta(1050, 1000), 50);
});
test('counterDelta: no previous baseline → null (never a false 0)', () => {
  assert.equal(counterDelta(1000, null), null);
});
test('counterDelta: device reset (counter dropped) → new count is the delta', () => {
  assert.equal(counterDelta(30, 999000), 30);
});
test('counterDelta: no movement → 0 strokes (molino parado)', () => {
  assert.equal(counterDelta(1000, 1000), 0);
});

// Tank: útil 2000 mm, sensor 300 mm above the rim.
const GEOM = { height_mm: 2000, sensor_offset_mm: 300 };
test('distance_top: full tank (water at rim, distance≈offset) → ~100%', () => {
  assert.ok(near(distanceTopToLevelPct(300, GEOM), 100), distanceTopToLevelPct(300, GEOM));
});
test('distance_top: empty tank (distance = offset+útil) → 0%', () => {
  assert.ok(near(distanceTopToLevelPct(2300, GEOM), 0), distanceTopToLevelPct(2300, GEOM));
});
test('distance_top: half full → 50%', () => {
  assert.ok(near(distanceTopToLevelPct(1300, GEOM), 50), distanceTopToLevelPct(1300, GEOM));
});
test('distance_top: clamps below 0 / above 100', () => {
  assert.equal(distanceTopToLevelPct(9999, GEOM), 0);
  assert.equal(distanceTopToLevelPct(0, GEOM), 100);
});
test('distance_top: geometry a confirmar (no height) → null', () => {
  assert.equal(distanceTopToLevelPct(1300, { sensor_offset_mm: 300 }), null);
});

test('depth_bottom: depth/útil → %', () => {
  assert.ok(near(depthBottomToLevelPct(1000, { height_mm: 2000 }), 50));
  assert.equal(depthBottomToLevelPct(2500, { height_mm: 2000 }), 100); // clamp
});
