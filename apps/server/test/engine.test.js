import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossDiagnose } from '../src/engine/crossDiagnosis.js';
import { expectedPumping } from '../src/solar/index.js';

const EPS = 1.5;

test('situation 1: stable + running → silence', () => {
  const d = crossDiagnose({ tankLevel: 70, tankDelta: 0, equipmentState: 'running', dropEpsilon: EPS });
  assert.equal(d.alert, false); assert.equal(d.situation, 1);
});

test('situation 2: dropping + running → silence (animals drinking)', () => {
  const d = crossDiagnose({ tankLevel: 55, tankDelta: -12, equipmentState: 'running', dropEpsilon: EPS });
  assert.equal(d.alert, false); assert.equal(d.situation, 2);
});

test('situation 3: dropping + stopped → URGENT', () => {
  const d = crossDiagnose({ tankLevel: 12, tankDelta: -40, equipmentState: 'stopped', dropEpsilon: EPS });
  assert.equal(d.alert, true); assert.equal(d.severity, 'urgent'); assert.equal(d.situation, 3);
});

test('stopped but tank stable (tank full) → silence', () => {
  const d = crossDiagnose({ tankLevel: 95, tankDelta: 0, equipmentState: 'stopped', dropEpsilon: EPS });
  assert.equal(d.alert, false);
});

test('solar: sun says should fill but tank NOT rising → URGENT', () => {
  const d = crossDiagnose({ tankLevel: 40, tankDelta: -3, equipmentState: 'should_run', dropEpsilon: EPS, tankRising: false });
  assert.equal(d.alert, true); assert.equal(d.situation, 3);
});

test('solar: sun says should fill and tank rising → silence', () => {
  const d = crossDiagnose({ tankLevel: 60, tankDelta: +8, equipmentState: 'should_run', dropEpsilon: EPS, tankRising: true });
  assert.equal(d.alert, false);
});

test('expectedPumping interpolates and clamps', () => {
  const table = [{ irradiance_wm2: 0, expected_lph: 0 }, { irradiance_wm2: 200, expected_lph: 400 }, { irradiance_wm2: 400, expected_lph: 900 }];
  assert.equal(expectedPumping(100, table), 200);   // midpoint 0..200
  assert.equal(expectedPumping(0, table), 0);
  assert.equal(expectedPumping(999, table), 900);   // clamp high
  assert.equal(expectedPumping(null, table), null);
});
