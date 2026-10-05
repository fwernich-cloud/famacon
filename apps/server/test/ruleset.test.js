import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules, ruleText } from '../src/engine/ruleset.js';
import { DEFAULT_POLICY } from '../src/engine/policy.js';

const P = DEFAULT_POLICY;
const base = { level: 70, bajando: false, running: true, hoursStopped: 0, night: false, ratePctPerHour: null, policy: P };
const types = (ctx) => evaluateRules({ ...base, ...ctx }).map((r) => r.type);

test('R1 informativa: <50 + bombeando, once', () => {
  const r = evaluateRules({ ...base, level: 40, running: true });
  assert.deepEqual(r.map((x) => x.type), ['R1']);
  assert.equal(r[0].once, true);
});

test('R2 advertencia: <50 + parado >2h + bajando', () => {
  assert.deepEqual(types({ level: 40, running: false, hoursStopped: 3, bajando: true }), ['R2']);
});

test('R2 does NOT fire before 2h stopped', () => {
  assert.deepEqual(types({ level: 40, running: false, hoursStopped: 1, bajando: true }), []);
});

test('R3 advertencia alta: parado >6h + bajando (any level)', () => {
  assert.deepEqual(types({ level: 65, running: false, hoursStopped: 7, bajando: true }), ['R3']);
});

test('R3 does NOT fire if tank not dropping (full & stable)', () => {
  assert.deepEqual(types({ level: 90, running: false, hoursStopped: 8, bajando: false }), []);
});

test('R4 crítica: <20 + parado (beats R3)', () => {
  const r = evaluateRules({ ...base, level: 15, running: false, hoursStopped: 8, bajando: true });
  assert.deepEqual(r.map((x) => x.type), ['R4']);
  assert.equal(r[0].severity, 'urgent');
});

test('R5 crítica: <20 + bombeando', () => {
  const r = evaluateRules({ ...base, level: 12, running: true });
  assert.deepEqual(r.map((x) => x.type), ['R5']);
  assert.equal(r[0].severity, 'urgent');
});

test('R7 nocturna: 2–5h + bajando + parado (daytime would be R2/none)', () => {
  assert.deepEqual(types({ level: 60, running: false, hoursStopped: 1, bajando: true, night: true }), ['R7']);
  // same conditions in daylight, <2h stopped, level ≥50 → nothing
  assert.deepEqual(types({ level: 60, running: false, hoursStopped: 1, bajando: true, night: false }), []);
});

test('R6 fast-fall fires on absolute 8%/h floor, independent of supply rule', () => {
  const r = evaluateRules({ ...base, level: 40, running: true, ratePctPerHour: -9 });
  assert.deepEqual(r.map((x) => x.type).sort(), ['R1', 'R6']);
});

test('R6 does NOT fire below the 8%/h floor', () => {
  assert.deepEqual(types({ level: 70, running: true, ratePctPerHour: -5 }), []);
});

test('stable + running → silence', () => {
  assert.deepEqual(types({ level: 70, running: true, bajando: false }), []);
});

test('ruleText fills placeholders (rioplatense)', () => {
  assert.match(ruleText('R4', { name: 'tank_01', level: 12.4, hours: 3.6 }), /tank_01 — Tanque al 12%.*parado hace 4 horas/);
});
