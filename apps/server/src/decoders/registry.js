// ── Decoder registry (§2 / §6.2) ───────────────────────────────────────────
// The wire format is isolated behind ONE seam. A decoder is a pure function that
// turns a raw hardware payload into normalized readings. Switching hardware
// supplier = register another decoder here, nothing else changes.
//
// Contract:  decode(payload) -> { msgUuid?: string, readings: NormalizedReading[] }
//   NormalizedReading = { sensorRef, kind, value, battery?, rssi?, ts? }
//   kind ∈ tank_level | windmill_strokes | pump_current | battery | temperature

import genericJson from './generic-json.js';
import examplePulse from './example-pulse.js';

const registry = new Map();

export function registerDecoder(profile, decoder) {
  if (typeof decoder?.decode !== 'function') {
    throw new Error(`Decoder for "${profile}" must expose decode()`);
  }
  registry.set(profile, decoder);
}

export function getDecoder(profile) {
  const d = registry.get(profile);
  if (!d) throw new Error(`No decoder registered for hardware_profile "${profile}"`);
  return d;
}

export function listProfiles() {
  return [...registry.keys()];
}

// Built-in decoders. Add new supplier decoders with registerDecoder(...).
registerDecoder('generic-json@1', genericJson);
registerDecoder('example-pulse@1', examplePulse);
