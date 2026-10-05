import { test } from 'node:test';
import assert from 'node:assert/strict';
import milesight from '../src/decoders/milesight-chirpstack.js';

// A realistic ChirpStack v4 uplink envelope. `object` is what the Milesight codec
// (loaded in the device profile) already decoded.
function uplink(profileName, devEui, object, extra = {}) {
  return {
    deduplicationId: `dedup-${devEui}-${extra.fCnt ?? 1}`,
    time: '2026-07-24T12:00:00+00:00',
    deviceInfo: { applicationId: 'app-pilot', deviceProfileName: profileName, devEui },
    fCnt: extra.fCnt ?? 1,
    fPort: 85,
    object,
    rxInfo: [{ gatewayId: 'gw1', rssi: -95, snr: 7 }, { gatewayId: 'gw2', rssi: -72, snr: 9 }],
    ...extra,
  };
}

test('EM300-DI: official `pulse` counter → windmill_strokes w/ counter_delta transform', () => {
  // Real Milesight EM300-DI codec emits `pulse` (cumulative uint32) + `gpio` state.
  const { readings, msgUuid, gatewayRef } = milesight.decode(
    uplink('EM300-DI', '24E124710C000001', { battery: 88, temperature: 21.5, humidity: 60, gpio: 'high', pulse: 123456 }));
  assert.equal(gatewayRef, 'app-pilot');
  assert.equal(msgUuid, 'dedup-24E124710C000001-1');
  assert.equal(readings.length, 1);
  const r = readings[0];
  assert.equal(r.sensorRef, '24e124710c000001');        // lowercased DevEUI
  assert.equal(r.kind, 'windmill_strokes');
  assert.equal(r.transform, 'counter_delta');
  assert.equal(r.value, 123456);                         // raw cumulative counter
  assert.equal(r.battery, 88);
  assert.equal(r.rssi, -72);                             // best of the two gateways
  assert.equal(r.raw.temperature, 21.5);
  assert.equal(r.raw.counter, 123456);
  assert.equal(r.raw.gpio, 'high');
});

test('EM300-DI: `counter` alias still accepted (contactless variant safety net)', () => {
  const { readings } = milesight.decode(uplink('EM300-DI', 'A1', { battery: 80, counter: 42 }));
  assert.equal(readings[0].value, 42);
  assert.equal(readings[0].transform, 'counter_delta');
});

test('EM500-UDL: distance → tank_level w/ distance_top transform', () => {
  const { readings } = milesight.decode(
    uplink('EM500-UDL', 'AA00', { battery: 90, distance: 1234 }));
  const r = readings[0];
  assert.equal(r.kind, 'tank_level');
  assert.equal(r.transform, 'distance_top');
  assert.equal(r.value, 1234);
  assert.equal(r.raw.distance_mm, 1234);
});

test('EM500-SWL: water_level → tank_level w/ depth_bottom transform', () => {
  const { readings } = milesight.decode(
    uplink('EM500-SWL', 'BB00', { battery: 77, water_level: 1800 }));
  const r = readings[0];
  assert.equal(r.kind, 'tank_level');
  assert.equal(r.transform, 'depth_bottom');
  assert.equal(r.value, 1800);
});

test('EM500-SWL: pressure fallback → depth in mm (1 kPa ≈ 102 mm)', () => {
  const { readings } = milesight.decode(
    uplink('EM500-SWL', 'BB01', { battery: 77, pressure: 10 }));
  assert.ok(Math.abs(readings[0].value - 1019.7) < 0.5, `got ${readings[0].value}`);
});

test('CT101: current → pump_current, no transform (direct)', () => {
  const { readings } = milesight.decode(
    uplink('CT101', 'CC00', { battery: 95, current: 3.4 }));
  const r = readings[0];
  assert.equal(r.kind, 'pump_current');
  assert.equal(r.transform, undefined);
  assert.equal(r.value, 3.4);
});

test('model detection falls back to field heuristic when profile name is absent', () => {
  const { readings } = milesight.decode(uplink('', 'DD00', { distance: 500 }));
  assert.equal(readings[0].kind, 'tank_level');
  assert.equal(readings[0].transform, 'distance_top');
});

test('rejects payload with no devEui', () => {
  assert.throws(() => milesight.decode({ object: { distance: 1 }, deviceInfo: {} }), /devEui/);
});

test('rejects a device whose model cannot be resolved', () => {
  assert.throws(() => milesight.decode(uplink('MYSTERY', 'EE00', { foo: 1 })), /cannot resolve model/);
});

test('msgUuid falls back to devEui:fCnt when no deduplicationId', () => {
  const p = uplink('EM500-UDL', 'FF00', { distance: 700 }, { fCnt: 9 });
  delete p.deduplicationId;
  assert.equal(milesight.decode(p).msgUuid, 'ff00:9');
});
