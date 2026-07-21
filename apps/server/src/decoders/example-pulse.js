// example-pulse@1 — demonstrates that a DIFFERENT wire format (e.g. a supplier
// that encodes windmill strokes as raw pulse counts + a tank level as a 0-1023
// ADC reading) plugs in without touching storage, engine, or alerts.
//
// Payload shape (illustrative):
//   { g, id, t, d: [ { s, p, adc?, mv?, sig? }, ... ] }
//     p   = pulse count since last report  -> windmill_strokes
//     adc = 10-bit tank float (0..1023)    -> tank_level (%)
//     mv  = battery millivolts             -> battery (%)

function adcToPercent(adc) {
  return Math.max(0, Math.min(100, (Number(adc) / 1023) * 100));
}
function mvToPercent(mv) {
  // crude 3.0V..4.2V LiFePO4 mapping
  const p = ((Number(mv) - 3000) / (4200 - 3000)) * 100;
  return Math.max(0, Math.min(100, p));
}

export default {
  profile: 'example-pulse@1',
  decode(payload) {
    if (!payload || !Array.isArray(payload.d)) {
      throw new Error('example-pulse: payload.d[] required');
    }
    const ts = payload.t ? new Date(payload.t) : new Date();
    const readings = [];
    for (const node of payload.d) {
      if (node.p != null)   readings.push({ sensorRef: `${node.s}_strokes`, kind: 'windmill_strokes', value: Number(node.p), rssi: node.sig ?? null, ts });
      if (node.adc != null) readings.push({ sensorRef: `${node.s}_tank`,    kind: 'tank_level',       value: adcToPercent(node.adc), rssi: node.sig ?? null, ts });
      if (node.mv != null)  readings.push({ sensorRef: `${node.s}_batt`,    kind: 'battery',          value: mvToPercent(node.mv), ts });
    }
    return { msgUuid: payload.id, gatewayRef: payload.g, readings };
  },
};
