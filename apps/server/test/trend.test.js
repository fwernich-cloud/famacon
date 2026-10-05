import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movingAverage, detectBajando, ratePctPerHour } from '../src/engine/trend.js';

test('movingAverage smooths with window 3', () => {
  assert.deepEqual(movingAverage([10, 20, 30, 40], 3), [20, 30]);
});

test('detectBajando: sustained ≥5% fall → true', () => {
  // oldest→newest, smoothed drop well over 5
  assert.equal(detectBajando([80, 78, 74, 70, 66], 5), true);
});

test('detectBajando ignores wave noise below threshold', () => {
  // oscillates around 70, no sustained 5% fall
  assert.equal(detectBajando([70, 72, 69, 71, 70], 5), false);
});

test('detectBajando needs at least 3 readings', () => {
  assert.equal(detectBajando([80, 60], 5), false);
});

test('detectBajando: a single dip is smoothed away', () => {
  assert.equal(detectBajando([70, 70, 60, 70, 70], 5), false);
});

test('ratePctPerHour computes signed %/h', () => {
  const t0 = '2026-08-18T00:00:00Z';
  const t1 = '2026-08-18T02:00:00Z'; // 2 hours later
  assert.equal(ratePctPerHour({ firstV: 80, firstTs: t0, lastV: 60, lastTs: t1 }), -10);
});

test('ratePctPerHour null on bad input', () => {
  assert.equal(ratePctPerHour({ firstV: null, firstTs: null, lastV: 60, lastTs: '2026-08-18T02:00:00Z' }), null);
});
