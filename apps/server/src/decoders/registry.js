// ── Decoder registry (§2 / §6.2) ───────────────────────────────────────────
// The wire format is isolated behind ONE seam. A decoder is a pure function that
// turns a raw hardware payload into normalized readings. Switching hardware
// supplier = register another decoder here, nothing else changes.
//
// Contract:  decode(payload) -> { msgUuid?: string, gatewayRef?: string, readings: NormalizedReading[] }
//   NormalizedReading = { sensorRef, kind, value, battery?, rssi?, ts?, transform?, raw? }
//   kind ∈ tank_level | windmill_strokes | pump_current | battery | temperature
//   transform? ∈ counter_delta | distance_top | depth_bottom
//     A raw device measurement the ingest layer finalizes against live config while
//     keeping the raw value in reading.meta (e.g. cumulative counter → stroke delta,
//     ultrasonic distance → level %). Absent ⇒ value is already final.
//   raw?  object stashed into reading.meta for audit / recalibration.

import genericJson from './generic-json.js';
import examplePulse from './example-pulse.js';
import milesightChirpstack from './milesight-chirpstack.js';
import milesightNs from './milesight-ns.js';

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
registerDecoder('milesight-chirpstack@1', milesightChirpstack);
registerDecoder('milesight-ns@1', milesightNs);
