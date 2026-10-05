// milesight-ns@1 — Milesight built-in Network Server (SG50) MQTT format.
//
// The SG50's embedded NS publishes uplinks WITHOUT applying a payload codec, so the
// `data` field is the RAW base64 LoRaWAN payload — we decode the Milesight TLV bytes
// here (channel_id, channel_type, value…), per the official decoders
// (github.com/Milesight-IoT/SensorDecoders: em300-di, em500-udl).
//
// Envelope (Milesight NS, NOT ChirpStack v4):
//   { devEUI, deviceName, fPort, fCnt, data(base64), time,
//     rxInfo:[{rssi, loRaSNR, mac, ...}], txInfo:{...} }
// No deduplicationId → idempotency key = devEUI:fCnt.
//
// Two pilot models:
//   EM500-UDL (tank): 0x03/0x82 distance (uint16 LE, mm). 0xFFFF = no target.
//   EM300-DI (molino): 0x01/0x75 battery, 0x03/0x67 temp, 0x04/0x68 humidity,
//                      0x05/0xC8 pulse (uint32 LE) OR 0x05/0xE1 water (conv + float).
// The cumulative stroke counter → 'counter_delta' at ingest (reset-aware).

const u8  = (b, i) => b[i];
const u16 = (b, i) => (b[i + 1] << 8) | b[i];              // little-endian
const i16 = (b, i) => { const v = u16(b, i); return v > 0x7fff ? v - 0x10000 : v; };
const u32 = (b, i) => ((b[i + 3] << 24) | (b[i + 2] << 16) | (b[i + 1] << 8) | b[i]) >>> 0;
function f32(b, i) {                                        // IEEE-754 float32 LE
  const bits = ((b[i + 3] << 24) | (b[i + 2] << 16) | (b[i + 1] << 8) | b[i]) >>> 0;
  const sign = bits >>> 31 ? -1 : 1;
  const e = (bits >>> 23) & 0xff;
  const m = e === 0 ? (bits & 0x7fffff) << 1 : (bits & 0x7fffff) | 0x800000;
  return Number((sign * m * Math.pow(2, e - 150)).toFixed(2));
}

const NO_TARGET_MM = 0xffff;   // EM500-UDL: ultrasonic reads no reflecting surface

// Decode the Milesight TLV byte stream into a flat field map. Unknown channels stop
// the walk (we can't know their length) — we keep what we parsed.
function decodeTLV(b) {
  const out = {};
  let i = 0;
  while (i < b.length - 1) {
    const ch = b[i], ty = b[i + 1]; i += 2;
    if (ch === 0x01 && ty === 0x75) { out.battery = u8(b, i); i += 1; }
    else if (ch === 0x03 && ty === 0x67) { out.temperature = i16(b, i) / 10; i += 2; }
    else if (ch === 0x04 && ty === 0x68) { out.humidity = u8(b, i) / 2; i += 1; }
    else if (ch === 0x03 && ty === 0x82) { out.distance = u16(b, i); i += 2; }      // EM500-UDL
    else if (ch === 0x05 && ty === 0x00) { out.gpio = u8(b, i); i += 1; }           // DI input status
    else if (ch === 0x05 && ty === 0xc8) { out.pulse = u32(b, i); i += 4; }          // DI counter (uint32)
    else if (ch === 0x05 && ty === 0xe1) {                                           // DI counter (v1.3+)
      out.water_conv = u16(b, i) / 10;
      out.pulse_conv = u16(b, i + 2) / 10;
      out.water = f32(b, i + 4);
      i += 8;
    } else break;   // unknown channel / device-info — stop
  }
  return out;
}

// Cumulative stroke count from a DI frame: prefer the raw uint32 pulse; else derive
// from the water total ÷ pulse conversion (both come in the same 0x05/0xE1 field).
function strokeCounter(d) {
  if (d.pulse != null) return d.pulse;
  if (d.water != null) return d.pulse_conv > 0 ? Math.round(d.water / d.pulse_conv) : Math.round(d.water);
  return null;
}

function bestRssi(rxInfo) {
  if (!Array.isArray(rxInfo) || !rxInfo.length) return null;
  const v = rxInfo.map((g) => (g?.rssi == null ? null : Number(g.rssi))).filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
}

export default {
  profile: 'milesight-ns@1',
  decode(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('milesight-ns: object payload required');
    const devEui = String(payload.devEUI || payload.devEui || '').toLowerCase();
    if (!devEui) throw new Error('milesight-ns: missing devEUI');

    const raw = Buffer.from(String(payload.data || ''), 'base64');
    // The Milesight NS sends `time` as naive UTC ("2026-09-27T15:03:06"). Parsing it
    // without a zone makes new Date() read it as the server's local TZ → a +3h skew.
    // Force UTC unless an explicit zone/offset is already present.
    const t = payload.time;
    const ts = t ? new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z') : new Date();
    const rssi = bestRssi(payload.rxInfo);
    const fCnt = payload.fCnt;
    const msgUuid = `${devEui}:${fCnt ?? ''}`;

    // Device-info frames (channel 0xFF …, sent on join/startup) carry no measurement.
    if (raw.length < 2 || raw[0] === 0xff) return { msgUuid, readings: [] };

    const d = decodeTLV(raw);
    const battery = d.battery ?? null;
    const base = { sensorRef: devEui, ts, rssi, battery };
    const readings = [];

    if (d.distance != null) {
      // EM500-UDL tank level. Skip the "no target" sentinel (bench / open air).
      if (d.distance !== NO_TARGET_MM) {
        readings.push({ ...base, kind: 'tank_level', value: d.distance, transform: 'distance_top',
          raw: { model: 'EM500-UDL', distance_mm: d.distance } });
      }
    } else {
      // EM300-DI molino strokes (cumulative → counter_delta). Keep temp/humidity/water in raw.
      const counter = strokeCounter(d);
      if (counter != null) {
        readings.push({ ...base, kind: 'windmill_strokes', value: counter, transform: 'counter_delta',
          raw: { model: 'EM300-DI', counter, water: d.water, water_conv: d.water_conv,
            pulse_conv: d.pulse_conv, temperature: d.temperature, humidity: d.humidity, gpio: d.gpio } });
      }
    }

    return { msgUuid, gatewayRef: payload.applicationID, readings };
  },
};
