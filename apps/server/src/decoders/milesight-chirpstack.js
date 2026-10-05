// milesight-chirpstack@1 — the real pilot hardware (§13).
//
// The Milesight SG50 gateway runs ChirpStack, which publishes an uplink event per
// device on  application/<appId>/device/<devEui>/event/up . The Milesight codec is
// loaded into each device profile, so ChirpStack already hands us a decoded `object`.
// This decoder maps that envelope to our normalized readings:
//   - devEui           -> sensorRef        (each sensor.ext_ref = its DevEUI)
//   - object.<field>   -> kind + value
//   - rxInfo[].rssi    -> rssi (best gateway)
//   - deduplicationId  -> msgUuid (idempotency key)
//
// Two device measurements are NOT final values — they carry a `transform` so the
// ingest layer (which has DB + tenant context) can finish the job against live config
// while KEEPING the raw device reading in reading.meta (FORMULA §6-7):
//   - EM300-DI  pulse counter is CUMULATIVE  -> transform 'counter_delta'
//   - EM500-UDL ultrasonic gives DISTANCE    -> transform 'distance_top'  (mounted at top)
//   - EM500-SWL submersible gives DEPTH       -> transform 'depth_bottom' (from the bottom)
//   - CT101     current is direct (Amps)      -> no transform
//
// Field names / units are confirmed against Milesight's official codecs; until then we
// accept the common aliases each model emits.

// Pull the first present key from an object, given candidate names.
function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null) return obj[k];
  }
  return null;
}
const num = (v) => (v == null ? null : Number(v));

// Which Milesight model a device is: prefer the ChirpStack device-profile name,
// fall back to a field heuristic on the decoded object.
function detectModel(profileName, object) {
  const p = String(profileName || '').toUpperCase();
  if (p.includes('EM300') || p.includes('DI')) return 'EM300-DI';
  if (p.includes('UDL')) return 'EM500-UDL';
  if (p.includes('SWL')) return 'EM500-SWL';
  if (p.includes('CT10') || p.includes('CT1')) return 'CT101';
  // Heuristic on the decoded fields.
  if (pick(object, ['pulse', 'counter', 'count', 'gpio_1_count']) != null || object.gpio != null || object.gpio_1 != null) return 'EM300-DI';
  if (pick(object, ['distance']) != null) return 'EM500-UDL';
  if (pick(object, ['current', 'total_current']) != null) return 'CT101';
  if (pick(object, ['water_level', 'level', 'depth', 'pressure']) != null) return 'EM500-SWL';
  return null;
}

// Best (highest) RSSI across the gateways that heard the uplink.
function bestRssi(rxInfo) {
  if (!Array.isArray(rxInfo) || !rxInfo.length) return null;
  const vals = rxInfo.map((g) => (g?.rssi == null ? null : Number(g.rssi))).filter((x) => x != null);
  return vals.length ? Math.max(...vals) : null;
}

export default {
  profile: 'milesight-chirpstack@1',
  decode(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('milesight-chirpstack: object payload required');
    }
    const info = payload.deviceInfo || {};
    const devEui = String(info.devEui || payload.devEui || '').toLowerCase();
    if (!devEui) throw new Error('milesight-chirpstack: missing devEui');

    const object = payload.object || {};
    const model = detectModel(info.deviceProfileName, object);
    if (!model) throw new Error(`milesight-chirpstack: cannot resolve model for ${devEui}`);

    const ts = payload.time ? new Date(payload.time) : new Date();
    const rssi = bestRssi(payload.rxInfo);
    const battery = num(pick(object, ['battery', 'battery_level']));
    const base = { sensorRef: devEui, ts, rssi, battery };

    const readings = [];
    if (model === 'EM300-DI') {
      // Official codec: cumulative uint32 pulse counter is `pulse`, input state is `gpio`
      // ("low"/"high"). (`counter`/`gpio_1` kept as aliases in case the molino node — reed
      // vs the Hall/contactless EM300-DI-Hall variant — emits a different key.)
      // → strokes: ingest computes the delta vs the last report.
      const counter = num(pick(object, ['pulse', 'counter', 'count', 'gpio_1_count']));
      if (counter == null) throw new Error(`milesight-chirpstack: EM300-DI ${devEui} has no pulse counter`);
      readings.push({
        ...base, kind: 'windmill_strokes', value: counter, transform: 'counter_delta',
        raw: { model, counter, gpio: pick(object, ['gpio', 'gpio_1']),
          temperature: num(object.temperature), humidity: num(object.humidity) },
      });
    } else if (model === 'EM500-UDL') {
      // Ultrasonic distance (mm) from the top → level %: ingest applies tank geometry.
      const distance = num(pick(object, ['distance', 'distance_mm']));
      if (distance == null) throw new Error(`milesight-chirpstack: EM500-UDL ${devEui} has no distance`);
      readings.push({
        ...base, kind: 'tank_level', value: distance, transform: 'distance_top',
        raw: { model, distance_mm: distance },
      });
    } else if (model === 'EM500-SWL') {
      // Submersible depth (mm from the bottom) → level %: ingest applies useful height.
      let depth = num(pick(object, ['water_level', 'level', 'depth', 'depth_mm']));
      if (depth == null) {
        const kpa = num(object.pressure);           // fallback: 1 kPa ≈ 102 mm of water
        if (kpa != null) depth = kpa * 101.97;
      }
      if (depth == null) throw new Error(`milesight-chirpstack: EM500-SWL ${devEui} has no level/pressure`);
      readings.push({
        ...base, kind: 'tank_level', value: depth, transform: 'depth_bottom',
        raw: { model, depth_mm: depth, pressure_kpa: num(object.pressure) },
      });
    } else if (model === 'CT101') {
      // Clamp current (Amps) → pump_current, direct. Unit confirmed vs official codec.
      const current = num(pick(object, ['current', 'total_current']));
      if (current == null) throw new Error(`milesight-chirpstack: CT101 ${devEui} has no current`);
      readings.push({
        ...base, kind: 'pump_current', value: current,
        raw: { model, current },
      });
    }

    return {
      msgUuid: payload.deduplicationId || `${devEui}:${payload.fCnt ?? ''}`,
      gatewayRef: info.applicationId,
      readings,
    };
  },
};
